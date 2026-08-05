import test from 'node:test';
import assert from 'node:assert/strict';
import {
  declarationsForStudent,
  healthDeclarationState,
  passPunchBlockReason,
} from './passPunchEligibility.js';

const NOW = '2027-01-15';
const student = { id: 's1', name: 'דנה לוי', parentId: 'p1' };

// הצהרות פגות ב-31.7 של שנה זוגית — חתימה ב-2026-09 תקפה עד 31.7.2028.
const validDecl = { studentId: 's1', signedDate: '2026-09-01', status: 'approved', signature_url: 'health.png' };
const validWaiver = { student_id: 's1', scope: 'wall', signed_at: '2026-09-01', status: 'approved', signature_url: 'wall.png' };
const oldDecl = { studentId: 's1', signedDate: '2024-05-01', waiverAccepted: true };
const safetyTest = (date) => ({ studentId: 's1', test_type: 'security', date, passed: true });

test('הכל בתוקף — מותר לנקב', () => {
  const reason = passPunchBlockReason(
    { student, declarations: [validDecl], waivers: [validWaiver], tests: [safetyTest('2026-12-01')] },
    NOW
  );
  assert.equal(reason, null);
});

test('בלי הצהרת בריאות — חסום', () => {
  const reason = passPunchBlockReason(
    { student, declarations: [], tests: [safetyTest('2026-12-01')] },
    NOW
  );
  assert.match(reason, /דנה לוי/);
  assert.match(reason, /לא נחתמה הצהרת בריאות/);
});

test('בלי מבחן אבטחה — חסום', () => {
  const reason = passPunchBlockReason({ student, declarations: [validDecl], waivers: [validWaiver], tests: [] }, NOW);
  assert.match(reason, /אין מבחן אבטחה/);
});

test('מבחן אבטחה שפג — חסום עם תאריך התפוגה', () => {
  // מבחן ביוני 2026 פג באיפוס של 31.8.2026.
  const reason = passPunchBlockReason(
    { student, declarations: [validDecl], waivers: [validWaiver], tests: [safetyTest('2026-06-01')] },
    NOW
  );
  assert.match(reason, /מבחן האבטחה פג תוקף \(31\.08\.2026\)/);
});

test('שתי הסיבות מופיעות יחד', () => {
  const reason = passPunchBlockReason({ student, declarations: [], tests: [] }, NOW);
  assert.match(reason, /לא נחתמה הצהרת בריאות/);
  assert.match(reason, /אין מבחן אבטחה/);
});

test('הצהרה שפגה מדווחת כפגה ולא כחסרה', () => {
  const state = healthDeclarationState(student, [oldDecl], NOW);
  assert.equal(state.state, 'expired');
  assert.equal(state.signed_at, '2024-05-01');
});

test('חתימה על תיק המתאמן נחשבת גם בלי רשומת הצהרה', () => {
  const state = healthDeclarationState(
    { ...student, healthSignedAt: '2026-09-01T10:00:00.000Z' },
    [],
    NOW
  );
  assert.equal(state.state, 'valid');
});

test('חתימה בלי תאריך אינה מאפשרת ניקוב', () => {
  const state = healthDeclarationState(student, [{ studentId: 's1', waiverAccepted: true }], NOW);
  assert.equal(state.state, 'missing');
});

test('הצהרה שנדחתה אינה נספרת', () => {
  const state = healthDeclarationState(student, [{ ...validDecl, status: 'rejected' }], NOW);
  assert.equal(state.state, 'missing');
});

test('טיוטה בלי שום סימן אישור אינה נספרת', () => {
  const state = healthDeclarationState(
    student,
    [{ studentId: 's1', signedDate: '2026-09-01', waiverAccepted: false }],
    NOW
  );
  assert.equal(state.state, 'missing');
});

test('הצהרה ישנה עם חתימה סרוקה בלבד נספרת', () => {
  const state = healthDeclarationState(
    student,
    [{ studentId: 's1', signedDate: '2026-09-01', waiverAccepted: false, signature_url: 'x.png' }],
    NOW
  );
  assert.equal(state.state, 'valid');
});

test('הצהרה בלי מזהה מתאמן מזוהה לפי שם המטפס בתיק אותו הורה', () => {
  const byName = { parentId: 'p1', climberName: ' דנה   לוי ', signedDate: '2026-09-01', status: 'approved' };
  assert.equal(declarationsForStudent(student, [byName]).length, 1);
  assert.equal(healthDeclarationState(student, [byName], NOW).state, 'valid');
});

test('הצהרה של מתאמן אחר באותה משפחה אינה נספרת', () => {
  const sibling = { parentId: 'p1', climberName: 'נועם לוי', signedDate: '2026-09-01' };
  assert.equal(declarationsForStudent(student, [sibling]).length, 0);
});

test('מבחן אבטחה של מתאמן אחר אינו נספר', () => {
  const reason = passPunchBlockReason(
    {
      student,
      declarations: [validDecl],
      waivers: [validWaiver],
      tests: [{ studentId: 's2', test_type: 'security', date: '2026-12-01', passed: true }],
    },
    NOW
  );
  assert.match(reason, /אין מבחן אבטחה/);
});

test('כרטיסייה בלי מתאמן משויך — חסומה', () => {
  assert.match(passPunchBlockReason({ student: null }, NOW), /לא משויכת למתאמן/);
});
