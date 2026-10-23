import {chooseFonts,makePlan,ROLE_NAMES} from './official-typeset-core.mjs';

// Only explicit clicks can change the document. All source text is rendered as textContent.
export function openOfficialDialog({blocks,fontFamilies=[],canUndo=false,onApply,onUndo}) {
  const existing=document.getElementById('genoffice-official-typeset');
  if(existing){existing.focus();return;}
  const known=new Set(fontFamilies.map(x=>x.toLowerCase()));
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const hasFont=name=>{
    if(known.size)return known.has(name.toLowerCase());
    const sample='公文排版通知一二三 abc 012';
    return ['monospace','serif','sans-serif'].some(base=>{
      ctx.font=`72px ${base}`;const width=ctx.measureText(sample).width;
      ctx.font=`72px ${JSON.stringify(name)}, ${base}`;return Math.abs(ctx.measureText(sample).width-width)>.1;
    });
  };
  const {fonts,substitutions}=chooseFonts(hasFont),overrides={};
  const initial=makePlan(blocks,{fonts});
  const priorFocus=document.activeElement;
  const root=document.createElement('div');root.id='genoffice-official-typeset';
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','official-title');root.tabIndex=-1;
  const style=document.createElement('style');
  style.textContent=`#genoffice-official-typeset{position:fixed;inset:0;z-index:2147483000;background:#0007;display:flex;align-items:center;justify-content:center;font:14px -apple-system,BlinkMacSystemFont,sans-serif;color:#202737}#genoffice-official-typeset *{box-sizing:border-box}#genoffice-official-typeset .official-panel{width:min(850px,94vw);max-height:90vh;background:#fff;border:1px solid #d9dfea;border-radius:16px;box-shadow:0 24px 90px #0004;display:flex;flex-direction:column;overflow:hidden}#genoffice-official-typeset h2{font-size:22px;margin:0 0 8px}#genoffice-official-typeset .official-head{padding:24px 28px 16px;background:#f7f9fc;border-bottom:1px solid #e4e8ef}#genoffice-official-typeset p{margin:6px 0;line-height:1.6}#genoffice-official-typeset .official-content{padding:18px 28px;overflow:auto}#genoffice-official-typeset .official-fonts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0 18px}#genoffice-official-typeset label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#596477}#genoffice-official-typeset input,#genoffice-official-typeset select{padding:7px 9px;border:1px solid #ccd4df;border-radius:6px;background:#fff;color:#202737;font:13px -apple-system,sans-serif;min-width:0}#genoffice-official-typeset table{width:100%;border-collapse:collapse;table-layout:fixed}#genoffice-official-typeset td,#genoffice-official-typeset th{padding:9px 8px;border-bottom:1px solid #edf0f5;text-align:left;vertical-align:top;font-size:13px;line-height:1.6}#genoffice-official-typeset th{color:#677285;font-weight:500}#genoffice-official-typeset .official-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:85px;overflow:auto}#genoffice-official-typeset .official-footer{padding:16px 28px;border-top:1px solid #e4e8ef;display:flex;gap:10px;justify-content:flex-end;background:#f7f9fc}#genoffice-official-typeset button{padding:9px 16px;border:1px solid #cbd4e2;border-radius:7px;background:#fff;color:#33425a;font:14px -apple-system,sans-serif;cursor:pointer}#genoffice-official-typeset button.official-primary{background:#3b5bea;color:#fff;border-color:#3b5bea}#genoffice-official-typeset .official-note{font-size:12px;color:#69758a}#genoffice-official-typeset .official-error{color:#b02c38;white-space:pre-wrap}#genoffice-official-typeset button:focus-visible,#genoffice-official-typeset select:focus-visible,#genoffice-official-typeset input:focus-visible{outline:3px solid #a4b4ff;outline-offset:2px}`;
  root.append(style);
  const el=(tag,text,parent,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;parent?.append(e);return e;};
  const panel=el('div',undefined,root,'official-panel'),head=el('div',undefined,panel,'official-head');
  const title=el('h2','公文排版',head);title.id='official-title';
  el('p','检查段落类型后应用，原文文字和编号保持不变。',head);
  el('p','A4 纵向 · 上37 / 下35 / 左28 / 右26毫米 · 正文三号 · 固定28磅行距',head,'official-note');
  const content=el('div',undefined,panel,'official-content');
  el('p','标题二号居中；正文首行缩进2字符；机关署名与日期右对齐。表格、图片与自动列表保留原结构。',content,'official-note');
  const fontBox=el('div',undefined,content,'official-fonts'),inputs={};
  for(const [key,name] of Object.entries({title:'标题字体',body:'正文字体',heading1:'一级标题字体',heading2:'二级标题字体',latin:'西文字体'})){
    const label=el('label',name,fontBox),input=el('input',undefined,label);input.value=fonts[key];input.setAttribute('aria-label',name);inputs[key]=input;
  }
  if(substitutions.length)el('p','本机字体替代：'+substitutions.map(x=>`${x.requested} → ${x.actual}`).join('；'),content,'official-note');
  const table=el('table',undefined,content),thead=el('thead',undefined,table),tr=el('tr',undefined,thead);
  for(const [name,width] of [['段落','7%'],['原文','70%'],['类型','23%']]){const h=el('th',name,tr);h.style.width=width;}
  const body=el('tbody',undefined,table);
  for(const b of initial.entries){
    const row=el('tr',undefined,body);el('td',String(b.index+1),row);
    const cell=el('td',undefined,row);el('div',b.text||(b.role==='skip'?'[保留对象]':'[空段落]'),cell,'official-text');
    const control=el('td',undefined,row),select=el('select',undefined,control);select.setAttribute('aria-label',`第${b.index+1}段类型`);
    for(const [key,label] of Object.entries(ROLE_NAMES)){
      const option=el('option',label,select);option.value=key;
    }
    select.value=b.role;if(b.role==='skip')select.disabled=true;
    select.onchange=()=>{overrides[b.index]=select.value;};
  }
  const error=el('p','',content,'official-error');error.setAttribute('role','alert');
  const footer=el('div',undefined,panel,'official-footer');
  const close=()=>{root.remove();if(priorFocus?.isConnected)priorFocus.focus();};
  const run=fn=>{try{fn();close();}catch(e){error.textContent=e.message||String(e);error.scrollIntoView({block:'nearest'});}};
  if(canUndo){const undo=el('button','撤回上次排版',footer);undo.style.marginRight='auto';undo.onclick=()=>run(onUndo);}
  const cancel=el('button','取消',footer);cancel.onclick=close;
  const apply=el('button','应用公文排版',footer,'official-primary');
  apply.onclick=()=>run(()=>{
    const picked=Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value.trim()]));
    for(const font of Object.values(picked))if(!hasFont(font))throw new Error(`本机未检测到字体“${font}”，请选用已安装字体。`);
    onApply(makePlan(blocks,{fonts:picked,overrides}));
  });
  root.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    if(e.key==='Tab'){
      const items=[...root.querySelectorAll('button,input,select')].filter(x=>!x.disabled);
      const first=items[0],last=items.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  document.body.append(root);cancel.focus();
}
