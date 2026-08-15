import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw, AlertTriangle } from 'lucide-react';

const TIER_LABELS = {
  TIER_NOT_SET: '250 (ברירת מחדל)',
  TIER_50: '50',
  TIER_250: '250',
  TIER_1K: '1,000',
  TIER_10K: '10,000',
  TIER_100K: '100,000',
  TIER_UNLIMITED: 'ללא הגבלה',
};

const QUALITY_COLORS = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)', gray: 'var(--text-3)' };

function formatReset(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  return today ? `היום ב-${time}` : `${d.toLocaleDateString('he-IL')} ${time}`;
}

/**
 * מכסת השליחה של המספר: רמת המכסה ודירוג האיכות מ-Meta, והניצול בחלון
 * 24 השעות מהיומן המקומי. נתון ש-Meta לא מחזירה נאמר במפורש — לא מוצג
 * אומדן בתחפושת של עובדה.
 */
export default function BroadcastQuotaCard({ audienceCount = 0, onQuota }) {
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchQuota = useCallback(async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/broadcast/quota${refresh ? '?refresh=1' : ''}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'טעינת המכסה נכשלה');
      setQuota(data);
      onQuota?.(data);
    } catch (err) {
      setError(err.message || 'טעינת המכסה נכשלה');
    } finally {
      setLoading(false);
    }
  }, [onQuota]);

  useEffect(() => { fetchQuota(); }, [fetchQuota]);

  const tier = quota?.tier;
  const window24 = quota?.window;
  const remaining = quota?.remaining;
  const unlimited = tier?.value === 'TIER_UNLIMITED';
  const overQuota = remaining != null && audienceCount > remaining;

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Gauge size={16} style={{ color: 'var(--cyan)' }} />
          <span className="section-title" style={{ marginBottom: 0, fontSize: 13 }}>מכסת Meta — חלון 24 שעות</span>
        </div>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => fetchQuota(true)} disabled={loading} title="רענון מ-Meta">
          <RefreshCw size={12} className={loading ? 'spin' : ''} /> רענון
        </button>
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: 8 }}>{error}</div>}

      {quota && !quota.available && (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          חיבור Meta לא מוגדר בסביבה הזאת — אין נתוני מכסה.
        </div>
      )}

      {quota?.available && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: 'var(--text-3)' }}>מכסה יומית (רמת המספר)</span>
            <strong>
              {tier?.limit != null || unlimited
                ? (TIER_LABELS[tier.value] || tier.value)
                : (tier?.error || 'לא ידוע')}
            </strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: 'var(--text-3)' }}>נשלחו בחלון הנוכחי (לפי היומן שלנו)</span>
            <strong>{window24?.used ?? 0} נמענים</strong>
          </div>
          {window24?.metaConversations != null ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: 'var(--text-3)' }}>שיחות שנפתחו (נתון Meta)</span>
              <strong>{window24.metaConversations}</strong>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {window24?.metaError || 'Meta לא מחזירה מונה שיחות חי'}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: 'var(--text-3)' }}>נותרו במכסה</span>
            <strong style={{ color: overQuota ? 'var(--red)' : 'var(--green)' }}>
              {unlimited ? 'ללא הגבלה' : remaining != null ? remaining : 'לא ידוע'}
            </strong>
          </div>
          {window24?.oldestRollsOffAt && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: 'var(--text-3)' }}>מקום מתפנה החל מ-</span>
              <strong>{formatReset(window24.oldestRollsOffAt)}</strong>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <span style={{ color: 'var(--text-3)' }}>דירוג איכות המספר</span>
            <strong style={{ color: QUALITY_COLORS[quota.quality?.tone] || 'var(--text-3)' }}>
              {quota.quality?.value ? quota.quality.label : (quota.quality?.error || 'לא ידוע')}
            </strong>
          </div>
          {quota.quality?.tone === 'red' || quota.quality?.tone === 'amber' ? (
            <div className="alert alert-warning" style={{ fontSize: 11 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              דירוג איכות יורד מקטין את המכסה. שווה להאט את קצב הדיוור השיווקי.
            </div>
          ) : null}
          {overQuota && (
            <div className="alert alert-warning" style={{ fontSize: 11 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              הקהל ({audienceCount}) גדול מהמכסה שנותרה ({remaining}). אפשר לשלוח חלק עכשיו
              ולתזמן את השאר לאחרי שהחלון מתפנה — הצעה תופיע בלחיצה על שליחה.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
