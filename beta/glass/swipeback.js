/* Wefty 2.0 "glass": swipe right to go back (the owner: "could we incorporate a swipe right to exit a chat and enter a
   note and stuff like that? More iPhoney"). Everything here is inert unless V.look.isGlass(), and only a finger does it.

   On a screen pushed on top of another, a finger drawn to the right takes the screen back the way its back button would:
     - the screen follows the finger one to one, with a soft shadow along its left edge (.g-sb-curtain::after);
     - the screen under it shows through, starting 30 % to the left and dimmed, and slides into place as you drag. Where
       that screen is in the page already, it's the real thing; where it isn't (a Settings page over Settings' home,
       Settings over the tab it came from, a folder over all your notes), the dimmed aurora shows and the screen's own
       back animation finishes the move from where the finger let go;
     - let go past 35 % of the width, or flicked right faster than .5 px a ms (over the last 80 ms, so a finger held still
       before it lifts has no speed), and it goes back; anything less springs back. Both on V.motion's springs, from the
       finger's own speed. On Android a light buzz (8 ms) the moment it would go back;
     - going back presses the screen's own back control (its X, Hide, Done or arrow), so the history steps, Android's Back
       and the browser's Back afterwards are exactly as after a tap on it, and the screen's own way out is never played a
       second time: it plays off the screen (a layer), carries on from where the finger left it (a note shrinking into its
       card, Settings' carousel), or doesn't play at all (Chat's list, which is already there).

   Where a swipe may start: anywhere on such a screen once the move is clearly sideways (12 px, and 1.5 times its up or
   down), except on what has a sideways use of its own (text being typed in or picked, a sideways scroller such as the week
   strip, chips or Share's switch, Notes' cards that swipe, a slider, a canvas, the picture viewer, a flash card): from
   those, only from the left edge (24 px; 32 px on Android, so gesture navigation's own edge leaves room inside it). In an
   iPhone's Safari tab the very edge is Safari's own Back (which lands on the same close path): ours starts only away from
   it there. Anything not clearly sideways is a scroll, and the browser has it.

   The screens (kinds, below): a note (a phone's full-screen note), the study screen, Help, the note-taker's live screen
   (the swipe is Hide), the drawing screen (its own question first when there's something unsaved: then it springs back),
   a chat over the list of chats, a Settings page over Settings' home, Settings over the tab it came from, and Notes' inner
   lists (a folder, Upcoming, Flash cards, Pinned, a #tag, Archive, Trash) back to all your notes or the folder above. Only on
   a phone's layout (wide shows those side by side, and Help, the note-taker and studying are dialogs there).

   Calm: plain movement (the screen follows the finger and slides off or back quickly), no parallax, no shadow. Lite: the
   same moves on stiffer springs; only transforms and opacity ever move, and no blur changes.

   For other areas: V.swipeBack.taken() -> { x, p } while a swipe that was let go hands over to a screen's own back move
   (glass/settings.js starts its carousel there), else null. V.swipeBack.screen() names the screen a swipe would take
   back now ('' when none); V.swipeBack.busy() says whether a swipe is moving something. */
'use strict';

(() => {
const V = window.V;
if (!V || !V.look) return;
const root = document.documentElement;
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
const TRANSLATE = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('translate', '1px');

const START = 12;        // px sideways before a drag is a swipe back...
const SLANT = 1.5;       // ...and at least this many times its up or down
const EDGE = 24;         // px from the left edge where a swipe starts on anything
const EDGE_ANDROID = 32; // (gesture navigation takes the very edge: this leaves room inside it)
const EDGE_START = 6;    // px a swipe from the edge needs (before a card's own swipe, at 8 px, would take it)
const LONG = 420;        // ms a finger held still before it moves is a long press (its menu or picking wins)
const COMMIT = 0.35;     // of the width: let go past it and it goes back
const FLICK = 0.5;       // px a ms to the right: a flick that goes back from anywhere
const RECENT = 80;       // ms of moves that say how fast the finger went
const PARALLAX = 0.3;    // the screen under starts this far to the left
const CAROUSEL = 'cubic-bezier(.22,1,.36,1)';  // (glass/settings.js's carousel)

const ua = navigator.userAgent || '';
const IOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
const ANDROID = /Android/i.test(ua);
const matches = (q) => { try { return !!(window.matchMedia && matchMedia(q).matches); } catch (error) { return false; } };
const standalone = () => navigator.standalone === true || matches('(display-mode: standalone)') || matches('(display-mode: fullscreen)');

const on = () => !!V.look.isGlass();
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const wide = () => !!(V.wide && V.wide());
const zoom = () => parseFloat(getComputedStyle(root).zoom) || 1;
const shows = (el) => !!(el && el.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

/* ---------------------------------------------------------------- moving things (the `translate` property, which adds to
   whatever transform a screen's own animations use, so a screen's way out can play over a swipe without either undoing the
   other) */

function setX(el, css) {
  if (!el) return;
  const value = css ? `${css.toFixed(2)}px 0px` : '';
  if (TRANSLATE) el.style.translate = value; else el.style.transform = css ? `translateX(${css.toFixed(2)}px)` : '';
}
const frameOf = (css) => (TRANSLATE ? { translate: `${css.toFixed(2)}px 0px` } : { transform: `translateX(${css.toFixed(2)}px)` });
function play(el, frames, options) {
  if (!el || !HAS_WAAPI || !el.isConnected) return null;
  try { return el.animate(frames, options); } catch (error) { return null; }
}

/* ---------------------------------------------------------------- the screens a swipe can take back */

const visibleIn = (scope, selector) => [...scope.querySelectorAll(selector)].find(shows) || null;
const fullWidth = (el) => { if (!shows(el)) return false; const r = el.getBoundingClientRect(); return r.width >= innerWidth * 0.95 && r.left <= innerWidth * 0.03; };
const ownBits = (el) => el.classList.contains('g-sb-curtain') || el.classList.contains('nt-strip') || el.classList.contains('g-sb-carry');

/* The highest thing in #layers that takes touches (by z-index, then the later one): a note, a sheet, a menu... */
function layersByHeight() {
  const layers = document.getElementById('layers');
  if (!layers) return [];
  const out = [];
  [...layers.children].forEach((el, i) => {
    if (ownBits(el) || !shows(el)) return;
    const cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none' || cs.display === 'none') return;
    out.push({ el, z: parseInt(cs.zIndex, 10) || 0, i });
  });
  return out.sort((a, b) => (b.z - a.z) || (b.i - a.i)).map((o) => o.el);
}

/* What's under a layer: the next layer down when it covers the screen, else the app (its screen, and the tab bar when the
   layer covers it). */
function underLayer(top) {
  const all = layersByHeight();
  const next = all.slice(all.indexOf(top) + 1).find(fullWidth);
  if (next) return { els: [next], app: false };
  const app = document.getElementById('app');
  const main = app && app.querySelector(':scope > main.view');
  const tabs = app && app.querySelector(':scope > nav.tabs');
  const r = top.getBoundingClientRect();
  const covered = tabs && shows(tabs) && r.bottom >= tabs.getBoundingClientRect().bottom - 1;
  return { els: [main, covered ? tabs : null].filter(Boolean), app: true };
}

function layerScreen(top) {
  if (wide()) return null;
  if (top.matches('.editor-layer')) {
    if (!top.classList.contains('shown') || top.classList.contains('g-leaving') || !fullWidth(top)) return null;
    const back = visibleIn(top, '.editor-bar button.back');
    return back ? { kind: 'note', top, back } : null;
  }
  if (top.matches('.nt-layer')) {
    const hide = visibleIn(top, '.nt-hide');
    return top.classList.contains('shown') && hide && fullWidth(top.querySelector('.nt')) ? { kind: 'notetaker', top, back: hide } : null;
  }
  if (!top.matches('.layer.shown:not(.leaving)')) return null;
  if (top.matches('.study-layer')) {
    const done = visibleIn(top, '.study-done') || [...top.querySelectorAll('.study-end button, .study button')].find((b) => shows(b) && /^\s*Done\s*$/.test(b.textContent || ''));
    return done && fullWidth(top.querySelector('.study') || top) ? { kind: 'study', top, back: done } : null;
  }
  if (top.matches('.help-layer')) {
    const close = visibleIn(top, '.help-close');
    return close && fullWidth(top.querySelector('.help-sheet')) ? { kind: 'help', top, back: close } : null;
  }
  if (top.matches('.ink-layer')) {
    const close = visibleIn(top, '.ink-close');
    return close && fullWidth(top) ? { kind: 'drawing', top, back: close } : null;
  }
  return null;  // (a sheet, a menu, the tour: not a screen of its own)
}

function viewScreen() {
  if (wide() || !V.tab) return null;
  const main = document.querySelector('#app > main.view');
  if (!main || !shows(main)) return null;
  const tab = V.tab();
  if (tab === 'claude') {
    const app = main.querySelector('.chat-app.showing-chat');
    const pane = app && app.querySelector(':scope > .chat-pane');
    const side = app && app.querySelector(':scope > .chat-side');
    const back = app && visibleIn(app, '.chat-head .chat-back');
    return pane && side && back ? { kind: 'chat', top: pane, back, side, app } : null;
  }
  if (tab === 'settings') {
    const page = main.querySelector(':scope > .page.settings-sub, :scope > .page.settings-home');
    const back = page && visibleIn(page, '.app-head .head-back');
    return back ? { kind: page.classList.contains('settings-sub') ? 'settings-page' : 'settings', top: main, back } : null;
  }
  if (tab === 'notes') {
    const column = main.querySelector('.list-column');
    if (!column || column.classList.contains('searching') || main.querySelector('.list.picking')) return null;
    if (V.notes && V.notes.picking && V.notes.picking()) return null;
    const place = column.dataset.place || '';
    const cut = place.indexOf('|');
    const filter = cut < 0 ? place : place.slice(0, cut);
    if (!filter || filter === 'all' || (cut >= 0 && place.slice(cut + 1))) return null;
    const back = visibleIn(main, '.list-title .folder-up') || visibleIn(main, '.chips .chip[data-id="all"]');
    return { kind: 'notes', top: main, back, filter };
  }
  return null;
}

/* The screen a swipe would take back now, or null. */
function current() {
  if (!on() || !document.getElementById('app')) return null;
  const top = layersByHeight()[0] || null;
  if (top) return layerScreen(top);
  return viewScreen();
}

/* ---------------------------------------------------------------- where a swipe may start */

const TEXT = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type=checkbox]):not([type=radio])'
  + ':not([type=button]):not([type=submit]):not([type=reset]):not([type=color]):not([type=file]):not([type=image])';
// things with a sideways use of their own (a swipe starts on them only from the edge)
const SIDEWAYS = 'canvas, .viewer, .flash-card, .share-switch, .ink-stage, [data-g-sideways]';

/* What a finger on `target` is for, sideways: 'native' (the browser's own: text being typed in or picked, a slider, a
   sideways scroller), 'own' (something of Wefty's that moves sideways or takes the finger: a card that swipes, a drawing, a
   flash card, a handle), or '' (nothing: a swipe back may start there). */
function sidewaysUse(target, screen) {
  if (!target || !target.closest) return '';
  const active = document.activeElement;
  // text being typed in (its caret moves and its words scroll under a finger)...
  if (active && active !== document.body && active.matches && active.matches(TEXT) && (active === target || active.contains(target))) return 'native';
  // ...or picked (the selection's handles)
  try {
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount && sel.getRangeAt(0).intersectsNode(target)) return 'native';
  } catch (error) { /* no selection here */ }
  if (target.closest('input[type=range], video, audio')) return 'native';
  const stop = screen.top.parentElement;
  let own = '';
  for (let el = target; el && el !== stop && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(cs.overflowX)) return 'native';  // a sideways scroller
    if (!own && ((el.style && el.style.touchAction === 'pan-y') || cs.touchAction === 'none')) own = 'own';  // (V.motion.swipe's rows; a handle, a drawing)
  }
  if (own || target.closest(SIDEWAYS)) return 'own';
  // Notes' cards that swipe (glass/notes.js: right pins, left moves to the Trash)
  const card = target.closest('button.card[data-id]');
  if (card && card.closest('.list') && !card.closest('.up-row, .list.review, .list.picking') && !/^(trash|review)$/.test(screen.filter || '')) return 'own';
  return '';
}

/* ---------------------------------------------------------------- the gesture */

let g = null;        // the finger: { id, x0, y0, t0, edge, screen, target, trail, claimed, x, ... }
let moving = null;   // what's set up while dragging and settling: { screen, top, under, curtain, W, z, ... }
let settling = 0;    // a swipe let go is still moving
let taking = null;   // a swipe let go and handed over to a screen's own back move: { x, p, at, kind }
let blocker = null;  // swallows taps while a swipe settles
let last = null;     // the last swipe let go: { kind, x, share, speed, goes } (for the tests)

const buzz = () => { if (!ANDROID) return; try { if (navigator.vibrate) navigator.vibrate(8); } catch (error) { /* not allowed here */ } };
const timeOf = (event) => (event && event.timeStamp) || performance.now();

function pointerDown(event) {
  if (event.pointerType !== 'touch' || !event.isPrimary || !on()) return;
  if (g || moving || settling) { if (g) drop(); return; }
  const screen = current();
  if (!screen || !screen.top.contains(event.target)) return;
  const x = event.clientX;
  const left = 0;
  if (IOS && !standalone() && x - left < EDGE) return;  // (an iPhone's Safari tab: its own Back owns the edge)
  const edge = x - left <= (ANDROID ? EDGE_ANDROID : EDGE);
  const use = edge ? '' : sidewaysUse(event.target, screen);
  if (use === 'native') return;  // (the browser's own: it scrolls, or moves a caret)
  // (on something of Wefty's own, a swipe back never starts; a sideways drag there is kept from becoming the browser's own Back,
  // as a flash card, a scroller of its own, would have Chrome go back in history when let go sideways)
  g = { id: event.pointerId, x0: x, y0: event.clientY, t0: timeOf(event), edge, screen, target: event.target, trail: [], claimed: false,
    x: 0, still: true, armed: false, hold: use === 'own', blocking: false, viaTouch: false };
  // The element under the finger may be drawn again while it moves (the note-taker's words are, each time its hearing starts
  // again): the browser then ends the finger's pointer events, but its touch events still go to that element, so they carry
  // the swipe on from there.
  const el = event.target;
  const tm = (ev) => touchOnTarget(ev, 'move');
  const te = (ev) => touchOnTarget(ev, 'end');
  el.addEventListener('touchmove', tm, { passive: false });
  el.addEventListener('touchend', te);
  el.addEventListener('touchcancel', te);
  g.unbind = () => { el.removeEventListener('touchmove', tm); el.removeEventListener('touchend', te); el.removeEventListener('touchcancel', te); };
}

function moveTo(x, y, t, event) {
  const dx = x - g.x0;
  const dy = y - g.y0;
  if (g.hold) {
    if (!g.blocking && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * SLANT) g.blocking = true;
    else if (!g.blocking && Math.abs(dy) > 10) drop();
    return;
  }
  if (!g.claimed) {
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    // (held still first: a long press, whose menu or picking wins)
    if (g.still && t - g.t0 > LONG) { drop(); return; }
    g.still = false;
    if (dx < -6 || Math.abs(dy) > Math.max(10, dx / SLANT)) { drop(); return; }  // (left, or up and down: a scroll)
    if (dx < (g.edge ? EDGE_START : START) || dx < Math.abs(dy) * SLANT) return;
    claim(x, y);
    if (!g) return;
  }
  g.x = Math.max(0, Math.min(moving.W, dx));
  g.trail.push([t, g.x]);
  while (g.trail.length > 2 && t - g.trail[0][0] > 160) g.trail.shift();
  follow(g.x);
  if (event && event.cancelable && event.type === 'touchmove') event.preventDefault();
}

function pointerMove(event) {
  if (!g || event.pointerId !== g.id || g.viaTouch) return;
  moveTo(event.clientX, event.clientY, timeOf(event), null);
}

function pointerUp(event) {
  if (!g || event.pointerId !== g.id || g.viaTouch) return;
  if (!g.claimed) { drop(); return; }
  release(event, false);
}

function pointerCancel(event) {
  if (!event.isTrusted || !g || event.pointerId !== g.id) return;  // (ours, sent to the others, is not for us)
  if (g.target && !g.target.isConnected) { g.viaTouch = true; return; }  // (drawn again under the finger: its touches go on)
  if (!g.claimed) { drop(); return; }
  release(event, true);
}

/* The finger's touch events at the element it went down on (heard even once that element has left the page). */
function touchOnTarget(event, kind) {
  if (!g) return;
  if (kind === 'move') {
    if ((g.claimed || g.blocking) && event.cancelable) event.preventDefault();
    if (!g.viaTouch) return;
    const touch = event.touches && event.touches[0];
    if (touch) moveTo(touch.clientX, touch.clientY, timeOf(event), event);
    return;
  }
  if (!g.viaTouch) return;
  const touch = event.changedTouches && event.changedTouches[0];
  const at = touch ? { clientX: touch.clientX, clientY: touch.clientY, timeStamp: timeOf(event) } : null;
  if (!g.claimed) { drop(); return; }
  release(at, event.type === 'touchcancel');
}

function touchMove(event) {
  // (the page doesn't scroll and nothing else pans: never the browser's own sideways Back over ours)
  if (g && (g.claimed || g.blocking) && event.cancelable) event.preventDefault();
}
function touchStart(event) {
  if (event.touches && event.touches.length > 1 && g) {  // (a second finger: a pinch, never a swipe)
    if (g.claimed) release(null, true); else drop();
  }
}

function drop() {
  if (g && g.unbind) g.unbind();
  g = null;
}

/* The swipe is ours: everything else that heard this finger lets go of it (a card's own swipe, a long press about to pick,
   a pressed button), as if the browser had taken the touch back. */
function letOthersGo(target, id, x, y) {
  if (!target || typeof PointerEvent !== 'function') return;
  try {
    target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: id, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
  } catch (error) { /* an old browser: they finish by themselves */ }
}

function claim(x, y) {
  const screen = current();
  if (!screen || screen.top !== g.screen.top) { drop(); return; }
  g.claimed = true;
  g.screen = screen;
  letOthersGo(g.target, g.id, x, y);
  // (the finger is held by the screen itself, which stays on the page: what was under it may be drawn again meanwhile, the
  // note-taker's words are each second, and a touch whose element went would be taken back by the browser)
  try { screen.top.setPointerCapture(g.id); } catch (error) { /* fine without */ }
  try { const sel = getSelection(); if (sel && !sel.isCollapsed && !g.edge) sel.removeAllRanges(); } catch (error) { /* */ }
  prepare(screen);
}

/* ---------------------------------------------------------------- setting up what moves */

function curtainFor(screen, top, W, z) {
  const el = document.createElement('div');
  el.className = 'g-sb-curtain';
  el.setAttribute('aria-hidden', 'true');
  const r = top.getBoundingClientRect();
  if (screen.kind === 'chat') {
    screen.app.insertBefore(el, screen.top);
  } else if (screen.layer) {
    el.style.top = `${r.top / z}px`;
    el.style.height = `${r.height / z}px`;
    el.style.zIndex = getComputedStyle(top).zIndex;
    top.parentElement.insertBefore(el, top);
  } else {
    // (a screen of the app over the aurora: the curtain is left of the screen and under the tab bar, and over the screen that
    // comes in once the swipe hands over, so that one brightens as it lands)
    const app = document.getElementById('app');
    el.style.top = `${r.top / z}px`;
    el.style.height = `${r.height / z}px`;
    el.style.zIndex = '1';
    app.insertBefore(el, app.firstChild);
  }
  el.style.width = `${W / z}px`;
  return el;
}

function prepare(screen) {
  const z = zoom();
  const top = screen.top;
  const W = top.getBoundingClientRect().width || innerWidth;
  screen.layer = !!top.closest('#layers');
  let under = [];
  if (screen.kind === 'chat') {
    screen.app.classList.add('g-sb-chat');
    under = [screen.side];
  } else if (screen.layer) {
    const found = underLayer(top);
    under = found.els;
    if (found.app && screen.kind === 'notetaker') root.classList.add('g-sb-reveal');  // (the screen under the note-taker, hidden while it shows)
  }
  root.classList.add('g-sb-dragging');
  top.classList.add('g-sb-top');
  for (const el of under) el.classList.add('g-sb-under');
  moving = { screen, top, under, W, z, curtain: curtainFor(screen, top, W, z), anims: [] };
  follow(0);
}

/* Where everything is for a swipe `x` px (screen px) along. */
function stateAt(x) {
  const { W } = moving;
  const p = Math.max(0, Math.min(1, x / W));
  return { top: x, under: calm() ? 0 : -PARALLAX * W * (1 - p), curtainX: x - W, curtain: calm() ? 1 : 1 - p };
}

function follow(x) {
  const m = moving;
  if (!m) return;
  const s = stateAt(x);
  setX(m.top, s.top / m.z);
  for (const el of m.under) setX(el, s.under / m.z);
  setX(m.curtain, s.curtainX / m.z);
  m.curtain.style.opacity = String(s.curtain);
  // (the moment letting go would take it back: a light buzz)
  if (g) {
    const armed = x >= COMMIT * m.W;
    if (armed && !g.armed) buzz();
    g.armed = armed;
  }
}

/* How fast the finger went over its last moves (px a ms, to the right), 0 when it was held still before it lifted. */
function speedAt(trail, now) {
  if (!trail.length || now - trail[trail.length - 1][0] > RECENT) return 0;
  let i = trail.length - 1;
  while (i > 0 && now - trail[i - 1][0] <= RECENT) i--;
  const a = trail[Math.max(0, i - (i === trail.length - 1 ? 1 : 0))];
  const b = trail[trail.length - 1];
  return b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
}

/* ---------------------------------------------------------------- letting go */

function release(event, cancelled) {
  const finger = g;
  if (finger.unbind) finger.unbind();
  g = null;
  const m = moving;
  if (!m) return;
  const now = event ? timeOf(event) : performance.now();
  const v = cancelled ? 0 : speedAt(finger.trail, now);
  const x = finger.x;
  swallowClick(event);
  const goes = !cancelled && x > 0 && (x >= COMMIT * m.W || v > FLICK);
  last = { kind: m.screen.kind, x: Math.round(x), share: +(x / m.W).toFixed(3), speed: +v.toFixed(3), goes };
  block(true);
  if (!goes) { springBack(x, v); return; }
  const kind = m.screen.kind;
  try {
    if (kind === 'note') return noteBack(x, v);
    if (kind === 'chat') return chatBack(x, v);
    if (kind === 'settings' || kind === 'settings-page') return settingsBack(x, v);
    if (kind === 'notes') return notesBack(x, v);
    return layerBack(x, v);
  } catch (error) {
    console.error(error);
    finish();
  }
}

/* The click a lifted swipe may make is not a tap. */
function swallowClick(event) {
  const at = event ? [event.clientX, event.clientY] : null;
  const swallow = (ev) => {
    if (at && Math.hypot(ev.clientX - at[0], ev.clientY - at[1]) > 40) return;
    ev.stopPropagation(); ev.preventDefault(); off();
  };
  const off = () => window.removeEventListener('click', swallow, true);
  window.addEventListener('click', swallow, true);
  setTimeout(off, 350);
}

function block(on_) {
  if (on_) {
    if (blocker) return;
    blocker = document.createElement('div');
    blocker.className = 'g-sb-block';
    blocker.setAttribute('aria-hidden', 'true');
    document.body.appendChild(blocker);
  } else if (blocker) { blocker.remove(); blocker = null; }
}

/* The spring's path for the screen from `x` to `to` (screen px), as frames 1/60 s apart: V.motion's spring (lite: stiffer,
   calm: a short plain slide). Going off to the right it ends as it leaves the screen. */
function pathTo(x, to, v) {
  const W = moving.W;
  if (calm() || !V.motion || !V.motion.springFrames) {
    const n = calm() ? 8 : 14;  // (calm: about 120 ms of plain movement, easing out)
    return Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return x + (to - x) * (1 - (1 - t) * (1 - t)); });
  }
  const values = V.motion.springFrames({ from: x, to, velocity: v, stiffness: lite() ? 832 : 520, damping: lite() ? 47 : 36 });
  const out = [];
  for (const value of values) {
    const at = Math.max(0, Math.min(W, value));
    out.push(at);
    if (to >= W && at >= W) break;  // (off the screen: the rest isn't seen)
  }
  if (out[out.length - 1] !== to && to < W) out[out.length - 1] = to;
  return out;
}

/* Everything moved along `path` (the top screen's x at each frame), together, from the frame now painted. */
function run(path, { top = true, under = true, curtain = true, extra = null } = {}) {
  const m = moving;
  const duration = Math.max(1, (path.length - 1) * (1000 / 60));
  const states = path.map(stateAt);
  const anims = [];
  const options = { duration, easing: 'linear', fill: 'forwards' };
  if (top) anims.push(play(m.top, states.map((s) => frameOf(s.top / m.z)), options));
  if (under) for (const el of m.under) anims.push(play(el, states.map((s) => frameOf(s.under / m.z)), options));
  if (curtain) anims.push(play(m.curtain, states.map((s) => ({ ...frameOf(s.curtainX / m.z), opacity: s.curtain })), options));
  if (extra) anims.push(...extra(states, options));
  const live = anims.filter(Boolean);
  // (where they end: the animations play over it and leave them there, so nothing jumps when they're let go)
  const final = states[states.length - 1];
  if (top) setX(m.top, final.top / m.z);
  if (under) for (const el of m.under) setX(el, final.under / m.z);
  if (curtain) { setX(m.curtain, final.curtainX / m.z); m.curtain.style.opacity = String(final.curtain); }
  const t = document.timeline ? document.timeline.currentTime : null;
  if (t != null) for (const a of live) { try { a.startTime = t; } catch (error) { /* fine */ } }
  m.anims.push(...live);
  return new Promise((resolve) => {
    let over = false;
    const end = () => { if (over) return; over = true; resolve(final); };
    if (!live.length) { end(); return; }
    Promise.all(live.map((a) => a.finished.catch(() => {}))).then(end);
    setTimeout(end, duration + 400);  // (a page out of sight gets no frames)
  });
}

/* Everything put back as it was before the swipe (the screen that went is gone, or back where it was). */
function finish({ keepTop = false } = {}) {
  const m = moving;
  moving = null;
  settling = 0;
  block(false);
  root.classList.remove('g-sb-dragging', 'g-sb-reveal');
  if (!m) return;
  for (const a of m.anims) { try { a.cancel(); } catch (error) { /* gone */ } }
  if (!keepTop) { setX(m.top, 0); m.top.classList.remove('g-sb-top'); }
  for (const el of m.under) { setX(el, 0); el.style.opacity = ''; el.classList.remove('g-sb-under'); }
  if (m.curtain) m.curtain.remove();
  if (m.carry) m.carry.remove();
  if (m.screen.app) m.screen.app.classList.remove('g-sb-chat');
}

/* The screen leaves (or was left) where it is, its own way out playing off the screen: it is let go once it's gone. */
function letGo(top) {
  const gone = () => { setX(top, 0); top.classList.remove('g-sb-top'); };
  if (!top.isConnected) { gone(); return; }
  const watch = new MutationObserver(() => { if (!top.isConnected) { watch.disconnect(); gone(); } });
  watch.observe(top.parentElement || document.body, { childList: true });
  setTimeout(() => { watch.disconnect(); if (top.isConnected) gone(); }, 1500);
}

function springBack(x, v) {
  settling = 1;
  run(pathTo(x, 0, v)).then(() => finish());
}

const stillOpen = (top, kind) => top.isConnected && (kind === 'notetaker' ? top.classList.contains('shown')
  : top.classList.contains('shown') && !top.classList.contains('leaving') && !top.classList.contains('g-leaving'));

/* A layer (the study screen, Help, the note-taker, the drawing; a note whose card isn't in sight): it slides off with the
   finger's speed, the screen under it into place; then its own close is pressed, and its way out plays off the screen. A
   close that asks first (a drawing not saved) springs it back under the question. */
function layerBack(x, v) {
  settling = 1;
  const m = moving;
  run(pathTo(x, m.W, v)).then(() => {
    if (moving !== m) return;
    const { top, back, kind } = m.screen;
    if (back.isConnected) back.click();
    requestAnimationFrame(() => {
      if (moving !== m) return;
      if (stillOpen(top, kind)) {  // (it asked first, or it couldn't go: it comes back)
        m.anims.forEach((a) => { try { a.cancel(); } catch (error) { /* */ } });
        m.anims = [];
        follow(m.W);
        run(pathTo(m.W, 0, 0)).then(() => finish());
        return;
      }
      finish({ keepTop: true });
      letGo(top);
    });
  });
}

/* A note: back into its card when the card is in sight, the way closing it shrinks it (glass/editor.js), from where the finger
   left it: the note's own shrink plays, and this only takes back the part of the way the finger moved it, on the same clock
   and curve. Else it slides off like any layer. */
function noteBack(x, v) {
  const m = moving;
  const id = V.editor && V.editor.openId ? V.editor.openId() : null;
  // (where the card is once the screen under is back in place: that's where the note shrinks to)
  const kept = m.under.map((el) => el.style.translate || el.style.transform);
  for (const el of m.under) setX(el, 0);
  const card = id && !calm() ? [...document.querySelectorAll('button.card[data-id]')].find((c) => c.dataset.id === id && !c.closest('.g-sb-carry')) : null;
  const r = card && card.getClientRects().length ? card.getBoundingClientRect() : null;
  const inSight = r && r.width > 10 && r.height > 10 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  if (!inSight) {
    m.under.forEach((el, i) => { if (TRANSLATE) el.style.translate = kept[i]; else el.style.transform = kept[i]; });
    layerBack(x, v);
    return;
  }
  settling = 1;
  const top = m.top;
  const from = stateAt(x);
  m.screen.back.click();
  if (!top.classList.contains('g-window') && !top.classList.contains('g-growing')) {
    // (it didn't take the card's way after all: slide it off)
    for (const el of m.under) setX(el, from.under / m.z);
    finish({ keepTop: true });
    letGo(top);
    return;
  }
  const shrink = top.getAnimations().find((a) => a.effect && a.effect.getKeyframes && a.effect.getKeyframes().some((k) => k.transform && k.transform !== 'none'));
  const timing = shrink && shrink.effect.getTiming ? shrink.effect.getTiming() : {};
  const duration = Number(timing.duration) || 440;
  const easing = timing.easing || 'cubic-bezier(.3,.9,.3,1)';
  setX(top, 0);
  for (const el of m.under) setX(el, 0);
  const anims = [
    play(top, [frameOf(x / m.z), frameOf(0)], { duration, easing, fill: 'forwards' }),
    ...m.under.map((el) => play(el, [frameOf(from.under / m.z), frameOf(0)], { duration, easing, fill: 'forwards' })),
    play(m.curtain, [{ ...frameOf(from.curtainX / m.z), opacity: from.curtain }, { ...frameOf(-m.W / m.z), opacity: 0 }], { duration: duration * 0.6, easing, fill: 'forwards' }),
  ].filter(Boolean);
  m.anims.push(...anims);
  const done = () => { if (moving === m) { finish({ keepTop: true }); letGo(top); } };
  Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(done);
  setTimeout(done, duration + 500);
}

/* A chat: its list is there already (only hidden on a phone): the chat slides off, the list into place. Its back arrow is
   pressed at once; the list's own slide-in (glass/chat.js) isn't played, as both stay on the page until the move ends. */
function chatBack(x, v) {
  settling = 1;
  const m = moving;
  m.screen.back.click();
  run(pathTo(x, m.W, v)).then(() => { if (moving === m) finish(); });
}

/* Settings (a page back to its home, or Settings back to the tab it came from): what's under isn't in the page, so the
   aurora showed; the back arrow is pressed now, and glass/settings.js's carousel (the screen that goes, the one that
   comes, a screen's width apart) starts from where the finger left it (V.swipeBack.taken()). Calm and lite: its own short
   way, from there. */
function settingsBack(x, v) {
  settling = 1;
  const m = moving;
  taking = { x, p: Math.max(0, Math.min(0.98, x / m.W)), at: performance.now(), kind: m.screen.kind, v };
  m.handed = false;
  m.screen.back.click();
  setTimeout(() => {
    if (moving !== m || m.handed) return;
    taking = null;  // (the arrow did nothing after all: it comes back)
    springBack(x, 0);
  }, 1200);
}
function handOver() {
  const m = moving;
  if (!m || !taking || !/^settings/.test(taking.kind) || m.handed) return null;
  m.handed = true;
  setX(m.top, 0);  // (the screen that goes is a picture now, where it was: glass/settings.js measured it)
  m.top.classList.remove('g-sb-top');
  return m;
}
V.on('settings-leaving', () => { handOver(); });
V.on('screen-leaving', ({ was } = {}) => { if (was === 'settings') handOver(); });
function carouselEnded(ms) {
  const m = moving;
  if (!m || !m.handed || !taking) return;
  const from = taking;
  taking = null;
  const moved = !calm() && !lite() && document.querySelector('.g-set-ghost, .g-set-carry');
  const time = moved ? ms : 120;
  // (the curtain's edge goes with the screen that leaves, and fades: the screen that comes in is undimmed as it lands)
  const a = play(m.curtain, [{ ...frameOf((from.x - m.W) / m.z), opacity: Number(m.curtain.style.opacity) || 0 },
    { ...frameOf(moved ? 0 : (from.x - m.W) / m.z), opacity: 0 }], { duration: time, easing: moved ? CAROUSEL : 'linear', fill: 'forwards' });
  if (a) m.anims.push(a);
  setTimeout(() => { if (moving === m) finish({ keepTop: true }); }, time + 40);
}
V.on('settings-drawn', () => carouselEnded(460));
V.on('tab', () => carouselEnded(470));

/* Notes' inner lists: all your notes (or the folder above) isn't in the page, so the aurora showed. A picture of the list
   that goes is kept where the finger left it, the back arrow (or All) is pressed, and the list that comes slides in from the
   left and brightens as the picture slides off, on one spring (glass/notes.js's rise plays on its rows as usual). */
function notesBack(x, v) {
  const m = moving;
  const main = m.top;
  if (!m.screen.back) { springBack(x, 0); return; }
  settling = 1;
  m.carry = carry(main, x);
  setX(main, 0);
  main.classList.remove('g-sb-top');
  // (the curtain goes between the list that comes and the picture that goes)
  m.carry.parentElement.insertBefore(m.curtain, m.carry);
  m.curtain.style.zIndex = '1';
  m.screen.back.click();
  // the picture is now what moves; the screen itself comes in from under it
  const picture = m.carry;
  const comes = main;
  m.top = picture;
  m.under = [comes];
  comes.classList.add('g-sb-under');
  const start = x;
  const span = Math.max(1, m.W - start);
  run(pathTo(x, m.W, v), {
    extra: (states, options) => [play(comes, states.map((s) => ({ opacity: Math.min(1, ((s.top - start) / span) * 2.4) })), options)],
  }).then(() => { if (moving === m) finish(); });
}

/* A still picture of a screen (its children copied, scrolled where they were; no ids, nothing that can be reached), where it
   is now, on top of it. */
function carry(main, x) {
  const z = moving.z;
  const r = main.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'g-sb-carry';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, { left: `${(r.left - x) / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`, height: `${r.height / z}px` });
  const holder = document.createElement('div');
  holder.className = main.className;
  holder.classList.remove('g-sb-top', 'g-sb-under');
  for (const [k, value] of Object.entries(main.dataset)) holder.dataset[k] = value;
  holder.style.cssText = 'position:absolute;inset:0;overflow:hidden;';
  const scrolled = [];
  for (const child of main.children) {
    if (child.nodeType !== 1 || child.hidden) continue;
    const copy = child.cloneNode(true);
    const from = [child, ...child.querySelectorAll('*')];
    const to = [copy, ...copy.querySelectorAll('*')];
    from.forEach((el, i) => { if ((el.scrollTop || el.scrollLeft) && to[i]) scrolled.push([to[i], el.scrollTop, el.scrollLeft]); });
    for (const el of to) {
      el.removeAttribute('id');
      if (el.dataset && el.dataset.id) { el.dataset.gId = el.dataset.id; delete el.dataset.id; }
      if (el.matches && el.matches('input, textarea, button, select, a')) el.tabIndex = -1;
    }
    holder.append(copy);
  }
  ghost.append(holder);
  main.after(ghost);
  for (const [el, top, left] of scrolled) { el.scrollTop = top; el.scrollLeft = left; }
  holder.scrollTop = main.scrollTop;
  setX(ghost, x / z);
  return ghost;
}

/* ---------------------------------------------------------------- wiring */

window.addEventListener('pointerdown', pointerDown, true);
window.addEventListener('pointermove', pointerMove, true);
window.addEventListener('pointerup', pointerUp, true);
window.addEventListener('pointercancel', pointerCancel, true);
window.addEventListener('touchstart', touchStart, { capture: true, passive: true });
window.addEventListener('touchmove', touchMove, { capture: true, passive: false });
const away = () => { if (g && g.claimed) release(null, true); else drop(); };
window.addEventListener('blur', away);
document.addEventListener('visibilitychange', () => { if (document.hidden) away(); });
V.on('look', () => {
  if (on()) return;
  drop();
  taking = null;
  if (moving) finish();
});

V.swipeBack = {
  taken: () => (taking && performance.now() - taking.at < 1500 ? { x: taking.x, p: taking.p } : null),
  screen: () => { const s = current(); return s ? s.kind : ''; },
  busy: () => !!(moving || (g && g.claimed)),
  last: () => last,
};
})();
