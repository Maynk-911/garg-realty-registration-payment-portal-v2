// Channel Partner (CP) / Broker onboarding: public application form API and the admin review workflow.
// Kept separate from the booking/payment routes; it only shares the database, admin sign-in and audit trail.
import crypto from 'crypto';
import { Express, Request, Response, RequestHandler } from 'express';
import type Sharp from 'sharp';
import { db, DuplicateRecordError } from './db.js';
import { CP_SUBMIT_PATH, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MB, clientIp, passedCpGuard } from './cpGuard.js';
import type { Store } from './store.js';
import { toCsv } from './csv.js';
import { deliverCpNotification, cpEmailConfigured, cpInternalRecipient } from './cpNotifications.js';
import { buildCpCertificate, certificateEligible } from './cpTrack.js';
import { CpApplication, CpDocument, CpNotification, CpNotificationEvent, CpPartner, CpStatusHistoryEntry } from '../types.js';
import {
  CP_ACTIONS, CP_ACTIONS_NEEDING_REASON, CP_DECLARATIONS, CP_DECLARATION_VERSION, CP_DOCUMENT_TYPES, CP_STATUSES, CP_STATUS_LABELS,
  COMPANY_PARTNER_TYPES, isValidEmail, GSTIN_REGEX, HEARD_FROM_OPTIONS, INDIA_PIN_REGEX, INDIAN_STATES, PAN_REGEX, PARTNER_TYPES, RERA_REGEX,
  CpAction, CpDocumentType, CpPublicConfig, CpStatus, cpDocumentLabel, isIndia, maskPan, normalizeCpMobile, panFromGstin, partnerTypeLabel
} from '../cpOptions.js';

// ---------- settings (environment, with safe defaults) ----------
const ALLOW_INTERNATIONAL = process.env.CP_ALLOW_INTERNATIONAL === 'true';
/** Comma-separated document keys that applicants must upload, e.g. CP_REQUIRED_DOCUMENTS="PAN_CARD,ADDRESS_PROOF" (default: none) */
const REQUIRED_DOCUMENTS = new Set(
  (process.env.CP_REQUIRED_DOCUMENTS || '').split(',').map(s => s.trim().toUpperCase())
    .filter((k): k is CpDocumentType => CP_DOCUMENT_TYPES.some(d => d.key === k))
);

async function publicConfig(): Promise<CpPublicConfig> {
  return {
    documents: CP_DOCUMENT_TYPES.map(d => ({ ...d, required: REQUIRED_DOCUMENTS.has(d.key) })),
    maxFileBytes: MAX_FILE_BYTES,
    maxTotalBytes: MAX_TOTAL_BYTES,
    allowInternational: ALLOW_INTERNATIONAL,
    declarationVersion: CP_DECLARATION_VERSION,
    projects: await projectChoices()
  };
}

/** Projects an applicant can choose, read from the existing project configuration (not hard-coded here) */
async function projectChoices() {
  return (await db.listProjects(true)).map(p => ({ id: p.id, name: p.display_name || p.short_name || p.name }));
}
async function projectNamer() {
  const names = new Map((await db.listProjects(false)).map(p => [p.id, p.short_name || p.name]));
  return (id: string) => names.get(id) || id;
}

// ---------- validation ----------
type FieldErrors = Record<string, string>;
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
/** Single-line text: control characters removed, whitespace collapsed, trimmed */
const line = (v: unknown, max: number) => str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Multi-line text: keeps line breaks, removes other control characters */
const block = (v: unknown, max: number) =>
  str(v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const optional = (s: string) => (s ? s : undefined);
const NAME_REGEX = /^[\p{L}][\p{L}\p{M} .'-]{1,119}$/u;
const PLACE_REGEX = /^[\p{L}][\p{L}\p{M} .'()-]{1,79}$/u;

function intField(v: unknown, min: number, max: number): number | null | 'invalid' {
  const s = str(v).trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return 'invalid';
  const n = Number(s);
  return n >= min && n <= max ? n : 'invalid';
}

function urlField(v: unknown, hostRule?: (host: string) => boolean): string | null | 'invalid' {
  let s = line(v, 255);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.') || (hostRule && !hostRule(u.hostname.toLowerCase()))) return 'invalid';
    return u.toString().slice(0, 255);
  } catch {
    return 'invalid';
  }
}

interface ValidatedApplication {
  fields: Omit<CpApplication, 'id' | 'application_ref' | 'status' | 'created_at' | 'updated_at' | 'declarations_accepted_at'>;
  documents: { type: CpDocumentType; name: string; data: string }[];
}

/** Server-side validation of every field (the browser's checks are a convenience only) */
export async function validateCpApplication(body: any): Promise<{ value?: ValidatedApplication; errors: FieldErrors }> {
  const e: FieldErrors = {};
  const b = body && typeof body === 'object' ? body : {};

  const country = ALLOW_INTERNATIONAL ? line(b.country, 80) || 'India' : 'India';
  if (!ALLOW_INTERNATIONAL && b.country && !isIndia(str(b.country))) e.country = 'Applications are currently accepted from India only';
  if (ALLOW_INTERNATIONAL && !PLACE_REGEX.test(country)) e.country = 'Enter a valid country';
  const india = isIndia(country);

  // A. Personal
  const full_name = line(b.full_name, 120);
  if (!full_name) e.full_name = 'Full name is required';
  else if (!NAME_REGEX.test(full_name)) e.full_name = 'Enter your full name using letters only';
  const mobile = normalizeCpMobile(str(b.mobile), country);
  if (!str(b.mobile).trim()) e.mobile = 'Mobile number is required';
  else if (!mobile) e.mobile = india ? 'Enter a valid 10-digit Indian mobile number' : 'Enter a valid mobile number with country code';
  const whatsappRaw = str(b.whatsapp).trim();
  const whatsapp = whatsappRaw ? normalizeCpMobile(whatsappRaw, country) : mobile;
  if (whatsappRaw && !whatsapp) e.whatsapp = 'Enter a valid WhatsApp number';
  // Checked before shortening, so an over-long address is refused rather than silently cut
  const email = str(b.email).trim().toLowerCase();
  if (email && !isValidEmail(email)) e.email = 'Enter a valid e-mail address (letters, numbers and . _ % + - only)';
  const dob = line(b.date_of_birth, 10);
  if (dob) {
    const d = new Date(`${dob}T00:00:00Z`);
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dob) e.date_of_birth = 'Enter a valid date';
    else if (age < 18 || age > 100) e.date_of_birth = 'Applicants must be at least 18 years old';
  }

  // B. Professional
  const partner_type = line(b.partner_type, 32) as CpApplication['partner_type'];
  if (!PARTNER_TYPES.some(t => t.value === partner_type)) e.partner_type = 'Select your partner type';
  const company_name = line(b.company_name, 160);
  if (COMPANY_PARTNER_TYPES.includes(partner_type) && !company_name) e.company_name = 'Company / firm name is required for firms and companies';
  else if (company_name && company_name.length < 2) e.company_name = 'Enter the company / firm name';
  const years = intField(b.years_experience, 0, 60);
  if (years === null) e.years_experience = 'Years of experience is required';
  else if (years === 'invalid') e.years_experience = 'Enter a whole number of years (0–60)';
  const salesAgents = intField(b.sales_agents, 0, 100000);
  if (salesAgents === 'invalid') e.sales_agents = 'Enter a whole number';
  const existing_business = line(b.existing_business, 500);
  const website = urlField(b.website);
  if (website === 'invalid') e.website = 'Enter a valid website address';
  const linkedin = urlField(b.linkedin, h => h === 'linkedin.com' || h.endsWith('.linkedin.com'));
  if (linkedin === 'invalid') e.linkedin = 'Enter a valid LinkedIn profile link (linkedin.com/...)';

  // C. Address
  const state = line(b.state, 80);
  if (!state) e.state = 'State is required';
  else if (india && !INDIAN_STATES.includes(state as any)) e.state = 'Select your state';
  else if (!india && !PLACE_REGEX.test(state)) e.state = 'Enter a valid state / region';
  const city = line(b.city, 80);
  if (!city) e.city = 'City is required';
  else if (!PLACE_REGEX.test(city)) e.city = 'Enter a valid city name';
  const pincode = line(b.pincode, 10).replace(/\s/g, india ? '' : ' ');
  if (!pincode) e.pincode = india ? 'PIN code is required' : 'Postal code is required';
  else if (india ? !INDIA_PIN_REGEX.test(pincode) : !/^[A-Za-z0-9 -]{3,10}$/.test(pincode)) e.pincode = india ? 'Enter a valid 6-digit PIN code' : 'Enter a valid postal code';
  const address = block(b.address, 500);
  if (!address) e.address = 'Full address is required';
  else if (address.length < 10) e.address = 'Enter your complete address';

  // D. Business & tax — formats only; an administrator verifies the documents
  const pan = line(b.pan_number, 10).toUpperCase().replace(/\s/g, '');
  if (india && !pan) e.pan_number = 'PAN is required';
  else if (pan && !PAN_REGEX.test(pan)) e.pan_number = 'PAN format is ABCDE1234F';
  const gst = line(b.gst_number, 15).toUpperCase().replace(/\s/g, '');
  if (gst && !GSTIN_REGEX.test(gst)) e.gst_number = 'GSTIN format is 22ABCDE1234F1Z5 (15 characters)';
  const rera = line(b.rera_number, 60);
  if (rera && !RERA_REGEX.test(rera)) e.rera_number = 'Use letters, numbers and / - . only';
  const reraState = line(b.rera_state, 80);
  if (reraState && !INDIAN_STATES.includes(reraState as any)) e.rera_state = 'Select the RERA state';
  const bizReg = line(b.business_registration_number, 60);
  if (bizReg && !/^[A-Za-z0-9][A-Za-z0-9/\-. ]{2,59}$/.test(bizReg)) e.business_registration_number = 'Use letters, numbers and / - . only';

  // E. Projects of interest — must be projects that exist in the project configuration
  const available = new Set((await projectChoices()).map(p => p.id));
  const project_ids = [...new Set((Array.isArray(b.project_ids) ? b.project_ids : []).map((p: unknown) => str(p)))] as string[];
  if (!project_ids.length) e.project_ids = 'Select at least one project';
  else if (project_ids.some(p => !available.has(p))) e.project_ids = 'One of the selected projects is not available';

  // F. Additional
  const leads = intField(b.expected_monthly_leads, 0, 100000);
  if (leads === 'invalid') e.expected_monthly_leads = 'Enter a whole number';
  const heard_from = line(b.heard_from, 80);
  if (heard_from && !HEARD_FROM_OPTIONS.includes(heard_from as any)) e.heard_from = 'Select an option';
  const referral_code = line(b.referral_code, 40).toUpperCase();
  if (referral_code && !/^[A-Z0-9-]{3,40}$/.test(referral_code)) e.referral_code = 'Use letters, numbers and hyphens only';

  // Declarations — every one must be accepted, against the current version of the text
  const declarations = b.declarations && typeof b.declarations === 'object' ? b.declarations : {};
  for (const d of CP_DECLARATIONS) if (declarations[d.key] !== true) e[`declaration_${d.key}`] = 'Please accept this declaration';
  if (str(b.declaration_version) !== CP_DECLARATION_VERSION) e.declaration_version = 'The form has been updated. Please reload the page and submit again.';

  const client_submission_id = line(b.client_submission_id, 64);
  if (client_submission_id && !/^[A-Za-z0-9-]{16,64}$/.test(client_submission_id)) e.client_submission_id = 'Invalid form session. Please reload the page.';

  // Documents (contents are checked separately in readDocuments)
  const docsIn = Array.isArray(b.documents) ? b.documents : [];
  const documents: ValidatedApplication['documents'] = [];
  if (docsIn.length > CP_DOCUMENT_TYPES.length) e.documents = 'Too many documents';
  for (const d of docsIn.slice(0, CP_DOCUMENT_TYPES.length)) {
    const type = str(d?.type) as CpDocumentType;
    if (!CP_DOCUMENT_TYPES.some(t => t.key === type)) { e.documents = 'Unknown document type'; continue; }
    if (documents.some(x => x.type === type)) { e[`document_${type}`] = 'Upload one file per document type'; continue; }
    documents.push({ type, name: str(d?.name), data: str(d?.data) });
  }
  for (const key of REQUIRED_DOCUMENTS) if (!documents.some(d => d.type === key)) e[`document_${key}`] = `${cpDocumentLabel(key)} is required`;

  if (Object.keys(e).length) return { errors: e };
  return {
    errors: {},
    value: {
      documents,
      fields: {
        client_submission_id: optional(client_submission_id),
        full_name, mobile: mobile!, whatsapp: whatsapp || undefined, email: optional(email), date_of_birth: optional(dob),
        partner_type, company_name: optional(company_name), years_experience: years as number,
        sales_agents: typeof salesAgents === 'number' ? salesAgents : undefined, existing_business: optional(existing_business),
        website: typeof website === 'string' ? website : undefined, linkedin: typeof linkedin === 'string' ? linkedin : undefined,
        country: india ? 'India' : country, state, city, pincode, address,
        pan_number: optional(pan), gst_number: optional(gst), rera_number: optional(rera), rera_state: optional(reraState),
        business_registration_number: optional(bizReg), project_ids,
        expected_monthly_leads: typeof leads === 'number' ? leads : undefined, preferred_locations: optional(line(b.preferred_locations, 500)),
        previous_experience: optional(block(b.previous_experience, 2000)), heard_from: optional(heard_from),
        referral_code: optional(referral_code), comments: optional(block(b.comments, 2000)),
        declaration_version: CP_DECLARATION_VERSION
      }
    }
  };
}

const EXTENSIONS: Record<CpDocument['mime_type'], string[]> = {
  'application/pdf': ['pdf'], 'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png']
};
const FORMAT_OF: Record<CpDocument['mime_type'], string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/**
 * sharp (native image library) is loaded on the first image upload, not at server start, so the site starts even if
 * the native library cannot be loaded on the host. A failed load is not cached: the next image upload tries again.
 */
let sharpLoading: Promise<typeof Sharp> | null = null;
function loadSharp(): Promise<typeof Sharp> {
  sharpLoading ??= import('sharp').then(m => m.default).catch(err => { sharpLoading = null; throw err; });
  return sharpLoading;
}

/** The file type from its first bytes; the browser's MIME type and the file name are not trusted */
function sniff(bytes: Buffer): CpDocument['mime_type'] | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

/** Display name only: no folders, no control or path characters */
const safeDisplayName = (name: string, fallbackExt: string) => {
  const base = name.split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().slice(-120);
  return cleaned || `document.${fallbackExt}`;
};

/** Decode and check each upload: allowed type, real contents, size limits. Returns errors keyed by document type. */
export async function readCpDocuments(input: ValidatedApplication['documents']): Promise<{ documents: CpDocument[]; errors: FieldErrors }> {
  const errors: FieldErrors = {};
  const documents: CpDocument[] = [];
  let total = 0;
  for (const d of input) {
    const key = `document_${d.type}`;
    const config = CP_DOCUMENT_TYPES.find(t => t.key === d.type)!;
    const base64 = d.data.replace(/^data:[^;,]*;base64,/, '');
    if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) { errors[key] = 'The file could not be read. Please choose it again.'; continue; }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > MAX_FILE_BYTES) { errors[key] = `File is larger than ${Math.round(MAX_FILE_BYTES / MB * 10) / 10} MB`; continue; }
    total += bytes.length;
    const mime = sniff(bytes);
    const allowed = config.formats as readonly string[];
    if (!mime || !allowed.includes(FORMAT_OF[mime])) { errors[key] = `Only ${allowed.map(f => f.toUpperCase()).join(', ')} files are accepted`; continue; }
    const ext = (d.name.split('.').pop() || '').toLowerCase();
    if (!EXTENSIONS[mime].includes(ext)) { errors[key] = `The file name must end in .${EXTENSIONS[mime].join(' or .')} to match its contents`; continue; }
    if (mime === 'application/pdf') {
      const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString('latin1');
      const text = bytes.toString('latin1');
      if (!tail.includes('%%EOF')) { errors[key] = 'The PDF appears to be incomplete or damaged'; continue; }
      // Documents never need scripts, auto-launch actions or embedded files
      if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(text)) { errors[key] = 'PDFs with scripts or embedded files are not accepted. Please upload a plain scan or export.'; continue; }
    } else {
      let sharp: typeof Sharp;
      try {
        sharp = await loadSharp();
      } catch (err: any) {
        // The image library is unavailable: refuse this file clearly; the server and every other route keep working
        console.error(`[CP] Image library (sharp) could not be loaded: ${err?.code || err?.message || err}`);
        errors[key] = 'Images cannot be checked at the moment. Please upload this document as a PDF, or try again later.';
        continue;
      }
      try {
        const meta = await sharp(bytes, { failOn: 'error' }).metadata();
        const expected = mime === 'image/png' ? 'png' : 'jpeg';
        if (meta.format !== expected || !meta.width || !meta.height || meta.width > 12000 || meta.height > 12000) throw new Error('bad image');
      } catch {
        errors[key] = 'The image could not be read. Please upload a clear JPG or PNG.';
        continue;
      }
    }
    documents.push({
      id: `cpd_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      application_id: '', doc_type: d.type, original_name: safeDisplayName(d.name, FORMAT_OF[mime]), mime_type: mime,
      size_bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), content: bytes,
      created_at: new Date().toISOString()
    });
  }
  if (total > MAX_TOTAL_BYTES) errors.documents = `All documents together must be ${Math.round(MAX_TOTAL_BYTES / MB)} MB or less`;
  return { documents, errors };
}

// ---------- workflow helpers ----------
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

function historyEntry(applicationId: string, from: CpStatus | null, to: CpStatus, admin: { id: string; email: string } | null, note?: string): CpStatusHistoryEntry {
  return {
    id: newId('cph'), application_id: applicationId, from_status: from, to_status: to,
    admin_id: admin?.id || null, admin_email: admin?.email || null, note: note || undefined, created_at: new Date().toISOString()
  };
}

function pendingNotification(applicationId: string, event: CpNotificationEvent, recipient: string | undefined, message?: string): CpNotification {
  const now = new Date().toISOString();
  return {
    id: newId('cpn'), application_id: applicationId, event, channel: 'EMAIL', recipient, status: 'PENDING', attempts: 0,
    message: message || undefined, created_at: now, updated_at: now
  };
}

/** Send notifications already recorded as PENDING and store each outcome. Failures are recorded, never thrown. */
async function deliverAll(notifications: CpNotification[], application: CpApplication, partner: CpPartner | null) {
  const name = await projectNamer().catch(() => (id: string) => id);
  const results: CpNotification[] = [];
  for (const n of notifications) {
    const outcome = await deliverCpNotification(n, application, partner, name);
    try { await db.saveCpNotification(outcome); } catch (err: any) { console.error(`[CP Notification] could not record outcome for ${application.application_ref}: ${err?.message}`); }
    results.push(outcome);
  }
  return results;
}

/** Documents that the current configuration requires but this application does not have */
async function missingRequiredDocuments(applicationId: string, store: Store = db) {
  const present = new Set((await store.listCpDocuments(applicationId)).map(d => d.doc_type));
  return [...REQUIRED_DOCUMENTS].filter(k => !present.has(k));
}

const publicConfirmation = (a: CpApplication) => ({
  reference: a.application_ref,
  full_name: a.full_name,
  submitted_at: a.created_at,
  status: a.status,
  status_label: CP_STATUS_LABELS[a.status]
});

const DUPLICATE_MESSAGE = 'An application with this mobile number or e-mail address is already being processed, so a new one was not created. ' +
  'If you have applied before, our team will contact you. If you are applying for a different business, please contact our partner team.';

/** Inclusive day range from YYYY-MM-DD values (India time) */
function istDayRange(from?: string, to?: string) {
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : undefined);
  const f = valid(from), t = valid(to);
  return {
    createdFrom: f ? new Date(`${f}T00:00:00.000+05:30`).toISOString() : undefined,
    createdTo: t ? new Date(`${t}T23:59:59.999+05:30`).toISOString() : undefined
  };
}

interface AdminDeps {
  authenticateAdmin: RequestHandler;
  sendFailure: (res: Response, err: unknown, message: string) => unknown;
}

export function registerCpRoutes(app: Express, { authenticateAdmin, sendFailure }: AdminDeps) {
  // ---------------- PUBLIC ----------------
  app.get('/api/cp/config', async (_req: Request, res: Response) => {
    res.json(await publicConfig());
  });

  app.post(CP_SUBMIT_PATH, async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    // Defence in depth: never process an application that skipped the rate limit (whatever the URL spelling)
    if (!passedCpGuard(req)) return res.status(404).json({ error: 'Not found' });
    const { value, errors } = await validateCpApplication(req.body);
    if (!value) return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });

    // The same form sent twice (double click, network retry): return the application already created
    if (value.fields.client_submission_id) {
      const earlier = await db.getCpApplicationBySubmissionId(value.fields.client_submission_id);
      if (earlier) {
        if (earlier.mobile !== value.fields.mobile) return res.status(409).json({ error: 'Invalid form session. Please reload the page.' });
        return res.json({ success: true, duplicateRequest: true, application: publicConfirmation(earlier) });
      }
    }

    const files = await readCpDocuments(value.documents);
    if (Object.keys(files.errors).length) return res.status(400).json({ error: 'Please check the uploaded documents.', fields: files.errors });

    const blockDuplicate = async (existingId?: string) => {
      if (existingId) {
        // Recorded for the admin team (no personal data); the applicant learns nothing about the other application
        await db.logAudit({ admin_id: 'public', action: 'CP_DUPLICATE_APPLICATION_BLOCKED', entity_type: 'CP_APPLICATION', entity_id: existingId, ip_address: clientIp(req) }).catch(() => {});
      }
      return res.status(409).json({ error: DUPLICATE_MESSAGE, code: 'DUPLICATE_APPLICATION' });
    };
    const existing = await db.findActiveCpApplication(value.fields.mobile, value.fields.email);
    if (existing) return blockDuplicate(existing.id);

    const now = new Date().toISOString();
    let application!: CpApplication;
    let notifications: CpNotification[] = [];
    try {
      await db.transaction(async tx => {
        application = {
          ...value.fields, id: newId('cpa'), application_ref: await tx.generateCpApplicationRef(), status: 'PENDING',
          declarations_accepted_at: now, ip_address: clientIp(req), user_agent: line(req.headers['user-agent'], 512),
          created_at: now, updated_at: now
        };
        await tx.createCpApplication(application, files.documents.map(d => ({ ...d, application_id: application.id })));
        await tx.addCpStatusHistory(historyEntry(application.id, null, 'PENDING', null, 'Application submitted'));
        notifications = [
          pendingNotification(application.id, 'SUBMITTED', application.email),
          pendingNotification(application.id, 'SUBMITTED_INTERNAL', cpInternalRecipient())
        ];
        for (const n of notifications) await tx.saveCpNotification(n);
        await tx.logAudit({
          admin_id: 'public', action: 'CP_APPLICATION_SUBMITTED', entity_type: 'CP_APPLICATION', entity_id: application.id,
          new_value: { application_ref: application.application_ref, documents: files.documents.length }, ip_address: clientIp(req)
        });
      });
    } catch (err) {
      if (err instanceof DuplicateRecordError) {
        // Lost a race with the same form sent twice (whichever unique key the database reported first)
        if (value.fields.client_submission_id) {
          const earlier = await db.getCpApplicationBySubmissionId(value.fields.client_submission_id);
          if (earlier && earlier.mobile === value.fields.mobile) return res.json({ success: true, duplicateRequest: true, application: publicConfirmation(earlier) });
        }
        if (err.constraint === 'uq_cp_applications_active_mobile' || err.constraint === 'uq_cp_applications_active_email') return blockDuplicate();
      }
      return sendFailure(res, err, 'Your application could not be saved. Please try again.');
    }

    console.log(`[CP] Application ${application.application_ref} submitted`);
    // The application is saved: e-mails are sent afterwards and can never undo it
    void deliverAll(notifications, application, null).catch(() => {});
    res.status(201).json({
      success: true,
      application: publicConfirmation(application),
      acknowledgementEmail: application.email ? (cpEmailConfigured() ? 'sending' : 'not_configured') : 'no_email'
    });
  });

  // ---------------- ADMIN ----------------
  const adminOf = (req: Request) => (req as any).adminUser as { id: string; email: string; role: string };

  app.get('/api/admin/cp/summary', authenticateAdmin, async (_req: Request, res: Response) => {
    const counts = await db.countCpApplicationsByStatus();
    res.json({
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      counts: Object.fromEntries(CP_STATUSES.map(s => [s, counts[s] || 0])),
      emailConfigured: cpEmailConfigured()
    });
  });

  const listFilter = (q: Record<string, string>) => ({
    search: q.search?.slice(0, 100),
    status: CP_STATUSES.includes(q.status as CpStatus) ? q.status : undefined,
    projectId: q.projectId && q.projectId !== 'all' ? q.projectId : undefined,
    ...istDayRange(q.from, q.to),
    sort: (['created_at', 'full_name', 'status', 'city'] as const).find(s => s === q.sort),
    direction: q.direction === 'asc' ? 'asc' as const : 'desc' as const
  });

  app.get('/api/admin/cp/applications', authenticateAdmin, async (req: Request, res: Response) => {
    const q = req.query as Record<string, string>;
    const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 20));
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const { items, total } = await db.listCpApplications({ ...listFilter(q), page, pageSize });
    const name = await projectNamer();
    res.json({
      applications: items.map(a => ({
        id: a.id, application_ref: a.application_ref, full_name: a.full_name, mobile: a.mobile, company_name: a.company_name,
        partner_type: a.partner_type, partner_type_label: partnerTypeLabel(a.partner_type), city: a.city, state: a.state,
        projects: a.project_ids.map(name), created_at: a.created_at, status: a.status
      })),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
    });
  });

  async function applicationDetail(id: string) {
    const a = await db.getCpApplication(id);
    if (!a) return null;
    const [documents, history, notifications, partner, name, missingDocs, auditEntries] = await Promise.all([
      db.listCpDocuments(id), db.listCpStatusHistory(id), db.listCpNotifications(id), db.getCpPartnerByApplication(id), projectNamer(),
      missingRequiredDocuments(id), db.listAuditLogsForEntity('CP_APPLICATION', id, 100)
    ]);
    const { pan_number, ip_address, user_agent, client_submission_id, ...rest } = a;
    const gstPan = panFromGstin(a.gst_number);
    return {
      application: {
        ...rest,
        pan_masked: maskPan(pan_number), has_pan: Boolean(pan_number),
        gst_pan_check: gstPan && pan_number ? (gstPan === pan_number ? 'MATCH' : 'MISMATCH') : null,
        partner_type_label: partnerTypeLabel(a.partner_type),
        projects: a.project_ids.map(pid => ({ id: pid, name: name(pid) })),
        status_label: CP_STATUS_LABELS[a.status],
        submitted_from_ip: ip_address
      },
      documents: documents.map(d => ({ ...d, label: cpDocumentLabel(d.doc_type) })),
      missingRequiredDocuments: missingDocs.map(k => ({ key: k, label: cpDocumentLabel(k) })),
      history,
      notifications,
      /** Who looked at or exported this application, retried e-mails, or was blocked as a duplicate */
      activity: auditEntries.map(l => ({ action: l.action, at: l.timestamp, by: (l.new_value as any)?.admin_email || (l.admin_id === 'public' ? 'Public form' : l.admin_id), detail: (l.new_value as any)?.document || (l.new_value as any)?.event || undefined })),
      partner: partner ? { ...partner, approved_projects: partner.approved_project_ids.map(pid => ({ id: pid, name: name(pid) })) } : null,
      allowedActions: (Object.keys(CP_ACTIONS) as CpAction[]).filter(k => (CP_ACTIONS[k].from as readonly string[]).includes(a.status)),
      emailConfigured: cpEmailConfigured()
    };
  }

  app.get('/api/admin/cp/applications/:id', authenticateAdmin, async (req: Request, res: Response) => {
    const detail = await applicationDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Application not found' });
    res.json(detail);
  });

  // Full PAN on request only; every view is recorded
  app.get('/api/admin/cp/applications/:id/pan', authenticateAdmin, async (req: Request, res: Response) => {
    const a = await db.getCpApplication(req.params.id);
    if (!a) return res.status(404).json({ error: 'Application not found' });
    const admin = adminOf(req);
    await db.logAudit({ admin_id: admin.id, action: 'CP_PAN_VIEWED', entity_type: 'CP_APPLICATION', entity_id: a.id, new_value: { admin_email: admin.email }, ip_address: clientIp(req) });
    res.json({ pan_number: a.pan_number || null });
  });

  // Approval certificate issued by the partner team (any reference format, e.g. for older references that cannot
  // download it publicly). Same rule as the public page: approved application and active partner only. Recorded.
  app.get('/api/admin/cp/applications/:id/certificate', authenticateAdmin, async (req: Request, res: Response) => {
    const a = await db.getCpApplication(req.params.id);
    if (!a) return res.status(404).json({ error: 'Application not found' });
    const partner = await db.getCpPartnerByApplication(a.id);
    if (!certificateEligible(a, partner)) {
      return res.status(409).json({ error: 'An approval certificate is available only for approved, active channel partners.' });
    }
    const admin = adminOf(req);
    await db.logAudit({
      admin_id: admin.id, action: 'CP_CERTIFICATE_ISSUED_BY_ADMIN', entity_type: 'CP_APPLICATION', entity_id: a.id,
      new_value: { cp_id: partner.cp_id, admin_email: admin.email }, ip_address: clientIp(req)
    });
    res.json({ certificate: await buildCpCertificate(a, partner) });
  });

  // Private documents: only through this signed-in endpoint, never a public URL
  app.get('/api/admin/cp/applications/:id/documents/:docId', authenticateAdmin, async (req: Request, res: Response) => {
    const doc = await db.getCpDocument(req.params.id, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const a = await db.getCpApplication(req.params.id);
    const admin = adminOf(req);
    await db.logAudit({
      admin_id: admin.id, action: 'CP_DOCUMENT_VIEWED', entity_type: 'CP_APPLICATION', entity_id: req.params.id,
      new_value: { document: doc.doc_type, admin_email: admin.email }, ip_address: clientIp(req)
    });
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Length', String(doc.content.length));
    res.setHeader('Content-Disposition', `attachment; filename="${a?.application_ref || 'application'}-${doc.doc_type.toLowerCase()}.${FORMAT_OF[doc.mime_type]}"`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(doc.content);
  });

  app.post('/api/admin/cp/applications/:id/action', authenticateAdmin, async (req: Request, res: Response) => {
    const admin = adminOf(req);
    const action = String(req.body?.action || '') as CpAction;
    if (!(action in CP_ACTIONS)) return res.status(400).json({ error: 'Unknown action' });
    const rule = CP_ACTIONS[action];
    const reason = block(req.body?.reason, 2000);
    if (CP_ACTIONS_NEEDING_REASON.includes(action) && reason.length < 5) {
      return res.status(400).json({ error: action === 'REQUEST_INFO' ? 'Describe the information you need from the applicant' : 'A reason is required for this action' });
    }
    if (action === 'REACTIVATE' && admin.role !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Only a super administrator can reactivate a suspended partner' });
    const available = new Set((await projectChoices()).map(p => p.id));

    let notification: CpNotification | null = null;
    let updated!: CpApplication;
    let partner: CpPartner | null = null;
    try {
      await db.transaction(async tx => {
        const a = await tx.getCpApplicationForUpdate(req.params.id);
        if (!a) throw Object.assign(new Error('Application not found'), { status: 404 });
        if (!(rule.from as readonly string[]).includes(a.status)) {
          throw Object.assign(new Error(`This application is ${CP_STATUS_LABELS[a.status]}; "${rule.label}" is not possible now. Refresh to see the latest status.`), { status: 409 });
        }
        const now = new Date().toISOString();
        updated = { ...a, status: rule.to, updated_at: now, reviewed_by: admin.email, reviewed_at: now };
        partner = await tx.getCpPartnerByApplication(a.id);

        if (action === 'APPROVE') {
          if (partner) throw Object.assign(new Error('A partner record already exists for this application'), { status: 409 });
          const requested = Array.isArray(req.body?.approvedProjectIds) ? [...new Set(req.body.approvedProjectIds.map(String))] as string[] : a.project_ids;
          const approvedProjects = requested.filter(p => available.has(p));
          if (!approvedProjects.length || approvedProjects.length !== requested.length) {
            throw Object.assign(new Error('Select at least one valid project for this partner'), { status: 400 });
          }
          const missing = await missingRequiredDocuments(a.id, tx);
          if (missing.length && req.body?.acknowledgeMissingDocuments !== true) {
            throw Object.assign(new Error(`Required documents are missing: ${missing.map(cpDocumentLabel).join(', ')}. Confirm that you have verified them another way.`), { status: 409 });
          }
          partner = {
            id: newId('cpp'), cp_id: await tx.generateCpPartnerId(), application_id: a.id, application_ref: a.application_ref,
            full_name: a.full_name, mobile: a.mobile, email: a.email, company_name: a.company_name, partner_type: a.partner_type,
            approved_project_ids: approvedProjects, status: 'ACTIVE', approved_at: now, approved_by: admin.email, created_at: now, updated_at: now
          };
          await tx.saveCpPartner(partner);
          updated.decision_reason = reason || undefined;
          notification = pendingNotification(a.id, 'APPROVED', a.email, reason);
        } else if (action === 'REJECT') {
          updated.decision_reason = reason;
          notification = pendingNotification(a.id, 'REJECTED', a.email, reason);
        } else if (action === 'REQUEST_INFO') {
          updated.info_request_message = reason;
          notification = pendingNotification(a.id, 'INFO_REQUESTED', a.email, reason);
        } else if (action === 'SUSPEND' || action === 'REACTIVATE') {
          if (!partner) throw Object.assign(new Error('No partner record exists for this application'), { status: 409 });
          partner = action === 'SUSPEND'
            ? { ...partner, status: 'SUSPENDED', suspended_at: now, suspended_by: admin.email, suspension_reason: reason, updated_at: now }
            : { ...partner, status: 'ACTIVE', updated_at: now };
          await tx.saveCpPartner(partner);
        }

        await tx.updateCpApplication(updated);
        await tx.addCpStatusHistory(historyEntry(a.id, a.status, rule.to, admin, reason || undefined));
        if (notification) await tx.saveCpNotification(notification);
        await tx.logAudit({
          admin_id: admin.id, action: `CP_${action}`, entity_type: 'CP_APPLICATION', entity_id: a.id,
          old_value: { status: a.status },
          new_value: { status: rule.to, application_ref: a.application_ref, cp_id: partner?.cp_id, admin_email: admin.email },
          ip_address: clientIp(req)
        });
      });
    } catch (err: any) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      if (err instanceof DuplicateRecordError) return res.status(409).json({ error: 'This change conflicts with an existing record. Refresh and try again.' });
      return sendFailure(res, err, 'The change could not be saved. Nothing was changed.');
    }

    // Decision saved; the e-mail outcome is recorded separately and never undoes it
    if (notification) await deliverAll([notification], updated, partner);
    res.json({ success: true, ...(await applicationDetail(updated.id)) });
  });

  app.post('/api/admin/cp/notifications/:id/retry', authenticateAdmin, async (req: Request, res: Response) => {
    const n = await db.getCpNotification(req.params.id);
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    if (n.status === 'SENT') return res.status(409).json({ error: 'This notification was already sent' });
    if (n.status === 'NO_RECIPIENT') return res.status(409).json({ error: 'The applicant did not provide an e-mail address. Please contact them by phone.' });
    const a = await db.getCpApplication(n.application_id);
    if (!a) return res.status(404).json({ error: 'Application not found' });
    const [result] = await deliverAll([n], a, await db.getCpPartnerByApplication(a.id));
    const admin = adminOf(req);
    await db.logAudit({
      admin_id: admin.id, action: 'CP_NOTIFICATION_RETRIED', entity_type: 'CP_APPLICATION', entity_id: a.id,
      new_value: { notification: n.id, event: n.event, outcome: result.status, admin_email: admin.email }
    });
    res.json({ success: result.status === 'SENT', notification: result });
  });

  // CSV for authorised admins: contact and status fields only (no PAN, date of birth, address or documents)
  app.get('/api/admin/cp/export-csv', authenticateAdmin, async (req: Request, res: Response) => {
    const q = req.query as Record<string, string>;
    const { items } = await db.listCpApplications(listFilter(q));
    if (!items.length) return res.status(404).json({ error: 'No applications match the current filters.' });
    const name = await projectNamer();
    const partners = new Map(await Promise.all(items.map(async a => [a.id, await db.getCpPartnerByApplication(a.id)] as const)));
    const ist = (iso?: string) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }) : '');
    const csv = toCsv(
      ['Application Reference', 'CP ID', 'Status', 'Applicant Name', 'Mobile', 'E-mail', 'Partner Type', 'Company / Firm', 'Years of Experience',
        'City', 'State', 'Interested Projects', 'Approved Projects', 'Submitted (IST)', 'Last Reviewed (IST)', 'Reviewed By'],
      items.map(a => {
        const p = partners.get(a.id);
        return [a.application_ref, p?.cp_id, CP_STATUS_LABELS[a.status], a.full_name, a.mobile, a.email, partnerTypeLabel(a.partner_type), a.company_name,
          a.years_experience, a.city, a.state, a.project_ids.map(name).join('; '), (p?.approved_project_ids || []).map(name).join('; '),
          ist(a.created_at), ist(a.reviewed_at), a.reviewed_by];
      })
    );
    const admin = adminOf(req);
    await db.logAudit({
      admin_id: admin.id, action: 'CP_APPLICATIONS_EXPORTED', entity_type: 'CP_APPLICATION', entity_id: 'export',
      new_value: { rows: items.length, filters: { search: q.search || '', status: q.status || 'all', projectId: q.projectId || 'all', from: q.from || '', to: q.to || '' }, admin_email: admin.email }
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="garg-realty-channel-partners-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' })}.csv"`);
    res.setHeader('X-Export-Count', String(items.length));
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Count');
    res.send(csv);
  });
}
