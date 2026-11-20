import type JSZipType from "jszip";
import { addHistory, listHistory, getHistory, deleteHistory, clearHistory, historySupported } from "./history";
import * as metaedit from "./metaedit";
import { scanTraces } from "./jejak";
import { inspectFile, integrityOf, type Inspection } from "./inspection";

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
var cleanProfile: "label" | "privacy" | "deep" = "label";
var batchStopRequested = false, batchActive = false;

/* ── Alat aktif (file-first): null = home. Default = "clean" — begitu
   file masuk, Bersihkan langsung jalan (lihat handleFiles), jadi null
   cuma berarti "belum ada file / baru Back dari editor".
   "clean" | "meta" | "watermark". File baru dirutekan ke alat aktif:
   Bersihkan → auto-scan+clean; meta → panel metadata; watermark →
   editor kuas. (Perintah Bobby 19 Nov 2026 19:14 WIB: file-first.) */
var activeTool=null;
/* Alat terakhir yang aktif — dipakai tombol "Buka editor" (#resumeBtn)
   + header "+ File" saat kembali dari home tanpa upload baru.
   setActiveTool(null) (Back / Mulai ulang) TIDAK menghapusnya. */
var lastTool=null;
/* Foto terpilih di kepala editor (satu foto satu sesi): null = belum ada
   foto. Dipilih otomatis saat file masuk (yang pertama) & lewat filmstrip
   atau ketuk badan kartu. */
var selectedId: number | null = null;
function selectedItem(){ return items.find(function(i){return i.id===selectedId}) || items[0] || null; }
/* Ganti file terpilih (filmstrip): status alat + ketersediaan alat harus
   ikut berubah — kalau tidak, chip foto-only tetap aktif saat video
   dipilih dan baris status masih menunjukkan instruksi file sebelumnya
   (celah P0-07, ditemukan saat retake video-foto-only). */
/* Kotak hasil (#shellResult) milik SATU file + SATU alat: begitu file
   berganti, alat Meta dibuka, atau antrean dibuang (Mulai ulang),
   verdict lama harus hilang — kalau tidak, teks file sebelumnya tampil
   di bawah file baru (kotak basi, ditemukan verifier 19 Nov 2026).
   Sembunyikan + kosongkan isinya, bukan cuma hidden: waitForFunction
   berbasis textContent di e2e ikut membaca teks basi kalau cuma hidden. */
function clearShellResult(){ var r=document.getElementById("shellResult"); if(r){ r.classList.add("hidden"); r.innerHTML=""; } }
function selectItem(id){
  selectedId=id; shellComparing=false; clearShellResult(); syncShell(); syncPrimary(); updateStats();
  var si=selectedItem();
  if(!si || !activeTool) return;
  if(activeTool==="meta"){ void openMetaFor(si); return; }
  // Restore the selected file's own result; do not show a previous file's verdict.
  var v=(si.versions||[]).find(function(x){return x.label===si.currentLabel;});
  if(v && v.box && si.cleanedBlob){
    var res=$("#shellResult"); res.classList.remove("hidden"); renderResultBox(si,res,v.box);
  }
  // Switching files should run the active tool, but an explicitly chosen
  // original version must not be silently converted back to the clean version.
  if(si.currentLabel!=="Asli") void autoRunTool(activeTool,si);
}
var TOOL_RESULT_LABEL={clean:"Bersih",meta:"Metadata",watermark:"Watermark"};
var PHOTO_ONLY=["watermark","meta"];
/* Hasil alat dianggap ADA hanya kalau versi itu yang sedang ditampilkan.
   Versi yang tersimpan tapi tidak aktif (user sudah kembali ke "Asli")
   TIDAK menghalangi alat dibuka/dijalankan lagi — kalau tidak, chip alat
   jadi mati setelah user kembali ke Asli. */
function toolHasResult(item,tool){ return item.currentLabel===TOOL_RESULT_LABEL[tool]; }
/* Ganti alat = ganti workspace, bukan buang file: antrean, hasil & versi
   ikut. null = balik ke home (hero tampil, workspace sembunyi).
   Alat terpilih = alat jalan (prinsip A): begitu alat dipilih dan file sudah
   ada, alat itu langsung dikerjakan — urutan apa pun. */
function setActiveTool(tool){
  /* Keluar dari Edit Metadata dengan draft kotor -> konfirmasi dulu
     (Terapkan / Buang / Batal). Sheet "Batal" = tutup sheet saja. */
  if(activeTool==="meta" && tool && tool!=="meta" && metaedit.isMetaDirty()){
    openSheet({title:"Perubahan metadata belum diterapkan.", body:"Terapkan dulu, atau buang perubahan?", confirm:"Terapkan", extra:{label:"Buang perubahan", onClick:function(){ metaedit.discardMetaDraft(); setActiveTool(tool); }}, onConfirm:function(){ void (async function(){ if(await metaedit.applyMetaDraft()) setActiveTool(tool); })(); }});
    return;
  }
  if(activeTool!==tool) clearShellResult();
  activeTool=tool||null;
  if(tool) lastTool=tool;
  shellComparing=false;
  $$("[data-tool-switch]").forEach(function(x){
    var on=x.dataset.toolSwitch===(activeTool||"");
    x.setAttribute("aria-pressed", on?"true":"false");
    x.classList.toggle("active", on);
  });
  var hero=$("#heroSection"), panel=$("#panel-cleaner");
  if(hero) hero.classList.toggle("hidden", !!activeTool);
  if(panel){
    panel.classList.toggle("hidden", !activeTool);
    /* Editor fullscreen menggantikan home (layout kanonis): top bar
       editor tampil + header situs disembunyikan (body.editor-on).
       Tanpa alat aktif panel sembunyi total — dropzone + contoh tinggal
       di #heroSection, jadi tidak butuh panel sebagai "antrean". */
    panel.classList.toggle("is-editor", !!activeTool);
  }
  document.body.classList.toggle("editor-on", !!activeTool);
  scrollActiveChipIntoView();
  updateStats();
  if(activeTool && selectedItem()) void autoRunTool(activeTool, selectedItem());
}
/* Rail auto-scroll: chip aktif selalu dibawa ke tengah rail setiap alat
   berubah — di 390px rail cuma ~157px lebar, tanpa ini chip aktif (mis.
   Dedup, chip ke-7) sepenuhnya di luar layar dan pengguna tidak tahu alat
   apa yang sedang aktif. scrollLeft dihitung dari posisi chip relatif ke
   rail (bukan scrollIntoView) supaya halaman tidak ikut bergeser vertikal;
   smooth kecuali prefers-reduced-motion. Dipanggil dari setActiveTool,
   satu-satunya jalur ganti alat (tombol Buka editor, chip rail, Back, restart). */
function scrollActiveChipIntoView(){
  if(!activeTool) return;
  var bar=$("#toolBar");
  if(!bar) return;
  var chip=bar.querySelector('[data-tool-switch="'+activeTool+'"]');
  if(!chip) return;
  var barRect=bar.getBoundingClientRect(), chipRect=chip.getBoundingClientRect();
  var target=bar.scrollLeft + (chipRect.left - barRect.left) + chipRect.width/2 - bar.clientWidth/2;
  var reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* scroll-snap-align chip = center (CSS): titik snap tiap chip SAMA
     dengan posisi tengahnya, jadi snap tidak lagi menarik scroll
     programatik ke tepi kiri — pemusatan dan snap saling menguatkan,
     termasuk saat pengguna menggeser rail manual. */
  bar.scrollTo({left: target, behavior: reduce?"auto":"smooth"});
}
/* Alat jalan otomatis begitu (file + alat) lengkap — dipanggil dari
   setActiveTool (alat dipilih sesudah file ada) dan handleFiles (file
   masuk sesudah alat dipilih). Alat yang hasilnya sudah ada tidak
   dijalankan ulang: hasilnya tinggal disimpan. Alat foto-only tidak
   jalan untuk video — statusnya ditulis di tempat, bukan toast. */
var autoRunning=false;
var queuedToolRun: {tool: string; id: number} | null = null;
async function autoRunTool(tool, item){
  if(!tool || !item) return;
  if(autoRunning){ queuedToolRun={tool:tool,id:item.id}; return; }
  if(PHOTO_ONLY.indexOf(tool)!==-1 && item.kind==="video"){ updateToolStatus(); return; }
  if(toolHasResult(item,tool)) return;
  autoRunning=true;
  try{
    if(tool==="clean"){ await cleanBatch([item].concat(items.filter(function(i){return i.id!==item.id && !i.cleanedBlob}))); }
    else if(tool==="meta"){ await openMetaFor(item); }
    else if(tool==="watermark"){ await openWatermarkFor(item); }
  } finally {
    autoRunning=false;
    updateStats();
    var next=queuedToolRun; queuedToolRun=null;
    if(next && activeTool===next.tool && selectedItem()?.id===next.id){
      var nextItem=selectedItem();
      if(nextItem && !toolHasResult(nextItem,next.tool)) void autoRunTool(next.tool,nextItem);
    }
  }
}

async function cleanBatch(list){
  if(batchActive) return;
  batchActive=true; batchStopRequested=false;
  updateBatchControls();
  var dock=$("#procDock"), dockBar=$("#procDockBar"), dockText=$("#procDockText");
  var done=0;
  updateStats();
  function paint(){
    procCurId= done<list.length ? list[done].id : null;
    if(dockBar) dockBar.style.width=(list.length? Math.round(done/list.length*100):0)+"%";
    if(dockText) dockText.textContent= done>=list.length ? "Selesai" : "Membersihkan "+(done+1)+" dari "+list.length;
    syncDockBottom();
  }
  if(dock) dock.classList.remove("hidden");
  paint();
  for(var ci=0; ci<list.length; ci++){
    if(batchStopRequested) break;
    try { await cleanItem(list[ci]); }
    catch(e){ failClean(list[ci],"failed",String((e as Error).message || e),true); }
    done++; paint();
    await new Promise(function(resolve){ setTimeout(resolve,0); });
  }
  setTimeout(function(){ if(dock) dock.classList.add("hidden"); procCurId=null; },1200);
  batchRunning=false; batchActive=false; updateStats();
  if(batchStopRequested){ toast("Antrean dihentikan. Hasil yang sudah selesai tetap ada."); return; }
  var okCount=list.filter(function(x){return getFileState(x).key==="cleaned"}).length;
  var residual=list.filter(function(x){return getFileState(x).key==="residual"}).length;
  if(okCount===list.length) toast("Beres ✓ " + okCount + " file bersih — label AI sudah hilang.");
  else if(okCount>0) toast(okCount + "/" + list.length + " file bersih" + (residual ? " · " + residual + " masih ada label." : "."));
  else if(residual>0) toast("0/" + list.length + " file bersih · " + residual + " masih ada label.");
  else toast("Tidak ada yang bisa dibersihkan.");
}

/* ── Kepala editor + tombol Simpan di top bar (layout kanonis) ──
   syncShell: filmstrip, canvas (maks 55vh), pill + bukti, chip versi,
   tombol Urungkan / Tahan-lihat-asli. syncPrimary: SATU tombol Simpan
   di top bar editor (kanan atas, nempel di hasil, selalu kelihatan
   tanpa scroll) — PINDAH dari sticky bottom bar, bukan tambah: tidak
   ada lagi #primaryBar, tidak ada dua jalur simpan. Keduanya dipanggil
   dari updateStats() — satu titik sinkronisasi sesudah hampir semua
   mutasi. */
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
  /* Filmstrip dirender SELALU (juga saat editor sembunyi): kalau tidak,
     thumb basi tetap tampil setelah antrean dibuang (Mulai ulang /
     hapus file terakhir) karena return dini di bawah melewatkan render. */
  var film=$("#shellFilm");
  if(film){
    var selId= it ? it.id : -1;
    film.innerHTML=items.map(function(x){
      return '<button type="button" class="shell-thumb'+(x.id===selId?" active":"")+'" data-shell-id="'+x.id+'" aria-label="Pilih '+escapeHtml(x.file.name)+'" aria-pressed="'+(x.id===selId?"true":"false")+'"><img src="'+(x.cleanedUrl||x.url)+'" alt=""></button>';
    }).join("");
  }
  if(!show) return;
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
  var un=$("#shellCompare");
  if(un){
    un.setAttribute("aria-pressed", shellComparing?"true":"false");
    un.textContent=shellComparing?"Lihat hasil":"Lihat asli";
    un.classList.toggle("hidden", !it.cleanedBlob || it.kind==="video");
  }
}
/* Tombol Simpan di top bar editor cuma punya DUA keadaan (prinsip C):
   (a) belum ada hasil — alat otomatis tidak punya tombol jalan (progres
       saja yang tampil); tidak ada lagi alat manual di v1.
   (b) ada hasil — "Simpan foto" (1 file) / "Simpan semua" (batch, ZIP).
   Kata kerja alat tidak pernah lagi dipakai sebagai tombol utama.
   Tombolnya sendiri (bukan bar) yang disembunyikan kalau tidak ada yang
   bisa dilakukan — top bar tetap tampil selama editor aktif. */
function cleanedItems(){ return items.filter(function(i){return i.cleanedBlob && i.currentLabel!=="Asli";}); }
function cleanOptionSignature(){ return [cleanProfile,outFormat,($("#qualityRange") as HTMLInputElement).value].join("|"); }
function cleanSettingsOutdated(){
  return activeTool==="clean" && items.some(function(i){
    return i.kind==="image" && i.cleanedBlob && i.currentLabel==="Bersih" &&
      i.cleanSignature && i.cleanSignature!==cleanOptionSignature();
  });
}
function syncPrimary(){
  var btn=$("#primaryBtn") as HTMLButtonElement; if(!btn) return;
  var dock=$("#saveDock");
  var summary=$("#saveSummary");
  var pending=$("#settingsPending");
  var it=selectedItem();
  var updating=cleanSettingsOutdated();
  var hasOutput=!!(activeTool && it && it.cleanedBlob && it.currentLabel!=="Asli");
  var n=cleanedItems().length;
  var show=updating || hasOutput;
  btn.classList.toggle("hidden", !show);
  if(dock) dock.classList.toggle("hidden",!show);
  if(pending) pending.classList.toggle("hidden", !updating);
  if(!show) return;
  btn.disabled=batchActive || autoRunning || (it && it.status==="cleaning");
  if(updating){
    btn.textContent="Terapkan perubahan";
    if(summary) summary.textContent="Format atau kualitas baru belum diterapkan ke file hasil.";
  }else{
    btn.textContent=n>=2?"Unduh semua ("+n+" ZIP)":"Unduh hasil";
    if(summary) summary.textContent="Versi yang akan diunduh: "+(it.currentLabel||"Hasil")+
      (n>=2?" · "+n+" file dalam satu ZIP":" · "+(it.cleanedName||it.file.name));
  }
}
async function runPrimary(){
  var it=selectedItem();
  if(!activeTool || !it || batchActive || autoRunning) return;
  if(cleanSettingsOutdated()){
    await cleanBatch(items.filter(function(i){return i.kind==="image";}));
    return;
  }
  if(!it.cleanedBlob || it.currentLabel==="Asli") return;
  if(cleanedItems().length>=2) await saveAllZip();
  else await saveItem(it);
}

/* Simpan batch: SATU jalur simpan untuk ≥2 file bersih (dipakai tombol
   utama "Simpan semua"). ZIP diunduh / dibagikan, sama seperti dulu. */
async function saveAllZip(){
  var clean=cleanedItems(); if(clean.length<2) return;
  var btn=$("#primaryBtn") as HTMLButtonElement;
  var prevLabel=btn ? btn.textContent : "";
  if(btn){ btn.disabled=true; btn.textContent="Lagi disiapkan…"; }
  try{ await loadJSZip(); }catch(e){ toast("ZIP gagal. Simpan satu-satu."); if(btn){ btn.disabled=false; btn.textContent=prevLabel; } return; }
  try{
    refreshNames();
    var zip=new JSZipCtor!(); var used={};
    clean.forEach(function(it){ var name=it.cleanedName; var n=2; while(used[name]){ name=it.cleanedName.replace(/(\.[^.]+)$/,"-"+(n++)+"$1"); } used[name]=1; zip.file(name,it.cleanedBlob); });
    var blob=await zip.generateAsync({type:"blob"});
    var url=URL.createObjectURL(blob);
    var link=document.createElement("a"); link.href=url; link.download="foto-bersih.zip"; link.style.display="none";
    document.body.appendChild(link); link.click();
    setTimeout(function(){ link.remove(); URL.revokeObjectURL(url); },4000);
    toast("Unduhan ZIP "+clean.length+" file dimulai.");
  }catch(e){ toast("ZIP gagal. Simpan satu-satu."); }
  if(btn){ btn.disabled=false; btn.textContent=prevLabel; }
  updateStats();
}
/* Status satu baris (prinsip F) — menggantikan stepper workspace yang
   menampilkan langkah yang bukan langkah user. Satu kalimat jujur tentang
   keadaan sekarang + apa yang bisa dilakukan selanjutnya. */
function updateToolStatus(){
  var bar=document.getElementById("toolStatus");
  if(!bar) return;
  if(!activeTool){ bar.textContent=""; bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  var it=selectedItem();
  var TOOL_NAME={clean:"Bersihkan",meta:"Edit Metadata",watermark:"Hapus Watermark"};
  var name=TOOL_NAME[activeTool]||"Alat ini";
  if(!it){ bar.textContent="Pilih file untuk "+name+"."; return; }
  if(it.kind==="video" && PHOTO_ONLY.indexOf(activeTool)!==-1){
    bar.textContent="Video dipilih — "+name+" hanya untuk foto. Bersihkan tetap bisa dipakai.";
    return;
  }
  var st=getFileState(it);
  if(st.key==="cleaning"){ bar.textContent="Lagi diproses…"; return; }
  if(st.key==="failed"||st.key==="attention"){ bar.textContent="Ada yang perlu perhatian — coba lagi dari tombol di bawah kanvas."; return; }
  if(cleanSettingsOutdated()){ bar.textContent="Pilihan ekspor berubah — terapkan perubahan sebelum mengunduh."; return; }
  if(it.cleanedBlob){
    if(toolHasResult(it,activeTool)) bar.textContent="Hasil siap — unduh dari tombol Unduh hasil.";
    else bar.textContent="Versi "+(it.currentLabel||"hasil")+" masih tersedia untuk diunduh.";
    return;
  }
  if(activeTool==="clean"){
    bar.textContent= st.key==="detected" ? "Ada label AI — lagi dibersihkan…" : "Lagi dibersihkan…";
    return;
  }
  if(activeTool==="meta"){ bar.textContent="Lihat & ubah metadata di panel bawah — ketuk Terapkan kalau sudah pas."; return; }
  if(activeTool==="watermark"){ bar.textContent="Kami periksa otomatis — v1 cuma bisa menghapus sparkle Gemini."; return; }
  bar.textContent="";
}

/* Alat foto-only nonaktif + alasan saat video dipilih (prinsip G):
   chip di rail kepala editor dinonaktifkan — tidak ada lagi penolakan
   lewat toast sesudah ketuk. */
function syncToolAvailability(){
  var it=selectedItem();
  var isVid= !!(it && it.kind==="video");
  $$("[data-tool-switch]").forEach(function(x){
    var t=x.dataset.toolSwitch; if(!t) return;
    var dis= isVid && PHOTO_ONLY.indexOf(t)!==-1;
    (x as HTMLButtonElement).disabled=dis;
    x.classList.toggle("is-disabled", dis);
    x.title= dis ? "Hanya foto — video tidak bisa" : "";
  });
  $$("[data-tool]").forEach(function(x){
    var t=x.dataset.tool; if(!t) return;
    var dis= isVid && PHOTO_ONLY.indexOf(t)!==-1;
    (x as HTMLButtonElement).disabled=dis;
    x.classList.toggle("is-disabled", dis);
    x.title= dis ? "Hanya foto — video tidak bisa" : "";
  });
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
  var tools=item.tools||{clean:"belum",meta:"belum",watermark:"belum"};
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
  var sel=selectedItem();
  if(!sel || sel.id!==item.id) return;
  var el=document.getElementById("shellPill"); if(!el) return;
  var st=getFileState(item);
  setPill(el, st.cls, st.icon, st.text);
}

/* Mode Deep dari tombol di kotak hasil (A5): nyalain mode Deep + samain
   tombol pengaturan [data-mode] biar UI-nya nggak bohong. Satu konsep,
   satu nama: "Deep" di pengaturan = tombol "Bersihkan dengan Deep". */
function setDeepClean(on){
  deepClean=!!on;
  $$("[data-mode]").forEach(function(x){ x.setAttribute("aria-pressed", (x.dataset.mode==="deep")===!!on ? "true" : "false"); });
}
/* Satu jalur gagal (A6–A8): pill + kotak merah dari getFileState, bukan
   setPill manual di tiap catch — biar "Gagal"/"Perhatian" nggak pernah
   beda sumber dengan pill di tempat lain. retry=true → tombol [Coba lagi]
   (data-act="reclean") di dalam kotak. */
function failClean(item,kind,body,retry){
  item.status="error"; item.errorKind=kind; if(item.tools) item.tools.clean="perlu perhatian";
  hideProc(item);
  var res=document.getElementById("shellResult");
  if(res){
    res.classList.remove("hidden");
    res.innerHTML='<div class="error-box">'+escapeHtml(body)+'</div>'+(retry?'<div class="mt-2"><button type="button" class="min-h-[44px] px-5 grad-bg text-white font-bold text-[13px] btn-ic" data-act="reclean" data-id="'+item.id+'">Coba lagi</button></div>':"");
  }
  syncShell();
  updateToolStatus();
}

/* Panel proses DI DALAM kartu: status proses hidup di badan kartu file itu
   sendiri (bukan cuma di atas halaman), jadi selalu kelihatan pas user
   lagi megang / scroll kartu ini di HP. wait=true buat kartu antre. */
function setProc(item,label,wait){
  var bar=document.getElementById("toolStatus");
  if(bar){ bar.classList.remove("hidden"); bar.textContent=label; }
}

function hideProc(item){ updateToolStatus(); }

/* Dock bawah melayang di atas gesture bar: tidak ada lagi bar bawah
   (tombol utama pindah ke top bar editor, batch bar jadi in-flow), jadi
   lantai dock tetap — 42px di atas bawah, cukup di atas gesture bar
   Android (env() = 0 di Chrome POCO F6). */
function syncDockBottom(){
  var dock=document.getElementById("procDock"); if(!dock) return;
  dock.style.bottom="max(42px, calc(14px + env(safe-area-inset-bottom)))";
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
function isMediaFile(f){ if(f.type && (f.type.indexOf("image/")===0 || f.type.indexOf("video/")===0)) return true; return /\.(jpe?g|png|webp|avif|heic|heif|tiff?|mp4|mov|m4v|webm)$/i.test(f.name||""); }
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
   File-first (perintah Bobby 19 Nov 2026 19:14 WIB): file masuk dari
   home → alat default Bersihkan langsung jalan (prinsip A). Tidak ada
   lagi state "file menunggu alat dipilih". */
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
    var item={id:++idCounter, file:file, kind:kind, scan:scan, url:URL.createObjectURL(file), cleanedBlob:null, cleanedUrl:null, cleanedName:"", cleanedType:"", cleanedScan:null, status:"ready", errorKind:null, lastEdit:null, tools:{clean:"belum",meta:"belum",watermark:"belum"}, versions:[{label:"Asli", blob:file, type:file.type, scan:scan, box:null}], currentLabel:"Asli"};
    items.push(item); created.push(item);
  }
  batchRunning=true; updateStats();
  /* Pilih file dulu, BARU nyalakan alat: selectItem() mengosongkan kotak
     hasil (#shellResult), sedangkan setActiveTool("clean") langsung
     menjalankan auto-clean — dan jalur cepat video (A7/A8 + video bersih)
     merender hasilnya SECARA SINKRON karena scan.mp4Boxes sudah ada.
     Kalau urutannya dibalik, kotak hasil video itu dihapus 1 ms setelah
     dirender (pill tetap "Perhatian" tapi kotaknya kosong). */
  if(created.length) selectItem(created[0].id);
  /* Belum ada alat aktif (file masuk dari home): default Bersihkan.
     setActiveTool("clean") memanggil autoRunTool untuk file terpilih —
     ekor fungsi di bawah TIDAK boleh menjalankan cleanBatch kedua
     untuk file yang sama (cek autoRunning), karena cleanItem tidak
     punya guard re-entry. */
  if(!activeTool) setActiveTool("clean");
  /* Langsung bawa user ke kepala editor: foto + status + tombol Simpan
     di top bar — BUKAN kartu di bawah. Dulu scroll-nya ke kartu pertama,
     jadi user menatap kartu sementara tombol utama bilang alat lain —
     persis yang terlihat di screenshot POCO F6. */
  var eh=$("#editorHead");
  if(eh){
    var rm=!!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try{ eh.scrollIntoView({behavior: rm?"auto":"smooth", block:"start"}); }catch(e){ eh.scrollIntoView(); }
  }
  batchRunning=false; updateStats();
  /* Alat aktif + file lengkap = jalan sendiri (prinsip A). Bersihkan
     jalan batch dengan dock progres; alat lain jalan untuk file terpilih. */
  if(activeTool==="clean"){ if(!autoRunning){ batchRunning=true; await cleanBatch(created); } return; }
  if(created.length) await autoRunTool(activeTool, created[0]);
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
  var sel=selectedItem();
  if(!sel || sel.id!==item.id) return;
  var wrap=document.getElementById("shellBadges");
  var box=document.getElementById("shellDetect");
  if(!wrap && !box) return;
  var html="";
  /* Maksimal DUA chip biar tidak rame: (1) sumber utama MERAH + logo
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
  if(wrap) wrap.innerHTML=html;
  /* Kotak merah A1 cuma buat scan AWAL (sebelum dibersihkan): head
     "Label AI ketemu" + body yang nyebut sumbernya. Begitu file sudah
     dibersihkan, kotak ini kosong — kotak HASIL yang bicara (A4/A5). */
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
  item.status="cleaning";
  syncShell();
  setProc(item,"Membersihkan…",false);
  var sr0=document.getElementById("shellResult"); if(sr0) sr0.classList.add("hidden");
  try{
    if(/\.webm$/i.test(item.file.name)){
      /* A7: WebM cuma bisa dicek, bukan dibersihkan. */
      failClean(item,"attention","WebM hanya bisa dicek. Pakai MP4 kalau mau dibersihkan.",false);
      return;
    }
    var boxes=item.scan.mp4Boxes || await listTopBoxes(item.file);
    var targets=boxes.filter(function(b){ return b.type==="meta"||b.type==="udta"||(b.type==="uuid"&&b.xmp); });
    if(!targets.length){
      if(item.scan.hasAI){
        /* A8: label ketemu tapi box-nya nggak bisa dibuang dari file ini. */
        failClean(item,"attention","Label ketemu, tapi tidak bisa dibuang dari file ini.",false);
        return;
      }
      /* Video bersih & nggak ada box metadata yang perlu dibuang: sukses
         tanpa ubah satu byte — cleanedBlob = file asli, re-scan = scan awal.
         (Dulu ini malah dilempar jadi error "Video ini sudah bersih."
         dengan pill Perhatian — file bersih tampil kayak gagal.) */
      item.cleanedBlob=item.file; item.cleanedType=item.file.type; item.cleanedName=outName(item); item.status="cleaned"; item.pixelDataPreserved=true;
      item.cleanedScan=item.scan; item.tools.clean="selesai";
      if(item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
      item.cleanedUrl=URL.createObjectURL(item.file);
      finishClean(item,{head:"Beres — sudah bersih", body:'Dicek ulang: <b>0 label AI tersisa</b>. Ukuran tetap '+formatBytes(item.file.size)+'. Berkas berhasil diproses; platform lain tetap bisa mendeteksi asal konten dengan metode berbeda.'});
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
        : {head:"Beres — sudah bersih", body:'Dicek ulang: <b>0 label AI tersisa</b>. Ukuran tetap '+formatBytes(blob.size)+'. Berkas berhasil diproses; platform lain tetap bisa mendeteksi asal konten dengan metode berbeda.'};
    finishClean(item,box);
  }catch(e){
    var reason=String((e&&e.message)||"Gagal").replace(/\.+$/,"");
    failClean(item,"failed",reason+". File aslimu aman — coba lagi atau pakai Deep Clean.",true);
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
    if(brand==="avif" || brand==="avis") return "image/avif";
    if(["heic","heix","hevc","hevx","mif1","msf1"].includes(brand)) return "image/heic";
  }
  if(b.length>=4 && ((b[0]===0x49&&b[1]===0x49&&b[2]===0x2a)||(b[0]===0x4d&&b[1]===0x4d&&b[3]===0x2a))) return "image/tiff";
  return "";
}

async function cleanItem(item){
  if(item.kind==="video"){ await cleanVideoItem(item); return; }
  item.status="cleaning";
  var appliedSignature=cleanOptionSignature();
  syncShell();
  setProc(item,"Membersihkan…",false);
  var sr0=document.getElementById("shellResult"); if(sr0) sr0.classList.add("hidden");
  try{
    var qNum=parseInt($("#qualityRange").value,10);
    /* Format asli dari magic bytes (bukan ekstensi nama file) — dipakai
       buat milih strip lossless & tipe output di bawah. */
    var ab0=null, realType="";
    try{ ab0=await item.file.arrayBuffer(); realType=sniffImageKind(ab0); }catch(e){}
    var fileType=realType||item.file.type||"image/png";
    var outType= outFormat==="same" ? fileType : outFormat;
    if(["image/jpeg","image/png","image/webp"].indexOf(outType)===-1) outType="image/png";
    var blob=null;
    var pixelDataPreserved=false;
    // Profile privasi memindai semua jejak yang didukung dan menyapu ulang;
    // hanya jalur format-asli yang dapat mempertahankan pixel data.
    if(cleanProfile==="privacy" && outFormat==="same"){
      blob=await scrubTracesBlob(item.file);
      outType=blob.type || outType;
      pixelDataPreserved=false; // scrub may reencode via canvas; never claim unchanged pixels without proof
    }
    /* Jalur lossless: Format Asli + kualitas default (92) + bukan Deep Clean +
       PNG/JPEG → buang metadata tanpa sentuh piksel, ukuran nyaris tetap.
       Hasil strip langsung di-scan ulang: kalau label MASIH kebaca
       (container apa pun yang lolos allowlist), blob lossless dibuang dan
       file jatuh ke jalur canvas — file nggak boleh pulang dengan label
       yang masih terdeteksi padahal canvas bisa menghapusnya. */
    if(!blob && outFormat==="same" && !deepClean && qNum===92 && outType===fileType && (fileType==="image/png"||fileType==="image/jpeg") && ab0){
      try{
        var lblob=new Blob([fileType==="image/png"?stripPngMeta(ab0):stripJpegMeta(ab0)],{type:fileType});
        var lscan=scanBuffer(await lblob.arrayBuffer(),"image");
        if(!lscan.hasAI){ blob=lblob; pixelDataPreserved=true; }
      }
      catch(_e){ blob=null; /* file aneh → jatuh ke jalur canvas di bawah */ }
    }
    if(!blob){
      var bmp: ImageBitmap;
       try { bmp=await createImageBitmap(item.file); }
       catch(e) { throw new Error("Browser ini belum bisa membuka format gambar tersebut. Untuk HEIC/HEIF/TIFF, konversi ke JPG atau PNG melalui galeri perangkat lebih dulu."); }
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
    item.cleanedBlob=blob; item.cleanedScan=vscan; item.cleanedType=blob.type || outType; item.cleanedName=outName(item); item.status="cleaned"; item.pixelDataPreserved=pixelDataPreserved; item.cleanSignature=appliedSignature;
    item.tools.clean= vscan.hasAI ? "perlu perhatian" : "selesai";
    if(item.cleanedUrl) URL.revokeObjectURL(item.cleanedUrl);
    item.cleanedUrl=URL.createObjectURL(blob);
    /* Kotak hasil A4/A5 — bukti, bukan klaim: re-scan 0 label + ukuran
       sebelum → sesudah; kalau sisa label, ada tombol Bersihkan dengan Deep. */
    var box= vscan.hasAI
      ? {head:"Label masih ketemu", body:'Sisa: <b style="color:var(--red-text)">'+escapeHtml(vscan.found.join(", "))+'</b>. Coba mode Deep — biasanya sisa label hilang di situ.', action:{label:"Bersihkan dengan Deep", act:"deepclean"}}
      : {head:"Beres — sudah bersih", body:'Dicek ulang: <b>0 label AI tersisa</b>. Ukuran '+formatBytes(item.file.size)+' → '+formatBytes(blob.size)+'. Berkas berhasil diproses; platform lain tetap bisa mendeteksi asal konten dengan metode berbeda.'};
    finishClean(item,box);
  }catch(e){
    /* A6: alasan + "file aslimu aman" + tombol [Coba lagi]. */
    var reason=String((e&&e.message)||"Gagal").replace(/\.+$/,"");
    failClean(item,"failed",reason+". File aslimu aman — coba lagi atau pakai Deep Clean.",true);
  } finally { updateStats(); }
}

/* ── Strip jejak privasi (dipakai panel Edit Metadata) ──
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
  if(out && (await scanTraces(out)).length===0) return out;
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

/* ── Tumpukan versi (Langkah 3, §2.6) ──
   versions = [Asli, Bersih?, Metadata?, Watermark?] — satu per alat yang
   menghasilkan file baru, urutan tetap. Alat yang dijalankan ulang
   MENGGANTI versinya sendiri (hasil baru menimpa hasil lama alat itu) —
   jadi maks 3 hasil + asli, hemat RAM HP. cleanedBlob selalu = blob
   versi saat ini (currentLabel). Kembali ke versi lama TIDAK menghapus
   versi yang lebih baru (C6). */
var VERSION_ORDER=["Asli","Bersih","Metadata","Watermark"];
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
  /* Baris versi hidup di shell (#shellVersions) — syncShell yang
     me-render-nya; fungsi ini tinggal memicu sinkronisasi itu. */
  syncShell();
}

function setCurrentVersion(item,label){
  var v=(item.versions||[]).find(function(x){return x.label===label});
  if(!v || item.currentLabel===label) return;
  item.currentLabel=label;
  shellComparing=false;
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
  var res=document.getElementById("shellResult");
  if(res){
    if(v.box){ res.classList.remove("hidden"); renderResultBox(item,res,v.box); }
    else res.classList.add("hidden");
  }
  renderVersions(item);
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
/* Kotak hasil (box) dibangun pemanggil dari state item; finishClean cuma
   merender + menempel pill dari getFileState + mendorong hasil ke
   tumpukan versi. box = {head, body, action?} dengan action = {label,
   act} → tombol di dalam kotak (mis. Bersihkan dengan Deep, A5).
   versionLabel = label versi hasil ini ("Bersih" default; editor
   mengisi "Objek" / "Watermark"). Referensi mati wf-clean / wf-save
   sudah dihapus — elemen itu tidak pernah dibuat (hanya ada CSS-nya). */
function finishClean(item,box,versionLabel?: string){
  hideProc(item);
  var st=getFileState(item);
  /* Badge & kotak deteksi ikut hasil BERSIH, bukan scan awal: kalau re-scan
     0 label, kotak merah "Label AI ketemu" + chip merah harus hilang. */
  if(item.cleanedScan) refreshBadges(item, item.cleanedScan);
  var res=document.getElementById("shellResult");
  if(res){ res.classList.remove("hidden"); renderResultBox(item,res,box); }
  /* Hasil baru masuk tumpukan versi. */
  if(item.cleanedBlob) pushVersion(item, versionLabel||"Bersih", item.cleanedBlob, item.cleanedType, item.cleanedScan, box);
  /* History lokal (foto saja): ditulis otomatis begitu hasil bersih
     tersedia — satu write-point untuk ketiga alat + batch. Best-effort:
     gagal tulis tidak boleh mengganggu tool. */
  if(item.cleanedBlob && item.kind==="image" && st.key==="cleaned"){
    var vlabel=versionLabel||"Bersih";
    var hlabel= vlabel==="Bersih" ? "0 label AI tersisa" : box.head;
    var htool= vlabel==="Watermark" ? "watermark" : vlabel==="Metadata" ? "meta" : "clean";
    void recordHistory(item, htool as "clean"|"meta"|"watermark", hlabel);
  }
  syncShell();
}


/* ── Simpan: SATU tombol, jalurnya dipilih otomatis ──
   Di dalam frame aplikasi / HP: menu Bagikan (Simpan ke File).
   Di browser biasa: unduhan langsung. Nama-sama + Chrome desktop: dialog simpan. */
/* ── Hapus Watermark v1 (keputusan Bobby 19 Nov 2026 17:24 WIB):
   GEMINI SPARKLE SAJA via reverse-alpha — otomatis, tanpa editor kuas,
   tanpa coret manual. openWatermarkFor = auto-run: NCC memastikan
   sparkle → unblend → versi "Watermark"; bukan Gemini → status jujur
   di kotak hasil; tidak ketemu → status jujur. */
async function openWatermarkFor(item){
  if(item.kind==="video"){ toast("Hapus Watermark cuma buat foto dulu."); return; }
  var src= item.cleanedBlob || item.file;
  setProc(item, "Lagi memeriksa watermark…", false);
  var wm;
  try{ wm=await import("./watermark"); }
  catch(e){ hideProc(item); toast("Pemeriksa watermark gagal dimuat. Coba refresh."); return; }
  var out;
  try{ out=await wm.removeWatermark(src); }
  catch(e){
    hideProc(item);
    failClean(item, "error", "Gagal memeriksa watermark: "+String((e as Error).message||"Gagal").replace(/\.+$/, "")+". Coba lagi.", true);
    return;
  }
  hideProc(item);
  if(out.kind==="sparkle"){
    await replaceCleaned(item, out.blob, "Sparkle Gemini dihapus \u2713", "Hasil hapus watermark disimpan \u2713", "watermark");
    return;
  }
  /* Bukan sparkle / tidak ketemu: status jujur di kotak hasil (detect-box),
     bukan error merah — file-nya tidak rusak, alat v1 saja yang tidak bisa. */
  var head= out.kind==="unknown" ? "Tanda ketemu tapi bukan pola Gemini yang dikenal." : "Tidak ketemu tanda watermark di foto ini.";
  var body= out.kind==="unknown"
    ? "Ketemu "+out.boxes.length+" tanda di "+[...new Set(out.boxes.map(function(b){ return b.where; }))].join(" & ")+" — tapi bentuknya bukan sparkle Gemini. Hapus Watermark v1 cuma bisa menghapus sparkle Gemini."
    : "Tidak ada tanda yang terdeteksi di pojok atau tepi foto ini.";
  var res=document.getElementById("shellResult");
  if(res){
    res.classList.remove("hidden");
    res.innerHTML='<div class="detect-box" role="status"><p class="detect-head">'+ic("i-alert","ic-sm")+' '+escapeHtml(head)+'</p><p class="clean-body">'+escapeHtml(body)+'</p></div>';
  }
  updateToolStatus();
}

/* ── Edit Metadata (src/metaedit.ts) ──
   Panel di-render di #metaPanel (bukan modal): pindai jejak + daftar
   field, draft di memori, Terapkan = commit jadi versi "Metadata". */
async function openMetaFor(item){
  clearShellResult();
  if(item.kind==="video"){ toast("Edit Metadata cuma buat foto dulu."); return; }
  var panel=document.getElementById("metaPanel");
  if(!panel) return;
  var src= item.cleanedBlob || item.file;
  var type= item.cleanedBlob ? (item.cleanedType||item.file.type) : item.file.type;
  metaedit.wireMetaPanel(panel);
  await metaedit.openMetaFor(panel,
    { name:item.file.name, blob:src, type:type, lastModified:item.file.lastModified },
    { onReplace:async function(blob, doneText){ await replaceCleaned(item, blob, doneText, "Hasil edit metadata disimpan ✓", "meta"); },
      onScrub: scrubTracesBlob, onToast: toast });
}
async function replaceCleaned(item,blob,doneText="Watermark dihapus",toastText="Hasil hapus watermark disimpan ✓",tool="watermark"){
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
  /* B15: head = apa yang dihapus; body = bukti re-scan + ukuran. Kalau
     re-scan masih nemu label, kotaknya merah + tombol Bersihkan dengan Deep —
     edit tidak boleh diam-diam mengklaim bersih. */
  var box= (item.cleanedScan && item.cleanedScan.hasAI)
    ? {head:doneText, body:doneText+", lalu dicek ulang: masih ada label tersisa.", action:{label:"Bersihkan dengan Deep", act:"deepclean"}}
    : {head:doneText, body:"lalu dicek ulang: 0 label AI tersisa. Ukuran "+formatBytes(blob.size)+"."};
  /* Hasil editor masuk tumpukan versi dengan label alatnya ("Watermark" /
     "Metadata") — bukan menimpa buta. */
  var VERSION_LABEL={watermark:"Watermark", meta:"Metadata"};
  finishClean(item,box, VERSION_LABEL[tool]||"Watermark");
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
  var a=document.createElement("a");
  a.href=item.cleanedUrl; a.download=item.cleanedName; a.rel="noopener"; a.style.display="none";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ a.remove(); },2000);
  toast("Unduhan dimulai: " + item.cleanedName);
}

function openPreview(item){
  currentHistoryId=null;
  var dl0=$("#previewDownload"); if(dl0) dl0.classList.add("hidden");
  var del0=$("#previewDelete"); if(del0) del0.classList.add("hidden");
  var meta0=$("#previewMeta"); if(meta0) meta0.textContent="";
  var src=item.cleanedUrl||item.url;
  $("#previewName").textContent=(item.cleanedBlob? item.cleanedName : item.file.name);
  var body=$("#previewBody");
  body.innerHTML= item.kind==="video"
    ? '<video src="'+src+'" controls playsinline class="max-w-full max-h-[70vh] rounded-lg"></video>'
    : '<img src="'+src+'" alt="Hasil '+escapeHtml(item.file.name)+'" class="max-w-full max-h-[70vh] object-contain rounded-lg">';
  $("#previewModal").classList.remove("hidden");
}


/* ── Sirna Studio: one inspector for original and selected output. Scanning
   stays in a module Worker where supported; untrusted files never leave the
   local device. All async results are guarded against stale selection. ── */
let inspectorGeneration=0, inspectorItemId=-1;
let inspectorSource: Blob | null=null;
const inspectorCache = new WeakMap<Blob, Promise<Inspection>>();
let inspectWorker: Worker | null = null;
let inspectSequence=0;
const pendingInspections=new Map<number,{resolve:(v:Inspection)=>void,reject:(e:unknown)=>void}>();
try {
  if(typeof Worker!=="undefined"){
    inspectWorker=new Worker(new URL("./inspection.worker.ts",import.meta.url),{type:"module"});
    inspectWorker.addEventListener("message",function(e:MessageEvent){
      const m=e.data; const promise=pendingInspections.get(m.id);
      if(!promise)return;
      pendingInspections.delete(m.id);
      if(m.error)promise.reject(new Error(m.error));
      else promise.resolve(m.inspection);
    });
    inspectWorker.addEventListener("error",function(){
      pendingInspections.forEach(function(p){p.reject(new Error("worker unavailable"));});
      pendingInspections.clear();inspectWorker?.terminate();inspectWorker=null;
    });
  }
}catch { inspectWorker=null; }
function inspectionFor(blob:Blob,name:string):Promise<Inspection>{
  const saved=inspectorCache.get(blob);
  if(saved)return saved;
  let work:Promise<Inspection>;
  if(inspectWorker){
    const id=++inspectSequence;
    work=new Promise<Inspection>((resolve,reject)=>{
      pendingInspections.set(id,{resolve,reject});
      try{inspectWorker!.postMessage({id,blob,name});}
      catch(e){pendingInspections.delete(id);reject(e);}
    }).catch(()=>inspectFile(blob,name));
  }else work=inspectFile(blob,name);
  inspectorCache.set(blob,work);
  return work;
}
function updateInspector(){
  const content=document.getElementById("inspectorContent");
  const credentials=document.getElementById("credentialsContent");
  const detail=document.getElementById("traceList");
  const panel=document.getElementById("integrityPanel");
  const list=document.getElementById("integrityList");
  if(!content||!credentials||!detail||!panel||!list)return;
  const it=selectedItem();
  if(!activeTool||!it) { inspectorItemId=-1;inspectorSource=null;return; }
  const blob=it.cleanedBlob || it.file;
  if(inspectorItemId===it.id && inspectorSource===blob)return;
  inspectorItemId=it.id;inspectorSource=blob;
  const generation=++inspectorGeneration;
  content.textContent="Memeriksa struktur dan jejak metadata…";
  panel.hidden=true;
  Promise.all([inspectionFor(it.file,it.file.name),
    blob===it.file?inspectionFor(it.file,it.file.name):inspectionFor(blob,it.cleanedName||it.file.name)])
  .then(([before,current])=>{
    if(generation!==inspectorGeneration||selectedItem()?.id!==it.id)return;
    const traceCount=current.traces.filter(t=>t.kind!=="filename").length;
    const dims=current.dimensions? current.dimensions.width+" × "+current.dimensions.height:"Belum terverifikasi";
    const risk=current.risks.length?current.risks.join(" · "):"Tidak terdeteksi risiko umum";
    content.innerHTML=
      '<div class="studio-metrics"><div><small>Format</small><strong>'+escapeHtml(current.mime)+'</strong></div>'+
      '<div><small>Resolusi</small><strong>'+escapeHtml(dims)+'</strong></div>'+
      '<div><small>Ukuran</small><strong>'+formatBytes(current.size)+'</strong></div>'+
      '<div><small>Jejak terdeteksi</small><strong>'+traceCount+' jenis</strong></div></div>'+
      '<p><b>Perlu diperhatikan:</b> '+escapeHtml(risk)+'</p>'+
      (current.limited?'<p>Pemindaian dibatasi pada awal file besar; hasil negatif bukan bukti tidak ada jejak.</p>':'');
    credentials.textContent=current.credentialEvidence+
      (current.credentials==="not-seen"?" (Tidak membuktikan asal-usul file.)":
      ". Kehadiran manifest bukan bukti siapa yang membuat file; perlu validator C2PA kriptografis.");
    detail.innerHTML= current.traces.length ?
      current.traces.map(t=>'<div><strong>'+escapeHtml(t.label)+'</strong><span>'+escapeHtml(t.detail)+'</span></div>').join('') :
      '<p>Tidak ada metadata yang dikenali pemindai lokal.</p>';
    if(blob!==it.file){
      const report=integrityOf(before,current,!!it.pixelDataPreserved);
      const res= report.resolution==="same"?"Resolusi tetap":
        report.resolution==="changed"?"Resolusi berubah":
        report.resolution==="not-applicable"?"Video: resolusi belum diperiksa":"Resolusi belum dapat diperiksa";
      const preserved=report.bytes==="pixel-data-preserved"
        ?"Data piksel dipertahankan oleh jalur lossless":"Piksel bisa berubah akibat proses ulang";
      list.innerHTML='<li>'+escapeHtml(res)+'</li><li>'+escapeHtml(preserved)+'</li>'+
        '<li>'+formatBytes(report.originalSize)+' → '+formatBytes(report.resultSize)+'</li>'+
        (report.mimeChange?'<li>Format output berubah</li>':'')+
        '<li>'+report.remaining+' jejak tertanam masih dikenali pemindai</li>'+
        '<li>Signature C2PA dan provenance eksternal tidak divalidasi di sini</li>';
      panel.hidden=false;
    }
  }).catch(()=>{
    if(generation!==inspectorGeneration)return;
    content.textContent="File ini belum bisa diperiksa sepenuhnya. Coba file lain atau lihat detail metadata.";
    credentials.textContent="Validasi Content Credentials tidak tersedia.";
    detail.textContent="Pemeriksaan belum berhasil.";
  });
}
function updateBatchControls(){
  const container=document.getElementById("batchControls");
  const status=document.getElementById("batchSummary");
  const cancel=document.getElementById("batchCancel") as HTMLButtonElement|null;
  const retry=document.getElementById("batchRetry") as HTMLButtonElement|null;
  if(!container||!status||!cancel||!retry)return;
  const show=activeTool==="clean"&&items.length>1;
  container.classList.toggle("hidden",!show);
  if(!show)return;
  const success=items.filter(x=>getFileState(x).key==="cleaned").length;
  const failed=items.filter(x=>["failed","attention","residual"].includes(getFileState(x).key)).length;
  status.textContent=success+" dari "+items.length+" file selesai"+(failed?" · "+failed+" perlu perhatian":"")+
    (batchActive?" · sedang diproses":"");
  retry.disabled=batchActive||failed===0;
  cancel.disabled=!batchActive;
}
function useCleanProfile(profile:"label"|"privacy"|"deep"){
  if(batchActive){toast("Antrean masih berjalan. Selesaikan atau batalkan dulu.");return;}
  cleanProfile=profile;
  setDeepClean(profile==="deep");
  $$("[data-clean-profile]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.cleanProfile===profile?"true":"false"));
  try{localStorage.setItem("sirna-clean-profile",profile);}catch{}
  if(items.length&&activeTool==="clean") void cleanBatch([...items]);
  updateStats();
}
try{
  const p=localStorage.getItem("sirna-clean-profile");
  if(p==="privacy"||p==="deep"||p==="label"){cleanProfile=p;setDeepClean(p==="deep");}
}catch{}
$$("[data-clean-profile]").forEach(b=>{
  b.setAttribute("aria-pressed",b.dataset.cleanProfile===cleanProfile?"true":"false");
  b.addEventListener("click",()=>useCleanProfile(b.dataset.cleanProfile as "label"|"privacy"|"deep"));
});
$("#batchCancel").addEventListener("click",()=>{ batchStopRequested=true;toast("Berhenti setelah file saat ini selesai."); });
$("#batchRetry").addEventListener("click",()=>{
  const toRetry=items.filter(i=>["failed","attention","residual"].includes(getFileState(i).key));
  if(toRetry.length)void cleanBatch(toRetry);
});
// Templates save deletion rules only — never persist arbitrary EXIF or user data.
const TEMPLATE_KEY="sirna-meta-delete-rule-v1";
$("#metaSaveTemplate").addEventListener("click",()=>{
  const rules=metaedit.exportDeletionTemplate();
  if(!rules.length){toast("Tandai dulu field yang ingin dihapus, baru simpan aturannya.");return;}
  try{localStorage.setItem(TEMPLATE_KEY,JSON.stringify(rules));toast("Aturan hapus metadata tersimpan di perangkat.");}
  catch{toast("Penyimpanan browser tidak tersedia.");}
});
$("#metaLoadTemplate").addEventListener("click",()=>{
  try{
    const data=JSON.parse(localStorage.getItem(TEMPLATE_KEY)||"[]");
    const n=metaedit.loadDeletionTemplate(data);
    toast(n?n+" field ditandai. Periksa lalu ketuk Terapkan.":"Belum ada aturan yang cocok untuk file ini.");
  }catch{toast("Belum ada aturan tersimpan.");}
});
$("#metaDeleteTemplate").addEventListener("click",()=>{
  try{localStorage.removeItem(TEMPLATE_KEY);toast("Aturan tersimpan dihapus.");}
  catch{toast("Tidak bisa mengakses penyimpanan browser.");}
});

/* ── Stats / batch bar ──
   Semua angka baca getFileState (satu sumber kebenaran): "sudah bersih"
   cuma dihitung dari re-scan bersih, "masih ada label" dari residual. */
function updateStats(){
  /* Pengaturan adalah pengaturan BERSIHKAN: tampil cuma di workspace
     Bersihkan. Panel Edit Metadata tampil cuma di workspace meta.
     Dropzone juga tetap tampil di workspace. Marquee brand tetap
     disembunyiin pas antrean berisi, biar halaman fokus ke file. */
  var sc=document.getElementById("settingsCard"); if(sc) sc.classList.toggle("hidden", activeTool!=="clean");
  var mp=document.getElementById("metaPanel"); if(mp) mp.classList.toggle("hidden", activeTool!=="meta");
  var mt=document.getElementById("metaTemplateBar"); if(mt) mt.classList.toggle("hidden",activeTool!=="meta");
  var bw=document.getElementById("brandWrap"); if(bw) bw.classList.toggle("hidden", items.length>0);
  /* "Terakhir" (history) cuma di home — editor fullscreen menggantikan home. */
  var hs=document.getElementById("historySection"); if(hs) hs.classList.toggle("hidden", !!activeTool);
  document.body.classList.toggle("has-files", items.length>0);
  /* Dropzone + contoh tinggal di #heroSection: visibilitasnya diatur
     hero.hidden (editor on/off), bukan items.length — kalau diatur dari
     items.length, Back-dengan-antrean akan menyembunyikan dropzone di home. */
  if(items.length===0) ensureSampleThumb();
  updateToolStatus();
  syncToolAvailability();
  syncDockBottom();
  /* Jalan masuk kembali tanpa upload baru: cuma di home (belum ada alat
     aktif) & ada antrean — tombol "Buka editor" membuka lagi editor
     dengan antrean, hasil & versi utuh (alat terakhir via lastTool). */
  var qh=$("#queueHint");
  if(qh){
    var showQ= items.length>0 && !activeTool;
    qh.classList.toggle("hidden", !showQ);
    if(showQ) $("#queueHintText").textContent= items.length+" file di antrean — ";
  }
  syncShell();
  syncPrimary();
  updateBatchControls();
  updateInspector();
}


/* ── Mulai ulang: buang semua file, balik ke canvas upload ── */
function clearAllItems(){
  clearShellResult();
  items.forEach(function(i){ URL.revokeObjectURL(i.url); if(i.cleanedUrl) URL.revokeObjectURL(i.cleanedUrl); });
  items=[];
  metaedit.closeMetaPanel();
  var dock=$("#procDock"); if(dock) dock.classList.add("hidden"); procCurId=null;
  updateStats();
}

/* ── Input events ── */
var dz=$("#dropZone"), fi=$("#fileInput"), foi=$("#folderInput"), vi=$("#videoInput");
/* Jaring pengaman ekstra: klik dari input file nggak boleh naik ke mana-mana */
fi.addEventListener("click",function(e){ e.stopPropagation(); });
foi.addEventListener("click",function(e){ e.stopPropagation(); });
vi.addEventListener("click",function(e){ e.stopPropagation(); });
dz.addEventListener("click",function(e){ if((e.target as Element).closest("#folderBtn")||(e.target as Element).closest("#videoPickBtn")||(e.target as Element).closest("#pickLabel")) return; if(e.target===fi||e.target===foi||e.target===vi) return; fi.click(); });
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
$("#restartBtn").addEventListener("click",function(){
  openSheet({title:"Mulai ulang?", body:"Semua file & hasil di antrean dibuang, lalu kembali ke home.", confirm:"Mulai ulang", danger:true, onConfirm:function(){
    clearAllItems();
    setActiveTool(null); /* balik ke home */
    window.scrollTo({top:0,behavior:"smooth"});
  }});
});
/* ── "Buka editor" di home (jalan masuk kembali tanpa upload baru) +
   baris ganti alat di rail editor ──
   #resumeBtn: buka lagi editor dengan antrean, hasil & versi utuh
   (alat terakhir via lastTool, default Bersihkan).
   Chip rail: ganti alat tanpa upload ulang (file & hasil ikut). */
$("#resumeBtn").addEventListener("click",function(){
  setActiveTool(lastTool || "clean");
  var panel=$("#panel-cleaner");
  if(panel) panel.scrollIntoView({behavior:"smooth",block:"start"});
});
$$("[data-tool-switch]").forEach(function(b){
  b.addEventListener("click",function(){
    if(!b.dataset.toolSwitch){ setActiveTool(null); window.scrollTo({top:0,behavior:"smooth"}); }
    else setActiveTool(b.dataset.toolSwitch);
  });
});
/* ── Bottom sheet generik (P1): konfirmasi & alur sekunder, maks 1 level.
   Dipakai buat aksi destruktif (Mulai ulang / Hapus semua / Hapus file)
   supaya tidak ada hapus yang sekali ketuk tanpa konfirmasi. ── */
var sheetConfirmFn: (() => void) | null = null;
var sheetExtraFn: (() => void) | null = null;
function openSheet(opts: {title: string; body: string; confirm: string; danger?: boolean; extra?: {label: string; onClick: () => void}; onConfirm: () => void}){
  var t=$("#sheetTitle"); if(t) t.textContent=opts.title;
  var b=$("#sheetBody"); if(b) b.textContent=opts.body;
  var c=$("#sheetConfirm"); if(c){ c.textContent=opts.confirm; c.classList.toggle("danger", !!opts.danger); }
  var ex=$("#sheetExtra");
  if(ex){
    if(opts.extra){ ex.textContent=opts.extra.label; ex.classList.remove("hidden"); }
    else ex.classList.add("hidden");
  }
  sheetExtraFn= opts.extra ? opts.extra.onClick : null;
  sheetConfirmFn=opts.onConfirm;
  var s=$("#sheetScrim"); if(s) s.classList.remove("hidden");
  var sh=$("#sheet"); if(sh) sh.classList.remove("hidden");
}
function closeSheet(){
  var s=$("#sheetScrim"); if(s) s.classList.add("hidden");
  var sh=$("#sheet"); if(sh) sh.classList.add("hidden");
  sheetConfirmFn=null;
  sheetExtraFn=null;
}
$("#sheetCancel").addEventListener("click",function(){ closeSheet(); });
$("#sheetScrim").addEventListener("click",function(){ closeSheet(); });
$("#sheetConfirm").addEventListener("click",function(){ var f=sheetConfirmFn; closeSheet(); if(f) f(); });
$("#sheetExtra").addEventListener("click",function(){ var f=sheetExtraFn; closeSheet(); if(f) f(); });
document.addEventListener("keydown",function(e){ if(e.key==="Escape" && !$("#sheet").classList.contains("hidden")) closeSheet(); });
function removeItem(it){
  URL.revokeObjectURL(it.url); if(it.cleanedUrl) URL.revokeObjectURL(it.cleanedUrl);
  items=items.filter(function(i){return i.id!==it.id});
  if(selectedId===it.id) selectedId=null;
  updateStats();
}

/* ── Tombol Simpan di top bar editor + tombol kembali ── */
$("#primaryBtn").addEventListener("click",function(){ runPrimary(); });
$("#editorBackBtn").addEventListener("click",function(){
  if(activeTool==="meta" && metaedit.isMetaDirty()){
    openSheet({title:"Perubahan metadata belum diterapkan.", body:"Terapkan dulu, atau buang perubahan?", confirm:"Terapkan", extra:{label:"Buang perubahan", onClick:function(){ metaedit.discardMetaDraft(); setActiveTool(null); window.scrollTo({top:0,behavior:"smooth"}); }}, onConfirm:function(){ void (async function(){ if(await metaedit.applyMetaDraft()){ setActiveTool(null); window.scrollTo({top:0,behavior:"smooth"}); } })(); }});
    return;
  }
  setActiveTool(null); window.scrollTo({top:0,behavior:"smooth"});
});
$("#shellFilm").addEventListener("click",function(e){
  var b=(e.target as Element).closest("button[data-shell-id]") as HTMLButtonElement; if(!b) return;
  selectItem(parseInt(b.dataset.shellId,10));
});
$("#shellVersions").addEventListener("click",function(e){
  var b=(e.target as Element).closest("button[data-v]") as HTMLButtonElement; if(!b) return;
  var it=selectedItem(); if(it) setCurrentVersion(it, b.dataset.v);
});
/* "Lihat asli" = toggle ketuk-sekali (prinsip I): ketuk → foto asli,
   ketuk lagi → hasil. Bukan tahan (gestur lama tidak jelas di desktop). */
(function(){
  var cmp=$("#shellCompare"); if(!cmp) return;
  cmp.addEventListener("click",function(){
    var it=selectedItem(); if(!it) return;
    shellComparing=!shellComparing;
    cmp.setAttribute("aria-pressed", shellComparing?"true":"false");
    cmp.textContent=shellComparing?"Lihat hasil":"Lihat asli";
    var img=$("#shellImg") as HTMLImageElement; if(!img) return;
    var want= shellComparing ? it.url : (it.cleanedUrl||it.url);
    img.src=want; img.setAttribute("data-cur",want);
  });
})();

/* ── Coba foto contoh (di bawah dropzone home): file digenerate
   runtime, lalu alat default Bersihkan LANGSUNG jalan (prinsip A:
   file + alat lengkap = jalan) — foto contoh = upload biasa dari home.
   File contoh di-cache sekali per sesi: thumbnail di bawah dropzone
   memakai file yang sama, jadi generate cuma sekali. ── */
var sampleFileCache: File | null = null;
async function getSampleFile(): Promise<File> {
  if(sampleFileCache) return sampleFileCache;
  var sm=await import("./sample");
  sampleFileCache=await sm.makeSampleFile();
  return sampleFileCache;
}
/* Thumbnail contoh diisi malas saat barisnya pertama kali kelihatan
   (home, belum ada file). Gagal generate = tombol
   tetap jalan tanpa gambar (loadSamplePhoto generate ulang). */
var sampleThumbReady=false;
async function ensureSampleThumb(){
  var row=$("#sampleRow"); if(!row || !row.offsetParent) return;
  if(sampleThumbReady) return; sampleThumbReady=true;
  try{
    var file=await getSampleFile();
    var img=$("#sampleThumbImg") as HTMLImageElement; if(img) img.src=URL.createObjectURL(file);
  }catch(e){ /* tanpa thumbnail pun tombol tetap jalan */ }
}
async function loadSamplePhoto(){
  var btn=$("#sampleBtn") as HTMLButtonElement; if(btn) btn.disabled=true;
  try{
    var file=await getSampleFile();
    await handleFiles([file]);
  }catch(e){ toast("Foto contoh gagal dibuat. Coba lagi."); }
  if(btn) btn.disabled=false;
}
$("#sampleBtn").addEventListener("click", loadSamplePhoto);
/* Tombol "+ File" di topbar — 3 cabang, satu tombol (file-first):
   (1) home & antrean kosong → scroll ke #dropZone;
   (2) home & antrean berisi → buka editor (sama seperti "Buka editor");
   (3) editor aktif → buka file picker (tambah file ke antrean).
   Dropzone click SELALU berarti upload — tidak pernah buka editor. */
$("#topAddBtn").addEventListener("click",function(e){
  e.preventDefault();
  if(!activeTool){
    if(items.length>0){ setActiveTool(lastTool || "clean"); return; }
    /* Antrean kosong: scroll ke dropzone di home. */
    var dz=$("#dropZone");
    if(dz){ dz.scrollIntoView({behavior:"smooth",block:"center"}); dz.focus({preventScroll:true}); }
    return;
  }
  fi.click();
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

/* Editor navigation: theme, history and add stay available on every screen. */
$("#editorAddBtn").addEventListener("click",function(){ fi.click(); });
$("#editorHistoryBtn").addEventListener("click",function(){
  setActiveTool(null);
  requestAnimationFrame(function(){ $("#historySection").scrollIntoView({behavior:"smooth",block:"start"}); });
});

/* ── Settings events ── */
$("#qualityRange").addEventListener("input",function(e){ $("#qVal").textContent=e.target.value; updateStats(); });
$$("[data-format]").forEach(function(b){ b.addEventListener("click",function(){ $$("[data-format]").forEach(function(x){ x.setAttribute("aria-pressed","false"); }); b.setAttribute("aria-pressed","true"); outFormat=b.dataset.format; updateStats(); }); });
$$("[data-mode]").forEach(function(b){ b.addEventListener("click",function(){ $$("[data-mode]").forEach(function(x){ x.setAttribute("aria-pressed","false"); }); b.setAttribute("aria-pressed","true"); deepClean=b.dataset.mode==="deep"; }); });
$$("[data-dl]").forEach(function(b){ b.addEventListener("click",function(){
  $$("[data-dl]").forEach(function(x){ x.setAttribute("aria-pressed","false"); }); b.setAttribute("aria-pressed","true"); dlMode=b.dataset.dl;
  refreshNames(); updateStats();
}); });

/* ── Aksi di bawah kanvas + kotak hasil shell ── */
$("#shellResult").addEventListener("click",async function(e){
  var btn=(e.target as Element).closest("button[data-act]") as HTMLButtonElement; if(!btn) return;
  var it=items.find(function(i){return i.id===parseInt(btn.dataset.id,10)}); if(!it) return;
  if(btn.dataset.act==="reclean"){ btn.disabled=true; await cleanItem(it); btn.disabled=false; toast("Dibersihin ulang ✓"); }
  else if(btn.dataset.act==="deepclean"){ setDeepClean(true); btn.disabled=true; await cleanItem(it); btn.disabled=false; }
});
/* "Buang file ini" di bawah kanvas (destructive, tanpa konfirmasi —
   file asli tidak hilang dari perangkat, hanya keluar dari antrean). */
$("#removeFileBtn").addEventListener("click",function(){
  var it=selectedItem(); if(!it) return;
  openSheet({title:"Buang file ini?", body:it.file.name+" dibuang dari antrean beserta hasilnya.", confirm:"Buang file", danger:true, onConfirm:function(){ removeItem(it); }});
});

/* ── Batch events ── */
/* Dock progres: "Lihat" lompat ke kartu yang lagi diproses saat ini */
$("#procDockBtn").addEventListener("click",function(){
  var el=document.getElementById("editorHead");
  if(el) el.scrollIntoView({behavior:"smooth",block:"center"});
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
$("#previewClose").addEventListener("click",function(){ $("#previewModal").classList.add("hidden"); $("#previewBody").innerHTML=""; });
$("#previewModal").addEventListener("click",function(e){ if(e.target===this){ this.classList.add("hidden"); $("#previewBody").innerHTML=""; } });
document.addEventListener("keydown",function(e){ if(e.key==="Escape" && !$("#previewModal").classList.contains("hidden")){ $("#previewModal").classList.add("hidden"); $("#previewBody").innerHTML=""; } });
/* ═══════════ Router file: semua jalur masuk (paste, drop di mana aja)
   lewat sini — handleFiles merutekan ke alat aktif. ═══════════ */
function routeFiles(fileList){ handleFiles(fileList); }
/* ── Parser metadata mentah: JPEG EXIF + PNG chunks ── */
/* Metadata = info yang bisa dibaca manusia (prinsip J): teks yang
   tersimpan di file + satu baris ringkasan struktur — BUKAN dump chunk
   mentah (IHDR/IDAT ×14) yang tidak berarti apa-apa buat pengguna. */
/* ═══════════ Olah lanjut DI KARTU YANG SAMA — metadata · video.
   Semua jalan dari file yang udah ada di workspace: nggak upload ulang,
   nggak pindah tool. Konversi format DIHAPUS: Format sudah ada di
   Pengaturan (prinsip J) — dua tempat untuk satu pengaturan. ═══════════ */
/* ── Tema terang / gelap: tombol matahari/bulan di topbar ──
   Pilihan manual disimpan (cuma preferensi tampilan) & menang dari setelan sistem;
   kalo belum pernah milih, halaman ikut terang/gelap sistem secara live. */
(function(){
  var buttons=[document.getElementById("themeBtn"),document.getElementById("editorThemeBtn")].filter(Boolean);
  if(!buttons.length) return;
  function sync(){
    var dark=document.documentElement.classList.contains("dark");
    buttons.forEach(function(btn){
      btn.setAttribute("aria-label", dark ? "Ganti ke mode terang" : "Ganti ke mode gelap");
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
    });
  }
  sync();
  buttons.forEach(function(btn){btn.addEventListener("click",function(){
    var dark=document.documentElement.classList.toggle("dark");
    try{ localStorage.setItem("sirna-theme", dark ? "dark" : "light"); }catch(e){}
    sync();
    toast(dark ? "Mode gelap aktif" : "Mode terang aktif");
  });});
  try{
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change",function(e){
      var pref=null; try{ pref=localStorage.getItem("sirna-theme")||localStorage.getItem("bebas-theme")||localStorage.getItem("labeloff-theme"); }catch(_){}
      if(pref!=="dark" && pref!=="light"){ document.documentElement.classList.toggle("dark", e.matches); sync(); }
    });
  }catch(e){}
})();

/* ── History lokal ("Terakhir" di home) ──
   Render grid dari IndexedDB; dipanggil saat load + setiap tulis/hapus.
   Kartu = thumbnail + nama + tanggal/alat + chip status; ketuk = preview. */
var currentHistoryId: number | null = null;
var historyThumbUrls: string[] = [];
async function renderHistory(){
  var grid=$("#historyGrid"); if(!grid) return;
  var empty=$("#historyEmpty"); var clearBtn=$("#historyClearBtn");
  historyThumbUrls.forEach(function(u){ URL.revokeObjectURL(u); });
  historyThumbUrls=[];
  if(!historySupported()){
    if(empty){ empty.classList.remove("hidden"); empty.textContent="History tidak tersedia di browser ini."; }
    grid.innerHTML=""; if(clearBtn) clearBtn.classList.add("hidden");
    return;
  }
  var entries=[];
  try{ entries=await listHistory(); }catch(e){ entries=[]; }
  if(clearBtn) clearBtn.classList.toggle("hidden", entries.length===0);
  if(!entries.length){
    grid.innerHTML="";
    if(empty){ empty.classList.remove("hidden"); empty.textContent="Belum ada — hasil bersihmu akan muncul di sini."; }
    return;
  }
  if(empty) empty.classList.add("hidden");
  grid.innerHTML=entries.map(function(en){
    var url=URL.createObjectURL(en.thumb);
    historyThumbUrls.push(url);
    var toolName= en.tool==="clean" ? "Bersihkan Label AI" : en.tool==="meta" ? "Edit Metadata" : "Hapus Watermark AI";
    var date=new Date(en.createdAt).toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"});
    return '<button type="button" class="history-card" data-history-id="'+en.id+'" aria-label="Lihat hasil '+escapeHtml(en.name)+'">'
      +'<img src="'+url+'" alt="" loading="lazy">'
      +'<span class="history-name">'+escapeHtml(en.name)+'</span>'
      +'<span class="history-meta">'+date+' · '+toolName+'</span>'
      +'<span class="history-label">'+escapeHtml(en.label)+'</span></button>';
  }).join("");
}
async function recordHistory(item, tool: "clean"|"meta"|"watermark", label: string){
  try{
    await addHistory({name: item.cleanedName||outName(item), tool: tool, label: label, blob: item.cleanedBlob});
    await renderHistory();
  }catch(e){
    toast("History tidak bisa disimpan (penyimpanan penuh).");
  }
}
async function openHistoryPreview(id: number){
  var en;
  try{ en=await getHistory(id); }catch(e){ en=undefined; }
  if(!en || !en.blob){ toast("File history ini rusak."); return; }
  currentHistoryId=en.id;
  $("#previewName").textContent=en.name;
  var url=URL.createObjectURL(en.blob);
  var body=$("#previewBody");
  body.innerHTML='<img src="'+url+'" alt="Hasil '+escapeHtml(en.name)+'" class="max-w-full max-h-[70vh] object-contain rounded-lg">';
  var meta=$("#previewMeta");
  if(meta) meta.textContent=new Date(en.createdAt).toLocaleString("id-ID")+" · "+(en.tool==="clean"?"Bersihkan Label AI":en.tool==="meta"?"Edit Metadata":"Hapus Watermark AI")+" · "+en.label+" · "+formatBytes(en.size)+" · "+en.width+" × "+en.height;
  var dl=$("#previewDownload"); if(dl) dl.classList.remove("hidden");
  var del=$("#previewDelete"); if(del) del.classList.remove("hidden");
  $("#previewModal").classList.remove("hidden");
}
$("#historyGrid").addEventListener("click",function(e){
  var b=(e.target as Element).closest("button[data-history-id]") as HTMLButtonElement; if(!b) return;
  void openHistoryPreview(parseInt(b.dataset.historyId,10));
});
$("#historyClearBtn").addEventListener("click",function(){
  openSheet({title:"Hapus semua history?", body:"Semua hasil tersimpan di perangkat ini dihapus. Tindakan ini tidak bisa diurungkan.", confirm:"Hapus semua", danger:true, onConfirm:function(){
    void (async function(){ try{ await clearHistory(); }catch(e){} await renderHistory(); toast("History dihapus."); })();
  }});
});
$("#previewDownload").addEventListener("click",async function(){
  if(currentHistoryId===null) return;
  var en; try{ en=await getHistory(currentHistoryId); }catch(e){ return; }
  if(!en) return;
  var a=document.createElement("a"); a.href=URL.createObjectURL(en.blob); a.download=en.name; a.style.display="none";
  document.body.appendChild(a); a.click(); setTimeout(function(){ a.remove(); },2000);
  toast("Mengunduh "+en.name);
});
$("#previewDelete").addEventListener("click",function(){
  if(currentHistoryId===null) return;
  var id=currentHistoryId;
  void (async function(){ try{ await deleteHistory(id); }catch(e){} $("#previewModal").classList.add("hidden"); $("#previewBody").innerHTML=""; currentHistoryId=null; await renderHistory(); toast("Dihapus dari history."); })();
});

updateStats();
void renderHistory();
