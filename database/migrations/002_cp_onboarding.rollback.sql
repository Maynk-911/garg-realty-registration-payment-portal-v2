-- ROLLBACK for migration 2 (Channel Partner onboarding). NEVER run automatically.
-- WARNING: this permanently deletes every CP application, partner record, uploaded document and history entry.
-- Before running it: export a backup (phpMyAdmin > Export) and deploy a version of the app without the CP module
-- (otherwise the server re-creates these tables on its next start).
-- It does not touch bookings, payments, projects, admin users or audit_logs.

DROP TABLE IF EXISTS cp_notifications;
DROP TABLE IF EXISTS cp_status_history;
DROP TABLE IF EXISTS cp_partner_projects;
DROP TABLE IF EXISTS cp_partners;
DROP TABLE IF EXISTS cp_documents;
DROP TABLE IF EXISTS cp_application_projects;
DROP TABLE IF EXISTS cp_applications;
DELETE FROM counters WHERE name IN ('cp_application_seq', 'cp_partner_seq');
DELETE FROM schema_migrations WHERE version = 2;
