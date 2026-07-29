import React from 'react';
import { useGroups, weekdayName, WHATSAPP_URL } from '../publicData.js';

/* Mirrors the CRM's weekly board (client/src/components/Schedule.jsx): hours
   down the side, days across, each class placed by its real start time. */
const START_HOUR = 14;
const END_HOUR = 22;
const PX_PER_MIN = 1.4;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const GRID_H = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;
const DAYS = [0, 1, 2, 3, 4, 5];

function minutesFromStart(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return (h - START_HOUR) * 60 + (Number.isFinite(m) ? m : 0);
}

function GroupChip({ group, style }) {
  return (
    <div
      className={`ks-chip${group.has_room ? '' : ' ks-chip--full'}`}
      style={style}
      title={`${group.time} · ${group.age_category}`}
    >
      <strong>{group.time}</strong>
      <span>{group.age_category || group.name}</span>
      {!group.has_room && <em>מלאה</em>}
    </div>
  );
}

function WeekBoard({ groups }) {
  return (
    <div className="ks-board-scroll">
      <div className="ks-board">
        <div className="ks-board-head">
          <div className="ks-board-hourcol" />
          {DAYS.map((day) => {
            const count = groups.filter((g) => Number(g.day) === day).length;
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
                .filter((g) => Number(g.day) === day)
                .map((group) => {
                  const top = minutesFromStart(group.time);
                  if (top == null) return null;
                  const height = Math.max((group.duration || 50) * PX_PER_MIN, 34);
                  return (
                    <GroupChip
                      key={group.id}
                      group={group}
                      style={{ top: top * PX_PER_MIN, height }}
                    />
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
  const byDay = groups.reduce((acc, g) => {
    (acc[g.day] ||= []).push(g);
    return acc;
  }, {});
  return (
    <div className="ks-daylist">
      {Object.keys(byDay).sort((a, b) => a - b).map((day) => (
        <div key={day}>
          <h3 className="ks-daylist-day">יום {weekdayName(day)}</h3>
          {byDay[day].map((group) => (
            <div className={`ks-daylist-row${group.has_room ? '' : ' is-full'}`} key={group.id}>
              <strong>{group.time}</strong>
              <span>{group.age_category || group.name}</span>
              <em>{group.has_room ? 'יש מקום' : 'מלאה'}</em>
            </div>
          ))}
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
          קבוצות קטנות לפי שכבות גיל, עם מדריכים מוסמכים. הלוח מתעדכן מהמערכת —
          מה שמסומן כפנוי באמת פנוי.
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
            <p className="ks-meta" style={{ marginTop: 14 }}>
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
    </section>
  );
}
