import { THEMES, buildStyleMatrix, validatePreset, measureLayout } from './wps-table-beautify-core.mjs';

let activeDialog = null;
const make = (tag, props = {}, text) => {
  const el = document.createElement(tag);
  Object.assign(el, props);
  if (text !== undefined) el.textContent = text;
  return el;
};
const STYLES = `
.wps-beautify-overlay{position:fixed;inset:0;z-index:100000;background:#0005;display:flex;align-items:center;justify-content:center;font:13px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#232a35}
.wps-beautify-dialog{background:#fff;border-radius:12px;box-shadow:0 20px 80px #0005;width:min(940px,94vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden}
.wps-beautify-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #e5e7eb}.wps-beautify-head h2{font-size:18px;margin:0}.wps-beautify-close{font-size:24px;border:0;background:transparent;color:#667085;cursor:pointer}
.wps-beautify-main{display:grid;grid-template-columns:1fr 240px;min-height:350px;overflow:auto}.wps-beautify-gallery{padding:18px;display:grid;grid-template-columns:repeat(3,minmax(140px,1fr));gap:12px;align-content:start;max-height:55vh;overflow:auto}.wps-beautify-card{padding:8px;border:2px solid transparent;background:#f7f8fa;border-radius:7px;text-align:left;cursor:pointer;color:inherit}.wps-beautify-card[aria-pressed=true]{border-color:#526ee8;background:#eef2ff}.wps-beautify-card>span{display:block;font-size:12px;margin-top:6px}.wps-beautify-card table{width:100%;table-layout:fixed;border-collapse:collapse;background:white}.wps-beautify-card td{height:14px;font-size:6px;line-height:10px;text-align:center;overflow:hidden;padding:0}
.wps-beautify-options{padding:20px 18px;border-left:1px solid #e5e7eb;background:#fafbfc}.wps-beautify-label{display:block;margin:0 0 7px;font-weight:500}.wps-beautify-field{width:100%;box-sizing:border-box;background:#fff;border:1px solid #d1d5db;border-radius:5px;padding:7px;margin-bottom:18px;color:inherit}.wps-beautify-themes{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}.wps-beautify-theme{width:22px;height:22px;border:2px solid #fff;border-radius:50%;outline:1px solid #d1d5db;cursor:pointer}.wps-beautify-theme[aria-pressed=true]{outline:2px solid #526ee8}.wps-beautify-check{display:flex;gap:8px;align-items:center;margin:0 0 16px}.wps-beautify-note{font-size:12px;line-height:1.6;color:#667085}.wps-beautify-footer{padding:14px 22px;display:flex;gap:10px;align-items:center;border-top:1px solid #e5e7eb}.wps-beautify-status{flex:1;min-width:0;font-size:12px;color:#667085}.wps-beautify-action{border:1px solid #d1d5db;border-radius:6px;background:#fff;padding:8px 20px;cursor:pointer;color:#232a35}.wps-beautify-action.primary{background:#526ee8;border-color:#526ee8;color:#fff}.wps-beautify-action:disabled{opacity:.45;cursor:default}
@media(max-width:720px){.wps-beautify-main{grid-template-columns:1fr}.wps-beautify-options{border-left:0;border-top:1px solid #e5e7eb}.wps-beautify-gallery{grid-template-columns:repeat(2,1fr);max-height:36vh}}
`;
function preview(preset, options) {
  const table = make('table', { ariaHidden: 'true' });
  const matrix = buildStyleMatrix(preset, 6, 5, options);
  matrix.forEach((row, r) => {
    const tr = make('tr');
    row.forEach(({ s }, c) => {
      const td = make('td', {}, r === 0 ? ['序号','项目','数量','单价','金额'][c] : String((r + 1) * (c + 1)));
      td.style.background = s.bg?.rgb ?? '#fff';
      td.style.color = s.cl?.rgb ?? '#222';
      td.style.fontWeight = s.bl ? 'bold' : 'normal';
      for (const [side, edge] of Object.entries(s.bd ?? {})) {
        const cssSide = { t:'Top', b:'Bottom', l:'Left', r:'Right' }[side];
        if (cssSide && edge?.s) td.style['border' + cssSide] = `${edge.s === 13 ? 2 : 1}px ${edge.s === 3 ? 'dotted' : edge.s === 4 ? 'dashed' : 'solid'} ${edge.cl?.rgb ?? '#000'}`;
      }
      tr.append(td);
    });
    table.append(tr);
  });
  return table;
}
export async function openWpsTableBeautify(bridge) {
  if (activeDialog) { activeDialog.focus(); return; }
  let data;
  try {
    const response = await fetch(new URL('./wps-presets.json', import.meta.url));
    if (!response.ok) throw new Error('样式加载失败');
    data = await response.json();
  } catch (error) { bridge.notify(error.message); return; }
  const presets = (Array.isArray(data) ? data : data.presets ?? []).filter(validatePreset);
  if (!presets.length) { bridge.notify('WPS 样式数据尚未就绪'); return; }
  let initial;
  try { initial = await bridge.inspect(); } catch (error) { bridge.notify(error.message); return; }
  const overlay = make('div', { className:'wps-beautify-overlay' });
  const dialog = make('section', { className:'wps-beautify-dialog', tabIndex:-1 });
  dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-label','表格美化');
  activeDialog = dialog;
  const style = make('style', {}, STYLES);
  const header = make('header', { className:'wps-beautify-head' });
  const closeButton = make('button', { className:'wps-beautify-close', type:'button', ariaLabel:'关闭' }, '×');
  header.append(make('h2', {}, '表格美化'), closeButton);
  const main = make('div', { className:'wps-beautify-main' });
  const gallery = make('div', { className:'wps-beautify-gallery' });
  const options = make('div', { className:'wps-beautify-options' });
  const range = make('input', { className:'wps-beautify-field', value:initial.range, type:'text', ariaLabel:'应用范围' });
  const headers = make('select', { className:'wps-beautify-field', ariaLabel:'标题行数' });
  for (let i=0;i<=5;i++) headers.append(make('option',{value:String(i), selected:i===1}, `${i} 行`));
  const layout=make('select',{className:'wps-beautify-field',ariaLabel:'排版方式'});
  for(const [value,name]of [['preserve','保持原尺寸'],['compact','紧凑'],['medium','适中'],['loose','宽松'],['fit','适屏']])layout.append(make('option',{value},name));
  const colors = make('div', { className:'wps-beautify-themes' });
  let themeColor = presets[0].themeColor ?? '#4F81BD', selected = presets[0], busy = false;
  const banded = make('input',{type:'checkbox',checked:true});
  const label = (text, field) => { const l = make('label',{className:'wps-beautify-label'},text); if(field) { field.id = 'wps-beautify-'+text; l.htmlFor=field.id; } options.append(l); };
  label('应用范围',range); options.append(range);
  label('主题颜色'); options.append(colors);
  label('标题行数',headers); options.append(headers);
  label('排版方式',layout);options.append(layout);
  const check = make('label',{className:'wps-beautify-check'}); check.append(banded,make('span',{},'隔行底色')); options.append(check);
  options.append(make('p',{className:'wps-beautify-note'},'默认保留尺寸和对齐。自适应排版按内容调整列宽与换行行高，使用 WPS 实测字体和行距。支持保存前一次撤销。'));
  main.append(gallery, options);
  const footer = make('footer',{className:'wps-beautify-footer'});
  const status = make('span',{className:'wps-beautify-status'},`${initial.sheet} · ${initial.range}`);
  status.setAttribute('role','status');
  const cancel = make('button',{className:'wps-beautify-action',type:'button'},'取消');
  const apply = make('button',{className:'wps-beautify-action primary',type:'button'},'应用');
  footer.append(status,cancel,apply); dialog.append(header,main,footer);overlay.append(style,dialog);
  const previousFocus=document.activeElement;
  const close=()=>{if(busy)return;overlay.remove();activeDialog=null;document.removeEventListener('keydown',keys,true);if(previousFocus?.isConnected)previousFocus.focus();};
  const keys=(event)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}else if(event.key==='Tab'){const items=[...dialog.querySelectorAll('button,input,select')].filter(el=>!el.disabled);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
  const currentOptions=()=>({headerRows:Number(headers.value),bandedRows:banded.checked,themeColor,layout:layout.value});
  const render=()=>{
    gallery.replaceChildren();
    for(const preset of presets){const card=make('button',{className:'wps-beautify-card',type:'button',ariaLabel:preset.name});card.setAttribute('aria-pressed',String(preset.id===selected.id));card.append(preview(preset,currentOptions()),make('span',{},preset.name));card.onclick=()=>{selected=preset;render();};gallery.append(card);}
    for(const button of colors.children)button.setAttribute('aria-pressed',String(button.dataset.color===themeColor));
  };
  for(const [name,color]of THEMES){const button=make('button',{className:'wps-beautify-theme',type:'button',title:name,ariaLabel:name});button.style.background=color;button.dataset.color=color;button.onclick=()=>{themeColor=color;render();};colors.append(button);}
  headers.onchange=banded.onchange=layout.onchange=render;
  range.oninput=()=>{apply.disabled=busy||!range.value.trim();};
  apply.onclick=async()=>{
    if(busy)return;busy=true;apply.disabled=cancel.disabled=closeButton.disabled=true;status.textContent='正在应用…';
    try{await bridge.apply({range:range.value,preset:selected,options:currentOptions(),buildStyleMatrix,measureLayout});busy=false;close();}
    catch(error){status.textContent=error.message;busy=false;apply.disabled=!range.value.trim();cancel.disabled=closeButton.disabled=false;}
  };
  closeButton.onclick=cancel.onclick=close;overlay.onmousedown=(event)=>{if(event.target===overlay)close();};
  document.addEventListener('keydown',keys,true);document.body.append(overlay);render();dialog.focus();
}
