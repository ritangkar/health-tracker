# Winter Arc conventions (written by A3)

Read this before writing a screen. It is the contract between the shell (A3) and the screens (A4 to A6).

## 1. Rules that never bend
- Vanilla ES modules. No build, no libraries, no network calls. Relative URLs. Imports end in `.js`. File names are lowercase kebab-case.
- No inline scripts, no inline event attributes, no `style` attributes in markup. The CSP blocks them (D-019, D-052).
  Dynamic visuals: classes, data attributes, SVG attributes, or `el.style.setProperty('--name', value)` (allowed, also available as the `vars` prop of `h()`).
- Never use `innerHTML`. `h()` puts text in as text. User data (names, notes, food names) is always text.
- Dates are local civil dates (`js/core/dates.js`). Never `toISOString`.
- No fixed-weekday workout logic anywhere (code, data, copy). Display-only day names come from `formatDay`.
- Null means no data and shows a dash (`DASH`). Zero is shown only when the person entered zero.
- Estimates carry an `EstimateBadge`. Over-target text is neutral ("+120 over"), never red.

## 2. How a screen is added (nothing in the shell needs editing)
Each feature folder has a register file that app.js loads if it exists:

| File | Owner |
|---|---|
| js/features/profile/register.js, daily/register.js, food/register.js, workout/register.js, settings/register.js | A4 |
| js/features/food/register-w2.js, workout/register-w2.js, body/register.js, photos/register.js, checkins/register.js | A5 |
| js/features/analytics/register.js | A6 |

A register file only calls `registerScreen` / `registerSheet` and imports its screens. Example:

    import { registerScreen, registerSheet } from '../../core/router.js';
    import { todayScreen } from './today.js';
    import { waterSheet } from './water-sheet.js';
    registerScreen('/today/:date?', todayScreen, { root: 'today', title: 'Today', where: { date: /^\d{4}-\d{2}-\d{2}$/ } });
    registerSheet('/today/sheet/water', waterSheet, { parent: '/today' });
    registerSheet('/today/:date/sheet/water', waterSheet, { parent: '/today/:date' });

**Every new file must also be added to `WA_PRECACHE` in version.js** (shell files, including each register file). `tests/tests-ui.js` fails when the import graph reaches an unlisted file. A14 re-checks this before packaging.

### Screen factory
`(ctx) => Node | {el, destroy} | Promise<either>`. `ctx`: `path, query, params, hash, kind, pid, date, signal, onCleanup(fn), navigate, replace, back, close`.
- `ctx.pid` is the active profile. Read and write only that profile.
- `ctx.date` is the date in the path (`#/today/2025-03-10`) or `?d=`, when valid and in range, else today.
- Subscribe to the store inside the factory and unsubscribe with `ctx.onCleanup(unsub)`.
- A missing or foreign id: `notFound()` from router.js (shows Not found, never leaks).
- Render one `h1` per screen. Focus moves to it after navigation.
- Route options: `root` (nav highlight: today, food, workout, body, progress, settings), `title`, `chrome: 'shell' | 'bare'` (bare hides the nav: picker, restore, safe mode), `requiresProfile` (default true; set false for `/pick`, `/restore`, `/safe-mode`, and `/settings/import` so a restore works on an empty database), `where`.

### Sheets
`registerSheet(pattern, factory, {parent})`. The factory returns `Sheet({ctx, title, body, footer, size, dirty})`.
- Close with `ctx.close()` after saving. `ctx.close({refresh: true})` re-runs the parent screen so it shows new data.
- `dirty: () => boolean` guards Esc, backdrop, the close button and browser Back with "Discard changes?".
- Write-through: save, then toast, then close. One sheet at a time.

### Profile and routing helpers (router.js)
`selectProfile(pid)` (picker), `switchProfile()`, `navigate(hash)`, `goRoot('food')`, `back(fallback)`, `invalidate()` (re-run current screen), `setLeaveGuard`, `buildHash(path, query)`.
Back rules (D-072): a sheet closes first; a sub-route pops; a primary tab other than Today goes back to Today; Today leaves the app. Deep links are held through the picker and opened after `selectProfile`.

## 3. Runtime status in appStore (read by Self-check)
`activeProfile, safeMode, dbBlocked, writeError, updateReady, swStatus {state,error}, seedState ('loading'|'ready'|'error'), cspViolations, cspLast, errors (last 20), online, canInstall, features (loaded register files)`.
From `js/app.js` (import `'../../app.js'`; safe, the module is already loaded): `checkForUpdate, reloadForUpdate, repairApp, getSwInfo, setTheme, getTheme, refreshBanners, refreshProfileChip, canInstall, promptInstall`.
From `js/core/dom.js`: `logError(err, where)`, `reportWriteError(err)` (shows the write-failure banner), `announce(msg)`.
Call `refreshProfileChip()` after a profile rename.

## 4. Banners and toasts
`banners.set(id, {kind: 'info'|'warn'|'danger', title, text, actions: [{label,onClick}], onDismiss})`, `banners.clear(id)`. One shows at a time by priority (D-066): storage-red / write-error, update, backup, storage-amber, install, checkin. The check-in banner id is `checkin` (A5 sets it). `toast(message, {undo})` for confirmations; row delete uses Undo for 6 s (D-054).

## 5. Component API
All in `js/ui/components.js`, charts in `js/ui/charts.js`, icons in `js/ui/icons.js` (`icon(name, {size, label})`; names in `ICON_NAMES`).

| Component | Props | Notes and accessibility |
|---|---|---|
| Button | label, kind (primary/secondary/ghost/danger), icon, onClick, href, disabled, size 'sm', ariaLabel | 44 px tall. `href` renders a link. |
| IconButton | icon, label (required), onClick, pressed, disabled | `label` becomes aria-label and title. |
| Card | title, children, headingLevel | |
| Chip | label, selected, onClick, tone ('warn'), icon | Button with aria-pressed when clickable, span otherwise. |
| EmptyState | icon, title, text, action {label,onClick/href}, headingLevel | Every list needs one (D-063). |
| Skeleton | lines | Static, no shimmer. |
| ProgressList | items [{label, status pending/active/done/error, detail}] | Status is text plus icon. |
| EstimateBadge | kind 'est'/'approx', text, explain | Button with popover; Esc closes. |
| Tabs | tabs [{id,label}], selected, onSelect, label | Arrow keys, Home, End. `.select(id)`. |
| FormField | label, hint, input / control, type, inputmode, value, min, max, step, suffix, required | `.input`, `.setError(msg)`. Sets for, aria-describedby, aria-invalid. |
| ErrorSummary | errors [{fieldId,message}] | role=alert; links focus the field. |
| Stepper | value, min, max, step, label, unit, onChange, format | Accepts decimal comma. Clamps and announces. `getValue()` returns null when empty. |
| SearchField | label, placeholder, value, onInput, onSubmit | `.input`. Clear button. |
| MealChips | meals [{id,label}], selected, onChange | Radiogroup, arrow keys. `getValue()`. |
| ServingPicker | servings [{id,label}], value, onChange | Native select inside FormField. |
| MacroPreview | kcal, protein, carbs, fat, fiber, estimate, fiberPartial | Null shows a dash. |
| FoodRow | name, detail, alias, kcalText, chips, estimate, approx, fav, onSelect, onToggleFav | `li`. Heart is aria-pressed. |
| ExerciseRow | name, detail, meta, trailing, onSelect | `li`. |
| PlanItemRow | index, count, name, target, kcal, note, onEdit, onMoveUp, onMoveDown, onRemove | `li` with drag handle plus up/down buttons. Wire `makeSortable(listEl, {onReorder(from,to)})`. |
| ProfileCard / ProfileDot | profile {name}, index, subtitle, onSelect | Initial letter plus colour ring. |
| Ring | value, max, size, tone, label, centerTop, centerBottom, summary | role=img with text. Null = dashed empty ring. Over target = dashed second lap. |
| ProgressBar | value, max, label, valueText, tone | role=progressbar. From zero. Null shows a dash. |
| MetricTile | label, value, unit, sub, icon, tone, href, onClick, actions, badge | Null value shows a dash. |
| DateNavigator | date, onChange | Prev, next, date picker, "Viewing ..." chip with Jump to today. Range 2000-01-01 to tomorrow. |
| Sheet | ctx, title, body, footer, size 'auto'/'full', dirty | Native dialog. Focus enters, Esc closes, focus returns. |
| ConfirmDialog | title, message, confirmLabel, cancelLabel, danger | Returns a Promise of boolean. Danger focuses Cancel. |
| toast | message, {undo, duration} | aria-live. `toast.clear()`. |
| banners | see section 4 | |
| LineChart | title, points [{date,value}], unit, decimals, tone, ranges, range, target, coverage {n,N}, endDate, solidMaxGap, dashedMaxGap, approx | Range tabs, latest/previous/change, tap or step readout, table toggle. Trend only with 5+ points. Gaps stay gaps; set `dashedMaxGap` higher for sparse body measurements. |
| BarChart | title, bars [{date,value or null}], unit, target, ranges, coverage | Starts at zero. Null is a mark, never a zero bar. |
| DataTable | caption, columns [{key,label,align,format}], rows | Focusable scroll region. |
| PhotoSlot | slot, label, url, busyText, error, onFile(file, slot), onRemove | Camera input and library input. |
| PhotoCompare | left/right {label,date,photos{slot:url}}, slots, slot, onSlot | Two equal columns. Caller revokes object URLs. |
| Wizard | steps [{id,title,render}], current, onNavigate(n), onCancel, onFinish, finishLabel, canAdvance | Step heading takes focus. `.setStep(n)`. |
| AppShell | none (built by app.js) | Skip link, top bar with profile menu, bottom bar under 840 px, side nav from 840 px. |

## 6. Styling
Tokens are in css/tokens.css (D-049 to D-051). Use `var(--token)` only; no hard-coded colours. Add screen CSS at the bottom of css/screens.css below the marker line. Layout classes available: `screen`, `screen-narrow`, `stack`, `stack-sm`, `row`, `row-wrap`, `spread`, `tiles`, `two-col`, `card`, `sticky-actions`, `muted`, `small`.
Metric tones: primary, kcal, protein, carbs, fat, fiber, steps, water, sleep.
`tests/gallery.html` shows every component on one page (open from the Pages URL or a throwaway server).

## 7. Tests
Add a suite file `tests/tests-<name>.js` (already listed in tests/harness.js SUITES), import `describe, it, assert` from `./harness.js`, and list requirement ids in `covers`. Use a throwaway DB name and `setStoragePrefix` (D-077). UI tests may call `registerScreen` after `__reset()` from router.js.

## 8. File ownership
See the ownership map in the common rules. Do not edit the shell, core or seed files; raise a finding instead (A12 fixes).
