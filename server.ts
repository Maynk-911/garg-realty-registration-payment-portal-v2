import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { db } from './src/server/db.js';
import { paymentService } from './src/server/paymentService.js';
import { crmService } from './src/server/crmService.js';
import { emailService } from './src/server/emailService.js';
import { Registration, PaymentStatus, RegistrationStatus, PaymentRecord } from './src/types.js';
import { googleSheetsService, GOOGLE_SHEET_COLUMNS, SPREADSHEET_NAME, ALLOWED_PLANS } from './src/server/googleSheetsService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProd = process.env.NODE_ENV === 'production';
const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || 'garg_admin_secret_key_2026';

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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const [payloadBase64, signature] = token.split('.');
    if (!payloadBase64 || !signature) {
      return res.status(401).json({ error: 'Malformed admin token' });
    }

    const expectedSig = crypto.createHmac('sha256', ADMIN_SECRET).update(payloadBase64).digest('hex');
    if (expectedSig !== signature) {
      return res.status(401).json({ error: 'Invalid admin token signature' });
    }

    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf-8'));
    if (payload.exp && Date.now() > payload.exp) {
      return res.status(401).json({ error: 'Session expired, please login again' });
    }

    (req as any).adminUser = payload;
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
    adminEmail: process.env.ADMIN_EMAIL || 'admin@gargrealty.com',
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
    const rawPlan = (req.body.selectedPlan || req.body.unitSize || '').trim();
    if (!rawPlan || !ALLOWED_PLANS.includes(rawPlan as any)) {
      return res.status(400).json({
        error: `Invalid plan selected. Selected Plan must be strictly one of: ${ALLOWED_PLANS.join(', ')}`
      });
    }
    const selectedPlan = rawPlan;
    const plan = project.ownership_plans?.find(p => p.name === selectedPlan || p.label === selectedPlan);
    const unitsCount = Math.max(1, parseInt(req.body.numberOfUnits || req.body.unitsCount || '1', 10));
    const tokenPerUnit = 50000; // Fixed token amount per unit
    const tokenAmount = tokenPerUnit * unitsCount;
    const taxPercentage = 0; // Fixed 0% surcharge on advance token
    const taxAmount = 0;
    const totalPayable = tokenAmount;

    // Check for existing pending registration with exact same details to prevent duplicates (only if unpaid)
    let registration = db.findRegistrationByEmailOrPhone(email, mobileCheck.normalized);
    if (registration && registration.payment_status === 'PAID') {
      registration = null; // Prior registration is completed; allow new booking
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

    // Synchronize to Google Sheet "Payment Domain" (Strict 19 Columns, Safe Formula Escaping, Deduplicated)
    googleSheetsService.syncRegistration(registration).catch(err => {
      console.warn('Google Sheets async sync warning:', err.message);
    });

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

// 4. Submit HDFC SmartHub QR Payment Confirmation (UTR submission)
// Critical: Payment status must remain PENDING until verified by accounts desk.
app.post('/api/payment/submit-qr-utr', async (req: Request, res: Response) => {
  try {
    const { registrationId, utrNumber, upiApp, senderUpi, notes } = req.body;

    if (!registrationId) {
      return res.status(400).json({ error: 'registrationId is required' });
    }

    const cleanUtr = (utrNumber || '').trim();
    if (!cleanUtr || cleanUtr.length < 6) {
      return res.status(400).json({ error: 'Please enter a valid Bank UTR / UPI Reference Number (at least 6 characters)' });
    }

    const registration = db.getRegistration(registrationId);
    if (!registration) {
      return res.status(404).json({ error: 'Registration record not found' });
    }

    const now = new Date().toISOString();

    // Critical Requirement: DO NOT mark as PAID upon user submission!
    // Payment status must remain PENDING until verified by accounts desk.
    registration.utr_number = cleanUtr;
    registration.upi_app = (upiApp || 'UPI Scan & Pay').trim();
    registration.sender_upi = (senderUpi || '').trim();
    registration.payment_submitted_at = now;
    registration.payment_status = 'PENDING';
    registration.registration_status = 'IN_REVIEW';
    registration.mode_of_payment = 'HDFC SmartHub QR (TID: 68283784)';
    registration.updated_at = now;

    if (notes) {
      registration.notes = `${registration.notes ? registration.notes + ' | ' : ''}UTR Notes: ${notes}`;
    }

    db.saveRegistration(registration);

    // Sync to Google Sheet "Payment Domain" (row updated with UTR and PENDING status)
    googleSheetsService.syncRegistration(registration).catch(err => {
      console.warn('Google Sheets sync warning:', err.message);
    });

    // Create payment record with PENDING status
    const paymentRecord: PaymentRecord = {
      id: `pay_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      registration_id: registration.id,
      registration_number: registration.registration_number,
      gateway: 'HDFC_SMARTHUB_QR',
      gateway_order_id: `hdfc_qr_${registration.registration_number}`,
      gateway_payment_id: cleanUtr,
      utr_number: cleanUtr,
      amount: registration.total_payable,
      currency: 'INR',
      payment_status: 'PENDING',
      payment_method: `HDFC SmartHub QR (${registration.upi_app})`,
      signature_verified: false,
      webhook_verified: false,
      attempt_number: 1,
      created_at: now,
      updated_at: now
    };
    db.savePayment(paymentRecord);

    db.logAudit({
      action: 'PAYMENT_UTR_SUBMITTED',
      admin_id: registration.full_name,
      entity_type: 'PAYMENT',
      entity_id: registration.id,
      new_value: {
        registration_number: registration.registration_number,
        utr_number: cleanUtr,
        upi_app: registration.upi_app,
        amount: registration.total_payable,
        payment_status: 'PENDING'
      }
    });

    res.json({
      success: true,
      status: 'PENDING',
      message: 'Payment reference submitted. Your payment is PENDING verification with HDFC Bank SmartHub.',
      registration
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint to verify a pending payment UTR and mark it PAID
app.post('/api/admin/verify-payment', authenticateAdmin, (req: Request, res: Response) => {
  try {
    const { registrationId, verified, notes } = req.body;
    const registration = db.getRegistration(registrationId);
    if (!registration) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    const now = new Date().toISOString();
    if (verified) {
      registration.payment_status = 'PAID';
      registration.registration_status = 'CONFIRMED';
      registration.total_payment_received = registration.total_payable;
      registration.payment_verified_at = now;
      registration.payment_verified_by = 'Accounts Desk';
      registration.updated_at = now;
    } else {
      registration.payment_status = 'FAILED';
      registration.updated_at = now;
    }

    if (notes) {
      registration.notes = `${registration.notes ? registration.notes + ' | ' : ''}Verification Notes: ${notes}`;
    }

    db.saveRegistration(registration);

    // Sync verified PAID/FAILED status to Google Sheet "Payment Domain" (row updated in place)
    googleSheetsService.syncRegistration(registration).catch(err => {
      console.warn('Google Sheets sync warning:', err.message);
    });

    // Update payment record
    const payments = db.getPaymentsForRegistration(registration.id);
    if (payments.length > 0) {
      const p = payments[payments.length - 1];
      p.payment_status = verified ? 'PAID' : 'FAILED';
      p.signature_verified = true;
      p.verified_at = now;
      db.savePayment(p);
    }

    db.logAudit({
      action: verified ? 'PAYMENT_VERIFIED_SUCCESS' : 'PAYMENT_VERIFIED_REJECTED',
      admin_id: 'admin',
      entity_type: 'PAYMENT',
      entity_id: registration.id,
      new_value: {
        registration_number: registration.registration_number,
        payment_status: registration.payment_status,
        utr_number: registration.utr_number
      }
    });

    res.json({ success: true, registration });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

// 6. Get Registration Details & Status (Public query by registration ID)
app.get('/api/registration/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const registration = db.getRegistration(id) || db.getRegistrationByNumber(id);

  if (!registration) {
    return res.status(404).json({ error: 'Registration not found' });
  }

  const payments = db.getPaymentsForRegistration(registration.id);

  // Return clean client-safe view
  res.json({
    registration,
    payments,
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
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const admin = db.getAdminByEmail(email);
  if (!admin) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== admin.passwordHash) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }

  const payload = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    exp: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(payloadBase64).digest('hex');
  const token = `${payloadBase64}.${signature}`;

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
      totalRevenue
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
  const { projectId, paymentStatus, registrationStatus } = req.query as Record<string, string>;
  const list = db.listRegistrations({ projectId, paymentStatus, registrationStatus });

  const headers = [
    'Registration Number',
    'Full Name',
    'Mobile',
    'Email',
    'City',
    'Project',
    'Unit Number',
    'Token Amount (INR)',
    'Payment Status',
    'Registration Status',
    'Source',
    'Created At'
  ];

  const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const rows = list.map(r => [
    escapeCsv(r.registration_number),
    escapeCsv(r.full_name),
    escapeCsv(r.mobile),
    escapeCsv(r.email),
    escapeCsv(r.city),
    escapeCsv(r.project_name),
    escapeCsv(r.unit_number || 'N/A'),
    escapeCsv(r.token_amount),
    escapeCsv(r.payment_status),
    escapeCsv(r.registration_status),
    escapeCsv(r.source || 'Direct'),
    escapeCsv(r.created_at)
  ].join(','));

  const csvContent = [headers.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="garg_realty_registrations_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csvContent);
});

// Admin Webhook Simulator & Testing Tool
app.post('/api/admin/webhook/simulate', authenticateAdmin, async (req: Request, res: Response) => {
  try {
    const { eventType, orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const simResult = await paymentService.simulateWebhookEvent(eventType || 'payment.captured', orderId);
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

  const { formatRegistrationToRow } = require('./src/server/googleSheetsService.js');
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
  // Always serve public assets (like /image.png, /hdfc-vyapar-qr.png)
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
    console.log(`Garg Realty Portal ready on http://localhost:${PORT}`);
  });
}

setupServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
