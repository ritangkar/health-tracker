# Winter Arc: the whole plan

Version 1.0.0. A human-readable account of what Winter Arc is, how it is built and why. Technical decision numbers (D-001 and so on) refer to `docs/STATE.json`.

## 1. Project overview

Winter Arc is a private health, fitness, nutrition and progress-tracking app for two people. It runs in the browser, keeps all data on the user's own device, costs nothing to host and works offline once opened. Two separate profiles each track food, workouts, steps, water, sleep, body measurements, progress photos, check-ins and notes. It is built to be used every day for years, with history that stays readable.

## 2. Goals

- Rs 0 to build, host and run. No subscription, no backend, no paid service.
- Fast logging: open, pick yourself, log food, water, steps, workout and sleep in a handful of taps.
- Privacy first: data never leaves the device unless the user saves a backup file.
- Honest numbers: estimates are labelled, empty is never shown as zero, history never silently changes.
- Long life: backup and restore with versioning so old files keep working.
- A polished modern look, not a spreadsheet.

## 3. Architecture

A static website made of plain files. A page (`index.html`) loads one script (`js/app.js`) which starts a hash-based router. Screens are functions that return DOM nodes. A small store notifies screens when data changes. Data lives in IndexedDB in the browser. A service worker caches the app files and the food data so the app opens offline. There is no server code, no build step and no network call during normal use.

Layers, bottom to top: IndexedDB wrapper with atomic multi-store transactions; repository (all reads and writes); pure calculation and validation modules; shell (router, components, charts, icons); feature screens.

## 4. Technology stack

Vanilla HTML, CSS and JavaScript ES modules. No build tool, no package manager, no third-party code (D-011, D-012, D-013). Eight stacks were scored (vanilla, Preact with htm, TypeScript, Svelte, Lit, Alpine, Vue via CDN and React via CDN) on Pages compatibility, offline support, IndexedDB support, build complexity, performance, UI quality, maintainability and static output. Vanilla scored highest and, unlike Svelte, TypeScript and React JSX, needs nothing installed. Charts, zip handling, icons, router and the IndexedDB wrapper are written in-house. Type information lives in JSDoc comments. Supported browsers: iOS Safari 16.4 and newer, current Chrome, Edge and Android Chrome, desktop Firefox in a tab.

## 5. Data architecture

User data is split into master data (what a food or exercise is) and logs (what happened). Logs are self-contained snapshots, so changing a master never rewrites history (D-026).

Stores: `profiles`, `settings`, `foods`, `foodPrefs`, `exercises`, `plans`, `foodLogs`, `workoutLogs`, `days` (water, steps, step goal, note), `sleepLogs`, `measurementTypes`, `measurements`, `checkins`, `photos`, `photoData`, and a device-only `meta` store. Every user record carries a profile id. Ids are prefixed (`fd_`, `wl_`, ...); seed ids look like `f:slug` and never change. Dates are local civil dates `YYYY-MM-DD`; times are epoch milliseconds. Empty input is stored as null; zero only when entered (D-038). Targets are effective-dated so changing a target does not alter past days (D-040).

## 6. Storage strategy

IndexedDB holds everything the user creates, including photo Blobs outside the JSON. LocalStorage holds only tiny mirrors (active profile, last-backup date, theme) and is safe to lose. The Cache API holds the app files and the seed only. The app asks the browser to protect its storage after the first saved data, shows usage against the quota (amber from 250 MB or half the quota, red from 400 MB or 80%), keeps the last-backup date, reminds the user to back up, and detects the case where data existed but has vanished and then offers Restore (D-017). The backup file is the only guaranteed safety net, especially on iPhone Safari, which can purge unused sites.

## 7. Food system

About 1,672 foods in 11 JSON files under `data/`: staples, Indian home dishes, a large Bengali set, restaurant and hotel foods (Indian, Chinese, Japanese, Thai, continental, fast food, pizza, burgers, sandwiches, desserts, drinks, snacks) and generic packaged foods. Every food has a source and a confidence level: 825 typical, 847 estimate, none verified. Restaurant and mixed dishes are always estimates. Nutrition is stored once per food on a basis (100 g, 100 ml or one serving); each food has serving definitions such as cup, bowl, piece; logging picks a serving and a quantity. Carbs include fibre; fibre may be unknown. Custom foods and recipes behave like seed foods in search. Editing a seed food makes a personal copy; the original stays. Search is alias-aware (Bengali and Hindi spelling variants) and ranks exact, whole-word and prefix matches (D-127). Recent, frequent and favourite lists keep logging quick. Values are approximate and the app says so.

## 8. Exercise system

Sixty built-in exercises covering all twenty named in the brief, each with category, muscle groups, type, target kind (reps, seconds, minutes, meters, rounds), per-side flag, a calorie basis (per rep, second, minute or km at 70 kg), difficulty and instructions. Users can add exercises, edit a built-in one (as a personal copy) or hide one. Calorie values are estimates, labelled as such, and can be overridden.

## 9. Workout plan system

Six default plans exactly as specified (Upper Body Push & Pull; Lower Body & Core; Active Recovery & Yoga; Upper Body Arms Focus; Lower Body & Cardio with Running or Brisk Walking; Complete Rest at 10,000 steps, the others 7,000). Plans are lists of exercises with targets and optional ranges. No plan is tied to a day of the week, anywhere: on any day the user picks any plan, repeats it, skips it or picks another. Users can create, rename, reorder, edit, duplicate and delete plans and restore defaults. Choosing a plan copies it into the workout log, so later edits or deletion never change past workouts. Completion is the actual divided by the target (7 of 10 is 70%; 20 of 30 seconds is 67%; 22 of 30 minutes is 73%), or a manual percentage. A session with nothing entered counts as Not started and is left out of averages (D-071).

## 10. Daily logging

Today is the hub: a calories ring, protein, carbs, fat and fibre bars, tiles for steps, water, sleep, workout completion and exercise calories, a note chip and a sticky row of quick actions. Water is glasses of 500 ml with litres and percentage. Steps have a goal that follows the chosen plan unless set manually. Sleep is saved on the day you woke up, with bed and wake times, quality 1 to 5 and an optional nap. Any date can be opened for back-filling. Over a target shows "+N over" in neutral wording, never as a failure.

## 11. Measurements

Height, weight, body fat (marked approximate), biceps, thigh and waist, in metric. Chest, hips, neck and calf are reserved for a later version. Each measurement has a date, value and optional note; several per day are allowed. Each type has a graph with range selector, latest, previous, change and trend (only from five points, labelled). Gaps stay gaps; bars start at zero.

## 12. Progress photos

Up to four photos per check-in (front, side, back, flexed), taken with the camera or chosen from the library. Each photo is resized on the device to 1,600 px on the long edge as JPEG with a 320 px thumbnail, which also strips location data. Photos stay on the device and in backups the user makes. Compare lets the user choose two check-ins and view them side by side by position. About 65 MB per person for two years of fortnightly check-ins.

## 13. Analytics

Trends for week, month and three months (by week) across weight, body fat, waist, calories, protein, steps, water, sleep, workout completion and exercise calories. Every chart has a text summary and a table toggle. Averages count only days with data and say "n of N days". No scores, streaks or judging language. A custom date range is for version 1.1.

## 14. UX and UI principles

Mobile-first, then tablet and desktop. System fonts, restrained colour tokens with automatic light and dark themes, smooth but short animations that respect reduced motion. Sheets are routes, so the Back button closes them. One banner at a time. Every screen has an empty state and plain error wording. Accessibility baseline: 44 px targets, visible focus, keyboard operation, labelled controls, contrast checked by test, usable at 200% text size. Forty-one screens in three build waves, all shipped in 1.0.0.

## 15. Security and privacy

No accounts, no server, no analytics, no external requests; a strict content security policy blocks anything else. No inline scripts or styles, no user data written as HTML. Both profiles live in the same browser, so the picker states honestly that there is no PIN in this version and anyone who can open the app can open either profile. A PIN and encrypted backups are planned for 1.1. The repository is public and holds only code and the shared food data, never personal data.

## 16. Backup and restore

Backup is a zip (`winter-arc-backup-YYYY-MM-DD.zip`) with a manifest, the data and photo files with checksums, or a data-only JSON. Preparing and saving are separate taps so phones allow the save. Import verifies the file, upgrades older formats, validates every record, shows a preview per profile, lets the user map profiles, choose Merge or Replace and a conflict preference, makes a safety backup first for Replace, applies everything in one transaction and recounts afterwards. Corrupt, foreign or newer files are rejected with nothing changed. Full instructions in `docs/BACKUP.md`.

## 17. GitHub Pages deployment

A public repository, Pages set to deploy from branch main and folder root, an empty `.nojekyll` file, and the files uploaded through the web page in batches of at most 100 with `version.js` last. No Actions, no build. All URLs are relative so the app works under `/repository-name/`. The service worker keeps old and new versions apart and shows an update banner only when the user can act on it. Never rename the repository or the account. Full steps in `docs/DEPLOY.md`.

## 18. Zero-cost strategy

Everything is free: GitHub account and public repository, Pages hosting, HTTPS, bandwidth at this size, the github.io address. No domain, fonts, CDNs, analytics, authentication, image hosting, database or AI service. The hidden-cost audit found only user-side items: a little mobile data on first load, phone storage for photos and wherever backup files are kept. Claude was used during development only; the running app needs no AI.

## 19. File and folder structure

```
index.html  config.js  manifest.webmanifest  sw.js  version.js  README.md  .nojekyll
css/       tokens, base, components, screens
icons/     app icons (SVG and four PNG)
data/      seed manifest, categories, meals, measurement types, exercises, plans, 11 food files, ATTRIBUTION.md
js/        app.js, boot-theme.js
  core/      db, store, router, dom, dates, validate, units, migrate, storage-health, calc, repo, seed, backup, import
  lib/       zip
  ui/        components, charts, icons
  features/  daily, profile, food, workout, body, photos, checkins, analytics, settings
tests/     in-browser test page, suites, fixtures
tools/     icon generator (optional)
docs/      this plan, DEPLOY, BACKUP, LICENCES, MASTER-BRIEF, CONVENTIONS, AUDIT, STATE, QA reports, manual checklists
```

163 files plus `.nojekyll`. Tests and tools are never cached by the service worker.

## 20. Implementation sequence

Core data layer, then backup and import engine, then shell and design system with the seed foundation in parallel, then first-wave screens (picker, Today, food and workout logging, settings, backup, restore), second-wave screens (custom foods, recipes, plans, exercises, body, check-ins, photos), third-wave screens (trends, notes, polish), nine food-data chunks, four QA passes, rework, final audit, packaging.

## 21. Testing strategy

A test page (`tests/index.html`) runs 383 in-browser tests covering calculations, validation, snapshots, completion percentages, recipes, import atomicity and conflict rules, backup round-trips, migrations, seed integrity, search, UI flows, accessibility, performance and a whole-repository check that no day-of-week mapping exists. Headless Chromium drives covered real flows, offline use, service-worker updates and layout at four widths. Not covered by machine and left to the owner: real iPhone and Android, screen readers, camera and very large photos, pointer drag, a real Pages deployment, a 150 MB backup. See `docs/MANUAL-CHECKLISTS.md`.

## 22. Agent sequence

Five planning agents (requirements, data and storage, UX, technical and deployment, integration), then A1 core data, A2 backup and import, A3 shell, A4 first-wave screens, A5 second-wave screens, A6 third-wave screens, A7.0 to A7.9 food data, A8 functional QA, A9 data QA, A10 UI QA, A11 performance QA, A12 rework, A13 final audit, A14 packaging. Each agent owned specific files and passed a structured handoff and updated `docs/STATE.json`.

## 23. Definition of done

Twenty-four checks (DoD-01 to DoD-24): loads from the Pages address with no backend; profile choice in two taps; totals match hand calculation; Indian, Bengali and restaurant foods with estimates flagged; custom foods and recipes searchable; master edits never change logs; six plans exact; any plan any day; plan edits keep history; completion percentages correct; estimates labelled; steps, water, sleep and notes correct; no data differs from zero; honest graphs; check-in photos and compare; persistence after restart; backup and import preserve counts; bad files rejected unchanged; offline and install work; persistence and backup status visible; usable at 360 px, tablet and desktop; no external request; traceability complete. The final audit (docs/AUDIT.md) verdict was GO with nothing release-blocking.

## 24. Traceability and open items

`docs/STATE.json` holds all 141 requirement rows with implementation location, test coverage and status. Version 1.1 items are deferred and not built: couple snapshot file, meal category editing, goal modes, custom glass size, extra measurements, period comparison, custom date range, PIN lock, encrypted backup, per-profile export, photo blur and overlay slider. Version 2 items: encryption at rest, optional user-owned sync, optional AI.

Open items for the owner: real-phone and screen-reader checks (docs/MANUAL-CHECKLISTS.md); the shell is 652 KiB raw (219 KiB compressed) against a 500 KB planned budget, accepted on the compressed basis; a review of estimate-heavy foods; optional search aliases for "phuchka", "puchka" and "fuchka" and removal of the "chola" alias that collides with "cola" (a small seed update).
