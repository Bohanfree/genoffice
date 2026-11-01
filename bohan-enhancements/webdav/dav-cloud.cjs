'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const SYSTEM = '.genoffice-history';
const sha = data => createHash('sha256').update(data).digest('hex');
// Small, non-expanding DAV XML reader. No DTD, entities, processing instructions
// other than the XML declaration, or recovery from malformed nesting.
function xml(text) {
  if (/<!|<\?(?!xml\s)/i.test(text)) throw new Error('unsafe-dav-xml');
  text = text.replace(/^\s*<\?xml[^?]*\?>/, '');
  const root = { children:[], text:'' }, stack = [root];
  const decode = value => {
    if(/&(?![a-z]+;|#(?:[0-9]+|x[0-9a-f]+);)/i.test(value)) throw new Error('invalid-dav-xml');
    return value.replace(/&([^;]+);/g, (_, entity) => {
    const named = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if (named[entity]) return named[entity];
    if (!/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) throw new Error('unsafe-dav-xml');
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new Error('unsafe-dav-xml');
    return String.fromCodePoint(n);
    });
  };
  const tokens = text.match(/<[^>]*>|[^<]+/g) || [];
  if(tokens.join('')!==text) throw new Error('invalid-dav-xml');
  for (const token of tokens) {
    if (!token.startsWith('<')) { stack.at(-1).text += decode(token); continue; }
    const m = /^<(\/)?([\w:-]+)(?:\s+[^<>]*)?\/?\s*>$/.exec(token);
    if (!m) throw new Error('invalid-dav-xml');
    if (m[1]) { if (stack.length === 1 || stack.pop().tag !== m[2]) throw new Error('invalid-dav-xml'); }
    else {
      const node = { tag:m[2], name:m[2].split(':').at(-1).toLowerCase(), children:[], text:'' };
      stack.at(-1).children.push(node); if (!/\/\s*>$/.test(token)) stack.push(node);
    }
    if (stack.length > 64) throw new Error('invalid-dav-xml');
  }
  if (stack.length !== 1 || root.children.length !== 1) throw new Error('invalid-dav-xml');
  return root.children[0];
}
const child = (node,name) => node.children.find(n => n.name === name);
function parseListing(text, client, parts) {
  const root = xml(text), result = [], seen = new Set();
  if (root.name !== 'multistatus') throw new Error('invalid-dav-xml');
  for (const response of root.children.filter(n => n.name === 'response')) {
    const href = child(response,'href')?.text;
    if (!href) continue;
    const url = new URL(href, client.base);
    if (url.origin !== client.base.origin || url.search || url.hash || url.username || url.password || !url.pathname.startsWith(client.base.pathname)) throw new Error('unsafe-dav-href');
    const relative = url.pathname.slice(client.base.pathname.length).replace(/\/$/,'');
    const components = relative ? relative.split('/').map(decodeURIComponent) : [];
    client.url(components); // Reject encoded separators and traversal.
    if (parts.some((p,i) => components[i] !== p) || components.length < parts.length || components.length > parts.length + 1) throw new Error('unsafe-dav-href');
    if (components.length === parts.length) continue;
    const propstat = response.children.find(n => n.name === 'propstat' && /\s200(?:\s|$)/.test(child(n,'status')?.text || ''));
    const prop = propstat && child(propstat,'prop');
    if (!prop) continue;
    const name = components.at(-1);
    if (seen.has(name)) continue; seen.add(name);
    const size = Number(child(prop,'getcontentlength')?.text || 0);
    result.push({parts:components,name,directory:!!child(child(prop,'resourcetype') || {children:[]},'collection'),
      etag:child(prop,'getetag')?.text || null, sizeBytes:Number.isSafeInteger(size) && size >= 0 ? size : 0,
      mtimeMs:Date.parse(child(prop,'getlastmodified')?.text || '') || 0});
  }
  return result;
}
function install(DavClient, DavError) {
  DavClient.prototype.list = async function(parts = [], {system = false} = {}) {
    const url = this.url(parts); if (!url.pathname.endsWith('/')) url.pathname += '/';
    const r = this.check(await this.request('PROPFIND',url,{headers:{Depth:'1','Content-Type':'application/xml; charset=utf-8'},
      body:'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>',maxBytes:8*1024*1024}),[207]);
    return parseListing(r.body,this,parts).filter(n => system || ![SYSTEM,'backups-v1'].includes(n.parts[0]));
  };
  DavClient.prototype.download = async function(parts, destination, {etag, maxBytes = 512*1024*1024, signal} = {}) {
    const url = this.url(parts), {username,password} = await this.credentials();
    const transport = url.protocol === 'https:' ? require('node:https') : require('node:http');
    try {
      return await new Promise((resolve,reject) => {
        const req = transport.request(url,{method:'GET',signal,headers:{Authorization:'Basic '+Buffer.from(username+':'+password).toString('base64'),...(etag ? {'If-Match':etag} : {})}}, res => {
          if (res.statusCode !== 200) { res.resume(); try { this.check({status:res.statusCode},[200]); } catch(e) { reject(e); } return; }
          const hash = createHash('sha256'); let size=0;
          const hashing = new Transform({transform(chunk,_encoding,done) {
            size+=chunk.length; if (size>maxBytes) return done(new DavError('response-too-large'));
            hash.update(chunk); done(null,chunk);
          }});
          pipeline(res,hashing,fs.createWriteStream(destination,{flags:'wx',mode:0o600})).then(() => resolve({etag:res.headers.etag || null,
            hash:hash.digest('hex'),size,mtimeMs:Date.parse(res.headers['last-modified'] || '') || 0}),reject);
        });
        req.setTimeout(this.timeout,() => req.destroy(new DavError('network-timeout')));
        req.on('error',() => reject(new DavError('network-error'))); req.end();
      });
    } catch(e) { await fs.promises.unlink(destination).catch(()=>{}); throw e; }
  };
  DavClient.prototype.versionDirectory = function(parts) { return [SYSTEM,sha(JSON.stringify(parts))]; };
  DavClient.prototype.archive = async function(parts,file,hash,time = Date.now()) {
    // Avoid a second physical archive when another device already saved the
    // same latest bytes. Returning to an older revision still creates history.
    const latest=(await this.versions(parts))[0];
    if(latest?.hash===hash) return latest.name;
    const dir = this.versionDirectory(parts);
    for(let i=1;i<=dir.length;i++) {
      const url=this.url(dir.slice(0,i)); url.pathname+='/';
      this.check(await this.request('MKCOL',url),[201,405]);
    }
    const stamp = Number.isFinite(time) && time > 0 ? Math.floor(time) : Date.now();
    const name = `${stamp}-${hash}.bin`, target = this.url([...dir,name]);
    const r = await this.request('PUT',target,{file,headers:{'If-None-Match':'*','Content-Type':'application/octet-stream'}});
    if (r.status === 412) {
      const same = await this.matchingRemote(target,{hash,size:fs.statSync(file).size});
      if (!same) throw new DavError('history-integrity-error');
    } else this.check(r,[200,201,204]);
    return name;
  };
  DavClient.prototype.archiveRemote = async function(parts,etag) {
    if (!etag) throw new DavError('missing-etag');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'genoffice-history-')), file=path.join(dir,'version');
    try { const r=await this.download(parts,file,{etag}); if(r.etag !== etag) throw new DavError('conflict',412);
      await this.archive(parts,file,r.hash,r.mtimeMs); return r;
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  };
  DavClient.prototype.versions = async function(parts) {
    try { return (await this.list(this.versionDirectory(parts),{system:true})).filter(n => !n.directory && /^\d{10,16}-[a-f0-9]{64}\.bin$/.test(n.name))
      .map(n => ({...n,time:Number(n.name.split('-')[0]),hash:n.name.split('-')[1].slice(0,-4)})).sort((a,b)=>b.time-a.time)
      .filter((v,i,all)=>i===0 || all[i-1].hash!==v.hash); }
    catch(e) { if(e.status === 404) return []; throw e; }
  };
}
module.exports = {install,parseListing,SYSTEM,sha};
