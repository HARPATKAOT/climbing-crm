import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BUSINESS_PROFILE,
  normalizeBusinessProfile,
  safeBusinessProfile,
} from './businessProfile.js';

test('the fallback profile carries both names, each in its own field', () => {
  const profile = safeBusinessProfile();
  // The trade name is what a customer sees; the registered one is what a
  // signed document has to name.
  assert.equal(profile.display_name, 'קיר בועז');
  assert.equal(profile.legal_name, 'הרפתקאות');
  assert.equal(profile.logo_url, '/logo.png');
});

test('business profile normalizes public fields', () => {
  const profile = normalizeBusinessProfile({
    display_name: '  הרפתקאות  ',
    legal_name: 'שם משפטי',
    phone: ' 08-0000000 ',
    email: ' info@example.com ',
  });
  assert.equal(profile.display_name, 'הרפתקאות');
  assert.equal(profile.legal_name, 'שם משפטי');
  assert.equal(profile.phone, '08-0000000');
  assert.equal(profile.email, 'info@example.com');
  assert.equal(DEFAULT_BUSINESS_PROFILE.display_name, 'קיר בועז');
  assert.equal(DEFAULT_BUSINESS_PROFILE.legal_name, 'הרפתקאות');
});
