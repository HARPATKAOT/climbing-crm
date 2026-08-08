/**
 * הגבול שבו מחרוזת ריקה נהפכת ל-null בדרך לבסיס הנתונים.
 *
 * ברוב השדות זו ההתנהגות הרצויה, אבל בעמודה NOT NULL היא מפילה את השמירה:
 * ברירת המחדל של העמודה חלה רק כשהעמודה מושמטת, ולא כששולחים null במפורש.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mappers } from './supa.js';

test('טקסט חופשי ריק במדיניות ביטול נשמר כמחרוזת ולא כ-null', () => {
  const row = mappers.cancellation_policy_versions.toRow({
    id: 'v1', policy_id: 'p1', version_number: 1, basis: 'usage',
    rules: [], usage_rule: {}, cooling_off_hours: 24, free_text: '', status: 'draft',
  });
  assert.equal(row.free_text, '');
  assert.notEqual(row.free_text, null);
});

test('טקסט חופשי שמולא עובר כמו שהוא', () => {
  const row = mappers.cancellation_policy_versions.toRow({
    id: 'v1', free_text: 'תנאים', status: 'draft',
  });
  assert.equal(row.free_text, 'תנאים');
});

test('שדות אחרים ממשיכים להפוך ריק ל-null', () => {
  const row = mappers.cancellation_policy_versions.toRow({
    id: 'v1', created_by: '', free_text: '',
  });
  assert.equal(row.created_by, null);
  assert.equal(row.free_text, '');
});

test('שדה שלא נמסר כלל מושמט, כדי שברירת המחדל של העמודה תחול', () => {
  const row = mappers.cancellation_policy_versions.toRow({ id: 'v1' });
  assert.equal('free_text' in row, false);
  assert.equal('basis' in row, false);
});

test('ארבעת סעיפי דף האירוע נשמרים ריקים ולא כ-null', () => {
  const row = mappers.activities.toRow({
    id: 'a1', name: 'טיול', audience: '', included: '', what_to_bring: '', important_info: '',
  });
  assert.equal(row.audience, '');
  assert.equal(row.included, '');
  assert.equal(row.what_to_bring, '');
  assert.equal(row.important_info, '');
});

test('אותם שדות מוגנים גם בתבניות', () => {
  const row = mappers.activity_templates.toRow({ id: 't1', audience: '', important_info: '' });
  assert.equal(row.audience, '');
  assert.equal(row.important_info, '');
});

test('שדות טקסט אחרים באירוע ממשיכים להפוך ריק ל-null', () => {
  const row = mappers.activities.toRow({ id: 'a1', location: '', notes: '' });
  assert.equal(row.location, null);
  assert.equal(row.notes, null);
});
