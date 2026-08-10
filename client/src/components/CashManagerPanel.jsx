import React, { useCallback, useEffect, useState } from 'react';
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, Calculator, Filter, Printer, RotateCcw,
  Unlock, Lock, Banknote, CreditCard, Undo2,
} from 'lucide-react';
import CashCountModal from './CashCountModal.jsx';
import { sendEscPosBase64, thermalSupported } from '../utils/thermalPrinter.js';

const FILTERS = [
  { id: 'all', label: 'הכל' },
  { id: 'sale_cash,sale_online', label: 'מכירות' },
  { id: 'sale_cash', label: 'מזומן' },
  { id: 'sale_online', label: 'סליקה' },
  { id: 'close,open', label: 'פתיחה/סגירה' },
  { id: 'fill,empty,reset', label: 'מילוי/ריקון/איפוס' },
  { id: 'refund_cash,refund_online', label: 'זיכויים' },
];

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      res.status === 401
        ? 'צריך להתחבר מחדש למערכת'
        : 'השרת החזיר תשובה לא צפויה — נסו לרענן'
    );
  }
}

const TOOLS = [
  {
    id: 'count',
    title: 'ספירת קופה',
    desc: 'ספירה של כל המזומן שבמגירה ועדכון היתרה לפי מה שנספר',
    Icon: Calculator,
    color: '#38BDF8',
  },
  {
    id: 'fill',
    title: 'מילוי',
    desc: 'הוספת שטרות ומטבעות ליתרה הקיימת במגירה',
    Icon: ArrowDownCircle,
    color: '#34D399',
  },
  {
    id: 'empty',
    title: 'ריקון',
    desc: 'הוצאת שטרות ומטבעות מהיתרה הקיימת במגירה',
    Icon: ArrowUpCircle,
    color: '#FBBF24',
  },
  {
    id: 'reset',
    title: 'איפוס',
    desc: 'איפוס היתרה לפי ספירת המזומן בפועל במגירה',
    Icon: RotateCcw,
    color: '#F472B6',
  },
];

/** צבעים ואייקונים לפי סוג פעולה — תואם לכלים למעלה */
const ACTION_STYLE = {
  open: { Icon: Unlock, color: '#38BDF8', label: 'פתיחה' },
  close: { Icon: Lock, color: '#A78BFA', label: 'סגירה' },
  fill: { Icon: ArrowDownCircle, color: '#34D399', label: 'מילוי' },
  empty: { Icon: ArrowUpCircle, color: '#FBBF24', label: 'ריקון' },
  reset: { Icon: RotateCcw, color: '#F472B6', label: 'איפוס' },
  sale_cash: { Icon: Banknote, color: '#34D399', label: 'מכירת מזומן' },
  sale_online: { Icon: CreditCard, color: '#38BDF8', label: 'סליקה בקישור' },
  refund_cash: { Icon: Undo2, color: '#FB7185', label: 'זיכוי מזומן' },
  refund_online: { Icon: Undo2, color: '#FB7185', label: 'זיכוי סליקה' },
};

function LedgerTypeBadge({ actionType, actionLabel }) {
  const style = ACTION_STYLE[actionType] || {
    Icon: Calculator,
    color: '#94a3b8',
    label: actionLabel || actionType || '—',
  };
  const { Icon, color } = style;
  const label = actionLabel || style.label || actionType || '—';
  return (
    <span className="cash-ledger-type" style={{ '--type-color': color }}>
      <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
      {label}
    </span>
  );
}

function formatMovement(row) {
  if (row == null) return '—';
  const type = row.action_type;
  const amt = Number(row.amount) || 0;
  const abs = Math.abs(amt).toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  // פתיחה / סגירה / איפוס — הסכום שנספר או שנפתח איתו
  if (type === 'open' || type === 'close' || type === 'reset') {
    return `₪${abs}`;
  }
  // מילוי / מכירה — תוספת; ריקון / זיכוי מזומן — ירידה
  if (type === 'fill' || type === 'sale_cash') return `+₪${abs}`;
  if (type === 'empty' || type === 'refund_cash') return `−₪${abs}`;
  if (type === 'sale_online' || type === 'refund_online') return `₪${abs}`;
  return `₪${abs}`;
}

function formatDiscrepancy(disc) {
  if (disc == null) return '—';
  const n = Number(disc);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n).toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  if (n === 0) return '₪0';
  if (n > 0) return `+₪${abs}`;
  return `−₪${abs}`;
}

function discClass(disc) {
  if (disc == null) return 'cash-ledger-disc is-empty';
  if (Number(disc) === 0) return 'cash-ledger-disc is-ok';
  return 'cash-ledger-disc is-warn';
}

function formatBalance(bal) {
  if (bal == null || bal === '') return '—';
  const n = Number(bal);
  if (!Number.isFinite(n)) return '—';
  return `₪${n.toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export default function CashManagerPanel({ employees = [], canResetCash = false }) {
  const [expected, setExpected] = useState(0);
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [countMode, setCountMode] = useState(null);

  const refresh = useCallback(async () => {
    setError('');
    const qs = new URLSearchParams();
    if (filter !== 'all') qs.set('type', filter);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const [ledgerRes, sessionRes] = await Promise.all([
      fetch(`/api/cash-register/ledger?${qs}`),
      fetch('/api/cash-register/session'),
    ]);
    const ledger = await readJson(ledgerRes);
    const session = await readJson(sessionRes);
    if (!ledgerRes.ok) throw new Error(ledger.error || 'שגיאה ביומן');
    if (!sessionRes.ok) throw new Error(session.error || 'שגיאה בטעינת מצב קופה');
    setRows(ledger.rows || []);
    setExpected(Number(ledger.expected_cash ?? session.expected_cash) || 0);
  }, [filter, from, to]);

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);

  const testDrawer = async () => {
    setError('');
    try {
      if (!thermalSupported()) throw new Error('חיבור ישיר למדפסת זמין בכרום בלבד');
      const res = await fetch('/api/cash-register/receipt-bytes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drawerOnly: true }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'שגיאה');
      await sendEscPosBase64(data.base64);
      setOkMsg('נשלחה פקודת פתיחת מגירה למדפסת');
    } catch (err) {
      setError(err.message);
    }
  };

  const actionDoneLabel = {
    count: 'היתרה עודכנה לפי הספירה',
    fill: 'המילוי נשמר',
    empty: 'הריקון נשמר',
    reset: 'הקופה אופסה לפי הספירה',
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>
          <Wallet size={18} /> מסוף ניהול קופה
        </div>
        <div className="stat-value" style={{ fontSize: 28 }}>
          ₪{expected.toLocaleString('he-IL', { minimumFractionDigits: 2 })}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>מזומן שאמור להיות במגירה כרגע</div>
        {(error || okMsg) && (
          <div style={{ marginTop: 12, color: error ? '#FCA5A5' : '#6EE7B7' }}>{error || okMsg}</div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="section-title" style={{ marginBottom: 14 }}>כלים</div>
        <div className="cash-mgr-tools">
          {TOOLS.filter(({ id }) => canResetCash || !['count', 'reset'].includes(id)).map(({ id, title, desc, Icon, color }) => (
            <button
              key={id}
              type="button"
              className="cash-mgr-tool"
              style={{ '--tool-color': color }}
              onClick={() => {
                setError('');
                setOkMsg('');
                setCountMode(id);
              }}
            >
              <span className="cash-mgr-tool-icon">
                <Icon size={20} />
              </span>
              <span className="cash-mgr-tool-body">
                <span className="cash-mgr-tool-title">{title}</span>
                <span className="cash-mgr-tool-desc">{desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={testDrawer}>
            <Printer size={14} /> בדיקת פתיחת מגירה
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="section-title" style={{ marginBottom: 12 }}>
          <Filter size={16} /> יומן פעולות
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`tab-pill ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="table-wrap">
          <table className="crm-table cash-ledger-table">
            <thead>
              <tr>
                <th>זמן</th>
                <th>סוג</th>
                <th>תנועה</th>
                <th>אמור להיות</th>
                <th>שינוי בחריגה</th>
                <th>חריגה מצטברת</th>
                <th>עובד</th>
                <th>הערות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const change = r.gap_change != null ? r.gap_change : null;
                const cumulative = r.gap_cumulative != null ? r.gap_cumulative : null;
                return (
                  <tr key={r.id}>
                    <td className="cash-ledger-time">
                      {r.created_at ? new Date(r.created_at).toLocaleString('he-IL') : '—'}
                    </td>
                    <td>
                      <LedgerTypeBadge
                        actionType={r.action_type}
                        actionLabel={r.action_label}
                      />
                    </td>
                    <td className="cash-ledger-amount">
                      {formatMovement(r)}
                    </td>
                    <td className="cash-ledger-balance">
                      {formatBalance(r.should_be)}
                    </td>
                    <td className={discClass(change)}>
                      {formatDiscrepancy(change)}
                    </td>
                    <td className={`cash-ledger-cum ${discClass(cumulative)}`}>
                      {formatDiscrepancy(cumulative === 0 ? 0 : cumulative)}
                    </td>
                    <td>{r.employee_name || '—'}</td>
                    <td className="cash-ledger-notes">
                      {r.notes || (r.change_given != null ? `עודף ₪${r.change_given}` : '—')}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={8} style={{ color: 'var(--text-3)' }}>אין רשומות</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {countMode && (
        <CashCountModal
          mode={countMode}
          employees={employees}
          expectedCash={expected}
          revealExpected
          onClose={() => setCountMode(null)}
          onSuccess={async (data) => {
            setCountMode(null);
            setOkMsg(
              `${actionDoneLabel[countMode] || 'הפעולה נשמרה'} · יתרה כעת ₪${Number(data.expected_cash ?? 0).toLocaleString('he-IL')}`
            );
            await refresh().catch((e) => setError(e.message));
          }}
        />
      )}
    </div>
  );
}
