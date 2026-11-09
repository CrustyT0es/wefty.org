/* Wefty 2.0 "glass", area: Share. This file belongs to the Share builder; nobody else edits it.
   Share (js/share.js, send.js, files.js, clips.js): the Send, Files and Clipboard parts and their switch.
   Rules (vault/web/glass/README.md has the rest): everything here is inert unless V.look.isGlass() (and listen to V.on('look') so the switch works live); use the tokens in
   glass.css (--g-*, and the app's own names, which glass redefines); only transform and opacity animate; call
   V.motion's helpers instead of writing your own; nothing here changes the classic look.

   What this file does (the look itself is share.css; nothing in js/share.js, send.js or clips.js is touched):
     - the Send button (and Clipboard's Send to all) is the gradient only while there is something to send (words typed, or
       something waiting in the tray); share.css draws the quieter glass look by itself from :placeholder-shown and the
       hidden tray. This file only gives the button a small spring (V.motion.press) at the moment it becomes ready, so the
       change is felt as well as seen. It never changes what the button does: a press with nothing to send still says so. */
'use strict';

(() => {
const V = window.V;
if (!V) return;

const on = () => !!(V.look && V.look.isGlass());
const CARD = '.send-card, .clip-page > .send-row';

const had = new WeakMap();   // a card -> whether it had something to send the last time it was looked at
const watched = new WeakSet(); // the trays already watched

const cardOf = (node) => (node && node.closest ? node.closest(CARD) : null);

/* Something to send: words in the box (the same test as share.css's :placeholder-shown, so the look and the spring agree), or,
   in Send's card, something showing in the tray. */
function ready(card) {
  const box = card.querySelector('textarea');
  const tray = card.querySelector(':scope > .tray');
  return !!(box && box.value !== '') || !!(tray && !tray.hidden);
}

function look(card, quiet) {
  const now = ready(card);
  const was = had.get(card);
  had.set(card, now);
  if (!now || was !== false || quiet || document.hidden) return;
  const button = card.querySelector('.btn.primary');
  if (button && V.motion && V.motion.press) V.motion.press(button, { scale: 0.93 });
}

/* A card on the page: its first look is quiet, and its tray is watched (a file picked or taken out shows or hides it). */
function bind() {
  if (!on()) return;
  for (const card of document.querySelectorAll(CARD)) {
    if (!had.has(card)) look(card, true);
    const tray = card.querySelector(':scope > .tray');
    if (tray && !watched.has(tray) && typeof MutationObserver === 'function') {
      watched.add(tray);
      new MutationObserver(() => { if (on() && card.isConnected) look(card); }).observe(tray, { attributes: true, attributeFilter: ['hidden'] });
    }
  }
}

// Typing. (The box is emptied by a script when Send is pressed, which fires no input event: that is looked at after the press.)
document.addEventListener('input', (event) => {
  if (!on() || !event.target || event.target.tagName !== 'TEXTAREA') return;
  const card = cardOf(event.target);
  if (card) look(card);
}, true);
document.addEventListener('click', (event) => {
  if (!on()) return;
  const button = event.target && event.target.closest && event.target.closest('.btn.primary');
  const card = button && cardOf(button);
  if (card) requestAnimationFrame(() => { if (card.isConnected) look(card, true); });
}, true);

V.on('tab', (view) => { if (on() && /^(send|clips)$/.test(String(view))) bind(); });
V.on('look', () => { if (on()) bind(); });
if (on()) bind();
})();
