import React, { useMemo, useState } from 'react';
import { Check, ListChecks, Sparkles, UserRoundPlus, X } from 'lucide-react';

function dateValue(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shortDate(value) {
  const parsed = dateValue(value);
  if (!parsed) return value || '';
  return parsed.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}

const KIND_META = {
  placement: { icon: UserRoundPlus, tone: '#F59E0B', label: 'אישור שיבוץ' },
  suggestion: { icon: Sparkles, tone: '#818CF8', label: 'הצעת AI' },
  task: { icon: ListChecks, tone: '#34D399', label: 'משימה' },
};

/**
 * מרכז המשימות: אישורי שיבוץ, הצעות AI ומשימות פתוחות ברשימה אחת. פריט
 * לאישור הוא משימה — לא קטגוריה נפרדת. אפשר לאשר או לדחות כמה ביחד.
 */
export default function TaskCenter({
  placements,
  setPlacements,
  suggestions,
  setSuggestions,
  tasks,
  setTasks,
  loaded,
  openParentCard,
  onNotice,
}) {
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkProgress, setBulkProgress] = useState('');

  const today = useMemo(() => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    return value;
  }, []);

  const items = useMemo(() => {
    const list = [];
    for (const row of placements) {
      list.push({
        kind: 'placement',
        id: `placement:${row.id}`,
        rawId: row.id,
        title: `${row.student_name || 'מתאמן/ת'} · ${row.group_name || row.program || ''}`,
        meta: [row.parent_name, row.grade_or_band, row.level ? `רמה ${row.level}` : ''].filter(Boolean).join(' · '),
        note: row.status === 'approved'
          ? `האישור נשמר, אך הודעת ההמשך לא הושלמה${row.continuation_error ? ` · ${row.continuation_error}` : ''}`
          : (row.strength === 'strong' ? 'מועמד/ת חזק/ה — עדיין נדרש אישור צוות' : 'מועמד/ת אפשרי/ת — נדרש אישור צוות'),
        badge: row.strength === 'strong' ? '6A ומעלה' : '5A–5C',
        badgeTone: 'badge-amber',
        parentId: row.parent_id,
        approvable: true,
        rejectable: row.status !== 'approved',
        approveLabel: row.status === 'approved' ? 'המשך ושלח' : 'אשר',
      });
    }
    for (const row of suggestions) {
      list.push({
        kind: 'suggestion',
        id: `suggestion:${row.id}`,
        rawId: row.id,
        title: row.args?.title || '',
        meta: [row.scenario_name, row.parent_name, row.student_name].filter(Boolean).join(' · '),
        note: row.reason,
        badge: row.args?.due_date ? `יעד ${shortDate(row.args.due_date)}` : null,
        badgeTone: row.args?.priority === 'high' ? 'badge-amber' : 'badge-gray',
        parentId: row.args?.parent_id,
        approvable: true,
        rejectable: true,
        approveLabel: 'אשר',
      });
    }
    for (const row of tasks) {
      const due = dateValue(row.due_date);
      const overdue = due && due < today;
      list.push({
        kind: 'task',
        id: `task:${row.id}`,
        rawId: row.id,
        title: row.title,
        meta: [row.parent_name, row.student_name].filter(Boolean).join(' · '),
        note: row.notes,
        badge: due ? `${overdue ? 'באיחור · ' : ''}${shortDate(row.due_date)}` : null,
        badgeTone: overdue ? 'badge-amber' : 'badge-gray',
        parentId: row.parent_id,
        approvable: false,
        rejectable: false,
      });
    }
    return list;
  }, [placements, suggestions, tasks, today]);

  const reviewPlacement = async (id, decision) => {
    const response = await fetch(`/api/placement-requests/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.continuation?.error || result.error || 'המשך התהליך נכשל');
    }
    setPlacements((current) => current.filter((row) => String(row.id) !== String(id)));
    return decision === 'approved'
      ? 'השיבוץ אושר ונשמר, והודעת ההמשך עם קישור ההרשמה נשלחה ללקוח.'
      : 'בקשת השיבוץ נדחתה.';
  };

  const reviewSuggestion = async (id, decision) => {
    const response = await fetch(`/api/ai/suggestions/${id}/${decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'הפעולה נכשלה');
    setSuggestions((current) => current.filter((row) => String(row.id) !== String(id)));
    if (decision === 'approve' && result.task) setTasks((current) => [...current, result.task]);
    return decision === 'approve' ? 'ההצעה אושרה ונוצרה משימה.' : 'ההצעה נדחתה.';
  };

  /** משימה נסגרת אופטימית — ואם השרת נכשל, השורה חוזרת לרשימה. */
  const completeTask = async (id) => {
    const removed = tasks.find((row) => String(row.id) === String(id));
    setTasks((current) => current.filter((row) => String(row.id) !== String(id)));
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      if (!response.ok) throw new Error('סימון המשימה נכשל');
    } catch (err) {
      if (removed) setTasks((current) => [...current, removed]);
      onNotice({ type: 'error', text: err.message || 'סימון המשימה נכשל' });
    }
  };

  const runSingle = async (item, decision) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      let message = '';
      if (item.kind === 'placement') {
        message = await reviewPlacement(item.rawId, decision === 'approve' ? 'approved' : 'rejected');
      } else if (item.kind === 'suggestion') {
        message = await reviewSuggestion(item.rawId, decision);
      }
      if (message) onNotice({ type: 'success', text: message });
      setSelected((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    } catch (err) {
      onNotice({ type: 'error', text: `הפעולה לא הושלמה: ${err.message}. הפריט נשאר כאן ואפשר לנסות שוב.` });
    } finally {
      setBusyId(null);
    }
  };

  /** אישור/דחייה מרוכזים — פריט-פריט, כדי שכשל אחד לא יעצור את השאר. */
  const runBulk = async (decision) => {
    const chosen = items.filter((item) => selected.has(item.id) && item.approvable);
    if (!chosen.length || busyId) return;
    setBusyId('bulk');
    const failures = [];
    for (let index = 0; index < chosen.length; index += 1) {
      const item = chosen[index];
      setBulkProgress(`${decision === 'approve' ? 'מאשר' : 'דוחה'} ${index + 1} מתוך ${chosen.length}…`);
      try {
        if (item.kind === 'placement') {
          if (decision === 'reject' && !item.rejectable) continue;
          await reviewPlacement(item.rawId, decision === 'approve' ? 'approved' : 'rejected');
        } else {
          await reviewSuggestion(item.rawId, decision);
        }
      } catch (err) {
        failures.push(`${item.title}: ${err.message}`);
      }
    }
    setBulkProgress('');
    setBusyId(null);
    setSelected(new Set());
    onNotice(failures.length
      ? { type: 'error', text: `${chosen.length - failures.length} הושלמו, ${failures.length} נכשלו — ${failures[0]}` }
      : { type: 'success', text: `${chosen.length} פריטים ${decision === 'approve' ? 'אושרו' : 'נדחו'}.` });
  };

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedCount = [...selected].filter((id) => items.some((item) => item.id === id && item.approvable)).length;

  if (!loaded) {
    return (
      <section className="card daily-work-section">
        <header className="daily-work-section-header">
          <div className="daily-work-section-title">
            <span className="daily-work-section-icon" style={{ color: '#F59E0B', background: '#F59E0B1f' }}>
              <ListChecks size={18} />
            </span>
            <div><h2>מרכז המשימות</h2><span>טוען…</span></div>
          </div>
        </header>
        <div className="dw-skeleton-row" />
        <div className="dw-skeleton-row" />
      </section>
    );
  }

  if (!items.length) {
    return (
      <section className="card">
        <div className="dw-collapsed is-ok">
          <Check size={14} />
          <h2>מרכז המשימות:</h2>
          אין אישורים, הצעות או משימות שממתינים — הכול טופל
        </div>
      </section>
    );
  }

  return (
    <section className="card daily-work-section">
      <header className="daily-work-section-header">
        <div className="daily-work-section-title">
          <span className="daily-work-section-icon" style={{ color: '#F59E0B', background: '#F59E0B1f' }}>
            <ListChecks size={18} />
          </span>
          <div>
            <h2>מרכז המשימות</h2>
            <span>{items.length} לטיפול — אישורי שיבוץ, הצעות AI ומשימות</span>
          </div>
        </div>
      </header>

      {selectedCount > 0 && (
        <div className="dw-bulk-bar">
          <span>{selectedCount} נבחרו</span>
          {bulkProgress ? (
            <span>{bulkProgress}</span>
          ) : (
            <>
              <button type="button" className="btn btn-success btn-sm" disabled={busyId === 'bulk'} onClick={() => runBulk('approve')}>
                <Check size={13} /> אשר את הנבחרים
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === 'bulk'} onClick={() => runBulk('reject')}>
                <X size={13} /> דחה את הנבחרים
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>נקה בחירה</button>
            </>
          )}
        </div>
      )}

      <div className="daily-work-list">
        {items.map((item) => {
          const meta = KIND_META[item.kind];
          const KindIcon = meta.icon;
          const clickable = item.parentId ? openParentCard(item.parentId) : undefined;
          return (
            <div
              key={item.id}
              className="daily-work-row"
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable}
              onKeyDown={clickable ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  clickable();
                }
              } : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                {item.approvable ? (
                  <input
                    type="checkbox"
                    className="dw-check"
                    checked={selected.has(item.id)}
                    aria-label={`בחירת ${item.title}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggle(item.id)}
                  />
                ) : (
                  <span style={{ width: 15, flexShrink: 0 }} />
                )}
                <div className="daily-work-row-copy">
                  <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <KindIcon size={13} style={{ color: meta.tone, flexShrink: 0 }} />
                    {item.title}
                  </strong>
                  {item.meta && <span>{item.meta}</span>}
                  {item.note && <small>{item.note}</small>}
                </div>
              </div>
              <div className="daily-work-row-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                {item.badge && <span className={`badge ${item.badgeTone}`}>{item.badge}</span>}
                {item.kind === 'task' ? (
                  <button type="button" className="btn btn-success btn-sm" disabled={busyId === item.id} onClick={() => completeTask(item.rawId)}>
                    <Check size={14} /> בוצע
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn btn-success btn-sm" disabled={Boolean(busyId)} onClick={() => runSingle(item, 'approve')}>
                      <Check size={14} /> {item.approveLabel}
                    </button>
                    {item.rejectable && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busyId)} onClick={() => runSingle(item, 'reject')}>
                        <X size={14} /> דחה
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
