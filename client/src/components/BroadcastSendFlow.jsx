import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  XCircle, PauseCircle, PlayCircle, StopCircle, RefreshCw,
  CheckCircle, Clock, Send, RotateCcw,
} from 'lucide-react';

const ACTIVE_STATUSES = new Set(['countdown', 'scheduled', 'sending', 'paused', 'stopping']);

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
}

/**
 * מרגע הלחיצה על «שלח»: חלון ביטול של 30 שניות, התקדמות חיה עם השהיה
 * ועצירה, ובסוף דוח נשלח/נמסר/נקרא/נכשל עם שליחה חוזרת לנכשלים בלבד.
 * כל המצב נקרא מהשרת — רענון של המסך לא מאבד כלום.
 */
export default function BroadcastSendFlow({ jobId, onExit }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(null);
  const timerRef = useRef(null);
  const currentJobId = useRef(jobId);
  const [activeJobId, setActiveJobId] = useState(jobId);

  const fetchJob = useCallback(async () => {
    const requestedId = activeJobId;
    try {
      const res = await fetch(`/api/broadcast/jobs/${requestedId}`);
      if (!res.ok) throw new Error('טעינת מצב השליחה נכשלה');
      const data = await res.json();
      // אחרי מעבר למשימה אחרת (שליחה חוזרת) — תשובה מאוחרת של המשימה
      // הקודמת לא דורסת את המסך.
      if (currentJobId.current !== requestedId) return null;
      setJob(data);
      return data;
    } catch (err) {
      if (currentJobId.current === requestedId) setError(err.message);
      return null;
    }
  }, [activeJobId]);

  useEffect(() => {
    currentJobId.current = activeJobId;
    let cancelled = false;
    const poll = async () => {
      const data = await fetchJob();
      if (cancelled) return;
      const active = data && ACTIVE_STATUSES.has(data.status);
      timerRef.current = setTimeout(poll, active ? 1200 : 6000);
      if (data && !ACTIVE_STATUSES.has(data.status)) {
        clearTimeout(timerRef.current);
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [activeJobId, fetchJob]);

  // Countdown display is derived from the server's undo_until — a page refresh
  // keeps the true remaining time.
  useEffect(() => {
    if (job?.status !== 'countdown' || !job?.undo_until) {
      setSecondsLeft(null);
      return undefined;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((new Date(job.undo_until).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [job?.status, job?.undo_until]);

  const act = async (action) => {
    setBusy(action);
    setError('');
    try {
      const res = await fetch(`/api/broadcast/jobs/${activeJobId}/${action}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
      await fetchJob();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const resendFailed = async () => {
    setBusy('resend');
    setError('');
    try {
      const res = await fetch(`/api/broadcast/jobs/${activeJobId}/resend-failed`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'השליחה החוזרת נכשלה');
      setActiveJobId(data.jobId);
      setJob(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  if (!job) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-3)', fontSize: 13 }}>
        {error || 'טוען את מצב השליחה…'}
      </div>
    );
  }

  const stats = job.stats || {};
  const total = job.recipient_count || 0;
  const done = (job.sent_count || 0) + (job.failed_count || 0);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="fade-in" style={{ maxWidth: 620, margin: '0 auto', paddingTop: 24 }}>
      {error && <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>}

      {job.status === 'countdown' && (
        <div className="card card-p" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 44, fontWeight: 800, marginBottom: 6 }}>{secondsLeft ?? '…'}</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>השליחה תתחיל בעוד רגע</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            {job.campaign_name} · {job.recipient_count} נמענים · {job.template_display}
          </div>
          <button type="button" className="btn btn-danger" disabled={busy === 'cancel'} onClick={() => act('cancel')}>
            <XCircle size={16} /> עצור, אל תשלח
          </button>
        </div>
      )}

      {job.status === 'scheduled' && (
        <div className="card card-p" style={{ textAlign: 'center' }}>
          <Clock size={40} style={{ color: 'var(--blue)', marginBottom: 8 }} />
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>הדיוור מתוזמן</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
            {job.campaign_name} · {job.recipient_count} נמענים
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
            יישלח ב-{fmtDateTime(job.scheduled_at)}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button type="button" className="btn btn-danger btn-sm" disabled={busy === 'cancel'} onClick={() => act('cancel')}>
              <XCircle size={14} /> ביטול התזמון
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onExit}>
              <Send size={14} /> דיוור חדש
            </button>
          </div>
        </div>
      )}

      {(job.status === 'sending' || job.status === 'paused' || job.status === 'stopping') && (
        <div className="card card-p">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {job.status === 'paused' ? 'השליחה מושהית' : job.status === 'stopping' ? 'עוצר…' : 'שולח…'}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{done} מתוך {total}</span>
          </div>
          <div style={{ height: 10, borderRadius: 6, background: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginBottom: 10 }}>
            <div style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 6,
              background: job.status === 'paused' ? 'var(--amber)' : 'var(--green)',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>
            <span>נשלחו: <strong style={{ color: 'var(--green)' }}>{job.sent_count || 0}</strong></span>
            <span>נכשלו: <strong style={{ color: (job.failed_count || 0) > 0 ? 'var(--red)' : 'inherit' }}>{job.failed_count || 0}</strong></span>
            {job.notes && <span>{job.notes}</span>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {job.status === 'sending' && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => act('pause')}>
                <PauseCircle size={15} /> השהה
              </button>
            )}
            {job.status === 'paused' && (
              <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => act('resume')}>
                <PlayCircle size={15} /> המשך שליחה
              </button>
            )}
            {job.status !== 'stopping' && (
              <button type="button" className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => act('cancel')}>
                <StopCircle size={15} /> עצור לגמרי
              </button>
            )}
          </div>
        </div>
      )}

      {(job.status === 'completed' || job.status === 'stopped' || job.status === 'cancelled') && (
        <div className="card card-p">
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <CheckCircle size={38} style={{ color: job.status === 'completed' ? 'var(--green)' : 'var(--amber)', marginBottom: 6 }} />
            <div style={{ fontSize: 16, fontWeight: 800 }}>
              {job.status === 'completed' ? 'הדיוור הסתיים' : job.status === 'cancelled' ? 'הדיוור בוטל — לא נשלח דבר' : 'הדיוור נעצר'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
              {job.campaign_name} · {job.template_display}
              {job.created_by?.name ? ` · נשלח ע"י ${job.created_by.name}` : ''}
            </div>
          </div>

          {job.status !== 'cancelled' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8, marginBottom: 14 }}>
              {[
                ['נשלחו', (stats.sent || 0) + (stats.delivered || 0) + (stats.read || 0), 'var(--blue)'],
                ['נמסרו', (stats.delivered || 0) + (stats.read || 0), 'var(--green)'],
                ['נקראו', stats.read || 0, 'var(--purple)'],
                ['הגיבו', stats.replied || 0, 'var(--cyan)'],
                // לחיצה על כפתור התבנית («מעוניינים…») — אות העניין החיובי המדיד.
                ...((job.buttonLabels || []).length
                  ? [[`השיבו «${String(job.buttonLabels[0]).slice(0, 14)}»`, stats.buttonReplies || 0, 'var(--green)']]
                  : []),
                ['נכשלו', stats.failed || 0, (stats.failed || 0) > 0 ? 'var(--red)' : 'var(--text-3)'],
                ...(stats.cancelled ? [['בוטלו', stats.cancelled, 'var(--text-3)']] : []),
              ].map(([label, value, color]) => (
                <div key={label} style={{ textAlign: 'center', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 6px' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', lineHeight: 1.3 }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {job.status !== 'cancelled' && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 12, display: 'grid', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--text-3)' }}>רשימת תפוצה</span>
                <strong>{job.list_label || job.list_name || '—'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ color: 'var(--text-3)' }}>נחסמו לפני שליחה</span>
                <strong>{job.suppressed_count ?? 0}</strong>
              </div>
              {job.cost_estimate && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--text-3)' }}>עלות משוערת</span>
                  <strong>
                    {job.cost_estimate.perMessage > 0
                      ? `כ-${Math.round((job.cost_estimate.perMessage * (job.sent_count || 0)) * 100) / 100} דולר (${job.cost_estimate.perMessage}$ להודעה שנשלחה)`
                      : 'ללא עלות (הודעת שירות)'}
                  </strong>
                </div>
              )}
              {(stats.replied || 0) > 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                  «הגיבו» = כל הודעה נכנסת מהנמען עד 72 שעות אחרי השליחה. התשובות עצמן — בשיחות שבכרטיסי הלקוח.
                </div>
              )}
            </div>
          )}

          {Object.keys(job.failureReasons || {}).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>פירוט הכשלים</div>
              {Object.entries(job.failureReasons).map(([reason, count]) => (
                <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', padding: '3px 0' }}>
                  <span>{reason}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 12 }}>
            נתוני נמסר/נקרא ממשיכים להתעדכן מ-Meta — אפשר לרענן.
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={fetchJob}>
              <RefreshCw size={14} /> רענון נתונים
            </button>
            {(stats.failed || 0) > 0 && (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy === 'resend'} onClick={resendFailed}>
                <RotateCcw size={14} /> {busy === 'resend' ? 'יוצר…' : `שליחה חוזרת ל-${stats.failed} הנכשלים`}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onExit}>
              <Send size={14} /> דיוור חדש
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
