import React from 'react';
import { useGroups, weekdayName, WHATSAPP_URL } from '../publicData.js';
import Testimonials from '../components/Testimonials.jsx';

/* Mirrors the CRM's weekly board (client/src/components/Schedule.jsx): hours
   down the side, days across, each class placed by its real start time, and
   one colour per age band. Everything operational — trainers, assistants and
   spare places — is deliberately left out; parents get the schedule, the team
   gets the rest. */
const START_HOUR = 14;
const END_HOUR = 22;
const PX_PER_MIN = 1.4;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const GRID_H = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;
const DAYS = [0, 1, 2, 3, 4, 5];

/* Same bands and order as the CRM legend. */
const AGE_BANDS = [
  { key: "א'-ב'", color: '#8B7BE8' },
  { key: "ג'-ד'", color: '#2FA37A' },
  { key: "ה'-ו'", color: '#D9A017' },
  { key: 'חטיבה', color: '#7C5BD6' },
  { key: 'תיכון', color: '#D9558E' },
  { key: 'בוגרים', color: '#2E86C8' },
];

function ageColor(category) {
  const raw = String(category || '');
  const band = AGE_BANDS.find((b) => raw.includes(b.key));
  return band ? band.color : 'var(--ks-grey)';
}

/** Days the group actually meets — a group may run twice a week. */
function groupDays(group) {
  const days = Array.isArray(group.days) && group.days.length ? group.days : [group.day];
  return days.map(Number).filter((d) => Number.isInteger(d));
}

/** The stored name repeats the day and time the grid already shows. */
function cleanName(group) {
  let name = String(group.name || '').trim();
  name = name.replace(/\s*[—–-]\s*יום\s*[א-ו]['׳]?\s*\d{1,2}:\d{2}.*$/u, '');
  name = name.replace(/\s+יום\s*[א-ו]['׳]?\s*\d{1,2}:\d{2}.*$/u, '');
  name = name.replace(/\s*[—–-]\s*[א-ו]['׳]?\s*\+\s*[א-ו]['׳]?\s*/u, ' ');
  name = name.replace(/\s*\d{1,2}:\d{2}\s*$/u, '');
  name = name.replace(/\s+/g, ' ').trim();
  return name || (group.age_category ? `כיתות ${group.age_category}` : 'חוג טיפוס');
}

function minutesFromStart(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return (h - START_HOUR) * 60 + (Number.isFinite(m) ? m : 0);
}

function Legend() {
  return (
    <div className="ks-legend">
      {AGE_BANDS.map((band) => (
        <span className="ks-legend-item" key={band.key}>
          <i style={{ background: band.color }} />
          {band.key}
        </span>
      ))}
    </div>
  );
}

function WeekBoard({ groups }) {
  return (
    <div className="ks-board-scroll">
      <div className="ks-board">
        <div className="ks-board-head">
          <div className="ks-board-hourcol">שעה</div>
          {DAYS.map((day) => {
            const count = groups.filter((g) => groupDays(g).includes(day)).length;
            return (
              <div className="ks-board-day" key={day}>
                {weekdayName(day)}
                {count > 0 && <span className="ks-board-count">{count}</span>}
              </div>
            );
          })}
        </div>

        <div className="ks-board-body" style={{ height: GRID_H }}>
          <div className="ks-board-hourcol">
            {HOURS.map((h, i) => (
              <span key={h} className="ks-board-hour" style={{ top: i * 60 * PX_PER_MIN }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {DAYS.map((day) => (
            <div className="ks-board-col" key={day}>
              {HOURS.map((h, i) => (
                <span key={h} className="ks-board-line" style={{ top: i * 60 * PX_PER_MIN }} />
              ))}
              {groups
                .filter((g) => groupDays(g).includes(day))
                .map((group) => {
                  const top = minutesFromStart(group.time);
                  if (top == null) return null;
                  const color = ageColor(group.age_category);
                  return (
                    <div
                      className="ks-chip"
                      key={`${group.id}-${day}`}
                      style={{
                        top: top * PX_PER_MIN,
                        height: Math.max((group.duration || 50) * PX_PER_MIN, 38),
                        borderInlineStartColor: color,
                        background: `color-mix(in srgb, ${color} 9%, #fff)`,
                      }}
                    >
                      <strong style={{ color }}>{group.time}</strong>
                      <span>{cleanName(group)}</span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DayList({ groups }) {
  const byDay = {};
  for (const g of groups) {
    for (const d of groupDays(g)) (byDay[d] ||= []).push(g);
  }
  return (
    <div className="ks-daylist">
      {Object.keys(byDay).sort((a, b) => a - b).map((day) => (
        <div key={day}>
          <h3 className="ks-daylist-day">יום {weekdayName(day)}</h3>
          {byDay[day].map((group) => {
            const color = ageColor(group.age_category);
            return (
              <div
                className="ks-daylist-row"
                key={`${group.id}-${day}`}
                style={{ borderInlineStartColor: color }}
              >
                <strong style={{ color }}>{group.time}</strong>
                <span>{cleanName(group)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function Classes() {
  const { data, loading, error } = useGroups();
  const groups = data || [];

  return (
    <section className="ks-section">
      <div className="ks-wrap">
        <span className="ks-eyebrow">לוח חוגים</span>
        <h1 className="ks-h1">חוגי טיפוס שבועיים</h1>
        <p className="ks-lede">
          קבוצות קטנות לפי שכבות גיל, עם מדריכים מוסמכים. הלוח מתעדכן מהמערכת.
        </p>

        {loading && <p className="ks-meta">טוען חוגים…</p>}
        {error && <p className="ks-meta">לא הצלחנו לטעון את הלוח כרגע. כתבו לנו ונעדכן.</p>}
        {!loading && !error && !groups.length && (
          <p className="ks-meta">אין כרגע חוגים פתוחים במערכת. כתבו לנו ונעדכן.</p>
        )}

        {!!groups.length && (
          <>
            <WeekBoard groups={groups} />
            <DayList groups={groups} />
            <Legend />
            <p className="ks-meta" style={{ marginTop: 18 }}>
              המחירים משתנים לפי מספר האימונים בשבוע — נשמח למסור בהודעה.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a className="ks-btn ks-btn--wa" href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                לשריון מקום ולפרטי מחיר
              </a>
              <a className="ks-btn ks-btn--ghost" href="/join?interest=classes">
                השארת פרטים לחזרה
              </a>
            </div>
          </>
        )}
      </div>

      <div className="ks-wrap" style={{ marginTop: 64 }}>
        <div className="ks-sectionhead">
          <h2>מה הורים מספרים</h2>
        </div>
        <Testimonials />
      </div>
    </section>
  );
}
