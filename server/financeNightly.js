/**
 * הג'וב הלילי של המרכז הפיננסי. כל חלק מאחורי הדגל שלו, נכשל לבד,
 * ומדווח לבד — ריצה חלקית עדיפה על שום ריצה.
 * שלבים מאוחרים (ledger, תחזית תזרים) מתווספים כחלקים חדשים כאן.
 */

import { db } from './db.js';
import { financeFlag } from './financeCore.js';
import { icount } from './icount.js';
import { runFinanceSync } from './financeSync.js';
import { durableRecordingStore } from './bankSync.js';
import { matureInstallments } from './bankIngestion.js';
import { processOutbox } from './icountOutbox.js';
import { runIcountReconciliation } from './icountReconciliation.js';
import { createGmailProvider, gmailConfigured, runEmailIngestion } from './emailIngestion.js';
import { matchableDocuments, proposeMatches } from './matchingEngine.js';
import { chooseExpenseRows } from './finance.js';
import { tagUntaggedExpenses } from './financeAiTagging.js';
import { rebuildLedger } from './financeLedger.js';
import { rebuildCashFlowForecast } from './financeCashFlow.js';

const israelHour = (now) => Number(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false,
}).format(now));
const israelDate = (value) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(value instanceof Date ? value : new Date(value));

/** טהור, לטסטים: האם הריצה הלילית כבר הגיע זמנה היום. חלון: מ-04:00. */
export function isNightlyDue(statusRow, now = new Date()) {
  if (israelHour(now) < 4) return false;
  if (!statusRow?.last_run_at) return true;
  return israelDate(statusRow.last_run_at) !== israelDate(now);
}

/**
 * רשת ביטחון ל-cron: ה-cron הייעודי מוגדר ב-render.yaml, אבל אם הוא לא
 * נוצר בפועל — ה-cron הקיים של סנכרון iCount (כל 15 דקות) קורא לכאן,
 * והריצה הלילית מתבצעת פעם ביום מהקריאה הראשונה אחרי 04:00.
 */
export async function runFinanceNightlyIfDue({ now = new Date() } = {}) {
  const status = db.getOne('finance_center_settings', 'nightly_status');
  if (!isNightlyDue(status, now)) return { skipped: true, reason: 'כבר רצה היום או לפני החלון' };
  return runFinanceNightly({ now });
}

export async function runFinanceNightly({ now = new Date() } = {}) {
  const report = { started_at: now.toISOString(), parts: {} };
  const store = durableRecordingStore();

  const part = async (name, flag, run) => {
    if (!financeFlag(flag)) {
      report.parts[name] = { skipped: true, reason: `דגל ${flag} כבוי` };
      return;
    }
    try {
      report.parts[name] = await run();
    } catch (error) {
      report.parts[name] = { error: error.message || 'שגיאה לא ידועה' };
    }
  };

  // משיכת iCount טרייה לפני היישוב — אין cron חיצוני שעושה את זה.
  await part('icount_pull', 'reconciliation', () => runFinanceSync({ full: false, sources: ['icount'] }));
  await part('outbox', 'icount_outbox', () => processOutbox(store, { icountClient: icount, now }));
  await part('email', 'doc_ingestion', async () => ((await gmailConfigured())
    ? runEmailIngestion(store, { provider: createGmailProvider() })
    : { skipped: true, reason: 'Gmail לא מחובר (חסם B2)' }));
  // תשלומים עתידיים שתאריכם הגיע הופכים להוצאה ומצטרפים למחזור האשראי.
  await part('installments', 'bank_ingestion', () =>
    Promise.resolve(matureInstallments(store, { now: now.toISOString().slice(0, 10) })));
  // מנוע ההתאמה רץ לפני הספר: התאמה (גם מוצעת) היא מה שמונע ספירה כפולה
  // של הוצאה שמופיעה גם כתנועת אשראי וגם כמסמך iCount.
  await part('matching', 'matching_v2', () => {
    const proposals = proposeMatches({
      transactions: db.get('finance_transactions'),
      documents: matchableDocuments({
        expenses: chooseExpenseRows(db.get('finance_expenses')),
        ingested: db.get('finance_ingested_documents'),
        suppliers: db.get('finance_suppliers'),
      }),
      existingMatches: db.get('finance_matches'),
    });
    for (const proposal of proposals) store.insert('finance_matches', proposal);
    return Promise.resolve({
      proposed: proposals.filter((row) => row.status === 'proposed').length,
      auto_confirmed: proposals.filter((row) => row.status === 'confirmed').length,
    });
  });
  // תיוג AI אחרי מנוע ההתאמה והחוקים — חוק ואדם גוברים על המודל.
  await part('ai_tagging', 'ai_tagging', () => tagUntaggedExpenses(store, { now }));
  await part('reconciliation', 'reconciliation', () =>
    Promise.resolve(runIcountReconciliation(store, { now: now.toISOString() })));
  await part('ledger', 'ledger', () => Promise.resolve(rebuildLedger(store, { now: now.toISOString() })));
  await part('cash_flow', 'ledger', () => Promise.resolve(rebuildCashFlowForecast(store, { now: now.toISOString() })));

  await store.flush();
  const statusRow = {
    id: 'nightly_status',
    last_run_at: new Date().toISOString(),
    report,
  };
  const existing = db.getOne('finance_center_settings', 'nightly_status');
  if (existing) db.update('finance_center_settings', 'nightly_status', { ...existing, ...statusRow });
  else db.insert('finance_center_settings', statusRow);
  report.finished_at = new Date().toISOString();
  return report;
}
