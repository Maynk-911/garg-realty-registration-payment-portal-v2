// Local-development store backed by data/db.json (the original storage). Not used in production.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Project, Registration, PaymentRecord, WebhookEvent, AuditLog } from '../types.js';
import { PANGOT_ID, DHOLERA_ID, PUBLIC_PROJECT_IDS } from '../bookingOptions.js';
import { APP_ROOT } from './loadEnv.js';
import { Store, AdminRecord, RegistrationFilter, DuplicateRecordError } from './store.js';
import { SEED_PROJECTS, DHOLERA_SEED, withPangotFixedConfig, configuredAdmin } from './seed.js';

interface DatabaseSchema {
  projects: Record<string, Project>;
  registrations: Record<string, Registration>;
  payments: Record<string, PaymentRecord>;
  webhook_events: Record<string, WebhookEvent>;
  audit_logs: Record<string, AuditLog>;
  admin_users: Record<string, AdminRecord>;
  counters: { registration_seq: number };
}

// DATA_DIR may be absolute or relative to the project root
const DATA_DIR = path.resolve(APP_ROOT, process.env.DATA_DIR || 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const clone = <T>(v: T): T => (v === null || v === undefined ? v : structuredClone(v));
const byNewest = (a: { created_at: string }, b: { created_at: string }) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();

export class JsonStore implements Store {
  readonly kind = 'json' as const;
  private data!: DatabaseSchema;
  private inTransaction = false;

  async init() {
    this.data = this.loadData();
    this.persist();
  }

  async close() {}

  private loadData(): DatabaseSchema {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const admin = configuredAdmin();
    if (fs.existsSync(DB_FILE)) {
      const parsed: DatabaseSchema = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (admin) parsed.admin_users = { ...parsed.admin_users, [admin.id]: admin };
      parsed.projects = parsed.projects || {};
      parsed.projects[PANGOT_ID] = withPangotFixedConfig(parsed.projects[PANGOT_ID] || SEED_PROJECTS[0]);
      // Dholera: until an admin has saved verified details, never keep sample prices/plots
      if (!parsed.projects[DHOLERA_ID]?.admin_configured_at) {
        parsed.projects[DHOLERA_ID] = { ...DHOLERA_SEED, created_at: parsed.projects[DHOLERA_ID]?.created_at || DHOLERA_SEED.created_at };
      }
      return parsed;
    }
    return {
      projects: Object.fromEntries(SEED_PROJECTS.map(p => [p.id, clone(p)])),
      registrations: {}, payments: {}, webhook_events: {}, audit_logs: {},
      admin_users: admin ? { [admin.id]: admin } : {},
      counters: { registration_seq: 100 }
    };
  }

  /** Atomic file write; throws on failure so callers never report an unsaved change as saved */
  private persist() {
    if (this.inTransaction) return; // written once when the transaction commits
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_FILE);
  }

  /** Apply a change in memory and persist it; if persisting fails, the in-memory change is undone */
  private mutate(change: () => void) {
    if (this.inTransaction) { change(); return; }
    const snapshot = structuredClone(this.data);
    try {
      change();
      this.persist();
    } catch (err) {
      this.data = snapshot;
      throw err;
    }
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    const snapshot = structuredClone(this.data);
    this.inTransaction = true;
    try {
      const result = await fn(this);
      this.inTransaction = false;
      this.persist();
      return result;
    } catch (err) {
      this.inTransaction = false;
      this.data = snapshot;
      throw err;
    }
  }

  // --- Registrations ---
  async generateRegistrationNumber(projectCode: string = 'PNG') {
    let seq = 0;
    this.mutate(() => { seq = ++this.data.counters.registration_seq; });
    // Sequence never repeats, so the Booking ID is unique. Date part is the booking date in India time.
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
    return `GRG-${projectCode}-${date}-${String(seq).padStart(4, '0')}`;
  }

  async getRegistration(id: string) { return clone(this.data.registrations[id] || null); }
  async getRegistrationForUpdate(id: string) { return this.getRegistration(id); }
  async getRegistrationByNumber(registrationNumber: string) {
    return clone(Object.values(this.data.registrations).find(r => r.registration_number === registrationNumber) || null);
  }
  async findRegistrationByEmailOrPhone(email: string, mobile: string, projectId: string) {
    return clone(Object.values(this.data.registrations).find(r =>
      r.project_id === projectId &&
      (r.email.toLowerCase() === email.toLowerCase() || r.mobile === mobile) &&
      (r.payment_status === 'INITIATED' || r.payment_status === 'PENDING')
    ) || null);
  }

  async listRegistrations(filter?: RegistrationFilter) {
    let list = Object.values(this.data.registrations);
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(r =>
        r.registration_number.toLowerCase().includes(q) || r.full_name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) || r.mobile.includes(q) || (r.unit_number && r.unit_number.toLowerCase().includes(q))
      );
    }
    if (filter?.projectId && filter.projectId !== 'all') list = list.filter(r => r.project_id === filter.projectId);
    if (filter?.paymentStatus && filter.paymentStatus !== 'all') {
      const statuses = filter.paymentStatus.split(',');
      list = list.filter(r => statuses.includes(r.payment_status));
    }
    if (filter?.registrationStatus && filter.registrationStatus !== 'all') list = list.filter(r => r.registration_status === filter.registrationStatus);
    if (filter?.startDate) list = list.filter(r => new Date(r.created_at) >= new Date(filter.startDate!));
    if (filter?.endDate) list = list.filter(r => new Date(r.created_at) <= new Date(filter.endDate!));
    return clone(list.sort(byNewest));
  }

  async findActiveRegistrationByUtr(utr: string, excludeId?: string) {
    return clone(Object.values(this.data.registrations).find(r =>
      r.id !== excludeId && r.utr_number?.toUpperCase() === utr.toUpperCase() && r.payment_status !== 'FAILED') || null);
  }

  async saveRegistration(reg: Registration) {
    // Same rule as the MySQL unique index: one active (not rejected) booking per UTR
    if (reg.utr_number && reg.payment_status !== 'FAILED') {
      const clash = Object.values(this.data.registrations).find(r =>
        r.id !== reg.id && r.utr_number?.toUpperCase() === reg.utr_number!.toUpperCase() && r.payment_status !== 'FAILED');
      if (clash) throw new DuplicateRecordError('This UTR is already recorded for another booking', 'uq_registrations_active_utr');
    }
    if (Object.values(this.data.registrations).some(r => r.id !== reg.id && r.registration_number === reg.registration_number)) {
      throw new DuplicateRecordError('Duplicate Booking ID', 'uq_registrations_number');
    }
    this.mutate(() => { this.data.registrations[reg.id] = clone(reg); });
    return reg;
  }

  async markSheetSynced(id: string, at: string) {
    this.mutate(() => {
      const reg = this.data.registrations[id];
      if (reg) reg.sheet_synced_at = at;
    });
  }

  // --- Payments ---
  async getPayment(id: string) { return clone(this.data.payments[id] || null); }
  async getPaymentByOrderId(orderId: string) {
    return clone(Object.values(this.data.payments).find(p => p.gateway_order_id === orderId) || null);
  }
  async getPaymentsForRegistration(registrationId: string) {
    return clone(Object.values(this.data.payments).filter(p => p.registration_id === registrationId).sort((a, b) => a.attempt_number - b.attempt_number));
  }
  async savePayment(payment: PaymentRecord) {
    if (Object.values(this.data.payments).some(p => p.id !== payment.id && p.registration_id === payment.registration_id && p.attempt_number === payment.attempt_number)) {
      throw new DuplicateRecordError('Duplicate payment attempt', 'uq_payments_registration_attempt');
    }
    this.mutate(() => { this.data.payments[payment.id] = clone(payment); });
    return payment;
  }

  // --- Projects ---
  async getProject(id: string) { return clone(this.data.projects[id] || null); }
  async listProjects(onlyActive: boolean = true) {
    // Only Pangot and Dholera are offered on the portal
    return clone(PUBLIC_PROJECT_IDS.map(id => this.data.projects[id]).filter((p): p is Project => Boolean(p) && (!onlyActive || p.active !== false)));
  }
  async saveProject(project: Project) {
    this.mutate(() => { this.data.projects[project.id] = clone(project); });
    return project;
  }

  // --- Webhooks ---
  async getWebhookEvent(eventId: string) {
    return clone(this.data.webhook_events[eventId] || Object.values(this.data.webhook_events).find(e => e.event_id === eventId) || null);
  }
  async saveWebhookEvent(event: WebhookEvent) {
    this.mutate(() => { this.data.webhook_events[event.id] = clone(event); });
    return event;
  }
  async listWebhookEvents(limit: number = 20) {
    return clone(Object.values(this.data.webhook_events).sort(byNewest).slice(0, limit));
  }

  // --- Audit ---
  async logAudit(log: Omit<AuditLog, 'id' | 'timestamp'>) {
    const entry: AuditLog = { ...log, id: `audit_${crypto.randomUUID().slice(0, 8)}`, timestamp: new Date().toISOString() };
    this.mutate(() => { this.data.audit_logs[entry.id] = entry; });
    return entry;
  }
  async listAuditLogs(limit: number = 50) {
    return clone(Object.values(this.data.audit_logs).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit));
  }

  // --- Admins ---
  async getAdminByEmail(email: string) {
    return clone(Object.values(this.data.admin_users).find(a => a.email.toLowerCase() === email.toLowerCase()) || null);
  }
}
