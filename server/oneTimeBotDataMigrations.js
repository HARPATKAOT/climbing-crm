import { linkGuardian } from './studentGuardians.js';

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
  return created;
}
