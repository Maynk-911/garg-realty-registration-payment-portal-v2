/**
 * Request-body handling regression test (body-parser GHSA-27r3-jxmh-p828 hardening) against a running server.
 *   npm run test:body-parsing
 *
 * Run only against a development/test server and database. For the signed-webhook checks, start the server with a
 * TEST-ONLY RAZORPAY_WEBHOOK_SECRET and pass the same value to this test as TEST_RAZORPAY_WEBHOOK_SECRET
 * (without it those checks are reported as skipped). The webhook events used refer to no real order.
 */
import crypto from 'crypto';
import http from 'http';
import zlib from 'zlib';

const BASE = new URL(process.env.TEST_BASE_URL || 'http://localhost:3000');
const SECRET = process.env.TEST_RAZORPAY_WEBHOOK_SECRET || '';

let passed = 0, failed = 0, skipped = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`[PASS] ${name}`); }
  else { failed++; console.log(`[FAIL] ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
};
const skip = (name: string, why: string) => { skipped++; console.log(`[SKIP] ${name} — ${why}`); };

// Raw HTTP so the exact bytes and headers are under the test's control
const send = (path: string, body: Buffer, headers: Record<string, string>) => new Promise<{ status: number; body: string }>(resolve => {
  const req = http.request({ host: BASE.hostname, port: BASE.port, path, method: 'POST', headers: { ...headers, 'Content-Length': String(body.length), Connection: 'close' } }, res => {
    let data = '';
    res.on('data', c => (data += c));
    res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
  });
  req.on('error', e => resolve({ status: -1, body: String((e as any).code) }));
  req.end(body);
});
const alive = async () => { try { return (await fetch(new URL('/api/projects', BASE))).status === 200; } catch { return false; } };
const sign = (raw: Buffer) => crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

async function main() {
  const json = Buffer.from(JSON.stringify({ hello: 'world' }));
  const form = Buffer.from('email=nobody%40example.com&password=not-the-password');

  // 1. Normal, uncompressed bodies are still read
  const formLogin = await send('/api/admin/login', form, { 'Content-Type': 'application/x-www-form-urlencoded' });
  check('1. Form-encoded body is parsed (login with wrong credentials -> 401, not "missing fields" 400)', formLogin.status === 401, formLogin);
  const jsonLogin = await send('/api/admin/login', Buffer.from(JSON.stringify({ email: 'nobody@example.com', password: 'not-the-password' })), { 'Content-Type': 'application/json' });
  check('2. JSON body is parsed (login with wrong credentials -> 401)', jsonLogin.status === 401, jsonLogin);
  const identity = await send('/api/admin/login', form, { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Encoding': 'identity' });
  check('3. "Content-Encoding: identity" (no compression) is still accepted', identity.status === 401, identity);

  // 2. Compressed bodies are refused cleanly on every body-reading path, and the attack cannot stop the server
  const paths: [string, string, Buffer][] = [
    ['/api/registration/submit', 'application/json', json],
    ['/api/payment/webhook', 'application/json', json],
    ['/api/cp/applications', 'application/json', json],
    ['/API/CP/APPLICATIONS/', 'application/json', json],
    ['/api/admin/login', 'application/x-www-form-urlencoded', form],
    ['/api/route-that-does-not-exist', 'application/json', json]
  ];
  const results: string[] = [];
  let all415 = true;
  for (const [path, type, raw] of paths) {
    for (const enc of ['gzip', 'deflate', 'br']) {
      const packed = enc === 'gzip' ? zlib.gzipSync(raw) : enc === 'deflate' ? zlib.deflateSync(raw) : zlib.brotliCompressSync(raw);
      const valid = await send(path, packed, { 'Content-Type': type, 'Content-Encoding': enc });
      const attack = await send(path, Buffer.concat([packed, Buffer.from('TRAILING-GARBAGE')]), { 'Content-Type': type, 'Content-Encoding': enc });
      if (valid.status !== 415 || attack.status !== 415) { all415 = false; results.push(`${path} ${enc}: ${valid.status}/${attack.status}`); }
    }
  }
  check('4. Compressed bodies (gzip/deflate/br, with and without trailing bytes) get 415 on every route', all415, results);
  await new Promise(r => setTimeout(r, 300));
  check('5. The server is still running after the GHSA-27r3-jxmh-p828 attack requests', await alive());

  // 3. Razorpay webhook signature verification still uses the exact raw bytes
  if (!SECRET) {
    for (const n of ['6', '7', '8']) skip(`${n}. Signed webhook check`, 'TEST_RAZORPAY_WEBHOOK_SECRET not set (server needs the same test-only secret)');
  } else {
    // Unusual but valid formatting: re-serialising the parsed object would change these bytes and break the signature
    const eventId = `evt_bodytest_${crypto.randomBytes(5).toString('hex')}`;
    const raw = Buffer.from(`{\n  "event_id" : "${eventId}",\n  "event": "payment.authorized",\n  "note": "caf\u00e9 \\u20b9",\n  "payload": {}\n}`);
    const ok = await send('/api/payment/webhook', raw, { 'Content-Type': 'application/json', 'x-razorpay-signature': sign(raw) });
    check('6. Correctly signed webhook with unusual formatting is accepted (raw bytes verified)', ok.status === 200, ok);
    const compact = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))).replace(eventId, `${eventId}_b`));
    const wrongSig = await send('/api/payment/webhook', compact, { 'Content-Type': 'application/json', 'x-razorpay-signature': sign(raw) });
    check('7. Signature over different bytes is rejected (401)', wrongSig.status === 401, wrongSig);
    const gz = zlib.gzipSync(raw);
    const gzSigned = await send('/api/payment/webhook', gz, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'x-razorpay-signature': sign(raw) });
    check('8. A compressed webhook is refused (415) before any processing', gzSigned.status === 415, gzSigned);
  }

  console.log(`\nBody-parsing test: ${passed} Passed, ${failed} Failed, ${skipped} Skipped.`);
  // Let open sockets close by themselves (an immediate process.exit can trip a libuv assertion on Windows)
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => { console.error('Test run aborted:', err); process.exitCode = 1; });
