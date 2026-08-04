import React, { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { ReceiptText, RefreshCw, RotateCcw, Download, Loader2, Copy, ExternalLink, Search, X, Printer, ShoppingCart, Package, Calculator, History, BarChart3 } from 'lucide-react';
import EntityLink from '../utils/entityLinks.jsx';
import PosSale from './PosSale.jsx';
import Pricelist from './Pricelist.jsx';
import AppSelect from './AppSelect.jsx';

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

export default function CashRegister({ isOwner = true, initialTab = null }) {
  const [expectedAmount, setExpectedAmount] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [shiftType, setShiftType] = useState('בוקר');
  const [employee, setEmployee] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [shifts, setShifts] = useState([]);
  const [activeTab, setActiveTab] = useState(
    initialTab === 'products' && isOwner ? 'products' : 'sale'
  );
  const [employees, setEmployees] = useState([]);

  const [icountStatus, setIcountStatus] = useState({ loading: true });
  const [icountDocs, setIcountDocs] = useState([]);
  const [icountTotal, setIcountTotal] = useState(0);
  const [icountLoading, setIcountLoading] = useState(false);
  const [docLinkBusyKey, setDocLinkBusyKey] = useState('');
  const [docLinkError, setDocLinkError] = useState('');
  const [payments, setPayments] = useState([]);
  const [posSales, setPosSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [refundBusyId, setRefundBusyId] = useState('');
  const [invoiceBusyKey, setInvoiceBusyKey] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyOk, setHistoryOk] = useState('');
  const [expandedSaleId, setExpandedSaleId] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyPaymentMethod, setHistoryPaymentMethod] = useState('all');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [historySort, setHistorySort] = useState('newest');
  const [reports, setReports] = useState(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [syncInventoryMsg, setSyncInventoryMsg] = useState('');

  const refreshRegister = useCallback(async () => {
    try {
      const data = await fetch('/api/cash-register').then((r) => (r.ok ? r.json() : []));
      setShifts(Array.isArray(data) ? data : []);
      if (isOwner) {
        const emps = await fetch('/api/employees').then((r) => (r.ok ? r.json() : []));
        const list = Array.isArray(emps) ? emps : [];
        setEmployees(list);
        if (list.length && !employee) setEmployee(list[0].name);
      }
    } catch (err) {
      console.error(err);
      setShifts([]);
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
        setIcountTotal(Number(docsData.total) || 0);
      } else {
        setIcountDocs([]);
        setIcountTotal(0);
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
    if (!isOwner && (activeTab === 'icount' || activeTab === 'reports' || activeTab === 'products')) {
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
    { k: 'close', label: 'סגירת קופה', icon: Calculator },
    { k: 'history', label: 'היסטוריה', icon: History },
    ...(isOwner
      ? [
          { k: 'reports', label: 'דוחות', icon: BarChart3 },
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

  const totalCash = shifts.reduce((sum, s) => sum + Number(s.actual || 0), 0);
  const problemShifts = shifts.filter((s) => Number(s.discrepancy) !== 0).length;
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

      const saleDate = String(sale.created_at || '').slice(0, 10);
      if (historyDateFrom && saleDate < historyDateFrom) return false;
      if (historyDateTo && saleDate > historyDateTo) return false;

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
    historyDateFrom,
    historyDateTo,
    historySort,
  ]);

  const clearHistoryFilters = () => {
    setHistorySearch('');
    setHistoryStatus('all');
    setHistoryPaymentMethod('all');
    setHistoryDateFrom('');
    setHistoryDateTo('');
    setHistorySort('newest');
    setExpandedSaleId('');
  };

  const hasActiveHistoryFilters =
    !!historySearch.trim() ||
    historyStatus !== 'all' ||
    historyPaymentMethod !== 'all' ||
    !!historyDateFrom ||
    !!historyDateTo ||
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
            <div className="stat-label">הכנסות מזומן (סגירות קופה)</div>
            <div className="stat-value">₪{totalCash.toLocaleString()}</div>
          </div>
          <div className="card stat-card" style={{ '--stat-color': '#6366F1' }}>
            <div className="stat-label">מסמכי חיוב (30 יום)</div>
            <div className="stat-value">₪{Math.round(icountTotal).toLocaleString()}</div>
            <div className={`stat-sub ${icountStatus.ok ? 'up' : 'down'}`}>{statusLine}</div>
          </div>
          <div className="card stat-card" style={{ '--stat-color': problemShifts > 0 ? '#EF4444' : '#10B981' }}>
            <div className="stat-label">חריגות קופה</div>
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
        <PosSale onManageProducts={isOwner ? () => setActiveTab('products') : null} />
      )}

      {activeTab === 'products' && isOwner && <Pricelist />}

      {activeTab === 'close' && (
        <div className="grid-2" style={{ alignItems: 'flex-start' }}>
          <div className="card card-p">
            <div className="section-title" style={{ marginBottom: 20 }}>
              סגירת קופה — {new Date().toLocaleDateString('he-IL')}
            </div>

            {savedOk && (
              <div className="alert alert-success" style={{ marginBottom: 16 }}>
                <span>הקופה נסגרה ונשמרה בהצלחה</span>
              </div>
            )}

            <div className="form-grid" style={{ gap: 14 }}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">משמרת</label>
                  <AppSelect className="input select" value={shiftType} onChange={(e) => setShiftType(e.target.value)}>
                    {['בוקר', 'צהריים', 'ערב', 'לילה'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </AppSelect>
                </div>
                <div className="form-group">
                  <label className="form-label">שם העובד</label>
                  {isOwner && employees.length > 0 ? (
                    <AppSelect className="input select" value={employee} onChange={(e) => setEmployee(e.target.value)}>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.name}>{emp.name}</option>
                      ))}
                    </AppSelect>
                  ) : (
                    <input
                      className="input"
                      value={employee}
                      onChange={(e) => setEmployee(e.target.value)}
                      placeholder="שם העובד"
                    />
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">סכום צפוי בקופה (ש״ח) *</label>
                <div className="input-icon-wrap">
                  <span className="input-icon" style={{ fontSize: 14 }}>₪</span>
                  <input
                    className="input"
                    type="number"
                    placeholder="0.00"
                    style={{ paddingRight: 32 }}
                    value={expectedAmount}
                    onChange={(e) => setExpectedAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">סכום בפועל בקופה (ספירת מזומן) *</label>
                <div className="input-icon-wrap">
                  <span className="input-icon" style={{ fontSize: 14 }}>₪</span>
                  <input
                    className="input"
                    type="number"
                    placeholder="0.00"
                    style={{
                      paddingRight: 32,
                      borderColor:
                        discrepancy !== null
                          ? discrepancy === 0
                            ? 'var(--green)'
                            : 'var(--red)'
                          : undefined,
                    }}
                    value={actualAmount}
                    onChange={(e) => setActualAmount(e.target.value)}
                  />
                </div>
              </div>

              {discrepancy !== null && (
                <div className={`alert ${discrepancy === 0 ? 'alert-success' : 'alert-error'}`}>
                  <div>
                    {discrepancy === 0 ? (
                      <strong>הקופה מאוזנת — אין חריגה</strong>
                    ) : (
                      <>
                        <strong>
                          חריגה של {discrepancy > 0 ? '+' : ''}
                          {discrepancy} ש״ח
                        </strong>
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          {discrepancy > 0
                            ? 'עודף — בדוק אם חסרה רשומת מכירה'
                            : 'גירעון — בדוק עם הצוות'}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <button
                className="btn btn-primary btn-full"
                style={{ paddingBlock: 13 }}
                onClick={handleClose}
                disabled={saving}
              >
                {saving ? 'שומר...' : 'סגור קופה ושמור דוח'}
              </button>
            </div>
          </div>

          <div className="card card-p">
            <div className="section-title" style={{ marginBottom: 14 }}>תשלומים ממתינים</div>
            {pendingPayments.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>אין דרישות תשלום פתוחות</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingPayments.slice(0, 8).map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{p.description}</span>
                    <span style={{ fontWeight: 700 }}>₪{Number(p.amount).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-p">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div className="section-title" style={{ marginBottom: 4 }}>היסטוריית עסקאות</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {isOwner
                    ? 'לחיצה על שורה פותחת פירוט · זיכוי וקישורים נמצאים בתוך הפירוט'
                    : 'לחיצה על שורה פותחת פירוט · זיכוי זמין לעסקאות שלך בתוך הפירוט'}
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
                  <span className="form-label">מתאריך</span>
                  <input
                    className="input input-sm"
                    type="date"
                    value={historyDateFrom}
                    onChange={(e) => setHistoryDateFrom(e.target.value)}
                  />
                </label>
                <label className="form-group">
                  <span className="form-label">עד תאריך</span>
                  <input
                    className="input input-sm"
                    type="date"
                    value={historyDateTo}
                    onChange={(e) => setHistoryDateTo(e.target.value)}
                  />
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
                  מוצגות {filteredPosSales.length} מתוך {posSales.length} עסקאות
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
                    <th>תאריך</th>
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
                      <td>{s.date}</td>
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

          {payments.length > 0 && (
            <div className="card">
              <div className="section-title" style={{ padding: '14px 16px 0' }}>תשלומים במערכת</div>
              <div className="table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>תאריך</th>
                      <th>תיאור</th>
                      <th>סכום</th>
                      <th>סטטוס</th>
                      <th>מס׳ מסמך</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.slice(0, 30).map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.created_at
                            ? new Date(p.created_at).toLocaleDateString('he-IL')
                            : '—'}
                        </td>
                        <td>{p.description}</td>
                        <td>₪{Number(p.amount).toLocaleString()}</td>
                        <td>
                          <span
                            className={
                              p.status === 'paid'
                                ? 'badge badge-green'
                                : p.status === 'pending'
                                  ? 'badge badge-amber'
                                  : 'badge badge-gray'
                            }
                          >
                            {p.status === 'paid'
                              ? 'שולם'
                              : p.status === 'pending'
                                ? 'ממתין'
                                : p.status}
                          </span>
                        </td>
                        <td>{p.icount_doc_number || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
