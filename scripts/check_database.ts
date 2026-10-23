/**
 * Read-only MySQL check: npm run db:check
 * Connects with DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD and reports the server, schema and record counts.
 * It never writes anything and never prints the password.
 */
import '../src/server/loadEnv.js';
import mysql from 'mysql2/promise';
import { mysqlConfigFromEnv } from '../src/server/mysqlStore.js';

async function main() {
  let config;
  try {
    config = mysqlConfigFromEnv();
  } catch (e: any) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  if (!config) {
    console.error('✗ DB_HOST is not set. Add DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD to .env (or the hosting environment).');
    process.exit(1);
  }
  console.log(`Connecting to ${config.host}:${config.port}, database "${config.database}", user "${config.user}" (password hidden)...`);
  let conn;
  try {
    conn = await mysql.createConnection({
      host: config.host, port: config.port, user: config.user, password: config.password, database: config.database,
      connectTimeout: 10_000, ssl: config.ssl ? { rejectUnauthorized: true } : undefined
    });
  } catch (e: any) {
    const hints: Record<string, string> = {
      ENOTFOUND: 'The host name could not be found. Copy the exact MySQL host from hPanel.',
      ECONNREFUSED: 'Nothing is accepting connections on that host/port. Check DB_HOST and DB_PORT (usually 3306).',
      ETIMEDOUT: 'The connection timed out. From outside Hostinger, enable Remote MySQL for your IP in hPanel.',
      ER_ACCESS_DENIED_ERROR: 'User name or password rejected, or this IP is not allowed (Remote MySQL).',
      ER_BAD_DB_ERROR: 'The database name does not exist. Copy the exact database name from hPanel (it includes a prefix).',
      ER_DBACCESS_DENIED_ERROR: 'The user exists but has no access to this database. Assign the user to the database in hPanel.'
    };
    console.error(`✗ Connection failed (${e.code || 'error'}). ${hints[e.code] || ''}`);
    process.exit(1);
  }
  try {
    const [[ver]] = await conn.query<any[]>('SELECT VERSION() AS version');
    console.log(`✓ Connected. Server version: ${ver.version}`);
    const [tables] = await conn.query<any[]>('SHOW TABLES');
    const names = tables.map(t => String(Object.values(t)[0]));
    const expected = ['projects', 'project_plans', 'admin_users', 'registrations', 'payments', 'audit_logs', 'webhook_events', 'counters', 'schema_migrations'];
    const missing = expected.filter(t => !names.includes(t));
    if (missing.length) {
      console.log(`! Tables not created yet: ${missing.join(', ')} (the app creates them automatically on first start)`);
    } else {
      const [[v]] = await conn.query<any[]>('SELECT MAX(version) AS v FROM schema_migrations');
      console.log(`✓ All ${expected.length} tables present (schema version ${v.v})`);
      const [[c]] = await conn.query<any[]>(`SELECT
        (SELECT COUNT(*) FROM registrations) AS bookings,
        (SELECT COUNT(*) FROM registrations WHERE project_id = 'proj_pangot') AS pangot,
        (SELECT COUNT(*) FROM registrations WHERE project_id = 'proj_dholera') AS dholera,
        (SELECT COUNT(*) FROM payments) AS payments,
        (SELECT COUNT(*) FROM admin_users) AS admins,
        (SELECT COUNT(*) FROM audit_logs) AS audit`);
      console.log(`  Bookings: ${c.bookings} (Pangot ${c.pangot}, Dholera ${c.dholera}) · Payments: ${c.payments} · Admin accounts: ${c.admins} · Audit entries: ${c.audit}`);
      const [projects] = await conn.query<any[]>('SELECT id, token_amount, booking_enabled FROM projects ORDER BY id');
      for (const p of projects) console.log(`  Project ${p.id}: token ₹${Number(p.token_amount).toLocaleString('en-IN')}, bookings ${Number(p.booking_enabled) ? 'OPEN' : 'closed'}`);
    }
  } finally {
    await conn.end();
  }
}

main();
