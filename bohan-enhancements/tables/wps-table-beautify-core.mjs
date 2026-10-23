const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export const THEMES = [
  ['黑色', '#000000'], ['蓝色', '#4F81BD'], ['红色', '#C0504D'],
  ['绿色', '#9BBB59'], ['紫色', '#8064A2'], ['青色', '#4BACC6'], ['橙色', '#F79646'],
];

function rgb(color) {
  const text = String(color ?? '').replace(/^#/, '').slice(-6);
  return /^[\da-f]{6}$/i.test(text) ? [0, 2, 4].map((i) => parseInt(text.slice(i, i + 2), 16)) : null;
}
function hex(values) { return '#' + values.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
export function officeTint(color, tint) {
  const raw = rgb(color);
  if (!raw) return color;
  const [r,g,b] = raw.map(v=>v/255), max=Math.max(r,g,b), min=Math.min(r,g,b), delta=max-min;
  let l=(max+min)/2, h=0, saturation=0;
  if(delta){saturation=l<=.5?delta/(max+min):delta/(2-max-min);h=max===r?(g-b)/delta+(g<b?6:0):max===g?(b-r)/delta+2:(r-g)/delta+4;h/=6;}
  l=tint<0?l*(1+tint):l*(1-tint)+tint;
  if(!saturation)return hex([l*255,l*255,l*255]);
  const m2=l<=.5?l*(1+saturation):l+saturation-l*saturation,m1=2*l-m2;
  const hue=(t)=>{t=(t+1)%1;if(t<1/6)return m1+(m2-m1)*t*6;if(t<.5)return m2;if(t<2/3)return m1+(m2-m1)*(2/3-t)*6;return m1;};
  return hex([hue(h+1/3),hue(h),hue(h-1/3)].map(v=>v*255));
}
export function recolor(color, source, target, mapping = {}) {
  const current = rgb(color), base = rgb(source), next = rgb(target);
  if (!current || !base || !next || hex(base) === hex(next)) return color;
  const known = mapping[hex(current)] ?? mapping[hex(current).slice(1)];
  if (typeof known === 'number') return officeTint(target, known);
  // Only recolor the captured accent and its linear tints/shades. Neutral colors stay intact.
  if (current.every((v, i) => v === base[i])) return hex(next);
  for (const tint of [.9,.8,.66,.6,.4,.2,-.25,-.5]) {
    if(officeTint(source,tint)===hex(current))return officeTint(target,tint);
  }
  return color;
}
function themeStyle(style, preset, color) {
  const result = copy(style ?? {});
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'rgb' && typeof entry === 'string') value[key] = recolor(entry, preset.themeColor ?? '#4F81BD', color, preset.themeMap);
      else visit(entry);
    }
  };
  visit(result);
  // WPS beautification's default keeps the source alignment, sizing and number display.
  for (const key of ['ff', 'ht', 'vt', 'tb', 'tr', 'pd', 'n']) delete result[key];
  return result;
}
function sampleColumn(column, width, gridWidth) {
  if (column === 0) return 0;
  if (column === width - 1) return gridWidth - 1;
  return Math.min(gridWidth - 2, 1 + ((column - 1) % Math.max(1, gridWidth - 2)));
}
export function validatePreset(preset) {
  return Boolean(preset?.id && preset?.name && Array.isArray(preset.cells) && preset.cells.length >= 4 && preset.cells.every((row) => Array.isArray(row) && row.length === preset.cells[0].length && row.length >= 3 && row.every((s) => s && typeof s === 'object')));
}
export function buildStyleMatrix(preset, height, width, options = {}) {
  if (!validatePreset(preset)) throw new Error('样式数据未就绪');
  if (!Number.isInteger(height) || !Number.isInteger(width) || height < 1 || width < 1 || height * width > 100000) throw new Error('请选择 1 至 100000 个单元格的区域');
  const headers = Math.max(0, Math.min(5, Math.floor(options.headerRows ?? 1), height));
  const banded = options.bandedRows !== false;
  const color = options.themeColor ?? preset.themeColor ?? '#4F81BD';
  const grid = preset.cells, gridWidth = grid[0].length;
  const requestedPeriod = Number.isInteger(preset.rowBandPeriod) ? preset.rowBandPeriod : 2;
  const period = Math.max(1, Math.min(requestedPeriod, grid.length - 2));
  const matrix = [];
  for (let row = 0; row < height; row++) {
    const bodyIndex = row - headers;
    const bandIndex = banded ? bodyIndex % period : 0;
    // The first body row's top border can differ from later rows in its band.
    const sourceRow = row < headers ? 0 : bodyIndex > 0 && bandIndex === 0 ? Math.min(1 + period, grid.length - 2) : 1 + bandIndex;
    matrix.push(Array.from({ length: width }, (_, column) => {
      const sourceColumn = sampleColumn(column, width, gridWidth);
      const style = themeStyle(grid[sourceRow][sourceColumn], preset, color);
      const layout=options.layout??'preserve';
      if(layout!=='preserve')Object.assign(style,{ff:'Microsoft YaHei',fs:row<headers?(layout==='loose'?12:11):(layout==='loose'?11:10),ht:2,vt:2,tb:3});
      if (row === height - 1 && preset.lastRow !== false) {
        const lastStyle = themeStyle(grid[grid.length - 1][sourceColumn], preset, color);
        // The bottom edge is special; the final row retains the active body band.
        if (lastStyle.bd && 'b' in lastStyle.bd) style.bd = { ...style.bd, b: lastStyle.bd.b };
      }
      return { s: style };
    }));
  }
  return matrix;
}

export function measureLayout(texts, matrix, options, measureText) {
  const layout=options.layout??'preserve';
  if(layout==='preserve')return null;
  const height=matrix.length,width=matrix[0].length,mdw=Math.max(4,options.mdw??7),headers=Math.max(0,Math.min(5,options.headerRows??1,height));
  const loose=layout==='loose',padding=loose?44:24;
  const columnWidths=Array.from({length:width},(_,column)=>{
    let maximum=0;
    for(let row=0;row<height;row++){
      const style=matrix[row][column].s,text=String(texts[row]?.[column]??'');
      for(const line of text.split(/\r?\n/))maximum=Math.max(maximum,measureText(line,style));
    }
    const compact=Math.max(8.75*mdw,Math.min(420,maximum+padding));
    return compact+(layout==='medium'?2*mdw:0)+(loose?2*mdw:0);
  });
  if(layout==='fit'){
    const total=columnWidths.reduce((a,b)=>a+b,0),available=Math.max(120,options.availableWidth??900);
    for(let column=0;column<width;column++)columnWidths[column]=Math.max(8,columnWidths[column]*available/total);
  }
  const rowHeights=matrix.map((row,r)=>{
    const base=(loose?(r<headers?31.25:30.5):layout==='compact'?18.5:22.5)*96/72;
    let rowHeight=base;
    row.forEach(({s},column)=>{
      const available=Math.max(4,columnWidths[column]-16),text=String(texts[r]?.[column]??'');
      let lines=0;
      for(const paragraph of text.split(/\r?\n/)){
        let line='';lines++;
        for(const char of paragraph){if(line&&measureText(line+char,s)>available){lines++;line=char;}else line+=char;}
      }
      if(lines>1)rowHeight=Math.max(rowHeight,lines*(s.fs??10)*96/72*1.3+8);
    });
    return Math.min(546,rowHeight);
  });
  return {columnWidths,rowHeights};
}
