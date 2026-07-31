import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, CreditCard, Loader2 } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { formatIls, normalizePriceIncludesVat, vatBreakdown } from '../utils/vat.js';

const DEFAULT_LABELS = {
  shoes: 'נעלי טיפוס',
  shirt: 'חולצת חוג',
  chalk_bag: 'שק מגנזיום ומגנזיום',
};

/** '2026-10-01' → '1.10' */
function shortDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return '';
  return `${Number(match[3])}.${Number(match[2])}`;
}

function monthsLabel(units) {
  const value = Number(units);
  if (!Number.isFinite(value)) return '';
  return value === 1 ? 'חודש' : `${value} חודשים`;
}

export default function PublicEquipmentPayment() {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [shirtSize, setShirtSize] = useState('');
  const [paymentUrl, setPaymentUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(720);

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
        const response = await fetch(`/api/public/equipment/${encodeURIComponent(token)}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הקישור לא נמצא');
        if (cancelled) return;
        setData(body);
        const unpaidTypes = (body.unpaid_items || []).map((i) => i.item_type);
        setSelected(unpaidTypes);
        const existingShirt = (body.items || []).find((i) => i.item_type === 'shirt');
        if (existingShirt?.shirt_size) setShirtSize(existingShirt.shirt_size);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    const onMessage = (event) => {
      const payload = event?.data;
      if (!payload || typeof payload !== 'object') return;
      if (payload.event_type === 'page_load' || payload.event_type === 'page_size') {
        const height = Number(payload.page_size?.height);
        if (height > 200) setIframeHeight(Math.min(1400, Math.max(520, height + 24)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const labels = data?.labels || DEFAULT_LABELS;
  const settings = data?.settings || {};
  const prices = settings.prices || {};
  const shirtSizes = settings.shirt_sizes || [];
  // מחיר הנעליים שהשרת מחזיר כבר מקוזז; זה ההסבר להורה למה.
  const shoesPricing = data?.shoes_pricing || null;
  const unpaidTypes = useMemo(
    () => new Set((data?.unpaid_items || []).map((i) => i.item_type)),
    [data]
  );

  const totalEntered = selected.reduce((sum, type) => sum + (Number(prices[type]) || 0), 0);
  const priceVat = vatBreakdown(
    totalEntered,
    normalizePriceIncludesVat(settings.price_includes_vat, true)
  );

  const paidFlag = searchParams.get('paid') === '1';
  const allPaid = data?.all_paid || (data?.unpaid_items || []).length === 0;

  const toggleItem = (type) => {
    if (!unpaidTypes.has(type) || paymentUrl) return;
    setSelected((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const startPay = async () => {
    setPaying(true);
    setError('');
    try {
      if (!selected.length) throw new Error('בחרו לפחות פריט אחד');
      if (selected.includes('shirt') && !shirtSize) {
        throw new Error('יש לבחור מידת חולצה');
      }
      const payResponse = await fetch(`/api/public/equipment/${encodeURIComponent(token)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemTypes: selected, shirtSize }),
      });
      const payBody = await payResponse.json().catch(() => ({}));
      if (!payResponse.ok) throw new Error(payBody.error || 'יצירת התשלום נכשלה');
      setPaymentUrl(payBody.paymentUrl || '');
    } catch (payError) {
      setError(payError.message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="eq-pay-page">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800;900&display=swap"
      />
      <main className={`eq-pay-shell ${paymentUrl && !paidFlag ? 'eq-pay-shell--wide' : ''}`}>
        <header className="eq-pay-header">
          <div className="eq-pay-brand">{brandName}</div>
          {loading ? (
            <div className="eq-pay-loading">
              <Loader2 className="spin" size={28} />
              <p>טוען את דף התשלום...</p>
            </div>
          ) : error && !data ? (
            <>
              <h1>לא ניתן לפתוח את הקישור</h1>
              <p className="eq-pay-sub">{error}</p>
            </>
          ) : paidFlag || allPaid ? (
            <div className="eq-pay-success">
              <CheckCircle size={64} color="#34d399" />
              <h1>התשלום התקבל</h1>
              <p className="eq-pay-sub">
                הציוד של {data?.student_name || 'הילד'} עודכן בתיק.
              </p>
            </div>
          ) : (
            <>
              <p className="eq-pay-kicker">ציוד לאימונים</p>
              <h1 className="eq-pay-title">{data?.student_name || 'מתאמן'}</h1>
              <p className="eq-pay-sub">
                שלום {data?.parent_name || 'הורה'}, בחרו את הפריטים לתשלום.
              </p>
            </>
          )}
        </header>

        {!paidFlag && !allPaid && !loading && data && (
          <section className="eq-pay-card">
            {(data.unpaid_items || []).length === 0 ? (
              <p className="eq-pay-sub" style={{ textAlign: 'center', margin: 0 }}>
                אין פריטים שממתינים לתשלום
              </p>
            ) : (
              <>
                <div className="eq-pay-items">
                  {(data.unpaid_items || []).map((item) => {
                    const type = item.item_type;
                    const checked = selected.includes(type);
                    return (
                      <label key={type} className={`eq-pay-item ${checked ? 'is-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!!paymentUrl}
                          onChange={() => toggleItem(type)}
                        />
                        <div>
                          <strong>{labels[type] || type}</strong>
                          <span>{formatIls(prices[type] || 0)}</span>
                        </div>
                      </label>
                    );
                  })}
                  {selected.includes('shoes') && shoesPricing && (
                    <p className="eq-pay-note">
                      השכרת נעליים ל{shoesPricing.half_label} של שנת החוגים
                      {' '}({shortDate(shoesPricing.half_start)}–{shortDate(shoesPricing.half_end)}).
                      {shoesPricing.prorated ? (
                        <>
                          {' '}מחיר מלא לחצי עונה {formatIls(shoesPricing.full_price)}, ומכיוון
                          {shoesPricing.join_source === 'attendance'
                            ? ` שההצטרפות לחוג הייתה ב-${shortDate(shoesPricing.join_date)}`
                            : ' שההצטרפות באמצע העונה'}
                          {' '}החיוב הוא על {monthsLabel(shoesPricing.remaining_units)} מתוך
                          {' '}{shoesPricing.total_units}.
                        </>
                      ) : null}
                    </p>
                  )}
                </div>

                {selected.includes('shirt') && (
                  <div className="eq-pay-size">
                    <label htmlFor="shirt-size">מידת חולצה</label>
                    <select
                      id="shirt-size"
                      value={shirtSize}
                      disabled={!!paymentUrl}
                      onChange={(e) => setShirtSize(e.target.value)}
                    >
                      <option value="">בחרו מידה</option>
                      {shirtSizes.map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="eq-pay-total">
                  <span>לתשלום</span>
                  <strong>
                    {formatIls(priceVat.gross)}
                    {' '}
                    כולל מע״מ
                  </strong>
                </div>

                {error && <div className="eq-pay-error" role="alert">{error}</div>}

                {!paymentUrl ? (
                  <button
                    type="button"
                    className="eq-pay-cta"
                    disabled={paying || !selected.length}
                    onClick={startPay}
                  >
                    {paying ? <Loader2 className="spin" size={18} /> : <CreditCard size={18} />}
                    {paying ? 'מכין תשלום...' : 'המשך לתשלום מאובטח'}
                  </button>
                ) : (
                  <iframe
                    title="תשלום ציוד לאימונים"
                    src={paymentUrl}
                    className="eq-pay-iframe"
                    style={{ height: iframeHeight }}
                    allow="payment *"
                  />
                )}
              </>
            )}
          </section>
        )}
      </main>
      <style>{`
        .eq-pay-page{
          /* בלי זה דפדפן פותח את רשימת המידות בחלונית בהירה,
             והאפשרויות יורשות טקסט לבן — לבן על לבן, כלומר רשימה ריקה */
          color-scheme:dark;
          min-height:100vh;direction:rtl;padding:20px 14px 40px;
          background:radial-gradient(circle at top,#1e293b,#070b14 68%);
          color:#f8fafc;font-family:Heebo,Assistant,system-ui,sans-serif;
        }
        .eq-pay-shell{width:min(560px,100%);margin:0 auto;display:grid;gap:16px}
        .eq-pay-shell--wide{width:min(920px,100%)}
        .eq-pay-header{
          text-align:center;padding:28px 22px 22px;border:1px solid rgba(255,255,255,.12);
          border-radius:22px;background:rgba(15,23,42,.96);box-shadow:0 24px 70px rgba(0,0,0,.45);
        }
        .eq-pay-brand{color:#38bdf8;font-weight:900;letter-spacing:.14em;font-size:13px}
        .eq-pay-kicker{margin:14px 0 0;color:#94a3b8;font-size:13px;font-weight:700}
        .eq-pay-title{margin:8px 0 10px;font-size:clamp(28px,5vw,40px);line-height:1.2;font-weight:900;color:#fff}
        .eq-pay-sub{margin:0;color:#cbd5e1;line-height:1.6}
        .eq-pay-card{
          border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:18px;
          background:rgba(15,23,42,.96);box-shadow:0 24px 70px rgba(0,0,0,.45);
        }
        .eq-pay-items{display:grid;gap:10px}
        .eq-pay-item{
          display:flex;gap:12px;align-items:center;padding:14px 14px;
          border-radius:14px;border:1px solid rgba(255,255,255,.1);background:#0b1220;cursor:pointer;
        }
        .eq-pay-item.is-on{border-color:#38bdf8;background:#0f1a2e}
        .eq-pay-item input{width:18px;height:18px;accent-color:#38bdf8}
        .eq-pay-item div{flex:1;display:flex;justify-content:space-between;gap:12px;align-items:center}
        .eq-pay-item strong{font-weight:800}
        .eq-pay-item span{color:#7dd3fc;font-weight:800}
        .eq-pay-note{
          margin:2px 2px 0;font-size:12px;line-height:1.7;color:#94a3b8;
        }
        .eq-pay-size{margin-top:14px;display:grid;gap:8px}
        .eq-pay-size label{font-size:13px;color:#94a3b8;font-weight:700}
        .eq-pay-size select{
          width:100%;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
          background:#0b1220;color:#fff;font:inherit;font-weight:700;
        }
        .eq-pay-size select option{background:#0b1220;color:#fff}
        .eq-pay-total{
          margin-top:16px;display:flex;justify-content:space-between;align-items:center;
          padding:12px 4px;font-size:15px;
        }
        .eq-pay-total strong{color:#7dd3fc;font-size:20px;font-weight:900}
        .eq-pay-cta{
          width:100%;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px;
          padding:14px;border:0;border-radius:12px;
          background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;
          font:inherit;font-weight:900;cursor:pointer;
        }
        .eq-pay-cta:disabled{opacity:.55;cursor:not-allowed}
        .eq-pay-iframe{display:block;width:100%;border:0;border-radius:14px;margin-top:12px;background:#fff}
        .eq-pay-error{
          margin-top:12px;padding:12px;border-radius:12px;
          background:rgba(239,68,68,.12);color:#fecaca;text-align:center;
        }
        .eq-pay-loading,.eq-pay-success{display:grid;place-items:center;gap:10px;padding:28px 12px}
        .spin{animation:eq-spin .8s linear infinite}
        @keyframes eq-spin{to{transform:rotate(360deg)}}
      `}</style>
    </div>
  );
}
