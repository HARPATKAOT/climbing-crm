import { supa } from './supa.js';
import { clampImage } from './productCategories.js';

const SETTINGS_KEY = 'business_profile';

// „קיר בועז” is the trade name customers know; „הרפתקאות” is the registered
// business, and it is the one that belongs in a waiver or a privacy policy.
export const DEFAULT_BUSINESS_PROFILE = Object.freeze({
  display_name: 'קיר בועז',
  legal_name: 'הרפתקאות',
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
    logo_url: logoUrl,
    phone: text(profile.phone, 60),
    email: text(profile.email, 160),
    address: text(profile.address, 300),
    website_url: text(profile.website_url, 500),
  };
}

export async function getBusinessProfile({ fresh = false } = {}) {
  if (!fresh && memoryProfile) return { ...memoryProfile };
  const stored = await supa.getAppSetting(SETTINGS_KEY);
  memoryProfile = normalizeBusinessProfile(stored || DEFAULT_BUSINESS_PROFILE);
  return { ...memoryProfile };
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
