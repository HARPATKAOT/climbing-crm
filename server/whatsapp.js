import { db, persistCore, syncBotFlagFromRemote } from './db.js';
import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';
import { buildTemplateParameters } from './channels/templates.js';
import { encodeMediaRef, metaFromMediaRef } from './channels/mediaRef.js';
import {
  recordMessage,
  recordMessageDurable,
  findMessageByMetaId,
  claimInboundMetaId,
  releaseInboundMetaId,
  hasNewerDurableInbound,
} from './channels/messageStore.js';
import {
  InboundBurstCoordinator,
  inboundQuietMsForText,
  markInboundBurstForModel,
} from './inboundBurst.js';
import {
  getSortedGroupDays,
  israelDateStr,
  israelHour,
} from './attendanceUtils.js';
import {
  HISTORY_MESSAGES,
  analysisAllowed,
  analyzeConversation,
  loadAssistantSettings,
  selectSweepCandidates,
  suggestionsAutoEnabled,
} from './aiActions.js';
import { israelClockParts, isBotEnabled, shouldAiAutoReply } from './whatsappSchedule.js';
import { DEFAULT_BUSINESS_PROFILE, getBusinessProfile } from './businessProfile.js';
import { READ_TOOLS, runChatTurn, callGeminiChat } from './aiChat.js';
import {
  aiProbeDue,
  getAiServiceState,
  isAiServiceOpen,
  markAiAlertSent,
  recordAiFailure,
  recordAiSuccess,
} from './aiServiceState.js';
import {
  claimBotReply,
  finishBotReplyClaim,
  releaseBotReplyClaim,
  replyKeyForBurst,
} from './botReplyClaims.js';
import {
  mergeBotSettings,
  withBotMark,
  withStaffMark,
  isClosingAcknowledgement,
  hasOpenBotHandoff,
  isCentrePhone,
  centrePhones,
  CUSTOMER_STATUSES,
  loadBrandedBotSettings,
  decideBotGate,
  pauseBotForPhone,
  recordBotHandoff,
  optOutPhone,
  clearBotPause,
  markOutsideHoursSent,
  shouldSendOutsideHoursMessage,
  clipReply,
  sleep,
  buildParentCardContext,
  getConversationHistory,
  getChatHistoryMessages,
  normalizeHistoryLimit,
  isStaffPhone,
  BOT_BOUNDS_RULES,
  studentsForParent,
  findPrimaryParent,
  isIdentifiedParent,
  hasCustomerFullName,
  advanceCustomerNameCapture,
  DEFAULT_BOT_SETTINGS,
} from './whatsappBot.js';
import { runCustomerToolTurn, historyToContents } from './botToolTurn.js';
import { alertRecipients } from './staffAlerts.js';
import { recordBotAction } from './botActivityLog.js';
import { isCapabilityEnabled } from './botCapabilities.js';
import { buildCentreReport, formatReportDate } from './centreReport.js';
import {
  buildDigestMessage,
  dueForDigest,
  dueForParentRecheck,
  isDigestTime,
  markAsked,
  markConfirmed as markCentreCheckConfirmed,
  markParentAsked,
} from './centreRegistrationChecks.js';

export { israelClockParts, isBotEnabled, shouldAiAutoReply };

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const inboundCustomerBursts = new InboundBurstCoordinator();
const FREE_CLIMBING_POLICY = [
  'מדיניות טיפוס חופשי:',
  '- מגיל 11 ניתן להגיע ללא מבוגר בשעות פתיחת הקיר.',
  '- מתחת לגיל 11 ניתן להגיע עם מבוגר.',
  '- גם הילד וגם המבוגר המלווים חייבים למלא טופס השתתפות.',
  '- לחוגים ניתן להגיע ללא מבוגר מכיתה ג׳.',
].join('\n');

/**
 * What a staff number may ask over WhatsApp: who a customer is, when a trainee
 * started, what the classes are. Deliberately narrower than the CRM screen —
 * takings, payment rows and the business snapshot stay behind a login, because
 * a phone number is the only thing guarding this channel and phones get lost.
 */
const STAFF_CHAT_TOOLS = {
  search_customers: READ_TOOLS.search_customers,
  get_customer: (database, args) => omitMoney(READ_TOOLS.get_customer(database, args)),
  get_student_attendance: READ_TOOLS.get_student_attendance,
  list_groups: READ_TOOLS.list_groups,
};

const STAFF_CHAT_RULES = [
  '## הערוץ הזה',
  'אתה עונה בוואטסאפ, לא במסך ה-CRM. ענה קצר — משפט או שניים, בלי טבלאות.',
  'אין לך גישה לנתונים כספיים: הכנסות, תשלומים, חובות, מחזור או דוחות.',
  'על כל שאלה כספית ענה שהיא זמינה רק במסך ה-CRM, ואל תנחש מספרים.',
  'אינך יכול לשנות דבר מכאן — פעולות נעשות במסך.',
].join('\n');

/** The customer card without its money — the rest of the card is what staff need. */
function omitMoney(card) {
  if (!card || typeof card !== 'object' || card.error) return card;
  const { payments, ...rest } = card;
  return rest;
}

function formatWaPhone(phone) {
  return normalizeWaPhone(phone);
}

const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];

function groupDayLabels(group) {
  return getSortedGroupDays(group).map((day) => DAY_NAMES[day]);
}

function groupDaysPhrase(group) {
  const days = groupDayLabels(group);
  if (!days.length) return `יום ${String(group?.day ?? '')}`.trim();
  return days.length === 1 ? `יום ${days[0]}` : `ימים ${days.join(' ו')}`;
}

function firstGroupDay(group) {
  const first = getSortedGroupDays(group)[0];
  if (first != null) return first;
  const fallback = Number(group?.day);
  return Number.isInteger(fallback) ? fallback : 7;
}

// Meta message types the model cannot see into. A caption travels as the text,
// so an image with a caption is handled as an ordinary text message.
const MEDIA_MESSAGE_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

// How a media message reads in the thread when it carries no caption of its own.
const MEDIA_LOG_WORDS = {
  image: { icon: '📷', noun: 'תמונה' },
  video: { icon: '🎬', noun: 'סרטון' },
  audio: { icon: '🎤', noun: 'הודעה קולית' },
  sticker: { icon: '🩹', noun: 'סטיקר' },
  document: { icon: '📄', noun: 'קובץ' },
};

/** High-impact personal events are routed silently; sales automation must stop. */
export function isSensitivePersonalEvent(text = '') {
  return /(?:נפטר|נפטרה|מוות|אבל|שבעה|טיפול\s+נמרץ|מאושפז|מאושפזת|אירוע\s+מוחי|שבץ|סרטן|מחלה\s+קשה|תאונה\s+קשה)/u
    .test(String(text || ''));
}

/** Any Hebrew letter — a name from the community centre always has one. */
const HEBREW_LETTER = /[֐-׿]/;


/** Strip day/time suffixes already shown separately (e.g. "— יום א׳ 15:30"). */
function isRealChildName(name) {
  const n = String(name || '').trim();
  if (n.length < 2) return false;
  if (/^ילד(?:ה)?\b|^ילד\/ה|לקוח\s*וואטסאפ|^מתאמן\b|^בן\b|^בת\b/.test(n)) return false;
  return true;
}

/** The child a parent named in this message, if it is one of theirs. */
export function matchStudentByName(text, students = []) {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const student of Array.isArray(students) ? students : []) {
    if (!isRealChildName(student?.name)) continue;
    const first = String(student?.name || '').trim().split(/\s+/)[0];
    if (first.length < 2) continue;
    // Hebrew has no \b, so guard the edges with non-letters instead.
    if (new RegExp(`(?:^|[^א-ת])${first}(?:[^א-ת]|$)`).test(t)) return student;
  }
  return null;
}

/**
 * With children already on the card, "יש לכם חוג לילדים?" should not silently
 * pick one — ask which of them it is about.
 */
export function askWhichChildReply(students = []) {
  const names = (Array.isArray(students) ? students : [])
    .filter((s) => isRealChildName(s?.name))
    .map((s) => String(s?.name || '').trim().split(/\s+/)[0])
    .filter((n) => n.length >= 2);
  const unique = [...new Set(names)].slice(0, 4);
  if (!unique.length) return '';
  if (unique.length === 1) {
    return `בשמחה! 🙂\nזה בשביל ${unique[0]} או בשביל ילד/ה אחר/ת?`;
  }
  return `בשמחה! 🙂\nבשביל מי מהילדים? ${unique.join(' / ')}\nאו כתבו «ילד אחר» ונמשיך משם.`;
}

async function handleCentreMessage({ text, phone, isSimulator = false }) {
  const typed = String(text || '').trim();
  // A name, not a sentence: the exchange is "יונתן כהן" and nothing else, so a
  // "תודה!" from the same number still reaches the ordinary path below.
  if (!typed || typed.length > 40 || typed.split(/\s+/).length > 4) return null;
  if (!HEBREW_LETTER.test(typed)) return null;

  const report = buildCentreReport({
    students: db.get('students') || [],
    attendance: db.get('attendance') || [],
    name: typed,
  });

  const student = report.student || null;
  const parent = student?.parentId ? db.getOne('parents', student.parentId) : null;

  // Registration is the one thing the centre's word settles: they are the ones
  // who register the child. Only move forward, never drag a status back.
  //
  // Until the switch is turned on, the confirmation is recorded and the team is
  // told what to mark — the status itself waits for a person. Watching it work
  // before letting it change a customer's record is the whole point.
  const settings = await loadBrandedBotSettings();
  const mayMark = isCapabilityEnabled(settings, 'centre_marks_registered');
  let statusChanged = false;
  let needsStaffMark = false;
  // Whatever happens to the status, the weekly loop for this trainee is over:
  // the centre has answered about them, and Sunday must not ask again.
  if (report.ok && student) {
    await markCentreCheckConfirmed({ db, persist: persistCore, studentId: student.id })
      .catch((err) => console.error('centre check confirm failed:', err.message));
  }
  if (report.ok && student && !CUSTOMER_STATUSES.has(String(student.status || '')) && !mayMark) {
    needsStaffMark = true;
    await notifyStaffOfHandoff({
      settings,
      parent,
      phone: parent?.phone || '',
      customerText: `המתנ״ס אישר ש${student.name} נרשם — צריך לסמן אותו «רשום» בכרטיס`,
      reason: 'handoff',
      isSimulator,
    });
  }
  if (report.ok && student && mayMark && !CUSTOMER_STATUSES.has(String(student.status || ''))) {
    const updated = db.update('students', student.id, { status: 'registered' });
    if (updated) {
      await persistCore('students', updated);
      statusChanged = true;
      recordBotAction(db, persistCore, {
        type: 'status_changed',
        summary: `${student.name} סומן כרשום לחוג לפי דיווח המתנ״ס`,
        details: { from_status: student.status, to_status: 'registered' },
        parentId: parent?.id || null,
        parentName: parent?.name || '',
        studentId: student.id,
        studentName: student.name,
        phone: parent?.phone || '',
      });
    }
  }

  recordBotAction(db, persistCore, {
    type: 'centre_report',
    summary: report.ok
      ? `דווח למתנ״ס: ${student?.name} מתאמן מ-${formatReportDate(report.date)}`
      : `בקשת המתנ״ס לא נענתה אוטומטית (${report.reason}): "${typed}"`,
    details: { ok: report.ok, reason: report.reason || '', date: report.date || '', typed, statusChanged, needsStaffMark },
    studentId: student?.id || null,
    studentName: student?.name || '',
    phone,
  });

  // Anything the bot could not settle is a person's job, and the team is told
  // with the reason rather than left to notice a missing answer.
  if (!report.ok) {
    await notifyStaffOfHandoff({
      settings: db.getSettings(),
      parent: { name: 'המתנ״ס' },
      phone,
      customerText: `המתנ״ס שאל על "${typed}" — ${report.reason}`,
      reason: 'handoff',
      isSimulator,
    });
  }

  return report;
}

/** Ping staff phones when the bot hands a chat to humans. */
export async function notifyStaffOfHandoff({
  settings,
  parent,
  phone,
  customerText = '',
  reason = 'handoff',
  isSimulator = false,
} = {}) {
  if (isSimulator) return { sent: 0, skipped: true, reason: 'simulator' };
  const s = mergeBotSettings(settings);
  const { phones: staffPhones } = alertRecipients(db, 'handoff', s);
  if (!staffPhones.length) return { sent: 0, skipped: true, reason: 'no_staff_phones' };

  const customerPhone = normalizeWaPhone(phone) || phone;
  const name = isIdentifiedParent(parent) ? (parent.name || 'לקוח') : 'לקוח חדש';
  const excerpt = clipReply(customerText, 180);
  const body = [
    '🔔 העברה מהבוט',
    `לקוח: ${name}`,
    `טלפון: ${customerPhone || '—'}`,
    reason === 'unsure'
      ? 'סיבה: הבוט לא היה בטוח'
      : (reason === 'handoff_update' ? 'עדכון לפנייה שכבר ממתינה לצוות' : 'סיבה: העברה לצוות'),
    excerpt ? `הודעה אחרונה: ${excerpt}` : '',
    '← ממתינים לטיפול במערכת',
  ].filter(Boolean).join('\n');

  let sent = 0;
  for (const raw of staffPhones) {
    const staffPhone = normalizeWaPhone(raw) || raw;
    if (!staffPhone) continue;
    if (customerPhone && phonesMatch(staffPhone, customerPhone)) continue;
    try {
      const result = await whatsappService.sendTextMessage(staffPhone, body, false, {
        source: 'staff_notify',
        clip: false,
      });
      if (result?.success) sent += 1;
    } catch (err) {
      console.error('Staff handoff notify failed:', err.message);
    }
  }
  return { sent };
}

/**
 * The bot placed a trainee. The team is told at once — a soft hold is easy to
 * undo, but only if somebody knows it happened.
 */
export async function notifyStaffOfPlacement({
  settings,
  parent,
  phone,
  student,
  group,
  kind = 'pending_signup',
  isSimulator = false,
} = {}) {
  if (isSimulator) return { sent: 0, skipped: true, reason: 'simulator' };
  const s = mergeBotSettings(settings);
  const { phones: staffPhones } = alertRecipients(db, 'placement', s);
  if (!staffPhones.length) return { sent: 0, skipped: true, reason: 'no_staff_phones' };

  const customerPhone = normalizeWaPhone(phone) || phone;
  const cancelled = kind === 'cancelled';
  const body = [
    cancelled ? '↩️ ביטול שיבוץ מהבוט' : '🧗 שיבוץ מהבוט',
    `מתאמן: ${student?.name || '—'}`,
    `הורה: ${parent?.name || '—'} · ${customerPhone || '—'}`,
    `${cancelled ? 'הוסר מקבוצה' : 'קבוצה'}: ${group?.ageCategory || ''} · ${groupDaysPhrase(group)} ${group?.time || ''}`.trim(),
    cancelled
      ? 'סטטוס: חתם הצהרה — ללא קבוצה'
      : (kind === 'waitlist' ? 'סטטוס: רשימת המתנה' : 'סטטוס: ממתין להרשמה (לא תופס מקום)'),
    cancelled
      ? '← הלקוח ביקש לבטל. אם כבר נמסר למתנ״ס — לעדכן שם'
      : '← לבדוק מול המתנ״ס ולעדכן כשמתקבל אישור',
  ].filter(Boolean).join('\n');

  let sent = 0;
  for (const raw of staffPhones) {
    const staffPhone = normalizeWaPhone(raw) || raw;
    if (!staffPhone) continue;
    if (customerPhone && phonesMatch(staffPhone, customerPhone)) continue;
    try {
      const result = await whatsappService.sendTextMessage(staffPhone, body, false, {
        source: 'staff_notify',
        clip: false,
      });
      if (result?.success) sent += 1;
    } catch (err) {
      console.error('Staff placement notify failed:', err.message);
    }
  }
  return { sent };
}

async function notifyAiServiceIncident(kind, state, settings = {}) {
  const field = kind === 'recovery' ? 'recovery_alerted_at' : 'outage_alerted_at';
  if (state?.[field]) return { sent: 0, skipped: true, reason: 'already_alerted' };
  const { phones } = alertRecipients(db, 'ai_outage', mergeBotSettings(settings));
  const body = kind === 'recovery'
    ? '✅ שירות Gemini חזר לפעילות. בוט הוואטסאפ הופעל מחדש אוטומטית.'
    : [
      '⚠️ שירות הבינה אינו זמין',
      'בוט הוואטסאפ הושתק מול לקוחות כדי שלא ישלח תשובות חלופיות או מומצאות.',
      `סוג: ${state?.status || 'לא ידוע'}`,
      state?.last_error ? `שגיאה: ${clipReply(state.last_error, 220)}` : '',
      state?.next_probe_at ? `בדיקה הבאה: ${new Date(state.next_probe_at).toLocaleString('he-IL')}` : '',
    ].filter(Boolean).join('\n');
  let sent = 0;
  for (const rawPhone of phones) {
    const result = await whatsappService.sendTextMessage(rawPhone, body, false, {
      source: 'ai_service_alert',
      clip: false,
    });
    if (result?.success) sent += 1;
  }
  if (sent) await markAiAlertSent(db, persistCore, kind);
  return { sent };
}

/** Five-minute background probe. Customers are never used as health checks. */
export async function probeGeminiService({ force = false } = {}) {
  if (!force && !aiProbeDue(db)) return { skipped: true, state: getAiServiceState(db) };
  const apiKey = process.env.GEMINI_API_KEY;
  const result = await callGeminiChat({
    apiKey,
    systemInstruction: 'Return exactly OK.',
    declarations: [],
    contents: [{ role: 'user', parts: [{ text: 'OK' }] }],
  });
  if (result.content) {
    const recovered = await recordAiSuccess(db, persistCore);
    if (recovered.recovered) {
      await notifyAiServiceIncident('recovery', recovered.state, await loadBrandedBotSettings());
    }
    return { ok: true, ...recovered };
  }
  const failure = await recordAiFailure(db, persistCore, result.error || 'model_error');
  if (failure.opened || !failure.state.outage_alerted_at) {
    await notifyAiServiceIncident('outage', failure.state, await loadBrandedBotSettings());
  }
  return { ok: false, ...failure };
}

export async function runConversationAnalysis(phone, { parent, students, auto = false } = {}) {
  try {
    const normalizedPhone = formatWaPhone(phone) || phone;
    const assistant = loadAssistantSettings(db);
    if (auto) {
      if (!suggestionsAutoEnabled(assistant)) return { created: [], skipped: 0, reason: 'disabled' };
      const cooldownMs = Number(assistant.cooldown_minutes) * 60000;
      if (!analysisAllowed(normalizedPhone, { cooldownMs })) {
        return { created: [], skipped: 0, reason: 'cooldown' };
      }
    } else if (!assistant.enabled) {
      return { created: [], skipped: 0, reason: 'disabled' };
    }

    const card = parent || findPrimaryParent(normalizedPhone);
    const kids = students || studentsForParent(card);
    const settings = await loadBrandedBotSettings();

    return await analyzeConversation({
      db,
      persist: persistCore,
      parent: card,
      students: kids,
      history: getConversationHistory(normalizedPhone, HISTORY_MESSAGES),
      cardContext: buildParentCardContext(card, kids),
      phone: normalizedPhone,
      brandName: settings.brandName || '',
    });
  } catch (err) {
    console.error('runConversationAnalysis failed:', err.message);
    return { created: [], skipped: 0, reason: 'error' };
  }
}

/**
 * סריקה לילית של שיחות ששקטו. הניתוח האוטומטי רץ רק על הודעה נכנסת, ולכן
 * שיחה שהצוות דיבר בה אחרון לא נבדקת לעולם — כאן סוגרים את הפער.
 * הקריאות מרווחות כדי לא להיתקל במגבלת הקצב של המודל.
 */
export async function runNightlySweep({ force = false, spacingMs = 2000 } = {}) {
  const settings = loadAssistantSettings(db);
  if (!settings.enabled) return { ran: false, reason: 'disabled', analyzed: 0, created: 0 };
  if (!force && !settings.nightly_sweep) return { ran: false, reason: 'sweep_off', analyzed: 0, created: 0 };

  const phones = selectSweepCandidates(db, {
    quietHours: settings.nightly_quiet_hours,
    lookbackDays: settings.nightly_lookback_days,
    max: settings.nightly_max_conversations,
  });

  let created = 0;
  let analyzed = 0;
  for (const phone of phones) {
    const result = await runConversationAnalysis(phone, { auto: false });
    created += (result.created || []).length;
    analyzed += 1;
    if (spacingMs) await sleep(spacingMs);
  }

  console.log(`🧠 Nightly sweep: ${analyzed} conversation(s) analysed, ${created} suggestion(s) created`);
  return { ran: true, reason: 'ok', analyzed, created, candidates: phones.length };
}

/** פעם ביום לפי שעון ישראל, באותה תבנית של האוטומציות. */
let lastSweepDate = null;
/**
 * Sunday and Tuesday at 08:00 — one question to the centre with every trainee
 * whose parent said they had registered, and a nudge to the parents nobody has
 * confirmed. Runs on the hourly tick; the date stamp on each row is what keeps
 * a restart from asking twice in the same morning.
 */
export async function runCentreRegistrationChecks({ now = new Date(), isSimulator = false } = {}) {
  if (!isDigestTime(now)) return { skipped: 'not_due' };
  const settings = await loadBrandedBotSettings();
  if (!isBotEnabled(settings) && !isSimulator) return { skipped: 'disabled' };
  if (!isCapabilityEnabled(settings, 'centre_report')) return { skipped: 'capability_off' };
  const centre = centrePhones(settings)[0];
  if (!centre) return { skipped: 'no_centre_phone' };

  // The parents first: whoever we asked the centre about last time and heard
  // nothing back. A second identical question to Carmit answers nothing.
  let parentsAsked = 0;
  for (const row of dueForParentRecheck(db, now)) {
    if (!row.phone) continue;
    const text = `היי 🙂\nרצינו לוודא — ההרשמה של ${row.student_name} במתנ״ס הושלמה?\n`
      + 'לא מצאנו אישור אצלם, ולכן שווה לבדוק שוב כדי שהמקום יישמר.';
    await whatsappService.sendBotReply(row.phone, text, { isSimulator });
    await markParentAsked({ db, persist: persistCore, row, now });
    parentsAsked += 1;
  }

  const due = dueForDigest(db, now);
  const message = buildDigestMessage(due);
  if (!message) return { skipped: 'nothing_to_ask', parentsAsked };

  await whatsappService.sendBotReply(centre, message, { isSimulator, source: 'bot_control' });
  await markAsked({ db, persist: persistCore, list: due, now });
  recordBotAction(db, persistCore, {
    type: 'centre_digest',
    summary: `נשלחה למתנ״ס בקשת אישור על ${due.length} מתאמנים`,
    details: { names: due.map((row) => row.student_name), parentsAsked },
  });
  return { asked: due.length, parentsAsked };
}

export async function runNightlySweepIfDue(hour = 3) {
  try {
    const today = israelDateStr();
    if (lastSweepDate === today) return null;
    if (israelHour() < hour) return null;
    lastSweepDate = today;
    return await runNightlySweep();
  } catch (err) {
    console.error('Nightly sweep failed:', err.message);
    lastSweepDate = null;
    return null;
  }
}

// Call Meta WhatsApp Cloud API
async function callMetaWhatsAppAPI(phone, payload) {
  const settings = db.getSettings();
  const phoneId = String(process.env.META_WA_PHONE_NUMBER_ID || settings.metaWaPhoneId || '').trim();
  const token = String(process.env.META_WA_ACCESS_TOKEN || settings.metaWaAccessToken || '').trim();

  if (!phoneId || phoneId.includes('YOUR_PHONE_NUMBER_ID') || !token || token.includes('YOUR_META_WA_ACCESS_TOKEN')) {
    console.log(`[WhatsApp Mock Mode] Sending to ${phone}:`, JSON.stringify(payload, null, 2));
    return { mock: true, status: 'sent', messageId: `mock_wa_${Date.now()}` };
  }

  const formattedPhone = formatWaPhone(phone);

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        // A read receipt names the message, not a recipient, and Meta rejects
        // the call when `to` is sent along with it.
        ...(formattedPhone ? { to: formattedPhone } : {}),
        ...payload
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const metaMessage = data.error?.message || 'Meta API error';
      const metaCode = data.error?.code;
      const metaType = data.error?.type;
      console.error(
        `❌ Meta WhatsApp API failed for ${phone}:`,
        metaMessage,
        `| code=${metaCode || '?'} type=${metaType || '?'}`,
        `| tokenLen=${token.length} phoneId=${phoneId} token=${token.slice(0, 6)}…${token.slice(-4)}`
      );
      throw new Error(metaMessage);
    }
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    if (!String(error.message || '').includes('Authentication Error') && !String(error.message || '').includes('Meta')) {
      console.error(`❌ Meta WhatsApp API failed for ${phone}:`, error.message);
    }
    throw error;
  }
}

export const whatsappService = {
  // Send a custom text message
  sendTextMessage: async (phone, text, isAi = false, options = {}) => {
    const settings = mergeBotSettings(db.getSettings());
    let body = String(text || '');
    if (isAi || options.clip !== false) {
      body = clipReply(body, options.maxChars ?? settings.aiMaxReplyChars);
    }
    if (isAi && !options.skipDelay) {
      await sleep(options.delayMs ?? settings.aiReplyDelayMs);
    }
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'text',
        text: { body },
        // Quoting shows the customer which of their messages this answers —
        // the same thing WhatsApp's own reply does.
        ...(options.replyTo ? { context: { message_id: options.replyTo } } : {}),
      });

      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: body,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: isAi,
        source: options.source || (isAi ? 'ai' : 'crm'),
        meta_message_id: result.messageId || null,
        meta: { reply_to: options.replyTo },
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });

      return { success: true, text: body, messageId: result.messageId };
    } catch (error) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: body,
        status: 'failed',
        is_ai: isAi,
        source: options.source || (isAi ? 'ai' : 'crm'),
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: false, error: error.message };
    }
  },

  /**
   * Session-window CTA with a URL button. Works inside the 24h customer window
   * without a Meta-approved template; outside that window use sendTemplateMessage.
   */
  sendCtaUrlMessage: async (phone, { body, buttonText, url, footer } = {}, options = {}) => {
    const text = String(body || '').trim();
    const displayText = String(buttonText || 'לפתיחה').trim().slice(0, 20);
    const href = String(url || '').trim();
    if (!text || !href) {
      return { success: false, error: 'חסרים תוכן או קישור להודעת הכפתור' };
    }
    const interactive = {
      type: 'cta_url',
      body: { text },
      action: {
        name: 'cta_url',
        parameters: {
          display_text: displayText,
          url: href,
        },
      },
    };
    const foot = String(footer || '').trim();
    if (foot) interactive.footer = { text: foot.slice(0, 60) };

    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'interactive',
        interactive,
      });
      const preview = `${text}\n[${displayText}] ${href}`;
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: preview,
        status: result.mock ? 'sent' : 'delivered',
        source: options.source || 'crm',
        message_type: 'interactive',
        meta_message_id: result.messageId || null,
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return {
        success: true,
        mock: !!result.mock,
        message: preview,
        messageId: result.messageId || null,
      };
    } catch (error) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: text,
        status: 'failed',
        source: options.source || 'crm',
        message_type: 'interactive',
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: false, error: error.message };
    }
  },

  // Send a template message
  sendTemplateMessage: async (phone, templateName, variables = [], options = {}) => {
    try {
      const localTpl = (db.get('message_templates') || []).find(
        (t) => (t.meta_name || t.name) === templateName
      );
      const isEnglishTemplate = ['hello_world', 'jaspers_market_order_confirmation'].includes(templateName)
        || String(localTpl?.language || '').toLowerCase().startsWith('en');
      const language = options.language
        || localTpl?.language
        || (isEnglishTemplate ? 'en_US' : 'he');
      const payload = {
        type: 'template',
        template: {
          name: templateName,
          language: { code: language }
        }
      };

      const parameters = buildTemplateParameters(
        localTpl || { body: '' },
        Array.isArray(variables) ? variables : [],
        options.fallbackName || ''
      );
      // If no local template metadata, only send params when explicitly provided
      // and non-empty — avoids #132000 on zero-param templates.
      const finalParams = localTpl
        ? parameters
        : (Array.isArray(variables) && variables.length
          ? variables.map((v) => ({ type: 'text', text: String(v) }))
          : []);

      const components = [];
      if (finalParams.length > 0) {
        components.push({
          type: 'body',
          parameters: finalParams,
        });
      }

      // Dynamic URL button suffix (e.g. payment id for /r/{{1}})
      const buttonParams = Array.isArray(options.buttonUrlParams)
        ? options.buttonUrlParams
        : (options.buttonUrlParam != null ? [options.buttonUrlParam] : []);
      buttonParams.forEach((suffix, index) => {
        if (suffix == null || String(suffix).trim() === '') return;
        components.push({
          type: 'button',
          sub_type: 'url',
          index: String(index),
          parameters: [{ type: 'text', text: String(suffix) }],
        });
      });

      if (components.length > 0) {
        payload.template.components = components;
      }

      const result = await callMetaWhatsAppAPI(phone, payload);

      // Render simple text preview for logs
      let logMessage = `[תבנית: ${templateName}]`;
      if (localTpl?.body) {
        let preview = localTpl.body;
        finalParams.forEach((p, i) => {
          const key = p.parameter_name || String(i + 1);
          preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), p.text);
        });
        logMessage = preview;
      } else if (templateName === 't1') logMessage = `שלום! ברוכים הבאים לקיר הטיפוס ${DEFAULT_BUSINESS_PROFILE.display_name} 🧗‍♂️`;
      else if (templateName === 't2') logMessage = `שלום, בבקשה מלאו את הצהרת הבריאות לפני הגעתכם: https://app.kirboaz.co.il/health`;
      else if (templateName === 't3') logMessage = `שלום, תזכורת: שיעור שלכם מחר. נתראה!`;
      else if (templateName === 't4') logMessage = `שלום, לסיום תהליך הרשמה בבקשה שלמו את אימון ההכירות בקליק: https://app.icount.co.il/m/9a79f`;

      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        template_id: templateName,
        source: options.source || 'crm',
        meta_message_id: result.messageId || null,
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });

      // `mock` travels with the result: a caller that needs to know whether the
      // message actually left the building — the phone-verification route hands
      // the code back on screen when it did not — cannot tell otherwise, and
      // silently behaved as if every send had succeeded.
      return {
        success: true,
        mock: !!result.mock,
        message: logMessage,
        messageId: result.messageId || null,
      };
    } catch (error) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: `[נכשל בשליחת תבנית: ${templateName}]`,
        status: 'failed',
        template_id: templateName,
        source: options.source || 'crm',
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: false, error: error.message };
    }
  },

  sendImageMessage: async (phone, mediaId, caption = '', options = {}) => {
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'image',
        image: {
          id: mediaId,
          ...(caption ? { caption } : {}),
        },
      });
      const logMessage = caption ? `📷 ${caption}` : '📷 תמונה';
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        source: 'crm',
        meta_message_id: result.messageId || null,
        message_type: 'image',
        media_url: mediaId,
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: true, message: logMessage, messageId: result.messageId || null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Any file the desk attaches — image, video, voice note or document.
   *
   * Kept apart from sendImageMessage / sendDocumentMessage on purpose: those two
   * have their own callers (invoice delivery among them) and their own logged
   * wording, and this is not the place to change what a customer's receipt says.
   *
   * `mediaRef` is what the thread stores in media_url. Prefer the mirrored copy
   * in our own bucket, so the bubble keeps rendering after Meta drops its file.
   */
  sendMediaMessage: async (phone, { kind, mediaId, filename = '', caption = '', mediaRef = null } = {}, options = {}) => {
    const type = MEDIA_MESSAGE_TYPES.has(String(kind)) ? String(kind) : 'document';
    try {
      const payload = { id: mediaId };
      // WhatsApp rejects a caption on audio and on stickers.
      if (caption && type !== 'audio' && type !== 'sticker') payload.caption = caption;
      if (type === 'document' && filename) payload.filename = filename;

      const result = await callMetaWhatsAppAPI(phone, {
        type,
        [type]: payload,
        ...(options.replyTo ? { context: { message_id: options.replyTo } } : {}),
      });
      const { icon, noun } = MEDIA_LOG_WORDS[type] || MEDIA_LOG_WORDS.document;
      const subject = type === 'document' && filename ? filename : noun;
      const logMessage = caption ? `${icon} ${caption}` : `${icon} ${subject}`;

      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        source: options.source || 'crm',
        meta_message_id: result.messageId || null,
        message_type: type,
        media_url: mediaRef || encodeMediaRef({ kind: 'meta', id: mediaId, filename }),
        meta: { reply_to: options.replyTo },
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: true, message: logMessage, messageId: result.messageId || null };
    } catch (error) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: `[נכשלה שליחת ${(MEDIA_LOG_WORDS[type] || MEDIA_LOG_WORDS.document).noun}]`,
        status: 'failed',
        source: options.source || 'crm',
        message_type: type,
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: false, error: error.message };
    }
  },

  /**
   * React to one of the customer's messages with an emoji.
   *
   * An empty emoji is how WhatsApp removes a reaction — Meta takes the same
   * payload either way, so both go through here.
   */
  sendReaction: async (phone, { messageId, emoji = '' } = {}, options = {}) => {
    if (!messageId) return { success: false, error: 'חסר מזהה הודעה לתגובה' };
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'reaction',
        reaction: { message_id: messageId, emoji },
      });
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: emoji ? `ריאקציה: ${emoji}` : 'ריאקציה הוסרה',
        status: result.mock ? 'sent' : 'delivered',
        source: options.source || 'crm',
        meta_message_id: result.messageId || null,
        message_type: 'reaction',
        meta: { reaction_to: messageId },
        parent_id: options.parentId || null,
        student_id: options.studentId || null,
      });
      return { success: true, emoji, messageId: result.messageId || null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Turn the customer's ticks blue when the desk opens their conversation.
   *
   * Nothing is recorded locally: this changes what the customer sees, not what
   * our thread holds, and a failure is not worth surfacing — the desk still
   * read the message.
   */
  markMessageRead: async (messageId) => {
    if (!messageId) return { success: false, error: 'חסר מזהה הודעה' };
    try {
      const result = await callMetaWhatsAppAPI(null, {
        status: 'read',
        message_id: messageId,
      });
      return { success: true, mock: !!result.mock };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Generate automated AI response
  generateAIResponse: async (incomingText, context = {}) => {
    const settings = await loadBrandedBotSettings();
    const phone = context.phone || '';
    const parent = context.parent || (phone ? findPrimaryParent(phone) : null);
    const students = context.students || (parent ? studentsForParent(parent) : []);
    // When the inbound number belongs to a trainee, greet that trainee — not
    // the parent whose card the thread is filed under.
    const speaker = context.speaker || null;

    if (!context.isSimulator && isAiServiceOpen(db)) {
      return { text: '', handoff: false, silent: true, reason: 'ai_circuit_open' };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const hasModel = !!apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE';

    // The model reads the message and asks the CRM for the facts it needs.
    // There is no second engine behind this one: a keyword layer used to guess
    // the intent here and answer from that guess, which is how a customer got a
    // confident sentence nobody had checked.
    if (hasModel) {
      const historyLimit = normalizeHistoryLimit(settings.aiHistoryCount, 8);
      const fullHistory = phone ? getChatHistoryMessages(phone, historyLimit) : [];
      const burstCount = Math.max(0, Math.trunc(Number(context.inboundBurstCount) || 0));
      // The burst is supplied below as the current turn. Leaving its individual
      // bubbles in history as well repeats every sentence twice to the model.
      // Manual continuation always replays rows that are already in storage;
      // remove even a one-message burst in that case.
      const repeatedHistoryRows = context.replayExistingMessage
        ? Math.max(1, burstCount)
        : (burstCount > 1 ? burstCount : 0);
      const priorHistory = repeatedHistoryRows > 0
        ? fullHistory.slice(0, Math.max(0, fullHistory.length - repeatedHistoryRows))
        : fullHistory;
      // Only curated policy, live business facts and tool results reach the
      // model. Conversation feedback is quality-control data, never an
      // instruction or a remembered answer for a different customer.
      const turn = await runCustomerToolTurn({
        systemInstruction: [
          `שם העסק הרשמי: ${settings.brandName || 'הרפתקאות'}\nהזכר את העסק רק בשם הרשמי הזה.`,
          settings.aiSystemPrompt,
          buildParentCardContext(parent, students, { speaker }),
          settings.aiBusinessFacts ? `עובדות העסק:\n${settings.aiBusinessFacts}` : '',
          settings.aiKnowledgeBase ? `בסיס ידע / שאלות נפוצות:\n${settings.aiKnowledgeBase}` : '',
          FREE_CLIMBING_POLICY,
          settings.aiForbiddenTopics ? `אסור:\n${settings.aiForbiddenTopics}` : '',
          BOT_BOUNDS_RULES,
        ].filter(Boolean).join('\n\n'),
        history: historyToContents(priorHistory),
        incomingText,
        settings,
        parent,
        phone,
        speaker,
        // A placement the bot makes is reversible, but only if the team hears
        // about it the moment it happens.
        onPlacement: ({ student, group, kind }) => notifyStaffOfPlacement({
          settings,
          parent,
          phone,
          student,
          group,
          kind,
          isSimulator: !!context.isSimulator,
        }),
        apiKey,
      });
      if (turn.text) {
        if (!context.isSimulator) {
          const success = await recordAiSuccess(db, persistCore);
          if (success.recovered) await notifyAiServiceIncident('recovery', success.state, settings);
        }
        return {
          text: clipReply(turn.text, settings.aiMaxReplyChars),
          handoff: turn.handoff,
          unsure: turn.unsure,
          confidence: 'medium',
          toolsUsed: turn.toolsUsed,
        };
      }
      // Provider failures never turn into a generic customer reply. They are
      // counted durably and, once the circuit opens, every server stays silent.
      console.error(`bot tool turn produced nothing (${turn.reason})`);
      if (!context.isSimulator) {
        const failure = await recordAiFailure(db, persistCore, turn.reason || 'model_error');
        if (failure.opened) await notifyAiServiceIncident('outage', failure.state, settings);
      }
      return {
        text: '',
        handoff: false,
        silent: true,
        unsure: false,
        confidence: 'low',
        reason: turn.reason,
      };
    }

    // A bot with no model does not improvise. It says so, and fetches a person.
    console.error('Gemini API key missing — the bot has no reply engine');
    if (!context.isSimulator) {
      const failure = await recordAiFailure(db, persistCore, 'no_api_key');
      if (failure.opened) await notifyAiServiceIncident('outage', failure.state, settings);
    }
    return {
      text: '',
      handoff: false,
      silent: true,
      unsure: false,
      confidence: 'low',
      reason: 'no_model',
    };
  },

  /**
   * A staff question answered by the CRM agent, over a deliberately narrow set
   * of read tools (`STAFF_CHAT_TOOLS`). Write tools are off entirely here:
   * WhatsApp never becomes a way to change data.
   */
  async runStaffChat(phone, text) {
    const messages = getChatHistoryMessages(phone, 6);
    if (!messages.length || messages[messages.length - 1]?.content !== text) {
      messages.push({ role: 'user', content: text });
    }
    try {
      const profile = await getBusinessProfile().catch(() => null);
      const result = await runChatTurn({
        db,
        persist: persistCore,
        messages,
        actor: `whatsapp:${phone}`,
        brandName: profile?.display_name || DEFAULT_BUSINESS_PROFILE.display_name,
        readTools: STAFF_CHAT_TOOLS,
        allowActions: false,
        extraRules: STAFF_CHAT_RULES,
      });
      if (result.reply) return clipReply(result.reply, 1500);
      return 'לא הצלחתי לענות על זה כרגע 🙏 נסו לנסח מחדש או לבדוק במסך העוזר החכם.';
    } catch (err) {
      console.error('staff chat failed:', err.message);
      return 'משהו נתקע בשליפת הנתונים 🙏 נסו שוב בעוד רגע.';
    }
  },

  async sendBotReply(phone, replyText, {
    isSimulator = false,
    source = 'ai',
    parent = null,
    logType = '',
    replyKey = '',
    replyClaimed = false,
  } = {}) {
    if (!replyText) return { success: false };
    const text = withBotMark(replyText);
    if (!isSimulator && replyKey && !replyClaimed) {
      const claim = await claimBotReply(db, replyKey, { phone });
      if (!claim.claimed) return { success: true, skipped: true, reason: 'duplicate_reply', replyKey };
    }
    // The journal is what makes "what did the bot say today" one question with
    // one answer, instead of a scroll through every conversation.
    const owner = parent || findPrimaryParent(phone);
    recordBotAction(db, persistCore, {
      type: logType || (source === 'bot_control' ? 'handoff' : 'reply'),
      summary: clipReply(text, 160),
      details: { source, simulator: !!isSimulator },
      parentId: owner?.id || null,
      parentName: owner?.name || '',
      phone: formatWaPhone(phone) || phone,
    });
    if (isSimulator) {
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: text,
        status: 'sent',
        is_ai: true,
        source,
      });
      return { success: true, text };
    }
    // Live inbound handling already waited for the customer's quiet window.
    // Waiting again here made the reply feel slow without collecting anything.
    let result;
    try {
      result = await whatsappService.sendTextMessage(phone, text, true, { source, skipDelay: true });
    } catch (err) {
      if (replyKey) await releaseBotReplyClaim(db, replyKey);
      throw err;
    }
    if (replyKey) {
      if (result?.success) {
        await finishBotReplyClaim(db, persistCore, replyKey, { messageId: result.messageId || '' });
      } else {
        await releaseBotReplyClaim(db, replyKey);
      }
    }
    return result;
  },

  sendDocumentMessage: async (phone, documentLink, filename = 'invoice.pdf', caption = '', options = {}) => {
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'document',
        document: {
          link: documentLink,
          filename: String(filename || 'invoice.pdf').slice(0, 240),
          ...(caption ? { caption: String(caption).slice(0, 1024) } : {}),
        },
      });
      const logMessage = caption ? `📎 ${caption}` : `📎 ${filename}`;
      recordMessage({
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        source: options.source || 'finance',
        message_type: 'document',
        media_url: documentLink,
        meta_message_id: result.messageId || null,
      });
      return { success: true, mock: !!result.mock, messageId: result.messageId || null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Explicit one-off continuation from the CRM. It bypasses only the temporary
   * human-reply pause: the global switch, the 24h window and customer opt-out
   * are validated by the conversation API, while the durable reply claim keeps
   * two clicks or server instances from running the same tool turn twice.
   */
  async continueConversation(phone, incomingText, context = {}) {
    const normalizedPhone = formatWaPhone(phone) || phone;
    const settings = await loadBrandedBotSettings();
    if (!isBotEnabled(settings)) {
      return { success: false, status: 409, reason: 'disabled', error: 'הבוט כבוי כרגע לכל הלקוחות.' };
    }

    const parent = context.parent || findPrimaryParent(normalizedPhone);
    let students = context.students || studentsForParent(parent);
    const speaker = context.speaker || null;
    if (context.respectGate) {
      if (!parent || isClosingAcknowledgement(incomingText) || hasOpenBotHandoff(parent, normalizedPhone)) {
        return { success: false, status: 409, reason: 'not_actionable' };
      }
      const recoveryGate = decideBotGate(settings, parent, students, incomingText, { isSimulator: false });
      if (recoveryGate.action !== 'reply') {
        return { success: false, status: 409, reason: recoveryGate.reason || recoveryGate.action };
      }
    }
    const replyKey = String(context.replyKey || '');
    const claim = await claimBotReply(db, replyKey, { phone: normalizedPhone });
    if (!claim.claimed) {
      return {
        success: false,
        status: 409,
        reason: 'already_running',
        error: 'הבוט כבר הופעל על ההודעה הזאת או שכבר נשלחה תשובה.',
      };
    }

    try {
      // The staff member explicitly asked the bot to take this turn now.
      if (!context.respectGate) await clearBotPause(normalizedPhone);

      if (isSensitivePersonalEvent(incomingText)) {
        await recordBotHandoff(normalizedPhone);
        await notifyStaffOfHandoff({
          settings,
          parent,
          phone: normalizedPhone,
          customerText: incomingText,
          reason: 'handoff',
          isSimulator: false,
        });
        await finishBotReplyClaim(db, persistCore, replyKey, { status: 'sensitive_handoff' });
        return {
          success: false,
          status: 409,
          reason: 'sensitive_personal_event',
          error: 'זו פנייה רגישה. היא הועברה לצוות בלי לשלוח תשובת בוט אוטומטית.',
        };
      }

      let currentParent = parent;
      if (!speaker && !hasCustomerFullName(currentParent)) {
        const nameCapture = await advanceCustomerNameCapture(normalizedPhone, currentParent, incomingText);
        if (!nameCapture.done) {
          const sent = await whatsappService.sendBotReply(normalizedPhone, nameCapture.reply, {
            parent: currentParent,
            replyKey,
            replyClaimed: true,
            ...(nameCapture.handoff ? { source: 'bot_control' } : {}),
          });
          if (!sent?.success) {
            return { success: false, status: 502, reason: 'send_failed', error: sent?.error || 'שליחת התשובה נכשלה' };
          }
          if (nameCapture.handoff) {
            await recordBotHandoff(normalizedPhone);
            await notifyStaffOfHandoff({
              settings,
              parent: currentParent,
              phone: normalizedPhone,
              customerText: incomingText,
              reason: 'handoff',
              isSimulator: false,
            });
          }
          return {
            success: true,
            replied: true,
            reply: nameCapture.reply,
            reason: nameCapture.handoff ? 'handoff' : 'name_capture',
          };
        }
        currentParent = nameCapture.parent || findPrimaryParent(normalizedPhone) || currentParent;
        students = context.students || studentsForParent(currentParent);
      }

      const aiResult = await whatsappService.generateAIResponse(incomingText, {
        phone: normalizedPhone,
        parent: currentParent,
        students,
        speaker,
        inboundBurstCount: Math.max(1, Number(context.inboundBurstCount) || 1),
        replayExistingMessage: true,
      });

      // A fresh customer bubble arrived while Gemini was working. The new turn
      // owns the answer; sending this older draft as well would recreate the
      // duplicate-reply problem this action is meant to solve.
      if (context.lastInboundAt && await hasNewerDurableInbound({
        parentId: currentParent?.id || '',
        phone: normalizedPhone,
        after: context.lastInboundAt,
      })) {
        await finishBotReplyClaim(db, persistCore, replyKey, { status: 'superseded' });
        return {
          success: false,
          status: 409,
          reason: 'newer_inbound',
          error: 'הגיעה הודעה חדשה בזמן שהבוט ניסח. לא נשלחה התשובה הישנה; אפשר להפעיל שוב על הרצף המעודכן.',
        };
      }

      if (aiResult?.silent || !aiResult?.text) {
        // A provider outage is retryable. Releasing this manual claim lets the
        // same menu action work after Gemini recovers.
        await releaseBotReplyClaim(db, replyKey);
        return {
          success: false,
          status: 503,
          reason: aiResult?.reason || 'ai_unavailable',
          error: 'שירות הבינה אינו זמין כרגע. לא נשלחה הודעה ללקוח; אפשר לנסות שוב בהמשך.',
        };
      }

      if (aiResult.handoff) await recordBotHandoff(normalizedPhone);
      const sent = await whatsappService.sendBotReply(normalizedPhone, aiResult.text, {
        parent: currentParent,
        source: aiResult.handoff ? 'bot_control' : 'ai',
        replyKey,
        replyClaimed: true,
      });
      if (!sent?.success) {
        return { success: false, status: 502, reason: 'send_failed', error: sent?.error || 'שליחת התשובה נכשלה' };
      }

      if (aiResult.handoff) {
        await notifyStaffOfHandoff({
          settings,
          parent: currentParent,
          phone: normalizedPhone,
          customerText: incomingText,
          reason: aiResult.unsure ? 'unsure' : 'handoff',
          isSimulator: false,
        });
      }

      return {
        success: true,
        replied: true,
        reply: aiResult.text,
        reason: aiResult.handoff ? 'handoff' : 'continued',
      };
    } catch (error) {
      await releaseBotReplyClaim(db, replyKey);
      throw error;
    }
  },

  // Process incoming messages (webhook entrypoint / simulator)
  handleIncomingMessage: async (phone, text, isSimulator = false, meta = {}) => {
    const metaMessageId = meta.messageId || null;
    // Claim before any await — Meta often delivers the same webhook twice in parallel.
    if (!claimInboundMetaId(metaMessageId)) {
      const normalizedEarly = formatWaPhone(phone) || phone;
      return {
        parent: findPrimaryParent(normalizedEarly),
        student: null,
        isNew: false,
        replied: false,
        skippedReason: 'duplicate',
      };
    }

    try {
    if (!isSimulator) await syncBotFlagFromRemote();
    const normalizedPhone = formatWaPhone(phone) || phone;
    let replyKey = '';

    // Already handled this exact Meta message (webhook retry) — never process twice.
    const seen = findMessageByMetaId(metaMessageId);
    if (seen?.durable) {
      return {
        parent: findPrimaryParent(normalizedPhone),
        student: null,
        isNew: false,
        replied: false,
        skippedReason: 'duplicate',
      };
    }

    // 1. Upsert lead / client details first, so the message is filed on a real card
    const {
      parent: createdParent,
      student,
      isNew,
      matchedVia,
    } = await db.createLeadFromWhatsApp(normalizedPhone, text);
    let parent = (matchedVia === 'child_phone'
      ? createdParent
      : (findPrimaryParent(normalizedPhone) || createdParent));

    const rawTimestamp = Number(meta.timestamp);
    const inboundAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0
      ? new Date(rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000).toISOString()
      : new Date().toISOString();

    // 2. Store the message durably BEFORE the handling queue learns about it —
    //    a customer must never sit in the queue with an invisible conversation.
    const storedInbound = await recordMessageDurable({
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: 'inbound',
      message: text,
      status: 'received',
      source: 'customer',
      meta_message_id: metaMessageId,
      message_type: meta.type || 'text',
      media_url: encodeMediaRef(meta.mediaRef),
      meta: metaFromMediaRef(meta.mediaRef),
      parent_id: parent?.id || null,
      student_id: matchedVia === 'child_phone' ? (student?.id || null) : null,
      created_at: inboundAt,
    });

    if (!storedInbound.ok) {
      console.error(
        `❌ Inbound WhatsApp message from ${normalizedPhone} was not stored durably — ` +
        'leaving it out of the handling queue so it can be retried'
      );
      return {
        parent,
        student,
        isNew,
        replied: false,
        durableError: storedInbound.error || 'durable write failed',
        skippedReason: 'not_persisted',
        matchedVia,
      };
    }

    // 3. Open / refresh the 24h window on the resolved parent card(s).
    // Child-phone inbound must touch the parent card even when parent.phone differs.
    const phoneMatches = (db.get('parents') || []).filter((p) => phonesMatch(p.phone, normalizedPhone));
    const parentsToTouch = matchedVia === 'child_phone' && parent?.id
      ? [parent, ...phoneMatches.filter((p) => p.id !== parent.id)]
      : (phoneMatches.length ? phoneMatches : (parent ? [parent] : []));
    for (const match of parentsToTouch) {
      const updatedParent = db.update('parents', match.id, {
        last_inbound_whatsapp: inboundAt,
        channel: match.channel === 'phone' ? 'whatsapp' : (match.channel || 'whatsapp'),
      });
      if (updatedParent) await persistCore('parents', updatedParent);
    }

    parent = (matchedVia === 'child_phone'
      ? (db.getOne('parents', parent?.id) || parent)
      : (findPrimaryParent(normalizedPhone) || parent));

    // A recovered retry is now durable and queued — but it was already answered.
    if (storedInbound.duplicate) {
      return {
        parent,
        student,
        isNew: false,
        replied: false,
        skippedReason: 'duplicate',
        matchedVia,
      };
    }

    let students = studentsForParent(parent);
    const settings = await loadBrandedBotSettings();

    if (!text) {
      return { parent, student, isNew, replied: false, skippedReason: 'empty' };
    }

    // Reactions are conversation metadata, not a customer question. They must
    // not reset a real text burst or turn a thumbs-up into part of the prompt.
    const isReaction = String(meta.type || '') === 'reaction'
      || /^ריאקציה:\s*/u.test(String(text || '').trim());
    if (isReaction) {
      return { parent, student, isNew, replied: false, skippedReason: 'reaction' };
    }

    let inboundBurst = null;
    const fixedCentreConversation = isCapabilityEnabled(settings, 'centre_report')
      && isCentrePhone(settings, normalizedPhone);
    const shouldCollectBurst = !isSimulator
      && !isStaffPhone(settings, normalizedPhone)
      && !fixedCentreConversation;

    if (shouldCollectBurst) {
      // Hard silence states do not need to hold a webhook open for the quiet
      // window. Text-dependent actions (opt-out, handoff, ordinary replies)
      // are deliberately decided only after the complete burst is available.
      const earlyGate = decideBotGate(settings, parent, students, text, { isSimulator });
      if (earlyGate.action === 'silence') {
        console.log(`🤖 Bot silence (${earlyGate.reason}) for ${normalizedPhone}`);
        return { parent, student, isNew, replied: false, skippedReason: earlyGate.reason };
      }

      inboundBurst = await inboundCustomerBursts.push(normalizedPhone, {
        text,
        messageId: metaMessageId,
        type: meta.type || 'text',
        createdAt: inboundAt,
      }, { quietMs: inboundQuietMsForText(text, settings.aiReplyDelayMs) });

      if (!inboundBurst.leader) {
        return {
          parent,
          student,
          isNew,
          replied: false,
          skippedReason: 'burst_superseded',
          burstCount: 0,
        };
      }
      text = inboundBurst.text || text;
    }
    replyKey = replyKeyForBurst(normalizedPhone, inboundBurst?.items || [{
      text,
      messageId: metaMessageId,
      createdAt: inboundAt,
    }]);

    // "תודה" by itself closes the exchange. It must not spend another model
    // turn and, more importantly, must not repeat a fallback handoff when the
    // previous automatic message was already an acknowledgement.
    if (!isStaffPhone(settings, normalizedPhone)
      && !fixedCentreConversation
      && isClosingAcknowledgement(text)) {
      console.log(`🤖 Closing acknowledgement — no reply for ${normalizedPhone}`);
      return {
        parent,
        student,
        isNew,
        replied: false,
        skippedReason: 'closing_acknowledgement',
        burstCount: inboundBurst?.items?.length || 1,
      };
    }

    // The first handoff acknowledgement already told the customer what will
    // happen. Further bubbles update the same staff task silently; repeating
    // the acknowledgement after every detail made the bot look stuck in a
    // loop and flooded both sides of the conversation.
    if (!isStaffPhone(settings, normalizedPhone)
      && !fixedCentreConversation
      && hasOpenBotHandoff(parent, normalizedPhone)) {
      return {
        parent,
        student,
        isNew,
        replied: false,
        skippedReason: 'handoff_pending',
        burstCount: inboundBurst?.items?.length || 1,
      };
    }

    // הצעות פעולה לצוות — רקע בלבד, לעולם לא מעכב את התשובה ללקוח.
    if (text && !isSimulator) {
      Promise.resolve(runConversationAnalysis(normalizedPhone, { parent, students, auto: true }))
        .catch((err) => console.error('AI suggestion analysis failed:', err.message));
    }

    // A first-time writer used to get two machine messages before the bot even
    // read their question: a template literally named 't1' — a placeholder that
    // never existed in Meta, so it failed every time and left a "failed" row in
    // the conversation — and then the onboarding confirmation, which announces
    // "we received your details and your health declaration" to somebody who
    // has filled in nothing. That automation belongs to the intake form, and
    // the form fires it. Somebody saying hello on WhatsApp gets the bot's own
    // greeting, which is the whole point of the bot.

    // A media-only message cannot be read by the model. It still obeys hard
    // silence states (bot off, opt-out, an active human thread), but it should
    // not be replaced by the outside-hours template.
    const mediaOnly = MEDIA_MESSAGE_TYPES.has(String(meta.type || ''))
      && (!text || /^\[[^\]\r\n]+\]$/u.test(String(text).trim()));

    if (isSensitivePersonalEvent(text)) {
      await recordBotHandoff(normalizedPhone);
      await notifyStaffOfHandoff({
        settings,
        parent,
        phone: normalizedPhone,
        customerText: text,
        reason: 'handoff',
        isSimulator,
      });
      return { parent, student, isNew, replied: false, skippedReason: 'sensitive_personal_event' };
    }

    // 4b. Staff numbers talk to the CRM agent, not to the customer bot.
    if (isStaffPhone(settings, normalizedPhone)) {
      if (!isBotEnabled(settings) && !isSimulator) {
        console.log(`🤖 Staff query ignored while the bot is off (${normalizedPhone})`);
        return { parent, student, isNew, replied: false, skippedReason: 'disabled' };
      }
      const staffReply = await whatsappService.runStaffChat(normalizedPhone, text);
      await whatsappService.sendBotReply(normalizedPhone, staffReply, { isSimulator, source: 'staff_chat', replyKey });
      return { parent, student, isNew, replied: true, reply: staffReply, reason: 'staff_chat' };
    }

    // The community centre writes us a child's name and waits for a billing
    // date. It is a fixed exchange with one right answer, so it never reaches
    // the model: a wrong date here is a wrong charge to a family.
    if (isCapabilityEnabled(settings, 'centre_report') && isCentrePhone(settings, normalizedPhone)) {
      const report = await handleCentreMessage({ text, phone: normalizedPhone, isSimulator });
      if (report) {
        await whatsappService.sendBotReply(normalizedPhone, report.reply, {
            isSimulator, source: 'bot_control', logType: 'reply', replyKey,
        });
        return { parent, student, isNew, replied: true, reply: report.reply, reason: 'centre_report' };
      }
    }

    // 5. Bot decision gates
    const gate = decideBotGate(settings, parent, students, text, { isSimulator });

    if (gate.action === 'reactivate') {
      await optOutPhone(normalizedPhone, false);
      await clearBotPause(normalizedPhone);
      parent = findPrimaryParent(normalizedPhone) || parent;
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control', replyKey });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'reactivated' };
    }

    if (gate.action === 'opt_out') {
      await optOutPhone(normalizedPhone, true, { source: 'customer' });
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control', replyKey });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'opt_out' };
    }

    if (gate.action === 'silence') {
      console.log(`🤖 Bot silence (${gate.reason}) for ${normalizedPhone}`);
      return { parent, student, isNew, replied: false, skippedReason: gate.reason };
    }

    if (mediaOnly) {
      return { parent, student, isNew, replied: false, skippedReason: 'media_without_text' };
    }

    if (gate.action === 'outside_hours') {
      if (isSimulator || shouldSendOutsideHoursMessage(parent)) {
        await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control', replyKey });
        if (!isSimulator) await markOutsideHoursSent(normalizedPhone);
        return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'outside_hours' };
      }
      return { parent, student, isNew, replied: false, skippedReason: 'outside_hours' };
    }

    if (gate.action === 'handoff') {
      await recordBotHandoff(normalizedPhone);
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control', replyKey });
      await notifyStaffOfHandoff({
        settings,
        parent,
        phone: normalizedPhone,
        customerText: text,
        reason: 'handoff',
        isSimulator,
      });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'handoff' };
    }

    let aiIncomingText = inboundBurst?.modelText || text;

    // Identity collection is not optional, and it runs before the model.
    // A trainee writing from their known personal phone is already identified;
    // every other incomplete card must supply first + family name first.
    if (matchedVia !== 'child_phone'
      && !hasCustomerFullName(parent)) {
      const nameCapture = await advanceCustomerNameCapture(normalizedPhone, parent, text);
      if (!nameCapture.done) {
        await whatsappService.sendBotReply(normalizedPhone, nameCapture.reply, {
          isSimulator,
          replyKey,
          ...(nameCapture.handoff ? { source: 'bot_control' } : {}),
        });
        // Asked twice and still not a name: the customer is asking us
        // something, and a third identical question is a wall.
        if (nameCapture.handoff) {
          await recordBotHandoff(normalizedPhone);
          await notifyStaffOfHandoff({
            settings,
            parent,
            phone: normalizedPhone,
            customerText: text,
            reason: 'handoff',
            isSimulator,
          });
        }
        return {
          parent: findPrimaryParent(normalizedPhone) || parent,
          student,
          isNew,
          replied: true,
          reply: nameCapture.reply,
          reason: nameCapture.handoff ? 'handoff' : 'name_capture',
        };
      }
      parent = nameCapture.parent || findPrimaryParent(normalizedPhone) || parent;
      students = studentsForParent(parent);
      const pendingText = nameCapture.pendingMessage || text;
      aiIncomingText = markInboundBurstForModel(
        pendingText,
        inboundBurst?.items?.length || 1
      );
    }

    const speaker = matchedVia === 'child_phone' ? student : null;
    // Claim the whole AI turn before the model can invoke a tool. Claiming only
    // inside sendBotReply prevented duplicate WhatsApp messages, but two server
    // processes could still execute the same placement/link/approval tool while
    // composing their replies. This durable claim makes the tool turn itself
    // single-owner across retries, restarts and parallel instances.
    let aiTurnClaimed = false;
    if (!isSimulator && replyKey) {
      const turnClaim = await claimBotReply(db, replyKey, { phone: normalizedPhone });
      if (!turnClaim.claimed) {
        return {
          parent,
          student,
          isNew,
          replied: false,
          skippedReason: 'duplicate_reply',
          burstCount: inboundBurst?.items?.length || 1,
        };
      }
      aiTurnClaimed = true;
    }

    let aiResult;
    try {
      aiResult = await whatsappService.generateAIResponse(aiIncomingText, {
        phone: normalizedPhone,
        parent,
        students,
        speaker,
        isSimulator,
        inboundBurstCount: inboundBurst?.items?.length || 0,
      });
    } catch (err) {
      if (aiTurnClaimed) await releaseBotReplyClaim(db, replyKey);
      throw err;
    }
    // The customer may add one last bubble while the model is composing. The
    // newer handler owns the answer; sending this stale draft would recreate
    // the exact multi-reply problem the quiet window is meant to solve.
    if (inboundBurst
      && !inboundCustomerBursts.isCurrent(normalizedPhone, inboundBurst.generation)) {
      if (aiTurnClaimed) {
        await finishBotReplyClaim(db, persistCore, replyKey, { status: 'superseded' });
      }
      return {
        parent,
        student,
        isNew,
        replied: false,
        skippedReason: 'burst_superseded_during_reply',
        burstCount: inboundBurst.items.length,
      };
    }
    if (inboundBurst) {
      const latestBurstAt = inboundBurst.items
        .map((item) => String(item?.createdAt || ''))
        .filter(Boolean)
        .sort()
        .at(-1);
      if (latestBurstAt && await hasNewerDurableInbound({
        parentId: parent?.id || '',
        phone: normalizedPhone,
        after: latestBurstAt,
      })) {
        if (aiTurnClaimed) {
          await finishBotReplyClaim(db, persistCore, replyKey, { status: 'superseded' });
        }
        return {
          parent,
          student,
          isNew,
          replied: false,
          skippedReason: 'burst_superseded_durably',
          burstCount: inboundBurst.items.length,
        };
      }
    }
    if (aiResult.silent || !aiResult.text) {
      if (aiTurnClaimed) {
        await finishBotReplyClaim(db, persistCore, replyKey, { status: 'silent' });
      }
      return {
        parent,
        student,
        isNew,
        replied: false,
        skippedReason: aiResult.reason || 'ai_unavailable',
        burstCount: inboundBurst?.items?.length || 1,
      };
    }
    if (aiResult.handoff) {
      await recordBotHandoff(normalizedPhone);
      // Prefer the model's natural wording; canned ack only when empty.
      const handoffText = aiResult.text || settings.aiHandoffAckMessage;
      await whatsappService.sendBotReply(normalizedPhone, handoffText, {
        isSimulator,
        source: 'bot_control',
        replyKey,
        replyClaimed: aiTurnClaimed,
      });
      await notifyStaffOfHandoff({
        settings,
        parent,
        phone: normalizedPhone,
        customerText: text,
        reason: aiResult.unsure ? 'unsure' : 'handoff',
        isSimulator,
      });
      return { parent, student, isNew, replied: true, reply: handoffText, reason: 'handoff' };
    }

    await whatsappService.sendBotReply(normalizedPhone, aiResult.text, {
      isSimulator,
      replyKey,
      replyClaimed: aiTurnClaimed,
    });
    return { parent, student, isNew, replied: true, reply: aiResult.text };
    } finally {
      releaseInboundMetaId(metaMessageId);
    }
  },

  // Messages sent from WhatsApp Business app (Coexistence echoes)
  handlePhoneEcho: async ({ phone, text, messageId, type, mediaRef = null } = {}) => {
    const normalizedPhone = formatWaPhone(phone) || phone;
    if (!normalizedPhone) return { skipped: true };

    if (findMessageByMetaId(messageId)?.durable) {
      return { skipped: true, reason: 'duplicate' };
    }

    // Ensure parent exists so the thread shows under a lead card
    const echoParent = db.upsertParentByPhone('לקוח וואטסאפ', normalizedPhone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
    });

    recordMessage({
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: 'outbound',
      message: text || '[הודעה מהטלפון]',
      status: 'sent',
      source: 'phone',
      meta_message_id: messageId || null,
      message_type: type || 'text',
      media_url: encodeMediaRef(mediaRef),
      meta: metaFromMediaRef(mediaRef),
      parent_id: echoParent?.id || null,
    });

    const settings = mergeBotSettings(db.getSettings());
    if (settings.aiPauseOnHumanReply) {
      await pauseBotForPhone(normalizedPhone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
    }

    return { success: true, phone: normalizedPhone };
  },

  // Initial history sync payloads from Coexistence onboarding
  handleHistoryMessage: async ({ phone, text, direction, messageId, timestamp, type, mediaRef = null } = {}) => {
    const normalizedPhone = formatWaPhone(phone) || phone;
    if (!normalizedPhone || !text) return { skipped: true };

    if (findMessageByMetaId(messageId)?.durable) {
      return { skipped: true, reason: 'duplicate' };
    }

    const resolvedDirection = direction === 'inbound' ? 'inbound' : 'outbound';

    const createdAt = timestamp
      ? new Date(Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000).toISOString()
      : new Date().toISOString();

    const historyParent = db.upsertParentByPhone('לקוח וואטסאפ', normalizedPhone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
    });

    recordMessage({
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: resolvedDirection,
      message: text,
      status: 'synced',
      source: resolvedDirection === 'outbound' ? 'phone' : 'customer',
      meta_message_id: messageId || null,
      message_type: type || 'text',
      media_url: encodeMediaRef(mediaRef),
      meta: metaFromMediaRef(mediaRef),
      created_at: createdAt,
      parent_id: historyParent?.id || null,
    });

    if (resolvedDirection === 'inbound') {
      const phoneMatches = (db.get('parents') || []).filter((p) => phonesMatch(p.phone, normalizedPhone));
      for (const match of phoneMatches) {
        const handledTime = Date.parse(match.communication_handled_at || '');
        const historyTime = Date.parse(createdAt);
        const communicationHandledAt = new Date(
          Math.max(
            Number.isFinite(handledTime) ? handledTime : 0,
            Number.isFinite(historyTime) ? historyTime : 0
          )
        ).toISOString();
        const updatedParent = db.update('parents', match.id, {
          last_inbound_whatsapp: createdAt,
          communication_handled_at: communicationHandledAt,
          channel: match.channel === 'phone' ? 'whatsapp' : (match.channel || 'whatsapp'),
        });
        if (updatedParent) persistCore('parents', updatedParent).catch(() => {});
      }
    }

    return { success: true };
  },

  replyFromCrm: async (phone, text) => {
    if (!phone) return { success: false, error: 'חסר מספר טלפון' };
    if (!text || !String(text).trim()) return { success: false, error: 'חסר תוכן הודעה' };
    // Marked as a person, the way the bot is marked as the bot. A customer
    // should never have to guess which of the two just answered them.
    const result = await whatsappService.sendTextMessage(phone, withStaffMark(text), false);
    if (result.success) {
      const settings = mergeBotSettings(db.getSettings());
      if (settings.aiPauseOnHumanReply) {
        await pauseBotForPhone(phone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
      }
    }
    return result;
  },

  getLogsForPhone: (phone) => {
    const logs = db.get('whatsapp_logs') || [];
    return logs
      .filter(l => (l.channel || 'whatsapp') === 'whatsapp' && phonesMatch(l.phone || l.to || l.from, phone))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  },
};

/**
 * Recover customer text that was stored durably but never received a bot turn
 * (for example, a process restarted after the webhook write). The ordinary
 * gate, 24-hour window, open handoff and durable reply claim still apply.
 */
/**
 * How far back a swallowed message is still worth answering.
 *
 * Two hours covered a restart, and nothing else: nine customers from one day —
 * «אפשר לשבץ?», «לא מצליחה לרשום…» — were never answered at all, because by
 * the time anyone noticed they had aged out of the window. A day is the real
 * limit, because past it Meta will not carry free text anyway.
 */
export const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function unansweredRecoveryCandidates(messages = [], {
  now = Date.now(),
  minAgeMs = 20_000,
  maxAgeMs = RECOVERY_MAX_AGE_MS,
} = {}) {
  const byPhone = new Map();
  for (const message of messages) {
    if ((message.channel || 'whatsapp') !== 'whatsapp' || !message.phone) continue;
    const phone = formatWaPhone(message.phone) || message.phone;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(message);
  }

  const candidates = [];
  for (const [phone, rows] of byPhone) {
    rows.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    let lastSuccessfulOutbound = -1;
    rows.forEach((row, index) => {
      if (row.direction === 'outbound'
        && !['failed', 'undelivered', 'error'].includes(String(row.status || '').toLowerCase())) {
        lastSuccessfulOutbound = index;
      }
    });
    const pending = rows.slice(lastSuccessfulOutbound + 1).filter((row) => {
      const type = String(row.message_type || 'text').toLowerCase();
      const body = String(row.message || '').trim();
      return row.direction === 'inbound'
        && type === 'text'
        && body
        && !isClosingAcknowledgement(body)
        && !/^ריאקציה:/u.test(body);
    });
    if (!pending.length) continue;
    const lastAt = Date.parse(pending.at(-1).created_at || '');
    const age = now - lastAt;
    if (!Number.isFinite(lastAt) || age < minAgeMs || age > maxAgeMs) continue;
    candidates.push({ phone, pending, lastAt });
  }

  return candidates.sort((a, b) => a.lastAt - b.lastAt);
}

export async function recoverUnansweredConversations({
  now = Date.now(),
  minAgeMs = 20_000,
  maxAgeMs = RECOVERY_MAX_AGE_MS,
  // Five per sweep was a throttle for a two-hour window. Over a day it becomes
  // the reason somebody stays unanswered: the queue never drains.
  limit = 40,
} = {}) {
  const messages = db.get('messages') || [];
  const candidates = unansweredRecoveryCandidates(messages, { now, minAgeMs, maxAgeMs });
  const scanned = new Set(messages
    .filter((message) => (message.channel || 'whatsapp') === 'whatsapp' && message.phone)
    .map((message) => formatWaPhone(message.phone) || message.phone)).size;
  const results = [];
  for (const candidate of candidates.slice(0, Math.max(0, Number(limit) || 0))) {
    const parent = findPrimaryParent(candidate.phone);
    const items = candidate.pending.map((message) => ({
      text: message.message,
      messageId: message.meta_message_id || message.id,
      createdAt: message.created_at,
    }));
    const text = items.map((item) => item.text).join('\n');
    const result = await whatsappService.continueConversation(candidate.phone, text, {
      parent,
      students: studentsForParent(parent),
      replyKey: replyKeyForBurst(candidate.phone, items),
      lastInboundAt: new Date(candidate.lastAt).toISOString(),
      inboundBurstCount: items.length,
      respectGate: true,
    });
    results.push({ phone: candidate.phone, success: !!result?.success, reason: result?.reason || '' });
  }
  return { scanned, candidates: candidates.length, results };
}

function getInstagramToken() {
  const settings = db.getSettings();
  const token = settings.metaIgAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN || '';
  if (!token || token.includes('YOUR_')) return '';
  return token;
}

// Call Meta Instagram Graph API
// Instagram Login tokens (IGAAT…) must use graph.instagram.com/me/messages.
// Page tokens use graph.facebook.com/{ig-user-id}/messages.
async function callMetaInstagramAPI(recipientId, text) {
  const settings = db.getSettings();
  const token = getInstagramToken();

  if (!token) {
    console.log(`[Instagram Mock Mode] Sending to ${recipientId}: "${text}"`);
    return { mock: true, status: 'sent', messageId: `mock_ig_${Date.now()}` };
  }

  const isIgLoginToken = token.startsWith('IGAAT') || token.startsWith('IGAA');
  const accountId = settings.metaIgAccountId || process.env.META_IG_ACCOUNT_ID || 'me';
  const url = isIgLoginToken
    ? `https://graph.instagram.com/${META_GRAPH_VERSION}/me/messages`
    : `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        access_token: token
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Meta Instagram API error');
    }
    return { success: true, messageId: data.message_id };
  } catch (error) {
    console.error(`❌ Meta Instagram API failed for ${recipientId}:`, error.message);
    throw error;
  }
}

export const instagramService = {
  sendTextMessage: async (recipientId, text, isAi = false) => {
    try {
      const result = await callMetaInstagramAPI(recipientId, text);
      recordMessage({
        phone: recipientId,
        recipient_id: recipientId,
        channel: 'instagram',
        direction: 'outbound',
        message: text,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: isAi,
      });
      return { success: true, text };
    } catch (error) {
      recordMessage({
        phone: recipientId,
        recipient_id: recipientId,
        channel: 'instagram',
        direction: 'outbound',
        message: text,
        status: 'failed',
        is_ai: isAi,
      });
      return { success: false, error: error.message };
    }
  },

  handleIncomingMessage: async (igId, text, name = 'ליד מאינסטגרם', isSimulator = false) => {
    if (!isSimulator) await syncBotFlagFromRemote();

    // 1. Upsert lead / client details in DB
    const { parent, student, isNew } = await db.createLeadFromInstagram(igId, text, name);

    // 2. Store durably before the handling queue sees the customer
    const storedInbound = await recordMessageDurable({
      phone: igId,
      recipient_id: igId,
      channel: 'instagram',
      direction: 'inbound',
      message: text,
      status: 'received',
      source: 'customer',
      parent_id: parent?.id || null,
    });

    if (!storedInbound.ok) {
      console.error('❌ Inbound Instagram message was not stored durably:', storedInbound.error);
      return {
        parent,
        student,
        isNew,
        replied: false,
        durableError: storedInbound.error,
        skippedReason: 'not_persisted',
      };
    }

    if (parent?.id) {
      const updatedParent = db.update('parents', parent.id, {
        last_inbound_instagram: new Date().toISOString(),
        channel: parent.channel || 'instagram',
      });
      if (updatedParent) await persistCore('parents', updatedParent);
    }

    // 3. Process AI automated reply if active (schedule applies to live traffic)
    const settings = db.getSettings();
    if (shouldAiAutoReply(settings, { ignoreSchedule: isSimulator })) {
      const aiResult = await whatsappService.generateAIResponse(text);
      // Marked once, here, so the logged copy and the sent copy are the same
      // text — the CRM must show the customer exactly what the customer got.
      const aiReply = withBotMark(typeof aiResult === 'string' ? aiResult : aiResult?.text);
      if (!aiReply) {
        return { parent, student, isNew, replied: false };
      }
      const hasRealToken = !!getInstagramToken();
      if (isSimulator || !hasRealToken) {
        // Simulator / missing token: log locally only (no Meta call)
        recordMessage({
          phone: igId,
          recipient_id: igId,
          channel: 'instagram',
          direction: 'outbound',
          message: aiReply,
          status: 'sent',
          is_ai: true,
          parent_id: parent?.id || null,
        });
      } else {
        const sendResult = await instagramService.sendTextMessage(igId, aiReply, true);
        if (!sendResult.success) {
          console.error('❌ Instagram AI reply failed to deliver:', sendResult.error);
        }
      }
      return { parent, student, isNew, replied: true, reply: aiReply };
    }

    return {
      parent,
      student,
      isNew,
      replied: false,
      skippedReason: !settings.aiResponderEnabled
        ? 'disabled'
        : settings.aiActiveHoursEnabled && !isSimulator
          ? 'outside_hours'
          : null,
    };
  }
};
