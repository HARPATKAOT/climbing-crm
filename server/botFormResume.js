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
  hasOpenBotHandoff,
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

/**
 * A parent who submits the form while the conversation is running gets the
 * ordinary reply and this one within seconds of each other — two messages in a
 * row about the same placement. The turn that is already answering wins: it
 * knows what was just asked, and this one is only here for the silence.
 */
const JUST_ANSWERED_MS = 3 * 60 * 1000;

export function botAnsweredMomentsAgo(messages = [], now = Date.now()) {
  return messages.some((m) => m.direction === 'outbound'
    && m.is_ai
    && Date.parse(m.created_at || '') > now - JUST_ANSWERED_MS);
}

/** Somebody already placed them — there is nothing left to ask. */
export function allNamedArePlaced(students = [], names = []) {
  const wanted = names.map((name) => String(name || '').trim().split(/\s+/)[0]).filter(Boolean);
  if (!wanted.length) return false;
  return wanted.every((first) => students.some((student) => String(student?.name || '').includes(first)
    && student?.groupId));
}

/**
 * Form completion has one deterministic customer-facing continuation.  The
 * possible groups were already presented before the form was sent, so another
 * model turn only repeats the form confirmation or reopens data collection.
 */
export function placementQuestionAfterForm(studentNames = []) {
  const firstNames = studentNames
    .map((name) => String(name || '').trim().split(/\s+/)[0])
    .filter(Boolean);
  const unique = [...new Set(firstNames)];
  if (unique.length <= 1) return 'הפרטים התקבלו. לאיזו קבוצה תרצו להשתבץ?';
  return `הפרטים התקבלו. לאילו קבוצות תרצו לשבץ את ${unique.join(' ו')}?`;
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
  // Completing a form updates the existing staff task; it must not reopen the
  // bot and ask the customer to choose again while a human decision is still
  // pending (for example, an exceptional placement consultation).
  if (hasOpenBotHandoff(parent, phone)) return { sent: false, reason: 'handoff_pending' };

  // Only where a conversation is actually open. A form filled from a link the
  // staff sent, with no bot conversation behind it, gets the confirmation the
  // automation already sends — not a question about a class nobody discussed.
  const messages = (db.get('messages') || []).filter((m) => String(m.phone || '') === String(parent.phone || phone));
  if (!botSpokeRecently(messages, phone, now)) return { sent: false, reason: 'no_recent_conversation' };
  // Two messages in a row about the same placement: the ordinary turn had just
  // answered, and this one arrived seconds later saying much the same thing.
  if (botAnsweredMomentsAgo(messages, now)) return { sent: false, reason: 'just_answered' };
  if (allNamedArePlaced(studentsForParent(parent), names)) {
    return { sent: false, reason: 'already_placed' };
  }
  const lastInbound = Date.parse(parent.last_inbound_whatsapp || '');
  if (!Number.isFinite(lastInbound) || now - lastInbound > FREE_TEXT_WINDOW_MS) {
    return { sent: false, reason: 'window_closed' };
  }

  const reply = placementQuestionAfterForm(names);
  await whatsappService.sendBotReply(phone, reply, { isSimulator });
  return { sent: true, reply, deterministic: true };
}
