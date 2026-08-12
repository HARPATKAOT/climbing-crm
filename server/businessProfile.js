import { supa } from './supa.js';
import { clampImage } from './productCategories.js';

const SETTINGS_KEY = 'business_profile';

// „קיר בועז” is the trade name customers know; „הרפתקאות” is the registered
// business, and it is the one that belongs in a waiver or a privacy policy.
// `vat_id` הוא מספר העוסק המורשה — אצל עוסק יחיד זהו מספר הת״ז. הוא נדרש
// כפרט חובה על חשבונית מס, ולכן הוא נשמר כאן ולא מוטמע בקוד ההדפסה.
export const DEFAULT_BUSINESS_PROFILE = Object.freeze({
  display_name: 'קיר בועז',
  legal_name: 'הרפתקאות',
  vat_id: '',
  logo_url: '/logo.png',
  phone: '',
  email: '',
  address: '',
  website_url: '',
});

let memoryProfile = null;

function text(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

export function normalizeBusinessProfile(raw = {}, { validateImage = false } = {}) {
  const profile = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  let logoUrl = text(profile.logo_url, 750_000) || DEFAULT_BUSINESS_PROFILE.logo_url;
  if (validateImage && logoUrl !== '/logo.png') {
    logoUrl = clampImage(logoUrl);
  }
  return {
    display_name: text(profile.display_name, 120) || DEFAULT_BUSINESS_PROFILE.display_name,
    legal_name: text(profile.legal_name, 160),
    vat_id: text(profile.vat_id, 20),
    logo_url: logoUrl,
    phone: text(profile.phone, 60),
    email: text(profile.email, 160),
    address: text(profile.address, 300),
    website_url: text(profile.website_url, 500),
  };
}

export async function getBusinessProfile({ fresh = false } = {}) {
  if (!fresh && memoryProfile) return { ...memoryProfile };
  const read = await supa.readAppSetting(SETTINGS_KEY);
  const profile = normalizeBusinessProfile(
    (read.ok && read.configured ? read.value : null) || DEFAULT_BUSINESS_PROFILE
  );
  // A failed read is not an answer to remember. The cache had no expiry, so one
  // unlucky read at boot pinned the fallback business name — the one that goes
  // into a signed waiver — for the entire life of the process.
  if (read.ok) memoryProfile = profile;
  return { ...profile };
}

export async function saveBusinessProfile(input = {}) {
  const current = await getBusinessProfile();
  const profile = normalizeBusinessProfile(
    { ...current, ...input },
    { validateImage: true }
  );
  const result = await supa.setAppSetting(SETTINGS_KEY, profile);
  if (!result?.ok) {
    throw new Error(result?.error || 'שמירת פרטי העסק נכשלה');
  }
  memoryProfile = profile;
  return { ...profile };
}

export function safeBusinessProfile(profile) {
  return normalizeBusinessProfile(profile || DEFAULT_BUSINESS_PROFILE);
}
