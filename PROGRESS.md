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

### שלב 1 — ingestion בנק+אשראי, dedupe, settlement — **done** (משיכה חיה ממתינה ל-B1)
- קריטריון: ייבוא פעמיים = 0 כפילויות (טסט ✓); חיוב אשראי מרוכז מסווג settlement ולא נספר כהוצאה + אימות מחזור (טסט ✓); תשלומים עתידיים של Max → cash_flow_items (טסט ✓); 0 תנועות ביום עסקים = פריט שגיאה (טסט ✓); כשל אימות = פריט inbox בלי להפיל ריצה (טסט ✓).
- קבצים: `server/bankProviders.js` (interface + מרכנתיל/Max + mock + CSV), `server/bankIngestion.js` (הצנרת), `server/bankSync.js` (תזמור + כתיבה עמידה), ראוטים ב-financeRoutes (`/accounts`, `/bank-sync`, `/inbox`), cron ב-render.yaml (04:30), ייבוא ה-CSV הקיים מזין גם את הצנרת החדשה.

### שלב 1.5 — iCount דו-כיווני: outbox, reconciliation, פאנל בריאות — **done**
- קיים כבר: pull מלא (financeSync, cron כל 15 דק), push (invrec מהקופה, IPN).
- נבנה: `icountOutbox.js` (idempotency ✓, backoff ✓, DLQ→inbox ✓, שער sandbox ✓, retry מהממשק), `icountReconciliation.js` (השוואת גבייה↔מסמכים↔מע״מ פר חודש, פער מוסבר/לא-מוסבר → פריטי inbox ✓), `financeNightly.js` (ג'וב לילי מודולרי), ראוטים `/health`, `/outbox`, `/outbox/:id/retry`, `/nightly-scheduled` + cron ב-render.yaml (05:00).
- הערה: דחיפת ספקים ל-iCount לא נתמכת ב-API הקיים (אין endpoint ספקים ב-icount.js) — מיזוג ב-pull בלבד, מתועד ב-DECISIONS.

### שלב 2 — קליטת חשבוניות: העלאה, מייל, parsing — **done** (מייל חי ממתין ל-B2, OCR ל-B4)
- נבנה: `documentParsing.js` (שכבת טקסט PDF כולל ToUnicode לעברית + חילוץ שדות עם confidence + זיהוי קישורי חשבוניות), `documentIngestion.js` (pipeline אחד, dedupe קובץ+עסקי, מיזוג מול iCount, פריטי inbox לספק חדש/ביטחון נמוך), `emailIngestion.js` (ספק Gmail ב-REST + mock), ראוטים `/documents/*`, `/email-sync`, וחלק email בג'וב הלילי.
- קריטריון 90% דיוק — לא ניתן לאימות בלי חשבוניות אמיתיות; מכוסה בטסטים על טקסט סינתטי (12 ✓). קובץ בלי שכבת טקסט נקלט ל-review, לא הולך לאיבוד.

### שלב 3 — מנוע התאמה רבים-לרבים + תיבת נכנס + מסך התאמה — **done**
- `matchingEngine.js`: ניקוד 40/25/25/10 עם ספים 90/60 (טסטים ✓), הקצאה חלקית + המשכיות פירעון (טסט ✓), צרור subset-sum לחיוב שמכסה כמה חשבוניות (טסט ✓), settlement guard (טסט ✓), למידת aliases מאישור ידני (טסט ✓), מונה "מע״מ אבוד" (טסט ✓).
- ראוטים: `/matching/run|state|:id/confirm|:id/reject|confirm-batch|manual`.
- UI: טאב חדש "מרכז התאמות" — תיבת נכנס + הצעות עם מקלדת (A/S/חצים) + שני חלונות עם קשירה ידנית + העלאת חשבונית. צבעי כל הטאבים קובעו עם `--tab-accent`. counter בסיידבר — נדחה לשלב 7 (אין מנגנון badge גנרי; מתועד).
- 12 טסטים ✓, build קליינט ✓.

### שלב 4 — ספקים, עץ קטגוריות, מנוע חוקים, מע״מ — **done**
- `financeCategories.js`: עץ ברירת מחדל (28 קטגוריות, ids יציבים) עם `legacy_labels` שממפות את התוויות החופשיות מ-Notion/iCount; זריעה idempotent ששומרת עריכות משתמש (טסט ✓); מנוע חוקים שמכבד סיווג ידני ולא נוגע ב-settlement (טסט ✓); למידת חוק מפעולת משתמש (טסט ✓); `vatSummary` — עסקאות/תשומות מקוזזות/מע״מ אבוד לפי כיסוי מסמכים ושיעור קיזוז (טסט ✓).
- ראוטים: `/categories`, `/transactions/:id/classify` (עם create_rule), `/rules`+`/rules/apply`, `/suppliers` (עם עריכת aliases וקטגוריית ברירת מחדל), `/vat-summary`.
- "109 הוצאות לא מסווגות" — התהליך: classify עם create_rule מוריד את הרשימה; UI ייעודי בשלב 7.

### שלב 5 — עלות שכר אמיתית ושיוך לחוגים — **done**
- `payrollCost.js`: קורא רק סכומים קפואים — המודול לא מקבל תעריפים בכלל, אז כלל ההקפאה לא ניתן להפרה (טסט ✓); מקדם מעביד 1.28 ניתן לכיול מההגדרות (טסט ✓); cost/hour פר עובד כולל flat (טסט ✓); רווחיות פר חוג מהרשמות פעילות × מחיר − עלות מדריך, עם נקודת איזון (טסט ✓); רווחיות פר מדריך (טסט ✓); שורות עבודה שטרם תומחרו מדווחות, לא מומצאות (טסט ✓).
- ראוט `/payroll-cost?month=` — כפול-שער: sensitive finance (הראוטר) + sensitive hr (בראוט).
- אימות ידני על 3 דוגמאות — דורש נתוני פרודקשן; לביצוע אחרי ההדלקה (הוראות ב"איך לבדוק").

### שלב 6 — ledger, P&L, תזרים+תחזית, רווחיות פר מרכז — **done**
- `financeLedger.js`: גזירה מכל המקורות עם מזהים דטרמיניסטיים (rebuild חוזר לא מכפיל — טסט ✓); מניעת כפילות: הכנסה דרך הדדופ הקיים של buildPaymentsReport, הוצאה עם match מאושר נספרת פעם אחת (טסט ✓); מקור שנעלם → voided, לא נמחק (טסט ✓); פריסת מנוי רב-חודשי משמרת סכום (טסט ✓); שכר קפוא בצבירה + תשלומי שכר בפועל במזומן (טסט ✓); P&L מדורג עד EBITDA (טסט ✓, פחת 0 מסומן).
- `financeCashFlow.js`: זיהוי הוצאות מחזוריות (3 חודשים רצופים, סטייה ≤15% — טסט ✓), שכר ממוצע, מע״מ משוער, הכנסת חוגים צפויה; ציר זמן עם מצטבר ונקודת מינימום (טסט ✓). יתרת בנק אמיתית תתווסף עם B1.
- ראוטים: `/ledger/rebuild`, `/pl?basis=cash|accrual`, `/cashflow?days=`, `/profit-centers` (שער hr). הג'וב הלילי מריץ הכול.

### שלב 7 — דשבורד, FinChart, סינונים, drill-down — **done חלקית** (8 מ-12 גרפים)
- `FinChart.jsx` (SVG טהור, RTL, בלי תלות חדשה): מפל P&L ✓, עמודות חודשיות+קו רווח ✓, תזרים מצטבר עם נקודת מינימום ✓, דונאט מע״מ ✓, פארטו ✓, פיזור רווחיות חוגים עם קו איזון ✓, heatmap ימים×שעות ✓, sparkline ל-KPI ✓.
- `ProfitDashboard.jsx` בטאב "רווחיות ותזרים" (מאחורי dashboard_v2; בלי הדגל — התצוגה הישנה): toggle מזומן/צבירה ✓, drill-down מכל גרף עד שורת המקור (`/ledger/entries`) ✓, גיול חוב ✓.
- פאנל בריאות סנכרון בטאב ההתאמות ✓; counter תיבת נכנס על פריט הניווט בסיידבר ✓; טאב ההתאמות מוצג רק כשהדגל דלוק (בטוח מול שרת ישן) ✓.
- **נשאר לגלגול הבא**: Sankey, קוהורט שימור, bullet תקציב-מול-ביצוע, מגמת חריגות, Treemap; סרגל סינון גלובלי דביק + Saved Views; טבלאות virtualized; ייצוא XLSX. ה-API והנתונים מוכנים — זו עבודת תצוגה בלבד.

## איך לבדוק ידנית (יתעדכן פר שלב)
- טסטים: `cd server && npm run test:finance` (הרשימה המלאה ב-package.json מתעדכנת עם כל קובץ טסט חדש).
- מסך: `npm run dev` בשורש (pm2), ואז `/reports` — או harness בלי לוגין: `VITE_CRM_AUTH_DISABLED=true` ב-vite dev.

## הערות המשך-סשן
- עובדים ב-worktree `finance-center`, ענף `worktree-finance-center`. merge ל-main רק בסוף ריצה תקינה, בדחיפה ישירה של הענף ל-main (ראה זיכרון "Merge via direct push").
- לא נוגעים ב-flow קיים של iCount (rule 9). כל חדש מאחורי feature flag כבוי בפרודקשן (`server/financeCore.js`).
