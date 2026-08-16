const INBOUND_FIELDS = [
  'last_inbound_whatsapp',
  'last_inbound_instagram',
  'last_inbound_messenger',
];

export function latestInboundTime(parent) {
  const times = INBOUND_FIELDS
    .map((field) => Date.parse(parent?.[field] || ''))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

/**
 * A family that just registered is waiting on us as surely as one that just
 * wrote to us — somebody has to call and schedule the intro session. They were
 * invisible here, because the queue only knew about inbound messages, so a
 * form filled at midnight sat unnoticed among 150 older cards.
 *
 * Two limits keep this to actual work. Only a registration nobody has moved
 * along yet: once the status leaves "signed", someone has picked it up. And
 * only a recent one, so switching this on does not empty years of history into
 * the queue.
 */
const FRESH_REGISTRATION_MS = 14 * 24 * 60 * 60 * 1000;

export function latestRegistrationTime(students = [], now = Date.now()) {
  const times = (Array.isArray(students) ? students : [students])
    .filter((student) => ['health_signed', 'details_completed'].includes(student?.status))
    .map((student) => Date.parse(student?.healthSignedAt || student?.waiverSignedAt || ''))
    .filter(Number.isFinite)
    .filter((time) => now - time <= FRESH_REGISTRATION_MS);
  return times.length ? Math.max(...times) : 0;
}

/** When this family last did something that asks for a reply. */
export function awaitingSince(parent, students = []) {
  return Math.max(latestInboundTime(parent), latestRegistrationTime(students));
}

function familyParentsOf(row) {
  return row?.parents?.length ? row.parents : [row?.parent];
}

function familyAwaitingSince(row) {
  return Math.max(
    0,
    ...familyParentsOf(row).map((parent) => awaitingSince(parent, row?.students || []))
  );
}

/**
 * „ממתינים לטיפול” — רק מי שהתהליך שלו נעצר והבוט העביר אותו לצוות.
 *
 * בהתחלה כל שיחה נכנסת נכנסה לתור, כדי שתהיה בקרה על הבוט. משהבוט עונה לבד,
 * תור כזה הוא רשימת כל השיחות בשם אחר, ומי שבאמת תקוע נבלע בתוכה. הסימן
 * היחיד שיש כאן עבודה לאדם הוא `bot_handoff_at`: הבוט רשם אותו כשהעביר את
 * השיחה, והוא מתאפס לבד ברגע שאיש צוות עונה ללקוח (מהמערכת או מהטלפון).
 *
 * שני סייגים: העברה ישנה מדי היא היסטוריה ולא תור, וסימון „לקוח טופל”
 * (`communication_handled_at`) סוגר אותה ידנית.
 */
export const MAX_HANDOFF_WAIT_MS = 14 * 24 * 60 * 60 * 1000;

export function handoffSince(parent) {
  const handed = Date.parse(parent?.bot_handoff_at || '');
  return Number.isFinite(handed) ? handed : 0;
}

export function isHandedToStaff(parent, now = Date.now()) {
  const handed = handoffSince(parent);
  if (!handed) return false;
  if (now - handed > MAX_HANDOFF_WAIT_MS) return false;
  const handledTime = Date.parse(parent?.communication_handled_at || '');
  return !(Number.isFinite(handledTime) && handledTime >= handed);
}

/** ההעברה הוותיקה ביותר שעדיין פתוחה במשק הבית (0 — אין כזו). */
export function familyHandoffSince(row, now = Date.now()) {
  const times = familyParentsOf(row)
    .filter((parent) => isHandedToStaff(parent, now))
    .map((parent) => handoffSince(parent));
  return times.length ? Math.min(...times) : 0;
}

/** האם למשק הבית יש בכלל שיחה — כלומר מישהו בו כתב לנו אי פעם. */
export function hasConversation(parent) {
  return latestInboundTime(parent) > 0;
}

/** מתי מישהו במשק הבית כתב לנו לאחרונה — בלי לערבב הרשמות. */
export function familyLatestInbound(row) {
  return Math.max(0, ...familyParentsOf(row).map((parent) => latestInboundTime(parent)));
}

function familyParentName(row) {
  return [row?.parent?.name, row?.parent?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
}

const HEBREW_NAME_COLLATOR = new Intl.Collator('he', {
  sensitivity: 'base',
  numeric: true,
});

/**
 * Sort the household-level handling queue without mutating its source rows.
 *
 * `timeOf` is what „זמן שיחה” means for this list: the waiting queue counts a
 * fresh registration as an event, the conversations tab counts only messages.
 */
export function sortCommunicationRows(rows = [], sortBy = 'conversation_desc', timeOf = familyAwaitingSince) {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let difference = 0;
    if (sortBy === 'conversation_asc') {
      difference = timeOf(a) - timeOf(b);
    } else if (sortBy === 'name_asc') {
      difference = HEBREW_NAME_COLLATOR.compare(familyParentName(a), familyParentName(b));
    } else if (sortBy === 'created_desc') {
      difference = (Date.parse(b?.created || '') || 0) - (Date.parse(a?.created || '') || 0);
    } else if (sortBy === 'created_asc') {
      difference = (Date.parse(a?.created || '') || 0) - (Date.parse(b?.created || '') || 0);
    } else {
      difference = timeOf(b) - timeOf(a);
    }

    if (difference) return difference;
    const nameDifference = HEBREW_NAME_COLLATOR.compare(familyParentName(a), familyParentName(b));
    if (nameDifference) return nameDifference;
    return String(a?.key || '').localeCompare(String(b?.key || ''));
  });
  return sorted;
}

/** תור ההעברות לצוות — מי שממתין הכי הרבה זמן נמצא למעלה. */
export function sortHandoffRows(rows = []) {
  return sortCommunicationRows(rows, 'conversation_asc', familyHandoffSince);
}

/** כל השיחות, לפי סדר השיחה עצמה. */
export function sortConversationRows(rows = [], sortBy = 'conversation_desc') {
  return sortCommunicationRows(rows, sortBy, familyLatestInbound);
}

/** The row immediately after the open household in the visible queue order. */
export function nextCommunicationRow(rows = [], currentParentIds = []) {
  const wantedIds = new Set(
    (Array.isArray(currentParentIds) ? currentParentIds : [currentParentIds])
      .filter((id) => id != null)
      .map(String)
  );
  if (!wantedIds.size) return null;

  const currentIndex = rows.findIndex((row) => (
    (row?.parents?.length ? row.parents : [row?.parent])
      .some((parent) => parent?.id != null && wantedIds.has(String(parent.id)))
  ));
  return currentIndex >= 0 ? rows[currentIndex + 1] || null : null;
}

export function isAwaitingHandling(parent, students = []) {
  const eventTime = awaitingSince(parent, students);
  if (!eventTime) return false;
  const handledTime = Date.parse(parent?.communication_handled_at || '');
  return !Number.isFinite(handledTime) || eventTime > handledTime;
}

function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return digits.slice(3);
  return digits.replace(/^0/, '');
}

function messageBelongsToThread(message, thread, parentPhone) {
  if (!thread) return false;
  const channel = message?.channel || 'whatsapp';
  if (thread.role === 'parent') {
    if (channel !== 'whatsapp') return true;
    if (message?.student_id || message?.fromChild) return false;
    if (!thread.phone) return !message?.phone || phoneKey(message.phone) === phoneKey(parentPhone);
    return !message?.phone
      || phoneKey(message.phone) === phoneKey(thread.phone)
      || phoneKey(message.phone) === phoneKey(parentPhone);
  }
  if (channel !== 'whatsapp') return false;
  if (message?.student_id && thread.studentId) {
    return String(message.student_id) === String(thread.studentId);
  }
  return phoneKey(message?.phone) === phoneKey(thread.phone);
}

/** True only when this exact person's thread ends with a message from them. */
export function threadIsAwaitingReply(conversation, threadId = 'parent') {
  const threads = Array.isArray(conversation?.threads) ? conversation.threads : [];
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) return false;

  let latestMessage = null;
  let latestTime = 0;
  for (const message of conversation?.messages || []) {
    if (!messageBelongsToThread(message, thread, conversation?.parent?.phone)) continue;
    const time = Date.parse(message?.created_at || '') || 0;
    if (!latestMessage || time >= latestTime) {
      latestMessage = message;
      latestTime = time;
    }
  }
  return latestMessage?.direction === 'inbound';
}

/**
 * When this exact person last wrote to us, in epoch ms (0 — never).
 *
 * The customer card only knows that *somebody* on this number wrote: a child
 * writing from their own phone stamps the parent's card too. Which of them it
 * was is only in the messages, so this is what decides whose thread opens.
 */
export function latestInboundInThread(conversation, threadId = 'parent') {
  const threads = Array.isArray(conversation?.threads) ? conversation.threads : [];
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) return 0;

  let latest = 0;
  for (const message of conversation?.messages || []) {
    if (message?.direction !== 'inbound') continue;
    if (!messageBelongsToThread(message, thread, conversation?.parent?.phone)) continue;
    const time = Date.parse(message?.created_at || '') || 0;
    if (time > latest) latest = time;
  }
  return latest;
}

/**
 * Which household member the card should open on: the one who wrote to us last.
 *
 * The waiting-for-handling row carries the primary parent's name, but the
 * message just as often came from the second parent, or from a child on their
 * own phone. Landing on that person's empty thread reads as „there is no
 * message here”, and the customer keeps waiting while the agent moves on.
 *
 * Until a thread is loaded only the parent card can speak, and it speaks for
 * everyone who shares its number — so a card-level answer is marked `exact:
 * false`, and the caller asks again once the conversations arrive.
 *
 * @param targetForTab (tab) => { parentId, threadId } | null
 * @param conversationFor (parentId) => conversation | null
 */
export function pickCommunicationTarget(tabs = [], { targetForTab, conversationFor }) {
  let best = null;
  for (const tab of tabs) {
    const target = targetForTab(tab);
    if (!target) continue;
    const conversation = conversationFor(target.parentId);
    const inThread = conversation ? latestInboundInThread(conversation, target.threadId) : 0;
    const at = inThread
      || (conversation || target.threadId !== 'parent' ? 0 : latestInboundTime(tab.parent));
    if (!at) continue;
    const exact = !!inThread;
    // A named sender beats the card that only knows the number, at equal time.
    if (!best || at > best.at || (at === best.at && exact && !best.exact)) {
      best = { tab, target, at, exact };
    }
  }
  return best;
}

// Clock skew between the customer card and the message timestamp.
const INBOUND_MATCH_TOLERANCE_MS = 2000;

/**
 * True when the customer card knows about an inbound message the open
 * conversation does not show yet. The gap is surfaced, never hidden.
 */
export function threadIsBehindCard(parent, messages = []) {
  const cardInbound = latestInboundTime(parent);
  if (!cardInbound) return false;
  const inThread = messages
    .filter((m) => m.direction === 'inbound')
    .map((m) => Date.parse(m.created_at || ''))
    .filter(Number.isFinite);
  const latestInThread = inThread.length ? Math.max(...inThread) : 0;
  if (!latestInThread) return true;
  return cardInbound > latestInThread + INBOUND_MATCH_TOLERANCE_MS;
}

