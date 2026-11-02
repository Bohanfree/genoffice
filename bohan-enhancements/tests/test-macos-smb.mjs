import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
const source=fs.readFileSync(process.env.BOHAN_MACOS_MAIN,'utf8');
const start=source.indexOf('    const archiveRequest = {');
assert.ok(start>0);
const end=source.indexOf('    if (!manifestsEqual(manifest, result.beforeEntries))',start);
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const execute=new AsyncFunction('request2','temporaryTarget','replacements','plan','additions','process','path','workDir','saveArchiveResultSchema','promises','manifestResultSchema','manifestsEqual',source.slice(start,end)+'return result;');
async function scenario({platform='darwin',error='Operation not supported (os error 45)',copyValid=true}={}) {
  const calls=[];
  const result={beforeEntries:['before'],afterEntries:['after']};
  const request={sourcePath:'/source.xlsx',client:{
    async saveArchive(value){calls.push(['save',value.targetPath]);if(calls.length===1)throw new Error(error);return result;},
    async archiveManifest(value){calls.push(['manifest',value]);return {entries:copyValid?['after']:['corrupt']};}}};
  const promises={async copyFile(a,b){calls.push(['copy',a,b]);}};
  const promise=execute(request,'/share/file.tmp',[],{removedEntries:[]},[],{platform},path,'/local/work',{parse:v=>v},promises,{parse:v=>v},(a,b)=>JSON.stringify(a)===JSON.stringify(b));
  return {promise,calls,result};
}
test('shipped macOS 446 host retries error 45 locally, validates shared copy before promotion',async()=>{
  const {promise,calls,result}=await scenario();assert.deepEqual(await promise,result);
  assert.deepEqual(calls.map(c=>c[0]),['save','save','copy','manifest']);
  assert.equal(calls[1][1],'/local/work/smb-save-fallback.xlsx');
});
test('shipped macOS 446 host rejects corrupted copy and unrelated failures',async()=>{
  const bad=await scenario({copyValid:false});await assert.rejects(bad.promise,/copy failed validation/);
  for(const options of [{platform:'win32'},{error:'permission denied'}]){
    const run=await scenario(options);await assert.rejects(run.promise);assert.equal(run.calls.length,1);
  }
  assert.match(source,/const RETRYABLE_RENAME_CODES = .*"EAGAIN"/);
});
