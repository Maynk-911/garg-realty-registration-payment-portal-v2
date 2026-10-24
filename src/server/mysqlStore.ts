// Live store: Hostinger MySQL / MariaDB via mysql2 (connection pool, parameterized queries, transactions).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  Project, Registration, PaymentRecord, WebhookEvent, AuditLog, OwnershipPlan,
  CpApplication, CpDocument, CpDocumentMeta, CpPartner, CpStatusHistoryEntry, CpNotification
} from '../types.js';
import { PANGOT_ID, PUBLIC_PROJECT_IDS } from '../bookingOptions.js';
import { APP_ROOT } from './loadEnv.js';
import { Store, AdminRecord, RegistrationFilter, CpApplicationFilter, DuplicateRecordError, DatabaseUnavailableError } from './store.js';
import { SEED_PROJECTS, withPangotFixedConfig, configuredAdmin } from './seed.js';

/** Schema migrations after the base schema (database/schema.sql = version 1). Add new ones at the end. */
const MIGRATIONS = [
  { version: 2, file: 'migrations/002_cp_onboarding.sql' }
] as const;
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export interface MySqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionLimit: number;
  ssl: boolean;
}

/** Reads DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD (+ optional DB_POOL_SIZE, DB_SSL). Null when DB_HOST is not set. */
export function mysqlConfigFromEnv(): MySqlConfig | null {
  const host = process.env.DB_HOST?.trim();
  if (!host) return null;
  const missing = ['DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Database configuration incomplete: set ${missing.join(', ')} (DB_HOST is set)`);
  const port = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(port) || port <= 0) throw new Error('DB_PORT must be a port number');
  return {
    host,
    port,
    database: process.env.DB_NAME!.trim(),
    user: process.env.DB_USER!.trim(),
    password: process.env.DB_PASSWORD!,
    connectionLimit: Math.max(1, Math.min(20, Number(process.env.DB_POOL_SIZE || 5) || 5)),
    ssl: process.env.DB_SSL === 'true'
  };
}

// ---------- value conversions (UTC DATETIME(3) <-> ISO strings, TEXT JSON <-> values) ----------
const toDbTime = (iso?: string | null) => (iso ? new Date(iso).toISOString().replace('T', ' ').replace('Z', '') : null);
const fromDbTime = (v: unknown): string | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  return v instanceof Date ? v.toISOString() : new Date(`${String(v).replace(' ', 'T')}Z`).toISOString();
};
const toJson = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const fromJson = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const bool = (v: unknown) => v === 1 || v === true || v === '1';
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);

const CONNECTION_ERRORS = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'EAI_AGAIN', 'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'POOL_CLOSED', 'ER_CON_COUNT_ERROR', 'ER_USER_LIMIT_REACHED'
]);

/** Translate driver errors; messages never contain the password */
function mapError(err: any): Error {
  if (err instanceof DuplicateRecordError || err instanceof DatabaseUnavailableError) return err;
  if (err?.code === 'ER_DUP_ENTRY') {
    const key = /for key '(?:[^'.]*\.)?([^']+)'/.exec(String(err.message))?.[1];
    return new DuplicateRecordError('Duplicate record', key);
  }
  if (CONNECTION_ERRORS.has(err?.code) || err?.fatal) {
    return new DatabaseUnavailableError(`Database unavailable (${err?.code || 'connection error'})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

// ---------- column mappings ----------
const REG_COLUMNS = [
  'id', 'registration_number', 'project_id', 'project_name', 'full_name', 'mobile', 'whatsapp', 'email', 'date_of_birth', 'gender',
  'country', 'state', 'city', 'pincode', 'address', 'co_applicant_name', 'co_applicant_mobile', 'co_applicant_email', 'co_applicant_address',
  'company_name', 'profession', 'requirement', 'selected_plan', 'units_count', 'unit_number', 'unit_size', 'floor_no',
  'total_price', 'roi_percentage', 'token_amount', 'tax_amount', 'total_payable', 'total_payment_received', 'mode_of_payment',
  'payment_status', 'registration_status', 'utr_number', 'upi_app', 'sender_upi',
  'payment_submitted_at', 'sheet_synced_at', 'payment_verified_at', 'payment_verified_by', 'payment_rejected_at', 'payment_rejected_by',
  'documents_submitted', 'notes', 'consent', 'consent_timestamp', 'declaration_signed', 'signature_name', 'privacy_policy_version', 'terms_version',
  'ip_address', 'user_agent', 'source', 'campaign', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid',
  'created_at', 'updated_at'
] as const;
const REG_TIME_COLUMNS = new Set(['payment_submitted_at', 'sheet_synced_at', 'payment_verified_at', 'payment_rejected_at', 'consent_timestamp', 'created_at', 'updated_at']);
const REG_NUMBER_COLUMNS = new Set(['units_count', 'total_price', 'roi_percentage', 'token_amount', 'tax_amount', 'total_payable', 'total_payment_received']);

function registrationToRow(reg: Registration): unknown[] {
  return REG_COLUMNS.map(col => {
    const v = (reg as any)[col];
    if (REG_TIME_COLUMNS.has(col)) return toDbTime(v);
    if (col === 'documents_submitted') return toJson(v ?? { id_proof: false, address_proof: false, photo: false });
    if (col === 'consent' || col === 'declaration_signed') return v ? 1 : 0;
    if (REG_NUMBER_COLUMNS.has(col)) return v === undefined || v === null ? 0 : Number(v);
    return v === undefined ? null : v;
  });
}

function rowToRegistration(row: RowDataPacket): Registration {
  const reg: any = {};
  for (const col of REG_COLUMNS) {
    const v = row[col];
    if (REG_TIME_COLUMNS.has(col)) { const t = fromDbTime(v); if (t !== undefined) reg[col] = t; }
    else if (col === 'documents_submitted') reg[col] = fromJson(v, { id_proof: false, address_proof: false, photo: false });
    else if (col === 'consent' || col === 'declaration_signed') reg[col] = bool(v);
    else if (REG_NUMBER_COLUMNS.has(col)) reg[col] = num(v);
    else if (v !== null && v !== undefined) reg[col] = v;
  }
  return reg as Registration;
}

const PAY_COLUMNS = [
  'id', 'registration_id', 'registration_number', 'gateway', 'gateway_order_id', 'gateway_payment_id', 'utr_number', 'amount', 'currency',
  'payment_status', 'payment_method', 'signature_verified', 'webhook_verified', 'attempt_number', 'error_code', 'error_description',
  'created_at', 'updated_at', 'verified_at'
] as const;

function rowToPayment(row: RowDataPacket): PaymentRecord {
  return {
    id: row.id, registration_id: row.registration_id, registration_number: row.registration_number, gateway: row.gateway,
    gateway_order_id: row.gateway_order_id, gateway_payment_id: opt(row.gateway_payment_id), utr_number: opt(row.utr_number),
    amount: num(row.amount), currency: row.currency, payment_status: row.payment_status, payment_method: opt(row.payment_method),
    signature_verified: bool(row.signature_verified), webhook_verified: bool(row.webhook_verified), attempt_number: num(row.attempt_number),
    error_code: opt(row.error_code), error_description: opt(row.error_description),
    created_at: fromDbTime(row.created_at)!, updated_at: fromDbTime(row.updated_at)!, verified_at: fromDbTime(row.verified_at)
  };
}

function rowToProject(row: RowDataPacket, plans: RowDataPacket[]): Project {
  return {
    id: row.id, code: row.code, name: row.name, short_name: row.short_name, display_name: row.display_name,
    tagline: row.tagline || '', description: row.description || '', location: row.location || '', currency: row.currency,
    token_amount: num(row.token_amount), total_price: num(row.total_price), tax_percentage: num(row.tax_percentage), roi_percentage: num(row.roi_percentage),
    active: bool(row.active), booking_enabled: bool(row.booking_enabled), payee_name: row.payee_name || '', refund_policy: row.refund_policy || '',
    payment_qr_data: opt(row.payment_qr_data), payment_qr_updated_at: fromDbTime(row.payment_qr_updated_at),
    unit_types: fromJson(row.unit_types, []), sample_units: fromJson(row.sample_units, []), features: fromJson(row.features, []),
    ownership_plans: plans.map(p => {
      const plan: OwnershipPlan = {
        id: p.id, name: p.label, label: p.label, total_price: num(p.total_price), token_amount: num(p.token_amount), active: bool(p.active)
      };
      if (p.plan_type) plan.type = p.plan_type;
      if (p.size) plan.size = p.size;
      if (p.inventory !== null && p.inventory !== undefined) plan.inventory = num(p.inventory);
      return plan;
    }),
    admin_configured_at: fromDbTime(row.admin_configured_at), details_verified_at: fromDbTime(row.details_verified_at),
    details_verified_by: opt(row.details_verified_by),
    created_at: fromDbTime(row.created_at)!, updated_at: fromDbTime(row.updated_at)!
  };
}

export class MySqlStore implements Store {
  readonly kind = 'mysql' as const;
  private pool: Pool | null;
  private readonly conn: PoolConnection | null;

  constructor(private readonly config: MySqlConfig, pool: Pool | null = null, conn: PoolConnection | null = null) {
    this.pool = pool;
    this.conn = conn;
  }

  /** Runs one parameterized statement on the transaction connection (if any) or the pool */
  private async q<T = RowDataPacket[]>(sql: string, params: unknown[] = []): Promise<T> {
    const executor = this.conn || this.pool;
    if (!executor) throw new DatabaseUnavailableError('Database not initialised');
    try {
      const [result] = await executor.query(sql, params);
      return result as T;
    } catch (err) {
      throw mapError(err);
    }
  }

  /**
   * Update the row with this primary key, or insert it. It never touches a different row: a clash on any other
   * unique key (Booking ID, active UTR, admin e-mail, plot name, ...) raises DuplicateRecordError instead.
   * (INSERT ... ON DUPLICATE KEY UPDATE is deliberately not used: it would overwrite whichever row clashed.)
   */
  private async saveById(table: string, columns: readonly string[], values: unknown[]) {
    const id = values[columns.indexOf('id')];
    const existing = await this.q(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1${this.conn ? ' FOR UPDATE' : ''}`, [id]);
    if (existing.length) {
      const updatable = columns.map((c, i) => [c, values[i]] as const).filter(([c]) => c !== 'id' && c !== 'created_at');
      await this.q(`UPDATE ${table} SET ${updatable.map(([c]) => `${c} = ?`).join(', ')} WHERE id = ?`, [...updatable.map(([, v]) => v), id]);
    } else {
      await this.q(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
    }
  }

  async init() {
    if (this.pool) { // already initialised: just re-check the connection, schema and seed
      await this.q('SELECT 1');
      await this.migrate();
      await this.seed();
      return;
    }
    this.pool = mysql.createPool({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: true } : undefined,
      connectionLimit: this.config.connectionLimit,
      maxIdle: this.config.connectionLimit,
      idleTimeout: 60_000,
      waitForConnections: true,
      queueLimit: 0,
      connectTimeout: 10_000,
      enableKeepAlive: true,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
      decimalNumbers: true,
      multipleStatements: false
    });
    await this.q('SELECT 1');
    await this.migrate();
    await this.seed();
  }

  async close() {
    if (this.pool && !this.conn) await this.pool.end();
  }

  private async runSqlFile(relativePath: string) {
    const sql = fs.readFileSync(path.join(APP_ROOT, 'database', relativePath), 'utf-8');
    const statements = sql
      .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
      .split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
    for (const statement of statements) await this.q(statement);
  }

  /**
   * Version 1 (the booking schema) is idempotent and checked on every start. Later versions are applied once, in
   * order, and recorded in schema_migrations. They only add tables, and every statement is idempotent, so a start
   * interrupted half-way simply re-applies the migration next time.
   */
  private async migrate() {
    await this.runSqlFile('schema.sql');
    await this.q('INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?)', [toDbTime(new Date().toISOString())]);
    const applied = new Set((await this.q('SELECT version FROM schema_migrations')).map(r => Number(r.version)));
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await this.runSqlFile(migration.file);
      await this.q('INSERT IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)', [migration.version, toDbTime(new Date().toISOString())]);
      console.log(`[Database] Applied migration ${migration.version} (${migration.file})`);
    }
  }

  /** Only verified configuration: the two projects and the admin from the environment. Never bookings or payments. */
  private async seed() {
    await this.q("INSERT IGNORE INTO counters (name, value) VALUES ('registration_seq', 100)");
    for (const seedProject of SEED_PROJECTS) {
      const existing = await this.getProject(seedProject.id);
      if (!existing) await this.saveProject(seedProject);
      else if (existing.id === PANGOT_ID) await this.saveProject(withPangotFixedConfig(existing));
    }
    const admin = configuredAdmin();
    if (admin) {
      const now = toDbTime(new Date().toISOString());
      await this.saveById('admin_users', ['id', 'email', 'name', 'role', 'password_hash', 'created_at', 'updated_at'],
        [admin.id, admin.email, admin.name, admin.role, admin.passwordHash, now, now]);
    }
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.conn) return fn(this); // already inside a transaction
    if (!this.pool) throw new DatabaseUnavailableError('Database not initialised');
    let conn: PoolConnection;
    try {
      conn = await this.pool.getConnection();
    } catch (err) {
      throw mapError(err);
    }
    try {
      await conn.beginTransaction();
      const result = await fn(new MySqlStore(this.config, this.pool, conn));
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch { /* connection may be gone; the server rolls back automatically */ }
      throw mapError(err);
    } finally {
      conn.release();
    }
  }

  // ---------- registrations ----------
  async generateRegistrationNumber(projectCode: string = 'PNG') {
    // Atomic increment: LAST_INSERT_ID(expr) returns the new value on this statement's result
    const result = await this.q<ResultSetHeader>("UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = 'registration_seq'");
    if (!result.affectedRows) throw new Error('Booking ID counter missing');
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
    return `GRG-${projectCode}-${date}-${String(result.insertId).padStart(4, '0')}`;
  }

  async getRegistration(id: string) {
    const rows = await this.q('SELECT * FROM registrations WHERE id = ?', [id]);
    return rows[0] ? rowToRegistration(rows[0]) : null;
  }

  async getRegistrationForUpdate(id: string) {
    const rows = await this.q(`SELECT * FROM registrations WHERE id = ?${this.conn ? ' FOR UPDATE' : ''}`, [id]);
    return rows[0] ? rowToRegistration(rows[0]) : null;
  }

  async getRegistrationByNumber(registrationNumber: string) {
    const rows = await this.q('SELECT * FROM registrations WHERE registration_number = ?', [registrationNumber]);
    return rows[0] ? rowToRegistration(rows[0]) : null;
  }

  async findRegistrationByEmailOrPhone(email: string, mobile: string, projectId: string) {
    const rows = await this.q(
      `SELECT * FROM registrations WHERE project_id = ? AND (email = ? OR mobile = ?) AND payment_status IN ('INITIATED', 'PENDING')
       ORDER BY created_at ASC LIMIT 1`,
      [projectId, email, mobile]
    );
    return rows[0] ? rowToRegistration(rows[0]) : null;
  }

  async listRegistrations(filter?: RegistrationFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.search) {
      const like = `%${likeEscape(filter.search.trim())}%`;
      where.push('(registration_number LIKE ? OR full_name LIKE ? OR email LIKE ? OR mobile LIKE ? OR unit_number LIKE ?)');
      params.push(like, like, like, like, like);
    }
    if (filter?.projectId && filter.projectId !== 'all') { where.push('project_id = ?'); params.push(filter.projectId); }
    if (filter?.paymentStatus && filter.paymentStatus !== 'all') {
      const statuses = filter.paymentStatus.split(',').map(s => s.trim()).filter(Boolean);
      where.push(`payment_status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    if (filter?.registrationStatus && filter.registrationStatus !== 'all') { where.push('registration_status = ?'); params.push(filter.registrationStatus); }
    if (filter?.startDate && !Number.isNaN(Date.parse(filter.startDate))) { where.push('created_at >= ?'); params.push(toDbTime(new Date(filter.startDate).toISOString())); }
    if (filter?.endDate && !Number.isNaN(Date.parse(filter.endDate))) { where.push('created_at <= ?'); params.push(toDbTime(new Date(filter.endDate).toISOString())); }
    const rows = await this.q(`SELECT * FROM registrations${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`, params);
    return rows.map(rowToRegistration);
  }

  async findActiveRegistrationByUtr(utr: string, excludeId?: string) {
    // Uses the unique index on active_utr (collation is case-insensitive)
    const rows = await this.q('SELECT * FROM registrations WHERE active_utr = ? AND id <> ? LIMIT 1', [utr, excludeId || '']);
    return rows[0] ? rowToRegistration(rows[0]) : null;
  }

  async saveRegistration(reg: Registration) {
    await this.saveById('registrations', REG_COLUMNS, registrationToRow(reg));
    return reg;
  }

  async markSheetSynced(id: string, at: string) {
    await this.q('UPDATE registrations SET sheet_synced_at = ? WHERE id = ?', [toDbTime(at), id]);
  }

  // ---------- payments ----------
  async getPayment(id: string) {
    const rows = await this.q('SELECT * FROM payments WHERE id = ?', [id]);
    return rows[0] ? rowToPayment(rows[0]) : null;
  }

  async getPaymentByOrderId(orderId: string) {
    const rows = await this.q('SELECT * FROM payments WHERE gateway_order_id = ? ORDER BY created_at DESC LIMIT 1', [orderId]);
    return rows[0] ? rowToPayment(rows[0]) : null;
  }

  async getPaymentsForRegistration(registrationId: string) {
    const rows = await this.q('SELECT * FROM payments WHERE registration_id = ? ORDER BY attempt_number ASC', [registrationId]);
    return rows.map(rowToPayment);
  }

  async savePayment(p: PaymentRecord) {
    const values = [
      p.id, p.registration_id, p.registration_number, p.gateway, p.gateway_order_id, p.gateway_payment_id ?? null, p.utr_number ?? null,
      Number(p.amount), p.currency || 'INR', p.payment_status, p.payment_method ?? null, p.signature_verified ? 1 : 0, p.webhook_verified ? 1 : 0,
      p.attempt_number, p.error_code ?? null, p.error_description ?? null, toDbTime(p.created_at), toDbTime(p.updated_at), toDbTime(p.verified_at)
    ];
    // project_id is taken from the booking, so a payment can never be attached to another project
    const booking = await this.q('SELECT project_id FROM registrations WHERE id = ?', [p.registration_id]);
    if (!booking[0]) throw new Error(`Payment ${p.id} refers to an unknown booking`);
    await this.saveById('payments', [...PAY_COLUMNS, 'project_id'], [...values, booking[0].project_id]);
    return p;
  }

  // ---------- projects ----------
  private async plansFor(projectIds: string[]) {
    if (!projectIds.length) return [] as RowDataPacket[];
    return this.q(`SELECT * FROM project_plans WHERE project_id IN (${projectIds.map(() => '?').join(', ')}) ORDER BY sort_order ASC`, projectIds);
  }

  async getProject(id: string) {
    const rows = await this.q('SELECT * FROM projects WHERE id = ?', [id]);
    if (!rows[0]) return null;
    return rowToProject(rows[0], await this.plansFor([id]));
  }

  async listProjects(onlyActive: boolean = true) {
    const ids = [...PUBLIC_PROJECT_IDS];
    const rows = await this.q(`SELECT * FROM projects WHERE id IN (${ids.map(() => '?').join(', ')})${onlyActive ? ' AND active = 1' : ''}`, ids);
    const plans = await this.plansFor(rows.map(r => r.id));
    const projects = rows.map(r => rowToProject(r, plans.filter(p => p.project_id === r.id)));
    // Keep the portal's fixed order: Pangot, then Dholera
    return ids.map(id => projects.find(p => p.id === id)).filter((p): p is Project => Boolean(p));
  }

  async saveProject(project: Project) {
    // Project row and its plans change together
    await this.transaction(async tx => {
      const self = tx as MySqlStore;
      await self.saveById('projects', [
        'id', 'code', 'name', 'short_name', 'display_name', 'tagline', 'description', 'location', 'currency', 'token_amount', 'total_price',
        'tax_percentage', 'roi_percentage', 'active', 'booking_enabled', 'payee_name', 'refund_policy', 'payment_qr_data', 'payment_qr_updated_at',
        'unit_types', 'sample_units', 'features', 'admin_configured_at', 'details_verified_at', 'details_verified_by', 'created_at', 'updated_at'
      ], [
        project.id, project.code || project.id.slice(5, 8).toUpperCase(), project.name, project.short_name || project.name,
        project.display_name || project.name, project.tagline ?? null, project.description ?? null, project.location ?? null,
        project.currency || 'INR', Number(project.token_amount || 0), Number(project.total_price || 0), Number(project.tax_percentage || 0),
        Number(project.roi_percentage || 0), project.active === false ? 0 : 1, project.booking_enabled ? 1 : 0,
        project.payee_name ?? null, project.refund_policy ?? null, project.payment_qr_data ?? null, toDbTime(project.payment_qr_updated_at),
        toJson(project.unit_types || []), toJson(project.sample_units || []), toJson(project.features || []),
        toDbTime(project.admin_configured_at), toDbTime(project.details_verified_at), project.details_verified_by ?? null,
        toDbTime(project.created_at || new Date().toISOString()), toDbTime(project.updated_at || new Date().toISOString())
      ]);
      const plans = project.ownership_plans || [];
      const keepIds = plans.map(p => p.id);
      await self.q(
        `DELETE FROM project_plans WHERE project_id = ?${keepIds.length ? ` AND id NOT IN (${keepIds.map(() => '?').join(', ')})` : ''}`,
        [project.id, ...keepIds]
      );
      for (const [i, plan] of plans.entries()) {
        await self.saveById('project_plans', ['id', 'project_id', 'label', 'plan_type', 'size', 'total_price', 'token_amount', 'inventory', 'active', 'sort_order'], [
          plan.id, project.id, plan.label, plan.type ?? null, plan.size ?? null, Number(plan.total_price || 0), Number(plan.token_amount || 0),
          typeof plan.inventory === 'number' ? plan.inventory : null, plan.active === false ? 0 : 1, i
        ]);
      }
    });
    return project;
  }

  // ---------- webhooks ----------
  async getWebhookEvent(eventId: string) {
    const rows = await this.q('SELECT * FROM webhook_events WHERE id = ? OR event_id = ? LIMIT 1', [eventId, eventId]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id, event_id: r.event_id, event_type: r.event_type, gateway: r.gateway, payload: fromJson(r.payload, {}),
      signature_verified: bool(r.signature_verified), processed: bool(r.processed), processed_at: fromDbTime(r.processed_at),
      created_at: fromDbTime(r.created_at)!, error: opt(r.error)
    } as WebhookEvent;
  }

  async saveWebhookEvent(e: WebhookEvent) {
    await this.saveById('webhook_events', ['id', 'event_id', 'event_type', 'gateway', 'payload', 'signature_verified', 'processed', 'processed_at', 'error', 'created_at'], [
      e.id, e.event_id, e.event_type, e.gateway, toJson(e.payload), e.signature_verified ? 1 : 0, e.processed ? 1 : 0,
      toDbTime(e.processed_at), e.error ?? null, toDbTime(e.created_at)
    ]);
    return e;
  }

  async listWebhookEvents(limit: number = 20) {
    const rows = await this.q('SELECT id FROM webhook_events ORDER BY created_at DESC LIMIT ?', [Math.max(1, Math.min(500, limit))]);
    const events: WebhookEvent[] = [];
    for (const r of rows) { const e = await this.getWebhookEvent(r.id); if (e) events.push(e); }
    return events;
  }

  // ---------- audit ----------
  async logAudit(log: Omit<AuditLog, 'id' | 'timestamp'>) {
    const entry: AuditLog = { ...log, id: `audit_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, timestamp: new Date().toISOString() };
    await this.q(
      'INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, old_value, new_value, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [entry.id, String(entry.admin_id ?? '').slice(0, 190), entry.action, entry.entity_type, String(entry.entity_id ?? '').slice(0, 120),
        toJson(entry.old_value), toJson(entry.new_value), entry.ip_address ?? null, toDbTime(entry.timestamp)]
    );
    return entry;
  }

  async listAuditLogs(limit: number = 50) {
    const rows = await this.q('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [Math.max(1, Math.min(1000, limit))]);
    return rows.map(rowToAuditLog);
  }

  async listAuditLogsForEntity(entityType: string, entityId: string, limit: number = 100) {
    const rows = await this.q('SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT ?',
      [entityType, entityId, Math.max(1, Math.min(1000, limit))]);
    return rows.map(rowToAuditLog);
  }

  // ---------- admins ----------
  async getAdminByEmail(email: string) {
    const rows = await this.q('SELECT * FROM admin_users WHERE email = ? LIMIT 1', [email]);
    const r = rows[0];
    return r ? ({ id: r.id, email: r.email, name: r.name, role: r.role, passwordHash: r.password_hash } as AdminRecord) : null;
  }

  // ---------- Channel Partner onboarding ----------
  private async nextCounter(name: string) {
    const result = await this.q<ResultSetHeader>('UPDATE counters SET value = LAST_INSERT_ID(value + 1) WHERE name = ?', [name]);
    if (!result.affectedRows) throw new Error(`Counter ${name} missing`);
    return result.insertId;
  }

  async generateCpApplicationRef() {
    const seq = await this.nextCounter('cp_application_seq');
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
    return `CP-GRG-${date}-${String(seq).padStart(4, '0')}`;
  }

  async generateCpPartnerId() {
    return `GRG-CP-${String(await this.nextCounter('cp_partner_seq')).padStart(4, '0')}`;
  }

  private async cpProjectIds(applicationIds: string[]) {
    if (!applicationIds.length) return new Map<string, string[]>();
    const rows = await this.q(
      `SELECT application_id, project_id FROM cp_application_projects WHERE application_id IN (${applicationIds.map(() => '?').join(', ')}) ORDER BY project_id`,
      applicationIds
    );
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.application_id, [...(map.get(r.application_id) || []), r.project_id]);
    return map;
  }

  private async cpApplicationsFromRows(rows: RowDataPacket[]) {
    const projects = await this.cpProjectIds(rows.map(r => r.id));
    return rows.map(r => rowToCpApplication(r, projects.get(r.id) || []));
  }

  async createCpApplication(application: CpApplication, documents: CpDocument[]) {
    await this.transaction(async tx => {
      const self = tx as MySqlStore;
      await self.q(
        `INSERT INTO cp_applications (${CP_APP_COLUMNS.join(', ')}) VALUES (${CP_APP_COLUMNS.map(() => '?').join(', ')})`,
        cpApplicationToRow(application)
      );
      for (const projectId of application.project_ids) {
        await self.q('INSERT INTO cp_application_projects (application_id, project_id) VALUES (?, ?)', [application.id, projectId]);
      }
      for (const d of documents) {
        await self.q(
          'INSERT INTO cp_documents (id, application_id, doc_type, original_name, mime_type, size_bytes, sha256, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [d.id, application.id, d.doc_type, d.original_name, d.mime_type, d.size_bytes, d.sha256, d.content, toDbTime(d.created_at)]
        );
      }
    });
  }

  async updateCpApplication(a: CpApplication) {
    await this.q(
      `UPDATE cp_applications SET status = ?, info_request_message = ?, decision_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ?`,
      [a.status, a.info_request_message ?? null, a.decision_reason ?? null, a.reviewed_by ?? null, toDbTime(a.reviewed_at), toDbTime(a.updated_at), a.id]
    );
  }

  async getCpApplication(id: string) {
    return (await this.cpApplicationsFromRows(await this.q('SELECT * FROM cp_applications WHERE id = ?', [id])))[0] || null;
  }

  async getCpApplicationForUpdate(id: string) {
    const rows = await this.q(`SELECT * FROM cp_applications WHERE id = ?${this.conn ? ' FOR UPDATE' : ''}`, [id]);
    return (await this.cpApplicationsFromRows(rows))[0] || null;
  }

  async getCpApplicationBySubmissionId(clientSubmissionId: string) {
    const rows = await this.q('SELECT * FROM cp_applications WHERE client_submission_id = ? LIMIT 1', [clientSubmissionId]);
    return (await this.cpApplicationsFromRows(rows))[0] || null;
  }

  async findActiveCpApplication(mobile: string, email?: string) {
    const rows = email
      ? await this.q('SELECT * FROM cp_applications WHERE active_mobile = ? OR active_email = ? LIMIT 1', [mobile, email])
      : await this.q('SELECT * FROM cp_applications WHERE active_mobile = ? LIMIT 1', [mobile]);
    return (await this.cpApplicationsFromRows(rows))[0] || null;
  }

  async listCpApplications(filter: CpApplicationFilter) {
    const where: string[] = [];
    const params: unknown[] = [];
    const search = filter.search?.trim();
    if (search) {
      const like = `%${likeEscape(search)}%`;
      const digits = search.replace(/\D/g, '');
      const clauses = ['a.application_ref LIKE ?', 'a.full_name LIKE ?', 'a.company_name LIKE ?', 'a.email LIKE ?',
        'EXISTS (SELECT 1 FROM cp_partners p WHERE p.application_id = a.id AND p.cp_id LIKE ?)'];
      params.push(like, like, like, like, like);
      // Mobile numbers are stored as +91XXXXXXXXXX: match on the last digits typed
      if (digits.length >= 4) { clauses.push('a.mobile LIKE ?'); params.push(`%${digits.slice(-10)}%`); }
      where.push(`(${clauses.join(' OR ')})`);
    }
    if (filter.status && filter.status !== 'all') { where.push('a.status = ?'); params.push(filter.status); }
    if (filter.projectId && filter.projectId !== 'all') {
      where.push('EXISTS (SELECT 1 FROM cp_application_projects ap WHERE ap.application_id = a.id AND ap.project_id = ?)');
      params.push(filter.projectId);
    }
    if (filter.createdFrom) { where.push('a.created_at >= ?'); params.push(toDbTime(filter.createdFrom)); }
    if (filter.createdTo) { where.push('a.created_at <= ?'); params.push(toDbTime(filter.createdTo)); }
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const sortColumn = { created_at: 'a.created_at', full_name: 'a.full_name', status: 'a.status', city: 'a.city' }[filter.sort || 'created_at'] || 'a.created_at';
    const direction = filter.direction === 'asc' ? 'ASC' : 'DESC';
    const [countRow] = await this.q(`SELECT COUNT(*) AS total FROM cp_applications a${whereSql}`, params);
    let sql = `SELECT a.* FROM cp_applications a${whereSql} ORDER BY ${sortColumn} ${direction}, a.id ${direction}`;
    const pageParams = [...params];
    if (filter.page && filter.pageSize) {
      sql += ' LIMIT ? OFFSET ?';
      pageParams.push(filter.pageSize, (filter.page - 1) * filter.pageSize);
    }
    return { items: await this.cpApplicationsFromRows(await this.q(sql, pageParams)), total: num(countRow?.total) };
  }

  async countCpApplicationsByStatus() {
    const rows = await this.q('SELECT status, COUNT(*) AS n FROM cp_applications GROUP BY status');
    return Object.fromEntries(rows.map(r => [r.status, num(r.n)]));
  }

  async listCpDocuments(applicationId: string) {
    const rows = await this.q(
      'SELECT id, application_id, doc_type, original_name, mime_type, size_bytes, sha256, created_at FROM cp_documents WHERE application_id = ? ORDER BY created_at, doc_type',
      [applicationId]
    );
    return rows.map(r => rowToCpDocumentMeta(r));
  }

  async getCpDocument(applicationId: string, documentId: string) {
    const rows = await this.q('SELECT * FROM cp_documents WHERE id = ? AND application_id = ?', [documentId, applicationId]);
    const r = rows[0];
    return r ? { ...rowToCpDocumentMeta(r), content: Buffer.from(r.content) } : null;
  }

  async addCpStatusHistory(e: CpStatusHistoryEntry) {
    await this.q(
      'INSERT INTO cp_status_history (id, application_id, from_status, to_status, admin_id, admin_email, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [e.id, e.application_id, e.from_status, e.to_status, e.admin_id, e.admin_email, e.note ?? null, toDbTime(e.created_at)]
    );
  }

  async listCpStatusHistory(applicationId: string) {
    const rows = await this.q('SELECT * FROM cp_status_history WHERE application_id = ? ORDER BY created_at ASC, id ASC', [applicationId]);
    return rows.map(r => ({
      id: r.id, application_id: r.application_id, from_status: r.from_status ?? null, to_status: r.to_status,
      admin_id: r.admin_id ?? null, admin_email: r.admin_email ?? null, note: opt(r.note), created_at: fromDbTime(r.created_at)!
    } as CpStatusHistoryEntry));
  }

  async saveCpPartner(p: CpPartner) {
    await this.transaction(async tx => {
      const self = tx as MySqlStore;
      await self.saveById('cp_partners', [
        'id', 'cp_id', 'application_id', 'application_ref', 'full_name', 'mobile', 'email', 'company_name', 'partner_type', 'status',
        'approved_at', 'approved_by', 'suspended_at', 'suspended_by', 'suspension_reason', 'created_at', 'updated_at'
      ], [
        p.id, p.cp_id, p.application_id, p.application_ref, p.full_name, p.mobile, p.email ?? null, p.company_name ?? null, p.partner_type, p.status,
        toDbTime(p.approved_at), p.approved_by, toDbTime(p.suspended_at), p.suspended_by ?? null, p.suspension_reason ?? null,
        toDbTime(p.created_at), toDbTime(p.updated_at)
      ]);
      const keep = p.approved_project_ids;
      await self.q(
        `DELETE FROM cp_partner_projects WHERE partner_id = ?${keep.length ? ` AND project_id NOT IN (${keep.map(() => '?').join(', ')})` : ''}`,
        [p.id, ...keep]
      );
      for (const projectId of keep) await self.q('INSERT IGNORE INTO cp_partner_projects (partner_id, project_id) VALUES (?, ?)', [p.id, projectId]);
    });
  }

  async getCpPartnerByApplication(applicationId: string) {
    const rows = await this.q('SELECT * FROM cp_partners WHERE application_id = ?', [applicationId]);
    const r = rows[0];
    if (!r) return null;
    const projects = await this.q('SELECT project_id FROM cp_partner_projects WHERE partner_id = ? ORDER BY project_id', [r.id]);
    return {
      id: r.id, cp_id: r.cp_id, application_id: r.application_id, application_ref: r.application_ref, full_name: r.full_name,
      mobile: r.mobile, email: opt(r.email), company_name: opt(r.company_name), partner_type: r.partner_type, status: r.status,
      approved_project_ids: projects.map(x => x.project_id), approved_at: fromDbTime(r.approved_at)!, approved_by: r.approved_by,
      suspended_at: fromDbTime(r.suspended_at), suspended_by: opt(r.suspended_by), suspension_reason: opt(r.suspension_reason),
      created_at: fromDbTime(r.created_at)!, updated_at: fromDbTime(r.updated_at)!
    } as CpPartner;
  }

  async saveCpNotification(n: CpNotification) {
    await this.saveById('cp_notifications', [
      'id', 'application_id', 'event', 'channel', 'recipient', 'status', 'attempts', 'last_error', 'message', 'created_at', 'updated_at', 'sent_at'
    ], [
      n.id, n.application_id, n.event, n.channel, n.recipient ?? null, n.status, n.attempts, n.last_error ? n.last_error.slice(0, 500) : null,
      n.message ?? null, toDbTime(n.created_at), toDbTime(n.updated_at), toDbTime(n.sent_at)
    ]);
  }

  async getCpNotification(id: string) {
    const rows = await this.q('SELECT * FROM cp_notifications WHERE id = ?', [id]);
    return rows[0] ? rowToCpNotification(rows[0]) : null;
  }

  async listCpNotifications(applicationId: string) {
    const rows = await this.q('SELECT * FROM cp_notifications WHERE application_id = ? ORDER BY created_at ASC, id ASC', [applicationId]);
    return rows.map(rowToCpNotification);
  }
}

const rowToAuditLog = (r: RowDataPacket): AuditLog => ({
  id: r.id, admin_id: r.admin_id, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id,
  old_value: fromJson(r.old_value, undefined), new_value: fromJson(r.new_value, undefined),
  ip_address: opt(r.ip_address), timestamp: fromDbTime(r.created_at)!
});

// ---------- CP row mappings ----------
const CP_APP_COLUMNS = [
  'id', 'application_ref', 'status', 'client_submission_id', 'full_name', 'mobile', 'whatsapp', 'email', 'date_of_birth',
  'partner_type', 'company_name', 'years_experience', 'sales_agents', 'existing_business', 'website', 'linkedin',
  'country', 'state', 'city', 'pincode', 'address', 'pan_number', 'gst_number', 'rera_number', 'rera_state', 'business_registration_number',
  'expected_monthly_leads', 'preferred_locations', 'previous_experience', 'heard_from', 'referral_code', 'comments',
  'declarations_accepted_at', 'declaration_version', 'ip_address', 'user_agent',
  'info_request_message', 'decision_reason', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at'
] as const;
const CP_APP_TIME_COLUMNS = new Set(['declarations_accepted_at', 'reviewed_at', 'created_at', 'updated_at']);
const CP_APP_NUMBER_COLUMNS = new Set(['years_experience', 'sales_agents', 'expected_monthly_leads']);

function cpApplicationToRow(a: CpApplication): unknown[] {
  return CP_APP_COLUMNS.map(col => {
    const v = (a as any)[col];
    if (CP_APP_TIME_COLUMNS.has(col)) return toDbTime(v);
    return v === undefined || v === '' ? null : v;
  });
}

function rowToCpApplication(row: RowDataPacket, projectIds: string[]): CpApplication {
  const a: any = { project_ids: projectIds };
  for (const col of CP_APP_COLUMNS) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    if (CP_APP_TIME_COLUMNS.has(col)) a[col] = fromDbTime(v);
    else if (CP_APP_NUMBER_COLUMNS.has(col)) a[col] = num(v);
    else a[col] = String(v);
  }
  return a as CpApplication;
}

const rowToCpDocumentMeta = (r: RowDataPacket): CpDocumentMeta => ({
  id: r.id, application_id: r.application_id, doc_type: r.doc_type, original_name: r.original_name, mime_type: r.mime_type,
  size_bytes: num(r.size_bytes), sha256: r.sha256, created_at: fromDbTime(r.created_at)!
});

const rowToCpNotification = (r: RowDataPacket): CpNotification => ({
  id: r.id, application_id: r.application_id, event: r.event, channel: r.channel, recipient: opt(r.recipient), status: r.status,
  attempts: num(r.attempts), last_error: opt(r.last_error), message: opt(r.message),
  created_at: fromDbTime(r.created_at)!, updated_at: fromDbTime(r.updated_at)!, sent_at: fromDbTime(r.sent_at)
});
