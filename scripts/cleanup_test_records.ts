/**
 * Remove automated-test bookings from the MySQL database.
 *   npm run db:cleanup-test            -> lists what would be removed (no changes)
 *   npm run db:cleanup-test -- --delete -> removes exactly those records and their payments/partner records/audit entries
 *
 * Test records (bookings and Channel Partner applications) are identified ONLY by e-mail addresses at example.com,
 * a domain reserved for examples that no real customer can use. Nothing else is ever selected or deleted.
 */
import '../src/server/loadEnv.js';
import dns from 'dns';
import mysql from 'mysql2/promise';
import { mysqlConfigFromEnv } from '../src/server/mysqlStore.js';

// Runs on your own computer, outside Hostinger: prefer IPv4 so the Remote MySQL allowlist (your IPv4 address) applies.
// Affects only this script's process, never the website.
dns.setDefaultResultOrder('ipv4first');

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
    // Channel Partner test applications (the table exists once migration 2 has run)
    const [cpTable] = await conn.query<any[]>("SHOW TABLES LIKE 'cp_applications'");
    const [cpRows] = cpTable.length
      ? await conn.query<any[]>("SELECT id, application_ref, full_name, email, status FROM cp_applications WHERE email LIKE '%@example.com' ORDER BY created_at")
      : [[] as any[]];
    console.log(`${cpRows.length} test channel partner application(s) found (e-mail @example.com):`);
    for (const r of cpRows.slice(0, 50)) console.log(`  ${r.application_ref}  ${r.full_name}  <${r.email}>  ${r.status}`);
    if (cpRows.length > 50) console.log(`  ... and ${cpRows.length - 50} more`);
    if (!rows.length && !cpRows.length) return;
    if (!doDelete) {
      console.log('\nNothing was changed. Run again with --delete to remove exactly these test records.');
      return;
    }
    await conn.beginTransaction();
    let removed = '';
    if (rows.length) {
      const ids = rows.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      const [p] = await conn.query<any>(`DELETE FROM payments WHERE registration_id IN (${ph})`, ids);
      const [a] = await conn.query<any>(`DELETE FROM audit_logs WHERE entity_id IN (${ph})`, ids);
      const [r] = await conn.query<any>(`DELETE FROM registrations WHERE id IN (${ph}) AND email LIKE '%@example.com'`, ids);
      removed += `${r.affectedRows} test booking(s), ${p.affectedRows} payment record(s), ${a.affectedRows} audit entr(y/ies). `;
    }
    if (cpRows.length) {
      const ids = cpRows.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      // Partner records first (they protect their application); documents, history and notifications go with the application
      const [pp] = await conn.query<any>(`DELETE FROM cp_partners WHERE application_id IN (${ph})`, ids);
      const [a] = await conn.query<any>(`DELETE FROM audit_logs WHERE entity_type = 'CP_APPLICATION' AND entity_id IN (${ph})`, ids);
      const [c] = await conn.query<any>(`DELETE FROM cp_applications WHERE id IN (${ph}) AND email LIKE '%@example.com'`, ids);
      removed += `${c.affectedRows} test CP application(s), ${pp.affectedRows} partner record(s), ${a.affectedRows} CP audit entr(y/ies).`;
    }
    await conn.commit();
    console.log(`\nRemoved ${removed}`);
  } catch (e: any) {
    try { await conn.rollback(); } catch {}
    console.error('Cleanup failed, nothing was removed:', e.code || e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main();
