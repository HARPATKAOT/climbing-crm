/**
 * טיול שעדיין אין לו תאריך, ובכל זאת יש לו רשימה.
 *
 * „אני חושב להוציא טיול סנפלינג” הוא הרגע שבו אנשים הכי מתעניינים, והוא בדיוק
 * הרגע שבו לא היה לנו לאן לרשום אותם: רשימת המתעניינים תלויה באירוע קיים ביומן,
 * והבוט מציע רק אירועים עם תאריך שמסומנים לפרסום. מי ששאל נענה „אין אירועים
 * פתוחים”, והעניין נעלם.
 *
 * רעיון הוא פעילות עם שם, בלי תאריך, שלא מתפרסמת ולא נפתחת להרשמה — אבל כן
 * אוספת מתעניינים. כשנקבע לה תאריך, כל מי שברשימה מקבל הודעה. זו כל התוספת:
 * שדה אחד, ומה שכבר קיים עושה את השאר.
 */

export const IDEA_STATUSES = new Set(['open', 'idea', '']);

export function isActivityIdea(activity) {
  return activity?.collect_interest === true;
}

/** רעיון פעיל — לא בוטל, ועדיין אין לו תאריך. */
export function isOpenIdea(activity) {
  if (!isActivityIdea(activity)) return false;
  if (activity.cancelled || activity.status === 'cancelled') return false;
  return !String(activity.date || '').trim();
}

/**
 * הרעיונות שאפשר להציע ללקוח ששואל על טיולים. אין להם תאריך ולכן אין להם סדר
 * טבעי; הסדר הוא לפי מתי נפתחו, כדי שהחדש לא יקפוץ מעל הוותיק.
 */
export function openActivityIdeas(db, { limit = 8 } = {}) {
  return (db.get('activities') || [])
    .filter(isOpenIdea)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .slice(0, limit)
    .map((activity) => ({
      id: String(activity.id),
      name: String(activity.name || '').trim(),
      description: String(activity.description || '').slice(0, 300),
      location: String(activity.location || '').trim(),
    }));
}

/**
 * האם השמירה הזו היא הרגע שבו הרעיון קיבל תאריך.
 *
 * רק המעבר עצמו מודיע. שמירה נוספת של אותו אירוע אינה בשורה, ולהודיע פעמיים
 * על אותו טיול זה בדיוק מה שגורם לאנשים לצאת מהרשימה.
 */
export function ideaJustScheduled(before = {}, after = {}) {
  if (!isActivityIdea(before)) return false;
  if (String(before.date || '').trim()) return false;
  if (!String(after.date || '').trim()) return false;
  if (after.cancelled || after.status === 'cancelled') return false;
  return true;
}

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function spellOutDay(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return '';
  return `${Number(m[3])} ב${HE_MONTHS[Number(m[2]) - 1]}`;
}

/**
 * ההודעה שיוצאת למי שביקש שנעדכן אותו.
 *
 * היא נפתחת במה שהוא ביקש — הוא ביקש לפני שבועות, ואם לא נזכיר לו למה אנחנו
 * כותבים, ההודעה נקראת כמו פרסומת.
 */
export function ideaScheduledMessage(activity = {}, { firstName = '', link = '' } = {}) {
  const hello = firstName ? `היי ${firstName},` : 'היי,';
  const when = spellOutDay(activity.date);
  const until = activity.end_date && activity.end_date !== activity.date
    ? ` עד ${spellOutDay(activity.end_date)}`
    : '';
  return [
    `${hello} ביקשתם שנעדכן כשיהיה תאריך ל${activity.name || 'פעילות'} — ויש 🎉`,
    when ? `📅 ${when}${until}${activity.start_time ? ` בשעה ${activity.start_time}` : ''}` : '',
    activity.location ? `📍 ${activity.location}` : '',
    link ? `להרשמה: ${link}` : 'נפתח להרשמה בקרוב, ואשלח לכם את הקישור.',
  ].filter(Boolean).join('\n');
}
