import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle, CreditCard, Loader2, Users } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { formatIls, normalizePriceIncludesVat, vatBreakdown } from '../utils/vat.js';
import AppSelect from './AppSelect.jsx';

const DEFAULT_LABELS = {
  shoes: 'נעלי טיפוס',
  shirt: 'חולצת חוג',
  chalk_bag: 'שק מגנזיום ומגנזיום',
};

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

function seasonHalfLabel(label) {
  if (label === 'חצי ראשון') return 'המחצית הראשונה';
  if (label === 'חצי שני') return 'המחצית השנייה';
  return String(label || 'מחצית שנת החוגים');
}

function itemCountLabel(count) {
  return Number(count) === 1 ? 'פריט אחד לבחירה' : `${Number(count) || 0} פריטים לבחירה`;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function initialSelections(members = []) {
  return Object.fromEntries(members.map((member) => {
    const shirt = (member.items || []).find((item) => item.item_type === 'shirt');
    return [String(member.student_id), {
      itemTypes: (member.unpaid_items || []).map((item) => item.item_type),
      shirtSize: shirt?.shirt_size || '',
    }];
  }));
}

export default function PublicEquipmentPayment() {
  const { profile } = useBusinessProfile();
  const brandName = 'קיר בועז';
  const brandLogo = profile.logo_url && profile.logo_url !== '/logo.png'
    ? profile.logo_url
    : '/brand/logo-kirboaz.png';
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const paidFlag = searchParams.get('paid') === '1';
  const [data, setData] = useState(null);
  const [stage, setStage] = useState('members');
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [selections, setSelections] = useState({});
  const [paymentUrl, setPaymentUrl] = useState('');
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [owning, setOwning] = useState('');
  const [iframeHeight, setIframeHeight] = useState(720);

  const loadData = useCallback(async ({ reset = false, quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/public/equipment/${encodeURIComponent(token)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'הקישור לא נמצא');
      setData(body);
      if (reset) {
        setSelections(initialSelections(body.members || []));
        setSelectedMemberIds([]);
        setStage('members');
      }
      if (paidFlag && body.latest_payment?.status === 'paid') {
        setPaymentComplete(true);
        setPaymentUrl('');
        setSelections(initialSelections(body.members || []));
        setSelectedMemberIds([]);
        setStage('members');
      }
      return body;
    } catch (loadError) {
      setError(loadError.message);
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [paidFlag, token]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    (async () => {
      if (!cancelled) await loadData({ reset: true });
    })();
    return () => { cancelled = true; };
  }, [loadData]);

  useEffect(() => {
    if (window.top !== window.self && paidFlag) window.top.location.href = window.location.href;
  }, [paidFlag]);

  useEffect(() => {
    if (!paidFlag || paymentComplete || data?.latest_payment?.status === 'paid') return undefined;
    const timer = window.setInterval(() => loadData({ quiet: true }), 2000);
    return () => window.clearInterval(timer);
  }, [data?.latest_payment?.status, loadData, paidFlag, paymentComplete]);

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

  const members = data?.members || [];
  const labels = data?.labels || DEFAULT_LABELS;
  const settings = data?.settings || {};
  const shirtSizes = settings.shirt_sizes || [];
  const selectedMembers = members.filter((member) => selectedMemberIds.includes(String(member.student_id)));
  const basket = useMemo(() => selectedMembers.map((member) => {
    const selection = selections[String(member.student_id)] || { itemTypes: [], shirtSize: '' };
    const subtotal = selection.itemTypes.reduce(
      (sum, type) => sum + (Number(member.prices?.[type]) || 0),
      0
    );
    return { member, ...selection, subtotal };
  }).filter((entry) => entry.itemTypes.length > 0), [selectedMembers, selections]);
  const subtotal = basket.reduce((sum, entry) => sum + entry.subtotal, 0);
  const discountPercent = settings.family_discount_enabled !== false && basket.length >= 2
    ? Math.max(0, Math.min(100, Number(settings.family_discount_percent) || 0))
    : 0;
  const discount = Math.round((subtotal * discountPercent / 100) * 100) / 100;
  const discountedTotal = Math.round((subtotal - discount) * 100) / 100;
  const priceVat = vatBreakdown(
    discountedTotal,
    normalizePriceIncludesVat(settings.price_includes_vat, true)
  );

  const updateSelection = (studentId, patcher) => {
    const key = String(studentId);
    setSelections((current) => ({
      ...current,
      [key]: patcher(current[key] || { itemTypes: [], shirtSize: '' }),
    }));
  };

  const toggleMember = (member) => {
    if (member.all_resolved || paymentUrl) return;
    const key = String(member.student_id);
    setSelectedMemberIds((current) => current.includes(key)
      ? current.filter((id) => id !== key)
      : [...current, key]);
  };

  const toggleItem = (member, type) => {
    if (paymentUrl) return;
    updateSelection(member.student_id, (current) => ({
      ...current,
      itemTypes: current.itemTypes.includes(type)
        ? current.itemTypes.filter((itemType) => itemType !== type)
        : [...current.itemTypes, type],
    }));
  };

  const setItemOwnership = async (member, type, shouldOwn) => {
    const busyKey = `${member.student_id}-${type}`;
    setOwning(busyKey);
    setError('');
    try {
      const response = await fetch(`/api/public/equipment/${encodeURIComponent(token)}/own`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: member.student_id, itemTypes: [type], owned: shouldOwn }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'הסימון נכשל');
      setData(body);
      updateSelection(member.student_id, (current) => ({
        ...current,
        itemTypes: shouldOwn
          ? current.itemTypes.filter((itemType) => itemType !== type)
          : (current.itemTypes.includes(type) ? current.itemTypes : [...current.itemTypes, type]),
      }));
    } catch (ownershipError) {
      setError(ownershipError.message || 'עדכון הציוד נכשל');
    } finally {
      setOwning('');
    }
  };

  const continueToEquipment = () => {
    setError('');
    if (!selectedMemberIds.length) {
      setError('בחרו לפחות מתאמן אחד');
      return;
    }
    setStage('equipment');
  };

  const startPay = async () => {
    setPaying(true);
    setError('');
    try {
      if (!basket.length) throw new Error('בחרו לפחות פריט אחד לתשלום');
      for (const entry of basket) {
        if (entry.itemTypes.includes('shirt') && !entry.shirtSize) {
          throw new Error(`יש לבחור מידת חולצה עבור ${firstName(entry.member.student_name)}`);
        }
      }
      const response = await fetch(`/api/public/equipment/${encodeURIComponent(token)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocations: basket.map((entry) => ({
            studentId: entry.member.student_id,
            itemTypes: entry.itemTypes,
            shirtSize: entry.shirtSize,
          })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'יצירת התשלום נכשלה');
      setPaymentSummary(body);
      setPaymentUrl(body.paymentUrl || '');
    } catch (payError) {
      setError(payError.message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="eq-pay-page">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800;900&display=swap" />
      <main className={`eq-pay-shell ${paymentUrl ? 'eq-pay-shell--wide' : ''}`}>
        <header className="eq-pay-header">
          <div className="eq-pay-brand">
            <img src={brandLogo} alt="" aria-hidden="true" />
            <span>{brandName}</span>
          </div>
          {loading ? (
            <div className="eq-pay-loading"><Loader2 className="spin" size={28} /><p>טוען את דף התשלום...</p></div>
          ) : error && !data ? (
            <><h1>לא ניתן לפתוח את הקישור</h1><p className="eq-pay-sub">{error}</p></>
          ) : (
            <>
              <h1 className="eq-pay-title">תשלום ציוד לאימונים</h1>
              <p className="eq-pay-sub">שלום {firstName(data?.parent_name) || 'הורה'}, בוחרים לכל מתאמן בנפרד ומשלמים פעם אחת.</p>
              <div className="eq-pay-required" role="note">
                <AlertTriangle size={30} aria-hidden="true" />
                <div>
                  <strong>חובה להגיע לחוג עם ציוד</strong>
                  <span>ללא הציוד לא ניתן להשתתף באימון. אם כבר יש פריט מהבית או משנה שעברה, סמנו „כבר יש לנו” ולא תחויבו עליו.</span>
                  <span className="eq-pay-socks">בנוסף, חובה להגיע לכל אימון עם זוג גרביים נקיים לשימוש בנעלי הטיפוס.</span>
                </div>
              </div>
            </>
          )}
        </header>

        {paymentComplete && (
          <div className="eq-pay-success" role="status">
            <CheckCircle size={34} />
            <div><strong>התשלום התקבל</strong><span>הציוד עודכן בתיקי המתאמנים. אפשר להסדיר למטה פריטים שנשארו.</span></div>
          </div>
        )}
        {paidFlag && !paymentComplete && data && (
          <div className="eq-pay-pending"><Loader2 className="spin" size={18} /> מאמתים את התשלום מול חברת האשראי...</div>
        )}

        {!loading && data && !paymentUrl && stage === 'members' && (
          <section className="eq-pay-card">
            <div className="eq-pay-step"><span>1</span><div><strong>על מי משלמים?</strong><small>בחרו מתאמן אחד או יותר מתיק המשפחה</small></div></div>
            <div className="eq-member-list">
              {members.map((member) => {
                const key = String(member.student_id);
                const checked = selectedMemberIds.includes(key);
                return (
                  <label key={key} className={`eq-member ${checked ? 'is-on' : ''} ${member.all_resolved ? 'is-disabled' : ''}`}>
                    <input type="checkbox" checked={checked} disabled={member.all_resolved} onChange={() => toggleMember(member)} />
                    <div><strong>{firstName(member.student_name)}</strong><span>{member.is_adult ? 'מתאמן/ת מבוגר/ת' : 'מתאמן/ת צעיר/ה'}</span></div>
                    <b>{member.all_resolved ? 'הציוד הוסדר/שולם' : itemCountLabel(member.unpaid_items?.length)}</b>
                  </label>
                );
              })}
            </div>
            {data.all_resolved && <div className="eq-pay-info"><CheckCircle size={18} /> כל הציוד בתיק המשפחה כבר הוסדר.</div>}
            {error && <div className="eq-pay-error" role="alert">{error}</div>}
            {!data.all_resolved && (
              <button type="button" className="eq-pay-cta" disabled={!selectedMemberIds.length} onClick={continueToEquipment}>
                <Users size={18} /> המשך לבחירת ציוד ({selectedMemberIds.length})
              </button>
            )}
          </section>
        )}

        {!loading && data && !paymentUrl && stage === 'equipment' && (
          <section className="eq-pay-card">
            <button type="button" className="eq-pay-back" onClick={() => { setStage('members'); setError(''); }}>
              <ArrowRight size={16} /> חזרה לבחירת מתאמנים
            </button>
            <div className="eq-pay-step"><span>2</span><div><strong>בחירת ציוד</strong><small>הפריטים שטרם הוסדרו מסומנים מראש. אפשר להסיר כל פריט.</small></div></div>
            <div className="eq-trainee-cards">
              {selectedMembers.map((member) => {
                const key = String(member.student_id);
                const selection = selections[key] || { itemTypes: [], shirtSize: '' };
                return (
                  <article className="eq-trainee-card" key={key}>
                    <div className="eq-trainee-title"><div><strong>{firstName(member.student_name)}</strong><span>{member.is_adult ? 'מבוגר/ת' : 'צעיר/ה'}</span></div></div>
                    <div className="eq-pay-items">
                      {(member.items || []).map((item) => {
                        const type = item.item_type;
                        const isUnpaid = item.payment_status === 'unpaid';
                        const isOwn = item.payment_status === 'own';
                        const isPaid = item.payment_status === 'paid';
                        const checked = selection.itemTypes.includes(type);
                        const inputId = `equipment-${key}-${type}`;
                        const busyKey = `${key}-${type}`;
                        const itemInfo = type === 'chalk_bag'
                          ? String(settings.item_info?.chalk_bag || '').trim()
                          : '';
                        const hasShoeNote = type === 'shoes' && (isUnpaid || isOwn);
                        return (
                          <div key={type} className={`eq-pay-item ${hasShoeNote ? 'has-note' : ''} ${checked ? 'is-on' : ''} ${isOwn ? 'is-own' : ''} ${isPaid ? 'is-paid' : ''}`}>
                            <input id={inputId} type="checkbox" checked={checked} disabled={!isUnpaid} onChange={() => toggleItem(member, type)} />
                            <div className="eq-pay-item-details">
                              <label className="eq-pay-item-summary" htmlFor={inputId}>
                                <strong>{labels[type] || type}</strong>
                                <span>{isOwn ? 'ללא חיוב' : isPaid ? 'שולם' : formatIls(member.prices?.[type] || 0)}</span>
                              </label>
                              {type === 'shirt' && checked && (
                                <div className="eq-pay-size">
                                  <label htmlFor={`shirt-size-${key}`}>מידת חולצה</label>
                                  <AppSelect id={`shirt-size-${key}`} value={selection.shirtSize} onChange={(event) => updateSelection(key, (current) => ({ ...current, shirtSize: event.target.value }))}>
                                    <option value="">בחרו מידה</option>
                                    {shirtSizes.map((size) => <option key={size} value={size}>{size}</option>)}
                                  </AppSelect>
                                </div>
                              )}
                              {itemInfo && <p className="eq-pay-item-info">{itemInfo}</p>}
                            </div>
                            {(isUnpaid || isOwn) && (
                              <button type="button" className={`eq-pay-own ${isOwn ? 'is-cancel' : ''}`} disabled={owning === busyKey} aria-pressed={isOwn} onClick={() => setItemOwnership(member, type, !isOwn)}>
                                {owning === busyKey ? (isOwn ? 'מעדכן…' : 'שומר…') : (isOwn ? 'כן לרכוש' : 'כבר יש לנו')}
                              </button>
                            )}
                            {hasShoeNote && (
                              <div className="eq-pay-note eq-pay-item-note" role="note">
                                <strong>חשוב: תקופת השכרת הנעליים</strong>
                                {member.shoes_pricing ? (
                                  <>
                                    <span>ההשכרה היא ל{seasonHalfLabel(member.shoes_pricing.half_label)} — מ־{shortDate(member.shoes_pricing.half_start)} ועד {shortDate(member.shoes_pricing.half_end)}.</span>
                                    {member.shoes_pricing.prorated && <span>המחיר המלא הוא {formatIls(member.shoes_pricing.full_price)}; המחיר כבר קוזז עבור {monthsLabel(member.shoes_pricing.remaining_units)} מתוך {member.shoes_pricing.total_units}.</span>}
                                  </>
                                ) : <span>המחיר המוצג הוא עבור כל תקופת ההשכרה.</span>}
                                <span className="eq-pay-note-warning">ביטול ההשכרה לפני תום התקופה כרוך בדמי ביטול בסך 30 ₪.</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="eq-pay-summary">
              <div><span>סכום הציוד</span><strong>{formatIls(subtotal)}</strong></div>
              {discountPercent > 0 && <div className="is-discount"><span>הנחת משפחה ({discountPercent}%)</span><strong>−{formatIls(discount)}</strong></div>}
              <div className="is-total"><span>לתשלום</span><strong>{formatIls(priceVat.gross)} כולל מע״מ</strong></div>
              {settings.family_discount_enabled !== false && basket.length < 2 && (
                <small>הנחת משפחה של {Number(settings.family_discount_percent) || 0}% תופעל כשנרכש ציוד לשני מתאמנים לפחות באותו תשלום.</small>
              )}
            </div>
            {error && <div className="eq-pay-error" role="alert">{error}</div>}
            <button type="button" className="eq-pay-cta" disabled={paying || !basket.length} onClick={startPay}>
              {paying ? <Loader2 className="spin" size={18} /> : <CreditCard size={18} />}
              {paying ? 'מכין תשלום...' : 'המשך לתשלום מאובטח'}
            </button>
          </section>
        )}

        {paymentUrl && (
          <section className="eq-pay-card eq-payment-frame">
            {paymentSummary?.pricing && (
              <div className="eq-frame-summary">
                <span>עסקה משפחתית אחת</span>
                {paymentSummary.pricing.discount > 0 && <small>כולל הנחת משפחה {paymentSummary.pricing.discount_percent}%</small>}
                <strong>{formatIls(paymentSummary.amount)}</strong>
              </div>
            )}
            <iframe title="תשלום ציוד לאימונים" src={paymentUrl} className="eq-pay-iframe" style={{ height: iframeHeight }} allow="payment *" />
          </section>
        )}
      </main>
      <style>{`
        .eq-pay-page{color-scheme:dark;min-height:100vh;direction:rtl;padding:20px 14px 40px;background:radial-gradient(circle at top,#1e293b,#070b14 68%);color:#f8fafc;font-family:Heebo,Assistant,system-ui,sans-serif}
        .eq-pay-shell{width:min(720px,100%);margin:0 auto;display:grid;gap:16px}.eq-pay-shell--wide{width:min(920px,100%)}
        .eq-pay-header,.eq-pay-card{border:1px solid rgba(255,255,255,.12);border-radius:22px;background:rgba(15,23,42,.96);box-shadow:0 24px 70px rgba(0,0,0,.35)}
        .eq-pay-header{text-align:center;padding:28px 22px 22px}.eq-pay-card{padding:18px}
        .eq-pay-brand{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:#7dd3fc;font-weight:900;font-size:30px;line-height:1.1}.eq-pay-brand img{width:118px;height:118px;object-fit:contain;filter:drop-shadow(0 10px 18px rgba(0,0,0,.32))}.eq-pay-brand span{letter-spacing:.02em;text-align:center}
        .eq-pay-title{margin:26px 0 10px;font-size:clamp(28px,5vw,40px);line-height:1.2;font-weight:900}.eq-pay-sub{margin:0;color:#cbd5e1;line-height:1.6}
        .eq-pay-required{display:flex;align-items:center;text-align:right;gap:13px;margin:18px 0 0;padding:15px 17px;border-radius:14px;line-height:1.55;border:2px solid rgba(251,191,36,.65);background:rgba(251,191,36,.13);color:#fde68a;box-shadow:0 0 0 1px rgba(251,191,36,.08),inset 0 0 24px rgba(251,191,36,.04)}.eq-pay-required>svg{flex:0 0 auto;color:#fbbf24}.eq-pay-required>div{display:grid;gap:3px}.eq-pay-required strong{color:#fcd34d;font-size:18px;font-weight:900}.eq-pay-required span{font-size:14px;font-weight:700}.eq-pay-required .eq-pay-socks{color:#fef3c7;font-weight:900}
        .eq-pay-loading{display:flex;align-items:center;justify-content:center;gap:10px;padding:20px}.spin{animation:eq-spin 1s linear infinite}@keyframes eq-spin{to{transform:rotate(360deg)}}
        .eq-pay-success,.eq-pay-pending{display:flex;align-items:center;gap:12px;border-radius:16px;padding:14px 16px}.eq-pay-success{border:1px solid rgba(52,211,153,.35);background:rgba(16,185,129,.12);color:#6ee7b7}.eq-pay-success div{display:grid}.eq-pay-success strong{font-size:17px}.eq-pay-success span{color:#d1fae5;font-size:13px}.eq-pay-pending{border:1px solid rgba(56,189,248,.3);background:rgba(56,189,248,.1);color:#bae6fd}
        .eq-pay-step{display:flex;align-items:center;gap:11px;margin-bottom:14px}.eq-pay-step>span{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#38bdf8;color:#082f49;font-weight:900}.eq-pay-step>div{display:grid}.eq-pay-step strong{font-size:18px}.eq-pay-step small{color:#94a3b8}
        .eq-member-list,.eq-trainee-cards,.eq-pay-items{display:grid;gap:10px}.eq-member{display:flex;align-items:center;gap:12px;padding:14px;border:1px solid rgba(148,163,184,.25);border-radius:14px;cursor:pointer;background:rgba(255,255,255,.025)}.eq-member.is-on{border-color:#38bdf8;background:rgba(56,189,248,.09)}.eq-member.is-disabled{opacity:.62;cursor:default}.eq-member input,.eq-pay-item>input{width:20px;height:20px;accent-color:#38bdf8}.eq-member>div{display:grid}.eq-member>div span{font-size:12px;color:#94a3b8}.eq-member>b{margin-inline-start:auto;color:#7dd3fc;font-size:12px}.eq-member.is-disabled>b{color:#6ee7b7}
        .eq-pay-info{display:flex;gap:8px;align-items:center;margin-top:12px;padding:10px;border-radius:10px;background:rgba(52,211,153,.1);color:#6ee7b7}.eq-pay-back{border:0;background:transparent;color:#7dd3fc;display:inline-flex;gap:6px;align-items:center;cursor:pointer;margin-bottom:14px;font:inherit;font-weight:700}
        .eq-trainee-card{border:1px solid rgba(148,163,184,.2);border-radius:16px;padding:14px;background:rgba(2,6,23,.35)}.eq-trainee-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.eq-trainee-title>div{display:flex;align-items:center;gap:8px}.eq-trainee-title strong{font-size:18px}.eq-trainee-title span{font-size:11px;color:#94a3b8;border:1px solid rgba(148,163,184,.3);border-radius:999px;padding:2px 8px}
        .eq-pay-item{display:grid;grid-template-columns:20px minmax(0,1fr) auto;grid-template-areas:"check details action";align-items:start;gap:12px;padding:13px;border:1px solid rgba(148,163,184,.23);border-radius:13px;background:rgba(15,23,42,.8)}.eq-pay-item.has-note{grid-template-areas:"check details action" "note note note"}.eq-pay-item.is-on{border-color:#38bdf8;background:rgba(56,189,248,.07)}.eq-pay-item.is-own{border-color:rgba(251,191,36,.35)}.eq-pay-item.is-paid{border-color:rgba(52,211,153,.3);opacity:.8}.eq-pay-item>input{grid-area:check}.eq-pay-item-details{grid-area:details;min-width:0}.eq-pay-item-summary{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;cursor:pointer}.eq-pay-item-summary span{color:#7dd3fc;font-weight:800;white-space:nowrap}.eq-pay-item-info{margin:8px 0 0;color:#cbd5e1;font-size:12px;line-height:1.55}.eq-pay-size{display:grid;gap:5px;margin-top:9px;margin-inline-start:auto;max-width:180px}.eq-pay-size>label{font-size:12px;color:#cbd5e1}.eq-pay-size select{width:100%;background:#0f172a!important;color:#f8fafc!important;border:1px solid #475569!important}
        .eq-pay-own{grid-area:action;align-self:start;margin:0;flex-shrink:0;cursor:pointer;border:1px solid rgba(148,163,184,.38);border-radius:999px;background:transparent;color:#cbd5e1;font:inherit;font-weight:700;padding:6px 12px;white-space:nowrap}.eq-pay-own:hover:not(:disabled){border-color:#38bdf8;color:#38bdf8}.eq-pay-own.is-cancel{border-color:rgba(251,191,36,.55);background:rgba(251,191,36,.08);color:#fcd34d}.eq-pay-own:disabled{opacity:.5;cursor:default}
        .eq-pay-note{display:grid;gap:6px;margin-top:10px;padding:12px;border:1px solid rgba(56,189,248,.28);border-radius:12px;background:rgba(56,189,248,.07);color:#cbd5e1;font-size:12px;line-height:1.55}.eq-pay-note.eq-pay-item-note{grid-area:note;margin-top:0}.eq-pay-note strong{color:#7dd3fc}.eq-pay-note-warning{color:#fcd34d;font-weight:700}
        .eq-pay-summary{display:grid;gap:8px;margin-top:14px;padding:14px;border-radius:14px;background:rgba(2,6,23,.55)}.eq-pay-summary>div{display:flex;justify-content:space-between}.eq-pay-summary .is-discount{color:#6ee7b7}.eq-pay-summary .is-total{border-top:1px solid rgba(148,163,184,.22);padding-top:10px;font-size:18px}.eq-pay-summary small{color:#94a3b8;line-height:1.5}
        .eq-pay-error{margin-top:12px;padding:10px;border-radius:10px;background:rgba(248,113,113,.12);color:#fca5a5;font-size:13px}.eq-pay-cta{width:100%;display:flex;justify-content:center;align-items:center;gap:8px;margin-top:14px;padding:13px 18px;border:0;border-radius:12px;background:linear-gradient(135deg,#38bdf8,#0284c7);color:white;font:inherit;font-weight:900;cursor:pointer}.eq-pay-cta:disabled{opacity:.5;cursor:default}
        .eq-payment-frame{padding:12px}.eq-frame-summary{display:flex;gap:10px;align-items:center;padding:7px 7px 13px}.eq-frame-summary small{color:#6ee7b7}.eq-frame-summary strong{margin-inline-start:auto;font-size:20px}.eq-pay-iframe{width:100%;border:0;border-radius:14px;background:white;display:block}
        @media(max-width:560px){.eq-pay-page{padding:10px 8px 28px}.eq-pay-header,.eq-pay-card{border-radius:17px}.eq-pay-brand{font-size:25px;gap:7px}.eq-pay-brand img{width:94px;height:94px}.eq-pay-required{align-items:flex-start;padding:13px}.eq-pay-required strong{font-size:16px}.eq-pay-required span{font-size:13px}.eq-pay-item{grid-template-columns:20px minmax(0,1fr);grid-template-areas:"check details" ". action";row-gap:10px;padding:12px}.eq-pay-item.has-note{grid-template-areas:"check details" ". action" "note note"}.eq-pay-own{justify-self:end}.eq-member{align-items:flex-start;flex-wrap:wrap}.eq-member>b{width:100%;margin-inline-start:32px}.eq-frame-summary{flex-wrap:wrap}}
      `}</style>
    </div>
  );
}
