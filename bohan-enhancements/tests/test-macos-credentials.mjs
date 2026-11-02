import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {test} from 'node:test';
const require = createRequire(import.meta.url);
const {save, read} = require('../webdav/credentials-darwin.cjs');
const key = crypto.randomBytes(32);
const safeStorage = {isEncryptionAvailable:()=>true,
  encryptString(value) {const iv=crypto.randomBytes(12), c=crypto.createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]);},
  decryptString(value) {const c=crypto.createDecipheriv('aes-256-gcm',key,value.subarray(0,12));c.setAuthTag(value.subarray(12,28));return Buffer.concat([c.update(value.subarray(28)),c.final()]).toString('utf8');}};
test('macOS setup stores ciphertext separately and preserves folder exclusions', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bohan-mac-'));
  try {
    fs.writeFileSync(path.join(root,'webdav-config.json'),JSON.stringify({excludedDirectories:['/private/excluded']}));
    const value={endpoint:'https://example.com/dav/',username:'fictional-user',password:'fictional-secret-'+crypto.randomUUID()};
    const config=save(safeStorage,root,value);
    assert.deepEqual(config.excludedDirectories,['/private/excluded']);
    assert.deepEqual(read(safeStorage,root),value);
    for(const name of fs.readdirSync(root)) {
      const p=path.join(root,name);assert.equal(fs.statSync(p).mode&0o777,0o600);
      assert.equal(fs.readFileSync(p).includes(Buffer.from(value.password)),false);
    }
    assert.equal('password' in config,false);
    assert.throws(()=>save(safeStorage,root,{...value,password:''}));
    assert.throws(()=>save(safeStorage,root,{...value,endpoint:'http://example.com/'}));
    assert.throws(()=>save(safeStorage,root,{...value,endpoint:'https://user:secret@example.com/'}));
    assert.deepEqual(read(safeStorage,root),value);
    const unavailable={...safeStorage,isEncryptionAvailable:()=>false};
    assert.throws(()=>save(unavailable,root,value),/keychain-unavailable/);
    assert.throws(()=>read(unavailable,root),/keychain-unavailable/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
