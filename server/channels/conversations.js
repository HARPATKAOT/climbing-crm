import { db, persistCore } from '../db.js';
import { phonesMatch, normalizeWaPhone } from '../whatsappConnect.js';
import {
  getParentChannelWindows,
  canSendFreeform,
  inboundFieldForChannel,
  enrichParentInboundFromMessages,
  enrichParentInboundFromSiblings,
  CHANNEL_INBOUND_FIELDS,
} from './sessionWindow.js';
import { uploadWhatsAppMedia, getMessengerCredentials, META_GRAPH_VERSION } from './media.js';
import { whatsappService, instagramService } from '../whatsapp.js';

function ageFromBirthDate(birthDate) {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

function findParentById(parentId) {
  return (db.get('parents') || []).find((p) => p.id === parentId) || null;
}

function findParentsByPhone(phone) {
  if (!phone) return [];
  return (db.get('parents') || []).filter((p) => phonesMatch(p.phone, phone));
}

function findParentForLog(log) {
  const parents = db.get('parents') || [];
  const channel = log.channel || 'whatsapp';
  if (channel === 'instagram') {
    return parents.find((p) => p.instagram_id && String(p.instagram_id) === String(log.phone || log.recipient_id)) || null;
  }
  if (channel === 'messenger') {
    return parents.find((p) => p.messenger_psid && String(p.messenger_psid) === String(log.phone || log.recipient_id)) || null;
  }
  const matches = findParentsByPhone(log.phone);
  if (!matches.length) return null;
  // Prefer the CRM card with real details over a bare WhatsApp lead duplicate.
  return [...matches].sort((a, b) => scoreParentRecord(b) - scoreParentRecord(a))[0];
}

function scoreParentRecord(parent) {
  if (!parent) return 0;
  let score = 0;
  if (parent.email) score += 4;
  if (parent.idNumber) score += 3;
  if (parent.name && parent.name !== 'לקוח וואטסאפ' && parent.name !== 'ליד מאינסטגרם') score += 3;
  if (parent.last_inbound_whatsapp || parent.last_inbound_instagram || parent.last_inbound_messenger) score += 1;
  if (parent.status && parent.status !== 'lead_new') score += 1;
  return score;
}

function touchInbound(parent, channel, at = new Date().toISOString()) {
  if (!parent?.id) return null;
  const field = inboundFieldForChannel(channel);
  if (!field) return null;
  return db.update('parents', parent.id, { [field]: at, channel: parent.channel || channel });
}

/** Open/refresh the 24h window on every parent row that shares this phone. */
export function touchInboundForPhone(phone, channel = 'whatsapp', at = new Date().toISOString()) {
  const field = inboundFieldForChannel(channel);
  if (!field || !phone) return [];
  const updated = [];
  for (const parent of findParentsByPhone(phone)) {
    const next = db.update('parents', parent.id, {
      [field]: at,
      channel: parent.channel === 'phone' ? channel : (parent.channel || channel),
    });
    if (next) {
      updated.push(next);
      persistCore('parents', next).catch(() => {});
    }
  }
  return updated;
}

function logMessage(record) {
  const created = db.insert('whatsapp_logs', {
    phone: record.phone || record.recipient_id || '',
    channel: record.channel || 'whatsapp',
    direction: record.direction || 'outbound',
    message: record.message || '',
    status: record.status || 'sent',
    is_ai: !!record.is_ai,
    source: record.source || 'crm',
    meta_message_id: record.meta_message_id || null,
    template_id: record.template_name || record.template_id || null,
    message_type: record.media_type || record.message_type || 'text',
    media_url: record.media_url || null,
    parent_id: record.parent_id || null,
  });

  try {
    db.insert('messages', {
      id: `msg_${created.id}`,
      parent_id: record.parent_id || null,
      channel: record.channel || 'whatsapp',
      direction: record.direction || 'outbound',
      message: record.message || '',
      media_url: record.media_url || null,
      media_type: record.media_type || null,
      template_name: record.template_name || null,
      status: record.status || 'sent',
      source: record.source || 'crm',
      is_ai: !!record.is_ai,
      meta_message_id: record.meta_message_id || null,
      phone: record.phone || null,
      recipient_id: record.recipient_id || null,
      created_at: created.created_at,
    });
  } catch (err) {
    console.warn('messages insert failed:', err.message);
  }

  return created;
}

export function markInboundForParent(parent, channel, meta = {}) {
  if (!parent) return;
  const at = meta.timestamp
    ? new Date(Number(meta.timestamp) > 1e12 ? Number(meta.timestamp) : Number(meta.timestamp) * 1000).toISOString()
    : new Date().toISOString();
  touchInbound(parent, channel, at);
}

export function updateMessageStatusByMetaId(metaMessageId, status) {
  if (!metaMessageId) return;
  const logs = db.get('whatsapp_logs') || [];
  const log = logs.find((l) => l.meta_message_id === metaMessageId);
  if (log) db.update('whatsapp_logs', log.id, { status });
  const messages = db.get('messages') || [];
  const msg = messages.find((m) => m.meta_message_id === metaMessageId);
  if (msg) db.update('messages', msg.id, { status });
}

function mergeThread(parent) {
  if (!parent) return [];
  const logs = (db.get('whatsapp_logs') || []).filter((l) => {
    if (l.parent_id && l.parent_id === parent.id) return true;
    const owner = findParentForLog(l);
    return owner?.id === parent.id;
  });
  const msgs = (db.get('messages') || []).filter((m) => m.parent_id === parent.id);

  const byKey = new Map();
  for (const item of [...logs, ...msgs]) {
    const key = item.meta_message_id || item.id;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );
}

function availableChannels(parent) {
  return {
    whatsapp: !!parent?.phone,
    instagram: !!parent?.instagram_id,
    messenger: !!parent?.messenger_psid,
  };
}

function pickDefaultChannel(parent, windows) {
  const order = ['whatsapp', 'instagram', 'messenger'];
  for (const ch of order) {
    if (availableChannels(parent)[ch] && windows[ch]?.open) return ch;
  }
  for (const ch of order) {
    if (availableChannels(parent)[ch]) return ch;
  }
  return 'whatsapp';
}

export async function getConversation(parentId) {
  const parentRaw = findParentById(parentId);
  if (!parentRaw) return { error: 'הלקוח לא נמצא', status: 404 };

  const students = (db.get('students') || []).filter((s) => s.parentId === parentRaw.id);
  const messages = mergeThread(parentRaw);
  const siblings = findParentsByPhone(parentRaw.phone).filter((p) => p.id !== parentRaw.id);
  let parent = enrichParentInboundFromMessages(parentRaw, messages);
  parent = enrichParentInboundFromSiblings(parent, siblings);

  // Heal stale last_inbound_* when the thread / sibling card has a newer inbound.
  const heal = {};
  for (const field of Object.values(CHANNEL_INBOUND_FIELDS)) {
    if (parent[field] && parent[field] !== parentRaw[field]) heal[field] = parent[field];
  }
  if (Object.keys(heal).length) {
    const healed = db.update('parents', parent.id, heal);
    if (healed) persistCore('parents', healed).catch(() => {});
  }

  const windows = getParentChannelWindows(parent);
  const channels = availableChannels(parent);
  const defaultChannel = pickDefaultChannel(parent, windows);

  const messengerCreds = getMessengerCredentials();
  const channelStatus = {
    whatsapp: channels.whatsapp,
    instagram: channels.instagram,
    messenger: channels.messenger && !!(messengerCreds.pageId && messengerCreds.accessToken),
  };

  return {
    parent,
    students,
    messages,
    windows,
    channels: channelStatus,
    defaultChannel,
  };
}

function applySavedReplyVars(body, parent, students) {
  let text = String(body || '');
  text = text.replace(/\{\{שם\}\}/g, parent?.name || '');
  text = text.replace(/\{\{name\}\}/g, parent?.name || '');
  text = text.replace(/\{\{שם_ילד\}\}/g, students?.[0]?.name || '');
  text = text.replace(/\{\{child_name\}\}/g, students?.[0]?.name || '');
  return text;
}

export async function sendMessengerText(psid, text) {
  const { pageId, accessToken } = getMessengerCredentials();
  if (!pageId || !accessToken) {
    console.log(`[Messenger Mock] to ${psid}: ${text}`);
    return { success: true, mock: true, messageId: `mock_msg_${Date.now()}` };
  }
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      recipient: { id: psid },
      message: { text },
      messaging_type: 'RESPONSE',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || 'שליחת מסנג׳ר נכשלה');
  return { success: true, messageId: data.message_id };
}

export async function replyToParent(parentId, payload = {}) {
  const parentRaw = findParentById(parentId);
  if (!parentRaw) return { success: false, error: 'הלקוח לא נמצא', status: 404 };

  const students = (db.get('students') || []).filter((s) => s.parentId === parentRaw.id);
  const messages = mergeThread(parentRaw);
  const siblings = findParentsByPhone(parentRaw.phone).filter((p) => p.id !== parentRaw.id);
  let parent = enrichParentInboundFromMessages(parentRaw, messages);
  parent = enrichParentInboundFromSiblings(parent, siblings);
  const channel = payload.channel || pickDefaultChannel(parent, getParentChannelWindows(parent));
  const type = payload.type || 'text';

  const windowOpen = canSendFreeform(parent, channel);
  if ((type === 'text' || type === 'image' || type === 'saved_reply') && !windowOpen) {
    return {
      success: false,
      error: 'חלון התקשורת של 24 שעות סגור. אפשר לשלוח רק תבנית מאושרת (וואטסאפ).',
      status: 400,
      windowClosed: true,
    };
  }

  let text = payload.text || payload.message || '';
  if (type === 'saved_reply') {
    const reply = (db.get('saved_replies') || []).find((r) => r.id === payload.savedReplyId);
    if (!reply) return { success: false, error: 'הודעה שמורה לא נמצאה', status: 404 };
    text = applySavedReplyVars(reply.body, parent, students);
  }

  if (type === 'template') {
    const templateName = payload.templateName || payload.templateId;
    const variables = Array.isArray(payload.variables) ? payload.variables : [];
    if (!templateName) return { success: false, error: 'חסר שם תבנית', status: 400 };
    if (channel !== 'whatsapp') {
      return { success: false, error: 'תבניות Meta זמינות רק בוואטסאפ', status: 400 };
    }
    const result = await whatsappService.sendTemplateMessage(
      parent.phone,
      templateName,
      variables.length ? variables : [parent.name || ''],
      { language: payload.language, parentId: parent.id }
    );
    return result;
  }

  if (type === 'image') {
    if (channel !== 'whatsapp') {
      return { success: false, error: 'שליחת תמונה נתמכת כרגע בוואטסאפ', status: 400 };
    }
    if (!payload.imageBase64 && !payload.mediaId) {
      return { success: false, error: 'חסרה תמונה', status: 400 };
    }
    let mediaId = payload.mediaId;
    if (!mediaId && payload.imageBase64) {
      const raw = payload.imageBase64.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(raw, 'base64');
      const uploaded = await uploadWhatsAppMedia(
        buffer,
        payload.mimeType || 'image/jpeg',
        payload.filename || 'image.jpg'
      );
      mediaId = uploaded.id;
    }
    const caption = text || payload.caption || '';
    const result = await whatsappService.sendImageMessage(parent.phone, mediaId, caption, {
      parentId: parent.id,
    });
    return result;
  }

  if (!text.trim()) return { success: false, error: 'חסר תוכן הודעה', status: 400 };

  if (channel === 'instagram') {
    if (!parent.instagram_id) return { success: false, error: 'אין מזהה אינסטגרם ללקוח', status: 400 };
    const result = await instagramService.sendTextMessage(parent.instagram_id, text.trim(), false);
    if (result.success) {
      logMessage({
        parent_id: parent.id,
        channel: 'instagram',
        direction: 'outbound',
        message: text.trim(),
        phone: parent.instagram_id,
        recipient_id: parent.instagram_id,
        source: 'crm',
      });
    }
    return result;
  }

  if (channel === 'messenger') {
    if (!parent.messenger_psid) return { success: false, error: 'אין מזהה מסנג׳ר ללקוח', status: 400 };
    try {
      const result = await sendMessengerText(parent.messenger_psid, text.trim());
      logMessage({
        parent_id: parent.id,
        channel: 'messenger',
        direction: 'outbound',
        message: text.trim(),
        phone: parent.messenger_psid,
        recipient_id: parent.messenger_psid,
        source: 'crm',
        meta_message_id: result.messageId || null,
        status: result.mock ? 'sent' : 'delivered',
      });
      return { success: true, text: text.trim() };
    } catch (err) {
      return { success: false, error: err.message, status: 500 };
    }
  }

  // WhatsApp text — respect session window (already checked)
  return whatsappService.sendTextMessage(parent.phone, text.trim(), false);
}

export async function handleMessengerIncoming({ psid, text, messageId, name } = {}) {
  if (!psid) return { skipped: true };
  let parent = (db.get('parents') || []).find((p) => p.messenger_psid === psid);
  if (!parent) {
    parent = db.insert('parents', {
      id: `p${Date.now()}`,
      name: name || 'לקוח מסנג׳ר',
      phone: '',
      messenger_psid: psid,
      source: 'messenger',
      channel: 'messenger',
      marketing_opt_in: true,
      status: 'lead_new',
      notes: text ? `הודעה ממסנג׳ר: "${text}"` : '',
    });
    await persistCore('parents', parent);
  } else if (text) {
    parent = db.update('parents', parent.id, {
      notes: (parent.notes ? `${parent.notes}\n` : '') + `הודעה ממסנג׳ר: "${text}"`,
      status: parent.status === 'archived' ? 'lead_new' : (parent.status || 'lead_new'),
    });
    if (parent) await persistCore('parents', parent);
  }
  markInboundForParent(parent, 'messenger');
  logMessage({
    parent_id: parent.id,
    channel: 'messenger',
    direction: 'inbound',
    message: text || '[הודעה]',
    phone: psid,
    recipient_id: psid,
    source: 'customer',
    meta_message_id: messageId || null,
    status: 'received',
  });
  return { parent, success: true };
}

export { ageFromBirthDate, findParentById, logMessage, applySavedReplyVars };
