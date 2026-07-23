/** 24-hour customer care window helpers (Meta messaging). */

const WINDOW_MS = 24 * 60 * 60 * 1000;

const CHANNEL_INBOUND_FIELDS = {
  whatsapp: 'last_inbound_whatsapp',
  instagram: 'last_inbound_instagram',
  messenger: 'last_inbound_messenger',
};

export function getSessionWindow(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) {
    return { open: false, expiresAt: null, remainingMs: 0, label: 'סגור' };
  }
  const ts = new Date(lastInboundAt).getTime();
  if (Number.isNaN(ts)) {
    return { open: false, expiresAt: null, remainingMs: 0, label: 'סגור' };
  }
  const expiresAt = ts + WINDOW_MS;
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) {
    return { open: false, expiresAt: new Date(expiresAt).toISOString(), remainingMs: 0, label: 'סגור' };
  }
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  const label = hours > 0 ? `פתוח עוד ${hours} שע׳ ${mins} דק׳` : `פתוח עוד ${mins} דק׳`;
  return { open: true, expiresAt: new Date(expiresAt).toISOString(), remainingMs, label };
}

export function getParentChannelWindows(parent, now = Date.now()) {
  const channels = {};
  for (const [channel, field] of Object.entries(CHANNEL_INBOUND_FIELDS)) {
    channels[channel] = getSessionWindow(parent?.[field], now);
  }
  return channels;
}

function newerInboundIso(currentIso, candidateIso) {
  if (!candidateIso) return currentIso || null;
  const candidateTs = new Date(candidateIso).getTime();
  if (Number.isNaN(candidateTs)) return currentIso || null;
  const currentTs = currentIso ? new Date(currentIso).getTime() : 0;
  if (!currentTs || Number.isNaN(currentTs) || candidateTs > currentTs) {
    return new Date(candidateTs).toISOString();
  }
  return currentIso;
}

/** Prefer the newer of parent.last_inbound_* vs latest inbound message in the thread. */
export function enrichParentInboundFromMessages(parent, messages = []) {
  if (!parent) return parent;
  const patch = {};
  for (const [channel, field] of Object.entries(CHANNEL_INBOUND_FIELDS)) {
    let latestMsgAt = null;
    for (const m of messages) {
      if (m.direction !== 'inbound') continue;
      if ((m.channel || 'whatsapp') !== channel) continue;
      const raw = m.created_at || m.timestamp;
      if (!raw) continue;
      const ts = new Date(raw).getTime();
      if (Number.isNaN(ts)) continue;
      if (!latestMsgAt || ts > latestMsgAt) latestMsgAt = ts;
    }
    if (!latestMsgAt) continue;
    const next = newerInboundIso(parent[field], new Date(latestMsgAt).toISOString());
    if (next && next !== parent[field]) patch[field] = next;
  }
  return Object.keys(patch).length ? { ...parent, ...patch } : parent;
}

/**
 * Duplicate parent rows for the same phone (050… vs 972…) can leave last_inbound
 * on one card while the UI opens another. Copy the newest timestamp across siblings.
 */
export function enrichParentInboundFromSiblings(parent, siblings = []) {
  if (!parent || !siblings.length) return parent;
  const patch = {};
  for (const field of Object.values(CHANNEL_INBOUND_FIELDS)) {
    let best = parent[field] || null;
    for (const sibling of siblings) {
      if (!sibling || sibling.id === parent.id) continue;
      best = newerInboundIso(best, sibling[field]);
    }
    if (best && best !== parent[field]) patch[field] = best;
  }
  return Object.keys(patch).length ? { ...parent, ...patch } : parent;
}

export function canSendFreeform(parent, channel) {
  const field = CHANNEL_INBOUND_FIELDS[channel];
  if (!field) return false;
  return getSessionWindow(parent?.[field]).open;
}

export function inboundFieldForChannel(channel) {
  return CHANNEL_INBOUND_FIELDS[channel] || null;
}

export { CHANNEL_INBOUND_FIELDS, WINDOW_MS };
