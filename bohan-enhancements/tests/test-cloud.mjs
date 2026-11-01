import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {DavClient}=require('../webdav/client.cjs');
const {BackupQueue}=require('../webdav/queue.cjs');
const {CloudService,ROOT,virtual,parseVirtual,keyFor}=require('../webdav/cloud.cjs');
const {parseListing,sha}=require('../webdav/dav-cloud.cjs');
const wait=async fn=>{for(let i=0;i<1500;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('timeout');};
const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
async function fixture() {
  const files=new Map(), dirs=new Set(['/target/']),calls=[];let n=0;
  const control={offline:false,failHistory:false,holdGet:null,loseCommit:false};
  const put=(parts,data)=>{const key='/target/'+parts.map(encodeURIComponent).join('/');const item={data:Buffer.from(data),etag:`"r${++n}"`,mtime:new Date(1700000000000+n*1000).toUTCString()};files.set(key,item);return item;};
  const server=http.createServer(async(req,res)=>{
    const body=[];for await(const b of req)body.push(b);const key=req.url;calls.push({method:req.method,key});
    if(control.offline){res.writeHead(503).end();return;}
    if(req.headers.authorization!=='Basic '+Buffer.from('test:secret').toString('base64')){res.writeHead(401).end();return;}
    if(control.failHistory && key.includes('.genoffice-history')){res.writeHead(503).end();return;}
    const old=files.get(key);
    if(req.method==='MKCOL'){const old=dirs.has(key);dirs.add(key);res.writeHead(old?405:201).end();return;}
    if(req.method==='PROPFIND'){
      if(!dirs.has(key)){res.writeHead(404).end();return;}
      const nodes=[...dirs].map(k=>({key:k,directory:true})).concat([...files].map(([key,v])=>({key,...v})));
      const rows=nodes.filter(v=>v.key===key || v.key.startsWith(key)&&!v.key.slice(key.length).replace(/\/$/,'').includes('/'));
      res.writeHead(207,{'Content-Type':'application/xml'}).end('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">'+rows.map(v=>`<D:response><D:href>${escape(v.key)}</D:href><D:propstat><D:prop><D:resourcetype>${v.directory?'<D:collection />':''}</D:resourcetype><D:getetag>${escape(v.etag||'')}</D:getetag><D:getcontentlength>${v.data?.length||0}</D:getcontentlength><D:getlastmodified>${v.mtime||''}</D:getlastmodified></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join('')+'</D:multistatus>');return;
    }
    if(req.method==='PUT'){
      if(req.headers['if-match']&&old?.etag!==req.headers['if-match'] || req.headers['if-none-match']==='*'&&old){res.writeHead(412).end();return;}
      const v=put(key.slice('/target/'.length).split('/').map(decodeURIComponent),Buffer.concat(body));
      if(control.loseCommit&&!key.includes('.genoffice-history')){control.loseCommit=false;req.socket.destroy();return;}
      res.writeHead(201,{ETag:v.etag}).end();return;
    }
    if(['GET','HEAD'].includes(req.method)){
      if(!old){res.writeHead(404).end();return;}
      if(req.headers['if-match']&&req.headers['if-match']!==old.etag){res.writeHead(412).end();return;}
      if(req.method==='GET'&&control.holdGet){const hold=control.holdGet;control.holdGet=null;await hold();}
      res.writeHead(200,{ETag:old.etag,'Last-Modified':old.mtime});res.end(req.method==='GET'?old.data:undefined);return;
    }
    res.writeHead(405).end();
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${server.address().port}/target/`,root=fs.mkdtempSync(path.join(os.tmpdir(),'bohan-cloud-')),services=[];
  const device=()=>{
    const dir=path.join(root,String(services.length));fs.mkdirSync(dir);
    const client=new DavClient({endpoint,allowHttpForTests:true,historyEnabled:true,credentials:async()=>({username:'test',password:'secret'})});
    const queue=new BackupQueue({root:path.join(dir,'queue'),config:{endpoint,username:'test',automaticUploadEnabled:true},client});
    const opened=new Set();const cloud=new CloudService({queue,client,root:path.join(dir,'cache'),isOpen:file=>opened.has(keyFor(file))});
    const d={dir,client,queue,cloud,opened};services.push(d);return d;
  };
  return {files,dirs,put,calls,control,device,async close(){for(const d of services){d.cloud.close();await d.queue.close();await wait(()=>!d.queue.running);}
    await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}};
}
test('cloud folder lists UTF-8, nested same names and hides system storage',async()=>{
  const f=await fixture();try{const a=f.device();f.dirs.add('/target/%E5%85%AC%E6%96%87/');f.dirs.add('/target/.genoffice-history/');f.dirs.add('/target/backups-v1/');
    f.put(['公文','通知.docx'],'nested');f.put(['通知.docx'],'root');
    const root=await a.cloud.list(ROOT);assert.deepEqual(root.folders.map(r=>r.name),['公文']);assert.equal(root.files[0].name,'通知.docx');
    const nested=await a.cloud.list(virtual(['公文']));assert.equal(nested.files[0].name,'通知.docx');
    const p1=await a.cloud.open(root.files[0].path),p2=await a.cloud.open(nested.files[0].path);assert.notEqual(p1,p2);assert.equal(fs.readFileSync(p2,'utf8'),'nested');
  }finally{await f.close();}
});
test('two devices exchange edits and restore durable cloud versions',async()=>{
  const f=await fixture();try{const a=f.device(),b=f.device();f.put(['sample.docx'],'A');
    const pa=await a.cloud.open(virtual(['sample.docx'])),pb=await b.cloud.open(virtual(['sample.docx']));
    fs.writeFileSync(pa,'B');await a.queue.enqueue(pa,'save');await wait(()=>!a.queue.state.tasks.length);
    await b.cloud.sync();assert.equal(fs.readFileSync(pb,'utf8'),'B');
    fs.writeFileSync(pb,'C');await b.queue.enqueue(pb,'save');await wait(()=>!b.queue.state.tasks.length);
    await a.cloud.sync();assert.equal(fs.readFileSync(pa,'utf8'),'C');
    const versions=await a.client.versions(['sample.docx']);assert.ok(versions.length>=3);const old=versions.find(v=>v.hash===sha('A'));assert.ok(old);
    await a.cloud.restore(['sample.docx'],old);assert.equal(fs.readFileSync(pa,'utf8'),'A');await b.cloud.sync();assert.equal(fs.readFileSync(pb,'utf8'),'A');
    assert.ok((await a.client.versions(['sample.docx'])).some(v=>v.hash===sha('C')));
  }finally{await f.close();}
});
test('open editors are protected and reopen pulls cloud changes',async()=>{
  const f=await fixture();try{const a=f.device();f.put(['sample.docx'],'A');const p=await a.cloud.open(virtual(['sample.docx']));a.opened.add(keyFor(p));
    f.put(['sample.docx'],'B');await a.cloud.sync();assert.equal(fs.readFileSync(p,'utf8'),'A');assert.equal(a.queue.state.documents[keyFor(p)].remoteChanged,true);
    a.opened.clear();await a.cloud.open(virtual(['sample.docx']));assert.equal(fs.readFileSync(p,'utf8'),'B');
  }finally{await f.close();}
});
test('offline cache and save retry do not create duplicate files',async()=>{
  const f=await fixture();try{const a=f.device();f.put(['sample.docx'],'A');const p=await a.cloud.open(virtual(['sample.docx']));f.control.offline=true;
    assert.equal(await a.cloud.open(virtual(['sample.docx'])),p);fs.writeFileSync(p,'offline B');await a.queue.enqueue(p);await wait(()=>a.queue.state.tasks[0]?.status==='failed');
    f.control.offline=false;a.queue.retry();await wait(()=>!a.queue.state.tasks.length);assert.equal(f.files.get('/target/sample.docx').data.toString(),'offline B');
    assert.equal([...f.files.keys()].filter(k=>!k.includes('.genoffice-history')).length,1);
  }finally{await f.close();}
});
test('concurrent edits preserve both through explicit conflict resolution',async()=>{
  const f=await fixture();try{const a=f.device();f.put(['sample.docx'],'A');const p=await a.cloud.open(virtual(['sample.docx']));
    f.put(['sample.docx'],'remote B');fs.writeFileSync(p,'local C');await a.queue.enqueue(p);await wait(()=>a.queue.state.tasks[0]?.status==='conflict');
    const copy=await a.cloud.keepBoth(virtual(['sample.docx']));await wait(()=>!a.queue.state.tasks.length);
    assert.equal(fs.readFileSync(p,'utf8'),'remote B');assert.equal(fs.readFileSync(copy,'utf8'),'local C');
    const listing=await a.cloud.list(ROOT);assert.equal(listing.files.length,2);assert.ok(listing.files.some(r=>r.name.includes('冲突副本')));
  }finally{await f.close();}
});
test('history write failures block replacement until archived successfully',async()=>{
  const f=await fixture();try{const a=f.device();f.put(['sample.docx'],'A');const p=await a.cloud.open(virtual(['sample.docx']));f.control.failHistory=true;
    fs.writeFileSync(p,'B');await a.queue.enqueue(p);await wait(()=>a.queue.state.tasks[0]?.status==='failed');assert.equal(f.files.get('/target/sample.docx').data.toString(),'A');
    f.control.failHistory=false;a.queue.retry();await wait(()=>!a.queue.state.tasks.length);assert.equal(f.files.get('/target/sample.docx').data.toString(),'B');assert.ok((await a.client.versions(['sample.docx'])).length>=2);
  }finally{await f.close();}
});
test('a save during download survives without mixed or overwritten bytes',async()=>{
  const f=await fixture();try{const a=f.device();f.put(['sample.docx'],'A');const p=await a.cloud.open(virtual(['sample.docx']));f.put(['sample.docx'],'remote B');
    let release,entered=false;f.control.holdGet=()=>{entered=true;return new Promise(r=>release=r);};const sync=a.cloud.sync();await wait(()=>entered);
    fs.writeFileSync(p,'saved while fetching');await a.queue.enqueue(p,'save');release();await sync;await wait(()=>a.queue.state.tasks[0]?.status==='conflict');
    assert.equal(fs.readFileSync(p,'utf8'),'saved while fetching');assert.equal(f.files.get('/target/sample.docx').data.toString(),'remote B');
  }finally{await f.close();}
});
test('remote deletion is reported without deleting local copies',async()=>{
  const f=await fixture();try{const a=f.device();f.put(['sample.docx'],'A');const p=await a.cloud.open(virtual(['sample.docx']));f.files.delete('/target/sample.docx');await a.cloud.sync();
    assert.equal(fs.readFileSync(p,'utf8'),'A');assert.equal(a.queue.state.documents[keyFor(p)].syncError,'remote-missing');await assert.rejects(()=>a.cloud.open(virtual(['sample.docx'])));
  }finally{await f.close();}
});
test('DAV XML rejects traversal, foreign origins and entity expansion',()=>{
  const c=new DavClient({endpoint:'https://example.test/target/',credentials:async()=>({})});
  const make=href=>`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${href}</d:href><d:propstat><d:prop/><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  for(const href of ['https://evil.test/target/x','/elsewhere/x','/target/%2e%2e/x','/target/%2fescape','/target/%5cescape','/target/a/b']) assert.throws(()=>parseListing(make(href),c,[]));
  assert.throws(()=>parseListing('<!DOCTYPE d [<!ENTITY x SYSTEM "file:///secret">]>'+make('&x;'),c,[]));assert.throws(()=>parseListing(make('&unknown;'),c,[]));assert.throws(()=>parseVirtual(ROOT+'%2e%2e'));
});
test('lost save responses still create history when retry verifies remote content',async()=>{
  const f=await fixture();try{const a=f.device();f.put(['sample.docx'],'A');const p=await a.cloud.open(virtual(['sample.docx']));f.control.loseCommit=true;
    fs.writeFileSync(p,'B');await a.queue.enqueue(p);await wait(()=>a.queue.state.tasks[0]?.status==='failed');a.queue.retry();await wait(()=>!a.queue.state.tasks.length);
    assert.ok((await a.client.versions(['sample.docx'])).some(v=>v.hash===sha('B')));assert.equal(f.calls.filter(c=>c.method==='PUT'&&c.key==='/target/sample.docx').length,1);
  }finally{await f.close();}
});
test('home IPC exposes the cloud root, downloads before native open, and blocks local mutations of virtual paths',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bohan-home-')),handlers=new Map();
  fs.writeFileSync(path.join(root,'webdav-config.json'),JSON.stringify({endpoint:'https://example.test/target/',username:'test',credentialTarget:'GenOffice/WebDAV/test',automaticUploadEnabled:false}));
  const app=new EventEmitter();app.getPath=()=>root;app.whenReady=async()=>{};
  const ipcMain=new EventEmitter();ipcMain.handle=(name,fn)=>handlers.set(name,fn);
  const bridge=require('../webdav/bootstrap.cjs').install({app,ipcMain,Menu:{setApplicationMenu(){}},MenuItem:class{},
    dialog:{async showMessageBox(){return {response:0};}},BrowserWindow:{getAllWindows:()=>[]},shell:{}});
  try{
    await new Promise(r=>setImmediate(r));assert.ok(bridge.cloud);
    ipcMain.handle('home:folder-roots',()=>[{path:'local'}]);
    const roots=await handlers.get('home:folder-roots')({});assert.equal(roots[1].path,ROOT);assert.equal(roots[1].usable,false);
    const cached=bridge.cloud.cachePath(['sample.docx']);bridge.cloud.bind(cached,['sample.docx'],{etag:'"one"',hash:sha('A')});
    ipcMain.handle('home:recents',()=>({entries:[{path:cached},{path:path.join(root,'local.docx')}],total:2}));
    const recents=await handlers.get('home:recents')({});assert.equal(recents.entries[0].cloudDocument,true);assert.equal(recents.entries[1].cloudDocument,false);
    let originalCalls=0;ipcMain.handle('home:folder-list',()=>{originalCalls++;return 'local';});
    bridge.cloud.list=async()=>({dir:ROOT,folders:[],files:[{name:'sample.docx'}]});
    assert.equal((await handlers.get('home:folder-list')({},ROOT)).files[0].name,'sample.docx');assert.equal(originalCalls,0);
    let opened;bridge.cloud.open=async value=>{assert.equal(value,virtual(['sample.docx']));return path.join(root,'sample.docx');};
    ipcMain.handle('home:open-path',(_event,file)=>{opened=file;});await handlers.get('home:open-path')({},virtual(['sample.docx']));assert.equal(opened,path.join(root,'sample.docx'));
    ipcMain.handle('home:folder-delete',()=>{throw new Error('virtual path reached native deletion');});await handlers.get('home:folder-delete')({},ROOT);
    ipcMain.handle('home:move-paths',()=>{throw new Error('virtual source reached native move');});await handlers.get('home:move-paths')({},[virtual(['sample.docx'])],path.join(root,'destination'));
  }finally{app.emit('will-quit');await bridge.service?.close();fs.rmSync(root,{recursive:true,force:true});}
});
