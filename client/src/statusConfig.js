// מקור האמת היחיד לסטטוסי לקוח: תווית, צבע, אייקון וסגנון תג לכל סטטוס.
// גם מסך העבודה וגם מסך הלקוחות יונקים מכאן — אין צבעי סטטוס קשיחים במסכים.
// (mockData.js מייצא מחדש את הקבועים האלה, כך שכל היבוא הקיים ממשיך לעבוד.)
import {
  Archive,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  CreditCard,
  FileHeart,
  History,
  UserCheck,
  UserPlus,
} from 'lucide-react';

export const STATUSES = {
  lead_new:         { label: 'ליד חדש', badge: 'badge-blue',   color: '#818CF8', icon: UserPlus },
  details_completed:{ label: 'מילא פרטים', badge: 'badge-cyan', color: '#67E8F9', icon: ClipboardList },
  health_signed:    { label: 'חתם הצהרה', badge: 'badge-amber',  color: '#FCD34D', icon: FileHeart },
  // „ממתין לאישור הרשמה” ולא „לאישור הורה”: מי שנרשם לעצמו אין לו הורה שיאשר,
  // והמצב זהה — שמור לו מקום והוא עוד לא סגר את ההרשמה. הסטטוס הזה בלע גם את
  // „ממתין להרשמה” הישן, שאמר בדיוק את אותו הדבר בלי שמירת מקום מאחוריו.
  awaiting_parent_confirmation: { label: 'שמור · ממתין לאישור הרשמה', badge: 'badge-amber', color: '#FBBF24', icon: UserCheck },
  awaiting_centre_confirmation: { label: 'שמור · ממתין למתנ״ס', badge: 'badge-purple', color: '#C084FC', icon: Building2 },
  intro_scheduled:  { label: 'נקבע אימון הכירות', badge: 'badge-cyan',  color: '#67E8F9', icon: CalendarClock },
  intro_paid:       { label: 'שילם - ממתין להכירות', badge: 'badge-purple', color: '#C084FC', icon: CreditCard },
  registered:       { label: 'חוג פעיל', badge: 'badge-green',  color: '#34D399', icon: CheckCircle2 },
  past_registered:  { label: 'היה רשום בשנה האחרונה', badge: 'badge-cyan', color: '#7DD3FC', icon: History },
  waitlist:         { label: 'רשימת המתנה', badge: 'badge-gray',   color: '#9DA5BE', icon: Clock3 },
  archived:         { label: 'ארכיון', badge: 'badge-gray',   color: '#5A6380', icon: Archive },
};

// The customer journey has one deliberate order everywhere it is presented.
// Keeping the order separate from the object makes filters and pickers immune
// to future metadata edits or alphabetic sorting.
export const STATUS_PROGRESS_ORDER = [
  'lead_new',
  'details_completed',
  'health_signed',
  'awaiting_parent_confirmation',
  'awaiting_centre_confirmation',
  'intro_scheduled',
  'intro_paid',
  'registered',
  'past_registered',
  'waitlist',
  'archived',
];

// אותם שלבים שהשרת מחזיר במשפך (FUNNEL_STAGES בצד השרת), באותו סדר.
export const FUNNEL_STAGE_ORDER = [
  'lead_new',
  'details_completed',
  'health_signed',
  'intro_scheduled',
  'intro_paid',
  'awaiting_parent_confirmation',
  'awaiting_centre_confirmation',
  'registered',
];

/** השלב הבא במסע ההרשמה, לפעולת „קדם שלב”. registered הוא סוף המסלול. */
export function nextFunnelStage(status) {
  const index = FUNNEL_STAGE_ORDER.indexOf(status);
  if (index < 0 || index >= FUNNEL_STAGE_ORDER.length - 1) return null;
  return FUNNEL_STAGE_ORDER[index + 1];
}
