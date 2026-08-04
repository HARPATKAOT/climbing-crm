/**
 * אייקון לכל סוג עבודה.
 *
 * העין תופסת צורה מהר יותר משהיא קוראת מילה, ורשימת תעריפים או פירוט שכר
 * הופכת לקריאה כשכל תפקיד נושא סימן משלו. המיפוי הוא לפי מפתח התפקיד בשרת
 * ולא לפי התווית, כדי ששינוי שם של תפקיד לא יאפס לו את האייקון; התוויות
 * משמשות רק כגיבוי לקוד שמחזיק בשם בעברית בלבד.
 */

import {
  GraduationCap, HandHelping, Mountain, ArrowDownToLine, User, Route,
  ConciergeBell, Car, Briefcase,
} from 'lucide-react';
import { SYSTEM_ROLE_KEYS, DEFAULT_ROLE_LABELS } from './staffRoles.js';

const BY_KEY = {
  [SYSTEM_ROLE_KEYS.TRAINER]: GraduationCap,
  [SYSTEM_ROLE_KEYS.ASSISTANT]: HandHelping,
  [SYSTEM_ROLE_KEYS.WALL_OPERATOR]: Mountain,
  [SYSTEM_ROLE_KEYS.RAPPEL]: ArrowDownToLine,
  [SYSTEM_ROLE_KEYS.PRIVATE]: User,
  [SYSTEM_ROLE_KEYS.ROUTE]: Route,
};

/** התוויות ההיסטוריות — גם אחרי שינוי שם, השם הישן עדיין מוצא את האייקון. */
const BY_LABEL = Object.entries(DEFAULT_ROLE_LABELS).reduce((acc, [key, label]) => {
  acc[label] = BY_KEY[key];
  return acc;
}, {
  'הדרכת חוג': GraduationCap,
  'מדריך חוג': GraduationCap,
  'משמרת דלפק': ConciergeBell,
  'דלפק': ConciergeBell,
  'נסיעות': Car,
});

/** סוגי העבודה של שורת שכר, שאינם תפקיד מהקטלוג. */
const BY_WORK_TYPE = {
  counter_shift: ConciergeBell,
  class_shift: GraduationCap,
  private_shift: User,
  route_building_shift: Route,
};

/**
 * האייקון של תפקיד. מקבל תווית בעברית, ואם ידוע — גם את מפתח התפקיד בשרת,
 * שגובר עליה. תפקיד לא מוכר מקבל אייקון עבודה כללי, ולא כלום.
 */
export function roleIcon(role, key) {
  return BY_KEY[key] || BY_LABEL[String(role || '').trim()] || Briefcase;
}

/** האייקון של סוג עבודה בשורת שכר (counter_shift וחבריו). */
export function workTypeIcon(workType) {
  return BY_WORK_TYPE[workType] || Briefcase;
}

/**
 * אייקונים לבחירה בתיק העובד (במקום אותיות השם בעיגול).
 * המפתח נשמר על העובד ב־avatar_icon — יציב גם אם משנים תווית תפקיד.
 */
export const AVATAR_ICON_OPTIONS = [
  { key: 'user', Icon: User, label: 'אישי' },
  { key: SYSTEM_ROLE_KEYS.TRAINER, Icon: GraduationCap, label: 'הדרכת חוג' },
  { key: SYSTEM_ROLE_KEYS.ASSISTANT, Icon: HandHelping, label: 'עוזר מדריך' },
  { key: SYSTEM_ROLE_KEYS.WALL_OPERATOR, Icon: Mountain, label: 'הפעלת קיר' },
  { key: SYSTEM_ROLE_KEYS.RAPPEL, Icon: ArrowDownToLine, label: 'סנפלינג' },
  { key: SYSTEM_ROLE_KEYS.ROUTE, Icon: Route, label: 'בונה מסלולים' },
  { key: 'desk', Icon: ConciergeBell, label: 'דלפק' },
  { key: 'travel', Icon: Car, label: 'נסיעות' },
  { key: 'briefcase', Icon: Briefcase, label: 'אחר' },
];

const AVATAR_BY_KEY = Object.fromEntries(
  AVATAR_ICON_OPTIONS.map(({ key, Icon }) => [key, Icon])
);

/** אייקון התיק של העובד לפי השדה השמור, עם נפילה לצללית כללית. */
export function employeeAvatarIcon(avatarKey) {
  return AVATAR_BY_KEY[avatarKey] || User;
}

export { Car as travelIcon };
