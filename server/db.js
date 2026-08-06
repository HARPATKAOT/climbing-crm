import fs from 'fs';
import path from 'path';
import { israelDateStr } from './attendanceUtils.js';
import { supa, CORE_TABLES, OPERATIONAL_TABLES } from './supa.js';
import { enrichStudentsWithGuardians, linkHouseholdGuardians } from './studentGuardians.js';
import {
  enrichStudentsWithGroupIds,
  enrollmentId,
  studentGroupIds,
  activeEnrollmentGroupIds,
} from './studentGroups.js';
import { DEFAULT_BUSINESS_PROFILE } from './businessProfile.js';
import {
  isDailySafetyCheck,
  isDailySafetyOverdue,
  isWallOpenForSafety,
  lastOperatingDayOnOrBefore,
} from './wallOperatingDay.js';

const DB_FILE = path.join(process.cwd(), 'db.json');
const BRAND_NAME = DEFAULT_BUSINESS_PROFILE.display_name;

/** Tables that may exist locally (e.g. after Meta sync) before durable write completes. */
const LOCAL_MIGRATE_IF_REMOTE_EMPTY = new Set(['message_templates', 'saved_replies']);

/**
 * Local mirrors of a durable table. They are rebuilt from their source table on
 * boot, so local-only rows must never be pushed back into the durable store.
 * `whatsapp_logs` mirrors `messages`, which is the source of truth for a conversation.
 */
const LOCAL_MIRROR_TABLES = new Set(['whatsapp_logs']);

/** Normalize Israeli mobile numbers to 972… so 050… and 97250… match. */
export function normalizeParentPhone(phone) {
  let digits = String(phone || '').replace(/[^\d]/g, '');
  if (digits.startsWith('0') && digits.length >= 9) digits = `972${digits.slice(1)}`;
  if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
  return digits;
}

export function parentPhonesMatch(a, b) {
  const na = normalizeParentPhone(a);
  const nb = normalizeParentPhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tailA = na.slice(-9);
  const tailB = nb.slice(-9);
  return tailA.length === 9 && tailA === tailB;
}

export const CHANNEL_PLACEHOLDER_NAMES = ['לקוח וואטסאפ', 'ליד מאינסטגרם', 'לקוח מסנג׳ר', "לקוח מסנג'ר"];

/**
 * A card the channel opened by itself and nobody ever filled in: placeholder name,
 * no email, no children. Such a card must never outrank a real family that owns the
 * same number through one of its trainees.
 */
export function isBlankLeadCard(parent, data) {
  if (!parent) return false;
  if (!CHANNEL_PLACEHOLDER_NAMES.includes(String(parent.name || '').trim())) return false;
  if (String(parent.email || '').trim()) return false;
  return !(data?.students || []).some((s) => s.parentId === parent.id);
}

function scoreParentRecord(p) {
  let score = 0;
  if (p?.email) score += 4;
  if (p?.idNumber) score += 3;
  if (p?.name && p.name !== 'לקוח וואטסאפ' && p.name !== 'ליד מאינסטגרם' && p.name !== 'לקוח מסנג׳ר') {
    score += 3;
  }
  if (p?.last_inbound_whatsapp || p?.last_inbound_instagram || p?.last_inbound_messenger) score += 1;
  if (p?.status && p.status !== 'lead_new') score += 1;
  // Prefer already-normalized 972… cards so we keep one phone format.
  if (String(p?.phone || '').startsWith('972')) score += 1;
  return score;
}

const STUDENT_STATUS_RANK = {
  registered: 50,
  past_registered: 45,
  health_signed: 40,
  pending_signup: 35,
  intro_paid: 30,
  lead_contacted: 20,
  lead_new: 10,
  archived: 0,
};

function scoreStudentRecord(s) {
  let score = STUDENT_STATUS_RANK[s?.status] ?? 5;
  if (s?.groupId) score += 5;
  if (s?.levelGrade) score += 2;
  if (s?.healthSignedAt || s?.waiverSignedAt) score += 3;
  if (s?.notes) score += 1;
  return score;
}

function sameChildName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export function planDurableHydration(table, remoteRows, localRows = []) {
  if (remoteRows === null) return { mode: 'error', rows: localRows };
  // A mirror is rebuilt from its source table — keep the durable copy as-is.
  if (LOCAL_MIRROR_TABLES.has(table)) return { mode: 'remote', rows: remoteRows };
  if (OPERATIONAL_TABLES.includes(table)) {
    const remoteIds = new Set(remoteRows.map((record) => String(record.id ?? record.key)));
    const missingLocal = localRows.filter(
      (record) => !remoteIds.has(String(record.id ?? record.key))
    );
    if (missingLocal.length > 0) {
      return {
        mode: 'migrate',
        rows: [...remoteRows, ...missingLocal],
        toMigrate: missingLocal,
      };
    }
  }
  // Don't wipe Meta-synced templates / saved replies if durable store is briefly empty.
  if (
    LOCAL_MIGRATE_IF_REMOTE_EMPTY.has(table) &&
    remoteRows.length === 0 &&
    localRows.length > 0
  ) {
    return { mode: 'migrate', rows: localRows, toMigrate: localRows };
  }
  return { mode: 'remote', rows: remoteRows };
}

// Fire-and-forget write-through to Supabase for CRM-core collections.
// Reads stay synchronous (served from the local db.json cache); Supabase is the
// durable store that re-seeds db.json on every server start.
function syncUpsert(table, record) {
  if (record && CORE_TABLES.includes(table)) {
    Promise.resolve(supa.upsert(table, record)).catch((e) =>
      console.error(`syncUpsert(${table}) error:`, e?.message || e)
    );
  }
}

/** Await durable write for parent+student in order (avoids FK race on Supabase). */
async function persistLeadPair(parent, student) {
  if (parent) {
    const parentResult = await persistCore('parents', parent);
    if (!parentResult.ok) {
      console.error('persistLeadPair(parent) failed:', parentResult.error);
    }
  }
  if (student) {
    const studentResult = await persistCore('students', student);
    if (!studentResult.ok) {
      console.error('persistLeadPair(student) failed:', studentResult.error);
      return studentResult;
    }
  }
  return { ok: true };
}

/**
 * Attach a newly created child to the rest of their household — the parents a
 * merge already put on the family's other children. Without it the child shows
 * up only on the card that created them.
 */
async function persistHouseholdLinks(student, source = 'household') {
  if (!student?.id) return;
  for (const link of linkHouseholdGuardians(db, { studentId: student.id, source })) {
    const result = await persistCore('student_guardians', link);
    if (!result.ok) console.error('persistHouseholdLinks failed:', result.error);
  }
}

/** Await durable write for CRM-core tables (use on public form submit). */
export async function persistCore(table, record) {
  if (!record || !CORE_TABLES.includes(table)) return { ok: true };
  // The isolated local form environment persists its own db.json copy. It has
  // no Supabase credentials by design, but that file is still durable for the
  // lifetime of the test run. Production must never take this branch.
  if (
    !supa.isEnabled()
    && process.env.NODE_ENV !== 'production'
    && process.env.LOCAL_DURABLE_STORAGE === '1'
  ) {
    return { ok: true, local: true };
  }
  return supa.upsert(table, record);
}

function syncRemove(table, id) {
  if (CORE_TABLES.includes(table)) {
    Promise.resolve(supa.remove(table, id)).catch((e) =>
      console.error(`syncRemove(${table}) error:`, e?.message || e)
    );
  }
}

/**
 * Delete durably before touching the local cache. The durable store is the one
 * that holds the foreign keys, so a row the database refuses to drop must stay
 * in db.json too — otherwise it vanishes from the UI and returns on the next
 * boot hydration.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function removeCore(table, id) {
  if (!CORE_TABLES.includes(table)) return { ok: true };
  const result = await supa.remove(table, id);
  return result && result.ok === false ? result : { ok: true };
}

// Mock data to seed the database if it doesn't exist
const SEED_DATA = {
  parents: [
    { id: 'p1', name: 'מיכל לוי', phone: '0521234567', email: 'michal@gmail.com' },
    { id: 'p2', name: 'דוד כהן', phone: '0549876543', email: 'david@gmail.com' },
    { id: 'p3', name: 'שירה מזרחי', phone: '0505555555', email: 'shira@gmail.com' },
    { id: 'p4', name: 'נמרוד שמר', phone: '0582222333', email: 'nimrod@gmail.com' },
    { id: 'p5', name: 'רחל גולן', phone: '0527890123', email: 'rachel@gmail.com' },
  ],
  students: [
    { id: 's1', name: 'עומרי לוי', parentId: 'p1', groupId: 'g-48775fd8', status: 'lead_new', birthDate: '2017-03-12', notes: '', levelGrade: null, created: '2026-07-08', created_at: '2026-07-08T14:32:00.000Z' },
    { id: 's2', name: 'נועה לוי', parentId: 'p1', groupId: null, status: 'lead_new', birthDate: '2015-07-22', notes: 'אחות של עומרי', levelGrade: null, created: '2026-07-08', created_at: '2026-07-08T11:05:00.000Z' },
    { id: 's3', name: 'רוני כהן', parentId: 'p2', groupId: 'g-993c2022', status: 'health_signed', birthDate: '2014-01-05', notes: '', levelGrade: '5C', created: '2026-07-07', created_at: '2026-07-07T09:18:00.000Z' },
    { id: 's4', name: 'גיל מזרחי', parentId: 'p3', groupId: 'g-53d1483e', status: 'intro_scheduled', birthDate: '2013-11-15', notes: 'ניסיון קודם בטיפוס', levelGrade: null, created: '2026-07-06', created_at: '2026-07-06T16:40:00.000Z' },
    { id: 's5', name: 'עברי שמר', parentId: 'p4', groupId: 'g-cf7a413e', status: 'registered', birthDate: '2012-04-20', notes: 'רשום לחוג בוגרים', levelGrade: '6B', created: '2026-07-05', created_at: '2026-07-05T10:12:00.000Z' },
    { id: 's6', name: 'תמר גולן', parentId: 'p5', groupId: 'g-165dbd26', status: 'registered', birthDate: '2016-09-30', notes: '', levelGrade: '5A', created: '2026-07-01', created_at: '2026-07-01T13:55:00.000Z' },
  ],
  groups: [
    { id: 'g-48775fd8', name: "כיתות ג'-ד' — יום א׳ 15:30", day: 0, time: '15:30', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 360, waParents: '', waClimbers: '' },
    { id: 'g-f0bc07f0', name: "כיתות ה'-ו' — יום א׳ 16:30", day: 0, time: '16:30', duration: 50, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: "ה'-ו'", priceWeek: 260, priceTwice: 360, waParents: 'https://chat.whatsapp.com/Lwm3gC3zrfuIRUVC0VSolp', waClimbers: '' },
    { id: 'g-9b5f1891', name: "ילדים ג'-ד' — יום א׳ 17:30", day: 0, time: '17:30', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 360, waParents: '', waClimbers: '' },
    { id: 'g-cf7a413e', name: 'חטיבה — יום א׳ 18:40', day: 0, time: '18:40', duration: 80, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: 'חטיבה', priceWeek: 305, priceTwice: 420, waParents: 'https://chat.whatsapp.com/DPqRRjNdEwqKEbkEVHlvcG', waClimbers: 'https://chat.whatsapp.com/JwfMVZUnpUIDK1FX0KLz8q' },
    { id: 'g-9dfcc000', name: "בוגרים — יום א׳ 20:10", day: 0, time: '20:10', duration: 80, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: 'בוגרים', priceWeek: 305, priceTwice: 420, waParents: '', waClimbers: '' },
    { id: 'g-165dbd26', name: "הורים וילדים — יום ג׳ 17:10", day: 2, time: '17:10', duration: 50, trainer: '', maxSlots: 9, enrolled: 0, ageCategory: "א'-ב'", priceWeek: 290, priceTwice: 0, waParents: 'https://chat.whatsapp.com/CwafATne3ChDTlNYtZcytV', waClimbers: '' },
    { id: 'g-ea56ee32', name: "הורים וילדים — יום ג׳ 18:10", day: 2, time: '18:10', duration: 50, trainer: '', maxSlots: 9, enrolled: 0, ageCategory: "א'-ב'", priceWeek: 290, priceTwice: 0, waParents: 'https://chat.whatsapp.com/JBrnGLBCLTL9FbIGhLmFz3', waClimbers: '' },
    { id: 'g-993c2022', name: "ילדים ג'-ד' — יום ג׳ 15:00", day: 2, time: '15:00', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 0, waParents: 'https://chat.whatsapp.com/L6FpOJUnoOIGQX9XhFL0Wk', waClimbers: '' },
    { id: 'g-726d5612', name: "ילדים ג'-ד' — יום ג׳ 16:00", day: 2, time: '16:00', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 0, waParents: 'https://chat.whatsapp.com/EJ5rIWENKAA5kxmLYkUAJN', waClimbers: '' },
    { id: 'g-48775fd8-d', name: "כיתות ג'-ד' — יום ד׳ 15:30", day: 3, time: '15:30', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 360, waParents: 'https://chat.whatsapp.com/LdHhvHhE9cSEskgQG7KCBj', waClimbers: '' },
    { id: 'g-53d1483e', name: "כיתות ה'-ו' — יום ד׳ 16:30", day: 3, time: '16:30', duration: 50, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: "ה'-ו'", priceWeek: 260, priceTwice: 360, waParents: 'https://chat.whatsapp.com/E5dtW6roMh6GUyecxyibc0', waClimbers: '' },
    { id: 'g-b2da9ca1', name: "ילדים ג'-ד' — יום ד׳ 17:30", day: 3, time: '17:30', duration: 50, trainer: '', maxSlots: 11, enrolled: 0, ageCategory: "ג'-ד'", priceWeek: 280, priceTwice: 360, waParents: 'https://chat.whatsapp.com/E41RU70lyzJ4xDrvrMlXwW', waClimbers: '' },
    { id: 'g-b5e58aa6', name: "חטיבה — יום ד׳ 18:40", day: 3, time: '18:40', duration: 80, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: 'חטיבה', priceWeek: 305, priceTwice: 420, waParents: 'https://chat.whatsapp.com/DPqRRjNdEwqKEbkEVHlvcG', waClimbers: 'https://chat.whatsapp.com/JwfMVZUnpUIDK1FX0KLz8q' },
    { id: 'g-4012bf2e', name: "בוגרים — יום ד׳ 20:10", day: 3, time: '20:10', duration: 80, trainer: '', maxSlots: 12, enrolled: 0, ageCategory: 'בוגרים', priceWeek: 305, priceTwice: 420, waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr', waClimbers: '' },
    { id: 'g-02d0c7cf', name: "מתקדמים ה'-ו' — ב׳+ה׳ 15:30", day: 4, time: '15:30', duration: 80, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: "ה'-ו'", priceWeek: 0, priceTwice: 420, waParents: 'https://chat.whatsapp.com/KQDVxQC7YPBLvZJOXu5WTr', waClimbers: 'https://chat.whatsapp.com/CbHECN5brUcGiiiLMVulxZ' },
    { id: 'g-c5aece01', name: 'נבחרת צעירה — ב׳+ה׳ 17:00', day: 4, time: '17:00', duration: 110, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: 'חטיבה', priceWeek: 550, priceTwice: 550, waParents: 'https://chat.whatsapp.com/KX1HoM5PYqb2Fz7TH8j1aJ', waClimbers: '' },
    { id: 'g-529e08f6', name: 'נבחרת בוגרת — ב׳+ה׳ 19:10', day: 4, time: '19:10', duration: 110, trainer: '', maxSlots: 13, enrolled: 0, ageCategory: 'תיכון', priceWeek: 0, priceTwice: 550, waParents: 'https://chat.whatsapp.com/HasZy575i5XAtUVLPfOyX4', waClimbers: 'https://chat.whatsapp.com/LGg0ekCjQr10S1PkmA9OcK' },
  ],
  employees: [],
  safety_check_types: [],
  safety_inspections: [],
  safety_incidents: [],
  whatsapp_settings: {
    metaWaPhoneId: '',
    metaWaAccessToken: '',
    metaWaWabaId: '',
    metaWaBusinessId: '',
    connectedPhoneDisplay: '',
    connectedVerifiedName: '',
    coexistenceEnabled: false,
    isOnBizApp: false,
    connectedAt: null,
    lastConnectEvent: null,
    metaIgAccountId: '',
    metaIgAccessToken: '',
    metaPageId: '',
    metaPageAccessToken: '',
    verifyToken: '',
    // Safer default for ephemeral disks: stay silent until explicitly enabled.
    aiResponderEnabled: false,
    aiActiveHoursEnabled: false,
    aiActiveHoursStart: '09:00',
    aiActiveHoursEnd: '21:00',
    // 0=ראשון … 6=שבת (אזור זמן ישראל)
    aiActiveDays: [0, 1, 2, 3, 4, 5, 6],
    aiSystemPrompt: `אתה הבוט של קיר הטיפוס ${BRAND_NAME}. עונה בעברית, קצר וברור. מותר שיחה רגילה ועובדות מהנתונים בלבד. אסור להמציא או לענות על ביטול/החזר/שכר. חסר נתון: HANDOFF ואז משפט טבעי. הודעה חסרת משמעות: UNSURE ואז בקשת הבהרה.`,
    aiOutsideHoursMessage: 'קיבלנו את ההודעה 🙏\nאנחנו מחוץ לשעות המענה כרגע.\nנחזור אליכם בבוקר בין 9:00 ל־21:00.',
    aiHandoffKeywords: 'אדם,נציג,תלונה,מנהל,דחוף,לדבר עם,ביטול,לבטל,החזר,זיכוי,חשבונית,פציעה,נפצע,כאב',
    aiHandoffAckMessage: `מעבירים אתכם לצוות ${BRAND_NAME} 🧗\nמישהו יחזור אליכם בהקדם.`,
    aiStopKeywords: 'עצור,הסר,stop,unsubscribe,הסר אותי',
    aiOptOutMessage: 'הוסרתם מרשימת המענה האוטומטי.\nאם תרצו לחזור — כתבו «הפעל בוט».',
    aiPauseOnHumanReply: true,
    aiPauseMinutesAfterHuman: 120,
    aiAudienceMode: 'all',
    aiHistoryCount: 8,
    aiMaxReplyChars: 700,
    aiReplyDelayMs: 800,
    aiRateLimitPerHour: 20,
    // These seed values win over DEFAULT_BOT_SETTINGS (getSettings spreads the
    // seed first), so they must stay in step with whatsappBot.js.
    aiKnowledgeBase: 'שאלות נפוצות:\n- חניה: יש חניה בחזית הקיר.\n- גיל מינימום לחוג ילדים: לפי כיתה בקבוצות במערכת.\n- ציוד: נעלי טיפוס להשכרה במקום, חולצת חוג ושק מגנזיום.\n- שעות פתיחה: רק לפי מה שמסומן ביומן כ«שעות פתיחה».\n- אירועים וטיולים: רק אירועים שסומנו לפרסום, כולל קישור הרשמה.\n- ביטול אימון: לעדכן את הצוות מראש בוואטסאפ.',
    aiForbiddenTopics: 'אל תיתן ייעוץ רפואי — הצהרת בריאות היא טופס, לא אישור רפואי.\nאל תשתף פרטים של לקוחות אחרים.\nאל תבטיח הנחות, פטורים או החזרים.\nאל תמציא מחיר שלא מופיע בקבוצה או בהגדרות הציוד.\nאל תמציא שעות פתיחה שלא מופיעות ביומן.\nאל תמציא קבוצות או אירועים שלא במערכת.\nאל תפרסם אירוע פרטי (יום הולדת) גם אם יש לו קישור הרשמה.\nביטול, החזר כספי, שינוי תשלום, חשבונית, תלונה, פציעה או שכר — העבר לצוות.',
    aiBusinessFacts: 'כתובת: השקד 1, תל מונד\nחניה: יש חניה בחזית הקיר\nשעות פתיחה: לפי הרשומות שמסומנות «שעות פתיחה» ביומן המערכת\nדמי העשרה: 110 ₪\nהצהרת בריאות: https://app.kirboaz.co.il/health',
    aiReactivateKeywords: 'הפעל בוט,הפעל,activate',
  },
  whatsapp_logs: [],
  broadcast_campaigns: [],
  // Two lists, because there are only two kinds of message: one the customer
  // must get in order to be served, and one they may choose to get. Four
  // topic-shaped lists asked a parent to sort our content for us, and the law
  // draws its line here too — an operational notice is not an advertisement.
  broadcast_list_defs: [
    { key: 'operational', label: 'תפעולי', description: 'שינויי שעות, ביטולים, תזכורות, מידע קריטי לפעילות שנרשמת אליה', color: 'var(--green)', sortOrder: 0 },
    { key: 'marketing', label: 'שיווקי', description: 'טיולים חדשים, טיפים, מבצעים, עדכונים כלליים', color: 'var(--amber)', sortOrder: 1 },
  ],
};

const DEFAULT_BROADCAST_LIST_DEFS = SEED_DATA.broadcast_list_defs;

const DEFAULT_SAFETY_CHECK_TYPES = [
  { id: 'sct-ropes-autobelay', name: 'בדיקת חבלים וטרובלואים', frequency: 'יומי', interval_days: 1, description: 'בדיקה יומית של חבלים ומכשירי אבטחה אוטומטיים לפני תחילת משמרת', active: true, sort_order: 1 },
  { id: 'sct-lead-ropes', name: 'בדיקת חבלי הובלה', frequency: 'דו שבועי', interval_days: 14, description: 'בדיקת בלאי, קצוות וסימונים בחבלי הובלה', active: true, sort_order: 2 },
  { id: 'sct-harnesses', name: 'בדיקת רתמות', frequency: 'דו חודשי', interval_days: 60, description: 'בדיקת תפרים, אבזמים ובלאי של כל רתמות הקיר', active: true, sort_order: 3 },
  { id: 'sct-bolts', name: 'בדיקת בולטים', frequency: 'דו חודשי', interval_days: 60, description: 'בדיקת בולטים וראנרים במסלולים', active: true, sort_order: 4 },
  { id: 'sct-toprope-anchors', name: 'בדיקת עוגני טופ רופ ורד בלוקים', frequency: 'דו חודשי', interval_days: 60, description: 'בדיקת טבעות עליונות, שאקלים וחיבורי רד בלוק', active: true, sort_order: 5 },
  { id: 'sct-autobelay-annual', name: 'בדיקת טרובלואים תקופתית', frequency: 'שנתי', interval_days: 365, description: 'בדיקה תקופתית מקיפה למכשירי האבטחה האוטומטיים', active: true, sort_order: 6 },
];

const FREQ_INTERVAL_DAYS = {
  יומי: 1,
  שבועי: 7,
  'דו שבועי': 14,
  חודשי: 30,
  'דו חודשי': 60,
  'חצי שנתי': 182,
  שנתי: 365,
};

function addDaysToDateStr(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + Number(days || 0));
  return israelDateStr(d);
}

function daysBetweenDateStr(fromStr, toStr) {
  if (!fromStr) return Infinity;
  const from = new Date(`${fromStr}T12:00:00`);
  const to = new Date(`${toStr}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return Infinity;
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

function withoutServerSecrets(settings = {}) {
  const {
    metaWaAccessToken: _metaWaAccessToken,
    metaIgAccessToken: _metaIgAccessToken,
    metaPageAccessToken: _metaPageAccessToken,
    verifyToken: _verifyToken,
    ...safe
  } = settings;
  return safe;
}

// In-memory cache of db.json. The file is parsed once per process; every read
// is served from memory, and writes update memory immediately while the disk
// flush is debounced. Supabase remains the durable store — db.json is only a
// local cache, so losing a few hundred ms of it on a crash is acceptable.
let dbCache = null;
let flushTimer = null;
let flushIsLazy = false;
const FLUSH_DELAY_MS = 300;
// Refreshing a table from the durable store changes nothing that needs saving —
// db.json is only a warm-start cache, and boot re-hydrates it from Supabase
// anyway. Writing 10 MB of JSON on every list read froze the whole server for
// ~50 ms at a time, so those refreshes flush on a slow timer instead.
const LAZY_FLUSH_DELAY_MS = 60_000;

function loadDbFromDisk() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(SEED_DATA, null, 2), 'utf-8');
      return JSON.parse(JSON.stringify(SEED_DATA));
    }
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error reading local JSON database:', error);
    return JSON.parse(JSON.stringify(SEED_DATA));
  }
}

function readDb() {
  if (dbCache === null) dbCache = loadDbFromDisk();
  return dbCache;
}

function flushDbToDisk() {
  if (dbCache === null) return;
  try {
    // No indentation: this file is a machine cache, and pretty-printing it cost
    // both extra CPU per flush and ~30% more bytes on disk.
    const payload = JSON.stringify(dbCache);
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, payload, 'utf-8');
    try {
      fs.renameSync(tmpFile, DB_FILE);
    } catch (renameErr) {
      // Windows can fail rename when the target is briefly locked — fall back.
      fs.writeFileSync(DB_FILE, payload, 'utf-8');
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }
  } catch (error) {
    console.error('Error writing local JSON database:', error);
  }
}

// When something was last changed here rather than read from the durable
// store. A background refresh that started before this must not be written
// into the cache: its response predates the local change, so applying it would
// make a just-saved record disappear until the next refresh.
let lastLocalWriteAt = 0;

function writeDb(data, { lazy = false } = {}) {
  dbCache = data;
  if (!lazy) lastLocalWriteAt = Date.now();
  // A real write must not be held back by a lazy flush that is already pending.
  if (flushTimer && !(flushIsLazy && !lazy)) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushIsLazy = lazy;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushDbToDisk();
  }, lazy ? LAZY_FLUSH_DELAY_MS : FLUSH_DELAY_MS);
  // A lazy flush must never keep the process alive on its own.
  if (lazy && typeof flushTimer?.unref === 'function') flushTimer.unref();
}

// Persist any pending in-memory changes before the process exits.
process.on('exit', () => {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
    flushDbToDisk();
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => process.exit(0));
}

function mergeWhatsappSettings(local = {}, remote = null) {
  const merged = {
    ...SEED_DATA.whatsapp_settings,
    ...withoutServerSecrets(local),
  };
  if (remote && typeof remote === 'object') {
    Object.assign(merged, withoutServerSecrets(remote));
  }
  return merged;
}

function normalizeBoolFlag(value) {
  if (value === true || value === false) return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return null;
}

let botFlagCache = { value: null, fetchedAt: 0 };
const BOT_FLAG_TTL_MS = 2000;
/** Dedicated durable key — survives stale full-blob writes of whatsapp_settings. */
const BOT_FLAG_SETTING_KEY = 'ai_responder_enabled';

function patchLocalBotFlag(enabled) {
  const data = readDb();
  if (!data.whatsapp_settings) {
    data.whatsapp_settings = { ...SEED_DATA.whatsapp_settings };
  }
  data.whatsapp_settings.aiResponderEnabled = enabled;
  writeDb(data);
  botFlagCache = { value: enabled, fetchedAt: Date.now() };
}

function resolvePinnedBotFlag(explicitValue) {
  if (explicitValue !== null) return explicitValue;
  if (botFlagCache.value !== null) return botFlagCache.value;
  const local = normalizeBoolFlag(readDb().whatsapp_settings?.aiResponderEnabled);
  return local === null ? false : local;
}

async function persistBotFlagRemote(enabled, whatsappSettings) {
  if (!supa.isEnabled()) return { ok: true };
  const [flagResult, settingsResult] = await Promise.all([
    supa.setAppSetting(BOT_FLAG_SETTING_KEY, !!enabled),
    supa.setAppSetting('whatsapp_settings', withoutServerSecrets(whatsappSettings || readDb().whatsapp_settings || {})),
  ]);
  if (!flagResult?.ok) return flagResult;
  if (!settingsResult?.ok) return settingsResult;
  return { ok: true };
}

/** Pull aiResponderEnabled from Supabase before handling live bot traffic. */
export async function syncBotFlagFromRemote() {
  if (!supa.isEnabled()) return;
  if (botFlagCache.value !== null && Date.now() - botFlagCache.fetchedAt < BOT_FLAG_TTL_MS) {
    return;
  }
  // Prefer the dedicated flag so a stale whatsapp_settings blob cannot re-enable the bot.
  let enabled = normalizeBoolFlag(await supa.getAppSetting(BOT_FLAG_SETTING_KEY));
  if (enabled === null) {
    const remote = await supa.getAppSetting('whatsapp_settings');
    if (!remote || typeof remote !== 'object') {
      // Do not bump fetchedAt — retry on the next inbound message.
      return;
    }
    enabled = normalizeBoolFlag(remote.aiResponderEnabled);
  }
  if (enabled === null) return;
  botFlagCache.fetchedAt = Date.now();
  botFlagCache.value = enabled;
  const localEnabled = normalizeBoolFlag(readDb().whatsapp_settings?.aiResponderEnabled);
  if (localEnabled !== enabled) {
    patchLocalBotFlag(enabled);
    console.log(`🤖 Bot flag synced from Supabase: ${enabled ? 'ON' : 'OFF'}`);
  }
}

/** Turn the master bot switch on/off and wait for durable persistence. */
export async function setBotEnabledDurable(enabled) {
  const flag = !!enabled;
  patchLocalBotFlag(flag);
  const settings = readDb().whatsapp_settings;
  const result = await persistBotFlagRemote(flag, settings);
  if (!result?.ok && supa.isEnabled()) {
    console.error('Failed to persist bot flag:', result?.error || 'unknown');
  }
  return db.getSettings();
}

export function botFlagLabel() {
  const settings = readDb().whatsapp_settings || SEED_DATA.whatsapp_settings;
  const enabled = botFlagCache.value !== null
    ? botFlagCache.value
    : normalizeBoolFlag(settings.aiResponderEnabled);
  return enabled ? 'ON' : 'OFF';
}

/** How many tables boot hydration pulls from the durable store at once. */
const HYDRATION_CONCURRENCY = 8;

/** Run `worker` over `items`, at most `limit` at a time, preserving order. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// Called once on server startup: pulls the authoritative CRM-core collections
// from Supabase into the local db.json so the ephemeral Render disk always
// reflects the durable store. Non-core collections are left untouched.
export async function initDb({ requireDurable = false } = {}) {
  if (!supa.isEnabled()) {
    if (requireDurable) {
      throw new Error('Durable Supabase store is required but no valid service-role key is configured');
    }
    console.warn('⚠️ Supabase disabled — CRM data will not persist across restarts.');
    return;
  }
  try {
    const data = readDb();
    const counts = {};
    // Fetch the tables together rather than one after another. Done serially
    // this took ~43s, during which the API answers nothing — and PM2's watcher
    // restarts the server on every code change, so that wait was paid all day.
    // Capped so we never open 72 connections at once.
    const fetched = await mapWithConcurrency(
      CORE_TABLES,
      HYDRATION_CONCURRENCY,
      async (table) => [table, await supa.getAll(table)]
    );
    const rowsByTable = new Map(fetched);
    for (const table of CORE_TABLES) {
      const rows = rowsByTable.get(table);
      if (rows !== null && rows !== undefined) {
        const localRows = Array.isArray(data[table]) ? data[table] : [];
        const hydration = planDurableHydration(table, rows, localRows);
        if (hydration.mode === 'migrate') {
          for (const record of hydration.toMigrate) await supa.upsert(table, record);
          data[table] = hydration.rows;
          counts[table] = `migrated:${hydration.toMigrate.length}`;
        } else {
          data[table] = hydration.rows;
          counts[table] = hydration.rows.length;
        }
      } else {
        counts[table] = 'error';
        if (requireDurable) {
          throw new Error(`Durable store hydration failed for ${table}`);
        }
      }
    }
    const remoteBotFlag = normalizeBoolFlag(await supa.getAppSetting(BOT_FLAG_SETTING_KEY));
    const remoteSettings = await supa.getAppSetting('whatsapp_settings');
    if (remoteSettings && typeof remoteSettings === 'object') {
      data.whatsapp_settings = {
        ...mergeWhatsappSettings(data.whatsapp_settings, remoteSettings),
        metaWaAccessToken: '',
        verifyToken: '',
      };
      const fromSettings = normalizeBoolFlag(data.whatsapp_settings.aiResponderEnabled);
      const enabled = remoteBotFlag !== null ? remoteBotFlag : (fromSettings === null ? false : fromSettings);
      data.whatsapp_settings.aiResponderEnabled = enabled;
      botFlagCache = { value: enabled, fetchedAt: Date.now() };
      if (remoteBotFlag === null) {
        await supa.setAppSetting(BOT_FLAG_SETTING_KEY, enabled);
      }
      counts.app_settings = 'remote';
    } else if (data.whatsapp_settings) {
      // Never migrate a missing remote into "ON" from an ephemeral seed disk.
      const enabled = remoteBotFlag !== null
        ? remoteBotFlag
        : (normalizeBoolFlag(data.whatsapp_settings.aiResponderEnabled) ?? false);
      data.whatsapp_settings.aiResponderEnabled = enabled;
      botFlagCache = { value: enabled, fetchedAt: Date.now() };
      await persistBotFlagRemote(enabled, data.whatsapp_settings);
      counts.app_settings = 'migrated';
    }
    writeDb(data);
    // Heal historical 050… / 972… duplicate parent cards after hydration.
    try {
      const mergeResult = db.mergeAllDuplicateParentsByPhone();
      if (mergeResult.absorbedCount > 0) {
        console.log(
          `🔗 Parent phone de-dupe: merged ${mergeResult.absorbedCount} card(s) in ${mergeResult.mergedGroups} group(s)`
        );
      }
    } catch (mergeErr) {
      console.error('Parent phone de-dupe failed:', mergeErr.message);
    }
    // A trainee imported after a blank lead card grabbed their number: fold the card in,
    // so the family — not an empty lead — owns the conversation from the next boot on.
    try {
      const traineeHeal = db.mergeBlankLeadCardsIntoTraineeFamilies();
      if (traineeHeal.count > 0) {
        console.log(`🔗 Blank lead cards folded into trainee families: ${traineeHeal.count}`);
        for (const row of traineeHeal.merged) {
          console.log(`   ${row.student} → ${row.family}`);
        }
      }
    } catch (healErr) {
      console.error('Trainee lead-card heal failed:', healErr.message);
    }
    try {
      const phoneBackfill = db.backfillStudentPhonesFromNotes();
      if (phoneBackfill.updated > 0) {
        console.log(`📞 Student phone backfill from notes: ${phoneBackfill.updated} row(s)`);
      }
    } catch (phoneErr) {
      console.error('Student phone backfill failed:', phoneErr.message);
    }
    try {
      const notesHeal = db.stripChannelMessageDumpsFromNotes();
      if (notesHeal.updated > 0) {
        console.log(`🧹 Stripped channel message dumps from notes: ${notesHeal.updated} row(s)`);
      }
    } catch (notesErr) {
      console.error('Notes channel-dump heal failed:', notesErr.message);
    }
    try {
      const enrollBackfill = db.backfillEnrollmentsFromGroupId();
      if (enrollBackfill.created > 0) {
        console.log(`📚 Enrollment backfill from group_id: ${enrollBackfill.created} row(s)`);
      }
    } catch (enrollErr) {
      console.error('Enrollment backfill failed:', enrollErr.message);
    }
    console.log(`🤖 Bot auto-reply after initDb: ${botFlagLabel()}`);
    console.log(
      `✅ Loaded CRM-core from Supabase:`,
      Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(', ')
    );
  } catch (error) {
    if (requireDurable) throw error;
    console.error('initDb() failed — falling back to local db.json:', error.message);
  }
}

/**
 * Move children + related rows from duplicate parent cards onto `canonical`,
 * then remove the duplicate parent records (local + durable).
 * Mutates `data` in place. Returns absorbed parent ids.
 */
function absorbDuplicateParentsInto(data, canonical, duplicates) {
  if (!canonical || !duplicates?.length) return [];
  const absorbedIds = [];
  const touchedStudents = [];
  const touchedDecls = [];

  for (const dup of duplicates) {
    if (!dup?.id || dup.id === canonical.id) continue;

    if (dup.email && !canonical.email) canonical.email = dup.email;
    if (dup.city && !canonical.city) canonical.city = dup.city;
    if (dup.lastName && !canonical.lastName) canonical.lastName = dup.lastName;
    if (dup.idNumber && !canonical.idNumber) canonical.idNumber = dup.idNumber;
    if (dup.icount_client_id && !canonical.icount_client_id) {
      canonical.icount_client_id = dup.icount_client_id;
    }
    if (
      dup.name
      && dup.name !== 'לקוח וואטסאפ'
      && dup.name !== 'ליד מאינסטגרם'
      && (canonical.name === 'לקוח וואטסאפ' || canonical.name === 'ליד מאינסטגרם' || !canonical.name)
    ) {
      canonical.name = dup.name;
    }
    if (dup.notes) {
      canonical.notes = canonical.notes
        ? `${canonical.notes}\n---\n${dup.notes}`
        : dup.notes;
    }
    if (dup.last_inbound_whatsapp) {
      const cur = canonical.last_inbound_whatsapp || '';
      if (!cur || String(dup.last_inbound_whatsapp) > String(cur)) {
        canonical.last_inbound_whatsapp = dup.last_inbound_whatsapp;
      }
    }

    const dupStudents = (data.students || []).filter((s) => s.parentId === dup.id);
    for (const st of dupStudents) {
      const sameOnCanonical = (data.students || []).find(
        (s) => s.parentId === canonical.id && s.id !== st.id && sameChildName(s.name, st.name)
      );

      if (sameOnCanonical) {
        const keep =
          scoreStudentRecord(sameOnCanonical) >= scoreStudentRecord(st) ? sameOnCanonical : st;
        const drop = keep.id === sameOnCanonical.id ? st : sameOnCanonical;
        keep.parentId = canonical.id;
        if (!keep.groupId && drop.groupId) keep.groupId = drop.groupId;
        if (!keep.levelGrade && drop.levelGrade) keep.levelGrade = drop.levelGrade;
        if (!keep.birthDate && drop.birthDate) keep.birthDate = drop.birthDate;
        if (!keep.healthSignedAt && drop.healthSignedAt) keep.healthSignedAt = drop.healthSignedAt;
        if (!keep.waiverSignedAt && drop.waiverSignedAt) keep.waiverSignedAt = drop.waiverSignedAt;
        if ((STUDENT_STATUS_RANK[drop.status] ?? 0) > (STUDENT_STATUS_RANK[keep.status] ?? 0)) {
          keep.status = drop.status;
        }
        if (drop.notes) {
          keep.notes = keep.notes ? `${keep.notes}\n${drop.notes}` : drop.notes;
        }

        for (const decl of data.health_declarations || []) {
          if (decl.studentId === drop.id) {
            decl.studentId = keep.id;
            touchedDecls.push(decl);
            syncUpsert('health_declarations', decl);
          }
          if (decl.parentId === dup.id) {
            decl.parentId = canonical.id;
            touchedDecls.push(decl);
            syncUpsert('health_declarations', decl);
          }
        }
        for (const doc of data.client_documents || []) {
          if (doc.student_id === drop.id || doc.studentId === drop.id) {
            if (doc.student_id !== undefined) doc.student_id = keep.id;
            if (doc.studentId !== undefined) doc.studentId = keep.id;
            syncUpsert('client_documents', doc);
          }
          if (doc.parent_id === dup.id || doc.parentId === dup.id) {
            if (doc.parent_id !== undefined) doc.parent_id = canonical.id;
            if (doc.parentId !== undefined) doc.parentId = canonical.id;
            syncUpsert('client_documents', doc);
          }
        }
        for (const pay of data.payments || []) {
          if (pay.student_id === drop.id) {
            pay.student_id = keep.id;
            syncUpsert('payments', pay);
          }
        }

        data.students = data.students.filter((s) => s.id !== drop.id);
        syncRemove('students', drop.id);
        touchedStudents.push(keep);
        syncUpsert('students', keep);
      } else {
        st.parentId = canonical.id;
        touchedStudents.push(st);
        syncUpsert('students', st);
      }
    }

    for (const decl of data.health_declarations || []) {
      if (decl.parentId === dup.id) {
        decl.parentId = canonical.id;
        touchedDecls.push(decl);
        syncUpsert('health_declarations', decl);
      }
    }
    for (const pay of data.payments || []) {
      if (pay.parent_id === dup.id) {
        pay.parent_id = canonical.id;
        syncUpsert('payments', pay);
      }
    }
    for (const msg of data.messages || []) {
      if (msg.parent_id === dup.id) {
        msg.parent_id = canonical.id;
        syncUpsert('messages', msg);
      }
    }
    for (const doc of data.client_documents || []) {
      if (doc.parent_id === dup.id || doc.parentId === dup.id) {
        if (doc.parent_id !== undefined) doc.parent_id = canonical.id;
        if (doc.parentId !== undefined) doc.parentId = canonical.id;
        syncUpsert('client_documents', doc);
      }
    }
    if (Array.isArray(data.broadcast_lists)) {
      for (const row of data.broadcast_lists) {
        if (row.parent_id === dup.id || row.parentId === dup.id) {
          if (row.parent_id !== undefined) row.parent_id = canonical.id;
          if (row.parentId !== undefined) row.parentId = canonical.id;
          syncUpsert('broadcast_lists', row);
        }
      }
    }

    data.parents = (data.parents || []).filter((p) => p.id !== dup.id);
    absorbedIds.push(dup.id);
  }

  // Durable write order matters: reassign children before deleting duplicate parents
  // (Supabase FK is ON DELETE CASCADE on students.parent_id).
  if (absorbedIds.length) {
    Promise.resolve()
      .then(async () => {
        for (const s of touchedStudents) await persistCore('students', s);
        for (const decl of touchedDecls) await persistCore('health_declarations', decl);
        await persistCore('parents', canonical);
        for (const id of absorbedIds) {
          try {
            await supa.remove('parents', id);
          } catch (e) {
            console.error(`merge remove parent ${id} failed:`, e?.message || e);
          }
        }
      })
      .catch((e) => console.error('parent merge durable write failed:', e?.message || e));
  }

  return absorbedIds;
}

const CLIMBING_LEVELS = [
  '5A', '5B', '5C',
  '6A', '6B', '6C',
  '7A', '7B', '7C',
  '8A', '8B', '8C',
];

function climbingLevelRank(level) {
  const i = CLIMBING_LEVELS.indexOf(level);
  return i === -1 ? -1 : i;
}

function normalizeLevelTestFields(test, data) {
  let testType = test.test_type || 'level';
  if (testType === 'top_rope') testType = 'top-rope';
  // Legacy LevelTests page sent route_type without test_type
  if (!test.test_type && test.route_type) testType = 'level';

  const isLevelTest = testType === 'level' || testType === 'top-rope';
  const routeStyleRaw = test.route_style || test.route_type || 'top-rope';
  const routeStyle = isLevelTest
    ? (routeStyleRaw === 'top_rope' ? 'top-rope' : routeStyleRaw)
    : null;

  const level = isLevelTest ? (test.level || test.grade || '5A') : null;
  const passed = test.passed ?? (test.status ? test.status === 'passed' : true);
  const studentId = test.studentId || test.climber_id || null;

  let studentName = test.studentName || null;
  if (!studentName && studentId) {
    studentName = data.students?.find((s) => s.id === studentId)?.name || null;
  }

  const ceremony = test.attended_ceremony ?? test.ceremony ?? false;

  return {
    studentId,
    studentName: studentName || 'מתאמן',
    climber_id: studentId,
    grade: level,
    level,
    test_type: testType === 'top-rope' ? 'level' : testType,
    route_style: routeStyle,
    route_type: routeStyle,
    examiner: test.examiner ?? null,
    examinerId: test.examinerId ?? null,
    date: test.date || new Date().toISOString().split('T')[0],
    notes: test.notes || '',
    passed,
    status: test.status || (passed ? 'passed' : 'failed'),
    attended_ceremony: ceremony,
    ceremony,
  };
}

/** Highest passed level-test grade for a student → students.levelGrade */
function syncStudentLevelGrade(data, studentId) {
  if (!studentId) return;
  const studentIndex = (data.students || []).findIndex((s) => s.id === studentId);
  if (studentIndex === -1) return;

  let best = null;
  let bestRank = -1;
  for (const t of data.level_tests || []) {
    if (t.studentId !== studentId && t.climber_id !== studentId) continue;
    if (!t.passed && t.status !== 'passed') continue;
    const type = t.test_type || 'level';
    if (type !== 'level' && type !== 'top-rope' && type !== 'top_rope') continue;
    const grade = t.level || t.grade;
    const rank = climbingLevelRank(grade);
    if (rank > bestRank) {
      bestRank = rank;
      best = grade;
    }
  }

  if (data.students[studentIndex].levelGrade !== best) {
    data.students[studentIndex].levelGrade = best;
    syncUpsert('students', data.students[studentIndex]);
  }
}

export const db = {
  get: (table) => {
    const data = readDb();
    return data[table] || [];
  },

  set: (table, value) => {
    const data = readDb();
    data[table] = value;
    writeDb(data);
  },

  /**
   * Replace a table with rows that just came *from* the durable store.
   * Nothing needs saving, so the disk flush is deferred rather than triggered
   * on every read. Use `set` whenever the rows originated here.
   *
   * `since` is when the durable read was issued. If anything was written here
   * after that, the response is older than the cache and is dropped.
   * @returns {boolean} whether the rows were applied
   */
  hydrate: (table, value, since = Date.now()) => {
    if (!Array.isArray(value)) return false;
    if (lastLocalWriteAt >= since) return false;
    const data = readDb();
    data[table] = value;
    writeDb(data, { lazy: true });
    return true;
  },


  getOne: (table, id) => {
    const list = db.get(table);
    return list.find(item => item.id === id);
  },

  getSettings: () => {
    const data = readDb();
    const settings = data.whatsapp_settings || SEED_DATA.whatsapp_settings;
    const aiResponderEnabled = botFlagCache.value !== null
      ? botFlagCache.value
      : (normalizeBoolFlag(settings.aiResponderEnabled) ?? false);
    return {
      ...SEED_DATA.whatsapp_settings,
      ...settings,
      aiResponderEnabled,
      metaWaPhoneId: process.env.META_WA_PHONE_NUMBER_ID || settings.metaWaPhoneId || '',
      metaWaWabaId: process.env.META_WA_WABA_ID || settings.metaWaWabaId || '',
      metaWaAccessToken: process.env.META_WA_ACCESS_TOKEN || '',
      metaIgAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN || settings.metaIgAccessToken || '',
      metaPageId: process.env.META_PAGE_ID || settings.metaPageId || '',
      metaPageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || settings.metaPageAccessToken || '',
      verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || '',
    };
  },

  saveSettings: (newSettings) => {
    const data = readDb();
    const explicitFlag = newSettings?.aiResponderEnabled !== undefined
      ? normalizeBoolFlag(newSettings.aiResponderEnabled)
      : null;
    const pinnedFlag = resolvePinnedBotFlag(explicitFlag);
    data.whatsapp_settings = {
      ...withoutServerSecrets(data.whatsapp_settings),
      ...withoutServerSecrets(newSettings),
      metaWaAccessToken: '',
      verifyToken: '',
      // Pin master switch so a stale full-settings save cannot re-enable the bot.
      aiResponderEnabled: pinnedFlag,
    };
    botFlagCache = { value: pinnedFlag, fetchedAt: Date.now() };
    writeDb(data);
    Promise.resolve(persistBotFlagRemote(pinnedFlag, data.whatsapp_settings)).catch((error) =>
      console.error('sync whatsapp_settings error:', error?.message || error)
    );
    return data.whatsapp_settings;
  },

  insert: (table, record) => {
    const data = readDb();
    if (!data[table]) data[table] = [];
    // Spread first, then force id — otherwise `id: undefined` in record wipes the generated id.
    const newRecord = {
      ...record,
      id: record.id || `${table.slice(0, 2)}${Date.now()}`,
      created_at: record.created_at || new Date().toISOString(),
    };
    data[table].push(newRecord);
    writeDb(data);
    syncUpsert(table, newRecord);
    return newRecord;
  },

  /**
   * Append an audit event durably before exposing it in the local cache.
   * There is deliberately no matching update/delete API for this collection.
   */
  appendOnly: async (table, record) => {
    const newRecord = {
      ...record,
      id: record.id || `${table.slice(0, 2)}${Date.now()}`,
      created_at: record.created_at || new Date().toISOString(),
    };
    if (supa.isEnabled()) {
      const durable = await supa.insertOnly(table, newRecord);
      if (!durable?.ok) return durable || { ok: false, error: `שמירת ${table} נכשלה` };
    }
    const data = readDb();
    if (!data[table]) data[table] = [];
    if (data[table].some((row) => String(row.id) === String(newRecord.id))) {
      return { ok: false, error: `Duplicate append-only id for ${table}` };
    }
    data[table].push(newRecord);
    writeDb(data);
    return { ok: true, record: newRecord };
  },

  /** Merge remote records into the in-memory cache by id (no re-upload). */
  mergeLocal: (table, records = []) => {
    if (!records.length) return 0;
    const data = readDb();
    if (!data[table]) data[table] = [];
    const byId = new Map(data[table].map((row) => [String(row.id ?? row.key), row]));
    let added = 0;
    for (const record of records) {
      const id = record?.id ?? record?.key;
      if (id === undefined || id === null) continue;
      const key = String(id);
      if (byId.has(key)) continue;
      byId.set(key, record);
      data[table].push(record);
      added += 1;
    }
    if (added) writeDb(data);
    return added;
  },

  update: (table, id, updates) => {
    const data = readDb();
    if (!data[table]) return null;
    const index = data[table].findIndex(item => item.id === id);
    if (index === -1) return null;
    data[table][index] = { ...data[table][index], ...updates, updated_at: new Date().toISOString() };
    writeDb(data);
    syncUpsert(table, data[table][index]);
    return data[table][index];
  },

  delete: (table, id) => {
    const data = readDb();
    if (!data[table]) return false;
    const index = data[table].findIndex(item => item.id === id);
    if (index === -1) return false;
    data[table].splice(index, 1);
    writeDb(data);
    syncRemove(table, id);
    return true;
  },

  /** Delete that only reports success once the durable store agreed. */
  deleteDurable: async (table, id) => {
    if (!(readDb()[table] || []).some((item) => item.id === id)) {
      return { ok: false, notFound: true };
    }
    const durable = await removeCore(table, id);
    if (!durable.ok) return durable;
    const data = readDb();
    const index = (data[table] || []).findIndex((item) => item.id === id);
    if (index !== -1) {
      data[table].splice(index, 1);
      writeDb(data);
    }
    return { ok: true };
  },

  upsertParentByPhone: (name, phone, email, extras = {}) => {
    const data = readDb();
    const cleanPhone = normalizeParentPhone(phone);
    if (!cleanPhone && !phone) {
      // No phone — cannot de-dupe; create a thin card.
      const parent = {
        id: `p${Date.now()}`,
        name: name || 'לקוח וואטסאפ',
        lastName: extras.lastName || '',
        idNumber: extras.idNumber || '',
        phone: '',
        email: email || '',
        city: extras.city || '',
        source: extras.source || 'unknown',
        channel: extras.channel || extras.source || undefined,
        notes: extras.notes || '',
        status: extras.status || 'lead_new',
        nextFollowup: extras.nextFollowup || null,
      };
      data.parents.push(parent);
      writeDb(data);
      syncUpsert('parents', parent);
      return parent;
    }

    const matches = (data.parents || []).filter((p) => parentPhonesMatch(p.phone, cleanPhone || phone));
    let parent = matches.length
      ? [...matches].sort((a, b) => scoreParentRecord(b) - scoreParentRecord(a))[0]
      : null;

    // Auto-merge leftover duplicates (050… vs 972…) into the canonical card.
    if (parent && matches.length > 1) {
      const absorbed = absorbDuplicateParentsInto(data, parent, matches.filter((p) => p.id !== parent.id));
      if (absorbed.length) {
        console.log(
          `🔗 Merged ${absorbed.length} duplicate parent card(s) into ${parent.id} (phone ${cleanPhone})`
        );
      }
    }

    if (parent) {
      if (email && !parent.email) parent.email = email;
      if (name && (parent.name === 'לקוח וואטסאפ' || parent.name === 'ליד מאינסטגרם' || !parent.name)) {
        parent.name = name;
      }
      if (extras.city && !parent.city) parent.city = extras.city;
      if (extras.lastName) parent.lastName = extras.lastName;
      if (extras.idNumber) parent.idNumber = extras.idNumber;
      if (extras.source && (!parent.source || parent.source === 'unknown')) parent.source = extras.source;
      if (extras.channel && !parent.channel) parent.channel = extras.channel;
      if (extras.status) parent.status = extras.status;
      if (extras.nextFollowup !== undefined) parent.nextFollowup = extras.nextFollowup || null;
      if (extras.notes) parent.notes = (parent.notes ? `${parent.notes}\n` : '') + extras.notes;
      // Always store one canonical phone format.
      if (cleanPhone) parent.phone = cleanPhone;
      writeDb(data);
    } else {
      parent = {
        id: `p${Date.now()}`,
        name: name || 'לקוח וואטסאפ',
        lastName: extras.lastName || '',
        idNumber: extras.idNumber || '',
        phone: cleanPhone || phone || '',
        email: email || '',
        city: extras.city || '',
        source: extras.source || 'unknown',
        channel: extras.channel || extras.source || undefined,
        notes: extras.notes || '',
        status: extras.status || 'lead_new',
        nextFollowup: extras.nextFollowup || null,
      };
      data.parents.push(parent);
      writeDb(data);
    }
    syncUpsert('parents', parent);
    return parent;
  },

  /** Scan all parents and merge cards that share the same phone (any format). */
  mergeAllDuplicateParentsByPhone: () => {
    const data = readDb();
    const groups = new Map();
    for (const parent of data.parents || []) {
      const key = normalizeParentPhone(parent.phone);
      if (!key) continue;
      const list = groups.get(key) || [];
      list.push(parent);
      groups.set(key, list);
    }
    let mergedGroups = 0;
    let absorbedCount = 0;
    for (const [, list] of groups) {
      if (list.length < 2) continue;
      const canonical = [...list].sort((a, b) => scoreParentRecord(b) - scoreParentRecord(a))[0];
      const absorbed = absorbDuplicateParentsInto(
        data,
        canonical,
        list.filter((p) => p.id !== canonical.id)
      );
      const normalized = normalizeParentPhone(canonical.phone);
      if (normalized) canonical.phone = normalized;
      if (absorbed.length) {
        mergedGroups += 1;
        absorbedCount += absorbed.length;
        syncUpsert('parents', canonical);
      }
    }
    writeDb(data);
    return { mergedGroups, absorbedCount };
  },

  /**
   * One-time heal: notes like "טלפון ילד/ה: 05…" → students.phone
   * when the dedicated column is still empty.
   */
  backfillStudentPhonesFromNotes: () => {
    const data = readDb();
    const noteRe = /טלפון\s*ילד\/?ה\s*:\s*([+\d][\d\s\-()]{6,})/i;
    let updated = 0;
    for (const student of data.students || []) {
      if (String(student.phone || '').trim()) continue;
      const notes = String(student.notes || '');
      const match = notes.match(noteRe);
      if (!match) continue;
      const raw = String(match[1] || '').trim();
      const normalized = normalizeParentPhone(raw);
      if (!normalized && !raw) continue;
      student.phone = normalized || raw;
      // Drop the duplicated note line so we don't keep two sources of truth.
      student.notes = notes
        .split(/\r?\n/)
        .filter((line) => !noteRe.test(line))
        .join('\n')
        .trim();
      syncUpsert('students', student);
      updated += 1;
    }
    if (updated) writeDb(data);
    return { updated };
  },

  /**
   * One-time heal: strip auto-dumped channel messages from staff notes.
   * Conversations live in the chat panel — notes are for hand-written follow-up only.
   */
  stripChannelMessageDumpsFromNotes: () => {
    const dumpLineRe = /^(הודעה(?:\s+נוספת)?\s+מ(?:וואטסאפ|מסנג׳ר|מסנג'ר|אינסטגרם)\s*:)/;
    let updated = 0;

    const cleanNotes = (raw) => {
      const text = String(raw || '');
      if (!text) return { next: text, changed: false };
      const lines = text.split(/\r?\n/);
      const kept = lines.filter((line) => !dumpLineRe.test(line.trim()));
      if (kept.length === lines.length) return { next: text, changed: false };
      return { next: kept.join('\n').trim(), changed: true };
    };

    const data = readDb();
    for (const parent of data.parents || []) {
      const { next, changed } = cleanNotes(parent.notes);
      if (!changed) continue;
      parent.notes = next;
      syncUpsert('parents', parent);
      updated += 1;
    }
    for (const student of data.students || []) {
      const { next, changed } = cleanNotes(student.notes);
      if (!changed) continue;
      student.notes = next;
      syncUpsert('students', student);
      updated += 1;
    }
    if (updated) writeDb(data);
    return { updated };
  },

  /**
   * One-time heal: a trainee's own phone opened a blank "לקוח וואטסאפ" card before that
   * trainee existed in the CRM. Fold each such card — and its conversation — into the
   * family the phone really belongs to. Cards with a real name or children are left alone.
   */
  mergeBlankLeadCardsIntoTraineeFamilies: () => {
    const data = readDb();
    const merged = [];

    for (const student of data.students || []) {
      if (!student.phone || !student.parentId) continue;
      const family = (data.parents || []).find((p) => p.id === student.parentId);
      if (!family) continue;

      const strays = (data.parents || []).filter(
        (p) => p.id !== family.id
          && parentPhonesMatch(p.phone, student.phone)
          && isBlankLeadCard(p, data)
      );
      if (!strays.length) continue;

      const absorbed = absorbDuplicateParentsInto(data, family, strays);
      if (absorbed.length) {
        merged.push({ student: student.name, family: family.name, absorbed });
      }
    }

    if (merged.length) writeDb(data);
    return { merged, count: merged.reduce((sum, m) => sum + m.absorbed.length, 0) };
  },

  createLeadFromWhatsApp: async (phone, text) => {
    const dataBefore = readDb();

    // A trainee messaging from their own phone belongs to their family, even when a
    // blank "לקוח וואטסאפ" card grabbed that number before the trainee was imported.
    const studentByPhone = (dataBefore.students || []).find((s) => parentPhonesMatch(s.phone, phone));
    const traineeFamily = studentByPhone?.parentId
      ? (dataBefore.parents || []).find((p) => p.id === studentByPhone.parentId)
      : null;

    // Prefer a real parent card when the number is already on a parent.
    const parentMatch = (dataBefore.parents || []).find(
      (p) => parentPhonesMatch(p.phone, phone)
        && !(traineeFamily && p.id !== traineeFamily.id && isBlankLeadCard(p, dataBefore))
    );
    if (parentMatch) {
      const parent = db.upsertParentByPhone(
        parentMatch.name || 'לקוח וואטסאפ',
        phone,
        parentMatch.email || '',
        {
          source: parentMatch.source || 'whatsapp',
          channel: 'whatsapp',
          status: parentMatch.status || 'lead_new',
        }
      );
      const data = readDb();
      const existingStudent = data.students.find((s) => s.parentId === parent.id);
      if (existingStudent) {
        if (existingStudent.status === 'archived') {
          existingStudent.status = 'lead_new';
          writeDb(data);
          await persistLeadPair(parent, existingStudent);
        }
        return {
          parent,
          student: existingStudent,
          isNew: false,
          matchedVia: 'parent_phone',
        };
      }
      if (parent.status === 'archived') parent.status = 'lead_new';
      writeDb(data);
      await persistCore('parents', parent);
      return { parent, student: null, isNew: false, matchedVia: 'parent_phone' };
    }

    // Child / trainee phone: attach to the existing parent card — never invent a new lead.
    if (traineeFamily) {
      const updatedParent = db.update('parents', traineeFamily.id, {
        channel: traineeFamily.channel === 'phone' ? 'whatsapp' : (traineeFamily.channel || 'whatsapp'),
      }) || traineeFamily;
      await persistCore('parents', updatedParent);
      return {
        parent: updatedParent,
        student: studentByPhone,
        isNew: false,
        matchedVia: 'child_phone',
      };
    }

    const parent = db.upsertParentByPhone('לקוח וואטסאפ', phone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
      status: 'lead_new',
    });

    const data = readDb();
    const existingStudent = data.students.find((s) => s.parentId === parent.id);
    if (existingStudent) {
      if (existingStudent.status === 'archived') {
        existingStudent.status = 'lead_new';
        writeDb(data);
        await persistLeadPair(parent, existingStudent);
      }
      return { parent, student: existingStudent, isNew: false, matchedVia: 'parent_phone' };
    }

    if (parent.status === 'archived') parent.status = 'lead_new';
    writeDb(data);
    await persistCore('parents', parent);
    return {
      parent,
      student: null,
      isNew: true,
      matchedVia: 'new_lead',
    };
  },

  upsertParentByInstagram: (igId, name = 'ליד מאינסטגרם') => {
    const data = readDb();
    let parent = data.parents.find(p => p.instagram_id === igId || (p.name === name && name !== 'ליד מאינסטגרם'));
    
    if (parent) {
      parent.instagram_id = igId;
      if (name && name !== 'ליד מאינסטגרם' && (parent.name === 'ליד מאינסטגרם' || parent.name === 'לקוח וואטסאפ')) {
        parent.name = name;
      }
      if (!parent.source || parent.source === 'unknown') parent.source = 'instagram';
      parent.channel = 'instagram';
      writeDb(data);
      syncUpsert('parents', parent);
      return parent;
    } else {
      parent = {
        id: `p${Date.now()}`,
        name: name,
        phone: '',
        email: '',
        source: 'instagram',
        instagram_id: igId,
        channel: 'instagram',
        status: 'lead_new',
      };
      data.parents.push(parent);
      writeDb(data);
      syncUpsert('parents', parent);
      return parent;
    }
  },

  createLeadFromInstagram: async (igId, text, name = 'ליד מאינסטגרם') => {
    const dataBefore = readDb();
    const hadParent = dataBefore.parents.some((p) => p.instagram_id === igId);

    const parent = db.upsertParentByInstagram(igId, name);
    const data = readDb();

    const existingStudent = data.students.find((s) => s.parentId === parent.id);
    if (existingStudent) {
      let dirty = false;
      if (existingStudent.status === 'archived') {
        existingStudent.status = 'lead_new';
        dirty = true;
      }
      if (!existingStudent.source || existingStudent.source === 'unknown') {
        existingStudent.source = 'instagram';
        dirty = true;
      }
      if (dirty) {
        writeDb(data);
        await persistLeadPair(parent, existingStudent);
      }
      return { parent, student: existingStudent, isNew: false };
    }

    const nextStatus = parent.status === 'archived' ? 'lead_new' : (parent.status || 'lead_new');
    if (parent.status !== nextStatus) {
      parent.status = nextStatus;
      writeDb(data);
      await persistCore('parents', parent);
    }
    return { parent, student: null, isNew: !hadParent };
  },

  createLeadFromForm: async ({
    parentName,
    lastName,
    idNumber,
    phone,
    email,
    city,
    children,
    interest,
    source = 'form',
  }) => {
    const parent = db.upsertParentByPhone(parentName, phone, email, {
      city: city || '',
      lastName: lastName || '',
      idNumber: idNumber || '',
      source,
      channel: source,
      notes: interest ? `עניין: ${interest}` : '',
      status: 'lead_new',
    });
    const createdStudents = [];
    const rawNames = Array.isArray(children)
      ? children.map((c) => (c || '').trim()).filter(Boolean)
      : (children ? [String(children).trim()] : []).filter(Boolean);

    if (rawNames.length === 0) {
      await persistCore('parents', parent);
      return { parent, students: createdStudents, isNew: true };
    }

    for (const childName of rawNames) {
      const trimmed = (childName || '').trim();
      if (!trimmed) continue;
      // Look under this parent AND any leftover duplicate parent with the same phone.
      const siblingParentIds = new Set(
        (db.get('parents') || [])
          .filter((p) => p.id === parent.id || parentPhonesMatch(p.phone, parent.phone))
          .map((p) => p.id)
      );
      const existing = db.get('students').find(
        (s) => sameChildName(s.name, trimmed) && siblingParentIds.has(s.parentId)
      );
      if (existing) {
        const patch = {
          parentId: parent.id,
          status: existing.status === 'archived' ? 'lead_new' : existing.status,
          source: existing.source && existing.source !== 'unknown' ? existing.source : source,
          notes: interest
            ? ((existing.notes ? `${existing.notes}\n` : '') + `עניין (טופס): ${interest}`)
            : existing.notes,
        };
        const updated = db.update('students', existing.id, patch);
        createdStudents.push(updated || { ...existing, ...patch });
        await persistLeadPair(parent, updated || { ...existing, ...patch });
      } else {
        const student = db.insert('students', {
          name: trimmed,
          parentId: parent.id,
          groupId: null,
          status: 'lead_new',
          birthDate: '',
          notes: interest ? `עניין: ${interest}` : '',
          levelGrade: null,
          source,
          created: new Date().toISOString().split('T')[0],
        });
        createdStudents.push(student);
        await persistLeadPair(parent, student);
        await persistHouseholdLinks(student, source);
      }
    }
    return { parent, students: createdStudents, isNew: createdStudents.length > 0 };
  },

  /** Add a trainee/child under an existing parent card. */
  addStudentToParent: async (parentId, { name, birthDate = '', status = 'lead_new', source = 'crm' } = {}) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { error: 'שם המתאמן חובה', status: 400 };

    const parent = db.getOne('parents', parentId);
    if (!parent) return { error: 'הלקוח לא נמצא', status: 404 };

    const existing = (db.get('students') || []).find(
      (s) => s.parentId === parentId && sameChildName(s.name, trimmed)
    );
    if (existing) {
      return { error: 'מתאמן עם שם זה כבר קיים תחת הלקוח', status: 409, student: existing };
    }

    const student = db.insert('students', {
      name: trimmed,
      parentId: parent.id,
      groupId: null,
      status,
      birthDate: birthDate || '',
      notes: '',
      levelGrade: null,
      source,
      created: new Date().toISOString().split('T')[0],
    });
    await persistLeadPair(parent, student);
    await persistHouseholdLinks(student, source);
    return { parent, student };
  },

  getBroadcastListDefs: () => {
    const data = readDb();
    if (!Array.isArray(data.broadcast_list_defs) || data.broadcast_list_defs.length === 0) {
      data.broadcast_list_defs = DEFAULT_BROADCAST_LIST_DEFS.map((l) => ({ ...l }));
      writeDb(data);
      for (const record of data.broadcast_list_defs) syncUpsert('broadcast_list_defs', record);
    }
    // One row per key. The two-list migration ran on more than one instance and
    // the durable store came back with a second copy of each list, which the
    // public form rendered as four checkboxes — two of them the same list.
    const byKey = new Map();
    for (const row of data.broadcast_list_defs) {
      const key = String(row?.key || '');
      if (!key || byKey.has(key)) continue;
      byKey.set(key, row);
    }
    return [...byKey.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  },

  createBroadcastListDef: ({ label, description = '', color = 'var(--blue)' }) => {
    const name = String(label || '').trim();
    if (!name) return { error: 'שם הרשימה חובה' };

    const data = readDb();
    if (!Array.isArray(data.broadcast_list_defs)) {
      data.broadcast_list_defs = DEFAULT_BROADCAST_LIST_DEFS.map((l) => ({ ...l }));
    }

    const key = `list_${Date.now().toString(36)}`;
    const sortOrder = data.broadcast_list_defs.reduce((max, l) => Math.max(max, l.sortOrder ?? 0), -1) + 1;
    const created = {
      key,
      label: name,
      description: String(description || '').trim(),
      color: color || 'var(--blue)',
      sortOrder,
    };
    data.broadcast_list_defs.push(created);
    writeDb(data);
    syncUpsert('broadcast_list_defs', created);
    return { ok: true, list: created, lists: db.getBroadcastListDefs() };
  },

  updateBroadcastListDef: (key, updates = {}) => {
    const data = readDb();
    if (!Array.isArray(data.broadcast_list_defs)) {
      data.broadcast_list_defs = DEFAULT_BROADCAST_LIST_DEFS.map((l) => ({ ...l }));
    }
    const index = data.broadcast_list_defs.findIndex((l) => l.key === key);
    if (index === -1) return { error: 'הרשימה לא נמצאה' };

    const current = data.broadcast_list_defs[index];
    const nextLabel = updates.label !== undefined ? String(updates.label).trim() : current.label;
    if (!nextLabel) return { error: 'שם הרשימה חובה' };

    data.broadcast_list_defs[index] = {
      ...current,
      label: nextLabel,
      description: updates.description !== undefined ? String(updates.description || '').trim() : (current.description || ''),
      color: updates.color !== undefined ? (updates.color || current.color) : current.color,
      sortOrder: updates.sortOrder !== undefined ? Number(updates.sortOrder) : current.sortOrder,
    };
    writeDb(data);
    syncUpsert('broadcast_list_defs', data.broadcast_list_defs[index]);
    return { ok: true, list: data.broadcast_list_defs[index], lists: db.getBroadcastListDefs() };
  },

  deleteBroadcastListDef: (key) => {
    const data = readDb();
    if (!Array.isArray(data.broadcast_list_defs)) {
      data.broadcast_list_defs = DEFAULT_BROADCAST_LIST_DEFS.map((l) => ({ ...l }));
    }
    if (data.broadcast_list_defs.length <= 1) {
      return { error: 'חייבת להישאר לפחות רשימת תפוצה אחת' };
    }
    const index = data.broadcast_list_defs.findIndex((l) => l.key === key);
    if (index === -1) return { error: 'הרשימה לא נמצאה' };

    data.broadcast_list_defs.splice(index, 1);
    if (Array.isArray(data.broadcast_lists)) {
      data.broadcast_lists = data.broadcast_lists.filter((r) => r.listName !== key);
    }
    writeDb(data);
    syncRemove('broadcast_list_defs', key);
    return { ok: true, lists: db.getBroadcastListDefs() };
  },

  getParentBroadcastLists: (parentId) => {
    const data = readDb();
    if (!data.broadcast_lists) data.broadcast_lists = [];

    const lists = db.getBroadcastListDefs().map((l) => l.key);
    const result = {};

    lists.forEach((l) => {
      const record = data.broadcast_lists.find((r) => r.parentId === parentId && r.listName === l);
      result[l] = record ? record.subscribed : true; // Default to true if no record exists
    });

    return result;
  },

  updateParentBroadcastLists: (parentId, subscriptions) => {
    const data = readDb();
    if (!data.broadcast_lists) data.broadcast_lists = [];

    Object.entries(subscriptions).forEach(([listName, subscribed]) => {
      const index = data.broadcast_lists.findIndex((r) => r.parentId === parentId && r.listName === listName);
      if (index !== -1) {
        data.broadcast_lists[index].subscribed = subscribed;
      } else {
        data.broadcast_lists.push({
          id: `bl${Date.now()}_${listName}`,
          parentId,
          listName,
          subscribed,
        });
      }
    });

    writeDb(data);
    for (const record of data.broadcast_lists.filter((r) => r.parentId === parentId)) {
      syncUpsert('broadcast_lists', record);
    }
    return db.getParentBroadcastLists(parentId);
  },

  deleteStudent: async (id) => {
    const student = (readDb().students || []).find(s => s.id === id);
    if (!student) return { ok: false, notFound: true };

    const durable = await removeCore('students', id);
    if (!durable.ok) return durable;

    const data = readDb();
    if (!data.students) data.students = [];
    const index = data.students.findIndex(s => s.id === id);
    if (index !== -1) data.students.splice(index, 1);

    // Delete the parent card too once no children are left on it.
    let parentError = null;
    const otherChildren = data.students.filter(s => s.parentId === student.parentId);
    if (student.parentId && otherChildren.length === 0) {
      const parentDurable = await removeCore('parents', student.parentId);
      if (parentDurable.ok) {
        const parentIdx = (data.parents || []).findIndex(p => p.id === student.parentId);
        if (parentIdx !== -1) data.parents.splice(parentIdx, 1);
      } else {
        parentError = parentDurable.error;
      }
    }

    writeDb(data);
    return { ok: true, parentError };
  },

  // הגדרות קטנות שנשמרות מקומית ב-db.json (מפתח -> ערך). העותק העמיד חי
  // ב-app_settings של Supabase; כאן רק המראה המקומית שקוראים ממנה בסינכרון.
  getAppSettingLocal: (key) => {
    const data = readDb();
    return data.app_settings_local?.[key];
  },

  setAppSettingLocal: (key, value) => {
    const data = readDb();
    if (!data.app_settings_local) data.app_settings_local = {};
    data.app_settings_local[key] = value;
    writeDb(data);
    return value;
  },

  clockIn: (employeeId, activityType, notes) => {
    const data = readDb();
    if (!data.shift_hours) data.shift_hours = [];
    
    // Close any existing open shift for this employee
    data.shift_hours.forEach(s => {
      if (s.employee_id === employeeId && s.status === 'open') {
        s.status = 'closed';
        s.clock_out = new Date().toISOString();
      }
    });

    const newShift = {
      id: `sh${Date.now()}`,
      employee_id: employeeId,
      clock_in: new Date().toISOString(),
      clock_out: null,
      activity_type: activityType || 'counter_shift',
      notes: notes || '',
      status: 'open',
      approved_by_accounting: false
    };
    
    data.shift_hours.push(newShift);
    writeDb(data);
    for (const shift of data.shift_hours.filter((s) => s.employee_id === employeeId)) {
      syncUpsert('shift_hours', shift);
    }
    return newShift;
  },

  // closedByEmployeeId: מי בפועל ביצע את הסגירה, כשזה שונה ממי שפתח את
  // המשמרת (למשל מדריך שממשיך על הקיר סוגר בשם מי שכבר הלך). השעות עדיין
  // משולמות לבעל המשמרת — זה רק תיעוד מי אישר את הסגירה.
  clockOut: (employeeId, notes, closedByEmployeeId) => {
    const data = readDb();
    if (!data.shift_hours) data.shift_hours = [];

    const openShift = data.shift_hours.find(s => s.employee_id === employeeId && s.status === 'open');
    if (!openShift) return null;

    openShift.status = 'closed';
    openShift.clock_out = new Date().toISOString();
    if (closedByEmployeeId) {
      openShift.closed_by_employee_id = closedByEmployeeId;
    }
    if (notes) {
      openShift.notes = (openShift.notes ? openShift.notes + ' | ' : '') + notes;
    }

    writeDb(data);
    syncUpsert('shift_hours', openShift);
    return openShift;
  },

  approveShifts: (shiftIds) => {
    const data = readDb();
    if (!data.shift_hours) data.shift_hours = [];
    
    shiftIds.forEach(id => {
      const shift = data.shift_hours.find(s => s.id === id);
      if (shift) {
        shift.approved_by_accounting = true;
      }
    });
    
    writeDb(data);
    for (const shift of data.shift_hours.filter((s) => shiftIds.includes(s.id))) {
      syncUpsert('shift_hours', shift);
    }
    return true;
  },

  insertSafetyInspection: (inspection) => {
    const data = readDb();
    if (!data.safety_inspections) data.safety_inspections = [];

    const now = new Date();
    const today = israelDateStr(now);
    const checkTypeId = inspection.check_type_id || inspection.type_id || null;
    let title = inspection.title || '';
    let inspectionType = inspection.inspection_type || 'daily';

    if (checkTypeId) {
      const types = data.safety_check_types || [];
      const type = types.find((t) => t.id === checkTypeId);
      if (type) {
        if (!title) title = type.name;
        if (!inspection.inspection_type) {
          inspectionType = type.frequency === 'יומי' ? 'daily'
            : type.frequency === 'שבועי' || type.frequency === 'דו שבועי' ? 'weekly'
            : type.frequency === 'חודשי' || type.frequency === 'דו חודשי' ? 'monthly'
            : 'annual';
        }
      }
    }

    const employees = data.employees || [];
    const empId = inspection.completed_by_employee_id || '';
    const emp = employees.find((e) => e.id === empId);
    const testerName = inspection.tester_name || inspection.testerName || emp?.name || '';

    const newInspection = {
      id: `sf${Date.now()}`,
      check_type_id: checkTypeId,
      title: title || 'בדיקת בטיחות',
      date: inspection.date || today,
      performed_at: inspection.performed_at || now.toISOString(),
      inspection_type: inspectionType,
      description: inspection.description || '',
      status: inspection.status || 'תקין',
      completed_by_employee_id: empId || null,
      tester_name: testerName,
      signature_file_url: inspection.signature_file_url || '',
      checks: inspection.checks || {},
      created_at: now.toISOString(),
    };

    data.safety_inspections.unshift(newInspection);
    writeDb(data);
    syncUpsert('safety_inspections', newInspection);
    return newInspection;
  },

  ensureSafetyCheckTypes: () => {
    const data = readDb();
    if (!Array.isArray(data.safety_check_types) || data.safety_check_types.length === 0) {
      data.safety_check_types = DEFAULT_SAFETY_CHECK_TYPES.map((t) => ({ ...t }));
      writeDb(data);
      for (const record of data.safety_check_types) syncUpsert('safety_check_types', record);
    }
    return data.safety_check_types;
  },

  getSafetyCheckTypes: ({ includeInactive = false } = {}) => {
    db.ensureSafetyCheckTypes();
    const list = db.get('safety_check_types') || [];
    const filtered = includeInactive ? list : list.filter((t) => t.active !== false);
    return [...filtered].sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || String(a.name).localeCompare(String(b.name), 'he'));
  },

  createSafetyCheckType: (payload = {}) => {
    db.ensureSafetyCheckTypes();
    const name = String(payload.name || '').trim();
    if (!name) return { error: 'שם הבדיקה חובה' };
    const frequency = String(payload.frequency || 'יומי').trim();
    const intervalDays = Number(payload.interval_days) > 0
      ? Number(payload.interval_days)
      : (FREQ_INTERVAL_DAYS[frequency] || 1);
    const existing = db.get('safety_check_types') || [];
    const maxSort = existing.reduce((m, t) => Math.max(m, Number(t.sort_order) || 0), 0);
    return db.insert('safety_check_types', {
      name,
      frequency,
      interval_days: intervalDays,
      description: String(payload.description || '').trim(),
      active: payload.active !== false,
      sort_order: payload.sort_order ?? maxSort + 1,
    });
  },

  updateSafetyCheckType: (id, updates = {}) => {
    const existing = db.getOne('safety_check_types', id);
    if (!existing) return null;
    const next = { ...updates };
    if (next.name != null) next.name = String(next.name).trim();
    if (next.frequency != null) next.frequency = String(next.frequency).trim();
    if (next.interval_days != null) {
      next.interval_days = Number(next.interval_days) > 0
        ? Number(next.interval_days)
        : (FREQ_INTERVAL_DAYS[next.frequency || existing.frequency] || existing.interval_days || 1);
    } else if (next.frequency && !updates.interval_days) {
      next.interval_days = FREQ_INTERVAL_DAYS[next.frequency] || existing.interval_days;
    }
    if (next.description != null) next.description = String(next.description).trim();
    return db.update('safety_check_types', id, next);
  },

  softDeleteSafetyCheckType: (id) => {
    const existing = db.getOne('safety_check_types', id);
    if (!existing) return null;
    return db.update('safety_check_types', id, { active: false });
  },

  /**
   * Annotate a check type with due / overdue / wall-open fields for a date.
   * Daily checks follow operating days; other frequencies keep calendar intervals.
   */
  annotateSafetyCheckStatus: (type, {
    dateStr = israelDateStr(),
    logs = null,
    activities = null,
    shifts = null,
  } = {}) => {
    const allLogs = logs || db.get('safety_inspections') || [];
    const cal = activities || db.get('activities') || [];
    const shiftRows = shifts || db.get('shift_hours') || [];
    const typeLogs = allLogs
      .filter((l) => l.check_type_id === type.id || (!l.check_type_id && l.title === type.name))
      .sort((a, b) => String(b.performed_at || b.date || '').localeCompare(String(a.performed_at || a.date || '')));
    const last = typeLogs[0] || null;
    const lastDate = last?.date || null;
    const interval = Number(type.interval_days) > 0
      ? Number(type.interval_days)
      : (FREQ_INTERVAL_DAYS[type.frequency] || 1);
    const signedToday = typeLogs.some((l) => l.date === dateStr);
    const todayLog = typeLogs.find((l) => l.date === dateStr) || null;
    const daysSince = daysBetweenDateStr(lastDate, dateStr);
    const daily = isDailySafetyCheck(type);
    const wallOpenToday = isWallOpenForSafety(dateStr, cal, shiftRows);
    const lastOpenDay = lastOperatingDayOnOrBefore(dateStr, cal, { shifts: shiftRows });

    let isDue;
    let isOverdue;
    let nextDue;
    if (daily) {
      isDue = wallOpenToday && !signedToday;
      isOverdue = isDailySafetyOverdue(lastDate, dateStr, cal, shiftRows);
      if (signedToday) {
        nextDue = null;
      } else if (wallOpenToday) {
        nextDue = dateStr;
      } else {
        nextDue = isOverdue ? lastOpenDay : null;
      }
    } else {
      nextDue = lastDate ? addDaysToDateStr(lastDate, interval) : dateStr;
      isDue = !lastDate || daysSince >= interval;
      isOverdue = isDue && !signedToday;
    }

    return {
      ...type,
      last_performed: lastDate,
      last_performed_at: last?.performed_at || null,
      last_tester_name: last?.tester_name || null,
      next_due: nextDue,
      days_since: Number.isFinite(daysSince) ? daysSince : null,
      is_due: isDue,
      is_overdue: isOverdue,
      signed_today: signedToday,
      today_log: todayLog,
      wall_open_today: wallOpenToday,
      last_operating_day: lastOpenDay,
      skipped_closed: daily && !wallOpenToday,
    };
  },

  getSafetyDueToday: (dateStr = israelDateStr()) => {
    const types = db.getSafetyCheckTypes({ includeInactive: false });
    const logs = db.get('safety_inspections') || [];
    const activities = db.get('activities') || [];
    const shifts = db.get('shift_hours') || [];

    return types
      .map((type) => db.annotateSafetyCheckStatus(type, { dateStr, logs, activities, shifts }))
      .filter((row) => {
        if (row.signed_today) return true;
        if (isDailySafetyCheck(row) && row.skipped_closed) return false;
        return row.is_due;
      });
  },

  getSafetyCheckTypesWithStatus: ({ includeInactive = false, dateStr = israelDateStr() } = {}) => {
    const types = db.getSafetyCheckTypes({ includeInactive });
    const logs = db.get('safety_inspections') || [];
    const activities = db.get('activities') || [];
    const shifts = db.get('shift_hours') || [];
    return types.map((type) => db.annotateSafetyCheckStatus(type, { dateStr, logs, activities, shifts }));
  },

  insertSafetyIncident: (incident) => {
    const data = readDb();
    if (!data.safety_incidents) data.safety_incidents = [];
    
    const newIncident = {
      id: `in${Date.now()}`,
      climber_name: incident.climber_name || '',
      gear_used: incident.gear_used || '',
      description: incident.description || '',
      injury_description: incident.injury_description || '',
      action_taken: incident.action_taken || '',
      employee_id: incident.employee_id || 'e-1',
      date: new Date().toISOString().split('T')[0]
    };
    
    data.safety_incidents.unshift(newIncident);
    writeDb(data);
    syncUpsert('safety_incidents', newIncident);
    return newIncident;
  },

  insertLevelTest: (test) => {
    const data = readDb();
    if (!data.level_tests) data.level_tests = [];

    const newTest = {
      id: `lt${Date.now()}`,
      ...normalizeLevelTestFields(test, data),
    };

    data.level_tests.unshift(newTest);
    syncStudentLevelGrade(data, newTest.studentId);
    writeDb(data);
    syncUpsert('level_tests', newTest);
    return newTest;
  },

  updateLevelTest: (id, updates) => {
    const data = readDb();
    if (!data.level_tests) return null;
    const index = data.level_tests.findIndex((t) => t.id === id);
    if (index === -1) return null;

    const prev = data.level_tests[index];
    const merged = normalizeLevelTestFields({ ...prev, ...updates }, data);
    const updated = {
      ...prev,
      ...merged,
      id: prev.id,
      updated_at: new Date().toISOString(),
    };
    data.level_tests[index] = updated;

    const studentIds = new Set(
      [prev.studentId, updated.studentId].filter(Boolean)
    );
    for (const studentId of studentIds) syncStudentLevelGrade(data, studentId);

    writeDb(data);
    syncUpsert('level_tests', updated);
    return updated;
  },

  deleteLevelTest: (id) => {
    const data = readDb();
    if (!data.level_tests) return false;
    const index = data.level_tests.findIndex((t) => t.id === id);
    if (index === -1) return false;
    const [removed] = data.level_tests.splice(index, 1);
    if (removed?.studentId) syncStudentLevelGrade(data, removed.studentId);
    writeDb(data);
    syncRemove('level_tests', id);
    return true;
  },

  /**
   * Attach a student's many-to-many relations — `groupIds` from `enrollments`,
   * `guardianIds` from `student_guardians` — so every screen sees the same
   * picture without asking for them separately.
   */
  withStudentRelations(students) {
    const enrollments = db.get('enrollments') || [];
    const guardians = db.get('student_guardians') || [];
    return enrichStudentsWithGuardians(
      enrichStudentsWithGroupIds(students || [], enrollments),
      guardians
    );
  },

  withStudentRelation(student) {
    if (!student) return student;
    return db.withStudentRelations([student])[0];
  },

  /** Ensure enrollment rows exist for every students.group_id (local + durable). */
  backfillEnrollmentsFromGroupId() {
    const students = db.get('students') || [];
    const existing = db.get('enrollments') || [];
    const have = new Set(
      existing.map((e) => `${e.student_id}|${e.group_id}`)
    );
    let created = 0;
    const today = israelDateStr();
    for (const s of students) {
      if (!s?.id || !s.groupId) continue;
      const key = `${s.id}|${s.groupId}`;
      if (have.has(key)) continue;
      db.insert('enrollments', {
        id: enrollmentId(s.id, s.groupId),
        student_id: s.id,
        group_id: s.groupId,
        status: s.status === 'waitlist' ? 'waitlist' : 'active',
        start_date: today,
        end_date: null,
        price: null,
      });
      have.add(key);
      created += 1;
    }
    return { created };
  },

  /**
   * Replace the full set of groups for a student.
   * Writes enrollments + keeps students.group_id as the primary pointer.
   */
  setStudentGroups(studentId, nextGroupIds = [], { primaryGroupId } = {}) {
    const student = db.getOne('students', studentId);
    if (!student) return null;

    const wanted = [...new Set((nextGroupIds || []).map((id) => String(id)).filter(Boolean))];
    const enrollments = db.get('enrollments') || [];
    const current = activeEnrollmentGroupIds(enrollments, studentId);
    const currentSet = new Set(current);
    const wantedSet = new Set(wanted);
    const today = israelDateStr();

    for (const gid of wanted) {
      if (currentSet.has(gid)) continue;
      const id = enrollmentId(studentId, gid);
      const already = (db.get('enrollments') || []).some((e) => String(e.id) === String(id));
      if (already) {
        // Heal local row that exists by id but wasn't counted (e.g. ended status).
        db.update('enrollments', id, {
          status: student.status === 'waitlist' ? 'waitlist' : 'active',
          end_date: null,
          student_id: studentId,
          group_id: gid,
        });
      } else {
        db.insert('enrollments', {
          id,
          student_id: studentId,
          group_id: gid,
          status: student.status === 'waitlist' ? 'waitlist' : 'active',
          start_date: today,
          end_date: null,
          price: null,
        });
      }
    }

    for (const gid of current) {
      if (wantedSet.has(gid)) continue;
      const row = (db.get('enrollments') || []).find(
        (e) => String(e.student_id) === String(studentId) && String(e.group_id) === String(gid) && !e.end_date
      );
      if (row?.id) db.delete('enrollments', row.id);
    }

    const primary = primaryGroupId && wanted.includes(String(primaryGroupId))
      ? String(primaryGroupId)
      : (wanted[0] || null);

    const updated = db.update('students', studentId, {
      groupId: primary,
      groupIds: wanted,
    });
    return db.withStudentRelation(updated);
  },

  addStudentToGroup(studentId, groupId) {
    const gid = String(groupId || '');
    if (!gid) return db.withStudentRelation(db.getOne('students', studentId));
    const current = studentGroupIds(db.withStudentRelation(db.getOne('students', studentId)));
    if (current.includes(gid)) {
      return db.withStudentRelation(db.getOne('students', studentId));
    }
    return db.setStudentGroups(studentId, [...current, gid], {
      primaryGroupId: current[0] || gid,
    });
  },

  removeStudentFromGroup(studentId, groupId) {
    const gid = String(groupId || '');
    const current = studentGroupIds(db.withStudentRelation(db.getOne('students', studentId)));
    if (!gid) {
      return db.setStudentGroups(studentId, []);
    }
    return db.setStudentGroups(
      studentId,
      current.filter((id) => id !== gid),
      { primaryGroupId: current.find((id) => id !== gid) || null }
    );
  },
};
