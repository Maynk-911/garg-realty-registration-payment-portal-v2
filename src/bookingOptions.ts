// Shared between the React frontend and the Express backend.
// Contains no secrets — only public booking constants.

// The ONLY 4 unit options a customer can book
export const UNIT_OPTIONS = [
  '7 L – Co-Own',
  '18 L – Co-Own',
  'Studio – Full Own',
  'Villa – Full Own'
] as const;

export type UnitOption = typeof UNIT_OPTIONS[number];

// Official asset paths (served from /public, byte-identical copies of the supplied files)
export const LOGO_SRC = '/logo-mark.png';
export const PAYMENT_QR_SRC = '/payment-qr.jpeg';

// Projects offered on the portal. Their records are never mixed: each booking stores its project_id.
export const PANGOT_ID = 'proj_pangot';
export const DHOLERA_ID = 'proj_dholera';
export const PUBLIC_PROJECT_IDS = [PANGOT_ID, DHOLERA_ID] as const;

// Pangot's existing, verified terms (unchanged)
export const PANGOT_REFUND_POLICY = 'The token amount is fully-refundable if booking is cancelled within 15 days.';
export const PANGOT_PAYEE = 'Garg Residency Pvt Ltd';
export const PANGOT_PAYMENT_MODE = 'HDFC SmartHub QR (TID: 68283784)';

/**
 * Resolve a submitted / stored label to one of the 4 unit options.
 * Tolerates the older spellings ("₹7 L - Co-Own") so existing records keep their plan.
 * Returns null for anything that is not one of the 4 options.
 */
export function normalizeUnitOption(value: unknown): UnitOption | null {
  const key = (v: string) => v.replace(/₹/g, '').replace(/[-–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  if (typeof value !== 'string' || !value.trim()) return null;
  const wanted = key(value);
  return UNIT_OPTIONS.find(opt => key(opt) === wanted) || null;
}

/**
 * Customer-facing / spreadsheet payment status.
 * "Payment Verified" is only ever shown once the accounts desk has verified the UTR (status PAID).
 */
export function getPaymentStatusLabel(reg: { payment_status?: string; utr_number?: string; payment_verified_at?: string; payment_verified_by?: string }): string {
  if (reg.payment_status === 'PAID' && reg.payment_verified_at && reg.payment_verified_by) return 'Payment Verified';
  if (reg.payment_status === 'FAILED') return 'Payment Failed';
  if (reg.payment_status && ['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(reg.payment_status)) return reg.payment_status.replace(/_/g, ' ');
  return 'Payment Verification Pending';
}
