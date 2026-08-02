/**
 * בחירת בן / בת — אותה בחירה, באותה צורה, בכל טופס.
 *
 * הסמלים מצוירים כאן ולא נלקחים מספריית האייקונים: הגרסה המותקנת של
 * lucide לא כוללת מאדים/נוגה, וסמל שמצויר בקוד לא נעלם בשדרוג ספרייה.
 *
 * הערכים הם `male` / `female` בטפסי הלקוחות, אבל טופס העובדים שומר „זכר”
 * ו„נקבה”. הרכיב לא מניח כלום — הקורא מוסר את הערכים שהוא שומר.
 */

import React from 'react';

export function MaleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="14" r="6" />
      <path d="M14.5 9.5 21 3" />
      <path d="M15 3h6v6" />
    </svg>
  );
}

export function FemaleIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="9" r="6" />
      <path d="M12 15v7" />
      <path d="M9 19h6" />
    </svg>
  );
}

/** Normalize stored gender values from forms / employees / legacy rows. */
export function genderKind(gender) {
  const g = String(gender || '').trim().toLowerCase();
  if (['male', 'm', 'בן', 'זכר', 'גבר', 'boy'].includes(g)) return 'male';
  if (['female', 'f', 'בת', 'נקבה', 'אישה', 'girl'].includes(g)) return 'female';
  return null;
}

/** Compact icon for trainee chips — nothing when gender is unknown. */
export function GenderMark({ gender, size = 12, style }) {
  const kind = genderKind(gender);
  if (!kind) return null;
  const Icon = kind === 'male' ? MaleIcon : FemaleIcon;
  const label = kind === 'male' ? 'בן' : 'בת';
  return (
    <span
      title={label}
      aria-label={label}
      style={{ display: 'inline-flex', lineHeight: 0, flexShrink: 0, ...style }}
    >
      <Icon size={size} />
    </span>
  );
}

/**
 * @param {object}   props
 * @param {string}   props.value      what is stored now
 * @param {Function} props.onChange   called with the new value ('' clears it)
 * @param {Array}    props.options    [[label, value], [label, value]] — male first
 * @param {boolean}  props.clearable  clicking the chosen one unsets it
 * @param {boolean}  props.disabled
 */
export default function GenderPicker({
  value,
  onChange,
  options = [['בן', 'male'], ['בת', 'female']],
  clearable = true,
  disabled = false,
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map(([label, optionValue], index) => {
        const active = value === optionValue;
        const Icon = index === 0 ? MaleIcon : FemaleIcon;
        return (
          <button
            key={optionValue}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(clearable && active ? '' : optionValue)}
            style={{
              flex: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              padding: '11px 0', borderRadius: 11, font: 'inherit',
              fontWeight: 700, fontSize: 14, cursor: disabled ? 'default' : 'pointer',
              border: active ? '1px solid #f97316' : '1px solid rgba(255,255,255,.15)',
              background: active ? 'rgba(249,115,22,.18)' : '#0b1220',
              color: active ? '#fdba74' : '#e2e8f0',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
