import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCircle, Download, Lock, Pencil, PenTool, Plus, ShieldCheck, Trash2,
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
  hasPositiveScreening,
  isScreeningQuestion,
  needsMedicalClearance,
  questionLabel,
  questionsForSigner,
  unansweredQuestions,
} from '../utils/healthQuestions.js';
import { clearanceBudgetError } from '../utils/medicalClearanceFile.js';
import { declarationSectionTitles, splitWaiverText, withSignerName } from '../utils/declarationSections.js';
import MedicalClearanceField from './MedicalClearanceField.jsx';
import GenderPicker, { GenderMark } from './GenderPicker.jsx';
import {
  adultParticipantFromContext,
  participationGenderValue,
} from '../utils/participationForm.js';

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

function ParentProfileSummary({ parent, onEdit }) {
  const relationLabels = {
    father: 'אב',
    mother: 'אם',
    guardian: 'אפוטרופוס',
    other: 'אחר',
  };
  const fullName = joinParentName(parent?.name, parent?.lastName) || '—';
  const rows = [
    ['תעודת זהות', parent?.idNumber || '—', true],
    ['טלפון', parent?.phone || '—', true],
    ['אימייל', parent?.email || '—', true],
    ['מקום מגורים', parent?.city || '—', false],
    ['קשר למשפחה', relationLabels[parent?.relation] || 'לא צוין', false],
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
        {rows.map(([label, value, leftToRight]) => (
          <div key={label} style={{
            minWidth: 0, paddingTop: 11, borderTop: '1px solid rgba(255,255,255,.1)',
          }}>
            <dt style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginBottom: 5 }}>{label}</dt>
            <dd
              dir={leftToRight ? 'ltr' : undefined}
              style={{
                margin: 0, fontSize: 'clamp(15px, 2.7vw, 19px)', color: '#fff', fontWeight: 800,
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

function ExistingDeclarationSummary({ participant, questions, templateSlug }) {
  const summary = participant?.onFileDeclarationSummary || {};
  const health = summary.health || null;
  const waiver = summary.waiver || null;
  const storedAnswers = health?.answers || {};
  const answeredQuestions = (questions || []).filter((question) => (
    Object.prototype.hasOwnProperty.call(storedAnswers, question.id)
  ));
  const positiveQuestions = answeredQuestions.filter((question) => storedAnswers[question.id] === true);
  const activityLabel = templateSlug === 'trip'
    ? 'אישור טיולים'
    : templateSlug === 'event'
      ? 'אישור פעילות באירוע'
      : 'אישור פעילות בקיר';
  const signedAt = health?.signedAt || participant?.onFileHealthSignedAt || '';
  const waiverSignedAt = waiver?.signedAt || participant?.onFileWaiverSignedAt || '';

  return (
    <div style={{
      margin: '10px 0', padding: '10px 12px', borderRadius: 9,
      background: 'rgba(2,6,23,.28)', border: '1px solid rgba(255,255,255,.1)',
      color: 'rgba(255,255,255,.66)', fontSize: 11.5, lineHeight: 1.6,
    }}>
      <div style={{ color: 'rgba(255,255,255,.82)', fontWeight: 800, marginBottom: 3 }}>
        מה יישאר בתוקף אם לא מחדשים
      </div>
      <div>
        הצהרת בריאות
        {signedAt ? `: נחתמה ב-${formatSignedDay(signedAt)}` : ''}
        {health?.expiresAt ? ` · בתוקף עד ${formatSignedDay(health.expiresAt)}` : ''}
      </div>
      <div>
        {answeredQuestions.length
          ? positiveQuestions.length
            ? `תשובות שסומנו „כן”: ${positiveQuestions.map((question) => questionLabel(question)).join(' · ')}`
            : 'תשובות הבריאות: לא סומנו מצבים רפואיים.'
          : 'תשובות הבריאות: לא נשמר תקציר זמין ברשומה הישנה.'}
      </div>
      {health?.notes && (
        <div style={{ whiteSpace: 'pre-wrap' }}>פירוט שנשמר: {health.notes}</div>
      )}
      <div>
        {activityLabel}
        {waiverSignedAt ? `: נחתם ב-${formatSignedDay(waiverSignedAt)}` : ''}
        {waiver?.expiresAt ? ` · בתוקף עד ${formatSignedDay(waiver.expiresAt)}` : ''}
      </div>
    </div>
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
          : <>שלחנו קוד בן 6 ספרות בוואטסאפ למספר <strong>{phone}</strong>. הזינו אותו כדי להמשיך — כך ההצהרה נרשמת על שם מי שבאמת מחזיק בטלפון.</>}
        {otp.devCode ? ` (סביבת פיתוח: ${otp.devCode})` : ''}
      </div>

      {!otp.sendFailed && (
        <input
          value={otp.code}
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
    idNumber: '',
    birthDate: '',
    gender: '',
    childPhone: '',
    registrationNotes: '',
    answers,
    // Free-text detail per screening question answered "yes", keyed by q.id.
    answerNotes: {},
    waiverAccepted: false,
    signature: '',
  };
};



export default function PublicOnboardingForm() {
  const { profile, legalName } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url && profile.logo_url !== '/logo.png'
    ? profile.logo_url
    : '/brand/logo-kirboaz.png';
  const fallbackWaiver = useMemo(() => buildFallbackWaiver(legalName), [legalName]);
  const fallbackQuestions = useMemo(() => buildFallbackQuestions(legalName), [legalName]);
  const [searchParams] = useSearchParams();
  // A link to one particular declaration (/health/<slug>). Without one the
  // default template arrives with the onboarding context below.
  const { slug: routeSlug } = useParams();
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [childHealthIndex, setChildHealthIndex] = useState(0);
  const [healthSubStep, setHealthSubStep] = useState(1);
  const [listDefs, setListDefs] = useState([]);
  const [requiredListKey, setRequiredListKey] = useState('classes');
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
  });
  const [children, setChildren] = useState([emptyChild()]);
  const [selfStudent, setSelfStudent] = useState(null);
  const [isAdultSelf, setIsAdultSelf] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [savedDeclarations, setSavedDeclarations] = useState([]);
  const [error, setError] = useState('');
  const [uploadingPdfs, setUploadingPdfs] = useState(false);
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const pageTopRef = useRef(null);

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
  const questionsForParticipant = (participant) => questionsForSigner(allQuestions, {
    isAdultSelf: participant?.type === 'adult',
  });
  // The signer's own name goes into the summary they read, and into a template
  // written with {{שם החותם}} — the same person either way.
  const signerName = joinParentName(parent.name, parent.lastName);
  const waiverText = withSignerName(template?.waiverText || fallbackWaiver, signerName);
  const declarationContextLabel = template?.slug === 'trip'
    ? 'הצהרת בריאות לטיול'
    : (template?.slug === 'event' ? 'הצהרת בריאות לפעילות בקיר' : 'הצהרת בריאות');
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

  // The acceptance box opens only after the binding text was scrolled through.
  // A tick on a contract nobody scrolled past is exactly the signature that
  // does not hold up later.
  const [waiverRead, setWaiverRead] = useState(false);
  const waiverBoxRef = useRef(null);
  const waiverScrollGate = useRef({ top: 0, time: 0 });

  /**
   * Downward scrolling inside the waiver box is capped to reading pace —
   * a flick that would jump to the bottom is walked there instead. Scrolling
   * back up is free. The cap only slows the box, it never blocks it, so the
   * bottom is always reachable.
   */
  const handleWaiverScroll = (e) => {
    const el = e.currentTarget;
    const gate = waiverScrollGate.current;
    const now = performance.now();
    const elapsed = gate.time ? now - gate.time : 0;
    // ~0.6px per ms ≈ a screenful of legal text in a couple of seconds.
    const allowed = gate.top + Math.max(20, elapsed * 0.6);
    if (el.scrollTop > allowed) el.scrollTop = allowed;
    gate.top = el.scrollTop;
    gate.time = now;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setWaiverRead(true);
  };

  // Each participant reads for themselves: entering the waiver screen resets
  // the gate. A short text that fits without scrolling counts as read once it
  // is on screen.
  useEffect(() => {
    if (healthSubStep !== 2) return;
    setWaiverRead(false);
    waiverScrollGate.current = { top: 0, time: 0 };
    const id = requestAnimationFrame(() => {
      const el = waiverBoxRef.current;
      if (el && el.scrollHeight <= el.clientHeight + 8) setWaiverRead(true);
    });
    return () => cancelAnimationFrame(id);
  }, [healthSubStep, childHealthIndex]);

  // participant key -> { match, student_id, guardian_first_name, health_valid, linked }
  const [knownChildren, setKnownChildren] = useState({});
  const [prefilledParentId, setPrefilledParentId] = useState('');
  const [editingParentProfile, setEditingParentProfile] = useState(false);
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
  const identityReady = !!otp.token && ['found', 'new'].includes(identityStatus);
  const parentProfileLocked = identityReady && !!prefilledParentId && !editingParentProfile;
  // Which participant has already been told their ID looks wrong, so the
  // warning is a warning and not a wall.
  const [idWarnedFor, setIdWarnedFor] = useState('');
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
    return joinParentName(typed, parent.lastName);
  };

  /** Children have no stable id until they are saved — identify them by what was typed. */
  const childKey = (child) => `${String(child?.name || '').trim()}|${child?.birthDate || ''}`;

  /**
   * True when this participant already has a declaration in force and is not
   * re-signing it. Covers both a child confirmed as belonging to another file
   * and someone already on this file — including the parent themselves, who
   * would otherwise be handed their own whole form again on the next visit.
   */
  const reusesDeclaration = (child) => {
    if (child?.onFileHealthValid && !child?.resignHealth) return true;
    const known = knownChildren[childKey(child)];
    return !!(known?.linked && known.health_valid);
  };

  const reusesHealthDocument = (child) => {
    if (child?.onFileHealthDocumentValid && !child?.resignHealth) return true;
    const known = knownChildren[childKey(child)];
    return !!(known?.linked && (known.health_document_valid ?? known.health_valid));
  };

  const reusesWaiver = (child) => {
    if (child?.onFileWaiverValid) return true;
    const known = knownChildren[childKey(child)];
    return !!(known?.linked && (known.waiver_valid ?? known.health_valid));
  };

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
   * Left out of this submission: either the parent declined the renewal for
   * now — a participant who moved abroad or stopped climbing is a real answer
   * — or they are an adult who has to sign for themselves.
   */
  const skipsThisRound = (child) => !!child?.skipThisTime
    || (!!child?.id && needsOwnSignature(child));

  /**
   * On the file, nothing in force, and the parent has not answered the offer
   * yet. Renewing is offered, never demanded, so an untouched card is simply
   * not part of the submission.
   */
  const awaitingRenewChoice = (child) => !!child?.id
    && !child?.onFileHealthValid
    && !child?.renewOptIn
    && !skipsThisRound(child);

  /** Whether this card's own fields and declaration are being asked for now. */
  const fillsDeclaration = (child) => !skipsThisRound(child)
    && !awaitingRenewChoice(child)
    && !reusesDeclaration(child);

  const totalStepsLabel = 2 + Math.max(
    children.filter((c) => c.name.trim() && fillsDeclaration(c)).length,
    1
  );

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
            { key: 'general', label: 'כללי', description: 'עדכונים שוטפים' },
            { key: 'classes', label: 'חוגים', description: 'שינויי שעות וכדומה' },
            { key: 'trips', label: 'טיולים', description: 'טיולי סנפלינג/חוץ' },
            { key: 'events', label: 'אירועים', description: 'אירועים ותחרויות מועדון' },
          ];
        }
        setListDefs(defs);

        const reqKey = data.requiredListKey || 'classes';
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
          setParent({
            name: knownName.first,
            lastName: knownName.lastName,
            idNumber: data.parent.idNumber || '',
            relation: data.parent.relation || '',
            phone: data.parent.phone || searchParams.get('phone') || '',
            email: data.parent.email || '',
            city: data.parent.city || '',
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
              onFileHealthValid: !!(s.healthValid ?? s.health_valid),
              onFileHealthDocumentValid: !!(s.healthDocumentValid ?? s.health_document_valid),
              onFileWaiverValid: !!(s.waiverValid ?? s.waiver_valid),
              onFileHealthSignedAt: s.healthSignedAt || s.health_signed_at || '',
              onFileWaiverSignedAt: s.waiverSignedAt || s.waiver_signed_at || '',
              onFileDeclarationSummary: s.declarationSummary || null,
              resignHealth: false,
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
   * A link that names a declaration (/health/<slug>, or ?template=) overrides
   * the default template loaded above. A slug we do not know simply leaves the
   * default in place — a wrong link must never leave the family with no form.
   */
  useEffect(() => {
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

  const reportHealthChange = async (child, index) => {
    if (!child?.id || !otp.token) {
      updateChild(index, { resignHealth: true, resignAsk: false });
      return;
    }
    setError('');
    try {
      const response = await fetch('/api/public/health-holds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: parent.phone,
          studentId: child.id,
          phoneVerification: { token: otp.token },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'דיווח השינוי הרפואי נכשל');
      updateChild(index, { resignHealth: true, resignAsk: false, healthBlocked: true });
    } catch (reportError) {
      setError(reportError.message);
    }
  };

  const addChild = () => {
    setChildren((prev) => [...prev, emptyChild(allQuestions)]);
  };

  const removeChild = (index) => {
    setChildren((prev) => prev.filter((_, i) => i !== index));
  };

  const setAdultSelfMode = (enabled) => {
    setIsAdultSelf(enabled);
    if (enabled) {
      const currentAdult = children.find((child) => child.type === 'adult');
      if (!currentAdult) setChildren((current) => [{
        ...emptyChild(allQuestions),
        ...adultParticipantFromContext(selfStudent, {
          fullName: parentFullName(),
          idNumber: parent.idNumber,
        }),
        onFileHealthValid: !!selfStudent?.healthValid,
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
        // Keep the exact number that earned the active OTP token.
        phone: current.phone,
      }));
      setKnownFile({
        name: data.parent.name || '',
        children: (data.students || []).map((s) => s.name).filter(Boolean),
      });

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
              idNumber: s.idNumber || '',
              birthDate: s.birthDate || '',
              gender: participationGenderValue(s.gender),
              // The same two fields the first load sets. Without them this
              // path — the one that runs when a returning parent types their
              // phone — handed them their own declaration to sign again.
              onFileHealthValid: !!(s.healthValid ?? s.health_valid),
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
  const namedChildren = () => children.filter((c) => c.name.trim() && !skipsThisRound(c) && !awaitingRenewChoice(c));

  const healthChildren = () => namedChildren().filter((child) => fillsDeclaration(child));

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

    if (!parent.name.trim() || !parent.lastName.trim()) {
      setError('יש להשלים שם פרטי ושם משפחה');
      return;
    }

    // Existing customers get these values from their file immediately after
    // OTP. New customers fill only the values that are genuinely missing.
    if (!parent.email.trim()) {
      setError('יש למלא אימייל');
      return;
    }
    if (!parent.city.trim()) {
      setError('יש למלא מקום מגורים');
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
    if (isAdultSelf) {
      // Same person on both steps — carry the ID already typed, like the name.
      setChildren((current) => {
        const adult = current.find((child) => child.type === 'adult');
        const nextAdult = {
          ...emptyChild(allQuestions),
          ...adultParticipantFromContext(adult || selfStudent, {
            fullName: parentFullName(),
            idNumber: parent.idNumber.trim() || adult?.idNumber || '',
          }),
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
    for (const kid of kids) {
      // A participant typed in by hand who turns out to be an adult: the form
      // says so here rather than dropping the card without a word.
      if (needsOwnSignature(kid)) {
        setError(`${kid.name} מעל גיל 18 — הורה לא יכול לחתום עבורו/ה. יש למלא טופס נפרד בשמו/ה, או לתקן את תאריך הלידה`);
        return;
      }
      // A participant whose card is collapsed behind "declaration in force" was
      // never shown these fields, so they cannot be the thing blocking the form.
      if (reusesDeclaration(kid)) continue;
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
      if (!String(kid.idNumber || '').trim()) {
        setError(`חסרה תעודת זהות עבור ${kid.name}`);
        return;
      }
      // A failed check digit is almost always a typo, but a passport or a
      // foreign document is not wrong — so it warns once and lets it through
      // on the second attempt rather than locking the family out.
      if (!looksLikeIsraeliId(kid.idNumber) && idWarnedFor !== childKey(kid)) {
        setIdWarnedFor(childKey(kid));
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
    // Renewing is optional, but leaving without it must not happen by accident:
    // a parent who came for exactly that and walked past the offer would have
    // finished with nothing renewed. So the first press names who is being left
    // out and the second one goes ahead — the same soft stop the ID check uses.
    const unofferedAnswer = children.filter((c) => c.name.trim() && awaitingRenewChoice(c));
    const unofferedKey = unofferedAnswer.map((c) => c.name.trim()).join('|');
    if (unofferedKey && skipWarnedFor !== unofferedKey) {
      setSkipWarnedFor(unofferedKey);
      setError(`לא בחרתם אם לחדש את הצהרת הבריאות של ${unofferedAnswer.map((c) => c.name.trim()).join(', ')} — לחצו „המשך” שוב כדי להמשיך בלי לחדש.`);
      return;
    }

    // Everyone here already has a declaration in force on their existing file.
    if (!healthChildren().length) {
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
    setHealthSubStep(1);
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

    if (healthSubStep === 1) {
      const answers = children[fullIndex]?.answers || {};
      const currentQuestions = questionsForParticipant(current);
      const missing = unansweredQuestions(currentQuestions, answers);
      if (missing.length) {
        setError(
          missing.some(isScreeningQuestion)
            ? 'יש לענות כן או לא על כל שאלות הבריאות'
            : 'יש לסמן את כל סעיפי ההצהרה והבטיחות'
        );
        return;
      }
      // A condition nobody described is a condition the instructor cannot act
      // on — and each "yes" needs its own words, in the box under the question.
      const notes = children[fullIndex]?.answerNotes || {};
      const undetailed = currentQuestions.find((q) => isScreeningQuestion(q)
        && answers[q.id] === true
        && !String(notes[q.id] || '').trim());
      if (undetailed) {
        setError(`סימנתם „כן” על „${questionLabel(undetailed)}” — יש לפרט בשדה שמתחת לשאלה`);
        return;
      }
      // Where a doctor has already limited the activity, the wall is not the
      // one to decide it is safe. The approval is required before the
      // signature, not chased afterwards.
      if (needsMedicalClearance(currentQuestions, answers) && !children[fullIndex]?.medicalClearance) {
        setError('לפי התשובות נדרש אישור רופא להשתתפות בפעילות ספורטיבית — יש לצרף אותו כדי להמשיך');
        return;
      }
      // Said here rather than after the signature: the fix is to attach a
      // different file, and the last screen is the worst place to learn that.
      const overBudget = clearanceBudgetError(children);
      if (overBudget) {
        setError(overBudget);
        return;
      }
      setHealthSubStep(2);
      initCanvas();
      return;
    }

    if (!current.waiverAccepted && !(children[fullIndex]?.waiverAccepted)) {
      // auto-set from checkbox on this step
    }
    if (!(children[fullIndex]?.waiverAccepted)) {
      setError('יש לאשר את כתב הוויתור / הסרת האחריות');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      setError('יש לחתום על הטופס');
      return;
    }
    const signature = canvas.toDataURL();
    const capturedAt = new Date().toISOString();
    const withSig = children.map((c, i) =>
      i === fullIndex ? {
        ...c,
        signature,
        waiverAccepted: true,
        signatureEvidenceTimeline: {
          ...(c.signatureEvidenceTimeline || {}),
          termsPresentedAt: c.signatureEvidenceTimeline?.termsPresentedAt || capturedAt,
          termsReadAt: capturedAt,
          termsAcceptedAt: c.signatureEvidenceTimeline?.termsAcceptedAt || capturedAt,
          signatureCapturedAt: capturedAt,
        },
      } : c
    );
    setChildren(withSig);

    if (childHealthIndex < kids.length - 1) {
      setChildHealthIndex((i) => i + 1);
      setHealthSubStep(1);
      return;
    }

    await submitAll(withSig);
  };

  const submitAll = async (childrenSnapshot) => {
    setIsSubmitting(true);
    setError('');
    try {
      const kids = (childrenSnapshot || children)
        // Same rule as the screen: a declined offer, or an adult who signs for
        // themselves, is not part of what this parent submits.
        .filter((c) => c.name.trim() && !skipsThisRound(c) && !awaitingRenewChoice(c))
        .map((c) => {
          const participantQuestions = questionsForParticipant(c);
          const asked = new Set(participantQuestions.map((q) => q.id));
          const reuseHealth = reusesHealthDocument(c);
          const reuseActivityWaiver = reusesWaiver(c);
          const answers = Object.fromEntries(
            Object.entries(c.answers || {}).filter(([id]) => asked.has(id))
          );
          // Everything downstream — the declaration record, the PDF, the
          // student's file — reads one healthNotes string, so the per-question
          // details are composed into lines that keep saying which question
          // each one answered.
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
            idNumber: (c.idNumber || '').trim(),
            type: c.type === 'adult' ? 'adult' : 'child',
            birthDate: c.birthDate,
            gender: c.gender,
            childPhone: c.childPhone,
            registrationNotes: c.registrationNotes,
            answers,
            healthNotes,
            // Travels with the declaration so the two are saved or refused
            // together — never a signature on file with the approval missing.
            medicalClearance: c.medicalClearance || null,
            signature: c.signature,
            waiverAccepted: !reuseActivityWaiver,
            signatureEvidenceTimeline: c.signatureEvidenceTimeline || null,
            ...linkFieldsFor(knownChildren[childKey(c)]),
            // Already on this file with a declaration in force: say so, or the
            // server asks for a signature the form deliberately never showed.
            reuse_health_document: reuseHealth,
            reuse_waiver: reuseActivityWaiver,
          };
        });

      const res = await fetch('/api/public/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: {
            name: parentFullName(),
            lastName: parent.lastName.trim(),
            idNumber: parent.idNumber.trim(),
            relation: parent.relation,
            phone: parent.phone.trim(),
            email: parent.email.trim(),
            city: parent.city.trim(),
            source: 'form',
            family_parent_id: familyParentId || null,
          },
          interest,
          children: kids,
          subscriptions: { ...subscriptions, [requiredListKey]: true },
          templateSlug: template?.slug || 'wall',
          templateId: template?.id || null,
          completionRegistrationId: searchParams.get('registrationId') || null,
          phoneVerification: otp.token ? { token: otp.token } : null,
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

  if (loading) {
    return (
      <div className="event-page onboard-page" ref={pageTopRef}>
        <div className="event-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>טוען טופס השלמת פרטים...</p>
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
          <h1 style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>הפרטים התקבלו!</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 16 }}>
            תודה {parent.name}. הפרטים והצהרת הבריאות נשמרו במערכת.
          </p>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, marginTop: 12 }}>
            השיבוץ לחוג יבוצע על ידי הצוות בהמשך.
          </p>
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
  // Steps 1 and 2 are fixed; step 3 repeats once per child who still has to sign.
  const displayStep = step === 3 ? 2 + childHealthIndex + 1 : step;
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
              if (step === 3 && healthSubStep === 2) setHealthSubStep(1);
              else if (step === 3 && childHealthIndex > 0) {
                setChildHealthIndex((i) => i - 1);
                setHealthSubStep(2);
                initCanvas();
              } else if (step === 3) setStep(2);
              else setStep(1);
            }}
          >
            <ArrowLeft size={16} style={{ transform: 'rotate(180deg)' }} /> חזרה
          </button>
        )}

        <div className="form-header">
          <div className="logo-circle">
            <img src={brandLogo} alt={brandName} />
          </div>
          {/* „מילוי פרטים והרשמה” לא אמר למה חותמים. הכותרת נושאת את שם
              המסמך עצמו, בכל שלושת השלבים. */}
          <h2 className={step === 3 ? 'signing-document-title' : ''}>
            הצהרת בריאות והסרת אחריות
            {step === 3 && currentChild?.name ? ` — ${currentChild.name}` : ''}
          </h2>
          {step === 2 && <p>בני המשפחה המשתתפים</p>}
          {/* Same progress strip as the event and shop pages. */}
          <div className="event-progress-label">
            שלב {displayStep} מתוך {totalStepsLabel}
          </div>
          <div
            className="event-progress"
            style={{
              background: `linear-gradient(90deg,var(--form-accent-solid,#38bdf8) 0 ${progressPercent}%,rgba(255,255,255,.1) ${progressPercent}%)`,
            }}
          />
        </div>

        {step === 1 && (
          <div className="fade-in">
            <div className="section-title">זיהוי ממלא/ת הטופס</div>
            {parentProfileLocked ? (
              <ParentProfileSummary
                parent={parent}
                onEdit={() => setEditingParentProfile(true)}
              />
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: -6, marginBottom: 12, lineHeight: 1.45 }}>
                  {identityReady
                    ? 'אפשר לעדכן את הפרטים. שינוי תעודת הזהות או הטלפון יחייב אימות מחדש.'
                    : 'נזהה את התיק רק לאחר אימות הטלפון. לפני האימות לא יוצגו פרטי משפחה.'}
                </p>
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
            {identityReady && (
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
            {/* First question on the form, because the answer decides what the
                rest of it is asking for: a parent filling in for children, or
                an adult filling in for themselves. Asked later, the parent
                section reads as if it were about someone else. */}
            <label
              className="event-check"
              style={{
                cursor: 'pointer',
                marginBottom: 18,
                borderColor: isAdultSelf ? 'var(--form-accent-border, rgba(249,115,22,0.45))' : 'rgba(255,255,255,0.08)',
                background: isAdultSelf ? 'var(--form-accent-soft, rgba(249,115,22,0.08))' : 'rgba(255,255,255,0.03)',
              }}
            >
              <input
                type="checkbox"
                checked={isAdultSelf}
                onChange={(e) => setAdultSelfMode(e.target.checked)}
              />
              <span>גם אני משתתף/ת וממלא/ת עבור עצמי</span>
            </label>
            {!parentProfileLocked && (
              <>
            <div className="section-title">
              פרטי ממלא/ת הטופס
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
                />
              </div>
              <div className="form-group">
                <label>שם משפחה *</label>
                <input
                  value={parent.lastName}
                  onChange={(e) => setParent((p) => ({ ...p, lastName: e.target.value }))}
                  placeholder="ישראלי"
                />
              </div>
            </div>
            <div className="form-group">
              <label>Email *</label>
              <input
                type="email"
                value={parent.email}
                onChange={(e) => setParent((p) => ({ ...p, email: e.target.value }))}
                placeholder="name@email.com"
              />
            </div>
            <div className="form-group">
              <label>מקום מגורים *</label>
              <input
                value={parent.city}
                onChange={(e) => setParent((p) => ({ ...p, city: e.target.value }))}
                placeholder="עיר / יישוב"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                {/* Buttons for the same reason as בן / בת below: a native list
                    paints its own highlight and ignores the page. */}
                <label>קשר למשתתפים</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[['אב', 'father'], ['אם', 'mother'], ['אפוטרופוס', 'guardian'], ['אחר', 'other']]
                    .map(([text, value]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setParent((p) => ({
                          ...p,
                          relation: p.relation === value ? '' : value,
                        }))}
                        style={{
                          flex: '1 1 auto', padding: '11px 8px', borderRadius: 11, font: 'inherit',
                          fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                          border: parent.relation === value
                            ? '1px solid var(--form-accent-solid, #f97316)'
                            : '1px solid rgba(255,255,255,.15)',
                          background: parent.relation === value
                            ? 'var(--form-accent-soft-strong, rgba(249,115,22,.18))'
                            : '#0b1220',
                          color: parent.relation === value ? 'var(--form-accent-text, #fdba74)' : '#e2e8f0',
                        }}
                      >
                        {text}
                      </button>
                    ))}
                </div>
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
                    : 'כבר רשום/ה ומופיע/ה'} בשלב הבא, ואפשר לבחור עבור מי להשלים מסמכים.`
                  : ' אפשר לבחור בשלב הבא עבור מי להשלים מסמכים.'}
              </div>
            )}

            <div className="section-title" style={{ marginTop: 22 }}>רשימות דיוור של ההורה</div>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: -6, marginBottom: 12, lineHeight: 1.45 }}>
              ההרשמה חלה על כל הילדים במשפחה, לא על ילד בודד.
            </p>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: '0 0 12px' }}>
              רשימת החוגים חובה. אפשר לסמן גם טיולים, אירועים ועוד.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {listDefs.map((list) => {
                const isRequired = list.key === requiredListKey;
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
                          [requiredListKey]: true,
                        }));
                      }}
                    />
                    <span>
                      <strong>{list.label || list.key}</strong>
                      {list.description ? ` — ${list.description}` : ''}
                      {isRequired ? ' (חובה)' : ''}
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

            {error && <ErrorBox message={error} />}

            {otp.stage === 'code' || waitingForFamily ? null : (
              <button
                type="button"
                className="event-primary"
                style={{ marginTop: 8 }}
                onClick={goNextFromParent}
                disabled={otp.sending}
              >
                {otp.sending
                  ? 'שולח קוד אימות בוואטסאפ…'
                  : <>המשך לפרטי משתתפים <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} /></>}
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="section-title">
              בני המשפחה המשתתפים
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '0 0 14px' }}>
              השיבוץ לקבוצה יבוצע על ידי הצוות בהמשך.
            </p>
            {children.map((child, index) => (
              <div
                key={child.id || index}
                style={{
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 14,
                  background: 'rgba(0,0,0,0.15)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  {/* The name is the card's title. An ordinal told the parent
                      nothing about whose card they were about to change; the
                      name is the only thing that does. Until it is typed the
                      ordinal is all there is, so it stays as the fallback. */}
                  <div style={{ minWidth: 0 }}>
                    {(child.name || '').trim() ? (
                      <div style={{
                        fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.25,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {child.name.trim()}
                      </div>
                    ) : (
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.45)', lineHeight: 1.25 }}>
                        {child.type === 'adult' ? 'משתתף/ת מבוגר/ת' : `ילד/ה ${index + 1}`}
                      </div>
                    )}
                    {children.length > 1 && (
                      <div style={{ fontSize: 11, color: 'var(--form-accent-text, #F97316)', fontWeight: 700, marginTop: 2 }}>
                        משתתף/ת {index + 1} מתוך {children.length}
                      </div>
                    )}
                  </div>
                  {child.type !== 'adult' && children.length > 1 && !child.onFileHealthValid && (
                    <button type="button" className="clear-btn" onClick={() => removeChild(index)}>
                      <Trash2 size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> הסר
                    </button>
                  )}
                </div>

                {/* בגר — הורה חותם רק על ילדיו הקטינים. הכרטיס יוצא מהטופס
                    ואומר למה, במקום להעלים משתתף בלי הסבר. */}
                {child.id && needsOwnSignature(child) && (
                  <div style={{
                    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 12, padding: 12, marginBottom: 0,
                  }}>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 700, marginBottom: 4 }}>
                      מעל גיל 18 — חותם/ת בעצמו/ה
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.55 }}>
                      חתימת הורה תקפה רק עד גיל 18. {child.name?.trim() || 'משתתף/ת זה'}
                      {' '}צריך/ה למלא את הטופס בעצמו/ה — העבירו לו/ה את הקישור לטופס,
                      ושם יש לסמן „אני מעל גיל 18 ואני ממלא/ת עבור עצמי”.
                      {' '}הכרטיס הזה לא ייכלל בשליחה.
                    </div>
                  </div>
                )}

                {/* על הפרק, לא על החובה: מי שרשום בתיק ואין לו הצהרה בתוקף
                    מקבל הצעה לחדש. אולי הוא כבר לא מטפס, ולכן „לא הפעם” הוא
                    תשובה לגיטימית — אבל השאלה חייבת להישאל. */}
                {child.id && !child.onFileHealthValid && !needsOwnSignature(child) && !child.renewOptIn && (
                  <div style={{
                    background: child.skipThisTime ? 'rgba(255,255,255,.04)' : 'var(--form-accent-soft, rgba(249,115,22,.1))',
                    border: `1px solid ${child.skipThisTime ? 'rgba(255,255,255,0.12)' : 'var(--form-accent-border, rgba(249,115,22,.4))'}`,
                    borderRadius: 12, padding: 12, marginBottom: 0,
                  }}>
                    {child.skipThisTime ? (
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 10, flexWrap: 'wrap',
                      }}>
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
                          לא ימולא הפעם — לא ייכלל בשליחה
                        </div>
                        <button
                          type="button"
                          onClick={() => updateChild(index, { skipThisTime: false })}
                          style={{
                            background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
                            borderRadius: 10, color: 'rgba(255,255,255,0.7)',
                            fontFamily: 'inherit', fontSize: 12, padding: '7px 12px', cursor: 'pointer',
                          }}
                        >
                          בעצם כן, נמלא
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 14, color: 'var(--form-accent-text, #fdba74)', fontWeight: 700, marginBottom: 4,
                        }}>
                          <AlertTriangle size={15} />
                          {child.onFileHealthSignedAt
                            ? `${declarationContextLabel} אינה בתוקף`
                            : `לא נמצאה ${declarationContextLabel}`}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.55, marginBottom: 10 }}>
                          {child.onFileHealthSignedAt
                            ? `ההצהרה מ-${formatSignedDay(child.onFileHealthSignedAt)} כבר אינה בתוקף. `
                            : `ל${child.name?.trim() || 'משתתף/ת זה'} עדיין אין ${declarationContextLabel} חתומה. `}
                          הפרטים כבר קיימים במערכת — אפשר למלא עכשיו.
                          {' '}אם {child.name?.trim() || 'המשתתף/ת'} כבר לא מטפס/ת, אפשר לדלג — בלי הצהרה בתוקף לא נכנסים לפעילות.
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => updateChild(index, { renewOptIn: true, skipThisTime: false })}
                            style={{
                              background: 'var(--form-accent-solid, #F97316)', border: 'none', borderRadius: 10, color: '#fff',
                              fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                              padding: '9px 14px', cursor: 'pointer',
                            }}
                          >
                            {child.onFileHealthSignedAt ? 'כן, לחדש עכשיו' : 'כן, למלא עכשיו'}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateChild(index, { skipThisTime: true })}
                            style={{
                              background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
                              borderRadius: 10, color: 'rgba(255,255,255,0.65)',
                              fontFamily: 'inherit', fontSize: 13, padding: '9px 14px', cursor: 'pointer',
                            }}
                          >
                            לא הפעם
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* אחרי „כן, לחדש” — מה עוד נדרש, ודרך חזרה. */}
                {child.id && !child.onFileHealthValid && !needsOwnSignature(child) && child.renewOptIn && (
                  <div style={{
                    background: 'var(--form-accent-soft, rgba(249,115,22,.1))',
                    border: '1px solid var(--form-accent-border, rgba(249,115,22,.35))',
                    borderRadius: 12, padding: 12, marginBottom: 14,
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, flexWrap: 'wrap',
                    }}>
                      <div style={{ fontSize: 14, color: 'var(--form-accent-text, #fdba74)', fontWeight: 700 }}>
                        חידוש ההצהרה עבור {child.name?.trim() || 'משתתף/ת זה'}
                      </div>
                      <button
                        type="button"
                        onClick={() => updateChild(index, { renewOptIn: false, editProfile: false })}
                        style={{
                          background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
                          borderRadius: 10, color: 'rgba(255,255,255,0.65)',
                          fontFamily: 'inherit', fontSize: 12, padding: '7px 12px', cursor: 'pointer',
                        }}
                      >
                        ביטול
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.55, marginTop: 4 }}>
                      {hasLockedParticipantProfile(child)
                        ? `הצהרת הבריאות של ${child.name.trim()} תופיע במסך הבא.`
                        : hasCompleteParticipantProfile(child)
                          ? 'הפרטים פתוחים לעריכה. לאחר השמירה הם יוצגו בראש הצהרת הבריאות.'
                          : 'חסרים בתיק פרטים הכרחיים. השלימו אותם פעם אחת והמשיכו להצהרת הבריאות.'}
                    </div>
                  </div>
                )}

                {/* Someone already on file with a declaration in force is shown
                    as settled, not handed their own form again. Reopening it is
                    one tick, because a health change is the whole reason to. */}
                {child.onFileHealthValid && !child.resignHealth && (
                  <div style={{
                    background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.3)',
                    borderRadius: 12, padding: 12, marginBottom: 0,
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 14, color: '#6ee7b7', fontWeight: 700, marginBottom: 4,
                    }}>
                      <ShieldCheck size={16} /> הצהרת בריאות והסרת אחריות בתוקף
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>
                      {child.onFileHealthSignedAt
                        ? `נחתם ב-${formatSignedDay(child.onFileHealthSignedAt)}. `
                        : ''}
                      אין צורך למלא שוב — הפרטים נשארים כפי שהם.
                    </div>
                    <ExistingDeclarationSummary
                      participant={child}
                      questions={allQuestions}
                      templateSlug={template?.slug || routeSlug || 'wall'}
                    />

                    {/* שני קליקים במכוון: הצהרה קיימת נמחקה בטעות בסימון אחד
                        בדרך אגב. הראשון רק פותח את השאלה, השני הוא זה שמוחק. */}
                    {!child.resignAsk ? (
                      <button
                        type="button"
                        onClick={() => updateChild(index, { resignAsk: true })}
                        style={{
                          marginTop: 12, background: 'transparent',
                          border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10,
                          color: 'rgba(255,255,255,0.6)', fontFamily: 'inherit', fontSize: 12,
                          padding: '8px 12px', cursor: 'pointer',
                        }}
                      >
                        משהו השתנה במצב הבריאותי?
                      </button>
                    ) : (
                      <div style={{
                        marginTop: 12, background: 'var(--form-accent-soft, rgba(249,115,22,.1))',
                        border: '1px solid var(--form-accent-border, rgba(249,115,22,.4))', borderRadius: 10, padding: 12,
                      }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 13, fontWeight: 700, color: 'var(--form-accent-text, #fdba74)', marginBottom: 6,
                        }}>
                          <AlertTriangle size={14} /> למלא הצהרה חדשה?
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.55, marginBottom: 10 }}>
                          {/* בשמו, ובלי לאיים במחיקה: הצהרה לא מוחלפת אלא
                              מצטרפת לתיק, והחדשה היא זו שתקפה מכאן. */}
                          תתווסף ל{child.name?.trim() || 'משתתף/ת זה'} הצהרה חדשה שתצטרכו למלא ולחתום עליה.
                          {' '}ההצהרה
                          {child.onFileHealthSignedAt ? ` מ-${formatSignedDay(child.onFileHealthSignedAt)}` : ' הקודם'}
                          {' '}נשמרת בתיק כמו שהיא, והחדשה היא שתהיה בתוקף.
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => reportHealthChange(child, index)}
                            style={{
                              background: 'var(--form-accent-solid, #F97316)', border: 'none', borderRadius: 10, color: '#fff',
                              fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                              padding: '9px 14px', cursor: 'pointer',
                            }}
                          >
                            כן, למלא הצהרה חדשה
                          </button>
                          <button
                            type="button"
                            onClick={() => updateChild(index, { resignAsk: false })}
                            style={{
                              background: 'transparent', border: '1px solid rgba(255,255,255,0.18)',
                              borderRadius: 10, color: 'rgba(255,255,255,0.65)',
                              fontFamily: 'inherit', fontSize: 13, padding: '9px 14px', cursor: 'pointer',
                            }}
                          >
                            לא, השאירו כמו שזה
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {child.onFileHealthValid && child.resignHealth && (
                  <div style={{
                    background: 'var(--form-accent-soft, rgba(249,115,22,.1))',
                    border: '1px solid var(--form-accent-border, rgba(249,115,22,.4))',
                    borderRadius: 12, padding: 12, marginBottom: 14,
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  }}>
                    <div style={{ fontSize: 13, color: 'var(--form-accent-text, #fdba74)', fontWeight: 700 }}>
                      דווח שינוי במצב הבריאותי. ההשתתפות חסומה עד להשלמת הצהרה חדשה.
                    </div>
                  </div>
                )}

                {/* A renewal is about health, not another profile intake. The
                    canonical details travel unchanged in the submission and
                    are shown read-only beside the declaration on the next
                    screen. Only an incomplete old profile opens fields. */}
                {fillsDeclaration(child) && !hasLockedParticipantProfile(child) && (
                <>
                <div className="form-group">
                  <label>{child.type === 'adult' ? 'שם מלא *' : 'שם פרטי של הילד/ה *'}</label>
                  <input
                    value={child.name}
                    onChange={(e) => updateChild(index, { name: e.target.value })}
                    placeholder={child.type === 'adult' ? 'שם מלא' : 'שם פרטי'}
                    readOnly={child.type === 'adult'}
                  />
                  {/* Shown rather than assumed: the surname is completed from
                      the parent, and anyone whose child carries a different one
                      can type it here in full. */}
                  {child.type !== 'adult' && childFullName(child) !== child.name.trim() && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
                      ייכנס למערכת כ־{childFullName(child)} — אפשר להקליד שם משפחה אחר במידת הצורך
                    </div>
                  )}
                </div>
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
                    {ageFromBirthDate(child.birthDate) !== null
                      ? `גיל: ${ageFromBirthDate(child.birthDate)}`
                      : 'לבחירת שנה — לחצו על השנה עצמה בחלון שנפתח.'}
                  </div>
                  {child.type === 'adult'
                    && ageFromBirthDate(child.birthDate) !== null
                    && ageFromBirthDate(child.birthDate) < 18 && (
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
                      מגיל 18 ומעלה חתימת הורה אינה תקפה — {child.name?.trim() || 'המשתתף/ת'}
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
                      ? [['גבר', 'male'], ['אישה', 'female']]
                      : [['בן', 'male'], ['בת', 'female']]}
                  />
                </div>
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
                </>
                )}
              </div>
            ))}
            <button
                type="button"
                onClick={addChild}
                style={{
                  width: '100%', background: 'transparent', border: '1px dashed var(--form-accent-border, rgba(249,115,22,0.5))',
                  color: 'var(--form-accent-text, #F97316)', padding: 12, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16,
                }}
              >
                <Plus size={16} /> הוספת ילד/ה למשפחה
              </button>
            {error && <ErrorBox message={error} />}
            <button type="button" className="event-primary" onClick={goNextFromChildren}>
              המשך להצהרת בריאות <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
            </button>
          </div>
        )}

        {step === 3 && currentChild && (
          <div className="fade-in">
            {healthSubStep === 1 && (
              <>
                {hasLockedParticipantProfile(currentChild) && (
                  <ParticipantProfileSummary
                    participant={currentChild}
                    onEdit={() => {
                      updateChild(currentFullIndex, { editProfile: true });
                      setError('');
                      setStep(2);
                    }}
                  />
                )}
                {(() => {
                  const answers = children[currentFullIndex]?.answers || {};
                  const participantQuestions = questionsForParticipant(currentChild);
                  const setAnswer = (id, value) => updateChild(currentFullIndex, (child) => ({
                    answers: { ...(child.answers || {}), [id]: value },
                  }));
                  const screening = participantQuestions.filter(isScreeningQuestion);
                  const confirmations = participantQuestions.filter((q) => !isScreeningQuestion(q));
                  return (
                    <>
                      {/* Screening first: what we need to know before anyone
                          climbs, and answered כן/לא rather than ticked — a blank
                          box would file "nobody asked" as "no". */}
                      {screening.length > 0 && (
                        <>
                          <div className="section-title">{sectionTitles.health} — {currentChild.name}</div>
                          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 14 }}>
                            תשובה „כן” לא מונעת השתתפות. היא רק מאפשרת לצוות לדעת ולהיערך.
                          </p>
                          {screening.map((q) => (
                            <div key={q.id} style={{
                              background: 'rgba(0,0,0,0.18)', borderRadius: 12, padding: 12,
                              marginBottom: 10,
                            }}>
                              <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 10 }}>
                                {questionLabel(q)}
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                {[['כן', true], ['לא', false]].map(([text, value]) => (
                                  <button
                                    key={text}
                                    type="button"
                                    onClick={() => setAnswer(q.id, value)}
                                    style={{
                                      flex: 1, padding: '9px 0', borderRadius: 10, font: 'inherit',
                                      fontWeight: 700, fontSize: 14, cursor: 'pointer',
                                      border: answers[q.id] === value
                                        ? '1px solid var(--form-accent-solid, #f97316)'
                                        : '1px solid rgba(255,255,255,.15)',
                                      background: answers[q.id] === value
                                        ? 'var(--form-accent-soft-strong, rgba(249,115,22,.18))'
                                        : 'rgba(255,255,255,.05)',
                                      color: answers[q.id] === value ? 'var(--form-accent-text, #fdba74)' : '#e2e8f0',
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
                              {answers[q.id] === true && (
                                <div className="form-group" style={{ marginTop: 10, marginBottom: 0 }}>
                                  <label>פרטו בבקשה *</label>
                                  <textarea
                                    rows={2}
                                    value={children[currentFullIndex]?.answerNotes?.[q.id] || ''}
                                    onChange={(e) => updateChild(currentFullIndex, (child) => ({
                                      answerNotes: { ...(child.answerNotes || {}), [q.id]: e.target.value },
                                    }))}
                                    placeholder="מה המצב, ממתי, והאם נקבעה הגבלה"
                                    style={{ resize: 'vertical' }}
                                  />
                                </div>
                              )}
                            </div>
                          ))}
                          {hasPositiveScreening(participantQuestions, answers) && (
                            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 4, lineHeight: 1.5 }}>
                              {/* The detail is a declaration by the signer, not a
                                  briefing we undertake to act on. */}
                              הפירוט נמסר על אחריות החותם/ת. האחריות להתאמת הפעילות למצב הרפואי,
                              ולהיוועצות ברופא לפני ההשתתפות, היא של החותם/ת בלבד.
                            </p>
                          )}
                          {needsMedicalClearance(participantQuestions, answers) && (
                            <MedicalClearanceField
                              triggers={clearanceTriggers(participantQuestions, answers)}
                              value={children[currentFullIndex]?.medicalClearance || null}
                              onChange={(file) => updateChild(currentFullIndex, { medicalClearance: file })}
                              onError={setError}
                            />
                          )}
                        </>
                      )}
                      <div
                        className="section-title declaration-major-title"
                        style={{ marginTop: screening.length ? 30 : 0 }}
                      >
                        {sectionTitles.confirm} — {currentChild.name}
                      </div>
                      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 14 }}>
                        יש לסמן את כל הסעיפים לאחר שקראתם אותם.
                      </p>
                      {currentChild.type !== 'adult' && (
                        <p className="child-safety-notice">
                          אנא הסבירו לילדכם את כללי הבטיחות.
                        </p>
                      )}
                      {confirmations.map((q) => (
                        <label key={q.id} className="event-check" style={{ marginBottom: 10 }}>
                          <input
                            type="checkbox"
                            checked={answers[q.id] === true}
                            onChange={(e) => setAnswer(q.id, e.target.checked)}
                          />
                          <span>{questionLabel(q)}</span>
                        </label>
                      ))}
                    </>
                  );
                })()}
                {error && <ErrorBox message={error} />}
                <button type="button" className="event-primary" style={{ marginTop: 16 }} onClick={advanceHealthOrSubmit}>
                  המשך להסרת אחריות וחתימה <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
                </button>
              </>
            )}

            {healthSubStep === 2 && (
              <>
                <div className="section-title">{sectionTitles.waiver}</div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', margin: '0 2px 12px' }}>
                  עבור {currentChild.name}
                </p>
                {/* One text, the binding one, with the signer's own name inside
                    it. A summary layer above it repeated the same clauses and
                    made the page say everything twice. */}
                <div style={{
                  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: 14, marginBottom: 16,
                }}>
                  <div
                    ref={waiverBoxRef}
                    onScroll={handleWaiverScroll}
                    style={{
                      fontSize: 13, lineHeight: 1.75, color: 'rgba(255,255,255,0.85)',
                      whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto',
                      background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10, padding: 12,
                    }}
                  >
                    {waiverBody}
                  </div>
                </div>
                <label className="event-check" style={{ opacity: waiverRead ? 1 : 0.55 }}>
                  <input
                    type="checkbox"
                    disabled={!waiverRead}
                    checked={!!children[currentFullIndex]?.waiverAccepted}
                    onChange={(e) => updateChild(currentFullIndex, { waiverAccepted: e.target.checked })}
                  />
                  <span>קראתי ואני מאשר/ת את הסרת האחריות והוראות הבטיחות</span>
                </label>
                {!waiverRead && (
                  <p style={{ fontSize: 12, color: '#FCD34D', margin: '6px 2px 0' }}>
                    גללו את הנוסח המחייב עד סופו — רק אז אפשר לסמן את האישור.
                  </p>
                )}

                <div className="section-title" style={{ marginTop: 20 }}>חתימה על הצהרת בריאות והסרת אחריות</div>
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
                <button
                  type="button"
                  className="event-primary"
                  style={{ marginTop: 16 }}
                  disabled={isSubmitting}
                  onClick={advanceHealthOrSubmit}
                >
                  {isSubmitting
                    ? 'שולח...'
                    : childHealthIndex < kids.length - 1
                      ? `שמור והמשך ל-${kids[childHealthIndex + 1]?.name || 'הבא'}`
                      : 'שלח'}
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
        .logo-circle {
          width: 118px; height: 118px; border-radius: 0; background: transparent;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 18px; overflow: visible;
          filter: drop-shadow(0 10px 18px rgba(0,0,0,.32));
        }
        .logo-circle img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .form-header h2 { margin: 0 0 6px; padding: 0; font-size: 22px; font-weight: 800; }
        .form-header h2.signing-document-title {
          margin-bottom: 0;
          font-size: clamp(15px, 3.4vw, 28px);
          line-height: 1.25;
          white-space: nowrap;
        }
        .form-header p { margin: 0; font-size: 13px; color: #94a3b8; }
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
