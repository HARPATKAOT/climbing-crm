import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMailingPreferencesFooter,
  buildMailingPreferencesUrl,
  createMailingPreferenceToken,
  handleMailingPreferenceConversation,
  isMailingPreferenceRequest,
  mailingConfirmationMessage,
  readMailingPreferenceToken,
  updateMailingPreferences,
} from './mailingPreferences.js';

function fakeDb() {
  const store = {
    parents: [{ id: 'p1', name: 'דנה לוי', phone: '0501234567', marketing_opt_in: true }],
    lists: [
      { key: 'operational', label: 'תפעולי', sortOrder: 0 },
      { key: 'marketing', label: 'שיווקי', sortOrder: 1 },
    ],
    broadcast_lists: [],
    subscriptions: { operational: true, marketing: true },
  };
  return {
    store,
    get(name) { return store[name] || []; },
    getBroadcastListDefs() { return store.lists; },
    getParentBroadcastLists() { return { ...store.subscriptions }; },
    updateParentBroadcastLists(_id, patch) {
      Object.assign(store.subscriptions, patch);
      for (const [key, subscribed] of Object.entries(patch)) {
        let row = store.broadcast_lists.find((item) => item.parentId === _id && item.listName === key);
        if (!row) {
          row = { id: `bl_${key}`, parentId: _id, listName: key, subscribed };
          store.broadcast_lists.push(row);
        } else {
          row.subscribed = subscribed;
        }
      }
      return { ...store.subscriptions };
    },
    update(name, id, patch) {
      const row = store[name].find((item) => item.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

test('mailing preference tokens are signed, expire and follow phone changes', () => {
  const parent = { id: 'p1', phone: '0501234567' };
  const token = createMailingPreferenceToken(parent, { secret: 'test-secret', now: 1000, ttlMs: 5000 });
  assert.equal(readMailingPreferenceToken(token, { parents: [parent], secret: 'test-secret', now: 2000 })?.parent, parent);
  assert.equal(readMailingPreferenceToken(`${token}x`, { parents: [parent], secret: 'test-secret', now: 2000 }), null);
  assert.equal(readMailingPreferenceToken(token, { parents: [{ ...parent, phone: '0509999999' }], secret: 'test-secret', now: 2000 }), null);
  assert.equal(readMailingPreferenceToken(token, { parents: [parent], secret: 'test-secret', now: 7000 }), null);
});

test('public URL and freeform footer contain the signed preferences route', () => {
  const parent = { id: 'p1', phone: '0501234567' };
  const url = buildMailingPreferencesUrl(parent, { origin: 'http://localhost:3000', secret: 'x', now: 1000 });
  assert.match(url, /^http:\/\/localhost:3000\/mailing-preferences\//);
  assert.match(appendMailingPreferencesFooter('שלום', parent, { origin: 'http://localhost:3000', secret: 'x', now: 1000 }), /לעדכון העדפות הדיוור/);
});

test('common Hebrew removal wording is detected without matching liability waiver', () => {
  assert.equal(isMailingPreferenceRequest('הסר אותי', 'עצור,הסר,stop'), true);
  assert.equal(isMailingPreferenceRequest('אל תשלחו לי יותר הודעות'), true);
  assert.equal(isMailingPreferenceRequest('אני רוצה לעדכן העדפות דיוור'), true);
  assert.equal(isMailingPreferenceRequest('איפה טופס הסרת אחריות?', 'עצור,הסר,stop'), false);
});

test('page updates only known lists and keeps global marketing consent aligned', async () => {
  const database = fakeDb();
  const parent = database.store.parents[0];
  await updateMailingPreferences(database, parent, { marketing: false, forged: false }, {
    now: new Date('2026-08-14T10:00:00Z'),
  });
  assert.deepEqual(database.store.subscriptions, { operational: true, marketing: false });
  assert.equal(parent.marketing_opt_in, false);
  assert.equal(parent.bot_intake, undefined);
});

test('a durable write failure is reported instead of claiming success', async () => {
  const database = fakeDb();
  await assert.rejects(
    updateMailingPreferences(database, database.store.parents[0], { marketing: false }, {
      persistList: async () => ({ ok: false }),
    }),
    /במסד נכשלה/
  );
});

test('a removal request gets the personal link only — no chat menu', async () => {
  const database = fakeDb();
  const parent = database.store.parents[0];
  const result = await handleMailingPreferenceConversation({
    database, parent, text: 'הסר אותי', url: 'https://app.kirboaz.co.il/api/mp/abc123',
    now: new Date('2026-08-14T10:00:00Z'),
  });
  assert.equal(result.handled, true);
  assert.match(result.reply, /https:\/\/app\.kirboaz\.co\.il\/api\/mp\/abc123/);
  // אין תפריט ממוספר ואין שינוי מנויים מהצ׳אט — הבחירה נעשית בדף.
  assert.doesNotMatch(result.reply, /1\. /);
  assert.equal(database.store.subscriptions.marketing, true);
  assert.equal(parent.bot_opted_out, undefined);
});

test('stale numbered-menu flow state is cleared when the link is sent', async () => {
  const database = fakeDb();
  const parent = database.store.parents[0];
  parent.bot_intake = { kind: 'mailing_preferences', startedAt: '2026-08-14T09:59:00Z' };
  await handleMailingPreferenceConversation({
    database, parent, text: '2', url: 'https://x/mp/1', now: new Date('2026-08-14T10:00:00Z'),
  });
  assert.equal(parent.bot_intake, null);
});

test('leaving one topic keeps global marketing consent; leaving all topics ends it', async () => {
  const database = fakeDb();
  database.store.lists = [
    { key: 'operational', label: 'תפעולי', icon: 'bell', sortOrder: 0 },
    { key: 'clubs', label: 'חוגי טיפוס', icon: 'mountain', sortOrder: 1 },
    { key: 'field_trips', label: 'טיולים וימי שטח', icon: 'compass', sortOrder: 2 },
    { key: 'marketing', label: 'מבצעים ואירועים', icon: 'party', sortOrder: 3 },
  ];
  database.store.subscriptions = { operational: true, clubs: true, field_trips: true, marketing: true };
  const parent = database.store.parents[0];

  // ירד מ«מבצעים» אבל נשאר ב«טיולים» — עדיין מסכים לדיוור, רק לא לנושא הזה.
  await updateMailingPreferences(database, parent, { marketing: false });
  assert.equal(parent.marketing_opt_in, true);

  // ירד גם משאר הנושאים — עכשיו זה opt-out מלא.
  await updateMailingPreferences(database, parent, { clubs: false, field_trips: false });
  assert.equal(parent.marketing_opt_in, false);
});

test('the confirmation lists the topics the way the menu did, with their icons', () => {
  // «תקבלו עדכונים על: תפעולי, חוגי טיפוס.» was a sentence. The customer had
  // just been reading a list, and the icons are the field the screens draw.
  const message = mailingConfirmationMessage({
    lists: [
      { key: 'operational', label: 'תפעולי', icon: 'bell', subscribed: true },
      { key: 'clubs', label: 'חוגי טיפוס', icon: 'mountain', subscribed: true },
      { key: 'field_trips', label: 'טיולים וימי שטח', icon: 'compass', subscribed: false },
      { key: 'marketing', label: 'מבצעים ואירועים', icon: 'party', subscribed: true },
    ],
  });
  assert.equal(message, [
    'העדפות הדיוור נשמרו ✔',
    'תקבלו עדכונים על:',
    '🔔 תפעולי',
    '🧗 חוגי טיפוס',
    '🎉 מבצעים ואירועים',
  ].join('\n'));

  // An unknown icon still gets a character rather than an empty line.
  assert.match(mailingConfirmationMessage({
    lists: [{ label: 'משהו חדש', icon: 'nothing-like-this', subscribed: true }],
  }), /📣 משהו חדש/);

  // Leaving everything is its own sentence — there is no list to draw.
  const none = mailingConfirmationMessage({
    lists: [{ label: 'תפעולי', icon: 'bell', subscribed: false }],
  });
  assert.match(none, /הוסרתם מכל רשימות הדיוור/);
  assert.doesNotMatch(none, /תקבלו עדכונים/);
});

