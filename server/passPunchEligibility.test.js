import test from 'node:test';
import assert from 'node:assert/strict';
import {
  declarationsForStudent,
  healthDeclarationState,
  passPunchBlockReason,
  passPunchSafetyNote,
  wallDocumentsStatus,
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

test('בלי הצהרת בריאות — חסום, ובמשפט אחד שאפשר לפעול לפיו', () => {
  const reason = passPunchBlockReason(
    { student, declarations: [], tests: [safetyTest('2026-12-01')] },
    NOW
  );
  assert.equal(reason, 'לא ניתן להכניס לפני חתימה על אישור השתתפות');
});

// המתאמן נכנס, מנקב, ורק אז יוצא עם המדריך לתדריך ולמבחן — חסימה כאן הייתה
// מונעת ניקוב בדיוק ברגע שבו עוד לא ייתכן שיהיה לו מבחן.
test('בלי מבחן אבטחה — מותר לנקב, עם הערה לדלפק', () => {
  const args = { student, declarations: [validDecl], waivers: [validWaiver], tests: [] };
  assert.equal(passPunchBlockReason(args, NOW), null);
  assert.match(passPunchSafetyNote(args, NOW), /אין עדיין מבחן אבטחה/);
});

test('מבחן אבטחה שפג — מותר לנקב, וההערה נושאת את תאריך התפוגה', () => {
  // מבחן ביוני 2026 פג באיפוס של 31.8.2026.
  const args = { student, declarations: [validDecl], waivers: [validWaiver], tests: [safetyTest('2026-06-01')] };
  assert.equal(passPunchBlockReason(args, NOW), null);
  assert.match(passPunchSafetyNote(args, NOW), /פג תוקף \(31\.08\.2026\)/);
});

test('מבחן אבטחה בתוקף — אין הערה', () => {
  const args = { student, declarations: [validDecl], waivers: [validWaiver], tests: [safetyTest('2026-12-01')] };
  assert.equal(passPunchSafetyNote(args, NOW), null);
});

test('שני מסמכים חסרים הם עדיין מחסום אחד ופעולה אחת', () => {
  // איזה מסמך חסר ומתי פג אינו משנה למי שעומד בדלפק — הפעולה זהה, והפירוט
  // רק מאריך משפט שצריך להיקרא בשנייה.
  const reason = passPunchBlockReason({ student, declarations: [], waivers: [], tests: [] }, NOW);
  assert.equal(reason, 'לא ניתן להכניס לפני חתימה על אישור השתתפות');
  assert.doesNotMatch(reason, /מבחן אבטחה/);
});

test('חסימה רפואית אינה מוסווית כבקשה לחתום', () => {
  // קישור לחתימה לא יסיר חסימה רפואית; משפט שאומר „לחתום” היה שולח את הדלפק
  // לעשות בדיוק את הדבר שלא יעזור.
  const held = passPunchBlockReason(
    { student, declarations: [validDecl], waivers: [validWaiver], healthHolds: [{ student_id: 's1', created_at: '2026-08-01' }] },
    NOW
  );
  assert.match(held, /חסימה רפואית/);
  assert.doesNotMatch(held, /חתימה/);
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
  const note = passPunchSafetyNote(
    {
      student,
      tests: [{ studentId: 's2', test_type: 'security', date: '2026-12-01', passed: true }],
    },
    NOW
  );
  assert.match(note, /אין עדיין מבחן אבטחה/);
});

test('כרטיסייה בלי מתאמן משויך — חסומה', () => {
  assert.match(passPunchBlockReason({ student: null }, NOW), /לא משויכת למתאמן/);
});

// התווית ביומן הכניסות והגייט של הניקוב חייבים לענות אותה תשובה — אחרת
// המסך מראה «תקין» ירוק בדיוק למי שהניקוב שלו נדחה.
test('התווית מסכימה עם הגייט בכל מצב', () => {
  const cases = [
    [{ declarations: [validDecl], waivers: [validWaiver] }, 'valid', true],
    [{ declarations: [], waivers: [] }, 'missing', false],
    // חתומה ומאושרת, אבל פגה — נספרת ולכן מדווחת כפגה ולא כחסרה.
    [{ declarations: [{ ...validDecl, signedDate: '2024-05-01' }], waivers: [validWaiver] }, 'expired', false],
    [{ declarations: [validDecl], waivers: [] }, 'missing', false],
  ];
  for (const [args, state, ok] of cases) {
    const badge = wallDocumentsStatus({ student, ...args }, NOW);
    assert.equal(badge.state, state);
    assert.equal(badge.ok, ok);
    assert.equal(passPunchBlockReason({ student, ...args }, NOW) === null, ok);
  }
});

test('חסימה רפואית מסומנת בתווית ולא מוסווית כהצהרה חסרה', () => {
  const badge = wallDocumentsStatus(
    {
      student,
      declarations: [validDecl],
      waivers: [validWaiver],
      healthHolds: [{ student_id: 's1', created_at: '2026-12-01', status: 'open' }],
    },
    NOW
  );
  assert.equal(badge.state, 'blocked');
  assert.equal(badge.label, 'חסימה רפואית');
});

test('סטטוס «רשום» אינו נחשב חתימה, וגם לא הצהרה של מתאמן אחר', () => {
  const registered = { ...student, status: 'registered' };
  assert.equal(wallDocumentsStatus({ student: registered, declarations: [], waivers: [] }, NOW).ok, false);
  const sibling = { studentId: 's2', signedDate: '2026-09-01', status: 'approved', signature_url: 'x.png' };
  assert.equal(wallDocumentsStatus({ student, declarations: [sibling], waivers: [validWaiver] }, NOW).ok, false);
});

test('טופס טיול ישן מספק בריאות, אבל אינו מתחזה לטופס השתתפות בקיר', () => {
  const tripForm = {
    studentId: 's1',
    signedDate: '2026-09-01',
    status: 'registered',
    waiverAccepted: true,
    templateSlug: 'trip',
  };
  const badge = wallDocumentsStatus({ student, declarations: [tripForm], waivers: [] }, NOW);
  assert.equal(badge.health.state, 'valid');
  assert.equal(badge.waiver.state, 'missing');
  assert.equal(badge.label, 'אין טופס השתתפות בקיר');
  assert.equal(badge.ok, false);
});

test('חותמת הבריאות ההיסטורית בכרטיס המתאמן עדיין מוכרת בקופה', () => {
  const legacyStudent = { ...student, healthSignedAt: '2026-09-01' };
  const badge = wallDocumentsStatus({ student: legacyStudent, declarations: [], waivers: [] }, NOW);
  assert.equal(badge.health.state, 'valid');
  assert.equal(badge.waiver.state, 'missing');
  assert.equal(badge.label, 'אין טופס השתתפות בקיר');
});

test('טופס טיול שנשמר בכרטיס עצמי כפול מזוהה כבריאות של הכרטיס הוותיק', () => {
  const canonical = {
    ...student,
    name: 'אילי אברמוביץ',
    birthDate: '2008-06-29',
    phone: '972528820697',
  };
  const duplicate = {
    id: 's-new',
    name: "אילי אברמוביץ'",
    birthDate: '2008-06-29',
    parentId: 'p-self',
    isAdult: true,
  };
  const tripHealth = {
    studentId: 's-new',
    signedDate: '2026-08-13',
    status: 'approved',
    templateSlug: 'trip',
  };
  const badge = wallDocumentsStatus({
    student: canonical,
    students: [canonical, duplicate],
    parents: [{ id: 'p-self', phone: '0528820697' }],
    declarations: [tripHealth],
    waivers: [],
  }, NOW);
  assert.equal(badge.health.state, 'valid');
  assert.equal(badge.waiver.state, 'missing');
  assert.equal(badge.label, 'אין טופס השתתפות בקיר');
});
