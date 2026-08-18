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
    credentialFields: ['id', 'password'], // ת״ז, סיסמה
    // חשבון עסקי במרכנתיל נכנס בת״ז וסיסמה בלבד; בכניסה הפרטית יש גם קוד
    // משתמש. הספרייה ממלאת טופס עם שלושת השדות, ולכן חסר מתורגם למחרוזת
    // ריקה — לא לחסימת ההגדרה כולה.
    optionalCredentialFields: ['num'],
    envPrefix: 'BANK_MERCANTILE',
  },
  max: {
    label: 'Max',
    accountType: 'credit_card',
    credentialFields: ['username', 'password'],
    envPrefix: 'BANK_MAX',
  },
};

/** קורא credentials מ-env לפי הקטלוג. חסר שדה חובה ⇒ null, לא שגיאה. */
export function credentialsFromEnv(providerKey, env = process.env) {
  const spec = PROVIDER_CATALOG[providerKey];
  if (!spec) throw new Error(`ספק לא מוכר: ${providerKey}`);
  const credentials = {};
  for (const field of spec.credentialFields) {
    const value = env[`${spec.envPrefix}_${field.toUpperCase()}`];
    if (!value) return null;
    credentials[field] = value;
  }
  for (const field of spec.optionalCredentialFields || []) {
    credentials[field] = env[`${spec.envPrefix}_${field.toUpperCase()}`] || '';
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

const SME_BASE_URL = 'https://start.telebank.co.il';

/**
 * חשבון עסקי במרכנתיל נכנס בעמוד נפרד (LOGIN_PAGE_SME) עם שני שדות בלבד —
 * ולכן הזרימה של israeli-bank-scrapers, שממלאה גם קוד מזהה, נכשלת בו.
 * אותם מזהי שדות ואותו API פנימי (Titan/gatewayAPI), רק בלי השדה השלישי,
 * אז ההתחברות ממומשת כאן ישירות מעל puppeteer.
 */
async function fetchSmeAccountData({ credentials, since }) {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    const error = new Error('puppeteer אינו מותקן — משיכה חיה ממתינה להתקנה');
    error.code = 'scraper_not_installed';
    throw error;
  }
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.goto(`${SME_BASE_URL}/login/?multilang=he&bank=m&t=s`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#tzId', { timeout: 30000 });
    await page.type('#tzId', credentials.id);
    await page.type('#tzPassword', credentials.password);
    await Promise.all([
      page.click('.sendBtn'),
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null),
    ]);

    const landedUrl = await page.url();
    if (landedUrl.includes('LOGIN_PAGE')) {
      const pageError = await page.evaluate(() => document.querySelector('#general-error, .error-message, [class*="error"]')?.textContent?.trim() || '');
      const error = new Error(pageError || 'הכניסה לחשבון העסקי נדחתה — נשארנו בעמוד הכניסה');
      error.code = 'auth_required';
      throw error;
    }

    // אפליקציית העסקים נטענת ואז מושכת נתונים בעצמה; ממתינים שתסיים כדי
    // שנוכל גם לקרוא את אותו API וגם לזהות את הכתובות שלו ברשת.
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const fromDate = String(since || '').replace(/-/g, '') || undefined;
    const accountsInfo = await page.evaluate(async () => {
      try {
        const response = await fetch('/Titan/gatewayAPI/userAccountsData', { credentials: 'include' });
        if (!response.ok) return { httpStatus: response.status };
        return await response.json();
      } catch (error) { return { fetchError: String(error) }; }
    });
    if (!accountsInfo?.UserAccountsData) {
      // אבחון: אילו כתובות נתונים האפליקציה עצמה קראה — הכתובת הנכונה
      // נמצאת ביניהן, והסבב הבא של הקוד ישתמש בה.
      const resources = await page.evaluate(() => [...new Set(
        performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => /gateway|api|titan|account|transaction/i.test(name))
          .map((name) => name.replace(/^https:\/\/start\.telebank\.co\.il/, '').split('?')[0]),
      )].slice(0, 25));
      const error = new Error(`הכניסה הצליחה (${landedUrl}) אבל קריאת הנתונים לא: ${JSON.stringify(accountsInfo).slice(0, 120)} | רשת: ${resources.join(' ; ')}`);
      error.code = 'scrape_failed';
      throw error;
    }

    const accounts = (accountsInfo.UserAccountsData.UserAccounts || [])
      .map((account) => account?.NewAccountInfo?.AccountID)
      .filter(Boolean);
    const rawTxns = [];
    for (const accountNumber of accounts) {
      const data = await page.evaluate(async (acc, from) => {
        const query = `IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True${from ? `&FromDate=${from}` : ''}`;
        const response = await fetch(`/Titan/gatewayAPI/lastTransactions/${acc}/Date?${query}`, { credentials: 'include' });
        if (!response.ok) return { httpStatus: response.status };
        return response.json();
      }, accountNumber, fromDate);
      const block = data?.CurrentAccountLastTransactions;
      if (!block) continue;
      const toRaw = (entry, pending) => ({
        identifier: entry.OperationNumber,
        date: String(entry.OperationDate || ''),
        processedDate: String(entry.ValueDate || entry.OperationDate || ''),
        chargedAmount: Number(entry.OperationAmount) || 0,
        description: entry.OperationDescriptionToDisplay || '',
        status: pending ? 'pending' : 'completed',
      });
      for (const entry of block.OperationEntry || []) rawTxns.push({ ...toRaw(entry, false), accountNumber });
      for (const entry of block.FutureTransactionsBlock?.FutureTransactionEntry || []) rawTxns.push({ ...toRaw(entry, true), accountNumber });
    }
    return rawTxns;
  } finally {
    await browser.close();
  }
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
      if (providerKey === 'mercantile') {
        const resolvedSme = credentials ?? credentialsFromEnv(providerKey);
        if (!resolvedSme) {
          const error = new Error(`חסרים פרטי גישה ל${spec.label} (env ${spec.envPrefix}_*)`);
          error.code = 'credentials_missing';
          throw error;
        }
        const rows = await fetchSmeAccountData({ credentials: resolvedSme, since: dateOnly(since) });
        return rows.map((txn) => ({
          ...normalizeScrapedTransaction({
            ...txn,
            date: txn.date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
            processedDate: txn.processedDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
          }),
          accountNumber: String(txn.accountNumber || ''),
        }));
      }
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

/**
 * מתאם ל-CSV הקיים (financeAutomation.parseFinanceCsv) — אותו RawTxn.
 * הסימן: תא שלילי/בסוגריים בכרטיס = זיכוי מבית עסק (כסף חוזר, חיובי);
 * בבנק = חיוב (שלילי). תא חיובי = חיוב בכרטיס; בבנק — תלוי בעמודה:
 * עמודת 'זכות' היא כסף נכנס, כל השאר חיוב. מוגבל מטבעו — משיכת בנק
 * אמיתית (B1) היא המקור המלא, וה-CSV גשר.
 */
export function fromCsvRows(rows = []) {
  return rows.map((row) => {
    const absolute = Math.abs(Number(row.amount) || 0);
    const isBank = row.account_type === 'bank';
    const creditColumn = /זכות|credit/i.test(String(row.amount_header || ''));
    let amountShekels;
    if (row.amount_negative) amountShekels = isBank ? -absolute : absolute;
    else if (isBank && creditColumn) amountShekels = absolute;
    else amountShekels = -absolute;
    return {
      externalId: String(row.external_id || ''),
      date: String(row.transaction_date || '').slice(0, 10),
      processedDate: String(row.transaction_date || '').slice(0, 10),
      amountShekels,
      description: String(row.description || ''),
      memo: '',
      installments: null,
      pending: false,
      source: 'csv',
      raw: { source: 'csv', id: row.id },
    };
  });
}
