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
  Settings2,
  ArrowRight,
} from 'lucide-react';
import ChannelConnections from './ChannelConnections';

/**
 * One place to see and fix every external connection. Each card owns its own
 * status call, so a service that is down never blanks out the others.
 */

/*
 * Brand marks are drawn inline: the icon set is monochrome, and at a glance a
 * row of identical grey glyphs tells you nothing about which service you are
 * looking at. Drawing them here also keeps the page free of outside requests.
 */
function BrandMark({ children, bg }) {
  return (
    <span
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        background: bg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

function WhatsappMark() {
  return (
    <BrandMark bg="#25D366">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.64-1.03-5.13-2.9-7A9.82 9.82 0 0 0 12.04 2Zm0 18.13a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.05-.2-.31a8.19 8.19 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.24-8.23a8.2 8.2 0 0 1 8.23 8.24c0 4.54-3.69 8.23-8.23 8.23Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.09-.16.04-.31-.02-.44-.06-.12-.56-1.35-.77-1.84-.2-.49-.4-.42-.56-.43h-.47c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.13.17 1.74 2.66 4.22 3.73.59.25 1.05.4 1.4.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
      </svg>
    </BrandMark>
  );
}

function MessengerMark() {
  return (
    <BrandMark bg="linear-gradient(45deg,#0099FF,#A033FF 60%,#FF5280)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M12 2C6.3 2 2 6.2 2 11.8c0 3.2 1.4 6 3.7 7.8v3.8l3.4-1.9c.9.25 1.9.4 2.9.4 5.7 0 10-4.2 10-9.8S17.7 2 12 2Zm1 12.2-2.5-2.7-4.9 2.7 5.4-5.7 2.6 2.7 4.8-2.7-5.4 5.7Z" />
      </svg>
    </BrandMark>
  );
}

function InstagramMark() {
  return (
    <BrandMark bg="linear-gradient(45deg,#F9CE34,#EE2A7B 50%,#6228D7)">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.3" cy="6.7" r="1.2" fill="#fff" stroke="none" />
      </svg>
    </BrandMark>
  );
}

function GoogleCalendarMark() {
  return (
    <BrandMark bg="#fff">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#DADCE0" />
        <path d="M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v1H3V7Z" fill="#4285F4" />
        <rect x="3" y="17" width="18" height="4" rx="0" fill="#34A853" opacity="0.9" />
        <text x="12" y="16" textAnchor="middle" fontSize="8" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">31</text>
      </svg>
    </BrandMark>
  );
}

function GoogleContactsMark() {
  return (
    <BrandMark bg="#fff">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="9" r="3.4" fill="#4285F4" />
        <path d="M5.5 19c0-3.2 2.9-5.2 6.5-5.2s6.5 2 6.5 5.2v.6h-13V19Z" fill="#34A853" />
        <rect x="2.6" y="5" width="1.6" height="3" rx="0.8" fill="#FBBC05" />
        <rect x="2.6" y="10.5" width="1.6" height="3" rx="0.8" fill="#EA4335" />
        <rect x="2.6" y="16" width="1.6" height="3" rx="0.8" fill="#4285F4" />
      </svg>
    </BrandMark>
  );
}

function GeminiMark() {
  return (
    <BrandMark bg="linear-gradient(135deg,#4285F4,#9B72CB 55%,#D96570)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M12 2c.4 4.9 5.1 9.6 10 10-4.9.4-9.6 5.1-10 10-.4-4.9-5.1-9.6-10-10 4.9-.4 9.6-5.1 10-10Z" />
      </svg>
    </BrandMark>
  );
}

function IcountMark() {
  return (
    <BrandMark bg="#0F9D8C">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M6 3h12v18l-2.5-1.7L13 21l-2.5-1.7L8 21l-2-1.4V3Z" strokeLinejoin="round" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </svg>
    </BrandMark>
  );
}

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

function IntegrationCard({ icon: Icon, mark, title, state, stateLabel, description, children, rows, alert, onOpen }) {
  const [hover, setHover] = useState(false);
  const clickable = typeof onOpen === 'function';

  return (
    <section
      className="business-settings-card"
      onClick={clickable ? onOpen : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      style={clickable ? {
        cursor: 'pointer',
        borderColor: hover ? 'var(--blue)' : undefined,
        transition: 'border-color .15s ease, transform .15s ease',
        transform: hover ? 'translateY(-2px)' : undefined,
      } : undefined}
    >
      <div className="business-settings-card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {mark || <Icon size={16} />}
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

      {/* Buttons keep their own meaning — a click on one must not also count as
          opening the card. */}
      <div
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>

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
    return 'החיבור פג או בוטל בגוגל. יש להתחבר מחדש. אם מסך ההסכמה היה במצב בדיקה בזמן החיבור הקודם — המפתח פג אחרי 7 ימים גם אחרי מעבר למצב חי, וצריך חיבור מחדש פעם אחת.';
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
      mark={<GoogleCalendarMark />}
      onOpen={data?.connected ? () => window.open('https://calendar.google.com', '_blank', 'noopener') : connect}
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
      mark={<GoogleContactsMark />}
      onOpen={data?.connected ? () => window.open('https://contacts.google.com', '_blank', 'noopener') : connect}
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

function WhatsappCard({ onOpen }) {
  const { data, loading } = useStatus('/api/whatsapp/status');
  if (loading) return <LoadingCard title="וואטסאפ" icon={MessageCircle} />;

  return (
    <IntegrationCard
      mark={<WhatsappMark />}
      onOpen={onOpen}
      title="וואטסאפ"
      state={data?.connected ? 'ok' : 'off'}
      stateLabel={data?.connected ? 'מחובר' : 'לא מחובר'}
      description="שליחה וקבלה של הודעות מול Meta. לחיצה פותחת את הגדרות החיבור."
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
      <button type="button" className="btn btn-ghost" onClick={onOpen}>
        <Settings2 size={14} />
        הגדרות החיבור
      </button>
    </IntegrationCard>
  );
}

function MessengerCard({ onOpen }) {
  const { data, loading } = useStatus('/api/whatsapp/settings');
  if (loading) return <LoadingCard title="מסנג׳ר" icon={MessageCircle} />;

  const connected = !!(data?.metaPageId && data?.hasMessengerAccessToken);
  return (
    <IntegrationCard
      mark={<MessengerMark />}
      onOpen={onOpen}
      title="מסנג׳ר (דף פייסבוק)"
      state={connected ? 'ok' : 'off'}
      stateLabel={connected ? 'מחובר' : data?.metaPageId ? 'חסר אסימון דף' : 'לא מחובר'}
      description="הודעות מסנג׳ר נכנסות לתיק הלקוח. לחיצה פותחת את הגדרות החיבור."
      rows={data?.metaPageId ? [['מזהה דף', data.metaPageId]] : []}
    >
      <button type="button" className="btn btn-ghost" onClick={onOpen}>
        <Settings2 size={14} />
        הגדרות החיבור
      </button>
    </IntegrationCard>
  );
}

function InstagramCard({ onOpen }) {
  const { data, loading } = useStatus('/api/whatsapp/settings');
  if (loading) return <LoadingCard title="אינסטגרם" icon={MessageCircle} />;

  const connected = !!(data?.metaIgAccountId && data?.hasInstagramAccessToken);
  return (
    <IntegrationCard
      mark={<InstagramMark />}
      onOpen={onOpen}
      title="אינסטגרם (הודעות פרטיות)"
      state={connected ? 'ok' : 'off'}
      stateLabel={connected ? 'מחובר' : data?.metaIgAccountId ? 'חסר אסימון' : 'לא מחובר'}
      description="פנייה בהודעה פרטית באינסטגרם נפתחת כליד. לחיצה פותחת את הגדרות החיבור."
      rows={data?.metaIgAccountId ? [['מזהה חשבון', data.metaIgAccountId]] : []}
    >
      <button type="button" className="btn btn-ghost" onClick={onOpen}>
        <Settings2 size={14} />
        הגדרות החיבור
      </button>
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
  const service = test?.service || data?.service || {};
  const serviceHealthy = service.status === 'healthy';
  const state = !configured ? 'off' : (!serviceHealthy || (test && !test.ok)) ? 'error' : 'ok';
  const stateLabel = !configured
    ? 'לא מוגדר'
    : serviceHealthy
      ? 'פעיל'
      : service.status === 'quota_exhausted' ? 'המכסה הסתיימה' : 'מושבת זמנית';

  return (
    <IntegrationCard
      mark={<GeminiMark />}
      onOpen={() => { window.location.href = '/broadcasts'; }}
      title="מנוע השיחה של הבוט"
      state={state}
      stateLabel={stateLabel}
      description="המנוע שמנסח את תשובות הבוט בוואטסאפ. בתקלה הבוט שותק מול לקוחות, מתריע לצוות וחוזר אוטומטית לאחר בדיקה מוצלחת."
      alert={!configured ? 'אין מפתח מודל בשרת — הבוט מושבת מול לקוחות' : (!serviceHealthy ? service.last_error || 'שירות הבינה אינו זמין' : (test && !test.ok ? test.error : null))}
      rows={[
        ['דגם מועדף', data?.preferredModel || '—'],
        ...(service.failed_at ? [['כשל אחרון', formatDateTime(service.failed_at)]] : []),
        ...(service.next_probe_at ? [['בדיקה הבאה', formatDateTime(service.next_probe_at)]] : []),
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
      mark={<IcountMark />}
      onOpen={() => window.open('https://app.icount.co.il', '_blank', 'noopener')}
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
  // The Meta channels share one settings panel; a card opens it focused on
  // itself instead of sending anyone to a tab in the broadcast screen.
  const [openChannel, setOpenChannel] = useState('');

  if (openChannel) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setOpenChannel('')}
        >
          <ArrowRight size={14} />
          חזרה לחיבורים
        </button>
        <ChannelConnections focus={openChannel} />
      </div>
    );
  }

  return (
    <div className="business-settings-grid">
      <GoogleContactsCard />
      <GoogleCalendarCard />
      <WhatsappCard onOpen={() => setOpenChannel('whatsapp')} />
      <MessengerCard onOpen={() => setOpenChannel('messenger')} />
      <InstagramCard onOpen={() => setOpenChannel('instagram')} />
      <BotEngineCard />
      <IcountCard />
    </div>
  );
}
