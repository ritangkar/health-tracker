// Winter Arc global constants. No logic. (A1)
export const APP_ID = 'winter-arc';
export const DB_NAME = 'winter-arc-db';
export const DB_VERSION = 1;
export const CURRENT_SCHEMA = 1;
export const LS_PREFIX = 'winter-arc:';
export const SESSION_KEY = 'winter-arc:session';

export const MB = 1024 * 1024;
export const STORAGE = {
  amberBytes: 250 * MB, amberFraction: 0.5,
  redBytes: 400 * MB, redFraction: 0.8,
  backupWarnBytes: 150 * MB
};
export const REMINDER = {
  defaultIntervalDays: 7, firstNudgeDays: 3, snoozeHours: 24,
  intervals: [0, 3, 7, 14, 30], // 0 = off
  installNudgeReturnDays: 7
};
export const PHOTO = {
  longEdge: 1600, quality: 0.8, thumbEdge: 320, thumbQuality: 0.7,
  maxPerCheckin: 4, slots: ['front', 'side', 'back', 'flexed'],
  minFreeFactor: 2
};
export const DEFAULT_BODY_WEIGHT_KG = 70;
export const REF_WEIGHT_KG = 70;
export const STALE_WEIGHT_DAYS = 60;
export const DEFAULT_GLASS_ML = 500;
export const DEFAULT_STEP_GOAL = 7000;
export const REST_STEP_GOAL = 10000;
export const MIN_DATE = '2000-01-01';
export const DEFAULT_TARGETS = { kcal: 1900, protein: 120, carbs: 220, fat: 60, fiber: 25, waterMl: 3000, steps: 7000 };
export const ID_TYPES = ['p', 'fd', 'xe', 'pl', 'fl', 'wl', 'sl', 'ms', 'mt', 'ck', 'ph'];
export const SEED_BASE = 'data/';
