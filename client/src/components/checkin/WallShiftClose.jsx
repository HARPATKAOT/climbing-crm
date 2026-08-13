import React, { useState } from 'react';
import { CheckCircle2, LogOut, Wallet } from 'lucide-react';
import StepRow from './StepRow.jsx';
import EmployeeSelect from '../EmployeeSelect.jsx';
import CashCountModal from '../CashCountModal.jsx';

/**
 * אשף סגירת המשמרת: מי סוגר → ספירת קופה → צ׳ק-ליסט סידור → סגירה.
 *
 * הסגירה היא גם דיווח היציאה של כל מי שעוד רשום במשמרת, ולכן היא מציגה במפורש
 * את מי היא מוציאה. הצ׳ק-ליסט מפוצל לפריטים ולא למשפט אחד — משפט אחד ארוך
 * מסומן בלי לקרוא.
 */
export default function WallShiftClose({ state, employees = [], busy, onClose, onConfirm, onRefresh }) {
  const closers = state?.closers_on_shift || [];
  const staff = state?.staff || [];
  const checklistItems = state?.settings?.wall_close_checklist || [];
  const cashIsOpen = !!state?.cash?.open;

  const [closerId, setCloserId] = useState(closers.length === 1 ? closers[0].id : '');
  const [cashMode, setCashMode] = useState(null);
  const [checked, setChecked] = useState({});
  const [closingNote, setClosingNote] = useState('');
  const [error, setError] = useState('');

  const allChecked = checklistItems.every((_, index) => checked[index]);
  const step = !closerId ? 1 : cashIsOpen ? 2 : !allChecked ? 3 : 0;

  const confirm = async () => {
    setError('');
    try {
      await onConfirm(closerId, closingNote);
    } catch (err) {
      setError(err.message || 'סגירת המשמרת נכשלה');
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal slide-up" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div className="modal-title">סגירת משמרת</div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={busy} onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StepRow done={!!closerId} current={step === 1} title="1. מי סוגר">
            {closers.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--amber)' }}>
                אף אחד מהעובדים שנמצאים עכשיו במשמרת אינו מורשה לסגור קיר. צריך שעובד מורשה
                ייכנס למשמרת לפני הסגירה.
              </div>
            ) : (
              <EmployeeSelect
                className="input select"
                employees={closers}
                value={closerId}
                onChange={(emp) => setCloserId(emp?.id || '')}
                placeholder="מי סוגר את המשמרת?"
                aria-label="בחירת העובד שסוגר את המשמרת"
              />
            )}
          </StepRow>

          <StepRow done={!cashIsOpen} current={step === 2} title="2. ספירת קופה וסגירתה">
            {cashIsOpen ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCashMode('close')}>
                <Wallet size={14} /> ספירה וסגירת קופה
              </button>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>הקופה סגורה</div>
            )}
          </StepRow>

          <StepRow done={allChecked} current={step === 3} title="3. המקום מסודר">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {checklistItems.map((item, index) => (
                <label key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={!!checked[index]}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [index]: e.target.checked }))}
                    style={{ width: 18, height: 18 }}
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
          </StepRow>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
            הערת סגירה (אופציונלי)
            <textarea
              className="input textarea"
              rows={3}
              value={closingNote}
              onChange={(event) => setClosingNote(event.target.value)}
              placeholder="תקלות, חוסר סדר או דבר שחשוב להעביר למשמרת הבאה"
            />
          </label>

          {staff.length > 1 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-input)' }}>
              הסגירה מדווחת יציאה גם עבור: {staff.map((s) => s.name).join(', ')}
            </div>
          )}

          {error && <div className="alert alert-error" style={{ fontSize: 13 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>ביטול</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || step !== 0}
              onClick={confirm}
            >
              {step === 0 ? <><CheckCircle2 size={15} /> סגירת המשמרת</> : <><LogOut size={15} /> יש להשלים את השלבים</>}
            </button>
          </div>
        </div>
      </div>

      {cashMode && (
        <CashCountModal
          mode={cashMode}
          employees={employees}
          expectedCash={state?.cash?.expected_cash ?? null}
          revealExpected={false}
          onClose={() => setCashMode(null)}
          onSuccess={async () => {
            setCashMode(null);
            await onRefresh();
          }}
        />
      )}
    </div>
  );
}
