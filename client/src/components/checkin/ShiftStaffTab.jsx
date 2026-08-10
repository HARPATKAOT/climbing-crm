import React, { useState } from 'react';
import { LogIn, LogOut, ShieldCheck, UserPlus } from 'lucide-react';
import EmployeeSelect from '../EmployeeSelect.jsx';
import { employeeAvatarColor, employeeAvatarIcon } from '../../utils/roleIcons.js';

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
};

const sinceText = (iso) => {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60000));
  if (minutes < 60) return `${minutes} דק׳`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}:${String(rest).padStart(2, '0')} שע׳` : `${hours} שע׳`;
};

/**
 * כניסות ויציאות של הצוות במהלך המשמרת.
 *
 * העובד האחרון שנשאר לא מקבל כפתור יציאה אלא כפתור סגירת משמרת: אם הוא יצא,
 * הקיר היה נשאר פתוח בלי איש, והקופה והבדיקות היו נשארות פתוחות עד למחרת.
 */
export default function ShiftStaffTab({ state, busy, onClockIn, onClockOut, onRequestClose }) {
  const [pickedId, setPickedId] = useState('');
  const staff = state?.staff || [];
  const available = state?.available || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="card card-p">
        <div className="section-title" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <UserPlus size={17} /> חתימת כניסה למשמרת
        </div>
        {available.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
            כל עובדי הקיר הפעילים כבר נמצאים במשמרת.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <EmployeeSelect
                className="input select"
                employees={available}
                value={pickedId}
                onChange={(emp) => setPickedId(emp?.id || '')}
                placeholder="מי נכנס למשמרת?"
                aria-label="בחירת עובד שנכנס למשמרת"
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !pickedId}
              onClick={async () => {
                await onClockIn(pickedId);
                setPickedId('');
              }}
            >
              <LogIn size={15} /> חתימת כניסה
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title" style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          עובדים פעילים במשמרת ({staff.length})
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {staff.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: 20 }}>אין עובדים במשמרת</div>
          )}
          {staff.map((row) => {
            const Icon = employeeAvatarIcon(row.avatar_icon);
            const color = employeeAvatarColor(row.avatar_icon);
            return (
              <div
                key={row.shift_id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  padding: '12px 14px', borderRadius: 12,
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                }}
              >
                <span style={{ color }} aria-hidden="true"><Icon size={20} strokeWidth={1.9} /></span>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontWeight: 700 }}>
                    {row.name}
                    {row.wall_role === 'opener' && (
                      <span className="badge" style={{ marginInlineStart: 8, fontSize: 11, background: 'rgba(56,189,248,0.15)', color: '#38BDF8' }}>
                        פתח/ה את המשמרת
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    מ-{hhmm(row.clock_in)} · {sinceText(row.clock_in)}
                  </div>
                </div>
                {row.can_close && (
                  <span className="badge badge-green" style={{ fontSize: 11 }}>
                    <ShieldCheck size={12} /> מורשה לסגור
                  </span>
                )}
                {row.can_clock_out ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => onClockOut(row.employee_id)}
                  >
                    <LogOut size={14} /> דיווח יציאה
                  </button>
                ) : row.can_close ? (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onRequestClose}>
                    <LogOut size={14} /> סגירת משמרת
                  </button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--amber)', maxWidth: 220 }}>
                    אחרון במשמרת ואינו מורשה לסגור — צריך שעובד מורשה ייכנס לפני היציאה.
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
