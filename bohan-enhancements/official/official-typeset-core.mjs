// Shared by the GenOffice ribbon and the independent skill. No document text is rewritten.
export const VERSION = "1.0.0";
export const ROLE_NAMES = Object.freeze({title:"标题",body:"正文",heading1:"一级标题",heading2:"二级标题",heading3:"三级标题",addressee:"主送机关",attachment:"附件说明",signature:"机关署名",date:"成文日期",blank:"空行",skip:"保留原样"});
export const FONT_CANDIDATES = Object.freeze({title:["方正小标宋简体","华文中宋","STZhongsong","Songti SC"],body:["仿宋_GB2312","仿宋","FangSong","STFangsong"],heading1:["黑体","SimHei","Heiti SC"],heading2:["楷体_GB2312","楷体","KaiTi","STKaiti","Kaiti SC"],latin:["Times New Roman","Times"]});
export const PAGE_SETUP = Object.freeze({paper:"A4",orientation:"portrait",margins:{top:2097,bottom:1984,left:1587,right:1474,gutter:0},columns:{count:1}});
export function chooseFonts(hasFont) {
  const fonts={}, substitutions=[];
  for (const [role,names] of Object.entries(FONT_CANDIDATES)) {
    fonts[role]=names.find(hasFont) || names[0];
    if(fonts[role]!==names[0]) substitutions.push({role,requested:names[0],actual:fonts[role]});
  }
  return {fonts,substitutions};
}
export const DEFAULT_PROFILE=Object.freeze({bodySizePt:16,titleSizePt:22,lineHeightPt:28,titleAfterPt:28,firstLineChars:2,signatureRightChars:2,pageSetup:PAGE_SETUP});
const datePattern=/^(?:[12]\d{3}|[〇○零一二三四五六七八九]{4})年(?:\d{1,2}|[〇○零一二三四五六七八九十]{1,3})月(?:\d{1,2}|[〇○零一二三四五六七八九十]{1,3})日$/;
const numbered=/^(?:[一二三四五六七八九十百]+[、．.]|[（(][一二三四五六七八九十百]+[）)]|\d+[.、．]|[（(]\d+[）)])/;
const shortHeading=t=>t.length<=42 && !/[。；;！？!?：:]/.test(t);
const LIST_TYPES=["listitem","listItem","list","docListItem"];
const isPara=b=>["paragraph","heading","docParagraph","docHeading",...LIST_TYPES].includes(b.type);
export function classifyBlocks(blocks, overrides={}) {
  const entries=blocks.map((b,i)=>({...b,index:b.index??i,text:String(b.text??""),role:isPara(b)?(String(b.text??"").trim()?"body":"blank"):"skip"}));
  const nonempty=entries.filter(b=>b.role==="body");
  for (const [i,b] of nonempty.entries()) {
    const t=b.text.trim();
    if(datePattern.test(t)) b.role="date";
    else if(/^附件[：:]/.test(t)) b.role="attachment";
    else if(i<4 && t.length<=90 && /[：:]$/.test(t) && /(?:各|局|部|室|处|公司|企业|单位|委员会|中心)/.test(t)) b.role="addressee";
    else if(shortHeading(t) && !LIST_TYPES.includes(b.type)) {
      if(/^[一二三四五六七八九十百]+[、．.]/.test(t)) b.role="heading1";
      else if(/^[（(][一二三四五六七八九十百]+[）)]/.test(t)) b.role="heading2";
      else if(/^(?:\d+[.、．]|[（(]\d+[）)])/.test(t)) b.role="heading3";
    }
  }
  const first=nonempty[0];
  if(first && !LIST_TYPES.includes(first.type) && first.role==="body" && first.text.trim().length<=70 && !/[。；;！？!?：:]/.test(first.text) && !numbered.test(first.text.trim())) first.role="title";
  for(let i=1;i<entries.length;i++) if(entries[i].role==="date") {
    for(let j=i-1,n=0;j>=0 && n<3;j--) {
      const p=entries[j],t=p.text.trim();
      if(p.role==="blank") continue;
      if(p.role!=="body" || t.length>45 || /[，,。；;：:]/.test(t) || !/(?:公司|集团|委员会|办公室|局|厅|部|中心|政府|学校|协会|研究院|工作组|董事会)$/.test(t)) break;
      p.role="signature"; n++;
    }
  }
  for(const b of entries) if(Object.hasOwn(overrides,b.index)) {
    if(!Object.hasOwn(ROLE_NAMES,overrides[b.index])) throw new Error(`段落 ${b.index} 的类型无效`);
    if(!isPara(b) && overrides[b.index]!=="skip") throw new Error(`段落 ${b.index} 为非正文对象，请保留原样`);
    b.role=overrides[b.index];
  }
  return entries;
}
export function validateOfficialAttrs(attrs,where="official format") {
  if(!attrs || typeof attrs!=="object" || Array.isArray(attrs) || !Object.keys(attrs).length) return `${where}: attrs must be a non-empty object`;
  const numeric=["lineRawTwips","indentLeft","indentRight","indentFirstLine","spaceBefore","spaceAfter","emptyRunSize"];
  const flags=["snapToGrid","spaceBeforeAuto","spaceAfterAuto","keepNext","keepLines","widowControl"];
  const allowed=[...numeric,...flags,"align","lineRule","lineSpacing","indentFirstLineChars","styleId","emptyRunFont"];
  for(const [k,v] of Object.entries(attrs)) {
    if(!allowed.includes(k)) return `${where}: unsupported official paragraph field ${k}`;
    if(numeric.includes(k) && !(Number.isFinite(v) && v>=0 && v<=31680)) return `${where}: ${k} must be a finite number in 0..31680`;
    if(flags.includes(k) && typeof v!=="boolean") return `${where}: ${k} must be boolean`;
    if(["lineSpacing","indentFirstLineChars","styleId"].includes(k) && v!==null) return `${where}: ${k} must be null`;
    if(k==="align" && !["left","center","right","justify"].includes(v)) return `${where}: invalid align`;
    if(k==="lineRule" && v!=="exact") return `${where}: lineRule must be exact`;
    if(k==="lineRawTwips" && v<160) return `${where}: exact line height must be at least 8pt`;
    if(k==="emptyRunFont" && (typeof v!=="string" || !v.trim() || v.length>128)) return `${where}: invalid emptyRunFont`;
  }
  return null;
}
export function makePlan(blocks,{overrides={},profile={},fonts=Object.fromEntries(Object.entries(FONT_CANDIDATES).map(([k,v])=>[k,v[0]]))}={}) {
  for(const k of Object.keys(profile))if(!Object.hasOwn(DEFAULT_PROFILE,k))throw new Error(`未知版式参数：${k}`);
  const config={...DEFAULT_PROFILE,...profile};
  for(const k of ["bodySizePt","titleSizePt","lineHeightPt"])if(!Number.isFinite(config[k])||config[k]<8||config[k]>72)throw new Error(`${k} 须为8至72磅`);
  for(const k of ["titleAfterPt","firstLineChars","signatureRightChars"])if(!Number.isFinite(config[k])||config[k]<0||config[k]>(k==="titleAfterPt"?144:8))throw new Error(`${k} 超出可用范围`);
  if(config.lineHeightPt<config.bodySizePt||config.lineHeightPt<config.titleSizePt)throw new Error("固定行距须至少容纳标题与正文字号");
  if(!config.pageSetup||typeof config.pageSetup!=="object"||Array.isArray(config.pageSetup))throw new Error("pageSetup 须为页面设置对象");
  for(const k of Object.keys(FONT_CANDIDATES)) if(typeof fonts[k]!=="string" || !fonts[k].trim() || fonts[k].length>128) throw new Error(`请填写${k}字体`);
  for(const key of Object.keys(overrides))if(!blocks.some((b,i)=>String(b.index??i)===key))throw new Error(`未找到段落 ${key}`);
  const entries=classifyBlocks(blocks,overrides),ops=[],counts={};
  const styles={};
  for(const role of new Set(["body",...entries.filter(b=>b.role!=="skip").map(b=>b.role)])){
    const title=role==="title",font=title?fonts.title:role==="heading1"?fonts.heading1:role==="heading2"?fonts.heading2:fonts.body;
    const id="GenOfficeOfficialV1_"+role;styles[role]=id;
    ops.push({op:"define_style",styleId:id,name:"公文·"+ROLE_NAMES[role],type:"paragraph",basedOn:null,next:role==="body"?null:"GenOfficeOfficialV1_body",quickFormat:true,
      paragraph:{outlineLevel:/^heading[123]$/.test(role)?Number(role.slice(-1)):null,spaceBefore:0,spaceAfter:0},
      run:{bold:false,italic:false,underline:false,strike:false,caps:false,smallCaps:false,color:"#000000",fontSize:title?config.titleSizePt:config.bodySizePt,fontFamily:fonts.latin,eastAsiaFontFamily:font}});
  }
  for(const b of entries) {
    counts[b.role]=(counts[b.role]||0)+1;
    if(b.role==="skip")continue;
    const heading=/^heading[123]$/.test(b.role),title=b.role==="title",isList=LIST_TYPES.includes(b.type);
    const target={blockIndexes:[b.index]},size=title?config.titleSizePt:config.bodySizePt;
    // Retain native list numbering and all source characters.
    if(!isList) ops.push({op:"applyStyle",target,styleId:styles[b.role]});
    const font=title?fonts.title:b.role==="heading1"?fonts.heading1:b.role==="heading2"?fonts.heading2:fonts.body;
    const attrs={align:title?"center":["signature","date"].includes(b.role)?"right":b.role==="body"?"justify":"left",
      lineSpacing:null,lineRule:"exact",lineRawTwips:Math.round(config.lineHeightPt*20),snapToGrid:false,indentLeft:0,
      indentRight:["signature","date"].includes(b.role)?Math.round(config.signatureRightChars*config.bodySizePt*20):0,
      indentFirstLine:isList?0:["body","heading1","heading2","heading3","attachment"].includes(b.role)?Math.round(config.firstLineChars*config.bodySizePt*20):0,
      indentFirstLineChars:null,spaceBefore:0,spaceAfter:title?Math.round(config.titleAfterPt*20):0,spaceBeforeAuto:false,spaceAfterAuto:false,
      keepNext:title||heading||b.role==="signature",keepLines:title||heading||b.role==="signature"||b.role==="date",widowControl:true,
      emptyRunSize:size*2,emptyRunFont:font};
    // Native lists retain their indentation, hanging marker and style reference.
    if(isList) for(const k of ["styleId","indentLeft","indentRight","indentFirstLine","indentFirstLineChars"])delete attrs[k];
    const error=validateOfficialAttrs(attrs); if(error)throw new Error(error);
    ops.push({op:"setOfficialParagraphFormat",target,attrs});
    ops.push({op:"setFont",target,fontFamily:fonts.latin,fontSize:size,bold:false,italic:false,underline:false,strike:false,color:"#000000",highlight:null});
    ops.push({op:"setFont",target,fontFamily:font});
  }
  return {version:VERSION,profile:"wps-official-body-starter",calibration:"awaiting-same-text-wps-reference",config,fonts,entries,counts,pageSetup:structuredClone(config.pageSetup),ops};
}
