/**
 * עלות שכר אמיתית ורווחיות פר חוג/מדריך — FINANCE_SPEC שלב 5.
 *
 * שני כללים קשיחים:
 *  1. קוראים אך ורק סכומים קפואים (pay_amount שנחתם על שורת העבודה).
 *     המודול הזה לא מקבל תעריפים בכלל — כלל הקפאת השכר לא ניתן להפרה כאן.
 *  2. עלות מעביד = ברוטו × מקדם (ביטוח לאומי מעסיק, פנסיה, פיצויים).
 *     אין נתוני אמת לרכיבים — המקדם גלוי, ניתן לכיול, ומסומן כהערכה.
 */

import { toAgorot } from './financeMoney.js';

export const DEFAULT_EMPLOYER_COST_FACTOR = 1.28;

export function employerCostFactor(settingsRows = []) {
  const settings = settingsRows.find((row) => row.id === 'default');
  const factor = Number(settings?.employer_cost_factor);
  return Number.isFinite(factor) && factor >= 1 && factor <= 2 ? factor : DEFAULT_EMPLOYER_COST_FACTOR;
}

const monthOf = (value) => String(value || '').slice(0, 7);

/**
 * שורות עלות עבודה: רק שורות עם שכר קפוא. wage = שכר + נסיעות;
 * employer_cost = wage × מקדם. שורה בלי pay_amount עדיין לא נחתמה — נספרת
 * בנפרד כדי שהדוח יגיד "יש עבודה שטרם תומחרה", לא יעלים אותה.
 */
export function laborCostRows({ workAssignments = [], factor = DEFAULT_EMPLOYER_COST_FACTOR } = {}) {
  const rows = [];
  const unpriced = [];
  for (const assignment of workAssignments) {
    const frozen = Number(assignment.pay_amount);
    if (!Number.isFinite(frozen)) {
      unpriced.push({ id: assignment.id, employee_id: assignment.employee_id, date: assignment.date });
      continue;
    }
    const wageAgorot = toAgorot(frozen) + toAgorot(Number(assignment.travel_amount) || 0);
    rows.push({
      assignment_id: assignment.id,
      employee_id: String(assignment.employee_id || ''),
      date: String(assignment.date || '').slice(0, 10),
      month: monthOf(assignment.date),
      group_id: assignment.group_id ? String(assignment.group_id) : null,
      activity_id: assignment.activity_id ? String(assignment.activity_id) : null,
      work_type: assignment.work_type || '',
      hours: Number(assignment.hours) || 0,
      wage_agorot: wageAgorot,
      employer_cost_agorot: Math.round(wageAgorot * factor),
    });
  }
  return { rows, unpriced };
}

/** עלות מעביד אפקטיבית לשעה, פר עובד. שורות flat בלי שעות נספרות בעלות בלבד. */
export function effectiveCostPerHour(rows = []) {
  const byEmployee = new Map();
  for (const row of rows) {
    const entry = byEmployee.get(row.employee_id) || { employee_id: row.employee_id, hours: 0, wage_agorot: 0, employer_cost_agorot: 0, days: new Set() };
    entry.hours += row.hours;
    entry.wage_agorot += row.wage_agorot;
    entry.employer_cost_agorot += row.employer_cost_agorot;
    entry.days.add(row.date);
    byEmployee.set(row.employee_id, entry);
  }
  return [...byEmployee.values()].map((entry) => ({
    employee_id: entry.employee_id,
    hours: Math.round(entry.hours * 100) / 100,
    days: entry.days.size,
    wage_agorot: entry.wage_agorot,
    employer_cost_agorot: entry.employer_cost_agorot,
    cost_per_hour_agorot: entry.hours > 0 ? Math.round(entry.employer_cost_agorot / entry.hours) : null,
  })).sort((a, b) => b.employer_cost_agorot - a.employer_cost_agorot);
}

/** קיבוץ עלות לפי מפתח שיוך (group_id / activity_id). */
export function costByKey(rows = [], key) {
  const grouped = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    const entry = grouped.get(value) || { [key]: value, hours: 0, employer_cost_agorot: 0, employees: new Set() };
    entry.hours += row.hours;
    entry.employer_cost_agorot += row.employer_cost_agorot;
    entry.employees.add(row.employee_id);
    grouped.set(value, entry);
  }
  return [...grouped.values()].map((entry) => ({ ...entry, employees: [...entry.employees] }));
}

/** הרשמה פעילה בחודש נתון: לא בוטלה, והחלון שלה חופף את החודש. */
export function enrollmentActiveInMonth(enrollment, month) {
  if (['cancelled', 'canceled', 'ended', 'left'].includes(String(enrollment.status || '').toLowerCase())) return false;
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  const start = String(enrollment.start_date || '').slice(0, 10);
  const end = String(enrollment.end_date || '').slice(0, 10);
  if (start && start > monthEnd) return false;
  if (end && end < monthStart) return false;
  return true;
}

/**
 * רווחיות פר חוג לחודש: הכנסה (מחירי ההרשמות הפעילות) − עלות מדריך קפואה ×
 * מקדם מעביד − הקצאת עקיפות (מגיעה מבחוץ, שלב 6). כולל נקודת איזון: כמה
 * חניכים במחיר הממוצע מכסים את העלות.
 */
export function classProfitability({
  groups = [],
  enrollments = [],
  laborRows = [],
  month,
  overheadByGroupAgorot = new Map(),
} = {}) {
  const laborByGroup = new Map(costByKey(laborRows.filter((row) => row.month === month), 'group_id')
    .map((entry) => [entry.group_id, entry]));
  return groups.map((group) => {
    const active = enrollments.filter((enrollment) =>
      String(enrollment.group_id) === String(group.id) && enrollmentActiveInMonth(enrollment, month));
    const revenueAgorot = active.reduce((sum, enrollment) => sum + toAgorot(Number(enrollment.price) || 0), 0);
    const labor = laborByGroup.get(String(group.id)) || { hours: 0, employer_cost_agorot: 0, employees: [] };
    const overheadAgorot = overheadByGroupAgorot.get(String(group.id)) || 0;
    const totalCostAgorot = labor.employer_cost_agorot + overheadAgorot;
    const profitAgorot = revenueAgorot - totalCostAgorot;
    const averagePriceAgorot = active.length ? Math.round(revenueAgorot / active.length) : 0;
    return {
      group_id: String(group.id),
      name: group.name || '',
      trainer_id: group.trainer ? String(group.trainer) : null,
      month,
      students: active.length,
      revenue_agorot: revenueAgorot,
      labor_cost_agorot: labor.employer_cost_agorot,
      labor_hours: Math.round(labor.hours * 100) / 100,
      overhead_agorot: overheadAgorot,
      profit_agorot: profitAgorot,
      margin: revenueAgorot > 0 ? Math.round((profitAgorot / revenueAgorot) * 1000) / 10 : null,
      breakeven_students: averagePriceAgorot > 0 ? Math.ceil(totalCostAgorot / averagePriceAgorot) : null,
    };
  }).sort((a, b) => b.profit_agorot - a.profit_agorot);
}

/** רווחיות פר מדריך: ההכנסה שנוצרה בחוגים שלו מול העלות שלו באותו חודש. */
export function instructorProfitability({ classRows = [], laborRows = [], month } = {}) {
  const monthLabor = laborRows.filter((row) => row.month === month);
  const byEmployee = new Map();
  for (const labor of monthLabor) {
    const entry = byEmployee.get(labor.employee_id) || { employee_id: labor.employee_id, hours: 0, cost_agorot: 0, revenue_agorot: 0, groups: new Set() };
    entry.hours += labor.hours;
    entry.cost_agorot += labor.employer_cost_agorot;
    byEmployee.set(labor.employee_id, entry);
  }
  for (const classRow of classRows) {
    if (!classRow.trainer_id) continue;
    const entry = byEmployee.get(classRow.trainer_id);
    if (!entry) continue;
    entry.revenue_agorot += classRow.revenue_agorot;
    entry.groups.add(classRow.group_id);
  }
  return [...byEmployee.values()].map((entry) => ({
    ...entry,
    groups: [...entry.groups],
    hours: Math.round(entry.hours * 100) / 100,
    revenue_per_cost: entry.cost_agorot > 0 ? Math.round((entry.revenue_agorot / entry.cost_agorot) * 100) / 100 : null,
  })).sort((a, b) => b.revenue_agorot - a.revenue_agorot);
}
