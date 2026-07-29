# קיר בועז CRM

מערכת ניהול לקיר הטיפוס קיר בועז. המערכת כוללת לידים, חוגים, נוכחות, הצהרות בריאות, תשלומים, WhatsApp ותפעול שוטף.

## הפעלה מקומית

1. התקן חבילות:

   ```powershell
   cd server
   npm install
   cd ..\client
   npm install
   ```

2. צור קובצי הגדרות לפי:
   - `server/.env.example`
   - `client/.env.example`

3. הפעל את שני השרתים דרך PM2 (פעם אחת בלבד):

   ```powershell
   npm install -g pm2
   npm run dev
   ```

4. פתח `http://localhost:3000`.

### למה PM2

`npm run dev` בחלון טרמינל מת ברגע שהחלון נסגר, וגם `nodemon` לא קם בחזרה אחרי
קריסה — הוא מחכה לשינוי קובץ. PM2 מריץ את `crm-api` ו-`crm-web` כתהליכי רקע
עצמאיים, מרים אותם מחדש אחרי קריסה, ומעלה אותם אוטומטית בכל כניסה למשתמש דרך
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\climbing-crm-pm2.cmd`.
ההגדרות נמצאות ב-`ecosystem.config.cjs`, הלוגים ב-`logs/`.

| פקודה | מה היא עושה |
| --- | --- |
| `npm run dev` | מפעיל את שניהם ושומר לעלייה אוטומטית |
| `npm run dev:status` | מציג מצב ומספר הפעלות מחדש |
| `npm run dev:logs` | לוגים חיים משני התהליכים |
| `npm run dev:restart` | הפעלה מחדש ידנית |
| `npm run dev:stop` | כיבוי (גם אחרי הדלקת מחשב, עד `npm run dev`) |

הקליינט נעול על פורט 3000 (`strictPort`) כדי שהוא לא יזחל ל-3001/3002 ויתנתק
מה-proxy אל `http://127.0.0.1:5001`. אם 3000 תפוס, Vite ייפול עם שגיאה ברורה
במקום לעבור פורט בשקט.

## בדיקות

```powershell
cd server
npm test

cd ..\client
npm run build
```

## אבטחה ו-Supabase

הוראות הכניסה, ההרשאות, שמירת המידע והפעלת הגנת הטבלאות נמצאות ב-`SUPABASE-SETUP.md`.

## WhatsApp

הוראות למעבר מ-Wassenger לחיבור ישיר ומאובטח מול Meta נמצאות ב-`META-WHATSAPP-SETUP.md`.

הוראות לחיבור יומן גוגל למסך היומן נמצאות ב-`GOOGLE-CALENDAR-SETUP.md`.
