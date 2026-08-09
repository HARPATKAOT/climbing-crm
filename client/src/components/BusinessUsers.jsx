import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Award, Ban, Briefcase, CalendarDays, CalendarRange, Check, Coins,
  Eye, FileHeart, GraduationCap, LayoutDashboard, Loader2, LockKeyhole, LogIn,
  MailPlus, MessageSquare, Monitor, Mountain, Package, Pencil, Plus, Save,
  RotateCcw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, ExternalLink, UserCog, UserRoundCheck,
  UserRoundX, UsersRound, X, Zap,
} from 'lucide-react';
import AppSelect from './AppSelect.jsx';
import EmployeeSelf from './EmployeeSelf.jsx';

const STATUS = {
  invited: { label: 'מוזמן', className: 'is-invited' },
  active: { label: 'פעיל', className: 'is-active' },
  blocked: { label: 'חסום', className: 'is-blocked' },
};
const LEVELS = [
  { id: 'none', label: 'ללא גישה', Icon: Ban },
  { id: 'view', label: 'צפייה', Icon: Eye },
  { id: 'edit', label: 'עריכה', Icon: Pencil },
];

const PREVIEW_PAGES = [
  { id: 'dashboard', label: 'מסך עבודה', Icon: LayoutDashboard, modules: ['dashboard'] },
  { id: 'checkin', label: 'מסוף כניסה', Icon: LogIn, modules: ['checkin'] },
  { id: 'customers', label: 'לקוחות ולידים', Icon: UsersRound, modules: ['customers'] },
  { id: 'classes', label: 'לוח חוגים', Icon: CalendarDays, modules: ['classes', 'attendance'] },
  { id: 'equipment', label: 'ציוד לאימונים', Icon: Package, modules: ['equipment'] },
  { id: 'activities', label: 'יומן ואירועים', Icon: CalendarRange, modules: ['activities', 'activity_registrations'] },
  { id: 'broadcasts', label: 'דיוור', Icon: MessageSquare, modules: ['broadcasts'] },
  { id: 'cash', label: 'קופה ומכירה', Icon: Coins, modules: ['pos', 'cash_management'] },
  { id: 'safety', label: 'בדיקות בטיחות', Icon: ShieldCheck, modules: ['safety_checks', 'safety_settings'] },
  { id: 'employees', label: 'עובדים ומשמרות', Icon: UserCog, modules: ['employees', 'shifts', 'hr'] },
  { id: 'tests', label: 'מבחנים', Icon: Award, modules: ['level_tests', 'safety_tests', 'lead_tests'] },
  { id: 'health', label: 'הצהרות וטפסים', Icon: FileHeart, modules: ['health'] },
  { id: 'automations', label: 'אוטומציות', Icon: Zap, modules: ['automations'] },
  { id: 'assistant', label: 'עוזר חכם', Icon: Sparkles, modules: ['assistant'] },
  { id: 'myfile', label: 'התיק שלי', Icon: Briefcase, employeeOnly: true },
];

function previewPageLevel(page, preview) {
  if (page.employeeOnly) return preview?.employee_id ? 'view' : 'none';
  const rank = { none: 0, view: 1, edit: 2 };
  return (page.modules || []).reduce((best, moduleId) => (
    rank[preview?.modules?.[moduleId]] > rank[best] ? preview.modules[moduleId] : best
  ), 'none');
}

function roleVisual(role = {}) {
  const id = String(role.id || '').toLowerCase();
  const name = String(role.name || '');
  if (id === 'owner') return { Icon: ShieldCheck, tone: 'owner' };
  if (id === 'employee') return { Icon: Briefcase, tone: 'employee' };
  if (id === 'wall-station') return { Icon: Monitor, tone: 'wall' };
  if (id === 'operations' || id === 'operations-manager') return { Icon: Settings2, tone: 'operations' };
  if (id === 'instructor' || /מדריך|הדרכה/.test(name)) return { Icon: GraduationCap, tone: 'instructor' };
  if (id === 'safety-officer' || /בטיחות/.test(name)) return { Icon: ShieldCheck, tone: 'safety' };
  if (id === 'reception' || /קבלה|כניסה/.test(name)) return { Icon: LogIn, tone: 'reception' };
  if (id === 'staff' || /צוות/.test(name)) return { Icon: UsersRound, tone: 'staff' };
  if (/קיר|טיפוס/.test(name)) return { Icon: Mountain, tone: 'wall' };
  return { Icon: UserCog, tone: 'custom' };
}

function RoleIcon({ role, size = 15 }) {
  const { Icon, tone } = roleVisual(role);
  return <Icon className={`business-role-icon is-${tone}`} size={size} aria-hidden="true" />;
}

function RolePicker({ roles, value, onChange, disabled = false }) {
  const selected = new Set(value || []);
  return (
    <div className={`business-role-picker ${disabled ? 'is-disabled' : ''}`}>
      {roles.map((role) => {
        const active = selected.has(role.id);
        return (
          <button
            type="button"
            key={role.id}
            className={[active ? 'is-selected' : '', role.id === 'employee' ? 'is-employee' : ''].filter(Boolean).join(' ')}
            disabled={disabled}
            onClick={() => {
              const next = new Set(selected);
              if (active) next.delete(role.id); else next.add(role.id);
              onChange([...next]);
            }}
          >
            <RoleIcon role={role} size={13} />{role.name}{active && <Check className="business-role-picker-check" size={12} />}
          </button>
        );
      })}
      {roles.length === 0 && <span className="business-users-empty">אין תפקידים לבחירה.</span>}
    </div>
  );
}

export default function BusinessUsers() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [moduleCatalog, setModuleCatalog] = useState([]);
  const [sensitiveCatalog, setSensitiveCatalog] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [form, setForm] = useState({ name: '', email: '', account_type: 'personal', role_ids: [] });
  const [newRoleName, setNewRoleName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [replacementRoleId, setReplacementRoleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeSection, setActiveSection] = useState('users');
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewEmployeeOpen, setPreviewEmployeeOpen] = useState(false);
  const [permissionTarget, setPermissionTarget] = useState(null);
  const [permissionData, setPermissionData] = useState(null);
  const [permissionDraft, setPermissionDraft] = useState({ modules: {}, sensitive: {} });
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [permissionError, setPermissionError] = useState('');

  const assignableRoles = useMemo(() => roles.filter((role) => !role.locked), [roles]);
  const inviteRoles = useMemo(() => {
    const employeeRole = roles.find((role) => role.id === 'employee');
    return employeeRole ? [employeeRole, ...assignableRoles] : assignableRoles;
  }, [roles, assignableRoles]);
  const wallStationRole = roles.find((role) => role.id === 'wall-station') || null;
  const selectedRole = roles.find((role) => role.id === selectedRoleId) || roles[0] || null;
  const groupedModules = useMemo(() => {
    const groups = new Map();
    for (const module of moduleCatalog) {
      if (!groups.has(module.group)) groups.set(module.group, []);
      groups.get(module.group).push(module);
    }
    return [...groups.entries()];
  }, [moduleCatalog]);
  const visiblePreviewPages = useMemo(() => PREVIEW_PAGES
    .map((page) => ({ ...page, level: previewPageLevel(page, previewData) }))
    .filter((page) => page.level !== 'none'), [previewData]);
  const effectivePermissionDraft = useMemo(() => {
    const roleModules = permissionData?.role_modules || {};
    const roleSensitive = permissionData?.role_sensitive || {};
    return {
      modules: Object.fromEntries(moduleCatalog.map((module) => [
        module.id,
        Object.prototype.hasOwnProperty.call(permissionDraft.modules || {}, module.id)
          ? permissionDraft.modules[module.id]
          : (roleModules[module.id] || 'none'),
      ])),
      sensitive: Object.fromEntries(sensitiveCatalog.map((permission) => [
        permission.id,
        Object.prototype.hasOwnProperty.call(permissionDraft.sensitive || {}, permission.id)
          ? permissionDraft.sensitive[permission.id]
          : roleSensitive[permission.id] === true,
      ])),
    };
  }, [moduleCatalog, permissionData, permissionDraft, sensitiveCatalog]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [usersResponse, rolesResponse] = await Promise.all([
        fetch('/api/settings/users'),
        fetch('/api/settings/user-roles'),
      ]);
      const usersBody = await usersResponse.json().catch(() => ({}));
      const rolesBody = await rolesResponse.json().catch(() => ({}));
      if (!usersResponse.ok) throw new Error(usersBody.error || 'טעינת המשתמשים נכשלה');
      if (!rolesResponse.ok) throw new Error(rolesBody.error || 'טעינת התפקידים נכשלה');
      const nextRoles = Array.isArray(rolesBody.roles) ? rolesBody.roles : [];
      setUsers(Array.isArray(usersBody) ? usersBody : []);
      setRoles(nextRoles);
      setModuleCatalog(Array.isArray(rolesBody.modules) ? rolesBody.modules : []);
      setSensitiveCatalog(Array.isArray(rolesBody.sensitive) ? rolesBody.sensitive : []);
      setSelectedRoleId((current) => nextRoles.some((role) => role.id === current) ? current : (nextRoles.find((role) => !role.locked)?.id || nextRoles[0]?.id || ''));
    } catch (err) {
      setError(err.message || 'טעינת המשתמשים והתפקידים נכשלה');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const flash = (text) => {
    setError('');
    setMessage(text);
  };

  const updateRoleDraft = (roleId, patch) => setRoles((current) => current.map((role) => role.id === roleId ? { ...role, ...patch } : role));

  const setModuleLevel = (role, moduleId, level) => updateRoleDraft(role.id, {
    modules: { ...(role.modules || {}), [moduleId]: level },
  });

  const saveRole = async (role) => {
    setBusyId(`role:${role.id}`);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/settings/user-roles/${encodeURIComponent(role.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: role.name, modules: role.modules, sensitive: role.sensitive }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'שמירת התפקיד נכשלה');
      updateRoleDraft(role.id, body);
      setUsers((current) => current.map((user) => user.role_ids?.includes(role.id)
        ? { ...user, role_names: (user.role_ids || []).map((id) => id === role.id ? body.name : roles.find((item) => item.id === id)?.name || id) }
        : user));
      flash(`התפקיד „${body.name}” נשמר`);
    } catch (err) {
      setError(err.message || 'שמירת התפקיד נכשלה');
      await load();
    } finally {
      setBusyId('');
    }
  };

  const createRole = async (event) => {
    event.preventDefault();
    setBusyId('new-role');
    setError('');
    try {
      const response = await fetch('/api/settings/user-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoleName, modules: {}, sensitive: {} }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'יצירת התפקיד נכשלה');
      setRoles((current) => [...current, body]);
      setSelectedRoleId(body.id);
      setNewRoleName('');
      flash(`התפקיד „${body.name}” נוצר`);
    } catch (err) {
      setError(err.message || 'יצירת התפקיד נכשלה');
    } finally {
      setBusyId('');
    }
  };

  const deleteRole = async () => {
    if (!deleteTarget) return;
    setBusyId(`delete-role:${deleteTarget.id}`);
    setError('');
    try {
      const response = await fetch(`/api/settings/user-roles/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replacement_role_id: replacementRoleId || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'מחיקת התפקיד נכשלה');
      setDeleteTarget(null);
      setReplacementRoleId('');
      flash(body.reassigned ? `התפקיד נמחק ו־${body.reassigned} משתמשים הועברו לתפקיד החלופי` : 'התפקיד נמחק');
      await load();
    } catch (err) {
      setError(err.message || 'מחיקת התפקיד נכשלה');
    } finally {
      setBusyId('');
    }
  };

  const invite = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const sharedStation = form.account_type === 'shared_station';
      const employeeAccessRequested = !sharedStation && form.role_ids.includes('employee');
      const response = await fetch('/api/settings/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          role_ids: sharedStation
            ? ['wall-station']
            : form.role_ids.filter((roleId) => roleId !== 'employee' && roleId !== 'wall-station'),
          employee_access_requested: employeeAccessRequested,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'שליחת ההזמנה נכשלה');
      setForm({ name: '', email: '', account_type: 'personal', role_ids: [] });
      flash(sharedStation ? `עמדת הקיר הוזמנה בכתובת ${body.email}` : `הזמנה נשלחה אל ${body.email}`);
      await load();
    } catch (err) {
      setError(err.message || 'שליחת ההזמנה נכשלה');
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (user, patch, successMessage) => {
    setBusyId(`user:${user.id}`);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/settings/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'עדכון המשתמש נכשל');
      setUsers((current) => current.map((row) => row.id === user.id ? { ...row, ...body } : row));
      flash(successMessage);
    } catch (err) {
      setError(err.message || 'עדכון המשתמש נכשל');
    } finally {
      setBusyId('');
    }
  };

  const setAccess = (user) => {
    const nextStatus = user.status === 'blocked' ? 'active' : 'blocked';
    return updateUser(user, { status: nextStatus }, nextStatus === 'blocked' ? `הגישה של ${user.name} נחסמה` : `הגישה של ${user.name} הופעלה`);
  };

  const removeAccess = async (user) => {
    const retainedData = user.account_type === 'shared_station'
      ? 'הכניסה ל־CRM מהמחשב תבוטל. נתוני העובדים והפעולות שכבר בוצעו יישארו שמורים.'
      : 'הכניסה ל־CRM תבוטל, אך תיק העובד, המשמרות והמסמכים לא יימחקו.';
    if (!window.confirm(`להסיר את ${user.name} מרשימת המשתמשים המורשים?\n\n${retainedData} ניתן להזמין מחדש בעתיד.`)) return;
    setBusyId(`user:${user.id}`);
    setError('');
    try {
      const response = await fetch(`/api/settings/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'הסרת הגישה נכשלה');
      setUsers((current) => current.filter((row) => row.id !== user.id));
      flash(`הגישה של ${user.name} הוסרה`);
    } catch (err) {
      setError(err.message || 'הסרת הגישה נכשלה');
    } finally {
      setBusyId('');
    }
  };

  const openUserPreview = async (user) => {
    setPreviewTarget(user);
    setPreviewEmployeeOpen(false);
    setPreviewData(null);
    setPreviewError('');
    setPreviewLoading(true);
    try {
      const response = await fetch(`/api/settings/users/${encodeURIComponent(user.id)}/preview`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'טעינת תצוגת המשתמש נכשלה');
      setPreviewData(body);
    } catch (err) {
      setPreviewError(err.message || 'טעינת תצוגת המשתמש נכשלה');
    } finally {
      setPreviewLoading(false);
    }
  };

  const openPermissionEditor = async (user) => {
    setPermissionTarget(user);
    setPermissionData(null);
    setPermissionDraft({ modules: {}, sensitive: {} });
    setPermissionError('');
    setPermissionLoading(true);
    try {
      const response = await fetch(`/api/settings/users/${encodeURIComponent(user.id)}/preview`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'טעינת הרשאות המשתמש נכשלה');
      setPermissionData(body);
      setPermissionDraft({
        modules: { ...(body.permission_overrides?.modules || {}) },
        sensitive: { ...(body.permission_overrides?.sensitive || {}) },
      });
    } catch (err) {
      setPermissionError(err.message || 'טעינת הרשאות המשתמש נכשלה');
    } finally {
      setPermissionLoading(false);
    }
  };

  const setPersonalModuleLevel = (moduleId, level) => {
    const roleLevel = permissionData?.role_modules?.[moduleId] || 'none';
    setPermissionDraft((current) => {
      const modules = { ...(current.modules || {}) };
      if (level === roleLevel) delete modules[moduleId]; else modules[moduleId] = level;
      return { ...current, modules };
    });
  };

  const setPersonalSensitive = (permissionId, allowed) => {
    const roleAllowed = permissionData?.role_sensitive?.[permissionId] === true;
    setPermissionDraft((current) => {
      const sensitive = { ...(current.sensitive || {}) };
      if (allowed === roleAllowed) delete sensitive[permissionId]; else sensitive[permissionId] = allowed;
      return { ...current, sensitive };
    });
  };

  const resetPersonalModule = (moduleId) => setPermissionDraft((current) => {
    const modules = { ...(current.modules || {}) };
    delete modules[moduleId];
    return { ...current, modules };
  });

  const resetPersonalSensitive = (permissionId) => setPermissionDraft((current) => {
    const sensitive = { ...(current.sensitive || {}) };
    delete sensitive[permissionId];
    return { ...current, sensitive };
  });

  const savePersonalPermissions = async () => {
    if (!permissionTarget) return;
    setBusyId(`permissions:${permissionTarget.id}`);
    setPermissionError('');
    try {
      const response = await fetch(`/api/settings/users/${encodeURIComponent(permissionTarget.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_overrides: permissionDraft }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'שמירת ההרשאות האישיות נכשלה');
      setUsers((current) => current.map((row) => row.id === permissionTarget.id ? { ...row, ...body } : row));
      setPermissionData((current) => current ? {
        ...current,
        permission_overrides: permissionDraft,
        modules: effectivePermissionDraft.modules,
        sensitive: effectivePermissionDraft.sensitive,
      } : current);
      flash(`ההרשאות האישיות של ${permissionTarget.name} נשמרו`);
    } catch (err) {
      setPermissionError(err.message || 'שמירת ההרשאות האישיות נכשלה');
    } finally {
      setBusyId('');
    }
  };

  const sendPasswordReset = async (user) => {
    if (!window.confirm(`לשלוח אל ${user.email} קישור מאובטח לאיפוס הסיסמה?`)) return;
    setBusyId(`reset:${user.id}`);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/settings/users/${encodeURIComponent(user.id)}/password-reset`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'שליחת קישור האיפוס נכשלה');
      flash(`קישור לאיפוס הסיסמה נשלח אל ${body.email}`);
    } catch (err) {
      setError(err.message || 'שליחת קישור האיפוס נכשלה');
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <div className="business-users-loading"><Loader2 size={18} className="spin" /> טוען משתמשים ותפקידים...</div>;

  return (
    <div className="business-users">
      <nav className="tab-bar" aria-label="ניהול משתמשים והרשאות">
        <button type="button" className={`tab-pill ${activeSection === 'users' ? 'active' : ''}`} onClick={() => { setActiveSection('users'); setDeleteTarget(null); }}>
          <UsersRound size={15} /> משתמשים רשומים
        </button>
        <button type="button" className={`tab-pill ${activeSection === 'roles' ? 'active' : ''}`} onClick={() => setActiveSection('roles')}>
          <ShieldCheck size={15} /> תפקידים והרשאות
        </button>
      </nav>

      {activeSection === 'roles' && <>
      <section className="business-role-workspace">
        <aside className="business-role-sidebar">
          <div className="business-role-sidebar-head"><strong>תפקידים</strong><span>{roles.length}</span></div>
          {roles.map((role) => (
            <button type="button" key={role.id} className={selectedRole?.id === role.id ? 'is-active' : ''} onClick={() => setSelectedRoleId(role.id)}>
              <span>
                <RoleIcon role={role} />{role.name}
                {role.id === 'employee' && <small>אוטומטי</small>}
                {role.id === 'wall-station' && <small>עמדה</small>}
              </span>{role.locked && <ShieldCheck size={13} />}
            </button>
          ))}
          <form className="business-role-create-stacked" onSubmit={createRole}>
            <input className="input" placeholder="שם תפקיד חדש" value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} required />
            <button className="btn btn-ghost" disabled={busyId === 'new-role'}>{busyId === 'new-role' ? <Loader2 className="spin" size={14} /> : <Plus size={14} />} הוספת תפקיד</button>
          </form>
        </aside>

        <div className="business-role-editor">
          {selectedRole && <>
            <header className="business-role-editor-head">
              <div>
                {selectedRole.locked
                  ? <h3><RoleIcon role={selectedRole} size={18} /> {selectedRole.name}</h3>
                  : <div className="business-role-name-edit"><RoleIcon role={selectedRole} size={17} /><input className="input business-role-name-input" value={selectedRole.name} onChange={(event) => updateRoleDraft(selectedRole.id, { name: event.target.value })} /></div>}
                <p>{selectedRole.id === 'employee'
                  ? 'גישה אוטומטית לתיק העובד האישי בלבד.'
                  : selectedRole.id === 'owner'
                    ? 'גישה מלאה וקבועה לכל המערכת.'
                    : selectedRole.id === 'wall-station'
                      ? 'גישה תפעולית קבועה למחשב המשותף של הקיר — ללא תיק עובד.'
                      : 'בחרו רמת גישה לכל תחום.'}</p>
              </div>
              {!selectedRole.locked && <div className="business-role-editor-actions">
                <button className="btn btn-ghost is-danger" type="button" onClick={() => { setDeleteTarget(selectedRole); setReplacementRoleId(''); }}><Trash2 size={14} /> מחיקה</button>
                <button className="btn btn-primary" type="button" disabled={busyId === `role:${selectedRole.id}`} onClick={() => saveRole(selectedRole)}>{busyId === `role:${selectedRole.id}` ? <Loader2 className="spin" size={14} /> : <Save size={14} />} שמירת תפקיד</button>
              </div>}
            </header>

            {selectedRole.locked ? selectedRole.id === 'employee' ? <div className="business-employee-role-guide">
              <div className="business-employee-role-guide-icon"><UsersRound size={21} /></div>
              <div>
                <strong>כך מוסיפים עובד למערכת</strong>
                <ol>
                  <li>יוצרים לעובד תיק במסך „עובדים ומשמרות” ומזינים בו את כתובת המייל שלו.</li>
                  <li>חוזרים לכאן ושולחים הזמנה בדיוק לאותה כתובת מייל.</li>
                </ol>
                <p>אין צורך לבחור את התפקיד „עובד” — הוא מזוהה אוטומטית. אפשר לצרף גם תפקידים נוספים, כמו מדריך חוגים או אחראי בטיחות.</p>
              </div>
              <a className="btn btn-primary btn-sm" href="/employees"><ExternalLink size={14} /> פתיחת עובדים ומשמרות</a>
            </div> : selectedRole.id === 'wall-station' ? <div className="business-role-system-note is-wall-station">
              <Monitor size={20} />
              <span><strong>עמדה משותפת, לא עובד.</strong> מאפשרת לעובדים לבחור את שמם בכל פעולה: כניסה למשמרת, פתיחת וסגירת קיר, חתימה על בדיקות בטיחות, מכירה ופתיחת או סגירת קופה. דוחות כספיים, שכר ותיקים אישיים נשארים חסומים.</span>
            </div> : <div className="business-role-system-note"><ShieldCheck size={20} /><span>למנהל הראשי יש גישה מלאה לכל היכולות והמידע הרגיש.</span></div> : <>
              <div className="business-sensitive-permissions">
                {sensitiveCatalog.map((permission) => (
                  <label key={permission.id}>
                    <input type="checkbox" checked={selectedRole.sensitive?.[permission.id] === true} onChange={(event) => updateRoleDraft(selectedRole.id, { sensitive: { ...(selectedRole.sensitive || {}), [permission.id]: event.target.checked } })} />
                    <span><strong>{permission.name}</strong><small>{permission.id === 'finance' ? 'כולל דוחות, קופה, חשבוניות ועלויות אירוע.' : 'כולל שכר, בנק, פנסיה ומסמכים של עובדים אחרים.'}</small></span>
                  </label>
                ))}
              </div>
              <div className="business-permission-legend" aria-label="מקרא רמות הרשאה">
                <strong>מקרא</strong>
                {LEVELS.map(({ id, label, Icon }) => <span className={`is-${id}`} key={id}><Icon size={14} /> {label}</span>)}
              </div>
              <div className="business-permission-matrix">
                {groupedModules.map(([group, modules]) => <section key={group}>
                  <h4>{group}</h4>
                  {modules.map((module) => <div className="business-permission-row" key={module.id}>
                    <span>{module.name}</span>
                    <div className="business-access-levels">
                      {LEVELS.filter((level) => !module.levels || module.levels.includes(level.id)).map(({ id, label, Icon }) => <button type="button" key={id} title={`${module.name}: ${label}`} aria-label={`${module.name}: ${label}`} className={(selectedRole.modules?.[module.id] || 'none') === id ? `is-active is-${id}` : ''} onClick={() => setModuleLevel(selectedRole, module.id, id)}><Icon size={15} /></button>)}
                    </div>
                  </div>)}
                </section>)}
              </div>
            </>}
          </>}
        </div>
      </section>

      {deleteTarget && <div className="business-role-delete-confirm">
        <AlertTriangle />
        <div><strong>מחיקת „{deleteTarget.name}”</strong><p>אם התפקיד משויך למשתמשים, יש לבחור תפקיד חלופי. ההחלפה תתבצע יחד עם המחיקה.</p></div>
        <AppSelect className="input select" value={replacementRoleId} onChange={(event) => setReplacementRoleId(event.target.value)}>
          <option value="">בחירת תפקיד חלופי...</option>
          {assignableRoles.filter((role) => role.id !== deleteTarget.id).map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}
        </AppSelect>
        <button className="btn btn-ghost" type="button" onClick={() => setDeleteTarget(null)}><X size={14} /> ביטול</button>
        <button className="btn btn-danger" type="button" disabled={busyId === `delete-role:${deleteTarget.id}`} onClick={deleteRole}><Trash2 size={14} /> מחיקה</button>
      </div>}

      </>}

      {activeSection === 'users' && <>
      <form className="business-user-invite" onSubmit={invite}>
        <div className="business-user-invite-intro">
          <span className="business-users-heading-icon is-invite"><MailPlus size={18} /></span>
          <div><div className="business-settings-card-title">הזמנת גישה למערכת</div><small>בחרו אדם או מחשב משותף</small></div>
        </div>
        <div className="business-account-type" role="group" aria-label="סוג החשבון">
          <button
            type="button"
            className={form.account_type === 'personal' ? 'is-active' : ''}
            aria-pressed={form.account_type === 'personal'}
            onClick={() => setForm((current) => ({
              ...current,
              account_type: 'personal',
              role_ids: current.role_ids.filter((roleId) => roleId !== 'wall-station'),
            }))}
          >
            <UserCog size={19} />
            <span><strong>חשבון אישי</strong><small>לאדם מסוים; אפשר לקשר לתיק עובד</small></span>
          </button>
          <button
            type="button"
            className={form.account_type === 'shared_station' ? 'is-active is-station' : 'is-station'}
            aria-pressed={form.account_type === 'shared_station'}
            onClick={() => setForm((current) => ({ ...current, account_type: 'shared_station', role_ids: ['wall-station'] }))}
          >
            <Monitor size={19} />
            <span><strong>עמדת קיר משותפת</strong><small>למחשב הקבוע; אינה יוצרת עובד</small></span>
          </button>
        </div>
        <div className="business-user-invite-fields">
          <label className="business-settings-field">{form.account_type === 'shared_station' ? 'שם העמדה' : 'שם'}<input className="input" placeholder={form.account_type === 'shared_station' ? 'למשל: מחשב קיר ראשי' : ''} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></label>
          <label className="business-settings-field">{form.account_type === 'shared_station' ? 'מייל להתחברות מהמחשב' : 'כתובת מייל'}<input className="input" type="email" dir="ltr" placeholder={form.account_type === 'shared_station' ? 'wall@your-business.co.il' : ''} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required /></label>
        </div>
        <div className="business-settings-field business-invite-roles">
          {form.account_type === 'shared_station' ? <>
            <span>הרשאות העמדה</span>
            <div className="business-station-access-summary">
              <div><RoleIcon role={wallStationRole || { id: 'wall-station', name: 'עמדת קיר משותפת' }} size={16} /><strong>{wallStationRole?.name || 'עמדת קיר משותפת'}</strong><ShieldCheck size={14} /></div>
              <p>משמרות ופתיחת קיר · בדיקות בטיחות · מכירה · פתיחה וסגירה של הקופה</p>
              <small><Check size={13} /> הפעולה נרשמת על שם העובד שנבחר במסך, לא על שם המחשב.</small>
            </div>
          </> : <><span>תפקידים — אפשר לבחור כמה</span><RolePicker roles={inviteRoles} value={form.role_ids} onChange={(role_ids) => setForm((current) => ({ ...current, role_ids }))} /></>}
        </div>
        <div className="business-user-invite-action"><button className="btn btn-primary" type="submit" disabled={saving || (form.account_type === 'shared_station' && !wallStationRole)}>{saving ? <Loader2 size={14} className="spin" /> : <MailPlus size={14} />} {form.account_type === 'shared_station' ? 'הזמנת העמדה' : 'שליחת הזמנה'}</button></div>
      </form>

      <div className="business-user-cards">
        {users.map((user) => {
          const owner = user.role === 'owner';
          const sharedStation = user.account_type === 'shared_station';
          const status = STATUS[user.status] || STATUS.invited;
          const personalOverrideCount = Object.keys(user.permission_overrides?.modules || {}).length
            + Object.keys(user.permission_overrides?.sensitive || {}).length;
          return <article key={user.id} className={`business-user-card ${sharedStation ? 'is-shared-station' : ''}`}>
            <div className="business-user-card-main">
              <div className="business-user-card-avatar">{sharedStation ? <Monitor /> : <UsersRound />}</div>
              <div><strong>{user.name}</strong><span dir="ltr">{user.email}</span></div>
              <span className={`business-user-status ${status.className}`}>{status.label}</span>
            </div>
            <div className="business-user-card-roles">
              {owner ? <span className="business-user-owner-note"><ShieldCheck size={13} /> מנהל ראשי</span> : <>
                {sharedStation ? <>
                  <span className="business-shared-station-badge"><Monitor size={13} /> עמדת עבודה משותפת · לא עובד</span>
                  <span className="business-station-role-chip"><RoleIcon role={wallStationRole || { id: 'wall-station' }} size={14} /> {user.role_names?.join(' · ') || 'עמדת קיר משותפת'}</span>
                </> : user.employee_match === 'matched' && <>
                  <span className="business-employee-match is-matched"><Check size={12} /> עובד — זוהה לפי מייל</span>
                  {user.employee_id && <a className="btn btn-ghost btn-xs" href={`/employees?open=${encodeURIComponent(user.employee_id)}`}><ExternalLink size={12} /> פתיחת תיק העובד</a>}
                </>}
                {!sharedStation && user.employee_match === 'duplicate' && <span className="business-employee-match is-warning"><AlertTriangle size={12} /> המייל מופיע בכמה תיקי עובדים</span>}
                {!sharedStation && user.employee_match === 'missing' && <span className="business-employee-match is-muted">לא נמצא תיק עובד תואם</span>}
                {!sharedStation && <RolePicker roles={assignableRoles} value={user.role_ids || []} disabled={busyId === `user:${user.id}`} onChange={(role_ids) => updateUser(user, { role_ids }, `התפקידים של ${user.name} עודכנו`)} />}
                {personalOverrideCount > 0 && <span className="business-user-custom-badge"><SlidersHorizontal size={12} /> {personalOverrideCount} התאמות הרשאה אישיות</span>}
              </>}
            </div>
            {!owner && <div className="business-user-card-actions">
              <div className="business-user-card-actions-title">{sharedStation ? 'פעולות עמדה' : 'פעולות משתמש'}</div>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => openPermissionEditor(user)}><SlidersHorizontal size={14} /> הרשאות אישיות</button>
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => openUserPreview(user)}><Monitor size={14} /> תצוגת משתמש</button>
              <button className="btn btn-sm btn-ghost" type="button" disabled={busyId === `reset:${user.id}`} onClick={() => sendPasswordReset(user)}>{busyId === `reset:${user.id}` ? <Loader2 className="spin" size={14} /> : <LockKeyhole size={14} />} איפוס סיסמה</button>
              <button
                className={`btn btn-sm ${user.status === 'blocked' ? 'btn-primary' : 'btn-ghost'}`}
                type="button"
                title={user.status === 'blocked' ? 'החזרת גישה למשתמש שנחסם זמנית' : 'חסימה זמנית; המשתמש והתפקידים נשארים שמורים'}
                disabled={busyId === `user:${user.id}`}
                onClick={() => setAccess(user)}
              >
                {user.status === 'blocked' ? <UserRoundCheck size={14} /> : <UserRoundX size={14} />}
                {user.status === 'blocked' ? 'הפעל גישה' : 'השהה גישה'}
              </button>
              <button
                className="btn btn-sm btn-ghost is-danger"
                type="button"
                title={sharedStation ? 'הסרת הגישה של מחשב הקיר; נתוני העובדים והפעולות נשארים' : 'הסרה מרשימת המשתמשים המורשים; תיק העובד והמסמכים נשארים'}
                disabled={busyId === `user:${user.id}`}
                onClick={() => removeAccess(user)}
              ><Trash2 size={14} /> הסר מהרשימה</button>
              <small className="business-user-card-actions-note">השהיה היא זמנית · הסרה מבטלת את הרשאת ה־CRM</small>
            </div>}
          </article>;
        })}
        {users.length === 0 && <div className="business-users-empty">אין משתמשים מורשים.</div>}
      </div>
      </>}

      {previewTarget && <div className="business-user-preview-backdrop" onMouseDown={() => { setPreviewTarget(null); setPreviewEmployeeOpen(false); }}>
        <section className={`business-user-preview ${previewEmployeeOpen ? 'is-employee-file' : ''}`} role="dialog" aria-modal="true" aria-labelledby="business-user-preview-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div className="business-user-preview-heading">
              <div className="business-user-preview-avatar"><Monitor size={20} /></div>
              <div><h3 id="business-user-preview-title">{previewEmployeeOpen ? `התיק האישי של ${previewTarget.name}` : `מה ${previewTarget.name} רואה במערכת`}</h3><span dir="ltr">{previewTarget.email}</span></div>
            </div>
            <button className="icon-btn" type="button" aria-label="סגירת תצוגת משתמש" onClick={() => { setPreviewTarget(null); setPreviewEmployeeOpen(false); }}><X size={18} /></button>
          </header>

          {previewLoading && <div className="business-user-preview-loading"><Loader2 className="spin" size={18} /> טוען הרשאות אפקטיביות...</div>}
          {previewError && <div className="business-settings-alert is-error">{previewError}</div>}
          {previewData && previewEmployeeOpen && <EmployeeSelf previewUserId={previewTarget.id} onBack={() => setPreviewEmployeeOpen(false)} />}
          {previewData && !previewEmployeeOpen && <>
            <div className={`business-user-preview-status is-${previewData.status}`}>
              {previewData.status === 'blocked' ? <Ban size={15} /> : <Check size={15} />}
              {previewData.status === 'blocked' ? 'הגישה חסומה — המשתמש אינו יכול להיכנס כרגע' : previewData.status === 'invited' ? 'מוזמן — הגישה תופעל לאחר קבלת ההזמנה' : 'גישה פעילה'}
            </div>

            <div className="business-user-preview-roles">
              {(previewData.role_names || []).map((name) => <span key={name}>{name}</span>)}
            </div>

            {previewData.account_type === 'shared_station' && <div className="business-shared-station-note">
              <Monitor size={17} />
              <span><strong>זהו חשבון של מחשב משותף</strong><small>אין לו תיק עובד אישי. במסכי המשמרת, הבטיחות והקופה העובד המבצע בוחר את שמו לפני האישור.</small></span>
            </div>}

            <section className="business-user-preview-section">
              <div className="business-user-preview-section-title"><strong>המסכים שיופיעו בתפריט</strong><small>לפי איחוד כל התפקידים</small></div>
              <div className="business-user-preview-pages">
                {visiblePreviewPages.map(({ id, label, Icon, level, employeeOnly }) => {
                  const content = <><Icon size={17} /><span>{label}</span><small className={`is-${level}`}>{employeeOnly ? 'פתיחה' : level === 'edit' ? 'כולל עריכה' : 'צפייה'}</small></>;
                  return employeeOnly
                    ? <button key={id} className="business-user-preview-page is-clickable" type="button" onClick={() => setPreviewEmployeeOpen(true)}>{content}</button>
                    : <article key={id} className="business-user-preview-page">{content}</article>;
                })}
                {visiblePreviewPages.length === 0 && <div className="business-users-empty">לא הוגדרה גישה לאף מסך.</div>}
              </div>
            </section>

            {(previewData.sensitive?.finance || previewData.sensitive?.hr) && <section className="business-user-preview-section">
              <div className="business-user-preview-section-title"><strong>מידע רגיש שניתן לצפייה</strong></div>
              <div className="business-user-preview-sensitive">
                {previewData.sensitive?.finance && <div className="is-allowed"><Eye size={15} /><span><strong>נתונים פיננסיים של העסק</strong><small>גלויים</small></span></div>}
                {previewData.sensitive?.hr && <div className="is-allowed"><Eye size={15} /><span><strong>שכר ומידע אישי של עובדים אחרים</strong><small>גלויים</small></span></div>}
              </div>
            </section>}

            <div className="business-user-preview-security"><LockKeyhole size={16} /><span>זוהי תצוגה לקריאה בלבד. לא נוצרה התחברות ולא ניתן לבצע פעולות בשם המשתמש. סיסמאות אינן ניתנות לצפייה; ניתן רק לשלוח קישור מאובטח לאיפוס.</span></div>
          </>}
        </section>
      </div>}

      {permissionTarget && <div className="business-user-preview-backdrop" onMouseDown={() => setPermissionTarget(null)}>
        <section className="business-user-preview business-user-permissions-editor" role="dialog" aria-modal="true" aria-labelledby="business-user-permissions-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div className="business-user-preview-heading">
              <div className="business-user-preview-avatar"><SlidersHorizontal size={20} /></div>
              <div><h3 id="business-user-permissions-title">ההרשאות של {permissionTarget.name}</h3><span dir="ltr">{permissionTarget.email}</span></div>
            </div>
            <button className="icon-btn" type="button" aria-label="סגירת הרשאות אישיות" onClick={() => setPermissionTarget(null)}><X size={18} /></button>
          </header>

          {permissionLoading && <div className="business-user-preview-loading"><Loader2 className="spin" size={18} /> טוען את ריכוז ההרשאות...</div>}
          {permissionError && <div className="business-settings-alert is-error">{permissionError}</div>}
          {permissionData && <>
            <div className="business-user-preview-roles">
              {(permissionData.role_names || []).map((name) => <span key={name}>{name}</span>)}
            </div>
            <div className="business-user-permissions-summary">
              <div><strong>{Object.values(effectivePermissionDraft.modules).filter((level) => level !== 'none').length}</strong><span>תחומים זמינים</span></div>
              <div><strong>{Object.values(effectivePermissionDraft.modules).filter((level) => level === 'edit').length}</strong><span>תחומים לעריכה</span></div>
              <div><strong>{Object.keys(permissionDraft.modules || {}).length + Object.keys(permissionDraft.sensitive || {}).length}</strong><span>התאמות אישיות</span></div>
            </div>
            {permissionData.account_type === 'shared_station' && <div className="business-shared-station-note">
              <Monitor size={17} />
              <span><strong>הרשאות של עמדה משותפת</strong><small>ההתאמות כאן משנות את יכולות המחשב בלבד ואינן יוצרות או משנות עובד.</small></span>
            </div>}
            {permissionData.employee_id && <div className="business-user-self-access-note"><Briefcase size={17} /><span><strong>התיק שלי</strong><small>גישה אישית קבועה לתיק העובד שזוהה לפי כתובת המייל; אינה מעניקה גישה לתיקי עובדים אחרים.</small></span></div>}

            <section className="business-user-personal-sensitive">
              <div className="business-user-preview-section-title"><strong>מידע רגיש</strong><small>ההרשאה הסופית לאחר איחוד התפקידים וההתאמות האישיות</small></div>
              {sensitiveCatalog.map((permission) => {
                const customized = Object.prototype.hasOwnProperty.call(permissionDraft.sensitive || {}, permission.id);
                const allowed = effectivePermissionDraft.sensitive[permission.id] === true;
                return <div className={`business-user-personal-row ${customized ? 'is-customized' : ''}`} key={permission.id}>
                  <div className="business-user-personal-label">
                    <strong>{permission.name}</strong>
                    <small>{customized ? 'התאמה אישית למשתמש' : `מהתפקידים: ${permissionData.role_sensitive?.[permission.id] ? 'מורשה' : 'חסום'}`}</small>
                  </div>
                  <div className="business-user-sensitive-controls">
                    <button type="button" aria-label={`${permission.name}: חסום`} className={!allowed ? 'is-active is-none' : ''} onClick={() => setPersonalSensitive(permission.id, false)}><Ban size={15} /></button>
                    <button type="button" aria-label={`${permission.name}: מורשה`} className={allowed ? 'is-active is-view' : ''} onClick={() => setPersonalSensitive(permission.id, true)}><Eye size={15} /></button>
                    <button type="button" className="is-reset" aria-label={`${permission.name}: איפוס לפי תפקידים`} title="איפוס לפי תפקידים" disabled={!customized} onClick={() => resetPersonalSensitive(permission.id)}><RotateCcw size={14} /></button>
                  </div>
                </div>;
              })}
            </section>

            <div className="business-permission-legend" aria-label="מקרא רמות הרשאה">
              <strong>מקרא</strong>
              {LEVELS.map(({ id, label, Icon }) => <span className={`is-${id}`} key={id}><Icon size={14} /> {label}</span>)}
              <span className="is-inherited"><RotateCcw size={14} /> לפי התפקידים</span>
            </div>
            <div className="business-permission-matrix business-user-personal-matrix">
              {groupedModules.map(([group, modules]) => <section key={group}>
                <h4>{group}</h4>
                {modules.map((module) => {
                  const customized = Object.prototype.hasOwnProperty.call(permissionDraft.modules || {}, module.id);
                  const roleLevel = permissionData.role_modules?.[module.id] || 'none';
                  const effectiveLevel = effectivePermissionDraft.modules[module.id] || 'none';
                  return <div className={`business-permission-row ${customized ? 'is-customized' : ''}`} key={module.id}>
                    <span><strong>{module.name}</strong><small>{customized ? 'התאמה אישית' : `מהתפקידים: ${LEVELS.find((level) => level.id === roleLevel)?.label || 'ללא גישה'}`}</small></span>
                    <div className="business-user-module-controls">
                      <div className="business-access-levels">
                        {LEVELS.filter((level) => !module.levels || module.levels.includes(level.id)).map(({ id, label, Icon }) => <button type="button" key={id} title={`${module.name}: ${label}`} aria-label={`${module.name}: ${label}`} className={effectiveLevel === id ? `is-active is-${id}` : ''} onClick={() => setPersonalModuleLevel(module.id, id)}><Icon size={15} /></button>)}
                      </div>
                      <button type="button" className="business-user-permission-reset" title="איפוס לפי התפקידים" aria-label={`${module.name}: איפוס לפי התפקידים`} disabled={!customized} onClick={() => resetPersonalModule(module.id)}><RotateCcw size={14} /></button>
                    </div>
                  </div>;
                })}
              </section>)}
            </div>

            <footer className="business-user-permissions-actions">
              <button className="btn btn-ghost" type="button" disabled={Object.keys(permissionDraft.modules || {}).length + Object.keys(permissionDraft.sensitive || {}).length === 0} onClick={() => setPermissionDraft({ modules: {}, sensitive: {} })}><RotateCcw size={14} /> איפוס כל ההתאמות</button>
              <button className="btn btn-primary" type="button" disabled={busyId === `permissions:${permissionTarget.id}`} onClick={savePersonalPermissions}>{busyId === `permissions:${permissionTarget.id}` ? <Loader2 className="spin" size={14} /> : <Save size={14} />} שמירת הרשאות אישיות</button>
            </footer>
          </>}
        </section>
      </div>}

      {error && <div className="business-settings-alert is-error">{error}</div>}
      {message && <div className="business-settings-alert is-ok">{message}</div>}
    </div>
  );
}
