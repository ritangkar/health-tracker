# QA Functional report (A8) - COMPLETE

Agent A8, 2026-10-02. Scratch copy of the delivered package; no app or data file was edited.
Method: the whole in-browser suite (tests/index.html) in headless Chromium, plus Playwright scripts that drove the real UI (390x844, fresh browser profile per run, service worker blocked except in the service worker script). The Playwright scripts are not in the repo (A8 may add only tests/tests-functional.js and this file); they are delivered separately as `a8-playwright-scratch.zip` for A9 to reuse. Pure checks that do not need a screen are in tests/tests-functional.js.

## Status
All 15 plan items were run. Items that need a real phone, a screen reader or large data stay with A10/A11 and the owner (reasoned-only list below). Findings F-A8-01 to F-A8-15 go to A12. F-A8-13 first.

## Numbers
- Whole suite on the package: 243 passed, 2 failed. The 2 failures are the known C-046 isolation failures in tests-backup.js (lastBackupAt leaks from tests-core). Baseline before A8 was 201 passed, 2 failed. This pass added 11 tests to tests-functional.js (suite 232 to 243): recipe per-serving, custom-food and measurement validation text, check-in averages, Trends week-start buckets, banner order.
- Mutation checks: completion rounding changed from round to floor (4 extra failures), banner order changed (the new banner test failed). Both reverted and verified.
- UI scripts, last complete run of each: 203 checks, 197 pass, 6 fail. The 6 are F-A8-11 (3 lines, 2 distinct checks, run in two scripts), F-A8-13, F-A8-14, and one wrong keyword in my own Settings check (not an app defect). Earlier pass: 85 checks, 24-route smoke clean, 0 console errors, 0 external requests.

| Script | Checks | Pass | Fail |
|---|---|---|---|
| Ten-step flow with tap count | 12 | 12 | 0 |
| Plan editor, past session, Mark all as target | 17 | 17 | 0 |
| Custom food | 9 | 9 | 0 |
| Recipe | 7 | 7 | 0 |
| Check-in wizard, photos | 12 | 10 | 2 (F-A8-11) |
| Compare, delete cascade | 7 | 6 | 1 (F-A8-11) |
| Trends | 38 | 38 | 0 |
| Settings (service worker blocked) | 14 | 13 | 1 (my keyword) |
| Banners and snooze | 14 | 14 | 0 |
| Measurements | 32 | 32 | 0 |
| Estimates, Done as target | 8 | 8 | 0 |
| Import (merge, conflicts, mapping, Replace, damaged file) | 23 | 21 | 2 (F-A8-13, F-A8-14) |
| Service worker, offline, Repair | 12 | 12 | 0 |

## Findings
| ID | Sev | File / area | Reproduction | Proposed fix |
|---|---|---|---|---|
| F-A8-01 | Minor | profile/picker.js | Finish first run: picker shows, not Today (one extra tap). | Select the first profile and go to #/today, or change the spec. |
| F-A8-02 | Minor | food/register.js, entry-edit.js, custom-food.js | #/food/entry/<unknown id> closes silently to #/food; other screens show Not found. Nothing leaks. | Call notFound() for a missing or foreign sheet id. |
| F-A8-03 | Medium | food/add-food.js line 16 (`memory.q`) | Add a food, open Add food again: old query still in the box, Recent/Frequent/Favourites hidden. | Reset memory.q when an add completes or the sheet opens fresh. |
| F-A8-04 | Medium | food/quick-add.js, D-038 | Quick add with calories only: P/C/F stored and shown as 0, Protein 0 / 120 g instead of a dash. | Store untyped macros as null. |
| F-A8-05 | Medium | food/quick-add.js | Calories 250 and protein 5 only: "calories do not match" confirm appears. | Atwater check only when protein, carbs and fat are all entered. |
| F-A8-06 | Minor | food/quick-add.js | "From a label": stored confidence typical, no source, no "from label" chip (C-025, C-029). | Store source.type='label' and show the chip. |
| F-A8-07 | Info | daily/summary | Day fat 30.2 vs exact 30.13 (entries rounded to 0.1 before summing). | Document only. |
| F-A8-08 | Minor | daily/sheets.js (steps) | Button reads "Go back to the plan or default goal"; spec says "Use plan goal". | Align wording. |
| F-A8-09 | Info | settings/backup-screen.js | No-photo backup downloads as .json (zip only with photos). Matches D-033. | None. |
| F-A8-10 | Minor | workout/plans-list.js | Editing a default plan moves it to the bottom of the Plans list; Reset to default restores its place. | Keep the original position for a copy-on-edit plan. |
| F-A8-11 | Minor | checkins/wizard.js step 1 | With a logged weight (81.4 kg, 28 Sep) and body fat (24%), the weight box is empty and only a hint shows ("Last weigh-in 81.4 kg on 28 Sep"). No body-fat hint at all. D-059 says prefilled with dates. | Prefill or hint both, with dates. |
| F-A8-12 | Minor | settings/import-wizard.js line 86 | "Made by an older version and brought up to date" shows for every backup, even at the current schema. `migration.applied` is an array and an empty array is truthy. | Use `applied.length > 0`. |
| **F-A8-13** | **Medium** | settings/import-wizard.js lines 119-128 | On the "How to import" step choose Replace everything with both profiles mapped: uncaught TypeError (Cannot read properties of null). The loop sets `W.profileMap = null`, then the next iteration reads it. `repaint()` never runs, so the Replace warning and the "Next: safety backup" label do not appear. The import itself still completes correctly. | Compute `some(m => m.action === 'map')` once, then set null, before repaint. |
| F-A8-14 | Minor | settings/import-wizard.js step 7 text | After Replace with a safety backup, the result says "Import did not change your last-backup date", but saving the safety backup does set it. | Reword ("The import itself did not...") or do not record the safety backup. |
| F-A8-15 | Minor | settings copy for I_CHECKSUM | The damaged-file message ends "Your data was not changed. Your data was not changed." (catalog text plus an appended sentence). | Drop the duplicate sentence. |

Unconfirmed observation (O-A8-1): in the recipe ingredient step, the macro preview did not refresh after a scripted fill until the field lost focus. Not confirmed with real typing. Check that the input handler listens to `input`, not `change`.

## Coverage by test-plan item
| Plan item | State | Notes |
|---|---|---|
| 1 First run, picker, isolation | Run | Install guidance, 1-tap picker, refresh keeps session, Switch profile, other profile's data not visible, unknown ids. F-A8-01, F-A8-02. |
| 2 Ten-step flow, tap count | Run | 14 taps: picker 1, food 3, water 1, steps 2, workout 4 (open choose, pick plan, Mark all, Done), sleep 3 (open, quality, Save). Today then shows 195 kcal, 5,830 / 7,000 steps (83%, from plan), water 0.5 L, sleep 7h 25m, quality 4, workout 100%, exercise kcal ~18 est. No console error, no external request. Passes the 10-step intent; the budget I set (15) is my own, not a spec number. |
| 3 Food | Run | Search variants, serving selector, grams, 0.25 step, meal by clock, Add and keep searching, recents/frequent/favourites, totals vs hand calculation, quick add, edit, warning, delete and Undo. Custom food: HARD texts (951 kcal, macro 101, macro sum 105), SOFT Atwater confirm, Save and log now (Lunch 180 kcal), found by name and alias, from-label chip, editing the master left the logged 180 and new logs used the edited value. Recipe: 3 ingredients, 4 servings, 717 total, 179 per serving, logging 1 serving gave 179, 4 servings previewed 717. F-A8-03..06. |
| 4 Estimates | Run | est. on exercise kcal, approx. on servings, quick add offers "From a label" and "My estimate", fibre shows "partial - Fibre total is incomplete" when a food has no fibre. |
| 5 Workout | Run | 70, 67, 73 at calc level; session mean; manual % 0-100 only; ranges; stretch chip; each side; alt switch frozen; Rest; several sessions a day; weight prompt; kcal override. Done as target on one row sets that row to 100% and leaves the others "Not entered". Mark all as target gives 100%. Plan editor: rename, add, remove, reorder by buttons and by real pointer drag, target and kcal edits, step goal 8,000, duplicate, delete with confirm ("already logged ... stay exactly as they are"), Reset to default, delete a default and Restore. The past session text was identical after every edit; a new session used the new targets. F-A8-10. |
| 6 Steps, water, sleep, notes | Run | Goal follows the plan, manual goal wins, 5 glasses = 2,500 ml = 2.5 L = 83%, sleep wake-date rule, null vs 0. |
| 7 Validation | Run | Many catalog codes reached from the UI or at function level with exact text: steps, sleep, water, note, weight, targets, kcal, manual %, custom food, and measurements (12 HARD, 4 SOFT, nothing stored before confirm). The water stepper and note box clamp or limit input, so those HARD messages are function-level only. |
| 8 Measurements | Run | All 6 V1 types saved, decimal comma, multiple per day (latest wins), ranges 1M/3M/6M/1Y/All, Latest/Previous/Change, Trend only at 5+ points and labelled, 4 points no Trend, 1 point prompt, body fat approx., height as a value list. |
| 9 Check-ins | Run | 4 steps; photos 4 slots (no fifth); averages "8,000 steps avg over 3 of 7 days" and "left out, not counted as zero"; Recompute present; save is atomic; the weight also becomes a Body reading; compare shows 14 days apart and the missing-photo placeholder; delete asks about the photo and removes check-in, photo and photo data together (counts 3,3,2 to 2,2,1). F-A8-11. |
| 10 Trends | Run | Week/Month/3 Months for all 10 metrics render; target line (7,000 steps, 1,900 kcal); n of N days; so far; table toggle; empty state; week-start Sunday vs Monday changes the weekly buckets. |
| 11 Targets | Run | Fixed clock: 28 Sep keeps 1,900, today uses 2,200, 499 rejected. |
| 12 Settings | Run | Theme persists across reload, reminders persist, Open last profile toggle, storage usage and "Not protected" with Protect my data, install and updates, Check for update ("You have the latest version"), Repair app keeps profiles and data and the service worker and caches come back, Self-check (versions match, offline ready, no missing files, no CSP violations, orphan counts). |
| 13 Backup and import | Run | Prepare, size, warning box, download; corrupt, not-a-backup, truncated and newer-version rejected; merge with Keep newest / Keep mine / Use the backup; merging the same file twice adds nothing; profile mapping (Add as new plus Do not import gave 3 profiles); Replace needs a safety backup (Next disabled until saved or skip is ticked), safety file contains the current data, Replace result matches the backup; explicit skip path works; a backup with a changed record is rejected by the checksum and nothing changes. F-A8-12 to F-A8-15. |
| 14 Banners | Run | One banner at a time; order storage-red, update, backup, install, check-in; dismiss snoozes backup about 24 h; snooze holds after refresh and ends on expiry; no reminder when nothing changed; interval Off respected; banner does not block input. Update, storage-red and check-in banners were put into the real banner registry; their real triggers were not exercised. |
| 15 Weekday grep | Run | js/css/data/html/README: only the week-start labels and date-format names in dates.js and display.js. No http(s) URLs, no XHR, no WebSocket, no innerHTML. Also a test in tests-functional.js. |

## Worked-example table (expected vs actual)
| Case | Expected | Actual |
|---|---|---|
| Rice, white, 1 cup (160 g) | 208 kcal, P 4.3, C 45.1, F 0.5 | same |
| Egg, boiled, 2 x 1 egg | 155 kcal, P 12.6 | same |
| Toor dal 1.5 x 1 bowl (200 ml) | 219 kcal, P 12.6, C 28.5 | same |
| Macher jhol 1 serving (150 g) | 165 kcal, P 18 | same |
| Roti 3 x 1 roti (40 g) | 360 kcal, P 11.4 | same |
| Day total of the five | 1,107 kcal; P 58.9; C 143.3; fibre 12.8; Breakfast 363, Lunch 219, Dinner 525 | same; fat 30.2 (exact 30.13) |
| 250 g rice by grams entry | 325 kcal | 325 |
| Mishti Doi custom, 120 kcal/100 g, 1 bowl 150 g | 180 kcal; after edit to 200/100 g new log 300, old log stays 180 | same |
| Recipe: 2 cups rice + 2 eggs + 1 bowl dal, 4 servings | 717 total, 179.25 per serving | 717; 179 shown |
| 7 of 10 push-ups | 70 percent, 3.2 kcal | 70, 3.2 |
| 20 of 30 s plank | 67 percent | 67 |
| Session (70, 0, 0, 0, 67) | 27 | 27 |
| Push-up 10 reps at 84 kg | 5.4 | 5.4 |
| Brisk walking 25 min | 112.5 | 112.5 |
| Running 22 min | 220 | 220 |
| Water 5 glasses | 2,500 ml, 2.5 L, 83 percent | same |
| Sleep 23:15 to 06:40 | 7h 25m on wake date | same |
| Steps 6,000 / 8,000 / 10,000 on 3 of 7 days | average 8,000, "3 of 7" | same |

22 of 30 minutes = 73 percent holds at calc level (single target of 30). The seed Running range of 20 to 30 uses 20 as the denominator by design (C-047), so 22 shows 100.

## Reasoned-only checks (not run by A8)
- Real iPhone/Android: camera capture, share sheet, keyboard with the full-height food sheet, storage split between Safari and Home Screen, real `beforeinstallprompt`.
- Screen readers, keyboard-only passes, 200% zoom (A10).
- Large data and large photo sets (A11). Photo resize limits and the HEIC path.
- The "invalid records: skip or cancel" and "photos damaged" import screens: a changed backup fails the checksum first, so these need a backup with a recomputed hash (A9).
- Real triggers for the update, storage-red and check-in banners (injected, not produced by the app).
- A new service worker version after a version bump (update flow).
- Seed has 44 foods; A7.1-A7.9 are not run, so search quality at scale is untested.

## Notes for owners
- A12: F-A8-13 first, then F-A8-03, F-A8-04, F-A8-05, F-A8-11, then the minor ones.
- The earlier handoff entries KI-037 and KI-038 (precache and SUITES) are already applied (C-055).
- Scratch scripts: selectors that worked are links for the nav and quick actions, radios for meal chips, and `dialog[open]` for fields. Reload between failed sheet saves because of the unsaved-changes guard.
