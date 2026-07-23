import React, { useMemo, useState } from 'react';
import {
  Check, X, Hourglass, Lock, RefreshCw, PartyPopper, Ban, Flame, ChevronRight, ChevronLeft,
} from 'lucide-react';
import {
  ATT_STATUS,
  HEB_WEEKDAY_LETTERS,
  attStatusMeta,
  localDateStr,
  normalizeAttStatus,
} from '../scheduleUtils.js';

const ICON_MAP = {
  check: Check,
  x: X,
  hourglass: Hourglass,
  lock: Lock,
  refresh: RefreshCw,
  party: PartyPopper,
  ban: Ban,
  candle: Flame,
};

function StatusPill({ meta, title }) {
  const Icon = ICON_MAP[meta.icon] || Hourglass;
  return (
    <span
      title={title || meta.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        maxWidth: '100%',
        padding: '3px 8px',
        borderRadius: 999,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        color: meta.color,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <Icon size={11} strokeWidth={2.5} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {meta.shortLabel || meta.label}
      </span>
    </span>
  );
}

function DayCell({ day, month, statusMeta, groupName, empty }) {
  if (empty) {
    return <div style={{ minHeight: 64 }} />;
  }

  return (
    <div
      title={groupName ? `${statusMeta?.label || ''} · ${groupName}` : statusMeta?.label}
      style={{
        minHeight: 72,
        padding: '8px 4px 6px',
        borderRadius: 12,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <div style={{
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-2)',
        letterSpacing: 0.2,
      }}>
        {day}/{month}
      </div>
      {statusMeta && <StatusPill meta={statusMeta} />}
    </div>
  );
}

function parseYearMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m };
}

function toYearMonth(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function shiftMonth(ym, delta) {
  const { year, month } = parseYearMonth(ym);
  const d = new Date(year, month - 1 + delta, 1);
  return toYearMonth(d.getFullYear(), d.getMonth() + 1);
}

function monthLabelHe(ym) {
  const { year, month } = parseYearMonth(ym);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

/**
 * Month calendar of a climber's attendance, styled like Notion board cards.
 * Only training days with records (or future training placeholders) get badges.
 */
export default function AttendanceCalendar({ rows = [], groups = [], group = null }) {
  const today = localDateStr();

  const byDate = useMemo(() => {
    const map = new Map();
    for (const row of rows || []) {
      if (!row?.date) continue;
      const prev = map.get(row.date);
      // Prefer a marked status over pending when duplicates exist
      if (!prev || (normalizeAttStatus(prev.status) === 'pending' && normalizeAttStatus(row.status) !== 'pending')) {
        map.set(row.date, row);
      }
    }
    return map;
  }, [rows]);

  const availableMonths = useMemo(() => {
    const set = new Set();
    for (const date of byDate.keys()) {
      if (/^\d{4}-\d{2}/.test(date)) set.add(date.slice(0, 7));
    }
    if (set.size === 0) set.add(today.slice(0, 7));
    return [...set].sort();
  }, [byDate, today]);

  const [monthKey, setMonthKey] = useState(() => {
    const cur = today.slice(0, 7);
    if (availableMonths.includes(cur)) return cur;
    return availableMonths[availableMonths.length - 1];
  });

  const { year, month } = parseYearMonth(monthKey);
  const daysInMonth = new Date(year, month, 0).getDate();
  // Sunday-first grid (matches Hebrew א…ש headers)
  const firstWeekday = new Date(year, month - 1, 1).getDay();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ key: `pad-${i}`, empty: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const row = byDate.get(dateStr);
    let statusMeta = null;
    let groupName = '';
    if (row) {
      statusMeta = attStatusMeta(row.status);
      groupName =
        groups.find((g) => g.id === row.group_id)?.name
        || (group?.id === row.group_id ? group.name : null)
        || '';
    }
    cells.push({
      key: dateStr,
      day,
      month,
      statusMeta,
      groupName,
      empty: false,
      hasRow: !!row,
    });
  }

  // Hide trailing empty weekdays? Keep full weeks for alignment.
  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, empty: true });
  }

  // Compact mode: only show weeks that contain at least one attendance row
  // (plus current week of the month if viewing current month). Falls back to
  // full month if there are no rows this month.
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  const monthHasRows = weeks.some((w) => w.some((c) => c.hasRow));
  const visibleWeeks = monthHasRows
    ? weeks.filter((w) => w.some((c) => c.hasRow || (!c.empty && c.key === today)))
    : weeks;

  return (
    <div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        gap: 8,
      }}>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={() => setMonthKey((m) => shiftMonth(m, -1))}
          aria-label="חודש קודם"
        >
          <ChevronRight size={16} />
        </button>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', textTransform: 'capitalize' }}>
          {monthLabelHe(monthKey)}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon btn-sm"
          onClick={() => setMonthKey((m) => shiftMonth(m, 1))}
          aria-label="חודש הבא"
        >
          <ChevronLeft size={16} />
        </button>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: 6,
        marginBottom: 6,
      }}>
        {HEB_WEEKDAY_LETTERS.map((letter) => (
          <div
            key={letter}
            style={{
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-3)',
              paddingBottom: 2,
            }}
          >
            {letter}&apos;
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleWeeks.map((week, wi) => (
          <div
            key={`week-${wi}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 6,
            }}
          >
            {week.map((cell) => (
              cell.empty ? (
                <div key={cell.key} style={{ minHeight: 64 }} />
              ) : cell.hasRow ? (
                <DayCell
                  key={cell.key}
                  day={cell.day}
                  month={cell.month}
                  statusMeta={cell.statusMeta}
                  groupName={cell.groupName}
                />
              ) : (
                <div key={cell.key} style={{ minHeight: 64 }} />
              )
            ))}
          </div>
        ))}
      </div>

      {!monthHasRows && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginTop: 12 }}>
          אין רשומות נוכחות בחודש זה
        </div>
      )}

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 14,
        justifyContent: 'center',
      }}>
        {ATT_STATUS.filter((s) =>
          ['pending', 'attended', 'absent', 'makeup', 'holiday'].includes(s.key)
        ).map((meta) => (
          <StatusPill key={meta.key} meta={meta} title={meta.label} />
        ))}
      </div>
    </div>
  );
}

export { StatusPill };
