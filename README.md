# My Wall CRM

מערכת ניהול לקיר הטיפוס My Wall. המערכת כוללת לידים, חוגים, נוכחות, הצהרות בריאות, תשלומים, WhatsApp ותפעול שוטף.

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

3. הפעל בשני חלונות:

   ```powershell
   cd server
   npm run dev
   ```

   ```powershell
   cd client
   npm run dev
   ```

4. פתח `http://localhost:3000`.

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
