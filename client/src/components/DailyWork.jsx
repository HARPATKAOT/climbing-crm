import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  MessageSquare,
  RefreshCw,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react';
import { STATUSES } from '../statusConfig.js';
import { buildLeadEntries, isParentOnlyLead } from '../utils/leadUtils.js';
import { useAuth } from './AuthGate.jsx';
import TaskCenter from './dailywork/TaskCenter.jsx';
import MessagesSection from './dailywork/MessagesSection.jsx';
import TodaySalesDrawer from './dailywork/TodaySalesDrawer.jsx';
import FunnelDrawer from './dailywork/FunnelDrawer.jsx';

const StudentFilePanel = lazy(() => import('./StudentFilePanel.jsx'));

const INTRO_STATUSES = new Set(['intro_scheduled', 'intro_paid']);
/** אותם שלבים שהשרת מחזיר (FUNNEL_STAGES), לשלד שנצבע לפני שהנתונים חוזרים. */
const FUNNEL_PLACEHOLDER = [
  'lead_new',
  'details_completed',
  'health_signed',
  'pending_signup',
  'intro_scheduled',
  'intro_paid',
  'registered',
];

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

function shekel(value) {
  return `₪${Number(value || 0).toLocaleString('he-IL')}`;
}

function displayName(entry) {
  return entry.student?.name || entry.parent?.name || 'פנייה ללא שם';
}

/** כרטיס KPI לחיץ: אותו מראה כמו StatCard, אבל כל הכרטיס פותח את הנתונים שמאחוריו. */
function KpiCard({ label, value, sub, subType = '', icon: Icon, color, onClick, chips, ariaLabel }) {
  return (
    <div
      className="card stat-card slide-up dw-kpi"
      role="button"
      tabIndex={0}
      aria-label={ariaLabel || label}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
      style={{
        '--stat-color': color,
        borderTop: `3px solid ${color}`,
        background: `linear-gradient(165deg, ${color}22 0%, transparent 42%), var(--bg-card)`,
      }}
    >
      <div className="stat-icon" style={{ background: `${color}28`, color }}><Icon size={18} /></div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {sub && <div className={`stat-sub ${subType}`}>{sub}</div>}
      {chips && (
        <div className="dw-kpi-chips" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          {chips}
        </div>
      )}
    </div>
  );
}

/**
 * מקטע עבודה: עם פריטים — רשימה מלאה; בלי פריטים — מתכווץ לשורת „הכול טופל”
 * אחת; בטעינה — שלד.
 */
function WorkSection({ icon: Icon, title, count, empty, loading = false, children, tone = '#38BDF8', innerRef }) {
  if (!loading && count === 0) {
    return (
      <section className="card" ref={innerRef}>
        <div className="dw-collapsed is-ok">
          <Check size={14} />
          <h2>{title}:</h2>
          {empty}
        </div>
      </section>
    );
  }
  return (
    <section className="card daily-work-section" ref={innerRef}>
      <header className="daily-work-section-header">
        <div className="daily-work-section-title">
          <span className="daily-work-section-icon" style={{ color: tone, background: `${tone}1f` }}>
            <Icon size={18} />
          </span>
          <div>
            <h2>{title}</h2>
            <span>{loading ? 'טוען…' : `${count} לטיפול`}</span>
          </div>
        </div>
      </header>
      <div className="daily-work-list">
        {loading ? (
          <>
            <div className="dw-skeleton-row" />
            <div className="dw-skeleton-row" />
          </>
        ) : children}
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

function updatedAgoLabel(lastUpdated) {
  if (!lastUpdated) return '';
  const minutes = Math.round((Date.now() - lastUpdated.getTime()) / 60000);
  if (minutes < 1) return 'עודכן עכשיו';
  return `עודכן לפני ${minutes} דק׳`;
}

export default function DailyWork({
  students = [],
  parents = [],
  groups = [],
  setStudents,
  setParents,
  onNavigate,
}) {
  const { user, isOwner } = useAuth() || {};
  const canFinance = Boolean(isOwner || user?.sensitive?.finance === true);

  const [stats, setStats] = useState({});
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [statsError, setStatsError] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [placementRequests, setPlacementRequests] = useState([]);
  const [queuesLoaded, setQueuesLoaded] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, setAgoTick] = useState(0);
  const [notice, setNotice] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [studentFileId, setStudentFileId] = useState(null);

  const messagesRef = useRef(null);
  const followupsRef = useRef(null);
  const refreshCounter = useRef(0);

  const showNotice = useCallback((value) => {
    setNotice(value);
    if (value) {
      window.clearTimeout(showNotice.timer);
      showNotice.timer = window.setTimeout(() => setNotice(null), 7000);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/stats');
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error(body?.error || 'טעינת הנתונים נכשלה');
      setStats(body);
      setStatsError('');
    } catch (err) {
      // נתונים ישנים עדיפים על מסך ריק — לא מוחקים את מה שכבר מוצג.
      setStatsError(err.message || 'טעינת הנתונים נכשלה');
    } finally {
      setStatsLoaded(true);
    }
  }, []);

  const fetchQueues = useCallback(async () => {
    const load = (url, apply) => fetch(url)
      .then((response) => (response.ok ? response.json() : []))
      .then((data) => apply(Array.isArray(data) ? data : []))
      .catch(() => {});
    await Promise.all([
      load('/api/ai/suggestions?status=pending', setSuggestions),
      load('/api/tasks?status=open', setTasks),
      load('/api/placement-requests?status=pending', setPlacementRequests),
    ]);
    setQueuesLoaded(true);
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations?limit=300');
      const body = await response.json().catch(() => null);
      const rows = Array.isArray(body) ? body : body?.conversations;
      if (response.ok && Array.isArray(rows)) setConversations(rows);
    } catch {
      // שומרים את הרשימה הקודמת.
    } finally {
      setConversationsLoaded(true);
    }
  }, []);

  /** רענון של נתוני הליבה (מתאמנים והורים) שמגיעים מהאפליקציה — פעם בכמה דקות. */
  const refreshCore = useCallback(async () => {
    if (!setStudents || !setParents) return;
    if (!students.length && !parents.length) return;
    try {
      const [studentsResponse, parentsResponse] = await Promise.all([
        fetch('/api/students'),
        fetch('/api/parents'),
      ]);
      if (!studentsResponse.ok || !parentsResponse.ok) return;
      const [freshStudents, freshParents] = await Promise.all([
        studentsResponse.json().catch(() => null),
        parentsResponse.json().catch(() => null),
      ]);
      if (Array.isArray(freshStudents)) setStudents(freshStudents);
      if (Array.isArray(freshParents)) setParents(freshParents);
    } catch {
      // רענון רקע — כישלון שקט.
    }
  }, [parents.length, setParents, setStudents, students.length]);

  const refreshAll = useCallback(async ({ manual = false, includeCore = false } = {}) => {
    if (manual) setRefreshing(true);
    await Promise.all([
      fetchStats(),
      fetchQueues(),
      fetchConversations(),
      includeCore ? refreshCore() : Promise.resolve(),
    ]);
    setLastUpdated(new Date());
    if (manual) setRefreshing(false);
  }, [fetchConversations, fetchQueues, fetchStats, refreshCore]);

  useEffect(() => {
    refreshAll();
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshCounter.current += 1;
      // ליבה כבדה יותר — פעם בחמישה סבבים (5 דקות); כל השאר כל דקה.
      refreshAll({ includeCore: refreshCounter.current % 5 === 0 });
    }, 60000);
    const ticker = window.setInterval(() => setAgoTick((value) => value + 1), 30000);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(ticker);
    };
    // refreshAll יציב (useCallback) — טעינה ראשונה + מחזור קבוע.
  }, [refreshAll]);

  const entries = useMemo(() => buildLeadEntries(students, parents), [parents, students]);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const pendingConversations = useMemo(
    () => conversations
      .filter((row) => row.awaiting)
      .sort((a, b) => String(b.lastMessageAt || '').localeCompare(String(a.lastMessageAt || ''))),
    [conversations]
  );

  const dueFollowups = useMemo(() => entries
    .filter((entry) => {
      const followup = dateValue(entry.student?.nextFollowup);
      return followup && followup < tomorrow;
    })
    .sort((a, b) => dateValue(a.student.nextFollowup) - dateValue(b.student.nextFollowup)),
  // tomorrow נגזר מהיום — מתחלף רק עם רינדור חדש ממילא.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [entries]);
  const parentOnly = useMemo(() => entries.filter((entry) => isParentOnlyLead(entry.student)), [entries]);
  const introActions = useMemo(() => entries.filter((entry) => INTRO_STATUSES.has(entry.student?.status)), [entries]);

  const dailySales = stats?.dailySales || null;
  const funnel = stats?.funnel || null;
  const loadedStages = Array.isArray(funnel?.stages) ? funnel.stages : [];
  const funnelStages = loadedStages.length
    ? loadedStages
    : FUNNEL_PLACEHOLDER.map((status) => ({ status, count: null }));
  const maxStageCount = Math.max(1, ...funnelStages.map((stage) => Number(stage.count) || 0));

  /**
   * „פניות פעילות” נגזרות מאותם מספרים של המשפך עצמו — סכום השלבים ללא „חוג
   * פעיל”. כך הכותרת וסכום המשפך לא יכולים להתפצל שוב.
   */
  const activeLeadsCount = loadedStages.length
    ? loadedStages.filter((stage) => stage.status !== 'registered').reduce((sum, stage) => sum + (Number(stage.count) || 0), 0)
    : null;
  const registeredFamilies = Number(funnel?.byStatus?.registered || 0);
  const waitlistFamilies = Number(funnel?.waitlistFamilies || 0);

  const progressionByStatus = useMemo(() => {
    const map = new Map();
    for (const row of funnel?.progression || []) map.set(row.status, row);
    return map;
  }, [funnel]);

  /** השלב שהכי הרבה משפחות נתקעות בו: שיעור ההתקדמות הנמוך ביותר, על מדגם מספיק. */
  const bottleneckStatus = useMemo(() => {
    let worst = null;
    for (const row of funnel?.progression || []) {
      if (row.status === 'registered' || row.reached < 5 || row.rate === null) continue;
      if (!worst || row.rate < worst.rate) worst = row;
    }
    return worst?.status || null;
  }, [funnel]);

  const conversion = stats?.conversion;
  const funnelNote = (() => {
    if (!statsLoaded) return 'טוען נתוני המרה';
    if (!loadedStages.length) return 'נתוני המשפך אינם זמינים';
    return conversion
      ? `${Math.round(Number(conversion.rate || 0) * 100)}% המרה מאז תחילת המדידה`
      : 'מדידת ההמרה מתחילה כעת';
  })();

  const openEntry = useCallback((entry) => setStudentFileId(entry.key), []);

  const openParentCard = useCallback((parentId) => {
    if (!parentId) return undefined;
    const entry = entries.find((item) => String(item.parent?.id) === String(parentId));
    if (!entry) return undefined;
    return () => openEntry(entry);
  }, [entries, openEntry]);

  const openConversationCard = useCallback((conversation) => {
    const open = openParentCard(conversation.parentId);
    if (open) open();
    else onNavigate?.(`/leads?open=${encodeURIComponent(`parent:${conversation.parentId}`)}`);
  }, [onNavigate, openParentCard]);

  const openFamilyCard = useCallback((family) => {
    setDrawer(null);
    const key = String(family.open_key || '');
    if (entries.some((entry) => String(entry.key) === key)) setStudentFileId(key);
    else onNavigate?.(`/leads?open=${encodeURIComponent(key)}`);
  }, [entries, onNavigate]);

  /** פתיחת תיק הלקוח משורת עסקה — המגירה נשארת פתוחה מתחת, וחוזרים אליה בסגירה. */
  const openSaleCustomer = useCallback((row) => {
    const studentKey = row.student_id ? String(row.student_id) : '';
    if (studentKey && entries.some((entry) => String(entry.key) === studentKey)) {
      setStudentFileId(studentKey);
      return;
    }
    const open = openParentCard(row.parent_id);
    if (open) open();
    else if (row.parent_id) onNavigate?.(`/leads?open=${encodeURIComponent(`parent:${row.parent_id}`)}`);
  }, [entries, onNavigate, openParentCard]);

  /** סימון שיחה כטופלה — אופטימי: השורה יורדת מיד וחוזרת אם השרת נכשל. */
  const markConversationHandled = useCallback(async (conversation) => {
    const previous = conversations;
    setConversations((current) => current.map((row) => (
      String(row.parentId) === String(conversation.parentId) ? { ...row, awaiting: false, unread: 0 } : row
    )));
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.parentId)}/handled`, { method: 'POST' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error || 'הסימון נכשל');
      const updates = new Map((result.parents || []).map((parent) => [String(parent.id), parent]));
      setParents?.((current) => current.map((parent) => {
        const updated = updates.get(String(parent.id));
        if (updated) return { ...parent, ...updated };
        if (String(parent.id) === String(conversation.parentId) && result.handledAt) {
          return { ...parent, communication_handled_at: result.handledAt };
        }
        return parent;
      }));
    } catch (err) {
      setConversations(previous);
      showNotice({ type: 'error', text: `סימון השיחה כטופלה נכשל: ${err.message}` });
    }
  }, [conversations, setParents, showNotice]);

  const onTransferred = useCallback((conversation, employee, createdTask) => {
    if (createdTask) setTasks((current) => [...current, createdTask]);
    markConversationHandled(conversation);
    showNotice({ type: 'success', text: `השיחה עם ${conversation.name} הועברה ל${employee.name} ונוצרה משימה.` });
  }, [markConversationHandled, showNotice]);

  const scrollToSection = (ref) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const headingDate = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="fade-in daily-work">
      <div className="daily-work-heading">
        <div>
          <h1>העבודה שלי להיום</h1>
          <p>{headingDate}</p>
        </div>
        <div className="dw-heading-meta">
          <span aria-live="polite">{updatedAgoLabel(lastUpdated)}</span>
          <button
            type="button"
            className="icon-btn"
            title="רענון הנתונים"
            aria-label="רענון הנתונים"
            onClick={() => refreshAll({ manual: true, includeCore: true })}
          >
            <RefreshCw size={15} className={refreshing ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      {statsError && statsLoaded && !loadedStages.length && (
        <div className="dw-error-box" style={{ margin: '0 0 16px' }}>
          <span>{statsError}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => refreshAll({ manual: true })}>נסה שוב</button>
        </div>
      )}

      {notice && (
        <div className={`alert alert-${notice.type}`} style={{ marginBottom: 16 }}>
          {notice.text}
        </div>
      )}

      <div className="stats-grid daily-work-stats">
        {(!statsLoaded || dailySales) && (
          <KpiCard
            label="הכנסות היום"
            value={statsLoaded ? shekel(dailySales?.total) : '—'}
            sub={statsLoaded
              ? `${Number(dailySales?.count || 0)} עסקאות${Number.isFinite(Number(dailySales?.yesterdayTotal)) ? ` · אתמול ${shekel(dailySales.yesterdayTotal)}` : ''}`
              : 'טוען…'}
            subType={Number(dailySales?.total || 0) >= Number(dailySales?.yesterdayTotal || 0) ? 'up' : ''}
            icon={CircleDollarSign}
            color="#34D399"
            ariaLabel="הכנסות היום — פתיחת רשימת העסקאות"
            onClick={() => setDrawer({ type: 'sales', filter: 'all' })}
            chips={statsLoaded && (
              <>
                <button type="button" className="dw-chip" onClick={() => setDrawer({ type: 'sales', filter: 'cash' })}>
                  מזומן {shekel(dailySales?.cash)}
                </button>
                <button type="button" className="dw-chip" onClick={() => setDrawer({ type: 'sales', filter: 'online' })}>
                  סליקה {shekel(dailySales?.online)}
                </button>
                {Number(dailySales?.openCharges?.count || 0) > 0 && (
                  <button
                    type="button"
                    className="dw-chip"
                    style={{ color: '#FCD34D', borderColor: 'rgba(251,191,36,0.35)' }}
                    onClick={() => setDrawer({ type: 'sales', filter: 'pending' })}
                  >
                    {dailySales.openCharges.count} חיובים פתוחים · {shekel(dailySales.openCharges.total)}
                  </button>
                )}
              </>
            )}
          />
        )}
        <KpiCard
          label="הודעות ממתינות"
          value={conversationsLoaded ? pendingConversations.length : '—'}
          sub={pendingConversations.length ? 'שיחות שמחכות למענה — לחיצה לרשימה' : '✓ כל השיחות נענו'}
          subType={pendingConversations.length ? 'warn' : 'up'}
          icon={MessageSquare}
          color={pendingConversations.length ? '#FBBF24' : '#34D399'}
          ariaLabel="הודעות ממתינות — מעבר לרשימת ההודעות"
          onClick={() => scrollToSection(messagesRef)}
        />
        <KpiCard
          label="מעקבים להיום ובאיחור"
          value={dueFollowups.length}
          sub={dueFollowups.length ? 'פעולות שהגיע זמנן — לחיצה לרשימה' : '✓ אין מעקבים באיחור'}
          subType={dueFollowups.length ? 'down' : 'up'}
          icon={CalendarClock}
          color={dueFollowups.length ? '#F87171' : '#34D399'}
          ariaLabel="מעקבים — מעבר לרשימת המעקבים"
          onClick={() => scrollToSection(followupsRef)}
        />
        <KpiCard
          label="פניות פעילות"
          value={activeLeadsCount === null ? '—' : activeLeadsCount}
          sub={activeLeadsCount === null
            ? (statsLoaded ? 'נתוני המשפך אינם זמינים' : 'טוען…')
            : `משפחות במשפך · עוד ${registeredFamilies} בחוג פעיל`}
          icon={UsersRound}
          color="#A78BFA"
          ariaLabel="פניות פעילות — פתיחת הלידים לפי שלב"
          onClick={() => setDrawer({ type: 'funnel', stage: 'all' })}
        />
      </div>

      <section className="card daily-work-funnel">
        <div className="daily-work-funnel-heading">
          <div>
            <h2>משפך המכירה</h2>
            <span>משפחה נספרת פעם אחת, לפי השלב המתקדם ביותר · לחיצה על שלב פותחת את הלידים שבו</span>
          </div>
          <div className="daily-work-conversion">{funnelNote}</div>
        </div>
        <div className="dw-funnel-strip">
          {funnelStages.map((stage, index) => {
            const meta = STATUSES[stage.status] || { label: stage.status, color: '#9DA5BE' };
            const StageIcon = meta.icon || UsersRound;
            const count = stage.count;
            const progression = progressionByStatus.get(stage.status);
            const rate = progression?.rate ?? null;
            const rateClass = rate === null
              ? 'dw-rate-none'
              : rate >= 0.6 ? 'dw-rate-good' : rate >= 0.3 ? 'dw-rate-mid' : 'dw-rate-low';
            const isBottleneck = stage.status === bottleneckStatus;
            return (
              <React.Fragment key={stage.status}>
                <div
                  className={`dw-funnel-stage ${count === 0 ? 'is-empty' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${meta.label}: ${count ?? '—'} משפחות — פתיחת הרשימה`}
                  onClick={() => setDrawer({ type: 'funnel', stage: stage.status })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setDrawer({ type: 'funnel', stage: stage.status });
                    }
                  }}
                >
                  <span className="dw-funnel-stage-icon" style={{ color: meta.color, background: `${meta.color}1f` }}>
                    <StageIcon size={15} />
                  </span>
                  <strong style={{ color: meta.color }}>{count === null ? '—' : count}</strong>
                  <span className="dw-funnel-label">{meta.label}</span>
                  <span className="dw-funnel-bar">
                    <i style={{ width: `${Math.round(((Number(count) || 0) / maxStageCount) * 100)}%`, background: meta.color }} />
                  </span>
                </div>
                {index < funnelStages.length - 1 && (
                  <div className="dw-funnel-gap">
                    <span
                      className={`dw-funnel-rate ${rateClass} ${isBottleneck ? 'is-bottleneck' : ''}`}
                      title={progression
                        ? `${progression.advanced} מתוך ${progression.reached} משפחות שהגיעו ל„${meta.label}” התקדמו הלאה${isBottleneck ? ' — כאן נתקעים הכי הרבה' : ''}`
                        : 'אין עדיין נתוני מעבר לשלב הזה'}
                    >
                      {rate === null ? '—' : `${Math.round(rate * 100)}%`}
                      <ChevronRight size={10} style={{ transform: 'scaleX(-1)' }} />
                    </span>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
        <div className="dw-funnel-foot">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {waitlistFamilies > 0 && (
              <button type="button" className="dw-chip" onClick={() => setDrawer({ type: 'funnel', stage: 'waitlist' })}>
                <Clock3 size={11} style={{ color: STATUSES.waitlist.color }} />
                רשימת המתנה · {waitlistFamilies} משפחות
              </button>
            )}
          </div>
          <span className="dw-funnel-foot-note">
            {bottleneckStatus
              ? `הכי הרבה נתקעים בשלב „${STATUSES[bottleneckStatus]?.label}”`
              : 'אחוזי המעבר נמדדים מאז תחילת מעקב הסטטוסים'}
          </span>
        </div>
      </section>

      <div className="daily-work-grid">
        <TaskCenter
          placements={placementRequests}
          setPlacements={setPlacementRequests}
          suggestions={suggestions}
          setSuggestions={setSuggestions}
          tasks={tasks}
          setTasks={setTasks}
          loaded={queuesLoaded}
          openParentCard={openParentCard}
          onNotice={showNotice}
        />

        <MessagesSection
          conversations={pendingConversations}
          loaded={conversationsLoaded}
          sectionRef={messagesRef}
          onOpenCard={openConversationCard}
          onHandled={markConversationHandled}
          onTransferred={onTransferred}
          onNotice={showNotice}
        />

        <WorkSection
          icon={Clock3}
          title="מעקבים שהגיע זמנם"
          count={dueFollowups.length}
          empty="אין מעקבים להיום — הכול סגור"
          tone="#F87171"
          innerRef={followupsRef}
        >
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

        <WorkSection
          icon={UserRoundPlus}
          title="פניות ללא מתאמן"
          count={parentOnly.length}
          empty="לכל הפניות קיים מתאמן"
          tone="#38BDF8"
        >
          {parentOnly.map((entry) => (
            <WorkRow key={entry.key} entry={entry} meta={entry.parent?.phone || entry.parent?.email} badge="חסר מתאמן" onOpen={openEntry} />
          ))}
        </WorkSection>

        <WorkSection
          icon={CalendarClock}
          title="אימוני היכרות שדורשים פעולה"
          count={introActions.length}
          empty="אין אימוני היכרות שמחכים לפעולה"
          tone="#C084FC"
        >
          {introActions.map((entry) => {
            const group = groups.find((item) => String(item.id) === String(entry.student?.groupId));
            const badge = entry.student.status === 'intro_paid' ? 'שולם · מחכה לאימון' : 'נקבע אימון';
            return <WorkRow key={entry.key} entry={entry} meta={group?.name || entry.parent?.phone} badge={badge} onOpen={openEntry} />;
          })}
        </WorkSection>
      </div>

      {drawer?.type === 'sales' && (
        <TodaySalesDrawer
          initialFilter={drawer.filter}
          isOwner={Boolean(isOwner)}
          onClose={() => setDrawer(null)}
          onMoneyChanged={() => { fetchStats(); setLastUpdated(new Date()); }}
          onOpenCustomer={openSaleCustomer}
        />
      )}
      {drawer?.type === 'funnel' && (
        <FunnelDrawer
          initialStage={drawer.stage}
          funnelCounts={funnel?.byStatus || {}}
          waitlistCount={waitlistFamilies}
          onClose={() => setDrawer(null)}
          onOpenCard={openFamilyCard}
          onChanged={() => { fetchStats(); refreshCore(); }}
        />
      )}

      {/* תיק הלקוח נפתח כשכבה מעל המסך — הטיפול נעשה מכאן, בלי לעזוב. */}
      {studentFileId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 600 }}>
          <Suspense fallback={null}>
            <StudentFilePanel
              studentId={studentFileId}
              students={students}
              parents={parents}
              groups={groups}
              setStudents={setStudents}
              setParents={setParents}
              canManageBilling={canFinance}
              onClose={() => setStudentFileId(null)}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
