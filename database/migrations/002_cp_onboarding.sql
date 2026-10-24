-- Migration 2: Channel Partner (CP) / Broker onboarding
-- Adds NEW tables only. It never alters, empties or drops the booking/payment tables.
-- Applied once by the server at startup and recorded in schema_migrations (version 2).
-- Every statement is idempotent (IF NOT EXISTS / INSERT IGNORE), so re-running it after an interrupted
-- start is safe. Rollback (manual, only if the module is withdrawn): 002_cp_onboarding.rollback.sql
-- Works on MariaDB 10.4+ and MySQL 8.0+. Timestamps are UTC.

-- Applications submitted from /cp-registration
CREATE TABLE IF NOT EXISTS cp_applications (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  application_ref VARCHAR(40) NOT NULL,
  status VARCHAR(32) NOT NULL,
  client_submission_id VARCHAR(64) NULL,
  full_name VARCHAR(160) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  whatsapp VARCHAR(20) NULL,
  email VARCHAR(190) NULL,
  date_of_birth DATE NULL,
  partner_type VARCHAR(32) NOT NULL,
  company_name VARCHAR(160) NULL,
  years_experience SMALLINT NOT NULL DEFAULT 0,
  sales_agents INT NULL,
  existing_business VARCHAR(500) NULL,
  website VARCHAR(255) NULL,
  linkedin VARCHAR(255) NULL,
  country VARCHAR(80) NOT NULL,
  state VARCHAR(80) NOT NULL,
  city VARCHAR(80) NOT NULL,
  pincode VARCHAR(12) NOT NULL,
  address TEXT NOT NULL,
  pan_number VARCHAR(10) NULL,
  gst_number VARCHAR(15) NULL,
  rera_number VARCHAR(60) NULL,
  rera_state VARCHAR(80) NULL,
  business_registration_number VARCHAR(60) NULL,
  expected_monthly_leads INT NULL,
  preferred_locations VARCHAR(500) NULL,
  previous_experience TEXT NULL,
  heard_from VARCHAR(80) NULL,
  referral_code VARCHAR(40) NULL,
  comments TEXT NULL,
  declarations_accepted_at DATETIME(3) NOT NULL,
  declaration_version VARCHAR(20) NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  info_request_message TEXT NULL,
  decision_reason TEXT NULL,
  reviewed_by VARCHAR(190) NULL,
  reviewed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  -- One open application per mobile number / e-mail; a REJECTED application releases them so the person can re-apply
  active_mobile VARCHAR(20) GENERATED ALWAYS AS (CASE WHEN status <> 'REJECTED' THEN mobile ELSE NULL END) STORED,
  active_email VARCHAR(190) GENERATED ALWAYS AS (CASE WHEN status <> 'REJECTED' THEN email ELSE NULL END) STORED,
  UNIQUE KEY uq_cp_applications_ref (application_ref),
  UNIQUE KEY uq_cp_applications_submission (client_submission_id),
  UNIQUE KEY uq_cp_applications_active_mobile (active_mobile),
  UNIQUE KEY uq_cp_applications_active_email (active_email),
  KEY idx_cp_applications_status_created (status, created_at),
  KEY idx_cp_applications_created (created_at),
  KEY idx_cp_applications_mobile (mobile),
  KEY idx_cp_applications_name (full_name),
  KEY idx_cp_applications_company (company_name),
  KEY idx_cp_applications_city (city),
  CONSTRAINT chk_cp_applications_status CHECK (status IN ('PENDING','UNDER_REVIEW','ADDITIONAL_INFO_REQUIRED','APPROVED','REJECTED','SUSPENDED')),
  CONSTRAINT chk_cp_applications_numbers CHECK (years_experience >= 0 AND (sales_agents IS NULL OR sales_agents >= 0) AND (expected_monthly_leads IS NULL OR expected_monthly_leads >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Projects an applicant is interested in (interest only: grants no access to bookings or inventory)
CREATE TABLE IF NOT EXISTS cp_application_projects (
  application_id VARCHAR(40) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (application_id, project_id),
  KEY idx_cp_application_projects_project (project_id),
  CONSTRAINT fk_cp_application_projects_application FOREIGN KEY (application_id) REFERENCES cp_applications (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cp_application_projects_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Uploaded documents, stored privately in the database (never in a public folder, never under a guessable URL)
CREATE TABLE IF NOT EXISTS cp_documents (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  application_id VARCHAR(40) NOT NULL,
  doc_type VARCHAR(40) NOT NULL,
  original_name VARCHAR(160) NOT NULL,
  mime_type VARCHAR(40) NOT NULL,
  size_bytes INT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  content MEDIUMBLOB NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_cp_documents_type (application_id, doc_type),
  CONSTRAINT fk_cp_documents_application FOREIGN KEY (application_id) REFERENCES cp_applications (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_cp_documents_mime CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  CONSTRAINT chk_cp_documents_size CHECK (size_bytes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Approved partners: one per approved application, each with a unique server-generated CP ID
CREATE TABLE IF NOT EXISTS cp_partners (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  cp_id VARCHAR(20) NOT NULL,
  application_id VARCHAR(40) NOT NULL,
  application_ref VARCHAR(40) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  mobile VARCHAR(20) NOT NULL,
  email VARCHAR(190) NULL,
  company_name VARCHAR(160) NULL,
  partner_type VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  approved_at DATETIME(3) NOT NULL,
  approved_by VARCHAR(190) NOT NULL,
  suspended_at DATETIME(3) NULL,
  suspended_by VARCHAR(190) NULL,
  suspension_reason TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_cp_partners_cp_id (cp_id),
  UNIQUE KEY uq_cp_partners_application (application_id),
  KEY idx_cp_partners_status (status),
  CONSTRAINT fk_cp_partners_application FOREIGN KEY (application_id) REFERENCES cp_applications (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_cp_partners_status CHECK (status IN ('ACTIVE','SUSPENDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cp_partner_projects (
  partner_id VARCHAR(40) NOT NULL,
  project_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (partner_id, project_id),
  CONSTRAINT fk_cp_partner_projects_partner FOREIGN KEY (partner_id) REFERENCES cp_partners (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cp_partner_projects_project FOREIGN KEY (project_id) REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Status history: one row per transition. The application only ever INSERTs here (no edit or delete endpoint).
CREATE TABLE IF NOT EXISTS cp_status_history (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  application_id VARCHAR(40) NOT NULL,
  from_status VARCHAR(32) NULL,
  to_status VARCHAR(32) NOT NULL,
  admin_id VARCHAR(190) NULL,
  admin_email VARCHAR(190) NULL,
  note TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  KEY idx_cp_status_history_application (application_id, created_at),
  CONSTRAINT fk_cp_status_history_application FOREIGN KEY (application_id) REFERENCES cp_applications (id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- E-mail notifications and their outcome (retryable from the admin panel)
CREATE TABLE IF NOT EXISTS cp_notifications (
  id VARCHAR(40) NOT NULL PRIMARY KEY,
  application_id VARCHAR(40) NOT NULL,
  event VARCHAR(32) NOT NULL,
  channel VARCHAR(16) NOT NULL,
  recipient VARCHAR(190) NULL,
  status VARCHAR(20) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  message TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  sent_at DATETIME(3) NULL,
  KEY idx_cp_notifications_application (application_id, created_at),
  KEY idx_cp_notifications_status (status),
  CONSTRAINT fk_cp_notifications_application FOREIGN KEY (application_id) REFERENCES cp_applications (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_cp_notifications_status CHECK (status IN ('PENDING','SENT','FAILED','NOT_CONFIGURED','NO_RECIPIENT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sequences for application references and CP IDs (atomic increment, never reused)
INSERT IGNORE INTO counters (name, value) VALUES ('cp_application_seq', 0);
INSERT IGNORE INTO counters (name, value) VALUES ('cp_partner_seq', 0);
