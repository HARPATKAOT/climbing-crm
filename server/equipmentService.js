/** Training equipment kit for kids: shoes rental, club shirt, chalk bag. */

import { randomBytes } from 'crypto';
import { DEFAULT_BUSINESS_PROFILE } from './businessProfile.js';
import {
  LIVE_API_BASE,
  LIVE_APP_BASE,
  apiRedirectBase,
  appPublicBase,
  buildRedirectUrl,
} from './publicLinks.js';

export const EQUIPMENT_ITEM_TYPES = ['shoes', 'shirt', 'chalk_bag'];

export const EQUIPMENT_ITEM_LABELS = {
  shoes: 'נעלי טיפוס',
  shirt: 'חולצת חוג',
  chalk_bag: 'שק מגנזיום ומגנזיום',
};

/**
 * The first template (`equipment_payment`) was approved with a localhost button
 * and can never be repaired in place — an approved button host is frozen.
 * This one points at the server redirect instead, so the destination stays ours.
 */
export const EQUIPMENT_TEMPLATE_NAME = 'equipment_update_or_purchase_v2';
export const EQUIPMENT_TEMPLATE_LEGACY_NAMES = ['equipment_payment'];

/**
 * What each item is *for*, in the owner's words.
 *
 * A price on its own does not answer "why does my child need magnesium?" —
 * a parent asking that got a handoff, because the CRM held the number and
 * nobody had written down the reason. These are free text on purpose: the
 * answer changes with the season and the gym, and the bot reads them rather
 * than carrying an explanation of its own.
 */
export const EQUIPMENT_INFO_KEYS = ['shoes', 'shirt', 'chalk_bag'];

export const DEFAULT_CHALK_BAG_INFO =
  'מגנזיום סופג לחות מהידיים, משפר את האחיזה ועוזר למנוע החלקה מהאחיזות בזמן הטיפוס.';

export const DEFAULT_EQUIPMENT_SETTINGS = {
  prices: {
    // נעליים מושכרות לחצי עונת חוגים. זה המחיר המלא לחצי עונה,
    // ומי שמצטרף באמצע משלם ממנו יחסית — ראו shoesSeasonPricing.
    //
    // הבלאי תלוי בכמה המתאמן מטפס, ולכן יש שני מחירי בסיס: `shoes` למי
    // שמגיע פעם בשבוע ו-`shoes_twice` למי שמגיע פעמיים ומעלה. התדירות
    // נגזרת מהקבוצות שהמתאמן רשום אליהן — ראו studentFrequency.js.
    shoes: 150,
    shoes_twice: 150,
    shirt: 120,
    chalk_bag: 80,
  },
  // The checkout needs one concise safety/use explanation for magnesium. The
  // owner can replace it from Equipment Settings; the other fields stay empty
  // until the business writes its own wording.
  item_info: { shoes: '', shirt: '', chalk_bag: DEFAULT_CHALK_BAG_INFO },
  enrichment_fee: null,
  enrichment_info: '',
  cancellation_policy_id: null,
  shirt_sizes: ['6', '8', '10', '12', '14', 'XS', 'S', 'M', 'L'],
  rental_days: 182,
  price_includes_vat: true,
  family_discount_enabled: true,
  family_discount_percent: 5,
  // שנת חוגים חוזרת כל שנה, לכן נשמר יום-חודש בלבד ולא תאריך מלא.
  // ברירת המחדל: 11 חודשי חוגים, 5.5 לכל חצי.
  season_start: '09-01',
  season_mid: '02-15',
  season_end: '07-31',
};

const MD_PATTERN = /^(\d{2})-(\d{2})$/;

/** יום-חודש תקין ('09-01') או null. */
function normalizeMonthDay(value, fallback) {
  const raw = String(value || '').trim();
  const match = MD_PATTERN.exec(raw);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return raw;
  }
  return fallback;
}

export function normalizeEquipmentSettings(raw = {}) {
  const base = DEFAULT_EQUIPMENT_SETTINGS;
  const pricesIn = raw.prices && typeof raw.prices === 'object' ? raw.prices : {};
  const prices = {
    shoes: Math.max(0, Number(pricesIn.shoes ?? base.prices.shoes) || 0),
    shirt: Math.max(0, Number(pricesIn.shirt ?? base.prices.shirt) || 0),
    chalk_bag: Math.max(0, Number(pricesIn.chalk_bag ?? base.prices.chalk_bag) || 0),
  };
  // הגדרות שנשמרו לפני שהיו שני מחירי נעליים נופלות חזרה למחיר היחיד,
  // כך שהמחיר לא זז לאף משפחה עד שבעל העסק מזין מחיר לפעמיים בשבוע.
  prices.shoes_twice = Math.max(0, Number(pricesIn.shoes_twice ?? prices.shoes) || 0);
  let shirtSizes = Array.isArray(raw.shirt_sizes) ? raw.shirt_sizes : base.shirt_sizes;
  shirtSizes = shirtSizes
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  if (!shirtSizes.length) shirtSizes = [...base.shirt_sizes];
  const rentalDays = Math.max(1, Number(raw.rental_days ?? base.rental_days) || base.rental_days);

  // Free text from the settings screen is the source of truth. Never replace
  // saved owner wording with a built-in explanation.
  const infoIn = raw.item_info && typeof raw.item_info === 'object' ? raw.item_info : base.item_info;
  const itemInfo = {};
  for (const key of EQUIPMENT_INFO_KEYS) {
    itemInfo[key] = String(infoIn[key] ?? '').trim().slice(0, 1200);
  }
  const feeRaw = raw.enrichment_fee;
  const fee = feeRaw === '' || feeRaw === null || feeRaw === undefined
    ? null
    : Math.max(0, Number(feeRaw) || 0);

  return {
    prices,
    item_info: itemInfo,
    enrichment_fee: fee,
    enrichment_info: String(raw.enrichment_info ?? '').trim().slice(0, 2000),
    cancellation_policy_id: String(raw.cancellation_policy_id || '').trim() || null,
    shirt_sizes: shirtSizes,
    rental_days: rentalDays,
    price_includes_vat: raw.price_includes_vat !== false,
    family_discount_enabled: raw.family_discount_enabled !== false,
    family_discount_percent: Math.min(
      100,
      Math.max(0, Number(raw.family_discount_percent ?? base.family_discount_percent) || 0)
    ),
    season_start: normalizeMonthDay(raw.season_start, base.season_start),
    season_mid: normalizeMonthDay(raw.season_mid, base.season_mid),
    season_end: normalizeMonthDay(raw.season_end, base.season_end),
  };
}

/** Preserve settings that an older or stale settings screen did not submit. */
export function mergeEquipmentSettingsPatch(current = {}, next = {}) {
  return {
    ...current,
    ...next,
    prices: { ...(current?.prices || {}), ...(next?.prices || {}) },
    item_info: { ...(current?.item_info || {}), ...(next?.item_info || {}) },
  };
}

export function isKidStudent(student) {
  if (!student) return false;
  if (student.isAdult === true || student.is_adult === true) return false;
  if (String(student.id || '').startsWith('parent:')) return false;
  if (student._parentOnly) return false;
  return true;
}

/** A real trainee card can buy equipment; parent-only CRM placeholders cannot. */
export function isEquipmentEligibleStudent(student) {
  if (!student) return false;
  if (String(student.id || '').startsWith('parent:')) return false;
  if (student._parentOnly) return false;
  return true;
}

/** Adults use shoes and chalk. Children also receive the club shirt option. */
export function equipmentItemTypesForStudent(student) {
  if (!isEquipmentEligibleStudent(student)) return [];
  return isKidStudent(student) ? [...EQUIPMENT_ITEM_TYPES] : ['shoes', 'chalk_bag'];
}

export function newEquipmentId(studentId, itemType) {
  return `eq-${studentId}-${itemType}`;
}

export function newCheckoutToken() {
  return randomBytes(18).toString('base64url');
}

/** Ensure the applicable kit rows exist for a trainee. Returns existing + created rows. */
export function ensureStudentEquipment({ db, student, persist } = {}) {
  if (!db || !isEquipmentEligibleStudent(student)) return [];
  const applicableTypes = equipmentItemTypesForStudent(student);
  const parentId = student.parentId || student.parent_id || null;
  const existing = (Array.isArray(db.get('student_equipment')) ? db.get('student_equipment') : []).filter(
    (row) => row && row.student_id === student.id
  );
  const byType = new Map(existing.map((row) => [row.item_type, row]));
  const now = new Date().toISOString();
  const result = [];

  for (const itemType of applicableTypes) {
    let row = byType.get(itemType);
    if (!row) {
      row = db.insert('student_equipment', {
        id: newEquipmentId(student.id, itemType),
        student_id: student.id,
        parent_id: parentId,
        item_type: itemType,
        payment_status: 'unpaid',
        fulfillment_status: 'pending',
        shirt_size: null,
        shoe_size: null,
        paid_at: null,
        given_at: null,
        given_by: null,
        payment_id: null,
        rental_starts_at: null,
        rental_ends_at: null,
        created_at: now,
        updated_at: now,
      });
      if (typeof persist === 'function') {
        Promise.resolve(persist('student_equipment', row)).catch(() => {});
      }
    } else if (parentId && !row.parent_id) {
      row = db.update('student_equipment', row.id, { parent_id: parentId }) || row;
      if (typeof persist === 'function') {
        Promise.resolve(persist('student_equipment', row)).catch(() => {});
      }
    }
    result.push(row);
  }

  return result.sort(
    (a, b) => EQUIPMENT_ITEM_TYPES.indexOf(a.item_type) - EQUIPMENT_ITEM_TYPES.indexOf(b.item_type)
  );
}

/** Backfill the two applicable equipment rows for active adults already in the CRM. */
export function backfillAdultEquipment({ db, persist } = {}) {
  if (!db) return { students: 0, created: 0 };
  const adults = (db.get('students') || []).filter(
    (student) =>
      isEquipmentEligibleStudent(student) &&
      !isKidStudent(student) &&
      student.status !== 'archived'
  );
  const before = (db.get('student_equipment') || []).length;
  adults.forEach((student) => ensureStudentEquipment({ db, student, persist }));
  return {
    students: adults.length,
    created: Math.max(0, (db.get('student_equipment') || []).length - before),
  };
}

export function addDaysIso(fromIso, days) {
  const start = fromIso ? new Date(fromIso) : new Date();
  if (Number.isNaN(start.getTime())) start.setTime(Date.now());
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + Number(days));
  return end.toISOString();
}

// ─── שנת חוגים וקיזוז דמי השכרת נעליים ──────────────────────────────────────
// נעליים מושכרות לחצי עונה. מי שמצטרף באמצע משלם רק על מה שנשאר לו,
// בעיגול לחצי חודש הקרוב — כך שהצטרפות חודש אחרי הפתיחה יורדת מ-5.5 ל-4.5.

const DAY_MS = 86400000;
const AVG_MONTH_DAYS = 30.4375;

/** תאריך בחצות UTC, כדי שהפרשי ימים לא יזוזו עם אזור הזמן. */
function utcDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

/** 'YYYY-MM-DD' או ISO מלא → תאריך בחצות UTC, או null. */
export function parseDayDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return utcDay(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return utcDay(Number(match[1]), Number(match[2]), Number(match[3]));
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return utcDay(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function isoDay(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** אורך תקופה ביחידות של חצי חודש. הסוף בלעדי. */
export function halfMonthUnits(from, toExclusive) {
  const start = parseDayDate(from);
  const end = parseDayDate(toExclusive);
  if (!start || !end) return 0;
  const days = (end.getTime() - start.getTime()) / DAY_MS;
  if (days <= 0) return 0;
  return Math.round((days / AVG_MONTH_DAYS) * 2) / 2;
}

/**
 * שני חצאי עונת החוגים שמכילים את התאריך הנתון.
 * יום-חודש שקטן מיום פתיחת העונה שייך לשנה הקלנדרית הבאה,
 * כך ש-09-01 → 07-31 נפרש נכון על פני מעבר השנה.
 */
export function resolveSeasonHalves(settings = {}, refDate = new Date()) {
  const s = normalizeEquipmentSettings(settings);
  const ref = parseDayDate(refDate) || parseDayDate(new Date());
  const [startMonth, startDay] = s.season_start.split('-').map(Number);

  const build = (seasonYear) => {
    const inSeason = (md) => {
      const [month, day] = md.split('-').map(Number);
      const year = md < s.season_start ? seasonYear + 1 : seasonYear;
      return utcDay(year, month, day);
    };
    const start = utcDay(seasonYear, startMonth, startDay);
    const end = inSeason(s.season_end);
    let mid = inSeason(s.season_mid);
    // אמצע לא תקין → חוצים את העונה לפי ימים, כדי שתמיד יהיו שני חצאים.
    if (!(mid > start && mid < end)) {
      mid = new Date(start.getTime() + Math.round((end.getTime() - start.getTime()) / 2));
      mid = parseDayDate(mid);
    }
    const endExclusive = new Date(end.getTime() + DAY_MS);
    return {
      seasonYear,
      start,
      mid,
      end,
      halves: [
        { index: 0, label: 'חצי ראשון', start, endExclusive: mid },
        { index: 1, label: 'חצי שני', start: mid, endExclusive },
      ],
    };
  };

  const refMd = isoDay(ref).slice(5);
  let season = build(refMd < s.season_start ? ref.getUTCFullYear() - 1 : ref.getUTCFullYear());
  // בין העונות (למשל אוגוסט) — מתמחרים את החצי הראשון של העונה הבאה.
  if (ref.getTime() > season.end.getTime()) season = build(season.seasonYear + 1);

  const current =
    season.halves.find((h) => ref.getTime() < h.endExclusive.getTime()) || season.halves[0];
  return { ...season, current };
}

/** סטטוסים שאינם מעידים על השתתפות בחוג. */
const NON_JOIN_ATT_STATUSES = new Set(['cancelled', 'holiday']);
const INTRO_ATT_STATUSES = new Set(['intro_pending', 'intro_attended', 'intro_absent']);
/** סטטוסים שמעידים שהילד באמת הגיע לאימון. */
const ARRIVED_ATT_STATUSES = new Set(['attended', 'makeup', 'saturday_makeup']);
/** אימון ההכירות כבר כולל נעליים; החוג עצמו מתחיל שבוע אחריו. */
export const INTRO_GRACE_DAYS = 7;

function addDays(day, days) {
  const date = parseDayDate(day);
  if (!date) return null;
  return isoDay(new Date(date.getTime() + days * DAY_MS));
}

/**
 * תאריך ההצטרפות לחוג לפי רשימת הנוכחות.
 *
 * יש שורת הכירות → שבוע אחריה, בלי להמתין לשורה הבאה. חריג אחד: אם
 * הילד לא באמת התחיל אז — סומן „לא הגיע” באימונים שאחרי, או שלא נפתחו
 * לו שורות בכלל — האימון הראשון שהגיע אליו בפועל גובר. שורה שעדיין לא
 * סומנה איננה ראיה שלא התחיל, ולכן אינה מפעילה את החריג.
 *
 * אין שורת הכירות → האימון הראשון ברשימה הוא ההצטרפות.
 */
export function resolveJoinDate(attendance = []) {
  const rows = (Array.isArray(attendance) ? attendance : [])
    .map((row) => ({ ...row, day: isoDay(parseDayDate(row?.date)) }))
    .filter((row) => row.day && !NON_JOIN_ATT_STATUSES.has(row.status))
    .sort((a, b) => a.day.localeCompare(b.day));
  if (!rows.length) return null;

  let lastIntro = null;
  for (const row of rows) {
    if (INTRO_ATT_STATUSES.has(row.status)) lastIntro = row.day;
  }

  if (!lastIntro) {
    const first = rows.find((row) => !INTRO_ATT_STATUSES.has(row.status));
    return first ? first.day : null;
  }

  const base = addDays(lastIntro, INTRO_GRACE_DAYS);
  const after = rows.filter((row) => !INTRO_ATT_STATUSES.has(row.status) && row.day > lastIntro);
  const firstArrived = after.find((row) => ARRIVED_ATT_STATUSES.has(row.status));
  if (firstArrived && firstArrived.day > base) {
    const between = after.filter((row) => row.day < firstArrived.day);
    if (between.every((row) => row.status === 'absent')) return firstArrived.day;
  }
  return base;
}

/** מכמה אימונים בשבוע מתחיל המחיר הגבוה. */
export const TWICE_WEEKLY_SESSIONS = 2;

export const FREQUENCY_LABEL_ONCE = 'פעם בשבוע';
export const FREQUENCY_LABEL_TWICE = 'פעמיים בשבוע';

export function frequencyLabelFor(weeklySessions = 1) {
  return Number(weeklySessions) >= TWICE_WEEKLY_SESSIONS
    ? FREQUENCY_LABEL_TWICE
    : FREQUENCY_LABEL_ONCE;
}

/**
 * מחיר הבסיס לחצי עונה, לפני הקיזוז היחסי, לפי כמה אימונים בשבוע.
 * מקבל אובייקט הגדרות מלא או אובייקט מחירים בלבד — ראו pricesFrom.
 */
export function shoesBasePrice(settings, weeklySessions = 1) {
  const prices = pricesFrom(settings);
  return Number(weeklySessions) >= TWICE_WEEKLY_SESSIONS ? prices.shoes_twice : prices.shoes;
}

/**
 * מחיר הנעליים לחצי העונה הנוכחי, מקוזז לפי תאריך ההצטרפות.
 * `weeklySessions` בוחר את מחיר הבסיס — ראו studentFrequency.js.
 * @returns {{amount:number, full_price:number, remaining_units:number,
 *   total_units:number, prorated:boolean, join_date:string|null,
 *   weekly_sessions:number, frequency_label:string,
 *   half_label:string, half_start:string, half_end:string}}
 */
export function shoesSeasonPricing({
  settings = {},
  attendance = [],
  refDate = new Date(),
  weeklySessions = 1,
} = {}) {
  const s = normalizeEquipmentSettings(settings);
  const sessions = Math.max(1, Math.round(Number(weeklySessions) || 1));
  const fullPrice = shoesBasePrice(s, sessions);
  const ref = parseDayDate(refDate) || parseDayDate(new Date());
  const joinDate = resolveJoinDate(attendance);
  // בלי נוכחות רשומה — הקישור נשלח בהרשמה, לפני האימון הראשון,
  // ולכן ההצטרפות היא היום. אחרת חדש בדצמבר היה משלם חצי עונה מלאה.
  const joined = parseDayDate(joinDate) || ref;

  // מחייבים את החצי שבו הילד מתחיל להתאמן. שורות נוכחות עתידיות
  // (אימונים שכבר נפתחו ליומן) מזיזות את החיוב לחצי הנכון במקום
  // לגבות מינימום על חצי שכבר נגמר.
  const anchor = joined.getTime() > ref.getTime() ? joined : ref;
  const season = resolveSeasonHalves(s, anchor);
  const half = season.current;

  // מי שכבר התאמן לפני שהחצי נפתח משלם עליו במלואו.
  const effectiveStart = joined.getTime() > half.start.getTime() ? joined : half.start;

  const totalUnits = halfMonthUnits(half.start, half.endExclusive);
  let remainingUnits = halfMonthUnits(effectiveStart, half.endExclusive);
  if (remainingUnits > totalUnits) remainingUnits = totalUnits;
  // גם מי שמצטרף שבוע לפני הסוף משלם לפחות חצי חודש.
  if (remainingUnits < 0.5) remainingUnits = 0.5;

  const amount =
    totalUnits > 0
      ? Math.min(fullPrice, Math.max(0, Math.round((fullPrice * remainingUnits) / totalUnits)))
      : fullPrice;

  return {
    amount,
    full_price: fullPrice,
    remaining_units: remainingUnits,
    total_units: totalUnits,
    prorated: remainingUnits < totalUnits,
    join_date: joinDate,
    join_source: joinDate ? 'attendance' : 'today',
    intro_grace_days: INTRO_GRACE_DAYS,
    weekly_sessions: sessions,
    frequency_label: frequencyLabelFor(sessions),
    half_label: half.label,
    half_start: isoDay(half.start),
    // סוף כולל, לתצוגה להורה
    half_end: isoDay(new Date(half.endExclusive.getTime() - DAY_MS)),
    rental_starts_at: isoDay(effectiveStart),
  };
}

/**
 * Mark selected equipment items as paid after checkout / webhook.
 * @returns {{ updated: object[], errors: string[] }}
 */
export function markEquipmentItemsPaid({
  db,
  persist,
  studentId,
  itemTypes = [],
  shirtSize = null,
  paymentId = null,
  rentalDays = DEFAULT_EQUIPMENT_SETTINGS.rental_days,
  rentalEndsAt = null,
  paidAt = null,
} = {}) {
  const errors = [];
  const updated = [];
  const student = db.getOne('students', studentId);
  if (!isEquipmentEligibleStudent(student)) {
    return { updated, errors: ['המתאמן לא נמצא או אינו זכאי לציוד'] };
  }

  const rows = ensureStudentEquipment({ db, student, persist });
  const wanted = new Set(
    (Array.isArray(itemTypes) ? itemTypes : [])
      .map((t) => String(t || '').trim())
      .filter((t) => equipmentItemTypesForStudent(student).includes(t))
  );
  if (!wanted.size) return { updated, errors: ['לא נבחרו פריטי ציוד'] };

  const when = paidAt || new Date().toISOString();

  for (const row of rows) {
    if (!wanted.has(row.item_type)) continue;
    if (row.payment_status === 'paid' || row.payment_status === 'own' || row.payment_status === 'declined') {
      // Still allow shirt size update if missing on already-paid rows
      if (row.payment_status === 'paid' && row.item_type === 'shirt' && shirtSize && !row.shirt_size) {
        const patched = db.update('student_equipment', row.id, {
          shirt_size: String(shirtSize).trim(),
        });
        if (patched) {
          updated.push(patched);
          if (typeof persist === 'function') {
            Promise.resolve(persist('student_equipment', patched)).catch(() => {});
          }
        }
      }
      continue;
    }

    const patch = {
      payment_status: 'paid',
      paid_at: when,
      payment_id: paymentId || row.payment_id || null,
      fulfillment_status: row.fulfillment_status === 'given' ? 'given' : 'pending',
    };

    if (row.item_type === 'shirt' && shirtSize) {
      patch.shirt_size = String(shirtSize).trim();
    }
    if (row.item_type === 'shoes') {
      patch.rental_starts_at = when;
      // ההשכרה נגמרת עם חצי העונה, לא כעבור מספר ימים קבוע מהתשלום.
      patch.rental_ends_at = rentalEndsAt
        ? new Date(rentalEndsAt).toISOString()
        : addDaysIso(when, rentalDays);
    }

    const next = db.update('student_equipment', row.id, patch);
    if (next) {
      updated.push(next);
      if (typeof persist === 'function') {
        Promise.resolve(persist('student_equipment', next)).catch(() => {});
      }
    }
  }

  return { updated, errors };
}

/** Reset shoe rental cycle → unpaid + pending (ready for next half-year). */
export function resetShoeRental({ db, persist, rowId, givenBy = null } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  if (row.item_type !== 'shoes') return { ok: false, error: 'איפוס מחזור זמין רק לנעליים' };

  const next = db.update('student_equipment', row.id, {
    payment_status: 'unpaid',
    fulfillment_status: 'pending',
    paid_at: null,
    given_at: null,
    given_by: givenBy || null,
    payment_id: null,
    rental_starts_at: null,
    rental_ends_at: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

export function markEquipmentGiven({ db, persist, rowId, givenBy = null } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  if (row.payment_status !== 'paid') {
    return { ok: false, error: 'אפשר לסמן מסירה רק אחרי תשלום' };
  }
  if (row.fulfillment_status === 'given') return { ok: true, row };

  const next = db.update('student_equipment', row.id, {
    fulfillment_status: 'given',
    given_at: new Date().toISOString(),
    given_by: givenBy || null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

export function markEquipmentPendingFulfillment({ db, persist, rowId } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  const next = db.update('student_equipment', row.id, {
    fulfillment_status: 'pending',
    given_at: null,
    given_by: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

/** Child has own gear — no payment / no club handoff. */
export function markEquipmentOwn({ db, persist, rowId } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  if (row.payment_status === 'own') return { ok: true, row };

  const next = db.update('student_equipment', row.id, {
    payment_status: 'own',
    fulfillment_status: 'pending',
    paid_at: null,
    payment_id: null,
    given_at: null,
    given_by: null,
    rental_starts_at: null,
    rental_ends_at: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

/** Family not interested — no payment / no handoff needed. */
export function markEquipmentDeclined({ db, persist, rowId } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  // נעליים הן חובה — אין „לא מעוניינים” עליהן.
  if (row.item_type === 'shoes') {
    return { ok: false, error: 'נעליים הן ציוד חובה — אי אפשר לסמן „לא מעוניינים”' };
  }
  if (row.payment_status === 'declined') return { ok: true, row };

  const next = db.update('student_equipment', row.id, {
    payment_status: 'declined',
    fulfillment_status: 'pending',
    paid_at: null,
    payment_id: null,
    given_at: null,
    given_by: null,
    rental_starts_at: null,
    rental_ends_at: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

/** Clear resolved statuses back to unpaid + pending — ready for payment again. */
export function markEquipmentUnpaid({ db, persist, rowId } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };

  const next = db.update('student_equipment', row.id, {
    payment_status: 'unpaid',
    fulfillment_status: 'pending',
    paid_at: null,
    payment_id: null,
    given_at: null,
    given_by: null,
    rental_starts_at: null,
    rental_ends_at: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

/** @param {{shoes?:number}} [overrides] מחיר נעליים מקוזז, כשהוא ידוע */
/**
 * `settings` may be the whole settings object or just its `prices` — both are
 * passed around, and telling them apart by eye is exactly what went wrong: the
 * bot handed over a bare prices object, `normalizeEquipmentSettings` found no
 * `.prices` inside it, and every quote fell back to the built-in defaults. A
 * customer was told 350 ₪ for equipment priced at 280.
 */
function pricesFrom(settings) {
  if (settings && typeof settings === 'object' && !settings.prices
    && ('shoes' in settings || 'shirt' in settings || 'chalk_bag' in settings)) {
    return normalizeEquipmentSettings({ prices: settings }).prices;
  }
  return normalizeEquipmentSettings(settings).prices;
}

export function computeEquipmentTotal(settings, itemTypes = [], overrides = {}) {
  const prices = { ...pricesFrom(settings) };
  if (Number.isFinite(Number(overrides?.shoes))) {
    prices.shoes = Math.max(0, Number(overrides.shoes));
  }
  return (Array.isArray(itemTypes) ? itemTypes : []).reduce((sum, type) => {
    if (!EQUIPMENT_ITEM_TYPES.includes(type)) return sum;
    return sum + (Number(prices[type]) || 0);
  }, 0);
}

const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Apply the configured family discount when at least two distinct trainees have
 * a positive equipment subtotal in this payment. The returned values are safe
 * to snapshot on the payment so later settings changes cannot rewrite history.
 */
export function applyEquipmentFamilyDiscount(settings, allocations = []) {
  const normalized = normalizeEquipmentSettings(settings);
  const source = (Array.isArray(allocations) ? allocations : []).map((allocation) => ({
    ...allocation,
    subtotal: roundCurrency(Math.max(0, Number(allocation?.subtotal) || 0)),
  }));
  const positive = source.filter((allocation) => allocation.subtotal > 0);
  const eligibleCount = new Set(
    positive.map((allocation, index) => String(allocation.student_id || allocation.studentId || index))
  ).size;
  const percent = normalized.family_discount_enabled && eligibleCount >= 2
    ? normalized.family_discount_percent
    : 0;
  const subtotal = roundCurrency(source.reduce((sum, allocation) => sum + allocation.subtotal, 0));
  const discount = roundCurrency((subtotal * percent) / 100);
  let distributed = 0;
  let positiveIndex = 0;

  const pricedAllocations = source.map((allocation) => {
    if (allocation.subtotal <= 0 || percent <= 0) {
      return { ...allocation, discount_percent: percent, discount_amount: 0, total: allocation.subtotal };
    }
    positiveIndex += 1;
    const allocationDiscount = positiveIndex === positive.length
      ? roundCurrency(discount - distributed)
      : roundCurrency((allocation.subtotal / subtotal) * discount);
    distributed = roundCurrency(distributed + allocationDiscount);
    return {
      ...allocation,
      discount_percent: percent,
      discount_amount: allocationDiscount,
      total: roundCurrency(allocation.subtotal - allocationDiscount),
    };
  });

  return {
    enabled: normalized.family_discount_enabled,
    eligible: eligibleCount >= 2,
    eligible_count: eligibleCount,
    percent,
    subtotal,
    discount,
    total: roundCurrency(subtotal - discount),
    allocations: pricedAllocations,
  };
}

export function describeEquipmentItems(itemTypes = [], shirtSize = null) {
  const parts = (Array.isArray(itemTypes) ? itemTypes : [])
    .filter((t) => EQUIPMENT_ITEM_TYPES.includes(t))
    .map((t) => {
      const label = EQUIPMENT_ITEM_LABELS[t] || t;
      if (t === 'shirt' && shirtSize) return `${label} (מידה ${shirtSize})`;
      return label;
    });
  return parts.length ? `ציוד לאימונים: ${parts.join(', ')}` : 'ציוד לאימונים';
}

export function equipmentGapFlags(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  // "own" (from home) is resolved — not a payment gap.
  const unpaid = list.filter((r) => r.payment_status === 'unpaid');
  const awaitingHandoff = list.filter(
    (r) => r.payment_status === 'paid' && r.fulfillment_status !== 'given'
  );
  return {
    hasUnpaid: unpaid.length > 0,
    hasAwaitingHandoff: awaitingHandoff.length > 0,
    hasGap: unpaid.length > 0 || awaitingHandoff.length > 0,
    unpaidCount: unpaid.length,
    awaitingCount: awaitingHandoff.length,
  };
}

/** Items still owed for payment links / public checkout (excludes paid + own). */
export function unpaidEquipmentItems(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r.payment_status === 'unpaid');
}

export const EQUIPMENT_LIVE_APP_BASE = LIVE_APP_BASE;
export const EQUIPMENT_LIVE_API_BASE = LIVE_API_BASE;
export const EQUIPMENT_REDIRECT_PATH = '/e';

export const equipmentPublicBase = appPublicBase;
export const equipmentRedirectBase = apiRedirectBase;

/** Short link that survives a domain change: the server picks the destination. */
export function buildEquipmentRedirectUrl(token) {
  return buildRedirectUrl('e', token);
}

/** Seed WhatsApp draft template for equipment payment link (idempotent). */
export function ensureEquipmentWhatsappTemplate({ db, persist } = {}) {
  if (!db) return null;
  const templates = db.get('message_templates') || [];
  const existing = templates.find(
    (t) =>
      (t.meta_name || t.name) === EQUIPMENT_TEMPLATE_NAME ||
      t.id === 'tpl-equipment-update-or-purchase-v2'
  );
  if (existing) return existing;

  const buttonUrl = `${equipmentRedirectBase()}${EQUIPMENT_REDIRECT_PATH}/{{1}}`;

  const template = db.insert('message_templates', {
    id: 'tpl-equipment-update-or-purchase-v2',
    name: EQUIPMENT_TEMPLATE_NAME,
    meta_name: EQUIPMENT_TEMPLATE_NAME,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
    usage:
      'נשלחת לכל משפחה כדי לעדכן ציוד קיים משנים קודמות או לרכוש את החסר. ' +
      'הכפתור מוביל לדף שבו מסמנים מה כבר קיים ורוכשים רק פריטים חסרים.',
    body:
      'שלום {{1}},\n' +
      'לעדכון ציוד האימונים של {{2}} לחצו על הכפתור.\n' +
      'גם אם יש ציוד משנים קודמות, יש לסמן בדף מה כבר קיים ולרכוש רק את החסר.',
    header: '',
    footer: DEFAULT_BUSINESS_PROFILE.display_name,
    body_examples: ['דנה כהן', 'נועם כהן'],
    variables: [
      { key: '1', field: 'parent_name', label: 'שם הורה', example: 'דנה כהן' },
      { key: '2', field: 'child_name', label: 'שם הילד', example: 'נועם כהן' },
    ],
    buttons: [
      {
        type: 'URL',
        text: 'לעדכון או רכישת ציוד',
        url: buttonUrl,
        example: ['demo-token'],
      },
    ],
    active_for_send: false,
    created_at: new Date().toISOString(),
  });

  if (typeof persist === 'function') {
    Promise.resolve(persist('message_templates', template)).catch(() => {});
  }
  return template;
}
