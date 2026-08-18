/**
 * הרשת החודשית — שבע עמודות ושישה שבועות, בלי המסך שסביבה.
 *
 * טופס השיבוץ מציג לעובד את מה שהמנהל בחר מהיומן, וזה צריך להיראות כמו היומן:
 * אותה רשת, אותו עיגול על היום, אותם צבעי סוגים. כאן יושבת רק הרשת — בלי גרירה,
 * בלי יצירת אירוע ובלי שכבות ההרשאה של מסך היומן, שהן מה שהופך אותו לענק.
 *
 * `renderEvent(activity, cell)` הוא מה שמצויר בתוך היום, כדי שאותה רשת תשרת גם
 * תצוגה וגם בחירה.
 */
import React, { useMemo } from 'react';

export const HEB_DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

export function toDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(d, n) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/** השבוע מתחיל ביום ראשון, כמו בכל לוח בקיר. */
export function startOfWeek(d) {
  const start = new Date(d);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

/** 42 התאים של החודש — שישה שבועות מלאים, כולל הגלישה משני הצדדים. */
export function monthCellsOf(cursor, today = new Date()) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const start = startOfWeek(new Date(year, month, 1));
  const todayStr = toDateStr(today);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    const dateStr = toDateStr(date);
    return {
      date,
      dateStr,
      inMonth: date.getMonth() === month,
      isToday: dateStr === todayStr,
      isPast: dateStr < todayStr,
    };
  });
}

export const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

export function monthLabelOf(cursor) {
  return `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
}

export default function MonthGrid({ cursor, byDate = new Map(), renderEvent, today = new Date() }) {
  const cells = useMemo(() => monthCellsOf(cursor, today), [cursor, today]);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      width: '100%',
      maxWidth: '100%',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        {HEB_DAYS.map((d) => (
          <div key={d} style={{
            padding: '10px 6px', textAlign: 'center', fontSize: 12,
            fontWeight: 700, color: 'var(--text-3)', minWidth: 0, overflow: 'hidden',
          }}>
            {d}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', width: '100%' }}>
        {cells.map((cell) => {
          const list = byDate.get(cell.dateStr) || [];
          return (
            <div
              key={cell.dateStr}
              style={{
                minHeight: 86,
                minWidth: 0,
                padding: 6,
                borderTop: '1px solid var(--border)',
                borderInlineStart: '1px solid var(--border)',
                background: cell.isToday
                  ? 'rgba(56,189,248,0.12)'
                  : (cell.isPast ? 'rgba(0,0,0,0.15)' : 'transparent'),
                opacity: cell.inMonth ? (cell.isPast ? 0.55 : 1) : 0.35,
                outline: cell.isToday ? '2px solid rgba(56,189,248,0.75)' : 'none',
                outlineOffset: -1,
                position: 'relative',
                overflow: 'hidden',
                zIndex: cell.isToday ? 1 : 0,
              }}
            >
              <div style={{
                width: cell.isToday ? 26 : 24,
                height: cell.isToday ? 26 : 24,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 4,
                marginInlineStart: 'auto',
                fontSize: cell.isToday ? 12.5 : 11.5,
                fontWeight: cell.isToday ? 800 : 700,
                background: cell.isToday
                  ? 'linear-gradient(135deg, #38BDF8 0%, #0EA5E9 100%)'
                  : 'transparent',
                color: cell.isToday ? '#0B1220' : 'var(--text-2)',
                border: cell.isToday ? '1px solid rgba(125,211,252,0.9)' : '1px solid transparent',
              }}>
                {cell.date.getDate()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {list.map((item) => renderEvent(item, cell))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
