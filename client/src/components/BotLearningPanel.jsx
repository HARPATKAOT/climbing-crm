import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, ThumbsUp, ThumbsDown, BookOpen } from 'lucide-react';

export default function BotLearningPanel() {
  const [pending, setPending] = useState([]);
  const [learned, setLearned] = useState([]);
  const [stats, setStats] = useState(null);
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [fbRes, learnedRes] = await Promise.all([
        fetch('/api/bot-learning/feedback?status=pending'),
        fetch('/api/bot-learning/learned?all=1'),
      ]);
      const fb = await fbRes.json();
      const ln = await learnedRes.json();
      if (!fbRes.ok) throw new Error(fb.error || 'טעינת תור הלמידה נכשלה');
      if (!learnedRes.ok) throw new Error(ln.error || 'טעינת הדוגמאות נכשלה');
      setPending(Array.isArray(fb.items) ? fb.items : []);
      setStats(fb.stats || null);
      setLearned(Array.isArray(ln.items) ? ln.items : []);
    } catch (err) {
      setError(err.message || 'שגיאה בטעינה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/bot-learning/feedback/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alternative: edits[id] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'אישור נכשל');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  const reject = async (id) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/bot-learning/feedback/${id}/reject`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'דחייה נכשלה');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  const toggleLearned = async (id, active) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/bot-learning/learned/${id}/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'עדכון נכשל');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="card card-p" style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <BookOpen size={18} style={{ color: 'var(--blue)' }} />
        <span className="section-title">תור למידת בוט</span>
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
        תשובות שסומנו «לא טוב» עם חלופה — ממתינות לאישור לפני שהבוט לומד מהן.
      </div>

      {stats && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, fontSize: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ThumbsUp size={14} /> {stats.up} טוב השבוע
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ThumbsDown size={14} /> {stats.down} לא טוב השבוע
          </span>
          <span>{stats.pending} ממתינים לאישור</span>
        </div>
      )}

      {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && <div className="text-muted" style={{ fontSize: 12 }}>טוען...</div>}

      {!loading && pending.length === 0 && (
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>אין פריטים ממתינים.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {pending.map((item) => (
          <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
              שאלת לקוח
            </div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', marginBottom: 8 }}>
              {item.inbound_excerpt || '—'}
            </div>
            {item.reply_excerpt && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>תשובת הבוט</div>
                <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 8, color: 'var(--text-2)' }}>
                  {item.reply_excerpt}
                </div>
              </>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>חלופה מהצוות</div>
            <textarea
              className="input textarea"
              rows={3}
              style={{ fontSize: 12, marginBottom: 8 }}
              value={edits[item.id] != null ? edits[item.id] : (item.alternative || '')}
              onChange={(e) => setEdits((prev) => ({ ...prev, [item.id]: e.target.value }))}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busyId === item.id}
                onClick={() => approve(item.id)}
              >
                <Check size={14} /> אשר לידע
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busyId === item.id}
                onClick={() => reject(item.id)}
              >
                <X size={14} /> דחה
              </button>
            </div>
          </div>
        ))}
      </div>

      {learned.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>דוגמאות מאושרות</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {learned.slice(0, 20).map((row) => (
              <div
                key={row.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 10,
                  opacity: row.active === false ? 0.55 : 1,
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{row.question}</div>
                <div style={{ color: 'var(--text-2)', whiteSpace: 'pre-wrap', marginBottom: 6 }}>{row.answer}</div>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  disabled={busyId === row.id}
                  onClick={() => toggleLearned(row.id, row.active === false)}
                >
                  {row.active === false ? 'הפעל' : 'כבה'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
