import React, { useEffect, useMemo, useState } from 'react';
import { Users, Save } from 'lucide-react';
import { STATUSES } from '../mockData.js';
import { getGroupDays } from '../scheduleUtils.js';
import { EMPTY_FILTERS } from './segmentFilters.js';

const DAY_OPTIONS = [
  { value: 0, label: 'א׳' },
  { value: 1, label: 'ב׳' },
  { value: 2, label: 'ג׳' },
  { value: 3, label: 'ד׳' },
  { value: 4, label: 'ה׳' },
  { value: 5, label: 'ו׳' },
  { value: 6, label: 'ש׳' },
];

export default function SegmentBuilder({
  parents = [],
  students = [],
  groups = [],
  lists = [],
  filters,
  onChange,
}) {
  const [preview, setPreview] = useState({ count: 0, recipients: [] });
  const [interestOptions, setInterestOptions] = useState([]);
  const [savedSegments, setSavedSegments] = useState([]);
  const [segmentName, setSegmentName] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  const f = filters || EMPTY_FILTERS;

  const cities = useMemo(() => {
    const set = new Set((parents || []).map((p) => p.city).filter(Boolean));
    return [...set].sort((a, b) => a.localeCompare(b, 'he'));
  }, [parents]);

  const groupsByDay = useMemo(() => {
    const buckets = new Map();
    for (const g of groups || []) {
      const days = getGroupDays(g);
      const targetDays = days.length ? days : [99];
      for (const day of targetDays) {
        if (!buckets.has(day)) buckets.set(day, []);
        buckets.get(day).push(g);
      }
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, list]) => ({
        day,
        label: DAY_OPTIONS.find((d) => d.value === day)?.label || 'אחר',
        groups: [...list].sort((a, b) => {
          const aTime = String(a.time || '99:99');
          const bTime = String(b.time || '99:99');
          if (aTime !== bTime) return aTime.localeCompare(bTime);
          return String(a.name || '').localeCompare(String(b.name || ''), 'he');
        }),
      }));
  }, [groups]);

  useEffect(() => {
    fetch('/api/broadcast/interest-options')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setInterestOptions(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch('/api/saved-segments')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setSavedSegments(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        const res = await fetch('/api/broadcast/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: f }),
        });
        const data = await res.json();
        if (!cancelled && res.ok) setPreview(data);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [JSON.stringify(f)]);

  const set = (patch) => onChange({ ...f, ...patch });

  const toggleInArray = (key, value) => {
    const arr = Array.isArray(f[key]) ? [...f[key]] : [];
    const idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(value);
    set({ [key]: arr });
  };

  const toggleDayGroups = (dayGroups) => {
    const dayIds = dayGroups.map((g) => g.id);
    const selected = Array.isArray(f.groupIds) ? f.groupIds : [];
    const allSelected = dayIds.every((id) => selected.includes(id));
    if (allSelected) {
      set({ groupIds: selected.filter((id) => !dayIds.includes(id)) });
    } else {
      set({ groupIds: [...new Set([...selected, ...dayIds])] });
    }
  };

  const saveCurrent = async () => {
    const name = segmentName.trim() || `קהל ${new Date().toLocaleDateString('he-IL')}`;
    const res = await fetch('/api/saved-segments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, filters: f }),
    });
    if (res.ok) {
      const created = await res.json();
      setSavedSegments((prev) => [...prev, created]);
      setSegmentName('');
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Users size={16} />
        <strong style={{ fontSize: 14 }}>
          {loadingPreview ? 'מחשב קהל...' : `${preview.count} נמענים`}
        </strong>
        {savedSegments.length > 0 && (
          <select
            className="input input-sm"
            style={{ maxWidth: 220 }}
            defaultValue=""
            onChange={(e) => {
              const seg = savedSegments.find((s) => s.id === e.target.value);
              if (seg?.filters) onChange({ ...EMPTY_FILTERS, ...seg.filters });
            }}
          >
            <option value="">טען קהל שמור...</option>
            {savedSegments.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 12 }}>
          גיל מ־
          <input className="input input-sm" type="number" value={f.ageMin} onChange={(e) => set({ ageMin: e.target.value })} />
        </label>
        <label style={{ fontSize: 12 }}>
          גיל עד
          <input className="input input-sm" type="number" value={f.ageMax} onChange={(e) => set({ ageMax: e.target.value })} />
        </label>
        <label style={{ fontSize: 12 }}>
          רשום לחוג
          <select className="input input-sm" value={f.registered} onChange={(e) => set({ registered: e.target.value })}>
            <option value="any">הכל</option>
            <option value="yes">רשומים</option>
            <option value="no">לא רשומים</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>
          רשימת תפוצה
          <select
            className="input input-sm"
            value={f.listKey || ''}
            onChange={(e) => set({ listKey: e.target.value || '' })}
            disabled={Array.isArray(f.groupIds) && f.groupIds.length > 0}
            title={Array.isArray(f.groupIds) && f.groupIds.length > 0 ? 'כשמסמנים קבוצה — הסינון לפי רשימת תפוצה מבוטל' : undefined}
          >
            <option value="">ללא סינון רשימה</option>
            {lists.map((l) => (
              <option key={l.key} value={l.key}>{l.label}</option>
            ))}
          </select>
          {Array.isArray(f.groupIds) && f.groupIds.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              בוטלה זמנית — מסננים לפי קבוצה
            </div>
          )}
        </label>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-2)' }}>מקום מגורים</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {cities.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>אין ערים במערכת עדיין</span>}
          {cities.map((c) => (
            <button
              key={c}
              type="button"
              className={`btn btn-xs ${(f.cities || []).includes(c) ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => toggleInArray('cities', c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-2)' }}>סטטוס</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(STATUSES).map(([key, val]) => (
            <button
              key={key}
              type="button"
              className={`btn btn-xs ${(f.statuses || []).includes(key) ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => toggleInArray('statuses', key)}
            >
              {val.label || key}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-2)' }}>קבוצה</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, lineHeight: 1.45 }}>
          כשמסמנים קבוצה — כל ההורים של הרשומים אליה נכללים, גם אם לא מנויים לרשימת התפוצה של החוגים.
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(groupsByDay.length, 1)}, minmax(140px, 1fr))`,
            gap: 10,
            paddingBottom: 4,
          }}
        >
          {groupsByDay.map((section) => {
            const dayIds = section.groups.map((g) => g.id);
            const selected = Array.isArray(f.groupIds) ? f.groupIds : [];
            const allDaySelected = dayIds.length > 0 && dayIds.every((id) => selected.includes(id));
            return (
            <div
              key={section.day}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                minWidth: 140,
                padding: 8,
                borderRadius: 10,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--border)',
              }}
            >
              <button
                type="button"
                onClick={() => toggleDayGroups(section.groups)}
                title={allDaySelected ? 'בטל סימון כל הקבוצות של היום' : 'סמן את כל הקבוצות של היום'}
                className={`btn btn-xs segment-day-btn ${allDaySelected ? 'btn-primary' : 'btn-ghost'}`}
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  width: '100%',
                  marginBottom: 4,
                  minHeight: 28,
                  boxSizing: 'border-box',
                  border: '1px solid var(--border)',
                  background: allDaySelected ? undefined : 'rgba(255,255,255,0.06)',
                  boxShadow: 'none',
                  transform: 'none',
                }}
              >
                יום {section.label}
              </button>
              {section.groups.map((g) => (
                <button
                  key={`${section.day}-${g.id}`}
                  type="button"
                  className={`btn btn-xs segment-group-btn ${(f.groupIds || []).includes(g.id) ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => toggleInArray('groupIds', g.id)}
                  style={{
                    width: '100%',
                    whiteSpace: 'normal',
                    lineHeight: 1.35,
                    height: 'auto',
                    minHeight: 28,
                    boxSizing: 'border-box',
                    boxShadow: 'none',
                    transform: 'none',
                  }}
                  title={g.name}
                >
                  {g.name}
                </button>
              ))}
            </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-2)' }}>תחום עניין</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {interestOptions.map((i) => (
            <button
              key={i}
              type="button"
              className={`btn btn-xs ${(f.interests || []).includes(i) ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => toggleInArray('interests', i)}
            >
              {i}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={f.marketingOptIn === true}
            onChange={(e) => set({ marketingOptIn: e.target.checked ? true : null })}
          />
          רק מי שאישר דיוור
        </label>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={!!f.onlyOpenWindow}
            onChange={(e) => set({ onlyOpenWindow: e.target.checked })}
          />
          רק חלון 24ש פתוח
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input input-sm"
          placeholder="שם לקהל שמור"
          value={segmentName}
          onChange={(e) => setSegmentName(e.target.value)}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={saveCurrent}>
          <Save size={13} /> שמור קהל
        </button>
      </div>

      {preview.recipients?.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-2)', maxHeight: 120, overflowY: 'auto' }}>
          {preview.recipients.slice(0, 30).map((r) => (
            <div key={r.id}>{r.name} · {r.phone} {r.city ? `· ${r.city}` : ''} {r.windowOpen ? '· חלון פתוח' : '· חלון סגור'}</div>
          ))}
          {preview.recipients.length > 30 && <div>...ועוד {preview.recipients.length - 30}</div>}
        </div>
      )}

      {!loadingPreview && preview.count === 0 && (
        <div style={{ fontSize: 12, color: '#FBBF24', lineHeight: 1.45 }}>
          אין נמענים לפי הסינון הנוכחי.
          בדקו קבוצה/סטטוס, עיר, ואישור דיוור.
          {!(Array.isArray(f.groupIds) && f.groupIds.length) && (
            <>
              {' '}
              אם נבחרה רשימת תפוצה — ייתכן שההורה לא מנוי אליה.
            </>
          )}
        </div>
      )}
    </div>
  );
}
