import React, { useEffect, useMemo, useState } from 'react';
import { X, Eraser, Wallet } from 'lucide-react';
import CashDenominationPad from './CashDenominationPad.jsx';
import EmployeeSelect from './EmployeeSelect.jsx';
import { CASH_DENOMS, sumDenoms } from './cashDenoms.js';

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      res.status === 401
        ? 'צריך להתחבר מחדש למערכת'
        : 'השרת החזיר תשובה לא צפויה — נסו לרענן או להפעיל מחדש את השרת המקומי'
    );
  }
}

const MODE_META = {
  open: {
    title: 'פתיחת קופה',
    confirm: 'פתח קופה',
    who: 'פותח',
    endpoint: '/api/cash-register/open',
    fail: 'פתיחה נכשלה',
  },
  close: {
    title: 'סגירת קופה',
    confirm: 'סגור קופה',
    who: 'סוגר',
    endpoint: '/api/cash-register/close',
    fail: 'סגירה נכשלה',
    showDisc: true,
  },
  fill: {
    title: 'מילוי קופה',
    confirm: 'הוסף לקופה',
    who: 'מבצע',
    endpoint: '/api/cash-register/fill',
    fail: 'מילוי נכשל',
    hint: 'ספרו את השטרות והמטבעות שמוסיפים למגירה',
  },
  empty: {
    title: 'ריקון קופה',
    confirm: 'רוקן מהקופה',
    who: 'מבצע',
    endpoint: '/api/cash-register/empty',
    fail: 'ריקון נכשל',
    hint: 'ספרו את השטרות והמטבעות שמוציאים מהמגירה',
  },
  count: {
    title: 'ספירת קופה',
    confirm: 'עדכן יתרה לפי הספירה',
    who: 'סופר',
    endpoint: '/api/cash-register/reset',
    fail: 'עדכון הספירה נכשל',
    hint: 'ספרו את כל המזומן שבמגירה כרגע',
    showDisc: true,
  },
  reset: {
    title: 'איפוס קופה',
    confirm: 'אפס לפי הספירה',
    who: 'מאפס',
    endpoint: '/api/cash-register/reset',
    fail: 'איפוס נכשל',
    hint: 'ספרו את המזומן בפועל — היתרה תאופס לפי הספירה',
    showDisc: true,
  },
};

export default function CashCountModal({
  mode = 'open',
  employees = [],
  expectedCash = null,
  /** מנהל בלבד — עובד לא רואה כמה אמור להיות / חסר */
  revealExpected = false,
  onClose,
  onSuccess,
}) {
  const [denoms, setDenoms] = useState({});
  const [employeeId, setEmployeeId] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const meta = MODE_META[mode] || MODE_META.open;
  const total = useMemo(() => sumDenoms(denoms, CASH_DENOMS), [denoms]);
  // פתיחה/סגירה — רק מי שמורשה בתיק. פעולות מנהל נשארות עם כל העובדים הפעילים.
  const selectableEmployees = useMemo(() => {
    const active = (employees || []).filter((e) => e.is_active !== false);
    if (mode === 'open' || mode === 'close') {
      return active.filter((e) => e.can_operate_cash === true);
    }
    return active;
  }, [employees, mode]);

  const discrepancy =
    revealExpected && meta.showDisc && expectedCash != null
      ? Math.round((total - Number(expectedCash)) * 100) / 100
      : null;

  useEffect(() => {
    if (employeeId && !selectableEmployees.some((e) => e.id === employeeId)) {
      setEmployeeId('');
      setEmployeeName('');
    }
  }, [selectableEmployees, employeeId]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const canSubmit = Boolean(employeeId && String(employeeName || '').trim());

  const submit = async () => {
    if (!canSubmit) {
      setError('יש לבחור מי מבצע את הפעולה');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const body = {
        denominations: denoms,
        confirmSuggested: false,
        amount: total,
        employee_id: employeeId || undefined,
        employee_name: employeeName || undefined,
        notes,
      };
      const res = await fetch(meta.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || meta.fail);
      onSuccess?.(data);
    } catch (err) {
      setError(err.message || 'שגיאה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cash-shell-backdrop" role="presentation" onClick={onClose}>
      <div
        className="cash-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-shell-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cash-shell-top">
          <div className="cash-shell-brand">
            <span className="cash-shell-icon" aria-hidden="true">
              <Wallet size={20} />
            </span>
            <div>
              <h2 id="cash-shell-title" className="cash-shell-title">{meta.title}</h2>
              {meta.hint ? <p className="cash-shell-hint">{meta.hint}</p> : null}
            </div>
          </div>

          <div className="cash-shell-sum" aria-live="polite">
            <span className="cash-shell-sum-label">סה״כ</span>
            <span className="cash-shell-sum-value">
              ₪{total.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
            </span>
          </div>

          <button type="button" className="cash-shell-x" onClick={onClose} aria-label="סגירה">
            <X size={20} />
          </button>
        </header>

        <div className="cash-shell-main">
          <div className="cash-shell-tools">
            <button type="button" className="cash-shell-clear" onClick={() => setDenoms({})}>
              <Eraser size={15} />
              נקה הכל
            </button>
          </div>

          <CashDenominationPad
            value={denoms}
            onChange={setDenoms}
            variant="stepper"
            showTotal={false}
          />

          {discrepancy != null ? (
            <div className={`cash-shell-disc ${discrepancy === 0 ? 'ok' : 'warn'}`}>
              אמור להיות ₪{Number(expectedCash).toLocaleString('he-IL')}
              {' · '}
              נספר ₪{total.toLocaleString('he-IL')}
              {' · '}
              {discrepancy === 0
                ? 'מאוזן'
                : discrepancy < 0
                  ? `חסר ₪${Math.abs(discrepancy)}`
                  : `עודף ₪${discrepancy}`}
            </div>
          ) : meta.showDisc ? (
            <div className="cash-shell-disc ok">
              נספר ₪{total.toLocaleString('he-IL')}
            </div>
          ) : null}

          {(mode === 'fill' || mode === 'empty') && revealExpected && expectedCash != null && (
            <div className="cash-shell-disc ok">
              יתרה נוכחית ₪{Number(expectedCash).toLocaleString('he-IL')}
              {' · '}
              אחרי הפעולה ₪
              {(
                mode === 'fill'
                  ? Number(expectedCash) + total
                  : Math.max(0, Number(expectedCash) - total)
              ).toLocaleString('he-IL', { minimumFractionDigits: 2 })}
            </div>
          )}

          <div className="cash-shell-meta">
            <label className="cash-shell-field">
              <span>מי {meta.who}</span>
              <EmployeeSelect
                employees={selectableEmployees}
                value={employeeId}
                aria-label={`מי ${meta.who}`}
                onChange={(emp) => {
                  setEmployeeId(emp?.id || '');
                  setEmployeeName(emp?.name || '');
                }}
              />
              {(mode === 'open' || mode === 'close') && selectableEmployees.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>
                  אין עובד שמורשה לפתוח ולסגור קופה — סמנו בתיק העובד.
                </div>
              )}
            </label>
            <label className="cash-shell-field">
              <span>הערות</span>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="אופציונלי"
              />
            </label>
          </div>

          {error ? <div className="alert alert-error cash-shell-error">{error}</div> : null}
        </div>

        <footer className="cash-shell-foot">
          <button type="button" className="btn btn-ghost cash-shell-btn" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="btn btn-primary cash-shell-btn"
            disabled={busy || !canSubmit}
            title={!canSubmit ? 'יש לבחור מי מבצע את הפעולה' : undefined}
            onClick={submit}
          >
            {busy ? 'שומר…' : meta.confirm}
          </button>
        </footer>
      </div>
    </div>
  );
}
