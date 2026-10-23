-- Garg Realty Booking Portal — MySQL / MariaDB schema (version 1)
-- Applied automatically by the server at startup (idempotent: CREATE TABLE IF NOT EXISTS).
-- Can also be imported manually in phpMyAdmin. Works on MariaDB 10.4+ and MySQL 8.0+.
-- All timestamps are stored in UTC. Money is DECIMAL(14,2) (rupees and paise).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  code VARCHAR(8) NOT NULL,
  name VARCHAR(160) NOT NULL,
  short_name VARCHAR(80) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  tagline VARCHAR(255) NULL,
  description TEXT NULL,
  location VARCHAR(255) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  token_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  tax_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  roi_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  booking_enabled TINYINT(1) NOT NULL DEFAULT 0,
  payee_name VARCHAR(160) NULL,
  refund_policy TEXT NULL,
  payment_qr_data MEDIUMTEXT NULL,
  payment_qr_updated_at DATETIME(3) NULL,
  unit_types TEXT NULL,
  sample_units TEXT NULL,
  features TEXT NULL,
  admin_configured_at DATETIME(3) NULL,
  details_verified_at DATETIME(3) NULL,
  details_verified_by VARCHAR(190) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_projects_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bookable units/plots of a project, each with its own price, token and inventory
CREATE TABLE IF NOT EXISTS project_plans (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  label VARCHAR(120) NOT NULL,
  plan_type VARCHAR(20) NULL,
  size VARCHAR(60) NULL,
  total_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  token_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  inventory INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_project_plans_label (project_id, label),
  KEY idx_project_plans_project (project_id, sort_order),
  CONSTRAINT fk_project_plans_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_project_plans_amounts CHECK (total_price >= 0 AND token_amount >= 0 AND (inventory IS NULL OR inventory >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(160) NOT NULL,
  role VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_admin_users_email (email),
  CONSTRAINT chk_admin_users_role CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'VIEWER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bookings / registrations (each belongs to exactly one project)
CREATE TABLE IF NOT EXISTS registrations (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  registration_number VARCHAR(40) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  project_name VARCHAR(80) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  whatsapp VARCHAR(20) NULL,
  email VARCHAR(190) NOT NULL,
  date_of_birth VARCHAR(20) NULL,
  gender VARCHAR(20) NULL,
  country VARCHAR(80) NULL,
  state VARCHAR(80) NULL,
  city VARCHAR(80) NULL,
  pincode VARCHAR(12) NULL,
  address TEXT NULL,
  co_applicant_name VARCHAR(160) NULL,
  co_applicant_mobile VARCHAR(20) NULL,
  co_applicant_email VARCHAR(190) NULL,
  co_applicant_address TEXT NULL,
  company_name VARCHAR(160) NULL,
  profession VARCHAR(120) NULL,
  requirement VARCHAR(255) NULL,
  selected_plan VARCHAR(120) NULL,
  units_count INT NOT NULL DEFAULT 1,
  unit_number VARCHAR(120) NULL,
  unit_size VARCHAR(120) NULL,
  floor_no VARCHAR(40) NULL,
  total_price DECIMAL(14,2) NOT NULL DEFAULT 0,
  roi_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  token_amount DECIMAL(14,2) NOT NULL,
  tax_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_payable DECIMAL(14,2) NOT NULL,
  total_payment_received DECIMAL(14,2) NOT NULL DEFAULT 0,
  mode_of_payment VARCHAR(160) NULL,
  payment_status VARCHAR(24) NOT NULL,
  registration_status VARCHAR(24) NOT NULL,
  utr_number VARCHAR(40) NULL,
  upi_app VARCHAR(120) NULL,
  sender_upi VARCHAR(120) NULL,
  payment_submitted_at DATETIME(3) NULL,
  sheet_synced_at DATETIME(3) NULL,
  payment_verified_at DATETIME(3) NULL,
  payment_verified_by VARCHAR(64) NULL,
  payment_rejected_at DATETIME(3) NULL,
  payment_rejected_by VARCHAR(64) NULL,
  documents_submitted TEXT NULL,
  notes TEXT NULL,
  consent TINYINT(1) NOT NULL DEFAULT 0,
  consent_timestamp DATETIME(3) NULL,
  declaration_signed TINYINT(1) NOT NULL DEFAULT 0,
  signature_name VARCHAR(160) NULL,
  privacy_policy_version VARCHAR(20) NULL,
  terms_version VARCHAR(20) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  source VARCHAR(120) NULL,
  campaign VARCHAR(255) NULL,
  utm_source VARCHAR(255) NULL,
  utm_medium VARCHAR(255) NULL,
  utm_campaign VARCHAR(255) NULL,
  utm_term VARCHAR(255) NULL,
  utm_content VARCHAR(255) NULL,
  gclid VARCHAR(255) NULL,
  fbclid VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  -- A UTR can be active on only one booking (a rejected/FAILED booking releases it)
  active_utr VARCHAR(40) GENERATED ALWAYS AS (CASE WHEN payment_status <> 'FAILED' THEN utr_number ELSE NULL END) STORED,
  UNIQUE KEY uq_registrations_number (registration_number),
  UNIQUE KEY uq_registrations_active_utr (active_utr),
  KEY idx_registrations_project_created (project_id, created_at),
  KEY idx_registrations_payment_status (payment_status),
  KEY idx_registrations_created (created_at),
  KEY idx_registrations_email (email),
  KEY idx_registrations_mobile (mobile),
  CONSTRAINT fk_registrations_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_registrations_payment_status CHECK (payment_status IN ('INITIATED','PENDING','PAYMENT_PROCESSING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  CONSTRAINT chk_registrations_status CHECK (registration_status IN ('SUBMITTED','CONFIRMED','IN_REVIEW','CANCELLED')),
  CONSTRAINT chk_registrations_amounts CHECK (token_amount >= 0 AND total_payable >= 0 AND total_payment_received >= 0 AND units_count >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payment attempts and UTR submissions (each linked to its booking and project)
CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  registration_id VARCHAR(40) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  registration_number VARCHAR(40) NOT NULL,
  gateway VARCHAR(24) NOT NULL,
  gateway_order_id VARCHAR(100) NOT NULL,
  gateway_payment_id VARCHAR(100) NULL,
  utr_number VARCHAR(40) NULL,
  amount DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  payment_status VARCHAR(24) NOT NULL,
  payment_method VARCHAR(160) NULL,
  signature_verified TINYINT(1) NOT NULL DEFAULT 0,
  webhook_verified TINYINT(1) NOT NULL DEFAULT 0,
  attempt_number INT NOT NULL,
  error_code VARCHAR(80) NULL,
  error_description VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  verified_at DATETIME(3) NULL,
  UNIQUE KEY uq_payments_registration_attempt (registration_id, attempt_number),
  KEY idx_payments_order (gateway_order_id),
  KEY idx_payments_project (project_id),
  KEY idx_payments_utr (utr_number),
  CONSTRAINT fk_payments_registration FOREIGN KEY (registration_id) REFERENCES registrations (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_payments_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_payments_status CHECK (payment_status IN ('INITIATED','PENDING','PAYMENT_PROCESSING','PAID','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  CONSTRAINT chk_payments_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payment gateway webhook events (idempotency: each gateway event is processed once)
CREATE TABLE IF NOT EXISTS webhook_events (
  id VARCHAR(120) NOT NULL PRIMARY KEY,
  event_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  gateway VARCHAR(40) NOT NULL,
  payload MEDIUMTEXT NULL,
  signature_verified TINYINT(1) NOT NULL DEFAULT 0,
  processed TINYINT(1) NOT NULL DEFAULT 0,
  processed_at DATETIME(3) NULL,
  error TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_webhook_events_event (event_id),
  KEY idx_webhook_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  admin_id VARCHAR(190) NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id VARCHAR(120) NOT NULL,
  old_value MEDIUMTEXT NULL,
  new_value MEDIUMTEXT NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_audit_logs_created (created_at),
  KEY idx_audit_logs_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Booking ID sequence (atomic increment)
CREATE TABLE IF NOT EXISTS counters (
  name VARCHAR(40) NOT NULL PRIMARY KEY,
  value BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
