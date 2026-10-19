// Load .env before any service module reads process.env
import './src/server/loadEnv.js';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { db } from './src/server/db.js';
import { paymentService } from './src/server/paymentService.js';
import { crmService } from './src/server/crmService.js';
import { emailService } from './src/server/emailService.js';
import { Registration, PaymentStatus, RegistrationStatus, PaymentRecord } from './src/types.js';
import { googleSheetsService, formatRegistrationToRow, GOOGLE_SHEET_COLUMNS, ALLOWED_PLANS, loadSheetsCredentials } from './src/server/googleSheetsService.js';
import { normalizeUnitOption, getPaymentStatusLabel } from './src/bookingOptions.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';
// In production the app runs behind the host's reverse proxy: use the real client IP (one proxy hop) so
// login and lookup throttling apply per visitor, not to everyone at once. Not trusted locally, where it could be spoofed.
if (isProd) app.set('trust proxy', 1);
const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || '';
const adminAuthConfigured = ADMIN_SECRET.length >= 32 && ADMIN_SECRET !== 'garg_realty_admin_secure_key_2026';
const loginAttempts = new Map<string, { count: number; expires: number }>();
// Signatures of tokens ended by Logout, kept until the token would have expired anyway
const revokedAdminTokens = new Map<string, number>();
// Tokens are bound to this server run, so a restart ends every session (revocations never come back to life)
const ADMIN_SESSION_EPOCH = crypto.randomUUID();

// Capture raw body for webhook verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
  limit: '2mb'
}));
app.use(express.urlencoded({ extended: true }));

// Security & CORS middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Admin authentication middleware
function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  if (!adminAuthConfigured) return res.status(503).json({ error: 'Admin authentication is not configured' });
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const [payloadBase64, signature, extra] = token.split('.');
    if (!payloadBase64 || !/^[a-f0-9]{64}$/.test(signature || '') || extra !== undefined) {
      return res.status(401).json({ error: 'Malformed admin token' });
    }

    const expectedSig = crypto.createHmac('sha256', ADMIN_SECRET).update(payloadBase64).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(signature, 'hex'))) {
      return res.status(401).json({ error: 'Invalid admin token signature' });
    }

    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8'));
    if (!Number.isFinite(payload.exp) || Date.now() >= payload.exp || payload.sid !== ADMIN_SESSION_EPOCH || revokedAdminTokens.has(signature)) {
      return res.status(401).json({ error: 'Session expired, please login again' });
    }

    const admin = typeof payload.email === 'string' ? db.getAdminByEmail(payload.email) : null;
    if (!admin || admin.id !== payload.id || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) {
      return res.status(403).json({ error: 'Administrator access required' });
    }
    (req as any).adminUser = { id: admin.id, email: admin.email, role: admin.role };
    (req as any).adminToken = { signature, exp: payload.exp };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Failed to verify admin authentication' });
  }
}

// Helper to normalize Indian phone numbers
function validateAndNormalizeMobile(mobile: string, country: string = 'India'): { valid: boolean; normalized: string } {
  const digits = mobile.replace(/\D/g, '');
  if (country.toLowerCase() === 'india' || country === 'IN') {
    if (digits.length === 10 && /^[6-9]/.test(digits)) {
      return { valid: true, normalized: `+91${digits}` };
    }
    if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) {
      return { valid: true, normalized: `+${digits}` };
    }
    return { valid: false, normalized: mobile };
  }
  return { valid: digits.length >= 7 && digits.length <= 15, normalized: digits };
}

// -------------------------------------------------------------
// PUBLIC & CLIENT API ROUTES
// -------------------------------------------------------------

// 1. App Configuration & Public Branding
app.get('/api/config', (_req: Request, res: Response) => {
  const gatewayConfig = paymentService.getPublicConfig();
  res.json({
    companyName: process.env.COMPANY_NAME || 'Garg Realty Group',
    legalEntity: process.env.COMPANY_LEGAL_ENTITY || 'Garg Residency Private Limited',
    tagline: 'Driven by Trust, Defined by Excellence',
    subdomain: process.env.APP_SUBDOMAIN || 'apply.yourdomain.com',
    gateway: gatewayConfig,
    policyVersions: {
      privacy: 'v2026.1',
      terms: 'v2026.1'
    }
  });
});

// 2. Projects List
app.get('/api/projects', (_req: Request, res: Response) => {
  const projects = db.listProjects(true);
  res.json({ projects });
});

// 3. Submit Registration & Create Payment Order
app.post(['/api/registration/submit', '/api/register'], async (req: Request, res: Response) => {
  try {
    const {
      fullName,
      mobile,
      whatsapp,
      email,
      dateOfBirth,
      gender,
      country = 'India',
      state,
      city,
      pincode,
      address,
      coApplicantName,
      coApplicantMobile,
      coApplicantEmail,
      coApplicantAddress,
      companyName,
      profession,
      requirement,
      projectId,
      unitNumber,
      unitSize,
      floorNo,
      notes,
      documentsSubmitted,
      consent,
      declarationSigned,
      signatureName,
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
      gclid,
      fbclid,
      source
    } = req.body;

    // Strict Validations
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter a valid applicant name' });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const mobileCheck = validateAndNormalizeMobile(mobile || '', country);
    if (!mobileCheck.valid) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    }

    if (!consent) {
      return res.status(400).json({ error: 'You must accept the Terms & Conditions and Privacy Policy consent' });
    }

    // Project is strictly locked to Pangot
    const targetProjectId = projectId || 'proj_pangot';
    const project = db.getProject(targetProjectId) || db.getProject('proj_pangot');
    if (!project) {
      return res.status(400).json({ error: 'The Pangot project is not currently available for booking' });
    }

    // Strict Plan Validation: must ONLY accept one of the 4 allowed values
    const selectedPlan = normalizeUnitOption(req.body.selectedPlan || req.body.unitSize);
    if (!selectedPlan) {
      return res.status(400).json({
        error: `Invalid unit selected. Unit must be strictly one of: ${ALLOWED_PLANS.join(', ')}`
      });
    }
    const unitsCount = Math.max(1, parseInt(req.body.numberOfUnits || req.body.unitsCount || '1', 10) || 1);
    const tokenPerUnit = db.getProject('proj_pangot')!.token_amount;
    const tokenAmount = tokenPerUnit * unitsCount;
    const taxPercentage = 0; // Fixed 0% surcharge on advance token
    const taxAmount = 0;
    const totalPayable = tokenAmount;

    // Check for existing pending registration with exact same details to prevent duplicates (only if unpaid)
    let registration = db.findRegistrationByEmailOrPhone(email, mobileCheck.normalized);
    if (registration && (registration.payment_status === 'PAID' || registration.utr_number)) {
      registration = null; // Prior booking is paid or has a payment submitted; never overwrite it, create a new booking
    }
    const isNew = !registration;

    const now = new Date().toISOString();
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    if (!registration) {
      const regNumber = db.generateRegistrationNumber();
      registration = {
        id: `reg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        registration_number: regNumber,
        full_name: fullName.trim(),
        mobile: mobileCheck.normalized,
        whatsapp: whatsapp ? validateAndNormalizeMobile(whatsapp, country).normalized : undefined,
        email: email.trim().toLowerCase(),
        date_of_birth: dateOfBirth || '',
        gender: gender || '',
        country: country.trim(),
        state: (state || '').trim(),
        city: (city || '').trim(),
        pincode: (pincode || '').trim(),
        address: (address || '').trim(),
        co_applicant_name: (coApplicantName || '').trim(),
        co_applicant_mobile: coApplicantMobile ? validateAndNormalizeMobile(coApplicantMobile, country).normalized : '',
        co_applicant_email: (coApplicantEmail || '').trim().toLowerCase(),
        co_applicant_address: (coApplicantAddress || '').trim(),
        company_name: (companyName || '').trim(),
        profession: (profession || '').trim(),
        requirement: (requirement || '').trim(),
        project_id: project.id,
        project_name: 'Pangot',
        selected_plan: selectedPlan,
        units_count: unitsCount,
        unit_number: selectedPlan,
        unit_size: selectedPlan,
        floor_no: (floorNo || '').trim(),
        total_price: project.total_price,
        roi_percentage: project.roi_percentage,
        token_amount: tokenAmount,
        tax_amount: taxAmount,
        total_payable: totalPayable,
        mode_of_payment: 'Online Gateway',
        total_payment_received: 0,
        documents_submitted: {
          id_proof: Boolean(documentsSubmitted?.id_proof),
          address_proof: Boolean(documentsSubmitted?.address_proof),
          photo: Boolean(documentsSubmitted?.photo)
        },
        notes: (notes || '').trim(),
        consent: true,
        consent_timestamp: now,
        declaration_signed: Boolean(declarationSigned),
        signature_name: (signatureName || fullName).trim(),
        privacy_policy_version: 'v2026.1',
        terms_version: 'v2026.1',
        ip_address: clientIp,
        user_agent: userAgent,
        payment_status: 'PENDING',
        registration_status: 'SUBMITTED',
        source: source || 'Direct Web',
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_term: utmTerm,
        utm_content: utmContent,
        gclid,
        fbclid,
        created_at: now,
        updated_at: now
      };
    } else {
      // Update existing pending registration
      registration.full_name = fullName.trim();
      registration.project_id = project.id;
      registration.project_name = 'Pangot';
      registration.selected_plan = selectedPlan;
      registration.units_count = unitsCount;
      registration.token_amount = tokenAmount;
      registration.tax_amount = taxAmount;
      registration.total_payable = totalPayable;
      registration.unit_number = selectedPlan;
      registration.unit_size = selectedPlan;
      registration.floor_no = (floorNo || registration.floor_no || '').trim();
      registration.updated_at = now;
    }

    db.saveRegistration(registration);

    // Note: nothing is written to Google Sheets yet. The spreadsheet row is appended only when the
    // customer completes the booking by submitting their UTR (see /api/payment/submit-qr-utr).

    // Create payment order
    const orderResult = await paymentService.createOrder({
      registrationId: registration.id,
      amount: totalPayable,
      currency: 'INR',
      notes: {
        registration_number: registration.registration_number,
        project_name: project.name
      }
    });

    // Notify CRM & Admin about initiated lead
    if (isNew) {
      crmService.createLead(registration).catch(console.error);
      emailService.notifyAdminNewRegistration(registration).catch(console.error);
    }

    res.json({
      success: true,
      registrationId: registration.id,
      registrationNumber: registration.registration_number,
      order: orderResult,
      project: {
        id: project.id,
        name: project.name,
        tokenAmount,
        taxAmount,
        totalPayable
      }
    });
  } catch (err: any) {
    console.error('Error submitting registration:', err);
    res.status(500).json({ error: err.message || 'Something went wrong while creating your registration.' });
  }
});

// 4. Final booking submission: QR payment reference (UTR) -> validated -> appended to Google Sheets -> confirmation
// Critical: Payment status must remain PENDING ("Payment Submitted") until verified by accounts desk.
const submissionsInFlight = new Set<string>();

// One bank transaction can only pay for one booking
function isUtrUsedElsewhere(registrationId: string, utr: string) {
  return db.listRegistrations().some(r =>
    r.id !== registrationId && r.utr_number?.toUpperCase() === utr.toUpperCase() && r.payment_status !== 'FAILED'
  );
}

/**
 * Saves a submitted UTR on the booking as PENDING (never PAID), adds the payment record and audit entry,
 * and writes everything to disk. If the disk write fails the change is undone and the error is rethrown.
 */
function saveUtrSubmission(
  registration: Registration,
  cleanUtr: string,
  opts: { upiApp: string; senderUpi?: string; notes?: string; auditAction: string; actor: string; auditExtra?: Record<string, unknown> }
): Registration {
  // Timestamp is generated here on the server, never taken from the browser
  const now = new Date().toISOString();

  // Critical Requirement: DO NOT mark as PAID upon submission!
  // Payment status stays PENDING until an admin verifies it against the bank statement.
  const submission: Registration = {
    ...registration,
    utr_number: cleanUtr,
    upi_app: opts.upiApp,
    sender_upi: String(opts.senderUpi || '').trim(),
    payment_submitted_at: now,
    payment_status: 'PENDING',
    registration_status: 'IN_REVIEW',
    mode_of_payment: 'HDFC SmartHub QR (TID: 68283784)',
    updated_at: now
  };
  if (opts.notes) {
    submission.notes = `${registration.notes ? registration.notes + ' | ' : ''}${opts.notes.slice(0, 600)}`;
  }

  // The local database (data/db.json) is the record of truth
  db.saveRegistration(submission);

  const paymentRecord: PaymentRecord = {
    id: `pay_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
    registration_id: submission.id,
    registration_number: submission.registration_number,
    gateway: 'HDFC_SMARTHUB_QR',
    gateway_order_id: `hdfc_qr_${submission.registration_number}`,
    gateway_payment_id: cleanUtr,
    utr_number: cleanUtr,
    amount: submission.total_payable,
    currency: 'INR',
    payment_status: 'PENDING',
    payment_method: `HDFC SmartHub QR (${submission.upi_app})`,
    signature_verified: false,
    webhook_verified: false,
    attempt_number: db.getPaymentsForRegistration(submission.id).length + 1,
    created_at: now,
    updated_at: now
  };
  db.savePayment(paymentRecord);

  db.logAudit({
    action: opts.auditAction,
    admin_id: opts.actor,
    entity_type: 'PAYMENT',
    entity_id: submission.id,
    old_value: { registration_number: registration.registration_number, payment_status: registration.payment_status, utr_number: registration.utr_number || null },
    new_value: {
      registration_number: submission.registration_number,
      utr_number: cleanUtr,
      amount: submission.total_payable,
      payment_status: 'PENDING',
      ...opts.auditExtra
    }
  });

  // Write to disk now; if that fails, undo the in-memory change so the caller can safely retry
  try {
    db.flush();
  } catch (persistErr: any) {
    console.error(`[Database] Booking ${registration.registration_number} UTR could not be saved:`, persistErr.message);
    db.saveRegistration(registration);
    db.savePayment({ ...paymentRecord, payment_status: 'FAILED', updated_at: new Date().toISOString() });
    throw persistErr;
  }

  // Optional mirror to Google Sheets, only when credentials are configured; never blocks the caller
  if (googleSheetsService.getStatus().isConnected) {
    googleSheetsService.syncRegistration(submission).then(result => {
      if (result.success && result.action !== 'QUEUED') {
        const latest = db.getRegistration(submission.id);
        if (latest) db.saveRegistration({ ...latest, sheet_synced_at: new Date().toISOString() });
      }
    }).catch(err => console.warn('Google Sheets sync warning:', err.message));
  }
  return submission;
}

app.post('/api/payment/submit-qr-utr', async (req: Request, res: Response) => {
  let inFlightId: string | null = null;
  try {
    const { registrationId, utrNumber, upiApp, senderUpi, notes } = req.body;

    if (!registrationId) {
      return res.status(400).json({ error: 'registrationId is required' });
    }

    const cleanUtr = String(utrNumber || '').trim();
    if (!/^[A-Za-z0-9]{6,25}$/.test(cleanUtr)) {
      return res.status(400).json({ error: 'Please enter a valid UTR / Transaction Reference Number (6-25 letters and digits)' });
    }

    const registration = db.getRegistration(registrationId);
    if (!registration) {
      return res.status(404).json({ error: 'Registration record not found' });
    }

    // A verified booking must never be reset back to an unverified state
    if (registration.payment_status === 'PAID') {
      return res.status(400).json({ error: 'Payment for this booking has already been verified.' });
    }

    const buildResponse = (reg: Registration) => ({
      success: true,
      status: 'PENDING',
      statusLabel: getPaymentStatusLabel(reg),
      message: 'Payment details submitted successfully. Verification is pending.',
      // The booking fields as they would appear in the optional Google Sheet mirror
      sheetRecord: Object.fromEntries(formatRegistrationToRow(reg).map((value, i) => [GOOGLE_SHEET_COLUMNS[i], value])),
      registration: toPublicRegistration(reg)
    });

    // Duplicate protection: a UTR is already saved for this booking and awaiting review
    if (registration.utr_number && registration.payment_status === 'PENDING') {
      if (registration.utr_number === cleanUtr) {
        // Same request again (double click / refresh / retry): succeed without saving another record
        return res.json({ ...buildResponse(registration), duplicate: true });
      }
      return res.status(409).json({
        error: 'A payment reference has already been submitted for this booking. Please contact us if it needs to be corrected.'
      });
    }

    if (isUtrUsedElsewhere(registration.id, cleanUtr)) {
      return res.status(409).json({
        error: 'This UTR / Transaction Reference has already been submitted for another booking. Please check the number or contact us.'
      });
    }

    // Duplicate protection: a second identical request while the first is still being recorded
    if (submissionsInFlight.has(registration.id)) {
      return res.status(409).json({ error: 'Your submission is already being processed. Please wait a moment.' });
    }
    submissionsInFlight.add(registration.id);
    inFlightId = registration.id;

    let submission: Registration;
    try {
      submission = saveUtrSubmission(registration, cleanUtr, {
        upiApp: String(upiApp || 'UPI Scan & Pay').trim(),
        senderUpi,
        notes: notes ? `UTR Notes: ${String(notes)}` : undefined,
        auditAction: 'PAYMENT_UTR_SUBMITTED',
        actor: registration.full_name
      });
    } catch {
      return res.status(500).json({ error: 'Your payment details could not be saved right now. Please try again.', retryable: true });
    }

    res.json(buildResponse(submission));
  } catch (err: any) {
    console.error('Error submitting payment reference:', err);
    res.status(500).json({ error: 'Your payment details could not be saved right now. Please try again.', retryable: true });
  } finally {
    if (inFlightId) submissionsInFlight.delete(inFlightId);
  }
});

// Admin endpoint to verify a pending payment UTR and mark it PAID
app.post('/api/admin/verify-payment', authenticateAdmin, (req: Request, res: Response) => {
  try {
    const { registrationId, verified, notes } = req.body;
    if (typeof registrationId !== 'string' || typeof verified !== 'boolean' || (notes !== undefined && typeof notes !== 'string')) {
      return res.status(400).json({ error: 'A booking ID and boolean verification decision are required' });
    }
    const registration = db.getRegistration(registrationId);
    if (!registration) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    if (!registration.utr_number || registration.payment_status !== 'PENDING') {
      return res.status(409).json({ error: 'Only a pending payment with a submitted UTR can be reviewed' });
    }
    const now = new Date().toISOString();
    const oldValue = { payment_status: registration.payment_status, registration_status: registration.registration_status };
    if (verified) {
      registration.payment_status = 'PAID';
      registration.registration_status = 'CONFIRMED';
      registration.total_payment_received = registration.total_payable;
      registration.payment_verified_at = now;
      registration.payment_verified_by = (req as any).adminUser.id;
      delete registration.payment_rejected_at;
      delete registration.payment_rejected_by;
      registration.updated_at = now;
    } else {
      // Rejection keeps the submitted UTR on the booking for the record
      registration.payment_status = 'FAILED';
      registration.total_payment_received = 0;
      delete registration.payment_verified_at;
      delete registration.payment_verified_by;
      registration.payment_rejected_at = now;
      registration.payment_rejected_by = (req as any).adminUser.id;
      registration.updated_at = now;
    }

    if (notes) {
      registration.notes = `${registration.notes ? registration.notes + ' | ' : ''}Verification Notes: ${notes}`;
    }

    db.saveRegistration(registration);

    // Reflect the accounts-desk decision on this booking's own row (matched by Booking ID; no other row is touched)
    googleSheetsService.syncRegistration(registration).then(result => {
      if (result.success && result.action !== 'QUEUED') {
        registration.sheet_synced_at = new Date().toISOString();
        db.saveRegistration(registration);
      }
    }).catch(err => {
      console.warn('Google Sheets sync warning:', err.message);
    });

    // Update payment record
    const payments = db.getPaymentsForRegistration(registration.id);
    if (payments.length > 0) {
      const p = payments[payments.length - 1];
      p.payment_status = verified ? 'PAID' : 'FAILED';
      p.signature_verified = verified;
      p.verified_at = now;
      db.savePayment(p);
    }

    db.logAudit({
      action: verified ? 'PAYMENT_VERIFIED_SUCCESS' : 'PAYMENT_VERIFIED_REJECTED',
      admin_id: (req as any).adminUser.id,
      entity_type: 'PAYMENT',
      entity_id: registration.id,
      old_value: { registration_number: registration.registration_number, ...oldValue },
      new_value: {
        registration_number: registration.registration_number,
        payment_status: registration.payment_status,
        registration_status: registration.registration_status,
        utr_number: registration.utr_number,
        admin_email: (req as any).adminUser.email
      }
    });

    // The decision (and receipt unlock) is only reported once it is on disk
    db.flush();

    res.json({ success: true, registration });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin records a UTR on the customer's behalf (e.g. read from the customer's UPI receipt) when the customer
// could not submit it. This only records it as PENDING; Verify Payment remains a separate step.
app.post('/api/admin/registration/:id/record-utr', authenticateAdmin, (req: Request, res: Response) => {
  try {
    const { utrNumber, evidence } = req.body;
    const cleanUtr = String(utrNumber || '').trim();
    const cleanEvidence = String(evidence || '').trim();
    if (!/^[A-Za-z0-9]{6,25}$/.test(cleanUtr)) {
      return res.status(400).json({ error: 'Enter the UTR / Transaction Reference exactly as shown on the receipt (6-25 letters and digits)' });
    }
    if (cleanEvidence.length < 10 || cleanEvidence.length > 500) {
      return res.status(400).json({ error: 'Describe where the UTR came from (10-500 characters), e.g. "UPI receipt screenshot sent by customer on 19 Oct"' });
    }
    const registration = db.getRegistration(req.params.id);
    if (!registration) return res.status(404).json({ error: 'Registration not found' });
    if (registration.payment_status === 'PAID') {
      return res.status(409).json({ error: 'This payment has already been verified.' });
    }
    if (registration.utr_number && registration.payment_status === 'PENDING') {
      return res.status(409).json({ error: 'A UTR is already recorded for this booking and awaiting review.' });
    }
    if (isUtrUsedElsewhere(registration.id, cleanUtr)) {
      return res.status(409).json({ error: 'This UTR is already recorded for another booking.' });
    }
    if (submissionsInFlight.has(registration.id)) {
      return res.status(409).json({ error: 'A submission for this booking is already being processed.' });
    }
    submissionsInFlight.add(registration.id);
    try {
      const adminUser = (req as any).adminUser;
      const submission = saveUtrSubmission(registration, cleanUtr, {
        upiApp: 'Recorded by admin from customer receipt',
        notes: `UTR recorded by admin ${adminUser.email}: ${cleanEvidence}`,
        auditAction: 'PAYMENT_UTR_RECORDED_BY_ADMIN',
        actor: adminUser.id,
        auditExtra: { admin_email: adminUser.email, evidence: cleanEvidence }
      });
      res.json({ success: true, registration: submission });
    } finally {
      submissionsInFlight.delete(registration.id);
    }
  } catch (err: any) {
    res.status(500).json({ error: 'The UTR could not be saved. Please try again.' });
  }
});

// 4. Verify Payment (Client checkout completion callback)
app.post('/api/payment/verify', async (req: Request, res: Response) => {
  try {
    const { registrationId, razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentMethod } = req.body;

    if (!registrationId || !razorpayOrderId) {
      return res.status(400).json({ error: 'Missing required payment verification parameters' });
    }

    const verificationResult = paymentService.verifyClientSignature({
      registrationId,
      razorpayOrderId,
      razorpayPaymentId: razorpayPaymentId || `pay_sim_${Date.now()}`,
      razorpaySignature: razorpaySignature || `sig_sim_${Date.now()}`,
      paymentMethod: paymentMethod || 'Online Gateway'
    });

    if (!verificationResult.success) {
      return res.status(400).json({ error: verificationResult.message });
    }

    const registration = db.getRegistration(registrationId);
    res.json({
      success: true,
      message: 'Payment verified successfully',
      registration,
      payment: verificationResult.payment
    });
  } catch (err: any) {
    console.error('Error verifying payment:', err);
    res.status(500).json({ error: err.message || 'Unable to verify payment' });
  }
});

// 5. Payment Gateway Webhook Endpoint
app.post('/api/payment/webhook', async (req: Request, res: Response) => {
  try {
    const signature = (req.headers['x-razorpay-signature'] as string) || '';
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    const result = await paymentService.handleWebhook(rawBody, signature);
    res.status(result.status).json({ message: result.message, eventId: result.eventId });
  } catch (err: any) {
    console.error('Webhook endpoint error:', err);
    res.status(500).json({ error: 'Internal webhook handling error' });
  }
});

// 6. Get Registration Details & Status (Booking ID or registered mobile)
const lookupAttempts = new Map<string, { count: number; expires: number }>();
// Internal fields that a public Booking ID / mobile lookup must not reveal
const toPublicRegistration = ({ ip_address, user_agent, notes, payment_rejected_by, ...publicFields }: Registration) => publicFields;

// Throttle public lookups so sequential Booking IDs cannot be enumerated quickly
function throttleLookups(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  for (const [key, value] of lookupAttempts) if (value.expires <= now) lookupAttempts.delete(key);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const attempts = lookupAttempts.get(ip) || { count: 0, expires: now + 15 * 60 * 1000 };
  if (++attempts.count > 60) return res.status(429).json({ error: 'Too many lookups. Please try again in 15 minutes.' });
  lookupAttempts.set(ip, attempts);
  next();
}

const isAdminVerified = (r: Registration) => r.payment_status === 'PAID' && Boolean(r.payment_verified_at && r.payment_verified_by);

// Final receipt: issued by the server only after an admin has verified the payment.
// The verification code is an HMAC over the receipt facts, so a receipt edited or forged in the browser will not match.
app.get('/api/registration/:id/receipt', throttleLookups, (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = req.params.id.trim();
  const registration = db.getRegistration(id) || db.getRegistrationByNumber(id.toUpperCase());
  if (!registration) return res.status(404).json({ error: 'Registration not found' });
  if (!isAdminVerified(registration)) {
    return res.status(403).json({
      error: 'Payment submitted; verification pending. This is not a final booking receipt. The final receipt is issued only after our accounts team verifies the payment.',
      paymentStatus: registration.payment_status
    });
  }
  const amountReceived = registration.total_payment_received || registration.total_payable;
  const facts = [registration.registration_number, registration.utr_number || '', amountReceived, registration.payment_verified_at].join('|');
  res.json({
    receipt: {
      receipt_number: `RCPT-${registration.registration_number}`,
      registration_number: registration.registration_number,
      amount_received: amountReceived,
      utr_number: registration.utr_number || null,
      payment_verified_at: registration.payment_verified_at,
      verification_code: crypto.createHmac('sha256', `receipt:${ADMIN_SECRET}`).update(facts).digest('hex').slice(0, 16).toUpperCase()
    }
  });
});

app.get('/api/registration/:id', throttleLookups, (req: Request, res: Response) => {
  const id = req.params.id.trim();
  const directMatch = db.getRegistration(id) || db.getRegistrationByNumber(id.toUpperCase());
  const registrations = directMatch ? [directMatch] : /^[+\d\s()-]+$/.test(id)
    ? db.listRegistrations().filter(reg => {
        const queryMobile = validateAndNormalizeMobile(id, reg.country);
        const storedMobile = validateAndNormalizeMobile(reg.mobile, reg.country);
        return queryMobile.valid && storedMobile.valid && queryMobile.normalized === storedMobile.normalized;
      })
    : [];
  const registration = registrations[0];

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  const payments = db.getPaymentsForRegistration(registration.id);

  // Return clean client-safe view
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    registration: toPublicRegistration(registration),
    payments,
    bookings: registrations.map(reg => ({
      registration: toPublicRegistration(reg),
      payments: db.getPaymentsForRegistration(reg.id)
    })),
    isPaid: registration.payment_status === 'PAID',
    canRetry: registration.payment_status === 'FAILED' || registration.payment_status === 'INITIATED'
  });
});

// 7. Retry Payment for existing registration
app.post('/api/payment/retry', async (req: Request, res: Response) => {
  try {
    const { registrationId } = req.body;
    const registration = db.getRegistration(registrationId);

    if (!registration) {
      return res.status(404).json({ error: 'Registration record not found' });
    }

    if (registration.payment_status === 'PAID') {
      return res.status(400).json({ error: 'This registration has already been paid for and confirmed.' });
    }

    const orderResult = await paymentService.createOrder({
      registrationId: registration.id,
      amount: registration.total_payable,
      currency: 'INR'
    });

    res.json({
      success: true,
      registrationId: registration.id,
      registrationNumber: registration.registration_number,
      order: orderResult
    });
  } catch (err: any) {
    console.error('Error retrying payment:', err);
    res.status(500).json({ error: err.message || 'Unable to initiate payment retry' });
  }
});

// -------------------------------------------------------------
// ADMIN API ROUTES
// -------------------------------------------------------------

// Admin Login
app.post('/api/admin/login', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!adminAuthConfigured) return res.status(503).json({ error: 'Configure a strong ADMIN_JWT_SECRET before signing in' });
  const now = Date.now();
  for (const [key, value] of loginAttempts) if (value.expires <= now) loginAttempts.delete(key);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const attempts = loginAttempts.get(ip) || { count: 0, expires: now + 15 * 60 * 1000 };
  if (attempts.count >= 10) return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  attempts.count++;
  loginAttempts.set(ip, attempts);
  const { email, password } = req.body;

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || password.length > 1024) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const admin = db.getAdminByEmail(email.trim());
  if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role) || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(admin.passwordHash)) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const [, salt, storedHash] = admin.passwordHash.split(':');
  const hash = crypto.scryptSync(password, salt, 64);
  if (!crypto.timingSafeEqual(hash, Buffer.from(storedHash, 'hex'))) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const payload = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    sid: ADMIN_SESSION_EPOCH,
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(payloadBase64).digest('hex');
  const token = `${payloadBase64}.${signature}`;
  loginAttempts.delete(ip);

  db.logAudit({
    admin_id: admin.id,
    action: 'ADMIN_LOGIN',
    entity_type: 'ADMIN_USER',
    entity_id: admin.id,
    new_value: { email: admin.email, ip: req.ip }
  });

  res.json({
    token,
    user: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role
    }
  });
});

// Admin Session Check: the dashboard only renders after the server confirms a stored token
app.get('/api/admin/session', authenticateAdmin, (req: Request, res: Response) => {
  const admin = db.getAdminByEmail((req as any).adminUser.email)!;
  res.json({ user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
});

// Admin Logout: the token stops working immediately
app.post('/api/admin/logout', authenticateAdmin, (req: Request, res: Response) => {
  const now = Date.now();
  for (const [sig, exp] of revokedAdminTokens) if (exp <= now) revokedAdminTokens.delete(sig);
  const { signature, exp } = (req as any).adminToken;
  revokedAdminTokens.set(signature, exp);
  db.logAudit({
    admin_id: (req as any).adminUser.id,
    action: 'ADMIN_LOGOUT',
    entity_type: 'ADMIN_USER',
    entity_id: (req as any).adminUser.id,
    new_value: { email: (req as any).adminUser.email }
  });
  res.json({ success: true });
});

// Admin Dashboard Overview & KPIs
app.get('/api/admin/overview', authenticateAdmin, (_req: Request, res: Response) => {
  const allRegistrations = db.listRegistrations();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const thisMonthStr = now.toISOString().slice(0, 7);

  const totalRegistrations = allRegistrations.length;
  const paidRegistrations = allRegistrations.filter(r => r.payment_status === 'PAID');
  const pendingRegistrations = allRegistrations.filter(r => r.payment_status === 'INITIATED' || r.payment_status === 'PENDING');
  const failedRegistrations = allRegistrations.filter(r => r.payment_status === 'FAILED');

  const todayRegistrations = allRegistrations.filter(r => r.created_at.startsWith(todayStr));
  const todayRevenue = todayRegistrations
    .filter(r => r.payment_status === 'PAID')
    .reduce((sum, r) => sum + (r.total_payment_received || r.total_payable || 0), 0);

  const monthRegistrations = allRegistrations.filter(r => r.created_at.startsWith(thisMonthStr));
  const monthRevenue = monthRegistrations
    .filter(r => r.payment_status === 'PAID')
    .reduce((sum, r) => sum + (r.total_payment_received || r.total_payable || 0), 0);

  const totalRevenue = paidRegistrations.reduce((sum, r) => sum + (r.total_payment_received || r.total_payable || 0), 0);

  // Group by project
  const projectBreakdown: Record<string, { count: number; paidCount: number; revenue: number; name: string }> = {};
  allRegistrations.forEach(r => {
    if (!projectBreakdown[r.project_id]) {
      projectBreakdown[r.project_id] = { count: 0, paidCount: 0, revenue: 0, name: r.project_name };
    }
    projectBreakdown[r.project_id].count += 1;
    if (r.payment_status === 'PAID') {
      projectBreakdown[r.project_id].paidCount += 1;
      projectBreakdown[r.project_id].revenue += (r.total_payment_received || r.total_payable || 0);
    }
  });

  res.json({
    metrics: {
      totalRegistrations,
      paidRegistrations: paidRegistrations.length,
      pendingPayments: pendingRegistrations.length,
      failedPayments: failedRegistrations.length,
      todayRegistrations: todayRegistrations.length,
      todayRevenue,
      thisMonthRevenue: monthRevenue,
      totalRevenue,
      projectBreakdown: Object.values(projectBreakdown)
    },
    integrations: {
      appUrl: process.env.APP_SUBDOMAIN || process.env.APP_URL || null,
      razorpayConfigured: paymentService.getPublicConfig().isLiveCredentialsConfigured,
      webhookSecretConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET && !process.env.RAZORPAY_WEBHOOK_SECRET.includes('your_')),
      simulatedPaymentsAllowed: !isProd && process.env.ALLOW_SIMULATED_PAYMENTS === 'true',
      googleSheetsConfigured: googleSheetsService.getStatus().isConnected
    },
    projectBreakdown: Object.values(projectBreakdown),
    recentRegistrations: allRegistrations.slice(0, 8),
    recentAudit: db.listAuditLogs(6)
  });
});

// Admin List Registrations with Search & Filter
app.get('/api/admin/registrations', authenticateAdmin, (req: Request, res: Response) => {
  const {
    search,
    projectId,
    paymentStatus,
    registrationStatus,
    startDate,
    endDate,
    page = '1',
    limit = '15'
  } = req.query as Record<string, string>;

  const filtered = db.listRegistrations({
    search,
    projectId,
    paymentStatus,
    registrationStatus,
    startDate,
    endDate
  });

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 15;
  const startIndex = (pageNum - 1) * limitNum;
  const paginated = filtered.slice(startIndex, startIndex + limitNum);

  res.json({
    registrations: paginated,
    pagination: {
      total: filtered.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(filtered.length / limitNum) || 1
    }
  });
});

// Admin Single Registration Detail
app.get('/api/admin/registration/:id', authenticateAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const registration = db.getRegistration(id) || db.getRegistrationByNumber(id);

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  const payments = db.getPaymentsForRegistration(registration.id);

  db.logAudit({
    admin_id: (req as any).adminUser.id,
    action: 'REGISTRATION_VIEWED',
    entity_type: 'REGISTRATION',
    entity_id: registration.id,
    new_value: { registrationNumber: registration.registration_number }
  });

  res.json({ registration, payments });
});

// Admin Update Registration Status
app.patch('/api/admin/registration/:id/status', authenticateAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const { registrationStatus, paymentStatus, notes } = req.body;
  const registration = db.getRegistration(id);

  if (paymentStatus && !['CANCELLED'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'Use the payment verification action to approve or reject a payment' });
  }

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  const oldValues = {
    registration_status: registration.registration_status,
    payment_status: registration.payment_status
  };

  if (registrationStatus) registration.registration_status = registrationStatus as RegistrationStatus;
  if (paymentStatus) registration.payment_status = paymentStatus as PaymentStatus;
  if (notes !== undefined) registration.notes = notes;
  registration.updated_at = new Date().toISOString();

  db.saveRegistration(registration);

  db.logAudit({
    admin_id: (req as any).adminUser.id,
    action: 'REGISTRATION_STATUS_UPDATED',
    entity_type: 'REGISTRATION',
    entity_id: registration.id,
    old_value: oldValues,
    new_value: { registration_status: registration.registration_status, payment_status: registration.payment_status }
  });

  res.json({ success: true, registration });
});

// Admin Export CSV
app.get('/api/admin/export-csv', authenticateAdmin, (req: Request, res: Response) => {
  const { search, projectId, paymentStatus, registrationStatus } = req.query as Record<string, string>;
  // Every matching booking (no pagination), one row per booking
  const seen = new Set<string>();
  const list = db.listRegistrations({ search: search?.trim(), projectId, paymentStatus, registrationStatus })
    .filter(r => !seen.has(r.id) && seen.add(r.id));
  if (list.length === 0) {
    return res.status(404).json({ error: 'No bookings match the current search and filter.' });
  }

  const headers = [
    'Booking ID', 'Applicant Name', 'Co-applicant Name', 'Registered Mobile Number', 'Email Address', 'City', 'Address',
    'Project Name', 'Selected Unit / Plan', 'Number of Units', 'Token Amount Payable (INR)', 'Total Payment Received (INR)',
    'Payment Mode', 'Submitted UTR / Transaction Reference', 'Payment Status', 'Booking Status', 'Payment Verification Status',
    'Booking Created Date', 'Payment Submitted Date', 'Payment Verified Date', 'Admin Verification Result'
  ];

  const istDate = (iso?: string) => iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }) : '';
  const verificationResult = (r: Registration) => {
    if (r.payment_status === 'PAID' && r.payment_verified_at && r.payment_verified_by) return 'Verified';
    if (r.payment_status === 'FAILED' && r.payment_rejected_at) return 'Rejected';
    if (r.payment_status === 'PENDING' && r.utr_number) return 'Awaiting admin review';
    return '';
  };
  const escapeCsv = (val: unknown) => {
    let s = String(val ?? '');
    // Long digit strings (mobile, UTR) stay text in Excel instead of turning into 9.19E+11
    if (/^\+?\d{10,}$/.test(s)) return `="${s}"`;
    // Neutralise spreadsheet formulas in free-text fields
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };

  const rows = list.map(r => [
    r.registration_number,
    r.full_name,
    r.co_applicant_name,
    r.mobile,
    r.email,
    r.city,
    r.address,
    r.project_name,
    r.selected_plan || r.unit_number,
    r.units_count,
    r.total_payable,
    r.total_payment_received,
    r.mode_of_payment,
    r.utr_number,
    r.payment_status,
    r.registration_status,
    getPaymentStatusLabel(r),
    istDate(r.created_at),
    istDate(r.payment_submitted_at),
    istDate(r.payment_verified_at),
    verificationResult(r)
  ].map(escapeCsv).join(','));

  // UTF-8 BOM + CRLF so Excel opens it with the ₹/– characters intact
  const csvContent = '﻿' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n') + '\r\n';
  const filename = `garg-realty-bookings-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' })}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Export-Count', String(list.length));
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Count');
  res.send(csvContent);
});

// Admin Webhook Simulator & Testing Tool
app.post('/api/admin/webhook/simulate', authenticateAdmin, async (req: Request, res: Response) => {
  try {
    // Simulated captures mark a booking paid without real money; local testing only
    if (isProd || process.env.ALLOW_SIMULATED_PAYMENTS !== 'true') {
      return res.status(403).json({ error: 'Webhook simulation is disabled. Use Verify Payment to approve a submitted UTR.' });
    }
    const { eventType, orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const simResult = await paymentService.simulateWebhookEvent(eventType || 'payment.captured', orderId, true);
    res.json({ success: true, simResult });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Admin Audit Logs & Webhook Event Logs
app.get('/api/admin/audit-logs', authenticateAdmin, (_req: Request, res: Response) => {
  res.json({
    auditLogs: db.listAuditLogs(50),
    webhookEvents: db.listWebhookEvents(30)
  });
});

// -------------------------------------------------------------
// GOOGLE SHEETS "Payment Domain" INTEGRATION ENDPOINTS
// -------------------------------------------------------------

// Get Google Sheets sync status and column schema (Admin Only)
app.get('/api/admin/google-sheets/status', authenticateAdmin, (_req: Request, res: Response) => {
  const status = googleSheetsService.getStatus();
  res.json({
    success: true,
    ...status,
    // Setup problems only (variable names / file paths), never key material
    configProblems: status.isConnected ? [] : loadSheetsCredentials().problems,
    totalRegistrations: db.listRegistrations().length
  });
});

// Connect admin Google Workspace OAuth access token (Admin Only)
app.post('/api/admin/google-sheets/connect', authenticateAdmin, async (req: Request, res: Response) => {
  try {
    const { accessToken, expiresIn } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'OAuth accessToken is required' });
    }

    googleSheetsService.setAccessToken(accessToken, expiresIn || 3600);

    // Sync all existing registrations to "Payment Domain"
    const syncResult = await googleSheetsService.syncAll(accessToken);

    res.json({
      success: true,
      message: 'Google Sheets ("Payment Domain") connected and synchronized successfully',
      syncResult,
      status: googleSheetsService.getStatus()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to connect Google Sheets' });
  }
});

// Trigger manual sync of all registrations to "Payment Domain" (Admin Only)
app.post('/api/admin/google-sheets/sync-all', authenticateAdmin, async (_req: Request, res: Response) => {
  try {
    const syncResult = await googleSheetsService.syncAll();
    res.json({
      success: true,
      syncResult,
      status: googleSheetsService.getStatus()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to sync Google Sheets' });
  }
});

// Format a sample row for testing / previewing (Admin Only)
app.get('/api/admin/google-sheets/preview-row/:id', authenticateAdmin, (req: Request, res: Response) => {
  const { id } = req.params;
  const reg = db.getRegistration(id) || db.getRegistrationByNumber(id);
  if (!reg) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  const row = formatRegistrationToRow(reg);
  res.json({
    columns: GOOGLE_SHEET_COLUMNS,
    row,
    columnCount: GOOGLE_SHEET_COLUMNS.length
  });
});

// -------------------------------------------------------------
// VITE MIDDLEWARE (DEV) & STATIC (PROD)
// -------------------------------------------------------------
async function setupServer() {
  // Always serve public assets (like /logo-mark.png, /payment-qr.jpeg)
  const publicPath = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicPath));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} (Env: ${process.env.NODE_ENV || 'development'})`);
    if (!adminAuthConfigured) console.warn('Admin login disabled: set ADMIN_JWT_SECRET (32+ chars) in the project-root .env');
    if (!db.getAdminByEmail(process.env.ADMIN_EMAIL?.trim() || '')) console.warn('Admin account not provisioned: set ADMIN_EMAIL and ADMIN_PASSWORD (16+ chars) in the project-root .env');
    console.log(`Garg Realty Portal ready on http://localhost:${PORT}`);

    // Say loudly, at startup, whether bookings can actually be recorded in Google Sheets
    googleSheetsService.diagnose().then(report => {
      if (report.ok) {
        console.log(`[Google Sheets] READY - bookings will be appended to spreadsheet ${report.steps[0].detail}, tab "${report.steps[1].detail}".`);
      } else {
        const failed = report.steps.find(s => !s.ok)!;
        console.log(
          `[Google Sheets] Optional mirror not configured - bookings and UTR submissions are saved in the local database (data/db.json).\n` +
          `  (${failed.step}): ${failed.detail}`
        );
      }
    }).catch(err => console.error('[Google Sheets] Startup check failed:', err.message));
  });
}

setupServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
