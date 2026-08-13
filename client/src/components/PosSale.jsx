import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingCart, Plus, Minus, Trash2, Search, User,
  Banknote, Link2, FileText, CheckCircle2, X, Percent, Tag,
  Package, ArrowRight, Gift, Send, Settings2, Printer, RotateCcw, QrCode, CreditCard,
  AtSign, MessageCircle,
} from 'lucide-react';
import QRCode from 'qrcode';
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
import CashDenominationPad from './CashDenominationPad.jsx';
import { sumDenoms } from './cashDenoms.js';
import CashCountModal from './CashCountModal.jsx';
import EmployeeSelect from './EmployeeSelect.jsx';
import {
  printReceiptFromSale, openInvoiceFallback, thermalSupported, printMode, PRINT_MODES,
} from '../utils/thermalPrinter.js';
import { buildReceiptHtml, printReceiptViaOs } from '../utils/receiptHtml.js';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { comparePosShortcuts, isPosShortcut } from '../utils/posShortcuts.js';

// שתי דרכים בלבד, וכל אחת בצבע משלה: בדלפק הבחירה נעשית בהצצה, לא בקריאה.
const PAY_METHODS = [
  { id: 'cash', label: 'מזומן', hint: 'שטרות ומטבעות', icon: Banknote, color: '#34D399' },
  { id: 'online', label: 'אשראי בקישור', hint: 'נשלח לטלפון הלקוח', icon: CreditCard, color: '#60A5FA' },
];

/**
 * מתג שליחה בצורת אייקון, ליד כפתור התשלום.
 *
 * תיבת סימון עם משפט הסבר לצידה תפסה שורה שלמה ואמרה דבר אחר בכל אמצעי
 * תשלום. האייקון תופס את מקומו הטבעי — ליד הכפתור שמבצע את השליחה — וההסבר
 * המלא עולה בריחוף. בלי טלפון או מייל בתיק אין לאן לשלוח, ולכן המתג כבוי.
 */
function SendToggle({ on, onToggle, icon: Icon, title, missing, disabled }) {
  const active = on && !disabled;
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={disabled ? undefined : onToggle}
      aria-pressed={active}
      title={disabled ? `${title} — ${missing}` : `${title}${on ? '' : ' (כבוי)'}`}
      style={{
        paddingInline: 12,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderColor: active ? 'var(--accent)' : 'var(--border)',
        color: active ? 'var(--accent)' : 'var(--text-3)',
        background: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : undefined,
      }}
    >
      <Icon size={16} />
    </button>
  );
}

/**
 * קוד לסריקה של קישור התשלום.
 *
 * לא לכל לקוח בדלפק יש וואטסAPP או סבלנות להקליד כתובת. הקוד על המסך הוא
 * מסלול התשלום השלישי: הלקוח מצלם ומשלם מהטלפון שלו.
 */
function PayQr({ url, size = 132, caption = 'סרקו לתשלום' }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    if (!url) { setSrc(''); return undefined; }
    QRCode.toDataURL(String(url), { margin: 1, width: size * 2, errorCorrectionLevel: 'M' })
      .then((data) => { if (alive) setSrc(data); })
      .catch(() => { if (alive) setSrc(''); });
    return () => { alive = false; };
  }, [url, size]);
  if (!src) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <img
        src={src}
        alt="קוד לסריקה ותשלום"
        width={size}
        height={size}
        style={{ borderRadius: 8, background: '#fff', padding: 6, display: 'block' }}
      />
      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{caption}</div>
    </div>
  );
}

/** מספר לוואטסאפ: ספרות בלבד, ו-0 מקומי מוחלף בקידומת ישראל. */
function waPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits.length >= 11 ? digits : '';
}

function productTypeLabel(type) {
  if (type === 'punch_card') return 'כרטיסייה';
  if (type === 'time_membership') return 'מנוי';
  if (type === 'custom') return 'מותאם';
  return 'מוצר';
}

function makeCartLineId() {
  return `cl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * כמה אנשים יחידה אחת מכסה — שדה „מספר משתתפים” במחירון.
 * מראה את unitCapacity ב-server/posUtils.js, כמו pickBestPunchCard.
 */
function unitCapacity(item) {
  const n = parseInt(String(item?.participants ?? '').trim(), 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
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
  onCashSessionChange = null,
}) {
  // פרטי העסק נדרשים לקבלה המודפסת — שם משפטי, מספר עוסק, כתובת ולוגו הם
  // פרטי חובה על חשבונית מס.
  const { profile: businessProfile } = useBusinessProfile();
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
  // ריק בכוונה: אמצעי התשלום נבחר, לא ננחש. ברירת מחדל „מזומן” גררה מכירות
  // שנרשמו כמזומן כי איש לא שם לב שהיא כבר מסומנת.
  const [paymentMethod, setPaymentMethod] = useState('');
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
  // הטבות שהוסרו ביד. בלי הזיכרון הזה ההחלה האוטומטית מחזירה אותן מיד —
  // כפתור „הסרה” שלא מסיר כלום הוא גרוע יותר מכפתור שלא קיים.
  const [dismissedCoupons, setDismissedCoupons] = useState(() => new Set());
  const [newClimberState, setNewClimberState] = useState(null); // null | 'sending' | string
  // הקבלה האחרונה נשמרת כדי שאפשר יהיה לנסות להדפיס שוב בלי למכור מחדש.
  // בלי זה כל בדיקה של המדפסת עולה עסקה, וכל תקלה מסתיימת בחשבונית ידנית.
  const [lastReceipt, setLastReceipt] = useState(null);
  // מכירה ללא זיהוי: קרטיב במזומן אינו דורש טלפון, שם, או תיק לקוח. בלי
  // המסלול הזה כל מכירה קטנה גוררת הקלדת פרטים שאיש לא יסתכל בהם שוב.
  const [anonymousSale, setAnonymousSale] = useState(false);
  // קוד לסריקה של טופס ההרשמה — ללקוח שאין לו וואטסאפ בטלפון שמולנו.
  const [formQr, setFormQr] = useState('');
  const [formQrBusy, setFormQrBusy] = useState(false);
  const [tenderedDenoms, setTenderedDenoms] = useState({});
  const tenderedAmount = sumDenoms(tenderedDenoms);
  const [couponError, setCouponError] = useState('');
  const [couponBusy, setCouponBusy] = useState(false);
  const [resendingLink, setResendingLink] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [resendOk, setResendOk] = useState(false);
  const [showContactFields, setShowContactFields] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customDraft, setCustomDraft] = useState({ name: '', price: '', quantity: '1' });
  const [cashSessionOpen, setCashSessionOpen] = useState(false);
  const [lastChange, setLastChange] = useState(null);
  const [cashClosedHint, setCashClosedHint] = useState(false);
  const [showOpenCash, setShowOpenCash] = useState(false);
  const [cancellationAccepted, setCancellationAccepted] = useState(false);
  // Who the last attempt refused to sell to, and the link sent instead.
  const [documentsBlock, setDocumentsBlock] = useState(null);
  const [documentsLink, setDocumentsLink] = useState(null);
  const [sendingDocsLink, setSendingDocsLink] = useState(false);
  const [externalPickerLineId, setExternalPickerLineId] = useState('');
  const [externalParticipantQuery, setExternalParticipantQuery] = useState('');
  const [externalParticipantBusyId, setExternalParticipantBusyId] = useState('');
  const [externalParticipantError, setExternalParticipantError] = useState('');
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
      const canSellCash = !!sess?.can_sell_cash;
      setCashSessionOpen(canSellCash);
      onCashSessionChange?.(canSellCash);
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
  }, [onCashSessionChange]);

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

  const externalParticipantSuggestions = useMemo(() => {
    const query = externalParticipantQuery.trim().toLowerCase();
    if (query.length < 2 || !selectedParent?.id) return [];
    const householdIds = new Set(childrenOfSelectedParent.map((child) => String(child.id)));
    return students
      .filter((student) => (
        !householdIds.has(String(student.id))
        && String(student.name || '').trim().toLowerCase().includes(query)
      ))
      .slice(0, 8)
      .map((student) => ({
        ...student,
        parentName: parents.find((parent) => String(parent.id) === String(student.parentId))?.name || '',
      }));
  }, [childrenOfSelectedParent, externalParticipantQuery, parents, selectedParent, students]);

  const effectivePhone = walkInPhone || selectedParent?.phone || '';
  const effectiveEmail = walkInEmail || selectedParent?.email || '';

  // בסליקה בקישור השליחה בוואטסאפ היא עצם הפעולה של הכפתור — אין מה לסמן,
  // וסימון נפרד רק מזמין דלפקיסט לכבות אותו בטעות. בלי טלפון בתיק אין לאן
  // לשלוח, ואז נשאר הקוד לסריקה ופתיחת עמוד הסליקה.
  useEffect(() => {
    if (paymentMethod !== 'online') return;
    setSendWhatsapp(Boolean(String(effectivePhone || '').trim()));
  }, [paymentMethod, effectivePhone]);

  // Shortcuts are an explicit merchandising choice, independent of whether a
  // product grants wall access. This prevents coaching products from appearing
  // merely because they include climbing, and lets counter products such as
  // shoes and ice pops live beside the entry button.
  const shortcutProducts = useMemo(
    () => pricelist.filter(isPosShortcut).sort(comparePosShortcuts),
    [pricelist]
  );

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

  /**
   * איפוס הקופה — מסך נקי ללקוח הבא.
   *
   * הדלפק לא תמיד מסיים במכירה: לקוח מתחרט, נבחר בטעות אדם אחר, או שהעגלה
   * נבנתה תוך כדי שיחה. בלי כפתור אחד שמנקה הכול צריך למחוק שורה־שורה,
   * ומה שנשכח מתגלגל אל הלקוח הבא.
   */
  const resetRegister = () => {
    setCart([]);
    clearCustomer();
    setAnonymousSale(false);
    setAppliedCoupon(null);
    setDismissedCoupons(new Set());
    setPaymentMethod('');
    setTenderedDenoms({});
    setEditingDiscountId(null);
    setShowCustomForm(false);
    setCustomDraft({ name: '', price: '', quantity: '1' });
    setShowQuoteOptions(false);
    setDocumentsBlock(null);
    setDocumentsLink(null);
    setResult(null);
    setError('');
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

  // לקוח שלא נמצא אינו נשמר כליד: הפרטים שלו מגיעים מהטופס שהוא ימלא, ורשומה
  // חלקית שנוצרת בדלפק רק מייצרת כפילות שמישהו יצטרך למחוק אחר כך.
  const pendingNewLeadName =
    !selectedParent && !selectedStudent ? String(customerQuery || walkInName || '').trim() : '';
  const isPendingNewLead = Boolean(pendingNewLeadName);
  // חיפוש שלא מצא — זה הרגע להציע שליחת טופס. אם מה שהוקלד הוא מספר טלפון,
  // הוא כבר היעד ואין מה להקליד שוב.
  const searchLooksLikePhone = /^[\d+\-\s()]{9,}$/.test(String(customerQuery || '').trim());
  const searchPhone = searchLooksLikePhone ? String(customerQuery).replace(/[^\d+]/g, '') : '';
  const noMatchForSearch =
    isPendingNewLead && customerSuggestions.length === 0 && Boolean(String(customerQuery || '').trim());

  // One search line covers name / phone / email of an existing customer. The
  // contact fields are only for details the sale cannot proceed without: a brand
  // new walk-in, or a selected customer missing the channel we are sending on.
  const hasSelectedCustomer = Boolean(selectedStudent || selectedParent);
  // כל עוד לא נבחר לקוח ולא נבחרה מכירה ללא זיהוי — הכרטיס מוקף בכתום.
  const customerUndecided = !hasSelectedCustomer && !anonymousSale;
  const missingSendTarget =
    hasSelectedCustomer &&
    ((sendWhatsapp && !effectivePhone.trim()) || (sendEmail && !effectiveEmail.trim()));
  // רשימת ההצעות היא שכבה צפה מעל מה שמתחתיה. כשהשדות נפתחו כבר בזמן
  // ההקלדה, הרשימה ישבה עליהם — ולכן הם מחכים שהבחירה תיסגר.
  const suggestionsOpen = Boolean(customerQuery.trim()) && !hideSuggestions;

  // במכירה ללא זיהוי אין למי לשלוח ואין למי לחייב — השדות רק מפריעים.
  const contactFieldsVisible = !anonymousSale
    && !suggestionsOpen
    && (isPendingNewLead || missingSendTarget || showContactFields);

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

  useEffect(() => {
    setDismissedCoupons(new Set());
  }, [selectedStudentId, selectedParentId]);

  // בחירת לקוח מבטלת מכירה ללא זיהוי — אי אפשר להיות שניהם.
  useEffect(() => {
    if (selectedStudentId || selectedParentId) setAnonymousSale(false);
  }, [selectedStudentId, selectedParentId]);

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
  /**
   * על אילו פריטים ההטבה חלה.
   *
   * הכרטיס אמר רק „הוסיפו פריט לעגלה” בלי לומר איזה, כך שהדרך היחידה לגלות
   * הייתה לנסות. ההגדרה כבר נמצאת בהטבה עצמה — צריך רק לתרגם מזהי מוצר לשמות.
   */
  const couponScopeText = (coupon) => {
    const parts = coupon?.offer?.parts?.length
      ? coupon.offer.parts
      : (coupon?.offer ? [coupon.offer] : []);
    const names = new Set();
    let all = false;
    for (const part of parts) {
      if (part.appliesTo === 'items') {
        for (const id of part.pricelistIds || []) {
          const item = pricelist.find((row) => String(row.id) === String(id));
          names.add(item?.name || id);
        }
      } else if (part.appliesTo === 'categories') {
        for (const name of part.categoryNames || []) names.add(name);
      } else if (part.appliesTo === 'product_type') {
        names.add(productTypeLabel(part.productType));
      } else {
        all = true;
      }
    }
    if (all && !names.size) return 'חל על כל העגלה';
    if (!names.size) return '';
    return `חל על: ${[...names].join(', ')}`;
  };

  /**
   * לקוח שמגיע לראשונה: שולחים לו את טופס ההרשמה, ולא שומרים עליו כלום.
   *
   * פתיחת תיק על סמך שם שהוקלד בדלפק מייצרת לקוחות חצי-ריקים ששמם נכתב
   * בשמיעה, ואת הפרטים האמיתיים הוא ימסור בעצמו בטופס. לכן כאן נשלח רק
   * הקישור — וואטסאפ נפתח עם ההודעה מוכנה, והדלפקיסט לוחץ שלח.
   */
  const formTargetPhone = String(searchPhone || walkInPhone || '').trim();

  const requestFormLink = async ({ linkOnly = false } = {}) => {
    const res = await fetch('/api/checkin/send-form-to-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: formTargetPhone,
        name: searchPhone ? '' : (pendingNewLeadName || walkInName || ''),
        linkOnly,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'השליחה נכשלה');
    return body;
  };

  /**
   * שליחת טופס ההרשמה בתבנית המאושרת.
   *
   * הכפתור שולח — הוא לא פותח חלון וואטסאפ שהדלפקיסט ישלח ממנו ביד. פתיחת
   * דפדפן באמצע מכירה גוזלת את המסך, ואם איש לא לחץ שם „שלח” הלקוח לא קיבל
   * כלום ואיש לא ידע.
   */
  const sendBlankFormLink = async () => {
    if (!formTargetPhone) {
      setNewClimberState('חסר טלפון — בלעדיו אין לאן לשלוח');
      return;
    }
    setNewClimberState('sending');
    try {
      const data = await requestFormLink();
      setNewClimberState(
        data.sent
          ? `✓ הטופס נשלח ל${formTargetPhone}`
          : (data.warning || 'לא נשלח — אפשר להציג קוד לסריקה במקום')
      );
      if (!data.sent && data.link) setFormQr(data.link);
    } catch (err) {
      setNewClimberState(err.message);
    }
  };

  /** הקוד על המסך — הלקוח מצלם וממלא מהטלפון שלו, בלי שנשלח לו כלום. */
  const openFormQr = async () => {
    if (formQr) { setFormQr(''); return; }
    setFormQrBusy(true);
    setNewClimberState('');
    try {
      const data = await requestFormLink({ linkOnly: true });
      if (data.link) setFormQr(data.link);
      else setNewClimberState('לא התקבל קישור לטופס');
    } catch (err) {
      setNewClimberState(err.message);
    } finally {
      setFormQrBusy(false);
    }
  };

  /**
   * הדפסת קבלה לפי מצב ההדפסה שנקבע במחשב הזה.
   *
   * במצב `os` הקבלה נבנית כ-HTML ועוברת דרך מנגנון ההדפסה של ווינדוס — כך
   * המדפסת נשארת משותפת עם תוכנת הקופה השנייה. במצב `usb` היא נשלחת ישירות
   * כ-ESC/POS, ואז גם המגירה נפתחת מאותה פקודה.
   */
  const printSaleReceipt = async (data) => {
    if (printMode() === PRINT_MODES.OS) {
      const sale = data.sale || {};
      return printReceiptViaOs(buildReceiptHtml({
        profile: businessProfile,
        sale: { ...sale, tendered_amount: sale.tendered_amount ?? (Number(tenderedAmount) || undefined) },
        changeGiven: data.changeGiven || 0,
      }));
    }
    return printReceiptFromSale(data.receiptBytes);
  };

  /** ניסיון הדפסה נוסף של הקבלה האחרונה — אחרי שהמדפסת הודלקה או חוברה. */
  const retryPrint = async () => {
    if (!lastReceipt) return;
    setError('');
    try {
      await printSaleReceipt(lastReceipt);
      setLastReceipt(null);
      setError('');
    } catch (printErr) {
      setError(`ההדפסה נכשלה שוב: ${printErr?.message || 'שגיאה לא ידועה'}`);
    }
  };

  const applyCoupon = async (coupon, { silent = false } = {}) => {
    setCouponBusy(true);
    if (!silent) setCouponError('');
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
      // בהחלה אוטומטית שווה 0 אינו הטבה — עדיף בלי כלום מאשר שורת „הטבה ₪0”.
      if (silent && !(Number(body.discount) > 0)) return;
      setAppliedCoupon({ id: coupon.id, code: coupon.code, label: coupon.label, discount: body.discount });
    } catch (err) {
      if (silent) return;
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
          // נשמר על השורה כדי שהעגלה תדע להציע בחירת משתתפים בלי לחפש
          // את המוצר במחירון בכל ציור.
          grants_wall_climbing: item.grants_wall_climbing === true,
          family_shared: item.family_shared === true,
          participants_per_unit: unitCapacity(item),
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

  /**
   * מי המשתתפים בשורה — כשמשלמים על כמה ילדים של אותו הורה יחד.
   *
   * השרת כבר יודע לשייך כל יחידה למשתתף (`participant_ids`), אבל בדלפק לא
   * הייתה דרך לומר לו על מי: כל כניסה נרשמה על המתאמן שנבחר, וגם כשקנו שתיים
   * שתיהן היו על אותו ילד. הכמות נגזרת מהבחירה ולא להפך.
   *
   * יחידה אחת אינה בהכרח אדם אחד: אימון זוגי מכסה שניים, ולכן סימון של הילד
   * השני ממלא את היחידה במקום להכפיל אותה.
   */
  const toggleParticipant = (cartLineId, studentId) => {
    setCart((prev) => prev.map((l) => {
      if (l.cartLineId !== cartLineId) return l;
      const current = Array.isArray(l.participant_ids) && l.participant_ids.length
        ? l.participant_ids
        : (selectedStudentId ? [selectedStudentId] : []);
      const next = current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId];
      if (!next.length) return l;
      const perUnit = Math.max(1, Number(l.participants_per_unit) || 1);
      return { ...l, participant_ids: next, quantity: Math.ceil(next.length / perUnit) };
    }));
  };

  const addExternalParticipant = async (cartLineId, participant) => {
    setExternalParticipantBusyId(participant.id);
    setExternalParticipantError('');
    try {
      const response = await fetch(`/api/students/${encodeURIComponent(participant.id)}/wall-documents`);
      const documents = response.ok ? await response.json() : null;
      if (!documents?.ok) {
        setExternalParticipantError(
          `אי אפשר לצרף את ${participant.name}: נדרשים הצהרת בריאות ואישור השתתפות בתוקף בתיק שלו.`
        );
        return;
      }
      setCart((prev) => prev.map((line) => {
        if (line.cartLineId !== cartLineId) return line;
        const current = Array.isArray(line.participant_ids) && line.participant_ids.length
          ? line.participant_ids
          : (selectedStudentId ? [selectedStudentId] : []);
        if (current.includes(participant.id)) return line;
        const next = [...current, participant.id];
        const perUnit = Math.max(1, Number(line.participants_per_unit) || 1);
        return { ...line, participant_ids: next, quantity: Math.ceil(next.length / perUnit) };
      }));
      setExternalParticipantQuery('');
      setExternalPickerLineId('');
    } catch {
      setExternalParticipantError('בדיקת אישור ההשתתפות נכשלה. נסו שוב.');
    } finally {
      setExternalParticipantBusyId('');
    }
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
        setResendOk(false);
        setResendMsg('השליחה נכשלה — אפשר להציג ללקוח קוד לסריקה במקום');
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

  const firstCartParticipantId = cart
    .flatMap((line) => (Array.isArray(line.participant_ids) ? line.participant_ids : []))
    .find(Boolean);
  const effectiveStudentId = selectedStudentId || firstCartParticipantId || '';

  const payloadBase = () => ({
    cart,
    studentId: effectiveStudentId || undefined,
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
    if (needsCustomer && !effectiveStudentId) {
      setError('למנוי או כרטיסייה חובה לבחור מתאמן (אפשר לחפש הורה ואז לבחור ילד)');
      return false;
    }
    if (cart.some((line) => line.grants_wall_climbing && !line.family_shared)) {
      if (!selectedParent?.id) {
        setError('לכניסה לקיר חובה לבחור את ההורה המשלם');
        return false;
      }
      if (!effectiveStudentId) {
        setError('בחרו לפחות ילד אחד שעבורו משולמת הכניסה');
        return false;
      }
      const unassignedLine = cart.find((line) => (
        line.grants_wall_climbing
        && !line.family_shared
        && !selectedStudentId
        && !(Array.isArray(line.participant_ids) && line.participant_ids.length)
      ));
      if (unassignedLine) {
        setError(`בחרו עבור מי נרכש המוצר "${unassignedLine.name}"`);
        return false;
      }
    }
    if (!anonymousSale && isPendingNewLead && !String(effectivePhone || '').trim()) {
      setError('לליד חדש חובה למלא טלפון, לבחור לקוח קיים, או לסמן מכירה ללא זיהוי');
      return false;
    }
    if (sendWhatsapp && !String(effectivePhone || '').trim()) {
      setError('לשליחה בוואטסאפ חובה למלא טלפון, או לבטל את הסימון');
      return false;
    }
    if (sendEmail && !String(effectiveEmail || '').trim()) {
      setError(paymentMethod === 'online'
        ? 'לשליחת קישור התשלום למייל חובה כתובת מייל, או לבטל את הסימון'
        : 'לשליחת החשבונית למייל חובה כתובת מייל, או לבטל את הסימון');
      return false;
    }
    if (!paymentMethod) {
      setError('יש לבחור איך התשלום מתקבל — מזומן או סליקה בקישור');
      return false;
    }
    if (paymentMethod === 'online' && !(Number(total) > 0)) {
      setError('לא ניתן ליצור קישור תשלום לסכום 0 — עמוד הסליקה יציג מחיר ברירת מחדל. שינוי מחיר או גבייה במזומן');
      return false;
    }
    if (paymentMethod === 'cash' && !cashSessionOpen) {
      setError('הקופה סגורה. פתחו אותה דרך כפתור „פתח קופה” בעגלה, או בחרו אשראי בקישור.');
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

  /**
   * המכירה הקודמת נסגרת ברגע שנכנס פריט לעגלה.
   *
   * העודף להחזר ואישור המסמך נשארו על המסך אחרי מכירה, וזה נכון — הדלפקיסט
   * צריך לראות כמה להחזיר. אבל הם נשארו שם גם אחרי שהתחילה מכירה חדשה, לצד
   * תצוגת העודף החיה של הלקוח שעומד עכשיו: שני סכומים שונים באותו מסך, בלי
   * שום דבר שמבדיל ביניהם, ואחד מהם שייך למישהו שכבר הלך. בקופה זה בדיוק סוג
   * הבלבול שגורם להחזיר את הסכום הלא נכון.
   */
  useEffect(() => {
    if (!cart.length) return;
    setLastChange(null);
    setResult(null);
  }, [cart.length]);

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

      // שום חלון לא נפתח. באמצע מכירה, לשונית שנפתחת גוזלת את המסך ומשאירה
      // את הדלפקיסט לשלוח ביד — ואם הוא שכח, איש לא יודע שההודעה לא יצאה.
      // המסך אומר אם נשלח, ומציג קוד לסריקה כשלא.
      const payUrl = data.shareUrl || data.payUrl || data.sale?.payment_url || '';
      if (payUrl) setLastPayUrl(payUrl);

      if (sendWhatsapp && !data.whatsappSent) {
        setError(
          data.whatsappError
            ? `הקישור נוצר, אבל לא נשלח: ${data.whatsappError}`
            : 'הקישור נוצר, אבל לא נשלח בוואטסאפ — בדקו מספר טלפון'
        );
      }

      if (data.changeGiven != null) {
        setLastChange(Number(data.changeGiven));
      }
      if (data.receiptBytes?.base64) {
        setLastReceipt(data);
        try {
          await printSaleReceipt(data);
          setLastReceipt(null);
        } catch (printErr) {
          console.warn('thermal print failed', printErr);
          const docUrl = data.doc?.docUrl || data.sale?.icount_doc_url;
          if (docUrl) openInvoiceFallback(docUrl);
          // ההודעה הכללית לא אמרה למה נכשל, ולכן לא היה מה לעשות איתה.
          // הסיבה שהדפדפן החזיר היא ההבדל בין „המדפסת כבויה” לבין „לא חוברה”.
          setError(
            thermalSupported()
              ? `המכירה נקלטה, אבל ההדפסה נכשלה: ${printErr?.message || 'שגיאה לא ידועה'}`
              : 'המכירה נקלטה. הדפסה ישירה לא זמינה בדפדפן הזה — נפתחה החשבונית להדפסה רגילה'
          );
        }
      }

      // מכירה שהושלמה סוגרת את הטיפול בלקוח הזה, והדלפק פנוי לבא בתור.
      //
      // עד כאן הלקוח נוקה רק במסלול קישור התשלום — שם כבר ידענו שהשארתו על
      // המסך גורמת למכירה הבאה להיתלות עליו. אותו דבר בדיוק קרה אחרי מכירה
      // במזומן, שהיא רוב מה שקורה בדלפק: העגלה התרוקנה, הלקוח נשאר, והמוכר
      // התחיל להקליד ללקוח הבא על תיק של מישהו אחר.
      //
      // מה שכן נשאר הוא אישור המסמך והעודף להחזר: הדלפקיסט עדיין צריך לקרוא
      // אותם. הם נמחקים מעצמם ברגע שנכנס פריט לעגלה הבאה.
      setCart([]);
      setTenderedDenoms({});
      setPaymentMethod('');
      setShowQuoteOptions(false);
      clearCustomer();
      setAnonymousSale(false);
      setAppliedCoupon(null);
      setDismissedCoupons(new Set());
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
    const tendered = Number(tenderedAmount);
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
  };

  const handleCashOpened = async () => {
    setCashSessionOpen(true);
    onCashSessionChange?.(true);
    setCashClosedHint(false);
    setShowOpenCash(false);
    setPaymentMethod('cash');
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
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-1)', marginBottom: 8 }}>
              מוצרים מהירים
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: 8,
            }}>
              {shortcutProducts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addToCart(item)}
                  className="card"
                  style={{
                    padding: 0,
                    minWidth: 0,
                    textAlign: 'center',
                    cursor: 'pointer',
                    border: '1px solid rgba(96,165,250,0.38)',
                    overflow: 'hidden',
                    background: 'rgba(96,165,250,0.06)',
                  }}
                >
                  <div style={{
                    height: 82,
                    background: 'var(--bg-input)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    {productImageOf(item) ? (
                      <img
                        src={productImageOf(item)}
                        alt={item.name}
                        style={{ width: '100%', height: '100%', objectFit: imageFitOf(item) }}
                      />
                    ) : (
                      <Package size={28} style={{ color: 'var(--text-3)' }} />
                    )}
                  </div>
                  <div style={{ padding: '9px 6px 10px' }}>
                    <div style={{
                      color: 'var(--text-1)', fontSize: 13, fontWeight: 800, lineHeight: 1.25,
                      minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {item.name}
                    </div>
                    <div style={{ marginTop: 4, color: '#60A5FA', fontSize: 15, fontWeight: 900 }}>
                      ₪{Number(item.price || 0).toLocaleString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {shortcutProducts.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 0' }}>
                לא סומנו מוצרים מהירים. אפשר לסמן אותם בניהול המוצרים.
              </div>
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
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 6 }}
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
                  marginTop: 10,
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
          </div>
        </div>
      </div>

      <div>
        {/* כתום = טרם מולא, כמו בכל מקום אחר במערכת. הדלפקיסט צריך לבחור:
            לקוח מזוהה, או מכירה בלי זיהוי. */}
        <div
          className="card card-p"
          style={{
            marginBottom: 28,
            overflow: 'visible',
            position: 'relative',
            zIndex: 60,
            border: customerUndecided ? '1px solid var(--amber, #F59E0B)' : undefined,
            boxShadow: customerUndecided ? '0 0 0 1px rgba(245,158,11,0.35)' : undefined,
          }}
        >
          <div className="section-title" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <User size={16} /> לקוח לחיוב
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginInlineStart: 'auto' }}
              onClick={resetRegister}
              title="ניקוי הלקוח, העגלה ואמצעי התשלום"
            >
              <RotateCcw size={14} /> איפוס קופה
            </button>
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

          {/* מכירה ללא זיהוי: קרטיב במזומן אינו דורש שם או טלפון, וכפייה
              להקליד אותם מייצרת רשומות שאיש לא יסתכל בהן שוב. */}
          {anonymousSale && !(selectedStudent || selectedParent) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="badge badge-gray">לקוח לא מזוהה</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setAnonymousSale(false)}>
                בחירת לקוח
              </button>
            </div>
          )}

          {/* שכבת החיפוש מתרוממת רק כשהרשימה פתוחה. כשהיא נשארה גבוהה תמיד
              היא כיסתה את שדה הטלפון שמתחתיה בדיוק ברגע שצריך למלא אותו. */}
          {!anonymousSale && !(selectedStudent || selectedParent) && (
            <div
              style={{
                marginBottom: 10,
                position: 'relative',
                zIndex: suggestionsOpen ? 70 : 1,
              }}
            >
              <label className="form-label">
                לקוח — שם, טלפון או מייל {needsCustomer ? '*' : ''}
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                <div style={{ position: 'relative', flex: '1 1 260px' }}>
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
                    placeholder="שם, טלפון או מייל..."
                    value={customerQuery}
                    onChange={(e) => {
                      const value = e.target.value;
                      setCustomerQuery(value);
                      setWalkInName(value);
                      setHideSuggestions(false);
                    }}
                    autoComplete="off"
                  />
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
                      {customerSuggestions.length === 0 && (
                        <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>
                          לא נמצא לקוח בשם או במספר הזה
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!needsCustomer && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ flex: '0 0 auto', whiteSpace: 'nowrap', minHeight: 38 }}
                    onClick={() => {
                      setAnonymousSale(true);
                      setSendWhatsapp(false);
                      setSendEmail(false);
                      clearCustomer();
                    }}
                  >
                    מכירה ללא זיהוי
                  </button>
                )}
              </div>
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
          })}

          {/* רק טלפון. המייל היה שדה שאיש לא מילא: החשבונית נשלחת בוואטסאפ,
              ופרטי הלקוח מגיעים מהטופס שהוא ממלא בעצמו. */}
          {contactFieldsVisible && hasSelectedCustomer ? (
            <div className="form-group">
              <label className="form-label">טלפון</label>
              <input
                className="input input-sm"
                value={walkInPhone}
                onChange={(e) => setWalkInPhone(e.target.value)}
                placeholder={selectedParent?.phone || '050...'}
              />
            </div>
          ) : (
            (selectedStudent || selectedParent) && !hideInvoiceContactEditor && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => setShowContactFields(true)}
              >
                עריכת טלפון לחשבונית
              </button>
            )
          )}

          {/* לקוח שאינו במערכת: שולחים לו את טופס ההרשמה ולא שומרים כלום. */}
          {/* מופיע כבר תוך כדי ההקלדה כשאין התאמה: להקליד מספר, לראות „לא נמצא”,
              ואז ללחוץ במקום ריק כדי שהכפתור יתגלה — זה צעד שאיש לא ינחש. */}
          {noMatchForSearch && !anonymousSale && (
            <div
              className="form-group"
              style={{
                marginBottom: 12, padding: 10, borderRadius: 10,
                background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.35)',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>לקוח שאינו במערכת</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                בלי טופס השתתפות חתום אי אפשר למכור כניסה. שלחו את הטופס — הפרטים
                ייכנסו למערכת כשהוא ימלא אותו. שום דבר לא נשמר כאן.
              </div>
              {/* מספר שהוקלד בשורת החיפוש הוא כבר היעד; אין טעם להקליד אותו שוב. */}
              {!searchPhone && (
                <input
                  className="input input-sm"
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                  placeholder="טלפון הלקוח — 050..."
                />
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ flex: '1 1 160px' }}
                  disabled={!formTargetPhone || newClimberState === 'sending'}
                  onClick={sendBlankFormLink}
                >
                  <Send size={14} />
                  {newClimberState === 'sending'
                    ? 'שולח...'
                    : searchPhone ? `שלח טופס הרשמה ל־${searchPhone}` : 'שליחת טופס הרשמה בוואטסאפ'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ flex: '0 0 auto' }}
                  disabled={formQrBusy}
                  onClick={openFormQr}
                >
                  <QrCode size={14} /> {formQr ? 'הסתר קוד' : 'קוד לסריקה'}
                </button>
              </div>
              {formQr && (
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
                  <PayQr url={formQr} size={148} caption="סרקו למילוי הטופס" />
                </div>
              )}
              {newClimberState && newClimberState !== 'sending' && (
                <div style={{ fontSize: 11.5, color: newClimberState.startsWith('✓') ? 'var(--green)' : 'var(--amber)' }}>
                  {newClimberState}
                </div>
              )}
            </div>
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
              <div className="section-title" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShoppingCart size={16} /> עגלה
              </div>
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
            {!cashSessionOpen && (
              <span className="badge badge-amber" style={{ fontWeight: 700 }}>
                קופה סגורה
              </span>
            )}
          </div>

          {cart.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: 16 }}>העגלה ריקה</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cart.map((line) => {
                const hasDiscount =
                  line.discountType && Number(line.discountValue) > 0;
                const isEditingDiscount = editingDiscountId === line.cartLineId;
                const participantIds = line.participant_ids?.length
                  ? line.participant_ids.map(String)
                  : (selectedStudentId ? [String(selectedStudentId)] : []);
                const householdIds = new Set(childrenOfSelectedParent.map((child) => String(child.id)));
                const externalParticipants = students.filter((student) => (
                  participantIds.includes(String(student.id))
                  && !householdIds.has(String(student.id))
                ));
                const lineQuantity = Number(line.quantity) || 1;
                const lineTotal = roundMoney((Number(line.unitprice) || 0) * lineQuantity);
                const listLineTotal = roundMoney(
                  (Number(line.listPrice ?? line.unitprice) || 0) * lineQuantity
                );
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
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'contents' }}>
                        <div style={{ flex: '1 1 140px', minWidth: 0, order: 0, fontWeight: 600, fontSize: 13 }}>
                          {line.name}
                          {line.isCustom ? (
                            <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 500 }}> · מותאם</span>
                          ) : null}
                        </div>
                        {/* The payer stays the selected parent. Participants can
                            be siblings, or an approved child from another file. */}
                        {line.grants_wall_climbing && !line.family_shared
                          && selectedParent?.id && (
                          <div style={{ order: 3, flex: '1 0 100%', minWidth: 0, marginTop: 2 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flexWrap: 'nowrap',
                                overflowX: 'auto',
                                paddingBottom: 2,
                              }}
                            >
                              <span style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--text-3)' }}>
                                עבור מי:
                                {(Number(line.participants_per_unit) || 1) > 1 && (
                                  <> {line.name} מכסה {line.participants_per_unit} משתתפים ליחידה</>
                                )}
                              </span>
                              {childrenOfSelectedParent.map((child) => {
                                const chosen = participantIds.includes(String(child.id));
                                return (
                                  <button
                                    key={child.id}
                                    type="button"
                                    className={`btn btn-sm ${chosen ? 'btn-primary' : 'btn-ghost'}`}
                                    style={{ flex: '0 0 auto', padding: '3px 9px', fontSize: 11 }}
                                    onClick={() => toggleParticipant(line.cartLineId, child.id)}
                                  >
                                    {child.name}
                                  </button>
                                );
                              })}
                              {externalParticipants.map((participant) => (
                                <button
                                  key={participant.id}
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  style={{ flex: '0 0 auto', padding: '3px 9px', fontSize: 11 }}
                                  onClick={() => toggleParticipant(line.cartLineId, participant.id)}
                                  title="הסרת הילד מהשורה"
                                >
                                  {participant.name} · ילד נוסף <X size={10} />
                                </button>
                              ))}
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                style={{ flex: '0 0 auto', padding: '3px 9px', fontSize: 11 }}
                                onClick={() => {
                                  const opening = externalPickerLineId !== line.cartLineId;
                                  setExternalPickerLineId(opening ? line.cartLineId : '');
                                  setExternalParticipantQuery('');
                                  setExternalParticipantError('');
                                }}
                              >
                                <Plus size={11} /> הוספת ילד שאינו מהמשפחה
                              </button>
                            </div>
                            {externalPickerLineId === line.cartLineId && (
                              <div
                                style={{
                                  marginTop: 6,
                                  padding: 8,
                                  border: '1px solid var(--border)',
                                  borderRadius: 8,
                                  background: 'var(--bg-input)',
                                }}
                              >
                                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
                                  ניתן לצרף רק ילד עם הצהרת בריאות ואישור השתתפות בתוקף.
                                </div>
                                <input
                                  className="input input-sm"
                                  value={externalParticipantQuery}
                                  onChange={(event) => {
                                    setExternalParticipantQuery(event.target.value);
                                    setExternalParticipantError('');
                                  }}
                                  placeholder="חיפוש הילד לפי שם"
                                  autoFocus
                                  style={{ width: '100%', fontSize: 12 }}
                                />
                                {externalParticipantQuery.trim().length >= 2 && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                                    {externalParticipantSuggestions.map((participant) => (
                                      <button
                                        key={participant.id}
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        disabled={externalParticipantBusyId === participant.id}
                                        onClick={() => addExternalParticipant(line.cartLineId, participant)}
                                        style={{ justifyContent: 'space-between', fontSize: 11 }}
                                      >
                                        <span>{participant.name}</span>
                                        <span style={{ color: 'var(--text-3)' }}>
                                          {externalParticipantBusyId === participant.id
                                            ? 'בודק אישור…'
                                            : (participant.parentName ? `תיק ${participant.parentName}` : 'בדיקת אישור')}
                                        </span>
                                      </button>
                                    ))}
                                    {externalParticipantSuggestions.length === 0 && (
                                      <div style={{ fontSize: 11, color: 'var(--text-3)', padding: 4 }}>
                                        לא נמצא ילד נוסף בשם הזה
                                      </div>
                                    )}
                                  </div>
                                )}
                                {externalParticipantError && (
                                  <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>
                                    {externalParticipantError}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          flexShrink: 0,
                          paddingTop: 2,
                          flexWrap: 'wrap',
                          justifyContent: 'flex-end',
                          order: 1,
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
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeLine(line.cartLineId)}
                          aria-label="מחיקת פריט"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div
                        style={{
                          order: 2,
                          flex: '0 0 auto',
                          minWidth: 64,
                          paddingTop: 5,
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'flex-end',
                          gap: 5,
                        }}
                        aria-label={`מחיר הפריט ₪${lineTotal}`}
                      >
                        {hasDiscount && listLineTotal !== lineTotal && (
                          <span style={{ fontSize: 10.5, color: 'var(--text-3)', textDecoration: 'line-through' }}>
                            ₪{listLineTotal.toLocaleString()}
                          </span>
                        )}
                        <strong style={{ fontSize: 14 }}>₪{lineTotal.toLocaleString()}</strong>
                      </div>
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
                      {couponScopeText(coupon) && (
                        <div style={{ fontSize: 11.5, color: 'var(--green)', marginTop: 2 }}>
                          {couponScopeText(coupon)}
                        </div>
                      )}
                    </div>
                    {isApplied ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          setAppliedCoupon(null);
                          setCouponError('');
                          setDismissedCoupons((prev) => new Set(prev).add(coupon.id));
                        }}
                      >
                        הסרה
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-success btn-xs"
                        disabled={couponBusy || !cart.length}
                        onClick={() => {
                          setDismissedCoupons((prev) => {
                            const next = new Set(prev);
                            next.delete(coupon.id);
                            return next;
                          });
                          applyCoupon(coupon);
                        }}
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
                  הוסיפו פריט לעגלה ואז לחצו „החלה”
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

          {cart.length > 0 && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {appliedCoupon && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--green)' }}>
                  <span>הטבה · {appliedCoupon.label} ({appliedCoupon.code})</span>
                  <span>−₪{couponDiscount.toLocaleString()}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 18 }}>
                <span>סה״כ כולל מע״מ</span>
                <span>₪{total.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* הכותרת מעל התיבה, והבחירה בתוכה — כך „איך משלמים?” נקרא כשאלה
              ולא כאפשרות שלישית שאפשר ללחוץ עליה. */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6, color: paymentMethod ? 'var(--text-2)' : '#FBBF24' }}>
              איך משלמים?
            </div>
            <div
              style={{
                display: 'flex', gap: 10, flexWrap: 'wrap',
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${paymentMethod ? 'var(--border)' : 'rgba(251, 191, 36, 0.55)'}`,
                background: paymentMethod ? 'transparent' : 'rgba(251, 191, 36, 0.06)',
              }}
            >
              {PAY_METHODS.map((m) => {
                const Icon = m.icon;
                const chosen = paymentMethod === m.id;
                const cashBlocked = m.id === 'cash' && !cashSessionOpen;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectPaymentMethod(m.id)}
                    title={cashBlocked ? 'יש לפתוח קופה לפני גבייה במזומן' : undefined}
                    style={{
                      flex: '1 1 150px',
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      textAlign: 'right',
                      opacity: cashBlocked ? 0.55 : 1,
                      border: `1px solid ${chosen ? m.color : 'var(--border)'}`,
                      background: chosen ? `${m.color}1f` : 'var(--bg-input)',
                      boxShadow: chosen ? `0 0 0 1px ${m.color}` : 'none',
                      color: 'inherit',
                    }}
                  >
                    <span
                      style={{
                        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `${m.color}22`, color: m.color,
                      }}
                    >
                      <Icon size={19} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{m.label}</span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>{m.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
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
              <div>
                משמרת הקיר פתוחה, אבל הקופה סגורה. כדי לגבות במזומן פתחו את הקופה וספרו את המזומן שבמגירה.
              </div>
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
              {/* מה שהלקוח נתן, בשטרות ומטבעות ולא כמספר. הקלדת סכום דורשת
                  לחשב אותו בראש בזמן שמישהו עומד ומחכה, וטעות שם היא עודף
                  שגוי; ספירת השטרות היא בדיוק מה שהיד עושה ממילא. */}
              <div style={{ fontSize: 13, fontWeight: 600 }}>התקבל מהלקוח</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                קליק על שטר או מטבע מוסיף אחד, קליק ימני מוריד.
              </div>
              <CashDenominationPad
                size="sm"
                value={tenderedDenoms}
                showTotal={false}
                onChange={setTenderedDenoms}
              />
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    minWidth: 0,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: 'rgba(255,255,255,0.025)',
                  }}
                >
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 3 }}>התקבל</div>
                  <strong style={{ fontSize: 17 }}>₪{Number(tenderedAmount).toFixed(2)}</strong>
                </div>
                <div
                  style={{
                    minWidth: 0,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${changePreview < 0
                      ? 'rgba(251,191,36,0.42)'
                      : changePreview > 0 ? 'rgba(96,165,250,0.42)' : 'rgba(52,211,153,0.35)'}`,
                    background: changePreview < 0
                      ? 'rgba(251,191,36,0.08)'
                      : changePreview > 0 ? 'rgba(96,165,250,0.10)' : 'rgba(52,211,153,0.07)',
                    color: changePreview < 0
                      ? 'var(--amber, #FBBF24)'
                      : changePreview > 0 ? '#60A5FA' : 'var(--green, #34D399)',
                  }}
                >
                  <div style={{ fontSize: 11.5, marginBottom: 3 }}>
                    {changePreview < 0 ? 'חסרים' : changePreview > 0 ? 'עודף להחזר' : 'הסכום הושלם'}
                  </div>
                  <strong style={{ fontSize: 17 }}>
                    ₪{Math.abs(Number(changePreview) || 0).toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {lastChange != null && lastChange > 0 && (
            <div className="alert alert-info" style={{ marginTop: 10, fontSize: 16, fontWeight: 800, color: '#60A5FA' }}>
              עודף להחזר ללקוח: ₪{Number(lastChange).toFixed(2)}
            </div>
          )}

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
            <div className="alert alert-error" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 200 }}>{error}</span>
              {lastReceipt && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={retryPrint}>
                  <Printer size={14} /> הדפסה חוזרת
                </button>
              )}
            </div>
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
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <PayQr url={lastPayUrl || result.shareUrl || result.payUrl} />
                <div
                  style={{
                    flex: 1,
                    minWidth: 180,
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
                {sendWhatsapp ? (result.whatsappSent ? ' · החשבונית נשלחה בוואטסאפ' : ' · החשבונית לא נשלחה') : ''}
              </span>
              {sendWhatsapp && !result.whatsappSent && result.whatsappError && (
                <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 4 }}>
                  {result.whatsappError}
                </div>
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
              {busy
                ? 'מעבד...'
                : !paymentMethod
                  ? 'בחרו אמצעי תשלום'
                  : paymentMethod === 'online' ? 'שלח קישור לתשלום' : 'גבה והפק חשבונית'}
            </button>
            {paymentMethod === 'cash' && (
              <SendToggle
                on={sendWhatsapp}
                onToggle={() => setSendWhatsapp((v) => !v)}
                icon={MessageCircle}
                disabled={!String(effectivePhone || '').trim()}
                title="שליחת החשבונית בוואטסאפ"
                missing="אין טלפון בתיק הלקוח"
              />
            )}
            <SendToggle
              on={sendEmail}
              onToggle={() => setSendEmail((v) => !v)}
              icon={AtSign}
              disabled={!String(effectiveEmail || '').trim()}
              title={paymentMethod === 'online' ? 'שליחת קישור התשלום למייל' : 'שליחת החשבונית למייל'}
              missing="אין כתובת מייל בתיק הלקוח"
            />
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
                ? 'הקישור יישלח בוואטסאפ ללקוח, ויוצג גם כקוד לסריקה למי שמעדיף לשלם מהטלפון.'
                : 'אין טלפון בתיק — הקישור יוצג כקוד לסריקה, ואפשר גם להעתיק אותו או לפתוח את עמוד הסליקה.'}
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
