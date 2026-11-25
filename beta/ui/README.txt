# vault/web/ui: Wefty 2.0's own layer

Everything here is the 2.0 look's own code: CSS in the `ui` cascade layer, and the small scripts the look runs on. Read
this before adding to it. The look brief (section 1) and `PLAN.md` say what it looks like; this says how it is built.

## The layer rule

- `styles.css` opens `@layer force, classic, glass, ui;`. `ui` comes last, so a rule here beats every rule in
  `styles.css` (classic) and `glass/*.css` (glass) **whatever their specificity**. Never fight a glass rule from here:
  delete it in its own file (a lane that owns that file, or the integrator) and define the thing once here.
- Every rule of a `ui/*.css` file is inside `@layer ui { ... }`. Its `!important` declarations (avoid them) go in one
  `@layer force { ... }` block at the end. Nothing unlayered, nothing in `classic` or `glass`.
- **Literals live only in `tokens.css`**: no colour, radius, type (font size, line height, weight) or curve
  (cubic-bezier, linear()) literal in any other `ui/` file. Use the tokens. No `z-index` number anywhere in `ui/`
  (use the `--z-*` tokens), no `:active` (a press is `ui/motion.js`'s, on pointerdown), no `transform` for a press
  (the `scale` / `translate` properties: a press never replaces a positioning transform).
- Avoid a non-subject `:has()` (one doubled the long chat's scroll cost). A subject `:has()` (`.x:has(> .y)`) is fine.
- Every move a `ui/` file starts ends inside the task that began it at time scale 0 (`V.look.timeScale()` 0, the test
  profile): CSS durations are zeroed by `html.instant`, and a timed step in script goes through `V.motion.later(fn, ms)`.
  Each lane ships a test of that.

## Who owns each file (one writer per file per wave)

| file | owner | what |
|---|---|---|
| `README.txt` | tokens and kit lane (A1) | this page (a .txt: the PC app's updates take no .md; Markdown inside) |
| `tokens.css` | tokens and kit lane (A1) | every token: surfaces, ink, gradients, radii, space, type, elevation, page geometry, motion; light, dark, Pure black; lite and calm; the two value sets; the older glass names as aliases |
| `kit.css` | tokens and kit lane (A1) | one definition of each part: button, field, switch, segment, tick, chip, tag, row, badge, sheet, menu, toast, dialog, the one focus ring, danger by weight; the overlay states |
| `motion.js` | motion lane (A3) | `V.motion`: the press engine, `later`, `D`, `SPRINGS`, `list`, `deck` |
| `overlay.js` | overlays lane (A2) | the seven builders out of `js/util.js` (signatures kept); sets the overlay states below |
| `overlay.css` | overlays lane (A2) | state and geometry of what floats (positions, origins, pointer-events, the `.ui-scrim` host, the toasts' column and slot, the long sheet's pinned foot, a menu's still light edge on its scroll timeline); no colour or surface (the kit's) |
| `edge.css` | speed lane (A4) | the edge light: four square strips and the comet that slides along them (`.ge-strip`, `.ge-comet`) |
| `start.css` | speed lane (A4) | the W's turn to one rest (`wy-turn`, in `@layer force` as index.html's splash CSS is unlayered); in the head, before the splash paints |
| `firstsight.css` | first-sight lane (S0) | what must be in sight now, deleted piece by piece as the real layouts land |
| `nav.js` | Back and the layer (B1) | `V.back` (one guard step: Back, Esc, the scrim, the X and a swipe close the one topmost thing; focus home) and `V.layer` (1.8's full-screen row) |
| `nav.css` | Back and the layer (B1) | the layer's and `#stage`'s geometry |
| `screen.css` | the header (B3) | `--x0`, a phone's one sticky header row and its collapse on the page's own scroll timeline, the Chromebook's edge at x 100 |
| `dock.js` | the dock (B2) | `V.dock`: the one visualViewport reader (`g-typing`, `--kb`), the bars' table and claims |
| `dock.css` | the dock (B2) | the dock, the fog, the strip, Notes' own + placed over the dock (no + in the bar or the rail), the toast slot |
| `tabs.js` | tab transition lane (wave B) | `V.tabMove`: a tab's arrival (the old screen fades on the compositor from the tap, the new one rises 12 px from the pill's side, its header and Notes' + moving with it as one; js/start.js's tapped() and show() call `leave` and `drawn`) |

Load order in `index.html` (the integrator's): the sheets after `glass/swipeback.css` as `tokens.css`, `kit.css`,
`overlay.css`, then the lanes' own (`edge.css`, `start.css`, ...), with `firstsight.css` LAST of the head's
stylesheets; wave B's `nav.css` and `screen.css` (right after `js/util.js`) and `dock.css` (after `glass/shell.js`) are in
the body, after the splash's element, so the W paints without waiting for them (they came after firstsight.css while
the lanes were built, and still do); `motion.js` right after `js/util.js` (before `glass/motion.js`, which adds to `V.motion`, and before any
other `ui/` script), then `overlay.js` (before `glass/overlays.js`, which calls `V.overlay`).

A later lane adds a file of its own (never a second writer on one of these): it writes `ui/<name>.css` (in `@layer ui`)
or `ui/<name>.js`, links it LOCALLY in a commit whose subject ends "(link only, the integrator re-does it)", and names
the file and its place in `index.html`'s order to the integrator, who owns `index.html`. Its CSS then follows the rules
above, and its row is added to the table here.

## Frozen names (other lanes rely on them: never rename)

- An overlay's own node (the sheet, menu, dialog or toast element) carries `data-ui="entering" | "open" | "leaving"`,
  and its scrim is one node with the class `ui-scrim` carrying the same `data-ui`. The kit styles `[data-ui]` states and
  `.ui-scrim`; the overlays code sets them. The kit's rules look right with those attributes absent (today's markup)
  and present.
- `V.motion.later(fn, ms)` is the only timer new code uses: it reads `V.look.timeScale()`, and at 0 runs `fn` at once,
  in the same task. It returns a handle with `cancel()`.
- `V.motion.D` holds the durations in ms: `press 90, fade 120, exit 160, swap 180, enter 240, stagger 40`.
  `V.motion.SPRINGS` holds the springs by stiffness and damping (mass 1): `tap { k: 700, d: 32 }`,
  `pill { k: 520, d: 36 }`, `screen { k: 380, d: 34 }`, `settle { k: 900, d: 60 }`.
- The CSS tokens of the same numbers: `--d-press`, `--d-fade`, `--d-exit`, `--d-swap`, `--d-enter`, `--d-stagger`, and
  `--spring-tap`, `--spring-pill`, `--spring-screen`, `--spring-settle` (in the "new" value set, linear() strings made
  from the same k and d; "as before", the default, keeps today's curves under the same names).
  Each spring's own length is beside it: `--d-tap`, `--d-pill`, `--d-screen`, `--d-settle` (a CSS move takes
  `transition: transform var(--d-pill) var(--spring-pill)`). Lite has its own (stiffer) strings and lengths under
  `html.lite`; calm shortens every one to a 120 ms fade.
- `V.theme.scrim(on, ms)`: the overlays lane calls it as a scrim starts to fade in (`on` true) or out (`on` false),
  with the fade's length in ms. `js/theme.js` then steps the phone's status bar (the theme-color metas) from the
  canvas's top colour to that colour under `--scrim`, in time with the fade, and back. `--canvas-top` stays the canvas's
  own top under any scrim (a custom property written on `<html>` each frame restyled the whole page: a sheet over a long
  note got 2 frames in 600 ms). Calls nest (two scrims, one bar). At time scale 0 it lands at once, in the same task.
- Later waves add `V.dock.register(name, el)`, `V.back.push(close)`, `V.layer.open(screen, { from })` and
  `V.layer.from(el)`. Nobody defines them before their wave.
- Set by `ui/motion.js` (the motion lane) and read by others: `html[data-input]` = `"mouse"`, `"touch"` or `"pen"`, the
  last pointer (the `:hover` codemod writes `html[data-input="mouse"] <selector>:hover`; nothing else sets it);
  `[data-lifted]` on a thing `V.motion.lift` lifted; `V.motion.easing(name)`, `V.motion.buzz(ms)`, and each spring's
  `SPRINGS[name].ms` / `.easing` and `SPRINGS.lite`.
- Set by `js/theme.js` before the first frame: `html[data-surfaces="new"]` and `html[data-springs="new"]` (the two value
  sets, below), and inline on `<html>`: `--canvas-top`, `--canvas-foot`.

## The two value sets (the owner's question Q6)

`tokens.css` holds "as before" (the default: what ships) and "new" (brief 1.2). They differ only in the resting alphas
of bars and cards, the sheen, the shadows, the spring strings and the +'s corner. Two owner-only switches, off by
default, kept per device by `js/theme.js` in localStorage and set on `<html>` before the first frame:

- `html[data-surfaces="new"]` (`V.theme.values({ surfaces: 'new' })`, key `wefty-surfaces`): bars, cards, sheen,
  shadows, the + corner.
- `html[data-springs="new"]` (`V.theme.values({ springs: 'new' })`, key `wefty-springs`): the spring strings.

Gates time and critics film "as before". Nothing here builds the switches' row: the owner's Settings row (E6, or the
feel page) calls `V.theme.values`.

## The kit's floor

`kit.css` is in the sublayer `ui.kit`, so **any other `ui/` rule beats the kit whatever its specificity** (the kit is
the floor of the ui layer), and the kit's selectors are `:where(...)` (no weight). Its last block, "given back to their
areas", is generated (`python tests/kit_giveback.py --write`; tests/test_wefty_20_kit.py checks it is current): every rule in `styles.css` and `glass/*.css` that
sizes or colours one area's own button, field, chip or switch gets its properties back with `revert-layer`, so the kit
never flattens a look an area still owns. An area that adopts the kit deletes its rule; the next `--write` drops its
line. The block only shrinks.
