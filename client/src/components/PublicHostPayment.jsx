import React, { useEffect, useState } from 'react';
import { CheckCircle, CreditCard, Loader2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';

export default function PublicHostPayment() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [activity, setActivity] = useState(null);
  const [paymentUrl, setPaymentUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(720);

  // If iCount redirects success into the iframe, break out to the top window.
  useEffect(() => {
    if (window.top !== window.self && searchParams.get('paid') === '1') {
      window.top.location.href = window.location.href;
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/public/host-payments/${encodeURIComponent(token)}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הקישור לא נמצא');
        if (cancelled) return;
        setActivity(body);

        if (body.payment_status === 'paid' || searchParams.get('paid') === '1') {
          return;
        }

        setPaying(true);
        const payResponse = await fetch(`/api/public/host-payments/${encodeURIComponent(token)}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const payBody = await payResponse.json().catch(() => ({}));
        if (!payResponse.ok) throw new Error(payBody.error || 'יצירת התשלום נכשלה');
        if (cancelled) return;
        if (payBody.alreadyPaid) {
          setActivity((current) => ({ ...current, payment_status: 'paid' }));
          return;
        }
        setPaymentUrl(payBody.paymentUrl || '');
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPaying(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, searchParams]);

  useEffect(() => {
    const onMessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== 'object') return;
      if (data.event_type === 'page_load' || data.event_type === 'page_size') {
        const height = Number(data.page_size?.height);
        if (height > 200) setIframeHeight(Math.min(1400, Math.max(520, height + 24)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const paid = activity?.payment_status === 'paid' || searchParams.get('paid') === '1';
  const dateLabel = activity?.date
    ? new Date(`${activity.date}T12:00:00`).toLocaleDateString('he-IL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    : '';

  return (
    <div className="host-payment-page">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800;900&display=swap"
      />
      <main className={`host-payment-shell ${paymentUrl && !paid ? 'host-payment-shell--wide' : ''}`}>
        <header className="host-payment-header">
          <div className="host-payment-brand">MY WALL</div>
          {loading ? (
            <div className="host-payment-loading">
              <Loader2 className="spin" size={28} />
              <p>טוען את דף התשלום...</p>
            </div>
          ) : error && !activity ? (
            <>
              <h1>לא ניתן לפתוח את הקישור</h1>
              <p className="host-payment-sub">{error}</p>
            </>
          ) : paid ? (
            <div className="host-payment-success">
              <CheckCircle size={64} color="#34d399" />
              <h1>התשלום התקבל</h1>
              <p className="host-payment-sub">תודה, האירוע מסומן כשולם.</p>
            </div>
          ) : (
            <>
              <p className="host-payment-kicker">תשלום לאירוע</p>
              <h1 className="host-payment-title">{activity?.name || 'אירוע'}</h1>
              <p className="host-payment-sub">
                שלום {activity?.host_name || 'מזמין האירוע'}, השלימו כאן את התשלום המלא.
              </p>
              <div className="host-payment-meta">
                {dateLabel && <span>{dateLabel}</span>}
                {activity?.start_time && <span>{String(activity.start_time).slice(0, 5)}</span>}
                {activity?.location && <span>{activity.location}</span>}
                <strong>₪{Number(activity?.price || 0).toLocaleString('he-IL')}</strong>
              </div>
            </>
          )}
        </header>

        {!paid && !loading && activity && (
          <section className="host-payment-embed">
            {error && <div className="host-payment-error" role="alert">{error}</div>}
            {paying && !paymentUrl && (
              <div className="host-payment-loading">
                <Loader2 className="spin" size={24} />
                <p>מכין טופס תשלום מאובטח...</p>
              </div>
            )}
            {paymentUrl ? (
              <iframe
                title={`תשלום עבור ${activity?.name || 'האירוע'}`}
                src={paymentUrl}
                className="host-payment-iframe"
                style={{ height: iframeHeight }}
                allow="payment *"
              />
            ) : !paying && (
              <button
                type="button"
                className="host-payment-fallback"
                onClick={() => window.location.reload()}
              >
                <CreditCard size={18} />
                טעינה מחדש של טופס התשלום
              </button>
            )}
          </section>
        )}
      </main>
      <style>{`
        .host-payment-page{
          min-height:100vh;
          direction:rtl;
          padding:20px 14px 40px;
          background:
            radial-gradient(circle at top,#1e293b,#070b14 68%);
          color:#f8fafc;
          font-family:Heebo,Assistant,system-ui,sans-serif;
        }
        .host-payment-shell{
          width:min(520px,100%);
          margin:0 auto;
          display:grid;
          gap:16px;
        }
        .host-payment-shell--wide{width:min(920px,100%)}
        .host-payment-header{
          text-align:center;
          padding:28px 22px 22px;
          border:1px solid rgba(255,255,255,.12);
          border-radius:22px;
          background:rgba(15,23,42,.96);
          box-shadow:0 24px 70px rgba(0,0,0,.45);
        }
        .host-payment-brand{
          color:#fb923c;
          font-weight:900;
          letter-spacing:.14em;
          font-size:13px;
        }
        .host-payment-kicker{
          margin:14px 0 0;
          color:#94a3b8;
          font-size:13px;
          font-weight:700;
        }
        .host-payment-title{
          margin:8px 0 10px;
          font-size:clamp(28px,5vw,40px);
          line-height:1.2;
          font-weight:900;
          color:#fff;
        }
        .host-payment-sub{margin:0;color:#cbd5e1;line-height:1.6}
        .host-payment-meta{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          justify-content:center;
          margin-top:18px;
        }
        .host-payment-meta span,
        .host-payment-meta strong{
          display:inline-flex;
          align-items:center;
          padding:7px 12px;
          border-radius:999px;
          background:#0b1220;
          border:1px solid rgba(255,255,255,.08);
          font-size:13px;
          color:#e2e8f0;
        }
        .host-payment-meta strong{
          color:#fdba74;
          font-size:16px;
          font-weight:900;
        }
        .host-payment-embed{
          border:1px solid rgba(255,255,255,.12);
          border-radius:22px;
          overflow:hidden;
          background:#fff;
          box-shadow:0 24px 70px rgba(0,0,0,.45);
          min-height:240px;
        }
        .host-payment-iframe{
          display:block;
          width:100%;
          border:0;
          background:#fff;
        }
        .host-payment-loading,
        .host-payment-success{
          display:grid;
          place-items:center;
          gap:10px;
          padding:28px 12px;
        }
        .host-payment-error{
          margin:14px;
          padding:12px;
          border-radius:12px;
          background:rgba(239,68,68,.12);
          color:#b91c1c;
          text-align:center;
        }
        .host-payment-fallback{
          width:calc(100% - 28px);
          margin:14px;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:8px;
          padding:14px;
          border:0;
          border-radius:12px;
          background:linear-gradient(135deg,#f97316,#ea580c);
          color:#fff;
          font:inherit;
          font-weight:900;
          cursor:pointer;
        }
        .spin{animation:host-spin .8s linear infinite}
        @keyframes host-spin{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  );
}
