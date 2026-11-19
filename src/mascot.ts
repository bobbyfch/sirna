
/* ═══ 3D Motion + Maskot ═══
   Murni lapisan gerak: nggak nyentuh logika deteksi / cleaning sama sekali.
   - Kemiringan dropzone / kartu pakai lerp biar halus (bukan nempel kaku
     ke pointer), cuma jalan di pointer halus (mouse / trackpad).
   - Maskot = pendamping proses: panggungnya (fixed, pojok kiri bawah)
     cuma ditampilkan (kelas .show) selama #procDock terlihat (dock
     proses alur utama); pas beres dia ngerayain sebentar lalu hilang
     lagi. Di luar proses: tak terlihat.
   - prefers-reduced-motion: semua parallax & reaksi dimatikan. */
(function(){
  var stage=document.getElementById("mascotStage");
  var mascot=document.getElementById("mascot3d");
  if(!stage || !mascot) return;
  var bubble=document.getElementById("mascotBubble");
  var reduce=!!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var finePointer=!!(window.matchMedia && window.matchMedia("(pointer: fine)").matches);

  /* — Balon kata maskot — */
  var bubbleTimer=null, lastSayAt=0;
  function say(text, ms, force?){
    if(!bubble || reduce) return;
    var now=Date.now();
    if(!force && now-lastSayAt<2500) return; /* jangan spam */
    lastSayAt=now;
    bubble.textContent=text;
    bubble.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer=setTimeout(function(){ bubble.classList.remove("show"); }, ms||2200);
  }
  function celebrate(){
    if(reduce) return;
    showStage();
    stage.classList.remove("is-celebrate");
    void stage.offsetWidth; /* restart animasi */
    stage.classList.add("is-celebrate");
    wave(1500);
    say("Beres!", 2400, true);
    setTimeout(function(){ stage.classList.remove("is-celebrate"); }, 1250);
  }

  /* — Lambaian tangan (layer terpisah, muter di sendi pergelangan):
     cuma di momen proses — pas ngerayain & pas maskot diketuk / pointer
     lewat. Nggak ada lagi sapaan berkala pas halaman dibuka: Naya
     nggak tampil sama sekali di luar proses. — */
  var waveTimer=null;
  function wave(ms){
    if(reduce) return;
    stage.classList.remove("is-waving");
    void stage.offsetWidth; /* restart animasi */
    stage.classList.add("is-waving");
    clearTimeout(waveTimer);
    waveTimer=setTimeout(function(){ stage.classList.remove("is-waving"); }, ms||1600);
  }

  if(finePointer) mascot.addEventListener("pointerenter", function(){ wave(1600); });

  /* — Ketuk maskot: lompat squash-and-stretch + melambai — */
  function jump(){
    if(reduce) return;
    stage.classList.remove("is-jumping");
    void stage.offsetWidth;
    stage.classList.add("is-jumping");
    wave(1500);
    say("Hai!", 1400, true);
    setTimeout(function(){ stage.classList.remove("is-jumping"); }, 700);
  }
  function tapMascot(){ jump(); }
  /* Sengaja BUKAN tombol: Naya cuma tamu pas proses & reaksinya murni
     delight (lompat), bukan kontrol tugas — jadi nggak pakai
     role=button / tabindex. Kalo dibuat fokusabel, keyboard & audit
     nemuin "kontrol" yang di luar proses memang sengaja tak terlihat. */
  mascot.addEventListener("click", tapMascot);

  /* — Parallax 3D dengan lerp (dropzone + kartu file; maskot nggak lagi
     miring ngikutin pointer — dia cuma tamu pas proses, geraknya cukup
     dari pose & animasi CSS-nya) — */
  if(!reduce && finePointer){
    var dz=document.getElementById("dropZone");
    var dTX=0, dTY=0, dX=0, dY=0;
    if(dz){
      dz.addEventListener("pointermove", function(e){
        var r=dz.getBoundingClientRect();
        var dx=(e.clientX-(r.left+r.width/2))/r.width;
        var dy=(e.clientY-(r.top+r.height/2))/r.height;
        dTY=Math.max(-3.2, Math.min(3.2, dx*6));
        dTX=Math.max(-3.2, Math.min(3.2, -dy*6));
      });
      dz.addEventListener("pointerleave", function(){ dTX=0; dTY=0; });
    }
    /* PERFORMA: loop lerp jalan SESUAI PERMINTAAN aja — dulu rAF ini muter
       60 fps SELAMANYA (termasuk pas dropzone disembunyiin / halaman idle),
       sekarang dia mulai pas pointer gerak di atas dropzone dan BERHENTI
       sendiri begitu miringnya udah nyampe target. */
    var tiltRunning=false;
    function tiltStep(){
      if(!dz || dz.classList.contains("hidden")){ tiltRunning=false; return; }
      dX+=(dTX-dX)*.12; dY+=(dTY-dY)*.12;
      dz.style.setProperty("--dry", dY.toFixed(2)+"deg");
      dz.style.setProperty("--drx", dX.toFixed(2)+"deg");
      if(Math.abs(dTX-dX)>.005 || Math.abs(dTY-dY)>.005){ requestAnimationFrame(tiltStep); }
      else tiltRunning=false;
    }
    function tiltKick(){
      if(tiltRunning || !dz) return;
      tiltRunning=true;
      requestAnimationFrame(tiltStep);
    }
    if(dz){
      dz.addEventListener("pointermove", tiltKick);
      dz.addEventListener("pointerleave", tiltKick);
    }
  }

  /* — Drag file: maskot semangat & ngajak lepas di dropzone — */
  if(!reduce){
    var dragDepth=0;
    document.addEventListener("dragenter", function(){
      dragDepth++;
      stage.classList.add("is-excited");
      say("Lepas di sini!", 2600);
    });
    document.addEventListener("dragleave", function(){
      dragDepth=Math.max(0, dragDepth-1);
      if(dragDepth===0) stage.classList.remove("is-excited");
    });
    document.addEventListener("drop", function(){
      dragDepth=0;
      stage.classList.remove("is-excited");
    });
  }

  /* — Status dari alur utama: maskot ngikutin progres tanpa ubah logika inti.
     Sinyal proses = #procDock (dock bawah, ditampilkan alur utama selama
     proses jalan, disembunyikan pas beres — lihat setProc/hideProc di
     src/app.ts). Dulu sinyalnya kelas .is-processing di kartu #list;
     kartu itu dicabut di pivot (DESIGN.md §9), jadi sinyalnya pindah
     ke dock. — */
  var procDock=document.getElementById("procDock");
  var workPhrases=["Lagi dibersihin…","Sikat… sikat…","Hampir kinclong…","Dikit lagi…","La la la…"], workSayIdx=0;
  var wasWorking=false, syncQueued=false, hideTimer=null;
  /* Visibilitas panggung: MUNCUL cuma pas proses jalan; pas proses
     beres, rayain dulu sebentar (1,8 dtk — cukup buat pose celebrate
     + balon "Beres!") baru hilang lagi. */
  function showStage(){
    clearTimeout(hideTimer);
    stage.classList.add("show");
  }
  function scheduleHide(){
    clearTimeout(hideTimer);
    hideTimer=setTimeout(function(){ stage.classList.remove("show"); }, 1800);
  }
  function syncMascot(){
    syncQueued=false;
    var working=procDock && !procDock.classList.contains("hidden") ? 1 : 0;
    stage.classList.toggle("is-working", working>0);
    if(working>0){ showStage(); workSayIdx=(workSayIdx+1)%workPhrases.length; say(workPhrases[workSayIdx], 2000); }
    else if(wasWorking){ celebrate(); scheduleHide(); }
    else if(!stage.classList.contains("is-celebrate")){ scheduleHide(); }
    wasWorking=working>0;
  }
  function queueSync(){
    if(syncQueued) return;
    syncQueued=true;
    requestAnimationFrame(syncMascot);
  }
  if(procDock) new MutationObserver(queueSync).observe(procDock, {attributes:true, attributeFilter:["class"]});
  syncMascot();

  /* — Reveal pas di-scroll: footer aja.
     Pengaturan & FAQ SENGAJA nggak ikut: isinya kontrol yang harus selalu
     kelihatan & bisa diketuk, nggak boleh nunggu observer / animasi dulu
     (R12: tanpa animasi pun task tetap lengkap & jelas). — */
  var revealTargets=[document.querySelector("footer")].filter(Boolean);
  if(!reduce && "IntersectionObserver" in window && revealTargets.length){
    revealTargets.forEach(function(el){ el.classList.add("reveal"); });
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting){ en.target.classList.add("inview"); io.unobserve(en.target); }
      });
    }, {threshold:.05, rootMargin:"0px 0px 80px 0px"});
    revealTargets.forEach(function(el){ io.observe(el); });
    /* Jaring pengaman: apa pun yang terjadi sama observer, nggak ada
       elemen yang boleh nyangkut invisible. */
    setTimeout(function(){
      revealTargets.forEach(function(el){ el.classList.add("inview"); });
    }, 1600);
  }
})();
