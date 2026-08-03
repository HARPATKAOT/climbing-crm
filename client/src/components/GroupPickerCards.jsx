import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { DAYS_FULL } from '../mockData.js';
import { getGroupDays, groupColor, shortGroupLabel } from '../scheduleUtils.js';

/**
 * Picking a group used to be a column of checkboxes with the raw group name
 * next to each. Nobody reads a class off a name — they know it by where its
 * block sits on the weekly board and by its colour. So this is the board
 * itself, shrunk to fit a form: the same day columns, the same hour lines, the
 * same palette, and a click on a block is the tick.
 */

// The big board runs 14:00–22:00 at 1.5px a minute. Here the window is cut to
// the hours that actually hold a class, and the minute is worth half as much.
const PX_PER_MIN = 0.75;
const MIN_COL_W = 78;
const GUTTER_W = 30;

function t2m(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

export default function GroupPickerCards({
  groups = [],
  selectedIds = [],
  onToggle,
  disabled = false,
  maxHeight = 420,
}) {
  const selected = useMemo(
    () => new Set(selectedIds.map((id) => String(id))),
    [selectedIds],
  );

  const board = useMemo(() => {
    const days = new Map();
    let first = null;
    let last = null;
    for (const g of groups) {
      const start = t2m(g.time);
      if (start == null) continue;
      const end = start + (Number(g.duration) || 60);
      first = first == null ? start : Math.min(first, start);
      last = last == null ? end : Math.max(last, end);
      for (const day of getGroupDays(g)) {
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(g);
      }
    }
    if (first == null) return null;
    // Whole hours, so the labels down the side land on round numbers.
    const startMin = Math.floor(first / 60) * 60;
    const endMin = Math.ceil(last / 60) * 60;
    return {
      startMin,
      endMin,
      hours: Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => startMin / 60 + i),
      days: [...days.entries()].sort((a, b) => a[0] - b[0]),
    };
  }, [groups]);

  if (!board) {
    return <div style={{ fontSize: 12, color: 'var(--text-2)' }}>אין חוגים להצגה</div>;
  }

  const gridH = (board.endMin - board.startMin) * PX_PER_MIN;
  const hourH = 60 * PX_PER_MIN;

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight, opacity: disabled ? 0.6 : 1 }}>
      <div style={{ minWidth: GUTTER_W + board.days.length * MIN_COL_W }}>
        {/* Day headers */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: GUTTER_W, flexShrink: 0 }} />
          {board.days.map(([day], pos) => (
            <div key={day} style={{
              flex: 1, padding: '4px 2px', fontSize: 10, fontWeight: 600,
              color: 'var(--text-2)', textAlign: 'center',
              borderLeft: pos > 0 ? '1px solid var(--border)' : 'none',
            }}>
              {DAYS_FULL[day] || ''}
            </div>
          ))}
        </div>

        {/* Grid body */}
        <div style={{ display: 'flex', position: 'relative' }}>
          <div style={{ width: GUTTER_W, flexShrink: 0, position: 'relative', height: gridH }}>
            {board.hours.map((h, i) => (
              <div key={h} style={{
                position: 'absolute', top: i * hourH, width: '100%',
                padding: '1px 3px', fontSize: 8.5, color: 'var(--text-3)',
              }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {board.days.map(([day, dayGroups]) => (
            <div key={day} style={{
              flex: 1, position: 'relative', height: gridH,
              borderLeft: '1px solid var(--border)',
            }}>
              {board.hours.map((h, i) => (
                <div key={h} style={{
                  position: 'absolute', top: i * hourH, width: '100%',
                  borderTop: '1px solid var(--border)', pointerEvents: 'none',
                }} />
              ))}
              {/* 30-min sub-lines, as on the full board */}
              {board.hours.map((h, i) => (
                <div key={`h${h}`} style={{
                  position: 'absolute', top: i * hourH + hourH / 2, width: '100%',
                  borderTop: '1px dashed rgba(255,255,255,0.04)', pointerEvents: 'none',
                }} />
              ))}
              {dayGroups.map((g) => (
                <MiniBlock
                  key={`${g.id}-${day}`}
                  group={g}
                  top={(t2m(g.time) - board.startMin) * PX_PER_MIN}
                  height={(Number(g.duration) || 60) * PX_PER_MIN}
                  checked={selected.has(String(g.id))}
                  disabled={disabled}
                  onToggle={() => onToggle(String(g.id))}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One board block at picker scale — same fill, border and title colour. */
function MiniBlock({ group, top, height, checked, disabled, onToggle }) {
  const c = groupColor(group);
  const label = shortGroupLabel(group.name) || group.name;

  return (
    <label
      title={`${label}${group.time ? ` · ${group.time}` : ''}`}
      style={{
        position: 'absolute',
        top, height,
        left: 2, right: 2,
        background: c.bg,
        border: `1.5px solid ${checked ? c.text : c.border}`,
        borderRadius: 5,
        padding: '2px 4px',
        cursor: disabled ? 'default' : 'pointer',
        overflow: 'hidden',
        boxShadow: checked ? `0 0 0 2px ${c.text}44` : '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        zIndex: checked ? 3 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        // Off-screen rather than removed, so the block stays keyboard- and
        // screen-reader-reachable while the block itself is the visible control.
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }}
      />
      {checked && (
        <Check size={9} strokeWidth={3.5} color={c.text} style={{ flexShrink: 0, marginTop: 1 }} />
      )}
      <span style={{
        minWidth: 0, fontSize: 9, fontWeight: 700, color: c.text, lineHeight: 1.2,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: height >= 45 ? 3 : 2, WebkitBoxOrient: 'vertical',
      }}>
        {label}
      </span>
    </label>
  );
}
