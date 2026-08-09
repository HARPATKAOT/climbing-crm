import { db, persistCore, CHANNEL_PLACEHOLDER_NAMES } from '../db.js';
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
import {
  mergeBotSettings,
  pauseBotForPhone,
  clearBotPause,
  optOutPhone,
  describeBotState,
  isClosingAcknowledgement,
} from '../whatsappBot.js';
import { replyKeyForBurst } from '../botReplyClaims.js';
import { supa } from '../supa.js';
import { childrenOfParent } from '../studentGuardians.js';
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

function findParentForLog(log, index = null) {
  const channel = log.channel || 'whatsapp';
  const handle = String(log.phone || log.recipient_id || '');
  if (index) return ownerFromIndex(index, channel, handle);

  const parents = db.get('parents') || [];
  if (channel === 'instagram') {
    return parents.find((p) => p.instagram_id && String(p.instagram_id) === handle) || null;
  }
  if (channel === 'messenger') {
    return parents.find((p) => p.messenger_psid && String(p.messenger_psid) === handle) || null;
  }
  const matches = findParentsByPhone(log.phone);
  if (!matches.length) return null;
  // Prefer the CRM card with real details over a bare WhatsApp lead duplicate.
  return [...matches].sort((a, b) => scoreParentRecord(b) - scoreParentRecord(a))[0];
}

/**
 * Owner lookup for a whole batch of messages.
 *
 * Resolving one message walks every customer card; doing that per message made
 * opening a conversation cost thousands of full scans — about six tenths of a
 * second of pure searching for a nine-message thread, and it grew with the
 * customer base. Built once, the same answers come back as map hits. The
 * winner per phone is still the highest-scoring card, so the result is
 * identical to the scan it replaces.
 */
function buildParentOwnerIndex() {
  const byPhoneTail = new Map();
  const byInstagram = new Map();
  const byMessenger = new Map();
  for (const parent of db.get('parents') || []) {
    if (parent?.instagram_id) byInstagram.set(String(parent.instagram_id), parent);
    if (parent?.messenger_psid) byMessenger.set(String(parent.messenger_psid), parent);
    const tail = normalizeWaPhone(parent?.phone).slice(-9);
    if (tail.length !== 9) continue;
    const current = byPhoneTail.get(tail);
    if (!current || scoreParentRecord(parent) > scoreParentRecord(current)) {
      byPhoneTail.set(tail, parent);
    }
  }
  return { byPhoneTail, byInstagram, byMessenger };
}

function ownerFromIndex(index, channel, handle) {
  if (channel === 'instagram') return index.byInstagram.get(handle) || null;
  if (channel === 'messenger') return index.byMessenger.get(handle) || null;
  const tail = normalizeWaPhone(handle).slice(-9);
  return tail.length === 9 ? (index.byPhoneTail.get(tail) || null) : null;
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

/** A card the channel opened by itself and nobody ever filled in. */
function isBlankLeadCard(parent, parentIdsWithChildren) {
  if (!parent) return false;
  if (!CHANNEL_PLACEHOLDER_NAMES.includes(String(parent.name || '').trim())) return false;
  if (String(parent.email || '').trim()) return false;
  return !parentIdsWithChildren.has(parent.id);
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

/** Clear the whole awaiting queue at once — every card that still shows "ממתין לטיפול". */
export async function markAllCommunicationsHandled(at = new Date().toISOString()) {
  const updatedParents = [];
  for (const parent of db.get('parents') || []) {
    if (!isAwaitingHandling(parent)) continue;
    const updated = db.update('parents', parent.id, { communication_handled_at: at });
    if (!updated) continue;
    updatedParents.push(updated);
    const durable = await persistCore('parents', updated);
    if (durable?.ok === false) {
      console.error('markAllCommunicationsHandled persistence failed:', durable.error);
    }
  }
  return { success: true, handledAt: at, parents: updatedParents, count: updatedParents.length };
}

export function updateMessageStatusByMetaId(metaMessageId, status) {
  setMessageStatusByMetaId(metaMessageId, status);
}

function studentsForParent(parentId) {
  // Own children plus the ones linked to this card. In a merged household every
  // child belongs to both parents, and reading `parentId` alone made whichever
  // parent did not register a child blind to them.
  return childrenOfParent(db, parentId);
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
    if (threads.some((t) => phonesMatch(t.phone, student.phone))) continue;
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
  // Built once for the whole scan instead of once per stored message.
  let ownerIndex = null;
  const logs = (db.get('whatsapp_logs') || []).filter((l) => {
    if (l.parent_id && l.parent_id === parent.id) return true;
    if (
      (l.channel || 'whatsapp') === 'whatsapp'
      && phoneBelongsToFamily(l.phone, familyPhones)
    ) {
      return true;
    }
    if (!ownerIndex) ownerIndex = buildParentOwnerIndex();
    const owner = findParentForLog(l, ownerIndex);
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
  // Local mirror first, then durable rows overwrite — messages is source of truth.
  for (const item of logs) {
    byKey.set(item.meta_message_id || item.id, item);
  }
  for (const item of msgs) {
    byKey.set(item.meta_message_id || item.id, item);
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

// ─── Inbox: every conversation in one list ───────────────────────────────────
//
// getConversation() answers "show me this customer". The inbox answers the other
// question — "who is talking to us right now" — without knowing a customer id up
// front. It walks the whole message store once and keeps the newest message per
// customer, so the cost is linear in messages rather than a per-customer fetch.

const PREVIEW_MAX_CHARS = 90;

const MEDIA_PREVIEWS = {
  image: '📷 תמונה',
  video: '🎥 סרטון',
  audio: '🎤 הודעה קולית',
  sticker: '🏷️ מדבקה',
  document: '📎 מסמך',
};

function messagePreview(message) {
  const text = String(message?.message || '').replace(/\s+/g, ' ').trim();
  if (text) {
    return text.length > PREVIEW_MAX_CHARS ? `${text.slice(0, PREVIEW_MAX_CHARS)}…` : text;
  }
  const type = message?.media_type || message?.message_type || 'text';
  return MEDIA_PREVIEWS[type] || (message?.media_url ? '📎 קובץ' : '');
}

/** Last 9 digits — the same tolerance phonesMatch() uses, in a Map-friendly shape. */
function phoneKey(phone) {
  const digits = normalizeWaPhone(phone);
  return digits.length >= 9 ? digits.slice(-9) : digits;
}

/** Live wiring. Tests pass their own store instead, as messageStore.js does. */
const liveInboxStore = {
  read: (table) => db.get(table) || [],
};

/**
 * Phone/handle → customer card, built once per request. Without it, resolving the
 * owner of each message would rescan the whole customer list every time.
 */
function buildOwnerIndex(store) {
  const parents = store.read('parents');
  const index = {
    byId: new Map(),
    byPhone: new Map(),
    byInstagram: new Map(),
    byMessenger: new Map(),
    studentByPhone: new Map(),
  };

  // Duplicate cards share a phone; the richest one wins, exactly as findParentForLog does.
  const claim = (map, key, parent) => {
    if (!key) return;
    const current = map.get(key);
    if (!current || scoreParentRecord(parent) > scoreParentRecord(current)) map.set(key, parent);
  };

  for (const parent of parents) {
    index.byId.set(parent.id, parent);
    claim(index.byPhone, phoneKey(parent.phone), parent);
    if (parent.instagram_id) claim(index.byInstagram, String(parent.instagram_id), parent);
    if (parent.messenger_psid) claim(index.byMessenger, String(parent.messenger_psid), parent);
  }

  const students = store.read('students');
  const parentIdsWithChildren = new Set(students.map((s) => s.parentId).filter(Boolean));

  for (const student of students) {
    const key = phoneKey(student.phone);
    if (!key) continue;
    index.studentByPhone.set(key, student);
    const parent = index.byId.get(student.parentId);
    if (!parent) continue;
    // A child's own phone routes to the family card, never over the parent's own number —
    // unless the card holding that number is an empty lead the channel opened by itself.
    const holder = index.byPhone.get(key);
    if (holder && !isBlankLeadCard(holder, parentIdsWithChildren)) continue;
    index.byPhone.set(key, parent);
  }

  return index;
}

/** Collapse duplicate cards that share a phone onto the single row the inbox shows. */
function canonicalParent(parent, index) {
  if (!parent) return null;
  const key = phoneKey(parent.phone);
  if (!key) return parent;
  return index.byPhone.get(key) || parent;
}

function ownerForMessage(message, index) {
  const channel = message.channel || 'whatsapp';
  const handle = String(message.phone || message.recipient_id || '');
  if (channel === 'instagram') return index.byInstagram.get(handle) || null;
  if (channel === 'messenger') return index.byMessenger.get(handle) || null;
  const byPhone = index.byPhone.get(phoneKey(handle));
  if (byPhone) return byPhone;
  return message.parent_id ? index.byId.get(message.parent_id) || null : null;
}

/**
 * One row per customer who has ever exchanged a message, newest first, with the
 * customers still awaiting a reply pinned to the top.
 */
export function listConversations({ limit = 300, store = liveInboxStore } = {}) {
  const index = buildOwnerIndex(store);
  const seenKeys = new Set();
  const rows = new Map();

  const rowFor = (parent) => {
    let row = rows.get(parent.id);
    if (!row) {
      row = { parent, last: null, lastAt: 0, unread: 0 };
      rows.set(parent.id, row);
    }
    return row;
  };

  for (const item of [...store.read('messages'), ...store.read('whatsapp_logs')]) {
    // `messages` and `whatsapp_logs` mirror each other — count each message once.
    const key = item.meta_message_id || item.id;
    if (key) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
    }
    const parent = canonicalParent(ownerForMessage(item, index), index);
    if (!parent) continue;

    const row = rowFor(parent);
    const at = Date.parse(item.created_at || '') || 0;
    if (at >= row.lastAt) {
      row.last = item;
      row.lastAt = at;
    }
    if (item.direction === 'inbound') {
      const handledAt = Date.parse(parent.communication_handled_at || '') || 0;
      if (at > handledAt) row.unread += 1;
    }
  }

  // A card can know about an inbound the local thread cache has not pulled back
  // yet. Surfacing it empty beats dropping the customer out of the inbox.
  for (const parent of store.read('parents')) {
    if (!isAwaitingHandling(parent)) continue;
    const canonical = canonicalParent(parent, index);
    if (rows.has(canonical.id)) continue;
    const row = rowFor(canonical);
    row.lastAt = Date.parse(latestInboundAt(canonical) || '') || 0;
  }

  const conversations = [...rows.values()].map(({ parent, last, lastAt, unread }) => {
    const studentPhoneKey = last ? phoneKey(last.phone) : '';
    const student = studentPhoneKey && studentPhoneKey !== phoneKey(parent.phone)
      ? index.studentByPhone.get(studentPhoneKey)
      : null;
    // isAwaitingHandling() is what the dashboard queue and the leads filter use.
    // The badge follows it, so a row can never show unread yet drop out of the
    // "awaiting" filter — a card whose last_inbound_* lags its messages included.
    const awaiting = isAwaitingHandling(parent);
    return {
      parentId: parent.id,
      name: parent.name || 'ללא שם',
      phone: parent.phone || '',
      status: parent.status || null,
      channel: last?.channel || parent.channel || 'whatsapp',
      preview: last ? messagePreview(last) : 'הודעה חדשה — פתח לטעינת השיחה',
      direction: last?.direction || 'inbound',
      isAi: !!last?.is_ai,
      fromStudentName: student?.name || null,
      lastMessageAt: lastAt ? new Date(lastAt).toISOString() : null,
      awaiting,
      unread: awaiting ? Math.max(unread, 1) : 0,
    };
  });

  conversations.sort((a, b) => {
    if (a.awaiting !== b.awaiting) return a.awaiting ? -1 : 1;
    return (Date.parse(b.lastMessageAt || '') || 0) - (Date.parse(a.lastMessageAt || '') || 0);
  });

  return {
    conversations: conversations.slice(0, limit),
    total: conversations.length,
    awaiting: conversations.filter((c) => c.awaiting).length,
  };
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
    bot: describeBotState(parent, mergeBotSettings(db.getSettings())),
  };
}

/**
 * Manual override of the auto-reply bot for one customer.
 * `mute` is permanent until someone resumes it; `pause` is timed;
 * `resume` clears both the opt-out and any timed pause.
 */
export async function setBotState(parentId, action, { minutes } = {}) {
  const parent = findParentById(parentId);
  if (!parent) return { success: false, error: 'הלקוח לא נמצא', status: 404 };
  if (!parent.phone) return { success: false, error: 'ללקוח אין מספר טלפון', status: 400 };

  if (action === 'mute') {
    await optOutPhone(parent.phone, true, { source: 'crm' });
  } else if (action === 'pause') {
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins < 1 || mins > 60 * 24 * 30) {
      return { success: false, error: 'משך השתקה לא תקין', status: 400 };
    }
    // A timed mute replaces a permanent opt-out for this customer.
    if (parent.bot_opted_out) {
      await optOutPhone(parent.phone, false);
    }
    await pauseBotForPhone(parent.phone, mins, { reason: 'manual' });
  } else if (action === 'resume') {
    await optOutPhone(parent.phone, false);
    await clearBotPause(parent.phone);
  } else {
    return { success: false, error: 'פעולה לא מוכרת', status: 400 };
  }

  const updated = findParentById(parentId) || parent;
  return {
    success: true,
    bot: describeBotState(updated, mergeBotSettings(db.getSettings())),
  };
}

/** Newest inbound message on this thread — what a draft reply answers. */
function lastInboundForTarget(messages, target, parent) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.direction !== 'inbound') continue;
    if ((m.channel || 'whatsapp') !== 'whatsapp') continue;
    if (target.studentId) {
      if (String(m.student_id || '') !== String(target.studentId)
        && !phonesMatch(m.phone, target.phone)) continue;
    } else if (m.student_id && !phonesMatch(parent?.phone, m.phone)) {
      continue;
    }
    if (String(m.message || '').trim()) return m;
  }
  return null;
}

function messageBelongsToReplyTarget(message, target, parent) {
  if ((message?.channel || 'whatsapp') !== 'whatsapp') return false;
  if (target?.studentId) {
    return String(message?.student_id || '') === String(target.studentId)
      || phonesMatch(message?.phone, target.phone);
  }
  if (message?.student_id && !phonesMatch(parent?.phone, message?.phone)) return false;
  return !target?.phone || !message?.phone || phonesMatch(message.phone, target.phone);
}

function successfulOutbound(message) {
  if (message?.direction !== 'outbound') return false;
  return !['failed', 'undelivered', 'error'].includes(String(message?.status || '').toLowerCase());
}

function actionableCustomerMessage(message) {
  if (message?.direction !== 'inbound') return false;
  const type = String(message?.message_type || message?.media_type || 'text').toLowerCase();
  if (type === 'reaction' || type === 'sticker') return false;
  const text = String(message?.message || '').trim();
  if (!text || /^תגובה:/u.test(text) || /^ריאקציה:/u.test(text)) return false;
  if (/^\[[^\]\r\n]+\]$/u.test(text) && type !== 'text') return false;
  return !isClosingAcknowledgement(text);
}

/**
 * Select the still-unanswered customer burst for the one-click CRM action.
 * This is deliberately pure so the UI/API guard can be regression-tested
 * without ever contacting WhatsApp or Gemini.
 */
export function botContinuationForMessages(messages = [], target = {}, parent = {}) {
  const thread = (Array.isArray(messages) ? messages : [])
    .filter((message) => messageBelongsToReplyTarget(message, target, parent));

  let lastAnsweredIndex = -1;
  for (let index = 0; index < thread.length; index += 1) {
    if (successfulOutbound(thread[index])) lastAnsweredIndex = index;
  }

  const unanswered = thread.slice(lastAnsweredIndex + 1).filter(actionableCustomerMessage);
  if (!unanswered.length) {
    const hasInbound = thread.some((message) => message?.direction === 'inbound');
    return {
      canContinue: false,
      reason: hasInbound && lastAnsweredIndex >= 0 ? 'already_answered' : 'nothing_to_answer',
      messages: [],
      text: '',
    };
  }

  return {
    canContinue: true,
    reason: null,
    messages: unanswered,
    text: unanswered.map((message) => String(message.message || '').trim()).join('\n'),
    lastInbound: unanswered[unanswered.length - 1],
  };
}

/** Run the smart bot once on the latest unanswered WhatsApp turn. */
export async function continueBotConversation(parentId, payload = {}) {
  const parent = findParentById(parentId);
  if (!parent) return { success: false, error: 'הלקוח לא נמצא', status: 404 };

  const students = studentsForParent(parent.id);
  const target = resolveReplyTarget(parent, students, payload);
  if (target.error) return { success: false, error: target.error, status: target.status || 400 };
  if (!target.phone) return { success: false, error: 'לשיחה אין מספר וואטסאפ', status: 400 };

  const messages = annotateMessages(mergeThread(parent), parent, students);
  const continuation = botContinuationForMessages(messages, target, parent);
  if (!continuation.canContinue) {
    const error = continuation.reason === 'already_answered'
      ? 'כבר נשלחה תשובה להודעה האחרונה של הלקוח'
      : 'אין כרגע הודעת לקוח שמחכה לתשובה';
    return { success: false, error, status: 409, reason: continuation.reason };
  }

  if (!getPhoneSessionWindow(messages, target.phone).open) {
    return {
      success: false,
      error: 'חלון ה־24 שעות נסגר. כדי לפנות עכשיו צריך לשלוח הודעת תבנית מאושרת.',
      status: 409,
      reason: 'window_closed',
    };
  }

  const bot = describeBotState(parent, mergeBotSettings(db.getSettings()));
  if (bot.globallyOff) {
    return { success: false, error: 'הבוט כבוי כרגע לכל הלקוחות. יש להפעיל אותו תחילה.', status: 409, reason: 'disabled' };
  }
  if (bot.status === 'opted_out') {
    return { success: false, error: 'הבוט כבוי ללקוח הזה. יש להפעיל אותו תחילה.', status: 409, reason: 'opted_out' };
  }

  const replyKey = replyKeyForBurst(target.phone, continuation.messages.map((message) => ({
    messageId: `manual:${message.meta_message_id || message.id || message.created_at || message.message}`,
    text: message.message,
    createdAt: message.created_at,
  })));

  const result = await whatsappService.continueConversation(target.phone, continuation.text, {
    parent,
    students: target.student ? [target.student, ...students.filter((row) => row.id !== target.student.id)] : students,
    speaker: target.student || null,
    replyKey,
    inboundBurstCount: continuation.messages.length,
    lastInboundAt: continuation.lastInbound?.created_at || '',
  });

  return {
    ...result,
    basedOn: {
      count: continuation.messages.length,
      messageId: continuation.lastInbound?.id || null,
      at: continuation.lastInbound?.created_at || null,
    },
  };
}

/**
 * Draft a reply without sending anything. Same generator the bot uses, so the
 * text obeys the same rules — but a human reads it before the customer does.
 */
export async function draftReply(parentId, payload = {}) {
  const parent = findParentById(parentId);
  if (!parent) return { success: false, error: 'הלקוח לא נמצא', status: 404 };

  const students = studentsForParent(parent.id);
  const target = resolveReplyTarget(parent, students, payload);
  if (target.error) return { success: false, error: target.error, status: target.status || 400 };

  const messages = annotateMessages(mergeThread(parent), parent, students);
  const inbound = lastInboundForTarget(messages, target, parent);
  if (!inbound) {
    return { success: false, error: 'אין הודעה נכנסת מהלקוח לענות עליה', status: 400 };
  }

  const incoming = String(inbound.message || '').trim();
  const result = await whatsappService.generateAIResponse(incoming, {
    phone: target.phone || parent.phone,
    parent,
    students: target.student ? [target.student, ...students] : students,
    preferModel: true,
  });

  const text = String(result?.text || '').trim();
  if (!text) return { success: false, error: 'לא הצלחתי לנסח תשובה', status: 502 };

  return {
    success: true,
    text,
    // `handoff` means the generator wanted a human anyway — worth flagging.
    unsure: !!(result?.unsure || result?.handoff),
    confidence: result?.confidence || 'low',
    basedOn: { message: incoming, at: inbound.created_at || null },
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
    try {
      const { proposeFromHandoffStaffReply } = await import('../botLearning.js');
      await proposeFromHandoffStaffReply({
        db,
        persist: persistCore,
        phone: target.phone,
        parent,
        staffText: text.trim(),
        createdBy: 'handoff_mine',
      });
    } catch (err) {
      console.error('Handoff learning propose failed:', err.message);
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
      notes: '',
    });
    await persistCore('parents', parent);
  } else if (parent.status === 'archived') {
    parent = db.update('parents', parent.id, { status: 'lead_new' });
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
