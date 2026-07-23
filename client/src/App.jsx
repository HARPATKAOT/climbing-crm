import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Calendar, ShieldCheck, UserCog, LogIn,
  MessageSquare, Bell, Search, Coins, Tag, Award, FileHeart, Zap, LogOut
} from 'lucide-react';
import { useAuth } from './components/AuthGate.jsx';

import Dashboard          from './components/Dashboard.jsx';
import Leads              from './components/Leads.jsx';
import Schedule           from './components/Schedule.jsx';
import Safety             from './components/Safety.jsx';
import Employees          from './components/Employees.jsx';
import Broadcasts         from './components/Broadcasts.jsx';
import CashRegister       from './components/CashRegister.jsx';
import Pricelist          from './components/Pricelist.jsx';
import LevelTests         from './components/LevelTests.jsx';
import HealthDeclarations from './components/HealthDeclarations.jsx';
import CheckInConsole     from './components/CheckInConsole.jsx';
import Automations        from './components/Automations.jsx';

// ─── Nav Config ─────────────────────────────────────────────────────────────
const NAV = [
  { key: 'dashboard',  label: 'דשבורד',            icon: LayoutDashboard,  section: 'main', accent: '#38BDF8' },
  { key: 'checkin',    label: 'מסוף כניסה',        icon: LogIn,            section: 'main', accent: '#2DD4BF' },
  { key: 'leads',      label: 'לקוחות ולידים',     icon: Users,            section: 'main', accent: '#A78BFA' },
  { key: 'schedule',   label: 'לוח חוגים',          icon: Calendar,         section: 'main', accent: '#FBBF24' },
  { key: 'broadcasts', label: 'דיוור וואטסאפ',     icon: MessageSquare,    section: 'main', accent: '#34D399' },
  { key: 'cash',       label: 'קופה ומכירה',      icon: Coins,            section: 'main', accent: '#F59E0B' },
  { key: 'pricelist',  label: 'מחירון',             icon: Tag,              section: 'main', accent: '#FB7185' },
  { key: 'safety',     label: 'בדיקות בטיחות',     icon: ShieldCheck,      section: 'ops',  accent: '#4ADE80' },
  { key: 'employees',  label: 'עובדים ומשמרות',    icon: UserCog,          section: 'ops',  accent: '#60A5FA' },
  { key: 'levels',     label: 'מבחנים',             icon: Award,            section: 'ops',  accent: '#FCD34D' },
  { key: 'health',     label: 'הצהרות וטפסים',      icon: FileHeart,        section: 'ops',  accent: '#F472B6' },
  { key: 'automations',label: 'אוטומציות',         icon: Zap,              section: 'ops',  accent: '#FACC15' },
];

// URL paths for browser history (Back/Forward). /health is reserved for the public form.
const PAGE_PATHS = {
  dashboard:   '/',
  checkin:     '/checkin',
  leads:       '/leads',
  schedule:    '/schedule',
  broadcasts:  '/broadcasts',
  cash:        '/cash',
  pricelist:   '/pricelist',
  safety:      '/safety',
  employees:   '/employees',
  levels:      '/levels',
  health:      '/health-declarations',
  automations: '/automations',
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([key, path]) => [path, key])
);

// Public routes are handled outside App (main.jsx). Never redirect these into the CRM shell.
const PUBLIC_PATH_PREFIXES = ['/health', '/join'];
const STAFF_PAGES = new Set(['checkin', 'leads', 'schedule', 'health']);

function isPublicPath(pathname) {
  return PUBLIC_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function pathToPage(pathname) {
  if (pathname === '/' || pathname === '') return 'dashboard';
  return PATH_TO_PAGE[pathname] ?? null;
}

const PAGE_TITLES = {
  dashboard:  { title: 'שלום 👋 Eyal',            sub: 'סקירה כללית של המערכת' },
  checkin:    { title: 'מסוף כניסה מהירה',       sub: 'רישום כניסות וצ׳ק-אין של לקוחות ומנויים' },
  leads:      { title: 'לקוחות ולידים',           sub: 'ניהול מאגר המתאמנים' },
  schedule:   { title: 'לוח חוגים',               sub: 'ניהול שיעורים ונוכחות' },
  broadcasts: { title: 'דיוור וואטסאפ',           sub: 'שליחת הודעות מסיביות' },
  cash:       { title: 'קופה ומכירה',           sub: 'מכירה בדלפק, סגירת קופה וסליקה' },
  pricelist:  { title: 'מחירון',                  sub: 'ניהול מחירי הכניסה, חוגים וציוד' },
  safety:     { title: 'בדיקות בטיחות יומיות',   sub: 'אישור ובטיחות האתר' },
  employees:  { title: 'עובדים ומשמרות',          sub: 'שעון נוכחות וניהול שכר' },
  levels:     { title: 'מבחנים',                  sub: 'רמה · אבטחה · הובלה' },
  health:     { title: 'הצהרות בריאות וטפסים',    sub: 'עריכת טקסט ההצהרה שנשלחת ללקוחות + מעקב חתימות' },
  automations:{ title: 'אוטומציות ומסעות לקוח',  sub: 'הגדרת פעולות שיווקיות ותפעוליות אוטומטיות' },
};

// ─── Main App Component ──────────────────────────────────────────────────────
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isOwner, signOut } = useAuth();
  const requestedPage = pathToPage(location.pathname) ?? 'dashboard';
  const page = !isOwner && !STAFF_PAGES.has(requestedPage) ? 'leads' : requestedPage;
  const visibleNav = isOwner ? NAV : NAV.filter((item) => STAFF_PAGES.has(item.key));

  const goToPage = (key) => {
    const path = PAGE_PATHS[key] || '/';
    if (path !== location.pathname) navigate(path);
  };

  useEffect(() => {
    if (isPublicPath(location.pathname)) return;
    if (pathToPage(location.pathname) === null) {
      navigate(isOwner ? '/' : '/leads', { replace: true });
      return;
    }
    if (!isOwner && !STAFF_PAGES.has(pathToPage(location.pathname))) {
      navigate('/leads', { replace: true });
    }
  }, [isOwner, location.pathname, navigate]);

  const [searchQ, setSearchQ]   = useState('');

  // Start empty so deleted/demo records never flash before the API responds.
  const [students, setStudents] = useState([]);
  const [parents, setParents] = useState([]);
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [resStudents, resParents, resGroups] = await Promise.all([
          fetch('/api/students').then(r => r.ok ? r.json() : null),
          fetch('/api/parents').then(r => r.ok ? r.json() : null),
          fetch('/api/groups').then(r => r.ok ? r.json() : null),
        ]);
        if (Array.isArray(resStudents)) setStudents(resStudents);
        if (Array.isArray(resParents)) setParents(resParents);
        if (Array.isArray(resGroups)) {
          // Dedupe by id in case the API cache briefly contains re-seed duplicates.
          const byId = new Map();
          for (const g of resGroups) {
            if (g?.id) byId.set(g.id, g);
          }
          setGroups([...byId.values()]);
        }
      } catch (error) {
        console.warn('Backend server offline.', error);
      }
    }
    fetchData();
  }, [page]);
  const [showNotifications, setShowNotifications] = useState(false);
  const info   = PAGE_TITLES[page] || {};

  // Unread notification count (newest first)
  const leadTs = (s) => {
    const raw = s.created_at || s.created;
    const t = raw ? new Date(raw).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  };
  const formatLeadTime = (s) => {
    const raw = s.created_at || s.created;
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    // Full ISO / timestamp → clock time; date-only → short Hebrew date
    if (typeof raw === 'string' && raw.includes('T')) {
      return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  };
  const newLeads = students
    .filter(s => s.status === 'lead_new')
    .slice()
    .sort((a, b) => leadTs(b) - leadTs(a));
  const newLeadsCount = newLeads.length;

  return (
    <div className="app-shell">
      {/* ─── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">🧗</div>
          <div>
            <div className="sidebar-logo-text">My Wall</div>
            <div className="sidebar-logo-sub">CRM · מנהל קיר טיפוס</div>
          </div>
        </div>

        {/* Nav: main */}
        <div className="nav-section-label">ניהול</div>
        {visibleNav.filter(n => n.section === 'main').map(n => {
          const Icon = n.icon;
          const isActive = page === n.key;
          return (
            <button
              key={n.key}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => goToPage(n.key)}
              style={{
                '--nav-accent': n.accent,
                ...(isActive ? {
                  background: `${n.accent}28`,
                  borderColor: `${n.accent}66`,
                  color: '#fff',
                  boxShadow: `0 4px 18px ${n.accent}33`,
                } : {}),
              }}
            >
              <span
                className="nav-icon-wrap"
                style={{
                  background: `${n.accent}30`,
                  color: n.accent,
                  boxShadow: isActive ? `0 0 14px ${n.accent}66` : 'none',
                }}
              >
                <Icon className="nav-icon" size={17} strokeWidth={2.25} />
              </span>
              <span>{n.label}</span>
              {n.key === 'leads' && newLeadsCount > 0 && (
                <span className="nav-badge">{newLeadsCount}</span>
              )}
            </button>
          );
        })}

        {/* Nav: ops */}
        <div className="nav-section-label" style={{ marginTop: 8 }}>תפעול</div>
        {visibleNav.filter(n => n.section === 'ops').map(n => {
          const Icon = n.icon;
          const isActive = page === n.key;
          return (
            <button
              key={n.key}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => goToPage(n.key)}
              style={{
                '--nav-accent': n.accent,
                ...(isActive ? {
                  background: `${n.accent}28`,
                  borderColor: `${n.accent}66`,
                  color: '#fff',
                  boxShadow: `0 4px 18px ${n.accent}33`,
                } : {}),
              }}
            >
              <span
                className="nav-icon-wrap"
                style={{
                  background: `${n.accent}30`,
                  color: n.accent,
                  boxShadow: isActive ? `0 0 14px ${n.accent}66` : 'none',
                }}
              >
                <Icon className="nav-icon" size={17} strokeWidth={2.25} />
              </span>
              <span>{n.label}</span>
            </button>
          );
        })}

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="user-pill">
            <div className="avatar">DE</div>
            <div>
              <div className="user-name">{user?.name || user?.email}</div>
              <div className="user-role">{isOwner ? 'מנהל ראשי' : 'צוות תפעול'}</div>
            </div>
            <button className="icon-btn" type="button" onClick={signOut} title="יציאה">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* ─── Main Area ───────────────────────────────────────────────────── */}
      <div className="main-area">
        {/* Top Bar */}
        <header className="topbar">
          <div className="topbar-left">
            <div className="page-title">{info.title}</div>
            <div className="page-sub">{info.sub}</div>
          </div>
          <div className="topbar-right">
            <div className="search-box">
              <Search className="search-box-icon" size={16} />
              <input
                className="search-input"
                placeholder="חיפוש מהיר..."
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
              />
            </div>
            <div style={{ position: 'relative' }}>
              <button className="icon-btn" onClick={() => setShowNotifications(!showNotifications)}>
                <Bell size={17} />
                {newLeadsCount > 0 && <span className="icon-btn-dot" />}
              </button>
              {showNotifications && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 8,
                  background: '#161B22', border: '1px solid var(--border)',
                  borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  width: 260, zIndex: 100, padding: 10
                }}>
                  <div style={{ fontWeight: 'bold', fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6, marginBottom: 8, color: 'var(--text-1)', textAlign: 'right' }}>התראות חדשות</div>
                  {newLeads.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '10px 0', textAlign: 'center' }}>אין לידים חדשים</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', textAlign: 'right' }}>
                      {newLeads.slice(0, 5).map(l => {
                        const timeLabel = formatLeadTime(l);
                        return (
                        <div 
                          key={l.id} 
                          onClick={() => { goToPage('leads'); setShowNotifications(false); }}
                          style={{ fontSize: 12, padding: 8, background: '#21262D', borderRadius: 6, cursor: 'pointer', transition: 'background 0.2s', display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                          onMouseLeave={e => e.currentTarget.style.background = '#21262D'}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            👤 ליד חדש: <strong>{l.name}</strong>
                            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{l.notes?.includes('אינסטגרם') ? 'פנייה מאינסטגרם 📱' : l.notes?.includes('וואטסאפ') ? 'פנייה מוואטסאפ 💬' : 'נוסף במערכת'}</div>
                          </div>
                          {timeLabel && (
                            <div style={{ fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap', flexShrink: 0, marginTop: 1 }}>
                              {timeLabel}
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="page-content">
          {page === 'dashboard'  && <Dashboard students={students} groups={groups} onNavigate={goToPage} />}
          {page === 'checkin'    && <CheckInConsole students={students} groups={groups} />}
          {page === 'leads'      && <Leads students={students} setStudents={setStudents} parents={parents} setParents={setParents} groups={groups} canManageBilling={isOwner} />}
          {page === 'schedule'   && <Schedule groups={groups} students={students} parents={parents} setGroups={setGroups} setStudents={setStudents} />}
          {page === 'broadcasts' && <Broadcasts parents={parents} students={students} groups={groups} />}
          {page === 'cash'       && <CashRegister />}
          {page === 'pricelist'  && <Pricelist />}
          {page === 'safety'     && <Safety />}
          {page === 'employees'  && <Employees />}
          {page === 'levels'     && <LevelTests students={students} groups={groups} />}
          {page === 'health'     && <HealthDeclarations parents={parents} students={students} canManageTemplates={isOwner} />}
          {page === 'automations'&& <Automations />}
        </main>
      </div>
    </div>
  );
}
