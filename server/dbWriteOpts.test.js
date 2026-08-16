process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import { supa } from './supa.js';

// skipSync הוא ההגנה מפני ה-OOM: ריצה לילית של אלפי שורות דרך
// durableRecordingStore חייבת לא לירות upsert צף פר שורה.
test('skipSync suppresses the per-row floating upsert; default keeps it', () => {
  const original = supa.upsert;
  let calls = 0;
  supa.upsert = async () => { calls += 1; return { ok: true }; };
  try {
    const synced = db.insert('finance_center_settings', { id: `t-sync-${Date.now()}` });
    assert.equal(calls, 1);
    db.update('finance_center_settings', synced.id, { note: 'x' });
    assert.equal(calls, 2);

    const silent = db.insert('finance_center_settings', { id: `t-skip-${Date.now()}` }, { skipSync: true });
    db.update('finance_center_settings', silent.id, { note: 'y' }, { skipSync: true });
    assert.equal(calls, 2, 'skipSync אסור שיגיע ל-Supabase');

    db.delete('finance_center_settings', synced.id);
    db.delete('finance_center_settings', silent.id);
  } finally {
    supa.upsert = original;
  }
});
