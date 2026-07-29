# העברת DNS — kirboaz.co.il מוויקס לאינטרניק

> **בוצע — 28 ביולי 2026.** האזור הוזן ונשמר באינטרניק, ושרתי ה-DNS הוחלפו
> ל-`ns1/ns2.sitesdepot.com`. כל 12 הרשומות אומתו מול `ns1.sitesdepot.com` ישירות
> ונמצאו נכונות. ההאצלה בהתפשטות. מה שנותר: לאמת שוב אחרי ההתפשטות (ראה
> "אימות אחרי ההעברה" בתחתית), ולוודא ש-Vercel הנפיק תעודת SSL ל-`app`.
>
> **חריגה מהתכנון:** רשומת ה-A השנייה של ויקס (`185.230.63.107`) לא הוזנה —
> עורך ה-Zone של אינטרניק לא אפשר להוסיף ערך שני לרשומה. היא גיבוי בלבד
> ואינה נדרשת. `mail`, `webmail` ו-`ftp` (שרת ישן) נמחקו ולא שוחזרו, כמתוכנן.

צילום מצב מלא של אזור ה-DNS, **כפי שנקרא ישירות משרתי ויקס (`ns8.wixdns.net`) ב-28 ביולי 2026**.
זהו המסמך הקובע. לפני החלפת שרתי ה-DNS באינטרניק, כל רשומה כאן חייבת להיות משוחזרת שם —
אחרת האתר, האימייל, או אימות הדומיין ייפלו.

הדומיין רשום באינטרניק (Internic) ובתוקף עד **03/08/2027**. רק מנוי הפרימיום של ויקס פג
(בסביבות 4 באוגוסט 2026), ולכן ה-DNS חייב לעבור לפני כן.

## מצב לפני

| | |
|---|---|
| רשם | Internic |
| שרתי DNS | `ns8.wixdns.net`, `ns9.wixdns.net` |
| SOA serial | 2020081516 |
| TTL ברירת מחדל | 3600 (שעה) |

## שתי סתירות שהתגלו — חובה לקרוא לפני ההזנה

**1. ה-Zone שקיים באינטרניק הוא עתיק** — צילום מצב מלפני המעבר לוויקס. הוא מפנה את
הדואר ל-Microsoft 365 ואת האתר לשרת ישן (`80.244.162.32`). אין להסתמך עליו.
**המקור הקובע הוא ה-Zone החי בוויקס** שמתועד למעלה.

**2. הדואר על Google Workspace, אבל ה-SPF הצהיר על Microsoft** עם חסימה קשה (`-all`).
כלומר דואר יוצא מג'ימייל נכשל באימות SPF אצל הנמענים. הבעלים אישר (28.7.2026) שהוא
קורא דואר **בג'ימייל** ורוצה **לבטל את Microsoft**. לכן ה-SPF מתוקן לגוגל, ושאריות
מיקרוסופט נמחקות.

## ה-Zone הסופי להזנה באינטרניק

TTL אחיד: `86400`. שרתי היעד: `ns1.sitesdepot.com` / `ns2.sitesdepot.com`.

### האתר — לשמור על אתר ויקס חי עד שיוחלף באתר החדש

| סוג | שם | ערך |
|---|---|---|
| A | `kirboaz.co.il.` | `185.230.63.171` |
| A | `kirboaz.co.il.` | `185.230.63.107` |
| CNAME | `www.kirboaz.co.il.` | `cdn1.wixdns.net.` |

### המערכת (CRM על Vercel) — חדש

| סוג | שם | ערך |
|---|---|---|
| A | `app.kirboaz.co.il.` | `76.76.21.21` |

### דואר — Google Workspace

| סוג | שם | עדיפות | ערך |
|---|---|---|---|
| MX | `kirboaz.co.il.` | 10 | `aspmx.l.google.com.` |
| MX | `kirboaz.co.il.` | 20 | `alt1.aspmx.l.google.com.` |
| MX | `kirboaz.co.il.` | 30 | `alt2.aspmx.l.google.com.` |
| MX | `kirboaz.co.il.` | 40 | `alt3.aspmx.l.google.com.` |
| MX | `kirboaz.co.il.` | 50 | `alt4.aspmx.l.google.com.` |

### TXT

| שם | ערך | הערה |
|---|---|---|
| `kirboaz.co.il.` | `v=spf1 include:_spf.google.com ~all` | **מתוקן** — היה מיקרוסופט |
| `kirboaz.co.il.` | `google-site-verification=wazogEOt1w5CSF_O5Lx7VuK4RtEFUvbn0-anfFXTwr8` | לשמר |
| `kirboaz.co.il.` | `google-site-verification=0WRV2MhcRG7Tw54O1ZX8Zexuf0DkNEpgHef27u_xkLU` | לשמר |
| `kirboaz.co.il.` | `MS=ms17053360` | **לשמר** — ראה למטה |

רשומת ה-`MS=` נשארת בכוונה. היא אימות הבעלות של הדומיין במיקרוסופט, והמנוי שם עדיין
פעיל בגלל **OneDrive** שטרם רוקן (אישור הבעלים, 28.7.2026). מחיקתה בעודו תלוי בחשבון
הזה מסתכנת בשבירת הגישה, והעלות של להשאיר אותה היא אפס. למחוק רק אחרי שה-OneDrive
רוקן והמנוי בוטל.

`~all` (softfail) ולא `-all`, כדי שטעות בהגדרה לא תפיל דואר לגיטימי. אפשר להקשיח
ל-`-all` אחרי שבועיים של דואר תקין.

### למחוק — שאריות מיקרוסופט ושרת ישן

| סוג | שם | ערך | למה |
|---|---|---|---|
| MX | `kirboaz.co.il.` | `kirboaz-co-il.mail.protection.outlook.com.` | מיקרוסופט מבוטל |
| CNAME | `autodiscover` | `autodiscover.outlook.com.` | מיקרוסופט מבוטל |
| TXT | `kirboaz.co.il.` | `MS=ms17053360` | אימות דומיין של מיקרוסופט |
| TXT | `kirboaz.co.il.` | `v=spf1 include:spf.protection.outlook.com -all` | מוחלף בגוגל |
| A | `kirboaz.co.il.` | `80.244.162.32` | שרת ישן — מוחלף ב-IP של ויקס |
| A | `mail` | `80.244.162.32` | שרת ישן |
| A | `webmail` | `80.244.162.32` | שרת ישן |
| CNAME | `ftp` | `kirboaz.co.il.` | שרת ישן |

⚠️ **מחיקת רשומות DNS אינה מבטלת את המנוי במיקרוסופט.** את החיוב עצמו יש לבטל
בחשבון Microsoft בנפרד — ולפני כן לבדוק אם יש שם דואר או קבצים שצריך לייצא.

## לא קיים (נבדק)

DKIM (`google._domainkey`, `selector1/2._domainkey`), `_dmarc`, `sip`, `lyncdiscover`,
`enterpriseregistration`.

שני דברים ששווה להוסיף **אחרי** שההעברה יציבה, לא במקביל אליה:
- **DKIM לגוגל** — נוצר בקונסולת הניהול של Google Workspace ומוסיפים כרשומת TXT.
- **DMARC** — התחלה שמרנית: `v=DMARC1; p=none; rua=mailto:<כתובת>`.
- אם בעתיד המערכת תשלח מיילים (Resend) — יידרשו רשומות SPF/DKIM נוספות שלו.
  כרגע Resend אינו מוגדר, ולכן אין צורך.

## מה לא קיים (נבדק, אין צורך לשחזר)

DKIM (`google._domainkey`, `selector1/2._domainkey`, `wix._domainkey`), `mail`, `ftp`,
`_dmarc`, `enterpriseregistration`, `sip`, `lyncdiscover`.

שים לב: **אין רשומת DMARC**. לא נדרש להעברה, אבל שווה להוסיף בהמשך.

## סדר הפעולות

1. להזין את כל הרשומות שלמעלה ב"עריכת Zone" באינטרניק — **לפני** החלפת שרתי ה-DNS.
   אינטרניק מאפשר לשמור את ה-Zone מראש; הוא פשוט לא נכנס לתוקף עד שלב 2.
2. רק אז "שינוי DNS" → `ns1.sitesdepot.com` / `ns2.sitesdepot.com`.
3. להמתין להתפשטות (עד 48 שעות) ולאמת: אתר, דואר נכנס ויוצא, `app.kirboaz.co.il`.
4. אחרי שהכל ירוק — לעדכן משתני סביבה בשרת ולפרסם.

## אימות אחרי ההעברה

```bash
nslookup -type=NS kirboaz.co.il
nslookup -type=MX kirboaz.co.il
nslookup -type=TXT kirboaz.co.il
nslookup -type=A app.kirboaz.co.il
nslookup -type=CNAME www.kirboaz.co.il
```
