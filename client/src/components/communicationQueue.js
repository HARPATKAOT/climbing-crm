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

