import { db, persistCore } from '../db.js';
import { phonesMatch, normalizeWaPhone } from '../whatsappConnect.js';
import {
  getParentChannelWindows,
  canSendFreeform,
  getPhoneSessionWindow,
  inboundFieldForChannel,
  enrichParentInboundFromMessages,
  enrichParentInboundFromSiblings,
  CHANNEL_INBOUND_FIELDS,
} from './sessionWindow.js';
import { uploadWhatsAppMedia, getMessengerCredentials, META_GRAPH_VERSION } from './media.js';
import { whatsappService, instagramService } from '../whatsapp.js';
import { mergeBotSettings, pauseBotForPhone } from '../whatsappBot.js';
import { supa } from '../supa.js';
import { recordMessage, setMessageStatusByMetaId, toLogRow } from './messageStore.js';

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

export function latestInboundAt(parent) {
  const timestamps = Object.values(CHANNEL_INBOUND_FIELDS)
    .map((field) => Date.parse(parent?.[field] || ''))
    .filter(Number.isFinite);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

export function isAwaitingHandling(parent) {
  const inboundAt = latestInboundAt(parent);
  if (!inboundAt) return false;
  const handledAt = Date.parse(parent?.communication_handled_at || '');
  return !Number.isFinite(handledAt) || Date.parse(inboundAt) > handledAt;
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
  return recordMessage(record);
}

export async function markInboundForParent(parent, channel, meta = {}) {
  if (!parent) return;
  const at = meta.timestamp
    ? new Date(Number(meta.timestamp) > 1e12 ? Number(meta.timestamp) : Number(meta.timestamp) * 1000).toISOString()
    : new Date().toISOString();
  const updated = touchInbound(parent, channel, at);
  if (updated) await persistCore('parents', updated);
}

export async function markCommunicationHandled(parentId, at = new Date().toISOString()) {
  const parent = findParentById(parentId);
  if (!parent) return { success: false, error: 'הלקוח לא נמצא', status: 404 };

  const related = parent.phone ? findParentsByPhone(parent.phone) : [parent];
  const updatedParents = [];
  for (const match of related) {
    const updated = db.update('parents', match.id, { communication_handled_at: at });
    if (!updated) continue;
    updatedParents.push(updated);
    const durable = await persistCore('parents', updated);
    if (durable?.ok === false) {
      console.error('markCommunicationHandled persistence failed:', durable.error);
    }
  }

  return { success: true, handledAt: at, parents: updatedParents };
}

export function updateMessageStatusByMetaId(metaMessageId, status) {
  setMessageStatusByMetaId(metaMessageId, status);
}

function studentsForParent(parentId) {
  return (db.get('students') || []).filter((s) => s.parentId === parentId);
}

function familyWhatsappPhones(parent, students = []) {
  const phones = [];
  if (parent?.phone) phones.push(parent.phone);
  for (const student of students) {
    if (student?.phone) phones.push(student.phone);
  }
  return phones;
}

function findStudentByPhone(students, phone) {
  if (!phone) return null;
  return students.find((s) => phonesMatch(s.phone, phone)) || null;
}

function phoneBelongsToFamily(phone, familyPhones) {
  if (!phone) return false;
  return familyPhones.some((p) => phonesMatch(p, phone));
}

function buildConversationThreads(parent, students, messages = []) {
  const threads = [];
  if (parent?.phone) {
    threads.push({
      id: 'parent',
      role: 'parent',
      label: parent.name || 'הורה',
      studentId: null,
      phone: parent.phone,
      channels: {
        whatsapp: true,
        instagram: !!parent.instagram_id,
        messenger: !!parent.messenger_psid,
      },
      window: getPhoneSessionWindow(messages, parent.phone),
    });
  } else {
    threads.push({
      id: 'parent',
      role: 'parent',
      label: parent?.name || 'הורה',
      studentId: null,
      phone: '',
      channels: {
        whatsapp: false,
        instagram: !!parent?.instagram_id,
        messenger: !!parent?.messenger_psid,
      },
      window: getParentChannelWindows(parent).whatsapp,
    });
  }

  for (const student of students) {
    if (!String(student.phone || '').trim()) continue;
    threads.push({
      id: `student:${student.id}`,
      role: 'student',
      label: student.name || 'מתאמן',
      studentId: student.id,
      phone: student.phone,
      channels: { whatsapp: true, instagram: false, messenger: false },
      window: getPhoneSessionWindow(messages, student.phone),
    });
  }
  return threads;
}

function annotateMessages(messages, parent, students) {
  return (messages || []).map((m) => {
    const channel = m.channel || 'whatsapp';
    let studentId = m.student_id || null;
    let studentName = null;
    if (!studentId && channel === 'whatsapp' && m.phone) {
      const matched = findStudentByPhone(students, m.phone);
      if (matched && !phonesMatch(parent?.phone, m.phone)) {
        studentId = matched.id;
        studentName = matched.name || null;
      }
    } else if (studentId) {
      studentName = students.find((s) => s.id === studentId)?.name || null;
    }
    return {
      ...m,
      student_id: studentId,
      studentName,
      fromChild: !!studentId,
    };
  });
}

function resolveReplyTarget(parent, students, payload = {}) {
  const studentId = payload.studentId || payload.student_id || null;
  if (studentId) {
    const student = students.find((s) => String(s.id) === String(studentId));
    if (!student) return { error: 'המתאמן לא נמצא', status: 404 };
    if (!student.phone) return { error: 'למתאמן אין מספר טלפון', status: 400 };
    return {
      phone: student.phone,
      studentId: student.id,
      student,
      role: 'student',
    };
  }
  const targetPhone = payload.targetPhone || payload.phone || null;
  if (targetPhone) {
    const student = findStudentByPhone(students, targetPhone);
    if (student) {
      return {
        phone: student.phone,
        studentId: student.id,
        student,
        role: 'student',
      };
    }
    if (parent?.phone && phonesMatch(parent.phone, targetPhone)) {
      return { phone: parent.phone, studentId: null, student: null, role: 'parent' };
    }
  }
  return {
    phone: parent?.phone || '',
    studentId: null,
    student: null,
    role: 'parent',
  };
}

function mergeThread(parent) {
  if (!parent) return [];
  const students = studentsForParent(parent.id);
  const familyPhones = familyWhatsappPhones(parent, students);
  const logs = (db.get('whatsapp_logs') || []).filter((l) => {
    if (l.parent_id && l.parent_id === parent.id) return true;
    if (
      (l.channel || 'whatsapp') === 'whatsapp'
      && phoneBelongsToFamily(l.phone, familyPhones)
    ) {
      return true;
    }
    const owner = findParentForLog(l);
    return owner?.id === parent.id;
  });
  const msgs = (db.get('messages') || []).filter((m) => {
    if (m.parent_id === parent.id) return true;
    return (
      (m.channel || 'whatsapp') === 'whatsapp'
      && phoneBelongsToFamily(m.phone, familyPhones)
    );
  });

  const byKey = new Map();
  for (const item of [...logs, ...msgs]) {
    const key = item.meta_message_id || item.id;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)
  );
}

function latestThreadInboundAt(messages, channel = 'whatsapp') {
  let latest = 0;
  for (const m of messages || []) {
    if (m.direction !== 'inbound') continue;
    if ((m.channel || 'whatsapp') !== channel) continue;
    const ts = Date.parse(m.created_at || m.timestamp || '');
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  return latest;
}

// Clock skew between the webhook timestamp and the card update.
const INBOUND_MATCH_TOLERANCE_MS = 2000;

/**
 * True when the customer card points at an inbound message the cached thread is
 * missing — the exact state that puts a customer in the queue with an empty chat.
 */
export function threadIsBehindCard(parent, thread, channel = 'whatsapp') {
  const cardInbound = Date.parse(parent?.[`last_inbound_${channel}`] || '');
  if (!Number.isFinite(cardInbound)) return false;
  const latestInThread = latestThreadInboundAt(thread, channel);
  if (!latestInThread) return true;
  return cardInbound > latestInThread + INBOUND_MATCH_TOLERANCE_MS;
}

/**
 * Parent.last_inbound_* is durable; the local thread cache can lag after a cold
 * start or a missed write. When the card points at a newer inbound than the
 * cached thread, pull the conversation back from the durable store.
 */
async function reconcileThreadFromDurable(parent) {
  if (!parent?.id || !supa.isEnabled()) return false;
  if (!threadIsBehindCard(parent, mergeThread(parent), 'whatsapp')) return false;

  let added = 0;
  const students = studentsForParent(parent.id);
  const familyPhones = familyWhatsappPhones(parent, students);

  const remoteMessages = await supa.getMessagesForParent({
    parentId: parent.id,
    phones: familyPhones,
  });
  if (remoteMessages?.length) {
    added += db.mergeLocal('messages', remoteMessages);
    added += db.mergeLocal('whatsapp_logs', remoteMessages.map(toLogRow));
  }

  // Legacy history still living in kv_collections (pre-migration rows).
  for (const phone of familyPhones) {
    const remoteLogs = await supa.getWhatsappLogsForPhone(phone);
    if (remoteLogs?.length) added += db.mergeLocal('whatsapp_logs', remoteLogs);
  }

  if (added > 0) {
    console.log(`🩹 Reconciled ${added} conversation row(s) for card ${parent.id}`);
  }
  return added > 0;
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

  try {
    await reconcileThreadFromDurable(parentRaw);
  } catch (err) {
    console.warn('conversation log reconcile failed:', err.message);
  }

  const students = studentsForParent(parentRaw.id);
  const messagesRaw = mergeThread(parentRaw);
  const messages = annotateMessages(messagesRaw, parentRaw, students);
  const siblings = findParentsByPhone(parentRaw.phone).filter((p) => p.id !== parentRaw.id);
  let parent = enrichParentInboundFromMessages(parentRaw, messagesRaw);
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
  const threads = buildConversationThreads(parent, students, messagesRaw);

  const messengerCreds = getMessengerCredentials();
  const channelStatus = {
    whatsapp: channels.whatsapp,
    instagram: channels.instagram,
    messenger: channels.messenger && !!(messengerCreds.pageId && messengerCreds.accessToken),
  };

  // Prefer opening the thread that last wrote in, when it is a child phone.
  let defaultThreadId = 'parent';
  let latestInbound = 0;
  for (const m of messages) {
    if (m.direction !== 'inbound') continue;
    if ((m.channel || 'whatsapp') !== 'whatsapp') continue;
    const ts = Date.parse(m.created_at || '');
    if (!Number.isFinite(ts) || ts < latestInbound) continue;
    latestInbound = ts;
    if (m.student_id) defaultThreadId = `student:${m.student_id}`;
    else defaultThreadId = 'parent';
  }

  return {
    parent,
    students,
    messages,
    threads,
    defaultThreadId,
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

  const students = studentsForParent(parentRaw.id);
  const messages = mergeThread(parentRaw);
  const siblings = findParentsByPhone(parentRaw.phone).filter((p) => p.id !== parentRaw.id);
  let parent = enrichParentInboundFromMessages(parentRaw, messages);
  parent = enrichParentInboundFromSiblings(parent, siblings);
  const channel = payload.channel || pickDefaultChannel(parent, getParentChannelWindows(parent));
  const type = payload.type || 'text';

  const target = resolveReplyTarget(parent, students, payload);
  if (target.error) return { success: false, error: target.error, status: target.status || 400 };

  // WhatsApp freeform is gated by the peer you reply to (parent or child number).
  // Instagram / Messenger still use the parent-card channel window.
  const windowOpen = channel === 'whatsapp'
    ? getPhoneSessionWindow(messages, target.phone).open
    : canSendFreeform(parent, channel);
  if ((type === 'text' || type === 'image' || type === 'saved_reply') && !windowOpen) {
    return {
      success: false,
      error: 'חלון התקשורת של 24 שעות סגור. אפשר לשלוח רק תבנית מאושרת (וואטסאפ).',
      status: 400,
      windowClosed: true,
    };
  }

  const replyStudents = target.student ? [target.student, ...students] : students;
  let text = payload.text || payload.message || '';
  if (type === 'saved_reply') {
    const reply = (db.get('saved_replies') || []).find((r) => r.id === payload.savedReplyId);
    if (!reply) return { success: false, error: 'הודעה שמורה לא נמצאה', status: 404 };
    text = applySavedReplyVars(reply.body, parent, replyStudents);
  }

  const sendOpts = {
    parentId: parent.id,
    studentId: target.studentId || null,
  };

  if (type === 'template') {
    const templateName = payload.templateName || payload.templateId;
    const variables = Array.isArray(payload.variables) ? payload.variables : [];
    if (!templateName) return { success: false, error: 'חסר שם תבנית', status: 400 };
    if (channel !== 'whatsapp') {
      return { success: false, error: 'תבניות Meta זמינות רק בוואטסאפ', status: 400 };
    }
    if (!target.phone) return { success: false, error: 'אין מספר טלפון לשליחה', status: 400 };
    const result = await whatsappService.sendTemplateMessage(
      target.phone,
      templateName,
      variables.length ? variables : [parent.name || ''],
      { language: payload.language, ...sendOpts }
    );
    if (result.success) {
      try {
        const settings = mergeBotSettings(db.getSettings());
        if (settings.aiPauseOnHumanReply) {
          await pauseBotForPhone(target.phone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
        }
      } catch (_) { /* ignore */ }
    }
    return result;
  }

  if (type === 'image') {
    if (channel !== 'whatsapp') {
      return { success: false, error: 'שליחת תמונה נתמכת כרגע בוואטסאפ', status: 400 };
    }
    if (!target.phone) return { success: false, error: 'אין מספר טלפון לשליחה', status: 400 };
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
    const result = await whatsappService.sendImageMessage(target.phone, mediaId, caption, sendOpts);
    if (result.success) {
      try {
        const settings = mergeBotSettings(db.getSettings());
        if (settings.aiPauseOnHumanReply) {
          await pauseBotForPhone(target.phone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
        }
      } catch (_) { /* ignore */ }
    }
    return result;
  }

  if (!text.trim()) return { success: false, error: 'חסר תוכן הודעה', status: 400 };

  if (channel === 'instagram') {
    if (target.role === 'student') {
      return { success: false, error: 'אינסטגרם זמין רק בשיחת ההורה', status: 400 };
    }
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
    if (target.role === 'student') {
      return { success: false, error: 'מסנג׳ר זמין רק בשיחת ההורה', status: 400 };
    }
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
  if (!target.phone) return { success: false, error: 'אין מספר טלפון לשליחה', status: 400 };
  const result = await whatsappService.sendTextMessage(target.phone, text.trim(), false, sendOpts);
  if (result.success) {
    try {
      const settings = mergeBotSettings(db.getSettings());
      if (settings.aiPauseOnHumanReply) {
        await pauseBotForPhone(target.phone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
      }
    } catch (err) {
      console.error('pause bot after CRM reply failed:', err.message);
    }
  }
  return result;
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
  await markInboundForParent(parent, 'messenger');
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
