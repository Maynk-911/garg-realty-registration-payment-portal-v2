// Required records shared by both stores: the two projects and the admin account from the environment.
// Only verified configuration is seeded. No bookings or payments are ever created here.
import crypto from 'crypto';
import { Project } from '../types.js';
import { UNIT_OPTIONS, PANGOT_ID, DHOLERA_ID, PANGOT_PAYEE, PANGOT_REFUND_POLICY } from '../bookingOptions.js';
import type { AdminRecord } from './store.js';

const SEED_DATE = new Date('2026-01-01T00:00:00Z').toISOString();

/** Pangot's existing, verified configuration (₹51,000 token per unit, 4 unit options) */
export const PANGOT_SEED: Project = {
  id: PANGOT_ID,
  name: 'Pangot Luxury Plots & Cottages',
  tagline: 'Pangot Booking - Booking & Plot Details Form',
  description: 'Scenic high-altitude hill plots in Pangot (Nainital region) with pristine Himalayan views, high ROI rental yield, and legal clear title.',
  location: 'Pangot, Nainital, Uttarakhand',
  token_amount: 51000,
  total_price: 2500000,
  currency: 'INR',
  tax_percentage: 0, // Advance token booking has no GST surcharge
  roi_percentage: 14.5,
  unit_types: [...UNIT_OPTIONS],
  sample_units: [],
  ownership_plans: [
    { id: 'plan_7l_co_own', name: UNIT_OPTIONS[0], label: UNIT_OPTIONS[0], type: 'CO_OWN', token_amount: 51000, total_price: 700000 },
    { id: 'plan_18l_co_own', name: UNIT_OPTIONS[1], label: UNIT_OPTIONS[1], type: 'CO_OWN', token_amount: 51000, total_price: 1800000 },
    { id: 'plan_studio_full_own', name: UNIT_OPTIONS[2], label: UNIT_OPTIONS[2], type: 'FULL_OWN', token_amount: 51000, total_price: 2500000 },
    { id: 'plan_villa_full_own', name: UNIT_OPTIONS[3], label: UNIT_OPTIONS[3], type: 'FULL_OWN', token_amount: 51000, total_price: 5000000 }
  ],
  active: true,
  features: [
    '15-day 100% money back guarantee on token',
    'Immediate allotment certificate',
    'High appreciation potential (14.5% targeted ROI)',
    'Freehold registry and mutation'
  ],
  code: 'PNG',
  short_name: 'Pangot',
  display_name: 'Pangot – Sukkoon Resort, Nainital',
  booking_enabled: true,
  payee_name: PANGOT_PAYEE,
  refund_policy: PANGOT_REFUND_POLICY,
  created_at: SEED_DATE,
  updated_at: SEED_DATE
};

/** Dholera starts empty and closed: no prices, token, plots, QR or refund terms until an admin publishes verified details */
export const DHOLERA_SEED: Project = {
  id: DHOLERA_ID,
  name: 'Dholera – Smart City Plots',
  tagline: 'Smart City Plots, Gujarat',
  description: '',
  location: 'Dholera, Gujarat',
  token_amount: 0,
  total_price: 0,
  currency: 'INR',
  tax_percentage: 0,
  roi_percentage: 0,
  unit_types: [],
  sample_units: [],
  ownership_plans: [],
  active: true,
  features: [],
  code: 'DHL',
  short_name: 'Dholera',
  display_name: 'Dholera – Smart City Plots, Gujarat',
  booking_enabled: false,
  payee_name: '',
  refund_policy: '',
  created_at: SEED_DATE,
  updated_at: SEED_DATE
};

export const SEED_PROJECTS: Project[] = [PANGOT_SEED, DHOLERA_SEED];

/**
 * Pangot's fixed fields are always taken from the code (they are not editable in the admin panel),
 * so a stored Pangot record can never drift from the verified ₹51,000 / 4-unit configuration.
 */
export function withPangotFixedConfig(stored: Project): Project {
  return {
    ...stored,
    token_amount: PANGOT_SEED.token_amount,
    unit_types: PANGOT_SEED.unit_types,
    sample_units: PANGOT_SEED.sample_units,
    ownership_plans: PANGOT_SEED.ownership_plans,
    code: PANGOT_SEED.code,
    short_name: PANGOT_SEED.short_name,
    display_name: PANGOT_SEED.display_name,
    payee_name: PANGOT_SEED.payee_name,
    refund_policy: PANGOT_SEED.refund_policy,
    booking_enabled: stored.booking_enabled === undefined ? true : stored.booking_enabled
  };
}

/** The admin account defined by ADMIN_EMAIL / ADMIN_PASSWORD (null if not configured or too weak) */
export function configuredAdmin(): AdminRecord | null {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 16 || password === 'AdminPassword@2026') return null;
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: 'admin_1', email, name: 'Principal Executive', role: 'SUPER_ADMIN',
    passwordHash: `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
  };
}
