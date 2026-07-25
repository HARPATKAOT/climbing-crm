import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, ChevronLeft, ChevronRight, X, Save, Trash2, Link2, Unlink,
  RefreshCw, Loader2, CalendarDays, CalendarRange, Layers,
  CheckCircle, AlertCircle, Clock3, Bookmark, Check,
} from 'lucide-react';
import ActivityPageDesigner from './ActivityPageDesigner.jsx';
import ActivityRegistrationPanel from './ActivityRegistrationPanel.jsx';
import ActivityTemplatesMenu from './ActivityTemplatesMenu.jsx';

export const ACTIVITY_TYPES = [
  { id: 'birthday', label: 'יום הולדת', color: '#FB923C', bg: 'rgba(251,146,60,0.18)' },
  { id: 'trip', label: 'טיול', color: '#60A5FA', bg: 'rgba(96,165,250,0.18)' },
  { id: 'school', label: 'בית ספר', color: '#34D399', bg: 'rgba(52,211,153,0.18)' },
  { id: 'company', label: 'חברה', color: '#FBBF24', bg: 'rgba(251,191,36,0.18)' },
  { id: 'route_building', label: 'בניית מסלולים', color: '#A78BFA', bg: 'rgba(167,139,250,0.18)' },
  { id: 'opening_hours', label: 'שעות פתיחה', color: '#22D3EE', bg: 'rgba(34,211,238,0.16)' },
  { id: 'other', label: 'אחר', color: '#94A3B8', bg: 'rgba(148,163,184,0.16)' },
];

const WORK_TYPE_OPTIONS = [
  { id: 'counter_shift', label: 'דלפק' },
  { id: 'class_shift', label: 'חוג' },
  { id: 'private_shift', label: 'פרטי' },
  { id: 'route_building_shift', label: 'בניית מסלולים' },
];

const SOURCE_LABELS = {
  clock: 'שעון',
  calendar: 'יומן',
  manual: 'ידני',
};

const TYPE_MAP = Object.fromEntries(ACTIVITY_TYPES.map((t) => [t.id, t]));

const HEB_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const HEB_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateStr(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay(); // 0 = Sunday
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const WEEK_START_MIN = 6 * 60;
const WEEK_END_MIN = 23 * 60;
const PX_PER_MIN = 1.15;
const SNAP_MIN = 15;
const DRAG_MIME = 'application/x-crm-cal-event';
let skipChipClickUntil = 0;

function markChipDragEnd() {
  skipChipClickUntil = Date.now() + 350;
}

function shouldSkipChipClick() {
  return Date.now() < skipChipClickUntil;
}

function timeToMinutes(t) {
  if (!t) return null;
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToTime(mins) {
  let m = Math.round(Number(mins) || 0);
  m = ((m % (24 * 60)) + (24 * 60)) % (24 * 60);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function snapMinutes(mins, step = SNAP_MIN) {
  return Math.round(mins / step) * step;
}

function eventStartMinutes(ev) {
  if (ev.all_day) return WEEK_START_MIN;
  return timeToMinutes(ev.start_time) ?? 10 * 60;
}

function eventEndMinutes(ev) {
  if (ev.all_day) return WEEK_START_MIN + 60;
  const start = eventStartMinutes(ev);
  let end = timeToMinutes(ev.end_time);
  if (end == null) end = start + 60;
  if (end <= start) end = start + 60;
  return end;
}

// Classic calendar overlap layout: cluster transitively-overlapping events,
// assign each a column index and the cluster's total column count.
// items: [{ id, startMin, endMin }] -> Map(id -> { col, colCount })
function computeOverlapLayout(items) {
  const sorted = [...items].sort(
    (a, b) => (a.startMin - b.startMin) || (b.endMin - a.endMin),
  );
  const layout = new Map();
  let cluster = [];
  let columns = []; // columns[i] = end minute of the last event placed in column i
  let clusterEnd = -Infinity;

  const flushCluster = () => {
    for (const it of cluster) {
      layout.get(it.id).colCount = columns.length;
    }
    cluster = [];
    columns = [];
    clusterEnd = -Infinity;
  };

  for (const it of sorted) {
    const end = Math.max(it.endMin, it.startMin + 1);
    if (cluster.length && it.startMin >= clusterEnd) flushCluster();
    let col = columns.findIndex((colEnd) => it.startMin >= colEnd);
    if (col === -1) {
      col = columns.length;
      columns.push(end);
    } else {
      columns[col] = end;
    }
    layout.set(it.id, { col, colCount: 1 });
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flushCluster();
  return layout;
}

function canEditEvent(ev) {
  if (!ev) return false;
  if (ev.overlay) return !ev.read_only;
  return true;
}

function scheduleChanged(a, b) {
  return a.date !== b.date
    || String(a.end_date || '') !== String(b.end_date || '')
    || !!a.all_day !== !!b.all_day
    || String(a.start_time || '') !== String(b.start_time || '')
    || String(a.end_time || '') !== String(b.end_time || '');
}

function eachDateInclusive(startStr, endStr) {
  const start = parseDateStr(startStr);
  if (!start) return [];
  let end = parseDateStr(endStr) || start;
  if (end < start) end = start;
  const out = [];
  let cur = start;
  while (cur <= end) {
    out.push(toDateStr(cur));
    cur = addDays(cur, 1);
  }
  return out;
}

/** True when activity spans more than one calendar day (inclusive end_date). */
function isMultiDayEvent(ev) {
  if (!ev) return false;
  const start = String(ev.date || '').slice(0, 10);
  const end = String(ev.end_date || '').slice(0, 10);
  return !!(start && end && end > start);
}

/** Column / filter date for an expanded occurrence (week grid). */
function eventOccurrenceDate(ev) {
  if (!ev) return '';
  return String(ev.occurrenceDate || ev.date || '').slice(0, 10);
}

function shiftEndDatePreservingSpan(oldDate, oldEndDate, newDate) {
  const start = String(oldDate || '').slice(0, 10);
  const end = String(oldEndDate || '').slice(0, 10);
  const next = String(newDate || '').slice(0, 10);
  if (!start || !next || !end || end <= start) return end && end > next ? end : null;
  const s = parseDateStr(start);
  const e = parseDateStr(end);
  const n = parseDateStr(next);
  if (!s || !e || !n) return end;
  const span = Math.round((e - s) / (24 * 60 * 60 * 1000));
  return toDateStr(addDays(n, span));
}

function emptyForm(dateStr = '', opts = {}) {
  const start_time = opts.start_time || '10:00';
  let end_time = opts.end_time;
  if (!end_time) {
    if (opts.start_time) {
      const sm = timeToMinutes(opts.start_time);
      end_time = sm != null ? minutesToTime(sm + 60) : '12:00';
    } else {
      end_time = '12:00';
    }
  }
  return {
    name: '',
    type: 'birthday',
    date: dateStr || toDateStr(new Date()),
    end_date: opts.end_date || '',
    start_time,
    end_time,
    all_day: false,
    location: '',
    contact_name: '',
    contact_phone: '',
    host_name: '',
    host_email: '',
    host_phone: '',
    host_parent_id: null,
    payment_status: 'unpaid',
    registration_enabled: false,
    collect_registration_payment: false,
    registration_mode: 'paid_per_participant',
    registration_slug: '',
    registration_page_title: '',
    registration_page_body: '',
    registration_closes_at: '',
    registration_theme: {},
    price: '',
    max_participants: '',
    description: '',
    notes: '',
    status: 'open',
  };
}

function roundHoursQuarter(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 4) / 4;
}

function hoursFromTimes(startHm, endHm) {
  const parse = (hm) => {
    if (!hm || !/^\d{1,2}:\d{2}/.test(hm)) return null;
    const [h, m] = hm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const a = parse(startHm);
  const b = parse(endHm);
  if (a == null || b == null || b <= a) return null;
  return roundHoursQuarter((b - a) / 60);
}

function WorkAssignmentsBlock({ activityId }) {
  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const [empRes, asgRes] = await Promise.all([
        fetch('/api/employees'),
        fetch(`/api/work-assignments?activity_id=${encodeURIComponent(activityId)}`),
      ]);
      const emps = empRes.ok ? await empRes.json() : [];
      const asgs = asgRes.ok ? await asgRes.json() : [];
      setEmployees(Array.isArray(emps) ? emps.filter((e) => e.is_active !== false) : []);
      setRows(Array.isArray(asgs)
        ? asgs.map((r) => ({ ...r, hours: roundHoursQuarter(r.hours) }))
        : []);
    } catch {
      setEmployees([]);
      setRows([]);
    }
  }, [activityId]);

  useEffect(() => { load(); }, [load]);

  const empName = (id) => employees.find((e) => e.id === id)?.name || 'עובד';

  const addFromPlan = async () => {
    if (!selectedIds.length) {
      setMsg('בחרו לפחות עובד אחד');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/work-assignments/from-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activity_id: activityId, employee_ids: selectedIds }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMsg(err.error || 'הוספה נכשלה');
      } else {
        setSelectedIds([]);
        await load();
      }
    } catch {
      setMsg('הוספה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const saveRow = async (row) => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/work-assignments/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_type: row.work_type,
          start_time: row.start_time,
          end_time: row.end_time,
          hours: roundHoursQuarter(row.hours),
          source: 'manual',
          notes: row.notes || '',
        }),
      });
      if (!res.ok) setMsg('שמירת שורה נכשלה');
      else await load();
    } catch {
      setMsg('שמירת שורה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const deleteRow = async (id) => {
    if (!window.confirm('למחוק את שורת העבודה?')) return;
    setBusy(true);
    try {
      await fetch(`/api/work-assignments/${id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const patchLocal = (id, patch) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      if ('start_time' in patch || 'end_time' in patch) {
        const computed = hoursFromTimes(next.start_time, next.end_time);
        if (computed != null) next.hours = computed;
      }
      return next;
    }));
  };

  const available = employees.filter((e) => !rows.some((r) => r.employee_id === e.id));

  return (
    <div style={{
      marginTop: 4,
      padding: 12,
      borderRadius: 12,
      border: '1px solid var(--border)',
      background: 'rgba(255,255,255,0.02)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)' }}>
        עובדים במשמרת
      </div>

      {available.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>הוספת עובדים</div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 8,
              maxHeight: 130,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-input, rgba(0,0,0,0.12))',
            }}>
              {available.map((employee) => {
                const checked = selectedIds.includes(employee.id);
                return (
                  <label
                    key={employee.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 6px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: 'var(--text-1)',
                      background: checked ? 'rgba(99,102,241,0.12)' : 'transparent',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setSelectedIds((prev) => (
                          event.target.checked
                            ? [...prev, employee.id]
                            : prev.filter((id) => id !== employee.id)
                        ));
                      }}
                    />
                    <span style={{ fontSize: 13 }}>{employee.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !selectedIds.length}
            onClick={addFromPlan}
            style={{ whiteSpace: 'nowrap' }}
          >
            {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            הוסף מהשעון / תכנון
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
          עדיין אין עובדים משויכים לאירוע הזה
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.2fr 1fr 0.8fr 0.8fr 0.7fr auto',
                gap: 6,
                alignItems: 'end',
                padding: 8,
                borderRadius: 8,
                border: '1px solid var(--border)',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>עובד</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{empName(row.employee_id)}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  {SOURCE_LABELS[row.source] || row.source}
                  {row.approved ? ' · מאושר' : ''}
                </div>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                סוג
                <select
                  className="input"
                  value={row.work_type || 'counter_shift'}
                  onChange={(e) => patchLocal(row.id, { work_type: e.target.value })}
                  style={{ fontSize: 12, padding: '4px 6px' }}
                >
                  {WORK_TYPE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                התחלה
                <input
                  className="input"
                  type="time"
                  value={row.start_time || ''}
                  onChange={(e) => patchLocal(row.id, { start_time: e.target.value })}
                  style={{ fontSize: 12, padding: '4px 6px' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                סיום
                <input
                  className="input"
                  type="time"
                  value={row.end_time || ''}
                  onChange={(e) => patchLocal(row.id, { end_time: e.target.value })}
                  style={{ fontSize: 12, padding: '4px 6px' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                שעות
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.25"
                  value={row.hours ?? 0}
                  onChange={(e) => patchLocal(row.id, { hours: e.target.value })}
                  onBlur={(e) => patchLocal(row.id, { hours: roundHoursQuarter(e.target.value) })}
                  style={{ fontSize: 12, padding: '4px 6px' }}
                />
              </label>
              <div style={{ display: 'flex', gap: 4, paddingBottom: 2 }}>
                <button
                  type="button"
                  className="btn-ghost btn-icon btn-xs"
                  title="שמור"
                  disabled={busy}
                  onClick={() => saveRow(row)}
                >
                  <Save size={12} />
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-icon btn-xs"
                  title="מחק"
                  disabled={busy}
                  onClick={() => deleteRow(row.id)}
                  style={{ color: '#F87171' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 12, color: '#FCA5A5' }}>{msg}</div>
      )}
    </div>
  );
}

function RegularActivityModal({
  form,
  set,
  setForm,
  readOnly,
  isEdit,
  initial,
  onDelete,
  onClose,
  saving,
  showError,
  submit,
  title,
}) {
  const [tplBusy, setTplBusy] = useState(false);
  const [tplMsg, setTplMsg] = useState('');
  const activityId = isEdit ? initial?.id : null;

  const saveAsTemplate = async () => {
    if (!activityId) {
      setTplMsg('שמרו את האירוע קודם');
      return;
    }
    const name = window.prompt('שם התבנית', form.name || 'תבנית אירוע');
    if (!name) return;
    const catRaw = window.prompt(
      'קטגוריה: wall = אירועים בקיר, field = פעילויות שטח',
      'wall'
    );
    if (catRaw == null) return;
    const category = String(catRaw).trim().toLowerCase() === 'field' ? 'field' : 'wall';
    setTplBusy(true);
    setTplMsg('');
    try {
      const res = await fetch('/api/activity-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activity_id: activityId,
          name,
          category,
          theme: form.registration_theme || {},
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTplMsg(data.error || 'שמירת תבנית נכשלה');
        return;
      }
      setTplMsg(category === 'field' ? 'נשמר תחת פעילויות שטח' : 'נשמר תחת אירועים בקיר');
    } catch {
      setTplMsg('שגיאת רשת');
    } finally {
      setTplBusy(false);
    }
  };

  return (
    <div className="activity-modal-backdrop" onClick={onClose}>
      <form
        className="activity-modal activity-modal--wide"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <header className="activity-modal-header">
          <div>
            <div className="activity-modal-title">{title}</div>
            <div className="activity-modal-subtitle">
              עריכת העמוד הציבורי והגדרות האירוע במקום אחד
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגור">
            <X size={16} />
          </button>
        </header>

        <div className="activity-modal-grid">
          <div className="activity-modal-preview-pane">
            <ActivityPageDesigner
              form={form}
              setForm={setForm}
              readOnly={readOnly}
            />
          </div>

          <div className="activity-modal-operations">
            <section className="activity-settings-card">
              <div className="activity-settings-card-title">הגדרות האירוע</div>
              <div>
                <div className="activity-settings-label">סוג האירוע</div>
                <div className="activity-type-options">
                  {ACTIVITY_TYPES.map((type) => {
                    const active = form.type === type.id;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        disabled={readOnly}
                        onClick={() => set('type', type.id)}
                        className={active ? 'is-active' : ''}
                        style={{
                          '--activity-type-color': type.color,
                          '--activity-type-background': type.bg,
                        }}
                      >
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="activity-settings-grid">
                <label>
                  <span className="activity-settings-label">מצב האירוע</span>
                  <select
                    className="input"
                    value={form.status || 'open'}
                    onChange={(event) => set('status', event.target.value)}
                    disabled={readOnly}
                  >
                    <option value="open">פעיל</option>
                    <option value="completed">הסתיים</option>
                    <option value="cancelled">בוטל</option>
                  </select>
                </label>
                <label>
                  <span className="activity-settings-label">מצב תצוגה</span>
                  <div className="activity-settings-toggle">
                    <input
                      type="checkbox"
                      checked={!!form.registration_enabled}
                      onChange={(event) => set('registration_enabled', event.target.checked)}
                      disabled={readOnly}
                    />
                    דף הרשמה ציבורי
                  </div>
                </label>
              </div>
            </section>

            <ActivityRegistrationPanel
              activityId={activityId}
              form={form}
              setForm={setForm}
              readOnly={readOnly}
              hideRegistrationToggle
            />

            <section className="activity-settings-card">
              <div className="activity-settings-card-title">הערות פנימיות</div>
              <textarea
                className="input"
                rows={3}
                value={form.notes || ''}
                onChange={(event) => set('notes', event.target.value)}
                placeholder="הערות לצוות בלבד..."
                disabled={readOnly}
              />
            </section>

            {isEdit ? (
              <WorkAssignmentsBlock activityId={initial.id} />
            ) : (
              <div className="activity-settings-empty">
                אחרי שמירת האירוע אפשר לשייך עובדים ולקבוע שעות לכל אחד
              </div>
            )}
          </div>
        </div>

        {(showError || tplMsg) && (
          <div className="activity-modal-error" role="alert">{showError || tplMsg}</div>
        )}

        <footer className="activity-modal-footer">
          <div className="activity-modal-footer-start">
            {isEdit && !readOnly && onDelete && (
              <button
                type="button"
                className="btn activity-modal-btn activity-modal-btn--danger"
                onClick={() => onDelete(initial)}
                disabled={saving || tplBusy}
              >
                <Trash2 size={14} /> מחיקה
              </button>
            )}
          </div>
          <div className="activity-modal-footer-actions">
            {!readOnly && (
              <button
                type="button"
                className="btn activity-modal-btn activity-modal-btn--template"
                onClick={saveAsTemplate}
                disabled={saving || tplBusy || !activityId}
                title={!activityId ? 'שמרו את האירוע תחילה' : 'שמירה כתבנית'}
              >
                {tplBusy ? <Loader2 size={14} className="spin" /> : <Bookmark size={14} />}
                שמירה כתבנית
              </button>
            )}
            <button
              type="button"
              className="btn activity-modal-btn activity-modal-btn--ghost"
              onClick={onClose}
              disabled={saving || tplBusy}
            >
              {readOnly ? 'סגור' : 'ביטול'}
            </button>
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="btn activity-modal-btn activity-modal-btn--ghost"
                  disabled={saving || tplBusy}
                  onClick={(event) => submit(event, { closeAfter: false })}
                >
                  {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  החל
                </button>
                <button
                  type="submit"
                  className="btn activity-modal-btn activity-modal-btn--primary"
                  disabled={saving || tplBusy}
                >
                  {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                  שמור וצא
                </button>
              </>
            )}
          </div>
        </footer>
      </form>
    </div>
  );
}

function ActivityFormModal({ initial, onSave, onDelete, onClose, saving, error }) {
  const isOverlay = !!initial?.overlay;
  const readOnly = !!initial?.read_only;
  const [form, setForm] = useState(() => ({
    ...emptyForm(),
    ...initial,
    end_date: initial?.end_date ? String(initial.end_date).slice(0, 10) : '',
    start_time: initial?.start_time ? String(initial.start_time).slice(0, 5) : (initial?.all_day ? '' : '10:00'),
    end_time: initial?.end_time ? String(initial.end_time).slice(0, 5) : (initial?.all_day ? '' : '12:00'),
    price: initial?.price ?? '',
    max_participants: initial?.max_participants ?? '',
    host_name: initial?.host_name || initial?.contact_name || '',
    host_phone: initial?.host_phone || initial?.contact_phone || '',
    host_email: initial?.host_email || '',
    host_parent_id: initial?.host_parent_id || null,
    payment_status: initial?.payment_status || 'unpaid',
    registration_enabled: !!initial?.registration_enabled,
    collect_registration_payment: !!initial?.collect_registration_payment,
    registration_mode: initial?.registration_mode || (
      initial?.collect_registration_payment ? 'paid_per_participant' : 'host_pays'
    ),
    registration_page_title: initial?.registration_page_title || '',
    registration_page_body: initial?.registration_page_body || '',
    registration_theme: (
      initial?.registration_theme && typeof initial.registration_theme === 'object'
        ? initial.registration_theme
        : {}
    ),
  }));
  const [localError, setLocalError] = useState('');
  const isEdit = !!initial?.id;
  const showError = localError || error || '';
  const multiDay = !!(form.date && form.end_date && form.end_date > form.date);

  const set = (key, value) => {
    if (readOnly) return;
    setLocalError('');
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = (e, options = {}) => {
    e.preventDefault();
    if (readOnly) return;
    if (!String(form.name || '').trim()) {
      setLocalError('חסרה כותרת לאירוע');
      return;
    }
    if (!form.date) {
      setLocalError('חסר תאריך');
      return;
    }
    if (form.end_date && form.end_date < form.date) {
      setLocalError('תאריך הסיום חייב להיות אחרי תאריך ההתחלה או באותו יום');
      return;
    }
    const endDateNorm = form.end_date && form.end_date > form.date ? form.end_date : '';
    const closeAfter = options.closeAfter !== false;
    if (isOverlay) {
      onSave({
        ...form,
        end_date: endDateNorm || null,
        overlay: true,
        name: String(form.name).trim(),
        calendar_id: initial.calendar_id,
        google_event_id: initial.google_event_id,
        closeAfter,
      });
      return;
    }
    onSave({
      ...form,
      end_date: endDateNorm || null,
      name: String(form.name).trim(),
      price: form.price === '' ? 0 : Number(form.price),
      max_participants: form.max_participants === '' ? null : Number(form.max_participants),
      closeAfter,
    });
  };

  const title = readOnly
    ? 'צפייה באירוע'
    : isOverlay
      ? 'עריכת אירוע מיומן חיצוני'
      : (isEdit ? 'עריכת אירוע' : 'אירוע חדש');

  if (!isOverlay) {
    return (
      <RegularActivityModal
        form={form}
        set={set}
        setForm={setForm}
        readOnly={readOnly}
        isEdit={isEdit}
        initial={initial}
        onDelete={onDelete}
        onClose={onClose}
        saving={saving}
        showError={showError}
        submit={submit}
        title={title}
      />
    );
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 16,
      }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          width: isEdit && !isOverlay ? 'min(720px, 100%)' : 'min(520px, 100%)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px 12px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-1)' }}>
              {title}
            </div>
            {isOverlay && initial?.calendar_name && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                {initial.calendar_name}
                {readOnly ? ' · לצפייה בלבד' : ''}
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="סגור">
            <X size={16} />
          </button>
        </div>

        <div style={{
          padding: '14px 20px',
          overflowY: 'auto',
          flex: '1 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
            כותרת
            <input
              className={`input${showError && !String(form.name || '').trim() ? ' input-error' : ''}`}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="למשל: יום הולדת לנוי"
              required
              autoFocus={!readOnly}
              disabled={readOnly}
            />
          </label>

          {!isOverlay && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>סוג</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ACTIVITY_TYPES.map((t) => {
                  const active = form.type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => set('type', t.id)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 999,
                        border: `1px solid ${active ? t.color : 'var(--border)'}`,
                        background: active ? t.bg : 'transparent',
                        color: active ? t.color : 'var(--text-2)',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
              תאריך
              <input
                className="input"
                type="date"
                value={form.date || ''}
                onChange={(e) => set('date', e.target.value)}
                required
                disabled={readOnly}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
              תאריך סיום
              <input
                className="input"
                type="date"
                value={form.end_date || ''}
                min={form.date || undefined}
                onChange={(e) => set('end_date', e.target.value)}
                disabled={readOnly}
              />
            </label>
          </div>

          {multiDay && !form.all_day && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.45 }}>
              כל יום בין התאריכים בשעות שמוגדרות למטה
            </div>
          )}
          {multiDay && form.all_day && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.45 }}>
              בלוק של יום שלם לכל הימים בטווח
            </div>
          )}

          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
            color: 'var(--text-2)',
          }}>
            <input
              type="checkbox"
              checked={!!form.all_day}
              onChange={(e) => set('all_day', e.target.checked)}
              disabled={readOnly}
            />
            יום שלם
          </label>

          {!form.all_day && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
                שעת התחלה
                <input
                  className="input"
                  type="time"
                  value={form.start_time || ''}
                  onChange={(e) => set('start_time', e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
                שעת סיום
                <input
                  className="input"
                  type="time"
                  value={form.end_time || ''}
                  onChange={(e) => set('end_time', e.target.value)}
                  disabled={readOnly}
                />
              </label>
            </div>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
            מיקום
            <input
              className="input"
              value={form.location || ''}
              onChange={(e) => set('location', e.target.value)}
              placeholder="בקיר / בחוץ / כתובת"
              disabled={readOnly}
            />
          </label>

          {!isOverlay && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
                  מחיר
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="1"
                    value={form.price}
                    onChange={(e) => set('price', e.target.value)}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
                  מקסימום משתתפים
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="1"
                    value={form.max_participants}
                    onChange={(e) => set('max_participants', e.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
            תיאור
            <textarea
              className="input"
              rows={2}
              value={form.description || ''}
              onChange={(e) => set('description', e.target.value)}
              style={{ resize: 'vertical' }}
              disabled={readOnly}
            />
          </label>

          {!isOverlay && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-3)' }}>
              הערות פנימיות
              <textarea
                className="input"
                rows={2}
                value={form.notes || ''}
                onChange={(e) => set('notes', e.target.value)}
                style={{ resize: 'vertical' }}
              />
            </label>
          )}

          {!isOverlay && (
            <ActivityRegistrationPanel
              activityId={isEdit ? initial.id : null}
              form={form}
              setForm={setForm}
              readOnly={readOnly}
            />
          )}

          {!isOverlay && (
            isEdit ? (
              <WorkAssignmentsBlock activityId={initial.id} />
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
                אחרי שמירת האירוע אפשר לשייך עובדים ולקבוע שעות לכל אחד
              </div>
            )
          )}
        </div>

        {showError && (
          <div style={{
            margin: '0 20px 0',
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(248,113,113,0.12)',
            border: '1px solid rgba(248,113,113,0.35)',
            color: '#FCA5A5',
            fontSize: 13,
            flexShrink: 0,
          }}>
            {showError}
          </div>
        )}

        <div style={{
          display: 'flex', gap: 8, padding: '14px 20px 16px',
          justifyContent: 'space-between', flexWrap: 'wrap',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          background: 'var(--bg-card)',
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {isEdit && !readOnly && onDelete && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onDelete(initial)}
                disabled={saving}
                style={{ color: '#F87171', borderColor: 'rgba(248,113,113,0.35)' }}
              >
                <Trash2 size={14} /> מחיקה
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginInlineStart: 'auto' }}>
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
              {readOnly ? 'סגור' : 'ביטול'}
            </button>
            {!readOnly && (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={saving}
                  onClick={(event) => submit(event, { closeAfter: false })}
                >
                  {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                  החל
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                  שמור וצא
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function PaymentStatusIcon({ status, size = 12 }) {
  const normalized = status === 'paid' || status === 'partial' ? status : 'unpaid';
  const config = normalized === 'paid'
    ? { Icon: CheckCircle, label: 'שולם', color: '#34D399' }
    : normalized === 'partial'
      ? { Icon: Clock3, label: 'שולם חלקית', color: '#FBBF24' }
      : { Icon: AlertCircle, label: 'טרם שולם', color: '#FB7185' };
  const { Icon, label, color } = config;

  return (
    <span
      title={`מצב תשלום: ${label}`}
      aria-label={`מצב תשלום: ${label}`}
      style={{ display: 'inline-flex', color, flexShrink: 0 }}
    >
      <Icon size={size} strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
}

function EventChip({ activity, onClick, draggable = true }) {
  const meta = TYPE_MAP[activity.type] || TYPE_MAP.other;
  const timeLabel = activity.all_day
    ? 'יום שלם'
    : (activity.start_time ? String(activity.start_time).slice(0, 5) : '');
  const editable = canEditEvent(activity);
  return (
    <button
      type="button"
      draggable={draggable && editable}
      onDragStart={(e) => {
        if (!editable) return;
        e.stopPropagation();
        const payload = JSON.stringify({
          kind: 'activity',
          id: activity.id,
        });
        e.dataTransfer.setData(DRAG_MIME, payload);
        e.dataTransfer.setData('text/plain', payload);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        markChipDragEnd();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (shouldSkipChipClick()) return;
        onClick(activity);
      }}
      title={activity.name}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        textAlign: 'right',
        border: 'none',
        borderRadius: 6,
        padding: '3px 6px',
        marginBottom: 3,
        background: meta.bg,
        color: meta.color,
        fontSize: 11,
        fontWeight: 700,
        cursor: editable ? 'grab' : 'pointer',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
      }}
    >
      <PaymentStatusIcon status={activity.payment_status} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {timeLabel ? `${timeLabel} · ` : ''}{activity.name}
      </span>
    </button>
  );
}

function OverlayChip({ event, onClick, draggable = true }) {
  const color = event.color || '#94A3B8';
  const timeLabel = event.all_day
    ? ''
    : (event.start_time ? String(event.start_time).slice(0, 5) : '');
  const editable = canEditEvent(event);
  const title = `${event.calendar_name || 'יומן חיצוני'}: ${event.name}${timeLabel ? ` · ${timeLabel}` : ''}${editable ? '' : ' (צפייה בלבד)'}`;
  return (
    <button
      type="button"
      title={title}
      draggable={draggable && editable}
      onDragStart={(e) => {
        if (!editable) return;
        e.stopPropagation();
        const payload = JSON.stringify({
          kind: 'overlay',
          id: event.id,
        });
        e.dataTransfer.setData(DRAG_MIME, payload);
        e.dataTransfer.setData('text/plain', payload);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        markChipDragEnd();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (shouldSkipChipClick()) return;
        onClick?.(event);
      }}
      style={{
        display: 'block',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        textAlign: 'right',
        borderRadius: 6,
        padding: '2px 6px',
        marginBottom: 3,
        background: `${color}22`,
        color,
        border: `1px solid ${color}66`,
        fontSize: 10,
        fontWeight: 600,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        lineHeight: 1.3,
        cursor: editable ? 'grab' : 'pointer',
      }}
    >
      {timeLabel ? `${timeLabel} · ` : ''}{event.name}
    </button>
  );
}

function WeekTimedEvent({
  event,
  top,
  height,
  draft,
  col = 0,
  colCount = 1,
  onPointerDownMove,
  onPointerDownResize,
  onOpen,
}) {
  const isOverlay = !!event.overlay;
  const meta = !isOverlay ? (TYPE_MAP[event.type] || TYPE_MAP.other) : null;
  const color = isOverlay ? (event.color || '#94A3B8') : meta.color;
  const bg = isOverlay ? `${color}22` : meta.bg;
  const editable = canEditEvent(event);
  // Multi-day: edit via form only — drag/resize of one day would be ambiguous.
  const multiDayLocked = isMultiDayEvent(event);
  const canDrag = editable && !multiDayLocked;
  const startLabel = draft
    ? minutesToTime(draft.startMin)
    : (event.all_day ? '' : String(event.start_time || '').slice(0, 5));
  const endLabel = draft
    ? minutesToTime(draft.endMin)
    : (event.all_day ? '' : String(event.end_time || '').slice(0, 5));
  const name = event.name || '';
  const blockHeight = Math.max(18, height);
  const narrow = colCount >= 3;
  const nameFontSize = narrow ? 10 : 11;
  const nameLineHeight = Math.round(nameFontSize * 1.25);
  // מספיק גבוה כדי להציג שעה בשורה נפרדת ושם שנשבר לכמה שורות
  const stacked = blockHeight >= 34;
  const timeRowHeight = stacked && startLabel ? 13 : 0;
  const nameLines = Math.max(
    1,
    Math.min(4, Math.floor((blockHeight - 8 - timeRowHeight) / nameLineHeight))
  );
  const titleBase = `${name}${startLabel ? ` · ${startLabel}–${endLabel}` : ''}`;
  const title = multiDayLocked
    ? `${titleBase} — אירוע רב־יומי — יש לערוך דרך הטופס`
    : titleBase;

  return (
    <div
      onPointerDown={(e) => {
        if (!canDrag) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        onPointerDownMove(e, event);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (shouldSkipChipClick()) return;
        if (e.currentTarget.dataset.moved === '1') {
          e.currentTarget.dataset.moved = '';
          return;
        }
        onOpen(event);
      }}
      title={title}
      style={{
        position: 'absolute',
        insetInlineStart: `calc(${(col * 100) / colCount}% + 2px)`,
        width: `calc(${100 / colCount}% - 4px)`,
        top,
        height: Math.max(18, height),
        borderRadius: 7,
        background: bg,
        border: `1px solid ${color}66`,
        color,
        fontSize: nameFontSize,
        fontWeight: 700,
        padding: narrow ? '3px 4px' : '3px 6px',
        overflow: 'hidden',
        cursor: canDrag ? 'grab' : 'pointer',
        zIndex: draft ? 5 : 2,
        boxShadow: draft ? '0 6px 18px rgba(0,0,0,0.35)' : 'none',
        userSelect: 'none',
        touchAction: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {canDrag && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDownResize(e, event, 'start');
          }}
          style={{
            position: 'absolute', top: 0, insetInline: 0, height: 7,
            cursor: 'ns-resize',
          }}
        />
      )}
      {stacked ? (
        <>
          {startLabel && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                opacity: 0.85,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {startLabel}{endLabel ? `–${endLabel}` : ''}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'flex-start', gap: 3, minWidth: 0 }}>
            {!isOverlay && <PaymentStatusIcon status={event.payment_status} size={11} />}
            <span
              style={{
                overflow: 'hidden',
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: nameLines,
                lineHeight: `${nameLineHeight}px`,
              }}
            >
              {name}
            </span>
          </span>
        </>
      ) : (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
          {!isOverlay && <PaymentStatusIcon status={event.payment_status} size={11} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {startLabel ? `${startLabel} ` : ''}{name}
          </span>
        </span>
      )}
      {canDrag && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDownResize(e, event, 'end');
          }}
          style={{
            position: 'absolute', bottom: 0, insetInline: 0, height: 7,
            cursor: 'ns-resize',
          }}
        />
      )}
    </div>
  );
}

function WeekTimeGrid({
  weekDays,
  activitiesByDate,
  overlaysByDate,
  onOpenActivity,
  onOpenOverlay,
  onScheduleChange,
  onCreateDay,
  onCreateSlot,
  dropHighlightDate,
  onDayDragOver,
  onDayDrop,
  onDayDragLeave,
}) {
  const gridHeight = (WEEK_END_MIN - WEEK_START_MIN) * PX_PER_MIN;
  const hours = [];
  for (let m = WEEK_START_MIN; m < WEEK_END_MIN; m += 60) hours.push(m);

  const [drag, setDrag] = useState(null);
  const liveRef = useRef(null);
  const columnRefs = useRef({});

  useEffect(() => {
    liveRef.current = drag;
  }, [drag]);

  const findEvent = (kind, id) => {
    for (const day of weekDays) {
      const list = kind === 'overlay'
        ? (overlaysByDate.get(day.dateStr) || [])
        : (activitiesByDate.get(day.dateStr) || []);
      const found = list.find((e) => e.id === id);
      if (found) return found;
    }
    // Also search all maps in case event moved visually
    for (const list of activitiesByDate.values()) {
      const found = list.find((e) => e.id === id);
      if (found) return found;
    }
    for (const list of overlaysByDate.values()) {
      const found = list.find((e) => e.id === id);
      if (found) return found;
    }
    return null;
  };

  const resolveColumnDate = (clientX) => {
    for (const day of weekDays) {
      const el = columnRefs.current[day.dateStr];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return day.dateStr;
    }
    return liveRef.current?.date || null;
  };

  const yToMinutes = (clientY, dateStr) => {
    const el = columnRefs.current[dateStr];
    if (!el) return WEEK_START_MIN;
    const r = el.getBoundingClientRect();
    const y = clientY - r.top;
    const raw = WEEK_START_MIN + y / PX_PER_MIN;
    return snapMinutes(Math.max(WEEK_START_MIN, Math.min(WEEK_END_MIN, raw)));
  };

  const beginDrag = (e, event, mode) => {
    if (!canEditEvent(event)) return;
    // Safer MVP: do not move/resize multi-day occurrences from the week grid.
    if (isMultiDayEvent(event)) return;
    e.preventDefault();
    const startMin = eventStartMinutes(event);
    const endMin = eventEndMinutes(event);
    const duration = Math.max(SNAP_MIN, endMin - startMin);
    const colDate = eventOccurrenceDate(event) || event.date;
    const pointerMin = yToMinutes(e.clientY, colDate);
    const offset = pointerMin - startMin;
    const next = {
      id: event.id,
      kind: event.overlay ? 'overlay' : 'activity',
      mode,
      date: colDate,
      startMin,
      endMin,
      duration,
      offset,
      origin: {
        date: colDate,
        start_time: event.start_time ? String(event.start_time).slice(0, 5) : minutesToTime(startMin),
        end_time: event.end_time ? String(event.end_time).slice(0, 5) : minutesToTime(endMin),
        all_day: !!event.all_day,
      },
      moved: false,
    };
    setDrag(next);
    liveRef.current = next;
    e.currentTarget.dataset.moved = '';

    const onMove = (ev) => {
      const cur = liveRef.current;
      if (!cur) return;
      let date = cur.date;
      if (cur.mode === 'move') {
        date = resolveColumnDate(ev.clientX) || cur.date;
      }
      let startMinNext = cur.startMin;
      let endMinNext = cur.endMin;
      if (cur.mode === 'move') {
        const pointer = yToMinutes(ev.clientY, date);
        startMinNext = snapMinutes(pointer - cur.offset);
        startMinNext = Math.max(WEEK_START_MIN, Math.min(WEEK_END_MIN - cur.duration, startMinNext));
        endMinNext = startMinNext + cur.duration;
      } else if (cur.mode === 'start') {
        const pointer = yToMinutes(ev.clientY, date);
        startMinNext = Math.min(pointer, cur.endMin - SNAP_MIN);
        endMinNext = cur.endMin;
      } else if (cur.mode === 'end') {
        const pointer = yToMinutes(ev.clientY, date);
        endMinNext = Math.max(pointer, cur.startMin + SNAP_MIN);
        startMinNext = cur.startMin;
      }
      const moved = cur.origin.date !== date
        || minutesToTime(startMinNext) !== cur.origin.start_time
        || minutesToTime(endMinNext) !== cur.origin.end_time;
      const updated = {
        ...cur,
        date,
        startMin: startMinNext,
        endMin: endMinNext,
        moved,
      };
      liveRef.current = updated;
      setDrag(updated);
      if (moved) e.currentTarget.dataset.moved = '1';
    };

    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const cur = liveRef.current;
      setDrag(null);
      liveRef.current = null;
      if (!cur || !cur.moved) return;
      markChipDragEnd();
      const eventObj = findEvent(cur.kind, cur.id);
      if (!eventObj) return;
      await onScheduleChange(eventObj, {
        date: cur.date,
        start_time: minutesToTime(cur.startMin),
        end_time: minutesToTime(cur.endMin),
        all_day: false,
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <div />
        {weekDays.map((day) => (
          <button
            key={day.dateStr}
            type="button"
            onClick={() => onCreateDay?.(day.dateStr)}
            style={{
              padding: '10px 4px', textAlign: 'center',
              border: 'none',
              borderInlineStart: '1px solid var(--border)',
              background: day.isToday ? 'rgba(56,189,248,0.14)' : 'transparent',
              boxShadow: day.isToday ? 'inset 0 -3px 0 #38BDF8' : 'none',
              cursor: 'pointer',
            }}
          >
            <div style={{
              fontSize: 11,
              color: day.isToday ? '#7DD3FC' : 'var(--text-3)',
              fontWeight: 700,
            }}>
              {HEB_DAYS[day.date.getDay()]}
            </div>
            <div style={{
              width: day.isToday ? 30 : 'auto',
              height: day.isToday ? 30 : 'auto',
              margin: '4px auto 0',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              fontWeight: 800,
              background: day.isToday
                ? 'linear-gradient(135deg, #38BDF8 0%, #0EA5E9 100%)'
                : 'transparent',
              color: day.isToday ? '#0B1220' : 'var(--text-1)',
              boxShadow: day.isToday
                ? '0 0 0 3px rgba(56,189,248,0.22)'
                : 'none',
            }}>
              {day.date.getDate()}
            </div>
          </button>
        ))}
      </div>

      {/* All-day row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))',
        borderBottom: '1px solid var(--border)',
        minHeight: 44,
      }}>
        <div style={{
          fontSize: 10, color: 'var(--text-3)', padding: '8px 4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          יום שלם
        </div>
        {weekDays.map((day) => {
          const acts = (activitiesByDate.get(day.dateStr) || []).filter((e) => e.all_day);
          const ovs = (overlaysByDate.get(day.dateStr) || []).filter((e) => e.all_day);
          const hot = dropHighlightDate === day.dateStr;
          return (
            <div
              key={day.dateStr}
              onDragOver={(e) => onDayDragOver?.(e, day.dateStr)}
              onDrop={(e) => onDayDrop?.(e, day.dateStr)}
              onDragLeave={() => onDayDragLeave?.(day.dateStr)}
              style={{
                padding: 4,
                borderInlineStart: '1px solid var(--border)',
                background: hot ? 'rgba(56,189,248,0.12)' : 'transparent',
                minHeight: 44,
              }}
            >
              {acts.map((a) => (
                <EventChip key={a.id} activity={a} onClick={onOpenActivity} />
              ))}
              {ovs.map((ev) => (
                <OverlayChip key={ev.id} event={ev} onClick={onOpenOverlay} />
              ))}
            </div>
          );
        })}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))',
        maxHeight: 'min(68vh, 760px)',
        overflowY: 'auto',
      }}>
        <div style={{ position: 'relative', height: gridHeight }}>
          {hours.map((m) => (
            <div
              key={m}
              style={{
                position: 'absolute',
                top: (m - WEEK_START_MIN) * PX_PER_MIN,
                insetInline: 0,
                height: 60 * PX_PER_MIN,
                fontSize: 10,
                color: 'var(--text-3)',
                paddingTop: 2,
                textAlign: 'center',
                borderTop: '1px solid var(--border)',
              }}
            >
              {minutesToTime(m)}
            </div>
          ))}
        </div>

        {weekDays.map((day) => {
          const acts = (activitiesByDate.get(day.dateStr) || []).filter((e) => !e.all_day);
          const ovs = (overlaysByDate.get(day.dateStr) || []).filter((e) => !e.all_day);
          const hot = dropHighlightDate === day.dateStr;
          return (
            <div
              key={day.dateStr}
              ref={(el) => { columnRefs.current[day.dateStr] = el; }}
              onDragOver={(e) => onDayDragOver?.(e, day.dateStr)}
              onDrop={(e) => onDayDrop?.(e, day.dateStr)}
              onDragLeave={() => onDayDragLeave?.(day.dateStr)}
              style={{
                position: 'relative',
                height: gridHeight,
                borderInlineStart: '1px solid var(--border)',
                background: hot
                  ? 'rgba(56,189,248,0.08)'
                  : (day.isToday ? 'rgba(56,189,248,0.08)' : 'transparent'),
                boxShadow: day.isToday && !hot
                  ? 'inset 0 0 0 1px rgba(56,189,248,0.35)'
                  : 'none',
              }}
            >
              {hours.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="cal-hour-slot"
                  title={`אירוע חדש ב־${minutesToTime(m)}`}
                  aria-label={`אירוע חדש ב־${minutesToTime(m)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (shouldSkipChipClick()) return;
                    onCreateSlot?.(day.dateStr, minutesToTime(m));
                  }}
                  style={{
                    position: 'absolute',
                    top: (m - WEEK_START_MIN) * PX_PER_MIN,
                    insetInline: 0,
                    height: 60 * PX_PER_MIN,
                    border: 'none',
                    borderTop: '1px solid rgba(255,255,255,0.04)',
                    background: 'transparent',
                    padding: 0,
                    margin: 0,
                    cursor: 'pointer',
                    zIndex: 1,
                  }}
                >
                  <span className="cal-hour-slot-plus" aria-hidden="true">
                    <Plus size={12} strokeWidth={2.5} />
                  </span>
                </button>
              ))}
              {(() => {
                const merged = [...acts, ...ovs];
                // Overlap layout for events resting in this column (the dragged
                // event is excluded — it floats full-width above the others).
                const layout = computeOverlapLayout(
                  merged
                    .filter((ev) => !(drag && drag.id === ev.id))
                    .map((ev) => ({
                      id: ev.id,
                      startMin: eventStartMinutes(ev),
                      endMin: eventEndMinutes(ev),
                    })),
                );
                return merged.map((ev) => {
                const isDraft = drag && drag.id === ev.id;
                const startMin = isDraft ? drag.startMin : eventStartMinutes(ev);
                const endMin = isDraft ? drag.endMin : eventEndMinutes(ev);
                const date = isDraft ? drag.date : eventOccurrenceDate(ev);
                if (date !== day.dateStr) return null;
                const top = (startMin - WEEK_START_MIN) * PX_PER_MIN;
                const height = Math.max(18, (endMin - startMin) * PX_PER_MIN);
                const slot = isDraft ? null : layout.get(ev.id);
                return (
                  <WeekTimedEvent
                    key={`${ev.id}-${date}`}
                    event={ev}
                    top={top}
                    height={height}
                    col={slot ? slot.col : 0}
                    colCount={slot ? slot.colCount : 1}
                    draft={isDraft ? drag : null}
                    onPointerDownMove={(e, event) => beginDrag(e, event, 'move')}
                    onPointerDownResize={(e, event, edge) => beginDrag(e, event, edge)}
                    onOpen={(event) => {
                      if (event.overlay) onOpenOverlay(event);
                      else onOpenActivity(event);
                    }}
                  />
                );
                });
              })()}
              {/* Show draft event when moved into this day from another */}
              {drag && drag.date === day.dateStr && !acts.some((a) => a.id === drag.id) && !ovs.some((o) => o.id === drag.id) && (() => {
                const event = findEvent(drag.kind, drag.id);
                if (!event) return null;
                const top = (drag.startMin - WEEK_START_MIN) * PX_PER_MIN;
                const height = Math.max(18, (drag.endMin - drag.startMin) * PX_PER_MIN);
                return (
                  <WeekTimedEvent
                    key={`draft-${drag.id}`}
                    event={event}
                    top={top}
                    height={height}
                    draft={drag}
                    onPointerDownMove={() => {}}
                    onPointerDownResize={() => {}}
                    onOpen={() => {}}
                  />
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverlaySidebar({
  calendars,
  selectedIds,
  wallCalendarId,
  saving,
  loading,
  onToggle,
}) {
  const selected = new Set(selectedIds || []);

  return (
    <aside style={{
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px 8px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: 8,
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 13, fontWeight: 800, color: 'var(--text-1)',
        }}>
          <Layers size={15} />
          יומנים להצגה
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.35 }}>
          סמן כדי לראות בלוח. אפשר לערוך יומנים עם הרשאת כתיבה.
        </div>
      </div>

      <div style={{ padding: '0 12px 12px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: 12, fontSize: 12 }}>
            <Loader2 size={16} className="spin" style={{ display: 'inline' }} /> טוען...
          </div>
        ) : (calendars || []).length === 0 ? (
          <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: 8 }}>
            אין יומנים להצגה
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'stretch',
          }}>
            {calendars.map((cal) => {
              const isWall = cal.id === wallCalendarId || cal.isWallCalendar;
              const checked = isWall || selected.has(cal.id);
              const color = cal.backgroundColor || '#94A3B8';
              let status = '';
              if (isWall) status = 'מסונכרן';
              else if (cal.primary) status = 'ראשי';

              return (
                <label
                  key={cal.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '7px 10px',
                    borderRadius: 999,
                    border: `1px solid ${checked ? `${color}88` : 'var(--border)'}`,
                    background: checked ? `${color}18` : 'transparent',
                    cursor: isWall || saving ? 'default' : 'pointer',
                    opacity: isWall ? 0.9 : (checked ? 1 : 0.72),
                    maxWidth: '100%',
                    minWidth: 0,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isWall || saving}
                    onChange={() => !isWall && onToggle(cal.id)}
                    style={{ margin: 0, flexShrink: 0 }}
                  />
                  <span
                    style={{
                      width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                      background: color,
                    }}
                  />
                  <span style={{
                    fontSize: 12,
                    color: 'var(--text-1)',
                    fontWeight: 600,
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 180,
                  }}>
                    {cal.name}
                  </span>
                  {status && (
                    <span style={{
                      fontSize: 10,
                      color: isWall ? '#34D399' : 'var(--text-3)',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>
                      {status}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

export default function ActivitiesCalendar({ isOwner = false }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('month'); // month | week
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [typeFilter, setTypeFilter] = useState('all');
  const [modal, setModal] = useState(null); // form initial or null
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [googleStatus, setGoogleStatus] = useState(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [banner, setBanner] = useState('');
  const [overlayEvents, setOverlayEvents] = useState([]);
  const [overlayCalendars, setOverlayCalendars] = useState([]);
  const [overlaySelectedIds, setOverlaySelectedIds] = useState([]);
  const [overlaySaving, setOverlaySaving] = useState(false);
  const [overlayListLoading, setOverlayListLoading] = useState(false);
  const [dropHighlightDate, setDropHighlightDate] = useState('');
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const skipClickUntilRef = useRef(0);
  const undoStackRef = useRef([]);
  const undoBusyRef = useRef(false);
  const visibleRangeRef = useRef({ from: '', to: '' });

  const pushUndo = useCallback((entry) => {
    if (!entry) return;
    undoStackRef.current = [...undoStackRef.current.slice(-29), entry];
  }, []);

  const snapshotSchedule = (ev) => ({
    date: ev.date,
    end_date: ev.end_date ? String(ev.end_date).slice(0, 10) : null,
    start_time: ev.start_time ? String(ev.start_time).slice(0, 5) : null,
    end_time: ev.end_time ? String(ev.end_time).slice(0, 5) : null,
    all_day: !!ev.all_day,
  });

  const putOverlayEvent = async (event, fields) => {
    const res = await fetch('/api/google-calendar/overlay-events', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendar_id: event.calendar_id,
        google_event_id: event.google_event_id,
        name: fields.name !== undefined ? fields.name : event.name,
        date: fields.date,
        start_time: fields.all_day ? null : fields.start_time,
        end_time: fields.all_day ? null : fields.end_time,
        all_day: !!fields.all_day,
        location: fields.location !== undefined ? fields.location : (event.location || ''),
        description: fields.description !== undefined ? fields.description : (event.description || ''),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'עדכון האירוע נכשל');
    return data;
  };

  const putActivity = async (event, fields) => {
    const res = await fetch(`/api/activities/${event.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...event,
        ...fields,
        start_time: fields.all_day ? null : fields.start_time,
        end_time: fields.all_day ? null : fields.end_time,
        all_day: !!fields.all_day,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'עדכון האירוע נכשל');
    return data;
  };

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch('/api/activities');
      const data = res.ok ? await res.json() : [];
      setActivities(Array.isArray(data) ? data : []);
    } catch {
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGoogleStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/google-calendar/status');
      if (res.ok) setGoogleStatus(await res.json());
    } catch {
      setGoogleStatus(null);
    }
  }, []);

  const loadOverlayCalendars = useCallback(async () => {
    if (!googleStatus?.connected) {
      setOverlayCalendars([]);
      setOverlaySelectedIds([]);
      return;
    }
    setOverlayListLoading(true);
    try {
      const res = await fetch('/api/google-calendar/calendars');
      const data = res.ok ? await res.json() : {};
      setOverlayCalendars(Array.isArray(data.calendars) ? data.calendars : []);
      setOverlaySelectedIds(Array.isArray(data.overlayCalendarIds) ? data.overlayCalendarIds : []);
    } catch {
      setOverlayCalendars([]);
    } finally {
      setOverlayListLoading(false);
    }
  }, [googleStatus?.connected]);

  useEffect(() => {
    loadActivities();
    loadGoogleStatus();
  }, [loadActivities, loadGoogleStatus]);

  useEffect(() => {
    loadOverlayCalendars();
  }, [loadOverlayCalendars]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('google');
    if (g === 'connected') {
      setBanner('היומן חובר בהצלחה לגוגל');
      loadGoogleStatus();
      loadActivities();
      window.history.replaceState({}, '', '/activities');
    } else if (g === 'error') {
      setBanner(params.get('msg') || 'חיבור לגוגל נכשל');
      window.history.replaceState({}, '', '/activities');
    }
  }, [loadActivities, loadGoogleStatus]);

  const filtered = useMemo(() => {
    if (typeFilter === 'all') return activities;
    return activities.filter((a) => a.type === typeFilter);
  }, [activities, typeFilter]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const a of filtered) {
      const start = String(a.date || '').slice(0, 10);
      if (!start) continue;
      const endRaw = String(a.end_date || '').slice(0, 10);
      const end = endRaw && endRaw >= start ? endRaw : start;
      for (const key of eachDateInclusive(start, end)) {
        if (!map.has(key)) map.set(key, []);
        // Keep parent date/end_date; occurrenceDate is the day being rendered.
        map.get(key).push({ ...a, occurrenceDate: key });
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
    }
    return map;
  }, [filtered]);

  const overlayByDate = useMemo(() => {
    const map = new Map();
    for (const ev of overlayEvents) {
      const start = String(ev.date || '').slice(0, 10);
      if (!start) continue;
      // Expand multi-day all-day overlays across the range (end exclusive from Google)
      if (ev.all_day && ev.end_date && ev.end_date !== start) {
        let cur = parseDateStr(start);
        const endExclusive = parseDateStr(ev.end_date);
        while (cur && endExclusive && cur < endExclusive) {
          const key = toDateStr(cur);
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(ev);
          cur = addDays(cur, 1);
        }
      } else {
        if (!map.has(start)) map.set(start, []);
        map.get(start).push(ev);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')));
    }
    return map;
  }, [overlayEvents]);

  const visibleRange = useMemo(() => {
    if (viewMode === 'week') {
      const days = (() => {
        const start = startOfWeek(cursor);
        return Array.from({ length: 7 }, (_, i) => addDays(start, i));
      })();
      return { from: toDateStr(days[0]), to: toDateStr(days[6]) };
    }
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = startOfWeek(first);
    const end = addDays(start, 41);
    return { from: toDateStr(start), to: toDateStr(end) };
  }, [cursor, viewMode]);

  useEffect(() => {
    visibleRangeRef.current = visibleRange;
  }, [visibleRange]);

  const overlayIdsKey = (googleStatus?.overlayCalendarIds || []).join('|');

  const loadOverlayEvents = useCallback(async (from, to) => {
    if (!googleStatus?.connected) {
      setOverlayEvents([]);
      return;
    }
    if (!overlayIdsKey) {
      setOverlayEvents([]);
      return;
    }
    try {
      const res = await fetch(`/api/google-calendar/overlay-events?from=${from}&to=${to}`);
      const data = res.ok ? await res.json() : [];
      setOverlayEvents(Array.isArray(data) ? data : []);
    } catch {
      setOverlayEvents([]);
    }
  }, [googleStatus?.connected, overlayIdsKey]);

  useEffect(() => {
    loadOverlayEvents(visibleRange.from, visibleRange.to);
  }, [visibleRange.from, visibleRange.to, loadOverlayEvents]);

  const monthLabel = `${HEB_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const monthCells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const start = startOfWeek(first);
    const todayStr = toDateStr(new Date());
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const d = addDays(start, i);
      const dateStr = toDateStr(d);
      cells.push({
        date: d,
        dateStr,
        inMonth: d.getMonth() === month,
        isToday: dateStr === todayStr,
        isPast: dateStr < todayStr,
      });
    }
    return cells;
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      return {
        date: d,
        dateStr: toDateStr(d),
        isToday: toDateStr(d) === toDateStr(new Date()),
      };
    });
  }, [cursor]);

  const shift = (delta) => {
    setCursor((prev) => {
      if (viewMode === 'month') {
        return new Date(prev.getFullYear(), prev.getMonth() + delta, 1);
      }
      return addDays(prev, delta * 7);
    });
  };

  const openCreate = (dateStr, opts = {}) => {
    if (Date.now() < skipClickUntilRef.current) return;
    setFormError('');
    setModal(emptyForm(dateStr, opts));
  };
  const openEdit = (activity) => {
    if (Date.now() < skipClickUntilRef.current) return;
    setFormError('');
    // Open the parent activity (ignore occurrenceDate from week/month expansion).
    const canonical = activities.find((a) => a.id === activity?.id) || activity;
    if (!canonical) return;
    const rest = { ...canonical };
    delete rest.occurrenceDate;
    setModal(rest);
  };

  const openOverlayEdit = (event) => {
    if (Date.now() < skipClickUntilRef.current) return;
    setFormError('');
    setModal({
      ...event,
      overlay: true,
      start_time: event.start_time ? String(event.start_time).slice(0, 5) : '',
      end_time: event.end_time ? String(event.end_time).slice(0, 5) : '',
    });
  };

  const findEventByDragPayload = (payload) => {
    if (!payload?.id) return null;
    if (payload.kind === 'overlay') {
      return overlayEvents.find((e) => e.id === payload.id) || null;
    }
    return activities.find((a) => a.id === payload.id) || null;
  };

  const persistScheduleChange = async (event, patch, { recordUndo = true } = {}) => {
    if (!event || !canEditEvent(event)) return;
    const before = snapshotSchedule(event);
    const next = {
      ...before,
      ...patch,
      start_time: patch.start_time !== undefined
        ? (patch.start_time ? String(patch.start_time).slice(0, 5) : null)
        : before.start_time,
      end_time: patch.end_time !== undefined
        ? (patch.end_time ? String(patch.end_time).slice(0, 5) : null)
        : before.end_time,
      all_day: patch.all_day !== undefined ? !!patch.all_day : before.all_day,
    };
    if (patch.date && patch.end_date === undefined && before.end_date) {
      next.end_date = shiftEndDatePreservingSpan(before.date, before.end_date, patch.date);
    } else if (patch.end_date !== undefined) {
      next.end_date = patch.end_date ? String(patch.end_date).slice(0, 10) : null;
    }
    if (!scheduleChanged(before, next)) return;

    skipClickUntilRef.current = Date.now() + 400;
    setScheduleBusy(true);

    if (event.overlay) {
      setOverlayEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, ...next } : e)));
    } else {
      setActivities((prev) => prev.map((a) => (a.id === event.id ? { ...a, ...next } : a)));
    }

    try {
      if (event.overlay) {
        await putOverlayEvent(event, next);
        await loadOverlayEvents(visibleRangeRef.current.from, visibleRangeRef.current.to);
      } else {
        await putActivity(event, next);
        await loadActivities();
      }
      if (recordUndo) {
        pushUndo({
          type: 'schedule',
          label: 'הזזת אירוע',
          eventRef: {
            overlay: !!event.overlay,
            id: event.id,
            calendar_id: event.calendar_id,
            google_event_id: event.google_event_id,
            name: event.name,
            location: event.location || '',
            description: event.description || '',
            type: event.type,
            contact_name: event.contact_name,
            contact_phone: event.contact_phone,
            price: event.price,
            max_participants: event.max_participants,
            notes: event.notes,
            status: event.status,
          },
          before,
          after: next,
        });
      }
    } catch (err) {
      setBanner(err.message || 'עדכון האירוע נכשל');
      await loadActivities();
      await loadOverlayEvents(visibleRangeRef.current.from, visibleRangeRef.current.to);
    } finally {
      setScheduleBusy(false);
    }
  };

  const undoLastAction = useCallback(async () => {
    if (undoBusyRef.current || scheduleBusy || saving) return;
    const entry = undoStackRef.current[undoStackRef.current.length - 1];
    if (!entry) {
      setBanner('אין פעולה לביטול');
      return;
    }
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    undoBusyRef.current = true;
    setScheduleBusy(true);
    try {
      if (entry.type === 'schedule') {
        const ref = entry.eventRef;
        if (ref.overlay) {
          await putOverlayEvent(ref, entry.before);
          await loadOverlayEvents(visibleRangeRef.current.from, visibleRangeRef.current.to);
        } else {
          await putActivity(ref, entry.before);
          await loadActivities();
        }
        setBanner('בוטלה הפעולה האחרונה');
      } else if (entry.type === 'activity_update') {
        await putActivity(entry.before, entry.before);
        await loadActivities();
        setBanner('בוטלה עריכת האירוע');
      } else if (entry.type === 'overlay_update') {
        await putOverlayEvent(entry.before, entry.before);
        await loadOverlayEvents(visibleRangeRef.current.from, visibleRangeRef.current.to);
        setBanner('בוטלה עריכת האירוע');
      } else if (entry.type === 'activity_create') {
        const res = await fetch(`/api/activities/${entry.createdId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('ביטול יצירה נכשל');
        await loadActivities();
        setBanner('בוטלה יצירת האירוע');
      } else if (entry.type === 'activity_delete') {
        const { id, google_event_id, google_etag, synced_at, ...rest } = entry.snapshot;
        const res = await fetch('/api/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rest),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'שחזור האירוע נכשל');
        await loadActivities();
        setBanner('האירוע שוחזר');
      } else if (entry.type === 'overlay_delete') {
        // Restore deleted Google event fields via insert
        const res = await fetch('/api/google-calendar/overlay-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            calendar_id: entry.snapshot.calendar_id,
            name: entry.snapshot.name,
            date: entry.snapshot.date,
            start_time: entry.snapshot.start_time,
            end_time: entry.snapshot.end_time,
            all_day: !!entry.snapshot.all_day,
            location: entry.snapshot.location || '',
            description: entry.snapshot.description || '',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'שחזור האירוע נכשל');
        await loadOverlayEvents(visibleRangeRef.current.from, visibleRangeRef.current.to);
        setBanner('האירוע שוחזר');
      }
    } catch (err) {
      // Put the entry back if undo failed
      undoStackRef.current = [...undoStackRef.current, entry];
      setBanner(err.message || 'ביטול הפעולה נכשל');
    } finally {
      undoBusyRef.current = false;
      setScheduleBusy(false);
    }
  }, [loadActivities, loadOverlayEvents, saving, scheduleBusy]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const key = String(e.key || '').toLowerCase();
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z';
      if (!isUndo) return;
      const tag = e.target?.tagName;
      const editable = e.target?.isContentEditable
        || tag === 'INPUT'
        || tag === 'TEXTAREA'
        || tag === 'SELECT';
      if (editable) return;
      e.preventDefault();
      undoLastAction();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undoLastAction]);

  const onDayDragOver = (e, dateStr) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropHighlightDate !== dateStr) setDropHighlightDate(dateStr);
  };

  const onDayDragLeave = (dateStr) => {
    setDropHighlightDate((prev) => (prev === dateStr ? '' : prev));
  };

  const onDayDrop = async (e, dateStr) => {
    e.preventDefault();
    e.stopPropagation();
    setDropHighlightDate('');
    let raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const event = findEventByDragPayload(payload);
    if (!event || !canEditEvent(event)) return;
    if (event.date === dateStr) return;
    await persistScheduleChange(event, { date: dateStr });
  };

  const handleSave = async (payload) => {
    setSaving(true);
    setFormError('');
    const closeAfter = payload.closeAfter !== false;
    try {
      if (payload.overlay) {
        const before = overlayEvents.find((e) => e.id === payload.id) || payload;
        await putOverlayEvent(payload, {
          name: payload.name,
          date: payload.date,
          start_time: payload.start_time,
          end_time: payload.end_time,
          all_day: !!payload.all_day,
          location: payload.location || '',
          description: payload.description || '',
        });
        pushUndo({
          type: 'overlay_update',
          label: 'עריכת אירוע חיצוני',
          before: { ...before },
        });
        if (closeAfter) {
          setModal(null);
        } else {
          setModal({ ...payload });
        }
        await loadOverlayEvents(visibleRangeRef.current.from, visibleRangeRef.current.to);
        setBanner(closeAfter ? 'האירוע נשמר' : 'השינויים הוחלו');
        return;
      }

      const isEdit = !!payload.id;
      const before = isEdit ? activities.find((a) => a.id === payload.id) : null;
      const { closeAfter: _closeAfter, ...body } = payload;
      const res = await fetch(isEdit ? `/api/activities/${payload.id}` : '/api/activities', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `שמירה נכשלה (${res.status})`);
      }
      if (isEdit && before) {
        pushUndo({ type: 'activity_update', label: 'עריכת אירוע', before: { ...before } });
      } else if (!isEdit && data?.id) {
        pushUndo({ type: 'activity_create', label: 'יצירת אירוע', createdId: data.id });
      }
      await loadActivities();
      if (closeAfter) {
        setModal(null);
        setBanner('האירוע נשמר');
      } else {
        setModal(data?.id ? data : { ...body, ...(data || {}) });
        setBanner('השינויים הוחלו');
      }
    } catch (err) {
      const msg = err.message || 'שמירה נכשלה';
      setFormError(msg);
      setBanner(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (activity) => {
    if (!window.confirm(`למחוק את "${activity.name}"?`)) return;
    setSaving(true);
    try {
      if (activity.overlay) {
        const qs = new URLSearchParams({
          calendar_id: activity.calendar_id || '',
          event_id: activity.google_event_id || '',
        });
        const res = await fetch(`/api/google-calendar/overlay-events?${qs}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'מחיקה נכשלה');
        pushUndo({
          type: 'overlay_delete',
          label: 'מחיקת אירוע חיצוני',
          snapshot: { ...activity },
        });
        setModal(null);
        await loadOverlayEvents(visibleRangeRef.current.from, visibleRangeRef.current.to);
        setBanner('האירוע נמחק מהיומן החיצוני');
        return;
      }
      const res = await fetch(`/api/activities/${activity.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('מחיקה נכשלה');
      pushUndo({
        type: 'activity_delete',
        label: 'מחיקת אירוע',
        snapshot: { ...activity },
      });
      setModal(null);
      await loadActivities();
    } catch (err) {
      setBanner(err.message || 'מחיקה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const connectGoogle = async () => {
    setGoogleBusy(true);
    try {
      const res = await fetch('/api/google-calendar/auth-url');
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'לא ניתן להתחיל חיבור');
      window.location.href = data.url;
    } catch (err) {
      setBanner(err.message);
      setGoogleBusy(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!window.confirm('לנתק את הסנכרון עם גוגל? האירועים ביומן יישארו במערכת.')) return;
    setGoogleBusy(true);
    try {
      await fetch('/api/google-calendar/disconnect', { method: 'POST' });
      await loadGoogleStatus();
      setBanner('החיבור לגוגל נותק');
    } catch (err) {
      setBanner(err.message || 'ניתוק נכשל');
    } finally {
      setGoogleBusy(false);
    }
  };

  const syncNow = async () => {
    setGoogleBusy(true);
    try {
      const res = await fetch('/api/google-calendar/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'סנכרון נכשל');
      await loadActivities();
      await loadGoogleStatus();
      await loadOverlayEvents(visibleRange.from, visibleRange.to);
      setBanner(
        `סנכרון הושלם: נשלחו לגוגל ${data.pushed || 0}, נוספו ${data.created || 0}, עודכנו ${data.updated || 0}, נמחקו ${data.deleted || 0}`
      );
    } catch (err) {
      setBanner(err.message || 'סנכרון נכשל');
    } finally {
      setGoogleBusy(false);
    }
  };

  const toggleOverlayCalendar = async (calendarId) => {
    if (overlaySaving) return;
    const wallId = googleStatus?.calendarId;
    if (calendarId === wallId) return;

    const prev = overlaySelectedIds;
    const next = prev.includes(calendarId)
      ? prev.filter((id) => id !== calendarId)
      : [...prev, calendarId];

    setOverlaySelectedIds(next);
    setOverlaySaving(true);
    try {
      const res = await fetch('/api/google-calendar/overlays', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarIds: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שמירה נכשלה');
      await loadGoogleStatus();
    } catch (err) {
      setOverlaySelectedIds(prev);
      setBanner(err.message || 'שמירת יומנים נכשלה');
    } finally {
      setOverlaySaving(false);
    }
  };

  const weekTitle = (() => {
    const days = weekDays;
    if (!days.length) return '';
    const a = days[0].date;
    const b = days[6].date;
    return `${a.getDate()} ${HEB_MONTHS[a.getMonth()]} – ${b.getDate()} ${HEB_MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  })();

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      overflowX: 'hidden',
      boxSizing: 'border-box',
    }}>
      {banner && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(56,189,248,0.12)',
          border: '1px solid rgba(56,189,248,0.35)',
          color: '#7DD3FC',
          fontSize: 13,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          alignItems: 'center',
        }}>
          <span>{banner}</span>
          <button type="button" className="icon-btn" onClick={() => setBanner('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="הקודם">
            <ChevronRight size={16} />
          </button>
          <div style={{
            minWidth: 160, textAlign: 'center', fontWeight: 800, fontSize: 16, color: 'var(--text-1)',
          }}>
            {viewMode === 'month' ? monthLabel : weekTitle}
          </div>
          <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="הבא">
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCursor(viewMode === 'month'
              ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
              : new Date())}
            style={{ fontSize: 12 }}
          >
            היום
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{
            display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
          }}>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: viewMode === 'month' ? 'rgba(56,189,248,0.18)' : 'transparent',
                color: viewMode === 'month' ? '#7DD3FC' : 'var(--text-3)',
              }}
            >
              <CalendarDays size={14} /> חודש
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 12px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: viewMode === 'week' ? 'rgba(56,189,248,0.18)' : 'transparent',
                color: viewMode === 'week' ? '#7DD3FC' : 'var(--text-3)',
              }}
            >
              <CalendarRange size={14} /> שבוע
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ActivityTemplatesMenu
              defaultDate={toDateStr(new Date())}
              onCustomEvent={(dateStr) => {
                setFormError('');
                setModal(emptyForm(dateStr));
                setBanner('אירוע מותאם — מלאו מחיר, מזמין ודף הרשמה');
              }}
              onApplyTemplate={(tpl, dateStr) => {
                setFormError('');
                const theme = tpl.theme && typeof tpl.theme === 'object' ? tpl.theme : {};
                setModal({
                  ...emptyForm(dateStr),
                  name: tpl.name || '',
                  type: tpl.type || 'birthday',
                  date: dateStr,
                  end_date: tpl.end_date ? String(tpl.end_date).slice(0, 10) : '',
                  start_time: tpl.start_time ? String(tpl.start_time).slice(0, 5) : '10:00',
                  end_time: tpl.end_time ? String(tpl.end_time).slice(0, 5) : '12:00',
                  all_day: !!tpl.all_day,
                  location: tpl.location || '',
                  price: tpl.price ?? '',
                  max_participants: tpl.max_participants ?? '',
                  description: tpl.description || '',
                  notes: tpl.notes || '',
                  registration_enabled: !!tpl.registration_enabled,
                  collect_registration_payment: !!tpl.collect_registration_payment,
                  registration_mode: tpl.registration_mode || (
                    tpl.collect_registration_payment ? 'paid_per_participant' : 'host_pays'
                  ),
                  registration_page_title: tpl.registration_page_title || tpl.name || '',
                  registration_page_body: tpl.registration_page_body || tpl.description || '',
                  registration_theme: theme,
                  payment_status: 'unpaid',
                });
                setBanner(`תבנית: ${tpl.name} — ערכו ושמרו`);
              }}
            />
            <button type="button" className="btn-primary" onClick={() => openCreate(toDateStr(new Date()))}>
              <Plus size={14} /> אירוע חדש
            </button>
          </div>
        </div>
      </div>

      {/* Filters + Google */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setTypeFilter('all')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${typeFilter === 'all' ? '#38BDF8' : 'var(--border)'}`,
              background: typeFilter === 'all' ? 'rgba(56,189,248,0.15)' : 'transparent',
              color: typeFilter === 'all' ? '#7DD3FC' : 'var(--text-3)',
            }}
          >
            הכל
          </button>
          {ACTIVITY_TYPES.map((t) => {
            const active = typeFilter === t.id;
            const dimmed = typeFilter !== 'all' && !active;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTypeFilter(active ? 'all' : t.id)}
                title={active ? 'הצג הכל' : `סנן לפי ${t.label}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${active ? t.color : `${t.color}55`}`,
                  background: active ? t.bg : `${t.color}14`,
                  color: t.color,
                  opacity: dimmed ? 0.45 : 1,
                  transition: 'opacity 0.12s ease',
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0,
                }} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          fontSize: 12, color: 'var(--text-3)',
        }}>
          {googleStatus?.connected ? (
            <>
              <span style={{ color: '#34D399' }}>
                מחובר לגוגל
                {googleStatus.calendarName ? ` · ${googleStatus.calendarName}` : ''}
              </span>
              <button
                type="button"
                className="btn-ghost"
                onClick={syncNow}
                disabled={googleBusy}
                style={{ fontSize: 12 }}
              >
                {googleBusy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                סנכרון עכשיו
              </button>
              {isOwner && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={disconnectGoogle}
                  disabled={googleBusy}
                  style={{ fontSize: 12 }}
                >
                  <Unlink size={13} /> ניתוק
                </button>
              )}
            </>
          ) : googleStatus?.configured === false ? (
            <span style={{ color: '#FBBF24', maxWidth: 420, lineHeight: 1.4 }}>
              הסנכרון לגוגל עדיין לא מוגדר בשרת.
              חסרים מפתחות התחברות של גוגל.
            </span>
          ) : (
            <>
              <span>לא מחובר ליומן גוגל</span>
              {isOwner && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={connectGoogle}
                  disabled={googleBusy}
                  style={{ fontSize: 12, color: '#7DD3FC', borderColor: 'rgba(56,189,248,0.4)' }}
                >
                  {googleBusy ? <Loader2 size={13} className="spin" /> : <Link2 size={13} />}
                  חיבור לגוגל
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Calendar */}
      <div style={{
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)' }}>
          <Loader2 className="spin" size={22} style={{ display: 'inline' }} /> טוען יומן...
        </div>
      ) : viewMode === 'month' ? (
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
                fontWeight: 700, color: 'var(--text-3)',
                minWidth: 0,
                overflow: 'hidden',
              }}>
                {d}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', width: '100%' }}>
            {monthCells.map((cell) => {
              const list = byDate.get(cell.dateStr) || [];
              const overlays = overlayByDate.get(cell.dateStr) || [];
              const hot = dropHighlightDate === cell.dateStr;
              return (
                <div
                  key={cell.dateStr}
                  className="cal-month-day"
                  onClick={() => openCreate(cell.dateStr)}
                  onDragOver={(e) => onDayDragOver(e, cell.dateStr)}
                  onDragLeave={() => onDayDragLeave(cell.dateStr)}
                  onDrop={(e) => onDayDrop(e, cell.dateStr)}
                  style={{
                    minHeight: 96,
                    minWidth: 0,
                    padding: 6,
                    borderTop: '1px solid var(--border)',
                    borderInlineStart: '1px solid var(--border)',
                    background: hot
                      ? 'rgba(56,189,248,0.18)'
                      : cell.isToday
                        ? 'rgba(56,189,248,0.12)'
                        : (cell.isPast ? 'rgba(0,0,0,0.15)' : 'transparent'),
                    cursor: 'pointer',
                    opacity: cell.isPast ? 0.55 : 1,
                    outline: hot
                      ? '1px solid rgba(56,189,248,0.55)'
                      : (cell.isToday ? '2px solid rgba(56,189,248,0.75)' : 'none'),
                    outlineOffset: -1,
                    boxShadow: cell.isToday && !hot
                      ? 'inset 0 0 0 1px rgba(56,189,248,0.25)'
                      : 'none',
                    position: 'relative',
                    overflow: 'hidden',
                    zIndex: cell.isToday ? 1 : 0,
                  }}
                >
                  <button
                    type="button"
                    className="cal-month-day-plus"
                    title="אירוע חדש"
                    aria-label="אירוע חדש"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCreate(cell.dateStr);
                    }}
                  >
                    <Plus size={11} strokeWidth={2.5} />
                  </button>
                  <div style={{
                    width: cell.isToday ? 28 : 26,
                    height: cell.isToday ? 28 : 26,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 4,
                    marginInlineStart: 'auto',
                    fontSize: cell.isToday ? 13 : 12,
                    fontWeight: cell.isToday ? 800 : 700,
                    background: cell.isToday
                      ? 'linear-gradient(135deg, #38BDF8 0%, #0EA5E9 100%)'
                      : 'transparent',
                    color: cell.isToday ? '#0B1220' : 'var(--text-2)',
                    border: cell.isToday
                      ? '1px solid rgba(125,211,252,0.9)'
                      : '1px solid transparent',
                    boxShadow: cell.isToday
                      ? '0 0 0 3px rgba(56,189,248,0.22), 0 4px 12px rgba(14,165,233,0.35)'
                      : 'none',
                  }}>
                    {cell.date.getDate()}
                  </div>
                  {list.slice(0, 3).map((a) => (
                    <EventChip key={a.id} activity={a} onClick={openEdit} />
                  ))}
                  {overlays.slice(0, 2).map((ev) => (
                    <OverlayChip key={ev.id} event={ev} onClick={openOverlayEdit} />
                  ))}
                  {(list.length + overlays.length) > 5 && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)', paddingInline: 4 }}>
                      +{list.length + overlays.length - 5} נוספים
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <WeekTimeGrid
          weekDays={weekDays}
          activitiesByDate={byDate}
          overlaysByDate={overlayByDate}
          onOpenActivity={openEdit}
          onOpenOverlay={openOverlayEdit}
          onScheduleChange={persistScheduleChange}
          onCreateDay={openCreate}
          onCreateSlot={(dateStr, startTime) => openCreate(dateStr, { start_time: startTime })}
          dropHighlightDate={dropHighlightDate}
          onDayDragOver={onDayDragOver}
          onDayDrop={onDayDrop}
          onDayDragLeave={onDayDragLeave}
        />
      )}
          {!loading && (
            <button
              type="button"
              title="אירוע חדש"
              aria-label="אירוע חדש"
              onClick={() => openCreate(toDateStr(new Date()))}
              style={{
                position: 'absolute',
                bottom: 16,
                insetInlineEnd: 16,
                zIndex: 20,
                width: 48,
                height: 48,
                borderRadius: '50%',
                border: '1px solid rgba(56,189,248,0.55)',
                background: 'rgba(14,165,233,0.95)',
                color: '#0B1220',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(0,0,0,0.45), 0 0 0 1px rgba(56,189,248,0.2)',
              }}
            >
              <Plus size={22} strokeWidth={2.5} />
            </button>
          )}
      </div>

      {googleStatus?.connected && (
        <OverlaySidebar
          calendars={overlayCalendars}
          selectedIds={overlaySelectedIds}
          wallCalendarId={googleStatus?.calendarId}
          saving={overlaySaving}
          loading={overlayListLoading}
          onToggle={toggleOverlayCalendar}
        />
      )}

      {modal && (
        <ActivityFormModal
          key={modal.overlay ? `overlay-${modal.id}` : (modal.id || 'new-activity')}
          initial={modal}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setModal(null); setFormError(''); }}
          saving={saving}
          error={formError}
        />
      )}

      <style>{`
        .spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .cal-hour-slot-plus {
          position: absolute;
          top: 4px;
          inset-inline-end: 4px;
          width: 18px;
          height: 18px;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #7DD3FC;
          background: rgba(56,189,248,0.12);
          border: 1px solid rgba(56,189,248,0.28);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.12s ease, background 0.12s ease;
        }
        .cal-hour-slot:hover {
          background: rgba(56,189,248,0.04) !important;
        }
        .cal-hour-slot:hover .cal-hour-slot-plus {
          opacity: 1;
        }
        .cal-month-day-plus {
          position: absolute;
          top: 6px;
          inset-inline-start: 6px;
          width: 20px;
          height: 20px;
          border-radius: 6px;
          border: 1px solid rgba(56,189,248,0.3);
          background: rgba(56,189,248,0.1);
          color: #7DD3FC;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.12s ease;
          z-index: 2;
        }
        .cal-month-day:hover .cal-month-day-plus {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
