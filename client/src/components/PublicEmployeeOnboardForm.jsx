import React, { useEffect, useState } from 'react';
import { CheckCircle, ExternalLink, Paperclip, X } from 'lucide-react';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { EventStyles } from './publicFormKit.jsx';
import GenderPicker from './GenderPicker.jsx';
import AppSelect from './AppSelect.jsx';

function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
      color: '#FCA5A5', padding: 12, borderRadius: 12, marginBottom: 12, fontSize: 14,
    }}>
      {message}
    </div>
  );
}

function ageFrom(birthDateStr) {
  if (!birthDateStr) return null;
  const birth = new Date(birthDateStr);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

/**
 * תנאי הצגה של מסמך, מתוך התשובות שכבר מולאו. כשהנתון עוד חסר התנאי נכשל —
 * עדיף לא לבקש אישור משטרה מנערה מאשר לבקש אותו מכולם עד שימלאו מין וגיל.
 */
function docVisible(doc, answers) {
  const when = doc?.when;
  if (!when) return true;
  if (when.gender && String(answers?.gender || '') !== when.gender) return false;
  if (when.minAge != null) {
    const age = ageFrom(answers?.birthDate);
    if (age == null || age < when.minAge) return false;
  }
  return true;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

/**
 * Which fields appear, and whether each is required, comes from the server —
 * an admin editing the form in the Employees screen must change what a new
 * hire sees without a client deploy.
 */
export default function PublicEmployeeOnboardForm() {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '/logo.png';
  const [fields, setFields] = useState([]);
  const [docs, setDocs] = useState([]);
  const [form101Url, setForm101Url] = useState('');
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({});
  // קובץ אחד לכל שדה מסמך, ולתעודות רשימה — למדריך יש בדרך כלל כמה.
  const [files, setFiles] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [docWarning, setDocWarning] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/employee-onboard-fields')
      .then((r) => (r.ok ? r.json() : { fields: [] }))
      .then((data) => {
        if (cancelled) return;
        setFields(Array.isArray(data.fields) ? data.fields : []);
        setDocs(Array.isArray(data.docs) ? data.docs : []);
        setForm101Url(typeof data.form101Url === 'string' ? data.form101Url : '');
      })
      .catch(() => { if (!cancelled) setFields([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const setAnswer = (key, value) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const addFiles = (key, picked, multiple) => {
    const list = Array.from(picked || []);
    if (!list.length) return;
    setFiles((prev) => ({
      ...prev,
      [key]: multiple ? [...(prev[key] || []), ...list] : [list[0]],
    }));
  };

  const removeFile = (key, index) => {
    setFiles((prev) => ({ ...prev, [key]: (prev[key] || []).filter((_, i) => i !== index) }));
  };

  /**
   * הקבצים נשלחים אחד-אחד אחרי שהכרטיס נוצר: תמונת תעודה מהטלפון גדולה,
   * ושליחה של הכול בבקשה אחת הייתה נחסמת על גודל.
   */
  const uploadFiles = async (token, visible) => {
    const queue = [];
    visible.forEach((doc) => {
      (files[doc.key] || []).forEach((file, index) => {
        // הראשונה נשמרת במפתח המקורי, הנוספות כ-certificate_2, certificate_3…
        const docType = index === 0 ? doc.key : `certificate_${index + 1}`;
        queue.push({ docType, file, label: doc.label });
      });
    });
    const failed = [];
    for (let i = 0; i < queue.length; i += 1) {
      const item = queue[i];
      setProgress(`מעלה קבצים ${i + 1}/${queue.length}...`);
      try {
        const fileBase64 = await readFileAsDataUrl(item.file);
        const res = await fetch('/api/public/employee-onboard/documents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token,
            docType: item.docType,
            fileBase64,
            fileName: item.file.name,
            mimeType: item.file.type || 'application/octet-stream',
          }),
        });
        if (!res.ok) failed.push(item.file.name);
      } catch {
        failed.push(item.file.name);
      }
    }
    setProgress('');
    return failed;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    const missing = fields.filter((f) => f.required && !String(answers[f.key] || '').trim());
    if (missing.length) {
      setError(`יש למלא: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    // רק המסמכים שמוצגים כרגע נשלחים — מי שצירף אישור משטרה ואז שינה את המין
    // או את תאריך הלידה, הקובץ שלו כבר לא רלוונטי.
    const visible = docs.filter((doc) => docVisible(doc, answers));
    const tooBig = visible.flatMap((d) => files[d.key] || []).find((f) => f.size > 10 * 1024 * 1024);
    if (tooBig) {
      setError(`הקובץ "${tooBig.name}" גדול מ-10MB — צרפו קובץ קטן יותר`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/employee-onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'שליחת הפרטים נכשלה');
        return;
      }
      if (data.uploadToken) {
        const failed = await uploadFiles(data.uploadToken, visible);
        if (failed.length) {
          setDocWarning(`הפרטים נשמרו, אבל הקבצים הבאים לא נקלטו: ${failed.join(', ')}. הצוות יבקש אותם שוב.`);
        }
      }
      setDone(true);
    } catch {
      setError('שגיאת רשת — נסו שוב');
    } finally {
      setSubmitting(false);
    }
  };

  const visibleDocs = docs.filter((doc) => docVisible(doc, answers));

  if (loading) {
    return (
      <div className="event-page">
        <div className="event-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>טוען טופס...</p>
        </div>
        <EventStyles />
      </div>
    );
  }

  if (done) {
    return (
      <div className="event-page">
        <div className="event-card event-centered">
          <CheckCircle size={60} color="#F97316" style={{ margin: '0 auto', marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>הפרטים התקבלו!</h1>
          {docWarning ? (
            <p style={{ color: '#FCA5A5', fontSize: 14, marginBottom: 12 }}>{docWarning}</p>
          ) : null}
          {/* טופס 101 נחתם באתר חיצוני ולא כאן — זה השלב האחרון של הקליטה. */}
          {form101Url ? (
            <>
              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 15, marginBottom: 16 }}>
                נשאר שלב אחד: מילוי וחתימה על טופס 101.
              </p>
              <a
                className="event-primary"
                href={form101Url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', textDecoration: 'none', textAlign: 'center' }}
              >
                למילוי טופס 101 <ExternalLink size={16} style={{ verticalAlign: 'middle' }} />
              </a>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 14 }}>
                תודה. הצוות יחזור אליך בהמשך.
              </p>
            </>
          ) : (
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
              תודה. הצוות יחזור אליך בהמשך.
            </p>
          )}
        </div>
        <EventStyles />
      </div>
    );
  }

  return (
    <div className="event-page">
      <div className="event-card">
        <div className="employee-form-header">
          <div className="employee-logo-circle">
            <img src={brandLogo} alt={brandName} />
          </div>
          <h2>קליטת עובד/ת חדש/ה</h2>
          <p>מילוי פרטים ל{brandName}</p>
        </div>

        <form onSubmit={submit} className="employee-form-body">
          {fields.map((f) => (
            <div className="form-group" key={f.key}>
              <label>{f.label}{f.required ? ' *' : ''}</label>
              {/* מין נבחר בכפתורים עם סמלים, כמו בטפסי הלקוחות. הערכים באים
                  מקטלוג השדות („זכר” / „נקבה”) ולא מומצאים כאן. */}
              {f.key === 'gender' && (f.options || []).length === 2 ? (
                <GenderPicker
                  value={answers[f.key] || ''}
                  onChange={(value) => setAnswer(f.key, value)}
                  options={f.options.map((opt) => [opt, opt])}
                />
              ) : f.type === 'select' ? (
                <AppSelect
                  value={answers[f.key] || ''}
                  onChange={(e) => setAnswer(f.key, e.target.value)}
                >
                  <option value="">בחרו...</option>
                  {(f.options || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </AppSelect>
              ) : f.type === 'textarea' ? (
                <textarea
                  rows={3}
                  value={answers[f.key] || ''}
                  onChange={(e) => setAnswer(f.key, e.target.value)}
                />
              ) : (
                <input
                  type={f.type === 'tel' ? 'tel' : f.type}
                  value={answers[f.key] || ''}
                  onChange={(e) => setAnswer(f.key, e.target.value)}
                />
              )}
            </div>
          ))}

          {visibleDocs.length > 0 && (
            <div className="onboard-docs">
              <h3>מסמכים</h3>
              <p className="onboard-docs-hint">
                אפשר לצרף עכשיו או לשלוח לצוות בהמשך. תמונה ברורה מהטלפון מספיקה.
              </p>
              {visibleDocs.map((doc) => (
                <div className="form-group" key={doc.key}>
                  <label>{doc.label}{doc.multiple ? ' (אפשר כמה)' : ''}</label>
                  <label className="onboard-file-btn">
                    <Paperclip size={15} />
                    <span>{doc.multiple ? 'הוספת קובץ' : 'בחירת קובץ'}</span>
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      multiple={!!doc.multiple}
                      onChange={(e) => { addFiles(doc.key, e.target.files, doc.multiple); e.target.value = ''; }}
                    />
                  </label>
                  {(files[doc.key] || []).map((file, index) => (
                    <div className="onboard-file-row" key={`${file.name}-${index}`}>
                      <span>{file.name}</span>
                      <button type="button" onClick={() => removeFile(doc.key, index)} aria-label="הסרה">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <ErrorBox message={error} />
          <button type="submit" className="event-primary" disabled={submitting}>
            {submitting ? (progress || 'שולח...') : 'שליחת הפרטים'}
          </button>
        </form>
      </div>
      <EventStyles />
      <style>{`
        .employee-form-header { text-align: center; padding: 22px 24px 0; }
        .employee-logo-circle {
          width: 60px; height: 60px; border-radius: 50%; background: #fff;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 14px; overflow: hidden;
        }
        .employee-logo-circle img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .employee-form-header h2 { margin: 0 0 6px; padding: 0; font-size: 22px; font-weight: 800; }
        .employee-form-header p { margin: 0; font-size: 13px; color: #94a3b8; }
        .employee-form-body { padding: 20px 24px 0; }
        .employee-form-body .form-group { margin-bottom: 14px; }
        .employee-form-body label { display: block; margin-bottom: 6px; font-size: 14px; color: #cbd5e1; }
        .employee-form-body input, .employee-form-body select, .employee-form-body textarea {
          width: 100%; padding: 12px 14px; border-radius: 11px;
          border: 1px solid rgba(255,255,255,.15); background: #0b1220;
          color: #fff; font: inherit;
        }
        .employee-form-body input:focus, .employee-form-body select:focus { outline: none; border-color: #f97316; }
        .employee-form-body select option { background: #0b1220; color: #fff; }
        .employee-form-body .event-primary { width: 100%; margin-top: 6px; }
        .onboard-docs { margin-top: 22px; border-top: 1px solid rgba(255,255,255,.12); padding-top: 16px; }
        .onboard-docs h3 { margin: 0 0 4px; font-size: 16px; font-weight: 800; color: #fff; }
        .onboard-docs-hint { margin: 0 0 14px; font-size: 13px; color: #94a3b8; }
        .onboard-file-btn {
          display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
          padding: 9px 14px; border-radius: 11px; font-size: 14px; color: #cbd5e1;
          border: 1px dashed rgba(255,255,255,.25); background: rgba(255,255,255,.04);
        }
        .onboard-file-btn:hover { border-color: #f97316; color: #fff; }
        .onboard-file-btn input { display: none; }
        .onboard-file-row {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          margin-top: 8px; padding: 8px 12px; border-radius: 10px;
          background: rgba(249,115,22,.12); font-size: 13px; color: #fdba74;
        }
        .onboard-file-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .onboard-file-row button {
          background: none; border: none; color: #fdba74; cursor: pointer;
          display: flex; padding: 2px; flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
