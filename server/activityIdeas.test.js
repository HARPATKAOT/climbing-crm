import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ideaJustScheduled,
  ideaScheduledMessage,
  isOpenIdea,
  openActivityIdeas,
  spellOutDay,
} from './activityIdeas.js';

const store = (activities) => ({ get: (table) => (table === 'activities' ? activities : []) });

const IDEA = {
  id: 'ac-idea',
  name: 'טיול סנפלינג',
  description: 'סנפלינג בנחל',
  collect_interest: true,
  created_at: '2026-08-01T10:00:00Z',
};

test('רעיון הוא פעילות שאוספת מתעניינים ואין לה תאריך', () => {
  assert.equal(isOpenIdea(IDEA), true);
  assert.equal(isOpenIdea({ ...IDEA, date: '2026-09-04' }), false);
  assert.equal(isOpenIdea({ ...IDEA, status: 'cancelled' }), false);
  // פעילות רגילה בלי תאריך אינה רעיון — היא פשוט חסרה תאריך.
  assert.equal(isOpenIdea({ id: 'x', name: 'טיול' }), false);
});

test('הרעיונות מוחזרים לפי סדר פתיחתם, בלי פעילויות רגילות', () => {
  const db = store([
    { ...IDEA, id: 'b', name: 'שני', created_at: '2026-08-05T10:00:00Z' },
    { ...IDEA, id: 'a', name: 'ראשון', created_at: '2026-08-01T10:00:00Z' },
    { id: 'c', name: 'טיול עם תאריך', collect_interest: true, date: '2026-09-04' },
    { id: 'd', name: 'אירוע רגיל' },
  ]);
  assert.deepEqual(openActivityIdeas(db).map((r) => r.name), ['ראשון', 'שני']);
});

test('רק המעבר לתאריך הוא בשורה — לא כל שמירה', () => {
  assert.equal(ideaJustScheduled(IDEA, { ...IDEA, date: '2026-09-04' }), true);
  // שמירה חוזרת של אותו אירוע אינה אירוע חדש.
  assert.equal(
    ideaJustScheduled({ ...IDEA, date: '2026-09-04' }, { ...IDEA, date: '2026-09-04' }),
    false
  );
  // תאריך שנמחק אינו בשורה, ואירוע שבוטל אינו נשלח.
  assert.equal(ideaJustScheduled({ ...IDEA, date: '2026-09-04' }, IDEA), false);
  assert.equal(ideaJustScheduled(IDEA, { ...IDEA, date: '2026-09-04', status: 'cancelled' }), false);
  // פעילות שלא אספה מתעניינים מעולם אינה מודיעה לאיש.
  assert.equal(ideaJustScheduled({ id: 'x' }, { id: 'x', date: '2026-09-04' }), false);
});

test('ההודעה פותחת במה שביקשו, ולא כמו פרסומת', () => {
  const msg = ideaScheduledMessage(
    { name: 'טיול סנפלינג', date: '2026-09-04', start_time: '08:00', location: 'הנקיק השחור' },
    { firstName: 'מיכל', link: 'https://app.example/api/ev/abc' }
  );
  assert.match(msg, /היי מיכל/);
  assert.match(msg, /ביקשתם שנעדכן/);
  assert.match(msg, /4 בספטמבר/);
  assert.match(msg, /הנקיק השחור/);
  assert.ok(msg.includes('https://app.example/api/ev/abc'));
});

test('בלי קישור הרשמה ההודעה עדיין נשלחת, ואומרת שהוא בדרך', () => {
  const msg = ideaScheduledMessage({ name: 'טיול', date: '2026-09-04' }, { firstName: 'דנה' });
  assert.match(msg, /נפתח להרשמה בקרוב/);
  assert.equal(spellOutDay('2026-09-04'), '4 בספטמבר');
});
