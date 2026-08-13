/**
 * האייקון של שורת מחירון.
 *
 * ברשימה של שתים-עשרה שורות שכולן מתחילות ב„יום” או ב„פעילות”, השם לבדו לא
 * מספיק כדי למצוא את השורה הנכונה במבט — במיוחד בתוך בורר צר שחותך את הסוף.
 * האייקון הוא מה שמבדיל ביניהן לפני שקוראים.
 *
 * שלושה שלבים: שורות הזרע לפי המזהה היציב שלהן, ואחריהן מילות מפתח בשם — כדי
 * ששורה שהבעלים יצר בעצמו („יום כיף לגן”) תקבל גם היא משהו הגיוני — ולבסוף
 * ברירת מחדל לפי הקטגוריה.
 */
import {
  ArrowDownFromLine, Backpack, Cake, CalendarRange, Dumbbell, GraduationCap,
  Handshake, Mountain, PartyPopper, Sparkles, Tent, Users,
} from 'lucide-react';

const DEFAULT_WALL = { Icon: PartyPopper, color: '#FB923C' };
// יציאות השטח כאן הן ימי סנפלינג וטיפוס, לא הליכה — ולכן תרמיל ולא עקבות.
const DEFAULT_FIELD = { Icon: Backpack, color: '#34D399' };

/** שורות הזרע, לפי המזהה. */
const BY_ID = {
  // „יום טיול” הוא יום סנפלינג מלא: התרמיל אומר יום בשטח, והחץ היורד שמור
  // לגלישה עצמה — פעילות בודדת ולא יום.
  pr_field_trip_day: { Icon: Backpack, color: '#34D399' },
  pr_field_rappel: { Icon: ArrowDownFromLine, color: '#60A5FA' },
  pr_field_climb_day: { Icon: Mountain, color: '#A78BFA' },
  pr_wall_camp_hosting: { Icon: Tent, color: '#F472B6' },
  pr_wall_company_day: { Icon: Handshake, color: '#FBBF24' },
  pr_wall_birthday_structured: { Icon: Cake, color: '#FB923C' },
  pr_wall_birthday_open: { Icon: PartyPopper, color: '#F97316' },
  pr_wall_school_bonding_morning: { Icon: Users, color: '#A78BFA' },
  pr_wall_school_bonding_noon: { Icon: Users, color: '#C4B5FD' },
  pr_wall_school_single: { Icon: GraduationCap, color: '#60A5FA' },
  pr_wall_school_series_5: { Icon: CalendarRange, color: '#34D399' },
  pr_wall_school_series_10: { Icon: CalendarRange, color: '#22D3EE' },
};

/**
 * מילות מפתח בשם. הסדר קובע — „סדרת פעילות לבתי ספר” היא סדרה לפני שהיא בית
 * ספר, ולכן „סדר”/„מפגש” נבדקות לפני „ספר”.
 */
const BY_KEYWORD = [
  [/סדר|מפגש/, { Icon: CalendarRange, color: '#34D399' }],
  [/קייטנ/, { Icon: Tent, color: '#F472B6' }],
  [/הולדת/, { Icon: Cake, color: '#FB923C' }],
  [/גיבוש|כיתה|כיתות/, { Icon: Users, color: '#A78BFA' }],
  [/ספר|תלמיד|גן /, { Icon: GraduationCap, color: '#60A5FA' }],
  [/חבר|עסק|צוות|הייטק/, { Icon: Handshake, color: '#FBBF24' }],
  [/גליש|סנפל|מצוק|רפל/, { Icon: ArrowDownFromLine, color: '#60A5FA' }],
  [/טיפוס|מערה|מערנ/, { Icon: Mountain, color: '#A78BFA' }],
  [/טיול|נחל|מסלול|הליכ/, { Icon: Backpack, color: '#34D399' }],
  [/אימון|אישי|זוגי/, { Icon: Dumbbell, color: '#38BDF8' }],
  [/יום כיף|חוויה|כיף/, { Icon: Sparkles, color: '#7DD3FC' }],
];

export function priceRuleIcon(rule) {
  if (!rule) return DEFAULT_WALL;
  const byId = BY_ID[rule.id];
  if (byId) return byId;
  const name = String(rule.name || '');
  for (const [pattern, icon] of BY_KEYWORD) {
    if (pattern.test(name)) return icon;
  }
  return rule.category === 'field' ? DEFAULT_FIELD : DEFAULT_WALL;
}
