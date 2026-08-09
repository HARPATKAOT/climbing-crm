import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Copy, CreditCard, Download, ExternalLink, Loader2, Pencil, Plus, RefreshCw,
  CalendarDays, Search, Send, Trash2, Undo2, UserCheck, UserPlus, UserRoundCheck, Users, X,
} from 'lucide-react';
import InfoHint from '../utils/InfoHint.jsx';
import { formatIls, normalizePriceIncludesVat, vatBreakdown } from '../utils/vat.js';
import { AttendanceDayBar, AttendanceToggle, useActivityAttendance } from './ActivityAttendance.jsx';
import AppSelect from './AppSelect.jsx';

function leadOpenTarget(registration) {
  if (registration?.student_id) return String(registration.student_id);
  if (registration?.parent_id) return `parent:${registration.parent_id}`;
  return null;
}

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** Customer lookup shared by the host picker and the interested-people picker. */
function matchCustomers(query, parents, students) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 1) return [];
  const phoneQ = normalizePhoneDigits(query);
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
    if (!parent) continue;
    results.push({
      key: `student:${student.id}`,
      type: 'student',
      id: parent.id,
      studentId: student.id,
      name: parent.name || 'לקוח',
      childName: student.name || '',
      isAdult: student.isAdult === true,
      phone: parent.phone || '',
      email: parent.email || '',
    });
  }

  return results.slice(0, 12);
}

function formatPaidAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function HostPaymentDetailRow({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="registration-host-payment-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function downloadHostInvoice(activityId, kind, fallbackUrl) {
  if (!activityId) {
    if (fallbackUrl) window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  try {
    const res = await fetch(
      `/api/activities/${encodeURIComponent(activityId)}/host-payment/invoice?kind=${encodeURIComponent(kind)}`
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'הורדה נכשלה');
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
    if (fallbackUrl) {
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    throw err;
  }
}

/**
 * Registration / host / payment controls for a saved calendar activity.
 * Kept separate from ActivitiesCalendar to avoid edit conflicts.
 */
export default function ActivityRegistrationPanel({
  activityId,
  form,
  setForm,
  readOnly,
  canViewFinance = true,
  hideRegistrationToggle = false,
  templateMode = false,
}) {
  const navigate = useNavigate();
  const [regs, setRegs] = useState([]);
  const [remaining, setRemaining] = useState(null);
  const [hostPayment, setHostPayment] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [hostLinkUrl, setHostLinkUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [hostCopied, setHostCopied] = useState(false);
  const [parents, setParents] = useState([]);
  const [students, setStudents] = useState([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [hideSuggestions, setHideSuggestions] = useState(false);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ participant_name: '', participant_type: 'child' });
  const [editBusy, setEditBusy] = useState('');
  const [editingPaymentStatus, setEditingPaymentStatus] = useState(false);
  const [interested, setInterested] = useState([]);
  const [interestDraft, setInterestDraft] = useState(null);
  const [interestSuggestOpen, setInterestSuggestOpen] = useState(false);
  const [interestBusy, setInterestBusy] = useState('');
  const [convertingId, setConvertingId] = useState(null);
  const [convertStatus, setConvertStatus] = useState('paid');

  // Attendance lives inside the registered-participants list, not beside it.
  // The token changes with the participant list, so a newcomer becomes
  // markable without reopening the event.
  const attendance = useActivityAttendance({
    activityId,
    enabled: !templateMode,
    refreshToken: regs.map((r) => r.id).join(','),
  });

  const openLeadFile = useCallback((openId) => {
    if (!openId) return;
    navigate(`/leads?open=${encodeURIComponent(openId)}`);
  }, [navigate]);

  const set = (key, value) => {
    if (readOnly) return;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setMany = (patch) => {
    if (readOnly) return;
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const loadRegs = useCallback(async () => {
    if (!activityId) return;
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/registrations`);
      if (!res.ok) return;
      const data = await res.json();
      setRegs(Array.isArray(data.registrations) ? data.registrations : []);
      setInterested(Array.isArray(data.interested) ? data.interested : []);
      setRemaining(data.remaining ?? null);
      setHostPayment(data.host_payment || null);
      if (data.host_payment?.payment_status && setForm) {
        setForm((prev) => {
          if (!prev) return prev;
          if (prev.payment_status === data.host_payment.payment_status) return prev;
          return { ...prev, payment_status: data.host_payment.payment_status };
        });
      }
    } catch {
      /* ignore */
    }
  }, [activityId, setForm]);

  const loadCustomers = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.all([
        fetch('/api/parents'),
        fetch('/api/students'),
      ]);
      if (pRes.ok) setParents(await pRes.json());
      if (sRes.ok) setStudents(await sRes.json());
    } catch {
      /* ignore */
    } finally {
      setCustomersLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (templateMode) return;
    loadRegs();
    loadCustomers();
  }, [loadRegs, loadCustomers, templateMode]);

  useEffect(() => {
    if (templateMode) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') loadRegs();
    };
    window.addEventListener('focus', loadRegs);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', loadRegs);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadRegs, templateMode]);

  useEffect(() => {
    if (!form?.registration_slug) return;
    // Prefer server-built public URL (skips localhost when FRONTEND_URL / public fallback is set).
    if (!activityId) {
      setLinkUrl(`${window.location.origin}/event/${form.registration_slug}`);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/registration-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enable: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.url) {
          setLinkUrl(data.url);
          setHostLinkUrl(data.hostPaymentUrl || '');
          return;
        }
      } catch {
        /* fall through */
      }
      if (!cancelled) {
        setLinkUrl(`${window.location.origin}/event/${form.registration_slug}`);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId, form?.registration_slug]);

  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    if (!hostCopied) return undefined;
    const timeout = window.setTimeout(() => setHostCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [hostCopied]);

  const selectedParent = useMemo(() => {
    if (!form?.host_parent_id) return null;
    return parents.find((p) => String(p.id) === String(form.host_parent_id)) || null;
  }, [form?.host_parent_id, parents]);

  const customerSuggestions = useMemo(
    () => matchCustomers(customerQuery, parents, students),
    [customerQuery, parents, students]
  );

  const selectCustomer = (hit) => {
    if (readOnly) return;
    setMany({
      host_parent_id: hit.id,
      host_name: hit.name || '',
      host_phone: hit.phone || '',
      host_email: hit.email || '',
      contact_name: hit.name || '',
      contact_phone: hit.phone || '',
    });
    setCustomerQuery('');
    setHideSuggestions(true);
    setMsg('');
  };

  const clearCustomer = () => {
    if (readOnly) return;
    setMany({
      host_parent_id: null,
      host_name: '',
      host_phone: '',
      host_email: '',
      contact_name: '',
      contact_phone: '',
    });
    setCustomerQuery('');
    setHideSuggestions(false);
    setMsg('');
  };

  const ensureLink = async ({ regenerate = false } = {}) => {
    if (!activityId) {
      setMsg('שמרו את האירוע קודם כדי ליצור קישור');
      return null;
    }
    setBusy('link');
    setMsg('');
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/registration-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate, enable: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'יצירת קישור נכשלה');
        return null;
      }
      setLinkUrl(data.url || '');
      setHostLinkUrl(data.hostPaymentUrl || '');
      set('registration_slug', data.slug);
      set('registration_enabled', true);
      return {
        url: data.url || '',
        hostPaymentUrl: data.hostPaymentUrl || '',
      };
    } catch {
      setMsg('שגיאת רשת');
      return null;
    } finally {
      setBusy('');
    }
  };

  const copyLink = async () => {
    let url = linkUrl;
    if (!url) {
      const created = await ensureLink();
      url = created?.url || '';
    }
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setMsg('הקישור הועתק');
    } catch {
      setCopied(false);
      setMsg(url);
    }
  };

  const copyHostLink = async () => {
    let url = hostLinkUrl;
    if (!url) {
      const created = await ensureLink();
      url = created?.hostPaymentUrl || '';
    }
    if (!url) {
      setMsg('קישור תשלום זמין רק באירוע שבו המזמין משלם');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setHostCopied(true);
      setMsg('קישור התשלום למזמין הועתק');
    } catch {
      setHostCopied(false);
      setMsg(url);
    }
  };

  const sendToHost = async (linkType = 'auto') => {
    if (!activityId) {
      setMsg('שמרו את האירוע קודם');
      return;
    }
    if (!form.host_parent_id) {
      setMsg('יש לבחור מזמין מתוך לקוחות המערכת');
      return;
    }
    if (!form.host_phone && !selectedParent?.phone) {
      setMsg('ללקוח שנבחר אין מספר טלפון');
      return;
    }
    const isHostPays =
      (form.registration_mode || (form.collect_registration_payment ? 'paid_per_participant' : 'host_pays')) === 'host_pays';
    const resolvedType = linkType === 'auto'
      ? (isHostPays ? 'host' : 'participant')
      : linkType;
    setBusy(resolvedType === 'participant' ? 'send-participants' : 'send');
    setMsg('');
    try {
      if (!form.registration_enabled) {
        set('registration_enabled', true);
      }
      await ensureLink();
      const res = await fetch(`/api/activities/${encodeURIComponent(activityId)}/send-registration-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_parent_id: form.host_parent_id,
          email: form.host_email,
          phone: form.host_phone || selectedParent?.phone,
          via: 'whatsapp',
          link_type: resolvedType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'שליחה נכשלה');
        return;
      }
      if (resolvedType === 'participant' && data.url) setLinkUrl(data.url);
      if (resolvedType === 'host' && data.url) setHostLinkUrl(data.url);
      if (data.host_name) {
        setMany({
          host_name: data.host_name,
          host_phone: data.host_phone || form.host_phone,
          host_parent_id: data.host_parent_id || form.host_parent_id,
        });
      }
      if (data.whatsappSent) {
        if (data.whatsappViaTemplate) {
          setMsg(resolvedType === 'participant'
            ? 'קישור המשתתפים נשלח למזמין בתבנית מאושרת'
            : 'קישור התשלום נשלח למזמין בתבנית מאושרת');
        } else {
          setMsg(resolvedType === 'participant'
            ? 'קישור המשתתפים נשלח למזמין בוואטסאפ'
            : 'קישור התשלום נשלח למזמין בוואטסאפ');
        }
      } else if (data.whatsappError) {
        setMsg(data.whatsappError);
      } else {
        setMsg('הקישור מוכן');
      }
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setBusy('');
    }
  };

  const beginEdit = (registration) => {
    if (readOnly) return;
    setEditingId(registration.id);
    setEditDraft({
      participant_name: registration.participant_name || '',
      participant_type: registration.participant_type === 'adult' ? 'adult' : 'child',
    });
    setMsg('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft({ participant_name: '', participant_type: 'child' });
    setEditBusy('');
  };

  const saveEdit = async (registrationId) => {
    if (!activityId || !registrationId) return;
    const name = String(editDraft.participant_name || '').trim();
    if (!name) {
      setMsg('יש למלא שם משתתף');
      return;
    }
    setEditBusy(registrationId);
    setMsg('');
    try {
      const res = await fetch(
        `/api/activities/${encodeURIComponent(activityId)}/registrations/${encodeURIComponent(registrationId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participant_name: name,
            participant_type: editDraft.participant_type,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'שמירת המשתתף נכשלה');
        return;
      }
      cancelEdit();
      setMsg('פרטי המשתתף עודכנו');
      await loadRegs();
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setEditBusy('');
    }
  };

  const removeParticipant = async (registration) => {
    if (!activityId || !registration?.id || readOnly) return;
    const ok = window.confirm(`להסיר את ${registration.participant_name || 'המשתתף'} מהאירוע?`);
    if (!ok) return;
    setEditBusy(registration.id);
    setMsg('');
    try {
      const res = await fetch(
        `/api/activities/${encodeURIComponent(activityId)}/registrations/${encodeURIComponent(registration.id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'הסרת המשתתף נכשלה');
        return;
      }
      if (editingId === registration.id) cancelEdit();
      if (data.remaining != null) setRemaining(data.remaining);
      setMsg('המשתתף הוסר מהאירוע');
      await loadRegs();
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setEditBusy('');
    }
  };

  const refundParticipant = async (registration) => {
    if (!activityId || !registration?.id || readOnly) return;
    if (registration.payment_status !== 'paid') {
      setMsg('אין תשלום שולם למשתתף הזה');
      return;
    }
    const name = registration.participant_name || 'המשתתף';
    setEditBusy(`refund:${registration.id}`);
    setMsg('');
    try {
      const previewRes = await fetch(
        `/api/activities/${encodeURIComponent(activityId)}/registrations/${encodeURIComponent(registration.id)}/refund-preview`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        setMsg(preview.error || 'חישוב ההחזר נכשל');
        return;
      }
      const recommended = Number(preview.recommendation?.amount) || 0;
      if (preview.manual_partial_refund_required) {
        const openIcount = window.confirm(
          `ההחזר המומלץ עבור ${name}: ₪${recommended.toLocaleString()}\n\n` +
          'זהו זיכוי חלקי. כדי למנוע זיכוי מלא בטעות, יש לבצע אותו במסמך המקורי ב-iCount. לפתוח אותו עכשיו?'
        );
        if (openIcount && preview.icount_doc_app_url) {
          window.open(preview.icount_doc_app_url, '_blank', 'noopener,noreferrer');
        }
        setMsg(`החזר מומלץ עבור ${name}: ₪${recommended.toLocaleString()} · נדרש זיכוי חלקי ב-iCount`);
        return;
      }
      const ok = window.confirm(
        `החזר מומלץ עבור ${name}: ₪${recommended.toLocaleString()}\n\n` +
        'לאחר האישור יבוצע זיכוי מלא למסמך התשלום. פעולה זו לא ניתנת לביטול מהמערכת.'
      );
      if (!ok) return;
      const res = await fetch(
        `/api/activities/${encodeURIComponent(activityId)}/registrations/${encodeURIComponent(registration.id)}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: `זיכוי משתתף · ${name}`,
            approved_amount: recommended,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'הזיכוי נכשל');
        return;
      }
      if (editingId === registration.id) cancelEdit();
      if (data.remaining != null) setRemaining(data.remaining);
      const names = Array.isArray(data.participantNames) ? data.participantNames.join(', ') : name;
      const amountPart = data.amount != null ? ` · ₪${data.amount}` : '';
      setMsg(
        data.sharedPayment
          ? `זוכו ${names}${amountPart} (תשלום משותף)`
          : `זוכה ${names}${amountPart}`
      );
      await loadRegs();
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setEditBusy('');
    }
  };

  // ─── מתעניינים: שיבוץ לפני הרשמה ותשלום ───────────────────────────────────
  const emptyInterestDraft = () => ({
    id: null,
    name: '',
    phone: '',
    email: '',
    parent_id: null,
    student_id: null,
    participant_type: 'child',
    notes: '',
  });

  const interestSuggestions = useMemo(() => {
    if (!interestSuggestOpen || interestDraft?.parent_id) return [];
    return matchCustomers(interestDraft?.name || '', parents, students);
  }, [interestSuggestOpen, interestDraft?.name, interestDraft?.parent_id, parents, students]);

  const pickInterestCustomer = (hit) => {
    setInterestDraft((prev) => ({
      ...(prev || emptyInterestDraft()),
      name: hit.childName || hit.name,
      phone: hit.phone || '',
      email: hit.email || '',
      parent_id: hit.id,
      student_id: hit.studentId || null,
      participant_type: hit.childName && !hit.isAdult ? 'child' : 'adult',
    }));
    setInterestSuggestOpen(false);
  };

  const saveInterest = async () => {
    if (!activityId || !interestDraft) return;
    const name = String(interestDraft.name || '').trim();
    if (!name) {
      setMsg('יש למלא שם מתעניין');
      return;
    }
    setInterestBusy('save');
    setMsg('');
    try {
      const editing = !!interestDraft.id;
      const res = await fetch(
        editing
          ? `/api/activities/${encodeURIComponent(activityId)}/interested/${encodeURIComponent(interestDraft.id)}`
          : `/api/activities/${encodeURIComponent(activityId)}/interested`,
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...interestDraft, name }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'שמירת המתעניין נכשלה');
        return;
      }
      setInterested(Array.isArray(data.interested) ? data.interested : interested);
      setInterestDraft(null);
      setInterestSuggestOpen(false);
      setMsg(editing ? 'פרטי המתעניין עודכנו' : `${name} נוסף/ה לרשימת המתעניינים`);
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setInterestBusy('');
    }
  };

  const removeInterest = async (row) => {
    if (!activityId || !row?.id || readOnly) return;
    if (!window.confirm(`להסיר את ${row.name || 'המתעניין'} מרשימת המתעניינים?`)) return;
    setInterestBusy(row.id);
    setMsg('');
    try {
      const res = await fetch(
        `/api/activities/${encodeURIComponent(activityId)}/interested/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'הסרת המתעניין נכשלה');
        return;
      }
      setInterested(Array.isArray(data.interested) ? data.interested : []);
      setMsg('המתעניין הוסר');
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setInterestBusy('');
    }
  };

  const beginConvert = (row) => {
    if (readOnly) return;
    const hostPays =
      (form.registration_mode || (form.collect_registration_payment ? 'paid_per_participant' : 'host_pays')) === 'host_pays';
    setConvertStatus(hostPays ? 'not_required' : 'paid');
    setConvertingId(row.id);
    setMsg('');
  };

  const confirmConvert = async (row) => {
    if (!activityId || !row?.id) return;
    setInterestBusy(`convert:${row.id}`);
    setMsg('');
    try {
      const res = await fetch(
        `/api/activities/${encodeURIComponent(activityId)}/interested/${encodeURIComponent(row.id)}/convert`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_status: convertStatus }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'ההעברה לרשומים נכשלה');
        return;
      }
      setConvertingId(null);
      setMsg(`${row.name} עבר/ה לרשומים`);
      await loadRegs();
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setInterestBusy('');
    }
  };

  const refundHostPayment = async () => {
    if (!activityId || readOnly) return;
    if ((form.payment_status || 'unpaid') !== 'paid') {
      setMsg('דמי ההזמנה לא מסומנים כשולמו');
      return;
    }
    setBusy('host-refund');
    setMsg('');
    try {
      const previewRes = await fetch(
        `/api/activities/${encodeURIComponent(activityId)}/host-payment/refund-preview`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        setMsg(preview.error || 'חישוב ההחזר נכשל');
        return;
      }
      const recommended = Number(preview.recommendation?.amount) || 0;
      if (preview.manual_partial_refund_required) {
        const openIcount = window.confirm(
          `החזר מומלץ לדמי ההזמנה: ₪${recommended.toLocaleString()}\n\n` +
          'זהו זיכוי חלקי ויש לבצע אותו במסמך המקורי ב-iCount. לפתוח אותו עכשיו?'
        );
        if (openIcount && preview.icount_doc_app_url) {
          window.open(preview.icount_doc_app_url, '_blank', 'noopener,noreferrer');
        }
        setMsg(`החזר מומלץ: ₪${recommended.toLocaleString()} · נדרש זיכוי חלקי ב-iCount`);
        return;
      }
      const ok = window.confirm(
        `החזר מומלץ לדמי ההזמנה: ₪${recommended.toLocaleString()}\n\n` +
        'לאחר האישור יבוצע זיכוי מלא והסטטוס ישתנה ל„זוכה”. פעולה זו לא ניתנת לביטול.'
      );
      if (!ok) return;
      const res = await fetch(
        `/api/activities/${encodeURIComponent(activityId)}/host-payment/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: `זיכוי דמי הזמנה · ${form.name || activityId}`,
            approved_amount: recommended,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'זיכוי דמי ההזמנה נכשל');
        return;
      }
      if (data.activity) {
        setForm((prev) => ({
          ...prev,
          payment_status: data.activity.payment_status || 'refunded',
          host_paid_at: data.activity.host_paid_at || null,
        }));
      } else {
        set('payment_status', 'refunded');
      }
      const amountPart = data.amount != null ? ` · ₪${data.amount}` : '';
      setMsg(`דמי ההזמנה זוכו${amountPart}`);
      await loadRegs();
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setBusy('');
    }
  };

  const payLabel = {
    unpaid: 'לא שולם',
    paid: 'שולם',
    partial: 'שולם חלקית',
    refunded: 'זוכה',
  };

  const displayName = form.host_name || form.contact_name || selectedParent?.name || '';
  const displayPhone = form.host_phone || form.contact_phone || selectedParent?.phone || '';
  const displayEmail = form.host_email || selectedParent?.email || '';
  const hasLinkedCustomer = !!form.host_parent_id;
  const hasLegacyHost = !hasLinkedCustomer && !!(displayName || displayPhone || displayEmail);
  const isHostPays =
    (form.registration_mode || (form.collect_registration_payment ? 'paid_per_participant' : 'host_pays')) === 'host_pays';
  const hostPayStatus = form.payment_status || hostPayment?.payment_status || 'unpaid';
  // בהרשמה בתשלום לכל משתתף אין דמי הזמנה מהמזמין, ולכן הסטטוס שלו יישאר
  // „לא שולם” לנצח. מציגים אותו רק כשהוא באמת אומר משהו.
  const showHostPayStatus =
    isHostPays || ['paid', 'partial', 'refunded'].includes(form.payment_status);
  const isHostRefunded =
    hostPayment?.status === 'refunded' || hostPayStatus === 'refunded';
  const hostStatusLabel = isHostRefunded
    ? 'זוכה'
    : hostPayStatus === 'paid'
      ? 'שולם'
      : hostPayStatus === 'partial'
        ? 'שולם חלקית'
        : 'לא שולם';
  const hostAmountIncludesVat = normalizePriceIncludesVat(
    hostPayment?.price_includes_vat ?? form.price_includes_vat
  );
  const hostEnteredAmountLabel = formatIls(
    hostPayment?.entered_amount ?? form.price ?? hostPayment?.amount ?? 0
  );
  const hostChargeAmountLabel = formatIls(
    hostPayment?.amount ?? vatBreakdown(form.price, hostAmountIncludesVat).gross
  );
  const canDownloadCharge = !!(hostPayment?.icount_doc_url || hostPayment?.icount_doc_number || hostPayment?.icount_doc_id);
  const canDownloadRefund = !!(hostPayment?.refund_doc_url || hostPayment?.refund_doc_number);

  const downloadHostDoc = async (kind) => {
    if (!activityId) return;
    const fallback =
      kind === 'refund' ? hostPayment?.refund_doc_url : hostPayment?.icount_doc_url;
    setBusy(kind === 'refund' ? 'dl-refund' : 'dl-charge');
    setMsg('');
    try {
      await downloadHostInvoice(activityId, kind, fallback);
    } catch (err) {
      setMsg(err.message || 'הורדת המסמך נכשלה');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="activity-registration-operations">
      <div
        className="activity-registration-operations-title"
        style={{ '--card-accent': 'var(--purple)' }}
      >
        <CreditCard aria-hidden="true" />
        תשלום והרשמה
      </div>

      {!hideRegistrationToggle && (
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)',
        }}>
          <input
            type="checkbox"
            checked={!!form.registration_enabled}
            onChange={(e) => set('registration_enabled', e.target.checked)}
            disabled={readOnly}
          />
          הפעלת דף הרשמה ציבורי
        </label>
      )}

      {/* Separate from the registration link: a private birthday has a link the
          host shares themselves, and must not be advertised on the website. */}
      {!hideRegistrationToggle && form.registration_enabled && (
        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-2)',
        }}>
          <input
            type="checkbox"
            checked={!!form.show_on_site}
            onChange={(e) => set('show_on_site', e.target.checked)}
            disabled={readOnly}
            style={{ marginTop: 3 }}
          />
          <span>
            להציג באתר הציבורי ולבוט
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-3)' }}>
              לפעילויות פתוחות לקהל בלבד. אירוע פרטי — להשאיר לא מסומן.
              {/* Two trips sat in the calendar with registration open, and the
                  bot never mentioned them: this box was the only thing missing,
                  and nothing on the screen said so. */}
              {!form.show_on_site && (
                <span style={{ display: 'block', color: 'var(--orange, #FB923C)', marginTop: 2 }}>
                  כרגע לא מסומן — הבוט לא יציע את הפעילות ללקוחות ששואלים על טיולים ואירועים.
                </span>
              )}
            </span>
          </span>
        </label>
      )}

      {canViewFinance && <label className="activity-registration-field">
        <span className="activity-registration-field-label">אופן ההרשמה והתשלום</span>
        <AppSelect
          className="input"
          value={form.registration_mode || (form.collect_registration_payment ? 'paid_per_participant' : 'host_pays')}
          onChange={(e) => setMany({
            registration_mode: e.target.value,
            collect_registration_payment: e.target.value === 'paid_per_participant',
          })}
          disabled={readOnly}
          optionIcon={(value) => (value === 'host_pays'
            ? { Icon: UserRoundCheck, color: 'var(--amber)' }
            : { Icon: Users, color: 'var(--green)' })}
        >
          <option value="paid_per_participant">הרשמה בתשלום לכל משתתף</option>
          <option value="host_pays">המזמין משלם על כל האירוע</option>
        </AppSelect>
        <span className="activity-registration-field-hint">
          {(form.registration_mode || (form.collect_registration_payment ? 'paid_per_participant' : 'host_pays')) === 'host_pays'
            ? 'המזמין מקבל קישור תשלום פרטי. המשתתפים נרשמים בחינם עם הצהרה וחתימה.'
            : 'כל הורה, ילד או מבוגר נספר במכסה ומחויב במחיר הפעילות.'}
        </span>
      </label>}

      {/* מזמין קיים רק כשהוא זה שמשלם. בהרשמה בתשלום לכל משתתף אין מזמין,
          ולכן בחירת הלקוח נעלמת — ונשאר רק סטטוס תשלום ישן, אם יש כסף בפנים. */}
      {!templateMode && showHostPayStatus && (
      <>
      <div className="activity-registration-divider">
        מזמין
      </div>

      {isHostPays && (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          בחירת מזמין מלקוחות המערכת
        </div>

        {hasLinkedCustomer ? (
          <div className="activity-registration-customer">
            <div className="activity-registration-customer-details">
              <div className="activity-registration-customer-name">
                {displayName || 'לקוח נבחר'}
              </div>
              <div className="activity-registration-customer-contact">
                {[displayPhone, displayEmail].filter(Boolean).join(' · ') || 'אין טלפון או אימייל'}
              </div>
              {selectedParent == null && customersLoaded && (
                <div style={{ fontSize: 11, color: '#FCD34D' }}>
                  הלקוח נשמר באירוע אך לא נמצא כרגע ברשימה
                </div>
              )}
            </div>
            {!readOnly && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearCustomer}
                aria-label="הסרת מזמין"
                style={{ flexShrink: 0 }}
              >
                <X size={14} />
                החלפה
              </button>
            )}
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
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
                placeholder="חיפוש לפי שם הורה, שם ילד או טלפון..."
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setHideSuggestions(false);
                }}
                disabled={readOnly}
                autoComplete="off"
              />
            </div>
            {customerQuery.trim() && !hideSuggestions && !readOnly && (
              <div
                style={{
                  position: 'absolute',
                  zIndex: 80,
                  right: 0,
                  left: 0,
                  top: '100%',
                  marginTop: 4,
                  maxHeight: 240,
                  overflow: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  background: 'var(--bg-card, #0f172a)',
                  boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
                }}
              >
                {customerSuggestions.length === 0 ? (
                  <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>
                    לא נמצא לקוח מתאים
                  </div>
                ) : (
                  customerSuggestions.map((hit) => (
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
                        {hit.type === 'student' && hit.childName
                          ? `מתאמן: ${hit.childName}`
                          : 'לקוח / הורה'}
                        {hit.phone ? ` · ${hit.phone}` : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {hasLegacyHost && (
          <div style={{
            fontSize: 12,
            color: 'var(--text-3)',
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(252, 211, 77, 0.08)',
            border: '1px solid rgba(252, 211, 77, 0.25)',
          }}>
            פרטי מזמין ישנים (טקסט חופשי):
            {' '}
            {[displayName, displayPhone, displayEmail].filter(Boolean).join(' · ')}
            {' — '}
            מומלץ לקשר ללקוח מהמערכת
          </div>
        )}
      </div>
      )}

      {/* „נגבה מכל משתתף בנפרד” כבר נאמר בשדה „אופן ההרשמה והתשלום” שמעל,
          ולכן כאן מוצג רק סטטוס תשלום המזמין — כשיש כזה. */}
      {showHostPayStatus && (
      <div className="activity-registration-field">
        <span className="activity-registration-field-label">סטטוס תשלום המזמין</span>
        {editingPaymentStatus && !readOnly && canViewFinance ? (
          <div className="activity-registration-status-row">
            <AppSelect
              className="input"
              value={form.payment_status || 'unpaid'}
              onChange={(e) => {
                set('payment_status', e.target.value);
                setEditingPaymentStatus(false);
              }}
              autoFocus
            >
              <option value="unpaid">{payLabel.unpaid}</option>
              <option value="paid">{payLabel.paid}</option>
              <option value="partial">{payLabel.partial}</option>
              <option value="refunded">{payLabel.refunded}</option>
            </AppSelect>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setEditingPaymentStatus(false)}
            >
              ביטול
            </button>
          </div>
        ) : (
          <div className="activity-registration-status-row">
            <span className="activity-registration-status-value">
              {payLabel[form.payment_status || 'unpaid'] || payLabel.unpaid}
            </span>
            {!readOnly && canViewFinance && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setEditingPaymentStatus(true)}
              >
                <Pencil size={14} />
                עריכה
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {activityId && !readOnly && canViewFinance && (form.payment_status || 'unpaid') === 'paid' && isHostPays && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={refundHostPayment}
          disabled={busy === 'host-refund'}
          style={{ alignSelf: 'flex-start' }}
        >
          {busy === 'host-refund' ? <Loader2 size={14} className="spin" /> : <Undo2 size={14} />}
          זיכוי דמי הזמנה
        </button>
      )}
      </>
      )}

      {activityId && (
        <div className="registration-sections">
          {isHostPays && canViewFinance && (
            <div className="registration-section registration-section--host">
              <div className="registration-section-header">
                <span className="registration-section-badge registration-section-badge--host">תשלום</span>
                <div className="registration-section-title registration-section-title--host">
                  קישור תשלום למזמין
                </div>
              </div>
              <div className="registration-link-row">
                <button
                  type="button"
                  className="btn btn-sm reg-action-btn reg-action-btn--send"
                  onClick={() => sendToHost('host')}
                  disabled={!!busy || readOnly}
                >
                  {busy === 'send' ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
                  שליחה
                </button>
                <div className="registration-link-value" title={hostLinkUrl || undefined}>
                  <span>{hostLinkUrl || 'אין קישור עדיין'}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm registration-copy-btn"
                  onClick={copyHostLink}
                  disabled={!!busy}
                >
                  <Copy size={14} />
                  {hostCopied ? 'הועתק' : 'העתקה'}
                </button>
              </div>

              <div className="registration-host-payment-card">
                <div className="registration-host-payment-title-row">
                  <div className="registration-host-payment-title">פרטי תשלום המזמין</div>
                  <span
                    className={`registration-host-payment-status${
                      isHostRefunded
                        ? ' registration-host-payment-status--refunded'
                        : hostPayStatus === 'paid'
                          ? ' registration-host-payment-status--paid'
                          : ''
                    }`}
                  >
                    {hostStatusLabel}
                  </span>
                </div>

                {!isHostRefunded && (
                  <div className="registration-host-payment-block">
                    <div className="registration-host-payment-rows">
                      <HostPaymentDetailRow
                        label={hostAmountIncludesVat ? 'סכום כולל מע״מ' : 'סכום לפני מע״מ'}
                        value={hostEnteredAmountLabel}
                      />
                      <HostPaymentDetailRow label="סכום לתשלום" value={hostChargeAmountLabel} />
                      <HostPaymentDetailRow
                        label="תאריך תשלום"
                        value={formatPaidAt(hostPayment?.paid_at || form.host_paid_at)}
                      />
                      <HostPaymentDetailRow
                        label="מספר מסמך"
                        value={hostPayment?.icount_doc_number || ''}
                      />
                    </div>
                    <div className="registration-host-payment-actions">
                      {canDownloadCharge ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => downloadHostDoc('charge')}
                          disabled={busy === 'dl-charge'}
                        >
                          {busy === 'dl-charge'
                            ? <Loader2 size={14} className="spin" />
                            : <Download size={14} />}
                          הורדת חשבונית
                        </button>
                      ) : hostPayStatus === 'paid' ? (
                        <span className="registration-host-payment-hint">
                          אין עדיין מסמך חיוב מקושר — ייתכן שהתשלום סומן ידנית
                        </span>
                      ) : null}
                      {!readOnly && (
                        (hostPayment?.refundable ||
                          (hostPayStatus === 'paid' && hostPayment?.status !== 'refunded')) && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={refundHostPayment}
                            disabled={busy === 'host-refund'}
                          >
                            {busy === 'host-refund'
                              ? <Loader2 size={14} className="spin" />
                              : <Undo2 size={14} />}
                            זיכוי דמי הזמנה
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}

                {isHostRefunded && (
                  <div className="registration-host-payment-ledger">
                    <div className="registration-host-payment-block">
                      <div className="registration-host-payment-block-header">
                        <div className="registration-host-payment-block-title">חיוב</div>
                        {canDownloadCharge && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => downloadHostDoc('charge')}
                            disabled={busy === 'dl-charge'}
                          >
                            {busy === 'dl-charge'
                              ? <Loader2 size={14} className="spin" />
                              : <Download size={14} />}
                            הורדה
                          </button>
                        )}
                      </div>
                      <div className="registration-host-payment-rows">
                        <HostPaymentDetailRow label="סכום" value={hostChargeAmountLabel} />
                        <HostPaymentDetailRow
                          label="תאריך"
                          value={formatPaidAt(hostPayment?.paid_at || form.host_paid_at)}
                        />
                        <HostPaymentDetailRow
                          label="מסמך"
                          value={hostPayment?.icount_doc_number || ''}
                        />
                      </div>
                    </div>

                    <div className="registration-host-payment-block registration-host-payment-block--refund">
                      <div className="registration-host-payment-block-header">
                        <div className="registration-host-payment-block-title">זיכוי</div>
                        {canDownloadRefund && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => downloadHostDoc('refund')}
                            disabled={busy === 'dl-refund'}
                          >
                            {busy === 'dl-refund'
                              ? <Loader2 size={14} className="spin" />
                              : <Download size={14} />}
                            הורדה
                          </button>
                        )}
                      </div>
                      <div className="registration-host-payment-rows">
                        <HostPaymentDetailRow label="סכום" value={hostChargeAmountLabel} />
                        <HostPaymentDetailRow
                          label="תאריך"
                          value={formatPaidAt(hostPayment?.refunded_at)}
                        />
                        <HostPaymentDetailRow
                          label="מסמך ביטול"
                          value={
                            hostPayment?.refund_doc_number ||
                            'לא נשמר מספר נפרד'
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="registration-section registration-section--participants">
            <div className="registration-section-header">
              <span className="registration-section-badge registration-section-badge--participants">משתתפים</span>
              <div className="registration-section-title">
                קישור למשתתפים
              </div>
            </div>
            <div className="registration-link-row">
              <button
                type="button"
                className="btn btn-sm reg-action-btn reg-action-btn--send-participants"
                onClick={() => sendToHost('participant')}
                disabled={!!busy || readOnly}
              >
                {busy === 'send-participants' ? <Loader2 size={14} className="spin" /> : <Users size={14} />}
                שליחה
              </button>
              <div className="registration-link-value" title={linkUrl || undefined}>
                <span>{linkUrl || 'אין קישור עדיין'}</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm registration-copy-btn"
                onClick={copyLink}
                disabled={!!busy}
              >
                <Copy size={14} />
                {copied ? 'הועתק' : 'העתקה'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!activityId && !templateMode && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
          {isHostPays
            ? 'אחרי שמירה אפשר ליצור קישור הרשמה ולשלוח למזמין'
            : 'אחרי שמירה אפשר ליצור קישור הרשמה למשתתפים'}
        </div>
      )}

      {activityId && (
        <div className="registration-participants">
          <div className="registration-participants-summary registration-participants-summary--registered">
            <div className="registration-participants-label">
              <Users size={14} />
              <span>משתתפים רשומים</span>
              {remaining != null && (
                <span className="registration-participants-remaining">
                  · נותרו {remaining}
                </span>
              )}
              {attendance.dayTotals && (
                <span className="registration-participants-remaining">
                  · הגיעו {attendance.dayTotals.attended} מתוך {attendance.dayTotals.total}
                </span>
              )}
            </div>
            <button
              type="button"
              className="icon-btn registration-refresh-btn"
              onClick={() => { loadRegs(); attendance.reload(); }}
              aria-label="רענון"
              title="רענון"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {attendance.error && (
            <div className="alert alert-danger" style={{ fontSize: 12 }}>{attendance.error}</div>
          )}
          {regs.length > 0 && attendance.hasList && (
            <AttendanceDayBar attendance={attendance} readOnly={readOnly} />
          )}
          {regs.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>עדיין אין נרשמים</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {regs.map((r) => {
                const openId = leadOpenTarget(r);
                const parentOpenId = r.parent_id ? `parent:${r.parent_id}` : null;
                const isEditing = editingId === r.id;
                const rowBusy = editBusy === r.id;
                return (
                <div
                  key={r.id}
                  className="registration-participant-row registration-participant-row--registered"
                >
                  {isEditing ? (
                    <div className="registration-participant-edit">
                      <input
                        className="input"
                        value={editDraft.participant_name}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, participant_name: e.target.value }))}
                        placeholder="שם משתתף"
                        disabled={!!rowBusy}
                      />
                      <AppSelect
                        className="input"
                        value={editDraft.participant_type}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, participant_type: e.target.value }))}
                        disabled={!!rowBusy}
                      >
                        <option value="child">ילד</option>
                        <option value="adult">מבוגר</option>
                      </AppSelect>
                      <div className="registration-participant-edit-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => saveEdit(r.id)}
                          disabled={!!rowBusy}
                        >
                          {rowBusy ? <Loader2 size={14} className="spin" /> : 'שמירה'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={cancelEdit}
                          disabled={!!rowBusy}
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="registration-participant-main">
                        {openId ? (
                          <button
                            type="button"
                            className="registration-participant-link"
                            onClick={() => openLeadFile(openId)}
                            title="פתיחת תיק לקוח"
                          >
                            <span>{r.participant_name}</span>
                            <ExternalLink size={12} />
                          </button>
                        ) : (
                          <span className="registration-participant-name">{r.participant_name}</span>
                        )}
                        {/* הרשמה חלקית — בלי זה אי אפשר להסביר ללקוח למה חויב פחות. */}
                        {Array.isArray(r.attending_dates) && r.attending_dates.length > 0 && (
                          <span
                            className="registration-partial-days"
                            title={r.attending_dates.join(' · ')}
                          >
                            <CalendarDays size={11} />
                            {r.attending_dates.length} ימים
                          </span>
                        )}
                        <small className="registration-participant-meta">
                          {r.participant_type === 'adult' ? 'מבוגר' : 'ילד'}
                          {r.parent_name && parentOpenId ? (
                            <>
                              {' · '}
                              <button
                                type="button"
                                className="registration-participant-link registration-participant-link--inline"
                                onClick={() => openLeadFile(parentOpenId)}
                                title="פתיחת תיק לקוח"
                              >
                                לקוח: {r.parent_name}
                              </button>
                            </>
                          ) : r.parent_name ? (
                            ` · לקוח: ${r.parent_name}`
                          ) : null}
                        </small>
                      </span>
                      <span className="registration-participant-status">
                        {r.declaration_signed ? 'הצהרה חתומה' : 'חסרה הצהרה'}
                        <small>
                          {r.status === 'confirmed' || r.status === 'active' ? 'הרשמה מאושרת' : 'ממתין לתשלום'}
                          {r.payment_status === 'paid'
                            ? ' · שולם'
                            : r.payment_status === 'pending'
                              ? ' · תשלום ממתין'
                              : ' · ללא תשלום'}
                        </small>
                      </span>
                      {/* מי שלא נרשם ליום שמסומן כרגע מקבל הערה במקום מתג —
                          עדיף שיֵראה בשורה ויוסבר, מאשר שייעלם ויֵראה כאילו
                          נמחק מהאירוע. */}
                      {attendance.hasList && (
                        attendance.enrolledOn(r.id) ? (
                          <span className="registration-participant-attendance">
                            <AttendanceToggle
                              status={attendance.statusFor(r.id)}
                              busy={attendance.busyFor(r.id)}
                              disabled={readOnly}
                              onMark={(status) => attendance.mark(r.id, status)}
                            />
                          </span>
                        ) : (
                          <span className="registration-participant-attendance registration-not-enrolled">
                            לא מגיע ביום הזה
                          </span>
                        )
                      )}
                      {!readOnly && (
                        <span className="registration-participant-actions">
                          {canViewFinance && r.payment_status === 'paid' && (
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => refundParticipant(r)}
                              disabled={!!editBusy}
                              aria-label="זיכוי משתתף"
                              title="זיכוי תשלום"
                            >
                              {editBusy === `refund:${r.id}`
                                ? <Loader2 size={14} className="spin" />
                                : <Undo2 size={14} />}
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => beginEdit(r)}
                            disabled={!!editBusy}
                            aria-label="עריכת משתתף"
                            title="עריכה"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => removeParticipant(r)}
                            disabled={!!editBusy}
                            aria-label="הסרת משתתף"
                            title="הסרה"
                          >
                            {editBusy === r.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activityId && (
        <div className="registration-participants">
          <div className="registration-participants-summary registration-participants-summary--interest">
            <div className="registration-participants-label">
              <UserPlus size={14} />
              <span>מתעניינים</span>
              {interested.length > 0 && (
                <span className="registration-participants-remaining">
                  · {interested.length} {interested.length === 1 ? 'ממתין' : 'ממתינים'} להרשמה
                </span>
              )}
            </div>
            {!readOnly && !interestDraft && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setInterestDraft(emptyInterestDraft());
                  setInterestSuggestOpen(false);
                }}
              >
                <Plus size={14} />
                שיבוץ מתעניין
              </button>
            )}
            <InfoHint label="מה זה מתעניינים" align="end">
              שיבוץ מתעניינים שעדיין לא נרשמו ולא שילמו. הם לא נספרים במכסת המקומות,
              וברגע שיירשמו דרך קישור המשתתפים הם יעברו לרשומים אוטומטית.
            </InfoHint>
          </div>


          {interestDraft && !readOnly && (
            <div className="registration-interest-form">
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  placeholder="שם המתעניין (או חיפוש לקוח קיים)"
                  value={interestDraft.name}
                  onChange={(e) => {
                    setInterestDraft((prev) => ({
                      ...prev,
                      name: e.target.value,
                      parent_id: null,
                      student_id: null,
                    }));
                    setInterestSuggestOpen(true);
                  }}
                  autoComplete="off"
                  autoFocus
                />
                {interestSuggestions.length > 0 && (
                  <div className="registration-interest-suggestions">
                    {interestSuggestions.map((hit) => (
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
                        onClick={() => pickInterestCustomer(hit)}
                      >
                        <span style={{ fontWeight: 700 }}>{hit.childName || hit.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                          {hit.childName ? `לקוח: ${hit.name}` : 'לקוח / הורה'}
                          {hit.phone ? ` · ${hit.phone}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className="input"
                placeholder="טלפון"
                value={interestDraft.phone}
                onChange={(e) => setInterestDraft((prev) => ({ ...prev, phone: e.target.value }))}
                autoComplete="off"
              />
              <AppSelect
                className="input"
                value={interestDraft.participant_type}
                onChange={(e) => setInterestDraft((prev) => ({ ...prev, participant_type: e.target.value }))}
              >
                <option value="child">ילד</option>
                <option value="adult">מבוגר</option>
              </AppSelect>
              <input
                className="input registration-interest-notes"
                placeholder="הערה (למשל: מחכה לתשובה מההורה)"
                value={interestDraft.notes}
                onChange={(e) => setInterestDraft((prev) => ({ ...prev, notes: e.target.value }))}
              />
              <div className="registration-interest-form-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={saveInterest}
                  disabled={interestBusy === 'save'}
                >
                  {interestBusy === 'save'
                    ? <Loader2 size={14} className="spin" />
                    : (interestDraft.id ? 'שמירה' : 'הוספה')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setInterestDraft(null);
                    setInterestSuggestOpen(false);
                  }}
                  disabled={interestBusy === 'save'}
                >
                  ביטול
                </button>
              </div>
            </div>
          )}

          {interested.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין מתעניינים משובצים</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {interested.map((row) => {
                const rowBusy = interestBusy === row.id || interestBusy === `convert:${row.id}`;
                const parentOpenId = row.parent_id ? `parent:${row.parent_id}` : null;
                return (
                  <div key={row.id} className="registration-participant-row registration-participant-row--interest">
                    <span className="registration-participant-main">
                      {parentOpenId ? (
                        <button
                          type="button"
                          className="registration-participant-link"
                          onClick={() => openLeadFile(row.student_id ? String(row.student_id) : parentOpenId)}
                          title="פתיחת תיק לקוח"
                        >
                          <span>{row.name}</span>
                          <ExternalLink size={12} />
                        </button>
                      ) : (
                        <span className="registration-participant-name">{row.name}</span>
                      )}
                      <small className="registration-participant-meta">
                        {row.participant_type === 'adult' ? 'מבוגר' : 'ילד'}
                        {row.phone ? ` · ${row.phone}` : ''}
                        {row.parent_name ? ` · לקוח: ${row.parent_name}` : ''}
                        {row.notes ? ` · ${row.notes}` : ''}
                      </small>
                    </span>

                    {convertingId === row.id && !readOnly ? (
                      <span className="registration-interest-convert">
                        <AppSelect
                          className="input"
                          value={convertStatus}
                          onChange={(e) => setConvertStatus(e.target.value)}
                          disabled={rowBusy}
                        >
                          <option value="paid">שולם</option>
                          <option value="pending">ממתין לתשלום</option>
                          <option value="not_required">ללא תשלום</option>
                        </AppSelect>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => confirmConvert(row)}
                          disabled={rowBusy}
                        >
                          {rowBusy ? <Loader2 size={14} className="spin" /> : 'רישום'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => setConvertingId(null)}
                          disabled={rowBusy}
                        >
                          ביטול
                        </button>
                      </span>
                    ) : !readOnly ? (
                      <span className="registration-participant-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => beginConvert(row)}
                          disabled={!!interestBusy}
                          aria-label="העברה לרשומים"
                          title="העברה לרשומים"
                        >
                          <UserCheck size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => {
                            setInterestDraft({
                              id: row.id,
                              name: row.name || '',
                              phone: row.phone || '',
                              email: row.email || '',
                              parent_id: row.parent_id || null,
                              student_id: row.student_id || null,
                              participant_type: row.participant_type === 'adult' ? 'adult' : 'child',
                              notes: row.notes || '',
                            });
                            setInterestSuggestOpen(false);
                          }}
                          disabled={!!interestBusy}
                          aria-label="עריכת מתעניין"
                          title="עריכה"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => removeInterest(row)}
                          disabled={!!interestBusy}
                          aria-label="הסרת מתעניין"
                          title="הסרה"
                        >
                          {interestBusy === row.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                        </button>
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {convertingId && (
            <div className="registration-interest-hint">
              רישום ידני לא מפיק חשבונית — לגבייה עם מסמך חיוב שלחו את קישור המשתתפים
              או גבו דרך הקופה.
            </div>
          )}
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 12, color: '#FCD34D' }}>{msg}</div>
      )}
    </div>
  );
}
