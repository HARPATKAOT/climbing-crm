import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle, Download, PenTool, Plus, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  blobToBase64,
  buildHealthDeclarationPdf,
  downloadHealthDeclarationPdf,
} from '../utils/healthDeclarationPdf.js';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import {
  EventStyles,
  KnownChildNote,
  KnownChildPrompt,
  KnownFamilyNote,
  KnownFamilyPrompt,
} from './publicFormKit.jsx';
import { checkKnownChild, checkKnownFamily, linkFieldsFor } from '../utils/childCheck.js';
import { joinParentName, splitParentName } from '../utils/parentName.js';

/**
 * The liability release only. The safety rules are not repeated here — they are
 * the ticked items on the previous step, where each one is acknowledged
 * separately, which is both better evidence and one list instead of two.
 */
function buildFallbackWaiver(legalName) {
  return `אני מצהיר/ה כי אני מודע/ת לסיכונים הכרוכים בפעילות המתקיימת ב"${legalName}", אני פוטר/ת את "${legalName}" ו/או מי מטעמו מכל אחריות לפגיעה אם תקרה למשתתף אותו אני רושם לפעילות וזאת אלא אם יוכח כי הינה תוצאה של רשלנות המקום.

אני הח"מ מתחייב/ת בזאת למלא את כל הוראות הבטיחות שסימנתי בשלב הקודם.`;
}

function buildFallbackQuestions(legalName) {
  return [
    {
      id: 'h1',
      requireYes: true,
      label: `אני החתום/ה מטה מצהיר/ה בזאת שאני או האדם אותו אני רושם לחוג הטיפוס בריא/ה וכשיר/ה פיזית, נפשית וקוגניטיבית להשתתף בפעילות המתקיימת ב"${legalName}". אני מבין כי הפעילות עלולה להיות מסוכנת ולא ידוע לי על מגבלות שעלולות למנוע מהמשתתף פעילות בטוחה ובריאה.`,
    },
    { id: 's1', requireYes: true, label: 'אין להשאיר ילד עד גיל 11 ללא ליווי מבוגר שלא במסגרת חוג מסודר' },
    { id: 's2', requireYes: true, label: 'נא להימנע מריצה והשתוללות בכל מתחם הקיר' },
    { id: 's3', requireYes: true, label: 'יש להישמע להוראות המדריכים' },
    { id: 's4', requireYes: true, label: 'טיפוס על הקיר יתאפשר רק לאלו שקיבלו תדריך מסודר' },
    { id: 's5', requireYes: true, label: 'אין להשתמש במתקנים השונים ללא קבלת אישור ממדריך' },
  ];
}

const emptyChild = (questions = []) => {
  const answers = {};
  questions.forEach((q) => { answers[q.id] = false; });
  return {
    id: null,
    name: '',
    birthDate: '',
    gender: '',
    childPhone: '',
    registrationNotes: '',
    answers,
    waiverAccepted: false,
    signature: '',
  };
};



export default function PublicOnboardingForm() {
  const { profile, legalName } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '/logo.png';
  const fallbackWaiver = useMemo(() => buildFallbackWaiver(legalName), [legalName]);
  const fallbackQuestions = useMemo(() => buildFallbackQuestions(legalName), [legalName]);
  const [searchParams] = useSearchParams();
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
    phone: searchParams.get('phone') || '',
    email: '',
    city: '',
  });
  const [children, setChildren] = useState([emptyChild()]);
  const [isAdultSelf, setIsAdultSelf] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [savedDeclarations, setSavedDeclarations] = useState([]);
  const [error, setError] = useState('');
  const [uploadingPdfs, setUploadingPdfs] = useState(false);
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const questions = (template?.healthQuestions?.length
    ? template.healthQuestions
    : fallbackQuestions);
  const waiverText = template?.waiverText || fallbackWaiver;
  // participant key -> { match, student_id, guardian_first_name, health_valid, linked }
  const [knownChildren, setKnownChildren] = useState({});
  // Families on file under the same surname, and the one chosen ('' = new family).
  const [families, setFamilies] = useState([]);
  const [familyParentId, setFamilyParentId] = useState(null);
  const [prefilledParentId, setPrefilledParentId] = useState('');

  /**
   * The parent's name as one string, always first name then surname. The CRM
   * stores this alongside the separate surname, so records stay readable even
   * where only a single name field exists.
   */
  const parentFullName = () => joinParentName(parent.name, parent.lastName);

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

  /** A child linked to an existing file with a valid declaration signs nothing. */
  const reusesDeclaration = (child) => {
    const known = knownChildren[childKey(child)];
    return !!(known?.linked && known.health_valid);
  };

  const totalStepsLabel = 2 + Math.max(
    children.filter((c) => c.name.trim() && !reusesDeclaration(c)).length,
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
            phone: data.parent.phone || searchParams.get('phone') || '',
            email: data.parent.email || '',
            city: data.parent.city || '',
          });
        }
        if (Array.isArray(data.students) && data.students.length) {
          setChildren(data.students.map((s) => {
            const answers = {};
            qs.forEach((q) => { answers[q.id] = false; });
            return {
              id: s.id,
              name: s.name || '',
              birthDate: s.birthDate || '',
              gender: s.gender || '',
              childPhone: '',
              registrationNotes: '',
              answers,
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

  const updateChild = (index, patch) => {
    setChildren((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const addChild = () => {
    if (isAdultSelf) return;
    setChildren((prev) => [...prev, emptyChild(questions)]);
  };

  const removeChild = (index) => {
    if (isAdultSelf) return;
    setChildren((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const setAdultSelfMode = (enabled) => {
    setIsAdultSelf(enabled);
    if (enabled) {
      setChildren([{
        ...emptyChild(questions),
        name: parentFullName(),
        type: 'adult',
      }]);
    } else {
      setChildren([emptyChild(questions)]);
    }
  };

  const namedChildren = () => children.filter((c) => c.name.trim());

  const healthChildren = () => namedChildren().filter((child) => !reusesDeclaration(child));

  const goNextFromParent = async () => {
    setError('');
    if (!parent.name.trim() || !parent.lastName.trim() || !parent.phone.trim()) {
      setError('יש למלא שם פרטי, שם משפחה ומספר טלפון');
      return;
    }
    if (!parent.email.trim()) {
      setError('יש למלא אימייל');
      return;
    }
    if (!parent.city.trim()) {
      setError('יש למלא מקום מגורים');
      return;
    }
    // A parent we have never seen may still belong to a family we know — only
    // they can tell us, and only before a second file is opened.
    if (!prefilledParentId && familyParentId === null) {
      const known = await checkKnownFamily({ lastName: parent.lastName, phone: parent.phone });
      setFamilies(known.families);
      if (known.families.length) return;
      setFamilyParentId('');
    }
    if (isAdultSelf) {
      setChildren([{
        ...emptyChild(questions),
        ...(children[0] || {}),
        name: parentFullName(),
        type: 'adult',
      }]);
    }
    setStep(2);
  };

  const goNextFromChildren = async () => {
    setError('');
    const kids = namedChildren();
    if (!kids.length) {
      setError('יש להוסיף לפחות משתתף/ת אחד');
      return;
    }
    for (const kid of kids) {
      if (!isAdultSelf && !kid.birthDate) {
        setError(`חסר תאריך לידה עבור ${kid.name}`);
        return;
      }
    }
    // A child already on another parent's file joins it instead of becoming a
    // second copy — but only the person filling this in can confirm that.
    if (!isAdultSelf) {
      const unanswered = kids.filter((kid) => !kid.id && !knownChildren[childKey(kid)]);
      if (unanswered.length) {
        const checked = await Promise.all(unanswered.map(async (kid) => {
          const match = await checkKnownChild({
            name: childFullName(kid),
            birthDate: kid.birthDate,
            phone: parent.phone,
          });
          return [childKey(kid), { ...match, linked: match.match ? null : false }];
        }));
        setKnownChildren((current) => ({ ...current, ...Object.fromEntries(checked) }));
        if (checked.some(([, match]) => match.match)) return;
      }
    }
    // Everyone here already has a declaration in force on their existing file.
    if (!healthChildren().length) {
      await submitAll(children);
      return;
    }
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
      const missing = questions.filter((q) => q.requireYes && !(children[fullIndex]?.answers || {})[q.id]);
      if (missing.length) {
        setError('יש לסמן את כל סעיפי ההצהרה והבטיחות');
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
    const withSig = children.map((c, i) =>
      i === fullIndex ? { ...c, signature, waiverAccepted: true } : c
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
        .filter((c) => c.name.trim())
        .map((c) => {
          const reuse = reusesDeclaration(c);
          return {
            id: c.id,
            name: childFullName(c),
            type: isAdultSelf || c.type === 'adult' ? 'adult' : 'child',
            birthDate: c.birthDate,
            gender: c.gender,
            childPhone: c.childPhone,
            registrationNotes: c.registrationNotes,
            answers: c.answers || {},
            signature: c.signature,
            waiverAccepted: !reuse,
            ...linkFieldsFor(knownChildren[childKey(c)]),
          };
        });

      const res = await fetch('/api/public/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent: {
            name: parentFullName(),
            lastName: parent.lastName.trim(),
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'שגיאה בשמירת הטופס');
        return;
      }

      const decls = (data.declarations || []).map((d, i) => ({
        ...d,
        parentName: parentFullName(),
        phone: parent.phone,
        climberName: kids[i]?.name || d.climberName,
        birthDate: kids[i]?.birthDate || d.birthDate,
        answers: kids[i]?.answers || d.answers,
        signature_url: kids[i]?.signature || d.signature_url,
        signature: kids[i]?.signature || d.signature_url,
        signedBy: parentFullName(),
        studentName: kids[i]?.name || d.climberName,
        signedDate: d.signedDate || d.date,
        templateSlug: template?.slug || 'wall',
        title: template?.title || 'הצהרת בריאות ובטיחות + הסרת אחריות',
        brandName,
      }));
      setSavedDeclarations(decls);
      setIsSuccess(true);

      setUploadingPdfs(true);
      for (const decl of decls) {
        try {
          const { blob, fileName } = await buildHealthDeclarationPdf(decl);
          const pdfBase64 = await blobToBase64(blob);
          await fetch(`/api/public/onboard/${encodeURIComponent(decl.id)}/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdfBase64, fileName }),
          });
        } catch (err) {
          console.error('PDF upload failed for', decl.id, err);
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
      <div className="event-page">
        <div className="event-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>טוען טופס השלמת פרטים...</p>
        </div>
        <FormStyles />
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="event-page">
        <div className="event-card event-centered">
          <CheckCircle size={60} color="#F97316" style={{ margin: '0 auto', marginBottom: 20 }} />
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
              onClick={() => downloadHealthDeclarationPdf(decl)}
            >
              <Download size={16} style={{ marginLeft: 8 }} />
              הורד אישור — {decl.climberName || decl.studentName}
            </button>
          ))}
        </div>
        <FormStyles />
      </div>
    );
  }

  const kids = namedChildren();
  const currentChild = kids[childHealthIndex] || kids[0];
  const currentFullIndex = currentChild
    ? children.findIndex((c) => c === currentChild || (c.name === currentChild.name && c.id === currentChild.id))
    : 0;
  // Steps 1 and 2 are fixed; step 3 repeats once per child who still has to sign.
  const displayStep = step === 3 ? 2 + childHealthIndex + 1 : step;
  const progressPercent = Math.round((displayStep / totalStepsLabel) * 100);

  return (
    <div className="event-page">
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
          <h2>מילוי פרטים והרשמה</h2>
          <p>
            {step === 1 && 'פרטי הורה ורשימות עדכונים'}
            {step === 2 && 'פרטי המשתתפים בחוג'}
            {step === 3 && `הצהרה וחתימה: ${currentChild?.name || ''}`}
          </p>
          {/* Same progress strip as the event and shop pages. */}
          <div className="event-progress-label">
            שלב {displayStep} מתוך {totalStepsLabel}
          </div>
          <div
            className="event-progress"
            style={{
              background: `linear-gradient(90deg,#f97316 0 ${progressPercent}%,rgba(255,255,255,.1) ${progressPercent}%)`,
            }}
          />
        </div>

        {step === 1 && (
          <div className="fade-in">
            <div className="section-title">פרטי הורה / איש קשר</div>
            {/* First name and surname are separate on purpose: the surname is
                what recognises a second parent of a household we already know,
                and it also reaches the invoice. Guessing it from the last word
                of a free-text name gets it backwards for anyone who writes the
                family name first. */}
            <div className="form-group">
              <label>שם פרטי של ההורה *</label>
              <input
                value={parent.name}
                onChange={(e) => setParent((p) => ({ ...p, name: e.target.value }))}
                placeholder="ישראל"
              />
            </div>
            <div className="form-group">
              <label>שם משפחה של ההורה *</label>
              <input
                value={parent.lastName}
                onChange={(e) => setParent((p) => ({ ...p, lastName: e.target.value }))}
                placeholder="ישראלי"
              />
            </div>
            <div className="form-group">
              <label>טלפון *</label>
              <input
                type="tel"
                value={parent.phone}
                onChange={(e) => setParent((p) => ({ ...p, phone: e.target.value }))}
                placeholder="חובה להורה שממלא על ילד"
              />
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
                      borderColor: checked ? 'rgba(249,115,22,0.45)' : 'rgba(255,255,255,0.08)',
                      background: checked ? 'rgba(249,115,22,0.08)' : 'rgba(255,255,255,0.03)',
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
            <KnownFamilyNote families={families} chosenId={familyParentId} />

            {error && <ErrorBox message={error} />}
            <button type="button" className="event-primary" onClick={goNextFromParent}>
              המשך לפרטי משתתפים <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="section-title">פרטי המשתתפים בחוג</div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', margin: '0 0 14px' }}>
              השיבוץ לקבוצה יבוצע על ידי הצוות בהמשך.
            </p>
            <label
              className="event-check"
              style={{
                cursor: 'pointer',
                marginBottom: 14,
                borderColor: isAdultSelf ? 'rgba(249,115,22,0.45)' : 'rgba(255,255,255,0.08)',
                background: isAdultSelf ? 'rgba(249,115,22,0.08)' : 'rgba(255,255,255,0.03)',
              }}
            >
              <input
                type="checkbox"
                checked={isAdultSelf}
                onChange={(e) => setAdultSelfMode(e.target.checked)}
              />
              <span>אני נרשם/ת לעצמי כמבוגר</span>
            </label>
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
                  <div style={{ fontSize: 13, color: '#F97316', fontWeight: 700 }}>
                    {isAdultSelf ? 'משתתף מבוגר' : `משתתף/ת ${index + 1}`}
                  </div>
                  {!isAdultSelf && children.length > 1 && (
                    <button type="button" className="clear-btn" onClick={() => removeChild(index)}>
                      <Trash2 size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> הסר
                    </button>
                  )}
                </div>
                <div className="form-group">
                  <label>{isAdultSelf ? 'שם מלא *' : 'שם פרטי של המשתתף בחוג *'}</label>
                  <input
                    value={child.name}
                    onChange={(e) => updateChild(index, { name: e.target.value })}
                    placeholder={isAdultSelf ? 'שם מלא' : 'שם פרטי'}
                    readOnly={isAdultSelf}
                  />
                  {/* Shown rather than assumed: the surname is completed from
                      the parent, and anyone whose child carries a different one
                      can type it here in full. */}
                  {!isAdultSelf && childFullName(child) !== child.name.trim() && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
                      ייכנס למערכת כ־{childFullName(child)} — אפשר להקליד שם משפחה אחר במידת הצורך
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>{isAdultSelf ? 'תאריך לידה' : 'תאריך לידה *'}</label>
                  <input
                    type="date"
                    value={child.birthDate}
                    onChange={(e) => updateChild(index, { birthDate: e.target.value })}
                  />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
                    {isAdultSelf
                      ? 'אופציונלי למבוגר.'
                      : 'לבחירת שנה — לחצו על השנה עצמה בחלון שנפתח.'}
                  </div>
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
                {!isAdultSelf && (
                  <>
                    <div className="form-group">
                      <label>בן / בת</label>
                      <select
                        value={child.gender}
                        onChange={(e) => updateChild(index, { gender: e.target.value })}
                      >
                        <option value="">בחרו</option>
                        <option value="male">בן</option>
                        <option value="female">בת</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>טלפון של הילד/ה</label>
                      <input
                        type="tel"
                        value={child.childPhone}
                        onChange={(e) => updateChild(index, { childPhone: e.target.value })}
                        placeholder="לקבוצת המטפסים — לא נשלח דיוור"
                      />
                    </div>
                  </>
                )}
                <div className="form-group">
                  <label>הערות להרשמה</label>
                  <input
                    value={child.registrationNotes}
                    onChange={(e) => updateChild(index, { registrationNotes: e.target.value })}
                    placeholder="יום שמתאים, רוצים להירשם אחרי תאריך מסוים וכו׳"
                  />
                </div>
              </div>
            ))}
            {!isAdultSelf && (
              <button
                type="button"
                onClick={addChild}
                style={{
                  width: '100%', background: 'transparent', border: '1px dashed rgba(249,115,22,0.5)',
                  color: '#F97316', padding: 12, borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16,
                }}
              >
                <Plus size={16} /> הוסף משתתף/ת
              </button>
            )}
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
                <div className="section-title">הצהרת בריאות ובטיחות — {currentChild.name}</div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 14 }}>
                  יש לסמן את כל הסעיפים לאישור.
                </p>
                {questions.map((q) => (
                  <label key={q.id} className="event-check" style={{ marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={!!(children[currentFullIndex]?.answers || {})[q.id]}
                      onChange={(e) => {
                        const answers = {
                          ...(children[currentFullIndex]?.answers || {}),
                          [q.id]: e.target.checked,
                        };
                        updateChild(currentFullIndex, { answers });
                      }}
                    />
                    <span>{q.label}</span>
                  </label>
                ))}
                {error && <ErrorBox message={error} />}
                <button type="button" className="event-primary" style={{ marginTop: 16 }} onClick={advanceHealthOrSubmit}>
                  המשך להסרת אחריות וחתימה <ArrowLeft size={18} style={{ transform: 'rotate(180deg)', marginRight: 8 }} />
                </button>
              </>
            )}

            {healthSubStep === 2 && (
              <>
                <div className="section-title">הסרת אחריות — {currentChild.name}</div>
                <div style={{
                  background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.7,
                  color: 'rgba(255,255,255,0.85)', whiteSpace: 'pre-wrap', marginBottom: 16,
                  maxHeight: 220, overflowY: 'auto',
                }}>
                  {waiverText}
                </div>
                <label className="event-check">
                  <input
                    type="checkbox"
                    checked={!!children[currentFullIndex]?.waiverAccepted}
                    onChange={(e) => updateChild(currentFullIndex, { waiverAccepted: e.target.checked })}
                  />
                  <span>קראתי ואני מאשר/ת את הסרת האחריות והוראות הבטיחות</span>
                </label>

                <div className="section-title" style={{ marginTop: 20 }}>חתימה על הצהרת בריאות ובטיחות</div>
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
      <EventStyles />
      <style>{`
        .event-card { padding-bottom: 24px; }
        .fade-in { padding: 0 24px; animation: fadeIn .4s ease; }
        .event-centered .fade-in { padding: 0; }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .form-header { text-align: center; padding: 22px 24px 0; }
        .logo-circle {
          width: 60px; height: 60px; border-radius: 50%; background: #fff;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 14px; overflow: hidden;
        }
        .logo-circle img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .form-header h2 { margin: 0 0 6px; padding: 0; font-size: 22px; font-weight: 800; }
        .form-header p { margin: 0; font-size: 13px; color: #94a3b8; }
        .section-title {
          font-size: 13px; letter-spacing: .5px; color: #fb923c;
          font-weight: 800; margin: 22px 0 12px;
        }
        .form-group { margin-bottom: 14px; }
        .form-group label { display: block; margin-bottom: 6px; font-size: 14px; color: #cbd5e1; }
        .form-group input, .form-group select, .form-group textarea {
          width: 100%; padding: 12px 14px; border-radius: 11px;
          border: 1px solid rgba(255,255,255,.15); background: #0b1220;
          color: #fff; font: inherit;
        }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: #f97316; }
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
        .event-primary { width: 100%; margin-top: 6px; }
      `}</style>
    </>
  );
}
