# QA-DATA: data integrity, persistence, import/export, seed (A9)

Scope: A9 test plan. App and data files were not edited. Synthetic data only.
Run on the repo as delivered to A9, in headless Chromium 141 (Playwright) against a throwaway static server.

## How to run

Open `tests/index.html` on the deployed site or a static server. `tests-data.js` is in the harness `SUITES` list and loads `tests-seed.js` itself, so one page runs everything.
Results are in the page and in `window.__results`. A9 report numbers (seed counts, Atwater list, serving oddities, weekday hits) are in `window.__a9`.

## Result

| Run | Passed | Failed | Notes |
| --- | --- | --- | --- |
| A1-A8 suites on the real repo (baseline) | 243 | 2 | The 2 are the known C-046 isolation failures in `tests-backup.js` |
| `tests-seed.js` | 25 | 2 | Both red on purpose: SEED-GAP (count) and SEED-GAP (brief foods) |
| `tests-data.js` including seed (85 tests) | 80 | 5 | 2 SEED-GAP, 3 findings F-A9-01, -02, -03 |

Red tests are findings, not test bugs. Each names its finding id. They go green when the owner fixes the cause.

## Findings

| Id | Severity | Owner | Finding | Test |
| --- | --- | --- | --- | --- |
| F-A9-00 | Blocker for FR-009..011 | A7.1-A7.9 | Seed has 44 of 900 minimum foods (5%). 13 of 13 foods named in the brief are absent: aloo posto, shukto, cholar dal, luchi, chow mein, shorshe, bhapa, fried rice, noodles, pizza, burger, mutton curry, egg curry. No food in the seed is Chinese, Thai, Japanese, pizza, burger or Bengali sweet beyond rasgulla. | SEED-GAP x2 |
| F-A9-01 | Medium | A2 or A12 | `applyImport` does not invalidate the seed overlay (`seed.invalidateOverlay`). Right after an import, custom foods, recipes, exercise and plan copies and hidden-seed lists from the backup are not visible in search or lists until the page is reloaded. `import-wizard.js` Done goes to `#/today` without reload when a profile is active. Fix: call `invalidateOverlay()` after commit in `applyImport` bookkeeping. | F-A9-01 |
| F-A9-02 | Medium | A1 or A12 | `validateRecord` is too lenient for a backup whose checksum is valid (a hand-edited or buggy file). Accepted: food log `totals.kcal` -10; `totals.kcal` 99999 not equal to qty x per1serving; `per1serving.protein` -3; workout `kcalTotal` -50; workout item `pct` 250; `bodyWeightKg` 2; measurement `unit` lbs; settings `glassMl` 100000. Add: non-negative and finite per-serving and totals, totals equal qty x per1serving within rounding, `pct` 0-100, `kcalTotal` >= 0, `bodyWeightKg` 20-400, unit equals the type's canonical unit, `glassMl` 50-2000. Keep unknown keys allowed. | F-A9-02 |
| F-A9-03 | Low (rare) | A2 or A12 | Merge with a photo slot clash: if the backup check-in is newer but its photo is older than the local photo in the same slot, the check-in is written with a photo id that is dropped by the clash rule. The check-in lists a missing photo and the surviving local photo is not listed by it. Import verification still says OK. Fix: when a photo loses a slot clash, rewrite the winning check-in's `photos[]` to the surviving id, or reject the clash for photos whose check-in is written. | F-A9-03 |
| F-A9-04 | Minor | A4 or A12 | Import wizard step 2 says damaged photos can be imported without "in a later step", but no step asks. `applyImport` is always called with `damagedPhotos: 'import-without'` and `invalid: 'skip'`. The engine is safe (it demands the choice) and the user can Cancel at step 2, but the text promises a choice that does not exist. Change the text or add the choice. | read from code; engine tests pass |
| F-A9-05 | Minor | A4 or A12 | Step 2 shows "This backup was made by an older version and is brought up to date in memory first." for a backup of the CURRENT schema (fixture v1, schema 1). `pv.migration.applied` is an empty array, which is truthy. Use `applied.length`. | seen in the UI run |
| F-A9-06 | Info | A12 | Check-in photo references resolve but `getPhotoBlob` for a missing full photo returns null; UI copy for that case is A5's open finding F-A5-06. Not re-tested. | n/a |

Not a finding: the A9 prompt says 21 named exercises; the brief names 20 (C-043). All 20 are present.

## Coverage table (A9 plan)

| Plan item | Result | Where |
| --- | --- | --- |
| Persistence: refresh, full restart | Pass, real app, persistent browser profile closed and reopened: 1 profile, steps 5,830, water 6, 1 food log kept; picker lists the profile | `ui` run (manual script, below) and `tests-data.js` reopen test |
| IDB auto-reopen, versionchange | Pass | tests-data |
| Sentinel + empty IDB -> Restore | Pass in the real app: `#/restore` "Your saved data could not be found on this device" | tests-data and `ui` run |
| Write-through | Pass: second raw connection sees the row once the save resolves. A real kill-the-tab test was not run | tests-data |
| pid isolation: grep, two profiles, wrong-profile writes, third profile | Pass | tests-data |
| Snapshot immutability: food edit/delete/hide/archive, exercise, plan, step goal, plan delete, targets | Pass, deep-equal, recompute from snapshot | tests-data |
| Completion 7/10=70, 20/30=67, 22/30=73, manual, D-071 | Pass | tests-data |
| kcal formula, override order, per-side, weight scaling | Pass | tests-data |
| Recipe per-serving equality, rounding 0.1, fiber null | Pass (6-decimal tolerance noted) | tests-data |
| Effective-dated targets, null vs 0 | Pass | tests-data |
| Round trip counts and values, rich dataset (2 profiles, 400 food logs, 60 workouts, 8 check-ins x 4 photos) | Pass, content hash per store incl. photo bytes; second export identical | tests-data |
| Merge twice | Pass | tests-data |
| Conflict rules, 6 stores x newer/older/tie x 3 preferences (54 cases) | Pass | tests-data |
| Natural-key clash (sleep), same-name foods | Pass (sleep in A2 suite); same-name foods pass here | tests-data, tests-backup |
| Profile mapping | Pass: re-homed in every store, skip, create | tests-data |
| Replace exact | Pass | tests-data |
| Injected failure in apply, merge and replace, first/middle/last write and before commit | Pass: every store and meta unchanged; next import works | tests-data |
| Truncated, corrupted, bad checksum, wrong format, newer schema, unknown formatVersion, count mismatch | Pass, zero writes, correct codes | tests-data |
| Invalid records with recomputed hash | Pass for what the validator checks; see F-A9-02 for what it does not | tests-data; UI preview run |
| Damaged photo (flipped byte, missing file, missing thumb) | Pass: user must choose, import without keeps metadata and good photos | tests-data |
| JSON-only import keeps photo bytes | Pass | tests-data |
| Post-import verification catches mismatch | Pass | tests-data |
| lastBackupAt not set by import; export excludes meta, seed, LocalStorage; exportCategories | Pass | tests-data |
| Migration fixtures, framework, failing live step | Pass | tests-data |
| Photos: limits, resize, thumb, EXIF/GPS stripped, orientation, orphan scan, cleanup, cascade, quota | Pass | tests-data |
| Seed validator, ids, names, Atwater, fiber, servings, aliases, estimate, verified | Pass | tests-seed |
| Seed counts equal manifest, seedVersion equals version.js, size <= 2 MB | Pass (counts); 900 minimum FAILS (F-A9-00) | tests-seed |
| Six plans exact, 20 exercises | Pass | tests-seed |
| Search fixtures (71 queries) | 58 present-food queries pass; 13 brief-food queries fail (F-A9-00) | tests-seed |
| No-weekday grep, whole repo | Pass, see below | tests-data |
| Precache lists every runtime file | Pass in the delivered repo (A4-A6 findings applied) | tests-data |

## Seed quality report (44 foods)

- By category: grain-rice 6, dal-legume 5, fruit 4, bread-roti 3, dairy 3, veg-dish 3, oil-spice-condiment 3, snack 3, egg 2, chicken 2, beverage 2, veg-raw 2, sweet-dessert 2, and one each of fish-seafood, paneer-dairy-dish, packaged, noodles-rice-dish. Categories with zero foods: mutton-red-meat, soup-salad, fast-food, pizza-burger-sandwich.
- By cuisine: indian 30, other 11, bengali 3. No chinese, japanese, thai, continental, italian or american foods.
- HARD validator problems: 0. Atwater outliers (more than 25% and more than 50 kcal): none. Duplicate ids or names: none. Verified without a source: none (0 verified). Restaurant or street foods not marked estimate: none.
- Problem items for A12: none in the 44 foods. The gap is quantity and cuisine coverage (A7.1-A7.9).
- Search spelling gaps found: none among foods that exist. `machher jhol`, `macher jhol`, `maacher jhol`, `fish curry`, `khichdi`, `chapati`, `roti`, `paneer`, `biryani`, `chole`, `doi` all resolve.

## No-weekday grep (whole repo)

Scanned every `.js .css .json .html .md .txt .webmanifest .svg` file for the seven full day names and the seven short names, as words.
Product files (js, css, data, html, manifest, sw, version, config): matches only in `js/core/dates.js` (week-start map and display day names used by `formatDay` and `formatLong`), `js/features/settings/display.js` (week-start option labels), `js/core/validate.js` and `js/core/repo.js` (week-start enum and default). All are allow-listed: week-start setting or date display only. No plan-to-weekday mapping exists. `getDay()` appears only in `dates.js`. No stored record, plan or seed item has a weekday, schedule or rotation key. Behaviour test: each of the six plans was logged on seven consecutive dates in shifting order, twice a day, and no log carries a weekday field. Blockers: 0.
`tests/` and `docs/` matches are test code for the grep, the week-start tests and notes; they are counted, not failed.
Rendered text: the Body hub and other screens show names such as "Thu 1 Oct" through `formatDay`. That is display of a date, not a plan mapping, and is allowed.

## Real-app checks (scripted, not part of the in-browser suite)

1. Persistent browser profile: boot, create a profile, add water, steps and a food log through the repo API, refresh: data intact. Close the whole browser, reopen with the same profile: data intact, picker lists the profile. `navigator.storage.persisted()` was false (the app asks only after first save in a real session; not a fault).
2. Delete the IndexedDB while the LocalStorage sentinel remains, reload: app lands on `#/restore` with the right text and the Restore and Start fresh buttons.
3. Import wizard with a crafted JSON (valid SHA-256, one food log with quantity 0 and one measurement of -5): step 1 accepts the file, step 2 preview says "2 items in this backup are not valid. They will be skipped.", step 3 lists both backup profiles with Add / Merge / Do not import. No console errors.

## Reasoned only (not run)

- Real iPhone and Android: persistence after eviction, Web Share, installed-app storage split (R-002, R-015, R-019).
- Killing a tab in the middle of a save (write-through is shown by a second connection, not by a process kill).
- A 150 MB backup and quota mid-import on a real device (A11).
- The wizard steps 4-7 with a crafted file were not driven through the UI; the engine behind them is covered by the suite.
- Seed accuracy of nutrition values against real foods (A9 checks internal consistency only).
- `StorageManager.persist()` result on real browsers.

## Mutation checks

A mutation is a deliberate bug put into a copy of the repo; a good suite turns red. Results were read by hand (baseline red tests excluded).

| Mutation | Result |
| --- | --- |
| Completion rounds down instead of rounding | Caught (completion test) |
| Conflict tie treated as newer | Caught (conflict matrix) |
| DB transaction does not abort on error | Caught (wrong-profile writes, injected failure) |
| Restaurant food marked typical | Caught (seed estimate rule) |
| Duplicate food id | Caught (seed id uniqueness) |
| Check-in delete keeps photo bytes | Caught (cascade delete) |
| Photo pipeline keeps EXIF | Caught (EXIF/GPS test) |
| Edit-food-log recomputes from live master | Caught (snapshot immutability) |
| Sentinel never written | Caught (loss detection) |
| Plank exercise removed | Caught (six plans exact) |
| Replace skips the safety check | Missed at first; caught after adding the safety-backup test |
| Meta store leaks into export | Inconclusive: the injected line did not take effect. Re-check in A12 |
| Pid filter dropped from range reads | Not run |

## Files A9 added

`tests/tests-data.js`, `tests/tests-seed.js`, `tests/fixtures/a9-search-fixtures.json`, `tests/fixtures/a9-repo-files.json` (list of repo files used by the whole-repo greps; regenerate it when files are added), `docs/QA-DATA.md`.
