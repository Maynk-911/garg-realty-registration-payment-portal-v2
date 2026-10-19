/**
 * LOCAL TEST DOUBLE for Google's OAuth token endpoint and the Google Sheets API v4.
 *
 * Preload it into the dev server to exercise the real Sheets code path without real credentials:
 *   npm run dev:mock-sheets
 *
 * It patches fetch() for oauth2.googleapis.com and sheets.googleapis.com only, keeps the "spreadsheet"
 * in a local JSON file, and generates a throwaway key pair for the service-account JWT.
 * Nothing here ever talks to Google, and it refuses to load in production.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.NODE_ENV === 'production') {
  throw new Error('tests/mockGoogleSheets.mjs must never be loaded in production');
}

const SHEET_FILE = process.env.MOCK_SHEET_FILE || path.join(os.tmpdir(), 'garg-mock-sheet.json');
// While this file exists, every Sheets API call fails (simulates a Google outage)
const FAIL_FILE = process.env.MOCK_SHEET_FAIL_FILE || path.join(os.tmpdir(), 'garg-mock-sheet.fail');
const EXPECTED_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1uw77HSMk5smqdBipFmDlj3BikxqeB4T6zXZh_7Lex8I';
const TAB = process.env.MOCK_SHEET_TAB || 'Sheet1';
const ACCESS_TOKEN = 'mock-access-token';
// Set MOCK_SHEET_FORBIDDEN=true to simulate a spreadsheet that is not shared with the service account
const FORBIDDEN = process.env.MOCK_SHEET_FORBIDDEN === 'true';
const forbidden = () => json(403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } });

// Throwaway service account so the real JWT-signing code runs
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'mock-sheets@local-test.iam.gserviceaccount.com';
// Make sure a real key file from .env is never used while the mock is active
process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE = '';
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

const load = () => (fs.existsSync(SHEET_FILE) ? JSON.parse(fs.readFileSync(SHEET_FILE, 'utf8')) : { rows: [], calls: [] });
const save = state => fs.writeFileSync(SHEET_FILE, JSON.stringify(state, null, 2));
if (!fs.existsSync(SHEET_FILE)) save({ rows: [], calls: [] });

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// USER_ENTERED: a leading apostrophe marks plain text and is not part of the stored value
const userEntered = v => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);

  if (url.hostname === 'oauth2.googleapis.com') {
    const assertion = new URLSearchParams(String(init.body)).get('assertion') || '';
    const [header, claims, signature] = assertion.split('.');
    const valid = Boolean(signature) && crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, signature, 'base64url');
    const payload = valid ? JSON.parse(Buffer.from(claims, 'base64url').toString()) : {};
    if (!valid || payload.scope !== 'https://www.googleapis.com/auth/spreadsheets') {
      return json(400, { error: 'invalid_grant' });
    }
    return json(200, { access_token: ACCESS_TOKEN, expires_in: 3600, token_type: 'Bearer' });
  }

  if (url.hostname !== 'sheets.googleapis.com') {
    return realFetch(input, init);
  }

  const method = (init.method || 'GET').toUpperCase();
  const state = load();

  // Spreadsheet metadata (connection check)
  const metaMatch = url.pathname.match(/^\/v4\/spreadsheets\/([^/]+)$/);
  if (metaMatch && method === 'GET') {
    if (fs.existsSync(FAIL_FILE)) return json(500, { error: { code: 500, message: 'Internal error (simulated outage)' } });
    if (FORBIDDEN) return forbidden();
    if (metaMatch[1] !== EXPECTED_SPREADSHEET_ID) return json(404, { error: { code: 404, message: 'Requested entity was not found.' } });
    return json(200, { properties: { title: 'Payment Domain (LOCAL MOCK)' }, sheets: [{ properties: { title: TAB } }] });
  }
  const match = decodeURIComponent(url.pathname).match(/^\/v4\/spreadsheets\/([^/]+)\/values\/'(.+)'!([A-Z]+)(\d*):([A-Z]+)(\d*)(:append)?$/);
  state.calls.push(`${method} ${decodeURIComponent(url.pathname)}`);
  save(state);

  if (fs.existsSync(FAIL_FILE)) return json(500, { error: { code: 500, message: 'Internal error (simulated outage)' } });
  if ((init.headers?.Authorization || '') !== `Bearer ${ACCESS_TOKEN}`) return json(401, { error: { code: 401, message: 'Unauthorized' } });
  if (FORBIDDEN) return forbidden();
  if (!match) return json(400, { error: { code: 400, message: 'Unable to parse range' } });

  const [, spreadsheetId, tab, startCol, startRow, , endRow, isAppend] = match;
  if (spreadsheetId !== EXPECTED_SPREADSHEET_ID) return json(404, { error: { code: 404, message: 'Requested entity was not found.' } });
  if (tab !== TAB) return json(400, { error: { code: 400, message: `Unable to parse range: '${tab}'` } });

  const colIndex = startCol.charCodeAt(0) - 65;

  if (method === 'GET') {
    let values;
    if (startRow) {
      const row = state.rows[Number(startRow) - 1];
      values = row ? [row.slice(colIndex)] : undefined;
    } else {
      values = state.rows.map(r => [r[colIndex]]);
    }
    return json(200, values && values.length ? { range: `${tab}!${startCol}${startRow}`, values } : { range: `${tab}!${startCol}${startRow}` });
  }

  const body = JSON.parse(String(init.body));
  const incoming = body.values[0].map(url.searchParams.get('valueInputOption') === 'USER_ENTERED' ? userEntered : v => v);

  if (method === 'POST' && isAppend) {
    state.rows.push(incoming);
    save(state);
    return json(200, { updates: { updatedRows: 1, updatedRange: `${tab}!A${state.rows.length}` } });
  }

  if (method === 'PUT' && startRow && startRow === endRow) {
    state.rows[Number(startRow) - 1] = incoming;
    save(state);
    return json(200, { updatedRows: 1 });
  }

  return json(400, { error: { code: 400, message: 'Unsupported mock operation' } });
};

console.log(`[mock-google-sheets] ACTIVE - Google is NOT contacted. Rows are stored in ${SHEET_FILE}`);
