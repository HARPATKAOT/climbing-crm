import React from 'react';
import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';

/**
 * התווית של שורת כניסה.
 *
 * `documents_state` נכתב ע"י השרת ברישום הכניסה, לפי אותו כלל שמחליט אם מותר
 * לנקב. שורות ישנות נושאות רק את הבוליאני, ולכן הן נופלות אליו במקום לאבד
 * את הסימון.
 */
export function checkInDocumentsBadge(checkIn) {
  const state = checkIn?.documents_state || (checkIn?.medical_approved ? 'valid' : 'missing');
  const label = checkIn?.documents_label || (checkIn?.medical_approved ? 'תקין' : 'חסרה הצהרה');
  if (state === 'valid') return { className: 'badge badge-green', Icon: ShieldCheck, label };
  if (state === 'expired') return { className: 'badge badge-amber', Icon: ShieldAlert, label };
  return { className: 'badge badge-red', Icon: ShieldAlert, label };
}

export default function TodayLog({ checkIns = [], onRefresh }) {
  const today = new Date().toDateString();
  const rows = checkIns.filter((c) => new Date(c.timestamp).toDateString() === today);

  return (
    <div className="card">
      <div className="section-title" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <span>יומן כניסות להיום ({rows.length})</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh}><RefreshCw size={14} /></button>
      </div>
      <div className="table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>שעה</th>
              <th>שם</th>
              <th>קבוצה</th>
              <th>מסמכים</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 24 }}>אין כניסות עדיין היום</td></tr>
            )}
            {[...rows].reverse().map((c, i) => {
              const badge = checkInDocumentsBadge(c);
              return (
                <tr key={c.id || i}>
                  <td style={{ fontFamily: 'monospace' }}>
                    {new Date(c.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ fontWeight: 600 }}>{c.climber_name}</td>
                  <td>{c.group_name}</td>
                  <td>
                    <span className={badge.className}>
                      <badge.Icon size={12} /> {badge.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
