# QA-UI: UI, responsive and accessibility (A10)

Scope: Winter Arc repo as delivered after A9 (165 files, WA_VERSION 0.1.0-a3, seed 44 foods). No app file was edited.
Method: headless Chromium (Playwright 1.56) against a throwaway static server; whole-route DOM audit at 360x640, 320x568, 768x1024, 1280x800 (light) and 360x640 dark; 200% text-size emulation (root font-size 200%); landscape 640x360; keyboard drives; Back/refresh/deep-link drives; service worker, offline and update drives under a sub-folder (`/deep/sub/wa/`); static greps; new suite `tests/tests-ui-qa.js`.
Not done in this chat (no real device): VoiceOver, TalkBack, real iPhone keyboard and safe-area, real camera, Web Share. See docs/MANUAL-CHECKLISTS.md.

## Result in one paragraph
Foundations are strong: zero contrast failures, zero CSP violations, zero external requests, one h1 and one main landmark per screen, no horizontal scroll at normal size from 320 to 1280, native dialogs with focus handling, working offline reload, update banner that never reloads mid-form, correct base-path behaviour, neutral wording. One required fix: at large text size (200%) many screens scroll sideways (F-A10-01). Five medium/low fixes follow. Tests: new suite 21 total, 17 pass, 4 red on purpose (open findings F-A10-01, 03, 04, 05).

## Findings (FINDINGS FORMAT: id, severity, owner, where, evidence, fix)

| ID | Sev | Owner | Summary |
|---|---|---|---|
| F-A10-01 | **Required** | A3 (css) + A4 (settings/common.js pageHead) | 200% text: page scrolls sideways on many screens |
| F-A10-02 | Medium | A4 / A3 | At 360x640 with a banner, sticky Quick actions cover content |
| F-A10-03 | Medium | A4 (screens-w1.css) | Quick actions row hides its scrollbar; Steps clipped, Workout/Sleep/Note off-screen with no cue at 360 |
| F-A10-04 | Medium | A4 (import-wizard.js) | Hidden file input is an unnamed 1x1 tab stop |
| F-A10-05 | Medium | A3 (components.js) | Estimate badge name reads "est.. What does this mean?", never says "estimate" |
| F-A10-06 | Low | A3 router / A4 shared.js | Sheet routes with a missing id fall back to the tab silently, no "Not found" |
| F-A10-07 | Low | A5 (wizard.js) | Check-in wizard step change focuses h1 "New check-in" on every step; step name not announced |
| F-A10-08 | Low | A3/A4/A5 | Touch targets under 44 px (list below) |
| F-A10-09 | Low | A5 (compare.js) | Photo compare empty state uses the message as the h1; page has no "Compare photos" title |
| F-A10-10 | Info | none | DOM scan finds `style` attributes on `.pbar-fill` and `.usage-fill`; created by `setProperty` (D-052, C-041), zero CSP violations. Not a defect |
| F-A10-11 | Low | A3/A6 | Tab rows (Add food, Trends) scroll inside a container at 320 (420 px content); tabs are focusable so keyboard works; no visual cue (extends F-A6-06) |
| F-A10-12 | Low | A4 | Hidden date input unnamed (aria-hidden, tabindex -1): audit noise only (F-A6-07 confirmed open) |
| F-A10-13 | Info | A12/A14 | WA_VERSION is still `0.1.0-a3`; set the release value and upload version.js last |
| F-A10-14 | Minor | A12 | Add `tests-ui-qa.js` to SUITES in tests/harness.js (A10 may not edit it) |

### F-A10-01 detail (required)
Evidence (360 px wide, root text 200%): document width 531 px on Storage, 471 Targets, 468 Install, 447 Display, 411 About, 406 Choose workout, 412 Check-in wizard, 378 Backup; at 320 also Today 344 and Body 335. Widest element on every Settings screen is the ghost "Settings" back link inside `.screen-head` (221 px wide), which sits in a non-wrapping flex row beside the h1. Clipped text also seen: `.field-label`, `.field-hint`, `DT` in About and Install, `.tile-sub` on Today, `.chip-est` (80 in 76 px).
Fix: `.screen-head { flex-wrap: wrap; }` with `h1 { min-width: 0; overflow-wrap: anywhere; }`; let `.field-label, .field-hint, dt, .tile-sub` wrap (`overflow-wrap: anywhere`); give `.chip-est` `min-width: 0` and padding that grows with text. Re-run `python3` audit or the red test `F-A10-01` (checks `.screen-head` wraps).
Note: browser page zoom to 200% on a 360 px phone is stricter still (180 CSS px). Rows that must stay wide (tables) must sit in a focusable scroll container; no table was found outside one.

### F-A10-08 touch targets under 44x44 (measured at 360)
Estimate chips 52x32 (exercise library, session) and 75x32; inline links "Values are approximate" 166x16, "Manage my foods" 125x16 and 281x36; skip link 158x42 (visible only on focus, low impact); sleep quality chips 43x44 (confirms F-A6-09). Checkbox rows pass because the whole label row is above 44 px (F-A6-08 closed by measurement).
Fix: `.chip-est { min-height: 44px }` with a transparent hit area (or padding), links as `display:inline-flex; min-height:44px; align-items:center`, quality chips `min-width:44px`.

### Proposed handling for F-A10-02/03
Below 600 px show quick actions as a 3x2 grid (no scrolling), or make the bar non-sticky when `innerHeight < 700` or a banner is showing. Today at 360x640 with the install banner shows only the ring; the bar overlaps the ring caption. This extends F-A5-07 and the A6 note.

## Contrast (R-033): no failures
Worst case per foreground across bg, surface, surface-2 and soft backgrounds, from `css/tokens.css` as shipped (fiber light already adjusted to #4A7527, D-086). Full matrix is computed by the suite test "full token matrix".

| Foreground | Light worst (on) | Dark worst (on) | Need |
|---|---|---|---|
| text | 14.04 (primary-soft) | 11.38 (warning-soft) | 4.5 |
| text-secondary | 6.11 (primary-soft) | 6.57 (primary-soft) | 4.5 |
| primary / focus ring | 5.36 (primary-soft) | 7.30 (primary-soft) | 4.5 text, 3 ring |
| protein | 4.91 (surface-2) | 7.21 (surface-2) | 4.5 |
| carbs | 4.90 (surface-2) | 8.65 (surface-2) | 4.5 |
| fat | 5.45 (surface-2) | 7.76 (surface-2) | 4.5 |
| fiber | 4.81 (surface-2) | 8.69 (surface-2) | 4.5 |
| steps | 5.67 (surface-2) | 7.86 (surface-2) | 4.5 |
| water | 4.79 (surface-2) | 7.67 (surface-2) | 4.5 |
| sleep | 6.04 (surface-2) | 7.63 (surface-2) | 4.5 |
| warning | 5.24 (surface-2) | 8.88 (warning-soft) | 4.5 |
| danger | 5.78 (surface-2) | 8.60 (surface-2) | 4.5 |
| success | 5.57 (surface-2) | 8.97 (surface-2) | 4.5 |
| border-strong (inputs) | 3.22 (surface-2) | 3.42 (surface-2) | 3 |
| on-primary on primary | 6.41 | 9.19 | 4.5 |

No proposed hex changes. No hard-coded colours remain outside tokens.css (test). Not measured: contrast of chart text over bars, and metric colours when used as thin lines against grid lines (reasoned: lines use the same hues, all above 4.5).

## Per-screen results (automated audit, 33 routes)
Checked per route at 360 light: exactly one h1, one `main`, nav landmarks labelled ("Main", "Quick actions"), live regions present, zero CSP violations, zero console errors, zero external requests, no inline handlers, all interactive elements named (except F-A10-04, F-A10-12).
- Horizontal page scroll at normal text size: none at 320, 360, 768, 1280, landscape 640x360, dark 360.
- Today (no data), Food add sheet, Workout session (5 rows, steppers 44x44, rows with Done as target / Set % / Edit kcal), Plan editor (Move up/down/Remove buttons present beside drag), Check-in wizard, Backup, Import step 1, Self-check, empty states: pass for layout at 360 and 1280 (Today and Session screenshots reviewed).
- Today (full data), Body graph with data, Photo compare with photos, Import steps 2 to 7, Self-check with data: **reasoned only** (no data set in this run; CSS and A5/A6 evidence). A6 reported overflow checks across 35 routes at 360/768/1280.
- Empty-state exact text confirmed for: Today, Food meal, Workout, Body, Check-ins (hub), Compare, Trends, Notes. Search "No match", Favourites, Plans "Restore defaults" and the graph-under-2-points text were not re-checked in this run (A8 covered them functionally).

## Keyboard (UX-022)
- Quick action Enter opens sheet; focus lands on the first input (Water, Steps, Sleep, Note) or search (Add food); Esc closes and returns focus to the opener link (all 6 checked). Choose workout opens a screen, not a sheet (by design).
- Tab cycles inside the native dialog, leaves to browser UI and returns; no trap.
- Tabs component: ArrowRight/ArrowLeft/Home/End move selection and focus; roving tabindex (checked in Add food: Recent, Frequent, Favourites, Categories).
- Sleep quality is a labelled group; steppers labelled ("Decrease/Increase Actual for Push-ups"); Select and native inputs labelled; live region announces actuals ("Actual for Push-ups 7 reps").
- Drag handles have Move up/down buttons (labelled per exercise). Pointer drag itself not exercised.
- Gaps: F-A10-04, F-A10-07.

## Back button (R-034, D-072)
Pass: opening a sheet then Back closes it; refresh on a sheet route restores the sheet without the picker; Back from Workout (primary root) goes to Today; Back at Today after sheets steps through earlier same-tab history (this is browser history I created by setting hashes by hand, not a defect; real leave-app behaviour needs the phone checklist). Unknown route shows "Not found". Session and check-in ids that do not exist show "Not found". Gap: F-A10-06 (sheet route). Known: C-048/F-A4-06 extra history entry after a saved sheet (A12).

## CSP and external requests
Zero `securitypolicyviolation` events across all routes and fatal screens; zero requests outside the origin; grep: no `http(s)://` in shipped code (except the SVG namespace), no eval/new Function/innerHTML/insertAdjacentHTML/document.write, no inline handlers, no inline script, no `style` attribute in HTML or JS templates; `fetch` only in sw.js, js/app.js (update probe) and js/core/seed.js. See F-A10-10 for runtime CSSOM attributes.

## Theme, motion
Auto follows system; Light/Dark select persists (`winter-arc:ui` {"theme":"dark"}) and survives reload; boot-theme.js is a blocking script before tokens.css; two theme-color metas with media; manifest #F7F8F6 with start_url, scope, id `./`; icons 192, 512, maskable 512, SVG. Reduced motion: durations 0 ms and animations off; all durations 300 ms or less; no `infinite` anywhere. Ring "at final value" with reduced motion follows from 0 ms transition (reasoned).

## PWA and offline
- Precache: 112 listed, all exist, no duplicates, no tests/tools/docs; only `data/ATTRIBUTION.md` is unlisted (disclaimer text is embedded, acceptable); `data/foods-starter.json` is cached through the seed manifest (confirmed in cache: shell 107 entries, seed 7).
- Served under a three-level sub-folder: SW scope correct, caches `winter-arc-shell-0.1.0-a3` and `winter-arc-seed-1`, first run works, airplane-mode reload shows Today with the profile, Self-check offline shows versions match, ready for offline use, no files missing.
- Update drill (version.js bumped in a copy): banner "Update available. Reload to use the new version. Your data is not affected."; typed note and open dialog untouched, no automatic reload; Reload gives new version, old shell cache removed, data intact. Repair app asks Cancel / Repair first.
- Not done: real GitHub Pages, iOS install, Android Install button (manual list).

## Special screens by simulation
Safe mode (`#/safe-mode`), Restore (`#/restore`), unsupported/no IndexedDB ("Storage is not available ... Private browsing"), DB blocked ("Winter Arc is open in another tab"): all reachable, one h1, no overflow. Storage full and write-failed banners are in source (js/app.js:216, db.js QuotaError), not triggered live. "Unsupported browser" proper text exists (app.js:147) but a missing IndexedDB shows the storage message; acceptable.

## Wording
Over-target text is "+N over" in normal text colour (no `is-over` rule, no red); under-target "kcal remaining"; no shaming words (scan of all feature strings); no red/green on measurement change (series.js uses Up/Down); estimate chips on kcal; no-PIN and backup warning texts match D-055 exactly (tested). Gap: F-A10-05.

## Reasoned-only list
VoiceOver/TalkBack behaviour; iPhone keyboard with full-height food sheet (R-032); iOS home-bar overlap (safe-area insets are in CSS: nav, sheet footer, toast); real camera/library inputs (accept image/*, capture only on Take photo); Web Share; iOS and Android install; Safari and Firefox rendering; pointer drag; 400% zoom in a real browser; Full-data screens listed above; Storage red/amber banners; check-in due banner; photo compare layout with images.

## Suite
`tests/tests-ui-qa.js`: 21 tests (contrast matrix, focus ring, no hard-coded colours, exact CSP, forbidden APIs, fetch allow-list, theme and manifest, motion, precache completeness including import-graph and seed manifest, exact warning texts, no shaming words, dialog and live-region structure, estimate badge keyboard). Four tests named F-A10-nn are red on purpose. Not in SUITES yet (F-A10-14); verified by running a scratch copy with SUITES patched: 17 passed, 4 failed (the findings).
