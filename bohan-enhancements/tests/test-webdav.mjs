import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { BackupQueue } = require('../webdav/queue.cjs');
const { DavClient } = require('../webdav/client.cjs');
const { createHooks } = require('../webdav/hooks.cjs');
const wait = async fn => { const start = Date.now(); while (!fn()) { if (Date.now() - start > 8000) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); } };
const fixture = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bohan-dav-')); return { root, file:path.join(root, 'sample.docx'), queue:path.join(root,'queue') }; };
const config = { endpoint:'https://example.test/backup/', username:'test', automaticUploadEnabled:true };

async function server() {
  const files = new Map(), dirs = new Set(), calls = [];
  let seq = 0;
  const control = { conflict:false, fail:false, noMove:false, loseCommit:false, failMove:false };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const data = Buffer.concat(chunks); const key = req.url;
    calls.push({ method:req.method, key, headers:req.headers, data });
    if (req.headers.authorization !== 'Basic ' + Buffer.from('test:secret').toString('base64')) { res.writeHead(401).end(); return; }
    if (control.fail) { res.writeHead(503).end(); return; }
    if (req.method === 'MKCOL') { const old = dirs.has(key); dirs.add(key); res.writeHead(old ? 405 : 201).end(); return; }
    if (req.method === 'MOVE') {
      if (control.failMove) { res.writeHead(503).end(); return; }
      if (control.noMove) { res.writeHead(405).end(); return; }
      const target = new URL(req.headers.destination).pathname;
      if (files.has(target)) { res.writeHead(412).end(); return; }
      files.set(target, files.get(key)); files.delete(key); res.writeHead(201).end(); return;
    }
    if (req.method === 'DELETE') { files.delete(key); res.writeHead(204).end(); return; }
    if (req.method === 'PUT') {
      if (key.endsWith('/latest.json') && control.conflict) { res.writeHead(412).end(); return; }
      const old = files.get(key);
      if ((req.headers['if-none-match'] === '*' && old) || (req.headers['if-match'] && old?.etag !== req.headers['if-match'])) { res.writeHead(412).end(); return; }
      const item = { data, etag:'"v' + (++seq) + '"' }; files.set(key,item);
      if (key.endsWith('/latest.json') && control.loseCommit) { control.loseCommit=false; req.socket.destroy(); return; }
      res.writeHead(201,{ETag:item.etag}).end(); return;
    }
    if (req.method === 'HEAD') { const f=files.get(key); res.writeHead(f ? 200:404, f ? {ETag:f.etag}:{}).end(); return; }
    if (req.method === 'GET') { const f=files.get(key); res.writeHead(f ? 200:404, f ? {ETag:f.etag}:{}).end(f?.data); return; }
    res.writeHead(405).end();
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const endpoint = `http://127.0.0.1:${server.address().port}/target/`;
  const client = new DavClient({endpoint,allowHttpForTests:true,credentials:async () => ({username:'test',password:'secret'})});
  return { endpoint, client, files, calls, control, close:() => new Promise(r => server.close(r)) };
}

test('disabled, excluded and paused files never snapshot or upload', async () => {
  const f=fixture();fs.writeFileSync(f.file,'original');let uploads=0;
  const c={...config,automaticUploadEnabled:false};const q=new BackupQueue({root:f.queue,config:c,client:{upload(){uploads++;}}});
  assert.equal(await q.enqueue(f.file),false);c.automaticUploadEnabled=true;c.excludedDirectories=[f.root];
  assert.equal(await q.enqueue(f.file),false);c.excludedDirectories=[];q.pauseDocument(f.file,true);
  assert.equal(await q.enqueue(f.file),false);assert.equal(uploads,0);await q.close();fs.rmSync(f.root,{recursive:true,force:true});
});

test('real WebDAV version uploads, UTF-8 names, dedup, ETag updates and immutable snapshots', async () => {
  const dav=await server(),f=fixture();const file=path.join(f.root,'公文 标题.docx');fs.writeFileSync(file,'version one');
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {
    assert.equal(await q.enqueue(file,'open'),true);await wait(() => q.state.history.length===1);
    assert.equal(await q.enqueue(file,'open'),false);
    const firstCount=dav.calls.length;
    fs.writeFileSync(file,'version two');assert.equal(await q.enqueue(file,'save'),true);await wait(() => q.state.history.length===2);
    const manifestCalls=dav.calls.filter(c => c.key.endsWith('/latest.json') && c.method==='PUT');
    assert.equal(manifestCalls.length,2);assert.equal(manifestCalls[0].headers['if-none-match'],'*');assert.ok(manifestCalls[1].headers['if-match']);
    const manifest=JSON.parse(manifestCalls[1].data);assert.equal(manifest.originalName,'公文 标题.docx');assert.ok(!JSON.stringify(manifest).includes(f.root));
    assert.equal([...dav.files.keys()].filter(k => !k.endsWith('/latest.json')).length,2);assert.ok(dav.calls.length>firstCount);
    assert.equal(fs.readFileSync(file,'utf8'),'version two');
    assert.ok(!fs.readFileSync(path.join(f.queue,'queue.json'),'utf8').includes('secret'));
  } finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('offline queue survives restart; repeated saves back to a previous version are retained', async () => {
  const f=fixture();fs.writeFileSync(f.file,'A');let fail=true;const uploaded=[];
  const client={async upload(task,file){if(fail)throw new Error('offline');uploaded.push(fs.readFileSync(file,'utf8'));return {etag:'"ok"',remote:'https://example.test/version'};}};
  let q=new BackupQueue({root:f.queue,config:{...config},client});
  try {
    await q.enqueue(f.file,'open');await wait(() => q.state.tasks[0]?.status==='failed');await q.close();
    q=new BackupQueue({root:f.queue,config:{...config},client});
    fs.writeFileSync(f.file,'B');await q.enqueue(f.file);fs.writeFileSync(f.file,'A');await q.enqueue(f.file);
    assert.equal(q.state.tasks.length,3);fail=false;q.retry();await wait(() => q.state.history.length===3);
    assert.deepEqual(uploaded,['A','B','A']);assert.equal(fs.readFileSync(f.file,'utf8'),'A');
  } finally {await q.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('save during upload uses a separate snapshot, not mixed live bytes', async () => {
  const f=fixture();fs.writeFileSync(f.file,'old content');let release;let first=true;const received=[];
  const client={async upload(_task,file){if(first){first=false;await new Promise(r=>release=r);}received.push(fs.readFileSync(file,'utf8'));return {etag:'"ok"',remote:'https://example.test/v'};}};
  const q=new BackupQueue({root:f.queue,config:{...config},client});
  try {await q.enqueue(f.file);await wait(()=>release);fs.writeFileSync(f.file,'new content');await q.enqueue(f.file);release();await wait(()=>q.state.history.length===2);assert.deepEqual(received,['old content','new content']);}
  finally {await q.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('412 preserves uploaded version and local queued bytes, with no silent manifest overwrite', async () => {
  const dav=await server(),f=fixture();fs.writeFileSync(f.file,'local version');dav.control.conflict=true;
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='conflict');assert.equal(q.state.history.length,0);
    assert.ok(fs.existsSync(path.join(f.queue,'snapshots',q.state.tasks[0].id+'.bin')));assert.equal([...dav.files.keys()].length,1);
    const n=dav.calls.length;q.retry();await new Promise(r=>setTimeout(r,30));assert.equal(dav.calls.length,n);}
  finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('MOVE-less servers use conditional PUT; failed transfers retry without losing versions', async () => {
  const dav=await server(),f=fixture();fs.writeFileSync(f.file,'content');dav.control.fail=true;
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='failed');dav.control.fail=false;dav.control.noMove=true;q.retry();await wait(()=>q.state.history.length===1);
    assert.equal([...dav.files.keys()].filter(k=>k.includes('.upload-')).length,0);assert.ok(dav.calls.some(c=>c.method==='DELETE'));}
  finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('different destinations cannot drain an existing queue; corrupt snapshots and size limits stay local', async () => {
  const f=fixture();fs.writeFileSync(f.file,'snapshot');const client={async upload(){throw new Error('offline');}};
  const q=new BackupQueue({root:f.queue,config:{...config},client});
  try {await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='failed');assert.throws(()=>new BackupQueue({root:f.queue,config:{...config,endpoint:'https://other.test/'},client}),/destination/);
    fs.writeFileSync(path.join(f.queue,'snapshots',q.state.tasks[0].id+'.bin'),'changed');q.retry();await wait(()=>q.state.tasks[0]?.error==='snapshot-corrupt');
    q.config.maxFileBytes=2;assert.equal(await q.enqueue(f.file),false);assert.equal(q.state.errors[0].code,'file-too-large-or-not-regular');}
  finally {await q.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('hooks reject failed/cancelled opens, await native parse acknowledgements, and use saved output paths', () => {
  const calls=[],pending=new Map();const hook=createHooks({pending,observe:(...v)=>calls.push(v)});const event={sender:{id:7,isDestroyed:()=>false}};
  const file=path.resolve('document.docx');
  hook('docs:open',event,[],{needsPassword:true,path:file});hook('docs:save',event,[file],{ok:false});
  hook('files:read-image',event,[file],{ok:true});assert.equal(calls.length,0);assert.equal(pending.size,0);
  hook('docs:open-path',event,[file],{path:file,hash:'hash',dataUrl:'data'});assert.equal(calls.length,0);assert.equal(pending.get(7).path,file);
  hook('docs:save',event,[file],{ok:true});assert.equal(calls.at(-1)[1],file);
  hook('pdf:save',event,[{path:file,targetPath:path.resolve('copy.pdf')}],{ok:true});assert.equal(calls.at(-1)[1],path.resolve('copy.pdf'));
  hook('markdown:save',event,[],{ok:true,canceled:true,path:file});assert.equal(calls.length,2);
  hook('markdown:read-file',event,[path.resolve('empty.md')],'');assert.equal(calls.length,3);
});

test('transport rejects unsafe endpoints and redirect credentials never follow another origin', async () => {
  assert.throws(()=>new DavClient({endpoint:'http://example.test/',credentials:()=>{}}),/invalid-endpoint/);
  assert.throws(()=>new DavClient({endpoint:'https://user:pass@example.test/',credentials:()=>{}}),/invalid-endpoint/);
  const c=new DavClient({endpoint:config.endpoint,credentials:()=>{}});assert.throws(()=>c.url(['..']),/invalid-remote-path/);
  await assert.rejects(()=>c.request('GET',new URL('https://other.test/')),/invalid-remote-path/);
});

test('lost manifest response reconciles only the exact committed task on retry', async () => {
  const dav=await server(),f=fixture();fs.writeFileSync(f.file,'committed bytes');dav.control.loseCommit=true;
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='failed');q.retry();await wait(()=>q.state.history.length===1);
    assert.equal(dav.files.size,2);assert.ok(dav.calls.some(c=>c.method==='GET' && c.key.endsWith('/latest.json')));}
  finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('failed transfer cleans its own temporary object and keeps the durable snapshot', async () => {
  const dav=await server(),f=fixture();fs.writeFileSync(f.file,'retry bytes');dav.control.failMove=true;
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='failed');assert.equal(dav.files.size,0);
    assert.ok(fs.existsSync(path.join(f.queue,'snapshots',q.state.tasks[0].id+'.bin')));
    dav.control.failMove=false;q.retry();await wait(()=>q.state.history.length===1);assert.equal(dav.files.size,2);}
  finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('restart cleans only orphan snapshots and rejects damaged path-bearing queue IDs', async () => {
  const f=fixture();fs.writeFileSync(f.file,'durable');const client={async upload(){throw new Error('offline');}};
  let q=new BackupQueue({root:f.queue,config:{...config},client});
  try {await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='failed');await q.close();
    const orphan=path.join(f.queue,'snapshots','11111111-1111-4111-8111-111111111111.partial');fs.writeFileSync(orphan,'partial');
    const unrelated=path.join(f.queue,'snapshots','keep.txt');fs.writeFileSync(unrelated,'preserve');
    q=new BackupQueue({root:f.queue,config:{...config},client});assert.equal(fs.existsSync(orphan),false);assert.equal(fs.existsSync(unrelated),true);
    assert.equal(fs.existsSync(path.join(f.queue,'snapshots',q.state.tasks[0].id+'.bin')),true);await q.close();
    q.state.tasks[0].id='../escape';q.persist();assert.throws(()=>new BackupQueue({root:f.queue,config:{...config},client}),/damaged/);}
  finally {await q.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
