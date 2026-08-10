import React, { useEffect, useMemo, useState } from 'react';
import { BadgePercent, Briefcase, Link2, Pencil, Plus, Save, Search, ToggleLeft, ToggleRight, Trash2, Users, X } from 'lucide-react';
import AppSelect from './AppSelect.jsx';

const EMPTY_PERSONAL = { employeeId: '', studentId: '', type: 'percent', value: '20', pricelistId: '', label: 'הנחת עובד' };
const emptyBenefit = () => ({ type: 'percent', value: '20', target: 'categories', categoryNames: [], pricelistIds: [], productType: 'punch_card', label: '' });
const emptyRule = () => ({ name: '', audience: 'employee_role', role: '', group_id: '', benefits: [emptyBenefit()], active: true });

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits.slice(-9);
}
function studentName(student) { return student?.name || student?.student_name || student?.studentName || 'מתאמן ללא שם'; }
async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'הפעולה נכשלה');
  return body;
}
function expectRows(rows) {
  if (!Array.isArray(rows)) throw new Error('תשובה לא צפויה מהשרת');
  return rows;
}
function targetText(benefit, products) {
  if (benefit.target === 'product_type') return benefit.productType === 'punch_card' ? 'כל הכרטיסיות' : benefit.productType === 'time_membership' ? 'כל המנויים' : 'כל המוצרים';
  if (benefit.target === 'products') return benefit.pricelistIds.map((id) => products.find((p) => String(p.id) === String(id))?.name).filter(Boolean).join(', ');
  return benefit.categoryNames.join(', ');
}

export default function DiscountCenter() {
  const [view, setView] = useState('rules');
  const [rules, setRules] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [students, setStudents] = useState([]);
  const [parents, setParents] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [groups, setGroups] = useState([]);
  const [roleCatalog, setRoleCatalog] = useState({ system: [], extra: [] });
  const [ruleDraft, setRuleDraft] = useState(null);
  const [personalDraft, setPersonalDraft] = useState(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  /**
   * כל רשימה נטענת בנפרד. כשהמסך טען את כולן בבת אחת, קריאה אחת שנכשלה
   * השאירה גם את בורר המוצרים ריק — והמשתמש ראה תפריט בלי מוצרים בלי לדעת
   * שדבר אחר לגמרי הוא שנפל. עכשיו מה שנטען מוצג, ומה שנכשל מופיע בשמו.
   */
  const load = async () => {
    const sources = [
      ['כללי ההנחה', '/api/discount-rules', (rows) => setRules(expectRows(rows))],
      ['הנחות אישיות', '/api/coupons?recurring=1', (rows) => setDiscounts(expectRows(rows).filter((row) => row.source !== 'discount_rules'))],
      ['עובדים', '/api/employees', (rows) => setEmployees(expectRows(rows))],
      ['מתאמנים', '/api/students', (rows) => setStudents(expectRows(rows))],
      ['הורים', '/api/parents', (rows) => setParents(expectRows(rows))],
      ['מוצרים', '/api/pricelist?images=0', (rows) => setProducts(expectRows(rows))],
      ['קטגוריות', '/api/product-categories', (rows) => setCategories(expectRows(rows))],
      ['חוגים', '/api/groups', (rows) => setGroups(expectRows(rows))],
      ['תפקידים', '/api/staff-roles', (roles) => setRoleCatalog(roles && typeof roles === 'object' ? roles : { system: [], extra: [] })],
    ];
    const failures = await Promise.all(sources.map(async ([label, path, apply]) => {
      try { apply(await api(path)); return null; } catch (err) { return `${label} — ${err.message}`; }
    }));
    const failed = failures.filter(Boolean);
    setError(failed.length ? `חלק מהנתונים לא נטענו: ${failed.join(' | ')}. רעננו את הדף ונסו שוב.` : '');
  };
  useEffect(() => { load(); }, []);

  const parentById = useMemo(() => new Map(parents.map((p) => [String(p.id), p])), [parents]);
  const employeeById = useMemo(() => new Map(employees.map((e) => [String(e.id), e])), [employees]);
  const studentById = useMemo(() => new Map(students.map((s) => [String(s.id), s])), [students]);
  const roles = useMemo(() => [...(roleCatalog.system || []).map((r) => r.label), ...(roleCatalog.extra || [])].filter(Boolean), [roleCatalog]);
  const visibleEmployees = employees.filter((employee) => `${employee.name} ${(employee.certifications || []).join(' ')}`.toLowerCase().includes(query.toLowerCase()));

  const saveRule = async () => {
    if (!ruleDraft?.name.trim()) return setError('יש לתת שם לכלל');
    setBusy('rule'); setError('');
    try {
      await api(ruleDraft.id ? `/api/discount-rules/${ruleDraft.id}` : '/api/discount-rules', {
        method: ruleDraft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ruleDraft),
      });
      setRuleDraft(null); await load();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const toggleRule = async (rule) => {
    setBusy(rule.id);
    try { await api(`/api/discount-rules/${rule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !rule.active }) }); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  };
  const updateBenefit = (index, patch) => setRuleDraft((draft) => ({ ...draft, benefits: draft.benefits.map((benefit, i) => i === index ? { ...benefit, ...patch } : benefit) }));
  const removeBenefit = (index) => setRuleDraft((draft) => ({ ...draft, benefits: draft.benefits.filter((_, i) => i !== index) }));

  const linkEmployee = async (employeeId, studentId) => {
    setBusy(`link-${employeeId}`); setError('');
    try {
      await api(`/api/discount-rules/employee/${employeeId}/student`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: studentId || null }) });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  const savePersonal = async () => {
    if (!personalDraft?.studentId) return setError('יש לבחור מתאמן');
    setBusy('personal');
    const student = studentById.get(String(personalDraft.studentId));
    const payload = { recurring: true, employeeId: personalDraft.employeeId || null, studentId: personalDraft.studentId, parentId: student?.parentId || student?.parent_id || null,
      offer: { type: personalDraft.type, value: Number(personalDraft.value), units: 50, noExpiry: true, label: personalDraft.label.trim() || 'הנחה קבועה', appliesTo: personalDraft.pricelistId ? 'items' : 'all', pricelistIds: personalDraft.pricelistId ? [String(personalDraft.pricelistId)] : [] } };
    try { await api(personalDraft.id ? `/api/coupons/${personalDraft.id}` : '/api/coupons', { method: personalDraft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); setPersonalDraft(null); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(''); }
  };

  return <div className="fade-in" dir="rtl">
    <div className="section-header" style={{ marginBottom: 14 }}><div><div className="section-title"><BadgePercent size={18} /> הטבות והנחות</div><div className="section-sub">כללי זכאות אוטומטיים, קישור עובדים לתיק מתאמן והחרגות אישיות.</div></div>{view === 'rules' && <button className="btn btn-primary btn-sm" onClick={() => setRuleDraft(emptyRule())}><Plus size={14} /> כלל חדש</button>}{view === 'personal' && <button className="btn btn-primary btn-sm" onClick={() => setPersonalDraft({ ...EMPTY_PERSONAL })}><Plus size={14} /> הנחה אישית</button>}</div>
    {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}
    <div className="tab-bar tab-bar-inline" style={{ marginBottom: 16 }}>
      <button className={`tab-pill ${view === 'rules' ? 'active' : ''}`} onClick={() => setView('rules')}><BadgePercent size={14} /> כללי הנחה ({rules.length})</button>
      <button className={`tab-pill ${view === 'links' ? 'active' : ''}`} onClick={() => setView('links')}><Link2 size={14} /> התאמת עובדים</button>
      <button className={`tab-pill ${view === 'personal' ? 'active' : ''}`} onClick={() => setView('personal')}><Users size={14} /> הנחות אישיות ({discounts.length})</button>
    </div>

    {view === 'rules' && <div style={{ display: 'grid', gap: 10 }}>
      {rules.map((rule) => <div className="card card-p" key={rule.id} style={{ opacity: rule.active ? 1 : .62 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><div style={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 7 }}>{rule.audience === 'employee_role' ? <Briefcase size={15} /> : <Users size={15} />}{rule.name}<span className={`badge ${rule.active ? 'badge-green' : 'badge-gray'}`}>{rule.active ? 'פעיל' : 'כבוי'}</span></div><div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>{rule.audience === 'employee_role' ? `כל עובד בתפקיד: ${rule.role}` : rule.group_id ? `כל מתאמן הרשום ל-${groups.find((g) => String(g.id) === String(rule.group_id))?.name || 'חוג שנבחר'}` : 'כל מתאמן עם הרשמה פעילה לחוג'}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>{(rule.benefits || []).map((benefit, i) => <span className="badge badge-blue" key={i}>{benefit.value}{benefit.type === 'percent' ? '%' : ' ₪'} · {targetText(benefit, products)}</span>)}</div></div><div style={{ display: 'flex', gap: 5 }}><button className="btn btn-ghost btn-xs" onClick={() => setRuleDraft(JSON.parse(JSON.stringify(rule)))}><Pencil size={12} /> עריכה</button><button className="btn btn-ghost btn-xs" disabled={busy === rule.id} onClick={() => toggleRule(rule)}>{rule.active ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}{rule.active ? 'כיבוי' : 'הפעלה'}</button></div></div></div>)}
      {!rules.length && <div className="card card-p" style={{ textAlign: 'center', color: 'var(--text-3)' }}>עדיין אין כללי הנחה. צרו כלל לתפקיד עובד או לרישום בחוג.</div>}
    </div>}

    {view === 'links' && <><div className="card card-p" style={{ marginBottom: 10 }}><div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Search size={14} /><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש עובד או תפקיד..." /></div><div style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 7 }}>הקישור קובע איזה תיק מתאמן שייך לעובד. כללי התפקיד יחולו עליו אוטומטית בקופה.</div></div><div style={{ display: 'grid', gap: 8 }}>{visibleEmployees.map((employee) => {
      const phone = normalizePhone(employee.phone || employee.mobile); const suggestions = new Set(students.filter((student) => { const parent = parentById.get(String(student.parentId || student.parent_id || '')); return phone && (normalizePhone(student.phone) === phone || normalizePhone(parent?.phone) === phone); }).map((s) => String(s.id)));
      return <div className="card card-p" key={employee.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(260px,1.5fr)', gap: 14, alignItems: 'center' }}><div><strong>{employee.name}</strong><div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{(employee.certifications || []).join(' · ') || 'ללא תפקיד מסומן'}</div></div><div><AppSelect className="input" disabled={busy === `link-${employee.id}`} value={employee.customer_student_id || ''} onChange={(e) => linkEmployee(employee.id, e.target.value)}><option value="">לא מקושר לתיק מתאמן</option>{students.map((student) => <option key={student.id} value={student.id}>{suggestions.has(String(student.id)) ? '★ ' : ''}{studentName(student)}{suggestions.has(String(student.id)) ? ' · התאמת טלפון' : ''}</option>)}</AppSelect></div></div>;
    })}</div></>}

    {view === 'personal' && <div style={{ display: 'grid', gap: 8 }}>{discounts.map((discount) => { const student = studentById.get(String(discount.student_id || '')); const employee = employeeById.get(String(discount.employee_id || '')); return <div className="card card-p" key={discount.id}><div style={{ display: 'flex', justifyContent: 'space-between' }}><div><strong>{discount.label}</strong><div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 4 }}>{studentName(student)}{employee ? ` · ${employee.name}` : ''} · {discount.offer?.value}{discount.offer?.type === 'percent' ? '%' : ' ₪'}</div></div><button className="btn btn-ghost btn-xs" onClick={() => setPersonalDraft({ id: discount.id, employeeId: discount.employee_id || '', studentId: discount.student_id || '', type: discount.offer?.type || 'percent', value: String(discount.offer?.value || ''), pricelistId: discount.offer?.pricelistIds?.[0] || '', label: discount.label || '' })}><Pencil size={12} /> עריכה</button></div></div>; })}{!discounts.length && <div className="card card-p" style={{ textAlign: 'center', color: 'var(--text-3)' }}>אין הנחות אישיות. כללים אוטומטיים מנוהלים בלשונית הראשונה.</div>}</div>}

    {ruleDraft && <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setRuleDraft(null)}><div className="modal" style={{ maxWidth: 760 }}><div className="modal-header"><div className="modal-title">{ruleDraft.id ? 'עריכת כלל הנחה' : 'כלל הנחה חדש'}</div><button className="btn btn-ghost btn-icon" onClick={() => setRuleDraft(null)}><X size={17} /></button></div><div className="modal-body" style={{ display: 'grid', gap: 13 }}>
      <div><label className="form-label">שם הכלל</label><input className="input" value={ruleDraft.name} onChange={(e) => setRuleDraft((d) => ({ ...d, name: e.target.value }))} placeholder="למשל: הטבות מדריכי נוער" /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><div><label className="form-label">מי זכאי?</label><AppSelect className="input" value={ruleDraft.audience} onChange={(e) => setRuleDraft((d) => ({ ...d, audience: e.target.value }))}><option value="employee_role">עובדים לפי תפקיד</option><option value="active_class">מתאמנים הרשומים לחוג</option></AppSelect></div>{ruleDraft.audience === 'employee_role' ? <div><label className="form-label">תפקיד</label><AppSelect className="input" value={ruleDraft.role} onChange={(e) => setRuleDraft((d) => ({ ...d, role: e.target.value }))}><option value="">בחירת תפקיד...</option>{roles.map((role) => <option key={role} value={role}>{role}</option>)}</AppSelect></div> : <div><label className="form-label">חוג</label><AppSelect className="input" value={ruleDraft.group_id} onChange={(e) => setRuleDraft((d) => ({ ...d, group_id: e.target.value }))}><option value="">כל מי שרשום לחוג פעיל</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</AppSelect></div>}</div>
      <div><div style={{ fontWeight: 800, marginBottom: 8 }}>מה מקבלים?</div><div style={{ display: 'grid', gap: 8 }}>{ruleDraft.benefits.map((benefit, index) => <div key={index} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: '120px 100px 145px 1fr 34px', gap: 7, alignItems: 'end' }}><div><label className="form-label">סוג הנחה</label><AppSelect className="input input-sm" value={benefit.type} onChange={(e) => updateBenefit(index, { type: e.target.value })}><option value="percent">אחוז</option><option value="amount">₪ קבוע</option></AppSelect></div><div><label className="form-label">גובה</label><input className="input input-sm" type="number" value={benefit.value} onChange={(e) => updateBenefit(index, { value: e.target.value })} /></div><div><label className="form-label">יעד</label><AppSelect className="input input-sm" value={benefit.target} onChange={(e) => updateBenefit(index, { target: e.target.value, categoryNames: [], pricelistIds: [] })}><option value="categories">קטגוריה</option><option value="products">מוצר מסוים</option><option value="product_type">סוג מוצר</option></AppSelect></div><div><label className="form-label">על מה?</label>{benefit.target === 'categories' ? <AppSelect className="input input-sm" value={benefit.categoryNames?.[0] || ''} onChange={(e) => updateBenefit(index, { categoryNames: e.target.value ? [e.target.value] : [] })}><option value="">בחירת קטגוריה...</option>{categories.filter((c) => c.active !== false).map((c) => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}</AppSelect> : benefit.target === 'products' ? <AppSelect className="input input-sm" value={benefit.pricelistIds?.[0] || ''} onChange={(e) => updateBenefit(index, { pricelistIds: e.target.value ? [e.target.value] : [] })}><option value="">{products.length ? 'בחירת מוצר...' : 'אין מוצרים להצגה'}</option>{products.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</AppSelect> : <AppSelect className="input input-sm" value={benefit.productType} onChange={(e) => updateBenefit(index, { productType: e.target.value })}><option value="punch_card">כרטיסיות</option><option value="time_membership">מנויים</option><option value="product">מוצרים רגילים</option></AppSelect>}</div><button className="btn btn-ghost btn-icon" disabled={ruleDraft.benefits.length === 1} onClick={() => removeBenefit(index)}><Trash2 size={13} /></button></div>)}</div><button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setRuleDraft((d) => ({ ...d, benefits: [...d.benefits, emptyBenefit()] }))}><Plus size={13} /> שורת הנחה נוספת</button></div>
    </div><div className="modal-footer"><button className="btn btn-primary" disabled={busy === 'rule'} onClick={saveRule}><Save size={14} /> {busy === 'rule' ? 'שומר...' : 'שמירת הכלל'}</button><button className="btn btn-ghost" onClick={() => setRuleDraft(null)}>ביטול</button></div></div></div>}

    {personalDraft && <div className="modal-overlay"><div className="modal" style={{ maxWidth: 590 }}><div className="modal-header"><div className="modal-title">הנחה אישית קבועה</div><button className="btn btn-ghost btn-icon" onClick={() => setPersonalDraft(null)}><X size={17} /></button></div><div className="modal-body" style={{ display: 'grid', gap: 11 }}><div><label className="form-label">תיק מתאמן</label><AppSelect className="input" value={personalDraft.studentId} onChange={(e) => setPersonalDraft((d) => ({ ...d, studentId: e.target.value }))}><option value="">בחירה...</option>{students.map((s) => <option key={s.id} value={s.id}>{studentName(s)}</option>)}</AppSelect></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><AppSelect className="input" value={personalDraft.type} onChange={(e) => setPersonalDraft((d) => ({ ...d, type: e.target.value }))}><option value="percent">אחוז הנחה</option><option value="amount">סכום בשקלים</option></AppSelect><input className="input" type="number" value={personalDraft.value} onChange={(e) => setPersonalDraft((d) => ({ ...d, value: e.target.value }))} /></div><div><label className="form-label">מוצר מסוים (רשות)</label><AppSelect className="input" value={personalDraft.pricelistId} onChange={(e) => setPersonalDraft((d) => ({ ...d, pricelistId: e.target.value }))}><option value="">כל המוצרים</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</AppSelect></div><input className="input" value={personalDraft.label} onChange={(e) => setPersonalDraft((d) => ({ ...d, label: e.target.value }))} placeholder="שם ההנחה בקופה" /></div><div className="modal-footer"><button className="btn btn-primary" disabled={busy === 'personal'} onClick={savePersonal}><Save size={14} /> שמירה</button><button className="btn btn-ghost" onClick={() => setPersonalDraft(null)}>ביטול</button></div></div></div>}
  </div>;
}
