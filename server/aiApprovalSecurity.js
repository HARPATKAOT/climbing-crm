import { authorizedRegistrationPaymentStatus } from './activityInterest.js';
import { accessAtLeast, hasSensitiveAccess } from './userAccess.js';

function forbidden(message) {
  return Object.assign(new Error(message), { status: 403 });
}

/**
 * The assistant permission governs the suggestion inbox, not the business
 * object that an approved suggestion mutates. Re-check the target permission
 * at approval time so a stored suggestion cannot become a cross-module write.
 */
export function assertAiSuggestionApprovalAccess(context, suggestion, activity = null) {
  if (context?.role === 'owner') return;

  const type = String(suggestion?.type || '');
  if (type === 'create_task' || type === 'update_task') return;

  if (type === 'add_customer_note') {
    if (!accessAtLeast(context, 'customers', 'edit')) {
      throw forbidden('נדרשת הרשאת עריכת לקוחות כדי לאשר הוספת הערה');
    }
    return;
  }

  if (type === 'add_activity_interest' || type === 'register_to_activity') {
    if (!accessAtLeast(context, 'activity_registrations', 'edit')) {
      throw forbidden('נדרשת הרשאת עריכת נרשמים כדי לאשר את הפעולה');
    }
    if (type === 'register_to_activity') {
      authorizedRegistrationPaymentStatus(
        suggestion?.args?.payment_status,
        activity,
        hasSensitiveAccess(context, 'finance')
      );
    }
  }
}
