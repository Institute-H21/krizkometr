/* Křížkometr – průzkumník přeskakování v komunálních volbách. Institut H21.
   Jeden skript pro všechny stránky: vykreslí se to, co stránka obsahuje. */
(function(){
"use strict";
// ------------------------------------------------------------- nastavení
// VERZE: po každé výměně souborů v data/ ji změňte (a totéž číslo v odkazech
// na skript a styly v HTML), jinak můžou prohlížeče chvíli držet stará data
const VERZE="2026-10-10";
const ASSETS=new URL(".",(document.currentScript&&document.currentScript.src)||location.href);
const DATA_URL=new URL("../data/",ASSETS);
const SOUBORY={vysledky:"vysledky.bin",jmena:"jmena.bin",kandidatky:"kandidatky.bin"};
// volby 2026 leží ve vlastních souborech (nastroje/prubezne2026.cs): během sčítání se
// přepisuje jen vysledky-2026.bin, kandidátky a jména 2026 i data 2006–2022 zůstávají
const SOUBORY26={vysledky:"vysledky-2026.bin",jmena:"jmena-2026.bin",kandidatky:"kandidatky-2026.bin"};
const VIEW=document.body.dataset.view||"vse";   // vse | pruzkumnik | grafy | kandidatka
let META=null,D=null,anecOpen=false,searchRefresh=null,anecMode="weak",anecIdx=0,booted=false;
// D0 = data 2006–2022; P26 = kde v D začíná rok 2026; LIVE = průběh sčítání;
// ST = stav sčítání kandidátky: 0 sečteno (i všechny starší volby), 1 průběžně, 2 nic
let D0=null,P26=null,LIVE=null,ST=null;
// jména leží ve zvláštním souboru; stáhnou se teprve, když si je někdo vyžádá
let NAMES=null,namesPromise=null,namesFailed=false,onNames=null;
// plné názvy kandidátek z registru ČSÚ a krátké štítky do tlačítek
let LISTS=null,listsPromise=null;
const BANDS=[[0,200],[200,500],[500,1000],[1000,2000],[2000,5000],[5000,10000],
             [10000,20000],[20000,50000],[50000,150000],[150000,1000000],[1000000,1e9]];
const BLAB=["do 199","200–499","500–999","1 000–1 999","2 000–4 999","5 000–9 999",
            "10 000–19 999","20 000–49 999","50 000–149 999","150 tis.–1 mil.","nad 1 mil."];
const NB=BANDS.length;
const fmt=new Intl.NumberFormat("cs-CZ");
const pc=x=>(Math.round(x*10)/10).toLocaleString("cs-CZ",{minimumFractionDigits:1,maximumFractionDigits:1});
const $=id=>document.getElementById(id);

async function gunzip(by){const st=new Blob([by]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(st).arrayBuffer());}
// GitHub Pages posílá .bin tak, jak leží; soubory jsou zabalené gzipem.
// Průběžná data (fresh) si prohlížeč pokaždé ověří u serveru, nebere je z mezipaměti.
async function fetchBytes(name,fresh){
  const r=await fetch(new URL(name+"?v="+VERZE,DATA_URL),fresh?{cache:"no-cache"}:undefined);
  if(!r.ok)throw new Error(name+": "+r.status);
  const b=new Uint8Array(await r.arrayBuffer());
  return (b[0]===0x1f&&b[1]===0x8b)?gunzip(b):b;
}
function parse(raw){
  let dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const ml=dv.getUint32(0,true);
  const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(raw.buffer,raw.byteOffset+4,ml)));
  const buf=raw.subarray(4+ml);
  dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  const L=dv.getUint32(0,true),N=dv.getUint32(4,true);let o=8;
  const u8=k=>{const a=new Uint8Array(buf.buffer,buf.byteOffset+o,k);o+=k;return a;};
  const cp=(k,T,w)=>{const a=new T(buf.slice(o,o+k*w).buffer);o+=k*w;return a;};
  const pl=k=>{ // uint32 stored as four byte planes
    const a=new Uint32Array(k),b0=o,b1=o+k,b2=o+2*k,b3=o+3*k;
    for(let i=0;i<k;i++)a[i]=buf[b0+i]|(buf[b1+i]<<8)|(buf[b2+i]<<16)|(buf[b3+i]*16777216);
    o+=4*k;return a;};
  const yr=u8(L),mand=u8(L),seats=u8(L),n=u8(L);
  const mi=cp(L,Uint16Array,2);
  const pop=cp(L,Uint32Array,4),mask=cp(L,Uint32Array,4),pv=pl(L);
  const pos=u8(N),votes=pl(N);
  const off=new Uint32Array(L);
  for(let i=0,a=0;i<L;i++){off[i]=a;a+=n[i];}
  const nb=(N+7)>>3;
  const bEl=u8(nb),bOr=u8(nb),bCl=u8(nb),bBe=u8(nb),bHi=u8(nb);
  let k=dv.getUint32(o,true);o+=4;
  const names=new TextDecoder().decode(new Uint8Array(buf.buffer,buf.byteOffset+o,k)).split("\n");o+=k;
  k=dv.getUint32(o,true);o+=4;
  const abbr=new TextDecoder().decode(new Uint8Array(buf.buffer,buf.byteOffset+o,k)).split("\n");o+=k;
  const M=dv.getUint32(o,true);o+=4;
  const mcode=cp(M,Uint32Array,4),mward=u8(M),mokr=u8(M),mtyp=u8(M);
  return {L,N,yr,mand,seats,n,mi,pop,mask,pv,off,pos,votes,bEl,bOr,bCl,bBe,bHi,
          names,abbr,mcode,mward,mokr,mtyp,meta};
}
const bit=(a,i)=>(a[i>>3]>>(i&7))&1;

// připojí za data 2006–2022 rok z dalšího souboru (volby 2026). Kandidátky, kandidáti
// a obce 2026 jdou za ty starší, takže indexy dřívějších let zůstávají, jak byly.
// Štítky stran a okresy se párují podle názvu, kdyby se jejich pořadí v souborech lišilo.
function append(A,B){
  const mA=A.meta,mB=B.meta,L0=A.L,N0=A.N,M0=A.mcode.length,N=N0+B.N;
  const years=mA.years.slice();
  const yMap=mB.years.map(y=>{const i=years.indexOf(y);return i<0?years.push(y)-1:i;});
  const tMap=mB.tags.map(t=>mA.tags.indexOf(t));
  const oMap=mB.okresy.map(o=>mA.okresy.findIndex(x=>x[0]===o[0]));
  if(oMap.some(i=>i<0))throw new Error("okresy 2026");
  const cat=(x,y)=>{const r=new x.constructor(x.length+y.length);r.set(x);r.set(y,x.length);return r;};
  // bity kandidátů jsou po osmi v bajtu a základ nekončí na celém bajtu, proto po jednom
  const bits=(x,y)=>{const r=new Uint8Array((N+7)>>3);r.set(x);
    for(let i=0;i<B.N;i++)if((y[i>>3]>>(i&7))&1){const j=N0+i;r[j>>3]|=1<<(j&7);}
    return r;};
  const mask=B.mask.map(m=>{let r=0;tMap.forEach((t,b)=>{if(t>=0&&(m>>>b)&1)r|=1<<t;});return r>>>0;});
  const R={L:L0+B.L,N,yr:cat(A.yr,B.yr.map(i=>yMap[i])),mand:cat(A.mand,B.mand),seats:cat(A.seats,B.seats),
    n:cat(A.n,B.n),mi:cat(A.mi,B.mi.map(i=>i+M0)),pop:cat(A.pop,B.pop),mask:cat(A.mask,mask),pv:cat(A.pv,B.pv),
    pos:cat(A.pos,B.pos),votes:cat(A.votes,B.votes),
    bEl:bits(A.bEl,B.bEl),bOr:bits(A.bOr,B.bOr),bCl:bits(A.bCl,B.bCl),bBe:bits(A.bBe,B.bBe),bHi:bits(A.bHi,B.bHi),
    names:A.names.concat(B.names),abbr:A.abbr.concat(B.abbr),mcode:cat(A.mcode,B.mcode),mward:cat(A.mward,B.mward),
    mokr:cat(A.mokr,B.mokr.map(o=>oMap[o])),mtyp:cat(A.mtyp,B.mtyp),meta:mA};
  R.off=new Uint32Array(R.L);for(let i=0,a=0;i<R.L;i++){R.off[i]=a;a+=R.n[i];}
  // stav sčítání: v souboru jsou jen obce, kde ještě nejsou rozdělené mandáty
  const st=mB.stav||{},stM=new Uint8Array(B.mcode.length),okr=new Map();
  (st.obce||[]).forEach(([m,z,c])=>{stM[m]=z>0?1:2;okr.set(m+M0,[z,c]);});
  const S_=new Uint8Array(R.L);for(let l=L0;l<R.L;l++)S_[l]=stM[R.mi[l]-M0];
  // zastupitelstva se počítají jako v souhrnu nahoře, tedy volební obvod zvlášť
  const has=new Uint8Array(B.mcode.length);B.mi.forEach(m=>has[m]=1);
  let zastup=0,secteno=0;has.forEach((h,m)=>{if(h){zastup++;if(!stM[m])secteno++;}});
  return {D:R,years,P:{L0,N0},ST:S_,LIVE:{yi:yMap[0],cas:st.cas||"",sestaveno:st.sestaveno||"",
    zastup,secteno,okr,nekonaji:new Set(st.nekonaji||[])}};
}
function useLive(B){
  const x=append(D0,B);
  D=x.D;META.years=x.years;P26=x.P;ST=x.ST;LIVE=x.LIVE;
}
function fillRoky(){
  document.querySelectorAll(".roky").forEach(el=>el.textContent=rokyTxt()
    +(LIVE&&LIVE.secteno<LIVE.zastup?` (${META.years[LIVE.yi]} průběžně)`:""));
}
// ještě se sčítá a výběr volby 2026 obsahuje
const liveOn=()=>!!LIVE&&LIVE.secteno<LIVE.zastup&&(S.years.size===0||S.years.has(LIVE.yi));
// čas ČSÚ "2026-10-10T21:24:01" -> "10. 10. 21:24"
const casTxt=()=>{const m=/^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(LIVE.cas);
  return m?`${+m[2]}. ${+m[1]}. ${m[3]}:${m[4]}`:"";};
// „z“, nebo „ze“ před číslem n podle toho, jak se čte: ze 2, ze 174, z 5, z 1 010
const ze=n=>{const s=String(n);
  if(n>=10&&n<20)return [12,13,14,16,17].includes(n)?"ze":"z";
  if(s[0]==="1")return s.length===3?"ze":"z";
  return "23467".includes(s[0])?"ze":"z";};
function liveNote(){
  if(!liveOn())return "";
  return `<span class="live">Volby ${META.years[LIVE.yi]} se ještě sčítají. Započítaná jsou jen zastupitelstva, `
    +`kde už ČSÚ rozdělil mandáty: ${fmt.format(LIVE.secteno)} ${ze(LIVE.zastup)} ${fmt.format(LIVE.zastup)} `
    +`(stav ${casTxt()}).</span>`;
}
// průběžná data se během sčítání v otevřené stránce sama obnovují
let liveTimer=0;
function watchLive(){
  if(liveTimer||!LIVE||LIVE.secteno>=LIVE.zastup)return;
  liveTimer=setInterval(async()=>{
    if(document.visibilityState!=="visible")return;
    try{
      const B=parse(await fetchBytes(SOUBORY26.vysledky,true));
      // soubor se přepisuje, jen když přibyly hlasy, takže stejné sestavení = nic nového
      if((B.meta.stav||{}).sestaveno===LIVE.sestaveno)return;
      // kandidátky a kandidáti 2026 jsou v každém sestavení stejní; kdyby nebyli, platí stará data
      if(B.L!==D.L-P26.L0||B.N!==D.N-P26.N0)return;
      useLive(B);render();fillRoky();
      if(LIVE.secteno>=LIVE.zastup){clearInterval(liveTimer);liveTimer=0;}
    }catch(e){}
  },5*60*1000);
}

// soubor se jmény se stahuje vždy, ale až potom, co je stránka vykreslená,
// takže se na něj nikdo nečeká; na úsporném připojení se vynechá
function prefetchNames(){
  const c=navigator.connection;
  if(c&&(c.saveData||/(^|-)2g$/.test(c.effectiveType||"")))return;
  const go=()=>{ensureLists();ensureNames();};
  if("requestIdleCallback" in window)requestIdleCallback(go,{timeout:2500});
  else setTimeout(go,400);
}
function ensureNames(){
  if(namesPromise||namesFailed) return namesPromise;
  namesPromise=loadNames().then(()=>{render();if(searchRefresh)searchRefresh();if(onNames)onNames();});
  return namesPromise;
}
function readNames(raw){
  const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  const n=dv.getUint32(0,true),ls=dv.getUint32(8,true),lg=dv.getUint32(12,true);
  let o=16;
  const td=new TextDecoder();
  const sur=td.decode(new Uint8Array(raw.buffer,raw.byteOffset+o,ls)).split("\n");o+=ls;
  const giv=td.decode(new Uint8Array(raw.buffer,raw.byteOffset+o,lg)).split("\n");o+=lg;
  const pl=k=>{const a=new Uint32Array(k),b0=o,b1=o+k,b2=o+2*k,b3=o+3*k;
    for(let i=0;i<k;i++)a[i]=raw[b0+i]|(raw[b1+i]<<8)|(raw[b2+i]<<16)|(raw[b3+i]*16777216);
    o+=4*k;return a;};
  return {n,sur,giv,si:pl(n),gi:pl(n)};
}
async function loadNames(){
  try{
    const [raw,raw26]=await Promise.all([fetchBytes(SOUBORY.jmena),
      P26?fetchBytes(SOUBORY26.jmena).catch(()=>null):null]);
    let {sur,giv,si,gi}=readNames(raw);
    // jména 2026 se připojí, jen když jich je stejně jako kandidátů 2026 ve výsledcích;
    // jinak zůstanou kandidáti 2026 bez jmen, ale nikdy s cizími
    const b=raw26&&readNames(raw26);
    if(b&&b.n===D.N-P26.N0){
      const s2=new Uint32Array(D.N),g2=new Uint32Array(D.N);
      s2.set(si);g2.set(gi);
      for(let i=0;i<b.n;i++){s2[P26.N0+i]=b.si[i]+sur.length;g2[P26.N0+i]=b.gi[i]+giv.length;}
      sur=sur.concat(b.sur);giv=giv.concat(b.giv);si=s2;gi=g2;
    }
    // příjmení a křestní jména leží v tabulkách bez opakování; přes ně se i hledá
    NAMES={of:ix=>((sur[si[ix]]||"")+" "+(giv[gi[ix]]||"")).trim(),sur,giv,si,gi};
  }catch(e){ namesPromise=null; namesFailed=true; }
}
function ensureLists(){
  if(LISTS||listsPromise) return listsPromise;
  const rd=raw=>JSON.parse(new TextDecoder().decode(raw));
  listsPromise=Promise.all([fetchBytes(SOUBORY.kandidatky).then(rd),
      P26?fetchBytes(SOUBORY26.kandidatky).then(rd).catch(()=>null):null]).then(([j,k])=>{
    // kandidátka l z roku 2026 je v souboru 2026 na místě l-L0
    const L0=P26?P26.L0:Infinity;
    if(k&&k.fi.length!==D.L-L0)k=null;
    const at=l=>l<L0?[j,l]:k?[k,l-L0]:null;
    LISTS={full:l=>{const p=at(l);return p?p[0].f[p[0].fi[p[1]]]||"":"";},
           lab:l=>{const p=at(l);if(!p)return "";const [x,i]=p,s=x.si[i];
             return s===-1?"":s===-2?x.f[x.fi[i]]:x.s[s];}};
    render();
  }).catch(()=>{listsPromise=null;});
  return listsPromise;
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
// tlačítko kandidátky: zkratka, a kde se v obci opakuje (SNK, NK…), i kus vlastního názvu
function listChip(l,i){
  const a=D.abbr[l],lab=LISTS?LISTS.lab(l):"";
  if(!lab) return esc(a||"kandidátka "+(i+1));
  return a?`${esc(a)} <span class="cn">${esc(lab)}</span>`:`<span class="cn">${esc(lab)}</span>`;
}
function listInline(l){
  const a=D.abbr[l]||"",lab=LISTS?LISTS.lab(l):"";
  return lab?(a?`${esc(a)} (${esc(lab)})`:esc(lab)):esc(a||"–");
}
function listName(l){                // zkratka a plný název, pokud říká něco navíc
  const a=D.abbr[l]||"",f=LISTS?LISTS.full(l):"";
  if(!f||f.toLowerCase()===a.toLowerCase()) return `<b>${esc(a||"–")}</b>`;
  return a?`<b>${esc(a)}</b> – ${esc(f)}`:`<b>${esc(f)}</b>`;
}
// 593 názvů obcí sdílí 1 509 obcí, takže samotný název neidentifikuje;
// u Prahy by se okres s názvem opakoval, proto se vynechá
const okrOf=mi=>{const o=META.okresy[D.mokr[mi]][0],n=D.names[mi];
  return (n===o||n.startsWith(o+" ")||n.startsWith(o+"-"))?"":o;};
const okrSuf=mi=>{const o=okrOf(mi);return o?", okres "+o:"";};
let nRivals=null;                       // počet kandidátek, které spolu v obci soupeřily
function countRivals(){
  const cnt=new Map();
  for(let l=0;l<D.L;l++){const k=D.mi[l]*8+D.yr[l];cnt.set(k,(cnt.get(k)||0)+1);}
  nRivals=new Uint8Array(D.L);
  for(let l=0;l<D.L;l++)nRivals[l]=Math.min(255,cnt.get(D.mi[l]*8+D.yr[l]));
}
const RIV=[["jediná",1,1],["2",2,2],["3",3,3],["4–5",4,5],["6–10",6,10],["11 a víc",11,255]];
let splitCY=null;                       // "kód obce_rok" voleb dělených na obvody
function findSplits(){
  const byCY=new Map();
  for(let l=0;l<D.L;l++){
    const k=D.mcode[D.mi[l]]+"_"+D.yr[l];
    let st=byCY.get(k);if(!st){st=new Set();byCY.set(k,st);}
    st.add(D.mi[l]);
  }
  splitCY=new Set();
  byCY.forEach((st,k)=>{if(st.size>1)splitCY.add(k);});
}
const isSplit=l=>splitCY.has(D.mcode[D.mi[l]]+"_"+D.yr[l]);
const avgOf=l=>D.pv[l]/Math.max(1,D.n[l]);
const thrOf=l=>{const a=Math.floor(avgOf(l));return a+a/10;};

// empty set = no restriction, so every filter is "pick none or pick several"
// místo na kandidátce je buď/anebo: uplatní se jen režim, který je zapnutý
const S={years:new Set(),bands:new Set(),tags:new Set(),kraje:new Set(),okresy:new Set(),
         typy:new Set(),rivals:new Set(),posMode:"abs",absLo:1,absHi:70,relLo:0,relHi:100};
// okres je přesnější než kraj, takže když je vybraný, kraj se už neuplatňuje
const regTxt=()=>{
  if(!S.kraje.size) return "celá ČR";
  const parts=[...S.kraje].sort((a,b)=>META.kraje[a].localeCompare(META.kraje[b],"cs")).map(k=>{
    const os=[...S.okresy].filter(i=>META.okresy[i][1]===k)
      .map(i=>META.okresy[i][0]).sort((a,b)=>a.localeCompare(b,"cs"));
    return os.length?os.join(", "):META.kraje[k];
  });
  const t=parts.join(", ");
  return t.length>42?parts.length+" oblastí":t;
};
const posAll=()=>S.posMode==="abs"?(S.absLo===1&&S.absHi>=70):(S.relLo===0&&S.relHi===100);
const posTxt=()=>posAll()?"vše":(S.posMode==="abs"
  ?`${S.absLo}. až ${S.absHi}. místo`:`${S.relLo} – ${S.relHi} % délky`);
const bandOf=p=>{let i=0;while(i<NB-1&&p>=BANDS[i][1])i++;return i;};
// sousedící pásma se slijí do jednoho rozsahu: 1 000–1 999 + 2 000–4 999 +
// 5 000–9 999 se vypíše jako "1 000–9 999", ne jako "3 pásma"
function bandsTxt(){
  if(!S.bands.size) return "vše";
  const ix=[...S.bands].sort((a,b)=>a-b),runs=[];
  let a=ix[0],prev=ix[0];
  for(let k=1;k<=ix.length;k++){
    if(k<ix.length&&ix[k]===prev+1){prev=ix[k];continue;}
    runs.push([a,prev]);
    if(k<ix.length){a=ix[k];prev=ix[k];}
  }
  const one=([x,y])=>{
    if(x===0&&y===NB-1) return "vše";
    if(x===y) return BLAB[x];
    if(x===0) return "do "+fmt.format(BANDS[y][1]-1);
    if(y===NB-1) return fmt.format(BANDS[x][0])+" a víc";
    return fmt.format(BANDS[x][0])+"–"+fmt.format(BANDS[y][1]-1);
  };
  return runs.length>3?runs.length+" rozsahů":runs.map(one).join(", ");
}

/* ------------------------------------------------------------------ scan */
function scan(){
  const {L,seats,n,mi,pop,mask,off,pos,votes,bEl,bOr,bCl,bBe,bHi}=D;
  const tm=[...S.tags].reduce((a,t)=>a|(1<<META.tags.indexOf(t)),0);
  const anyY=S.years.size===0,anyB=S.bands.size===0;
  const anyR=S.kraje.size===0;
  // okres zužuje jen svůj kraj; ostatní vybrané kraje zůstávají celé
  const okInKraj=new Uint8Array(META.kraje.length);
  S.okresy.forEach(o=>okInKraj[META.okresy[o][1]]=1);
  const anyT=S.typy.size===0,anyRiv=S.rivals.size===0;
  const byAbs=S.posMode==="abs";
  const aLo=byAbs?S.absLo:1,aHi=byAbs?S.absHi:70;
  const rLo=byAbs?0:S.relLo/100,rHi=byAbs?1:S.relHi/100;
  const allPos=posAll();
  const R={cand:0,el:0,jump:0,idle:0,beat:0,cl:0,high:0,noSeat:0,short:0,
           elBelow:0,needed:0,beatLists:0,seatLists:0,munis:new Set()};
  const B={m:new Float64Array(NB),d:new Float64Array(NB)};
  const EX=[];                              // všechny paradoxy ve výběru
  for(let l=0;l<L;l++){
    if(ST&&ST[l])continue;               // 2026: jen zastupitelstva s rozdělenými mandáty
    if(tm&&!(tm&mask[l]))continue;
    const ln=n[l];if(!ln)continue;
    if(!anyY&&!S.years.has(D.yr[l]))continue;
    const mIdx=D.mi[l];
    if(!anyT&&!S.typy.has(D.mtyp[mIdx]))continue;
    if(!anyRiv){const r=nRivals[l];
      let hit=false;S.rivals.forEach(i=>{if(r>=RIV[i][1]&&r<=RIV[i][2])hit=true;});
      if(!hit)continue;}
    if(!anyR){const ok=D.mokr[mIdx],kr=META.okresy[ok][1];
      if(!S.kraje.has(kr))continue;
      if(okInKraj[kr]&&!S.okresy.has(ok))continue;}
    const P0=pop[l],o=off[l],den=ln>1?ln-1:1,av=avgOf(l);
    const bi=bandOf(P0),inPop=anyB||S.bands.has(bi);
    let cand=0,el=0,jump=0,idle=0,cl=0,high=0,beat=0,noSeat=0,shortf=0,elBelow=0,needed=0;
    // kolik skokanů je na kandidátce celkem a kolik neskokanů leží před
    // daným místem – z toho plyne, kam by kandidát spadl, kdyby nepřeskočil on
    let C=0;for(let i=0;i<ln;i++)if(bit(bCl,o+i))C++;
    let nb=0;
    for(let i=0;i<ln;i++){
      const ix=o+i;
      const cPre=bit(bCl,ix);
      const nbHere=nb; if(!cPre)nb++;          // neskokani před ním, v pořadí na lístku
      if(!allPos){const ap=pos[ix];if(ap<aLo||ap>aHi)continue;
        const rp=ln>1?i/den:0;if(rp<rLo-1e-9||rp>rHi+1e-9)continue;}
      const e=bit(bEl,ix),oo=bit(bOr,ix),c=cPre,be=bit(bBe,ix),hi=bit(bHi,ix);
      cand++;
      if(c){cl++;
        if(e){ if(oo){idle++; if((C-1)+nbHere+1>seats[l])needed++;} else jump++; }
        else if(seats[l]===0)noSeat++;else shortf++;}
      else if(hi)high++;
      if(e){el++;if(!c&&!hi)elBelow++;}
      if(be)beat++;
    }
    if(!cand)continue;
    B.m[bi]+=el;B.d[bi]+=jump;
    if(!inPop)continue;
    R.cand+=cand;R.el+=el;R.jump+=jump;R.idle+=idle;R.cl+=cl;R.high+=high;R.beat+=beat;
    R.noSeat+=noSeat;R.short+=shortf;R.elBelow+=elBelow;R.needed+=needed;
    if(seats[l]>0){R.seatLists++;if(beat>0)R.beatLists++;}
    R.munis.add(mi[l]);
    // anecdote: worst-ranked elected vs best-ranked unelected ON THE SAME LIST,
    // ignoring the position filters (the pair is a comparison of two positions)
    let wEl=-1,bNe=-1;
    for(let i=0;i<ln;i++){
      const ix=o+i;
      if(bit(bEl,ix)){if(wEl<0||votes[ix]<votes[wEl])wEl=ix;}
      else {if(bNe<0||votes[ix]>votes[bNe])bNe=ix;}
    }
    // jen skutečné paradoxy: nezvolený má víc hlasů než zvolený z téže listiny
    if(wEl>=0&&bNe>=0&&votes[bNe]>votes[wEl])
      EX.push({l,iEl:wEl,iNe:bNe,r:votes[wEl]/Math.max(av,1e-9),gap:votes[bNe]-votes[wEl]});
  }
  EX.sort(exCmp());
  return {R,B,EX};
}

/* ------------------------------------------------- list breakdown (shared) */
function listTable(l,marks){
  if(!LISTS)ensureLists();
  const {off,n,pos,votes,seats,bEl,bCl,mi,names,pop,mand}=D;
  const ln=n[l],av=avgOf(l),thr=thrOf(l),o=off[l];
  const live=!!ST&&ST[l]===1;           // průběžně sečtená: mandáty ještě nejsou rozdělené
  let rows="";
  for(let i=0;i<ln;i++){
    const ix=o+i,e=bit(bEl,ix),c=bit(bCl,ix);
    const cls=(marks&&marks.has(ix))?"mark":(e?"in":"");
    const nm=NAMES?`<small>${NAMES.of(ix)||"–"}</small>`:"";
    rows+=`<tr class="${cls}"><td>${pos[ix]}.${nm}</td><td>${fmt.format(votes[ix])}</td>`
      +`<td>${Math.round(100*votes[ix]/Math.max(av,1e-9))} %</td>`
      +`<td class="${c?"yes":"no"}">${c?"ano":"ne"}</td>`
      +(live?`<td class="no">–</td></tr>`:`<td class="${e?"yes":"no"}">${e?"ano":"ne"}</td></tr>`);
  }
  return (live?liveBox(l):"")
    +`<p class="lmeta"><b>${names[mi[l]]}</b>${okrSuf(mi[l])} · volby ${META.years[D.yr[l]]} · `
    +`${fmt.format(pop[l])} obyvatel · `
    +(isSplit(l)?`volební obvod ${D.mward[mi[l]]}, ${mand[l]} ${md(mand[l])} · `
                :`zastupitelstvo o ${mand[l]} členech · `)
    +`kandidátka ${listName(l)}</p>`
    +`<p class="lmeta">${fmt.format(D.pv[l])} ${hl(D.pv[l])} na ${ln} ${pl(ln,"kandidáta","kandidáty","kandidátů")} · průměr `
    +`${av.toLocaleString("cs-CZ",{maximumFractionDigits:2})}, hranice `
    +`${thr.toLocaleString("cs-CZ",{maximumFractionDigits:1})} ${Number.isInteger(thr)?hl(thr):"hlasu"} · `
    +(live?`mandáty zatím nerozdělené</p>`:`získala ${seats[l]} ${md(seats[l])}</p>`)
    +`<table class="lt"><thead><tr><th>Místo</th><th>Hlasů</th>`
    +`<th><span class="term" data-tip="Hlasy kandidáta v poměru k průměru na jednoho kandidáta téže kandidátky.">% průměru</span></th>`
    +`<th><span class="term" data-tip="Dosáhl na hranici pro přeskočení, tedy na celou část průměru zvýšenou o desetinu. Není to přesně 110 % ze sloupce vlevo, proto hranici překročí i kandidát se 105 %.">Nad hranicí</span></th>`
    +`<th>Zvolen</th></tr></thead><tbody>${rows}</tbody></table>`
    +`<div class="story">${live?liveStory(l):listStory(l)}</div>`;
}
// kandidátka z obce, kde se ještě sčítá: hlasy jsou jen z dosud sečtených okrsků
function liveBox(l){
  const [z,c]=LIVE.okr.get(D.mi[l])||[0,0];
  return `<p class="livebox"><b>Průběžný výsledek.</b> Sečteno ${fmt.format(z)} ${ze(c)} ${fmt.format(c)} `
    +`${pl(c,"okrsku","okrsků","okrsků")} (stav ${casTxt()}). Mandáty se rozdělí, až budou sečtené všechny `
    +`okrsky; do té doby se počty hlasů i hranice ještě mění.</p>`;
}
function liveStory(l){
  const ln=D.n[l],o=D.off[l],thr=thrOf(l);
  let cl=0;for(let i=0;i<ln;i++)if(bit(D.bCl,o+i))cl++;
  const thrTxt=`${thr.toLocaleString("cs-CZ",{maximumFractionDigits:1})} ${Number.isInteger(thr)?hl(thr):"hlasu"}`;
  return (cl===0?`Podle dosud sečtených hlasů zatím hranici ${thrTxt} nepřekročil nikdo.`
      :`Podle dosud sečtených hlasů zatím hranici ${thrTxt} ${prek(cl)} ${cl} ${kand(cl)}.`)
    +` Kolik mandátů kandidátka získá a komu připadnou, bude jasné, až budou sečtené všechny okrsky.`;
}
function listStory(l){
  const {off,n,votes,seats,bEl,bOr,bCl}=D;
  const ln=n[l],o=off[l],M=seats[l],thr=thrOf(l);
  if(M===0) return "Kandidátka nezískala žádný mandát, takže se pořadí na ní vůbec nestanovovalo. "
    +"Sloupec „nad hranicí“ je tu jen pro srovnání – na nic neměl vliv.";
  let cl=0,clUnder=0,moved=0,wEl=-1,bNe=-1;
  for(let i=0;i<ln;i++){
    const ix=o+i;
    if(bit(bCl,ix)){cl++;if(!bit(bOr,ix))clUnder++;}
    if(bit(bEl,ix)&&!bit(bOr,ix))moved++;
    if(bit(bEl,ix)){if(wEl<0||votes[ix]<votes[wEl])wEl=ix;}
    else if(bNe<0||votes[ix]>votes[bNe])bNe=ix;
  }
  let s="";
  const thrTxt=thr.toLocaleString("cs-CZ",{maximumFractionDigits:1});
  // „11 hlasu“ je špatně; celé číslo vyjde, když je celá část průměru dělitelná deseti
  const thrJ=Number.isInteger(thr)?hl(thr):"hlasu";
  const vic=cl>M?` Hranici přitom překročilo víc kandidátů, než kolik kandidátka získala mandátů, takže mezi nimi rozhodl počet hlasů.`:"";
  if(M>=ln) s=`Kandidátka získala tolik mandátů, kolik měla kandidátů. Zvoleni proto byli všichni a na pořadí vůbec nezáleželo.`;
  else if(cl===0) s=`Hranici ${thrTxt} ${thrJ} nepřekročil nikdo. Mandáty proto připadly ${M===1?"prvnímu místu":"prvním "+M+" místům"} v pořadí, které sestavila kandidátka, a na počtech hlasů nezáleželo.`;
  else if(moved>0){
    const kolik=moved===clUnder
      ? `takže ${moved===1?"jeden mandát změnil":fmt.format(moved)+" "+md(moved)+" "+pl(moved,"změnil","změnily","změnilo")} majitele`
      : `na mandát z nich ale ${moved===1?"dosáhl jen jeden, takže ten změnil":"dosáhli jen "+fmt.format(moved)+", takže tolik mandátů změnilo"} majitele`;
    s=`Hranici ${prek(cl)} ${cl} ${kand(cl)}, z toho ${clUnder} z míst pod čarou. `
     +`${clUnder===1?"Ten se posunul":"Ti se posunuli"} na začátek pořadí, ${kolik}.`+vic;
  }
  // někdo pod čarou hranici překročil, ale předběhli ho jiní, kdo ji překročili
  // s víc hlasy; výsledek je pak stejný, jako by rozhodlo jen pořadí
  else if(clUnder>0) s=`Hranici ${prek(cl)} ${cl} ${kand(cl)}, z toho ${clUnder} z míst pod čarou. ${clUnder===1?"Toho ale předběhli":"Ty ale předběhli"} jiní, kdo hranici překročili s víc hlasy, takže mandáty nakonec připadly stejným lidem, jako kdyby rozhodlo jen pořadí na lístku.`;
  else s=`Hranici ${prek(cl)} ${cl} ${kand(cl)}, ${cl===1?"byl ale ve volitelné části kandidátky i tak":"všichni ale byli ve volitelné části kandidátky i tak"}. Na obsazení mandátů to nemělo žádný vliv – rozhodlo pořadí na lístku.`;
  if(wEl>=0&&bNe>=0&&votes[bNe]>votes[wEl]){
    s+=` Nejslabší zvolený má ${fmt.format(votes[wEl])} ${hl(votes[wEl])}, nejsilnější nezvolený ${fmt.format(votes[bNe])}, tedy o ${fmt.format(votes[bNe]-votes[wEl])} víc.`;
  }
  return s;
}
// 1 -> one, 2-4 -> few, else many (22 reads "dvacet dva hlasů", so no modulo)
const pl=(n,one,few,many)=>n===1?one:(n>=2&&n<=4?few:many);
const hl=n=>pl(n,"hlas","hlasy","hlasů");
const kand=n=>pl(n,"kandidát","kandidáti","kandidátů");
const kl=n=>pl(n,"kandidátka","kandidátky","kandidátek");
const md=n=>pl(n,"mandát","mandáty","mandátů");
const prek=n=>pl(n,"překročil","překročili","překročilo");

/* ----------------------------------------------------------------- header */
const rokyTxt=()=>META.years[0]+"–"+META.years[META.years.length-1];
function cutText(R){
  return [
    S.years.size?[...S.years].sort().map(i=>META.years[i]).join(", "):"všechny volby "+rokyTxt(),
    regTxt(),
    S.bands.size?"obce "+bandsTxt():"všechny obce",
    S.typy.size===1?(S.typy.has(1)?"jen obce":"jen městské části a obvody"):null,
    !S.rivals.size?null
      :S.rivals.size===1&&S.rivals.has(0)?"obce s jedinou kandidátkou"
      :S.rivals.size===5&&!S.rivals.has(0)?"obce s aspoň dvěma kandidátkami"
      :[...S.rivals].sort((a,b)=>a-b).map(i=>RIV[i][0]).join(", ")+" kandidátek v obci",
    S.tags.size?[...S.tags].join(", "):"všechny kandidátky",
    posAll()?"všechna místa":posTxt(),
    `${fmt.format(R.munis.size)} ${pl(R.munis.size,"zastupitelstvo","zastupitelstva","zastupitelstev")}`].filter(Boolean).join(" · ");
}
function hero(R){
  const rest=R.el-R.jump-R.idle;
  const sh=v=>R.el?pc(100*v/R.el)+" %":"–";
  return `<p class="cutline">${cutText(R)}${liveNote()}</p><div class="hero">${dotPlot(R)}<div class="tally">`
    +`<div class="big3">`
    +`<div><span class="n">${fmt.format(R.cand)}</span><span class="l">kandidatur</span></div>`
    +`<div><span class="n">${fmt.format(R.el)}</span><span class="l">z nich získalo mandát</span></div>`
    +`<div><span class="n hot">${fmt.format(R.jump)}</span><span class="l">z nich díky `
    +`<span class="term" data-tip="Překročili hranici a posunuli se tím v pořadí na místo, které jim mandát přineslo.">přeskočení</span></span></div>`
    +`</div>`
    +`<p class="rest">Dalších <b>${fmt.format(R.idle)}</b> (${sh(R.idle)}) zvolených hranici také `
    +`překročilo, mandát by ale získali i podle pořadí. Zbylých <b>${fmt.format(rest)}</b> (${sh(rest)}) `
    +`zvolených na hranici nedosáhlo; <b>${fmt.format(R.elBelow)}</b> (${sh(R.elBelow)}) `
    +`nedosáhlo ani na průměr na své kandidátce.</p>`
    +`<p class="defn"><b>Hranice</b> se počítá z průměrného počtu hlasů na jednoho kandidáta téže `
    +`kandidátky: průměr se zaokrouhlí dolů na celé hlasy a zvýší o desetinu. Kdo jí dosáhne, posouvá `
    +`se na začátek pořadí; kdo ne, bere se v pořadí, které sestavila strana. Kvůli tomu zaokrouhlení `
    +`je hranice o něco níž než 110 % skutečného průměru, u malých kandidátek i znatelně.</p>`
    +`</div></div>`;
}
function examples(R,A,nEx){
  if(!A) return "";
  const l=A.l,ok=okrOf(D.mi[l]);
  const where=`<b>${esc(D.names[D.mi[l]])}</b> (${ok?"okres "+esc(ok)+", ":""}${fmt.format(D.pop[l])} obyvatel), `
    +`volby <b>${META.years[D.yr[l]]}</b>, kandidátka ${listInline(l)}`;
  // šipky stojí nad příkladem vlevo, takže se při rozbalení kandidátky neposouvají
  let h=`<div class="anec-nav"><span class="pager"><button type="button" id="anecPrev" aria-label="Předchozí příklad">‹</button>`
    +`<span>${fmt.format(anecIdx+1)} z ${fmt.format(nEx)}</span>`
    +`<button type="button" id="anecNext" aria-label="Další příklad">›</button></span>`
    +`<span class="chipwrap" id="anecMode">`
    +`<button type="button" class="chip" data-m="weak" aria-pressed="${anecMode==="weak"}">nejslabší vítěz</button> `
    +`<button type="button" class="chip" data-m="gap" aria-pressed="${anecMode==="gap"}">největší rozdíl</button></span></div>`;
  const av=avgOf(l),p=D.pos,vE=D.votes[A.iEl],vN=D.votes[A.iNe];
  h+=`<div class="anec">${where}: na <b>${p[A.iEl]}. místě</b> dostal kandidát `
    +`<b>${fmt.format(vE)}</b> ${hl(vE)}, tedy ${Math.round(100*vE/av)} % průměru kandidátky, `
    +`a mandát získal. Na <b>${p[A.iNe]}. místě</b> dostal kandidát <b>${fmt.format(vN)}</b> ${hl(vN)} `
    +`(${Math.round(100*vN/av)} %) a mandát nezískal.`;
  h+=`<div class="more"><details id="anecDet"${anecOpen?" open":""}><summary>Zobrazit celou kandidátku</summary>`
    +`<div id="anecList"></div></details></div></div>`;
  h+=`<p class="gen">Kandidátů, kteří měli víc hlasů než někdo zvolený z&nbsp;jejich vlastní `
    +`kandidátky, a přesto zvoleni nebyli, je ve výběru <b>${fmt.format(R.beat)}</b>. `
    +`Stalo se to na <b>${fmt.format(R.beatLists)}</b> ${R.beatLists===1?"kandidátce":"kandidátkách"} `
    +`z&nbsp;${fmt.format(R.seatLists)}, ${R.seatLists===1?"která nějaký mandát získala":"které nějaký mandát získaly"}.</p>`;
  return h;
}

function dotPlot(R){
  // three concentric rings; dots are laid out by angle, so each category
  // forms one clean wedge and the proportions read like a pie you can count
  const RINGS=[[30,74],[38,93],[46,112]];
  const full=RINGS.reduce((a,r)=>a+r[0],0);
  let rings=RINGS;
  // méně zvolených než teček: každá tečka je právě jeden mandát a na kruhy se
  // rozdělí úměrně jejich velikosti (zbytek dostanou kruhy s největší desetinnou částí)
  if(R.el<full){
    const want=RINGS.map(([c])=>c*R.el/full),cnt=want.map(w=>Math.floor(w));
    const left=R.el-cnt.reduce((a,b)=>a+b,0);
    want.map((w,i)=>[w-cnt[i],i]).sort((x,y)=>y[0]-x[0]).slice(0,left).forEach(([,i])=>cnt[i]++);
    rings=RINGS.map(([,r],i)=>[cnt[i],r]);}
  const dots=rings.reduce((a,r)=>a+r[0],0),per=dots?R.el/dots:0;
  const pts=[];
  rings.forEach(([cnt,rad])=>{for(let k=0;k<cnt;k++)pts.push({a:(k+0.5)/cnt,rad});});
  pts.sort((x,y)=>x.a-y.a);
  const mid=R.el-R.jump-R.idle-R.elBelow;         // nad průměrem, pod hranicí
  const G=[["zvolen díky přeskočení",R.jump,"získalo mandát přeskočením."],
           ["dosáhl na hranici, mandát by měl i podle pořadí",R.idle,
            "dosáhlo na hranici přeskočení, ale mandát by získali i podle pořadí."],
           ["na hranici nedosáhl, na průměr ano",mid,
            "získalo mandát, aniž by dosáhli na hranici přeskočení. Průměr kandidátky překročili."],
           ["nedosáhl ani na průměr kandidátky",R.elBelow,
            "získalo mandát, aniž by dosáhli aspoň průměru své kandidátky."]];
  const tipFor=gi=>{const v=G[gi][1],sh=R.el?100*v/R.el:0;
    return `${pc(sh)} % zvolených (${fmt.format(v)}) ${G[gi][2]}`;};
  const cum=[];let acc=0;G.forEach(([,v])=>{acc+=v;cum.push(acc);});
  const CX=125,CY=125,DR=6.2;
  let d="";
  pts.forEach((p,i)=>{
    const t=(i+0.5)*per;
    let gi=0;while(gi<3&&t>=cum[gi])gi++;
    const ang=p.a*2*Math.PI-Math.PI/2;
    const x=CX+Math.cos(ang)*p.rad,y=CY+Math.sin(ang)*p.rad;
    d+=`<circle class="d g${gi}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${DR}" `
      +`style="animation-delay:${Math.round(i*430/pts.length)}ms" `
      +`data-tip="${tipFor(gi)}"></circle>`;
  });
  const share=R.el?100*R.jump/R.el:0;
  d+=`<circle cx="${CX}" cy="${CY}" r="66" fill="var(--bg)"/>`
    +`<text class="ctr-n" x="${CX}" y="${CY+3}">${pc(share)} %</text>`
    +`<text class="ctr-l" x="${CX}" y="${CY+23}">mandátů díky přeskočení</text>`;
  // víc zvolených než teček: tečka zastupuje několik mandátů, číslo je zaokrouhlené
  const p1=Math.round(per*10)/10,pr=Math.round(per);
  const each=!R.el?`Ve výběru nikdo nezískal mandát.`
    :`Tečky jsou zvolení zastupitelé. `+(per===1?`Každá zastupuje jeden mandát.`
    :per<10?`Každá zastupuje přibližně ${p1.toLocaleString("cs-CZ")} ${Number.isInteger(p1)?md(p1):"mandátu"}.`
    :`Každá zastupuje přibližně ${fmt.format(pr)} ${md(pr)}.`);
  return `<div><svg class="donut" viewBox="0 0 250 250" role="img" `
    +`aria-label="Podíl mandátů získaných přeskočením">${d}</svg>`
    +`<p class="dotkey">`+G.map(([lab,v],i)=>{
        const col=["var(--hot)","#2A4FD0","#6E90E8","#B9CBF4"][i];
        return `<span data-tip="${tipFor(i)}"><i style="background:${col}"></i>${lab}`
          +`<b>${fmt.format(v)}</b></span>`;}).join("")+`</p>`
    +`<p class="dotnote">${each}</p></div>`;
}

/* ----------------------------------------------------------------- charts */
function funnel(R){
  const steps=[
    ["Nad průměrem své kandidátky",R.cl+R.high,"mají víc hlasů, než je průměr na kandidáta","s2",
      "Průměr je součet všech hlasů kandidátky dělený počtem jejích kandidátů. Být nad ním ještě nestačí."],
    ["Nad hranicí přeskočení",R.cl,"posouvají se na vrchol kandidátky společně s ostatními skokany","s3",
      "Hranice je průměr zaokrouhlený dolů na celé hlasy a zvýšený o desetinu, tedy nejvýš 110 % skutečného průměru."]];
  const max=Math.max(1,R.cand);
  $("fun").innerHTML=steps.map(([lab,v,note,cls,tip])=>
    `<div class="frow ${cls}"><div class="lab"><span class="term" data-tip="${tip}">${lab}</span><small>${note}</small></div>`
    +`<div class="ftrack"><div class="ffill" style="width:${Math.max(.4,100*v/max)}%"></div></div>`
    +`<div class="val">${fmt.format(v)}<small>${pc(100*v/max)} % kandidátů</small></div></div>`).join("");
  const seg=[["přeskočením získali mandát",R.jump,"var(--hot)",
      `${fmt.format(R.jump)} kandidátů přeskočením dosáhlo na mandát, který by jinak nezískali.`],
    ["mandát by získali i podle pořadí",R.idle,"var(--azure)",
      `${fmt.format(R.idle)} kandidátů bylo na kandidátce dost vysoko, takže by je zvolilo i samotné pořadí. `
      +`U ${fmt.format(R.needed)} z nich ale přeskočení přesto rozhodlo: kdyby hranici nepřekročili `
      +`jen oni, předběhli by je ostatní skokani zespodu.`],
    ["mandát na ně nezbyl, protože jiní skokani byli ještě úspěšnější",R.short,"var(--cool)",
      `${fmt.format(R.short)} kandidátů hranici překročilo, jenže kandidátka získala málo mandátů, takže je předběhli jiní skokani s více hlasy.`],
    ["jejich kandidátka nezískala mandát",R.noSeat,"var(--surface-2)",
      `${fmt.format(R.noSeat)} skokanů bylo na kandidátce, která neuspěla jako celek. Nezískal z ní mandát nikdo, takže přeskočení nemělo žádný následek.`]];
  const tot=seg.reduce((a,s)=>a+s[1],0)||1;
  $("stack").innerHTML=seg.map(([,v,c,tip])=>
    `<div style="width:${100*v/tot}%;background:${c}" data-tip="${tip}"></div>`).join("");
  $("skey").innerHTML=seg.map(([lab,,c])=>
    `<span><i style="background:${c}"></i><span>${lab}</span></span>`).join("");
}
function bandChart(B){
  const on_=i=>S.bands.size===0||S.bands.has(i);
  const W=820,H=24,G=7,LW=150,RW=70,bw=W-LW-RW,h=NB*(H+G);let s="";
  const v=[];
  for(let i=0;i<NB;i++)v.push(B.m[i]?100*B.d[i]/B.m[i]:null);
  const mx=Math.max(5,...v.filter(x=>x!=null));
  BLAB.forEach((lab,i)=>{
    const y=i*(H+G),on=on_(i),col=on?"var(--ink)":"var(--ink-3)";
    s+=`<text x="${LW-9}" y="${y+16}" text-anchor="end" font-size="12" fill="${col}">${lab}</text>`;
    if(v[i]==null){s+=`<text x="${LW}" y="${y+16}" font-size="12" fill="var(--ink-3)">–</text>`;return;}
    const rng=i===0?`do ${fmt.format(BANDS[i][1]-1)} obyvatel`
      :i===NB-1?`nad milion obyvatel`
      :`od ${fmt.format(BANDS[i][0])} do ${fmt.format(BANDS[i][1]-1)} obyvatel`;
    const tip=`V obcích ${rng} připadlo přeskočením ${pc(v[i])} % mandátů `
      +`(${fmt.format(B.d[i])} z ${fmt.format(B.m[i])}).`;
    s+=`<g data-tip="${tip}">`
      +`<rect x="${LW}" y="${y}" width="${bw}" height="${H}" fill="var(--surface)"/>`
      +`<rect x="${LW}" y="${y}" width="${Math.max(1,bw*v[i]/mx)}" height="${H}" fill="${on?"var(--hot)":"var(--hot-soft)"}"/>`
      +`<text x="${LW+bw+6}" y="${y+16}" font-size="12" fill="${col}">${pc(v[i])} %</text>`
      +`<rect x="0" y="${y}" width="${W}" height="${H}" fill="transparent"/></g>`;
  });
  const c=$("bandChart");c.setAttribute("viewBox",`0 0 ${W} ${h}`);c.innerHTML=s;
}
/* ----------------------------------------------------------------- render */
// příklady se listují bez nového průchodu daty a bez překreslení teček nad nimi
let EXS=[],RS=null,heroHtml="";
const exCmp=()=>anecMode==="gap"?(x,y)=>y.gap-x.gap||x.r-y.r:(x,y)=>x.r-y.r||y.gap-x.gap;
function drawExamples(){
  const box=$("exBox");if(!box)return;
  if(anecIdx>=EXS.length)anecIdx=0;
  const A=EXS.length?EXS[anecIdx]:null;
  box.innerHTML=examples(RS,A,EXS.length);
  if(!A)return;
  $("anecList").innerHTML=listTable(A.l,new Set([A.iEl,A.iNe]));
  $("anecDet").addEventListener("toggle",e=>{anecOpen=e.target.open;if(anecOpen)ensureNames();postHeight();});
  $("anecMode").onclick=e=>{const b=e.target.closest("button[data-m]");if(!b||b.dataset.m===anecMode)return;
    anecMode=b.dataset.m;EXS.sort(exCmp());anecIdx=0;drawExamples();postHeight();};
  $("anecPrev").onclick=()=>{anecIdx=(anecIdx-1+EXS.length)%EXS.length;drawExamples();postHeight();};
  $("anecNext").onclick=()=>{anecIdx=(anecIdx+1)%EXS.length;drawExamples();postHeight();};
}
function render(){
  if(!booted)return;
  const head=$("head"),fun=$("fun"),band=$("bandChart");
  if(!head&&!fun&&!band){if(searchRefresh)searchRefresh();postHeight();return;}
  const {R,B,EX}=scan();
  const cutEl=$("cut");
  if(cutEl)cutEl.innerHTML=(linked?"Výběr z průzkumníku výše: ":"")+cutText(R)+liveNote();
  broadcast();
  if(!R.cand){
    const msg='<div class="empty">Ve vybraném výběru nezůstal nikdo. Uvolněte některý filtr.'
      +(liveOn()?` ${liveNote()}`:"")+'</div>';
    if(head)head.innerHTML=msg;
    if(fun){fun.innerHTML=msg;$("stack").innerHTML="";$("skey").innerHTML="";}
    if(band)bandChart(B);
    postHeight();return;}
  if(head){
    if(!$("heroBox")){head.innerHTML='<div id="heroBox"></div><div id="exBox"></div>';heroHtml="";}
    // tečky se překreslí (a znovu rozběhnou) jen tehdy, když se změnila čísla
    const hh=hero(R);
    if(hh!==heroHtml){$("heroBox").innerHTML=hh;heroHtml=hh;}
    EXS=EX;RS=R;drawExamples();
  }
  if(fun)funnel(R);
  if(band)bandChart(B);
  if(searchRefresh)searchRefresh();
  postHeight();
}
let raf=0;const sched=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;render();});};
function setupTips(){
  const tip=document.createElement("div");tip.id="tip";document.body.appendChild(tip);
  const show=el=>{const t=el.getAttribute("data-tip");if(!t)return;
    tip.textContent=t;tip.classList.add("on");
    const r=el.getBoundingClientRect();
    tip.style.left=Math.min(window.innerWidth-12,Math.max(12,r.left+r.width/2))+"px";
    tip.style.top=(r.top-8)+"px";};
  const hide=()=>tip.classList.remove("on");
  document.addEventListener("mouseover",e=>{const el=e.target.closest("[data-tip]");el?show(el):hide();});
  document.addEventListener("focusin",e=>{const el=e.target.closest("[data-tip]");el?show(el):hide();});
  document.addEventListener("mouseleave",hide,true);
  addEventListener("scroll",hide,{passive:true});
}
let lastH=0;
function postHeight(){
  if(window.parent===window)return;
  const h=Math.ceil(document.documentElement.getBoundingClientRect().height);
  if(h===lastH)return;lastH=h;
  try{parent.postMessage({ih21Explorer:true,height:h},"*");}catch(e){}
}

/* ----------------------------------------------------------------- search */
function setupSearch(){
  // klíčem je kód obce, ne index v tabulce názvů: Praha se v roce 2010 volila
  // v sedmi obvodech, které by se jinak tvářily jako sedm různých obcí
  const byMuni=new Map();
  for(let l=0;l<D.L;l++){const c=D.mcode[D.mi[l]];
    if(!byMuni.has(c))byMuni.set(c,[]);byMuni.get(c).push(l);}
  // název a okres podle posledních voleb: obce se přejmenovávají a přecházejí mezi okresy
  // (Kyšice byly do roku 2018 v okrese Plzeň-sever, v roce 2026 jsou v Plzni-městě)
  const lastOf=c=>{const a=byMuni.get(c);return a[a.length-1];};
  const nameOf=c=>D.names[D.mi[lastOf(c)]];
  const norm=s=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  // "Praha hl.m." je v datech ČSÚ celé město; bez téhle úpravy se na dotaz
  // "praha" neukáže, protože abecedně leží až za Prahou 21
  const skey=n=>norm(n.replace(/\s*hl\.m\.$/,"").trim());
  const size=m=>{const ls=byMuni.get(m);
    const y=Math.max(...ls.map(l=>D.yr[l]));          // podle posledních voleb
    const w=new Set(ls.filter(l=>D.yr[l]===y).map(l=>D.mi[l]));
    let t=0;w.forEach(i=>{const f=ls.find(l=>D.mi[l]===i);t+=D.mand[f];});
    return w.size>1?t:D.mand[ls.find(l=>D.yr[l]===y)];};
  const idx=[...byMuni.keys()].map(m=>({m,name:nameOf(m),key:skey(nameOf(m)),
    full:norm(nameOf(m)),mand:size(m)}));
  const q=$("q"),hits=$("hits"),detail=$("detail");
  let curMuni=null,curList=null,found=null;
  const chipFor=(l,i)=>{
    const f=LISTS?LISTS.full(l):"",same=!f||f.toLowerCase()===(D.abbr[l]||"").toLowerCase();
    return `<button type="button" class="chip" data-l="${l}" aria-pressed="false"${same?"":` data-tip="${esc(f)}"`}>`
      +`${listChip(l,i)}</button>`;};
  // obec, kde se v roce 2026 nevolí: kandidátů bylo méně, než má zastupitelstvo členů
  const nekona=m=>!!LIVE&&LIVE.nekonaji.has(m)&&(S.years.size===0||S.years.has(LIVE.yi));
  const pending=l=>!!ST&&ST[l]===2;      // z obce ještě není sečtený ani jeden okrsek
  function show(m,keep){
    curMuni=m;
    // jedna obec má kandidátky z několika voleb; bez rozdělení po letech
    // vypadá seznam jako pět SNK vedle sebe
    const anyY=S.years.size===0;
    const ls=byMuni.get(m).filter(l=>anyY||S.years.has(D.yr[l]));
    if(!ls.length){
      detail.innerHTML=`<p class="sub" style="margin:14px 0 0">${nameOf(m)} – `
        +(nekona(m)?`volby ${META.years[LIVE.yi]} se tu kvůli nedostatku kandidátů nekonají.`
          :`ve vybraných volbách tu žádná kandidátka nekandidovala.`)+`</p>`;
      curList=null;postHeight();return;
    }
    const byYear=new Map();
    ls.forEach(l=>{const y=D.yr[l];if(!byYear.has(y))byYear.set(y,[]);byYear.get(y).push(l);});
    const years=[...byYear.keys()].sort((a,b)=>a-b);
    years.forEach(y=>byYear.get(y).sort((a,b)=>D.pv[b]-D.pv[a]));
    // na začátku největší kandidátka z posledních voleb, které už nějaké výsledky mají
    if(!keep||!ls.includes(curList)){
      const ys=years.filter(y=>byYear.get(y).some(l=>!pending(l)));
      curList=ys.length?byYear.get(ys[ys.length-1]).find(l=>!pending(l)):null;
    }
    detail.innerHTML=`<p class="sub" style="margin:14px 0 8px"><b>${nameOf(m)}</b>`
      +`${okrSuf(D.mi[lastOf(m)])} – `
      +`${fmt.format(ls.length)} ${kl(ls.length)} · `
      +(years.length===1?`volby ${META.years[years[0]]}`
        :`volby ${META.years[years[0]]}–${META.years[years[years.length-1]]}`)+`</p>`
      +`<div id="lchips">`+years.map(y=>{
        const lw=byYear.get(y),wards=[...new Set(lw.map(l=>D.mward[D.mi[l]]))].sort((a,b)=>a-b);
        if(lw.every(pending))return `<div class="yrow"><span class="yr">${META.years[y]}</span>`
          +`<span class="ych nr">výsledky ještě nejsou sečtené</span></div>`;
        const body=(wards.length>1||isSplit(lw[0]))
          ? wards.map(w=>`<span class="wd">obvod ${w}</span>`
              +lw.filter(l=>D.mward[D.mi[l]]===w).map((l,i)=>chipFor(l,i)).join(" ")).join(" ")
          : lw.map((l,i)=>chipFor(l,i)).join(" ");
        return `<div class="yrow"><span class="yr">${META.years[y]}</span><span class="ych">${body}</span></div>`;
      }).join("")+`</div><div id="lbody"></div>`;
    const draw=l=>{curList=l;
      [...$("lchips").querySelectorAll("button[data-l]")].forEach(x=>
        x.setAttribute("aria-pressed",+x.dataset.l===l));
      // kandidát nalezený podle jména je v tabulce zvýrazněný
      $("lbody").innerHTML=l===null?""
        :pending(l)?pendingBox(l)
        :listTable(l,found&&found.l===l?new Set([found.ix]):null);
      postHeight();};
    $("lchips").onclick=e=>{const b=e.target.closest("button[data-l]");if(!b)return;draw(+b.dataset.l);};
    draw(curList);
  }
  // ze zastupitelstva ještě nic nepřišlo; kdo hledal kandidáta, aspoň vidí, kde kandiduje
  function pendingBox(l){
    const who=found&&found.l===l&&NAMES?`${esc(NAMES.of(found.ix))} kandiduje na ${D.pos[found.ix]}. místě `
      +`kandidátky ${listInline(l)}. `:"";
    return `<p class="livebox"><b>Ještě nesečteno.</b> ${who}ČSÚ tu zatím nemá sečtený ani jeden `
      +`okrsek. Zkuste to později.</p>`;
  }
  searchRefresh=()=>{if(curMuni!==null)show(curMuni,true);};

  // hledání podle jména: každé slovo dotazu musí být začátkem některého slova
  // v příjmení nebo křestním jménu; prochází se tabulky jmen bez opakování,
  // takže stačí jeden průchod kandidáty s předem spočítanými shodami
  let nIdx=null;
  const NMAX=15;
  function findNames(v){
    const {sur,giv,si,gi}=NAMES;
    if(!nIdx){const w=s=>" "+norm(s).replace(/-/g," ");nIdx={sur:sur.map(w),giv:giv.map(w)};}
    const toks=v.split(" ").filter(Boolean),K=toks.length;
    // 1 = slovo začíná dotazem, 2 = slovo je celé shodné
    const hit=(arr,t)=>{const a=new Uint8Array(arr.length),p=" "+t,e=p+" ";
      for(let i=0;i<arr.length;i++){const s=arr[i];if(s.includes(p))a[i]=(s+" ").includes(e)?2:1;}return a;};
    const TS=toks.map(t=>hit(nIdx.sur,t)),TG=toks.map(t=>hit(nIdx.giv,t));
    const anyY=S.years.size===0,top=[];let count=0;
    for(let l=0;l<D.L;l++){
      if(!anyY&&!S.years.has(D.yr[l]))continue;
      const o=D.off[l];
      for(let ix=o;ix<o+D.n[l];ix++){
        let ex=0,ok=true;
        for(let k=0;k<K;k++){const s=TS[k][si[ix]],g=TG[k][gi[ix]];
          if(!s&&!g){ok=false;break;}if(s===2||g===2)ex++;}
        if(!ok)continue;
        count++;
        // nahoře celá jména, pak novější volby, zvolení a víc hlasů
        const key=ex*1e11+D.yr[l]*1e10+bit(D.bEl,ix)*1e9+D.votes[ix];
        if(top.length<NMAX||key>top[top.length-1].key){
          top.push({key,ix,l});top.sort((a,b)=>b.key-a.key);if(top.length>NMAX)top.pop();}
      }
    }
    return {top,count};
  }
  // jak je obec v roce 2026 sečtená; jen když jsou volby 2026 ve výběru
  const stTxt=m=>{
    if(!LIVE||!(S.years.size===0||S.years.has(LIVE.yi)))return "";
    if(LIVE.nekonaji.has(m))return " · volby se nekonají";
    let lo=3,hi=-1;
    for(const l of byMuni.get(m))if(D.yr[l]===LIVE.yi){lo=Math.min(lo,ST[l]);hi=Math.max(hi,ST[l]);}
    return hi<0?"":lo===2?" · zatím nesečteno":hi>0?" · průběžně":"";};
  const muniHit=o=>`<li><button type="button" data-m="${o.m}">${esc(o.name)}`
    +`<span>${okrOf(D.mi[lastOf(o.m)])||"–"} · ${o.mand} zastupitelů${stTxt(o.m)}</span></button></li>`;
  const candHit=({ix,l})=>{const ok=okrOf(D.mi[l]),s=ST?ST[l]:0,v=D.votes[ix];
    return `<li class="ch"><button type="button" data-c="${ix}" data-l="${l}">${esc(NAMES.of(ix))}`
      +`<span>${esc(D.names[D.mi[l]])}${ok?" ("+esc(ok)+")":""} · ${META.years[D.yr[l]]} · `
      +`${esc(D.abbr[l]||"–")} · ${D.pos[ix]}. místo · `
      +`${s===2?"zatím nesečteno":s===1?`průběžně ${fmt.format(v)} ${hl(v)}`:bit(D.bEl,ix)?"s mandátem":"bez mandátu"}`
      +`</span></button></li>`;};
  let waitNames=false;
  function runQuery(){
    const v=norm(q.value.trim());
    waitNames=false;
    if(v.length<2){hits.innerHTML="";postHeight();return;}
    const rank=o=>o.key===v?0:(o.key.startsWith(v)||o.full.startsWith(v))?1:2;
    const all=idx.filter(o=>o.key.includes(v)||o.full.includes(v))
      .sort((a,b)=>rank(a)-rank(b) || b.mand-a.mand || a.name.localeCompare(b.name,"cs"));
    const r=all.slice(0,15);
    const mh=r.map(muniHit).join("")
      +(all.length>r.length?`<li class="more">a dalších ${fmt.format(all.length-r.length)} – upřesněte dotaz</li>`:"");
    let nh="";
    if(v.length>=3){
      if(NAMES){const {top,count}=findNames(v);
        nh=top.map(candHit).join("")
          +(count>top.length?`<li class="more">a dalších ${fmt.format(count-top.length)} – upřesněte dotaz</li>`:"");}
      else if(!namesFailed){waitNames=true;nh='<li class="more">Jména kandidátů se ještě načítají…</li>';}
    }
    hits.innerHTML=mh&&nh?`<li class="hd">Obce</li>${mh}<li class="hd">Kandidáti</li>${nh}`
      :mh||nh||'<li><button type="button" disabled>Nic nenalezeno</button></li>';
    postHeight();
  }
  onNames=()=>{if(waitNames)runQuery();};
  q.addEventListener("input",()=>{ensureNames();ensureLists();runQuery();});
  hits.addEventListener("click",e=>{
    const c=e.target.closest("button[data-c]");
    if(c){const ix=+c.dataset.c,l=+c.dataset.l;
      found={ix,l};q.value=NAMES.of(ix);hits.innerHTML="";waitNames=false;
      curList=l;show(D.mcode[D.mi[l]],true);return;}
    const b=e.target.closest("button[data-m]");if(!b)return;
    found=null;q.value=nameOf(+b.dataset.m);hits.innerHTML="";waitNames=false;show(+b.dataset.m,false);});
}

/* --------------------------------------------------------------- controls */
function chips(host,items,isOn,onPick){
  host.innerHTML=items.map((t,i)=>`<button type="button" class="chip" data-i="${i}" aria-pressed="false">${t}</button>`).join(" ");
  host.onclick=e=>{const b=e.target.closest("button[data-i]");if(!b)return;onPick(+b.dataset.i);sync();sched();};
  return ()=>[...host.children].forEach((b,i)=>b.setAttribute("aria-pressed",isOn(i)));
}
let syncs=[];const sync=()=>syncs.forEach(f=>f());

const ABS=[["vše",1,70],["1.",1,1],["1.–3.",1,3],["1.–5.",1,5],["6. a dál",6,70],["11. a dál",11,70]];
const REL=[["celá",0,100],["prvních 5 %",0,5],["prvních 10 %",0,10],["prvních 20 %",0,20],["prvních 40 %",0,40],
           ["posledních 40 %",60,100],["posledních 20 %",80,100],["posledních 10 %",90,100],["posledních 5 %",95,100]];

/* -------------------------------------------- propojení embedů na jedné stránce */
// průzkumník posílá svůj výběr sousedním embedům (grafům) na téže stránce. Zprávy
// chodí jen mezi soubory z téže adresy, takže je nic jiného na stránce nepodvrhne.
let linked=false,lastSent="";
const srt=a=>[...a].sort((x,y)=>x<y?-1:x>y?1:0);
const ser=()=>({years:srt(S.years),bands:srt(S.bands),tags:srt(S.tags),kraje:srt(S.kraje),
  okresy:srt(S.okresy),typy:srt(S.typy),rivals:srt(S.rivals),posMode:S.posMode,
  absLo:S.absLo,absHi:S.absHi,relLo:S.relLo,relHi:S.relHi});
function applyState(o){
  const num=(a,max)=>Array.isArray(a)?a.filter(x=>Number.isInteger(x)&&x>=0&&x<max):[];
  const cl=(x,a,b,d)=>Number.isFinite(x)?Math.min(b,Math.max(a,x)):d;
  S.years=new Set(num(o.years,META.years.length));S.bands=new Set(num(o.bands,NB));
  S.tags=new Set((Array.isArray(o.tags)?o.tags:[]).filter(t=>META.tags.includes(t)));
  S.kraje=new Set(num(o.kraje,META.kraje.length));S.okresy=new Set(num(o.okresy,META.okresy.length));
  S.typy=new Set(num(o.typy,3));S.rivals=new Set(num(o.rivals,RIV.length));
  S.posMode=o.posMode==="rel"?"rel":"abs";
  S.absLo=cl(o.absLo,1,70,1);S.absHi=cl(o.absHi,1,70,70);S.relLo=cl(o.relLo,0,100,0);S.relHi=cl(o.relHi,0,100,100);
}
function siblings(msg){
  if(window.parent===window)return;
  try{for(let i=0;i<window.parent.length;i++){const w=window.parent[i];
    if(w!==window)w.postMessage(msg,location.origin);}}catch(e){}
}
function broadcast(){
  if(VIEW!=="pruzkumnik"||!booted)return;
  const s=JSON.stringify(ser());if(s===lastSent)return;lastSent=s;
  siblings({krizkometr:1,typ:"filtry",S:JSON.parse(s)});
}
addEventListener("message",e=>{
  const d=e.data;if(!d||d.krizkometr!==1||e.origin!==location.origin)return;
  if(d.typ==="dotaz"&&VIEW==="pruzkumnik"){lastSent="";broadcast();}
  else if(d.typ==="filtry"&&VIEW==="grafy"&&booted){applyState(d.S||{});linked=true;sched();}
});

/* ---------------------------------------------------------------- předvolby */
const LASTY=()=>META.years.length-1;
function clearS(){["years","bands","tags","kraje","okresy","typy","rivals"].forEach(k=>S[k].clear());
  S.posMode="abs";S.absLo=1;S.absHi=70;S.relLo=0;S.relHi=100;}
// předvolba nastaví celý výběr znovu, i rok: zvýrazněné tlačítko pak odpovídá tomu,
// co se opravdu počítá (dřív „Volby …“ zhaslo, ale rok ve filtru zůstal)
const PRESETS=[
  {lab:()=>"Volby "+META.years[LASTY()],set(){S.years.add(LASTY());}},
  {lab:()=>"Vše",set(){}},
  {lab:()=>"Velká města",set(){[8,9,10].forEach(b=>S.bands.add(b));}},
  {lab:()=>"Obce 5–10 tisíc",set(){S.bands.add(5);}},
  {lab:()=>"Spodní místa na kandidátkách",
   set(){S.posMode="rel";S.relLo=80;S.relHi=100;[1,2,3,4,5].forEach(r=>S.rivals.add(r));}}];
function applyPreset(p){clearS();p.set();}
function presetOn(p){const was=ser(),now=JSON.stringify(was);applyPreset(p);
  const would=JSON.stringify(ser());applyState(was);return now===would;}
function setupPresets(paintAbs,paintRel){
  const host=$("presets");if(!host)return;
  host.innerHTML=PRESETS.map((p,i)=>`<button type="button" class="chip pre" data-p="${i}" aria-pressed="false">${p.lab()}</button>`).join(" ");
  host.onclick=e=>{const b=e.target.closest("button[data-p]");if(!b)return;
    applyPreset(PRESETS[+b.dataset.p]);anecIdx=0;paintAbs();paintRel();sync();sched();};
  syncs.push(()=>[...host.children].forEach((b,i)=>b.setAttribute("aria-pressed",presetOn(PRESETS[i]))));
}

function boot(){
  $("boot").replaceWith($("tpl").content.cloneNode(true));
  fillRoky();
  // výchozí výběr jsou poslední volby, i ve čtečce kandidátek (ta jiný rok vybrat nedovolí)
  S.years.add(LASTY());
  if($("filters")){
  const toggle=(set,v)=>set.has(v)?set.delete(v):set.add(v);
  syncs.push(chips($("yearPre"),["vše"].concat(META.years.map(String)),
    i=>i===0?S.years.size===0:S.years.has(i-1),
    i=>{if(i===0)S.years.clear();else toggle(S.years,i-1);}));
  syncs.push(chips($("popPre"),["vše"].concat(BLAB),
    i=>i===0?S.bands.size===0:S.bands.has(i-1),
    i=>{if(i===0)S.bands.clear();else toggle(S.bands,i-1);}));
  const KR=["vše"].concat(META.kraje);
  syncs.push(chips($("krajPre"),KR,i=>i===0?S.kraje.size===0:S.kraje.has(i-1),
    i=>{if(i===0){S.kraje.clear();S.okresy.clear();}
        else{const k=i-1;
          if(S.kraje.has(k)){S.kraje.delete(k);
            [...S.okresy].forEach(o=>{if(META.okresy[o][1]===k)S.okresy.delete(o);});}
          else S.kraje.add(k);}}));
  const TY=[["obce",1],["městské části a obvody",2]];
  syncs.push(chips($("typPre"),["vše"].concat(TY.map(t=>t[0])),
    i=>i===0?S.typy.size===0:S.typy.has(TY[i-1][1]),
    i=>{if(i===0)S.typy.clear();
        else{const v=TY[i-1][1];S.typy.has(v)?S.typy.delete(v):S.typy.add(v);}}));
  // „2 a víc“ je jen zkratka: zapne všechny skupiny kromě obcí s jedinou kandidátkou
  const SOUT=[1,2,3,4,5];
  const rivLab=["vše","2 a víc"].concat(RIV.map(r=>r[0]));
  syncs.push(chips($("rivPre"),rivLab,
    i=>i===0?S.rivals.size===0
      :i===1?(S.rivals.size===SOUT.length&&!S.rivals.has(0))
      :S.rivals.has(i-2),
    i=>{if(i===0)S.rivals.clear();
        else if(i===1){const on=S.rivals.size===SOUT.length&&!S.rivals.has(0);
          S.rivals.clear();if(!on)SOUT.forEach(v=>S.rivals.add(v));}
        else{const v=i-2;S.rivals.has(v)?S.rivals.delete(v):S.rivals.add(v);}}));
  const okresBtn=()=>{
    const ks=[...S.kraje].sort((a,b)=>META.kraje[a].localeCompare(META.kraje[b],"cs"));
    $("okresBox").hidden=ks.length===0;
    $("okresPre").innerHTML=ks.map(k=>{
      const ids=META.okresy.map((_,i)=>i).filter(i=>META.okresy[i][1]===k)
        .sort((a,b)=>META.okresy[a][0].localeCompare(META.okresy[b][0],"cs"));
      const cely=!ids.some(i=>S.okresy.has(i));
      return `<div class="krow"><span class="kr">${META.kraje[k]}</span><span class="kch">`
        +`<button type="button" class="chip" data-k="${k}" aria-pressed="${cely}">celý kraj</button> `
        +ids.map(i=>`<button type="button" class="chip" data-o="${i}" `
          +`aria-pressed="${S.okresy.has(i)}">${META.okresy[i][0]}</button>`).join(" ")
        +`</span></div>`;}).join("");
  };
  $("okresPre").onclick=e=>{
    const k=e.target.closest("button[data-k]");
    if(k){const kk=+k.dataset.k;
      [...S.okresy].forEach(o=>{if(META.okresy[o][1]===kk)S.okresy.delete(o);});
      sync();sched();return;}
    const b=e.target.closest("button[data-o]");if(!b)return;
    const i=+b.dataset.o;S.okresy.has(i)?S.okresy.delete(i):S.okresy.add(i);
    sync();sched();};
  syncs.push(okresBtn);
  syncs.push(()=>{$("regSum").textContent=regTxt();});
  syncs.push(chips($("tagChips"),META.tags,i=>S.tags.has(META.tags[i]),
    i=>{const t=META.tags[i];S.tags.has(t)?S.tags.delete(t):S.tags.add(t);}));
  const fill=(el,lo,hi,min,max)=>{const a=(lo-min)/(max-min)*100,b=(hi-min)/(max-min)*100;
    el.style.left=a+"%";el.style.width=(b-a)+"%";};
  const absOut=()=>{$("absOut").textContent=(S.absLo===1&&S.absHi>=70)?"bez omezení":`${S.absLo}. až ${S.absHi}. místo`;
    fill($("absFil"),S.absLo,S.absHi,1,70);};
  const paintAbs=()=>{$("absLo").value=S.absLo;$("absHi").value=S.absHi;absOut();sched();};
  const readAbs=()=>{let a=+$("absLo").value,b=+$("absHi").value;
    if(a>b){if(document.activeElement===$("absLo"))b=a,$("absHi").value=b;else a=b,$("absLo").value=a;}
    S.absLo=a;S.absHi=b;absOut();sync();sched();};
  $("absLo").oninput=readAbs;$("absHi").oninput=readAbs;
  syncs.push(chips($("absPre"),ABS.map(p=>p[0]),i=>S.absLo===ABS[i][1]&&S.absHi===ABS[i][2],
    i=>{S.absLo=ABS[i][1];S.absHi=ABS[i][2];paintAbs();}));
  const relOut=()=>{$("relOut").textContent=(S.relLo===0&&S.relHi===100)?"celá kandidátka":`${S.relLo} – ${S.relHi} %`;
    fill($("relFil"),S.relLo,S.relHi,0,100);};
  const paintRel=()=>{$("relLo").value=S.relLo;$("relHi").value=S.relHi;relOut();sched();};
  const readRel=()=>{let a=+$("relLo").value,b=+$("relHi").value;
    if(a>b){if(document.activeElement===$("relLo"))b=a,$("relHi").value=b;else a=b,$("relLo").value=a;}
    S.relLo=a;S.relHi=b;relOut();sync();sched();};
  $("relLo").oninput=readRel;$("relHi").oninput=readRel;
  syncs.push(chips($("relPre"),REL.map(p=>p[0]),i=>S.relLo===REL[i][1]&&S.relHi===REL[i][2],
    i=>{S.relLo=REL[i][1];S.relHi=REL[i][2];paintRel();}));
  const MODES=[["podle čísla místa","abs"],["podle podílu délky","rel"]];
  $("posMode").innerHTML=MODES.map(([lab,m])=>
    `<button type="button" data-m="${m}" aria-pressed="false">${lab}</button>`).join("");
  $("posMode").onclick=e=>{const b=e.target.closest("button[data-m]");if(!b)return;
    S.posMode=b.dataset.m;sync();sched();};
  syncs.push(()=>{
    [...$("posMode").children].forEach(b=>b.setAttribute("aria-pressed",b.dataset.m===S.posMode));
    $("modeAbs").hidden=S.posMode!=="abs";
    $("modeRel").hidden=S.posMode!=="rel";
    $("posSum").textContent=posTxt();
  });
  const sums=()=>{
    $("yearSum").textContent=S.years.size?[...S.years].sort().map(i=>META.years[i]).join(", "):"vše";
    const ri=[...S.rivals].sort((a,b)=>a-b);
    const soutez=ri.length===5&&!S.rivals.has(0);
    const p=[bandsTxt()];
    if(S.typy.size===1)p.push(S.typy.has(1)?"obce":"městské části");
    if(soutez)p.push("2 a víc kand.");
    else if(ri.length)p.push(ri.length>2?ri.length+" skupiny":ri.map(i=>RIV[i][0]).join(", ")+" kand.");
    $("popSum").textContent=p.join(" · ");
    const ts=[...S.tags];
    $("tagSum").textContent=ts.length?(ts.length>2?ts.length+" stran":ts.join(", ")):"vše";
  };
  syncs.push(sums);
  // jen jedna rozbalená naráz, ať lišta zůstane nízká
  $("filters").addEventListener("toggle",e=>{
    if(e.target.open)[...$("filters").children].forEach(d=>{if(d!==e.target)d.open=false;});
    postHeight();},true);
  // v capture fázi, tedy dřív, než si tlačítko překreslí vlastní obsah a odpojí
  // se z DOMu – jinak by closest(".fg") vrátilo null a panel by se zavřel
  document.addEventListener("click",e=>{
    if(!e.target.closest(".fg"))[...$("filters").children].forEach(d=>d.open=false);},true);
  $("filters").addEventListener("submit",e=>e.preventDefault());
  setupPresets(paintAbs,paintRel);
  paintAbs();paintRel();
  }
  if($("q"))setupSearch();
  setupTips();
  booted=true;
  sync();render();
  addEventListener("resize",postHeight);
  if("ResizeObserver" in window)new ResizeObserver(()=>requestAnimationFrame(postHeight)).observe(document.documentElement);
  if(VIEW==="grafy")siblings({krizkometr:1,typ:"dotaz"});
  if($("q")||$("head"))prefetchNames();
  watchLive();
}
(async function(){
  try{
    const [a,b]=await Promise.all([fetchBytes(SOUBORY.vysledky),
      fetchBytes(SOUBORY26.vysledky,true).catch(()=>null)]);
    D0=D=parse(a);META=D.meta;
    // bez dat 2026 (chybí, nebo nesedí) nástroj běží dál nad lety 2006–2022
    if(b)try{useLive(parse(b));}catch(e){D=D0;}
    findSplits();countRivals();boot();
  }catch(e){$("boot").innerHTML='<div class="empty">Data se nepodařilo načíst ('+esc(e&&e.message||e)
    +'). Stránka potřebuje Chrome, Edge, Firefox&nbsp;113+ nebo Safari&nbsp;16.4+.</div>';}
})();
})();
