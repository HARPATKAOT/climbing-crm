/**
 * אייקון וצבע לכל סוג עבודה.
 *
 * העין תופסת צורה וצבע מהר יותר משהיא קוראת מילה. המיפוי הוא לפי מפתח
 * התפקיד בשרת ולא לפי התווית, כדי ששינוי שם של תפקיד לא יאפס לו את הסימן;
 * התוויות משמשות רק כגיבוי לקוד שמחזיק בשם בעברית בלבד.
 */

import {
  GraduationCap, HandHelping, Mountain, ArrowDownToLine, User, Route,
  ConciergeBell, Car, Briefcase,
} from 'lucide-react';
import { SYSTEM_ROLE_KEYS, DEFAULT_ROLE_LABELS } from './staffRoles.js';

/** צבעים על רקע כהה — כל תפקיד בגוון שונה, קריא ולא זוהר מדי. */
const COLOR_BY_KEY = {
  [SYSTEM_ROLE_KEYS.TRAINER]: '#60A5FA',       // כחול — הדרכת חוג
  [SYSTEM_ROLE_KEYS.ASSISTANT]: '#FBBF24',     // זהוב — עוזר מדריך
  [SYSTEM_ROLE_KEYS.WALL_OPERATOR]: '#2DD4BF', // טורקיז — הפעלת קיר
  [SYSTEM_ROLE_KEYS.RAPPEL]: '#A78BFA',        // סגול — סנפלינג
  [SYSTEM_ROLE_KEYS.PRIVATE]: '#FB7185',       // ורוד — שיעור פרטי
  [SYSTEM_ROLE_KEYS.ROUTE]: '#A3E635',         // ירוק־ליים — בונה מסלולים
};

const COLOR_EXTRA = {
  desk: '#38BDF8',
  travel: '#94A3B8',
  briefcase: '#94A3B8',
  user: '#CBD5E1',
};

const FALLBACK_COLOR = '#94A3B8';

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

const COLOR_BY_LABEL = Object.entries(DEFAULT_ROLE_LABELS).reduce((acc, [key, label]) => {
  acc[label] = COLOR_BY_KEY[key];
  return acc;
}, {
  'הדרכת חוג': COLOR_BY_KEY[SYSTEM_ROLE_KEYS.TRAINER],
  'מדריך חוג': COLOR_BY_KEY[SYSTEM_ROLE_KEYS.TRAINER],
  'משמרת דלפק': COLOR_EXTRA.desk,
  'דלפק': COLOR_EXTRA.desk,
  'נסיעות': COLOR_EXTRA.travel,
});

/** סוגי העבודה של שורת שכר, שאינם תפקיד מהקטלוג. */
const BY_WORK_TYPE = {
  counter_shift: ConciergeBell,
  class_shift: GraduationCap,
  private_shift: User,
  route_building_shift: Route,
};

const COLOR_BY_WORK_TYPE = {
  counter_shift: COLOR_EXTRA.desk,
  class_shift: COLOR_BY_KEY[SYSTEM_ROLE_KEYS.TRAINER],
  private_shift: COLOR_BY_KEY[SYSTEM_ROLE_KEYS.PRIVATE],
  route_building_shift: COLOR_BY_KEY[SYSTEM_ROLE_KEYS.ROUTE],
};

/**
 * האייקון של תפקיד. מקבל תווית בעברית, ואם ידוע — גם את מפתח התפקיד בשרת,
 * שגובר עליה. תפקיד לא מוכר מקבל אייקון עבודה כללי, ולא כלום.
 */
export function roleIcon(role, key) {
  return BY_KEY[key] || BY_LABEL[String(role || '').trim()] || Briefcase;
}

/** הצבע הקבוע של תפקיד — אותו גוון בכל המסך. */
export function roleColor(role, key) {
  if (key && COLOR_BY_KEY[key]) return COLOR_BY_KEY[key];
  const label = String(role || '').trim();
  return COLOR_BY_LABEL[label] || FALLBACK_COLOR;
}

/** האייקון של סוג עבודה בשורת שכר (counter_shift וחבריו). */
export function workTypeIcon(workType) {
  return BY_WORK_TYPE[workType] || Briefcase;
}

export function workTypeColor(workType) {
  return COLOR_BY_WORK_TYPE[workType] || FALLBACK_COLOR;
}

/**
 * אייקונים לבחירה בתיק העובד (במקום אותיות השם בעיגול).
 * המפתח נשמר על העובד ב־avatar_icon — יציב גם אם משנים תווית תפקיד.
 */
export const AVATAR_ICON_OPTIONS = [
  { key: 'user', Icon: User, label: 'אישי', color: COLOR_EXTRA.user },
  { key: SYSTEM_ROLE_KEYS.TRAINER, Icon: GraduationCap, label: 'הדרכת חוג', color: COLOR_BY_KEY[SYSTEM_ROLE_KEYS.TRAINER] },
  { key: SYSTEM_ROLE_KEYS.ASSISTANT, Icon: HandHelping, label: 'עוזר מדריך', color: COLOR_BY_KEY[SYSTEM_ROLE_KEYS.ASSISTANT] },
  { key: SYSTEM_ROLE_KEYS.WALL_OPERATOR, Icon: Mountain, label: 'הפעלת קיר', color: COLOR_BY_KEY[SYSTEM_ROLE_KEYS.WALL_OPERATOR] },
  { key: SYSTEM_ROLE_KEYS.RAPPEL, Icon: ArrowDownToLine, label: 'סנפלינג', color: COLOR_BY_KEY[SYSTEM_ROLE_KEYS.RAPPEL] },
  { key: SYSTEM_ROLE_KEYS.ROUTE, Icon: Route, label: 'בונה מסלולים', color: COLOR_BY_KEY[SYSTEM_ROLE_KEYS.ROUTE] },
  { key: 'desk', Icon: ConciergeBell, label: 'דלפק', color: COLOR_EXTRA.desk },
  { key: 'travel', Icon: Car, label: 'נסיעות', color: COLOR_EXTRA.travel },
  { key: 'briefcase', Icon: Briefcase, label: 'אחר', color: COLOR_EXTRA.briefcase },
];

const AVATAR_BY_KEY = Object.fromEntries(
  AVATAR_ICON_OPTIONS.map(({ key, Icon }) => [key, Icon])
);
const AVATAR_COLOR_BY_KEY = Object.fromEntries(
  AVATAR_ICON_OPTIONS.map(({ key, color }) => [key, color])
);

/** אייקון התיק של העובד לפי השדה השמור, עם נפילה לצללית כללית. */
export function employeeAvatarIcon(avatarKey) {
  return AVATAR_BY_KEY[avatarKey] || User;
}

export function employeeAvatarColor(avatarKey) {
  return AVATAR_COLOR_BY_KEY[avatarKey] || COLOR_EXTRA.user;
}

export { Car as travelIcon };
export const travelColor = COLOR_EXTRA.travel;
