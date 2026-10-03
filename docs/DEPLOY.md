# Winter Arc: how to put it online (GitHub Pages)

Version 1.0.0. Written for someone who has never used GitHub. Nothing to install. No Node, no Python, no server, no money. You only need a web browser and the unzipped Winter Arc folder.

The finished app lives at `https://YOUR-USERNAME.github.io/YOUR-REPO/`. All your data stays on your own phone or computer. GitHub only hands out the app files.

## 0. Before you start

- Unzip `winter-arc-1.0.0.zip`. You get one folder called `winter-arc`. Open it. Everything below refers to what is INSIDE that folder.
- The folder holds 163 files. GitHub's web upload accepts at most 100 files at a time and 25 MB per file. The biggest file here is well under 1 MB, so only the count matters. That is why the upload is split into batches.
- Use a computer for the upload. A phone browser is not suitable.

## 1. Make a GitHub account (skip if you have one)

1. Go to github.com and choose Sign up. Free plan.
2. Turn on two-step sign-in (2FA) in Settings, Password and authentication. Do this now, not later.

## 2. Make the repository (the folder GitHub keeps for you)

1. Click the plus icon at the top right, then New repository.
2. Repository name: a short, lowercase name such as `winter-arc`. Use letters, numbers and hyphens only.
3. Choose **Public**. (Free Pages needs public. The repository holds only the app and food data, never anyone's personal data.)
4. Tick Add a README file. Click Create repository.

**Never rename the repository or your GitHub username later.** The web address is part of where the browser keeps your data. A new address means a new, empty app that looks like your data was lost. If a rename ever happens, back up first (see BACKUP.md) and import into the new address.

Do not put other websites under the same GitHub account that you do not fully trust. All `username.github.io` sites share one browser origin.

## 3. Upload the files in batches

You are on the repository page. Click Add file, then Upload files. Drag items from the unzipped `winter-arc` folder into the box. Dragging a folder keeps its sub-folders. Wait until the file list stops growing, scroll down, leave "Commit directly to the main branch" selected and click Commit changes. Then repeat for the next batch.

Keep every batch at 100 files or fewer. Do exactly this, one drag per row:

| Batch | What to drag from the `winter-arc` folder | Files |
|---|---|---|
| 1 | the folders `css`, `icons`, `data`; the folders `js/core`, `js/lib`, `js/ui`; the two files `js/app.js` and `js/boot-theme.js`; the five loose files `index.html`, `config.js`, `manifest.webmanifest`, `sw.js`, `README.md` | 52 |
| 2 | the folder `js/features` | 70 |
| 3 | the folders `tests`, `tools`, `docs` | 40 |
| 4 | `version.js` on its own, LAST | 1 |

Notes for batch 1: do NOT drag `version.js` yet. Dragging `js/core` keeps the path `js/core/...` on GitHub, so the folders are rebuilt correctly. Before you click Commit, glance at the file count GitHub shows and check it matches the table.

**After batch 3, before batch 4: create the empty `.nojekyll` file.**
1. Click Add file, then Create new file.
2. In the name box type `.nojekyll` (a dot, then nojekyll, nothing else).
3. Leave the big text area empty. Click Commit changes.

GitHub may warn that the file is empty. That is fine.

**Batch 4: `version.js`, always last.** This file tells the app which release it is. It must arrive after every file it names, so a phone never sees a new version number with old files.

Total: 52 + 70 + 40 + 1 = 163 files, plus the empty `.nojekyll`.

## 4. Switch on GitHub Pages

1. In your repository click Settings (top row).
2. In the left list click Pages.
3. Under Build and deployment, Source: choose **Deploy from a branch**.
4. Branch: choose `main`, folder: `/ (root)`. Click Save.
5. Wait 1 to 10 minutes. Refresh the Pages settings page. A box appears saying "Your site is live at ..." with your address.

You do not need GitHub Actions, a workflow or any build step.

## 5. First open and verification checklist

Open `https://YOUR-USERNAME.github.io/YOUR-REPO/`. Tick each line.

1. The Winter Arc profile picker appears. No error screen.
2. Create the two profiles (names Me and Partner can be edited). If you use an iPhone, do this INSIDE the installed Home Screen app, see section 6.
3. Open Today. Tap Water, add a glass, save. Refresh the page. The water is still there.
4. Settings, Self-check and About. The row **Versions match** says **Yes**, and the app version reads `1.0.0`. "Ready for offline use" says Yes (this can take a few seconds on the first visit; reload once).
5. Offline reload: turn on airplane mode, close the app completely, open it again. Today still opens and your water entry is there. Turn airplane mode off.
6. Backup: Settings, Back up my data. Tap **Prepare backup**, then **Share or Save**. The message says "Backup shared" or "Backup downloaded". The last-backup date on the Settings hub updates.
7. Food search: Add food, type `dal`, `macher jhol` and `golgappa`. Results appear. Values show an "est." or "approx." chip where they are estimates.
8. Nothing on screen asks you to sign in, pay or connect to anything.

If a line fails, go to section 8.

## 6. Put it on the phone

**iPhone (Safari, iOS 16.4 or newer):** open the link in Safari, tap Share, then Add to Home Screen. Open Winter Arc from the new icon. Create the profiles inside this installed app. The Home Screen app and Safari keep SEPARATE storage on iOS. If you already logged data in Safari, use Settings, Back up my data in Safari, then Settings, Import a backup in the installed app.

**Android (Chrome):** open the link, then Settings, Install and updates, **Install Winter Arc**. Or use the browser menu, Install app.

**Computer:** Chrome or Edge shows an install icon in the address bar. Installing is optional; the app also works in a normal tab.

After installing, Settings, Storage and protection, tap **Protect my data** if it says Not protected.

## 7. Releasing an update later

1. Edit or replace only the files that changed. Keep the same folder paths.
2. Open `version.js` and change `WA_VERSION` to a new value (for example `1.0.1`). If anything inside `data/` changed, also raise `WA_SEED_VERSION` by one and make `seedVersion` in `data/seed-manifest.json` the same number.
3. Upload the changed files with Add file, Upload files (same paths overwrite the old ones). **Upload `version.js` last**, in its own commit.
4. Wait 1 to 3 minutes. Open the app. A banner says an update is available. Tap Reload once. Your data is unchanged.
5. No banner? Settings, Install and updates, **Check for update**. Still nothing: **Repair app** (it clears only the app's offline copy, never your data). Then reload.

Never use the browser's Clear site data without a fresh backup. That is the one action that erases your data.

Roll back: on GitHub open Commits, find the good commit and choose Revert, or upload the old files again together with a `version.js` that has a NEWER version number than the one that is live (the number must go up, never down).

## 8. If something goes wrong

| Symptom | What to do |
|---|---|
| Address shows 404 | Wait 10 minutes. Check Settings, Pages shows `main` and `/ (root)`. Check `index.html` sits at the top level of the repository, not inside a sub-folder. |
| Blank page or "could not start" | Check the folders `js`, `css`, `data` arrived with their sub-folders. Settings, Install and updates, Repair app. |
| Self-check says versions do not match | Reload once. If it persists, Check for update, then Repair app. |
| App does not work offline | Open it once online, wait a few seconds, reload, check Self-check shows "Ready for offline use: Yes". |
| Upload page says too many files | A batch had more than 100 files. Split it. |
| Update does not appear | `version.js` was not changed or was uploaded before the other files. Upload it again last with a new `WA_VERSION`. |

## 9. What the repository must look like when you finish

```
index.html  config.js  manifest.webmanifest  sw.js  version.js  README.md  .nojekyll
css/        tokens.css base.css components.css screens.css
icons/      icon.svg icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png
data/       seed-manifest.json, categories, meal-categories, measurement-types, exercises, plans,
            11 foods-*.json files, ATTRIBUTION.md
js/         app.js boot-theme.js, core/, lib/, ui/, features/
tests/      index.html and test files, fixtures/
tools/      make-icons.html make-icons.js (can be deleted any time)
docs/       DEPLOY.md BACKUP.md LICENCES.md wholeplan.md MASTER-BRIEF.md CONVENTIONS.md AUDIT.md
            STATE.json QA-*.md MANUAL-CHECKLISTS.md
```

## 10. Cost check (all zero)

GitHub account, public repository, Pages hosting, HTTPS, bandwidth at this size, the web address: all free. No domain, no fonts or scripts from other sites, no analytics, no paid service of any kind. Things on your side: a little mobile data on first load (1 to 3 MB), phone storage for photos (about 65 MB per person for two years of fortnightly check-ins), and wherever you keep backup files (a free cloud or a USB stick).
