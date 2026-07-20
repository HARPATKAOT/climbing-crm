import { db, persistCore } from './db.js';
import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';
import { buildTemplateParameters } from './channels/templates.js';
import { automationsService } from './automations.js';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

function formatWaPhone(phone) {
  return normalizeWaPhone(phone);
}

/** Current weekday (0=Sunday) and HH:mm in Asia/Jerusalem. */
export function israelClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.find((p) => p.type === 'weekday')?.value] ?? date.getDay();
  let hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // en-US hour12:false can still yield "24" for midnight in some engines
  if (hour === '24') hour = '00';
  return { weekday, time: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` };
}

function parseHm(value, fallback) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Master switch — when off, no automated WhatsApp/Instagram replies are sent. */
export function isBotEnabled(settings = {}) {
  return !!settings.aiResponderEnabled;
}

/** Whether the AI bot should auto-reply right now (Israel time). */
export function shouldAiAutoReply(settings = {}, { ignoreSchedule = false } = {}) {
  if (!isBotEnabled(settings)) return false;
  if (ignoreSchedule || !settings.aiActiveHoursEnabled) return true;

  const { weekday, time } = israelClockParts();
  const days = Array.isArray(settings.aiActiveDays) && settings.aiActiveDays.length
    ? settings.aiActiveDays.map(Number)
    : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(weekday)) return false;

  const start = parseHm(settings.aiActiveHoursStart, '09:00');
  const end = parseHm(settings.aiActiveHoursEnd, '21:00');
  if (start <= end) return time >= start && time < end;
  // Overnight window, e.g. 22:00–06:00
  return time >= start || time < end;
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
function buildCrmBotContext() {
  const groups = (db.get('groups') || [])
    .slice()
    .sort((a, b) => String(a.ageCategory || '').localeCompare(String(b.ageCategory || ''), 'he')
      || Number(a.day) - Number(b.day)
      || String(a.time || '').localeCompare(String(b.time || '')));

  const groupLines = groups.length
    ? groups.map(formatGroupLine).join('\n')
    : 'אין כרגע קבוצות במערכת.';

  return {
    groups,
    text: `## נתונים חיים ממערכת ה-CRM (השתמש רק בהם לתשובות על חוגים/זמנים/מחירים)
כתובת: רחוב האורגים 12, אשדוד
שעות פתיחה כלליות: א׳–ה׳ 14:00–22:00 | שישי 09:00–15:00 | שבת סגור
הצהרת בריאות: https://mywall.co.il/health

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
- אם אין התאמה מדויקת — אמור זאת + בקש שם וטלפון לחזרה.`,
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

function buildHeuristicReply(incomingText) {
  const raw = String(incomingText || '').trim();
  const text = raw.toLowerCase();
  // Menu picks from the default greeting: "1" / "2" / "3"
  const menuPick = text.match(/^[1-3]$/)?.[0]
    || (text.match(/^(?:אופציה|אפשרות|מספר)?\s*[1-3]\b/)?.[0]?.replace(/\D/g, '') || null);

  const healthReply = 'היי! ✍️\nהנה קישור להצהרת הבריאות:\nhttps://mywall.co.il/health\n\nאחרי החתימה המערכת מתעדכנת אוטומטית 🧗';
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
  const defaultMenu = 'היי! אני הבוט של My Wall 🧗\n\nבמה אפשר לעזור?\n1️⃣ הצהרת בריאות ✍️\n2️⃣ חוגים ומחירים 🤸\n3️⃣ שעות ומיקום 🗺️\n\nכתבו מספר או שאלה קצרה 😊';

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
    return { text: classesReplyNeedsGrade, confidence: 'high' };
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

async function callGeminiReply(systemPrompt, crmText, incomingText, apiKey) {
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

הערה חשובה: אם הלקוח כותב רק 1 / 2 / 3 זה בחירה מתפריט:
1 = קישור להצהרת בריאות (https://mywall.co.il/health)
2 = הרשמה ומחירי חוגים (ענה מתוך רשימת הקבוצות למעלה)
3 = שעות פעילות ומיקום

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
  sendTextMessage: async (phone, text, isAi = false) => {
    try {
      const result = await callMetaWhatsAppAPI(phone, {
        type: 'text',
        text: { body: text }
      });

      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: text,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: isAi,
        source: isAi ? 'ai' : 'crm',
        meta_message_id: result.messageId || null,
      });

      return { success: true, text, messageId: result.messageId };
    } catch (error) {
      db.insert('whatsapp_logs', {
        phone: formatWaPhone(phone) || phone,
        channel: 'whatsapp',
        direction: 'outbound',
        message: text,
        status: 'failed',
        source: isAi ? 'ai' : 'crm',
      });
      return { success: false, error: error.message };
    }
  },

  // Send a template message
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

      if (finalParams.length > 0) {
        payload.template.components = [
          {
            type: 'body',
            parameters: finalParams,
          }
        ];
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
      else if (templateName === 't2') logMessage = `שלום, בבקשה מלאו את הצהרת הבריאות לפני הגעתכם: https://mywall.co.il/health`;
      else if (templateName === 't3') logMessage = `שלום, תזכורת: שיעור שלכם מחר. נתראה!`;
      else if (templateName === 't4') logMessage = `שלום, לסיום תהליך הרשמה בבקשה שלמו את אימון ההכירות בקליק: https://checkout.icount.co.il/mywall`;

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
  generateAIResponse: async (incomingText) => {
    // Clear intents (1/2/3, כיתה, אימונים...) answered immediately — don't depend on Gemini.
    const quick = buildHeuristicReply(incomingText);
    if (quick.confidence === 'high') return quick.text;

    const settings = db.getSettings();
    const systemPrompt = settings.aiSystemPrompt;
    const apiKey = process.env.GEMINI_API_KEY;
    const crm = buildCrmBotContext();

    if (apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE') {
      const geminiText = await callGeminiReply(systemPrompt, crm.text, incomingText, apiKey);
      if (geminiText) return geminiText;
    }

    return quick.text;
  },

  // Process incoming messages (webhook entrypoint / simulator)
  handleIncomingMessage: async (phone, text, isSimulator = false, meta = {}) => {
    const normalizedPhone = formatWaPhone(phone) || phone;

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
    const { parent, student, isNew } = await db.createLeadFromWhatsApp(normalizedPhone, text);

    // Open / refresh 24h customer care window
    if (parent?.id) {
      const updatedParent = db.update('parents', parent.id, {
        last_inbound_whatsapp: new Date().toISOString(),
        channel: parent.channel || 'whatsapp',
      });
      if (updatedParent) await persistCore('parents', updatedParent);
    }

    const settings = db.getSettings();

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

    // 4. Process AI automated reply if active (and within schedule for live traffic)
    if (shouldAiAutoReply(settings, { ignoreSchedule: isSimulator }) && text) {
      const aiReply = await whatsappService.generateAIResponse(text);
      if (isSimulator) {
        db.insert('whatsapp_logs', {
          phone: normalizedPhone,
          channel: 'whatsapp',
          direction: 'outbound',
          message: aiReply,
          status: 'sent',
          is_ai: true,
          source: 'ai',
        });
      } else {
        await whatsappService.sendTextMessage(normalizedPhone, aiReply, true);
      }
      return { parent, student, isNew, replied: true, reply: aiReply };
    }

    if (!isBotEnabled(settings)) {
      console.log(`🤖 Bot disabled — skipping auto-reply for ${normalizedPhone}`);
    }

    return {
      parent,
      student,
      isNew,
      replied: false,
      skippedReason: !isBotEnabled(settings)
        ? 'disabled'
        : settings.aiActiveHoursEnabled && !isSimulator
          ? 'outside_hours'
          : null,
    };
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

    db.insert('whatsapp_logs', {
      phone: normalizedPhone,
      channel: 'whatsapp',
      direction: resolvedDirection,
      message: text,
      status: 'synced',
      source: resolvedDirection === 'outbound' ? 'phone' : 'customer',
      meta_message_id: messageId || null,
      message_type: type || 'text',
      created_at: timestamp
        ? new Date(Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000).toISOString()
        : new Date().toISOString(),
    });

    db.upsertParentByPhone('לקוח וואטסאפ', normalizedPhone, '', {
      source: 'whatsapp',
      channel: 'whatsapp',
    });

    return { success: true };
  },

  replyFromCrm: async (phone, text) => {
    if (!phone) return { success: false, error: 'חסר מספר טלפון' };
    if (!text || !String(text).trim()) return { success: false, error: 'חסר תוכן הודעה' };
    return whatsappService.sendTextMessage(phone, String(text).trim(), false);
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
      const aiReply = await whatsappService.generateAIResponse(text);
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

