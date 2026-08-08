/**
 * ארבעת חלקי הפירוט של דף האירוע — קהל יעד, מה כלול, מה להביא ומידע חשוב.
 *
 * מוגדרים במקום אחד כי הם מופיעים פעמיים: במסך העריכה, שבו הצוות ממלא אותם,
 * ובדף ההרשמה, שבו הלקוח קורא אותם. אותו סימן ואותו צבע בשניהם — אחרת אותו
 * חלק נראה כמו שני דברים שונים משני צדי אותו תהליך.
 */

import { Users, PackageCheck, Backpack, Info } from 'lucide-react';

export const ACTIVITY_PAGE_FIELDS = [
  {
    key: 'audience',
    label: 'קהל יעד',
    hint: 'למי הפעילות מתאימה — גיל, ניסיון, כושר',
    Icon: Users,
    color: '#A78BFA',
  },
  {
    key: 'included',
    label: 'מה כלול',
    hint: 'ציוד, מדריך, הסעה, כיבוד',
    Icon: PackageCheck,
    color: '#34D399',
  },
  {
    key: 'what_to_bring',
    label: 'מה להביא / ציוד',
    hint: 'מה שהמשתתף מביא בעצמו',
    Icon: Backpack,
    color: '#FBBF24',
  },
  {
    key: 'important_info',
    label: 'מידע חשוב',
    hint: 'שעת מפגש, מזג אוויר, ביטול',
    Icon: Info,
    color: '#38BDF8',
  },
];
