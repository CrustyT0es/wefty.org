/* Wefty 2.0, ui/: the dock (lane B2; the look brief 2.1). Where it is and how it looks is ui/dock.css's, from the tokens
   alone, so nothing here runs in a screen's draw. This file is the one reader of the visualViewport:

     - html.g-typing while a text field has the typing and the screen got shorter than it was (the keyboard took the
       room: Android resizes the page, interactive-widget=resizes-content; an iPhone shrinks only the visual viewport):
       the dock slides away (glass.css) and comes back when the keyboard goes (Android's Back puts the keyboard away and
       leaves the field focused: the height says so);
     - --kb on <html>: how much of the page the keys cover (an iPhone's; 0 where the page itself was resized), written
       only when it changes, and html[data-kb] while it isn't 0: a screen's own bar rides 8 px above the keys;
     - V.dock: `register(name, el)` (a screen hands the dock its bar: a note's tools, Chat's box, the study and class
       feet, the pick bar; a registered bar wins over the table below, so no later lane edits this file), `bar(name)`,
       `bars()` (what the foot holds now), `claim()` (the top of the highest of them, page px, or null: what a toast
       stays above), `kb()`, `typing()`.

   (Moved here from glass/shell.js, whose keyboard reader this was: one reader, one writer of html.g-typing.) */
'use strict';

(() => {
const V = (window.V = window.V || {});
if (V.dock) return;  // (once only)
const root = document.documentElement;

/* ---------------------------------------------------------------- the keyboard */

const TEXT_ENTRY = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type=checkbox]):not([type=radio])'
  + ':not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color]):not([type=file]):not([type=image])';
const KEYBOARD = 120;      // px the screen must lose before it counts as a keyboard (a phone's is 250 or more)
let tallest = 0;
let tallestFor = 0;        // the width `tallest` was measured at (a turned phone starts again)
let kbNow = 0;
const touchy = () => { try { return window.matchMedia('(pointer: coarse)').matches; } catch (error) { return false; } };
function screenHeight() {
  const vv = window.visualViewport;
  return Math.round(vv ? Math.min(window.innerHeight, vv.height * (vv.scale || 1)) : window.innerHeight);
}
function typingNow() {
  const el = document.activeElement;
  return !!(el && el !== document.body && el.matches && el.matches(TEXT_ENTRY) && !el.disabled && !el.readOnly);
}
/* How much of the page the keys cover: the layout viewport's foot below the visual viewport's (an iPhone's keyboard),
   never a pinch zoom's. */
function covered(typing) {
  const vv = window.visualViewport;
  if (!typing || !vv || (vv.scale || 1) > 1.01) return 0;
  return Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
}
function read() {
  const typing = typingNow();
  // (a text box has the typing: the aurora's drift is paused meanwhile, glass.css; the owner's typing lag, 1.22.2)
  const aura = document.getElementById('g-aurora');
  if (aura && aura.classList.contains('g-field') !== typing) aura.classList.toggle('g-field', typing);
  let up = false;
  if (touchy()) {
    const height = screenHeight();
    const width = window.innerWidth;
    if (width !== tallestFor) { tallestFor = width; tallest = 0; }
    if (height > tallest) tallest = height;
    up = typing && tallest - height >= KEYBOARD;
  }
  if (root.classList.contains('g-typing') !== up) root.classList.toggle('g-typing', up);
  const kb = up ? covered(typing) : 0;
  if (kb !== kbNow) {
    kbNow = kb;
    // (only on a change: a custom property written on <html> restyles the page; the keyboard comes and goes rarely)
    if (kb) { root.style.setProperty('--kb', `${kb}px`); root.setAttribute('data-kb', ''); }
    else { root.style.removeProperty('--kb'); root.removeAttribute('data-kb'); }
  }
}
const soon = () => requestAnimationFrame(read);
document.addEventListener('focusin', soon, true);
const later = (fn, ms) => (V.motion && V.motion.later ? V.motion.later(fn, ms) : { cancel: ((id) => () => clearTimeout(id))(setTimeout(fn, ms)) });
document.addEventListener('focusout', () => later(read, 60), true);  // (focus moving to another field: no flicker)
window.addEventListener('resize', read);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', read);
  window.visualViewport.addEventListener('scroll', read);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', read, { once: true }); else read();

/* ---------------------------------------------------------------- the bars at the foot */

/* Until each screen registers its own bar (in its own wave), the dock finds them by these. A registered bar of the
   same name wins. */
const TABLE = {
  tabs: '#app.ready:not(.gate) > nav.tabs',
  note: '.editor-layer.shown:not(.g-leaving) .editor-tools',
  ask: '.editor-layer.shown:not(.g-leaving) .editor-ask .ask-card',
  chat: '.chat-composer > :not([hidden])',
  study: '.layer.study-layer:not(.leaving) .study-foot',
  class: '.nt-layer.shown .nt-foot',
  pick: '.pick-bar',
};
const own = new Map();  // name -> element

function shows(el) {
  if (!el || !el.isConnected || !el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}
function register(name, el) {
  const was = own.get(name);
  if (was && was !== el && was.dataset) delete was.dataset.dockBar;
  if (!el) { own.delete(name); return () => {}; }
  own.set(name, el);
  el.dataset.dockBar = name;
  return () => { if (own.get(name) === el) { own.delete(name); delete el.dataset.dockBar; } };
}
function bar(name) {
  const mine = own.get(name);
  if (mine && mine.isConnected) return mine;
  const selector = TABLE[name];
  return selector ? [...document.querySelectorAll(selector)].find(shows) || null : null;
}
function bars() {
  const out = [];
  for (const name of new Set([...Object.keys(TABLE), ...own.keys()])) {
    const mine = own.get(name);
    const found = mine && mine.isConnected ? [mine] : TABLE[name] ? [...document.querySelectorAll(TABLE[name])] : [];
    for (const el of found) if (shows(el)) out.push({ name, el });
  }
  return out;
}
/* The top of the highest thing the foot holds (page px; a bar across the lower part of the screen, never a rail down
   its side), or null. It reads layout: call it outside a screen's draw. */
function claim() {
  const H = window.innerHeight;
  let top = null;
  for (const { el } of bars()) {
    const r = el.getBoundingClientRect();
    if (r.top < H * 0.45 || r.height > H * 0.5 || r.width < 120) continue;
    if (top === null || r.top < top) top = r.top;
  }
  return top;
}

V.dock = { register, bar, bars, claim, kb: () => kbNow, typing: () => root.classList.contains('g-typing'), TABLE, read };
})();
