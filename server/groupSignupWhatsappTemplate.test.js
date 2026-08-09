import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureGroupSignupWhatsappTemplate } from './groupSignupWhatsappTemplate.js';

function memoryDb() {
  const rows = [];
  return {
    get: () => rows,
    insert: (_table, row) => { rows.push(row); return row; },
  };
}

test('generic signup template is idempotent and says the link is not confirmation', () => {
  const db = memoryDb();
  const first = ensureGroupSignupWhatsappTemplate({ db });
  const second = ensureGroupSignupWhatsappTemplate({ db });
  assert.equal(first.id, second.id);
  assert.equal(db.get().length, 1);
  assert.match(first.body, /סופית רק לאחר אימות/);
  assert.match(first.buttons[0].url, /\/s\/\{\{1\}\}$/);
});
