/**
 * כמה אימונים בשבוע יש למתאמן.
 *
 * אין שדה תדירות על המתאמן, והיו לו שני מקורות אמת סותרים: קבוצה אחת
 * שמתאמנת פעמיים בשבוע (‏„ב׳+ה׳”) ומתאמן שנרשם לשתי קבוצות נפרדות של יום
 * אחד כל אחת. שניהם „פעמיים בשבוע”, ולכן סופרים כאן **ימי אימון**, לא
 * קבוצות: סכום ימי האימון של כל הקבוצות הפעילות שלו.
 *
 * המספר הזה קובע את מחיר הבסיס של השכרת הנעליים — ראו shoesBasePrice.
 */

import { activeEnrollmentGroupIds, studentGroupIds } from './studentGroups.js';
import { enrichGroupWithBotMeta } from './groupMetadata.js';

/**
 * @returns {number} אימונים בשבוע, לפחות 1.
 */
export function weeklySessionsForStudent({ db, studentId, student = null } = {}) {
  if (!db || !studentId) return 1;
  const known = student || db.getOne?.('students', studentId) || null;
  const enrollments = db.get?.('enrollments') || [];
  const groupIds = activeEnrollmentGroupIds(enrollments, studentId);
  const ids = groupIds.length ? groupIds : studentGroupIds(known);

  let sessions = 0;
  for (const groupId of ids) {
    const group = db.getOne?.('groups', groupId);
    if (!group) continue;
    // קבוצה בלי ימי אימון ידועים נספרת כאימון אחד ולא כאפס — קבוצה קיימת
    // היא לפחות מפגש אחד בשבוע.
    sessions += enrichGroupWithBotMeta(db, group).trainingDays.length || 1;
  }

  return Math.max(1, sessions);
}
