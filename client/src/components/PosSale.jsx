import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingCart, Plus, Minus, Trash2, Search, User,
  Banknote, Link2, FileText, CheckCircle2, X, Percent, Tag,
  Package, ArrowRight, Gift, Send, Settings2,
} from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  DEFAULT_CATEGORY_COLOR,
  normalizeCategories,
  imageBackground,
  imageFitOf,
  productImageOf,
} from './productCategories.js';
import AppSelect from './AppSelect.jsx';
import CancellationPolicyPreview from './CancellationPolicyPreview.jsx';
import CashCountModal from './CashCountModal.jsx';
import EmployeeSelect from './EmployeeSelect.jsx';
import { printReceiptFromSale, openInvoiceFallback, thermalSupported } from '../utils/thermalPrinter.js';

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

/** `onManageProducts` opens the catalogue tab — omitted for non-owners. */
export default function PosSale({
  onManageProducts = null,
  employees = [],
  isOwner = false,
  requireSeller = false,
  // מסוף הכניסה מגיע לכאן כשהמתאמן כבר עומד מול הדלפק ונבחר במסך הקבלה —
  // הקלדת השם פעם שנייה היא בדיוק המקום שבו נבחר הלקוח הלא נכון.
  initialStudentId = '',
  // חלונית נוספת מתחת ללקוח הנבחר. מסוף הכניסה שותל בה את אישור הכניסה
  // והניקוב, כדי שבחירת הלקוח, מצב המסמכים והקופה יהיו על מסך אחד.
  renderCustomerExtra = null,
  // מסוף הכניסה קובע את אחראי הקופה למעלה, לכל המשמרת. בורר עובד באמצע כל
  // מכירה הוא שאלה שנשאלת שוב ושוב על תשובה שלא משתנה.
  sellerEmployeeId = '',
  hideInvoiceContactEditor = false,
}) {
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
  const [reloadKey, setReloadKey] = useState(0);
  const [editingDiscountId, setEditingDiscountId] = useState(null);
  const [discountDraft, setDiscountDraft] = useState({ type: 'percent', value: '' });
  const [customerCoupons, setCustomerCoupons] = useState([]);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponError, setCouponError] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [resendingLink, setResendingLink] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [resendOk, setResendOk] = useState(false);
  const [showContactFields, setShowContactFields] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customDraft, setCustomDraft] = useState({ name: '', price: '', quantity: '1' });
  const [cashSessionOpen, setCashSessionOpen] = useState(false);
  const [tenderedAmount, setTenderedAmount] = useState('');
  const [lastChange, setLastChange] = useState(null);
  const [cashClosedHint, setCashClosedHint] = useState(false);
  const [showOpenCash, setShowOpenCash] = useState(false);
  const [cancellationAccepted, setCancellationAccepted] = useState(false);
  // Who the last attempt refused to sell to, and the link sent instead.
  const [documentsBlock, setDocumentsBlock] = useState(null);
  const [documentsLink, setDocumentsLink] = useState(null);
  const [sendingDocsLink, setSendingDocsLink] = useState(false);
  const [sellerId, setSellerId] = useState('');
  // אחראי הקופה שנקבע במסוף גובר: המכירה נרשמת עליו בלי לשאול שוב.
  useEffect(() => {
    if (sellerEmployeeId) setSellerId(sellerEmployeeId);
  }, [sellerEmployeeId]);

  const activeEmployees = useMemo(
    () => (employees || []).filter((employee) => employee?.is_active !== false),
    [employees]
  );
  const seller = activeEmployees.find((employee) => employee.id === sellerId) || null;

  useEffect(() => {
    if (sellerId && !activeEmployees.some((employee) => employee.id === sellerId)) setSellerId('');
  }, [activeEmployees, sellerId]);

  useEffect(() => {
    if (!cashSessionOpen && paymentMethod === 'cash') {
      setPaymentMethod('online');
    }
    if (cashSessionOpen) {
      setCashClosedHint(false);
      setShowOpenCash(false);
    }
  }, [cashSessionOpen, paymentMethod]);

  const refresh = useCallback(async () => {
    try {
      const [pRes, sRes, parRes, cRes, sessRes] = await Promise.all([
        fetch('/api/pricelist'),
        fetch('/api/students'),
        fetch('/api/parents'),
        fetch('/api/product-categories'),
        fetch('/api/cash-register/session'),
      ]);
      const [p, s, par, cats, sess] = await Promise.all([
        pRes.ok ? pRes.json() : [],
        sRes.ok ? sRes.json() : [],
        parRes.ok ? parRes.json() : [],
        cRes.ok ? cRes.json() : [],
        sessRes.ok
          ? sessRes.json().catch(() => ({ can_sell_cash: false }))
          : Promise.resolve({ can_sell_cash: false }),
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
      setCashSessionOpen(!!sess?.can_sell_cash);
      if (Array.isArray(cats) && cats.length) {
        setCatalogCategories(cats.filter((c) => c.active !== false));
      }
      if (!sRes.ok || !parRes.ok) {
        throw new Error('טעינת הלקוחות נכשלה');
      }
      setLoadError('');
      return true;
    } catch (err) {
      console.error(err);
      setLoadError('לא הצלחנו לטעון לקוחות — מנסה שוב...');
      return false;
    }
  }, []);

  // A restarting API used to leave this screen empty until someone reloaded by
  // hand — and an empty catalogue looks like missing products, not an outage.
  // Retry with backoff, the same way the app shell loads its core data.
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let attempt = 0;

    const load = async () => {
      const ok = await refresh();
      if (cancelled || ok) return;
      if (attempt >= 8) {
        setLoadError('לא הצלחנו לטעון לקוחות — בדקו שהשרת פועל ונסו שוב');
        return;
      }
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      attempt += 1;
      timer = setTimeout(load, delay);
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh, reloadKey]);

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

  const normalizePhoneDigits = (phone) => String(phone || '').replace(/\D/g, '');

  const customerSuggestions = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    const phoneQ = normalizePhoneDigits(customerQuery);
    const normName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

    const parentHits = [];
    for (const parent of parents) {
      const name = String(parent.name || '').toLowerCase();
      const phone = normalizePhoneDigits(parent.phone);
      const email = String(parent.email || '').toLowerCase();
      if (
        name.includes(q) ||
        email.includes(q) ||
        (phoneQ.length >= 3 && phone.includes(phoneQ))
      ) {
        parentHits.push({
          key: `parent:${parent.id}`,
          type: 'parent',
          id: parent.id,
          name: parent.name || 'לקוח',
          phone: parent.phone || '',
          email: parent.email || '',
        });
      }
    }

    const studentHits = [];
    for (const student of students) {
      const name = String(student.name || '').toLowerCase();
      if (!name.includes(q)) continue;
      const parent = parents.find((p) => p.id === student.parentId);
      studentHits.push({
        key: `student:${student.id}`,
        type: 'student',
        id: student.id,
        name: student.name || 'מתאמן',
        parentId: student.parentId || null,
        parentName: parent?.name || '',
        phone: parent?.phone || '',
        email: parent?.email || '',
        // An adult who climbs is their own customer — the student record and
        // the parent record are the same person, not a household of two.
        isSelfCustomer: Boolean(student.parentId) && normName(student.name) === normName(parent?.name),
      });
    }

    // The same person must not appear twice. Keep the trainee row — picking it
    // selects both the customer and the trainee in one tap.
    const selfParentIds = new Set(
      studentHits.filter((hit) => hit.isSelfCustomer).map((hit) => String(hit.parentId))
    );
    return [
      ...parentHits.filter((hit) => !selfParentIds.has(String(hit.id))),
      ...studentHits,
    ].slice(0, 12);
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
    setShowContactFields(false);
  };

  // בחירת הלקוח שהגיע מבחוץ. נעשית פעם אחת לכל מזהה, כדי שניקוי הלקוח בידיים
  // לא יחזיר אותו מיד.
  const appliedInitialRef = useRef('');
  useEffect(() => {
    if (!initialStudentId || !students.length) return;
    if (appliedInitialRef.current === initialStudentId) return;
    const student = students.find((s) => String(s.id) === String(initialStudentId));
    if (!student) return;
    appliedInitialRef.current = initialStudentId;
    const parent = parents.find((p) => String(p.id) === String(student.parentId));
    setSelectedStudentId(student.id);
    setSelectedParentId(student.parentId || '');
    setWalkInName(parent?.name || student.name || '');
    setWalkInPhone(parent?.phone || student.phone || '');
    setWalkInEmail(parent?.email || student.email || '');
    setCustomerQuery('');
    setError('');
  }, [initialStudentId, students, parents]);

  const pendingNewLeadName =
    !selectedParent && !selectedStudent ? String(customerQuery || walkInName || '').trim() : '';
  const isPendingNewLead = Boolean(pendingNewLeadName);
  const showNewLeadBanner =
    isPendingNewLead && (customerSuggestions.length === 0 || hideSuggestions);

  // One search line covers name / phone / email of an existing customer. The
  // contact fields are only for details the sale cannot proceed without: a brand
  // new walk-in, or a selected customer missing the channel we are sending on.
  const hasSelectedCustomer = Boolean(selectedStudent || selectedParent);
  const missingSendTarget =
    hasSelectedCustomer &&
    ((sendWhatsapp && !effectivePhone.trim()) || (sendEmail && !effectiveEmail.trim()));
  const contactFieldsVisible = isPendingNewLead || missingSendTarget || showContactFields;

  const cartTotal = cart.reduce(
    (sum, line) => sum + (Number(line.unitprice) || 0) * (Number(line.quantity) || 1),
    0
  );
  const couponDiscount = appliedCoupon ? Number(appliedCoupon.discount) || 0 : 0;
  const total = roundMoney(Math.max(0, cartTotal - couponDiscount));
  const activeCancellationPolicies = useMemo(() => {
    const byVersion = new Map();
    for (const line of cart) {
      const product = pricelist.find((item) => String(item.id) === String(line.pricelist_id));
      const snapshot = line.cancellation_policy || product?.cancellation_policy;
      if (snapshot?.version_id) byVersion.set(snapshot.version_id, snapshot);
    }
    return [...byVersion.values()];
  }, [cart, pricelist]);

  useEffect(() => {
    setCancellationAccepted(false);
  }, [cart.map((line) => `${line.pricelist_id}:${line.quantity}`).join('|')]);

  const needsCustomer = cart.some(
    (line) => line.product_type === 'punch_card' || line.product_type === 'time_membership'
  );

  // Benefits waiting for whoever is at the counter right now.
  useEffect(() => {
    setAppliedCoupon(null);
    setCouponError('');
    if (!selectedParentId && !selectedStudentId) {
      setCustomerCoupons([]);
      return;
    }
    const params = new URLSearchParams();
    if (selectedParentId) params.set('parentId', selectedParentId);
    if (selectedStudentId) params.set('studentId', selectedStudentId);
    let cancelled = false;
    fetch(`/api/pos/coupons?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => { if (!cancelled) setCustomerCoupons(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setCustomerCoupons([]); });
    return () => { cancelled = true; };
  }, [selectedParentId, selectedStudentId]);

  /**
   * Ask the server what the coupon is worth against this cart. The answer is a
   * preview only — the sale route recomputes it before the discount is given.
   */
  const applyCoupon = async (coupon) => {
    setCouponBusy(true);
    setCouponError('');
    try {
      const res = await fetch('/api/pos/coupon-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart,
          couponId: coupon.id,
          parentId: selectedParentId || undefined,
          studentId: selectedStudentId || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'לא ניתן להשתמש בהטבה');
      setAppliedCoupon({ id: coupon.id, code: coupon.code, label: coupon.label, discount: body.discount });
    } catch (err) {
      setAppliedCoupon(null);
      setCouponError(err.message);
    } finally {
      setCouponBusy(false);
    }
  };

  // The cart changed under an applied benefit — re-price it rather than keep a
  // discount that no longer matches what is being bought.
  useEffect(() => {
    if (!appliedCoupon) return;
    const coupon = customerCoupons.find((c) => c.id === appliedCoupon.id);
    if (!coupon) return;
    applyCoupon(coupon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.length, cartTotal]);

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
          cancellation_policy: item.cancellation_policy || null,
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

  /**
   * Send an existing link again. Deliberately separate from creating one: a new
   * link would mean a second sale, and would re-reserve the customer's benefit.
   */
  const resendPaymentLink = async (sale) => {
    setResendingLink(true);
    setResendMsg('');
    try {
      const res = await fetch(`/api/pos/sales/${sale.id}/send-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'השליחה נכשלה');
      if (body.whatsappSent) {
        setResendOk(!body.deliveryWarning);
        setResendMsg(
          body.deliveryWarning || 'הקישור נשלח ללקוח בוואטסאפ בתבנית מאושרת'
        );
      } else if (body.whatsappUrl) {
        window.open(body.whatsappUrl, '_blank', 'noopener,noreferrer');
        setResendOk(false);
        setResendMsg('השליחה האוטומטית נכשלה — נפתח וואטסאפ לשליחה ידנית');
      } else {
        setResendOk(false);
        setResendMsg(body.whatsappError || 'השליחה נכשלה');
      }
    } catch (err) {
      setResendOk(false);
      setResendMsg(err.message);
    } finally {
      setResendingLink(false);
    }
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
    cancellationPolicyAccepted: cancellationAccepted,
    seller_employee_id: seller?.id || undefined,
    seller_name: seller?.name || undefined,
  });

  const validate = () => {
    if (!cart.length) {
      setError('הוסיפו לפחות פריט אחד לעגלה');
      return false;
    }
    if (requireSeller && !seller) {
      setError('יש לבחור מי מבצע את המכירה');
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
    if (paymentMethod === 'cash' && !cashSessionOpen) {
      setError('אי אפשר לגבות במזומן בלי לפתוח קופה קודם — עברו ללשונית פתיחה / סגירה, או גבו בסליקה בקישור');
      return false;
    }
    if (paymentMethod === 'cash' && Number(total) > 0) {
      const tendered = Number(tenderedAmount);
      if (!(tendered >= total - 0.001)) {
        setError('סכום שהתקבל מהלקוח חייב להיות לפחות כמו סכום העגלה');
        return false;
      }
    }
    if (activeCancellationPolicies.length && !cancellationAccepted) {
      setError('יש להציג ללקוח את מדיניות הביטול ולסמן שהוא אישר אותה');
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
    setResendMsg('');
    setDocumentsBlock(null);
    setDocumentsLink(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payloadBase(), ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw Object.assign(new Error(data.error || 'הפעולה נכשלה'), {
          code: data.code,
          blocked: data.blocked,
        });
      }
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

      if (data.changeGiven != null) {
        setLastChange(Number(data.changeGiven));
      }
      if (data.receiptBytes?.base64) {
        try {
          await printReceiptFromSale(data.receiptBytes);
        } catch (printErr) {
          console.warn('thermal print failed', printErr);
          const docUrl = data.doc?.docUrl || data.sale?.icount_doc_url;
          if (docUrl) openInvoiceFallback(docUrl);
          setError(
            thermalSupported()
              ? 'המכירה נקלטה, אבל ההדפסה נכשלה — בדקו את חיבור המדפסת או פתחו את החשבונית מהקישור'
              : 'המכירה נקלטה. הדפסה ישירה לא זמינה בדפדפן הזה — נפתחה החשבונית להדפסה רגילה'
          );
        }
      }

      // Clear cart after any successful checkout action
      setCart([]);
      setTenderedAmount('');
      setShowQuoteOptions(false);
      if (data.isNewLead || (!selectedParentId && !selectedStudentId && pendingNewLeadName)) {
        clearCustomer();
      }
      refresh();
    } catch (err) {
      setError(err.message || 'שגיאה');
      // The cart is intact and the customer is standing here — offer to send
      // them the forms instead of leaving the staff member with a dead end.
      if (err.code === 'wall_documents_required') {
        setDocumentsBlock(err.blocked?.length ? err.blocked : []);
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hand the whole cart to the customer as one link: sign what is missing, pay
   * at the end. No sale is opened here — the customer's signature is what opens
   * it, and only the payment closes it.
   */
  const sendDocumentsLink = async () => {
    setSendingDocsLink(true);
    setError('');
    try {
      const res = await fetch('/api/pos/documents-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payloadBase(),
          sendWhatsapp: true,
          couponCode: appliedCoupon?.code || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'יצירת הקישור נכשלה');
      setDocumentsLink(data);
      setDocumentsBlock(null);
      setCart([]);
    } catch (err) {
      setError(err.message || 'יצירת הקישור נכשלה');
    } finally {
      setSendingDocsLink(false);
    }
  };

  const handleCheckout = async () => {
    const couponCode = appliedCoupon?.code || undefined;
    if (paymentMethod === 'online') {
      // The link carries the discounted amount and the benefit is held aside
      // until the payment actually lands.
      await runAction('/api/pos/payment-link', { couponCode });
      return;
    }
    const tendered = tenderedAmount === '' ? total : Number(tenderedAmount);
    await runAction('/api/pos/sale', {
      paymentMethod,
      couponCode,
      tenderedAmount: tendered,
    });
  };

  // A medical hold is a decision, not missing paperwork: no form lifts it, so
  // the link is not offered for it.
  const documentsHold = !!documentsBlock?.some((gap) => gap.blocked);

  const changePreview = useMemo(() => {
    if (paymentMethod !== 'cash') return null;
    const tendered = Number(tenderedAmount);
    if (!(tendered >= 0) || Number.isNaN(tendered)) return null;
    return roundMoney(tendered - total);
  }, [paymentMethod, tenderedAmount, total]);

  const selectPaymentMethod = (id) => {
    if (id === 'cash' && !cashSessionOpen) {
      setPaymentMethod('online');
      setCashClosedHint(true);
      return;
    }
    setCashClosedHint(false);
    setPaymentMethod(id);
    if (id === 'cash' && tenderedAmount === '') {
      setTenderedAmount(String(total));
    }
  };

  const handleCashOpened = async () => {
    setCashSessionOpen(true);
    setCashClosedHint(false);
    setShowOpenCash(false);
    setPaymentMethod('cash');
    setTenderedAmount((prev) => (prev === '' ? String(total) : prev));
    await refresh();
  };

  return (
    <>
    <div className="grid-2" style={{ alignItems: 'flex-start', gap: 20 }}>
      <div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingCart size={16} /> בחירת מוצרים
            {onManageProducts && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginInlineStart: 'auto', fontWeight: 500 }}
                onClick={onManageProducts}
                title="הוספה, עריכה ומחיקה של קטגוריות ומוצרים"
              >
                <Settings2 size={14} /> ניהול קטגוריות
              </button>
            )}
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
                background: 'var(--bg-input)',
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
            // No height cap: every category has to be reachable without scrolling.
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: 10,
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
                      textAlign: 'center',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <div style={{
                      height: 104,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: imageBackground(
                        category,
                        'var(--bg-input)'
                      ),
                    }}>
                      {!category.image && <Icon size={44} color={c.text} strokeWidth={1.6} />}
                    </div>
                    {/* Grows into the leftover height so names stay centred when a
                        neighbour in the row wraps to two lines. */}
                    <div style={{
                      flex: 1,
                      padding: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.3, color: 'var(--text-1)' }}>
                        {category.name}
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
                    overflow: 'hidden',
                  }}
                >
                  {productImageOf(item) && (
                    <img
                      src={productImageOf(item)}
                      alt={item.name}
                      style={{ display: 'block', width: '100%', height: 86, objectFit: imageFitOf(item) }}
                    />
                  )}
                  <div style={{ padding: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>
                      {productTypeLabel(item.product_type)}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--text-1)' }}>
                      {item.name}
                    </div>
                    <div style={{ fontWeight: 800, color: 'var(--accent, #F59E0B)' }}>
                      ₪{Number(item.price || 0).toLocaleString()}
                    </div>
                    {item.product_type === 'punch_card' && (
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                        {item.visits_total || 10} כניסות
                      </div>
                    )}
                    {item.product_type === 'time_membership' && (
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                        {item.duration_days || 30} ימים
                      </div>
                    )}
                    {item.track_inventory && item.stock_qty != null && (
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
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
            <div
              className="alert alert-error"
              style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
            >
              <span style={{ flex: 1 }}>{loadError}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => { setLoadError(''); setReloadKey((n) => n + 1); }}
              >
                נסו שוב
              </button>
            </div>
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
                  {selectedStudent && selectedParent?.name && selectedParent.name.trim() !== String(selectedStudent.name || '').trim()
                    ? `הורה: ${selectedParent.name} · `
                    : ''}
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
                לקוח — שם, טלפון או מייל {needsCustomer ? '*' : ''}
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
                  placeholder="שם, טלפון או מייל — או שם של לקוח חדש..."
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
                        {hit.type === 'parent' ? 'לקוח / הורה' : hit.isSelfCustomer ? 'לקוח · מתאמן' : 'מתאמן'}
                        {hit.parentName && !hit.isSelfCustomer ? ` · ${hit.parentName}` : ''}
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
              <AppSelect
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
              </AppSelect>
            </div>
          )}

          {typeof renderCustomerExtra === 'function' && renderCustomerExtra({
            studentId: selectedStudentId,
            student: selectedStudent || null,
            // מסוף הכניסה מציע מכאן כניסה בודדת או כרטיסייה ישירות לעגלה, כדי
            // שהמוכר לא יחפש אותן בקטלוג בזמן שהמתאמן עומד מולו.
            addToCart,
            wallProducts: pricelist.filter((item) => item.grants_wall_climbing === true),
            cartCount: cart.length,
          })}

          {contactFieldsVisible ? (
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
          ) : (
            (selectedStudent || selectedParent) && !hideInvoiceContactEditor && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setShowContactFields(true)}
              >
                עריכת טלפון / מייל לחשבונית
              </button>
            )
          )}
        </div>

        <div className="card card-p" style={{ marginBottom: 16, position: 'relative', zIndex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div className="section-title" style={{ marginBottom: 0 }}>עגלה</div>
              {!cashSessionOpen && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setShowOpenCash(true);
                    setCashClosedHint(false);
                  }}
                >
                  פתח קופה
                </button>
              )}
            </div>
            <span
              className={`badge ${cashSessionOpen ? 'badge-green' : 'badge-amber'}`}
              style={{ fontWeight: 700 }}
            >
              {cashSessionOpen ? 'קופה פתוחה' : 'קופה סגורה'}
            </span>
          </div>

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
                          background: 'var(--bg-input)',
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
              {appliedCoupon && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 13, color: 'var(--green)' }}>
                  <span>הטבה · {appliedCoupon.label} ({appliedCoupon.code})</span>
                  <span>−₪{couponDiscount.toLocaleString()}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 800, fontSize: 18 }}>
                <span>סה״כ כולל מע״מ</span>
                <span>₪{total.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Benefits the selected customer is holding */}
          {customerCoupons.length > 0 && (
            <div
              className="card card-p"
              style={{ marginTop: 12, borderColor: 'var(--green)', background: 'rgba(52,211,153,0.06)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, marginBottom: 8 }}>
                <Gift size={14} /> יש ללקוח הטבה
              </div>
              {customerCoupons.map((coupon) => {
                const isApplied = appliedCoupon?.id === coupon.id;
                return (
                  <div
                    key={coupon.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '5px 0' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{coupon.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {coupon.recurring
                          ? `הנחה קבועה · קוד ${coupon.code}`
                          : coupon.expires_at
                            ? `קוד ${coupon.code} · בתוקף עד ${coupon.expires_at}`
                            : `קוד ${coupon.code} · ללא תוקף`}
                        {!coupon.recurring && coupon.days_left != null ? ` · עוד ${coupon.days_left} ימים` : ''}
                      </div>
                    </div>
                    {isApplied ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => { setAppliedCoupon(null); setCouponError(''); }}
                      >
                        הסרה
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-success btn-xs"
                        disabled={couponBusy || !cart.length}
                        onClick={() => applyCoupon(coupon)}
                      >
                        {couponBusy ? 'בודק...' : 'החלה'}
                      </button>
                    )}
                  </div>
                );
              })}
              {couponError && (
                <div style={{ fontSize: 11, color: '#fb7185', marginTop: 6 }}>{couponError}</div>
              )}
              {!cart.length && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                  הוסיפו פריט לעגלה כדי להחיל את ההטבה
                </div>
              )}
              {paymentMethod === 'online' && appliedCoupon && !customerCoupons.find((c) => c.id === appliedCoupon.id)?.recurring && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                  הקישור ייווצר עם הסכום אחרי ההנחה. ההטבה תישמר בצד עד שהתשלום ייקלט,
                  ואם הקישור לא ישולם תוך שבוע היא תחזור ללקוח.
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {PAY_METHODS.map((m) => {
              const Icon = m.icon;
              const cashBlocked = m.id === 'cash' && !cashSessionOpen;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`btn btn-sm ${paymentMethod === m.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => selectPaymentMethod(m.id)}
                  title={cashBlocked ? 'יש לפתוח קופה לפני גבייה במזומן' : undefined}
                  style={cashBlocked ? { opacity: 0.55 } : undefined}
                >
                  <Icon size={13} /> {m.label}
                </button>
              );
            })}
          </div>

          {requireSeller && !sellerEmployeeId && (
            <label className="pos-seller-field">
              <span><User size={14} /> מי מבצע את המכירה?</span>
              <EmployeeSelect
                employees={activeEmployees}
                value={sellerId}
                placeholder="בחירת עובד"
                aria-label="מי מבצע את המכירה"
                onChange={(employee) => setSellerId(employee?.id || '')}
              />
              <small>העובד יירשם במכירה וביומן הקופה; חשבון המחשב נשאר רק אמצעי כניסה.</small>
            </label>
          )}

          {cashClosedHint && !cashSessionOpen && (
            <div className="alert alert-warn" style={{ marginTop: 10, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>הקופה סגורה — אי אפשר לגבות במזומן לפני פתיחת משמרת.</div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  setShowOpenCash(true);
                  setCashClosedHint(false);
                }}
              >
                פתח קופה
              </button>
            </div>
          )}

          {paymentMethod === 'cash' && cashSessionOpen && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-input)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                התקבל מהלקוח (ש״ח)
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={tenderedAmount}
                  onChange={(e) => setTenderedAmount(e.target.value)}
                  style={{ marginTop: 6 }}
                />
              </label>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {changePreview == null
                  ? 'הזינו כמה התקבל מהלקוח'
                  : changePreview < 0
                    ? `חסרים ₪${Math.abs(changePreview).toFixed(2)}`
                    : `עודף להחזר: ₪${changePreview.toFixed(2)}`}
              </div>
            </div>
          )}

          {lastChange != null && lastChange > 0 && (
            <div className="alert alert-success" style={{ marginTop: 10, fontSize: 16, fontWeight: 800 }}>
              עודף להחזר ללקוח: ₪{Number(lastChange).toFixed(2)}
            </div>
          )}

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

          {activeCancellationPolicies.length > 0 && (
            <div className="alert alert-warn" style={{ marginTop: 12, display: 'block' }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>מדיניות ביטול ותנאים להצגה ללקוח</div>
              {activeCancellationPolicies.map((policy) => (
                <div key={policy.version_id} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{policy.policy_name}</div>
                  <CancellationPolicyPreview policy={policy} />
                </div>
              ))}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={cancellationAccepted}
                  onChange={(event) => setCancellationAccepted(event.target.checked)}
                  style={{ marginTop: 3 }}
                />
                הצגתי ללקוח את התנאים והלקוח אישר אותם
              </label>
            </div>
          )}

          {error && (
            <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>
          )}
          {documentsBlock && (
            <div
              className="alert alert-warn"
              style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div style={{ fontWeight: 800 }}>חסרים מסמכים לטיפוס בקיר</div>
              {documentsBlock.length > 0 && (
                <ul style={{ margin: 0, paddingInlineStart: 20, lineHeight: 1.7, fontSize: 13 }}>
                  {documentsBlock.map((gap) => (
                    <li key={gap.student_id}>
                      <strong>{gap.name}</strong> — {gap.blocked
                        ? 'קיימת חסימה רפואית — נדרש בירור מול הצוות'
                        : [
                          gap.missing?.includes('health')
                            ? (gap.health_state === 'expired' ? 'הצהרת בריאות שפגה' : 'הצהרת בריאות')
                            : null,
                          gap.missing?.includes('waiver')
                            ? (gap.waiver_state === 'expired' ? 'אישור טיפוס בקיר שפג' : 'אישור טיפוס בקיר')
                            : null,
                        ].filter(Boolean).join(' · ')}
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ fontSize: 12 }}>
                {documentsHold
                  ? 'חסימה רפואית לא נפתרת בטופס חדש — יש לפנות למנהל לפני מכירה.'
                  : `שליחת קישור ללקוח: הוא ממלא וחותם על מה שחסר, ובסוף משלם ₪${Number(total || 0).toLocaleString('he-IL')}. הכרטיסייה נכנסת לתיק רק אחרי התשלום.`}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!documentsHold && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={sendingDocsLink}
                    onClick={sendDocumentsLink}
                  >
                    <Send size={13} />
                    {sendingDocsLink ? 'שולח...' : 'שלח קישור להשלמה ותשלום'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setDocumentsBlock(null)}
                >
                  <X size={13} /> סגירה
                </button>
              </div>
            </div>
          )}
          {documentsLink && (
            <div
              className="alert alert-success"
              style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <CheckCircle2 size={14} />
                קישור להשלמת מסמכים ותשלום נוצר
                {documentsLink.whatsappSent ? ' · נשלח בוואטסאפ' : ''}
              </div>
              {documentsLink.whatsappError && (
                <div className="alert alert-warn" style={{ fontSize: 12, margin: 0 }}>
                  {documentsLink.whatsappError}
                </div>
              )}
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
                {documentsLink.pageUrl}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => copyPayUrl(documentsLink.pageUrl)}
                >
                  {copied ? 'הועתק!' : 'העתק קישור'}
                </button>
              </div>
              <div style={{ fontSize: 12 }}>
                מעקב אחרי הקישור והתשלום נמצא בלשונית «קישורים ללקוח».
              </div>
            </div>
          )}
          {(lastPayUrl || result?.shareUrl || result?.payUrl) && (
            <div
              className="alert alert-success"
              style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                <CheckCircle2 size={14} />
                {result?.doc?.docnum ? 'הצעת מחיר וקישור תשלום מוכנים' : 'קישור תשלום מוכן'}
                {result?.whatsappSent
                  ? result.whatsappVia === 'template'
                    ? ' · נשלח בתבנית מאושרת'
                    : ' · נשלח כטקסט חופשי'
                  : ''}
                {result?.passes?.length ? ` · הופעלו ${result.passes.length} כרטיסים/מנויים` : ''}
              </div>
              {result?.deliveryWarning && (
                <div className="alert alert-warn" style={{ fontSize: 12, margin: 0 }}>
                  {result.deliveryWarning}
                </div>
              )}
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
                {result?.sale?.id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={resendingLink}
                    onClick={() => resendPaymentLink(result.sale)}
                  >
                    <Send size={13} />
                    {resendingLink
                      ? 'שולח...'
                      : result?.whatsappSent
                        ? 'שליחה חוזרת בוואטסאפ'
                        : 'שליחה ללקוח בוואטסאפ'}
                  </button>
                )}
              </div>
              {resendMsg && (
                <div style={{ fontSize: 12, color: resendOk ? 'inherit' : '#fb7185' }}>
                  {resendMsg}
                </div>
              )}
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
                background: 'var(--bg-input)',
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

    {showOpenCash && !cashSessionOpen && (
      <CashCountModal
        mode="open"
        employees={employees}
        onClose={() => setShowOpenCash(false)}
        onSuccess={handleCashOpened}
      />
    )}
    </>
  );
}
