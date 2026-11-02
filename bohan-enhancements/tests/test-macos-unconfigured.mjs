import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

test('unconfigured cloud refresh stays quiet and explicit actions open setup', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const generated = spawnSync('python3', ['-c', 'import sys; import stage_macos; sys.stdout.buffer.write(stage_macos.bootstrap_bytes())'], {cwd:root, encoding:'utf8'});
  assert.equal(generated.status, 0, generated.stderr);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bohan-unconfigured-'));
  const filename = path.join(root, 'webdav/bootstrap.cjs');
  const nativeRequire = createRequire(filename);
  const handlers = new Map();
  let configured = 0, errors = 0;
  const electron = {
    app:{on(){}, whenReady:()=>Promise.resolve(), getPath:()=>profile},
    ipcMain:{handle(channel,fn){handlers.set(channel,fn)}, on(){}},
    Menu:{setApplicationMenu(){}}, MenuItem:class {},
    dialog:{async showMessageBox(){errors++; return {response:0}}},
    BrowserWindow:{getAllWindows:()=>[]}, shell:{},
  };
  const moduleObject = {exports:{}};
  const localRequire = name => name === 'electron' ? electron : name === './credentials-darwin.cjs' ? {configure(){configured++}} : nativeRequire(name);
  try {
    vm.runInNewContext(generated.stdout, {require:localRequire, module:moduleObject, __dirname:path.dirname(filename), process, console, Buffer, Map, Set, Date});
    moduleObject.exports.install(electron);
    electron.ipcMain.handle('home:folder-list', async()=>{throw new Error('virtual path reached local folder IO')});
    electron.ipcMain.handle('home:open-path', async()=>{throw new Error('virtual path opened locally')});
    for (let i=0; i<8; i++) {
      const result = await handlers.get('home:folder-list')({}, 'webdav://genoffice/');
      assert.equal(result.missing, true);
      assert.equal(result.files.length, 0);
    }
    assert.equal(errors, 0);
    await handlers.get('bohan:cloud-sync')();
    assert.equal(configured, 1);
    await handlers.get('home:open-path')({}, 'webdav://genoffice/sample.docx');
    assert.equal(configured, 2);
    assert.equal(errors, 0);
  } finally {fs.rmSync(profile, {recursive:true, force:true});}
});
