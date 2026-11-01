import assert from 'node:assert/strict';
import {createFontResolver,openOfficialDialog} from '../official/official-typeset-ui.mjs';

assert.equal(createFontResolver(['FZXiaoBiaoSong-B05S'])('方正小标宋简体'),'FZXiaoBiaoSong-B05S');
assert.equal(createFontResolver(['方正小标宋简体'])('FZXiaoBiaoSong-B05S'),'方正小标宋简体');
assert.equal(createFontResolver(['Arial'])('方正小标宋简体'),null);
assert.equal(createFontResolver(['Arial'])('Completely missing font'),null);
assert.equal(createFontResolver([],name=>name==='FZXiaoBiaoSong-B05S')('方正小标宋简体'),'FZXiaoBiaoSong-B05S');

// Reproduce the dialog: Chromium supplies English families, while the requested
// Chinese title name remains visible. Applying must use the installed family.
const nodes=[];
function element(tag){
 const node={tag,children:[],style:{},isConnected:true,append(...items){this.children.push(...items);},
  setAttribute(k,v){this[k]=v;},addEventListener(){},focus(){},scrollIntoView(){},
  remove(){this.removed=true;},getContext(){return {};}};
 nodes.push(node);return node;
}
globalThis.document={getElementById:()=>null,createElement:element,body:element('body'),activeElement:null};
let applied;
openOfficialDialog({blocks:[{index:0,type:'paragraph',text:'关于开展工作的通知'}],
 fontFamilies:['FZXiaoBiaoSong-B05S','FangSong','SimHei','KaiTi','Times New Roman'],onApply:plan=>applied=plan});
assert.equal(nodes.find(n=>n['aria-label']==='标题字体').value,'方正小标宋简体');
nodes.find(n=>n.tag==='button'&&n.textContent==='应用公文排版').onclick();
assert.ok(applied,'Localized family must not be falsely rejected');
assert.ok(JSON.stringify(applied).includes('FZXiaoBiaoSong-B05S'));
assert.ok(nodes.find(n=>n.id==='genoffice-official-typeset').removed);
applied=null;nodes.length=0;
openOfficialDialog({blocks:[{index:0,type:'paragraph',text:'关于开展工作的通知'}],fontFamilies:['Arial'],onApply:plan=>applied=plan});
nodes.find(n=>n.tag==='button'&&n.textContent==='应用公文排版').onclick();
assert.equal(applied,null,'Truly missing fonts must still block application');
assert.ok(nodes.find(n=>n.role==='alert').textContent.includes('本机未检测到字体'));
delete globalThis.document;
console.log('PASS: localized font aliases apply the actual installed family; missing fonts still rejected.');
