/**
 * Writes the agreed bot mandate into `whatsapp_settings`.
 *
 * What the bot may answer on its own, and what it must hand to a human, lives
 * in these fields — the code only enforces where each fact comes from. Running
 * this syncs the same texts the CRM screen would have saved by hand.
 *
 * The master switch is never touched here: turning the bot on is a decision,
 * not a side effect of updating its wording.
 *
 *   node scripts/applyBotSettings.js --dry       # print the diff only
 *   node scripts/applyBotSettings.js             # local db.json only
 *   node scripts/applyBotSettings.js --remote    # the live CRM (Supabase)
 *
 * `--remote` merges onto the blob that is live right now, not onto db.json:
 * the local copy carries connection fields that may be older than production.
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { db } from '../db.js';
import { supa } from '../supa.js';
import { DEFAULT_BOT_SETTINGS } from '../whatsappBot.js';

export const BOT_MANDATE = {
  aiSystemPrompt: [
    'אתה הבוט של קיר הטיפוס הרפתקאות - קיר בועז. עונה בעברית, קצר וברור.',
    '',
    'מותר: שיחה רגילה; למסור רק עובדות שמופיעות בנתונים שקיבלת (חוגים, מחירים מהמערכת, שעות, אירועים, קישורים).',
    'אסור: להמציא שעה, מחיר, קבוצה, אירוע, קישור או שכר.',
    'אסור לענות לבד על: ביטול, החזר, חשבונית, תלונה, פציעה, שכר עובדים — העבר לצוות.',
    'חסר נתון: התחל ב-HANDOFF ואז משפט טבעי קצר. הודעה חסרת משמעות: התחל ב-UNSURE ואז בקש הבהרה.',
  ].join('\n'),
  aiBusinessFacts: DEFAULT_BOT_SETTINGS.aiBusinessFacts,
  aiKnowledgeBase: DEFAULT_BOT_SETTINGS.aiKnowledgeBase,
  aiForbiddenTopics: DEFAULT_BOT_SETTINGS.aiForbiddenTopics,
  aiHandoffKeywords: DEFAULT_BOT_SETTINGS.aiHandoffKeywords,
  aiGreetingMenu: DEFAULT_BOT_SETTINGS.aiGreetingMenu,
  // 24/7, לכל הפונים — לפי ההחלטה
  aiActiveHoursEnabled: false,
  aiAudienceMode: 'all',
};

function printDiff(current) {
  for (const [key, value] of Object.entries(BOT_MANDATE)) {
    const before = current[key];
    if (String(before ?? '') === String(value ?? '')) {
      console.log(`= ${key} (ללא שינוי)`);
      continue;
    }
    const indent = (text) => String(text ?? '').split('\n').map((line) => `    ${line}`).join('\n');
    console.log(`\n~ ${key}\n  לפני:\n${indent(before)}\n  אחרי:\n${indent(value)}`);
  }
}

async function apply({ dry = false, remote = false } = {}) {
  if (remote && !supa.isEnabled()) {
    throw new Error('אין חיבור ל-Supabase — בדוק SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY ב-.env');
  }

  const live = remote ? await supa.getAppSetting('whatsapp_settings') : null;
  const current = remote ? (live || {}) : db.getSettings();
  printDiff(current);

  if (dry) {
    console.log('\n(--dry) לא נשמר דבר.');
    return;
  }

  const next = { ...current, ...BOT_MANDATE };
  db.saveSettings({ ...db.getSettings(), ...BOT_MANDATE });

  if (remote) {
    // The master switch lives in its own durable key and is not written here,
    // so whatever production decided about it stays decided.
    const result = await supa.setAppSetting('whatsapp_settings', next);
    if (!result?.ok) throw new Error(result?.error || 'כתיבה ל-Supabase נכשלה');
    const check = await supa.getAppSetting('whatsapp_settings');
    const mismatched = Object.keys(BOT_MANDATE)
      .filter((key) => String(check?.[key] ?? '') !== String(BOT_MANDATE[key] ?? ''));
    if (mismatched.length) throw new Error(`נשמר חלקית: ${mismatched.join(', ')}`);
    console.log('\n✅ ההגדרות נשמרו ב-CRM החי ואומתו בקריאה חוזרת.');
  } else {
    console.log('\n✅ נשמר ב-db.json המקומי בלבד (בלי --remote לא נוגעים בפרודקשן).');
  }
  console.log('המתג הראשי לא נגע — הבוט נשאר במצב שבו היה.');
}

// Importing this file (to read BOT_MANDATE) must never write settings.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  apply({ dry: process.argv.includes('--dry'), remote: process.argv.includes('--remote') })
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}
