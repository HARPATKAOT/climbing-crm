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
  const [studentQuery, setStudentQuery] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
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

  const refresh = useCallback(async () => {
    try {
      const [p, s, par, sales] = await Promise.all([
        fetch('/api/pricelist').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/students').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/parents').then((r) => (r.ok ? r.json() : [])),
        fetch('/api/pos/sales').then((r) => (r.ok ? r.json() : [])),
      ]);
      setPricelist(Array.isArray(p) ? p.filter((i) => i.active !== false) : []);
      setStudents(Array.isArray(s) ? s : []);
      setParents(Array.isArray(par) ? par : []);
      setRecentSales(Array.isArray(sales) ? sales.slice(0, 12) : []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedStudent = students.find((s) => s.id === selectedStudentId) || null;
  const selectedParent = selectedStudent
    ? parents.find((p) => p.id === selectedStudent.parentId)
    : null;

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

  const studentSuggestions = useMemo(() => {
    const q = studentQuery.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter((s) => String(s.name || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [students, studentQuery]);

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

  const payloadBase = () => ({
    cart,
    studentId: selectedStudentId || undefined,
    parentId: selectedParent?.id || undefined,
    walkInName: walkInName || undefined,
    walkInPhone: walkInPhone || undefined,
    walkInEmail: walkInEmail || selectedParent?.email || undefined,
    sendEmail,
    sendWhatsapp,
  });

  const validate = () => {
    if (!cart.length) {
      setError('הוסיפו לפחות פריט אחד לעגלה');
      return false;
    }
    if (needsCustomer && !selectedStudentId) {
      setError('למנוי או כרטיסייה חובה לבחור מתאמן');
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
      if (data.whatsappUrl && sendWhatsapp) {
        window.open(data.whatsappUrl, '_blank');
      }
      if (endpoint !== '/api/pos/payment-link' || data.sale?.status === 'paid') {
        setCart([]);
      }
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
        <div className="card card-p" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={16} /> לקוח
          </div>
          <div className="form-group" style={{ marginBottom: 10, position: 'relative' }}>
            <label className="form-label">חיפוש מתאמן {needsCustomer ? '*' : '(רשות)'}</label>
            <input
              className="input"
              placeholder="שם מתאמן..."
              value={selectedStudent ? selectedStudent.name : studentQuery}
              onChange={(e) => {
                setSelectedStudentId('');
                setStudentQuery(e.target.value);
              }}
            />
            {studentSuggestions.length > 0 && !selectedStudentId && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  zIndex: 20,
                  right: 0,
                  left: 0,
                  top: '100%',
                  marginTop: 4,
                  maxHeight: 200,
                  overflow: 'auto',
                  border: '1px solid var(--border)',
                }}
              >
                {studentSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: '100%', justifyContent: 'flex-start', borderRadius: 0 }}
                    onClick={() => {
                      setSelectedStudentId(s.id);
                      setStudentQuery('');
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedStudent && (
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>
                נבחר: <strong>{selectedStudent.name}</strong>
                {selectedParent?.name ? ` · הורה: ${selectedParent.name}` : ''}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedStudentId('')}>
                <X size={12} /> נקה
              </button>
            </div>
          )}
          <div className="form-grid-2" style={{ gap: 8 }}>
            <div className="form-group">
              <label className="form-label">שם לקוח מזדמן</label>
              <input className="input input-sm" value={walkInName} onChange={(e) => setWalkInName(e.target.value)} placeholder="אופציונלי" />
            </div>
            <div className="form-group">
              <label className="form-label">טלפון</label>
              <input className="input input-sm" value={walkInPhone} onChange={(e) => setWalkInPhone(e.target.value)} placeholder="050..." />
            </div>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <label className="form-label">מייל לשליחת מסמך</label>
              <input
                className="input input-sm"
                value={walkInEmail || selectedParent?.email || ''}
                onChange={(e) => setWalkInEmail(e.target.value)}
                placeholder="name@email.com"
              />
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
          {result && (
            <div className="alert alert-success" style={{ marginTop: 12 }}>
              <CheckCircle2 size={14} />
              <span>
                {result.doc?.docnum
                  ? `מסמך ${result.doc.docnum} הופק`
                  : result.payUrl
                    ? 'קישור תשלום מוכן'
                    : 'הפעולה הושלמה'}
                {result.passes?.length ? ` · הופעלו ${result.passes.length} כרטיסים/מנויים` : ''}
              </span>
              {result.payUrl && (
                <a href={result.payUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)', marginRight: 8 }}>
                  פתח קישור
                </a>
              )}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recentSales.map((sale) => (
                <div key={sale.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
                  <span style={{ color: 'var(--text-2)' }}>
                    {sale.customer_name || 'לקוח'} · {sale.status === 'quoted' ? 'הצעה' : sale.status === 'pending_payment' ? 'ממתין' : 'שולם'}
                    {sale.icount_doc_number ? ` · מס׳ ${sale.icount_doc_number}` : ''}
                  </span>
                  <strong>₪{Number(sale.total || 0).toLocaleString()}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
