import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart, Plus, Minus, Trash2, Search, User,
  Banknote, Link2, FileText, CheckCircle2, X, Percent, Tag,
  Package, ArrowRight,
} from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  DEFAULT_CATEGORY_COLOR,
  normalizeCategories,
} from './productCategories.js';

const PAY_METHODS = [
  { id: 'cash', label: 'מזומן', icon: Banknote },
  { id: 'online', label: 'סליקה בקישור', icon: Link2 },
];

function productTypeLabel(type) {
  if (type === 'punch_card') return 'כרטיסייה';
  if (type === 'time_membership') return 'מנוי';
  if (type === 'custom') return 'מותאם';
  return 'מוצר';
}

function makeCartLineId() {
  return `cl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function applyLineDiscount(listPrice, discountType, discountValue) {
  const base = Number(listPrice) || 0;
  const val = Number(discountValue) || 0;
  if (val <= 0) return roundMoney(base);
  if (discountType === 'percent') {
    return roundMoney(Math.max(0, base * (1 - Math.min(val, 100) / 100)));
  }
  return roundMoney(Math.max(0, base - val));
}

export default function PosSale() {
  const [pricelist, setPricelist] = useState([]);
  const [students, setStudents] = useState([]);
  const [parents, setParents] = useState([]);
  const [cart, setCart] = useState([]);
  const [productFilter, setProductFilter] = useState('');
  const [activeCat, setActiveCat] = useState('הכל');
  const [catalogCategories, setCatalogCategories] = useState(
    PRODUCT_CATEGORIES.map((name) => ({ name, image: '', description: '' }))
  );
  const [customerQuery, setCustomerQuery] = useState('');
  const [hideSuggestions, setHideSuggestions] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [walkInName, setWalkInName] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [sendEmail, setSendEmail] = useState(false);
  const [sendWhatsapp, setSendWhatsapp] = useState(true);
  const [quoteIncludePaymentLink, setQuoteIncludePaymentLink] = useState(true);
  const [showQuoteOptions, setShowQuoteOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [lastPayUrl, setLastPayUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editingDiscountId, setEditingDiscountId] = useState(null);
  const [discountDraft, setDiscountDraft] = useState({ type: 'percent', value: '' });
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customDraft, setCustomDraft] = useState({ name: '', price: '', quantity: '1' });

  const refresh = useCallback(async () => {
    try {
      const [pRes, sRes, parRes, cRes] = await Promise.all([
        fetch('/api/pricelist'),
        fetch('/api/students'),
        fetch('/api/parents'),
        fetch('/api/product-categories'),
      ]);
      const [p, s, par, cats] = await Promise.all([
        pRes.ok ? pRes.json() : [],
        sRes.ok ? sRes.json() : [],
        parRes.ok ? parRes.json() : [],
        cRes.ok ? cRes.json() : [],
      ]);
      setPricelist(
        Array.isArray(p)
          ? p
              .filter((i) => i.active !== false)
              .map((i) => ({
                ...i,
                categories: normalizeCategories(
                  Array.isArray(i.categories) ? i.categories : i.category ? [i.category] : []
                ),
              }))
          : []
      );
      setStudents(Array.isArray(s) ? s : []);
      setParents(Array.isArray(par) ? par : []);
      if (Array.isArray(cats) && cats.length) {
        setCatalogCategories(cats.filter((c) => c.active !== false));
      }
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
    return pricelist.filter((item) => {
      if (activeCat !== 'הכל' && !(item.categories || []).includes(activeCat)) return false;
      if (!q) return true;
      return (
        String(item.name || '').toLowerCase().includes(q) ||
        String(item.category || '').toLowerCase().includes(q) ||
        (item.categories || []).some((c) => String(c).toLowerCase().includes(q))
      );
    });
  }, [pricelist, productFilter, activeCat]);

  const categoryCounts = useMemo(() => {
    const counts = {};
    for (const item of pricelist) {
      for (const category of item.categories || []) {
        counts[category] = (counts[category] || 0) + 1;
      }
    }
    return counts;
  }, [pricelist]);

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
    if (hit.type === 'new_lead') {
      setSelectedStudentId('');
      setSelectedParentId('');
      setWalkInName(hit.name || customerQuery.trim());
      setCustomerQuery(hit.name || customerQuery.trim());
      setHideSuggestions(true);
      setError('');
      return;
    }
    if (hit.type === 'student') {
      setSelectedStudentId(hit.id);
      setSelectedParentId(hit.parentId || '');
      setWalkInName(hit.parentName || hit.name || '');
      setWalkInPhone(hit.phone || '');
      setWalkInEmail(hit.email || '');
    } else {
      setSelectedParentId(hit.id);
      setSelectedStudentId('');
      setWalkInName(hit.name || '');
      setWalkInPhone(hit.phone || '');
      setWalkInEmail(hit.email || '');
    }
    setCustomerQuery('');
    setHideSuggestions(false);
    setError('');
  };

  const clearCustomer = () => {
    setSelectedStudentId('');
    setSelectedParentId('');
    setCustomerQuery('');
    setHideSuggestions(false);
    setWalkInName('');
    setWalkInPhone('');
    setWalkInEmail('');
  };

  const pendingNewLeadName =
    !selectedParent && !selectedStudent ? String(customerQuery || walkInName || '').trim() : '';
  const isPendingNewLead = Boolean(pendingNewLeadName);
  const showNewLeadBanner =
    isPendingNewLead && (customerSuggestions.length === 0 || hideSuggestions);

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
      const existing = prev.find(
        (l) => l.pricelist_id === item.id && !l.isCustom && l.unitprice === (Number(item.price) || 0)
      );
      if (existing) {
        return prev.map((l) =>
          l.cartLineId === existing.cartLineId
            ? { ...l, quantity: (Number(l.quantity) || 1) + 1 }
            : l
        );
      }
      const price = Number(item.price) || 0;
      return [
        ...prev,
        {
          cartLineId: makeCartLineId(),
          pricelist_id: item.id,
          name: item.name,
          description: item.name,
          listPrice: price,
          unitprice: price,
          quantity: 1,
          product_type: item.product_type || 'product',
          discountType: null,
          discountValue: 0,
          isCustom: false,
        },
      ];
    });
  };

  const addCustomProduct = () => {
    const name = String(customDraft.name || '').trim();
    const price = Number(customDraft.price);
    const quantity = Math.max(1, Number(customDraft.quantity) || 1);
    if (!name) {
      setError('מלאו שם למוצר בהתאמה אישית');
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      setError('מלאו מחיר תקין למוצר בהתאמה אישית');
      return;
    }
    setResult(null);
    setError('');
    setCart((prev) => [
      ...prev,
      {
        cartLineId: makeCartLineId(),
        pricelist_id: null,
        name,
        description: name,
        listPrice: roundMoney(price),
        unitprice: roundMoney(price),
        quantity,
        product_type: 'product',
        discountType: null,
        discountValue: 0,
        isCustom: true,
      },
    ]);
    setCustomDraft({ name: '', price: '', quantity: '1' });
    setShowCustomForm(false);
  };

  const setQty = (cartLineId, qty) => {
    const n = Math.max(1, Math.round(Number(qty) || 1));
    setCart((prev) =>
      prev.map((l) => (l.cartLineId === cartLineId ? { ...l, quantity: n } : l))
    );
  };

  const removeLine = (cartLineId) => {
    setCart((prev) => prev.filter((l) => l.cartLineId !== cartLineId));
    if (editingDiscountId === cartLineId) setEditingDiscountId(null);
  };

  const openDiscountEditor = (line) => {
    setEditingDiscountId(line.cartLineId);
    setDiscountDraft({
      type: line.discountType || 'percent',
      value: line.discountValue ? String(line.discountValue) : '',
    });
  };

  const applyDiscountToLine = (cartLineId) => {
    const type = discountDraft.type === 'amount' ? 'amount' : 'percent';
    const value = Number(discountDraft.value) || 0;
    setCart((prev) =>
      prev.map((l) => {
        if (l.cartLineId !== cartLineId) return l;
        const listPrice = Number(l.listPrice ?? l.unitprice) || 0;
        return {
          ...l,
          listPrice,
          unitprice: applyLineDiscount(listPrice, type, value),
          discountType: value > 0 ? type : null,
          discountValue: value > 0 ? value : 0,
        };
      })
    );
    setEditingDiscountId(null);
  };

  const clearLineDiscount = (cartLineId) => {
    setCart((prev) =>
      prev.map((l) => {
        if (l.cartLineId !== cartLineId) return l;
        const listPrice = Number(l.listPrice ?? l.unitprice) || 0;
        return {
          ...l,
          unitprice: listPrice,
          discountType: null,
          discountValue: 0,
        };
      })
    );
    setEditingDiscountId(null);
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

  const resolvedWalkInName =
    selectedParent || selectedStudent
      ? walkInName || selectedParent?.name || selectedStudent?.name || ''
      : pendingNewLeadName;

  const payloadBase = () => ({
    cart,
    studentId: selectedStudentId || undefined,
    parentId: selectedParent?.id || selectedParentId || undefined,
    walkInName: resolvedWalkInName || undefined,
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
    if (isPendingNewLead && !String(effectivePhone || '').trim()) {
      setError('לליד חדש חובה למלא טלפון (או לבחור לקוח קיים מהרשימה)');
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
    if (paymentMethod === 'online' && !(Number(total) > 0)) {
      setError('לא ניתן ליצור קישור תשלום לסכום 0 — עמוד הסליקה יציג מחיר ברירת מחדל. שינוי מחיר או גבייה במזומן');
      return false;
    }
    return true;
  };

  const validateQuote = () => {
    if (!validate()) return false;
    if (quoteIncludePaymentLink && !(Number(total) > 0)) {
      setError('לא ניתן לכלול קישור תשלום בסכום 0 — בטלו את הסימון או שנו מחיר');
      return false;
    }
    return true;
  };

  const runAction = async (endpoint, extra = {}, { validateFn = validate } = {}) => {
    if (!validateFn()) return;
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

      const payUrl = data.shareUrl || data.payUrl || data.sale?.payment_url || '';
      if (payUrl) {
        setLastPayUrl(payUrl);
        // When WhatsApp send is requested, don't auto-open the payment page —
        // a second popup is often blocked, and the customer gets the link instead.
        if (!sendWhatsapp) {
          window.open(payUrl, '_blank', 'noopener,noreferrer');
        }
      }

      if (sendWhatsapp) {
        if (data.whatsappSent) {
          // Sent via Meta API — nothing else to open
        } else if (data.whatsappUrl) {
          window.open(data.whatsappUrl, '_blank', 'noopener,noreferrer');
          if (data.whatsappError) {
            setError('הקישור נוצר. שליחה אוטומטית נכשלה — נפתח וואטסאפ לשליחה ידנית');
          }
        } else {
          setError('הקישור נוצר, אבל לא נשלח בוואטסאפ — בדקו מספר טלפון');
        }
      }

      // Clear cart after any successful checkout action
      setCart([]);
      setShowQuoteOptions(false);
      if (data.isNewLead || (!selectedParentId && !selectedStudentId && pendingNewLeadName)) {
        clearCustomer();
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
              placeholder="חיפוש מוצר..."
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
            />
          </div>
          {activeCat !== 'הכל' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setActiveCat('הכל');
                  setProductFilter('');
                }}
              >
                <ArrowRight size={14} /> חזרה לקטגוריות
              </button>
              <strong style={{ fontSize: 13 }}>{activeCat}</strong>
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginBottom: 12, display: 'flex', justifyContent: 'center', gap: 6}}
            onClick={() => {
              setShowCustomForm((v) => !v);
              setError('');
            }}
          >
            <Tag size={13} />
            {showCustomForm ? 'סגור מוצר בהתאמה אישית' : 'הוסף מוצר בהתאמה אישית'}
          </button>
          {showCustomForm && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-2)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">שם המוצר</label>
                <input
                  className="input input-sm"
                  value={customDraft.name}
                  onChange={(e) => setCustomDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="למשל: השכרת נעליים"
                />
              </div>
              <div className="form-grid-2" style={{ gap: 8 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">מחיר</label>
                  <input
                    className="input input-sm"
                    type="number"
                    min="0"
                    step="0.01"
                    value={customDraft.price}
                    onChange={(e) => setCustomDraft((d) => ({ ...d, price: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">כמות</label>
                  <input
                    className="input input-sm"
                    type="number"
                    min="1"
                    step="1"
                    value={customDraft.quantity}
                    onChange={(e) => setCustomDraft((d) => ({ ...d, quantity: e.target.value }))}
                  />
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={addCustomProduct}>
                <Plus size={13} /> הוסף לעגלה
              </button>
            </div>
          )}
          {activeCat === 'הכל' && !productFilter.trim() ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: 10,
              maxHeight: 440,
              overflow: 'auto',
            }}>
              {catalogCategories.map((category) => {
                const c = CATEGORY_COLORS[category.name] || DEFAULT_CATEGORY_COLOR;
                const Icon = CATEGORY_ICONS[category.name] || Package;
                return (
                  <button
                    key={category.id || category.name}
                    type="button"
                    onClick={() => setActiveCat(category.name)}
                    className="card"
                    style={{
                      padding: 0,
                      textAlign: 'right',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      border: `1px solid ${c.text}33`,
                      background: 'var(--bg-2)',
                    }}
                  >
                    <div style={{
                      height: 82,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: category.image
                        ? `center/cover no-repeat url(${category.image})`
                        : `linear-gradient(145deg, ${c.bg}, rgba(15,20,30,0.9))`,
                    }}>
                      {!category.image && <Icon size={28} color={c.text} strokeWidth={1.75} />}
                    </div>
                    <div style={{ padding: '9px 10px' }}>
                      <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-1)' }}>
                        {category.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
                        {categoryCounts[category.name] || 0} מוצרים
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 8,
              maxHeight: 420,
              overflow: 'auto',
            }}>
              {filteredProducts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addToCart(item)}
                  className="card"
                  style={{
                    padding: 0,
                    textAlign: 'right',
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-2)',
                    overflow: 'hidden',
                  }}
                >
                  {item.image && (
                    <img
                      src={item.image}
                      alt=""
                      style={{ display: 'block', width: '100%', height: 86, objectFit: 'cover' }}
                    />
                  )}
                  <div style={{ padding: 12 }}>
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
                  </div>
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 12 }}>אין פריטים תואמים</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
        <div
          className="card card-p"
          style={{ marginBottom: 16, overflow: 'visible', position: 'relative', zIndex: 60 }}
        >
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={16} /> לקוח לחיוב
          </div>
          {loadError && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>{loadError}</div>
          )}
          {!loadError && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>
              {parents.length} לקוחות · {students.length} מתאמנים במערכת
            </div>
          )}

          {(selectedStudent || selectedParent) && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(56,189,248,0.35)',
                background: 'rgba(56,189,248,0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--text-1)' }}>
                <div style={{ fontWeight: 800 }}>
                  {selectedStudent ? selectedStudent.name : selectedParent?.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {selectedStudent && selectedParent?.name ? `הורה: ${selectedParent.name} · ` : ''}
                  {effectivePhone || 'בלי טלפון'}
                  {effectiveEmail ? ` · ${effectiveEmail}` : ''}
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearCustomer}>
                <X size={12} /> החלף
              </button>
            </div>
          )}

          {!(selectedStudent || selectedParent) && (
            <div className="form-group" style={{ marginBottom: 10, position: 'relative', zIndex: 70 }}>
              <label className="form-label">
                חיפוש או שם לקוח חדש {needsCustomer ? '*' : ''}
              </label>
              <div style={{ position: 'relative' }}>
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-3)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  className="input"
                  style={{ paddingRight: 34 }}
                  placeholder="הקלידו שם או טלפון..."
                  value={customerQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCustomerQuery(value);
                    setWalkInName(value);
                    setHideSuggestions(false);
                  }}
                  autoComplete="off"
                />
              </div>
              {customerQuery.trim() && !hideSuggestions && (
                <div
                  style={{
                    position: 'absolute',
                    zIndex: 80,
                    right: 0,
                    left: 0,
                    top: '100%',
                    marginTop: 4,
                    maxHeight: 280,
                    overflow: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    background: 'var(--bg-card, #0f172a)',
                    boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
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
                        textAlign: 'right',
                      }}
                      onMouseDown={(e) => e.preventDefault()}
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
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      borderRadius: 0,
                      gap: 8,
                      padding: '10px 12px',
                      textAlign: 'right',
                      borderTop: customerSuggestions.length ? '1px solid var(--border)' : undefined,
                      color: 'var(--accent, #F59E0B)',
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      selectCustomer({
                        type: 'new_lead',
                        name: customerQuery.trim(),
                      })
                    }
                  >
                    <span style={{ fontWeight: 700 }}>ליד חדש: {customerQuery.trim()}</span>
                  </button>
                </div>
              )}
              {showNewLeadBanner && (
                <div style={{ fontSize: 12, color: 'var(--accent, #F59E0B)', marginTop: 6, fontWeight: 600 }}>
                  לא נמצא במערכת · יישמר אוטומטית כליד חדש במכירה
                </div>
              )}
            </div>
          )}

          {selectedParent && !selectedStudent && childrenOfSelectedParent.length > 0 && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">בחירת מתאמן מהמשפחה</label>
              <select
                className="input select"
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const student = students.find((s) => s.id === e.target.value);
                  if (!student) return;
                  selectCustomer({
                    type: 'student',
                    id: student.id,
                    name: student.name,
                    parentId: selectedParent.id,
                    parentName: selectedParent.name,
                    phone: selectedParent.phone || '',
                    email: selectedParent.email || '',
                  });
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
              <label className="form-label">טלפון {isPendingNewLead ? '*' : ''}</label>
              <input
                className="input input-sm"
                value={walkInPhone}
                onChange={(e) => setWalkInPhone(e.target.value)}
                placeholder={selectedParent?.phone || '050...'}
              />
            </div>
            <div className="form-group">
              <label className="form-label">מייל לשליחת מסמך</label>
              <input
                className="input input-sm"
                value={walkInEmail}
                onChange={(e) => setWalkInEmail(e.target.value)}
                placeholder={selectedParent?.email || 'name@email.com'}
              />
            </div>
          </div>
        </div>

        <div className="card card-p" style={{ marginBottom: 16, position: 'relative', zIndex: 1 }}>
          <div className="section-title" style={{ marginBottom: 12 }}>עגלה</div>
          {cart.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: 16 }}>העגלה ריקה</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cart.map((line) => {
                const hasDiscount =
                  line.discountType && Number(line.discountValue) > 0;
                const isEditingDiscount = editingDiscountId === line.cartLineId;
                return (
                  <div
                    key={line.cartLineId}
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {line.name}
                          {line.isCustom ? (
                            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}> · מותאם</span>
                          ) : null}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginTop: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={() =>
                              isEditingDiscount
                                ? setEditingDiscountId(null)
                                : openDiscountEditor(line)
                            }
                            title="הנחה"
                          >
                            <Percent size={11} /> הנחה
                          </button>
                          {hasDiscount && (
                            <span style={{ fontSize: 11, color: 'var(--accent, #F59E0B)' }}>
                              {line.discountType === 'percent'
                                ? `-${line.discountValue}%`
                                : `-₪${line.discountValue}`}
                              {Number(line.listPrice) !== Number(line.unitprice)
                                ? ` (מ־₪${line.listPrice})`
                                : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          flexShrink: 0,
                          paddingTop: 2,
                        }}
                        title="כמות יחידות"
                      >
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setQty(line.cartLineId, line.quantity - 1)}
                          aria-label="הקטנת כמות"
                        >
                          <Minus size={12} />
                        </button>
                        <input
                          className="input input-sm"
                          type="number"
                          min="1"
                          step="1"
                          value={line.quantity}
                          onChange={(e) => setQty(line.cartLineId, e.target.value)}
                          style={{
                            width: 56,
                            padding: '4px 6px',
                            fontSize: 13,
                            fontWeight: 700,
                            textAlign: 'center',
                          }}
                          title="מספר יחידות"
                          aria-label="כמות"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setQty(line.cartLineId, line.quantity + 1)}
                          aria-label="הגדלת כמות"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeLine(line.cartLineId)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    {isEditingDiscount && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 10,
                          borderRadius: 8,
                          background: 'var(--bg-2)',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className={`btn btn-sm ${discountDraft.type === 'percent' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setDiscountDraft((d) => ({ ...d, type: 'percent' }))}
                          >
                            לפי אחוז
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${discountDraft.type === 'amount' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setDiscountDraft((d) => ({ ...d, type: 'amount' }))}
                          >
                            לפי סכום
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            className="input input-sm"
                            type="number"
                            min="0"
                            step={discountDraft.type === 'percent' ? '1' : '0.01'}
                            placeholder={discountDraft.type === 'percent' ? 'למשל 10' : 'למשל 20'}
                            value={discountDraft.value}
                            onChange={(e) =>
                              setDiscountDraft((d) => ({ ...d, value: e.target.value }))
                            }
                            style={{ flex: 1 }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--text-3)', minWidth: 18 }}>
                            {discountDraft.type === 'percent' ? '%' : '₪'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => applyDiscountToLine(line.cartLineId)}
                          >
                            החל הנחה
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => clearLineDiscount(line.cartLineId)}
                          >
                            נקה הנחה
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setEditingDiscountId(null)}
                          >
                            ביטול
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 800, fontSize: 18 }}>
                <span>סה״כ כולל מע״מ</span>
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

          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13, flexWrap: 'wrap' }}>
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
          {(lastPayUrl || result?.shareUrl || result?.payUrl) && (
            <div
              className="alert alert-success"
              style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <CheckCircle2 size={14} />
                {result?.doc?.docnum ? 'הצעת מחיר וקישור תשלום מוכנים' : 'קישור תשלום מוכן'}
                {result?.whatsappSent ? ' · נשלח בוואטסאפ' : ''}
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
                {lastPayUrl || result.shareUrl || result.payUrl}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a
                  className="btn btn-primary btn-sm"
                  href={lastPayUrl || result.shareUrl || result.payUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Link2 size={13} /> פתח עמוד סליקה
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyPayUrl(lastPayUrl || result.shareUrl || result.payUrl)}
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
                {result.isNewLead ? ' · נשמר כליד חדש' : ''}
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
              onClick={() => {
                if (!showQuoteOptions) {
                  setShowQuoteOptions(true);
                  setError('');
                  return;
                }
                runAction(
                  '/api/pos/quote',
                  { includePaymentLink: quoteIncludePaymentLink },
                  { validateFn: validateQuote }
                );
              }}
              title={showQuoteOptions ? 'שליחת הצעת מחיר' : 'פתיחת אפשרויות הצעת מחיר'}
            >
              <FileText size={14} /> {showQuoteOptions ? 'שלח הצעה' : 'הצעת מחיר'}
            </button>
          </div>
          {showQuoteOptions && (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-2)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={quoteIncludePaymentLink}
                  onChange={(e) => setQuoteIncludePaymentLink(e.target.checked)}
                />
                הצעת מחיר עם קישור תשלום
              </label>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {quoteIncludePaymentLink
                  ? 'בהצעה ייכלל גם קישור לתשלום. אחרי תשלום תופק חשבונית אוטומטית.'
                  : 'תישלח הצעת מחיר בלבד, בלי קישור לתשלום.'}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: 'flex-start' }}
                disabled={busy}
                onClick={() => setShowQuoteOptions(false)}
              >
                <X size={13} /> ביטול
              </button>
            </div>
          )}
          {paymentMethod === 'online' && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
              {sendWhatsapp
                ? 'אחרי יצירת הקישור הוא יישלח בוואטסאפ ללקוח (חובה טלפון). אפשר גם להעתיק או לפתוח את עמוד הסליקה.'
                : 'אחרי יצירת הקישור ייפתח עמוד הסליקה. אפשר גם להעתיק ולשלוח ללקוח.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
