import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock, LogIn, LogOut, Coins, Plus, Trash2, Edit2,
  Save, X, UserCheck, RefreshCw, Briefcase, Award, ArrowUpRight, Search, ChevronDown, ChevronUp
} from 'lucide-react';
import { Modal } from './UI.jsx';

const STATUS_OPTIONS = ['עובד פעיל', 'מנהל', 'עובד זמני', 'מדריך צעיר', 'מועמד', 'ארכיון', 'סנפלינג'];
const PAYMENT_OPTIONS = ['תלוש', 'חשבונית'];
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
  const [salaryTransferred, setSal]   = useState(employee?.salaryTransferred ?? false);
  const [notes, setNotes]             = useState(employee?.notes || '');
  const [bankAccount, setBankAccount] = useState(employee?.bank_account_details || '');
  const [pensionNumber, setPensionN]  = useState(employee?.pensionNumber || '');
  const [pensionCompany, setPensionC] = useState(employee?.pensionCompany || '');
  const [mobility, setMobility]       = useState(employee?.mobility ?? false);
  
  // Doc toggles
  const [contractSigned, setContract] = useState(employee?.contractSigned ?? false);
  const [policeClearance, setPolice]  = useState(employee?.policeClearance ?? false);
  const [hasCertificates, setCerts]   = useState(employee?.hasCertificates ?? false);
  const [hasIdPhoto, setPhoto]         = useState(employee?.hasIdPhoto ?? false);
  const [hasForm101, setForm101]       = useState(employee?.hasForm101 ?? false);

  const [certifications, setCertifications] = useState(employee?.certifications || []);

  const toggleCert = (cert) => {
    setCertifications(prev =>
      prev.includes(cert) ? prev.filter(c => c !== cert) : [...prev, cert]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    onSave({
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
      salaryTransferred,
      notes: notes.trim(),
      bank_account_details: bankAccount.trim(),
      pensionNumber: pensionNumber.trim(),
      pensionCompany: pensionCompany.trim(),
      mobility,
      contractSigned,
      policeClearance,
      hasCertificates,
      hasIdPhoto,
      hasForm101,
      certifications
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 680 }}>
        <div className="modal-header">
          <div className="modal-title">{isEdit ? '✏️ עריכת פרטי עובד' : '➕ הוספת עובד חדש'}</div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18} /></button>
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
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, height: '100%', paddingTop: 20 }}>
                <input type="checkbox" id="sal-check" checked={salaryTransferred} onChange={e => setSal(e.target.checked)} style={{ width: 16, height: 16 }} />
                <label htmlFor="sal-check" className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>משכורת הועברה</label>
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8, height: '100%', paddingTop: 20 }}>
                <input type="checkbox" id="mob-check" checked={mobility} onChange={e => setMobility(e.target.checked)} style={{ width: 16, height: 16 }} />
                <label htmlFor="mob-check" className="form-label" style={{ marginBottom: 0, cursor: 'pointer' }}>ניידות (רכב / רישיון)</label>
              </div>
            </div>

            <div className="form-grid-3">
              <div className="form-group">
                <label className="form-label">מספר חשבון בנק</label>
                <input className="input" value={bankAccount} onChange={e => setBankAccount(e.target.value)} placeholder="בנק, סניף, חשבון" />
              </div>
              <div className="form-group">
                <label className="form-label">חברת פנסיה</label>
                <input className="input" value={pensionCompany} onChange={e => setPensionC(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">מספר פוליסת פנסיה</label>
                <input className="input" value={pensionNumber} onChange={e => setPensionN(e.target.value)} />
              </div>
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>טפסים ואישורים (צ׳קליסט)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: 'חוזה העסקה חתום', state: contractSigned, setter: setContract },
                { label: 'אישור משטרה (סקס)', state: policeClearance, setter: setPolice },
                { label: 'תעודות רלוונטיות', state: hasCertificates, setter: setCerts },
                { label: 'צילום תעודת זהות', state: hasIdPhoto, setter: setPhoto },
                { label: 'טופס 101 חתום', state: hasForm101, setter: setForm101 },
              ].map(item => (
                <label key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={item.state} onChange={e => item.setter(e.target.checked)} style={{ width: 15, height: 15 }} />
                  {item.label}
                </label>
              ))}
            </div>

            <div className="section-title" style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginTop: 8 }}>הסמכות מקצועיות</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CERTIFICATION_OPTIONS.map(c => {
                const isSelected = certifications.includes(c);
                return (
                  <button
                    key={c} type="button" onClick={() => toggleCert(c)}
                    style={{
                      padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: 'none',
                      background: isSelected ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                      color: isSelected ? '#A5B4FC' : 'var(--text-3)',
                      outline: isSelected ? '1px solid #A5B4FC55' : '1px solid var(--border)',
                      fontWeight: isSelected ? 700 : 400,
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            <div className="form-group">
              <label className="form-label">הערות כלליות</label>
              <textarea className="input textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            </div>

          </form>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
          <button form="employee-form" type="submit" className="btn btn-primary">
            <Save size={15} /> {isEdit ? 'שמור שינויים' : 'הוסף עובד'}
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!employeeId) return;

    onSave({
      id: wage?.id || `wa-${Date.now()}`,
      employee_id: employeeId,
      counter_rate: parseFloat(counterRate) || 0,
      class_rate: parseFloat(classRate) || 0,
      private_rate: parseFloat(privateRate) || 0,
      route_rate: parseFloat(routeRate) || 0
    });
    onClose();
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
          <button form="wage-form" type="submit" className="btn btn-primary">
            <Save size={15} /> שמור הסכם
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

  // UI state
  const [activeTab, setActiveTab]         = useState('permanent'); // permanent | certs | wages | shifts
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
      const emps = await fetch('/api/employees').then(r => r.json());
      const wgs = await fetch('/api/wages').then(r => r.json());
      const sfts = await fetch('/api/shifts').then(r => r.json());
      
      setEmployees(emps);
      setWages(wgs);
      setShifts(sfts);
    } catch (err) {
      console.error('Failed to fetch staff data:', err);
    }
  };

  useEffect(() => {
    refreshData();
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const clockedInCount = employees.filter(e => {
    const activeOpenShift = shifts.some(s => s.employee_id === e.id && s.status === 'open');
    return activeOpenShift;
  }).length;

  const employeeShiftStats = useMemo(() => {
    const map = {};
    employees.forEach(emp => {
      const empShifts = shifts.filter(s => s.employee_id === emp.id);
      
      let totalHours = 0;
      let totalPay = 0;

      const agreement = wages.find(w => w.employee_id === emp.id) || {
        counter_rate: 45, class_rate: 70, private_rate: 90, route_rate: 60
      };

      empShifts.forEach(s => {
        if (!s.clock_in || !s.clock_out) return;
        const diffMs = new Date(s.clock_out) - new Date(s.clock_in);
        const hrs = diffMs / (1000 * 60 * 60);
        totalHours += hrs;

        // Calculate rate based on activity type
        let rate = agreement.counter_rate;
        if (s.activity_type === 'class_shift') rate = agreement.class_rate;
        else if (s.activity_type === 'private_shift') rate = agreement.private_rate;
        else if (s.activity_type === 'route_building_shift') rate = agreement.route_rate;

        totalPay += hrs * rate;
      });

      map[emp.id] = {
        hours: Math.round(totalHours * 10) / 10,
        pay: Math.round(totalPay)
      };
    });
    return map;
  }, [employees, shifts, wages]);

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
    const isEdit = employees.some(e => e.id === data.id);
    try {
      const response = await fetch(isEdit ? `/api/employees/${data.id}` : '/api/employees', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (response.ok) {
        refreshData();
        setEditingEmployee(null);
      }
    } catch (err) {
      console.error(err);
    }
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
      if (response.ok) {
        refreshData();
        setEditingWage(null);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleClock = async (empId) => {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    const openShift = shifts.find(s => s.employee_id === empId && s.status === 'open');

    try {
      if (openShift) {
        // Clock out
        const res = await fetch('/api/shifts/clock-out', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: empId, notes: 'משמרת הסתיימה' })
        });
        if (res.ok) {
          alert('שעון נוכחות: יציאה נרשמה בהצלחה!');
          refreshData();
        }
      } else {
        // Clock in
        const selectedAct = clockActivity[empId] || 'counter_shift';
        const res = await fetch('/api/shifts/clock-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: empId, activityType: selectedAct, notes: 'כניסה למשמרת' })
        });
        if (res.ok) {
          alert('שעון נוכחות: כניסה נרשמה בהצלחה!');
          refreshData();
        }
      }
    } catch (err) {
      console.error(err);
    }
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
                <div>🚗 <strong>ניידות:</strong> {selectedEmployee.mobility ? 'כן' : 'לא'}</div>
              </div>
            </div>

            <div className="card card-p">
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>פרטי בנק</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <div>🏦 <strong>חשבון בנק:</strong> {selectedEmployee.bank_account_details || 'טרם עודכן'}</div>
              </div>
            </div>

            {selectedEmployee.certifications?.length > 0 && (
              <div className="card card-p">
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>הסמכות מקצועיות</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {selectedEmployee.certifications.map(c => (
                    <span key={c} className="badge badge-blue" style={{ fontSize: 10 }}>{c}</span>
                  ))}
                </div>
              </div>
            )}

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
                  <th>תעודות רלוונטיות (צ׳קליסט)</th>
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
                        {emp.contractSigned && <span className="badge badge-green" style={{ fontSize: 9 }}>חוזה ✓</span>}
                        {emp.policeClearance && <span className="badge badge-green" style={{ fontSize: 9 }}>משטרה ✓</span>}
                        {emp.hasForm101 && <span className="badge badge-green" style={{ fontSize: 9 }}>101 ✓</span>}
                        {emp.hasIdPhoto && <span className="badge badge-blue" style={{ fontSize: 9 }}>צילום ת.ז</span>}
                        {!emp.contractSigned && !emp.policeClearance && !emp.hasForm101 && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>אין תעודות</span>}
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

    </div>
  );
}
