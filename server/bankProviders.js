/**
 * BankProvider — שכבת הבידוד בין המרכז הפיננסי לספקי הנתונים (FINANCE_SPEC 4.1).
 *
 * כל ספק מחזיר אותו מבנה RawTxn, כך שהחלפת israeli-bank-scrapers בספק
 * Open Banking מורשה לא נוגעת בשום דבר מעבר לקובץ הזה.
 *
 * קריאה בלבד. אין כאן — ולא יהיה — שום נתיב שמבצע פעולה בחשבון.
 * Credentials לעולם לא נשמרים כאן; הם מגיעים מ-env בזמן ריצה בלבד.
 */

const dateOnly = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toISOString().slice(0, 10);
};

/**
 * צורת ה-credentials פר מוסד — שמות שדות בלבד, אף פעם לא ערכים.
 * מרכנתיל (משפחת דיסקונט) דורש שלושה שדות; Max שניים. אין להניח אחידות.
 */
export const PROVIDER_CATALOG = {
  mercantile: {
    label: 'מרכנתיל דיסקונט',
    accountType: 'bank',
    credentialFields: ['id', 'password', 'num'], // ת״ז, סיסמה, קוד משתמש
    envPrefix: 'BANK_MERCANTILE',
  },
  max: {
    label: 'Max',
    accountType: 'credit_card',
    credentialFields: ['username', 'password'],
    envPrefix: 'BANK_MAX',
  },
};

/** קורא credentials מ-env לפי הקטלוג. חסר שדה ⇒ null, לא שגיאה. */
export function credentialsFromEnv(providerKey, env = process.env) {
  const spec = PROVIDER_CATALOG[providerKey];
  if (!spec) throw new Error(`ספק לא מוכר: ${providerKey}`);
  const credentials = {};
  for (const field of spec.credentialFields) {
    const value = env[`${spec.envPrefix}_${field.toUpperCase()}`];
    if (!value) return null;
    credentials[field] = value;
  }
  return credentials;
}

/**
 * מתרגם תנועה של israeli-bank-scrapers ל-RawTxn אחיד.
 * chargedAmount חתום (הוצאה שלילית). תנועת תשלומים נושאת installments.
 */
export function normalizeScrapedTransaction(txn = {}) {
  return {
    externalId: String(txn.identifier ?? ''),
    date: dateOnly(txn.date),
    processedDate: dateOnly(txn.processedDate || txn.date),
    amountShekels: Number(txn.chargedAmount ?? txn.originalAmount ?? 0),
    description: String(txn.description || '').trim(),
    memo: String(txn.memo || '').trim(),
    installments: txn.installments && Number(txn.installments.total) > 1
      ? { number: Number(txn.installments.number) || 1, total: Number(txn.installments.total) }
      : null,
    pending: String(txn.status || '').toLowerCase() === 'pending',
    raw: txn,
  };
}

/**
 * Provider אמיתי מעל israeli-bank-scrapers, בטעינה דינמית: החבילה כבדה
 * (דפדפן מלא) ומותקנת רק אחרי אישור (PROGRESS.md חסם B1). בלעדיה —
 * שגיאת scraper_not_installed מסודרת, לא קריסה בעליית השרת.
 */
export function createScraperProvider(providerKey, { credentials } = {}) {
  const spec = PROVIDER_CATALOG[providerKey];
  if (!spec) throw new Error(`ספק לא מוכר: ${providerKey}`);
  return {
    key: providerKey,
    accountType: spec.accountType,
    async fetchTransactions(since) {
      let scrapers;
      try {
        scrapers = await import('israeli-bank-scrapers');
      } catch {
        const error = new Error('israeli-bank-scrapers אינו מותקן — משיכה חיה ממתינה לאישור התקנה');
        error.code = 'scraper_not_installed';
        throw error;
      }
      const resolved = credentials ?? credentialsFromEnv(providerKey);
      if (!resolved) {
        const error = new Error(`חסרים פרטי גישה ל${spec.label} (env ${spec.envPrefix}_*)`);
        error.code = 'credentials_missing';
        throw error;
      }
      const scraper = scrapers.createScraper({
        companyId: providerKey,
        startDate: new Date(`${dateOnly(since)}T00:00:00`),
        combineInstallments: false, // כל תשלום עתידי כשורה נפרדת — התזרים צריך אותם
        showBrowser: false,
        verbose: false,
      });
      const result = await scraper.scrape(resolved);
      if (!result.success) {
        const error = new Error(result.errorMessage || `משיכה מ${spec.label} נכשלה`);
        // סוגי הכשל של הספרייה: INVALID_PASSWORD / CHANGE_PASSWORD / TIMEOUT...
        error.code = /password|credential|change/i.test(String(result.errorType || ''))
          ? 'auth_required'
          : 'scrape_failed';
        error.providerErrorType = result.errorType || null;
        throw error;
      }
      return (result.accounts || []).flatMap((account) =>
        (account.txns || []).map((txn) => ({
          ...normalizeScrapedTransaction(txn),
          accountNumber: String(account.accountNumber || ''),
        })));
    },
  };
}

/** Provider מדומה לפיתוח וטסטים — דטרמיניסטי, בלי רשת. */
export function createMockProvider(providerKey, transactions = []) {
  const spec = PROVIDER_CATALOG[providerKey] || { accountType: 'bank' };
  return {
    key: providerKey,
    accountType: spec.accountType,
    async fetchTransactions() {
      return transactions.map((txn) => normalizeScrapedTransaction(txn));
    },
  };
}

/** מתאם ל-CSV הקיים (financeAutomation.parseFinanceCsv) — אותו RawTxn. */
export function fromCsvRows(rows = []) {
  return rows.map((row) => ({
    externalId: String(row.external_id || ''),
    date: String(row.transaction_date || '').slice(0, 10),
    processedDate: String(row.transaction_date || '').slice(0, 10),
    // ה-CSV הקיים שומר סכום מוחלט של חיוב — במרכז הפיננסי הוצאה היא שלילית.
    amountShekels: -Math.abs(Number(row.amount) || 0),
    description: String(row.description || ''),
    memo: '',
    installments: null,
    pending: false,
    source: 'csv',
    raw: { source: 'csv', id: row.id },
  }));
}
