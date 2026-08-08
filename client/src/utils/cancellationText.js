import { formatIls } from './vat.js';

/**
 * One cancellation rule, split into the two halves a reader scans for:
 * when, and what happens then. `tone` says how good the news is —
 * 'good' (money back), 'mid' (part of it), 'bad' (none) — so a screen can
 * colour the outcome without re-reading the words.
 *
 * Shared by the event page — where the terms are read before anything is
 * filled in — and by the payment screen of the participation form, where they
 * are ticked. The same rule must not be described in two different ways on two
 * screens of one purchase, so both build on these parts.
 */
export function cancellationRuleParts(rule) {
  const min = Number(rule?.min_hours_before) || 0;
  if (min >= 168) {
    return {
      period: 'שבעה ימים ומעלה לפני הפעילות',
      outcome: `החזר בניכוי ${formatIls(rule?.fixed_fee || 0)} לכל משתתף מבוטל`,
      tone: 'good',
    };
  }
  if (min >= 48) {
    return {
      period: 'בין 48 שעות לשבעה ימים לפני הפעילות',
      outcome: `החזר של ${Number(rule?.refund_percent) || 0}%`,
      tone: 'mid',
    };
  }
  const percent = Number(rule?.refund_percent) || 0;
  return {
    period: 'פחות מ-48 שעות לפני הפעילות',
    outcome: percent ? `החזר של ${percent}%` : 'ללא החזר',
    tone: percent ? 'mid' : 'bad',
  };
}

export function cancellationRuleText(rule) {
  const { period, outcome } = cancellationRuleParts(rule);
  return `${period} — ${outcome}`;
}
