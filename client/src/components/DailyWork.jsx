import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  CircleDollarSign,
  Clock3,
  MessageSquare,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react';
import { StatCard } from './UI.jsx';
import { isAwaitingHandling, latestInboundTime } from './communicationQueue.js';
import { buildLeadEntries, isParentOnlyLead } from '../utils/leadUtils.js';
import { STATUSES } from '../mockData.js';

const ACTIVE_LEAD_STATUSES = new Set([
  'lead_new',
  'health_signed',
  'intro_scheduled',
  'intro_paid',
  'waitlist',
]);
const INTRO_STATUSES = new Set(['intro_scheduled', 'intro_paid']);

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfToday() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function formatFollowup(value) {
  const parsed = dateValue(value);
  if (!parsed) return value || '';
  return parsed.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}

function revenueFromStats(stats) {
  const candidates = [
    stats?.dailySales?.total,
    stats?.todayRevenue,
    stats?.revenueToday,
    stats?.dailyRevenue,
    stats?.revenue_today,
    stats?.today?.revenue,
    stats?.payments?.today,
  ];
  const value = candidates.find((candidate) => Number.isFinite(Number(candidate)));
  return Number(value || 0);
}

function displayName(entry) {
  return entry.student?.name || entry.parent?.name || 'פנייה ללא שם';
}

function leadPath(entry) {
  return `/leads?open=${encodeURIComponent(entry.key)}`;
}

function WorkSection({ icon: Icon, title, count, empty, children, tone = '#38BDF8' }) {
  return (
    <section className="card daily-work-section">
      <header className="daily-work-section-header">
        <div className="daily-work-section-title">
          <span className="daily-work-section-icon" style={{ color: tone, background: `${tone}1f` }}>
            <Icon size={18} />
          </span>
          <div>
            <h2>{title}</h2>
            <span>{count} לטיפול</span>
          </div>
        </div>
      </header>
      <div className="daily-work-list">
        {count ? children : <div className="daily-work-empty"><Check size={16} /> {empty}</div>}
      </div>
    </section>
  );
}

function WorkRow({ entry, meta, badge, onOpen, action }) {
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(entry);
    }
  };
  return (
    <div className="daily-work-row" role="button" tabIndex={0} onClick={() => onOpen(entry)} onKeyDown={handleKeyDown}>
      <div className="daily-work-row-copy">
        <strong>{displayName(entry)}</strong>
        {entry.student?.name && entry.parent?.name && <span>{entry.parent.name}</span>}
        {meta && <small>{meta}</small>}
      </div>
      <div className="daily-work-row-actions" onKeyDown={(event) => event.stopPropagation()}>
        {badge && <span className="badge badge-amber">{badge}</span>}
        {action}
      </div>
    </div>
  );
}

export default function DailyWork({
  students = [],
  parents = [],
  groups = [],
  setParents,
  onNavigate,
}) {
  const [stats, setStats] = useState({});
  const [markingId, setMarkingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/dashboard/stats')
      .then((response) => (response.ok ? response.json() : {}))
      .then((data) => {
        if (!cancelled) setStats(data || {});
      })
      .catch(() => {
        if (!cancelled) setStats({});
      });
    return () => { cancelled = true; };
  }, []);

  const entries = useMemo(() => buildLeadEntries(students, parents), [parents, students]);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const pendingParents = useMemo(
    () => parents
      .filter(isAwaitingHandling)
      .sort((a, b) => latestInboundTime(b) - latestInboundTime(a)),
    [parents]
  );
  const pendingEntries = pendingParents.map((parent) => (
    entries.find((entry) => String(entry.parent?.id) === String(parent.id))
    || buildLeadEntries([], [parent])[0]
  )).filter(Boolean);

  const dueFollowups = entries
    .filter((entry) => {
      const followup = dateValue(entry.student?.nextFollowup);
      return followup && followup < tomorrow;
    })
    .sort((a, b) => dateValue(a.student.nextFollowup) - dateValue(b.student.nextFollowup));
  const parentOnly = entries.filter((entry) => isParentOnlyLead(entry.student));
  const introActions = entries.filter((entry) => INTRO_STATUSES.has(entry.student?.status));
  const activeLeads = entries.filter((entry) => ACTIVE_LEAD_STATUSES.has(entry.student?.status));
  const dailySales = stats?.dailySales || {};
  const conversion = stats?.conversion;
  const funnelStages = Array.isArray(stats?.funnel?.stages) ? stats.funnel.stages : [];

  const openEntry = (entry) => onNavigate?.(leadPath(entry));

  const markHandled = async (event, entry) => {
    event.stopPropagation();
    const parentId = entry.parent?.id;
    if (!parentId || markingId) return;
    setMarkingId(parentId);
    try {
      const response = await fetch(`/api/conversations/${parentId}/handled`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error('mark failed');
      const updates = new Map((result.parents || []).map((parent) => [String(parent.id), parent]));
      setParents?.((current) => current.map((parent) => {
        const updated = updates.get(String(parent.id));
        if (updated) return { ...parent, ...updated };
        if (String(parent.id) === String(parentId) && result.handledAt) {
          return { ...parent, communication_handled_at: result.handledAt };
        }
        return parent;
      }));
    } catch (error) {
      console.error('Failed to mark conversation handled:', error);
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div className="fade-in daily-work">
      <div className="daily-work-heading">
        <div>
          <h1>העבודה שלי להיום</h1>
          <p>{new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
      </div>

      <div className="stats-grid daily-work-stats">
        <StatCard
          label="הכנסות היום"
          value={`₪${revenueFromStats(stats).toLocaleString('he-IL')}`}
          sub={`${Number(dailySales.count || 0)} עסקאות · מזומן ₪${Number(dailySales.cash || 0).toLocaleString('he-IL')} · סליקה ₪${Number(dailySales.online || 0).toLocaleString('he-IL')}`}
          icon={CircleDollarSign}
          color="#34D399"
        />
        <StatCard label="הודעות ממתינות" value={pendingEntries.length} sub="שיחות שמחכות למענה" subType={pendingEntries.length ? 'warn' : 'up'} icon={MessageSquare} color="#FBBF24" />
        <StatCard label="מעקבים להיום ובאיחור" value={dueFollowups.length} sub="פעולות שהגיע זמנן" subType={dueFollowups.length ? 'down' : 'up'} icon={CalendarClock} color="#F87171" />
        <StatCard label="פניות פעילות" value={activeLeads.length} sub="פניות שעדיין בתהליך" icon={UsersRound} color="#A78BFA" />
      </div>

      {funnelStages.length > 0 && (
        <section className="card daily-work-funnel">
          <div className="daily-work-funnel-heading">
            <div>
              <h2>מצב משפך המכירה</h2>
              <span>משפחה נספרת פעם אחת, לפי השלב המתקדם ביותר</span>
            </div>
            <div className="daily-work-conversion">
              {conversion
                ? `${Math.round(Number(conversion.rate || 0) * 100)}% המרה מאז תחילת המדידה`
                : 'מדידת ההמרה מתחילה כעת'}
            </div>
          </div>
          <div className="daily-work-funnel-stages">
            {funnelStages.map((stage) => (
              <div key={stage.status}>
                <strong>{Number(stage.count || 0)}</strong>
                <span>{STATUSES[stage.status]?.label || stage.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="daily-work-grid">
        <WorkSection icon={MessageSquare} title="הודעות ממתינות" count={pendingEntries.length} empty="אין הודעות שממתינות לטיפול" tone="#FBBF24">
          {pendingEntries.map((entry) => (
            <WorkRow
              key={entry.key}
              entry={entry}
              meta={entry.parent?.phone}
              onOpen={openEntry}
              action={(
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={markingId === entry.parent?.id}
                  onClick={(event) => markHandled(event, entry)}
                >
                  <Check size={14} /> טופל
                </button>
              )}
            />
          ))}
        </WorkSection>

        <WorkSection icon={Clock3} title="מעקבים שהגיע זמנם" count={dueFollowups.length} empty="אין מעקבים להיום" tone="#F87171">
          {dueFollowups.map((entry) => {
            const followup = dateValue(entry.student.nextFollowup);
            const overdue = followup < today;
            return (
              <WorkRow
                key={entry.key}
                entry={entry}
                meta={entry.parent?.phone}
                badge={`${overdue ? 'באיחור · ' : 'היום · '}${formatFollowup(entry.student.nextFollowup)}`}
                onOpen={openEntry}
              />
            );
          })}
        </WorkSection>

        <WorkSection icon={UserRoundPlus} title="פניות ללא מתאמן" count={parentOnly.length} empty="לכל הפניות קיים מתאמן" tone="#38BDF8">
          {parentOnly.map((entry) => (
            <WorkRow key={entry.key} entry={entry} meta={entry.parent?.phone || entry.parent?.email} badge="חסר מתאמן" onOpen={openEntry} />
          ))}
        </WorkSection>

        <WorkSection icon={CalendarClock} title="אימוני היכרות שדורשים פעולה" count={introActions.length} empty="אין אימוני היכרות שמחכים לפעולה" tone="#C084FC">
          {introActions.map((entry) => {
            const group = groups.find((item) => String(item.id) === String(entry.student?.groupId));
            const badge = entry.student.status === 'intro_paid' ? 'שולם · מחכה לאימון' : 'נקבע אימון';
            return <WorkRow key={entry.key} entry={entry} meta={group?.name || entry.parent?.phone} badge={badge} onOpen={openEntry} />;
          })}
        </WorkSection>
      </div>
    </div>
  );
}
