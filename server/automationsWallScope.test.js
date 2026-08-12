import test from 'node:test';
import assert from 'node:assert/strict';
import { isWallScope, WALL_FORM_RECEIVED_MESSAGE } from './automations.js';

test('only a wall-scope form takes the wall confirmation path', () => {
  assert.equal(isWallScope('wall'), true);
  assert.equal(isWallScope(' wall '), true);
  assert.equal(isWallScope('trip'), false);
  assert.equal(isWallScope('event'), false);
  assert.equal(isWallScope(''), false);
  assert.equal(isWallScope(undefined), false);
});

test('the wall confirmation never promises a class placement', () => {
  // זו כל התקלה: מי שבא לטפס קיבל הבטחה לתיאום שיבוץ לחוג שלא ביקש.
  assert.ok(!/השיבוץ לחוג|לתיאום השיבוץ/.test(WALL_FORM_RECEIVED_MESSAGE));
  assert.ok(WALL_FORM_RECEIVED_MESSAGE.includes('{{parentName}}'));
  assert.ok(WALL_FORM_RECEIVED_MESSAGE.includes('{{name}}'));
  assert.ok(WALL_FORM_RECEIVED_MESSAGE.includes('להיכנס לקיר'));
  // לספר מה יש כאן זו הזמנה, לא הבטחה — וזו הפעם היחידה שנדבר איתו.
  assert.match(WALL_FORM_RECEIVED_MESSAGE, /חוגי טיפוס/);
  assert.match(WALL_FORM_RECEIVED_MESSAGE, /ימי הולדת/);
  assert.match(WALL_FORM_RECEIVED_MESSAGE, /טיולי שטח/);
});
