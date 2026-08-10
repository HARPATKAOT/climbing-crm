import { activeEnrollmentGroupIds, studentGroupIds } from './studentGroups.js';

export const DISCOUNT_AUDIENCES = {
  EMPLOYEE_ROLE: 'employee_role',
  ACTIVE_CLASS: 'active_class',
};

export function normalizeDiscountRule(raw = {}) {
  const audience = Object.values(DISCOUNT_AUDIENCES).includes(raw.audience)
    ? raw.audience
    : DISCOUNT_AUDIENCES.EMPLOYEE_ROLE;
  const benefits = (Array.isArray(raw.benefits) ? raw.benefits : [])
    .map((benefit) => ({
      type: benefit.type === 'amount' ? 'amount' : 'percent',
      value: Math.max(0, Math.min(benefit.type === 'amount' ? 100000 : 100, Number(benefit.value) || 0)),
      target: benefit.target === 'products' ? 'products' : benefit.target === 'product_type' ? 'product_type' : 'categories',
      categoryNames: Array.isArray(benefit.categoryNames) ? benefit.categoryNames.map(String).filter(Boolean) : [],
      pricelistIds: Array.isArray(benefit.pricelistIds) ? benefit.pricelistIds.map(String).filter(Boolean) : [],
      productType: benefit.productType || 'product',
      label: String(benefit.label || '').trim(),
    }))
    .filter((benefit) => benefit.value > 0 && (
      benefit.target === 'product_type'
      || benefit.categoryNames.length
      || benefit.pricelistIds.length
    ));
  return {
    name: String(raw.name || '').trim(),
    audience,
    role: audience === DISCOUNT_AUDIENCES.EMPLOYEE_ROLE ? String(raw.role || '').trim() : '',
    group_id: audience === DISCOUNT_AUDIENCES.ACTIVE_CLASS ? String(raw.group_id || '').trim() : '',
    benefits,
    active: raw.active !== false,
  };
}

export function employeeForStudent(db, studentId) {
  return (db.get('employees') || []).find((employee) => (
    employee.is_active !== false
    && String(employee.customer_student_id || '') === String(studentId || '')
  )) || null;
}

function activeGroupsFor(db, student) {
  const enrollments = db.get('enrollments') || [];
  const enrolled = activeEnrollmentGroupIds(enrollments, student?.id);
  if (enrolled.length) return enrolled;
  const status = String(student?.status || '').toLowerCase();
  if (['archived', 'past_registered', 'cancelled', 'inactive'].includes(status)) return [];
  return studentGroupIds(student);
}

export function ruleMatchesStudent(db, rule, studentId) {
  if (!rule?.active || !studentId) return false;
  const student = db.getOne('students', studentId);
  if (!student) return false;
  if (rule.audience === DISCOUNT_AUDIENCES.EMPLOYEE_ROLE) {
    const employee = employeeForStudent(db, studentId);
    return Boolean(employee && (employee.certifications || []).map(String).includes(String(rule.role)));
  }
  if (rule.audience === DISCOUNT_AUDIENCES.ACTIVE_CLASS) {
    const groups = activeGroupsFor(db, student);
    return rule.group_id ? groups.includes(String(rule.group_id)) : groups.length > 0;
  }
  return false;
}

export function matchingDiscountRules(db, studentId) {
  return (db.get('discount_rules') || [])
    .filter((rule) => ruleMatchesStudent(db, rule, studentId));
}

export function offerForDiscountRule(rule) {
  return {
    type: 'ruleset',
    label: rule.name || 'הנחה לפי זכאות',
    validityDays: 365,
    noExpiry: true,
    parts: (rule.benefits || []).map((benefit) => ({
      type: benefit.type,
      value: benefit.value,
      units: 50,
      appliesTo: benefit.target === 'products'
        ? 'items'
        : benefit.target === 'product_type'
          ? 'product_type'
          : 'categories',
      pricelistIds: benefit.pricelistIds,
      categoryNames: benefit.categoryNames,
      productType: benefit.productType,
      label: benefit.label || rule.name || 'הנחת זכאות',
    })),
  };
}
