import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, AlertCircle, FileText, Send, ClipboardCheck, Shield, Link2, Copy, Trash2, Plus, Download, Image as ImageIcon, Upload, Loader2, Pencil, Lock } from 'lucide-react';
import { downloadHealthDeclarationPdf } from '../utils/healthDeclarationPdf.js';
import { templateKind } from '../utils/declarationKinds.js';
import { compressImageFile } from './productCategories.js';
import {
  isChildOnlyQuestion,
  isScreeningQuestion,
  questionLabel,
  requiresClearance,
} from '../utils/healthQuestions.js';
import { normalizeParticipationScope } from '../utils/participationDocuments.js';

/**
 * „סוג הפעילות” על ההצהרה הוא מה שקובע איזו הצהרה נחתמת בהרשמה לאירוע ביומן:
 * קיימים שני תחומי אישור בלבד: כל פעילות בקיר, ויציאה / טיול. סוג האירוע
 * ביומן אינו יוצר מסמך משפטי שלישי.
 */
const BASE_ACTIVITY_TYPES = [
  { value: 'wall', label: 'פעילות בקיר — חוגים, כניסות, אימונים ואירועים' },
  { value: 'trip', label: 'יציאה / טיול' },
];

const EMPTY_TEMPLATE = {
  title: '',
  slug: '',
  activityTypes: ['wall'],
  headline: '',
  coverImage: '',
  activityNature: '',
  waiverText: '',
  waiverSummary: '',
  safetyRulesText: '',
  isDefault: false,
  isActive: true,
};

/**
 * One line per question. A line starting with "?" is a medical screening
 * question — answered כן/לא, and a "yes" never blocks the form. Everything else
 * is a confirmation the signer must tick.
 *
 * A line starting with "@" is addressed to a parent only: it disappears when an
 * adult fills the form in for themselves, so nobody confirms a rule about
 * leaving a child unaccompanied when there is no child.
 */
function questionsToText(questions) {
  if (!Array.isArray(questions) || !questions.length) return '';
  return questions
    .map((q) => {
      const label = questionLabel(q);
      if (!label) return '';
      const marks = `${isScreeningQuestion(q) ? '?' : ''}${isChildOnlyQuestion(q) ? '@' : ''}${requiresClearance(q) ? '!' : ''}`;
      return `${marks}${label}`;
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {string} text  שורה לכל סעיף
 * @param {Array}  known הסעיפים כפי שהם שמורים היום — כדי לשמר מזהים
 *
 * סעיף ששורתו לא השתנתה שומר את המזהה שלו. בלי זה כל שמירה הייתה מחדשת
 * q1..qn, ורשומה חתומה שמפנה למזהה ישן הייתה מאבדת את הנוסח שלו.
 */
function textToQuestions(text, known = []) {
  const byLabel = new Map(
    (known || []).filter((q) => q?.id && q?.label).map((q) => [String(q.label).trim(), q.id])
  );
  const used = new Set();
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const screening = isScreeningQuestion({ label: line });
      const childOnly = isChildOnlyQuestion({ label: line });
      const clearance = requiresClearance({ label: line });
      const label = questionLabel({ label: line });
      const keptId = byLabel.get(label);
      let id = keptId && !used.has(keptId) ? keptId : `q${i + 1}`;
      while (used.has(id)) id = `${id}_`;
      used.add(id);
      // `requireYes` used to be dropped here, which quietly turned every
      // mandatory clause optional the first time a template was saved from
      // this screen. A confirmation is mandatory; a screening question is not,
      // because there "yes" is an answer rather than a signature.
      const audience = childOnly ? 'child' : 'all';
      return screening
        ? { id, label, kind: 'screen', audience, requiresClearance: clearance, requireYes: false }
        : { id, label, kind: 'confirm', audience, requiresClearance: false, requireYes: true };
    })
    .filter((q) => q.label);
}

/** הסעיפים שהמסך הזה באמת שולט בהם: אישורי בטיחות והצהרה, לא השאלון הרפואי. */
function safetyRulesOf(questions) {
  return (questions || []).filter((q) => q && !isScreeningQuestion(q) && !/^m\d+$/i.test(String(q.id || '')));
}

/** השאלון הרפואי — קבוע במערכת וזהה בכל הטפסים. */
function medicalQuestionsOf(questions) {
  return (questions || []).filter((q) => q && isScreeningQuestion(q));
}

/** ארבעת הדפים שהחותם עובר, בסדר שבו הם מוצגים בטופס. */
const PREVIEW_PAGES = [
  { key: 'health', short: 'בריאות', title: 'הצהרת בריאות' },
  { key: 'nature', short: 'אופי הפעילות', title: 'אופי הפעילות והסיכונים' },
  { key: 'safety', short: 'בטיחות', title: 'כללי בטיחות' },
  { key: 'waiver', short: 'ההצהרה', title: 'אישור השתתפות והסרת אחריות' },
];

function FormTemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | template
  const [form, setForm] = useState(EMPTY_TEMPLATE);
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const coverFileRef = useRef(null);
  const [coverBusy, setCoverBusy] = useState(false);
  /**
   * הטופס נפתח נעול. מה שנערך כאן הוא המסמך שלקוחות חותמים עליו ברגע זה,
   * ולחיצה מקרית על שדה לא אמורה להיות מסוגלת לשנות אותו.
   */
  const [unlocked, setUnlocked] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const locked = !unlocked;
  // השאלון הרפואי מגיע מהשרת עם התבנית; בהצהרה חדשה הוא עוד לא ידוע, ולכן
  // נלקח מכל תבנית קיימת — הוא זהה בכולן ממילא.
  const medicalQuestions = medicalQuestionsOf(
    (editing && editing !== 'new' ? editing.healthQuestions : null)
    || templates.find((t) => medicalQuestionsOf(t.healthQuestions).length)?.healthQuestions
    || []
  );
  const previewSafetyRules = textToQuestions(form.safetyRulesText);

  /**
   * התמונה מוקטנת בדפדפן לפני השליחה. תמונה מהטלפון היא כמה מגה־בייט, וגוף
   * בקשה בגודל כזה נדחה בשרת — הטופס היה נשמר בלי הקאוור בלי לומר למה.
   */
  const pickCover = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCoverBusy(true);
    setMsg('');
    try {
      const dataUrl = await compressImageFile(file, { maxSide: 1400, quality: 0.8 });
      setForm((f) => ({ ...f, coverImage: dataUrl }));
    } catch {
      setMsg('טעינת התמונה נכשלה — נסו קובץ תמונה אחר');
    } finally {
      setCoverBusy(false);
    }
  };
  const activityTypeOptions = BASE_ACTIVITY_TYPES;

  const load = async () => {
    try {
      const data = await fetch('/api/form-templates').then((r) => (r.ok ? r.json() : []));
      setTemplates(Array.isArray(data) ? data.filter((template) => (
        !['event', 'birthday'].includes(String(template.slug || '').toLowerCase())
      )) : []);
    } catch {
      setTemplates([]);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing('new');
    setForm(EMPTY_TEMPLATE);
    setMsg('');
    // הצהרה חדשה עוד לא חיה בשום קישור — אין ממה להגן.
    setUnlocked(true);
    setConfirmSave(false);
    setPreviewPage(0);
  };

  const openEdit = (t) => {
    setEditing(t);
    setUnlocked(false);
    setConfirmSave(false);
    setPreviewPage(0);
    setForm({
      title: t.title || '',
      slug: t.slug || '',
      activityTypes: [...new Set((t.activityTypes || (t.activityType ? [t.activityType] : []))
        .map(normalizeParticipationScope))],
      headline: t.headline || '',
      coverImage: t.coverImage || '',
      activityNature: t.activityNature || '',
      waiverText: t.waiverText || '',
      waiverSummary: t.waiverSummary || '',
      // רק מה שהמסך הזה שולט בו. השאלון הרפואי מוצג בנפרד, לקריאה בלבד.
      safetyRulesText: questionsToText(safetyRulesOf(t.healthQuestions)),
      isDefault: !!t.isDefault,
      isActive: t.isActive !== false,
    });
    setMsg('');
  };

  // /register is the address the form goes out under now — it collects details,
  // health answers and a signature, so /health named a third of it. The old
  // addresses still resolve, so links already sent keep working.
  const publicUrl = (slug, isDefault) => {
    const base = window.location.origin;
    if (isDefault || !slug || slug === 'wall') return `${base}/register`;
    return `${base}/register/${slug}`;
  };

  const copyLink = async (t) => {
    const url = publicUrl(t.slug, t.isDefault);
    try {
      await navigator.clipboard.writeText(url);
      setMsg(`הקישור הועתק: ${url}`);
    } catch {
      setMsg(url);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    // שתי לחיצות על מסמך חי: הראשונה אומרת מה עומד להשתנות ולמי, השנייה
    // היא זו ששומרת.
    if (editing !== 'new' && !confirmSave) {
      setConfirmSave(true);
      return;
    }
    setSaving(true);
    setMsg('');
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim().toLowerCase(),
      activityTypes: form.activityTypes || [],
      headline: (form.headline || '').trim(),
      coverImage: form.coverImage || '',
      activityNature: (form.activityNature || '').trim(),
      waiverText: form.waiverText,
      waiverSummary: form.waiverSummary,
      healthQuestions: textToQuestions(
        form.safetyRulesText,
        editing === 'new' ? [] : safetyRulesOf(editing?.healthQuestions)
      ),
      isDefault: form.isDefault,
      isActive: form.isActive,
    };
    try {
      const isNew = editing === 'new';
      const res = await fetch(isNew ? '/api/form-templates' : `/api/form-templates/${editing.id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || 'שגיאה בשמירה');
        return;
      }
      setEditing(null);
      setUnlocked(false);
      setConfirmSave(false);
      setMsg('התבנית נשמרה — הטופס הציבורי כבר מגיש את הנוסח החדש');
      await load();
    } catch {
      setMsg('שגיאת רשת');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t) => {
    if (!confirm(`למחוק את התבנית "${t.title}"?`)) return;
    const res = await fetch(`/api/form-templates/${t.id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error || 'לא ניתן למחוק');
      return;
    }
    setMsg('התבנית נמחקה');
    if (editing && editing !== 'new' && editing.id === t.id) setEditing(null);
    await load();
  };

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="section-title">עריכת הצהרת הבריאות שנשלחת</div>
          <div className="section-sub">
            כאן עורכים את הכותרת, טקסט כתב הוויתור והשאלות הרפואיות שמופיעים בטופס הציבורי ובקישור בוואטסאפ.
            אפשר כמה גרסאות (קיר / יום הולדת / יציאה) — כל אחת עם קישור משלה.
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={openNew}>
          <Plus size={15} /> הצהרה חדשה
        </button>
      </div>

      {msg && (
        <div className="alert alert-success" style={{ marginBottom: 12, wordBreak: 'break-all' }}>{msg}</div>
      )}

      {!editing && templates.length > 0 && (
        <div className="alert alert-success" style={{ marginBottom: 14 }}>
          לחצו <strong>ערוך</strong> על ההצהרה הרצויה כדי לשנות את הטקסט שנשלח ללקוחות. תבנית ברירת המחדל נפתחת ב־/register.
        </div>
      )}

      {editing && (
        <form onSubmit={handleSave} className="card card-p decl-editor" style={{ marginBottom: 20 }}>
          <div className="decl-editor-head">
            <div className="section-title" style={{ margin: 0 }}>
              {editing === 'new' ? 'הצהרה חדשה לעריכה' : `עריכת הצהרה: ${editing.title}`}
            </div>
            {/* מסמך חי. הטופס נפתח נעול, וכתוב עליו למה. */}
            {editing !== 'new' && (
              locked ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setUnlocked(true)}>
                  <Pencil size={14} /> עריכת הנוסח
                </button>
              ) : (
                <span className="decl-live-warn">
                  <AlertCircle size={14} /> במצב עריכה — שמירה משנה מיד את הטופס שהלקוחות ממלאים
                </span>
              )
            )}
          </div>
          {editing !== 'new' && locked && (
            <div className="decl-locked-note">
              זהו הנוסח שהטופס הציבורי מגיש ברגע זה. הוא פתוח לקריאה; לשינוי — „עריכת הנוסח”.
              מסמכים שכבר נחתמו לא ישתנו לעולם: כל חתימה שומרת עותק מוקפא של הנוסח שנחתם,
              וה-PDF נבנה ממנו.
            </div>
          )}

          <div className="decl-editor-body">
            {/* fieldset אחד נועל את כל השדות יחד — אין שדה ששוכחים לנעול. */}
            <fieldset className="decl-fields" disabled={locked}>

              <section className="decl-panel">
                <div className="decl-panel-title">זהות הטופס</div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">כותרת *</label>
                    <input
                      required
                      className="input"
                      value={form.title}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        title: e.target.value,
                        slug: f.slug || e.target.value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
                      }))}
                      placeholder="לדוגמה: הצהרת יום הולדת"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">מזהה קישור (slug) *</label>
                    <input
                      required
                      className="input"
                      value={form.slug}
                      onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') }))}
                      placeholder="wall"
                      dir="ltr"
                      style={{ textAlign: 'left' }}
                    />
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }} dir="ltr">
                      {publicUrl(form.slug, form.isDefault)}
                    </div>
                  </div>
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">סוגי פעילות שההצהרה הזאת משרתת</label>
                    {/* הצהרה אחת יכולה לשרת כמה סוגים; סוג שייך להצהרה אחת בלבד, ולכן
                        סימון סוג שתפוס מעביר אותו לכאן — וכתוב למי הוא שייך עכשיו. */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {activityTypeOptions.map((a) => {
                          const chosen = (form.activityTypes || []).includes(a.value);
                          const ownerElsewhere = templates.find((t) => (
                            t.id !== (editing === 'new' ? null : editing?.id)
                            && (t.activityTypes || (t.activityType ? [t.activityType] : [])).includes(a.value)
                          ));
                          return (
                            <button
                              key={a.value}
                              type="button"
                              className={`btn btn-xs ${chosen ? 'btn-primary' : 'btn-ghost'}`}
                              title={ownerElsewhere ? `שייך כרגע ל„${ownerElsewhere.title}”` : undefined}
                              onClick={() => setForm((f) => {
                                const current = new Set(f.activityTypes || []);
                                if (current.has(a.value)) current.delete(a.value);
                                else current.add(a.value);
                                return { ...f, activityTypes: [...current] };
                              })}
                            >
                              {a.label}
                              {ownerElsewhere && !chosen ? ' · תפוס' : ''}
                            </button>
                          );
                        })}
                    </div>
                    {!(form.activityTypes || []).length && (
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                        ללא שיוך — מגיעים להצהרה הזאת רק בקישור ישיר.
                      </div>
                    )}
                  </div>
                  <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'flex-end', paddingBottom: 4 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} />
                      תבנית ברירת מחדל (נפתחת ב־/register)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                      פעילה
                    </label>
                  </div>
                </div>
              </section>

              <section className="decl-panel">
                <div className="decl-panel-title">ראש הטופס</div>
                {/* מה שרואים בראש הטופס הציבורי. „כותרת” היא שם המסמך שחותמים עליו,
                    ולכן היא לא ענתה על השאלה הראשונה של מי שפותח את הקישור: לאיזו
                    פעילות זה. */}
                <div className="form-group">
                  <label className="form-label">כותרת הפעילות</label>
                  <input
                    className="input"
                    value={form.headline || ''}
                    onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
                    placeholder="טיפוס בקיר בועז"
                  />
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                    מופיעה מעל שם המסמך, בכל שלבי הטופס. ריק — תיגזר מסוג הטופס.
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">תמונת קאוור</label>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div className="decl-cover-preview">
                      {form.coverImage
                        ? <img src={form.coverImage} alt="" />
                        : <ImageIcon size={22} />}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <input
                        ref={coverFileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                        hidden
                        onChange={pickCover}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => coverFileRef.current?.click()}
                        disabled={coverBusy || saving}
                      >
                        {coverBusy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                        {form.coverImage ? 'החלפת התמונה' : 'העלאת תמונה'}
                      </button>
                      {form.coverImage && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setForm((f) => ({ ...f, coverImage: '' }))}
                          disabled={coverBusy || saving}
                        >
                          <Trash2 size={14} /> הסרת התמונה
                        </button>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-3)', maxWidth: 260, lineHeight: 1.5 }}>
                        רצועה רחבה בראש הטופס. תמונה לרוחב עובדת הכי טוב; היא מוקטנת אוטומטית לפני השמירה.
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* ‏1 מתוך 4 — ולא נערך כאן. */}
              <section className="decl-panel is-readonly">
                <div className="decl-panel-title">
                  1 · הצהרת בריאות
                  <span className="decl-panel-badge"><Lock size={11} /> קבוע במערכת</span>
                </div>
                <div className="decl-panel-note">
                  השאלון הרפואי זהה בכל הטפסים, ולכן „יש הצהרת בריאות בתוקף” אומר אותו דבר
                  בקיר ובטיול. הוא לא נערך כאן — שינוי בו הוא שינוי במערכת.
                </div>
                <ol className="decl-question-list">
                  {medicalQuestions.map((q) => (
                    <li key={q.id}>
                      {questionLabel(q)}
                      {requiresClearance(q) && (
                        <span className="decl-question-flag">„כן” ⟵ נדרש אישור רופא</span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>

              <section className="decl-panel">
                <div className="decl-panel-title">2 · הבנת אופי הפעילות והסיכונים</div>
                <div className="decl-panel-note">
                  נקרא — לא מסומן — לפני כללי הבטיחות. שורה ריקה מפרידה בין פסקאות;
                  שורה שמתחילה ב־• היא סעיף ברשימה. ריק — יוצג נוסח ברירת המחדל של המערכת.
                </div>
                <textarea
                  className="textarea"
                  rows={8}
                  value={form.activityNature}
                  onChange={(e) => setForm((f) => ({ ...f, activityNature: e.target.value }))}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder={'טיפוס ספורטיבי הוא פעילות אתגרית מהנה, אבל היא גם כרוכה בסיכונים.\n\n• נפילה מגובה — עלולה לגרום לפציעה חמורה'}
                />
              </section>

              <section className="decl-panel">
                <div className="decl-panel-title">3 · כללי הבטיחות וההתחייבויות</div>
                <div className="decl-panel-note">
                  שורה לכל סעיף. כל סעיף מוצג כתיבת סימון שחובה לסמן.
                  שורה שמתחילה ב־<strong>@</strong> מוצגת רק כשהורה ממלא עבור ילד, ונעלמת כשמבוגר ממלא עבור עצמו.
                </div>
                <textarea
                  className="textarea"
                  rows={7}
                  value={form.safetyRulesText}
                  onChange={(e) => setForm((f) => ({ ...f, safetyRulesText: e.target.value }))}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
              </section>

              <section className="decl-panel">
                <div className="decl-panel-title">4 · ההצהרה וכתב הוויתור</div>
                <div className="form-group">
                  <label className="form-label">תקציר בשפה פשוטה — „מה זה בעצם?”</label>
                  <div className="decl-panel-note">
                    זה מה שההורה קורא בפועל. הנוסח המשפטי המלא נפתח מאחוריו בלחיצה.
                    שורה לכל נקודה. ריק — יוצג נוסח ברירת מחדל.
                  </div>
                  <textarea
                    className="textarea"
                    rows={6}
                    value={form.waiverSummary}
                    onChange={(e) => setForm((f) => ({ ...f, waiverSummary: e.target.value }))}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">טקסט כתב ויתור / הסרת אחריות *</label>
                  <div className="decl-panel-note">
                    הנוסח המחייב. נשמר בהצהרה החתומה ובקובץ ה-PDF.
                    השורה הראשונה משמשת ככותרת המסמך.
                  </div>
                  <textarea
                    required
                    className="textarea"
                    rows={10}
                    value={form.waiverText}
                    onChange={(e) => setForm((f) => ({ ...f, waiverText: e.target.value }))}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              </section>
            </fieldset>

            {/* מה שהחותם יראה, דף אחרי דף, מהערכים שעל המסך הזה. */}
            <aside className="decl-preview">
              <div className="decl-preview-head">
                <span>תצוגה מקדימה</span>
                <span className="decl-preview-count">{previewPage + 1} / {PREVIEW_PAGES.length}</span>
              </div>
              <div className="decl-preview-tabs">
                {PREVIEW_PAGES.map((p, i) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`decl-preview-tab${i === previewPage ? ' is-active' : ''}`}
                    onClick={() => setPreviewPage(i)}
                  >
                    {p.short}
                  </button>
                ))}
              </div>
              <div className="decl-preview-screen">
                {form.coverImage && previewPage === 0 && (
                  <div className="decl-preview-cover"><img src={form.coverImage} alt="" /></div>
                )}
                <div className="decl-preview-activity">{form.headline || 'טיפוס בקיר בועז'}</div>
                <div className="decl-preview-title">{PREVIEW_PAGES[previewPage].title}</div>

                {previewPage === 0 && (
                  <>
                    <p className="decl-preview-lead">
                      תשובה „כן” לא מונעת השתתפות. היא רק מאפשרת לצוות לדעת ולהיערך.
                    </p>
                    {medicalQuestions.map((q) => (
                      <div key={q.id} className="decl-preview-q">
                        <div>{questionLabel(q)}</div>
                        <div className="decl-preview-yesno"><span>כן</span><span>לא</span></div>
                      </div>
                    ))}
                  </>
                )}

                {previewPage === 1 && (
                  <div className="decl-preview-prose">
                    {(form.activityNature || '').trim()
                      || 'ריק — הטופס יציג את נוסח ברירת המחדל של המערכת.'}
                  </div>
                )}

                {previewPage === 2 && (
                  previewSafetyRules.length ? previewSafetyRules.map((q) => (
                    <label key={q.id} className="decl-preview-check">
                      <input type="checkbox" disabled />
                      <span>
                        {questionLabel(q)}
                        {isChildOnlyQuestion(q) && <em> · להורה בלבד</em>}
                      </span>
                    </label>
                  )) : <div className="decl-preview-empty">אין סעיפי בטיחות</div>
                )}

                {previewPage === 3 && (
                  <>
                    {(form.waiverSummary || '').trim() && (
                      <div className="decl-preview-prose">{form.waiverSummary}</div>
                    )}
                    <div className="decl-preview-legal">
                      {(form.waiverText || '').trim() || 'טרם הוזן נוסח.'}
                    </div>
                    <div className="decl-preview-sign">חתימה דיגיטלית</div>
                  </>
                )}
              </div>
            </aside>
          </div>

          {confirmSave && (
            <div className="decl-confirm">
              <div className="decl-confirm-title">
                <AlertCircle size={15} /> לשמור את הנוסח החדש?
              </div>
              <div className="decl-confirm-body">
                מרגע השמירה, כל מי שפותח את {publicUrl(form.slug, form.isDefault)} ממלא את הנוסח הזה.
                הצהרות שכבר נחתמו והקבצים שלהן נשארים כפי שהם.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {!locked && (
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'שומר...' : (confirmSave ? 'כן, לשמור ולפרסם' : 'שמור הצהרה')}
              </button>
            )}
            {confirmSave && !saving && (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmSave(false)}>
                חזרה לעריכה
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { setEditing(null); setUnlocked(false); setConfirmSave(false); }}
            >
              {locked ? 'סגירה' : 'ביטול'}
            </button>
            {form.slug && (
              <a
                href={publicUrl(form.slug, form.isDefault)}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
              >
                <Link2 size={14} /> פתיחת הטופס החי
              </a>
            )}
          </div>
        </form>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="crm-table">
            <thead>
              <tr>
                <th>כותרת</th>
                <th>סוג</th>
                <th>קישור</th>
                <th>סטטוס</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-3)', textAlign: 'center', padding: 24 }}>
                    אין תבניות עדיין — צרו תבנית חדשה או המתינו לטעינה מ־Supabase
                  </td>
                </tr>
              )}
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 700 }}>
                    {t.title}
                    {t.isDefault && <span className="badge badge-green" style={{ marginRight: 8 }}>ברירת מחדל</span>}
                  </td>
                  <td style={{ color: 'var(--text-2)' }}>
                    {(() => {
                      // אותו אייקון שמופיע בתיק הלקוח וברשימת הלידים.
                      const kind = templateKind(t);
                      const types = t.activityTypes || (t.activityType ? [t.activityType] : []);
                      const label = types
                        .map((v) => activityTypeOptions.find((a) => a.value === v)?.label || v)
                        .join(' · ') || 'ללא שיוך';
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <kind.Icon size={13} style={{ color: kind.color, flexShrink: 0 }} />
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  <td dir="ltr" style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'left' }}>
                    /register{t.isDefault ? '' : `/${t.slug}`}
                  </td>
                  <td>
                    <span className={`badge ${t.isActive !== false ? 'badge-green' : 'badge-red'}`}>
                      {t.isActive !== false ? 'פעיל' : 'כבוי'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyLink(t)} title="העתק קישור">
                        <Copy size={13} />
                      </button>
                      <a
                        href={publicUrl(t.slug, t.isDefault)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost btn-sm"
                        title="פתח"
                      >
                        <Link2 size={13} />
                      </a>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(t)}>ערוך</button>
                      {!t.isDefault && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDelete(t)}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const HEALTH_QUESTIONS = [
  { id: 'q1', question: 'האם הילד/ה סובל/ת ממצב לבבי, כלייתי, ריאתי, נוירולוגי, מחלות עצמות, פרקים, שרירים?', critical: true },
  { id: 'q2', question: 'האם הילד/ה סובל/ת מלחץ דם גבוה, סוכרת, אנמיה, אסטמה, אפילפסיה?', critical: true },
  { id: 'q3', question: 'האם הילד/ה עבר/ה ניתוח בשלוש השנים האחרונות?', critical: true },
  { id: 'q4', question: 'האם ישנה המלצת רופא להגבלה בפעילות גופנית?', critical: true },
  { id: 'q5', question: 'האם הילד/ה נוטל/ת תרופות קבועות?', critical: false },
  { id: 'q6', question: 'האם הילד/ה חווה כאבים, עייפות חריגה, או קושי בנשימה במאמץ פיזי?', critical: false },
  { id: 'q7', question: 'האם ישנה רגישות לחגורות או ציוד מתכת?', critical: false },
];

const INITIAL_DECLARATIONS = [
  {
    id: 'd1', parentId: 'p1', studentName: 'עומרי לוי',
    signed: true, signedDate: '2026-07-01', signedBy: 'מיכל לוי',
    answers: { q1: false, q2: false, q3: false, q4: false, q5: false, q6: false, q7: false },
    notes: '', emergencyPhone: '052-1234567',
  },
  {
    id: 'd2', parentId: 'p2', studentName: 'רוני כהן',
    signed: true, signedDate: '2026-07-07', signedBy: 'דוד כהן',
    answers: { q1: false, q2: false, q3: false, q4: false, q5: true, q6: false, q7: false },
    notes: 'נוטל ריטלין — מינון 10 מ"ג בוקר', emergencyPhone: '054-9876543',
  }
];

function DeclarationDetail({ decl, parent, onClose }) {
  const hasAlerts = Object.values(decl.answers || {}).some(v => v);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, height: '100vh', width: '420px',
      background: '#0D1117', borderRight: '1px solid var(--border)',
      zIndex: 300, display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: '#0D1117', zIndex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              הצהרת בריאות — {decl.studentName || decl.climberName || 'ללא שם'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              נחתמה על ידי {decl.signedBy || decl.parentName || '—'} · {decl.signedDate || decl.date || '—'}
              {decl.templateSlug ? ` · ${decl.templateSlug}` : ''}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}>✕</button>
        </div>
        {hasAlerts ? (
          <div className="alert alert-warn" style={{ marginTop: 12 }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <strong>שים לב: יש הסתייגויות רפואיות!</strong>
          </div>
        ) : (
          <div className="alert alert-success" style={{ marginTop: 12 }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <strong>הצהרה תקינה — ללא הסתייגויות רפואיות</strong>
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ marginTop: 12, width: '100%' }}
          disabled={downloadingPdf}
          onClick={async () => {
            setDownloadingPdf(true);
            try {
              await downloadHealthDeclarationPdf(decl);
            } catch (err) {
              console.error(err);
              alert('שגיאה בהורדת ה־PDF');
            } finally {
              setDownloadingPdf(false);
            }
          }}
        >
          <Download size={14} /> {downloadingPdf ? 'מכין PDF...' : 'הורד אישור חתום (PDF)'}
        </button>
      </div>

      <div style={{ padding: 20 }}>
        <div className="section-header"><div className="section-title">איש קשר לחירום</div></div>
        <div className="card card-p" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{decl.signedBy}</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
            📞 {decl.emergencyPhone || decl.phone || parent?.phone || '—'}
          </div>
        </div>

        <div className="section-header"><div className="section-title">תשובות הצהרת הבריאות</div></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {(Object.keys(decl.answers || {}).length
            ? Object.keys(decl.answers).map((id) => ({
                id,
                question: HEALTH_QUESTIONS.find((q) => q.id === id)?.question || id,
              }))
            : HEALTH_QUESTIONS
          ).map(q => {
            const answer = decl.answers?.[q.id];
            return (
              <div key={q.id} style={{
                padding: '10px 14px', borderRadius: 8,
                background: answer ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${answer ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{answer ? '⚠️' : '✓'}</span>
                <div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: answer ? '#FCA5A5' : 'var(--text-2)' }}>
                    {q.question}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, color: answer ? 'var(--red)' : 'var(--green)' }}>
                    {answer ? 'כן' : 'לא'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {(decl.signature_url || decl.signature) && (
          <>
            <div className="section-header"><div className="section-title">חתימה דיגיטלית</div></div>
            <div className="card card-p" style={{ marginBottom: 16, textAlign: 'center' }}>
              <img
                src={decl.signature_url || decl.signature}
                alt="חתימה"
                style={{ maxWidth: '100%', maxHeight: 120, background: '#0b1220', borderRadius: 8 }}
              />
            </div>
          </>
        )}

        {decl.notes && (
          <>
            <div className="section-header"><div className="section-title">הערות רפואיות</div></div>
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>{decl.notes}</div>
          </>
        )}
      </div>
    </div>
  );
}

function FillDeclarationForm({ onSubmit, onCancel }) {
  const [parentName, setParentName]       = useState('');
  const [studentName, setStudentName]     = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [answers, setAnswers]             = useState({});
  const [notes, setNotes]                 = useState('');
  const [agreed, setAgreed]               = useState(false);
  const [step, setStep]                   = useState(1);

  const setAnswer = (id, val) => setAnswers(prev => ({ ...prev, [id]: val }));
  const hasYes = Object.values(answers).some(v => v);

  const handleSubmit = () => {
    if (!agreed) return;
    onSubmit({ parentName, studentName, emergencyPhone, answers, notes });
  };

  return (
    <div className="card card-p" style={{ maxWidth: 600, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {['פרטי הורה וילד', 'שאלות רפואיות', 'חתימה ואישור'].map((s, i) => (
          <div key={i} style={{
            flex: 1, padding: '10px 4px', textAlign: 'center', fontSize: 12, fontWeight: step === i + 1 ? 700 : 400,
            background: step === i + 1 ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.02)',
            color: step === i + 1 ? '#A5B4FC' : 'var(--text-3)',
            borderRight: i < 2 ? '1px solid var(--border)' : 'none',
            cursor: 'pointer',
          }} onClick={() => setStep(i + 1)}>
            {i + 1}. {s}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="form-grid" style={{ gap: 14 }}>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">שם ההורה *</label>
              <input className="input" required placeholder="מיכל לוי" value={parentName} onChange={e => setParentName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">שם הילד/ה *</label>
              <input className="input" required placeholder="עומרי לוי" value={studentName} onChange={e => setStudentName(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">טלפון לחירום</label>
            <input className="input" type="tel" placeholder="052-1234567" value={emergencyPhone} onChange={e => setEmergencyPhone(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!parentName || !studentName}>
            המשך לשאלות רפואיות ←
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <Shield size={16} style={{ flexShrink: 0 }} />
            ענה על כל השאלות בכנות. המידע משמש לבטיחות הילד/ה בלבד.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {HEALTH_QUESTIONS.map(q => (
              <div key={q.id} style={{
                padding: '12px 16px', borderRadius: 10,
                background: answers[q.id] ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${answers[q.id] ? 'rgba(239,68,68,0.25)' : 'var(--border)'}`,
              }}>
                <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10, display: 'flex', gap: 8 }}>
                  {q.critical && <span style={{ color: 'var(--red)', fontSize: 16, flexShrink: 0 }}>*</span>}
                  {q.question}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className={`btn btn-sm ${answers[q.id] === false ? 'btn-success' : 'btn-ghost'}`}
                    onClick={() => setAnswer(q.id, false)}>
                    לא
                  </button>
                  <button
                    className={`btn btn-sm ${answers[q.id] === true ? 'btn-danger' : 'btn-ghost'}`}
                    onClick={() => setAnswer(q.id, true)}>
                    כן
                  </button>
                </div>
              </div>
            ))}
          </div>

          {hasYes && (
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label">פרט על הסתייגויות שענית "כן" *</label>
              <textarea className="input textarea" rows={3} placeholder="פרט את המצב הרפואי, תרופות ומינונים..."
                value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← חזור</button>
            <button className="btn btn-primary"
              disabled={HEALTH_QUESTIONS.some(q => answers[q.id] === undefined) || (hasYes && !notes.trim())}
              onClick={() => setStep(3)}>
              המשך לחתימה ←
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          {hasYes && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <div>
                <strong>שים לב — ישנן הסתייגויות רפואיות.</strong>
              </div>
            </div>
          )}

          <div className="card card-p" style={{ marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-2)' }}>
              אני, <strong>{parentName}</strong>, מצהיר/ה בזאת כי המידע שמסרתי לעיל אמין ומדויק.
              הנני מסכים/ה לתנאי האחריות ולנהלי הבטיחות של קיר הטיפוס.
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 16 }}>
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2 }} />
              <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
                אני מאשר/ת את הצהרת הבריאות וקראתי את תנאי השימוש ונהלי הבטיחות.
              </span>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>← חזור</button>
            <button className="btn btn-primary" disabled={!agreed} onClick={handleSubmit}>
              <CheckCircle2 size={16} /> אשר וחתום דיגיטלית
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HealthDeclarations({ parents, students, canManageTemplates = false }) {
  const [declarations, setDeclarations] = useState([]);
  const [view, setView]                 = useState(canManageTemplates ? 'templates' : 'list'); // templates | list | new
  const [selectedDecl, setSelectedDecl] = useState(null);
  const [submitted, setSubmitted]       = useState(false);

  const refreshDeclarations = async () => {
    try {
      const data = await fetch('/api/health-declarations').then(r => r.ok ? r.json() : []);
      setDeclarations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setDeclarations([]);
    }
  };

  useEffect(() => {
    refreshDeclarations();
  }, []);

  const handleNewSubmit = async (data) => {
    const newDecl = {
      studentName: data.studentName,
      signed: true,
      signedDate: new Date().toISOString().split('T')[0],
      signedBy: data.parentName,
      answers: data.answers,
      notes: data.notes,
      emergencyPhone: data.emergencyPhone,
    };

    try {
      const response = await fetch('/api/health-declarations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDecl)
      });
      if (response.ok) {
        setSubmitted(true);
        setView('list');
        refreshDeclarations();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const signed   = declarations.filter(d => d.signed).length;
  const withAlerts = declarations.filter(d => Object.values(d.answers || {}).some(v => v)).length;

  return (
    <div className="fade-in">
      {selectedDecl && (
        <DeclarationDetail
          decl={selectedDecl}
          parent={parents?.find(p => p.id === selectedDecl.parentId)}
          onClose={() => setSelectedDecl(null)}
        />
      )}

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="card stat-card" style={{ '--stat-color': '#10B981' }}>
          <div className="stat-label">הצהרות חתומות</div>
          <div className="stat-value">{signed}</div>
          <div className="stat-sub up">✓ תקינות</div>
        </div>
        <div className="card stat-card" style={{ '--stat-color': '#EF4444' }}>
          <div className="stat-label">עם הסתייגויות רפואיות</div>
          <div className="stat-value">{withAlerts}</div>
          <div className="stat-sub warn">⚠️ דרושה תשומת לב</div>
        </div>
      </div>

      {/* Header */}
      <div className="section-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="section-title">הצהרות בריאות וטפסים</div>
          <div className="section-sub">עריכת הטקסט שנשלח ללקוחות · מעקב חתימות · הורדת PDF</div>
        </div>
        <div className="tab-bar tab-bar-inline">
          {canManageTemplates && (
            <button className={`tab-pill ${view === 'templates' ? 'active' : ''}`} onClick={() => { setView('templates'); setSubmitted(false); }}>
              <Link2 size={15} /> עריכת הצהרה שנשלחת
            </button>
          )}
          <button className={`tab-pill ${view === 'list' ? 'active' : ''}`} onClick={() => { setView('list'); setSubmitted(false); }}>
            <ClipboardCheck size={15} /> הצהרות חתומות
          </button>
          <button className={`tab-pill ${view === 'new' ? 'active' : ''}`} onClick={() => { setView('new'); setSubmitted(false); }}>
            <FileText size={15} /> מילוי ידני
          </button>
        </div>
      </div>

      {/* Success Banner */}
      {submitted && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <span>הצהרת הבריאות נחתמה ונשמרה בהצלחה! ✓</span>
        </div>
      )}

      {canManageTemplates && view === 'templates' && <FormTemplatesPanel />}

      {/* List View */}
      {view === 'list' && (
        <div className="card">
          <div className="table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>מתאמן</th>
                  <th>חתם</th>
                  <th>תאריך</th>
                  <th>הסתייגויות</th>
                  <th>הערות</th>
                </tr>
              </thead>
              <tbody>
                {declarations.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)', padding: 28 }}>
                      עדיין אין הצהרות חתומות
                    </td>
                  </tr>
                )}
                {declarations.map(d => {
                  const hasAlert = Object.values(d.answers || {}).some(v => v);
                  return (
                    <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedDecl(d)}>
                      <td style={{ fontWeight: 700 }}>{d.studentName || d.climberName || '—'}</td>
                      <td style={{ color: 'var(--text-2)' }}>{d.signedBy || d.parentName || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{d.signedDate || d.date || '—'}</td>
                      <td>
                        <span className={`badge ${hasAlert ? 'badge-red' : 'badge-green'}`}>
                          {hasAlert ? '⚠️ יש הסתייגויות' : '✓ תקין'}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 180 }}>
                        {d.notes || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Declaration Form */}
      {view === 'new' && (
        <FillDeclarationForm
          onSubmit={handleNewSubmit}
          onCancel={() => setView('list')}
        />
      )}
    </div>
  );
}
