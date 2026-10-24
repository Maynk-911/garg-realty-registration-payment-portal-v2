import type { CpStatus, PartnerType, CpDocumentType } from './cpOptions.js';

export type PaymentStatus =
  | 'INITIATED' 
  | 'PENDING' 
  | 'PAYMENT_PROCESSING' 
  | 'PAID' 
  | 'FAILED' 
  | 'CANCELLED' 
  | 'REFUNDED' 
  | 'PARTIALLY_REFUNDED';

export type RegistrationStatus = 
  | 'SUBMITTED' 
  | 'CONFIRMED' 
  | 'IN_REVIEW' 
  | 'CANCELLED';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

export interface OwnershipPlan {
  id: string;
  name: string;
  label: string;
  type?: 'CO_OWN' | 'FULL_OWN';
  token_amount?: number;
  total_price?: number;
  /** Plot / unit size as published by the admin (e.g. "200 Sq. Yd") */
  size?: string;
  /** Total units of this plan that can be sold; undefined = not tracked (Pangot) */
  inventory?: number;
  /** Hidden from customers when false (kept so existing bookings still reference it) */
  active?: boolean;
  /** Remaining units, computed by the server for customers (null = not tracked) */
  available?: number | null;
}

export interface Project {
  id: string;
  name: string;
  tagline: string;
  description: string;
  location: string;
  token_amount: number;
  total_price: number;
  currency: string;
  tax_percentage: number;
  roi_percentage: number;
  unit_types: string[];
  sample_units: string[];
  ownership_plans?: OwnershipPlan[];
  active: boolean;
  features: string[];
  created_at: string;
  updated_at: string;
  /** Booking ID code, e.g. PNG -> GRG-PNG-YYYYMMDD-0101 */
  code?: string;
  /** Short name used on bookings, receipts and reports (e.g. "Pangot", "Dholera") */
  short_name?: string;
  /** Title shown on the homepage project card */
  display_name?: string;
  /** Customers can register and pay only when true */
  booking_enabled?: boolean;
  /** Account name shown next to the payment QR */
  payee_name?: string;
  /** Payment QR image as a data URL (server-side only; customers get payment_qr_url) */
  payment_qr_data?: string;
  payment_qr_updated_at?: string;
  /** Public URL of the payment QR (computed for customers) */
  payment_qr_url?: string;
  /** Refund terms shown on the form, receipts and refund policy page */
  refund_policy?: string;
  /** Set when an admin saves this project's details; the original seed values are never shown */
  admin_configured_at?: string;
  details_verified_at?: string;
  details_verified_by?: string;
}

export interface Registration {
  id: string;
  registration_number: string;
  // Personal Info (from PDF Section 1)
  full_name: string;
  mobile: string;
  whatsapp?: string;
  email: string;
  date_of_birth?: string;
  gender?: string;
  // Location
  country: string;
  state: string;
  city: string;
  pincode: string;
  address: string;
  // Co-applicant (from PDF Section 1)
  co_applicant_name?: string;
  co_applicant_mobile?: string;
  co_applicant_email?: string;
  co_applicant_address?: string;
  // Unit & Requirement (from PDF Section 2 & 3)
  company_name?: string;
  profession?: string;
  requirement?: string;
  project_id: string;
  project_name: string;
  selected_plan?: string;
  units_count?: number;
  unit_number?: string;
  unit_size?: string;
  floor_no?: string;
  total_price: number;
  roi_percentage: number;
  // Payment Terms (from PDF Section 4)
  token_amount: number;
  tax_amount: number;
  total_payable: number;
  mode_of_payment: string;
  total_payment_received: number;
  // Documents (from PDF Section 5)
  documents_submitted: {
    id_proof: boolean;
    address_proof: boolean;
    photo: boolean;
  };
  notes?: string;
  // Consent & Declaration (from PDF Section 6 & 7)
  consent: boolean;
  consent_timestamp: string;
  declaration_signed: boolean;
  signature_name?: string;
  privacy_policy_version: string;
  terms_version: string;
  ip_address?: string;
  user_agent?: string;
  // Statuses
  payment_status: PaymentStatus;
  registration_status: RegistrationStatus;
  utr_number?: string;
  upi_app?: string;
  sender_upi?: string;
  payment_submitted_at?: string;
  sheet_synced_at?: string;
  payment_verified_at?: string;
  payment_verified_by?: string;
  payment_rejected_at?: string;
  payment_rejected_by?: string;
  // Marketing / Tracking
  source?: string;
  campaign?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentRecord {
  id: string;
  registration_id: string;
  registration_number: string;
  gateway: 'RAZORPAY' | 'SIMULATED' | 'HDFC_SMARTHUB_QR';
  gateway_order_id: string;
  gateway_payment_id?: string;
  utr_number?: string;
  amount: number;
  currency: string;
  payment_status: PaymentStatus;
  payment_method?: string;
  signature_verified: boolean;
  webhook_verified: boolean;
  attempt_number: number;
  error_code?: string;
  error_description?: string;
  created_at: string;
  updated_at: string;
  verified_at?: string;
}

export interface WebhookEvent {
  id: string;
  event_id: string;
  event_type: string;
  gateway: string;
  payload: Record<string, any>;
  signature_verified: boolean;
  processed: boolean;
  processed_at?: string;
  created_at: string;
  error?: string;
}

export interface AuditLog {
  id: string;
  admin_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value?: any;
  new_value?: any;
  timestamp: string;
  ip_address?: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

// ---------- Channel Partner (CP) / Broker onboarding ----------

export interface CpApplication {
  id: string;
  /** Public application reference, e.g. CP-GRG-20261024-0001 */
  application_ref: string;
  status: CpStatus;
  /** Random id sent by the form; a repeated submission with the same id returns the original application */
  client_submission_id?: string;
  // Personal
  full_name: string;
  mobile: string;
  whatsapp?: string;
  email?: string;
  date_of_birth?: string;
  // Professional
  partner_type: PartnerType;
  company_name?: string;
  years_experience: number;
  sales_agents?: number;
  existing_business?: string;
  website?: string;
  linkedin?: string;
  // Address
  country: string;
  state: string;
  city: string;
  pincode: string;
  address: string;
  // Business & tax (format-checked only; verified by an administrator)
  pan_number?: string;
  gst_number?: string;
  rera_number?: string;
  rera_state?: string;
  business_registration_number?: string;
  /** Projects the applicant is interested in (interest only: grants no access to anything) */
  project_ids: string[];
  // Additional
  expected_monthly_leads?: number;
  preferred_locations?: string;
  previous_experience?: string;
  heard_from?: string;
  referral_code?: string;
  comments?: string;
  // Declarations
  declarations_accepted_at: string;
  declaration_version: string;
  ip_address?: string;
  user_agent?: string;
  // Review
  info_request_message?: string;
  decision_reason?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CpDocumentMeta {
  id: string;
  application_id: string;
  doc_type: CpDocumentType;
  /** Sanitised original name, for display only (storage never uses it) */
  original_name: string;
  /** Detected from the file contents, not the browser's claim */
  mime_type: 'application/pdf' | 'image/jpeg' | 'image/png';
  size_bytes: number;
  sha256: string;
  created_at: string;
}
export type CpDocument = CpDocumentMeta & { content: Buffer };

export interface CpPartner {
  id: string;
  /** Official CP ID, e.g. GRG-CP-0001 (generated by the server on approval) */
  cp_id: string;
  application_id: string;
  application_ref: string;
  full_name: string;
  mobile: string;
  email?: string;
  company_name?: string;
  partner_type: PartnerType;
  /** Projects this partner is approved for (does not grant access to bookings, inventory or customer data) */
  approved_project_ids: string[];
  status: 'ACTIVE' | 'SUSPENDED';
  approved_at: string;
  approved_by: string;
  suspended_at?: string;
  suspended_by?: string;
  suspension_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface CpStatusHistoryEntry {
  id: string;
  application_id: string;
  from_status: CpStatus | null;
  to_status: CpStatus;
  admin_id: string | null;
  admin_email: string | null;
  note?: string;
  created_at: string;
}

export type CpNotificationEvent = 'SUBMITTED' | 'SUBMITTED_INTERNAL' | 'APPROVED' | 'REJECTED' | 'INFO_REQUESTED';
/** SENT = accepted by the mail server (not proof of inbox delivery); NOT_CONFIGURED = no SMTP settings; NO_RECIPIENT = applicant gave no e-mail */
export type CpNotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'NOT_CONFIGURED' | 'NO_RECIPIENT';

export interface CpNotification {
  id: string;
  application_id: string;
  event: CpNotificationEvent;
  channel: 'EMAIL';
  recipient?: string;
  status: CpNotificationStatus;
  attempts: number;
  last_error?: string;
  /** Message the administrator wrote (rejection reason / information request), included in the e-mail */
  message?: string;
  created_at: string;
  updated_at: string;
  sent_at?: string;
}
