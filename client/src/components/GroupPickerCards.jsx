import React, { useEffect, useMemo, useState } from 'react';
import { Check, CalendarDays, X } from 'lucide-react';
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
// the hours that actually hold a class, and the minute is worth less — how much
// less depends on how much room the caller has.
const GUTTER_W = 34;
// The closing hour's label hangs below the last grid line; the board reserves
// its height so the window never grows a scrollbar just for that.
const HOUR_LABEL_H = 16;

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
  pxPerMin,
  minColWidth = 78,
  // When given, the day columns are stretched (or squeezed) to exactly this
  // many pixels, so the whole week lands inside a window without scrolling.
  fitHeight = null,
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

  const span = board.endMin - board.startMin;
  // A block still has to be tall enough to read, and never taller than the
  // real board's own scale.
  const scale = fitHeight
    ? Math.min(1.6, Math.max(0.7, (fitHeight - HOUR_LABEL_H) / span))
    : (pxPerMin || 0.75);
  const gridH = span * scale;
  const hourH = 60 * scale;

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: maxHeight || 'none', opacity: disabled ? 0.6 : 1 }}>
      <div style={{ minWidth: GUTTER_W + board.days.length * minColWidth, paddingBottom: HOUR_LABEL_H }}>
        {/* Day headers */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <div style={{ width: GUTTER_W, flexShrink: 0 }} />
          {board.days.map(([day], pos) => (
            <div key={day} style={{
              flex: 1, padding: '4px 2px', fontSize: scale >= 1 ? 12 : 10, fontWeight: 600,
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
                padding: '1px 3px', fontSize: scale >= 1 ? 10 : 8.5, color: 'var(--text-3)',
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
              {/* 30-min sub-lines, as on the full board. The last hour gets
                  none — a line past the end of the grid would push the whole
                  board into a scrollbar it does not need. */}
              {board.hours.slice(0, -1).map((h, i) => (
                <div key={`h${h}`} style={{
                  position: 'absolute', top: i * hourH + hourH / 2, width: '100%',
                  borderTop: '1px dashed rgba(255,255,255,0.04)', pointerEvents: 'none',
                }} />
              ))}
              {dayGroups.map((g) => (
                <MiniBlock
                  key={`${g.id}-${day}`}
                  group={g}
                  top={(t2m(g.time) - board.startMin) * scale}
                  height={(Number(g.duration) || 60) * scale}
                  scale={scale}
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
function MiniBlock({ group, top, height, checked, disabled, onToggle, scale = 0.75 }) {
  const c = groupColor(group);
  const label = shortGroupLabel(group.name) || group.name;
  // A roomier board carries a roomier caption; the tiny one stays at 9px.
  const fontSize = scale >= 1 ? 11 : 9;

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
        <Check size={fontSize} strokeWidth={3.5} color={c.text} style={{ flexShrink: 0, marginTop: 1 }} />
      )}
      <span style={{
        minWidth: 0, fontSize, fontWeight: 700, color: c.text, lineHeight: 1.2,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: height >= 45 ? 3 : 2, WebkitBoxOrient: 'vertical',
      }}>
        {label}
      </span>
    </label>
  );
}

/**
 * The form-side control: what is picked, spelled out, and a button that opens
 * the board full size. Squeezing the board into a form cell meant scrolling it
 * both ways to find a class — a window of its own means the whole week is on
 * screen at once.
 */
export function GroupPickerField({
  groups = [],
  selectedIds = [],
  onToggle,
  disabled = false,
  initiallyOpen = false,
  modalOnly = false,
  onSave,
  onCancel,
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const chosen = groups.filter((g) => selectedIds.map(String).includes(String(g.id)));
  const closePicker = () => {
    setOpen(false);
    onCancel?.();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {!modalOnly && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
        {chosen.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>לא משויך לחוג</span>
        ) : chosen.map((g) => {
          const c = groupColor(g);
          return (
            <span key={g.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: c.bg, border: `1px solid ${c.border}`, borderRadius: 5,
              padding: '2px 7px', fontSize: 11.5, fontWeight: 700, color: c.text,
            }}>
              {shortGroupLabel(g.name) || g.name}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onToggle(String(g.id))}
                  title="הסרה מהחוג"
                  style={{
                    display: 'flex', padding: 0, background: 'none', border: 'none',
                    color: c.text, opacity: 0.7, cursor: 'pointer',
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          );
        })}
      </div>}
      {!modalOnly && <div>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <CalendarDays size={12} /> בחירה מלוח החוגים
        </button>
      </div>}

      {open && (
        <GroupPickerModal
          groups={groups}
          selectedIds={selectedIds}
          onToggle={onToggle}
          onClose={closePicker}
          onSave={onSave}
          saving={disabled}
        />
      )}
    </div>
  );
}

// Header, hint, day strip, footer and the modal's own padding. What is left of
// the window after these is what the board gets.
const MODAL_CHROME_PX = 275;

/** The board at full size, in a window big enough that nothing scrolls. */
function GroupPickerModal({ groups, selectedIds, onToggle, onClose, onSave, saving = false }) {
  const count = selectedIds.length;

  // The board is drawn to fit the window it opened in, so a laptop screen and a
  // desk monitor both show the whole week without a scrollbar.
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const fitHeight = Math.max(300, Math.round(viewportH * 0.9) - MODAL_CHROME_PX);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 1040 }}>
        <div className="modal-header">
          <span className="modal-title">בחירת חוגים</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
            לחיצה על חוג בלוח מסמנת או מבטלת את השיוך.
          </div>
          <GroupPickerCards
            groups={groups}
            selectedIds={selectedIds}
            onToggle={onToggle}
            fitHeight={fitHeight}
            minColWidth={120}
            maxHeight={null}
          />
        </div>
        <div className="modal-footer">
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
            {count > 0 ? `${count} חוגים נבחרו` : 'לא נבחר חוג'}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving}
            onClick={onSave || onClose}
          >
            <Check size={13} /> {saving ? 'שומר...' : onSave ? 'שמור' : 'סיום'}
          </button>
        </div>
      </div>
    </div>
  );
}
