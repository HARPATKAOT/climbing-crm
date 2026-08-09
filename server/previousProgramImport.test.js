import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreviousProgramImportReport, applyPreviousProgramImport } from './previousProgramImport.js';

function fakeDb() {
  const store = {
    students: [
      { id: 's1', name: 'איתן נוימן', parentId: 'p1' },
      { id: 's2', name: 'שם כפול', parentId: 'p2' },
      { id: 's3', name: 'שם כפול', parentId: 'p3' },
    ],
    program_eligibility: [],
  };
  return {
    store,
    get: (name) => store[name] || [],
    getOne: (name, id) => (store[name] || []).find((row) => row.id === id),
    insert: (name, row) => { (store[name] ||= []).push(row); return row; },
    update: (name, id, patch) => {
      const index = (store[name] || []).findIndex((row) => row.id === id);
      if (index < 0) return null;
      store[name][index] = { ...store[name][index], ...patch };
      return store[name][index];
    },
  };
}

test('dry-run separates exact, missing, ambiguous and invalid rows', () => {
  const db = fakeDb();
  const report = buildPreviousProgramImportReport(db, [
    { name: 'איתן נוימן', group_name: 'נבחרת צעירה' },
    { name: 'לא נמצא', group_name: 'מתקדמים' },
    { name: 'שם כפול', group_name: 'נבחרת בוגרת' },
    { name: 'בלי מסלול' },
  ], { season: '2026-27' });
  assert.equal(report.exact.length, 1);
  assert.equal(report.missing.length, 1);
  assert.equal(report.ambiguous.length, 1);
  assert.equal(report.invalid.length, 1);
});
test('apply imports only exact rows as returning and is safe to rerun', async () => {
  const db = fakeDb();
  const report = buildPreviousProgramImportReport(db, [
    { name: 'איתן נוימן', group_name: 'נבחרת צעירה' },
    { name: 'שם כפול', group_name: 'מתקדמים' },
  ], { season: '2026-27' });
  await applyPreviousProgramImport(db, async () => {}, report);
  await applyPreviousProgramImport(db, async () => {}, report);
  assert.equal(db.store.program_eligibility.length, 1);
  assert.equal(db.store.program_eligibility[0].status, 'returning');
  assert.equal(db.store.program_eligibility[0].source, 'notion_previous_season');
  assert.equal(db.store.program_eligibility[0].group_id, undefined);
  assert.equal(db.store.program_eligibility[0].previous_group_name, undefined);
});

test('returning eligibility clears an old approval group without adding placement to new rows', async () => {
  const db = fakeDb();
  db.store.program_eligibility.push({
    id: 'pe-2026-27-s1-young_squad',
    student_id: 's1',
    program: 'young_squad',
    season: '2026-27',
    status: 'pending',
    group_id: 'g-old-choice',
  });
  const report = buildPreviousProgramImportReport(db, [
    { name: 'איתן נוימן', program: 'young_squad' },
  ], { season: '2026-27' });

  await applyPreviousProgramImport(db, async () => {}, report);

  assert.equal(db.store.program_eligibility.length, 1);
  assert.equal(db.store.program_eligibility[0].status, 'returning');
  assert.equal(db.store.program_eligibility[0].group_id, null);
});
