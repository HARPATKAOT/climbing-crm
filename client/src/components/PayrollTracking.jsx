/**
 * מעקב תשלומים חודשי — התשובה לשאלה „מי עוד לא קיבל מה שמגיע לו”.
 *
 * טבלה אחת לכל החודש: שורה לעובד, עמודה לכל מסמך שנדרש ממנו. עובד שמקבל
 * בחשבונית לא נמדד על תלוש, ומי שאין לו קופת פנסיה לא נמדד על דף פיצול —
 * לכן תא יכול להיות „יש”, „חסר”, או „לא נדרש”, ורק החסרים נספרים.
 *
 * לצידה תשלום ביטוח לאומי של אותו חודש, שאינו מיוחס לעובד יחיד.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Download, FileText, Loader2, Minus, ShieldCheck, Trash2, Upload,
} from 'lucide-react';
import { displayTotal } from './EmployeePayrollPeriods.jsx';

const TRACKED_TYPES = ['payslip', 'invoice', 'salary_transfer', 'pension_split', 'pension_deposit'];

const SHORT_LABELS = {
  payslip: 'תלוש',
  invoice: 'חשבונית',
  salary_transfer: 'העברת שכר',
  pension_split: 'דף פיצול',
  pension_deposit: 'הפקדת פנסיה',
};

const money = (value) => `₪${Math.round(Number(value) || 0).toLocaleString()}`;

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

async function callJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'הפעולה נכשלה');
  return body;
}

/**
 * תא אחד בטבלה: יש / חסר / לא נדרש ממנו.
 *
 * תא חסר הוא כפתור העלאה, ותא מלא הוא כפתור הורדה — כדי שאפשר יהיה לסגור את
 * החוסר מהטבלה עצמה, בלי לפתוח את כרטיס העובד בשביל כל קובץ.
 */
function Cell({ state, label, busy, onPick, onDownload }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  if (state === 'na') return <Minus size={13} style={{ color: 'var(--text-3)', opacity: 0.4 }} />;

  const missing = state !== 'ok';
  return (
    <>
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
      <button
        type="button"
        disabled={busy}
        title={missing ? `העלאת ${label}` : `הורדת ${label} · העלאה מחדש בגרירה`}
        onClick={() => (missing ? inputRef.current?.click() : onDownload())}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return;
          const file = e.dataTransfer?.files?.[0];
          if (file) onPick(file);
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
          width: 34, height: 26, borderRadius: 7, cursor: busy ? 'default' : 'pointer',
          border: `1px ${dragging ? 'dashed' : 'solid'} ${dragging ? 'var(--blue)' : 'transparent'}`,
          background: dragging ? 'rgba(56,189,248,0.14)' : 'transparent',
          color: 'inherit', padding: 0, opacity: busy ? 0.5 : 1,
        }}
      >
        {missing
          ? <Upload size={13} style={{ color: 'var(--amber, #f59e0b)' }} />
          : <Check size={14} style={{ color: 'var(--green)' }} />}
      </button>
    </>
  );
}

/** ביטוח לאומי של החודש — סכום, תאריך העברה ואישור. */
function NationalInsuranceCard({ month }) {
  const [payment, setPayment] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const body = await callJson(`/api/company-payments?month=${encodeURIComponent(month)}`);
      const found = (body.payments || []).find((row) => row.type === 'national_insurance') || null;
      setPayment(found);
      setDraft({});
    } catch (err) {
      setError(err.message);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const valueOf = (field) => (field in draft ? draft[field] : (payment?.[field] ?? ''));
  const dirty = Object.keys(draft).length > 0;

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

  const save = () => run(() => callJson(
    `/api/company-payments/${encodeURIComponent(month)}/national_insurance`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: valueOf('amount'), paid_at: valueOf('paid_at'), notes: valueOf('notes'),
      }),
    },
  ));

  // הקובץ נתלה על שורת תשלום קיימת, ולכן אם עוד לא נשמרה — שומרים אותה קודם.
  const upload = (file) => run(async () => {
    let target = payment;
    if (!target) {
      target = await callJson(
        `/api/company-payments/${encodeURIComponent(month)}/national_insurance`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: valueOf('amount'), paid_at: valueOf('paid_at'), notes: valueOf('notes') }),
        },
      );
    }
    const fileBase64 = await readFileAsBase64(file);
    await callJson(`/api/company-payments/${encodeURIComponent(target.id)}/document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileBase64, fileName: file.name, mimeType: file.type || 'application/octet-stream' }),
    });
  });

  const download = async () => {
    try {
      const response = await fetch(`/api/company-payments/${encodeURIComponent(payment.id)}/document/download`);
      if (!response.ok) throw new Error('הורדת המסמך נכשלה');
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = href;
      anchor.download = payment.document?.file_name || 'ביטוח-לאומי';
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ShieldCheck size={15} style={{ color: 'var(--blue)' }} />
        <span style={{ fontWeight: 800, fontSize: 14 }}>ביטוח לאומי</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>לכל העובדים · תשלום אחד לחודש</span>
      </div>
      {error && <div className="alert alert-danger" style={{ fontSize: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>סכום</span>
          <input
            className="input input-sm" type="number" min="0" step="0.01" placeholder="₪"
            value={valueOf('amount')}
            onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>תאריך העברה</span>
          <input
            className="input input-sm" type="date"
            value={valueOf('paid_at')}
            onChange={(e) => setDraft((d) => ({ ...d, paid_at: e.target.value }))}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600 }}>הערות</span>
          <input
            className="input input-sm"
            value={valueOf('notes')}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-sm" disabled={busy || !dirty} onClick={save}>
          <Check size={13} /> שמור
        </button>
        <input
          ref={inputRef} type="file" style={{ display: 'none' }}
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload(file);
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={13} /> {payment?.document ? 'החלף אישור' : 'העלה אישור'}
        </button>
        {payment?.document && (<>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={download}>
            <Download size={13} /> הורד
          </button>
          <button
            type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => run(() => callJson(`/api/company-payments/${encodeURIComponent(payment.id)}/document`, { method: 'DELETE' }))}
          >
            <Trash2 size={13} />
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FileText size={11} /> {payment.document.file_name}
          </span>
        </>)}
      </div>
    </div>
  );
}

export default function PayrollTracking({ month, onOpenEmployee }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(true);

  const load = useCallback(async () => {
    setError('');
    const body = await callJson(`/api/payroll-periods?month=${encodeURIComponent(month)}`);
    setData(body);
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) => { if (!cancelled) setError(err.message || 'טעינת המעקב נכשלה'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  /** העלאת מסמך ישירות מהטבלה, בלי לפתוח את כרטיס העובד. */
  const uploadCell = async (employeeId, type, file) => {
    setBusy(true);
    setError('');
    try {
      const fileBase64 = await readFileAsBase64(file);
      await callJson(`/api/employees/${encodeURIComponent(employeeId)}/payroll-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, period: month, fileBase64, fileName: file.name, mimeType: file.type || 'application/octet-stream',
        }),
      });
      await load();
    } catch (err) {
      setError(err.message || 'העלאת המסמך נכשלה');
    } finally {
      setBusy(false);
    }
  };

  const downloadCell = async (employeeId, document) => {
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
      setError(err.message);
    }
  };

  const rows = useMemo(() => {
    const all = data?.periods || [];
    // עובד בלי עבודה ובלי מסמכים בחודש הזה אינו „חסר” — הוא פשוט לא עבד.
    const relevant = all.filter((view) => displayTotal(view) > 0 || (view.documents?.length || 0) > 0);
    return onlyMissing ? relevant.filter((view) => !view.completeness?.complete) : relevant;
  }, [data, onlyMissing]);

  const incomplete = (data?.periods || [])
    .filter((view) => displayTotal(view) > 0 && !view.completeness?.complete).length;

  if (loading && !data) {
    return (
      <div className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)' }}>
        <Loader2 size={15} className="spin" /> טוען מעקב תשלומים...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              מעקב תשלומים
              {incomplete > 0 && (
                <span className="badge badge-amber" style={{ fontSize: 10, marginInlineStart: 8 }}>
                  {incomplete} לא הושלמו
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              מי קיבל את התלוש, את ההעברה ואת הפנסיה. לחיצה על ⚠️ מעלה את הקובץ החסר
              (או גררו אותו לתא), לחיצה על ✓ מורידה אותו. לחיצה על שם פותחת את כרטיס העובד.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[[true, 'רק חסרים'], [false, 'הכל']].map(([value, label]) => (
              <button
                key={String(value)}
                type="button"
                className="btn btn-xs"
                onClick={() => setOnlyMissing(value)}
                style={{
                  background: onlyMissing === value ? 'rgba(56,189,248,0.15)' : 'transparent',
                  color: onlyMissing === value ? 'var(--blue)' : 'var(--text-3)',
                  border: '1px solid var(--border)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="alert alert-danger" style={{ fontSize: 12 }}>{error}</div>}

        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            {onlyMissing ? 'כל התשלומים בחודש הזה הושלמו.' : 'אף עובד לא עבד בחודש הזה.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
              <thead>
                <tr style={{ color: 'var(--text-3)', fontSize: 11 }}>
                  <th style={{ textAlign: 'start', padding: '6px 8px' }}>עובד</th>
                  <th style={{ textAlign: 'start', padding: '6px 8px' }}>סה״כ</th>
                  {TRACKED_TYPES.map((type) => (
                    <th key={type} style={{ textAlign: 'center', padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {SHORT_LABELS[type]}
                    </th>
                  ))}
                  <th style={{ textAlign: 'center', padding: '6px 8px', whiteSpace: 'nowrap' }}>סכום פנסיה</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((view) => {
                  const required = new Set(view.completeness?.required || []);
                  const present = new Set(view.completeness?.present || []);
                  const docByType = Object.fromEntries((view.documents || []).map((doc) => [doc.type, doc]));
                  return (
                    <tr key={view.employee_id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '7px 8px' }}>
                        <button
                          type="button"
                          onClick={() => onOpenEmployee?.(view.employee_id)}
                          style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            color: 'var(--text-1)', font: 'inherit', fontWeight: 700, textAlign: 'start',
                          }}
                        >
                          {view.employee_name}
                        </button>
                      </td>
                      <td style={{ padding: '7px 8px', color: 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {money(displayTotal(view))}
                      </td>
                      {TRACKED_TYPES.map((type) => (
                        <td key={type} style={{ padding: '7px 8px', textAlign: 'center' }}>
                          <Cell
                            state={!required.has(type) ? 'na' : present.has(type) ? 'ok' : 'missing'}
                            label={SHORT_LABELS[type]}
                            busy={busy}
                            onPick={(file) => uploadCell(view.employee_id, type, file)}
                            onDownload={() => downloadCell(view.employee_id, docByType[type])}
                          />
                        </td>
                      ))}
                      <td style={{ padding: '7px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {!required.has('pension_deposit')
                          ? <Minus size={13} style={{ color: 'var(--text-3)', opacity: 0.4 }} />
                          : view.pension_amount
                            ? <span style={{ color: 'var(--text-2)' }}>{money(view.pension_amount)}</span>
                            : (
                              // הסכום מוקלד בכרטיס העובד, ולכן התג מוביל לשם.
                              <button
                                type="button"
                                title="הזנת סכום ההפקדה בכרטיס העובד"
                                onClick={() => onOpenEmployee?.(view.employee_id)}
                                style={{
                                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                                  display: 'inline-flex', alignItems: 'center',
                                }}
                              >
                                <AlertTriangle size={13} style={{ color: 'var(--amber, #f59e0b)' }} />
                              </button>
                            )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <NationalInsuranceCard month={month} />
    </div>
  );
}
