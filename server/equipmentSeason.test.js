import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EQUIPMENT_SETTINGS,
  computeEquipmentTotal,
  ensureStudentEquipment,
  halfMonthUnits,
  markEquipmentItemsPaid,
  normalizeEquipmentSettings,
  resolveJoinDate,
  resolveSeasonHalves,
  shoesSeasonPricing,
} from './equipmentService.js';

const SETTINGS = {
  ...DEFAULT_EQUIPMENT_SETTINGS,
  prices: { shoes: 550, shirt: 120, chalk_bag: 80 },
};

const att = (date, status = 'attended') => ({ date, status, student_id: 's1' });

test('שנת חוגים ברירת מחדל — 11 חודשים, 5.5 לכל חצי', () => {
  const season = resolveSeasonHalves(SETTINGS, '2026-10-01');
  assert.equal(season.start.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(season.end.toISOString().slice(0, 10), '2027-07-31');
  assert.equal(halfMonthUnits(season.start, season.halves[0].endExclusive), 5.5);
  assert.equal(halfMonthUnits(season.halves[1].start, season.halves[1].endExclusive), 5.5);
});

test('החצי הנוכחי נבחר לפי התאריך, גם מעבר לשנה הקלנדרית', () => {
  assert.equal(resolveSeasonHalves(SETTINGS, '2026-10-01').current.index, 0);
  assert.equal(resolveSeasonHalves(SETTINGS, '2027-01-20').current.index, 0);
  assert.equal(resolveSeasonHalves(SETTINGS, '2027-03-01').current.index, 1);
});

test('בין העונות (אוגוסט) מתמחרים את החצי הראשון של העונה הבאה', () => {
  const season = resolveSeasonHalves(SETTINGS, '2026-08-10');
  assert.equal(season.start.toISOString().slice(0, 10), '2026-09-01');
  assert.equal(season.current.index, 0);
});

test('מצטרף בפתיחת העונה משלם מחיר מלא', () => {
  const pricing = shoesSeasonPricing({
    settings: SETTINGS,
    attendance: [att('2026-09-01')],
    refDate: '2026-09-05',
  });
  assert.equal(pricing.amount, 550);
  assert.equal(pricing.prorated, false);
  assert.equal(pricing.remaining_units, 5.5);
});

test('מצטרף חודש אחרי הפתיחה משלם 4.5 מתוך 5.5', () => {
  const pricing = shoesSeasonPricing({
    settings: SETTINGS,
    attendance: [att('2026-10-01')],
    refDate: '2026-10-05',
  });
  assert.equal(pricing.remaining_units, 4.5);
  assert.equal(pricing.total_units, 5.5);
  assert.equal(pricing.amount, 450); // 550 * 4.5/5.5
  assert.equal(pricing.prorated, true);
});

test('ההצטרפות היא שבוע אחרי ההכירות, בלי להמתין לשורה הבאה', () => {
  assert.equal(resolveJoinDate([att('2026-09-27', 'intro_attended')]), '2026-10-04');
});

test('הכירות + שבוע גוברת גם כשכבר נרשם אימון אחריה', () => {
  const pricing = shoesSeasonPricing({
    settings: SETTINGS,
    attendance: [att('2026-09-27', 'intro_attended'), att('2026-10-01'), att('2026-10-08')],
    refDate: '2026-10-10',
  });
  assert.equal(pricing.join_date, '2026-10-04');
  assert.equal(pricing.remaining_units, 4.5);
});

test('סומן „לא הגיע” אחרי ההכירות — האימון שהגיע אליו בפועל גובר', () => {
  const joinDate = resolveJoinDate([
    att('2026-09-27', 'intro_attended'),
    att('2026-10-04', 'absent'),
    att('2026-10-11', 'absent'),
    att('2026-12-06', 'attended'),
  ]);
  assert.equal(joinDate, '2026-12-06');
});

test('הכירות ישנה בלי שורות אחריה — האימון הראשון בפועל גובר', () => {
  const joinDate = resolveJoinDate([
    att('2026-09-27', 'intro_attended'),
    att('2026-12-06', 'attended'),
  ]);
  assert.equal(joinDate, '2026-12-06');
});

test('שורה שעדיין לא סומנה אינה ראיה שהילד לא התחיל', () => {
  const joinDate = resolveJoinDate([
    att('2026-09-27', 'intro_attended'),
    att('2026-10-04', 'pending'),
    att('2026-10-11', 'attended'),
  ]);
  assert.equal(joinDate, '2026-10-04');
});

test('בלי שורת הכירות — האימון הראשון הוא ההצטרפות', () => {
  assert.equal(resolveJoinDate([att('2026-10-01'), att('2026-10-08')]), '2026-10-01');
});

test('שורות מבוטלות וחגים לא נחשבות הצטרפות', () => {
  const joinDate = resolveJoinDate([
    att('2026-09-20', 'cancelled'),
    att('2026-09-27', 'holiday'),
    att('2026-10-01', 'pending'),
  ]);
  assert.equal(joinDate, '2026-10-01');
});

test('ותיק שהתאמן לפני שהחצי נפתח משלם על החצי השני במלואו', () => {
  const pricing = shoesSeasonPricing({
    settings: SETTINGS,
    attendance: [att('2026-09-01'), att('2027-03-01')],
    refDate: '2027-03-01',
  });
  assert.equal(pricing.half_label, 'חצי שני');
  assert.equal(pricing.amount, 550);
  assert.equal(pricing.prorated, false);
});

test('בלי נוכחות בכלל — מקזזים לפי היום שבו נוצר הקישור', () => {
  const pricing = shoesSeasonPricing({
    settings: SETTINGS,
    attendance: [],
    refDate: '2026-12-01',
  });
  assert.equal(pricing.join_date, null);
  assert.ok(pricing.amount < 550);
});

test('נוכחות עתידית מחייבת את החצי שבו הילד באמת מתחיל', () => {
  // הקישור נשלח בסוף העונה הקודמת, והאימונים כבר נפתחו ליומן לספטמבר.
  const pricing = shoesSeasonPricing({
    settings: SETTINGS,
    attendance: [att('2026-09-27', 'intro_attended'), att('2026-10-01', 'pending')],
    refDate: '2026-07-30',
  });
  assert.equal(pricing.half_start, '2026-09-01');
  assert.equal(pricing.remaining_units, 4.5);
  assert.equal(pricing.amount, 450);
});

test('מצטרף שבוע לפני סוף החצי משלם לפחות חצי חודש', () => {
  const pricing = shoesSeasonPricing({
    settings: SETTINGS,
    attendance: [att('2027-02-10')],
    refDate: '2027-02-10',
  });
  assert.equal(pricing.remaining_units, 0.5);
  assert.equal(pricing.amount, 50); // 550 * 0.5/5.5
});

test('חלון ההשכרה נסגר עם חצי העונה שחויב, לא כעבור ימים קבועים', () => {
  const store = { students: [{ id: 's1', name: 'ראם', isAdult: false }], student_equipment: [] };
  const db = {
    get: (table) => store[table] || [],
    getOne: (table, id) => (store[table] || []).find((r) => r.id === id) || null,
    insert: (table, record) => {
      if (!store[table]) store[table] = [];
      const row = { ...record, id: record.id || `${table}-${store[table].length + 1}` };
      store[table].push(row);
      return row;
    },
    update: (table, id, updates) => {
      const list = store[table] || [];
      const idx = list.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      list[idx] = { ...list[idx], ...updates };
      return list[idx];
    },
  };
  ensureStudentEquipment({ db, student: store.students[0] });
  markEquipmentItemsPaid({
    db,
    studentId: 's1',
    itemTypes: ['shoes'],
    rentalEndsAt: '2027-02-14',
    paidAt: '2026-10-01T00:00:00.000Z',
  });
  const shoes = store.student_equipment.find((r) => r.item_type === 'shoes');
  assert.equal(shoes.payment_status, 'paid');
  assert.equal(shoes.rental_ends_at.slice(0, 10), '2027-02-14');
});

test('תשלום נכנס לא דורס „מהבית” או „לא מעוניינים”', () => {
  // הכלל הזה הוא הסיבה שסימון ידני של מנהל מאפס קודם את השורה:
  // בלי האיפוס, markEquipmentItemsPaid פשוט מדלג עליה.
  const store = { students: [{ id: 's1', name: 'ראם', isAdult: false }], student_equipment: [] };
  const db = {
    get: (table) => store[table] || [],
    getOne: (table, id) => (store[table] || []).find((r) => r.id === id) || null,
    insert: (table, record) => {
      if (!store[table]) store[table] = [];
      const row = { ...record, id: record.id || `${table}-${store[table].length + 1}` };
      store[table].push(row);
      return row;
    },
    update: (table, id, updates) => {
      const list = store[table] || [];
      const idx = list.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      list[idx] = { ...list[idx], ...updates };
      return list[idx];
    },
  };
  ensureStudentEquipment({ db, student: store.students[0] });
  const shoes = store.student_equipment.find((r) => r.item_type === 'shoes');
  db.update('student_equipment', shoes.id, { payment_status: 'declined' });

  const result = markEquipmentItemsPaid({ db, studentId: 's1', itemTypes: ['shoes'] });
  assert.equal(result.updated.length, 0);
  assert.equal(
    store.student_equipment.find((r) => r.item_type === 'shoes').payment_status,
    'declined'
  );
});

test('הסכום הכולל מכבד את מחיר הנעליים המקוזז', () => {
  const total = computeEquipmentTotal(SETTINGS, ['shoes', 'shirt'], { shoes: 450 });
  assert.equal(total, 570);
  assert.equal(computeEquipmentTotal(SETTINGS, ['shoes', 'shirt']), 670);
});

test('תאריכי עונה לא תקינים נופלים לברירת המחדל', () => {
  const s = normalizeEquipmentSettings({ season_start: '13-45', season_mid: 'bad', season_end: '' });
  assert.equal(s.season_start, '09-01');
  assert.equal(s.season_mid, '02-15');
  assert.equal(s.season_end, '07-31');
});

test('אמצע עונה מחוץ לטווח נחתך לפי ימים, ושני החצאים נשארים', () => {
  const season = resolveSeasonHalves({ ...SETTINGS, season_mid: '08-20' }, '2026-10-01');
  assert.equal(season.halves.length, 2);
  assert.ok(season.mid > season.start && season.mid < season.end);
});

const TWO_PRICE_SETTINGS = {
  ...DEFAULT_EQUIPMENT_SETTINGS,
  prices: { shoes: 550, shoes_twice: 700, shirt: 120, chalk_bag: 80 },
};

test('מחיר הנעליים נבחר לפי מספר האימונים בשבוע', () => {
  const args = { settings: TWO_PRICE_SETTINGS, attendance: [att('2026-09-01')], refDate: '2026-09-05' };
  const once = shoesSeasonPricing({ ...args, weeklySessions: 1 });
  const twice = shoesSeasonPricing({ ...args, weeklySessions: 2 });

  assert.equal(once.amount, 550);
  assert.equal(once.frequency_label, 'פעם בשבוע');
  assert.equal(twice.amount, 700);
  assert.equal(twice.weekly_sessions, 2);
  assert.equal(twice.frequency_label, 'פעמיים בשבוע');
});

test('הקיזוז היחסי חל על מחיר הבסיס של פעמיים בשבוע', () => {
  const pricing = shoesSeasonPricing({
    settings: TWO_PRICE_SETTINGS,
    attendance: [att('2026-10-01')],
    refDate: '2026-10-05',
    weeklySessions: 2,
  });
  assert.equal(pricing.full_price, 700);
  assert.equal(pricing.remaining_units, 4.5);
  assert.equal(pricing.amount, Math.round((700 * 4.5) / 5.5));
});

test('שלושה אימונים בשבוע מתומחרים כפעמיים — אין מדרגה שלישית', () => {
  const args = { settings: TWO_PRICE_SETTINGS, attendance: [att('2026-09-01')], refDate: '2026-09-05' };
  assert.equal(shoesSeasonPricing({ ...args, weeklySessions: 3 }).amount, 700);
});

test('הגדרות ישנות בלי shoes_twice מחזירות את המחיר היחיד בכל תדירות', () => {
  const normalized = normalizeEquipmentSettings({ prices: { shoes: 550 } });
  assert.equal(normalized.prices.shoes_twice, 550);

  const args = { settings: SETTINGS, attendance: [att('2026-09-01')], refDate: '2026-09-05' };
  assert.equal(shoesSeasonPricing({ ...args, weeklySessions: 1 }).amount, 550);
  assert.equal(shoesSeasonPricing({ ...args, weeklySessions: 2 }).amount, 550);
});

test('בלי weeklySessions מתמחרים כפעם בשבוע', () => {
  const pricing = shoesSeasonPricing({
    settings: TWO_PRICE_SETTINGS,
    attendance: [att('2026-09-01')],
    refDate: '2026-09-05',
  });
  assert.equal(pricing.amount, 550);
  assert.equal(pricing.weekly_sessions, 1);
});
