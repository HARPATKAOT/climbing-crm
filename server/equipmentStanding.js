/**
 * איפה משפחה עומדת עם הציוד — עכשיו, ובמילים.
 *
 * שני חורים נסגרים כאן. הראשון: קישור ציוד נשלח, ואם איש לא שילם — לא קרה
 * כלום. אף תזכורת לא נקבעה, ושני הקישורים פשוט פגו אחרי חודש. השני הפוך:
 * מי ששילם, או שסימן שיש לו כבר נעליים מהבית, לא קיבל על כך מילה — הוא נשאר
 * עם דף שנסגר ובלי אישור שהעניין הסתיים.
 *
 * המצב נקרא כאן ברגע השליחה ולא ברגע הקביעה, כי בין השניים עובר יום שלם:
 * הודעה שנכתבה אתמול „הציוד לא שולם” היא בדיוק ההודעה שגורמת להורה ששילם
 * הבוקר לענות „אבל שילמתי”.
 */

import {
  EQUIPMENT_ITEM_LABELS,
  isEquipmentEligibleStudent,
} from './equipmentService.js';

/** שמות פריטים ברשימה אחת קריאה: „נעלי טיפוס, חולצה”. */
export function labelItems(itemTypes = [], shirtSize = null) {
  return (Array.isArray(itemTypes) ? itemTypes : [])
    .map((type) => {
      const label = EQUIPMENT_ITEM_LABELS[type] || type;
      return type === 'shirt' && shirtSize ? `${label} (מידה ${shirtSize})` : label;
    })
    .filter(Boolean)
    .join(', ');
}

function firstNameOf(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/**
 * Who owes equipment at all.
 *
 * Every trainee card carries a row per item, so an untouched lead reads as
 * three unpaid items — and a family of two registered children was about to be
 * chased for a third name that was never placed anywhere. The obligation
 * starts at placement, so that is where the nudge starts too. What was already
 * paid or declared from home still counts for everyone: that is a fact about
 * the trainee, not a demand on the parent.
 */
const OWES_EQUIPMENT_STATUSES = new Set([
  'pending_signup', 'awaiting_parent_confirmation', 'awaiting_centre_confirmation',
  'registered', 'active',
]);

/**
 * שורות הציוד של כל מתאמן במשפחה, מחולקות למה שחסר, מה שנרכש ומה שכבר היה
 * בבית. מתאמן שאינו זכאי לציוד כלל אינו מופיע — אין עליו מה לומר.
 */
export function familyEquipmentStanding(db, { students = [] } = {}) {
  const rows = db.get('student_equipment') || [];
  const members = [];

  for (const student of students) {
    if (!isEquipmentEligibleStudent(student)) continue;
    const mine = rows.filter(
      (row) => String(row.student_id || row.studentId || '') === String(student.id)
    );
    if (!mine.length) continue;
    const pick = (status) => mine
      .filter((row) => row.payment_status === status)
      .map((row) => row.item_type || row.itemType)
      .filter(Boolean);
    const shirt = mine.find((row) => (row.item_type || row.itemType) === 'shirt');
    const owes = OWES_EQUIPMENT_STATUSES.has(String(student.status || ''));
    members.push({
      student_id: student.id,
      name: student.name || '',
      first_name: firstNameOf(student.name),
      unpaid: owes ? pick('unpaid') : [],
      paid: pick('paid'),
      own: pick('own'),
      shirt_size: shirt?.shirt_size || null,
    });
  }

  return {
    members,
    open: members.filter((m) => m.unpaid.length),
    resolved: members.filter((m) => !m.unpaid.length && (m.paid.length || m.own.length)),
    hasOpen: members.some((m) => m.unpaid.length),
  };
}

/**
 * המשפט על הציוד שעדיין פתוח, לצירוף להודעת מעקב.
 *
 * בלי הקישור אין מה לומר: „הציוד לא שולם” בלי דרך לשלם הוא נזיפה, לא שירות.
 */
export function equipmentOpenLine(standing, { link = '', selfTrainee = false } = {}) {
  const open = standing?.open || [];
  if (!open.length || !link) return '';
  // Naming the customer to the customer ("הציוד לא הוסדר — פנינה (…)") reads
  // as a message about a third party. An adult training on her own is "you".
  const who = selfTrainee && open.length === 1
    ? labelItems(open[0].unpaid, open[0].shirt_size)
    : open
      .map((m) => `${m.first_name || m.name} (${labelItems(m.unpaid, m.shirt_size)})`)
      .join(', ');
  return [
    `אגב, אני רואה שהציוד עדיין לא הוסדר — ${who}.`,
    `כאן משלימים, וגם מסמנים פריט שכבר יש מהבית: ${link}`,
  ].join('\n');
}

/**
 * ההודעה שנשלחת אחרי שהציוד נסגר.
 *
 * מפורטת בכוונה: מה נרכש ולמי, מה נרשם כבר קיים בבית, ומשפט אחד שאומר
 * שאין יותר מה לעשות. הורה ששילם עבור שני ילדים בעסקה אחת רוצה לראות ששניהם
 * מכוסים, ומי שסימן „יש לנו נעליים” רוצה לדעת שזה נקלט ולא ייחשב לו כחוב.
 */
export function equipmentReceiptMessage(standing, { firstName = '' } = {}) {
  const members = standing?.members || [];
  const bought = members.filter((m) => m.paid.length);
  const fromHome = members.filter((m) => m.own.length);
  if (!bought.length && !fromHome.length) return '';

  const lines = [firstName ? `תודה ${firstName}! 🙏` : 'תודה! 🙏'];
  if (bought.length) {
    lines.push('נקלט אצלנו התשלום על הציוד:');
    for (const m of bought) {
      lines.push(`• ${m.name || m.first_name} — ${labelItems(m.paid, m.shirt_size)}`);
    }
    lines.push('הציוד יחכה באימון הראשון.');
  }
  if (fromHome.length) {
    lines.push(bought.length ? 'ורשמנו שכבר יש מהבית:' : 'רשמנו שכבר יש מהבית:');
    for (const m of fromHome) {
      lines.push(`• ${m.name || m.first_name} — ${labelItems(m.own, m.shirt_size)}`);
    }
  }
  lines.push(standing.hasOpen
    ? 'נשאר עוד פריט אחד או יותר להסדרה — הקישור פתוח וממשיכים ממנו.'
    : 'זהו, אין צורך בפעולות נוספות מבחינת הציוד.');
  return lines.join('\n');
}
