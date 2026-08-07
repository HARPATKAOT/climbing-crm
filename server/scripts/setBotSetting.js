// Change one bot setting in the durable store, leaving every other key alone.
//
// The live server reads its settings into memory at boot, so a change here is
// only visible after a restart or the next deploy — see the brief's traps.
//
// Run from the server folder:
//   node scripts/setBotSetting.js aiRateLimitPerHour 40

import 'dotenv/config';
import { supa } from '../supa.js';

const [key, rawValue] = process.argv.slice(2);
if (!key || rawValue === undefined) {
  console.error('usage: node scripts/setBotSetting.js <key> <value>');
  process.exit(1);
}

const value = /^-?\d+(\.\d+)?$/.test(rawValue)
  ? Number(rawValue)
  : (rawValue === 'true' ? true : (rawValue === 'false' ? false : rawValue));

const read = await supa.readAppSetting('whatsapp_settings');
if (!read.ok) {
  console.error('could not read whatsapp_settings:', read.error);
  process.exit(1);
}

const current = read.value && typeof read.value === 'object' ? read.value : {};
console.log('before:', key, '=', current[key]);

const result = await supa.setAppSetting('whatsapp_settings', { ...current, [key]: value });
if (!result?.ok) {
  console.error('save failed:', result?.error);
  process.exit(1);
}

const after = await supa.readAppSetting('whatsapp_settings');
console.log('after: ', key, '=', after.value?.[key]);
