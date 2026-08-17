import { employeeIsWallStaff } from './employeeScope.js';

/**
 * Cash register: one physical drawer, accumulating float, daily sessions, ledger.
 * Mirrors the Notion "מעקב קופה" action types plus sale/refund lines.
 */

export const LEDGER_ACTIONS = {
  OPEN: 'open',
  CLOSE: 'close',
  FILL: 'fill',
  EMPTY: 'empty',
  RESET: 'reset',
  SALE_CASH: 'sale_cash',
  SALE_ONLINE: 'sale_online',
  REFUND_CASH: 'refund_cash',
  REFUND_ONLINE: 'refund_online',
};

/** Israeli notes and coins used in denomination counts. */
export const DENOMINATIONS = [
  { key: '200', value: 200, label: '200 ₪' },
  { key: '100', value: 100, label: '100 ₪' },
  { key: '50', value: 50, label: '50 ₪' },
  { key: '20', value: 20, label: '20 ₪' },
  { key: '10c', value: 10, label: '10 ₪' },
  { key: '5', value: 5, label: '5 ₪' },
  { key: '2', value: 2, label: '2 ₪' },
  { key: '1', value: 1, label: '1 ₪' },
  { key: '0.5', value: 0.5, label: '½ ₪' },
  { key: '0.1', value: 0.1, label: '10 אג׳' },
];

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function sumDenominations(denoms = {}) {
  let total = 0;
  for (const d of DENOMINATIONS) {
    const qty = Number(denoms[d.key]) || 0;
    if (qty > 0) total += qty * d.value;
  }
  return roundMoney(total);
}

function moneyEffect(actionType, amount) {
  const a = roundMoney(amount);
  switch (actionType) {
    case LEDGER_ACTIONS.SALE_CASH:
    case LEDGER_ACTIONS.FILL:
      return a;
    case LEDGER_ACTIONS.REFUND_CASH:
    case LEDGER_ACTIONS.EMPTY:
      return -a;
    default:
      return 0;
  }
}

/**
 * Running expected cash from float_basis + ledger money movements after a reset.
 * Reset / close-with-actual / open with count set a new basis via ledger rows
 * that carry `sets_basis: true` and `actual_after`.
 */
export function computeExpectedCash(store) {
  // Preserve insertion order when timestamps collide (same millisecond).
  const raw = store.get('cash_ledger') || [];
  const ledger = raw.map((row, index) => ({ row, index })).sort((a, b) => {
    const t = String(a.row.created_at || '').localeCompare(String(b.row.created_at || ''));
    if (t !== 0) return t;
    return a.index - b.index;
  });
  let expected = 0;
  for (const { row } of ledger) {
    if (row.sets_basis && row.actual_after != null) {
      expected = roundMoney(row.actual_after);
      continue;
    }
    expected = roundMoney(expected + moneyEffect(row.action_type, row.amount));
  }
  return expected;
}

export function getOpenSession(store) {
  const sessions = store.get('cash_register_sessions') || [];
  return sessions.find((s) => s.status === 'open') || null;
}

export function getLastClosedSession(store) {
  const sessions = [...(store.get('cash_register_sessions') || [])]
    .filter((s) => s.status === 'closed')
    .sort((a, b) => String(b.closed_at || b.created_at || '').localeCompare(String(a.closed_at || a.created_at || '')));
  return sessions[0] || null;
}

function actorFrom(reqUser = {}, body = {}) {
  return {
    employee_id: body.employee_id || reqUser.employee_id || null,
    employee_name:
      body.employee_name ||
      reqUser.name ||
      reqUser.email ||
      'צוות',
  };
}

/** דורש בחירה מפורשת של עובד מהטופס — לא מספיק המשתמש המחובר. */
function requireSignedActor(body = {}) {
  const name = String(body.employee_name || '').trim();
  const id = body.employee_id || null;
  if (!name) {
    throw new Error('יש לבחור מי מבצע את הפעולה');
  }
  return {
    employee_id: id,
    employee_name: name,
  };
}

/** פתיחה/סגירת קופה — רק מי שמסומן בתיק כמורשה. */
function requireCashOperator(store, body = {}) {
  const actor = requireSignedActor(body);
  if (!actor.employee_id) {
    throw new Error('יש לבחור עובד מורשה לפתיחה ולסגירה של קופה');
  }
  const emp = (store.get('employees') || []).find((e) => e.id === actor.employee_id);
  if (!emp || emp.is_active === false) {
    throw new Error('העובד לא נמצא או לא פעיל');
  }
  if (!employeeIsWallStaff(emp) || emp.can_operate_cash !== true) {
    throw new Error('העובד אינו מורשה לפתוח ולסגור קופה');
  }
  return {
    employee_id: emp.id,
    employee_name: emp.name || actor.employee_name,
  };
}

function insertLedger(store, row) {
  const now = new Date().toISOString();
  return store.insert('cash_ledger', {
    ...row,
    amount: roundMoney(row.amount || 0),
    created_at: row.created_at || now,
  });
}

export function sessionSnapshot(store) {
  const open = getOpenSession(store);
  const lastClosed = getLastClosedSession(store);
  const expected = computeExpectedCash(store);
  return {
    open,
    lastClosed,
    expected_cash: expected,
    can_sell_cash: !!open,
    suggested_opening: lastClosed?.closing_actual != null
      ? roundMoney(lastClosed.closing_actual)
      : expected,
  };
}

export function openSession(store, { denominations = {}, confirmSuggested = false, notes = '', reqUser, body } = {}) {
  if (getOpenSession(store)) {
    throw new Error('כבר יש משמרת פתוחה — סגרו אותה לפני פתיחה חדשה');
  }
  const actor = requireCashOperator(store, body || {});
  const snap = sessionSnapshot(store);
  const expectedBefore = computeExpectedCash(store);
  let openingFloat;
  let denoms = denominations;
  let setsBasis = false;

  if (confirmSuggested && Object.keys(denominations || {}).length === 0) {
    openingFloat = snap.suggested_opening;
  } else {
    openingFloat = sumDenominations(denominations);
    setsBasis = true;
  }

  const discrepancy = setsBasis ? roundMoney(openingFloat - expectedBefore) : null;

  const now = new Date().toISOString();
  const session = store.insert('cash_register_sessions', {
    status: 'open',
    opened_at: now,
    closed_at: null,
    opened_by_id: actor.employee_id,
    opened_by_name: actor.employee_name,
    closed_by_id: null,
    closed_by_name: null,
    opening_denominations: denoms,
    opening_float: openingFloat,
    closing_denominations: null,
    closing_actual: null,
    expected_at_close: null,
    discrepancy,
    cash_sales_total: 0,
    online_sales_total: 0,
    opening_notes: notes || '',
    closing_notes: '',
    notes: notes || '',
    created_at: now,
    updated_at: now,
  });

  insertLedger(store, {
    session_id: session.id,
    action_type: LEDGER_ACTIONS.OPEN,
    amount: openingFloat,
    tendered: null,
    change_given: null,
    // כמו איפוס: expected_after = מה שהיה אמור להיות לפני הספירה
    expected_after: expectedBefore,
    actual_after: setsBasis ? openingFloat : null,
    sets_basis: setsBasis,
    employee_id: actor.employee_id,
    employee_name: actor.employee_name,
    denominations: denoms,
    notes: notes || (confirmSuggested ? 'אישור יתרת יום קודם' : ''),
    discrepancy,
  });

  return {
    session: store.getOne('cash_register_sessions', session.id),
    expected_cash: computeExpectedCash(store),
    discrepancy,
  };
}

export function closeSession(store, { denominations = {}, notes = '', reqUser, body } = {}) {
  const open = getOpenSession(store);
  if (!open) throw new Error('אין משמרת פתוחה לסגירה');

  const actor = requireCashOperator(store, body || {});
  const expected = computeExpectedCash(store);
  const actual = sumDenominations(denominations);
  const discrepancy = roundMoney(actual - expected);
  const now = new Date().toISOString();

  const ledgerSinceOpen = (store.get('cash_ledger') || []).filter(
    (r) => r.session_id === open.id
  );
  const cashSales = roundMoney(
    ledgerSinceOpen
      .filter((r) => r.action_type === LEDGER_ACTIONS.SALE_CASH)
      .reduce((s, r) => s + (Number(r.amount) || 0), 0)
  );
  const onlineSales = roundMoney(
    ledgerSinceOpen
      .filter((r) => r.action_type === LEDGER_ACTIONS.SALE_ONLINE)
      .reduce((s, r) => s + (Number(r.amount) || 0), 0)
  );

  const updated = store.update('cash_register_sessions', open.id, {
    status: 'closed',
    closed_at: now,
    closed_by_id: actor.employee_id,
    closed_by_name: actor.employee_name,
    closing_denominations: denominations,
    closing_actual: actual,
    expected_at_close: expected,
    discrepancy,
    cash_sales_total: cashSales,
    online_sales_total: onlineSales,
    opening_notes: open.opening_notes || open.notes || '',
    closing_notes: notes || '',
    notes: notes || open.notes || '',
    updated_at: now,
  });

  // Closing sets the carried float basis to what was actually counted.
  insertLedger(store, {
    session_id: open.id,
    action_type: LEDGER_ACTIONS.CLOSE,
    amount: actual,
    expected_after: expected,
    actual_after: actual,
    sets_basis: true,
    employee_id: actor.employee_id,
    employee_name: actor.employee_name,
    denominations,
    notes: notes || '',
    discrepancy,
  });

  return {
    session: updated,
    expected,
    actual,
    discrepancy,
    summaryText: buildCloseSummaryText({
      closerName: actor.employee_name,
      expected,
      actual,
      discrepancy,
    }),
  };
}

export function buildCloseSummaryText({ closerName, expected, actual, discrepancy }) {
  const disc = roundMoney(discrepancy);
  let discLine;
  if (disc === 0) {
    discLine = 'הקופה מאוזנת — אין חריגה';
  } else if (disc < 0) {
    discLine = `יש בקופה חסר של ${Math.abs(disc)} שח`;
  } else {
    discLine = `יש בקופה עודף של ${disc} שח`;
  }
  return [
    'שלום מנהל,',
    `הקופה נסגרה על ידי ${closerName || 'צוות'}`,
    discLine,
    `אמור להיות בה ${roundMoney(expected)} שח`,
    `בפועל יש ${roundMoney(actual)}`,
    `סהכ מזומן בקופה כעת: ${roundMoney(actual)} שח`,
  ].join('\n');
}

export function adjustCash(store, { action, amount, denominations, notes = '', reqUser, body } = {}) {
  const type =
    action === 'fill' ? LEDGER_ACTIONS.FILL
      : action === 'empty' ? LEDGER_ACTIONS.EMPTY
        : action === 'reset' ? LEDGER_ACTIONS.RESET
          : null;
  if (!type) throw new Error('סוג פעולה לא תקין');

  const actor = requireSignedActor(body || {});
  const open = getOpenSession(store);
  let amt = roundMoney(amount);
  let denoms = denominations || {};

  if (type === LEDGER_ACTIONS.RESET || (denominations && Object.keys(denominations).length)) {
    const counted = sumDenominations(denoms);
    if (type === LEDGER_ACTIONS.RESET) {
      amt = counted;
      const expectedBefore = computeExpectedCash(store);
      const discrepancy = roundMoney(amt - expectedBefore);
      const row = insertLedger(store, {
        session_id: open?.id || null,
        action_type: LEDGER_ACTIONS.RESET,
        amount: amt,
        expected_after: expectedBefore,
        actual_after: amt,
        sets_basis: true,
        employee_id: actor.employee_id,
        employee_name: actor.employee_name,
        denominations: denoms,
        notes: notes || 'איפוס קופה',
        discrepancy,
      });
      return { entry: row, expected_cash: computeExpectedCash(store), discrepancy };
    }
    if (!amount && counted) amt = counted;
  }

  if (!(amt > 0) && type !== LEDGER_ACTIONS.RESET) {
    throw new Error('יש להזין סכום חיובי');
  }

  const before = computeExpectedCash(store);
  if (type === LEDGER_ACTIONS.EMPTY && amt > before + 0.001) {
    throw new Error(`לא ניתן לרוקן ${amt} שח — בקופה צפויים רק ${before} שח`);
  }

  const discrepancy = null;

  const row = insertLedger(store, {
    session_id: open?.id || null,
    action_type: type,
    amount: amt,
    expected_after: roundMoney(before + moneyEffect(type, amt)),
    actual_after: null,
    sets_basis: false,
    employee_id: actor.employee_id,
    employee_name: actor.employee_name,
    denominations: denoms,
    notes: notes || '',
    discrepancy,
  });

  return { entry: row, expected_cash: computeExpectedCash(store) };
}

export function recordSaleInLedger(store, {
  paymentMethod,
  total,
  tendered,
  changeGiven,
  saleId,
  sessionId,
  reqUser,
} = {}) {
  const method = String(paymentMethod || '').toLowerCase();
  // אשראי במסוף אינו נוגע במגירה, ולכן הוא נרשם כמו סליקה בקישור: מופיע ביומן
  // המשמרת לביקורת, ואינו משנה את המזומן הצפוי. עד כאן הוא לא נרשם כלל, ומכירה
  // שלמה נעלמה מיומן הקופה.
  const action =
    method === 'cash' ? LEDGER_ACTIONS.SALE_CASH
      : ['online', 'emv', 'credit', 'cc', 'card'].includes(method) ? LEDGER_ACTIONS.SALE_ONLINE
        : null;
  if (!action) return null;

  const existing = (store.get('cash_ledger') || []).find((row) => (
    row.action_type === action
    && saleId
    && String(row.pos_sale_id || '') === String(saleId)
  ));
  if (existing) return existing;

  const open = getOpenSession(store);
  const actor = actorFrom(reqUser, {});
  const before = computeExpectedCash(store);
  const amt = roundMoney(total);
  return insertLedger(store, {
    session_id: sessionId || open?.id || null,
    action_type: action,
    amount: amt,
    tendered: method === 'cash' ? roundMoney(tendered) : null,
    change_given: method === 'cash' ? roundMoney(changeGiven) : null,
    expected_after: method === 'cash' ? roundMoney(before + amt) : null,
    pos_sale_id: saleId || null,
    employee_id: actor.employee_id,
    employee_name: actor.employee_name,
    notes: '',
  });
}

/**
 * רישום זיכוי ביומן הקופה. בזיכוי מזומן הכסף יוצא פיזית מהמגירה ולכן הוא
 * מקטין את הסכום הצפוי; זיכוי אונליין נרשם לביקורת אך אינו משנה את המזומן.
 * מזהה המכירה הופך את הפעולה לאידמפוטנטית גם אם תשובת הסליקה נשלחת שוב.
 */
export function recordRefundInLedger(store, {
  paymentMethod,
  total,
  saleId,
  sessionId,
  reqUser,
} = {}) {
  const method = String(paymentMethod || '').toLowerCase();
  const action = method === 'cash' ? LEDGER_ACTIONS.REFUND_CASH : LEDGER_ACTIONS.REFUND_ONLINE;
  const existing = (store.get('cash_ledger') || []).find((row) => (
    row.action_type === action
    && saleId
    && String(row.pos_sale_id || '') === String(saleId)
  ));
  if (existing) return existing;

  const open = getOpenSession(store);
  const actor = actorFrom(reqUser, {});
  const before = computeExpectedCash(store);
  const amount = roundMoney(total);
  return insertLedger(store, {
    session_id: sessionId || open?.id || null,
    action_type: action,
    amount,
    expected_after: method === 'cash' ? roundMoney(before - amount) : null,
    pos_sale_id: saleId || null,
    employee_id: actor.employee_id,
    employee_name: actor.employee_name,
    notes: '',
  });
}

export function listLedger(store, { type, from, to, limit = 200 } = {}) {
  const all = enrichLedgerRunning([...(store.get('cash_ledger') || [])]);
  let rows = all;
  if (type && type !== 'all') {
    const types = String(type).split(',').map((t) => t.trim()).filter(Boolean);
    rows = rows.filter((r) => types.includes(r.action_type));
  }
  if (from) {
    rows = rows.filter((r) => String(r.created_at || '').slice(0, 10) >= from);
  }
  if (to) {
    rows = rows.filter((r) => String(r.created_at || '').slice(0, 10) <= to);
  }
  rows.sort((a, b) => {
    const t = String(b.created_at || '').localeCompare(String(a.created_at || ''));
    if (t !== 0) return t;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
  return rows.slice(0, Math.min(500, Math.max(1, Number(limit) || 200)));
}

/**
 * מחשב לכל שורה:
 * - שינוי בחריגה: כמה החריגה זזה בפעולה הזו
 * - חריגה מצטברת: סה״כ חריגה אחרי הפעולה (= מה שעדיין «תלוי» לקראת פתיחה/סגירה הבאות)
 * - פתיחה/סגירה: השינוי = נספר − אמור להיות; המצטברת מתחילה מחדש לפי הספירה הזו
 * - איפוס: מאפס מצטברת (מקבל את הספירה)
 * - מילוי: בלי שינוי חריגה
 * - ריקון: שינוי שלילי בגובה הסכום שרוקן
 */
export function enrichLedgerRunning(rows) {
  const indexed = (Array.isArray(rows) ? rows : []).map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    const t = String(a.row.created_at || '').localeCompare(String(b.row.created_at || ''));
    if (t !== 0) return t;
    return a.index - b.index;
  });

  let expected = 0;
  let runningDisc = 0;
  return indexed.map(({ row }) => {
    const type = row.action_type;
    const amt = roundMoney(row.amount);
    let movement = amt;
    let shouldBe = expected;
    let gapChange = null;

    if (type === LEDGER_ACTIONS.RESET) {
      const counted =
        row.actual_after != null && row.actual_after !== ''
          ? roundMoney(row.actual_after)
          : amt;
      movement = counted;
      shouldBe = counted;
      gapChange = runningDisc === 0 ? null : roundMoney(-runningDisc);
      runningDisc = 0;
      expected = counted;
    } else if (type === LEDGER_ACTIONS.OPEN || type === LEDGER_ACTIONS.CLOSE) {
      const counted =
        row.actual_after != null && row.actual_after !== ''
          ? roundMoney(row.actual_after)
          : amt;
      if (type === LEDGER_ACTIONS.OPEN && row.sets_basis === false) {
        movement = 0;
        shouldBe = expected;
        gapChange = null;
      } else {
        movement = counted;
        shouldBe = expected;
        gapChange = roundMoney(counted - expected);
        runningDisc = gapChange;
        expected = counted;
      }
    } else if (type === LEDGER_ACTIONS.FILL) {
      movement = amt;
      expected = roundMoney(expected + amt);
      shouldBe = expected;
      gapChange = null;
    } else if (type === LEDGER_ACTIONS.SALE_CASH) {
      movement = amt;
      expected = roundMoney(expected + amt);
      shouldBe = expected;
      gapChange = null;
    } else if (type === LEDGER_ACTIONS.EMPTY) {
      movement = roundMoney(-amt);
      expected = roundMoney(expected - amt);
      shouldBe = expected;
      gapChange = roundMoney(-amt);
      runningDisc = roundMoney(runningDisc + gapChange);
    } else if (type === LEDGER_ACTIONS.REFUND_CASH) {
      movement = roundMoney(-amt);
      expected = roundMoney(expected - amt);
      shouldBe = expected;
      gapChange = null;
    } else if (type === LEDGER_ACTIONS.SALE_ONLINE || type === LEDGER_ACTIONS.REFUND_ONLINE) {
      movement = 0;
      shouldBe = expected;
      gapChange = null;
    } else {
      shouldBe = expected;
      gapChange = null;
    }

    return {
      ...row,
      movement,
      should_be: shouldBe,
      gap_change: gapChange,
      gap_cumulative: runningDisc,
      // תאימות לאחור
      gap: runningDisc === 0 && gapChange == null ? null : runningDisc,
      discrepancy: gapChange,
    };
  });
}

export function actionTypeLabel(type) {
  const map = {
    open: 'פתיחה',
    close: 'סגירה',
    fill: 'מילוי',
    empty: 'ריקון',
    reset: 'איפוס',
    sale_cash: 'מכירת מזומן',
    sale_online: 'סליקה בקישור',
    refund_cash: 'זיכוי מזומן',
    refund_online: 'זיכוי סליקה',
  };
  return map[type] || type || '—';
}
