// Storage interface used by the whole server. Two implementations:
//   - MySqlStore (src/server/mysqlStore.ts): the live database (Hostinger MySQL/MariaDB), required in production
//   - JsonStore  (src/server/jsonStore.ts): local development only (data/db.json)
import {
  Project, Registration, PaymentRecord, WebhookEvent, AuditLog, AdminUser,
  CpApplication, CpDocument, CpDocumentMeta, CpPartner, CpStatusHistoryEntry, CpNotification
} from '../types.js';

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
  /** Audit entries about one record, newest first */
  listAuditLogsForEntity(entityType: string, entityId: string, limit?: number): Promise<AuditLog[]>;

  // Admin users
  getAdminByEmail(email: string): Promise<AdminRecord | null>;

  // Channel Partner (CP) / Broker onboarding
  /** Next application reference (CP-GRG-YYYYMMDD-NNNN-XXXX): atomic sequence, never reused, plus a random part */
  generateCpApplicationRef(): Promise<string>;
  /** Next official CP ID (GRG-CP-NNNN); call inside the approval transaction */
  generateCpPartnerId(): Promise<string>;
  /** Inserts a new application with its project interests and documents (DuplicateRecordError on a clash) */
  createCpApplication(application: CpApplication, documents: CpDocument[]): Promise<void>;
  /** Updates the application's own fields (status, review fields). Project interests and documents are not changed. */
  updateCpApplication(application: CpApplication): Promise<void>;
  getCpApplication(id: string): Promise<CpApplication | null>;
  /** Same as getCpApplication, but locks the row until the surrounding transaction ends (MySQL) */
  getCpApplicationForUpdate(id: string): Promise<CpApplication | null>;
  getCpApplicationBySubmissionId(clientSubmissionId: string): Promise<CpApplication | null>;
  /** By public application reference (exact, case-insensitive; new and older formats) */
  getCpApplicationByRef(applicationRef: string): Promise<CpApplication | null>;
  /** An application that still holds this mobile number or e-mail (any status except REJECTED) */
  findActiveCpApplication(mobile: string, email?: string): Promise<CpApplication | null>;
  listCpApplications(filter: CpApplicationFilter): Promise<{ items: CpApplication[]; total: number }>;
  countCpApplicationsByStatus(): Promise<Record<string, number>>;
  listCpDocuments(applicationId: string): Promise<CpDocumentMeta[]>;
  getCpDocument(applicationId: string, documentId: string): Promise<CpDocument | null>;
  addCpStatusHistory(entry: CpStatusHistoryEntry): Promise<void>;
  listCpStatusHistory(applicationId: string): Promise<CpStatusHistoryEntry[]>;
  /** Insert or update a partner record (DuplicateRecordError if the CP ID or application already has one) */
  saveCpPartner(partner: CpPartner): Promise<void>;
  getCpPartnerByApplication(applicationId: string): Promise<CpPartner | null>;
  saveCpNotification(notification: CpNotification): Promise<void>;
  getCpNotification(id: string): Promise<CpNotification | null>;
  listCpNotifications(applicationId: string): Promise<CpNotification[]>;
}

export interface CpApplicationFilter {
  /** Name, application reference, mobile number, company or CP ID */
  search?: string;
  status?: string;
  projectId?: string;
  /** Inclusive ISO timestamps */
  createdFrom?: string;
  createdTo?: string;
  sort?: 'created_at' | 'full_name' | 'status' | 'city';
  direction?: 'asc' | 'desc';
  /** 1-based; omit page/pageSize to get every match (CSV export) */
  page?: number;
  pageSize?: number;
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
