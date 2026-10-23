// Chooses the storage backend.
//   DB_HOST set              -> MySQL / MariaDB (Hostinger): the live database
//   DB_HOST not set (dev)    -> data/db.json (local development only)
//   DB_HOST not set (prod)   -> refuse to start, so production never silently uses a local file
import { Store } from './store.js';
import { JsonStore } from './jsonStore.js';
import { MySqlStore, mysqlConfigFromEnv } from './mysqlStore.js';

function createStore(): Store {
  const config = mysqlConfigFromEnv();
  if (config) return new MySqlStore(config);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DB_HOST, DB_NAME, DB_USER and DB_PASSWORD must be set in production (MySQL is required; data/db.json is development-only)');
  }
  return new JsonStore();
}

export const db: Store = createStore();

/** Connect and prepare the database; call once before the server accepts requests */
export async function initDatabase() {
  await db.init();
  return db.kind;
}

export { DuplicateRecordError, DatabaseUnavailableError } from './store.js';
