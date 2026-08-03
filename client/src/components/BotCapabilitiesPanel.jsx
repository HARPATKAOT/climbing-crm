import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * A switch per bot capability.
 *
 * The tools were added one at a time and each went live the moment it was
 * written, so trying a new one was a bet on every conversation at once: the
 * only way to stop it was to turn the whole bot off. Each row here is one
 * capability, saved on the spot — the server is what enforces it, by not
 * offering the model a tool that is switched off.
 */
export default function BotCapabilitiesPanel({ disabled = false }) {
  const [capabilities, setCapabilities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/capabilities');
        const data = await res.json();
        if (!cancelled) setCapabilities(data.capabilities || []);
      } catch {
        if (!cancelled) setError('לא הצלחנו לטעון את היכולות');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = async (key, enabled) => {
    setSavingKey(key);
    setError('');
    // Optimistic, then reconciled with the server's answer: a dependent switch
    // ("register an interest") can be turned off by its parent, and the server
    // is the one that knows.
    setCapabilities((prev) => prev.map((c) => (c.key === key ? { ...c, enabled } : c)));
    try {
      const res = await fetch('/api/whatsapp/capabilities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: { [key]: enabled } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שמירה נכשלה');
      setCapabilities(data.capabilities || []);
    } catch (err) {
      setError(err.message || 'שמירה נכשלה');
      setCapabilities((prev) => prev.map((c) => (c.key === key ? { ...c, enabled: !enabled } : c)));
    } finally {
      setSavingKey('');
    }
  };

  const byKey = Object.fromEntries(capabilities.map((c) => [c.key, c]));

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>מה הבוט מורשה לעשות</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.6 }}>
        כל שורה נשמרת מיד. יכולת כבויה לא נמסרת לבוט בכלל, ולכן הוא לא יציע
        אותה ולא ישתמש בה — גם אם הלקוח יבקש.
      </div>

      {error && (
        <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--red)' }}>{error}</div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {capabilities.map((c) => {
            // A capability whose parent is off is shown off and locked, so the
            // screen never claims something is on while the server disagrees.
            const parentOff = c.requires && byKey[c.requires] && !byKey[c.requires].enabled;
            const rowDisabled = disabled || !!parentOff || savingKey === c.key;
            return (
              <label
                key={c.key}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '10px 8px',
                  borderRadius: 8,
                  cursor: rowDisabled ? 'not-allowed' : 'pointer',
                  opacity: rowDisabled ? 0.5 : 1,
                  background: c.enabled ? 'rgba(37,211,102,0.05)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!c.enabled}
                  disabled={rowDisabled}
                  onChange={(e) => toggle(c.key, e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {c.label}
                    {savingKey === c.key && <Loader2 size={12} className="spin" />}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                    {c.hint}
                    {parentOff ? ' · כבוי כי היכולת שמעליו כבויה' : ''}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
