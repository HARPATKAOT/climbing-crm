import React, { useCallback, useEffect, useState } from 'react';
import { Unlock, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import CashCountModal from './CashCountModal.jsx';
import { pairThermalPrinter, thermalSupported } from '../utils/thermalPrinter.js';

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

export default function CashShiftPanel({ employees = [], isOwner = false, onOpened = null, onClosed = null }) {
  const [sessionInfo, setSessionInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [printerMsg, setPrinterMsg] = useState('');
  const [countMode, setCountMode] = useState(null); // 'open' | 'close' | null

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/cash-register/session');
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'שגיאה בטעינה');
      setSessionInfo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const open = sessionInfo?.open;
  const expected = Number(sessionInfo?.expected_cash) || 0;

  const pairPrinter = async () => {
    setPrinterMsg('');
    try {
      const info = await pairThermalPrinter();
      setPrinterMsg(`מדפסת חוברה: ${info.productName || `${info.vendorId}:${info.productId}`}`);
    } catch (err) {
      setPrinterMsg(err.message || 'חיבור מדפסת נכשל');
    }
  };

  if (loading) {
    return <div className="card" style={{ padding: 24 }}>טוען מצב קופה…</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>
          {open ? <><Lock size={18} /> קופה פתוחה</> : <><Unlock size={18} /> קופה סגורה</>}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
          {open
            ? `נפתחה ע״י ${open.opened_by_name || 'צוות'} · ${new Date(open.opened_at).toLocaleString('he-IL')}`
            : 'לחצו לפתיחה — תיפתח מסך ספירת מזומן'}
        </div>

        {(error || okMsg) && (
          <div
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 10,
              border: `1px solid ${error ? 'rgba(239,68,68,0.4)' : 'rgba(16,185,129,0.4)'}`,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            {error ? <AlertTriangle size={18} color="#F87171" /> : <CheckCircle2 size={18} color="#34D399" />}
            <div>{error || okMsg}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {!open ? (
            <button type="button" className="btn btn-primary" onClick={() => setCountMode('open')}>
              פתח קופה
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setCountMode('close')}>
              סגור קופה
            </button>
          )}
          {thermalSupported() && (
            <button type="button" className="btn btn-ghost" onClick={pairPrinter}>
              חיבור מדפסת תרמית
            </button>
          )}
        </div>
        {printerMsg && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-2)' }}>{printerMsg}</div>}
        {isOwner && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
            מילוי, ריקון ואיפוס — בלשונית מסוף מנהל
          </div>
        )}
      </div>

      {countMode === 'open' && (
        <CashCountModal
          mode="open"
          employees={employees}
          onClose={() => setCountMode(null)}
          onSuccess={async (data) => {
            setCountMode(null);
            setOkMsg('הקופה נפתחה — אפשר לגבות במזומן');
            await refresh();
            onOpened?.(data);
          }}
        />
      )}

      {countMode === 'close' && (
        <CashCountModal
          mode="close"
          employees={employees}
          expectedCash={expected}
          revealExpected={isOwner}
          onClose={() => setCountMode(null)}
          onSuccess={async (data) => {
            setCountMode(null);
            const disc = Number(data.discrepancy) || 0;
            setOkMsg(
              isOwner
                ? `הקופה נסגרה. ${disc === 0 ? 'מאוזנת.' : disc < 0 ? `חסר ₪${Math.abs(disc)}` : `עודף ₪${disc}`} · נשלחו ${data.alertsSent || 0} התראות מנהל`
                : 'הקופה נסגרה. תודה.'
            );
            await refresh();
            onClosed?.(data);
          }}
        />
      )}
    </div>
  );
}
