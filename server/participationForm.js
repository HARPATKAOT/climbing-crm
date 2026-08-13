/**
 * איך קוראים לטופס — במקום אחד.
 *
 * הטופס הוא שלושה דברים: פרטי המשתתף, הצהרת בריאות והסרת אחריות. כל מקום
 * בקוד קרא לו „הצהרת בריאות”, כי זה החלק שהכי קל לזכור, וכך יצא שהבוט הבטיח
 * להורה טופס אחד והוא פתח טופס אחר. תיקנו את זה פעם אחת בהודעות ששולחות את
 * הקישור, והבוט המשיך לומר „הצהרת הבריאות של שקד בתוקף” במקום אחר — כי השם
 * היה כתוב בחמישה מקומות ולא אחד.
 *
 * מכאן ואילך: השם היחיד הוא כאן, וכל מי שמזכיר את הטופס מייבא אותו.
 */

/** מה שאומרים כשמזכירים אותו בקצרה, אחרי שכבר הוסבר מה יש בו. */
export const FORM_SHORT = 'טופס השתתפות';

/** Marks a participation form opened from the cash register. */
export const CASH_REGISTER_FORM_SOURCE = 'pos';

/** Cash-register paperwork must not force either mailing-list consent. */
export function isCashRegisterFormSource(value) {
  return String(value || '').trim().toLowerCase() === CASH_REGISTER_FORM_SOURCE;
}

/** כותרת תיקייה בתיק הלקוח — ברבים, כי יכולים להיות כמה. */
export const FORM_FOLDER = 'טפסי השתתפות';

/** מה שאומרים כששולחים אותו בפעם הראשונה — הרשימה המלאה. */
export const FORM_FULL = 'טופס השתתפות — פרטי המשתתף, הצהרת בריאות והסרת אחריות';

/** מה שאומרים על טופס שכבר נחתם. */
export const FORM_SIGNED = 'טופס השתתפות חתום';

/** הסבר קצר למה הוא נדרש, לשימוש הבוט. */
export const FORM_PURPOSE =
  'החתימה על הטופס היא שפותחת את כרטיס המתאמן ומאפשרת להתאמן';
