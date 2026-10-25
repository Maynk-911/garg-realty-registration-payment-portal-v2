// "Track CP Application": public status lookup by application reference, like Track Booking.
//
// New references end in a random part (CP-GRG-YYYYMMDD-NNNN-XXXX) so they cannot practically be guessed; older ones
// (CP-GRG-YYYYMMDD-NNNN) still work. A reference is still NOT proof of identity — anyone who has it can use it:
// - The status lookup shows only limited, non-sensitive facts: status, dates, generic next steps, a masked name,
//   projects, and (once approved) the CP ID. Never PAN, mobile, e-mail, address, internal ids, or any message an
//   administrator wrote (rejection reasons, information requests, suspension notes).
// - The approval certificate is issued by reference only for NEW-format references (with the random part), and only
//   when the application is APPROVED and the partner ACTIVE in the database. It carries only what a certificate needs:
//   name, company, CP ID, approved projects and dates — never PAN, mobile, e-mail, address or internal ids.
// - OLDER references (no random part) are guessable, so they never yield a certificate publicly. There is no free,
//   secure way to verify those applicants online (their own details are not secrets), so the partner team issues
//   their certificate from the admin panel after verifying the partner (GET /api/admin/cp/applications/:id/certificate).
// - Per-connection rate limits on lookups and certificates; every certificate view is recorded in the audit trail.
// Read-only: nothing here can change an application.
import crypto from 'crypto';
import { Express, Request, Response, NextFunction } from 'express';
import { db } from './db.js';
import { clientIp } from './cpGuard.js';
import { CpApplication, CpPartner } from '../types.js';
import { CP_REFERENCE_EXAMPLE, CP_REFERENCE_REGEX, CP_STATUS_LABELS, isLegacyCpReference } from '../cpOptions.js';

const WINDOW_MS = 15 * 60 * 1000;
const envLimit = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v >= 1 && v <= 10_000 ? v : fallback;
};
const LOOKUPS_PER_WINDOW = envLimit('CP_TRACK_LOOKUPS_PER_15MIN', 30);
const CERTIFICATE_TRIES_PER_WINDOW = envLimit('CP_TRACK_CERTIFICATE_TRIES_PER_15MIN', 10);

// ---------- rate limiting (in memory, like the existing login and lookup throttles) ----------
type Counter = { count: number; expires: number };
const lookups = new Map<string, Counter>();
const certificateTries = new Map<string, Counter>();
function hit(map: Map<string, Counter>, key: string, max: number, windowMs: number) {
  const now = Date.now();
  for (const [k, v] of map) if (v.expires <= now) map.delete(k);
  const entry = map.get(key) || { count: 0, expires: now + windowMs };
  entry.count++;
  map.set(key, entry);
  return entry.count > max;
}
const limited = (map: Map<string, Counter>, max: number, message: string) => (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  if (hit(map, clientIp(req), max, WINDOW_MS)) return res.status(429).json({ error: message });
  next();
};

// ---------- what the public may see ----------
/** "Rahul Kumar Sharma" -> "R**** K**** S*****": enough for the applicant to recognise, not to identify */
export const maskName = (name: string) =>
  name.trim().split(/\s+/).map(w => (w.length ? `${w[0].toUpperCase()}${'*'.repeat(Math.max(2, w.length - 1))}` : '')).join(' ');

const LEGACY_CERTIFICATE_MESSAGE =
  'For your security, certificates for older application references (without the last four characters) cannot be downloaded with the reference alone. ' +
  'Please contact our partner team, quoting your application reference: they will verify your details and send you your approval certificate.';

function nextSteps(status: CpApplication['status'], legacy: boolean): string[] {
  if (status === 'APPROVED' && legacy) return [
    'Congratulations — your application has been approved.',
    'Please quote your Channel Partner ID in all communication with us.',
    'To receive your approval certificate, please contact our partner team: they will verify your details and send it to you.',
    'Our partner team will contact you with project information and the channel partner terms.'
  ];
  switch (status) {
    case 'PENDING': return [
      'Your application has been received and is waiting to be reviewed.',
      'Our team will verify your details and documents and contact you on your registered mobile number or e-mail.',
      'No action is needed from you at the moment.'
    ];
    case 'UNDER_REVIEW': return [
      'Our team is currently verifying your details and documents.',
      'You will be contacted if anything else is needed.'
    ];
    case 'ADDITIONAL_INFO_REQUIRED': return [
      'Our team needs some more information to continue reviewing your application.',
      'The details were sent to your registered e-mail address. Please reply to that e-mail, or contact our partner team quoting your application reference.'
    ];
    case 'APPROVED': return [
      'Congratulations — your application has been approved.',
      'Please quote your Channel Partner ID in all communication with us.',
      'You can download your approval certificate below and save it as a PDF.',
      'Our partner team will contact you with project information and the channel partner terms.'
    ];
    case 'REJECTED': return [
      'Your application could not be approved at this time.',
      'The reason was sent to your registered e-mail address. For any questions, please contact our partner team quoting your application reference.'
    ];
    case 'SUSPENDED': return [
      'Your channel partnership is currently suspended.',
      'Please contact our partner team for details, quoting your Channel Partner ID.'
    ];
  }
}

async function projectNamer() {
  const names = new Map((await db.listProjects(false)).map(p => [p.id, p.short_name || p.name]));
  return (ids: string[]) => ids.map(id => names.get(id) || id);
}

const istDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }) : null);
const NOT_FOUND = 'No application was found with this reference number. Please check it and try again.';

/** True when an approval certificate may be produced at all (database state, whoever asks) */
export const certificateEligible = (a: CpApplication, partner: CpPartner | null): partner is CpPartner =>
  a.status === 'APPROVED' && partner?.status === 'ACTIVE';

/** Certificate facts (used by the public page and the admin panel) */
export async function buildCpCertificate(a: CpApplication, partner: CpPartner) {
  const names = await projectNamer();
  const facts = [partner.cp_id, a.application_ref, a.full_name, partner.approved_at].join('|');
  return {
    certificate_number: `CERT-${partner.cp_id}`,
    cp_id: partner.cp_id,
    application_ref: a.application_ref,
    full_name: a.full_name,
    company_name: a.company_name || null,
    approved_projects: names(partner.approved_project_ids),
    approved_at: partner.approved_at,
    issued_at: new Date().toISOString(),
    // Like booking receipts: an HMAC over the certificate facts, so an edited copy will not match
    verification_code: crypto.createHmac('sha256', `cp-certificate:${process.env.ADMIN_JWT_SECRET || ''}`).update(facts).digest('hex').slice(0, 16).toUpperCase()
  };
}

export function registerCpTrackRoutes(app: Express) {
  // Status by reference: limited, non-sensitive information only
  app.get('/api/cp/track/:reference', limited(lookups, LOOKUPS_PER_WINDOW, 'Too many lookups. Please try again in 15 minutes.'),
    async (req: Request, res: Response) => {
      const reference = String(req.params.reference || '').trim().toUpperCase();
      if (!CP_REFERENCE_REGEX.test(reference)) {
        return res.status(400).json({ error: `Enter your full application reference, e.g. ${CP_REFERENCE_EXAMPLE}.` });
      }
      const a = await db.getCpApplicationByRef(reference);
      if (!a) return res.status(404).json({ error: NOT_FOUND });
      const partner = await db.getCpPartnerByApplication(a.id);
      const names = await projectNamer();
      const partnerVisible = Boolean(partner) && (a.status === 'APPROVED' || a.status === 'SUSPENDED');
      const legacy = isLegacyCpReference(a.application_ref);
      const eligible = certificateEligible(a, partner);
      res.json({
        application: {
          reference: a.application_ref,
          applicant: maskName(a.full_name),
          status: a.status,
          status_label: CP_STATUS_LABELS[a.status],
          submitted_on: istDay(a.created_at),
          last_updated_on: istDay(a.updated_at),
          projects_of_interest: names(a.project_ids),
          next_steps: nextSteps(a.status, legacy),
          cp_id: partnerVisible ? partner!.cp_id : null,
          approved_projects: partnerVisible ? names(partner!.approved_project_ids) : [],
          approved_on: partnerVisible ? istDay(partner!.approved_at) : null,
          // Downloadable here only with a new-format reference; older references get it from the partner team
          certificate_available: eligible && !legacy,
          certificate_from_partner_team: eligible && legacy
        }
      });
    });

  // Approval certificate by reference: new-format references only, and only when the database says APPROVED + ACTIVE
  app.get('/api/cp/track/:reference/certificate', limited(certificateTries, CERTIFICATE_TRIES_PER_WINDOW, 'Too many certificate requests. Please try again in 15 minutes.'),
    async (req: Request, res: Response) => {
      const reference = String(req.params.reference || '').trim().toUpperCase();
      if (!CP_REFERENCE_REGEX.test(reference)) return res.status(400).json({ error: `Enter your full application reference, e.g. ${CP_REFERENCE_EXAMPLE}.` });
      // Older, guessable references: refused before any lookup, so the answer also reveals nothing about the record
      if (isLegacyCpReference(reference)) return res.status(403).json({ error: LEGACY_CERTIFICATE_MESSAGE, code: 'LEGACY_REFERENCE' });
      const a = await db.getCpApplicationByRef(reference);
      if (!a) return res.status(404).json({ error: NOT_FOUND });
      const partner = await db.getCpPartnerByApplication(a.id);
      if (!certificateEligible(a, partner)) {
        return res.status(409).json({ error: 'An approval certificate is available only for approved, active channel partners.' });
      }
      await db.logAudit({ admin_id: 'public', action: 'CP_CERTIFICATE_VIEWED', entity_type: 'CP_APPLICATION', entity_id: a.id, ip_address: clientIp(req) });
      res.json({ certificate: await buildCpCertificate(a, partner) });
    });
}
