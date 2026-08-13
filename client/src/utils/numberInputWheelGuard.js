/**
 * Native number inputs change their value when the pointer wheel is used while
 * they are focused. Releasing focus before the browser performs that default
 * action keeps the wheel available for ordinary page and option-list scrolling.
 */
export function releaseFocusedNumberInput(event, activeElement) {
  const target = event?.target;
  if (
    target?.tagName !== 'INPUT'
    || target.type !== 'number'
    || target !== activeElement
    || typeof target.blur !== 'function'
  ) {
    return false;
  }

  target.blur();
  return true;
}

export function installNumberInputWheelGuard(doc = document) {
  const handleWheel = (event) => {
    releaseFocusedNumberInput(event, doc.activeElement);
  };

  // Passive keeps the wheel's normal scrolling behavior intact. Capture runs
  // before the native number-input default action can increment the value.
  doc.addEventListener('wheel', handleWheel, { capture: true, passive: true });
  return () => doc.removeEventListener('wheel', handleWheel, true);
}
