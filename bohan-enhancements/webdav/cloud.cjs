'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const {sha,SYSTEM} = require('./dav-cloud.cjs');
const ROOT = 'webdav://genoffice/';
const keyFor = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const partsFor = doc => doc.remotePath || [doc.remoteName];
const fileHash = async file => {
  const hash=createHash('sha256'); for await(const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex');
};
const virtual = parts => ROOT+parts.map(encodeURIComponent).join('/');
function parseVirtual(value) {
  if(typeof value !== 'string' || !value.startsWith(ROOT)) throw new Error('invalid-cloud-path');
  const raw=value.slice(ROOT.length).replace(/\/$/,'');
  const parts=raw ? raw.split('/').map(decodeURIComponent) : [];
  if(parts.some(p => !p || p==='.' || p==='..' || /[/\\\x00-\x1f]/.test(p)) || [SYSTEM,'backups-v1'].includes(parts[0])) throw new Error('invalid-cloud-path');
  return parts;
}
class CloudService {
  constructor({queue,client,root,isOpen = () => true,onChange = () => {}}) {
    this.queue=queue; this.client=client; this.root=path.join(root,queue.destination);
    this.isOpen=isOpen; this.onChange=onChange; this.viewed=new Set([ROOT]); fs.mkdirSync(this.root,{recursive:true});
  }
  rootEntry() {return {path:ROOT,name:'WebDAV 云文档',usable:false,readable:true,removable:false};}
  async list(value) {
    this.viewed.add(value);
    const parts=parseVirtual(value), rows=await this.client.list(parts);
    return {dir:value,folders:rows.filter(r=>r.directory).map(r=>({path:virtual(r.parts),name:r.name,mtimeMs:r.mtimeMs,hasSubfolders:true})),
      files:rows.filter(r=>!r.directory).map(r=>({path:virtual(r.parts),name:r.name,ext:path.extname(r.name).slice(1).toLowerCase(),
        mtimeMs:r.mtimeMs,sizeBytes:r.sizeBytes,starred:false}))};
  }
  find(parts) {
    const entry=Object.entries(this.queue.state.documents).find(([,d])=> d.hasRemote && JSON.stringify(partsFor(d))===JSON.stringify(parts));
    return entry ? [entry[1].localPath || entry[0],entry[1]] : undefined;
  }
  cachePath(parts) {
    const name=parts.at(-1);
    if(!name || /[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) throw new Error('unsupported-file-name');
    const dir=path.join(this.root,sha(JSON.stringify(parts))); fs.mkdirSync(dir,{recursive:true}); return path.join(dir,name);
  }
  bind(file,parts,result) {
    const key=keyFor(file), doc=this.queue.state.documents[key] ||= {id:randomUUID()};
    Object.assign(doc,{localPath:file,remotePath:parts,remoteName:parts.at(-1),hasRemote:true,etag:result.etag,lastHash:result.hash});
    delete doc.remoteChanged; delete doc.syncError; this.queue.persist(); return doc;
  }
  hasTasks(key) {return this.queue.state.tasks.some(t=>t.localKey===key);}
  async open(value) {
    const parts=parseVirtual(value); if(!parts.length) throw new Error('not-a-document');
    const found=this.find(parts), file=found?.[0] || this.cachePath(parts), key=keyFor(file);
    return this.queue.exclusive(key,async()=>{
      const doc=this.queue.state.documents[key], exists=fs.existsSync(file);
      if(exists && this.isOpen(file)) return file;
      if(doc?.paused || !this.queue.config.automaticUploadEnabled) {
        if(exists) return file; throw new Error('cloud-sync-paused');
      }
      try {await this.pull(key,doc,parts,file);}
      catch(e) {
        // Offline access only for a previously bound intact cache. Permission
        // failures, deletion and conflicts must never masquerade as offline.
        if(!exists || !doc?.hasRemote || !(e.code==='network-error' || e.code==='network-timeout' || e.status>=500)) throw e;
        doc.syncError='offline'; this.queue.persist();
      }
      return file;
    });
  }
  async pull(key,doc,parts,file=key) {
    if(this.hasTasks(key) || doc?.paused || this.queue.pendingCaptures) return;
    const exists=fs.existsSync(file), before=exists ? await fileHash(file) : null;
    if(doc && exists && before!==doc.lastHash) {await this.queue.enqueue(file,'local-change'); return;}
    const head=this.client.check(await this.client.request('HEAD',this.client.url(parts)),[200]);
    if(!head.etag) throw new Error('missing-etag');
    if(doc?.etag===head.etag && exists) {delete doc.remoteChanged;delete doc.syncError;return;}
    if(this.isOpen(file)) {if(doc) {doc.remoteChanged=true;this.queue.persist();} return;}
    const temp=file+'.'+randomUUID()+'.download';
    try {
      const result=await this.client.download(parts,temp,{etag:head.etag});
      if(result.etag!==head.etag) throw new Error('remote-changed-during-download');
      // Imported external revisions become durable cloud history as well.
      await this.client.archive(parts,temp,result.hash,result.mtimeMs);
      const now=fs.existsSync(file) ? await fileHash(file) : null;
      if(now!==before || this.hasTasks(key) || this.queue.pendingCaptures || this.isOpen(file) || !this.queue.config.automaticUploadEnabled || doc?.paused) {
        if(doc) {doc.remoteChanged=true;this.queue.persist();} return;
      }
      // No awaits between the final guard and replace. Concurrent saves stay intact.
      fs.renameSync(temp,file);this.bind(file,parts,result);this.onChange();
    } finally {fs.rmSync(temp,{force:true});}
  }
  async sync() {
    if(this.syncing || !this.queue.config.automaticUploadEnabled || this.queue.stopped) return;
    this.syncing=true;
    try {
      for(const [key,doc] of Object.entries(this.queue.state.documents)) {
        if(!doc.hasRemote || doc.paused || !doc.remoteName || !fs.existsSync(key) || this.queue.config.excludedDirectories?.some(dir=>require('./queue.cjs').inside(key,dir))) continue;
        try {await this.queue.exclusive(key,()=>this.pull(key,doc,partsFor(doc),doc.localPath || key));}
        catch(e) {doc.syncError=e.status===404 ? 'remote-missing' : e.code || 'sync-unavailable';this.queue.persist();}
      }
    } finally {this.syncing=false;this.onChange();}
  }
  start() {this.timer=setInterval(()=>void this.sync(),30000);this.timer.unref?.();void this.sync();}
  close() {clearInterval(this.timer);}
  resolvePath(value) {
    if(value.startsWith(ROOT)) return parseVirtual(value);
    const doc=this.queue.state.documents[keyFor(value)]; if(!doc?.hasRemote) throw new Error('not-synced'); return partsFor(doc);
  }
  async restore(parts,version) {
    const found=this.find(parts), file=found?.[0] || this.cachePath(parts), key=keyFor(file);
    return this.queue.exclusive(key,async()=>{
      if(this.isOpen(file) || this.hasTasks(key) || this.queue.pendingCaptures) throw new Error('close-document-or-resolve-pending');
      const before=fs.existsSync(file) ? await fileHash(file) : null;
      if(found && before!==found[1].lastHash) throw new Error('local-unsynced');
      const temp=file+'.'+randomUUID()+'.restore';
      try {
        const r=await this.client.download(version.parts,temp,{etag:version.etag});
        if(r.hash!==version.hash) throw new Error('history-integrity-error');
        const head=this.client.check(await this.client.request('HEAD',this.client.url(parts)),[200]);
        const task={hash:r.hash,size:r.size,capturedAt:new Date().toISOString()};
        // upload archives the current remote revision, then conditionally restores.
        const result=await this.client.upload(task,temp,{remotePath:parts,hasRemote:true,expectedEtag:head.etag});
        const now=fs.existsSync(file) ? await fileHash(file) : null;
        if(now!==before || this.hasTasks(key) || this.queue.pendingCaptures || this.isOpen(file)) throw new Error('restored-in-cloud-local-changed');
        fs.renameSync(temp,file);this.bind(file,parts,{hash:r.hash,etag:result.etag});this.onChange();return file;
      } finally {fs.rmSync(temp,{force:true});}
    });
  }
  async versionCopy(parts,version) {
    const dir=path.join(this.root,'version-copies',randomUUID());fs.mkdirSync(dir,{recursive:true});
    const name=path.basename(this.cachePath(parts)), ext=path.extname(name);
    const file=path.join(dir,path.basename(name,ext)+'（历史副本）'+ext);
    const r=await this.client.download(version.parts,file,{etag:version.etag});
    if(r.hash!==version.hash) {fs.rmSync(file,{force:true});throw new Error('history-integrity-error');}return file;
  }
  async keepBoth(value) {
    const parts=this.resolvePath(value), found=this.find(parts); if(!found) throw new Error('not-synced');
    const [file,doc]=found,key=keyFor(file);
    await this.queue.captureChain;
    return this.queue.exclusive(key,async()=>{
      if(this.isOpen(file) || this.queue.pendingCaptures) throw new Error('close-document-or-resolve-pending');
      const tasks=this.queue.state.tasks.filter(t=>t.localKey===key);
      if(!tasks.some(t=>t.status==='conflict') || tasks.some(t=>t.status==='uploading')) throw new Error('no-conflict');
      const before=await fileHash(file), ext=path.extname(file);
      const name=path.basename(file,ext)+`（冲突副本 ${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}）`+ext;
      const copy=path.join(path.dirname(file),name), newParts=[...parts.slice(0,-1),name];
      const temp=file+'.'+randomUUID()+'.download';
      try {
        const head=this.client.check(await this.client.request('HEAD',this.client.url(parts)),[200]);
        const result=await this.client.download(parts,temp,{etag:head.etag});
        if(result.etag!==head.etag) throw new Error('conflict');
        await this.client.archive(parts,temp,result.hash,result.mtimeMs);
        for(const t of tasks) await this.client.archive(parts,path.join(this.queue.root,'snapshots',t.id+'.bin'),t.hash,Date.parse(t.capturedAt));
        if(await fileHash(file)!==before || this.isOpen(file) || this.queue.pendingCaptures) throw new Error('local-unsynced');
        fs.copyFileSync(file,copy,fs.constants.COPYFILE_EXCL);
        this.queue.state.documents[keyFor(copy)]={id:randomUUID(),hasRemote:false,lastHash:null,etag:null,remotePath:newParts,remoteName:name};this.queue.persist();
        if(!await this.queue.enqueue(copy,'conflict-copy')) throw new Error('snapshot-failed');
        if(await fileHash(file)!==before || this.isOpen(file) || this.queue.pendingCaptures) throw new Error('local-unsynced');
        fs.renameSync(temp,file);
        this.queue.state.tasks=this.queue.state.tasks.filter(t=>!tasks.includes(t));
        this.bind(file,parts,result);
        for(const t of tasks) fs.rmSync(path.join(this.queue.root,'snapshots',t.id+'.bin'),{force:true});
        this.onChange();return copy;
      } finally {fs.rmSync(temp,{force:true});}
    });
  }
}
module.exports={CloudService,ROOT,parseVirtual,virtual,fileHash,keyFor};
