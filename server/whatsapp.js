import { db, persistCore, syncBotFlagFromRemote } from './db.js';
import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';
import { buildTemplateParameters } from './channels/templates.js';
import { automationsService } from './automations.js';
import { israelClockParts, isBotEnabled, shouldAiAutoReply } from './whatsappSchedule.js';
import {
  mergeBotSettings,
  normalizeMenuChoice,
  decideBotGate,
  pauseBotForPhone,
  optOutPhone,
  clearBotPause,
  markOutsideHoursSent,
  shouldSendOutsideHoursMessage,
  advanceLeadCapture,
  shouldStartLeadCapture,
  getIntake,
  setIntake,
  clipReply,
  sleep,
  buildAiExtraContext,
  parseAiReply,
  detectUnsureHeuristic,
  interactiveMenuPayload,
  studentsForParent,
  findPrimaryParent,
  DEFAULT_BOT_SETTINGS,
} from './whatsappBot.js';

export { israelClockParts, isBotEnabled, shouldAiAutoReply };

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

function formatWaPhone(phone) {
  return normalizeWaPhone(phone);
}

const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];

/** Strip day/time suffixes already shown separately (e.g. "— יום א׳ 15:30"). */
function cleanGroupTitle(group) {
  let name = String(group.name || '').trim();
  name = name.replace(/\s*[—–\-]\s*יום\s*[א-ו]['׳']?\s*\d{1,2}:\d{2}.*$/u, '');
  name = name.replace(/\s+יום\s*[א-ו]['׳']?\s*\d{1,2}:\d{2}.*$/u, '');
  name = name.replace(/\s+/g, ' ').trim();
  return name || String(group.ageCategory || '').trim() || 'חוג טיפוס';
}

/** Compact line for AI/CRM context (not WhatsApp customers). */
function formatGroupLine(group) {
  const dayLabel = DAY_NAMES[Number(group.day)] || `יום ${group.day}`;
  const priceBits = [];
  if (Number(group.priceWeek) > 0) priceBits.push(`שבועי ₪${group.priceWeek}`);
  if (Number(group.priceTwice) > 0) priceBits.push(`פעמיים ₪${group.priceTwice}`);
  const prices = priceBits.length ? priceBits.join(' / ') : 'מחיר לפי פנייה';
  return `• ${cleanGroupTitle(group)} | יום ${dayLabel} ${group.time || ''} | ${group.ageCategory || ''} | ${prices}`;
}

function extractGradeLetter(text) {
  const m = String(text || '').match(/כית(?:ה|ות)?\s*([א-ו])['׳']?/i);
  return m?.[1] || '';
}

function asksAboutPrices(text) {
  const t = String(text || '').toLowerCase();
  return /מחיר|כמה עולה|עלות|מנוי|כסף|₪|שקל/.test(t);
}

/** Customer-facing schedule: group times by day, no prices unless requested. */
function formatClassesWhatsAppReply(groups, incomingText = '', { includePrices = false } = {}) {
  const sorted = [...(groups || [])].sort(
    (a, b) => Number(a.day) - Number(b.day) || String(a.time || '').localeCompare(String(b.time || ''))
  );
  if (!sorted.length) {
    return 'היי! 🧗 כרגע אין לי קבוצות מתאימות במערכת.\nכתבו את כיתת הילד/ה ונחזור אליכם 📱';
  }

  const byDay = new Map();
  for (const g of sorted) {
    const day = Number(g.day);
    const time = String(g.time || '').trim();
    if (Number.isNaN(day) || !time) continue;
    if (!byDay.has(day)) byDay.set(day, new Set());
    byDay.get(day).add(time);
  }

  const dayBlocks = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, times]) => {
      const dayLabel = DAY_NAMES[day] || String(day);
      const timesSorted = [...times].sort((a, b) => a.localeCompare(b));
      return `📅 יום ${dayLabel}\n${timesSorted.join(' / ')}`;
    });

  if (!dayBlocks.length) {
    return 'היי! 🧗 כרגע אין שעות מתאימות במערכת.\nכתבו את כיתת הילד/ה ונחזור אליכם 📱';
  }

  const grade = extractGradeLetter(incomingText);
  const header = grade
    ? `היי! 🧗 לכיתה ${grade}׳ יש אצלנו:`
    : 'היי! 🧗 אלה השעות הרלוונטיות:';

  let reply = `${header}\n\n${dayBlocks.join('\n\n')}`;
  if (includePrices) {
    reply += '\n\n💰 מחיר חוג שבועי בדרך כלל ₪280–₪305 (לפי גיל)';
  }
  reply += '\n\nרוצים שנשמור מקום או שנחזור אליכם?\nכתבו שם הילד ומספר טלפון 📱';
  return reply;
}

/** Live CRM snapshot injected into the AI prompt / heuristic replies */
function buildCrmBotContext(settings = {}, { phone, parent, students } = {}) {
  const s = mergeBotSettings(settings);
  const groups = (db.get('groups') || [])
    .slice()
    .sort((a, b) => String(a.ageCategory || '').localeCompare(String(b.ageCategory || ''), 'he')
      || Number(a.day) - Number(b.day)
      || String(a.time || '').localeCompare(String(b.time || '')));

  const groupLines = groups.length
    ? groups.map(formatGroupLine).join('\n')
    : 'אין כרגע קבוצות במערכת.';

  const extra = phone
    ? buildAiExtraContext(s, phone, parent, students || [])
    : [
      '## פרטי עסק',
      s.aiBusinessFacts || '',
      '',
      '## בסיס ידע / שאלות נפוצות',
      s.aiKnowledgeBase || '',
      '',
      '## נושאים אסורים',
      s.aiForbiddenTopics || '',
    ].join('\n');

  return {
    groups,
    text: `## נתונים חיים ממערכת ה-CRM (השתמש רק בהם לתשובות על חוגים/זמנים/מחירים)
${s.aiBusinessFacts || ''}

### קבוצות חוגים פעילות (${groups.length}):
${groupLines}

### כללים לתשובה לפי נתונים
- אם שאלו על כיתה/גיל — הצג רק קבוצות רלוונטיות מהרשימה.
- פורמט בוואטסאפ: קבץ שעות לפי יום בלבד, למשל:
📅 יום א׳
15:30 / 17:30
- אל תציג מחירים אלא אם הלקוח שאל במפורש על מחיר/עלות.
- בלי שם קבוצה, בלי קטגוריה, בלי מקומות פנויים.
- אל תמציא קבוצות שלא מופיעות.
- אם אין התאמה מדויקת — אמור זאת + בקש שם וטלפון לחזרה.

${extra}`,
  };
}

function groupMatchesGradeLetter(group, letter) {
  // Prefer ageCategory; ignore "יום ג׳" in names so weekday letters don't match grades.
  const category = String(group.ageCategory || '');
  const name = String(group.name || '').replace(/יום\s*[א-ו]['׳']?/g, ' ');
  const re = new RegExp(`(^|[^א-ת])${letter}['׳']?(?:\\s*[-–]\\s*[א-ו]['׳']?)?(?=[^א-ת]|$)`);
  return re.test(category) || re.test(name);
}

function findGroupsForText(text) {
  const groups = db.get('groups') || [];
  const t = String(text || '');
  const gradeMatch = t.match(/כית(?:ה|ות)?\s*([א-ו])['׳']?/i)
    || t.match(/([א-ו])['׳']?\s*[-–]\s*([א-ו])['׳']?/i);
  if (!gradeMatch) {
    if (/חוג|קבוצ|שיעור|רישום|אימון|אימונ/.test(t)) return groups.slice(0, 8);
    return [];
  }
  const letter = gradeMatch[1];
  const matched = groups.filter((g) => groupMatchesGradeLetter(g, letter));
  return matched.length ? matched : groups.filter((g) => {
    const hay = `${g.name || ''} ${g.ageCategory || ''}`;
    return hay.includes(`${letter}'`) || hay.includes(`${letter}׳`) || hay.includes(`${letter}-`);
  });
}

function buildHeuristicReply(incomingText, settings = {}) {
  const s = mergeBotSettings(settings);
  const raw = String(incomingText || '').trim();
  const text = raw.toLowerCase();
  const menuPick = normalizeMenuChoice(raw);

  const healthUrl = (s.aiBusinessFacts || '').match(/https?:\/\/\S+health\S*/i)?.[0]
    || 'https://client-omega-topaz-35.vercel.app/health';
  const healthReply = `היי! ✍️\nהנה קישור להצהרת הבריאות:\n${healthUrl}\n\nאחרי החתימה המערכת מתעדכנת אוטומטית 🧗`;
  const matchedGroups = findGroupsForText(raw);
  const sourceGroups = matchedGroups.length ? matchedGroups : (db.get('groups') || []).slice(0, 12);
  const wantsPrices = asksAboutPrices(raw) || menuPick === '2';
  const classesReply = formatClassesWhatsAppReply(sourceGroups, raw, { includePrices: wantsPrices });
  const classesReplyNeedsGrade = !matchedGroups.length
    ? `${formatClassesWhatsAppReply(sourceGroups, raw, { includePrices: wantsPrices })}\n\nכדי לדייק יותר — מהי כיתת הילד/ה?`
    : classesReply;
  const pricesReply = 'היי! 💰 מחירון קצר:\n\n🎟️ כניסה חד־פעמית — ₪50\n🔟 כרטיסייה 10 כניסות — ₪450\n🗓️ מנוי חודשי — ₪280\n🧗 חוג שבועי — ₪280–₪305 (לפי גיל)\n\nנשמח לתאם אימון היכרות!';
  const hoursReply = '🕐 שעות פעילות My Wall:\n\n📅 א׳–ה׳ · 14:00–22:00\n📅 שישי · 09:00–15:00\n📅 שבת · סגור';
  const locationReply = '📍 אנחנו ברחוב האורגים 12, אשדוד\n🅿️ יש חניה בחזית\nנתראה על הקיר! 🧗';
  const defaultMenu = s.aiGreetingMenu || DEFAULT_BOT_SETTINGS.aiGreetingMenu;

  if (menuPick === '4') {
    return { text: s.aiHandoffAckMessage, confidence: 'high', handoff: true };
  }

  if (menuPick === '1' || text.includes('צהר') || text.includes('טופס') || text.includes('בריאות') || text.includes('חתמ')) {
    return { text: healthReply, confidence: 'high' };
  }

  const scheduleIntent =
    menuPick === '2'
    || /כית/.test(raw)
    || text.includes('מתי')
    || text.includes('איזה יום')
    || text.includes('באיזה יום')
    || text.includes('קבוצ')
    || text.includes('שיעור')
    || text.includes('רישום')
    || text.includes('להירשם')
    || text.includes('אימון')
    || text.includes('אימונ')
    || (text.includes('חוג') && !asksAboutPrices(raw));

  // "כמה עולה חוג?" → מחירון בלבד. מחיר+כיתה/מתי → מערכת שעות + מחיר קצר.
  if (asksAboutPrices(raw) && !scheduleIntent && menuPick !== '2') {
    return { text: pricesReply, confidence: 'high' };
  }

  if (scheduleIntent) {
    return { text: classesReplyNeedsGrade, confidence: 'high', startIntake: menuPick === '2' };
  }

  if (asksAboutPrices(raw)) {
    return { text: pricesReply, confidence: 'high' };
  }

  if (menuPick === '3' || text.includes('שע') || text.includes('מתי פתוח') || text.includes('פתיח') || text.includes('מתי אתם פתוחים')) {
    return { text: `${hoursReply}\n\n${locationReply}`, confidence: 'high' };
  }

  if (text.includes('מיקום') || text.includes('איפה') || text.includes('כתובת') || text.includes('הוראות הגעה')) {
    return { text: locationReply, confidence: 'high' };
  }

  return { text: defaultMenu, confidence: 'low' };
}

function formatClassesForGrade(gradeText) {
  const groups = findGroupsForText(`כיתה ${gradeText}`);
  if (!groups.length) return '';
  return formatClassesWhatsAppReply(groups, `כיתה ${gradeText}`, { includePrices: false });
}

async function callGeminiReply(systemPrompt, crmText, incomingText, apiKey, settings = {}) {
  const s = mergeBotSettings(settings);
  const healthUrl = (s.aiBusinessFacts || '').match(/https?:\/\/\S+health\S*/i)?.[0]
    || 'https://client-omega-topaz-35.vercel.app/health';
  const models = [
    process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-flash-latest',
  ];
  let lastError = '';
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `${systemPrompt}

${crmText}

הערה חשובה: אם הלקוח כותב רק 1 / 2 / 3 / 4 זה בחירה מתפריט:
1 = קישור להצהרת בריאות (${healthUrl})
2 = הרשמה ומחירי חוגים (ענה מתוך רשימת הקבוצות למעלה)
3 = שעות פעילות ומיקום
4 = העברה לצוות אנושי

מגבלת אורך תשובה: עד ${s.aiMaxReplyChars || 700} תווים.
אם אינך בטוח — התחל את התשובה במילה UNSURE.

הודעת לקוח: "${incomingText}"
תשובה קצרה ומנומסת של הבוט, עם נתונים מהרשימה בלבד:`
            }]
          }]
        })
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        lastError = `${model}: HTTP ${response.status} ${errBody.slice(0, 160)}`;
        continue;
      }
      const data = await response.json();
      const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (responseText?.trim()) return responseText.trim();
      lastError = `${model}: empty candidates`;
    } catch (err) {
      lastError = `${model}: ${err.message}`;
    }
  }
  if (lastError) console.error('Gemini API call failed, falling back to heuristics:', lastError);
  return null;
}

// Call Meta WhatsApp Cloud API
async function callMetaWhatsAppAPI(phone, payload) {
  const settings = db.getSettings();
  const phoneId = String(process.env.META_WA_PHONE_NUMBER_ID || settings.metaWaPhoneId || '').trim();
  const token = String(process.env.META_WA_ACCESS_TOKEN || settings.metaWaAccessToken || '').trim();

  if (!phoneId || phoneId.includes('YOUR_PHONE_NUMBER_ID') || !token || token.includes('YOUR_META_WA_ACCESS_TOKEN')) {
    console.log(`[WhatsApp Mock Mode] Sending to ${phone}:`, JSON.stringify(payload, null, 2));
    return { mock: true, status: 'sent', messageId: `mock_wa_${Date.now()}` };
  }

  const formattedPhone = formatWaPhone(phone);

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneId}/messages`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: formattedPhone,
        ...payload
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const metaMessage = data.error?.message || 'Meta API error';
      const metaCode = data.error?.code;
      const metaType = data.error?.type;
      console.error(
        `❌ Meta WhatsApp API failed for ${phone}:`,
        metaMessage,
        `| code=${metaCode || '?'} type=${metaType || '?'}`,
        `| tokenLen=${token.length} phoneId=${phoneId} token=${token.slice(0, 6)}…${token.slice(-4)}`
      );
      throw new Error(metaMessage);
    }
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    if (!String(error.message || '').includes('Authentication Error') && !String(error.message || '').includes('Meta')) {
      console.error(`❌ Meta WhatsApp API failed for ${phone}:`, error.message);
    }
    throw error;
  }
}

export const whatsappService = {
  // Send a custom text message
  sendTextMessage: async (phone, text, isAi = false, options = {}) => {
    const settings = mergeBotSettings(db.getSettings());
    let body = String(text || '');
    if (isAi || options.clip !== false) {
      body = clipReply(body, options.maxChars ?? settings.aiMaxReplyChars);
    }
    if (isAi && !options.skipDelay) {
      await sleep(options.delayMs ?? settings.aiReplyDelayMs);
    }
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'text',
        text: { body }
      });

      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: body,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: isAi,
        source: options.source || (isAi ? 'ai' : 'crm'),
        meta_message_id: result.messageId || null,
      });

      return { success: true, text: body, messageId: result.messageId };
    } catch (error) {
      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: body,
        status: 'failed',
        is_ai: isAi,
        source: options.source || (isAi ? 'ai' : 'crm'),
      });
      return { success: false, error: error.message };
    }
  },

  sendInteractiveMenu: async (phone, settings) => {
    const payload = interactiveMenuPayload(settings);
    try {
      const result = await callMetaWhatsAppAPI(phone, payload);
      const preview = mergeBotSettings(settings).aiGreetingMenu || DEFAULT_BOT_SETTINGS.aiGreetingMenu;
      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: preview,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: true,
        source: 'ai',
        message_type: 'interactive',
        meta_message_id: result.messageId || null,
      });
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Interactive menu failed, falling back to text:', error.message);
      return { success: false, error: error.message };
    }
  },

  // Send a template message
  sendTemplateMessage: async (phone, templateName, variables = [], options = {}) => {
    try {
      const localTpl = (db.get('message_templates') || []).find(
        (t) => (t.meta_name || t.name) === templateName
      );
      const isEnglishTemplate = ['hello_world', 'jaspers_market_order_confirmation'].includes(templateName)
        || String(localTpl?.language || '').toLowerCase().startsWith('en');
      const language = options.language
        || localTpl?.language
        || (isEnglishTemplate ? 'en_US' : 'he');
      const payload = {
        type: 'template',
        template: {
          name: templateName,
          language: { code: language }
        }
      };

      const parameters = buildTemplateParameters(
        localTpl || { body: '' },
        Array.isArray(variables) ? variables : [],
        options.fallbackName || ''
      );
      // If no local template metadata, only send params when explicitly provided
      // and non-empty — avoids #132000 on zero-param templates.
      const finalParams = localTpl
        ? parameters
        : (Array.isArray(variables) && variables.length
          ? variables.map((v) => ({ type: 'text', text: String(v) }))
          : []);

      const components = [];
      if (finalParams.length > 0) {
        components.push({
          type: 'body',
          parameters: finalParams,
        });
      }

      // Dynamic URL button suffix (e.g. payment id for /r/{{1}})
      const buttonParams = Array.isArray(options.buttonUrlParams)
        ? options.buttonUrlParams
        : (options.buttonUrlParam != null ? [options.buttonUrlParam] : []);
      buttonParams.forEach((suffix, index) => {
        if (suffix == null || String(suffix).trim() === '') return;
        components.push({
          type: 'button',
          sub_type: 'url',
          index: String(index),
          parameters: [{ type: 'text', text: String(suffix) }],
        });
      });

      if (components.length > 0) {
        payload.template.components = components;
      }

      const result = await callMetaWhatsAppAPI(phone, payload);

      // Render simple text preview for logs
      let logMessage = `[תבנית: ${templateName}]`;
      if (localTpl?.body) {
        let preview = localTpl.body;
        finalParams.forEach((p, i) => {
          const key = p.parameter_name || String(i + 1);
          preview = preview.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), p.text);
        });
        logMessage = preview;
      } else if (templateName === 't1') logMessage = `שלום! ברוכים הבאים לקיר הטיפוס My Wall 🧗‍♂️`;
      else if (templateName === 't2') logMessage = `שלום, בבקשה מלאו את הצהרת הבריאות לפני הגעתכם: https://client-omega-topaz-35.vercel.app/health`;
      else if (templateName === 't3') logMessage = `שלום, תזכורת: שיעור שלכם מחר. נתראה!`;
      else if (templateName === 't4') logMessage = `שלום, לסיום תהליך הרשמה בבקשה שלמו את אימון ההכירות בקליק: https://app.icount.co.il/m/9a79f`;

      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        template_id: templateName,
        source: 'crm',
        meta_message_id: result.messageId || null,
        parent_id: options.parentId || null,
      });

      return { success: true, message: logMessage, messageId: result.messageId || null };
    } catch (error) {
      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: `[נכשל בשליחת תבנית: ${templateName}]`,
        status: 'failed',
        template_id: templateName,
        source: 'crm',
        parent_id: options.parentId || null,
      });
      return { success: false, error: error.message };
    }
  },

  sendImageMessage: async (phone, mediaId, caption = '', options = {}) => {
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'image',
        image: {
          id: mediaId,
          ...(caption ? { caption } : {}),
        },
      });
      const logMessage = caption ? `📷 ${caption}` : '📷 תמונה';
      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        source: 'crm',
        meta_message_id: result.messageId || null,
        message_type: 'image',
        media_url: mediaId,
        parent_id: options.parentId || null,
      });
      return { success: true, message: logMessage, messageId: result.messageId || null };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Generate automated AI response
  generateAIResponse: async (incomingText, context = {}) => {
    const settings = mergeBotSettings(db.getSettings());
    const phone = context.phone || '';
    const parent = context.parent || (phone ? findPrimaryParent(phone) : null);
    const students = context.students || (parent ? studentsForParent(parent) : []);

    const quick = buildHeuristicReply(incomingText, settings);
    if (quick.handoff) {
      return { text: quick.text, handoff: true, confidence: 'high' };
    }
    if (quick.confidence === 'high') {
      return { text: clipReply(quick.text, settings.aiMaxReplyChars), confidence: 'high', startIntake: !!quick.startIntake };
    }

    const systemPrompt = settings.aiSystemPrompt;
    const apiKey = process.env.GEMINI_API_KEY;
    const crm = buildCrmBotContext(settings, { phone, parent, students });

    if (apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE') {
      const geminiText = await callGeminiReply(systemPrompt, crm.text, incomingText, apiKey, settings);
      if (geminiText) {
        const parsed = parseAiReply(geminiText, settings);
        const unsure = parsed.unsure || detectUnsureHeuristic(parsed.text);
        if (unsure && settings.aiEscalateWhenUnsure) {
          return {
            text: parsed.text || settings.aiUnsureReply,
            handoff: true,
            unsure: true,
            confidence: 'low',
          };
        }
        return { text: parsed.text, confidence: 'medium', unsure };
      }
    }

    if (settings.aiEscalateWhenUnsure && quick.confidence === 'low') {
      // Still return the greeting menu — not an escalation for unknown small talk
      return { text: clipReply(quick.text, settings.aiMaxReplyChars), confidence: 'low' };
    }

    return { text: clipReply(quick.text, settings.aiMaxReplyChars), confidence: quick.confidence || 'low' };
  },

  async sendBotReply(phone, replyText, { isSimulator = false, source = 'ai' } = {}) {
    if (!replyText) return { success: false };
    if (isSimulator) {
      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: replyText,
        status: 'sent',
        is_ai: true,
        source,
      });
      return { success: true, text: replyText };
    }
    return whatsappService.sendTextMessage(phone, replyText, true, { source });
  },

  // Process incoming messages (webhook entrypoint / simulator)
  handleIncomingMessage: async (phone, text, isSimulator = false, meta = {}) => {
    if (!isSimulator) await syncBotFlagFromRemote();
    const normalizedPhone = formatWaPhone(phone) || phone;

    const existingLogs = db.get('whatsapp_logs') || [];
    if (
      meta.messageId
      && existingLogs.some((log) => (
        log.direction === 'inbound'
        && log.meta_message_id === meta.messageId
      ))
    ) {
      return {
        parent: findPrimaryParent(normalizedPhone),
        student: null,
        isNew: false,
        replied: false,
        skippedReason: 'duplicate',
      };
    }

    // 1. Log inbound message
    db.insert('whatsapp_logs', {
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: 'inbound',
      message: text,
      status: 'received',
      source: 'customer',
      meta_message_id: meta.messageId || null,
      message_type: meta.type || 'text',
    });

    // 2. Upsert lead / client details in DB (source=whatsapp, status=lead_new)
    const { parent: createdParent, student, isNew } = await db.createLeadFromWhatsApp(normalizedPhone, text);

    // Open / refresh 24h window on EVERY parent row that shares this phone
    const rawTimestamp = Number(meta.timestamp);
    const inboundAt = Number.isFinite(rawTimestamp) && rawTimestamp > 0
      ? new Date(rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000).toISOString()
      : new Date().toISOString();
    const phoneMatches = (db.get('parents') || []).filter((p) => phonesMatch(p.phone, normalizedPhone));
    for (const match of phoneMatches) {
      const updatedParent = db.update('parents', match.id, {
        last_inbound_whatsapp: inboundAt,
        channel: match.channel === 'phone' ? 'whatsapp' : (match.channel || 'whatsapp'),
      });
      if (updatedParent) await persistCore('parents', updatedParent);
    }

    let parent = findPrimaryParent(normalizedPhone) || createdParent;
    let students = studentsForParent(parent);
    const settings = mergeBotSettings(db.getSettings());

    // 3. Welcome template + automations only while the bot is enabled
    if (isBotEnabled(settings) && isNew) {
      try {
        await whatsappService.sendTemplateMessage(normalizedPhone, 't1', [parent.name || '']);
      } catch (err) {
        console.error('Failed to send WhatsApp welcome t1:', err.message);
      }
      try {
        automationsService.triggerEvent('new_lead', student || {
          id: parent.id,
          parentId: parent.id,
          phone: normalizedPhone,
          parentName: parent.name,
          status: parent.status || 'lead_new',
          source: 'whatsapp',
        });
      } catch (err) {
        console.error('Failed to trigger new_lead automation:', err.message);
      }
    }

    if (!text) {
      return { parent, student, isNew, replied: false, skippedReason: 'empty' };
    }

    // 4. Bot decision gates
    const gate = decideBotGate(settings, parent, students, text, { isSimulator });

    if (gate.action === 'reactivate') {
      await optOutPhone(normalizedPhone, false);
      await clearBotPause(normalizedPhone);
      parent = findPrimaryParent(normalizedPhone) || parent;
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'reactivated' };
    }

    if (gate.action === 'opt_out') {
      await optOutPhone(normalizedPhone, true);
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'opt_out' };
    }

    if (gate.action === 'silence') {
      console.log(`🤖 Bot silence (${gate.reason}) for ${normalizedPhone}`);
      return { parent, student, isNew, replied: false, skippedReason: gate.reason };
    }

    if (gate.action === 'outside_hours') {
      if (isSimulator || shouldSendOutsideHoursMessage(parent)) {
        await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
        if (!isSimulator) await markOutsideHoursSent(normalizedPhone);
        return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'outside_hours' };
      }
      return { parent, student, isNew, replied: false, skippedReason: 'outside_hours' };
    }

    if (gate.action === 'handoff') {
      await pauseBotForPhone(normalizedPhone, gate.pauseMinutes || settings.aiPauseMinutesAfterHuman, { reason: 'handoff' });
      await whatsappService.sendBotReply(normalizedPhone, gate.reply, { isSimulator, source: 'bot_control' });
      return { parent, student, isNew, replied: true, reply: gate.reply, reason: 'handoff' };
    }

    // Active intake
    if (gate.action === 'intake' || (getIntake(parent)?.step && getIntake(parent).step !== 'done')) {
      const intakeResult = await advanceLeadCapture(normalizedPhone, parent, text, { formatClassesForGrade });
      if (intakeResult.reply) {
        await whatsappService.sendBotReply(normalizedPhone, intakeResult.reply, { isSimulator });
        return { parent: findPrimaryParent(normalizedPhone) || parent, student, isNew, replied: true, reply: intakeResult.reply, reason: 'intake' };
      }
    }

    // Start intake for new/incomplete leads (after menu 2 or missing details)
    if (shouldStartLeadCapture(settings, parent, students, text, { isNew })) {
      const choice = normalizeMenuChoice(text);
      // If they just picked "2", acknowledge classes briefly then start intake
      if (choice === '2') {
        const quick = buildHeuristicReply(text, settings);
        if (quick.text) {
          await whatsappService.sendBotReply(normalizedPhone, quick.text, { isSimulator });
        }
      }
      await setIntake(normalizedPhone, { step: 'parent_name', asked: false });
      parent = findPrimaryParent(normalizedPhone) || parent;
      const intakeResult = await advanceLeadCapture(normalizedPhone, parent, '', { formatClassesForGrade });
      if (intakeResult.reply) {
        await whatsappService.sendBotReply(normalizedPhone, intakeResult.reply, { isSimulator });
        return {
          parent: findPrimaryParent(normalizedPhone) || parent,
          student,
          isNew,
          replied: true,
          reply: `${choice === '2' ? '' : ''}${intakeResult.reply}`,
          reason: 'intake_start',
        };
      }
    }

    // Interactive greeting for brand-new leads with low-intent first message
    const aiResult = await whatsappService.generateAIResponse(text, { phone: normalizedPhone, parent, students });
    if (aiResult.handoff) {
      await pauseBotForPhone(normalizedPhone, settings.aiPauseMinutesAfterHuman, { reason: 'handoff' });
      await whatsappService.sendBotReply(normalizedPhone, aiResult.text || settings.aiHandoffAckMessage, {
        isSimulator,
        source: 'bot_control',
      });
      return { parent, student, isNew, replied: true, reply: aiResult.text, reason: 'handoff' };
    }

    let replyText = aiResult.text;
    if (
      isNew
      && settings.aiInteractiveMenuEnabled
      && !isSimulator
      && aiResult.confidence === 'low'
    ) {
      const interactive = await whatsappService.sendInteractiveMenu(normalizedPhone, settings);
      if (interactive.success) {
        return { parent, student, isNew, replied: true, reply: settings.aiGreetingMenu, reason: 'interactive_menu' };
      }
      replyText = settings.aiGreetingMenu || replyText;
    }

    await whatsappService.sendBotReply(normalizedPhone, replyText, { isSimulator });
    return { parent, student, isNew, replied: true, reply: replyText };
  },

  // Messages sent from WhatsApp Business app (Coexistence echoes)
  handlePhoneEcho: async ({ phone, text, messageId, type } = {}) => {
    const normalizedPhone = formatWaPhone(phone) || phone;
    if (!normalizedPhone) return { skipped: true };

    const logs = db.get('whatsapp_logs') || [];
    if (messageId && logs.some(l => l.meta_message_id === messageId)) {
      return { skipped: true, reason: 'duplicate' };
    }

    db.insert('whatsapp_logs', {
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: 'outbound',
      message: text || '[הודעה מהטלפון]',
      status: 'sent',
      source: 'phone',
      meta_message_id: messageId || null,
      message_type: type || 'text',
    });

    // Ensure parent exists so the thread shows under a lead card
    db.upsertParentByPhone('לקוח וואטסאפ', normalizedPhone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
    });

    const settings = mergeBotSettings(db.getSettings());
    if (settings.aiPauseOnHumanReply) {
      await pauseBotForPhone(normalizedPhone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
    }

    return { success: true, phone: normalizedPhone };
  },

  // Initial history sync payloads from Coexistence onboarding
  handleHistoryMessage: async ({ phone, text, direction, messageId, timestamp, type } = {}) => {
    const normalizedPhone = formatWaPhone(phone) || phone;
    if (!normalizedPhone || !text) return { skipped: true };

    const logs = db.get('whatsapp_logs') || [];
    if (messageId && logs.some(l => l.meta_message_id === messageId)) {
      return { skipped: true, reason: 'duplicate' };
    }

    const resolvedDirection = direction === 'inbound' ? 'inbound' : 'outbound';

    const createdAt = timestamp
      ? new Date(Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000).toISOString()
      : new Date().toISOString();

    db.insert('whatsapp_logs', {
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: resolvedDirection,
      message: text,
      status: 'synced',
      source: resolvedDirection === 'outbound' ? 'phone' : 'customer',
      meta_message_id: messageId || null,
      message_type: type || 'text',
      created_at: createdAt,
    });

    db.upsertParentByPhone('לקוח וואטסאפ', normalizedPhone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
    });

    if (resolvedDirection === 'inbound') {
      const phoneMatches = (db.get('parents') || []).filter((p) => phonesMatch(p.phone, normalizedPhone));
      for (const match of phoneMatches) {
        const handledTime = Date.parse(match.communication_handled_at || '');
        const historyTime = Date.parse(createdAt);
        const communicationHandledAt = new Date(
          Math.max(
            Number.isFinite(handledTime) ? handledTime : 0,
            Number.isFinite(historyTime) ? historyTime : 0
          )
        ).toISOString();
        const updatedParent = db.update('parents', match.id, {
          last_inbound_whatsapp: createdAt,
          communication_handled_at: communicationHandledAt,
          channel: match.channel === 'phone' ? 'whatsapp' : (match.channel || 'whatsapp'),
        });
        if (updatedParent) persistCore('parents', updatedParent).catch(() => {});
      }
    }

    return { success: true };
  },

  replyFromCrm: async (phone, text) => {
    if (!phone) return { success: false, error: 'חסר מספר טלפון' };
    if (!text || !String(text).trim()) return { success: false, error: 'חסר תוכן הודעה' };
    const result = await whatsappService.sendTextMessage(phone, String(text).trim(), false);
    if (result.success) {
      const settings = mergeBotSettings(db.getSettings());
      if (settings.aiPauseOnHumanReply) {
        await pauseBotForPhone(phone, settings.aiPauseMinutesAfterHuman, { reason: 'human_reply' });
      }
    }
    return result;
  },

  getLogsForPhone: (phone) => {
    const logs = db.get('whatsapp_logs') || [];
    return logs
      .filter(l => (l.channel || 'whatsapp') === 'whatsapp' && phonesMatch(l.phone || l.to || l.from, phone))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  },
};

function getInstagramToken() {
  const settings = db.getSettings();
  const token = settings.metaIgAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN || '';
  if (!token || token.includes('YOUR_')) return '';
  return token;
}

// Call Meta Instagram Graph API
// Instagram Login tokens (IGAAT…) must use graph.instagram.com/me/messages.
// Page tokens use graph.facebook.com/{ig-user-id}/messages.
async function callMetaInstagramAPI(recipientId, text) {
  const settings = db.getSettings();
  const token = getInstagramToken();

  if (!token) {
    console.log(`[Instagram Mock Mode] Sending to ${recipientId}: "${text}"`);
    return { mock: true, status: 'sent', messageId: `mock_ig_${Date.now()}` };
  }

  const isIgLoginToken = token.startsWith('IGAAT') || token.startsWith('IGAA');
  const accountId = settings.metaIgAccountId || process.env.META_IG_ACCOUNT_ID || 'me';
  const url = isIgLoginToken
    ? `https://graph.instagram.com/${META_GRAPH_VERSION}/me/messages`
    : `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        access_token: token
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || 'Meta Instagram API error');
    }
    return { success: true, messageId: data.message_id };
  } catch (error) {
    console.error(`❌ Meta Instagram API failed for ${recipientId}:`, error.message);
    throw error;
  }
}

export const instagramService = {
  sendTextMessage: async (recipientId, text, isAi = false) => {
    try {
      const result = await callMetaInstagramAPI(recipientId, text);
      db.insert('whatsapp_logs', {
        phone: recipientId,
        channel: 'instagram',
        direction: 'outbound',
        message: text,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: isAi
      });
      return { success: true, text };
    } catch (error) {
      db.insert('whatsapp_logs', {
        phone: recipientId,
        channel: 'instagram',
        direction: 'outbound',
        message: text,
        status: 'failed',
        is_ai: isAi
      });
      return { success: false, error: error.message };
    }
  },

  handleIncomingMessage: async (igId, text, name = 'ליד מאינסטגרם', isSimulator = false) => {
    if (!isSimulator) await syncBotFlagFromRemote();
    // 1. Log inbound message
    db.insert('whatsapp_logs', {
      phone: igId,
      channel: 'instagram',
      direction: 'inbound',
      message: text,
      status: 'received'
    });

    // 2. Upsert lead / client details in DB
    const { parent, student, isNew } = await db.createLeadFromInstagram(igId, text, name);

    if (parent?.id) {
      const updatedParent = db.update('parents', parent.id, {
        last_inbound_instagram: new Date().toISOString(),
        channel: parent.channel || 'instagram',
      });
      if (updatedParent) await persistCore('parents', updatedParent);
    }

    // 3. Process AI automated reply if active (schedule applies to live traffic)
    const settings = db.getSettings();
    if (shouldAiAutoReply(settings, { ignoreSchedule: isSimulator })) {
      const aiResult = await whatsappService.generateAIResponse(text);
      const aiReply = typeof aiResult === 'string' ? aiResult : aiResult?.text;
      if (!aiReply) {
        return { parent, student, isNew, replied: false };
      }
      const hasRealToken = !!getInstagramToken();
      if (isSimulator || !hasRealToken) {
        // Simulator / missing token: log locally only (no Meta call)
        db.insert('whatsapp_logs', {
          phone: igId,
          channel: 'instagram',
          direction: 'outbound',
          message: aiReply,
          status: 'sent',
          is_ai: true
        });
      } else {
        const sendResult = await instagramService.sendTextMessage(igId, aiReply, true);
        if (!sendResult.success) {
          console.error('❌ Instagram AI reply failed to deliver:', sendResult.error);
        }
      }
      return { parent, student, isNew, replied: true, reply: aiReply };
    }

    return {
      parent,
      student,
      isNew,
      replied: false,
      skippedReason: !settings.aiResponderEnabled
        ? 'disabled'
        : settings.aiActiveHoursEnabled && !isSimulator
          ? 'outside_hours'
          : null,
    };
  }
};

