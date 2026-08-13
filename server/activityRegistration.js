/**
 * Helpers for activity public registration pages, capacity, and templates.
 */
import crypto from 'crypto';
import { clampImage } from './productCategories.js';
import { DEFAULT_BUSINESS_PROFILE } from './businessProfile.js';
import { normalizePriceIncludesVat } from './vat.js';
import { normalizeChargeBasis, normalizeCount, normalizeMoney } from './activityPricing.js';
import { normalizeParticipationScope, scopeForActivity } from './participationDocuments.js';
import { activityDayList, singleDayEnabled, singleDayPrice } from './activityDays.js';

const PAYMENT_STATUSES = new Set(['unpaid', 'paid', 'partial', 'refunded']);

/** Fixed MVP categories — Hebrew labels live in the UI only. */
export const TEMPLATE_CATEGORIES = [
  { id: 'field', label: 'פעילויות שטח' },
  { id: 'wall', label: 'אירועים בקיר' },
  { id: 'ops', label: 'תפעול' },
];

export const TEMPLATE_CATEGORY_IDS = new Set(TEMPLATE_CATEGORIES.map((c) => c.id));

/** Sanitize registration_theme / template theme (cover image size + format). */
export function sanitizeRegistrationTheme(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const theme = { ...raw };
  if (theme.cover_image !== undefined) {
    theme.cover_image = theme.cover_image ? clampImage(theme.cover_image) : '';
  }
  if (theme.cover_position !== undefined) {
    const pos = String(theme.cover_position || '').trim();
    theme.cover_position = pos || '50% 50%';
  }
  return theme;
}

export function makeRegistrationSlug() {
  return crypto.randomBytes(6).toString('hex');
}

export function makePrivatePaymentToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function normalizeHostPaymentStatus(value) {
  const v = String(value || 'unpaid').toLowerCase();
  return PAYMENT_STATUSES.has(v) ? v : 'unpaid';
}

export function normalizeTemplateCategory(value) {
  const v = String(value || 'wall').toLowerCase();
  return TEMPLATE_CATEGORY_IDS.has(v) ? v : 'wall';
}

/** A registration that still holds a place on the participant list. */
export function registrationHoldsPlace(r, now = Date.now()) {
  return (
    ['active', 'confirmed'].includes(String(r?.status || 'active')) ||
    (
      String(r?.status) === 'pending_payment' &&
      (!r.hold_expires_at || new Date(r.hold_expires_at).getTime() > now)
    )
  );
}

export function activeRegistrations(db, activityId) {
  const now = Date.now();
  return (db.get('activity_registrations') || []).filter(
    (r) => String(r.activity_id) === String(activityId) && registrationHoldsPlace(r, now)
  );
}

/**
 * Live registrations tied to one person or payer. Deleting them while these
 * exist leaves a participant on the event list that no CRM card explains.
 * @param {'student_id'|'parent_id'} field
 */
export function heldRegistrationsBy(db, field, id) {
  const now = Date.now();
  return (db.get('activity_registrations') || []).filter(
    (r) => String(r[field] || '') === String(id) && registrationHoldsPlace(r, now)
  );
}

export function remainingCapacity(activity, registrations) {
  const max = activity?.max_participants;
  if (max == null || max === '' || Number.isNaN(Number(max))) return null;
  const used = Array.isArray(registrations) ? registrations.length : 0;
  return Math.max(0, Number(max) - used);
}

export function registrationIsOpen(activity) {
  if (!activity?.registration_enabled) return false;
  if (['cancelled', 'closed', 'archived'].includes(String(activity.status || '').toLowerCase())) return false;
  if (activity.registration_closes_at) {
    const closes = new Date(activity.registration_closes_at).getTime();
    if (!Number.isNaN(closes) && Date.now() > closes) return false;
  }
  return true;
}

export function findActivityBySlug(db, slug) {
  const needle = String(slug || '').trim();
  if (!needle) return null;
  return (db.get('activities') || []).find(
    (a) =>
      String(a.participant_registration_slug || '') === needle ||
      String(a.registration_slug || '') === needle
  ) || null;
}

/** Normalize theme JSON that may arrive as a string from storage. */
export function normalizeActivityTheme(raw) {
  let theme = raw;
  if (typeof theme === 'string') {
    try {
      theme = JSON.parse(theme);
    } catch {
      return {};
    }
  }
  if (!theme || typeof theme !== 'object' || Array.isArray(theme)) return {};
  return theme;
}

/** Lead source key for a new parent registering via a public activity page. */
/**
 * The lead source keeps the finer grain the calendar gave up: an event is one
 * type to staff and to pay, but "came from a school group" and "came from a
 * birthday" are different answers to where business comes from, and that is
 * what this feeds. The kind is read first, falling back to the legacy type.
 */
export function leadSourceFromActivityType(type, eventKind = '') {
  const kind = String(eventKind || '').toLowerCase();
  const key = String(type || '').toLowerCase();
  if (key === 'event' || ['birthday', 'school', 'company'].includes(key)) {
    const resolved = kind || (key === 'event' ? '' : key);
    return resolved ? `activity_${resolved}` : 'activity_event';
  }
  if (key === 'trip') return 'activity_trip';
  return 'activity_registration';
}

export function publicRegistrationPayload(activity, registrations) {
  const remaining = remainingCapacity(activity, registrations);
  const price = Number(activity.price) || 0;
  const registrationMode = activity.registration_mode || (
    activity.collect_registration_payment ? 'paid_per_participant' : 'host_pays'
  );
  const collectPay = registrationMode === 'paid_per_participant' && price > 0;
  const safeTheme = normalizeActivityTheme(
    activity.registration_theme || activity.theme || {}
  );
  return {
    id: activity.id,
    name: activity.name,
    type: activity.type,
    participation_scope: scopeForActivity(activity),
    date: activity.date,
    end_date: activity.end_date || null,
    start_time: activity.start_time,
    end_time: activity.end_time,
    all_day: !!activity.all_day,
    location: activity.location || '',
    description: activity.description || '',
    price,
    price_includes_vat: normalizePriceIncludesVat(activity.price_includes_vat),
    max_participants: activity.max_participants ?? null,
    registered_count: registrations.length,
    remaining,
    registration_open: registrationIsOpen(activity) && (remaining == null || remaining > 0),
    registration_mode: registrationMode,
    collect_payment: collectPay,
    unit_price: collectPay ? price : 0,
    // ימי האירוע נשלחים מהשרת ולא נגזרים בדפדפן, כדי ששני הצדדים לא יחשבו
    // את אותו טווח בנפרד ויסתרו זה את זה.
    days: activityDayList(activity),
    allow_single_day: singleDayEnabled(activity),
    single_day_price: singleDayEnabled(activity) ? singleDayPrice(activity) : 0,
    page_title: activity.registration_page_title || activity.name || '',
    page_body: activity.registration_page_body || activity.description || '',
    audience: activity.audience || '',
    included: activity.included || '',
    what_to_bring: activity.what_to_bring || '',
    important_info: activity.important_info || '',
    // A deliberate "no customer cancellation" choice is still a public term.
    // Keep it separate from a missing policy so the event page can explain it.
    cancellation_policy_disabled: activity.cancellation_policy_disabled === true,
    cover_image: safeTheme.cover_image || '',
    cover_position: safeTheme.cover_position || '50% 50%',
    host_name: activity.host_name || activity.contact_name || '',
    theme: safeTheme,
  };
}

export function templateFieldsFromActivity(activity = {}) {
  return {
    name: activity.name || '',
    type: activity.type || 'birthday',
    event_kind: activity.event_kind || '',
    participation_scope: scopeForActivity(activity),
    category: normalizeTemplateCategory(activity.category),
    location: activity.location || '',
    price: Number(activity.price) || 0,
    price_includes_vat: normalizePriceIncludesVat(activity.price_includes_vat),
    max_participants: activity.max_participants ?? null,
    // התבנית היא שורת מחירון, ולכן היא נושאת גם את כללי התמחור עצמם ולא רק מספר.
    charge_basis: normalizeChargeBasis(activity.charge_basis),
    min_participants: normalizeCount(activity.min_participants),
    extra_participant_price: normalizeMoney(activity.extra_participant_price),
    max_charge: normalizeMoney(activity.max_charge),
    description: activity.description || '',
    notes: activity.notes || '',
    start_time: activity.start_time || null,
    end_time: activity.end_time || null,
    all_day: !!activity.all_day,
    registration_enabled: !!activity.registration_enabled,
    show_on_site: !!activity.show_on_site,
    collect_registration_payment: !!activity.collect_registration_payment,
    registration_mode: activity.registration_mode || (
      activity.collect_registration_payment ? 'paid_per_participant' : 'host_pays'
    ),
    registration_page_title: activity.registration_page_title || '',
    registration_page_body: activity.registration_page_body || '',
    audience: activity.audience || '',
    included: activity.included || '',
    what_to_bring: activity.what_to_bring || '',
    important_info: activity.important_info || '',
    cancellation_policy_id: activity.cancellation_policy_id || null,
    cancellation_policy_disabled: activity.cancellation_policy_disabled === true,
    theme:
      (activity.theme && typeof activity.theme === 'object' && activity.theme)
      || (activity.registration_theme && typeof activity.registration_theme === 'object' && activity.registration_theme)
      || {},
    sort_order: Number(activity.sort_order) || 0,
    is_active: activity.is_active !== false,
  };
}

export function normalizeTemplatePayload(body = {}) {
  const theme = sanitizeRegistrationTheme(
    body.theme && typeof body.theme === 'object' && !Array.isArray(body.theme)
      ? body.theme
      : {}
  );
  return {
    name: String(body.name || '').trim(),
    type: body.type || 'birthday',
    // התגית נשמרת גם על התבנית: קייטנה אינה אחד מהסוגים הישנים, ובלי התגית
    // שורת מחירון של קייטנה הייתה נוחתת ביומן כסוג לא מוכר.
    event_kind: body.event_kind || body.eventKind || '',
    participation_scope: body.participation_scope
      ? normalizeParticipationScope(body.participation_scope)
      : scopeForActivity(body),
    category: normalizeTemplateCategory(body.category),
    location: body.location || '',
    price: body.price === '' || body.price == null ? 0 : Number(body.price) || 0,
    price_includes_vat: normalizePriceIncludesVat(body.price_includes_vat),
    max_participants:
      body.max_participants === '' || body.max_participants == null
        ? null
        : Number(body.max_participants) || null,
    charge_basis: normalizeChargeBasis(body.charge_basis),
    min_participants: normalizeCount(body.min_participants),
    extra_participant_price: normalizeMoney(body.extra_participant_price),
    max_charge: normalizeMoney(body.max_charge),
    description: body.description || '',
    notes: body.notes || '',
    start_time: body.all_day ? null : (body.start_time || null),
    end_time: body.all_day ? null : (body.end_time || null),
    all_day: !!body.all_day,
    registration_enabled: !!body.registration_enabled,
    // Opt-in publishing: a private birthday must never reach the public site
    // just because it has a registration link.
    show_on_site: !!body.show_on_site,
    collect_registration_payment: !!body.collect_registration_payment,
    registration_mode: body.registration_mode === 'host_pays'
      ? 'host_pays'
      : 'paid_per_participant',
    registration_page_title: body.registration_page_title || '',
    registration_page_body: body.registration_page_body || '',
    audience: body.audience || '',
    included: body.included || '',
    what_to_bring: body.what_to_bring || '',
    important_info: body.important_info || '',
    cancellation_policy_id: body.cancellation_policy_id || null,
    cancellation_policy_disabled: body.cancellation_policy_disabled === true,
    theme,
    sort_order: body.sort_order == null ? 0 : Number(body.sort_order) || 0,
    is_active: body.is_active !== false,
  };
}

/** Prefill shape for a new calendar activity form (not yet saved). */
export function activityDraftFromTemplate(template = {}, { date } = {}) {
  const fields = templateFieldsFromActivity(template);
  return {
    name: fields.name,
    type: fields.type,
    event_kind: fields.event_kind || '',
    participation_scope: fields.participation_scope,
    date: date || null,
    end_date: null,
    start_time: fields.start_time || '10:00',
    end_time: fields.end_time || '12:00',
    all_day: !!fields.all_day,
    location: fields.location,
    price: fields.price,
    price_includes_vat: normalizePriceIncludesVat(fields.price_includes_vat),
    max_participants: fields.max_participants,
    charge_basis: fields.charge_basis,
    min_participants: fields.min_participants,
    extra_participant_price: fields.extra_participant_price,
    max_charge: fields.max_charge,
    // מאיזו שורת מחירון האירוע נבנה. הסכום לעולם לא נקרא מכאן בזמן חיוב — שינוי
    // מחיר במחירון לא אמור לתמחר מחדש יום הולדת שכבר הוצע ללקוח.
    price_template_id: template.id || null,
    description: fields.description,
    notes: fields.notes,
    host_name: '',
    host_email: '',
    host_phone: '',
    host_parent_id: null,
    contact_name: '',
    contact_phone: '',
    payment_status: 'unpaid',
    registration_enabled: !!fields.registration_enabled,
    show_on_site: !!fields.show_on_site,
    collect_registration_payment: !!fields.collect_registration_payment,
    registration_mode: fields.registration_mode,
    registration_page_title: fields.registration_page_title || fields.name,
    registration_page_body: fields.registration_page_body || fields.description,
    audience: fields.audience || '',
    included: fields.included || '',
    what_to_bring: fields.what_to_bring || '',
    important_info: fields.important_info || '',
    cancellation_policy_id: fields.cancellation_policy_id || null,
    cancellation_policy_disabled: fields.cancellation_policy_disabled === true,
    registration_theme: fields.theme || {},
    status: 'open',
    _from_template_id: template.id || null,
    _from_template_category: fields.category,
  };
}

/**
 * Starter templates — stable ids so seed is idempotent.
 * category: field = פעילויות שטח, wall = אירועים בקיר, ops = תפעול
 */
export const STARTER_ACTIVITY_TEMPLATES = [
  {
    id: 'tpl_field_rahaf',
    category: 'field',
    sort_order: 10,
    name: 'טיול לנחל רחף',
    type: 'trip',
    price: 180,
    max_participants: 25,
    location: 'נחל רחף',
    description: 'טיול שטח לנחל רחף — ציוד בסיסי, מים ונעלי הליכה.',
    registration_enabled: true,
    collect_registration_payment: true,
    registration_page_title: 'טיול לנחל רחף',
    registration_page_body: `הרשמה לטיול שטח עם ${DEFAULT_BUSINESS_PROFILE.display_name}. מלאו פרטים ואשרו מקום.`,
    theme: { accent: '#60A5FA' },
    start_time: '08:00',
    end_time: '16:00',
  },
  {
    id: 'tpl_field_black_canyon',
    category: 'field',
    sort_order: 20,
    name: 'טיול לנקיק השחור',
    type: 'trip',
    price: 200,
    max_participants: 20,
    location: 'נקיק השחור',
    description: 'טיול לנקיק השחור — רמת קושי בינונית, חובה נעלי הליכה.',
    registration_enabled: true,
    collect_registration_payment: true,
    registration_page_title: 'טיול לנקיק השחור',
    registration_page_body: 'מקומות מוגבלים. ההרשמה כוללת תשלום מראש.',
    theme: { accent: '#34D399' },
    start_time: '07:30',
    end_time: '15:30',
  },
  {
    id: 'tpl_field_kabra',
    category: 'field',
    sort_order: 30,
    name: 'יום טיפוס בכברה',
    type: 'trip',
    price: 220,
    max_participants: 16,
    location: 'כברה',
    description: 'יום טיפוס בטבע בכברה — ציוד טיפוס מסופק לפי הצורך.',
    registration_enabled: true,
    collect_registration_payment: true,
    registration_page_title: 'יום טיפוס בכברה',
    registration_page_body: `יום שטח של טיפוס עם מדריכי ${DEFAULT_BUSINESS_PROFILE.display_name}.`,
    theme: { accent: '#A78BFA' },
    start_time: '08:00',
    end_time: '15:00',
  },
  {
    id: 'tpl_wall_private',
    category: 'wall',
    sort_order: 10,
    name: 'אימונים אישיים',
    type: 'other',
    price: 250,
    max_participants: 2,
    location: 'בקיר',
    description: 'אימון אישי / זוגי עם מדריך.',
    registration_enabled: false,
    collect_registration_payment: false,
    registration_page_title: 'אימון אישי',
    registration_page_body: '',
    theme: { accent: '#38BDF8' },
    start_time: '16:00',
    end_time: '17:00',
  },
  {
    id: 'tpl_wall_birthday',
    category: 'wall',
    sort_order: 20,
    name: 'יום הולדת',
    type: 'birthday',
    price: 1200,
    max_participants: 15,
    location: 'בקיר',
    description: 'חבילת יום הולדת בקיר — מדריך, זמן טיפוס וכיבוד בסיסי לפי תיאום.',
    registration_enabled: true,
    collect_registration_payment: false,
    registration_page_title: 'יום הולדת בקיר',
    registration_page_body: 'מזמינים אתכם לחגוג איתנו! מלאו פרטי משתתפים.',
    theme: { accent: '#FB923C' },
    start_time: '10:00',
    end_time: '12:00',
  },
  {
    id: 'tpl_wall_teambuilding',
    category: 'wall',
    sort_order: 30,
    name: 'פעילות גיבוש',
    type: 'company',
    price: 180,
    max_participants: 30,
    location: 'בקיר',
    description: 'פעילות גיבוש לקבוצות וחברות — טיפוס ומשחקי צוות.',
    registration_enabled: true,
    collect_registration_payment: true,
    registration_page_title: 'פעילות גיבוש',
    registration_page_body: 'הרשמה למשתתפי הגיבוש. המחיר לאדם.',
    theme: { accent: '#FBBF24' },
    start_time: '09:00',
    end_time: '12:00',
  },
  // ‏מכאן ומטה: מחירון האירועים בקיר. כל שורה כאן היא שורת מחירון אמיתית, ולכן
  // היא נושאת גם את כלל התמחור ולא רק מספר — מחיר לראש, מינימום משתתפים,
  // תוספת מעבר למינימום ותקרת חיוב. כולן במצב „המזמין משלם”: בית ספר או חברה
  // מקבלים חשבונית אחת על כל הקבוצה, לא קישור לכל ילד.
  {
    id: 'tpl_wall_camp_hosting',
    category: 'wall',
    sort_order: 40,
    name: 'אירוח קייטנה',
    type: 'event',
    event_kind: 'camp',
    price: 70,
    charge_basis: 'per_participant',
    min_participants: 20,
    max_participants: null,
    location: 'בקיר',
    description: 'עלות לאדם 70₪, כולל נעלי טיפוס וארטיק. מינימום 20 ילדים.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'אירוח קייטנה בקיר',
    registration_page_body: 'מלאו את פרטי המשתתפים. התשלום מרוכז מול מנהל הקייטנה.',
    theme: { accent: '#F472B6' },
    start_time: '09:00',
    end_time: '10:30',
  },
  {
    id: 'tpl_wall_school_single',
    category: 'wall',
    sort_order: 50,
    name: 'פעילות חד פעמית לבתי ספר',
    type: 'event',
    event_kind: 'school',
    price: 750,
    charge_basis: 'flat',
    max_participants: 12,
    location: 'בקיר',
    description: 'פעילות חד פעמית לקבוצה של עד 12 תלמידים.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'פעילות בית ספר בקיר',
    registration_page_body: 'מלאו את פרטי המשתתפים. התשלום מרוכז מול בית הספר.',
    theme: { accent: '#60A5FA' },
    start_time: '09:00',
    end_time: '10:00',
  },
  {
    id: 'tpl_wall_company_day',
    category: 'wall',
    sort_order: 60,
    name: 'יום פעילות לחברות',
    type: 'event',
    event_kind: 'company',
    price: 105,
    charge_basis: 'per_participant',
    min_participants: 10,
    max_participants: null,
    location: 'בקיר',
    description: 'עלות לאדם 105₪, כולל נעלי טיפוס. מינימום 10 משתתפים.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'יום פעילות לחברה',
    registration_page_body: 'מלאו את פרטי המשתתפים. התשלום מרוכז מול החברה.',
    theme: { accent: '#FBBF24' },
    start_time: '09:00',
    end_time: '10:30',
  },
  {
    id: 'tpl_wall_birthday_structured',
    category: 'wall',
    sort_order: 70,
    name: 'יום הולדת — אירוע מובנה',
    type: 'event',
    event_kind: 'birthday',
    price: 110,
    charge_basis: 'per_participant',
    min_participants: 15,
    max_charge: 2500,
    max_participants: 30,
    location: 'בקיר',
    description:
      '110₪ לילד, מינימום 15 ילדים ועד 30. מעל 23 ילדים החיוב נעצר על 2,500₪. '
      + 'כולל משחק משימות מגניב עם חץ וקשת, טיפוס על הקיר, מתקנים והרמת יום הולדת.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'יום הולדת בקיר',
    registration_page_body: 'מזמינים אתכם לחגוג איתנו! מלאו את פרטי המשתתפים.',
    theme: { accent: '#FB923C' },
    start_time: '16:00',
    end_time: '18:00',
  },
  {
    id: 'tpl_wall_birthday_open',
    category: 'wall',
    sort_order: 80,
    name: 'יום הולדת או אירוע — לא מובנה',
    type: 'event',
    event_kind: 'birthday',
    price: 60,
    charge_basis: 'per_participant',
    max_participants: 12,
    location: 'בקיר',
    description:
      '60₪ כניסה לילד, לקבוצות עד 12 ילדים בשעות הפתיחה של הקיר. '
      + 'מדריך נוער אחד לכל 3 ילדים בעלות של 100₪ למדריך — נוסף ידנית לפי מספר המדריכים.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'אירוע בקיר',
    registration_page_body: 'מלאו את פרטי המשתתפים.',
    theme: { accent: '#F97316' },
    start_time: '16:00',
    end_time: '17:30',
  },
  {
    id: 'tpl_wall_school_series_10',
    category: 'wall',
    sort_order: 90,
    name: 'סדרת פעילות לבתי ספר — 10 מפגשים',
    type: 'event',
    event_kind: 'school',
    price: 6500,
    charge_basis: 'flat',
    max_participants: 10,
    location: 'בקיר',
    description: 'סדרה של 10 מפגשים, עד 10 ילדים, מתאים לגילאי 9–13.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'סדרת פעילות לבית ספר',
    registration_page_body: 'מלאו את פרטי המשתתפים בסדרה.',
    theme: { accent: '#34D399' },
    start_time: '09:00',
    end_time: '10:00',
  },
  {
    id: 'tpl_wall_school_series_5',
    category: 'wall',
    sort_order: 100,
    name: 'סדרת פעילות לבתי ספר — 5 מפגשים',
    type: 'event',
    event_kind: 'school',
    price: 3500,
    charge_basis: 'flat',
    max_participants: 10,
    location: 'בקיר',
    description: 'סדרה של 5 מפגשים, עד 10 ילדים, מתאים לגילאי 9–13.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'סדרת פעילות לבית ספר',
    registration_page_body: 'מלאו את פרטי המשתתפים בסדרה.',
    theme: { accent: '#34D399' },
    start_time: '09:00',
    end_time: '10:00',
  },
  {
    id: 'tpl_wall_school_bonding_morning',
    category: 'wall',
    sort_order: 110,
    name: 'פעילות גיבוש לבית ספר — שעות פתיחה',
    type: 'event',
    event_kind: 'school',
    price: 50,
    charge_basis: 'per_participant',
    min_participants: 20,
    extra_participant_price: 40,
    max_participants: null,
    location: 'בקיר',
    description: '50₪ לילד לפי מינימום של 20 ילדים, ותוספת של 40₪ לכל ילד נוסף.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'פעילות גיבוש בקיר',
    registration_page_body: 'מלאו את פרטי המשתתפים. התשלום מרוכז מול בית הספר.',
    theme: { accent: '#A78BFA' },
    start_time: '09:00',
    end_time: '10:30',
  },
  {
    id: 'tpl_wall_school_bonding_noon',
    category: 'wall',
    sort_order: 120,
    name: 'פעילות גיבוש לבית ספר — שעות הצהריים',
    type: 'event',
    event_kind: 'school',
    price: 60,
    charge_basis: 'per_participant',
    min_participants: 20,
    extra_participant_price: 40,
    max_participants: null,
    location: 'בקיר',
    description: '60₪ לילד לפי מינימום של 20 ילדים, ותוספת של 40₪ לכל ילד נוסף.',
    registration_enabled: true,
    registration_mode: 'host_pays',
    collect_registration_payment: false,
    registration_page_title: 'פעילות גיבוש בקיר',
    registration_page_body: 'מלאו את פרטי המשתתפים. התשלום מרוכז מול בית הספר.',
    theme: { accent: '#A78BFA' },
    start_time: '14:00',
    end_time: '15:30',
  },
  {
    id: 'tpl_ops_cleaning',
    category: 'ops',
    sort_order: 10,
    name: 'יום ניקיון',
    type: 'other',
    price: 0,
    max_participants: null,
    location: 'בקיר',
    description: 'יום ניקיון ותחזוקה של הקיר והמתקנים.',
    registration_enabled: false,
    collect_registration_payment: false,
    registration_page_title: '',
    registration_page_body: '',
    theme: { accent: '#7DD3FC' },
    start_time: '09:00',
    end_time: '13:00',
  },
  {
    id: 'tpl_ops_team_meeting',
    category: 'ops',
    sort_order: 20,
    name: 'ישיבת צוות',
    type: 'other',
    price: 0,
    max_participants: null,
    location: 'בקיר',
    description: 'ישיבת צוות — עדכונים, תיאום ומשימות.',
    registration_enabled: false,
    collect_registration_payment: false,
    registration_page_title: '',
    registration_page_body: '',
    theme: { accent: '#7DD3FC' },
    start_time: '20:00',
    end_time: '21:30',
  },
  {
    id: 'tpl_ops_route_building',
    category: 'ops',
    sort_order: 30,
    name: 'בניית מסלולים',
    type: 'route_building',
    price: 0,
    max_participants: null,
    location: 'בקיר',
    description: 'החלפת אחיזות ובניית מסלולים חדשים.',
    registration_enabled: false,
    collect_registration_payment: false,
    registration_page_title: '',
    registration_page_body: '',
    theme: { accent: '#A78BFA' },
    start_time: '08:00',
    end_time: '14:00',
  },
  {
    id: 'tpl_ops_opening_hours',
    category: 'ops',
    sort_order: 40,
    name: 'שעות פתיחה',
    type: 'opening_hours',
    price: 0,
    max_participants: null,
    location: 'בקיר',
    description: 'שעות פתיחה לקהל — מופיע באתר ובתשובות הבוט.',
    registration_enabled: false,
    collect_registration_payment: false,
    registration_page_title: '',
    registration_page_body: '',
    theme: { accent: '#22D3EE' },
    start_time: '16:00',
    end_time: '22:00',
  },
];

/**
 * Insert missing starter templates. Never overwrites staff edits.
 * @returns {{ inserted: number, total: number }}
 */
export function ensureSeedActivityTemplates(db) {
  const existing = db.get('activity_templates') || [];
  const byId = new Set(existing.map((t) => String(t.id)));
  let inserted = 0;
  for (const seed of STARTER_ACTIVITY_TEMPLATES) {
    if (byId.has(seed.id)) continue;
    const payload = normalizeTemplatePayload(seed);
    db.insert('activity_templates', { id: seed.id, ...payload });
    inserted += 1;
  }
  return { inserted, total: (db.get('activity_templates') || []).length };
}

export function listActivityTemplates(db, { includeInactive = false } = {}) {
  ensureSeedActivityTemplates(db);
  return (db.get('activity_templates') || [])
    .filter((t) => includeInactive || t.is_active !== false)
    .sort((a, b) => {
      const cat = String(a.category || 'wall').localeCompare(String(b.category || 'wall'));
      if (cat !== 0) return cat;
      const so = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (so !== 0) return so;
      return String(a.name || '').localeCompare(String(b.name || ''), 'he');
    });
}

export function groupTemplatesByCategory(templates) {
  const groups = TEMPLATE_CATEGORIES.map((cat) => ({
    ...cat,
    templates: templates.filter((t) => normalizeTemplateCategory(t.category) === cat.id),
  }));
  return groups;
}

export function resolveRegistrationMode(activity) {
  return activity?.registration_mode || (
    activity?.collect_registration_payment ? 'paid_per_participant' : 'host_pays'
  );
}

export function openUnpaidActivities(db, { fromDate } = {}) {
  const today = fromDate || new Date().toISOString().slice(0, 10);
  return (db.get('activities') || [])
    .filter((a) => {
      if (['cancelled', 'archived'].includes(String(a.status || '').toLowerCase())) return false;
      // כשכל משתתף משלם בנפרד אין דמי הזמנה לגבות מהמזמין, והאירוע יישאר
      // „לא שולם” לנצח — לא חוב פתוח.
      if (resolveRegistrationMode(a) === 'paid_per_participant') return false;
      const pay = normalizeHostPaymentStatus(a.payment_status);
      if (pay === 'paid' || pay === 'refunded') return false;
      if (!a.date) return false;
      return String(a.date) >= today;
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
