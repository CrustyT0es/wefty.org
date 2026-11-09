/* Wefty 2.0 "glass", area: Overlays. This file belongs to the Overlays builder; nobody else edits it.
   What floats over the app (util.js's V.sheet, V.menu, V.toast, V.confirm, the news pop-ups, the home screen popup): sheets, menus, toasts and dialogs beyond the generic look glass.css gives them.
   Rules (vault/web/glass/README.md has the rest): everything here is inert unless V.look.isGlass() (and listen to V.on('look') so the switch works live); use the tokens in
   glass.css (--g-*, and the app's own names, which glass redefines); only transform and opacity animate; call
   V.motion's helpers instead of writing your own; nothing here changes the classic look.

   What this file does (util.js and the other modules are not touched: everything is put on from outside, only while the
   glass look is on, and taken off again when it is switched off):
     - sheets (V.sheet, V.confirm, V.ask and every .layer holding a .sheet): the rows inside rise in one after the other
       (V.motion.enter); on a phone a handle at the top (and the title row) can be pulled down: the sheet follows the finger,
       past a distance or with a flick it goes, below that it springs back; Tab stays inside the open sheet;
     - menus (V.menu, so V.contextMenu and the profile menu too): the menu pops out of the thing that opened it, scaling from
       where it was opened, and its items come in one after the other;
     - toasts: they rise with a spring, and swipe away sideways (V.motion.swipe); an error that needs more than a line
       (it has a Help button or another button, or is long) is shown as the message card, V.messageCard: an icon chip, a bold
       first line, one plain sentence, one purple button and a close mark. The error's own words are never changed;
     - segmented controls inside overlays get the board's sliding highlight, and ticked boxes pop (V.overlays.segmented(el)
       does the same for any other .segmented);
   V.messageCard({ icon, title, text, action: { label, onClick }, secondary: { label, onClick }, onClose, kind, ms }) returns
   { el, close() }; it works with the classic look too (the card is then unstyled, so only glass code calls it). */
'use strict';

(() => {
const V = window.V;
if (!V) return;
const root = document.documentElement;
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const SLIDE = 'cubic-bezier(.25,1.18,.35,1)';
const SPRING = 'cubic-bezier(.34,1.45,.64,1)';
const EXIT = 'cubic-bezier(.5,0,.8,.4)';
const HAS_WAAPI = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

const on = () => !!(V.look && V.look.isGlass());
const calm = () => root.classList.contains('calm');
const lite = () => root.classList.contains('lite');
const quick = () => calm() || lite();
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const phone = () => { try { return window.matchMedia('(max-width: 699px)').matches; } catch (error) { return false; } };

/* One running animation per element and job: a new one cancels the old (so everything can start again at once). */
const running = new WeakMap();
function play(el, keyframes, options, job = 'overlay') {
  if (!el || !HAS_WAAPI) return null;
  const jobs = running.get(el) || {};
  running.set(el, jobs);
  if (jobs[job]) { try { jobs[job].cancel(); } catch (error) { /* gone */ } }
  let animation = null;
  try { animation = el.animate(keyframes, options); } catch (error) { return null; }
  jobs[job] = animation;
  animation.finished.then(() => { if (jobs[job] === animation) delete jobs[job]; }, () => {});
  return animation;
}

/* ================================================================== the message card */

/* The Help card an error belongs to (js/help.js's V.help.forError says which): the card's first line and its icon. Only
   what is shown over the error's own sentence, which is never changed. */
const CARDS = {
  'storage-full': ['Storage full', 'file'],
  'sign-in-check': ['Sign-in check', 'lock'],
  move: ['Move to wefty.org', 'alert'],
  gemini: ['Gemini key', 'key'],
  'ai-trouble': ['AI unavailable', 'spark'],
  notifications: ['Notifications', 'bell'],
  'too-big': ['Note too big', 'cloud'],
  asleep: ['Cloud asleep', 'cloud'],
  'signed-out': ['Signed out', 'lock'],
  'forgot-password': ['Sign-in', 'key'],
  offline: ['Offline', 'cloud'],
  update: ['Update needed', 'download'],
};
const PLAIN_TITLE = 'Something went wrong';
/* Cards that say where things stand rather than that something broke: amber, with no red flash of the edge light. */
const WARN = new Set(['offline', 'asleep', 'too-big', 'signed-out', 'update']);

function messageCard({ icon = 'alert', title = '', text = '', action = null, secondary = null, onClose = null, kind = 'err', ms = 6500 } = {}) {
  const box = document.getElementById('toasts');
  if (!box) return null;
  let closed = false;
  let timer = 0;
  let held = false;
  const wait = () => { clearTimeout(timer); if (!held && !closed) timer = setTimeout(() => close(), ms); };
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
    if (onClose) { try { onClose(); } catch (error) { console.error(error); } }
  }
  const button = (spec, cls) => V.h('button.toast-action.' + cls + (spec.help && !cls.includes('toast-help') ? '.toast-help' : ''), {
    type: 'button', text: spec.label,
    onclick: () => { try { if (spec.onClick) spec.onClick(); } finally { close(); } },
  });
  const actions = [];
  if (action && action.label) actions.push(button(action, 'mc-go'));
  if (secondary && secondary.label) actions.push(button(secondary, actions.length ? 'toast-help.mc-more' : 'mc-go.toast-help'));
  const el = V.h('div.toast.msg-card' + (kind === 'err' || kind === 'warn' ? '.err' : '') + (kind === 'warn' ? '.warn' : ''), { role: 'status' },
    V.h('span.mc-chip', {}, V.icon(icon)),
    V.h('div.mc-body', {},
      title ? V.h('strong.mc-title', { text: title }) : null,
      V.h('span.mc-text', { text }),
      actions.length ? V.h('div.mc-actions', {}, actions) : null),
    V.iconButton('x', 'Close', () => close(), 'quiet.mc-x'));
  el.addEventListener('mouseenter', () => { held = true; clearTimeout(timer); });
  el.addEventListener('mouseleave', () => { held = el.contains(document.activeElement); wait(); });
  el.addEventListener('focusin', () => { held = true; clearTimeout(timer); });
  el.addEventListener('focusout', (event) => { if (!el.contains(event.relatedTarget)) { held = el.matches(':hover'); wait(); } });
  box.append(el);
  const all = box.querySelectorAll(':scope > .toast');  // (three at most, as V.toast keeps)
  for (let i = 0; i < all.length - 3; i++) all[i].remove();
  wait();
  if (kind === 'err') V.emit('edge', 'error');  // (the edge light's soft red flash, once; nothing listens in classic. A warning has none)
  return { el, close };
}
V.messageCard = messageCard;

/* V.toast: an error toast that needs more than a line becomes the message card. The rest are the app's own toasts. */
const plainToast = V.toast;
V.toast = function toast(text, options = {}) {
  const o = options || {};
  const helps = !!o.help && !!(V.help && V.help.open);
  if (on() && o.kind === 'err' && typeof text === 'string' && (helps || o.action || text.length > 60)) {
    try {
      const [title, icon] = (helps && CARDS[o.help]) || [PLAIN_TITLE, 'alert'];
      const helpSpec = helps ? { label: 'Help', help: true, onClick: () => V.help.open({ card: o.help }) } : null;
      const own = o.action ? { label: o.action, onClick: o.onAction } : null;
      messageCard({ icon, title, text, action: own || helpSpec, secondary: own ? helpSpec : null,
        kind: helps && WARN.has(o.help) ? 'warn' : 'err', ms: Math.max(Number(o.ms) || 0, 6500) });
      return undefined;
    } catch (error) { console.error(error); }
  }
  return plainToast.call(this, text, options);
};

/* ================================================================== menus */

const plainMenu = V.menu;
V.menu = function menu(anchor, items, options) {
  const handle = plainMenu.call(this, anchor, items, options);
  if (on() && handle && handle.el && handle.el.isConnected) {
    try { pop(handle.el, anchor, options || {}); } catch (error) { console.error(error); }
  }
  return handle;
};

/* The menu comes out of where it was opened: scaled from the anchor's middle (or the pointer), with its items coming in a
   little after one another. (WAAPI, played after util.js has measured and placed the menu: a CSS animation's first frame
   would be a smaller menu to measure.) */
function pop(list, anchor, options) {
  const rect = list.getBoundingClientRect();
  const zoom = list.offsetWidth ? rect.width / list.offsetWidth || 1 : 1;
  let x = rect.left + rect.width / 2;
  let y = rect.top;
  if (options.at) { x = options.at.x; y = options.at.y; }
  else if (anchor && anchor.getBoundingClientRect) {
    const a = anchor.getBoundingClientRect();
    x = a.left + a.width / 2; y = a.top + a.height / 2;
  }
  list.style.transition = 'none';  // (lite and calm give everything a short transition: the origin must not glide there)
  list.style.transformOrigin = `${clamp((x - rect.left) / zoom, 0, list.offsetWidth)}px ${clamp((y - rect.top) / zoom, 0, list.offsetHeight)}px`;
  if (!HAS_WAAPI) return;
  list.classList.add('g-popping');
  const gone = () => list.classList.remove('g-popping');
  if (calm()) {
    const a = play(list, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: 'backwards' }, 'menu');
    if (a) a.finished.then(gone, gone); else gone();
    return;
  }
  const a = play(list, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }],
    { duration: lite() ? 140 : 320, easing: lite() ? 'ease-out' : SPRING, fill: 'backwards' }, 'menu');
  if (a) a.finished.then(gone, gone); else gone();
  if (lite()) return;
  [...list.children].filter((child) => child.classList.contains('menu-item')).slice(0, 8).forEach((item, i) => {
    play(item, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 300, delay: 50 + i * 24, easing: EASE, fill: 'backwards' }, 'rise');
  });
}

/* ================================================================== sheets */

const seen = new WeakSet();
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function decorate(layer) {
  if (!on() || !layer || layer.nodeType !== 1 || !layer.classList.contains('layer') || layer.classList.contains('menu-layer')) return;
  const sheet = layer.querySelector(':scope > .sheet');
  if (!sheet || seen.has(sheet)) return;
  seen.add(sheet);
  const grab = document.createElement('div');
  grab.className = 'g-grab';
  grab.setAttribute('aria-hidden', 'true');
  sheet.prepend(grab);
  pullDown(layer, sheet, grab);
  // the rows rise in, after the sheet has begun to come up (the board's .si)
  const body = sheet.querySelector(':scope > .sheet-body');
  if (body && V.motion && V.motion.enter) {
    // (a sheet whose content is one wrapper holding the rows rises row by row too, not as a single block)
    const only = body.children.length === 1 ? body.firstElementChild : null;
    const rows = only && only.tagName === 'DIV' && !only.className && only.children.length > 1 ? only : body;
    V.motion.enter(rows, { stagger: 40, max: 8, delay: 90 });
  }
  for (const seg of sheet.querySelectorAll('.segmented')) segmented(seg);
}

/* A phone's sheet goes with the finger: pull the handle (or the title row) down. A long pull, or a quick flick, closes it;
   anything less springs it back. A sheet that can't be dismissed (V.sheet's dismissable: false) just springs back. */
function pullDown(layer, sheet, grab) {
  const handles = [grab, sheet.querySelector(':scope > .sheet-head')].filter(Boolean);
  let g = null;
  let swallow = null;
  const settle = () => {
    sheet.classList.remove('g-dragging');
    sheet.style.transition = ''; sheet.style.transform = ''; sheet.style.willChange = '';
  };
  const down = (event) => {
    if (g || !on() || !phone() || (event.pointerType === 'mouse' && event.button > 0)) return;
    g = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: 'wait', dy: 0, last: [] };
  };
  const move = (event) => {
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (g.mode === 'wait') {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { g.mode = 'none'; return; }
      g.mode = 'drag';
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* fine without */ }
      sheet.classList.add('g-dragging');
      sheet.style.transition = 'none';
    }
    if (g.mode !== 'drag') return;
    g.dy = dy;
    // up: a little give, as if the sheet is held by a band; down: with the finger
    const y = dy >= 0 ? dy : -Math.min(14, Math.sqrt(-dy) * 2.2);
    sheet.style.transform = `translateY(${y.toFixed(1)}px)`;
    g.last.push([performance.now(), dy]);
    if (g.last.length > 6) g.last.shift();
  };
  const end = (event, cancelled) => {
    if (!g || (event && event.pointerId !== g.id)) return;
    const was = g;
    g = null;
    if (was.mode !== 'drag') return;
    // (the click that ends a drag is not a tap)
    const drop = () => { window.removeEventListener('click', swallow, true); swallow = null; };
    if (swallow) drop();
    swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); drop(); };
    window.addEventListener('click', swallow, true);
    setTimeout(() => { if (swallow) drop(); }, 350);
    const first = was.last[0], last = was.last[was.last.length - 1];
    const speed = first && last && last[0] > first[0] ? (last[1] - first[1]) / (last[0] - first[0]) : 0;  // px per ms
    const far = Math.min(150, sheet.offsetHeight * 0.3);
    if (!cancelled && (was.dy > far || (speed > 0.55 && was.dy > 28))) {
      sheet.style.transition = `transform ${quick() ? '.12s' : '.22s'} ${EXIT}`;
      sheet.style.transform = `translateY(${layer.clientHeight}px)`;
      layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));  // (V.sheet closes on a press on its scrim)
      setTimeout(() => {
        if (layer.isConnected && !layer.classList.contains('leaving')) back();
      }, 80);
    } else back();
  };
  function back() {
    sheet.style.transition = quick() ? 'transform .14s ease-out' : `transform .46s ${SLIDE}`;
    sheet.style.transform = 'translateY(0px)';
    setTimeout(settle, quick() ? 160 : 500);
  }
  for (const handle of handles) {
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', (event) => end(event, false));
    handle.addEventListener('pointercancel', (event) => end(event, true));
  }
}

/* Tab stays inside the open sheet (a dialog must not let the keyboard wander into the page behind it). The topmost sheet;
   a menu above it, or a sheet that traps the keyboard itself (Help), is left to do its own. */
document.addEventListener('keydown', (event) => {
  if (!on() || event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
  const layers = document.querySelectorAll('#layers > .layer:not(.leaving)');
  const top = layers[layers.length - 1];
  if (!top || top.classList.contains('menu-layer')) return;
  const panel = top.querySelector(':scope > .sheet');
  if (!panel) return;
  const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length && !el.closest('[inert]'));
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  const outside = !panel.contains(document.activeElement);
  if (outside) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus(); return; }
  if (event.shiftKey && at <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
  else if (!event.shiftKey && at === items.length - 1) { event.preventDefault(); items[0].focus(); }
});

/* ================================================================== toasts: swipe them away */

const swiping = new WeakSet();
function swipeAway(item) {
  if (!on() || calm() || !item || item.nodeType !== 1 || swiping.has(item) || !V.motion || !V.motion.swipe) return;
  if (!item.classList.contains('toast') && !item.classList.contains('notice')) return;
  swiping.add(item);
  V.motion.swipe(item, {
    left: true, right: true, card: item, threshold: 70,
    onCommit: () => {
      // a card from V.notice has its own close (its onClose runs); a toast simply goes
      const x = item.classList.contains('notice') ? item.querySelector(':scope > .icon-btn') : null;
      if (x) x.click(); else item.remove();
    },
  });
}

/* ================================================================== segmented controls: the sliding highlight */

const segs = new WeakMap();
function segmented(seg) {
  if (!on() || !seg || seg.nodeType !== 1 || segs.has(seg) || !seg.classList.contains('segmented')) return;
  const hl = document.createElement('span');
  hl.className = 'g-seg-hl g-still';
  hl.setAttribute('aria-hidden', 'true');
  hl.appendChild(document.createElement('i'));
  seg.classList.add('g-seg');
  seg.prepend(hl);
  const state = { hl, last: '', flip: 0, observer: null, resize: null };
  segs.set(seg, state);
  const picked = () => [...seg.children].find((b) => b.tagName === 'BUTTON'
    && (b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true' || b.classList.contains('on')));
  const place = (still) => {
    const b = picked();
    if (!b || !b.offsetWidth) { hl.style.opacity = '0'; return; }
    hl.style.opacity = '';
    const key = [b.offsetLeft, b.offsetTop, b.offsetWidth, b.offsetHeight].join();
    if (key === state.last) return;
    const first = !state.last;
    state.last = key;
    hl.style.width = b.offsetWidth + 'px';
    hl.style.height = b.offsetHeight + 'px';
    if (still || first) hl.classList.add('g-still'); else hl.classList.remove('g-still');
    hl.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    if (still || first) {
      requestAnimationFrame(() => requestAnimationFrame(() => hl.classList.remove('g-still')));
    } else {
      state.flip ^= 1;  // (the little stretch can start again at once)
      hl.classList.remove('g-sa', 'g-sb');
      void hl.offsetWidth;
      hl.classList.add(state.flip ? 'g-sa' : 'g-sb');
    }
  };
  state.place = place;
  state.observer = new MutationObserver((records) => {
    if (records.every((r) => r.target === hl || hl.contains(r.target))) return;
    if (!seg.contains(hl)) seg.prepend(hl);
    place(false);
  });
  state.observer.observe(seg, { attributes: true, attributeFilter: ['aria-checked', 'aria-selected', 'class'], subtree: true, childList: true });
  if (typeof ResizeObserver !== 'undefined') {
    state.resize = new ResizeObserver(() => { state.last = ''; place(true); });
    state.resize.observe(seg);
  }
  place(true);
}
V.overlays = { segmented, messageCard };

/* ================================================================== ticked boxes pop */

document.addEventListener('change', (event) => {
  const box = event.target;
  if (!on() || !box || box.tagName !== 'INPUT' || box.type !== 'checkbox' || !box.matches('.covers-tick, .nt-never-box, input[name="terms"]')) return;
  if (box.checked && V.motion && V.motion.press) V.motion.press(box, { scale: 0.86 });
});

/* ================================================================== start and stop */

let watchers = null;
function start() {
  if (watchers) return;
  const layers = document.getElementById('layers');
  const toasts = document.getElementById('toasts');
  if (!layers || !toasts) return;
  const layerWatch = new MutationObserver((records) => {
    if (!on()) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (record.target === layers) decorate(node);
        else {
          if (node.classList.contains('segmented')) segmented(node);
          for (const seg of node.querySelectorAll ? node.querySelectorAll('.segmented') : []) segmented(seg);
        }
      }
    }
  });
  layerWatch.observe(layers, { childList: true, subtree: true });
  const toastWatch = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) swipeAway(node);
  });
  toastWatch.observe(toasts, { childList: true });
  watchers = { layerWatch, toastWatch };
  for (const layer of layers.children) decorate(layer);
  for (const item of toasts.children) swipeAway(item);
}

/* The look switched off: everything this file put on goes again (an open sheet is left as the classic look draws it). */
function remove() {
  for (const el of document.querySelectorAll('.g-grab, .g-seg-hl')) el.remove();
  for (const el of document.querySelectorAll('.segmented.g-seg')) {
    const state = segs.get(el);
    if (state) { state.observer.disconnect(); if (state.resize) state.resize.disconnect(); }
    segs.delete(el);
    el.classList.remove('g-seg');
  }
  for (const el of document.querySelectorAll('#layers .sheet.g-dragging')) { el.classList.remove('g-dragging'); el.style.transition = ''; el.style.transform = ''; }
  for (const el of document.querySelectorAll('.menu')) el.style.transformOrigin = '';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
V.on('look', () => { if (!on()) remove(); });
})();
