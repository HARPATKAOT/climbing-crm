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

export function isAwaitingHandling(parent, students = []) {
  const eventTime = awaitingSince(parent, students);
  if (!eventTime) return false;
  const handledTime = Date.parse(parent?.communication_handled_at || '');
  return !Number.isFinite(handledTime) || eventTime > handledTime;
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

