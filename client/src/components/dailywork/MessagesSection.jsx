import React, { useEffect, useRef, useState } from 'react';
import { Check, MessageSquare, Reply, Send, UserRoundPlus } from 'lucide-react';

const CHANNEL_LABEL = {
  whatsapp: 'וואטסאפ',
  instagram: 'אינסטגרם',
  messenger: 'מסנג׳ר',
};

function timeAgo(value) {
  const at = Date.parse(value || '');
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'עכשיו';
  if (minutes < 60) return `לפני ${minutes} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  return new Date(at).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
}

/**
 * אזור המענה של שיחה אחת: טקסט חופשי או הודעה שמורה. בחירת תבנית בלי עריכה
 * נשלחת כתבנית (והשרת ממלא את המשתנים); עריכה הופכת אותה לטקסט חופשי.
 */
function ReplyBox({ conversation, savedReplies, onSent, onError }) {
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const applyTemplate = (id) => {
    setTemplateId(id);
    setDirty(false);
    const reply = savedReplies.find((row) => String(row.id) === String(id));
    setText(reply?.body || '');
  };

  const send = async () => {
    if (busy || (!text.trim() && !templateId)) return;
    setBusy(true);
    try {
      const payload = templateId && !dirty
        ? { type: 'saved_reply', savedReplyId: templateId }
        : { text: text.trim() };
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.parentId)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) {
        throw new Error(result.error || 'שליחת ההודעה נכשלה');
      }
      setText('');
      setTemplateId('');
      onSent();
    } catch (err) {
      onError(err.message || 'שליחת ההודעה נכשלה');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dw-msg-reply">
      {savedReplies.length > 0 && (
        <div className="dw-msg-reply-row">
          <select
            className="select input-sm"
            style={{ maxWidth: 220 }}
            value={templateId}
            onChange={(event) => applyTemplate(event.target.value)}
            aria-label="בחירת הודעה שמורה"
          >
            <option value="">הודעה שמורה…</option>
            {savedReplies.map((reply) => (
              <option key={reply.id} value={reply.id}>{reply.title || reply.body?.slice(0, 40)}</option>
            ))}
          </select>
        </div>
      )}
      <textarea
        ref={inputRef}
        className="textarea"
        rows={2}
        placeholder={`תשובה ל${conversation.name}…`}
        value={text}
        onChange={(event) => { setText(event.target.value); setDirty(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) send();
        }}
      />
      <div className="dw-msg-reply-row">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || (!text.trim() && !templateId)} onClick={send}>
          <Send size={13} /> {busy ? 'שולח…' : 'שלח'}
        </button>
        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Ctrl+Enter לשליחה</span>
      </div>
    </div>
  );
}

function TransferBox({ conversation, employees, onDone, onError }) {
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);

  const transfer = async () => {
    const employee = employees.find((row) => String(row.id) === String(employeeId));
    if (!employee || busy) return;
    setBusy(true);
    try {
      const taskResponse = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `מענה ל${conversation.name} — הועבר ל${employee.name}`,
          notes: [conversation.phone, conversation.preview].filter(Boolean).join(' · '),
          parent_id: conversation.parentId,
          priority: 'high',
        }),
      });
      if (!taskResponse.ok) {
        const result = await taskResponse.json().catch(() => ({}));
        throw new Error(result.error || 'יצירת המשימה נכשלה');
      }
      const createdTask = await taskResponse.json().catch(() => null);
      onDone(employee, createdTask);
    } catch (err) {
      onError(err.message || 'ההעברה נכשלה');
      setBusy(false);
    }
  };

  return (
    <div className="dw-msg-reply">
      <div className="dw-msg-reply-row">
        <select
          className="select input-sm"
          style={{ maxWidth: 200 }}
          value={employeeId}
          onChange={(event) => setEmployeeId(event.target.value)}
          aria-label="בחירת עובד להעברה"
        >
          <option value="">להעביר אל…</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>{employee.name}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary btn-sm" disabled={!employeeId || busy} onClick={transfer}>
          {busy ? 'מעביר…' : 'העבר'}
        </button>
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
        תיווצר משימה על שם העובד והשיחה תסומן כטופלה
      </span>
    </div>
  );
}

/**
 * הודעות שממתינות למענה — עם תוכן ההודעה עצמה, לא רק שם וטלפון. מכל שורה:
 * מענה (כולל תבניות), סימון כטופל והעברה לאדם אחר.
 */
export default function MessagesSection({
  conversations,
  loaded,
  sectionRef,
  onOpenCard,
  onHandled,
  onTransferred,
  onNotice,
}) {
  const [openReplyId, setOpenReplyId] = useState(null);
  const [openTransferId, setOpenTransferId] = useState(null);
  const [savedReplies, setSavedReplies] = useState(null);
  const [employees, setEmployees] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const ensureSavedReplies = async () => {
    if (savedReplies !== null) return;
    try {
      const response = await fetch('/api/saved-replies');
      const body = await response.json().catch(() => []);
      setSavedReplies(Array.isArray(body) ? body : []);
    } catch {
      setSavedReplies([]);
    }
  };

  const ensureEmployees = async () => {
    if (employees !== null) return;
    try {
      const response = await fetch('/api/employees');
      const body = await response.json().catch(() => []);
      setEmployees((Array.isArray(body) ? body : []).filter((row) => row.status !== 'inactive'));
    } catch {
      setEmployees([]);
    }
  };

  const markHandled = async (conversation) => {
    if (busyId) return;
    setBusyId(conversation.parentId);
    try {
      await onHandled(conversation);
    } finally {
      setBusyId(null);
    }
  };

  const count = conversations.length;

  if (loaded && count === 0) {
    return (
      <section className="card" ref={sectionRef}>
        <div className="dw-collapsed is-ok">
          <Check size={14} />
          <h2>הודעות ממתינות:</h2>
          כל השיחות נענו — אין הודעות שממתינות לטיפול
        </div>
      </section>
    );
  }

  return (
    <section className="card daily-work-section" ref={sectionRef}>
      <header className="daily-work-section-header">
        <div className="daily-work-section-title">
          <span className="daily-work-section-icon" style={{ color: '#FBBF24', background: '#FBBF241f' }}>
            <MessageSquare size={18} />
          </span>
          <div>
            <h2>הודעות ממתינות</h2>
            <span>{loaded ? `${count} שיחות שמחכות למענה` : 'טוען…'}</span>
          </div>
        </div>
      </header>
      <div className="daily-work-list">
        {!loaded && (
          <>
            <div className="dw-skeleton-row" />
            <div className="dw-skeleton-row" />
          </>
        )}
        {loaded && conversations.map((conversation) => (
          <React.Fragment key={conversation.parentId}>
            <div
              className="daily-work-row"
              role="button"
              tabIndex={0}
              onClick={() => onOpenCard(conversation)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenCard(conversation);
                }
              }}
            >
              <div className="daily-work-row-copy" style={{ flex: 1 }}>
                <strong>
                  {conversation.name}
                  {conversation.fromStudentName && (
                    <span style={{ fontWeight: 400, color: 'var(--text-3)' }}> · כתב/ה {conversation.fromStudentName}</span>
                  )}
                </strong>
                <div className="dw-msg-preview">
                  {conversation.direction === 'outbound' ? 'אנחנו: ' : ''}
                  {conversation.preview}
                </div>
                <small>
                  {timeAgo(conversation.lastMessageAt)}
                  {' · '}
                  {CHANNEL_LABEL[conversation.channel] || conversation.channel}
                  {conversation.unread > 1 ? ` · ${conversation.unread} הודעות` : ''}
                </small>
              </div>
              <div className="daily-work-row-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="icon-btn"
                  title="מענה מהיר"
                  aria-label={`מענה ל${conversation.name}`}
                  onClick={() => {
                    ensureSavedReplies();
                    setOpenTransferId(null);
                    setOpenReplyId(openReplyId === conversation.parentId ? null : conversation.parentId);
                  }}
                >
                  <Reply size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title="העברה לאדם אחר"
                  aria-label={`העברת השיחה עם ${conversation.name}`}
                  onClick={() => {
                    ensureEmployees();
                    setOpenReplyId(null);
                    setOpenTransferId(openTransferId === conversation.parentId ? null : conversation.parentId);
                  }}
                >
                  <UserRoundPlus size={15} />
                </button>
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={busyId === conversation.parentId}
                  onClick={() => markHandled(conversation)}
                >
                  <Check size={14} /> טופל
                </button>
              </div>
            </div>
            {openReplyId === conversation.parentId && (
              <ReplyBox
                conversation={conversation}
                savedReplies={savedReplies || []}
                onSent={() => {
                  setOpenReplyId(null);
                  onNotice({ type: 'success', text: `ההודעה נשלחה ל${conversation.name}` });
                }}
                onError={(message) => onNotice({ type: 'error', text: message })}
              />
            )}
            {openTransferId === conversation.parentId && (
              <TransferBox
                conversation={conversation}
                employees={employees || []}
                onDone={(employee, createdTask) => {
                  setOpenTransferId(null);
                  onTransferred(conversation, employee, createdTask);
                }}
                onError={(message) => onNotice({ type: 'error', text: message })}
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}
