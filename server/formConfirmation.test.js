import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formConfirmationPayload,
  participantNamesForConfirmation,
} from './formConfirmation.js';

test('one form confirmation names every participant, existing or new', () => {
  const students = [
    { id: 'tom', name: 'תום פרידמן', source: 'notion' },
    { id: 'aviv', name: 'אביב פרידמן', source: 'form' },
  ];
  const payload = formConfirmationPayload({
    parent: { id: 'tali', name: 'טלי פרידמן', phone: '972523944749' },
    students,
  });

  assert.equal(payload.name, 'תום פרידמן ואביב פרידמן');
  assert.equal(payload.parentName, 'טלי פרידמן');
  assert.equal(payload.phone, '972523944749');
  assert.equal(payload.id, 'tom');
});

test('participant name list is unique and reads naturally in Hebrew', () => {
  assert.equal(participantNamesForConfirmation([{ name: 'ראם איל' }]), 'ראם איל');
  assert.equal(
    participantNamesForConfirmation([{ name: 'א' }, { name: 'ב' }, { name: 'ג' }, { name: 'ב' }]),
    'א, ב וג'
  );
  assert.equal(participantNamesForConfirmation([]), '');
});
