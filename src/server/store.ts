// Storage interface used by the whole server. Two implementations:
//   - MySqlStore (src/server/mysqlStore.ts): the live database (Hostinger MySQL/MariaDB), required in production
//   - JsonStore  (src/server/jsonStore.ts): local development only (data/db.json)
import { Project, Registration, PaymentRecord, WebhookEvent, AuditLog, AdminUser } from '../types.js';

export type AdminRecord = AdminUser & { passwordHash: string };

export interface RegistrationFilter {
  search?: string;
  projectId?: string;
  paymentStatus?: string;
  registrationStatus?: string;
  startDate?: string;
  endDate?: string;
}

export interface Store {
  readonly kind: 'mysql' | 'json';

  /** Connect, create/upgrade the schema and seed required records. Throws if the database is unusable. */
  init(): Promise<void>;
  close(): Promise<void>;

  /**
   * Run `fn` atomically: every write made through `tx` is committed together, or none is
   * (the error is rethrown so the caller can report the failure).
   */
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  // Registrations
  generateRegistrationNumber(projectCode?: string): Promise<string>;
  getRegistration(id: string): Promise<Registration | null>;
  /** Same as getRegistration, but locks the row until the surrounding transaction ends (MySQL) */
  getRegistrationForUpdate(id: string): Promise<Registration | null>;
  getRegistrationByNumber(registrationNumber: string): Promise<Registration | null>;
  findRegistrationByEmailOrPhone(email: string, mobile: string, projectId: string): Promise<Registration | null>;
  listRegistrations(filter?: RegistrationFilter): Promise<Registration[]>;
  /** A booking (other than excludeId) whose UTR is active, i.e. not rejected */
  findActiveRegistrationByUtr(utr: string, excludeId?: string): Promise<Registration | null>;
  saveRegistration(reg: Registration): Promise<Registration>;
  /** Sets only sheet_synced_at (never rewrites the rest of the booking, so it cannot undo a concurrent change) */
  markSheetSynced(id: string, at: string): Promise<void>;

  // Payments
  getPayment(id: string): Promise<PaymentRecord | null>;
  getPaymentByOrderId(orderId: string): Promise<PaymentRecord | null>;
  getPaymentsForRegistration(registrationId: string): Promise<PaymentRecord[]>;
  savePayment(payment: PaymentRecord): Promise<PaymentRecord>;

  // Projects
  getProject(id: string): Promise<Project | null>;
  listProjects(onlyActive?: boolean): Promise<Project[]>;
  saveProject(project: Project): Promise<Project>;

  // Payment gateway webhooks (idempotency)
  getWebhookEvent(eventId: string): Promise<WebhookEvent | null>;
  saveWebhookEvent(event: WebhookEvent): Promise<WebhookEvent>;
  listWebhookEvents(limit?: number): Promise<WebhookEvent[]>;

  // Audit trail
  logAudit(log: Omit<AuditLog, 'id' | 'timestamp'>): Promise<AuditLog>;
  listAuditLogs(limit?: number): Promise<AuditLog[]>;

  // Admin users
  getAdminByEmail(email: string): Promise<AdminRecord | null>;
}

/** Thrown when a write would break a uniqueness rule (e.g. the same UTR on two active bookings) */
export class DuplicateRecordError extends Error {
  constructor(message: string, public readonly constraint?: string) {
    super(message);
    this.name = 'DuplicateRecordError';
  }
}

/** Thrown when the database cannot be reached or a query fails for infrastructure reasons */
export class DatabaseUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}
