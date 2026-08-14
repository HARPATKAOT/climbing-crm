const INTRO_TOPIC = /(?:אימון|שיעור)\s*(?:היכרות|הכרות|ניסיון|נסיון)|(?:לבוא|להגיע)\s+(?:פעם\s+אחת|לניסיון|לנסיון)|(?:רוצה|רוצים|רוצות|נשמח|אפשר)\s+(?:לבוא\s+)?לנסות/u;
const INTRO_REJECTED = /(?:לא|בלי)\s+(?:רוצה|רוצים|רוצות|מעוניינ\S*|צריך|צריכים)\s+(?:ב)?(?:אימון|שיעור)\s*(?:היכרות|הכרות|ניסיון|נסיון)/u;
const DIRECT_SIGNUP_DECLINED = /(?:לא|עוד\s+לא)\s+(?:רוצה|רוצים|רוצות|מוכנ\S*|מעוניינ\S*)\s+(?:להירשם|להרשם|להתחייב)|(?:לפני|בטרם)\s+ש?נרש(?:ם|מים)|רק\s+(?:לנסות|להתרשם)/u;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isSystemUpdate(value) {
  return /^\[מערכת\]/u.test(clean(value));
}

function customerTexts(history = [], incomingText = '') {
  const texts = (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.role === 'user')
    .map((entry) => clean(entry?.parts?.[0]?.text))
    .filter((text) => text && !isSystemUpdate(text));
  const incoming = clean(incomingText);
  if (incoming && !isSystemUpdate(incoming) && texts.at(-1) !== incoming) texts.push(incoming);
  return texts;
}

/** Intro is an exception: only a customer request or reluctance to register opens it. */
export function customerAllowsIntro(history = [], incomingText = '') {
  const texts = customerTexts(history, incomingText);
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const text = texts[index];
    if (INTRO_REJECTED.test(text)) continue;
    if (INTRO_TOPIC.test(text) || DIRECT_SIGNUP_DECLINED.test(text)) return true;
  }
  return false;
}

export function replyMentionsIntro(text = '') {
  return INTRO_TOPIC.test(clean(text));
}

export function botOfferedIntroChoice(text = '') {
  const value = clean(text);
  return replyMentionsIntro(value)
    && /(?:הרשמה|להירשם|להרשם|ישיר\S*|לבחור|או)/u.test(value);
}

function phoneKey(value) {
  return String(value || '').replace(/\D/g, '').slice(-9);
}

/** Read-only audit: conversations whose last meaningful message is an unsolicited intro choice. */
export function stalledIntroOfferThreads({ messages = [], parents = [], since = 0 } = {}) {
  const byPhone = new Map();
  for (const message of messages || []) {
    const at = Date.parse(message?.created_at || '');
    if (since && (!Number.isFinite(at) || at < since)) continue;
    const key = phoneKey(message?.phone);
    if (!key) continue;
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key).push(message);
  }

  const results = [];
  for (const [key, rows] of byPhone) {
    const thread = rows
      .filter((row) => String(row?.source || '') !== 'otp' && clean(row?.message))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const last = thread.at(-1);
    if (!last || last.direction !== 'outbound' || !last.is_ai || !botOfferedIntroChoice(last.message)) continue;

    const priorCustomerRows = thread.filter((row) => (
      row.direction === 'inbound' && String(row.created_at || '') < String(last.created_at || '')
    ));
    const history = priorCustomerRows.map((row) => ({ role: 'user', parts: [{ text: row.message }] }));
    if (customerAllowsIntro(history)) continue;

    const parent = (parents || []).find((row) => phoneKey(row?.phone) === key) || null;
    results.push({
      phone: last.phone,
      parentId: parent?.id || last.parent_id || '',
      parentName: clean(parent?.name) || 'ללא שם',
      offerId: last.meta_message_id || last.id || last.created_at || '',
      offeredAt: last.created_at || '',
      offerMessage: clean(last.message),
      lastCustomerMessage: clean(priorCustomerRows.at(-1)?.message),
      lastCustomerAt: priorCustomerRows.at(-1)?.created_at || '',
    });
  }

  return results.sort((a, b) => String(b.offeredAt).localeCompare(String(a.offeredAt)));
}

/**
 * Continue only the stalled conversations found by the read-only audit.
 * The caller supplies the live bot runner; deterministic keys make retries safe.
 */
export async function recoverStalledIntroOffers({
  messages = [],
  parents = [],
  since = 0,
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60_000,
  getStudents = () => [],
  continueConversation,
} = {}) {
  if (typeof continueConversation !== 'function') throw new Error('continueConversation is required');
  const candidates = stalledIntroOfferThreads({ messages, parents, since });
  const results = [];

  for (const candidate of candidates) {
    const lastCustomerAt = Date.parse(candidate.lastCustomerAt || '');
    if (!Number.isFinite(lastCustomerAt) || now - lastCustomerAt >= maxAgeMs) {
      results.push({ parentId: candidate.parentId, success: false, reason: 'window_closed' });
      continue;
    }
    const parent = (parents || []).find((row) => String(row?.id || '') === String(candidate.parentId || ''))
      || (parents || []).find((row) => phoneKey(row?.phone) === phoneKey(candidate.phone));
    if (!parent) {
      results.push({ parentId: candidate.parentId, success: false, reason: 'parent_not_found' });
      continue;
    }

    const offerKey = clean(candidate.offerId) || clean(candidate.offeredAt);
    const replyKey = `intro-policy-recovery:${offerKey}`;
    const systemUpdate = '[מערכת] השיחה נעצרה אחרי שהבוט הציע בחירה שלא הייתה נחוצה. '
      + `הלקוח כבר בחר: «${candidate.lastCustomerMessage}». `
      + 'המשך עכשיו בתהליך ההרשמה הישירה: בדוק את הכרטיס והטופס, קרא ל-startSignup לקבוצה שנבחרה, '
      + 'ולאחר הצלחה שלח את קישורי המתנ״ס והציוד. אל תציע אימון היכרות.';
    const result = await continueConversation(candidate.phone, systemUpdate, {
      parent,
      students: getStudents(parent),
      replyKey,
      lastInboundAt: candidate.lastCustomerAt,
      inboundBurstCount: 1,
      respectGate: true,
    });
    results.push({
      parentId: candidate.parentId,
      success: !!result?.success,
      reason: result?.reason || '',
    });
  }

  return { candidates: candidates.length, results };
}
