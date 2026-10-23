// Load .env before any service module reads process.env
import { APP_ROOT } from './src/server/loadEnv.js';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { db, initDatabase, DuplicateRecordError, DatabaseUnavailableError } from './src/server/db.js';
import type { Store } from './src/server/store.js';
import { paymentService } from './src/server/paymentService.js';
import { crmService } from './src/server/crmService.js';
import { emailService } from './src/server/emailService.js';
import { Registration, PaymentStatus, RegistrationStatus, PaymentRecord, Project, OwnershipPlan } from './src/types.js';
import { googleSheetsService, formatRegistrationToRow, GOOGLE_SHEET_COLUMNS, ALLOWED_PLANS, loadSheetsCredentials } from './src/server/googleSheetsService.js';
import { normalizeUnitOption, getPaymentStatusLabel, PANGOT_ID, DHOLERA_ID, PUBLIC_PROJECT_IDS, PAYMENT_QR_SRC, PANGOT_PAYMENT_MODE } from './src/bookingOptions.js';

const app = express();
// Express 4 does not catch errors thrown by async handlers: forward them to the error handler instead of
// leaving the request hanging (database outages then return a clear 503).
for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
  const original = (app as any)[method].bind(app);
  (app as any)[method] = (path: unknown, ...handlers: unknown[]) => {
    if (!handlers.length) return original(path); // app.get('setting')
    return original(path, ...handlers.map(h => typeof h !== 'function' ? h : (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = (h as Function)(req, res, next);
        if (result && typeof result.catch === 'function') result.catch(next);
      } catch (err) {
        next(err);
      }
    }));
  };
}
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * Response for a route's catch block. A database outage returns 503 and says nothing was saved;
 * any other error returns the given safe message. Internal error text is logged, never sent to the browser.
 */
function sendFailure(res: Response, err: unknown, message: string) {
  if (res.headersSent) return;
  if (err instanceof DatabaseUnavailableError) {
    console.error('[Database]', err.message);
    return res.status(503).json({ error: 'The booking system is temporarily unavailable. Nothing was saved. Please try again in a few minutes.', retryable: true });
  }
  console.error('[Server]', message, '-', (err as any)?.message || err);
  return res.status(500).json({ error: message, retryable: true });
}
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
async function authenticateAdmin(req: Request, res: Response, next: NextFunction) {
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

    const admin = typeof payload.email === 'string' ? await db.getAdminByEmail(payload.email) : null;
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

// -------------------------------------------------------------
// PROJECTS — Pangot and Dholera are configured, booked and reported separately
// -------------------------------------------------------------
const projectShortName = (p: Project) => p.short_name || p.name;
const activePlans = (p: Project) => (p.ownership_plans || []).filter(pl => pl.active !== false);

/** Units of a plan held by bookings: verified payments plus submitted UTRs awaiting review */
async function unitsHeld(projectId: string, planLabel: string, store: Store = db) {
  return (await store.listRegistrations({ projectId }))
    .filter(r => r.selected_plan === planLabel && (r.payment_status === 'PAID' || (r.payment_status === 'PENDING' && Boolean(r.utr_number))))
    .reduce((n, r) => n + (r.units_count || 1), 0);
}
/** Remaining units of a plan, or null when the plan's inventory is not tracked */
async function planAvailability(p: Project, plan: OwnershipPlan, store: Store = db): Promise<number | null> {
  return typeof plan.inventory === 'number' ? Math.max(0, plan.inventory - await unitsHeld(p.id, plan.label, store)) : null;
}
function paymentQrUrl(p: Project): string | undefined {
  if (p.id === PANGOT_ID) return PAYMENT_QR_SRC;
  return p.payment_qr_data ? `/api/projects/${p.id}/payment-qr?v=${encodeURIComponent(p.payment_qr_updated_at || p.updated_at)}` : undefined;
}
/** What customers may see. A project that is not open for booking shows no prices, plots, QR or terms. */
async function toPublicProject(p: Project) {
  const base = {
    id: p.id, code: p.code, name: p.name, short_name: projectShortName(p), display_name: p.display_name || p.name,
    tagline: p.tagline, location: p.location, currency: p.currency, booking_enabled: Boolean(p.booking_enabled)
  };
  if (!p.booking_enabled) return base;
  return {
    ...base,
    description: p.description,
    features: p.features,
    token_amount: p.token_amount,
    total_price: p.total_price,
    roi_percentage: p.roi_percentage,
    unit_types: p.unit_types,
    ownership_plans: await Promise.all(activePlans(p).map(async pl => ({ ...pl, available: await planAvailability(p, pl) }))),
    payee_name: p.payee_name,
    refund_policy: p.refund_policy,
    payment_qr_url: paymentQrUrl(p)
  };
}
/** Terms a booking's documents need (refund policy, payee) even if bookings are later closed */
async function projectTermsFor(projectId: string) {
  const p = await db.getProject(projectId);
  if (!p) return null;
  return {
    id: p.id, short_name: projectShortName(p), location: p.location, refund_policy: p.refund_policy || '', payee_name: p.payee_name || '',
    payment_qr_url: p.booking_enabled ? paymentQrUrl(p) : undefined
  };
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
app.get('/api/config', async (_req: Request, res: Response) => {
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
app.get('/api/projects', async (_req: Request, res: Response) => {
  const projects = await Promise.all((await db.listProjects(true)).map(p => toPublicProject(p)));
  res.json({ projects });
});

// Payment QR of a published project (Pangot's QR is a static file in /public)
app.get('/api/projects/:id/payment-qr', async (req: Request, res: Response) => {
  const project = await db.getProject(req.params.id);
  const match = project?.booking_enabled ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(project.payment_qr_data || '') : null;
  if (!match) return res.status(404).json({ error: 'Payment QR not available' });
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(Buffer.from(match[2], 'base64'));
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

    // Each booking belongs to exactly one project; only published projects accept bookings
    const targetProjectId = String(projectId || PANGOT_ID);
    const project = (PUBLIC_PROJECT_IDS as readonly string[]).includes(targetProjectId) ? await db.getProject(targetProjectId) : null;
    if (!project) {
      return res.status(400).json({ error: 'Please choose a valid project' });
    }
    if (!project.booking_enabled) {
      return res.status(409).json({ error: `Bookings for ${projectShortName(project)} are not open yet. Please check back soon.` });
    }

    const unitsCount = Math.max(1, parseInt(req.body.numberOfUnits || req.body.unitsCount || '1', 10) || 1);
    let selectedPlan: string;
    let tokenPerUnit: number;
    let totalPrice: number;
    if (project.id === PANGOT_ID) {
      // Pangot: strictly one of the 4 allowed unit options, token per unit from the project
      const pangotPlan = normalizeUnitOption(req.body.selectedPlan || req.body.unitSize);
      if (!pangotPlan) {
        return res.status(400).json({
          error: `Invalid unit selected. Unit must be strictly one of: ${ALLOWED_PLANS.join(', ')}`
        });
      }
      selectedPlan = pangotPlan;
      tokenPerUnit = project.token_amount;
      totalPrice = project.total_price;
    } else {
      // Other projects: one of the plots/units the admin has published, with its own price, token and inventory
      const wanted = String(req.body.selectedPlan || '').trim();
      const plan = activePlans(project).find(pl => pl.id === wanted || pl.label === wanted);
      if (!plan || !plan.token_amount || plan.token_amount <= 0) {
        return res.status(400).json({ error: `Please select one of the available ${projectShortName(project)} plots` });
      }
      if (unitsCount > 10) {
        return res.status(400).json({ error: 'A maximum of 10 units can be booked at once' });
      }
      const available = await planAvailability(project, plan);
      if (available !== null && unitsCount > available) {
        return res.status(409).json({ error: available === 0 ? `${plan.label} is sold out` : `Only ${available} unit(s) of ${plan.label} are available` });
      }
      selectedPlan = plan.label;
      tokenPerUnit = plan.token_amount;
      totalPrice = (plan.total_price || 0) * unitsCount;
    }
    const tokenAmount = tokenPerUnit * unitsCount;
    const taxPercentage = 0; // Fixed 0% surcharge on advance token
    const taxAmount = 0;
    const totalPayable = tokenAmount;

    // Check for existing pending registration with exact same details to prevent duplicates (only if unpaid)
    // Only an unpaid booking of the SAME project may be reused; other projects' bookings are never touched
    let registration = await db.findRegistrationByEmailOrPhone(email, mobileCheck.normalized, project.id);
    if (registration && (registration.payment_status === 'PAID' || registration.utr_number)) {
      registration = null; // Prior booking is paid or has a payment submitted; never overwrite it, create a new booking
    }
    const isNew = !registration;

    const now = new Date().toISOString();
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    if (!registration) {
      registration = {
        id: `reg_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        registration_number: '', // assigned from the atomic counter when the booking is saved (below)
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
        project_name: projectShortName(project),
        selected_plan: selectedPlan,
        units_count: unitsCount,
        unit_number: selectedPlan,
        unit_size: selectedPlan,
        floor_no: (floorNo || '').trim(),
        total_price: totalPrice,
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
      registration.project_name = projectShortName(project);
      registration.total_price = totalPrice;
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

    // Note: nothing is written to Google Sheets yet. The spreadsheet row is appended only when the
    // customer completes the booking by submitting their UTR (see /api/payment/submit-qr-utr).

    // The booking, its Booking ID and its payment order are saved together: either all of them or none
    const booking = registration;
    const orderResult = await db.transaction(async tx => {
      if (isNew) booking.registration_number = await tx.generateRegistrationNumber(project.code || 'PNG');
      await tx.saveRegistration(booking);
      return paymentService.createOrder({
        registrationId: booking.id,
        amount: totalPayable,
        currency: 'INR',
        store: tx,
        notes: {
          registration_number: booking.registration_number,
          project_name: project.name
        }
      });
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
    sendFailure(res, err, 'Something went wrong while creating your registration. Please try again.');
  }
});

// 4. Final booking submission: QR payment reference (UTR) -> validated -> appended to Google Sheets -> confirmation
// Critical: Payment status must remain PENDING ("Payment Submitted") until verified by accounts desk.
const submissionsInFlight = new Set<string>();

// One bank transaction can only pay for one booking
async function isUtrUsedElsewhere(registrationId: string, utr: string) {
  return Boolean(await db.findActiveRegistrationByUtr(utr, registrationId));
}

/** Reasons a UTR submission is refused after locking the booking (mapped to HTTP 409 by callers) */
class SubmissionConflictError extends Error {
  /** Set when the booking already holds this exact UTR (e.g. a double click): treated as a harmless duplicate */
  constructor(message: string, public readonly existing?: Registration) { super(message); }
}

/**
 * Saves a submitted UTR on the booking as PENDING (never PAID), adds the payment record and audit entry.
 * All three are written in ONE transaction with the booking row locked, so two submissions for the same booking
 * cannot both succeed, and nothing is reported as saved unless the database committed it.
 */
async function saveUtrSubmission(
  registration: Registration,
  cleanUtr: string,
  opts: { upiApp: string; senderUpi?: string; notes?: string; auditAction: string; actor: string; auditExtra?: Record<string, unknown> }
): Promise<Registration> {
  const submission = await db.transaction(async tx => {
    // Re-read under lock: the booking may have changed since the caller's checks
    const current = await tx.getRegistrationForUpdate(registration.id);
    if (!current) throw new SubmissionConflictError('Registration record not found');
    if (current.payment_status === 'PAID') throw new SubmissionConflictError('Payment for this booking has already been verified.');
    if (current.utr_number && current.payment_status === 'PENDING') {
      throw new SubmissionConflictError(
        'A payment reference has already been submitted for this booking. Please contact us if it needs to be corrected.',
        current.utr_number.toUpperCase() === cleanUtr.toUpperCase() ? current : undefined
      );
    }

    // Timestamp is generated here on the server, never taken from the browser
    const now = new Date().toISOString();
    const project = await tx.getProject(current.project_id);

    // Critical Requirement: DO NOT mark as PAID upon submission!
    // Payment status stays PENDING until an admin verifies it against the bank statement.
    const updated: Registration = {
      ...current,
      utr_number: cleanUtr,
      upi_app: opts.upiApp,
      sender_upi: String(opts.senderUpi || '').trim(),
      payment_submitted_at: now,
      payment_status: 'PENDING',
      registration_status: 'IN_REVIEW',
      mode_of_payment: current.project_id === PANGOT_ID ? PANGOT_PAYMENT_MODE : `UPI QR (${project?.payee_name || current.project_name})`,
      updated_at: now
    };
    if (opts.notes) {
      updated.notes = `${current.notes ? current.notes + ' | ' : ''}${opts.notes.slice(0, 600)}`;
    }
    await tx.saveRegistration(updated);

    const paymentRecord: PaymentRecord = {
      id: `pay_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      registration_id: updated.id,
      registration_number: updated.registration_number,
      gateway: 'HDFC_SMARTHUB_QR',
      gateway_order_id: `hdfc_qr_${updated.registration_number}`,
      gateway_payment_id: cleanUtr,
      utr_number: cleanUtr,
      amount: updated.total_payable,
      currency: 'INR',
      payment_status: 'PENDING',
      payment_method: `HDFC SmartHub QR (${updated.upi_app})`,
      signature_verified: false,
      webhook_verified: false,
      attempt_number: (await tx.getPaymentsForRegistration(updated.id)).length + 1,
      created_at: now,
      updated_at: now
    };
    await tx.savePayment(paymentRecord);

    await tx.logAudit({
      action: opts.auditAction,
      admin_id: opts.actor,
      entity_type: 'PAYMENT',
      entity_id: updated.id,
      old_value: { registration_number: current.registration_number, payment_status: current.payment_status, utr_number: current.utr_number || null },
      new_value: {
        registration_number: updated.registration_number,
        utr_number: cleanUtr,
        amount: updated.total_payable,
        payment_status: 'PENDING',
        ...opts.auditExtra
      }
    });
    return updated;
  });

  // Optional mirror to Google Sheets after the database committed; never blocks the caller
  if (googleSheetsService.getStatus().isConnected) {
    googleSheetsService.syncRegistration(submission).then(async result => {
      // Only the sync timestamp is written: a full save here could undo a review made meanwhile
      if (result.success && result.action !== 'QUEUED') await db.markSheetSynced(submission.id, new Date().toISOString());
    }).catch(err => console.warn('Google Sheets sync warning:', err.message));
  }
  return submission;
}

/** HTTP status and customer-safe message for a failed UTR save */
function utrSaveFailure(err: unknown): { status: number; error: string } {
  if (err instanceof SubmissionConflictError) return { status: 409, error: err.message };
  if (err instanceof DuplicateRecordError) {
    return err.constraint === 'uq_registrations_active_utr'
      ? { status: 409, error: 'This UTR / Transaction Reference has already been submitted for another booking. Please check the number or contact us.' }
      : { status: 409, error: 'Your submission is already being processed. Please wait a moment.' };
  }
  if (err instanceof DatabaseUnavailableError) {
    return { status: 503, error: 'Our booking system is temporarily unavailable. Your payment details were NOT saved. Please try again in a few minutes.' };
  }
  return { status: 500, error: 'Your payment details could not be saved right now. Please try again.' };
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

    const registration = await db.getRegistration(registrationId);
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

    if (await isUtrUsedElsewhere(registration.id, cleanUtr)) {
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
      submission = await saveUtrSubmission(registration, cleanUtr, {
        upiApp: String(upiApp || 'UPI Scan & Pay').trim(),
        senderUpi,
        notes: notes ? `UTR Notes: ${String(notes)}` : undefined,
        auditAction: 'PAYMENT_UTR_SUBMITTED',
        actor: registration.full_name
      });
    } catch (saveErr) {
      // Same UTR already saved for this booking (e.g. double click): succeed without a second record
      if (saveErr instanceof SubmissionConflictError && saveErr.existing) {
        return res.json({ ...buildResponse(saveErr.existing), duplicate: true });
      }
      const failure = utrSaveFailure(saveErr);
      if (failure.status >= 500) console.error('[Database] UTR submission not saved:', (saveErr as Error).message);
      return res.status(failure.status).json({ error: failure.error, retryable: failure.status >= 500 });
    }

    res.json(buildResponse(submission));
  } catch (err: any) {
    sendFailure(res, err, 'Your payment details could not be saved right now. Please try again.');
  } finally {
    if (inFlightId) submissionsInFlight.delete(inFlightId);
  }
});

// Admin endpoint to verify a pending payment UTR and mark it PAID
app.post('/api/admin/verify-payment', authenticateAdmin, async (req: Request, res: Response) => {
  try {
    const { registrationId, verified, notes } = req.body;
    if (typeof registrationId !== 'string' || typeof verified !== 'boolean' || (notes !== undefined && typeof notes !== 'string')) {
      return res.status(400).json({ error: 'A booking ID and boolean verification decision are required' });
    }
    const adminUser = (req as any).adminUser;
    // Booking, payment record and audit entry change together, with the booking row locked against a second review
    let outcome: { status: number; error?: string; registration?: Registration };
    try {
      outcome = await db.transaction(async tx => {
        const registration = await tx.getRegistrationForUpdate(registrationId);
        if (!registration) return { status: 404, error: 'Registration not found' };
        if (!registration.utr_number || registration.payment_status !== 'PENDING') {
          return { status: 409, error: 'Only a pending payment with a submitted UTR can be reviewed' };
        }
        const now = new Date().toISOString();
        const oldValue = { payment_status: registration.payment_status, registration_status: registration.registration_status };
        if (verified) {
          registration.payment_status = 'PAID';
          registration.registration_status = 'CONFIRMED';
          registration.total_payment_received = registration.total_payable;
          registration.payment_verified_at = now;
          registration.payment_verified_by = adminUser.id;
          delete registration.payment_rejected_at;
          delete registration.payment_rejected_by;
        } else {
          // Rejection keeps the submitted UTR on the booking for the record
          registration.payment_status = 'FAILED';
          registration.total_payment_received = 0;
          delete registration.payment_verified_at;
          delete registration.payment_verified_by;
          registration.payment_rejected_at = now;
          registration.payment_rejected_by = adminUser.id;
        }
        registration.updated_at = now;
        if (notes) {
          registration.notes = `${registration.notes ? registration.notes + ' | ' : ''}Verification Notes: ${notes}`;
        }
        await tx.saveRegistration(registration);

        const payments = await tx.getPaymentsForRegistration(registration.id);
        if (payments.length > 0) {
          const p = payments[payments.length - 1];
          p.payment_status = verified ? 'PAID' : 'FAILED';
          p.signature_verified = verified;
          p.verified_at = now;
          p.updated_at = now;
          await tx.savePayment(p);
        }

        await tx.logAudit({
          action: verified ? 'PAYMENT_VERIFIED_SUCCESS' : 'PAYMENT_VERIFIED_REJECTED',
          admin_id: adminUser.id,
          entity_type: 'PAYMENT',
          entity_id: registration.id,
          old_value: { registration_number: registration.registration_number, ...oldValue },
          new_value: {
            registration_number: registration.registration_number,
            payment_status: registration.payment_status,
            registration_status: registration.registration_status,
            utr_number: registration.utr_number,
            admin_email: adminUser.email
          }
        });
        return { status: 200, registration };
      });
    } catch (txErr) {
      if (txErr instanceof DatabaseUnavailableError) {
        return res.status(503).json({ error: 'The database is temporarily unavailable. The decision was NOT saved; please try again.' });
      }
      throw txErr;
    }
    if (outcome.status !== 200 || !outcome.registration) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    const registration = outcome.registration;

    // Reflect the accounts-desk decision on this booking's own Sheets row, after the database committed
    googleSheetsService.syncRegistration(registration).then(async result => {
      // Only the sync timestamp is written: a full save here could undo a change made meanwhile
      if (result.success && result.action !== 'QUEUED') await db.markSheetSynced(registration.id, new Date().toISOString());
    }).catch(err => {
      console.warn('Google Sheets sync warning:', err.message);
    });

    // The decision (and receipt unlock) is reported only after the database committed it
    res.json({ success: true, registration });
  } catch (err: any) {
    sendFailure(res, err, 'The decision could not be saved. Please try again.');
  }
});

// Admin records a UTR on the customer's behalf (e.g. read from the customer's UPI receipt) when the customer
// could not submit it. This only records it as PENDING; Verify Payment remains a separate step.
app.post('/api/admin/registration/:id/record-utr', authenticateAdmin, async (req: Request, res: Response) => {
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
    const registration = await db.getRegistration(req.params.id);
    if (!registration) return res.status(404).json({ error: 'Registration not found' });
    if (registration.payment_status === 'PAID') {
      return res.status(409).json({ error: 'This payment has already been verified.' });
    }
    if (registration.utr_number && registration.payment_status === 'PENDING') {
      return res.status(409).json({ error: 'A UTR is already recorded for this booking and awaiting review.' });
    }
    if (await isUtrUsedElsewhere(registration.id, cleanUtr)) {
      return res.status(409).json({ error: 'This UTR is already recorded for another booking.' });
    }
    if (submissionsInFlight.has(registration.id)) {
      return res.status(409).json({ error: 'A submission for this booking is already being processed.' });
    }
    submissionsInFlight.add(registration.id);
    try {
      const adminUser = (req as any).adminUser;
      const submission = await saveUtrSubmission(registration, cleanUtr, {
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
    const failure = utrSaveFailure(err);
    res.status(failure.status).json({ error: failure.status >= 500 ? 'The UTR could not be saved. Please try again.' : failure.error });
  }
});

// 4. Verify Payment (Client checkout completion callback)
app.post('/api/payment/verify', async (req: Request, res: Response) => {
  try {
    const { registrationId, razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentMethod } = req.body;

    if (!registrationId || !razorpayOrderId) {
      return res.status(400).json({ error: 'Missing required payment verification parameters' });
    }

    const verificationResult = await paymentService.verifyClientSignature({
      registrationId,
      razorpayOrderId,
      razorpayPaymentId: razorpayPaymentId || `pay_sim_${Date.now()}`,
      razorpaySignature: razorpaySignature || `sig_sim_${Date.now()}`,
      paymentMethod: paymentMethod || 'Online Gateway'
    });

    if (!verificationResult.success) {
      return res.status(400).json({ error: verificationResult.message });
    }

    const registration = await db.getRegistration(registrationId);
    res.json({
      success: true,
      message: 'Payment verified successfully',
      registration,
      payment: verificationResult.payment
    });
  } catch (err: any) {
    console.error('Error verifying payment:', err);
    sendFailure(res, err, 'Unable to verify payment');
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
app.get('/api/registration/:id/receipt', throttleLookups, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const id = req.params.id.trim();
  const registration = await db.getRegistration(id) || await db.getRegistrationByNumber(id.toUpperCase());
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

app.get('/api/registration/:id', throttleLookups, async (req: Request, res: Response) => {
  const id = req.params.id.trim();
  const directMatch = await db.getRegistration(id) || await db.getRegistrationByNumber(id.toUpperCase());
  // Mobile lookup: the database narrows by the last 10 digits, then the exact normalized number must match
  const digits = id.replace(/\D/g, '');
  const registrations = directMatch ? [directMatch] : /^[+\d\s()-]+$/.test(id) && digits.length >= 7
    ? (await db.listRegistrations({ search: digits.slice(-10) })).filter(reg => {
        const queryMobile = validateAndNormalizeMobile(id, reg.country);
        const storedMobile = validateAndNormalizeMobile(reg.mobile, reg.country);
        return queryMobile.valid && storedMobile.valid && queryMobile.normalized === storedMobile.normalized;
      })
    : [];
  const registration = registrations[0];

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  const payments = await db.getPaymentsForRegistration(registration.id);

  // Return clean client-safe view
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    registration: toPublicRegistration(registration),
    projectTerms: Object.fromEntries(await Promise.all([...new Set(registrations.map(r => r.project_id))].map(async pid => [pid, await projectTermsFor(pid)]))),
    payments,
    bookings: await Promise.all(registrations.map(async reg => ({
      registration: toPublicRegistration(reg),
      payments: await db.getPaymentsForRegistration(reg.id)
    }))),
    isPaid: registration.payment_status === 'PAID',
    canRetry: registration.payment_status === 'FAILED' || registration.payment_status === 'INITIATED'
  });
});

// 7. Retry Payment for existing registration
app.post('/api/payment/retry', async (req: Request, res: Response) => {
  try {
    const { registrationId } = req.body;
    const registration = await db.getRegistration(registrationId);

    if (!registration) {
      return res.status(404).json({ error: 'Registration record not found' });
    }

    if (registration.payment_status === 'PAID') {
      return res.status(400).json({ error: 'This registration has already been paid for and confirmed.' });
    }
    const bookingProject = await db.getProject(registration.project_id);
    if (!bookingProject?.booking_enabled || !paymentQrUrl(bookingProject)) {
      return res.status(409).json({ error: 'Online payment for this project is not open at the moment. Please contact us for payment details.' });
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
    sendFailure(res, err, 'Unable to open the payment page. Please try again.');
  }
});

// -------------------------------------------------------------
// ADMIN API ROUTES
// -------------------------------------------------------------

// Admin Login
app.post('/api/admin/login', async (req: Request, res: Response) => {
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

  const admin = await db.getAdminByEmail(email.trim());
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

  await db.logAudit({
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
app.get('/api/admin/session', authenticateAdmin, async (req: Request, res: Response) => {
  const admin = await db.getAdminByEmail((req as any).adminUser.email);
  if (!admin) return res.status(401).json({ error: 'Session no longer valid' });
  res.json({ user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
});

// Admin Logout: the token stops working immediately
app.post('/api/admin/logout', authenticateAdmin, async (req: Request, res: Response) => {
  const now = Date.now();
  for (const [sig, exp] of revokedAdminTokens) if (exp <= now) revokedAdminTokens.delete(sig);
  const { signature, exp } = (req as any).adminToken;
  revokedAdminTokens.set(signature, exp);
  await db.logAudit({
    admin_id: (req as any).adminUser.id,
    action: 'ADMIN_LOGOUT',
    entity_type: 'ADMIN_USER',
    entity_id: (req as any).adminUser.id,
    new_value: { email: (req as any).adminUser.email }
  });
  res.json({ success: true });
});

// -------------------------------------------------------------
// ADMIN: PROJECTS & INVENTORY (Pangot is fixed; Dholera is managed here)
// -------------------------------------------------------------
const EDITABLE_PROJECT_IDS = [DHOLERA_ID];
const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Why a project cannot be published yet (empty list = ready) */
function publishProblems(p: Project): string[] {
  const problems: string[] = [];
  const plans = activePlans(p);
  if (!plans.length) problems.push('Add at least one plot/unit');
  plans.forEach(pl => {
    if (!(pl.total_price && pl.total_price > 0)) problems.push(`${pl.label}: price is required`);
    if (!(pl.token_amount && pl.token_amount > 0)) problems.push(`${pl.label}: token amount is required`);
    if (typeof pl.inventory !== 'number') problems.push(`${pl.label}: inventory is required`);
  });
  if (!p.payee_name) problems.push('Payee / account name is required');
  if (!p.refund_policy || p.refund_policy.length < 20) problems.push('Refund policy is required');
  if (!p.payment_qr_data) problems.push('Upload the payment QR code');
  return problems;
}

async function adminProjectView(p: Project) {
  const regs = await db.listRegistrations({ projectId: p.id });
  return {
    ...p,
    payment_qr_url: paymentQrUrl(p),
    editable: EDITABLE_PROJECT_IDS.includes(p.id),
    publish_problems: EDITABLE_PROJECT_IDS.includes(p.id) ? publishProblems(p) : [],
    booking_count: regs.length,
    ownership_plans: (p.ownership_plans || []).map(pl => {
      // Same rule as unitsHeld(), computed from the bookings already loaded above
      const held = regs
        .filter(r => r.selected_plan === pl.label && (r.payment_status === 'PAID' || (r.payment_status === 'PENDING' && Boolean(r.utr_number))))
        .reduce((n, r) => n + (r.units_count || 1), 0);
      return {
        ...pl,
        held,
        available: typeof pl.inventory === 'number' ? Math.max(0, pl.inventory - held) : null,
        bookings: regs.filter(r => r.selected_plan === pl.label).length
      };
    })
  };
}

app.get('/api/admin/projects', authenticateAdmin, async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ projects: await Promise.all((await db.listProjects(false)).map(p => adminProjectView(p))) });
});

// Update a project's details and plots. Existing bookings keep the amounts saved on them.
app.put('/api/admin/projects/:id', authenticateAdmin, async (req: Request, res: Response) => {
  const project = await db.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!EDITABLE_PROJECT_IDS.includes(project.id)) {
    return res.status(403).json({ error: `${projectShortName(project)} uses its fixed, verified configuration and cannot be edited here` });
  }
  const body = req.body || {};
  if (!Array.isArray(body.ownership_plans) || body.ownership_plans.length > 50) {
    return res.status(400).json({ error: 'Plots/units must be a list (maximum 50)' });
  }
  const toAmount = (v: unknown) => (v === '' || v === null || v === undefined ? 0 : Number(v));
  const plans: OwnershipPlan[] = [];
  for (const raw of body.ownership_plans) {
    const label = cleanText(raw?.label, 80);
    const totalPrice = toAmount(raw?.total_price);
    const token = toAmount(raw?.token_amount);
    const inventory = raw?.inventory === '' || raw?.inventory === null || raw?.inventory === undefined ? undefined : Number(raw.inventory);
    if (label.length < 2) return res.status(400).json({ error: 'Every plot/unit needs a name' });
    if (plans.some(pl => pl.label.toLowerCase() === label.toLowerCase())) return res.status(400).json({ error: `Duplicate plot/unit name: ${label}` });
    if (![totalPrice, token].every(n => Number.isInteger(n) && n >= 0 && n <= 1_000_000_000)) {
      return res.status(400).json({ error: `${label}: price and token must be whole rupee amounts` });
    }
    if (totalPrice > 0 && token > totalPrice) return res.status(400).json({ error: `${label}: token amount cannot exceed the price` });
    if (inventory !== undefined && !(Number.isInteger(inventory) && inventory >= 0 && inventory <= 100000)) {
      return res.status(400).json({ error: `${label}: inventory must be a whole number` });
    }
    const held = await unitsHeld(project.id, label);
    if (inventory !== undefined && inventory < held) {
      return res.status(409).json({ error: `${label}: inventory cannot be lower than the ${held} unit(s) already booked` });
    }
    plans.push({
      id: cleanText(raw?.id, 60) || `plot_${crypto.randomUUID().slice(0, 8)}`,
      name: label, label, size: cleanText(raw?.size, 60),
      total_price: totalPrice, token_amount: token, inventory, active: raw?.active !== false
    });
  }
  // A plot that already has bookings can be hidden but never renamed or removed
  const projectBookings = await db.listRegistrations({ projectId: project.id });
  for (const old of project.ownership_plans || []) {
    const booked = projectBookings.some(r => r.selected_plan === old.label);
    if (booked && !plans.some(pl => pl.label === old.label)) {
      return res.status(409).json({ error: `"${old.label}" has bookings and cannot be renamed or removed. Untick "Available" to hide it instead.` });
    }
  }

  const before = { plans: (project.ownership_plans || []).map(pl => `${pl.label}: ₹${pl.total_price} / token ₹${pl.token_amount} / inv ${pl.inventory ?? '-'}`), payee: project.payee_name };
  const updated: Project = {
    ...project,
    display_name: cleanText(body.display_name, 120) || project.display_name,
    tagline: cleanText(body.tagline, 160),
    location: cleanText(body.location, 160) || project.location,
    description: String(body.description ?? '').trim().slice(0, 2000),
    features: Array.isArray(body.features) ? body.features.map((x: unknown) => cleanText(x, 160)).filter(Boolean).slice(0, 12) : [],
    payee_name: cleanText(body.payee_name, 120),
    refund_policy: String(body.refund_policy ?? '').trim().slice(0, 2000),
    ownership_plans: plans,
    unit_types: plans.filter(pl => pl.active !== false).map(pl => pl.label),
    admin_configured_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (updated.booking_enabled && publishProblems(updated).length) {
    return res.status(409).json({ error: `Bookings are open, so this change cannot leave the project incomplete: ${publishProblems(updated).join('; ')}` });
  }
  await db.transaction(async tx => {
    await tx.saveProject(updated);
    await tx.logAudit({
      admin_id: (req as any).adminUser.id, action: 'PROJECT_UPDATED', entity_type: 'PROJECT', entity_id: project.id,
      old_value: before,
      new_value: { plans: plans.map(pl => `${pl.label}: ₹${pl.total_price} / token ₹${pl.token_amount} / inv ${pl.inventory ?? '-'}`), payee: updated.payee_name, admin_email: (req as any).adminUser.email }
    });
  });
  res.json({ success: true, project: await adminProjectView(updated) });
});

// Upload the project's payment QR (PNG/JPEG/WebP, max 1 MB)
app.post('/api/admin/projects/:id/payment-qr', authenticateAdmin, async (req: Request, res: Response) => {
  const project = await db.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!EDITABLE_PROJECT_IDS.includes(project.id)) return res.status(403).json({ error: `${projectShortName(project)}'s payment QR is fixed and cannot be changed here` });
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.imageDataUrl || ''));
  if (!match) return res.status(400).json({ error: 'Upload a PNG, JPEG or WebP image of the payment QR' });
  const bytes = Buffer.from(match[2], 'base64');
  const magicOk = (match[1] === 'image/png' && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))
    || (match[1] === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8)
    || (match[1] === 'image/webp' && bytes.subarray(8, 12).toString('ascii') === 'WEBP');
  if (!magicOk) return res.status(400).json({ error: 'The file is not a valid image' });
  if (bytes.length > 1024 * 1024) return res.status(400).json({ error: 'The QR image must be 1 MB or smaller' });
  const now = new Date().toISOString();
  const updated: Project = { ...project, payment_qr_data: `data:${match[1]};base64,${match[2]}`, payment_qr_updated_at: now, admin_configured_at: now, updated_at: now };
  await db.transaction(async tx => {
    await tx.saveProject(updated);
    await tx.logAudit({
      admin_id: (req as any).adminUser.id, action: 'PROJECT_PAYMENT_QR_UPDATED', entity_type: 'PROJECT', entity_id: project.id,
      new_value: { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16), admin_email: (req as any).adminUser.email }
    });
  });
  res.json({ success: true, project: await adminProjectView(updated) });
});

// Open or close bookings. Opening requires complete details and the admin's confirmation that they are verified.
app.post('/api/admin/projects/:id/booking-status', authenticateAdmin, async (req: Request, res: Response) => {
  const project = await db.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!EDITABLE_PROJECT_IDS.includes(project.id)) return res.status(403).json({ error: `${projectShortName(project)} bookings are managed by its fixed configuration` });
  const enable = req.body?.enabled === true;
  if (enable) {
    const problems = publishProblems(project);
    if (problems.length) return res.status(409).json({ error: `Complete these before opening bookings: ${problems.join('; ')}`, problems });
    if (req.body?.confirmVerified !== true) {
      return res.status(400).json({ error: 'Confirm that the prices, token amounts, QR code and refund policy are verified before opening bookings' });
    }
  }
  const now = new Date().toISOString();
  const adminUser = (req as any).adminUser;
  const updated: Project = {
    ...project, booking_enabled: enable, updated_at: now,
    ...(enable ? { details_verified_at: now, details_verified_by: adminUser.email } : {})
  };
  await db.transaction(async tx => {
    await tx.saveProject(updated);
    await tx.logAudit({
      admin_id: adminUser.id, action: enable ? 'PROJECT_BOOKINGS_OPENED' : 'PROJECT_BOOKINGS_CLOSED', entity_type: 'PROJECT', entity_id: project.id,
      old_value: { booking_enabled: Boolean(project.booking_enabled) }, new_value: { booking_enabled: enable, admin_email: adminUser.email }
    });
  });
  res.json({ success: true, project: await adminProjectView(updated) });
});

// Admin Dashboard Overview & KPIs
app.get('/api/admin/overview', authenticateAdmin, async (req: Request, res: Response) => {
  // All figures can be limited to one project (?projectId=proj_pangot | proj_dholera); default is all projects
  const projectFilter = typeof req.query.projectId === 'string' && req.query.projectId !== 'all' ? req.query.projectId : undefined;
  const allRegistrations = await db.listRegistrations({ projectId: projectFilter });
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

  // Per-project figures (each project counted only from its own bookings)
  const breakdownIds = projectFilter ? [projectFilter] : [...new Set([...PUBLIC_PROJECT_IDS, ...allRegistrations.map(r => r.project_id)])];
  const projectBreakdown = await Promise.all(breakdownIds.map(async id => {
    const project = await db.getProject(id);
    const regs = allRegistrations.filter(r => r.project_id === id);
    const paid = regs.filter(r => r.payment_status === 'PAID');
    const plans = project ? activePlans(project).filter(pl => typeof pl.inventory === 'number') : [];
    // Units held = verified payments + submitted UTRs awaiting review (same rule as unitsHeld)
    const held = regs
      .filter(r => plans.some(pl => pl.label === r.selected_plan) && (r.payment_status === 'PAID' || (r.payment_status === 'PENDING' && Boolean(r.utr_number))))
      .reduce((n, r) => n + (r.units_count || 1), 0);
    const total = plans.reduce((n, pl) => n + (pl.inventory || 0), 0);
    return {
      id,
      name: project ? projectShortName(project) : (regs[0]?.project_name || id),
      bookingEnabled: Boolean(project?.booking_enabled),
      count: regs.length,
      awaitingPayment: regs.filter(r => (r.payment_status === 'INITIATED' || r.payment_status === 'PENDING') && !r.utr_number).length,
      pendingVerification: regs.filter(r => r.payment_status === 'PENDING' && Boolean(r.utr_number)).length,
      paidCount: paid.length,
      failedCount: regs.filter(r => r.payment_status === 'FAILED').length,
      revenue: paid.reduce((sum, r) => sum + (r.total_payment_received || r.total_payable || 0), 0),
      inventory: plans.length ? { total, held, available: Math.max(0, total - held) } : null
    };
  }));

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
      projectBreakdown
    },
    integrations: {
      appUrl: process.env.APP_SUBDOMAIN || process.env.APP_URL || null,
      razorpayConfigured: paymentService.getPublicConfig().isLiveCredentialsConfigured,
      webhookSecretConfigured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET && !process.env.RAZORPAY_WEBHOOK_SECRET.includes('your_')),
      simulatedPaymentsAllowed: !isProd && process.env.ALLOW_SIMULATED_PAYMENTS === 'true',
      googleSheetsConfigured: googleSheetsService.getStatus().isConnected
    },
    projectBreakdown,
    recentRegistrations: allRegistrations.slice(0, 8),
    recentAudit: await db.listAuditLogs(6)
  });
});

// Admin List Registrations with Search & Filter
app.get('/api/admin/registrations', authenticateAdmin, async (req: Request, res: Response) => {
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

  const filtered = await db.listRegistrations({
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
app.get('/api/admin/registration/:id', authenticateAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const registration = await db.getRegistration(id) || await db.getRegistrationByNumber(id);

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  const payments = await db.getPaymentsForRegistration(registration.id);

  await db.logAudit({
    admin_id: (req as any).adminUser.id,
    action: 'REGISTRATION_VIEWED',
    entity_type: 'REGISTRATION',
    entity_id: registration.id,
    new_value: { registrationNumber: registration.registration_number }
  });

  res.json({ registration, payments });
});

// Admin Update Registration Status
app.patch('/api/admin/registration/:id/status', authenticateAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { registrationStatus, paymentStatus, notes } = req.body;
  if (paymentStatus && !['CANCELLED'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'Use the payment verification action to approve or reject a payment' });
  }
  if (registrationStatus && !['SUBMITTED', 'CONFIRMED', 'IN_REVIEW', 'CANCELLED'].includes(registrationStatus)) {
    return res.status(400).json({ error: 'Invalid booking status' });
  }
  if (notes !== undefined && typeof notes !== 'string') {
    return res.status(400).json({ error: 'Notes must be text' });
  }

  // Locked read-modify-write with its audit entry, so a concurrent review cannot be overwritten
  const registration = await db.transaction(async tx => {
    const reg = await tx.getRegistrationForUpdate(id);
    if (!reg) return null;
    const oldValues = { registration_status: reg.registration_status, payment_status: reg.payment_status };
    if (registrationStatus) reg.registration_status = registrationStatus as RegistrationStatus;
    if (paymentStatus) reg.payment_status = paymentStatus as PaymentStatus;
    if (notes !== undefined) reg.notes = notes;
    reg.updated_at = new Date().toISOString();
    await tx.saveRegistration(reg);
    await tx.logAudit({
      admin_id: (req as any).adminUser.id,
      action: 'REGISTRATION_STATUS_UPDATED',
      entity_type: 'REGISTRATION',
      entity_id: reg.id,
      old_value: oldValues,
      new_value: { registration_status: reg.registration_status, payment_status: reg.payment_status }
    });
    return reg;
  });
  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  res.json({ success: true, registration });
});

// Admin Export CSV
app.get('/api/admin/export-csv', authenticateAdmin, async (req: Request, res: Response) => {
  const { search, projectId, paymentStatus, registrationStatus } = req.query as Record<string, string>;
  // Every matching booking (no pagination), one row per booking
  const seen = new Set<string>();
  const list = (await db.listRegistrations({ search: search?.trim(), projectId, paymentStatus, registrationStatus }))
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
    sendFailure(res, e, 'Simulation failed');
  }
});

// Admin Audit Logs & Webhook Event Logs
app.get('/api/admin/audit-logs', authenticateAdmin, async (_req: Request, res: Response) => {
  res.json({
    auditLogs: await db.listAuditLogs(50),
    webhookEvents: await db.listWebhookEvents(30)
  });
});

// -------------------------------------------------------------
// GOOGLE SHEETS "Payment Domain" INTEGRATION ENDPOINTS
// -------------------------------------------------------------

// Get Google Sheets sync status and column schema (Admin Only)
app.get('/api/admin/google-sheets/status', authenticateAdmin, async (_req: Request, res: Response) => {
  const status = googleSheetsService.getStatus();
  res.json({
    success: true,
    ...status,
    // Setup problems only (variable names / file paths), never key material
    configProblems: status.isConnected ? [] : loadSheetsCredentials().problems,
    totalRegistrations: (await db.listRegistrations()).length
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
app.get('/api/admin/google-sheets/preview-row/:id', authenticateAdmin, async (req: Request, res: Response) => {
  const { id } = req.params;
  const reg = await db.getRegistration(id) || await db.getRegistrationByNumber(id);
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
  const publicPath = path.resolve(APP_ROOT, 'public');
  app.use(express.static(publicPath));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(APP_ROOT, 'dist');
    app.use(express.static(distPath));
    app.get('*', async (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Errors from any route end here: database outages become a clear 503, nothing leaks internals
  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof DatabaseUnavailableError) {
      console.error(`[Database] ${req.method} ${req.path}: ${err.message}`);
      return res.status(503).json({ error: 'The booking system is temporarily unavailable. Nothing was saved. Please try again in a few minutes.' });
    }
    if (err instanceof DuplicateRecordError) {
      return res.status(409).json({ error: 'This record already exists.' });
    }
    console.error(`[Server] ${req.method} ${req.path}:`, err?.message || err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server listening on port ${PORT} (Env: ${process.env.NODE_ENV || 'development'})`);
    if (!adminAuthConfigured) console.warn('Admin login disabled: set ADMIN_JWT_SECRET (32+ chars) in the project-root .env');
    if (!await db.getAdminByEmail(process.env.ADMIN_EMAIL?.trim() || '').catch(() => null)) {
      console.warn('Admin account not provisioned: set ADMIN_EMAIL and ADMIN_PASSWORD (16+ chars) in the environment');
    }
    console.log(`Garg Realty Portal ready on http://localhost:${PORT}`);

    // Say loudly, at startup, whether bookings can actually be recorded in Google Sheets
    googleSheetsService.diagnose().then(report => {
      if (report.ok) {
        console.log(`[Google Sheets] READY - bookings will be appended to spreadsheet ${report.steps[0].detail}, tab "${report.steps[1].detail}".`);
      } else {
        const failed = report.steps.find(s => !s.ok)!;
        console.log(
          `[Google Sheets] Optional mirror not configured - bookings and UTR submissions are saved in the ${db.kind === 'mysql' ? 'MySQL database' : 'local development database (data/db.json)'}.\n` +
          `  (${failed.step}): ${failed.detail}`
        );
      }
    }).catch(err => console.error('[Google Sheets] Startup check failed:', err.message));
  });
}

// Connect to the database first; the server only starts accepting requests when storage is ready
initDatabase()
  .then(kind => {
    console.log(kind === 'mysql'
      ? `[Database] MySQL connected: ${process.env.DB_HOST}:${process.env.DB_PORT || 3306} / ${process.env.DB_NAME} (schema ready)`
      : '[Database] Local development store: data/db.json (set DB_HOST, DB_NAME, DB_USER, DB_PASSWORD to use MySQL)');
    return setupServer();
  })
  .catch(err => {
    // Message names the problem (host unreachable, access denied, ...) but never the password
    console.error(`Fatal startup error: ${err?.message || err}`);
    process.exit(1);
  });

// Close database connections cleanly when the host stops the app
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    db.close().catch(() => {}).finally(() => process.exit(0));
  });
}
