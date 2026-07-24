import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart, Plus, Minus, Trash2, Search, User, CreditCard,
  Banknote, Link2, FileText, Send, CheckCircle2, X,
} from 'lucide-react';

const PAY_METHODS = [
  { id: 'cash', label: 'מזומן', icon: Banknote },
  { id: 'emv', label: 'אשראי במסוף', icon: CreditCard },
  { id: 'online', label: 'סליקה בקישור', icon: Link2 },
];

function productTypeLabel(type) {
  if (type === 'punch_card') return 'כרטיסייה';
  if (type === 'time_membership') return 'מנוי';
  return 'מוצר';
}

export default function PosSale() {
  const [pricelist, setPricelist] = useState([]);
  const [students, setStudents] = useState([]);
  const [parents, setParents] = useState([]);
  const [cart, setCart] = useState([]);
  const [productFilter, setProductFilter] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [sendEmail, setSendEmail] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [recentSales, setRecentSales] = useState([]);
  const [lastPayUrl, setLastPayUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [pRes, sRes, parRes, salesRes] = await Promise.all([
        fetch('/api/pricelist'),
        fetch('/api/students'),
        fetch('/api/parents'),
        fetch('/api/pos/sales'),
      ]);
      const [p, s, par, sales] = await Promise.all([
        pRes.ok ? pRes.json() : [],
        sRes.ok ? sRes.json() : [],
        parRes.ok ? parRes.json() : [],
        salesRes.ok ? salesRes.json() : [],
      ]);
      setPricelist(Array.isArray(p) ? p.filter((i) => i.active !== false) : []);
      setStudents(Array.isArray(s) ? s : []);
      setParents(Array.isArray(par) ? par : []);
      setRecentSales(Array.isArray(sales) ? sales.slice(0, 12) : []);
      if (!sRes.ok || !parRes.ok) {
        setLoadError('לא הצלחנו לטעון לקוחות — נסו לרענן');
      } else {
        setLoadError('');
      }
    } catch (err) {
      console.error(err);
      setLoadError('לא הצלחנו לטעון לקוחות — נסו לרענן');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedStudent = students.find((s) => s.id === selectedStudentId) || null;
  const selectedParent =
    parents.find((p) => p.id === selectedParentId) ||
    (selectedStudent
      ? parents.find((p) => p.id === selectedStudent.parentId)
      : null) ||
    null;

  const childrenOfSelectedParent = useMemo(() => {
    if (!selectedParent?.id) return [];
    return students.filter((s) => String(s.parentId) === String(selectedParent.id));
  }, [students, selectedParent]);

  const effectivePhone = walkInPhone || selectedParent?.phone || '';
  const effectiveEmail = walkInEmail || selectedParent?.email || '';

  const filteredProducts = useMemo(() => {
    const q = productFilter.trim().toLowerCase();
    if (!q) return pricelist;
    return pricelist.filter(
      (item) =>
        String(item.name || '').toLowerCase().includes(q) ||
        String(item.category || '').toLowerCase().includes(q) ||
        (item.categories || []).some((c) => String(c).toLowerCase().includes(q))
    );
  }, [pricelist, productFilter]);

  const normalizePhoneDigits = (phone) => String(phone || '').replace(/\D/g, '');

  const customerSuggestions = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    const phoneQ = normalizePhoneDigits(customerQuery);
    const results = [];

    for (const parent of parents) {
      const name = String(parent.name || '').toLowerCase();
      const phone = normalizePhoneDigits(parent.phone);
      const email = String(parent.email || '').toLowerCase();
      if (
        name.includes(q) ||
        email.includes(q) ||
        (phoneQ.length >= 3 && phone.includes(phoneQ))
      ) {
        results.push({
          key: `parent:${parent.id}`,
          type: 'parent',
          id: parent.id,
          name: parent.name || 'לקוח',
          phone: parent.phone || '',
          email: parent.email || '',
        });
      }
    }

    for (const student of students) {
      const name = String(student.name || '').toLowerCase();
      if (!name.includes(q)) continue;
      const parent = parents.find((p) => p.id === student.parentId);
      results.push({
        key: `student:${student.id}`,
        type: 'student',
        id: student.id,
        name: student.name || 'מתאמן',
        parentId: student.parentId || null,
        parentName: parent?.name || '',
        phone: parent?.phone || '',
        email: parent?.email || '',
      });
    }

    return results.slice(0, 12);
  }, [customerQuery, parents, students]);

  const selectCustomer = (hit) => {
    if (hit.type === 'student') {
      setSelectedStudentId(hit.id);
      setSelectedParentId(hit.parentId || '');
      setWalkInName('');
      setWalkInPhone(hit.phone || '');
      setWalkInEmail(hit.email || '');
    } else {
      setSelectedParentId(hit.id);
      setSelectedStudentId('');
      setWalkInName('');
      setWalkInPhone(hit.phone || '');
      setWalkInEmail(hit.email || '');
    }
    setCustomerQuery('');
    setError('');
  };

  const clearCustomer = () => {
    setSelectedStudentId('');
    setSelectedParentId('');
    setCustomerQuery('');
  };

  const total = cart.reduce(
    (sum, line) => sum + (Number(line.unitprice) || 0) * (Number(line.quantity) || 1),
    0
  );

  const needsCustomer = cart.some(
    (line) => line.product_type === 'punch_card' || line.product_type === 'time_membership'
  );

  const addToCart = (item) => {
    setResult(null);
    setError('');
    setCart((prev) => {
      const existing = prev.find((l) => l.pricelist_id === item.id);
      if (existing) {
        return prev.map((l) =>
          l.pricelist_id === item.id
            ? { ...l, quantity: (Number(l.quantity) || 1) + 1 }
            : l
        );
      }
      return [
        ...prev,
        {
          pricelist_id: item.id,
          name: item.name,
          description: item.name,
          unitprice: Number(item.price) || 0,
          quantity: 1,
          product_type: item.product_type || 'product',
        },
      ];
    });
  };

  const setQty = (id, qty) => {
    const n = Math.max(1, Number(qty) || 1);
    setCart((prev) =>
      prev.map((l) => (l.pricelist_id === id ? { ...l, quantity: n } : l))
    );
  };

  const removeLine = (id) => {
    setCart((prev) => prev.filter((l) => l.pricelist_id !== id));
  };

  const copyPayUrl = async (url) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('העתיקו את הקישור:', url);
    }
  };

  const payloadBase = () => ({
    cart,
    studentId: selectedStudentId || undefined,
    parentId: selectedParent?.id || selectedParentId || undefined,
    walkInName: walkInName || selectedParent?.name || undefined,
    walkInPhone: effectivePhone || undefined,
    walkInEmail: effectiveEmail || undefined,
    sendEmail,
    sendWhatsapp,
  });

  const validate = () => {
    if (!cart.length) {
      setError('הוסיפו לפחות פריט אחד לעגלה');
      return false;
    }
    if (needsCustomer && !selectedStudentId) {
      setError('למנוי או כרטיסייה חובה לבחור מתאמן (אפשר לחפש הורה ואז לבחור ילד)');
      return false;
    }
    if (sendWhatsapp && !String(effectivePhone || '').trim()) {
      setError('לשליחה בוואטסאפ חובה למלא טלפון, או לבטל את הסימון');
      return false;
    }
    if (sendEmail && !String(effectiveEmail || '').trim()) {
      setError('לשליחה למייל חובה למלא כתובת מייל, או לבטל את הסימון');
      return false;
    }
    return true;
  };

  const runAction = async (endpoint, extra = {}) => {
    if (!validate()) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payloadBase(), ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הפעולה נכשלה');
      setResult(data);

      const payUrl = data.payUrl || data.sale?.payment_url || '';
      if (payUrl) {
        setLastPayUrl(payUrl);
        // Open the payment page so staff can verify / hand the device to the customer
        window.open(payUrl, '_blank', 'noopener,noreferrer');
      }

      if (data.whatsappUrl && sendWhatsapp) {
        window.open(data.whatsappUrl, '_blank', 'noopener,noreferrer');
      } else if (sendWhatsapp && payUrl && !data.whatsappUrl) {
        setError('הקישור נוצר, אבל לא נפתח וואטסאפ — בדקו מספר טלפון');
      }

      // Clear cart after any successful checkout action
      setCart([]);
      refresh();
    } catch (err) {
      setError(err.message || 'שגיאה');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckout = async () => {
    if (paymentMethod === 'online') {
      await runAction('/api/pos/payment-link');
      return;
    }
    await runAction('/api/pos/sale', { paymentMethod });
  };

  return (
    <div className="grid-2" style={{ alignItems: 'flex-start', gap: 20 }}>
      <div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingCart size={16} /> בחירת מוצרים
          </div>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
            <input
              className="input"
              style={{ paddingRight: 34 }}
              placeholder="חיפוש במחירון..."
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, maxHeight: 420, overflow: 'auto' }}>
            {filteredProducts.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => addToCart(item)}
                className="card"
                style={{
                  padding: 12,
                  textAlign: 'right',
                  cursor: 'pointer',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-2)',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                  {productTypeLabel(item.product_type)}
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: 'var(--text-1)' }}>
                  {item.name}
                </div>
                <div style={{ fontWeight: 800, color: 'var(--accent, #F59E0B)' }}>
                  ₪{Number(item.price || 0).toLocaleString()}
                </div>
                {item.product_type === 'punch_card' && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    {item.visits_total || 10} כניסות
                  </div>
                )}
                {item.product_type === 'time_membership' && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    {item.duration_days || 30} ימים
                  </div>
                )}
                {item.track_inventory && item.stock_qty != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    מלאי: {item.stock_qty}
                  </div>
                )}
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 12 }}>אין פריטים תואמים</div>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="card card-p" style={{ marginBottom: 16, overflow: 'visible' }}>
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={16} /> לקוח
          </div>
          {loadError && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>{loadError}</div>
          )}
          <div className="form-group" style={{ marginBottom: 10, position: 'relative', zIndex: 30 }}>
            <label className="form-label">
              חיפוש לקוח {needsCustomer ? '*' : '(רשות)'}
            </label>
            <input
              className="input"
              placeholder="שם לקוח, מתאמן או טלפון..."
              value={
                selectedStudent
                  ? selectedStudent.name
                  : selectedParent && !customerQuery
                    ? selectedParent.name
                    : customerQuery
              }
              onChange={(e) => {
                setSelectedStudentId('');
                setSelectedParentId('');
                setCustomerQuery(e.target.value);
              }}
              onFocus={() => {
                if (selectedStudent || selectedParent) {
                  setCustomerQuery('');
                }
              }}
              autoComplete="off"
            />
            {customerQuery.trim() && !selectedStudentId && customerSuggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  zIndex: 50,
                  right: 0,
                  left: 0,
                  top: '100%',
                  marginTop: 4,
                  maxHeight: 260,
                  overflow: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: 'var(--bg-1, #111827)',
                  boxShadow: '0 12px 28px rgba(0,0,0,0.45)',
                }}
              >
                {customerSuggestions.map((hit) => (
                  <button
                    key={hit.key}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      borderRadius: 0,
                      gap: 8,
                      padding: '10px 12px',
                    }}
                    onClick={() => selectCustomer(hit)}
                  >
                    <span style={{ fontWeight: 700 }}>{hit.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {hit.type === 'parent' ? 'לקוח / הורה' : 'מתאמן'}
                      {hit.parentName ? ` · ${hit.parentName}` : ''}
                      {hit.phone ? ` · ${hit.phone}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {customerQuery.trim().length >= 1 && customerSuggestions.length === 0 && !selectedStudentId && !selectedParentId && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
                לא נמצאו לקוחות תואמים · אפשר למלא למטה כלקוח מזדמן
              </div>
            )}
          </div>

          {(selectedStudent || selectedParent) && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>
                נבחר:{' '}
                <strong>
                  {selectedStudent
                    ? selectedStudent.name
                    : selectedParent?.name}
                </strong>
                {selectedStudent && selectedParent?.name ? ` · הורה: ${selectedParent.name}` : ''}
                {!selectedStudent && selectedParent ? ' · לקוח' : ''}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearCustomer}>
                <X size={12} /> נקה
              </button>
            </div>
          )}

          {selectedParent && !selectedStudent && childrenOfSelectedParent.length > 0 && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">בחירת מתאמן מהמשפחה</label>
              <select
                className="input select"
                value=""
                onChange={(e) => {
                  if (e.target.value) setSelectedStudentId(e.target.value);
                }}
              >
                <option value="">— בחרו מתאמן —</option>
                {childrenOfSelectedParent.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="form-grid-2" style={{ gap: 8 }}>
            <div className="form-group">
              <label className="form-label">שם לקוח מזדמן</label>
              <input className="input input-sm" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="אופציונלי" />
            </div>
            <div className="form-group">
              <label className="form-label">טלפון</label>
              <input
                className="input input-sm"
                value={walkInPhone}
                onChange={(e) => setWalkInPhone(e.target.value)}
                placeholder={selectedParent?.phone || '050...'}
              />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">מייל לשליחת מסמך</label>
              <input
                className="input input-sm"
                value={walkInEmail}
                onChange={(e) => setWalkInEmail(e.target.value)}
                placeholder={selectedParent?.email || 'name@email.com'}
              />
              {!walkInEmail && selectedParent?.email && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  יישלח אל המייל של הלקוח אם לא תמלאו אחר
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card card-p" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginBottom: 12 }}>עגלה</div>
          {cart.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: 16 }}>העגלה ריקה</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cart.map((line) => (
                <div
                  key={line.pricelist_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{line.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {productTypeLabel(line.product_type)} · ₪{line.unitprice}
                    </div>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQty(line.pricelist_id, line.quantity - 1)}>
                    <Minus size={12} />
                  </button>
                  <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{line.quantity}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQty(line.pricelist_id, line.quantity + 1)}>
                    <Plus size={12} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLine(line.pricelist_id)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 800, fontSize: 18 }}>
                <span>סה״כ</span>
                <span>₪{total.toLocaleString()}</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {PAY_METHODS.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`btn btn-sm ${paymentMethod === m.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPaymentMethod(m.id)}
                >
                  <Icon size={13} /> {m.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              שליחה למייל
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={sendWhatsapp} onChange={(e) => setSendWhatsapp(e.target.checked)} />
              שליחה לוואטסאפ
            </label>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>
          )}
          {(lastPayUrl || result?.payUrl) && (
            <div
              className="alert alert-success"
              style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <CheckCircle2 size={14} />
                קישור תשלום מוכן
                {result?.passes?.length ? ` · הופעלו ${result.passes.length} כרטיסים/מנויים` : ''}
              </div>
              <div
                style={{
                  fontSize: 12,
                  wordBreak: 'break-all',
                  direction: 'ltr',
                  textAlign: 'left',
                  background: 'rgba(0,0,0,0.2)',
                  padding: '8px 10px',
                  borderRadius: 8,
                }}
              >
                {lastPayUrl || result.payUrl}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  className="btn btn-primary btn-sm"
                  href={lastPayUrl || result.payUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Link2 size={13} /> פתח עמוד סליקה
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyPayUrl(lastPayUrl || result.payUrl)}
                >
                  {copied ? 'הועתק!' : 'העתק קישור'}
                </button>
              </div>
            </div>
          )}
          {result && !result.payUrl && !lastPayUrl && (
            <div className="alert alert-success" style={{ marginTop: 12 }}>
              <CheckCircle2 size={14} />
              <span>
                {result.doc?.docnum
                  ? `מסמך ${result.doc.docnum} הופק`
                  : 'הפעולה הושלמה'}
                {result.passes?.length ? ` · הופעלו ${result.passes.length} כרטיסים/מנויים` : ''}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1, paddingBlock: 12 }}
              disabled={busy}
              onClick={handleCheckout}
            >
              {busy ? 'מעבד...' : paymentMethod === 'online' ? 'צור קישור תשלום' : 'גבה והפק חשבונית'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => runAction('/api/pos/quote', { sendEmail: true })}
              title="הצעת מחיר"
            >
              <FileText size={14} /> הצעת מחיר
            </button>
          </div>
          {paymentMethod === 'online' && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
              אחרי יצירת הקישור ייפתח עמוד הסליקה. אפשר גם להעתיק ולשלוח ללקוח.
              {sendWhatsapp ? ' לשליחה בוואטסאפ חובה טלפון.' : ''}
            </div>
          )}
          {paymentMethod === 'emv' && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
              סלקו במסוף ואז לחצו על גבייה — המערכת תפיק חשבונית מס קבלה.
            </div>
          )}
        </div>

        <div className="card card-p">
          <div className="section-title" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Send size={14} /> מכירות אחרונות
          </div>
          {recentSales.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>עדיין אין מכירות</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recentSales.map((sale) => {
                const payUrl = sale.payment_url || '';
                const statusLabel =
                  sale.status === 'quoted'
                    ? 'הצעה'
                    : sale.status === 'pending_payment'
                      ? 'ממתין לתשלום'
                      : 'שולם';
                return (
                  <div
                    key={sale.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      fontSize: 12,
                      paddingBottom: 8,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--text-2)' }}>
                        {sale.customer_name || 'לקוח'} · {statusLabel}
                        {sale.icount_doc_number ? ` · מס׳ ${sale.icount_doc_number}` : ''}
                      </span>
                      <strong>₪{Number(sale.total || 0).toLocaleString()}</strong>
                    </div>
                    {payUrl && sale.status === 'pending_payment' && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <a
                          className="btn btn-primary btn-sm"
                          href={payUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: 11 }}
                        >
                          פתח קישור סליקה
                        </a>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11 }}
                          onClick={() => copyPayUrl(payUrl)}
                        >
                          העתק
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
