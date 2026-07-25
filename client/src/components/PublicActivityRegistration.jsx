import React, { useEffect, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';

const TYPE_LABELS = {
  birthday: 'יום הולדת',
  trip: 'טיול',
  school: 'בית ספר',
  company: 'חברה',
  route_building: 'בניית מסלולים',
  other: 'אירוע',
};

function slugFromPath(pathname) {
  const match = String(pathname || '').match(/^\/event\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function formatDateHe(iso) {
  if (!iso) return '';
  try {
    const [y, m, d] = String(iso).split('-').map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return dt.toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function PublicActivityRegistration() {
  const { slug: slugParam } = useParams();
  const location = useLocation();
  const slug = slugParam || slugFromPath(location.pathname);
  const [searchParams] = useSearchParams();
  const justPaid = searchParams.get('paid') === '1';

  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    participant_name: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!slug) {
      setLoading(false);
      setError('חסר מזהה אירוע בקישור');
      return undefined;
    }
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/public/activities/${encodeURIComponent(slug)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) setError(data.error || 'הפעילות לא נמצאה');
          return;
        }
        if (!cancelled) setActivity(data);
      } catch {
        if (!cancelled) setError('שגיאת רשת — נסו שוב');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/activities/${encodeURIComponent(slug)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'ההרשמה נכשלה');
        return;
      }
      setDone(data);
      if (data.activity) setActivity(data.activity);
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      }
    } catch {
      setError('שגיאת רשת — נסו שוב');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card" style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={32} className="spin" style={{ color: '#F97316' }} />
          <p style={{ color: 'rgba(255,255,255,0.7)', marginTop: 16 }}>טוען...</p>
        </div>
      </div>
    );
  }

  if (error && !activity) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card" style={{ textAlign: 'center', padding: 40 }}>
          <h1 style={{ color: '#fff', fontSize: 22, marginBottom: 12 }}>לא ניתן להירשם</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (done && !done.paymentUrl) {
    return (
      <div className="public-health-wrapper">
        <div className="glass-card success-card">
          <CheckCircle size={60} color="#F97316" style={{ margin: '0 auto', marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>נרשמתם בהצלחה!</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            {form.participant_name}, ההרשמה ל־{activity?.name} התקבלה.
          </p>
          {form.email && (
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 12 }}>
              אישור נשלח לאימייל (אם הוגדר שליחה בשרת).
            </p>
          )}
        </div>
      </div>
    );
  }

  const timeLine = activity?.all_day
    ? 'יום שלם'
    : [activity?.start_time, activity?.end_time]
      .filter(Boolean)
      .map((t) => String(t).slice(0, 5))
      .join(' – ');

  const accent = activity?.theme?.accent || '#F97316';

  return (
    <div className="public-health-wrapper">
      <form className="glass-card" onSubmit={submit} style={{ maxWidth: 480, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: accent,
            marginBottom: 8,
          }}>
            MY WALL
          </div>
          <h1 style={{ color: '#fff', fontSize: 26, margin: '0 0 8px', fontWeight: 800 }}>
            {activity.page_title || activity.name}
          </h1>
          <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, marginBottom: 12 }}>
            {TYPE_LABELS[activity.type] || TYPE_LABELS.other}
          </div>
          {justPaid && (
            <div style={{
              background: 'rgba(52,211,153,0.15)',
              border: '1px solid rgba(52,211,153,0.35)',
              color: '#6EE7B7',
              padding: '10px 12px',
              borderRadius: 10,
              fontSize: 14,
              marginBottom: 12,
            }}>
              התשלום התקבל — תודה!
            </div>
          )}
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginBottom: 20,
          padding: 14,
          borderRadius: 12,
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.8)',
          fontSize: 14,
        }}>
          {activity.date && <div>{formatDateHe(activity.date)}</div>}
          {timeLine && <div>{timeLine}</div>}
          {activity.location && <div>{activity.location}</div>}
          {activity.page_body && (
            <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.65)' }}>
              {activity.page_body}
            </div>
          )}
          {activity.collect_payment && (
            <div style={{ marginTop: 8, fontWeight: 700, color: '#FDBA74' }}>
              מחיר למשתתף: ₪{Math.round(activity.price)}
            </div>
          )}
          {activity.remaining != null && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              מקומות פנויים: {activity.remaining}
            </div>
          )}
        </div>

        {!activity.registration_open ? (
          <p style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
            ההרשמה לפעילות זו סגורה או שאין מקומות פנויים.
          </p>
        ) : (
          <>
            <label style={labelStyle}>
              שם המשתתף
              <input
                className="input"
                name="participant_name"
                value={form.participant_name}
                onChange={onChange}
                required
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              טלפון
              <input
                className="input"
                name="phone"
                value={form.phone}
                onChange={onChange}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              אימייל
              <input
                className="input"
                type="email"
                name="email"
                value={form.email}
                onChange={onChange}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              הערות
              <textarea
                className="input"
                name="notes"
                value={form.notes}
                onChange={onChange}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </label>

            {error && (
              <div style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(248,113,113,0.15)',
                color: '#FCA5A5',
                fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
              style={{
                width: '100%',
                marginTop: 8,
                padding: '14px 16px',
                fontSize: 16,
                fontWeight: 800,
                background: accent,
                border: 'none',
                borderRadius: 12,
                color: '#fff',
                cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting
                ? 'שולח...'
                : activity.collect_payment
                  ? `הרשמה ומעבר לתשלום ₪${Math.round(activity.price)}`
                  : 'אישור הרשמה'}
            </button>
          </>
        )}
      </form>
      <style>{`
        .public-health-wrapper {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          background:
            radial-gradient(ellipse at 20% 0%, rgba(249,115,22,0.18), transparent 50%),
            radial-gradient(ellipse at 80% 100%, rgba(56,189,248,0.12), transparent 45%),
            #0B1220;
          direction: rtl;
          font-family: 'Heebo', 'Assistant', system-ui, sans-serif;
        }
        .glass-card {
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 28px 24px;
          backdrop-filter: blur(12px);
          box-shadow: 0 24px 60px rgba(0,0,0,0.45);
        }
        .success-card { text-align: center; max-width: 420px; }
        .spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 13,
  color: 'rgba(255,255,255,0.65)',
  marginBottom: 12,
};

const inputStyle = {
  width: '100%',
  background: 'rgba(0,0,0,0.2)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'white',
  padding: '12px 16px',
  borderRadius: 12,
  fontSize: 15,
  fontFamily: 'inherit',
};
