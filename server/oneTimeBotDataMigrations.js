import { linkGuardian } from './studentGuardians.js';

export const ADVANCED_PROGRAM_INFO = `🧗‍♀️ אימונים בקירות אחרים – נכוון לקיים אימון חוץ אחד בחודש בקירות שנוח להגיע אליהם - מאנקיז נתניה או קירות אחרים שהם בהגעה ברכבת / אוטובוס 🚆🚌.
ההדרכה כלולה בעלות החוג.
עלות הכניסה לקיר המארח תהיה עליכם – ננסה לשפר לטובתכם את העלות הזו מול הקירות 💪

🏕️ ימי שטח – נכוון לקיים 3 פעילויות שטח לאורך השנה 🌿🪨.
ימים אלו לא יהיו חובה ויהיו לבחירתכם. פעילויות אלו יהיו בעלות נפרדת בהתאם לאופי הפעילות.`;

function isAdvancedProgramGroup(group) {
  const text = `${group?.skillLevel || ''} ${group?.name || ''}`;
  return /מתקדמ|נבחרת/u.test(text);
}

/** Add the shared program details while preserving each group's own description. */
export function withAdvancedProgramInfo(info = '') {
  const current = String(info || '').trim();
  if (current.includes('🏕️ ימי שטח')) return current;
  const withoutLegacyWallNote = current
    .replace(/\n*כחלק מהאימונים בקבוצה הזו הילדים יוצאים אחת לחודש לאימון בקיר טיפוס אחר \(בתשלום נפרד של עלות הכניסה לאותו הקיר\)\s*/u, '\n')
    .trim();
  return [withoutLegacyWallNote, ADVANCED_PROGRAM_INFO].filter(Boolean).join('\n\n');
}

/**
 * Explicit CRM corrections approved for the bot rollout. These are data
 * migrations, not customer-specific prompt rules. Stable guardian-link IDs
 * make every operation safe to run again after a restart or deployment.
 */
export async function runOneTimeBotDataMigrations(db, persist) {
  const created = [];
  const guardianLinks = [
    {
      parentId: 'pn_2a2aa52d5a6e816c9b12fb757958cee8', // יובל דינרי
      studentId: 'sn_8d22659dcf6b45f08ca2f5101a8682c5', // אלה פרי דינרי
    },
    {
      parentId: 'pn_2a2aa52d5a6e816c9b12fb757958cee8', // יובל דינרי
      studentId: 'sn_0f9441f2e38f4dd5bb466f06d91a088d', // אביתר פרי דינרי
    },
  ];

  for (const pair of guardianLinks) {
    if (!db.getOne('parents', pair.parentId) || !db.getOne('students', pair.studentId)) continue;
    const link = linkGuardian(db, { ...pair, source: 'approved-data-migration-2026-08' });
    if (!link) continue;
    if (typeof persist === 'function') await persist('student_guardians', link);
    created.push(link);
  }

  for (const group of db.get('groups') || []) {
    if (!isAdvancedProgramGroup(group)) continue;
    const info = withAdvancedProgramInfo(group.info);
    if (info === String(group.info || '').trim()) continue;
    const updated = db.update('groups', group.id, { info });
    if (!updated) continue;
    if (typeof persist === 'function') await persist('groups', updated);
    created.push(updated);
  }
  return created;
}
