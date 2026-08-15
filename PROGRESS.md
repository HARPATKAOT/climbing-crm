# PROGRESS — מרכז פיננסי (FINANCE_SPEC.md)

עדכון אחרון: 2026-08-15. סשן: worktree `finance-center`.

## חסמים פתוחים (ממתין לאישור ידני / credentials)

| # | מה | סטטוס | מה נדרש מהבעלים |
|---|---|---|---|
| B1 | משיכת בנק/אשראי חיה (מרכנתיל + Max) | קוד מאחורי flag כבוי + mock | התקנת `israeli-bank-scrapers` (מאושרת בדיפלוי הבא), הזנת credentials ב-Render env — לעולם לא בצ'אט |
| B2 | Gmail — קריאת חשבוניות מהתיבה | interface + mock, flag כבוי | יצירת OAuth/service-account ב-Google Cloud + הזנת מפתחות ב-Render |
| B3 | מיגרציית SQL של הטבלאות המנורמלות | קובץ SQL מוכן, לא הורץ | הרצה ידנית ב-Supabase SQL editor (לא חוסם — הכול רץ על kv) |
| B4 | OCR לחשבוניות סרוקות (תמונה בלי שכבת טקסט) | לא מומש | החלטה על ספק OCR (עלות/פרטיות) — בינתיים נקלט עם confidence נמוך לשיוך ידני |

## שלבים

### שלב R — Recon + מסמכים — **done**
- קריטריון: סעיף 0 במפרט מלא מקוד אמיתי; PROGRESS/DECISIONS קיימים; דוח recon שמור.
- תוצרים: `FINANCE_SPEC.md` (סעיף 0 + 13 מולאו), `docs/finance/RECON.md` (מפה מלאה + ERD), `DECISIONS.md`.

### שלב 0 — סכמת finance + מיגרציות — **done**
- קריטריון: טבלאות חדשות רשומות וזמינות; SQL twin עולה ויורד נקי; ERD; טסטים עוברים.
- טבלאות חדשות (kv, רישום ב-OPERATIONAL_TABLES): `financial_accounts`, `finance_transactions`,
  `finance_matches`, `finance_categories`, `finance_cost_centers`, `finance_cost_allocations`,
  `finance_ledger_entries`, `finance_cash_flow_items`, `finance_cc_cycles`,
  `icount_outbox`, `icount_links`, `finance_rules`, `finance_inbox_items`, `finance_center_settings`.
- ליבה: `server/financeCore.js` (feature flags, כסף באגורות, dedupe_hash, סיווג kind).
- SQL twin: `database/20260815_finance_center.sql` (up) + הערות down בקובץ.

### שלב 1 — ingestion בנק+אשראי, dedupe, settlement — todo
- קריטריון: ייבוא פעמיים = 0 כפילויות (טסט); חיוב אשראי מרוכז מסווג settlement ולא נספר כהוצאה (טסט); תשלומים עתידיים של Max → cash_flow_items (טסט); ריצת 0 תנועות ביום עסקים = שגיאה.

### שלב 1.5 — iCount דו-כיווני: outbox, reconciliation, פאנל בריאות — todo
- קיים כבר: pull מלא (financeSync, cron כל 15 דק), push (invrec מהקופה, IPN). נבנה: outbox לכשלונות+retry+DLQ, reconciliation לילי → פריטי inbox, פאנל בריאות, סנכרון ספקים דו-כיווני.
- קריטריון: טסט outbox idempotency; ג'וב reconciliation מדווח פערים כפריטים ולא בלוג.

### שלב 2 — קליטת חשבוניות: העלאה, מייל, parsing — todo
- קריטריון: pipeline אחד לכל המקורות; חילוץ ספק+סכום+תאריך+ח.פ+מספר מסמך עם confidence; dedupe מול iCount.

### שלב 3 — מנוע התאמה רבים-לרבים + תיבת נכנס + מסך התאמה — todo
- קריטריון: unit tests למנוע הניקוד (סכום 40/תאריך 25/ספק 25/מזהים 10, ספים 90/60); alias learning; אין ספירה כפולה (settlement guard בטסט); inbox API + counter בסיידבר.

### שלב 4 — ספקים, עץ קטגוריות, מנוע חוקים, מע״מ — todo
- קריטריון: מיפוי הקטגוריות הקיימות לעץ; חוק "ספק X → קטגוריה Y" נלמד מאישור ידני; מונה "מע״מ אבוד".

### שלב 5 — עלות שכר אמיתית ושיוך לחוגים — todo
- קריטריון: עלות מעביד = ברוטו × מקדם (ברירת מחדל מתועדת, ניתן לכיול); cost per hour פר עובד; עלות מדריך פר חוג/פעילות מ-work_assignments הקפואים (בלי לחשב מחדש — כלל ההקפאה); מאומת על 3 דוגמאות.

### שלב 6 — ledger, P&L, תזרים+תחזית, רווחיות פר מרכז — todo
- קריטריון: ledger_entries נגזר מכל המקורות בלי כפילות; toggle מזומן/צבירה; פריסת הכנסה נדחית למנויים רב-חודשיים; P&L מדורג; תחזית 90 יום; רווחיות פר חוג עם נקודת איזון.

### שלב 7 — דשבורד, FinChart, סינונים, drill-down — todo
- קריטריון: build עובר; טאבים חדשים בשפת העיצוב הקיימת; כל KPI לחיץ; RTL תקין; sparklines.

## איך לבדוק ידנית (יתעדכן פר שלב)
- טסטים: `cd server && npm run test:finance` (הרשימה המלאה ב-package.json מתעדכנת עם כל קובץ טסט חדש).
- מסך: `npm run dev` בשורש (pm2), ואז `/reports` — או harness בלי לוגין: `VITE_CRM_AUTH_DISABLED=true` ב-vite dev.

## הערות המשך-סשן
- עובדים ב-worktree `finance-center`, ענף `worktree-finance-center`. merge ל-main רק בסוף ריצה תקינה, בדחיפה ישירה של הענף ל-main (ראה זיכרון "Merge via direct push").
- לא נוגעים ב-flow קיים של iCount (rule 9). כל חדש מאחורי feature flag כבוי בפרודקשן (`server/financeCore.js`).
