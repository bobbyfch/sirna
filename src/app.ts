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

/* ── Alat aktif (Langkah 2): tool-first. null = layar pemilih alat.
   "clean" | "erase" | "watermark". File baru dirutekan ke alat aktif:
   Bersihkan → auto-scan+clean; alat lain → antre saja, tunggu aksi
   pengguna di kartunya. TIDAK ADA alat default: null berarti user belum
   memilih — file yang masuk tanpa alat cuma diantre (lihat handleFiles),
   bukan otomatis Bersihkan (arah Bobby 19 Nov 2026 08:49 WIB). */
var activeTool=null;
/* Foto terpilih di kepala editor (satu foto satu sesi): null = belum ada
   foto. Dipilih otomatis saat file masuk (yang pertama) & lewat filmstrip
   atau ketuk badan kartu. */
var selectedId: number | null = null;
function selectedItem(){ return items.find(function(i){return i.id===selectedId}) || items[0] || null; }
function selectItem(id){ selectedId=id; syncShell(); syncPrimary(); renderDeskFiles(); }
var TOOL_STEPS={
  clean:["Pilih file","Deteksi","Bersihkan","Simpan"],
  erase:["Pilih file","Coret","Hapus","Simpan"],
  watermark:["Pilih file","Deteksi","Hapus","Simpan"],
  background:["Pilih file","Deteksi","Hapus","Simpan"],
  upscale:["Pilih file","Perbesar","Simpan"],
  jejak:["Pilih file","Cari jejak","Hapus","Simpan"],
  dedup:["Pilih file","Cari duplikat","Pilih yang disimpan","Selesai"]
};
/* Ganti alat = ganti workspace, bukan buang file: antrean, hasil & versi
   ikut. null = balik ke pemilih alat (hero tampil, workspace sembunyi). */
function setActiveTool(tool){
  activeTool=tool||null;
  $$("[data-tool-switch]").forEach(function(x){
    var on=x.dataset.toolSwitch===(activeTool||"");
    x.setAttribute("aria-pressed", on?"true":"false");
    x.classList.toggle("active", on);
  });
  /* Sidebar desktop (§02): selection yang sama — satu sumber kebenaran
     dengan chip bar & kartu pemilih; "Semua alat" aktif pas belum ada
     alat yang dipilih. Di HP sidebar display:none, jadi ini no-op visual. */
  $$("#deskSidebar [data-sidebar-tool]").forEach(function(x){
    var on=(x.dataset.sidebarTool||"")===(activeTool||"");
    x.setAttribute("aria-pressed", on?"true":"false");
    x.classList.toggle("active", on);
  });
  var hero=$("#heroSection"), panel=$("#panel-cleaner");
  if(hero) hero.classList.toggle("hidden", !!activeTool);
  if(panel) panel.classList.toggle("hidden", !activeTool);
  var dv=$("#dedupView");
  if(dv) dv.classList.toggle("hidden", activeTool!=="dedup");
  updateStats();
}

/* ── Kepala editor + tombol utama (layout kanonis P0-1) ──
   syncShell: filmstrip, canvas (maks 55vh), pill + bukti, chip versi,
   tombol Urungkan / Tahan-lihat-asli. syncPrimary: satu tombol utama
   sticky dengan kata kerja alat aktif. Keduanya dipanggil dari
   updateStats() — satu titik sinkronisasi sesudah hampir semua mutasi. */
var shellComparing=false;
function shellEvidence(item, st){
  var cur=item.cleanedBlob||item.file;
  var size=formatBytes(cur.size);
  if(st.key==="cleaned") return "Dicek ulang: 0 label AI tersisa · "+size;
  if(st.key==="residual") return "Masih ada label · "+size;
  if(st.key==="detected") return "Label AI ketemu · "+size;
  if(st.key==="plain") return "Tidak ada label · "+size;
  if(st.key==="cleaning") return "Lagi diproses… · "+size;
  if(st.key==="failed"||st.key==="attention") return "Perlu perhatian · "+size;
  return size;
}
function syncShell(){
  var head=$("#editorHead"); if(!head) return;
  var it=selectedItem();
  var show= !!activeTool && !!it;
  head.classList.toggle("hidden", !show);
  if(!show) return;
  var film=$("#shellFilm");
  if(film) film.innerHTML=items.map(function(x){
    return '<button type="button" class="shell-thumb'+(x.id===it.id?" active":"")+'" data-shell-id="'+x.id+'" aria-label="Pilih '+escapeHtml(x.file.name)+'" aria-pressed="'+(x.id===it.id?"true":"false")+'"><img src="'+(x.cleanedUrl||x.url)+'" alt=""></button>';
  }).join("");
  var img=$("#shellImg") as HTMLImageElement, vid=$("#shellVideo") as HTMLVideoElement;
  if(it.kind==="video"){
    if(img) img.classList.add("hidden");
    if(vid){ vid.classList.remove("hidden"); if(vid.src!==it.url) vid.src=it.url; }
  } else {
    if(vid){ vid.classList.add("hidden"); vid.removeAttribute("src"); }
    if(img){
      img.classList.remove("hidden");
      var want=shellComparing ? it.url : (it.cleanedUrl||it.url);
      if(img.getAttribute("data-cur")!==want){ img.src=want; img.setAttribute("data-cur",want); }
    }
  }
  var st=getFileState(it);
  setPill($("#shellPill"), st.cls, st.icon, st.text);
  var sst=$("#shellStatus"); if(sst) sst.textContent=shellEvidence(it, st);
  var row=$("#shellVersions");
  if(row){
    var vs=it.versions||[];
    if(vs.length<2){ row.classList.add("hidden"); row.innerHTML=""; }
    else{
      row.classList.remove("hidden");
      row.innerHTML='<span class="version-label">Versi:</span> '+vs.map(function(v){
        var cur=v.label===it.currentLabel;
        return '<button type="button" class="version-chip'+(cur?" active":"")+'" data-v="'+v.label+'" aria-pressed="'+(cur?"true":"false")+'">'+v.label+'</button>';
      }).join('<span class="version-sep" aria-hidden="true">·</span>')+'<span class="version-hint">— ketuk untuk kembali</span>';
    }
  }
  var un=$("#shellUndo");
  if(un) un.classList.toggle("hidden", !(it.versions && it.versions.length>1 && it.currentLabel!=="Asli"));
}
var PRIMARY_VERB={clean:"Bersihkan label",erase:"Hapus Objek",watermark:"Hapus Watermark",background:"Hapus Latar",upscale:"Perbesar",jejak:"Hapus Jejak",dedup:"Cari duplikat"};
function syncPrimary(){
  var bar=$("#primaryBar"); if(!bar) return;
  var it=selectedItem();
  var show= !!activeTool && !!it;
  bar.classList.toggle("hidden", !show);
  document.body.classList.toggle("has-primary", show);
  var back=$("#topBackBtn"); if(back) back.classList.toggle("hidden", !activeTool);
  var exp=$("#topExportBtn"); if(exp) exp.classList.toggle("hidden", !(it && it.cleanedBlob));
  if(!show) return;
  var btn=$("#primaryBtn"); if(!btn) return;
  var label=PRIMARY_VERB[activeTool]||"Simpan foto";
  if(activeTool==="clean" && it.cleanedBlob) label="Simpan foto";
  btn.textContent=label;
  /* Naik di atas bar ZIP kalau bar itu tampil (keduanya fixed bawah). */
  bar.classList.toggle("above-batch", !document.getElementById("batchBar").classList.contains("hidden"));
}
async function runPrimary(){
  var it=selectedItem();
  if(!activeTool) return;
  if(!it){ var fi2=$("#fileInput") as HTMLInputElement; if(fi2) fi2.click(); return; }
  if(activeTool==="clean"){
    if(it.cleanedBlob){ saveItem(it); return; }
    await cleanItem(it);
    toast("Dibersihin ✓");
    return;
  }
  if(activeTool==="erase"){ await openEraserFor(it); return; }
  if(activeTool==="watermark"){ await openWatermarkFor(it); return; }
  if(activeTool==="background"){ await openBackgroundFor(it); return; }
  if(activeTool==="upscale"){ await openUpscaleFor(it); return; }
  if(activeTool==="jejak"){ await openJejakFor(it); return; }
  if(activeTool==="dedup"){ scanDuplicates(); return; }
}
/* Stepper workspace dibaca dari antrean + alat aktif (bukan flag terpisah):
   Bersihkan: file masuk → Deteksi aktif, ada yang dibersihkan → Bersihkan
   aktif, semua beres → Simpan aktif. Objek/Watermark: file masuk → Coret/
   Deteksi aktif, ada edit selesai → Simpan aktif. */
function updateToolStepper(){
  var bar=document.getElementById("toolStepper");
  if(!bar||!activeTool) return;
  var steps=TOOL_STEPS[activeTool];
  var hasFiles=items.length>0;
  var anyCleaning=items.some(function(i){return i.status==="cleaning"});
  var allDone=hasFiles && items.every(function(i){return i.cleanedBlob||i.status==="error"});
  var anyEdited=items.some(function(i){return i.tools && (i.tools.erase==="selesai"||i.tools.watermark==="selesai"||i.tools.background==="selesai"||i.tools.upscale==="selesai"||i.tools.jejak==="selesai"||i.tools.dedup==="selesai")});
  var idx=0;
  if(!hasFiles) idx=0;
  else if(activeTool==="clean") idx= anyCleaning?2 : (allDone?3:1);
  else idx= anyEdited?3:1;
  bar.innerHTML=steps.map(function(s,i){
    var cls= i<idx ? " done" : (i===idx ? " active" : "");
    var num= i<idx ? "✓" : String(i+1);
    return '<span class="ws-step'+cls+'"><b>'+num+'</b> '+s+'</span>';
  }).join('<span class="ws-conn" aria-hidden="true"></span>');
}

function $(s){return document.querySelector(s)}
function $$(s){return Array.from(document.querySelectorAll(s))}
function ic(id,cls?){ return '<svg class="ic '+(cls||"ic-sm")+'" aria-hidden="true"><use href="#'+id+'"/></svg>'; }
function setPill(el,cls,icon,text){ if(!el) return; el.className="status-pill shrink-0 "+cls; el.innerHTML=ic(icon,"ic-sm")+escapeHtml(text); }

/* ── SATU STATE MACHINE PER FILE (§3/§4.1 redesign, Langkah 1) ──
   Satu-satunya sumber kebenaran status file: pill, kotak hasil, stats
   header, batch bar & toast batch SEMUA membaca getFileState(item).
   Dilarang menghitung "bersih" dari cleanedBlob di satu tempat dan dari
   cleanedScan di tempat lain — itu sumber inkonsistensi lama (header
   "1 bersih" vs kartu "Label tersisa"). State diturunkan dari data item
   (status + cleanedBlob + cleanedScan + scan awal), bukan dari flag
   terpisah yang bisa ketinggalan. toolState per alat ikut di sini buat
   rel alat kartu (Langkah 3): belum / selesai / perlu perhatian. */
var PILL={
  cleaning:{cls:"pill-working",icon:"i-eraser",text:"Lagi dibersihin…"},
  failed:{cls:"pill-error",icon:"i-alert",text:"Gagal"},
  attention:{cls:"pill-error",icon:"i-alert",text:"Perhatian"},
  residual:{cls:"pill-error",icon:"i-alert",text:"Masih ada label"},
  cleaned:{cls:"pill-clean",icon:"i-check",text:"Sudah bersih"},
  detected:{cls:"pill-detected",icon:"i-alert",text:"Ada label AI"},
  plain:{cls:"pill-plain",icon:"i-check",text:"Tidak ada label"},
  unverified:{cls:"pill-error",icon:"i-alert",text:"Belum terverifikasi"}
};
function getFileState(item){
  var key;
  var tools=item.tools||{clean:"belum",erase:"belum",watermark:"belum",background:"belum",upscale:"belum",jejak:"belum",dedup:"belum"};
  if(item.status==="cleaning") key="cleaning";
  else if(item.status==="error") key= item.errorKind==="attention" ? "attention" : "failed";
  else if(item.cleanedBlob){
    if(!item.cleanedScan) key="unverified";
    else if(item.cleanedScan.hasAI) key="residual";
    else key="cleaned";
  }
  else if(item.scan && item.scan.hasAI) key="detected";
  else key="plain";
  var p=PILL[key];
  var curScan=item.cleanedScan||item.scan||{hasAI:false};
  return {key:key, cls:p.cls, icon:p.icon, text:p.text, tools:tools,
    verifiedClean:key==="cleaned", hasLabel:!!curScan.hasAI};
}
function applyPill(item){
  var el=document.getElementById("status-"+item.id); if(!el) return;
  var st=getFileState(item);
  setPill(el, st.cls, st.icon, st.text);
}
/* Deep Clean dari tombol di kotak hasil (A5): nyalain mode Deep + samain
   tombol pengaturan [data-mode] biar UI-nya nggak bohong. */
function setDeepClean(on){
  deepClean=!!on;
  $$("[data-mode]").forEach(function(x){ x.setAttribute("aria-pressed", (x.dataset.mode==="deep")===!!on ? "true" : "false"); });
}
/* Satu jalur gagal (A6–A8): pill + kotak merah dari getFileState, bukan
   setPill manual di tiap catch — biar "Gagal"/"Perhatian" nggak pernah
   beda sumber dengan pill di tempat lain. retry=true → tombol [Coba lagi]
   (data-act="reclean") di dalam kotak. */
function failClean(item,res,status,kind,body,retry){
  item.status="error"; item.errorKind=kind; if(item.tools) item.tools.clean="perlu perhatian";
  hideProc(item);
  var cardEl=document.getElementById("card-"+item.id); if(cardEl) cardEl.classList.remove("is-processing");
  var st=getFileState(item);
  setPill(status, st.cls, st.icon, st.text);
  if(res){
    res.classList.remove("hidden");
    res.innerHTML='<div class="error-box">'+escapeHtml(body)+'</div>'+(retry?'<div class="mt-2"><button type="button" class="min-h-[44px] px-5 grad-bg text-white font-bold text-[13px] btn-ic" data-act="reclean" data-id="'+item.id+'">Coba lagi</button></div>':"");
  }
  renderRail(item);
}
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
  var prim=document.getElementById("primaryBar");
  var primUp= prim && !prim.classList.contains("hidden");
  /* Dock duduk di atas tumpukan bar bawah: batch 69px, primary ~82px
     (tombol 54px + padding bawah min 28px — naik 12px dari 70px lama
     sejak fix gesture bar 19 Nov 2026). Tanpa bar di bawahnya, dock
     adalah elemen paling bawah: lantai 42px biar nggak ketutup gesture
     bar Android (env() = 0 di Chrome POCO F6). */
  var base= primUp ? (barUp ? 168 : 96) : (barUp ? 86 : 14);
  dock.style.bottom= base===14 ? "max(42px, calc(14px + env(safe-area-inset-bottom)))" : "calc("+base+"px + env(safe-area-inset-bottom))";
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

/* ── File masuk → dirutekan ke alat aktif ──
   Bersihkan: langsung scan + bersih (janji "Taruh file. Beres.").
   Objek/Watermark: antre saja — nggak ada yang diubah sebelum user minta.
   Tanpa alat dipilih (paste / drop di mana aja / tes lama): default ke
   Bersihkan, biar alur lama tetap jalan tanpa pilih-pilih dulu. */
async function handleFiles(fileList: FileList | File[], opts?: {sample?: boolean}){
  var files=Array.from(fileList).filter(isMediaFile);
  if(!files.length){ toast("Format tidak didukung."); return; }
  var created=[];
  for(var idx=0; idx<files.length; idx++){
    var file=files[idx];
    var kind=isVideoFile(file)?"video":"image";
    var scan;
    try{ scan= kind==="video" ? await scanVideoFile(file) : await scanImageFile(file); }
    catch(e){ scan={found:[], types:[], interesting:[], hasAI:false}; } /* 1 file gagal scan nggak boleh batalin 1 batch */
    var item={id:++idCounter, file:file, kind:kind, scan:scan, url:URL.createObjectURL(file), cleanedBlob:null, cleanedUrl:null, cleanedName:"", cleanedType:"", cleanedScan:null, status:"ready", errorKind:null, lastEdit:null, tools:{clean:"belum",erase:"belum",watermark:"belum",background:"belum",upscale:"belum",jejak:"belum",dedup:"belum"}, versions:[{label:"Asli", blob:file, type:file.type, scan:scan, box:null}], currentLabel:"Asli"};
    items.push(item); created.push(item); renderItem(item);
    if(kind==="image"){
      (function(it){ var img=new Image(); img.onload=function(){ var el=document.getElementById("dims-"+it.id); if(el) el.textContent=img.naturalWidth+" × "+img.naturalHeight+" · "; }; img.src=it.url; })(item);
    }
  }
  batchRunning=true; updateStats();
  /* TANPA alat aktif: file cuma diantre + di-scan — TIDAK ada alat yang
     jalan otomatis dan TIDAK ada alat yang terpilih (arah Bobby 19 Nov
     2026 08:49 WIB). Banner di home nunjukin file sudah siap; user pilih
     alat dulu. Berlaku buat foto contoh, paste & drop di home. */
  if(!activeTool){
    if(created.length) selectItem(created[0].id);
    batchRunning=false; updateStats();
    /* Desktop (≥1024px): workspace sudah tampil berkat body.has-files —
       bawa mata langsung ke kartu file (focal point), bukan ke pemilih
       alat yang di desktop sudah jadi sidebar. HP tetap scroll ke
       pemilih alat (perilaku terverifikasi POCO F6). */
    var isDesk=!!(window.matchMedia && window.matchMedia("(min-width:1024px)").matches);
    if(isDesk){
      var q=$("#queueSection"); if(q) q.scrollIntoView({behavior:"smooth",block:"start"});
      toast(opts && opts.sample ? "Foto contoh dimuat ✓ — pilih alat di samping." : created.length+" file siap — pilih alat dulu di samping.");
    } else {
      var p=$("#toolPicker");
      if(p) p.scrollIntoView({behavior:"smooth",block:"start"});
      toast(opts && opts.sample ? "Foto contoh dimuat ✓ — pilih alat di atas." : created.length+" file siap — pilih alat dulu di atas.");
    }
    return;
  }
  /* Langsung bawa user ke kepala editor: foto + status + rail + tombol
     utama — BUKAN kartu di bawah. Dulu scroll-nya ke kartu pertama,
     jadi user menatap kartu (dengan rel lama) sementara tombol utama
     bilang alat lain — persis yang terlihat di screenshot POCO F6. */
  if(created.length) selectItem(created[0].id);
  var eh=$("#editorHead");
  if(eh){
    var rm=!!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try{ eh.scrollIntoView({behavior: rm?"auto":"smooth", block:"start"}); }catch(e){ eh.scrollIntoView(); }
  }
  /* Alat selain Bersihkan: file cuma diantre + di-scan buat pill-nya —
     nggak ada yang dibersihkan sebelum user minta. Kartu keluar dari mode
     proses (nggak ada proses yang jalan); foto sudah di kepala editor. */
  if(activeTool!=="clean"){
    created.forEach(function(it){
      var cardEl=document.getElementById("card-"+it.id);
      if(cardEl) cardEl.classList.remove("is-processing");
      hideProc(it);
    });
    batchRunning=false; updateStats();
    var toolName= activeTool==="erase" ? "Hapus Objek" : activeTool==="watermark" ? "Hapus Watermark" : activeTool==="background" ? "Hapus Latar" : activeTool==="upscale" ? "Perbesar" : activeTool==="jejak" ? "Hapus Jejak" : activeTool==="dedup" ? "Hapus Duplikat" : "Bersihkan";
    toast(created.length+" file masuk — "+toolName+" siap di kepala editor.");
    return;
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
  /* Toast batch akhir baca getFileState juga (satu sumber kebenaran):
     A9 semua bersih / A5 sebagian + sisa label / A10 nggak ada yang
     bisa dibersihkan. */
  var okCount=created.filter(function(x){return getFileState(x).key==="cleaned"}).length;
  var residual=created.filter(function(x){return getFileState(x).key==="residual"}).length;
  if(okCount===created.length) toast("Beres ✓ " + okCount + " file bersih — label AI sudah hilang.");
  else if(okCount>0) toast(okCount + "/" + created.length + " file bersih" + (residual ? " · " + residual + " masih ada label." : "."));
  else if(residual>0) toast("0/" + created.length + " file bersih · " + residual + " masih ada label.");
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
  var st0=getFileState(item);
  card.innerHTML=
    thumb+
    '<div class="min-w-0 flex-1">'+
      '<div class="flex items-start justify-between gap-2"><h4 class="font-semibold break-all">'+escapeHtml(item.file.name)+'</h4>'+
      '<span id="status-'+item.id+'" class="status-pill shrink-0 '+st0.cls+'">'+ic(st0.icon,"ic-sm")+escapeHtml(st0.text)+'</span></div>'+
      '<p class="file-meta" style="color:var(--muted)"><span id="dims-'+item.id+'"></span>'+formatBytes(item.file.size)+'</p>'+
      '<div class="card-progress is-wait" id="prog-'+item.id+'" role="status"><div class="cp-head"><span class="spinner" aria-hidden="true"></span><span id="prog-label-'+item.id+'">Menunggu…</span></div><div class="cp-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>'+
      '<div id="detect-'+item.id+'"></div>'+
      '<div class="flex flex-wrap gap-1.5 mt-2.5" id="badges-'+item.id+'"></div>'+
      '<div class="hidden" id="result-'+item.id+'"></div>'+
      '<div class="version-row hidden" id="versions-'+item.id+'"></div>'+
      /* Rel alat di kartu = .tool-bar kanonis (chip ikon+label, bisa
         di-scroll horizontal, chip aktif biru) — SAMA dengan rail di
         kepala editor. Satu implementasi rel di seluruh app; ketuk chip
         = pilih file ini + buka alat itu di kepala editor. */
      (item.kind==="video" ? "" :
        '<div class="tool-bar" id="rail-'+item.id+'" role="group" aria-label="Alat untuk file ini"></div>')+
      '<div class="act-primary">'+
        '<button type="button" class="hidden flex-1 min-h-[50px] px-5 grad-bg text-white font-semibold text-[15px] btn-ic" data-act="save" data-id="'+item.id+'">'+ic("i-download")+'Simpan</button>'+
        '<button type="button" class="hidden min-h-[50px] px-5 font-semibold text-[15px] btn-ic" style="background:var(--fill);color:var(--label)" data-act="reclean" data-id="'+item.id+'" title="Bersihkan ulang pakai pengaturan sekarang" aria-label="Bersihkan ulang">'+ic("i-rotate")+'</button>'+
      '</div>'+
      '<div class="ios-group">'+
        '<button type="button" class="ios-row" data-act="meta" data-id="'+item.id+'" aria-expanded="false" aria-controls="fold-meta-'+item.id+'"><span class="icon-tile sm" style="margin-right:11px">'+ic("i-database","ic-sm")+'</span><span class="row-label">Metadata</span><svg class="chev ic ic-sm" aria-hidden="true"><use href="#i-chev"/></svg></button>'+
        '<div class="hidden" id="fold-meta-'+item.id+'"><div class="fold-pad"><div id="meta-body-'+item.id+'"><p class="text-[13.5px]" style="color:var(--muted)">Lagi dimuat\u2026</p></div></div></div>'+
        '<div class="ios-sep" aria-hidden="true"></div>'+
        '<button type="button" class="ios-row" data-act="more" data-id="'+item.id+'" aria-expanded="false" aria-controls="fold-more-'+item.id+'"><span class="icon-tile sm" style="margin-right:11px">'+ic(item.kind==="video" ? "i-film" : "i-repeat","ic-sm")+'</span><span class="row-label">'+(item.kind==="video" ? "Video" : "Konversi")+'</span><svg class="chev ic ic-sm" aria-hidden="true"><use href="#i-chev"/></svg></button>'+
      /* Lipatan Metadata + Konversi/Video tetap di sini; baris alat
         panjang (Hapus Objek / Hapus Watermark) sudah diganti rel alat
         ringkas di atas tombol Simpan (Langkah 3). */
      (item.kind==="video"
        ? '<div class="hidden" id="fold-more-'+item.id+'"><div class="fold-pad"><div class="flex flex-wrap gap-2 mt-2.5"><button type="button" class="min-h-[44px] px-4 font-bold text-[13px] btn-ic" style="background:var(--fill);color:var(--label);border-radius:980px" data-act="frame" data-id="'+item.id+'">'+ic("i-camera","ic-sm")+'Frame</button><button type="button" class="min-h-[44px] px-4 font-bold text-[13px] btn-ic" style="background:var(--fill);color:var(--label);border-radius:980px" data-act="compress" data-id="'+item.id+'">'+ic("i-compress","ic-sm")+'Kompres</button></div><div id="vid-out-'+item.id+'" class="mt-3"></div></div></div>'
        : '<div class="hidden" id="fold-more-'+item.id+'"><div class="fold-pad"><div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2.5"><label class="block"><span class="wf-lbl">'+ic("i-image","ic-sm")+' Format</span><select id="cv-fmt-'+item.id+'" class="wf-select"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label><label class="block"><span class="wf-lbl">'+ic("i-expand","ic-sm")+' Ukuran</span><select id="cv-size-'+item.id+'" class="wf-select"><option value="0">Asli</option><option value="2048">\u22642048</option><option value="1080">\u22641080</option><option value="720">\u2264720</option></select></label><label class="block"><span class="wf-lbl">'+ic("i-gauge","ic-sm")+' Kualitas</span><select id="cv-q-'+item.id+'" class="wf-select"><option value="92">92%</option><option value="85" selected>85%</option><option value="70">70%</option></select></label></div><div class="flex flex-wrap items-center gap-2 mt-3"><button type="button" class="min-h-[44px] px-5 grad-bg text-white font-bold text-[13px] btn-ic" data-act="convert" data-id="'+item.id+'">'+ic("i-repeat","ic-sm")+'Konversi</button><span id="cv-out-'+item.id+'" class="flex flex-wrap items-center gap-2"></span></div></div></div>')+
      '</div>'+
      '<div class="remove-wrap"><button type="button" class="btn-remove" data-act="remove" data-id="'+item.id+'">'+ic("i-trash","ic-sm")+'Hapus</button></div>'+
    '</div>';
  $("#list").appendChild(card);
  card.querySelector(item.kind==="video" ? "video" : "img").addEventListener("click",function(){ openPreview(item); });
  refreshBadges(item);
  renderRail(item);
  renderVersions(item);
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
  /* Kotak merah A1 cuma buat scan AWAL (sebelum dibersihkan): head
     "Label AI ketemu" + body yang nyebut sumbernya. Begitu file sudah
     dibersihkan, kotak ini kosong — kotak HASIL yang bicara (A4/A5),
     biar user nggak baca label lama sebagai "label tetap ada". */
  var box=document.getElementById("detect-"+item.id);
  if(box){
    if(s.hasAI && !item.cleanedBlob){
      var src=s.found.length? s.found[0] : "AI";
      var who=item.kind==="video"?"Video ini":"Foto ini";
      var obj=item.kind==="video"?"videonya":"fotonya";
      box.innerHTML='<div class="detect-box" role="note"><p class="detect-head">'+ic("i-alert","ic-sm")+' Label AI ketemu</p><p class="clean-body">'+who+' ditandai "dibuat AI" oleh '+escapeHtml(src)+'. Sirna akan menghapus tandanya — '+obj+' tetap sama.</p></div>';
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
  setPill(status,"pill-working","i-eraser","Lagi dibersihin…");
  setProc(item,"Membersihkan…",false);
  if(res) res.classList.add("hidden");
  try{
    if(/\.webm$/i.test(item.file.name)){
      /* A7: WebM cuma bisa dicek, bukan dibersihkan. */
      failClean(item,res,status,"attention","WebM hanya bisa dicek. Pakai MP4 kalau mau dibersihkan.",false);
      return;
    }
    var boxes=item.scan.mp4Boxes || await listTopBoxes(item.file);
    var targets=boxes.filter(function(b){ return b.type==="meta"||b.type==="udta"||(b.type==="uuid"&&b.xmp); });
    if(!targets.length){
      if(item.scan.hasAI){
        /* A8: label ketemu tapi box-nya nggak bisa dibuang dari file ini. */
        failClean(item,res,status,"attention","Label ketemu, tapi tidak bisa dibuang dari file ini.",false);
        return;
      }
      /* Video bersih & nggak ada box metadata yang perlu dibuang: sukses
         tanpa ubah satu byte — cleanedBlob = file asli, re-scan = scan awal.
         (Dulu ini malah dilempar jadi error "Video ini sudah bersih."
         dengan pill Perhatian — file bersih tampil kayak gagal.) */
      item.cleanedBlob=item.file; item.cleanedType=item.file.type; item.cleanedName=outName(item); item.status="cleaned";
      item.cleanedScan=item.scan; item.tools.clean="selesai";
      if(item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
      item.cleanedUrl=URL.createObjectURL(item.file);
      finishClean(item,res,status,{head:"Beres — sudah bersih", body:'Dicek ulang: <b>0 label AI tersisa</b>. Ukuran tetap '+formatBytes(item.file.size)+'. File ini aman diunggah.'});
      return;
    }
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
    item.tools.clean= vscan ? (vscan.hasAI ? "perlu perhatian" : "selesai") : "perlu perhatian";
    var box= !vscan
      ? {head:"Hasil belum terverifikasi", body:'Ukuran tetap '+formatBytes(blob.size)+'.'}
      : vscan.hasAI
        ? {head:"Label masih ketemu", body:'Sisa: <b style="color:var(--red-text)">'+escapeHtml(vscan.found.join(", "))+'</b> · ukuran tetap '+formatBytes(blob.size)}
        : {head:"Beres — sudah bersih", body:'Dicek ulang: <b>0 label AI tersisa</b>. Ukuran tetap '+formatBytes(blob.size)+'. File ini aman diunggah.'};
    finishClean(item,res,status,box);
  }catch(e){
    var reason=String((e&&e.message)||"Gagal").replace(/\.+$/,"");
    failClean(item,res,status,"failed",reason+". File aslimu aman — coba lagi atau pakai Deep Clean.",true);
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
  setPill(status,"pill-working","i-eraser","Lagi dibersihin…");
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
    item.tools.clean= vscan.hasAI ? "perlu perhatian" : "selesai";
    if(item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
    item.cleanedUrl=URL.createObjectURL(blob);
    /* Kotak hasil A4/A5 — bukti, bukan klaim: re-scan 0 label + ukuran
       sebelum → sesudah; kalau sisa label, ada tombol Coba Deep Clean. */
    var box= vscan.hasAI
      ? {head:"Label masih ketemu", body:'Sisa: <b style="color:var(--red-text)">'+escapeHtml(vscan.found.join(", "))+'</b>. Coba Deep Clean — biasanya sisa label hilang di situ.', action:{label:"Coba Deep Clean", act:"deepclean"}}
      : {head:"Beres — sudah bersih", body:'Dicek ulang: <b>0 label AI tersisa</b>. Ukuran '+formatBytes(item.file.size)+' → '+formatBytes(blob.size)+'. File ini aman diunggah.'};
    finishClean(item,res,status,box);
  }catch(e){
    /* A6: alasan + "file aslimu aman" + tombol [Coba lagi]. */
    var reason=String((e&&e.message)||"Gagal").replace(/\.+$/,"");
    failClean(item,res,status,"failed",reason+". File aslimu aman — coba lagi atau pakai Deep Clean.",true);
  } finally { updateStats(); }
}

/* ── Hapus Jejak: strip jejak privasi (dipakai modal jejak via hook) ──
   Strip lossless yang sama dengan Bersihkan (PNG/JPEG); kalau jejak
   masih kebaca (pemindai jejak, dynamic import biar tetap lazy), jatuh
   ke jalur canvas — decode + encode ulang, metadata hilang semua.
   WebP/AVIF tidak punya strip lossless di sini → langsung canvas. */
async function scrubTracesBlob(blob){
  var ab=await blob.arrayBuffer();
  var kind=sniffImageKind(ab);
  var out=null;
  if(kind==="image/png"||kind==="image/jpeg"){
    try{ out=new Blob([kind==="image/png"?stripPngMeta(ab):stripJpegMeta(ab)],{type:kind}); }catch(e){ out=null; }
  }
  var jejak=await import("./jejak");
  if(out && (await jejak.scanTraces(out)).length===0) return out;
  // Jalur canvas: piksel di-decode ulang, metadata hilang semua.
  var bmp=await createImageBitmap(blob);
  var c=document.createElement("canvas"); c.width=bmp.width; c.height=bmp.height;
  var ctx=c.getContext("2d");
  var type= kind==="image/jpeg" ? "image/jpeg" : (kind==="image/webp" ? "image/webp" : "image/png");
  if(type==="image/jpeg"){ ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,c.width,c.height); }
  ctx.drawImage(bmp,0,0);
  if(bmp.close) bmp.close();
  var res=await new Promise(function(resolve){ c.toBlob(resolve,type,0.92); });
  if(!res) throw new Error("Browser gagal encode gambar ini.");
  return res;
}

/* ── Hapus Duplikat (src/dedup.ts) ──
   Pindai antrean (foto saja) dengan pHash, kelompokkan yang mirip,
   tampilkan di #dedupView. User memilih mana yang disimpan per grup;
   tombol hapus per grup HANYA menghapus yang tidak disimpan — tidak ada
   auto-delete. */
async function scanDuplicates(){
  var groupsEl=$("#dedupGroups"); if(!groupsEl) return;
  var btn=$("#dedupScanBtn") as HTMLButtonElement; if(btn) btn.disabled=true;
  groupsEl.innerHTML='<p class="dedup-empty">Lagi memindai…</p>';
  try{
    var dedup=await import("./dedup");
    var entries=[];
    for(var i=0;i<items.length;i++){
      var it=items[i];
      if(it.kind!=="image") continue;
      var src= it.cleanedBlob || it.file;
      try{ entries.push({id:it.id, name:it.file.name, url: it.cleanedUrl||it.url, hash: await dedup.phashImage(src)}); }catch(e){}
    }
    var groups=dedup.groupDuplicates(entries);
    dedup.renderDedupGroups(groupsEl, groups, function(removeIds, keepIds){
      removeDedupItems(removeIds, keepIds);
    });
    toast(groups.length===0 ? "Tidak ada duplikat — semua foto beda." : "Ketemu "+groups.length+" grup duplikat. Pilih yang disimpan, lalu hapus sisanya.");
  }catch(e){
    groupsEl.innerHTML='<p class="dedup-empty">Gagal memindai duplikat. Coba lagi.</p>';
  }
  if(btn) btn.disabled=false;
}
function removeDedupItems(removeIds, keepIds){
  removeIds.forEach(function(id){
    var it=items.find(function(i){return i.id===id}); if(!it) return;
    URL.revokeObjectURL(it.url); if(it.cleanedUrl) URL.revokeObjectURL(it.cleanedUrl);
    var c=document.getElementById("card-"+id); if(c) c.remove();
  });
  items=items.filter(function(i){return removeIds.indexOf(i.id)===-1});
  keepIds.forEach(function(id){
    var it=items.find(function(i){return i.id===id});
    if(it){ if(it.tools) it.tools.dedup="selesai"; renderRail(it); }
  });
  updateStats();
  updateToolStepper();
  toast("Dihapus "+removeIds.length+" duplikat ✓ Yang disimpan tetap ada.");
  // Pindai ulang biar grup yang sudah dibersihkan hilang dari tampilan.
  scanDuplicates();
}

/* ── Tumpukan versi (Langkah 3, §2.6) ──
   versions = [Asli, Bersih?, Objek?, Watermark?, Latar?, Perbesar?, Jejak?]
   — satu per alat yang menghasilkan file baru, urutan tetap. Alat yang
   dijalankan ulang MENGGANTI versinya sendiri (hasil baru menimpa hasil
   lama alat itu) — jadi maks 6 hasil + asli, hemat RAM HP. cleanedBlob
   selalu = blob versi saat ini (currentLabel). Kembali ke versi lama
   TIDAK menghapus versi yang lebih baru (C6). Hapus Duplikat tidak
   membuat versi (ia menghapus file, bukan mengedit). */
var VERSION_ORDER=["Asli","Bersih","Objek","Watermark","Latar","Perbesar","Jejak"];
function pushVersion(item,label,blob,type,scan,box){
  if(!item.versions) item.versions=[{label:"Asli", blob:item.file, type:item.file.type, scan:item.scan, box:null}];
  var v={label:label, blob:blob, type:type, scan:scan||null, box:box||null};
  var i=item.versions.findIndex(function(x){return x.label===label});
  if(i>=0) item.versions[i]=v; else item.versions.push(v);
  item.versions.sort(function(a,b){return VERSION_ORDER.indexOf(a.label)-VERSION_ORDER.indexOf(b.label)});
  item.currentLabel=label;
  renderVersions(item);
}
function renderVersions(item){
  var row=document.getElementById("versions-"+item.id); if(!row) return;
  var vs=item.versions||[];
  if(vs.length<2){ row.classList.add("hidden"); row.innerHTML=""; return; }
  row.classList.remove("hidden");
  row.innerHTML='<span class="version-label">Versi:</span> '+vs.map(function(v){
    var cur=v.label===item.currentLabel;
    return '<button type="button" class="version-chip'+(cur?" active":"")+'" data-act="version" data-id="'+item.id+'" data-v="'+v.label+'" aria-pressed="'+(cur?"true":"false")+'">'+v.label+'</button>';
  }).join('<span class="version-sep" aria-hidden="true">·</span>')+'<span class="version-hint">— ketuk untuk kembali</span>';
}
function setCurrentVersion(item,label){
  var v=(item.versions||[]).find(function(x){return x.label===label});
  if(!v || item.currentLabel===label) return;
  item.currentLabel=label;
  if(label==="Asli"){
    item.cleanedBlob=null; item.cleanedScan=null; item.cleanedType=""; item.cleanedName=""; item.status="ready";
    if(item.cleanedUrl){ URL.revokeObjectURL(item.cleanedUrl); item.cleanedUrl=null; }
  } else {
    item.cleanedBlob=v.blob; item.cleanedType=v.type; item.cleanedName=outName(item);
    item.cleanedScan=v.scan; item.status="cleaned";
    if(item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
    item.cleanedUrl=URL.createObjectURL(v.blob);
  }
  applyPill(item);
  if(item.cleanedScan) refreshBadges(item, item.cleanedScan); else refreshBadges(item);
  var res=document.getElementById("result-"+item.id);
  if(res){
    if(v.box){ res.classList.remove("hidden"); renderResultBox(item,res,v.box); }
    else res.classList.add("hidden");
  }
  var cardEl=document.getElementById("card-"+item.id);
  if(cardEl){ cardEl.classList.remove("is-processing"); cardEl.classList.toggle("is-done", !!item.cleanedBlob); }
  ["save","reclean"].forEach(function(act){ var b2=document.querySelector('button[data-act="'+act+'"][data-id="'+item.id+'"]'); if(b2) b2.classList.toggle("hidden", !item.cleanedBlob); });
  renderVersions(item);
  renderRail(item);
  updateStats();
  toast("Kembali ke versi "+label+". Versi yang lebih baru tetap tersimpan.");
}
/* Kotak hasil (dipakai finishClean + setCurrentVersion): hijau kalau
   getFileState bilang bersih, merah kalau tidak — box yang disimpan di
   versi ikut tampil lagi pas versi itu dibuka. */
function renderResultBox(item,res,box){
  if(!res) return;
  var st=getFileState(item);
  var b=box||{head:"",body:""};
  if(st.key==="cleaned"){
    res.innerHTML='<div class="clean-box" role="status"><p class="clean-head"><span class="clean-check" aria-hidden="true">'+ic("i-check","ic-sm")+'</span> '+escapeHtml(b.head)+'</p><p class="clean-body">'+b.body+'</p></div>';
  } else {
    res.innerHTML='<div class="detect-box" role="status"><p class="detect-head">'+ic("i-alert","ic-sm")+' '+escapeHtml(b.head)+'</p><p class="clean-body">'+b.body+'</p>'+(b.action?'<div class="mt-2"><button type="button" class="min-h-[44px] px-5 grad-bg text-white font-bold text-[13px] btn-ic" data-act="'+b.action.act+'" data-id="'+item.id+'">'+escapeHtml(b.action.label)+'</button></div>':"")+'</div>';
  }
}
/* Rel alat di kartu (satu baris chip semua alat): chip ikon+label yang
   SAMA dengan rail di kepala editor (.tool-bar/.tool-chip — satu
   implementasi, bukan rel teks abu-abu terpisah). Ketuk chip = pilih
   file ini + buka alat itu di kepala editor (ditangani delegasi klik
   [data-tool-switch] di #list). Chip aktif (alat yang sedang dibuka)
   diisi biru oleh setActiveTool — sama seperti chip di workspace. */
var RAIL_TOOLS=[
  ["clean","Bersihkan","i-eraser"],
  ["erase","Hapus Objek","i-sparkles"],
  ["watermark","Hapus Watermark","i-tag"],
  ["background","Hapus Latar","i-layers"],
  ["upscale","Perbesar","i-expand"],
  ["jejak","Hapus Jejak","i-shield"],
  ["dedup","Hapus Duplikat","i-repeat"]
];
function renderRail(item){
  var rail=document.getElementById("rail-"+item.id); if(!rail) return;
  if(item.kind==="video"){ rail.classList.add("hidden"); rail.innerHTML=""; return; }
  rail.classList.remove("hidden");
  rail.innerHTML= RAIL_TOOLS.map(function(t){
    var on= activeTool===t[0];
    return '<button type="button" class="tool-chip'+(on?" active":"")+'" data-tool-switch="'+t[0]+'" data-id="'+item.id+'" aria-pressed="'+(on?"true":"false")+'">'+ic(t[2],"ic-sm")+escapeHtml(t[1])+'</button>';
  }).join("");
}

/* Kotak hasil (box) dibangun pemanggil dari state item; finishClean cuma
   merender + menempel pill dari getFileState + mendorong hasil ke
   tumpukan versi. box = {head, body, action?} dengan action = {label,
   act} → tombol di dalam kotak (mis. Coba Deep Clean, A5).
   versionLabel = label versi hasil ini ("Bersih" default; editor
   mengisi "Objek" / "Watermark"). Referensi mati wf-clean / wf-save
   sudah dihapus — elemen itu tidak pernah dibuat (hanya ada CSS-nya). */
function finishClean(item,res,status,box,versionLabel?: string){
  hideProc(item);
  var cardEl=document.getElementById("card-"+item.id);
  if(cardEl){ cardEl.classList.remove("is-processing"); cardEl.classList.add("is-done"); }
  var st=getFileState(item);
  setPill(status, st.cls, st.icon, st.text);
  /* Badge & kotak deteksi ikut hasil BERSIH, bukan scan awal: kalau re-scan
     0 label, kotak merah "Label AI ketemu" + chip merah harus hilang —
     kalau nggak, user baca kartu itu sebagai "label tetap ada". */
  if(item.cleanedScan) refreshBadges(item, item.cleanedScan);
  if(res){ res.classList.remove("hidden"); renderResultBox(item,res,box); }
  ["save","reclean"].forEach(function(act){ var b2=document.querySelector('button[data-act="'+act+'"][data-id="'+item.id+'"]'); if(b2) b2.classList.remove("hidden"); });
  /* Hasil baru masuk tumpukan versi. */
  if(item.cleanedBlob) pushVersion(item, versionLabel||"Bersih", item.cleanedBlob, item.cleanedType, item.cleanedScan, box);
  renderRail(item);
}

/* ── Simpan: SATU tombol, jalurnya dipilih otomatis ──
   Di dalam frame aplikasi / HP: menu Bagikan (Simpan ke File).
   Di browser biasa: unduhan langsung. Nama-sama + Chrome desktop: dialog simpan. */
/* ── Hapus Objek (src/erase.ts) ──
   Editor dimuat malas (dynamic import) — nggak ada di JS awal.
   Mesinnya Mi-GAN (28,1 MB, MIT) — diunduh sekali saat alat dibuka,
   tersimpan di HP, inferensi di Web Worker. Kalau model tidak bisa
   diunduh (offline), Telea dipakai diam-diam sebagai fallback dengan
   teks status yang jujur. Hasil yang disimpan
   jadi file bersih baru: di-scan ulang & statusnya dihitung jujur
   kayak habis dibersihin (finishClean). */
/* B1: label sumber gambar di subhead editor — dari versi aktif file ini. */
var SOURCE_LABEL={Asli:"Asli", Bersih:"hasil Bersihkan", Objek:"hasil Hapus Objek", Watermark:"hasil Hapus Watermark", Latar:"hasil Hapus Latar", Perbesar:"hasil Perbesar", Jejak:"hasil Hapus Jejak"};
async function openEraserFor(item, fromOriginal = false){
  if(item.kind==="video"){ toast("Hapus Objek cuma buat foto dulu."); return; }
  /* Chaining (§2.6): editor memuat hasil kerja saat ini; kalau belum ada
     hasil, ya file asli. "Mulai dari file asli" di editor memanggil ulang
     dengan fromOriginal=true — tombolnya cuma tampil kalau sumbernya
     bukan file asli (showUseOriginal). */
  var useOriginal= !!fromOriginal || !item.cleanedBlob;
  var src= useOriginal ? item.file : item.cleanedBlob;
  var type= useOriginal ? item.file.type : (item.cleanedType||item.file.type);
  var erase;
  try{ erase=await import("./erase"); }
  catch(e){ toast("Editor gagal dimuat. Coba refresh."); return; }
  await erase.openEraser(
    { name:item.file.name, blob:src, type:type, suggestName:outName(item), sourceLabel: useOriginal ? "Asli" : (SOURCE_LABEL[item.currentLabel]||"hasil Bersihkan") },
    { onReplace:function(blob){ replaceCleaned(item,blob); }, onToast:toast,
      onUseOriginal: useOriginal ? undefined : function(){ openEraserFor(item, true); } },
    { showUseOriginal: !useOriginal }
  );
}
async function openWatermarkFor(item, fromOriginal = false){
  if(item.kind==="video"){ toast("Hapus Watermark cuma buat foto dulu."); return; }
  var useOriginal= !!fromOriginal || !item.cleanedBlob;
  var src= useOriginal ? item.file : item.cleanedBlob;
  var type= useOriginal ? item.file.type : (item.cleanedType||item.file.type);
  var wm;
  try{ wm=await import("./watermark"); }
  catch(e){ toast("Editor gagal dimuat. Coba refresh."); return; }
  await wm.openWatermark(
    { name:item.file.name, blob:src, type:type, suggestName:outName(item), sourceLabel: useOriginal ? "Asli" : (SOURCE_LABEL[item.currentLabel]||"hasil Bersihkan") },
    { onReplace:function(blob){ replaceCleaned(item,blob,"Watermark dihapus","Hasil hapus watermark disimpan ✓","watermark"); }, onToast:toast,
      onUseOriginal: useOriginal ? undefined : function(){ openWatermarkFor(item, true); } },
    { showUseOriginal: !useOriginal }
  );
}
/* ── Hapus Latar (src/background.ts) ──
   Editor dimuat malas (dynamic import) — nggak ada di JS awal.
   Mesinnya ORMBG int8 (44 MB, Apache-2.0) — diunduh sekali saat alat
   dibuka, tersimpan di HP, inferensi di Web Worker. Hasil yang disimpan
   jadi file bersih baru: di-scan ulang & statusnya dihitung jujur kayak
   habis dibersihin (replaceCleaned → finishClean). */
async function openBackgroundFor(item, fromOriginal = false){
  if(item.kind==="video"){ toast("Hapus Latar cuma buat foto dulu."); return; }
  var useOriginal= !!fromOriginal || !item.cleanedBlob;
  var src= useOriginal ? item.file : item.cleanedBlob;
  var type= useOriginal ? item.file.type : (item.cleanedType||item.file.type);
  var bg;
  try{ bg=await import("./background"); }
  catch(e){ toast("Editor gagal dimuat. Coba refresh."); return; }
  await bg.openBackground(
    { name:item.file.name, blob:src, type:type, suggestName:outName(item), sourceLabel: useOriginal ? "Asli" : (SOURCE_LABEL[item.currentLabel]||"hasil Bersihkan") },
    { onReplace:function(blob){ replaceCleaned(item,blob,"Latar dihapus","Hasil hapus latar disimpan ✓","background"); }, onToast:toast,
      onUseOriginal: useOriginal ? undefined : function(){ openBackgroundFor(item, true); } },
    { showUseOriginal: !useOriginal }
  );
}
/* ── Perbesar (src/upscale.ts) ──
   Editor dimuat malas (dynamic import) — nggak ada di JS awal.
   Mesinnya Real-ESRGAN General x4v3 (4,6 MB, BSD-3-Clause) — diunduh
   sekali saat alat dibuka, tersimpan di HP, inferensi di Web Worker.
   Lanczos murni cuma fallback offline diam-diam. Hasil yang disimpan
   jadi file bersih baru: di-scan ulang & statusnya dihitung jujur kayak
   habis dibersihin (replaceCleaned → finishClean). */
async function openUpscaleFor(item, fromOriginal = false){
  if(item.kind==="video"){ toast("Perbesar cuma buat foto dulu."); return; }
  var useOriginal= !!fromOriginal || !item.cleanedBlob;
  var src= useOriginal ? item.file : item.cleanedBlob;
  var type= useOriginal ? item.file.type : (item.cleanedType||item.file.type);
  var up;
  try{ up=await import("./upscale"); }
  catch(e){ toast("Editor gagal dimuat. Coba refresh."); return; }
  await up.openUpscale(
    { name:item.file.name, blob:src, type:type, suggestName:outName(item), sourceLabel: useOriginal ? "Asli" : (SOURCE_LABEL[item.currentLabel]||"hasil Bersihkan") },
    { onReplace:function(blob){ replaceCleaned(item,blob,"Foto diperbesar","Hasil perbesar disimpan ✓","upscale"); }, onToast:toast,
      onUseOriginal: useOriginal ? undefined : function(){ openUpscaleFor(item, true); } },
    { showUseOriginal: !useOriginal }
  );
}
/* ── Hapus Jejak (src/jejak.ts) ──
   Editor dimuat malas (dynamic import) — nggak ada di JS awal.
   Pindai jejak privasi (EXIF/GPS/IPTC/XMP/teks PNG/ICC) lalu hapus lewat
   scrubTracesBlob (strip lossless yang sama dengan Bersihkan + jalur
   canvas). Hasil yang disimpan jadi file bersih baru: di-scan ulang &
   statusnya dihitung jujur kayak habis dibersihin (replaceCleaned). */
async function openJejakFor(item, fromOriginal = false){
  if(item.kind==="video"){ toast("Hapus Jejak cuma buat foto dulu."); return; }
  var useOriginal= !!fromOriginal || !item.cleanedBlob;
  var src= useOriginal ? item.file : item.cleanedBlob;
  var type= useOriginal ? item.file.type : (item.cleanedType||item.file.type);
  var jk;
  try{ jk=await import("./jejak"); }
  catch(e){ toast("Editor gagal dimuat. Coba refresh."); return; }
  await jk.openJejak(
    { name:item.file.name, blob:src, type:type, suggestName:outName(item), sourceLabel: useOriginal ? "Asli" : (SOURCE_LABEL[item.currentLabel]||"hasil Bersihkan") },
    { onReplace:function(blob){ replaceCleaned(item,blob,"Jejak dihapus","Hasil hapus jejak disimpan ✓","jejak"); }, onToast:toast,
      onScrub: scrubTracesBlob,
      onUseOriginal: useOriginal ? undefined : function(){ openJejakFor(item, true); } },
    { showUseOriginal: !useOriginal }
  );
}
async function replaceCleaned(item,blob,doneText="Objek dihapus",toastText="Hasil hapus objek disimpan ✓",tool="erase"){
  item.cleanedBlob=blob;
  item.cleanedType=blob.type||item.cleanedType||item.file.type;
  item.cleanedName=outName(item);
  if(item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
  item.cleanedUrl=URL.createObjectURL(blob);
  item.cleanedScan=null;
  try{ item.cleanedScan=await scanBuffer(await blob.arrayBuffer(),"image"); }catch(e){}
  item.status="cleaned";
  if(item.tools) item.tools[tool]="selesai";
  item.lastEdit=tool;
  var cn=document.getElementById("cname-"+item.id); if(cn) cn.textContent=item.cleanedName;
  var res=document.getElementById("result-"+item.id);
  var statusEl=document.getElementById("status-"+item.id);
  /* B15: head = apa yang dihapus; body = bukti re-scan + ukuran. Kalau
     re-scan masih nemu label, kotaknya merah + tombol Coba Deep Clean —
     edit tidak boleh diam-diam mengklaim bersih. */
  var box= (item.cleanedScan && item.cleanedScan.hasAI)
    ? {head:doneText, body:doneText+", lalu dicek ulang: masih ada label tersisa.", action:{label:"Coba Deep Clean", act:"deepclean"}}
    : {head:doneText, body:"lalu dicek ulang: 0 label AI tersisa. Ukuran "+formatBytes(blob.size)+"."};
  /* Hasil editor masuk tumpukan versi dengan label alatnya ("Objek" /
     "Watermark" / "Latar") — bukan menimpa buta. */
  var VERSION_LABEL={erase:"Objek",watermark:"Watermark",background:"Latar",upscale:"Perbesar",jejak:"Jejak"};
  finishClean(item,res,statusEl,box, VERSION_LABEL[tool]||"Objek");
  updateStats();
  toast(toastText);
}

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

/* ── Stats / batch bar ──
   Semua angka baca getFileState (satu sumber kebenaran): "sudah bersih"
   cuma dihitung dari re-scan bersih, "masih ada label" dari residual. */
function updateStats(){
  var verified=items.filter(function(i){return getFileState(i).key==="cleaned"}).length;
  var residual=items.filter(function(i){return getFileState(i).key==="residual"}).length;
  var cleaned=items.filter(function(i){return i.cleanedBlob}).length;
  $("#queueSection").classList.toggle("hidden", items.length===0);
  /* Pengaturan adalah pengaturan BERSIHKAN: tampil cuma di workspace
     Bersihkan, dan TETAP tampil walau file sudah masuk — dulu kartu ini
     disembunyiin bareng dropzone pas ada file, jadi user nggak bisa ganti
     Mode ke Deep setelah lihat "Label tersisa" tanpa Mulai ulang.
     Dropzone juga tetap tampil di workspace. Marquee brand tetap
     disembunyiin pas antrean berisi, biar halaman fokus ke daftar file. */
  var sc=document.getElementById("settingsCard"); if(sc) sc.classList.toggle("hidden", activeTool!=="clean");
  /* Inspector desktop (§02): pengaturan jadi panel kanan cuma pas alat
     Bersihkan — kelas ini yang mengaktifkan grid inspector ≥1280px. */
  var pc=document.getElementById("panel-cleaner"); if(pc) pc.classList.toggle("has-inspector", activeTool==="clean");
  var bw=document.getElementById("brandWrap"); if(bw) bw.classList.toggle("hidden", items.length>0);
  document.body.classList.toggle("has-files", items.length>0);
  renderDeskFiles();
  updateToolStepper();
  syncDockBottom();
  $("#statsText").textContent= items.length? "· "+items.length+" file · "+verified+" sudah bersih"+(residual? " · "+residual+" masih ada label":"") : "";
  $("#batchBar").classList.toggle("hidden", cleaned<2);
  $("#batchStats").textContent= verified+" file siap disimpan";
  $("#zipBtn").disabled= cleaned<2 || batchRunning;
  $("#zipBtn").innerHTML= ic("i-archive","ic-sm")+"<span>ZIP ("+cleaned+")</span>";
  /* Banner "file siap": cuma di home (belum ada alat aktif) & ada antrean —
     ini penanda file yang diantre tanpa alat (foto contoh / paste / drop). */
  var sb=$("#sampleBanner");
  if(sb){
    var showB= items.length>0 && !activeTool;
    sb.classList.toggle("hidden", !showB);
    /* Desktop: alat ada di sidebar kiri ("di samping"), bukan "di atas". */
    var deskB=!!(window.matchMedia && window.matchMedia("(min-width:1024px)").matches);
    if(showB) sb.textContent= items.length+" file siap — pilih alat "+(deskB?"di samping":"di atas")+" untuk mulai.";
  }
  syncShell();
  syncPrimary();
}

/* ── Daftar file di sidebar desktop (§02: hierarki file) ──
   Baris ringkas (thumb + nama + status) — dirender ulang dari updateStats
   (satu titik sinkronisasi) & selectItem (ganti file terpilih). Di HP
   sidebar display:none, jadi ini no-op visual. */
function renderDeskFiles(){
  var wrap=$("#deskFiles"); if(!wrap) return;
  if(!items.length){ wrap.innerHTML='<p class="ds-empty">Belum ada file.<br>Taruh foto di workspace.</p>'; return; }
  wrap.innerHTML=items.map(function(x){
    var st=getFileState(x);
    return '<button type="button" class="ds-file'+(x.id===selectedId?" active":"")+'" data-desk-file="'+x.id+'" aria-pressed="'+(x.id===selectedId?"true":"false")+'">'+
      '<img src="'+(x.cleanedUrl||x.url)+'" alt="" loading="lazy">'+
      '<span class="ds-file-meta"><b>'+escapeHtml(x.file.name)+'</b><i>'+escapeHtml(st.text)+'</i></span></button>';
  }).join("");
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
  openSheet({title:"Mulai ulang?", body:"Semua file & hasil di antrean dibuang, lalu kembali ke pemilih alat.", confirm:"Mulai ulang", danger:true, onConfirm:function(){
    clearAllItems();
    setActiveTool(null); /* balik ke pemilih alat */
    window.scrollTo({top:0,behavior:"smooth"});
  }});
});
/* ── Pemilih alat + baris ganti alat ──
   Kartu pemilih: masuk workspace alat itu (scroll ke atas workspace).
   Chip "‹ Semua alat": balik ke pemilih (file & hasil tetap di antrean). */
$$("[data-tool]").forEach(function(b){
  b.addEventListener("click",function(){
    setActiveTool(b.dataset.tool);
    var panel=$("#panel-cleaner");
    if(panel) panel.scrollIntoView({behavior:"smooth",block:"start"});
  });
});
$$("[data-tool-switch]").forEach(function(b){
  b.addEventListener("click",function(){
    if(!b.dataset.toolSwitch){ setActiveTool(null); window.scrollTo({top:0,behavior:"smooth"}); }
    else setActiveTool(b.dataset.toolSwitch);
  });
});
/* ── Sidebar desktop (§02): tombol alat + daftar file. Satu sumber
   kebenaran dengan kartu pemilih: klik = setActiveTool yang sama.
   "Semua alat" = balik ke beranda (file & hasil tetap di antrean). ── */
$$("#deskSidebar [data-sidebar-tool]").forEach(function(b){
  b.addEventListener("click",function(){
    if(!b.dataset.sidebarTool){ setActiveTool(null); window.scrollTo({top:0,behavior:"smooth"}); return; }
    setActiveTool(b.dataset.sidebarTool);
    var panel=$("#panel-cleaner");
    if(panel) panel.scrollIntoView({behavior:"smooth",block:"start"});
  });
});
$("#deskFiles").addEventListener("click",function(e){
  var b=(e.target as Element).closest("[data-desk-file]") as HTMLButtonElement; if(!b) return;
  var id=parseInt(b.dataset.deskFile,10); if(!id) return;
  selectItem(id);
  if(activeTool){ var eh=$("#editorHead"); if(eh) eh.scrollIntoView({behavior:"smooth",block:"start"}); }
  else { var c=document.getElementById("card-"+id); if(c) c.scrollIntoView({behavior:"smooth",block:"center"}); }
});
/* Tombol "Cari duplikat" di tampilan Hapus Duplikat. */
$("#dedupScanBtn").addEventListener("click",function(){ scanDuplicates(); });

/* ── Bottom sheet generik (P1): konfirmasi & alur sekunder, maks 1 level.
   Dipakai buat aksi destruktif (Mulai ulang / Hapus semua / Hapus file)
   supaya tidak ada hapus yang sekali ketuk tanpa konfirmasi. ── */
var sheetConfirmFn: (() => void) | null = null;
function openSheet(opts: {title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void}){
  var t=$("#sheetTitle"); if(t) t.textContent=opts.title;
  var b=$("#sheetBody"); if(b) b.textContent=opts.body;
  var c=$("#sheetConfirm"); if(c){ c.textContent=opts.confirm; c.classList.toggle("danger", !!opts.danger); }
  sheetConfirmFn=opts.onConfirm;
  var s=$("#sheetScrim"); if(s) s.classList.remove("hidden");
  var sh=$("#sheet"); if(sh) sh.classList.remove("hidden");
}
function closeSheet(){
  var s=$("#sheetScrim"); if(s) s.classList.add("hidden");
  var sh=$("#sheet"); if(sh) sh.classList.add("hidden");
  sheetConfirmFn=null;
}
$("#sheetCancel").addEventListener("click",function(){ closeSheet(); });
$("#sheetScrim").addEventListener("click",function(){ closeSheet(); });
$("#sheetConfirm").addEventListener("click",function(){ var f=sheetConfirmFn; closeSheet(); if(f) f(); });
document.addEventListener("keydown",function(e){ if(e.key==="Escape" && !$("#sheet").classList.contains("hidden")) closeSheet(); });
function removeItem(it){
  URL.revokeObjectURL(it.url); if(it.cleanedUrl) URL.revokeObjectURL(it.cleanedUrl);
  items=items.filter(function(i){return i.id!==it.id});
  if(selectedId===it.id) selectedId=null;
  var c=document.getElementById("card-"+it.id); if(c) c.remove();
  updateStats();
}

/* ── Tombol utama sticky + tombol topbar + kepala editor ── */
$("#primaryBtn").addEventListener("click",function(){ runPrimary(); });
$("#topExportBtn").addEventListener("click",function(){ var it=selectedItem(); if(it && it.cleanedBlob) saveItem(it); });
$("#topBackBtn").addEventListener("click",function(){ setActiveTool(null); window.scrollTo({top:0,behavior:"smooth"}); });
$("#shellFilm").addEventListener("click",function(e){
  var b=(e.target as Element).closest("button[data-shell-id]") as HTMLButtonElement; if(!b) return;
  selectItem(parseInt(b.dataset.shellId,10));
});
$("#shellVersions").addEventListener("click",function(e){
  var b=(e.target as Element).closest("button[data-v]") as HTMLButtonElement; if(!b) return;
  var it=selectedItem(); if(it) setCurrentVersion(it, b.dataset.v);
});
$("#shellUndo").addEventListener("click",function(){
  var it=selectedItem(); if(!it || !it.versions || it.versions.length<2) return;
  var idx=it.versions.findIndex(function(v){return v.label===it.currentLabel});
  var prev= idx>0 ? it.versions[idx-1] : it.versions[0];
  setCurrentVersion(it, prev.label);
});
(function(){
  var cmp=$("#shellCompare"); if(!cmp) return;
  function holdOn(e){ e.preventDefault(); var it=selectedItem(); if(!it) return; shellComparing=true; var img=$("#shellImg") as HTMLImageElement; if(img){ img.src=it.url; img.setAttribute("data-cur",it.url); } }
  function holdOff(){ if(!shellComparing) return; shellComparing=false; var it=selectedItem(); var img=$("#shellImg") as HTMLImageElement; if(it && img){ var want=it.cleanedUrl||it.url; img.src=want; img.setAttribute("data-cur",want); } }
  cmp.addEventListener("pointerdown",holdOn);
  ["pointerup","pointerleave","pointercancel"].forEach(function(ev){ cmp.addEventListener(ev,holdOff); });
})();

/* ── Coba foto contoh (home): file digenerate runtime, diantre, lalu user
   tetap pilih alat dulu — tidak ada alat yang jalan otomatis. ── */
$("#sampleBtn").addEventListener("click",async function(){
  var btn=this as HTMLButtonElement; btn.disabled=true;
  try{
    var sm=await import("./sample");
    var file=await sm.makeSampleFile();
    await handleFiles([file], {sample:true});
  }catch(e){ toast("Foto contoh gagal dibuat. Coba lagi."); }
  btn.disabled=false;
});
/* Tombol "+ File" di topbar: belum pilih alat → scroll ke pemilih alat;
   udah ada file → langsung buka picker file (sama kayak "+ Tambah").
   Belum pilih alat & belum ada file → anchor default scroll ke dropzone
   workspace (yang muncul begitu alat dipilih). */
$("#topAddBtn").addEventListener("click",function(e){
  if(!activeTool){
    e.preventDefault();
    /* Desktop: pemilih alat sudah jadi sidebar yang selalu kelihatan —
       tidak ada yang perlu di-scroll ke sana; cukup kembali ke atas. */
    if(window.matchMedia && window.matchMedia("(min-width:1024px)").matches){ window.scrollTo({top:0,behavior:"smooth"}); return; }
    var p=$("#toolPicker"); if(p) p.scrollIntoView({behavior:"smooth",block:"start"}); return;
  }
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
  if(fs && fs.length) routeFiles(fs);
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
  /* Ketuk badan kartu (bukan tombol/thumb) = pilih file itu ke kepala editor. */
  if(!(e.target as Element).closest("button,select,input,a,video,img")){
    var cardEl=(e.target as Element).closest("article");
    if(cardEl){
      var cid=parseInt(cardEl.id.replace("card-",""),10);
      if(cid){ selectItem(cid); var eh=$("#editorHead"); if(eh) eh.scrollIntoView({behavior:"smooth",block:"start"}); }
    }
    return;
  }
  var sw=(e.target as Element).closest("button[data-tool-switch]") as HTMLButtonElement;
  if(sw){
    /* Chip di rel kartu: pilih file ini + buka alat itu di kepala editor
       (foto kelihatan di atas, bukan kartu di bawah). */
    var it2=items.find(function(i){return i.id===parseInt(sw.dataset.id,10)});
    if(it2){
      selectItem(it2.id);
      setActiveTool(sw.dataset.toolSwitch);
      var eh2=$("#editorHead"); if(eh2) eh2.scrollIntoView({behavior:"smooth",block:"start"});
    }
    return;
  }
  var btn=(e.target as Element).closest("button[data-act]") as HTMLButtonElement; if(!btn) return;
  var it=items.find(function(i){return i.id===parseInt(btn.dataset.id,10)}); if(!it) return;
  if(btn.dataset.act==="save"){ saveItem(it); }
  else if(btn.dataset.act==="meta"){ var fm=document.getElementById("fold-meta-"+it.id); if(fm){ var openM=fm.classList.toggle("hidden")===false; btn.setAttribute("aria-expanded",openM?"true":"false"); if(openM){ loadMeta(it); setTimeout(function(){ fm.scrollIntoView({block:"nearest",behavior:"smooth"}); },60); } } }
  else if(btn.dataset.act==="more"){ var fo=document.getElementById("fold-more-"+it.id); if(fo){ var openF=fo.classList.toggle("hidden")===false; btn.setAttribute("aria-expanded",openF?"true":"false"); if(openF) setTimeout(function(){ fo.scrollIntoView({block:"nearest",behavior:"smooth"}); },60); } }
  else if(btn.dataset.act==="convert"){ await convertItem(it,btn); }
  else if(btn.dataset.act==="frame"){ await frameItem(it,btn); }
  else if(btn.dataset.act==="compress"){ await compressItem(it,btn); }
  else if(btn.dataset.act==="reclean"){ btn.disabled=true; await cleanItem(it); btn.disabled=false; toast("Dibersihin ulang ✓"); }
  else if(btn.dataset.act==="deepclean"){ setDeepClean(true); btn.disabled=true; await cleanItem(it); btn.disabled=false; }
  else if(btn.dataset.act==="version"){ setCurrentVersion(it, btn.dataset.v); }
  else if(btn.dataset.act==="remove"){
    openSheet({title:"Hapus file ini?", body:it.file.name+" dibuang dari antrean beserta hasilnya.", confirm:"Hapus", danger:true, onConfirm:function(){ removeItem(it); }});
  }
});

/* ── Batch events ── */
/* Dock progres: "Lihat" lompat ke kartu yang lagi diproses saat ini */
$("#procDockBtn").addEventListener("click",function(){
  var el= procCurId ? document.getElementById("card-"+procCurId) : document.querySelector("#list .is-processing");
  if(el) el.scrollIntoView({behavior:"smooth",block:"center"});
});
$("#clearBtn").addEventListener("click",function(){
  openSheet({title:"Hapus semua?", body:"Semua file di antrean dibuang beserta hasilnya.", confirm:"Hapus semua", danger:true, onConfirm:function(){ clearAllItems(); }});
});
/* JSZip dimuat SEKALI pas pertama kali dibutuhin (tombol ZIP) — janjinya
   disimpan biar klik berikutnya langsung jalan tanpa muat ulang. */
/* JSZip dibundel Vite (npm jszip, di-pin) dan dimuat malas lewat dynamic
   import — chunk terpisah, baru diunduh pas user neken tombol ZIP. */
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
  }catch(e){ toast("ZIP gagal. Simpan satu-satu."); }
  btn.disabled=false; updateStats();
});
$("#previewClose").addEventListener("click",function(){ $("#previewModal").classList.add("hidden"); $("#previewBody").innerHTML=""; });
$("#previewModal").addEventListener("click",function(e){ if(e.target===this){ this.classList.add("hidden"); $("#previewBody").innerHTML=""; } });
document.addEventListener("keydown",function(e){ if(e.key==="Escape" && !$("#previewModal").classList.contains("hidden")){ $("#previewModal").classList.add("hidden"); $("#previewBody").innerHTML=""; } });
/* ═══════════ Router file: semua jalur masuk (paste, drop di mana aja)
   lewat sini — handleFiles merutekan ke alat aktif (Langkah 2).
   Metadata, konversi & video tetap hidup di dalam kartu file yang sama
   (lihat renderItem + fold-nya). ═══════════ */
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
