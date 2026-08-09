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
    .filter((student) => student?.status === 'health_signed')
    .map((student) => Date.parse(student?.healthSignedAt || student?.waiverSignedAt || ''))
    .filter(Number.isFinite)
    .filter((time) => now - time <= FRESH_REGISTRATION_MS);
  return times.length ? Math.max(...times) : 0;
}

/** When this family last did something that asks for a reply. */
export function awaitingSince(parent, students = []) {
  return Math.max(latestInboundTime(parent), latestRegistrationTime(students));
}

function familyAwaitingSince(row) {
  const familyParents = row?.parents?.length ? row.parents : [row?.parent];
  return Math.max(
    0,
    ...familyParents.map((parent) => awaitingSince(parent, row?.students || []))
  );
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

/** Sort the household-level handling queue without mutating its source rows. */
export function sortCommunicationRows(rows = [], sortBy = 'conversation_desc') {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let difference = 0;
    if (sortBy === 'conversation_asc') {
      difference = familyAwaitingSince(a) - familyAwaitingSince(b);
    } else if (sortBy === 'name_asc') {
      difference = HEBREW_NAME_COLLATOR.compare(familyParentName(a), familyParentName(b));
    } else if (sortBy === 'created_desc') {
      difference = (Date.parse(b?.created || '') || 0) - (Date.parse(a?.created || '') || 0);
    } else if (sortBy === 'created_asc') {
      difference = (Date.parse(a?.created || '') || 0) - (Date.parse(b?.created || '') || 0);
    } else {
      difference = familyAwaitingSince(b) - familyAwaitingSince(a);
    }

    if (difference) return difference;
    const nameDifference = HEBREW_NAME_COLLATOR.compare(familyParentName(a), familyParentName(b));
    if (nameDifference) return nameDifference;
    return String(a?.key || '').localeCompare(String(b?.key || ''));
  });
  return sorted;
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

