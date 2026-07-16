import { db } from './db.js';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function getAppCredentials() {
  return {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '',
  };
}

function maskToken(token) {
  if (!token || token.length < 12) return '';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

export function normalizeWaPhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^\d]/g, '');
  if (digits.startsWith('0') && digits.length >= 9) {
    digits = `972${digits.slice(1)}`;
  }
  if (digits.startsWith('9720')) {
    digits = `972${digits.slice(4)}`;
  }
  return digits;
}

export function phonesMatch(a, b) {
  const na = normalizeWaPhone(a);
  const nb = normalizeWaPhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const tailA = na.slice(-9);
  const tailB = nb.slice(-9);
  return tailA.length === 9 && tailA === tailB;
}

function extractMessageText(message = {}) {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.image) return message.image.caption || '[תמונה]';
  if (message.video) return message.video.caption || '[סרטון]';
  if (message.audio) return '[הודעה קולית]';
  if (message.document) return message.document.caption || `[קובץ: ${message.document.filename || 'מסמך'}]`;
  if (message.sticker) return '[סטיקר]';
  if (message.location) return '[מיקום]';
  if (message.contacts?.length) return '[איש קשר]';
  if (message.reaction?.emoji) return `ריאקציה: ${message.reaction.emoji}`;
  if (typeof message.body === 'string') return message.body;
  return '';
}

async function graphGet(path, token, params = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Graph GET ${path} failed`);
  }
  return data;
}

async function graphPost(path, token, body = {}) {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Graph POST ${path} failed`);
  }
  return data;
}

async function exchangeCodeForToken(code) {
  const { appId, appSecret } = getAppCredentials();
  if (!appId || !appSecret) {
    throw new Error('חסרים META_APP_ID / META_APP_SECRET בשרת');
  }
  const url = new URL(`${GRAPH_BASE}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(data.error?.message || 'החלפת קוד ה-OAuth נכשלה');
  }
  return data.access_token;
}

async function subscribeWabaWebhooks(wabaId, token) {
  if (!wabaId || !token) return { skipped: true };
  try {
    await graphPost(`/${wabaId}/subscribed_apps`, token, {});
    return { success: true };
  } catch (err) {
    console.warn('WABA webhook subscribe warning:', err.message);
    return { success: false, error: err.message };
  }
}

async function fetchPhoneDisplay(phoneNumberId, token) {
  if (!phoneNumberId || !token) return '';
  try {
    const data = await graphGet(`/${phoneNumberId}`, token, {
      fields: 'display_phone_number,verified_name,is_on_biz_app,platform_type',
    });
    return {
      display: data.display_phone_number || '',
      verifiedName: data.verified_name || '',
      isOnBizApp: !!data.is_on_biz_app,
      platformType: data.platform_type || '',
    };
  } catch (err) {
    console.warn('Could not fetch phone display info:', err.message);
    return { display: '', verifiedName: '', isOnBizApp: false, platformType: '' };
  }
}

export const whatsappConnectService = {
  getConnectConfig() {
    const { appId, configId } = getAppCredentials();
    const settings = db.getSettings();
    return {
      appId,
      configId,
      graphVersion: GRAPH_VERSION,
      configured: !!(appId && configId),
      verifyToken: settings.verifyToken || 'climbing_verify_token',
      checklist: [
        'הגדירו META_APP_ID, META_APP_SECRET, META_EMBEDDED_SIGNUP_CONFIG_ID בשרת',
        'ב-Meta Developer: Facebook Login for Business → Configuration ל-WhatsApp Embedded Signup',
        'הוסיפו את דומיין ה-CRM ל-Allowed Domains / Valid OAuth Redirect URIs',
        'הירשמו ל-webhooks: messages, smb_message_echoes, history, account_update',
        'השתמשו ב-WhatsApp Business App (ירוק) גרסה 2.24.17 ומעלה',
      ],
    };
  },

  getStatus() {
    const settings = db.getSettings();
    const phoneId = settings.metaWaPhoneId || process.env.META_WA_PHONE_NUMBER_ID || '';
    const token = settings.metaWaAccessToken || process.env.META_WA_ACCESS_TOKEN || '';
    const connected = !!(
      phoneId &&
      token &&
      !phoneId.includes('YOUR_') &&
      !token.includes('YOUR_')
    );
    return {
      connected,
      phoneNumberId: phoneId || null,
      wabaId: settings.metaWaWabaId || process.env.META_WA_WABA_ID || null,
      displayPhone: settings.connectedPhoneDisplay || null,
      verifiedName: settings.connectedVerifiedName || null,
      coexistenceEnabled: !!settings.coexistenceEnabled,
      isOnBizApp: !!settings.isOnBizApp,
      connectedAt: settings.connectedAt || null,
      tokenPreview: connected ? maskToken(token) : null,
      envFallback: !settings.metaWaPhoneId && !!process.env.META_WA_PHONE_NUMBER_ID,
    };
  },

  async completeOAuth({ code, phone_number_id, waba_id, business_id, event } = {}) {
    if (!code) throw new Error('חסר קוד OAuth מ-Meta');
    if (!phone_number_id) throw new Error('חסר phone_number_id מ-Meta');

    const accessToken = await exchangeCodeForToken(code);
    const phoneInfo = await fetchPhoneDisplay(phone_number_id, accessToken);
    const subscribeResult = await subscribeWabaWebhooks(waba_id, accessToken);

    const coexistenceEnabled =
      event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' ||
      phoneInfo.isOnBizApp === true;

    const settings = db.saveSettings({
      metaWaPhoneId: phone_number_id,
      metaWaAccessToken: accessToken,
      metaWaWabaId: waba_id || '',
      metaWaBusinessId: business_id || '',
      connectedPhoneDisplay: phoneInfo.display || '',
      connectedVerifiedName: phoneInfo.verifiedName || '',
      coexistenceEnabled,
      isOnBizApp: phoneInfo.isOnBizApp || coexistenceEnabled,
      connectedAt: new Date().toISOString(),
      lastConnectEvent: event || 'FINISH',
    });

    return {
      success: true,
      settings: {
        ...settings,
        metaWaAccessToken: maskToken(settings.metaWaAccessToken),
      },
      status: this.getStatus(),
      subscribeResult,
    };
  },

  disconnect() {
    const settings = db.saveSettings({
      metaWaPhoneId: '',
      metaWaAccessToken: '',
      metaWaWabaId: '',
      metaWaBusinessId: '',
      connectedPhoneDisplay: '',
      connectedVerifiedName: '',
      coexistenceEnabled: false,
      isOnBizApp: false,
      connectedAt: null,
      lastConnectEvent: null,
    });
    return {
      success: true,
      settings: {
        ...settings,
        metaWaAccessToken: '',
      },
      status: this.getStatus(),
    };
  },

  async refreshStatusFromMeta() {
    const settings = db.getSettings();
    const phoneId = settings.metaWaPhoneId || process.env.META_WA_PHONE_NUMBER_ID;
    const token = settings.metaWaAccessToken || process.env.META_WA_ACCESS_TOKEN;
    if (!phoneId || !token) return this.getStatus();

    const phoneInfo = await fetchPhoneDisplay(phoneId, token);
    if (phoneInfo.display || phoneInfo.verifiedName) {
      db.saveSettings({
        connectedPhoneDisplay: phoneInfo.display || settings.connectedPhoneDisplay || '',
        connectedVerifiedName: phoneInfo.verifiedName || settings.connectedVerifiedName || '',
        isOnBizApp: phoneInfo.isOnBizApp,
        coexistenceEnabled: settings.coexistenceEnabled || phoneInfo.isOnBizApp,
      });
    }
    return this.getStatus();
  },

  extractMessageText,
  normalizeWaPhone,
  phonesMatch,
};
