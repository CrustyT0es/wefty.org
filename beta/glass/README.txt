Wefty 2.0 "glass": how the layer works
=======================================

(This is README.txt, not .md: the PC app's updater only takes the web file kinds in vault/webupdate.py's TYPES.)

The idea
--------
2.0 is the existing app in a new look, not a rewrite. The look is a layer that is opt-in:

  html[data-look="glass"]   the glass look is on (js/look.js sets it, in <head>, before the first frame)
  anything else             the classic look, untouched

Every rule in vault/web/glass/*.css starts with html[data-look="glass"]. Every script in vault/web/glass/*.js does
nothing unless V.look.isGlass(), and listens to V.on('look') so the switch in Settings > Appearance works live, in both
directions, with no reload. Never edit an existing rule in styles.css. If a hook is really needed (a class or a
data-attribute on existing markup) add it in the app's own JS in a way that changes nothing in classic.

Where it shows
--------------
  Real site (wefty.org)    classic by default; the owner can switch the new look on in Settings > Appearance
  Private preview          wefty.org/beta/ (python -m vault.publish --preview <wefty.org checkout>): glass by default,
                           its own offline copy (IndexedDB "vault-preview", caches "wprev-"), owner only (a gate)
  V.preview                true in the preview (js/look.js: the address starts with /beta/)

Files
-----
  js/look.js        V.preview, V.names, V.look (get / set / isGlass / animations / setAnimations); the lite and calm classes
  glass/glass.css   tokens (dark, light, Pure black), the aurora, glass surfaces, controls, the shell, motion primitives
  glass/motion.js   V.motion: the shared motion helpers (below)
  glass/shell.js    the aurora element, the tab bar's sliding indicator and the weft between tabs, badges, V.glass
  glass/<area>.css/.js   one pair per area; each is owned by one builder: today, notes, editor, chat, share, study,
                    notetaker, settings, onboarding, overlays, loading. index.html already loads them all, so
                    nobody edits index.html. Add your area's rules and code to your own pair.

Tokens
------
glass.css REDEFINES the app's own token names (--bg --surface --card --page --field --text --muted --accent --primary
--line ...) for glass, as light-dark() pairs, so every existing part picks up the colours and stays readable.
Pure black is html[data-black]: the aurora is off and the canvas black, the glass edges stay.
New tokens: --g-fill --g-edge --g-hi --g-ring --g-shadow --g-bar --g-blur --g-grad (the one gradient button) --g-glow
--g-ease --g-spring --g-slide --d-press --d-slide --d-enter. Images and shadows can't go in light-dark(), so they are
set per theme under [data-theme="dark"] / [data-theme="light"].
Text contrast stays at 4.5 to 1 or better on the real glass (tests/test_wefty_20_look.py measures it, dark, light and
Pure black, in the morning, day and night tints). Muted text is never dimmer than #ABA2CF on dark.

The surface vocabulary
----------------------
  .g            the board's glass: soft fill, the light edge (a masked gradient border), a drop shadow. V.glass.surface(el)
  .sheen        a soft light that sweeps across on hover and press
  .g-bar        glass with blur: ONLY on bars and sheets, never on list cards (blur is costly on a cheap Chromebook)
  .btn.primary  the one gradient button per screen; everything else is quiet glass (.btn, .btn.quiet, .btn.tonal)
  the app's own cards, sheets, menus, toasts, fields, chips, segmented controls and switches already look glass.

Motion (the owner's priority: SATISFYING animation, still smooth on a school Chromebook)
----------------------------------------------------------------------------------------
  - only transform and opacity animate (plus stroke-dashoffset to draw the thread)
  - press .12 s; slides and springs .46 s cubic-bezier(.25,1.18,.35,1); entrances .5 s with a stagger of at most 8
  - every animation can start again at once (Web Animations: the old one is cancelled; CSS: alternate keyframe names)
  - will-change only while something is moving; no layout thrash (measure, then write)
  - LITE (html.lite): blur off, aurora still, springs shortened, no decoration. Turns on by itself for weak devices
    (prefers-reduced-data, 4 GB of memory or 4 processors or fewer, or the frame-drop monitor V.motion.watch()), and
    from Settings > Appearance > Animations: Auto / Full / Calm (Full: never lite).
  - CALM (html.calm: prefers-reduced-motion, or Calm): nothing moves, only fades of 120 ms or less.
  Both are classes on <html>; glass.css has the rules, V.motion.lite() / V.motion.calm() say which is on.

V.motion (glass/motion.js: call these, don't write your own)
------------------------------------------------------------
  enter(container, { stagger, selector, max, delay })   the rise-in of a screen's children
  press(el)  /  press.follow(el)                        one spring pulse / a pointer press that follows the finger
  spark(el)                                             the four-spark burst from a ticked box
  roll(el, from, to)                                    rolling numbers; ends on exactly String(to)
  weft(svgPath)                                         a thread draws itself
  flip(fromEl, toEl, { reverse })                       a shared element opening / closing (a card into a note)
  swipe(el, { left, right, onCommit })                  swipe a card: commits past 80 px, springs back below it
  pull(scroller, { onRelease })                         pull down at the top to sync
  peek(el, { onPeek })                                  press and hold to preview
  shrink(scroller, title, { bar })                      a large title that collapses into a slim bar
  lite(), calm(), watch()                               the modes, and the frame-drop monitor
Each returns a handle ({ cancel(), finished }) or { destroy() }, does nothing with a missing element, and leaves no
stray element or inline style behind. tests/test_wefty_20_motion.py drives each of them.

How to add an area (or a screen of one)
---------------------------------------
 1. Put the rules in glass/<area>.css, every one starting with html[data-look="glass"].
 2. Put the code in glass/<area>.js: `if (!V.look.isGlass()) ...` guards, V.on('look') to start/stop, V.motion for motion.
 3. Add your screens to SCREENS (and your interactions to MOTIONS) in tests/glass_shots.py, then LOOK at the pictures:
        python tests/glass_shots.py <outdir> --screens today --theme dark,light --size phone,wide --motion
    names are <screen>-<look>-<theme>-<size>.png, and filmstrips <interaction>-...-strip.png. Never say a screen looks
    right without having looked at the picture (dark, light, Pure black; 412 px, 360 px at page zoom 1.15, 1280 px).
 4. Run your area's old tests with WEFTY_LOOK=glass as well as without. Tests that pin the classic look's exact colours
    or layout get @pytest.mark.classic_only (skipped under glass); nothing else may be skipped.
 5. Write tests/test_wefty_20_<area>.py: glass on/off both live and by reload, no console errors, no sideways scroll at
    320/360/412 px (page zoom 1.15 and 1.3) and 1280/1366, text contrast, lite and calm, the interactions still work.

Words: plain and short, "Wefty" never "Vault" in anything shown, no em dashes in what people read.


Added after the first review
----------------------------
  - Preview and the real app share one origin, so js/look.js keeps every localStorage key of the preview under its own
    name ("preview:<key>") except the sign-in, this device's id and kind, and the theme. Never read another copy of a key
    by hand; use localStorage as always. The preview never signs the device up for notifications (V.push.support()
    says 'preview'). The gate screen is a courtesy, not a lock: its sign-out is the real app's too, and it says so.
  - The app's own .bar is the thin progress bar; the glass bar class is .g-bar.
  - Transitions: only transform and opacity (the tab bar's words are the one colour that fades). A hover is a light
    layer (::before) fading in; a switch's lit track is a layer too. Fields snap their focus ring.
  - Blur: the tab bar and sheets only (menus, toasts and the scrim have none); none at all in lite.
  - The selected day card on Today: use --g-pill-fill, --g-pill-ring and --g-pill-glow (the board's .slider i); the tab bar's
    own indicator is --g-tab-fill and matches the board's .tabslide.
  - The aurora stops drifting after 8 s without input (html.g-idle), and stands still while a page scrolls (html.g-scrolling) or a sheet is open; the frame monitor starts after the first sync; its
    verdict (wefty-lite-auto) lasts 7 days and Animations Auto or Full forgets it.
  - V.motion.flip's handle has restore(); V.motion.shrink works through the stylesheet where scroll-driven animations exist.


One recipe per kind of thing (the round-4 merge)
------------------------------------------------
Use the shared recipe; don't copy it into your area with other numbers (three areas did, and each looked a little off).
  - the main button: glass.css's .btn.primary already is it; a rule of your own only sets the size, and an area that has
    to repaint it uses background: var(--g-gloss), var(--g-grad); box-shadow: var(--g-primary-depth)
  - a tick box: overlays.css's (add your box's class to its :is() list there); never a second one under it
  - a segmented control's lit pill: overlays.css's .g-seg-hl i (glass/settings.js slides its own, with the same look)
  - quiet glass on a full-screen screen (the note-taker, studying, the welcome, the note): white glass in light,
    light-dark(rgba(255, 255, 255, .62), rgba(255, 255, 255, .07)), with a light top edge and a --g-ring rim
  - errors that need more than a line: V.messageCard (a V.toast of kind 'err' with a help, an action or long words becomes one); questions: V.confirm / V.sheet

Added after the owner's first look at the preview (the 2.0 hotfix)
-------------------------------------------------------------------
  - A screen over a screen is never see-through. --page, --card and --surface-2 are tints in glass, so a full-screen layer
    never paints them as its page: on a phone it paints the app's canvas (--bg with --g-aurora, a still copy of the aurora's
    tint: background-size 150%, centred), and from 700 px a dialog's card is --g-solid. Floating things (menus, tips, popovers)
    are made of --raised / --g-float, which are opaque. tests/test_wefty_20_hotfix.py pictures each screen with the app under
    it and again with the app hidden: the two must be the same.
  - Text fields: no ring of their own (the global :focus-visible ring skips them); a rounded .field shows its inset glow, a
    field inside a container lets the container glow (Chat's box). html.g-kbd (glass/shell.js: Tab or the arrows, gone at
    the next press of a finger or the mouse) brings a clear rounded ring for the keyboard.
  - html.g-typing (glass/shell.js: a text field has the typing on a touch screen and the screen lost 120 px or more, the
    on-screen keyboard): the floating tab bar slides away and --g-bar-space is 0.
  - A menu closes when Back is pressed, the tab changes, or the thing it was opened from goes (glass/overlays.js).
  - Today's rows move by one plan (glass/today.js moveRows): a row that changes place fades out, the others slide, it fades
    in where it now is; no two rows ever cross, and a row's copy is made only for its own moment.
  Part 2 (tests/test_wefty_20_hotfix2.py):
  - Words sent fly (glass/send.js): Chat's box and Share's Send box. In the tap, before the app draws anything, a copy of
    the words is lifted where they are and the bubble or row they go to is held invisible by one style rule (#g-fly-rules),
    so the two are never seen apart; the copy flies into the place and the bubble forms round it; words that go back to the
    box (nothing to send them with) land back there. Calm: the bubble fades in.
  - Share (glass/share.js): the switch's pill slides between parts, the part tapped comes in from its side (a copy of the
    one left goes the other way), the tray's pictures spring in and shrink away, new rows rise.
  - Notes' search (glass/notes.js, "a phone's search"): the top row is always "Notes", a glass search circle, the ⋯ and the
    picture (a size container makes room at 320 px with bigger text). The search row is exactly as tall as the title row and
    the "Try" pills as the chips, so the list never moves; while it opens the two rows are on the screen together (.gn-morphing)
    and a capsule of glass (.gn-morph: two round ends and a stretched middle, transform only) grows from the circle into the
    field, from the frame of the tap (startNow), and shrinks back into it. Calm: a crossfade.
  - Pull to sync everywhere (glass/shell.js syncNow and pullSync on V.motion.pull): Today and Notes on their scrollers,
    the shell on Share's parts, the Chat list and Settings; one sync at a time (a pull during one shows its spinner), a
    screen drawn again keeps its pill (handle.refresh). Never in a conversation, under a sheet, or in classic.
  - Fluid pull-outs: a sheet follows the finger one to one, is held by a band above where it is open (V.motion.rubber), and
    is let go by distance or speed (a finger held still has none); caught while it opens or springs back it is taken from
    where it is (V.motion.current), and it springs back from there with the finger's speed (V.motion.spring: a sampled spring,
    stiffness 520, damping 36). Sheets are opaque glass (--g-sheet: no backdrop blur to work out while they move) and open
    with a little overshoot (--g-sheet-spring); a menu's copy fades and shrinks away quicker than it came (.g-menu-going).
  - The note-taker's live screen (glass/notetaker.css, .js): on a phone one scroller from its top (drawn at its top even when
    the start screen was scrolled), the words' own box at least 140 px, one 16 px gutter, Pocket mode's button under its
    words, the foot's buttons each on a row of their own when they don't fit side by side.
  - Menus (glass/overlays.js): opened by a finger or the mouse they light nothing, and while a text field is typed in they
    leave it the focus (the phone's keyboard stays); they follow their button when the screen changes size. A note's + More
    is a tray of two rows of tiles just above the floating strip (glass/editor.css). A ring in a menu or a sheet only with
    html.g-kbd, one rounded ring.
  - The phone's status bar (theme-color) is the aurora's top colour in glass (by time of day, light or dark, black in Pure
    black, a note's own top while one is open on a phone), and js/theme.js's own again when the look is off. Only the real
    phone shows the bars.


The integration of the owner's second look (rec4 and six stills), on the merged tree
-------------------------------------------------------------------------------------
  - Moves that must keep step with each other are driven from one clock: V.motion.tween(ms, V.motion.bezier(...), step) calls
    step(eased, linear) at every frame from the first one painted (never a frame later for one element than another, which Web
    Animations made in one long task can do, and never lost when what they move is drawn again). Settings coming in over a
    screen (and going back), and Share's parts, are carousels made with it: the screen that goes (a picture of it, taken at
    'screen-leaving') and the one that comes are a screen's width apart at every frame, so nothing is ever over anything.
  - A note grows out of its card as a WINDOW (glass/editor.js windowOf): the real note, full screen and square, scaled evenly from
    the card's width, seen through a rounded clip-path that starts as the card and grows to the screen; the card's own copy lies
    over it for the first moments, so there is never an empty box; going back is the same the other way, ending in the real card.
  - Words sent (glass/send.js): the copy is worked out again at every frame from where its box and the real words are now, so a
    keyboard going away or a chat scrolling changes nothing; the bubble forming never goes below the composer's top edge.
  - The bloom of the edge light (loading.css .ge-bloom) is two soft inner glows, no ring and no line.
  - A popover is opaque (Chat's "Ask about this" bar, the bar at the top while the note-taker is hidden); only a composer, a bar
    that scrolls things under it, may be glass with blur.
