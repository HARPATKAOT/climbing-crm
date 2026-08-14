/** A paid equipment row is a financial record and operational staff may not erase it. */
export function canClearPaidEquipmentStatus(currentStatus, nextStatus, hasFinanceAccess = false) {
  if (String(currentStatus || '') !== 'paid') return true;
  if (String(nextStatus || '') === 'paid') return true;
  return hasFinanceAccess;
}
