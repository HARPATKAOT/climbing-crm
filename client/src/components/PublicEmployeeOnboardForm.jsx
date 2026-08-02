import React, { useEffect, useState } from 'react';
import { CheckCircle } from 'lucide-react';
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
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public/employee-onboard-fields')
      .then((r) => (r.ok ? r.json() : { fields: [] }))
      .then((data) => {
        if (cancelled) return;
        setFields(Array.isArray(data.fields) ? data.fields : []);
      })
      .catch(() => { if (!cancelled) setFields([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const setAnswer = (key, value) => setAnswers((prev) => ({ ...prev, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError('');
    const missing = fields.filter((f) => f.required && !String(answers[f.key] || '').trim());
    if (missing.length) {
      setError(`יש למלא: ${missing.map((f) => f.label).join(', ')}`);
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
      setDone(true);
    } catch {
      setError('שגיאת רשת — נסו שוב');
    } finally {
      setSubmitting(false);
    }
  };

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
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            תודה. הצוות יחזור אליך בהמשך.
          </p>
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

          <ErrorBox message={error} />
          <button type="submit" className="event-primary" disabled={submitting}>
            {submitting ? 'שולח...' : 'שליחת הפרטים'}
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
      `}</style>
    </div>
  );
}
