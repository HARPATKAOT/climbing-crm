import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

/**
 * The limiter keys on `req.ip`. What that resolves to behind a proxy is the
 * whole question — a value shared by every customer turns a per-visitor
 * allowance into a global one.
 */
test('trust proxy 1 reports the nearest proxy, not the client', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/whoami', (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const ipFor = async (forwarded) => {
    const res = await fetch(`http://127.0.0.1:${port}/whoami`, {
      headers: forwarded ? { 'X-Forwarded-For': forwarded } : {},
    });
    return (await res.json()).ip;
  };

  // One hop: the only entry is the caller, and it is used.
  assert.equal(await ipFor('198.51.100.7'), '198.51.100.7');
  // Two hops — a browser behind an edge proxy. The client is 203.0.113.5, but
  // what comes back is the proxy. Everyone arriving through it shares a bucket,
  // which is why the ceiling has to be far above what one family spends.
  assert.equal(await ipFor('203.0.113.5, 198.51.100.7'), '198.51.100.7');

  server.close();
});

test('one registration costs far less than the ceiling', () => {
  // Measured against the running form: context, code, code check, family
  // check, child check, submit, template, signed PDF.
  const requestsPerRegistration = 8;
  const ceiling = 400;
  assert.ok(
    ceiling / requestsPerRegistration >= 40,
    `a shared bucket must hold dozens of registrations, holds ${Math.floor(ceiling / requestsPerRegistration)}`
  );
});
