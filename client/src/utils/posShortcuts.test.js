import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePosShortcuts, isPosShortcut } from './posShortcuts.js';

test('the requested counter products are shortcuts for existing catalogues', () => {
  assert.equal(isPosShortcut({ name: 'כניסה לקיר' }), true);
  assert.equal(isPosShortcut({ name: 'השכרת נעליים' }), true);
  assert.equal(isPosShortcut({ name: 'ארטיק תמרה' }), true);
  assert.equal(isPosShortcut({ name: 'אימון אישי עם מדריך' }), false);
});

test('an explicit editor choice overrides the name-based default', () => {
  assert.equal(isPosShortcut({ name: 'כניסה לקיר', pos_shortcut: false }), false);
  assert.equal(isPosShortcut({ name: 'מגנזיום', pos_shortcut: true }), true);
});

test('the requested shortcuts use the requested display order', () => {
  const rows = [
    { name: 'ארטיק תמרה' },
    { name: 'השכרת נעליים' },
    { name: 'כניסה לקיר' },
  ];
  assert.deepEqual(rows.sort(comparePosShortcuts).map((row) => row.name), [
    'כניסה לקיר',
    'השכרת נעליים',
    'ארטיק תמרה',
  ]);
});
