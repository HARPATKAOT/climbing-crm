# חיבור יומן גוגל

המערכת יוצרת (או מוצאת) יומן בשם:

```
יומן
```

ומסנכרנת אליו דו־כיוונית את האירועים ממסך „יומן”.

זה יומן נפרד לגמרי מלוח החוגים — אין ביניהם חיבור.

---

## 1. יצירת פרויקט בגוגל קלאוד

1. היכנסו לקונסולת גוגל קלאוד וצרו פרויקט (או בחרו קיים).
2. הפעילו את ממשק יומן גוגל:
   - APIs & Services → Library
   - חפשו `Google Calendar API` והפעילו.

---

## 2. מסך אישור (OAuth)

1. APIs & Services → OAuth consent screen
2. בחרו External (או Internal אם זה Workspace שלכם)
3. מלאו שם אפליקציה ומייל תמיכה
4. הוסיפו scope:
   - `https://www.googleapis.com/auth/calendar`
5. הוסיפו את המייל שלכם כ־Test user אם האפליקציה במצב Testing

---

## 3. מפתחות לקוח

1. APIs & Services → Credentials → Create Credentials → OAuth client ID
2. Application type: Web application
3. Authorized redirect URIs — הוסיפו את שניהם:

מקומי:

```
http://localhost:5000/api/google-calendar/oauth/callback
```

שרת חי:

```
https://climbing-crm-api.onrender.com/api/google-calendar/oauth/callback
```

4. העתיקו את Client ID ו־Client Secret

---

## 4. משתני סביבה בשרת

ב־`server/.env` (מקומי) וב־Render (Environment):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://climbing-crm-api.onrender.com/api/google-calendar/oauth/callback
FRONTEND_URL=https://client-omega-topaz-35.vercel.app
PUBLIC_API_URL=https://climbing-crm-api.onrender.com
```

לפיתוח מקומי:

```
GOOGLE_REDIRECT_URI=http://localhost:5000/api/google-calendar/oauth/callback
FRONTEND_URL=http://localhost:3000
```

אחרי שמירה — הפעילו מחדש את השרת.

---

## 5. חיבור במערכת

1. היכנסו כמנהל
2. עברו למסך „יומן”
3. לחצו „חיבור לגוגל”
4. אשרו גישה בחשבון גוגל של הקיר
5. אחרי אישור תוחזרו למסך עם הודעת הצלחה

מה קורה בחיבור:
- נוצר יומן „יומן” (אם עדיין אין)
- נשמר מפתח רענון במסד (`app_settings`)
- נרשמת התראת שינויים מגוגל (webhook)
- רץ סנכרון ראשוני

---

## 6. איך הסנכרון עובד

| כיוון | מתי |
|---|---|
| מאיתנו לגוגל | אחרי יצירה / עריכה / מחיקה במערכת |
| מגוגל אלינו | התראת webhook + סנכרון כל 10 דקות + כפתור „סנכרון עכשיו” |

סוגי אירוע (צבעים ביומן):
- יום הולדת
- טיול
- בית ספר
- חברה
- אחר

---

## פתרון תקלות

**כפתור החיבור לא מופיע / „חסרים מפתחות”**  
בדקו ש־`GOOGLE_CLIENT_ID` ו־`GOOGLE_CLIENT_SECRET` מוגדרים בשרת.

**שגיאת redirect_uri_mismatch**  
כתובת ה־redirect בקונסולת גוגל חייבת להיות זהה ל־`GOOGLE_REDIRECT_URI`.

**אין מפתח רענון**  
התחברו שוב; המערכת מבקשת `prompt=consent` ו־`access_type=offline`.

**שינויים בגוגל לא מגיעים**  
לחצו „סנכרון עכשיו”. ודאו שהכתובת הציבורית של השרת נגישה לגוגל (לא localhost ל־webhook).
