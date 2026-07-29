import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upcomingPublicActivities,
  upcomingOpeningHours,
  publicGroups,
  activityPublicSlug,
} from './publicSite.js';

function makeDb(store) {
  return { get: (table) => store[table] || [] };
}

const TODAY = '2026-08-10';

function activity(fields) {
  return {
    id: fields.id || 'a1',
    name: 'טיול לנחל רחף',
    type: 'trip',
    date: TODAY,
    registration_enabled: true,
    show_on_site: true,
    participant_registration_slug: 'nahal-rahaf',
    max_participants: 20,
    price: 120,
    ...fields,
  };
}

test('only upcoming, open, registerable activities reach the site', () => {
  const db = makeDb({
    activities: [
      activity({ id: 'future', date: '2026-08-20' }),
      activity({ id: 'today', date: TODAY }),
      activity({ id: 'past', date: '2026-08-01' }),
      activity({ id: 'cancelled', date: '2026-08-20', cancelled: true }),
      activity({ id: 'no-registration', date: '2026-08-20', registration_enabled: false }),
      activity({
        id: 'no-slug',
        date: '2026-08-20',
        participant_registration_slug: '',
        registration_slug: '',
      }),
    ],
    activity_registrations: [],
  });
  const list = upcomingPublicActivities(db, { today: TODAY });
  assert.equal(list.length, 2, 'only today + future should be listed');
  // Soonest first.
  assert.equal(list[0].date, TODAY);
  assert.equal(list[1].date, '2026-08-20');
});

test('a private event is never published, even with registration open', () => {
  const db = makeDb({
    activities: [
      activity({ id: 'party', type: 'birthday', show_on_site: false }),
      activity({ id: 'trip', type: 'trip' }),
    ],
    activity_registrations: [],
  });
  const list = upcomingPublicActivities(db, { today: TODAY });
  assert.equal(list.length, 1, 'only the published activity may appear');
  assert.equal(list[0].type, 'trip');
});

test('a multi-day activity stays listed until its end date passes', () => {
  const db = makeDb({
    activities: [activity({ id: 'camp', date: '2026-08-05', end_date: '2026-08-12' })],
    activity_registrations: [],
  });
  assert.equal(upcomingPublicActivities(db, { today: TODAY }).length, 1);
  assert.equal(upcomingPublicActivities(db, { today: '2026-08-13' }).length, 0);
});

test('a full activity is not offered', () => {
  const db = makeDb({
    activities: [activity({ id: 'full', max_participants: 1 })],
    activity_registrations: [
      { id: 'r1', activity_id: 'full', status: 'confirmed', participants: 1 },
    ],
  });
  const list = upcomingPublicActivities(db, { today: TODAY });
  assert.equal(list.length, 0, 'a full activity must not appear on the site');
});

test('the activity payload carries no internal fields', () => {
  const db = makeDb({
    activities: [activity({
      host_payment_token: 'secret-token',
      host_phone: '0501234567',
      internal_notes: 'do not publish',
    })],
    activity_registrations: [],
  });
  const [item] = upcomingPublicActivities(db, { today: TODAY });
  for (const leaked of ['host_payment_token', 'host_phone', 'internal_notes', 'id']) {
    assert.ok(!(leaked in item), `${leaked} must not be exposed publicly`);
  }
  assert.equal(item.slug, 'nahal-rahaf');
});

test('activityPublicSlug falls back to the plain registration slug', () => {
  assert.equal(activityPublicSlug({ participant_registration_slug: 'a' }), 'a');
  assert.equal(activityPublicSlug({ registration_slug: 'b' }), 'b');
  assert.equal(activityPublicSlug({}), '');
});

test('opening hours come from the calendar, and a day without an entry is closed', () => {
  const db = makeDb({
    activities: [
      { id: 'o1', type: 'opening_hours', date: TODAY, start_time: '16:00', end_time: '20:00' },
      { id: 'o2', type: 'opening_hours', date: '2026-08-12', all_day: true, name: 'חופש' },
      { id: 'o3', type: 'opening_hours', date: '2026-08-01', start_time: '10:00' },
      { id: 'o4', type: 'opening_hours', date: '2026-08-11', cancelled: true },
      { id: 't1', type: 'trip', date: '2026-08-11', start_time: '08:00' },
    ],
  });
  const days = upcomingOpeningHours(db, { today: TODAY, days: 3 });
  assert.equal(days.length, 3);
  assert.equal(days[0].date, TODAY);
  assert.equal(days[0].open, true);
  assert.equal(days[0].slots[0].start_time, '16:00');
  // A cancelled entry and a trip on the same day leave it closed.
  assert.equal(days[1].open, false);
  assert.equal(days[2].open, true);
  assert.equal(days[2].slots[0].all_day, true);
});

test('groups expose schedule and price but never staff or private links', () => {
  const db = makeDb({
    groups: [
      {
        id: 'g2', name: "כיתות ה'-ו'", day: 2, time: '16:30', duration: 50,
        ageCategory: "ה'-ו'", priceWeek: 260, priceTwice: 360, maxSlots: 2,
        trainer: 'יוסי', waParents: 'https://chat.whatsapp.com/secret', waClimbers: 'https://x',
      },
      {
        id: 'g1', name: "כיתות ג'-ד'", day: 0, time: '15:30', ageCategory: "ג'-ד'",
        priceWeek: 280, maxSlots: 1,
      },
    ],
    students: [{ id: 's1', groupId: 'g1', active: true, status: 'active' }],
  });
  const groups = publicGroups(db);
  assert.equal(groups[0].day, 0, 'sorted by day');
  for (const group of groups) {
    // Prices are quoted by the team, never published — same rule the bot follows.
    for (const leaked of [
      'trainer', 'waParents', 'waClimbers', 'enrolled',
      'priceWeek', 'priceTwice', 'price_week', 'price_twice',
    ]) {
      assert.ok(!(leaked in group), `${leaked} must not be exposed publicly`);
    }
  }
  assert.ok(!JSON.stringify(groups).includes('260'), 'no price figure may appear');
  assert.equal(groups[1].age_category, "ה'-ו'");
  assert.equal(typeof groups[0].has_room, 'boolean');
});
