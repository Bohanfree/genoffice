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
      if (control.conflict) { res.writeHead(412).end(); return; }
      const old = files.get(key);
      if ((req.headers['if-none-match'] === '*' && old) || (req.headers['if-match'] && old?.etag !== req.headers['if-match'])) { res.writeHead(412).end(); return; }
      const item = { data, etag:'"v' + (++seq) + '"' }; files.set(key,item);
      if (control.loseCommit) { control.loseCommit=false; req.socket.destroy(); return; }
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

test('readable UTF-8 documents update in place without UUID directories or manifests', async () => {
  const dav=await server(),f=fixture();const file=path.join(f.root,'公文 标题.docx');fs.writeFileSync(file,'version one');
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {
    assert.equal(await q.enqueue(file,'open'),true);await wait(() => q.state.history.length===1);
    assert.equal(await q.enqueue(file,'open'),false);
    const firstCount=dav.calls.length;
    fs.writeFileSync(file,'version two');assert.equal(await q.enqueue(file,'save'),true);await wait(() => q.state.history.length===2);
    const puts=dav.calls.filter(c => c.method==='PUT');
    assert.equal(puts.length,2);assert.equal(puts[0].headers['if-none-match'],'*');assert.ok(puts[1].headers['if-match']);
    assert.equal(dav.files.size,1);assert.equal(decodeURIComponent([...dav.files.keys()][0]),'/target/公文 标题.docx');
    assert.equal([...dav.files.values()][0].data.toString(),'version two');
    assert.equal(dav.calls.filter(c => ['MKCOL','MOVE','DELETE'].includes(c.method)).length,0);
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

test('remote edits retain remote content and local queued bytes without overwriting', async () => {
  const dav=await server(),f=fixture();fs.writeFileSync(f.file,'original');
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {
    await q.enqueue(f.file);await wait(()=>q.state.history.length===1);
    const remote=[...dav.files.values()][0];remote.data=Buffer.from('external edit');remote.etag='"external"';
    fs.writeFileSync(f.file,'local edit');await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='conflict');
    assert.equal(q.state.history.length,1);assert.equal(remote.data.toString(),'external edit');
    assert.ok(fs.existsSync(path.join(f.queue,'snapshots',q.state.tasks[0].id+'.bin')));
    const n=dav.calls.length;q.retry();await new Promise(r=>setTimeout(r,30));assert.equal(dav.calls.length,n);
  } finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('same names from folders and existing remote files get readable numeric suffixes', async () => {
  const dav=await server(),f=fixture();fs.writeFileSync(f.file,'local A');
  const second=path.join(f.root,'another','sample.docx');fs.mkdirSync(path.dirname(second));fs.writeFileSync(second,'local B');
  dav.files.set('/target/sample.docx',{data:Buffer.from('local A'),etag:'"existing"'});
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {
    await q.enqueue(f.file);await wait(()=>q.state.history.length===1);
    await q.enqueue(second);await wait(()=>q.state.history.length===2);
    assert.deepEqual([...dav.files.keys()].map(decodeURIComponent),['/target/sample.docx','/target/sample (2).docx','/target/sample (3).docx']);
    fs.writeFileSync(second,'local B updated');await q.enqueue(second);await wait(()=>q.state.history.length===3);
    assert.equal(dav.files.size,3);assert.equal(dav.files.get('/target/sample%20(3).docx').data.toString(),'local B updated');
  } finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
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

test('lost PUT response recovers large binary document by streaming hash after restart', async () => {
  const dav=await server(),f=fixture();const bytes=Buffer.alloc(2*1024*1024+17,0x81);fs.writeFileSync(f.file,bytes);dav.control.loseCommit=true;
  let q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {
    await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='failed');await q.close();
    q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
    q.retry();await wait(()=>q.state.history.length===1);
    assert.equal(dav.files.size,1);assert.ok(dav.calls.some(c=>c.method==='GET'));
    assert.equal(dav.calls.filter(c=>c.method==='PUT').length,1);assert.deepEqual([...dav.files.values()][0].data,bytes);
  } finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('failed upload retains snapshot and retries with the same readable name', async () => {
  const dav=await server(),f=fixture();fs.writeFileSync(f.file,'retry bytes');dav.control.fail=true;
  const q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {await q.enqueue(f.file);await wait(()=>q.state.tasks[0]?.status==='failed');assert.equal(dav.files.size,0);
    assert.ok(fs.existsSync(path.join(f.queue,'snapshots',q.state.tasks[0].id+'.bin')));
    dav.control.fail=false;q.retry();await wait(()=>q.state.history.length===1);assert.equal(dav.files.size,1);
    assert.equal([...dav.files.keys()][0],'/target/sample.docx');}
  finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
});

test('schema 1 migration preserves receipts but clears old manifest identity and dedup', async () => {
  const dav=await server(),f=fixture();fs.writeFileSync(f.file,'old backup content');
  let q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
  try {
    await q.enqueue(f.file);await wait(()=>q.state.history.length===1);await q.close();
    const old=JSON.parse(fs.readFileSync(path.join(f.queue,'queue.json')));old.schema=1;
    for(const d of Object.values(old.documents)){delete d.remoteName;delete d.hasRemote;d.hasManifest=true;d.etag='"old-manifest"';}
    fs.writeFileSync(path.join(f.queue,'queue.json'),JSON.stringify(old));
    q=new BackupQueue({root:f.queue,config:{...config,endpoint:dav.endpoint},client:dav.client});
    assert.equal(q.state.schema,2);assert.equal(q.state.history.length,1);assert.ok(fs.existsSync(path.join(f.queue,'queue-before-readable-backups.json')));
    assert.equal(await q.enqueue(f.file),true);await wait(()=>q.state.history.length===2);
    assert.equal(q.state.history[0].remoteName,'sample (2).docx');
  } finally {await q.close();await dav.close();fs.rmSync(f.root,{recursive:true,force:true});}
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
