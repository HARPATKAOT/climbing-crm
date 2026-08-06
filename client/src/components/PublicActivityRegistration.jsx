import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Copy, Loader2, Plus, Trash2 } from 'lucide-react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { formatIls, normalizePriceIncludesVat, vatBreakdown } from '../utils/vat.js';
import {
  EventShell,
  EventStyles,
  Field,
  PhoneCodeGate,
  KnownChildNote,
  KnownChildPrompt,
  KnownFamilyNote,
  KnownFamilyPrompt,
  useFamilyMatch,
  usePhoneVerification,
  SignaturePad,
} from './publicFormKit.jsx';
import { checkKnownChild, linkFieldsFor } from '../utils/childCheck.js';
import {
  blankAnswers,
  clearanceTriggers,
  detailPrompt,
  isScreeningQuestion,
  needsMedicalClearance,
  questionLabel,
  questionsForSigner,
  unansweredQuestions,
} from '../utils/healthQuestions.js';
import MedicalClearanceField from './MedicalClearanceField.jsx';
import GenderPicker from './GenderPicker.jsx';
import { clearanceBudgetError } from '../utils/medicalClearanceFile.js';
import { declarationSectionTitles, splitWaiverText, withSignerName } from '../utils/declarationSections.js';
import { joinParentName, splitParentName } from '../utils/parentName.js';
import { uploadSignedParticipationPdfs } from '../utils/participationPdfUpload.js';

const emptyParticipant = (questions = [], extras = {}) => ({
  key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
  type: 'child',
  id: null,
  name: '',
  birthDate: '',
  answers: blankAnswers(questions),
  answerNotes: {},
  medicalClearance: null,
  waiverAccepted: false,
  signature: '',
  reuse_health: false,
  health_valid: false,
  ...extras,
});

function slugFromPath(pathname) {
  return decodeURIComponent(String(pathname || '').match(/^\/event\/([^/]+)/)?.[1] || '');
}

function formatDate(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('he-IL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function cancellationRuleText(rule) {
  const min = Number(rule.min_hours_before) || 0;
  if (min >= 168) return `שבעה ימים ומעלה לפני הפעילות — החזר בניכוי ${formatIls(rule.fixed_fee || 0)} לכל משתתף מבוטל`;
  if (min >= 48) return `בין 48 שעות לשבעה ימים לפני הפעילות — החזר של ${Number(rule.refund_percent) || 0}%`;
  return `פחות מ-48 שעות לפני הפעילות — ${Number(rule.refund_percent) ? `החזר של ${rule.refund_percent}%` : 'ללא החזר'}`;
}

export default function PublicActivityRegistration() {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '';
  const { slug: slugParam } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const slug = slugParam || slugFromPath(location.pathname);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [step, setStep] = useState(1);
  const [showInfo, setShowInfo] = useState(() => searchParams.get('paid') !== '1');
  const [healthIndex, setHealthIndex] = useState(0);
  const [isAdultSelf, setIsAdultSelf] = useState(false);
  // `firstName` and `lastName` are what the form shows; `name` is kept as the
  // joined version, because the surname on its own is what matches a household
  // and what reaches the invoice.
  const [parent, setParent] = useState({
    name: '', firstName: '', lastName: '', phone: '', email: '', city: '', idNumber: '',
    birthDate: '', gender: '',
  });
  const [participants, setParticipants] = useState([]);
  const [household, setHousehold] = useState(null);
  const [identityStatus, setIdentityStatus] = useState('unverified');
  const [listDefs, setListDefs] = useState([]);
  const [subscriptions, setSubscriptions] = useState({});
  const [selectedChildIds, setSelectedChildIds] = useState([]);
  const [newSpouse, setNewSpouse] = useState({ enabled: false, name: '', phone: '' });
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [registrationLinkCopied, setRegistrationLinkCopied] = useState(false);
  const pageTopRef = useRef(null);
  // participant key -> { match, student_id, guardian_first_name, health_valid, linked }
  const [knownChildren, setKnownChildren] = useState({});
  const phoneVerification = usePhoneVerification(parent.phone);
  const { otp } = phoneVerification;
  const {
    families,
    familyParentId,
    setFamilyParentId,
    waitingForFamily,
  } = useFamilyMatch(parent.lastName, parent.phone, {
    skip: identityStatus !== 'new',
    verificationToken: otp?.token || '',
  });
  const identityReady = phoneVerification.verified && ['found', 'new'].includes(identityStatus);

  // Public pages live inside the app's #root scroll container. Moving between
  // the information page, family selection, declarations and payment must feel
  // like a real page transition rather than retaining the previous screen's
  // scroll position.
  useEffect(() => {
    if (loading) return undefined;
    const frame = requestAnimationFrame(() => {
      const root = document.getElementById('root');
      if (root) root.scrollTop = 0;
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      pageTopRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [showInfo, step, healthIndex, done, loading]);

  const changeIdentityField = (field, value) => {
    setParent((current) => ({ ...current, [field]: value }));
    setIdentityStatus('unverified');
    setHousehold(null);
    setSelectedChildIds([]);
    setFamilyParentId(null);
    phoneVerification.setOtp((current) => ({
      ...current, stage: 'idle', code: '', token: '', verifiedPhone: '', error: '',
    }));
    setError('');
  };
  const [idempotencyKey] = useState(
    () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  );

  const copySeparateRegistrationLink = async () => {
    const link = `${window.location.origin}/event/${encodeURIComponent(slug)}`;
    try {
      await navigator.clipboard.writeText(link);
      setRegistrationLinkCopied(true);
      window.setTimeout(() => setRegistrationLinkCopied(false), 2500);
    } catch {
      window.prompt('העתיקו את קישור ההרשמה:', link);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/public/activities/${encodeURIComponent(slug)}`).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'הפעילות לא נמצאה');
        return body;
      }),
      fetch('/api/public/broadcast-list-defs').then(async (response) => {
        const body = await response.json().catch(() => ([]));
        return Array.isArray(body) ? body : (body.lists || body.listDefs || []);
      }).catch(() => []),
    ])
      .then(([body, defs]) => {
        if (!active) return;
        setActivity(body);
        setParticipants([emptyParticipant(body.form_template?.healthQuestions || [])]);
        setListDefs(defs);
      })
      .catch((loadError) => active && setError(loadError.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  const paidMode = activity?.registration_mode === 'paid_per_participant';
  const questions = activity?.form_template?.healthQuestions || [];
  // Each part of the declaration says what it is, and the trip says "טיול"
  // where the wall says "פעילות".
  const sectionTitles = declarationSectionTitles(activity?.form_template);

  const allParticipants = useMemo(() => {
    const mergeMirror = (base) => {
      const mirror = participants.find((item) => item.key === base.key);
      return mirror ? { ...base, ...mirror, ...base, answers: mirror.answers || base.answers, waiverAccepted: mirror.waiverAccepted ?? base.waiverAccepted, signature: mirror.signature || base.signature } : base;
    };
    const selected = [];
    if (isAdultSelf) {
      selected.push(mergeMirror({
        ...emptyParticipant(questions, {
          key: 'adult-self',
          id: household?.adult_student_id || null,
          type: 'adult',
          name: parent.name.trim(),
          birthDate: household?.adult?.birthDate || parent.birthDate || '',
          gender: household?.adult?.gender || parent.gender || '',
          idNumber: parent.idNumber || '',
          reuse_health: !!household?.adult_health_valid,
          reuse_health_document: !!household?.adult_health_document_valid,
          reuse_waiver: !!household?.adult_waiver_valid,
          health_valid: !!household?.adult_health_valid,
        }),
      }));
    }
    // Adults and children from the file, in the order they were offered. An
    // adult keeps `type: 'adult'` so the parent-only clauses stay hidden and
    // the record is not created as somebody's child.
    const fromExisting = [...(household?.adults || []), ...(household?.children || [])]
      .filter((member) => selectedChildIds.includes(member.id))
      .filter((member) => !(isAdultSelf && member.id === household?.adult_student_id))
      .map((member) => mergeMirror(emptyParticipant(questions, {
        key: `existing-${member.id}`,
        id: member.id,
        parent_member_id: member.parent_member_id || null,
        type: member.is_adult ? 'adult' : 'child',
        name: member.name,
        birthDate: member.birthDate || '',
        reuse_health: !!member.health_valid,
        reuse_health_document: !!member.health_document_valid,
        reuse_waiver: !!member.waiver_valid,
        defer_documents: member.is_adult && !member.health_valid,
        health_valid: !!member.health_valid,
      })));
    const newChildren = participants
      .filter(
        (participant) => participant.type !== 'adult'
          && !String(participant.key || '').startsWith('existing-')
          && participant.key !== 'adult-self'
          && participant.name.trim()
      )
      // A child confirmed as already on another parent's file joins that file
      // instead of becoming a second copy, and keeps its valid declaration.
      .map((participant) => {
        const known = knownChildren[participant.key];
        return known?.linked
          ? { ...participant, ...linkFieldsFor(known), health_valid: !!known.health_valid }
          : participant;
      });
    if (newSpouse.enabled && newSpouse.name.trim() && newSpouse.phone.trim()) {
      selected.push(emptyParticipant(questions, {
        key: 'pending-spouse', type: 'adult', name: newSpouse.name.trim(),
        spouse_phone: newSpouse.phone.trim(), defer_documents: true,
        reuse_health: false, health_valid: false,
      }));
    }
    return [...selected, ...fromExisting, ...newChildren];
  }, [isAdultSelf, parent.name, household, selectedChildIds, participants, questions, knownChildren, newSpouse]);

  const participantsNeedingHealth = useMemo(
    () => allParticipants.filter((participant) => !participant.defer_documents && !participant.reuse_health),
    [allParticipants]
  );

  const includesVat = normalizePriceIncludesVat(activity?.price_includes_vat);
  const unitVat = vatBreakdown(activity?.unit_price, includesVat);
  const totalEntered = (Number(activity?.unit_price) || 0) * allParticipants.length;
  const totalVat = vatBreakdown(totalEntered, includesVat);
  const total = totalVat.gross;
  const currentParticipant = participantsNeedingHealth[healthIndex];
  const totalSteps = participantsNeedingHealth.length ? 4 : 3;

  const step1Title = isAdultSelf
    ? 'פרטים אישיים'
    : (paidMode ? 'פרטי הורה או משלם' : 'פרטי הורה של משתתף בפעילות');

  /** Editing a child's name or birth date makes the previous answer moot. */
  const forgetKnownChild = (key) => {
    setKnownChildren((current) => {
      if (!current[key]) return current;
      const { [key]: _dropped, ...rest } = current;
      return rest;
    });
  };

  /**
   * `patch` may be a function of the participant it is patching, which is the
   * only safe form when several updates land in one render — answering a row of
   * health questions quickly, where a patch built from a captured copy keeps
   * overwriting the same stale object and only the last answer survives.
   */
  const updateParticipant = (key, patch) => {
    setParticipants((current) => current.map((participant) => (
      participant.key === key
        ? { ...participant, ...(typeof patch === 'function' ? patch(participant) : patch) }
        : participant
    )));
  };

  const patchHealthParticipant = (participant, patch) => {
    if (participant.type === 'adult' || String(participant.key || '').startsWith('existing-')) {
      // Adult / existing kids are derived — keep signature fields on participants array via mirror key.
      setParticipants((current) => {
        const mirrorKey = participant.key;
        const existing = current.find((item) => item.key === mirrorKey);
        const applied = (base) => (typeof patch === 'function' ? patch(base) : patch);
        if (existing) {
          return current.map((item) => (
            item.key === mirrorKey ? { ...item, ...applied(item) } : item
          ));
        }
        return [...current, { ...participant, ...applied(participant) }];
      });
      return;
    }
    updateParticipant(participant.key, patch);
  };

  const resolvedHealthParticipant = (participant) => {
    const mirror = participants.find((item) => item.key === participant.key);
    return mirror ? { ...participant, ...mirror } : participant;
  };

  const lookupHousehold = async (verificationToken = otp.token) => {
    const response = await fetch(
      `/api/public/activities/${encodeURIComponent(slug)}/household?phone=${encodeURIComponent(parent.phone)}&idNumber=${encodeURIComponent(parent.idNumber)}&verificationToken=${encodeURIComponent(verificationToken || '')}`
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.identity_status === 'review_required') setIdentityStatus('review_required');
      throw new Error(body.error || 'בדיקת לקוח קיים נכשלה');
    }
    setIdentityStatus(body.identity_status || (body.found ? 'found' : 'new'));
    setHousehold(body.found ? body : { found: false, children: [], adult_health_valid: false });
    if (body.found) {
      const knownName = splitParentName(body.parent || {});
      setParent((current) => ({
        ...current,
        firstName: knownName.first || current.firstName,
        lastName: knownName.lastName || current.lastName,
        name: joinParentName(knownName.first || current.firstName, knownName.lastName || current.lastName),
        email: body.parent?.email || current.email,
        city: body.parent?.city || current.city,
        idNumber: body.parent?.idNumber || current.idNumber,
        birthDate: body.adult?.birthDate || current.birthDate,
        gender: body.adult?.gender || current.gender,
      }));
      if (Array.isArray(body.listDefs) && body.listDefs.length) setListDefs(body.listDefs);
      if (body.subscriptions && typeof body.subscriptions === 'object') {
        setSubscriptions({ ...body.subscriptions });
      }
      if (!isAdultSelf && Array.isArray(body.children) && body.children.length === 1) {
        setSelectedChildIds([body.children[0].id]);
      }
    } else {
      setSelectedChildIds([]);
    }
    return body;
  };

  /**
   * Recognise the household while the phone is being typed, not only when
   * Continue is pressed. Until the lookup has run there is no answer to "is
   * this a family we know", and the form was announcing a new family file to
   * people whose file it was about to find.
   */
  const next = async () => {
    setError('');
    if (step === 1) {
      if (String(parent.idNumber || '').replace(/\D/g, '').length < 5 || !parent.phone.trim()) {
        setError('יש למלא תעודת זהות ומספר טלפון');
        return;
      }
      if (!phoneVerification.verified) {
        await phoneVerification.send();
        return;
      }
      let found = household;
      if (!found || !['found', 'new'].includes(identityStatus)) {
        try {
          found = await lookupHousehold();
        } catch (lookupError) {
          setError(lookupError.message);
          return;
        }
        // Show the resolved/prefilled details before asking the person to
        // confirm or complete them.
        return;
      }
      if (!parent.firstName.trim() || !parent.lastName.trim() || !parent.email.trim()) {
        setError('יש להשלים שם פרטי, שם משפחה ודואר אלקטרוני');
        return;
      }
      if (isAdultSelf && !(household?.adult?.birthDate || parent.birthDate)) {
        setError('יש למלא תאריך לידה למשתתף/ת בוגר/ת');
        return;
      }
      // Surname match is asked live while they type. Stay here until they answer.
      if (!found?.found && waitingForFamily) return;
      setStep(2);
      return;
    }
    if (step === 2) {
      if (newSpouse.enabled && (!newSpouse.name.trim() || !newSpouse.phone.trim())) {
        setError('יש למלא שם וטלפון של בן/בת הזוג, או לבטל את הוספתם');
        return;
      }
      if (!allParticipants.length) {
        setError('יש לבחור או להוסיף לפחות משתתף אחד');
        return;
      }
      if (activity.remaining != null && allParticipants.length > activity.remaining) {
        setError(`נותרו רק ${activity.remaining} מקומות פנויים`);
        return;
      }
      if (allParticipants.some((participant) =>
        !participant.name.trim()
        || (participant.type === 'child' && !participant.id && !participant.birthDate)
      )) {
        setError('יש למלא שם ותאריך לידה לכל ילד חדש');
        return;
      }
      // Each newly typed child may already be on the other parent's file. Ask
      // about all of them at once, before anything is written.
      const unanswered = allParticipants.filter(
        (participant) => !participant.id
          && participant.type === 'child'
          && !knownChildren[participant.key]
      );
      if (unanswered.length) {
        const checked = await Promise.all(unanswered.map(async (participant) => {
          const match = await checkKnownChild({
            name: participant.name,
            birthDate: participant.birthDate,
            phone: parent.phone,
            templateSlug: activity?.form_template?.slug || '',
            verificationToken: otp.token,
          });
          return [participant.key, { ...match, linked: match.match ? null : false }];
        }));
        setKnownChildren((current) => ({ ...current, ...Object.fromEntries(checked) }));
        if (checked.some(([, match]) => match.match)) return;
      }
      setHealthIndex(0);
      setStep(participantsNeedingHealth.length ? 3 : 4);
      return;
    }
    if (step === 3) {
      const current = resolvedHealthParticipant(currentParticipant);
      // A screening question is unanswered until it is a real yes or no, so a
      // medical question nobody touched can never be filed as "no".
      const asked = questionsForSigner(questions, { isAdultSelf: current.type === 'adult' });
      const missing = unansweredQuestions(asked, current.answers || {});
      if (missing.length) {
        setError(
          missing.some(isScreeningQuestion)
            ? 'יש לענות כן או לא על כל שאלות הבריאות'
            : 'יש לסמן את כל סעיפי טופס ההשתתפות והבטיחות'
        );
        return;
      }
      // A condition nobody described is a condition the instructor cannot act on.
      const undetailed = asked.find((question) => isScreeningQuestion(question)
        && current.answers?.[question.id] === true
        && !String(current.answerNotes?.[question.id] || '').trim());
      if (undetailed) {
        setError(`סימנתם „כן” על „${questionLabel(undetailed)}” — יש לפרט בשדה שמתחת לשאלה`);
        return;
      }
      // The written approval is a condition of signing at all, not a note to
      // add later — the same gate the registration form applies.
      if (needsMedicalClearance(asked, current.answers || {}) && !current.medicalClearance) {
        setError('נדרש אישור רופא להשתתפות בפעילות ספורטיבית — צרפו אותו כדי להמשיך');
        return;
      }
      if (!current.waiverAccepted || !current.signature) {
        setError('יש לאשר את כתב הוויתור ולחתום');
        return;
      }
      // Every approval travels in the one registration request, so the whole
      // set has to fit in it.
      const overBudget = clearanceBudgetError(allParticipants.map(resolvedHealthParticipant));
      if (overBudget) {
        setError(overBudget);
        return;
      }
      if (healthIndex < participantsNeedingHealth.length - 1) {
        setHealthIndex((index) => index + 1);
      } else {
        setStep(4);
      }
    }
  };

  const submit = async () => {
    if (paidMode && activity?.cancellation_policy && !policyAccepted) {
      setError('יש לקרוא ולאשר את תנאי הביטול לפני המעבר לתשלום');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payloadParticipants = allParticipants.map((participant) => {
        const merged = resolvedHealthParticipant(participant);
        const { key: _key, health_valid: _valid, answerNotes, ...rest } = merged;
        // The per-question detail becomes the one healthNotes string the
        // declaration, the PDF and the personal file all read — each line still
        // saying which question it answers.
        const healthNotes = (activity?.form_template?.healthQuestions || [])
          .filter((q) => isScreeningQuestion(q) && merged.answers?.[q.id] === true)
          .map((q) => {
            const note = String(answerNotes?.[q.id] || '').trim();
            return note ? `${questionLabel(q)} — ${note}` : '';
          })
          .filter(Boolean)
          .join('\n');
        return {
          ...rest,
          ...(healthNotes ? { healthNotes } : {}),
          reuse_health: !!rest.reuse_health,
        };
      });
      const response = await fetch(`/api/public/activities/${encodeURIComponent(slug)}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          parent: { ...parent, family_parent_id: familyParentId || null },
          subscriptions,
          participants: payloadParticipants,
          phoneVerification: { token: otp.token },
          policyAccepted,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'ההרשמה נכשלה');
      await uploadSignedParticipationPdfs({
        signedDocuments: body.signedDocuments || [],
        submittedParticipants: payloadParticipants,
        parent,
        template: activity?.form_template || {},
        brandName,
        phoneVerificationToken: otp.token,
      });
      if (body.paymentUrl) {
        window.location.assign(body.paymentUrl);
        return;
      }
      setDone(true);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <EventShell><Loader2 className="spin" /><p>טוען...</p></EventShell>;
  if (error && !activity) return <EventShell><h1>לא ניתן להירשם</h1><p>{error}</p></EventShell>;
  if (done || searchParams.get('paid') === '1') {
    return (
      <EventShell>
        <CheckCircle size={62} color="#34d399" />
        <h1>ההרשמה התקבלה</h1>
        <p>{paidMode ? 'התשלום נקלט והמשתתפים רשומים.' : 'כל המשתתפים נשמרו בהצלחה.'}</p>
      </EventShell>
    );
  }

  if (showInfo) {
    const cover = activity?.cover_image || activity?.theme?.cover_image || '';
    return (
      <div className="event-page" ref={pageTopRef}>
        <main className="event-card">
          {cover && <div className="event-cover"><img src={cover} alt="" /></div>}
          <header className="event-hero">
            {brandLogo ? <div className="event-brand-logo"><img src={brandLogo} alt={brandName} /></div> : <div className="event-brand">{brandName}</div>}
            <h1>{activity.page_title || activity.name}</h1>
            <div className="event-meta">
              <span>{formatDate(activity.date)}{activity.start_time ? ` · ${activity.start_time.slice(0, 5)}` : ''}</span>
              {activity.location && <span>{activity.location}</span>}
              {activity.remaining != null && <span>{activity.remaining} מקומות פנויים</span>}
            </div>
            {(activity.page_body || activity.description) && <p className="event-body">{activity.page_body || activity.description}</p>}
            {paidMode && unitVat.entered > 0 && <div className="event-price-chip">{formatIls(unitVat.gross)} למשתתף</div>}
          </header>
          <section style={{ marginTop: 20 }}>
            {activity.audience && <p><strong>למי מתאים:</strong> {activity.audience}</p>}
            {activity.included && <p><strong>מה כלול:</strong> {activity.included}</p>}
            {activity.what_to_bring && <p><strong>מה להביא:</strong> {activity.what_to_bring}</p>}
            {activity.important_info && <p><strong>חשוב לדעת:</strong> {activity.important_info}</p>}
          </section>
          <footer className="event-actions">
            <button type="button" className="event-primary" onClick={() => setShowInfo(false)}>
              {paidMode ? `להרשמה ותשלום${unitVat.entered > 0 ? ` · ${formatIls(unitVat.gross)}` : ''}` : 'להרשמה'}
            </button>
          </footer>
        </main>
        <EventStyles />
      </div>
    );
  }

  const coverImage = activity?.cover_image || activity?.theme?.cover_image || '';
  const coverPosition = activity?.cover_position
    || activity?.theme?.cover_position
    || '50% 50%';
  const displayStep = step === 4 && !participantsNeedingHealth.length
    ? 3
    : (step === 4 ? totalSteps : Math.min(step, totalSteps));
  const healthCurrent = currentParticipant ? resolvedHealthParticipant(currentParticipant) : null;
  // The name and dates the approval sentence quotes — the same ones printed at
  // the top of the page, so the signer confirms what they were shown.
  const activityTitle = activity?.page_title || activity?.name || '';
  const activityDatesText = [
    formatDate(activity?.date),
    activity?.end_date && activity.end_date !== activity.date ? formatDate(activity.end_date) : '',
  ].filter(Boolean).join(' – ');

  return (
    <div className="event-page" ref={pageTopRef}>
      <main className="event-card">
        {coverImage ? (
          <div className="event-cover">
            <img
              src={coverImage}
              alt=""
              style={{ objectPosition: coverPosition }}
            />
          </div>
        ) : null}
        <header className="event-hero">
          {brandLogo ? (
            <div className="event-brand-logo">
              <img src={brandLogo} alt={brandName} />
            </div>
          ) : (
            <div className="event-brand">{brandName}</div>
          )}
          <h1>{activity.page_title || activity.name}</h1>
          <div className="event-meta">
            <span>
              {formatDate(activity.date)}
              {activity.end_date && activity.end_date !== activity.date
                ? ` – ${formatDate(activity.end_date)}`
                : ''}
              {!activity.all_day && activity.start_time
                ? ` · ${activity.start_time.slice(0, 5)}`
                : ''}
              {!activity.all_day && activity.end_time
                ? `–${activity.end_time.slice(0, 5)}`
                : ''}
            </span>
            {activity.location && <span>{activity.location}</span>}
          </div>
          {step < 4 && (activity.page_body || activity.description) && (
            <p className="event-body">{activity.page_body || activity.description}</p>
          )}
          {paidMode && unitVat.entered > 0 && (
            <div className="event-price-chip">
              {formatIls(unitVat.gross)} למשתתף
              {' · '}
              {includesVat ? 'כולל מע״מ' : 'לפני מע״מ + מע״מ'}
            </div>
          )}
          <div className="event-progress-label">שלב {displayStep} מתוך {totalSteps}</div>
          <div className="event-progress" style={{
            background: `linear-gradient(90deg,#f97316 0 ${(displayStep / totalSteps) * 100}%,rgba(255,255,255,.1) ${(displayStep / totalSteps) * 100}%)`,
          }} />
        </header>

        {step === 1 && (
          <section>
            <h2>זיהוי ממלא/ת הטופס</h2>
            <p className="event-hint">
              נזהה את התיק רק לאחר אימות הטלפון. לפני האימות לא יוצגו פרטי משפחה.
            </p>
            <Field
              label="תעודת זהות *"
              value={parent.idNumber}
              onChange={(idNumber) => changeIdentityField('idNumber', idNumber)}
            />
            <Field
              label="טלפון *"
              type="tel"
              value={parent.phone}
              onChange={(phone) => changeIdentityField('phone', phone)}
            />
            {otp.stage === 'code' && (
              <PhoneCodeGate
                otp={otp}
                phone={parent.phone.trim()}
                onCodeChange={(code) => phoneVerification.setOtp((current) => ({ ...current, code }))}
                onVerify={async () => {
                  const token = await phoneVerification.verify();
                  if (token) await lookupHousehold(token).catch((lookupError) => setError(lookupError.message));
                }}
                onResend={phoneVerification.send}
                onEditPhone={() => phoneVerification.setOtp((current) => ({ ...current, stage: 'idle', code: '' }))}
              />
            )}
            {identityReady && (
              <>
                <p className="event-hint" style={{ color: household?.found ? '#86efac' : '#fdba74' }}>
                  {household?.found
                    ? 'מצאנו את התיק שלכם והשלמנו את הפרטים הקיימים.'
                    : 'לא נמצא תיק תואם. תיק משפחה חדש ייפתח רק לאחר שליחת הטופס.'}
                </p>
                <label className="event-check event-adult-toggle">
                  <input
                    type="checkbox"
                    checked={isAdultSelf}
                    onChange={(event) => setIsAdultSelf(event.target.checked)}
                  />
                  גם אני משתתף/ת בפעילות (בוגר/ת מעל גיל 18)
                </label>
                <h2>{step1Title}</h2>
                <Field
                  label={isAdultSelf ? 'שם פרטי' : 'שם פרטי (הורה)'}
                  value={parent.firstName}
                  onChange={(firstName) => setParent((p) => ({ ...p, firstName, name: joinParentName(firstName, p.lastName) }))}
                />
                <Field
                  label={isAdultSelf ? 'שם משפחה' : 'שם משפחה (הורה)'}
                  value={parent.lastName}
                  onChange={(lastName) => setParent((p) => ({ ...p, lastName, name: joinParentName(p.firstName, lastName) }))}
                />
                <Field label="דואר אלקטרוני" type="email" value={parent.email} onChange={(email) => setParent({ ...parent, email })} />
                <Field label="עיר" value={parent.city} onChange={(city) => setParent({ ...parent, city })} />
                {isAdultSelf && (
                  <>
                    <Field label="תאריך לידה *" type="date" value={parent.birthDate} onChange={(birthDate) => setParent({ ...parent, birthDate })} />
                    <GenderPicker value={parent.gender} onChange={(gender) => setParent({ ...parent, gender })} />
                  </>
                )}
                {!household?.found && (
                  <>
                    <KnownFamilyPrompt families={families} chosenId={familyParentId} onChoose={setFamilyParentId} />
                    <KnownFamilyNote families={families} chosenId={familyParentId} onCancel={() => setFamilyParentId(null)} />
                  </>
                )}

                <h2 style={{ marginTop: 28 }}>הזדמנות לערוך את העדפות הדיוור שלך</h2>
                {/* כאן כל הרשימות אופציונליות, ולכן סימון הוא הסכמה לדבר
                    פרסומת כמשמעותו בחוק התקשורת — ואפשר להסיר בכל עת. */}
                <p className="event-hint">
                  סימון רשימה הוא הסכמה לקבל ממנו דיוור, ואפשר להסיר אותה בכל עת בלי לפגוע בהרשמה.
                </p>
                <div className="event-lists">
                  {listDefs.map((list) => {
                    const checked = subscriptions[list.key] === true;
                    return (
                      <label className="event-check" key={list.key}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSubscriptions((prev) => ({ ...prev, [list.key]: !prev[list.key] }))}
                        />
                        <span>
                          <strong>{list.label || list.key}</strong>
                          {list.description ? ` — ${list.description}` : ''}
                        </span>
                      </label>
                    );
                  })}
                  {!listDefs.length && <p className="event-hint">רשימות הדיוור יישמרו עם ההרשמה.</p>}
                </div>
              </>
            )}
          </section>
        )}

        {step === 2 && (
          <section>
            <h2>מי משתתף?</h2>
            {household?.found && (
              <p className="event-hint">
                נמצאתם במערכת. סמנו את מי שמשתתף — מבוגרים וילדים — או הוסיפו משתתף/ת חדש/ה.
              </p>
            )}
            {/* Grown-ups on the file are offered like everyone else. A family
                books a trip together, and listing only the children left the
                parents with no way to put themselves on it. */}
            {[...(household?.adults || []).filter((member) => (
              member.id !== household?.adult_student_id
              && member.parent_member_id !== household?.parent?.id
            )), ...(household?.children || [])].map((member) => {
              const checked = selectedChildIds.includes(member.id);
              return (
                <label className="event-check event-existing-child" key={member.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedChildIds((current) => (
                        checked
                          ? current.filter((id) => id !== member.id)
                          : [...current, member.id]
                      ));
                    }}
                  />
                  <span>
                    <strong>{member.name}</strong>
                    {member.is_adult ? ' (מבוגר/ת)' : ''}
                    {member.health_valid
                      ? ' — יש טופס השתתפות בתוקף'
                      : ' — נדרש טופס השתתפות'}
                    {member.is_adult && !member.health_valid && (
                      <small style={{ display: 'block', marginTop: 4, color: 'rgba(255,255,255,.62)' }}>
                        אפשר לשמור עבורה/ו מקום ולשלם עכשיו. השלמת הפרטים והחתימה תישלח אליה/ו בנפרד.
                      </small>
                    )}
                  </span>
                </label>
              );
            })}

            {participants.filter((participant) => participant.type !== 'adult').map((participant, index) => (
              <div className="participant-card" key={participant.key}>
                <div className="participant-title">
                  <strong>ילד או ילדה חדש {index + 1}</strong>
                  {participants.filter((item) => item.type !== 'adult').length > 1 && (
                    <button
                      type="button"
                      className="event-remove-button"
                      onClick={() => setParticipants((items) => items.filter((item) => item.key !== participant.key))}
                    >
                      <Trash2 size={13} /> הסר ילד/ה
                    </button>
                  )}
                </div>
                <Field
                  label="שם מלא"
                  value={participant.name}
                  onChange={(name) => {
                    updateParticipant(participant.key, { name });
                    forgetKnownChild(participant.key);
                  }}
                />
                <Field
                  label="תאריך לידה"
                  type="date"
                  value={participant.birthDate}
                  onChange={(birthDate) => {
                    updateParticipant(participant.key, { birthDate });
                    forgetKnownChild(participant.key);
                  }}
                />
                <KnownChildPrompt
                  childName={participant.name}
                  match={knownChildren[participant.key]}
                  onAnswer={(linked) => setKnownChildren((current) => ({
                    ...current,
                    [participant.key]: { ...current[participant.key], linked },
                  }))}
                />
                <KnownChildNote
                  childName={participant.name}
                  match={knownChildren[participant.key]}
                />
              </div>
            ))}
            <button
              type="button"
              className="event-secondary"
              onClick={() => setParticipants((items) => [
                ...items.filter((item) => item.type !== 'adult' || item.name),
                emptyParticipant(questions),
              ])}
            >
              <Plus size={17} /> הוספת ילד/ה נוסף/ת
            </button>
            <p className="event-hint" style={{ marginTop: 8 }}>
              הוספת ילד/ה מיועדת רק לילד שאתם הורה או אפוטרופוס שלו. ילד ממשפחה אחרת נרשם בקישור נפרד על ידי הורהו.
            </p>
            <button
              type="button"
              className="event-secondary"
              onClick={copySeparateRegistrationLink}
            >
              <Copy size={17} />
              {registrationLinkCopied ? 'הקישור הועתק' : 'העתקת קישור להרשמה נפרדת למשפחה אחרת'}
            </button>

            <label className="event-check event-adult-toggle" style={{ marginTop: 18 }}>
              <input
                type="checkbox"
                checked={newSpouse.enabled}
                onChange={(event) => setNewSpouse((current) => ({ ...current, enabled: event.target.checked }))}
              />
              רישום בן/בת הזוג לפעילות
            </label>
            {newSpouse.enabled && (
              <div className="participant-card">
                <strong>פרטים ראשוניים של בן/בת הזוג</strong>
                <Field label="שם מלא" value={newSpouse.name} onChange={(name) => setNewSpouse((current) => ({ ...current, name }))} />
                <Field label="טלפון" type="tel" value={newSpouse.phone} onChange={(phone) => setNewSpouse((current) => ({ ...current, phone }))} />
                <p className="event-hint">אפשר לשלם ולשמור מקום כעת. קישור להשלמת הפרטים והחתימה יישלח לטלפון הזה.</p>
              </div>
            )}
          </section>
        )}

        {step === 3 && healthCurrent && (
          <section key={healthCurrent.key}>
            <h2>טופס השתתפות עבור {healthCurrent.name}</h2>
            {(() => {
              // The same two kinds the registration form distinguishes. Rendered
              // as one list of tick boxes, a medical question had no way to be
              // answered "no" — an untouched box read the same as "nobody asked",
              // and the safety undertakings were lost among the questions.
              const asked = questionsForSigner(
                activity.form_template?.healthQuestions || [],
                { isAdultSelf: healthCurrent.type === 'adult' }
              );
              const screening = asked.filter(isScreeningQuestion);
              const confirmations = asked.filter((q) => !isScreeningQuestion(q));
              const answers = healthCurrent.answers || {};
              const setAnswer = (id, value) => patchHealthParticipant(healthCurrent, (base) => ({
                answers: { ...(base.answers || answers), [id]: value },
              }));
              return (
                <>
                  {screening.length > 0 && (
                    <>
                      <h3 className="event-subheading">{sectionTitles.health}</h3>
                      <p className="event-hint">
                        תשובה „כן” לא מונעת השתתפות. היא רק מאפשרת לצוות לדעת ולהיערך.
                      </p>
                      {screening.map((question) => (
                        <div className="event-screening" key={question.id}>
                          <div className="event-screening-label">{questionLabel(question)}</div>
                          <div className="event-screening-answers">
                            {[['כן', true], ['לא', false]].map(([text, value]) => (
                              <button
                                key={text}
                                type="button"
                                className={answers[question.id] === value ? 'is-active' : ''}
                                onClick={() => setAnswer(question.id, value)}
                              >
                                {text}
                              </button>
                            ))}
                          </div>
                          {answers[question.id] === true && (
                            <div className="event-field" style={{ marginTop: 10 }}>
                              <label className="event-label">פרטו בבקשה *</label>
                              <textarea
                                rows={2}
                                value={healthCurrent.answerNotes?.[question.id] || ''}
                                onChange={(e) => patchHealthParticipant(healthCurrent, (base) => ({
                                  answerNotes: {
                                    ...(base.answerNotes || healthCurrent.answerNotes || {}),
                                    [question.id]: e.target.value,
                                  },
                                }))}
                                placeholder={detailPrompt(question)}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                      {/* A doctor already limited this person's physical
                          activity. The wall does not overrule that on a tick
                          box — the same rule the registration form applies. */}
                      {needsMedicalClearance(asked, answers) && (
                        <MedicalClearanceField
                          triggers={clearanceTriggers(asked, answers)}
                          value={healthCurrent.medicalClearance || null}
                          onChange={(file) => patchHealthParticipant(healthCurrent, { medicalClearance: file })}
                          onError={setError}
                        />
                      )}
                    </>
                  )}
                  {confirmations.length > 0 && (
                    <>
                      <h3 className="event-subheading">{sectionTitles.confirm}</h3>
                      <p className="event-hint">יש לסמן את כל הסעיפים לאחר שקראתם אותם.</p>
                      {confirmations.map((question) => (
                        <label className="event-check" key={question.id}>
                          <input
                            type="checkbox"
                            checked={answers[question.id] === true}
                            onChange={(event) => setAnswer(question.id, event.target.checked)}
                          />
                          <span>{questionLabel(question)}</span>
                        </label>
                      ))}
                    </>
                  )}
                </>
              );
            })()}
            <h3 className="event-subheading">{sectionTitles.waiver}</h3>
            {/* The clauses name the person taking the risk on themselves. The
                placeholder was reaching the screen unwritten. */}
            <div className="event-waiver">
              {withSignerName(
                splitWaiverText(activity.form_template?.waiverText).body,
                joinParentName(parent.name, parent.lastName)
              )}
            </div>
            {/* איזו יציאה מאושרת כאן. הוויתור עצמו כללי, ולכן בלי המשפט הזה
                החתימה לא אומרת על איזו פעילות ובאילו תאריכים היא ניתנה. */}
            <div className="event-waiver-activity">
              אני מאשר/ת את השתתפות {healthCurrent.name} ב„{activityTitle}”
              {activityDatesText ? ` בתאריך ${activityDatesText}` : ''}.
            </div>
            <label className="event-check">
              <input
                type="checkbox"
                checked={!!healthCurrent.waiverAccepted}
                onChange={(event) => {
                  const at = new Date().toISOString();
                  patchHealthParticipant(healthCurrent, {
                    waiverAccepted: event.target.checked,
                    signatureEvidenceTimeline: {
                      ...(healthCurrent.signatureEvidenceTimeline || {}),
                      termsPresentedAt: healthCurrent.signatureEvidenceTimeline?.termsPresentedAt || at,
                      termsAcceptedAt: event.target.checked ? at : null,
                    },
                  });
                }}
              />
              קראתי ואני מאשר או מאשרת את כתב הוויתור
            </label>
            <p className="event-label">חתימה</p>
            <SignaturePad
              value={healthCurrent.signature}
              onChange={(signature) => {
                const at = new Date().toISOString();
                patchHealthParticipant(healthCurrent, {
                  signature,
                  signatureEvidenceTimeline: {
                    ...(healthCurrent.signatureEvidenceTimeline || {}),
                    termsPresentedAt: healthCurrent.signatureEvidenceTimeline?.termsPresentedAt || at,
                    signatureCapturedAt: signature ? at : null,
                  },
                });
              }}
            />
          </section>
        )}

        {step === 4 && (
          <section>
            <h2>סיכום הרשמה</h2>
            <div className="event-summary">
              <div><span>מספר משתתפים</span><strong>{allParticipants.length}</strong></div>
              {activity.remaining != null && <div><span>מקומות פנויים לפני ההרשמה</span><strong>{activity.remaining}</strong></div>}
              {allParticipants.map((participant) => (
                <div key={participant.key}>
                  <span>{participant.name}</span>
                  <strong>{participant.reuse_health ? 'טופס השתתפות בתוקף' : 'טופס השתתפות חדש'}</strong>
                </div>
              ))}
              {paidMode && (
                <>
                  <div>
                    <span>{includesVat ? 'מחיר למשתתף כולל מע״מ' : 'מחיר למשתתף לפני מע״מ'}</span>
                    <strong>{formatIls(unitVat.entered)}</strong>
                  </div>
                  {!includesVat && (
                    <div>
                      <span>מחיר למשתתף כולל מע״מ</span>
                      <strong>{formatIls(unitVat.gross)}</strong>
                    </div>
                  )}
                  <div className="event-total">
                    <span>סך הכול לתשלום</span>
                    <strong>{formatIls(totalVat.gross)}</strong>
                  </div>
                </>
              )}
            </div>
            {paidMode && activity.cancellation_policy && (
              <div className="participant-card" style={{ marginTop: 16 }}>
                <h3 style={{ marginTop: 0 }}>תנאי ביטול</h3>
                <ul style={{ lineHeight: 1.7 }}>
                  {(activity.cancellation_policy.rules || []).map((rule) => <li key={rule.id}>{cancellationRuleText(rule)}</li>)}
                </ul>
                {activity.cancellation_policy.free_text && <p className="event-hint" style={{ whiteSpace: 'pre-wrap' }}>{activity.cancellation_policy.free_text}</p>}
                <label className="event-check">
                  <input type="checkbox" checked={policyAccepted} onChange={(event) => setPolicyAccepted(event.target.checked)} />
                  קראתי ואני מאשר/ת את תנאי הביטול
                </label>
              </div>
            )}
            {!paidMode && <p className="event-free-note">אין צורך בתשלום</p>}
          </section>
        )}

        {error && <div className="event-error" role="alert">{error}</div>}
        <footer className="event-actions">
          {step > 1 && (
            <button type="button" className="event-secondary" onClick={() => {
              if (step === 3 && healthIndex > 0) setHealthIndex((index) => index - 1);
              else if (step === 4 && participantsNeedingHealth.length) setStep(3);
              else if (step === 4 && isAdultSelf) setStep(1);
              // Everyone already had a valid declaration: step 3 was skipped on
              // the way in and must be skipped on the way back too, or the
              // customer lands on a blank screen.
              else if (step === 4) setStep(2);
              else setStep((current) => current - 1);
              setError('');
            }}>
              חזרה
            </button>
          )}
          {step < 4 ? (
            (otp.stage === 'code' && step === 1) || (waitingForFamily && step === 1) ? null : (
              <button type="button" className="event-primary" onClick={next}>המשך</button>
            )
          ) : (
            <button type="button" className="event-primary" disabled={submitting} onClick={submit}>
              {submitting ? 'שומר...' : paidMode ? `מעבר לתשלום ₪${total}` : 'אישור הרשמה'}
            </button>
          )}
        </footer>
      </main>
      <EventStyles />
    </div>
  );
}
