import test from 'node:test';
import assert from 'node:assert/strict';
import { ageLabelFor, parseCustomerDate, spellOutDate } from './botTools.js';

const NOW = new Date('2026-08-03T09:00:00Z');

test('the age is worked out here, because the model got it wrong', () => {
  // The real failure: handed "2021-12-15" the model told a parent their child
  // was "about 3" in August 2026, while the card beside it said four and a half.
  assert.equal(ageLabelFor('2021-12-15', NOW), '4 וחצי');
  assert.equal(ageLabelFor('2013-04-10', NOW), '13');
  // Six months past the birthday earns the "וחצי", without rounding up a year.
  assert.equal(ageLabelFor('2020-08-02', NOW), '6');
  assert.equal(ageLabelFor('2020-02-02', NOW), '6 וחצי');
  assert.equal(ageLabelFor(''), '');
  assert.equal(ageLabelFor('not a date'), '');
});

test('a numeric date is read day-first, the way it is written here', () => {
  // "10.4.2013" is April here and October in half the world's software, and
  // guessing is how a thirteen-year-old becomes a three-year-old.
  assert.equal(parseCustomerDate('10.4.2013'), '2013-04-10');
  assert.equal(parseCustomerDate('10/4/2013'), '2013-04-10');
  assert.equal(parseCustomerDate('2013-04-10'), '2013-04-10');
  // Impossible, and therefore not saved quietly.
  assert.equal(parseCustomerDate('31.2.2013'), null);
  assert.equal(parseCustomerDate('10.13.2013'), null);
  assert.equal(parseCustomerDate('10.4.2200'), null);
  assert.equal(parseCustomerDate('מחר'), null);
  assert.equal(parseCustomerDate(''), null);
});

test('the date is read back in words, so nobody confirms the wrong month', () => {
  assert.equal(spellOutDate('2013-04-10'), '10 באפריל 2013');
  assert.equal(spellOutDate('2013-10-04'), '4 באוקטובר 2013');
  assert.equal(spellOutDate('bad'), '');
});
