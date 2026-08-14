/* Add-to-home-screen helper. It never auto-opens or nags: the compact header
 * control appears only on supported mobile browsers and the person chooses
 * whether to install. iOS deliberately gets its own Share-menu guidance,
 * because Safari does not expose Android's install event. */
(() => {
  'use strict';
  const button = document.getElementById('a2hs-button');
  if (!button) return;
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let deferred = null;
  if (standalone || (!ios && !android)) return;

  const show = () => { button.hidden = false; };
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferred = event; show(); });
  window.addEventListener('appinstalled', () => { deferred = null; button.hidden = true; close(); });
  if (ios) show();
  // Some Android browsers do not emit beforeinstallprompt. Still give a
  // discoverable, one-tap explanation after the page settles.
  if (android) setTimeout(() => { if (!standalone) show(); }, 900);

  const close = () => document.getElementById('a2hs-sheet')?.remove();
  const openSheet = () => {
    if (document.getElementById('a2hs-sheet')) return;
    const sheet = document.createElement('div');
    sheet.id = 'a2hs-sheet'; sheet.className = 'a2hs-sheet-wrap';
    const body = ios
      ? '<strong>Add Functioning Faith to your iPhone</strong><p>Tap the Share button <b>⎋</b> in Safari, then choose <b>Add to Home Screen</b>. It will launch like an app with your saved sign-in.</p>'
      : '<strong>Add Functioning Faith to your Android home screen</strong><p>Choose <b>Install</b> below. If your browser does not show it, open its menu <b>⋮</b> and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>';
    sheet.innerHTML = `<div class="a2hs-backdrop" data-a2hs-close></div><section class="a2hs-sheet" role="dialog" aria-modal="true" aria-labelledby="a2hs-title"><button class="ghost a2hs-close" data-a2hs-close aria-label="Close">×</button><div class="a2hs-app-icon"><img src="/icon-192.png" alt=""></div><h2 id="a2hs-title">${ios ? 'Add to Home Screen' : 'Install Functioning Faith'}</h2>${body}<div class="a2hs-actions">${!ios && deferred ? '<button class="primary" id="a2hs-install">Install app</button>' : ''}<button class="ghost" data-a2hs-close>Not now</button></div></section>`;
    document.body.appendChild(sheet);
    sheet.querySelectorAll('[data-a2hs-close]').forEach(el => el.onclick = close);
    const install = sheet.querySelector('#a2hs-install');
    if (install) install.onclick = async () => { install.disabled = true; await deferred.prompt(); await deferred.userChoice; deferred = null; close(); };
  };
  button.onclick = openSheet;
})();
