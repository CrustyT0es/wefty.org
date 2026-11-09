/* Wefty 2.0 "glass", area: Note-taker. This file belongs to the Note-taker builder; nobody else edits it.
   The note-taker (js/notetaker.js, dictation.js, capture.js): its start screen, live screen, strip and problem screens.
   Rules (vault/web/glass/README.md has the rest): everything here is inert unless V.look.isGlass() (and listen to V.on('look') so the switch works live); use the tokens in
   glass.css (--g-*, and the app's own names, which glass redefines); only transform and opacity animate; call
   V.motion's helpers instead of writing your own; nothing here changes the classic look. */
'use strict';

(() => {
const V = window.V;
if (!V) return;
const on = () => !!(V.look && V.look.isGlass());

/* ---- the 2.0 hotfix: the live screen starts at its top. js/notetaker.js draws it in the same box the start screen was in,
   which a phone with bigger text has scrolled down to its Start button: the screen that took its place kept that scroll,
   with its top out of sight (and, where it couldn't scroll, out of reach). glass/notetaker.css makes it a scroller. */
let layersWatch = null;
const bodyWatch = typeof MutationObserver === 'function' ? new MutationObserver((records) => {
  if (!on()) return;
  for (const r of records) {
    if ([...r.addedNodes].some((n) => n.nodeType === 1 && n.classList.contains('nt-live'))) r.target.scrollTop = 0;
  }
}) : null;
function layersChanged() {
  if (!bodyWatch) return;
  bodyWatch.disconnect();
  for (const body of document.querySelectorAll('#layers > .nt-layer .nt-body')) bodyWatch.observe(body, { childList: true });
}
function watch() {
  const layers = document.getElementById('layers');
  if (!layers || layersWatch || !bodyWatch) return;
  layersWatch = new MutationObserver(layersChanged);
  layersWatch.observe(layers, { childList: true });
  layersChanged();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true }); else watch();
})();
