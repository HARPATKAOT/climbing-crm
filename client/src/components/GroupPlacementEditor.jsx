import React from 'react';
import { Check, Clock3, ShieldCheck, Users } from 'lucide-react';
import GroupPickerCards from './GroupPickerCards.jsx';

const MODE_ORDER = ['none', 'waitlist', 'hold', 'fixed'];
const LEGEND = [
  { key: 'waitlist', label: 'רשימת המתנה', icon: Users, color: '#60A5FA' },
  { key: 'hold', label: 'מקום שמור', icon: Clock3, color: '#FBBF24' },
  { key: 'fixed', label: 'רשום', icon: ShieldCheck, color: '#34D399' },
];

function cycleMode(current, direction) {
  const index = Math.max(0, MODE_ORDER.indexOf(current || 'none'));
  return MODE_ORDER[(index + direction + MODE_ORDER.length) % MODE_ORDER.length];
}

export default function GroupPlacementEditor({
  groups = [], placements = {}, onPlacementsChange, onSave, onCancel, saving = false, error = '',
}) {
  const change = (groupId, direction) => {
    const id = String(groupId);
    const mode = cycleMode(placements[id], direction);
    const next = { ...placements };
    if (!mode || mode === 'none') delete next[id];
    else next[id] = mode;
    onPlacementsChange(next);
  };
  const selectedIds = Object.keys(placements).filter((id) => placements[id] && placements[id] !== 'none');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
        לחצו על קבוצה כדי לעבור בין המתנה, מקום שמור ורשום. לחיצה רביעית מבטלת.
      </div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {LEGEND.map(({ key, label, icon: Icon, color }) => (
          <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color }}>
            <Icon size={12} /> {label}
          </span>
        ))}
      </div>
      <div className="card" style={{ padding: 8, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <GroupPickerCards
          groups={groups}
          selectedIds={selectedIds}
          modeByGroupId={placements}
          onToggle={(groupId) => change(groupId, 1)}
          onReverseToggle={(groupId) => change(groupId, -1)}
          disabled={saving}
          minColWidth={0}
          fitHeight={390}
          fitWidth
        />
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>ביטול</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
          <Check size={13} /> {saving ? 'שומר...' : 'שמור שיבוצים'}
        </button>
      </div>
    </div>
  );
}
