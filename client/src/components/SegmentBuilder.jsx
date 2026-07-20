import React, { useEffect, useMemo, useState } from 'react';
import { Users, Save } from 'lucide-react';
import { STATUSES } from '../mockData.js';

const EMPTY_FILTERS = {
  ageMin: '',
  ageMax: '',
  cities: [],
  statuses: [],
  registered: 'any',
  groupIds: [],
  groupDays: [],
  genders: [],
  interests: [],
  listKey: '',
  marketingOptIn: true,
  onlyOpenWindow: false,
};

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
          <select className="input input-sm" value={f.listKey || ''} onChange={(e) => set({ listKey: e.target.value || '' })}>
            <option value="">ללא סינון רשימה</option>
            {lists.map((l) => (
              <option key={l.key} value={l.key}>{l.label}</option>
            ))}
          </select>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`btn btn-xs ${(f.groupIds || []).includes(g.id) ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => toggleInArray('groupIds', g.id)}
            >
              {g.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 12, marginBottom: 6, color: 'var(--text-2)' }}>יום בשבוע</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              className={`btn btn-xs ${(f.groupDays || []).includes(d.value) ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => toggleInArray('groupDays', d.value)}
            >
              {d.label}
            </button>
          ))}
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
    </div>
  );
}

export { EMPTY_FILTERS };
