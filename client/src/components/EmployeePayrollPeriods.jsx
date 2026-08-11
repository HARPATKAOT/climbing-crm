/**
 * תשלומי העובד לפי חודשים.
 *
 * המסך מחבר שני דברים שעד כה לא נפגשו: מה העובד עבד בחודש (שעות לפי תפקיד,
 * ימי עבודה ונסיעות — מגיע מוכן מהשרת), ומה באמת שולם לו עליו — התלוש או
 * החשבונית, אישור ההעברה, ההפקדה לפנסיה ודף הפיצול.
 *
 * חודש פתוח מציג חישוב חי; חודש סגור מציג את מה שנצרב עליו ברגע הסגירה, ולכן
 * העלאת תעריף היום לא מזיזה משכורת של חודש שעבר.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronLeft, Download, FileText,
  Loader2, Lock, Unlock, Trash2, Upload, Car, CalendarDays,
} from 'lucide-react';
import { roleIcon, roleColor } from '../utils/roleIcons.js';

const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

const monthLabel = (period) => {
  const index = Number(String(period || '').slice(5, 7)) - 1;
  return MONTH_NAMES[index] || period;
};

const money = (value) => `₪${Math.round(Number(value) || 0).toLocaleString()}`;

/**
 * הסכום שמוצג לחודש. לחודשים שיובאו מנושן אין שורות עבודה במערכת, ולכן
 * החישוב מהן יוצא אפס — אבל הסכום ששולם בפועל כן ידוע. במקרה כזה הוא הסכום.
 */
export const displayTotal = (view) => {
  const computed = Number(view?.summary?.total) || 0;
  if (computed > 0) return computed;
  return Number(view?.salary_amount) || 0;
};

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

/**
 * סלוט מסמך אחד. בניגוד לתיק האישי, כאן ההעלאה מיידית ולא ממתינה לשמירת
 * טופס — לחודש אין „שמור”, כל פעולה עומדת בפני עצמה.
 */
function DocSlot({ label, document, busy, onPick, onDownload, onRemove }) {
  const inputRef = useRef(null);
  const [dragDepth, setDragDepth] = useState(0);
  const dragging = dragDepth > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>{label}</span>
      <div
        onDragEnter={(e) => { e.preventDefault(); setDragDepth((d) => d + 1); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
        onDrop={(e) => {
          e.preventDefault();
          setDragDepth(0);
          if (busy) return;
          const file = e.dataTransfer?.files?.[0];
          if (file) onPick(file);
        }}
        style={{
          display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 9, minHeight: 62,
          border: `1px ${dragging || !document ? 'dashed' : 'solid'} ${dragging ? 'var(--blue)' : document ? 'var(--border)' : 'rgba(255,255,255,0.14)'}`,
          background: dragging ? 'rgba(56,189,248,0.10)' : document ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.02)',
          transition: 'background 0.12s, border-color 0.12s',
        }}
      >
        {document ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, minWidth: 0 }}>
            <FileText size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {document.file_name || document.title}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 11.5, color: dragging ? 'var(--blue)' : 'var(--text-3)' }}>
            {dragging ? 'שחררו כאן' : 'חסר — גררו או העלו'}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 'auto' }}>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onPick(file);
            }}
          />
          <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload size={11} /> {document ? 'החלף' : 'העלה'}
          </button>
          {document && (<>
            <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={onDownload}>
              <Download size={11} /> הורד
            </button>
            <button type="button" className="btn btn-ghost btn-xs" disabled={busy} onClick={onRemove}>
              <Trash2 size={11} />
            </button>
          </>)}
        </div>
      </div>
    </div>
  );
}

/** כרטיס חודש אחד. */
function PeriodCard({ view, documentTypes, employeeId, busy, onUpload, onDownload, onRemoveDoc, onSaveFields, onSeal }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({});
  const sealed = view.status === 'sealed';
  const summary = view.summary || {};
  const complete = view.completeness?.complete;

  // הטיוטה מתאפסת כשהשרת מחזיר ערכים חדשים, אחרת עריכה ישנה הייתה נדבקת.
  useEffect(() => {
    setDraft({});
  }, [view.pension_amount, view.salary_amount, view.salary_paid_at, view.pension_paid_at, view.notes]);

  const valueOf = (field) => (field in draft ? draft[field] : (view[field] ?? ''));
  const dirty = Object.keys(draft).length > 0;
  const docByType = useMemo(() => {
    const map = {};
    for (const doc of view.documents || []) map[doc.type] = doc;
    return map;
  }, [view.documents]);

  const missingCount = (view.completeness?.missing?.length || 0)
    + (view.completeness?.missing_pension_amount ? 1 : 0);

  return (
    <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'start',
        }}
      >
        {open ? <ChevronDown size={15} style={{ color: 'var(--text-3)' }} /> : <ChevronLeft size={15} style={{ color: 'var(--text-3)' }} />}
        <span style={{ fontWeight: 800, fontSize: 14 }}>{monthLabel(view.period)}</span>
        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 13 }}>{money(displayTotal(view))}</span>
        {sealed && (
          <span className="badge" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <Lock size={10} /> נסגר
          </span>
        )}
        <span style={{ marginInlineStart: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {complete ? (
            <span className="badge badge-green" style={{ fontSize: 10 }}><Check size={10} /> הושלם</span>
          ) : (
            <span className="badge badge-amber" style={{ fontSize: 10 }}>
              <AlertTriangle size={10} /> חסרים {missingCount}
            </span>
          )}
        </span>
      </button>

      {open && (<>
        {/* פירוט העבודה — מה שהמערכת יודעת בעצמה */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
          {(summary.by_role || []).map((entry) => {
            const EntryIcon = roleIcon(entry.role || entry.label);
            return (
              <div key={entry.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <EntryIcon size={12} style={{ color: roleColor(entry.role || entry.label), flexShrink: 0 }} />
                  {entry.label}
                  <span style={{ color: 'var(--text-3)', fontSize: 11 }}> · {entry.hours} ש׳</span>
                </span>
                <span style={{ color: 'var(--text-2)' }}>{money(entry.amount)}</span>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 12, color: 'var(--text-3)', fontSize: 11, marginTop: 2 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CalendarDays size={11} /> {summary.days || 0} ימי עבודה
            </span>
            {summary.travel > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Car size={11} /> נסיעות {money(summary.travel)}
              </span>
            )}
          </div>
        </div>

        {/* המסמכים שנדרשים מהעובד הזה, ורק הם */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {(view.completeness?.required || []).map((type) => (
            <DocSlot
              key={type}
              label={documentTypes?.[type] || type}
              document={docByType[type]}
              busy={busy}
              onPick={(file) => onUpload(view.period, type, file)}
              onDownload={() => onDownload(docByType[type])}
              onRemove={() => onRemoveDoc(docByType[type])}
            />
          ))}
        </div>

        {/* השדות שמגיעים מבחוץ — מהרואה חשבון ומהבנק */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {view.completeness?.required?.includes('pension_deposit') && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>סכום הפקדה לפנסיה</span>
              <input
                className="input input-sm"
                type="number"
                min="0"
                step="0.01"
                placeholder="₪"
                value={valueOf('pension_amount')}
                onChange={(e) => setDraft((d) => ({ ...d, pension_amount: e.target.value }))}
              />
            </label>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>סכום ששולם בפועל</span>
            <input
              className="input input-sm"
              type="number"
              min="0"
              step="0.01"
              placeholder={summary.total ? String(summary.total) : '₪'}
              value={valueOf('salary_amount')}
              onChange={(e) => setDraft((d) => ({ ...d, salary_amount: e.target.value }))}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>תאריך העברת משכורת</span>
            <input
              className="input input-sm"
              type="date"
              value={valueOf('salary_paid_at')}
              onChange={(e) => setDraft((d) => ({ ...d, salary_paid_at: e.target.value }))}
            />
          </label>
          {view.completeness?.required?.includes('pension_deposit') && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>תאריך הפקדה לפנסיה</span>
              <input
                className="input input-sm"
                type="date"
                value={valueOf('pension_paid_at')}
                onChange={(e) => setDraft((d) => ({ ...d, pension_paid_at: e.target.value }))}
              />
            </label>
          )}
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>הערות</span>
          <input
            className="input input-sm"
            value={valueOf('notes')}
            placeholder="למשל: השלמת פנסיה רטרואקטיבית"
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          />
        </label>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !dirty}
            onClick={() => onSaveFields(view.period, draft)}
          >
            <Check size={13} /> שמור
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => onSeal(view.period, sealed)}
            title={sealed
              ? 'פתיחה מחדש תחזיר את החודש לחישוב חי לפי התעריפים הנוכחיים'
              : 'סגירה צורבת את הסיכום — מכאן הוא לא ישתנה גם אם התעריפים ישתנו'}
          >
            {sealed ? <><Unlock size={13} /> פתח מחדש</> : <><Lock size={13} /> סגור חודש</>}
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>
            {sealed ? 'הסיכום נצרב ולא ישתנה' : 'הסיכום מתעדכן לפי שורות העבודה'}
          </span>
        </div>
      </>)}
    </div>
  );
}

export default function EmployeePayrollPeriods({ employee }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const employeeId = employee?.id;

  const load = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/payroll-periods`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'טעינת התשלומים נכשלה');
      setData(body);
    } catch (err) {
      setError(err.message || 'טעינת התשלומים נכשלה');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err.message || 'הפעולה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const post = async (url, options) => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'הפעולה נכשלה');
    return body;
  };

  const uploadDoc = (period, type, file) => run(async () => {
    const fileBase64 = await readFileAsBase64(file);
    await post(`/api/employees/${encodeURIComponent(employeeId)}/payroll-documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type, period, fileBase64, fileName: file.name, mimeType: file.type || 'application/octet-stream',
      }),
    });
  });

  const removeDoc = (document) => {
    if (!document || !window.confirm(`להסיר את „${document.title || document.file_name}”?`)) return;
    run(() => post(
      `/api/employees/${encodeURIComponent(employeeId)}/payroll-documents/${encodeURIComponent(document.id)}`,
      { method: 'DELETE' },
    ));
  };

  const downloadDoc = async (document) => {
    if (!document) return;
    setError('');
    try {
      const url = `/api/employees/${encodeURIComponent(employeeId)}/payroll-documents/${encodeURIComponent(document.id)}/download`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('הורדת המסמך נכשלה');
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = href;
      anchor.download = document.file_name || 'מסמך';
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err.message || 'הורדת המסמך נכשלה');
    }
  };

  const saveFields = (period, patch) => run(() => post(
    `/api/payroll-periods/${encodeURIComponent(employeeId)}/${encodeURIComponent(period)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) },
  ));

  const seal = (period, sealed) => {
    if (sealed && !window.confirm('לפתוח את החודש מחדש? הסיכום שנצרב יימחק והחודש יחזור לחישוב לפי התעריפים הנוכחיים.')) return;
    run(() => post(
      `/api/payroll-periods/${encodeURIComponent(employeeId)}/${encodeURIComponent(period)}/seal`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reopen: sealed }) },
    ));
  };

  const byYear = useMemo(() => {
    const map = new Map();
    for (const view of data?.periods || []) {
      const year = String(view.period).slice(0, 4);
      map.set(year, [...(map.get(year) || []), view]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  if (!employeeId) {
    return <div style={{ fontSize: 13, color: 'var(--text-3)' }}>שמרו את העובד קודם — ואז יופיעו התשלומים.</div>;
  }
  if (loading && !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)' }}>
        <Loader2 size={15} className="spin" /> טוען תשלומים...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="alert alert-danger" style={{ fontSize: 12 }}>{error}</div>}
      {byYear.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
          עוד אין חודשים לעובד הזה — הם יופיעו כאן ברגע שיירשמו לו שעות עבודה.
        </div>
      )}
      {byYear.map(([year, views]) => (
        <div key={year} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-3)', letterSpacing: 0.4 }}>{year}</div>
          {views.map((view) => (
            <PeriodCard
              key={view.period}
              view={view}
              documentTypes={data?.document_types}
              employeeId={employeeId}
              busy={busy}
              onUpload={uploadDoc}
              onDownload={downloadDoc}
              onRemoveDoc={removeDoc}
              onSaveFields={saveFields}
              onSeal={seal}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
