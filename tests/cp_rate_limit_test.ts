/**
 * Regression test: the Channel Partner application rate limit cannot be bypassed with another spelling of the URL.
 *   npm run test:cp-ratelimit
 *
 * Self-contained: it runs the exact body-parser/rate-limit middleware that server.ts uses (src/server/cpGuard.ts) on a
 * temporary local server with a limit of 3. It does not read .env and never touches any database.
 */
import express, { Request, Response } from 'express';
import type { AddressInfo } from 'net';

process.env.CP_SUBMISSIONS_PER_HOUR = '3';

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`[PASS] ${name}`); }
  else { failed++; console.log(`[FAIL] ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
};

async function main() {
  const { cpAwareBodyParser, passedCpGuard, CP_SUBMIT_PATH, SUBMISSIONS_PER_HOUR } = await import('../src/server/cpGuard.js');
  check('0. Test limit is 3 submissions per hour', SUBMISSIONS_PER_HOUR === 3, SUBMISSIONS_PER_HOUR);

  // Same wiring as server.ts: one parser middleware for all requests, then the routes
  const app = express();
  app.use(cpAwareBodyParser(express.json({ limit: '2mb' })));
  app.post(CP_SUBMIT_PATH, (req: Request, res: Response) => (passedCpGuard(req) ? res.status(201).json({ ok: true }) : res.status(404).json({ error: 'Not found' })));
  app.get(CP_SUBMIT_PATH, (_req: Request, res: Response) => res.json({ ok: true }));
  app.post('/api/register', (req: Request, res: Response) => res.json({ received: Boolean(req.body?.name) }));
  app.use((err: any, _req: Request, res: Response, _next: unknown) => res.status(err?.status || 500).json({ error: err?.type || 'error' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown = { name: 'x' }) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(r => r.status);

  try {
    // Requests that do not count: GETs and other routes
    const gets = await Promise.all([1, 2, 3, 4, 5].map(() => fetch(base + CP_SUBMIT_PATH).then(r => r.status)));
    check('1. GET requests to the application URL are not counted', gets.every(s => s === 200), gets);

    // Three submissions, each with a different spelling, use up the shared limit
    const first = [await post('/api/cp/applications'), await post('/api/cp/applications/'), await post('/API/CP/APPLICATIONS')];
    check('2. Exact path, trailing slash and capitals all reach the guarded route and are counted together', first.every(s => s === 201), first);

    const variants = ['/api/cp/applications', '/api/cp/applications/', '/API/CP/APPLICATIONS', '/API/CP/APPLICATIONS/', '/Api/Cp/Applications',
      '/api/cp/applications//', '/api/CP/applications', '/api/cp/APPLICATIONS/'];
    const after = await Promise.all(variants.map(v => post(v)));
    check('3. Once the limit is reached, every spelling is refused with 429', after.every(s => s === 429), Object.fromEntries(variants.map((v, i) => [v, after[i]])));

    // Spellings Express does not route to the application handler cannot submit anything
    const others = await Promise.all(['/api/cp/%61pplications', '/api/cp/applications;x', '/api/cp/applicationsx'].map(v => post(v)));
    check('4. Encoded or altered paths never reach the application handler', others.every(s => s === 404), others);

    // Other routes are unaffected: not counted, not throttled, and keep their own 2 MB limit
    const register = await Promise.all([1, 2, 3, 4, 5, 6].map(() => post('/api/register')));
    check('5. Other API routes are not throttled by the CP limit', register.every(s => s === 200), register);
    const bigOther = await post('/api/register', JSON.stringify({ name: 'x', pad: 'y'.repeat(3 * 1024 * 1024) }));
    check('6. Other API routes keep their 2 MB body limit (413 above it)', bigOther === 413, bigOther);

    // The handler refuses any request that skipped the guard (defence in depth)
    const bare = express();
    bare.use(express.json());
    bare.post(CP_SUBMIT_PATH, (req: Request, res: Response) => (passedCpGuard(req) ? res.status(201).end() : res.status(404).end()));
    const bareServer = bare.listen(0, '127.0.0.1');
    await new Promise(r => bareServer.once('listening', r));
    const bareStatus = await fetch(`http://127.0.0.1:${(bareServer.address() as AddressInfo).port}${CP_SUBMIT_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status);
    bareServer.close();
    check('7. A submission that did not pass the rate limit is refused by the handler (404)', bareStatus === 404, bareStatus);
  } finally {
    server.close();
  }
  console.log(`\nCP rate-limit regression test: ${passed} Passed, ${failed} Failed.`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error('Test run aborted:', err); process.exit(1); });
