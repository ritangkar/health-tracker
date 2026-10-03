# Winter Arc final audit (A13)

Package: winter-arc-a12-rework2.zip, 157 files, 3.1 MB. WA_VERSION 0.9.1-a12 (A14 sets 1.0.0). Seed 1672 foods, seedVersion = WA_SEED_VERSION = 11.

**Verdict: GO to A14. Release-blocking items: none.**

Method: whole in-browser suite run headless (Chromium, Playwright) against throwaway static servers, plus scripted drives of the real app, greps, and a service-worker update drill on a scratch copy.

## 1. Requirements coverage
STATE.json holds all 141 expected rows (FR 46, NFR 15, DAT 30, UX 24, DEP 12, QA 10, COST 4). No row is missing.

- 14 deferred rows, all documented: V1.1 FR-003, 007, 017, 026, 030, 035, 039, 042, 043, DAT-029, UX-024; V2 FR-044, 045, 046. The only visible stub is "Export one profile: coming later", which UX specifies. No runtime AI or network call exists.
- 127 V1 rows: 95 have at least one passing suite test tagged with the ID.
- 32 V1 rows have no tagged test. Disposition:
  - Verified by A13 drive or grep: FR-004, NFR-001, NFR-002, NFR-007, NFR-008, NFR-012, UX-002, UX-006, UX-007, UX-019, UX-023, DEP-010, COST-001, COST-002, COST-003.
  - Process rows, done: QA-001 to QA-005, QA-007 (with F-A13-03), QA-008, QA-009, DEP-005, DEP-007. QA-006 is this audit.
  - Pending A14: DEP-001, 002, 003, 004, 009 (in-app permanent-URL warning is present; guide pending), 011, 012.
- Silent gaps in the product: none. Gap in the paperwork: F-A13-03 (STATE rows stale).
- Device-only caveats (pass headless, real-device check remains): DAT-014, DAT-018, FR-032, NFR-003 install on iOS, UX-018, UX-022.

## 2. No fixed weekday mapping
- Plans have no weekday, schedule or rotation field. The six plans match the brief exactly (7,000 steps x5; Rest 10,000; running 20-30 min with alternative brisk walking; ranges and per-side flags correct).
- choose.js has no ordering or suggestion logic. Today screen offered all six plans on a fresh profile.
- Weekday words appear only in js/features/settings/display.js (week-start setting) and js/core/dates.js (date labels). getDay() is used only in dates.js.
- Suite weekday and structural tests pass, including any plan on any of 7 dates, twice a day.

## 3. Persistence, snapshots, backup, import
- Persistence after refresh and after a real browser restart (persistent profile): pass. Profile isolation: pass (Partner saw no data of Me).
- Snapshot immutability tests (food, workout, plan delete) pass.
- Round trip on the real DB: Replace restored every store count exactly; merge applied twice changed nothing.
- Rejected with DB unchanged: corrupt zip (I_CHECKSUM), truncated (I_DAMAGED), not a backup (I_NOT_BACKUP), newer schema (I_NEWER).
- Injected-failure atomicity, safety-backup requirement and pre-flight space tests pass.
- Backup screen drive: Prepare, then Save gave "Backup downloaded", a dated filename and the "not encrypted" warning.

## 4. Zero cost and GitHub Pages
- No external URLs. No fetch to other origins. No innerHTML, toISOString, inline style attributes, inline handlers or eval in app code. Meta CSP present. Self-check reports no violations. Real app run: 0 external requests, 0 console errors.
- All paths relative. Manifest uses ./ for start_url, scope and id.
- WA_PRECACHE: 110 entries, none missing on disk. Every module reachable from js/app.js is listed. Not listed by design: sw.js, README.md, data/ATTRIBUTION.md, tests, tools, docs.
- Seed manifest counts equal file counts. 1672 ids and names are unique. Seed 1.19 MB.
- Sub-folder deploy (/winter-arc/): SW scope correct, offline reload and offline food search work, About shows "Versions match".
- Update drill (version bump while app open): banner appeared, Reload swapped versions, old shell cache deleted, data kept.
- .nojekyll is not in the package (D-012: create in the web UI). The site needs nothing Jekyll would break.
- 157 files means at least 2 upload batches of 100 or fewer. version.js goes last.
- Shell is 652 KiB raw against the 500 KB budget (C-058, 219 KiB gzip): accept.

## 5. UX
- 30 routes at 320, 360, 768 and 1280 px, plus 200% text at 360 px: no horizontal overflow, one h1 per screen, no empty route.
- Estimates carry est. or approx. chips; About holds the disclaimer.
- Empty and error states reached by drive: Not found, Restore, Safe mode, Import step 1, foreign entry id (toast, returns to Food).
- The 10-step daily flow works with real taps: picker, food, water, steps (5,830 shows 83% of 7,000), workout (Mark all gives 100%, ~18 kcal est.), sleep (Bed Fri 23:15, woke Sat 06:40, 7h 25m).
- Minor: two-row Quick actions grid covers hero text at 360x740 with a banner (F-A13-06). Search field shows two clear icons (F-A13-07).

## 6. Placeholders and paid services
- No TODO, stub or lorem text. The only "coming later" is the specified one.
- No analytics, API key, CDN or account anywhere.
- docs/DEPLOY.md, BACKUP.md, LICENCES.md, wholeplan.md, MASTER-BRIEF.md and the final README.md do not exist yet. README.md is the A3 stub. This is A14's scope.

## 7. Seed
- 1672 foods: 847 estimate, 825 typical, 0 verified. All 742 restaurant foods are estimates. Every Indian and Bengali food has 2 or more aliases.
- 67 brief-named queries: 66 return results; "fuchka" returns nothing (F-A13-01). Cuisine filters all populated.
- 14 of the 36 doubtful_items sampled (macher jhol, pepperoni pizza, bubble tea, cinema popcorn, potato skins, poha, baklava, chicken curry, falafel, khichuri, frappe, cheese balls, thick shake, gulab jamun): calories within a few percent of 4/4/9, portions realistic. No change needed.
- KI-115 alias scan with the app's own normalize(): 11 aliases equal another food's name (same dish, home versus restaurant: benign). 14 aliases are shared by several foods (benign, e.g. dahl on 5 raw dals). One real collision: "chola" normalises to "cola", so searching "cola" lists chickpeas before the cola drink (F-A13-02).

## 8. Findings and classification
Release-blocking: none.

| ID | Area | Sev | Summary | Owner | Class |
|---|---|---|---|---|---|
| F-A13-01 | Seed | low | No phuchka/fuchka/puchka alias (Pani puri has golgappa) | A7/A12 | Accept, or 10-minute hotfix with seed version 12 |
| F-A13-02 | Seed | low | KI-115: alias "chola" on f:sa-chickpeas-kabuli-raw and f:st-chana-masala-home outranks the cola drink | A7/A12 | Accept, or same hotfix |
| F-A13-03 | Process | medium | STATE requirement rows stale (80 of 127 V1 rows say planned or in_progress) | A14 | Fix in packaging |
| F-A13-04 | Docs | low | MANUAL-CHECKLISTS still cites F-A10-04 and F-A10-05, fixed by A12 | A14 | Accept or note |
| F-A13-05 | Code | info | js/features/analytics/popover-fit.js unused (fitPopover lives in components.js) but precached | A12 | Accept; remove in 1.0.1 |
| F-A13-06 | UX | low | Tall sticky Quick actions at 360x740 with a banner | A4 | Accept; V1.1 polish |
| F-A13-07 | UX | cosmetic | Double clear icon in the search field | A4 | Accept |
| F-A13-08 | Tests | noise | harness.js lists a missing tests-a11y.js; test page logs a 404; no effect on the app | A1 | Accept |

Open known issues:
- Close, verified by A13: KI-007, KI-012, KI-015 (update drill passed), KI-095 and C-060 (manifest, ledger and data agree, 1672 unique, no duplicates).
- Accept for V1: KI-001, 002, 005, 006, 009, 010, 013, 017, 018, 019, 025, 034, 035, 053, 062, 083, 084, 085, 086, 087, 088, 089, 092, 096, 099, 102, 103, 104, 105, 107, 108, 110, 111, 115 (via F-A13-02).
- Owner or device check: KI-003, 004, 008, 014, 024, 026, 031, 032, 033, 036, 041, 054, 061, 073, 075, 076, 082.
- Owner decision, recommend accept on gzip basis: KI-070, KI-081 (C-058).

## 9. Not verified
Real iPhone and Android, VoiceOver and TalkBack, camera and 48 MP photos, pointer drag reorder, real GitHub Pages, a 150 MB backup.
