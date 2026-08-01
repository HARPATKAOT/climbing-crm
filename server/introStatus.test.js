import test from 'node:test';
import assert from 'node:assert/strict';
import { isIntroTrainingItem, saleHasIntroTraining, shouldMarkIntroPaid } from './introStatus.js';

test('an intro training is recognised by the flag or by its name', () => {
  assert.equal(isIntroTrainingItem({ is_intro_training: true, name: 'משהו אחר' }), true);
  assert.equal(isIntroTrainingItem({ name: 'אימון היכרות' }), true);
  assert.equal(isIntroTrainingItem({ name: 'אימון הכירות לילדים' }), true);
  assert.equal(isIntroTrainingItem({ name: 'כרטיסייה 10 כניסות' }), false);
  assert.equal(isIntroTrainingItem(null), false);
});

test('the sale is scanned through its lines, flagged or named', () => {
  assert.equal(saleHasIntroTraining([{ item: { name: 'נעלי טיפוס' } }, { item: { name: 'אימון היכרות' } }]), true);
  assert.equal(saleHasIntroTraining([{ name: 'אימון היכרות' }]), true);
  assert.equal(saleHasIntroTraining([{ item: { name: 'חולצת חוג' } }]), false);
  assert.equal(saleHasIntroTraining([]), false);
});

test('the status only ever moves forward, and only for a real trainee', () => {
  const lines = [{ item: { name: 'אימון היכרות' } }];
  assert.equal(shouldMarkIntroPaid({ id: 's1', status: 'health_signed' }, lines), true);
  assert.equal(shouldMarkIntroPaid({ id: 's1', status: 'pending_signup' }, lines), true);
  assert.equal(shouldMarkIntroPaid({ id: 's1', status: 'intro_scheduled' }, lines), true);
  // Already there, or past it — leave alone.
  assert.equal(shouldMarkIntroPaid({ id: 's1', status: 'intro_paid' }, lines), false);
  assert.equal(shouldMarkIntroPaid({ id: 's1', status: 'registered' }, lines), false);
  // A counter sale with no trainee attached changes nobody.
  assert.equal(shouldMarkIntroPaid(null, lines), false);
  assert.equal(shouldMarkIntroPaid({ id: 's1', status: 'lead_new' }, [{ item: { name: 'מגנזיום' } }]), false);
});
