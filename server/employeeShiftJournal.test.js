import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShiftJournal } from './employeeShiftJournal.js';

const EMP = 'em1';
const TODAY = '2026-08-03'; // יום שני

const group = {
  id: 'g1',
  name: 'מתחילים ג׳-ד׳ — ב׳ 16:00',
  day: 1, // שני
  time: '16:00',
  duration: 50,
  trainer: EMP,
  assistants: [],
};

function build(overrides = {}) {
  return buildShiftJournal({
    employeeId: EMP,
    workAssignments: [],
    staffAttendance: [],
    groups: [],
    activities: [],
    shiftHours: [],
    today: TODAY,
    horizonDays: 14,
    ...overrides,
  });
}

test('שורת עבודה נכנסת ליומן עם התפקיד והשכר שקפאו בה', () => {
  const { entries } = build({
    workAssignments: [{
      id: 'w1', employee_id: EMP, date: '2026-07-20', role: 'הפעלת קיר',
      hours: 4.5, pay_amount: 180, approved: true, work_type: 'counter_shift',
      start_time: '16:30', end_time: '21:00', source: 'wall_shift',
    }],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'logged');
  assert.equal(entries[0].title, 'הפעלת קיר');
  assert.equal(entries[0].pay_amount, 180);
  assert.equal(entries[0].approved, true);
});

test('חוג שבועי עתידי נגזר מהגדרת הקבוצה עד האופק בלבד', () => {
  const { entries, horizon } = build({ groups: [group] });
  assert.equal(horizon, '2026-08-17');
  // שני של 3, 10 ו-17 באוגוסט — שלושה מפגשים בתוך 14 יום.
  assert.deepEqual(entries.map((e) => e.date), ['2026-08-03', '2026-08-10', '2026-08-17']);
  assert.equal(entries[0].status, 'planned');
  assert.equal(entries[0].end_time, '16:50');
  assert.equal(entries[0].hours, 1);
});

test('חוג שכבר יש לו שורת עבודה אינו מוכפל כמשמרת מתוכננת', () => {
  const { entries } = build({
    groups: [group],
    workAssignments: [{
      id: 'w2', employee_id: EMP, date: '2026-08-10', group_id: 'g1',
      role: 'הדרכת חוג', hours: 1, work_type: 'class_shift',
    }],
  });
  const aug10 = entries.filter((e) => e.date === '2026-08-10');
  assert.equal(aug10.length, 1);
  assert.equal(aug10[0].status, 'logged');
});

test('היעדרות מחוג מופיעה ביומן בלי שעות ובלי תשלום', () => {
  const { entries } = build({
    groups: [group],
    staffAttendance: [{
      id: 'a1', employee_id: EMP, group_id: 'g1', date: '2026-07-27',
      role: 'trainer', status: 'absent', hours: 0,
    }],
  });
  const absent = entries.find((e) => e.status === 'absent');
  assert.equal(absent.date, '2026-07-27');
  assert.equal(absent.hours, 0);
  assert.equal(absent.paid, false);
});

test('שעות עוזר מדריך נספרות ביומן אך אינן מסומנות כמשולמות', () => {
  const { entries } = build({
    staffAttendance: [{
      id: 'a2', employee_id: EMP, group_id: 'g1', date: '2026-07-27',
      role: 'assistant', status: 'present', hours: 1,
    }],
  });
  assert.equal(entries[0].title, 'עוזר מדריך');
  assert.equal(entries[0].hours, 1);
  assert.equal(entries[0].paid, false);
});

test('ביום חופשה מאימונים המשמרת מסומנת כמבוטלת ולא כמתוכננת', () => {
  const { entries } = build({
    groups: [group],
    activities: [{
      id: 'v1', type: 'training_vacation', name: 'חופש גדול',
      date: '2026-08-10', end_date: '2026-08-10',
    }],
  });
  const aug10 = entries.find((e) => e.date === '2026-08-10');
  assert.equal(aug10.status, 'vacation');
  assert.equal(aug10.notes, 'חופש גדול');
});

test('משמרת פתוחה בשעון מופיעה כשורה נפרדת', () => {
  const { entries } = build({
    shiftHours: [{
      id: 's1', employee_id: EMP, status: 'open',
      clock_in: '2026-08-03T05:43:22.463Z', activity_type: 'counter_shift',
    }],
  });
  assert.equal(entries[0].status, 'open');
  assert.equal(entries[0].date, '2026-08-03');
});

test('משמרות של עובד אחר אינן דולפות ליומן', () => {
  const { entries } = build({
    workAssignments: [{ id: 'w3', employee_id: 'em2', date: '2026-07-20', role: 'דלפק' }],
    staffAttendance: [{ id: 'a3', employee_id: 'em2', group_id: 'g1', date: '2026-07-27', status: 'absent' }],
    groups: [{ ...group, trainer: 'em2' }],
  });
  assert.deepEqual(entries, []);
});
