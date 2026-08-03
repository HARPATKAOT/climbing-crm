import React, { useMemo } from 'react';
import { Check, Clock } from 'lucide-react';
import { DAYS_FULL } from '../mockData.js';
import {
  getGroupDays,
  groupColor,
  shortGroupLabel,
  HEB_WEEKDAY_LETTERS,
} from '../scheduleUtils.js';

/**
 * Picking a group used to be a column of checkboxes with the raw group name
 * next to each. Nobody reads a class off a name — they know it by where its
 * block sits on the weekly board and by its colour. So this draws the same
 * blocks, in the same palette, shrunk to fit a form: one day section per
 * column of the board, and the twice-a-week groups appear under both their
 * days exactly as they do there.
 */
export default function GroupPickerCards({
  groups = [],
  selectedIds = [],
  onToggle,
  disabled = false,
  maxHeight = 260,
}) {
  const selected = useMemo(
    () => new Set(selectedIds.map((id) => String(id))),
    [selectedIds],
  );

  // One entry per day a group meets, ordered the way the board reads: day
  // columns left to right, and inside a day by starting time.
  const byDay = useMemo(() => {
    const days = new Map();
    for (const g of groups) {
      for (const day of getGroupDays(g)) {
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(g);
      }
    }
    for (const list of days.values()) {
      list.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    }
    return [...days.entries()].sort((a, b) => a[0] - b[0]);
  }, [groups]);

  if (!groups.length) {
    return <div style={{ fontSize: 12, color: 'var(--text-2)' }}>אין חוגים להצגה</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight, overflowY: 'auto', paddingLeft: 2 }}>
      {byDay.map(([day, dayGroups]) => (
        <div key={day}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-2)', letterSpacing: 0.3,
            marginBottom: 4, paddingBottom: 3, borderBottom: '1px solid var(--border)',
          }}>
            יום {DAYS_FULL[day] || HEB_WEEKDAY_LETTERS[day] || ''}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
            gap: 6,
          }}>
            {dayGroups.map((g) => (
              <GroupMiniCard
                key={`${g.id}-${day}`}
                group={g}
                checked={selected.has(String(g.id))}
                disabled={disabled}
                onToggle={() => onToggle(String(g.id))}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One board block at form scale. Same fill, same border, same title colour. */
function GroupMiniCard({ group, checked, disabled, onToggle }) {
  const c = groupColor(group);
  const label = shortGroupLabel(group.name) || group.name;

  return (
    <label
      title={group.name}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        background: c.bg,
        border: `1.5px solid ${checked ? c.text : c.border}`,
        borderRadius: 7,
        padding: '5px 7px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        boxShadow: checked ? `0 0 0 2px ${c.text}44` : 'none',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        // Off-screen rather than removed, so the card stays keyboard- and
        // screen-reader-reachable while the card itself is the visible control.
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }}
      />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, color: c.text,
          lineHeight: 1.25, overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>
          {label}
        </span>
        <span style={{
          flexShrink: 0, width: 14, height: 14, borderRadius: 4,
          border: `1.5px solid ${checked ? c.text : 'rgba(255,255,255,0.25)'}`,
          background: checked ? c.text : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {checked && <Check size={10} strokeWidth={3.5} color="#0F172A" />}
        </span>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 9.5, color: 'rgba(255,255,255,0.45)',
      }}>
        <Clock size={9} style={{ flexShrink: 0, opacity: 0.7 }} />
        <span>{group.time}{group.duration ? ` · ${group.duration}′` : ''}</span>
      </div>
    </label>
  );
}
