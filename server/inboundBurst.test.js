import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InboundBurstCoordinator,
  burstTextForModel,
  combineInboundTexts,
  markInboundBurstForModel,
  normalizeInboundQuietMs,
} from './inboundBurst.js';

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    runLatest() {
      const row = [...pending.entries()].at(-1);
      if (!row) return false;
      pending.delete(row[0]);
      row[1].fn();
      return true;
    },
    pendingCount: () => pending.size,
    latestDelay: () => [...pending.values()].at(-1)?.ms,
  };
}

test('consecutive bubbles reset one timer and elect only the newest handler', async () => {
  const timers = fakeTimers();
  const bursts = new InboundBurstCoordinator(timers);

  const first = bursts.push('972500000000', { text: 'כן כן רוצה', messageId: '1' }, { quietMs: 7_000 });
  const second = bursts.push('972500000000', { text: 'פשוט יש לה מלא חוגים', messageId: '2' }, { quietMs: 7_000 });
  const third = bursts.push('972500000000', { text: 'אני מנסה רגע לסנכרן', messageId: '3' }, { quietMs: 7_000 });

  assert.equal(timers.pendingCount(), 1);
  assert.equal(timers.latestDelay(), 7_000);
  timers.runLatest();

  const results = await Promise.all([first, second, third]);
  assert.equal(results.filter((row) => row.leader).length, 1);
  assert.equal(results[0].superseded, true);
  assert.equal(results[1].superseded, true);
  assert.equal(results[2].leader, true);
  assert.equal(results[2].text, 'כן כן רוצה\nפשוט יש לה מלא חוגים\nאני מנסה רגע לסנכרן');
  assert.match(results[2].modelText, /השב פעם אחת/);
});

test('a bubble arriving while the model works makes the old generation stale', async () => {
  const timers = fakeTimers();
  const bursts = new InboundBurstCoordinator(timers);
  const first = bursts.push('contact', { text: 'הודעה ראשונה' }, { quietMs: 5_000 });
  timers.runLatest();
  const firstResult = await first;
  assert.equal(firstResult.leader, true);
  assert.equal(bursts.isCurrent('contact', firstResult.generation), true);

  const second = bursts.push('contact', { text: 'ועוד משהו' }, { quietMs: 5_000 });
  assert.equal(bursts.isCurrent('contact', firstResult.generation), false);
  timers.runLatest();
  assert.equal((await second).leader, true);
});

test('burst text stays ordered, trims blanks, and a single message stays untouched', () => {
  assert.equal(combineInboundTexts([{ text: '  א  ' }, { text: '' }, { text: 'ב' }]), 'א\nב');
  assert.equal(burstTextForModel([{ text: 'הודעה אחת' }]), 'הודעה אחת');
  assert.match(markInboundBurstForModel('א\nב', 2), /פנייה אחת/);
  assert.equal(normalizeInboundQuietMs('7000'), 7_000);
  assert.equal(normalizeInboundQuietMs(99_999), 30_000);
});
