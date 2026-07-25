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

export function isAwaitingHandling(parent) {
  const inboundTime = latestInboundTime(parent);
  if (!inboundTime) return false;
  const handledTime = Date.parse(parent?.communication_handled_at || '');
  return !Number.isFinite(handledTime) || inboundTime > handledTime;
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

