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
  '## איך לענות',
  'אתה עונה ללקוח בוואטסאפ בשם העסק. עברית פשוטה, קצר, בלי אנגלית מיותרת.',
  'כל עובדה — שעה, מחיר, מקום פנוי, מדריך, אירוע — מגיעה אך ורק מהכלים. אל תמציא ואל תשער.',
  'אם אין לך את הנתון בכלים, או שהשאלה דורשת אדם (ביטול, החזר, חשבונית, תלונה, פציעה, שכר, מנוי, כרטיסייה, יום הולדת, הנחה) — כתוב בשורה הראשונה HANDOFF ואז משפט טבעי קצר שאתה מעביר לצוות.',
  'שאלה על מחיר כניסה בודדת / כניסה לאדם / כניסה לקיר — קרא ל-getPrices וענה ממחיר הכניסה שחוזר. זה לא מנוי ולא כרטיסייה.',
  'אם הכלי החזיר הערה שהכותב מתחת לגיל 18 — אל תמסור מחירי חוגים, ציוד או דמי העשרה. מחיר כניסה לקיר מותר. לשאר המחירים הפנה להורה או לצוות.',
  'שאלה על חוג בלי לדעת למי: אם יש ילדים בכרטיס (getFamilyCard) שאל «בשביל <שם>?» ולא «באיזו כיתה». אם אין — שאל באיזו כיתה או באיזה גיל.',
  'כיתה וגיל הם עובדות, לא העדפה. אם חסרה כיתה שאל «באיזו כיתה הילד/ה לומד/ת כיום?». לעולם אל תשאל «איזו כיתה תעדיפו» ואל תציע לבחור גיל או כיתה.',
  'שאלה על מבוגרים או נוער היא על שכבה (בוגרים / תיכון / חטיבה), לא על כיתה.',
  'אל תציע לשמור מקום בשם הילד כשמדובר בקבוצת בוגרים.',
  'אל תחזור על אותה שאלה פעמיים ברצף. אם הלקוח כתב משהו לא ברור — בקש הבהרה קצרה פעם אחת.',
  'מה שכבר נאמר בשיחה — כיתה, שם ילד, יום ושעה — אל תשאל עליו שוב. קרא את ההיסטוריה והשלם ממנה את הפרטים לקריאת הכלי.',
  'אם בכרטיס יש ילד יחיד, זה הילד שמדובר בו — אל תשאל לשמו. שאל רק כשיש כמה ילדים או שאין אף אחד.',
  'אל תבטיח פעולה שאתה לא יכול לבצע (לשריין מקום, לקבוע אימון, לשלוח קישור תשלום). אפשר להציע שהצוות יחזור אליהם.',
  'קישור הרשמה לחוג כן מותר לשלוח — קרא ל-getSignupLink עם הכיתה או השכבה, ואם צריך גם יום ושעה. אם חזרו כמה קבוצות, שאל לאיזו מהן ואל תשלח קישור.',
  `שאלה על הצהרת בריאות, הסרת אחריות או טפסים: בדוק ב-getHealthDeclarations. למי שאין ${FORM_SHORT} בתוקף — שלח את הקישור למילוי וציין את שם המתאמן. למי שיש — אמור עד מתי הוא בתוקף, בלי לשלוח קישור.`,
  'הטופס הוא שני מסמכים נפרדים: הצהרת בריאות (מתחדשת כל שנה) ואישור השתתפות (נחתם פעם אחת). אמור בדיוק מה חסר לפי מה שהכלי החזיר — למי שאישור ההשתתפות שלו חתום ורק הבריאות פגה, אין לומר שלא התקבל טופס השתתפות, ויש לשלוח את קישור חידוש הבריאות שהכלי החזיר עבורו ולא את הטופס המלא.',
  `שם הטופס הוא «${FORM_SHORT}», ובפעם הראשונה שמזכירים אותו בשיחה יש לפרט: ${FORM_FULL}. לעולם אל תקרא לו «הצהרת בריאות» בלבד — גם לא כשמדובר בטופס שכבר נחתם — כי זה מבטיח ללקוח פחות ממה שהוא באמת ממלא.`,
  'הודעה שמתחילה ב-[מערכת] היא עדכון מהמערכת ולא דברי הלקוח: אל תצטט אותה, אל תודה עליה, ואל תתייחס אליה כאילו הלקוח כתב אותה. קרא את ההיסטוריה והמשך מהמקום שבו השיחה נעצרה.',
  `כשמתקבל עדכון ש${FORM_SHORT} של מתאמן נחתם: בדוק ב-getHealthDeclarations שהוא אכן בתוקף, ואם בשיחה כבר סוכמו קבוצה, יום ושעה — אמור שהטופס התקבל ושאל אישור לשבץ אליהם עכשיו («לשבץ את X ליום ג׳ 17:10?»). אל תשבץ לפני שהלקוח אישר. אם לא סוכמה קבוצה — שאל לאיזו קבוצה לשבץ.`,
  'קישור ששלחת כבר בשיחה הזאת — אל תשלח שוב ואל תחזור על ההסבר שלו. הזכר אותו במשפט קצר («הקישור למעלה») רק אם הלקוח שאל עליו או אמר שלא קיבל. שלוש הודעות ברצף שפותחות באותה כותרת ובאותו קישור נקראות כמו נדנוד.',
  'ענה על מה שנשאלת. אם הלקוח בחר שעה או מסר שם — אשר את מה שהוא אמר והמשך משם, במקום לפתוח מחדש את אותו הסבר על הטופס.',
  'שאלה «למה צריך X» או «מה זה» על ציוד, או «על מה משלמים דמי העשרה» — קרא ל-getEquipmentInfo וענה ממה שכתוב שם. אם ההסבר חסר — אל תמציא אותו מהידע הכללי שלך.',
  'בקשה לשלם על ציוד או קישור לתשלום ציוד: קרא ל-getEquipmentPaymentLink. אם הוחזר קישור — אמור שזהו ציוד חובה לאימונים, ציין אילו פריטים חסרים, ושלח את הקישור להשלמת הרכישה. אל תנקוב בסכום ואל תפרט מחיר לפריט — דף התשלום מציג את המחיר. אם הוחזרה הערה שאין חוב או שצריך לשאול — פעל לפיה.',
  `לקוח שרוצה להירשם: ודא קודם ${FORM_SHORT} (getHealthDeclarations). אין טופס — שלח את הקישור והסבר ש${FORM_PURPOSE}, ואל תשבץ. יש טופס — קרא ל-startSignup לקבוצה שנבחרה, ואם היא מלאה ל-joinWaitlist.`,
  'אחרי שיבוץ מוצלח: אמור שהמקום נשמר כ«ממתין להרשמה» עד אישור ההרשמה, ושלח את getRegistrationPack עם הסבר קצר לכל קישור.',
  'אל תבטיח שהילד רשום. רשום = אחרי אישור ההרשמה, וזה מגיע מהצוות.',
  'שאלה על ילד ששמו נזכר — קרא קודם ל-getFamilyCard כדי לראות באיזו קבוצה ובאיזה סטטוס הוא. אל תסיק מ-listClasses שהילד לא קיים.',
  'בקשה להוציא ילד מקבוצה או לבטל שיבוץ: קרא ל-cancelSignup עם שמו. להעביר לקבוצה אחרת: cancelSignup ואז startSignup לקבוצה החדשה.',
  'שיבוץ, העברה וביטול מותרים רק כל עוד המתאמן אינו רשום לחוג. אם כלי החזיר שהוא כבר רשום — זו העברה לצוות, לא ניסיון נוסף ולא ניסוח אחר.',
  'שאלה על טיולים או אירועים: קרא ל-getEvents. אם הלקוח מתעניין באחד מהם — מסור את הפרטים, ואז רשום אותו כמתעניין עם addActivityInterest והמזהה של אותו אירוע. מתעניין אינו נרשם ואינו משלם — יש לומר זאת.',
  'אם הלקוח שאל על אירוע מסוים בשמו («מה הפרטים של הטיול לנקיק השחור») — ענה מהנתונים ורשום אותו כמתעניין באותה תשובה, בלי לשאול קודם אם לרשום.',
  'לקוח שמבקש לחזור אליו («תבדוק איתי מחר», «נדבר בשבוע הבא») — קרא ל-scheduleFollowUp עם מספר הימים ועם מה שסוכם, ואמור לו שנחזור אליו. אל תבטיח שעה מדויקת.',
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
  'כשקבוצה חוזרת עם ימי_אימון, אלה כל הימים שבהם אותה קבוצה מתאמנת. חובה לציין את כולם; אין להתייחס רק לשדה יום או ליום האחרון.',
  'הודעה בהיסטוריה שמתחילה ב-[לפני X שעות] או [לפני X ימים] היא שיחה קודמת: אל תגיב עליה עכשיו. ענה רק על ההודעה הנוכחית.',
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
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '').trim() }],
    }))
    .filter((entry) => entry.parts[0].text);
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

  const claimsCompletedRegistration = /כבר\s+רשו(?:ם|מה|מים|מות)(?:\s|$|[,.!?])/.test(reply);
  const registrationGrounded = successfulCalls.some((call) => resultContainsRegisteredStatus(call.result));
  if (claimsCompletedRegistration && !registrationGrounded) claims.push('registered_status');

  if (/איז(?:ו|ה)[^\n.!?]*כיתה[^\n.!?]*תעד|איז(?:ה|ו)[^\n.!?]*גיל[^\n.!?]*תעד/.test(reply)) {
    claims.push('grade_as_preference');
  }

  return [...new Set(claims)];
}

function functionCallsOf(content) {
  return (content?.parts || [])
    .map((part) => part.functionCall)
    .filter((call) => call && call.name);
}

function textOf(content) {
  return (content?.parts || [])
    .map((part) => String(part.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
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
  const declarations = CUSTOMER_TOOL_DECLARATIONS.filter((d) => allowed.has(d.name));
  const contents = history.filter((entry) => entry?.parts?.[0]?.text);
  const incoming = String(incomingText || '').trim();
  const last = contents[contents.length - 1];
  const currentAlreadyStored = last?.role === 'user'
    && String(last?.parts?.[0]?.text || '').trim() === incoming;
  if (incoming && !currentAlreadyStored) {
    contents.push({ role: 'user', parts: [{ text: incoming }] });
  }

  if (!contents.length) return { text: '', handoff: false, toolsUsed: [], reason: 'empty' };

  const toolsUsed = [];
  const successfulCalls = [];
  const instruction = [systemInstruction, CUSTOMER_TOOL_RULES].filter(Boolean).join('\n\n');
  // Addresses the prompt itself carries (the health form, the site) are as good
  // as a tool's — they were not invented by the model either.
  const allowedUrls = collectUrls(instruction);
  // A previous bot answer may repeat a link it already sent. A customer URL is
  // not trusted merely because it appears in history: otherwise a fake signup
  // address sent by the customer bypasses the invented-link guard.
  for (const entry of history) {
    if (entry?.role === 'model') collectUrls(entry?.parts?.[0]?.text, allowedUrls);
  }

  for (let step = 0; step < maxSteps; step += 1) {
    const { content, error } = await callModel({
      contents,
      systemInstruction: instruction,
      declarations,
      apiKey,
    });
    if (!content) return { text: '', handoff: false, toolsUsed, reason: error || 'model_error' };

    const calls = functionCallsOf(content);
    if (!calls.length) {
      const raw = textOf(content);
      const handoff = /^HANDOFF\b/i.test(raw);
      // The older prompt taught the model to prefix UNSURE as well; either
      // marker must be stripped so a customer never reads it.
      const unsure = !handoff && /^UNSURE\b/i.test(raw);
      const text = whatsappifyMarkdown(raw.replace(/^(?:HANDOFF|UNSURE)\s*/i, ''));

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
      if (unbacked.includes('grade_as_preference')) {
        console.error('bot treated a factual grade as a preference');
        return {
          text: 'באיזו כיתה הילד/ה לומד/ת כיום?',
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
          text: 'רגע — אני רוצה לוודא את מצב ההרשמה מול הצוות כדי לא למסור לכם מידע שגוי 🙏\nמישהו יחזור אליכם.',
          handoff: true,
          unsure: false,
          toolsUsed,
          reason: 'unverified_registration',
        };
      }
      if (unbacked.length) {
        console.error(`bot claimed an action without a successful tool: ${unbacked.join(', ')}`);
        return {
          text: 'רגע — אני לא רואה שהפעולה נקלטה במערכת, ואני לא רוצה לאשר משהו שלא קרה 🙏\nמעביר לצוות ומישהו יחזור אליכם.',
          handoff: true,
          unsure: false,
          toolsUsed,
          reason: 'unverified_action',
        };
      }

      return { text, handoff, unsure, toolsUsed, reason: 'ok' };
    }

    contents.push(content);
    const responseParts = [];
    for (const call of calls) {
      const tool = allowed.has(call.name) ? tools[call.name] : null;
      if (!tool) {
        responseParts.push({
          functionResponse: { name: call.name, response: { error: 'אין כלי כזה' } },
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

  // Out of steps: better to say nothing here and let the caller fall back.
  return { text: '', handoff: false, toolsUsed, reason: 'max_steps' };
}
