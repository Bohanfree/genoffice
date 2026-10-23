import {buildWordMatrix,mergedWordStyle,wordLayout} from './wps-word-table-core.mjs';
const equals=(a,b)=>JSON.stringify(a)===JSON.stringify(b),has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const cleanHex=v=>typeof v==='string'?v.replace(/^#/,''):v;
function locate(editor,h){
 const state=editor.state,sel=state.selection;
 if(sel.node?.type.name==='docTable')return {node:sel.node,pos:sel.from};
 return h.selectedTable(state);
}
function cellsOf(table,pos,h){
 const map=h.TableMap.get(table),seen=new Set(),cells=[];
 for(const relative of map.map){if(seen.has(relative))continue;seen.add(relative);const node=table.nodeAt(relative);if(!node||node.attrs.gridGap)continue;const rect=map.findCell(relative);let text='',fontSize,fontFamily,bold;
 node.descendants(child=>{if(child.isText){text+=child.text??'';const mark=child.marks.find(m=>m.type.name==='docTextStyle');fontSize??=mark?.attrs.sizeHalfPoints?mark.attrs.sizeHalfPoints/2:undefined;fontFamily??=mark?.attrs.eastAsiaFont??mark?.attrs.font??mark?.attrs.fontAscii;bold??=child.marks.some(m=>m.type.name==='bold');}else if(child.type.name==='docParagraph'||child.type.name==='docListItem'){if(text)text+='\n';}return !child.isAtom;});
 cells.push({relative,node,pos:pos+1+relative,rect,text,fontSize,fontFamily,bold});}
 return {map,cells};
}
function borders(value){if(value===null)return Object.fromEntries(['top','left','bottom','right'].map(s=>[s,{style:'none',szEighths:0,color:'auto'}]));return Object.fromEntries(Object.entries(value).map(([k,b])=>[k,b===null?{style:'none',szEighths:0,color:'auto'}:{...b,color:cleanHex(b.color)}]));}
function updateAttrs(tr,pos,patch){const node=tr.doc.nodeAt(pos);if(!node)return;const attrs={...node.attrs,...patch};if(!equals(node.attrs,attrs))tr.setNodeMarkup(pos,undefined,attrs);}
export function createWordTableBridge(editor,h){
 let token;
 return {
  notify:h.notify??(message=>h.showToast?.(message,'error')),
  inspect(){if(!editor?.isEditable)throw Error('请先进入可编辑文档');const found=locate(editor,h);if(!found)throw Error('请把光标放入需要美化的表格');const {map,cells}=cellsOf(found.node,found.pos,h);if(map.width*map.height>50000)throw Error('表格超过 50000 格');token={doc:editor.state.doc,node:found.node,pos:found.pos};return {range:`整张表格 · ${map.height} 行 × ${map.width} 列`,sheet:'Word 表格',height:map.height,width:map.width,cellCount:cells.length};},
  apply({preset,options}){
   if(!token)throw Error('请重新选择表格');if(!editor.isEditable)throw Error('文档已变为只读');if(editor.state.doc!==token.doc||editor.state.doc.nodeAt(token.pos)!==token.node)throw Error('文档内容已变化，请关闭窗口后重新打开表格美化');
   const {map,cells}=cellsOf(token.node,token.pos,h),matrix=buildWordMatrix(preset,map.height,map.width,options);
   for(const cell of cells)cell.style=mergedWordStyle(matrix,cell.rect);
   const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
   const measure=(text,font)=>{if(!context)return [...text].length*font.fontSize;context.font=`${font.bold?'bold ':''}${font.fontSize}pt "${font.fontFamily}"`;return context.measureText(text).width;};
   const layout=wordLayout(cells,map.width,h.availableWidth??624,preset,options,measure),tr=editor.state.tr;
   for(const cell of cells){
    const style=cell.style,patch={};
    if(has(style,'fill'))patch.fill=cleanHex(style.fill);
    if(has(style,'borders'))patch.borders=borders(style.borders);
    if(has(style,'vAlign'))patch.vAlign=style.vAlign==='top'?null:style.vAlign;
    const font={...(style.font??{}),...(layout?.font??{})};
    if(has(font,'color'))patch.color=cleanHex(font.color);
    if(has(font,'bold'))patch.bold=font.bold;
    if(layout){patch.clipHeightTwips=null;patch.colwidth=layout.columnWidths.slice(cell.rect.left,cell.rect.right);if(layout.cellMarginTwips){patch.cellMar=layout.cellMarginTwips;patch.tcPrEdited=true;}}
    updateAttrs(tr,cell.pos,patch);
    const paragraph={...(style.paragraph??{}),...(layout?.paragraph??{})};
    if(has(paragraph,'spaceBefore'))paragraph.spaceBeforeAuto=false;if(has(paragraph,'spaceAfter'))paragraph.spaceAfterAuto=false;
    const fontPatch=h.buildTextMarkPatch(font);
    cell.node.descendants((node,relative)=>{
     const p=cell.pos+1+relative;
     if(node.type.name==='docParagraph'||node.type.name==='docListItem'){
      const attrs={...paragraph};if(has(attrs,'align'))attrs.align=h.alignAttrFor(attrs.align,h.effectiveBidi(node.attrs));
      if(has(font,'fontSize')){attrs.emptyRunSize=font.fontSize===null?null:Math.round(font.fontSize*2);attrs.markSize=attrs.emptyRunSize;}
      if(has(font,'fontFamily'))attrs.emptyRunFont=font.fontFamily;
      updateAttrs(tr,p,attrs);
     }
     if(node.isText||node.type.name==='hardBreak'){
      const from=p,to=p+node.nodeSize;
      for(const key of ['bold','italic','underline','strike'])if(has(font,key)&&editor.schema.marks[key]){const type=editor.schema.marks[key];if(font[key])tr.addMark(from,to,type.create());else tr.removeMark(from,to,type);}
      if(Object.keys(fontPatch).length){const type=editor.schema.marks.docTextStyle,existing=node.marks.find(m=>m.type.name==='docTextStyle')?.attrs??{},attrs={...existing,...fontPatch};if(!equals(existing,attrs))tr.addMark(from,to,type.create(attrs));}
     }
     return !node.isAtom;
    });
   }
   const headerCount=Math.max(0,Math.min(5,map.height,Math.floor(options.headerRows??1)));
   token.node.forEach((row,offset,index)=>updateAttrs(tr,token.pos+1+offset,{repeatHeader:index<headerCount,repeatHeaderEdited:true}));
   let tablePatch={tblStyleId:null,tblFill:null};
   if(has(preset,'tableBorders'))tablePatch.borders=borders(preset.tableBorders);
   if(layout){const total=layout.columnWidths.reduce((a,b)=>a+b,0);Object.assign(tablePatch,{widthPx:total,widthPct:null,colWidthsPct:layout.columnWidths.map(v=>v/total*100),tblAutoFit:'fixed',tblAutoFitEdited:true});token.node.forEach((row,offset)=>updateAttrs(tr,token.pos+1+offset,{heightTwips:layout.minimumRowTwips,heightRule:'atLeast'}));}
   updateAttrs(tr,token.pos,tablePatch);
   if(!tr.steps.length){h.notify?.('表格已使用该样式');return {changed:false};}
   h.closeHistory(tr);tr.setMeta('docsOps',{source:'ui',ops:['wpsWordTableBeautify']});editor.view.dispatch(tr);editor.view.dispatch(h.closeHistory(editor.state.tr));
   token=null;h.notify?.(`已应用${preset.name}，可一次撤销`);return {changed:true};
  }
 };
}
