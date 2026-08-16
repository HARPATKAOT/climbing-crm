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

/**
 * לקוח שמבקש להסיר את עצמו מקבל קישור אישי (מקוצר) לעמוד ההעדפות — בלי
 * תפריט שאלות בצ׳אט. שם הוא מסמן כל רשימה בנפרד, והשמירה מאשרת בוואטסאפ.
 * (הבעלים בחר בזרימה הזאת במקום התפריט הממוספר, 2026-08-15.)
 */
export async function handleMailingPreferenceConversation({
  database,
  parent,
  text: _text,
  origin = '',
  url = '',
  persistParent = async () => {},
  now = new Date(),
} = {}) {
  // Older cards may still carry the numbered-menu flow state — clear it so a
  // stray "2" tomorrow is not swallowed as a menu answer.
  if (parent?.bot_intake?.kind === 'mailing_preferences') {
    const updated = database.update('parents', parent.id, { bot_intake: null });
    if (updated) {
      const durable = await persistParent(updated);
      if (durable?.ok === false) throw new Error('שמירת בחירת הדיוור במסד נכשלה');
    }
  }

  const link = url || buildMailingPreferencesUrl(parent, { origin, now: now.getTime() });
  if (!link) {
    return { handled: true, reply: 'לא הצלחתי להכין קישור אישי — כתבו לנו ונעדכן ידנית.' };
  }
  return {
    handled: true,
    link,
    reply: [
      'כמובן! בקישור האישי הזה בוחרים בדיוק אילו עדכונים לקבל — או מסירים הכל:',
      link,
      'השינוי נשמר מיידית, ואפשר לחזור ולעדכן בכל זמן.',
    ].join('\n'),
  };
}

export function appendMailingPreferencesFooter(message, parent, options = {}) {
  const body = String(message || '').trim();
  const url = options.url || buildMailingPreferencesUrl(parent, options);
  if (!body || !url || body.includes('/mailing-preferences/') || body.includes('/mp/')) return body;
  return `${body}\n\nלעדכון העדפות הדיוור: ${url}`;
}
