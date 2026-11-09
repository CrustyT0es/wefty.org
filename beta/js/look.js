/* Wefty: which copy of the app this is, and which look it wears (V.preview, V.names, V.look).
   Loaded in index.html's <head>, right after js/theme.js and before the stylesheet, not async, so html[data-look] and
   the lite / calm classes are set before the first frame and everything after it (db.js, notetaker.js...) can rely on
   it. Plain script, shares `V` like the rest.

   Wefty 2.0's private preview is the same app built into wefty.org/beta/ (vault/publish.py --preview). It's found by
   its address, in the source: no build step rewrites anything. In the preview the app keeps its own offline copy and
   its own pieces of unwritten recordings, away from the real app's (same origin, so same sign-in, but never the same
   notes copy or outbox): a preview that crashes or is half-built can never damage what the real app holds.

   The look (2.0, "glass"): html[data-look="glass"] turns the new look on (vault/web/glass/*), anything else is the
   classic look, untouched. Kept per device in localStorage 'wefty-look' ('glass' or 'classic'); with nothing kept it
   is classic on the real site and glass in the preview. V.look.set() changes it live (V.emit('look', value)).
   "Animations" (Settings > Appearance, per device, 'wefty-animations'): auto (the default: lite on weak devices),
   full (never lite) or calm (nothing moves). They become classes on <html>: `lite` (blur off, aurora still, springs
   shortened: prefers-reduced-data, a device with 4 GB of memory or 4 processors or fewer, or the frame-drop monitor in
   glass/motion.js) and `calm` (prefers-reduced-motion, or Calm). Only the glass rules look at them. */
'use strict';

(() => {
const V = (window.V = window.V || {});

/* Whether this page is the private preview (its address starts with /beta/). */
V.preview = /^\/beta(\/|$)/.test(location.pathname);

/* The IndexedDB names this copy of the app uses: js/db.js's `app` and js/notetaker.js's `listening`. (sw.js works out
   its own from its scope, as it has no V.) */
V.names = V.preview ? { app: 'vault-preview', listening: 'wefty-listening-preview' }
  : { app: 'vault', listening: 'wefty-listening' };

/* localStorage in the preview. The preview is the same origin as the real app, so it would share every key: its look,
   its push sign-up, its streak, its tour... A preview that flipped the real app's push sign-up (or the owner's look on
   wefty.org) would break the rule that it can never touch the real app. So in the preview every key but the ones below is
   kept under its own name, "preview:<key>". Shared on purpose: the sign-in (sb-*, vault-auth*, vault-config, vault-user,
   so the owner is already signed in), this device's id and kind, and the theme (the same phone, the same taste). The
   storage's own methods are wrapped once, here, before anything else reads it, so every part of the app (and the
   tests) goes through the same rule. `V.storageKey(k)` gives the real name of a key. Outside the preview nothing changes. */
const SHARED_KEYS = /^(sb-|vault-auth|vault-config$|vault-user$|vault-install$|vault-theme$|vault-black$|vault-device$)/;
const PREVIEW_PREFIX = 'preview:';
V.storageKey = (key) => {
  const text = String(key);
  return !V.preview || text.startsWith(PREVIEW_PREFIX) || SHARED_KEYS.test(text) ? text : PREVIEW_PREFIX + text;
};
if (V.preview) {
  try {
    const local = window.localStorage;
    const proto = Storage.prototype;
    const original = { get: proto.getItem, set: proto.setItem, remove: proto.removeItem };
    proto.getItem = function getItem(key) { return original.get.call(this, this === local ? V.storageKey(key) : key); };
    proto.setItem = function setItem(key, value) { return original.set.call(this, this === local ? V.storageKey(key) : key, value); };
    proto.removeItem = function removeItem(key) { return original.remove.call(this, this === local ? V.storageKey(key) : key); };
  } catch (error) { /* no storage at all (a private window): nothing to share */ }
}

V.look = (() => {
  const LOOK = 'wefty-look';
  const ANIMATIONS = 'wefty-animations';
  const LITE_AUTO = 'wefty-lite-auto';
  const root = document.documentElement;
  const memory = {};  // where storage refuses (a private window): until the page closes
  const read = (key) => {
    try { return localStorage.getItem(key); } catch (error) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; }
  };
  const write = (key, value) => {
    try {
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
      delete memory[key];
    } catch (error) { memory[key] = value; }
  };
  const query = (text) => { try { return window.matchMedia(text).matches; } catch (error) { return false; } };

  /* 'glass' or 'classic'. */
  const get = () => {
    const saved = read(LOOK);
    return saved === 'glass' || saved === 'classic' ? saved : V.preview ? 'glass' : 'classic';
  };
  /* 'auto' | 'full' | 'calm'. */
  const animations = () => {
    const saved = read(ANIMATIONS);
    return saved === 'full' || saved === 'calm' ? saved : 'auto';
  };
  /* A device that will struggle with blur and big gradients: asks for less data, 4 GB of memory or less (Chrome tells
     it as 0.25 to 8), or 4 processors or fewer. */
  const weak = () => {
    const memoryGb = Number(navigator.deviceMemory);
    const cores = Number(navigator.hardwareConcurrency);
    return query('(prefers-reduced-data: reduce)') || (memoryGb > 0 && memoryGb <= 4) || (cores > 0 && cores <= 4);
  };
  /* The frame-drop monitor's verdict ('wefty-lite-auto' = when it was made; an old '1' counts as made just now) is good for
     LITE_DAYS, then the device gets another chance: an update, a cooler room or a quieter machine may be quick now. */
  const LITE_DAYS = 7;
  const autoLite = () => {
    const saved = read(LITE_AUTO);
    if (!saved) return false;
    const at = Number(saved);
    if (!(at > 1e9)) return true;  // (an old '1')
    if (Date.now() - at > LITE_DAYS * 86400000 || at > Date.now() + 86400000) { write(LITE_AUTO, null); return false; }
    return true;
  };
  const motion = () => {
    const mode = animations();
    const calm = mode === 'calm' || query('(prefers-reduced-motion: reduce)');
    const lite = mode !== 'full' && (weak() || autoLite());
    return { mode, calm, lite };
  };

  function apply() {
    const now = get();
    if (root.dataset.look !== now) root.dataset.look = now;
    const { calm, lite } = motion();
    root.classList.toggle('calm', calm);
    root.classList.toggle('lite', lite);
  }
  const tell = (type, detail) => { if (V.emit) V.emit(type, detail); };

  apply();
  try {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    (reduced.addEventListener ? reduced.addEventListener.bind(reduced, 'change') : () => {})(() => { apply(); tell('animations', animations()); });
  } catch (error) { /* an old browser: the page's first look stays */ }
  // changed in another tab
  window.addEventListener('storage', (event) => {
    if (event.key === V.storageKey(LOOK)) { apply(); tell('look', get()); }
    if (event.key === V.storageKey(ANIMATIONS) || event.key === V.storageKey(LITE_AUTO)) { apply(); tell('animations', animations()); }
  });

  return {
    get,
    isGlass: () => get() === 'glass',
    set(value) {
      if (value !== 'glass' && value !== 'classic') return get();
      write(LOOK, value);
      apply();
      tell('look', get());
      return get();
    },
    animations,
    setAnimations(value) {
      write(ANIMATIONS, value === 'full' || value === 'calm' ? value : null);
      if (value !== 'calm') write(LITE_AUTO, null);  // (Auto or Full: the monitor's old verdict is forgotten; Auto judges again)
      apply();
      tell('animations', animations());
      return animations();
    },
    /* What the classes say now: { mode, calm, lite }. */
    motion,
    weak,
    /* The frame-drop monitor (glass/motion.js) found the device too slow for the full look: lite from now on (until
       Animations is set to Full). Remembered per device. */
    liteAuto(on) {
      if (on === undefined) return autoLite();
      write(LITE_AUTO, on ? String(Date.now()) : null);
      apply();
      tell('animations', animations());
      return !!on;
    },
    /* The classes again (after something changed what they depend on). */
    apply,
  };
})();
})();
