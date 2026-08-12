// Independent safety net for the #app CSS-hide in index.html's <head>.
// If app-intro.js ever fails to load or throws before reaching its own
// reveal() calls, #app must not stay hidden forever. This has to be an
// external file, not an inline <script> in index.html -- the CSP here is
// script-src 'self' with no 'unsafe-inline', so an inline block is silently
// blocked by the browser and would never run at all. Found by actually
// reading the console during verification, not assumed safe.
'use strict';
setTimeout(function () {
  var a = document.getElementById('app');
  if (a) a.style.visibility = 'visible';
}, 6000);
