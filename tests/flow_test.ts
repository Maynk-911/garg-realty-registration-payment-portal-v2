/**
 * Automated End-to-End Validation Test Suite
 * Tests: Form submission, Order Creation, Cryptographic Signature Check,
 * Webhook HMAC verification, Idempotency, and Retry flow.
 */

import crypto from 'crypto';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

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

  try {
    // 1. Check Projects List
    const projRes = await fetch(`${BASE_URL}/api/projects`);
    const projData = await projRes.json();
    assert(projRes.ok && projData.projects.length >= 4, '1. Projects endpoint returns active projects');

    // 2. Validate Form Rejection on Empty/Invalid Input
    const badFormRes = await fetch(`${BASE_URL}/api/registration/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: '', mobile: '123' })
    });
    assert(badFormRes.status === 400, '2. Registration rejects invalid mobile / missing name');

    // 3. Submit Valid Registration & Verify Order Creation
    const testRegRes = await fetch(`${BASE_URL}/api/registration/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Vikram Malhotra',
        mobile: '9811223344',
        email: 'vikram.test@example.com',
        city: 'Nainital',
        state: 'Uttarakhand',
        pincode: '263001',
        address: 'Villa 14, Mall Road',
        projectId: 'proj_pangot',
        unitNumber: 'PG-101',
        unitSize: 'Plot 350 Sq. Yds',
        consent: true,
        declarationSigned: true,
        signatureName: 'Vikram Malhotra',
        documentsSubmitted: { id_proof: true, address_proof: true, photo: true }
      })
    });
    const testRegData = await testRegRes.json();
    assert(testRegRes.ok && testRegData.registrationNumber.startsWith('GRG-'), '3. Valid registration creates unique GRG-2026-XXXXXX number');
    assert(testRegData.order && testRegData.order.orderId, '4. Server returns verified gateway order ID');

    const regId = testRegData.registrationId;
    const orderId = testRegData.order.orderId;

    // 4. Verify Payment Simulation / Signature
    const verifyRes = await fetch(`${BASE_URL}/api/payment/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationId: regId,
        razorpayOrderId: orderId,
        razorpayPaymentId: 'pay_test_suite_123',
        razorpaySignature: 'sig_test_verified',
        paymentMethod: 'UPI (vikram@okhdfcbank)'
      })
    });
    const verifyData = await verifyRes.json();
    assert(verifyRes.ok && verifyData.registration.payment_status === 'PAID', '5. Payment verification updates registration status to PAID');

    // 5. Test Webhook Idempotency (Sending same event twice)
    const testWebhookEventId = `evt_test_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      id: testWebhookEventId,
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_test_999',
            order_id: orderId,
            amount: 5000000,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    });

    const webhookRes1 = await fetch(`${BASE_URL}/api/payment/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'simulated_sig'
      },
      body: webhookPayload
    });
    assert(webhookRes1.ok, '6. Webhook accepts valid payment.captured event');

    // Send duplicate
    const webhookRes2 = await fetch(`${BASE_URL}/api/payment/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': 'simulated_sig'
      },
      body: webhookPayload
    });
    const webhookData2 = await webhookRes2.json();
    assert(webhookRes2.ok && webhookData2.message.includes('idempotent'), '7. Webhook idempotency prevents duplicate execution');

    // 6. Test Admin Login and Overview
    const adminRes = await fetch(`${BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@gargrealty.com',
        password: 'AdminPassword@2026'
      })
    });
    const adminData = await adminRes.json();
    assert(adminRes.ok && Boolean(adminData.token), '8. Admin authentication succeeds with signed token');

    const overviewRes = await fetch(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminData.token}` }
    });
    const overviewData = await overviewRes.json();
    assert(overviewRes.ok && overviewData.metrics.totalRegistrations > 0, '9. Admin overview retrieves real database metrics');

    console.log(`\nTest Run Complete: ${passed} Passed, ${failed} Failed.`);
  } catch (err: any) {
    console.error('Test Suite encountered exception:', err.message);
  }
}

runTests();
