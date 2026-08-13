/**
 * מחירון פעילויות — מסד כללי תמחור שאפשר לשייך לתבניות ולאירועים.
 *
 * המחירון אינו התבניות. תבנית מתארת איך נראה אירוע (שעות, טקסט, עיצוב); שורת
 * מחירון מתארת כמה הוא עולה, ואותה שורה משרתת כמה תבניות. אירוע יכול להצביע על
 * שורה כזאת, או לשאת מספרים משלו — בדיוק כמו תבנית.
 *
 * המבנה נשמר כמסמך ולא כטבלה, כי מדרגות הן רשימה באורך משתנה: בטבלה רגילה זו
 * טבלה שנייה ומיגרציה שנייה, וכאן זה פשוט מערך בתוך המסמך.
 */
import { normalizePriceIncludesVat, roundMoney } from './vat.js';
import { normalizeBrackets, normalizeCount, normalizeMoney } from './activityPricing.js';

export const PRICE_METHODS = ['flat', 'per_head', 'brackets'];

export const PRICE_RULE_CATEGORIES = [
  { id: 'wall', label: 'אירועים בקיר' },
  { id: 'field', label: 'פעילויות שטח' },
];

/** כמה גרסאות אחורה נשמרות. אירוע ישן חייב למצוא את הגרסה שלו — אבל לא לנצח. */
export const MAX_RULE_HISTORY = 30;

export function normalizePriceMethod(value) {
  return PRICE_METHODS.includes(value) ? value : 'flat';
}

export function normalizeRuleCategory(value) {
  return PRICE_RULE_CATEGORIES.some((c) => c.id === value) ? value : 'wall';
}

/** המספרים בלבד — מה שמגדיר כמה עולה. בלי שם, בלי הערות, בלי סדר ברשימה. */
export function ruleNumbers(rule = {}) {
  return {
    method: normalizePriceMethod(rule.method),
    price_includes_vat: normalizePriceIncludesVat(rule.price_includes_vat),
    event_price: normalizeMoney(rule.event_price),
    participant_price: normalizeMoney(rule.participant_price),
    min_participants: normalizeCount(rule.min_participants),
    extra_participant_price: normalizeMoney(rule.extra_participant_price),
    max_charge: normalizeMoney(rule.max_charge),
    brackets: normalizeBrackets(rule.brackets),
  };
}

export function normalizePriceRule(body = {}) {
  const numbers = ruleNumbers(body);
  return {
    name: String(body.name || '').trim(),
    category: normalizeRuleCategory(body.category),
    notes: body.notes || '',
    // משך הפעילות בדקות. הוא לא נכנס ל-ruleNumbers ולכן לא מעלה גרסה: הוא לא
    // משנה כמה עולה, אלא מסביר למה שעה וחצי עולה יותר משעה — ומכתיב את שעת
    // הסיום כשבוחרים את השורה באירוע.
    duration_minutes: normalizeCount(body.duration_minutes),
    ...numbers,
    // תקרת משתתפים למדריך. מוצגת בלבד — ראו הערת „למה לא מחשבים מדריכים” למטה.
    participants_per_guide: normalizeCount(body.participants_per_guide),
    is_active: body.is_active !== false,
    sort_order: Number(body.sort_order) || 0,
  };
}

/**
 * האם המספרים השתנו. שינוי שם או הערה לא מעלה גרסה — אחרת כל תיקון ניסוח היה
 * מציג „המחירון עודכן” על כל אירוע קיים, ומרוקן את ההתראה ממשמעות.
 */
export function ruleNumbersChanged(before = {}, after = {}) {
  return JSON.stringify(ruleNumbers(before)) !== JSON.stringify(ruleNumbers(after));
}

/** הגרסה שאירוע תומחר לפיה, או הנוכחית כשלא צוינה. null = לא נמצאה. */
export function ruleVersion(rule, version) {
  if (!rule) return null;
  const wanted = normalizeCount(version);
  if (wanted == null || wanted >= (Number(rule.version) || 1)) return ruleNumbers(rule);
  const past = (rule.versions || []).find((entry) => Number(entry.version) === wanted);
  return past ? ruleNumbers(past) : null;
}

/**
 * הכלל שאירוע מתומחר לפיו, בגרסה שלו.
 *
 * מחזיר `{ rule, numbers, stale }` או null כשאין קישור. `numbers: null` פירושו
 * שהכלל קיים אבל הגרסה איננה — במקרה כזה אסור לחשב מחיר, ואסור ליפול חזרה
 * לחישוב לפי ראש: 350×12 = 4,200₪ במקום 5,700₪ נראה סביר לגמרי, ולכן אף אחד
 * לא היה תופס את זה.
 */
export function resolveActivityRule(db, activity) {
  const ruleId = activity?.price_rule_id;
  if (!ruleId) return null;
  const rule = (db.get('activity_price_rules') || []).find(
    (row) => String(row.id) === String(ruleId)
  ) || null;
  if (!rule) return { rule: null, numbers: null, stale: false };
  const numbers = ruleVersion(rule, activity.price_rule_version);
  const stale = normalizeCount(activity.price_rule_version) != null
    && Number(activity.price_rule_version) < (Number(rule.version) || 1);
  return { rule, numbers, stale };
}

/**
 * סולם המדרגות מנושן — ארבע מדרגות ממחיר משתתף יחיד.
 *
 * שוחזר ואומת מול כל 12 המספרים הקיימים (350 / 250 / 390). המדרגה הרביעית
 * **אינה מעוגלת**: 6,550 × 1.4 = 9,170 בדיוק, ועיגול ל-50 היה נותן 9,150 —
 * עשרים שקלים שנופלים בשקט מכל טיול גדול.
 */
export function ladderFromSingle(singlePrice) {
  const base = Number(singlePrice) || 0;
  if (base <= 0) return [];
  const r50 = (value) => Math.round(value / 50) * 50;
  const first = r50(9.5 * base);
  const second = r50(1.7 * first);
  const third = r50(1.15 * second);
  const fourth = roundMoney(1.4 * third);
  return [
    { up_to: 10, amount: first },
    { up_to: 15, amount: second },
    { up_to: 20, amount: third },
    { up_to: 30, amount: fourth },
  ];
}

/** „שעה וחצי” / „45 דקות” — הצורה שבה מדברים על משך, לא „90 דקות”. */
export function describeDuration(minutes) {
  const total = normalizeCount(minutes);
  if (!total) return '';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} דקות`;
  if (!rest) return hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${hours} שעות`;
  if (rest === 30) return hours === 1 ? 'שעה וחצי' : `${hours} שעות וחצי`;
  return hours === 1 ? `שעה ו-${rest} דקות` : `${hours} שעות ו-${rest} דקות`;
}

/** תקציר לשורה ברשימה ובבורר. */
export function describeRule(rule) {
  if (!rule) return '';
  const numbers = ruleNumbers(rule);
  const ils = (value) => `₪${roundMoney(value).toLocaleString('en-US')}`;
  const duration = describeDuration(rule.duration_minutes);
  const withDuration = (text) => (duration ? `${text} · ${duration}` : text);
  if (numbers.method === 'flat') {
    return withDuration(numbers.event_price ? `${ils(numbers.event_price)} לאירוע` : 'בלי מחיר');
  }
  if (numbers.method === 'brackets') {
    const rows = numbers.brackets;
    if (!rows.length) return withDuration('מדרגות — עדיין ריק');
    const bits = [`${rows.length} מדרגות`, `עד ${rows[rows.length - 1].up_to} משתתפים`];
    if (numbers.participant_price) bits.push(`${ils(numbers.participant_price)} למשתתף יחיד`);
    return withDuration(bits.join(' · '));
  }
  const bits = [`${ils(numbers.participant_price || 0)} לראש`];
  if (numbers.min_participants) bits.push(`מינימום ${numbers.min_participants}`);
  if (numbers.extra_participant_price && numbers.min_participants) {
    bits.push(`${ils(numbers.extra_participant_price)} לכל נוסף`);
  }
  if (numbers.max_charge) bits.push(`עד ${ils(numbers.max_charge)}`);
  return withDuration(bits.join(' · '));
}

/**
 * שלוש שורות המחירון של פעילויות השטח, כפי שהן בנושן.
 *
 * המספרים הועתקו כלשונם ולא חושבו מחדש — הסולם רק מייצר אותם, והם מה שנשמר.
 * `participants_per_guide` הוא תיעוד ולא חישוב: הקפיצות במחיר (‎+70% / ‎+15% /
 * ‎+40%) כבר מכילות את המדריך הנוסף, ומודל שמחשב „מדריכים × תעריף יום” היה
 * דורש 1,500₪ למדריך בקפיצה הראשונה ו-920₪ בשנייה — כלומר הוא לא המודל הזה.
 */
export const STARTER_PRICE_RULES = [
  {
    id: 'pr_field_trip_day',
    duration_minutes: 480,
    name: 'יום טיול',
    category: 'field',
    method: 'brackets',
    participant_price: 350,
    price_includes_vat: true,
    participants_per_guide: 10,
    brackets: [
      { up_to: 10, amount: 3350 },
      { up_to: 15, amount: 5700 },
      { up_to: 20, amount: 6550 },
      { up_to: 30, amount: 9170 },
    ],
    sort_order: 10,
    notes: 'מחיר קבוצתי לפי גודל הקבוצה. משתתף יחיד בהרשמה פתוחה — 350₪.',
  },
  {
    id: 'pr_field_rappel',
    duration_minutes: 480,
    name: 'גלישה במצוק',
    category: 'field',
    method: 'brackets',
    participant_price: 250,
    price_includes_vat: true,
    participants_per_guide: 10,
    brackets: [
      { up_to: 10, amount: 2400 },
      { up_to: 15, amount: 4100 },
      { up_to: 20, amount: 4700 },
      { up_to: 30, amount: 6580 },
    ],
    sort_order: 20,
  },
  {
    id: 'pr_field_climb_day',
    duration_minutes: 480,
    name: 'יום טיפוס',
    category: 'field',
    method: 'brackets',
    participant_price: 390,
    price_includes_vat: true,
    participants_per_guide: 10,
    brackets: [
      { up_to: 10, amount: 3700 },
      { up_to: 15, amount: 6300 },
      { up_to: 20, amount: 7250 },
      { up_to: 30, amount: 10150 },
    ],
    sort_order: 30,
  },
  {
    id: 'pr_wall_camp_hosting',
    duration_minutes: 90,
    name: 'אירוח קייטנה',
    category: 'wall',
    method: 'per_head',
    participant_price: 70,
    min_participants: 20,
    price_includes_vat: false,
    sort_order: 40,
    notes: 'כולל נעלי טיפוס וארטיק.',
  },
  {
    id: 'pr_wall_company_day',
    duration_minutes: 90,
    name: 'יום פעילות לחברות',
    category: 'wall',
    method: 'per_head',
    participant_price: 105,
    min_participants: 10,
    price_includes_vat: false,
    sort_order: 50,
    notes: 'כולל נעלי טיפוס.',
  },
  {
    id: 'pr_wall_birthday_structured',
    duration_minutes: 120,
    name: 'יום הולדת — אירוע מובנה',
    category: 'wall',
    method: 'per_head',
    participant_price: 110,
    min_participants: 15,
    max_charge: 2500,
    price_includes_vat: false,
    sort_order: 60,
    notes: 'מעל 23 ילדים החיוב נעצר על 2,500₪.',
  },
  {
    id: 'pr_wall_birthday_open',
    duration_minutes: 90,
    name: 'יום הולדת או אירוע — לא מובנה',
    category: 'wall',
    method: 'per_head',
    participant_price: 60,
    price_includes_vat: false,
    sort_order: 70,
    notes: 'מדריך נוער אחד לכל 3 ילדים בעלות 100₪ למדריך — נוסף ידנית.',
  },
  {
    id: 'pr_wall_school_bonding_morning',
    duration_minutes: 90,
    name: 'גיבוש בית ספר — שעות פתיחה',
    category: 'wall',
    method: 'per_head',
    participant_price: 50,
    min_participants: 20,
    extra_participant_price: 40,
    price_includes_vat: false,
    sort_order: 80,
  },
  {
    id: 'pr_wall_school_bonding_noon',
    duration_minutes: 90,
    name: 'גיבוש בית ספר — שעות הצהריים',
    category: 'wall',
    method: 'per_head',
    participant_price: 60,
    min_participants: 20,
    extra_participant_price: 40,
    price_includes_vat: false,
    sort_order: 90,
  },
  {
    id: 'pr_wall_school_single',
    duration_minutes: 60,
    name: 'פעילות חד פעמית לבתי ספר',
    category: 'wall',
    method: 'flat',
    event_price: 750,
    price_includes_vat: false,
    sort_order: 100,
  },
  {
    id: 'pr_wall_school_series_5',
    duration_minutes: 60,
    name: 'סדרת פעילות לבתי ספר — 5 מפגשים',
    category: 'wall',
    method: 'flat',
    event_price: 3500,
    price_includes_vat: false,
    sort_order: 110,
  },
  {
    id: 'pr_wall_school_series_10',
    duration_minutes: 60,
    name: 'סדרת פעילות לבתי ספר — 10 מפגשים',
    category: 'wall',
    method: 'flat',
    event_price: 6500,
    price_includes_vat: false,
    sort_order: 120,
  },
];

/** מוסיף שורות חסרות בלבד. לעולם לא דורס עריכה של הצוות. */
export function ensureSeedPriceRules(db) {
  const existing = db.get('activity_price_rules') || [];
  const byId = new Map(existing.map((row) => [String(row.id), row]));
  let inserted = 0;
  let filled = 0;
  for (const seed of STARTER_PRICE_RULES) {
    const current = byId.get(seed.id);
    if (current) {
      // שורות שנזרעו לפני שהיה שדה משך נשארו בלי אחד. מילוי שדה ריק אינו
      // דריסה — ערך שהצוות הקליד לא ייגע.
      if (!normalizeCount(current.duration_minutes) && seed.duration_minutes) {
        db.update('activity_price_rules', current.id, {
          duration_minutes: seed.duration_minutes,
        });
        filled += 1;
      }
      continue;
    }
    db.insert('activity_price_rules', {
      id: seed.id,
      ...normalizePriceRule(seed),
      version: 1,
      versions: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    inserted += 1;
  }
  return { inserted, filled, total: (db.get('activity_price_rules') || []).length };
}

export function listPriceRules(db, { includeInactive = false } = {}) {
  ensureSeedPriceRules(db);
  return (db.get('activity_price_rules') || [])
    .filter((rule) => includeInactive || rule.is_active !== false)
    .sort((a, b) => {
      const cat = String(a.category || 'wall').localeCompare(String(b.category || 'wall'));
      if (cat !== 0) return cat;
      const order = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (order !== 0) return order;
      return String(a.name || '').localeCompare(String(b.name || ''), 'he');
    });
}

/** כמה תבניות וכמה אירועים מקושרים לכלל — נדרש לפני ארכוב. */
export function priceRuleUsage(db, ruleId) {
  const id = String(ruleId || '');
  if (!id) return { templates: 0, activities: 0 };
  const templates = (db.get('activity_templates') || [])
    .filter((row) => String(row.price_rule_id || '') === id).length;
  const activities = (db.get('activities') || [])
    .filter((row) => String(row.price_rule_id || '') === id).length;
  return { templates, activities };
}
