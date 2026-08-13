# סנכרון שעות פתיחה עם Google Business Profile

היומן במערכת הוא מקור האמת. רשומות „שעות פתיחה” שפורסמו נשלחות ל־Google Search ול־Google Maps כשעות מיוחדות ל־14 הימים הקרובים. יום ללא רשומה מפורסמת נשלח כסגור, וחריגים ידניים בגוגל מחוץ לחלון הזה נשמרים.

## הכנת Google Cloud

משתמשים באותו פרויקט ובאותם `GOOGLE_CLIENT_ID` ו־`GOOGLE_CLIENT_SECRET` של יומן גוגל.

1. מבקשים ומקבלים גישה ל־Google Business Profile APIs.
2. מפעילים את **My Business Account Management API** ואת **My Business Business Information API**.
3. מוסיפים למסך ה־OAuth את ההרשאה `https://www.googleapis.com/auth/business.manage`.
4. מוסיפים ל־OAuth Client את כתובת ההפניה לייצור:
   `https://climbing-crm-api.onrender.com/api/google-business-profile/oauth/callback`

אם כתובת ה־API משתנה, מגדירים בשרת `GOOGLE_BUSINESS_PROFILE_REDIRECT_URI` ומוסיפים בגוגל את אותה כתובת במדויק.

## חיבור ובדיקה

1. נכנסים אל `הגדרות עסק` ← `חיבורים` ← `פרופיל העסק בגוגל`.
2. לוחצים „חיבור לפרופיל העסק” ומאשרים בחשבון שמנהל את העסק.
3. אם החשבון מנהל כמה סניפים, בוחרים את הסניף המתאים.
4. הסנכרון הראשון מתבצע מיד. לאחר מכן כל שינוי בשעות ביומן מתעדכן אוטומטית, ובייצור מתבצעת גם בדיקת רענון כל שש שעות.

החיבור מנהל רק את השעות המיוחדות בחלון הקרוב; הוא אינו משנה את שעות הפתיחה הרגילות בגוגל.
