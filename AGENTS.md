# AGENTS.md

## Cursor Cloud specific instructions

### מבנה הפרויקט (overview)

מערכת ניהול (CRM) לקיר טיפוס. שני שירותים:

- שרת API — תיקייה `server/`. Express על Node, מודול ESM (`"type": "module"`). מאזין על פורט `5000`.
- אתר — תיקייה `client/`. React + Vite. רץ על פורט `3000`.

תיקיית `database/` מכילה קובצי SQL של Supabase. השורש מכיל סקריפטים חד-פעמיים (deploy, tunnel, בדיקות טוקן) שאינם חלק מהרצה הרגילה.

### התקנת חבילות

מותקן אוטומטית בהפעלה דרך סקריפט העדכון (`npm install` בכל אחת מהתיקיות `server` ו-`client`). אין צורך להתקין ידנית.

### הרצה בפיתוח

הפקודות הרגילות מתועדות ב-`README.md`. בקצרה:

- שרת: מתוך `server/` הרץ `npm run dev` (nodemon).
- אתר: מתוך `client/` הרץ `npm run dev`.
- פתח `http://localhost:3000`.

ה-Vite מעביר כל קריאה ל-`/api` אל השרת בפורט 5000 (proxy מוגדר ב-`client/vite.config.js`).

### בדיקות, build ו-lint

- בדיקות שרת: מתוך `server/` הרץ `npm test` (Node built-in test runner).
- build של האתר: מתוך `client/` הרץ `npm run build`.
- אין סקריפט lint בפרויקט.

### נקודות חשובות ולא מובנות מאליהן (gotchas)

- הרצה בלי Supabase עובדת. אם המשתנים `SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` חסרים, השרת מדפיס אזהרה ונופל אוטומטית לקובץ מקומי `db.json` (נזרע עם נתוני דוגמה). המידע לא נשמר בין הפעלות במצב הזה.
- כניסה למערכת (מסך ה-CRM המלא) דורשת Supabase בצד הלקוח. בלי `VITE_SUPABASE_URL` ו-`VITE_SUPABASE_ANON_KEY` (בקובץ `client/.env.local`), האתר מציג "הכניסה עדיין לא הוגדרה" ואי אפשר להתחבר.
- כדי לבדוק את הליבה בלי Supabase, השתמש במסכים הציבוריים שלא דורשים כניסה: טופס ליד ב-`/join`, הצהרת בריאות ב-`/health`, הרשמה ב-`/onboard`. הם שולחים ל-endpoints תחת `/api/public/*` ונשמרים ב-`db.json`.
- קליטת ליד מזהה כפילויות לפי טלפון. אם הטלפון תואם רשומת הורה קיימת (כולל נתוני הזרע), המתאמן החדש מקושר להורה הקיים במקום ליצור הורה חדש.
- endpoints שאינם ציבוריים מחזירים 401 בלי טוקן. לפיתוח מקומי אפשר לעקוף אימות בצד השרת עם `CRM_AUTH_DISABLED=true` (רק כאשר `NODE_ENV` אינו production); זה לא עוקף את מסך הכניסה בצד הלקוח.
- `server/db.json` הוא ephemeral ומוחרג ב-gitignore. nodemon מוגדר להתעלם ממנו כדי שכתיבות לא יגרמו לריסטארט אינסופי.
- דוגמאות למשתני סביבה: `server/.env.example`. אין `client/.env.example` במאגר למרות ש-`README.md` מזכיר אותו; ליצירת כניסה מלאה צור `client/.env.local` עם `VITE_SUPABASE_URL` ו-`VITE_SUPABASE_ANON_KEY`.
