import React, { useEffect, useState } from 'react';
import { CheckCircle, CreditCard, Loader2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';

export default function PublicHostPayment() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    fetch(`/api/public/host-payments/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הקישור לא נמצא');
        setActivity(body);
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [token]);

  const pay = async () => {
    setPaying(true);
    setError('');
    try {
      const response = await fetch(`/api/public/host-payments/${encodeURIComponent(token)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'יצירת התשלום נכשלה');
      if (body.alreadyPaid) {
        setActivity((current) => ({ ...current, payment_status: 'paid' }));
        return;
      }
      window.location.assign(body.paymentUrl);
    } catch (payError) {
      setError(payError.message);
    } finally {
      setPaying(false);
    }
  };

  const paid = activity?.payment_status === 'paid' || searchParams.get('paid') === '1';
  return (
    <div className="host-payment-page">
      <main className="host-payment-card">
        <div className="host-payment-brand">MY WALL</div>
        {loading ? (
          <><Loader2 className="spin" /><p>טוען...</p></>
        ) : error && !activity ? (
          <><h1>לא ניתן לפתוח את הקישור</h1><p>{error}</p></>
        ) : paid ? (
          <>
            <CheckCircle size={64} color="#34d399" />
            <h1>התשלום התקבל</h1>
            <p>תודה, האירוע מסומן כשולם.</p>
          </>
        ) : (
          <>
            <h1>{activity?.name}</h1>
            <p>שלום {activity?.host_name || 'מזמין האירוע'},</p>
            <p>זהו קישור פרטי לתשלום המלא עבור האירוע.</p>
            <div className="host-payment-details">
              {activity?.date && <span>{activity.date}</span>}
              {activity?.location && <span>{activity.location}</span>}
              <strong>₪{Number(activity?.price || 0).toLocaleString('he-IL')}</strong>
            </div>
            {error && <div className="host-payment-error" role="alert">{error}</div>}
            <button type="button" disabled={paying} onClick={pay}>
              {paying ? <Loader2 size={18} className="spin" /> : <CreditCard size={18} />}
              {paying ? 'מכין תשלום...' : 'מעבר לתשלום מאובטח'}
            </button>
          </>
        )}
      </main>
      <style>{`
        .host-payment-page{min-height:100vh;display:grid;place-items:center;direction:rtl;padding:18px;background:radial-gradient(circle at top,#1e293b,#070b14 70%);color:#f8fafc;font-family:Heebo,Assistant,system-ui,sans-serif}
        .host-payment-card{width:min(460px,100%);text-align:center;padding:30px 24px;border:1px solid rgba(255,255,255,.12);border-radius:22px;background:rgba(15,23,42,.95);box-shadow:0 24px 70px rgba(0,0,0,.5)}
        .host-payment-brand{color:#fb923c;font-weight:900;letter-spacing:.12em}.host-payment-card h1{margin:12px 0}.host-payment-card p{color:#cbd5e1}.host-payment-details{display:grid;gap:9px;margin:22px 0;padding:18px;border-radius:14px;background:#0b1220}.host-payment-details strong{color:#fdba74;font-size:28px}
        .host-payment-card button{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;border:0;border-radius:12px;background:#f97316;color:#fff;font:inherit;font-weight:900;cursor:pointer}.host-payment-card button:disabled{opacity:.6}.host-payment-error{padding:10px;margin-bottom:12px;border-radius:10px;background:rgba(239,68,68,.14);color:#fca5a5}.spin{animation:host-spin .8s linear infinite}@keyframes host-spin{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  );
}
