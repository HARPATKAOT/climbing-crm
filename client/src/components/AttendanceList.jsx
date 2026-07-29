import React, { useMemo, useState } from 'react';
import {
  Check, X, Hourglass, Lock, RefreshCw, PartyPopper, Ban, Flame, Pencil,
} from 'lucide-react';
import {
  ATT_STATUS,
  ATT_MARK_KEYS,
  HEB_WEEKDAY_LETTERS,
  attStatusMeta,
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

/**
 * `full` spells the status out and never truncates — the list has room for it.
 * The short variant is the compact badge the schedule board uses in its grid.
 */
function StatusPill({ meta, title, full = false }) {
  const Icon = ICON_MAP[meta.icon] || Hourglass;
  return (
    <span
      title={title || meta.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        maxWidth: full ? 'none' : '100%',
        padding: '3px 8px',
        borderRadius: 999,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        color: meta.color,
        fontSize: full ? 11 : 10,
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        overflow: full ? 'visible' : 'hidden',
        textOverflow: full ? 'clip' : 'ellipsis',
      }}
    >
      <Icon size={11} strokeWidth={2.5} style={{ flexShrink: 0 }} />
      <span style={full ? undefined : { overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {full ? meta.label : (meta.shortLabel || meta.label)}
      </span>
    </span>
  );
}

/** Noon avoids the date sliding a day back/forward across time zones. */
function dateAtNoon(dateStr) {
  return new Date(`${dateStr}T12:00:00`);
}

function formatDate(dateStr) {
  const d = dateAtNoon(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function weekdayLabel(dateStr) {
  const d = dateAtNoon(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const letter = HEB_WEEKDAY_LETTERS[d.getDay()];
  return letter ? `יום ${letter}׳` : '';
}

function monthLabel(dateStr) {
  const d = dateAtNoon(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}

/** Trainers mark the regular statuses; an intro session keeps its own pair. */
function markOptionsFor(status) {
  const key = normalizeAttStatus(status);
  if (key === 'intro_attended' || key === 'intro_absent') {
    return ATT_STATUS.filter((o) =>
      ['intro_attended', 'intro_absent', 'attended', 'absent'].includes(o.key)
    );
  }
  return ATT_STATUS.filter((o) => ATT_MARK_KEYS.includes(o.key));
}

/**
 * Attendance history of a climber as a plain list: date, weekday, status,
 * and inline editing of the status. Newest meeting first.
 */
export default function AttendanceList({ rows = [], onStatusSaved }) {
  const [editingId, setEditingId] = useState('');
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');

  // Newest meeting first, with a month caption on the first row of each month.
  const sorted = useMemo(() => {
    let lastMonth = '';
    return (rows || [])
      .filter((r) => r?.date)
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((row) => {
        const month = monthLabel(row.date);
        const monthHeader = month === lastMonth ? '' : month;
        lastMonth = month;
        return { row, monthHeader };
      });
  }, [rows]);

  const saveStatus = async (row, status) => {
    setSavingId(row.id);
    setError('');
    try {
      const res = await fetch('/api/attendance/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: [{
            id: row.id,
            student_id: row.student_id,
            group_id: row.group_id,
            date: row.date,
            status,
          }],
        }),
      });
      if (!res.ok) throw new Error('שמירת הנוכחות נכשלה');
      const saved = await res.json().catch(() => null);
      const savedRow = Array.isArray(saved) ? saved[0] : saved;
      onStatusSaved?.(row.id, status, savedRow);
      setEditingId('');
    } catch (err) {
      setError(err.message || 'שמירת הנוכחות נכשלה');
    } finally {
      setSavingId('');
    }
  };

  if (sorted.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין רשומות נוכחות עדיין</div>;
  }

  return (
    <div>
      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 10, fontSize: 12 }}>{error}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sorted.map(({ row, monthHeader }) => {
          const meta = attStatusMeta(row.status);
          const isEditing = editingId === row.id;

          return (
            <React.Fragment key={row.id || row.date}>
              {monthHeader && (
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-3)',
                  padding: '10px 2px 4px',
                }}>
                  {monthHeader}
                </div>
              )}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 2px',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                  {formatDate(row.date)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                  {weekdayLabel(row.date)}
                </div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
                  <StatusPill meta={meta} full />
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => setEditingId(isEditing ? '' : row.id)}
                  title="עריכת סטטוס"
                >
                  <Pencil size={13} /> {isEditing ? 'סגירה' : 'עריכה'}
                </button>
              </div>

              {isEditing && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  padding: '8px 2px 10px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  {markOptionsFor(row.status).map((option) => {
                    const active = normalizeAttStatus(row.status) === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={`btn btn-xs ${active ? 'btn-primary' : 'btn-ghost'}`}
                        disabled={savingId === row.id}
                        onClick={() => saveStatus(row, option.key)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                  {savingId === row.id && (
                    <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>שומר...</span>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export { StatusPill };
