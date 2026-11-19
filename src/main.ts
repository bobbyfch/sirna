/* Sirna — entry Vite. Urutan eksekusi dipertahankan seperti script inline
   dulu (app -> mascot -> pwa -> marquee); module script dieksekusi deferred
   setelah DOM ter-parse, sama seperti script di akhir <body>. */
import "./style.css";
import "./studio.css";
import "./app";
import "./mascot";
import "./pwa";
import "./marquee";
