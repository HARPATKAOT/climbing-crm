import {
  PARTICIPATION_FORM_TEMPLATE,
  participationFormButtonParam,
} from '../participationFormWhatsappTemplate.js';

/**
 * Resolve the values Meta needs beyond the body fields for a template chosen
 * from a conversation. In particular, the participation-form button contains
 * a per-student URL suffix and cannot be sent as a generic template alone.
 */
export function resolveConversationTemplateOptions({ templateName, students = [], formStudentId } = {}) {
  if (String(templateName || '') !== PARTICIPATION_FORM_TEMPLATE) {
    return { buttonUrlParams: [] };
  }

  const student = (Array.isArray(students) ? students : []).find(
    (item) => String(item?.id || '') === String(formStudentId || '')
  );
  if (!student) {
    return { error: 'בחרו מתאמן כדי לשלוח טופס השתתפות' };
  }

  return {
    buttonUrlParams: [participationFormButtonParam(student.id)],
  };
}
