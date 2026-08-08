import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Baby, BellRing, Bone, Brain, CalendarClock, CheckCircle, Download,
  FileWarning, HeartPulse, HelpCircle, Lock, Megaphone, Pencil, PenTool, Pill, Plus, ShieldAlert,
  ShieldCheck, Stethoscope, Wind,
} from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  blobToBase64,
  buildHealthDeclarationPdf,
  buildParticipationWaiverPdf,
  downloadHealthDeclarationPdf,
  downloadParticipationWaiverPdf,
} from '../utils/healthDeclarationPdf.js';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import {
  EventStyles,
  KnownChildNote,
  KnownChildPrompt,
  KnownFamilyNote,
  KnownFamilyPrompt,
  useFamilyMatch,
} from './publicFormKit.jsx';
import { checkKnownChild, linkFieldsFor } from '../utils/childCheck.js';
import { joinParentName, splitParentName } from '../utils/parentName.js';
import {
  blankAnswers,
  clearanceTriggers,
  detailPrompt,
  hasPositiveScreening,
  isScreeningQuestion,
  needsMedicalClearance,
  questionLabel,
  questionsForSigner,
  signsAsAdultFemale,
  unansweredQuestions,
} from '../utils/healthQuestions.js';
import { clearanceBudgetError } from '../utils/medicalClearanceFile.js';
import {
  declarationSectionTitles,
  splitWaiverText,
  withMinorsClauses,
  withSignerName,
} from '../utils/declarationSections.js';
import MedicalClearanceField from './MedicalClearanceField.jsx';
import GenderPicker, {
  ADULT_GENDER_OPTIONS,
  CHILD_GENDER_OPTIONS,
  GenderMark,
} from './GenderPicker.jsx';
import {
  adultParticipantFromContext,
  participationGenderValue,
} from '../utils/participationForm.js';
import { CANONICAL_HEALTH_QUESTIONS } from '../utils/participationDocuments.js';
import { uploadSignedParticipationPdfs } from '../utils/participationPdfUpload.js';
import { formatIls, normalizePriceIncludesVat, vatBreakdown } from '../utils/vat.js';
import { cancellationRuleParts } from '../utils/cancellationText.js';

/** Day for the form UI — digits with dots so RTL does not reshuffle ISO dates. */
function formatSignedDay(value) {
  const raw = String(value || '').trim();
  const isoDay = raw.slice(0, 10);
  const match = isoDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/**
 * The binding text — the one layer there is. Naming the signer inside it is
 * deliberate: "I take the risk" read by someone scrolling is a sentence about
 * nobody, and with their own name in it, it is the clause they cannot later
 * say they did not notice. The safety rules are not repeated here — they are
 * the ticked items on the previous step, where each one is acknowledged
 * separately, which is both better evidence and one list instead of two.
 */
function buildFallbackWaiver(legalName) {
  return `כתב הצהרה, ויתור והסרת אחריות

1. אני החתום/ה מטה, {{שם החותם}}, מצהיר/ה כי קראתי מסמך זה במלואו, הבנתי את תוכנו, וכי אני חותם/ת עליו מרצוני החופשי ומתוך הבנה שמדובר בחוזה מחייב לכל דבר ועניין.

2. ידוע לי כי טיפוס ספורטיבי, על כל צורותיו, הוא פעילות אתגרית הכרוכה מטבעה בסיכון לפגיעה גופנית — לרבות נפילה, החלקה, פגיעה מציוד, מאמץ יתר ופציעה — וכי סיכון זה קיים גם בהקפדה מלאה על הוראות הבטיחות.

3. אני מצהיר/ה כי מסרתי בהצהרת הבריאות מידע מלא, נכון ומעודכן ביחס אליי או ביחס למשתתף/ת שעליו/ה אני חותם/ת, וכי לא ידועה לי מגבלה רפואית שלא פורטה בה. אני מתחייב/ת לעדכן את הצוות בכל שינוי במצב הבריאותי.

4. בחינת התאמת הפעילות למצב הבריאותי היא באחריותי בלבד, ובמקרה הצורך לאחר היוועצות ברופא. "${legalName}" אינו גורם רפואי ואינו בוחן כשירות רפואית להשתתפות.

5. אני, {{שם החותם}}, נוטל/ת על עצמי את הסיכון הרגיל הכרוך בפעילות, ומוותר/ת על כל טענה, דרישה או תביעה כלפי "${legalName}", בעליו, מנהליו, עובדיו ומי מטעמו, בגין נזק גוף או רכוש שייגרם במסגרת אותו סיכון.

6. אין בוויתור שבסעיף 5 כדי לגרוע מאחריות "הרפתקאות" לפי דין, לרבות בשל רשלנות של "הרפתקאות" או של מי שפעל מטעמה.

7. אני מתחייב/ת לפעול לפי כל הוראות הבטיחות שסימנתי בשלב הקודם ולפי הוראות הצוות, ולדווח לצוות באופן מיידי על כל מפגע, תקלה, פציעה או תחושה גופנית חריגה.

8. ידוע לי כי הצוות רשאי להפסיק את ההשתתפות בכל עת, אם לדעתו היא מסכנת את המשתתף/ת או אחרים.

9. חתימת הורה או אפוטרופוס על מסמך זה מחייבת גם את המשתתף/ת הקטין/ה שעליו/ה נחתם, ומהווה הסכמה להשתתפותו/ה בפעילות.`;
}

function buildFallbackQuestions(legalName) {
  return [
    {
      id: 'h1',
      requireYes: true,
      label: `אני החתום/ה מטה מצהיר/ה בזאת שאני או האדם אותו אני רושם לחוג הטיפוס בריא/ה וכשיר/ה פיזית, נפשית וקוגניטיבית להשתתף בפעילות המתקיימת ב"${legalName}". אני מבין כי הפעילות עלולה להיות מסוכנת ולא ידוע לי על מגבלות שעלולות למנוע מהמשתתף פעילות בטוחה ובריאה.`,
    },
    // A rule about a child left unaccompanied has nobody to apply to when an
    // adult signs for themselves.
    { id: 's1', requireYes: true, audience: 'child', label: 'אין להשאיר ילד עד גיל 11 ללא ליווי מבוגר שלא במסגרת חוג מסודר' },
    { id: 's2', requireYes: true, label: 'נא להימנע מריצה והשתוללות בכל מתחם הקיר' },
    { id: 's3', requireYes: true, label: 'יש להישמע להוראות המדריכים' },
    { id: 's4', requireYes: true, label: 'הטיפוס יתאפשר רק לאחר קבלת תדריך בטיחות מלא ומעבר מבחן בטיחות בפני מדריך מטעם הקיר.' },
    { id: 's5', requireYes: true, label: 'אין להשתמש במתקנים השונים ללא קבלת אישור ממדריך' },
  ];
}

/**
 * Age in whole years, shown next to a birth date the moment one is typed.
 *
 * It is there to be checked, not stored: a date that lands a nine-year-old on
 * "גיל 90" is a typo the person filling the form catches instantly, and nobody
 * catches it by re-reading DD/MM/YYYY.
 */
/**
 * Israeli ID check digit — the standard Luhn-like sum over nine digits.
 *
 * Used to warn, never to block. A passport number, a foreign resident's
 * document or a nine-digit number this function has no business judging must
 * still get through; the point is to catch the transposed digit that would
 * otherwise reach an invoice and a household match.
 */
function looksLikeIsraeliId(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    let step = Number(digits[i]) * ((i % 2) + 1);
    if (step > 9) step -= 9;
    sum += step;
  }
  return sum % 10 === 0;
}

function ageFromBirthDate(value) {
  const born = new Date(`${String(value || '').trim()}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const monthDiff = today.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < born.getDate())) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

function isExistingDeclarationRenewal(participant) {
  return !!participant?.id && !!(participant?.renewOptIn || participant?.resignHealth);
}

function hasCompleteParticipantProfile(participant) {
  return !!String(participant?.name || '').trim()
    && !!String(participant?.idNumber || '').trim()
    && !!String(participant?.birthDate || '').trim()
    && !!String(participant?.gender || '').trim();
}

function hasLockedParticipantProfile(participant) {
  return isExistingDeclarationRenewal(participant)
    && hasCompleteParticipantProfile(participant)
    && !participant?.editProfile;
}

function ParticipantProfileSummary({ participant, onEdit }) {
  const gender = participant?.gender === 'male'
    ? (participant?.type === 'adult' ? 'גבר' : 'בן')
    : participant?.gender === 'female'
      ? (participant?.type === 'adult' ? 'אישה' : 'בת')
      : 'לא צוין';
  const genderDisplay = participant?.gender ? (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <GenderMark gender={participant.gender} size={22} />
      <span>{gender}</span>
    </span>
  ) : gender;
  const rows = [
    ['תעודת זהות', participant?.idNumber || '—', true],
    ['תאריך לידה', formatSignedDay(participant?.birthDate) || '—', true],
    ['מין', genderDisplay, false],
  ];

  return (
    <section
      aria-label="פרטי המשתתף מהתיק"
      style={{
        background: 'linear-gradient(135deg, var(--form-accent-soft-strong, rgba(249,115,22,.14)), rgba(255,255,255,.04))',
        border: '1px solid var(--form-accent-border, rgba(249,115,22,.38))',
        borderRadius: 18,
        padding: 20,
        marginBottom: 22,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 14, flexWrap: 'wrap', marginBottom: 18,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 800, color: 'var(--form-accent-text, #fdba74)', marginBottom: 5,
          }}>
            <Lock size={13} /> פרטי המשתתף/ת
          </div>
          <div style={{
            fontSize: 'clamp(25px, 5vw, 34px)', lineHeight: 1.15,
            fontWeight: 900, color: '#fff', overflowWrap: 'anywhere',
          }}>
            {participant?.name || '—'}
          </div>
        </div>
        {/* Only where the details are still being collected. On the declaration
            screen they are what is about to be signed, and a form does not offer
            to change the document while it is being signed. */}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,.06)',
              border: '1px solid rgba(255,255,255,.2)', borderRadius: 11,
              color: '#fff', padding: '9px 12px', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
            }}
          >
            <Pencil size={14} /> עריכת פרטים
          </button>
        )}
      </div>
      <dl style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 12, margin: 0,
      }}>
        {rows.map(([label, value, leftToRight]) => (
          <div key={label} style={{
            minWidth: 0, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,.1)',
          }}>
            <dt style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginBottom: 5 }}>{label}</dt>
            <dd
              dir={leftToRight ? 'ltr' : undefined}
              style={{
                margin: 0, fontSize: 'clamp(16px, 3vw, 20px)', color: '#fff', fontWeight: 800,
                textAlign: leftToRight ? 'right' : undefined,
                overflowWrap: 'anywhere',
              }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * הצבעים של פס המצב בכרטיס משתתף. ארבעה מצבים, לא ארבעה עותקים של אותו
 * style בתוך ארבעה בלוקים שנכתבו בזמנים שונים.
 */
const CARD_TONES = {
  ok: {
    bg: 'rgba(52,211,153,.08)',
    border: 'rgba(52,211,153,.3)',
    text: '#6ee7b7',
  },
  // צהוב וכחול קבועים, במכוון לא צבע-הנושא של הטופס: "חסרה הצהרה" חייב
  // להיראות צהוב גם בטופס שצבעו כחול, אחרת האזהרה נראית כמו עוד כותרת.
  warn: {
    bg: 'rgba(252,211,77,.09)',
    border: 'rgba(252,211,77,.45)',
    text: '#FCD34D',
  },
  info: {
    bg: 'rgba(56,189,248,.08)',
    border: 'rgba(56,189,248,.35)',
    text: '#7dd3fc',
  },
  attention: {
    bg: 'var(--form-accent-soft, rgba(249,115,22,.1))',
    border: 'var(--form-accent-border, rgba(249,115,22,.35))',
    text: 'var(--form-accent-text, #fdba74)',
  },
  stop: {
    bg: 'rgba(248,113,113,.12)',
    border: 'rgba(248,113,113,.35)',
    text: '#fca5a5',
  },
  muted: {
    bg: 'rgba(255,255,255,.04)',
    border: 'rgba(255,255,255,0.12)',
    text: 'rgba(255,255,255,0.8)',
  },
};

/** פס המצב: איפה עומדת ההצהרה של המשתתף הזה. אותו מקום בכל כרטיס. */
function CardStatus({ tone = 'muted', icon, title, children }) {
  const look = CARD_TONES[tone] || CARD_TONES.muted;
  return (
    <div style={{
      background: look.bg,
      border: `1px solid ${look.border}`,
      borderRadius: 12,
      padding: 12,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 14, fontWeight: 700, color: look.text,
        marginBottom: children ? 5 : 0,
      }}>
        {icon}
        <span>{title}</span>
      </div>
      {children ? (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.62)', lineHeight: 1.55 }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

const CARD_BUTTON_LOOKS = {
  ghost: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.18)',
    color: 'rgba(255,255,255,0.7)',
    fontWeight: 400,
  },
  offer: {
    background: 'transparent',
    border: '1px solid rgba(252,211,77,.6)',
    color: '#FCD34D',
    fontWeight: 700,
  },
  solid: {
    background: 'var(--form-accent-solid, #F97316)',
    border: '1px solid transparent',
    color: '#fff',
    fontWeight: 700,
  },
  danger: {
    background: 'rgba(248,113,113,.18)',
    border: '1px solid rgba(248,113,113,.5)',
    color: '#FCA5A5',
    fontWeight: 700,
  },
};

/** כפתור פעולה בכרטיס. הווריאנט אומר מה הכפתור עושה, לא איך הוא נראה. */
function CardButton({ variant = 'ghost', onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 10, fontFamily: 'inherit', fontSize: 13,
        padding: '9px 14px', cursor: 'pointer',
        ...(CARD_BUTTON_LOOKS[variant] || CARD_BUTTON_LOOKS.ghost),
      }}
    >
      {children}
    </button>
  );
}

/** שורת הפעולות של הכרטיס — תמיד אחת, תמיד למטה. */
function CardActions({ children }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
      {children}
    </div>
  );
}

function ParentProfileSummary({ parent, onEdit }) {
  const relationLabels = {
    father: 'אב',
    mother: 'אם',
    guardian: 'אפוטרופוס',
    other: 'אחר',
  };
  const fullName = joinParentName(parent?.name, parent?.lastName) || '—';
  const genderLabels = { male: 'זכר', female: 'נקבה' };
  // The email is the one value that does not survive a narrow column: broken
  // across two lines it reads as two addresses. It gets the whole row, and
  // shrinks to fit rather than wrapping.
  const rows = [
    ['תעודת זהות', parent?.idNumber || '—', { ltr: true }],
    ['טלפון', parent?.phone || '—', { ltr: true }],
    ['תאריך לידה', formatSignedDay(parent?.birthDate) || '—', { ltr: true }],
    ['מין', genderLabels[parent?.gender] || 'לא צוין', {}],
    ['מקום מגורים', parent?.city || '—', {}],
    ['קשר למשפחה', relationLabels[parent?.relation] || 'לא צוין', {}],
    ['אימייל', parent?.email || '—', { ltr: true, fullRow: true, oneLine: true }],
  ];

  return (
    <section
      aria-label="פרטי ממלא הטופס מהתיק"
      style={{
        background: 'linear-gradient(135deg, var(--form-accent-soft-strong, rgba(249,115,22,.14)), rgba(255,255,255,.04))',
        border: '1px solid var(--form-accent-border, rgba(249,115,22,.38))',
        borderRadius: 18,
        padding: 20,
        marginBottom: 22,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 14, flexWrap: 'wrap', marginBottom: 18,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 800, color: 'var(--form-accent-text, #fdba74)', marginBottom: 5,
          }}>
            <Lock size={13} /> פרטי ממלא/ת הטופס
          </div>
          <div style={{
            fontSize: 'clamp(25px, 5vw, 34px)', lineHeight: 1.15,
            fontWeight: 900, color: '#fff', overflowWrap: 'anywhere',
          }}>
            {fullName}
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.2)', borderRadius: 11,
            color: '#fff', padding: '9px 12px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
          }}
        >
          <Pencil size={14} /> עריכת פרטים
        </button>
      </div>
      <dl style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, margin: 0,
      }}>
        {rows.map(([label, value, { ltr, fullRow, oneLine } = {}]) => (
          <div key={label} style={{
            minWidth: 0, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,.1)',
            ...(fullRow ? { gridColumn: '1 / -1' } : null),
          }}>
            <dt style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginBottom: 5 }}>{label}</dt>
            <dd
              dir={ltr ? 'ltr' : undefined}
              style={{
                margin: 0, color: '#fff', fontWeight: 800,
                fontSize: oneLine ? 'clamp(13px, 2.2vw, 17px)' : 'clamp(15px, 2.7vw, 19px)',
                textAlign: ltr ? 'right' : undefined,
                ...(oneLine
                  ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                  : { overflowWrap: 'anywhere' }),
              }}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}


/**
 * The code screen, shown in place of the continue button on step 1.
 *
 * There is no way past it. A declaration signed from an unverified phone is
 * exactly the document this feature exists to prevent, so a failed send offers
 * a correction or a retry — never a way through.
 */
function PhoneCodeGate({ otp, phone, onCodeChange, onVerify, onResend, onEditPhone }) {
  const waitSeconds = Math.max(0, Math.ceil((otp.cooldownUntil - Date.now()) / 1000));
  // The code screen opens because the signer pressed "send me a code". Typing it
  // is the only thing left to do here, so the cursor is already in the field
  // rather than waiting to be put there.
  const codeRef = useRef(null);
  useEffect(() => {
    if (otp.sendFailed) return;
    codeRef.current?.focus();
  }, [otp.sendFailed]);
  return (
    <div style={{
      background: 'var(--form-accent-soft, rgba(249,115,22,.1))',
      border: '1px solid var(--form-accent-border, rgba(249,115,22,.35))',
      borderRadius: 12, padding: 14,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--form-accent-text, #fdba74)', marginBottom: 6 }}>
        אימות מספר הטלפון
      </div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)', lineHeight: 1.6, marginBottom: 12 }}>
        {otp.sendFailed
          ? <>לא הצלחנו לשלוח קוד למספר <strong>{phone}</strong>. בדקו שהמספר נכון ושיש בו וואטסאפ, ונסו שוב. בלי אימות אי אפשר להמשיך.</>
          : <>שלחנו קוד בן 6 ספרות בוואטסאפ למספר <strong>{phone}</strong>. הזינו אותו כדי להמשיך.</>}
        {otp.devCode ? ` (סביבת פיתוח: ${otp.devCode})` : ''}
      </div>

      {!otp.sendFailed && (
        <input
          ref={codeRef}
          value={otp.code}
          autoFocus
          onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="------"
          style={{
            width: '100%', textAlign: 'center', letterSpacing: 8, fontSize: 22,
            fontWeight: 800, padding: '12px 8px', borderRadius: 11,
            border: '1px solid rgba(255,255,255,.2)', background: '#0b1220',
            color: '#e2e8f0', font: 'inherit', direction: 'ltr',
          }}
        />
      )}
      {otp.error && (
        <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8 }}>{otp.error}</div>
      )}

      {!otp.sendFailed && (
        <button
          type="button"
          className="event-primary"
          style={{ marginTop: 12 }}
          disabled={otp.verifying || otp.code.length < 6}
          onClick={onVerify}
        >
          {otp.verifying ? 'מאמת…' : 'אישור והמשך'}
        </button>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onResend}
          disabled={otp.sending || waitSeconds > 0}
          style={{
            background: 'none', border: 'none', font: 'inherit', fontSize: 12,
            color: waitSeconds > 0 ? 'rgba(255,255,255,.4)' : 'var(--form-accent-text, #fdba74)',
            cursor: waitSeconds > 0 ? 'default' : 'pointer', textDecoration: 'underline',
            padding: 0,
          }}
        >
          {waitSeconds > 0 ? `שליחה חוזרת בעוד ${waitSeconds}` : 'שליחת קוד חדש'}
        </button>
        <button
          type="button"
          onClick={onEditPhone}
          style={{
            background: 'none', border: 'none', font: 'inherit', fontSize: 12,
            color: '#94a3b8', cursor: 'pointer', textDecoration: 'underline', padding: 0,
          }}
        >
          תיקון מספר הטלפון
        </button>
      </div>
    </div>
  );
}

const emptyChild = (questions = []) => {
  const answers = blankAnswers(questions);
  return {
    id: null,
    name: '',
    lastName: '',
    // "האם משתתף/ת בפעילות?" — עדיין לא נשאל. הכרטיס נפתח בשאלה הזאת,
    // ומצב ההצהרה מתגלה רק אחרי "כן".
    participates: null,
    idNumber: '',
    birthDate: '',
    gender: '',
    childPhone: '',
    registrationNotes: '',
    answers,
    // Free-text detail per screening question answered "yes", keyed by q.id.
    answerNotes: {},
    // Only asked of someone whose declaration is already in force: null until
    // they answer, and there is no way past the screen while it is null.
    healthChanged: null,
    healthAccepted: false,
    waiverAccepted: false,
    signature: '',
  };
};

function participantFromExistingStudent(student, questions = [], {
  type = 'child', forceHealthRenewal = false,
} = {}) {
  return {
    ...emptyChild(questions),
    id: student?.id || null,
    name: student?.name || '',
    lastName: student?.lastName || '',
    idNumber: student?.idNumber || '',
    birthDate: student?.birthDate || '',
    gender: participationGenderValue(student?.gender),
    type,
    onFileHealthValid: !!(student?.healthDocumentValid ?? student?.health_document_valid),
    onFileHealthDocumentValid: !!(student?.healthDocumentValid ?? student?.health_document_valid),
    onFileWaiverValid: !!(student?.waiverValid ?? student?.waiver_valid),
    onFileHealthSignedAt: student?.healthSignedAt || student?.health_signed_at || '',
    onFileWaiverSignedAt: student?.waiverSignedAt || student?.waiver_signed_at || '',
    onFileDeclarationSummary: student?.declarationSummary || null,
    renewOptIn: forceHealthRenewal,
    resignHealth: forceHealthRenewal,
    // Arriving on a renewal link is itself the answer, so the question is not
    // put again to someone who came to re-sign.
    healthChanged: forceHealthRenewal ? true : null,
    participates: forceHealthRenewal ? true : null,
  };
}



/**
 * The signing step shows one document per screen, in the order they are signed.
 *
 * The medical facts, the nature of the activity, and the waiver that binds it
 * are three different undertakings — and two of them are saved as two separate
 * records. Showing the activity clauses under a heading that said "הצהרת
 * בריאות" made the screen claim a grouping the file does not have.
 *
 * The signature sits on the last screen and covers all of them.
 */
/**
 * An icon per medical question, in the house colours.
 *
 * Nine questions in identical grey cards read as one wall of text, and a parent
 * scrolling for the one about medication had nothing to aim at. The icon is a
 * landmark, not decoration, so each question gets its own — and a question with
 * no icon simply gets none rather than a shared placeholder that means nothing.
 */
const QUESTION_ICONS = {
  m1: [Wind, '#7DD3FC'],
  m2: [HeartPulse, '#FCA5A5'],
  m3: [Brain, '#C4B5FD'],
  m4: [Bone, '#FCD34D'],
  m5: [Stethoscope, '#5EEAD4'],
  m6: [Pill, '#6EE7B7'],
  m7: [ShieldAlert, '#FDBA74'],
  m8: [FileWarning, '#FCD34D'],
  m11: [Baby, '#F9A8D4'],
  m9: [HelpCircle, '#94A3B8'],
};

/**
 * What the activity is, before the rules that follow from it.
 *
 * Prose rather than tick boxes on purpose: this part is read, not agreed to —
 * what is agreed to is the list under it and the waiver after it. Kept per
 * scope, because a trip's risks are not a wall's.
 */
const ACTIVITY_NATURE = {
  wall: [
    'טיפוס ספורטיבי הוא פעילות אתגרית מהנה, אבל היא גם כרוכה בסיכונים.',
    'הפעילות כוללת עלייה לגובה, עבודה עם ציוד בטיחות והסתמכות על בן זוג מאבטח. הסיכונים העיקריים הם:',
    '• נפילה מגובה — עלולה לגרום לפציעה חמורה, נכות או מוות',
    '• עומס חוזר על הידיים והמפרקים — עלול לגרום לפגיעה ברקמות רכות',
    '• פגיעה ממטפסים אחרים — נפילת ציוד או מטפס מגובה עלולה לגרום לפציעה',
    'סיכונים אלו קיימים גם בהקפדה מלאה על כללי הבטיחות.',
  ].join('\n\n'),
  trip: [
    'יציאה לשטח היא פעילות אתגרית מהנה, אבל היא גם כרוכה בסיכונים.',
    'הפעילות מתקיימת בשטח פתוח וכוללת הליכה, טיפוס, גלישה על חבל (סנפלינג) ולעיתים כניסה למערה, עם ציוד בטיחות ובהשגחת מדריך. הסיכונים העיקריים הם:',
    '• נפילה מגובה או התדרדרות בשטח — עלולה לגרום לפציעה חמורה, נכות או מוות',
    '• התדרדרות אבנים, ופגיעה מציוד או ממשתתפים אחרים',
    '• תנאי שטח ומזג אוויר — חום, קור, רטיבות והחלקה, ובמערה גם חושך וחללים צרים',
    '• ריחוק ממענה רפואי מיידי, והנסיעה אל אתר הפעילות וממנו',
    'סיכונים אלו קיימים גם בהקפדה מלאה על כללי הבטיחות.',
  ].join('\n\n'),
};

/** The two mailing lists: one that is part of the service, one that is not. */
const LIST_ICONS = {
  operational: [BellRing, '#6EE7B7'],
  marketing: [Megaphone, '#FCD34D'],
};

const SUB_HEALTH = 1;
const SUB_ACTIVITY = 2;
const SUB_WAIVER = 3;
// Only when the form was opened from an event page: what is being booked, what
// it costs, and the terms of cancelling it. Signing comes first — payment is
// the last thing that happens, and it is what puts the participants on the list.
const SUB_PAYMENT = 4;

export default function PublicOnboardingForm() {
  const { profile, legalName } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url && profile.logo_url !== '/logo.png'
    ? profile.logo_url
    : '/brand/logo-kirboaz.png';
  const fallbackWaiver = useMemo(() => buildFallbackWaiver(legalName), [legalName]);
  const fallbackQuestions = useMemo(() => buildFallbackQuestions(legalName), [legalName]);
  const [searchParams] = useSearchParams();
  const healthOnlyMode = searchParams.get('mode') === 'health-renewal';
  const targetStudentId = String(searchParams.get('studentId') || '').trim();
  // Opened from an event page (`/event/<slug>` → here). The form then registers
  // the family for that outing and ends at payment, instead of only filing
  // their details. The activity itself is the authority on which declaration is
  // signed, what it costs and how many places are left.
  const eventSlug = String(searchParams.get('event') || '').trim();
  const [activity, setActivity] = useState(null);
  const [activityError, setActivityError] = useState('');
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [signedSnapshot, setSignedSnapshot] = useState(null);
  const [idempotencyKey] = useState(
    () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  );
  const eventMode = !!eventSlug;
  // A link to one particular declaration (/health/<slug>). Without one the
  // default template arrives with the onboarding context below.
  const { slug: routeSlug } = useParams();
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [childHealthIndex, setChildHealthIndex] = useState(0);
  const [healthSubStep, setHealthSubStep] = useState(SUB_HEALTH);
  // The activity clauses and the waiver are agreed to once, by the signer, for
  // everyone they are signing for — so their state lives on the form and not on
  // a participant. Each participant's record still receives its own copy.
  const [activityConfirmed, setActivityConfirmed] = useState({});
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [healthDeclarationAccepted, setHealthDeclarationAccepted] = useState(false);
  const [listDefs, setListDefs] = useState([]);
  const [requiredListKey, setRequiredListKey] = useState('operational');
  const [subscriptions, setSubscriptions] = useState({ classes: true });
  // No interest picker on this form any more — staff set it in the CRM. Kept as
  // state only so a prefilled link (?interest=) still passes it through.
  const [interest, setInterest] = useState(searchParams.get('interest') || '');
  const [template, setTemplate] = useState(null);
  // `name` is the first name only; the surname has its own field. Everything
  // downstream that wants one string uses parentFullName() below.
  const [parent, setParent] = useState({
    name: '',
    lastName: '',
    idNumber: '',
    relation: '',
    phone: searchParams.get('phone') || '',
    email: '',
    city: '',
    gender: '',
    birthDate: '',
  });
  const [children, setChildren] = useState([emptyChild()]);
  const [selfStudent, setSelfStudent] = useState(null);
  const [isAdultSelf, setIsAdultSelf] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [savedDeclarations, setSavedDeclarations] = useState([]);
  const [error, setError] = useState('');
  const [uploadingPdfs, setUploadingPdfs] = useState(false);
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const pageTopRef = useRef(null);

  // The browser tab is the only place the customer sees what this link is.
  useEffect(() => {
    document.title = `${brandName} - טופס השתתפות`;
  }, [brandName]);

  // The app shell scrolls inside #root (the body itself is fixed), so the
  // browser does not reset the scroll position when React swaps one form step
  // for the next. Reset every real screen transition, including the health /
  // waiver sub-steps and the next family member.
  useEffect(() => {
    if (loading) return undefined;
    const frame = requestAnimationFrame(() => {
      const root = document.getElementById('root');
      if (root) root.scrollTop = 0;
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      pageTopRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [step, healthSubStep, childHealthIndex, isSuccess, loading]);

  const allQuestions = (template?.healthQuestions?.length
    ? template.healthQuestions
    : fallbackQuestions).filter((question) => !(
    String(template?.slug || routeSlug || '').toLowerCase() === 'trip'
    && String(question?.id || '').toLowerCase() === 's1'
  ));
  // A family submission may contain the signer and minor children together.
  // Legal clauses therefore depend on the participant currently being filled.
  const templateScreeningQuestions = allQuestions.filter(isScreeningQuestion);
  const healthOnlyQuestions = templateScreeningQuestions.length
    ? templateScreeningQuestions
    : CANONICAL_HEALTH_QUESTIONS;
  const questionsForParticipant = (participant) => questionsForSigner(
    healthOnlyMode ? healthOnlyQuestions : allQuestions, {
    isAdultSelf: participant?.type === 'adult',
    isAdultFemale: signsAsAdultFemale(participant),
    }
  );
  /** The medical questions and the activity clauses, as two separate screens. */
  const screeningFor = (participant) => questionsForParticipant(participant).filter(isScreeningQuestion);
  const confirmationsFor = (participant) => questionsForParticipant(participant)
    .filter((q) => !isScreeningQuestion(q));
  /**
   * The clauses to present once for the whole family: every clause that applies
   * to at least one of the participants being signed for. A clause aimed at a
   * child is still not written onto an adult's record — that happens when the
   * tick is copied out, per participant.
   */
  const sharedConfirmationList = (participants) => {
    const seen = new Map();
    (participants || []).forEach((participant) => {
      confirmationsFor(participant).forEach((q) => {
        if (q?.id && !seen.has(q.id)) seen.set(q.id, q);
      });
    });
    return [...seen.values()];
  };
  // The signer's own name goes into the summary they read, and into a template
  // written with {{שם החותם}} — the same person either way.
  const signerName = joinParentName(parent.name, parent.lastName);
  const waiverText = withSignerName(template?.waiverText || fallbackWaiver, signerName);
  // הצהרת בריאות היא אחת לאדם ותקפה לכל הפעילויות. „הצהרת בריאות לטיול”
  // תיארה מסמך שלא קיים — מה שנפרד לפי פעילות הוא הסרת האחריות בלבד.
  const declarationContextLabel = 'הצהרת בריאות';
  // The three parts of the declaration, each named — the same headings the
  // activity page shows, so a family meets one document twice, not two.
  const sectionTitles = declarationSectionTitles({ ...(template || {}), waiverText });
  const waiverBody = splitWaiverText(waiverText).body;
  // Phone verification. The token is what the submit sends; `verifiedPhone`
  // remembers which number earned it, so editing the phone re-triggers the
  // code. `sendFailed` opens the continue-without gate — a delivery problem on
  // our side must not lock a family out of registering.
  const [otp, setOtp] = useState({
    stage: 'idle', token: '', verifiedPhone: '', code: '',
    sending: false, verifying: false, error: '', cooldownUntil: 0,
    sendFailed: false, devCode: '',
  });
  // Re-rendered every second while the code screen is up, so the resend
  // button's countdown moves.
  const [, setOtpTick] = useState(0);
  useEffect(() => {
    if (otp.stage !== 'code') return undefined;
    const id = setInterval(() => setOtpTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [otp.stage]);

  /**
   * The acceptance box opens once the end of the binding text has been on the
   * screen. A tick on a contract nobody reached the bottom of is exactly the
   * signature that does not hold up later — and now that the text flows on the
   * page rather than sitting in a box of its own, what proves it is the page's
   * own scroll reaching the last line.
   */
  const [waiverRead, setWaiverRead] = useState(false);
  const waiverEndRef = useRef(null);

  /**
   * What the signing session looked like, for the sealed evidence record.
   *
   * Three things a signature alone cannot show: how long each screen was open,
   * when each box was ticked, and the moment the end of the binding text was
   * actually on the screen — which is what separates "ticked" from "read".
   * Kept in a ref, because recording it must never cause a re-render.
   */
  const sessionEvidence = useRef({ screens: [], ticks: {}, waiverEndSeenAt: null });

  const recordTick = (id, checked) => {
    const at = new Date().toISOString();
    const log = sessionEvidence.current.ticks;
    log[id] = checked === false
      ? { ...(log[id] || {}), clearedAt: at }
      : { ...(log[id] || {}), tickedAt: at };
  };

  const screenKey = () => {
    if (step !== 3) return `step-${step}`;
    if (healthSubStep === SUB_HEALTH) return `health:${childHealthIndex + 1}`;
    if (healthSubStep === SUB_ACTIVITY) return 'safety-rules';
    if (healthSubStep === SUB_PAYMENT) return 'booking-and-payment';
    return 'waiver-and-signature';
  };

  // Each participant reads for themselves: entering the screen resets the gate.
  useEffect(() => {
    if (healthSubStep !== SUB_WAIVER) return undefined;
    setWaiverRead(false);
    const el = waiverEndRef.current;
    if (!el || typeof IntersectionObserver !== 'function') {
      // No observer to lean on — do not lock a signer out of their own form.
      setWaiverRead(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      sessionEvidence.current.waiverEndSeenAt ||= new Date().toISOString();
      setWaiverRead(true);
    }, { root: null, threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [healthSubStep, childHealthIndex]);

  useEffect(() => {
    if (loading || isSuccess) return undefined;
    const key = screenKey();
    const entry = { screen: key, enteredAt: new Date().toISOString(), leftAt: null };
    sessionEvidence.current.screens.push(entry);
    return () => { entry.leftAt = new Date().toISOString(); };
  }, [step, healthSubStep, childHealthIndex, loading, isSuccess]);

  // participant key -> { match, student_id, guardian_first_name, health_valid, linked }
  const [knownChildren, setKnownChildren] = useState({});
  const [prefilledParentId, setPrefilledParentId] = useState('');
  // Two adults are a household's limit here: a third is a staff-side change.
  const [householdParentCount, setHouseholdParentCount] = useState(0);
  const [editingParentProfile, setEditingParentProfile] = useState(false);
  // A file was recognised from a phone number. Saying "this is me" is what turns
  // that into an identification the signer stands behind.
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  // Set once the typed phone turns out to be on a file already: { name, children }.
  const [knownFile, setKnownFile] = useState(null);
  const [identityStatus, setIdentityStatus] = useState('unverified');
  // Surname match: asked live as soon as last name (+ phone) look like a known family.
  const {
    families,
    familyParentId,
    setFamilyParentId,
    familyCheckComplete,
    waitingForFamily,
  } = useFamilyMatch(parent.lastName, parent.phone, {
    skip: identityStatus !== 'new',
    verificationToken: otp.token,
  });
  /**
   * The classes list is forced only when the form was opened in order to join a
   * class — there the schedule updates are part of the service. A trip form or a
   * medical renewal is a different errand, and forcing a subscription through
   * them would be signing someone up to a list they never came for.
   */
  const isTripForm = String(template?.slug || routeSlug || '').trim().toLowerCase() === 'trip';
  const classSignupForm = !healthOnlyMode && !isTripForm;
  const effectiveRequiredListKey = classSignupForm ? requiredListKey : '';

  const identityReady = !!otp.token && ['found', 'new'].includes(identityStatus);
  /**
   * What the file does not hold yet. A returning parent whose card predates a
   * field was shown a locked summary and a "continue" button that refused —
   * with no field in sight. Now the editor opens on identification and the gaps
   * are the only things marked.
   */
  const MISSING_LABELS = {
    name: 'שם פרטי',
    birthDate: 'תאריך לידה',
    lastName: 'שם משפחה',
    email: 'אימייל',
    city: 'מקום מגורים',
    gender: 'מין',
    relation: 'קשר למשתתפים',
  };
  /**
   * The form talks to one person. Once they have said whether they are a man or
   * a woman, "משתתף/ת" is a form that fits nobody — so every sentence addressed
   * to them picks a side, and falls back to the slashed form only while their
   * gender is still unknown.
   */
  const g = (male, female, unknown) => {
    if (parent.gender === 'male') return male;
    if (parent.gender === 'female') return female;
    return unknown ?? `${male}/${female.slice(-1)}`;
  };

  const relationRequired = false;
  const missingParentFields = Object.keys(MISSING_LABELS)
    .filter((field) => (field === 'relation' ? relationRequired : true))
    .filter((field) => !String(parent[field] || '').trim());
  const isMissing = (field) => missingParentFields.includes(field);
  /** The same yellow ring, for a participant card's own required fields. */
  const emptyStyle = (value) => (String(value || '').trim()
    ? undefined
    : { borderColor: 'rgba(252,211,77,.55)', background: 'rgba(251,191,36,.07)' });

  const missingStyle = (field) => (isMissing(field)
    ? { borderColor: 'rgba(252,211,77,.55)', background: 'rgba(251,191,36,.07)' }
    : undefined);
  // The same test `goNextFromParent` applies before it sends a code, so the
  // button can say which of the two things the next press actually does.
  const needsPhoneVerification = !otp.token || otp.verifiedPhone !== parent.phone.trim();
  const parentProfileLocked = identityReady && !!prefilledParentId && !editingParentProfile;
  // Below `parentProfileLocked`, and it has to stay there: a dependency array is
  // read while the component renders, so naming a const declared further down
  // throws before the first screen is painted.
  useEffect(() => {
    if (!identityReady || healthOnlyMode) return;
    if (parentProfileLocked && missingParentFields.length) setEditingParentProfile(true);
  }, [identityReady, healthOnlyMode, parentProfileLocked, missingParentFields.length]);

  // Which participant has already been told their ID looks wrong, so the
  // warning is a warning and not a wall.
  // Everyone already warned about, not just the last one: with a single value,
  // two foreign documents in one family alternated warnings forever and the
  // form could never be passed.
  const [idWarnedFor, setIdWarnedFor] = useState([]);
  // Which set of unanswered renewal offers has already been named on screen.
  // Keyed by the names themselves, so answering one and leaving another still
  // gets its own warning.
  const [skipWarnedFor, setSkipWarnedFor] = useState('');

  /**
   * The parent's name as one string, always first name then surname. The CRM
   * stores this alongside the separate surname, so records stay readable even
   * where only a single name field exists.
   */
  const parentFullName = () => joinParentName(parent.name, parent.lastName);

  const changeParentPhone = (phone) => {
    const nextPhone = String(phone || '');
    const identityWasLoaded = !!prefilledParentId || !!knownFile;
    setParent((current) => ({ ...current, phone: nextPhone }));
    setOtp((current) => ({
      ...current,
      stage: 'idle',
      token: '',
      verifiedPhone: '',
      code: '',
      error: '',
      sendFailed: false,
      devCode: '',
    }));
    setPrefilledParentId('');
    setKnownFile(null);
    setSelfStudent(null);
    setFamilyParentId(null);
    setKnownChildren({});
    setIdentityStatus('unverified');
    if (identityWasLoaded) {
      setIsAdultSelf(false);
      setChildren([emptyChild(allQuestions)]);
    }
    setError('');
  };

  const changeParentIdNumber = (idNumber) => {
    const identityWasLoaded = !!prefilledParentId || !!knownFile;
    setParent((current) => ({ ...current, idNumber: String(idNumber || '') }));
    setOtp((current) => ({
      ...current, stage: 'idle', token: '', verifiedPhone: '', code: '', error: '',
      sendFailed: false, devCode: '',
    }));
    setPrefilledParentId('');
    setKnownFile(null);
    setSelfStudent(null);
    setFamilyParentId(null);
    setKnownChildren({});
    setIdentityStatus('unverified');
    if (identityWasLoaded) {
      setIsAdultSelf(false);
      setChildren([emptyChild(allQuestions)]);
    }
    setError('');
  };

  /**
   * Participants are asked for a first name only — the family name is already
   * on the parent's card, and typing it twice is how the two drift apart. It is
   * still appended before the name is sent, so attendance lists and the child
   * matcher keep working on a full name.
   *
   * A name that already carries a surname is left exactly as typed: a child
   * whose family name differs from the parent's is the case that must not be
   * overwritten.
   */
  const childFullName = (child) => {
    const typed = String(child?.name || '').trim().replace(/\s+/g, ' ');
    if (!typed || typed.includes(' ')) return typed;
    const surname = String(child?.lastName || '').trim()
      || (child?.type !== 'adult' ? String(parent.lastName || '').trim() : '');
    return joinParentName(typed, surname);
  };

  /**
   * שם המשפחה שנשלח לתיק: מה שהוקלד בשדה; לילד בלי שדה מלא — של ההורה;
   * לשם מלא מהתיק — אותו ניחוש שהמערכת עשתה תמיד (המילה האחרונה), כדי
   * שהשדה החדש יתמלא גם לרשומות ותיקות.
   */
  const participantLastName = (child) => {
    const typed = String(child?.lastName || '').trim();
    if (typed) return typed;
    if (child?.relationToSigner === 'self') return String(parent.lastName || '').trim();
    const name = String(child?.name || '').trim();
    if (name.includes(' ')) return splitParentName({ name }).lastName;
    return child?.type !== 'adult' ? String(parent.lastName || '').trim() : '';
  };

  /** Children have no stable id until they are saved — identify them by what was typed. */
  const childKey = (child) => `${String(child?.name || '').trim()}|${child?.birthDate || ''}`;

  /**
   * A parent or guardian signs for their minors only — an adult signs for
   * themselves, whoever their parent is. So a participant on the file who has
   * reached 18 is not part of what this parent can submit, and the form says
   * so instead of quietly asking them to sign for an adult.
   */
  const needsOwnSignature = (child) => {
    if (child?.type === 'adult') return false;
    const age = ageFromBirthDate(child?.birthDate);
    return age !== null && age >= 18;
  };

  /**
   * Left out of this submission: either the parent said this person is not
   * participating — someone who moved abroad or stopped climbing is a real
   * answer — or they are an adult who has to sign for themselves.
   */
  const skipsThisRound = (child) => child?.participates === false
    || (!!child?.id && needsOwnSignature(child));

  /**
   * "האם משתתף/ת בפעילות?" has not been answered yet. Every card opens with
   * that question — a declaration in force included, because being covered
   * says nothing about whether this person is coming. An unanswered card is
   * simply not part of the submission.
   */
  const awaitingParticipationChoice = (child) => child?.participates == null
    && !skipsThisRound(child);

  /**
   * בן/בת זוג שאינם עדיין בתיק המשפחה, כשנרשמים לאירוע. אי אפשר לחתום עבור
   * מבוגר/ת אחר/ת — השרת דוחה זאת — ולכן שומרים להם מקום ומשלמים עכשיו,
   * והקישור לחתימה נשלח אליהם לטלפון שנמסר כאן.
   */
  const defersDocuments = (child) => eventMode
    && child?.relationToSigner === 'spouse'
    && !child?.id;

  /**
   * Whether this participant is part of this submission at all: everyone the
   * parent said is coming, minus anyone who has to sign for themselves.
   */
  const joinsThisRound = (child) => !skipsThisRound(child)
    && !awaitingParticipationChoice(child);

  /**
   * Whether this participant gets a medical screen. Everyone in the submission
   * does, and everyone answers it in full: the declaration is short, so it is
   * simply filled afresh on every visit — a declaration in force only changes
   * what the card says will happen, never what is asked.
   */
  const fillsDeclaration = (child) => joinsThisRound(child) && !defersDocuments(child);

  /**
   * The signer's own card, already answered on the details step: name, id,
   * date of birth and gender all came from there, so the card shows them back
   * instead of asking a second time.
   */
  const selfCardFromDetails = (child) => child?.type === 'adult'
    && !child?.editProfile
    && !!String(child?.name || '').trim()
    && !!String(child?.idNumber || '').trim()
    && !!String(child?.birthDate || '').trim()
    && !!String(child?.gender || '').trim();

  /**
   * What this participant is to the person filling the form: the signer is
   * whatever they said their relation is, and everyone else is a child.
   */
  const participantRelationLabel = (child) => {
    if (child?.relationToSigner === 'self') {
      if (child?.gender === 'female') return 'ממלאת הטופס';
      if (child?.gender === 'male') return 'ממלא הטופס';
      return 'ממלא/ת הטופס';
    }
    if (child?.relationToSigner === 'spouse') return 'בן/בת זוג';
    if (child?.relationToSigner === 'child') {
      if (child?.gender === 'female') return 'הבת שלי';
      if (child?.gender === 'male') return 'הבן שלי';
      return 'הילד/ה שלי';
    }
    if (child?.type === 'adult') return 'מבוגר/ת';
    if (child?.gender === 'female') return 'ילדה';
    if (child?.gender === 'male') return 'ילד';
    return 'ילד/ה';
  };

  /** Whether this card's own identity fields are asked for on the participants step. */
  const fillsOwnDetails = (child) => joinsThisRound(child);

  /**
   * מצב הכרטיס — עובדה אחת שממנה נגזרים פס המצב, הכפתורים והשדות. קודם כל
   * מצב היה תנאי נפרד ליד תנאי, וכל תיקון הוסיף עוד אחד; ככה השאלה „מה רואים
   * עכשיו” נענית פעם אחת:
   *
   *   blocked       — בגר, וההורה לא יכול לחתום עליו
   *   skipped       — נאמר עליו „לא משתתף”
   *   undecided     — „האם משתתף/ת בפעילות?” עוד לא נענתה
   *   participating — ענה „כן”: ההצהרה תמולא (או תרוענן) במסכים הבאים —
   *                   תמיד מחדש; ההצהרה קצרה, ומנגנון שלם של „בתוקף / לחדש /
   *                   משהו השתנה” עלה בבלבול יותר משחסך בזמן
   */
  const participantCardState = (child) => {
    if (child?.id && needsOwnSignature(child)) return 'blocked';
    if (child?.participates === false) return 'skipped';
    if (child?.participates !== true) return 'undecided';
    return 'participating';
  };

  /**
   * התשובה לשאלת ההשתתפות. „כן” מדליק גם renewOptIn למי שכבר בתיק — זה מה
   * שמשאיר את הפרופיל שלו נעול (isExistingDeclarationRenewal) במסך ההצהרה
   * במקום לפתוח את השדות מחדש.
   */
  const answerParticipation = (index, yes) => updateChild(index, () => (yes
    ? {
      participates: true,
      confirmSkip: false,
      renewOptIn: true,
    }
    : { participates: false, confirmSkip: false }));

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const params = new URLSearchParams();
      ['parentId', 'studentId', 'phone'].forEach((key) => {
        const v = searchParams.get(key);
        if (v) params.set(key, v);
      });
      // Which form this is. "Already has a declaration in force" is only an
      // answer about a particular one — a child covered for the wall still has
      // to sign before a trip.
      const wantedSlug = routeSlug || searchParams.get('template') || '';
      if (wantedSlug) params.set('templateSlug', wantedSlug);
      try {
        const res = await fetch(`/api/public/onboard-context?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        let defs = Array.isArray(data.listDefs) ? data.listDefs : [];
        if (!defs.length) {
          try {
            const defsRes = await fetch('/api/public/broadcast-list-defs');
            if (defsRes.ok) {
              const raw = await defsRes.json();
              if (Array.isArray(raw)) defs = raw;
            }
          } catch {
            // keep empty
          }
        }
        if (!defs.length) {
          defs = [
            { key: 'operational', label: 'תפעולי', description: 'שינויי שעות, ביטולים ותזכורות' },
            { key: 'marketing', label: 'שיווקי', description: 'טיולים חדשים, מבצעים ועדכונים כלליים' },
          ];
        }
        setListDefs(defs);

        const reqKey = typeof data.requiredListKey === 'string' ? data.requiredListKey : 'operational';
        setRequiredListKey(reqKey);
        const subs = { ...(data.subscriptions || {}) };
        // Ensure every known list has a boolean; only classes forced on
        defs.forEach((l) => {
          if (l.key === reqKey) subs[l.key] = true;
          else if (subs[l.key] === undefined) subs[l.key] = false;
        });
        subs[reqKey] = true;
        setSubscriptions(subs);

        if (!res.ok) {
          // Still allow filling the form with list defs loaded above
          return;
        }
        if (data.template) setTemplate(data.template);
        const qs = data.template?.healthQuestions?.length
          ? data.template.healthQuestions
          : fallbackQuestions;
        if (data.parent) {
          // Opened from a link that already knows this parent — no family
          // question needed, we are on their file already.
          setPrefilledParentId(data.parent.id || '');
          const knownName = splitParentName(data.parent);
          // Every key the inputs bind to, even when the file has no value —
          // a missing key turns its input uncontrolled and React drops what
          // gets typed into it.
          setParent({
            name: knownName.first,
            lastName: knownName.lastName,
            idNumber: data.parent.idNumber || '',
            relation: data.parent.relation || '',
            phone: data.parent.phone || searchParams.get('phone') || '',
            email: data.parent.email || '',
            city: data.parent.city || '',
            gender: participationGenderValue(data.parent.gender) || '',
            birthDate: data.parent.birthDate || '',
          });
        }
        setSelfStudent(data.selfStudent || null);
        if (Array.isArray(data.students) && data.students.length) {
          setChildren(data.students.map((s) => {
            // Unanswered, not "no". Filling these in as false meant a returning
            // family opened the questionnaire with every medical question
            // already answered on their behalf — and a parent who scrolled past
            // it would have declared, in signature, that nothing applies.
            const answers = blankAnswers(qs);
            return {
              id: s.id,
              name: s.name || '',
              idNumber: s.idNumber || '',
              birthDate: s.birthDate || '',
              gender: participationGenderValue(s.gender),
              childPhone: '',
              registrationNotes: '',
              answers,
              answerNotes: {},
              // Already on file with a declaration in force. The form shows
              // that rather than asking them to fill everything in again.
              onFileHealthValid: !!(s.healthDocumentValid ?? s.health_document_valid),
              onFileHealthDocumentValid: !!(s.healthDocumentValid ?? s.health_document_valid),
              onFileWaiverValid: !!(s.waiverValid ?? s.waiver_valid),
              onFileHealthSignedAt: s.healthSignedAt || s.health_signed_at || '',
              onFileWaiverSignedAt: s.waiverSignedAt || s.waiver_signed_at || '',
              onFileDeclarationSummary: s.declarationSummary || null,
              resignHealth: false,
              healthChanged: null,
              waiverAccepted: false,
              signature: '',
            };
          }));
        } else {
          setChildren([emptyChild(qs)]);
        }
      } catch {
        // keep fallbacks — still try public list defs
        try {
          const defsRes = await fetch('/api/public/broadcast-list-defs');
          if (defsRes.ok) {
            const raw = await defsRes.json();
            if (Array.isArray(raw) && raw.length && !cancelled) setListDefs(raw);
          }
        } catch {
          // ignore
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [searchParams, fallbackQuestions]);

  /**
   * The outing this form is registering for. Its own declaration template wins
   * over the one in the address: the event row is what decides what is signed
   * for it, and a link with the wrong template in it must not change that.
   */
  useEffect(() => {
    if (!eventSlug) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/activities/${encodeURIComponent(eventSlug)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setActivityError(data.error || 'הפעילות לא נמצאה');
          return;
        }
        setActivity(data);
        if (data.form_template?.id) setTemplate(data.form_template);
      } catch {
        if (!cancelled) setActivityError('טעינת הפעילות נכשלה — רעננו את הדף');
      }
    })();
    return () => { cancelled = true; };
  }, [eventSlug]);

  /**
   * A link that names a declaration (/health/<slug>, or ?template=) overrides
   * the default template loaded above. A slug we do not know simply leaves the
   * default in place — a wrong link must never leave the family with no form.
   */
  useEffect(() => {
    // An event link carries its own template, fetched above.
    if (eventSlug) return;
    const slug = routeSlug || searchParams.get('template') || '';
    if (!slug || slug === 'default') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/form-templates/${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data && data.id) setTemplate(data);
      } catch {
        // keep the default template
      }
    })();
    return () => { cancelled = true; };
  }, [routeSlug, searchParams]);

  const initCanvas = () => {
    setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = 150;
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
    }, 80);
  };

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    setIsDrawing(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => setIsDrawing(false);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  };

  /**
   * `patch` may be a function of the current participant, which is the only
   * safe form when several updates can land in one render — answering a row of
   * health questions quickly, for instance, where a patch built from a captured
   * copy would drop every answer but the last.
   */
  const updateChild = (index, patch) => {
    setChildren((prev) => prev.map((c, i) => (
      i === index ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c
    )));
  };

  const addChild = () => {
    setChildren((prev) => {
      // כשהרשימה כבר אושרה כ"אלו הם ילדיי", ילד שנוסף עכשיו מכוסה באותו
      // אישור — ההורה מקליד אותו בעצמו ברגע זה.
      const kids = prev.filter((c) => c.type !== 'adult' && String(c.name || '').trim());
      const confirmed = kids.length > 0 && kids.every((c) => c.relationToSigner === 'child');
      return [...prev, {
        ...emptyChild(allQuestions),
        // הוספה ידנית היא עצמה התשובה "משתתף" — אף אחד לא מוסיף כרטיס
        // בשביל מי שלא בא לטפס.
        participates: true,
        ...(confirmed ? { relationToSigner: 'child' } : null),
      }];
    });
  };

  /** A second adult on the same submission — marked as the spouse from the start. */
  const addSpouse = () => {
    setChildren((prev) => [...prev, {
      ...emptyChild(allQuestions),
      type: 'adult',
      relationToSigner: 'spouse',
      participates: true,
    }]);
  };


  const setAdultSelfMode = (enabled) => {
    setIsAdultSelf(enabled);
    if (enabled) {
      const currentAdult = children.find((child) => child.type === 'adult');
      if (!currentAdult) setChildren((current) => [{
        ...emptyChild(allQuestions),
        ...adultParticipantFromContext(selfStudent, {
          fullName: parentFullName(),
          gender: parent.gender,
          birthDate: parent.birthDate,
          idNumber: parent.idNumber,
        }),
        relationToSigner: 'self',
        onFileHealthValid: !!selfStudent?.healthDocumentValid,
        onFileHealthDocumentValid: !!selfStudent?.healthDocumentValid,
        onFileWaiverValid: !!selfStudent?.waiverValid,
        onFileHealthSignedAt: selfStudent?.healthSignedAt || '',
        onFileWaiverSignedAt: selfStudent?.waiverSignedAt || '',
        onFileDeclarationSummary: selfStudent?.declarationSummary || null,
      }, ...current]);
    } else {
      const currentAdult = children.find((child) => child.type === 'adult');
      if (currentAdult) setSelfStudent(currentAdult);
      setChildren((current) => {
        const withoutAdult = current.filter((child) => child.type !== 'adult');
        return withoutAdult.length ? withoutAdult : [emptyChild(allQuestions)];
      });
    }
  };

  /**
   * "We already know this phone" — the household lookup the form was missing.
   *
   * Children already on the file are added to the participant list rather than
   * left invisible, so a returning parent adds the new one instead of a second
   * copy of the one who is already there. Anything typed here wins over what is
   * stored: the parent is looking at the form, we are not.
   *
   * The result distinguishes a real miss from a network/server error. Treating
   * both as "new family" is how a temporary lookup failure creates duplicates.
   */
  const lookupOwnFile = async (phone, idNumber = '', verificationToken = otp.token) => {
    const digits = String(phone || '').replace(/\D/g, '');
    const idDigits = String(idNumber || '').replace(/\D/g, '');
    if (digits.length < 9 && idDigits.length < 5) return { status: 'missing' };
    try {
      const params = new URLSearchParams({ phone: phone || '', idNumber: idDigits });
      if (healthOnlyMode && targetStudentId) params.set('studentId', targetStudentId);
      if (template?.slug) params.set('templateSlug', template.slug);
      if (verificationToken) params.set('verificationToken', verificationToken);
      const res = await fetch(`/api/public/onboard-context?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.identity_status === 'review_required') {
          setIdentityStatus('review_required');
          return { status: 'review_required', error: data.error };
        }
        return { status: 'error' };
      }
      if (!data?.parent?.id) {
        setIdentityStatus(data.identity_status === 'new' ? 'new' : 'unverified');
        setKnownFile(null);
        return { status: data.identity_status === 'new' ? 'new' : 'missing' };
      }

      setSelfStudent(data.selfStudent || null);

      setPrefilledParentId(data.parent.id);
      setHouseholdParentCount(Number(data.householdParentCount) || 0);
      setEditingParentProfile(false);
      setIdentityStatus('found');
      setFamilyParentId(null);
      const knownName = splitParentName(data.parent);
      setParent((current) => ({
        ...current,
        name: current.name.trim() || knownName.first,
        lastName: current.lastName.trim() || knownName.lastName,
        idNumber: current.idNumber.trim() || data.parent.idNumber || '',
        relation: current.relation || data.parent.relation || '',
        email: current.email.trim() || data.parent.email || '',
        city: current.city.trim() || data.parent.city || '',
        // מנורמל: תיק שנפתח בצוות יכול לשאת 'זכר'/'נקבה', והכפתורים בטופס
        // מכירים רק male/female — ערך לא מנורמל נראה כמו שדה ריק.
        gender: current.gender || participationGenderValue(data.parent.gender) || '',
        birthDate: current.birthDate || data.parent.birthDate || '',
        // Keep the exact number that earned the active OTP token.
        phone: current.phone,
      }));
      setKnownFile({
        name: data.parent.name || '',
        children: (data.students || []).map((s) => s.name).filter(Boolean),
      });
      // העדפות הדיוור של התיק שזה עתה זוהה. הן נקראו רק בטעינה הראשונה —
      // לפני שידענו מי זה — ולכן כל ביקור הציג את ברירת המחדל ("שיווקי" לא
      // מסומן) גם למי שסימן אותו ונשמר לו.
      if (data.subscriptions && typeof data.subscriptions === 'object') {
        setSubscriptions((current) => {
          const next = { ...current, ...data.subscriptions };
          if (effectiveRequiredListKey) next[effectiveRequiredListKey] = true;
          return next;
        });
      }

      if (healthOnlyMode) {
        const target = String(data.selfStudent?.id || '') === targetStudentId
          ? data.selfStudent
          : (data.students || []).find((student) => String(student.id || '') === targetStudentId);
        if (!target) {
          setChildren([]);
          setIsAdultSelf(false);
          setError('קישור החידוש אינו שייך למשתתף בתיק המשפחה שאומת. יש לבקש מהצוות קישור חדש.');
          return { status: 'target_mismatch', parent: data.parent };
        }
        const targetIsAdult = String(data.selfStudent?.id || '') === targetStudentId;
        setSelfStudent(targetIsAdult ? target : (data.selfStudent || null));
        setIsAdultSelf(targetIsAdult);
        setChildren([participantFromExistingStudent(target, allQuestions, {
          type: targetIsAdult ? 'adult' : 'child',
          forceHealthRenewal: true,
        })]);
        setKnownFile({ name: data.parent.name || '', children: [target.name].filter(Boolean) });
        return { status: 'found', parent: data.parent, target };
      }

      const existing = Array.isArray(data.students) ? data.students : [];
      if (existing.length) {
        setChildren((current) => {
          const typed = current.filter((c) => c.name.trim());
          const alreadyListed = new Set(typed.map((c) => c.name.trim()));
          const fromFile = existing
            .filter((s) => s.name && !alreadyListed.has(String(s.name).trim()))
            .map((s) => ({
              ...emptyChild(allQuestions),
              id: s.id,
              name: s.name || '',
              lastName: s.lastName || '',
              idNumber: s.idNumber || '',
              birthDate: s.birthDate || '',
              gender: participationGenderValue(s.gender),
              // The same two fields the first load sets. Without them this
              // path — the one that runs when a returning parent types their
              // phone — handed them their own declaration to sign again.
              onFileHealthValid: !!(s.healthDocumentValid ?? s.health_document_valid),
              onFileHealthDocumentValid: !!(s.healthDocumentValid ?? s.health_document_valid),
              onFileWaiverValid: !!(s.waiverValid ?? s.waiver_valid),
              onFileHealthSignedAt: s.healthSignedAt || s.health_signed_at || '',
              onFileWaiverSignedAt: s.waiverSignedAt || s.waiver_signed_at || '',
              onFileDeclarationSummary: s.declarationSummary || null,
              resignHealth: false,
            }));
          const merged = [...fromFile, ...typed];
          return merged.length ? merged : current;
        });
      }
      return { status: 'found', parent: data.parent };
    } catch {
      return { status: 'error' };
    }
  };

  /**
   * Everyone this submission is actually about. A card left out of it — an
   * offer the parent declined, or a participant who has to sign for themselves
   * — is neither validated nor sent.
   */
  const namedChildren = () => children.filter((c) => c.name.trim() && !skipsThisRound(c) && !awaitingParticipationChoice(c));

  const healthChildren = () => namedChildren().filter((child) => fillsDeclaration(child));

  // Presented once, after the last participant's medical questions.
  const allSharedConfirmations = sharedConfirmationList(healthChildren());
  // The fitness declaration is not a safety rule — it is what the signer states
  // about the people they are signing for, so it is read where they sign.
  const isFitnessDeclaration = (q) => String(q?.id || '').toLowerCase() === 'h1';
  const sharedConfirmations = allSharedConfirmations.filter((q) => !isFitnessDeclaration(q));
  const fitnessDeclarations = allSharedConfirmations.filter(isFitnessDeclaration);
  const sharedSubSteps = () => [
    ...(sharedConfirmations.length ? [SUB_ACTIVITY] : []),
    SUB_WAIVER,
    // Payment is the last screen, and only when an event is being booked.
    ...(eventMode ? [SUB_PAYMENT] : []),
  ];
  const signingNames = healthChildren().map((kid) => String(kid.name || '').trim()).filter(Boolean);
  // המסמך חל רק על מי שמשתתף. החותם שענה „לא משתתף” הוא חותם — לא מכוסה,
  // והוספה אוטומטית של שמו רשמה אותו על ויתור שלא נועד לו. כשהוא כן משתתף,
  // הכרטיס שלו נמצא ב-signingNames ממילא.
  const coveredNames = [...new Set(signingNames)];
  const signingFirstNames = signingNames.map((name) => name.split(/\s+/)[0]).filter(Boolean);

  // What is being booked, for how many, and for how much. Everyone the family
  // said is coming is a place on the trip and a line on the invoice — including
  // a spouse whose own signature is still to come.
  const eventParticipants = namedChildren();
  const paidEvent = activity?.registration_mode === 'paid_per_participant';
  const eventIncludesVat = normalizePriceIncludesVat(activity?.price_includes_vat);
  const eventUnitVat = vatBreakdown(activity?.unit_price, eventIncludesVat);
  const eventTotalVat = vatBreakdown(
    (Number(activity?.unit_price) || 0) * eventParticipants.length,
    eventIncludesVat
  );
  const eventPolicy = activity?.cancellation_policy || null;

  const goNextFromParent = async () => {
    setError('');
    if (String(parent.idNumber || '').replace(/\D/g, '').length < 5 || !parent.phone.trim()) {
      setError('יש למלא תעודת זהות ומספר טלפון');
      return;
    }
    // The phone may already be on a file even when the form was opened cold,
    // without a link that says whose. Looking it up here is what the event and
    // shop pages already do; without it a returning parent was met with silence
    // and could add a child who is on their file already.
    // The phone must answer a one-time code before the form goes on. A number
    // that was already verified in this session (and not edited since) is not
    // asked twice.
    if (!otp.token || otp.verifiedPhone !== parent.phone.trim()) {
      await sendOtpCode();
      return;
    }

    if (!prefilledParentId && !['found', 'new'].includes(identityStatus)) {
      const own = await lookupOwnFile(parent.phone, parent.idNumber, otp.token);
      if (own.status === 'review_required') {
        setError(own.error || 'נמצאה סתירה בפרטי הזיהוי. לא ייפתח תיק חדש; יש לפנות לצוות.');
        return;
      }
      if (own.status === 'error' || own.status === 'missing') {
        setError('לא הצלחנו לבדוק אם קיים תיק למספר הזה. נסו שוב לפני פתיחת תיק חדש.');
        return;
      }
      // The lookup has just prefilled an existing file, or established that
      // this really is a new family. Render that result before validating the
      // details that are deliberately hidden until identification.
      return;
    }

    if (healthOnlyMode) {
      const target = children.find((child) => String(child.id || '') === targetStudentId);
      if (identityStatus !== 'found' || !target) {
        setError('לא ניתן להמשיך: המשתתף שבקישור לא נמצא בתיק המשפחה שאומת.');
        return;
      }
      setChildren((current) => current.map((child) => ({
        ...child,
        participates: true,
        renewOptIn: true,
        resignHealth: true,
        editProfile: false,
      })));
      setChildHealthIndex(0);
      setHealthSubStep(SUB_HEALTH);
      setStep(3);
      return;
    }

    if (!parent.name.trim() || !parent.lastName.trim()) {
      setError('יש להשלים שם פרטי ושם משפחה');
      return;
    }

    // Existing customers get these values from their file immediately after
    // OTP. New customers fill only the values that are genuinely missing.
    if (!parent.email.trim()) {
      setError('יש למלא כתובת אימייל — זהו שדה חובה');
      return;
    }
    // כתובת עם שגיאת הקלדה גרועה משדה ריק: הטופס נשלח, והקבלה לא מגיעה לאיש.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(parent.email.trim())) {
      setError('כתובת האימייל לא תקינה — בדקו שיש @ וסיומת (למשל name@gmail.com)');
      return;
    }
    if (!parent.city.trim()) {
      setError('יש למלא מקום מגורים');
      return;
    }
    // Asked once, and only where the file does not already hold them. Letting
    // them through empty is what left "מין: לא צוין" and "קשר: לא צוין" on the
    // card of everyone who registered through the public form. A locked profile
    // missing one of them opens for editing rather than blocking with no field
    // in sight.
    if (parentProfileLocked && !identityConfirmed) {
      setError('יש לאשר שאלה הפרטים שלך — או לתקן אותם');
      return;
    }
    if (!parent.birthDate) {
      if (parentProfileLocked) setEditingParentProfile(true);
      setError('יש למלא תאריך לידה');
      return;
    }
    if (!parent.gender || (relationRequired && !parent.relation)) {
      if (parentProfileLocked) setEditingParentProfile(true);
      setError(!parent.gender ? 'יש לבחור זכר או נקבה' : 'יש לבחור את הקשר למשתתפים');
      return;
    }

    if (waitingForFamily || !familyCheckComplete) return;
    // A real no-match is shown as a confirmation in future tense. No record
    // exists until the whole form is submitted successfully.
    if (!prefilledParentId && !families.length && familyParentId === null) {
      setFamilyParentId('');
      return;
    }
    proceedToStep2();
  };

  const proceedToStep2 = () => {
    // The person filling the form is always one of the cards on the next
    // screen, with their details already in it. Whether they climb is answered
    // there — "כן, למלא עכשיו" or "לא משתתף" — instead of by a checkbox here
    // that decided it before they had seen what it meant.
    if (true) {
      // Same person on both steps — carry the ID already typed, like the name.
      setChildren((current) => {
        const adult = current.find((child) => child.type === 'adult');
        const nextAdult = {
          ...emptyChild(allQuestions),
          ...adultParticipantFromContext(adult || selfStudent, {
            fullName: parentFullName(),
            gender: parent.gender,
            birthDate: parent.birthDate,
            idNumber: parent.idNumber.trim() || adult?.idNumber || '',
          }),
          // This card is the signer. Without the relation their own card asked
          // "מי X ביחס אליך?", and without the on-file flags a signer whose
          // declaration is in force was offered their whole form again.
          relationToSigner: 'self',
          onFileHealthValid: !!selfStudent?.healthDocumentValid,
          onFileHealthDocumentValid: !!selfStudent?.healthDocumentValid,
          onFileWaiverValid: !!selfStudent?.waiverValid,
          onFileHealthSignedAt: selfStudent?.healthSignedAt || '',
          onFileWaiverSignedAt: selfStudent?.waiverSignedAt || '',
          onFileDeclarationSummary: selfStudent?.declarationSummary || null,
          // חוזרים אחורה וקדימה — התשובה "האם משתתף/ת?" שכבר ניתנה נשארת.
          participates: adult?.participates ?? null,
        };
        return adult
          ? current.map((child) => (child === adult ? { ...child, ...nextAdult } : child))
          : [nextAdult, ...current];
      });
    }
    setStep(2);
  };

  const sendOtpCode = async () => {
    setOtp((o) => ({ ...o, sending: true, error: '' }));
    try {
      const res = await fetch('/api/public/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: parent.phone.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOtp((o) => ({
          ...o,
          sending: false,
          stage: 'code',
          sendFailed: true,
          error: data.error || 'שליחת הקוד נכשלה',
        }));
        return;
      }
      setOtp((o) => ({
        ...o,
        sending: false,
        stage: 'code',
        sendFailed: false,
        code: data.devCode || '',
        error: '',
        devCode: data.devCode || '',
        cooldownUntil: Date.now() + 45000,
      }));
    } catch {
      setOtp((o) => ({ ...o, sending: false, stage: 'code', sendFailed: true, error: 'שגיאת רשת בשליחת הקוד' }));
    }
  };

  const verifyOtpCode = async () => {
    setOtp((o) => ({ ...o, verifying: true, error: '' }));
    try {
      const res = await fetch('/api/public/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: parent.phone.trim(), code: otp.code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        setOtp((o) => ({ ...o, verifying: false, error: data.error || 'האימות נכשל' }));
        return;
      }
      // OTP unlocks the existing customer file. Load it before dismissing the
      // code screen, so the user never sees a transient "new family" state and
      // does not need another click merely to be recognised.
      const own = await lookupOwnFile(parent.phone, parent.idNumber, data.token);
      setOtp((o) => ({
        ...o,
        verifying: false,
        stage: 'idle',
        token: data.token,
        verifiedPhone: parent.phone.trim(),
        error: '',
      }));
      if (own.status === 'error') {
        setError('הטלפון אומת, אך טעינת התיק הקיים נכשלה. לחצו המשך כדי לנסות שוב.');
      } else if (own.status === 'review_required') {
        setError(own.error || 'נמצאה סתירה בפרטי הזיהוי. לא ייפתח תיק חדש; יש לפנות לצוות.');
      }
      // Stay on this step: an existing file is now visibly confirmed and
      // prefilled; a genuinely new phone may still need to answer a surname
      // household suggestion before personal family data is shown.
    } catch {
      setOtp((o) => ({ ...o, verifying: false, error: 'שגיאת רשת — נסו שוב' }));
    }
  };

  const goNextFromChildren = async () => {
    setError('');
    const kids = namedChildren();
    if (!kids.length) {
      setError('יש לבחור לפחות משתתף/ת אחד למילוי, או להוסיף משתתף/ת חדש');
      return;
    }
    // Adding someone to a family file is a claim about a relationship, and it is
    // made explicitly rather than assumed from the fact that they were typed in.
    const unclaimed = kids.find((kid) => !kid.relationToSigner);
    if (unclaimed) {
      setError('יש לסמן בתחתית רשימת הילדים את האישור „אלו הם ילדיי" — או להסיר כרטיס של מי שאינו/ה ילד/ה שלך');
      return;
    }
    // כרטיס שלא נענתה עליו שאלת ההשתתפות לא נכנס ל-kids בכלל; העצירה הרכה
    // שממנה אפשר להמשיך בלחיצה שנייה נמצאת בהמשך הפונקציה.
    for (const kid of kids) {
      // A participant typed in by hand who turns out to be an adult: the form
      // says so here rather than dropping the card without a word.
      if (needsOwnSignature(kid)) {
        setError(`${kid.name} מעל גיל 18 — הורה לא יכול לחתום עבורו/ה. יש למלא טופס נפרד בשמו/ה, או לתקן את תאריך הלידה`);
        return;
      }
      if (!kid.birthDate) {
        setError(`חסר תאריך לידה עבור ${kid.name}`);
        return;
      }
      // Signing for yourself is a legal act a minor cannot perform, so the
      // birth date decides it — not the box that was ticked.
      if (kid.type === 'adult') {
        const age = ageFromBirthDate(kid.birthDate);
        if (age !== null && age < 18) {
          setError('מתחת לגיל 18 אי אפשר למלא עבור עצמך — יש להסיר את הסימון „אני מעל גיל 18” ולמלא כהורה או אפוטרופוס');
          return;
        }
      }
      // לילד יש נפילה לשם המשפחה של ההורה; למבוגר שנוסף אין — בלעדיו התיק
      // ייפתח עם שם של מילה אחת.
      if (kid.type === 'adult' && kid.relationToSigner !== 'self'
        && !String(kid.lastName || '').trim() && !kid.name.trim().includes(' ')) {
        setError(`חסר שם משפחה עבור ${kid.name.trim()}`);
        return;
      }
      if (!String(kid.idNumber || '').trim()) {
        setError(`חסרה תעודת זהות עבור ${kid.name}`);
        return;
      }
      // A failed check digit is almost always a typo, but a passport or a
      // foreign document is not wrong — so it warns once and lets it through
      // on the second attempt rather than locking the family out.
      if (!looksLikeIsraeliId(kid.idNumber) && !idWarnedFor.includes(childKey(kid))) {
        setIdWarnedFor((warned) => [...warned, childKey(kid)]);
        setError(`תעודת הזהות של ${kid.name} לא נראית תקינה — בדקו שוב. אם זה דרכון או מסמך אחר, לחצו „המשך” שוב.`);
        return;
      }
    }
    // A child already on another parent's file joins it instead of becoming a
    // second copy — but only the person filling this in can confirm that.
    {
      const unanswered = kids.filter((kid) => kid.type !== 'adult' && !kid.id && !knownChildren[childKey(kid)]);
      if (unanswered.length) {
        const checked = await Promise.all(unanswered.map(async (kid) => {
          const match = await checkKnownChild({
            name: childFullName(kid),
            birthDate: kid.birthDate,
            idNumber: kid.idNumber,
            phone: parent.phone,
            templateSlug: template?.slug || '',
            verificationToken: otp.token,
          });
          return [childKey(kid), { ...match, linked: match.match ? null : false }];
        }));
        setKnownChildren((current) => ({ ...current, ...Object.fromEntries(checked) }));
        if (checked.some(([, match]) => match.match)) return;
      }
    }
    // Leaving someone unanswered must not happen by accident: a card whose
    // "האם משתתף/ת?" was never answered is not in the submission, and a parent
    // who walked past it would finish with that person left out. So the first
    // press names who is being left out and the second one goes ahead — the
    // same soft stop the ID check uses.
    const unofferedAnswer = children.filter((c) => c.name.trim() && awaitingParticipationChoice(c));
    const unofferedKey = unofferedAnswer.map((c) => c.name.trim()).join('|');
    if (unofferedKey && skipWarnedFor !== unofferedKey) {
      setSkipWarnedFor(unofferedKey);
      setError(`לא בחרתם אם ${unofferedAnswer.map((c) => c.name.trim()).join(', ')} משתתפ/ים בפעילות — לחצו „המשך” שוב כדי להמשיך בלעדיהם.`);
      return;
    }

    // A trip has a fixed number of places, and the last one may have gone while
    // this form was being filled in. Say so here rather than at the card.
    if (eventMode) {
      const booked = namedChildren().length;
      if (!booked) {
        setError('יש לבחור לפחות משתתף אחד לפעילות');
        return;
      }
      if (activity?.remaining != null && booked > activity.remaining) {
        setError(activity.remaining > 0
          ? `נותרו רק ${activity.remaining} מקומות פנויים בפעילות`
          : 'הפעילות מלאה');
        return;
      }
    }

    // Everyone here already has a declaration in force on their existing file.
    if (!healthChildren().length) {
      // Nobody left to sign, but there is still a booking to pay for.
      if (eventMode) {
        setSignedSnapshot(children);
        setHealthSubStep(SUB_PAYMENT);
        setStep(3);
        return;
      }
      await submitAll(children);
      return;
    }
    // Leaving the participant editor locks the canonical profile again. The
    // health screen presents what will be signed and offers an explicit edit
    // button instead of keeping ordinary inputs open beside the declaration.
    setChildren((current) => current.map((child) => (
      child.editProfile ? { ...child, editProfile: false } : child
    )));
    setChildHealthIndex(0);
    setHealthSubStep(SUB_HEALTH);
    setStep(3);
  };

  const advanceHealthOrSubmit = async () => {
    setError('');
    const kids = healthChildren();
    const current = kids[childHealthIndex];
    if (!current) return;
    const fullIndex = children.findIndex(
      (c) => c === current || (c.name.trim() === current.name.trim() && c.id === current.id)
    );

    if (healthSubStep === SUB_HEALTH) {
      const answers = children[fullIndex]?.answers || {};
      const screening = screeningFor(current);
      if (unansweredQuestions(screening, answers).length) {
        setError('יש לענות כן או לא על כל שאלות הבריאות');
        return;
      }
      // A condition nobody described is a condition the instructor cannot act
      // on — and each "yes" needs its own words, in the box under the question.
      const notes = children[fullIndex]?.answerNotes || {};
      const undetailed = screening.find((q) => answers[q.id] === true
        && !String(notes[q.id] || '').trim());
      if (undetailed) {
        setError(`סימנתם „כן” על „${questionLabel(undetailed)}” — יש לפרט בשדה שמתחת לשאלה`);
        return;
      }
      // Where a doctor has already limited the activity, the wall is not the
      // one to decide it is safe. The approval is required before the
      // signature, not chased afterwards.
      if (needsMedicalClearance(screening, answers) && !children[fullIndex]?.medicalClearance) {
        setError('לפי התשובות נדרש אישור רופא להשתתפות בפעילות ספורטיבית — יש לצרף אותו כדי להמשיך');
        return;
      }
      // Said here rather than after the signature: the fix is to attach a
      // different file, and the last screen is the worst place to learn that.
      const spouseWithoutPhone = children.find((c) => c.relationToSigner === 'spouse'
        && c.name?.trim()
        && !skipsThisRound(c)
        && String(c.spousePhone || '').replace(/\D/g, '').length < 9);
      if (spouseWithoutPhone) {
        setError(`יש למלא מספר טלפון של ${spouseWithoutPhone.name.trim()} — הוא נדרש כדי לצרף אותו/ה לתיק המשפחה`);
        return;
      }
      const overBudget = clearanceBudgetError(children);
      if (overBudget) {
        setError(overBudget);
        return;
      }
      // The medical half is per person — asthma is a fact about one body. What
      // follows is not: the activity is the same activity for the whole family,
      // and the waiver is one undertaking by one signer. So the health screen
      // walks the participants, and only the last one opens the shared screens.
      if (childHealthIndex < kids.length - 1) {
        setChildHealthIndex((i) => i + 1);
        return;
      }
      const shared = sharedSubSteps();
      setHealthSubStep(shared[0]);
      if (shared[0] === SUB_WAIVER) initCanvas();
      return;
    }

    if (healthSubStep === SUB_ACTIVITY) {
      // Ticked once, recorded for everyone: each participant's own record must
      // still say which clauses were agreed to for them, and a clause that
      // does not apply to a participant is never written onto their record.
      const missing = sharedConfirmations.filter((q) => activityConfirmed[q.id] !== true);
      if (missing.length) {
        setError('יש לסמן את כל סעיפי ההצהרה והבטיחות');
        return;
      }
      setChildren((current) => current.map((child) => {
        if (!kids.some((kid) => kid === child || (kid.name === child.name && kid.id === child.id))) return child;
        const own = confirmationsFor(child).filter((q) => !isFitnessDeclaration(q));
        return {
          ...child,
          answers: {
            ...(child.answers || {}),
            ...Object.fromEntries(own.map((q) => [q.id, activityConfirmed[q.id] === true])),
          },
        };
      }));
      setHealthSubStep(SUB_WAIVER);
      initCanvas();
      return;
    }

    // The signed forms are already in hand; this screen is the booking itself.
    if (healthSubStep === SUB_PAYMENT) {
      if (paidEvent && eventPolicy && !policyAccepted) {
        setError('יש לקרוא ולאשר את תנאי הביטול לפני המעבר לתשלום');
        return;
      }
      await submitAll(signedSnapshot || children);
      return;
    }

    if (healthOnlyMode && !healthDeclarationAccepted) {
      setError('יש לאשר שהמידע בהצהרת הבריאות מלא, נכון ומעודכן');
      return;
    }
    if (!healthOnlyMode && fitnessDeclarations.some((q) => activityConfirmed[q.id] !== true)) {
      setError('יש לאשר את הצהרת הכשירות');
      return;
    }
    if (!healthOnlyMode && !waiverAccepted) {
      setError('יש לאשר את כתב הוויתור / הסרת האחריות');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      setError('יש לחתום על הטופס');
      return;
    }
    // One signature, drawn once, recorded on every participant it covers — the
    // document itself now says whom it covers, and the names are printed above
    // the field the signer signs in.
    const signature = canvas.toDataURL();
    const capturedAt = new Date().toISOString();
    const withSig = children.map((c) => {
      const signing = kids.some((kid) => kid === c || (kid.name === c.name && kid.id === c.id));
      if (!signing) return c;
      const ownFitness = confirmationsFor(c).filter(isFitnessDeclaration);
      return {
        ...c,
        answers: {
          ...(c.answers || {}),
          ...Object.fromEntries(ownFitness.map((q) => [q.id, activityConfirmed[q.id] === true])),
        },
        signature,
        healthAccepted: healthOnlyMode ? true : c.healthAccepted,
        waiverAccepted: !healthOnlyMode,
        signatureEvidenceTimeline: {
          ...(c.signatureEvidenceTimeline || {}),
          termsPresentedAt: c.signatureEvidenceTimeline?.termsPresentedAt || capturedAt,
          termsReadAt: sessionEvidence.current.waiverEndSeenAt || capturedAt,
          termsAcceptedAt: c.signatureEvidenceTimeline?.termsAcceptedAt || capturedAt,
          signatureCapturedAt: capturedAt,
          // The session itself: every screen with how long it was open, every
          // box with when it was ticked, and when the end of the binding text
          // was on the screen.
          screens: sessionEvidence.current.screens.map((entry) => ({
            ...entry,
            leftAt: entry.leftAt || capturedAt,
            secondsOnScreen: Math.max(0, Math.round(
              (new Date(entry.leftAt || capturedAt) - new Date(entry.enteredAt)) / 1000
            )),
          })),
          ticks: { ...sessionEvidence.current.ticks },
          waiverEndSeenAt: sessionEvidence.current.waiverEndSeenAt,
        },
      };
    });
    setChildren(withSig);
    // Booking an outing: the signatures are done and filed right now — before
    // the payment screen ever shows. Someone who signed and never paid still
    // exists in the CRM with their signed forms; what is left here is the
    // summary, the cancellation terms and the payment that registers everyone.
    if (eventMode) {
      const saved = await submitEventDocuments(withSig);
      if (!saved) return;
      setChildren(saved);
      setSignedSnapshot(saved);
      setHealthSubStep(SUB_PAYMENT);
      return;
    }
    await submitAll(withSig);
  };

  /**
   * שלב א' של הרשמה לאירוע: הטפסים החתומים נשמרים בשרת ברגע שהחתימה ניתנה.
   * ההרשמה והתשלום (שלב ב', `submitEventRegistration`) רק מקשרים אליהם את
   * ההזמנה — אף אחד לא חותם פעמיים, ומי שעצר לפני התשלום לא איבד כלום.
   */
  const submitEventDocuments = async (childrenSnapshot) => {
    const signs = (c) => c.name.trim() && joinsThisRound(c) && !defersDocuments(c);
    const signing = childrenSnapshot.filter(signs);
    if (!signing.length) return childrenSnapshot;
    setIsSubmitting(true);
    setError('');
    try {
      const submitted = signing.map((c) => ({ ...participantPayload(c), waiverAccepted: true }));
      const res = await fetch(`/api/public/activities/${encodeURIComponent(eventSlug)}/save-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: parentPayload(),
          participants: submitted,
          phoneVerification: otp.token ? { token: otp.token } : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'שמירת הטפסים נכשלה — נסו שוב');
        // The verification lapsed while the form was being filled in.
        if (res.status === 403) {
          setOtp((o) => ({ ...o, token: '', verifiedPhone: '', code: '', stage: 'idle' }));
          setStep(1);
        }
        return null;
      }
      setUploadingPdfs(true);
      await uploadSignedParticipationPdfs({
        signedDocuments: data.signedDocuments || [],
        submittedParticipants: submitted,
        parent: { ...parent, name: parentFullName() },
        template: template || {},
        brandName,
        phoneVerificationToken: otp.token,
      });
      // Each signer carries home the id of the card that was saved — the
      // booking after payment finds them by it and links these documents
      // instead of asking for a second signature.
      const filed = data.signedDocuments || [];
      let index = 0;
      return childrenSnapshot.map((c) => {
        if (!signs(c)) return c;
        const entry = filed[index];
        index += 1;
        return { ...c, id: entry?.student?.id || c.id, docsSaved: true };
      });
    } catch (err) {
      console.error(err);
      setError('שגיאת רשת — נסו שוב');
      return null;
    } finally {
      setIsSubmitting(false);
      setUploadingPdfs(false);
    }
  };

  /**
   * The one participant shape both submissions build from: name, identity, the
   * answers that were actually asked, and the signature that covers them.
   */
  const participantPayload = (c) => {
    const participantQuestions = questionsForParticipant(c);
    const asked = new Set(participantQuestions.map((q) => q.id));
    const answers = Object.fromEntries(
      Object.entries(c.answers || {}).filter(([id]) => asked.has(id))
    );
    const healthNotes = participantQuestions
      .filter((q) => isScreeningQuestion(q) && answers[q.id] === true)
      .map((q) => {
        const note = String(c.answerNotes?.[q.id] || '').trim();
        return note ? `${questionLabel(q)} — ${note}` : '';
      })
      .filter(Boolean)
      .join('\n') || (c.healthNotes || '').trim();
    return {
      id: c.id,
      name: childFullName(c),
      lastName: participantLastName(c),
      idNumber: (c.idNumber || '').trim(),
      type: c.type === 'adult' ? 'adult' : 'child',
      birthDate: c.birthDate,
      gender: c.gender,
      childPhone: c.childPhone,
      registrationNotes: c.registrationNotes,
      answers,
      healthNotes,
      medicalClearance: c.medicalClearance || null,
      signature: c.signature,
      signatureEvidenceTimeline: c.signatureEvidenceTimeline || null,
      ...linkFieldsFor(knownChildren[childKey(c)]),
      spouse_phone: c.relationToSigner === 'spouse' ? String(c.spousePhone || '').trim() : '',
    };
  };

  /** The signer's own card, as both endpoints read it. */
  const parentPayload = () => ({
    name: parentFullName(),
    lastName: parent.lastName.trim(),
    idNumber: parent.idNumber.trim(),
    // Derived from the cards: someone who marked a participant as their child
    // is that child's parent, and their own gender says which. The single
    // "relation to participants" field could not describe a family with more
    // than one kind of tie in it.
    relation: parent.relation
      || (children.some((c) => c.relationToSigner === 'child')
        ? (parent.gender === 'female' ? 'mother' : 'father')
        : 'other'),
    phone: parent.phone.trim(),
    email: parent.email.trim(),
    city: parent.city.trim(),
    gender: parent.gender || '',
    // נשמר על תיק ההורה, לא רק על כרטיס מתאמן: הורה שרק חותם על ילדיו איבד
    // אותו, ונשאל מחדש בכל ביקור.
    birthDate: parent.birthDate || '',
    source: 'form',
    family_parent_id: familyParentId || null,
  });

  /**
   * Booking an outing. `registerActivityGroup` on the server already does the
   * whole job in one call — the family's records, the declarations against this
   * activity, the places held and the payment link — so this sends it what it
   * asks for rather than filing the details separately and registering after.
   *
   * The payment link is the last step: it is what turns held places into
   * confirmed ones.
   */
  const submitEventRegistration = async (childrenSnapshot) => {
    setIsSubmitting(true);
    setError('');
    try {
      const booked = (childrenSnapshot || children)
        .filter((c) => c.name.trim() && joinsThisRound(c))
        .map((c) => {
          const base = {
            ...participantPayload(c),
            waiverAccepted: !defersDocuments(c),
            defer_documents: defersDocuments(c),
          };
          // The documents were filed the moment the signature was given
          // (`submitEventDocuments`). Booking links those records instead of
          // writing a second copy of each form.
          if (c.docsSaved && !defersDocuments(c)) {
            return {
              ...base,
              signature: '',
              medicalClearance: null,
              reuse_health: true,
              reuse_health_document: true,
              reuse_waiver: true,
            };
          }
          return { ...base, reuse_health: false, reuse_health_document: false, reuse_waiver: false };
        });
      if (!booked.length) {
        setError('יש לבחור לפחות משתתף אחד לפעילות');
        return;
      }
      const res = await fetch(`/api/public/activities/${encodeURIComponent(eventSlug)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          parent: parentPayload(),
          subscriptions: { ...subscriptions },
          participants: booked,
          phoneVerification: otp.token ? { token: otp.token } : null,
          policyAccepted,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'ההרשמה נכשלה');
        // The verification lapsed while the form was being filled in.
        if (res.status === 403 && !data.error?.includes('בני המשפחה')) {
          setOtp((o) => ({ ...o, token: '', verifiedPhone: '', code: '', stage: 'idle' }));
          setStep(1);
        }
        return;
      }
      // The signed copies are filed before the customer leaves for the payment
      // page — once the browser is at the provider, this code never runs again.
      setUploadingPdfs(true);
      await uploadSignedParticipationPdfs({
        signedDocuments: data.signedDocuments || [],
        submittedParticipants: booked,
        parent: { ...parent, name: parentFullName() },
        template: template || {},
        brandName,
        phoneVerificationToken: otp.token,
      });
      setUploadingPdfs(false);
      if (data.paymentUrl) {
        window.location.assign(data.paymentUrl);
        return;
      }
      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      setError('שגיאת רשת — נסו שוב');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitAll = async (childrenSnapshot) => {
    if (eventMode) return submitEventRegistration(childrenSnapshot);
    setIsSubmitting(true);
    setError('');
    try {
      const kids = (childrenSnapshot || children)
        // Same rule as the screen: a "not participating", an unanswered card,
        // or an adult who signs for themselves, is not part of the submission.
        .filter((c) => c.name.trim() && joinsThisRound(c))
        .map((c) => ({
          ...participantPayload(c),
          healthAccepted: healthOnlyMode ? c.healthAccepted === true : false,
          waiverAccepted: !healthOnlyMode,
          // אין עוד שימוש חוזר: כל משתתף בשליחה חתם עכשיו על הצהרה ואישור
          // טריים, והשרת שומר לו רשומות ו-PDF חדשים.
          reuse_health_document: false,
          reuse_waiver: false,
        }));

      const res = await fetch('/api/public/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: parentPayload(),
          interest,
          children: kids,
          subscriptions: effectiveRequiredListKey
            ? { ...subscriptions, [effectiveRequiredListKey]: true }
            : { ...subscriptions },
          templateSlug: template?.slug || 'wall',
          templateId: template?.id || null,
          completionRegistrationId: searchParams.get('registrationId') || null,
          phoneVerification: otp.token ? { token: otp.token } : null,
          healthOnly: healthOnlyMode,
          mode: healthOnlyMode ? 'health-renewal' : 'full',
          targetStudentId: healthOnlyMode ? targetStudentId : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'שגיאה בשמירת הטופס');
        // The verification lapsed while the form was being filled. Send them
        // back to the one screen that can fix it, rather than leaving a signed
        // form stuck against an error it cannot clear.
        if (res.status === 403) {
          setOtp((o) => ({ ...o, token: '', verifiedPhone: '', code: '', stage: 'idle' }));
          setStep(1);
        }
        return;
      }

      const signedDocuments = Array.isArray(data.signedDocuments)
        ? data.signedDocuments
        : (data.declarations || []).map((health, index) => ({
            student: data.students?.[index] || null,
            health,
            waiver: data.waivers?.[index] || null,
          }));
      const findInput = (entry) => kids.find((kid) => (
        (entry.student?.id && String(kid.id || '') === String(entry.student.id))
        || childFullName(kid) === entry.student?.name
      )) || {};
      const healthDocuments = signedDocuments.filter((entry) => entry.health).map((entry) => {
        const input = findInput(entry);
        const health = entry.health;
        const snapshot = health.formSnapshot || health.form_snapshot || {};
        return {
          ...health,
          documentType: 'health',
          parentName: parentFullName(),
          phone: parent.phone,
          climberName: entry.student?.name || input.name || health.climberName,
          birthDate: input.birthDate || health.birthDate,
          answers: input.answers || health.answers,
          signature_url: input.signature || health.signature_url,
          signature: input.signature || health.signature_url,
          signedBy: parentFullName(),
          studentName: entry.student?.name || input.name || health.climberName,
          signedDate: health.signedDate || health.date,
          title: 'הצהרת בריאות',
          brandName,
          phoneVerification: snapshot.phoneVerification || null,
          evidence: snapshot.evidence || null,
        };
      });
      const waiverDocuments = signedDocuments.filter((entry) => entry.waiver).map((entry) => {
        const input = findInput(entry);
        const waiver = entry.waiver;
        const snapshot = waiver.form_snapshot || waiver.formSnapshot || {};
        return {
          ...waiver,
          documentType: 'participation_waiver',
          parentName: parentFullName(),
          parentIdNum: parent.idNumber,
          phone: parent.phone,
          climberName: entry.student?.name || input.name || '',
          climberIdNum: input.idNumber || '',
          birthDate: input.birthDate || '',
          signature_url: input.signature || waiver.signature_url,
          signature: input.signature || waiver.signature_url,
          signedBy: parentFullName(),
          studentName: entry.student?.name || input.name || '',
          signedDate: waiver.signed_at || waiver.signedAt,
          templateSlug: waiver.scope || template?.slug || 'wall',
          title: template?.title || 'אישור השתתפות והסרת אחריות',
          brandName,
          phoneVerification: snapshot.phoneVerification || null,
          evidence: snapshot.evidence || null,
        };
      });
      const documents = [...healthDocuments, ...waiverDocuments];
      setSavedDeclarations(documents);
      setIsSuccess(true);

      setUploadingPdfs(true);
      for (const document of documents) {
        try {
          const { blob, fileName } = document.documentType === 'participation_waiver'
            ? await buildParticipationWaiverPdf(document)
            : await buildHealthDeclarationPdf(document);
          const pdfBase64 = await blobToBase64(blob);
          const uploadUrl = document.documentType === 'participation_waiver'
            ? `/api/public/onboard/waivers/${encodeURIComponent(document.id)}/pdf`
            : `/api/public/onboard/${encodeURIComponent(document.id)}/pdf`;
          await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pdfBase64,
              fileName,
              phoneVerification: otp.token ? { token: otp.token } : null,
            }),
          });
        } catch (err) {
          console.error('PDF upload failed for', document.id, err);
        }
      }
      setUploadingPdfs(false);
    } catch (err) {
      console.error(err);
      setError('שגיאת רשת — נסו שוב');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || (eventMode && !activity && !activityError)) {
    return (
      <div className="event-page onboard-page" ref={pageTopRef}>
        <div className="event-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>טוען טופס השלמת פרטים...</p>
        </div>
        <FormStyles />
      </div>
    );
  }

  // The link says it is registering for an outing and the outing cannot be
  // read. Filling the form in would file details and register nobody.
  if (eventMode && activityError) {
    return (
      <div className="event-page onboard-page" ref={pageTopRef}>
        <div className="event-card" style={{ textAlign: 'center', padding: 40 }}>
          <h1 style={{ color: '#fff', fontSize: 22, marginBottom: 10 }}>לא ניתן להירשם</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>{activityError}</p>
        </div>
        <FormStyles />
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="event-page onboard-page" ref={pageTopRef}>
        <div className="event-card event-centered">
          <CheckCircle size={60} color="var(--form-accent-solid, #38bdf8)" style={{ margin: '0 auto', marginBottom: 20 }} />
          <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>
            {eventMode ? 'ההרשמה התקבלה' : 'הפרטים התקבלו!'}
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            תודה {parent.name}. {eventMode
              ? `המקומות ב„${activity?.page_title || activity?.name || 'פעילות'}” נשמרו.`
              : (healthOnlyMode
                ? 'הצהרת הבריאות החדשה נשמרה בתיק.'
                : 'הפרטים והצהרת הבריאות נשמרו במערכת.')}
          </p>
          {!healthOnlyMode && !eventMode && (
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 12 }}>
              השיבוץ לחוג יבוצע על ידי הצוות בהמשך.
            </p>
          )}
          {uploadingPdfs && (
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 10 }}>
              שומר עותק PDF בתיק האישי...
            </p>
          )}
          {savedDeclarations.map((decl) => (
            <button
              key={decl.id}
              type="button"
              className="event-primary"
              style={{ marginTop: 14, background: 'rgba(255,255,255,0.08)' }}
              onClick={() => (decl.documentType === 'participation_waiver'
                ? downloadParticipationWaiverPdf(decl)
                : downloadHealthDeclarationPdf(decl))}
            >
              <Download size={16} style={{ marginLeft: 8 }} />
              הורד {decl.documentType === 'participation_waiver' ? 'אישור השתתפות' : 'הצהרת בריאות'} — {decl.climberName || decl.studentName}
            </button>
          ))}
        </div>
        <FormStyles />
      </div>
    );
  }

  // Only those who still have to sign. Rendering from every named participant
  // walked the signing step through people whose declaration is already in
  // force — including the parent, handed their own form on every later visit.
  const kids = healthChildren();
  const currentChild = kids[childHealthIndex] || kids[0];
  const currentFullIndex = currentChild
    ? children.findIndex((c) => c === currentChild || (c.name === currentChild.name && c.id === currentChild.id))
    : 0;
  // הכפתור אומר על מי ההצהרה. "המשך להצהרת בריאות" השאיר את ההורה לנחש על מי
  // מהילדים שמילא עומדים לשאול — השמות הם התשובה.
  // First names on the button: „דלק איל וראם איל” is a list of records, and the
  // question it answers — whose declaration comes next — is answered by „דלק
  // וראם”.
  const healthChildNames = kids
    .map((kid) => String(kid.name || '').trim().split(/\s+/)[0])
    .filter(Boolean);
  const healthNamesText = healthChildNames.length > 1
    ? `${healthChildNames.slice(0, -1).join(', ')} ו${healthChildNames[healthChildNames.length - 1]}`
    : (healthChildNames[0] || '');
  // Every screen is a step, and the count says so. Details, participants, one
  // medical screen per participant, and then the shared screens — the rules and
  // the signature, or only the signature when there are no rules to tick.
  const sharedScreens = sharedSubSteps();
  const totalStepsLabel = healthOnlyMode
    ? 2 + sharedScreens.length
    : 2 + Math.max(kids.length, 1) + sharedScreens.length;
  const displayStep = healthOnlyMode && step === 3
    ? (healthSubStep === SUB_HEALTH ? 2 : 2 + sharedScreens.indexOf(healthSubStep) + 1)
    : (step === 3
      ? 2 + (healthSubStep === SUB_HEALTH
        ? childHealthIndex + 1
        : Math.max(kids.length, 1) + sharedScreens.indexOf(healthSubStep) + 1)
      : step);
  // The answers of whoever is signing right now. Both signing screens write
  // into the same per-participant `answers` object; only the questions differ.
  const currentAnswers = children[currentFullIndex]?.answers || {};
  const setCurrentAnswer = (id, value) => updateChild(currentFullIndex, (child) => ({
    answers: { ...(child.answers || {}), [id]: value },
  }));
  const currentScreening = screeningFor(currentChild);
  // נערך בתבנית ב-CRM; ריק — הנוסח שבקוד, כדי שטופס שלא נגעו בו לא יאבד
  // את הפרק הזה.
  const activityNatureText = String(template?.activityNature || '').trim()
    || ACTIVITY_NATURE[String(template?.slug || routeSlug || 'wall').trim().toLowerCase()]
    || '';
  const documentTitle = healthOnlyMode ? 'חידוש הצהרת בריאות' : 'הצהרת בריאות והסרת אחריות';
  /**
   * שם הפעילות שהטופס משרת. נערך בתבנית ב-CRM; עד שמגדירים אותו, נגזר מסוג
   * הטופס — מי שפותח קישור צריך לדעת על מה הוא חותם עוד לפני שהוא קורא.
   */
  // A booking says which outing it is, by name, on every screen — that is what
  // the family chose on the event page and what they are paying for.
  const activityHeadline = (eventMode && (activity?.page_title || activity?.name))
    || String(template?.headline || '').trim()
    || (isTripForm ? 'יציאה / טיול' : `טיפוס ב${brandName}`);
  /**
   * מה הטופס הזה, במשפט אחד, בדף הראשון. „הצהרת בריאות והסרת אחריות” הוא שם
   * המסמך; מי שפותח קישור צריך קודם לדעת שזה טופס ההשתתפות עצמו, ולאילו
   * פעילויות הוא נדרש.
   */
  const formIntro = isTripForm
    ? {
      title: 'מילוי טופס השתתפות ביציאה / טיול',
      sub: 'סנפלינג · טיפוס · מערנות · טיולי הליכה — כולל הצהרת בריאות והסרת אחריות',
    }
    : {
      title: 'מילוי טופס השתתפות בפעילויות בקיר הטיפוס',
      sub: 'חוגים · אימונים אישיים · כניסות · ימי הולדת · אירועים — כולל הצהרת בריאות והסרת אחריות',
    };
  const signingScreenTitle = {
    [SUB_HEALTH]: sectionTitles.health,
    [SUB_ACTIVITY]: sectionTitles.confirm,
    [SUB_WAIVER]: healthOnlyMode ? 'אישור הצהרת הבריאות' : 'אישור השתתפות והסרת אחריות',
    [SUB_PAYMENT]: paidEvent ? 'סיכום ההרשמה ותשלום' : 'סיכום ההרשמה',
  }[healthSubStep] || documentTitle;
  const progressPercent = Math.round((displayStep / totalStepsLabel) * 100);

  return (
    <div className="event-page onboard-page" ref={pageTopRef}>
      <div className="event-card">
        {step > 1 && (
          <button
            type="button"
            className="event-secondary onboard-back"
            onClick={() => {
              setError('');
              const backShared = sharedScreens[sharedScreens.indexOf(healthSubStep) - 1];
              // Nobody signed on the way in — the signature screen was never
              // shown, so going back from the booking lands on the participants.
              if (step === 3 && healthSubStep === SUB_PAYMENT && !kids.length) {
                setHealthSubStep(SUB_HEALTH);
                setStep(2);
              } else if (step === 3 && healthSubStep !== SUB_HEALTH && backShared) {
                setHealthSubStep(backShared);
              } else if (step === 3 && healthSubStep !== SUB_HEALTH) {
                // Out of the shared screens and back into the medical ones lands
                // on the last participant — the one it was reached from.
                setHealthSubStep(SUB_HEALTH);
                setChildHealthIndex(Math.max(kids.length - 1, 0));
              } else if (step === 3 && childHealthIndex > 0) {
                setChildHealthIndex((i) => i - 1);
              } else if (step === 3) setStep(healthOnlyMode ? 1 : 2);
              else setStep(1);
            }}
          >
            <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} /> חזרה
          </button>
        )}

        <div className="form-header">
          {/* תמונת הפעילות, כשהוגדרה בתבנית. היא אומרת בלי מילים לאיזו פעילות
              הטופס הזה — מה שכותרת המסמך לבדה מעולם לא אמרה. */}
          {/* לאירוע יש תמונה משלו, והיא זו שהנרשם ראה רגע קודם בדף האירוע —
              היא ממשיכה איתו לאורך הטופס. תמונת התבנית נשארת לטפסים שאינם
              הרשמה לאירוע מסוים. */}
          {(activity?.cover_image || template?.coverImage) && (
            <div className="form-cover">
              <img
                src={activity?.cover_image || template.coverImage}
                alt=""
                style={activity?.cover_image
                  ? { objectPosition: activity.cover_position || '50% 50%' }
                  : undefined}
              />
            </div>
          )}
          <div className="logo-circle">
            <img src={brandLogo} alt={brandName} />
          </div>
          {/* מה הפעילות — מעל שם המסמך שחותמים עליו, ובכל שלבי הטופס. */}
          {activityHeadline && <div className="form-activity">{activityHeadline}</div>}
          {/* „מילוי פרטים והרשמה” לא אמר למה חותמים. הכותרת נושאת את שם
              המסמך שעל המסך — ובשלב החתימה זה שם החלק הנוכחי, כי דף אחד
              שנקרא „הצהרת בריאות” לא יכול להכיל גם את סעיפי אופי הפעילות. */}
          <h2 className={step === 3 ? 'signing-document-title' : ''}>
            {step === 1 && !identityReady
              ? formIntro.title
              : (step === 3 ? signingScreenTitle : documentTitle)}
            {/* The medical screen is about one person and says whose it is. The
                shared screens are about everyone, and naming one of them there
                would claim the waiver covers only that participant. */}
            {step === 3 && healthSubStep === SUB_HEALTH && currentChild?.name
              ? ` — ${currentChild.name}`
              : ''}
          </h2>
          {/* לאילו פעילויות הטופס נדרש, ומה הוא כולל — בדף הראשון בלבד. */}
          {step === 1 && !identityReady && (
            <p className="form-intro-sub">{formIntro.sub}</p>
          )}
          {step === 2 && <p>בחירת בני המשפחה המשתתפים בפעילות</p>}
          {/* A bar, and no number. How many screens there are depends on how
              many participants are added and on which of them already hold a
              declaration in force — neither is known on the first screen, so a
              total printed there is a guess that later turns out wrong. */}
          <div
            className="event-progress"
            style={{
              background: `linear-gradient(90deg,var(--form-accent-solid,#38bdf8) 0 ${progressPercent}%,rgba(255,255,255,.1) ${progressPercent}%)`,
            }}
          />
        </div>

        {step === 1 && (
          <div className="fade-in">
            {/* הכותרת שייכת לשלב הזיהוי עצמו. אחרי האימות הפרטים כבר בכרטיס,
                והכותרת נשארה ככותרת של שדות שאינם על המסך. */}
            {!identityReady && (
              <div className="section-title">
                {g('זיהוי ממלא הטופס', 'זיהוי ממלאת הטופס', 'זיהוי ממלא/ת הטופס')}
              </div>
            )}
            {parentProfileLocked ? (
              <>
                <ParentProfileSummary
                  parent={parent}
                  onEdit={() => setEditingParentProfile(true)}
                />
                {/* שתי שאלות על אותו כרטיס: שזה באמת אתה, ואם גם אתה משתתף.
                    בלי הראשונה אנחנו מניחים שמי שהחזיק בטלפון הוא בעל התיק. */}
                <label
                  className="event-check"
                  style={{
                    cursor: 'pointer', marginBottom: 10,
                    borderColor: identityConfirmed ? 'var(--form-accent-border, rgba(249,115,22,0.45))' : 'rgba(255,255,255,0.08)',
                    background: identityConfirmed ? 'var(--form-accent-soft, rgba(249,115,22,0.08))' : 'rgba(255,255,255,0.03)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={identityConfirmed}
                    onChange={(e) => setIdentityConfirmed(e.target.checked)}
                  />
                  <span>זה אני</span>
                </label>
              </>
            ) : (
              <>
                {/* לפני האימות אין מה להסביר — יש שני שדות וכפתור שאומר מה הוא
                    עושה. ההסבר נשאר רק אחרי האימות, כשיש פרטים שאפשר לשנות. */}
                {identityReady && (
                  <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: -6, marginBottom: 12, lineHeight: 1.45 }}>
                    אפשר לעדכן את הפרטים. שינוי תעודת הזהות או הטלפון יחייב אימות מחדש.
                  </p>
                )}
                {(!identityReady || editingIdentity) ? (
                  <>
                    <div className="form-group">
                      <label>תעודת זהות *</label>
                      <input
                        inputMode="numeric"
                        value={parent.idNumber}
                        onChange={(e) => changeParentIdNumber(e.target.value)}
                        placeholder="9 ספרות"
                      />
                    </div>
                    <div className="form-group">
                      <label>טלפון *</label>
                      <input
                        type="tel"
                        value={parent.phone}
                        onChange={(e) => changeParentPhone(e.target.value)}
                        placeholder="מספר לקבלת קוד בוואטסאפ"
                      />
                    </div>
                  </>
                ) : (
                  /* מזוהה — שתי השורות האלה הן כבר עובדה, לא שדות למילוי. */
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.12)',
                    borderRadius: 12, padding: '10px 12px', marginBottom: 16,
                    fontSize: 13, color: 'rgba(255,255,255,.75)',
                  }}>
                    <span dir="ltr" style={{ fontWeight: 700 }}>{parent.idNumber}</span>
                    <span style={{ opacity: .4 }}>·</span>
                    <span dir="ltr" style={{ fontWeight: 700 }}>{parent.phone}</span>
                    <button
                      type="button"
                      onClick={() => setEditingIdentity(true)}
                      style={{
                        marginInlineStart: 'auto', background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10,
                        color: 'rgba(255,255,255,0.7)', fontFamily: 'inherit',
                        fontSize: 12, padding: '6px 10px', cursor: 'pointer',
                      }}
                    >
                      שינוי
                    </button>
                  </div>
                )}
                {otp.stage === 'code' && (
                  <PhoneCodeGate
                    otp={otp}
                    phone={parent.phone.trim()}
                    onCodeChange={(code) => setOtp((o) => ({ ...o, code, error: '' }))}
                    onVerify={verifyOtpCode}
                    onResend={sendOtpCode}
                    onEditPhone={() => setOtp((o) => ({ ...o, stage: 'idle', code: '', error: '' }))}
                  />
                )}
              </>
            )}
            {identityReady && !healthOnlyMode && (
              <>
                {!prefilledParentId && (
                  <div style={{
                    background: 'var(--form-accent-soft, rgba(249,115,22,.10))',
                    border: '1px solid var(--form-accent-border, rgba(249,115,22,.35))',
                    borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 1.6,
                    color: 'var(--form-accent-text, #fdba74)', marginBottom: 16,
                  }}>
                    לא נמצא תיק תואם. תיק משפחה חדש ייפתח רק לאחר שליחת הטופס.
                  </div>
                )}
            {!parentProfileLocked && (
              <>
            <div className="section-title">
              {g('פרטי ממלא הטופס', 'פרטי ממלאת הטופס', 'פרטי ממלא/ת הטופס')}
            </div>
            {/* הכוכבית לבדה לא אומרת כלום למי שלא מכיר את המוסכמה. שורה אחת
                בראש הסעיף מסבירה אותה פעם אחת, במקום להסביר ליד כל שדה. */}
            <div className="required-legend">
              שדות המסומנים ב־<span className="req-star">*</span> הם שדות חובה
            </div>
            {/* First name and surname are separate on purpose: the surname is
                what recognises a second parent of a household we already know,
                and it also reaches the invoice. Guessing it from the last word
                of a free-text name gets it backwards for anyone who writes the
                family name first. Side by side, they read as one name — and the
                section heading above already says whose. */}
            <div className="form-row">
              <div className="form-group">
                <label>שם פרטי *</label>
                <input
                  value={parent.name}
                  onChange={(e) => setParent((p) => ({ ...p, name: e.target.value }))}
                  placeholder="ישראל"
                  style={missingStyle('name')}
                />
              </div>
              <div className="form-group">
                <label>שם משפחה *</label>
                <input
                  value={parent.lastName}
                  onChange={(e) => setParent((p) => ({ ...p, lastName: e.target.value }))}
                  placeholder="ישראלי"
                  style={missingStyle('lastName')}
                />
              </div>
            </div>
            {/* מין ממלא/ת הטופס — הכרטיס בתיק מציג „זכר / נקבה”, ובלי השדה כאן
                הוא נשאר „לא צוין” לכל מי שנרשם דרך הטופס הציבורי. */}
            <div className="form-group">
              <label>תאריך לידה <span className="req-star">*</span></label>
              <input
                type="date"
                value={parent.birthDate}
                onChange={(e) => setParent((p) => ({ ...p, birthDate: e.target.value }))}
                style={missingStyle('birthDate')}
              />
            </div>
            <div className="form-group">
              <label>מין <span className="req-star">*</span></label>
              <div style={isMissing('gender')
                ? {
                    border: '1px solid rgba(252,211,77,.55)', background: 'rgba(251,191,36,.07)',
                    borderRadius: 12, padding: 6,
                  }
                : undefined}
              >
                <GenderPicker
                  value={parent.gender}
                  onChange={(value) => setParent((p) => ({ ...p, gender: value }))}
                  options={ADULT_GENDER_OPTIONS}
                />
              </div>
            </div>
            {/* שתי שורות קצרות זו לצד זו, כמו השם והמשפחה שמעליהן. */}
            <div className="form-row">
              <div className="form-group">
                <label>אימייל <span className="req-star">*</span></label>
                <input
                  type="email"
                  value={parent.email}
                  onChange={(e) => setParent((p) => ({ ...p, email: e.target.value }))}
                  placeholder="name@email.com"
                  style={missingStyle('email')}
                />
                <small className="field-hint">לכתובת הזו נשלחות הקבלות והחשבוניות</small>
              </div>
              <div className="form-group">
                <label>מקום מגורים <span className="req-star">*</span></label>
                <input
                  value={parent.city}
                  onChange={(e) => setParent((p) => ({ ...p, city: e.target.value }))}
                  placeholder="עיר / יישוב"
                  style={missingStyle('city')}
                />
              </div>
            </div>
              </>
            )}
            {knownFile && (
              <div style={{
                background: 'var(--form-accent-soft, rgba(249,115,22,.12))',
                border: '1px solid var(--form-accent-border, rgba(249,115,22,.35))',
                borderRadius: 12, padding: 12, fontSize: 13, lineHeight: 1.6,
                color: 'var(--form-accent-text, #fdba74)', marginTop: 4,
              }}>
                מצאנו את התיק שלך במערכת.
                {knownFile.children.length
                  ? ` ${knownFile.children.join(', ')} ${knownFile.children.length > 1
                    ? 'כבר רשומים ומופיעים'
                    : 'כבר רשום/ה ומופיע/ה'} בשלב הבא.`
                  : ''}
              </div>
            )}

            {/* אוויר וקו מפריד: מכאן ואילך זה כבר לא מילוי פרטים אלא בחירה
                שאפשר גם לא לעשות. */}
            <div
              className="section-title"
              style={{
                marginTop: 38, paddingTop: 26,
                borderTop: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              הזדמנות לערוך את העדפות הדיוור שלך
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: -6, marginBottom: 12, lineHeight: 1.45 }}>
              ההרשמה לדיוור היא פר משפחה
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {listDefs.map((list) => {
                const isRequired = !!effectiveRequiredListKey && list.key === effectiveRequiredListKey;
                const checked = isRequired ? true : subscriptions[list.key] === true;
                return (
                  <label
                    key={list.key}
                    className="event-check"
                    style={{
                      cursor: isRequired ? 'default' : 'pointer',
                      borderColor: checked ? 'var(--form-accent-border, rgba(249,115,22,0.45))' : 'rgba(255,255,255,0.08)',
                      background: checked ? 'var(--form-accent-soft, rgba(249,115,22,0.08))' : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isRequired}
                      onChange={() => {
                        if (isRequired) return;
                        setSubscriptions((prev) => ({
                          ...prev,
                          [list.key]: !prev[list.key],
                          ...(effectiveRequiredListKey ? { [effectiveRequiredListKey]: true } : null),
                        }));
                      }}
                    />
                    <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      {(() => {
                        const [Icon, color] = LIST_ICONS[list.key] || [];
                        return Icon
                          ? <Icon size={17} color={color} style={{ flexShrink: 0, marginTop: 3 }} />
                          : null;
                      })()}
                      <span>
                        <strong>{list.label || list.key}</strong>
                        {list.description ? ` — ${list.description}` : ''}
                        {isRequired ? ' (חובה — חלק מהשירות)' : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
              {!listDefs.length && (
                <div style={{ fontSize: 13, color: '#FCA5A5' }}>
                  לא נטענו רשימות דיוור — רעננו את הדף
                </div>
              )}
            </div>

            <KnownFamilyPrompt
              families={families}
              chosenId={familyParentId}
              onChoose={setFamilyParentId}
            />
            <KnownFamilyNote
              families={families}
              chosenId={familyParentId}
              onCancel={() => setFamilyParentId(null)}
            />
              </>
            )}

            {identityReady && healthOnlyMode && children.some((child) => String(child.id || '') === targetStudentId) && (
              <div style={{
                background: 'var(--form-accent-soft, rgba(56,189,248,.1))',
                border: '1px solid var(--form-accent-border, rgba(56,189,248,.4))',
                borderRadius: 14, padding: 14, marginTop: 14, lineHeight: 1.6,
                color: 'var(--form-accent-text, #7dd3fc)', fontWeight: 700,
              }}>
                זוהה התיק. במסך הבא תופיע הצהרת הבריאות של{' '}
                {children.find((child) => String(child.id || '') === targetStudentId)?.name} בלבד.
              </div>
            )}

            {error && <ErrorBox message={error} />}

            {otp.stage === 'code' || waitingForFamily ? null : (
              <button
                type="button"
                className="event-primary"
                style={{ marginTop: 8 }}
                onClick={goNextFromParent}
                disabled={otp.sending}
              >
                {/* הכפתור אומר מה הוא עושה עכשיו. לפני האימות הלחיצה שולחת קוד
                    ולא ממשיכה לשום מקום, ו„המשך לפרטי משתתפים” הבטיח מסך שלא
                    מגיע. */}
                {otp.sending
                  ? 'שולח קוד אימות בוואטסאפ…'
                  : (needsPhoneVerification
                    ? 'שלח קוד אימות בוואטסאפ'
                    : <>{healthOnlyMode ? 'המשך למילוי הצהרת הבריאות' : 'המשך לפרטי משתתפים'} <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} /></>)}
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="section-title">
              {healthOnlyMode ? `עדכון פרטי ${children[0]?.name || 'המשתתף/ת'}` : 'בחירת בני המשפחה המשתתפים בפעילות'}
            </div>
            {!healthOnlyMode && (
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '0 0 14px' }}>
                השיבוץ לפעילות יבוצע על ידי הצוות בהמשך.
              </p>
            )}
            {/* כרטיס אחד לכל משתתף, ובכל כרטיס אותם שלושה חלקים באותו סדר:
                מי זה, איפה עומדת ההצהרה שלו, ומה אפשר לעשות. השדות נפתחים
                בתוך הכרטיס רק כשהוא באמת אוסף פרטים. */}
            {(() => {
            const renderParticipantCard = (child, index) => {
              const cardState = participantCardState(child);
              const typedName = (child.name || '').trim();
              const namePhrase = typedName || 'משתתף/ת זה';
              const age = ageFromBirthDate(child.birthDate);
              // מגדר של מי שהכרטיס עליו — לא של מי שממלא את הטופס.
              const cg = (male, female) => (child.gender === 'male'
                ? male
                : child.gender === 'female'
                  ? female
                  : `${male}/${female.slice(-1)}`);
              const asksDetails = fillsOwnDetails(child)
                && !hasLockedParticipantProfile(child)
                && !selfCardFromDetails(child);
              return (
              <div
                key={child.id || index}
                style={{
                  border: '1px solid var(--form-accent-border, rgba(56,189,248,.35))',
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 14,
                  background: 'var(--form-accent-soft, rgba(56,189,248,.07))',
                  opacity: cardState === 'skipped' || cardState === 'blocked' ? .72 : 1,
                }}
              >
                {/* מי זה. השם הוא הכותרת — מספר סידורי לא אמר להורה על מי
                    הוא עומד לשנות משהו. מתחתיו שורה אחת: מין, מי הוא ביחס
                    לחותם, ותאריך הלידה עם הגיל. */}
                <div style={{ minWidth: 0, marginBottom: 12 }}>
                  {typedName ? (
                    <div style={{
                      fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.25,
                      overflowWrap: 'anywhere',
                    }}>
                      {typedName}
                    </div>
                  ) : (
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.45)', lineHeight: 1.25 }}>
                      {child.type === 'adult' ? 'משתתף/ת מבוגר/ת' : 'משתתף/ת חדש/ה'}
                    </div>
                  )}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4,
                    fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 700,
                  }}>
                    <GenderMark
                      gender={child.gender}
                      labels={child.type === 'adult' ? ['גבר', 'אישה'] : ['ילד', 'ילדה']}
                    />
                    <span>{participantRelationLabel(child)}</span>
                    {child.birthDate && (
                      <>
                        <span style={{ opacity: .4 }}>·</span>
                        <span>{formatSignedDay(child.birthDate)}</span>
                        {age !== null && <span style={{ opacity: .75 }}>{`(גיל ${age})`}</span>}
                      </>
                    )}
                  </div>
                  {/* ממלא הטופס רואה בכרטיס שלו את סיכום הפרטים שמסר במסך
                      הקודם — עליהם הוא עונה „משתתף” או „לא”. */}
                  {child.relationToSigner === 'self' && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3,
                      fontSize: 12, color: 'rgba(255,255,255,0.6)', fontWeight: 700,
                    }}>
                      {(child.idNumber || '').trim() && (
                        <span>ת״ז <span dir="ltr">{child.idNumber.trim()}</span></span>
                      )}
                      {(parent.phone || '').trim() && (
                        <>
                          <span style={{ opacity: .4 }}>·</span>
                          <span dir="ltr">{parent.phone.trim()}</span>
                        </>
                      )}
                      {(parent.email || '').trim() && (
                        <>
                          <span style={{ opacity: .4 }}>·</span>
                          <span dir="ltr" style={{ overflowWrap: 'anywhere' }}>{parent.email.trim()}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* איפה עומדת ההצהרה. פס אחד, אותו מקום בכל כרטיס. */}
                {cardState === 'blocked' && (
                  <CardStatus
                    tone="stop"
                    icon={<AlertTriangle size={15} />}
                    title="מעל גיל 18 — חותם/ת בעצמו/ה"
                  >
                    חתימת הורה תקפה רק עד גיל 18. {namePhrase}
                    {' '}צריך/ה למלא את הטופס בעצמו/ה — העבירו לו/ה את הקישור לטופס,
                    ושם יש לסמן „אני מעל גיל 18 ואני ממלא/ת עבור עצמי”.
                    {' '}הכרטיס הזה לא ייכלל בשליחה.
                  </CardStatus>
                )}

                {cardState === 'skipped' && (
                  <CardStatus tone="muted" title="לא ימולא הפעם — לא ייכלל בשליחה" />
                )}

                {/* ענה „כן”: פס אחד שאומר מה יקרה במסך הבא. ההצהרה ממולאת
                    תמיד מחדש — היא קצרה, ומנגנון שלם של „בתוקף / לחדש / משהו
                    השתנה” עלה בבלבול יותר משחסך בזמן. הצבע עדיין מספר מה יש
                    בתיק: כחול — יש הצהרה והיא תרוענן; צהוב — אין או שפגה. */}
                {cardState === 'participating' && (child.onFileHealthValid ? (
                  /* שורה אחת ובלי תאריך — ההצהרה מתרעננת ממילא, אז מתי נחתמה
                     הקודמת לא משנה לאף החלטה כאן. */
                  <CardStatus
                    tone="info"
                    icon={<ShieldCheck size={15} />}
                    title="יש לנו הצהרת בריאות קודמת שלכם — היום נרענן אותה"
                  />
                ) : child.id ? (
                  <CardStatus
                    tone="warn"
                    icon={<AlertTriangle size={15} />}
                    title={child.onFileHealthSignedAt
                      ? `${declarationContextLabel} אינה בתוקף — נמלא אותה במסך הבא`
                      : `אין ${declarationContextLabel} — נמלא אותה במסך הבא`}
                  />
                ) : (
                  /* כרטיס שהוקלד עכשיו: אין תיק שאפשר „לא למצוא” בו כלום. */
                  <CardStatus
                    tone="muted"
                    title={`הצהרת הבריאות של ${typedName || 'המשתתף/ת'} תמולא במסך הבא`}
                  />
                ))}

                {/* קודם בוחרים מי משתתף; מצב ההצהרה מתגלה רק אחרי „כן”.
                    כרטיס שלא נענה פשוט לא נכנס לשליחה. */}
                {cardState === 'undecided' && (
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
                    {child.relationToSigner === 'self'
                      ? `האם ${cg('אתה משתתף', 'את משתתפת')} בפעילות?`
                      : `האם ${typedName || 'המשתתף/ת'} ${cg('משתתף', 'משתתפת')} בפעילות?`}
                  </div>
                )}

                {/* הפרטים עצמם, כשהכרטיס אוסף אותם. */}
                {asksDetails && (
                <div style={{ marginTop: 14 }}>
                {/* שם פרטי ושם משפחה בשני שדות — כמו על תיק ההורה, ולא ניחוש
                    מהמילה האחרונה. הכרטיס של החותם מציג את שמו המלא כמו
                    שהוקלד במסך הקודם. */}
                {child.relationToSigner === 'self' ? (
                <div className="form-group">
                  <label>שם מלא *</label>
                  <input value={child.name} readOnly style={emptyStyle(child.name)} />
                </div>
                ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label>{child.type === 'adult' ? 'שם פרטי *' : 'שם פרטי של הילד/ה *'}</label>
                    <input
                      value={child.name}
                      onChange={(e) => updateChild(index, { name: e.target.value })}
                      placeholder="שם פרטי"
                      style={emptyStyle(child.name)}
                    />
                  </div>
                  <div className="form-group">
                    <label>{`שם משפחה${child.type === 'adult' ? ' *' : ''}`}</label>
                    <input
                      value={child.lastName || ''}
                      onChange={(e) => updateChild(index, { lastName: e.target.value })}
                      placeholder={child.type !== 'adult' && parent.lastName.trim()
                        ? parent.lastName.trim()
                        : 'שם משפחה'}
                      style={child.type === 'adult' ? emptyStyle(child.lastName) : undefined}
                    />
                    {/* ריק אצל ילד — שם המשפחה של ההורה מושלם מעצמו. */}
                    {child.type !== 'adult' && !String(child.lastName || '').trim() && parent.lastName.trim() && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
                        אם נשאר ריק: {parent.lastName.trim()}
                      </div>
                    )}
                  </div>
                </div>
                )}
                <div className="form-group">
                  <label>תעודת זהות *</label>
                  <input
                    inputMode="numeric"
                    value={child.idNumber || ''}
                    onChange={(e) => updateChild(index, { idNumber: e.target.value })}
                    placeholder="9 ספרות"
                  />
                </div>
                <div className="form-group">
                  {/* Required for an adult too now: it is the birth date, not
                      the tick box, that decides whether this person may sign
                      for themselves at all. */}
                  <label>תאריך לידה *</label>
                  <input
                    type="date"
                    value={child.birthDate}
                    onChange={(e) => updateChild(index, { birthDate: e.target.value })}
                  />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
                    {/* The age is here to be glanced at: a wrong year is obvious
                        as an age and invisible as a date. */}
                    {age !== null ? `גיל: ${age}` : 'לבחירת שנה — לחצו על השנה עצמה בחלון שנפתח.'}
                  </div>
                  {child.type === 'adult' && age !== null && age < 18 && (
                    <div style={{
                      background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.35)',
                      borderRadius: 10, padding: 10, marginTop: 8,
                      fontSize: 12, lineHeight: 1.5, color: '#fca5a5',
                    }}>
                      מתחת לגיל 18 חובה שהורה או אפוטרופוס ימלא ויחתום.
                      חזרו לשלב הקודם והסירו את הסימון „אני מעל גיל 18”.
                    </div>
                  )}
                  {/* הצד השני של אותו כלל: הורה חותם רק על קטינים. */}
                  {needsOwnSignature(child) && (
                    <div style={{
                      background: 'rgba(248,113,113,.12)', border: '1px solid rgba(248,113,113,.35)',
                      borderRadius: 10, padding: 10, marginTop: 8,
                      fontSize: 12, lineHeight: 1.5, color: '#fca5a5',
                    }}>
                      מגיל 18 ומעלה חתימת הורה אינה תקפה — {typedName || 'המשתתף/ת'}
                      {' '}צריך/ה למלא טופס בעצמו/ה ולסמן בו „אני מעל גיל 18 ואני ממלא/ת עבור עצמי”.
                    </div>
                  )}
                </div>
                <KnownChildPrompt
                  childName={child.name}
                  match={knownChildren[childKey(child)]}
                  onAnswer={(linked) => setKnownChildren((current) => ({
                    ...current,
                    [childKey(child)]: { ...current[childKey(child)], linked },
                  }))}
                />
                <KnownChildNote childName={child.name} match={knownChildren[childKey(child)]} />
                {/* Asked of every participant, an adult included: it is how the
                    CRM addresses them and how groups are made up, and it was
                    only ever inside the children-only block by accident. The
                    wording changes with who is answering; the stored value does
                    not. */}
                <div className="form-group">
                  {/* Two buttons rather than a native list: the dropdown is
                      drawn by the operating system, so its highlighted row
                      keeps its own light colours however the page is
                      styled. Same control as the health questions. */}
                  <label>{child.type === 'adult' ? 'מין' : 'בן / בת'}</label>
                  <GenderPicker
                    value={child.gender}
                    onChange={(gender) => updateChild(index, { gender })}
                    options={child.type === 'adult'
                      ? ADULT_GENDER_OPTIONS
                      : CHILD_GENDER_OPTIONS}
                  />
                </div>
                {/* בן/בת זוג נכנס/ת לתיק כהורה נוסף, וזה דורש מספר טלפון —
                    אין דרך אחרת לזהות אדם ולא ליצור לו תיק כפול. */}
                {child.relationToSigner === 'spouse' && (
                  <div className="form-group">
                    <label>טלפון <span className="req-star">*</span></label>
                    <input
                      type="tel"
                      value={child.spousePhone || ''}
                      onChange={(e) => updateChild(index, { spousePhone: e.target.value })}
                      placeholder="מספר הטלפון של בן/בת הזוג"
                    />
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6, lineHeight: 1.5 }}>
                      יתווסף לתיק המשפחה כהורה נוסף
                    </div>
                  </div>
                )}
                {/* The child's own phone. An adult already gave theirs on the
                    first step, so asking again would be asking twice. */}
                {child.type !== 'adult' && (
                  <div className="form-group">
                    <label>טלפון של הילד/ה</label>
                    {/* הסבר ארוך בתוך שדה נחתך בטלפון — placeholder לא נשבר
                        לשורה שנייה. ההסבר יורד מתחת לשדה, ובשדה נשאר רק
                        מה שצריך להקליד. */}
                    <input
                      type="tel"
                      value={child.childPhone}
                      onChange={(e) => updateChild(index, { childPhone: e.target.value })}
                      placeholder="לא חובה"
                    />
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6, lineHeight: 1.5 }}>
                      בשביל יומן המטפסים ופיצ'רים מגניבים לילדים
                    </div>
                  </div>
                )}
                <div className="form-group">
                  <label>הערות להרשמה</label>
                  {/* אותה בעיה: השורה נחתכה באמצע. textarea נשברת לשורות
                      ומראה את כל מה שנכתב בה. */}
                  <textarea
                    rows={2}
                    value={child.registrationNotes}
                    onChange={(e) => updateChild(index, { registrationNotes: e.target.value })}
                    placeholder="לא חובה"
                    style={{ resize: 'vertical', minHeight: 62 }}
                  />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6, lineHeight: 1.5 }}>
                    יום שמתאים, רוצים להירשם אחרי תאריך מסוים וכו׳
                  </div>
                </div>
                </div>
                )}

                {/* מה אפשר לעשות עם הכרטיס. שורה אחת, תמיד בתחתיתו — קודם
                    כל כפתור ישב ליד הבלוק שיצר אותו, ואף אחד לא ידע איפה
                    לחפש. השאלה המאשרת מחליפה את הכפתורים באותו מקום. */}
                {cardState === 'skipped' && (
                  <CardActions>
                    <CardButton onClick={() => updateChild(index, { participates: null, confirmSkip: false })}>
                      {cg('בעצם כן, משתתף', 'בעצם כן, משתתפת')}
                    </CardButton>
                  </CardActions>
                )}

                {cardState === 'undecided' && (child.confirmSkip ? (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#FCA5A5', marginTop: 12 }}>
                      בטוח? {typedName || 'אותו אדם'} לא יוכל/תוכל להשתתף בפעילות.
                    </div>
                    <CardActions>
                      <CardButton
                        variant="danger"
                        onClick={() => answerParticipation(index, false)}
                      >
                        {cg('כן, לא משתתף', 'כן, לא משתתפת')}
                      </CardButton>
                      <CardButton onClick={() => updateChild(index, { confirmSkip: false })}>
                        ביטול
                      </CardButton>
                    </CardActions>
                  </>
                ) : (
                  <CardActions>
                    {/* שתי תשובות לאותה שאלה — שתיהן באותו מסגור. מסגור אחד
                        צהוב ואחד אפור אמר שיש תשובה נכונה, וזו לא הייתה
                        השאלה. */}
                    <CardButton
                      variant="offer"
                      onClick={() => answerParticipation(index, true)}
                    >
                      {cg('כן, משתתף', 'כן, משתתפת')}
                    </CardButton>
                    <CardButton variant="offer" onClick={() => updateChild(index, { confirmSkip: true })}>
                      {cg('לא משתתף', 'לא משתתפת')}
                    </CardButton>
                  </CardActions>
                ))}

                {cardState === 'participating' && (
                  <CardActions>
                    {/* התחרטות: מי שמהתיק חוזר לשאלת ההשתתפות; כרטיס שהוקלד
                        ידנית פשוט יורד. הפרטים עצמם מגיעים מהתיק ואינם נערכים
                        כאן — טעות בהם מתקנים מול הצוות. */}
                    {(child.id || child.relationToSigner === 'self') ? (
                      <CardButton onClick={() => updateChild(index, { participates: null, renewOptIn: false, editProfile: false })}>
                        ביטול
                      </CardButton>
                    ) : (
                      <CardButton onClick={() => setChildren((prev) => prev.filter((_, i) => i !== index))}>
                        ביטול ההוספה
                      </CardButton>
                    )}
                  </CardActions>
                )}
              </div>
              );
            };

            // מקשה אחת, שני חלקים: הורים למעלה, ילדים למטה. כפתור ההוספה של
            // כל סוג יושב בחלק שלו, והקרבה של הילדים נענית באישור אחד על
            // כל הרשימה במקום שאלה על כל כרטיס.
            const addButtonStyle = {
              width: '100%', background: 'transparent', border: '1px dashed rgba(255,255,255,0.25)',
              color: 'rgba(255,255,255,0.72)', padding: 12, borderRadius: 12, cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16,
            };
            const sectionTitleStyle = {
              fontSize: 15, fontWeight: 800, color: 'rgba(255,255,255,0.85)',
              margin: '4px 0 12px', paddingBottom: 8,
              borderBottom: '1px solid rgba(255,255,255,0.12)',
            };
            if (healthOnlyMode) return children.map(renderParticipantCard);
            const indexed = children.map((child, index) => [child, index]);
            const adultCards = indexed.filter(([child]) => child.type === 'adult');
            const childCards = indexed.filter(([child]) => child.type !== 'adult');
            // האישור נדרש רק על ילדים שנבחרו להשתתף. כשאף אחד מהם לא משתתף
            // אין טענה על קרבה שצריך לאשר, והתיבה רק הוסיפה שלב.
            const namedKids = childCards.filter(([child]) => (
              String(child.name || '').trim() && child.participates === true
            ));
            const childrenConfirmed = namedKids.length > 0
              && namedKids.every(([child]) => child.relationToSigner === 'child');
            // מסמן רק את מי שהאישור מדבר עליו — ילד שנאמר עליו „לא משתתף”
            // אינו חלק מהטענה, ואיפוס הקרבה שלו רק החזיר שאלה שכבר נענתה.
            const setChildrenConfirmed = (on) => setChildren((prev) => prev.map((c) => (
              c.type === 'adult' || c.participates !== true
                ? c
                : { ...c, relationToSigner: on ? 'child' : '' }
            )));
            return (
              <>
                <div style={sectionTitleStyle}>הורים</div>
                {adultCards.map(([child, index]) => renderParticipantCard(child, index))}
                <button type="button" onClick={addSpouse} style={addButtonStyle}>
                  <Plus size={16} /> הוספת בן/בת זוג
                </button>

                <div style={sectionTitleStyle}>ילדים</div>
                {childCards.map(([child, index]) => renderParticipantCard(child, index))}
                {namedKids.length > 0 && (
                  /* אישור אחד על הרשימה כולה. הוספה לתיק משפחה היא טענה על
                     קרבה, והיא נטענת במפורש — אבל פעם אחת, לא שאלה נפרדת
                     על כל כרטיס. */
                  <label
                    className="event-check"
                    style={{
                      cursor: 'pointer', marginBottom: 16,
                      borderColor: childrenConfirmed ? 'var(--form-accent-border, rgba(249,115,22,0.45))' : 'rgba(252,211,77,.55)',
                      background: childrenConfirmed ? 'var(--form-accent-soft, rgba(249,115,22,0.08))' : 'rgba(251,191,36,.07)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={childrenConfirmed}
                      onChange={() => setChildrenConfirmed(!childrenConfirmed)}
                    />
                    <span>{g('אני מאשר שאלו הם ילדיי', 'אני מאשרת שאלו הם ילדיי', 'אני מאשר/ת שאלו הם ילדיי')}</span>
                  </label>
                )}
                <button type="button" onClick={addChild} style={addButtonStyle}>
                  <Plus size={16} /> הוספת ילד/ה נוסף/ת
                </button>
              </>
            );
            })()}
            {error && <ErrorBox message={error} />}
            <button type="button" className="event-primary" onClick={goNextFromChildren}>
              {healthOnlyMode
                ? 'שמירת הפרטים וחזרה להצהרת הבריאות'
                : (healthNamesText ? `המשך למילוי הצהרת הבריאות של ${healthNamesText}` : 'המשך למילוי הצהרת בריאות')}
              {' '}<ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
            </button>
          </div>
        )}

        {step === 3 && (currentChild || healthSubStep === SUB_PAYMENT) && (
          <div className="fade-in">
            {healthSubStep === SUB_HEALTH && currentChild && (
              <>
                {/* Whose declaration this is. It was shown only to a participant
                    on file, so the parent — who is on the same screen answering
                    about themselves — had nothing but the heading to go by. */}
                {hasCompleteParticipantProfile(currentChild) && !currentChild.editProfile && (
                  <ParticipantProfileSummary participant={currentChild} />
                )}
                {/* Screening first: what we need to know before anyone climbs,
                    and answered כן/לא rather than ticked — a blank box would
                    file "nobody asked" as "no". The heading is the page title
                    above; repeating it here said the same thing twice. */}
                {currentScreening.length > 0 && (
                  <>
                    <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 14 }}>
                      תשובה „כן” לא מונעת השתתפות. היא רק מאפשרת לצוות לדעת ולהיערך.
                    </p>
                    {currentScreening.map((q) => (
                      <div key={q.id} style={{
                        background: 'rgba(0,0,0,0.18)', borderRadius: 12, padding: 12,
                        marginBottom: 10,
                      }}>
                        <div style={{
                          fontSize: 14, lineHeight: 1.5, marginBottom: 10,
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                        }}>
                          {(() => {
                            const [Icon, color] = QUESTION_ICONS[q.id] || [];
                            return Icon
                              ? <Icon size={17} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
                              : null;
                          })()}
                          <span>{questionLabel(q)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {[['כן', true], ['לא', false]].map(([text, value]) => (
                            <button
                              key={text}
                              type="button"
                              onClick={() => {
                                recordTick(`${q.id}:${value ? 'yes' : 'no'}`, true);
                                setCurrentAnswer(q.id, value);
                              }}
                              style={{
                                flex: 1, padding: '9px 0', borderRadius: 10, font: 'inherit',
                                fontWeight: 700, fontSize: 14, cursor: 'pointer',
                                border: currentAnswers[q.id] === value
                                  ? '1px solid var(--form-accent-solid, #f97316)'
                                  : '1px solid rgba(255,255,255,.15)',
                                background: currentAnswers[q.id] === value
                                  ? 'var(--form-accent-soft-strong, rgba(249,115,22,.18))'
                                  : 'rgba(255,255,255,.05)',
                                color: currentAnswers[q.id] === value ? 'var(--form-accent-text, #fdba74)' : '#e2e8f0',
                              }}
                            >
                              {text}
                            </button>
                          ))}
                        </div>
                        {/* The detail opens under the question it answers,
                            so what is typed is tied to what was asked —
                            one shared box at the bottom collected three
                            conditions as one unattributed paragraph. */}
                        {currentAnswers[q.id] === true && (
                          <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                            <label>פרטו בבקשה *</label>
                            <textarea
                              rows={2}
                              value={children[currentFullIndex]?.answerNotes?.[q.id] || ''}
                              onChange={(e) => updateChild(currentFullIndex, (child) => ({
                                answerNotes: { ...(child.answerNotes || {}), [q.id]: e.target.value },
                              }))}
                              placeholder={detailPrompt(q)}
                              style={{ resize: 'vertical' }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    {hasPositiveScreening(currentScreening, currentAnswers) && (
                      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 4, lineHeight: 1.5 }}>
                        {/* The detail is a declaration by the signer, not a
                            briefing we undertake to act on. */}
                        הפירוט נמסר על אחריות החותם/ת. האחריות להתאמת הפעילות למצב הרפואי,
                        ולהיוועצות ברופא לפני ההשתתפות, היא של החותם/ת בלבד.
                      </p>
                    )}
                    {needsMedicalClearance(currentScreening, currentAnswers) && (
                      <MedicalClearanceField
                        triggers={clearanceTriggers(currentScreening, currentAnswers)}
                        value={children[currentFullIndex]?.medicalClearance || null}
                        onChange={(file) => updateChild(currentFullIndex, { medicalClearance: file })}
                        onError={setError}
                      />
                    )}
                  </>
                )}
                {/* ההתחייבות להודיע על שינוי רפואי נאמרת פעם אחת, בסעיף 3 של
                    כתב הוויתור — שם היא גם מחייבת. הערה כאן הייתה אותו משפט
                    בלבוש של הודעה על המסך. */}
                {error && <ErrorBox message={error} />}
                <button type="button" className="event-primary" style={{ marginTop: 16 }} onClick={advanceHealthOrSubmit}>
                  {childHealthIndex < kids.length - 1
                    ? `המשך למילוי הצהרת הבריאות של ${String(kids[childHealthIndex + 1]?.name || '').trim().split(/\s+/)[0] || 'המשתתף/ת הבא/ה'}`
                    : (sharedConfirmations.length
                      ? `המשך ל${sectionTitles.confirm}`
                      : 'המשך לאישור וחתימה')}
                  {' '}<ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
                </button>
              </>
            )}

            {healthSubStep === SUB_ACTIVITY && (
              <>
                {/* קודם מה הפעילות היא — זה נקרא, לא מסומן — ורק אחריה הכללים
                    שנובעים ממנה, שאותם מסמנים אחד אחד. */}
                {activityNatureText && (
                  <>
                    <div className="section-title">אופי הפעילות</div>
                    <div style={{
                      background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 12, padding: 14, marginBottom: 22,
                      fontSize: 13.5, lineHeight: 1.8, color: 'rgba(255,255,255,0.85)',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {activityNatureText}
                    </div>
                  </>
                )}
                {/* בקשה אחת בכותרת, במקום כותרת ואחריה שורה אדומה שאומרת
                    כמעט את אותו הדבר. */}
                <div className="section-title">
                  כללי בטיחות
                  {kids.some((kid) => kid.type !== 'adult')
                    ? ' — אנא הסבירו אותם גם לילדיכם'
                    : ''}
                </div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 14 }}>
                  {signingNames.length > 1
                    ? `הכללים חלים על כל המשתתפים: ${signingFirstNames.join(', ')}. יש לסמן את כולם לאחר שקראתם אותם.`
                    : 'יש לסמן את כל הכללים לאחר שקראתם אותם.'}
                </p>
                {sharedConfirmations.map((q) => (
                  <label key={q.id} className="event-check" style={{ marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={activityConfirmed[q.id] === true}
                      onChange={(e) => {
                        recordTick(q.id, e.target.checked);
                        setActivityConfirmed((current) => ({ ...current, [q.id]: e.target.checked }));
                      }}
                    />
                    <span>{questionLabel(q)}</span>
                  </label>
                ))}
                {error && <ErrorBox message={error} />}
                <button type="button" className="event-primary" style={{ marginTop: 16 }} onClick={advanceHealthOrSubmit}>
                  המשך לאישור השתתפות וחתימה
                  {' '}<ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
                </button>
              </>
            )}

            {healthSubStep === SUB_WAIVER && (
              <>
                {healthOnlyMode ? (
                  <>
                    <div style={{
                      background: 'rgba(56,189,248,.08)',
                      border: '1px solid rgba(56,189,248,.32)', borderRadius: 12,
                      padding: 14, marginBottom: 14, fontSize: 14, lineHeight: 1.7,
                      color: 'rgba(255,255,255,.88)',
                    }}>
                      {g('אני מאשר', 'אני מאשרת', 'אני מאשר/ת')} שהמידע שמסרתי בהצהרת
                      הבריאות מלא, נכון ומעודכן,
                      {' '}{g('ומתחייב', 'ומתחייבת', 'ומתחייב/ת')} לעדכן את הצוות בכל שינוי
                      במצב הבריאותי.
                    </div>
                    <label className="event-check">
                      <input
                        type="checkbox"
                        checked={healthDeclarationAccepted}
                        onChange={(e) => setHealthDeclarationAccepted(e.target.checked)}
                      />
                      <span>{g('קראתי ואני מאשר', 'קראתי ואני מאשרת', 'קראתי ואני מאשר/ת')} את הצהרת הבריאות</span>
                    </label>
                  </>
                ) : (
                  <>
                {/* One text, the binding one. It names nobody: the signer takes
                    responsibility for themselves and for the minors listed
                    above the signature field, so the same document serves a
                    whole family and is signed once. */}
                {/* „המפורטים לעיל” — הרשימה היא חלק מהמסמך ולכן היא פותחת אותו. */}
                {signingNames.length > 0 && (
                  <div style={{
                    marginBottom: 14, paddingBottom: 12,
                    borderBottom: '1px solid rgba(255,255,255,0.12)',
                    fontSize: 13.5, lineHeight: 1.7, color: 'rgba(255,255,255,0.85)',
                  }}>
                    <div style={{ color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
                      המסמך נחתם על ידי {parentFullName()} וחל על:
                    </div>
                    {coveredNames.map((name) => (
                      <div key={name} style={{ fontWeight: 700 }}>• {name}</div>
                    ))}
                  </div>
                )}
                {/* הנוסח זורם על הדף כמו כל השאר. בתוך חלונית עם גלילה משלה הוא
                    נראה כמו נספח שהחתימה שמתחתיו שייכת רק לו — והחתימה חלה על
                    כל מה שנמסר בטופס, לא רק עליו. */}
                <div style={{
                  fontSize: 13.5, lineHeight: 1.85, color: 'rgba(255,255,255,0.85)',
                  whiteSpace: 'pre-wrap', marginBottom: 16,
                }}>
                  {withMinorsClauses(
                    waiverBody,
                    kids.some((kid) => kid.type !== 'adult')
                  )}
                </div>
                {/* סוף הנוסח. תיבת האישור נפתחת כשהוא נראה על המסך — אותה ראיה
                    שהגלילה נתנה, בלי לכלוא את הטקסט בחלונית. */}
                <div ref={waiverEndRef} style={{ height: 1 }} />
                {fitnessDeclarations.map((q) => (
                  <label key={q.id} className="event-check" style={{ marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={activityConfirmed[q.id] === true}
                      onChange={(e) => {
                        recordTick(q.id, e.target.checked);
                        setActivityConfirmed((current) => ({ ...current, [q.id]: e.target.checked }));
                      }}
                    />
                    <span>{questionLabel(q)}</span>
                  </label>
                ))}
                <label className="event-check" style={{ opacity: waiverRead ? 1 : 0.55 }}>
                  <input
                    type="checkbox"
                    disabled={!waiverRead}
                    checked={waiverAccepted}
                    onChange={(e) => {
                      recordTick('waiver_accepted', e.target.checked);
                      setWaiverAccepted(e.target.checked);
                    }}
                  />
                  {/* מי שהאישור חל עליו, בתוך המשפט שמאשרים — לא רק ברשימה
                      שמעליו. זה מה שהחתימה למטה אומרת. */}
                  <span>
                    {g('קראתי ואני מאשר', 'קראתי ואני מאשרת', 'קראתי ואני מאשר/ת')}
                    {' '}את הסרת האחריות וכללי הבטיחות החלים על:{' '}
                    {coveredNames.join(', ')}
                  </span>
                </label>
                {!waiverRead && (
                  <p style={{ fontSize: 12, color: '#FCD34D', margin: '6px 2px 0' }}>
                    גללו את הנוסח המחייב עד סופו — רק אז אפשר לסמן את האישור.
                  </p>
                )}
                  </>
                )}

                <div className="section-title" style={{ marginTop: 20 }}>
                  {healthOnlyMode ? 'חתימה על הצהרת הבריאות' : 'חתימה על הצהרת בריאות והסרת אחריות'}
                </div>
                {/* על מה החתימה חלה. היא נרשמת על שתי הרשומות — הצהרת הבריאות
                    ואישור ההשתתפות — ובלי המשפט הזה המסך נראה כאילו חותמים רק
                    על הנוסח שמעליו. */}
                {!healthOnlyMode && (
                  <p style={{
                    fontSize: 13, lineHeight: 1.8, color: 'rgba(255,255,255,0.72)',
                    margin: '0 2px 12px',
                  }}>
                    החתימה חלה על הצהרת הבריאות שמילאתי, על כללי הבטיחות שסימנתי ועל כתב
                    הוויתור שלמעלה — עבור {coveredNames.join(', ')}.
                  </p>
                )}
                <div className="canvas-container">
                  <div className="canvas-toolbar">
                    <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <PenTool size={12} /> חתמו כאן
                    </span>
                    <button type="button" onClick={clearSignature} className="clear-btn">נקה</button>
                  </div>
                  <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseUp={stopDrawing}
                    onMouseOut={stopDrawing}
                    onMouseMove={draw}
                    onTouchStart={startDrawing}
                    onTouchEnd={stopDrawing}
                    onTouchMove={draw}
                    className="event-signature"
                  />
                </div>

                {error && <ErrorBox message={error} />}
                {uploadingPdfs && (
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 10 }}>
                    שומר עותק PDF בתיק האישי...
                  </p>
                )}
                <button
                  type="button"
                  className="event-primary"
                  style={{ marginTop: 16 }}
                  disabled={isSubmitting}
                  onClick={advanceHealthOrSubmit}
                >
                  {isSubmitting
                    ? 'שומר...'
                    : childHealthIndex < kids.length - 1
                      ? `שמור והמשך ל-${kids[childHealthIndex + 1]?.name || 'הבא'}`
                      : (eventMode ? 'שמירת הטפסים ומעבר לסיכום' : 'שלח')}
                </button>
              </>
            )}

            {/* מה נרשם, בכמה, ובאילו תנאים — המסך האחרון לפני החיוב. הוא קיים
                רק כשהטופס נפתח מדף אירוע: בלעדיו הטופס רק מתייק פרטים. */}
            {healthSubStep === SUB_PAYMENT && (
              <>
                <div className="event-summary">
                  <div>
                    <span>הפעילות</span>
                    <strong>{activity?.page_title || activity?.name || ''}</strong>
                  </div>
                  {activity?.date && (
                    <div>
                      <span>מתי</span>
                      <strong>
                        {formatSignedDay(activity.date)}
                        {activity.end_date && activity.end_date !== activity.date
                          ? ` – ${formatSignedDay(activity.end_date)}`
                          : ''}
                        {!activity.all_day && activity.start_time
                          ? ` · ${String(activity.start_time).slice(0, 5)}`
                          : ''}
                      </strong>
                    </div>
                  )}
                  {/* שורה אחת לכל החותמים — מי חתם, לא שורת "נחתם" לכל שם.
                      מי שמשלים חתימה בקישור נפרד מופיע בשורה משלו. */}
                  {eventParticipants.some((participant) => !defersDocuments(participant)) && (
                    <div>
                      <span>טופסי השתתפות נחתמו ונשמרו</span>
                      <strong>
                        {eventParticipants
                          .filter((participant) => !defersDocuments(participant))
                          .map((participant) => childFullName(participant))
                          .join(', ')}
                      </strong>
                    </div>
                  )}
                  {eventParticipants.some((participant) => defersDocuments(participant)) && (
                    <div>
                      <span>ישלימו חתימה בקישור נפרד</span>
                      <strong>
                        {eventParticipants
                          .filter((participant) => defersDocuments(participant))
                          .map((participant) => childFullName(participant))
                          .join(', ')}
                      </strong>
                    </div>
                  )}
                  {paidEvent && (
                    <div>
                      <span>מחיר למשתתף כולל מע״מ</span>
                      <strong>{formatIls(eventUnitVat.gross)}</strong>
                    </div>
                  )}
                  <div>
                    <span>מספר משתתפים</span>
                    <strong>{eventParticipants.length}</strong>
                  </div>
                  {paidEvent && (
                    <div className="event-total">
                      <span>סך הכול לתשלום</span>
                      <strong>{formatIls(eventTotalVat.gross)}</strong>
                    </div>
                  )}
                </div>

                {/* התנאים והאישור עליהם באותו מסך שבו משלמים — אישור שניתן
                    לפני שידעו מה הסכום אינו אישור על העסקה הזאת. */}
                {paidEvent && eventPolicy && (
                  <div className="event-policy" style={{ marginTop: 16 }}>
                    <h3><CalendarClock size={15} aria-hidden="true" />תנאי ביטול</h3>
                    {(eventPolicy.rules || []).map((rule) => {
                      const { period, outcome, tone } = cancellationRuleParts(rule);
                      return (
                        <div key={rule.id} className="event-policy-row">
                          <span className={`event-policy-dot is-${tone}`} aria-hidden="true" />
                          <div>
                            <div className="event-policy-when">{period}</div>
                            <div className={`event-policy-what is-${tone}`}>{outcome}</div>
                          </div>
                        </div>
                      );
                    })}
                    {eventPolicy.free_text && (
                      <p className="event-policy-note">{eventPolicy.free_text}</p>
                    )}
                    <label className="event-check">
                      <input
                        type="checkbox"
                        checked={policyAccepted}
                        onChange={(e) => {
                          recordTick('cancellation_policy_accepted', e.target.checked);
                          setPolicyAccepted(e.target.checked);
                        }}
                      />
                      <span>{g('קראתי ואני מאשר', 'קראתי ואני מאשרת', 'קראתי ואני מאשר/ת')} את תנאי הביטול</span>
                    </label>
                  </div>
                )}
                {!paidEvent && (
                  <p style={{ color: '#6ee7b7', fontSize: 14, marginTop: 14 }}>
                    אין צורך בתשלום — אישור ההרשמה שומר את המקומות.
                  </p>
                )}

                {error && <ErrorBox message={error} />}
                {uploadingPdfs && (
                  <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 10 }}>
                    שומר עותק PDF בתיק האישי...
                  </p>
                )}
                <button
                  type="button"
                  className="event-primary"
                  style={{ marginTop: 16 }}
                  disabled={isSubmitting}
                  onClick={advanceHealthOrSubmit}
                >
                  {isSubmitting
                    ? 'שולח...'
                    : paidEvent
                      ? `מעבר לתשלום · ${formatIls(eventTotalVat.gross)}`
                      : 'אישור הרשמה'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <FormStyles />
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div style={{
      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
      color: '#FCA5A5', padding: 12, borderRadius: 12, marginBottom: 12, fontSize: 14,
    }}>
      {message}
    </div>
  );
}

/**
 * The page, card, fields, buttons and signature come from the shared kit — the
 * same look as the event and shop pages. Only what this form alone has (the
 * brand circle, the step body padding, the canvas toolbar) is defined here.
 */
function FormStyles() {
  return (
    <>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700;800;900&display=swap" />
      <EventStyles />
      <style>{`
        .onboard-page {
          --form-accent-solid: #38bdf8;
          --form-accent-deep: #0284c7;
          --form-accent-text: #7dd3fc;
          --form-accent-border: rgba(56,189,248,.45);
          --form-accent-soft: rgba(56,189,248,.09);
          --form-accent-soft-strong: rgba(56,189,248,.18);
          color-scheme: dark;
          padding: 20px 14px 40px;
          background: radial-gradient(circle at top,#1e293b,#070b14 68%);
          color: #f8fafc;
          font-family: Heebo,Assistant,system-ui,sans-serif;
        }
        .onboard-page .event-card {
          width: min(720px,100%);
          padding-bottom: 24px;
          background: rgba(15,23,42,.96);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 22px;
          box-shadow: 0 24px 70px rgba(0,0,0,.35);
        }
        .fade-in { padding: 0 24px; animation: fadeIn .4s ease; }
        .event-centered .fade-in { padding: 0; }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .form-header { text-align: center; padding: 22px 24px 0; }
        .form-cover {
          margin: -22px -24px 16px; height: clamp(190px, 38vw, 300px);
          overflow: hidden; position: relative;
        }
        .form-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
        /* התמונה נמסכת אל רקע הכרטיס, כדי שהלוגו שמתחתיה לא יישב על קו חתוך. */
        .form-cover::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(180deg, rgba(15,23,42,0) 40%, rgba(15,23,42,.94) 100%);
        }
        .form-activity {
          font-size: clamp(15px, 3.4vw, 19px); font-weight: 800; letter-spacing: .01em;
          color: var(--form-accent-text, #7dd3fc); margin: 0 0 6px;
        }
        .logo-circle {
          width: 118px; height: 118px; border-radius: 0; background: transparent;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 18px; overflow: visible;
          filter: drop-shadow(0 10px 18px rgba(0,0,0,.32));
        }
        .logo-circle img { width: 100%; height: 100%; object-fit: contain; display: block; }
        /* clamp כדי שמשפט הפתיחה הארוך של הדף הראשון לא ישבור את הכותרת
           לשלוש שורות במסך צר. */
        .form-header h2 {
          margin: 0 0 6px; padding: 0; font-weight: 800;
          font-size: clamp(19px, 4.4vw, 24px); line-height: 1.3; text-wrap: balance;
        }
        .form-header h2.signing-document-title {
          margin-bottom: 0;
          font-size: clamp(15px, 3.4vw, 28px);
          line-height: 1.25;
          white-space: nowrap;
        }
        .form-header p { margin: 0; font-size: 13px; color: #94a3b8; }
        /* שורת הפעילויות בדף הראשון היא חלק מההסבר מה הטופס, לא הערת שוליים
           מתחתיו — ולכן היא גדולה ובהירה יותר משאר משפטי הכותרת. */
        .form-header p.form-intro-sub {
          font-size: clamp(14px, 3.2vw, 16.5px);
          line-height: 1.65;
          color: #cbd5e1;
          margin-top: 4px;
          text-wrap: balance;
        }
        .section-title {
          font-size: clamp(24px, 4vw, 34px);
          line-height: 1.2;
          letter-spacing: 0;
          color: var(--form-accent-text, #fb923c);
          font-weight: 900;
          margin: 30px 0 20px;
          text-wrap: balance;
        }
        .declaration-major-title {
          font-size: inherit;
        }
        .child-safety-notice {
          margin: -2px 0 18px;
          color: #f87171;
          font-size: clamp(20px, 3.5vw, 26px);
          font-weight: 800;
          line-height: 1.35;
        }
        .form-group { margin-bottom: 14px; }
        /* Two halves of one name read as one line. They wrap on a narrow
           phone rather than squeezing both into half a screen. */
        .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
        .form-row .form-group { flex: 1 1 140px; margin-bottom: 14px; }
        .form-group label { display: block; margin-bottom: 6px; font-size: 14px; color: #cbd5e1; }
        .req-star { color: #f87171; font-weight: 800; }
        .required-legend { margin: -10px 0 16px; font-size: 12px; color: #94a3b8; }
        .field-hint { display: block; margin-top: 6px; font-size: 12px; color: #94a3b8; line-height: 1.5; }
        .form-group input, .form-group select, .form-group textarea {
          width: 100%; padding: 12px 14px; border-radius: 11px;
          border: 1px solid rgba(255,255,255,.15); background: #0b1220;
          color: #fff; font: inherit;
        }
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
          outline: none;
          border-color: var(--form-accent-solid, #f97316);
          box-shadow: 0 0 0 2px var(--form-accent-soft, rgba(249,115,22,.1));
        }
        .onboard-page input[type="checkbox"], .onboard-page input[type="radio"] {
          accent-color: var(--form-accent-solid, #38bdf8);
        }
        /* The page sets color-scheme:dark, so the native list opens dark —
           near-black option text on it is invisible. Same pair as the
           equipment page. */
        .form-group select option { background: #0b1220; color: #fff; }
        .onboard-back { margin: 14px 24px 0; }
        .canvas-container {
          background: #111827; border: 1px solid rgba(255,255,255,.2);
          border-radius: 12px; overflow: hidden; margin-bottom: 10px;
        }
        .canvas-toolbar {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 12px; background: rgba(255,255,255,.05);
          border-bottom: 1px solid rgba(255,255,255,.05);
        }
        .clear-btn {
          background: none; border: 1px solid rgba(255,255,255,.2);
          color: #cbd5e1; border-radius: 6px; padding: 2px 8px;
          font-size: 11px; cursor: pointer;
        }
        /* מחיקת משתתף היא פעולה הרסנית — היא נראית ככזאת, ולא ככפתור עזר אפור. */
        .clear-btn.is-danger {
          color: #fca5a5; border-color: rgba(248,113,113,.55);
          background: rgba(248,113,113,.12); font-size: 12px;
          font-weight: 700; padding: 5px 11px; border-radius: 8px;
          display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
        }
        .clear-btn.is-danger:hover { background: rgba(248,113,113,.2); color: #fecaca; }
        .event-signature { border: 0; border-radius: 0; height: 150px; cursor: crosshair; }
        .onboard-page .event-primary {
          width: 100%;
          margin-top: 6px;
          background: linear-gradient(135deg,var(--form-accent-solid),var(--form-accent-deep));
        }
        @media (max-width: 560px) {
          .onboard-page { padding: 10px 8px 28px; }
          .onboard-page .event-card { border-radius: 17px; }
          .logo-circle { width: 94px; height: 94px; }
        }
      `}</style>
    </>
  );
}
