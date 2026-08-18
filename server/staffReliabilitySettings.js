/**
 * מתי מתנדב אינו עושה את חלקו.
 *
 * שני דברים שונים לגמרי, ולכן שני ספים: **אמינות** — מי שנרשם ולא הגיע, ו**כמות**
 * — מי שכמעט לא נרשם. אדם יכול להיות אמין לחלוטין ולתרום פעמיים בשנה, או להירשם
 * להכול ולהבריז מחצית; דגל אחד לא היה מבדיל ביניהם.
 *
 * הספירה מפרידה חוגים מאירועים, כי מדריך חוג שבועי עובר כל סף כמותי מעצם היותו
 * מדריך — ואז הדגל שותק בדיוק על מי שהוא נועד לו.
 */

const KEY = 'staff_reliability';

export const DEFAULT_STAFF_RELIABILITY_SETTINGS = {
  // אחוז ההגעה שמתחתיו נדלק דגל אמינות.
  reliability_min_pct: 80,
  // כמה סימונים צריך לפני שמדגלים בכלל. שתי הברזות מתוך שתיים אינן דפוס.
  reliability_min_marked: 4,
  // כמה אירועים בחודש נחשבים תרומה. חוגים נספרים בנפרד ואינם נכנסים לכאן.
  volume_min_events_per_month: 2,
  // כמה חודשים אחורה נמדדים.
  volume_window_months: 3,
};

function clampInt(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeStaffReliabilitySettings(raw = {}) {
  const base = { ...DEFAULT_STAFF_RELIABILITY_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
  return {
    reliability_min_pct: clampInt(base.reliability_min_pct, DEFAULT_STAFF_RELIABILITY_SETTINGS.reliability_min_pct, 0, 100),
    reliability_min_marked: clampInt(base.reliability_min_marked, DEFAULT_STAFF_RELIABILITY_SETTINGS.reliability_min_marked, 1, 100),
    volume_min_events_per_month: clampInt(base.volume_min_events_per_month, DEFAULT_STAFF_RELIABILITY_SETTINGS.volume_min_events_per_month, 0, 60),
    volume_window_months: clampInt(base.volume_window_months, DEFAULT_STAFF_RELIABILITY_SETTINGS.volume_window_months, 1, 24),
  };
}

export async function readStaffReliabilitySettings(db, supa) {
  const local = db.getAppSettingLocal?.(KEY);
  if (local) return normalizeStaffReliabilitySettings(local);
  try {
    const remote = await supa.getAppSetting(KEY);
    if (remote) {
      const value = normalizeStaffReliabilitySettings(remote);
      db.setAppSettingLocal?.(KEY, value);
      return value;
    }
  } catch { /* אין עותק עמיד — ברירת המחדל */ }
  return { ...DEFAULT_STAFF_RELIABILITY_SETTINGS };
}

/** אותן הגדרות בלי המתנה, למסלול שכבר קרא אותן פעם. */
export function readStaffReliabilitySettingsSync(db) {
  const local = db.getAppSettingLocal?.(KEY);
  return local ? normalizeStaffReliabilitySettings(local) : { ...DEFAULT_STAFF_RELIABILITY_SETTINGS };
}

export async function writeStaffReliabilitySettings(db, supa, patch = {}) {
  const value = normalizeStaffReliabilitySettings({ ...readStaffReliabilitySettingsSync(db), ...patch });
  db.setAppSettingLocal?.(KEY, value);
  try { await supa.setAppSetting(KEY, value); } catch { /* נשמר מקומית */ }
  return value;
}
