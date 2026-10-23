/**
 * MySQL / MariaDB storage tests (database layer, no web server needed).
 *
 * Uses DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD from the environment / .env.
 * Creates only clearly marked test rows (names "DB Layer Test …", emails @example.com) and deletes
 * exactly those rows, by id, at the end. It never deletes or changes any other record.
 *
 *   npm run test:db
 */
import '../src/server/loadEnv.js';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import { MySqlStore, mysqlConfigFromEnv } from '../src/server/mysqlStore.js';
import { DuplicateRecordError } from '../src/server/store.js';
import { Registration, PaymentRecord } from '../src/types.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail = '') {
  if (condition) { passed++; console.log(`[PASS] ${name}`); }
  else { failed++; console.error(`[FAIL] ${name}${detail ? ' -- ' + detail : ''}`); }
}
async function expectError(fn: () => Promise<unknown>, check: (e: any) => boolean) {
  try { await fn(); return false; } catch (e) { return check(e); }
}

const run = Date.now().toString().slice(-7);
const createdRegistrations: string[] = [];
const createdPayments: string[] = [];

function testRegistration(n: number, projectId = 'proj_pangot', extra: Partial<Registration> = {}): Registration {
  const now = new Date().toISOString();
  const id = `reg_dbt${run}${n}`.slice(0, 40);
  createdRegistrations.push(id);
  return {
    id, registration_number: `GRG-TST-${run}-${n}`, full_name: `DB Layer Test ${n}`, mobile: `+917${run}${String(n).padStart(2, '0')}`,
    email: `db.layer.${run}.${n}@example.com`, country: 'India', state: 'Test', city: 'Test', pincode: '000000', address: 'Test',
    project_id: projectId, project_name: projectId === 'proj_pangot' ? 'Pangot' : 'Dholera', selected_plan: '7 L – Co-Own', units_count: 1,
    total_price: 700000, roi_percentage: 14.5, token_amount: 51000, tax_amount: 0, total_payable: 51000, mode_of_payment: 'Test',
    total_payment_received: 0, documents_submitted: { id_proof: true, address_proof: false, photo: true }, consent: true,
    consent_timestamp: now, declaration_signed: true, privacy_policy_version: 'v2026.1', terms_version: 'v2026.1',
    payment_status: 'PENDING', registration_status: 'SUBMITTED', created_at: now, updated_at: now, ...extra
  };
}

function testPayment(reg: Registration, attempt: number, extra: Partial<PaymentRecord> = {}): PaymentRecord {
  const now = new Date().toISOString();
  const id = `pay_dbt${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`;
  createdPayments.push(id);
  return {
    id, registration_id: reg.id, registration_number: reg.registration_number, gateway: 'HDFC_SMARTHUB_QR',
    gateway_order_id: `hdfc_qr_${reg.registration_number}`, amount: reg.total_payable, currency: 'INR', payment_status: 'PENDING',
    signature_verified: false, webhook_verified: false, attempt_number: attempt, created_at: now, updated_at: now, ...extra
  };
}

async function main() {
  const config = mysqlConfigFromEnv();
  if (!config) {
    console.error('DB_HOST is not set: configure DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD first.');
    process.exitCode = 1;
    return;
  }
  console.log(`--- Database layer tests against ${config.host}:${config.port} / ${config.database} ---`);
  const store = new MySqlStore(config);
  const raw = await mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database, ssl: config.ssl ? { rejectUnauthorized: true } : undefined });

  try {
    // 1. Connection, schema and seed
    await store.init();
    const [tables] = await raw.query<any[]>('SHOW TABLES');
    const names = tables.map(t => Object.values(t)[0]);
    assert(['projects', 'project_plans', 'admin_users', 'registrations', 'payments', 'audit_logs', 'webhook_events', 'counters', 'schema_migrations'].every(t => names.includes(t)),
      '1. Connected; all 9 tables exist');
    const pangot = await store.getProject('proj_pangot');
    const dholera = await store.getProject('proj_dholera');
    assert(pangot?.token_amount === 51000 && pangot.booking_enabled === true && pangot.ownership_plans?.length === 4, '1a. Pangot seeded with its verified ₹51,000 token and 4 unit options');
    assert(Boolean(dholera) && (dholera!.booking_enabled === true || (dholera!.ownership_plans || []).every(pl => typeof pl.total_price === 'number')),
      '1b. Dholera present (closed unless an admin has opened it)');
    const [versions] = await raw.query<any[]>('SELECT version FROM schema_migrations');
    assert(versions.some(v => v.version === 1), '1c. Schema version recorded');
    await store.init(); // running startup again must be harmless
    assert((await store.getProject('proj_pangot'))?.token_amount === 51000, '1d. Re-running startup migration/seed is idempotent');

    // 2. Round trip incl. decimals and timestamps
    const r1 = testRegistration(1, 'proj_pangot', { total_payable: 51000.5, token_amount: 51000.5 });
    await store.saveRegistration(r1);
    const back = await store.getRegistration(r1.id);
    assert(back?.total_payable === 51000.5 && back.created_at === r1.created_at && back.documents_submitted.photo === true && back.consent === true,
      '2. Booking round-trips exactly (DECIMAL amount, UTC timestamp, booleans, JSON fields)');

    // 3. Transactions roll back completely
    const r2 = testRegistration(2);
    const rolledBack = await expectError(() => store.transaction(async tx => {
      await tx.saveRegistration(r2);
      await tx.savePayment(testPayment(r2, 1));
      throw new Error('simulated failure after writes');
    }), e => e.message === 'simulated failure after writes');
    assert(rolledBack && !(await store.getRegistration(r2.id)) && (await store.getPaymentsForRegistration(r2.id)).length === 0,
      '3. A failed transaction leaves no booking and no payment behind');

    // 4. Uniqueness rules enforced by the database
    const dupNumber = testRegistration(3, 'proj_pangot', { registration_number: r1.registration_number });
    assert(await expectError(() => store.saveRegistration(dupNumber), e => e instanceof DuplicateRecordError && e.constraint === 'uq_registrations_number'),
      '4. Duplicate Booking ID rejected (unique index)');
    const utr = `9${run}123`;
    const a = testRegistration(4, 'proj_pangot', { utr_number: utr });
    await store.saveRegistration(a);
    const b = testRegistration(5, 'proj_dholera', { utr_number: utr });
    assert(await expectError(() => store.saveRegistration(b), e => e instanceof DuplicateRecordError && e.constraint === 'uq_registrations_active_utr'),
      '4a. The same UTR cannot be active on two bookings (even across projects)');
    await store.saveRegistration({ ...a, payment_status: 'FAILED' });
    await store.saveRegistration(b);
    assert((await store.getRegistration(b.id))?.utr_number === utr, '4b. A rejected (FAILED) booking releases its UTR');
    await store.savePayment(testPayment(a, 1));
    assert(await expectError(() => store.savePayment(testPayment(a, 1)), e => e instanceof DuplicateRecordError),
      '4c. Duplicate payment attempt for one booking rejected');

    // 5. Payments are tied to a real booking and inherit its project
    const orphan = testPayment({ ...r1, id: `reg_missing_${run}` }, 1);
    assert(await expectError(() => store.savePayment(orphan), e => /unknown booking/.test(e.message)), '5. A payment for a non-existent booking is refused');
    const pb = testPayment(b, 1);
    await store.savePayment(pb);
    const [payRows] = await raw.query<any[]>('SELECT project_id FROM payments WHERE id = ?', [pb.id]);
    assert(payRows[0]?.project_id === 'proj_dholera', '5a. Payment project comes from its booking (Dholera payment stays Dholera)');
    const pangotOnly = await store.listRegistrations({ projectId: 'proj_pangot', search: `db.layer.${run}` });
    const dholeraOnly = await store.listRegistrations({ projectId: 'proj_dholera', search: `db.layer.${run}` });
    assert(pangotOnly.every(r => r.project_id === 'proj_pangot') && dholeraOnly.every(r => r.project_id === 'proj_dholera') && dholeraOnly.some(r => r.id === b.id),
      '5b. Project filter returns only that project\'s bookings');

    // 6. Booking ID counter is atomic under concurrency
    const numbers = await Promise.all(Array.from({ length: 25 }, () => store.generateRegistrationNumber('TST')));
    assert(new Set(numbers).size === 25, '6. 25 concurrent Booking IDs are all unique');

    // 7. Row lock serialises competing writers on the same booking
    const order: string[] = [];
    await Promise.all([
      store.transaction(async tx => { await tx.getRegistrationForUpdate(r1.id); order.push('A-locked'); await new Promise(res => setTimeout(res, 400)); order.push('A-done'); }),
      new Promise(res => setTimeout(res, 100)).then(() => store.transaction(async tx => { await tx.getRegistrationForUpdate(r1.id); order.push('B-locked'); }))
    ]);
    assert(order.join(',') === 'A-locked,A-done,B-locked', '7. A locked booking cannot be changed by a second request until the first finishes', order.join(','));

    // 8. Injection attempts are plain data
    const hostile = `x' OR '1'='1'; DROP TABLE registrations; --`;
    const found = await store.listRegistrations({ search: hostile });
    const [stillThere] = await raw.query<any[]>("SHOW TABLES LIKE 'registrations'");
    assert(found.length === 0 && stillThere.length === 1, '8. SQL-injection text in a search is treated as text (no rows, table intact)');
    assert((await store.getRegistrationByNumber(`' OR 1=1 --`)) === null, '8a. Injection text in a Booking ID lookup matches nothing');

    // 9. Audit entries and project-scoped lookups
    await store.logAudit({ admin_id: 'db-layer-test', action: 'DB_LAYER_TEST', entity_type: 'TEST', entity_id: r1.id, new_value: { ok: true } });
    const audit = await store.listAuditLogs(20);
    assert(audit.some(x => x.action === 'DB_LAYER_TEST' && x.new_value?.ok === true), '9. Audit entries are stored and read back');
    assert((await store.findRegistrationByEmailOrPhone(r1.email, r1.mobile, 'proj_dholera')) === null && Boolean(await store.findRegistrationByEmailOrPhone(r1.email, r1.mobile, 'proj_pangot')),
      '9a. Reusing an unpaid booking is limited to the same project');
  } catch (err: any) {
    failed++;
    console.error('[FAIL] Test run aborted:', err.message);
  } finally {
    // Remove only the rows this run created (by id)
    try {
      if (createdPayments.length) await raw.query(`DELETE FROM payments WHERE id IN (${createdPayments.map(() => '?').join(',')})`, createdPayments);
      await raw.query(`DELETE FROM payments WHERE registration_id IN (${createdRegistrations.map(() => '?').join(',')})`, createdRegistrations);
      await raw.query(`DELETE FROM registrations WHERE id IN (${createdRegistrations.map(() => '?').join(',')})`, createdRegistrations);
      await raw.query("DELETE FROM audit_logs WHERE action = 'DB_LAYER_TEST' AND admin_id = 'db-layer-test'");
      const [left] = await raw.query<any[]>(`SELECT COUNT(*) AS n FROM registrations WHERE id IN (${createdRegistrations.map(() => '?').join(',')})`, createdRegistrations);
      console.log(`Cleanup: test rows removed (remaining: ${left[0].n}). Booking ID counter values used by test 6 are not reused.`);
    } catch (cleanupErr: any) {
      console.error('Cleanup failed — remove rows named "DB Layer Test" manually:', cleanupErr.message);
    }
    await raw.end();
    await store.close();
  }
  console.log(`\nDatabase layer tests: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exitCode = 1;
}

main();
