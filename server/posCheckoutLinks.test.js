import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POS_CHECKOUT_STATUS,
  buildPosCheckoutLink,
  checkoutItemsLabel,
  documentGaps,
  gapText,
  isPosCheckoutOpen,
  posCheckoutStatus,
  posCheckoutStatusLabel,
  wallAccessLines,
  wallParticipantIds,
} from './posCheckoutLinks.js';

const wallLine = (extra = {}) => ({
  name: 'כרטיסייה',
  quantity: 1,
  unitprice: 300,
  grants_wall_climbing: true,
  family_shared: false,
  ...extra,
});

test('only wall-granting, non-family lines need documents', () => {
  const lines = [
    wallLine(),
    wallLine({ name: 'מנוי משפחתי', family_shared: true }),
    { name: 'מגנזיום', quantity: 1, grants_wall_climbing: false },
  ];
  assert.deepEqual(wallAccessLines(lines).map((line) => line.name), ['כרטיסייה']);
});

test('a line without participants is for the chosen customer, once per unit', () => {
  assert.deepEqual(wallParticipantIds([wallLine({ quantity: 3 })], 'stu1'), ['stu1']);
  assert.deepEqual(
    wallParticipantIds([wallLine({ quantity: 2, participant_ids: ['stu1', 'stu2'] })], 'stu9'),
    ['stu1', 'stu2']
  );
});

test('the same person on two lines is listed once', () => {
  const lines = [
    wallLine({ participant_ids: ['stu1'] }),
    wallLine({ name: 'מנוי', participant_ids: ['stu1'] }),
  ];
  assert.deepEqual(wallParticipantIds(lines, 'stu1'), ['stu1']);
});

test('an eligible participant is not a gap; the rest name what they owe', () => {
  const eligibility = {
    ok: { eligible: true, health: { state: 'valid' }, waiver: { state: 'valid' } },
    stale: { eligible: false, health: { state: 'expired' }, waiver: { state: 'valid' } },
    fresh: { eligible: false, health: { state: 'missing' }, waiver: { state: 'missing' } },
  };
  const gaps = documentGaps({
    participantIds: ['ok', 'stale', 'fresh'],
    eligibilityOf: (id) => eligibility[id],
    nameOf: (id) => id.toUpperCase(),
  });
  assert.deepEqual(gaps.map((gap) => gap.student_id), ['stale', 'fresh']);
  assert.deepEqual(gaps[0].missing, ['health']);
  assert.equal(gapText(gaps[0]), 'הצהרת בריאות שפגה');
  assert.equal(gapText(gaps[1]), 'הצהרת בריאות · אישור טיפוס בקיר');
});

test('a medical hold is flagged, because a new form does not lift it', () => {
  const [gap] = documentGaps({
    participantIds: ['held'],
    eligibilityOf: () => ({ eligible: false, health: { state: 'blocked' }, waiver: { state: 'valid' } }),
    nameOf: () => 'דני',
  });
  assert.equal(gap.blocked, true);
  assert.equal(gapText(gap), 'קיימת חסימה רפואית — נדרש בירור מול הצוות');
});

test('a new link waits for documents and carries the cart, not the catalogue row', () => {
  const link = buildPosCheckoutLink({
    token: 'tok',
    lines: [wallLine({ item: { id: 'pl1', secret: true } })],
    total: 300,
    parentId: 'par1',
    studentId: 'stu1',
    gaps: [{ student_id: 'stu1', name: 'נועה', missing: ['health'] }],
  });
  assert.equal(link.id, 'tok');
  assert.equal(link.status, POS_CHECKOUT_STATUS.AWAITING_DOCUMENTS);
  assert.equal(link.items[0].item, undefined);
  assert.equal(link.sale_id, null);
  assert.deepEqual(link.participants, [{ student_id: 'stu1', name: 'נועה', missing: ['health'] }]);
});

test('an expired link is closed, but a paid one is judged by the payment', () => {
  const past = new Date('2026-01-01T00:00:00Z').toISOString();
  const stale = { status: POS_CHECKOUT_STATUS.AWAITING_DOCUMENTS, expires_at: past };
  assert.equal(posCheckoutStatus(stale), 'expired');
  assert.equal(isPosCheckoutOpen(stale), false);
  assert.equal(posCheckoutStatusLabel(stale), 'פג תוקף');

  const paid = { status: POS_CHECKOUT_STATUS.PAID, expires_at: past };
  assert.equal(posCheckoutStatus(paid), POS_CHECKOUT_STATUS.PAID);
  assert.equal(posCheckoutStatusLabel(paid), 'שולם');
});

test('a signed link is still open — the payment has not landed yet', () => {
  const link = buildPosCheckoutLink({ token: 't', lines: [], total: 1 });
  link.status = POS_CHECKOUT_STATUS.AWAITING_PAYMENT;
  assert.equal(isPosCheckoutOpen(link), true);
});

test('the items label groups repeats by name', () => {
  const link = { items: [wallLine(), wallLine(), wallLine({ name: 'מנוי' })] };
  assert.equal(checkoutItemsLabel(link), 'כרטיסייה (2), מנוי');
});
