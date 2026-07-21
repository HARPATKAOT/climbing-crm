import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, PlusCircle, Trash2, UserCheck, Phone, Mail, Eye, X, CreditCard, Award, Send, Clipboard, Edit2, Check, LayoutGrid, List, MapPin, Tag, Bell, FileCheck2, ExternalLink, Download, ReceiptText, History, ChevronDown, Users } from 'lucide-react';
import { STATUSES, LEAD_SOURCES, LEAD_SEGMENTS } from '../mockData.js';
import { StatusBadge, Modal } from './UI.jsx';
import { downloadHealthDeclarationPdf } from '../utils/healthDeclarationPdf.js';
import ConversationPanel from './ConversationPanel.jsx';
import { attStatusMeta } from '../scheduleUtils.js';

// Normalize phone for comparison (supports 05X ↔ 9725X)
const normPhone = (p) => {
  if (!p) return '';
  let d = String(p).replace(/[^\d]/g, '');
  if (d.startsWith('0') && d.length >= 9) d = `972${d.slice(1)}`;
  return d;
};

const phoneTailMatch = (a, b) => {
  const na = normPhone(a);
  const nb = normPhone(b);
  if (!na || !nb) return false;
  return na === nb || na.slice(-9) === nb.slice(-9);
};

function isParentOnlyLead(student) {
  return !!student?._parentOnly || String(student?.id || '').startsWith('parent:');
}

/** Students + parent-only contacts (no child record required). */
function buildLeadEntries(students, parents) {
  const entries = (students || []).map((student) => ({
    key: student.id,
    student,
    parent: (parents || []).find((p) => p.id === student.parentId) || null,
  }));
  const parentIdsWithStudents = new Set((students || []).map((s) => s.parentId).filter(Boolean));
  for (const parent of parents || []) {
    if (parentIdsWithStudents.has(parent.id)) continue;
    const status = parent.status || 'lead_new';
    if (status === 'archived') continue;
    entries.push({
      key: `parent:${parent.id}`,
      parent,
      student: {
        id: `parent:${parent.id}`,
        name: '',
        parentId: parent.id,
        groupId: null,
        status,
        birthDate: '',
        notes: parent.notes || '',
        levelGrade: null,
        source: parent.source || 'unknown',
        created: parent.created_at ? String(parent.created_at).split('T')[0] : '',
        created_at: parent.created_at || null,
        _parentOnly: true,
      },
    });
  }
  return entries;
}

const sourceLabel = (m) => {
  if (m.is_ai || m.source === 'ai') return 'AI';
  if (m.source === 'phone') return 'מהטלפון';
  if (m.source === 'crm') return 'מהמערכת';
  if (m.direction === 'inbound' || m.from) return 'לקוח';
  return 'יוצא';
};

// Distinct colors per test kind (level / security / lead)
const TEST_TYPE_COLORS = {
  level:    { accent: '#38BDF8', bg: 'rgba(56,189,248,0.10)', border: 'rgba(56,189,248,0.28)' },
  security: { accent: '#FBBF24', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.28)' },
  lead:     { accent: '#34D399', bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.28)' },
};

/** Collapsible folder row for lead detail panel */
function FolderRow({ id, title, icon: Icon, summary, open, onToggle, children, summaryColor }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 10,
      marginBottom: 8,
      overflow: 'hidden',
      background: 'rgba(255,255,255,0.02)',
    }}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: open ? 'rgba(255,255,255,0.04)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'inherit',
          textAlign: 'right',
        }}
      >
        {Icon && <Icon size={15} style={{ flexShrink: 0, opacity: 0.85 }} />}
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', flexShrink: 0 }}>{title}</span>
        <span style={{
          fontSize: 12,
          color: summaryColor || 'var(--text-3)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'left',
        }}>
          {summary}
        </span>
        <ChevronDown
          size={15}
          style={{
            flexShrink: 0,
            opacity: 0.6,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>
      {open && (
        <div style={{ padding: '12px 12px 14px', borderTop: '1px solid var(--border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Lead/Customer Card (detail sidebar) ────────────────────────────────────
function CustomerCard({ student, parent, group, groups = [], onClose, onStatusChange, onDelete, onUpdateStudent, pricelist, refreshData, canManageBilling = false }) {
  if (!student) return null;
  const parentOnly = isParentOnlyLead(student);
  const statusKeys = Object.keys(STATUSES);

  const [broadcastListDefs, setBroadcastListDefs] = useState([
    { key: 'general', label: 'כללי', description: 'עדכונים שוטפים' },
    { key: 'classes', label: 'חוגים', description: 'שינויי שעות וכדומה' },
    { key: 'trips', label: 'טיולים', description: 'טיולי סנפלינג/חוץ' },
    { key: 'events', label: 'אירועים', description: 'אירועים ותחרויות מועדון' },
  ]);
  const [broadcastLists, setBroadcastLists] = useState({});
  const [loadingLists, setLoadingLists] = useState(false);
  const [editingBroadcastLists, setEditingBroadcastLists] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  
  // Edit Form Fields (student)
  const [editBirthDate, setEditBirthDate] = useState(student.birthDate || '');
  const [editNotes, setEditNotes] = useState(student.notes || '');
  const [editSegment, setEditSegment] = useState(student.segment || '');
  const [editNextFollowup, setEditNextFollowup] = useState(student.nextFollowup || '');
  const [editGroupId, setEditGroupId] = useState(student.groupId || '');
  // Edit Form Fields (parent)
  const [editParentName, setEditParentName] = useState(parent?.name || '');
  const [editPhone, setEditPhone] = useState(parent?.phone || '');
  const [editEmail, setEditEmail] = useState(parent?.email || '');
  const [editCity, setEditCity] = useState(parent?.city || '');
  const [editSource, setEditSource] = useState(parent?.source || student.source || 'unknown');

  // Health declaration + waiver status for this student
  const [healthDecl, setHealthDecl] = useState(null);
  const [sendingHealth, setSendingHealth] = useState(false);
  const [sendingOnboard, setSendingOnboard] = useState(false);
  const [healthSendMsg, setHealthSendMsg] = useState('');
  const [formTemplates, setFormTemplates] = useState([]);
  const [selectedFormSlug, setSelectedFormSlug] = useState('');
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [openFolder, setOpenFolder] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const toggleFolder = (id) => setOpenFolder((cur) => (cur === id ? null : id));

  useEffect(() => {
    fetch('/api/health-declarations')
      .then(res => res.ok ? res.json() : [])
      .then(decls => {
        const phoneKey = normPhone(parent?.phone);
        const match = (decls || []).find(d => {
          if (d.studentId && d.studentId === student.id) return true;
          if (phoneKey && normPhone(d.phone) === phoneKey) {
            const climber = d.climberName || d.studentName || '';
            if (!climber || climber === student.name || student.name?.includes(climber.split(' ')[0])) return true;
          }
          if (d.climberName && d.climberName === student.name) return true;
          if (d.studentName && d.studentName === student.name) return true;
          return false;
        });
        setHealthDecl(match || null);
      })
      .catch(() => setHealthDecl(null));
  }, [student.id, student.name, student.status, parent?.phone]);

  useEffect(() => {
    fetch('/api/form-templates')
      .then(res => res.ok ? res.json() : [])
      .then(list => {
        const active = (list || []).filter(t => t.isActive !== false);
        setFormTemplates(active);
        const def = active.find(t => t.isDefault) || active[0];
        if (def) setSelectedFormSlug(def.slug);
      })
      .catch(() => setFormTemplates([]));
  }, []);

  const selectedTemplate = formTemplates.find(t => t.slug === selectedFormSlug)
    || formTemplates.find(t => t.isDefault)
    || formTemplates[0];
  const healthPath = selectedTemplate && !selectedTemplate.isDefault
    ? `/health/${selectedTemplate.slug}`
    : '/health';
  const healthFormUrl = `${window.location.origin}${healthPath}?studentId=${encodeURIComponent(student.id)}${parent?.phone ? `&phone=${encodeURIComponent(parent.phone)}` : ''}`;
  const onboardParams = new URLSearchParams();
  if (parent?.id) onboardParams.set('parentId', parent.id);
  onboardParams.set('studentId', student.id);
  if (parent?.phone) onboardParams.set('phone', parent.phone);
  const onboardUrl = `${window.location.origin}/onboard?${onboardParams.toString()}`;
  // Only treat as signed when we have a real declaration, or explicit health_signed status
  const isHealthSigned = student.status === 'health_signed'
    || !!(healthDecl && (healthDecl.signed || healthDecl.status === 'approved' || healthDecl.waiverAccepted));

  const handleSendOnboardLink = async () => {
    if (!parent?.phone) {
      setHealthSendMsg('אין מספר טלפון לשליחה');
      return;
    }
    setSendingOnboard(true);
    setHealthSendMsg('');
    try {
      const res = await fetch(`/api/leads/${student.id}/send-onboard-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.onboardUrl) {
        setHealthSendMsg(data.warning
          ? `קישור השלמה מוכן (שליחה חלקית): ${data.onboardUrl}`
          : 'נשלח קישור להשלמת פרטים בוואטסאפ');
      } else {
        const text = encodeURIComponent(`שלום ${parent.name || ''}, בבקשה השלימו פרטים, רישום וחתימה:\n${onboardUrl}`);
        window.open(`https://wa.me/972${parent.phone.replace(/^0/, '').replace(/[-\s]/g, '')}?text=${text}`, '_blank');
        setHealthSendMsg('נפתח וואטסאפ עם קישור השלמת הפרטים');
      }
    } catch {
      const text = encodeURIComponent(`שלום ${parent.name || ''}, בבקשה השלימו פרטים, רישום וחתימה:\n${onboardUrl}`);
      window.open(`https://wa.me/972${parent.phone.replace(/^0/, '').replace(/[-\s]/g, '')}?text=${text}`, '_blank');
      setHealthSendMsg('נפתח וואטסאפ עם קישור השלמת הפרטים');
    } finally {
      setSendingOnboard(false);
    }
  };

  const handleSendHealthForm = async () => {
    if (!parent?.phone) {
      setHealthSendMsg('אין מספר טלפון לשליחה');
      return;
    }
    setSendingHealth(true);
    setHealthSendMsg('');
    try {
      const res = await fetch(`/api/leads/${student.id}/send-health-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: window.location.origin,
          templateSlug: selectedTemplate?.slug || selectedFormSlug || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.healthUrl) {
        setHealthSendMsg(data.warning
          ? `קישור מוכן (שליחה חלקית): ${data.healthUrl}`
          : 'נשלח קישור להצהרת בריאות בוואטסאפ');
      } else {
        // Fallback: open wa.me with prefilled text
        const text = encodeURIComponent(`שלום ${parent.name || ''}, בבקשה מלאו את הצהרת הבריאות והסרת האחריות:\n${healthFormUrl}`);
        window.open(`https://wa.me/972${parent.phone.replace(/^0/, '').replace(/[-\s]/g, '')}?text=${text}`, '_blank');
        setHealthSendMsg('נפתח וואטסאפ עם הקישור');
      }
    } catch (err) {
      const text = encodeURIComponent(`שלום ${parent.name || ''}, בבקשה מלאו את הצהרת הבריאות והסרת האחריות:\n${healthFormUrl}`);
      window.open(`https://wa.me/972${parent.phone.replace(/^0/, '').replace(/[-\s]/g, '')}?text=${text}`, '_blank');
      setHealthSendMsg('נפתח וואטסאפ עם הקישור');
    } finally {
      setSendingHealth(false);
    }
  };

  // iCount Billing Fields
  const [billAmount, setBillAmount] = useState('');
  const [billDescription, setBillDescription] = useState('');
  const [selectedPricelistItem, setSelectedPricelistItem] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [billingLink, setBillingLink] = useState('');
  const [lastInvoice, setLastInvoice] = useState(null);
  const [studentPayments, setStudentPayments] = useState([]);

  // Level Test Fields
  const [testLevel, setTestLevel] = useState('5A');
  const [testType, setTestType] = useState('level'); // level | security | lead
  const [testRouteStyle, setTestRouteStyle] = useState('top-rope'); // top-rope | lead (level tests only)
  const [testExaminerId, setTestExaminerId] = useState('');
  const [testNotes, setTestNotes] = useState('');
  const [testPassed, setTestPassed] = useState(true);
  const [testLoading, setTestLoading] = useState(false);
  const [showTestForm, setShowTestForm] = useState(false);
  const [levelTestsHistory, setLevelTestsHistory] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  // Fetch student attendance history for the client dossier
  useEffect(() => {
    if (parentOnly || !student?.id) {
      setAttendanceHistory([]);
      return;
    }
    let cancelled = false;
    setAttendanceLoading(true);
    fetch(`/api/attendance?studentId=${encodeURIComponent(student.id)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (cancelled) return;
        const rows = (Array.isArray(data) ? data : [])
          .slice()
          .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        setAttendanceHistory(rows);
      })
      .catch(() => {
        if (!cancelled) setAttendanceHistory([]);
      })
      .finally(() => {
        if (!cancelled) setAttendanceLoading(false);
      });
    return () => { cancelled = true; };
  }, [parentOnly, student.id]);

  // Fetch student level tests history
  useEffect(() => {
    if (!canManageBilling) return;
    fetch('/api/level-tests')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        const studentTests = (Array.isArray(data) ? data : []).filter(t => t.studentId === student.id);
        setLevelTestsHistory(studentTests);
      })
      .catch(err => console.error(err));
  }, [canManageBilling, student.id]);

  // Fetch employees for examiner picker (security / lead tests)
  useEffect(() => {
    if (!canManageBilling) return;
    fetch('/api/employees')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setEmployees(list);
        if (list.length > 0) setTestExaminerId(prev => prev || list[0].id);
      })
      .catch(err => console.error(err));
  }, [canManageBilling]);

  useEffect(() => {
    if (!parent?.id) return;
    setEditingBroadcastLists(false);
    setLoadingLists(true);
    Promise.all([
      fetch('/api/broadcast-list-defs').then((res) => (res.ok ? res.json() : null)),
      fetch(`/api/parents/${parent.id}/broadcast-lists`).then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([defs, subscriptions]) => {
        if (Array.isArray(defs) && defs.length > 0) setBroadcastListDefs(defs);
        if (subscriptions) setBroadcastLists(subscriptions);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoadingLists(false));
  }, [parent]);

  const handleListToggle = async (listKey) => {
    const currentlyOn = broadcastLists[listKey] !== false;
    const nextLists = { ...broadcastLists, [listKey]: !currentlyOn };
    setBroadcastLists(nextLists);
    try {
      await fetch(`/api/parents/${parent.id}/broadcast-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextLists)
      });
    } catch (err) {
      console.error('Failed to update broadcast lists:', err);
    }
  };

  const handleUpdateDetails = async () => {
    setSavingEdit(true);
    try {
      if (!parentOnly) {
        const sRes = await fetch(`/api/students/${student.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            birthDate: editBirthDate,
            notes: editNotes,
            segment: editSegment || null,
            nextFollowup: editNextFollowup || null,
            groupId: editGroupId || null,
            source: editSource
          })
        });
        if (sRes.ok) {
          const updated = await sRes.json();
          onUpdateStudent(student.id, updated);
        }
      }

      if (parent?.id) {
        await fetch(`/api/parents/${parent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editParentName,
            phone: editPhone,
            email: editEmail,
            city: editCity,
            source: editSource,
            notes: parentOnly ? editNotes : undefined,
            status: parentOnly ? student.status : undefined,
          })
        });
      }
      setIsEditing(false);
      if (refreshData) refreshData();
    } catch (err) {
      console.error('Failed to update details:', err);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSaveGroup = async () => {
    setSavingGroup(true);
    try {
      const res = await fetch(`/api/students/${student.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: editGroupId || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdateStudent(student.id, updated);
        setEditingGroup(false);
        if (refreshData) refreshData();
      }
    } catch (err) {
      console.error('Failed to update group:', err);
    } finally {
      setSavingGroup(false);
    }
  };

  const handlePricelistSelect = (e) => {
    const itemId = e.target.value;
    setSelectedPricelistItem(itemId);
    const item = pricelist.find(p => p.id === itemId);
    if (item) {
      setBillAmount(item.price);
      setBillDescription(item.name);
    } else {
      setBillAmount('');
      setBillDescription('');
    }
  };

  const loadStudentPayments = async () => {
    try {
      const qs = parent?.id
        ? `parentId=${encodeURIComponent(parent.id)}`
        : `studentId=${encodeURIComponent(student.id)}`;
      const res = await fetch(`/api/payments?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setStudentPayments(
        list.filter(
          (p) =>
            p.student_id === student.id ||
            (parent?.id && p.parent_id === parent.id)
        )
      );
    } catch (err) {
      console.error('Failed to load payments:', err);
    }
  };

  useEffect(() => {
    if (canManageBilling) loadStudentPayments();
  }, [canManageBilling, student.id, parent?.id]);

  const handleSendPayment = async (e) => {
    e.preventDefault();
    if (!billAmount || !billDescription) return;
    setBillingLoading(true);
    setBillingLink('');
    setLastInvoice(null);
    try {
      const response = await fetch('/api/checkout/payment-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          parentId: parent?.id,
          studentName: student.name,
          amount: parseFloat(billAmount),
          description: billDescription,
          phone: parent?.phone
        })
      });
      const resData = await response.json().catch(() => ({}));
      if (response.ok) {
        setBillingLink(resData.paymentUrl || '');
        await loadStudentPayments();
        const waNote = resData.whatsappSent ? ' ונשלחה בוואטסאפ' : ' (וואטסאפ לא נשלח — בדוק מספר/חיבור)';
        alert(`דרישת תשלום נוצרה${waNote}`);
        if (resData.syncWarning) {
          console.warn('iCount sync warning:', resData.syncWarning);
        }
      } else {
        alert(resData.error || 'שגיאה ביצירת דרישת התשלום');
      }
    } catch (err) {
      console.error('Payment request error:', err);
      alert('שגיאה ביצירת דרישת התשלום');
    } finally {
      setBillingLoading(false);
    }
  };

  const handleCreateInvoice = async () => {
    if (!billAmount || !billDescription) {
      alert('מלא תיאור וסכום לפני הפקת חשבונית');
      return;
    }
    if (!confirm(`להפיק חשבונית מס קבלה על ₪${billAmount} ל-${parent?.name || student.name}?`)) {
      return;
    }
    setInvoiceLoading(true);
    setLastInvoice(null);
    try {
      const response = await fetch('/api/icount/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentId: parent?.id,
          studentId: student.id,
          studentName: student.name,
          amount: parseFloat(billAmount),
          description: billDescription,
          phone: parent?.phone,
        }),
      });
      const resData = await response.json().catch(() => ({}));
      if (response.ok) {
        setLastInvoice({
          docNumber: resData.docNumber,
          docId: resData.docId,
          amount: billAmount,
          description: billDescription,
        });
        await loadStudentPayments();
        alert(
          resData.docNumber
            ? `חשבונית מס קבלה הופקה בהצלחה (מס׳ ${resData.docNumber})`
            : 'חשבונית הופקה בהצלחה'
        );
      } else {
        alert(resData.error || 'שגיאה בהפקת חשבונית');
      }
    } catch (err) {
      console.error('Invoice error:', err);
      alert('שגיאה בהפקת חשבונית');
    } finally {
      setInvoiceLoading(false);
    }
  };

  const handleAddTest = async (e) => {
    e.preventDefault();
    const needsExaminer = testType === 'security' || testType === 'lead';
    if (needsExaminer && !testExaminerId) {
      alert('נא לבחור את המדריך הבוחן');
      return;
    }
    const examinerName = needsExaminer
      ? (employees.find(emp => emp.id === testExaminerId)?.name || null)
      : null;
    setTestLoading(true);
    try {
      const response = await fetch('/api/level-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: student.id,
          studentName: student.name,
          level: testType === 'level' ? testLevel : null,
          test_type: testType,
          route_style: testType === 'level' ? testRouteStyle : null,
          examiner: examinerName,
          examinerId: needsExaminer ? testExaminerId : null,
          passed: testPassed,
          notes: testNotes,
          attended_ceremony: false
        })
      });
      if (response.ok) {
        const newTest = await response.json();
        setLevelTestsHistory(prev => [newTest, ...prev]);
        setTestNotes('');
        setShowTestForm(false);
        refreshData();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTestLoading(false);
    }
  };

  const healthSummary = isHealthSigned
    ? `חתום${healthDecl?.signedDate || healthDecl?.date ? ` · ${healthDecl.signedDate || healthDecl.date}` : ''}`
    : 'חסר';
  const groupSummary = group
    ? `${group.name}${group.day ? ` · יום ${group.day}` : ''}`
    : 'לא משויך';
  const attendanceSummary = attendanceLoading
    ? 'טוען...'
    : attendanceHistory.length === 0
      ? 'אין רשומות'
      : `${attendanceHistory.length} רשומות`;
  const paymentsSummary = studentPayments.length === 0
    ? 'אין תשלומים'
    : `${studentPayments.length} רשומות`;
  const testsSummary = levelTestsHistory.length === 0
    ? 'אין מבחנים'
    : `${levelTestsHistory.length} מבחנים`;
  const statusSummary = STATUSES[student.status]?.label || student.status || '—';

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 299,
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100vh',
          width: 'min(960px, 92vw)',
          background: '#0D1117',
          borderRight: '1px solid var(--border)',
          zIndex: 300,
          display: 'flex',
          flexDirection: 'row',
          boxShadow: '4px 0 25px rgba(0,0,0,0.5)',
          animation: 'slideUp 0.2s ease',
          overflow: 'hidden',
        }}
      >
        {/* Details column (RTL: appears on the right) */}
        <div
          style={{
            width: 380,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid var(--border)',
            minHeight: 0,
            overscrollBehavior: 'contain',
          }}
        >
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', lineHeight: 1.3 }}>
                  {parentOnly ? (parent?.name || 'ליד ללא מתאמן') : student.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>
                    {parentOnly
                      ? 'ללא מתאמן רשום'
                      : `תאריך לידה: ${student.birthDate || 'לא הוזן'}`}
                  </span>
                  <button className="btn btn-ghost btn-xs" onClick={() => setIsEditing(true)}>
                    <Edit2 size={11} /> ערוך
                  </button>
                </div>
              </div>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="סגור">
                <X size={18} />
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <StatusBadge status={student.status} />
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              padding: '12px 14px 16px',
              minHeight: 0,
            }}
          >
            {/* Contact — always visible compact */}
            <div style={{ marginBottom: 12 }}>
              {parent?.name && parent?.name !== student.name && (
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--text-1)' }}>
                  {parent.name} <span style={{ fontWeight: 500, color: 'var(--text-3)' }}>(הורה/משלם)</span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {parent?.phone && (
                  <a href={`tel:${parent.phone}`} className="btn btn-ghost btn-xs">
                    <Phone size={12} /> {parent.phone}
                  </a>
                )}
                {parent?.email && (
                  <a href={`mailto:${parent.email}`} className="btn btn-ghost btn-xs">
                    <Mail size={12} /> אימייל
                  </a>
                )}
                {parent?.phone && (
                  <a
                    href={`https://wa.me/972${parent.phone.replace(/^0/, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-success btn-xs"
                  >
                    וואטסאפ
                  </a>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}><Tag size={10} /> מקור</div>
                  <div style={{ fontWeight: 600 }}>
                    {(LEAD_SOURCES[parent?.source || student.source] || LEAD_SOURCES.unknown).icon}{' '}
                    {(LEAD_SOURCES[parent?.source || student.source] || LEAD_SOURCES.unknown).label}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}><UserCheck size={10} /> פלח</div>
                  <div style={{ fontWeight: 600 }}>
                    {student.segment ? (LEAD_SEGMENTS[student.segment]?.label || student.segment) : '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}><MapPin size={10} /> עיר</div>
                  <div style={{ fontWeight: 600 }}>{parent?.city || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}><Bell size={10} /> מעקב</div>
                  <div style={{ fontWeight: 600, color: student.nextFollowup ? 'var(--amber, #FCD34D)' : undefined }}>
                    {student.nextFollowup || '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Health folder */}
            <FolderRow
              id="health"
              title="הצהרת בריאות"
              icon={FileCheck2}
              summary={healthSummary}
              summaryColor={isHealthSigned ? '#34D399' : '#FCD34D'}
              open={openFolder === 'health'}
              onToggle={toggleFolder}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
                padding: '8px 10px', borderRadius: 8,
                background: isHealthSigned ? 'rgba(52, 211, 153, 0.12)' : 'rgba(252, 211, 77, 0.1)',
                border: `1px solid ${isHealthSigned ? 'rgba(52, 211, 153, 0.35)' : 'rgba(252, 211, 77, 0.35)'}`,
              }}>
                <span style={{ fontSize: 16 }}>{isHealthSigned ? '✓' : '⏳'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {isHealthSigned ? 'נחתם — הצהרת בריאות + כתב ויתור' : 'טרם נחתם'}
                  </div>
                  {healthDecl && (
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 4 }}>
                      חתם: {healthDecl.signedBy || healthDecl.parentName || '—'}
                      {(healthDecl.climberName || healthDecl.studentName) ? ` · מתאמן: ${healthDecl.climberName || healthDecl.studentName}` : ''}
                      {Object.values(healthDecl.answers || {}).some(Boolean) ? ' · יש הסתייגויות רפואיות' : ' · ללא הסתייגויות'}
                    </div>
                  )}
                </div>
              </div>
              {formTemplates.length > 0 && (
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label className="form-label" style={{ fontSize: 11 }}>סוג טופס / פעילות</label>
                  <select
                    className="select"
                    value={selectedFormSlug}
                    onChange={(e) => setSelectedFormSlug(e.target.value)}
                    style={{ fontSize: 13 }}
                  >
                    {formTemplates.map((t) => (
                      <option key={t.id} value={t.slug}>
                        {t.title}{t.isDefault ? ' (ברירת מחדל)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <a href={onboardUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-xs">
                  <ExternalLink size={12} /> פתח השלמת פרטים
                </a>
                <button
                  type="button"
                  className="btn btn-success btn-xs"
                  disabled={sendingOnboard || !parent?.phone}
                  onClick={handleSendOnboardLink}
                >
                  <Send size={12} /> {sendingOnboard ? 'שולח...' : 'שלח קישור השלמה'}
                </button>
                <a href={healthFormUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-xs">
                  <ExternalLink size={12} /> טופס בריאות
                </a>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  disabled={sendingHealth || !parent?.phone}
                  onClick={handleSendHealthForm}
                >
                  <Send size={12} /> {sendingHealth ? 'שולח...' : 'שלח הצהרת בריאות'}
                </button>
                {healthDecl && (
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    disabled={downloadingPdf}
                    onClick={async () => {
                      setDownloadingPdf(true);
                      setHealthSendMsg('');
                      try {
                        await downloadHealthDeclarationPdf(healthDecl);
                        setHealthSendMsg('קובץ האישור החתום הורד למחשב');
                      } catch (err) {
                        console.error(err);
                        setHealthSendMsg('שגיאה בהורדת האישור');
                      } finally {
                        setDownloadingPdf(false);
                      }
                    }}
                  >
                    <Download size={12} /> {downloadingPdf ? 'מכין...' : 'הורד אישור חתום'}
                  </button>
                )}
              </div>
              {healthDecl?.signature_url && (
                <div style={{
                  marginTop: 10, padding: 8, borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>עותק חתימה</div>
                  <img
                    src={healthDecl.signature_url}
                    alt="חתימה"
                    style={{ maxWidth: '100%', maxHeight: 70, background: '#0b1220', borderRadius: 8 }}
                  />
                </div>
              )}
              {healthSendMsg && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-2)', wordBreak: 'break-all' }}>
                  {healthSendMsg}
                </div>
              )}
            </FolderRow>

            {/* Group folder */}
            {!parentOnly && (
              <FolderRow
                id="group"
                title="חוג ושיוך"
                icon={Users}
                summary={groupSummary}
                open={openFolder === 'group'}
                onToggle={toggleFolder}
              >
                {editingGroup ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <select
                      className="input input-sm"
                      value={editGroupId}
                      disabled={savingGroup}
                      onChange={e => setEditGroupId(e.target.value)}
                    >
                      <option value="">— לא משויך —</option>
                      {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-primary btn-sm" disabled={savingGroup} onClick={handleSaveGroup}>
                        <Check size={13} /> {savingGroup ? 'שומר...' : 'שמור'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={savingGroup}
                        onClick={() => {
                          setEditGroupId(student.groupId || '');
                          setEditingGroup(false);
                        }}
                      >
                        ביטול
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {group ? (
                      <>
                        <div style={{ fontWeight: 700 }}>{group.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                          יום {group.day} בשעה {group.time}
                        </div>
                      </>
                    ) : (
                      <div style={{ color: 'var(--text-3)', fontSize: 13 }}>לא משויך לחוג עדיין</div>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        setEditGroupId(student.groupId || '');
                        setEditingGroup(true);
                      }}
                    >
                      <Edit2 size={11} /> ערוך שיוך
                    </button>
                  </div>
                )}
              </FolderRow>
            )}

            {/* Attendance folder */}
            {!parentOnly && (
              <FolderRow
                id="attendance"
                title="נוכחות"
                icon={History}
                summary={attendanceSummary}
                open={openFolder === 'attendance'}
                onToggle={toggleFolder}
              >
                {attendanceLoading ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען נוכחות...</div>
                ) : attendanceHistory.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין רשומות נוכחות עדיין</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                    {attendanceHistory.map((row) => {
                      const meta = attStatusMeta(row.status);
                      const groupName =
                        groups.find((g) => g.id === row.group_id)?.name
                        || (group?.id === row.group_id ? group.name : null)
                        || 'חוג';
                      return (
                        <div
                          key={row.id || `${row.date}-${row.group_id}-${row.status}`}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 12,
                            padding: '6px 0',
                            borderBottom: '1px solid var(--border)',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>{row.date || '—'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{groupName}</div>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </FolderRow>
            )}

            {/* Payments folder */}
            {canManageBilling && (
              <FolderRow
                id="payments"
                title="תשלומים"
                icon={CreditCard}
                summary={paymentsSummary}
                open={openFolder === 'payments'}
                onToggle={toggleFolder}
              >
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setShowPaymentModal(true)}
                  >
                    <Send size={13} /> שלח בקשת תשלום
                  </button>
                </div>
                {studentPayments.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין היסטוריית תשלומים</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                    {studentPayments.slice(0, 8).map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          fontSize: 12,
                          padding: '6px 0',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ color: 'var(--text-2)' }}>
                          {p.description}
                          {p.icount_doc_number ? ` · מס׳ ${p.icount_doc_number}` : ''}
                        </span>
                        <span>
                          ₪{Number(p.amount).toLocaleString()}{' '}
                          <span className={p.status === 'paid' ? 'badge badge-green' : 'badge badge-amber'}>
                            {p.status === 'paid' ? 'שולם' : p.status === 'pending' ? 'ממתין' : p.status}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </FolderRow>
            )}

            {/* Tests folder */}
            {canManageBilling && (
              <FolderRow
                id="tests"
                title="מבחנים"
                icon={Award}
                summary={testsSummary}
                open={openFolder === 'tests'}
                onToggle={toggleFolder}
              >
                {showTestForm ? (
                  <form onSubmit={handleAddTest} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <select
                        className="input input-sm"
                        style={{
                          flex: 1, minWidth: 110, fontWeight: 700,
                          color: TEST_TYPE_COLORS[testType]?.accent,
                          borderColor: TEST_TYPE_COLORS[testType]?.border,
                          background: TEST_TYPE_COLORS[testType]?.bg,
                        }}
                        value={testType}
                        onChange={e => setTestType(e.target.value)}
                      >
                        <option value="level">מבחן רמה</option>
                        <option value="security">מבחן אבטחה</option>
                        <option value="lead">מבחן הובלה</option>
                      </select>
                      {testType === 'level' && (
                        <>
                          <select className="input input-sm" style={{ flex: 1, minWidth: 80 }} value={testLevel} onChange={e => setTestLevel(e.target.value)}>
                            {['5A','5B','5C','6A','6B','6C','7A','7B','7C','8A'].map(lvl => (
                              <option key={lvl} value={lvl}>רמה {lvl}</option>
                            ))}
                          </select>
                          <select className="input input-sm" style={{ flex: 1, minWidth: 90 }} value={testRouteStyle} onChange={e => setTestRouteStyle(e.target.value)}>
                            <option value="top-rope">טופ רופ</option>
                            <option value="lead">הובלה</option>
                          </select>
                        </>
                      )}
                      {(testType === 'security' || testType === 'lead') && (
                        <select
                          className="input input-sm"
                          style={{ flex: 1.5, minWidth: 120 }}
                          required
                          value={testExaminerId}
                          onChange={e => setTestExaminerId(e.target.value)}
                        >
                          <option value="">בחר בוחן...</option>
                          {employees.map(emp => (
                            <option key={emp.id} value={emp.id}>{emp.name}</option>
                          ))}
                        </select>
                      )}
                      <select className="input input-sm" style={{ width: 72 }} value={testPassed ? 'yes' : 'no'} onChange={e => setTestPassed(e.target.value === 'yes')}>
                        <option value="yes">עבר</option>
                        <option value="no">נכשל</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="input input-sm"
                        placeholder="הערות..."
                        style={{ flex: 2 }}
                        value={testNotes}
                        onChange={e => setTestNotes(e.target.value)}
                      />
                      <button type="submit" disabled={testLoading} className="btn btn-primary btn-sm">רשום</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowTestForm(false)}>ביטול</button>
                    </div>
                  </form>
                ) : (
                  <button className="btn btn-ghost btn-sm w-full" style={{ marginBottom: 10, justifyContent: 'center', gap: 8 }} onClick={() => setShowTestForm(true)}>
                    <Plus size={13} /> שמירת מבחן חדש
                  </button>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 150, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                  {levelTestsHistory.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>לא נמצאו מבחנים מדווחים</div>
                  ) : (
                    levelTestsHistory.map(test => {
                      const asLevel = test.test_type === 'level' || test.test_type === 'top-rope';
                      const asSecurity = test.test_type === 'security';
                      const asLeadCert = test.test_type === 'lead';
                      const typeKey = asSecurity ? 'security' : asLeadCert ? 'lead' : 'level';
                      const typeColor = TEST_TYPE_COLORS[typeKey];
                      const routeStyle = test.route_style || (test.test_type === 'top-rope' ? 'top-rope' : null);
                      const routeLabel = routeStyle === 'lead' ? 'הובלה' : routeStyle === 'top-rope' ? 'טופ רופ' : null;
                      let title = 'מבחן';
                      if (asLevel) title = `רמה ${test.level || ''}${routeLabel ? ` · ${routeLabel}` : ''}`.trim();
                      else if (asSecurity) title = 'מבחן אבטחה';
                      else if (asLeadCert) title = 'מבחן הובלה';
                      const showExaminer = (asSecurity || asLeadCert) && !!test.examiner;
                      return (
                        <div key={test.id} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12,
                          padding: '8px 10px', borderRadius: 8,
                          background: typeColor.bg, border: `1px solid ${typeColor.border}`,
                          borderRight: `3px solid ${typeColor.accent}`,
                        }}>
                          <div>
                            <strong style={{ color: typeColor.accent }}>{title}</strong>
                            {showExaminer && <div style={{ color: 'var(--text-3)', fontSize: 10 }}>בוחן: {test.examiner}</div>}
                          </div>
                          <div style={{ textAlign: 'left' }}>
                            <span className={`badge ${test.passed ? 'badge-success' : 'badge-danger'}`}>{test.passed ? 'עבר' : 'נכשל'}</span>
                            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{test.date}</div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </FolderRow>
            )}

            {/* Status & notes folder */}
            <FolderRow
              id="status"
              title="סטטוס והערות"
              icon={Clipboard}
              summary={statusSummary}
              open={openFolder === 'status'}
              onToggle={toggleFolder}
            >
              {canManageBilling && (
                <>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>שינוי סטטוס</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                    {statusKeys.filter(k => k !== 'archived').map(k => (
                      <button
                        key={k}
                        className={`btn ${student.status === k ? 'btn-primary' : 'btn-ghost'} btn-xs`}
                        style={{ justifyContent: 'flex-start', gap: 8 }}
                        onClick={() => onStatusChange(student.id, k)}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUSES[k].color, flexShrink: 0 }} />
                        {STATUSES[k].label}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>הערות מעקב</div>
                  <div className="card card-p" style={{ marginBottom: 14, padding: 10 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                      {student.notes || 'אין הערות רשומות ללקוח זה'}
                    </div>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>רשימות תפוצה</div>
                {!loadingLists && (
                  <button
                    type="button"
                    className={`btn btn-xs ${editingBroadcastLists ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setEditingBroadcastLists((v) => !v)}
                  >
                    {editingBroadcastLists ? <><Check size={11} /> סיום</> : <><Edit2 size={11} /> עריכה</>}
                  </button>
                )}
              </div>
              {loadingLists ? (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>טוען רשימות תפוצה...</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: editingBroadcastLists ? 'auto' : 'none', opacity: editingBroadcastLists ? 1 : 0.85 }}>
                  {broadcastListDefs.map((list) => {
                    const label = list.description ? `${list.label} (${list.description})` : list.label;
                    const checked = broadcastLists[list.key] !== false;
                    return (
                      <label key={list.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: editingBroadcastLists ? 'pointer' : 'default' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!editingBroadcastLists}
                          onChange={() => handleListToggle(list.key)}
                          style={{ cursor: editingBroadcastLists ? 'pointer' : 'default', width: 15, height: 15 }}
                        />
                        <span style={{ color: checked ? 'var(--text-1)' : 'var(--text-3)', fontWeight: checked ? '600' : 'normal' }}>
                          {label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </FolderRow>

            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button
                className="btn btn-danger btn-xs w-full"
                style={{ justifyContent: 'center', gap: 6 }}
                onClick={() => {
                  if (confirm('האם אתה בטוח שברצונך למחוק את הלקוח לצמיתות ממאגר הלקוחות? פעולה זו תסיר גם את ההורה במידה ואין לו ילדים נוספים.')) {
                    onDelete(student.id);
                  }
                }}
              >
                <Trash2 size={12} /> מחק לקוח לצמיתות
              </button>
            </div>
          </div>
        </div>

        {/* Communication column */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(0,0,0,0.15)',
            overscrollBehavior: 'contain',
          }}
        >
          {canManageBilling ? (
            <ConversationPanel parent={parent} student={student} fillHeight />
          ) : (
            <div style={{ padding: 20, color: 'var(--text-3)', fontSize: 13 }}>
              אין הרשאה לצפייה בתקשורת
            </div>
          )}
        </div>
      </div>

      {isEditing && (
        <Modal title={`עריכת פרטי ליד: ${student.name}`} onClose={() => setIsEditing(false)}
          footer={
            <><button className="btn btn-ghost" onClick={() => setIsEditing(false)}>ביטול</button>
              <button className="btn btn-primary" disabled={savingEdit} onClick={handleUpdateDetails}>
                <Check size={15} /> {savingEdit ? 'שומר...' : 'שמור שינויים'}
              </button></>
          }
        >
          <div className="form-grid">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>פרטי המתאמן</div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">תאריך לידה</label>
                <input type="date" className="input" value={editBirthDate} onChange={e => setEditBirthDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">שיוך לחוג</label>
                <select className="input" value={editGroupId} onChange={e => setEditGroupId(e.target.value)}>
                  <option value="">— לא משויך —</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">פלח</label>
                <select className="input" value={editSegment} onChange={e => setEditSegment(e.target.value)}>
                  <option value="">— לא הוגדר —</option>
                  {Object.entries(LEAD_SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">תאריך מעקב הבא</label>
                <input type="date" className="input" value={editNextFollowup} onChange={e => setEditNextFollowup(e.target.value)} />
              </div>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', margin: '10px 0 4px' }}>פרטי הורה / משלם</div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">שם ההורה</label>
                <input className="input" value={editParentName} onChange={e => setEditParentName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">טלפון</label>
                <input className="input" type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value)} />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">אימייל</label>
                <input className="input" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">עיר</label>
                <input className="input" value={editCity} onChange={e => setEditCity(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">מקור ליד</label>
              <select className="input" value={editSource} onChange={e => setEditSource(e.target.value)}>
                {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">הערות מעקב</label>
              <textarea className="input" style={{ minHeight: 80 }} value={editNotes} onChange={e => setEditNotes(e.target.value)} />
            </div>
          </div>
        </Modal>
      )}

      {showPaymentModal && (
        <Modal
          title="דרישת תשלום / חשבונית"
          onClose={() => setShowPaymentModal(false)}
          footer={
            <button className="btn btn-ghost" onClick={() => setShowPaymentModal(false)}>סגור</button>
          }
        >
          <form onSubmit={handleSendPayment}>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label" style={{ fontSize: 11 }}>בחר מוצר מהמחירון</label>
              <select className="input input-sm" value={selectedPricelistItem} onChange={handlePricelistSelect}>
                <option value="">-- מוצר מותאם אישית --</option>
                {pricelist.map(item => (
                  <option key={item.id} value={item.id}>{item.name} ({item.price}₪)</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" style={{ fontSize: 11 }}>תיאור</label>
                <input
                  className="input input-sm"
                  placeholder="למשל: כרטיסיה 10 כניסות"
                  required
                  value={billDescription}
                  onChange={e => setBillDescription(e.target.value)}
                />
              </div>
              <div className="form-group" style={{ width: 100 }}>
                <label className="form-label" style={{ fontSize: 11 }}>מחיר (₪)</label>
                <input
                  className="input input-sm"
                  type="number"
                  placeholder="350"
                  required
                  value={billAmount}
                  onChange={e => setBillAmount(e.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="submit" disabled={billingLoading || invoiceLoading} className="btn btn-primary btn-sm w-full" style={{ justifyContent: 'center', gap: 8 }}>
                <Send size={13} /> {billingLoading ? 'מייצר קישור...' : 'שלח קישור סליקה בוואטסאפ'}
              </button>
              <button
                type="button"
                disabled={billingLoading || invoiceLoading}
                className="btn btn-ghost btn-sm w-full"
                style={{ justifyContent: 'center', gap: 8 }}
                onClick={handleCreateInvoice}
              >
                <ReceiptText size={13} /> {invoiceLoading ? 'מפיק חשבונית...' : 'הפק חשבונית מס קבלה עכשיו'}
              </button>
            </div>
          </form>
          {billingLink && (
            <div style={{ marginTop: 10, padding: 8, background: '#1F2937', borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}>
              <strong>קישור לתשלום:</strong><br />
              <a href={billingLink} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>{billingLink}</a>
            </div>
          )}
          {lastInvoice && (
            <div className="alert alert-success" style={{ marginTop: 10, fontSize: 12 }}>
              חשבונית הופקה
              {lastInvoice.docNumber ? ` · מס׳ ${lastInvoice.docNumber}` : ''}
              {' '}· ₪{lastInvoice.amount} · {lastInvoice.description}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}


// ─── Add Lead Modal ──────────────────────────────────────────────────────────
function AddLeadModal({ students, parents, onAdd, onClose }) {
  const [parentName, setParentName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [source, setSource] = useState('phone');
  const [isAdult, setIsAdult] = useState(false);
  const [children, setChildren] = useState(['']);
  const [warnings, setWarnings] = useState([]);

  const checkDuplicates = (childrenList, phoneVal) => {
    if (!phoneVal) { setWarnings([]); return; }
    const dupes = childrenList
      .filter(c => c)
      .filter(name => students.some(
        s => s.name.trim() === name.trim() &&
          parents.find(p => p.id === s.parentId)?.phone &&
          normPhone(parents.find(p => p.id === s.parentId).phone) === normPhone(phoneVal)
      ));
    setWarnings(dupes);
  };

  const updateChild = (idx, val) => {
    const next = [...children]; next[idx] = val; setChildren(next);
    checkDuplicates(next, phone);
  };

  const updatePhone = val => {
    setPhone(val);
    checkDuplicates(children, val);
  };

  const handleSubmit = e => {
    e.preventDefault();
    if (!parentName || !phone) return;
    
    let finalChildren = children.map(c => c.trim()).filter(Boolean);
    if (isAdult && finalChildren.length === 0) {
      finalChildren = [parentName.trim()];
    }

    onAdd({ parentName: parentName.trim(), phone: phone.trim(), email: email.trim(), city: city.trim(), source, children: finalChildren });
    onClose();
  };

  return (
    <Modal title="רישום ליד/לקוח חדש" onClose={onClose}
      footer={
        <><button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="add-lead-form" type="submit" className="btn btn-primary">
            <UserCheck size={16} /> קלוט ליד
          </button></>
      }
    >
      <form id="add-lead-form" onSubmit={handleSubmit} className="form-grid">
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="checkbox-item" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'var(--bg-2)', padding: 10, borderRadius: 8 }}>
            <input type="checkbox" checked={isAdult} onChange={e => setIsAdult(e.target.checked)} style={{ accentColor: 'var(--primary)' }} />
            <span style={{ fontSize: 14 }}>מתאמן בוגר (מעל גיל 18, נרשם לעצמו)</span>
          </label>
        </div>

        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">{isAdult ? 'שם המתאמן *' : 'שם ההורה *'}</label>
            <input className="input" placeholder="דניאל כהן" required value={parentName} onChange={e => setParentName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">טלפון וואטסאפ *</label>
            <input className="input" type="tel" placeholder="052-1234567" required value={phone} onChange={e => updatePhone(e.target.value)} />
          </div>
        </div>
        <div className="form-grid-2">
          <div className="form-group">
            <label className="form-label">אימייל (לא חובה)</label>
            <input className="input" type="email" placeholder="email@gmail.com" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">עיר (לא חובה)</label>
            <input className="input" placeholder="ירושלים" value={city} onChange={e => setCity(e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">מקור הליד</label>
          <select className="input" value={source} onChange={e => setSource(e.target.value)}>
            {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        
        {!isAdult && (
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>שמות הילדים (לא חובה)</span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setChildren([...children, ''])}>
                <PlusCircle size={13} /> הוסף ילד
              </button>
            </label>
            {children.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input className="input" placeholder={`שם הילד ${i + 1}`} value={c} onChange={e => updateChild(i, e.target.value)} />
                {children.length > 1 && (
                  <button type="button" className="btn btn-danger btn-icon btn-sm" onClick={() => {
                    const next = children.filter((_, j) => j !== i); setChildren(next); checkDuplicates(next, phone);
                  }}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="alert alert-warn">
            ⚠️ הילד{warnings.length > 1 ? 'ים' : ''} <strong>{warnings.join(', ')}</strong> כבר קיים/ים במערכת תחת הטלפון הזה.
            הסטטוס שלהם יוחזר ל"ליד חדש" באופן אוטומטי.
          </div>
        )}
      </form>
    </Modal>
  );
}

// ─── Main Leads / Customers Page ─────────────────────────────────────────────
export default function Leads({ students, setStudents, parents, setParents, groups, canManageBilling = false }) {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [pricelist, setPricelist] = useState([]);
  const [viewMode, setViewMode] = useState('table');
  const [dragOverStatus, setDragOverStatus] = useState(null);

  // Fetch pricelist for billing options
  useEffect(() => {
    if (!canManageBilling) return;
    fetch('/api/pricelist')
      .then(res => res.ok ? res.json() : [])
      .then(data => setPricelist(data))
      .catch(err => console.error(err));
  }, [canManageBilling]);

  const refreshData = async () => {
    try {
      const freshStudents = await fetch('/api/students').then(r => r.json());
      const freshParents = await fetch('/api/parents').then(r => r.json());
      setStudents(freshStudents);
      setParents(freshParents);
    } catch (e) {
      console.error(e);
    }
  };

  const leadEntries = buildLeadEntries(students, parents);

  const filtered = leadEntries.filter(({ student: s, parent: p }) => {
    const parent = p || parents.find((x) => x.id === s.parentId);
    const matchSearch = (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
      parent?.name?.toLowerCase().includes(search.toLowerCase()) ||
      (parent?.phone || '').includes(search);
    const matchStatus = filterStatus === 'all' || s.status === filterStatus;
    return matchSearch && matchStatus;
  }).map((entry) => entry.student);

  const selectedStudent = students.find(s => s.id === selectedStudentId)
    || (selectedStudentId?.startsWith('parent:')
      ? buildLeadEntries(students, parents).find((e) => e.key === selectedStudentId)?.student
      : null);
  const selectedParent = selectedStudent ? parents.find(p => p.id === selectedStudent.parentId) : null;
  const selectedGroup = selectedStudent?.groupId ? groups.find(g => g.id === selectedStudent.groupId) : null;

  const handleAdd = async ({ parentName, phone, email, city, source, children }) => {
    let updatedParents = [...parents];
    let updatedStudents = [...students];

    // Find or create parent
    let parent = updatedParents.find(p => normPhone(p.phone) === normPhone(phone));
    if (!parent) {
      parent = { id: `p${Date.now()}`, name: parentName, phone, email, city, source };
      updatedParents.push(parent);
    }

    children.forEach(childName => {
      const existingIdx = updatedStudents.findIndex(
        s => s.name.trim() === childName && s.parentId === parent.id
      );
      if (existingIdx !== -1) {
        updatedStudents[existingIdx] = { ...updatedStudents[existingIdx], status: 'lead_new', updated: new Date().toISOString().split('T')[0] };
      } else {
        updatedStudents.unshift({
          id: `s${Date.now()}-${childName}`,
          name: childName,
          parentId: parent.id,
          groupId: null,
          status: 'lead_new',
          birthDate: '',
          notes: '',
          levelGrade: null,
          created: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
        });
      }
    });

    if (children.length === 0) {
      parent = { ...parent, status: 'lead_new' };
      const pIdx = updatedParents.findIndex((p) => p.id === parent.id);
      if (pIdx >= 0) updatedParents[pIdx] = parent;
    }

    setParents(updatedParents);
    setStudents(updatedStudents);

    // Sync to backend API
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentName, phone, email, city, source, children }),
      });
      if (response.ok) {
        refreshData();
      }
    } catch (e) {
      console.warn('Backend offline, lead saved only locally.', e);
    }
  };

  const handleStatusChange = async (studentId, newStatus) => {
    if (isParentOnlyLead({ id: studentId })) {
      const parentId = studentId.replace(/^parent:/, '');
      setParents((prev) => prev.map((p) => (p.id === parentId ? { ...p, status: newStatus } : p)));
      try {
        await fetch(`/api/parents/${parentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch (e) {
        console.warn('Backend offline, status updated only locally.', e);
      }
      return;
    }
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, status: newStatus } : s));

    try {
      await fetch(`/api/students/${studentId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (e) {
      console.warn('Backend offline, status updated only locally.', e);
    }
  };

  const handleDelete = async (studentId) => {
    try {
      if (isParentOnlyLead({ id: studentId })) {
        const parentId = studentId.replace(/^parent:/, '');
        const response = await fetch(`/api/parents/${parentId}`, { method: 'DELETE' });
        if (response.ok) {
          setSelectedStudentId(null);
          refreshData();
        }
        return;
      }
      const response = await fetch(`/api/students/${studentId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setSelectedStudentId(null);
        refreshData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateStudent = (studentId, updatedData) => {
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updatedData } : s));
  };

  return (
    <div className="fade-in">
      {selectedStudentId && (
        <CustomerCard
          key={selectedStudentId}
          student={selectedStudent}
          parent={selectedParent}
          group={selectedGroup}
          groups={groups}
          pricelist={pricelist}
          onClose={() => setSelectedStudentId(null)}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onUpdateStudent={handleUpdateStudent}
          refreshData={refreshData}
          canManageBilling={canManageBilling}
        />
      )}

      {showAddModal && (
        <AddLeadModal students={students} parents={parents} onAdd={handleAdd} onClose={() => setShowAddModal(false)} />
      )}

      {/* Toolbar */}
      <div className="section-header">
        <div>
          <div className="section-title">מאגר לקוחות ולידים</div>
          <div className="section-sub">{leadEntries.length} רשומות סה"כ</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="input-icon-wrap">
            <Search className="input-icon" size={16} />
            <input
              className="input"
              placeholder="חיפוש לפי שם, הורה, טלפון..."
              style={{ width: 240, paddingRight: 36 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-2)', borderRadius: 8, padding: 2 }}>
            <button className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMode('table')} title="תצוגת טבלה">
              <List size={16} />
            </button>
            <button className={`btn btn-sm ${viewMode === 'kanban' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMode('kanban')} title="תצוגת קנבן">
              <LayoutGrid size={16} />
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} /> ליד חדש
          </button>
        </div>
      </div>

      {/* Status filter tabs (table view) */}
      {viewMode === 'table' && (
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${filterStatus === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterStatus('all')}>
          הכל ({leadEntries.length})
        </button>
        {Object.entries(STATUSES).filter(([k]) => k !== 'archived').map(([k, v]) => (
          <button key={k} className={`btn btn-sm ${filterStatus === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilterStatus(k)}>
            {v.label} ({leadEntries.filter((e) => e.student.status === k).length})
          </button>
        ))}
      </div>
      )}

      {/* Kanban board (funnel by status) */}
      {viewMode === 'kanban' && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' }}>
          {Object.entries(STATUSES).filter(([k]) => k !== 'archived').map(([statusKey, statusVal]) => {
            const colStudents = filtered.filter(s => s.status === statusKey);
            return (
              <div
                key={statusKey}
                onDragOver={e => { e.preventDefault(); setDragOverStatus(statusKey); }}
                onDragLeave={() => setDragOverStatus(prev => prev === statusKey ? null : prev)}
                onDrop={e => {
                  e.preventDefault();
                  const sid = e.dataTransfer.getData('text/plain');
                  if (sid) handleStatusChange(sid, statusKey);
                  setDragOverStatus(null);
                }}
                style={{
                  minWidth: 240, width: 240, flexShrink: 0,
                  background: dragOverStatus === statusKey ? 'rgba(129,140,248,0.08)' : 'var(--bg-2)',
                  border: `1px solid ${dragOverStatus === statusKey ? statusVal.color : 'var(--border)'}`,
                  borderRadius: 12, padding: 10, transition: 'background 0.15s, border-color 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusVal.color }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>{statusVal.label}</span>
                  <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--text-3)', background: 'var(--bg-1)', borderRadius: 10, padding: '1px 8px' }}>{colStudents.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 40 }}>
                  {colStudents.map(s => {
                    const parent = parents.find(p => p.id === s.parentId);
                    const group = s.groupId ? groups.find(g => g.id === s.groupId) : null;
                    const src = LEAD_SOURCES[parent?.source || s.source] || LEAD_SOURCES.unknown;
                    return (
                      <div
                        key={s.id}
                        draggable
                        onDragStart={e => e.dataTransfer.setData('text/plain', s.id)}
                        onClick={() => setSelectedStudentId(s.id)}
                        className="card card-p"
                        style={{ cursor: 'grab', padding: 10 }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)', marginBottom: 4 }}>{s.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{parent?.name}</div>
                        {parent?.phone && <div style={{ fontSize: 11, color: 'var(--text-3)', direction: 'ltr', unicodeBidi: 'plaintext' }}>{parent.phone}</div>}
                        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                          <span className="badge badge-gray" style={{ fontSize: 10 }}>{src.icon} {src.label}</span>
                          {group && <span className="badge badge-blue" style={{ fontSize: 10 }}>{group.name.split(' ')[0]}</span>}
                          {s.nextFollowup && <span className="badge badge-amber" style={{ fontSize: 10 }}>🔔 {s.nextFollowup}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {colStudents.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: 12 }}>גרור לכאן</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      {viewMode === 'table' && (
      <div className="card">
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>שם הילד</th>
                <th>שם ההורה</th>
                <th>טלפון</th>
                <th>קבוצה</th>
                <th>רמה</th>
                <th>סטטוס</th>
                <th>תאריך קליטה</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>אין תוצאות</td></tr>
              )}
              {filtered.map(s => {
                const parent = parents.find(p => p.id === s.parentId);
                const group = s.groupId ? groups.find(g => g.id === s.groupId) : null;
                const isIg = parent?.instagram_id || parent?.channel === 'instagram' || s.notes?.includes('אינסטגרם');
                return (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedStudentId(s.id)}>
                    <td style={{ fontWeight: 700 }}>{s.name || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                    <td>{parent?.name}</td>
                    <td style={{ direction: 'ltr', unicodeBidi: 'plaintext', color: isIg && !parent?.phone ? '#ff80bf' : 'var(--text-2)' }}>
                      {isIg && !parent?.phone ? `📸 IG (${parent?.instagram_id || 'DM'})` : parent?.phone}
                    </td>
                    <td>{group ? <span className="badge badge-blue">{group.name.split(' ')[0]}</span> : <span className="badge badge-gray">—</span>}</td>
                    <td>{s.levelGrade ? <span className="badge badge-purple">{s.levelGrade}</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{s.created}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => setSelectedStudentId(s.id)}>
                          <Eye size={13} /> פרטים
                        </button>
                        {parent?.phone && !isIg ? (
                          <a href={`https://wa.me/972${parent?.phone?.replace(/^0/, '').replace(/[-\s]/g, '')}`}
                            target="_blank" rel="noreferrer" className="btn btn-success btn-xs" onClick={e => e.stopPropagation()}>
                            💬
                          </a>
                        ) : isIg ? (
                          <span className="btn btn-xs" style={{ background: 'linear-gradient(45deg, #f09433, #dc2743)', color: 'white', border: 'none' }}>
                            📸 DM
                          </span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
