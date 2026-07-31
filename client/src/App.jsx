import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Calendar, CalendarRange, ShieldCheck, UserCog, LogIn,
  MessageSquare, Bell, Coins, Award, FileHeart, Zap, LogOut, Building2, Package, Sparkles,
} from 'lucide-react';
import { useAuth } from './components/AuthGate.jsx';
import { useBusinessProfile } from './BusinessProfileContext.jsx';
import { isPublicPath } from './publicPaths.js';
import GlobalSearch from './components/GlobalSearch.jsx';
import AgentDock from './components/AgentDock.jsx';

// Code-splitting: each screen is downloaded only when first visited,
// which keeps the initial bundle (and first paint) small.
const DailyWork          = lazy(() => import('./components/DailyWork.jsx'));
const Leads              = lazy(() => import('./components/Leads.jsx'));
const Schedule           = lazy(() => import('./components/Schedule.jsx'));
const ActivitiesCalendar = lazy(() => import('./components/ActivitiesCalendar.jsx'));
const Safety             = lazy(() => import('./components/Safety.jsx'));
const Employees          = lazy(() => import('./components/Employees.jsx'));
const Broadcasts         = lazy(() => import('./components/Broadcasts.jsx'));
const CashRegister       = lazy(() => import('./components/CashRegister.jsx'));
const LevelTests         = lazy(() => import('./components/LevelTests.jsx'));
const HealthDeclarations = lazy(() => import('./components/HealthDeclarations.jsx'));
const CheckInConsole     = lazy(() => import('./components/CheckInConsole.jsx'));
const Automations        = lazy(() => import('./components/Automations.jsx'));
const AiAssistant        = lazy(() => import('./components/AiAssistant.jsx'));
const BusinessSettings   = lazy(() => import('./components/BusinessSettings.jsx'));
const EquipmentTracker   = lazy(() => import('./components/EquipmentTracker.jsx'));

function PageLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-3)', fontSize: 14 }}>
      טוען מסך...
    </div>
  );
}

// ─── Nav Config ─────────────────────────────────────────────────────────────
const NAV = [
  { key: 'dashboard',  label: 'מסך עבודה',          icon: LayoutDashboard,  section: 'main', accent: '#38BDF8' },
  { key: 'checkin',    label: 'מסוף כניסה',        icon: LogIn,            section: 'main', accent: '#2DD4BF' },
  { key: 'leads',      label: 'לקוחות ולידים',     icon: Users,            section: 'main', accent: '#A78BFA' },
  { key: 'schedule',   label: 'לוח חוגים',          icon: Calendar,         section: 'main', accent: '#FBBF24' },
  { key: 'equipment',  label: 'ציוד לאימונים',      icon: Package,          section: 'main', accent: '#A3E635' },
  { key: 'activities', label: 'יומן',               icon: CalendarRange,    section: 'main', accent: '#FB923C' },
  { key: 'broadcasts', label: 'דיוור',              icon: MessageSquare,    section: 'main', accent: '#34D399' },
  { key: 'cash',       label: 'קופה ומכירה',      icon: Coins,            section: 'main', accent: '#F59E0B' },
  { key: 'safety',     label: 'בדיקות בטיחות',     icon: ShieldCheck,      section: 'ops',  accent: '#4ADE80' },
  { key: 'employees',  label: 'עובדים ומשמרות',    icon: UserCog,          section: 'ops',  accent: '#60A5FA' },
  { key: 'levels',     label: 'מבחנים',             icon: Award,            section: 'ops',  accent: '#FCD34D' },
  { key: 'health',     label: 'הצהרות וטפסים',      icon: FileHeart,        section: 'ops',  accent: '#F472B6' },
  { key: 'automations',label: 'אוטומציות',         icon: Zap,              section: 'ops',  accent: '#22D3EE' },
  { key: 'assistant',  label: 'עוזר חכם',           icon: Sparkles,         section: 'ops',  accent: '#818CF8' },
  { key: 'business',   label: 'הגדרות עסק',        icon: Building2,        section: 'ops',  accent: '#C084FC', ownerOnly: true },
];

// URL paths for browser history (Back/Forward). /health is reserved for the public form.
const PAGE_PATHS = {
  dashboard:   '/',
  checkin:     '/checkin',
  leads:       '/leads',
  schedule:    '/schedule',
  equipment:   '/equipment-tracker',
  activities:  '/activities',
  broadcasts:  '/broadcasts',
  cash:        '/cash',
  safety:      '/safety',
  employees:   '/employees',
  levels:      '/levels',
  health:      '/health-declarations',
  automations: '/automations',
  assistant:   '/ai-assistant',
  business:    '/business-settings',
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([key, path]) => [path, key])
);

// Public routes are handled outside App (main.jsx). Never redirect these into the CRM shell.
const STAFF_PAGES = new Set(['checkin', 'leads', 'schedule', 'equipment', 'activities', 'health', 'cash']);

function pathToPage(pathname) {
  if (pathname === '/' || pathname === '') return 'dashboard';
  return PATH_TO_PAGE[pathname] ?? null;
}

const PAGE_TITLES = {
  dashboard:  { title: 'מסך העבודה שלי',          sub: 'כל המשימות והפניות שדורשות טיפול היום' },
  checkin:    { title: 'מסוף כניסה מהירה',       sub: 'רישום כניסות וצ׳ק-אין של לקוחות ומנויים' },
  leads:      { title: 'לקוחות ולידים',           sub: 'ניהול מאגר המתאמנים' },
  schedule:   { title: 'לוח חוגים',               sub: 'ניהול שיעורים ונוכחות' },
  equipment:  { title: 'ציוד לאימונים',           sub: 'מעקב תשלום ומסירה של נעליים, חולצה ומגנזיום' },
  activities: { title: 'יומן',                    sub: 'ימי הולדת, טיולים ואירועים — מסונכרן עם גוגל' },
  broadcasts: { title: 'דיוור',                   sub: 'שליחת הודעות מסיביות' },
  cash:       { title: 'קופה ומכירה',           sub: 'מכירה בדלפק, מוצרים, סגירת קופה ודוחות' },
  safety:     { title: 'בדיקות בטיחות',         sub: 'תדירויות, חתימות יומן ומעקב' },
  employees:  { title: 'עובדים ומשמרות',          sub: 'שעון נוכחות וניהול שכר' },
  levels:     { title: 'מבחנים',                  sub: 'רמה · אבטחה · הובלה' },
  health:     { title: 'הצהרות בריאות וטפסים',    sub: 'עריכת טקסט ההצהרה שנשלחת ללקוחות + מעקב חתימות' },
  automations:{ title: 'אוטומציות ומסעות לקוח',  sub: 'הגדרת פעולות שיווקיות ותפעוליות אוטומטיות' },
  business:   { title: 'הגדרות עסק',             sub: 'שם, לוגו ופרטי קשר שמופיעים ללקוחות' },
};

// ─── Main App Component ──────────────────────────────────────────────────────
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isOwner, signOut } = useAuth();
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '/logo.png';
  const requestedPage = pathToPage(location.pathname) ?? 'dashboard';
  const page = !isOwner && !STAFF_PAGES.has(requestedPage) ? 'leads' : requestedPage;
  const visibleNav = isOwner
    ? NAV
    : NAV.filter((item) => STAFF_PAGES.has(item.key) && !item.ownerOnly);

  const goToPage = (key) => {
    const path = PAGE_PATHS[key] || '/';
    if (path !== location.pathname) navigate(path);
  };

  useEffect(() => {
    if (isPublicPath(location.pathname)) return;
    // Old bookmark: products lived at /pricelist — now a tab inside cash
    if (location.pathname === '/pricelist') {
      navigate('/cash', { replace: true, state: { cashTab: 'products' } });
      return;
    }
    if (pathToPage(location.pathname) === null) {
      navigate(isOwner ? '/' : '/leads', { replace: true });
      return;
    }
    if (!isOwner && !STAFF_PAGES.has(pathToPage(location.pathname))) {
      navigate('/leads', { replace: true });
    }
  }, [isOwner, location.pathname, navigate]);

  // Start empty so deleted/demo records never flash before the API responds.
  const [students, setStudents] = useState([]);
  const [parents, setParents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [coreLoadError, setCoreLoadError] = useState('');
  const [coreReloadKey, setCoreReloadKey] = useState(0);
  const coreEmptyRef = useRef(true);

  useEffect(() => {
    coreEmptyRef.current = students.length === 0 && parents.length === 0;
  }, [students.length, parents.length]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    let attempt = 0;

    async function fetchCollection(path, label) {
      const response = await fetch(path);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // No JSON body means the failure came from a gateway (Cloudflare/Vercel/
        // Render), not from us — keep the status so the screenshot says which.
        throw new Error(body?.error || `טעינת ${label} נכשלה (שגיאה ${response.status})`);
      }
      if (!Array.isArray(body)) {
        throw new Error(`השרת החזיר תשובה לא תקינה עבור ${label}`);
      }
      return body;
    }

    async function fetchData() {
      try {
        const [resStudents, resParents, resGroups] = await Promise.all([
          fetchCollection('/api/students', 'מתאמנים'),
          fetchCollection('/api/parents', 'הורים'),
          fetchCollection('/api/groups', 'חוגים'),
        ]);
        if (cancelled) return;
        setStudents(resStudents);
        setParents(resParents);
        // Dedupe by id in case the API cache briefly contains re-seed duplicates.
        const byId = new Map();
        for (const g of resGroups) {
          if (g?.id) byId.set(g.id, g);
        }
        setGroups([...byId.values()]);
        setCoreLoadError('');
        attempt = 0;
      } catch (error) {
        if (cancelled) return;
        console.warn('Backend server offline.', error);
        setCoreLoadError(error.message || 'טעינת הלקוחות נכשלה');
        // Nodemon restarts briefly refuse connections — retry instead of staying at 0.
        if (attempt < 8) {
          const delay = Math.min(1000 * (2 ** attempt), 8000);
          attempt += 1;
          retryTimer = setTimeout(fetchData, delay);
        }
      }
    }

    fetchData();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!coreEmptyRef.current) return;
      attempt = 0;
      fetchData();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Fetch core data once on mount (plus retry/visibility logic above) —
    // NOT on every tab change, which used to re-download all parents/students/groups.
  }, [coreReloadKey]);
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
  const agentRef = useRef(null);

  const openAgentChat = (event) => {
    event.stopPropagation();
    agentRef.current?.openNewChat();
  };

  return (
    <div className="app-shell">
      {/* ─── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">
            <img src={brandLogo} alt={brandName} />
          </div>
          <div>
            <div className="sidebar-logo-text">{brandName}</div>
            <div className="sidebar-logo-sub">ניהול קיר טיפוס</div>
          </div>
        </div>

        <nav className="sidebar-nav">
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
                style={{ '--nav-accent': n.accent }}
              >
                <span className="nav-icon-wrap">
                  <Icon className="nav-icon" size={17} strokeWidth={2} />
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
            if (n.key === 'assistant') {
              return (
                <div key={n.key} className="nav-item-with-action">
                  <button
                    className={`nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => goToPage(n.key)}
                    style={{ '--nav-accent': n.accent }}
                  >
                    <span className="nav-icon-wrap">
                      <Icon className="nav-icon" size={17} strokeWidth={2} />
                    </span>
                    <span>{n.label}</span>
                  </button>
                  <button
                    type="button"
                    className="nav-agent-launch"
                    onClick={openAgentChat}
                    title="שיחה חדשה עם הסוכן"
                    aria-label="שיחה חדשה עם הסוכן"
                  >
                    <Sparkles size={15} strokeWidth={2.2} />
                  </button>
                </div>
              );
            }
            return (
              <button
                key={n.key}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => goToPage(n.key)}
                style={{ '--nav-accent': n.accent }}
              >
                <span className="nav-icon-wrap">
                  <Icon className="nav-icon" size={17} strokeWidth={2} />
                </span>
                <span>{n.label}</span>
              </button>
            );
          })}
        </nav>

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
            <GlobalSearch
              students={students}
              parents={parents}
              onOpen={(recordId) => navigate(`/leads?open=${encodeURIComponent(recordId)}`)}
            />
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
          <Suspense fallback={<PageLoader />}>
            {page === 'dashboard'  && (
              <DailyWork
                students={students}
                parents={parents}
                groups={groups}
                setParents={setParents}
                onNavigate={navigate}
              />
            )}
            {page === 'checkin'    && <CheckInConsole students={students} groups={groups} />}
            {page === 'leads'      && (
              <Leads
                students={students}
                setStudents={setStudents}
                parents={parents}
                setParents={setParents}
                groups={groups}
                canManageBilling={isOwner}
                canViewComms
                loadError={coreLoadError}
                onRetryLoad={() => {
                  setCoreLoadError('');
                  setCoreReloadKey((value) => value + 1);
                }}
              />
            )}
            {page === 'schedule'   && (
              <Schedule
                groups={groups}
                students={students}
                parents={parents}
                setGroups={setGroups}
                setStudents={setStudents}
                setParents={setParents}
                canManageBilling={isOwner}
              />
            )}
            {page === 'equipment'  && (
              <EquipmentTracker
                groups={groups}
                canEditSettings={isOwner}
                onOpenStudent={(studentId) => {
                  navigate(`/leads?open=${encodeURIComponent(studentId)}`);
                }}
              />
            )}
            {page === 'activities' && <ActivitiesCalendar isOwner={isOwner} />}
            {page === 'broadcasts' && <Broadcasts parents={parents} students={students} groups={groups} />}
            {page === 'cash'       && <CashRegister isOwner={isOwner} initialTab={location.state?.cashTab} />}
            {page === 'safety'     && <Safety />}
            {page === 'employees'  && <Employees />}
            {page === 'levels'     && <LevelTests students={students} groups={groups} />}
            {page === 'health'     && <HealthDeclarations parents={parents} students={students} canManageTemplates={isOwner} />}
            {page === 'automations'&& <Automations />}
            {page === 'assistant'  && <AiAssistant />}
            {page === 'business'   && isOwner && <BusinessSettings />}
          </Suspense>
        </main>

        {/* מחוץ ל-<main> בכוונה: כך השיחה עם הסוכן שורדת מעבר בין מסכים. */}
        <AgentDock ref={agentRef} page={info.title || ''} />
      </div>
    </div>
  );
}
