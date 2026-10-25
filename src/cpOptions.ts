// Channel Partner (CP) / Broker onboarding — shared between the React frontend and the Express backend.
// Contains no secrets. Format checks here only check the FORMAT of a number; they never prove it is genuine.

export const CP_STATUSES = ['PENDING', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type CpStatus = typeof CP_STATUSES[number];

export const CP_STATUS_LABELS: Record<CpStatus, string> = {
  PENDING: 'Pending Review',
  UNDER_REVIEW: 'Under Review',
  ADDITIONAL_INFO_REQUIRED: 'Additional Info Required',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended'
};

/** Admin actions and the statuses each one may start from */
export const CP_ACTIONS = {
  UNDER_REVIEW: { to: 'UNDER_REVIEW', from: ['PENDING', 'ADDITIONAL_INFO_REQUIRED'], label: 'Mark Under Review' },
  REQUEST_INFO: { to: 'ADDITIONAL_INFO_REQUIRED', from: ['PENDING', 'UNDER_REVIEW'], label: 'Request Additional Information' },
  APPROVE: { to: 'APPROVED', from: ['PENDING', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED'], label: 'Approve' },
  REJECT: { to: 'REJECTED', from: ['PENDING', 'UNDER_REVIEW', 'ADDITIONAL_INFO_REQUIRED'], label: 'Reject' },
  SUSPEND: { to: 'SUSPENDED', from: ['APPROVED'], label: 'Suspend Partner' },
  REACTIVATE: { to: 'APPROVED', from: ['SUSPENDED'], label: 'Reactivate Partner' }
} as const satisfies Record<string, { to: CpStatus; from: readonly CpStatus[]; label: string }>;
export type CpAction = keyof typeof CP_ACTIONS;
/** Actions that must carry a written reason / message */
export const CP_ACTIONS_NEEDING_REASON: CpAction[] = ['REQUEST_INFO', 'REJECT', 'SUSPEND'];

export const PARTNER_TYPES = [
  { value: 'INDIVIDUAL_BROKER', label: 'Individual Broker' },
  { value: 'CONSULTANT', label: 'Real Estate Consultant' },
  { value: 'BROKERAGE_FIRM', label: 'Brokerage Firm' },
  { value: 'CP_COMPANY', label: 'Channel Partner Company' },
  { value: 'OTHER', label: 'Other' }
] as const;
export type PartnerType = typeof PARTNER_TYPES[number]['value'];
/** Partner types that represent a business: company / firm name is then required */
export const COMPANY_PARTNER_TYPES: PartnerType[] = ['BROKERAGE_FIRM', 'CP_COMPANY'];
export const partnerTypeLabel = (v?: string) => PARTNER_TYPES.find(t => t.value === v)?.label || v || '';

export const HEARD_FROM_OPTIONS = [
  'Garg Realty team member', 'Existing channel partner', 'Social media', 'Website / Google search',
  'Property portal', 'Event / exhibition', 'Newspaper / print', 'Other'
] as const;

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
] as const;

// ---------- Documents ----------
export const CP_DOCUMENT_TYPES = [
  { key: 'PHOTO', label: 'Profile Photograph', hint: 'Recent passport-style photo', formats: ['jpg', 'png'] },
  { key: 'PAN_CARD', label: 'PAN Card', hint: 'Copy of your (or your firm\'s) PAN card', formats: ['pdf', 'jpg', 'png'] },
  { key: 'GST_CERTIFICATE', label: 'GST Certificate', hint: 'Only if registered under GST', formats: ['pdf', 'jpg', 'png'] },
  { key: 'RERA_CERTIFICATE', label: 'RERA Certificate', hint: 'Only if you hold a RERA agent registration', formats: ['pdf', 'jpg', 'png'] },
  { key: 'COMPANY_REGISTRATION', label: 'Company / Firm Registration Certificate', hint: 'For firms and companies', formats: ['pdf', 'jpg', 'png'] },
  { key: 'ADDRESS_PROOF', label: 'Address Proof', hint: 'Aadhaar (masked), utility bill, passport, etc.', formats: ['pdf', 'jpg', 'png'] },
  { key: 'OTHER', label: 'Other Supporting Document', hint: 'Anything else that supports your application', formats: ['pdf', 'jpg', 'png'] }
] as const;
export type CpDocumentType = typeof CP_DOCUMENT_TYPES[number]['key'];
export const cpDocumentLabel = (key: string) => CP_DOCUMENT_TYPES.find(d => d.key === key)?.label || key;

/** Public settings served by GET /api/cp/config (the server decides which documents are mandatory) */
export interface CpPublicConfig {
  documents: { key: CpDocumentType; label: string; hint: string; formats: readonly string[]; required: boolean }[];
  maxFileBytes: number;
  maxTotalBytes: number;
  allowInternational: boolean;
  declarationVersion: string;
  projects: { id: string; name: string }[];
}

// ---------- Declarations (versioned: the version accepted is stored with each application) ----------
export const CP_DECLARATION_VERSION = 'cp-v2026.1';
export const CP_DECLARATIONS = [
  { key: 'accurate', text: 'I confirm that the information and documents I have provided are accurate and genuine to the best of my knowledge.' },
  { key: 'contact', text: 'I authorise Garg Realty Group to contact me by phone, WhatsApp or e-mail about this application.' },
  { key: 'terms', text: 'I have read and agree to the Privacy Policy and the Terms & Conditions.' }
] as const;

// ---------- Application references ----------
/**
 * Characters for the random part of a reference: no 0/O or 1/I/L, so it can be read out and typed without mistakes.
 * 31 characters ^ 4 = about 923,000 combinations per application.
 */
export const CP_REF_SUFFIX_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CP_REF_SUFFIX_LENGTH = 4;
/**
 * CP-GRG-YYYYMMDD-NNNN-XXXX (current: sequence + random part) or CP-GRG-YYYYMMDD-NNNN (issued before the random
 * part was added; still accepted so existing applicants can keep tracking).
 */
export const CP_REFERENCE_REGEX = /^CP-GRG-\d{8}-\d{4,6}(?:-[2-9A-HJKMNP-Z]{4})?$/;
export const CP_REFERENCE_EXAMPLE = 'CP-GRG-20261024-0001-K7Q2';
/**
 * Issued before the random part existed: guessable from the sequence, so it is never enough on its own for an
 * approval certificate (the partner team issues those certificates after verifying the partner).
 */
// The whole format is checked, not just the ending: an older reference's sequence number can itself look like a random
// part (e.g. CP-GRG-20200102-5678), and must still count as older.
export const isLegacyCpReference = (reference: string) =>
  !/^CP-GRG-\d{8}-\d{4,6}-[2-9A-HJKMNP-Z]{4}$/.test(reference.trim().toUpperCase());

// ---------- Format checks (shared so the form and the server agree) ----------
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const INDIA_PIN_REGEX = /^[1-9][0-9]{5}$/;
/**
 * Plain mailbox addresses only: letters, digits and . _ % + - before the @, a normal domain after it.
 * Deliberately stricter than the e-mail standard: quotes, comments, angle brackets, commas, semicolons and spaces
 * are refused, so the address stored (and shown to admins) is exactly the one that receives mail — mail libraries
 * cannot read a different or extra recipient out of it.
 */
export const EMAIL_REGEX = /^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
export const isValidEmail = (email: string) => email.length <= 190 && email.split('@')[0].length <= 64 && EMAIL_REGEX.test(email);
/** RERA numbers differ by state (e.g. "UPRERAAGT12345", "A51800012345", "RAJ/A/2021/1234"): only the character set is checked */
export const RERA_REGEX = /^[A-Za-z0-9][A-Za-z0-9/\-. ]{3,59}$/;

/** Indian mobile -> +91XXXXXXXXXX; international (when allowed) -> +<8-15 digits>. null = invalid. */
export function normalizeCpMobile(input: string, country: string = 'India'): string | null {
  const raw = String(input || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (isIndia(country)) {
    const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
      : digits;
    return /^[6-9][0-9]{9}$/.test(local) ? `+91${local}` : null;
  }
  return /^[+\d\s()-]+$/.test(raw) && digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export const isIndia = (country?: string) => !country || /^(india|in|bharat)$/i.test(country.trim());

/** The PAN embedded in a GSTIN (characters 3-12), used to show the admin whether the two agree */
export const panFromGstin = (gstin?: string) => (gstin && GSTIN_REGEX.test(gstin) ? gstin.slice(2, 12) : null);

/** PAN shown in lists and detail views: ABCXXXXXXF (the full number is revealed only on request, and audited) */
export const maskPan = (pan?: string) => (pan && pan.length === 10 ? `${pan.slice(0, 3)}XXXXXX${pan.slice(9)}` : pan ? 'XXXXXXXXXX' : '');
