import React, { useState } from 'react';
import { Ban, Loader2, RotateCcw, Send } from 'lucide-react';
import { formatIls } from '../utils/vat.js';

/**
 * ביטול אירוע שלם, יחד עם הכסף.
 *
 * שלושה מסכים בדיאלוג אחד, בסדר שבו ההחלטה באמת נעשית: לאשר את הסכום שחוזר,
 * לראות אותו חוזר, ורק אז להחליט אם להודיע. ההודעה אחרונה ולא אוטומטית בכוונה —
 * אסור שתצא הודעה על זיכוי לפני שהזיכוי עצמו רץ.
 */
export default function CancelActivityDialog({ activity, summary, onClose, onCancelled }) {
  const [stage, setStage] = useState('confirm'); // confirm | working | report
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [notifyState, setNotifyState] = useState(null); // null | 'sending' | תוצאה
  const [current, setCurrent] = useState(summary);

  const refundTotal = Number(current?.refund_total) || 0;
  const registrations = Number(current?.registrations_count) || 0;
  const blocked = current?.blocked || [];
  const unpaid = current?.unpaid || [];

  const runCancel = async () => {
    setStage('working');
    setError('');
    try {
      const res = await fetch(`/api/activities/${activity.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved_amount: refundTotal }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data?.summary) {
        // מישהו נרשם בזמן שהמסך היה פתוח. מציגים את המספר החדש במקום לזכות
        // סכום שאיש לא אישר.
        setCurrent(data.summary);
        setError('הרשימה השתנתה מאז שנפתח המסך. בדוק את הסכום המעודכן ואשר שוב.');
        setStage('confirm');
        return;
      }
      if (!res.ok) throw new Error(data?.error || 'ביטול האירוע נכשל');
      setResult(data);
      setStage('report');
      onCancelled?.(data);
    } catch (err) {
      setError(err.message || 'ביטול האירוע נכשל');
      setStage('confirm');
    }
  };

  const sendNotice = async () => {
    setNotifyState('sending');
    try {
      const res = await fetch(`/api/activities/${activity.id}/notify-cancelled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registration_ids: (result?.cancelled_registrations || []).map(
            (row) => row.registration_id
          ),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'שליחת ההודעות נכשלה');
      setNotifyState(data);
    } catch (err) {
      setNotifyState({ error: err.message || 'שליחת ההודעות נכשלה' });
    }
  };

  const notifyCount = (result?.cancelled_registrations || []).length;

  return (
    <div className="activity-modal-backdrop" onClick={stage === 'working' ? undefined : onClose}>
      <div
        className="activity-modal"
        style={{ maxWidth: 560 }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="activity-modal-header">
          <div className="activity-modal-heading">
            <div className="activity-modal-title-row">
              <div className="activity-modal-title">
                <Ban size={16} style={{ verticalAlign: -2, marginInlineEnd: 6, color: '#F87171' }} />
                ביטול האירוע
              </div>
            </div>
            <div className="activity-modal-subtitle">{activity.name}</div>
          </div>
        </header>

        <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
          {/* אין מה לבטל ואין למי לזכות, אבל יש רישומים שמצביעים על האירוע —
              מחיקה הייתה משאירה אותם בלי הסבר. */}
          {stage === 'confirm' && current?.history_only && refundTotal === 0 && (
            <Note tone="muted">
              אי אפשר למחוק את האירוע: יש לו {current.total_registrations} רישומי הרשמה
              {current.already_cancelled ? ' (האירוע כבר מבוטל)' : ''}. מחיקה הייתה משאירה
              אותם בלי אירוע שיסביר אותם, ואת התשלומים בלי מקור.
            </Note>
          )}

          {stage === 'confirm' && !(current?.history_only && refundTotal === 0) && (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                אי אפשר למחוק אירוע שיש בו נרשמים — ההרשמות והתשלומים היו נשארים בלי
                אירוע שיסביר אותם. במקום זה האירוע יסומן <b>מבוטל</b>: הוא יורד מהאתר
                ומהבוט, מפסיק להיחשב יום פעילות של הקיר, ומקבל צבע אפור ביומן גוגל.
              </div>

              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid var(--border-1)',
                  padding: 14,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <SummaryRow label="נרשמים באירוע" value={String(registrations)} />
                <SummaryRow
                  label="מסמכי זיכוי שיבוטלו"
                  value={String(current?.refund_documents || 0)}
                />
                <SummaryRow label="סכום שיוחזר" value={formatIls(refundTotal)} strong />
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  הזיכוי מלא — כשאנחנו מבטלים, מדרגות מדיניות הביטול לא חלות. הכסף חוזר
                  לכרטיס האשראי וגם מופקת חשבונית זיכוי.
                </div>
              </div>

              {!!unpaid.length && (
                <Note tone="muted">
                  {unpaid.length} נרשמים בלי תשלום — המקום שלהם פשוט משוחרר.
                </Note>
              )}
              {!!blocked.length && (
                <Note tone="warn">
                  <b>{blocked.length} לא ניתן לזכות אוטומטית</b> — ההרשמה תבוטל, אבל את
                  הכסף צריך להחזיר ידנית:
                  <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                    {blocked.map((row) => (
                      <li key={row.registration_id}>{row.name} — {row.reason}</li>
                    ))}
                  </ul>
                </Note>
              )}
              {current?.host_refund && (
                <Note tone="muted">
                  כולל זיכוי דמי הזמנה למזמין — {formatIls(current.host_refund.amount)}.
                </Note>
              )}
              {error && <Note tone="error">{error}</Note>}
            </>
          )}

          {stage === 'working' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0' }}>
              <Loader2 size={18} className="spin" />
              <span style={{ fontSize: 13 }}>מבטל את האירוע ומזכה את הנרשמים…</span>
            </div>
          )}

          {stage === 'report' && result && (
            <>
              <Note tone={result.failed?.length ? 'warn' : 'ok'}>
                האירוע בוטל. {result.refunded?.length || 0} זיכויים בוצעו
                {' '}({formatIls(result.refunded_amount || 0)}).
              </Note>
              {!!result.failed?.length && (
                <Note tone="error">
                  <b>{result.failed.length} זיכויים נכשלו:</b>
                  <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                    {result.failed.map((row, index) => (
                      <li key={index}>{row.names} — {row.error}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="btn activity-modal-btn activity-modal-btn--ghost"
                    style={{ marginTop: 8 }}
                    onClick={runCancel}
                  >
                    <RotateCcw size={14} /> נסה שוב את מה שנכשל
                  </button>
                </Note>
              )}

              <div
                style={{
                  borderTop: '1px solid var(--border-1)',
                  paddingTop: 12,
                  display: 'grid',
                  gap: 8,
                }}
              >
                {!notifyState && (
                  <>
                    <div style={{ fontSize: 13 }}>
                      לשלוח הודעת ביטול ל־{notifyCount} הנרשמים?
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      נשלח בוואטסאפ. מי שחלון 24 השעות שלו סגור יופיע ברשימה נפרדת,
                      ואליו צריך לפנות ידנית.
                    </div>
                    <div>
                      <button
                        type="button"
                        className="btn activity-modal-btn"
                        onClick={sendNotice}
                        disabled={!notifyCount}
                      >
                        <Send size={14} /> שלח הודעה
                      </button>
                    </div>
                  </>
                )}
                {notifyState === 'sending' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <Loader2 size={16} className="spin" /> שולח…
                  </div>
                )}
                {notifyState && notifyState !== 'sending' && (
                  notifyState.error
                    ? <Note tone="error">{notifyState.error}</Note>
                    : (
                      <>
                        <Note tone="ok">נשלחו {notifyState.sent?.length || 0} הודעות.</Note>
                        {!!notifyState.skipped?.length && (
                          <Note tone="warn">
                            <b>{notifyState.skipped.length} לא קיבלו הודעה:</b>
                            <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                              {notifyState.skipped.map((row, index) => (
                                <li key={index}>{row.name} — {row.reason}</li>
                              ))}
                            </ul>
                          </Note>
                        )}
                      </>
                    )
                )}
              </div>
            </>
          )}
        </div>

        <footer className="activity-modal-footer">
          <div className="activity-modal-footer-start" />
          <div className="activity-modal-footer-actions">
            <button
              type="button"
              className="btn activity-modal-btn activity-modal-btn--ghost"
              onClick={onClose}
              disabled={stage === 'working'}
            >
              {stage === 'report' ? 'סגור' : 'חזרה'}
            </button>
            {stage === 'confirm' && !(current?.history_only && refundTotal === 0) && (
              <button
                type="button"
                className="btn activity-modal-btn activity-modal-btn--danger"
                onClick={runCancel}
              >
                <Ban size={14} />
                {refundTotal > 0
                  ? `בטל את האירוע וזכה ${formatIls(refundTotal)}`
                  : 'בטל את האירוע'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong = false }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 700 : 500 }}>{value}</span>
    </div>
  );
}

function Note({ tone = 'muted', children }) {
  const palette = {
    muted: { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.28)', color: 'var(--text-2)' },
    ok: { bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.30)', color: '#6EE7B7' },
    warn: { bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.30)', color: '#FCD34D' },
    error: { bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.30)', color: '#FCA5A5' },
  }[tone];
  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        borderRadius: 10,
        padding: '10px 12px',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}
