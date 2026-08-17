/**
 * ההרשמה כרשימה של חמישה דברים, ואיזה מהם עדיין פתוח.
 *
 * הבוט נהג לסגור שיחה בשלב שהוא סיים: טופס נחתם — „הפרטים התקבלו”; מקום נשמר
 * — „הילד משובץ”. איש לא לוּוה עד הסוף, והפער התגלה שבועות אחר כך כילד בלי
 * קבוצה או כערכה שאיש לא שילם עליה.
 *
 * החישוב יושב כאן ולא בכלי של הבוט, כי שני צרכנים שונים חייבים לראות אותו
 * דבר: התשובה בשיחה, והמעבר היומי שמאתר את מי שנתקע ואינו כותב לנו.
 */

import { participationEligibility } from './participationEligibility.js';
import { unpaidEquipmentItems } from './equipmentService.js';
import { activeHoldForStudent } from './registrationLifecycle.js';
import { activeEnrollmentGroupIds, studentGroupIds } from './studentGroups.js';

export const STEP_FORM = 'form';
export const STEP_GROUP = 'group';
export const STEP_CENTRE = 'centre';
export const STEP_EQUIPMENT = 'equipment';

/** הצעד הפתוח וסיבת המעקב שמתאימה לו. */
export const STEP_FOLLOWUP_REASON = Object.freeze({
  [STEP_FORM]: 'form_not_filled',
  [STEP_GROUP]: 'no_group_yet',
  [STEP_CENTRE]: 'pending_signup',
  [STEP_EQUIPMENT]: 'equipment_unpaid',
});

/**
 * האם המתאמן יושב באיזושהי קבוצה — בכרטיס, ברישום פעיל, או בשמירת מקום.
 * הסטטוס לבדו אינו עונה: „רשום” נכתב ברגע שהמתנ״ס מאשר, לרוב עוד לפני
 * שנבחרה קבוצה.
 */
export function hasLiveGroup(db, student) {
  if (!student?.id) return false;
  if (studentGroupIds(student).length) return true;
  if (activeEnrollmentGroupIds(db?.get?.('enrollments') || [], student.id).length) return true;
  return Boolean(activeHoldForStudent(db, student.id)?.group_ids?.length);
}

/**
 * המתאמן בתוך שלושת הימים שהבטחנו לו.
 *
 * שמירת המקום נושאת תזכורת משלה לבוקר המועד האחרון, ואומרת בדיוק את מה
 * שסוכם. כל נדנוד אחר בינתיים סותר את מה שנאמר לו: „המקום שמור לשלושה ימים”
 * ולמחרת בבוקר „הספקתם להשלים את ההרשמה?”.
 */
export function holdIsCounting(db, student, now = new Date()) {
  const hold = activeHoldForStudent(db, student?.id, now);
  if (!hold?.expires_at) return false;
  return new Date(hold.expires_at).getTime() > new Date(now).getTime();
}

function openEquipment(db, studentId) {
  return unpaidEquipmentItems((db?.get?.('student_equipment') || []).filter(
    (row) => String(row.student_id || row.studentId || '') === String(studentId)
  ));
}

/**
 * @returns {{ complete: boolean, step: string|null, label: string }}
 */
export function registrationStep(db, student, { group = null } = {}) {
  if (!student?.id) return { complete: false, step: null, label: '' };
  const documents = participationEligibility(db, { studentId: student.id });
  const reported = ['awaiting_centre_confirmation', 'registered', 'active']
    .includes(String(student.status || ''));

  const steps = [
    { key: STEP_FORM, done: documents.eligible, label: 'להשלים את טופס ההשתתפות' },
    {
      key: STEP_GROUP,
      done: Boolean(group) || hasLiveGroup(db, student),
      label: 'לבחור קבוצה ולשמור מקום',
    },
    { key: STEP_CENTRE, done: reported, label: 'להירשם במתנ״ס ולעדכן אותנו שנרשמתם' },
    {
      key: STEP_EQUIPMENT,
      done: !openEquipment(db, student.id).length,
      label: 'להסדיר את הציוד, או לסמן בקישור מה כבר קיים מהבית',
    },
  ];
  const open = steps.find((step) => !step.done);
  return open
    ? { complete: false, step: open.key, label: open.label }
    : { complete: true, step: null, label: '' };
}
