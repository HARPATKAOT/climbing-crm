import React, { useState } from 'react';
import { Clock, LogIn, Wallet } from 'lucide-react';
import StepRow from './StepRow.jsx';
import EmployeeSelect from '../EmployeeSelect.jsx';
import CashCountModal from '../CashCountModal.jsx';
import { CheckIcon } from '../safetyCheckIcons.jsx';

const hhmm = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
};

/**
 * אשף פתיחת היום — המסך היחיד שרואים לפני שהמשמרת נפתחה.
 *
 * הסדר הוא סדר העבודה בפועל: העובד נכנס למשמרת, פותח את הקופה, ואז בודק
 * חבלים ומכשירים. שעון השכר מתחיל בשלב הראשון, ולכן הכותרת מראה מאיזו שעה
 * הוא רץ — גם כשהקיר עוד לא נפתח לקהל.
 */
export default function WallShiftOpen({ state, employees = [], busy, onOpenShift, onSignSafety, onRefresh }) {
  const [pickedId, setPickedId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [placeOrderly, setPlaceOrderly] = useState(null);
  const [openingNote, setOpeningNote] = useState('');
  const [cashMode, setCashMode] = useState(null);
  const [signerByCheck, setSignerByCheck] = useState({});
  const [safetyNoteByCheck, setSafetyNoteByCheck] = useState({});
  const [signingId, setSigningId] = useState(null);

  const step = state?.step ?? 1;
  const opener = state?.opener || null;
  const cashIsOpen = !!state?.cash?.open;
  const dueSafety = state?.safety?.due || [];
  const pendingSafety = state?.safety?.pending || [];
  const safetySigners = state?.safety?.signers || [];
  const operators = (state?.available || []).filter((e) => e.can_open_wall);
  const confirmMessage = state?.settings?.wall_open_confirm_message || 'המקום מסודר ונקי?';
  const nameOf = (id) => operators.find((e) => e.id === id)?.name || 'עובד';

  const signSafety = async (check) => {
    const testerId = signerByCheck[check.id] || safetySigners[0]?.id;
    if (!testerId) return;
    setSigningId(check.id);
    try {
      await onSignSafety(check, testerId, safetyNoteByCheck[check.id] || '');
      setSafetyNoteByCheck((prev) => ({ ...prev, [check.id]: '' }));
    } finally {
      setSigningId(null);
    }
  };

  return (
    <div className="card fade-in" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="section-title" style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Clock size={18} />
        פתיחת היום
        {opener && (
          <span className="badge" style={{ marginInlineStart: 'auto', background: 'rgba(56,189,248,0.15)', color: '#38BDF8' }}>
            המשמרת התחילה ב-{hhmm(opener.clock_in)}
          </span>
        )}
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          שלושה שלבים. הקיר נפתח רק כשכולם הושלמו — שעות העבודה נספרות כבר מהשלב הראשון.
        </div>

        <StepRow done={!!opener} current={step === 1} title="1. פתיחת משמרת">
          {opener ? (
            <div style={{ fontSize: 13 }}>
              <strong>{opener.name}</strong>
              <span style={{ color: 'var(--text-3)' }}> · נכנס למשמרת ב-{hhmm(opener.clock_in)}</span>
            </div>
          ) : operators.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--amber)' }}>
              אין עובד שמסומן כמורשה לפתוח קיר — סמנו בתיק העובד.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <EmployeeSelect
                  className="input select"
                  employees={operators}
                  value={pickedId}
                  onChange={(emp) => setPickedId(emp?.id || '')}
                  placeholder="מי פותח את המשמרת?"
                  aria-label="בחירת עובד שפותח את המשמרת"
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !pickedId}
                onClick={() => {
                  setPlaceOrderly(null);
                  setOpeningNote('');
                  setConfirmOpen(true);
                }}
              >
                <LogIn size={15} /> פתיחת משמרת
              </button>
            </div>
          )}
        </StepRow>

        <StepRow done={cashIsOpen} current={step === 2} title="2. פתיחת קופה">
          {cashIsOpen ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              נפתחה ע״י {state?.cash?.opened_by_name || 'צוות'}
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCashMode('open')}>
              <Wallet size={14} /> פתיחת קופה
            </button>
          )}
        </StepRow>

        <StepRow done={step > 3 || (cashIsOpen && pendingSafety.length === 0)} current={step === 3} title="3. בדיקת חבלים ומכשירים">
          {dueSafety.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>אין בדיקות שחייבות היום</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {dueSafety.map((check) => {
                // רק מי שהוסמך לחתום על בדיקות בטיחות, בלי קשר לתדירות הבדיקה.
                const signers = safetySigners;
                return (
                  <div
                    key={check.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                      padding: '8px 10px', borderRadius: 8,
                      background: check.signed_today ? 'rgba(16,185,129,0.08)' : 'var(--bg-input)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <CheckIcon name={check.name} size={14} />
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{check.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{check.frequency}</div>
                    </div>
                    {check.signed_today ? (
                      <span className="badge badge-green">נחתם</span>
                    ) : (
                      <>
                        <div style={{ minWidth: 180, flex: '1 1 180px' }}>
                          <EmployeeSelect
                            className="input select input-sm"
                            employees={signers}
                            value={signerByCheck[check.id] || signers[0]?.id || ''}
                            placeholder="מי ביצע את הבדיקה?"
                            aria-label={`בחירת עובד עבור ${check.name}`}
                            onChange={(emp) => setSignerByCheck((prev) => ({ ...prev, [check.id]: emp?.id || '' }))}
                          />
                        </div>
                        <input
                          className="input input-sm"
                          value={safetyNoteByCheck[check.id] || ''}
                          onChange={(event) => setSafetyNoteByCheck((prev) => ({
                            ...prev,
                            [check.id]: event.target.value,
                          }))}
                          placeholder="הערה לבדיקה (אופציונלי)"
                          aria-label={`הערה עבור בדיקת ${check.name}`}
                          style={{ flex: '1 1 220px', minWidth: 190 }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={signingId === check.id || signers.length === 0}
                          onClick={() => signSafety(check)}
                        >
                          {signingId === check.id ? 'שומר...' : 'חתימה'}
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              {safetySigners.length === 0 && pendingSafety.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--amber)' }}>
                  אין עובד שמורשה לחתום על בדיקות יומיות — סמנו בתיק העובד.
                </div>
              )}
            </div>
          )}
        </StepRow>
      </div>

      {cashMode && (
        <CashCountModal
          mode={cashMode}
          employees={employees}
          expectedCash={null}
          revealExpected={false}
          onClose={() => setCashMode(null)}
          onSuccess={async () => {
            setCashMode(null);
            await onRefresh();
          }}
        />
      )}

      {confirmOpen && (
        <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !busy && setConfirmOpen(false)}>
          <div className="modal slide-up" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <div className="modal-title">אישור פתיחת משמרת</div>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={busy} onClick={() => setConfirmOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.55 }}>{confirmMessage}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>פותח: {nameOf(pickedId)}</div>
              <div
                role="group"
                aria-label="האם המקום מסודר"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
              >
                <button
                  type="button"
                  className={`btn ${placeOrderly === true ? 'btn-success' : 'btn-ghost'}`}
                  aria-pressed={placeOrderly === true}
                  disabled={busy}
                  onClick={() => setPlaceOrderly(true)}
                >
                  כן, המקום מסודר
                </button>
                <button
                  type="button"
                  className={`btn ${placeOrderly === false ? 'btn-danger' : 'btn-ghost'}`}
                  aria-pressed={placeOrderly === false}
                  disabled={busy}
                  onClick={() => setPlaceOrderly(false)}
                >
                  לא, יש בעיה
                </button>
              </div>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, color: 'var(--text-3)' }}>
                הערה {placeOrderly === false ? '(חובה)' : '(אופציונלי)'}
                <textarea
                  className="input textarea"
                  rows={3}
                  value={openingNote}
                  onChange={(event) => setOpeningNote(event.target.value)}
                  placeholder={placeOrderly === false ? 'מה לא מסודר או מה דורש טיפול?' : 'אפשר לציין משהו שכדאי לדעת'}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmOpen(false)}>
                  ביטול
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || !pickedId || placeOrderly == null || (placeOrderly === false && !openingNote.trim())}
                  onClick={async () => {
                    const result = await onOpenShift(pickedId, {
                      place_orderly: placeOrderly,
                      opening_note: openingNote.trim(),
                    });
                    if (result) {
                      setConfirmOpen(false);
                      setPickedId('');
                      setPlaceOrderly(null);
                      setOpeningNote('');
                    }
                  }}
                >
                  פתיחת משמרת
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
