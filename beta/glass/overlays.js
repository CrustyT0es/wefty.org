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
  // ---- round-2 fixes (the fixer's block): the same words again (two to-dos ticked quickly: "Nice, done." twice) take the
  // place of the toast already showing them, so there is one toast, and its Undo is the latest one's
  if (on() && typeof text === 'string') {
    const box = document.getElementById('toasts');
    const same = box ? [...box.querySelectorAll(':scope > .toast:not(.leaving):not(.msg-card)')]
      .filter((t) => { const words = t.querySelector(':scope > span'); return words && words.textContent === text; }) : [];
    same.forEach((t) => t.remove());
  }
  // ---- end of the round-2 fixes block
  return plainToast.call(this, text, options);
};

/* ================================================================== menus */

const plainMenu = V.menu;
/* ---- the 2.0 hotfix (the owner's + More, opened while typing a note: the menu came up at the top of the screen, far from
   its button, its first tile in a heavy ring). What happened: the menu took the keyboard's focus from the note for its first
   item, so the phone's keyboard went away and the screen grew, leaving the menu where it had been placed above the keyboard.
   In glass a menu opened by a finger or the mouse lights nothing (V.menu's `pointer`: the menu itself has the keyboard), and
   while a text field is being typed in, the menu doesn't take its focus at all: the caret stays, the keyboard stays, and the
   menu is placed above it; Esc and a tap beside it still close it, and the caret is where it was. Opened from the keyboard
   (Tab or the arrows used, a key, a click a key made) it is as before: its first item has the keyboard, with a ring. A menu
   follows its button when the screen changes size (the keyboard coming or going). */
const ENTRY = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color]):not([type=file])';
function byKeyboard() {
  if (root.classList.contains('g-kbd')) return true;
  const ev = window.event;
  if (!ev) return false;
  if (/^key/.test(ev.type)) return true;
  // (a click a key made: Enter or Space on a button; Chrome's clicks are pointer events, with no pointer type then)
  return ev.type === 'click' && (ev.pointerType === '' || (ev.pointerType === undefined && ev.detail === 0));
}
V.menu = function menu(anchor, items, options) {
  if (!on()) return plainMenu.call(this, anchor, items, options);
  const opts = { ...(options || {}) };
  const keyed = byKeyboard();
  const active = document.activeElement;
  const field = !keyed && active && active !== document.body && active.matches && active.matches(ENTRY)
    && !active.disabled && !active.readOnly && !active.closest('.menu') ? active : null;
  let handle;
  if (!keyed) {
    opts.pointer = true;
    if (field) {
      opts.returnFocus = false;
      const theirs = opts.onClose;
      opts.onClose = (how) => {
        // (closed beside it or by Esc: the typing carries on where it was; a tool picked looks after the caret itself)
        const now = document.activeElement;
        if (how !== 'item' && field.isConnected && (!now || now === document.body || now === anchor)) {
          try { field.focus({ preventScroll: true }); } catch (error) { /* gone */ }
        }
        if (theirs) theirs(how);
      };
      // (nothing in the menu takes the focus while it opens: the field keeps it, so the keyboard never goes)
      const focus = HTMLElement.prototype.focus;
      HTMLElement.prototype.focus = function focusOutsideMenus(o) {
        if (this.closest && this.closest('.menu')) return undefined;
        return focus.call(this, o);
      };
      try { handle = plainMenu.call(this, anchor, items, opts); } finally { HTMLElement.prototype.focus = focus; }
    }
  }
  if (!handle) handle = plainMenu.call(this, anchor, items, opts);
  if (handle && handle.el && handle.el.isConnected) {
    const placed = place(handle.el, anchor, opts);
    try { pop(handle.el, anchor, opts); } catch (error) { console.error(error); }
    openMenus.add({ handle, anchor, at: opts.at || null, placed });
    goesSoftly(handle.el);
  }
  return handle;
};

/* Where a menu goes in glass. The editor's + More comes out of its button just above the floating tools strip (the note's
   words stay in sight over it), as wide as the strip (a tray of two rows of tiles, glass/editor.css), never over the strip.
   Any other menu stays where util.js put it; `placed` says how to put it back by its button after the screen changes size. */
function place(list, anchor, opts) {
  if (!anchor || !anchor.getBoundingClientRect || opts.at) return null;
  const zoom = list.offsetWidth ? list.getBoundingClientRect().width / list.offsetWidth || 1 : 1;
  const strip = anchor.closest && anchor.closest('.editor-tools');
  if (strip && list.classList.contains('tools-more-menu')) {
    const s = strip.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const width = Math.min(s.width, 460 * zoom);
    const left = Math.max(s.left, Math.min(s.right - width, a.left + a.width / 2 - width / 2));
    list.style.width = `${width / zoom}px`;
    list.style.maxWidth = 'none';
    list.style.left = `${left / zoom}px`;
    // (a short screen, the keyboard up and bigger text: the tray keeps above the strip and its tiles scroll)
    const room = (s.top - 8) / zoom - 8;
    list.style.maxHeight = `${Math.max(120, room)}px`;
    list.style.overflowY = 'auto';
    list.style.top = `${Math.max(8, (s.top - 8) / zoom - list.offsetHeight)}px`;
    return 'strip';
  }
  const r = list.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  return r.bottom <= a.top + 1 ? 'above' : r.top >= a.bottom - 1 ? 'below' : null;
}
/* The screen changed size (the keyboard came or went, the phone turned): each open menu goes back by its button. */
function replace() {
  if (!on()) return;
  for (const entry of openMenus) {
    const { handle, anchor, placed } = entry;
    const list = handle.el;
    if (!list.isConnected || !placed || !anchor || !anchor.isConnected || !anchor.getClientRects().length) continue;
    if (placed === 'strip') { place(list, anchor, {}); continue; }
    const zoom = list.offsetWidth ? list.getBoundingClientRect().width / list.offsetWidth || 1 : 1;
    const a = anchor.getBoundingClientRect();
    const height = list.offsetHeight;
    const top = placed === 'above' ? a.top / zoom - height - 4 : a.bottom / zoom + 4;
    list.style.top = `${Math.max(8, Math.min(top, window.innerHeight / zoom - height - 8))}px`;
  }
}
window.addEventListener('resize', replace);
if (window.visualViewport) window.visualViewport.addEventListener('resize', replace);

/* ---- the 2.0 hotfix: a menu that closes goes quickly and softly from where it is (it shrinks a little towards where it came
   from and fades, 130 ms, quicker than it came) instead of vanishing; another menu opened meanwhile pops at once beside it.
   What goes is a copy in the menu's own look (its colours, corners and rows read from it as it closes), never the menu: the
   real one is gone at once, so nothing can be pressed on it, and nothing looks for it. */
const MENU_LOOK = ['backgroundColor', 'backgroundImage', 'borderRadius', 'boxShadow', 'padding', 'color', 'font', 'transformOrigin'];
const ITEM_LOOK = ['display', 'alignItems', 'justifyContent', 'gap', 'padding', 'minHeight', 'height', 'width', 'boxSizing', 'font',
  'color', 'borderRadius', 'backgroundColor', 'textAlign', 'whiteSpace', 'margin', 'opacity'];
function copyLook(from, to, props) {
  const style = getComputedStyle(from);
  for (const prop of props) to.style[prop] = style[prop];
}
function goesSoftly(list) {
  const wrap = list && list.parentElement;
  if (!wrap || wrap.dataset.gSoft) return;
  wrap.dataset.gSoft = '1';
  const remove = wrap.remove.bind(wrap);
  wrap.remove = () => {
    try { if (on() && !calm() && HAS_WAAPI && list.isConnected && list.getClientRects().length) leaving(list); } catch (error) { /* it simply goes */ }
    remove();
  };
}
function leaving(list) {
  const z = list.offsetWidth ? list.getBoundingClientRect().width / list.offsetWidth || 1 : 1;
  const r = list.getBoundingClientRect();
  const copy = document.createElement('div');
  copy.className = 'g-menu-going';
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copyLook(list, copy, MENU_LOOK);
  Object.assign(copy.style, { position: 'fixed', left: `${r.left / z}px`, top: `${r.top / z}px`, width: `${r.width / z}px`,
    height: `${r.height / z}px`, margin: '0', zIndex: '61', pointerEvents: 'none', overflow: 'hidden', boxSizing: 'border-box' });
  for (const child of list.children) {
    const row = document.createElement('div');
    copyLook(child, row, ITEM_LOOK);
    for (const part of child.childNodes) row.appendChild(part.cloneNode(true));
    row.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    copy.appendChild(row);
  }
  document.body.appendChild(copy);
  const gone = () => copy.remove();
  const a = play(copy, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)' }],
    { duration: lite() ? 90 : 130, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }, 'leave');
  if (a) a.finished.then(gone, gone); else gone();
  setTimeout(gone, 400);
}

/* ---- the 2.0 hotfix (the owner's first look: a note's ⋯ menu left open over the Chat list). A menu never outlives the
   screen it was opened on: Back (a phone's Back closes a full-screen note under its ⋯ menu) and a tab switch close every
   open menu, and a menu whose button has gone (its screen closed under it) closes too. Glass only: classic is untouched. */
const openMenus = new Set();  // { handle, anchor } of each menu opened in glass, until it's closed
function closeMenus({ stranded = false } = {}) {
  for (const entry of [...openMenus]) {
    const { handle, anchor } = entry;
    if (!handle.el.isConnected) { openMenus.delete(entry); continue; }
    if (stranded && anchor && (anchor === document.body || (anchor.isConnected && anchor.getClientRects().length))) continue;
    openMenus.delete(entry);
    try { handle.close('outside'); } catch (error) { console.error(error); }
  }
}
window.addEventListener('popstate', () => { if (on()) closeMenus(); });
V.on('tab', () => { if (on()) closeMenus(); });
V.on('note-left', () => { if (on()) closeMenus({ stranded: true }); });

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
    g = { id: event.pointerId, x: event.clientX, y: event.clientY, mode: 'wait', base: 0, at: 0, from: 0, last: [] };
  };
  const move = (event) => {
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (g.mode === 'wait') {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) { g.mode = 'none'; return; }
      g.mode = 'drag';
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* fine without */ }
      // (2.0 hotfix) Taken from wherever it is now: still rising, or springing back from the last pull. Never from its open
      // place, so it never jumps under the finger.
      const at = V.motion && V.motion.current ? V.motion.current(sheet) : 0;
      for (const a of sheet.getAnimations()) { try { a.cancel(); } catch (error) { /* gone */ } }
      sheet.classList.add('g-dragging');
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${at.toFixed(1)}px)`;
      g.base = Math.abs(at) < 1 ? 0 : at - dy;  // (at rest: one to one from where the finger went down)
      g.from = Math.max(0, at);
    }
    if (g.mode !== 'drag') return;
    // down: with the finger, one to one; up past where it is open: held by a band, less and less
    const raw = g.base + dy;
    const y = raw >= 0 ? raw : -(V.motion && V.motion.rubber ? V.motion.rubber(-raw, 70) : Math.min(14, Math.sqrt(-raw) * 2.2));
    g.at = y;
    sheet.style.transform = `translateY(${y.toFixed(1)}px)`;
    g.last.push([performance.now(), raw]);
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
    // (px per ms; a finger held still before it lifts has none left)
    const still = !last || performance.now() - last[0] > 90;
    const speed = !still && first && last[0] > first[0] ? (last[1] - first[1]) / (last[0] - first[0]) : 0;
    const far = Math.min(150, sheet.offsetHeight * 0.3);
    const pulled = was.at - was.from;  // (caught on its way up and let go: it carries on up unless it was pulled down)
    // A flick down (however short), or a pull past a third: it goes, at least as fast as the finger was going. Else it
    // springs back from where it is, with the finger's speed.
    if (!cancelled && ((was.at > far && pulled > 24) || (speed > 0.45 && was.at > 20 && pulled > 0))) {
      const to = layer.clientHeight;
      const ms = Math.max(110, Math.min(170, (to - was.at) / Math.max(speed, 1.2)));
      if (!quick()) {
        try { sheet.animate([{ transform: `translateY(${was.at.toFixed(1)}px)` }, { transform: `translateY(${to}px)` }], { duration: ms, easing: 'cubic-bezier(.25,.6,.45,1)', fill: 'forwards' }); } catch (error) { /* plain */ }
      }
      sheet.style.transform = `translateY(${to}px)`;
      layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));  // (V.sheet closes on a press on its scrim)
      setTimeout(() => {
        if (layer.isConnected && !layer.classList.contains('leaving')) back(0);
      }, 80);
    } else back(cancelled ? 0 : speed);
  };
  function back(speed) {
    if (V.motion && V.motion.spring && !quick()) {
      V.motion.spring(sheet, { from: V.motion.current(sheet), to: 0, velocity: speed, onDone: settle });
      return;
    }
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
    // (a screen taken away from under a menu opened on it: the menu goes too, the 2.0 hotfix)
    if (openMenus.size && records.some((record) => record.target === layers && record.removedNodes.length)) closeMenus({ stranded: true });
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        // (2.0 hotfix: the note-taker's bar comes down from the top as it appears, a soft spring; calm: it fades in)
        if (record.target === layers && node.classList.contains('nt-strip')) {
          play(node, calm() ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: 'translateY(-100%)', opacity: 0.4 }, { transform: 'none', opacity: 1 }],
            { duration: calm() ? 120 : lite() ? 180 : 420, easing: calm() ? 'linear' : SLIDE }, 'strip');
          continue;
        }
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
