/**
 * The conversation continues after the form is signed.
 *
 * A parent asked to enrol ראם, was told the participation form comes first, and
 * filled it in — and the thread went quiet apart from a confirmation that said
 * "we will get back to you about placement". Everything needed to finish was
 * already in that conversation: the child, the class, the hour. So the bot goes
 * back to it, reads what was agreed, and asks whether to place them now.
 *
 * The whole turn runs through the ordinary model path — same tools, same
 * guards, same capability switches. Nothing here decides anything about the
 * customer; it only tells the bot that the thing it was waiting for happened.
 */
import { db } from './db.js';
import {
  findPrimaryParent,
  isBotPaused,
  isOptedOut,
  loadBrandedBotSettings,
  studentsForParent,
} from './whatsappBot.js';
import { isBotEnabled } from './whatsappSchedule.js';

/** Meta allows free text for 24 hours after the customer's last message. */
const FREE_TEXT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A conversation the bot was part of — not a form filled out of the blue. */
export function botSpokeRecently(messages = [], phone = '', now = Date.now()) {
  return messages.some((m) => m.direction === 'outbound'
    && m.is_ai
    && Date.parse(m.created_at || '') > now - FREE_TEXT_WINDOW_MS);
}

/** The form interrupted a grade question; resume it without asking one answer for two children. */
export function gradeQuestionAfterForm(messages = [], studentNames = []) {
  const lastBot = [...messages]
    .reverse()
    .find((message) => message.direction === 'outbound' && message.is_ai);
  if (!lastBot || !/כיתה/u.test(String(lastBot.message || ''))) return '';

  const firstNames = studentNames
    .map((name) => String(name || '').trim().split(/\s+/)[0])
    .filter((name) => name.length >= 2);
  const unique = [...new Set(firstNames)];
  if (!unique.length) return '';
  if (unique.length === 1) return `כדי להמשיך, מה הכיתה של ${unique[0]} כיום?`;
  if (unique.length === 2) {
    return `כדי להמשיך, מה הכיתה של ${unique[0]} כיום, ומה הכיתה של ${unique[1]}?`;
  }
  return `כדי להמשיך, כתבו בבקשה באיזו כיתה כל אחד מהילדים לומד כיום: ${unique.join(', ')}.`;
}

/**
 * @returns {{ sent: boolean, reason?: string, reply?: string }}
 */
export async function resumeConversationAfterForm({
  phone,
  studentNames = [],
  whatsappService,
  now = Date.now(),
  isSimulator = false,
} = {}) {
  const names = studentNames.map((n) => String(n || '').trim()).filter(Boolean);
  if (!phone || !names.length) return { sent: false, reason: 'missing_input' };

  const settings = await loadBrandedBotSettings();
  if (!isBotEnabled(settings) && !isSimulator) return { sent: false, reason: 'disabled' };

  const parent = findPrimaryParent(phone);
  if (!parent) return { sent: false, reason: 'no_card' };
  if (isOptedOut(parent)) return { sent: false, reason: 'opted_out' };
  if (isBotPaused(parent, new Date(now))) return { sent: false, reason: 'paused' };

  // Only where a conversation is actually open. A form filled from a link the
  // staff sent, with no bot conversation behind it, gets the confirmation the
  // automation already sends — not a question about a class nobody discussed.
  const messages = (db.get('messages') || []).filter((m) => String(m.phone || '') === String(parent.phone || phone));
  if (!botSpokeRecently(messages, phone, now)) return { sent: false, reason: 'no_recent_conversation' };
  const lastInbound = Date.parse(parent.last_inbound_whatsapp || '');
  if (!Number.isFinite(lastInbound) || now - lastInbound > FREE_TEXT_WINDOW_MS) {
    return { sent: false, reason: 'window_closed' };
  }

  // The bot itself asked for the grades immediately before the family opened
  // the form. There is no reason to spend a model turn rediscovering that next
  // step: in the real two-child thread the model ran out of steps and replaced
  // the question with a handoff. Resume the exact missing fact deterministically.
  const pendingGradeQuestion = gradeQuestionAfterForm(messages, names);
  if (pendingGradeQuestion) {
    await whatsappService.sendBotReply(phone, pendingGradeQuestion, { isSimulator });
    return { sent: true, reply: pendingGradeQuestion, deterministic: true };
  }

  const who = names.join(' ו');
  const result = await whatsappService.generateAIResponse(
    `[מערכת] טופס ההשתתפות של ${who} נחתם ונשמר זה עתה. המשך את השיחה מהמקום שבו עצרתם.`,
    { phone, parent, students: studentsForParent(parent), isSimulator }
  );
  let reply = String(result?.text || '').trim();

  // A model outage during a background continuation must never manufacture a
  // customer handoff. In Tali's thread the form confirmation was immediately
  // followed by "מעביר לצוות", and her polite "תודה" triggered the same text
  // again. If the interrupted question was the children's grades, that next
  // step is safe and deterministic; otherwise the confirmation already sent by
  // the form is enough and we stay quiet.
  if (!reply || result?.handoff) {
    reply = gradeQuestionAfterForm(messages, names);
    if (!reply) {
      return {
        sent: false,
        reason: result?.handoff ? 'handoff_suppressed' : (result?.reason || 'no_reply'),
      };
    }
  }

  await whatsappService.sendBotReply(phone, reply, { isSimulator });
  return { sent: true, reply, fallback: !!result?.handoff || !result?.text };
}
