import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Clock, LogIn, LogOut, Coins, Plus, Trash2, Edit2,
  Save, X, UserCheck, RefreshCw, Briefcase, Award, ArrowUpRight, Search, ChevronDown, ChevronUp,
  Upload, Download, FileText
} from 'lucide-react';
import { Modal } from './UI.jsx';

const STATUS_OPTIONS = ['עובד פעיל', 'מנהל', 'עובד זמני', 'מדריך צעיר', 'מועמד', 'ארכיון', 'סנפלינג'];
const PAYMENT_OPTIONS = ['תלוש', 'חשבונית'];
const WORK_TYPE_OPTIONS = [
  { id: 'counter_shift', label: 'דלפק' },
  { id: 'class_shift', label: 'חוג' },
  { id: 'private_shift', label: 'פרטי' },
  { id: 'route_building_shift', label: 'בניית מסלולים' },
];

function monthBounds(ym) {
  // ym = 'YYYY-MM'
  const [y, m] = String(ym).split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function currentYearMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function rateForWorkType(agreement, workType) {
  if (workType === 'class_shift') return Number(agreement.class_rate) || 0;
  if (workType === 'private_shift') return Number(agreement.private_rate) || 0;
  if (workType === 'route_building_shift') return Number(agreement.route_rate) || 0;
  return Number(agreement.counter_rate) || 0;
}

function payAmountForAssignment(row, agreement) {
  if ((row.pay_mode || 'hourly') === 'flat') {
    const n = Number(row.flat_amount);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  }
  const hrs = Number(row.hours) || 0;
  return Math.round(hrs * rateForWorkType(agreement, row.work_type));
}

function roundHoursQuarter(h) {
  const n = Number(h);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 4) / 4;
}

function hoursFromTimes(startHm, endHm) {
  const parse = (hm) => {
    if (!hm || !/^\d{1,2}:\d{2}/.test(hm)) return null;
    const [h, m] = hm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const a = parse(startHm);
  const b = parse(endHm);
  if (a == null || b == null || b <= a) return null;
  return roundHoursQuarter((b - a) / 60);
}

function workTypeLabel(workType) {
  return WORK_TYPE_OPTIONS.find((o) => o.id === workType)?.label || workType || 'דלפק';
}
const CERTIFICATION_OPTIONS = [
  'מדריך סנפלינג',
  'מפעיל קיר',
  'מנהל פארק חבלים',
  'מדריך טיפוס ספורטיבי',
  'מאמן אתלטיקה',
  'מורה דרך',
  'בונה מסלולים רמה 1',
  'בונה מסלולים רמה 2'
];

const EMPLOYEE_DOC_FIELDS = [
  { key: 'contract', label: 'חוזה העסקה חתום' },
  { key: 'police', label: 'אישור משטרה (סקס)' },
  { key: 'certificates', label: 'תעודות רלוונטיות' },
  { key: 'idPhoto', label: 'צילום תעודת זהות' },
  { key: 'form101', label: 'טופס 101 חתום' },
];

function calculateAge(birthDateStr) {
  if (!birthDateStr) return '';
  const birth = new Date(birthDateStr);
  if (isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function hasEmployeeDoc(emp, key) {
  if (emp?.documents?.[key]?.storagePath || emp?.documents?.[key]?.fileName) return true;
  const legacy = {
    contract: 'contractSigned',
    police: 'policeClearance',
    certificates: 'hasCertificates',
    idPhoto: 'hasIdPhoto',
    form101: 'hasForm101',
  };
  return !!(legacy[key] && emp?.[legacy[key]]);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('קריאת הקובץ נכשלה'));
    reader.readAsDataURL(file);
  });
}

function EmployeeDocField({ label, savedDoc, pendingFile, onPick, onClearPending, onRemoveSaved, onDownload, busy }) {
  const inputRef = useRef(null);
  const displayName = pendingFile?.name || savedDoc?.fileName || '';

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label className="form-label">{label}</label>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: 10, borderRadius: 10, border: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        {displayName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <FileText size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
              {pendingFile ? ' (ממתין לשמירה)' : ''}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>לא הועלה קובץ</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,application/pdf,image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onPick(file);
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload size={13} /> {displayName ? 'החלף' : 'העלה'}
          </button>
          {pendingFile && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClearPending}>
              <X size={13} /> בטל בחירה
            </button>
          )}
          {!pendingFile && savedDoc?.storagePath && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onDownload}>
                <Download size={13} /> הורד
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRemoveSaved}>
                <Trash2 size={13} /> מחק
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Employee Form (Add/Edit) ──────────────────────────────────────────
function EmployeeFormModal({ employee, onSave, onClose }) {
  const isEdit = !!employee;
  const [name, setName]               = useState(employee?.name || '');
  const [phone, setPhone]             = useState(employee?.phone || '');
  const [email, setEmail]             = useState(employee?.email || '');
  const [residence, setResidence]     = useState(employee?.address || '');
  const [gender, setGender]           = useState(employee?.gender || 'זכר');
  const [birthDate, setBirthDate]     = useState(employee?.birthDate || '');
  const [idNumber, setIdNumber]       = useState(employee?.idNumber || '');
  const [status, setStatus]           = useState(employee?.is_active ? 'עובד פעיל' : 'ארכיון');
  const [paymentMethod, setPayMethod] = useState(employee?.payment_method === 'invoice' ? 'חשבונית' : 'תלוש');
  const [notes, setNotes]             = useState(employee?.notes || '');
  const [bankAccount, setBankAccount] = useState(employee?.bank_account_details || '');
  const [pensionCompany, setPensionC] = useState(employee?.pensionCompany || '');
  const [documents, setDocuments]     = useState(employee?.documents || {});
  const [pendingFiles, setPendingFiles] = useState({});
  const [certifications, setCertifications] = useState(employee?.certifications || []);
  const [customCert, setCustomCert]   = useState('');
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState('');

  const addCert = (cert) => {
    const value = String(cert || '').trim();
    if (!value) return;
    setCertifications((prev) => (prev.includes(value) ? prev : [...prev, value]));
  };

  const removeCert = (cert) => {
    setCertifications((prev) => prev.filter((c) => c !== cert));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave({
        ...(employee || {}),
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: residence.trim(),
        gender,
        birthDate,
        idNumber: idNumber.trim(),
        is_active: status !== 'ארכיון',
        payment_method: paymentMethod === 'חשבונית' ? 'invoice' : 'slip',
        notes: notes.trim(),
        bank_account_details: bankAccount.trim(),
        pensionCompany: pensionCompany.trim(),
        documents,
        contractSigned: hasEmployeeDoc({ documents }, 'contract') || !!pendingFiles.contract,
        policeClearance: hasEmployeeDoc({ documents }, 'police') || !!pendingFiles.police,
        hasCertificates: hasEmployeeDoc({ documents }, 'certificates') || !!pendingFiles.certificates,
        hasIdPhoto: hasEmployeeDoc({ documents }, 'idPhoto') || !!pendingFiles.idPhoto,
        hasForm101: hasEmployeeDoc({ documents }, 'form101') || !!pendingFiles.form101,
        certifications,
        _pendingFiles: pendingFiles,
      });
      onClose();
    } catch (err) {
      setSaveError(err?.message || 'שמירה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? '✏️ עריכת פרטי עובד' : '➕ הוספת עובד חדש'}</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={saving}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="employee-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            
            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>פרטים אישיים</div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">שם מלא *</label>
                <input className="input" required value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">מספר תעודת זהות</label>
                <input className="input" value={idNumber} onChange={e => setIdNumber(e.target.value)} />
              </div>
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">טלפון *</label>
                <input className="input" required value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">אימייל</label>
                <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">מגורים</label>
                <input className="input" value={residence} onChange={e => setResidence(e.target.value)} />
              </div>
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">תאריך לידה</label>
                <input className="input" type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">מין</label>
                <select className="input select" value={gender} onChange={e => setGender(e.target.value)}>
                  <option value="זכר">זכר</option>
                  <option value="נקבה">נקבה</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">סטטוס עובד</label>
                <select className="input select" value={status} onChange={e => setStatus(e.target.value)}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>פיננסים ותנאי העסקה</div>
            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">מקבל תשלום ב..</label>
                <select className="input select" value={paymentMethod} onChange={e => setPayMethod(e.target.value)}>
                  {PAYMENT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">מספר חשבון בנק</label>
                <input className="input" value={bankAccount} onChange={e => setBankAccount(e.target.value)} placeholder="בנק, סניף, חשבון" />
              </div>
              <div className="form-group">
                <label className="form-label">חברת פנסיה</label>
                <input className="input" value={pensionCompany} onChange={e => setPensionC(e.target.value)} />
              </div>
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>טפסים ואישורים</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              {EMPLOYEE_DOC_FIELDS.map((field) => (
                <EmployeeDocField
                  key={field.key}
                  label={field.label}
                  savedDoc={documents[field.key]}
                  pendingFile={pendingFiles[field.key]}
                  busy={saving}
                  onPick={(file) => setPendingFiles((prev) => ({ ...prev, [field.key]: file }))}
                  onClearPending={() => setPendingFiles((prev) => {
                    const next = { ...prev };
                    delete next[field.key];
                    return next;
                  })}
                  onRemoveSaved={() => {
                    setDocuments((prev) => {
                      const next = { ...prev };
                      delete next[field.key];
                      return next;
                    });
                    setPendingFiles((prev) => {
                      const next = { ...prev };
                      delete next[field.key];
                      return next;
                    });
                  }}
                  onDownload={async () => {
                    if (!employee?.id) return;
                    const res = await fetch(`/api/employees/${encodeURIComponent(employee.id)}/documents/${field.key}/download`);
                    if (!res.ok) return;
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = documents[field.key]?.fileName || field.label;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                />
              ))}
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>הסמכות מקצועיות</div>
            {certifications.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {certifications.map((c) => (
                  <span
                    key={c}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 8px 4px 10px', borderRadius: 20, fontSize: 12,
                      background: 'rgba(99,102,241,0.2)', color: '#A5B4FC',
                      outline: '1px solid #A5B4FC55', fontWeight: 700,
                    }}
                  >
                    {c}
                    <button
                      type="button"
                      onClick={() => removeCert(c)}
                      title="מחק הסמכה"
                      style={{
                        border: 'none', background: 'transparent', color: '#A5B4FC',
                        cursor: 'pointer', padding: 0, display: 'flex', lineHeight: 1,
                      }}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CERTIFICATION_OPTIONS.filter((c) => !certifications.includes(c)).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addCert(c)}
                  style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none',
                    background: 'rgba(255,255,255,0.04)', color: 'var(--text-3)',
                    outline: '1px solid var(--border)',
                  }}
                >
                  + {c}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                value={customCert}
                onChange={(e) => setCustomCert(e.target.value)}
                placeholder="הסמכה מותאמת אישית"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCert(customCert);
                    setCustomCert('');
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  addCert(customCert);
                  setCustomCert('');
                }}
              >
                <Plus size={15} /> הוסף
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">הערות כלליות</label>
              <textarea className="input textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

            {saveError && (
              <div style={{ fontSize: 13, color: 'var(--red)' }}>{saveError}</div>
            )}

          </form>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>ביטול</button>
          <button form="employee-form" type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={15} /> {saving ? 'שומר...' : (isEdit ? 'שמור שינויים' : 'הוסף עובד')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Wage Agreement Form (Add/Edit) ──────────────────────────────────
function WageFormModal({ wage, employees, onSave, onClose }) {
  const [employeeId, setEmployeeId] = useState(wage?.employee_id || employees[0]?.id || '');
  const [counterRate, setCounterRate] = useState(wage?.counter_rate ?? 45);
  const [classRate, setClassRate]     = useState(wage?.class_rate ?? 70);
  const [privateRate, setPrivateRate] = useState(wage?.private_rate ?? 90);
  const [routeRate, setRouteRate]     = useState(wage?.route_rate ?? 60);

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!employeeId || saving) return;

    setSaving(true);
    let ok = false;
    try {
      ok = await onSave({
        id: wage?.id || `wa-${Date.now()}`,
        employee_id: employeeId,
        counter_rate: parseFloat(counterRate) || 0,
        class_rate: parseFloat(classRate) || 0,
        private_rate: parseFloat(privateRate) || 0,
        route_rate: parseFloat(routeRate) || 0
      });
    } finally {
      setSaving(false);
    }
    if (ok) onClose();
    else alert('שמירת הסכם השכר נכשלה. נסו שוב או פנו לתמיכה.');
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div className="modal-title">{wage ? '✏️ עריכת הסכם שכר' : '➕ יצירת הסכם שכר חדש'}</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <form id="wage-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            
            <div className="form-group">
              <label className="form-label">משוייך לעובד *</label>
              <select className="input select" value={employeeId} disabled={!!wage} onChange={e => setEmployeeId(e.target.value)}>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </select>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">תעריף דלפק/שמירה (₪/שעה)</label>
                <input className="input" type="number" min={0} value={counterRate} onChange={e => setCounterRate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">תעריף הדרכת חוג (₪/חוג)</label>
                <input className="input" type="number" min={0} value={classRate} onChange={e => setClassRate(e.target.value)} />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">תעריף אימון פרטי (₪/שעה)</label>
                <input className="input" type="number" min={0} value={privateRate} onChange={e => setPrivateRate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">תעריף בניית מסלולים (₪/שעה)</label>
                <input className="input" type="number" min={0} value={routeRate} onChange={e => setRouteRate(e.target.value)} />
              </div>
            </div>

          </form>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="wage-form" type="submit" className="btn btn-primary" disabled={saving}>
            <Save size={15} /> {saving ? 'שומר...' : 'שמור הסכם'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [wages, setWages]         = useState([]);
  const [shifts, setShifts]       = useState([]);
  const [workAssignments, setWorkAssignments] = useState([]);
  const [activities, setActivities] = useState([]);
  const [payrollMonth, setPayrollMonth] = useState(() => currentYearMonth());
  const [payrollBusy, setPayrollBusy] = useState(false);
  const [newManualRow, setNewManualRow] = useState({
    employee_id: '',
    date: '',
    work_type: 'counter_shift',
    pay_mode: 'hourly',
    flat_amount: '',
    start_time: '09:00',
    end_time: '17:00',
    hours: 8,
  });

  // UI state
  const [activeTab, setActiveTab]         = useState('permanent'); // permanent | certs | wages | shifts | payroll
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedWage, setSelectedWage]         = useState(null);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [showWageForm, setShowWageForm]         = useState(false);
  const [editingEmployee, setEditingEmployee]   = useState(null);
  const [editingWage, setEditingWage]           = useState(null);

  // Sorting and Filtering
  const [empSearch, setEmpSearch] = useState('');
  const [empFilterActive, setEmpFilterActive] = useState('all');
  const [empSortConfig, setEmpSortConfig] = useState({ key: 'name', direction: 'asc' });

  // Shift logging quick state
  const [currentTime, setCurrentTime]     = useState(new Date());
  const [clockActivity, setClockActivity] = useState({});

  const refreshData = async () => {
    try {
      const { from, to } = monthBounds(payrollMonth);
      const [emps, wgs, sfts, asgs, acts] = await Promise.all([
        fetch('/api/employees').then(r => r.json()).catch(() => null),
        fetch('/api/wages').then(r => r.json()).catch(() => null),
        fetch('/api/shifts').then(r => r.json()).catch(() => null),
        fetch(`/api/work-assignments?from=${from}&to=${to}`).then(r => r.json()).catch(() => null),
        fetch('/api/activities').then(r => r.json()).catch(() => null),
      ]);

      setEmployees(Array.isArray(emps) ? emps : []);
      setWages(Array.isArray(wgs) ? wgs : []);
      setShifts(Array.isArray(sfts) ? sfts : []);
      setWorkAssignments(Array.isArray(asgs)
        ? asgs.map((r) => ({
          ...r,
          hours: roundHoursQuarter(r.hours),
          pay_mode: r.pay_mode === 'flat' ? 'flat' : 'hourly',
          flat_amount: r.flat_amount ?? '',
        }))
        : []);
      setActivities(Array.isArray(acts) ? acts : []);
    } catch (err) {
      console.error('Failed to fetch staff data:', err);
      setEmployees([]);
      setWages([]);
      setShifts([]);
      setWorkAssignments([]);
      setActivities([]);
    }
  };

  useEffect(() => {
    refreshData();
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, [payrollMonth]);

  const clockedInCount = employees.filter(e => {
    const activeOpenShift = shifts.some(s => s.employee_id === e.id && s.status === 'open');
    return activeOpenShift;
  }).length;

  const defaultAgreement = { counter_rate: 45, class_rate: 70, private_rate: 90, route_rate: 60 };

  const employeeShiftStats = useMemo(() => {
    const map = {};
    const { from, to } = monthBounds(payrollMonth);

    employees.forEach(emp => {
      const agreement = wages.find(w => w.employee_id === emp.id) || defaultAgreement;
      const monthAssignments = workAssignments.filter(
        (a) => a.employee_id === emp.id && a.date >= from && a.date <= to
      );

      if (monthAssignments.length > 0) {
        let totalHours = 0;
        let totalPay = 0;
        monthAssignments.forEach((a) => {
          const hrs = Number(a.hours) || 0;
          totalHours += hrs;
          totalPay += payAmountForAssignment(a, agreement);
        });
        map[emp.id] = {
          hours: Math.round(totalHours * 10) / 10,
          pay: Math.round(totalPay),
          fromAssignments: true,
        };
        return;
      }

      // Fallback: closed clock shifts in the selected month
      let totalHours = 0;
      let totalPay = 0;
      shifts.filter(s => s.employee_id === emp.id).forEach(s => {
        if (!s.clock_in || !s.clock_out) return;
        const day = String(s.clock_in).slice(0, 10);
        if (day < from || day > to) return;
        const diffMs = new Date(s.clock_out) - new Date(s.clock_in);
        const hrs = diffMs / (1000 * 60 * 60);
        totalHours += hrs;
        let rate = agreement.counter_rate;
        if (s.activity_type === 'class_shift') rate = agreement.class_rate;
        else if (s.activity_type === 'private_shift') rate = agreement.private_rate;
        else if (s.activity_type === 'route_building_shift') rate = agreement.route_rate;
        totalPay += hrs * rate;
      });

      map[emp.id] = {
        hours: Math.round(totalHours * 10) / 10,
        pay: Math.round(totalPay),
        fromAssignments: false,
      };
    });
    return map;
  }, [employees, shifts, wages, workAssignments, payrollMonth]);

  const activityName = (id) => {
    if (!id) return '';
    return activities.find((a) => a.id === id)?.name || '';
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (empSortConfig.key === key && empSortConfig.direction === 'asc') direction = 'desc';
    setEmpSortConfig({ key, direction });
  };

  const sortedAndFilteredEmployees = useMemo(() => {
    let filtered = employees.filter(emp => {
      const matchSearch = emp.name.toLowerCase().includes(empSearch.toLowerCase()) || (emp.phone || '').includes(empSearch);
      const matchActive = empFilterActive === 'all' ? true : empFilterActive === 'active' ? emp.is_active : !emp.is_active;
      return matchSearch && matchActive;
    });

    filtered.sort((a, b) => {
      let valA, valB;
      const statsA = employeeShiftStats[a.id] || { hours: 0, pay: 0 };
      const statsB = employeeShiftStats[b.id] || { hours: 0, pay: 0 };
      
      switch (empSortConfig.key) {
        case 'name': valA = a.name; valB = b.name; break;
        case 'status': valA = a.is_active ? 1 : 0; valB = b.is_active ? 1 : 0; break;
        case 'hours': valA = statsA.hours; valB = statsB.hours; break;
        case 'pay': valA = statsA.pay; valB = statsB.pay; break;
        default: valA = a.name; valB = b.name;
      }

      if (valA < valB) return empSortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return empSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return filtered;
  }, [employees, empSearch, empFilterActive, empSortConfig, employeeShiftStats]);

  const handleSaveEmployee = async (data) => {
    const { _pendingFiles = {}, ...payload } = data;
    const isEdit = employees.some(e => e.id === payload.id);
    const previousDocs = isEdit
      ? (employees.find((e) => e.id === payload.id)?.documents || {})
      : {};
    let employeeId = payload.id;

    // Remove cleared documents first (while storagePath still exists on the server record)
    if (isEdit && employeeId) {
      for (const field of EMPLOYEE_DOC_FIELDS) {
        const key = field.key;
        const wasPresent = !!previousDocs[key]?.storagePath;
        const stillPresent = !!payload.documents?.[key]?.storagePath;
        const replacedByUpload = !!_pendingFiles[key];
        if (wasPresent && !stillPresent && !replacedByUpload) {
          await fetch(
            `/api/employees/${encodeURIComponent(employeeId)}/documents/${key}`,
            { method: 'DELETE' }
          );
        }
      }
    }

    const response = await fetch(isEdit ? `/api/employees/${payload.id}` : '/api/employees', {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error('שמירת פרטי העובד נכשלה');
    }
    let saved = await response.json();
    employeeId = saved.id;

    // Upload newly picked files
    for (const [docType, file] of Object.entries(_pendingFiles)) {
      if (!file || !file.name) continue;
      const fileBase64 = await readFileAsBase64(file);
      const upRes = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType,
          fileBase64,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        }),
      });
      if (!upRes.ok) {
        const errBody = await upRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'העלאת הקובץ נכשלה');
      }
      saved = (await upRes.json()).employee || saved;
    }

    await refreshData();
    setEditingEmployee(null);
    if (selectedEmployee?.id === saved.id) {
      setSelectedEmployee(saved);
    }
    return saved;
  };

  const handleToggleActive = async (emp) => {
    const updated = { ...emp, is_active: !emp.is_active };
    try {
      const response = await fetch(`/api/employees/${emp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (response.ok) {
        refreshData();
        setSelectedEmployee(updated);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveWage = async (data) => {
    const isEdit = wages.some(w => w.id === data.id);
    try {
      const response = await fetch(isEdit ? `/api/wages/${data.id}` : `/api/wages`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) return false;
      await refreshData();
      setEditingWage(null);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const handleClock = async (empId) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    const openShift = shifts.find(s => s.employee_id === empId && s.status === 'open');

    try {
      if (openShift) {
        const res = await fetch('/api/shifts/clock-out', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: empId, notes: 'משמרת הסתיימה' })
        });
        if (res.ok) {
          alert('יציאה מהמשמרת נרשמה בהצלחה');
          await refreshData();
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.error === 'No active open shift found for this employee'
            ? 'לא נמצאה משמרת פתוחה בשרת. מרעננים את המסך.'
            : (err.error || 'יציאה מהמשמרת נכשלה'));
          await refreshData();
        }
      } else {
        const selectedAct = clockActivity[empId] || 'counter_shift';
        const res = await fetch('/api/shifts/clock-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: empId, activityType: selectedAct, notes: 'כניסה למשמרת' })
        });
        if (res.ok) {
          alert('כניסה למשמרת נרשמה בהצלחה');
          await refreshData();
        } else {
          alert('כניסה למשמרת נכשלה');
        }
      }
    } catch (err) {
      console.error(err);
      alert('תקלת תקשורת מול השרת');
    }
  };

  const saveAssignmentRow = async (row) => {
    setPayrollBusy(true);
    try {
      const payMode = row.pay_mode === 'flat' ? 'flat' : 'hourly';
      const res = await fetch(`/api/work-assignments/${row.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_type: row.work_type,
          start_time: row.start_time,
          end_time: row.end_time,
          hours: roundHoursQuarter(row.hours),
          pay_mode: payMode,
          flat_amount: payMode === 'flat' ? Number(row.flat_amount) || 0 : null,
          source: 'manual',
          notes: row.notes || '',
          approved: row.approved,
        }),
      });
      if (!res.ok) alert('שמירת השורה נכשלה');
      else await refreshData();
    } finally {
      setPayrollBusy(false);
    }
  };

  const approveAssignments = async (ids) => {
    if (!ids.length) return;
    setPayrollBusy(true);
    try {
      const res = await fetch('/api/work-assignments/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) alert('אישור נכשל');
      else await refreshData();
    } finally {
      setPayrollBusy(false);
    }
  };

  const deleteAssignment = async (id) => {
    if (!window.confirm('למחוק את שורת התשלום?')) return;
    setPayrollBusy(true);
    try {
      await fetch(`/api/work-assignments/${id}`, { method: 'DELETE' });
      await refreshData();
    } finally {
      setPayrollBusy(false);
    }
  };

  const createManualAssignment = async () => {
    if (!newManualRow.employee_id || !newManualRow.date) {
      alert('נא לבחור עובד ותאריך');
      return;
    }
    setPayrollBusy(true);
    try {
      const payMode = newManualRow.pay_mode === 'flat' ? 'flat' : 'hourly';
      const res = await fetch('/api/work-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newManualRow,
          hours: roundHoursQuarter(newManualRow.hours),
          pay_mode: payMode,
          flat_amount: payMode === 'flat' ? Number(newManualRow.flat_amount) || 0 : null,
          source: 'manual',
          approved: false,
        }),
      });
      if (!res.ok) alert('יצירת השורה נכשלה');
      else {
        setNewManualRow((prev) => ({ ...prev, employee_id: '', hours: 8, flat_amount: '', pay_mode: 'hourly' }));
        await refreshData();
      }
    } finally {
      setPayrollBusy(false);
    }
  };

  const patchAssignmentLocal = (id, patch) => {
    setWorkAssignments((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      if ('start_time' in patch || 'end_time' in patch) {
        const computed = hoursFromTimes(next.start_time, next.end_time);
        if (computed != null) next.hours = computed;
      }
      if (patch.pay_mode === 'hourly') next.flat_amount = '';
      return next;
    }));
  };

  return (
    <div className="fade-in">
      
      {/* ─── Modals ───────────────────────────────────────────────────────── */}
      {showEmployeeForm && (
        <EmployeeFormModal
          employee={editingEmployee}
          onSave={handleSaveEmployee}
          onClose={() => { setShowEmployeeForm(false); setEditingEmployee(null); }}
        />
      )}

      {showWageForm && (
        <WageFormModal
          wage={editingWage}
          employees={employees}
          onSave={handleSaveWage}
          onClose={() => { setShowWageForm(false); setEditingWage(null); }}
        />
      )}

      {/* Selected Employee Detail Side Drawer */}
      {selectedEmployee && (
        <div style={{
          position: 'fixed', top: 0, left: 0, height: '100vh', width: 440,
          background: '#0D1117', borderRight: '1px solid var(--border)',
          zIndex: 300, display: 'flex', flexDirection: 'column', padding: 20,
          boxShadow: '4px 0 24px rgba(0,0,0,0.5)', overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="avatar avatar-lg">
                {selectedEmployee.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{selectedEmployee.name}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button 
                    onClick={() => handleToggleActive(selectedEmployee)}
                    className={`badge ${selectedEmployee.is_active ? 'badge-blue' : 'badge-danger'}`} 
                    style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}>
                    {selectedEmployee.is_active ? 'פעיל (לחץ להשבתה)' : 'לא פעיל (לחץ להפעלה)'}
                  </button>
                  <span className="badge badge-gray">{selectedEmployee.payment_method === 'invoice' ? 'חשבונית' : 'תלוש'}</span>
                </div>
              </div>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelectedEmployee(null)}><X size={16} /></button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, overflowY: 'auto' }}>
            
            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>פרטי התקשרות</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div>📞 <strong>טלפון:</strong> {selectedEmployee.phone}</div>
                {selectedEmployee.email && <div>✉️ <strong>אימייל:</strong> {selectedEmployee.email}</div>}
                {selectedEmployee.address && <div>📍 <strong>מגורים:</strong> {selectedEmployee.address}</div>}
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>פרטים אישיים</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <div>🪪 <strong>ת.ז:</strong> {selectedEmployee.idNumber || '—'}</div>
                <div>👤 <strong>מין:</strong> {selectedEmployee.gender || 'זכר'}</div>
                <div>📅 <strong>תאריך לידה:</strong> {selectedEmployee.birthDate || '—'}</div>
                <div>👶 <strong>גיל:</strong> {calculateAge(selectedEmployee.birthDate) || '—'}</div>
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>פרטי בנק</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div>🏦 <strong>חשבון בנק:</strong> {selectedEmployee.bank_account_details || 'טרם עודכן'}</div>
                {selectedEmployee.pensionCompany && (
                  <div>🏛 <strong>חברת פנסיה:</strong> {selectedEmployee.pensionCompany}</div>
                )}
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>טפסים ואישורים</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                {EMPLOYEE_DOC_FIELDS.map((field) => {
                  const doc = selectedEmployee.documents?.[field.key];
                  const present = hasEmployeeDoc(selectedEmployee, field.key);
                  return (
                    <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span>{present ? '✓' : '—'} {field.label}</span>
                      {doc?.storagePath && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            const res = await fetch(`/api/employees/${encodeURIComponent(selectedEmployee.id)}/documents/${field.key}/download`);
                            if (!res.ok) return;
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = doc.fileName || field.label;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                        >
                          <Download size={12} /> הורד
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>הסמכות מקצועיות</div>
              {selectedEmployee.certifications?.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedEmployee.certifications.map(c => (
                    <span key={c} className="badge badge-blue" style={{ fontSize: 10 }}>{c}</span>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>לא הוגדרו הסמכות</div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>💰 הסכם שכר פעיל</div>
              {(() => {
                const w = wages.find(wg => wg.employee_id === selectedEmployee.id);
                return w ? (
                  <div className="card card-p" style={{ background: 'rgba(255,255,255,0.01)', padding: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                      <div>🖥️ דלפק: <span style={{ color: 'var(--green)' }}>₪{w.counter_rate}/ש׳</span></div>
                      <div>👨‍👩‍👧‍👦 חוגים: <span style={{ color: 'var(--green)' }}>₪{w.class_rate}/חוג</span></div>
                      <div>🧑‍🤝‍🧑 שיעור פרטי: <span style={{ color: 'var(--green)' }}>₪{w.private_rate}/ש׳</span></div>
                      <div>🛠️ בנייה: <span style={{ color: 'var(--green)' }}>₪{w.route_rate}/ש׳</span></div>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>לא הוגדר הסכם שכר לעובד זה</div>
                );
              })()}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', gap: 10, marginTop: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setEditingEmployee(selectedEmployee); setShowEmployeeForm(true); }}>
              ✏️ ערוך פרטים
            </button>
          </div>
        </div>
      )}

      {/* Selected Wage Detail Panel */}
      {selectedWage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, height: '100vh', width: 400,
          background: '#0D1117', borderRight: '1px solid var(--border)',
          zIndex: 300, display: 'flex', flexDirection: 'column', padding: 20,
          boxShadow: '4px 0 24px rgba(0,0,0,0.5)', overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>הסכם שכר ("טבלאות שכר")</div>
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                עובד: {employees.find(e => e.id === selectedWage.employee_id)?.name || '—'}
              </div>
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelectedWage(null)}><X size={16} /></button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
            <div className="card card-p">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span>🖥️ שעת דלפק:</span>
                <strong style={{ color: 'var(--green)' }}>₪{selectedWage.counter_rate}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span>👨‍👩‍👧‍👦 הדרכת חוג:</span>
                <strong style={{ color: 'var(--green)' }}>₪{selectedWage.class_rate}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span>🧑‍🤝‍🧑 שיעור פרטי:</span>
                <strong style={{ color: 'var(--green)' }}>₪{selectedWage.private_rate}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>🛠️ בניית מסלולים:</span>
                <strong style={{ color: 'var(--green)' }}>₪{selectedWage.route_rate}</strong>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setEditingWage(selectedWage); setShowWageForm(true); }}>
              ✏️ ערוך הסכם
            </button>
          </div>
        </div>
      )}

      {/* ─── Topbar Statistics ────────────────────────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#6366F1' }} onClick={() => setActiveTab('permanent')}>
          <div className="stat-label">סה"כ עובדים קבועים</div>
          <div className="stat-value">{employees.filter(e => e.is_active).length}</div>
          <div className="stat-sub">פעילים במערכת</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }} onClick={() => setActiveTab('shifts')}>
          <div className="stat-label">עובדים במשמרת כרגע</div>
          <div className="stat-value">{clockedInCount}</div>
          <div className="stat-sub">שעון נוכחות פתוח</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#F59E0B' }} onClick={() => setActiveTab('wages')}>
          <div className="stat-label">הסכמי שכר פעילים</div>
          <div className="stat-value">{wages.length}</div>
          <div className="stat-sub">מקושרים למאמנים</div>
        </div>
      </div>

      {/* ─── Header Toolbar ────────────────────────────────────────────────── */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">ניהול עובדים, שכר ותעודות</div>
          <div className="section-sub">מעקב דיווחי משמרות, הסכמי שכר ותאימות תעודות מזהות של המאמנים</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setEditingWage(null); setShowWageForm(true); }}>
            <Plus size={14} /> הסכם שכר חדש
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => { setEditingEmployee(null); setShowEmployeeForm(true); }}>
            <Plus size={14} /> עובד חדש
          </button>
        </div>
      </div>

      {/* ─── Tabs Navigation ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 1 }}>
        <button
          className={`btn btn-sm ${activeTab === 'permanent' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'permanent' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('permanent')}
        >
          👥 עובדים קבועים
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'certs' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'certs' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('certs')}
        >
          📜 תעודות והסמכות
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'wages' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'wages' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('wages')}
        >
          💰 הסכמי שכר
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'shifts' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'shifts' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('shifts')}
        >
          ⏰ שעון נוכחות ומשמרות
        </button>
        <button
          className={`btn btn-sm ${activeTab === 'payroll' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: activeTab === 'payroll' ? '2px solid var(--blue)' : 'none' }}
          onClick={() => setActiveTab('payroll')}
        >
          💵 תשלום חודשי
        </button>
      </div>

      {/* ─── Tab 1: Permanent Employees ────────────────────────────────────── */}
      {activeTab === 'permanent' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
            <div className="input-icon-wrap" style={{ flex: 1, maxWidth: 300 }}>
              <Search className="input-icon" size={15} />
              <input
                className="input input-sm"
                placeholder="חיפוש שם, טלפון..."
                style={{ width: '100%', paddingRight: 32 }}
                value={empSearch}
                onChange={e => setEmpSearch(e.target.value)}
              />
            </div>
            <select className="input input-sm" style={{ width: 150 }} value={empFilterActive} onChange={e => setEmpFilterActive(e.target.value)}>
              <option value="all">הכל</option>
              <option value="active">פעילים בלבד</option>
              <option value="inactive">לא פעילים</option>
            </select>
          </div>
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>סטטוס {empSortConfig.key === 'status' ? (empSortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>שם מלא {empSortConfig.key === 'name' ? (empSortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th>מקבל תשלום ב..</th>
                  <th onClick={() => handleSort('hours')} style={{ cursor: 'pointer' }}>שעות החודש {empSortConfig.key === 'hours' ? (empSortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th onClick={() => handleSort('pay')} style={{ cursor: 'pointer' }}>סה"כ תשלומים {empSortConfig.key === 'pay' ? (empSortConfig.direction === 'asc' ? '↑' : '↓') : ''}</th>
                  <th>טלפון</th>
                  <th>עריכה פנימית</th>
                </tr>
              </thead>
              <tbody>
                {sortedAndFilteredEmployees
                  .map(emp => {
                    const stats = employeeShiftStats[emp.id] || { hours: 0, pay: 0 };
                    return (
                      <tr key={emp.id} style={{ cursor: 'pointer', opacity: emp.is_active ? 1 : 0.5 }} onClick={() => setSelectedEmployee(emp)}>
                        <td>
                          <span className={`badge ${emp.is_active ? 'badge-green' : 'badge-danger'}`}>
                            {emp.is_active ? 'פעיל' : 'לא פעיל'}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{emp.name}</td>
                        <td><span className="badge badge-gray">{emp.payment_method === 'invoice' ? 'חשבונית' : 'תלוש'}</span></td>
                        <td style={{ fontWeight: 600 }}>{stats.hours} שעות</td>
                        <td style={{ color: 'var(--green)', fontWeight: 700 }}>₪{stats.pay.toLocaleString()}</td>
                        <td style={{ color: 'var(--text-3)' }}>{emp.phone}</td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-ghost btn-icon btn-xs" onClick={() => { setEditingEmployee(emp); setShowEmployeeForm(true); }}>
                              <Edit2 size={12} />
                            </button>
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

      {/* ─── Tab 2: Certificates & Accreditations ─────────────────────────── */}
      {activeTab === 'certs' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>שם מלא</th>
                  <th>טלפון</th>
                  <th>טפסים ואישורים</th>
                  <th>הסמכות מקצועיות</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedEmployee(emp)}>
                    <td style={{ fontWeight: 700 }}>{emp.name}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{emp.phone || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {hasEmployeeDoc(emp, 'contract') && <span className="badge badge-green" style={{ fontSize: 9 }}>חוזה ✓</span>}
                        {hasEmployeeDoc(emp, 'police') && <span className="badge badge-green" style={{ fontSize: 9 }}>משטרה ✓</span>}
                        {hasEmployeeDoc(emp, 'form101') && <span className="badge badge-green" style={{ fontSize: 9 }}>101 ✓</span>}
                        {hasEmployeeDoc(emp, 'idPhoto') && <span className="badge badge-blue" style={{ fontSize: 9 }}>צילום ת.ז</span>}
                        {hasEmployeeDoc(emp, 'certificates') && <span className="badge badge-blue" style={{ fontSize: 9 }}>תעודות</span>}
                        {!EMPLOYEE_DOC_FIELDS.some((f) => hasEmployeeDoc(emp, f.key)) && (
                          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>אין קבצים</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 220 }}>
                        {emp.certifications?.map(c => (
                          <span key={c} className="badge badge-blue" style={{ fontSize: 9, padding: '1px 6px' }}>{c}</span>
                        )) || '—'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Tab 3: Wage Agreements ───────────────────────────────────────── */}
      {activeTab === 'wages' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>עובד קשור</th>
                  <th>דלפק (שעתי)</th>
                  <th>הדרכת חוג</th>
                  <th>אימון פרטי</th>
                  <th>בניית מסלולים</th>
                  <th>צורת תשלום</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {wages.map(w => {
                  const emp = employees.find(e => e.id === w.employee_id);
                  return (
                    <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedWage(w)}>
                      <td style={{ fontWeight: 700 }}>{emp?.name || 'עובד הוסר'}</td>
                      <td style={{ color: 'var(--green)', fontWeight: 600 }}>₪{w.counter_rate}/ש׳</td>
                      <td style={{ color: 'var(--green)', fontWeight: 600 }}>₪{w.class_rate}/חוג</td>
                      <td style={{ color: 'var(--green)', fontWeight: 600 }}>₪{w.private_rate}/ש׳</td>
                      <td style={{ color: 'var(--green)', fontWeight: 600 }}>₪{w.route_rate}/ש׳</td>
                      <td><span className="badge badge-gray">{emp?.payment_method === 'invoice' ? 'חשבונית' : 'תלוש'}</span></td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-ghost btn-icon btn-xs" onClick={() => { setEditingWage(w); setShowWageForm(true); }}>
                            <Edit2 size={12} />
                          </button>
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

      {/* ─── Tab 4: Clock & Shifts ────────────────────────────────────────── */}
      {activeTab === 'shifts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          
          {/* Quick clock grids */}
          <div className="grid-3" style={{ gap: 16 }}>
            {employees
              .filter(e => e.is_active)
              .map(emp => {
                const openShift = shifts.find(s => s.employee_id === emp.id && s.status === 'open');
                
                let duration = null;
                if (openShift) {
                  const diffMs = currentTime - new Date(openShift.clock_in);
                  const hrs = Math.floor(diffMs / (1000 * 60 * 60));
                  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                  duration = `${hrs}ש׳ ${mins}ד׳`;
                }

                return (
                  <div key={emp.id} className="card card-p" style={{
                    borderColor: openShift ? 'rgba(16,185,129,0.3)' : 'var(--border)',
                    background: openShift ? 'rgba(16,185,129,0.03)' : 'var(--bg-card)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 180
                  }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div className="avatar">
                            {emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 13 }}>{emp.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>מאמן מוסמך</div>
                          </div>
                        </div>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: openShift ? '#10B981' : 'var(--text-3)',
                          boxShadow: openShift ? '0 0 8px rgba(16,185,129,0.5)' : 'none'
                        }} />
                      </div>

                      {openShift ? (
                        <div style={{ marginTop: 12, fontSize: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-3)' }}>
                            <span>נכנס ב- {new Date(openShift.clock_in).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span style={{ color: 'var(--green)', fontWeight: 700 }}>⏳ {duration}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="form-group" style={{ marginTop: 12 }}>
                          <label className="form-label" style={{ fontSize: 10 }}>בחר סוג פעילות</label>
                          <select className="input select btn-xs" style={{ paddingBlock: 4 }}
                            value={clockActivity[emp.id] || 'counter_shift'}
                            onChange={e => setClockActivity(prev => ({ ...prev, [emp.id]: e.target.value }))}>
                            <option value="counter_shift">משמרת דלפק (שעתי)</option>
                            <option value="class_shift">הדרכת חוג (שעתי)</option>
                            <option value="private_shift">שיעור פרטי (שעתי)</option>
                            <option value="route_building_shift">בניית מסלולים (שעתי)</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <button
                      className={`btn btn-full btn-xs ${openShift ? 'btn-danger' : 'btn-success'}`}
                      style={{ marginTop: 12 }}
                      onClick={() => handleClock(emp.id)}
                    >
                      {openShift ? <><LogOut size={13} /> יציאה מהמשמרת</> : <><LogIn size={13} /> כניסה למשמרת</>}
                    </button>
                  </div>
                );
              })}
          </div>

          {/* Shifts log history */}
          <div>
            <div className="section-title" style={{ marginBottom: 12 }}>היסטוריית משמרות ונוכחות החודש</div>
            <div className="card">
              <div className="table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>עובד</th>
                      <th>פעילות</th>
                      <th>תאריך</th>
                      <th>שעת כניסה</th>
                      <th>שעת יציאה</th>
                      <th>משך משמרת</th>
                      <th>סטטוס</th>
                      <th>הערות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map(s => {
                      const empName = employees.find(e => e.id === s.employee_id)?.name || 'מאמן';
                      const diffMs = s.clock_out ? new Date(s.clock_out) - new Date(s.clock_in) : 0;
                      const hrs = Math.floor(diffMs / (1000 * 60 * 60));
                      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                      
                      let actLabel = 'דלפק';
                      if (s.activity_type === 'class_shift') actLabel = 'חוג';
                      else if (s.activity_type === 'private_shift') actLabel = 'פרטי';
                      else if (s.activity_type === 'route_building_shift') actLabel = 'בניית מסלולים';

                      return (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 700 }}>{empName}</td>
                          <td><span className="badge badge-blue">{actLabel}</span></td>
                          <td>{new Date(s.clock_in).toLocaleDateString('he-IL')}</td>
                          <td>{new Date(s.clock_in).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</td>
                          <td>{s.clock_out ? new Date(s.clock_out).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                          <td style={{ fontWeight: 600 }}>{s.clock_out ? `${hrs}ש׳ ${mins}ד׳` : '—'}</td>
                          <td>
                            <span className={`badge ${s.status === 'closed' ? 'badge-green' : 'badge-amber'}`}>
                              {s.status === 'closed' ? 'סגור' : 'פתוח'}
                            </span>
                          </td>
                          <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{s.notes || '—'}</td>
                        </tr>
                      );
                    })}
                    {shifts.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--text-3)' }}>אין משמרות מתועדות.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ─── Tab 5: Monthly payroll ───────────────────────────────────────── */}
      {activeTab === 'payroll' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card card-p" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>תשלום חודשי</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                שורות עבודה לפי עובד — שעתי לפי תעריף מהסכם, או סכום גלובלי לפעילות. משלמים לפי שורות מאושרות.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                חודש
                <input
                  className="input input-sm"
                  type="month"
                  value={payrollMonth}
                  onChange={(e) => setPayrollMonth(e.target.value)}
                />
              </label>
              <button
                className="btn btn-ghost btn-sm"
                disabled={payrollBusy || workAssignments.filter((a) => !a.approved).length === 0}
                onClick={() => approveAssignments(workAssignments.filter((a) => !a.approved).map((a) => a.id))}
              >
                <UserCheck size={14} /> אשר הכל בחודש
              </button>
            </div>
          </div>

          <div className="grid-3" style={{ gap: 12 }}>
            {employees.filter((e) => e.is_active !== false).map((emp) => {
              const stats = employeeShiftStats[emp.id] || { hours: 0, pay: 0 };
              return (
                <div key={emp.id} className="card card-p">
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>{emp.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {stats.hours} שעות · ₪{stats.pay}
                    {stats.fromAssignments ? '' : ' (לפי שעון)'}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>הוספת שורה ידנית</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, alignItems: 'end' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                עובד
                <select
                  className="input input-sm"
                  value={newManualRow.employee_id}
                  onChange={(e) => setNewManualRow((p) => ({ ...p, employee_id: e.target.value }))}
                >
                  <option value="">בחירה...</option>
                  {employees.filter((e) => e.is_active !== false).map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                תאריך
                <input
                  className="input input-sm"
                  type="date"
                  value={newManualRow.date}
                  onChange={(e) => setNewManualRow((p) => ({ ...p, date: e.target.value }))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                אופן תשלום
                <select
                  className="input input-sm"
                  value={newManualRow.pay_mode || 'hourly'}
                  onChange={(e) => setNewManualRow((p) => ({
                    ...p,
                    pay_mode: e.target.value,
                    ...(e.target.value === 'hourly' ? { flat_amount: '' } : {}),
                  }))}
                >
                  <option value="hourly">שעתי</option>
                  <option value="flat">גלובלי</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                סוג
                <select
                  className="input input-sm"
                  value={newManualRow.work_type}
                  onChange={(e) => setNewManualRow((p) => ({ ...p, work_type: e.target.value }))}
                >
                  {WORK_TYPE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </label>
              {(newManualRow.pay_mode || 'hourly') === 'flat' ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                  סכום גלובלי
                  <input
                    className="input input-sm"
                    type="number"
                    min="0"
                    step="1"
                    value={newManualRow.flat_amount}
                    onChange={(e) => setNewManualRow((p) => ({ ...p, flat_amount: e.target.value }))}
                  />
                </label>
              ) : (
                <>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                    התחלה
                    <input
                      className="input input-sm"
                      type="time"
                      value={newManualRow.start_time}
                      onChange={(e) => setNewManualRow((p) => {
                        const start_time = e.target.value;
                        const hours = hoursFromTimes(start_time, p.end_time);
                        return { ...p, start_time, ...(hours != null ? { hours } : {}) };
                      })}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                    סיום
                    <input
                      className="input input-sm"
                      type="time"
                      value={newManualRow.end_time}
                      onChange={(e) => setNewManualRow((p) => {
                        const end_time = e.target.value;
                        const hours = hoursFromTimes(p.start_time, end_time);
                        return { ...p, end_time, ...(hours != null ? { hours } : {}) };
                      })}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                    שעות
                    <input
                      className="input input-sm"
                      type="number"
                      min="0"
                      step="0.25"
                      value={newManualRow.hours}
                      onChange={(e) => setNewManualRow((p) => ({ ...p, hours: e.target.value }))}
                      onBlur={(e) => setNewManualRow((p) => ({ ...p, hours: roundHoursQuarter(e.target.value) }))}
                    />
                  </label>
                </>
              )}
              <button className="btn btn-primary btn-sm" disabled={payrollBusy} onClick={createManualAssignment}>
                <Plus size={14} /> הוסף
              </button>
            </div>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>תאריך</th>
                    <th>עובד</th>
                    <th>אירוע</th>
                    <th>אופן</th>
                    <th>סוג</th>
                    <th>התחלה</th>
                    <th>סיום</th>
                    <th>שעות</th>
                    <th>תעריף / גלובלי</th>
                    <th>סכום</th>
                    <th>סטטוס</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {workAssignments.map((row) => {
                    const emp = employees.find((e) => e.id === row.employee_id);
                    const agreement = wages.find((w) => w.employee_id === row.employee_id) || defaultAgreement;
                    const rate = rateForWorkType(agreement, row.work_type);
                    const payMode = row.pay_mode === 'flat' ? 'flat' : 'hourly';
                    const amount = payAmountForAssignment(row, agreement);
                    return (
                      <tr key={row.id}>
                        <td>{row.date}</td>
                        <td style={{ fontWeight: 700 }}>{emp?.name || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{activityName(row.activity_id) || '—'}</td>
                        <td>
                          <select
                            className="input input-sm"
                            value={payMode}
                            onChange={(e) => patchAssignmentLocal(row.id, { pay_mode: e.target.value })}
                            style={{ minWidth: 90 }}
                          >
                            <option value="hourly">שעתי</option>
                            <option value="flat">גלובלי</option>
                          </select>
                        </td>
                        <td>
                          <select
                            className="input input-sm"
                            value={row.work_type || 'counter_shift'}
                            onChange={(e) => patchAssignmentLocal(row.id, { work_type: e.target.value })}
                            style={{ minWidth: 110 }}
                          >
                            {WORK_TYPE_OPTIONS.map((o) => (
                              <option key={o.id} value={o.id}>
                                {payMode === 'hourly'
                                  ? `${o.label} — ₪${rateForWorkType(agreement, o.id)}`
                                  : o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input input-sm"
                            type="time"
                            value={row.start_time || ''}
                            onChange={(e) => patchAssignmentLocal(row.id, { start_time: e.target.value })}
                            style={{ width: 100 }}
                          />
                        </td>
                        <td>
                          <input
                            className="input input-sm"
                            type="time"
                            value={row.end_time || ''}
                            onChange={(e) => patchAssignmentLocal(row.id, { end_time: e.target.value })}
                            style={{ width: 100 }}
                          />
                        </td>
                        <td>
                          <input
                            className="input input-sm"
                            type="number"
                            min="0"
                            step="0.25"
                            value={row.hours ?? 0}
                            onChange={(e) => patchAssignmentLocal(row.id, { hours: e.target.value })}
                            onBlur={(e) => patchAssignmentLocal(row.id, { hours: roundHoursQuarter(e.target.value) })}
                            style={{ width: 70 }}
                            disabled={payMode === 'flat'}
                          />
                        </td>
                        <td>
                          {payMode === 'flat' ? (
                            <input
                              className="input input-sm"
                              type="number"
                              min="0"
                              step="1"
                              value={row.flat_amount ?? ''}
                              onChange={(e) => patchAssignmentLocal(row.id, { flat_amount: e.target.value })}
                              style={{ width: 90 }}
                            />
                          ) : (
                            <>₪{rate}</>
                          )}
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--green)' }}>₪{amount}</td>
                        <td>
                          <span className={`badge ${row.approved ? 'badge-green' : 'badge-gray'}`}>
                            {row.approved ? 'מאושר' : 'ממתין'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-ghost btn-icon btn-xs" title="שמור" disabled={payrollBusy} onClick={() => saveAssignmentRow(row)}>
                              <Save size={12} />
                            </button>
                            {!row.approved && (
                              <button className="btn btn-ghost btn-icon btn-xs" title="אשר" disabled={payrollBusy} onClick={() => approveAssignments([row.id])}>
                                <UserCheck size={12} />
                              </button>
                            )}
                            <button className="btn btn-ghost btn-icon btn-xs" title="מחק" disabled={payrollBusy} onClick={() => deleteAssignment(row.id)} style={{ color: '#F87171' }}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {workAssignments.length === 0 && (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: 30, color: 'var(--text-3)' }}>
                        אין שורות תשלום בחודש הזה. אפשר לשייך עובדים מאירוע ביומן או להוסיף שורה ידנית.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
