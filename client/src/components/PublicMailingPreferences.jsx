import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, Check, Loader2, MailX, ShieldCheck } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { ListIcon } from './broadcastListIcons.jsx';
import './PublicMailingPreferences.css';

const LOCAL_PREVIEW_LISTS = [
  { key: 'operational', label: 'תפעולי', description: 'שינויי שעות, ביטולים ותזכורות', icon: 'bell', subscribed: true },
  { key: 'marketing', label: 'מבצעים ואירועים', description: 'מבצעים, ימי הולדת וערבי טיפוס', icon: 'party', subscribed: true },
];

export default function PublicMailingPreferences() {
  const { token = '' } = useParams();
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'קיר בועז';
  const localPreview = token === 'preview'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const [data, setData] = useState(null);
  const [selection, setSelection] = useState({});
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    if (localPreview) {
      const preview = { recipient: 'לקוח לדוגמה', lists: LOCAL_PREVIEW_LISTS };
      setData(preview);
      setSelection(Object.fromEntries(preview.lists.map((list) => [list.key, true])));
      setStatus('ready');
      return () => { cancelled = true; };
    }
    fetch(`/api/public/mailing-preferences/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'לא הצלחנו לפתוח את הקישור');
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setSelection(Object.fromEntries((body.lists || []).map((list) => [list.key, list.subscribed !== false])));
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error.message);
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [localPreview, token]);

  const subscribedCount = useMemo(
    () => Object.values(selection).filter(Boolean).length,
    [selection]
  );

  async function save(nextSelection = selection) {
    setStatus('saving');
    setMessage('');
    if (localPreview) {
      setData((current) => ({
        ...current,
        lists: (current?.lists || []).map((list) => ({
          ...list,
          subscribed: nextSelection[list.key] !== false,
        })),
      }));
      setSelection(nextSelection);
      setStatus('saved');
      setMessage('העדפות הדיוור נשמרו בהצלחה בתצוגת ההדגמה.');
      return;
    }
    try {
      const response = await fetch(`/api/public/mailing-preferences/${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptions: nextSelection }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'שמירת ההעדפות נכשלה');
      setData(body);
      setSelection(Object.fromEntries((body.lists || []).map((list) => [list.key, list.subscribed !== false])));
      setStatus('saved');
      setMessage('העדפות הדיוור נשמרו בהצלחה.');
    } catch (error) {
      setStatus('ready');
      setMessage(error.message);
    }
  }

  function unsubscribeAll() {
    const next = Object.fromEntries((data?.lists || []).map((list) => [list.key, false]));
    setSelection(next);
    save(next);
  }

  if (status === 'loading') {
    return (
      <main className="mailing-preferences-page" dir="rtl">
        <div className="mailing-preferences-loading" role="status">
          <Loader2 className="mailing-preferences-spinner" aria-hidden="true" />
          <span>טוענים את העדפות הדיוור…</span>
        </div>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="mailing-preferences-page" dir="rtl">
        <section className="mailing-preferences-card mailing-preferences-error" role="alert">
          <MailX aria-hidden="true" />
          <h1>הקישור אינו זמין</h1>
          <p>{message}</p>
          <p>אפשר להשיב „העדפות דיוור” בוואטסאפ ולקבל קישור חדש.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="mailing-preferences-page" dir="rtl">
      <section className="mailing-preferences-card" aria-labelledby="mailing-preferences-title">
        <header className="mailing-preferences-header">
          <span className="mailing-preferences-icon"><BellRing aria-hidden="true" /></span>
          <div>
            <p className="mailing-preferences-eyebrow">{brandName}</p>
            <h1 id="mailing-preferences-title">העדפות דיוור</h1>
            <p>שלום {data?.recipient || ''}, כאן אפשר לבחור אילו עדכונים תרצו לקבל.</p>
          </div>
        </header>

        <div className="mailing-preferences-summary" aria-live="polite">
          <strong>
            {subscribedCount === 0
              ? 'לא יישלח אליכם דיוור'
              : subscribedCount === 1 ? 'רשימה אחת פעילה' : `${subscribedCount} רשימות פעילות`}
          </strong>
          <span>השינוי נשמר בכרטיס הלקוח ומשפיע על הדיוורים הבאים.</span>
        </div>

        <fieldset className="mailing-preferences-list" disabled={status === 'saving'}>
          <legend className="sr-only">בחירת רשימות דיוור</legend>
          {(data?.lists || []).map((list) => {
            const checked = selection[list.key] !== false;
            return (
              <label className={`mailing-preferences-option ${checked ? 'is-checked' : ''}`} key={list.key}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    setSelection((current) => ({ ...current, [list.key]: event.target.checked }));
                    setStatus('ready');
                    setMessage('');
                  }}
                />
                <span className="mailing-preferences-check" aria-hidden="true">
                  {checked ? <Check /> : null}
                </span>
                <span className="mailing-preferences-option-copy">
                  <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ListIcon icon={list.icon} size={15} color={list.color} />
                    {list.label}
                  </strong>
                  <span>{list.description || 'עדכונים מרשימה זו'}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {message ? (
          <div className={`mailing-preferences-notice ${status === 'saved' ? 'is-success' : 'is-error'}`} role="status">
            {status === 'saved' ? <Check aria-hidden="true" /> : null}
            <span>{message}</span>
          </div>
        ) : null}

        <div className="mailing-preferences-actions">
          <button className="mailing-preferences-save" type="button" onClick={() => save()} disabled={status === 'saving'}>
            {status === 'saving' ? <Loader2 className="mailing-preferences-spinner" aria-hidden="true" /> : <Check aria-hidden="true" />}
            {status === 'saving' ? 'שומרים…' : 'שמירת העדפות'}
          </button>
          <button className="mailing-preferences-unsubscribe" type="button" onClick={unsubscribeAll} disabled={status === 'saving' || subscribedCount === 0}>
            <MailX aria-hidden="true" />
            הסרה מכל רשימות הדיוור
          </button>
        </div>

        <footer className="mailing-preferences-footer">
          <ShieldCheck aria-hidden="true" />
          <p>
            הקישור אישי ומאובטח. גם לאחר הסרה מדיוור, ייתכן שיישלחו הודעות שירות חיוניות
            הקשורות להרשמה, תשלום, שינוי פעילות או בטיחות.
          </p>
        </footer>
      </section>
    </main>
  );
}
