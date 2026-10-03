# Winter Arc

A private health, fitness, nutrition and progress tracker for two people. It runs entirely in the browser, keeps all data on your own device, works offline once opened, and costs nothing to host. There is no server, no account, no analytics and no paid service.

Version 1.0.0.

## What it does

- Two separate profiles with their own food, workouts, steps, water, sleep, measurements, photos, targets and notes.
- Food log with a database of 1,672 foods (Indian, Bengali, restaurant, packaged), servings, custom foods and recipes. Restaurant and mixed values are estimates and are labelled.
- Six default workout plans, fully editable. Any plan can be chosen on any day. Completion percentage and estimated exercise calories are saved with each workout.
- Steps, water, sleep, body measurements with honest graphs, weekly check-ins with progress photos and photo comparison, trends, and notes.
- Backup and restore to a dated file, with checks for damaged or newer files.

## How to put it online

Follow docs/DEPLOY.md. In short: make a public GitHub repository, upload the files in batches of 100 or fewer, create an empty `.nojekyll` file, upload `version.js` last, then switch on GitHub Pages from the main branch, root folder. Never rename the repository or the account.

## Keep your data safe

Your data lives only in the browser on each device. Make a backup regularly (Settings, Back up my data). Read docs/BACKUP.md. A backup file holds both profiles and all photos and is not encrypted.

## Documents

- docs/DEPLOY.md: upload, Pages, verification, updates
- docs/BACKUP.md: backup, restore, moving between devices
- docs/LICENCES.md: licences and data sources
- docs/wholeplan.md: the whole plan in plain words
- docs/MASTER-BRIEF.md: the original brief and decisions
- docs/AUDIT.md: final audit
- docs/CONVENTIONS.md: notes for developers
- tests/index.html: in-browser self-test (open it from the live site)

## Privacy

The app makes no network requests while you use it. There is no PIN in this version. Anyone who can open the app on a device can open either profile, so use the phone's screen lock.
