import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CalendarDays, Coins, Download, FileText, Loader2, PiggyBank,
  Trash2, Upload, UserRound,
} from 'lucide-react';
import AppSelect from './AppSelect.jsx';

const STATUS_LABELS = {
  logged: 'בוצעה',
  approved: 'מאושרת',
  planned: 'מתוכננת',
  open: 'פעילה',
  absent: 'היעדרות',
  vacation: 'חופשה',
};

const money = (value) => `₪${Number(value || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
const dateLabel = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('he-IL') : '—';

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

export default function EmployeeSelf({ previewUserId = '', onBack = null }) {
  const readOnlyPreview = Boolean(previewUserId);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({ type: 'other', period: currentMonth, title: '' });
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const endpoint = readOnlyPreview
        ? `/api/settings/users/${encodeURIComponent(previewUserId)}/employee-file?month=${encodeURIComponent(month)}`
        : `/api/me/employee?month=${encodeURIComponent(month)}`;
      const response = await fetch(endpoint);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'טעינת תיק העובד נכשלה');
      setData(body);
    } catch (err) {
      setError(err.message || 'טעינת תיק העובד נכשלה');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [month, previewUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  const documents = useMemo(() => [...(data?.employee?.payroll_documents || [])]
    .sort((a, b) => String(b.period || b.uploaded_at || '').localeCompare(String(a.period || a.uploaded_at || ''))), [data]);

  const upload = async (event) => {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('יש לבחור קובץ');
    setBusy('upload');
    setError('');
    setMessage('');
    try {
      const fileBase64 = await readFile(file);
      const response = await fetch('/api/me/employee/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          fileBase64,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'העלאת המסמך נכשלה');
      if (fileRef.current) fileRef.current.value = '';
      setDraft((current) => ({ ...current, title: '' }));
      setMessage('המסמך נוסף לתיק האישי');
      await load();
    } catch (err) {
      setError(err.message || 'העלאת המסמך נכשלה');
    } finally {
      setBusy('');
    }
  };

  const download = async (document) => {
    setBusy(`download:${document.id}`);
    setError('');
    try {
      const endpoint = readOnlyPreview
        ? `/api/employees/${encodeURIComponent(data?.employee?.id || '')}/payroll-documents/${encodeURIComponent(document.id)}/download`
        : `/api/me/employee/documents/${encodeURIComponent(document.id)}/download`;
      const response = await fetch(endpoint);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'הורדת המסמך נכשלה');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.file_name || document.title || 'מסמך';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'הורדת המסמך נכשלה');
    } finally {
      setBusy('');
    }
  };

  const remove = async (document) => {
    if (!window.confirm(`להסיר את המסמך „${document.title}”?`)) return;
    setBusy(`delete:${document.id}`);
    setError('');
    try {
      const response = await fetch(`/api/me/employee/documents/${encodeURIComponent(document.id)}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'מחיקת המסמך נכשלה');
      setMessage('המסמך הוסר');
      await load();
    } catch (err) {
      setError(err.message || 'מחיקת המסמך נכשלה');
    } finally {
      setBusy('');
    }
  };

  if (loading && !data) return <div className="employee-self-loading"><Loader2 className="spin" /> {readOnlyPreview ? 'טוען את תיק העובד...' : 'טוען את התיק שלך...'}</div>;
  if (!data) return <div className="business-settings-alert is-error">{error || 'תיק העובד לא נמצא'}</div>;

  const employee = data.employee || {};
  const wageRates = data.wage?.rates || [];

  return (
    <div className="employee-self">
      {readOnlyPreview && <div className="employee-self-preview-toolbar">
        <button className="btn btn-ghost btn-sm" type="button" onClick={onBack}><ArrowRight size={15} /> חזרה להרשאות</button>
        <span>תצוגת מנהל · קריאה בלבד</span>
      </div>}
      <section className="employee-self-hero">
        <div className="employee-self-avatar"><UserRound size={26} /></div>
        <div>
          <h2>{employee.name || 'התיק שלי'}</h2>
          <div>{employee.email || ''}</div>
          <div className="employee-self-tags">
            {(employee.certifications || []).map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
      </section>

      <div className="employee-self-stats">
        <article><CalendarDays /><span>שעות בחודש</span><strong>{data.summary?.hours || 0}</strong></article>
        <article><PiggyBank /><span>שכר שנצבר</span><strong>{money(data.summary?.earned)}</strong></article>
        <article><Coins /><span>משמרות שבוצעו</span><strong>{(data.shifts || []).filter((row) => row.status === 'logged').length}</strong></article>
      </div>

      <section className="employee-self-section">
        <div className="employee-self-section-head">
          <div><h3>יומן משמרות ושכר</h3><p>סכומי עבר מבוססים על הסכום שנשמר בזמן ביצוע המשמרת.</p></div>
          <input className="input employee-self-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </div>
        <div className="employee-self-table-wrap">
          <table className="crm-table">
            <thead><tr><th>תאריך</th><th>תפקיד</th><th>שעות</th><th>סטטוס</th><th>שכר</th></tr></thead>
            <tbody>
              {(data.shifts || []).map((shift) => (
                <tr key={shift.key}>
                  <td>{dateLabel(shift.date)}</td>
                  <td><strong>{shift.title}</strong>{shift.subtitle && <small>{shift.subtitle}</small>}</td>
                  <td>{Number(shift.hours || 0).toLocaleString('he-IL')}</td>
                  <td><span className={`employee-shift-status is-${shift.status}`}>{shift.approved ? 'מאושרת' : (STATUS_LABELS[shift.status] || shift.status)}</span></td>
                  <td>{shift.status === 'logged' ? money(shift.pay_amount) : '—'}</td>
                </tr>
              ))}
              {(data.shifts || []).length === 0 && <tr><td colSpan={5} className="business-users-empty">אין משמרות בחודש זה.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="employee-self-section">
        <div className="employee-self-section-head"><div><h3>{readOnlyPreview ? 'הסכם שכר' : 'הסכם השכר שלי'}</h3><p>המידע מוצג לקריאה בלבד.</p></div></div>
        <div className="employee-wage-grid">
          {wageRates.map((rate) => <div key={rate.role}><span>{rate.role}</span><strong>{money(rate.amount)} {rate.mode === 'daily' ? 'ליום' : 'לשעה'}</strong></div>)}
          {data.wage?.travel_per_day > 0 && <div><span>נסיעות ליום</span><strong>{money(data.wage.travel_per_day)}</strong></div>}
          {wageRates.length === 0 && <div className="business-users-empty">לא הוגדר הסכם שכר.</div>}
        </div>
      </section>

      <section className="employee-self-section">
        <div className="employee-self-section-head"><div><h3>מסמכים</h3><p>{readOnlyPreview ? 'המסמכים מוצגים בתצוגה זו לקריאה ולהורדה בלבד.' : 'מסמכי המעסיק הם לקריאה בלבד. ניתן להעלות ולהסיר מסמכים אישיים.'}</p></div></div>
        {!readOnlyPreview && <form className="employee-document-upload" onSubmit={upload}>
          <AppSelect className="input select" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}>
            {Object.entries(data.document_types || {}).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </AppSelect>
          <input className="input" type="month" value={draft.period} onChange={(event) => setDraft((current) => ({ ...current, period: event.target.value }))} />
          <input className="input" placeholder="כותרת למסמך" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
          <input className="input" ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" required />
          <button className="btn btn-primary" disabled={busy === 'upload'}>{busy === 'upload' ? <Loader2 className="spin" size={15} /> : <Upload size={15} />} העלאה</button>
        </form>}
        <div className="employee-document-list">
          {documents.map((document) => (
            <article key={document.id}>
              <FileText />
              <div><strong>{document.title}</strong><span>{document.type_label} · {document.period || 'ללא תקופה'} · {document.source === 'employee' ? (readOnlyPreview ? 'הועלה על ידי העובד' : 'הועלה על ידך') : 'מסמך מעסיק'}</span></div>
              <button className="icon-btn" title="הורדה" onClick={() => download(document)} disabled={busy === `download:${document.id}`}><Download size={16} /></button>
              {!readOnlyPreview && document.source === 'employee' && <button className="icon-btn is-danger" title="הסרה" onClick={() => remove(document)} disabled={busy === `delete:${document.id}`}><Trash2 size={16} /></button>}
            </article>
          ))}
          {documents.length === 0 && <div className="business-users-empty">עדיין לא נשמרו מסמכים בתיק.</div>}
        </div>
      </section>

      {error && <div className="business-settings-alert is-error">{error}</div>}
      {message && <div className="business-settings-alert is-ok">{message}</div>}
    </div>
  );
}
