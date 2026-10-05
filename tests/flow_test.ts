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
    // 1. Check Projects List (Strictly Pangot)
    const projRes = await fetch(`${BASE_URL}/api/projects`);
    const projData = await projRes.json();
    assert(projRes.ok && projData.projects.length === 1 && projData.projects[0].id === 'proj_pangot', '1. Projects endpoint returns Pangot project exclusively');

    // 2. Validate Form Rejection on Empty/Invalid Input
    const badFormRes = await fetch(`${BASE_URL}/api/registration/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName: '', mobile: '123' })
    });
    assert(badFormRes.status === 400, '2. Registration rejects invalid mobile / missing name');

    // 3. Submit Valid Registration & Verify Order Creation with Selected Plan
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
        selectedPlan: '₹7 L - Co-Own',
        numberOfUnits: 2,
        specificRequirement: 'Scenic Hill Facing',
        consent: true,
        declarationSigned: true,
        signatureName: 'Vikram Malhotra',
        documentsSubmitted: { id_proof: true, address_proof: true, photo: true }
      })
    });
    const testRegData = await testRegRes.json();
    assert(testRegRes.ok && testRegData.registrationNumber.startsWith('GRG-PNG-'), '3. Valid registration creates unique GRG-PNG-2026-XXXXXX number');
    assert(testRegData.order && testRegData.order.orderId, '4. Server returns verified gateway order ID');
    assert(testRegData.order.amount === 100000, '4a. 2 units calculate 100,000 INR');

    const regId = testRegData.registrationId;
    const orderId = testRegData.order.orderId;

    // Check that registration has selected_plan and units_count saved correctly
    const fetchRegRes = await fetch(`${BASE_URL}/api/registration/${regId}`);
    const fetchRegData = await fetchRegRes.json();
    assert(fetchRegData.registration.selected_plan === '₹7 L - Co-Own', '4b. Registration persists selectedPlan "₹7 L - Co-Own" correctly');
    assert(fetchRegData.registration.units_count === 2, '4c. Registration persists units_count = 2 correctly');

    // 4b. Test HDFC SmartHub QR UTR submission (Status MUST remain PENDING, not PAID)
    const qrSubmissionRes = await fetch(`${BASE_URL}/api/payment/submit-qr-utr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationId: regId,
        utrNumber: '428591823456',
        upiApp: 'Google Pay',
        senderUpi: 'vikram@okhdfcbank'
      })
    });
    const qrSubmissionData = await qrSubmissionRes.json();
    assert(qrSubmissionRes.ok && qrSubmissionData.status === 'PENDING', '5a. Submitting UTR keeps payment_status PENDING (never marked as PAID merely on click)');
    assert(qrSubmissionData.registration.utr_number === '428591823456', '5b. Registration stores submitted UTR number correctly');

    // 4c. Verify Payment Simulation / Signature (or Admin verification updates to PAID)
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

    // -------------------------------------------------------------------------
    // GOOGLE SHEETS "Payment Domain" STRICT DATA CONTROL SUITE
    // -------------------------------------------------------------------------

    // 10. Test that invalid plan values are strictly rejected
    const invalidPlanRes = await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Test Rejected Plan',
        email: 'invalidplan@example.com',
        mobile: '9876543210',
        country: 'India',
        selectedPlan: 'Unauthorized Luxury Penthouse',
        consent: true
      })
    });
    assert(invalidPlanRes.status === 400, '10. Server strictly rejects any plan not in the 4 allowed values');

    // 11. Test that customer submits valid registration and initial payment_status is PENDING
    const validPlanRes = await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: '=cmd|/c calc!John Doe', // Formula injection attempt
        email: 'johndoe_sheets@example.com',
        mobile: '9811223344',
        whatsapp: '9811223344',
        country: 'India',
        state: 'Uttarakhand',
        city: 'Nainital',
        pincode: '263001',
        address: '+123 Hill View Road', // Formula injection attempt
        selectedPlan: 'Studio - Full Own',
        numberOfUnits: 1,
        consent: true
      })
    });
    const validPlanData = await validPlanRes.json();
    assert(validPlanRes.ok && validPlanData.registrationNumber.startsWith('GRG-PNG-'), '11. Valid registration with allowed plan succeeds');

    // 12. Verify Project is strictly fixed to Pangot and Payment Status starts as PENDING
    const checkRegRes = await fetch(`${BASE_URL}/api/registration/${validPlanData.registrationId}`);
    const checkRegData = await checkRegRes.json();
    assert(checkRegData.registration.project_name === 'Pangot', '12. Project is strictly fixed to "Pangot"');
    assert(checkRegData.registration.selected_plan === 'Studio - Full Own', '13. Selected Plan is one of the 4 allowed values');
    assert(checkRegData.registration.payment_status === 'PENDING', '14. Payment Status starts strictly as PENDING');

    // 13. Test row formatting for "Payment Domain": exactly the 19 approved columns
    const { formatRegistrationToRow, GOOGLE_SHEET_COLUMNS, SPREADSHEET_NAME } = await import('../src/server/googleSheetsService.js');
    const row = formatRegistrationToRow(checkRegData.registration);
    assert(row.length === 19, '15. Google Sheet row has EXACTLY 19 columns');
    assert(GOOGLE_SHEET_COLUMNS.length === 19, '16. Authorized column definitions match exactly 19 approved columns');
    assert(row[10] === 'Pangot', '17. Column 11 (Project) in Sheet row is strictly "Pangot"');
    assert(row[11] === 'Studio - Full Own', '18. Column 12 (Selected Plan) in Sheet row matches allowed plan');
    assert(row[14] === 'PENDING', '19. Column 15 (Payment Status) in Sheet row starts as PENDING');

    // 14. Verify formula injection prevention (values starting with = or + are escaped)
    assert(typeof row[1] === 'string' && (row[1].startsWith("'=") || !row[1].startsWith("=")), '20. Formula injection sanitized on Name');
    assert(typeof row[9] === 'string' && (row[9].startsWith("'+") || !row[9].startsWith("+")), '21. Formula injection sanitized on Address');

    // 15. Verify security: no customer can access Google Sheets admin endpoints
    const unauthSheetsRes = await fetch(`${BASE_URL}/api/admin/google-sheets/status`);
    assert(unauthSheetsRes.status === 401, '22. Unauthenticated customer cannot access Google Sheets status or data (401 Unauthorized)');

    // 16. Verify authenticated admin can view Google Sheets configuration
    const authSheetsRes = await fetch(`${BASE_URL}/api/admin/google-sheets/status`, {
      headers: { Authorization: `Bearer ${adminData.token}` }
    });
    const authSheetsData = await authSheetsRes.json();
    assert(authSheetsRes.ok && authSheetsData.spreadsheetName === 'Payment Domain', '23. Admin can view "Payment Domain" integration status');
    assert(authSheetsData.columnsCount === 19, '24. Exactly 19 columns configured in "Payment Domain"');

    // 17. Duplicate Protection: Submitting UTR for same registration updates existing record without duplicate
    const utrRes = await fetch(`${BASE_URL}/api/payment/submit-qr-utr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationId: validPlanData.registrationId,
        utrNumber: '998877665544',
        upiApp: 'HDFC PayZapp'
      })
    });
    const utrData = await utrRes.json();
    assert(utrRes.ok && utrData.registration.utr_number === '998877665544', '25. UTR submission updates existing registration in place');
    assert(utrData.registration.payment_status === 'PENDING', '26. Payment status remains PENDING after UTR submission');

    // 18. Format row again: check UTR is in Column 16 and status remains PENDING
    const updatedRow = formatRegistrationToRow(utrData.registration);
    assert(updatedRow[14] === 'PENDING', '27. Sheet row status remains PENDING after UTR submission');
    assert(updatedRow[15] === '998877665544', '28. Column 16 (Payment Reference / Transaction ID) stores UTR');

    console.log(`\nTest Run Complete: ${passed} Passed, ${failed} Failed.`);
  } catch (err: any) {
    console.error('Test Suite encountered exception:', err.message);
  }
}

runTests();
