import { db } from './db.js';

// Call Meta WhatsApp Cloud API
async function callMetaWhatsAppAPI(phone, payload) {
  const settings = db.getSettings();
  const phoneId = settings.metaWaPhoneId || process.env.META_WA_PHONE_NUMBER_ID;
  const token = settings.metaWaAccessToken || process.env.META_WA_ACCESS_TOKEN;

  if (!phoneId || phoneId.includes('YOUR_PHONE_NUMBER_ID') || !token || token.includes('YOUR_META_WA_ACCESS_TOKEN')) {
    console.log(`[WhatsApp Mock Mode] Sending to ${phone}:`, JSON.stringify(payload, null, 2));
    return { mock: true, status: 'sent', messageId: `mock_wa_${Date.now()}` };
  }

  const cleanPhone = phone.replace(/[-\s+]/g, '');
  // Format international number (e.g. 0521234567 -> 972521234567)
  let formattedPhone = cleanPhone;
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '972' + formattedPhone.slice(1);
  }

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
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
      throw new Error(data.error?.message || 'Meta API error');
    }
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (error) {
    console.error(`❌ Meta WhatsApp API failed for ${phone}:`, error.message);
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
        phone,
        direction: 'outbound',
        message: text,
        status: result.mock ? 'sent' : 'delivered',
        is_ai: isAi
      });

      return { success: true, text };
    } catch (error) {
      db.insert('whatsapp_logs', {
        phone,
        direction: 'outbound',
        message: text,
        status: 'failed'
      });
      return { success: false, error: error.message };
    }
  },

  // Send a template message
  sendTemplateMessage: async (phone, templateName, variables = []) => {
    try {
      const isEnglishTemplate = ['hello_world', 'jaspers_market_order_confirmation'].includes(templateName);
      const payload = {
        type: 'template',
        template: {
          name: templateName,
          language: { code: isEnglishTemplate ? 'en_US' : 'he' }
        }
      };

      if (variables.length > 0) {
        payload.template.components = [
          {
            type: 'body',
            parameters: variables.map(v => ({ type: 'text', text: String(v) }))
          }
        ];
      }

      const result = await callMetaWhatsAppAPI(phone, payload);

      // Render simple text preview for logs
      let logMessage = `[תבנית: ${templateName}]`;
      if (templateName === 't1') logMessage = `שלום! ברוכים הבאים לקיר הטיפוס My Wall 🧗‍♂️`;
      else if (templateName === 't2') logMessage = `שלום, בבקשה מלאו את הצהרת הבריאות לפני הגעתכם: https://mywall.co.il/health`;
      else if (templateName === 't3') logMessage = `שלום, תזכורת: שיעור שלכם מחר. נתראה!`;
      else if (templateName === 't4') logMessage = `שלום, לסיום תהליך הרשמה בבקשה שלמו את אימון ההכירות בקליק: https://checkout.icount.co.il/mywall`;

      db.insert('whatsapp_logs', {
        phone,
        direction: 'outbound',
        message: logMessage,
        status: result.mock ? 'sent' : 'delivered',
        template_id: templateName
      });

      return { success: true, message: logMessage };
    } catch (error) {
      db.insert('whatsapp_logs', {
        phone,
        direction: 'outbound',
        message: `[נכשל בשליחת תבנית: ${templateName}]`,
        status: 'failed',
        template_id: templateName
      });
      return { success: false, error: error.message };
    }
  },

  // Generate automated AI response
  generateAIResponse: async (incomingText) => {
    const settings = db.getSettings();
    const systemPrompt = settings.aiSystemPrompt;
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey && apiKey !== 'YOUR_GEMINI_API_KEY_HERE') {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `${systemPrompt}\n\nהודעת לקוח: "${incomingText}"\nתשובה קצרה ומנומסת של הבוט:`
              }]
            }]
          })
        });

        if (response.ok) {
          const data = await response.json();
          const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (responseText) return responseText.trim();
        }
      } catch (err) {
        console.error('Gemini API call failed, falling back to heuristics:', err);
      }
    }

    // Heuristics Fallback Engine
    const text = incomingText.toLowerCase();
    
    if (text.includes('צהר') || text.includes('טופס') || text.includes('בריאות') || text.includes('חתמ')) {
      return 'היי! הנה הקישור לחתימה מהירה על הצהרת הבריאות הדיגיטלית של קיר הטיפוס: https://mywall.co.il/health 🧗‍♂️. לאחר החתימה המערכת תתעדכן אוטומטית.';
    }
    
    if (text.includes('חוג') || text.includes('שיעור') || text.includes('רישום') || text.includes('להירשם')) {
      return 'שלום! אנו מציעים חוגי טיפוס לילדים ולנוער (מכיתה א׳ ועד תיכון) וכן קבוצות בוגרים. כדי שנוכל להתאים את הקבוצה המושלמת עבורכם, מהי כיתת הילד/ה או גיל המטפס/ת? 🤸‍♀️';
    }
    
    if (text.includes('מחיר') || text.includes('כמה עולה') || text.includes('עלות') || text.includes('מנוי')) {
      return 'שלום! מחירי הכניסה והחוגים אצלנו:\n• כניסה חד פעמית: ₪50\n• כרטיסיית 10 כניסות: ₪450\n• מנוי חופשי חודשי: ₪280\n• חוג שבועי (כולל כניסה חופשית): ₪280 - ₪305 בחודש (תלוי בגיל).\nנשמח לתאם אימון הכירות! 💸';
    }
    
    if (text.includes('שע') || text.includes('מתי פתוח') || text.includes('פתיח') || text.includes('מתי אתם פתוחים')) {
      return 'שעות הפעילות של קיר הטיפוס My Wall הן:\n• ימים א׳ - ה׳: 14:00 - 22:00\n• ימי שישי: 09:00 - 15:00\n• ימי שבת: סגור.\nנשמח לראותכם!';
    }
    
    if (text.includes('מיקום') || text.includes('איפה') || text.includes('כתובת') || text.includes('הוראות הגעה')) {
      return 'קיר הטיפוס My Wall ממוקם ברחוב האורגים 12, אשדוד (חניה בשפע בחזית). נתראה על הקיר! 🗺️';
    }

    return 'שלום! אני הבוט האוטומטי של My Wall CRM 🧗.\nאני יכול לעזור לך עם:\n1. קישור מהיר להצהרת בריאות ✍️\n2. הרשמה ומחירי חוגי טיפוס 🤸\n3. שעות פעילות ומיקום המועדון 🗺️\n\nאיך תרצה להתקדם?';
  },

  // Process incoming messages (webhook entrypoint / simulator)
  handleIncomingMessage: async (phone, text, isSimulator = false) => {
    // 1. Log inbound message
    db.insert('whatsapp_logs', {
      phone,
      channel: 'whatsapp',
      direction: 'inbound',
      message: text,
      status: 'received'
    });

    // 2. Upsert lead / client details in DB (source=whatsapp, status=lead_new)
    const { parent, student, isNew } = db.createLeadFromWhatsApp(phone, text);

    // 3. Welcome template t1 for brand-new WhatsApp leads
    if (isNew) {
      try {
        await whatsappService.sendTemplateMessage(phone, 't1', [parent.name || '']);
      } catch (err) {
        console.error('Failed to send WhatsApp welcome t1:', err.message);
      }
    }

    // 4. Process AI automated reply if active
    const settings = db.getSettings();
    if (settings.aiResponderEnabled) {
      const aiReply = await whatsappService.generateAIResponse(text);
      if (isSimulator) {
        db.insert('whatsapp_logs', {
          phone,
          channel: 'whatsapp',
          direction: 'outbound',
          message: aiReply,
          status: 'sent',
          is_ai: true
        });
      } else {
        await whatsappService.sendTextMessage(phone, aiReply, true);
      }
      return { parent, student, isNew, replied: true, reply: aiReply };
    }

    return { parent, student, isNew, replied: false };
  }
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
    ? 'https://graph.instagram.com/v20.0/me/messages'
    : `https://graph.facebook.com/v20.0/${accountId}/messages`;

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
    const { parent, student, isNew } = db.createLeadFromInstagram(igId, text, name);

    // 3. Process AI automated reply if active
    const settings = db.getSettings();
    if (settings.aiResponderEnabled) {
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

    return { parent, student, isNew, replied: false };
  }
};

