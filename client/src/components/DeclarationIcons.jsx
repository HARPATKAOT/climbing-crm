import React from 'react';
import { DECLARATION_KINDS } from '../utils/declarationKinds.js';
import { FORM_FOLDER } from '../utils/participationForm.js';

/**
 * Declaration state for one climber, as icons: the climber is the wall form,
 * footprints the outdoor trip, gift a booked activity. Green means a valid
 * signature is on file, amber means it is missing or expired — the row is
 * scanned, not read, so the colour has to carry the answer.
 *
 * `validOnly` keeps just the green marks (the customer-file name row). The
 * leads table still wants the amber gaps so a missing signature stands out.
 */
export default function DeclarationIcons({ status, validOnly = false, size = 13, onClick }) {
  const marks = [
    // האייקון מגיע מקטלוג סוגי ההצהרות, כדי שאותו סימן ישמש כאן ובתיק הלקוח.
    { key: 'wall', Icon: DECLARATION_KINDS.wall.Icon, label: 'אישור פעילות בקיר' },
    { key: 'trip', Icon: DECLARATION_KINDS.trip.Icon, label: 'טופס השתתפות לטיולים' },
  ];
  const validMarks = marks.filter(({ key }) => {
    const state = status?.[key];
    return !!state?.signed && !state?.expired;
  });
  // Name-row mode: green icons for every valid signature; if none, one amber
  // climber so a missing wall form still reads at a glance.
  const shown = validOnly
    ? (validMarks.length ? validMarks : marks.filter(({ key }) => key === 'wall'))
    : marks.filter(({ key }) => {
      const state = status?.[key];
      // Wall always shows (missing is the amber signal). Extra activities only
      // appear once there is something to say about them.
      return key === 'wall' || !!state?.signed;
    });
  if (!shown.length) return null;
  const Wrap = onClick ? 'button' : 'span';
  return (
    <Wrap
      {...(onClick
        ? { type: 'button', onClick, title: `פתיחת תיקיית ${FORM_FOLDER}` }
        : {})}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        ...(onClick
          ? {
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }
          : {}),
      }}
    >
      {shown.map(({ key, Icon, label }) => {
        const state = status?.[key];
        const ok = !!state?.signed && !state?.expired;
        const title = !state?.signed
          ? `${label}: לא נחתמה`
          : state.expired ? `${label}: פג תוקף` : `${label}: בתוקף`;
        return (
          // The tooltip hangs off a span: a `title` attribute on an <svg> is
          // not what browsers show on hover.
          <span key={key} title={title} aria-label={title} style={{ display: 'inline-flex' }}>
            <Icon size={size} style={{ color: ok ? 'var(--green)' : 'var(--amber)', opacity: ok ? 1 : 0.75 }} />
          </span>
        );
      })}
    </Wrap>
  );
}
