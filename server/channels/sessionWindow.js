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

export function canSendFreeform(parent, channel) {
  const field = CHANNEL_INBOUND_FIELDS[channel];
  if (!field) return false;
  return getSessionWindow(parent?.[field]).open;
}

export function inboundFieldForChannel(channel) {
  return CHANNEL_INBOUND_FIELDS[channel] || null;
}

export { CHANNEL_INBOUND_FIELDS, WINDOW_MS };
