import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installNumberInputWheelGuard,
  releaseFocusedNumberInput,
} from './numberInputWheelGuard.js';

function input(type = 'number') {
  return {
    tagName: 'INPUT',
    type,
    blurred: false,
    blur() { this.blurred = true; },
  };
}

test('releases a focused number input before wheel default behavior', () => {
  const field = input();

  assert.equal(releaseFocusedNumberInput({ target: field }, field), true);
  assert.equal(field.blurred, true);
});

test('leaves select lists and non-number fields untouched', () => {
  const select = { tagName: 'SELECT', type: 'select-one', blur() {} };
  const textField = input('text');

  assert.equal(releaseFocusedNumberInput({ target: select }, select), false);
  assert.equal(releaseFocusedNumberInput({ target: textField }, textField), false);
  assert.equal(textField.blurred, false);
});

test('does not blur a number input unless it is the focused field', () => {
  const field = input();

  assert.equal(releaseFocusedNumberInput({ target: field }, null), false);
  assert.equal(field.blurred, false);
});

test('installs a passive capture listener and returns a cleanup function', () => {
  const field = input();
  const calls = [];
  const doc = {
    activeElement: field,
    addEventListener(type, listener, options) {
      calls.push({ action: 'add', type, listener, options });
    },
    removeEventListener(type, listener, options) {
      calls.push({ action: 'remove', type, listener, options });
    },
  };

  const cleanup = installNumberInputWheelGuard(doc);
  calls[0].listener({ target: field });
  cleanup();

  assert.equal(field.blurred, true);
  assert.deepEqual(calls[0].options, { capture: true, passive: true });
  assert.equal(calls[1].listener, calls[0].listener);
  assert.equal(calls[1].options, true);
});
