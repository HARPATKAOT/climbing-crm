/**
 * הג'וב הלילי של המרכז הפיננסי. כל חלק מאחורי הדגל שלו, נכשל לבד,
 * ומדווח לבד — ריצה חלקית עדיפה על שום ריצה.
 * שלבים מאוחרים (ledger, תחזית תזרים) מתווספים כחלקים חדשים כאן.
 */

import { db } from './db.js';
import { financeFlag } from './financeCore.js';
import { icount } from './icount.js';
import { durableRecordingStore } from './bankSync.js';
import { processOutbox } from './icountOutbox.js';
import { runIcountReconciliation } from './icountReconciliation.js';
import { rebuildLedger } from './financeLedger.js';
import { rebuildCashFlowForecast } from './financeCashFlow.js';

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

  await part('outbox', 'icount_outbox', () => processOutbox(store, { icountClient: icount, now }));
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
