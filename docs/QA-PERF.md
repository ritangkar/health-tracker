# QA-PERF: performance QA (A11)

Agent A11. No app file was edited. Date of run: 2 Oct 2026. Repo state: A1-A10 (seed has 44 of 900 foods).

## 1. How this was measured, and the limits of it

- Headless Chromium 141 (Playwright), one vCPU, 4 GB RAM. Static files came from a local HTTP/2 + gzip server that can add latency and a bandwidth cap. Network cases: LAN, "good 4G" (50 ms, 9 Mbps), "slow 4G" (150 ms, 1.6 Mbps).
- "4x" means Chromium CPU throttling at 4x. It is a rough stand-in for a mid-range phone. It is **not calibrated** against any real device. Treat 1x as a floor and 4x as a plausible phone-class figure. No real phone was used.
- Dataset (all synthetic, `tests/fixtures/perf-generator.js`, every record passes `validate.js`): per profile 730 day rows, 4,000 food logs, 500 workouts, 700 sleep logs, 300 measurements, 26 check-ins x 4 photos (about 340 KB each). Two profiles: 8,000 food logs, 208 photos, about 72 MB stored. The 150 MB variant has 55 check-ins per profile (440 photos, 154 MB), which is both users checking in every two weeks for two years.
- Times are medians of single runs unless stated; run-to-run spread on cold load was about +/- 15%.
- My memory sampler (process tree PSS) competes for the single vCPU. All 4x backup/import timings below are sampler-free reruns; the earlier sampler-contaminated figures were discarded.

## 2. Timing table (measured vs target)

| Item | Target | 1x CPU | 4x CPU | Verdict |
|---|---|---|---|---|
| Shell JS+CSS+HTML, raw | <= 500 KB | 640 KiB (655,384 B, 101 files) | n/a | **Over by 28%** |
| Shell, gzip (what Pages sends) | n/a | 219 KiB (223,791 B listed files) | n/a | Fine |
| Seed total | <= 2 MB | 83 KB now (44 foods) | n/a | Pass. 1,400 foods about 0.9 MB, 2,500 foods about 1.6 MB (projected from 581-628 B per food) |
| Largest single file | none near 25 MB | 46 KB (`js/ui/components.js`) | n/a | Pass |
| Cold launch to Today (picker, tap, Today) | < 1 s | 877 ms | LAN 2.5 s; good 4G 2.5 s; slow 4G 4.5 s | **Fail at 4x**, borderline at 1x |
| Warm launch, new tab, picker, tap, Today | < 1 s | 463 ms | 1.9-2.2 s | **Fail at 4x** |
| Warm reload, same tab (skips picker) | < 1 s | 384 ms | 1.1-1.2 s | Marginal fail at 4x |
| Offline reload / offline via picker | works | 187 / 428 ms | 0.5-0.7 s / 1.8-2.2 s | Pass (works) |
| Requests on any launch | n/a | 117 (103 JS modules) | same | See F-A11-01 |
| Food search, worst keystroke, 1,400 foods | < 50 ms | 4.8 ms | 9.2 ms | Pass |
| Food search, worst keystroke, 2,500 foods + 200 custom | < 50 ms | 3.9 ms | 7.0 ms | Pass |
| Typing "chicken curry" (13 keystrokes, total engine time) | n/a | 0.9 ms | 4.3 ms | Pass |
| Seed JSON parse + index build, 2,500 foods | n/a | 4 + 24 ms | 23 + 105 ms | Pass |
| Seed index heap, 1,400 foods | n/a | +1.3 MB | +1.3 MB | Pass |
| First content, Today / Food (busy day, 14 entries) / Workout / Body hub | n/a | 13-19 ms | 51-65 ms | Pass |
| Body graph (150 points) first content / long task | n/a | 23 ms / 0 | 86 ms / 65 ms | Pass |
| Trends, 24 period x metric combinations | n/a | max 45 ms | 35-125 ms (worst: 3 Months, Calories) | Pass |
| Notes list (150 notes per profile, 40 shown) | n/a | 21 ms | 74 ms | Pass |
| Progress list, 26 check-ins, 104 thumbnails | n/a | 65 ms first card, 202 ms settled | 317 ms first card, 679 ms settled, one 236 ms long task | Works; see F-A11-04 |
| Compare / Check-in detail | n/a | 18 / 19 ms | 74 / 81 ms | Pass |
| Water +1 tap: handler / first DOM change | < 100 ms | 0.1 / 5.6-10.9 ms | 0-1.2 / 26-51 ms | Pass |
| Done as target / Mark all as target: first DOM change | < 100 ms | 3.7 / 3.5 ms | 21.5 / 10.8 ms | Pass |
| Stepper (water sheet) handler | < 100 ms | 0.4 ms | 3.5 ms | Pass |
| Animations | <= 300 ms, none looping | max token 300 ms, none infinite | n/a | Pass |
| 12 MP photo (4000x3000) to 1600 px JPEG | n/a | 240-250 ms | 830-980 ms | Pass |
| Five 12 MP photos in a row | n/a | 1.05 s total | 4.7 s total | Pass |
| Backup: estimate (Prepare screen size line) | n/a | 0.26 s | 0.6-0.8 s warm | Pass (see F-A11-03) |
| Backup: prepare 161.6 MB zip, 440 photos | n/a | 2.3 s | 10.2 s | Pass |
| Backup: JSON only (8.0 MB) | n/a | 0.33 s | 1.5 s | Pass |
| Import: open and verify 440 photos | n/a | 2.6 s | 12.0 s | Pass |
| Import: preview | n/a | 0.5 s | 1.5 s | Pass |
| Import: merge apply, 13,542 writes (earlier, with sampler) | n/a | 2.2 s | upper bound 15.6 s | Pass |
| Import: replace over an existing 154 MB database | n/a | 7.4 s | upper bound 34 s | Pass |

### Time to Today by network (4x CPU)

| Case | Cold (first ever load) | Warm new tab | Warm reload | Offline new tab |
|---|---|---|---|---|
| LAN | 2.5 s | 2.2 s | 1.2 s | 2.2 s |
| Good 4G | 2.5 s | 1.9 s | 1.1 s | 1.8 s |
| Slow 4G | 4.5 s | 1.9 s | 1.2 s | 2.1 s |

Cold transfer is 276 KB gzip. Warm and offline loads transfer 0 bytes (all 117 requests served by the service worker), yet still take 1.9-2.2 s at 4x. So the warm cost is CPU (loading and starting 103 modules), not network. Profile of a warm start at 4x: 733 ms native work (parsing and instantiating modules), 348 ms of app JavaScript, 751 ms idle, and five dependent request waves.

## 3. What was verified as good

- **Search** is far inside the 50 ms target at 2,500 foods plus 200 custom foods, including alias queries (`bhat`, `chawal`) and a miss. In-memory prefix index; heap cost is small.
- **Today reads exactly what D-041 says**: one settings row, one day row, and the food, workout and sleep logs of that date (5 transactions, 13 rows on the 2-year dataset). Food for a 14-entry day: 43 rows. Range reads for Trends touch only the requested range and only that profile (key ranges on [pid, date]); the 3-month Calories read returned 483 rows.
- **Photo lists load thumbnails only** (about 10 KB each on the synthetic set, versus about 340 KB full). Compare loads 8 thumbs, Check-in detail 4, full blobs only on request. Object URLs are revoked when leaving the screen (observed 104 and 8 revocations on the next route).
- **Backup is memory-safe by design and in practice**: photo bytes travel as Blob slices; no whole-archive ArrayBuffer. JS heap grew +17 MB while preparing 154 MB (1x), +64 MB while opening (mostly parsing the 8 MB `backup.json`), +67 MB for Replace. Process-tree memory stayed about 250-340 MB throughout.
- **Import is all-or-nothing under load**: a failure injected at write 6,771 of 13,542 left every store empty; a simulated low-space device refused with `I_SPACE` in under 0.2 s before writing; the post-import check matched every store count and 148,923,328 photo bytes exactly.
- **Storage banners**: 250 MB or 50% gives amber; 400 MB or 80% gives red; 240 MB of 500 MB stays ok; no estimate gives no storage banner. The photo-add guard refuses when free space is under 2x the photo size. Banner texts shown: "Storage is getting full..." and "Storage is almost full...".
- **No windowing needed at current sizes**: lists are paged ("Show more": Notes 40, Progress 30, Exercises 60, Add food 60, My foods 100). DOM stays under 650 elements on every measured screen.

## 4. Findings

Severity: major = misses a stated target in normal use; minor = polish or hygiene; info = for decision.

| ID | Severity | Owner | Summary |
|---|---|---|---|
| F-A11-01 | major | A3 (app.js), A4/A5/A6 (register and styles files), A1 (seed.js), A12 | **Everything is loaded at boot.** `loadFeatures` starts all 11 feature `register.js` imports immediately; each statically imports its screens, giving 117 requests and 103 modules before the picker appears, in about five dependent waves. `loadFeatures` also does a redundant `fetch()` before each `import()`. The three `styles*.js` files `await` a stylesheet at module top level. `loadSeed` fetches the manifest and then each file one after another. Result: Today at 2.2-2.5 s at 4x even with no network. Suggested fix: register only the picker and Today at boot and load the other registers by route prefix on first visit (`#/food`, `#/workout`, and so on); delete the pre-`fetch`; drop the top-level `await` (link feature CSS from `index.html` or let it load without blocking); fetch seed files with `Promise.all` and do not hold the picker or Today for the food files (only search needs them). Optionally add `<link rel="modulepreload">` for the critical modules (allowed by the CSP). Expected effect is large but unverified. Red tests: OPEN F-A11-01a, OPEN F-A11-01b. |
| F-A11-02 | minor (decision) | owner / A12 | Shell is 640 KiB raw against a 500 KB budget, 219 KiB gzipped. GitHub Pages serves gzip, so users never download 640 KiB. Either record a decision that the budget is gzip-based, or trim. Guard test caps raw at 750 KB. |
| F-A11-03 | minor | A4 | The Backup screen reads every exported row (8,000-12,800 rows) and stringifies it just to show a size line (long task 56 ms at 1x, 180 ms at 4x). Compute the estimate on demand or from `countStores()` plus photo metadata. The Storage screen is fine (29 rows at 1x). |
| F-A11-04 | minor | A5 | Progress list opens one transaction per check-in for photo metadata (26 for 26 check-ins) and decodes all 104 thumbnails at once (one 236 ms long task at 4x). Use one read over the `pid_date` index and group in memory; add `loading="lazy"` and `decoding="async"` to thumbnails. |
| F-A11-06 | minor | A2 | Open and verify takes about as long as prepare (12 s vs 10 s at 4x). Each photo gets a pure-JS CRC32 and then SHA-256. If profiling on a real phone shows CRC dominates, skip the CRC when the SHA-256 matches. **Unproven; measure before changing.** |
| F-A11-07 | minor | A4 | Water +1 rebuilds all eight top-level Today sections (hero, macros, every tile) and re-reads 5 stores, although only the water tile changed. Cost is small (26-51 ms at 4x) but focus and scroll are reset each time. The brief asks for subtree-only re-render. Red test: OPEN F-A11-07. |
| F-A11-08 | risk | A5 | A very large camera photo (48 MP, about 190 MB decoded) is decoded in full before the two-step downscale. Not measured; may crash on low-memory iPhones. Test with the highest camera mode on a real phone; consider `createImageBitmap(file, {resizeWidth})` where supported. |
| F-A11-09 | info | owner | Both users checking in every two weeks for two years reaches about 150 MB, which is the "large backup" warning line, so the warning will be seen by normal users. Keep its wording calm. |

Retracted: **F-A11-05** (reported earlier as an unexplained 8.3 s `estimateBackup` at 4x). It did not reproduce: 0.6-0.8 s warm. It was caused by my memory sampler competing for the single vCPU. My earlier claim that the Storage screen read 4,721 rows was also wrong: that count came from the Backup screen's reads finishing after navigation. Only the Backup screen is affected.

## 5. Recommendations (in order)

1. Fix F-A11-01 first; it is the only finding that misses a target in normal use.
2. Decide F-A11-02 (gzip budget) so the number stops being a false alarm.
3. Fix F-A11-03, F-A11-04 and F-A11-07 (small, local changes).
4. Real-phone checks (owner, section 7). If the iPhone import of a 150 MB zip fails, pull the V1.1 staged import forward; otherwise keep the single transaction. I cannot say where iOS import starts to fail: nothing here ran on iOS. What the data does show is that the design does not hold photo bytes in JavaScript memory, so the risk sits in how WebKit handles a single transaction with several hundred blob writes.
5. Keep `tests/tests-perf.js` in the suite; re-run with `?perf=full` after the rework.

## 6. Tests added

`tests/tests-perf.js` (already named in harness SUITES by A1). Light scale by default, about 10 s of the whole-suite run; add `?perf=full` to `tests/index.html` for 2 profiles x 730 days and a 154 MB-class backup round trip (the backup test skips with a console warning when the window's storage quota is under about 480 MB, as in a private window).

Whole suite on the real repo (light): 339 passed, 10 failed of 349. The 10: 2 known C-046, 5 open A9 findings, and 3 intentional A11 reds (OPEN F-A11-07, OPEN F-A11-01a, OPEN F-A11-01b). `tests/tests-ui-qa.js` is not in SUITES yet (F-A10-14), so its 4 intentional reds are not counted. Full scale: same 10 failures, 339 passed.

## 7. What could not be measured, and why

- **Any real phone** (iOS or Android): none available. All phone-class numbers are throttled desktop Chromium.
- **iOS limits** for Blob slices in one transaction, canvas memory, and the import failure point.
- **48 MP photos** and camera capture: no camera. The 12 MP test used a synthetic image whose output (114 KB) is smaller than a real photo's (D-018 expects 200-400 KB), so output-size limits are only weakly exercised.
- **Scroll smoothness and frame rate**: headless Chromium without a real display pipeline. Only mutation counts and long tasks were observed (none over 236 ms; none on the main flows).
- **Layout thrash**: no trace of forced layouts; only DOM mutation counts (16 per water tap).
- **Food search DOM paint**: the engine was timed (under 10 ms), but not the cost of drawing up to 60 result rows per keystroke, nor the on-screen keyboard.
- **Real seed at 1,400 foods**: the seed has 44 foods. Search used synthetic foods with realistic names and aliases; real alias quality is A9's area.
- **Service worker update flow under load**, and **Safari/Firefox** timings.

## Appendix A. Per-file sizes (bytes raw, bytes gzip)

Shell files listed in `WA_PRECACHE` plus `sw.js` (total 655,384 raw, 225,122 gzip):

```
    1293      653  config.js
    2152      854  css/base.css
   18478     3808  css/components.css
    4294     1306  css/screens.css
    3601     1343  css/tokens.css
    1486      607  index.html
   17184     5444  js/app.js
     496      338  js/boot-theme.js
   10735     3913  js/core/backup.js
   11067     3647  js/core/calc.js
    3750     1512  js/core/dates.js
    7269     2373  js/core/db.js
    5921     2326  js/core/dom.js
   31831     9437  js/core/import.js
    3418     1416  js/core/migrate.js
   34879     9381  js/core/repo.js
   17195     5465  js/core/router.js
    9270     2965  js/core/seed.js
    7069     2253  js/core/storage-health.js
    1034      517  js/core/store.js
    1910      767  js/core/units.js
   24849     7037  js/core/validate.js
    1047      491  js/features/analytics/load.js
    9242     3152  js/features/analytics/metrics.js
    1514      765  js/features/analytics/notes-model.js
    4395     1758  js/features/analytics/notes.js
    1199      667  js/features/analytics/popover-fit.js
     697      312  js/features/analytics/register.js
    3160     1381  js/features/analytics/screens-w3.css
     696      448  js/features/analytics/styles-w3.js
    4423     1893  js/features/analytics/trend-chart.js
   10264     3687  js/features/analytics/trends.js
    4642     1809  js/features/body/add-measurement.js
    3218     1337  js/features/body/body-hub.js
    4845     1988  js/features/body/measurement-graph.js
     855      330  js/features/body/register.js
    4476     1807  js/features/body/series.js
    4672     1753  js/features/checkins/averages.js
    3249     1332  js/features/checkins/banner.js
    7393     2834  js/features/checkins/detail.js
    5537     2166  js/features/checkins/progress-hub.js
     997      393  js/features/checkins/register.js
    4562     1877  js/features/checkins/save.js
   15177     5231  js/features/checkins/wizard.js
     753      374  js/features/daily/register.js
    4721     2074  js/features/daily/shared.js
   14051     4143  js/features/daily/sheets.js
    1585      762  js/features/daily/summary.js
   10250     3562  js/features/daily/today.js
   14305     4621  js/features/food/add-food.js
    2246     1001  js/features/food/common.js
   11055     4005  js/features/food/custom-food.js
    4801     1862  js/features/food/custom-model.js
    6077     2287  js/features/food/entry-edit.js
    5176     2052  js/features/food/food-tab.js
    7229     2536  js/features/food/my-foods.js
    4688     1889  js/features/food/quick-add.js
   15017     5012  js/features/food/recipe-builder.js
    4880     1888  js/features/food/recipe-model.js
     812      323  js/features/food/register-w2.js
     766      327  js/features/food/register.js
    5618     2262  js/features/photos/compare.js
    4352     1874  js/features/photos/image-pipeline.js
     367      229  js/features/photos/register.js
     917      435  js/features/photos/url-bag.js
    1597      763  js/features/photos/viewer.js
    7417     2756  js/features/profile/picker.js
     313      205  js/features/profile/register.js
    6531     1528  js/features/screens-w1.css
    5650     1558  js/features/screens-w2.css
    6593     2833  js/features/settings/about-screen.js
    5486     2154  js/features/settings/backup-screen.js
    1401      687  js/features/settings/common.js
    3056     1325  js/features/settings/display.js
    3013     1229  js/features/settings/hub.js
   22006     6606  js/features/settings/import-wizard.js
    3570     1483  js/features/settings/install-screen.js
    1786      533  js/features/settings/register.js
    1835      877  js/features/settings/safe-mode.js
    3574     1439  js/features/settings/storage-screen.js
    4230     1757  js/features/settings/targets.js
     786      487  js/features/styles-w2.js
     754      479  js/features/styles.js
    2818     1281  js/features/workout/choose.js
    1761      807  js/features/workout/common.js
    9102     3323  js/features/workout/exercise-form.js
    6572     2544  js/features/workout/exercise-library.js
    3653     1507  js/features/workout/past-session.js
   11272     4091  js/features/workout/plan-editor.js
    3118     1286  js/features/workout/plan-model.js
    4592     1769  js/features/workout/plans-list.js
    1079      382  js/features/workout/register-w2.js
     764      326  js/features/workout/register.js
   13612     4094  js/features/workout/session.js
    3105     1337  js/features/workout/workout-tab.js
    9658     3282  js/lib/zip.js
   12482     4353  js/ui/charts.js
   46050    13448  js/ui/components.js
    3256     1602  js/ui/icons.js
    3086     1331  sw.js
    4699     1369  version.js
```

Seed files (raw):

```
    2665  data/ATTRIBUTION.md
    2713  data/categories.json
   38228  data/exercises.json
   27641  data/foods-starter.json
     571  data/meal-categories.json
    1771  data/measurement-types.json
    7854  data/plans.json
    1453  data/seed-manifest.json
```
