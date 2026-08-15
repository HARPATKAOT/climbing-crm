/**
 * קליטת תנועות בנק ואשראי אל finance_transactions — FINANCE_SPEC שלב 1.
 *
 * שלוש הבטחות שהטסטים אוכפים:
 *  1. idempotent — אותה תנועה פעמיים = שורה אחת (dedupe_hash).
 *  2. חיוב אשראי מרוכז בבנק = settlement, לעולם לא הוצאה, ומאומת מול מחזור.
 *  3. תשלומים עתידיים (Max) אינם הוצאה היום — הם צפי תזרים.
 *
 * ה-store מוזרק (דפוס cashRegister.js) כדי שהלוגיקה תיבדק על אובייקט רגיל.
 */

import { toAgorot } from './financeMoney.js';
import {
  financeId,
  transactionDedupeHash,
  classifyTransactionKind,
} from './financeCore.js';

const todayStr = () => new Date().toISOString().slice(0, 10);
const monthOf = (date) => String(date || '').slice(0, 7);

/** פריט לתיבת הנכנס, עם ייחודיות לפי (סוג, הפניה) כדי לא להציף. */
export function upsertInboxItem(store, item) {
  const existing = store.get('finance_inbox_items').find((row) =>
    row.item_type === item.item_type
    && String(row.ref_table || '') === String(item.ref_table || '')
    && String(row.ref_id || '') === String(item.ref_id || '')
    && row.status === 'open');
  if (existing) {
    return store.update('finance_inbox_items', existing.id, {
      ...existing,
      title: item.title,
      detail: item.detail ?? existing.detail,
      amount_agorot: item.amount_agorot ?? existing.amount_agorot,
      updated_at: new Date().toISOString(),
    });
  }
  return store.insert('finance_inbox_items', {
    id: financeId('fin'),
    status: 'open',
    detail: '',
    ...item,
  });
}

function normalizedTransactionRow(account, rawTxn, now) {
  const amountAgorot = toAgorot(rawTxn.amountShekels);
  const bookingDate = rawTxn.date || todayStr();
  const isFutureInstallment = Boolean(
    rawTxn.installments
    && (rawTxn.installments.number > 1 || rawTxn.pending)
    && bookingDate > (now || todayStr())
  );
  const kind = isFutureInstallment
    ? 'installment_future'
    : classifyTransactionKind({
      description: `${rawTxn.description} ${rawTxn.memo || ''}`,
      amountAgorot,
      accountType: account.type,
    });
  return {
    id: financeId('ftx'),
    account_id: account.id,
    external_id: rawTxn.externalId || '',
    booking_date: bookingDate,
    value_date: rawTxn.processedDate || bookingDate,
    amount_agorot: amountAgorot,
    currency: 'ILS',
    raw_description: rawTxn.description || '',
    merchant_raw: rawTxn.description || '',
    direction: amountAgorot >= 0 ? 'in' : 'out',
    kind,
    status: 'new',
    category_id: null,
    supplier_id: null,
    cc_cycle_id: null,
    installment_number: rawTxn.installments?.number ?? null,
    installments_total: rawTxn.installments?.total ?? null,
    dedupe_hash: transactionDedupeHash({
      provider: account.institution,
      accountKey: account.last4 || account.id,
      bookingDate,
      amountAgorot,
      description: rawTxn.description,
      externalId: rawTxn.externalId,
    }),
    source: rawTxn.source || 'scraper',
    raw_json: rawTxn.raw ?? null,
  };
}

/** מזהה/יוצר מחזור אשראי חודשי ומעדכן את הסכום הצפוי שלו. */
function accumulateCycle(store, account, row) {
  const cycleMonth = monthOf(row.booking_date);
  let cycle = store.get('finance_cc_cycles').find((item) =>
    item.account_id === account.id && item.cycle_month === cycleMonth);
  if (!cycle) {
    cycle = store.insert('finance_cc_cycles', {
      id: financeId('ccy'),
      account_id: account.id,
      cycle_month: cycleMonth,
      charge_date: null,
      expected_agorot: 0,
      settled_agorot: null,
      settlement_transaction_id: null,
      gap_agorot: null,
      status: 'open',
    });
  }
  const expected = (cycle.expected_agorot || 0) + Math.abs(row.amount_agorot);
  store.update('finance_cc_cycles', cycle.id, { ...cycle, expected_agorot: expected });
  return cycle.id;
}

/**
 * מנסה לקשור חיוב מרוכז בבנק למחזור אשראי פתוח, ומאמת שהסכומים נפגשים.
 * פער ⇒ פריט inbox מסוג reconciliation_gap — התראה, לא התעלמות (5.3).
 */
function settleCycle(store, settlementRow) {
  const amount = Math.abs(settlementRow.amount_agorot);
  const openCycles = store.get('finance_cc_cycles')
    .filter((cycle) => cycle.status === 'open' && cycle.expected_agorot > 0)
    // החיוב בבנק מגיע אחרי חודש המחזור — קודם המחזורים הישנים
    .sort((a, b) => a.cycle_month.localeCompare(b.cycle_month));
  if (!openCycles.length) return null;
  const exact = openCycles.find((cycle) => cycle.expected_agorot === amount);
  const cycle = exact || openCycles[0];
  const gap = amount - cycle.expected_agorot;
  store.update('finance_cc_cycles', cycle.id, {
    ...cycle,
    charge_date: settlementRow.booking_date,
    settled_agorot: amount,
    settlement_transaction_id: settlementRow.id,
    gap_agorot: gap,
    status: gap === 0 ? 'settled' : 'gap',
  });
  if (gap !== 0) {
    upsertInboxItem(store, {
      item_type: 'reconciliation_gap',
      ref_table: 'finance_cc_cycles',
      ref_id: cycle.id,
      title: `פער בין חיוב האשראי בבנק לתנועות הכרטיס (${cycle.cycle_month})`,
      detail: `החיוב בבנק ${amount} אג׳, סך תנועות הכרטיס ${cycle.expected_agorot} אג׳. ההפרש: ${gap} אג׳.`,
      amount_agorot: gap,
    });
  }
  return cycle.id;
}

/**
 * הקליטה עצמה. מחזירה סיכום; לא זורקת על תנועה בודדת פגומה — סופרת אותה.
 */
export function ingestRawTransactions(store, { account, rawTxns = [], now = todayStr() } = {}) {
  if (!account?.id) throw new Error('חשבון חסר בקליטת תנועות');
  const existing = store.get('finance_transactions');
  const existingHashes = new Set(existing.map((row) => row.dedupe_hash));
  // גשר בין מקורות: תנועה שנקלטה פעם מ-CSV ועכשיו מגיעה מה-scraper (או להפך)
  // היא אותו כסף — המוסד שונה בגלל חשבון ה-CSV הזמני, אז הזהות היא
  // תאריך+סכום+תיאור. חשבונות אמיתיים שונים לא חולקים מפתח כזה בפועל.
  const crossKey = (row) => `${row.booking_date}|${row.amount_agorot}|${String(row.raw_description).trim().toLowerCase().replace(/\s+/g, ' ')}`;
  const crossSourceKeys = new Set(existing
    .filter((row) => String(row.account_id) !== String(account.id))
    .map(crossKey));
  const summary = {
    fetched: rawTxns.length,
    inserted: 0,
    duplicates: 0,
    invalid: 0,
    pending_skipped: 0,
    future_installments: 0,
    settlements: 0,
  };

  for (const rawTxn of rawTxns) {
    let row;
    try {
      row = normalizedTransactionRow(account, rawTxn, now);
    } catch {
      summary.invalid += 1;
      continue;
    }
    if (row.amount_agorot === 0) { summary.invalid += 1; continue; }
    // תנועה שטרם נסלקה (pending) שאינה תשלום עתידי — מדלגים: כשהיא תיסלק
    // היא תחזור עם תאריך/סכום סופיים, וקליטת שני השלבים הייתה מכפילה אותה.
    if (rawTxn.pending && row.kind !== 'installment_future') { summary.pending_skipped += 1; continue; }
    if (existingHashes.has(row.dedupe_hash)) { summary.duplicates += 1; continue; }
    if (crossSourceKeys.has(crossKey(row))) { summary.duplicates += 1; continue; }
    existingHashes.add(row.dedupe_hash);

    if (account.type === 'credit_card' && row.kind === 'expense') {
      row.cc_cycle_id = accumulateCycle(store, account, row);
    }
    store.insert('finance_transactions', row);
    summary.inserted += 1;

    if (row.kind === 'installment_future') {
      summary.future_installments += 1;
      store.insert('finance_cash_flow_items', {
        id: financeId('fcf'),
        due_date: row.booking_date,
        amount_agorot: row.amount_agorot,
        direction: 'out',
        confidence: 'known',
        recurrence_rule: null,
        source_type: 'installment',
        source_id: row.id,
        description: `תשלום ${row.installment_number}/${row.installments_total}: ${row.raw_description}`,
        settled_transaction_id: null,
      });
    }
    if (row.kind === 'settlement' && account.type === 'bank' && row.amount_agorot < 0) {
      summary.settlements += 1;
      row.cc_cycle_id = settleCycle(store, row) || null;
      store.update('finance_transactions', row.id, row);
    }
  }
  return summary;
}

/**
 * הבשלת תשלומים עתידיים: תשלום שסומן installment_future ותאריכו הגיע הוא
 * מעכשיו הוצאה אמיתית — נכנס לרווחיות, מצטרף למחזור האשראי שלו, ופריט
 * התזרים שלו מסומן כסולק. בלי זה תשלומים 2+ לעולם לא היו נספרים (הריצה
 * החוזרת נחסמת ב-dedupe) והמחזור היה מתריע על פער שווא.
 */
export function matureInstallments(store, { now = todayStr() } = {}) {
  const summary = { matured: 0 };
  for (const transaction of store.get('finance_transactions')) {
    if (transaction.kind !== 'installment_future' || transaction.booking_date > now) continue;
    const account = store.get('financial_accounts').find((row) => String(row.id) === String(transaction.account_id));
    const matured = { ...transaction, kind: 'expense' };
    if (account?.type === 'credit_card') {
      matured.cc_cycle_id = accumulateCycle(store, account, matured);
    }
    store.update('finance_transactions', transaction.id, matured);
    const cashFlowItem = store.get('finance_cash_flow_items').find((row) =>
      row.source_type === 'installment' && String(row.source_id) === String(transaction.id));
    if (cashFlowItem && !cashFlowItem.settled_transaction_id) {
      store.update('finance_cash_flow_items', cashFlowItem.id, {
        ...cashFlowItem,
        settled_transaction_id: String(transaction.id),
      });
    }
    summary.matured += 1;
  }
  return summary;
}

const BUSINESS_DAYS = new Set([0, 1, 2, 3, 4]); // ראשון–חמישי

export function isIsraelBusinessDay(dateStr) {
  const weekday = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return BUSINESS_DAYS.has(weekday);
}

/**
 * ריצת סנכרון לחשבון אחד. שלושת מצבי הכשל של המפרט:
 *  - auth_required ⇒ פריט inbox "נדרש אימות", הריצה ממשיכה לחשבון הבא.
 *  - scraper שביר ⇒ 0 תנועות ביום עסקים זו שגיאה, לא "אין תנועות".
 *  - כשל אחר ⇒ פריט sync_error.
 */
export async function syncAccount(store, { account, provider, since, now = todayStr() } = {}) {
  try {
    const rawTxns = await provider.fetchTransactions(since);
    if (!rawTxns.length && isIsraelBusinessDay(now)) {
      upsertInboxItem(store, {
        item_type: 'sync_error',
        ref_table: 'financial_accounts',
        ref_id: account.id,
        title: `סנכרון ${account.display_name || account.institution}: 0 תנועות ביום עסקים`,
        detail: 'ייתכן שהאתר של המוסד השתנה או שהמשיכה נחסמה. יש לבדוק לפני שסומכים על הנתונים.',
      });
      return { account_id: account.id, status: 'suspicious_empty', ...ingestRawTransactions(store, { account, rawTxns: [], now }) };
    }
    const summary = ingestRawTransactions(store, { account, rawTxns, now });
    return { account_id: account.id, status: 'ok', ...summary };
  } catch (error) {
    const authIssue = error.code === 'auth_required';
    upsertInboxItem(store, {
      item_type: authIssue ? 'auth_required' : 'sync_error',
      ref_table: 'financial_accounts',
      ref_id: account.id,
      title: authIssue
        ? `${account.display_name || account.institution}: נדרש אימות מחדש`
        : `סנכרון ${account.display_name || account.institution} נכשל`,
      detail: error.message || '',
    });
    return { account_id: account.id, status: authIssue ? 'auth_required' : 'error', error: error.message };
  }
}
