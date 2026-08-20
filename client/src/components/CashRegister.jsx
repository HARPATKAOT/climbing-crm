import React, { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { ReceiptText, RefreshCw, RotateCcw, Download, Loader2, Copy, ExternalLink, Search, X, Printer, ShoppingCart, Package, History, Wallet, BadgePercent, Ban, Mountain, Send, ChevronDown, MoreHorizontal } from 'lucide-react';
import EntityLink from '../utils/entityLinks.jsx';
import {
  downloadPaymentDocument,
  printPaymentDocument,
  refundPayment,
  sendPaymentDocument,
} from '../utils/paymentActions.js';
import PosSale from './PosSale.jsx';
import Pricelist from './Pricelist.jsx';
import AppSelect from './AppSelect.jsx';
import CashManagerPanel from './CashManagerPanel.jsx';
import DiscountCenter from './DiscountCenter.jsx';
import ActivityPriceBook from './ActivityPriceBook.jsx';

const DISCREPANCY_WINDOW_DAYS = 30;

function docAmount(doc) {
  const n = Number(doc?.totalwithvat ?? doc?.total ?? doc?.sum ?? 0);
  return Number.isNaN(n) ? 0 : n;
}

function docLabel(doc) {
  return (
    doc?.client_name ||
    doc?.clientname ||
    doc?.description ||
    doc?.comment ||
    doc?.docnum ||
    'מסמך'
  );
}

function docDate(doc) {
  const raw = doc?.docdate || doc?.doc_date || doc?.dateissued || doc?.timeissued || doc?.date || '';
  const s = String(raw);
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  }
  if (s.includes('T')) return new Date(s).toLocaleDateString('he-IL');
  return s || '—';
}

function payMethodLabel(method) {
  if (method === 'cash') return 'מזומן';
  if (method === 'emv' || method === 'credit' || method === 'cc') return 'אשראי במסוף';
  if (method === 'online') return 'סליקה בקישור';
  if (method === 'quote') return 'הצעת מחיר';
  return method || 'לא ידוע';
}

function payMethodBadge(method) {
  const m = String(method || '').toLowerCase();
  if (m === 'cash') return 'badge badge-gray';
  if (m === 'online') return 'badge badge-blue';
  if (m === 'emv' || m === 'credit' || m === 'cc' || m === 'card') {
    return 'badge badge-purple';
  }
  if (m === 'quote') return 'badge badge-amber';
  return 'badge';
}

function isCardPaymentMethod(method) {
  return ['emv', 'credit', 'cc', 'online', 'card'].includes(String(method || '').toLowerCase());
}

function saleStatusLabel(status) {
  if (status === 'paid') return 'שולם';
  if (status === 'pending_payment') return 'ממתין לתשלום';
  if (status === 'refunded') return 'זוכה';
  if (status === 'cancelled') return 'בוטל';
  if (status === 'quoted') return 'הצעה';
  return status || '—';
}

function saleStatusBadge(status) {
  if (status === 'paid') return 'badge badge-green';
  if (status === 'pending_payment') return 'badge badge-amber';
  if (status === 'refunded' || status === 'cancelled') return 'badge badge-red';
  return 'badge badge-gray';
}

function paymentStatusLabel(status) {
  return {
    paid: 'שולם',
    pending: 'ממתין לתשלום',
    open: 'חיוב פתוח',
    quoted: 'הצעת מחיר',
    partial_refund: 'זוכה חלקית',
    refunded: 'זוכה',
    cancelled: 'בוטל',
    failed: 'נכשל',
  }[status] || status || 'לא ידוע';
}

function paymentStatusBadge(status) {
  if (status === 'paid') return 'badge badge-green';
  if (status === 'pending' || status === 'open') return 'badge badge-amber';
  if (status === 'partial_refund') return 'badge badge-purple';
  if (status === 'refunded' || status === 'failed') return 'badge badge-red';
  return 'badge badge-gray';
}

const israelDay = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
};

function cashClosureDateTime(shift) {
  const timestamp = shift?.closed_at || shift?.created_at;
  if (!timestamp) return shift?.date || '—';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return shift?.date || '—';

  return date.toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function CashRegister({ isOwner = true, canResetCash = isOwner, sharedStation = false, initialTab = null }) {
  const [expectedAmount, setExpectedAmount] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [shiftType, setShiftType] = useState('בוקר');
  const [employee, setEmployee] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [shifts, setShifts] = useState([]);
  const [cashSession, setCashSession] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    const sharedTabs = ['sale', 'history'];
    const ownerTabs = ['products', 'activity-prices', 'discounts', 'manager', 'icount'];
    if (sharedTabs.includes(initialTab)) return initialTab;
    if (isOwner && ownerTabs.includes(initialTab)) return initialTab;
    return 'sale';
  });
  const [employees, setEmployees] = useState([]);

  const [icountStatus, setIcountStatus] = useState({ loading: true });
  const [icountDocs, setIcountDocs] = useState([]);
  const [icountLoading, setIcountLoading] = useState(false);
  const [docLinkBusyKey, setDocLinkBusyKey] = useState('');
  const [docLinkError, setDocLinkError] = useState('');
  const [payments, setPayments] = useState([]);
  const [posSales, setPosSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [refundBusyId, setRefundBusyId] = useState('');
  const [cancelBusyId, setCancelBusyId] = useState('');
  const [invoiceBusyKey, setInvoiceBusyKey] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyOk, setHistoryOk] = useState('');
  const [expandedSaleId, setExpandedSaleId] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyPaymentMethod, setHistoryPaymentMethod] = useState('all');
  const [historySort, setHistorySort] = useState('newest');
  const [reports, setReports] = useState(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [syncInventoryMsg, setSyncInventoryMsg] = useState('');
  const [expandedPaymentId, setExpandedPaymentId] = useState('');
  const [paymentActionBusyKey, setPaymentActionBusyKey] = useState('');
  const [paymentActionMessage, setPaymentActionMessage] = useState({ type: '', text: '' });

  const refreshRegister = useCallback(async () => {
    try {
      const data = await fetch('/api/cash-register').then((r) => (r.ok ? r.json() : []));
      setShifts(Array.isArray(data) ? data : []);
      const session = await fetch('/api/cash-register/session').then((r) => (r.ok ? r.json() : null));
      setCashSession(session && typeof session === 'object' ? session : null);
      const emps = await fetch('/api/employees').then((r) => (r.ok ? r.json() : []));
      const list = Array.isArray(emps) ? emps : [];
      setEmployees(list);
      if (isOwner && list.length && !employee) setEmployee(list[0].name);
    } catch (err) {
      console.error(err);
      setShifts([]);
      setCashSession(null);
    }
  }, [employee, isOwner]);

  const refreshSales = useCallback(async () => {
    setSalesLoading(true);
    setHistoryError('');
    try {
      const res = await fetch('/api/pos/sales');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || 'לא הצלחנו לטעון עסקאות');
      setPosSales(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setPosSales([]);
      setHistoryError(err.message || 'שגיאה בטעינת עסקאות');
    } finally {
      setSalesLoading(false);
    }
  }, []);

  const refreshReports = useCallback(async () => {
    if (!isOwner) return;
    setReportsLoading(true);
    try {
      const res = await fetch('/api/pos/reports?days=30');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'טעינת דוחות נכשלה');
      setReports(data);
    } catch (err) {
      console.error(err);
      setReports(null);
    } finally {
      setReportsLoading(false);
    }
  }, [isOwner]);

  const syncInventory = async () => {
    if (!isOwner) return;
    setSyncInventoryMsg('');
    try {
      const res = await fetch('/api/pos/sync-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: 5 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'סנכרון מלאי נכשל');
      setSyncInventoryMsg(
        data.mode === 'local'
          ? `מלאי מקומי · ${data.trackedCount} פריטים · ${data.lowStockCount} במלאי נמוך` +
            (data.remoteError ? ` (${data.remoteError})` : '')
          : `סונכרן · ${data.trackedCount} פריטים`
      );
      refreshReports();
    } catch (err) {
      setSyncInventoryMsg(err.message || 'סנכרון נכשל');
    }
  };

  const printSaleInvoice = (sale, kind = 'charge') => {
    const directUrl = kind === 'refund' ? sale?.refund_doc_url : sale?.icount_doc_url;
    const url =
      directUrl ||
      `/api/pos/sales/${encodeURIComponent(sale.id)}/invoice?kind=${encodeURIComponent(kind)}`;
    const win = window.open(url, '_blank', 'noopener');
    if (!win) {
      setHistoryError('הדפדפן חסם את חלון ההדפסה — אשרו חלונות קופצים ונסו שוב');
      return;
    }
    setHistoryError('');
    setHistoryOk('נפתחה החשבונית להדפסה — בחרו את המדפסת הטרמית בחלון ההדפסה');
  };

  const copyPaymentLink = async (sale) => {
    const url = sale?.payment_url;
    if (!url) {
      setHistoryError('אין קישור תשלום שמור לעסקה הזו');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setHistoryError('');
      setHistoryOk('קישור התשלום הועתק');
    } catch {
      setHistoryError('לא הצלחנו להעתיק את הקישור');
    }
  };

  const downloadSaleInvoice = async (sale, kind = 'charge') => {
    if (!sale?.id) return;
    const key = `${sale.id}:${kind}`;
    setInvoiceBusyKey(key);
    setHistoryError('');
    try {
      const res = await fetch(
        `/api/pos/sales/${encodeURIComponent(sale.id)}/invoice?kind=${encodeURIComponent(kind)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'הורדת החשבונית נכשלה');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.href = objectUrl;
      a.download = match?.[1] || (kind === 'refund' ? 'refund.pdf' : 'invoice.pdf');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setHistoryError(err.message || 'הורדת החשבונית נכשלה');
    } finally {
      setInvoiceBusyKey('');
    }
  };

  const refundSale = async (sale) => {
    if (!sale?.id) return;
    const ok = window.confirm(
      `לזכות את העסקה של ${sale.customer_name || 'לקוח'} בסך ₪${Number(sale.total || 0).toLocaleString()}?\n` +
        (sale.icount_doc_number ? `מספר מסמך: ${sale.icount_doc_number}\n` : '') +
        (isCardPaymentMethod(sale.payment_method)
          ? 'יווצר מסמך ביטול במערכת החיוב, והכסף יוחזר לכרטיס אם העסקה שולמה באשראי.\n'
          : 'יווצר מסמך ביטול במערכת החיוב (עסקת מזומן — בלי החזר לכרטיס).\n') +
        (sale.coupon_code
          ? `שימו לב: העסקה כללה הטבה (${sale.coupon_code}, −₪${Number(sale.coupon_discount || 0).toLocaleString()}) — הזיכוי הוא על הסכום ששולם בפועל, וההטבה תחזור ללקוח.\n`
          : '') +
        'כרטיסיות או מנויים מהעסקה יבוטלו.'
    );
    if (!ok) return;

    setRefundBusyId(sale.id);
    setHistoryError('');
    setHistoryOk('');
    try {
      const res = await fetch(`/api/pos/sales/${sale.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: `זיכוי מקופה · ${sale.id}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הזיכוי נכשל');
      setHistoryOk(
        data.cancellation?.docnum
          ? `העסקה זוכתה · מסמך ביטול ${data.cancellation.docnum}`
          : 'העסקה זוכתה'
      );
      await refreshSales();
      if (isOwner) await refreshIcount();
    } catch (err) {
      setHistoryError(err.message || 'הזיכוי נכשל');
    } finally {
      setRefundBusyId('');
    }
  };

  /**
   * ביטול עסקה שלא שולמה. אין כאן זיכוי כי אין מה להחזיר: לא עבר כסף ולא יצא
   * מסמך. מה שנסגר זה קישור התשלום שעדיין אפשר לשלם, וההטבה שהוחזקה בשבילו.
   */
  const cancelSale = async (sale) => {
    if (!sale?.id) return;
    const ok = window.confirm(
      `לבטל את העסקה של ${sale.customer_name || 'לקוח'} בסך ₪${Number(sale.total || 0).toLocaleString()}?\n`
      + 'לא שולם ולא יצאה חשבונית, ולכן אין זיכוי ואין מסמך ביטול.\n'
      + 'קישור התשלום יפסיק לעבוד, והעסקה תישאר בהיסטוריה כמבוטלת.'
      + (sale.coupon_code
        ? `\nההטבה ${sale.coupon_code} תחזור ללקוח.`
        : '')
    );
    if (!ok) return;

    setCancelBusyId(sale.id);
    setHistoryError('');
    setHistoryOk('');
    try {
      const res = await fetch(`/api/pos/sales/${sale.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: `ביטול מקופה · ${sale.id}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'הביטול נכשל');
      setHistoryOk('העסקה בוטלה');
      await refreshSales();
    } catch (err) {
      setHistoryError(err.message || 'הביטול נכשל');
    } finally {
      setCancelBusyId('');
    }
  };

  /**
   * Open the printable copy of a document from the billing system. The list
   * only knows type + number, so the link is resolved on click — the tab is
   * opened first so the browser still counts it as a user gesture.
   */
  const openIcountDoc = async (doc) => {
    const doctype = doc?.doctype;
    const docnum = doc?.docnum;
    if (!doctype || !docnum) return;
    const key = `${doctype}:${docnum}`;
    const win = window.open('', '_blank');
    setDocLinkBusyKey(key);
    setDocLinkError('');
    try {
      const res = await fetch(
        `/api/icount/docs/link?doctype=${encodeURIComponent(doctype)}&docnum=${encodeURIComponent(docnum)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'לא הצלחנו לאתר את המסמך');
      const url = data.url || data.appUrl;
      if (!url) throw new Error('לא נמצא קישור למסמך');
      if (!win) {
        setDocLinkError('הדפדפן חסם את חלון המסמך — אשרו חלונות קופצים ונסו שוב');
        return;
      }
      win.opener = null;
      win.location = url;
    } catch (err) {
      if (win) win.close();
      setDocLinkError(err.message || 'פתיחת המסמך נכשלה');
    } finally {
      setDocLinkBusyKey('');
    }
  };

  const refreshIcount = useCallback(async () => {
    setIcountLoading(true);
    try {
      const [statusRes, docsRes, payRes] = await Promise.all([
        fetch('/api/icount/status'),
        fetch('/api/icount/docs'),
        fetch('/api/payments'),
      ]);

      const status = await statusRes.json().catch(() => ({}));
      setIcountStatus({ loading: false, ...status, httpOk: statusRes.ok });

      if (docsRes.ok) {
        const docsData = await docsRes.json();
        setIcountDocs(Array.isArray(docsData.docs) ? docsData.docs : []);
      } else {
        setIcountDocs([]);
      }

      if (payRes.ok) {
        const pays = await payRes.json();
        setPayments(Array.isArray(pays) ? pays : []);
      }
    } catch (err) {
      console.error(err);
      setIcountStatus({
        loading: false,
        ok: false,
        configured: false,
        message: 'לא ניתן לבדוק חיבור ל-iCount',
      });
    } finally {
      setIcountLoading(false);
    }
  }, []);

  const runPaymentAction = async (key, action, successText) => {
    setPaymentActionBusyKey(key);
    setPaymentActionMessage({ type: '', text: '' });
    try {
      const result = await action();
      if (result === false) return;
      setPaymentActionMessage({ type: 'success', text: successText });
      await Promise.all([refreshIcount(), refreshSales()]);
    } catch (err) {
      setPaymentActionMessage({
        type: 'error',
        text: err.message || 'הפעולה נכשלה',
      });
    } finally {
      setPaymentActionBusyKey('');
    }
  };

  const copySystemPaymentLink = async (payment) => {
    if (!payment?.payment_url) throw new Error('לא נשמר קישור תשלום');
    await navigator.clipboard.writeText(payment.payment_url);
  };

  const cancelLinkedPayment = async (payment) => {
    const saleId = payment?.sale_id || payment?.pos_sale_id;
    if (!saleId) {
      throw new Error('את בקשת התשלום הזו מבטלים מתוך האירוע או תיק הלקוח שממנו נוצרה');
    }
    const confirmed = window.confirm(
      `לבטל את בקשת התשלום בסך ₪${Number(payment.amount || 0).toLocaleString()}?\n`
        + 'לא עבר כסף ולא יצאה חשבונית, לכן זו סגירת בקשה ולא זיכוי.',
    );
    if (!confirmed) return false;
    const response = await fetch(`/api/pos/sales/${encodeURIComponent(saleId)}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: `ביטול מחלונית סליקה · ${payment.id}` }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'ביטול בקשת התשלום נכשל');
    return body;
  };

  useEffect(() => {
    refreshRegister();
    refreshSales();
    if (isOwner) {
      refreshIcount();
    } else {
      setIcountStatus({ loading: false, ok: false, configured: false });
    }
  }, [refreshRegister, refreshIcount, refreshSales, isOwner]);

  useEffect(() => {
    if (activeTab === 'reports' && isOwner) refreshReports();
  }, [activeTab, isOwner, refreshReports]);

  useEffect(() => {
    if (!isOwner && (activeTab === 'icount' || activeTab === 'reports' || activeTab === 'products' || activeTab === 'activity-prices' || activeTab === 'discounts' || activeTab === 'manager')) {
      setActiveTab('sale');
    }
  }, [isOwner, activeTab]);

  const discrepancy =
    actualAmount && expectedAmount
      ? parseFloat(actualAmount) - parseFloat(expectedAmount)
      : null;

  const tabs = [
    { k: 'sale', label: 'מכירה', icon: ShoppingCart },
    ...(isOwner ? [{ k: 'products', label: 'מוצרים', icon: Package }] : []),
    // מחירון הפעילויות יושב ליד מחירון הקופה כדי שכל המחירים יהיו במקום אחד
    // לעין — אבל הם שני מסכים ושני מודלים: כאן מוצר עם מלאי, שם יום פעילות
    // לקבוצה עם מינימום ומדרגות.
    ...(isOwner ? [{ k: 'activity-prices', label: 'מחירון פעילויות', icon: Mountain }] : []),
    ...(isOwner ? [{ k: 'discounts', label: 'הטבות והנחות', icon: BadgePercent }] : []),
    ...(isOwner ? [{ k: 'manager', label: 'מסוף מנהל', icon: Wallet }] : []),
    { k: 'history', label: 'עסקאות היום', icon: History },
    ...(isOwner
      ? [
          { k: 'icount', label: 'סליקה ומסמכים', icon: ReceiptText },
        ]
      : []),
  ];

  const handleClose = async () => {
    if (!expectedAmount || !actualAmount) {
      alert('מלא את כל השדות');
      return;
    }
    setSaving(true);

    const newShift = {
      date: new Date().toISOString().split('T')[0],
      shift: shiftType,
      employee: employee || 'לא צוין',
      expected: parseFloat(expectedAmount),
      actual: parseFloat(actualAmount),
      discrepancy: parseFloat(actualAmount) - parseFloat(expectedAmount),
      status: 'closed',
    };

    try {
      const res = await fetch('/api/cash-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newShift),
      });
      if (res.ok) {
        setSavedOk(true);
        setExpectedAmount('');
        setActualAmount('');
        refreshRegister();
        setTimeout(() => setSavedOk(false), 3000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  // מה שאמור לשכב בקופה עכשיו — יתרת התנועות, לא סכום מצטבר של סגירות.
  const expectedCash = Math.round(Number(cashSession?.expected_cash || 0));
  const cashSessionOpen = !!cashSession?.open;

  // ספירת החריגות מתחילה באיפוס/ספירה האחרונים של המנהל — מהרגע שהוא הצהיר על
  // היתרה האמיתית, מה שקדם לו סגור. בלי איפוס נופלים לחלון מתגלגל, אחרת המספר
  // רק גדל ולעולם לא חוזר ל"תקין".
  const discrepancyWindow = useMemo(() => {
    const windowStart = Date.now() - DISCREPANCY_WINDOW_DAYS * 86400000;
    const resetAt = cashSession?.last_reset_at
      ? new Date(cashSession.last_reset_at).getTime()
      : NaN;
    if (Number.isFinite(resetAt) && resetAt > windowStart) {
      return { since: resetAt, label: 'מאז האיפוס' };
    }
    return { since: windowStart, label: `${DISCREPANCY_WINDOW_DAYS} יום` };
  }, [cashSession]);

  const problemShifts = useMemo(() => {
    const cutoff = discrepancyWindow.since;
    return shifts.filter((s) => {
      const discrepancy = Number(s.discrepancy);
      if (!Number.isFinite(discrepancy) || discrepancy === 0) return false;
      const stamp = s.closed_at || s.created_at || s.date;
      const time = stamp ? new Date(stamp).getTime() : NaN;
      if (!Number.isFinite(time)) return false;
      return time >= cutoff;
    }).length;
  }, [shifts, discrepancyWindow]);

  const pendingPayments = payments.filter((p) => p.status === 'pending');

  const filteredPosSales = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    const filtered = posSales.filter((sale) => {
      if (historyStatus !== 'all' && sale.status !== historyStatus) return false;
      if (
        historyPaymentMethod !== 'all' &&
        sale.payment_method !== historyPaymentMethod
      ) {
        return false;
      }

      if (israelDay(sale.created_at) !== israelDay()) return false;

      if (query) {
        const itemText = (Array.isArray(sale.items) ? sale.items : [])
          .map((item) => item.name || item.description || '')
          .join(' ');
        const searchable = [
          sale.customer_name,
          sale.customer_phone,
          sale.customer_email,
          sale.icount_doc_number,
          sale.refund_doc_number,
          sale.sold_by,
          itemText,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!searchable.includes(query)) return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      if (historySort === 'oldest') {
        return String(a.created_at || '').localeCompare(String(b.created_at || ''));
      }
      if (historySort === 'amount-high') {
        return Number(b.total || 0) - Number(a.total || 0);
      }
      if (historySort === 'amount-low') {
        return Number(a.total || 0) - Number(b.total || 0);
      }
      if (historySort === 'customer') {
        return String(a.customer_name || '').localeCompare(
          String(b.customer_name || ''),
          'he'
        );
      }
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }, [
    posSales,
    historySearch,
    historyStatus,
    historyPaymentMethod,
    historySort,
  ]);

  const clearHistoryFilters = () => {
    setHistorySearch('');
    setHistoryStatus('all');
    setHistoryPaymentMethod('all');
    setHistorySort('newest');
    setExpandedSaleId('');
  };

  const hasActiveHistoryFilters =
    !!historySearch.trim() ||
    historyStatus !== 'all' ||
    historyPaymentMethod !== 'all' ||
    historySort !== 'newest';

  const statusLine = icountStatus.loading
    ? 'בודק חיבור...'
    : icountStatus.ok
      ? `✓ מחובר${icountStatus.clientsCount != null ? ` · ${icountStatus.clientsCount} לקוחות` : ''}`
      : icountStatus.configured
        ? `✗ שגיאה: ${icountStatus.message || 'חיבור נכשל'}`
        : '✗ חסר אסימון בהגדרות השרת';

  return (
    <div className="fade-in">
      {isOwner && (
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
            <div className="stat-label">מזומן שאמור להיות בקופה</div>
            <div className="stat-value">₪{expectedCash.toLocaleString()}</div>
            <div className={`stat-sub ${cashSessionOpen ? 'up' : ''}`}>
              {cashSessionOpen ? 'משמרת פתוחה' : 'אין משמרת פתוחה'}
            </div>
          </div>
          <div className="card stat-card" style={{ '--stat-color': problemShifts > 0 ? '#EF4444' : '#10B981' }}>
            <div className="stat-label">חריגות קופה ({discrepancyWindow.label})</div>
            <div className="stat-value" style={{ color: problemShifts > 0 ? 'var(--red)' : 'var(--green)' }}>
              {problemShifts > 0 ? `${problemShifts} חריגות` : 'תקין'}
            </div>
            <div className={`stat-sub ${problemShifts > 0 ? 'down' : 'up'}`}>
              {problemShifts > 0 ? 'דרוש בירור' : 'כל המשמרות תואמות'}
            </div>
          </div>
        </div>
      )}

      <div className="tab-bar">
        {tabs.map(({ k, label, icon: Icon }) => (
          <button
            key={k}
            className={`tab-pill ${activeTab === k ? 'active' : ''}`}
            onClick={() => setActiveTab(k)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'sale' && (
        <PosSale
          onManageProducts={isOwner ? () => setActiveTab('products') : null}
          employees={employees}
          isOwner={isOwner}
          requireSeller={sharedStation}
        />
      )}

      {activeTab === 'products' && isOwner && <Pricelist />}

      {activeTab === 'activity-prices' && isOwner && <ActivityPriceBook />}

      {activeTab === 'discounts' && isOwner && <DiscountCenter />}

      {activeTab === 'manager' && isOwner && (
        <CashManagerPanel
          employees={employees}
          canResetCash={canResetCash}
          isOwner={isOwner}
          onCashChange={refreshRegister}
        />
      )}

      {activeTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-p">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div className="section-title" style={{ marginBottom: 4 }}>עסקאות היום</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {isOwner
                    ? 'כל עסקאות הדלפק של היום · לחיצה על שורה פותחת פירוט ופעולות'
                    : 'עסקאות הדלפק של היום · לחיצה על שורה פותחת פירוט'}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={refreshSales} disabled={salesLoading}>
                <RefreshCw size={14} /> {salesLoading ? 'מרענן...' : 'רענון'}
              </button>
            </div>
            <div className="pos-history-filters">
              <div className="pos-history-filters-grid">
                <label className="form-group pos-history-filter-search">
                  <span className="form-label">חיפוש</span>
                  <div className="input-icon-wrap">
                    <Search size={15} className="input-icon" />
                    <input
                      className="input input-sm"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="לקוח, טלפון, פריט או מסמך"
                    />
                  </div>
                </label>
                <label className="form-group">
                  <span className="form-label">סטטוס</span>
                  <AppSelect
                    className="input select input-sm"
                    value={historyStatus}
                    onChange={(e) => setHistoryStatus(e.target.value)}
                  >
                    <option value="all">הכול</option>
                    <option value="paid">שולם</option>
                    <option value="pending_payment">ממתין לתשלום</option>
                    <option value="refunded">זוכה</option>
                    <option value="cancelled">בוטל</option>
                    <option value="quoted">הצעה</option>
                  </AppSelect>
                </label>
                <label className="form-group">
                  <span className="form-label">אופן תשלום</span>
                  <AppSelect
                    className="input select input-sm"
                    value={historyPaymentMethod}
                    onChange={(e) => setHistoryPaymentMethod(e.target.value)}
                  >
                    <option value="all">הכול</option>
                    <option value="cash">מזומן</option>
                    <option value="online">סליקה בקישור</option>
                    <option value="emv">אשראי במסוף</option>
                    <option value="quote">הצעת מחיר</option>
                  </AppSelect>
                </label>
                <label className="form-group">
                  <span className="form-label">מיון</span>
                  <AppSelect
                    className="input select input-sm"
                    value={historySort}
                    onChange={(e) => setHistorySort(e.target.value)}
                  >
                    <option value="newest">החדש ביותר</option>
                    <option value="oldest">הישן ביותר</option>
                    <option value="amount-high">סכום: גבוה לנמוך</option>
                    <option value="amount-low">סכום: נמוך לגבוה</option>
                    <option value="customer">שם לקוח</option>
                  </AppSelect>
                </label>
              </div>
              <div className="pos-history-filters-meta">
                <span>
                  {new Date().toLocaleDateString('he-IL')} · {filteredPosSales.length} עסקאות היום
                </span>
                {hasActiveHistoryFilters && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={clearHistoryFilters}
                  >
                    <X size={13} />
                    ניקוי סינון
                  </button>
                )}
              </div>
            </div>
            {historyError && (
              <div className="alert alert-error" style={{ marginTop: 12 }}>{historyError}</div>
            )}
            {historyOk && (
              <div className="alert alert-success" style={{ marginTop: 12 }}>{historyOk}</div>
            )}
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>לקוח</th>
                    <th>פריטים</th>
                    <th>אופן תשלום</th>
                    <th>סכום</th>
                    <th>סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPosSales.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                        {salesLoading
                          ? 'טוען עסקאות...'
                          : posSales.length
                            ? 'לא נמצאו עסקאות שמתאימות לסינון'
                            : 'עדיין אין עסקאות קופה'}
                      </td>
                    </tr>
                  )}
                  {filteredPosSales.map((sale) => {
                    const items = Array.isArray(sale.items) ? sale.items : [];
                    const canRefund =
                      sale.status === 'paid' &&
                      !!sale.icount_doc_number &&
                      sale.payment_method !== 'quote';
                    // לא שולם ולא יצאה חשבונית — אין מה לזכות, רק לסגור.
                    const canCancel =
                      !canRefund &&
                      sale.status !== 'paid' &&
                      sale.status !== 'refunded' &&
                      sale.status !== 'cancelled' &&
                      !sale.icount_doc_number;
                    const canDownloadCharge = !!(
                      sale.icount_doc_url ||
                      sale.icount_doc_number ||
                      sale.icount_doc_id
                    );
                    const canDownloadRefund = !!(
                      sale.refund_doc_url ||
                      sale.refund_doc_number
                    );
                    const expanded = expandedSaleId === sale.id;
                    return (
                      <Fragment key={sale.id}>
                        <tr
                          onClick={() =>
                            setExpandedSaleId((prev) => (prev === sale.id ? '' : sale.id))
                          }
                          style={{
                            cursor: 'pointer',
                            background: expanded ? 'rgba(255,255,255,0.04)' : undefined,
                          }}
                          title="לחיצה לפירוט העסקה"
                        >
                          <td>
                            {sale.created_at
                              ? new Date(sale.created_at).toLocaleString('he-IL')
                              : '—'}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {sale.student_id || sale.parent_id ? (
                                <EntityLink
                                  kind="customer"
                                  id={sale.student_id || `parent:${sale.parent_id}`}
                                  title="מעבר לתיק הלקוח"
                                >
                                  {sale.customer_name || 'לקוח'}
                                </EntityLink>
                              ) : (sale.customer_name || 'לקוח')}
                            </div>
                            {sale.customer_phone && (
                              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{sale.customer_phone}</div>
                            )}
                          </td>
                          <td style={{ fontSize: 12, maxWidth: 220 }}>
                            {items.length
                              ? items.map((i) => i.name || i.description).filter(Boolean).join(', ')
                              : '—'}
                          </td>
                          <td>
                            <span className={payMethodBadge(sale.payment_method)}>
                              {payMethodLabel(sale.payment_method)}
                            </span>
                          </td>
                          <td style={{ fontWeight: 700 }}>₪{Number(sale.total || 0).toLocaleString()}</td>
                          <td>
                            <span className={saleStatusBadge(sale.status)}>
                              {saleStatusLabel(sale.status)}
                            </span>
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={6} style={{ background: 'rgba(255,255,255,0.03)', padding: 16 }}>
                              <div className="pos-sale-detail">
                                <div className="pos-sale-detail-meta">
                                  {sale.customer_email && (
                                    <div className="pos-sale-detail-field">
                                      <div className="pos-sale-detail-label">אימייל לקוח</div>
                                      <div className="pos-sale-detail-value">{sale.customer_email}</div>
                                    </div>
                                  )}
                                  <div className="pos-sale-detail-field">
                                    <div className="pos-sale-detail-label">נמכר על ידי</div>
                                    <div className="pos-sale-detail-value">{sale.sold_by || '—'}</div>
                                  </div>
                                  <div className="pos-sale-detail-field">
                                    <div className="pos-sale-detail-label">מספר מסמך</div>
                                    <div className="pos-sale-detail-value">{sale.icount_doc_number || '—'}</div>
                                  </div>
                                  {(sale.cc_confirmation_code || sale.cc_last4 || sale.cc_card_type) && (
                                    <div className="pos-sale-detail-field">
                                      <div className="pos-sale-detail-label">אישור סליקה</div>
                                      <div className="pos-sale-detail-value">{sale.cc_confirmation_code || '—'}</div>
                                      {(sale.cc_card_type || sale.cc_last4) && (
                                        <div className="pos-sale-detail-sub">
                                          {[sale.cc_card_type, sale.cc_last4 ? `••••${sale.cc_last4}` : null]
                                            .filter(Boolean)
                                            .join(' · ')}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {sale.coupon_code && (
                                    <div className="pos-sale-detail-field">
                                      <div className="pos-sale-detail-label">הטבה שמומשה</div>
                                      <div className="pos-sale-detail-value">
                                        {sale.coupon_code} · −₪{Number(sale.coupon_discount || 0).toLocaleString()}
                                      </div>
                                      <div className="pos-sale-detail-sub">
                                        זיכוי יחזיר את ההטבה ללקוח אם התוקף לא פג
                                      </div>
                                    </div>
                                  )}
                                  {sale.refund_doc_number && (
                                    <div className="pos-sale-detail-field">
                                      <div className="pos-sale-detail-label">מסמך זיכוי</div>
                                      <div className="pos-sale-detail-value">{sale.refund_doc_number}</div>
                                    </div>
                                  )}
                                </div>

                                <div className="pos-sale-detail-items">
                                  <div className="pos-sale-detail-section-title">פירוט פריטים</div>
                                  {items.length ? (
                                    items.map((i, idx) => {
                                      const qty = Number(i.quantity) || 1;
                                      const unit = i.unitprice != null ? Number(i.unitprice) : null;
                                      const lineTotal =
                                        unit != null
                                          ? unit * qty
                                          : i.total != null
                                            ? Number(i.total)
                                            : null;
                                      return (
                                        <div key={`${sale.id}-item-${idx}`} className="pos-sale-detail-item">
                                          <span className="pos-sale-detail-item-name">
                                            {i.name || i.description || 'פריט'}
                                            {qty > 1 ? ` × ${qty}` : ''}
                                          </span>
                                          <span className="pos-sale-detail-item-price">
                                            {lineTotal != null
                                              ? `₪${lineTotal.toLocaleString()}`
                                              : '—'}
                                          </span>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <div className="pos-sale-detail-value">—</div>
                                  )}
                                </div>

                                <div className="pos-sale-detail-actions">
                                  {sale.payment_url &&
                                    (sale.status === 'pending_payment' || sale.status === 'quoted') && (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          copyPaymentLink(sale);
                                        }}
                                      >
                                        <Copy size={13} />
                                        העתקת קישור תשלום
                                      </button>
                                      <a
                                        className="btn btn-ghost btn-sm"
                                        href={sale.payment_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <ExternalLink size={13} />
                                        פתיחת קישור תשלום
                                      </a>
                                    </>
                                  )}
                                  {canDownloadCharge && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      disabled={invoiceBusyKey === `${sale.id}:charge`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        downloadSaleInvoice(sale, 'charge');
                                      }}
                                    >
                                      {invoiceBusyKey === `${sale.id}:charge`
                                        ? <Loader2 size={13} className="spin" />
                                        : <Download size={13} />}
                                      הורדת חשבונית
                                    </button>
                                  )}
                                  {canDownloadCharge && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        printSaleInvoice(sale, 'charge');
                                      }}
                                    >
                                      <Printer size={13} />
                                      הדפסת חשבונית
                                    </button>
                                  )}
                                  {canDownloadRefund && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      disabled={invoiceBusyKey === `${sale.id}:refund`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        downloadSaleInvoice(sale, 'refund');
                                      }}
                                    >
                                      {invoiceBusyKey === `${sale.id}:refund`
                                        ? <Loader2 size={13} className="spin" />
                                        : <Download size={13} />}
                                      הורדת מסמך זיכוי
                                    </button>
                                  )}
                                  {canRefund && (
                                    <>
                                      <span className="pos-sale-detail-actions-spacer" />
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={refundBusyId === sale.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          refundSale(sale);
                                        }}
                                      >
                                        <RotateCcw size={13} />
                                        {refundBusyId === sale.id ? 'מזכה...' : 'זיכוי עסקה'}
                                      </button>
                                    </>
                                  )}
                                  {canCancel && (
                                    <>
                                      <span className="pos-sale-detail-actions-spacer" />
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={cancelBusyId === sale.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          cancelSale(sale);
                                        }}
                                      >
                                        <Ban size={13} />
                                        {cancelBusyId === sale.id ? 'מבטל...' : 'ביטול עסקה'}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="section-title" style={{ padding: '14px 16px 0' }}>סגירות קופה</div>
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>תאריך ושעה</th>
                    <th>משמרת</th>
                    <th>עובד</th>
                    <th>צפוי</th>
                    <th>בפועל</th>
                    <th>חריגה בקופה</th>
                    <th>סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                        עדיין אין סגירות קופה שמורות
                      </td>
                    </tr>
                  )}
                  {shifts.map((s) => (
                    <tr key={s.id}>
                      <td>{cashClosureDateTime(s)}</td>
                      <td><span className="badge badge-blue">{s.shift}</span></td>
                      <td>{s.employee}</td>
                      <td>₪{Number(s.expected).toLocaleString()}</td>
                      <td style={{ fontWeight: 700 }}>₪{Number(s.actual).toLocaleString()}</td>
                      <td>
                        <span className={Number(s.discrepancy) === 0 ? 'badge badge-green' : 'badge badge-red'}>
                          {Number(s.discrepancy) === 0
                            ? 'תקין'
                            : `${Number(s.discrepancy) > 0 ? '+' : ''}${s.discrepancy} ₪`}
                        </span>
                      </td>
                      <td><span className="badge badge-gray">סגורה</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'reports' && isOwner && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-p">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="section-title" style={{ marginBottom: 4 }}>דוחות מכירה ומלאי</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  30 יום אחרונים · מנהל בלבד
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={refreshReports} disabled={reportsLoading}>
                  <RefreshCw size={14} /> {reportsLoading ? 'מרענן...' : 'רענון'}
                </button>
                <button className="btn btn-primary btn-sm" type="button" onClick={syncInventory}>
                  סנכרון מלאי
                </button>
              </div>
            </div>
            {syncInventoryMsg && (
              <div className="alert alert-info" style={{ marginTop: 12 }}>{syncInventoryMsg}</div>
            )}
          </div>

          {reportsLoading && !reports && (
            <div className="card card-p" style={{ color: 'var(--text-3)' }}>טוען דוחות...</div>
          )}

          {reports && (
            <>
              <div className="stats-grid">
                <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
                  <div className="stat-label">סה״כ מכירות</div>
                  <div className="stat-value">₪{Number(reports.total || 0).toLocaleString()}</div>
                  <div className="stat-sub up">{reports.count || 0} עסקאות</div>
                </div>
                <div className="card stat-card" style={{ '--stat-color': '#EF4444' }}>
                  <div className="stat-label">מלאי נמוך</div>
                  <div className="stat-value">{(reports.lowStock || []).length}</div>
                </div>
                <div className="card stat-card" style={{ '--stat-color': '#F59E0B' }}>
                  <div className="stat-label">מנויים לפוג (14 יום)</div>
                  <div className="stat-value">{(reports.expiringPasses || []).length}</div>
                </div>
              </div>

              <div className="grid-2" style={{ alignItems: 'flex-start' }}>
                <div className="card">
                  <div className="section-title" style={{ padding: '14px 16px 0' }}>לפי יום</div>
                  <div className="table-wrap">
                    <table className="crm-table">
                      <thead>
                        <tr><th>יום</th><th>סכום</th></tr>
                      </thead>
                      <tbody>
                        {(reports.byDay || []).slice(0, 14).map((row) => (
                          <tr key={row.key}>
                            <td>{row.key}</td>
                            <td style={{ fontWeight: 700 }}>₪{Number(row.total).toLocaleString()}</td>
                          </tr>
                        ))}
                        {(reports.byDay || []).length === 0 && (
                          <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-3)' }}>אין נתונים</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card">
                  <div className="section-title" style={{ padding: '14px 16px 0' }}>לפי עובד</div>
                  <div className="table-wrap">
                    <table className="crm-table">
                      <thead>
                        <tr><th>עובד</th><th>סכום</th></tr>
                      </thead>
                      <tbody>
                        {(reports.byEmployee || []).map((row) => (
                          <tr key={row.key}>
                            <td>{row.key}</td>
                            <td style={{ fontWeight: 700 }}>₪{Number(row.total).toLocaleString()}</td>
                          </tr>
                        ))}
                        {(reports.byEmployee || []).length === 0 && (
                          <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-3)' }}>אין נתונים</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="grid-2" style={{ alignItems: 'flex-start' }}>
                <div className="card">
                  <div className="section-title" style={{ padding: '14px 16px 0' }}>לפי אמצעי תשלום</div>
                  <div className="table-wrap">
                    <table className="crm-table">
                      <thead>
                        <tr><th>אמצעי</th><th>סכום</th></tr>
                      </thead>
                      <tbody>
                        {(reports.byPayment || []).map((row) => (
                          <tr key={row.key}>
                            <td>{payMethodLabel(row.key)}</td>
                            <td style={{ fontWeight: 700 }}>₪{Number(row.total).toLocaleString()}</td>
                          </tr>
                        ))}
                        {(reports.byPayment || []).length === 0 && (
                          <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-3)' }}>אין נתונים</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card">
                  <div className="section-title" style={{ padding: '14px 16px 0' }}>מלאי נמוך</div>
                  <div className="table-wrap">
                    <table className="crm-table">
                      <thead>
                        <tr><th>פריט</th><th>מק״ט</th><th>כמות</th></tr>
                      </thead>
                      <tbody>
                        {(reports.lowStock || []).map((item) => (
                          <tr key={item.id}>
                            <td>{item.name}</td>
                            <td>{item.sku || '—'}</td>
                            <td style={{ fontWeight: 700, color: 'var(--red)' }}>{item.stock_qty}</td>
                          </tr>
                        ))}
                        {(reports.lowStock || []).length === 0 && (
                          <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-3)' }}>אין פריטים במלאי נמוך</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="section-title" style={{ padding: '14px 16px 0' }}>מנויים / כרטיסיות לפוג</div>
                <div className="table-wrap">
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>שם</th>
                        <th>סוג</th>
                        <th>תוקף עד</th>
                        <th>יתרה</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reports.expiringPasses || []).map((pass) => (
                        <tr key={pass.id}>
                          <td>{pass.name}</td>
                          <td>{pass.pass_type === 'punch_card' ? 'כרטיסייה' : 'מנוי'}</td>
                          <td>{pass.valid_until || '—'}</td>
                          <td>
                            {pass.pass_type === 'punch_card'
                              ? `${pass.visits_remaining}/${pass.visits_total}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                      {(reports.expiringPasses || []).length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                            אין מנויים שעומדים לפוג בקרוב
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'icount' && isOwner && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-p">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <ReceiptText size={22} style={{ color: 'var(--blue)' }} />
                <div>
                  <div className="section-title">מסמכים וסליקה</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{statusLine}</div>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={refreshIcount} disabled={icountLoading}>
                <RefreshCw size={14} /> {icountLoading ? 'מרענן...' : 'רענון'}
              </button>
            </div>

            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              שליחת קישור תשלום והפקת חשבונית מתבצעות ממסך המכירה ומתיק הלקוח. כאן מוצגים מסמכים מהמערכת החיצונית.
            </div>
          </div>

          <div className="card">
            {docLinkError && (
              <div className="alert alert-error" style={{ margin: '14px 16px 0' }}>
                {docLinkError}
              </div>
            )}
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>מס׳ מסמך</th>
                    <th>לקוח / תיאור</th>
                    <th>סכום</th>
                    <th>מסמך</th>
                  </tr>
                </thead>
                <tbody>
                  {!icountStatus.ok && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                        {icountStatus.message || 'אין חיבור ל-iCount — בדוק את האסימון בשרת'}
                      </td>
                    </tr>
                  )}
                  {icountStatus.ok && icountDocs.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                        לא נמצאו מסמכים ב־30 הימים האחרונים
                      </td>
                    </tr>
                  )}
                  {icountDocs.map((doc, i) => {
                    const docKey = `${doc.doctype || ''}:${doc.docnum || ''}`;
                    return (
                      <tr key={doc.doc_id || doc.docnum || i}>
                        <td>{docDate(doc)}</td>
                        <td>
                          {doc.doc_app_url ? (
                            <a
                              href={doc.doc_app_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="פתיחת המסמך ב-iCount"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: 'var(--blue)',
                              }}
                            >
                              {doc.docnum || doc.doc_id || 'מסמך'}
                              <ExternalLink size={13} />
                            </a>
                          ) : (
                            doc.docnum || doc.doc_id || '—'
                          )}
                        </td>
                        <td>{docLabel(doc)}</td>
                        <td style={{ fontWeight: 700 }}>₪{docAmount(doc).toLocaleString()}</td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => openIcountDoc(doc)}
                            disabled={!doc.docnum || !doc.doctype || docLinkBusyKey === docKey}
                            title="פתיחת העתק המסמך להדפסה"
                          >
                            {docLinkBusyKey === docKey ? (
                              <Loader2 size={14} className="spin" />
                            ) : (
                              <Printer size={14} />
                            )}
                            צפייה
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div style={{ padding: '14px 16px 10px' }}>
              <div className="section-title" style={{ marginBottom: 4 }}>תשלומים במערכת</div>
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                לחיצה על כל שורה פותחת את פרטי העסקה ואת הפעולות הזמינות עבורה
              </div>
              {paymentActionMessage.text && (
                <div
                  className={`alert alert-${paymentActionMessage.type}`}
                  style={{ marginTop: 12 }}
                >
                  {paymentActionMessage.text}
                </div>
              )}
            </div>
            <div className="table-wrap finance-payment-table-wrap">
              <table className="crm-table finance-payment-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>לקוח</th>
                    <th>תיאור</th>
                    <th>אמצעי תשלום</th>
                    <th>סכום</th>
                    <th>סטטוס</th>
                    <th>מסמך</th>
                    <th aria-label="פירוט" />
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                        {icountLoading ? 'טוען תשלומים...' : 'לא נמצאו תשלומים במערכת'}
                      </td>
                    </tr>
                  )}
                  {payments.slice(0, 30).map((payment) => {
                    const expanded = expandedPaymentId === payment.id;
                    const items = Array.isArray(payment.items) ? payment.items : [];
                    const canDownloadCharge = !!(
                      payment.icount_doc_url ||
                      payment.icount_doc_number ||
                      payment.icount_doc_id
                    );
                    const canDownloadRefund = !!(
                      payment.refund_doc_url || payment.refund_doc_number
                    );
                    const canRefund =
                      ['paid', 'partial_refund'].includes(payment.status) &&
                      !!payment.icount_doc_number;
                    const canCancel =
                      ['pending', 'open', 'quoted'].includes(payment.status) &&
                      !!(payment.sale_id || payment.pos_sale_id) &&
                      !payment.icount_doc_number;
                    const busyPrefix = `${payment.id}:`;
                    return (
                      <Fragment key={payment.id}>
                        <tr
                          className={expanded ? 'is-expanded' : ''}
                          onClick={() => setExpandedPaymentId(expanded ? '' : payment.id)}
                          title="לחיצה לפירוט ופעולות"
                        >
                          <td>
                            <strong>
                              {payment.created_at
                                ? new Date(payment.created_at).toLocaleDateString('he-IL')
                                : '—'}
                            </strong>
                            <small>
                              {payment.created_at
                                ? new Date(payment.created_at).toLocaleTimeString('he-IL', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : ''}
                            </small>
                          </td>
                          <td>
                            {payment.parent_id || payment.student_id ? (
                              <span onClick={(event) => event.stopPropagation()}>
                                <EntityLink
                                  kind="customer"
                                  id={payment.student_id || `parent:${payment.parent_id}`}
                                  title="מעבר לתיק הלקוח"
                                >
                                  <strong>{payment.customer_name || payment.student_name || 'לקוח'}</strong>
                                </EntityLink>
                              </span>
                            ) : (
                              <strong>{payment.customer_name || 'לקוח'}</strong>
                            )}
                            <small>{payment.customer_phone || payment.customer_email || ''}</small>
                          </td>
                          <td>
                            <strong>{payment.description || 'תשלום'}</strong>
                            <small>{payment.activity_name || payment.sold_by || ''}</small>
                          </td>
                          <td>
                            <span className={payMethodBadge(payment.payment_method)}>
                              {payMethodLabel(payment.payment_method)}
                            </span>
                          </td>
                          <td><strong>₪{Number(payment.amount || 0).toLocaleString()}</strong></td>
                          <td>
                            <span className={paymentStatusBadge(payment.status)}>
                              {paymentStatusLabel(payment.status)}
                            </span>
                          </td>
                          <td><strong>{payment.icount_doc_number || '—'}</strong></td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon btn-sm"
                              aria-label={expanded ? 'סגירת פירוט' : 'פתיחת פירוט'}
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedPaymentId(expanded ? '' : payment.id);
                              }}
                            >
                              <ChevronDown
                                size={16}
                                style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}
                              />
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="finance-payment-detail-row">
                            <td colSpan={8}>
                              <div className="finance-payment-detail">
                                <div className="finance-payment-detail-grid">
                                  <div><span>מספר תשלום</span><strong>{payment.id}</strong></div>
                                  <div><span>מסמך חיוב</span><strong>{payment.icount_doc_number || 'טרם הופק'}</strong></div>
                                  <div><span>מסמך זיכוי</span><strong>{payment.refund_doc_number || '—'}</strong></div>
                                  <div><span>אמצעי תשלום</span><strong>{payMethodLabel(payment.payment_method)}</strong></div>
                                  <div><span>אישור סליקה</span><strong>{payment.cc_confirmation_code || '—'}</strong></div>
                                  <div><span>כרטיס</span><strong>{payment.cc_last4 ? `••••${payment.cc_last4}` : '—'}</strong></div>
                                </div>

                                <div className="finance-payment-items">
                                  <h3>פירוט פריטים</h3>
                                  {items.length ? items.map((item, index) => {
                                    const quantity = Number(item.quantity) || 1;
                                    const total = Number(
                                      item.total ??
                                      ((item.unitprice ?? item.unit_price) * quantity),
                                    );
                                    return (
                                      <div key={`${payment.id}-item-${index}`}>
                                        <span>
                                          {item.name || item.description || 'פריט'}
                                          {quantity > 1 ? ` × ${quantity}` : ''}
                                        </span>
                                        <strong>{Number.isFinite(total) ? `₪${total.toLocaleString()}` : '—'}</strong>
                                      </div>
                                    );
                                  }) : <p>{payment.description || 'אין פירוט פריטים'}</p>}
                                </div>

                                {payment.refund_reason && (
                                  <div className="finance-payment-note">
                                    <strong>סיבת זיכוי:</strong> {payment.refund_reason}
                                  </div>
                                )}

                                <div className="finance-payment-actions">
                                  {payment.payment_url && ['pending', 'open', 'quoted'].includes(payment.status) && (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => runPaymentAction(
                                          `${payment.id}:copy`,
                                          () => copySystemPaymentLink(payment),
                                          'קישור התשלום הועתק',
                                        )}
                                      >
                                        <Copy size={14} />העתקת קישור תשלום
                                      </button>
                                      <a
                                        className="btn btn-ghost btn-sm"
                                        href={payment.payment_url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        <ExternalLink size={14} />פתיחת קישור תשלום
                                      </a>
                                    </>
                                  )}
                                  {canDownloadCharge && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      disabled={paymentActionBusyKey === `${payment.id}:download`}
                                      onClick={() => runPaymentAction(
                                        `${payment.id}:download`,
                                        () => downloadPaymentDocument(payment),
                                        'החשבונית הורדה',
                                      )}
                                    >
                                      {paymentActionBusyKey === `${payment.id}:download`
                                        ? <Loader2 size={14} className="spin" />
                                        : <Download size={14} />}
                                      הורדת חשבונית
                                    </button>
                                  )}
                                  {canDownloadCharge && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => {
                                        try {
                                          printPaymentDocument(payment);
                                          setPaymentActionMessage({ type: 'success', text: 'החשבונית נפתחה להדפסה' });
                                        } catch (err) {
                                          setPaymentActionMessage({ type: 'error', text: err.message });
                                        }
                                      }}
                                    >
                                      <Printer size={14} />הדפסת חשבונית
                                    </button>
                                  )}
                                  {canDownloadCharge && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      disabled={paymentActionBusyKey === `${payment.id}:send`}
                                      onClick={() => runPaymentAction(
                                        `${payment.id}:send`,
                                        () => sendPaymentDocument(payment),
                                        'החשבונית נשלחה ללקוח',
                                      )}
                                    >
                                      <Send size={14} />שליחה ללקוח
                                    </button>
                                  )}
                                  {payment.icount_doc_app_url && (
                                    <a
                                      className="btn btn-ghost btn-sm"
                                      href={payment.icount_doc_app_url}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <ReceiptText size={14} />מסמך ב־iCount
                                    </a>
                                  )}
                                  {payment.icount_client_app_url && (
                                    <a
                                      className="btn btn-ghost btn-sm"
                                      href={payment.icount_client_app_url}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <ExternalLink size={14} />תיק לקוח ב־iCount
                                    </a>
                                  )}
                                  {canDownloadRefund && (
                                    <>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => runPaymentAction(
                                          `${payment.id}:refund-download`,
                                          () => downloadPaymentDocument(payment, 'refund'),
                                          'מסמך הזיכוי הורד',
                                        )}
                                      >
                                        <Download size={14} />מסמך זיכוי
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => runPaymentAction(
                                          `${payment.id}:refund-send`,
                                          () => sendPaymentDocument(payment, 'refund'),
                                          'מסמך הזיכוי נשלח ללקוח',
                                        )}
                                      >
                                        <Send size={14} />שליחת זיכוי
                                      </button>
                                    </>
                                  )}
                                  {canRefund && (
                                    <>
                                      <span className="finance-payment-actions-spacer" />
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm is-danger"
                                        disabled={paymentActionBusyKey.startsWith(busyPrefix)}
                                        onClick={() => runPaymentAction(
                                          `${payment.id}:refund`,
                                          () => refundPayment(payment),
                                          'ביטול העסקה והזיכוי המלא בוצעו',
                                        )}
                                      >
                                        <RotateCcw size={14} />ביטול עסקה / זיכוי מלא
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm is-danger"
                                        disabled={paymentActionBusyKey.startsWith(busyPrefix)}
                                        onClick={() => runPaymentAction(
                                          `${payment.id}:partial`,
                                          () => refundPayment(payment, { partial: true }),
                                          'הזיכוי החלקי בוצע',
                                        )}
                                      >
                                        <MoreHorizontal size={14} />זיכוי חלקי
                                      </button>
                                    </>
                                  )}
                                  {canCancel && (
                                    <>
                                      <span className="finance-payment-actions-spacer" />
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm is-danger"
                                        disabled={paymentActionBusyKey.startsWith(busyPrefix)}
                                        onClick={() => runPaymentAction(
                                          `${payment.id}:cancel`,
                                          () => cancelLinkedPayment(payment),
                                          'בקשת התשלום בוטלה',
                                        )}
                                      >
                                        <Ban size={14} />ביטול בקשת תשלום
                                      </button>
                                    </>
                                  )}
                                  {!payment.payment_url && !canDownloadCharge && !canDownloadRefund && !canRefund && !canCancel && (
                                    <span style={{ color: 'var(--text-3)', fontSize: 12 }}>
                                      אין פעולות כספיות זמינות לרשומה במצב זה
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
