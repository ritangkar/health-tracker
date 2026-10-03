// RELEASE FILE. Classic script: loaded by index.html and importScripts-ed by sw.js. Upload this file LAST (D-014, D-067).
// Bump WA_VERSION on every release; the service worker re-downloads every listed file when this changes.
// Bump WA_SEED_VERSION when anything under data/ changes (must equal seedVersion in data/seed-manifest.json).
// WA_PRECACHE lists every shell file. Entries under data/ are best-effort (a missing seed file never blocks install);
// the service worker also caches every file named in data/seed-manifest.json. tests/, tools/ and docs/ are never listed (D-073).
self.WA_VERSION = '1.0.0';
self.WA_SEED_VERSION = 11;
self.WA_PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.js',
  'config.js',

  // Core styles
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/screens.css',

  // Icons
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',

  // Boot / app
  'js/boot-theme.js',
  'js/app.js',

  // Core
  'js/core/backup.js',
  'js/core/calc.js',
  'js/core/dates.js',
  'js/core/db.js',
  'js/core/dom.js',
  'js/core/import.js',
  'js/core/migrate.js',
  'js/core/repo.js',
  'js/core/router.js',
  'js/core/seed.js',
  'js/core/storage-health.js',
  'js/core/store.js',
  'js/core/units.js',
  'js/core/validate.js',

  // Libraries / UI
  'js/lib/zip.js',
  'js/ui/charts.js',
  'js/ui/components.js',
  'js/ui/icons.js',

  // Data
  'data/seed-manifest.json',
  'data/categories.json',
  'data/meal-categories.json',
  'data/measurement-types.json',
  'data/exercises.json',
  'data/plans.json',

  // Daily
  'js/features/daily/register.js',
  'js/features/daily/shared.js',
  'js/features/daily/sheets.js',
  'js/features/daily/summary.js',
  'js/features/daily/today.js',

  // Food - W1
  'js/features/food/add-food.js',
  'js/features/food/common.js',
  'js/features/food/entry-edit.js',
  'js/features/food/food-tab.js',
  'js/features/food/quick-add.js',
  'js/features/food/register.js',

  // Food - W2
  'js/features/food/custom-food.js',
  'js/features/food/custom-model.js',
  'js/features/food/my-foods.js',
  'js/features/food/recipe-builder.js',
  'js/features/food/recipe-model.js',
  'js/features/food/register-w2.js',

  // Profile
  'js/features/profile/picker.js',
  'js/features/profile/register.js',

  // Body
  'js/features/body/add-measurement.js',
  'js/features/body/series.js',
  'js/features/body/register.js',
  'js/features/body/body-hub.js',
  'js/features/body/measurement-graph.js',

  // Check-ins
  'js/features/checkins/detail.js',
  'js/features/checkins/banner.js',
  'js/features/checkins/wizard.js',
  'js/features/checkins/register.js',
  'js/features/checkins/progress-hub.js',
  'js/features/checkins/averages.js',
  'js/features/checkins/save.js',

  // Photos
  'js/features/photos/register.js',
  'js/features/photos/compare.js',
  'js/features/photos/image-pipeline.js',
  'js/features/photos/url-bag.js',
  'js/features/photos/viewer.js',

  // Feature styles
  'js/features/screens-w1.css',
  'js/features/screens-w2.css',

  // Settings
  'js/features/settings/about-screen.js',
  'js/features/settings/backup-screen.js',
  'js/features/settings/common.js',
  'js/features/settings/display.js',
  'js/features/settings/hub.js',
  'js/features/settings/import-wizard.js',
  'js/features/settings/install-screen.js',
  'js/features/settings/register.js',
  'js/features/settings/safe-mode.js',
  'js/features/settings/storage-screen.js',
  'js/features/settings/targets.js',

  // Workout - W1
  'js/features/workout/choose.js',
  'js/features/workout/common.js',
  'js/features/workout/register.js',
  'js/features/workout/session.js',
  'js/features/workout/workout-tab.js',

  // Workout - W2
  'js/features/workout/plan-model.js',
  'js/features/workout/plans-list.js',
  'js/features/workout/plan-editor.js',
  'js/features/workout/exercise-library.js',
  'js/features/workout/exercise-form.js',
  'js/features/workout/past-session.js',
  'js/features/workout/register-w2.js',

  'js/features/analytics/register.js',
  'js/features/analytics/screens-w3.css',
  'js/features/analytics/metrics.js',
  'js/features/analytics/load.js',
  'js/features/analytics/trend-chart.js',
  'js/features/analytics/trends.js',
  'js/features/analytics/notes-model.js',
  'js/features/analytics/notes.js',
  'js/features/analytics/popover-fit.js'
];
// Feature files (A4..A6) are added here by the agent that creates them; tests/tests-ui.js fails when the import graph reaches a file that is not listed.
