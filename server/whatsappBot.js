import { db, persistCore } from './db.js';
import {
  enrichStudentsWithGuardians,
  guardianRows,
  isChildOfParent,
} from './studentGuardians.js';
import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';
import { israelClockParts, isBotEnabled, shouldAiAutoReply } from './whatsappSchedule.js';
import { recordMessage } from './channels/messageStore.js';
import { DEFAULT_BUSINESS_PROFILE, getBusinessProfile } from './businessProfile.js';
import { enrichGroupsWithBotMeta } from './groupMetadata.js';
import { currentSeason, eligibilityForStudent, latestLevelTest } from './placementEligibility.js';
import { isMailingPreferenceRequest } from './mailingPreferences.js';

export const LEAD_STATUSES = new Set([
  'lead_new',
  'health_signed',
  'details_completed',
  'pending_signup',
  'awaiting_parent_confirmation',
  'awaiting_centre_confirmation',
  'waitlist',
]);
export const CUSTOMER_STATUSES = new Set([
  'registered',
  'intro_scheduled',
  'intro_paid',
  'active',
]);

/**
 * Retired gym name. Kept only so prompts already saved in app_settings get
 * rewritten to the current business name on read — never used in new defaults.
 */
const LEGACY_BRAND_RE = /My Wall/gi;
const BRAND_NAME = DEFAULT_BUSINESS_PROFILE.display_name;

/**
 * Almost every automatic reply opens with this, so a customer can tell at a
 * glance whether they are reading a person or the bot — the same answer the bot
 * gives when asked outright. Staff replies are never marked: they really are
 * people. The one exception is the identity gate — see botReplyText.
 *
 * The climber is the wall's own mark. It used to sit at the end of a few canned
 * messages as decoration, which would now put it twice in one message and stop
 * it reading as "this is the bot" — so those trailing copies were removed and
 * this is the only place it appears.
 */
export const BOT_MARK = '🤖🧗🏾';

/**
 * The mark before it grew the robot. Replies already sent carry it, and so do
 * drafts sitting in the CRM — without this they would come back through here
 * and end up wearing both marks at once.
 */
const LEGACY_BOT_MARKS = ['🧗'];

export function isBotMarked(text) {
  const body = String(text || '').trim();
  if (!body) return false;
  return body.startsWith(BOT_MARK) || LEGACY_BOT_MARKS.some((mark) => body.startsWith(mark));
}

/** Prices are allowed, invented prices are not. Stamped onto every system prompt. */
export const PRICE_SOURCE_RULE =
  'כלל קשיח: מסור רק מחירים שמופיעים בנתוני המערכת — מחיר הקבוצה, מחירי הציוד, דמי ההעשרה וכניסה בודדת מהמחירון. '
    + 'כל שאלת תשלום אחרת (מנוי, כרטיסייה, יום הולדת, הנחה, החזר, חשבונית, שכר) — הפנה לצוות בלי לנקוב בסכום. '
    + 'אם הכותב מתחת לגיל 18: מותר רק מחיר כניסה לקיר; אל תמסור מחירי חוגים, ציוד או דמי העשרה — הפנה להורה או לצוות.';

/**
 * The text as it goes out, marked unless the caller says otherwise.
 *
 * The one caller that says otherwise is the identity gate: the two questions
 * asked before we know who is writing. Opening a conversation with a robot
 * icon costs answers — people stop replying once they see they are talking to
 * software, and those two questions are the ones we cannot afford to lose.
 * Everything after them is marked again, and asked outright the bot still says
 * it is a bot; what is dropped is the badge, not the honesty.
 */
export function botReplyText(text, { unmarked = false } = {}) {
  return unmarked ? String(text || '').trim() : withBotMark(text);
}

export function withBotMark(text) {
  const body = String(text || '').trim();
  if (!body) return body;
  // A reply that passes through here twice must not stack the mark.
  return isBotMarked(body) ? body : `${BOT_MARK} ${body}`;
}

/**
 * The other half of the same promise: the bot says it is the bot, and a person
 * says they are a person. Without it a customer cannot tell whether the answer
 * that just arrived was typed by somebody or generated — which matters most in
 * exactly the conversations where staff step in over the bot.
 */
export const STAFF_MARK = '👤';

export function withStaffMark(text) {
  const body = String(text || '').trim();
  if (!body) return body;
  if (body.startsWith(STAFF_MARK) || isBotMarked(body)) return body;
  return `${STAFF_MARK} ${body}`;
}

/**
 * A standalone thank-you closes the exchange; it is not a new question. Sending
 * another acknowledgement is harmless once, but after a degraded model turn it
 * repeated the same handoff and made the bot look stuck in a loop.
 */
export function isClosingAcknowledgement(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:תודה(?:\s+(?:רבה|לכם|לך|ענקית))?|מעולה(?:\s+תודה)?|סבבה(?:\s+תודה)?|בסדר(?:\s+תודה(?:\s+רבה)?)?|אוקי(?:\s+תודה)?|אוקיי(?:\s+תודה)?|נעשה|אעשה|נטפל|נבדוק)$/u.test(normalized);
}

/**
 * A handoff is a workflow state, not merely a sentence the bot once sent.
 * It stays open until a person answers from the CRM/connected phone or staff
 * explicitly resumes the bot. Additional customer bubbles belong to the same
 * staff task and must not receive another "מעביר לצוות" acknowledgement.
 */
/**
 * A handoff that is still fresh — not one from an hour ago.
 *
 * This was written to stop the acknowledgement repeating on every bubble of a
 * burst, and it had no clock: once a conversation was handed over, the bot
 * stopped answering that customer entirely until a human wrote to them. A
 * parent who was told "I'll pass this to the team" at 17:04 asked an ordinary
 * question three minutes later and got nothing; another asked the next day.
 * Nine customers in two days were silenced this way.
 *
 * The staff task stays open either way. Answering the next question does not
 * undo it — it just stops the customer talking to a wall.
 */
export const HANDOFF_HOLD_MS = 10 * 60 * 1000;

export function hasOpenBotHandoff(parent, phone = parent?.phone || '', { withinMs = HANDOFF_HOLD_MS } = {}) {
  const handedAt = Date.parse(parent?.bot_handoff_at || '');
  if (!Number.isFinite(handedAt)) return false;
  if (Number.isFinite(withinMs) && Date.now() - handedAt > withinMs) return false;
  const normalized = normalizeWaPhone(phone) || phone;
  return !(db.get('messages') || []).some((message) => {
    if (message.direction !== 'outbound') return false;
    if (!phonesMatch(message.phone || '', normalized)) return false;
    if (Date.parse(message.created_at || '') <= handedAt) return false;
    return message.is_ai !== true
      && !['ai', 'bot_control', 'automation', 'template', 'otp'].includes(String(message.source || ''));
  });
}

/** Runtime allow/forbid — short bounds, no conversation script. */
export const BOT_BOUNDS_RULES = [
  '## מותר / אסור',
  'מותר: שיחה רגילה עם הלקוח; למסור רק עובדות שמופיעות בנתונים שקיבלת.',
  'אסור: להמציא שעה, מחיר, קבוצה, אירוע, קישור או שכר.',
  'אסור: לענות בעצמך על ביטול, החזר, חשבונית, תלונה, פציעה או שכר עובדים — העבר לצוות.',
  'שיחה רגילה (ברכות, נימוס, שאלות כלליות) — ענה טבעי. אל תתחיל ב-UNSURE.',
  'אם קיבלת «שם פרטי לפנייה» — כשהלקוח פותח בברכה (היי / שלום / מה נשמע / אהלן), פתח את תשובתך בשם הזה: «היי דלק!». זה נכון גם אם כבר דיברתם קודם היום.',
  'בהודעות המשך שאינן ברכה — אל תחזור על השם בכל הודעה.',
  'אם אין «שם פרטי לפנייה» — אל תמציא שם ואל תשאל לשם באמצע שיחה.',
  'חסר נתון במערכת או שהשאלה דורשת אדם: השב בשורה הראשונה HANDOFF ואז משפט טבעי קצר (למשל שאין לך את הפרט ואתה מעביר לצוות). אל תשתמש בנוסח קבוע.',
  'הודעה חסרת משמעות לגמרי: השב בשורה הראשונה UNSURE ואז בקש הבהרה קצרה.',
].join('\n');

export const FREE_CLIMBING_POLICY = [
  'מדיניות טיפוס חופשי:',
  '- הכניסה מגיל 6 ומעלה.',
  '- מגיל 11 ניתן להגיע ללא מבוגר בשעות פתיחת הקיר.',
  '- בגיל 6–10 ניתן להגיע עם מבוגר.',
  '- גם הילד וגם המבוגר המלווים חייבים למלא טופס השתתפות.',
  '- לחוגים ניתן להגיע ללא מבוגר מכיתה ג׳.',
].join('\n');

export const DEFAULT_BOT_SETTINGS = {
  aiOutsideHoursMessage:
    'קיבלנו את ההודעה 🙏\nאנחנו מחוץ לשעות המענה כרגע.\nנחזור אליכם בבוקר בין 9:00 ל־21:00.',
  // Explicit human ask / hard topics only — bare «צוות» must not match «בצוות».
  aiHandoffKeywords:
    'אדם,נציג,תלונה,מנהל,דחוף,לדבר עם,ביטול,לבטל,החזר,זיכוי,חשבונית,פציעה,נפצע,כאב',
  aiHandoffAckMessage: `מעבירים אתכם לצוות ${BRAND_NAME}\nמישהו יחזור אליכם בהקדם.`,
  aiStopKeywords: 'עצור,הסר,stop,unsubscribe,הסר אותי',
  aiOptOutMessage: 'הוסרתם מרשימת המענה האוטומטי.\nאם תרצו לחזור — כתבו «הפעל בוט».',
  aiPauseOnHumanReply: true,
  aiPauseMinutesAfterHuman: 1,
  aiAudienceMode: 'all',
  aiHistoryCount: 8,
  // Emergency guard only; ordinary replies are kept short by the agent rules.
  aiMaxReplyChars: 1200,
  // Quiet window after the customer's last bubble. A new bubble resets it.
  aiReplyDelayMs: 7_000,
  aiRateLimitPerHour: 20,
  aiKnowledgeBase:
    'שאלות נפוצות:\n'
    + '- חניה: יש חניה בחזית הקיר.\n'
    + '- גיל מינימום לחוג ילדים: לפי כיתה בקבוצות במערכת.\n'
    + '- ציוד: נעלי טיפוס להשכרה במקום, חולצת חוג ושק מגנזיום.\n'
    + '- שעות פתיחה: רק לפי מה שמסומן ביומן כ«שעות פתיחה».\n'
    + '- אירועים וטיולים: רק אירועים שסומנו לפרסום, כולל קישור הרשמה.\n'
    + '- ביטול אימון: לעדכן את הצוות מראש בוואטסאפ.',
  aiForbiddenTopics:
    'אל תיתן ייעוץ רפואי — הצהרת בריאות היא טופס, לא אישור רפואי.\n'
    + 'אל תשתף פרטים של לקוחות אחרים.\n'
    + 'אל תבטיח הנחות, פטורים או החזרים.\n'
    + 'אל תמציא מחיר שלא מופיע בקבוצה או בהגדרות הציוד.\n'
    + 'אל תמציא שעות פתיחה שלא מופיעות ביומן.\n'
    + 'אל תמציא קבוצות או אירועים שלא במערכת.\n'
    + 'אל תפרסם אירוע פרטי (יום הולדת) גם אם יש לו קישור הרשמה.\n'
    + 'ביטול, החזר כספי, שינוי תשלום, חשבונית, תלונה, פציעה או שכר — העבר לצוות.',
  aiBusinessFacts:
    'כתובת: השקד 1, תל מונד\n'
    + 'חניה: יש חניה בחזית הקיר\n'
    + 'שעות פתיחה: לפי הרשומות שמסומנות «שעות פתיחה» ביומן המערכת\n'
    + 'דמי העשרה: 110 ₪\n'
    + 'הצהרת בריאות: https://app.kirboaz.co.il/health',
  // The settings of the retired keyword engine — a numbered opening menu, the
  // staged lead capture, and the clarify-then-handoff pair — are gone with it.
  // The model phrases its own clarification, and the only thing it may not do
  // is answer without a tool.
  aiReactivateKeywords: 'הפעל בוט,הפעל,activate',
  // מספרי צוות שמקבלים התראת העברה + סוכן CRM. ריק = אין התראות.
  aiStaffPhones: '',
};

/** Placeholder names mean the card exists but we still do not know who is writing. */
export function isIdentifiedParent(parent) {
  const name = String(parent?.name || '').trim();
  if (!name || name.length < 2) return false;
  // Avoid \\b — it does not treat Hebrew letters as word characters.
  if (/^לקוח\s*וואטסאפ/i.test(name)) return false;
  if (/^לקוח$/i.test(name)) return false;
  // The other channels' placeholder cards — the same "no real name yet" state,
  // and greeting one of them would say "היי ליד".
  if (/^ליד\s*מאינסטגרם/i.test(name)) return false;
  if (/^לקוח\s*מסנג/i.test(name)) return false;
  if (/^(?:client|whatsapp\s*customer)\b/i.test(name)) return false;
  return true;
}

/** First name only — never greet with the family name. */
export function parentFirstName(parent) {
  const name = String(parent?.name || '').trim();
  if (!name || !isIdentifiedParent(parent)) return '';
  return name.split(/\s+/)[0];
}

/**
 * Who to greet: the person writing this message.
 *
 * A child's WhatsApp is filed on the parent card (`matchedVia === 'child_phone'`),
 * so using the parent name alone greeted Omer as "מירית" — his mother. When the
 * speaker is a known trainee, their first name wins.
 */
export function greetingFirstName(parent, speaker = null) {
  const speakerName = String(speaker?.name || '').trim();
  if (speakerName) return speakerName.split(/\s+/)[0];
  return parentFirstName(parent);
}



const BRANDED_TEXT_KEYS = [
  'aiSystemPrompt',
  'aiHandoffAckMessage',
  'aiGreetingMenu',
  'aiOutsideHoursMessage',
  'aiBusinessFacts',
  'aiKnowledgeBase',
  'aiUnsureReply',
  'aiClarifyReply',
  'aiOptOutMessage',
  'aiForbiddenTopics',
];

export function mergeBotSettings(settings = {}) {
  return { ...DEFAULT_BOT_SETTINGS, ...settings };
}

/** Replace legacy gym name with the current business display name. */
export function applyBusinessBrand(settings = {}, brandName) {
  const brand = String(brandName || '').trim() || DEFAULT_BUSINESS_PROFILE.display_name;
  const merged = mergeBotSettings(settings);
  const stamped = { ...merged, brandName: brand };
  for (const key of BRANDED_TEXT_KEYS) {
    if (stamped[key] != null) {
      stamped[key] = String(stamped[key]).replace(LEGACY_BRAND_RE, brand);
    }
  }
  return stamped;
}

export async function loadBrandedBotSettings() {
  let brand = DEFAULT_BUSINESS_PROFILE.display_name;
  try {
    const profile = await getBusinessProfile();
    brand = profile.display_name || brand;
  } catch {
    // keep fallback
  }
  const branded = applyBusinessBrand(db.getSettings(), brand);
  const prompt = String(branded.aiSystemPrompt || '').trim();
  // The bot may quote a price, but only one the CRM holds — a figure it made up
  // reaches the customer as a promise the gym has to honour. Stamped onto the
  // owner's prompt rather than left to it, so editing the prompt cannot drop it.
  if (!prompt.includes('רק מחירים שמופיעים בנתוני המערכת')) {
    branded.aiSystemPrompt = prompt ? `${prompt}\n\n${PRICE_SOURCE_RULE}` : PRICE_SOURCE_RULE;
  }
  return branded;
}

export function parseKeywordList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,|\n]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export function textMatchesKeywords(text, keywords) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return false;
  const list = Array.isArray(keywords) ? keywords : parseKeywordList(keywords);
  return list.some((kw) => kw && raw.includes(kw));
}

/**
 * Commands such as "stop" / "הסר" must be whole words or phrases. A plain
 * substring match treated "הסרת אחריות" as a request to opt out of the bot,
 * even though that is the name customers use for the participation form.
 */
export function textMatchesStandaloneKeywords(text, keywords) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return false;
  const list = Array.isArray(keywords) ? keywords : parseKeywordList(keywords);
  return list.some((keyword) => {
    const phrase = String(keyword || '').trim().toLowerCase();
    if (!phrase) return false;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(raw);
  });
}

/**
 * Explicit request for a human / hard topics — not «בצוות» in an info question.
 *
 * Words that only mean "get me a human" inside a request, never on their own.
 */
const AMBIGUOUS_HUMAN_WORDS = new Set(['אדם', 'בן אדם']);

export function wantsExplicitHumanStaff(text, settings = {}) {
  const t = String(text || '');
  if (/(?:לדבר עם|רוצה(?:\s+לדבר)?(?:\s+עם)?)\s*(?:את\s*)?(?:ה)?(?:צוות|נציג|אדם)/.test(t)) {
    return true;
  }
  // The owner's keyword list carries «אדם», which appears in ordinary
  // questions far more often than in requests for a person. The asking form is
  // checked above; here the ambiguous words are left out so a plain question
  // reaches the model.
  const s = mergeBotSettings(settings);
  const keywords = String(s.aiHandoffKeywords || '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k && !AMBIGUOUS_HUMAN_WORDS.has(k))
    .join(',');
  return textMatchesKeywords(t, keywords);
}

export function clipReply(text, maxChars = 1200) {
  const body = String(text || '').trim();
  const limit = Number(maxChars) > 0 ? Number(maxChars) : 1200;
  if (body.length <= limit) return body;
  const room = Math.max(0, limit - 1);
  const chunk = body.slice(0, room);
  const boundary = Math.max(
    chunk.lastIndexOf('\n'),
    chunk.lastIndexOf('. '),
    chunk.lastIndexOf('? '),
    chunk.lastIndexOf('! ')
  );
  const safe = boundary >= Math.floor(room * 0.55) ? chunk.slice(0, boundary + 1) : chunk;
  return `${safe.trim()}…`;
}

export function sleep(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

/**
 * Menu (no health declaration):
 * 1 = classes · 2 = hours/location · 3 = staff · 4 = events
 * `health` is keyword-only (not a menu number).
 */

function parentsForPhone(phone) {
  const normalized = normalizeWaPhone(phone) || phone;
  return (db.get('parents') || []).filter((p) => phonesMatch(p.phone, normalized));
}

async function updateParentsForPhone(phone, patch) {
  const matches = parentsForPhone(phone);
  const updated = [];
  for (const match of matches) {
    const row = db.update('parents', match.id, patch);
    if (row) {
      await persistCore('parents', row);
      updated.push(row);
    }
  }
  return updated;
}

export function findPrimaryParent(phone) {
  const matches = parentsForPhone(phone);
  if (!matches.length) return null;
  return matches.slice().sort((a, b) => {
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  })[0];
}

/**
 * Every child this parent is a guardian of — not only the ones filed under
 * their own card. Two parents of one household keep separate cards, and a
 * customer asking about their child does not care which card the child sits on.
 */
export function studentsForParent(parent) {
  if (!parent?.id) return [];
  const students = db.get('students') || [];
  const enriched = enrichStudentsWithGuardians(students, guardianRows(db));
  return enriched.filter((student) => isChildOfParent(student, parent.id));
}

export function classifyAudience(parent, students = []) {
  const statuses = [
    parent?.status,
    ...students.map((s) => s.status),
  ].filter(Boolean);
  if (statuses.some((s) => CUSTOMER_STATUSES.has(s))) return 'customer';
  if (statuses.some((s) => LEAD_STATUSES.has(s))) return 'lead';
  if (!statuses.length) return 'lead';
  return 'lead';
}

export function audienceAllows(settings, parent, students = []) {
  const mode = settings.aiAudienceMode || 'all';
  if (mode === 'all') return true;
  const kind = classifyAudience(parent, students);
  if (mode === 'leads_only') return kind === 'lead';
  if (mode === 'customers_only') return kind === 'customer';
  return true;
}

export function isBotPaused(parent, now = new Date()) {
  if (!parent?.bot_paused_until) return false;
  const until = new Date(parent.bot_paused_until).getTime();
  if (Number.isNaN(until)) return false;
  return until > now.getTime();
}

export function isOptedOut(parent) {
  return !!parent?.bot_opted_out;
}

/**
 * Templates only an automation ever sends. A staff member picking a template in
 * the conversation panel is a real human turn and still counts as one.
 */
export const SYSTEM_TEMPLATE_NAMES = new Set([
  'phone_verification_code',
  'onboarding_completed_v1',
  'onboarding_completed_self_v1',
  'my_agenda_v1',
]);

/** Outbound that came from a person (CRM / phone), not from the customer bot. */
export function isHumanOutboundLog(log) {
  if (!log || log.direction !== 'outbound') return false;
  if (log.is_ai) return false;
  const source = String(log.source || '');
  // Automated system traffic — never treat as "staff took the thread".
  if (
    source === 'ai'
    || source === 'bot_control'
    || source === 'staff_chat'
    || source === 'staff_notify'
    || source === 'otp'
    || source === 'system'
    || source === 'automation'
  ) {
    return false;
  }
  const template = String(log.template_name || log.template_id || '');
  if (template === 'phone_verification_code') return false;
  if (/קוד האימות שלך/.test(String(log.message || ''))) return false;
  // An automation's own templates are the system talking. A customer filled the
  // health form, the confirmation template went out under the CRM's name, and
  // the bot fell silent on "מילאתי" for two hours because that row looked like
  // a staff member taking the thread. Senders now tag themselves 'automation',
  // and these names are the backstop for any sender that forgets to.
  if (SYSTEM_TEMPLATE_NAMES.has(template)) return false;
  // crm / phone / empty source on a non-AI outbound = staff
  return true;
}

/**
 * If staff already wrote to this customer, the next inbound belongs to that
 * human thread — the bot must not jump in (even if the timed pause was lost
 * after a server restart).
 */
export function shouldDeferToHumanStaff(phone, { resumedAt = null, withinMinutes = null } = {}) {
  const normalized = normalizeWaPhone(phone) || phone;
  if (!normalized) return false;
  // This check exists because a timed pause is lost when the server restarts —
  // it reconstructs that pause from the message log. It was reconstructing it
  // without the clock, so a single "היי" from a staff member silenced the bot
  // for that customer permanently: thirty-six hours later a parent asked about
  // a class for their four-year-old and got nothing. A human holds the thread
  // for as long as the pause lasts, and no longer.
  const holdMs = Math.max(0, Number(withinMinutes) || 0) * 60 * 1000;
  // "Bring the bot back" had nothing to clear: the signal is the message log,
  // not a flag, so the button cleared a pause that was not there and the next
  // message was blocked by the same staff row. Anything before the resume no
  // longer counts.
  const resumedTs = resumedAt ? new Date(resumedAt).getTime() : 0;
  // `messages` is the source of truth; `whatsapp_logs` is a local mirror of it
  // and can lag or be rebuilt. Reading the mirror alone is how a staff reply
  // sent from the CRM at 10:18 went unseen, and the bot answered the customer
  // at 10:21 — three minutes into a hold that is supposed to last ten.
  const rows = [...(db.get('messages') || []), ...(db.get('whatsapp_logs') || [])];
  const seen = new Set();
  const logs = rows
    .filter((l) => (l.channel || 'whatsapp') === 'whatsapp'
      && phonesMatch(l.phone || l.to || l.from, normalized))
    .filter((l) => {
      const key = `${l.id || ''}|${l.created_at || ''}|${l.direction || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  for (const log of logs) {
    if (log.direction === 'inbound') continue;
    if (log.direction !== 'outbound') continue;
    const at = new Date(log.created_at || 0).getTime();
    if (resumedTs && at <= resumedTs) return false;
    if (!isHumanOutboundLog(log)) return false;
    return holdMs ? Date.now() - at < holdMs : true;
  }
  return false;
}

/**
 * What the bot will do for this customer right now, in a shape the CRM can
 * render. `until` is the authority on a pause — `minutesLeft` is a snapshot
 * that goes stale the moment it leaves the server.
 */
export function describeBotState(parent, settings = {}, now = new Date()) {
  const s = mergeBotSettings(settings);
  const globallyOff = !isBotEnabled(s);

  if (isOptedOut(parent)) {
    return {
      status: 'opted_out',
      // Who asked for the silence decides the wording in the CRM.
      source: parent?.bot_opt_out_source === 'crm' ? 'crm' : 'customer',
      until: null,
      minutesLeft: null,
      reason: null,
      globallyOff,
    };
  }

  if (isBotPaused(parent, now)) {
    const until = parent.bot_paused_until;
    const msLeft = new Date(until).getTime() - now.getTime();
    return {
      status: 'paused',
      source: 'crm',
      until,
      minutesLeft: Math.max(1, Math.ceil(msLeft / 60000)),
      reason: parent?.bot_pause_reason || (parent?.bot_handoff_at ? 'handoff' : 'human_reply'),
      globallyOff,
    };
  }

  // The gate stands down whenever the last outbound came from a person, with no
  // pause row behind it — so the card said "בוט פעיל" while the bot was in fact
  // silent. A state nobody can see is a state nobody can fix: the badge has to
  // report what the gate will actually do on the next message.
  if (s.aiPauseOnHumanReply !== false && shouldDeferToHumanStaff(parent?.phone || '', {
    resumedAt: parent?.bot_resumed_at,
    withinMinutes: s.aiPauseMinutesAfterHuman,
  })) {
    return {
      status: 'staff_thread',
      source: 'staff',
      until: null,
      minutesLeft: null,
      reason: 'human_thread',
      globallyOff,
    };
  }

  return {
    status: 'active',
    source: null,
    until: null,
    minutesLeft: null,
    reason: null,
    globallyOff,
  };
}

/**
 * A staff reply pauses the bot. It does *not* close the handoff any more.
 *
 * Answering once is not the same as being done: half the handoffs are a
 * question that takes a phone call, a refund, a decision. Clearing the mark on
 * the first reply took the customer off "ממתינים לטיפול" while the thing they
 * asked for had not happened yet. Only „סיום הטיפול” closes it now — a person
 * saying so, not the system guessing.
 */
export async function pauseBotForPhone(phone, minutes, { reason = 'human_reply' } = {}) {
  const mins = Math.max(1, Number(minutes) || 1);
  const until = new Date(Date.now() + mins * 60 * 1000).toISOString();
  const patch = {
    bot_paused_until: until,
    bot_pause_reason: reason,
  };
  if (reason === 'handoff') patch.bot_handoff_at = new Date().toISOString();
  const updated = await updateParentsForPhone(phone, patch);
  return { until, updated };
}

/**
 * A handoff used to mute the bot for two hours as well as calling the team. In
 * practice the customer kept writing and got silence: nobody is standing by to
 * answer within seconds, and the next question was usually one the bot could
 * have answered on its own. So a handoff now only records that it happened —
 * the mute that matters is the one a real staff reply triggers ('human_reply'),
 * and that one is untouched.
 *
 * `bot_handoff_at` still has to be written: bot learning reads it to tell which
 * conversations ended up with a human.
 */
export async function recordBotHandoff(phone) {
  return updateParentsForPhone(phone, { bot_handoff_at: new Date().toISOString() });
}

export async function clearBotPause(phone) {
  return updateParentsForPhone(phone, {
    bot_paused_until: null,
    bot_pause_reason: null,
    bot_handoff_at: null,
    // Also releases the staff-thread stand-down, which has no row to clear.
    bot_resumed_at: new Date().toISOString(),
  });
}

export async function optOutPhone(phone, optedOut = true, { source = 'customer' } = {}) {
  return updateParentsForPhone(phone, {
    bot_opted_out: !!optedOut,
    bot_opt_out_source: optedOut ? source : null,
    // An opt-out outranks a pause; clearing it leaves any pause alone.
    ...(optedOut ? { bot_paused_until: null, bot_pause_reason: null } : {}),
  });
}

export function countBotRepliesLastHour(phone, now = new Date()) {
  const since = now.getTime() - 60 * 60 * 1000;
  const logs = db.get('whatsapp_logs') || [];
  return logs.filter((l) => {
    if ((l.channel || 'whatsapp') !== 'whatsapp') return false;
    if (l.direction !== 'outbound') return false;
    if (!(l.is_ai || l.source === 'ai' || l.source === 'bot_control')) return false;
    if (!phonesMatch(l.phone || l.to, phone)) return false;
    const t = new Date(l.created_at || 0).getTime();
    return t >= since;
  }).length;
}

export function isRateLimited(settings, phone) {
  const limit = Number(settings.aiRateLimitPerHour);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return countBotRepliesLastHour(phone) >= limit;
}

function israelDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function shouldSendOutsideHoursMessage(parent, now = new Date()) {
  const today = israelDateKey(now);
  return parent?.bot_outside_hours_date !== today;
}

export async function markOutsideHoursSent(phone, now = new Date()) {
  return updateParentsForPhone(phone, { bot_outside_hours_date: israelDateKey(now) });
}

export function logBotControl(phone, message, meta = {}) {
  return recordMessage({
    phone: normalizeWaPhone(phone) || phone,
    channel: 'whatsapp',
    direction: 'outbound',
    message,
    status: 'sent',
    is_ai: true,
    source: 'bot_control',
    ...meta,
  });
}

/**
 * Numbers that get the CRM agent instead of the customer bot — the classes
 * coordinator asking about a specific trainee, not a parent asking about a
 * class. Matching is on the number alone, so the list is the whole guard:
 * every reply on this path may contain customer data.
 */
export function staffPhones(settings = {}) {
  return parseKeywordList(settings.aiStaffPhones)
    .map((value) => normalizeWaPhone(value) || value)
    .filter(Boolean);
}

export function isStaffPhone(settings, phone) {
  if (!phone) return false;
  return staffPhones(settings).some((staff) => phonesMatch(staff, phone));
}

/**
 * The community centre's own numbers. They are neither customers nor staff:
 * the centre writes us a child's name and expects a billing date back, so
 * their messages take a different path entirely.
 */
/**
 * Each entry is a number, optionally followed by the name of the person who
 * writes from it — «0526688649 כרמית». The name is what lets the bot open with
 * „בוקר טוב כרמית” instead of asking the centre's secretary what her name is,
 * and a list of bare numbers keeps working exactly as before.
 */
function centreEntries(settings) {
  return String(settings?.aiCentrePhones || '')
    // A number pasted into a right-to-left field arrives wrapped in invisible
    // direction marks. They never mattered while the whole entry was a phone
    // number; now they decide where the number ends and the name begins.
    .replace(/[‎‏؜⁦-⁩]/gu, '')
    .split(/[,|\n]+/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => {
      const match = /^([+\d][\d\s-]*)(.*)$/u.exec(entry);
      return {
        phone: String(match?.[1] || entry).replace(/[\s-]/g, '').trim(),
        name: String(match?.[2] || '').trim(),
      };
    })
    .filter((entry) => entry.phone);
}

export function centrePhones(settings) {
  return centreEntries(settings).map((entry) => entry.phone);
}

export function isCentrePhone(settings, phone) {
  if (!phone) return false;
  return centrePhones(settings).some((centre) => phonesMatch(centre, phone));
}

/** The name of the person writing from this centre number, if one was given. */
export function centreContactName(settings, phone) {
  if (!phone) return '';
  return centreEntries(settings).find((entry) => phonesMatch(entry.phone, phone))?.name || '';
}

/** Recent turns of this conversation in the shape the CRM agent expects. */
/**
 * History rows older than this get a visible age tag. The model has no clock:
 * a customer sent a photo at 08:46, said hello at 11:55, and the reply was
 * about the photo — three hours stale — because both lines looked equally
 * current. The tag is what lets the prompt rule "old messages are a previous
 * conversation" actually bite.
 */
const HISTORY_STALE_MS = 3 * 60 * 60 * 1000;

function historyAgeTag(createdAt, now = Date.now()) {
  const at = new Date(createdAt || 0).getTime();
  if (!at || now - at < HISTORY_STALE_MS) return '';
  const hours = Math.round((now - at) / (60 * 60 * 1000));
  if (hours < 24) return `[לפני ${hours} שעות] `;
  const days = Math.round(hours / 24);
  return `[לפני ${days === 1 ? 'יום' : `${days} ימים`}] `;
}

export function getChatHistoryMessages(phone, limit = 6) {
  const n = normalizeHistoryLimit(limit, 6);
  if (n === 0) return [];
  const logs = db.get('whatsapp_logs') || [];
  const now = Date.now();
  return logs
    .filter((l) => (l.channel || 'whatsapp') === 'whatsapp' && phonesMatch(l.phone || l.to || l.from, phone))
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .slice(-n)
    .map((l) => ({
      role: l.direction === 'inbound' ? 'user' : 'assistant',
      content: String(l.message || '').trim()
        ? `${historyAgeTag(l.created_at, now)}${String(l.message || '').slice(0, 1000)}`
        : '',
    }))
    .filter((m) => m.content);
}

export function getConversationHistory(phone, limit = 8) {
  const n = normalizeHistoryLimit(limit, 8);
  if (n === 0) return [];
  const logs = db.get('whatsapp_logs') || [];
  return logs
    .filter((l) => (l.channel || 'whatsapp') === 'whatsapp' && phonesMatch(l.phone || l.to || l.from, phone))
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .slice(-n)
    .map((l) => {
      const who = l.direction === 'inbound' ? 'לקוח' : (l.is_ai || l.source === 'ai' || l.source === 'bot_control' ? 'בוט' : 'צוות');
      return `${who}: ${String(l.message || '').slice(0, 400)}`;
    });
}

/** The settings screen explicitly allows zero to mean "send no history". */
export function normalizeHistoryLimit(value, fallback = 8) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(30, Math.trunc(parsed)));
}

export function buildParentCardContext(parent, students = [], { speaker = null } = {}) {
  if (!parent) return 'אין כרטיס לקוח.';
  const groups = enrichGroupsWithBotMeta(db, db.get('groups') || []);
  const lines = [
    `הורה: ${parent.name || 'ללא שם'} | טלפון: ${parent.phone || ''} | סטטוס הורה: ${parent.status || '—'}`,
  ];
  // The model was given the full name and still opened with a nameless "היי".
  // Handing it the first name as its own labelled line is what the greeting
  // rule in BOT_BOUNDS_RULES points at. When a trainee wrote from their own
  // number, that first name is theirs — not the parent's.
  const firstName = greetingFirstName(parent, speaker);
  if (firstName) lines.push(`שם פרטי לפנייה: ${firstName}`);
  if (speaker?.name) {
    lines.push(
      `הכותב הוא המתאמן ${String(speaker.name).trim()} — כתב ממספר שלו, לא ממספר ההורה. `
      + 'פנה אליו בשמו, לא בשם ההורה.'
    );
  }
  if (!students.length) {
    lines.push('אין מתאמנים מקושרים.');
  } else {
    for (const s of students) {
      const group = groups.find((g) => g.id === s.groupId);
      const latest = latestLevelTest(db, s.id);
      const eligibility = eligibilityForStudent(db, s.id, { season: currentSeason() });
      const visibleStatus = s.status === 'pending_signup' && !group
        ? 'details_completed'
        : (s.status || '—');
      lines.push(
        `מתאמן: ${s.name || '—'} | סטטוס: ${visibleStatus} | קבוצה: ${group?.name || 'ללא'} | כיתה/גיל: ${group?.ageCategory || s.birthDate || '—'} | מגדר: ${s.gender || 'לא ידוע'} | רמת מבחן אחרונה: ${latest.level || 'לא ידועה'}`
      );
      if (eligibility.length) {
        lines.push(`זכאות לקבוצות: ${eligibility.map((row) => {
          const eligibleGroup = groups.find((item) => String(item.id) === String(row.group_id || ''));
          return `${eligibleGroup?.name || row.program}=${row.status}`;
        }).join(', ')}`);
      }
      if (s.status === 'pending_signup' && !group) {
        lines.push('הערת מערכת: אין למתאמן קבוצה, ולכן אסור לומר שהוא משובץ או ממתין להרשמה.');
      }
    }
  }
  if (parent.bot_intake?.step) {
    lines.push(`איסוף ליד פעיל: שלב ${parent.bot_intake.step}`);
  }
  return lines.join('\n');
}




/**
 * Gibberish / keyboard mash — not a real question.
 * Used so we only escalate after clarify when the follow-up is still noise.
 */


/**
 * Last bot turn (before the current inbound already in the log) asked for clarification.
 */

/**
 * Unsure once → ask to rephrase.
 * Unsure again only hands off when the new message is still gibberish.
 * A real follow-up question stays in the chat (ask again / let heuristics answer).
 */

/** Lead intake state machine */
export function getIntake(parent) {
  return parent?.bot_intake && typeof parent.bot_intake === 'object' ? parent.bot_intake : null;
}

export async function setIntake(phone, intake) {
  return updateParentsForPhone(phone, { bot_intake: intake });
}

/** A usable customer identity is exactly a first name plus a family name. */
export function customerNameParts(parent) {
  if (!isIdentifiedParent(parent)) return { firstName: '', lastName: '', complete: false };
  const words = String(parent?.name || '').trim().split(/\s+/).filter(Boolean);
  const firstName = words[0] || '';
  const storedLast = String(parent?.lastName || parent?.last_name || '').trim();
  const lastName = storedLast || words.slice(1).join(' ');
  return { firstName, lastName, complete: Boolean(firstName && lastName) };
}

export function hasCustomerFullName(parent) {
  return customerNameParts(parent).complete;
}

const NON_NAME_WORDS = new Set([
  'כמה', 'מתי', 'איפה', 'האם', 'למה', 'רוצה', 'רוצים', 'צריך', 'צריכה',
  'חוג', 'חוגים', 'מחיר', 'מחירים', 'שעות', 'הרשמה', 'שלום', 'היי', 'אפשר',
  // A customer answering the name question with a question of their own.
  // «מזה ai?» was filed as a family name, and the card read "יהודה מזה ai".
  'מה', 'מזה', 'זה', 'זהו', 'מי', 'איך', 'אתה', 'את', 'אתם', 'בוט', 'רובוט',
  'ai', 'בינה', 'מלאכותית', 'אדם', 'נציג', 'תודה', 'סליחה', 'רגע', 'כן', 'לא',
]);

/**
 * Words accepted only while answering the explicit name question.
 *
 * The bar is deliberately high: whatever comes back here is written into the
 * customer's card, and a wrong name is read out in every later greeting.
 */
export function customerNameWords(input) {
  const raw = String(input || '').trim();
  // A question is not an answer. Somebody who asks something instead of giving
  // their name is asking, and that message belongs to the model, not the card.
  if (/[?؟]/.test(raw)) return [];
  const cleaned = raw
    .replace(/^(?:קוראים\s+לי|שמי|אני|מדבר(?:ת)?|זה)\s*[:,-]?\s*/u, '')
    .replace(/[^\p{L}\p{M}'׳״\-\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length > 4) return [];
  if (words.some((word) => word.length < 2 || NON_NAME_WORDS.has(word.toLowerCase()))) return [];
  // The question is asked in Hebrew and answered in Hebrew. A Latin word mixed
  // into the answer is a sign it is not a name at all («מזה ai»).
  if (/\p{Script=Hebrew}/u.test(cleaned) && /[A-Za-z]/.test(cleaned)) return [];
  return words;
}

export function parseCustomerFullName(input) {
  const words = customerNameWords(input);
  if (words.length < 2) return null;
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}

/**
 * A name given inside a sentence, rather than as an answer to the question.
 *
 * "היי שמי משה גבאי קבעתי להגיע מחר ב-19" was read as no name at all — the
 * introduction was only recognised at the very start of the message, and even
 * then the whole sentence was handed to the name parser, which rightly refuses
 * anything that long. So the customer was asked their first name, then their
 * surname, having just given both. Here the phrase is found anywhere, and only
 * the words right after it are taken — stopping at the first one that is not a
 * name, which is where the sentence carries on.
 *
 * Only the unmistakable phrasings. "אני" opens half the messages we get
 * ("אני רוצה לרשום את..."), so it counts at the start of a message and nowhere
 * else — that is the narrow case the old rule already covered.
 */
const NAME_PARTICLES = new Set(['בן', 'בת', 'בר', 'אבו', 'דה', 'אל', 'ואן']);

export function introducedName(input) {
  const text = String(input || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const anywhere = /(?:קוראים\s+לי|שמי|השם\s+שלי)\s*[:,-]?\s*/u.exec(text);
  const atStart = /^(?:(?:היי|הי|שלום|בוקר\s+טוב|ערב\s+טוב|אהלן)\s*[,.!]?\s*)?(?:אני|מדבר(?:ת)?|זה)\s*[:,-]?\s*/u.exec(text);
  const match = anywhere || atStart;
  if (!match) return null;

  const rest = text.slice(match.index + match[0].length);
  const words = [];
  for (const word of rest.split(' ')) {
    const clean = word.replace(/[^\p{L}\p{M}'׳״-]/gu, '');
    if (!clean || clean.length < 2) break;
    if (NON_NAME_WORDS.has(clean.toLowerCase())) break;
    if (/\p{Script=Hebrew}/u.test(text) && /[A-Za-z]/.test(clean)) break;
    words.push(clean);
    // Two words is the name; the third belongs to the sentence — "שמי משה
    // גבאי קבעתי להגיע" filed a surname of "גבאי קבעתי". The exception is a
    // surname that genuinely opens with a particle, "רועי בן דוד".
    if (words.length === 2 && !NAME_PARTICLES.has(words[1])) break;
    if (words.length === 3) break;
  }
  if (words.length < 2) return null;
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}

/** Shared by the deterministic intake and the model tool. No other fields. */
export async function updateCustomerFullName(parent, { firstName, lastName } = {}) {
  if (!parent?.id) return { error: 'אין כרטיס לקוח לשמור אליו' };
  const parsed = parseCustomerFullName(`${String(firstName || '').trim()} ${String(lastName || '').trim()}`);
  if (!parsed) return { error: 'נדרשים שם פרטי ושם משפחה' };

  const current = customerNameParts(parent);
  const same = current.complete
    && current.firstName === parsed.firstName
    && current.lastName === parsed.lastName;
  if (same) return { saved: false, parent, name: `${parsed.firstName} ${parsed.lastName}` };
  if (current.complete) return { error: 'בכרטיס כבר קיים שם מלא — שינוי שלו נעשה על ידי הצוות' };

  const updated = db.update('parents', parent.id, {
    name: `${parsed.firstName} ${parsed.lastName}`,
    lastName: parsed.lastName,
  });
  if (!updated) return { error: 'שמירת השם נכשלה' };
  await persistCore('parents', updated);
  return { saved: true, parent: updated, name: updated.name };
}

/**
 * Asking a second time is fair; a third time is a loop the customer cannot get
 * out of. Somebody who answers the name question with something else twice —
 * usually because they are asking us something — gets a person instead.
 */
async function askAgainOrHandOff(phone, prior, question) {
  const attempts = Number(prior.nameAttempts || 0) + 1;
  await setIntake(phone, { ...prior, nameAttempts: attempts });
  if (attempts >= 2) {
    return {
      done: false,
      handoff: true,
      reply: 'רגע — אני מעביר אתכם לצוות שלנו, מישהו יחזור אליכם ממש בקרוב 🙏',
    };
  }
  return { done: false, reply: `סליחה, לא הבנתי 🙂 ${question}` };
}

/**
 * מתאמן קיים שהשם שנאסף זהה לשמו והטלפון שלו טרם הוזן — מועמד לחיבור.
 * רק התאמה יחידה וחד-משמעית מציעה חיבור; כל ספק משאיר את הזרימה הרגילה.
 */
function findLinkableTrainee(phone, leadParent, parsedName) {
  const students = db.get('students') || [];
  // רק ליד טרי בלי מתאמנים משלו — כרטיס עם ילדים הוא משפחה אמיתית.
  if (students.some((s) => s.parentId === leadParent.id)) return null;
  const wanted = `${parsedName.firstName} ${parsedName.lastName}`
    .replace(/\s+/g, ' ').trim().toLowerCase();
  const bucket = normalizeWaPhone(phone);
  const candidates = students.filter((s) => {
    const name = String(s.name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!name || name !== wanted) return false;
    if (s.parentId === leadParent.id) return false;
    // מספר אחר שכבר רשום על המתאמן — כנראה מישהו אחר באותו שם.
    const studentPhone = normalizeWaPhone(s.phone);
    if (studentPhone && studentPhone !== bucket) return false;
    return true;
  });
  if (candidates.length !== 1) return null;
  const student = candidates[0];
  const family = (db.get('parents') || []).find((p) => p.id === student.parentId);
  if (!family || !String(family.name || '').trim()) return null;
  return { student, family };
}

/**
 * סיום איסוף השם: אם השם שייך למתאמן קיים — שואלים שאלת אימות («ההורה שלך
 * זה קרן?») לפני שנפתח תיק חדש. השם לא נשמר על הליד עד ההכרעה, כדי ששער
 * הזהות ימשיך לנתב את התשובה לכאן.
 */
async function completeOrOfferTraineeLink(phone, parent, parsedName, pendingMessage) {
  const link = findLinkableTrainee(phone, parent, parsedName);
  if (link) {
    await setIntake(phone, {
      step: 'trainee_link_confirm',
      pendingFirstName: parsedName.firstName,
      pendingLastName: parsedName.lastName,
      linkStudentId: link.student.id,
      linkFamilyId: link.family.id,
      pendingMessage: pendingMessage || '',
    });
    const familyFirst = String(link.family.name).trim().split(/\s+/)[0];
    return {
      done: false,
      reply: `נעים מאוד ${parsedName.firstName} 🙂 רגע — יש אצלנו מתאמן/ת בדיוק בשם הזה. ההורה שלך זה ${familyFirst}?`,
    };
  }
  const saved = await updateCustomerFullName(parent, parsedName);
  if (saved.error) return { done: false, reply: saved.error };
  await setIntake(phone, { step: 'done', name_capture: true });
  return {
    done: true,
    parent: db.getOne('parents', saved.parent.id) || saved.parent,
    pendingMessage: pendingMessage || '',
  };
}

/** התשובה על «ההורה שלך זה …?» — חיבור לתיק הקיים, או המשך כרגיל. */
async function handleTraineeLinkAnswer(phone, parent, incomingText, prior) {
  const text = String(incomingText || '').trim();
  const parsedName = {
    firstName: String(prior.pendingFirstName || '').trim(),
    lastName: String(prior.pendingLastName || '').trim(),
  };
  // ‎\b אינו מכיר אותיות עבריות — בודקים את המילה הראשונה במפורש.
  const firstWord = (text.split(/\s+/)[0] || '').replace(/[.,!?]+$/u, '');
  const yes = ['כן', 'נכון', 'בטח', 'כמובן', 'אכן', 'יס', 'חיובי'].includes(firstWord);
  const no = ['לא', 'שלילי', 'טעות'].includes(firstWord);

  if (yes) {
    const student = db.getOne('students', prior.linkStudentId);
    const family = db.getOne('parents', prior.linkFamilyId);
    if (student && family) {
      const updatedStudent = db.update('students', student.id, { phone: normalizeWaPhone(phone) });
      if (updatedStudent) await persistCore('students', updatedStudent);
      // הליד שנפתח אוטומטית מיותר עכשיו — ההודעות הבאות ינותבו לתיק המשפחה
      // דרך הטלפון שעל רשומת המתאמן. מוחקים רק כרטיס ריק, ליתר ביטחון.
      const stillEmpty = !(db.get('students') || []).some((s) => s.parentId === parent.id);
      if (parent.id !== family.id && stillEmpty) {
        await db.deleteDurable('parents', parent.id);
      }
      return {
        done: false,
        reply: `מעולה! חיברתי את המספר שלך לתיק של ${student.name} 🙂 מעכשיו אפשר פשוט לכתוב לי כרגיל.`,
      };
    }
    // הרשומות נעלמו בינתיים — ממשיכים כליד רגיל עם השם שנאסף.
  }

  // «לא» (או «כן» שהחיבור שלו נכשל): נשארים ליד חדש, שומרים את השם וממשיכים.
  if (yes || no) {
    const saved = await updateCustomerFullName(parent, parsedName);
    if (saved.error) return { done: false, reply: saved.error };
    await setIntake(phone, { step: 'done', name_capture: true });
    return {
      done: true,
      parent: db.getOne('parents', saved.parent.id) || saved.parent,
      pendingMessage: prior.pendingMessage || '',
    };
  }

  return askAgainOrHandOff(phone, prior, `רק כדי לוודא — ההורה שלך רשום אצלנו? (כן / לא)`);
}

/**
 * Every bot mode has the same deterministic identity gate. It collects only
 * the two name fields, then returns the first customer question so the bot can
 * answer it without making the customer repeat themselves.
 */
export async function advanceCustomerNameCapture(phone, parent, incomingText) {
  const linkPrior = { ...(getIntake(parent) || {}) };
  if (linkPrior.step === 'trainee_link_confirm') {
    return handleTraineeLinkAnswer(phone, parent, incomingText, linkPrior);
  }
  if (hasCustomerFullName(parent)) return { done: true, parent, pendingMessage: '' };

  const text = String(incomingText || '').trim();
  const existing = customerNameParts(parent);
  const prior = { ...(getIntake(parent) || {}) };
  const active = /^tools_parent_/.test(String(prior.step || ''));

  if (!active) {
    const explicit = introducedName(text);
    if (explicit) {
      return completeOrOfferTraineeLink(phone, parent, explicit, '');
    }

    const step = existing.firstName ? 'tools_parent_last_name' : 'tools_parent_first_name';
    await setIntake(phone, {
      step,
      asked: true,
      parentFirstName: existing.firstName,
      pendingMessage: text,
    });
    return {
      done: false,
      // These lines run before the model, so the system prompt cannot set their
      // tone — it has to be written here. Somebody who just said hello is being
      // asked a question, not filling in a form.
      reply: existing.firstName
        ? `היי ${existing.firstName} 🙂 מה שם המשפחה שלך?`
        : 'היי 🙂 מה השם הפרטי שלך?',
    };
  }

  // One field per question. Asking for both in one breath came back as a single
  // line the system then had to split — and a customer who writes "כהן דנה",
  // or a family name of two words, gets filed the wrong way round with nothing
  // to show that it happened. `tools_parent_full_name` is the old step name,
  // still answered here so a conversation caught mid-flow does not restart.
  if (prior.step !== 'tools_parent_last_name') {
    const words = customerNameWords(text);
    if (!words.length) {
      return askAgainOrHandOff(phone, prior, 'מה השם הפרטי שלך?');
    }
    if (words.length === 1) {
      await setIntake(phone, {
        ...prior,
        step: 'tools_parent_last_name',
        parentFirstName: words[0],
      });
      return { done: false, reply: `נעים מאוד ${words[0]} 🙂 ומה שם המשפחה?` };
    }
    // Both names in one answer anyway — nobody is asked to repeat themselves.
    return completeOrOfferTraineeLink(phone, parent, {
      firstName: words[0],
      lastName: words.slice(1).join(' '),
    }, prior.pendingMessage || '');
  }

  const lastWords = customerNameWords(text);
  if (!lastWords.length) return askAgainOrHandOff(phone, prior, 'מה שם המשפחה?');
  const firstName = String(prior.parentFirstName || existing.firstName || '').trim();
  if (!firstName) {
    await setIntake(phone, { ...prior, step: 'tools_parent_first_name' });
    return { done: false, reply: 'היי 🙂 מה השם הפרטי שלך?' };
  }
  return completeOrOfferTraineeLink(phone, parent, {
    firstName,
    lastName: lastWords.join(' '),
  }, prior.pendingMessage || '');
}

/** Clear intake, pause, opt-out and local conversation mirror for playground testing. */
export async function resetPlaygroundConversation(phone) {
  const normalized = normalizeWaPhone(phone) || phone;
  await updateParentsForPhone(normalized, {
    bot_intake: null,
    bot_paused_until: null,
    bot_pause_reason: null,
    bot_opted_out: false,
    bot_opt_out_source: null,
    bot_handoff_at: null,
    bot_outside_hours_date: null,
  });

  const logs = (db.get('whatsapp_logs') || []).filter(
    (l) => !phonesMatch(l.phone || l.to || l.from, normalized)
  );
  db.set('whatsapp_logs', logs);

  const messages = (db.get('messages') || []).filter(
    (m) => !phonesMatch(m.phone || '', normalized)
  );
  db.set('messages', messages);

  return { phone: normalized, cleared: true };
}


/**
 * Decide what the bot should do before generating a normal AI/heuristic reply.
 * @returns {{ action: string, reason?: string, reply?: string, pauseMinutes?: number }}
 */
export function decideBotGate(settings, parent, students, text, { isSimulator = false } = {}) {
  const s = mergeBotSettings(settings);

  // Master switch first: when live auto-reply is off, send nothing at all
  // (including opt-out / handoff / outside-hours templates).
  if (!isSimulator && !isBotEnabled(s)) {
    return { action: 'silence', reason: 'disabled' };
  }

  if (textMatchesKeywords(text, s.aiReactivateKeywords) && isOptedOut(parent)) {
    return { action: 'reactivate', reply: 'הבוט הופעל מחדש. במה אפשר לעזור?' };
  }

  if (isOptedOut(parent)) {
    return { action: 'silence', reason: 'opted_out' };
  }

  if (isMailingPreferenceRequest(text, s.aiStopKeywords)) {
    return { action: 'mailing_preferences' };
  }

  if (isBotPaused(parent) && !isSimulator) {
    return { action: 'silence', reason: 'paused' };
  }

  // Staff already owns this thread (last outbound was human). Timed pause can
  // vanish on restart; the message log is the durable signal.
  if (!isSimulator && s.aiPauseOnHumanReply !== false && shouldDeferToHumanStaff(parent?.phone || '', {
    resumedAt: parent?.bot_resumed_at,
    withinMinutes: s.aiPauseMinutesAfterHuman,
  })) {
    return { action: 'silence', reason: 'human_thread' };
  }

  // Live traffic only: shouldAiAutoReply is false both when the bot is off and
  // when outside hours. Disabled was already handled above; remaining false =
  // outside hours. The playground skips this so a disabled master switch does
  // not look like an hours restriction.
  if (!isSimulator) {
    const inHours = shouldAiAutoReply(s);
    if (!inHours) {
      return {
        action: 'outside_hours',
        reason: 'outside_hours',
        reply: s.aiOutsideHoursMessage,
        sendOnce: true,
      };
    }
  }

  if (!audienceAllows(s, parent, students)) {
    return { action: 'silence', reason: 'audience' };
  }

  // The cap is there to stop a loop, not to stonewall a customer. Silence at
  // this point is indistinguishable from a broken bot — a long conversation
  // simply stopped getting answers, with nothing said and nobody told. It
  // becomes a handoff, and the reply is sent once (`rate_limited` is only
  // reached again after the hour rolls, because the notice itself is a reply).
  if (!isSimulator && isRateLimited(s, parent?.phone || '')) {
    return {
      action: 'handoff',
      reason: 'rate_limited',
      reply: 'רגע — אני מעביר את השיחה לצוות שלנו 🙏\nמישהו יחזור אליכם בהקדם.',
    };
  }

  if (wantsExplicitHumanStaff(text, s)) {
    return {
      action: 'handoff',
      reply: s.aiHandoffAckMessage,
      pauseMinutes: s.aiPauseMinutesAfterHuman || 1,
      explicit: true,
    };
  }

  // There used to be an `intake` action here, for the staged lead capture that
  // asked for a parent name, then a child, then a grade. The only thing still
  // collected before the model is the customer's name, and that runs on its own
  // in handleIncomingMessage — the gate has nothing left to say about it.
  return { action: 'reply' };
}

export { isBotEnabled, shouldAiAutoReply, israelClockParts };
