import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateUnifiedWallWaiver } from './scripts/applyHealthDeclarationText.js';

function fakeDatabase(seed) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    get: (table) => (table === 'form_templates' ? rows : []),
    update: (_table, id, patch) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index], ...patch };
      return rows[index];
    },
  };
}

test('migration retires event, widens wall and does not overwrite later owner edits', async () => {
  const database = fakeDatabase([
    {
      id: 'wall', slug: 'wall', isActive: true, isDefault: true,
      waiverText: 'old wall wording',
      healthQuestions: [{ id: 's1', label: 'אין להשאיר ילד עד גיל 11 ללא ליווי מבוגר' }],
    },
    { id: 'event', slug: 'event', isActive: true, isDefault: false },
    { id: 'trip', slug: 'trip', isActive: true, isDefault: false },
  ]);
  const persisted = [];
  const first = await migrateUnifiedWallWaiver({
    database,
    persist: async (_table, row) => persisted.push(row.id),
  });

  assert.deepEqual(first, { updated: 1, retired: 1 });
  assert.equal(database.rows.find((row) => row.id === 'event').isActive, false);
  const wall = database.rows.find((row) => row.id === 'wall');
  assert.deepEqual(wall.activityTypes, ['wall']);
  assert.match(wall.waiverText, /לרבות חוג, אימון, כניסה חד־פעמית ואירוע/);
  assert.equal(wall.healthQuestions.some((question) => question.id === 's1'), false);
  assert.deepEqual(persisted.sort(), ['event', 'wall']);

  wall.waiverText = 'נוסח שערך בעל העסק';
  const second = await migrateUnifiedWallWaiver({ database });
  assert.deepEqual(second, { updated: 0, retired: 0 });
  assert.equal(wall.waiverText, 'נוסח שערך בעל העסק');
});
