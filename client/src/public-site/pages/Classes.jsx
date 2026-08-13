import React from 'react';
import { Brain, Heart, ShieldCheck, Sparkles } from 'lucide-react';
import { useGroups, weekdayName, whatsappUrl } from '../publicData.js';
import Testimonials from '../components/Testimonials.jsx';

/* Mirrors the CRM's weekly board (client/src/components/Schedule.jsx): hours
   down the side, days across, each class placed by its real start time, and
   one colour per age band. Everything operational — trainers, assistants and
   spare places — is deliberately left out; parents get the schedule, the team
   gets the rest. */
const PX_PER_MIN = 1.5;
const ALL_DAYS = [0, 1, 2, 3, 4, 5];

/* The brand palette is used as a restrained identifier, never as a solid card fill. */
const AGE_BANDS = [
  { key: "א'-ב'", color: '#0AA6A6' },
  { key: "ג'-ד'", color: '#2866B1' },
  { key: "ה'-ו'", color: '#D59A18' },
  { key: 'חטיבה', color: '#476B72' },
  { key: 'תיכון', color: '#B72E3D' },
  { key: 'בוגרים', color: '#7B4A1F' },
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

function toMinutes(time) {
  const [h, m] = String(time || '').split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Fit the grid to the classes that exist instead of a fixed 14:00–22:00 window.
 * A wall that runs 15:00–21:00 was showing two empty hours of dead space.
 */
function gridBounds(groups) {
  let min = Infinity;
  let max = -Infinity;
  for (const g of groups) {
    const start = toMinutes(g.time);
    if (start == null) continue;
    min = Math.min(min, start);
    max = Math.max(max, start + (g.duration || 50));
  }
  if (!Number.isFinite(min)) return { startHour: 15, endHour: 21 };
  return {
    startHour: Math.floor(min / 60),
    endHour: Math.min(23, Math.ceil(max / 60)),
  };
}

function Legend() {
  return (
    <div className="ks-legend" aria-label="מקרא שכבות גיל">
      <strong className="ks-legend-title">שכבות גיל</strong>
      {AGE_BANDS.map((band) => (
        <span className="ks-legend-item" key={band.key} style={{ '--ks-chip-accent': band.color }}>
          <i style={{ background: band.color }} />
          {band.key}
        </span>
      ))}
    </div>
  );
}

function WeekBoard({ groups }) {
  const { startHour, endHour } = gridBounds(groups);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
  const gridH = (endHour - startHour) * 60 * PX_PER_MIN;
  // A day with no classes is not a column worth a sixth of the width.
  const days = ALL_DAYS.filter((d) => groups.some((g) => groupDays(g).includes(d)));

  return (
    <div className="ks-board-scroll">
      <div className="ks-board">
        <div className="ks-board-head">
          <div className="ks-board-hourcol" />
          {days.map((day) => (
            <div className="ks-board-day" key={day}>
              {weekdayName(day)}
              <span className="ks-board-count">
                {groups.filter((g) => groupDays(g).includes(day)).length}
              </span>
            </div>
          ))}
        </div>

        <div className="ks-board-body" style={{ height: gridH }}>
          <div className="ks-board-hourcol">
            {hours.map((h, i) => (
              <span key={h} className="ks-board-hour" style={{ top: i * 60 * PX_PER_MIN }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>

          {days.map((day) => (
            <div className="ks-board-col" key={day}>
              {hours.map((h, i) => (
                <span key={h} className="ks-board-line" style={{ top: i * 60 * PX_PER_MIN }} />
              ))}
              {groups
                .filter((g) => groupDays(g).includes(day))
                .map((group) => {
                  const start = toMinutes(group.time);
                  if (start == null) return null;
                  const color = ageColor(group.age_category);
                  return (
                    <div
                      className="ks-chip"
                      key={`${group.id}-${day}`}
                      aria-label={`${cleanName(group)}, יום ${weekdayName(day)} בשעה ${group.time}`}
                      style={{
                        top: (start - startHour * 60) * PX_PER_MIN,
                        height: Math.max((group.duration || 50) * PX_PER_MIN - 4, 44),
                        '--ks-chip-accent': color,
                      }}
                    >
                      <strong className="ks-chip-name">{cleanName(group)}</strong>
                      <time className="ks-chip-time" dateTime={group.time}>{group.time}</time>
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
                style={{ '--ks-chip-accent': color }}
              >
                <strong className="ks-daylist-name">{cleanName(group)}</strong>
                <time className="ks-daylist-time" dateTime={group.time}>{group.time}</time>
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
    <>
      <section
        className="ks-pagehero"
        style={{ backgroundImage: "linear-gradient(90deg, rgba(25,24,18,.18), rgba(25,24,18,.82)), url('/gallery/gallery-08.jpg')" }}
      >
        <div className="ks-wrap">
          <span className="ks-eyebrow">חוגי טיפוס בתל מונד</span>
          <h1 className="ks-h1">לומדים לטפס.<br />לומדים להאמין.</h1>
          <p className="ks-lede">קבוצות קטנות לפי שכבות גיל, תהליך שבועי ומדריכים שמכירים כל ילד וילדה.</p>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap ks-classes-intro">
          <div>
            <span className="ks-eyebrow">ספורט שמפתח הרבה מעבר לגוף</span>
            <h2 className="ks-h2">כל מסלול הוא בעיה שאפשר לפתור</h2>
            <p className="ks-lede">הילדים בונים טכניקה, כוח וגמישות — ובאותו זמן מתרגלים ריכוז, התמודדות והתמדה בסביבה תומכת.</p>
            <ul className="ks-benefits">
              <li><i><Brain size={21} /></i><div><strong>חשיבה וריכוז</strong><span>תכנון תנועה, קריאת מסלול וקבלת החלטות בזמן אמת.</span></div></li>
              <li><i><Sparkles size={21} /></i><div><strong>מסוגלות והתמדה</strong><span>מנסים, לומדים, משנים ומגיעים צעד אחד גבוה יותר.</span></div></li>
              <li><i><Heart size={21} /></i><div><strong>חברות ופרגון</strong><span>קבוצה שמלמדת לעודד, לבטוח ולעבוד יחד.</span></div></li>
              <li><i><ShieldCheck size={21} /></i><div><strong>הרגלי בטיחות</strong><span>עבודה מסודרת עם ציוד ובהשגחת מדריכים מוסמכים.</span></div></li>
            </ul>
          </div>
          <div className="ks-classes-photo">
            <img src="/gallery/gallery-05.jpg" alt="ילדים משתפים פעולה בפעילות חוג בקיר בועז" loading="lazy" />
          </div>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div><span className="ks-eyebrow">גדלים יחד</span><h2 className="ks-h2">קבוצה שמתאימה לשלב הנכון</h2><p>החלוקה בפועל נקבעת לפי שכבת גיל, ניסיון ומקום פנוי.</p></div>
          </div>
          <div className="ks-age-grid">
            <article className="ks-age-card"><b>א׳–ד׳</b><h3>היכרות, תנועה וביטחון</h3><p>משחקי טיפוס, יסודות טכניקה והתרגלות בטוחה לגובה.</p></article>
            <article className="ks-age-card"><b>ה׳–ו׳</b><h3>טכניקה ועצמאות</h3><p>מסלולים מורכבים יותר, שיפור תנועה והעמקת עבודת הצוות.</p></article>
            <article className="ks-age-card"><b>נוער ובוגרים</b><h3>אתגר והתקדמות</h3><p>אימון ממוקד, מטרות אישיות והכנה למפגש עם הסלע בשטח.</p></article>
          </div>
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-sectionhead">
            <div><span className="ks-eyebrow">לוח חוגים חי</span><h2 className="ks-h2">מוצאים את היום שמתאים לכם</h2><p>הלוח מגיע ישירות מהמערכת. בנייד הוא הופך לרשימה ברורה לפי ימים.</p></div>
          </div>

          {loading && <p className="ks-meta">טוען את לוח החוגים…</p>}
          {error && <p className="ks-meta">לא הצלחנו לטעון את הלוח כרגע. שלחו לנו הודעה ונבדוק יחד.</p>}
          {!loading && !error && !groups.length && <p className="ks-meta">אין כרגע קבוצות שמופיעות באתר. כתבו לנו ונעדכן.</p>}

          {!!groups.length && (
            <>
              <WeekBoard groups={groups} />
              <DayList groups={groups} />
              <Legend />
            </>
          )}

          <div className="ks-actions" style={{ marginTop: 24 }}>
            <a className="ks-btn ks-btn--wa" href={whatsappUrl('שלום, אשמח לבדוק קבוצה מתאימה ומקום פנוי בחוגי הטיפוס')} target="_blank" rel="noreferrer">בדיקת מקום בקבוצה</a>
          </div>
          <p className="ks-meta" style={{ marginTop: 12 }}>מחירים ותדירות נמסרים לפי הקבוצה המתאימה ומספר האימונים בשבוע.</p>
        </div>
      </section>

      <section className="ks-section ks-section--canvas">
        <div className="ks-wrap">
          <div className="ks-sectionhead"><div><span className="ks-eyebrow">מההורים</span><h2 className="ks-h2">כשהילדים מחכים כבר לאימון הבא</h2></div></div>
          <Testimonials />
        </div>
      </section>

      <section className="ks-section">
        <div className="ks-wrap">
          <div className="ks-cta">
            <span className="ks-eyebrow">ניסיון ראשון</span>
            <h2 className="ks-h2">רוצים לראות אם זה מתאים?</h2>
            <p>כתבו לנו גיל, ניסיון קודם והימים שנוחים לכם. נבדוק קבוצה מתאימה ונסביר בדיוק איך מתחילים.</p>
            <a className="ks-btn ks-btn--light" href={whatsappUrl('שלום, אני רוצה לבדוק התאמה לחוג טיפוס לילד/ה. אשמח לפרטים')} target="_blank" rel="noreferrer">מתחילים בוואטסאפ</a>
          </div>
        </div>
      </section>
    </>
  );
}
