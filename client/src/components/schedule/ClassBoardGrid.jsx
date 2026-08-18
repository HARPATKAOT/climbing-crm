/**
 * לוח החוגים השבועי — הרשת עצמה, בלי המסך שסביבה.
 *
 * הלוח משמש בשני מקומות שאסור שייראו שונה: מסך החוגים של הצוות, וטופס השיבוץ
 * שהעובד פותח מהטלפון. אלה אותם חוגים באותן שעות, ועובד שמכיר את הלוח צריך לזהות
 * אותו מיד — ולכן הגאומטריה, הצבעים והכרטיס יושבים כאן ולא בתוך אחד המסכים.
 *
 * מה שמשתנה בין השניים הוא רק מה שמצויר בתוך המשבצת, ולכן `renderBlock` הוא
 * הפרמטר: המסך הפנימי מצייר כרטיס עם תפוסה ופתיחת פאנל, והטופס הציבורי מצייר את
 * אותו כרטיס עם כיסאות לסימון.
 */
import React from 'react';
import { Users, UserPlus } from 'lucide-react';
import { AGE_COLORS, DEF_COLOR, shortGroupLabel, getGroupDays } from '../../scheduleUtils.js';
import { DAYS_FULL } from '../../mockData.js';

// רשת: 1.5 פיקסל לדקה, מ-14:00 עד 22:00.
export const START_MIN  = 14 * 60;
export const END_MIN    = 22 * 60;
export const PX_PER_MIN = 1.5;
export const HOUR_H     = 60 * PX_PER_MIN;                    // 90px
export const GRID_H     = (END_MIN - START_MIN) * PX_PER_MIN; // 720px
export const HOURS      = Array.from({ length: 9 }, (_, i) => 14 + i);

export function t2m(t) { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; }
export function topPx(time)   { return (t2m(time) - START_MIN) * PX_PER_MIN; }
export function heightPx(dur) { return (Number(dur) || 0) * PX_PER_MIN; }

/**
 * A capacity bar is read at a glance and should answer one question: which
 * groups still need selling. So it is coloured by how full the group is, not
 * by age category — the age colour is already the card's border and repeating
 * it on the bar carried no information of its own.
 */
const OCCUPANCY_BANDS = [
  { min: 100, bar: '#38BDF8', text: '#7DD3FC', label: 'מלא'         },
  { min: 80,  bar: '#34D399', text: '#6EE7B7', label: 'כמעט מלא'    },
  { min: 50,  bar: '#FBBF24', text: '#FCD34D', label: 'חצי מלא'     },
  { min: 0,   bar: '#F87171', text: '#FCA5A5', label: 'תפוסה נמוכה' },
];
const NO_CAPACITY = { bar: 'rgba(255,255,255,0.25)', text: 'var(--text-3)', label: 'לא הוגדרה תפוסה' };

/** Bar colour, count colour and a hover line, from a count against a capacity. */
export function occupancyOf(count, maxSlots) {
  if (!(maxSlots > 0)) return { pct: 0, ...NO_CAPACITY, title: NO_CAPACITY.label };
  const pct  = (count / maxSlots) * 100;
  const band = OCCUPANCY_BANDS.find(b => pct >= b.min);
  // Over capacity is not the same as full: somebody has to be moved out.
  const over = count > maxSlots;
  const label = over ? `חריגה · ${count - maxSlots} מעל התפוסה` : band.label;
  return {
    pct,
    bar: band.bar,
    text: over ? '#FCA5A5' : band.text,
    label,
    title: `תפוסה ${Math.round(pct)}% · ${label}`,
  };
}

/**
 * אילו ימים מוצגים. יום בלי חוגים מוסתר מעצמו, כי עמודה ריקה גוזלת רבע מהרוחב
 * ואינה אומרת דבר. `pref` היא בחירה מפורשת של המשתמש והיא גוברת.
 */
export function visibleDaysOf(groups = [], pref = null) {
  const dayCounts = DAYS_FULL.map((_, i) => groups.filter(g => getGroupDays(g).includes(i)).length);
  const auto = dayCounts.some(c => c > 0)
    ? DAYS_FULL.map((_, i) => i).filter(i => dayCounts[i] > 0)
    : DAYS_FULL.map((_, i) => i);
  const visibleDays = Array.isArray(pref) && pref.length ? [...pref].sort((a, b) => a - b) : auto;
  return { dayCounts, visibleDays };
}

/**
 * המשבצת של חוג אחד.
 *
 * `enrolledCount` ריק מסתיר את שורת התפוסה לגמרי — הטופס הציבורי נפתח בלי
 * התחברות, ואין סיבה שהוא יספר לעובד כמה מתאמנים יש בכל קבוצה.
 */
export function GroupBlock({
  group,
  enrolledCount,
  selected,
  onClick,
  onContextMenu,
  children,
  // מי מדריך את החוג. בטופס הציבורי אין מה למלא כאן, ו„ללא מדריך” על חוג שיש
  // לו מדריך הוא שקר — עדיף בלי השורה.
  showStaff = true,
  // הגאומטריה של הרשת המארחת. בטלפון הרשת מתכווצת כדי להיכנס במסך בלי גלילה,
  // והמשבצת חייבת לזוז ולהתקצר יחד איתה — אחרת חוג של 17:00 מצויר על 15:30.
  startMin = START_MIN,
  pxPerMin = PX_PER_MIN,
}) {
  const c    = AGE_COLORS[group.ageCategory] || DEF_COLOR;
  const top  = (t2m(group.time) - startMin) * pxPerMin;
  const h    = (Number(group.duration) || 0) * pxPerMin;
  const showCapacity = enrolledCount !== null && enrolledCount !== undefined;
  const occ  = showCapacity ? occupancyOf(enrolledCount, group.maxSlots) : null;

  // Short label
  const label = shortGroupLabel(group.name);

  const assistantNames = Array.isArray(group.assistantNames) ? group.assistantNames : [];
  const staffTitle = [
    group.trainerName ? `מדריך: ${group.trainerName}` : 'ללא מדריך',
    assistantNames.length ? `עוזרי מדריך: ${assistantNames.join(', ')}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div onClick={onClick} onContextMenu={onContextMenu} style={{
      position: 'absolute',
      top: `${top}px`,
      height: `${h}px`,
      left: '3px',
      right: '3px',
      background: c.bg,
      border: `1.5px solid ${selected ? c.text : c.border}`,
      borderRadius: 7,
      padding: '4px 7px',
      cursor: 'pointer',
      overflow: 'hidden',
      boxShadow: selected ? `0 0 0 2px ${c.text}44, 0 4px 16px ${c.bg}` : '0 1px 4px rgba(0,0,0,0.2)',
      transition: 'box-shadow 0.15s, border-color 0.15s',
      zIndex: selected ? 10 : 2,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      {/* Name */}
      <div style={{ fontSize: Math.min(12, h > 65 ? 12 : 10), fontWeight: 700, color: c.text,
        lineHeight: 1.2, overflow: 'hidden', display: '-webkit-box', flexShrink: 0,
        WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
        {label}
      </div>

      {/* Trainer, then assistants on the next line when assigned. */}
      {showStaff && h >= 55 && (
        <div title={staffTitle} style={{ marginTop: 1, flexShrink: 0, minWidth: 0 }}>
          <div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <Users size={9} style={{ flexShrink: 0, opacity: 0.55, color: 'rgba(255,255,255,0.45)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: group.trainerName ? c.text : 'rgba(255,255,255,0.35)', fontWeight: 600 }}>
              {group.trainerName || 'ללא מדריך'}
            </span>
          </div>
          {assistantNames.length > 0 && (
            <div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4,
              minWidth: 0, marginTop: 1 }}>
              <UserPlus size={9} style={{ flexShrink: 0, opacity: 0.5, color: 'rgba(255,255,255,0.45)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: 'rgba(255,255,255,0.55)' }}>
                {assistantNames.join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* מה שהמסך המארח מוסיף בתוך המשבצת — כיסאות לסימון, למשל. */}
      {children}

      {/* Time + capacity share the bottom row so staff keeps its own lines. */}
      {h >= 55 && (
        <div title={occ ? occ.title : undefined} style={{ display: 'flex', alignItems: 'center', gap: 4,
          marginTop: 'auto', paddingTop: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}>
            {group.time} · {group.duration}′
          </span>
          {showCapacity && (
            <>
              <div style={{ flex: 1, height: 2.5, borderRadius: 2, background: 'rgba(255,255,255,0.1)' }}>
                <div style={{ width: `${Math.min(occ.pct, 100)}%`, height: '100%', borderRadius: 2,
                  background: occ.bar }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: 700, color: occ.text }}>
                {enrolledCount}/{group.maxSlots}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * הרשת השבועית. `renderBlock(group, day)` מחזיר את מה שמצויר בעמודת אותו יום,
 * כך שאותה רשת משרתת גם את מסך הצוות וגם את הטופס הציבורי.
 */
export default function ClassBoardGrid({
  groups = [],
  days = null,
  dayCounts = null,
  renderBlock,
  // ברירת המחדל היא הלוח המלא של מסך החוגים. טופס בטלפון מוסר טווח צר יותר
  // וצפיפות נמוכה יותר, כדי שכל הלוח ייכנס במסך אחד בלי גלילה לשום כיוון.
  startMin = START_MIN,
  endMin = END_MIN,
  pxPerMin = PX_PER_MIN,
  hourLabelWidth = 52,
  minColWidth = 120,
  showCounts = true,
}) {
  const computed = visibleDaysOf(groups, days);
  const visibleDays = days && days.length ? days : computed.visibleDays;
  const counts = dayCounts || computed.dayCounts;
  const gridH = (endMin - startMin) * pxPerMin;
  const hourH = 60 * pxPerMin;
  const hours = Array.from(
    { length: Math.max(1, Math.ceil((endMin - startMin) / 60)) },
    (_, i) => Math.floor(startMin / 60) + i
  );
  const geometry = { startMin, pxPerMin };

  return (
    <div className="card" style={{ overflow: 'auto' }}>
      <div style={{ minWidth: hourLabelWidth + visibleDays.length * minColWidth, display: 'flex', flexDirection: 'column' }}>
        {/* Day headers */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: hourLabelWidth, flexShrink: 0, padding: '10px 4px', fontSize: 10, color: 'var(--text-3)' }}>שעה</div>
          {visibleDays.map((i, pos) => {
            const count = counts[i];
            return (
              <div key={i} style={{
                flex: 1, padding: '10px 8px',
                fontSize: 12, fontWeight: 600, color: count ? 'var(--text-1)' : 'var(--text-3)',
                textAlign: 'center',
                borderLeft: pos > 0 ? '1px solid var(--border)' : 'none',
              }}>
                {DAYS_FULL[i]}
                {showCounts && count > 0 && (
                  <span style={{ marginRight: 5, fontSize: 10, color: 'var(--text-3)' }}>({count})</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Grid body */}
        <div style={{ display: 'flex', position: 'relative' }}>
          {/* Time labels column */}
          <div style={{ width: `${hourLabelWidth}px`, flexShrink: 0, position: 'relative', height: `${gridH}px` }}>
            {hours.map((h, i) => (
              <div key={h} style={{
                position: 'absolute', top: `${i * hourH}px`,
                width: '100%', padding: '3px 4px',
                fontSize: 10, color: 'var(--text-3)',
              }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* Day columns — only the days the user chose to show */}
          {visibleDays.map((day) => {
            const dayGroups = groups.filter(g => getGroupDays(g).includes(day));
            return (
              <div key={day} style={{
                flex: 1, position: 'relative', height: `${gridH}px`, minWidth: 0,
                borderLeft: '1px solid var(--border)',
              }}>
                {/* Hour grid lines */}
                {hours.map((_, i) => (
                  <div key={i} style={{
                    position: 'absolute', top: `${i * hourH}px`,
                    width: '100%', borderTop: '1px solid var(--border)',
                    pointerEvents: 'none',
                  }} />
                ))}
                {/* 30-min sub-lines */}
                {hours.map((_, i) => (
                  <div key={`h${i}`} style={{
                    position: 'absolute', top: `${i * hourH + hourH / 2}px`,
                    width: '100%', borderTop: '1px dashed rgba(255,255,255,0.04)',
                    pointerEvents: 'none',
                  }} />
                ))}
                {dayGroups.map(g => renderBlock(g, day, geometry))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
