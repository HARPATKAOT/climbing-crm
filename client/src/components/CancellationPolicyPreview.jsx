import React from 'react';
import { formatIls } from '../utils/vat.js';

function ruleLabel(rule) {
  if (Number(rule.min_hours_before) >= 168) return 'לפחות 7 ימים לפני הפעילות';
  if (Number(rule.min_hours_before) >= 48) return 'בין 48 שעות ל־7 ימים לפני הפעילות';
  return 'פחות מ־48 שעות לפני הפעילות';
}

/**
 * מדיניות הביטול כפי שהלקוח קורא אותה.
 *
 * מסך ההגדרות הראה תצוגה מנוסחת, והקופה הרכיבה לעצמה רשימת בולטים משלה מאותם
 * נתונים — עם ניסוח אחר, בלי תקופת הצינון, ובלי הכלל של „ביטול באמצע” שהוא
 * הכלל היחיד שרלוונטי לכרטיסייה. הצוות הקריא ללקוח נוסח אחד והמסמך אמר אחר.
 * זהו אותו רכיב בשני המקומות, ולכן אין להם דרך להתפצל שוב.
 *
 * מקבל את תמונת המדיניות (`policySnapshot` מהשרת) או טיוטה מהמסך — לשתיהן
 * אותם שדות: `basis`, `rules`, `usage_rule`, `cooling_off_hours`, `free_text`.
 */
export default function CancellationPolicyPreview({ policy, className = 'policy-preview' }) {
  if (!policy) return null;
  const coolingHours = Number(policy.cooling_off_hours) || 0;
  const usage = policy.usage_rule || {};
  const rules = Array.isArray(policy.rules) ? policy.rules : [];

  return (
    <div className={className}>
      {coolingHours > 0 && (
        <p className="policy-preview-line is-good">
          <b>עד {coolingHours} שעות מרגע ההרשמה:</b> ביטול ללא עלות, החזר מלא.
        </p>
      )}

      {policy.basis === 'usage' ? (
        <>
          <p className="policy-preview-line">
            <b>ביטול באמצע:</b>{' '}
            {usage.settlement === 'full_price'
              ? (usage.full_unit_price_source === 'anchor'
                ? 'מה שנוצל מחויב במחיר היחידה שבמחירון ביום המכירה, והיתרה מוחזרת'
                : `מה שנוצל מחויב ב-${formatIls(usage.full_unit_price)} ליחידה, והיתרה מוחזרת`)
              : `החזר ${Number(usage.unused_refund_percent) || 0}% מערך החלק שלא נוצל`}
            {Number(usage.fixed_fee)
              ? `, בניכוי ${formatIls(usage.fixed_fee)} דמי ביטול`
              : ''}.
          </p>
          {Number(usage.min_used_units) > 0 && (
            <p className="policy-preview-line">
              <b>התחייבות מינימלית:</b> {usage.min_used_units} יחידות משולמות בכל מקרה.
            </p>
          )}
          {Number(usage.no_refund_after_percent) < 100 && (
            <p className="policy-preview-line">
              <b>מעל {usage.no_refund_after_percent}% ניצול:</b> אין החזר.
            </p>
          )}
        </>
      ) : rules.map((rule) => (
        <p key={rule.id || ruleLabel(rule)} className="policy-preview-line">
          <b>{ruleLabel(rule)}:</b> החזר {Number(rule.refund_percent) || 0}%
          {Number(rule.fixed_fee) ? `, בניכוי ${formatIls(rule.fixed_fee)} לכל משתתף` : ''}
        </p>
      ))}

      {policy.free_text && <p className="policy-preview-free">{policy.free_text}</p>}
      <p className="policy-preview-line is-good"><b>ביטול על ידינו:</b> החזר מלא.</p>
    </div>
  );
}
