import { formatIls } from './vat.js';

/**
 * One cancellation rule, in the words a customer reads.
 *
 * Shared by the event page — where the terms are read before anything is
 * filled in — and by the payment screen of the participation form, where they
 * are ticked. The same rule must not be described in two different ways on two
 * screens of one purchase.
 */
export function cancellationRuleText(rule) {
  const min = Number(rule?.min_hours_before) || 0;
  if (min >= 168) return `שבעה ימים ומעלה לפני הפעילות — החזר בניכוי ${formatIls(rule?.fixed_fee || 0)} לכל משתתף מבוטל`;
  if (min >= 48) return `בין 48 שעות לשבעה ימים לפני הפעילות — החזר של ${Number(rule?.refund_percent) || 0}%`;
  return `פחות מ-48 שעות לפני הפעילות — ${Number(rule?.refund_percent) ? `החזר של ${rule.refund_percent}%` : 'ללא החזר'}`;
}
