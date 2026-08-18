/**
 * מה הלקוח התכוון — נשאל את המודל, לא רשימת מילים.
 *
 * הבוט הזה קיים כדי להבין הקשר. כל פעם שהחלפנו את ההבנה בביטוי רגולרי, קיבלנו
 * את אותה תקלה בדיוק מזווית אחרת:
 *
 * - „נרשמנו” לא נחשב דיווח, כי חסרה בו המילה מתנ״ס — והאמא קיבלה תשובה על
 *   שינוי שיבוץ שלא ביקשה.
 * - „אלימלך קרני נרשם” חיפש ילד ששמו כולל את הפועל.
 * - „בבקשה תסירו אותנו מרשימת התפוצה” לא זוהה כבקשת הסרה, בעוד ניסוח כמעט זהה
 *   כן זוהה.
 *
 * בכל אחד מהם התשובה הייתה להוסיף עוד מילה לרשימה, וזו רשימה שלא נגמרת. כאן
 * שואלים את המודל שאלת כן/לא על ההודעה הנוכחית בלבד, ומקבלים החלטה אחת ברורה.
 *
 * ## מה *לא* עובר לכאן
 *
 * משמרים שבודקים את מה שהבוט עצמו כתב — „אמרת ששיבצת בלי שהכלי הצליח” — נשארים
 * דטרמיניסטיים. הם אינם הבנה של הלקוח אלא אימות שלנו מול מה שבאמת קרה במסד,
 * ובדיקה כזאת חייבת להיות ודאית ולא שיפוטית.
 */

/**
 * No cache on purpose. It would save one short call and cost the ability to
 * reason about a turn on its own: the same sentence from two people would
 * share an answer, and a stale entry would be invisible. Two calls per turn
 * at most is not a price worth that.
 */
function firstText(content) {
  return (content?.parts || [])
    .map((part) => String(part.text || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * שאלת כן/לא על הודעה אחת.
 *
 * @param {string} question מה בדיוק נשאל, בגוף שני על „ההודעה”
 * @param {string} message  ההודעה הנוכחית של הלקוח, בלי היסטוריה
 * @param {*} fallback      מה להחזיר כשאין מודל או שהקריאה נכשלה
 * @returns {Promise<boolean>}
 */
export async function askAboutMessage({
  question,
  message,
  callModel,
  apiKey,
  fallback = false,
} = {}) {
  const text = String(message || '').trim();
  if (!text || typeof callModel !== 'function') return fallback;

  try {
    const { content, error } = await callModel({
      contents: [{ role: 'user', parts: [{ text }] }],
      systemInstruction: [
        'אתה מסווג הודעה אחת של לקוח בעסק לחוגי טיפוס.',
        question,
        'ענה במילה אחת בלבד: כן או לא. בלי הסבר ובלי סימני פיסוק.',
        'התייחס אך ורק להודעה שלפניך. אין היסטוריה ואין להשלים הקשר מהדמיון.',
      ].join('\n'),
      declarations: [],
      apiKey,
    });
    // A provider blip must not silently flip a decision: the caller says what
    // "unknown" means for it, and that is what an error returns.
    if (error || !content) return fallback;
    // Letters only, then read the first word. `\b` is defined on ASCII word
    // characters even under /u, so a Hebrew word never ends on a boundary and
    // /^כן\b/ is false for the answer "כן" itself.
    return firstText(content).replace(/[^\p{L}]/gu, '').startsWith('כן');
  } catch {
    return fallback;
  }
}

export const REPORTS_CENTRE_REGISTRATION = [
  'האם הלקוח מודיע בהודעה הזו שההרשמה במתנ״ס כבר בוצעה והושלמה?',
  '„נרשמנו”, „נרשמתי”, „סיימנו את ההרשמה”, „שילמנו במתנ״ס” — כן.',
  'כוונה עתידית („נירשם מחר”), שאלה („איך נרשמים?”), או דיווח על משהו אחר',
  'כמו תשלום ציוד או מילוי טופס — לא.',
].join('\n');

export const ASKS_TO_CROSS_AGE_BANDS = [
  'האם הלקוח מבקש בהודעה הזו לשבץ מתאמן מחוץ לשכבת הגיל שלו?',
  'למשל לצרף ילד לקבוצה של אח או חבר מכיתה אחרת, או לבקש חריגה מהגיל.',
  'שאלה „לאיזו קבוצה הוא מתאים?” אינה בקשה כזאת — היא שאלה רגילה.',
].join('\n');

/**
 * מה כרמית מהמתנ״ס כתבה, ועל מי.
 *
 * הערוץ הזה נשאר דטרמיניסטי בכל מה שקורה *אחרי* — מציאת המתאמן, חישוב תאריך
 * החיוב, שינוי הסטטוס — כי תאריך שגוי הוא חיוב שגוי למשפחה. מה שעבר לכאן הוא
 * רק הקריאה: „אלימלך קרני נרשם” חיפש ילד ששמו כולל את הפועל, „יאירי נטע”
 * החזיר ארבעה ילדים בשם יאיר, ורשימת מילות הביטול לעולם אינה שלמה.
 *
 * @returns {Promise<{intent: string, name: string}>}
 *   intent: registration | cancellation | start_question | greeting | other
 */
export async function readCentreMessage({ message, callModel, apiKey } = {}) {
  const text = String(message || '').trim();
  const unknown = { intent: 'other', name: '' };
  if (!text || typeof callModel !== 'function') return unknown;

  try {
    const { content, error } = await callModel({
      contents: [{ role: 'user', parts: [{ text }] }],
      systemInstruction: [
        'מזכירת המתנ״ס כותבת לנו על מתאמנים בחוגי טיפוס. סווג את ההודעה שלפניך.',
        'ענה בשורה אחת בלבד בפורמט: כוונה|שם',
        'הכוונות האפשריות:',
        'registration — היא מודיעה שמתאמן נרשם או רשום אצלה.',
        'cancellation — היא מודיעה שמתאמן ביטל, לא נרשם, או הפסיק.',
        'start_question — היא שואלת ממתי מתאמן מתאמן אצלנו, לצורך חיוב.',
        'greeting — ברכה בלבד, בלי שם ובלי בקשה.',
        'other — כל דבר אחר, כולל שאלה שאינה על תאריך התחלה.',
        'השם: שם המתאמן כפי שהוא מופיע, בלי פעלים ובלי מילות קישור.',
        'סדר השמות כפי שנכתב, גם אם שם המשפחה ראשון. אין שם — השאר ריק.',
        'בלי הסבר, בלי מרכאות, בלי שורות נוספות.',
      ].join('\n'),
      declarations: [],
      apiKey,
    });
    if (error || !content) return unknown;

    const line = firstText(content).split('\n')[0].trim();
    const [rawIntent, ...rest] = line.split('|');
    const intent = String(rawIntent || '').trim().toLowerCase();
    const known = ['registration', 'cancellation', 'start_question', 'greeting', 'other'];
    return {
      intent: known.includes(intent) ? intent : 'other',
      name: rest.join('|').trim().replace(/^["'«»]+|["'«»]+$/g, ''),
    };
  } catch {
    return unknown;
  }
}
