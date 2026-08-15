import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, MessageCircle, Phone, UsersRound } from 'lucide-react';
import { STATUSES, FUNNEL_STAGE_ORDER, nextFunnelStage } from '../../statusConfig.js';
import { StatusBadge } from '../UI.jsx';
import WorkDrawer from './WorkDrawer.jsx';

function waLink(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const intl = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}`;
}

/**
 * שורת משפחה אחת בשלב: שם (פותח את תיק הלקוח), טלפון, הילדים והסטטוס שלהם,
 * ופעולות מהירות — התקשר, וואטסאפ, קביעת מעקב וקידום שלב.
 */
function FamilyRow({ family, stage, onOpenCard, onAdvance, onSetFollowup, busy }) {
  const [showFollowup, setShowFollowup] = useState(false);
  const [followupDate, setFollowupDate] = useState('');
  const next = stage === 'waitlist' ? null : nextFunnelStage(stage);
  const wa = waLink(family.phone);

  return (
    <div className="dw-family-row">
      <div className="dw-family-head">
        <strong
          role="button"
          tabIndex={0}
          onClick={() => onOpenCard(family)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpenCard(family);
            }
          }}
        >
          {family.parent_name || 'משפחה ללא שם'}
        </strong>
        {family.phone && <span style={{ fontSize: 11, color: 'var(--text-3)', direction: 'ltr' }}>{family.phone}</span>}
      </div>
      {family.students.length > 0 && (
        <div className="dw-family-kids">
          {family.students.map((kid) => (
            <span key={kid.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-2)' }}>
              {kid.name || 'ללא שם'}
              <StatusBadge status={kid.status} />
            </span>
          ))}
        </div>
      )}
      <div className="dw-sale-actions">
        {family.phone && (
          <a className="btn btn-ghost btn-xs" href={`tel:${family.phone}`}>
            <Phone size={12} /> התקשר
          </a>
        )}
        {wa && (
          <a className="btn btn-ghost btn-xs" href={wa} target="_blank" rel="noreferrer">
            <MessageCircle size={12} /> וואטסאפ
          </a>
        )}
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowFollowup((value) => !value)}>
          <CalendarClock size={12} /> קבע מעקב
        </button>
        {next && family.carrier_student_id && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            disabled={busy}
            title={`העברת ${family.parent_name || 'המשפחה'} לשלב „${STATUSES[next]?.label}”`}
            onClick={() => onAdvance(family, next)}
          >
            <ChevronLeft size={12} /> קדם ל„{STATUSES[next]?.label}”
          </button>
        )}
      </div>
      {showFollowup && (
        <div className="dw-msg-reply-row">
          <input
            type="date"
            className="input input-sm"
            style={{ width: 150 }}
            value={followupDate}
            onChange={(event) => setFollowupDate(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-success btn-sm"
            disabled={!followupDate || busy}
            onClick={async () => {
              await onSetFollowup(family, followupDate);
              setShowFollowup(false);
            }}
          >
            שמור מעקב
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * הלידים שמאחורי המשפך, שלב-שלב. אותה ספירה בדיוק כמו המספרים במסך —
 * הרשימות מגיעות מאותו חישוב בשרת.
 */
export default function FunnelDrawer({ initialStage = 'all', funnelCounts = {}, waitlistCount = 0, onClose, onOpenCard, onChanged }) {
  const [families, setFamilies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stage, setStage] = useState(initialStage);
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/dashboard/funnel-families');
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'טעינת הלידים נכשלה');
      setFamilies(body);
    } catch (err) {
      setError(err.message || 'טעינת הלידים נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stageKeys = useMemo(() => {
    const withCounts = FUNNEL_STAGE_ORDER.filter((key) => (funnelCounts[key] || 0) > 0 || (families?.[key]?.length || 0) > 0);
    return waitlistCount > 0 || (families?.waitlist?.length || 0) > 0 ? [...withCounts, 'waitlist'] : withCounts;
  }, [families, funnelCounts, waitlistCount]);

  const visible = useMemo(() => {
    if (!families) return [];
    if (stage === 'all') {
      return stageKeys.flatMap((key) => (families[key] || []).map((family) => ({ ...family, stage: key })));
    }
    return (families[stage] || []).map((family) => ({ ...family, stage }));
  }, [families, stage, stageKeys]);

  const advance = async (family, next) => {
    setBusyId(family.parent_id);
    setNotice(null);
    try {
      const response = await fetch(`/api/students/${encodeURIComponent(family.carrier_student_id)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'קידום השלב נכשל');
      setNotice({ type: 'success', text: `${family.parent_name || 'המשפחה'} עברה לשלב „${STATUSES[next]?.label}”` });
      setLoading(true);
      await load();
      onChanged?.();
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'קידום השלב נכשל' });
    } finally {
      setBusyId('');
    }
  };

  const setFollowup = async (family, date) => {
    setBusyId(family.parent_id);
    setNotice(null);
    try {
      const target = family.carrier_student_id
        ? `/api/students/${encodeURIComponent(family.carrier_student_id)}`
        : `/api/parents/${encodeURIComponent(family.parent_id)}`;
      const response = await fetch(target, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextFollowup: date }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'שמירת המעקב נכשלה');
      }
      setNotice({ type: 'success', text: `נקבע מעקב ל${family.parent_name || 'המשפחה'}` });
      onChanged?.();
    } catch (err) {
      setNotice({ type: 'error', text: err.message || 'שמירת המעקב נכשלה' });
    } finally {
      setBusyId('');
    }
  };

  const title = stage === 'all'
    ? 'כל הפניות במשפך'
    : STATUSES[stage]?.label || stage;

  return (
    <WorkDrawer
      title={title}
      sub={loading ? 'טוען…' : `${visible.length} משפחות`}
      icon={stage !== 'all' && STATUSES[stage]?.icon ? STATUSES[stage].icon : UsersRound}
      tone={stage !== 'all' ? STATUSES[stage]?.color || '#A78BFA' : '#A78BFA'}
      onClose={onClose}
    >
      <div className="dw-drawer-filters">
        <button
          type="button"
          className={`dw-chip ${stage === 'all' ? 'active' : ''}`}
          onClick={() => setStage('all')}
        >
          הכול
        </button>
        {stageKeys.map((key) => (
          <button
            key={key}
            type="button"
            className={`dw-chip ${stage === key ? 'active' : ''}`}
            style={stage === key ? undefined : { color: STATUSES[key]?.color }}
            onClick={() => setStage(key)}
          >
            {STATUSES[key]?.label || key} · {families?.[key]?.length ?? funnelCounts[key] ?? (key === 'waitlist' ? waitlistCount : 0)}
          </button>
        ))}
      </div>

      {notice && (
        <div className={`alert alert-${notice.type}`} style={{ margin: '12px 18px', padding: 10, fontSize: 12 }}>
          {notice.text}
        </div>
      )}

      <div className="dw-drawer-body">
        {loading && (
          <>
            <div className="dw-skeleton-row" />
            <div className="dw-skeleton-row" />
            <div className="dw-skeleton-row" />
          </>
        )}
        {!loading && error && (
          <div className="dw-error-box">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLoading(true); load(); }}>נסה שוב</button>
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="daily-work-empty">אין משפחות בשלב הזה</div>
        )}
        {!loading && !error && visible.map((family) => (
          <FamilyRow
            key={`${family.stage}:${family.parent_id}`}
            family={family}
            stage={family.stage}
            busy={busyId === family.parent_id}
            onOpenCard={onOpenCard}
            onAdvance={advance}
            onSetFollowup={setFollowup}
          />
        ))}
      </div>
    </WorkDrawer>
  );
}
