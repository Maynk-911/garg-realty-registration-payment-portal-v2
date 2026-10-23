/**
 * Two-project validation: Dholera configuration, booking, payment review and strict separation from Pangot.
 *
 * Run against a server on a TEST database (it changes Dholera's configuration and creates bookings):
 *   npm run dev:mock-sheets        (terminal 1)
 *   npm run test:dholera           (terminal 2)
 */
import '../src/server/loadEnv.js';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const DHOLERA = 'proj_dholera';
const PANGOT = 'proj_pangot';
// 1x1 PNG used as a stand-in payment QR (test data only)
const TEST_QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const run = Date.now().toString().slice(-7);
let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail = '') {
  if (condition) { passed++; console.log(`[PASS] ${name}`); }
  else { failed++; console.error(`[FAIL] ${name}${detail ? ' -- ' + detail : ''}`); }
}
const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${BASE_URL}${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, data, headers: res.headers };
};
const customer = (n: number, extra: Record<string, unknown> = {}) => ({
  fullName: `Two Project Test ${n}`, mobile: `7${run}${String(n).padStart(2, '0')}`, email: `two.project.${run}.${n}@example.com`,
  city: 'Ahmedabad', state: 'Gujarat', pincode: '380001', address: 'Test Address 1', consent: true, declarationSigned: true, ...extra
});

async function main() {
  console.log('--- Two-project (Pangot + Dholera) validation ---');
  const login = await call('POST', '/api/admin/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  const auth = { Authorization: `Bearer ${login.data.token}` };
  assert(Boolean(login.data.token), '0. Admin login');

  // Make sure Dholera starts closed for this run
  await call('POST', `/api/admin/projects/${DHOLERA}/booking-status`, { enabled: false }, auth);

  // 1. Public project list
  let projects = (await call('GET', '/api/projects')).data.projects;
  let pangot = projects.find((p: any) => p.id === PANGOT);
  let dholera = projects.find((p: any) => p.id === DHOLERA);
  assert(projects.length === 2 && pangot.booking_enabled && pangot.token_amount === 51000 && pangot.ownership_plans.length === 4 && pangot.payment_qr_url === '/payment-qr.jpeg',
    '1. Pangot is listed unchanged: open, ₹51,000 token, 4 unit options, official QR');
  assert(dholera && !dholera.booking_enabled && dholera.token_amount === undefined && dholera.ownership_plans === undefined && !dholera.payment_qr_url,
    '1a. Closed Dholera shows no prices, plots or QR to customers');

  // 2. Closed project refuses bookings
  const closedReg = await call('POST', '/api/registration/submit', { ...customer(1), projectId: DHOLERA, selectedPlan: 'anything' });
  assert(closedReg.status === 409, '2. Dholera registration refused while bookings are closed');
  assert((await call('GET', `/api/projects/${DHOLERA}/payment-qr`)).status === 404, '2a. No public Dholera QR while closed');

  // 3. Admin validation
  assert((await call('PUT', `/api/admin/projects/${PANGOT}`, { ownership_plans: [] }, auth)).status === 403, '3. Pangot configuration cannot be edited');
  assert((await call('PUT', `/api/admin/projects/${DHOLERA}`, { ownership_plans: [] })).status === 401, '3a. Project editing requires admin login');
  const badPlan = await call('PUT', `/api/admin/projects/${DHOLERA}`, { ownership_plans: [{ label: 'Bad Plot', total_price: 1000, token_amount: 5000, inventory: 1 }] }, auth);
  assert(badPlan.status === 400, '3b. Token amount above the price is rejected');
  assert((await call('POST', `/api/admin/projects/${DHOLERA}/payment-qr`, { imageDataUrl: 'data:image/png;base64,SGVsbG8=' }, auth)).status === 400, '3c. Non-image QR upload rejected');

  // 4. Configure Dholera (test values)
  const planA = `Test Plot A ${run}`;
  const planB = `Test Plot B ${run}`;
  const saved = await call('PUT', `/api/admin/projects/${DHOLERA}`, {
    display_name: 'Dholera – Smart City Plots, Gujarat', location: 'Dholera, Gujarat', tagline: 'Test tagline', description: 'Test description',
    features: ['Test highlight'], payee_name: 'Test Payee Pvt Ltd', refund_policy: 'TEST refund policy: token refundable within 7 days of booking.',
    ownership_plans: [
      { label: planA, size: '200 Sq. Yd', total_price: 1000000, token_amount: 21000, inventory: 2 },
      { label: planB, size: '300 Sq. Yd', total_price: 1500000, token_amount: 31000, inventory: 1 }
    ]
  }, auth);
  assert(saved.ok && saved.data.project.publish_problems.includes('Upload the payment QR code'), '4. Details saved; QR still required before opening', JSON.stringify(saved.data.project?.publish_problems));
  const early = await call('POST', `/api/admin/projects/${DHOLERA}/booking-status`, { enabled: true, confirmVerified: true }, auth);
  assert(early.status === 409, '4a. Bookings cannot open without a payment QR');
  const qr = await call('POST', `/api/admin/projects/${DHOLERA}/payment-qr`, { imageDataUrl: TEST_QR }, auth);
  assert(qr.ok && qr.data.project.publish_problems.length === 0, '4b. QR uploaded; nothing left to complete');
  assert((await call('POST', `/api/admin/projects/${DHOLERA}/booking-status`, { enabled: true }, auth)).status === 400, '4c. Opening requires the "details verified" confirmation');
  const opened = await call('POST', `/api/admin/projects/${DHOLERA}/booking-status`, { enabled: true, confirmVerified: true }, auth);
  assert(opened.ok && opened.data.project.booking_enabled && Boolean(opened.data.project.details_verified_by), '4d. Bookings opened with the verifying admin recorded');

  // 5. Public Dholera listing
  projects = (await call('GET', '/api/projects')).data.projects;
  dholera = projects.find((p: any) => p.id === DHOLERA);
  const listedA = dholera.ownership_plans.find((pl: any) => pl.label === planA);
  assert(dholera.booking_enabled && listedA?.token_amount === 21000 && listedA.available === 2 && dholera.payee_name === 'Test Payee Pvt Ltd' && /\/api\/projects\/proj_dholera\/payment-qr/.test(dholera.payment_qr_url),
    '5. Published Dholera shows its own plots, availability, payee and QR');
  const qrImg = await fetch(`${BASE_URL}${dholera.payment_qr_url}`);
  assert(qrImg.ok && qrImg.headers.get('content-type') === 'image/png', '5a. Dholera QR image served');
  pangot = projects.find((p: any) => p.id === PANGOT);
  assert(pangot.payment_qr_url === '/payment-qr.jpeg' && pangot.token_amount === 51000, '5b. Pangot QR and token unaffected by Dholera settings');

  // 6. Same customer books both projects: records stay separate
  const pReg = await call('POST', '/api/registration/submit', { ...customer(2), projectId: PANGOT, selectedPlan: '7 L – Co-Own', numberOfUnits: 1 });
  const dReg = await call('POST', '/api/registration/submit', { ...customer(2), projectId: DHOLERA, selectedPlan: planA, numberOfUnits: 2 });
  assert(pReg.ok && /^GRG-PNG-/.test(pReg.data.registrationNumber) && pReg.data.order.amount === 51000, '6. Pangot booking: GRG-PNG ID, ₹51,000', pReg.data.registrationNumber);
  assert(dReg.ok && /^GRG-DHL-/.test(dReg.data.registrationNumber) && dReg.data.order.amount === 42000 && dReg.data.registrationId !== pReg.data.registrationId,
    '6a. Dholera booking for the same customer is a separate GRG-DHL booking: 2 × ₹21,000 = ₹42,000', dReg.data.registrationNumber);
  const pAfter = (await call('GET', `/api/registration/${pReg.data.registrationId}`)).data.registration;
  assert(pAfter.project_id === PANGOT && pAfter.selected_plan === '7 L – Co-Own' && pAfter.total_payable === 51000, '6b. The Pangot booking was not overwritten by the Dholera registration');
  const wrongPlan = await call('POST', '/api/registration/submit', { ...customer(3), projectId: DHOLERA, selectedPlan: '7 L – Co-Own' });
  const pangotPlanOnDholera = await call('POST', '/api/registration/submit', { ...customer(3), projectId: PANGOT, selectedPlan: planA });
  assert(wrongPlan.status === 400 && pangotPlanOnDholera.status === 400, '6c. A project only accepts its own plans (no cross-project plans)');

  // 7. UTR submission and inventory
  const dUtr = `8${run}0001`;
  const sub = await call('POST', '/api/payment/submit-qr-utr', { registrationId: dReg.data.registrationId, utrNumber: dUtr });
  const dSaved = (await call('GET', `/api/registration/${dReg.data.registrationId}`)).data.registration;
  assert(sub.ok && dSaved.payment_status === 'PENDING' && dSaved.mode_of_payment === 'UPI QR (Test Payee Pvt Ltd)', '7. Dholera UTR saved as pending with Dholera payee (not marked paid)', dSaved.mode_of_payment);
  const soldOut = await call('POST', '/api/registration/submit', { ...customer(4), projectId: DHOLERA, selectedPlan: planA });
  assert(soldOut.status === 409 && /sold out/i.test(soldOut.data.error), '7a. Inventory enforced: plot A sold out after 2 units are held');
  const receiptPending = await call('GET', `/api/registration/${dReg.data.registrationId}/receipt`);
  assert(receiptPending.status === 403, '7b. No final receipt while the Dholera payment is pending');

  // 8. Admin filters keep projects apart
  const ovD = (await call('GET', `/api/admin/overview?projectId=${DHOLERA}`, undefined, auth)).data;
  const ovP = (await call('GET', `/api/admin/overview?projectId=${PANGOT}`, undefined, auth)).data;
  const ovAll = (await call('GET', '/api/admin/overview?projectId=all', undefined, auth)).data;
  const dRow = ovD.projectBreakdown[0];
  assert(ovD.projectBreakdown.length === 1 && dRow.id === DHOLERA && dRow.pendingVerification >= 1 && dRow.inventory.total === 3 && dRow.inventory.held === 2,
    '8. Dholera overview: only Dholera figures, inventory 2 held of 3', JSON.stringify(dRow));
  assert(ovP.projectBreakdown.length === 1 && ovP.projectBreakdown[0].id === PANGOT && ovP.projectBreakdown[0].inventory === null, '8a. Pangot overview shows only Pangot (inventory not tracked)');
  assert(ovAll.metrics.totalRegistrations === ovD.metrics.totalRegistrations + ovP.metrics.totalRegistrations, '8b. All-projects totals equal Pangot + Dholera');
  const listD = (await call('GET', `/api/admin/registrations?projectId=${DHOLERA}&limit=1000`, undefined, auth)).data.registrations;
  assert(listD.length > 0 && listD.every((r: any) => r.project_id === DHOLERA), '8c. Bookings list filtered to Dholera only');
  const csvD = await fetch(`${BASE_URL}/api/admin/export-csv?projectId=${DHOLERA}`, { headers: auth });
  const csvText = new TextDecoder().decode(await csvD.arrayBuffer());
  assert(csvD.ok && csvText.includes(dReg.data.registrationNumber) && !csvText.includes('GRG-PNG-'), '8d. Dholera CSV export contains no Pangot bookings');

  // 9. Verification and receipt
  const verify = await call('POST', '/api/admin/verify-payment', { registrationId: dReg.data.registrationId, verified: true }, auth);
  const receipt = await call('GET', `/api/registration/${dReg.data.registrationId}/receipt`);
  assert(verify.ok && receipt.ok && receipt.data.receipt.amount_received === 42000 && receipt.data.receipt.utr_number === dUtr, '9. Admin verification unlocks the Dholera receipt with the saved ₹42,000');
  const lookupD = (await call('GET', `/api/registration/${dReg.data.registrationNumber}`)).data;
  const lookupP = (await call('GET', `/api/registration/${pReg.data.registrationNumber}`)).data;
  assert(/TEST refund policy/.test(lookupD.projectTerms[DHOLERA].refund_policy) && /15 days/.test(lookupP.projectTerms[PANGOT].refund_policy),
    '9a. Each booking carries its own project\'s refund policy');

  // 10. Rejection releases inventory
  const bReg = await call('POST', '/api/registration/submit', { ...customer(5), projectId: DHOLERA, selectedPlan: planB });
  await call('POST', '/api/payment/submit-qr-utr', { registrationId: bReg.data.registrationId, utrNumber: `8${run}0002` });
  let bAvail = (await call('GET', '/api/projects')).data.projects.find((p: any) => p.id === DHOLERA).ownership_plans.find((pl: any) => pl.label === planB).available;
  assert(bAvail === 0, '10. Plot B held by the submitted UTR');
  await call('POST', '/api/admin/verify-payment', { registrationId: bReg.data.registrationId, verified: false }, auth);
  bAvail = (await call('GET', '/api/projects')).data.projects.find((p: any) => p.id === DHOLERA).ownership_plans.find((pl: any) => pl.label === planB).available;
  const bReceipt = await call('GET', `/api/registration/${bReg.data.registrationId}/receipt`);
  assert(bAvail === 1 && bReceipt.status === 403, '10a. Rejected payment releases the plot and gets no receipt');

  // 11. Protecting booked plots
  const rename = await call('PUT', `/api/admin/projects/${DHOLERA}`, {
    payee_name: 'Test Payee Pvt Ltd', refund_policy: 'TEST refund policy: token refundable within 7 days of booking.',
    ownership_plans: [{ label: `${planA} renamed`, total_price: 1000000, token_amount: 21000, inventory: 2 }, { label: planB, total_price: 1500000, token_amount: 31000, inventory: 1 }]
  }, auth);
  const shrink = await call('PUT', `/api/admin/projects/${DHOLERA}`, {
    payee_name: 'Test Payee Pvt Ltd', refund_policy: 'TEST refund policy: token refundable within 7 days of booking.',
    ownership_plans: [{ label: planA, total_price: 1000000, token_amount: 21000, inventory: 1 }, { label: planB, total_price: 1500000, token_amount: 31000, inventory: 1 }]
  }, auth);
  assert(rename.status === 409 && shrink.status === 409, '11. A plot with bookings cannot be renamed, and inventory cannot drop below booked units');

  // 12. Closing bookings
  await call('POST', `/api/admin/projects/${DHOLERA}/booking-status`, { enabled: false }, auth);
  const afterClose = await call('POST', '/api/registration/submit', { ...customer(6), projectId: DHOLERA, selectedPlan: planB });
  const closedRetry = await call('POST', '/api/payment/retry', { registrationId: bReg.data.registrationId });
  const stillThere = (await call('GET', `/api/registration/${dReg.data.registrationNumber}`)).data.registration;
  assert(afterClose.status === 409 && closedRetry.status === 409 && stillThere.payment_status === 'PAID', '12. Closed project refuses new bookings and payments; existing verified booking intact');

  // 13. Audit trail
  const audit = (await call('GET', '/api/admin/audit-logs', undefined, auth)).data.auditLogs.map((a: any) => a.action);
  assert(['PROJECT_UPDATED', 'PROJECT_PAYMENT_QR_UPDATED', 'PROJECT_BOOKINGS_OPENED', 'PROJECT_BOOKINGS_CLOSED'].every(a => audit.includes(a)), '13. Project changes are recorded in the audit trail');

  await call('POST', '/api/admin/logout', {}, auth);
  console.log(`\nTwo-project run complete: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('Test run aborted:', err); process.exitCode = 1; });
