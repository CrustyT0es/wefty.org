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
  'file-too-big': ['File too big', 'file'],
  asleep: ['Cloud asleep', 'cloud'],
  'signed-out': ['Signed out', 'lock'],
  'forgot-password': ['Sign-in', 'key'],
  offline: ['Offline', 'cloud'],
  update: ['Update needed', 'download'],
};
const PLAIN_TITLE = 'Something went wrong';
/* Cards that say where things stand rather than that something broke: amber, with no red flash of the edge light. */
const WARN = new Set(['offline', 'asleep', 'too-big', 'file-too-big', 'signed-out', 'update']);

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
  // ---- round-3 merge block: one error at a time. A newer error takes the place of the ones still showing (a key typed
  // wrong three times stacked three cards over the sheet, its Save under them); the other toasts (an Undo) stay.
  if (on() && o.kind === 'err') {
    const box = document.getElementById('toasts');
    for (const old of box ? [...box.querySelectorAll(':scope > .toast.err:not(.leaving)')] : []) {
      const x = old.querySelector(':scope > .mc-x');
      if (x) { x.click(); continue; }  // (a message card closes itself: its own leaving and onClose)
      old.classList.add('leaving');
      setTimeout(() => old.remove(), 200);
    }
  }
  // ---- end of the round-3 merge block
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
  // (round 4, the owner's phone: a note's ... menu drawn as a menu inside a menu) One menu at a time: any other open one goes.
  closeMenus();
  // A long menu on a phone is a sheet from the bottom (round 4): it never runs past the screen.
  const asSheet = menuSheet(anchor, items, options || {});
  if (asSheet) return asSheet;
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

/* ---- round 4 (the owner's Samsung: a note's ... menu of 13 items covered the whole screen, already scrolled, its first items
   out of sight with nothing saying so). On a phone, a menu of more than 7 items, or one that can't fit between the screen's top
   bar and its bottom bar, opens as a sheet from the bottom instead: a grab handle, what it's for at the top (a note's title),
   its items in small groups (things to do; sending and copying; studying; the reading switches; the Trash last), each on/off
   item a real switch, scrolling inside with soft fades. It follows the finger and closes by a pull down, a tap beside it or
   Back; an item tapped acts as the sheet starts to go (a switch acts at once and the sheet stays). A menu with a piece of its
   own (+ More's tiles, the picture's head, a drop-down's list) is never made a sheet. */
const SHEET_AFTER = 7;
const GROUPS = [
  [/^(send|export|copy|share|ask chat|ask about|save to|save a copy|download|open in)/i, 1],
  [/(flash cards|test me|study|learn|quiz|review)/i, 2],
];
function groupOf(item) {
  if (item.danger) return 9;
  if (typeof item.checked === 'boolean') return 3;
  const found = GROUPS.find(([words]) => words.test(item.label || ''));
  return found ? found[1] : 0;
}
function menuTitle(anchor, options) {
  const editor = anchor && anchor.closest && anchor.closest('.editor');
  const title = editor && editor.querySelector('.note-title');
  if (title && (title.value || '').trim()) return title.value.trim();
  if (editor) return 'This note';
  return String(options.label || '').replace(/:\s*(more )?options$/i, '').trim() || 'Options';
}
function menuSheet(anchor, items, options) {
  if (!phone() || !window.matchMedia('(pointer: coarse)').matches) return null;
  const list = (items || []).filter(Boolean);
  if (list.some((item) => item.node)) return null;
  const real = list.filter((item) => !item.sep);
  const room = window.innerHeight - 170;  // (the screen less its top bar and its bottom bar)
  if (real.length <= SHEET_AFTER && real.length * 48 + 24 <= room) return null;
  let done = false;
  let sheet = null;
  let stepped = false;
  // (`after`: what the item does, once the sheet has begun to go and its Back step is gone, so a step the item makes
  // itself, a note opened say, is never the one taken back)
  const closeWith = (how, after = null) => {
    if (done) return;
    done = true;
    window.removeEventListener('popstate', back);
    if (sheet) sheet.close();
    const then = () => {
      if (options.onClose) { try { options.onClose(how); } catch (error) { console.error(error); } }
      if (after) { try { after(); } catch (error) { V.problem(error); } }
    };
    if (stepped && history.state && history.state.vault === 'menu-sheet') {
      stepped = false;
      let ran = false;
      const once = () => { if (ran) return; ran = true; window.removeEventListener('popstate', once); then(); };
      window.addEventListener('popstate', once);
      setTimeout(once, 400);
      history.back();
    } else then();
  };
  const back = () => { stepped = false; closeWith('escape'); };
  // groups: the menu's own (by its lines), else by kind; the Trash (and other danger) always last
  const ordered = [];
  if (list.some((item) => item.sep)) {
    let group = 0;
    for (const item of list) { if (item.sep) group++; else ordered.push([item.danger ? 99 : group, item]); }
  } else for (const item of real) ordered.push([groupOf(item), item]);
  ordered.sort((a, b) => a[0] - b[0]);
  const rows = [];
  let last = null;
  for (const [group, item] of ordered) {
    if (last !== null && group !== last) rows.push(V.h('div.g-msheet-gap', { 'aria-hidden': 'true' }));
    last = group;
    const icon = !item.icon ? null : typeof item.icon === 'string' ? V.icon(item.icon) : item.icon.cloneNode(true);
    if (typeof item.checked === 'boolean') {
      const box = V.h('input.switch', { type: 'checkbox', checked: item.checked, disabled: item.disabled ? true : null,
        'aria-label': item.label, onchange: () => { try { item.onClick(); } catch (error) { V.problem(error); } } });
      rows.push(V.h('label.menu-item.g-msheet-item.g-msheet-switch', { role: 'menuitemcheckbox', 'aria-checked': String(item.checked) },
        icon, V.h('span.g-msheet-label', { text: item.label }), box));
      box.addEventListener('change', () => { box.closest('[role=menuitemcheckbox]').setAttribute('aria-checked', String(box.checked)); });
    } else {
      rows.push(V.h('button.menu-item.g-msheet-item' + (item.danger ? '.danger' : ''), { type: 'button', role: 'menuitem', disabled: item.disabled ? true : null,
        onclick: () => closeWith('item', () => item.onClick()) },
      icon, V.h('span.g-msheet-label', { text: item.label })));
    }
  }
  const body = V.h('div.g-msheet-list', { role: 'menu', 'aria-label': options.label || null }, rows);
  sheet = V.sheet({ title: menuTitle(anchor, options), content: body, onClose: () => closeWith('outside') });
  sheet.el.classList.add('g-msheet');
  // (the menu's own class on the sheet itself, `cls`: what looks for that menu finds this one, the whole of it on the screen)
  if (options.cls) sheet.el.classList.add(...String(options.cls).split(/\s+/).filter(Boolean));
  // (the browser's own menu never comes up over this one, or beside it, as over any menu: js/util.js. A finger still down
  // after the hold that opened it is on the sheet by then, and the phone's own long press, coming later, found a thing
  // that didn't turn it down.)
  sheet.el.addEventListener('contextmenu', (event) => event.preventDefault());
  const scrim = sheet.el.parentElement;
  if (scrim) scrim.addEventListener('contextmenu', (event) => { if (event.target === scrim) event.preventDefault(); });
  try { history.pushState({ ...(history.state || {}), vault: 'menu-sheet' }, ''); stepped = true; } catch (error) { /* no Back step */ }
  window.addEventListener('popstate', back);
  // (the keyboard: on its first item, as a menu's)
  requestAnimationFrame(() => { const first = body.querySelector('button:not([disabled]), input:not([disabled])'); if (first && byKeyboard()) first.focus(); });
  return { close: () => closeWith('item'), el: sheet.el };
}

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
    // Above the strip when the whole tray fits there (a phone's strip at the foot of the screen); else below it (a wide
    // screen's strip at the top of the note: the owner's Chromebook had the tray's first row cut off above it); else on
    // the side with more room, its tiles scrolling, never past the screen's edge.
    list.style.maxHeight = 'none';
    list.style.overflowY = 'auto';
    const tall = list.offsetHeight;
    const screenH = window.innerHeight / zoom;
    const above = (s.top - 8) / zoom - 8;
    const below = screenH - (s.bottom + 8) / zoom - 8;
    const under = tall > above && (tall <= below || below > above);
    const room = under ? below : above;
    list.style.maxHeight = `${Math.max(120, Math.min(tall, room))}px`;
    const height = list.offsetHeight;
    list.style.top = `${under ? Math.min((s.bottom + 8) / zoom, screenH - height - 8) : Math.max(8, (s.top - 8) / zoom - height)}px`;
    list.dataset.gUnder = under ? '1' : '';
    return 'strip';
  }
  // (round 4, the owner's phone: an answer's ... menu climbed over Chat's top bar) A menu opened from inside a chat stays
  // between the chat's top bar and its typing box: below its button when it fits there, else above, else on the side
  // with more room, scrolling inside itself.
  const chat = anchor.closest && anchor.closest('.chat-scroll');
  if (chat) {
    const b = chat.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    list.style.maxHeight = 'none';
    list.style.overflowY = 'auto';
    const tall = list.offsetHeight;
    // (the typing box floats over the scroller's foot, glass/chat.css: the menu stays above it)
    const composer = chat.parentNode && chat.parentNode.querySelector(':scope > .chat-composer');
    const over = composer ? [...composer.children].filter((el) => !el.hidden && el.getClientRects().length) : [];
    const floor = over.length ? Math.min(b.bottom, ...over.map((el) => el.getBoundingClientRect().top)) : b.bottom;
    const lo = b.top / zoom + 8;
    const hi = floor / zoom - 8;
    const below = hi - (a.bottom / zoom + 4);
    const above = a.top / zoom - 4 - lo;
    const under = tall <= below || (tall > above && below >= above);
    const room = Math.max(120, under ? below : above);
    list.style.maxHeight = `${Math.min(tall, room)}px`;
    const height = list.offsetHeight;
    const top = under ? a.bottom / zoom + 4 : a.top / zoom - 4 - height;
    list.style.top = `${Math.max(lo, Math.min(top, hi - height))}px`;
    return under ? 'below' : 'above';
  }
  // (round 4) On a phone a menu stays between the screen's top bar and its bottom bar (the tab bar, a note's tools): moved
  // in, and scrolling inside itself when it can't fit (one that can't is a sheet: menuSheet).
  if (phone()) {
    const a = anchor.getBoundingClientRect();
    const screen = anchor.closest && (anchor.closest('.editor') || anchor.closest('main.view'));
    const head = screen && screen.querySelector('.editor-bar, .app-head, .chat-head');
    const foot = (screen && screen.querySelector('.editor-tools')) || document.querySelector('#app > nav.tabs');
    const inHead = head && head.contains(anchor);
    const hb = head && head.getClientRects().length ? head.getBoundingClientRect() : null;
    const fb = foot && foot.getClientRects().length ? foot.getBoundingClientRect() : null;
    const lo = (hb && !inHead && a.top >= hb.bottom - 1 ? hb.bottom + 4 : 8) / zoom;
    const hi = (fb && fb.top > a.bottom ? fb.top - 6 : window.innerHeight - 8) / zoom;
    if (hi - lo > 80) {
      const tall = list.offsetHeight;
      if (tall > hi - lo) { list.style.maxHeight = `${hi - lo}px`; list.style.overflowY = 'auto'; }
      const height = list.offsetHeight;
      const top = parseFloat(list.style.top) || list.getBoundingClientRect().top / zoom;
      list.style.top = `${Math.max(lo, Math.min(top, hi - height))}px`;
    }
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
    { duration: lite() ? 70 : 100, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }, 'leave');
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
  // (from well under its size, about the button it came from: a menu that began at nine tenths of its size looked as if it had
  // simply been there, to the left of its button, the owner's recording)
  const a = play(list, [{ opacity: 0, transform: lite() ? 'scale(.9)' : 'scale(.45)' }, { opacity: 1, transform: 'none' }],
    { duration: lite() ? 140 : 360, easing: lite() ? 'ease-out' : SPRING, fill: 'backwards' }, 'menu');
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

/* ================================================================== drop-downs: Wefty's own list (round 4)

   The owner's Chromebook: the note's folder picker opened the browser's own list, a black box with a thin white edge and a
   pale blue row ("it doesn't look like Wefty"). In glass a drop-down (a <select>: the note's folder, the note-taker's, Snap a
   page's, a reminder's repeat, a subscription's...) opens Wefty's own list instead: on a wide screen a glass menu that pops
   out of the field (V.menu, so the same motion as every menu) and scrolls when long; on a phone a sheet that follows the
   finger. It is a listbox of options: the one in use ticked, folders inside folders indented with their emoji on a small
   glass square, "New folder..." last under a line; the arrow keys, Home, End, Page Up and Down move, letters typed find,
   Enter or Space (or a tap) picks, Esc or a press beside it closes. Picking sets the select's value and tells it as the
   browser would (input, then change), so the app's own code is untouched; the select itself stays what a screen reader and
   the keyboard know. A select with `multiple` or a size, or one that's disabled, is left as it is. */
const PICK_SPACE = /^[\s  -  ]+/;
const PICK_EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍|\p{Emoji_Modifier}|\p{Extended_Pictographic}|\p{Regional_Indicator})*)\s+/u;
const pickable = (sel) => !!sel && sel.tagName === 'SELECT' && !sel.multiple && !(sel.size > 1) && !sel.disabled && sel.options.length > 0
  && !!sel.closest('#app, #layers') && on();
function pickOptions(sel) {
  return [...sel.options].map((option) => {
    const raw = option.textContent || '';
    const lead = (raw.match(PICK_SPACE) || [''])[0].length;
    let text = raw.slice(lead).trim();
    const emoji = text.match(PICK_EMOJI);
    if (emoji) text = text.slice(emoji[0].length);
    const fresh = option.value === 'new-folder' || /^new folder/i.test(text);
    return { option, value: option.value, text, emoji: emoji ? emoji[1] : '', depth: Math.min(6, lead), disabled: option.disabled, fresh };
  });
}
function labelOf(sel) {
  const named = sel.getAttribute('aria-label');
  if (named) return named;
  const label = sel.closest('label') || (sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`));
  return label ? (label.textContent || '').replace(sel.textContent || '', '').trim() || 'Choose' : 'Choose';
}
let picking = null;  // the drop-down open now: { sel, close }
function openPick(sel, keyed) {
  if (picking) { const same = picking.sel === sel; picking.close(); if (same) return null; }
  const items = pickOptions(sel);
  const current = sel.selectedIndex;
  const label = labelOf(sel);
  const asSheet = phone() && root.matches('[data-look="glass"]') && window.matchMedia('(pointer: coarse)').matches;
  let handle = null;
  let done = false;
  const finish = (item) => {
    if (done) return;
    done = true;
    picking = null;
    if (handle) handle.close();
    if (item && !item.disabled) {
      if (keyed || asSheet) { try { sel.focus({ preventScroll: true }); } catch (error) { /* gone */ } }
      if (sel.value !== item.value) {
        sel.value = item.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };
  const row = (item, i) => {
    const on_ = i === current;
    const button = V.h('button.menu-item.g-pick-option' + (on_ ? '.on' : '') + (item.fresh ? '.fresh' : ''), {
      type: 'button', role: 'option', tabindex: '-1', 'aria-selected': String(on_), disabled: item.disabled ? true : null,
      dataset: { value: item.value, depth: String(item.depth) }, onclick: () => finish(item),
    },
    item.fresh ? V.h('span.g-pick-badge', {}, V.icon('folder-plus')) : item.emoji ? V.h('span.g-pick-badge', { text: item.emoji, 'aria-hidden': 'true' }) : null,
    V.h('span.g-pick-text', { text: item.text }),
    on_ ? V.h('span.g-pick-tick', { 'aria-hidden': 'true' }, V.icon('check')) : null);
    if (item.depth) button.style.setProperty('--g-pick-depth', String(item.depth));
    return button;
  };
  const rows = items.map(row);
  const list = V.h('div.g-pick-list', { role: 'listbox', 'aria-label': label });
  items.forEach((item, i) => {
    if (item.fresh && i > 0) list.append(V.h('div.menu-sep.g-pick-sep', { role: 'separator' }));
    list.append(rows[i]);
  });
  const usable = () => rows.filter((b) => !b.disabled);
  // The keys (on the list, before V.menu's own)
  let typed = '';
  let typedAt = 0;
  const keys = (event) => {
    const all = usable();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement);
    const from = at >= 0 ? at : Math.max(0, all.indexOf(rows[current]));
    const go = (i) => { event.preventDefault(); event.stopPropagation(); const to = all[Math.max(0, Math.min(all.length - 1, i))]; to.focus(); to.scrollIntoView({ block: 'nearest' }); };
    if (event.key === 'ArrowDown') return go(at < 0 ? from : from + 1);
    if (event.key === 'ArrowUp') return go(at < 0 ? from : from - 1);
    if (event.key === 'Home') return go(0);
    if (event.key === 'End') return go(all.length - 1);
    if (event.key === 'PageDown') return go(from + 8);
    if (event.key === 'PageUp') return go(from - 8);
    if (event.key === 'Tab') { event.preventDefault(); finish(null); try { sel.focus({ preventScroll: true }); } catch (error) { /* gone */ } return undefined; }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      const now = performance.now();
      typed = (now - typedAt > 800 ? '' : typed) + event.key.toLowerCase();
      typedAt = now;
      const start = typed.length === 1 ? from + 1 : from;
      const order = all.slice(start).concat(all.slice(0, start));
      const found = order.find((b) => (b.querySelector('.g-pick-text').textContent || '').toLowerCase().startsWith(typed))
        || (typed.length > 1 && typed.split('').every((c) => c === typed[0])
          ? order.find((b) => (b.querySelector('.g-pick-text').textContent || '').toLowerCase().startsWith(typed[0])) : null);
      if (found) go(all.indexOf(found));
      else { event.preventDefault(); event.stopPropagation(); }
    }
    return undefined;
  };
  if (asSheet) {
    handle = V.sheet({ title: label, content: list, onClose: () => { if (!done) { done = true; picking = null; } } });
    handle.el.classList.add('g-pick-sheet');
  } else {
    const rect = sel.getBoundingClientRect();
    const layers = document.getElementById('layers');
    if (layers) layers.style.setProperty('--g-pick-min', `${Math.round(rect.width)}px`);
    handle = V.menu(sel, [{ node: list }], { cls: 'g-pick-menu', label, returnFocus: !!keyed,
      onClose: () => { if (!done) { done = true; picking = null; } } });
    if (handle && handle.el) handle.el.setAttribute('role', 'presentation');
  }
  // (on what has the keyboard: the list's own box, or a row in it)
  if (handle && handle.el) handle.el.addEventListener('keydown', keys, true);
  picking = { sel, close: () => finish(null) };
  // the one in use in sight, and (the keyboard) lit
  const chosen = rows[current] && !rows[current].disabled ? rows[current] : usable()[0];
  // (a sheet is a dialog: the keyboard goes into it, on the one in use, as it does for the keyboard's list)
  const into = keyed || asSheet;
  requestAnimationFrame(() => {
    if (!chosen || !chosen.isConnected) return;
    chosen.scrollIntoView({ block: 'nearest' });
    if (into) chosen.focus({ preventScroll: true });
  });
  if (into && chosen) chosen.focus({ preventScroll: true });
  return handle;
}
document.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  const sel = event.target && event.target.closest ? event.target.closest('select') : null;
  if (!pickable(sel)) return;
  event.preventDefault();
  openPick(sel, false);
}, true);
document.addEventListener('keydown', (event) => {
  const sel = event.target;
  if (!pickable(sel) || event.ctrlKey || event.metaKey) return;
  const opens = event.key === ' ' || event.key === 'Enter' || event.key === 'F4' || event.key === 'ArrowDown' || event.key === 'ArrowUp';
  if (!opens) return;
  event.preventDefault();
  event.stopPropagation();
  openPick(sel, true);
}, true);
V.glassPick = openPick;

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
