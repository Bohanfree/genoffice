'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { BackupQueue, atomicJson, inside } = require('./queue.cjs');
const { DavClient } = require('./client.cjs');
const { createHooks } = require('./hooks.cjs');
const { CloudService, ROOT, keyFor } = require('./cloud.cjs');
const execFileAsync = promisify(execFile);

function install({ app, ipcMain, Menu, MenuItem, dialog, BrowserWindow, shell }) {
  let service, cloud, host, config, configFile, startupError, flushing = false;
  const pending = new Map(), current = new Map();
  const observe = (id, file, reason) => {
    current.set(id, file);
    if (service && !(cloud && file.includes(path.sep+'version-copies'+path.sep))) void service.enqueue(file, reason).catch(() => {});
  };
  const completed = createHooks({ observe, pending });
  const originalHandle = ipcMain.handle.bind(ipcMain);
  const relevant = /^(docs:(open|open-path|open-decrypt|consume-pending-open|save|save-as|save-new|save-to)|pdf:(read-file|save)|slides:(open|open-path|consume-pending-open|save|save-as)|markdown:(read-file|save)|html:(read-file|save))$/;
  ipcMain.handle = function(channel, listener) {
    if (channel.startsWith('home:')) return originalHandle(channel,async function(event,...args) {
      if(cloud && ['home:recents','home:starred'].includes(channel)) {
        const result=await listener.call(this,event,...args);
        return {...result,entries:result.entries.map(entry=>({...entry,cloudDocument:
          typeof entry.path==='string' && inside(entry.path,cloud.root) && !!service.state.documents[keyFor(entry.path)]?.remotePath}))};
      }
      if(channel==='home:folder-roots') {
        const roots=await listener.call(this,event,...args);return cloud ? [...roots,cloud.rootEntry()] : roots;
      }
      const remote=args.some(v=>typeof v==='string' && v.startsWith(ROOT));
      if(channel==='home:folder-list' && remote) {
        try {return await cloud.list(args[0]);}catch(e) {await showError(e);return {dir:args[0],folders:[],files:[],missing:true};}
      }
      if(channel==='home:open-path' && remote) {
        try {return await listener.call(this,event,await cloud.open(args[0]));} catch(e) {await showError(e);return;}
      }
      // Virtual entries must never reach native rename/delete/move/star handlers.
      if(remote || args.some(v=>Array.isArray(v) && v.some(p=>typeof p==='string' && p.startsWith(ROOT)))) return;
      if(channel==='home:open-path' && cloud && typeof args[0]==='string') {
        const doc=service.state.documents[keyFor(args[0])];
        if(doc?.hasRemote) {try {await cloud.open(ROOT+(doc.remotePath || [doc.remoteName]).map(encodeURIComponent).join('/'));}catch(e) {await showError(e);return;}}
      }
      return listener.call(this,event,...args);
    });
    if (!relevant.test(channel)) return originalHandle(channel, listener);
    return originalHandle(channel, async function(event, ...args) {
      const result = await listener.call(this, event, ...args);
      try { completed(channel, event, args, result); } catch {}
      return result;
    });
  };
  ipcMain.on('bohan:webdav-opened', (event, acceptedPath) => {
    const candidate = pending.get(event.sender.id);
    if (!candidate || typeof acceptedPath !== 'string' || candidate.path !== acceptedPath) return;
    pending.delete(event.sender.id); observe(event.sender.id, candidate.path, 'open');
  });
  app.on('web-contents-created', (_event, wc) => wc.once('destroyed', () => { pending.delete(wc.id); current.delete(wc.id); }));
  const saveConfig = () => { atomicJson(configFile, config); service.config = config; };
  const showError = e => dialog.showMessageBox({type:'warning',title:'WebDAV 云文档',message:({
    'close-document-or-resolve-pending':'请先关闭文档，并等待待传文件完成后再操作。',
    'local-unsynced':'本地还有尚未同步的修改，已保留，请先完成同步。',
    'not-synced':'此文件尚未同步到 WebDAV。',
    'cloud-sync-paused':'请先恢复 WebDAV 自动同步。',
    'remote-missing':'云端文件已移走或删除，本地副本仍保留。',
    'restored-in-cloud-local-changed':'云端已恢复。操作期间本地发生变化，本地内容已保留，请重新同步。'
  })[e.code || e.message] || '操作未完成，本地文件与待传副本已保留。请检查网络、账号和同步状态。'});
  const changed = () => {
    for(const win of BrowserWindow.getAllWindows()) if(!win.isDestroyed()) win.webContents.send('home:folder-changed',[...(cloud?.viewed || [ROOT])]);
  };
  const history = async value => {
    if(!cloud || typeof value!=='string' || value.length>4096) return;
    try {
      const parts=cloud.resolvePath(value);let versions=await cloud.client.versions(parts);
      if(!versions.length) {
        const head=cloud.client.check(await cloud.client.request('HEAD',cloud.client.url(parts)),[200]);
        await cloud.client.archiveRemote(parts,head.etag);versions=await cloud.client.versions(parts);
      }
      if(!versions.length) return dialog.showMessageBox({title:'历史版本',message:'此文档还没有历史版本。首次同步后会自动保留。'});
      let page=0;
      for(;;) {
        const batch=versions.slice(page*6,page*6+6), buttons=batch.map(v=>`${new Date(v.time).toLocaleString('zh-CN')} · ${v.sizeBytes} 字节`);
        const prev=buttons.length;buttons.push('上一页');const next=buttons.length;buttons.push('下一页');const cancel=buttons.length;buttons.push('关闭');
        const r=await dialog.showMessageBox({title:'历史版本',message:parts.at(-1),detail:`共 ${versions.length} 个版本 · 第 ${page+1} 页。选择版本后可打开副本或恢复。`,buttons,cancelId:cancel,defaultId:cancel});
        if(r.response===cancel) return;
        if(r.response===prev) {page=Math.max(0,page-1);continue;}
        if(r.response===next) {page=Math.min(Math.floor((versions.length-1)/6),page+1);continue;}
        const version=batch[r.response];if(!version)return;
        const choice=await dialog.showMessageBox({title:'历史版本',message:new Date(version.time).toLocaleString('zh-CN'),
          detail:'恢复前会保留当前云端版本。恢复需要先关闭文档，并完成待传文件。',buttons:['打开副本','恢复此版本','取消'],defaultId:0,cancelId:2});
        if(choice.response===0) {const copy=await cloud.versionCopy(parts,version);host?.open(copy);return;}
        if(choice.response===1) {await cloud.restore(parts,version);return dialog.showMessageBox({message:'已恢复此版本，原云端内容已保留在历史版本中。'});}
      }
    } catch(e) {await showError(e);}
  };
  originalHandle('bohan:cloud-history',(_event,value)=>history(value));
  originalHandle('bohan:cloud-sync',async()=>{if(!cloud)return status();await cloud.sync();service.retry();changed();});
  originalHandle('bohan:cloud-conflict',async(_event,value)=>{
    if(!cloud || typeof value!=='string' || value.length>4096) return;
    try {await cloud.keepBoth(value);await dialog.showMessageBox({message:'已保留双方：云端版本保留原文件名，本地修改另存为冲突副本并继续同步。'});}catch(e) {await showError(e);}
  });
  const status = async () => {
    const s = service?.summary();
    const detail = s ? ['增强版 0.12.446.7 · 双向同步与历史版本', config.automaticUploadEnabled ? '自动同步已启用' : '自动同步已暂停',
      '主页“文件夹”可直接浏览 WebDAV。打开时检查更新，保存后上传，每 30 秒检查已关联文件。',
      '打开中的文件不自动覆盖，云端更新请关闭后重新打开。删除与重命名暂不自动传播。',
      ...Object.entries(service.state.documents).filter(([,d])=>d.remoteChanged || d.syncError).slice(0,10).map(([p,d])=>`${path.basename(p)}：${d.remoteChanged ? '云端有更新，请关闭后重新打开' : d.syncError}`),
      `排队 ${s.queued} · 上传中 ${s.uploading} · 已备份 ${s.backedUp} · 待重试 ${s.failed} · 冲突 ${s.conflict}`,
      ...s.tasks.slice(0, 10).map(t => `${t.name}：${({ queued:'排队', uploading:'上传中', failed:'等待重试', conflict:'冲突，远端版本已保留' })[t.status] || t.status}${t.error ? ' (' + t.error + ')' : ''}`),
      ...s.errors.map(e => `${e.name}：${e.code}`),
      ...s.pausedFiles.map(name => `已暂停：${name}`),
      ...(config.excludedDirectories || []).map(dir => `已排除：${dir}`),
      ...s.recent.slice(0, 5).map(e => `已备份：${e.remoteName || e.name}`),
      '本地原文件和恢复缓存保留。关闭 GenOffice 后，待传文件将在下次启动继续。'].join('\n') :
      startupError ? `备份未启动：${startupError}。请检查配置或重新配置。` : '尚未配置，请选择“配置 WebDAV”。';
    const r = await dialog.showMessageBox({ type:'info', title:'WebDAV 备份', message:'文件自动备份', detail,
      buttons:['关闭','立即重试','打开远端目录'], defaultId:0, cancelId:0 });
    if (r.response === 1) service?.retry();
    if (r.response === 2 && config?.endpoint) await shell.openExternal(config.endpoint);
  };
  const configure = () => {
    spawn(path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File',path.join(__dirname,'Configure-WebDAV.ps1'),'-UserData',app.getPath('userData')],
      { detached:true, stdio:'ignore', windowsHide:false }).unref();
  };
  const currentFile = () => {
    const focused = BrowserWindow.getFocusedWindow();
    const visible = focused?.contentView?.children?.filter(v => v.getVisible?.() === true)
      .map(v => current.get(v.webContents?.id)).filter(Boolean) || [];
    return visible.length === 1 ? visible[0] : current.get(focused?.webContents?.id);
  };
  const menuItem = () => new MenuItem({ id:'bohan-webdav',label:'WebDAV 云文档', submenu:[
    {label:'查看备份状态…',click:() => void status()},
    {label:'立即双向同步',click:() => {void cloud?.sync();service?.retry();}},
    {label:'当前文件历史版本…',click:() => {const file=currentFile();if(file)void history(file);}},
    {label:'立即重试待传文件',click:() => service?.retry()},
    {label:'暂停 / 恢复自动备份',click:() => {
      if (!service) return void status();
      config.automaticUploadEnabled = !config.automaticUploadEnabled; saveConfig();
      if (!config.automaticUploadEnabled) service.abort?.abort(); else void service.pump();
      void status();
    }},
    {label:'暂停 / 恢复当前文件',click:() => {
      const file = currentFile(); if (!file || !service) return void status();
      const key = process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
      service.pauseDocument(file, !service.state.documents[key]?.paused); void status();
    }},
    {label:'排除一个文件夹…',click:async () => {
      if (!service) return void status();
      const result = await dialog.showOpenDialog({title:'此文件夹下的文件不自动上传',properties:['openDirectory']});
      if (!result.canceled && result.filePaths[0]) { config.excludedDirectories ||= []; config.excludedDirectories.push(result.filePaths[0]); saveConfig(); service.abort?.abort(); }
    }},
    {label:'恢复一个已排除的文件夹…',click:async () => {
      const list = config?.excludedDirectories || [];
      if (!list.length) return void status();
      const r = await dialog.showMessageBox({message:'选择要恢复自动备份的文件夹',buttons:[...list,'取消'],cancelId:list.length});
      if (r.response < list.length) { config.excludedDirectories.splice(r.response,1); saveConfig(); void service.pump(); }
    }},
    {label:'配置 WebDAV（手动输入密码）…',click:configure},
  ]});
  const setMenu = Menu.setApplicationMenu.bind(Menu);
  Menu.setApplicationMenu = menu => { if (menu && !menu.getMenuItemById('bohan-webdav')) menu.append(menuItem()); return setMenu(menu); };
  app.whenReady().then(() => {
    configFile = path.join(app.getPath('userData'),'webdav-config.json');
    try {
      if (!fs.existsSync(configFile)) return;
      config = JSON.parse(fs.readFileSync(configFile,'utf8'));
      if (!config.credentialTarget?.startsWith('GenOffice/WebDAV/') || !config.username || 'password' in config) throw new Error('invalid-config');
      let cachedCredential, credentialExpires = 0;
      const client = new DavClient({ endpoint:config.endpoint, historyEnabled:true, credentials:async () => {
        if (cachedCredential && Date.now() < credentialExpires) return cachedCredential;
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
        try {
          const {stdout} = await execFileAsync(executable,['-NoProfile','-ExecutionPolicy','Bypass','-NonInteractive','-File',path.join(__dirname,'credentials.ps1'),'-Action','Read','-Target',config.credentialTarget],{windowsHide:true,timeout:20000,maxBuffer:32768,encoding:'utf8'});
          const value = JSON.parse(stdout.replace(/^\uFEFF/,''));
          if (value.username !== config.username) throw new Error();
          cachedCredential = value; credentialExpires = Date.now() + 60000; return value;
        } catch { const e = new Error('credential-unavailable'); e.code = 'credential-unavailable'; throw e; }
      }});
      service = new BackupQueue({root:path.join(app.getPath('userData'),'webdav-backup'),config,client});
      cloud=new CloudService({queue:service,client,root:path.join(app.getPath('userData'),'webdav-documents'),isOpen:file=>host?.isOpen(file) ?? true,onChange:changed});
      service.start();cloud.start();
    } catch { startupError = 'configuration-or-queue-error'; }
  }).catch(() => {});
  app.on('before-quit', event => {
    if (!service?.pendingCaptures || flushing) return;
    event.preventDefault(); flushing = true;
    void service.captureChain.finally(() => { flushing = false; app.quit(); });
  });
  // Do not stop the service at before-quit: an unsaved-document prompt may cancel quitting.
  app.on('will-quit', () => {cloud?.close(); if (service) { service.stopped = true; clearInterval(service.timer); service.abort?.abort(); } });
  return { observe, status, attach(callbacks) {host=callbacks;}, get service() { return service; },get cloud() {return cloud;} };
}
module.exports = { install };
