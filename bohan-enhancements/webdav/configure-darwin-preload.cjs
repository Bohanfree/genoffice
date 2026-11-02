'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('webdavSetup', {save:value => ipcRenderer.invoke('bohan:mac-webdav-setup', value)});
