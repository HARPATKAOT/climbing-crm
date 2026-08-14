import React, { useEffect, useState } from 'react';
import {
  AlertTriangle, Banknote, CheckCircle2, ClipboardCheck, Clock3,
  LogIn, LogOut, Users,
} from 'lucide-react';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function dateLabel(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('he-IL', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function timeLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('he-IL', {
    hour: '2-digit', minute: '2-digit',
  });
}

function DetailSection({ icon: Icon, title, children, accent = 'var(--blue)', order = 0 }) {
  return (
    <section style={{
      padding: 10, borderRadius: 8, border: '1px solid var(--border)',
      background: 'var(--bg-input)', minWidth: 0, order,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7, fontWeight: 800, fontSize: 12 }}>
        <Icon size={14} style={{ color: accent, flexShrink: 0 }} /> {title}
      </div>
      {children}
    </section>
  );
}

function Note({ children }) {
  if (!children) return <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>ללא הערה</div>;
  return (
    <div style={{
      fontSize: 11, lineHeight: 1.4, marginTop: 5, padding: '5px 7px',
      borderRadius: 6, background: 'rgba(255,255,255,0.035)', color: 'var(--text-2)',
      whiteSpace: 'pre-wrap',
    }}>
      {children}
    </div>
  );
}

export default function WallShiftOperationsJournal() {
  const [month, setMonth] = useState(currentMonth);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/shifts/wall-history?month=${encodeURIComponent(month)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'טעינת יומן המשמרות נכשלה');
        return body;
      })
      .then((body) => { if (!cancelled) setEntries(Array.isArray(body.entries) ? body.entries : []); })
      .catch((err) => { if (!cancelled) setError(err.message || 'טעינת יומן המשמרות נכשלה'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14 }}>יומן פתיחות וסגירות קיר</div>
          <div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 3 }}>
            משמרת, קופה ובטיחות — ברשומה אחת לכל יום.
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-3)' }}>
          חודש
          <input
            className="input input-sm"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value || currentMonth())}
            aria-label="חודש ביומן פתיחות וסגירות"
          />
        </label>
      </div>

      {loading && <div className="card card-p" style={{ color: 'var(--text-3)' }}>טוען פתיחות וסגירות...</div>}
      {error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && entries.length === 0 && (
        <div className="card card-p" style={{ color: 'var(--text-3)' }}>אין פתיחות משמרת מתועדות בחודש הזה.</div>
      )}

      {!loading && !error && entries.map((entry) => (
        <article key={entry.id} className="card" style={{ overflow: 'hidden' }}>
          <header style={{
            padding: '10px 13px', borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 900 }}>{dateLabel(entry.date)}</div>
              <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                {timeLabel(entry.opened_at)}–{entry.closed_at ? timeLabel(entry.closed_at) : 'עכשיו'}
                {entry.staff?.length ? ` · ${entry.staff.length} אנשי צוות במשמרת` : ''}
              </div>
            </div>
            <span className={`badge ${entry.status === 'closed' ? 'badge-green' : 'badge-amber'}`}>
              {entry.status === 'closed' ? 'משמרת סגורה' : 'משמרת פתוחה'}
            </span>
          </header>

          <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            <DetailSection icon={LogIn} title="פתיחת משמרת" accent="#38BDF8" order={1}>
              <div style={{ fontSize: 11 }}><strong>{entry.opener?.name || 'לא תועד'}</strong> · {timeLabel(entry.opened_at)}</div>
              <div style={{ marginTop: 6 }}>
                {entry.place_orderly === true && <span className="badge badge-green">המקום דווח כמסודר</span>}
                {entry.place_orderly === false && <span className="badge badge-danger">המקום דווח כלא מסודר</span>}
                {entry.place_orderly == null && <span className="badge">מצב הסדר לא תועד</span>}
              </div>
              <Note>{entry.opening_note}</Note>
            </DetailSection>

            <DetailSection icon={ClipboardCheck} title="בדיקות בטיחות" accent="#A78BFA" order={3}>
              {entry.safety?.length ? entry.safety.map((check) => (
                <div key={check.id} style={{ paddingBottom: 6, marginBottom: 6, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, fontSize: 11 }}>
                    <strong>{check.title}</strong>
                    <span style={{ color: check.status === 'תקין' ? 'var(--green)' : 'var(--amber)', fontWeight: 700 }}>{check.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
                    {check.tester_name} · {timeLabel(check.performed_at)}
                  </div>
                  <Note>{check.notes}</Note>
                </div>
              )) : (
                <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <AlertTriangle size={13} /> לא תועדו בדיקות במשמרת
                </div>
              )}
            </DetailSection>

            <DetailSection icon={Banknote} title="קופה" accent="#34D399" order={2}>
              {entry.cash ? (
                <>
                  <div style={{ fontSize: 11 }}>
                    <strong>פתיחה:</strong> {entry.cash.opened_by_name || 'לא תועד'} · {timeLabel(entry.cash.opened_at)}
                  </div>
                  <Note>{entry.cash.opening_notes}</Note>
                  <div style={{ fontSize: 11, marginTop: 7 }}>
                    <strong>סגירה:</strong>{' '}
                    {entry.cash.closed_at
                      ? `${entry.cash.closed_by_name || 'לא תועד'} · ${timeLabel(entry.cash.closed_at)}`
                      : 'הקופה עדיין פתוחה'}
                  </div>
                  {entry.cash.closed_at && <Note>{entry.cash.closing_notes}</Note>}
                  {entry.cash.discrepancy != null && Number(entry.cash.discrepancy) !== 0 && (
                    <div style={{ color: 'var(--amber)', fontSize: 11, fontWeight: 700, marginTop: 7 }}>
                      {Number(entry.cash.discrepancy) < 0 ? 'חסר בקופה' : 'עודף בקופה'}: ₪
                      {Math.abs(Number(entry.cash.discrepancy)).toLocaleString('he-IL')}
                    </div>
                  )}
                </>
              ) : <div style={{ fontSize: 11, color: 'var(--text-3)' }}>לא נמצאה פתיחת קופה במשמרת</div>}
            </DetailSection>

            <DetailSection icon={LogOut} title="סגירת משמרת" accent="#FB7185" order={4}>
              {entry.closed_at ? (
                <>
                  <div style={{ fontSize: 11 }}><strong>{entry.closer?.name || 'לא תועד'}</strong> · {timeLabel(entry.closed_at)}</div>
                  <div style={{ marginTop: 6 }}>
                    {entry.close_checklist_confirmed
                      ? <span className="badge badge-green"><CheckCircle2 size={11} /> צ׳ק־ליסט סגירה הושלם</span>
                      : <span className="badge">צ׳ק־ליסט לא תועד</span>}
                  </div>
                  <Note>{entry.closing_note}</Note>
                </>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Clock3 size={13} /> המשמרת עדיין פתוחה
                </div>
              )}
            </DetailSection>
          </div>

          {entry.staff?.length > 0 && (
            <footer style={{ borderTop: '1px solid var(--border)', padding: '7px 12px', display: 'flex', gap: 7, alignItems: 'center', fontSize: 10, color: 'var(--text-3)', flexWrap: 'wrap' }}>
              <Users size={13} /> צוות במשמרת:
              {entry.staff.map((person) => <span key={person.employee_id} className="badge">{person.name}</span>)}
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}
