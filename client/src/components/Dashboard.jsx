import React, { useState, useEffect, useMemo } from 'react';
import { Users, TrendingUp, ShieldCheck, Coins, AlertCircle, BarChart3, PieChart, CalendarDays } from 'lucide-react';
import { STATUSES } from '../mockData.js';
import { ActivityFeed, StatCard } from './UI.jsx';

const todayStr = new Date().toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

function getPipelineCounts(students) {
  const counts = {};
  Object.keys(STATUSES).forEach(k => counts[k] = 0);
  students.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });
  return counts;
}

export default function Dashboard({ students, groups, onNavigate }) {
  const [safetyPerformed, setSafetyPerformed] = useState(false);
  const [safetyWeekLogs, setSafetyWeekLogs]   = useState({});
  const [activities, setActivities]             = useState([]);
  const [employees, setEmployees]               = useState([]);

  // Calculate dynamic data for graphs
  const groupDistribution = useMemo(() => {
    const dist = {};
    (groups || []).forEach(g => {
      dist[g.name] = students.filter(s => s.groupId === g.id && s.status === 'registered').length;
    });
    return Object.entries(dist)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [students, groups]);

  const gradeDistribution = useMemo(() => {
    const grades = ['5A', '5B', '5C', '6A', '6B', '6C', '7A', '7B', '7C', '8A'];
    const dist = {};
    grades.forEach(g => dist[g] = 0);
    students.forEach(s => {
      if (s.levelGrade && dist[s.levelGrade] !== undefined) {
        dist[s.levelGrade]++;
      }
    });
    return Object.entries(dist).map(([grade, count]) => ({ grade, count }));
  }, [students]);

  useEffect(() => {
    async function loadDashboardStats() {
      try {
        const todayIso = new Date().toISOString().split('T')[0];
        
        // 1. Fetch safety inspections
        const inspections = await fetch('/api/safety/inspections').then(r => r.ok ? r.json() : []);
        const hasTodaySafety = inspections.some(i => i.date === todayIso);
        setSafetyPerformed(hasTodaySafety);

        // Map past week safety status (Sun-Sat)
        const weekStatus = {};
        for (let i = 0; i < 7; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const iso = d.toISOString().split('T')[0];
          const dayName = d.toLocaleDateString('he-IL', { weekday: 'short' });
          weekStatus[dayName] = inspections.some(insp => insp.date === iso);
        }
        setSafetyWeekLogs(weekStatus);

        // 2. Fetch employees for mapping
        const emps = await fetch('/api/employees').then(r => r.ok ? r.json() : []);
        setEmployees(emps);

        // 3. Fetch latest activity events
        const tests = await fetch('/api/level-tests').then(r => r.ok ? r.json() : []);
        const incidents = await fetch('/api/safety/incidents').then(r => r.ok ? r.json() : []);
        const waLogs = await fetch('/api/whatsapp/logs').then(r => r.ok ? r.json() : []);

        const list = [];
        
        // Map Level Tests to activity items
        tests.slice(0, 4).forEach((t, i) => {
          list.push({
            id: `act-test-${i}`,
            type: t.status === 'passed' ? 'success' : 'warning',
            title: `מבחן רמה: ${t.studentName || 'מתאמן'}`,
            desc: `נבחן לרמה ${t.grade || t.level} (${t.status === 'passed' || t.passed ? 'עבר בהצלחה' : 'לא עבר'})`,
            time: new Date(t.date || Date.now()).toLocaleDateString('he-IL')
          });
        });

        // Map Incidents to activity items
        incidents.slice(0, 2).forEach((inc, i) => {
          list.push({
            id: `act-inc-${i}`,
            type: 'warning',
            title: `דיווח בטיחות: ${inc.climber_name}`,
            desc: `אירוע: ${inc.description.slice(0, 40)}...`,
            time: new Date(inc.date).toLocaleDateString('he-IL')
          });
        });

        // Map WhatsApp logs to activity items
        waLogs.slice(0, 3).forEach((log, i) => {
          list.push({
            id: `act-wa-${i}`,
            type: 'whatsapp',
            title: `צ׳אט וואטסאפ: ${log.direction === 'inbound' ? 'התקבלה הודעה' : 'נשלחה הודעה'}`,
            desc: log.message_body?.slice(0, 40) || 'הודעת מדיה',
            time: new Date(log.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
          });
        });

        setActivities(list.slice(0, 8));

      } catch (err) {
        console.error('Error loading dashboard dynamic statistics:', err);
      }
    }
    loadDashboardStats();
  }, [students, groups]);

  const counts = getPipelineCounts(students);
  const totalStudents = students.filter(s => s.status === 'registered').length;
  const activeLeads   = students.filter(s => ['lead_new','health_signed','intro_scheduled','intro_paid'].includes(s.status)).length;

  const pipelineStages = [
    { key: 'lead_new',        color: '#818CF8' },
    { key: 'health_signed',   color: '#FCD34D' },
    { key: 'intro_scheduled', color: '#67E8F9' },
    { key: 'intro_paid',      color: '#C084FC' },
    { key: 'registered',      color: '#34D399' },
  ];

  const todayDay = new Date().getDay();
  // Include biweekly groups whose name encodes both days (e.g. ב׳+ה׳).
  const todayClasses = (groups || []).filter(g => {
    const name = g?.name || '';
    const m = name.match(/([א-ו])['׳’]?\s*\+\s*([א-ו])['׳’]?/);
    const heb = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5 };
    if (m) {
      const days = [heb[m[1]], heb[m[2]], g.day].filter(d => d != null);
      return [...new Set(days)].includes(todayDay);
    }
    return g.day === todayDay;
  });

  const maxGroupCount = Math.max(...groupDistribution.map(g => g.count), 1);
  const maxGradeCount = Math.max(...gradeDistribution.map(g => g.count), 1);

  return (
    <div className="fade-in">
      {/* Stats Row */}
      <div className="stats-grid" style={{ marginBottom: 28 }}>
        <StatCard
          label="מתאמנים רשומים פעילים"
          value={totalStudents}
          sub="חברים רשומים בקבוצות"
          subType="up"
          icon={Users}
          color="#38BDF8"
        />
        <StatCard
          label="לידים בטיפול"
          value={activeLeads}
          sub="ממתינים במשפך המכירות"
          subType="warn"
          icon={TrendingUp}
          color="#FBBF24"
        />
        <StatCard
          label="קופה יומית (סליקה)"
          value="₪2,420"
          sub="עסקאות אשראי ומזומן"
          subType="up"
          icon={Coins}
          color="#34D399"
        />
        <StatCard
          label="בדיקת בטיחות יומית"
          value={safetyPerformed ? 'בוצע' : 'לא בוצע'}
          sub={safetyPerformed ? '✓ נחתם להיום' : '⚠️ יש לחתום על בדיקה'}
          subType={safetyPerformed ? 'up' : 'down'}
          icon={ShieldCheck}
          color="#A78BFA"
        />
      </div>

      {/* Analytics & Graphs Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 300px', gap: 20, marginBottom: 28 }}>
        
        {/* Graph 1: Group Capacities */}
        <div className="card card-p">
          <div className="section-header" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={16} style={{ color: 'var(--indigo)' }} />
              <span className="section-title" style={{ fontSize: 13 }}>5 הקבוצות המובילות בקיר</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center', height: '180px' }}>
            {groupDistribution.map(g => (
              <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 85, fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', height: 12, borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ 
                    width: `${(g.count / maxGroupCount) * 100}%`, 
                    background: 'linear-gradient(90deg, #38BDF8 0%, #A78BFA 100%)', 
                    height: '100%', 
                    borderRadius: 6,
                    transition: 'width 0.5s ease'
                  }} />
                </div>
                <span style={{ width: 24, fontSize: 11, fontWeight: 'bold', textAlign: 'left' }}>{g.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Graph 2: Grades Distribution */}
        <div className="card card-p">
          <div className="section-header" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PieChart size={16} style={{ color: 'var(--emerald)' }} />
              <span className="section-title" style={{ fontSize: 13 }}>התפלגות מתאמנים לפי רמת טיפוס</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', justifyContent: 'space-between', height: '180px', paddingBottom: 10 }}>
            {gradeDistribution.map(gd => (
              <div key={gd.grade} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 6 }}>
                <span style={{ fontSize: 9, color: 'var(--text-3)' }}>{gd.count}</span>
                <div style={{ 
                  width: 14, 
                  height: `${Math.max((gd.count / maxGradeCount) * 120, 4)}px`, 
                  background: 'linear-gradient(180deg, #34D399 0%, #10B981 100%)', 
                  borderRadius: '4px 4px 0 0',
                  transition: 'height 0.5s ease'
                }} />
                <span style={{ fontSize: 10, fontWeight: 700 }}>{gd.grade}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Weekly Safety Log Tracker */}
        <div className="card card-p" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="section-header" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarDays size={16} style={{ color: 'var(--amber)' }} />
                <span className="section-title" style={{ fontSize: 13 }}>בקרת בטיחות שבועית</span>
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 14 }}>
              מעקב שבועי אחר חתימות הבטיחות היומיות של המדריך האחראי
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingInline: 4, marginBottom: 10 }}>
            {Object.entries(safetyWeekLogs).map(([dayName, checked]) => (
              <div key={dayName} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--text-2)', fontWeight: 'bold' }}>{dayName}</span>
                <div style={{ 
                  width: 24, height: 24, borderRadius: '50%',
                  background: checked ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${checked ? '#10B981' : '#EF4444'}`,
                  color: checked ? '#10B981' : '#EF4444',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 'bold'
                }}>
                  {checked ? '✓' : '✕'}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Pipeline Bar */}
      <div className="card card-p" style={{ marginBottom: 28 }}>
        <div className="section-header">
          <div>
            <div className="section-title">מצב משפך הלקוחות</div>
            <div className="section-sub">התפלגות מתאמנים ולידים לפי שלב בתהליך הקליטה</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('leads')}>
            ניהול לידים ←
          </button>
        </div>
        <div className="pipeline">
          {pipelineStages.map(ps => (
            <div className="pipeline-stage" key={ps.key} onClick={() => onNavigate('leads')}>
              <span className="pipeline-count" style={{ color: ps.color }}>{counts[ps.key]}</span>
              {STATUSES[ps.key].label}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid-21" style={{ gap: 20 }}>
        {/* Today's Classes */}
        <div className="card card-p">
          <div className="section-header">
            <div>
              <div className="section-title">שיעורים היום — {todayStr}</div>
              <div className="section-sub">
                {todayClasses.length > 0 ? `${todayClasses.length} שיעורי חוגים מתוכננים להיום` : 'אין חוגים מתוכננים להיום'}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('schedule')}>לוח חוגים →</button>
          </div>

          {todayClasses.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}>
              <div className="empty-state-icon">🧗</div>
              <div className="empty-state-title">אין חוגים פעילים היום</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>שם קבוצה</th>
                    <th>שעה</th>
                    <th>מדריך</th>
                    <th>מקומות תפוסים</th>
                    <th>פעולה</th>
                  </tr>
                </thead>
                <tbody>
                  {todayClasses.map(g => {
                    const enrolledCount = students.filter(s => s.groupId === g.id && s.status === 'registered').length;
                    const trainerObj = employees.find(e => e.id === g.trainer);
                    return (
                      <tr key={g.id}>
                        <td style={{ fontWeight: 700 }}>{g.name}</td>
                        <td>{g.time}</td>
                        <td>{trainerObj ? trainerObj.name : 'לא שובץ'}</td>
                        <td>
                          <span className={enrolledCount >= g.maxSlots ? 'badge badge-red' : 'badge badge-green'}>
                            {enrolledCount}/{g.maxSlots}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-xs" onClick={() => onNavigate('schedule')}>נוכחות</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            {groups.filter(g => students.filter(s => s.groupId === g.id && s.status === 'registered').length >= g.maxSlots).length > 0 && (
              <div className="alert alert-warn" style={{ marginBottom: 8 }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  קבוצות בתפוסה מלאה! מומלץ להפנות נרשמים חדשים לרשימות ההמתנה.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="card card-p">
          <div className="section-header">
            <div className="section-title">לוג פעילות ואירועים (זמן אמת)</div>
          </div>
          {activities.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-3)' }}>אין פעילות רשומה</div>
          ) : (
            <ActivityFeed activities={activities} />
          )}
        </div>
      </div>
    </div>
  );
}
