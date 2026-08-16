import crypto from 'crypto';

const TOKEN_VERSION = 1;
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const FLOW_TTL_MS = 30 * 60 * 1000;
const FALLBACK_TOKEN_KEY = crypto.randomBytes(32);
const DEFAULT_PUBLIC_ORIGIN = 'https://app.kirboaz.co.il';

function preferenceTokenKey(secret = '') {
  const source = secret
    || process.env.OTP_TOKEN_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.META_WA_ACCESS_TOKEN
    || '';
  if (!source) return FALLBACK_TOKEN_KEY;
  return crypto.createHmac('sha256', 'crm.mailing-preferences.v1').update(source).digest();
}

function phoneFingerprint(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return crypto.createHash('sha256').update(digits).digest('base64url').slice(0, 22);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sortedListDefs(database) {
  return [...(database.getBroadcastListDefs?.() || [])]
    .filter((list) => list?.key && list?.label)
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
}

export function createMailingPreferenceToken(parent, {
  now = Date.now(),
  secret = '',
  ttlMs = TOKEN_TTL_MS,
} = {}) {
  if (!parent?.id || !parent?.phone) return '';
  const payload = {
    v: TOKEN_VERSION,
    sub: String(parent.id),
    ph: phoneFingerprint(parent.phone),
    exp: Number(now) + Number(ttlMs),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', preferenceTokenKey(secret))
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function readMailingPreferenceToken(token, {
  parents = [],
  now = Date.now(),
  secret = '',
} = {}) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) return null;
  const expected = crypto
    .createHmac('sha256', preferenceTokenKey(secret))
    .update(encoded)
    .digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (payload?.v !== TOKEN_VERSION || !payload.sub || Number(payload.exp) < Number(now)) return null;
  const parent = parents.find((row) => String(row?.id) === String(payload.sub));
  if (!parent?.phone || !safeEqual(payload.ph, phoneFingerprint(parent.phone))) return null;
  return { parent, expiresAt: Number(payload.exp) };
}

export function publicMailingOrigin(origin = '') {
  const requested = String(origin || process.env.PUBLIC_APP_URL || DEFAULT_PUBLIC_ORIGIN)
    .trim()
    .replace(/\/$/, '');
  if (/^https:\/\//i.test(requested)) return requested;
  if (/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(requested)) return requested;
  return DEFAULT_PUBLIC_ORIGIN;
}

export function buildMailingPreferencesUrl(parent, { origin = '', secret = '', now = Date.now() } = {}) {
  const token = createMailingPreferenceToken(parent, { secret, now });
  if (!token) return '';
  return `${publicMailingOrigin(origin)}/mailing-preferences/${encodeURIComponent(token)}`;
}

export function mailingPreferencesSnapshot(database, parent) {
  const lists = sortedListDefs(database);
  const subscriptions = database.getParentBroadcastLists(parent.id);
  return {
    recipient: String(parent.name || '').trim().split(/\s+/)[0] || 'לקוח',
    lists: lists.map((list) => ({
      key: list.key,
      label: list.label,
      description: list.description || '',
      color: list.color || '#60a5fa',
      icon: list.icon || 'megaphone',
      subscribed: subscriptions[list.key] !== false,
    })),
    updatedAt: parent.updated_at || null,
  };
}

export async function updateMailingPreferences(database, parent, subscriptions, {
  persistParent = async () => {},
  persistList = async () => {},
  now = new Date(),
} = {}) {
  const defs = sortedListDefs(database);
  const allowed = new Set(defs.map((list) => list.key));
  const clean = {};
  for (const [key, value] of Object.entries(subscriptions || {})) {
    if (allowed.has(key) && typeof value === 'boolean') clean[key] = value;
  }
  if (!Object.keys(clean).length) throw new Error('לא נבחרו העדפות לעדכון');

  const updated = database.updateParentBroadcastLists(parent.id, clean);
  const rows = database.get('broadcast_lists') || [];
  for (const key of Object.keys(clean)) {
    const row = rows.find((item) => item.parentId === parent.id && item.listName === key);
    if (!row) continue;
    const durable = await persistList(row);
    if (durable?.ok === false) throw new Error('שמירת העדפות הדיוור במסד נכשלה');
  }
  // מאז פירוק «שיווקי» לרשימות נושא: opt-out גלובלי רק כשהלקוח ירד מכל
  // רשימות הנושא. מי שהסיר «קייטנות» אבל נשאר ב«טיולים» עדיין מסכים לדיוור —
  // רק לא לנושא הזה (ומנוע החסימות אוכף את ההסרה הנושאית לפי הרשימה).
  const anySubscribed = defs.some((list) => updated[list.key] !== false);
  const topicLists = defs.filter((list) => list.key !== 'operational');
  const marketingOptIn = topicLists.length
    ? topicLists.some((list) => updated[list.key] !== false)
    : anySubscribed;
  const parentRow = database.update('parents', parent.id, {
    marketing_opt_in: marketingOptIn,
    ...(parent?.bot_intake?.kind === 'mailing_preferences' ? { bot_intake: null } : {}),
  });
  if (parentRow) {
    const durable = await persistParent(parentRow);
    if (durable?.ok === false) throw new Error('שמירת העדפות הדיוור במסד נכשלה');
  }
  return mailingPreferencesSnapshot(database, parentRow || parent);
}

export function isMailingPreferenceRequest(text, configuredKeywords = '') {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return false;
  const phrases = String(configuredKeywords || '')
    .split(/[,|\n]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (phrases.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(raw);
  })) return true;
  return /(?:הסר(?:ו)?(?:\s+אותי)?|להסיר|הפסק(?:ו)?|להפסיק|בטל(?:ו)?|לבטל)\s+(?:את\s+)?(?:ה)?(?:דיוור|הודעות|עדכונים|פרסומים|רשימת\s+תפוצה)/u.test(raw)
    || /(?:לא\s+רוצה|אל\s+תשלחו)(?:\s+לי)?\s+(?:יותר\s+)?(?:הודעות|דיוור|עדכונים|פרסומים)/u.test(raw)
    || /(?:עדכ(?:ון|נו)|לעדכן|עריכת?)\s+(?:את\s+)?(?:העדפות\s+)?(?:הדיוור|דיוור|הודעות)/u.test(raw);
}

export function hasActiveMailingPreferenceFlow(parent, now = Date.now()) {
  const flow = parent?.bot_intake;
  if (flow?.kind !== 'mailing_preferences') return false;
  const startedAt = new Date(flow.startedAt || 0).getTime();
  return Number.isFinite(startedAt) && startedAt > 0 && Number(now) - startedAt <= FLOW_TTL_MS;
}

function wantsAllListsRemoved(text) {
  const raw = String(text || '').trim();
  return /(?:הסר|הסירו|תסירו|להסיר|הפסק|תפסיקו|בטל|בטלו).*(?:הכל|כולם|כל\s+(?:ה)?רשימות|כל\s+(?:ה)?הודעות)/u.test(raw)
    || /(?:מכל|מכול)\s+(?:רשימות\s+)?(?:הדיוור|התפוצה)/u.test(raw)
    || /^(?:0|הכל|כולם)$/u.test(raw);
}

function selectedListKeys(text, defs) {
  const raw = String(text || '').trim().toLowerCase();
  const selected = new Set();
  for (const match of raw.matchAll(/(?:^|[^\d])(\d{1,2})(?=$|[^\d])/g)) {
    const index = Number(match[1]) - 1;
    if (defs[index]) selected.add(defs[index].key);
  }
  defs.forEach((list) => {
    const label = String(list.label || '').trim().toLowerCase();
    if (label && raw.includes(label)) selected.add(list.key);
  });
  return [...selected];
}

/** אימוג׳י לכל רשימה בתפריט הבוט — וואטסאפ הוא טקסט, וזה מה שהופך תפריט לסריק. */
const LIST_ICON_EMOJI = {
  bell: '🔔',
  mountain: '🧗',
  compass: '🧭',
  tent: '⛺',
  party: '🎉',
  megaphone: '📣',
};

function selectionPrompt(defs, url, prefix = '') {
  const choices = defs.map((list, index) => {
    const emoji = LIST_ICON_EMOJI[list.icon] || '';
    return `${index + 1}. ${emoji ? `${emoji} ` : ''}${list.label}`;
  }).join('\n');
  return [
    prefix,
    'בשמחה. מאילו רשימות להפסיק לקבל הודעות?',
    choices,
    '0. מכל הרשימות',
    '',
    'אפשר להשיב במספר אחד או בכמה מספרים, למשל: 1, 2.',
    url ? `לעריכה מלאה של ההעדפות: ${url}` : '',
  ].filter(Boolean).join('\n');
}

async function persistFlowParent(row, persistParent) {
  if (!row) throw new Error('כרטיס הלקוח לא נמצא');
  const durable = await persistParent(row);
  if (durable?.ok === false) throw new Error('שמירת בחירת הדיוור במסד נכשלה');
}

export async function handleMailingPreferenceConversation({
  database,
  parent,
  text,
  origin = '',
  persistParent = async () => {},
  persistList = async () => {},
  now = new Date(),
} = {}) {
  const defs = sortedListDefs(database);
  const url = buildMailingPreferencesUrl(parent, { origin, now: now.getTime() });
  const active = hasActiveMailingPreferenceFlow(parent, now.getTime());
  const raw = String(text || '').trim();

  if (!defs.length) return { handled: true, reply: 'לא נמצאו כרגע רשימות דיוור לעריכה.' };

  if (active && /^(?:בטל|ביטול|לא\s+משנה|עזוב)$/u.test(raw)) {
    const updated = database.update('parents', parent.id, { bot_intake: null });
    await persistFlowParent(updated, persistParent);
    return { handled: true, cancelled: true, reply: 'לא שיניתי דבר. אפשר לכתוב „העדפות דיוור” בכל זמן.' };
  }

  if (wantsAllListsRemoved(raw)) {
    const subscriptions = Object.fromEntries(defs.map((list) => [list.key, false]));
    await updateMailingPreferences(database, parent, subscriptions, {
      persistParent, now,
      persistList,
    });
    return {
      handled: true,
      removed: defs.map((list) => list.key),
      reply: [
        'הסרתי אתכם מכל רשימות הדיוור.',
        'הודעות שירות חיוניות הקשורות להרשמה או לפעילות קיימת עדיין עשויות להישלח.',
        url ? `אפשר לשנות את ההעדפות בכל זמן: ${url}` : '',
      ].filter(Boolean).join('\n'),
    };
  }

  if (!active) {
    const updated = database.update('parents', parent.id, {
      bot_intake: { kind: 'mailing_preferences', startedAt: now.toISOString() },
    });
    await persistFlowParent(updated, persistParent);
    return { handled: true, pending: true, reply: selectionPrompt(defs, url) };
  }

  const keys = selectedListKeys(raw, defs);
  if (!keys.length) {
    return {
      handled: true,
      pending: true,
      reply: selectionPrompt(defs, url, 'לא הצלחתי לזהות את הבחירה.'),
    };
  }

  const subscriptions = Object.fromEntries(keys.map((key) => [key, false]));
  await updateMailingPreferences(database, parent, subscriptions, {
    persistParent, now,
    persistList,
  });
  const removedLabels = defs.filter((list) => keys.includes(list.key)).map((list) => list.label);
  return {
    handled: true,
    removed: keys,
    reply: [
      `הסרתי אתכם מהרשימות: ${removedLabels.join(', ')}.`,
      url ? `לצפייה או שינוי נוסף: ${url}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export function appendMailingPreferencesFooter(message, parent, options = {}) {
  const body = String(message || '').trim();
  const url = buildMailingPreferencesUrl(parent, options);
  if (!body || !url || body.includes('/mailing-preferences/')) return body;
  return `${body}\n\nלעדכון העדפות הדיוור: ${url}`;
}
