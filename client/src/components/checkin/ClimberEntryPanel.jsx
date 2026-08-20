import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarClock, ClipboardCheck, HeartPulse, LogIn, Search, Send,
  ShieldAlert, Ticket, UserPlus,
} from 'lucide-react';

/** מספר לוואטסאפ: ספרות בלבד, ו-0 מקומי מוחלף בקידומת ישראל. */
function waPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  return digits.length >= 11 ? digits : '';
}

/** יום/חודש — די כדי לדעת אם זה פג מזמן או אתמול, בלי להאריך את השורה. */
function shortDay(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const [, month, day] = raw.split('-');
  return `${Number(day)}/${Number(month)}`;
}

/**
 * „לא מוסדר” הסתיר את ההבדל שהדלפק צריך: אישור שפג תוקף וטופס שמעולם לא
 * נחתם נראו אותו דבר על המסך, וההסבר האמיתי ישב ב-tooltip שאיש לא מרחף
 * מעליו באמצע תור. כאן הכתובית עצמה אומרת מה קרה, ועם התאריך.
 */
function documentStateLabel(state, date) {
  const day = shortDay(date);
  if (state === 'valid') return day ? `בתוקף עד ${day}` : 'בתוקף';
  if (state === 'expired') return day ? `פג ב־${day}` : 'פג תוקף';
  if (state === 'blocked') return 'חסימה רפואית';
  return 'לא נחתם מעולם';
}

function StatusItem({ Icon, label, state, detail, loading }) {
  const settled = state === 'valid';
  const stateLabel = loading ? 'בודק...' : detail;
  return (
    <div
      className={`entry-status-item ${loading ? 'entry-status-loading' : settled ? 'entry-status-settled' : 'entry-status-pending'}`}
      title={`${label}: ${loading ? 'בודק' : detail}`}
      aria-label={`${label}: ${stateLabel}`}
    >
      <span className="entry-status-icon"><Icon size={17} strokeWidth={2.2} /></span>
      <span className="entry-status-copy">
        <span className="entry-status-label">{label}</span>
        <span className="entry-status-state">{stateLabel}</span>
      </span>
    </div>
  );
}

function EntryStatusRow({ documents, loading }) {
  const health = documents?.health;
  const waiver = documents?.waiver;
  // תוקף מוצג מתאריך הפקיעה; חסר אין לו תאריך, וזה בדיוק מה שצריך להיאמר.
  const healthDetail = documentStateLabel(health?.state, health?.expires_at);
  const waiverDetail = documentStateLabel(waiver?.state, waiver?.expires_at);
  return (
    <div className="entry-status-row" aria-label="סטטוס כניסה">
      <StatusItem Icon={HeartPulse} label="הצהרת בריאות" state={health?.state} detail={healthDetail} loading={loading || !documents} />
      <StatusItem Icon={ClipboardCheck} label="אישור השתתפות" state={waiver?.state} detail={waiverDetail} loading={loading || !documents} />
    </div>
  );
}

/**
 * חיפוש מתאמן. משמש לניקוב עבור חבר על כרטיסייה מועברת, וגם כבורר הלקוח
 * למי שאין לו הרשאת מכירה ולכן לא רואה את מסך הקופה.
 */
export function ClimberPicker({
  students, exclude = [], onPick, placeholder = 'שם החבר שנכנס...', size = 'sm',
}) {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const excluded = new Set(exclude.map(String));
  const hits = term
    ? students.filter((s) => !excluded.has(String(s.id)) && String(s.name || '').toLowerCase().includes(term)).slice(0, 5)
    : [];
  return (
    <div style={{ position: 'relative' }}>
      <div className="input-icon-wrap">
        <Search size={size === 'sm' ? 14 : 16} className="input-icon" />
        <input
          className={size === 'sm' ? 'input input-sm' : 'input'}
          style={size === 'sm' ? { paddingRight: 32 } : { paddingRight: 36, fontSize: 17, height: 48 }}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {hits.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 60,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
          marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}>
          {hits.map((s) => (
            <div
              key={s.id}
              onClick={() => { onPick(s); setQuery(''); }}
              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 13 }}
            >
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * אישור הכניסה של המתאמן שנבחר בקופה.
 *
 * החלונית יושבת מתחת ללקוח במסך המכירה, כדי שבחירת הלקוח, מצב המסמכים,
 * הכרטיסייה והקופה יהיו כולם על מסך אחד — הדלפקיסט לא מחליף מסכים באמצע
 * שיחה עם מי שעומד מולו.
 */
export default function ClimberEntryPanel({
  studentId, students = [], groups = [], onEntered,
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entered, setEntered] = useState(false);
  const [guests, setGuests] = useState([]);
  const [sendState, setSendState] = useState(null); // null | 'sending' | 'sent' | 'error'
  const [sendNote, setSendNote] = useState('');
  const requestRef = useRef(0);

  const load = async (id) => {
    const ticket = ++requestRef.current;
    setLoading(true);
    try {
      const data = await fetch(`/api/checkin/climber/${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : null));
      if (ticket === requestRef.current) setSummary(data);
    } catch {
      if (ticket === requestRef.current) setSummary(null);
    } finally {
      if (ticket === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setEntered(false);
    setGuests([]);
    setSendState(null);
    setSendNote('');
    if (!studentId) {
      setSummary(null);
      requestRef.current += 1;
      return;
    }
    load(studentId);
  }, [studentId]);

  /**
   * החתימה נופלת לכאן לבד.
   *
   * ההורה חותם בטלפון שלו, ועד עכשיו המסך הזה לא ידע על זה: הדלפקיסט רענן
   * ידנית או התקשר לשאול אם כבר חתם. כל עוד המסמכים אינם בתוקף הפאנל שואל
   * מחדש אחת לעשר שניות, ונעצר כשהם תקינים — או אחרי כחמש דקות, כי מי
   * שלא חתם עד אז לא יחתום בגלל שהמסך ממשיך לשאול.
   */
  const hasSummary = !!summary;
  const documentsSettled = summary?.documents?.state === 'valid';
  const pollTicksRef = useRef(0);
  useEffect(() => { pollTicksRef.current = 0; }, [studentId]);
  useEffect(() => {
    if (!studentId || !hasSummary || documentsSettled) return undefined;
    const timer = setInterval(() => {
      pollTicksRef.current += 1;
      if (pollTicksRef.current > 30) {
        clearInterval(timer);
        return;
      }
      load(studentId);
    }, 10000);
    return () => clearInterval(timer);
  }, [studentId, hasSummary, documentsSettled]);

  // רגע החתימה — אחרי שנשלח קישור, ההודעה שמתחתיו צריכה לומר שהוא נסגר.
  useEffect(() => {
    if (documentsSettled && sendState === 'sent') setSendNote('✓ הטופס נחתם — אפשר להיכנס');
  }, [documentsSettled, sendState]);

  if (!studentId) return null;

  const registerEntry = async (climber, passId) => {
    const group = groups.find((g) => g.id === climber.groupId);
    const res = await fetch('/api/check-ins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        climber_id: climber.id,
        climber_name: climber.name,
        group_name: group ? group.name : 'טיפוס חופשי',
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) throw new Error('רישום הכניסה נכשל');

    let note = '';
    let refusal = null;
    if (passId) {
      const punchRes = await fetch(`/api/pos/passes/${passId}/punch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'check_in', student_id: climber.id }),
      });
      const punchData = await punchRes.json().catch(() => ({}));
      if (punchRes.ok) {
        note = ` · נשארו ${punchData.pass?.visits_remaining} כניסות`;
        if (punchData.safetyNote) note += ` · ⚠ ${punchData.safetyNote}`;
      } else if (punchData.error) {
        refusal = punchData.error;
      }
    }
    return { name: climber.name, note, refusal };
  };

  const punch = summary?.best_punch;
  const membership = summary?.membership;
  // הטפסים הם השער: בלי הצהרה והסרת אחריות בתוקף אין כניסה ואין מכירת כניסה.
  const blocked = !!summary && summary.documents?.state !== 'valid';
  const climber = summary?.student
    || students.find((s) => String(s.id) === String(studentId))
    || null;

  const confirmEntry = async () => {
    if (!climber || busy) return;
    setBusy(true);
    try {
      const result = await registerEntry(climber, punch?.id);
      onEntered(result);
      if (!result.refusal) setEntered(true);
      await load(studentId);
    } catch (err) {
      onEntered({ name: climber.name, refusal: err.message });
    } finally {
      setBusy(false);
    }
  };

  /**
   * שליחת קישור החתימה להורה האחראי.
   *
   * השרת בוחר את ההורה, מנסה קודם תבנית מאושרת (עובדת גם מחוץ לחלון 24
   * השעות), ורק אז נופל לטקסט חופשי. כשהוא לא הצליח לשלוח הוא מחזיר קישור
   * לוואטסאפ אישי — פותחים אותו, כדי שהדלפק לא יישאר בלי דרך.
   */
  const sendDocumentsLink = async () => {
    if (busy) return;
    setBusy(true);
    setSendState('sending');
    setSendNote('');
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(studentId)}/send-health-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'שליחת הקישור נכשלה');
      if (data.sent) {
        setSendState('sent');
        setSendNote(`✓ הקישור נשלח ל${data.sentTo || summary?.parent?.name || 'ההורה'} בוואטסאפ`);
      } else {
        // לא נשלח אוטומטית — פותחים וואטסאפ אישי עם הקישור מוכן, כדי שהדלפק
        // לא יישאר בלי דרך להעביר אותו.
        setSendState('error');
        setSendNote(data.warning || 'הקישור לא נשלח אוטומטית — נפתח וואטסאפ לשליחה ידנית');
        const link = data.shortUrl || data.healthUrl;
        // wa.me רוצה מספר בינלאומי. 05… מקומי פותח שיחה עם מספר לא קיים.
        const phone = waPhone(summary?.parent?.phone);
        if (link && phone) {
          window.open(
            `https://wa.me/${phone}?text=${encodeURIComponent(`שלום, מצורף קישור למילוי טופס ההשתתפות והצהרת הבריאות:\n${link}`)}`,
            '_blank',
            'noopener'
          );
        }
      }
    } catch (err) {
      setSendState('error');
      setSendNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  const punchForGuest = async (guest) => {
    if (!punch || busy) return;
    setBusy(true);
    try {
      const result = await registerEntry(guest, punch.id);
      onEntered(result);
      setGuests((prev) => [...prev, { name: guest.name, refusal: result.refusal }]);
      await load(studentId);
    } catch (err) {
      onEntered({ name: guest.name, refusal: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="form-group"
      style={{
        marginBottom: 12, padding: 12, borderRadius: 12,
        background: 'rgba(45,212,191,0.05)', border: '1px solid rgba(45,212,191,0.3)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: '#2DD4BF' }}>
        <LogIn size={15} /> כניסה לקיר
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
        <CalendarClock size={13} />
        {loading ? 'טוען היסטוריה...' : (summary?.last_visit?.label || 'לא נרשמה כניסה קודמת')}
      </div>

      <EntryStatusRow
        documents={summary?.documents}
        loading={loading}
      />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {summary?.safety && summary.safety.state !== 'valid' && (
          <span className="badge badge-amber">
            <ShieldAlert size={12} /> {summary.safety.state === 'missing' ? 'אין מבחן אבטחה' : 'מבחן אבטחה פג'}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
        {punch ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Ticket size={13} /> <strong>{punch.name}</strong>
              {punch.transferable && (
                <span className="badge" style={{ fontSize: 10, background: 'rgba(167,139,250,0.15)', color: '#A78BFA' }}>מועברת</span>
              )}
            </div>
            <div style={{ color: 'var(--text-3)', marginTop: 3 }}>
              נשארו {punch.visits_remaining} מתוך {punch.visits_total}
              {punch.valid_until ? ` · עד ${punch.valid_until}` : ''}
            </div>
          </>
        ) : membership ? (
          <div>מנוי: <strong>{membership.name}</strong>{membership.valid_until ? ` · עד ${membership.valid_until}` : ''}</div>
        ) : (
          <div style={{ color: 'var(--text-3)' }}>אין כרטיסייה או מנוי פעיל</div>
        )}
      </div>

      {/* טפסים לא בתוקף = סוף הדרך כאן. אי אפשר להיכנס ואי אפשר למכור כניסה,
          ולכן הפעולה היחידה היא לבקש חתימה — בלי כפתור כניסה שאסור ללחוץ
          עליו ובלי כפתורי מכירה שיסורבו בעגלה ממילא. */}
      {blocked ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="alert alert-error" style={{ fontSize: 12.5, margin: 0 }}>
            {summary?.punch_block_reason || 'אין טופס השתתפות בתוקף — אי אפשר להיכנס או למכור כניסה'}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-full"
            disabled={busy || !summary?.parent?.phone}
            onClick={sendDocumentsLink}
          >
            <Send size={14} /> {sendState === 'sending' ? 'שולח...' : 'שליחת קישור לחתימה בוואטסאפ'}
          </button>
          <div style={{ fontSize: 11.5, color: sendState === 'error' ? 'var(--red)' : 'var(--text-3)' }}>
            {sendNote
              || (summary?.parent?.phone
                ? `נשלח ל${summary.parent.name || 'ההורה'} · ${summary.parent.phone}`
                : 'אין מספר טלפון להורה — צריך להשלים בתיק הלקוח')}
          </div>
        </div>
      ) : punch ? (
        <button
          type="button"
          className={entered ? 'btn btn-secondary btn-full' : 'btn btn-primary btn-full'}
          style={{ minHeight: 44, fontWeight: 700, fontSize: 16 }}
          disabled={busy || loading}
          onClick={confirmEntry}
        >
          <Ticket size={16} /> {entered ? 'ניקוב נוסף' : `ניקוב כניסה · נשארו ${punch.visits_remaining}`}
        </button>
      ) : membership ? (
        <button
          type="button"
          className={entered ? 'btn btn-secondary btn-full' : 'btn btn-primary btn-full'}
          style={{ minHeight: 44, fontWeight: 700, fontSize: 16 }}
          disabled={busy || loading}
          onClick={confirmEntry}
        >
          <LogIn size={16} /> {entered ? 'כניסה נוספת' : 'רישום כניסה — מנוי בתוקף'}
        </button>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          אין כרטיסייה או מנוי — הוסיפו כניסה לעגלה וגבו תשלום לפני רישום הכניסה.
        </div>
      )}

      {!blocked && punch?.transferable && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserPlus size={13} /> ניקוב נוסף על אותה כרטיסייה — לחבר שבא יחד
          </div>
          <ClimberPicker students={students} exclude={[studentId]} onPick={punchForGuest} />
          {guests.map((g, i) => (
            <div key={`${g.name}-${i}`} style={{ fontSize: 11.5, color: g.refusal ? 'var(--red)' : 'var(--text-3)' }}>
              {g.refusal ? `${g.name} — ${g.refusal}` : `✓ ${g.name} נוקב`}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
