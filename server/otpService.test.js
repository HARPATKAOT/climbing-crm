import test from 'node:test';
import assert from 'node:assert/strict';
import { createOtpService } from './otpService.js';

const PHONE = '972500000000';

function serviceAt() {
  let t = 1_000_000;
  const svc = createOtpService({ now: () => t });
  return { svc, tick: (ms) => { t += ms; } };
}

test('a code round-trips into a single-use token', () => {
  const { svc } = serviceAt();
  const { code } = svc.issueCode(PHONE);
  assert.match(code, /^\d{6}$/);
  const { token } = svc.verifyCode(PHONE, code);
  assert.ok(token);
  assert.equal(svc.consumeToken(token, PHONE), true);
  assert.equal(svc.consumeToken(token, PHONE), false, 'token is spent on first use');
});

test('checking a token does not spend it', () => {
  const { svc } = serviceAt();
  const { token } = svc.verifyCode(PHONE, svc.issueCode(PHONE).code);
  // A submission refused for a missing birth date must be fixable by sending
  // it again, not by verifying the phone from scratch.
  assert.equal(svc.checkToken(token, PHONE), true);
  assert.equal(svc.checkToken(token, PHONE), true);
  assert.equal(svc.consumeToken(token, PHONE), true);
  assert.equal(svc.checkToken(token, PHONE), false, 'spent once the form is filed');
});

test('a token survives a restart of the service', () => {
  // A deploy in the middle of someone's registration used to throw their
  // verification away. Derived from a secret the server already holds, the key
  // is the same on the other side of a restart, so the token still reads.
  const secret = 'stable-secret-for-this-test';
  const before = createOtpService({ secret });
  const { token } = before.verifyCode(PHONE, before.issueCode(PHONE).code);
  const afterRestart = createOtpService({ secret });
  assert.equal(afterRestart.checkToken(token, PHONE), true);
  assert.equal(afterRestart.checkToken(token, '972500000001'), false);
  assert.equal(createOtpService({ secret: 'other' }).checkToken(token, PHONE), false);
});

test('a tampered token is refused', () => {
  const { svc } = serviceAt();
  const { token } = svc.verifyCode(PHONE, svc.issueCode(PHONE).code);
  assert.equal(svc.checkToken(`${token}x`, PHONE), false);
  // Flip the last character to something it is not. Replacing it with a fixed
  // letter left the token untouched whenever it already ended in that letter —
  // about one run in seven hundred, which is a red suite for no reason.
  const last = token.slice(-1);
  const flipped = `${token.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
  assert.notEqual(flipped, token);
  assert.equal(svc.checkToken(flipped, PHONE), false);
  assert.equal(svc.checkToken('forged', PHONE), false);
});

test('a token is bound to its phone', () => {
  const { svc } = serviceAt();
  const { code } = svc.issueCode(PHONE);
  const { token } = svc.verifyCode(PHONE, code);
  assert.equal(svc.consumeToken(token, '972500000001'), false);
});

test('a wrong code fails and the right one still works within attempts', () => {
  const { svc } = serviceAt();
  const { code } = svc.issueCode(PHONE);
  assert.ok(svc.verifyCode(PHONE, '000001').error);
  assert.ok(svc.verifyCode(PHONE, code).token);
});

test('too many wrong guesses burn the code', () => {
  const { svc } = serviceAt();
  const { code } = svc.issueCode(PHONE);
  for (let i = 0; i < 5; i += 1) svc.verifyCode(PHONE, 'wrong');
  assert.ok(svc.verifyCode(PHONE, code).error, 'even the right code is refused');
});

test('a code expires after five minutes', () => {
  const { svc, tick } = serviceAt();
  const { code } = svc.issueCode(PHONE);
  tick(6 * 60 * 1000);
  assert.ok(svc.verifyCode(PHONE, code).error);
});

test('a used code cannot verify twice', () => {
  const { svc } = serviceAt();
  const { code } = svc.issueCode(PHONE);
  assert.ok(svc.verifyCode(PHONE, code).token);
  assert.ok(svc.verifyCode(PHONE, code).error);
});

test('resend has a cooldown, then a window cap', () => {
  const { svc, tick } = serviceAt();
  assert.ok(svc.issueCode(PHONE).code);
  assert.ok(svc.issueCode(PHONE).error, 'immediate resend refused');
  tick(46 * 1000);
  assert.ok(svc.issueCode(PHONE).code);
  tick(46 * 1000);
  assert.ok(svc.issueCode(PHONE).code);
  tick(46 * 1000);
  assert.ok(svc.issueCode(PHONE).code);
  tick(46 * 1000);
  assert.ok(svc.issueCode(PHONE).error, 'fifth send inside the window refused');
  tick(16 * 60 * 1000);
  assert.ok(svc.issueCode(PHONE).code, 'window reopens');
});

test('a newer code invalidates the older one', () => {
  const { svc, tick } = serviceAt();
  const first = svc.issueCode(PHONE).code;
  tick(60 * 1000);
  const second = svc.issueCode(PHONE).code;
  assert.ok(svc.verifyCode(PHONE, first).error);
  // the failed guess counts as an attempt, but the newer code still verifies
  assert.ok(svc.verifyCode(PHONE, second).token);
});
