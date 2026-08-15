/**
 * תזמור משיכת בנק/אשראי מעל שכבת הנתונים האמיתית — FINANCE_SPEC שלב 1.
 *
 * הלוגיקה עצמה ב-bankIngestion.js (טהורה, store מוזרק). כאן: store עמיד
 * שאוסף את השורות שנגעו בהן ומקבע אותן ב-Supabase בסוף הריצה (awaited —
 * "כתיבות כסף חוסמות"), בחירת provider פר חשבון, וחלון משיכה חופף.
 */

import { db } from './db.js';
import { supa } from './supa.js';
import { financeFlag, financeId } from './financeCore.js';
import { createScraperProvider, credentialsFromEnv, PROVIDER_CATALOG } from './bankProviders.js';
import { syncAccount } from './bankIngestion.js';

const OVERLAP_DAYS = 45;

/** Store מעל db שרושם כל שורה שנגעו בה, ומקבע אותן בבת אחת בסוף. */
export function durableRecordingStore() {
  const touched = new Map();
  const record = (table, row) => {
    if (!touched.has(table)) touched.set(table, new Map());
    touched.get(table).set(String(row.id), row);
  };
  return {
    get: (table) => db.get(table),
    insert: (table, row) => {
      const saved = db.insert(table, row);
      record(table, saved);
      return saved;
    },
    update: (table, id, row) => {
      const saved = db.update(table, id, row) || row;
      record(table, saved);
      return saved;
    },
    async flush() {
      if (!supa.isEnabled()) return { ok: true, tables: 0 };
      for (const [table, rows] of touched) {
        const result = await supa.upsertMany(table, [...rows.values()]);
        if (!result.ok) throw new Error(result.error || `שמירת ${table} נכשלה`);
      }
      return { ok: true, tables: touched.size };
    },
  };
}

function sinceDate(now = new Date()) {
  return new Date(now.getTime() - OVERLAP_DAYS * 86400000).toISOString().slice(0, 10);
}

/** חשבונות פעילים שיש להם ספק משיכה מוכר. */
export function scrapableAccounts() {
  return db.get('financial_accounts')
    .filter((account) => account.is_active !== false && PROVIDER_CATALOG[account.institution]);
}

/**
 * ריצת הסנכרון המלאה. לא זורקת על חשבון בודד — כל חשבון מדווח לעצמו,
 * וכשלי אימות הופכים לפריטי inbox (בתוך syncAccount).
 */
export async function runBankSync({ providerFactory = createScraperProvider, now } = {}) {
  if (!financeFlag('bank_ingestion')) {
    return { skipped: true, reason: 'דגל bank_ingestion כבוי' };
  }
  const store = durableRecordingStore();
  const accounts = scrapableAccounts();
  const results = [];
  for (const account of accounts) {
    const provider = providerFactory(account.institution, {
      credentials: credentialsFromEnv(account.institution) || undefined,
    });
    results.push(await syncAccount(store, {
      account,
      provider,
      since: sinceDate(now ? new Date(now) : undefined),
      now: (now || new Date().toISOString()).slice(0, 10),
    }));
  }
  const status = {
    id: 'bank_sync_status',
    last_run_at: new Date().toISOString(),
    results,
    accounts: accounts.length,
  };
  const existing = db.getOne('finance_center_settings', 'bank_sync_status');
  if (existing) store.update('finance_center_settings', 'bank_sync_status', { ...existing, ...status });
  else store.insert('finance_center_settings', status);
  await store.flush();
  return { skipped: false, results, run_id: financeId('bsr') };
}
