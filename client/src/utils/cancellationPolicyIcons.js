import { Ban, CreditCard, PackageCheck, CalendarX2, ShieldCheck } from 'lucide-react';

/**
 * אייקון לכל מדיניות ביטול. נגזר מהשם ולא נשמר בנפרד — שם המדיניות הוא ממילא
 * מה שאומר על מה היא חלה, ושדה נוסף היה עוד דבר לתחזק.
 *
 * יושב כאן ולא בתוך מסך אחד כי אותה מדיניות מופיעה בעורך האירוע, ברשימת
 * המדיניות בהגדרות ובכרטיס המוצר — ואם כל מסך גוזר לבד, אותה מדיניות מקבלת
 * אייקון אחר בכל מקום.
 *
 * `value` יכול להיות מזהה מדיניות או אחד מערכי "ללא מדיניות" שהמסכים מכירים.
 */
export function cancellationPolicyIcon(value, policies = []) {
  if (value === '__none__' || value === 'none' || !value) return { Icon: Ban, color: '#F87171' };
  return policyIconFor(policies.find((item) => String(item.id) === String(value)));
}

/** אותה גזירה כשכבר מחזיקים את המדיניות עצמה ולא רק את המזהה שלה. */
export function policyIconFor(policy) {
  const name = String(policy?.name || '').toLowerCase();
  if (/כרטיס|מנוי|כניס/.test(name)) return { Icon: CreditCard, color: '#FBBF24' };
  if (/ציוד|השכר|רתמ|נעל/.test(name)) return { Icon: PackageCheck, color: '#FB923C' };
  if (/אירוע|טיול|פעילות|סדנ/.test(name)) return { Icon: CalendarX2, color: '#A78BFA' };
  return { Icon: ShieldCheck, color: '#A78BFA' };
}

export default cancellationPolicyIcon;
