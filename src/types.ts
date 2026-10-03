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
  active: boolean;
  features: string[];
  created_at: string;
  updated_at: string;
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
  gateway: 'RAZORPAY' | 'SIMULATED';
  gateway_order_id: string;
  gateway_payment_id?: string;
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
