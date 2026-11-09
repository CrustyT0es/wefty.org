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

/* ================================================================== the 2.0 hotfix: nothing in Share changes at once

   The owner: "overall for animation I want there to be a smooth animation for EVERYTHING I click. Nothing should instantly
   change - I'm talking a little about the share section." js/share.js, send.js, clips.js and files.js draw a part afresh at
   every change, so each moment is played from outside, on what has just been drawn:
     - the switch (Send | Files | Clipboard): its pill slides from the part left to the part tapped, the part's words and
       cards slide in from that side while what was there slides out the other way and fades (a copy of it, never the real
       one), and Share opened from another tab rises in as Today does;
     - Send to: the name of where things go comes in when it changes (its menu pops, as every menu);
     - the tray: what is picked lands with a spring, what is taken out shrinks away, the rest slide to their new places, and
       what is under the tray moves with it as it comes and goes;
     - the lists (Sent and received, Clipboard's clips, Files' rows): what is new rises in, the latest clip comes in afresh;
     - a press on a row's buttons, the clipboard's and Files' buttons springs (the cards' own buttons spring in share.css).
   Lite: shorter, no copy of the old part. Calm: nothing moves (a fade of 120 ms at most). The words sent fly into their
   row (glass/send.js). */
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SPRING = 'cubic-bezier(.34,1.45,.64,1)';
const SLIDE = 'cubic-bezier(.22,1.06,.36,1)';   // (a slide that settles: no more than a touch past)
const SHARE = /^(send|files|clips)$/;
const zoomOf = () => { const b = document.body; return b && b.offsetWidth ? b.getBoundingClientRect().width / b.offsetWidth || 1 : 1; };
function animate(el, keyframes, options) {
  if (!el || !HAS_WAAPI || !el.isConnected) return null;
  try { return el.animate(keyframes, options); } catch (error) { return null; }
}
const fade = (el, ms = 120) => animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: 'linear', fill: 'backwards' });

/* -- the switch: the part tapped comes in from its side, the one left goes the other way */
let leaving = null;      // { from, ghost } made at the tap, before the new part is drawn
let lastPart = '';       // the Share part showing (for the pill's way)

/* A copy of the part showing, where it is (inert, behind the app), so it can go while the new one comes. */
function ghostOf(view) {
  const page = view.querySelector(':scope > .page');
  if (!page || lite() || calm()) return null;
  const z = zoomOf();
  const r = view.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = `${view.className} g-share-ghost`;
  ghost.dataset.tab = view.dataset.tab;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, { position: 'fixed', left: `${r.left / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`,
    height: `${r.height / z}px`, overflow: 'hidden', pointerEvents: 'none', zIndex: '0', margin: '0' });
  const copy = page.cloneNode(true);
  // (its top and the switch stay where they are: the new part's are drawn in the same place)
  copy.querySelectorAll(':scope > header, :scope > .share-switch').forEach((el) => { el.style.visibility = 'hidden'; });
  ghost.appendChild(copy);
  document.body.appendChild(ghost);
  ghost.scrollTop = view.scrollTop;
  return ghost;
}
function tapped(event) {
  if (!on()) return;
  const button = event.target && event.target.closest ? event.target.closest('.share-switch [data-part]') : null;
  const view = button && button.closest('main.view');
  if (!view || !SHARE.test(view.dataset.tab || '') || button.dataset.part === view.dataset.tab) return;
  dropGhost();
  leaving = { from: view.dataset.tab, ghost: ghostOf(view) };
}
function keyed(event) {
  if (!on() || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const view = event.target && event.target.closest ? event.target.closest('main.view') : null;
  if (!view || !event.target.closest('.share-switch') || !SHARE.test(view.dataset.tab || '')) return;
  dropGhost();
  leaving = { from: view.dataset.tab, ghost: ghostOf(view) };
}
function dropGhost() {
  if (leaving && leaving.ghost) leaving.ghost.remove();
  leaving = null;
}
document.addEventListener('click', tapped, true);
document.addEventListener('keydown', keyed, true);

/* The switch's pill: one element behind the buttons, on the part shown; it slides there from `from` (a part's id). */
function pill(sw, from) {
  if (!sw) return;
  const picked = sw.querySelector(':scope > [aria-selected="true"]');
  if (!picked) return;
  let el = sw.querySelector(':scope > .g-share-pill');
  if (!el) {
    el = document.createElement('span');
    el.className = 'g-share-pill';
    el.setAttribute('aria-hidden', 'true');
    sw.insertBefore(el, sw.firstChild);
  }
  sw.classList.add('g-pilled');
  Object.assign(el.style, { width: `${picked.offsetWidth}px`, height: `${picked.offsetHeight}px`, transform: `translate(${picked.offsetLeft}px, ${picked.offsetTop}px)` });
  const old = from ? sw.querySelector(`:scope > [data-part="${from}"]`) : null;
  if (!old || old === picked || calm()) return;
  animate(el, [{ transform: `translate(${old.offsetLeft}px, ${old.offsetTop}px)` }, { transform: `translate(${picked.offsetLeft}px, ${picked.offsetTop}px)` }],
    { duration: lite() ? 200 : 460, easing: lite() ? EASE : 'cubic-bezier(.25,1.18,.35,1)' });
  if (!lite()) {
    // (its little stretch on the way, as the tab bar's pill does: the scale is its own property, under the slide's transform)
    animate(el, [{ scale: '1 1' }, { scale: '1.08 .94', offset: 0.28 }, { scale: '.99 1.01', offset: 0.6 }, { scale: '1 1' }],
      { duration: 460, easing: 'cubic-bezier(.25,.8,.3,1)' });
  }
  // (the words under it: the part left keeps its words a moment, as the tab bar's do)
  for (const button of [old, picked]) animate(button, [{ opacity: 0.55 }, { opacity: 1 }], { duration: 300, easing: EASE });
}

/* What is in a part under its switch, in order. */
const partsOf = (page) => {
  const sw = page.querySelector(':scope > .share-switch');
  const all = [...page.children];
  return sw ? all.slice(all.indexOf(sw) + 1) : all.filter((el) => el.tagName !== 'HEADER');
};

function shown(view) {
  const page = view.querySelector(':scope > .page');
  if (!page) return;
  const part = view.dataset.tab;
  const sw = page.querySelector(':scope > .share-switch');
  const was = leaving && leaving.from !== part ? leaving : null;
  leaving = null;
  pill(sw, was ? was.from : '');
  const items = partsOf(page).filter((el) => el.getClientRects().length).slice(0, 8);
  if (calm()) {
    items.forEach((el) => fade(el, 120));
    if (was && was.ghost) was.ghost.remove();
    return;
  }
  if (was) {
    // (the same tab: Share's top and its switch stay where they are; only what is under the switch moves. The shell's
    // slide for a change of tab comes after this, so it is let go once it has begun.)
    Promise.resolve().then(() => { for (const a of page.getAnimations()) if (a.id === 'g-slide') a.cancel(); });
    // Sideways, from the side of the part tapped; the copy of the part left goes the other way and fades first.
    const order = sw ? [...sw.querySelectorAll(':scope > [data-part]')].map((b) => b.dataset.part) : ['send', 'files', 'clips'];
    const dir = order.indexOf(part) > order.indexOf(was.from) ? 1 : -1;
    items.forEach((el, i) => {
      const wait = lite() ? 0 : 60 + Math.min(i, 5) * 26;
      animate(el, [{ transform: `translateX(${dir * 40}px)` }, { transform: 'none' }], { duration: lite() ? 200 : 460, delay: wait, easing: lite() ? EASE : SLIDE, fill: 'backwards' });
      animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: lite() ? 160 : 240, delay: wait + (lite() ? 0 : 40), easing: EASE, fill: 'backwards' });
    });
    if (was.ghost) {
      const copy = was.ghost.firstElementChild;
      const goes = copy ? partsOf(copy) : [];
      const gone = () => was.ghost.remove();
      const done = goes.map((el) => animate(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 32}px)` }],
        { duration: 150, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' })).filter(Boolean);
      if (done.length) Promise.all(done.map((a) => a.finished)).then(gone, gone); else gone();
      setTimeout(gone, 500);
    }
    return;
  }
  // Share opened from another tab: its parts rise in, as Today's do.
  items.forEach((el, i) => animate(el, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
    { duration: lite() ? 180 : 500, delay: lite() ? 0 : Math.min(i, 7) * 45, easing: EASE, fill: 'backwards' }));
}

/* -- each part's moments (what changes after it was drawn) */
const watching = new WeakSet();
const lastKeys = new WeakMap();   // a list -> the keys of its rows the last time it was drawn
const trays = new WeakMap();      // a Send card -> { keys, rects (card-relative), tiles, under, shown }

/* What is new in a list rises in; the first time a list is seen nothing moves (the part's own entrance shows it). */
function rows(list, selector, keyOf) {
  const items = [...list.querySelectorAll(selector)];
  const keys = items.map(keyOf);
  const before = lastKeys.get(list);
  lastKeys.set(list, new Set(keys));
  if (!before || calm()) {
    if (before && calm()) items.filter((el, i) => !before.has(keys[i])).forEach((el) => fade(el));
    return;
  }
  items.filter((el, i) => keys[i] && !before.has(keys[i])).slice(0, 6).forEach((el, i) => {
    if (el.matches('.g-fly-shape')) return;
    animate(el, [{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }],
      { duration: lite() ? 180 : 420, delay: lite() ? 0 : i * 45, easing: lite() ? EASE : SLIDE, fill: 'backwards' });
  });
}
const transferKey = (el) => el.dataset.id || el.dataset.group || '';
const clipKey = (el) => `${(el.querySelector('.clip-from') || {}).dataset ? el.querySelector('.clip-from').dataset.from || '' : ''}|${(el.querySelector('.clip-text') || {}).textContent || ''}`;
const fileKey = (el) => el.textContent || '';

/* The tray: the tiles that came spring in, the ones taken out shrink away (a copy where they were), the rest slide over;
   what is under it moves with it. */
function cardRect(card, el) {
  const z = zoomOf();
  const c = card.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // (where it is laid out: a move or a spring playing on it now is taken off)
  let tx = 0, ty = 0;
  try { const m = new DOMMatrixReadOnly(getComputedStyle(el).transform); if (m.a === 1 && m.d === 1) { tx = m.e; ty = m.f; } } catch (error) { /* none */ }
  return { left: (r.left - c.left) / z - tx, top: (r.top - c.top) / z - ty, width: r.width / z, height: r.height / z };
}
function trayKeys(tray) {
  const seen = new Map();
  return [...tray.querySelectorAll('.stage')].map((tile) => {
    const name = tile.getAttribute('title') || '';
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    return `${name}#${n}`;
  });
}
function readTray(card) {
  const tray = card.querySelector(':scope > .tray');
  const tiles = tray ? [...tray.querySelectorAll('.stage')] : [];
  const keys = tray ? trayKeys(tray) : [];
  const under = card.querySelector(':scope > .send-row');
  return { keys, tiles, rects: tiles.map((t) => cardRect(card, t)), shown: !!(tray && !tray.hidden), under: under ? cardRect(card, under).top : 0 };
}
function trayChanged(card) {
  const before = trays.get(card);
  const now = readTray(card);
  trays.set(card, now);
  if (!before || calm()) {
    if (before && calm() && now.shown && !before.shown) fade(card.querySelector(':scope > .tray'));
    return;
  }
  const z = zoomOf();
  const c = card.getBoundingClientRect();
  // taken out: a copy shrinks away where it was
  before.keys.forEach((key, i) => {
    if (now.keys.includes(key)) return;
    const old = before.tiles[i];
    const r = before.rects[i];
    if (!old || !r || old.isConnected) return;
    // (the tile itself, taken out of the tray: its picture is already drawn, so it never shows a broken image)
    const copy = old;
    copy.classList.add('g-tile-gone');
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    Object.assign(copy.style, { position: 'fixed', left: `${c.left / z + r.left}px`, top: `${c.top / z + r.top}px`, width: `${r.width}px`,
      height: `${r.height}px`, margin: '0', pointerEvents: 'none', zIndex: '5' });
    document.body.appendChild(copy);
    const a = animate(copy, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.6)' }], { duration: lite() ? 140 : 240, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' });
    const gone = () => copy.remove();
    if (a) a.finished.then(gone, gone); else gone();
    setTimeout(gone, 700);
  });
  // came: lands with a spring; stayed: slides to where it is now
  now.keys.forEach((key, i) => {
    const tile = now.tiles[i];
    const j = before.keys.indexOf(key);
    if (j < 0) {
      animate(tile, [{ opacity: 0, transform: 'scale(.55) translateY(10px)' }, { opacity: 1, transform: 'none' }],
        { duration: lite() ? 180 : 460, delay: lite() ? 0 : (before.shown ? 0 : 140) + Math.min(i, 6) * 40, easing: lite() ? EASE : SPRING, fill: 'backwards' });
      return;
    }
    const from = before.rects[j];
    const to = now.rects[i];
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      animate(tile, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: lite() ? 180 : 380, easing: SLIDE });
    }
  });
  // the tray comes or goes: what is under it moves from where it was, quickly, and the tray fades in once there is room
  const tray = card.querySelector(':scope > .tray');
  if (now.shown && !before.shown && tray) animate(tray, [{ opacity: 0, transform: 'scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: lite() ? 160 : 300, delay: lite() ? 0 : 110, easing: EASE, fill: 'backwards' });
  const under = card.querySelector(':scope > .send-row');
  const dy = before.under - now.under;
  if (under && Math.abs(dy) > 1) {
    const moving = { duration: lite() ? 160 : 300, easing: 'cubic-bezier(.2,.9,.3,1)' };
    animate(under, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], moving);
    for (let el = card.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.getClientRects().length) animate(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], moving);
    }
  }
}

/* Send to: where things go comes in when it changes. */
const sendTo = new WeakMap();
function sendToChanged(wrap) {
  const name = wrap.querySelector('.send-to-name');
  const now = name ? name.textContent : '';
  const was = sendTo.get(wrap);
  sendTo.set(wrap, now);
  if (was === undefined || was === now) return;
  if (calm()) { fade(name); return; }
  animate(name, [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' }], { duration: lite() ? 180 : 380, easing: SLIDE });
  const icon = name.previousElementSibling;
  if (icon && icon.classList.contains('icon')) animate(icon, [{ transform: 'scale(.6) rotate(-12deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: lite() ? 180 : 420, easing: lite() ? EASE : SPRING });
}

/* The latest clip comes in afresh when a newer one arrives. */
const latestText = new WeakMap();
function latestChanged(box) {
  const text = box.textContent;
  const was = latestText.get(box);
  latestText.set(box, text);
  if (was === undefined || was === text || !box.firstElementChild) return;
  if (calm()) { fade(box.firstElementChild); return; }
  animate(box.firstElementChild, [{ opacity: 0, transform: 'translateY(8px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: lite() ? 180 : 420, easing: SLIDE });
}

function watch(view) {
  const page = view.querySelector(':scope > .page');
  if (!page || watching.has(page) || typeof MutationObserver !== 'function') return;
  watching.add(page);
  const look = () => {
    if (!on() || !page.isConnected) return;
    const transfers = page.querySelector(':scope > .transfers');
    if (transfers) rows(transfers, ':scope > .transfer', transferKey);
    const clips = page.querySelector(':scope > .clips');
    if (clips) rows(clips, ':scope > .clip', clipKey);
    const files = page.querySelector('.files-list');
    if (files) rows(files, ':scope > .files-row', fileKey);
    const card = page.querySelector(':scope > .send-card');
    if (card) trayChanged(card);
    const wrap = page.querySelector('.send-to-wrap');
    if (wrap) sendToChanged(wrap);
    const latest = page.querySelector(':scope > .clip-latest');
    if (latest) latestChanged(latest);
  };
  look();
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    // (after this task: a part draws several pieces in a row, and the layout is read once they're all there)
    Promise.resolve().then(() => { queued = false; look(); });
  }).observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}

/* A press on a row's own buttons (Open, Copy, Save...), the clipboard's and Files' buttons: the spring. */
document.addEventListener('click', (event) => {
  if (!on() || calm()) return;
  const button = event.target && event.target.closest
    ? event.target.closest('.view:is([data-tab=send], [data-tab=clips], [data-tab=files]) :is(.transfer, .clip, .clip-latest, .files-row, .files-sources, .clip-step, .clip-offer, .files-host) :is(button, .btn)')
    : null;
  if (button && V.motion && V.motion.press) V.motion.press(button, { scale: 0.92 });
}, true);

V.on('tab', (view) => {
  if (!on()) { dropGhost(); return; }
  const name = String(view || '');
  if (!SHARE.test(name)) { dropGhost(); lastPart = ''; return; }
  const main = document.querySelector('main.view');
  if (!main || main.dataset.tab !== name) return;
  lastPart = name;
  shown(main);
  watch(main);
});
V.on('look', () => { if (!on()) { dropGhost(); document.querySelectorAll('.g-share-pill, .g-tile-gone').forEach((el) => el.remove()); document.querySelectorAll('.g-pilled').forEach((el) => el.classList.remove('g-pilled')); } });
})();
