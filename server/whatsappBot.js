import { db, persistCore } from './db.js';
import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';
import { israelClockParts, isBotEnabled, shouldAiAutoReply } from './whatsappSchedule.js';
import { recordMessage } from './channels/messageStore.js';
import { DEFAULT_BUSINESS_PROFILE, getBusinessProfile } from './businessProfile.js';

export const LEAD_STATUSES = new Set(['lead_new', 'health_signed', 'waitlist']);
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

/** Prices are allowed, invented prices are not. Stamped onto every system prompt. */
export const PRICE_SOURCE_RULE =
  'כלל קשיח: מסור רק מחירים שמופיעים בנתוני המערכת — מחיר הקבוצה, מחירי הציוד ודמי ההעשרה. '
  + 'כל שאלת תשלום אחרת (מנוי, כרטיסייה, יום הולדת, הנחה, החזר, חשבונית, שכר) — הפנה לצוות בלי לנקוב בסכום.';

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

export const DEFAULT_BOT_SETTINGS = {
  aiOutsideHoursMessage:
    'קיבלנו את ההודעה 🙏\nאנחנו מחוץ לשעות המענה כרגע.\nנחזור אליכם בבוקר בין 9:00 ל־21:00.',
  // Explicit human ask / hard topics only — bare «צוות» must not match «בצוות».
  aiHandoffKeywords:
    'אדם,נציג,תלונה,מנהל,דחוף,לדבר עם,ביטול,לבטל,החזר,זיכוי,חשבונית,פציעה,נפצע,כאב',
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
  aiEscalateWhenUnsure: true,
  // First unclear turn — ask to rephrase. Second unclear turn uses aiUnsureReply + handoff.
  aiClarifyReply: 'לא הבנתי 🙏\nיכולים להסביר קצת יותר? במה אפשר לעזור?',
  aiUnsureReply: 'רגע — כדי לא לטעות אני מעביר את זה לצוות 🙏\nמישהו יחזור אליכם עם תשובה מדויקת.',
  aiLeadCaptureEnabled: true,
  aiInteractiveMenuEnabled: true,
  // Health declaration is sent by staff when registering — not an opening-menu item.
  aiGreetingMenu:
    `היי! אני הבוט של ${BRAND_NAME} 🧗\n\nבמה אפשר לעזור?\n1️⃣ חוגים, מחירים ורישום 🤸\n2️⃣ שעות פתיחה ומיקום 🗺️\n3️⃣ לדבר עם צוות 👤\n4️⃣ אירועים וטיולים 🎒\n\nכתבו מספר או שאלה קצרה 😊`,
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
  if (/^(?:client|whatsapp\s*customer)\b/i.test(name)) return false;
  return true;
}

/** First name only — never greet with the family name. */
export function parentFirstName(parent) {
  const name = String(parent?.name || '').trim();
  if (!name || !isIdentifiedParent(parent)) return '';
  return name.split(/\s+/)[0];
}

export function knownParentGreeting(parent) {
  const first = parentFirstName(parent);
  return first
    ? `בסדר גמור 🙂\nמה נשמע ${first}?`
    : 'בסדר גמור 🙂\nמה נשמע?';
}

/**
 * When the model is down, never spam the same greeting on a real message.
 * Greeting template only for low-intent hellos; otherwise ask to rephrase.
 */
export function resolveIdentifiedParentFallback(parent, incomingText, settings = {}) {
  if (isLowIntentGreeting(incomingText)) {
    return { text: knownParentGreeting(parent), skipMenu: true };
  }
  const clarify = String(settings?.aiClarifyReply || DEFAULT_BOT_SETTINGS.aiClarifyReply || '').trim();
  return {
    text: clarify || 'לא הצלחתי לענות על זה רגע 🙏\nאפשר לנסח שוב, או לכתוב 3 לשיחה עם הצוות.',
    skipMenu: true,
  };
}

/** Pull visible answer text from a Gemini generateContent payload. */
export function extractGeminiResponseText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || !parts.length) return '';
  const visible = parts
    .filter((part) => part && typeof part.text === 'string' && !part.thought)
    .map((part) => part.text.trim())
    .filter(Boolean);
  if (visible.length) return visible.join('\n').trim();
  return parts
    .map((part) => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Build multi-turn contents for Gemini. History may already include the
 * current inbound message (recorded before the bot answers).
 */
export function buildGeminiChatContents(history = [], incomingText = '') {
  const contents = [];
  for (const message of history || []) {
    const role = (message?.role === 'assistant' || message?.role === 'model') ? 'model' : 'user';
    const text = String(message?.content || '').trim();
    if (!text) continue;
    if (contents.length && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }
  const incoming = String(incomingText || '').trim();
  if (incoming) {
    const last = contents[contents.length - 1];
    if (!(last?.role === 'user' && last.parts[0].text === incoming)) {
      if (last?.role === 'user') last.parts[0].text += `\n${incoming}`;
      else contents.push({ role: 'user', parts: [{ text: incoming }] });
    }
  }
  if (contents.length && contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '.' }] });
  }
  return contents;
}

export function isLowIntentGreeting(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 50) return false;
  if (!/(?:היי+|הי+|שלום|\bhey\b|\bhi\b|\bhello\b|מה\s*קורה|מה\s*נשמע|בוקר\s*טוב|ערב\s*טוב|צהריים\s*טובים)/i.test(t)) {
    return false;
  }
  // After stripping greetings + punctuation, nothing of substance may remain.
  // Allows "היי, מה קורה ?" / "שלום מה נשמע".
  const leftover = t
    .replace(/מה\s*קורה/gi, ' ')
    .replace(/מה\s*נשמע/gi, ' ')
    .replace(/בוקר\s*טוב/gi, ' ')
    .replace(/ערב\s*טוב/gi, ' ')
    .replace(/צהריים\s*טובים/gi, ' ')
    .replace(/\bhello\b/gi, ' ')
    .replace(/\bhey\b/gi, ' ')
    .replace(/\bhi\b/gi, ' ')
    .replace(/שלום/gi, ' ')
    .replace(/היי+/gi, ' ')
    .replace(/הי+/gi, ' ')
    .replace(/[\s,!?.׃…]+/g, '');
  return leftover.length === 0;
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
  // reaches the customer as a promise the gym has to honour.
  const priceRule = PRICE_SOURCE_RULE;
  if (!prompt.includes('רק מחירים שמופיעים בנתוני המערכת')) {
    branded.aiSystemPrompt = prompt ? `${prompt}\n\n${priceRule}` : priceRule;
  }
  // Drop the retired health-declaration row from menus saved before this change.
  const menu = String(branded.aiGreetingMenu || '');
  if (/1️⃣\s*הצהרת\s*בריאות|1\s*[).:]\s*הצהרת\s*בריאות/.test(menu)) {
    branded.aiGreetingMenu = String(DEFAULT_BOT_SETTINGS.aiGreetingMenu).replace(
      new RegExp(String(BRAND_NAME).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      brand
    );
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

/** Explicit request for a human / hard topics — not «בצוות» in an info question. */
export function wantsExplicitHumanStaff(text, settings = {}) {
  if (normalizeMenuChoice(text) === '3') return true;
  const t = String(text || '');
  if (/(?:לדבר עם|רוצה(?:\s+לדבר)?(?:\s+עם)?)\s*(?:את\s*)?(?:ה)?(?:צוות|נציג|אדם)/.test(t)) {
    return true;
  }
  const s = mergeBotSettings(settings);
  return textMatchesKeywords(t, s.aiHandoffKeywords);
}

export function clipReply(text, maxChars = 700) {
  const body = String(text || '').trim();
  const limit = Number(maxChars) > 0 ? Number(maxChars) : 700;
  if (body.length <= limit) return body;
  return `${body.slice(0, Math.max(0, limit - 1)).trim()}…`;
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
export function normalizeMenuChoice(text) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  if (/^[1-4]$/.test(raw)) return raw;
  const numbered = lower.match(/^(?:אופציה|אפשרות|מספר)?\s*([1-4])\b/);
  if (numbered) return numbered[1];

  if (/הצהר|בריאות|טופס|חתמ/.test(raw)) return 'health';
  if (/טיול|אירוע|קייטנ/.test(raw)) return '4';
  if (/חוג|רישום|אימון|כית/.test(raw) && !/שע|מיקום|כתובת|מחיר|עלות|כסף|שקל/.test(raw)) return '1';
  if (/שע|מיקום|כתובת|פתוח|הגע/.test(raw)) return '2';
  // Explicit ask for a human — not «בצוות» inside an info question.
  if (/(?:לדבר עם|רוצה(?:\s+לדבר)?(?:\s+עם)?)\s*(?:את\s*)?(?:ה)?(?:צוות|נציג|אדם)|(?:^|\s)(?:נציג|אדם)(?:\s|$|[?؟])/.test(raw)) {
    return '3';
  }

  // Interactive list / button titles
  if (/הצהרת בריאות/.test(raw)) return 'health';
  if (/חוגים ורישום|חוגים ומחירים|חוגים/.test(raw)) return '1';
  if (/שעות ומיקום|שעות פתיחה ומיקום/.test(raw)) return '2';
  if (/לדבר עם צוות|עם צוות/.test(raw)) return '3';
  if (/אירועים וטיולים/.test(raw)) return '4';
  return null;
}

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

export function studentsForParent(parent) {
  if (!parent?.id) return [];
  return (db.get('students') || []).filter((s) => s.parentId === parent.id);
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
  // crm / phone / empty source on a non-AI outbound = staff
  return true;
}

/**
 * If staff already wrote to this customer, the next inbound belongs to that
 * human thread — the bot must not jump in (even if the timed pause was lost
 * after a server restart).
 */
export function shouldDeferToHumanStaff(phone) {
  const normalized = normalizeWaPhone(phone) || phone;
  if (!normalized) return false;
  const logs = (db.get('whatsapp_logs') || [])
    .filter((l) => (l.channel || 'whatsapp') === 'whatsapp'
      && phonesMatch(l.phone || l.to || l.from, normalized))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  for (const log of logs) {
    if (log.direction === 'inbound') continue;
    if (log.direction === 'outbound') return isHumanOutboundLog(log);
  }
  return false;
}

/**
 * What the bot will do for this customer right now, in a shape the CRM can
 * render. `until` is the authority on a pause — `minutesLeft` is a snapshot
 * that goes stale the moment it leaves the server.
 */
export function describeBotState(parent, settings = {}, now = new Date()) {
  const globallyOff = !isBotEnabled(mergeBotSettings(settings));

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

  return {
    status: 'active',
    source: null,
    until: null,
    minutesLeft: null,
    reason: null,
    globallyOff,
  };
}

export async function pauseBotForPhone(phone, minutes, { reason = 'human_reply' } = {}) {
  const mins = Math.max(1, Number(minutes) || 120);
  const until = new Date(Date.now() + mins * 60 * 1000).toISOString();
  const patch = { bot_paused_until: until, bot_pause_reason: reason };
  if (reason === 'handoff') patch.bot_handoff_at = new Date().toISOString();
  const updated = await updateParentsForPhone(phone, patch);
  return { until, updated };
}

export async function clearBotPause(phone) {
  return updateParentsForPhone(phone, {
    bot_paused_until: null,
    bot_pause_reason: null,
    bot_handoff_at: null,
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

/** Recent turns of this conversation in the shape the CRM agent expects. */
export function getChatHistoryMessages(phone, limit = 6) {
  const n = Math.max(0, Math.min(20, Number(limit) || 6));
  const logs = db.get('whatsapp_logs') || [];
  return logs
    .filter((l) => (l.channel || 'whatsapp') === 'whatsapp' && phonesMatch(l.phone || l.to || l.from, phone))
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .slice(-n)
    .map((l) => ({
      role: l.direction === 'inbound' ? 'user' : 'assistant',
      content: String(l.message || '').slice(0, 1000),
    }))
    .filter((m) => m.content);
}

export function getConversationHistory(phone, limit = 8) {
  const n = Math.max(0, Math.min(30, Number(limit) || 8));
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

export function buildParentCardContext(parent, students = []) {
  if (!parent) return 'אין כרטיס לקוח.';
  const groups = db.get('groups') || [];
  const lines = [
    `הורה: ${parent.name || 'ללא שם'} | טלפון: ${parent.phone || ''} | סטטוס הורה: ${parent.status || '—'}`,
  ];
  // The model was given the full name and still opened with a nameless "היי".
  // Handing it the first name as its own labelled line is what the greeting
  // rule in BOT_BOUNDS_RULES points at.
  const firstName = parentFirstName(parent);
  if (firstName) lines.push(`שם פרטי לפנייה: ${firstName}`);
  if (!students.length) {
    lines.push('אין מתאמנים מקושרים.');
  } else {
    for (const s of students) {
      const group = groups.find((g) => g.id === s.groupId);
      lines.push(
        `מתאמן: ${s.name || '—'} | סטטוס: ${s.status || '—'} | קבוצה: ${group?.name || 'ללא'} | כיתה/גיל: ${group?.ageCategory || s.birthDate || '—'}`
      );
    }
  }
  if (parent.bot_intake?.step) {
    lines.push(`איסוף ליד פעיל: שלב ${parent.bot_intake.step}`);
  }
  return lines.join('\n');
}

export function buildAiExtraContext(settings, phone, parent, students) {
  const s = mergeBotSettings(settings);
  const brand = s.brandName || DEFAULT_BUSINESS_PROFILE.display_name;
  const history = getConversationHistory(phone, s.aiHistoryCount);
  const parts = [
    '## שם העסק',
    brand,
    'השתמש רק בשם הזה כשאתה מזכיר את העסק.',
    '',
    '## פרטי עסק',
    s.aiBusinessFacts || '',
    '',
    '## בסיס ידע / שאלות נפוצות',
    s.aiKnowledgeBase || '',
    '',
    '## נושאים אסורים',
    s.aiForbiddenTopics || '',
    '',
    '## כרטיס לקוח',
    buildParentCardContext(parent, students),
  ];
  if (history.length) {
    parts.push('', '## היסטוריית שיחה אחרונה', history.join('\n'));
  }
  parts.push(
    '',
    BOT_BOUNDS_RULES,
    '',
    PRICE_SOURCE_RULE,
  );
  return parts.join('\n');
}

export function parseAiReply(rawText, settings = {}) {
  const s = mergeBotSettings(settings);
  let text = String(rawText || '').trim();
  let unsure = false;
  let handoff = false;
  if (/^HANDOFF\b/i.test(text)) {
    handoff = true;
    text = text.replace(/^HANDOFF\b[:\-\s]*/i, '').trim();
  }
  if (/^UNSURE\b/i.test(text)) {
    unsure = true;
    text = text.replace(/^UNSURE\b[:\-\s]*/i, '').trim();
  }
  if (!text && unsure) text = s.aiClarifyReply || s.aiUnsureReply;
  if (!text && handoff) text = s.aiHandoffAckMessage;
  return { text: clipReply(text, s.aiMaxReplyChars), unsure, handoff };
}

/** Model already wrote a natural “I don’t know — transferring” reply. */
export function detectNaturalHandoff(text) {
  const t = String(text || '');
  if (/(?:לא יודע|אין לי(?:\s+את)?(?:\s+ה)?(?:מידע|פרט)|לא מופיע אצלי)/.test(t)
    && /(?:מעביר|אעביר|לצוות|נציג)/.test(t)) {
    return true;
  }
  return false;
}

export function detectUnsureHeuristic(text) {
  const t = String(text || '');
  // Natural handoff sentences are not “unsure clarify” — keep the model’s wording.
  if (detectNaturalHandoff(t)) return false;
  return /לא בטוח|אינני בטוח|אין לי מידע|צריך לבדוק/.test(t);
}

/** True when this outbound text is our “didn’t understand” ask. */
export function isClarifyReplyText(text, settings = {}) {
  const t = String(text || '');
  if (/לא\s*הבנתי/.test(t)) return true;
  const s = mergeBotSettings(settings);
  const clarify = String(s.aiClarifyReply || '').trim();
  if (!clarify) return false;
  const needle = clarify.split(/\n/)[0].trim().slice(0, 24);
  return needle.length >= 4 && t.includes(needle);
}

/**
 * Gibberish / keyboard mash — not a real question.
 * Used so we only escalate after clarify when the follow-up is still noise.
 */
export function looksLikeLowSignalMessage(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  const compact = t.replace(/[\s\p{P}\p{S}0-9]+/gu, '');
  if (compact.length <= 2) return true;
  if (/^[a-zA-Z]+$/.test(compact) && compact.length <= 12) return true;
  // Real Hebrew intent / business words → not noise.
  if (/(?:מה|מי|איך|למה|כמה|מתי|איפה|האם|יש|רוצה|צריך|אפשר|קיר|טיפוס|חוג|כית|מחיר|שעה|רישום|מקום|פתוח|כתובת|חניה|אירוע|יום|ילד|ילדה|\bבן\b|\bבת\b|שלום|היי|תודה)/.test(t)) {
    return false;
  }
  if (/[?？]/.test(t)) return false;
  // Short single token with no intent words (e.g. לחנלח / vhh).
  if (!/\s/.test(t) && compact.length <= 8) return true;
  return false;
}

/** “Is this a climbing wall?” / “what is this place?” */
export function asksAboutBusinessIdentity(text) {
  const t = String(text || '');
  if (/קיר\s*טיפוס|טיפוס\s*קיר/.test(t)) return true;
  if (/(?:מה\s*זה(?:\s*המקום)?|איזה\s*מקום|מי\s*אתם|מה\s*אתם|זה\s*הקיר|אתם\s*(?:קיר|טיפוס)|זה\s*קיר)/.test(t)) {
    return true;
  }
  return /climbing\s*wall|bouldering/i.test(t);
}

export function formatBusinessIdentityReply(settings = {}) {
  const s = mergeBotSettings(settings);
  const brand = s.brandName || DEFAULT_BUSINESS_PROFILE.display_name;
  return (
    `כן! 🙂 אנחנו קיר הטיפוס ${brand}.\n`
    + 'יש חוגים לילדים, אימונים ואירועים על הקיר.\n'
    + 'במה אפשר לעזור?'
  );
}

/**
 * Last bot turn (before the current inbound already in the log) asked for clarification.
 */
export function recentlyAskedClarify(phone, settings = {}, historyLimit = 8) {
  if (!phone) return false;
  const history = getConversationHistory(phone, historyLimit);
  let i = history.length - 1;
  while (i >= 0 && history[i].startsWith('לקוח:')) i -= 1;
  if (i < 0 || !history[i].startsWith('בוט:')) return false;
  return isClarifyReplyText(history[i].slice('בוט:'.length).trim(), settings);
}

/**
 * Unsure once → ask to rephrase.
 * Unsure again only hands off when the new message is still gibberish.
 * A real follow-up question stays in the chat (ask again / let heuristics answer).
 */
export function resolveUnsureReply(phone, settings = {}, { incomingText = '' } = {}) {
  const s = mergeBotSettings(settings);
  const clarifyText = s.aiClarifyReply
    || 'לא הבנתי 🙏\nיכולים להסביר קצת יותר? במה אפשר לעזור?';
  const handoffText = s.aiUnsureReply || s.aiHandoffAckMessage;

  if (!s.aiEscalateWhenUnsure) {
    return { text: clarifyText, handoff: false, unsure: true, clarify: true };
  }
  if (recentlyAskedClarify(phone, s) && looksLikeLowSignalMessage(incomingText)) {
    return { text: handoffText, handoff: true, unsure: true, clarify: false };
  }
  return { text: clarifyText, handoff: false, unsure: true, clarify: true };
}

/** Lead intake state machine */
export function getIntake(parent) {
  return parent?.bot_intake && typeof parent.bot_intake === 'object' ? parent.bot_intake : null;
}

export async function setIntake(phone, intake) {
  return updateParentsForPhone(phone, { bot_intake: intake });
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

export function shouldStartLeadCapture(settings, parent, students, incomingText, { isNew } = {}) {
  const s = mergeBotSettings(settings);
  if (!s.aiLeadCaptureEnabled) return false;
  if (getIntake(parent)?.step && getIntake(parent).step !== 'done') return false;
  const choice = normalizeMenuChoice(incomingText);
  if (choice === '1') return true;
  const raw = String(incomingText || '');
  if (/רישום|להירשם|רוצה להצטרף|תיאום אימון/.test(raw)) return true;
  // Unknown writer: collect name before anything else (including the menu).
  if (!isIdentifiedParent(parent) && (isNew || isLowIntentGreeting(raw))) return true;
  return false;
}

export async function advanceLeadCapture(phone, parent, incomingText, helpers = {}) {
  const text = String(incomingText || '').trim();
  let intake = { ...(getIntake(parent) || {}) };
  // Migrate the old single full-name step if a conversation was mid-flow.
  if (intake.step === 'parent_name') {
    intake = { ...intake, step: isIdentifiedParent(parent) ? 'interest' : 'parent_first_name', asked: false };
  }
  // Known parent who picked classes — skip straight to the child.
  if (!intake.step || intake.step === 'parent_first_name') {
    if (isIdentifiedParent(parent) && normalizeMenuChoice(text) === '1') {
      intake = { step: 'child_name', asked: false, parentName: parent.name };
    }
  }
  const step = intake.step || 'parent_first_name';

  if (step === 'parent_first_name') {
    if (!intake.asked) {
      await setIntake(phone, { step: 'parent_first_name', asked: true });
      return { reply: 'שמחים שפניתם! 🙂\nמה השם הפרטי שלך?', done: false, started: true };
    }
    if (text.length < 2) return { reply: 'רשמו בבקשה את השם הפרטי.', done: false };
    intake.parentFirstName = text.split(/\s+/)[0];
    intake.step = 'parent_last_name';
    intake.asked = true;
    await setIntake(phone, intake);
    const matches = parentsForPhone(phone);
    for (const m of matches) {
      const row = db.update('parents', m.id, { name: intake.parentFirstName });
      if (row) await persistCore('parents', row);
    }
    return { reply: 'תודה! ומה שם המשפחה?', done: false };
  }

  if (step === 'parent_last_name') {
    if (text.length < 2) return { reply: 'רשמו בבקשה את שם המשפחה.', done: false };
    intake.parentLastName = text.split(/\s+/)[0];
    const fullName = [intake.parentFirstName, intake.parentLastName].filter(Boolean).join(' ');
    intake.parentName = fullName;
    intake.step = 'interest';
    intake.asked = true;
    await setIntake(phone, intake);
    const matches = parentsForPhone(phone);
    for (const m of matches) {
      const row = db.update('parents', m.id, { name: fullName, lastName: intake.parentLastName });
      if (row) await persistCore('parents', row);
    }
    return { reply: 'מעולה. במה אתם מתעניינים? (חוגים, שעות, אירועים או משהו אחר)', done: false };
  }

  if (step === 'interest') {
    if (!intake.asked) {
      await setIntake(phone, { ...intake, step: 'interest', asked: true });
      return { reply: 'במה אתם מתעניינים? (חוגים, שעות, אירועים או משהו אחר)', done: false };
    }
    intake.interest = text || '';
    const choice = normalizeMenuChoice(text);
    // Classes interest → continue gathering the child / grade.
    if (choice === '1' || /חוג|רישום|אימון|כית/.test(text)) {
      intake.step = 'child_name';
      intake.asked = true;
      await setIntake(phone, intake);
      return { reply: 'מעולה! ומה שם הילד/ה?', done: false };
    }
    intake.step = 'done';
    await setIntake(phone, intake);
    const s = mergeBotSettings(helpers.settings || {});
    const menu = s.aiGreetingMenu || DEFAULT_BOT_SETTINGS.aiGreetingMenu;
    return {
      reply: `תודה${intake.parentFirstName ? ` ${intake.parentFirstName}` : ''}!\n\n${menu}`,
      done: true,
      intake,
    };
  }

  if (step === 'child_name') {
    if (!intake.asked) {
      await setIntake(phone, { ...intake, step: 'child_name', asked: true });
      return { reply: 'מעולה! ומה שם הילד/ה?', done: false };
    }
    if (text.length < 2) return { reply: 'רשמו בבקשה את שם הילד/ה.', done: false };
    intake.childName = text;
    intake.step = 'grade';
    await setIntake(phone, intake);
    const matches = parentsForPhone(phone);
    for (const m of matches) {
      const students = studentsForParent(m);
      if (students[0]) {
        const row = db.update('students', students[0].id, { name: text });
        if (row) await persistCore('students', row);
      } else if (typeof helpers.ensureStudent === 'function') {
        await helpers.ensureStudent(m.id, text);
      } else {
        const created = db.insert('students', {
          name: text,
          parentId: m.id,
          status: 'lead_new',
          source: 'whatsapp',
        });
        await persistCore('students', created);
      }
    }
    return { reply: 'מעולה. באיזו כיתה הילד/ה? (לדוגמה: ג׳)', done: false };
  }

  if (step === 'grade') {
    if (text.length < 1) return { reply: 'רשמו בבקשה את הכיתה (א׳–ו׳ או אחר).', done: false };
    intake.grade = text;
    intake.step = 'preferred_day';
    await setIntake(phone, intake);
    return { reply: 'תודה! איזה יום נוח לכם לאימון? (א׳–ו׳ / גמיש)', done: false };
  }

  if (step === 'preferred_day') {
    intake.preferredDay = text || 'גמיש';
    intake.step = 'done';
    await setIntake(phone, intake);
    const grade = intake.grade || '';
    const summary = `נרשם אצלנו:\nהורה: ${intake.parentName || parent?.name || ''}\nילד/ה: ${intake.childName || ''}\nכיתה: ${grade}\nיום מועדף: ${intake.preferredDay}`;
    let classesHint = '';
    if (typeof helpers.formatClassesForGrade === 'function') {
      classesHint = helpers.formatClassesForGrade(grade) || '';
    }
    let waitlistNote = '';
    if (typeof helpers.assignWaitlistIfFull === 'function') {
      waitlistNote = (await helpers.assignWaitlistIfFull(phone, parent, intake)) || '';
    }
    let reply = classesHint
      ? `${summary}\n\n${classesHint}\n\nרוצים שנקבע אימון היכרות? אפשר גם לכתוב 3 לדבר עם צוות.`
      : `${summary}\n\nצוות יחזור אליכם לתיאום אימון היכרות 🧗`;
    if (waitlistNote) {
      reply = `${summary}\n\n${waitlistNote}`;
    }
    return { reply, done: true, intake };
  }

  return { reply: null, done: true };
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

  if (textMatchesKeywords(text, s.aiStopKeywords)) {
    return { action: 'opt_out', reply: s.aiOptOutMessage };
  }

  if (isBotPaused(parent) && !isSimulator) {
    return { action: 'silence', reason: 'paused' };
  }

  // Staff already owns this thread (last outbound was human). Timed pause can
  // vanish on restart; the message log is the durable signal.
  if (!isSimulator && s.aiPauseOnHumanReply !== false && shouldDeferToHumanStaff(parent?.phone || '')) {
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

  if (!isSimulator && isRateLimited(s, parent?.phone || '')) {
    return { action: 'silence', reason: 'rate_limited' };
  }

  if (wantsExplicitHumanStaff(text, s)) {
    return {
      action: 'handoff',
      reply: s.aiHandoffAckMessage,
      pauseMinutes: s.aiPauseMinutesAfterHuman || 120,
      explicit: true,
    };
  }

  if (getIntake(parent)?.step && getIntake(parent).step !== 'done') {
    return { action: 'intake' };
  }

  return { action: 'reply' };
}

export function interactiveMenuPayload(settings) {
  const s = mergeBotSettings(settings);
  const body = (s.aiGreetingMenu || DEFAULT_BOT_SETTINGS.aiGreetingMenu).split('\n').slice(0, 4).join('\n')
    || 'היי! במה אפשר לעזור?';
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clipReply(body, 900) },
      action: {
        button: 'בחרו אפשרות',
        sections: [
          {
            title: 'תפריט',
            rows: [
              { id: 'menu_1', title: 'חוגים ורישום', description: 'זמנים, מקומות ומחיר' },
              { id: 'menu_2', title: 'שעות ומיקום', description: 'כתובת ושעות פתיחה' },
              { id: 'menu_3', title: 'לדבר עם צוות', description: 'העברה לנציג' },
              { id: 'menu_4', title: 'אירועים וטיולים', description: 'מה קרוב וקישור הרשמה' },
            ],
          },
        ],
      },
    },
  };
}

export { isBotEnabled, shouldAiAutoReply, israelClockParts };
