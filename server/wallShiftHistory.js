/**
 * One operational record per wall shift. The raw facts live in four durable
 * collections; this read model joins them for the managers' shift screen.
 */

const WALL_TIME_ZONE = 'Asia/Jerusalem';

function israelParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WALL_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const valueOf = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}`,
    time: `${valueOf('hour')}:${valueOf('minute')}`,
  };
}

function isWallOpener(row) {
  if (!row || row.activity_type !== 'counter_shift') return false;
  return row.wall_role === 'opener'
    || !!row.wall_opened_at
    || String(row.notes || '').includes('משמרת קיר — מסוף כניסה');
}

function employeeName(byId, id, fallback = 'עובד') {
  return byId.get(id)?.name || fallback;
}

function inWindow(value, startMs, endMs) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= startMs && time < endMs;
}

function ledgerNote(ledger, sessionId, action) {
  return ledger.find((row) => row.session_id === sessionId && row.action_type === action)?.notes || '';
}

const CASH_MOVEMENT_LABELS = {
  fill: 'הוספת מזומן',
  empty: 'הוצאת מזומן',
  reset: 'איפוס קופה',
  sale_cash: 'מכירה במזומן',
  refund_cash: 'זיכוי במזומן',
};

function cashMovementRows(ledger, sessionId) {
  return ledger
    .filter((row) => row.session_id === sessionId && CASH_MOVEMENT_LABELS[row.action_type])
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map((row) => {
      const amount = Number(row.amount) || 0;
      const direction = row.action_type === 'reset'
        ? 'reset'
        : ['empty', 'refund_cash'].includes(row.action_type) ? 'out' : 'in';
      return {
        id: row.id,
        action_type: row.action_type,
        label: CASH_MOVEMENT_LABELS[row.action_type],
        amount,
        direction,
        balance_after: row.action_type === 'reset'
          ? (row.actual_after ?? amount)
          : (row.expected_after ?? null),
        performed_at: row.created_at || null,
        employee_id: row.employee_id || null,
        employee_name: row.employee_name || 'לא תועד',
        notes: row.notes || '',
      };
    });
}

export function buildWallShiftHistory({
  shiftHours = [],
  cashSessions = [],
  cashLedger = [],
  safetyInspections = [],
  employees = [],
  month = '',
} = {}) {
  const byId = new Map(employees.map((employee) => [employee.id, employee]));
  const openers = shiftHours.filter(isWallOpener)
    .filter((row) => row.clock_in)
    .sort((a, b) => new Date(a.clock_in) - new Date(b.clock_in));

  // Some legacy rows have the till/check a minute before the clock row. The
  // operating day is still unambiguous, so assign each fact to the closest
  // opener on that Israeli calendar date instead of leaking it to yesterday.
  const ownerOpener = (value) => {
    const factMs = new Date(value).getTime();
    if (!Number.isFinite(factMs)) return null;
    const factDate = israelParts(value).date;
    const sameDay = openers.filter((row) => israelParts(row.clock_in).date === factDate);
    if (sameDay.length > 0) {
      const alreadyStarted = sameDay.filter((row) => new Date(row.clock_in).getTime() <= factMs);
      return (alreadyStarted.length ? alreadyStarted[alreadyStarted.length - 1] : sameDay[0]);
    }
    return openers.find((row) => {
      const start = new Date(row.clock_in).getTime();
      const end = row.clock_out ? new Date(row.clock_out).getTime() + 2 * 60 * 60 * 1000 : start + 36 * 60 * 60 * 1000;
      return factMs >= start && factMs < end;
    }) || null;
  };

  const entries = openers.map((opener, index) => {
    const opened = israelParts(opener.clock_in);
    const startMs = new Date(opener.clock_in).getTime();
    const nextStart = openers[index + 1]?.clock_in
      ? new Date(openers[index + 1].clock_in).getTime()
      : null;
    const closedMs = opener.clock_out ? new Date(opener.clock_out).getTime() : null;
    const endMs = nextStart || (closedMs ? closedMs + 2 * 60 * 60 * 1000 : startMs + 36 * 60 * 60 * 1000);

    const staffRows = shiftHours.filter((row) => (
      row.activity_type === 'counter_shift'
      && row.clock_in
      && inWindow(row.clock_in, startMs, endMs)
    ));
    const staff = [...new Map(staffRows.map((row) => [row.employee_id, {
      employee_id: row.employee_id,
      name: employeeName(byId, row.employee_id),
      clock_in: row.clock_in,
      clock_out: row.clock_out || null,
    }])).values()];

    const cash = cashSessions
      .filter((session) => session.opened_at && ownerOpener(session.opened_at)?.id === opener.id)
      .sort((a, b) => new Date(a.opened_at) - new Date(b.opened_at))[0] || null;

    const inspections = safetyInspections
      .filter((inspection) => {
        const performedAt = inspection.performed_at || inspection.created_at;
        return performedAt && ownerOpener(performedAt)?.id === opener.id;
      })
      .sort((a, b) => new Date(a.performed_at || a.created_at) - new Date(b.performed_at || b.created_at))
      .map((inspection) => ({
        id: inspection.id,
        title: inspection.title || 'בדיקת בטיחות',
        performed_at: inspection.performed_at || inspection.created_at,
        tester_id: inspection.completed_by_employee_id || null,
        tester_name: inspection.tester_name
          || employeeName(byId, inspection.completed_by_employee_id, 'לא תועד'),
        status: inspection.status || 'לא תועד',
        notes: inspection.description || '',
      }));

    const closerId = opener.closed_by_employee_id || (opener.clock_out ? opener.employee_id : null);
    return {
      id: opener.id,
      date: opened.date,
      status: opener.clock_out ? 'closed' : 'open',
      opened_at: opener.clock_in,
      closed_at: opener.clock_out || null,
      opener: {
        employee_id: opener.employee_id,
        name: employeeName(byId, opener.employee_id),
      },
      closer: closerId ? {
        employee_id: closerId,
        name: employeeName(byId, closerId),
      } : null,
      place_orderly: typeof opener.place_orderly === 'boolean' ? opener.place_orderly : null,
      opening_note: opener.opening_note || '',
      closing_note: opener.wall_closing_note || '',
      close_checklist_confirmed: opener.wall_close_checklist_confirmed === true,
      staff,
      cash: cash ? {
        id: cash.id,
        status: cash.status || (cash.closed_at ? 'closed' : 'open'),
        opened_at: cash.opened_at,
        opened_by_id: cash.opened_by_id || null,
        opened_by_name: cash.opened_by_name || employeeName(byId, cash.opened_by_id),
        opening_notes: cash.opening_notes || ledgerNote(cashLedger, cash.id, 'open'),
        opening_amount: cash.opening_float
          ?? cashLedger.find((row) => row.session_id === cash.id && row.action_type === 'open')?.amount
          ?? null,
        closed_at: cash.closed_at || null,
        closed_by_id: cash.closed_by_id || null,
        closed_by_name: cash.closed_by_name || (cash.closed_by_id ? employeeName(byId, cash.closed_by_id) : ''),
        closing_notes: cash.closing_notes || ledgerNote(cashLedger, cash.id, 'close'),
        closing_amount: cash.closing_actual
          ?? cashLedger.find((row) => row.session_id === cash.id && row.action_type === 'close')?.actual_after
          ?? cashLedger.find((row) => row.session_id === cash.id && row.action_type === 'close')?.amount
          ?? null,
        expected_at_close: cash.expected_at_close ?? null,
        discrepancy: cash.discrepancy ?? null,
        movements: cashMovementRows(cashLedger, cash.id),
      } : null,
      safety: inspections,
    };
  });

  return entries
    .filter((entry) => !month || entry.date.startsWith(month))
    .sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)));
}

export default buildWallShiftHistory;
