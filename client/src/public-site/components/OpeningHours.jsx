import React from 'react';
import { useOpeningHours, dayLabel, shortDate, formatSlot } from '../publicData.js';

/**
 * Opening hours as the next few days rather than a fixed weekly table — the
 * wall's hours genuinely move with the season and the weather, and the owner
 * keeps them in the CRM calendar. A day with no entry is shown as closed,
 * which is the safe answer: better a phone call than a wasted drive.
 */
export default function OpeningHours({ days = 7 }) {
  const { data, loading, error } = useOpeningHours();
  if (loading) return <p className="ks-meta">טוען שעות…</p>;
  if (error || !data) return <p className="ks-meta">לא הצלחנו לטעון את השעות. כתבו לנו ונעדכן.</p>;

  const today = data[0]?.date;
  const list = data.slice(0, days);

  return (
    <ul className="ks-hours">
      {list.map((day) => (
        <li key={day.date} className={day.open ? 'is-open' : undefined}>
          <span className="ks-hours-day">
            {dayLabel(day.date, today)}
            <span className="ks-meta" style={{ fontWeight: 400 }}> · {shortDate(day.date)}</span>
          </span>
          <span className="ks-hours-val">
            {day.open ? day.slots.map(formatSlot).join(' · ') : 'סגור'}
          </span>
        </li>
      ))}
    </ul>
  );
}
