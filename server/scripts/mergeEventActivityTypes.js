/**
 * מאחד „יום הולדת”, „בית ספר” ו„פעילות חברה” לסוג אחד — „אירוע” — ומעביר את
 * ההבחנה ביניהם לתגית (`event_kind`).
 *
 * שלושת הסוגים החזיקו בדיוק את אותם תפקידים, אותו שכר ואותה השפעה על יום קיר
 * פתוח, כך שהם היו סוג אחד שנכתב שלוש פעמים. הסקריפט הזה עושה את המעבר על
 * הנתונים: פעילויות קיימות, תבניות פעילות, וקטלוג הסוגים השמור.
 *
 * הוא גם מוסיף „אימון אישי” כסוג חדש.
 *
 * הרצה מתוך תיקיית server:
 *   node scripts/mergeEventActivityTypes.js --dry       # להראות מה ישתנה
 *   node scripts/mergeEventActivityTypes.js --remote    # להחיל על ה-CRM החי
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { supa } from '../supa.js';
import { EVENT_TYPE, LEGACY_EVENT_TYPES } from '../eventKinds.js';

const ACTIVITY_TYPE_CATALOG_KEY = 'activity_type_catalog';

/** הקטלוג שאמור להישמר אחרי האיחוד. */
export const MERGED_TYPES = [
  { id: 'event', label: 'אירוע', color: '#FB923C', bg: 'rgba(251,146,60,0.18)' },
  { id: 'trip', label: 'טיול', color: '#60A5FA', bg: 'rgba(96,165,250,0.18)' },
  { id: 'personal_training', label: 'אימון אישי', color: '#34D399', bg: 'rgba(52,211,153,0.18)' },
  { id: 'route_building', label: 'בניית מסלולים', color: '#A78BFA', bg: 'rgba(167,139,250,0.18)' },
  { id: 'opening_hours', label: 'שעות פתיחה', color: '#22D3EE', bg: 'rgba(34,211,238,0.16)', locked: true },
  { id: 'training_vacation', label: 'חופשה מאימונים', color: '#F472B6', bg: 'rgba(244,114,182,0.18)', locked: true },
  { id: 'other', label: 'אחר', color: '#94A3B8', bg: 'rgba(148,163,184,0.16)', locked: true },
];

function rowsNeedingMerge(rows) {
  return (rows || []).filter((r) => Object.hasOwn(LEGACY_EVENT_TYPES, String(r.type || '').toLowerCase()));
}

async function apply({ dry = false } = {}) {
  if (!supa.isEnabled()) {
    throw new Error('אין חיבור ל-Supabase — בדוק SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY ב-.env');
  }

  const activities = await supa.getAll('activities') || [];
  const templates = await supa.getAll('activity_templates') || [];
  const staleActivities = rowsNeedingMerge(activities);
  const staleTemplates = rowsNeedingMerge(templates);

  console.log(`פעילויות לעדכון: ${staleActivities.length} מתוך ${activities.length}`);
  for (const a of staleActivities) {
    console.log(`  ${a.type} → event + תגית ${LEGACY_EVENT_TYPES[a.type]}  |  ${a.date || ''} ${a.name || ''}`);
  }
  console.log(`תבניות לעדכון: ${staleTemplates.length} מתוך ${templates.length}`);
  for (const t of staleTemplates) {
    console.log(`  ${t.type} → event + תגית ${LEGACY_EVENT_TYPES[t.type]}  |  ${t.name || ''}`);
  }

  const savedCatalog = await supa.getAppSetting(ACTIVITY_TYPE_CATALOG_KEY);
  const savedIds = Array.isArray(savedCatalog) ? savedCatalog.map((t) => t.id) : [];
  console.log(`קטלוג שמור: ${savedIds.join(', ') || '(אין)'}`);
  console.log(`קטלוג אחרי: ${MERGED_TYPES.map((t) => t.id).join(', ')}`);

  if (dry) {
    console.log('\n(--dry) לא נשמר דבר.');
    return;
  }

  for (const row of staleActivities) {
    const next = { ...row, type: EVENT_TYPE, event_kind: LEGACY_EVENT_TYPES[row.type] };
    const result = await supa.upsert('activities', next);
    if (!result?.ok) throw new Error(`activities/${row.id}: ${result?.error}`);
  }
  for (const row of staleTemplates) {
    const next = { ...row, type: EVENT_TYPE, event_kind: LEGACY_EVENT_TYPES[row.type] };
    const result = await supa.upsert('activity_templates', next);
    if (!result?.ok) throw new Error(`activity_templates/${row.id}: ${result?.error}`);
  }

  // הצבעים והתוויות שהמשתמש שינה בעצמו נשמרים; רק הסוגים שהתאחדו מוחלפים.
  const preserved = new Map((Array.isArray(savedCatalog) ? savedCatalog : []).map((t) => [t.id, t]));
  const nextCatalog = MERGED_TYPES.map((t) => {
    const saved = preserved.get(t.id);
    return saved ? { ...t, label: saved.label || t.label, color: saved.color || t.color, bg: saved.bg || t.bg } : t;
  });
  const saved = await supa.setAppSetting(ACTIVITY_TYPE_CATALOG_KEY, nextCatalog);
  if (!saved?.ok) throw new Error(`catalog: ${saved?.error}`);

  // אימות בקריאה חוזרת: אף שורה לא נשארה עם סוג ישן.
  const after = await supa.getAll('activities') || [];
  const afterTemplates = await supa.getAll('activity_templates') || [];
  const leftovers = [...rowsNeedingMerge(after), ...rowsNeedingMerge(afterTemplates)];
  if (leftovers.length) throw new Error(`נשארו ${leftovers.length} שורות עם סוג ישן`);
  const catalogAfter = await supa.getAppSetting(ACTIVITY_TYPE_CATALOG_KEY);
  const ids = (catalogAfter || []).map((t) => t.id);
  if (!ids.includes('event') || !ids.includes('personal_training')) {
    throw new Error(`הקטלוג לא נשמר כראוי: ${ids.join(', ')}`);
  }
  console.log('\n✅ האיחוד הוחל ואומת בקריאה חוזרת.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  apply({ dry: process.argv.includes('--dry') })
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}
