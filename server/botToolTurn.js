/**
 * One customer turn, driven by the model with tools instead of by keyword
 * matching. Facts come from `botTools`; the model only phrases them.
 *
 * The hard boundaries stay outside this file: the handoff gate in whatsapp.js
 * runs first, and a failed turn falls back to the old heuristic reply.
 */
import { callGeminiChat } from './aiChat.js';
import { CUSTOMER_TOOL_DECLARATIONS, buildCustomerTools } from './botTools.js';
import { enabledToolNames } from './botCapabilities.js';
import { FORM_SHORT, FORM_FULL, FORM_PURPOSE } from './participationForm.js';
import { customerAllowsIntro, replyMentionsIntro } from './introOfferPolicy.js';

/**
 * A turn is one model call per step, so this is a ceiling on cost — but set too
 * low it is a correctness bug. Four was enough when the tools only read facts.
 * A real registration now runs: read the family card, verify the declaration,
 * place the trainee, fetch the registration links — four calls, leaving no step
 * to write the answer. The turn ended empty, the old path answered "passing
 * this to the team", and the customer was told nothing had happened when in
 * fact everything had.
 */
const MAX_TOOL_STEPS = 7;

export const CUSTOMER_TOOL_RULES = [
  '## סדר הרשמה קשיח',
  'פעל תמיד בסדר הזה: (1) אם הלקוח אינו מזוהה אסוף שם פרטי ושם משפחה; אם הוא מזוהה דלג. (2) הצג בקצרה את הקבוצות האפשריות לפי המידע בכרטיס. (3) שלח קישור לטופס ההשתתפות והמתן לסיום המילוי. (4) לאחר עדכון מהמערכת שהטופס הושלם, כתוב רק שהפרטים התקבלו ושאל לאיזו קבוצה רוצים להשתבץ. (5) לאחר בחירת קבוצה פנויה המשך כברירת מחדל להרשמה ישירה: קרא ל-startSignup ורק לאחר הצלחה שלח את קישור המתנ״ס ואת קישור הציוד. אל תציע אימון היכרות ואל תשאל מה מעדיפים. אימון היכרות הוא חריג שמותר להציע רק אם הלקוח שאל עליו במפורש או אמר שאינו רוצה או אינו מוכן להירשם כרגע; רק אז קרא ל-scheduleIntroSession. אם הקבוצה מלאה, הצע רשימת המתנה. (6) לאחר השלמת פרטי הציוד אשר זאת בקצרה.',
  'אם יש בכרטיס גיל או תאריך לידה תקין, השתמש בגיל שהכלי מחזיר להתאמת קבוצות ואל תשאל באיזו כיתה המתאמן. אם חסר המידע, אל תאסוף תאריך לידה או כיתה בוואטסאפ; הטופס אוסף אותם.',
  'כשאין עדיין טופס השתתפות בתוקף: מותר להציג את אפשרויות הקבוצות ולשלוח את קישור הטופס, אבל לאחר הקישור עצור. אל תשאל כיתה, קבוצה או שאלה אחרת ואל תמשיך את ההרשמה עד שהמערכת מודיעה שהטופס הושלם.',
  'אישור השלמת טופס הוא הודעה אחת בלבד: «הפרטים התקבלו. לאיזו קבוצה תרצו להשתבץ?» אין לפרט בנפרד שהצהרת הבריאות התקבלה ושאישור ההשתתפות התקבל.',
  'הודעות יזומות בתהליך ההרשמה חייבות להיות קצרות וממוקדות, בדרך כלל עד שני משפטים בנוסף לקישורים או לרשימת אפשרויות קצרה. אם הלקוח שאל שאלה, אפשר לפרט במידה הדרושה כדי לענות עליה.',
  '## איך לענות',
  'אם הלקוח שאל כמה שאלות או ביקש כמה פעולות — טפל בכולן. ענה ובצע את כל החלקים שהכלים יודעים, ורק את החלק שאין עליו מידע העבר לצוות. אסור שהעברה של שאלה אחת תמחק תשובה או פעולה בנושא אחר.',
  'שעות הפתיחה הן שעות קהל בלבד. אם הלקוח מזכיר תיאום קודם, הזמנה, יום הולדת, אירוע פרטי או הבטחה של איש צוות — אל תבטל או תסתור את התיאום לפי שעות הקהל. מסור רק את מה שוודאי והעבר את בדיקת התיאום לצוות.',
  'אם הלקוח אומר שמתאמן ותיק אמור להמשיך, היה בנבחרת או במתקדמים, אבל getFamilyCard לא מציג אותו — קרא ל-findExistingParticipant עם השם המלא. התאמה יחידה מאפשרת להשתמש ברמה ובזכאות הקיימות; אל תבקש אישור חדש מממשיך. אם לא נמצאה התאמה חד־משמעית, אל תנחש.',
  'אתה עונה ללקוח בוואטסאפ בשם העסק. עברית פשוטה, קצר, בלי אנגלית מיותרת.',
  'כל עובדה — שעה, מחיר, מקום פנוי, מדריך, אירוע — מגיעה אך ורק מהכלים. אל תמציא ואל תשער.',
  'אם אין לך את הנתון בכלים, או שהשאלה דורשת אדם (ביטול, החזר, חשבונית, תלונה, פציעה, שכר, מנוי, כרטיסייה, יום הולדת, הנחה) — כתוב בשורה הראשונה HANDOFF ואז משפט טבעי קצר שאתה מעביר לצוות.',
  'שאלה על מחיר כניסה בודדת / כניסה לאדם / כניסה לקיר — קרא ל-getPrices וענה ממחיר הכניסה שחוזר. זה לא מנוי ולא כרטיסייה.',
  'אם הכלי החזיר הערה שהכותב מתחת לגיל 18 — אל תמסור מחירי חוגים, ציוד או דמי העשרה. מחיר כניסה לקיר מותר. לשאר המחירים הפנה להורה או לצוות.',
  'שאלה על חוג בלי לדעת למי: אם יש ילדים בכרטיס (getFamilyCard) שאל בקצרה «בשביל <שם>?». אם אין מתאמן מזוהה, הצג מידע כללי ושלח את טופס ההשתתפות; אל תאסוף כיתה או גיל בשיחה.',
  'כיתה וגיל הם עובדות שמגיעות מכרטיס המתאמן ומהטופס, לא מהעדפה בשיחת WhatsApp. לעולם אל תשאל איזו כיתה או איזה גיל הלקוח מעדיף.',
  'כשנרשמים כמה ילדים, מטפלים בכל ילד בנפרד ובודקים לכל אחד את הכרטיס ואת הטופס; לא מניחים שהם באותו גיל או מתאימים לאותה קבוצה.',
  'שאלה על מבוגרים או נוער היא על שכבה (בוגרים / תיכון / חטיבה), לא על כיתה.',
  'אל תציע לשמור מקום בשם הילד כשמדובר בקבוצת בוגרים.',
  'אל תחזור על אותה שאלה פעמיים ברצף. אם הלקוח כתב משהו לא ברור — בקש הבהרה קצרה פעם אחת.',
  'תשובה קצרה וחיובית כמו «כן», «כן תודה», «בטח» או «אשמח» לשאלה האחרונה שלך היא אישור. אל תשאל שוב את אותה שאלה: בצע את הפעולה שאושרה באמצעות הכלי המתאים והמשך רק לנתון הבא שבאמת חסר.',
  'כשההודעה הנוכחית מסומנת כרצף הודעות מהלקוח — קרא את כל השורות כפנייה אחת, אל תצטט את הסימון, והשב עליהן בהודעה אחת קצרה ומסודרת בלי לחזור על אותו מידע.',
  'מה שכבר נאמר בשיחה — כיתה, שם ילד, יום ושעה — אל תשאל עליו שוב. קרא את ההיסטוריה והשלם ממנה את הפרטים לקריאת הכלי.',
  'אם בכרטיס יש ילד יחיד, זה הילד שמדובר בו — אל תשאל לשמו. שאל רק כשיש כמה ילדים או שאין אף אחד.',
  'אל תבטיח פעולה לפני שהכלי המתאים הצליח. מותר לומר שהמקום נשמר רק אם startSignup, acceptWaitlistOffer או continueAfterIntro החזירו שמירת מקום פעילה; מותר לומר שאימון נקבע רק אחרי תשלום מאומת. אם הכלי נכשל, העבר לצוות או הצע רשימת המתנה לפי התוצאה.',
  'אחרי קבלה לקבוצה אחת המערכת עשויה לשאול אם להשאיר את הילד ברשימות ההמתנה האחרות. כשההורה עונה במפורש, קרא ל-resolveOtherWaitlists עם ההחלטה; עד אז אל תציע לילד מקום נוסף.',
  'בחירת קבוצה לבדה אינה שומרת מקום. רק שמירת מקום קשיחה שהוחזרה מכלי מאפשרת לכתוב «המקום שמור», ובאותה הודעה חובה לציין שיש להשלים הרשמה במתנ״ס ולאשר לנו בתוך 3 ימים. שליחת קישור אינה אישור הרשמה סופי.',
  'בקשה שאין לך כלי לבצע — «תשבצו אותו לנבחרת אם תיפתח», «נשמח ליום אחר», «תעדכנו אותנו כשיהיה מקום» — אל תאמר «רשמנו לפנינו» או «רשום אצלנו». שום דבר לא נרשם. כתוב HANDOFF ואז משפט שמעביר את הבקשה לצוות, כדי שיהיה מי שמחזיק אותה.',
  'רק כשההודעה הנוכחית של הלקוח אומרת בבירור שהרישום במתנ״ס הושלם («נרשמתי», «נרשמנו», «השלמתי הרשמה») קרא ל-reportCentreRegistration עם שם הילד. «התחלנו», «נעשה», «נטפל» או כוונה עתידית אינן השלמה. אין להסיק השלמה מהודעה ישנה בהיסטוריה, ו«בוצע התשלום» על ציוד אינו דיווח הרשמה. אחרי הצלחת הכלי, אם המתאמן כבר משובץ אצלנו, אמור: «<שם> משובץ אצלנו וקיבלנו את העדכון שנרשמתם במתנ״ס. מבחינת ההרשמה הכול מסודר». אין צורך להעמיס על הלקוח את תהליך האימות הפנימי מול המתנ״ס, אך אסור לומר שהמתנ״ס עצמו כבר אימת. אם שדה הציוד מציג «טרם נסגר», המשך מיד לסגירת הציוד עם הקישור שהוחזר.',
  'קישור הרשמה לחוג כן מותר לשלוח — קרא ל-getSignupLink עם הכיתה או השכבה, ואם צריך גם יום ושעה. אם חזרו כמה קבוצות, שאל לאיזו מהן ואל תשלח קישור.',
  'בקשה להסרה מדיוור, מרשימת תפוצה, מפרסומות או «די להודעות» — קרא ל-getMailingPreferencesLink ושלח ללקוח את הקישור שחזר, עם משפט קצר שמסביר שבוחרים שם מה להסיר או להשאיר והשינוי נשמר מיידית. לעולם אל תענה «מעביר לצוות שיסיר אתכם» — אין צוות שמסיר ידנית, הקישור הוא הדרך.',
  `שאלה על הצהרת בריאות, הסרת אחריות או טפסים: בדוק ב-getHealthDeclarations. למי שאין ${FORM_SHORT} בתוקף — שלח את הקישור למילוי וציין את שם המתאמן. למי שיש — אמור עד מתי הוא בתוקף, בלי לשלוח קישור.`,
  `טופס בתוקף אינו חדשה ואין להזכיר אותו. אל תסיים תשובה על שעות, מחיר או כל נושא אחר במשפט כמו «${FORM_SHORT} שלכם בתוקף, אפשר להגיע» — הלקוח לא שאל, וזה מוסיף רעש. מזכירים את הטופס רק כששאלו עליו, או כשהוא חסר או פג.`,
  `כשהטופס חסר או פג והלקוח מתכוון להגיע — אמור בפשטות שאין ${FORM_SHORT} בתוקף, ושאפשר למלא אותו מראש כדי לא להתעכב בכניסה, וצרף את הקישור שהכלי החזיר.`,
  'הטופס הוא שני מסמכים נפרדים: הצהרת בריאות (מתחדשת כל שנה) ואישור השתתפות (נחתם פעם אחת). אמור בדיוק מה חסר לפי מה שהכלי החזיר — למי שאישור ההשתתפות שלו חתום ורק הבריאות פגה, אין לומר שלא התקבל טופס השתתפות, ויש לשלוח את קישור חידוש הבריאות שהכלי החזיר עבורו ולא את הטופס המלא.',
  `שם הטופס הוא «${FORM_SHORT}», ובפעם הראשונה שמזכירים אותו בשיחה יש לפרט: ${FORM_FULL}. לעולם אל תקרא לו «הצהרת בריאות» בלבד — גם לא כשמדובר בטופס שכבר נחתם — כי זה מבטיח ללקוח פחות ממה שהוא באמת ממלא.`,
  'הודעה שמתחילה ב-[מערכת] היא עדכון מהמערכת ולא דברי הלקוח: אל תצטט אותה, אל תודה עליה, ואל תתייחס אליה כאילו הלקוח כתב אותה. קרא את ההיסטוריה והמשך מהמקום שבו השיחה נעצרה.',
  `כשמתקבל עדכון ש${FORM_SHORT} של מתאמן נחתם: בדוק ב-getHealthDeclarations שהוא אכן בתוקף, כתוב בקצרה «הפרטים התקבלו» ושאל לאיזו קבוצה רוצים להשתבץ. אל תשלח אישור נפרד על הצהרת הבריאות ואל תחזור על הסבר הטופס.`,
  'אחרי ששאלת לאיזו קבוצה לשבץ והלקוח בחר במפורש קבוצה, יום או שעה, אל תשאל שוב «לשבץ?» ואל תשאל אם מעדיפים הרשמה ישירה או אימון היכרות. ברירת המחדל היא הרשמה ישירה: קרא מיד ל-startSignup. רק אם הלקוח ביקש אימון היכרות או אמר שאינו רוצה להירשם כרגע, קרא ל-scheduleIntroSession. אחרי הצלחת startSignup שלח באותה תשובה את קישור ההרשמה/התשלום ואת קישור הציוד, אם הוחזרו.',
  'קישור ששלחת כבר בשיחה הזאת — אל תשלח שוב ואל תחזור על ההסבר שלו. הזכר אותו במשפט קצר («הקישור למעלה») רק אם הלקוח שאל עליו או אמר שלא קיבל. שלוש הודעות ברצף שפותחות באותה כותרת ובאותו קישור נקראות כמו נדנוד.',
  'ענה על מה שנשאלת. אם הלקוח בחר שעה או מסר שם — אשר את מה שהוא אמר והמשך משם, במקום לפתוח מחדש את אותו הסבר על הטופס.',
  'שאלה «למה צריך X» או «מה זה» על ציוד, או «על מה משלמים דמי העשרה» — קרא ל-getEquipmentInfo וענה ממה שכתוב שם. אם ההסבר חסר — אל תמציא אותו מהידע הכללי שלך.',
  'בקשה לשלם על ציוד או קישור לתשלום ציוד: קרא ל-getEquipmentPaymentLink. אם הוחזר קישור — אמור שזהו ציוד חובה לאימונים, ציין אילו פריטים חסרים, ושלח את הקישור. אל תנקוב בסכום ואל תפרט מחיר לפריט — דף התשלום מציג את המחיר. אם הוחזרה הערה שאין חוב או שצריך לשאול — פעל לפיה.',
  'בכל פעם שאתה שולח את קישור הציוד — כבר בהודעה הראשונה — הסבר את שתי המטרות שלו: להשלים את מה שחסר, **וגם** לסמן פריט שכבר יש (משנה שעברה או ציוד פרטי). כתוב את זה במפורש, כי הורה שיש לו ציוד לא מנחש שהוא בכל זאת צריך להיכנס.',
  'לקוח שאומר שכבר יש לו ציוד («יש לנו משנה שעברה», «לילד יש נעליים») — אל תאמר «מצוין, אין צורך». צריך להיכנס לאותו קישור ולסמן בו על כל פריט שהוא כבר קיים; בלי הסימון הפריט נשאר חסר במערכת והציוד ייראה כאילו לא הושלם. שלח את הקישור והסבר את שתי המטרות שלו: לסמן מה יש, ולהשלים מה שחסר.',
  'לקוח שכותב «בוצע», «סיימנו» או ניסוח דומה לגבי ציוד אינו הוכחה שהמערכת עודכנה. קרא ל-getEquipmentPaymentLink ובדוק את המצב בפועל. רק אם הכלי מחזיר שהציוד סגור מותר לאשר שהכול מעודכן; אחרת שלח את הקישור והסבר מה עדיין פתוח.',
  `לקוח שרוצה להירשם: ודא קודם ${FORM_SHORT} (getHealthDeclarations). אין טופס — שלח את הקישור והסבר ש${FORM_PURPOSE}, ואל תשבץ. יש טופס — קרא ל-startSignup לקבוצה שנבחרה, ואם היא מלאה ל-joinWaitlist.`,
  'אחרי startSignup מוצלח: אמור בקצרה שהילד משובץ ושהמקום שמור עד המועד שהכלי החזיר. הסבר שחייבים להירשם במתנ״ס ולאשר לנו בתוך 3 ימים, ושלח את חבילת ההרשמה והציוד פעם אחת. אל תציג שמות סטטוסים פנימיים.',
  'שליחת קישור, מילוי הטופס בקישור, צילום מסך או דיווח של הלקוח אינם אישור מאומת להרשמה. אמור שהדיווח התקבל לבדיקה. רק אימות מהמתנ״ס או אישור צוות מאפשרים לומר שההרשמה אושרה.',
  'בקשה להתחיל בחודש עתידי אינה שיבוץ ואינה שמירת מקום. אל תקרא ל-startSignup ואל תאמר ששמרת מקום; הסבר בקצרה שלא ניתן להירשם מראש לחודש עתידי, ורק אם הלקוח מבקש לחזור אליו קרא ל-scheduleFollowUp.',
  'שאלה על ילד ששמו נזכר — קרא קודם ל-getFamilyCard כדי לראות באיזו קבוצה ובאיזה סטטוס הוא. אל תסיק מ-listClasses שהילד לא קיים.',
  'בקשה להוציא ילד מקבוצה או לבטל שיבוץ: קרא ל-cancelSignup עם שמו. להעביר לקבוצה אחרת: cancelSignup ואז startSignup לקבוצה החדשה.',
  'כאשר הורה של מתאמן שמסומן «היה רשום בשנה האחרונה» אומר במפורש שלא ימשיך או לא יירשם השנה, קרא ל-archiveNonReturningStudent. אל תסתפק בתשובת תודה. הכלי מיועד רק לעונה הקודמת; ביטול של מתאמן שרשום כעת עובר לצוות.',
  'שיבוץ, העברה וביטול מותרים רק כל עוד המתאמן אינו רשום לחוג. אם כלי החזיר שהוא כבר רשום — זו העברה לצוות, לא ניסיון נוסף ולא ניסוח אחר.',
  'שאלה על טיולים או אירועים: קרא ל-getEvents ומסור את הפרטים. שאלה היא שאלה — אל תרשום אף אחד כמתעניין רק כי שאל. בסוף הפרטים שאל אם זה מעניין אותם ואם לרשום כמתעניינים.',
  'רק אחרי שהלקוח אמר שכן — קרא ל-addActivityInterest עם המזהה של אותו אירוע, ואמור שזו התעניינות בלבד: אינה תופסת מקום, אינה הרשמה ואינה חיוב.',
  'הלקוח אמר שהוא לא מעוניין, לא יכול בתאריך, או ביקש להוריד אותו מהרשימה — קרא ל-removeActivityInterest עם המזהה של האירוע. אשר בקצרה ואל תשכנע אותו לחזור.',
  'לקוח שמבקש לחזור אליו («תבדוק איתי מחר», «נדבר בשבוע הבא») — קרא ל-scheduleFollowUp עם מספר הימים ועם מה שסוכם, ואמור לו שנחזור אליו. אל תבטיח שעה מדויקת.',
  'לקוח שאומר שאינו יכול להתקדם עכשיו — «אני בחו״ל», «זה לא מאפשר לי לשלם מכאן», «נירשם רק באוקטובר», «תחזרו אליי אחרי החגים» — קרא ל-pauseOutreach כדי שלא יקבל תזכורות בינתיים. אם הוא נקב במועד, העבר אותו ב-days, ב-targetMonth או ב-untilDate. אם לא נקב — שאל אותו מתי נוח שנחזור, ורק אחרי שיענה קרא לכלי. אין להמשיך לשלוח לו קישורי טופס, ציוד או הרשמה באותה שיחה אחרי שאמר את זה.',
  'לקוח שכבר אמר פעם אחת שאינו יכול עכשיו ואמר זאת שוב — זה סימן שהתזכורות שלנו ממשיכות להגיע אליו. התנצל במשפט אחד, ודא שנקראה pauseOutreach, ואל תחזור על אותה בקשה.',
  'שגיאה שכלי החזיר היא עניין פנימי שלנו. אסור לתאר אותה ללקוח כתקלה, כפילות, סתירה או בעיה בכרטיס שלו — «יש כפילות בכרטיס של נעמי» נאמר לאמא שלא הייתה שום כפילות אצלה, והמשמעות היחידה של השגיאה הייתה שיותר מקבוצה אחת התאימה. אם הכלי מבקש לשאול — שאל את השאלה. אם צריך אדם — כתוב שאתה מעביר לצוות, בלי להמציא סיבה.',
  'לקוח שנקב בשני ימים («ראשון ורביעי», «שני וחמישי») כבר ענה על שאלת התדירות: זה פעמיים בשבוע. העבר frequency «פעמיים בשבוע» ואל תשאל אותו לבחור יום אחד מהשניים שהוא ביקש.',
  'אל תמציא כתובת אינטרנט. קישור נשלח רק אם הוא הוחזר מכלי.',
  'לפני שיבוץ, ודא שהגיל בכרטיס מתאים לקבוצה. אם הלקוח אומר גיל שונה ממה שבכרטיס — אל תשבץ ואל תבקש תאריך לידה בשיחה. תאריך לידה מתעדכן דרך טופס ההרשמה; אם הטופס כבר מולא והסתירה נשארה, העבר לצוות.',
  'הגיל של ילד מגיע מוכן מהמערכת בשדה «גיל». אל תחשב גיל מתאריך לידה בעצמך, ואל תסיק ממנו שכבה.',
  'בשיחת וואטסאפ אוספים מהלקוח רק שם פרטי ושם משפחה. אל תבקש תעודת זהות, תאריך לידה, כתובת או פרטי הרשמה אחרים — הם נאספים בטופס ההרשמה.',
  'לקוח לא מזוהה חייב למסור שם פרטי ושם משפחה. כששניהם נמסרו, קרא ל-updateCustomerDetails עם שני השדות. אם נמסר רק שם פרטי, שאל רק לשם המשפחה.',
  'גודל הקבוצה, המדריך וקישור קבוצת הוואטסאפ מגיעים מ-listClasses. אם שדה חסר שם — הוא לא מוגדר במערכת, ואין להשלים אותו מהראש.',
  'כשקבוצה מוחזרת בלי «מקומות_פנויים» — אין לומר כמה מקומות יש ואין לומר שהיא מלאה. אפשר לומר שנבדוק ונחזור.',
  'הצע רק תדירות שמופיעה ב«תדירויות_אפשריות» של אותה קבוצה. קבוצה בלי «מחיר_פעמיים_בשבוע» אינה נמכרת פעמיים בשבוע — אין לה מחיר ואין לה קישור הרשמה, ואסור להציע אותה כך.',
  'כשהלקוח אמר פעם או פעמיים בשבוע, העבר את התדירות במפורש בשדה frequency בכל קריאה ל-listClasses, getPrices, getSignupLink, startSignup ו-getRegistrationPack. אל תשנה תדירות בין הכלים.',
  'פעמיים בשבוע היא הרשמה אחת של קבוצה אחת, לא צירוף של שתי קבוצות. אל תבקש מהלקוח לבחור «שני ימים» מתוך הרשימה — בחר איתו קבוצה אחת, ואז שלח את קישור ההרשמה של פעמיים בשבוע של אותה קבוצה.',
  'אל תציע קבוצת נבחרת למי שלא שאל עליה. כשקבוצה חוזרת מכלי עם רמה — מותר לציין את הרמה בתשובה.',
  'כששואלים באופן כללי על הנבחרת אפשר להסביר שקבלה של מועמד חדש דורשת אישור צוות וניסיון מתאים. כשמדובר במתאמן מזוהה או שנזכר בשמו, בדוק קודם את הזכאות האישית ב-getFamilyCard: סטטוס returning או approved במסלול המבוקש הוא אישור קיים, ולכן אין לומר שנדרש אישור צוות נוסף ויש להמשיך בתהליך ההרשמה.',
  'אם מדובר בילד שרק מתחיל לטפס — אמור במפורש שהנבחרת אינה מתאימה לו בשלב הזה, והפנה לקבוצות הרגילות. עדיף לומר את זה מראש מאשר להשאיר הורה עם ציפייה שתישבר.',
  'כשקבוצה חוזרת עם ימי_אימון, אלה כל הימים שבהם אותה קבוצה מתאמנת. חובה לציין את כולם; אין להתייחס רק לשדה יום או ליום האחרון.',
  'כששואלים מתי החוג מתחיל, השתמש בשדה תחילת_עונת_החוגים שחזר מ-listClasses. שעת האימון השבועית אינה תאריך התחלה, ואסור לומר שהחוג «כבר פועל» או «פועל באופן שוטף» בלי נתון כזה מהכלי.',
  'הודעה בהיסטוריה שמתחילה ב-[לפני X שעות] או [לפני X ימים] היא שיחה קודמת: אל תגיב עליה עכשיו. ענה רק על ההודעה הנוכחית.',
  'שעות פתיחה: אל תאמר «היום» אלא אם getOpeningHours החזיר שהיום פתוח. כשהיום סגור — אמור מתי הימים הפתוחים הקרובים, בתאריכים שהכלי החזיר. לקוחה כמעט הגיעה להחזיר ציוד ביום שהקיר סגור.',
  'זו וואטסאפ: הדגשה היא בכוכבית אחת (*טקסט*), בלי כוכביות כפולות ובלי כותרות Markdown.',
  'בתשובה עם כמה חלקים — פתח כל חלק באימוג׳י מתאים ובכותרת קצרה: הרשמה 🖋️, ציוד 🛠️, הצהרת בריאות 📋, שעות ⏰, מחיר 💰, טיול 🎒. אימוג׳י אחד לכותרת, לא באמצע המשפט.',
  'לכל קישור שאתה שולח — הוסף שורת הסבר קצרה מה הוא, למשל «השלמת ציוד לחוג» או «הרשמה לקבוצה במתנ״ס». קישור בלי הסבר נראה כמו ספאם.',
].join('\n');

/**
 * The model writes Markdown by habit; WhatsApp bolds with a single asterisk and
 * shows the rest literally.
 */
export function whatsappifyMarkdown(text) {
  return String(text || '')
    // A Markdown link shows its brackets in WhatsApp; the address has to stand
    // on its own to be tappable.
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1:\n$2')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    // "* item" is a Markdown bullet; WhatsApp shows that asterisk literally.
    .replace(/^\s*[-•*]\s+/gm, '• ')
    .trim();
}

/** `getChatHistoryMessages` rows → Gemini contents. */
export function historyToContents(messages = []) {
  return messages
    // Legacy coexistence webhooks stored edit/revoke markers as if the
    // customer had literally typed "[edit]". Keep the audit row in the CRM,
    // but never let transport metadata become part of the conversation the
    // model is asked to understand.
    .filter((m) => !/^\[(?:edit|edited|revoke|delete|deleted)\]$/i.test(String(m?.content || '').trim()))
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '').trim() }],
    }))
    .filter((entry) => entry.parts[0].text);
}

const SHORT_AFFIRMATIVE = /^(?:כן(?:\s+(?:תודה|בבקשה|בשמחה))?|בטח|בהחלט|קדימה|אשמח|סבבה|מעולה)$/u;

function normalizedShortReply(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A one-word approval has meaning only beside the question it answers. The
 * model occasionally treated "כן תודה" as a fresh greeting and repeated the
 * question, so the current turn receives an explicit, deterministic cue.
 */
export function confirmsLastBotQuestion(history = [], incomingText = '') {
  if (!SHORT_AFFIRMATIVE.test(normalizedShortReply(incomingText))) return false;
  const previousBotText = [...history]
    .reverse()
    .find((entry) => entry?.role === 'model')
    ?.parts?.map((part) => String(part?.text || '')).join('\n')
    .trim();
  if (!previousBotText) return false;
  return /[?？]|(?:האם|לשבץ|לשלוח|להמשיך|תרצ[הי]|מאשר(?:ת)?)/u.test(previousBotText);
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

function urlsIn(value) {
  return String(value ?? '').match(URL_PATTERN) || [];
}

/** Every address a tool actually handed back, at any depth of its result. */
function collectUrls(value, into = new Set()) {
  if (value == null) return into;
  if (typeof value === 'string') {
    for (const url of urlsIn(value)) into.add(url);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, into);
    return into;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectUrls(item, into);
  }
  return into;
}

/** Trailing punctuation a sentence adds to an address is not part of it. */
function trimUrl(url) {
  return String(url).replace(/[.,;:!?)\]]+$/, '');
}

/**
 * The model was handed a signup link for one group, then asked about another —
 * and wrote out the first address with the group name swapped, an address that
 * leads nowhere. Rules alone did not hold: the shape of a real link is exactly
 * what makes a fabricated one easy to write. So the reply may only carry
 * addresses that a tool returned this turn, or that the prompt itself supplied.
 */
export function unknownUrlsInReply(text, allowed) {
  const known = new Set([...allowed].map(trimUrl));
  return urlsIn(text)
    .map(trimUrl)
    .filter((url) => !known.has(url));
}

/**
 * "באיזו כיתה תום ואביב לומדים?" reads as though the two children share one
 * answer. Besides sounding odd, one grade can then be reused for both children
 * and send the younger sibling to the wrong class search. The prompt tells the
 * model to ask separately; this small output guard makes that rule deterministic
 * for the common two-name Hebrew phrasing as well.
 */
export function separateMultiChildGradeQuestion(text) {
  return String(text || '').replace(
    /באיזו\s+כיתה\s+([\p{L}'׳״-]{2,})\s+ו([\p{L}'׳״-]{2,})\s+לומדים(?:\s+כיום)?\s*\?/gu,
    (_match, first, second) => `מה הכיתה של ${first} כיום, ומה הכיתה של ${second}?`
  );
}

function successfulToolResult(result) {
  if (!result || typeof result !== 'object' || result.error) return false;
  if (result.נשמר === false || result.בוצע === false) return false;
  return true;
}

function successfulToolNames(calls = []) {
  return new Set(calls.map((call) => call.name));
}

function resultContainsRegisteredStatus(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(resultContainsRegisteredStatus);
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:status|סטטוס|מצב_הרשמה)$/i.test(key)) {
      const status = String(item || '').trim().toLowerCase();
      if (['registered', 'active', 'רשום', 'רשומה', 'פעיל', 'פעילה'].includes(status)) return true;
    }
    if (item && typeof item === 'object' && resultContainsRegisteredStatus(item)) return true;
  }
  return false;
}

/**
 * Equipment still owed, anywhere in a tool result.
 *
 * A mother paid for two of the three items and was told everything was
 * settled — the chalk was still unpaid, and the reply was the model's own
 * cheerful summary rather than anything the tools had said. Whatever a turn
 * looked at is what it may claim: an open item in front of it is proof that
 * "all done" is wrong.
 */
function resultShowsOpenEquipment(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(resultShowsOpenEquipment);
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:מצב|payment_status)$/i.test(key)) {
      const state = String(item || '').trim();
      if (['טרם נסגר', 'unpaid', 'ממתין לתשלום'].includes(state)) return true;
    }
    // הקישור עצמו הוא ההוכחה: הוא נוצר רק כשיש פריט שלא הוסדר.
    if (/^(?:קישור)$/.test(key) && /\/api\/e\//.test(String(item || ''))) return true;
    if (item && typeof item === 'object' && resultShowsOpenEquipment(item)) return true;
  }
  return false;
}

/**
 * Claims about writes are checked after the model finishes phrasing the reply.
 * A prompt can tell the model not to invent an action; this gate makes that
 * rule enforceable. Only a successful write tool from this exact turn can back
 * a first-person past-tense claim.
 */
export function unbackedReplyClaims(text, successfulCalls = []) {
  const reply = String(text || '');
  const names = successfulToolNames(successfulCalls);
  const claims = [];

  const claimsPlacement = /(?:שיבצתי|שיבצנו|שריינתי|שריינו)/.test(reply)
    || /(?:העברתי|העברנו)[^\n.!?]*(?:לקבוצה|לקבוצת|ליום|לשעה|שיבוץ|חוג)/.test(reply)
    || /(?:שובץ|שובצה|השיבוץ\s+(?:בוצע|הושלם)|המקום\s+נשמר|הקבוצה\s+עודכנה)/.test(reply);
  if (claimsPlacement
      && !names.has('startSignup') && !names.has('joinWaitlist')) {
    claims.push('placement');
  }
  if (/(?:ביטלתי|ביטלנו|הסרתי|הסרנו)[^\n.!?]*(?:שיבוץ|קבוצה|חוג)|(?:השיבוץ\s+בוטל|הוסר(?:ה)?[^\n.!?]*מהקבוצה)/.test(reply)
      && !names.has('cancelSignup')) {
    claims.push('cancellation');
  }
  if (/(?:העברתי|העברנו|סימנתי|סימנו)[^\n.!?]*ארכיון|(?:הכרטיס|המתאמן|המתאמנת)[^\n.!?]*(?:הועבר|הועברה|סומן|סומנה)[^\n.!?]*ארכיון/.test(reply)
      && !names.has('archiveNonReturningStudent')) {
    claims.push('archive');
  }
  if (/(?:עדכנתי|עדכנו|תיקנתי|תיקנו)[^\n.!?]*תאריך[^\n.!?]*לידה|תאריך[^\n.!?]*הלידה[^\n.!?]*(?:עודכן|תוקן)/.test(reply)) {
    claims.push('birth_date');
  }
  if (/(?:עדכנתי|עדכנו|שמרתי|שמרנו)[^\n.!?]*(?:שם הלקוח|שם המשפחה|הפרטים בכרטיס)/.test(reply)
      && !names.has('updateCustomerDetails')) {
    claims.push('customer_name');
  }
  if (/(?:קבעתי|קבענו)[^\n.!?]*(?:תזכורת|חזרה|לחזור)|נקבעה[^\n.!?]*(?:תזכורת|חזרה)/.test(reply)
      && !names.has('scheduleFollowUp')) {
    claims.push('follow_up');
  }
  if (/(?:רשמתי|רשמנו|הכנסתי|הכנסנו)[^\n.!?]*(?:מתעניין|רשימת ההמתנה)/.test(reply)
      && !names.has('addActivityInterest') && !names.has('joinWaitlist')) {
    claims.push('interest_or_waitlist');
  }

  // "רשמנו לפנינו גם את רצונכם לשבץ אותו לנבחרת במידה ותיפתח קבוצה" — nothing
  // was written anywhere, and the mother has every reason to believe her
  // request is on file. A note the customer will rely on has to leave a trace:
  // a follow-up the bot scheduled, or a handoff so a person holds it.
  if (/(?:רשמתי|רשמנו)\s+(?:לפניי|לפנינו|אצלי|אצלנו)|(?:רשום|נרשם|מתועד|תיעדתי|תיעדנו)\s+(?:לפניי|לפנינו|אצלי|אצלנו|במערכת שלנו)/.test(reply)
      && !names.has('scheduleFollowUp')
      && !names.has('addActivityInterest')
      && !names.has('joinWaitlist')
      && !names.has('updateCustomerDetails')) {
    claims.push('noted_request');
  }

  const claimsCompletedRegistration = /כבר\s+רשו(?:ם|מה|מים|מות)(?:\s|$|[,.!?])/.test(reply);
  const registrationGrounded = successfulCalls.some((call) => resultContainsRegisteredStatus(call.result));
  if (claimsCompletedRegistration && !registrationGrounded) claims.push('registered_status');

  if (/איז(?:ו|ה)[^\n.!?]*כיתה[^\n.!?]*תעד|איז(?:ה|ו)[^\n.!?]*גיל[^\n.!?]*תעד/.test(reply)) {
    claims.push('grade_as_preference');
  }

  // "הכול מעודכן אצלנו" beside a chalk bag nobody has paid for. A parent who
  // hears that stops, and the missing item surfaces at the first training.
  const claimsAllSettled = /(?:הכול|הכל)\s+(?:מעודכן|מסודר|תקין|סגור|מוסדר)|אין\s+צורך\s+בפעולות\s+נוספות|לא\s+נדרשת\s+פעולה\s+נוספת/.test(reply);
  if (claimsAllSettled && successfulCalls.some((call) => resultShowsOpenEquipment(call.result))) {
    claims.push('equipment_settled');
  }

  return [...new Set(claims)];
}

function functionCallsOf(content) {
  return (content?.parts || [])
    .map((part) => part.functionCall)
    .filter((call) => call && call.name);
}

function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/**
 * Pull a direct advanced/squad eligibility out of the family card before the
 * model answers. This is deliberately deterministic: a generic prompt must
 * never override a real approval already stored on the participant.
 */
export function directRestrictedEligibility(card, incomingText) {
  const text = normalizedName(incomingText);
  const wantsAdvanced = /מתקדמ/u.test(text);
  const wantsSquad = /נבחרת/u.test(text);
  if (!wantsAdvanced && !wantsSquad) return null;

  const children = Array.isArray(card?.ילדים) ? card.ילדים : [];
  const named = children.filter((child) => {
    const fullName = normalizedName(child?.שם);
    if (!fullName) return false;
    const firstName = fullName.split(' ')[0];
    const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return text.includes(fullName) || (firstName.length > 1 && words.includes(firstName));
  });
  const child = named.length === 1 ? named[0] : (children.length === 1 ? children[0] : null);
  if (!child) return null;

  const eligiblePrograms = wantsAdvanced
    ? new Set(['advanced'])
    : /צעיר/u.test(text)
      ? new Set(['young_squad'])
      : /בוגר/u.test(text)
        ? new Set(['adult_squad'])
        : new Set(['young_squad', 'adult_squad']);
  const rows = (Array.isArray(child?.זכאות_למסלולים) ? child.זכאות_למסלולים : [])
    .filter((row) => eligiblePrograms.has(String(row?.מסלול || '')))
    .filter((row) => ['returning', 'approved'].includes(String(row?.סטטוס || '')));
  if (!rows.length) return null;

  const row = rows.find((candidate) => {
    const groupName = normalizedName(candidate?.קבוצה);
    return groupName && text.includes(groupName);
  }) || rows[0];
  return {
    childName: normalizedName(child?.שם),
    program: String(row?.מסלול || ''),
    status: String(row?.סטטוס || ''),
    groupName: normalizedName(row?.קבוצה),
  };
}

/**
 * A demand for approval, however it is worded. "מחייבת אישור ידני של הצוות"
 * slipped past a pattern that expected אישור and הצוות to be adjacent, and a
 * mother whose son was already approved for the young squad was told the
 * system blocks him.
 */
const APPROVAL_DEMAND = new RegExp(
  '(?:מותנ(?:ה|ית)\\s+באישור'
  + '|(?:נדרש|צריך|צריכה|דורש|דורשת|מחייב|מחייבת)(?:ים|ות)?\\s+(?:כאן\\s+)?אישור'
  + '|בקשה\\s+לאישור'
  + '|אישור(?:\\s+[\\p{L}\'"׳״-]+){0,2}\\s+(?:של\\s+)?(?:הצוות|צוות)'
  + '|ממתין(?:ה|ים)?\\s+לאישור)',
  'u'
);

/**
 * A refusal need not mention an approval at all. "המערכת חוסמת שיבוץ אוטומטי"
 * and "לא ניתן לשבץ בגלל הגיל" land on the parent exactly the same way, and
 * both contradict a permission that is already on the participant.
 */
const PLACEMENT_REFUSAL = new RegExp(
  '(?:חוסמ(?:ת|ים)\\s+(?:את\\s+ה)?שיבוץ'
  + '|(?:לא\\s+ניתן|אי\\s+אפשר|לא\\s+נוכל|לא\\s+אוכל|לא\\s+מתאפשר)\\s+ל(?:שבץ|הירשם|רשום)'
  + '|(?:לא\\s+עומד(?:ת)?\\s+ב(?:דרישות|תנאי|קריטריון)))',
  'u'
);

/**
 * A placement can be held up by things that have nothing to do with the
 * programme permission — an unsigned health form, a payment, a full group. A
 * refusal that names one of those is a true answer and must survive; only the
 * approval demand is wrong in every case.
 */
const OTHER_BLOCKER = new RegExp(
  '(?:טופס|הצהרת\\s+בריאות|הצהרה|תשלום|לשלם|לא\\s+שולם'
  + '|מלאה|קיבולת|אין\\s+מקום|רשימת\\s+המתנה|ממתינים)',
  'u'
);

export function contradictsDirectEligibility(replyText, eligibility) {
  if (!eligibility) return false;
  const text = String(replyText || '');
  if (APPROVAL_DEMAND.test(text)) return true;
  return PLACEMENT_REFUSAL.test(text) && !OTHER_BLOCKER.test(text);
}

/**
 * What the customer reads when the model claimed an action we cannot back.
 *
 * „אני לא רואה שהפעולה נקלטה במערכת” says nothing to the person holding the
 * phone: they did not ask about a system, and „פעולה” is our word, not
 * theirs. Each of these says what will happen next instead.
 */
export function unbackedClaimHandoffText(unbacked = []) {
  const claims = new Set(unbacked);
  const tail = 'מישהו מהצוות יחזור אליכם בהקדם.';
  if (claims.has('placement') || claims.has('cancellation')) {
    return `תודה 🙏 שינוי שיבוץ נעשה מול הקבוצה עצמה, אז אני מעביר את זה לצוות.\n${tail}`;
  }
  if (claims.has('birth_date') || claims.has('customer_name')) {
    return `תודה 🙏 את עדכון הפרטים בכרטיס עושה הצוות — העברתי אליהם.\n${tail}`;
  }
  if (claims.has('follow_up')) {
    return `תודה 🙏 העברתי לצוות כדי שיחזרו אליכם במועד שסיכמנו.\n${tail}`;
  }
  if (claims.has('interest_or_waitlist') || claims.has('noted_request')) {
    return `תודה 🙏 העברתי את הבקשה לצוות כדי שתהיה אצל מישהו ולא תישכח.\n${tail}`;
  }
  return `תודה 🙏 אני מעביר את זה לצוות כדי שיטפלו ויעדכנו אתכם.\n${tail}`;
}

/**
 * The customer reported a registration and the model answered around it.
 *
 * Doing it here rather than leaving it to the prompt: the message is explicit,
 * the tool is deterministic, and the alternative the customer actually got was
 * being told twice in twenty minutes that nothing had reached the system.
 */
async function recordReportedRegistration({ incoming, tools, allowed, successfulCalls, toolsUsed }) {
  if (!isExplicitCentreRegistrationReport(incoming)) return null;
  if (!allowed.has('reportCentreRegistration')) return null;
  if (successfulCalls.some((call) => call.name === 'reportCentreRegistration')) return null;
  try {
    const result = await tools.reportCentreRegistration({});
    toolsUsed.push('reportCentreRegistration');
    // Ambiguous card, no trainee, nothing saved — the team, as before.
    if (!result || result.error) return null;
    const text = centreRegistrationAcknowledgement(result);
    if (!text) return null;
    return {
      text,
      handoff: false,
      unsure: false,
      toolsUsed,
      reason: 'registration_report_recorded',
    };
  } catch (err) {
    console.error(`recording a reported registration failed: ${err.message}`);
    return null;
  }
}

export function isExplicitCentreRegistrationReport(text) {
  const value = String(text || '').trim();
  if (!/(?:מתנ[״"']?ס|הרשמ)/u.test(value)) return false;
  return /(?:נרש(?:ם|מ(?:תי|נו|ה|ו))|השלמ(?:תי|נו|ה|ו).{0,30}הרשמ|הרשמ.{0,30}(?:הושלמ|בוצע|סודר)|רשמנו\s+(?:אותו|אותה|את))/u
    .test(value);
}

function directEligibilityInstruction(eligibility) {
  if (!eligibility) return '';
  const program = eligibility.program === 'advanced'
    ? 'מתקדמים'
    : eligibility.program === 'young_squad'
      ? 'נבחרת צעירה'
      : 'נבחרת בוגרת';
  const group = eligibility.groupName ? ` לקבוצה «${eligibility.groupName}»` : '';
  return `## זכאות אישית מאומתת\n${eligibility.childName} מאושר/ת להרשמה ל${program}${group} (סטטוס ${eligibility.status}). זו זכאות קיימת. אסור לומר שנדרש אישור צוות נוסף; המשך בסדר ההרשמה הרגיל.`;
}

function centreRegistrationAcknowledgement(result) {
  const lines = [String(result?.אישור_ללקוח || '').trim()].filter(Boolean);
  if (result?.מסמכים?.מצב && result.מסמכים.מצב !== 'חתומים ובתוקף') {
    lines.push(String(result.מסמכים.הסבר || result.מסמכים.מצב).trim());
    if (result.מסמכים.קישור) lines.push(String(result.מסמכים.קישור));
  }
  if (result?.ציוד?.מצב === 'טרם נסגר') {
    lines.push(String(result.ציוד.הסבר || 'נשאר להסדיר את הציוד.').trim());
    if (result.ציוד.קישור) lines.push(String(result.ציוד.קישור));
  }
  return lines.filter(Boolean).join('\n');
}

function textOf(content) {
  return (content?.parts || [])
    .map((part) => String(part.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * A group-suitability question can depend on professional knowledge that is not
 * represented by grade/age in the CRM. When the model correctly hands it to a
 * person, a generic "we got it" acknowledgement hides the important fact that
 * the bot does not know the answer. Make that limitation explicit without
 * changing handoffs for refunds, cancellations and other human-only topics.
 */
export function explicitGroupSuitabilityHandoff(incomingText, fallbackText = '') {
  const incoming = String(incomingText || '').trim();
  const asksWhichGroup = /(?:לאיז(?:ו|ה)\s+קבוצה|איזו\s+קבוצה|לאיזו\s+מסגרת)/u.test(incoming);
  const asksWhatFits = /(?:למה|לְמה)\s+[^?!.]{1,60}\s+מתאי(?:ם|מה)|מתאי(?:ם|מה)\s+לאיז(?:ו|ה)\s+קבוצה/u.test(incoming);
  if (!asksWhichGroup && !asksWhatFits) return String(fallbackText || '').trim();

  const nameMatch = incoming.match(/(?:לאיז(?:ו|ה)\s+קבוצה|(?:למה|לְמה))\s+([\p{L}'״׳-]{2,24})\s+מתאי(?:ם|מה)/u);
  const possibleName = String(nameMatch?.[1] || '').trim();
  const name = /^(?:הוא|היא|הילד|הילדה|המתאמן|המתאמנת)$/u.test(possibleName) ? '' : possibleName;
  const missingFact = name
    ? `אני לא יודע לאיזו קבוצה ${name} מתאים, ולכן אני מעביר את השאלה לצוות שלנו.`
    : 'אני לא יודע מהי הקבוצה המתאימה במקרה הזה, ולכן אני מעביר את השאלה לצוות שלנו.';
  return `${missingFact}\nמישהו מהצוות יחזור אליכם בהקדם.`;
}

function recentCustomerText(history = [], incomingText = '') {
  const texts = history
    .filter((entry) => entry?.role === 'user')
    .map((entry) => String(entry?.parts?.[0]?.text || '').trim())
    .filter(Boolean)
    .slice(-4);
  const incoming = String(incomingText || '').trim();
  if (incoming && texts.at(-1) !== incoming) texts.push(incoming);
  return texts.join('\n');
}

export function gradeFromRecentCustomerText(text = '') {
  const matches = [...String(text || '').matchAll(/כיתה\s*([א-ו])(?:['׳״"])?/gu)];
  return matches.at(-1)?.[1] || '';
}

function groupOptionsReply(groups = [], grade = '', childName = '') {
  const lines = groups.map((group) => {
    const days = Array.isArray(group?.ימי_אימון) && group.ימי_אימון.length
      ? group.ימי_אימון.join(' ו')
      : String(group?.יום || '').trim();
    const when = [days ? `יום ${days}` : '', group?.שעה ? `בשעה ${group.שעה}` : '']
      .filter(Boolean)
      .join(' ');
    const state = String(group?.מצב || '').trim();
    return `• ${when || String(group?.שכבה || 'קבוצה').trim()}${state ? ` — ${state}` : ''}`;
  });
  const who = childName ? ` עבור ${childName}` : '';
  return `אלה האפשרויות לכיתה ${grade}׳${who}:\n${lines.join('\n')}\nאיזו אפשרות מתאימה לכם?`;
}

/**
 * A short, factual safety net for the two core registration questions. It is
 * used only when the model is unavailable or exhausts its tool steps; the data
 * still comes from the same CRM tools, never from a guessed schedule.
 */
async function deterministicModelFailureFallback({ history, incoming, tools, toolsUsed }) {
  const current = String(incoming || '').trim();
  const context = recentCustomerText(history, current);
  const ambiguousSignup = /(?:איפה|איך|כיצד)[^?!.]{0,30}נרשמ|נרשמ[^?!.]{0,30}(?:איפה|איך)/u.test(current);

  if (ambiguousSignup) {
    const card = await tools.getFamilyCard();
    if (!toolsUsed.includes('getFamilyCard')) toolsUsed.push('getFamilyCard');
    const children = Array.isArray(card?.ילדים) ? card.ילדים : [];
    const firstName = children.length === 1
      ? String(children[0]?.שם || '').trim().split(/\s+/)[0]
      : '';
    return {
      text: firstName
        ? `בשמחה — לאיזו קבוצה תרצו לרשום את ${firstName}?`
        : 'בשמחה — לאיזה חוג או קבוצה תרצו להירשם?',
      handoff: false,
      unsure: false,
      toolsUsed,
      reason: 'deterministic_signup_clarification',
    };
  }

  const asksForDays = /(?:אופציות|אפשרויות)[^?!.]{0,40}(?:ימים|יום)|(?:איזה|אילו|מה)[^?!.]{0,20}ימים|לא\s+הבנתי[^?!.]{0,40}ימים/u.test(context);
  const wantsSignup = /(?:לרשום|להירשם|תרשום|תרשמי)/u.test(context);
  const grade = gradeFromRecentCustomerText(context);
  if (grade && (asksForDays || wantsSignup)) {
    const [classes, card] = await Promise.all([
      tools.listClasses({ grade }),
      tools.getFamilyCard(),
    ]);
    for (const toolName of ['listClasses', 'getFamilyCard']) {
      if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);
    }
    const groups = Array.isArray(classes?.קבוצות) ? classes.קבוצות : [];
    if (groups.length) {
      const children = Array.isArray(card?.ילדים) ? card.ילדים : [];
      const childName = children.length === 1
        ? String(children[0]?.שם || '').trim().split(/\s+/)[0]
        : '';
      return {
        text: groupOptionsReply(groups, grade, childName),
        handoff: false,
        unsure: false,
        toolsUsed,
        reason: 'deterministic_group_options',
      };
    }
  }
  return null;
}

/**
 * @returns {{ text: string, handoff: boolean, toolsUsed: string[], reason: string }}
 */
export async function runCustomerToolTurn({
  systemInstruction,
  history = [],
  incomingText,
  settings = {},
  parent = null,
  phone = '',
  speaker = null,
  onPlacement = null,
  apiKey = process.env.GEMINI_API_KEY,
  callModel = callGeminiChat,
  maxSteps = MAX_TOOL_STEPS,
} = {}) {
  const tools = buildCustomerTools({ settings, parent, phone, speaker, onPlacement });
  // A capability switched off in the settings is not offered to the model at
  // all. Filtering the declarations rather than refusing the call is what makes
  // the switch real: the model cannot talk itself into a tool it cannot see.
  const allowed = enabledToolNames(settings);
  const contents = history.filter((entry) => entry?.parts?.[0]?.text);
  const incoming = String(incomingText || '').trim();
  const introAllowed = customerAllowsIntro(history, incoming);
  const declarations = CUSTOMER_TOOL_DECLARATIONS.filter((declaration) => (
    allowed.has(declaration.name)
      && (declaration.name !== 'scheduleIntroSession' || introAllowed)
  ));
  const last = contents[contents.length - 1];
  const currentAlreadyStored = last?.role === 'user'
    && String(last?.parts?.[0]?.text || '').trim() === incoming;
  if (incoming && !currentAlreadyStored) {
    contents.push({ role: 'user', parts: [{ text: incoming }] });
  }

  if (!contents.length) return { text: '', handoff: false, toolsUsed: [], reason: 'empty' };

  const toolsUsed = [];
  const successfulCalls = [];
  let directEligibility = null;
  if (parent && allowed.has('getFamilyCard') && /(?:נבחרת|מתקדמ)/u.test(incoming)) {
    try {
      const card = await tools.getFamilyCard();
      const recentCustomerText = contents
        .filter((entry) => entry?.role === 'user' && entry?.parts?.[0]?.text)
        .slice(-3)
        .map((entry) => entry.parts[0].text)
        .join('\n');
      directEligibility = directRestrictedEligibility(card, recentCustomerText || incoming);
      toolsUsed.push('getFamilyCard');
    } catch (err) {
      console.error(`failed to preflight restricted-program eligibility: ${err.message}`);
    }
  }
  const confirmationInstruction = confirmsLastBotQuestion(history, incoming)
    ? '## מצב התור הנוכחי\nהלקוח אישר בחיוב את השאלה האחרונה של הבוט. אין לשאול אותה שוב. יש לבצע עכשיו את הפעולה שאושרה בעזרת הכלי המתאים, ואז להמשיך רק לפרט הבא שחסר.'
    : '';
  const introPolicyInstruction = introAllowed
    ? '## אימון היכרות\nהלקוח ביקש אימון היכרות או אמר שאינו מוכן להירשם ישירות, ולכן אפשר להציע את מסלול ההיכרות.'
    : '## ברירת מחדל להרשמה\nהלקוח לא ביקש אימון היכרות ולא סירב להרשמה. אסור להזכיר או להציע אימון היכרות. לאחר בחירת קבוצה יש לבצע הרשמה ישירה באמצעות startSignup.';
  const instruction = [
    systemInstruction,
    CUSTOMER_TOOL_RULES,
    confirmationInstruction,
    introPolicyInstruction,
    directEligibilityInstruction(directEligibility),
  ]
    .filter(Boolean)
    .join('\n\n');
  // Addresses the prompt itself carries (the health form, the site) are as good
  // as a tool's — they were not invented by the model either.
  const allowedUrls = collectUrls(instruction);
  // A previous bot answer may repeat a link it already sent. A customer URL is
  // not trusted merely because it appears in history: otherwise a fake signup
  // address sent by the customer bypasses the invented-link guard.
  for (const entry of history) {
    if (entry?.role === 'model') collectUrls(entry?.parts?.[0]?.text, allowedUrls);
  }

  let eligibilityCorrectionSent = false;
  let registrationAckCorrectionSent = false;
  let introPolicyCorrectionSent = false;
  let claimCorrectionSent = false;
  for (let step = 0; step < maxSteps; step += 1) {
    const { content, error } = await callModel({
      contents,
      systemInstruction: [
        instruction,
        eligibilityCorrectionSent
          ? 'התשובה הקודמת נפסלה כי דרשה אישור צוות למרות זכאות קיימת. נסח מחדש בלי לדרוש אישור נוסף והמשך בשלב ההרשמה הנכון.'
          : '',
        registrationAckCorrectionSent
          ? 'התשובה הקודמת נפסלה כי חשפה ללקוח תהליך אימות פנימי. השתמש בנוסח אישור_ללקוח שהכלי החזיר, ואל תכתוב שהצוות יאמת או שהדיווח נשמר לבדיקה.'
          : '',
        introPolicyCorrectionSent
          ? 'התשובה הקודמת נפסלה כי הציעה אימון היכרות בלי שהלקוח ביקש. אל תזכיר אימון היכרות. המשך בהרשמה ישירה וקרא ל-startSignup אם כבר נבחרה קבוצה.'
          : '',
        claimCorrectionSent
          ? 'התשובה הקודמת נפסלה כי טענה שביצעת פעולה שלא בוצעה במערכת. ענה שוב על מה שהלקוח שאל, בלי לכתוב שרשמת, שמרת, עדכנתי או תיעדתי משהו. אם צריך לשמור משהו — קרא לכלי המתאים עכשיו.'
          : '',
      ].filter(Boolean).join('\n\n'),
      declarations,
      apiKey,
    });
    if (!content) {
      // A deterministic answer after a provider failure makes the same bot look
      // suddenly less capable and can invent a different workflow. Provider
      // outages are handled by the durable circuit breaker in whatsapp.js;
      // during them the customer receives no automatic fallback.
      if (error) return { text: '', handoff: false, toolsUsed, reason: error };
      const fallback = await deterministicModelFailureFallback({ history, incoming, tools, toolsUsed });
      return fallback || { text: '', handoff: false, toolsUsed, reason: error || 'model_error' };
    }

    const calls = functionCallsOf(content);
    if (!calls.length) {
      const raw = textOf(content);
      const handoff = /^HANDOFF\b/i.test(raw);
      // The older prompt taught the model to prefix UNSURE as well; either
      // marker must be stripped so a customer never reads it.
      const unsure = !handoff && /^UNSURE\b/i.test(raw);
      const text = separateMultiChildGradeQuestion(
        whatsappifyMarkdown(raw.replace(/^(?:HANDOFF|UNSURE)\s*/i, ''))
      );

      if (!introAllowed && replyMentionsIntro(text)) {
        console.error('bot offered an intro session without customer intent');
        if (!introPolicyCorrectionSent) {
          introPolicyCorrectionSent = true;
          continue;
        }
        return {
          text: '',
          handoff: false,
          unsure: false,
          toolsUsed,
          reason: 'unsolicited_intro_offer',
        };
      }

      const centreReport = [...successfulCalls].reverse()
        .find((item) => item.name === 'reportCentreRegistration' && item.result?.משובץ_אצלנו);
      if (centreReport && /(?:הצוות.{0,20}יאמת|נשמר.{0,20}לבדיקה|נרשם.{0,20}לבדיקה)/u.test(text)) {
        console.error(`bot exposed internal centre verification for ${centreReport.result?.נרשם_לבדיקה || 'participant'}`);
        if (!registrationAckCorrectionSent) {
          registrationAckCorrectionSent = true;
          continue;
        }
        return {
          text: centreRegistrationAcknowledgement(centreReport.result),
          handoff: false,
          unsure: false,
          toolsUsed,
          reason: 'centre_registration_ack_guard',
        };
      }

      if (contradictsDirectEligibility(text, directEligibility)) {
        console.error(`bot contradicted direct eligibility for ${directEligibility.childName}`);
        if (!eligibilityCorrectionSent) {
          eligibilityCorrectionSent = true;
          continue;
        }
        const program = directEligibility.program === 'advanced'
          ? 'לקבוצת המתקדמים'
          : directEligibility.program === 'young_squad'
            ? 'לנבחרת הצעירה'
            : 'לנבחרת הבוגרת';
        return {
          text: `${directEligibility.childName} מאושר/ת להרשמה ${program}. אפשר להמשיך בתהליך ההרשמה ללא אישור נוסף.`,
          handoff: false,
          unsure: false,
          toolsUsed,
          reason: 'direct_eligibility_guard',
        };
      }

      const invented = unknownUrlsInReply(text, allowedUrls);
      if (invented.length) {
        console.error(`bot invented a link, handing off: ${invented.join(' ')}`);
        return {
          text: 'רגע — כדי לא לשלוח קישור שגוי אני מעביר את זה לצוות 🙏\nמישהו יחזור אליכם עם הקישור הנכון.',
          handoff: true,
          unsure: false,
          toolsUsed,
          reason: 'invented_link',
        };
      }

      const unbacked = unbackedReplyClaims(text, successfulCalls);
      // Not a handoff: the customer is one tap from finishing, and the useful
      // answer is the item that is still open — not a person calling back.
      if (unbacked.includes('equipment_settled')) {
        console.error('bot called the equipment settled while an item was still open');
        return {
          text: 'כמעט — נשאר עוד פריט ציוד שלא הוסדר. הקישור שנשלח קודם פתוח, '
            + 'ואפשר להשלים אותו שם או לסמן שהוא כבר קיים אצלכם בבית.',
          handoff: false,
          unsure: false,
          toolsUsed,
          reason: 'equipment_not_settled',
        };
      }
      if (unbacked.includes('grade_as_preference')) {
        console.error('bot treated a factual grade as a preference');
        return {
          text: 'הכיתה והגיל מתעדכנים בטופס ההשתתפות.',
          handoff: false,
          unsure: false,
          toolsUsed,
          reason: 'invalid_grade_question',
        };
      }
      // Both of these are the bot about to tell a customer that something was
      // done. The claim is dropped — but the customer is left mid-task, so the
      // turn ends with a person, not with a dead end. "לא הצלחתי לאמת שהפעולה
      // בוצעה… אפשר לנסות שוב" was sent to a parent asking how to continue
      // after signing the form: nothing to try again, and nobody told.
      if (unbacked.includes('registered_status')) {
        console.error('bot claimed a completed registration without a registered CRM status');
        return {
          text: 'תודה 🙏 אני בודק את מצב ההרשמה מול הצוות כדי לא למסור לכם מידע לא מדויק.\n'
            + 'מישהו יחזור אליכם בהקדם.',
          handoff: true,
          unsure: false,
          toolsUsed,
          reason: 'unverified_registration',
        };
      }
      if (unbacked.length) {
        console.error(`bot claimed an action without a successful tool: ${unbacked.join(', ')}`);
        // The claim is usually a courtesy phrase — "רשמתי לפניי" beside an
        // answer that was otherwise right. Replacing the whole turn with a
        // handoff about an action that never happened reads as a non sequitur
        // to a customer who only asked a question, so the model gets one
        // chance to say the same thing without claiming anything.
        if (!claimCorrectionSent) {
          claimCorrectionSent = true;
          continue;
        }
        // The customer told us twice that they had registered, and twice the
        // answer was that we could not see an action in the system. They were
        // not asking about an action — they were reporting one. Recording it
        // is what they wanted, and the tool for it exists.
        const recorded = await recordReportedRegistration({
          incoming, tools, allowed, successfulCalls, toolsUsed,
        });
        if (recorded) return recorded;
        return {
          text: unbackedClaimHandoffText(unbacked),
          handoff: true,
          unsure: false,
          toolsUsed,
          reason: 'unverified_action',
        };
      }

      // The customer reported a registration and the turn is ending without
      // it having been written down. Whatever the model chose to say about it,
      // the report is the thing they wanted recorded.
      const reported = await recordReportedRegistration({
        incoming, tools, allowed, successfulCalls, toolsUsed,
      });
      if (reported) return reported;

      const customerText = handoff
        ? explicitGroupSuitabilityHandoff(incoming, text)
        : text;
      return { text: customerText, handoff, unsure, toolsUsed, reason: 'ok' };
    }

    contents.push(content);
    const responseParts = [];
    for (const call of calls) {
      if (call.name === 'scheduleIntroSession' && !introAllowed) {
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              error: 'הלקוח לא ביקש אימון היכרות. יש להמשיך בהרשמה ישירה באמצעות startSignup.',
            },
          },
        });
        continue;
      }
      const tool = allowed.has(call.name) ? tools[call.name] : null;
      if (!tool) {
        responseParts.push({
          functionResponse: { name: call.name, response: { error: 'אין כלי כזה' } },
        });
        continue;
      }
      if (call.name === 'reportCentreRegistration' && !isExplicitCentreRegistrationReport(incoming)) {
        responseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              error: 'ההודעה הנוכחית אינה דיווח מפורש שההרשמה במתנ״ס הושלמה',
              הודעה_נוכחית: incoming,
              הנחיה: 'ענה רק על ההודעה הנוכחית ואל תשנה את סטטוס ההרשמה לפי הודעה ישנה בהיסטוריה.',
            },
          },
        });
        continue;
      }
      try {
        const result = await tool(call.args || {});
        toolsUsed.push(call.name);
        if (successfulToolResult(result)) {
          successfulCalls.push({ name: call.name, args: call.args || {}, result });
        }
        collectUrls(result, allowedUrls);
        responseParts.push({ functionResponse: { name: call.name, response: result } });
      } catch (err) {
        responseParts.push({
          functionResponse: { name: call.name, response: { error: err.message } },
        });
      }
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  // Out of steps: cover the core registration questions deterministically;
  // everything else still returns empty so the caller can hand it to a person.
  const fallback = await deterministicModelFailureFallback({ history, incoming, tools, toolsUsed });
  return fallback || { text: '', handoff: false, toolsUsed, reason: 'max_steps' };
}
