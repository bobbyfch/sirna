
/* ——— PERFORMA: marquee brand di-pause pas di luar layar ———
   Animasi CSS jalan terus walau elemennya udah ke-scroll lewat; observer
   ini matiin animasinya pas strip logo nggak kelihatan & nyalain lagi
   pas masuk viewport. Tanpa observer, halaman jalan seperti biasa. */
(function(){
  var wrap=document.getElementById("brandWrap"), track=document.getElementById("brandTrack");
  if(!wrap || !track || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(function(entries){
    entries.forEach(function(en){ track.classList.toggle("paused", !en.isIntersecting); });
  }, {rootMargin:"80px"}).observe(wrap);
})();
