import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adultParticipantFromContext,
  participationGenderValue,
} from './participationForm.js';

test('self-signing participant keeps birth date and gender from the student card', () => {
  const participant = adultParticipantFromContext(
    {
      id: 'student-1',
      name: 'דלק איל',
      idNumber: '111111118',
      birthDate: '1985-06-03',
      gender: 'male',
    },
    { fullName: 'דלק איל', idNumber: '032702656' },
  );

  assert.deepEqual(participant, {
    id: 'student-1',
    name: 'דלק איל',
    idNumber: '032702656',
    birthDate: '1985-06-03',
    gender: 'male',
    type: 'adult',
  });
});

test('legacy snake-case birth date is also accepted', () => {
  const participant = adultParticipantFromContext({
    name: 'Adult',
    birth_date: '1990-01-02',
    gender: 'female',
  });

  assert.equal(participant.birthDate, '1990-01-02');
  assert.equal(participant.gender, 'female');
});

test('Hebrew CRM gender values activate the public form buttons', () => {
  assert.equal(participationGenderValue('זכר'), 'male');
  assert.equal(participationGenderValue('גבר'), 'male');
  assert.equal(participationGenderValue('נקבה'), 'female');
  assert.equal(participationGenderValue('אישה'), 'female');

  const participant = adultParticipantFromContext({ gender: 'זכר' });
  assert.equal(participant.gender, 'male');
});
