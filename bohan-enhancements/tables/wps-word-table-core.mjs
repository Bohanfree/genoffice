const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
export const THEMES=[['黑色','#000000'],['蓝色','#4F81BD'],['红色','#C0504D'],['绿色','#9BBB59'],['紫色','#8064A2'],['青色','#4BACC6'],['橙色','#F79646']];
export function tint(color,value){
 const rgb=String(color).replace('#','').match(/.{2}/g)?.map(x=>parseInt(x,16)/255);if(!rgb||rgb.length!==3||rgb.some(Number.isNaN))return color;
 const [r,g,b]=rgb,max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;let l=(max+min)/2,h=0,s=0;
 if(d){s=l<=.5?d/(max+min):d/(2-max-min);h=(max===r?(g-b)/d+(g<b?6:0):max===g?(b-r)/d+2:(r-g)/d+4)/6;}
 l=value<0?l*(1+value):l*(1-value)+value;
 const m2=l<=.5?l*(1+s):l+s-l*s,m1=2*l-m2,hue=t=>{t=(t+1)%1;return t<1/6?m1+(m2-m1)*t*6:t<.5?m2:t<2/3?m1+(m2-m1)*(2/3-t)*6:m1;};
 return (s?[hue(h+1/3),hue(h),hue(h-1/3)]:[l,l,l]).map(x=>Math.floor(Math.max(0,Math.min(1,x))*255+1e-9).toString(16).padStart(2,'0')).join('').toUpperCase();
}
const hex=v=>typeof v==='string'&&/^(#)?[\da-f]{6}$/i.test(v)?v.replace('#','').toUpperCase():null;
export function recolor(color,preset,target){
 const c=hex(color),source=hex(preset.themeColor??'#4F81BD'),next=hex(target??preset.themeColor??'#4F81BD');if(!c||!source||!next||source===next)return color;
 const known=preset.themeMap?.['#'+c]??preset.themeMap?.[c];
 if(typeof known==='number')return tint(next,known);
 if(c===source)return next;
 for(const t of [.9,.8,.66,.6,.4,.2,-.25,-.5])if(tint(source,t)===c)return tint(next,t);
 return c;
}
export function validatePreset(p){return !!(p?.id&&p?.name&&Array.isArray(p.cells)&&p.cells.length>=4&&p.cells[0].length>=3&&p.cells.every(row=>Array.isArray(row)&&row.length===p.cells[0].length&&row.every(v=>v&&typeof v==='object')));}
function themed(style,preset,options){
 const s=clone(style);if('fill'in s&&s.fill)s.fill=recolor(s.fill,preset,options.themeColor);
 for(const b of Object.values(s.borders??{}))if(b?.color)b.color=recolor(b.color,preset,options.themeColor);
 if(s.font?.color)s.font.color=recolor(s.font.color,preset,options.themeColor);
 return s;
}
export function buildWordMatrix(preset,height,width,options={}){
 if(!validatePreset(preset))throw Error('Word 表格样式尚未就绪');
 if(!Number.isInteger(height)||!Number.isInteger(width)||height<1||width<1||height*width>50000)throw Error('表格大小超出可处理范围（最多 50000 格）');
 const headers=Math.max(0,Math.min(5,height,Math.floor(options.headerRows??1))),grid=preset.cells,period=Math.max(1,Math.min(preset.rowBandPeriod??2,grid.length-2));
 return Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>{
  const b=r-headers,k=options.bandedRows===false?0:((b%period)+period)%period;
  const sr=r<headers?0:b>0&&k===0?Math.min(1+period,grid.length-2):1+k,sc=c===0?0:c===width-1?grid[0].length-1:Math.min(grid[0].length-2,1+(c-1)%Math.max(1,grid[0].length-2));
  const style=themed(grid[sr][sc],preset,options);
  if(r===height-1&&preset.lastRow!==false){const last=themed(grid.at(-1)[sc],preset,options);if(last.borders&&'bottom'in last.borders)style.borders={...style.borders,bottom:last.borders.bottom};}
  return style;
 }));
}
export function mergedWordStyle(matrix,rect){
 const s=clone(matrix[rect.top][rect.left]);if(s.borders){
  s.borders={...s.borders};
  for(const [side,r,c]of [['top',rect.top,rect.left],['left',rect.top,rect.left],['right',rect.top,rect.right-1],['bottom',rect.bottom-1,rect.left]]){const cell=matrix[r][c];if(cell.borders&&side in cell.borders)s.borders[side]=clone(cell.borders[side]);}
 }return s;
}
// Layout adjustments preserve the measured or existing font. User selects them explicitly.
export function wordLayout(cells,width,availableWidth,preset,options,measure){
 if(!options.layout||options.layout==='preserve')return null;
 const setting=preset.layouts?.[options.layout]??{},gap=setting.paddingPx??({compact:8,medium:14,loose:22,fit:14}[options.layout]??14),minimum=setting.minColumnWidthPx??32;
 const widths=Array.from({length:width},()=>minimum);
 for(const cell of cells){const face=cell.style.font??{},size=face.fontSize??cell.fontSize??12,font=face.fontFamily??cell.fontFamily??'serif';let max=0;for(const line of cell.text.split('\n'))max=Math.max(max,measure(line,{fontSize:size,fontFamily:font,bold:face.bold??cell.bold}));const value=(max+gap*2)/(cell.rect.right-cell.rect.left);for(let c=cell.rect.left;c<cell.rect.right;c++)widths[c]=Math.max(widths[c],Math.min(setting.maxColumnWidthPx??350,value));}
 const total=widths.reduce((a,b)=>a+b,0),limit=Math.max(minimum*width,availableWidth??624),factor=options.layout==='fit'?limit/total:Math.min(1,limit/total);
 const columnWidths=widths.map(v=>v*factor);
 return {columnWidths,minimumRowTwips:setting.minRowHeightTwips??Math.round(({compact:20,medium:26,loose:34,fit:26}[options.layout]??26)*15),cellMarginTwips:setting.cellMar??null,paragraph:setting.paragraph??null,font:setting.font??null};
}
