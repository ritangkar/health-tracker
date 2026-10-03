# Winter Arc: licences and third-party material

Version 1.0.0.

## Short answer

Winter Arc contains **no third-party code, fonts, images, icons, data sets or trackers**. Everything in the repository was written for this project. Nothing is loaded from another website when the app runs.

## Code

| Item | Origin | Licence status |
|---|---|---|
| All JavaScript, CSS, HTML (`js/`, `css/`, `index.html`, `sw.js`, `version.js`, `config.js`) | Written for Winter Arc, including the zip reader/writer (`js/lib/zip.js`), the SVG charts, the icon set, the router, the store and the IndexedDB wrapper | Project-owned |
| Third-party libraries | None. No Chart.js, JSZip, Dexie, React, Preact or similar | Not applicable |
| Build tools, package manager, CDN scripts | None | Not applicable |

Rule for the future (decision D-013): any library must be one pinned file kept in the repository (never loaded from a CDN), at most 100 KB, with its licence text recorded here before it is added.

## Fonts and icons

| Item | Origin | Licence status |
|---|---|---|
| Typefaces | The device's own system fonts. No font files are shipped or downloaded | Not applicable |
| In-app icons (`js/ui/icons.js`) | Inline SVG shapes drawn for this project | Project-owned |
| App icons (`icons/icon.svg` and four PNG files) | Drawn for this project; the PNG files were generated from the SVG by `tools/make-icons.html` | Project-owned |

## Food, exercise and plan data (`data/`)

- All values were written for this project from general nutrition knowledge (source id `src-author`). No database, website or book was copied, scraped or converted.
- Values are approximate. 847 of the 1,672 foods are marked **estimate** (all restaurant, hotel, street and packaged items) and 825 are marked **typical**. No food is marked **verified**.
- The full source register, confidence levels and the approximate-values disclaimer are in `data/ATTRIBUTION.md`. The app shows the disclaimer in Self-check and About.

Sources considered and NOT used:

| Source | Decision |
|---|---|
| Indian Food Composition Tables 2017 (NIN / ICMR) | Not imported. Copyright belongs to NIN/ICMR and it is not an open licence. Its companion website is AGPL-3.0 licensed (since 1 May 2025); no code or data from it was copied. May be used only to sanity-check raw staples, with acknowledgement. |
| Indian Nutrient Databank | Not used. Licence not verified. |
| USDA FoodData Central | Not used. Believed to be public domain; the date and URL would need to be verified before any use. |

If a data set is ever added: check its licence first, write it into `data/ATTRIBUTION.md` and this file, and mark values `verified` only when a cited, permitted source was manually checked.

## User data

Everything a user types (foods, notes, measurements, photos) belongs to that user, stays in their browser, and is never part of the repository. The repository is public and must never receive a backup file or any real personal data.

## Hosting terms

The app is served by GitHub Pages under GitHub's own terms of service. GitHub is a hosting convenience, not a dependency of your data: the files are static, so the same folder works on any static host.

## The project's own licence

The owner has not chosen a licence for the Winter Arc source. A public repository without a licence file means the code is visible but all rights are reserved by the owner. If you want others to be able to reuse it, add a standard licence file (for example MIT) at the top of the repository and mention it here. This is the owner's decision and was deliberately not made for you.
