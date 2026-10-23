/**
 * Remove automated-test bookings from the MySQL database.
 *   npm run db:cleanup-test            -> lists what would be removed (no changes)
 *   npm run db:cleanup-test -- --delete -> removes exactly those bookings and their payments/audit entries
 *
 * Test records are identified ONLY by e-mail addresses at example.com, a domain reserved for examples that no
 * real customer can use. Nothing else is ever selected or deleted.
 */
import '../src/server/loadEnv.js';
import mysql from 'mysql2/promise';
import { mysqlConfigFromEnv } from '../src/server/mysqlStore.js';

async function main() {
  const config = mysqlConfigFromEnv();
  if (!config) { console.error('DB_HOST is not set.'); process.exit(1); }
  const doDelete = process.argv.includes('--delete');
  const conn = await mysql.createConnection({
    host: config.host, port: config.port, user: config.user, password: config.password, database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined
  });
  try {
    const [rows] = await conn.query<any[]>(
      "SELECT id, registration_number, full_name, email, payment_status FROM registrations WHERE email LIKE '%@example.com' ORDER BY created_at"
    );
    console.log(`${rows.length} test booking(s) found (e-mail @example.com) in "${config.database}":`);
    for (const r of rows.slice(0, 50)) console.log(`  ${r.registration_number}  ${r.full_name}  <${r.email}>  ${r.payment_status}`);
    if (rows.length > 50) console.log(`  ... and ${rows.length - 50} more`);
    if (!rows.length) return;
    if (!doDelete) {
      console.log('\nNothing was changed. Run again with --delete to remove exactly these test bookings.');
      return;
    }
    const ids = rows.map(r => r.id);
    const ph = ids.map(() => '?').join(',');
    await conn.beginTransaction();
    const [p] = await conn.query<any>(`DELETE FROM payments WHERE registration_id IN (${ph})`, ids);
    const [a] = await conn.query<any>(`DELETE FROM audit_logs WHERE entity_id IN (${ph})`, ids);
    const [r] = await conn.query<any>(`DELETE FROM registrations WHERE id IN (${ph}) AND email LIKE '%@example.com'`, ids);
    await conn.commit();
    console.log(`\nRemoved ${r.affectedRows} test booking(s), ${p.affectedRows} payment record(s), ${a.affectedRows} audit entr(y/ies).`);
  } catch (e: any) {
    try { await conn.rollback(); } catch {}
    console.error('Cleanup failed, nothing was removed:', e.code || e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
