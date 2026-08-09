import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConversationTemplateOptions } from './conversationTemplateOptions.js';

test('ordinary templates do not receive an invented button value', () => {
  assert.deepEqual(
    resolveConversationTemplateOptions({ templateName: 'customer_details_v2' }),
    { buttonUrlParams: [] }
  );
});

test('the participation form receives the selected student as its button suffix', () => {
  assert.deepEqual(
    resolveConversationTemplateOptions({
      templateName: 'participation_form_link',
      formStudentId: 'st-2',
      students: [{ id: 'st-1' }, { id: 'st-2' }],
    }),
    { buttonUrlParams: ['st-2'] }
  );
});

test('an unrelated student id cannot be placed in the form button', () => {
  const result = resolveConversationTemplateOptions({
    templateName: 'participation_form_link',
    formStudentId: 'someone-elses-student',
    students: [{ id: 'st-1' }],
  });
  assert.match(result.error, /בחרו מתאמן/);
});
