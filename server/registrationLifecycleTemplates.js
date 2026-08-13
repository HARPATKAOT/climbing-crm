export const LIFECYCLE_TEMPLATE_NAMES = Object.freeze({
  parent_deadline_reminder: 'placement_parent_deadline_v1',
  centre_deadline_expired: 'placement_centre_expired_v1',
  waitlist_offer: 'placement_waitlist_offer_v1',
  intro_decision_prompt: 'intro_decision_followup_v1',
  intro_no_show_prompt: 'intro_no_show_followup_v1',
  legacy_hold_warning: 'placement_legacy_hold_warning_v1',
  other_waitlists_choice: 'placement_other_waitlists_choice_v1',
});

const DRAFTS = [
  {
    id: 'tpl-placement-parent-deadline-v1',
    kind: 'parent_deadline_reminder',
    body: 'תזכורת: השיבוץ של {{1}} שמור עד היום. כדי שלא יתבטל, השלימו הרשמה במתנ״ס ואשרו לנו שנרשמתם.',
  },
  {
    id: 'tpl-placement-centre-expired-v1',
    kind: 'centre_deadline_expired',
    body: 'לא התקבל בזמן אישור הרשמה מהמתנ״ס עבור {{1}}, ולכן המקום השתחרר. הצוות יבדוק את המשך הטיפול.',
  },
  {
    id: 'tpl-placement-waitlist-offer-v1',
    kind: 'waitlist_offer',
    body: 'התפנה מקום עבור {{1}}. המקום שמור ל־24 שעות — כתבו לנו אם תרצו להתקדם להרשמה.',
  },
  {
    id: 'tpl-intro-decision-followup-v1',
    kind: 'intro_decision_prompt',
    body: 'אימון ההיכרות של {{1}} הסתיים. כתבו לנו בתוך 24 שעות אם תרצו להמשיך בקבוצה.',
  },
  {
    id: 'tpl-intro-no-show-followup-v1',
    kind: 'intro_no_show_prompt',
    body: '{{1}} לא הגיע/ה לאימון ההיכרות. אפשר לשלם שוב למפגש הבא בתוך 24 שעות; לאחר מכן המקום ישתחרר.',
  },
  {
    id: 'tpl-placement-legacy-hold-warning-v1',
    kind: 'legacy_hold_warning',
    body: 'עדכון: המקום של {{1}} שמור לשלושה ימים. השלימו הרשמה במתנ״ס ואשרו לנו שנרשמתם כדי לשמור על השיבוץ.',
  },
  {
    id: 'tpl-placement-other-waitlists-choice-v1',
    kind: 'other_waitlists_choice',
    body: '{{1}} נרשם/ה לקבוצה. להשאיר אותו/ה גם ברשימות ההמתנה האחרות?',
  },
];

export function ensureRegistrationLifecycleTemplates({ db, persist } = {}) {
  if (!db) return [];
  const existing = db.get('message_templates') || [];
  const created = [];
  for (const draft of DRAFTS) {
    const name = LIFECYCLE_TEMPLATE_NAMES[draft.kind];
    if (existing.some((row) => row.id === draft.id || (row.meta_name || row.name) === name)) continue;
    const record = db.insert('message_templates', {
      id: draft.id,
      name,
      meta_name: name,
      language: 'he',
      category: 'UTILITY',
      status: 'DRAFT',
      usage: 'תהליך שמירת מקום, רשימת המתנה ואימון היכרות',
      body: draft.body,
      body_examples: ['נועם'],
      variables: [{ key: '1', field: 'child_name', label: 'שם המתאמן', example: 'נועם' }],
      buttons: [],
      active_for_send: false,
      archived: false,
      created_at: new Date().toISOString(),
    });
    created.push(record);
    if (typeof persist === 'function') Promise.resolve(persist('message_templates', record)).catch(() => {});
  }
  return created;
}

export function approvedLifecycleTemplate(db, kind) {
  const name = LIFECYCLE_TEMPLATE_NAMES[kind];
  if (!name) return null;
  const row = (db.get('message_templates') || []).find(
    (template) => (template.meta_name || template.name) === name && !template.archived
  );
  if (!row) return null;
  return String(row.status || '').toUpperCase() === 'APPROVED' || row.active_for_send ? row : null;
}
