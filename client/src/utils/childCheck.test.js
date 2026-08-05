import test from 'node:test';
import assert from 'node:assert/strict';
import { familySelectionAfterLookup } from './childCheck.js';

test('an empty family-candidate list never means new family', () => {
  assert.equal(familySelectionAfterLookup({
    families: [],
    currentSelection: '',
    answeredForKey: 'איל|0508862878',
    checkKey: 'איל|0508862878',
  }), null);
});

test('a changed lookup waits for an explicit family answer', () => {
  assert.equal(familySelectionAfterLookup({
    families: [{ parent_id: 'p1' }],
    currentSelection: 'p-old',
    answeredForKey: 'כהן|0500000000',
    checkKey: 'איל|0508862878',
  }), null);
});

test('an explicit answer is preserved for the same lookup', () => {
  assert.equal(familySelectionAfterLookup({
    families: [{ parent_id: 'p1' }],
    currentSelection: 'p1',
    answeredForKey: 'איל|0508862878',
    checkKey: 'איל|0508862878',
  }), 'p1');
});
