import { useEffect, useRef, useState } from 'react';
import { Loader2, Check } from 'lucide-react';

/**
 * One group of bot settings, saved on its own.
 *
 * The bot screen used to be a single form with one button at the bottom, which
 * sent the whole settings object — so saving a reply text also re-wrote the
 * opening hours, and a change made in another tab in the meantime was quietly
 * overwritten. A card sends only the keys it owns.
 *
 * The save button appears only once something in this card actually changed,
 * so a screen full of cards is not a screen full of buttons.
 */
export default function BotSettingsCard({ title, hint, keys = [], settings, children }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  // What the server last confirmed for these keys. Null until the settings
  // have arrived — an empty object must not read as "everything was cleared".
  const baseline = useRef(null);
  const savedTimer = useRef(null);

  const snapshot = (source) => JSON.stringify(
    Object.fromEntries(keys.map((key) => [key, source?.[key] ?? null]))
  );

  const hasSettings = !!settings && Object.keys(settings).length > 0;

  useEffect(() => {
    if (hasSettings && baseline.current === null) baseline.current = snapshot(settings);
  }, [hasSettings, settings]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const dirty = baseline.current !== null && baseline.current !== snapshot(settings);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = {};
      for (const key of keys) {
        if (settings?.[key] !== undefined) body[key] = settings[key];
      }
      const res = await fetch('/api/whatsapp/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'שמירת ההגדרות נכשלה');
      }
      baseline.current = snapshot(settings);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.message || 'שמירת ההגדרות נכשלה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: hint ? 4 : 10,
      }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        {dirty ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {saving && <Loader2 size={13} className="spin" />}
            {saving ? 'שומר…' : 'שמור'}
          </button>
        ) : saved ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--green)' }}>
            <Check size={13} /> נשמר
          </span>
        ) : null}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.6 }}>
          {hint}
        </div>
      )}
      {error && (
        <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--red)' }}>{error}</div>
      )}
      {children}
    </div>
  );
}
