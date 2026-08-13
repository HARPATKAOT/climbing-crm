import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWallShiftHistory } from './wallShiftHistory.js';

test('מרכז פתיחה, קופה, בדיקות וסגירה ברשומת משמרת אחת', () => {
  const [entry] = buildWallShiftHistory({
    employees: [
      { id: 'e1', name: 'פותח המשמרת' },
      { id: 'e2', name: 'בודקת בטיחות' },
      { id: 'e3', name: 'סוגר המשמרת' },
    ],
    shiftHours: [{
      id: 'shift-1', employee_id: 'e1', activity_type: 'counter_shift', wall_role: 'opener',
      clock_in: '2026-08-13T05:00:00.000Z', clock_out: '2026-08-13T14:00:00.000Z',
      status: 'closed', place_orderly: false, opening_note: 'הדלפק לא מסודר',
      wall_closing_note: 'טופל לפני הסגירה', closed_by_employee_id: 'e3',
      wall_close_checklist_confirmed: true,
    }],
    cashSessions: [{
      id: 'cash-1', status: 'closed', opened_at: '2026-08-13T05:10:00.000Z',
      closed_at: '2026-08-13T13:50:00.000Z', opened_by_id: 'e1', opened_by_name: 'פותח המשמרת',
      closed_by_id: 'e3', closed_by_name: 'סוגר המשמרת', discrepancy: -5,
    }],
    cashLedger: [
      { session_id: 'cash-1', action_type: 'open', notes: 'סכום פתיחה נספר' },
      { session_id: 'cash-1', action_type: 'close', notes: 'חסר מטבע' },
    ],
    safetyInspections: [{
      id: 'safe-1', title: 'חבלים', performed_at: '2026-08-13T05:20:00.000Z',
      completed_by_employee_id: 'e2', status: 'תקין', description: 'חבל 3 דורש מעקב',
    }],
    month: '2026-08',
  });

  assert.equal(entry.opener.name, 'פותח המשמרת');
  assert.equal(entry.closer.name, 'סוגר המשמרת');
  assert.equal(entry.place_orderly, false);
  assert.equal(entry.opening_note, 'הדלפק לא מסודר');
  assert.equal(entry.cash.opening_notes, 'סכום פתיחה נספר');
  assert.equal(entry.cash.closing_notes, 'חסר מטבע');
  assert.equal(entry.safety[0].tester_name, 'בודקת בטיחות');
  assert.equal(entry.safety[0].notes, 'חבל 3 דורש מעקב');
});

test('מסנן לפי חודש ומזהה גם שורת פתיחה ותיקה לפי ההערה', () => {
  const entries = buildWallShiftHistory({
    employees: [{ id: 'e1', name: 'עובד' }],
    shiftHours: [
      { id: 'old', employee_id: 'e1', activity_type: 'counter_shift', notes: 'משמרת קיר — מסוף כניסה', clock_in: '2026-07-31T21:30:00.000Z' },
      { id: 'aug', employee_id: 'e1', activity_type: 'counter_shift', wall_role: 'opener', clock_in: '2026-08-02T07:00:00.000Z' },
    ],
    month: '2026-08',
  });
  assert.deepEqual(entries.map((entry) => entry.id), ['aug', 'old']);
  assert.equal(entries[1].date, '2026-08-01');
});

test('קופה שנפתחה דקה לפני שורת השעון שייכת למשמרת של אותו היום', () => {
  const entries = buildWallShiftHistory({
    employees: [{ id: 'e1', name: 'עובד' }],
    shiftHours: [
      { id: 'yesterday', employee_id: 'e1', activity_type: 'counter_shift', wall_role: 'opener', clock_in: '2026-08-08T05:00:00.000Z', clock_out: '2026-08-09T05:01:00.000Z' },
      { id: 'today', employee_id: 'e1', activity_type: 'counter_shift', wall_role: 'opener', clock_in: '2026-08-09T05:16:00.000Z' },
    ],
    cashSessions: [{ id: 'cash', opened_at: '2026-08-09T05:15:00.000Z', status: 'open' }],
    month: '2026-08',
  });
  assert.equal(entries.find((entry) => entry.id === 'today').cash.id, 'cash');
  assert.equal(entries.find((entry) => entry.id === 'yesterday').cash, null);
});
