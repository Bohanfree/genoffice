'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DEFAULT_ENDPOINT = 'https://webdav.bohan.xin/%E5%90%8C%E6%AD%A5%E7%A9%BA%E9%97%B4/009GenOffice/';

function endpoint(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('invalid-endpoint');
  return u.href.endsWith('/') ? u.href : u.href + '/';
}
function writePrivate(file, bytes) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, bytes, {mode:0o600, flag:'wx'});
    fs.renameSync(temporary, file);
    fs.chmodSync(file, 0o600);
  } finally { fs.rmSync(temporary, {force:true}); }
}
function read(safeStorage, userData) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('keychain-unavailable');
  const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(userData, 'webdav-credential.bin'))));
  if (typeof value.username !== 'string' || !value.username || typeof value.password !== 'string' || !value.password || endpoint(value.endpoint) !== value.endpoint) throw new Error('invalid-credential');
  return value;
}
function save(safeStorage, userData, value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('keychain-unavailable');
  if (typeof value.username !== 'string' || !value.username.trim() || value.username.length > 512 || typeof value.password !== 'string' || !value.password || value.password.length > 16384) throw new Error('invalid-credential');
  const target = endpoint(value.endpoint);
  const file = path.join(userData, 'webdav-config.json');
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const config = {schema:1, endpoint:target, username:value.username.trim(), credentialTarget:'GenOffice/WebDAV/'+new URL(target).host,
    automaticUploadEnabled:true, excludedDirectories:old.excludedDirectories || [], maxFileBytes:536870912, maxQueueBytes:2147483648};
  // Store only safeStorage ciphertext in a separate private file. The key is
  // managed by Electron's macOS Keychain backend; no password enters argv/logs.
  writePrivate(path.join(userData, 'webdav-credential.bin'), safeStorage.encryptString(JSON.stringify({endpoint:target, username:config.username, password:value.password})));
  writePrivate(file, JSON.stringify(config, null, 2)+'\n');
  return config;
}

let setupWindow;
function configure({app, BrowserWindow, ipcMain, safeStorage, dialog}, userData) {
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.focus(); return; }
  const configFile = path.join(userData, 'webdav-config.json');
  let old = {};
  try { old = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch {}
  const channel = 'bohan:mac-webdav-setup';
  const win = setupWindow = new BrowserWindow({title:'配置 WebDAV 云文档', width:600, height:560, resizable:false,
    minimizable:false, maximizable:false, webPreferences:{preload:path.join(__dirname,'configure-darwin-preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:true}});
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  const listener = async (event, value) => {
    if (event.sender !== win.webContents || !event.senderFrame || event.senderFrame !== win.webContents.mainFrame) throw new Error('unauthorized');
    try {
      if (!value || value.enable !== true) throw new Error('not-enabled');
      save(safeStorage, userData, value);
      // The form always starts with an empty password, including reconfiguration.
      void dialog.showMessageBox(win, {type:'info',message:'配置已保存', detail:'请重新启动 GenOffice，启用 WebDAV 云文档与自动同步。密码已使用本机钥匙串保护的加密方式保存。'}).then(() => win.close());
      return {ok:true};
    } catch { return {ok:false, message:'配置未保存，请核对账号、密码和 HTTPS 文件夹地址，并确认本机钥匙串可用。'}; }
  };
  ipcMain.handle(channel, listener);
  win.on('closed', () => {ipcMain.removeHandler(channel); setupWindow = undefined;});
  const initial = {endpoint:old.endpoint || DEFAULT_ENDPOINT, username:old.username || ''};
  void win.loadFile(path.join(__dirname, 'configure-darwin.html'), {query:{initial:JSON.stringify(initial)}});
}
module.exports = {read, save, configure, endpoint};
