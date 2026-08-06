import React, { useState, useEffect, useRef } from 'react';
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
  // What the server last confirmed, so an untouched field is never re-saved.
  const savedValues = useRef({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/capabilities');
        const data = await res.json();
        if (cancelled) return;
        setCapabilities(data.capabilities || []);
        for (const c of data.capabilities || []) {
          if (c.input) savedValues.current[c.input.key] = c.input.value;
        }
      } catch {
        if (!cancelled) setError('לא הצלחנו לטעון את היכולות');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async (key, body, revert) => {
    setSavingKey(key);
    setError('');
    try {
      const res = await fetch('/api/whatsapp/capabilities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שמירה נכשלה');
      setCapabilities(data.capabilities || []);
      for (const c of data.capabilities || []) {
        if (c.input) savedValues.current[c.input.key] = c.input.value;
      }
    } catch (err) {
      setError(err.message || 'שמירה נכשלה');
      if (revert) revert();
    } finally {
      setSavingKey('');
    }
  };

  const toggle = (key, enabled) => {
    // Optimistic, then reconciled with the server's answer: a dependent switch
    // ("register an interest") can be turned off by its parent, and the server
    // is the one that knows.
    setCapabilities((prev) => prev.map((c) => (c.key === key ? { ...c, enabled } : c)));
    return save(key, { capabilities: { [key]: enabled } }, () =>
      setCapabilities((prev) => prev.map((c) => (c.key === key ? { ...c, enabled: !enabled } : c))));
  };

  /** Typing is local; the write happens when the field is left, and only if
   *  the value actually changed — leaving a field alone is not an edit. */
  const setInputValue = (key, value) => setCapabilities((prev) => prev.map(
    (c) => (c.key === key ? { ...c, input: { ...c.input, value } } : c)
  ));

  const saveInput = (capability) => {
    const saved = savedValues.current[capability.input.key];
    const next = capability.input.value;
    if (saved === next) return;
    // The successful response updates savedValues. Keeping the old confirmed
    // value on failure means leaving the field again will retry the save.
    save(capability.key, { values: { [capability.input.key]: next } });
  };

  const byKey = Object.fromEntries(capabilities.map((c) => [c.key, c]));

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>מה הבוט מורשה לעשות</div>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12, lineHeight: 1.6 }}>
        כל שורה נשמרת מיד. יכולת כבויה לא נמסרת לבוט בכלל, ולכן הוא לא יציע
        אותה ולא ישתמש בה — גם אם הלקוח יבקש.
        <br />
        השורה הקטנה מתחת לכל יכולת היא המסך שממנו הנתון נקרא. שם עורכים אותו —
        לא כאן.
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
              <div
                key={c.key}
                style={{
                  padding: '10px 8px',
                  borderRadius: 8,
                  opacity: rowDisabled && !c.input ? 0.5 : 1,
                  background: c.enabled ? 'rgba(37,211,102,0.05)' : 'transparent',
                }}
              >
                {/* The label wraps only the switch: a capability with a field
                    must let you click into the field without flipping it. */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    cursor: rowDisabled ? 'not-allowed' : 'pointer',
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
                    {/* Where the answer comes from, so nobody types a price
                        here that already lives on a screen of its own. */}
                    {c.source && (
                      <div style={{ fontSize: 10.5, color: 'var(--text-3)', opacity: 0.75, marginTop: 2 }}>
                        📄 {c.source}
                      </div>
                    )}
                  </div>
                </label>

                {c.input && (
                  <div style={{ marginTop: 8, marginInlineStart: 28 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>
                      {c.input.label}
                    </div>
                    <input
                      type="text"
                      className="input"
                      dir="ltr"
                      value={c.input.value}
                      placeholder={c.input.placeholder}
                      disabled={disabled || !c.enabled}
                      onChange={(e) => setInputValue(c.key, e.target.value)}
                      onBlur={() => saveInput(c)}
                      style={{ width: '100%', fontSize: 12 }}
                    />
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)', marginTop: 4 }}>
                      {c.input.hint}
                      {!String(c.input.value).trim() && c.enabled
                        ? ' · אין מספר, לכן התהליך לא פעיל בפועל'
                        : ''}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
