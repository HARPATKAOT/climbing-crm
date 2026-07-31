/**
 * הסוכן הצף — נוכח בכל מסך, נפתח לחלונית שיחה אחת.
 *
 * ההפרדה בין שאלה למשימה נעשית בשרת ולא כאן: הוא מחזיר `reply` (התשובה)
 * ובנפרד `actions` — פעולות שהמודל ביקש לבצע ונשמרו כהצעות *ממתינות*.
 * שום דבר לא נכתב ל-CRM עד שלוחצים "אשר" על הכרטיס, ולכן אותה תשובה יכולה
 * להכיל גם הסבר וגם פעולה לאישור.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Bot, Check, Loader2, Send, Sparkles, Trash2, X } from 'lucide-react';

const EXAMPLES = [
  'כמה מקומות פנויים בחוגים של יום רביעי?',
  'מה המצב עם מיכל לוי?',
  'אילו משימות באיחור?',
  'תפתח משימה לחזור לדוד כהן מחר',
];

/** הסיבה שהשרת מחזיר, מתורגמת למשפט שאומר לצוות מה קרה. */
const FAILURE_MESSAGES = {
  no_api_key: 'לא הוגדר מפתח מודל בשרת. בלעדיו הסוכן לא יכול לענות.',
  quota: 'המכסה היומית של המודל נוצלה. נסו שוב מאוחר יותר.',
  model_error: 'הקריאה למודל נכשלה. נסו שוב בעוד רגע.',
  max_steps: 'הסוכן הסתבך בשאלה הזו ולא הגיע לתשובה. נסחו אותה קצת אחרת.',
};

function actionTitle(action) {
  return action.label || action.args?.title || 'פעולה';
}

function ActionCard({ action, onReview, busy }) {
  const decided = action.status && action.status !== 'pending';
  return (
    <div className={`agent-action ${decided ? `is-${action.status}` : ''}`}>
      <div className="agent-action-body">
        <strong>{actionTitle(action)}</strong>
        {action.reason && <small>{action.reason}</small>}
        <div className="agent-action-meta">
          {action.parent_name && <span className="badge badge-blue">{action.parent_name}</span>}
          {action.args?.student_name && <span className="badge badge-gray">{action.args.student_name}</span>}
          {action.args?.due_date && <span className="badge badge-gray">יעד {action.args.due_date}</span>}
          {action.args?.priority === 'high' && <span className="badge badge-amber">דחוף</span>}
        </div>
      </div>
      {decided ? (
        <span className={`badge ${action.status === 'approved' ? 'badge-green' : 'badge-gray'}`}>
          {action.status === 'approved' ? 'אושר' : 'נדחה'}
        </span>
      ) : (
        <div className="agent-action-buttons">
          <button
            className="btn btn-success btn-sm"
            disabled={busy}
            onClick={() => onReview(action.id, 'approve')}
          >
            <Check size={13} /> אשר
          </button>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => onReview(action.id, 'reject')}
          >
            <X size={13} /> דחה
          </button>
        </div>
      )}
    </div>
  );
}

const AgentDock = forwardRef(function AgentDock({ page = '' }, ref) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // פתיחה מתוך שורת התפריט „עוזר חכם” — תמיד שיחה חדשה.
  useImperativeHandle(ref, () => ({
    openNewChat: () => {
      setTurns([]);
      setDraft('');
      setOpen(true);
    },
  }), []);

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [open, turns, sending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Esc סוגר — חלונית צפה שלא נסגרת במקלדת היא מלכודת במסך צר.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async (text) => {
    const question = String(text ?? draft).trim();
    if (!question || sending) return;

    // ההיסטוריה שנשלחת היא זו שלפני השאלה החדשה — השרת חסר-מצב.
    const history = turns.flatMap((turn) => [
      { role: 'user', content: turn.question },
      ...(turn.reply ? [{ role: 'assistant', content: turn.reply }] : []),
    ]);

    setDraft('');
    setSending(true);
    setTurns((prev) => [...prev, { question, reply: '', actions: [], error: '' }]);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...history, { role: 'user', content: question }], page }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'הקריאה לסוכן נכשלה');

      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          question,
          reply: body.reply || '',
          actions: body.actions || [],
          error: body.reply ? '' : (FAILURE_MESSAGES[body.reason] || 'הסוכן לא החזיר תשובה.'),
        };
        return next;
      });
    } catch (err) {
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = { question, reply: '', actions: [], error: err.message };
        return next;
      });
    } finally {
      setSending(false);
    }
  };

  const reviewAction = async (id, decision) => {
    if (busyAction) return;
    setBusyAction(id);
    try {
      const response = await fetch(`/api/ai/suggestions/${id}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'הפעולה נכשלה');
      const status = decision === 'approve' ? 'approved' : 'rejected';
      setTurns((prev) => prev.map((turn) => ({
        ...turn,
        actions: turn.actions.map((action) => (action.id === id ? { ...action, status } : action)),
      })));
    } catch (err) {
      setTurns((prev) => prev.map((turn) => ({
        ...turn,
        actions: turn.actions.map((action) => (
          action.id === id ? { ...action, review_error: err.message } : action
        )),
      })));
    } finally {
      setBusyAction(null);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <>
      {/* במסך רחב הכפתור יושב ליד „עוזר חכם” בסיידבר; כאן נשאר רק למובייל. */}
      <button
        className={`agent-fab agent-fab--mobile ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        title={open ? 'סגירת הסוכן' : 'שאלו את הסוכן'}
        aria-label={open ? 'סגירת הסוכן' : 'שאלו את הסוכן'}
        aria-expanded={open}
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>

      {open && (
        <div className="agent-panel" role="dialog" aria-label="סוכן CRM">
          <div className="agent-panel-header">
            <div className="agent-panel-title">
              <Bot size={16} /> הסוכן
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {turns.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => setTurns([])}
                  title="שיחה חדשה"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setOpen(false)} title="סגירה">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="agent-panel-body" ref={scrollRef}>
            {!turns.length && (
              <div className="agent-empty">
                <p>שאלו על לקוח, חוג, תשלום או משימה — או בקשו ממני לפתוח משימה.</p>
                <p className="agent-empty-note">
                  כל פעולה שאבקש לבצע תופיע כאן ככרטיס לאישור. בלי אישור — כלום לא משתנה.
                </p>
                <div className="agent-examples">
                  {EXAMPLES.map((example) => (
                    <button key={example} className="agent-example" onClick={() => send(example)}>
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn, index) => (
              <div key={index} className="agent-turn">
                <div className="agent-bubble agent-bubble-user">{turn.question}</div>

                {turn.reply && <div className="agent-bubble agent-bubble-bot">{turn.reply}</div>}
                {turn.error && <div className="agent-bubble agent-bubble-error">{turn.error}</div>}

                {turn.actions.map((action) => (
                  <React.Fragment key={action.id}>
                    <ActionCard action={action} onReview={reviewAction} busy={busyAction === action.id} />
                    {action.review_error && (
                      <div className="agent-bubble agent-bubble-error">{action.review_error}</div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            ))}

            {sending && (
              <div className="agent-bubble agent-bubble-bot agent-thinking">
                <Loader2 size={14} className="agent-spin" /> חושב…
              </div>
            )}
          </div>

          <div className="agent-panel-footer">
            <textarea
              ref={inputRef}
              className="input textarea agent-input"
              rows={2}
              value={draft}
              placeholder="שאלה, או משימה שתרצו שאפתח…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              className="btn btn-primary btn-icon agent-send"
              disabled={sending || !draft.trim()}
              onClick={() => send()}
              title="שליחה"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
});

export default AgentDock;
