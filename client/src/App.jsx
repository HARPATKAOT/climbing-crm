import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Users, Calendar, ShieldCheck, UserCog, LogIn,
  MessageSquare, Bell, Search, Coins, Tag, Award, FileHeart, Zap
} from 'lucide-react';

import { mockStudents, mockParents, mockGroups } from './mockData.js';
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
  { key: 'dashboard',  label: 'דשבורד',            icon: LayoutDashboard,  section: 'main' },
  { key: 'checkin',    label: 'מסוף כניסה',        icon: LogIn,            section: 'main' },
  { key: 'leads',      label: 'לקוחות ולידים',     icon: Users,            section: 'main' },
  { key: 'schedule',   label: 'לוח חוגים',          icon: Calendar,         section: 'main' },
  { key: 'broadcasts', label: 'דיוור וואטסאפ',     icon: MessageSquare,    section: 'main' },
  { key: 'cash',       label: 'קופה וחשבונות',    icon: Coins,            section: 'main' },
  { key: 'pricelist',  label: 'מחירון',             icon: Tag,              section: 'main' },
  { key: 'safety',     label: 'בדיקות בטיחות',     icon: ShieldCheck,      section: 'ops' },
  { key: 'employees',  label: 'עובדים ומשמרות',    icon: UserCog,          section: 'ops' },
  { key: 'levels',     label: 'מבחני רמה',          icon: Award,            section: 'ops' },
  { key: 'health',     label: 'הצהרות בריאות',      icon: FileHeart,        section: 'ops' },
  { key: 'automations',label: 'אוטומציות',         icon: Zap,              section: 'ops' },
];

const PAGE_TITLES = {
  dashboard:  { title: 'שלום 👋 Eyal',            sub: 'סקירה כללית של המערכת' },
  checkin:    { title: 'מסוף כניסה מהירה',       sub: 'רישום כניסות וצ׳ק-אין של לקוחות ומנויים' },
  leads:      { title: 'לקוחות ולידים',           sub: 'ניהול מאגר המתאמנים' },
  schedule:   { title: 'לוח חוגים',               sub: 'ניהול שיעורים ונוכחות' },
  broadcasts: { title: 'דיוור וואטסאפ',           sub: 'שליחת הודעות מסיביות' },
  cash:       { title: 'קופה וחשבונאי',           sub: 'סגירת קופה וסליקת iCount' },
  pricelist:  { title: 'מחירון',                  sub: 'ניהול מחירי הכניסה, חוגים וציוד' },
  safety:     { title: 'בדיקות בטיחות יומיות',   sub: 'אישור ובטיחות האתר' },
  employees:  { title: 'עובדים ומשמרות',          sub: 'שעון נוכחות וניהול שכר' },
  levels:     { title: 'מבחני רמה',               sub: 'מעקב אחר התקדמות המתאמנים' },
  health:     { title: 'הצהרות בריאות',           sub: 'ניהול הצהרות בריאות דיגיטליות' },
  automations:{ title: 'אוטומציות ומסעות לקוח',  sub: 'הגדרת פעולות שיווקיות ותפעוליות אוטומטיות' },
};

// ─── Main App Component ──────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]         = useState('dashboard');
  const [searchQ, setSearchQ]   = useState('');

  // Shared state persisted in localStorage
  const [students, setStudents] = useState(() => {
    const saved = localStorage.getItem('crm_students');
    return saved ? JSON.parse(saved) : mockStudents;
  });
  const [parents, setParents] = useState(() => {
    const saved = localStorage.getItem('crm_parents');
    return saved ? JSON.parse(saved) : mockParents;
  });
  const [groups, setGroups] = useState(() => {
    const saved = localStorage.getItem('crm_groups');
    return saved ? JSON.parse(saved) : mockGroups;
  });

  useEffect(() => {
    async function fetchData() {
      try {
        const [resStudents, resParents, resGroups] = await Promise.all([
          fetch('/api/students').then(r => r.ok ? r.json() : null),
          fetch('/api/parents').then(r => r.ok ? r.json() : null),
          fetch('/api/groups').then(r => r.ok ? r.json() : null),
        ]);
        if (resStudents) setStudents(resStudents);
        if (resParents) setParents(resParents);
        if (resGroups) setGroups(resGroups);
      } catch (error) {
        console.warn('Backend server offline. Using localStorage mock data.', error);
      }
    }
    fetchData();
  }, [page]);

  useEffect(() => {
    localStorage.setItem('crm_students', JSON.stringify(students));
  }, [students]);

  useEffect(() => {
    localStorage.setItem('crm_parents', JSON.stringify(parents));
  }, [parents]);

  useEffect(() => {
    localStorage.setItem('crm_groups', JSON.stringify(groups));
  }, [groups]);
  const [showNotifications, setShowNotifications] = useState(false);
  const info   = PAGE_TITLES[page] || {};

  // Unread notification count
  const newLeads = students.filter(s => s.status === 'lead_new');
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
        {NAV.filter(n => n.section === 'main').map(n => {
          const Icon = n.icon;
          return (
            <button
              key={n.key}
              className={`nav-item ${page === n.key ? 'active' : ''}`}
              onClick={() => setPage(n.key)}
            >
              <Icon className="nav-icon" size={18} />
              <span>{n.label}</span>
              {n.key === 'leads' && newLeadsCount > 0 && (
                <span className="nav-badge">{newLeadsCount}</span>
              )}
            </button>
          );
        })}

        {/* Nav: ops */}
        <div className="nav-section-label" style={{ marginTop: 8 }}>תפעול</div>
        {NAV.filter(n => n.section === 'ops').map(n => {
          const Icon = n.icon;
          return (
            <button
              key={n.key}
              className={`nav-item ${page === n.key ? 'active' : ''}`}
              onClick={() => setPage(n.key)}
            >
              <Icon className="nav-icon" size={18} />
              <span>{n.label}</span>
            </button>
          );
        })}

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="user-pill">
            <div className="avatar">DE</div>
            <div>
              <div className="user-name">Eyal Dalak</div>
              <div className="user-role">מנהל ראשי 🔑</div>
            </div>
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
                      {newLeads.slice(0, 5).map(l => (
                        <div 
                          key={l.id} 
                          onClick={() => { setPage('leads'); setShowNotifications(false); }}
                          style={{ fontSize: 12, padding: 8, background: '#21262D', borderRadius: 6, cursor: 'pointer', transition: 'background 0.2s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                          onMouseLeave={e => e.currentTarget.style.background = '#21262D'}
                        >
                          👤 ליד חדש: <strong>{l.name}</strong>
                          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{l.notes?.includes('אינסטגרם') ? 'פנייה מאינסטגרם 📱' : l.notes?.includes('וואטסאפ') ? 'פנייה מוואטסאפ 💬' : 'נוסף במערכת'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="page-content">
          {page === 'dashboard'  && <Dashboard students={students} groups={groups} onNavigate={setPage} />}
          {page === 'checkin'    && <CheckInConsole students={students} groups={groups} />}
          {page === 'leads'      && <Leads students={students} setStudents={setStudents} parents={parents} setParents={setParents} groups={groups} />}
          {page === 'schedule'   && <Schedule groups={groups} students={students} parents={parents} setGroups={setGroups} setStudents={setStudents} />}
          {page === 'broadcasts' && <Broadcasts parents={parents} students={students} />}
          {page === 'cash'       && <CashRegister />}
          {page === 'pricelist'  && <Pricelist />}
          {page === 'safety'     && <Safety />}
          {page === 'employees'  && <Employees />}
          {page === 'levels'     && <LevelTests students={students} groups={groups} />}
          {page === 'health'     && <HealthDeclarations parents={parents} students={students} />}
          {page === 'automations'&& <Automations />}
        </main>
      </div>
    </div>
  );
}
