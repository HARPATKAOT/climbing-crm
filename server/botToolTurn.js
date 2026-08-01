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
  'אל תבטיח פעולה שאתה לא יכול לבצע (לשריין מקום, לקבוע אימון, לשלוח קישור תשלום). אפשר להציע שהצוות יחזור אליהם.',
  'קישור הרשמה לחוג כן מותר לשלוח — קרא ל-getSignupLink עם הכיתה או השכבה, ואם צריך גם יום ושעה. אם חזרו כמה קבוצות, שאל לאיזו מהן ואל תשלח קישור.',
  'שאלה על הצהרת בריאות או הסרת אחריות: בדוק ב-getHealthDeclarations. למי שאין הצהרה בתוקף — שלח את הקישור למילוי וציין את שם המתאמן. למי שיש — אמור עד מתי היא בתוקף, בלי לשלוח קישור.',
  'בקשה לשלם על ציוד או קישור לתשלום ציוד: קרא ל-getEquipmentPaymentLink. אם הוחזר קישור — שלח אותו עם שם הילד, הפריטים והסכום. אם הוחזרה הערה שאין חוב או שצריך לשאול — פעל לפיה.',
  'אל תמציא כתובת אינטרנט. קישור נשלח רק אם הוא הוחזר מכלי.',
  'זו וואטסאפ: הדגשה היא בכוכבית אחת (*טקסט*), בלי כוכביות כפולות ובלי כותרות Markdown.',
].join('\n');

/**
 * The model writes Markdown by habit; WhatsApp bolds with a single asterisk and
 * shows the rest literally.
 */
export function whatsappifyMarkdown(text) {
  return String(text || '')
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
  apiKey = process.env.GEMINI_API_KEY,
  callModel = callGeminiChat,
  maxSteps = MAX_TOOL_STEPS,
} = {}) {
  const tools = buildCustomerTools({ settings, parent, phone });
  const contents = [
    ...history,
    { role: 'user', parts: [{ text: String(incomingText || '') }] },
  ].filter((entry) => entry?.parts?.[0]?.text);

  if (!contents.length) return { text: '', handoff: false, toolsUsed: [], reason: 'empty' };

  const toolsUsed = [];
  const instruction = [systemInstruction, CUSTOMER_TOOL_RULES].filter(Boolean).join('\n\n');

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
      return {
        text: whatsappifyMarkdown(raw.replace(/^(?:HANDOFF|UNSURE)\s*/i, '')),
        handoff,
        unsure,
        toolsUsed,
        reason: 'ok',
      };
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
