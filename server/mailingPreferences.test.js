import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendMailingPreferencesFooter,
  buildMailingPreferencesUrl,
  createMailingPreferenceToken,
  handleMailingPreferenceConversation,
  isMailingPreferenceRequest,
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

test('bot asks for lists, accepts several numbers and leaves the bot enabled', async () => {
  const database = fakeDb();
  const parent = database.store.parents[0];
  const first = await handleMailingPreferenceConversation({
    database, parent, text: 'הסר אותי', origin: 'http://localhost:3000', now: new Date('2026-08-14T10:00:00Z'),
  });
  assert.equal(first.pending, true);
  assert.match(first.reply, /1\. תפעולי/);
  assert.match(first.reply, /2\. שיווקי/);
  assert.match(first.reply, /mailing-preferences/);

  const second = await handleMailingPreferenceConversation({
    database, parent, text: '2', origin: 'http://localhost:3000', now: new Date('2026-08-14T10:01:00Z'),
  });
  assert.deepEqual(second.removed, ['marketing']);
  assert.equal(database.store.subscriptions.marketing, false);
  assert.equal(parent.bot_opted_out, undefined);
});

test('explicit all removes every mailing list immediately', async () => {
  const database = fakeDb();
  const parent = database.store.parents[0];
  const result = await handleMailingPreferenceConversation({
    database, parent, text: 'הסר אותי מכל הרשימות', now: new Date('2026-08-14T10:00:00Z'),
  });
  assert.deepEqual(result.removed, ['operational', 'marketing']);
  assert.deepEqual(database.store.subscriptions, { operational: false, marketing: false });
  assert.equal(parent.marketing_opt_in, false);
});
