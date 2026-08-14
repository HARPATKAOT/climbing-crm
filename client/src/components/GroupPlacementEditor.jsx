import React, { useMemo, useState } from 'react';
import { Check, Clock3, Search, ShieldCheck, Users, X } from 'lucide-react';
import { DAYS_FULL } from '../mockData.js';
import { getGroupDays } from '../scheduleUtils.js';

const MODES = [
  { key: 'fixed', label: 'שיבוץ קבוע', hint: 'תופס מקום ללא תפוגה', icon: ShieldCheck, color: '#34D399' },
  { key: 'hold', label: 'שמירת מקום', hint: 'תופס מקום ל־3 ימים', icon: Clock3, color: '#FBBF24' },
  { key: 'waitlist', label: 'רשימת המתנה', hint: 'לא תופסת מקום בקבוצה', icon: Users, color: '#60A5FA' },
  { key: 'none', label: 'ללא קבוצה', hint: 'מסיר שיבוץ והמתנה', icon: X, color: '#94A3B8' },
];

function scheduleLabel(group) {
  const days = getGroupDays(group).map((day) => DAYS_FULL[day]).filter(Boolean).join(' ו־');
  return [days, group.time].filter(Boolean).join(' · ');
}

function capacityLabel(group) {
  const max = Number(group.maxSlots);
  if (!Number.isFinite(max) || max <= 0) return 'מכסה לא הוגדרה';
  return `${Number(group.enrolled || 0)}/${max} מקומות תפוסים`;
}

export default function GroupPlacementEditor({
  groups = [],
  mode,
  selectedIds = [],
  onModeChange,
  onSelectedIdsChange,
  onSave,
  onCancel,
  saving = false,
  error = '',
}) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds.map(String)), [selectedIds]);
  const visibleGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...groups]
      .filter((group) => !term || `${group.name || ''} ${scheduleLabel(group)}`.toLowerCase().includes(term))
      .sort((a, b) => scheduleLabel(a).localeCompare(scheduleLabel(b), 'he'));
  }, [groups, query]);
  const needsGroups = mode !== 'none';

  const chooseMode = (nextMode) => {
    onModeChange(nextMode);
    if (nextMode === 'none') onSelectedIdsChange([]);
  };
  const toggle = (groupId) => {
    const id = String(groupId);
    onSelectedIdsChange(selected.has(id)
      ? selectedIds.filter((value) => String(value) !== id)
      : [...selectedIds, id]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
        {MODES.map((item) => {
          const Icon = item.icon;
          const active = mode === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => chooseMode(item.key)}
              disabled={saving}
              style={{
                padding: '10px 11px', borderRadius: 10, textAlign: 'right', cursor: 'pointer',
                border: `1px solid ${active ? item.color : 'var(--border)'}`,
                background: active ? `${item.color}18` : 'var(--surface-2)', color: 'var(--text-1)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 12.5 }}>
                <Icon size={14} color={item.color} /> {item.label}
              </span>
              <span style={{ display: 'block', marginTop: 3, color: 'var(--text-3)', fontSize: 10.5 }}>{item.hint}</span>
            </button>
          );
        })}
      </div>

      {needsGroups && (
        <>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', right: 10, top: 10, color: 'var(--text-3)' }} />
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="חיפוש קבוצה..."
              style={{ paddingRight: 32 }}
            />
          </div>
          <div style={{ maxHeight: 310, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visibleGroups.map((group) => {
              const checked = selected.has(String(group.id));
              const full = Number(group.maxSlots) > 0 && Number(group.enrolled || 0) >= Number(group.maxSlots);
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => toggle(group.id)}
                  disabled={saving}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 9,
                    border: `1px solid ${checked ? 'var(--primary)' : 'var(--border)'}`,
                    background: checked ? 'rgba(96,165,250,0.09)' : 'transparent',
                    color: 'var(--text-1)', textAlign: 'right', cursor: 'pointer',
                  }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: 'grid', placeItems: 'center',
                    border: `1px solid ${checked ? 'var(--primary)' : 'var(--border)'}`,
                    background: checked ? 'var(--primary)' : 'transparent', color: '#fff',
                  }}>
                    {checked && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: 800, fontSize: 12.5 }}>{group.name}</span>
                    <span style={{ display: 'block', color: 'var(--text-3)', fontSize: 10.5, marginTop: 2 }}>
                      {scheduleLabel(group)} · {capacityLabel(group)}
                    </span>
                  </span>
                  {full && mode !== 'waitlist' && <span className="badge badge-red">מלאה</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>ביטול</button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onSave}
          disabled={saving || (needsGroups && !selectedIds.length)}
        >
          <Check size={13} /> {saving ? 'שומר...' : 'שמור שיבוץ'}
        </button>
      </div>
    </div>
  );
}

