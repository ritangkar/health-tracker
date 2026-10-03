# Winter Arc: backup and restore

Your data lives only in your browser on your own device. There is no account and no server. A backup file is the one safety net. Make one regularly and keep it somewhere private.

## What a backup holds

Everything you entered, for BOTH profiles: profiles, targets, custom foods and recipes, favourites and recents, exercise library changes, workout plans, food logs, workout logs, steps, water, notes, sleep, measurements, check-ins and progress photos.

It does not hold the built-in food and exercise lists (they come with the app) or device-only settings such as the last-backup date.

**The file is not encrypted.** Anyone who gets the file can read both profiles and see all photos. Keep it in a private place (your own cloud folder, a USB stick, your own email to yourself). Encrypted backups are planned for a later version.

## Two formats

- **Zip with photos** (default when you have photos): `winter-arc-backup-YYYY-MM-DD.zip`. Holds the data plus every photo and its thumbnail.
- **Data only**: `winter-arc-backup-YYYY-MM-DD.json`. Smaller, no photo files. Choose it by switching off Include photos on the backup screen. A later import from a data-only file never wipes photos you already have.

The date in the name is your local date.

## How to make a backup

1. Settings, Back up my data.
2. Leave Include photos on (the screen shows the size). If the size is over about 150 MB, the screen warns you; the data-only option is much smaller.
3. Tap **Prepare backup**. Wait until it says it is ready.
4. Tap **Share or Save**.
   - Phone: choose Save to Files, or share to your cloud app.
   - Computer: the file downloads to your Downloads folder.
5. The result says **Backup shared**, **Backup downloaded** or **Not saved**. Only the first two update your last-backup date. If you close the share sheet without saving it says Not saved.

Preparing and saving are two taps on purpose: phones only allow saving straight after a tap.

## How often

The app reminds you every 7 days if something changed (you can pick off, 3, 7, 14 or 30 days in Settings, Display and days). Make a backup after any day you would hate to lose, before changing phone, before updating the browser or the phone system, and before using Clear site data (never do that without a backup).

## Why backups matter more on iPhone

Safari can delete the stored data of a website you have not opened for about a week, unless the app is installed to the Home Screen. Install it to the Home Screen and tap Protect my data (Settings, Storage and protection). A backup file is still the only guaranteed protection.

The installed Home Screen app and Safari keep separate storage. Make profiles inside the installed app. To move data from Safari to the installed app, back up in Safari and import in the installed app.

## How to restore

Settings, **Import a backup**. The wizard has seven steps:

1. Choose the file. The app checks it is a Winter Arc backup, not damaged and not made by a newer version.
2. See what is in it per profile and how it compares with this device.
3. Match the backup's profiles to profiles on this device (or create or skip).
4. Choose the mode and what to do when the same entry exists in both.
5. Replace mode only: make a safety backup of the current data first (you can skip this only by ticking a clear box).
6. Apply. Everything is written in one step. It either all works or nothing changes.
7. See the result with a recount of every store and photo.

**Merge** (default) adds what is missing and, for an entry that exists in both, keeps the most recently changed one (a tie keeps what is on the device). Merge never deletes anything. It can bring back an item you deleted since the backup was made.

**Replace** makes this device match the backup exactly. Use it on a new phone.

Importing never changes your last-backup date, because an import is not a backup.

## If the app says it lost your data

If the browser cleared its storage, the app notices and shows **Restore from a backup file** with the text that your saved data could not be found on this device. Choose your most recent backup file there.

## Problems the import can report

| Message | Meaning |
|---|---|
| This is not a Winter Arc backup. | Wrong file. |
| This backup file is damaged. Your data was not changed. | Zip cut short or broken. |
| A check on this file failed. | Checksum mismatch; the file may be damaged. Nothing changed. |
| This backup was made by a newer Winter Arc. Update the app first. | Open Settings, Install and updates, Check for update, then retry. |
| There may not be enough space to import this file. | Free space or choose a data-only file. |
| Some items are not valid / some photos are damaged | You can skip those items or import without those photos, or cancel. |

In every error case your current data is untouched.

## Two phones, two people

The app has no sync. Each device keeps its own data. To share: create both profiles on ONE device, back up, then import on the other device. After that each person uses their own profile on their own phone; the other person's profile is simply unused there. A backup holds both profiles, so keep it private.

## Check your backup works (do this once)

Make a backup, then on a spare browser or computer open the app, choose Import a backup, pick the file and stop at the preview step. If the preview lists your profiles and counts, the file is good.

## Older backups keep working

Backup files carry a version number. This app reads every earlier version and upgrades the data on import. A file from a newer app than yours is refused politely, never half-imported.
