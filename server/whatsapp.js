import { db, persistCore, syncBotFlagFromRemote } from './db.js';
import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';
import { buildTemplateParameters } from './channels/templates.js';
import {
  recordMessage,
  recordMessageDurable,
  findMessageByMetaId,
  claimInboundMetaId,
  releaseInboundMetaId,
} from './channels/messageStore.js';
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
import { READ_TOOLS, runChatTurn } from './aiChat.js';
import {
  mergeBotSettings,
  withBotMark,
  isCentrePhone,
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
import {
  matchLearnedReplies,
  formatLearnedRepliesForPrompt,
  proposeFromHandoffStaffReply,
} from './botLearning.js';
import { runCustomerToolTurn, historyToContents } from './botToolTurn.js';
import { alertRecipients } from './staffAlerts.js';
import { recordBotAction } from './botActivityLog.js';
import { isCapabilityEnabled } from './botCapabilities.js';
import { buildCentreReport, formatReportDate } from './centreReport.js';

/**
 * What the bot says when it cannot answer at all — no model key, a model error,
 * or a turn that ran out of steps.
 *
 * A keyword engine used to answer here from guessed intent. It is gone: a wrong
 * confident sentence costs more than a customer waiting for a person, and this
 * path always alerts the team, so nobody is left waiting silently.
 */
const MODEL_UNAVAILABLE_REPLY = 'קיבלנו 🙏\nמעביר לצוות שלנו — מישהו יחזור אליכם בהקדם.';

export { israelClockParts, isBotEnabled, shouldAiAutoReply };

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

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
    reason === 'unsure' ? 'סיבה: הבוט לא היה בטוח' : 'סיבה: העברה לצוות',
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
        to: formattedPhone,
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
        text: { body }
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

  // Generate automated AI response
  generateAIResponse: async (incomingText, context = {}) => {
    const settings = await loadBrandedBotSettings();
    const phone = context.phone || '';
    const parent = context.parent || (phone ? findPrimaryParent(phone) : null);
    const students = context.students || (parent ? studentsForParent(parent) : []);
    // When the inbound number belongs to a trainee, greet that trainee — not
    // the parent whose card the thread is filed under.
    const speaker = context.speaker || null;

    const apiKey = process.env.GEMINI_API_KEY;
    const hasModel = !!apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE';

    // The model reads the message and asks the CRM for the facts it needs.
    // There is no second engine behind this one: a keyword layer used to guess
    // the intent here and answer from that guess, which is how a customer got a
    // confident sentence nobody had checked.
    if (hasModel) {
      const historyLimit = normalizeHistoryLimit(settings.aiHistoryCount, 8);
      // The knowledge base, the bounds rules and the approved learned examples
      // all reach the model — a parking question is answered from the knowledge
      // base, and the learning loop feeds back in here.
      const learnedBlock = formatLearnedRepliesForPrompt(matchLearnedReplies(db, incomingText));
      const turn = await runCustomerToolTurn({
        systemInstruction: [
          `שם העסק הרשמי: ${settings.brandName || 'הרפתקאות'}\nהזכר את העסק רק בשם הרשמי הזה.`,
          settings.aiSystemPrompt,
          buildParentCardContext(parent, students, { speaker }),
          settings.aiBusinessFacts ? `עובדות העסק:\n${settings.aiBusinessFacts}` : '',
          settings.aiKnowledgeBase ? `בסיס ידע / שאלות נפוצות:\n${settings.aiKnowledgeBase}` : '',
          settings.aiForbiddenTopics ? `אסור:\n${settings.aiForbiddenTopics}` : '',
          BOT_BOUNDS_RULES,
          learnedBlock,
        ].filter(Boolean).join('\n\n'),
        history: historyToContents(phone ? getChatHistoryMessages(phone, historyLimit) : []),
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
        return {
          text: clipReply(turn.text, settings.aiMaxReplyChars),
          handoff: turn.handoff,
          unsure: turn.unsure,
          confidence: 'medium',
          toolsUsed: turn.toolsUsed,
        };
      }
      // Out of steps, a model error, or an empty answer.
      console.error(`bot tool turn produced nothing (${turn.reason}) — handing over`);
      return {
        text: MODEL_UNAVAILABLE_REPLY,
        handoff: true,
        unsure: false,
        confidence: 'low',
        reason: turn.reason,
      };
    }

    // A bot with no model does not improvise. It says so, and fetches a person.
    console.error('Gemini API key missing — the bot has no reply engine');
    return {
      text: MODEL_UNAVAILABLE_REPLY,
      handoff: true,
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

  async sendBotReply(phone, replyText, { isSimulator = false, source = 'ai', parent = null, logType = '' } = {}) {
    if (!replyText) return { success: false };
    const text = withBotMark(replyText);
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
    return whatsappService.sendTextMessage(phone, text, true, { source });
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

    if (!text) {
      return { parent, student, isNew, replied: false, skippedReason: 'empty' };
    }

    // Reactions are conversation metadata, not a customer question. Detect
    // them before staff routing and before the hours gate, otherwise a reaction
    // outside opening hours receives an automatic "we are closed" reply.
    const isReaction = String(meta.type || '') === 'reaction'
      || /^ריאקציה:\s*/u.test(String(text || '').trim());
    if (isReaction) {
      return { parent, student, isNew, replied: false, skippedReason: 'reaction' };
    }

    // A media-only message cannot be read by the model. It still obeys hard
    // silence states (bot off, opt-out, an active human thread), but it should
    // not be replaced by the outside-hours template.
    const mediaOnly = MEDIA_MESSAGE_TYPES.has(String(meta.type || ''))
      && (!text || /^\[[^\]\r\n]+\]$/u.test(String(text).trim()));

    // 4b. Staff numbers talk to the CRM agent, not to the customer bot.
    if (isStaffPhone(settings, normalizedPhone)) {
      if (!isBotEnabled(settings) && !isSimulator) {
        console.log(`🤖 Staff query ignored while the bot is off (${normalizedPhone})`);
        return { parent, student, isNew, replied: false, skippedReason: 'disabled' };
      }
      const staffReply = await whatsappService.runStaffChat(normalizedPhone, text);
      await whatsappService.sendBotReply(normalizedPhone, staffReply, { isSimulator, source: 'staff_chat' });
      return { parent, student, isNew, replied: true, reply: staffReply, reason: 'staff_chat' };
    }

    // The community centre writes us a child's name and waits for a billing
    // date. It is a fixed exchange with one right answer, so it never reaches
    // the model: a wrong date here is a wrong charge to a family.
    if (isCapabilityEnabled(settings, 'centre_report') && isCentrePhone(settings, normalizedPhone)) {
      const report = await handleCentreMessage({ text, phone: normalizedPhone, isSimulator });
      if (report) {
        await whatsappService.sendBotReply(normalizedPhone, report.reply, {
          isSimulator, source: 'bot_control', logType: 'reply',
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
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'reactivated' };
    }

    if (gate.action === 'opt_out') {
      await optOutPhone(normalizedPhone, true, { source: 'customer' });
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'opt_out' };
    }

    if (gate.action === 'silence') {
      console.log(`🤖 Bot silence (${gate.reason}) for ${normalizedPhone}`);
      return { parent, student, isNew, replied: false, skippedReason: gate.reason };
    }

    if (mediaOnly) {
      const mediaReply = 'קיבלנו 🙏 מעביר לצוות שלנו שיסתכל ויחזור אליכם.';
      await whatsappService.sendBotReply(normalizedPhone, mediaReply, { isSimulator, source: 'bot_control' });
      await notifyStaffOfHandoff({
        settings,
        parent,
        phone: normalizedPhone,
        customerText: `[${meta.type}] הלקוח שלח קובץ מדיה`,
        reason: 'handoff',
        isSimulator,
      });
      return { parent, student, isNew, replied: true, reply: mediaReply, reason: 'media' };
    }

    if (gate.action === 'outside_hours') {
      if (isSimulator || shouldSendOutsideHoursMessage(parent)) {
        await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
        if (!isSimulator) await markOutsideHoursSent(normalizedPhone);
        return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'outside_hours' };
      }
      return { parent, student, isNew, replied: false, skippedReason: 'outside_hours' };
    }

    if (gate.action === 'handoff') {
      await recordBotHandoff(normalizedPhone);
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
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

    let aiIncomingText = text;

    // Identity collection is not optional, and it runs before the model.
    // A trainee writing from their known personal phone is already identified;
    // every other incomplete card must supply first + family name first.
    if (matchedVia !== 'child_phone'
      && !hasCustomerFullName(parent)) {
      const nameCapture = await advanceCustomerNameCapture(normalizedPhone, parent, text);
      if (!nameCapture.done) {
        await whatsappService.sendBotReply(normalizedPhone, nameCapture.reply, {
          isSimulator,
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
      aiIncomingText = nameCapture.pendingMessage || text;
    }

    const speaker = matchedVia === 'child_phone' ? student : null;
    const aiResult = await whatsappService.generateAIResponse(aiIncomingText, {
      phone: normalizedPhone,
      parent,
      students,
      speaker,
      isSimulator,
    });
    if (aiResult.handoff) {
      await recordBotHandoff(normalizedPhone);
      // Prefer the model's natural wording; canned ack only when empty.
      const handoffText = aiResult.text || settings.aiHandoffAckMessage;
      await whatsappService.sendBotReply(normalizedPhone, handoffText, {
        isSimulator,
        source: 'bot_control',
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

    await whatsappService.sendBotReply(normalizedPhone, aiResult.text, { isSimulator });
    return { parent, student, isNew, replied: true, reply: aiResult.text };
    } finally {
      releaseInboundMetaId(metaMessageId);
    }
  },

  // Messages sent from WhatsApp Business app (Coexistence echoes)
  handlePhoneEcho: async ({ phone, text, messageId, type } = {}) => {
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
      parent_id: echoParent?.id || null,
    });

    const settings = mergeBotSettings(db.getSettings());
    if (settings.aiPauseOnHumanReply) {
      await pauseBotForPhone(normalizedPhone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
    }

    // After a bot handoff, staff's reply becomes a learning candidate.
    try {
      await proposeFromHandoffStaffReply({
        db,
        persist: persistCore,
        phone: normalizedPhone,
        parent: echoParent,
        staffText: text,
        createdBy: 'handoff_mine',
      });
    } catch (err) {
      console.error('Handoff learning propose failed:', err.message);
    }

    return { success: true, phone: normalizedPhone };
  },

  // Initial history sync payloads from Coexistence onboarding
  handleHistoryMessage: async ({ phone, text, direction, messageId, timestamp, type } = {}) => {
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
    const result = await whatsappService.sendTextMessage(phone, String(text).trim(), false);
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
