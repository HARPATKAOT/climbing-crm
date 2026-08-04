/**
 * בדיקת תרחישי מיזוג / הרשאות לשעון ופתיחת קיר (בלי שרת חי).
 */
import assert from 'node:assert/strict';
import {
  normalizeStaffAttendanceSettings,
  employeeCanOpenWall,
  employeeCanSignDailySafety,
  overlappingPaidMinutes,
  earlyArrivalNote,
} from '../staffAttendanceSettings.js';

// הגדרות
const settings = normalizeStaffAttendanceSettings({ minutes_before_shift_ok: 20 });
assert.equal(settings.minutes_before_shift_ok, 20);
assert.ok(settings.wall_open_confirm_message.includes('מסודר'));

// הרשאות נפרדות
assert.equal(employeeCanOpenWall({ is_active: true, can_open_wall: true }), true);
assert.equal(employeeCanOpenWall({ is_active: true, can_open_wall: false }), false);
assert.equal(employeeCanSignDailySafety({ is_active: true, can_sign_daily_safety: true }), true);
assert.equal(
  employeeCanSignDailySafety({ is_active: true, can_open_wall: true, can_sign_daily_safety: false }),
  false
);

// מיזוג: חלון קיר 08:00–16:00, חוג 10:00–11:00 → 60 דקות נחתכות
const carved = overlappingPaidMinutes(
  [{ date: '2026-08-04', start_time: '10:00', end_time: '11:00', pay_mode: 'hourly', source: 'class' }],
  '2026-08-04',
  8 * 60,
  16 * 60
);
assert.equal(carved, 60);

// גלובלי לא נחתך
const flatIgnored = overlappingPaidMinutes(
  [{ date: '2026-08-04', start_time: '10:00', end_time: '14:00', pay_mode: 'flat', source: 'event' }],
  '2026-08-04',
  8 * 60,
  16 * 60
);
assert.equal(flatIgnored, 0);

// חוג בלי פתיחת קיר — אין חלון קיר, אין מיזוג (רק שורת החוג)
assert.equal(overlappingPaidMinutes([], '2026-08-04', 0, 0), 0);

// הגעה מוקדמת מעבר לחלון
const note = earlyArrivalNote(
  [{ date: '2026-08-04', start_time: '10:00', end_time: '11:00', pay_mode: 'hourly' }],
  '2026-08-04',
  9 * 60, // 09:00 — שעה לפני
  15
);
assert.ok(note.includes('הגעה מוקדמת'));

const okEarly = earlyArrivalNote(
  [{ date: '2026-08-04', start_time: '10:00', end_time: '11:00', pay_mode: 'hourly' }],
  '2026-08-04',
  9 * 60 + 50, // 09:50 — 10 דקות לפני
  15
);
assert.equal(okEarly, '');

console.log('verify-staff-attendance-rules: OK');
