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

/** צבעים קבועים לצ׳יפים ולסימון — כחול לבן, ורוד לבת. */
export const GENDER_COLORS = {
  male: '#38BDF8',
  female: '#F472B6',
};

/**
 * The words, in one place. „זכר / נקבה” is how a form fills a database field;
 * a person is a גבר or an אישה, and a child is a ילד or a ילדה. The stored
 * value is the same either way — only what the signer reads changes.
 */
export const ADULT_GENDER_OPTIONS = [['גבר', 'male'], ['אישה', 'female']];
export const CHILD_GENDER_OPTIONS = [['ילד', 'male'], ['ילדה', 'female']];

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

/** Silhouette of a grown-up — stands in for the word „מבוגר” on tight chips. */
export function AdultIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5.5 20.5v-1.2A5.3 5.3 0 0 1 10.8 14h2.4a5.3 5.3 0 0 1 5.3 5.3v1.2" />
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
  const color = GENDER_COLORS[kind];
  return (
    <span
      title={label}
      aria-label={label}
      style={{ display: 'inline-flex', lineHeight: 0, flexShrink: 0, color, ...style }}
    >
      <Icon size={size} />
    </span>
  );
}

/** Compact stand-in for the „מבוגר” label — children carry no mark. */
export function AdultMark({ size = 12, style }) {
  return (
    <span
      title="מבוגר"
      aria-label="מבוגר"
      style={{ display: 'inline-flex', lineHeight: 0, flexShrink: 0, color: 'var(--text-3)', ...style }}
    >
      <AdultIcon size={size} />
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
  options = CHILD_GENDER_OPTIONS,
  clearable = true,
  disabled = false,
}) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map(([label, optionValue], index) => {
        const active = value === optionValue;
        const kind = index === 0 ? 'male' : 'female';
        const Icon = kind === 'male' ? MaleIcon : FemaleIcon;
        const tint = GENDER_COLORS[kind];
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
              border: active ? `1px solid ${tint}` : '1px solid rgba(255,255,255,.15)',
              background: active ? `${tint}22` : '#0b1220',
              color: active ? tint : '#e2e8f0',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <span style={{ display: 'inline-flex', color: tint }}>
              <Icon size={16} />
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
