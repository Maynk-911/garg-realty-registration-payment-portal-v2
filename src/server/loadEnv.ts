// Load the project-root .env regardless of the directory the server is started from.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Project root = nearest folder with package.json above this file. Works for the TypeScript source
// (src/server/loadEnv.ts) and for the compiled production bundle (build/server.js).
function findAppRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

export const APP_ROOT = findAppRoot();

// Variables already set by the host (e.g. Hostinger's environment panel) take precedence over .env
dotenv.config({ path: path.join(APP_ROOT, '.env') });

// The compiled server (npm run build -> build/server.js) is the production build: run in production mode
// unless the host explicitly sets NODE_ENV. `npm run dev` (tsx) is unaffected.
declare const __SERVER_BUNDLE__: boolean | undefined;
if (typeof __SERVER_BUNDLE__ !== 'undefined' && __SERVER_BUNDLE__ && !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}
