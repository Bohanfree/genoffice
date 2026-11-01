'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { BackupQueue, atomicJson } = require('./queue.cjs');
const { DavClient } = require('./client.cjs');
const { createHooks } = require('./hooks.cjs');
const execFileAsync = promisify(execFile);

function install({ app, ipcMain, Menu, MenuItem, dialog, BrowserWindow, shell }) {
  let service, config, configFile, startupError, flushing = false;
  const pending = new Map(), current = new Map();
  const observe = (id, file, reason) => {
    current.set(id, file);
    if (service) void service.enqueue(file, reason).catch(() => {});
  };
  const completed = createHooks({ observe, pending });
  const originalHandle = ipcMain.handle.bind(ipcMain);
  const relevant = /^(docs:(open|open-path|open-decrypt|consume-pending-open|save|save-as|save-new|save-to)|pdf:(read-file|save)|slides:(open|open-path|consume-pending-open|save|save-as)|markdown:(read-file|save)|html:(read-file|save))$/;
  ipcMain.handle = function(channel, listener) {
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
  const status = async () => {
    const s = service?.summary();
    const detail = s ? ['增强版 0.12.446.4 · 原文件名备份', config.automaticUploadEnabled ? '自动备份已启用' : '自动备份已暂停',
      '打开后备份，保存后更新同一份文档；同名文件自动加序号。',
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
  const menuItem = () => new MenuItem({ id:'bohan-webdav',label:'WebDAV 备份', submenu:[
    {label:'查看备份状态…',click:() => void status()},
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
      const client = new DavClient({ endpoint:config.endpoint, credentials:async () => {
        if (cachedCredential && Date.now() < credentialExpires) return cachedCredential;
        const executable = path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
        try {
          const {stdout} = await execFileAsync(executable,['-NoProfile','-ExecutionPolicy','Bypass','-NonInteractive','-File',path.join(__dirname,'credentials.ps1'),'-Action','Read','-Target',config.credentialTarget],{windowsHide:true,timeout:20000,maxBuffer:32768,encoding:'utf8'});
          const value = JSON.parse(stdout.replace(/^\uFEFF/,''));
          if (value.username !== config.username) throw new Error();
          cachedCredential = value; credentialExpires = Date.now() + 60000; return value;
        } catch { const e = new Error('credential-unavailable'); e.code = 'credential-unavailable'; throw e; }
      }});
      service = new BackupQueue({root:path.join(app.getPath('userData'),'webdav-backup'),config,client}); service.start();
    } catch { startupError = 'configuration-or-queue-error'; }
  }).catch(() => {});
  app.on('before-quit', event => {
    if (!service?.pendingCaptures || flushing) return;
    event.preventDefault(); flushing = true;
    void service.captureChain.finally(() => { flushing = false; app.quit(); });
  });
  // Do not stop the service at before-quit: an unsaved-document prompt may cancel quitting.
  app.on('will-quit', () => { if (service) { service.stopped = true; clearInterval(service.timer); service.abort?.abort(); } });
  return { observe, status, get service() { return service; } };
}
module.exports = { install };
