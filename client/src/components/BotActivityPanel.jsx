import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * What the bot did, in one place.
 *
 * Each thing it does leaves a trace somewhere else — the placement on the
 * trainee's card, the reply in the conversation, the reminder in its own
 * collection — so "what did the bot do today" had no single answer, and a
 * mistake that repeats had nowhere to become visible.
 *
 * Actions and messages are separated because they are read differently: an
 * action changed a record and deserves an audit, a message was only said.
 */
const KIND_TABS = [
  { key: '', label: 'הכול' },
  { key: 'action', label: 'פעולות' },
  { key: 'message', label: 'הודעות' },
];

function todayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

const RANGES = [
  { key: 'today', label: 'היום', since: todayIso },
  { key: 'week', label: '7 ימים', since: () => new Date(Date.now() - 7 * 864e5).toISOString() },
  { key: 'all', label: 'הכול', since: () => '' },
];

export default function BotActivityPanel() {
  const [kind, setKind] = useState('');
  const [type, setType] = useState('');
  const [range, setRange] = useState('today');
  const [data, setData] = useState({ actions: [], types: [], summary: { byType: {} } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const since = (RANGES.find((r) => r.key === range) || RANGES[0]).since();
      const params = new URLSearchParams();
      if (kind) params.set('kind', kind);
      if (type) params.set('type', type);
      if (since) params.set('since', since);
      const res = await fetch(`/api/bot/activity?${params}`);
      if (!res.ok) throw new Error('טעינה נכשלה');
      setData(await res.json());
    } catch (err) {
      setError(err.message || 'טעינה נכשלה');
    } finally {
      setLoading(false);
    }
  }, [kind, type, range]);

  useEffect(() => { load(); }, [load]);

  const typeMeta = Object.fromEntries((data.types || []).map((t) => [t.type, t]));
  // Only offer a filter for something that actually happened in this range.
  const typesInView = (data.types || []).filter(
    (t) => (!kind || t.kind === kind) && (data.summary?.byType?.[t.type] || t.type === type)
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {KIND_TABS.map((t) => (
            <button
              key={t.key}
              className={`btn btn-sm ${kind === t.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setKind(t.key); setType(''); }}
            >
              {t.label}
              {t.key === 'action' && data.summary?.actions ? ` (${data.summary.actions})` : ''}
              {t.key === 'message' && data.summary?.messages ? ` (${data.summary.messages})` : ''}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginInlineStart: 'auto' }}>
          {RANGES.map((r) => (
            <button
              key={r.key}
              className={`btn btn-sm ${range === r.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={load} title="רענון">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {typesInView.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            className={`btn btn-sm ${type === '' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setType('')}
          >
            כל הסוגים
          </button>
          {typesInView.map((t) => (
            <button
              key={t.type}
              className={`btn btn-sm ${type === t.type ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setType(t.type)}
            >
              {t.icon} {t.label}
              {data.summary?.byType?.[t.type] ? ` (${data.summary.byType[t.type]})` : ''}
            </button>
          ))}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען…</div>
      ) : !data.actions?.length ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '20px 0', textAlign: 'center' }}>
          הבוט לא עשה כלום בטווח הזה.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.actions.map((row) => {
            const meta = typeMeta[row.type] || { icon: '•', label: row.type };
            const when = new Date(row.created_at).toLocaleString('he-IL', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            });
            return (
              <div
                key={row.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '9px 11px',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: row.kind === 'action' ? 'rgba(96,165,250,0.05)' : 'transparent',
                }}
              >
                <span style={{ fontSize: 15, lineHeight: 1.4 }}>{meta.icon}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5 }}>
                    {row.summary}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 3 }}>
                    {when} · {meta.label}
                    {row.parent_name ? ` · ${row.parent_name}` : ''}
                    {row.phone ? ` · ${row.phone}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
