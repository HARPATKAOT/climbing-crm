import React, { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Link2,
  Unlink,
  CalendarDays,
  Contact,
  MessageCircle,
  Receipt,
  AlertTriangle,
  Bot,
} from 'lucide-react';

/**
 * One place to see and fix every external connection. Each card owns its own
 * status call, so a service that is down never blanks out the others.
 */

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusDot({ state }) {
  const color =
    state === 'ok' ? '#34D399' : state === 'warn' ? '#FBBF24' : state === 'error' ? '#F87171' : '#5A6380';
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  );
}

function IntegrationCard({ icon: Icon, title, state, stateLabel, description, children, rows, alert }) {
  return (
    <section className="business-settings-card">
      <div className="business-settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={16} />
        <span style={{ flex: 1 }}>{title}</span>
        <StatusDot state={state} />
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-3)' }}>{stateLabel}</span>
      </div>

      {description && (
        <div className="business-settings-sub" style={{ marginBottom: 12 }}>
          {description}
        </div>
      )}

      {alert && (
        <div className="business-settings-alert is-error" style={{ display: 'flex', gap: 8 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{alert}</span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>{children}</div>

      {rows?.length > 0 && (
        <div style={{ marginTop: 12, color: 'var(--text-3)', fontSize: 13, lineHeight: 1.9 }}>
          {rows.map(([label, value]) => (
            <div key={label}>
              {label}: {value}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Shared loader for a status endpoint that must never throw into the tree. */
function useStatus(url) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(url);
      setData(await res.json().catch(() => ({})));
    } catch (err) {
      setData({ _fetchError: err.message || 'טעינת המצב נכשלה' });
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, reload };
}

/**
 * A token that Google revoked reads as "connected" in our settings but fails on
 * every call. Surfacing the stored error is the earliest warning we get.
 */
function expiryHint(status) {
  const err = String(status?.error || '');
  if (!err) return null;
  if (/invalid_grant|expired|revoked|unauthorized/i.test(err)) {
    return 'החיבור פג או בוטל בגוגל. יש להתחבר מחדש. אם מסך ההסכמה בגוגל קלאוד במצב Testing, זה יקרה כל 7 ימים עד שיפורסם לפרודקשן.';
  }
  return err;
}

function GoogleCalendarCard() {
  const { data, loading, reload } = useStatus('/api/google-calendar/status');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  if (loading) return <LoadingCard title="יומן גוגל" icon={CalendarDays} />;

  const connect = async () => {
    setBusy('connect');
    try {
      const res = await fetch('/api/google-calendar/auth-url');
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || 'קבלת קישור החיבור נכשלה');
      window.location.href = body.url;
    } catch (err) {
      setMsg(err.message);
      setBusy('');
    }
  };

  const sync = async () => {
    setBusy('sync');
    setMsg('');
    try {
      const res = await fetch('/api/google-calendar/sync', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הסנכרון נכשל');
      setMsg('הסנכרון הסתיים');
      await reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const alert = expiryHint(data);
  const state = !data?.configured ? 'off' : data?.connected ? (alert ? 'warn' : 'ok') : 'off';

  return (
    <IntegrationCard
      icon={CalendarDays}
      title="יומן גוגל"
      state={state}
      stateLabel={!data?.configured ? 'לא מוגדר' : data?.connected ? (alert ? 'דורש טיפול' : 'מחובר') : 'לא מחובר'}
      description="סנכרון דו־כיווני של אירועי היומן — ימי הולדת, טיולים ואירועים."
      alert={alert}
      rows={
        data?.connected
          ? [
              ['חשבון', data.connectedEmail || '—'],
              ['יומן', data.calendarName || '—'],
              ['סנכרון אחרון', formatDateTime(data.lastSyncAt)],
            ]
          : []
      }
    >
      {!data?.configured ? (
        <span style={{ color: 'var(--text-3)', fontSize: 13 }}>חסרים מפתחות גוגל בשרת</span>
      ) : data?.connected && !alert ? (
        <button type="button" className="btn btn-ghost" onClick={sync} disabled={!!busy}>
          {busy === 'sync' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          סנכרון עכשיו
        </button>
      ) : (
        <>
          <button type="button" className="btn btn-primary" onClick={connect} disabled={!!busy}>
            {busy === 'connect' ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}
            {data?.connected ? 'חיבור מחדש' : 'חיבור לחשבון גוגל'}
          </button>
          {data?.connected && (
            <button type="button" className="btn btn-ghost" onClick={sync} disabled={!!busy}>
              {busy === 'sync' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              סנכרון עכשיו
            </button>
          )}
        </>
      )}
      {msg && <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{msg}</span>}
    </IntegrationCard>
  );
}

function GoogleContactsCard() {
  const { data, loading, reload } = useStatus('/api/google-contacts/status');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  if (loading) return <LoadingCard title="אנשי קשר בגוגל" icon={Contact} />;

  const connect = async () => {
    setBusy('connect');
    try {
      const res = await fetch('/api/google-contacts/auth-url');
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || 'קבלת קישור החיבור נכשלה');
      window.location.href = body.url;
    } catch (err) {
      setMsg(err.message);
      setBusy('');
    }
  };

  const sync = async () => {
    setBusy('sync');
    setMsg('');
    try {
      const res = await fetch('/api/google-contacts/sync', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הסנכרון נכשל');
      if (body.skipped) throw new Error('אין חיבור לאנשי הקשר בגוגל');
      const parts = [];
      if (body.created) parts.push(`${body.created} נוספו`);
      if (body.updated) parts.push(`${body.updated} עודכנו`);
      if (body.deleted) parts.push(`${body.deleted} הוסרו`);
      setMsg(parts.length ? `סונכרן: ${parts.join(', ')}` : 'הכל כבר מעודכן');
      await reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    if (!window.confirm('לנתק את אנשי הקשר? מה שכבר נוצר בטלפון יישאר, אבל יפסיק להתעדכן.')) return;
    setBusy('disconnect');
    setMsg('');
    try {
      const res = await fetch('/api/google-contacts/disconnect', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'הניתוק נכשל');
      setMsg('החיבור נותק');
      await reload();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy('');
    }
  };

  const alert = expiryHint(data);
  const stats = data?.lastSyncStats;
  const state = !data?.configured ? 'off' : data?.connected ? (alert ? 'warn' : 'ok') : 'off';

  return (
    <IntegrationCard
      icon={Contact}
      title="אנשי קשר בגוגל"
      state={state}
      stateLabel={!data?.configured ? 'לא מוגדר' : data?.connected ? (alert ? 'דורש טיפול' : 'מחובר') : 'לא מחובר'}
      description="הלקוחות נשמרים בטלפון בשם „סטטוס - הורה - ילדים”, כדי לדעת מי מתקשר. מתאמן עם מספר נפרד נשמר כ„מטפס - שם מלא”."
      alert={alert}
      rows={
        data?.connected
          ? [
              ['חשבון', data.connectedEmail || '—'],
              ['קבוצה', data.contactGroupName || '—'],
              ['סנכרון אחרון', formatDateTime(data.lastSyncAt)],
              ...(stats
                ? [[
                    'במעקב',
                    `${stats.total} אנשי קשר${
                      stats.blockedDeletes ? ` · ${stats.blockedDeletes} מחיקות נעצרו לבדיקה` : ''
                    }`,
                  ]]
                : []),
            ]
          : []
      }
    >
      {!data?.configured ? (
        <span style={{ color: 'var(--text-3)', fontSize: 13 }}>חסרים מפתחות גוגל בשרת</span>
      ) : (
        <>
          {(!data?.connected || alert) && (
            <button type="button" className="btn btn-primary" onClick={connect} disabled={!!busy}>
              {busy === 'connect' ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}
              {data?.connected ? 'חיבור מחדש' : 'חיבור לחשבון גוגל'}
            </button>
          )}
          {data?.connected && (
            <>
              <button type="button" className="btn btn-ghost" onClick={sync} disabled={!!busy}>
                {busy === 'sync' ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                סנכרון עכשיו
              </button>
              <button type="button" className="btn btn-ghost" onClick={disconnect} disabled={!!busy}>
                {busy === 'disconnect' ? <Loader2 size={14} className="spin" /> : <Unlink size={14} />}
                ניתוק
              </button>
            </>
          )}
        </>
      )}
      {msg && <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{msg}</span>}
    </IntegrationCard>
  );
}

function WhatsappCard() {
  const { data, loading } = useStatus('/api/whatsapp/status');
  if (loading) return <LoadingCard title="וואטסאפ" icon={MessageCircle} />;

  return (
    <IntegrationCard
      icon={MessageCircle}
      title="וואטסאפ"
      state={data?.connected ? 'ok' : 'off'}
      stateLabel={data?.connected ? 'מחובר' : 'לא מחובר'}
      description="שליחה וקבלה של הודעות מול Meta. החיבור עצמו נעשה במסך הדיוור."
      rows={
        data?.connected
          ? [
              ['מספר', data.displayPhone || data.phoneNumberId || '—'],
              ['שם מאומת', data.verifiedName || '—'],
              ['חובר בתאריך', formatDateTime(data.connectedAt)],
            ]
          : []
      }
    >
      <a className="btn btn-ghost" href="/broadcasts">
        <MessageCircle size={14} />
        פתיחת מסך הדיוור
      </a>
    </IntegrationCard>
  );
}

/**
 * A missing key on the live server turns every bot conversation into the
 * fallback script, and nothing on screen said so until now. The live check is
 * a button and not automatic, because each press spends a real model call.
 */
function BotEngineCard() {
  const { data, loading } = useStatus('/api/ai/status');
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);

  const runTest = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/ai/status?test=1');
      setTest(await res.json().catch(() => ({ ok: false, error: 'הבדיקה נכשלה' })));
    } catch (err) {
      setTest({ ok: false, error: err.message || 'הבדיקה נכשלה' });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingCard title="מנוע השיחה של הבוט" icon={Bot} />;

  const configured = !!data?.configured;
  const state = !configured ? 'off' : test ? (test.ok ? 'ok' : 'error') : 'warn';
  const stateLabel = !configured
    ? 'לא מוגדר'
    : test
      ? (test.ok ? 'עונה' : 'תקלה')
      : 'מוגדר — לא נבדק';

  return (
    <IntegrationCard
      icon={Bot}
      title="מנוע השיחה של הבוט"
      state={state}
      stateLabel={stateLabel}
      description="המנוע שמנסח את תשובות הבוט בוואטסאפ. בלי מפתח פעיל בשרת הבוט נופל לתשובות גיבוי קבועות."
      alert={!configured ? 'אין מפתח מודל בשרת — הבוט עונה רק מהגיבוי' : (test && !test.ok ? test.error : null)}
      rows={[
        ['דגם מועדף', data?.preferredModel || '—'],
        ...(test?.ok ? [['ענה בפועל', test.model], ['נבדק', formatDateTime(test.testedAt)]] : []),
      ]}
    >
      <button type="button" className="btn btn-ghost" onClick={runTest} disabled={busy}>
        {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
        בדיקת חיבור
      </button>
    </IntegrationCard>
  );
}

function IcountCard() {
  const { data, loading, reload } = useStatus('/api/icount/status');
  if (loading) return <LoadingCard title="iCount" icon={Receipt} />;

  const state = !data?.configured ? 'off' : data?.ok ? 'ok' : 'error';

  return (
    <IntegrationCard
      icon={Receipt}
      title="חיוב וחשבוניות (iCount)"
      state={state}
      stateLabel={!data?.configured ? 'לא מוגדר' : data?.ok ? 'תקין' : 'תקלה'}
      description="קופה, קישורי סליקה וחשבוניות. מוגדר במשתני השרת ולא מהמסך."
      alert={!data?.ok && data?.message ? data.message : null}
    >
      <button type="button" className="btn btn-ghost" onClick={reload}>
        <RefreshCw size={14} />
        בדיקה מחדש
      </button>
    </IntegrationCard>
  );
}

function LoadingCard({ title, icon: Icon }) {
  return (
    <section className="business-settings-card">
      <div className="business-settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={16} />
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)' }}>
        <Loader2 size={16} className="spin" />
        טוען מצב...
      </div>
    </section>
  );
}

export default function Integrations() {
  return (
    <div className="business-settings-grid">
      <GoogleContactsCard />
      <GoogleCalendarCard />
      <WhatsappCard />
      <BotEngineCard />
      <IcountCard />
    </div>
  );
}
