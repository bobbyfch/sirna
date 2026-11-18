
/* ——— PWA: daftarkan service worker + tombol "Pasang Sirna di HP" ——— */
(function(){
  if("serviceWorker" in navigator){
    window.addEventListener("load",function(){
      navigator.serviceWorker.register("sw.js").catch(function(){});
    });
  }
  var btn=document.getElementById("installBtn");
  if(!btn) return;
  var standalone=(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||(window.navigator as Navigator & { standalone?: boolean }).standalone===true;
  if(standalone) return; /* sudah terpasang — tombol nggak perlu muncul */
  var deferred=null;
  function show(){ btn.classList.remove("hidden"); btn.classList.add("inline-flex"); }
  function hide(){ btn.classList.add("hidden"); btn.classList.remove("inline-flex"); }
  window.addEventListener("beforeinstallprompt",function(e){ e.preventDefault(); deferred=e; show(); });
  window.addEventListener("appinstalled",function(){ deferred=null; hide(); });
  var ua=window.navigator.userAgent||"";
  var isIOS=/iphone|ipad|ipod/i.test(ua)||(/macintosh/i.test(ua)&&"ontouchend" in document);
  show(); /* selalu tampil kalau belum terpasang — tanpa prompt native pun tombol tetap jalan sebagai panduan manual */
  var toastTimer=null;
  function toastMsg(msg){
    var t=document.getElementById("toast");
    if(!t) return;
    t.textContent=msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){ t.classList.add("hidden"); },4200);
  }
  btn.addEventListener("click",function(){
    if(deferred){
      deferred["prompt"]();
      deferred.userChoice.then(function(){ deferred=null; hide(); });
      return;
    }
    if(isIOS){ toastMsg("Pasang Sirna: ketuk tombol Bagikan di Safari, lalu pilih \u201CTambahkan ke Layar Utama\u201D."); }
    else{ toastMsg("Pasang Sirna: ketuk menu \u22EE di browser, lalu pilih \u201CTambah ke layar utama\u201D."); }
  });
})();
