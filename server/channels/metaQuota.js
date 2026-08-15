/**
 * מכסת השליחה של המספר העסקי — מה מטא מרשה, וכמה כבר נוצל.
 *
 * Two sources, each labelled with where it came from:
 *  - Meta Graph API: the phone number's messaging-limit tier and quality
 *    rating. When Meta does not answer (or a field is missing), the response
 *    says so explicitly — an estimate is never dressed up as a fact.
 *  - The local send journal: unique numbers that received a business-initiated
 *    (template/broadcast) message in the rolling 24h window. Meta has no live
 *    "used so far" counter, so this is our own count and is labelled as such.
 */

import { db } from '../db.js';

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const CACHE_MS = 5 * 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;

// https://developers.facebook.com/docs/whatsapp/messaging-limits
const TIER_LIMITS = {
  TIER_NOT_SET: 250,
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1000,
  TIER_10K: 10000,
  TIER_100K: 100000,
  TIER_UNLIMITED: null, // ללא הגבלה
};

const QUALITY_LABELS = {
  GREEN: { label: 'גבוה', tone: 'green' },
  YELLOW: { label: 'בינוני — שים לב', tone: 'amber' },
  RED: { label: 'נמוך — סכנת הורדת מכסה', tone: 'red' },
  UNKNOWN: { label: 'לא ידוע', tone: 'gray' },
};

function credentials() {
  const settings = db.getSettings();
  const phoneId = String(process.env.META_WA_PHONE_NUMBER_ID || settings.metaWaPhoneId || '').trim();
  const token = String(process.env.META_WA_ACCESS_TOKEN || settings.metaWaAccessToken || '').trim();
  const wabaId = String(process.env.META_WA_WABA_ID || settings.metaWaWabaId || '').trim();
  const configured = !!(phoneId && token
    && !phoneId.includes('YOUR_') && !token.includes('YOUR_'));
  return { phoneId, token, wabaId, configured };
}

async function graphGet(path, token) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Meta API ${res.status}`);
  }
  return data;
}

/**
 * Unique recipients that got a business-initiated message from us in the
 * rolling 24h window, from the local journal. Failed sends never opened a
 * conversation and are not counted.
 */
export function localWindowUsage(logs = null, now = Date.now()) {
  const rows = logs || db.get('whatsapp_logs') || [];
  const since = now - WINDOW_MS;
  const phones = new Map(); // phone tail -> earliest send in window
  for (const row of rows) {
    if (row?.direction !== 'outbound' || row?.status === 'failed') continue;
    // רק תבניות נספרות: הודעה חופשית (גם בדיוור) יוצאת בתוך חלון שירות פתוח
    // ואינה צורכת את מכסת ההודעות היזומות של Meta.
    const isBusinessInitiated = !!(row.template_id || row.template_name);
    if (!isBusinessInitiated) continue;
    const ts = new Date(row.created_at || 0).getTime();
    if (!Number.isFinite(ts) || ts < since || ts > now) continue;
    const tail = String(row.phone || '').replace(/\D/g, '').slice(-9);
    if (!tail) continue;
    if (!phones.has(tail) || ts < phones.get(tail)) phones.set(tail, ts);
  }
  const earliest = phones.size ? Math.min(...phones.values()) : null;
  return {
    used: phones.size,
    // When the oldest conversation in the window rolls out, capacity frees up.
    oldestRollsOffAt: earliest ? new Date(earliest + WINDOW_MS).toISOString() : null,
    source: 'local_journal',
  };
}

let cache = { at: 0, data: null };

export function clearQuotaCache() {
  cache = { at: 0, data: null };
}

export async function getMetaQuota({ force = false, now = Date.now() } = {}) {
  if (!force && cache.data && now - cache.at < CACHE_MS) {
    return { ...cache.data, cached: true };
  }

  const { phoneId, token, wabaId, configured } = credentials();
  const local = localWindowUsage(null, now);

  const result = {
    available: configured,
    fetchedAt: new Date(now).toISOString(),
    tier: { value: null, limit: null, error: configured ? null : 'חיבור Meta לא מוגדר' },
    quality: { value: null, ...QUALITY_LABELS.UNKNOWN, error: configured ? null : 'חיבור Meta לא מוגדר' },
    window: local,
    remaining: null,
  };

  if (configured) {
    try {
      const data = await graphGet(
        `${phoneId}?fields=messaging_limit_tier,quality_rating,display_phone_number`,
        token
      );
      const tier = String(data.messaging_limit_tier || '').toUpperCase();
      if (tier && tier in TIER_LIMITS) {
        result.tier = { value: tier, limit: TIER_LIMITS[tier], error: null };
      } else if (tier) {
        result.tier = { value: tier, limit: null, error: null };
      } else {
        result.tier = { value: null, limit: null, error: 'Meta לא החזירה את רמת המכסה (messaging_limit_tier)' };
      }
      const quality = String(data.quality_rating || '').toUpperCase();
      if (quality && QUALITY_LABELS[quality]) {
        result.quality = { value: quality, ...QUALITY_LABELS[quality], error: null };
      } else if (quality) {
        result.quality = { value: quality, ...QUALITY_LABELS.UNKNOWN, error: null };
      } else {
        result.quality = { value: null, ...QUALITY_LABELS.UNKNOWN, error: 'Meta לא החזירה דירוג איכות' };
      }
      result.displayPhone = data.display_phone_number || '';
    } catch (err) {
      result.tier = { value: null, limit: null, error: `שגיאה מול Meta: ${err.message}` };
      result.quality = { value: null, ...QUALITY_LABELS.UNKNOWN, error: `שגיאה מול Meta: ${err.message}` };
    }

    // Business-initiated conversations opened in the last 24h, from Meta's
    // analytics — best-effort; needs the WABA id and analytics permission.
    if (wabaId) {
      try {
        const start = Math.floor((now - WINDOW_MS) / 1000);
        const end = Math.floor(now / 1000);
        const data = await graphGet(
          `${wabaId}?fields=conversation_analytics.start(${start}).end(${end})`
          + `.granularity(HALF_HOUR).conversation_directions(["business_initiated"])`,
          token
        );
        const points = data?.conversation_analytics?.data?.[0]?.data_points || [];
        const total = points.reduce((sum, p) => sum + (Number(p.conversation) || 0), 0);
        result.window = {
          ...result.window,
          metaConversations: total,
          metaSource: 'conversation_analytics',
        };
      } catch (err) {
        result.window = {
          ...result.window,
          metaConversations: null,
          metaError: `Meta לא החזירה נתוני שיחות: ${err.message}`,
        };
      }
    } else {
      result.window = {
        ...result.window,
        metaConversations: null,
        metaError: 'חסר מזהה חשבון עסקי (META_WA_WABA_ID) — אין נתון שיחות מ-Meta',
      };
    }
  }

  // Remaining = tier limit minus the better of the two usage counts.
  if (result.tier.limit != null) {
    const used = Number.isFinite(result.window.metaConversations) && result.window.metaConversations !== null
      ? Math.max(result.window.metaConversations, result.window.used)
      : result.window.used;
    result.remaining = Math.max(0, result.tier.limit - used);
  } else if (result.tier.value === 'TIER_UNLIMITED') {
    result.remaining = null; // unlimited
  }

  cache = { at: now, data: result };
  return result;
}
