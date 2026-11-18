import type JSZipType from "jszip";

/* ——— Brand chips: LOGO ASLI tiap generator (file lokal di assets/logos,
   sumber: Wikimedia Commons & favicon resmi situs brand) ——— */
(function(){
  /* kind: cover = ikon app full-bleed · pad = mark transparan di tile putih · word = wordmark asli */
  var brands=[
    {n:"ChatGPT", f:"chatgpt.png", k:"cover"},
    {n:"OpenAI", f:"openai.png", k:"pad"},
    {n:"Midjourney", f:"midjourney.png", k:"cover"},
    {n:"Gemini", f:"gemini.png", k:"pad"},
    {n:"Stable Diffusion", f:"stability.png", k:"word"},
    {n:"Adobe Firefly", f:"firefly.png", k:"cover"},
    {n:"Meta AI", f:"metaai.png", k:"pad"},
    {n:"Leonardo", f:"leonardo.png", k:"cover"},
    {n:"Ideogram", f:"ideogram.png", k:"cover"},
    {n:"FLUX", f:"flux.png", k:"pad"},
    {n:"Sora", f:"sora.png", k:"cover"},
    {n:"Veo", f:"veo.png", k:"word"},
    {n:"Runway", f:"runway.png", k:"wordlight"},
    {n:"Kling", f:"kling.png", k:"cover"},
    {n:"Luma", f:"luma.png", k:"pad"}
  ];
  function chip(b, dup){
    var img;
    if(b.k==="word") img='<img class="brand-word" src="assets/logos/'+b.f+'" alt="'+(dup?"":"Logo "+b.n)+'" loading="lazy">';
    else if(b.k==="wordlight") img='<img class="brand-word light" src="assets/logos/'+b.f+'" alt="'+(dup?"":"Logo "+b.n)+'" loading="lazy">';
    else img='<img class="brand-logo '+b.k+'" src="assets/logos/'+b.f+'" alt="'+(dup?"":"Logo "+b.n)+'" loading="lazy">';
    /* ICON-ONLY: cuma logo/webicon, tanpa nama teks — nama tetap kebaca
       lewat title + alt buat yang butuh. Wordmark tampil lebih lebar. */
    var wide=(b.k==="word"||b.k==="wordlight") ? " wide" : "";
    return '<span class="brand-chip'+wide+'" title="'+b.n+'"'+(dup?' aria-hidden="true"':"")+'>'+img+'</span>';
  }
  var track=document.getElementById("brandTrack");
  if(track){
    /* marquee: dua set identik biar loop-nya mulus (translateX -50%);
       set kedua disembunyiin dari screen reader biar nggak kebaca dobel */
    track.innerHTML=brands.map(function(b){return chip(b,false)}).join("")+brands.map(function(b){return chip(b,true)}).join("");
  }
})();
var SIGNATURES=[
  {keys:["openai","dall-e","dall·e","dalle","chatgpt"], label:"OpenAI / DALL·E"},
  {keys:["midjourney"], label:"Midjourney"},
  {keys:["stable diffusion","stability ai","automatic1111","comfyui","invokeai"], label:"Stable Diffusion / ComfyUI"},
  {keys:["firefly","adobe photoshop","adobe firefly"], label:"Adobe Firefly"},
  {keys:["gemini","imagen","google ai","synthid"], label:"Gemini / Imagen"},
  {keys:["meta ai"], label:"Meta AI"},
  {keys:["leonardo.ai","leonardo ai"], label:"Leonardo AI"},
  {keys:["ideogram"], label:"Ideogram"},
  {keys:["black forest labs","flux."], label:"FLUX"},
  {keys:["bing image creator","microsoft designer","image creator"], label:"Bing Image Creator"},
  /* v:1 = tool video — labelnya cuma berlaku buat file video, nggak pernah buat foto */
  {keys:["sora"], label:"Sora (video)", v:1},
  {keys:["runway","gen-3","gen-4"], label:"Runway (video)", v:1},
  {keys:["veo","google veo","veo 3","veo3"], label:"Veo (video)", v:1},
  {keys:["kling"], label:"Kling (video)", v:1},
  {keys:["luma","dream machine"], label:"Luma (video)", v:1},
  {keys:["pika"], label:"Pika (video)", v:1},
  {keys:["hailuo","minimax"], label:"Hailuo / MiniMax (video)", v:1},
  {keys:["c2pa","content credentials","contentauthenticity","jumbf"], label:"Cap resmi “dibuat AI”"},
  {keys:["trainedalgorithmicmedia","digital source type"], label:"Penanda resmi konten AI"},
  {keys:["ai generated","generated with ai","made with ai","created with ai"], label:"Label: AI Generated"}
];
var items=[]; var idCounter=0; var deepClean=false; var outFormat="same"; var batchRunning=false; var dlMode="copy"; var procCurId=null;

function $(s){return document.querySelector(s)}
function $$(s){return Array.from(document.querySelectorAll(s))}
function ic(id,cls?){ return '<svg class="ic '+(cls||"ic-sm")+'" aria-hidden="true"><use href="#'+id+'"/></svg>'; }
function setPill(el,cls,icon,text){ if(!el) return; el.className="status-pill shrink-0 "+cls; el.innerHTML=ic(icon,"ic-sm")+escapeHtml(text); }
/* Panel proses DI DALAM kartu: status proses hidup di badan kartu file itu
   sendiri (bukan cuma di atas halaman), jadi selalu kelihatan pas user
   lagi megang / scroll kartu ini di HP. wait=true buat kartu antre. */
function setProc(item,label,wait){
  var p=document.getElementById("prog-"+item.id); if(!p) return;
  p.classList.remove("hidden");
  p.classList.toggle("is-wait", !!wait);
  var l=document.getElementById("prog-label-"+item.id); if(l) l.textContent=label;
}
function hideProc(item){ var p=document.getElementById("prog-"+item.id); if(p) p.classList.add("hidden"); }
/* Dock bawah nempel di atas batch bar kalo batch bar lagi tampil */
function syncDockBottom(){
  var dock=document.getElementById("procDock"); if(!dock) return;
  var bar=document.getElementById("batchBar");
  var barUp= bar && !bar.classList.contains("hidden");
  dock.style.bottom= barUp ? "calc(86px + env(safe-area-inset-bottom))" : "calc(14px + env(safe-area-inset-bottom))";
}
function formatBytes(b){ if(b===0) return "0 B"; var k=1024,s=["B","KB","MB","GB","TB","PB"],i=Math.min(s.length-1,Math.floor(Math.log(b)/Math.log(k))); return (b/Math.pow(k,i)).toFixed(i?1:0)+" "+s[i]; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]}); }
var toastTimer=null;
function toast(msg){ var t=$("#toast"); t.textContent=msg; t.classList.remove("hidden"); clearTimeout(toastTimer); toastTimer=setTimeout(function(){ t.classList.add("hidden"); },2600); }

/* ── Scan ──
   Dua penjaga biar nggak ada label hantu:
   1. Label tool video (v:1) cuma dicari di file video — foto nggak mungkin dari Veo/Sora/dll.
   2. Kunci pendek (≤4 huruf, mis. "veo") gampang muncul ACAK di byte data piksel
      terkompresi, jadi cuma dicari di dalam rangkaian teks tercetak (run ≥5 karakter) —
      metadata asli selalu teks tercetak, data piksel bukan. */
function scanBuffer(buf,kind){
  var full="";
  try{ full=new TextDecoder("utf-8",{fatal:false}).decode(buf); }catch(e){ full=""; }
  var hay=full.toLowerCase();
  var runs=(full.match(/[\x20-\x7E]{5,}/g)||[]).join("\n").toLowerCase();
  var found=[];
  SIGNATURES.forEach(function(sig){
    if(sig.v && kind!=="video") return;
    for(var k=0;k<sig.keys.length;k++){
      var key=sig.keys[k];
      var hit= key.length<=4 ? runs.indexOf(key)!==-1 : hay.indexOf(key)!==-1;
      if(hit){ found.push(sig.label); break; }
    }
  });
  var types=[];
  if(hay.indexOf("exif")!==-1) types.push("EXIF");
  if(hay.indexOf("http://ns.adobe.com/xap/1.0")!==-1 || hay.indexOf("<x:xmpmeta")!==-1) types.push("XMP");
  if(hay.indexOf("iptc")!==-1) types.push("IPTC");
  if(hay.indexOf("c2pa")!==-1 || hay.indexOf("jumbf")!==-1) types.push("C2PA");
  if(hay.indexOf("icc_profile")!==-1 || hay.indexOf("icc profile")!==-1) types.push("ICC");
  var interesting=[]; var seen={};
  var sample=full.slice(0, 4*1024*1024);
  var re=/(prompt|negative prompt|parameters|software|generator|workflow|seed|sampler|steps|cfg scale)[^\n\r]{0,120}/gi; var m;
  while((m=re.exec(sample))!==null && interesting.length<3){ var s=m[0].trim().replace(/\s+/g," "); if(s.length>8 && !seen[s]){ seen[s]=1; interesting.push(s.slice(0,140)); } }
  return {found:found, types:types, interesting:interesting, hasAI:found.length>0};
}

function getExt(name,type){ if(type==="image/png") return ".png"; if(type==="image/webp") return ".webp"; if(type==="image/jpeg") return ".jpg"; var d=name.lastIndexOf("."); return d!==-1? name.slice(d):".jpg"; }
function isVideoFile(f){ if(f.type && f.type.indexOf("video/")===0) return true; return /\.(mp4|mov|m4v|webm)$/i.test(f.name||""); }
function isMediaFile(f){ if(f.type && (f.type.indexOf("image/")===0 || f.type.indexOf("video/")===0)) return true; return /\.(jpe?g|png|webp|avif|mp4|mov|m4v|webm)$/i.test(f.name||""); }
function outName(item){
  var base=item.file.name.replace(/\.[^.]+$/,"");
  if(item.kind==="video") return dlMode==="same" ? item.file.name : base+"-clean"+getExt(item.file.name,item.file.type);
  var ext=getExt(item.file.name,item.cleanedType||item.file.type);
  return dlMode==="same" ? base+ext : base+"-clean"+ext;
}
function refreshNames(){
  items.forEach(function(it){
    if(!it.cleanedBlob) return;
    it.cleanedName=outName(it);
    var cn=document.getElementById("cname-"+it.id); if(cn) cn.textContent=it.cleanedName;
  });
}

/* ── Video scan: head + tail aja ── */
async function scanVideoFile(file){
  var size=file.size, headLen=Math.min(size,6*1024*1024), tailLen=Math.min(size,2*1024*1024);
  var head=await file.slice(0,headLen).arrayBuffer();
  var tail= size>headLen ? await file.slice(size-tailLen).arrayBuffer() : new ArrayBuffer(0);
  var combined=new Uint8Array(head.byteLength+tail.byteLength);
  combined.set(new Uint8Array(head),0); combined.set(new Uint8Array(tail),head.byteLength);
  var scan=scanBuffer(combined.buffer,"video");
  if(/\.(mp4|mov|m4v)$/i.test(file.name) || file.type==="video/mp4" || file.type==="video/quicktime"){
    var boxes=await listTopBoxes(file);
    var metaBoxes=boxes.filter(function(b){ return b.type==="meta"||b.type==="udta"||b.xmp; });
    if(metaBoxes.length && scan.types.indexOf("Catatan video")===-1) scan.types.push("Catatan video");
    (scan as any).mp4Boxes=boxes;
  }
  return scan;
}
async function walkBoxes(blob,base){
  var boxes=[], off=0, size=blob.size, guard=0;
  while(off+8<=size && guard++<128){
    var hdrBuf=await blob.slice(off,Math.min(size,off+16)).arrayBuffer();
    if(hdrBuf.byteLength<8) break;
    var dv=new DataView(hdrBuf);
    var sz=dv.getUint32(0);
    var type=String.fromCharCode(dv.getUint8(4),dv.getUint8(5),dv.getUint8(6),dv.getUint8(7));
    var total=sz, headerSize=8;
    if(sz===1){ if(hdrBuf.byteLength<16) break; total=Number(dv.getBigUint64(8)); headerSize=16; }
    else if(sz===0){ total=size-off; }
    if(total<8) break;
    boxes.push({type:type, offset:base+off, size:total, headerSize:headerSize, xmp:false});
    off+=total;
  }
  return boxes;
}
async function listTopBoxes(file){
  var boxes=await walkBoxes(file,0);
  for(var i=0;i<boxes.length;i++){
    var b=boxes[i];
    if(b.type==="moov" && b.size>16){
      var inner=await walkBoxes(file.slice(b.offset+b.headerSize, b.offset+b.size), b.offset+b.headerSize);
      inner.forEach(function(c){ c.insideMoov=true; boxes.push(c); });
    }
    if(b.type==="uuid"){
      var peek=await file.slice(b.offset, Math.min(b.offset+b.size, b.offset+262144)).arrayBuffer();
      var txt=""; try{ txt=new TextDecoder("utf-8",{fatal:false}).decode(peek).toLowerCase(); }catch(e){}
      b.xmp= txt.indexOf("xmp")!==-1 || txt.indexOf("c2pa")!==-1 || txt.indexOf("jumbf")!==-1;
    }
  }
  return boxes;
}

/* ── Scan foto: file gede cukup head + tail (metadata selalu di dua ujung itu),
   biar batch berisi foto besar nggak berat / nggak bikin browser ngelag ── */
async function scanImageFile(file){
  var size=file.size, headLen=Math.min(size,8*1024*1024), tailLen=Math.min(size,2*1024*1024);
  if(size<=headLen+tailLen) return scanBuffer(await file.arrayBuffer(),"image");
  var head=await file.slice(0,headLen).arrayBuffer();
  var tail=await file.slice(size-tailLen).arrayBuffer();
  var combined=new Uint8Array(head.byteLength+tail.byteLength);
  combined.set(new Uint8Array(head),0); combined.set(new Uint8Array(tail),head.byteLength);
  return scanBuffer(combined.buffer,"image");
}

/* ── File masuk → langsung dibersihin ── */
async function handleFiles(fileList: FileList | File[]){
  var files=Array.from(fileList).filter(isMediaFile);
  if(!files.length){ toast("Format tidak didukung."); return; }
  var created=[];
  for(var idx=0; idx<files.length; idx++){
    var file=files[idx];
    var kind=isVideoFile(file)?"video":"image";
    var scan;
    try{ scan= kind==="video" ? await scanVideoFile(file) : await scanImageFile(file); }
    catch(e){ scan={found:[], types:[], interesting:[], hasAI:false}; } /* 1 file gagal scan nggak boleh batalin 1 batch */
    var item={id:++idCounter, file:file, kind:kind, scan:scan, url:URL.createObjectURL(file), cleanedBlob:null, cleanedUrl:null, cleanedName:"", cleanedType:"", cleanedScan:null, status:"ready"};
    items.push(item); created.push(item); renderItem(item);
    if(kind==="image"){
      (function(it){ var img=new Image(); img.onload=function(){ var el=document.getElementById("dims-"+it.id); if(el) el.textContent=img.naturalWidth+" × "+img.naturalHeight+" · "; }; img.src=it.url; })(item);
    }
  }
  batchRunning=true; updateStats();
  /* Langsung bawa user ke kartu pertama: prosesnya kejadian DI kartu,
     jadi kartu itu yang harus ada di layar — bukan hero di atas. */
  var firstCard=document.getElementById("card-"+created[0].id);
  if(firstCard){
    var rm=!!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try{ firstCard.scrollIntoView({behavior: rm?"auto":"smooth", block:"start"}); }catch(e){ firstCard.scrollIntoView(); }
  }
  /* Progres batch hidup di dock bawah (selalu kelihatan pas scroll) +
     panel proses di dalam tiap kartu — bukan lagi bar di atas daftar. */
  var dock=$("#procDock"), dockBar=$("#procDockBar"), dockText=$("#procDockText");
  var done=0;
  function paint(){
    procCurId= done<created.length ? created[done].id : null;
    if(dockBar) dockBar.style.width=(created.length? Math.round(done/created.length*100):0)+"%";
    if(dockText) dockText.textContent= done>=created.length ? "Selesai" : "Membersihkan "+(done+1)+" dari "+created.length;
    syncDockBottom();
  }
  if(dock) dock.classList.remove("hidden");
  paint();
  for(var ci=0; ci<created.length; ci++){ await cleanItem(created[ci]); done++; paint(); }
  setTimeout(function(){ if(dock) dock.classList.add("hidden"); procCurId=null; },1200);
  batchRunning=false; updateStats();
  var okCount=created.filter(function(x){return x.cleanedBlob && x.cleanedScan && !x.cleanedScan.hasAI}).length;
  var residual=created.filter(function(x){return x.cleanedBlob && x.cleanedScan && x.cleanedScan.hasAI}).length;
  if(okCount===created.length) toast("Beres ✓ " + okCount + " file bersih.");
  else if(okCount>0) toast(okCount + "/" + created.length + " file bersih" + (residual ? " · " + residual + " masih ada label." : "."));
  else if(residual>0) toast(residual + " file masih ada label — coba Deep Clean.");
  else toast("Tidak ada yang bisa dibersihkan.");
}

function renderItem(item){
  $("#queueSection").classList.remove("hidden");
  var card=document.createElement("article");
  card.className="card p-3 flex gap-3 items-start item-enter is-processing";
  card.id="card-"+item.id;
  var thumbInner = item.kind==="video"
    ? '<video class="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover bg-black cursor-pointer block" src="'+item.url+'" muted playsinline preload="metadata" id="vthumb-'+item.id+'" title="Lihat besar"></video>'
    : '<img class="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover bg-neutral-100 dark:bg-neutral-800 cursor-pointer block" src="'+item.url+'" alt="Preview '+escapeHtml(item.file.name)+'" title="Lihat besar">';
  var thumb='<div class="thumb-wrap w-16 h-16 sm:w-20 sm:h-20">'+thumbInner+'<span class="scan-beam" aria-hidden="true"></span></div>';
  card.innerHTML=
    thumb+
    '<div class="min-w-0 flex-1">'+
      '<div class="flex items-start justify-between gap-2"><h4 class="font-semibold break-all">'+escapeHtml(item.file.name)+'</h4>'+
      '<span id="status-'+item.id+'" class="status-pill shrink-0 '+(item.scan.hasAI?'pill-detected':'pill-plain')+'">'+(item.scan.hasAI?ic("i-alert","ic-sm")+'Label AI':ic("i-check","ic-sm")+'Polos')+'</span></div>'+
      '<p class="file-meta" style="color:var(--muted)"><span id="dims-'+item.id+'"></span>'+formatBytes(item.file.size)+'</p>'+
      '<div class="card-progress is-wait" id="prog-'+item.id+'" role="status"><div class="cp-head"><span class="spinner" aria-hidden="true"></span><span id="prog-label-'+item.id+'">Menunggu…</span></div><div class="cp-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>'+
      '<div id="detect-'+item.id+'"></div>'+
      '<div class="flex flex-wrap gap-1.5 mt-2.5" id="badges-'+item.id+'"></div>'+
      '<div class="hidden" id="result-'+item.id+'"></div>'+
      '<div class="act-primary">'+
        '<button type="button" class="hidden flex-1 min-h-[50px] px-5 grad-bg text-white font-semibold text-[15px] btn-ic" data-act="save" data-id="'+item.id+'">'+ic("i-download")+'Simpan</button>'+
        '<button type="button" class="hidden min-h-[50px] px-5 font-semibold text-[15px] btn-ic" style="background:var(--fill);color:var(--label)" data-act="reclean" data-id="'+item.id+'" title="Bersihkan ulang pakai pengaturan sekarang" aria-label="Bersihkan ulang">'+ic("i-rotate")+'</button>'+
      '</div>'+
      '<div class="ios-group">'+
        '<button type="button" class="ios-row" data-act="meta" data-id="'+item.id+'" aria-expanded="false" aria-controls="fold-meta-'+item.id+'"><span class="icon-tile sm" style="margin-right:11px">'+ic("i-database","ic-sm")+'</span><span class="row-label">Metadata</span><svg class="chev ic ic-sm" aria-hidden="true"><use href="#i-chev"/></svg></button>'+
        '<div class="hidden" id="fold-meta-'+item.id+'"><div class="fold-pad"><div id="meta-body-'+item.id+'"><p class="text-[13.5px]" style="color:var(--muted)">Lagi dimuat\u2026</p></div></div></div>'+
        '<div class="ios-sep" aria-hidden="true"></div>'+
        '<button type="button" class="ios-row" data-act="more" data-id="'+item.id+'" aria-expanded="false" aria-controls="fold-more-'+item.id+'"><span class="icon-tile sm" style="margin-right:11px">'+ic(item.kind==="video" ? "i-film" : "i-repeat","ic-sm")+'</span><span class="row-label">'+(item.kind==="video" ? "Video" : "Konversi")+'</span><svg class="chev ic ic-sm" aria-hidden="true"><use href="#i-chev"/></svg></button>'+
      (item.kind==="video"
        ? '<div class="hidden" id="fold-more-'+item.id+'"><div class="fold-pad"><div class="flex flex-wrap gap-2 mt-2.5"><button type="button" class="min-h-[44px] px-4 font-bold text-[13px] btn-ic" style="background:var(--fill);color:var(--label);border-radius:980px" data-act="frame" data-id="'+item.id+'">'+ic("i-camera","ic-sm")+'Frame</button><button type="button" class="min-h-[44px] px-4 font-bold text-[13px] btn-ic" style="background:var(--fill);color:var(--label);border-radius:980px" data-act="compress" data-id="'+item.id+'">'+ic("i-compress","ic-sm")+'Kompres</button></div><div id="vid-out-'+item.id+'" class="mt-3"></div></div></div>'
        : '<div class="hidden" id="fold-more-'+item.id+'"><div class="fold-pad"><div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2.5"><label class="block"><span class="wf-lbl">'+ic("i-image","ic-sm")+' Format</span><select id="cv-fmt-'+item.id+'" class="wf-select"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label><label class="block"><span class="wf-lbl">'+ic("i-expand","ic-sm")+' Ukuran</span><select id="cv-size-'+item.id+'" class="wf-select"><option value="0">Asli</option><option value="2048">\u22642048</option><option value="1080">\u22641080</option><option value="720">\u2264720</option></select></label><label class="block"><span class="wf-lbl">'+ic("i-gauge","ic-sm")+' Kualitas</span><select id="cv-q-'+item.id+'" class="wf-select"><option value="92">92%</option><option value="85" selected>85%</option><option value="70">70%</option></select></label></div><div class="flex flex-wrap items-center gap-2 mt-3"><button type="button" class="min-h-[44px] px-5 grad-bg text-white font-bold text-[13px] btn-ic" data-act="convert" data-id="'+item.id+'">'+ic("i-repeat","ic-sm")+'Konversi</button><span id="cv-out-'+item.id+'" class="flex flex-wrap items-center gap-2"></span></div></div></div>')+
      '</div>'+
      '<div class="remove-wrap"><button type="button" class="btn-remove" data-act="remove" data-id="'+item.id+'">'+ic("i-trash","ic-sm")+'Hapus</button></div>'+
    '</div>';
  $("#list").appendChild(card);
  card.querySelector(item.kind==="video" ? "video" : "img").addEventListener("click",function(){ openPreview(item); });
  refreshBadges(item);
  if(item.kind==="video"){
    var vt=document.getElementById("vthumb-"+item.id) as HTMLVideoElement;
    if(vt) vt.addEventListener("loadedmetadata",function(){
      var el=document.getElementById("dims-"+item.id);
      if(el) el.textContent=(vt.videoWidth||"?")+" × "+(vt.videoHeight||"?")+" · "+(isFinite(vt.duration)? Math.round(vt.duration)+" dtk · ":"");
    });
  }
}

/* Logo asli per label sumber — file yang sama kayak marquee brand di hero.
   Label tanpa file logo ikon (cap resmi, penanda AI, Stable Diffusion, dll)
   tampil teks aja. */
var LABEL_LOGOS={
  "OpenAI / DALL·E":["openai.png","pad"],
  "Midjourney":["midjourney.png","cover"],
  "Adobe Firefly":["firefly.png","cover"],
  "Gemini / Imagen":["gemini.png","pad"],
  "Meta AI":["metaai.png","pad"],
  "Leonardo AI":["leonardo.png","cover"],
  "Ideogram":["ideogram.png","cover"],
  "FLUX":["flux.png","pad"],
  "Sora (video)":["sora.png","cover"],
  "Kling (video)":["kling.png","cover"],
  "Luma (video)":["luma.png","pad"]
};
function sourceBadge(label){
  var lg=LABEL_LOGOS[label];
  var img= lg ? '<img class="badge-logo '+lg[1]+'" src="assets/logos/'+lg[0]+'" alt="" aria-hidden="true">' : "";
  return '<span class="badge-ai badge-src">'+img+escapeHtml(label)+'</span>';
}
/* scan = hasil scan yang mau ditampilkan; default-nya scan awal file.
   finishClean memanggil dengan item.cleanedScan supaya kotak merah &
   chip merah dari scan AWAL hilang begitu re-scan bersih. */
function refreshBadges(item, scan?){
  var wrap=document.getElementById("badges-"+item.id); if(!wrap) return;
  var html="";
  /* Maksimal DUA chip biar kartu nggak rame: (1) sumber utama MERAH + logo
     aslinya, (2) satu chip ringkasan abu buat temuan lain + jenis catatan
     teknis (IPTC / C2PA / EXIF …) digabung pakai "·". */
  var s=scan||item.scan;
  var found=s.found, types=s.types;
  if(found.length){
    html+=sourceBadge(found[0]);
    var rest=found.slice(1).concat(types);
    if(s.interesting.length) rest.push("prompt / seed kebaca");
    if(rest.length) html+='<span class="badge-meta"'+(s.interesting.length?' title="'+escapeHtml(s.interesting.join(" · "))+'"':"")+'>'+escapeHtml(rest.join(" · "))+'</span>';
  } else if(types.length){
    html='<span class="badge-meta">'+escapeHtml(types.join(" · "))+'</span>';
    if(s.interesting.length) html+='<span class="badge-meta" title="'+escapeHtml(s.interesting.join(" · "))+'">prompt / seed kebaca</span>';
  } else {
    html='<span class="badge-meta">Metadata minim</span>';
  }
  wrap.innerHTML=html;
  /* Kotak merah ringkas kalo ada yang terdeteksi: satu baris nama labelnya aja —
     detail lengkapnya udah ada di chip di bawahnya. Kalo file aslinya polos,
     nggak usah kotak sama sekali (pill status udah bilang "Tidak ada label AI"). */
  var box=document.getElementById("detect-"+item.id);
  if(box){
    if(s.hasAI){
      box.innerHTML='<div class="detect-box" role="note"><p class="detect-head">'+ic("i-alert","ic-sm")+' Label AI ditemukan</p></div>';
    } else {
      box.innerHTML='';
    }
  }
}

/* ── Cleaning: video ── */
async function cleanVideoItem(item){
  var res=document.getElementById("result-"+item.id); var status=document.getElementById("status-"+item.id);
  var cardV=document.getElementById("card-"+item.id); if(cardV){ cardV.classList.add("is-processing"); cardV.classList.remove("is-done"); }
  item.status="cleaning";
  setPill(status,"pill-working","i-eraser","Proses…");
  setProc(item,"Membersihkan…",false);
  if(res) res.classList.add("hidden");
  try{
    if(/\.webm$/i.test(item.file.name)) throw new Error("WebM hanya bisa dicek. Pakai MP4 untuk dibersihkan.");
    var boxes=item.scan.mp4Boxes || await listTopBoxes(item.file);
    var targets=boxes.filter(function(b){ return b.type==="meta"||b.type==="udta"||(b.type==="uuid"&&b.xmp); });
    if(!targets.length) throw new Error(item.scan.hasAI ? "Label ditemukan, tapi tidak bisa dibuang dari sini." : "Video ini sudah polos.");
    var buf=await item.file.arrayBuffer();
    var u8=new Uint8Array(buf);
    var free=[0x66,0x72,0x65,0x65];
    targets.forEach(function(b){
      for(var k=0;k<4;k++) u8[b.offset+4+k]=free[k];
      /* Isi box sekalian dikosongin jadi nol: box "free" dilewati semua player &
         platform, dan teks labelnya beneran ilang dari file — bukan cuma ganti
         nama box (scan mentah byte-per-byte pun nggak nemu apa-apa lagi).
         Ukuran file tetap persis, struktur box tetap valid. */
      var start=b.offset+(b.headerSize||8), end=Math.min(u8.length, b.offset+b.size);
      for(var j=start;j<end;j++) u8[j]=0;
    });
    var blob=new Blob([u8],{type:item.file.type||"video/mp4"});
    item.cleanedBlob=blob; item.cleanedType=item.file.type; item.cleanedName=outName(item); item.status="cleaned";
    if(item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
    item.cleanedUrl=URL.createObjectURL(blob);
    /* Verifikasi kayak foto: scan ulang hasil bersihnya sebelum ngomong beres */
    setProc(item,"Cek ulang…",false);
    var vscan=null;
    try{ vscan=await scanVideoFile(new File([blob], item.file.name, {type:item.file.type||"video/mp4"})); }catch(e){}
    item.cleanedScan=vscan;
    var vmsg= vscan
      ? (vscan.hasAI
          ? 'Sisa: <b style="color:var(--red-text)">'+escapeHtml(vscan.found.join(", "))+'</b> · ukuran tetap '+formatBytes(blob.size)
          : 'Dicek ulang: 0 label · ukuran tetap '+formatBytes(blob.size))
      : 'Ukuran tetap '+formatBytes(blob.size);
    finishClean(item,res,status,vmsg);
  }catch(e){
    item.status="error";
    hideProc(item);
    if(cardV) cardV.classList.remove("is-processing");
    setPill(status,"pill-working","i-alert","Perhatian");
    if(res){ res.classList.remove("hidden"); res.innerHTML='<div class="error-box">'+escapeHtml(e.message)+'</div>'; }
  } finally { updateStats(); }
}

/* ── Cleaning: foto ── */
/* ── Strip metadata TANPA re-encode piksel (jalur lossless) ──
   Dipakai kalau Format = Asli, kualitas masih default (92), dan bukan
   Deep Clean: byte piksel disalin apa adanya, cuma potongan metadata
   yang dibuang — jadi ukuran hasil nyaris sama kayak file asli.
   ALLOWLIST (bukan denylist): cuma chunk/segment yang aman & perlu yang
   dipertahankan — sisanya dibuang, termasuk profil warna ICC (iCCP /
   APP2) yang tag teksnya bisa membawa string label AI, chunk bertipe
   non-standar (JUMB, c2pa, …), dan data trailing setelah EOI. Asumsi
   lama "ICC dipertahankan, bukan label AI" terbukti salah (Nov 2026:
   label OpenAI/C2PA lolos utuh di dalam iCCP/APP2). Tanpa profil ICC,
   gambar dirender sebagai sRGB — benar untuk hampir semua foto/web.
   File malformed → throw, biar pemanggil jatuh ke jalur canvas. */
function stripPngMeta(ab){
  var b=new Uint8Array(ab);
  if(b.length<8 || b[0]!==0x89 || b[1]!==0x50 || b[2]!==0x4E || b[3]!==0x47 || b[4]!==0x0D || b[5]!==0x0A || b[6]!==0x1A || b[7]!==0x0A) throw new Error("Bukan PNG.");
  /* ALLOWLIST: cuma chunk ini yang dipertahankan — chunk lain apa pun
     (iCCP, tEXt, iTXt, zTXt, eXIf, jumb, JUMB, c2pa, chunk tak dikenal)
     dibuang. Chunk setelah IEND juga ikut dibuang (loop berhenti di IEND). */
  var KEEP={ "IHDR":1, "PLTE":1, "IDAT":1, "IEND":1, "sRGB":1, "gAMA":1, "cHRM":1, "sBIT":1, "tRNS":1, "bKGD":1, "hIST":1, "pHYs":1, "sPLT":1, "tIME":1 };
  var out=[b.slice(0,8)], pos=8, seenIEND=false;
  while(pos+8<=b.length){
    var len=(b[pos]*0x1000000)+(b[pos+1]<<16)+(b[pos+2]<<8)+b[pos+3];
    if(len<0 || pos+12+len>b.length) throw new Error("PNG rusak.");
    var type=String.fromCharCode(b[pos+4],b[pos+5],b[pos+6],b[pos+7]);
    if(KEEP[type]) out.push(b.slice(pos,pos+12+len));
    if(type==="IEND"){ seenIEND=true; break; }
    pos+=12+len;
  }
  if(!seenIEND) throw new Error("PNG rusak.");
  var total=out.reduce(function(s,c){return s+c.length;},0), res=new Uint8Array(total), off=0;
  out.forEach(function(c){ res.set(c,off); off+=c.length; });
  return res.buffer;
}
function stripJpegMeta(ab){
  var b=new Uint8Array(ab);
  if(b.length<4 || b[0]!==0xFF || b[1]!==0xD8) throw new Error("Bukan JPEG.");
  /* APP1 (EXIF/XMP), APP2 (profil ICC — tag teks desc/cprt-nya bisa
     membawa string label AI, jadi dibuang; output dirender sRGB),
     APP11 (JUMBF/C2PA), APP13 (IPTC), COM (komentar). */
  var DROP={ 0xE1:1, 0xE2:1, 0xEB:1, 0xED:1, 0xFE:1 };
  var out=[b.slice(0,2)], pos=2, done=false;
  while(pos+2<=b.length){
    while(pos+1<b.length && b[pos]===0xFF && b[pos+1]===0xFF) pos++; /* byte isi 0xFF */
    if(b[pos]!==0xFF) throw new Error("JPEG rusak.");
    var marker=b[pos+1];
    if(marker===0xD9){ out.push(b.slice(pos,pos+2)); done=true; break; } /* EOI tanpa SOS — potong di sini, buang trailing */
    if(marker===0x01 || (marker>=0xD0 && marker<=0xD7)){ out.push(b.slice(pos,pos+2)); pos+=2; continue; } /* marker tanpa panjang */
    if(pos+4>b.length) throw new Error("JPEG rusak.");
    var len=(b[pos+2]<<8)|b[pos+3];
    if(len<2 || pos+2+len>b.length) throw new Error("JPEG rusak.");
    if(marker===0xDA){
      /* SOS: salin header segmen + scan data HANYA sampai EOI pertama.
         Byte 0xFF di scan data selalu diikuti 0x00 (stuffing), kecuali
         marker RSTn / EOI — jadi kemunculan 0xFFD9 pertama PASTI EOI.
         Data apa pun setelah EOI (trailing) dibuang, bukan disalin. */
      var scanStart=pos+2+len, eoi=-1;
      for(var j=scanStart;j+1<b.length;j++){ if(b[j]===0xFF && b[j+1]===0xD9){ eoi=j; break; } }
      out.push(eoi===-1 ? b.slice(pos) : b.slice(pos,eoi+2));
      done=true; break;
    }
    if(!DROP[marker]) out.push(b.slice(pos,pos+2+len));
    pos+=2+len;
  }
  if(!done) throw new Error("JPEG rusak.");
  var total=out.reduce(function(s,c){return s+c.length;},0), res=new Uint8Array(total), off=0;
  out.forEach(function(c){ res.set(c,off); off+=c.length; });
  return res.buffer;
}

/* Sniff format dari magic bytes, bukan dari File.type (yang cuma ikut
   ekstensi nama file): JPEG bernama ".png" harus di-strip sebagai JPEG,
   bukan dilempar ke canvas lalu jadi PNG ~7× lebih besar. */
function sniffImageKind(ab){
  var b=new Uint8Array(ab);
  if(b.length>=2 && b[0]===0xFF && b[1]===0xD8) return "image/jpeg";
  if(b.length>=8 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47) return "image/png";
  if(b.length>=12 && b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46 && b[8]===0x57 && b[9]===0x45 && b[10]===0x42 && b[11]===0x50) return "image/webp";
  if(b.length>=12 && b[4]===0x66 && b[5]===0x74 && b[6]===0x79 && b[7]===0x70){
    var brand=String.fromCharCode(b[8],b[9],b[10],b[11]);
    if(brand==="avif" || brand==="avis" || brand==="mif1") return "image/avif";
  }
  return "";
}

async function cleanItem(item){
  if(item.kind==="video"){ await cleanVideoItem(item); return; }
  var res=document.getElementById("result-"+item.id); var status=document.getElementById("status-"+item.id);
  var cardI=document.getElementById("card-"+item.id); if(cardI){ cardI.classList.add("is-processing"); cardI.classList.remove("is-done"); }
  item.status="cleaning";
  setPill(status,"pill-working","i-eraser","Proses…");
  setProc(item,"Membersihkan…",false);
  if(res) res.classList.add("hidden");
  try{
    var qNum=parseInt($("#qualityRange").value,10);
    /* Format asli dari magic bytes (bukan ekstensi nama file) — dipakai
       buat milih strip lossless & tipe output di bawah. */
    var ab0=null, realType="";
    try{ ab0=await item.file.arrayBuffer(); realType=sniffImageKind(ab0); }catch(e){}
    var fileType=realType||item.file.type||"image/png";
    var outType= outFormat==="same" ? (fileType==="image/avif" ? "image/png" : fileType) : outFormat;
    if(["image/jpeg","image/png","image/webp"].indexOf(outType)===-1) outType="image/png";
    var blob=null;
    /* Jalur lossless: Format Asli + kualitas default (92) + bukan Deep Clean +
       PNG/JPEG → buang metadata tanpa sentuh piksel, ukuran nyaris tetap.
       Hasil strip langsung di-scan ulang: kalau label MASIH kebaca
       (container apa pun yang lolos allowlist), blob lossless dibuang dan
       file jatuh ke jalur canvas — file nggak boleh pulang dengan label
       yang masih terdeteksi padahal canvas bisa menghapusnya. */
    if(outFormat==="same" && !deepClean && qNum===92 && outType===fileType && (fileType==="image/png"||fileType==="image/jpeg") && ab0){
      try{
        var lblob=new Blob([fileType==="image/png"?stripPngMeta(ab0):stripJpegMeta(ab0)],{type:fileType});
        var lscan=scanBuffer(await lblob.arrayBuffer(),"image");
        if(!lscan.hasAI) blob=lblob;
      }
      catch(_e){ blob=null; /* file aneh → jatuh ke jalur canvas di bawah */ }
    }
    if(!blob){
      var bmp=await createImageBitmap(item.file);
      var scale=deepClean?0.995:1;
      var cw=Math.max(1,Math.round(bmp.width*scale)), ch=Math.max(1,Math.round(bmp.height*scale));
      var canvas=document.createElement("canvas"); canvas.width=cw; canvas.height=ch;
      var ctx=canvas.getContext("2d");
      if(outType==="image/jpeg"){ ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,cw,ch); }
      ctx.drawImage(bmp,0,0,cw,ch);
      if(bmp.close) bmp.close();
      var quality= deepClean ? Math.min(qNum,88)/100 : qNum/100;
      blob=await new Promise<Blob | null>(function(resolve){ canvas.toBlob(resolve,outType,quality); });
      if(!blob) throw new Error("Browser gagal encode gambar ini.");
    }
    setProc(item,"Cek ulang…",false);
    var vscan=scanBuffer(await blob.arrayBuffer(),"image");
    item.cleanedBlob=blob; item.cleanedScan=vscan; item.cleanedType=outType; item.cleanedName=outName(item); item.status="cleaned";
    if(item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
    item.cleanedUrl=URL.createObjectURL(blob);
    finishClean(item,res,status, vscan.hasAI
      ? 'Sisa: <b style="color:var(--red-text)">'+escapeHtml(vscan.found.join(", "))+'</b> · coba Deep Clean · '+formatBytes(blob.size)
      : 'Dicek ulang: 0 label · '+formatBytes(blob.size));
  }catch(e){
    item.status="error";
    hideProc(item);
    if(cardI) cardI.classList.remove("is-processing");
    setPill(status,"pill-error","i-alert","Gagal");
    if(res){ res.classList.remove("hidden"); res.innerHTML='<div class="error-box">'+escapeHtml(e.message)+'</div>'; }
  } finally { updateStats(); }
}

function finishClean(item,res,status,msg){
  var verifyState= !item.cleanedScan ? "unverified" : (item.cleanedScan.hasAI ? "residual" : "clean");
  hideProc(item);
  var cardEl=document.getElementById("card-"+item.id);
  if(cardEl){ cardEl.classList.remove("is-processing"); cardEl.classList.add("is-done"); }
  var wc=document.getElementById("wf-clean-"+item.id); if(wc){ wc.classList.add("done"); var wd=wc.querySelector(".wf-dot"); if(wd) wd.textContent="\u2713"; }
  var ws=document.getElementById("wf-save-"+item.id); if(ws) ws.classList.add("active");
  setPill(status,verifyState==="clean"?"pill-clean":"pill-error",verifyState==="clean"?"i-check":"i-alert",verifyState==="clean"?"Bersih":verifyState==="residual"?"Label tersisa":"Belum terverifikasi");
  /* Badge & kotak deteksi ikut hasil BERSIH, bukan scan awal: kalau re-scan
     0 label, kotak merah "Label AI ditemukan" + chip merah harus hilang —
     kalau nggak, user baca kartu itu sebagai "label tetap ada". */
  if(item.cleanedScan) refreshBadges(item, item.cleanedScan);
  if(res){
    res.classList.remove("hidden");
    /* Jangan klaim bersih jika scan ulang mendeteksi sisa label atau gagal. */
    res.innerHTML=verifyState==="clean"
      ? '<div class="clean-box" role="status"><p class="clean-head"><span class="clean-check" aria-hidden="true">'+ic("i-check","ic-sm")+'</span> Sudah bersih</p><p class="clean-body">'+msg+'</p></div>'
      : '<div class="detect-box" role="status"><p class="detect-head">'+ic("i-alert","ic-sm")+(verifyState==="residual"?" Label masih terdeteksi":" Hasil belum terverifikasi")+'</p><p class="clean-body">'+msg+'</p></div>';
  }
  ["save","reclean"].forEach(function(act){ var b=document.querySelector('button[data-act="'+act+'"][data-id="'+item.id+'"]'); if(b) b.classList.remove("hidden"); });
}

/* ── Simpan: SATU tombol, jalurnya dipilih otomatis ──
   Di dalam frame aplikasi / HP: menu Bagikan (Simpan ke File).
   Di browser biasa: unduhan langsung. Nama-sama + Chrome desktop: dialog simpan. */
async function saveItem(item){
  if(!item || !item.cleanedBlob) return;
  if(dlMode==="same" && typeof (window as any).showSaveFilePicker==="function" && window.self===window.top){
    try{
      var mime=item.cleanedType||item.file.type||"application/octet-stream";
      var accept={}; accept[mime]=[getExt(item.file.name,mime)];
      var handle=await (window as any).showSaveFilePicker({ suggestedName:item.cleanedName||item.file.name, types:[{description:"File bersih", accept:accept}] });
      var w=await handle.createWritable(); await w.write(item.cleanedBlob); await w.close();
      toast("Tersimpan ✓");
      return;
    }catch(e){ if(e && e.name==="AbortError") return; }
  }
  var inFrame=false; try{ inFrame = window.self!==window.top; }catch(e){ inFrame=true; }
  var f=null;
  try{ f=new File([item.cleanedBlob], item.cleanedName, {type:item.cleanedType||item.cleanedBlob.type||"application/octet-stream"}); }catch(e){}
  if(f && navigator.canShare && navigator.canShare({files:[f]}) && (inFrame || /Android|iPhone|iPad/i.test(navigator.userAgent))){
    try{ await navigator.share({files:[f]}); return; }
    catch(e){ if(e && e.name==="AbortError") return; }
  }
  var a=document.createElement("a");
  a.href=item.cleanedUrl; a.download=item.cleanedName; a.rel="noopener"; a.style.display="none";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ a.remove(); },2000);
  toast("Mengunduh " + item.cleanedName);
}

function openPreview(item){
  var src=item.cleanedUrl||item.url;
  $("#previewName").textContent=(item.cleanedBlob? item.cleanedName : item.file.name);
  var body=$("#previewBody");
  body.innerHTML= item.kind==="video"
    ? '<video src="'+src+'" controls playsinline class="max-w-full max-h-[70vh] rounded-lg"></video>'
    : '<img src="'+src+'" alt="Hasil '+escapeHtml(item.file.name)+'" class="max-w-full max-h-[70vh] object-contain rounded-lg">';
  $("#previewModal").classList.remove("hidden");
}

/* ── Stats / batch bar ── */
function updateStats(){
  var cleaned=items.filter(function(i){return i.cleanedBlob}).length;
  /* "Bersih" dihitung dari re-scan, bukan dari ada-tidaknya blob bersih —
     file yang pill-nya "Label tersisa" nggak boleh kehitung bersih. */
  var verified=items.filter(function(i){return i.cleanedBlob && i.cleanedScan && !i.cleanedScan.hasAI}).length;
  $("#queueSection").classList.toggle("hidden", items.length===0);
  /* Layout bersih ala TinyPNG: begitu ada file di workspace, canvas upload,
     pengaturan, kartu alur & marquee disembunyiin — halaman fokus ke daftar
     file aja, dan "Mulai ulang" di header daftar jadi jalan reset-nya.
     Semua balik tampil otomatis pas daftar kosong lagi. */
  var busy=items.length>0;
  document.body.classList.toggle("has-files",busy); /* hero menyusut: kartu langsung di atas */
  ["dropZone","settingsCard","brandWrap"].forEach(function(id){ var el=document.getElementById(id); if(el) el.classList.toggle("hidden",busy); });
  syncDockBottom();
  $("#statsText").textContent= items.length? "· "+items.length+" file · "+verified+" bersih" : "";
  $("#batchBar").classList.toggle("hidden", cleaned<2);
  $("#batchStats").textContent= verified+" file bersih";
  $("#zipBtn").disabled= cleaned<2 || batchRunning;
  $("#zipBtn").innerHTML= ic("i-archive","ic-sm")+"<span>ZIP ("+cleaned+")</span>";
}

/* ── Mulai ulang: buang semua file, balik ke canvas upload ── */
function clearAllItems(){
  items.forEach(function(i){ URL.revokeObjectURL(i.url); if(i.cleanedUrl) URL.revokeObjectURL(i.cleanedUrl); });
  items=[]; $("#list").innerHTML="";
  var dock=$("#procDock"); if(dock) dock.classList.add("hidden"); procCurId=null;
  updateStats();
}

/* ── Input events ── */
var dz=$("#dropZone"), fi=$("#fileInput"), foi=$("#folderInput"), vi=$("#videoInput");
/* Jaring pengaman ekstra: klik dari input file nggak boleh naik ke mana-mana */
fi.addEventListener("click",function(e){ e.stopPropagation(); });
foi.addEventListener("click",function(e){ e.stopPropagation(); });
vi.addEventListener("click",function(e){ e.stopPropagation(); });
dz.addEventListener("click",function(e){ if((e.target as Element).closest("#folderBtn")||(e.target as Element).closest("#videoPickBtn")) return; if(e.target===fi||e.target===foi||e.target===vi) return; fi.click(); });
dz.addEventListener("keydown",function(e){ if((e.target as Element).closest("#folderBtn")||(e.target as Element).closest("#videoPickBtn")) return; if(e.key==="Enter"||e.key===" "){ e.preventDefault(); fi.click(); }});

/* ── Deteksi kemampuan perangkat — tampilan menyesuaikan OTOMATIS ──
   Prinsipnya: yang nggak didukung perangkat ini nggak ditampilin sama sekali.
   User nggak perlu baca teks "belum didukung" buat fitur yang ujung-ujungnya
   nggak jalan di perangkatnya — UI-nya langsung nunjukin yang beneran bisa:
   - Folder: tombol Pilih Folder cuma muncul kalo OS + browser beneran bisa
     milih folder (desktop). Di HP (Android / iOS / iPad) tombolnya hilang;
     di sana Pilih File udah cover 1 file (single) & banyak file (batch).
   - Sentuh murni (nggak ada drag & drop): judul dropzone jadi ajakan pilih
     file, bukan "drop", dan petunjuknya nyebut single + batch. */
var caps=(function(){
  var ua=navigator.userAgent||"";
  var mobileUA=/Android|iPhone|iPad|iPod/i.test(ua);
  var ipadDesktopUA=(navigator.platform==="MacIntel" && (navigator.maxTouchPoints||0)>1); /* iPad mode desktop: UA-nya kayak Mac, tapi picker folder tetap nggak ada */
  var folderApi=(typeof (window as any).showDirectoryPicker==="function") || ("webkitdirectory" in foi);
  var coarse=!!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  var fine=!!(window.matchMedia && window.matchMedia("(pointer: fine)").matches);
  /* Mode galeri: UA HP, iPad mode desktop, ATAU pointer utama kasar (sentuh).
     Pointer dicek juga karena WebView aplikasi kadang UA-nya generik / mode
     desktop — selama perangkat utamanya layar sentuh, picker-nya harus galeri. */
  return { folder: !mobileUA && !ipadDesktopUA && folderApi, touchOnly: coarse && !fine, coarse: coarse, mobile: mobileUA || ipadDesktopUA };
})();
(function applyCaps(){
  var fb=$("#folderBtn");
  if(fb && caps.folder) fb.style.removeProperty("display"); /* cuma muncul kalo beneran bisa dipakai */
  var title=$("#dzTitle"), hint=$("#dzHint");
  if(caps.mobile || caps.coarse){
    /* Di HP picker-nya harus GALERI (pemilih foto bawaan OS), bukan file
       manager. Kuncinya accept SATU kategori: "image/*" SAJA.
       Accept campuran "image/*,video/*" diterjemahkan Android jadi intent
       file umum, dan di HyperOS/MIUI (mis. Poco) serta banyak OEM lain itu
       ngebuka file explorer — persis bug yang dilaporkan. "image/*" saja
       dirutekan Android ke pemilih foto/galeri sistem.
       Video dipisah ke input & tombol sendiri dengan accept "video/*" saja,
       biar rutenya sama-sama ke pemilih media, bukan file manager.
       Batch tetap jalan: kedua input multiple, jadi user bisa nandain
       banyak foto/video sekaligus langsung di galeri. */
    fi.setAttribute("accept","image/*");
    fi.accept="image/*";
    var vpb=$("#videoPickBtn"); if(vpb) vpb.style.removeProperty("display");
    var pl=document.getElementById("pickLabelText"); if(pl) pl.textContent="Buka Galeri";
    if(title) title.textContent="Pilih dari galeri";
    if(hint) hint.textContent="1 atau banyak foto";
  } else if(caps.folder){
    if(hint) hint.textContent="Foto & video · file atau folder";
  }
})();

/* ── Pilih Folder — berlapis per OS / browser ──────────────────────────────
   Tombolnya sendiri cuma dirender kelihatan kalo caps.folder true (lihat
   deteksi di atas), jadi fungsi ini normalnya cuma kepanggil di desktop:
   1) Chrome / Edge desktop (Windows, Mac, Linux): showDirectoryPicker
      (File System Access API) — TAPI cuma kalo halaman nggak di dalam iframe,
      karena API itu ke-block di iframe lintas-origin; di sana langsung jalur 2.
   2) Browser desktop lain (Firefox, Safari, Chrome di iframe): input
      webkitdirectory — didukung semua browser desktop modern.
   3) Jaring pengaman: kalo kepanggil juga di perangkat tanpa folder,
      langsung buka picker banyak-file — tanpa pesan "belum didukung". */
async function collectFromDirHandle(dirHandle,out){
  var iter=null;
  try{ iter=dirHandle.values(); }catch(e){}
  if(!iter) return;
  var step;
  while(!(step=await iter.next()).done){
    var entry=step.value;
    if(entry.kind==="file"){ try{ out.push(await entry.getFile()); }catch(e){} }
    else if(entry.kind==="directory"){ await collectFromDirHandle(entry,out); }
  }
}
function folderUnsupportedOnThisDevice(){ return !caps.folder; }
async function pickFolder(){
  if(folderUnsupportedOnThisDevice()){
    /* Nggak pakai toast "belum didukung": tombolnya udah disembunyiin di
       perangkat kayak gini, jadi ini murni jaring pengaman — langsung buka
       picker banyak-file aja, persis yang user butuhin (single / batch). */
    fi.click();
    return;
  }
  var inFrame=false; try{ inFrame=window.self!==window.top; }catch(e){ inFrame=true; }
  if(typeof (window as any).showDirectoryPicker==="function" && !inFrame){
    try{
      var dirHandle=await (window as any).showDirectoryPicker();
      var picked=[];
      await collectFromDirHandle(dirHandle,picked);
      if(picked.length){ handleFiles(picked); }
      else toast("Folder kosong.");
      return;
    }catch(e){
      if(e && e.name==="AbortError") return; /* user batal milih: diam aja */
      /* error lain (API ke-block dsb.) → jatuh ke jalur input di bawah */
    }
  }
  foi.click();
}
$("#folderBtn").addEventListener("click",function(e){ e.stopPropagation(); pickFolder(); });
$("#videoPickBtn").addEventListener("click",function(e){ e.stopPropagation(); vi.click(); });
$("#addMoreBtn").addEventListener("click",function(){ fi.click(); });
$("#restartBtn").addEventListener("click",function(){
  clearAllItems();
  window.scrollTo({top:0,behavior:"smooth"});
  toast("Mulai ulang.");
});
/* Tombol "+ Taruh File" di topbar: pas canvas upload lagi tampil, anchor-nya
   scroll ke sana (default). Pas udah ada file (canvas disembunyiin), kliknya
   langsung buka picker file — sama kayak "+ Tambah". */
$("#topAddBtn").addEventListener("click",function(e){
  if(items.length>0){ e.preventDefault(); fi.click(); }
});
fi.addEventListener("change",function(){ handleFiles(fi.files); fi.value=""; });
foi.addEventListener("change",function(){ handleFiles(foi.files); foi.value=""; });
vi.addEventListener("change",function(){ handleFiles(vi.files); vi.value=""; });
["dragenter","dragover"].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.add("drop-drag"); }); });
["dragleave","drop"].forEach(function(ev){ dz.addEventListener(ev,function(e){ e.preventDefault(); dz.classList.remove("drop-drag"); }); });
/* Drop folder di desktop: telusuri isinya (termasuk subfolder) lewat
   webkitGetAsEntry — dataTransfer.files mentah nggak selalu lengkap per browser. */
function traverseEntry(entry,out){
  return new Promise<void>(function(resolve){
    if(!entry){ resolve(); return; }
    if(entry.isFile){
      entry.file(function(f){ out.push(f); resolve(); },function(){ resolve(); });
    } else if(entry.isDirectory){
      var reader=entry.createReader();
      var readBatch=function(){
        reader.readEntries(async function(entries){
          if(!entries.length){ resolve(); return; }
          for(var i=0;i<entries.length;i++){ await traverseEntry(entries[i],out); }
          readBatch(); /* readEntries harus dipanggil berulang sampai kosong */
        },function(){ resolve(); });
      };
      readBatch();
    } else resolve();
  });
}
async function filesFromDrop(dt){
  var out=[], usedEntries=false;
  if(dt.items && dt.items.length){
    var entries=[];
    for(var i=0;i<dt.items.length;i++){
      var it=dt.items[i];
      if(it.kind!=="file") continue;
      var en=null; try{ en=it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }catch(e){}
      if(en){ entries.push(en); usedEntries=true; }
    }
    if(usedEntries){
      for(var j=0;j<entries.length;j++){ await traverseEntry(entries[j],out); }
      if(out.length) return out;
    }
  }
  return Array.from(dt.files||[]);
}
dz.addEventListener("drop",async function(e){ e.preventDefault(); var dropped=await filesFromDrop(e.dataTransfer); handleFiles(dropped); });
document.addEventListener("paste",function(e){ if(e.clipboardData && e.clipboardData.files.length){ if(typeof routeFiles==="function") routeFiles(e.clipboardData.files); else handleFiles(e.clipboardData.files); } });
document.addEventListener("dragover",function(e){ e.preventDefault(); });
/* Drop di mana aja di halaman tetep nerima file — penting pas canvas upload
   lagi disembunyiin (udah ada file): user bisa drag file baru langsung ke
   daftar. Drop yang mendarat di dropzone sendiri diurus handler dropzone. */
document.addEventListener("drop",function(e){
  e.preventDefault();
  if(e.target && (e.target as Element).closest && (e.target as Element).closest("#dropZone")) return;
  var fs=e.dataTransfer && e.dataTransfer.files;
  if(fs && fs.length) handleFiles(fs);
});

/* ── Settings events ── */
$("#qualityRange").addEventListener("input",function(e){ $("#qVal").textContent=e.target.value; });
$$("[data-format]").forEach(function(b){ b.addEventListener("click",function(){ $$("[data-format]").forEach(function(x){ x.setAttribute("aria-pressed","false"); }); b.setAttribute("aria-pressed","true"); outFormat=b.dataset.format; }); });
$$("[data-mode]").forEach(function(b){ b.addEventListener("click",function(){ $$("[data-mode]").forEach(function(x){ x.setAttribute("aria-pressed","false"); }); b.setAttribute("aria-pressed","true"); deepClean=b.dataset.mode==="deep"; }); });
$$("[data-dl]").forEach(function(b){ b.addEventListener("click",function(){
  $$("[data-dl]").forEach(function(x){ x.setAttribute("aria-pressed","false"); }); b.setAttribute("aria-pressed","true"); dlMode=b.dataset.dl;
  refreshNames();
}); });

/* ── Per-item events ── */
$("#list").addEventListener("click",async function(e){
  var btn=(e.target as Element).closest("button[data-act]") as HTMLButtonElement; if(!btn) return;
  var it=items.find(function(i){return i.id===parseInt(btn.dataset.id,10)}); if(!it) return;
  if(btn.dataset.act==="save"){ var ws2=document.getElementById("wf-save-"+it.id); if(ws2){ ws2.classList.add("done"); ws2.classList.remove("active"); var wd2=ws2.querySelector(".wf-dot"); if(wd2) wd2.textContent="\u2713"; } saveItem(it); }
  else if(btn.dataset.act==="meta"){ var fm=document.getElementById("fold-meta-"+it.id); if(fm){ var openM=fm.classList.toggle("hidden")===false; btn.setAttribute("aria-expanded",openM?"true":"false"); if(openM){ loadMeta(it); setTimeout(function(){ fm.scrollIntoView({block:"nearest",behavior:"smooth"}); },60); } } }
  else if(btn.dataset.act==="more"){ var fo=document.getElementById("fold-more-"+it.id); if(fo){ var openF=fo.classList.toggle("hidden")===false; btn.setAttribute("aria-expanded",openF?"true":"false"); if(openF) setTimeout(function(){ fo.scrollIntoView({block:"nearest",behavior:"smooth"}); },60); } }
  else if(btn.dataset.act==="convert"){ await convertItem(it,btn); }
  else if(btn.dataset.act==="frame"){ await frameItem(it,btn); }
  else if(btn.dataset.act==="compress"){ await compressItem(it,btn); }
  else if(btn.dataset.act==="reclean"){ btn.disabled=true; await cleanItem(it); btn.disabled=false; toast("Dibersihin ulang ✓"); }
  else if(btn.dataset.act==="remove"){
    URL.revokeObjectURL(it.url); if(it.cleanedUrl) URL.revokeObjectURL(it.cleanedUrl);
    items=items.filter(function(i){return i.id!==it.id});
    var c=document.getElementById("card-"+it.id); if(c) c.remove();
    updateStats();
  }
});

/* ── Batch events ── */
/* Dock progres: "Lihat" lompat ke kartu yang lagi diproses saat ini */
$("#procDockBtn").addEventListener("click",function(){
  var el= procCurId ? document.getElementById("card-"+procCurId) : document.querySelector("#list .is-processing");
  if(el) el.scrollIntoView({behavior:"smooth",block:"center"});
});
$("#clearBtn").addEventListener("click",function(){ clearAllItems(); });
/* JSZip dimuat SEKALI pas pertama kali dibutuhin (tombol ZIP) — janjinya
   disimpan biar klik berikutnya langsung jalan tanpa muat ulang. */
/* JSZip dibundel Vite (npm jszip, di-pin) dan dimuat malas lewat dynamic
   import — chunk terpisah, baru diunduh pas user neken tombol ZIP. Pola yang
   sama dipakai nanti buat model AI (onnxruntime-web dsb.): jangan pernah
   dibundel ke JS awal. */
let JSZipCtor: typeof JSZipType | null = null;
let jszipPromise: Promise<typeof JSZipType> | null = null;
function loadJSZip(): Promise<typeof JSZipType> {
  if (JSZipCtor) return Promise.resolve(JSZipCtor);
  if (!jszipPromise) {
    jszipPromise = import("jszip").then(function (m) {
      JSZipCtor = m.default;
      return JSZipCtor;
    }).catch(function () {
      jszipPromise = null;
      throw new Error("JSZip gagal dimuat");
    });
  }
  return jszipPromise;
}
$("#zipBtn").addEventListener("click",async function(){
  var clean=items.filter(function(i){return i.cleanedBlob}); if(clean.length<2) return;
  var btn=this; btn.disabled=true; btn.innerHTML=ic("i-archive","ic-sm")+"<span>ZIP…</span>";
  try{ await loadJSZip(); }catch(e){ toast("ZIP gagal. Simpan satu-satu."); btn.disabled=false; updateStats(); return; }
  try{
    refreshNames();
    var zip=new JSZipCtor!(); var used={};
    clean.forEach(function(it){ var name=it.cleanedName; var n=2; while(used[name]){ name=it.cleanedName.replace(/(\.[^.]+)$/,"-"+(n++)+"$1"); } used[name]=1; zip.file(name,it.cleanedBlob); });
    var blob=await zip.generateAsync({type:"blob"});
    var url=URL.createObjectURL(blob);
    var inFrame=false; try{ inFrame = window.self!==window.top; }catch(e){ inFrame=true; }
    var f=null; try{ f=new File([blob],"foto-bersih.zip",{type:"application/zip"}); }catch(e){}
    var shared=false;
    if(f && navigator.canShare && navigator.canShare({files:[f]}) && (inFrame || /Android|iPhone|iPad/i.test(navigator.userAgent))){
      try{ await navigator.share({files:[f]}); shared=true; }catch(e){ if(e && e.name==="AbortError"){ btn.disabled=false; updateStats(); return; } }
    }
    if(!shared){
      var a=document.createElement("a"); a.href=url; a.download="foto-bersih.zip"; a.style.display="none";
      document.body.appendChild(a); a.click();
      setTimeout(function(){ a.remove(); URL.revokeObjectURL(url); },4000);
      toast("ZIP isi "+clean.length+" file diunduh ✓");
    }
  }catch(e){ toast("Gagal bikin ZIP: "+e.message); }
  btn.disabled=false; updateStats();
});
$("#previewClose").addEventListener("click",function(){ $("#previewModal").classList.add("hidden"); $("#previewBody").innerHTML=""; });
$("#previewModal").addEventListener("click",function(e){ if(e.target===this){ this.classList.add("hidden"); $("#previewBody").innerHTML=""; } });
document.addEventListener("keydown",function(e){ if(e.key==="Escape" && !$("#previewModal").classList.contains("hidden")){ $("#previewModal").classList.add("hidden"); $("#previewBody").innerHTML=""; } });
/* ═══════════ Satu alur utuh: semua file masuk ke workspace yang sama.
   Nggak ada lagi tool terpisah — deteksi, metadata, konversi & video
   hidup di dalam kartu file yang sama (lihat renderItem + fold-nya). ═══════════ */
function routeFiles(fileList){ handleFiles(fileList); }
function dlLink(blob,name,label){
  var url=URL.createObjectURL(blob);
  return '<a href="'+url+'" download="'+escapeHtml(name)+'" class="inline-flex items-center min-h-[44px] px-5 grad-bg text-white font-bold text-[13px] btn-ic" style="border-radius:980px">'+ic("i-download","ic-sm")+escapeHtml(label||"Simpan")+'</a>';
}
function badgeRow(scan){
  if(!scan.found.length && !scan.types.length) return '<span class="badge-meta">Metadata minim</span>';
  var html= scan.found.length ? sourceBadge(scan.found[0]) : "";
  var rest=scan.found.slice(1).concat(scan.types);
  if(rest.length) html+='<span class="badge-meta">'+escapeHtml(rest.join(" · "))+'</span>';
  return html;
}

/* ── Parser metadata mentah: JPEG EXIF + PNG chunks ── */
function parseJpegExif(buf){
  var rows=[], gps=null;
  try{
    var dv=new DataView(buf); if(dv.getUint16(0)!==0xFFD8) return {rows:rows,gps:gps};
    var off=2;
    while(off+4<dv.byteLength){
      var marker=dv.getUint16(off); if((marker&0xFF00)!==0xFF00) break;
      var len=dv.getUint16(off+2);
      if(marker===0xFFE1 && off+12<dv.byteLength){
        var s=""; for(var i=0;i<4;i++) s+=String.fromCharCode(dv.getUint8(off+4+i));
        if(s==="Exif"){
          var tiff=off+10, endian=dv.getUint16(tiff), le=endian===0x4949;
          var u16=function(o){return dv.getUint16(o,le)}, u32=function(o){return dv.getUint32(o,le)};
          var ifd0=tiff+u32(tiff+4);
          var readVal=function(type,count,vo){
            var sizes={1:1,2:1,3:2,4:4,5:8,7:1,9:4,10:8}; var total=(sizes[type]||1)*count;
            var base= total<=4 ? vo : tiff+u32(vo);
            if(type===2){ var str=""; for(var j=0;j<count;j++){ var c=dv.getUint8(base+j); if(c===0) break; str+=String.fromCharCode(c); } return str; }
            if(type===3) return u16(base); if(type===4) return u32(base);
            if(type===5) return (u32(base)/Math.max(1,u32(base+4))).toFixed(2);
            return count+" nilai";
          };
          var tagNames={0x010F:"Make (kamera)",0x0110:"Model",0x0112:"Orientasi",0x0131:"Software",0x0132:"Tanggal (EXIF)",0x013B:"Artist",0x010E:"Deskripsi",0x8298:"Copyright"};
          var n=u16(ifd0), exifPtr=0, gpsPtr=0;
          for(var e=0;e<n;e++){ var eo=ifd0+2+e*12, tag=u16(eo), type=u16(eo+2), cnt=u32(eo+4);
            if(tag===0x8769) exifPtr=u32(eo+8); else if(tag===0x8825) gpsPtr=u32(eo+8);
            else if(tagNames[tag]){ var v=readVal(type,cnt,eo+8); if(v!==""&&v!=null) rows.push([tagNames[tag],String(v).slice(0,120)]); } }
          if(exifPtr){ var eo2=tiff+exifPtr, n2=u16(eo2); for(var e2=0;e2<n2;e2++){ var x=eo2+2+e2*12, tg=u16(x);
            if(tg===0x9003) rows.push(["Tanggal asli foto",String(readVal(u16(x+2),u32(x+4),x+8)).slice(0,60)]);
            if(tg===0xA434) rows.push(["Lensa",String(readVal(u16(x+2),u32(x+4),x+8)).slice(0,80)]); } }
          if(gpsPtr){ var go=tiff+gpsPtr, ng=u16(go), lat=null,lon=null,latR="N",lonR="E";
            for(var g=0;g<ng;g++){ var ge=go+2+g*12, gt=u16(ge);
              if(gt===1) latR=String(readVal(2,u32(ge+4),ge+8)||"N");
              if(gt===3) lonR=String(readVal(2,u32(ge+4),ge+8)||"E");
              if(gt===2){ var b=tiff+u32(ge+8); lat=(u32(b)/Math.max(1,u32(b+4)))+(u32(b+8)/Math.max(1,u32(b+12)))/60+(u32(b+16)/Math.max(1,u32(b+20)))/3600; }
              if(gt===4){ var b2=tiff+u32(ge+8); lon=(u32(b2)/Math.max(1,u32(b2+4)))+(u32(b2+8)/Math.max(1,u32(b2+12)))/60+(u32(b2+16)/Math.max(1,u32(b2+20)))/3600; } }
            if(lat!=null&&lon!=null){ if(latR==="S")lat=-lat; if(lonR==="W")lon=-lon; gps={lat:lat.toFixed(6),lon:lon.toFixed(6)}; rows.push(["GPS ⚠",lat.toFixed(6)+", "+lon.toFixed(6)]); }
            else gps={present:true}; }
        }
      }
      if(marker===0xFFDA) break; off+=2+len;
    }
  }catch(e){/* parser gagal = rows seadanya */}
  return {rows:rows,gps:gps};
}
function parsePngChunks(buf){
  var rows=[];
  try{
    var dv=new DataView(buf); if(dv.getUint32(0)!==0x89504E47) return rows;
    var off=8, text=[];
    while(off+12<=dv.byteLength){
      var len=dv.getUint32(off), type=""; for(var i=0;i<4;i++) type+=String.fromCharCode(dv.getUint8(off+4+i));
      if(type==="tEXt"||type==="iTXt"){ var str=""; for(var j=0;j<Math.min(len,300);j++){ var c=dv.getUint8(off+8+j); str+= (c>=32&&c<127)? String.fromCharCode(c):" "; } text.push(str.trim().replace(/\s+/g," ").slice(0,140)); }
      else rows.push([type,"chunk · "+formatBytes(len)]);
      off+=12+len; if(type==="IEND") break;
    }
    text.slice(0,4).forEach(function(t){ if(t) rows.push(["PNG text",t]); });
  }catch(e){}
  return rows;
}
async function metaRowsFor(file){
  var rows=[["Nama file",file.name],["Tipe",file.type||"—"],["Ukuran",formatBytes(file.size)],["Terakhir diubah",new Date(file.lastModified).toLocaleString("id-ID")]];
  var gps=null;
  if(isVideoFile(file)){
    var boxes=[]; try{ boxes=await listTopBoxes(file); }catch(e){}
    boxes.slice(0,14).forEach(function(b){ rows.push(["Bagian file: "+b.type,formatBytes(b.size)+(b.xmp?" · ada cap AI di bagian ini":"")]); });
  } else {
    var buf=await file.slice(0,Math.min(file.size,12*1024*1024)).arrayBuffer();
    if(file.type==="image/jpeg"||/\.jpe?g$/i.test(file.name)){ var ex=parseJpegExif(buf); rows=rows.concat(ex.rows); gps=ex.gps; }
    if(file.type==="image/png"||/\.png$/i.test(file.name)){ rows=rows.concat(parsePngChunks(buf)); }
  }
  return {rows:rows,gps:gps};
}

/* ═══════════ Olah lanjut DI KARTU YANG SAMA — metadata · konversi · video.
   Semua jalan dari file yang udah ada di workspace: nggak upload ulang,
   nggak pindah tool. ═══════════ */
async function loadMeta(item){
  var body=document.getElementById("meta-body-"+item.id);
  if(!body || body.dataset.loaded) return;
  try{
    var meta=await metaRowsFor(item.file);
    var rowsHtml=meta.rows.map(function(r){ return '<tr><th>'+escapeHtml(r[0])+'</th><td colspan="2">'+escapeHtml(r[1])+'</td></tr>'; }).join("");
    var hasC2PA= item.scan.types.indexOf("C2PA")!==-1 || item.scan.found.indexOf("Cap resmi \u201cdibuat AI\u201d")!==-1;
    var c2paLine= hasC2PA
      ? '<div class="detect-box" role="note"><p class="detect-head">'+ic("i-alert","ic-sm")+' Cap resmi “dibuat pakai AI”</p></div>'
      : '<p class="text-[14px] leading-relaxed" style="color:var(--muted)">Cap AI resmi: tidak ditemukan.</p>';
    var gpsWarn= meta.gps ? '<div class="detect-box" role="note" style="margin-top:8px"><p class="detect-head">'+ic("i-alert","ic-sm")+' GPS di file asli</p></div>' : "";
    body.dataset.loaded="1";
    body.innerHTML= c2paLine + gpsWarn +
      '<div class="meta-scroll mt-2"><table class="meta-table"><tbody>'+rowsHtml+'</tbody></table></div>';
  }catch(e){
    body.innerHTML='<p class="text-[14px] font-semibold" style="color:var(--red-text)">Gagal baca metadata file ini.</p>';
  }
}

async function convertItem(item,btn){
  var out=document.getElementById("cv-out-"+item.id); if(!out) return;
  btn.disabled=true;
  out.innerHTML='<span class="text-[14px] font-semibold" style="color:var(--muted)">Lagi dikonversi\u2026</span>';
  try{
    var fmt=(document.getElementById("cv-fmt-"+item.id) as HTMLSelectElement).value;
    var max=parseInt((document.getElementById("cv-size-"+item.id) as HTMLSelectElement).value,10)||0;
    var q=(parseInt((document.getElementById("cv-q-"+item.id) as HTMLSelectElement).value,10)||85)/100;
    var bmp=await createImageBitmap(item.file);
    var scale=1;
    if(max>0){ var m=Math.max(bmp.width,bmp.height); if(m>max) scale=max/m; }
    var cw=Math.max(1,Math.round(bmp.width*scale)), ch=Math.max(1,Math.round(bmp.height*scale));
    var canvas=document.createElement("canvas"); canvas.width=cw; canvas.height=ch;
    var ctx=canvas.getContext("2d");
    if(fmt==="image/jpeg"){ ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,cw,ch); }
    ctx.drawImage(bmp,0,0,cw,ch); if(bmp.close) bmp.close();
    var blob=await new Promise<Blob | null>(function(r){ canvas.toBlob(r,fmt,q); });
    if(!blob) throw new Error("Browser gagal encode gambar ini.");
    var ext= fmt==="image/png" ? ".png" : (fmt==="image/webp" ? ".webp" : ".jpg");
    var name=item.file.name.replace(/\.[^.]+$/,"")+"-konversi"+ext;
    var url=URL.createObjectURL(blob);
    var pct=Math.round(blob.size/item.file.size*100);
    out.innerHTML='<a href="'+url+'" download="'+escapeHtml(name)+'" class="inline-flex items-center min-h-[44px] px-5 grad-bg text-white font-bold text-[13px] btn-ic" style="border-radius:980px">'+ic("i-download","ic-sm")+'Simpan</a><span class="text-xs font-semibold" style="color:var(--muted)">'+cw+' \u00d7 '+ch+' \u00b7 '+formatBytes(item.file.size)+' \u2192 '+formatBytes(blob.size)+' ('+pct+'%)</span>';
    toast("Konversi beres \u2713");
  }catch(e){
    out.innerHTML='<span class="text-[14px] font-semibold" style="color:var(--red-text)">Gagal: '+escapeHtml(e.message)+'</span>';
  }
  btn.disabled=false;
}

async function frameItem(item,btn){
  var out=document.getElementById("vid-out-"+item.id); if(!out) return;
  btn.disabled=true;
  out.innerHTML='<p class="text-[14px] font-semibold" style="color:var(--muted)">Lagi ambil frame\u2026</p>';
  try{
    var v=document.createElement("video");
    v.muted=true; v.playsInline=true; v.preload="auto"; v.src=item.url;
    await new Promise<void>(function(res,rej){
      var to=setTimeout(res,5000);
      v.addEventListener("loadedmetadata",function(){ clearTimeout(to); res(); },{once:true});
      v.addEventListener("error",function(){ clearTimeout(to); rej(new Error("Video nggak kebaca browser.")); },{once:true});
    });
    var t=(isFinite(v.duration)&&v.duration>0) ? Math.min(1,v.duration/2) : 0;
    await new Promise<void>(function(res){
      var to=setTimeout(res,5000);
      v.addEventListener("seeked",function(){ clearTimeout(to); res(); },{once:true});
      try{ v.currentTime=t; }catch(e){ clearTimeout(to); res(); }
    });
    if(!v.videoWidth) throw new Error("Frame belum kebaca — coba lagi.");
    var canvas=document.createElement("canvas"); canvas.width=v.videoWidth; canvas.height=v.videoHeight;
    canvas.getContext("2d").drawImage(v,0,0);
    var blob=await new Promise<Blob | null>(function(r){ canvas.toBlob(r,"image/jpeg",0.92); });
    if(!blob) throw new Error("Gagal ambil frame.");
    var name=item.file.name.replace(/\.[^.]+$/,"")+"-frame.jpg";
    var url=URL.createObjectURL(blob);
    out.innerHTML='<img src="'+url+'" alt="Frame dari video" class="frame-shot w-full"><div class="mt-2 flex items-center gap-2 flex-wrap"><a href="'+url+'" download="'+escapeHtml(name)+'" class="inline-flex items-center min-h-[44px] px-5 grad-bg text-white font-bold text-[13px] btn-ic" style="border-radius:980px">'+ic("i-download","ic-sm")+'Frame</a><span class="text-xs font-semibold" style="color:var(--muted)">JPG \u00b7 '+formatBytes(blob.size)+'</span></div>';
    toast("Frame keambil \u2713");
  }catch(e){
    out.innerHTML='<p class="text-[14px] font-semibold" style="color:var(--red-text)">'+escapeHtml(e.message)+'</p>';
  }
  btn.disabled=false;
}

async function compressItem(item,btn){
  var out=document.getElementById("vid-out-"+item.id); if(!out) return;
  btn.disabled=true;
  try{
    if(typeof MediaRecorder==="undefined") throw new Error("Browser ini nggak bisa kompres video.");
    out.innerHTML='<p class="text-[14px] font-semibold flex items-center gap-2"><span class="spinner" aria-hidden="true"></span> Lagi kompres\u2026</p>';
    var v=document.createElement("video");
    v.muted=true; v.playsInline=true; v.preload="auto"; v.src=item.url; v.style.display="none";
    document.body.appendChild(v);
    await new Promise<void>(function(res,rej){
      var to=setTimeout(res,6000);
      v.addEventListener("loadedmetadata",function(){ clearTimeout(to); res(); },{once:true});
      v.addEventListener("error",function(){ clearTimeout(to); rej(new Error("Video nggak kebaca browser.")); },{once:true});
    });
    if(isFinite(v.duration) && v.duration>120){ v.remove(); throw new Error("Kompres maks. 2 menit."); }
    if(!(v as any).captureStream && !(v as any).mozCaptureStream){ v.remove(); throw new Error("Browser ini nggak bisa kompres video."); }
    var stream=((v as any).captureStream||(v as any).mozCaptureStream).call(v);
    var mime=MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    var rec=new MediaRecorder(stream,{mimeType:mime, videoBitsPerSecond:1200000});
    var chunks=[];
    rec.ondataavailable=function(ev){ if(ev.data && ev.data.size) chunks.push(ev.data); };
    var stopped=new Promise<Event>(function(r){ rec.onstop=r; });
    rec.start(500);
    await v.play();
    await new Promise<void>(function(r){
      v.addEventListener("ended",function(){ r(); },{once:true});
      setTimeout(r,((v.duration||10)+15)*1000);
    });
    if(rec.state!=="inactive") rec.stop();
    await stopped;
    v.remove();
    var blob=new Blob(chunks,{type:"video/webm"});
    if(!blob.size) throw new Error("Hasil kompres kosong.");
    var pct=Math.round(blob.size/item.file.size*100);
    out.innerHTML='<div class="flex items-center gap-2 flex-wrap">'+dlLink(blob,item.file.name.replace(/\.[^.]+$/,"")+"-kompres.webm","Simpan")+'<span class="text-xs font-semibold" style="color:var(--muted)">'+formatBytes(item.file.size)+' \u2192 '+formatBytes(blob.size)+' ('+pct+'%)</span></div>';
    toast("Kompres beres \u2713");
  }catch(e){
    out.innerHTML='<p class="text-[14px] font-semibold" style="color:var(--red-text)">'+escapeHtml(e.message)+'</p>';
  }
  btn.disabled=false;
}

/* ── Tema terang / gelap: tombol matahari/bulan di topbar ──
   Pilihan manual disimpan (cuma preferensi tampilan) & menang dari setelan sistem;
   kalo belum pernah milih, halaman ikut terang/gelap sistem secara live. */
(function(){
  var btn=document.getElementById("themeBtn"); if(!btn) return;
  function sync(){
    var dark=document.documentElement.classList.contains("dark");
    btn.setAttribute("aria-label", dark ? "Ganti ke mode terang" : "Ganti ke mode gelap");
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
  }
  sync();
  btn.addEventListener("click",function(){
    var dark=document.documentElement.classList.toggle("dark");
    try{ localStorage.setItem("sirna-theme", dark ? "dark" : "light"); }catch(e){}
    sync();
    toast(dark ? "Mode gelap aktif" : "Mode terang aktif");
  });
  try{
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(e){
      var pref=null; try{ pref=localStorage.getItem("sirna-theme")||localStorage.getItem("bebas-theme")||localStorage.getItem("labeloff-theme"); }catch(_){}
      if(pref!=="dark" && pref!=="light"){ document.documentElement.classList.toggle("dark", e.matches); sync(); }
    });
  }catch(e){}
})();

updateStats();
