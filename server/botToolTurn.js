/**
 * One customer turn, driven by the model with tools instead of by keyword
 * matching. Facts come from `botTools`; the model only phrases them.
 *
 * The hard boundaries stay outside this file: the handoff gate in whatsapp.js
 * runs first, and a failed turn falls back to the old heuristic reply.
 */
import { callGeminiChat } from './aiChat.js';
import { CUSTOMER_TOOL_DECLARATIONS, buildCustomerTools } from './botTools.js';

const MAX_TOOL_STEPS = 4;

export const CUSTOMER_TOOL_RULES = [
  '## איך לענות',
  'אתה עונה ללקוח בוואטסאפ בשם העסק. עברית פשוטה, קצר, בלי אנגלית מיותרת.',
  'כל עובדה — שעה, מחיר, מקום פנוי, מדריך, אירוע — מגיעה אך ורק מהכלים. אל תמציא ואל תשער.',
  'אם אין לך את הנתון בכלים, או שהשאלה דורשת אדם (ביטול, החזר, חשבונית, תלונה, פציעה, שכר, מנוי, כרטיסייה, יום הולדת, הנחה) — כתוב בשורה הראשונה HANDOFF ואז משפט טבעי קצר שאתה מעביר לצוות.',
  'שאלה על חוג בלי לדעת למי: אם יש ילדים בכרטיס (getFamilyCard) שאל «בשביל <שם>?» ולא «באיזו כיתה». אם אין — שאל באיזו כיתה או באיזה גיל.',
  'שאלה על מבוגרים או נוער היא על שכבה (בוגרים / תיכון / חטיבה), לא על כיתה.',
  'אל תציע לשמור מקום בשם הילד כשמדובר בקבוצת בוגרים.',
  'אל תחזור על אותה שאלה פעמיים ברצף. אם הלקוח כתב משהו לא ברור — בקש הבהרה קצרה פעם אחת.',
  'מה שכבר נאמר בשיחה — כיתה, שם ילד, יום ושעה — אל תשאל עליו שוב. קרא את ההיסטוריה והשלם ממנה את הפרטים לקריאת הכלי.',
  'אם בכרטיס יש ילד יחיד, זה הילד שמדובר בו — אל תשאל לשמו. שאל רק כשיש כמה ילדים או שאין אף אחד.',
  'אל תבטיח פעולה שאתה לא יכול לבצע (לשריין מקום, לקבוע אימון, לשלוח קישור תשלום). אפשר להציע שהצוות יחזור אליהם.',
  'קישור הרשמה לחוג כן מותר לשלוח — קרא ל-getSignupLink עם הכיתה או השכבה, ואם צריך גם יום ושעה. אם חזרו כמה קבוצות, שאל לאיזו מהן ואל תשלח קישור.',
  'שאלה על הצהרת בריאות או הסרת אחריות: בדוק ב-getHealthDeclarations. למי שאין הצהרה בתוקף — שלח את הקישור למילוי וציין את שם המתאמן. למי שיש — אמור עד מתי היא בתוקף, בלי לשלוח קישור.',
  'הטופס שבקישור הזה הוא שלושה דברים: פרטי המשתתף, הצהרת בריאות והסרת אחריות. אל תתאר אותו כ«הצהרת בריאות» בלבד — זה מטעה את מי שפותח אותו.',
  'בקשה לשלם על ציוד או קישור לתשלום ציוד: קרא ל-getEquipmentPaymentLink. אם הוחזר קישור — שלח אותו עם שם הילד, הפריטים והסכום. אם הוחזרה הערה שאין חוב או שצריך לשאול — פעל לפיה.',
  'לקוח שרוצה להירשם: ודא קודם הצהרת בריאות (getHealthDeclarations). אין הצהרה — שלח את קישור ההצהרה והסבר שהחתימה פותחת את כרטיס המתאמן, ואל תשבץ. יש הצהרה — קרא ל-startSignup לקבוצה שנבחרה, ואם היא מלאה ל-joinWaitlist.',
  'אחרי שיבוץ מוצלח: אמור שהמקום נשמר כ«ממתין להרשמה» עד אישור ההרשמה, ושלח את getRegistrationPack עם הסבר קצר לכל קישור.',
  'אל תבטיח שהילד רשום. רשום = אחרי אישור ההרשמה, וזה מגיע מהצוות.',
  'שאלה על ילד ששמו נזכר — קרא קודם ל-getFamilyCard כדי לראות באיזו קבוצה ובאיזה סטטוס הוא. אל תסיק מ-listClasses שהילד לא קיים.',
  'בקשה להוציא ילד מקבוצה או לבטל שיבוץ: קרא ל-cancelSignup עם שמו. להעביר לקבוצה אחרת: cancelSignup ואז startSignup לקבוצה החדשה.',
  'שיבוץ, העברה וביטול מותרים רק כל עוד המתאמן אינו רשום לחוג. אם כלי החזיר שהוא כבר רשום — זו העברה לצוות, לא ניסיון נוסף ולא ניסוח אחר.',
  'אל תמציא כתובת אינטרנט. קישור נשלח רק אם הוא הוחזר מכלי.',
  'לקוח שמסר את שמו בשיחה («קוראים לי נעמה», «מדברת דנה») — קרא ל-saveCustomerName עם השם, ואז המשך לעניין עצמו.',
  'אל תציע קבוצת נבחרת למי שלא שאל עליה. כשקבוצה חוזרת מכלי עם רמה — מותר לציין את הרמה בתשובה.',
  'הודעה בהיסטוריה שמתחילה ב-[לפני X שעות] או [לפני X ימים] היא שיחה קודמת: אל תגיב עליה עכשיו. ענה רק על ההודעה הנוכחית.',
  'זו וואטסאפ: הדגשה היא בכוכבית אחת (*טקסט*), בלי כוכביות כפולות ובלי כותרות Markdown.',
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
  onPlacement = null,
  apiKey = process.env.GEMINI_API_KEY,
  callModel = callGeminiChat,
  maxSteps = MAX_TOOL_STEPS,
} = {}) {
  const tools = buildCustomerTools({ settings, parent, phone, onPlacement });
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: String(incomingText || '') }] },
  ].filter((entry) => entry?.parts?.[0]?.text);

  if (!contents.length) return { text: '', handoff: false, toolsUsed: [], reason: 'empty' };

  const toolsUsed = [];
  const instruction = [systemInstruction, CUSTOMER_TOOL_RULES].filter(Boolean).join('\n\n');
  // Addresses the prompt itself carries (the health form, the site) are as good
  // as a tool's — they were not invented by the model either.
  const allowedUrls = collectUrls(instruction);
  for (const entry of history) collectUrls(entry?.parts?.[0]?.text, allowedUrls);

  for (let step = 0; step < maxSteps; step += 1) {
    const { content, error } = await callModel({
      contents,
      systemInstruction: instruction,
      declarations: CUSTOMER_TOOL_DECLARATIONS,
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

      return { text, handoff, unsure, toolsUsed, reason: 'ok' };
    }

    contents.push(content);
    const responseParts = [];
    for (const call of calls) {
      const tool = tools[call.name];
      if (!tool) {
        responseParts.push({
          functionResponse: { name: call.name, response: { error: 'אין כלי כזה' } },
        });
        continue;
      }
      try {
        const result = await tool(call.args || {});
        toolsUsed.push(call.name);
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
