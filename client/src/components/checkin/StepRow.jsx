import React from 'react';
import { CheckCircle2, Circle, Clock } from 'lucide-react';

/** שלב אחד באשף הפתיחה: בוצע / הבא בתור / עוד לא. */
export default function StepRow({ done, current, title, children }) {
  const Icon = done ? CheckCircle2 : current ? Clock : Circle;
  const color = done ? 'var(--green)' : current ? '#FBBF24' : 'var(--text-3)';
  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 12,
      border: `1px solid ${done ? 'rgba(16,185,129,0.35)' : current ? 'rgba(251,191,36,0.4)' : 'var(--border)'}`,
      background: done ? 'rgba(16,185,129,0.06)' : current ? 'rgba(251,191,36,0.06)' : 'transparent',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      opacity: done || current ? 1 : 0.65,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, color }}>
        <Icon size={18} />
        {title}
        {done && <span className="badge badge-green" style={{ marginInlineStart: 'auto', fontSize: 11 }}>בוצע</span>}
        {!done && current && (
          <span className="badge" style={{
            marginInlineStart: 'auto', fontSize: 11,
            background: 'rgba(251,191,36,0.15)', color: '#FBBF24',
          }}>
            השלב הבא
          </span>
        )}
      </div>
      {(done || current) && children}
    </div>
  );
}
