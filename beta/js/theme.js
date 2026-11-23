/* Wefty: light or dark, Pure black, the phone's bars, and the look's two value sets (V.theme). Loaded in index.html's
   <head>, right after js/moved.js and before the stylesheet, so html[data-theme], html[data-black], the value sets and
   the status bar's colours are already set before the parser even reaches <body>: the first frame is drawn in the right
   colours, never light (or navy) first. (The page's rules allow no inline script, so it's a file of its own; js/util.js,
   which makes the rest of `V`, comes much later, after the vendor scripts.)

   This device's own choice (Settings > Appearance, kept in localStorage 'vault-theme': system, light or dark), else
   the system's. In the PC app "system" means Windows' own app theme, which vault/desktop.py hands over (VAULT_SCHEME
   at the start, then a "scheme" event), as Qt's web view may not pass it on as prefers-color-scheme. Pure black
   (Settings > Appearance, 'vault-black' = 'on', per device, off unless switched on) puts html[data-black] on while
   dark shows: the canvas goes black for phones with black (OLED) screens. Says "theme" (V.emit) on a change once
   js/util.js is there.

   The phone's bars (Wefty 2.0; the look brief 1.2, TS-23): this file is the one writer of the theme-color metas (the
   status bar) and of --canvas-top / --canvas-foot (inline on <html>; --canvas-top is the canvas's own top, under any scrim
   and under a full-screen note, never the bar's colour seen through the one or the note's own top). The status bar is the colour of the pixel row
   under it: the canvas's top in the aurora's tint of the time of day (html[data-tod]), black in Pure black, a
   full-screen note's own top while one is open on a phone (its reading tint when it has one); and under a scrim that
   colour seen through the scrim, stepped in time with the scrim's fade (`scrim(on, ms)`: the overlays call it as a scrim
   starts to fade in or out; calls nest). --canvas-foot is the solid canvas, the strip under the dock and the colour an
   installed app's navigation bar takes. Any other write to a theme-color meta is dropped and only tells this file to
   look again (glass/shell.js still has a painter of its own until it is deleted: its writes are where this file hears
   that the time of day or a note changed). At time scale 0 (the test profile) a step lands at once, in the same task.

   The two value sets (the owner's question Q6; ui/tokens.css): "as before" ships; "new" is under two owner-only
   switches, per device, off by default: localStorage 'wefty-surfaces' and 'wefty-springs' = 'new' set
   html[data-surfaces="new"] and html[data-springs="new"] here, before the first frame. `values()` reads them,
   `values({ surfaces, springs })` changes them ('new' or anything else for as before). */
'use strict';

(() => {
const V = (window.V = window.V || {});

V.theme = (() => {
  const KEY = 'vault-theme';
  const BLACK = 'vault-black';
  const SETS = { surfaces: 'wefty-surfaces', springs: 'wefty-springs' };
  const root = document.documentElement;
  // --bg as classic had it, for the status bar of a page that isn't wearing the 2.0 look (theme-color metas). (Android's
  // navigation bar at the bottom of an installed app is another matter: since Chrome 153 it takes the manifest's
  // theme_color, which Chrome copies into the installed app and nothing on the page can change. A manifest has one
  // colour for both themes, so manifest.webmanifest's is the dark tab bar's, --surface #13131f, and its
  // background_color, the launch screen's, the dark --bg: a white bar under a dark app glares, a dark one under a
  // light app doesn't.)
  const BARS = { light: '#f5f6f8', dark: '#0d0d17', black: '#000000' };
  // The 2.0 canvas's top edge: the aurora's tint of the time of day as a phone's screen shows it (a deep violet in dark,
  // its light top in light), and a full-screen note's own top. --canvas-foot: ui/tokens.css's --solid-canvas.
  const TOPS = {
    dark: { morning: '#25152d', day: '#1e1537', night: '#140e2b', note: '#21193f' },
    light: { morning: '#f1def8', day: '#e4d8ff', night: '#e1d9ff', note: '#f3ebfe' },
  };
  const FOOT = { light: '#efe9ff', dark: '#0b0918', black: '#000000' };
  // --scrim (ui/tokens.css), as [r, g, b, alpha]: what the bar is seen through while a sheet, a dialog or the tour is up.
  const SCRIM = { light: [40, 24, 90, 0.34], dark: [6, 4, 16, 0.6] };
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const phone = window.matchMedia('(max-width: 899px)');
  const preview = /^\/beta(\/|$)/.test(location.pathname);  // (js/look.js's V.preview: its keys are "preview:<key>" there)
  let system = /^(light|dark)$/.test(window.VAULT_SCHEME || '') ? window.VAULT_SCHEME : '';
  let shown = '';
  let look = '';
  let unsaved = null;  // Pure black where storage refuses it: until the page closes
  let noteOpen = false;  // a note open over everything (js/editor.js's note-opened / note-left)
  let scrims = 0;  // scrims up now (scrim(true) not yet ended by scrim(false))
  let veil = 0;  // how far the bar is through the scrim now, 0 to 1
  let step = null;  // the stepping now: { from, to, t0, ms }
  const read = (key) => {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  };
  const choice = () => {
    const saved = read(KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  };
  const black = () => {
    if (unsaved !== null) return unsaved;
    return read(BLACK) === 'on';
  };
  const resolved = () => (choice() !== 'system' ? choice() : system || (media.matches ? 'dark' : 'light'));
  const values = () => {
    // (in the preview its own keys are "preview:<key>", read under that name here: before js/look.js has wrapped the
    // storage, the real app's key would be read instead, and the first frame would wear the real app's value set)
    const own = (key) => read(preview ? 'preview:' + key : key);
    return { surfaces: own(SETS.surfaces) === 'new' ? 'new' : 'before', springs: own(SETS.springs) === 'new' ? 'new' : 'before' };
  };
  const timeScale = () => (read('wefty-time-scale') === '0' ? 0 : 1);  // (js/look.js's V.look.timeScale, before it exists)
  const hourOf = () => {
    const h = new Date().getHours();
    return h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'day' : 'night';
  };
  const hex = (rgb) => '#' + rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('');
  const rgbOf = (colour) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
    if (m) return [1, 2, 3].map((i) => parseInt(m[i], 16));
    const n = /rgba?\(([^)]+)\)/.exec(colour || '');
    return n ? n[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number) : null;
  };
  // A note's reading tint (Settings > Appearance > Reading): the colour its page is painted, --tint (a light-dark() pair of
  // the tint's two colours, as the stylesheet resolves it on <html>).
  const tintNow = () => {
    if (!root.hasAttribute('data-reading-tint')) return null;
    try {
      const value = getComputedStyle(root).getPropertyValue('--tint');
      const pair = /light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/i.exec(value);
      return pair ? pair[(shown || resolved()) === 'dark' ? 2 : 1].toLowerCase() : null;
    } catch (error) { return null; }
  };
  // The bar's colour at rest, for the theme showing.
  // (`note` false: the canvas's own top, never a full-screen note's, which is what --canvas-top says)
  const resting = (theme, note = true) => {
    if (root.dataset.look !== 'glass') return BARS[theme === 'dark' && black() ? 'black' : theme];
    if (theme === 'dark' && root.hasAttribute('data-black')) return '#000000';
    if (note && noteOpen && phone.matches) return tintNow() || TOPS[theme].note;
    return TOPS[theme][root.dataset.tod || hourOf()] || TOPS[theme].day;
  };
  // ...seen through the scrim, `t` of the way (0 to 1).
  const veiled = (colour, theme, t) => {
    const rgb = rgbOf(colour);
    if (!rgb || t <= 0) return colour;
    const [r, g, b, a] = SCRIM[theme === 'light' ? 'light' : 'dark'];
    const k = a * Math.min(1, t);
    return hex([rgb[0] + (r - rgb[0]) * k, rgb[1] + (g - rgb[1]) * k, rgb[2] + (b - rgb[2]) * k]);
  };

  /* The one writer: the metas and the two canvas tokens. A meta's own `content` is taken over (a write to it from
     anywhere else is dropped and only asks for a fresh look), so nothing else can make the bar a second colour. */
  const PROTO = Object.getOwnPropertyDescriptor(HTMLMetaElement.prototype, 'content');
  const owned = new WeakSet();
  const metas = () => {
    const all = document.querySelectorAll('meta[name=theme-color]');
    for (const meta of all) {
      if (owned.has(meta) || !PROTO) continue;
      owned.add(meta);
      Object.defineProperty(meta, 'content', { configurable: true, get() { return PROTO.get.call(this); }, set() { paint(); } });
    }
    return all;
  };
  // `rest`: the bar's resting colour when the caller already has it (a scrim's step reads it once, not every frame:
  // tintNow's getComputedStyle with a long note open took ~300 ms a frame). --canvas-top is the canvas's own top, the
  // colour UNDER the scrim (the scrim paints itself over it), so a scrim never changes it: a custom property written on
  // :root restyles the whole document (over the 10,000-word class note a sheet got 2 frames in its first 600 ms).
  function paint(rest) {
    const theme = shown || resolved();
    const base = rest || resting(theme);
    const top = veiled(base, theme, veil);
    for (const meta of metas()) if (meta.getAttribute('content') !== top) meta.setAttribute('content', top);
    if (step) return;
    const foot = FOOT[theme === 'dark' && root.hasAttribute('data-black') ? 'black' : theme];
    // (2.0 speed: --canvas-top is the canvas's top, so a note opening or closing over it leaves it alone: a custom
    // property written on :root restyles the whole page, the open 2,000-word note's included, at every open and close)
    const canvas = noteOpen && phone.matches ? resting(theme, false) : base;
    if (root.style.getPropertyValue('--canvas-top') !== canvas) root.style.setProperty('--canvas-top', canvas);
    if (root.style.getPropertyValue('--canvas-foot') !== foot) root.style.setProperty('--canvas-foot', foot);
  }
  // The bar's way through the scrim, frame by frame (requestAnimationFrame: no timer), eased as the scrim fades.
  const ease = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
  function stepTo(target, ms) {
    if (!(ms > 0) || timeScale() === 0 || typeof requestAnimationFrame !== 'function' || document.hidden) {
      step = null;
      veil = target;
      paint();
      return;
    }
    const theme = shown || resolved();
    const mine = (step = { from: veil, to: target, t0: performance.now(), ms, theme, rest: resting(theme) });
    const frame = (now) => {
      if (step !== mine) return;  // (a later scrim took over from here)
      const t = Math.max(0, Math.min(1, (now - mine.t0) / mine.ms));
      veil = mine.from + (mine.to - mine.from) * ease(t);
      if (t >= 1) step = null;
      // (the theme turned mid-step: its own resting colour, read again)
      paint(step && (shown || resolved()) === mine.theme ? mine.rest : undefined);
      if (step === mine) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function apply() {
    const now = resolved();
    const deep = black();
    root.dataset.theme = now;
    if (deep && now === 'dark') root.dataset.black = '';
    else delete root.dataset.black;
    const sets = values();
    if (sets.surfaces === 'new') root.dataset.surfaces = 'new'; else delete root.dataset.surfaces;
    if (sets.springs === 'new') root.dataset.springs = 'new'; else delete root.dataset.springs;
    shown = now;
    paint();
    const was = look;
    look = now + (deep && now === 'dark' ? ' black' : '');
    if (look !== was && V.emit) V.emit('theme', now);
  }
  media.addEventListener('change', apply);
  // (every listener calls paint() with nothing: paint's one argument is a resting colour, and 'tab' hands over the view's
  // name, a media query its event; written as --canvas-top, each tab tap restyled the whole page twice, 2.0 speed)
  const repaint = () => paint();
  phone.addEventListener('change', repaint);
  // changed in another tab
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === BLACK || Object.values(SETS).some((k) => event.key === k || event.key === 'preview:' + k)) apply();
  });
  // (the time of day may have turned while the page was away)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) paint(); });
  // A note open over everything, a reading tint, a tab (js/util.js's V.on comes later than this file).
  const listen = () => {
    if (!V.on) return;
    V.on('note-opened', () => { noteOpen = true; paint(); });
    V.on('note-left', () => { noteOpen = false; paint(); });
    V.on('reading', repaint);
    V.on('tab', repaint);
    V.on('look', repaint);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', listen, { once: true }); else listen();
  apply();
  return {
    choice,
    current: () => shown,
    black,
    /* Pure black is in effect: switched on and dark showing. */
    isBlack: () => look === 'dark black',
    set(value) {
      try {
        if (value === 'light' || value === 'dark') localStorage.setItem(KEY, value);
        else localStorage.removeItem(KEY);
      } catch (error) { /* private browsing: it lasts until the page closes */ }
      apply();
    },
    setBlack(on) {
      try {
        if (on) localStorage.setItem(BLACK, 'on');
        else localStorage.removeItem(BLACK);
        unsaved = null;
      } catch (error) {
        unsaved = !!on;
      }
      apply();
    },
    system(value) {
      system = value === 'light' || value === 'dark' ? value : '';
      apply();
    },
    /* The two value sets: { surfaces, springs }, each 'new' or 'before'. With an object, sets those given (owner-only
       switches, per device; nothing here draws them). */
    values(change) {
      if (change && typeof change === 'object') {
        for (const name of Object.keys(SETS)) {
          if (!(name in change)) continue;
          try {
            if (change[name] === 'new') localStorage.setItem(SETS[name], 'new');
            else localStorage.removeItem(SETS[name]);
          } catch (error) { /* (private browsing: not kept) */ }
        }
        apply();
      }
      return values();
    },
    /* A scrim starts to fade in (on: true) or out (on: false) over `ms`: the status bar follows it, from the canvas's top
       to that colour through the scrim and back. Nested scrims keep it through until the last one goes. */
    scrim(on, ms = 0) {
      scrims = Math.max(0, scrims + (on ? 1 : -1));
      stepTo(scrims > 0 ? 1 : 0, Number(ms) || 0);
    },
    /* The bar's colour now (what the metas say), and a fresh look (after something only the caller knows changed). */
    bar: () => veiled(resting(shown || resolved()), shown || resolved(), veil),
    paint,
  };
})();
})();
