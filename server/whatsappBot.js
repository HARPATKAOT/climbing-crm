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

/** Legacy gym name still present in older prompts / defaults. */
export const LEGACY_BRAND_NAME = 'My Wall';
const LEGACY_BRAND_RE = /My Wall/gi;

export const DEFAULT_BOT_SETTINGS = {
  aiOutsideHoursMessage:
    'קיבלנו את ההודעה 🙏\nאנחנו מחוץ לשעות המענה כרגע.\nנחזור אליכם בבוקר בין 9:00 ל־21:00.',
  aiHandoffKeywords: 'אדם,נציג,צוות,תלונה,מנהל,דחוף,לדבר עם',
  aiHandoffAckMessage: `מעבירים אתכם לצוות ${LEGACY_BRAND_NAME} 🧗\nמישהו יחזור אליכם בהקדם.`,
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
    'שאלות נפוצות:\n- חניה: יש חניה בחזית הקיר.\n- גיל מינימום לחוג ילדים: לפי כיתה בקבוצות במערכת.\n- ציוד: נעלי טיפוס להשכרה במקום.\n- ביטול אימון: לעדכן את הצוות מראש בוואטסאפ.',
  aiForbiddenTopics:
    'אל תציין מחירים או סכומים.\nאל תבטיח הנחות.\nאל תיתן ייעוץ רפואי.\nאל תשתף פרטי לקוחות אחרים.',
  aiBusinessFacts:
    'כתובת: רחוב האורגים 12, אשדוד\nשעות: א׳–ה׳ 14:00–22:00 | שישי 09:00–15:00 | שבת סגור\nהצהרת בריאות: https://client-omega-topaz-35.vercel.app/health',
  aiEscalateWhenUnsure: true,
  aiUnsureReply: 'רגע — כדי לא לטעות אני מעביר את זה לצוות 🙏\nמישהו יחזור אליכם עם תשובה מדויקת.',
  aiLeadCaptureEnabled: true,
  aiInteractiveMenuEnabled: true,
  aiGreetingMenu:
    `היי! אני הבוט של ${LEGACY_BRAND_NAME} 🧗\n\nבמה אפשר לעזור?\n1️⃣ הצהרת בריאות ✍️\n2️⃣ חוגים ורישום 🤸\n3️⃣ שעות ומיקום 🗺️\n4️⃣ לדבר עם צוות 👤\n\nכתבו מספר או שאלה קצרה 😊`,
  aiReactivateKeywords: 'הפעל בוט,הפעל,activate',
};

const BRANDED_TEXT_KEYS = [
  'aiSystemPrompt',
  'aiHandoffAckMessage',
  'aiGreetingMenu',
  'aiOutsideHoursMessage',
  'aiBusinessFacts',
  'aiKnowledgeBase',
  'aiUnsureReply',
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
  const priceBan = 'כלל קשיח: אל תציין מחירים או סכומים. על מחיר — הפנה לצוות בלבד.';
  if (!prompt.includes('אל תציין מחירים')) {
    branded.aiSystemPrompt = prompt ? `${prompt}\n\n${priceBan}` : priceBan;
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

export function normalizeMenuChoice(text) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  if (/^[1-4]$/.test(raw)) return raw;
  const numbered = lower.match(/^(?:אופציה|אפשרות|מספר)?\s*([1-4])\b/);
  if (numbered) return numbered[1];

  if (/הצהר|בריאות|טופס|חתמ/.test(raw)) return '1';
  if (/חוג|רישום|אימון|כית/.test(raw) && !/שע|מיקום|כתובת|מחיר|עלות|כסף|שקל/.test(raw)) return '2';
  if (/שע|מיקום|כתובת|פתוח|הגע/.test(raw)) return '3';
  if (/צוות|אדם|נציג|לדבר עם/.test(raw)) return '4';

  // Interactive list / button titles
  if (/הצהרת בריאות/.test(raw)) return '1';
  if (/חוגים ורישום|חוגים ומחירים|חוגים/.test(raw)) return '2';
  if (/שעות ומיקום/.test(raw)) return '3';
  if (/לדבר עם צוות|עם צוות/.test(raw)) return '4';
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

export async function pauseBotForPhone(phone, minutes, { reason = 'human_reply' } = {}) {
  const mins = Math.max(1, Number(minutes) || 120);
  const until = new Date(Date.now() + mins * 60 * 1000).toISOString();
  const patch = { bot_paused_until: until };
  if (reason === 'handoff') patch.bot_handoff_at = new Date().toISOString();
  const updated = await updateParentsForPhone(phone, patch);
  return { until, updated };
}

export async function clearBotPause(phone) {
  return updateParentsForPhone(phone, {
    bot_paused_until: null,
    bot_handoff_at: null,
  });
}

export async function optOutPhone(phone, optedOut = true) {
  return updateParentsForPhone(phone, {
    bot_opted_out: !!optedOut,
    bot_paused_until: optedOut ? null : undefined,
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
    '## כללי ביטחון',
    'אם אינך בטוח בתשובה — השב בדיוק בשורה הראשונה: UNSURE',
    'ואז משפט קצר ללקוח. אל תנחש זמנים.',
    'אסור לציין מחירים או סכומים — על מחיר הפנה לצוות.'
  );
  return parts.join('\n');
}

export function parseAiReply(rawText, settings = {}) {
  const s = mergeBotSettings(settings);
  let text = String(rawText || '').trim();
  let unsure = false;
  if (/^UNSURE\b/i.test(text)) {
    unsure = true;
    text = text.replace(/^UNSURE\b[:\-\s]*/i, '').trim();
  }
  if (!text && unsure) text = s.aiUnsureReply;
  return { text: clipReply(text, s.aiMaxReplyChars), unsure };
}

export function detectUnsureHeuristic(text) {
  const t = String(text || '');
  return /לא בטוח|אינני בטוח|לא יודע|אין לי מידע|אעביר לצוות|צריך לבדוק/.test(t);
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
  if (choice === '2') return true;
  const raw = String(incomingText || '');
  if (/רישום|להירשם|רוצה להצטרף|תיאום אימון/.test(raw)) return true;
  return false;
}

export async function advanceLeadCapture(phone, parent, incomingText, helpers = {}) {
  const text = String(incomingText || '').trim();
  const intake = { ...(getIntake(parent) || {}) };
  const step = intake.step || 'parent_name';

  if (step === 'parent_name') {
    if (!intake.asked) {
      await setIntake(phone, { step: 'parent_name', asked: true });
      return { reply: 'מעולה! איך קוראים להורה שפונה? (שם מלא)', done: false, started: true };
    }
    if (text.length < 2) return { reply: 'רשמו בבקשה את שם ההורה.', done: false };
    intake.parentName = text;
    intake.step = 'child_name';
    intake.asked = true;
    await setIntake(phone, intake);
    const matches = parentsForPhone(phone);
    for (const m of matches) {
      const row = db.update('parents', m.id, { name: text });
      if (row) await persistCore('parents', row);
    }
    return { reply: 'תודה! ומה שם הילד/ה?', done: false };
  }

  if (step === 'child_name') {
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
      ? `${summary}\n\n${classesHint}\n\nרוצים שנקבע אימון היכרות? אפשר גם לכתוב 4 לדבר עם צוות.`
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

  // The playground must remain usable while live automatic replies are disabled.
  // Simulator replies are recorded locally and never sent through Meta.
  if (!isSimulator && !isBotEnabled(s)) {
    return { action: 'silence', reason: 'disabled' };
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

  if (textMatchesKeywords(text, s.aiHandoffKeywords) || normalizeMenuChoice(text) === '4') {
    return {
      action: 'handoff',
      reply: s.aiHandoffAckMessage,
      pauseMinutes: s.aiPauseMinutesAfterHuman || 120,
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
              { id: 'menu_1', title: 'הצהרת בריאות', description: 'קישור לחתימה' },
              { id: 'menu_2', title: 'חוגים ורישום', description: 'זמנים ומקומות' },
              { id: 'menu_3', title: 'שעות ומיקום', description: 'כתובת ושעות' },
              { id: 'menu_4', title: 'לדבר עם צוות', description: 'העברה לנציג' },
            ],
          },
        ],
      },
    },
  };
}

export { isBotEnabled, shouldAiAutoReply, israelClockParts };
