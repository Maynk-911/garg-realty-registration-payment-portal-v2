/**
 * Automated End-to-End Validation Test Suite
 * Tests: form submission, booking token calculation, QR/UTR submission, Google Sheets append,
 * duplicate protection, Sheets failure handling, payment-status rules and admin access.
 *
 * Run against a server started with the local Google Sheets test double:
 *   npm run dev:mock-sheets        (terminal 1)
 *   npm run test:flow              (terminal 2)
 */

import '../src/server/loadEnv.js';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const SHEET_FILE = process.env.MOCK_SHEET_FILE || path.join(os.tmpdir(), 'garg-mock-sheet.json');
const FAIL_FILE = process.env.MOCK_SHEET_FAIL_FILE || path.join(os.tmpdir(), 'garg-mock-sheet.fail');
const SPREADSHEET_ID = '1uw77HSMk5smqdBipFmDlj3BikxqeB4T6zXZh_7Lex8I';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// The mock sheet file may be mid-write by the server's background sync; retry briefly on a partial read
const readSheet = (): { rows: (string | number)[][]; calls: string[] } => {
  for (let attempt = 0; ; attempt++) {
    try {
      return JSON.parse(fs.readFileSync(SHEET_FILE, 'utf8'));
    } catch (err) {
      if (attempt >= 20) throw err;
      const until = Date.now() + 25;
      while (Date.now() < until) { /* short synchronous wait */ }
    }
  }
};
const rowsFor = (bookingId: string) => readSheet().rows.filter(r => r[1] === bookingId);
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE_URL}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

// Unique per run so reruns never collide with earlier bookings
const run = Date.now().toString().slice(-7);
const phone = (n: number) => `9${run}${String(n).padStart(2, '0')}`;
const utr = (n: number) => `4${run}${String(n).padStart(4, '0')}`;

async function runTests() {
  console.log('--- Starting Garg Realty Portal Verification Suite ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  const register = async (n: number, overrides: Record<string, unknown> = {}) => {
    const res = await post('/api/registration/submit', {
      fullName: 'Vikram Malhotra',
      mobile: phone(n),
      email: `vikram.${run}.${n}@example.com`,
      city: 'Nainital',
      state: 'Uttarakhand',
      pincode: '263001',
      address: 'Villa 14, Mall Road',
      projectId: 'proj_pangot',
      selectedPlan: '7 L – Co-Own',
      numberOfUnits: 2,
      consent: true,
      declarationSigned: true,
      ...overrides
    });
    return { res, data: await res.json() };
  };

  try {
    if (!fs.existsSync(SHEET_FILE)) {
      throw new Error(`Mock sheet file not found (${SHEET_FILE}). Start the server with "npm run dev:mock-sheets".`);
    }
    fs.rmSync(FAIL_FILE, { force: true });

    // 1. Check Projects List (Strictly Pangot)
    const projRes = await fetch(`${BASE_URL}/api/projects`);
    const projData = await projRes.json();
    const pangotListed = projData.projects?.find((p: any) => p.id === 'proj_pangot');
    assert(projRes.ok && projData.projects.length === 2 && pangotListed?.booking_enabled && pangotListed.token_amount === 51000,
      '1. Projects endpoint lists Pangot (open, ₹51,000) and Dholera only');

    // 2. Validate Form Rejection on Empty/Invalid Input
    const badFormRes = await post('/api/registration/submit', { fullName: '', mobile: '123' });
    assert(badFormRes.status === 400, '2. Registration rejects invalid mobile / missing name');

    // 3. Submit valid registration
    const rowsBefore = readSheet().rows.length;
    const { res: regRes, data: reg } = await register(1);
    const bookingId: string = reg.registrationNumber;
    assert(regRes.ok && /^GRG-PNG-\d{8}-\d{4,}$/.test(bookingId), `3. Booking ID uses format GRG-PNG-YYYYMMDD-XXXX (${bookingId})`);
    assert(reg.order.amount === 102000, '4. Booking token: 2 units calculate 102,000 INR (51,000 per unit) on the server');

    const fetchRegData = await (await fetch(`${BASE_URL}/api/registration/${reg.registrationId}`)).json();
    assert(fetchRegData.registration.selected_plan === '7 L – Co-Own', '4a. Registration persists selected unit "7 L – Co-Own"');
    assert(fetchRegData.registration.units_count === 2, '4b. Registration persists units_count = 2');
    assert(readSheet().rows.length === rowsBefore, '4c. No spreadsheet row is written before the booking is completed');

    // 5. Final submission: UTR -> Google Sheets append -> confirmation
    const invalidUtrRes = await post('/api/payment/submit-qr-utr', { registrationId: reg.registrationId, utrNumber: '12' });
    assert(invalidUtrRes.status === 400, '5. Invalid UTR is rejected by the backend');

    const submitRes = await post('/api/payment/submit-qr-utr', { registrationId: reg.registrationId, utrNumber: utr(1) });
    const submit = await submitRes.json();
    assert(submitRes.ok && submit.status === 'PENDING' && submit.statusLabel === 'Payment Verification Pending', '5a. UTR submission succeeds with status "Payment Verification Pending" (never PAID)');
    assert(submit.message === 'Payment details submitted successfully. Verification is pending.' && !('ip_address' in submit.registration), '5a1. Clear success message; response carries no internal fields');

    // The optional Google Sheets mirror runs after the local save, so give it a moment
    await sleep(600);
    const sheet = readSheet();
    const myRows = rowsFor(bookingId);
    assert(sheet.rows.length === Math.max(rowsBefore, 1) + 1, '5b. Exactly one NEW ROW was appended to the spreadsheet');
    assert(
      sheet.rows[0].join('|') === 'Timestamp|Booking ID|Customer Name|Phone Number|Email|Project|Unit Type|Number of Units|Booking Token / Booking Amount|Payment Amount|UTR / Transaction ID|Payment Status',
      '5c. Header row holds exactly the 12 predefined columns'
    );
    const row = myRows[0] || [];
    assert(myRows.length === 1 && row.length === 12, '5d. Appended row has exactly 12 values');
    assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(row[0])), `5e. Server-generated timestamp in YYYY-MM-DD HH:mm:ss (${row[0]})`);
    assert(
      row[2] === 'Vikram Malhotra' && row[3] === `+91${phone(1)}` && row[5] === 'Pangot' && row[6] === '7 L – Co-Own' &&
      row[7] === 2 && row[8] === 102000 && row[9] === 102000 && row[10] === utr(1) && row[11] === 'Payment Verification Pending',
      '5f. Row stores customer, project, unit, units, amounts, UTR and "Payment Verification Pending"'
    );
    assert(sheet.calls.some(c => c.includes(`/v4/spreadsheets/${SPREADSHEET_ID}/values/'Sheet1'!A:L:append`)), '5g. Append targets the exact spreadsheet ID and tab "Sheet1"');
    assert(!sheet.calls.some(c => !c.includes(`/v4/spreadsheets/${SPREADSHEET_ID}/values/`)) && !sheet.calls.some(c => c.startsWith("POST /v4/spreadsheets ")), '5h. No call creates a spreadsheet or touches any other spreadsheet');

    // 6. Duplicate submission protection
    const dupRes = await post('/api/payment/submit-qr-utr', { registrationId: reg.registrationId, utrNumber: utr(1) });
    const dup = await dupRes.json();
    assert(dupRes.ok && dup.duplicate === true && rowsFor(bookingId).length === 1, '6. Repeating the same submission succeeds without a duplicate row');

    const otherUtrRes = await post('/api/payment/submit-qr-utr', { registrationId: reg.registrationId, utrNumber: utr(2) });
    assert(otherUtrRes.status === 409 && rowsFor(bookingId)[0][10] === utr(1), '6a. A different UTR for an already-recorded booking is refused and the row is untouched');

    const { data: reg2 } = await register(2);
    assert(reg2.registrationNumber !== bookingId, '6b. Every booking gets a unique Booking ID');
    const [c1, c2] = await Promise.all([
      post('/api/payment/submit-qr-utr', { registrationId: reg2.registrationId, utrNumber: utr(3) }),
      post('/api/payment/submit-qr-utr', { registrationId: reg2.registrationId, utrNumber: utr(3) })
    ]);
    await sleep(600);
    // Count only UTR submissions (the booking also has the order record created at registration)
    const reg2Payments = (await (await fetch(`${BASE_URL}/api/registration/${reg2.registrationId}`)).json()).payments
      .filter((p: any) => p.gateway === 'HDFC_SMARTHUB_QR');
    assert(
      [c1.status, c2.status].includes(200) && rowsFor(reg2.registrationNumber).length === 1 && reg2Payments.length === 1,
      `6c. Double click (two simultaneous requests: ${c1.status}/${c2.status}) saves one payment record and one row`
    );
    const reusedUtrRes = await post('/api/payment/submit-qr-utr', { registrationId: (await register(8)).data.registrationId, utrNumber: utr(1) });
    assert(reusedUtrRes.status === 409, '6d. A UTR already submitted for another booking is refused');

    // 7. Google Sheets is optional: an outage must not block the customer or lose the submission
    const { data: reg3 } = await register(3);
    fs.writeFileSync(FAIL_FILE, 'simulated outage');
    const failRes = await post('/api/payment/submit-qr-utr', { registrationId: reg3.registrationId, utrNumber: utr(4) });
    const failBody = await failRes.json();
    assert(failRes.ok && failBody.status === 'PENDING', '7. Google Sheets outage does not block the UTR submission');
    assert(!/google|sheet|credential|http 5/i.test(failBody.message || ''), '7a. Customer message mentions no technical or credential detail');
    await sleep(600);
    const afterFail = await (await fetch(`${BASE_URL}/api/registration/${reg3.registrationId}`)).json();
    assert(afterFail.registration.utr_number === utr(4) && afterFail.registration.payment_status === 'PENDING' && rowsFor(reg3.registrationNumber).length === 0,
      '7b. Submission is saved in the local database even though the sheet row could not be written');
    fs.rmSync(FAIL_FILE, { force: true });
    const retryRes = await post('/api/payment/submit-qr-utr', { registrationId: reg3.registrationId, utrNumber: utr(4) });
    assert(retryRes.ok && (await retryRes.json()).duplicate === true, '7c. Retrying the same UTR is recognised as a duplicate (no second record)');

    // 8. Nothing may mark a booking as verified without a real verification
    const verifyRes = await post('/api/payment/verify', {
      registrationId: reg.registrationId,
      razorpayOrderId: reg.order.orderId,
      razorpayPaymentId: 'pay_test_suite_123',
      razorpaySignature: 'sig_test_forged'
    });
    assert(verifyRes.status === 400, '8. Unverified gateway callback is rejected');
    const webhookRes = await post(
      '/api/payment/webhook',
      { id: `evt_test_${Date.now()}`, event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: reg.order.orderId, amount: 10000000 } } } },
      { 'x-razorpay-signature': 'forged_sig' }
    );
    assert(webhookRes.status === 401, '8a. Webhook with forged signature is rejected');
    assert(rowsFor(bookingId)[0][11] === 'Payment Verification Pending', '8b. Spreadsheet still says "Payment Verification Pending"');

    // 9. Admin access & accounts-desk verification
    const adminRes = await post('/api/admin/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    const adminData = await adminRes.json();
    assert(adminRes.ok && Boolean(adminData.token), '9. Admin authentication succeeds with signed token');
    const auth = { Authorization: `Bearer ${adminData.token}` };

    const unauthSheetsRes = await fetch(`${BASE_URL}/api/admin/google-sheets/status`);
    assert(unauthSheetsRes.status === 401, '9a. Customers cannot access Google Sheets status endpoints (401)');
    const sheetsStatus = await (await fetch(`${BASE_URL}/api/admin/google-sheets/status`, { headers: auth })).json();
    assert(sheetsStatus.spreadsheetId === SPREADSHEET_ID && sheetsStatus.sheetTab === 'Sheet1' && sheetsStatus.columnsCount === 12, '9b. Admin status shows the exact spreadsheet ID, tab "Sheet1" and 12 columns');

    const pendingView = (await (await fetch(`${BASE_URL}/api/registration/${reg.registrationId}`)).json()).registration;
    assert(pendingView.payment_status === 'PENDING' && !pendingView.payment_verified_at, '9b1. Before review the booking stays PENDING with the final receipt locked');
    const noAuthVerify = await post('/api/admin/verify-payment', { registrationId: reg.registrationId, verified: true });
    assert(noAuthVerify.status === 401, '9b2. Customers cannot approve a payment without an admin token (401)');
    const forgedToken = Buffer.from(JSON.stringify({ id: 'admin_1', email: process.env.ADMIN_EMAIL, role: 'SUPER_ADMIN', exp: Date.now() + 1e6 })).toString('base64') + '.' + 'a'.repeat(64);
    const forgedVerify = await post('/api/admin/verify-payment', { registrationId: reg.registrationId, verified: true }, { Authorization: `Bearer ${forgedToken}` });
    assert(forgedVerify.status === 401, '9b3. A forged admin token cannot approve a payment (401)');
    const patchPaid = await fetch(`${BASE_URL}/api/admin/registration/${reg.registrationId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ paymentStatus: 'PAID' }) });
    assert(patchPaid.status === 400, '9b4. Status editor cannot mark a booking PAID (no Mark Paid bypass)');
    const simRes = await post('/api/admin/webhook/simulate', { orderId: reg.order.id || 'order_x' }, auth);
    assert(process.env.ALLOW_SIMULATED_PAYMENTS === 'true' || simRes.status === 403, '9b5. Simulated gateway capture is disabled unless explicitly enabled for local testing');

    const rowCountBeforeVerify = readSheet().rows.length;
    const adminVerifyRes = await post('/api/admin/verify-payment', { registrationId: reg.registrationId, verified: true }, auth);
    const adminVerify = await adminVerifyRes.json();
    assert(adminVerifyRes.ok && adminVerify.registration.payment_status === 'PAID', '9c. Admin UTR verification marks the booking PAID');
    await new Promise(r => setTimeout(r, 500));
    assert(
      rowsFor(bookingId).length === 1 && rowsFor(bookingId)[0][11] === 'Payment Verified' && readSheet().rows.length === rowCountBeforeVerify,
      '9d. Admin verification updates that booking\'s own row to "Payment Verified" (no new row)'
    );

    const paidView = (await (await fetch(`${BASE_URL}/api/registration/${reg.registrationId}`)).json()).registration;
    assert(paidView.payment_status === 'PAID' && paidView.registration_status === 'CONFIRMED' && Boolean(paidView.payment_verified_at && paidView.payment_verified_by), '9e. Verified booking is CONFIRMED and its final receipt is unlocked');
    const reverify = await post('/api/admin/verify-payment', { registrationId: reg.registrationId, verified: false }, auth);
    assert(reverify.status === 409, '9f. An already verified payment cannot be reviewed again');

    // 10. Strict data control
    const invalidPlanRes = await post('/api/register', { fullName: 'Test Rejected Plan', email: `bad.${run}@example.com`, mobile: phone(9), selectedPlan: 'Plot 200 Sq. Yds', consent: true });
    assert(invalidPlanRes.status === 400, '10. Server rejects any unit not in the 4 allowed options');

    const { data: reg4 } = await register(4, { fullName: '=cmd|/c calc!John Doe', selectedPlan: 'Studio - Full Own', numberOfUnits: 1 });
    const inj = await post('/api/payment/submit-qr-utr', { registrationId: reg4.registrationId, utrNumber: utr(5) });
    const injData = await inj.json();
    assert(inj.ok && injData.sheetRecord['Customer Name'].startsWith("'="), '10a. Formula injection in Customer Name is neutralised before it reaches the sheet');
    assert(injData.registration.selected_plan === 'Studio – Full Own' && injData.registration.project_name === 'Pangot', '10b. Unit stored as one of the 4 options; project fixed to "Pangot"');
    const rejectRes = await post('/api/admin/verify-payment', { registrationId: reg4.registrationId, verified: false }, auth);
    const rejected = (await rejectRes.json()).registration;
    assert(rejectRes.ok && rejected.payment_status === 'FAILED' && !rejected.payment_verified_at, '10d. Admin Reject Payment marks the booking FAILED with no receipt');
    assert(
      Object.keys(injData.sheetRecord).length === 12 && !('ip_address' in injData.sheetRecord) && !JSON.stringify(readSheet().rows).includes('Mall Road'),
      '10c. Only the 12 predefined fields are sent to the sheet (no address, IP or browser data)'
    );

    // 11. CSV export
    const noAuthExport = await fetch(`${BASE_URL}/api/admin/export-csv`);
    assert(noAuthExport.status === 401, '11. CSV export without an admin token is rejected (401)');
    const exportRes = await fetch(`${BASE_URL}/api/admin/export-csv?search=${encodeURIComponent(bookingId)}&paymentStatus=all`, { headers: auth });
    // Decode manually: Response.text() would silently drop the BOM being checked
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await exportRes.arrayBuffer());
    const csvLines = csv.replace(/^﻿/, '').trim().split('\r\n');
    assert(
      exportRes.ok && /garg-realty-bookings-\d{4}-\d{2}-\d{2}\.csv/.test(exportRes.headers.get('content-disposition') || '') && csv.startsWith('﻿'),
      '11a. Export downloads garg-realty-bookings-YYYY-MM-DD.csv with a UTF-8 BOM'
    );
    assert(csvLines.length === 2 && csvLines[0].split(',').length === 21 && csvLines[1].includes(bookingId) && csvLines[1].includes('"Verified"'), '11b. Search filter exports exactly the matching booking with all 21 columns');
    assert(!/passwordHash|scrypt|ip_address|Bearer/i.test(csv), '11c. Export contains no credentials or internal fields');
    const failedExport = await (await fetch(`${BASE_URL}/api/admin/export-csv?paymentStatus=FAILED`, { headers: auth })).text();
    assert(failedExport.includes(reg4.registrationNumber) && !failedExport.includes(bookingId) && failedExport.includes('"Rejected"'), '11d. Payment-status filter is respected (FAILED export has the rejected booking, not the verified one)');
    const emptyExport = await fetch(`${BASE_URL}/api/admin/export-csv?search=no-such-booking-${run}`, { headers: auth });
    assert(emptyExport.status === 404, '11e. Export with no matching records returns a clear error instead of an empty file');
    const injectedRow = failedExport.split('\r\n').find(l => l.includes(reg4.registrationNumber)) || '';
    assert(injectedRow.includes(`"'=cmd`), '11f. Formula injection is neutralised in the CSV');

    // 12. Public lookup privacy
    const publicView = (await (await fetch(`${BASE_URL}/api/registration/${reg.registrationId}`)).json()).registration;
    assert(!('ip_address' in publicView) && !('user_agent' in publicView), '12. Public booking lookup does not reveal IP address or browser data');

    // 13. Logout ends the session server-side
    const logoutRes = await post('/api/admin/logout', {}, auth);
    const afterLogout = await fetch(`${BASE_URL}/api/admin/overview`, { headers: auth });
    assert(logoutRes.ok && afterLogout.status === 401, '13. After logout the old admin token is rejected');
    const badLogin = await post('/api/admin/login', { email: process.env.ADMIN_EMAIL, password: 'wrong-password-123456' });
    assert(badLogin.status === 401, '13a. Invalid admin credentials are rejected');
    const expiredPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(adminData.token.split('.')[0], 'base64').toString()), exp: Date.now() - 1000 })).toString('base64');
    const expiredToken = `${expiredPayload}.${crypto.createHmac('sha256', process.env.ADMIN_JWT_SECRET || '').update(expiredPayload).digest('hex')}`;
    const expiredRes = await fetch(`${BASE_URL}/api/admin/overview`, { headers: { Authorization: `Bearer ${expiredToken}` } });
    assert(expiredRes.status === 401, '13b. A correctly signed but expired admin token is rejected');

    console.log(`\nTest Run Complete: ${passed} Passed, ${failed} Failed.`);
  } catch (err: any) {
    console.error('Test Suite encountered exception:', err.message);
    failed++;
  } finally {
    fs.rmSync(FAIL_FILE, { force: true });
  }
  if (failed > 0) process.exitCode = 1;
}

runTests();
