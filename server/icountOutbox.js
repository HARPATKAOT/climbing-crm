/**
 * icount_outbox — תור הנפקות iCount עם idempotency, retry ו-dead letter.
 * FINANCE_SPEC 4.3.2: אסור שהפקת חשבונית תיכשל בשקט.
 *
 * ההנפקות הקיימות (קופה → invrec סינכרוני) נשארות כמו שהן — DECISIONS #9.
 * ה-outbox הוא רשת הביטחון והתשתית לזרמים חדשים: אירוע נכנס עם מפתח
 * idempotency שנגזר ממזהה האירוע העסקי, worker שולח, כשלון נרשם וחוזר
 * עם backoff, ואחרי maxAttempts — dead + פריט בתיבת הנכנס.
 *
 * שער sandbox (FINANCE_SPEC 4.3.5): מחוץ לפרודקשן שום מסמך אמיתי לא נוצר —
 * ה-dispatch מדלג על iCount ומחזיר תוצאת mock. בקונפיג, לא במשמעת.
 */

import { financeId, icountRealDocsAllowed } from './financeCore.js';
import { upsertInboxItem } from './bankIngestion.js';

const BASE_RETRY_MINUTES = 5;
export const MAX_OUTBOX_ATTEMPTS = 6;

/** רישום אירוע. אותו idempotency_key פעמיים = שורה אחת, בלי שגיאה. */
export function enqueueIcountEvent(store, { event_type, payload = {}, idempotency_key } = {}) {
  if (!event_type) throw new Error('event_type חסר');
  if (!idempotency_key) throw new Error('idempotency_key חסר — בלעדיו אירוע יכול להישלח פעמיים');
  const existing = store.get('icount_outbox').find((row) => row.idempotency_key === idempotency_key);
  if (existing) return { row: existing, enqueued: false };
  const row = store.insert('icount_outbox', {
    id: financeId('iob'),
    event_type,
    payload,
    idempotency_key,
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
    last_error: null,
    status: 'pending',
    result: null,
  });
  return { row, enqueued: true };
}

/**
 * מיפוי אירוע → קריאת iCount. כל handler מחזיר את התוצאה לשמירה ב-result.
 * client_upsert מעדכן גם את icount_links.
 */
async function dispatchEvent(store, row, icountClient) {
  const payload = row.payload || {};
  switch (row.event_type) {
    case 'client_upsert': {
      const { clientId, created } = await icountClient.ensureClient(payload.parent);
      const links = store.get('icount_links');
      const existing = links.find((link) => link.entity_type === 'parent' && String(link.local_id) === String(payload.parent?.id));
      const linkRow = {
        entity_type: 'parent',
        local_id: String(payload.parent?.id || ''),
        icount_id: String(clientId),
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
      };
      if (existing) store.update('icount_links', existing.id, { ...existing, ...linkRow });
      else store.insert('icount_links', { id: financeId('ilk'), ...linkRow });
      return { client_id: clientId, created };
    }
    case 'invrec_create':
      return icountClient.createInvRec(payload);
    case 'refund_doc':
      return icountClient.createRefundDoc(payload);
    case 'doc_cancel':
      return icountClient.cancelDoc(payload);
    default:
      throw new Error(`סוג אירוע לא מוכר ב-outbox: ${row.event_type}`);
  }
}

const DOCUMENT_EVENTS = new Set(['invrec_create', 'refund_doc', 'doc_cancel']);

/**
 * ריצת worker אחת: מושך את הממתינים שהגיע זמנם, שולח, ומעדכן.
 * לא זורק על אירוע בודד; כשל סופי הופך לפריט inbox מסוג sync_error.
 */
export async function processOutbox(store, {
  icountClient,
  now = new Date(),
  maxAttempts = MAX_OUTBOX_ATTEMPTS,
  allowRealDocs = icountRealDocsAllowed(),
} = {}) {
  const nowIso = now.toISOString();
  const due = store.get('icount_outbox')
    .filter((row) => row.status === 'pending' && (!row.next_attempt_at || row.next_attempt_at <= nowIso))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const summary = { processed: 0, sent: 0, mocked: 0, retried: 0, dead: 0 };

  for (const row of due) {
    summary.processed += 1;
    if (DOCUMENT_EVENTS.has(row.event_type) && !allowRealDocs) {
      // סביבת פיתוח: המסמך לא נוצר באמת, והשורה מסומנת ככזו במפורש.
      store.update('icount_outbox', row.id, {
        ...row,
        status: 'sent',
        result: { mock: true, note: 'סביבה שאינה פרודקשן — לא הונפק מסמך אמיתי' },
        updated_at: nowIso,
      });
      summary.mocked += 1;
      continue;
    }
    try {
      const result = await dispatchEvent(store, row, icountClient);
      store.update('icount_outbox', row.id, {
        ...row,
        status: 'sent',
        result,
        last_error: null,
        updated_at: nowIso,
      });
      summary.sent += 1;
    } catch (error) {
      const attempts = (row.attempts || 0) + 1;
      if (attempts >= maxAttempts) {
        store.update('icount_outbox', row.id, {
          ...row,
          attempts,
          status: 'dead',
          last_error: error.message || 'שגיאה לא ידועה',
          updated_at: nowIso,
        });
        upsertInboxItem(store, {
          item_type: 'sync_error',
          ref_table: 'icount_outbox',
          ref_id: row.id,
          title: `הנפקה ל-iCount נכשלה סופית (${row.event_type})`,
          detail: `${attempts} ניסיונות. שגיאה אחרונה: ${error.message || ''}. אפשר לנסות שוב מהממשק.`,
        });
        summary.dead += 1;
      } else {
        const delayMinutes = BASE_RETRY_MINUTES * 2 ** (attempts - 1);
        store.update('icount_outbox', row.id, {
          ...row,
          attempts,
          next_attempt_at: new Date(now.getTime() + delayMinutes * 60000).toISOString(),
          last_error: error.message || 'שגיאה לא ידועה',
          updated_at: nowIso,
        });
        summary.retried += 1;
      }
    }
  }
  return summary;
}

/** החייאת שורת dead — כפתור "נסה שוב" בממשק. */
export function reviveOutboxRow(store, id) {
  const row = store.get('icount_outbox').find((item) => String(item.id) === String(id));
  if (!row) throw new Error('שורת ה-outbox לא נמצאה');
  if (row.status === 'sent') throw new Error('האירוע כבר נשלח בהצלחה');
  return store.update('icount_outbox', row.id, {
    ...row,
    status: 'pending',
    attempts: 0,
    next_attempt_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}
