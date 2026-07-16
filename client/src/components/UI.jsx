import { STATUSES } from '../mockData.js';
import { MessageSquare, CreditCard, UserCheck, Coins, UserPlus, CheckCircle2, AlertTriangle } from 'lucide-react';

const ACTIVITY_CONFIG = {
  whatsapp: { icon: MessageSquare, bg: 'rgba(16,185,129,0.1)', color: '#34D399' },
  payment:  { icon: CreditCard,   bg: 'rgba(99,102,241,0.1)', color: '#818CF8' },
  doc:      { icon: UserCheck,    bg: 'rgba(245,158,11,0.1)', color: '#FCD34D' },
  cash:     { icon: Coins,        bg: 'rgba(168,85,247,0.1)', color: '#C084FC' },
  lead:     { icon: UserPlus,     bg: 'rgba(6,182,212,0.1)',  color: '#67E8F9' },
  success:  { icon: CheckCircle2, bg: 'rgba(16,185,129,0.1)', color: '#34D399' },
  warning:  { icon: AlertTriangle,bg: 'rgba(245,158,11,0.1)', color: '#FCD34D' },
};

export function ActivityFeed({ activities }) {
  return (
    <div className="activity-feed">
      {activities.map((act, i) => {
        const cfg = ACTIVITY_CONFIG[act.type] || ACTIVITY_CONFIG.success;
        const Icon = cfg.icon;
        return (
          <div className="activity-item" key={act.id}>
            <div className="activity-dot-wrap">
              <div className="activity-dot" style={{ background: cfg.bg, color: cfg.color }}>
                <Icon size={15} />
              </div>
              {i < activities.length - 1 && <div className="activity-dot-line" />}
            </div>
            <div className="activity-body">
              <div className="activity-title">{act.title}</div>
              <div className="activity-desc">{act.desc}</div>
            </div>
            <div className="activity-time">{act.time}</div>
          </div>
        );
      })}
    </div>
  );
}

export function StatusBadge({ status }) {
  const s = STATUSES[status] || { label: status, badge: 'badge-gray' };
  return <span className={`badge ${s.badge}`}>{s.label}</span>;
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal slide-up">
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, sub, subType = '', icon: Icon, color = '#38BDF8', colorBg }) {
  const bgColor = colorBg || `${color}28`;
  return (
    <div
      className="card stat-card slide-up"
      style={{
        '--stat-color': color,
        '--stat-color-bg': bgColor,
        borderTop: `3px solid ${color}`,
        background: `linear-gradient(165deg, ${color}22 0%, transparent 42%), var(--bg-card)`,
      }}
    >
      <div className="stat-icon" style={{ background: bgColor, color }}><Icon size={18} /></div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color }}>{value}</div>
      {sub && <div className={`stat-sub ${subType}`}>{sub}</div>}
    </div>
  );
}
