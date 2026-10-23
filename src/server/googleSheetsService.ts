import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Registration } from '../types.js';
import { db } from './db.js';
import { UNIT_OPTIONS, normalizeUnitOption, getPaymentStatusLabel } from '../bookingOptions.js';

// The ONLY columns written to the private booking spreadsheet
export const GOOGLE_SHEET_COLUMNS = [
  'Timestamp',
  'Booking ID',
  'Customer Name',
  'Phone Number',
  'Email',
  'Project',
  'Unit Type',
  'Number of Units',
  'Booking Token / Booking Amount',
  'Payment Amount',
  'UTR / Transaction ID',
  'Payment Status'
] as const;

// Last column letter for the columns above (12 columns => "L")
const LAST_COLUMN = String.fromCharCode(64 + GOOGLE_SHEET_COLUMNS.length);
// Column that holds the Booking ID, used as the duplicate-protection key
const BOOKING_ID_COLUMN = 'B';

// The existing private spreadsheet. The app never creates a spreadsheet and never changes its sharing.
// (A spreadsheet ID is not a credential; access is controlled by the server-side credentials below.)
export const DEFAULT_SPREADSHEET_ID = '1uw77HSMk5smqdBipFmDlj3BikxqeB4T6zXZh_7Lex8I';
export const SPREADSHEET_NAME = 'Payment Domain';
export const DEFAULT_SHEET_TAB_NAME = 'Sheet1';

export const ALLOWED_PLANS = UNIT_OPTIONS;

export const ALLOWED_PAYMENT_STATUSES = ['Awaiting Payment', 'Payment Submitted', 'Payment Verified', 'Payment Failed'] as const;

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
// Never leave a customer waiting on a hung Google request
const REQUEST_TIMEOUT_MS = 15_000;
const withTimeout = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);

function getSpreadsheetId(): string {
  return (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID).trim();
}

function getSheetTabName(): string {
  return (process.env.GOOGLE_SHEET_NAME || process.env.GOOGLE_SHEETS_TAB_NAME || DEFAULT_SHEET_TAB_NAME).trim();
}

/** Build a URL-encoded A1 range on the configured tab, e.g. 'Sheet1'!A1:L1 */
function sheetRange(a1: string): string {
  return encodeURIComponent(`'${getSheetTabName().replace(/'/g, "''")}'!${a1}`);
}

export interface SheetsCredentialState {
  account: { email: string; privateKey: string } | null;
  source: string | null;
  /** Human-readable setup problems. Never contains key material. */
  problems: string[];
}

/**
 * Load the service account from server-side configuration only:
 *   1. GOOGLE_SERVICE_ACCOUNT_KEY_FILE (or GOOGLE_APPLICATION_CREDENTIALS): path to the downloaded JSON key, or
 *   2. GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in .env
 */
export function loadSheetsCredentials(): SheetsCredentialState {
  const problems: string[] = [];
  let email = '';
  let privateKey = '';
  let source: string | null = null;

  const keyFile = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (keyFile) {
    const resolved = path.resolve(process.cwd(), keyFile);
    try {
      const parsed = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      if (parsed.type !== 'service_account') {
        problems.push(`Key file ${resolved} is not a service-account key (its "type" is "${parsed.type || 'missing'}"). Download a JSON key for a service account.`);
      } else {
        email = String(parsed.client_email || '').trim();
        privateKey = String(parsed.private_key || '').trim();
        source = `key file ${resolved}`;
      }
    } catch (err: any) {
      problems.push(
        err.code === 'ENOENT'
          ? `GOOGLE_SERVICE_ACCOUNT_KEY_FILE points to ${resolved}, but that file does not exist.`
          : `Key file ${resolved} could not be read as JSON.`
      );
    }
  } else {
    email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    // .env files store the key on one line with literal "\n" sequences
    privateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').split('\\n').join('\n').trim();
    if (!email && !privateKey) {
      problems.push(
        'No Google credentials are configured. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE in .env to the path of the service-account JSON key ' +
        '(or set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).'
      );
    } else {
      if (!email) problems.push('GOOGLE_SERVICE_ACCOUNT_EMAIL is missing in .env.');
      if (!privateKey) problems.push('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is missing in .env.');
      source = '.env variables';
    }
  }

  if (problems.length === 0) {
    if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(email)) {
      problems.push('The service account email does not look like one (expected something ending in ".iam.gserviceaccount.com"). Use the "client_email" value from the JSON key.');
    }
    try {
      crypto.createPrivateKey(privateKey);
    } catch {
      problems.push(
        'The private key could not be parsed. Copy the whole "private_key" value from the JSON key (from -----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----, ' +
        'keeping the \\n sequences), or use GOOGLE_SERVICE_ACCOUNT_KEY_FILE instead.'
      );
    }
  }

  return { account: problems.length === 0 ? { email, privateKey } : null, source, problems };
}

function getServiceAccount(): { email: string; privateKey: string } | null {
  return loadSheetsCredentials().account;
}

/** Turn a Google API failure into a concrete instruction for whoever runs the server. */
function explainGoogleError(status: number, body: string, serviceEmail?: string): string {
  const detail = body.replace(/\s+/g, ' ').slice(0, 200);
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(body)) {
    return 'The Google Sheets API is not enabled for the service account\'s Google Cloud project. Enable "Google Sheets API" in that project (APIs & Services > Library) and wait a minute.';
  }
  if (status === 403) {
    return `Permission denied. Open the spreadsheet, click Share, and add ${serviceEmail || 'the service account email'} as Editor.`;
  }
  if (status === 404) {
    return `Spreadsheet ${getSpreadsheetId()} was not found. Check GOOGLE_SHEETS_SPREADSHEET_ID.`;
  }
  if (status === 400 && /Unable to parse range/i.test(body)) {
    return `The spreadsheet has no tab named "${getSheetTabName()}". Set GOOGLE_SHEET_NAME to the exact tab name.`;
  }
  if (status === 401) {
    return 'Google rejected the access token. Check the service-account key (it may have been deleted or disabled).';
  }
  return `Google Sheets API returned HTTP ${status}. ${detail}`;
}

/**
 * Sanitize cell values against formula injection (CSV/Spreadsheet injection).
 * If a value starts with =, +, -, @, \t, or \r, prepend a single quote so Google Sheets treats it as plain text.
 */
export function sanitizeCellValue(val: any): string | number {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }
  const raw = String(val);
  const str = raw.trim();
  if (
    str.startsWith('=') ||
    str.startsWith('+') ||
    str.startsWith('-') ||
    str.startsWith('@') ||
    raw.startsWith('\t') ||
    raw.startsWith('\r')
  ) {
    return `'${str}`;
  }
  return str;
}

/** Format an ISO date as "YYYY-MM-DD HH:mm:ss" in India Standard Time. */
function formatTimestampIST(iso: string | undefined): string {
  const date = new Date(iso || Date.now());
  const safeDate = isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

/**
 * Formats a registration object into the strict predefined column array.
 * Only the predefined booking/payment fields are included; everything is sanitized.
 */
export function formatRegistrationToRow(reg: Registration): (string | number)[] {
  const unitsCount = reg.units_count || 1;
  const tokenAmount = reg.token_amount || unitsCount * 51000;

  return [
    formatTimestampIST(reg.payment_submitted_at || reg.created_at),       // 1. Timestamp (payment submission, else booking creation)
    sanitizeCellValue(reg.registration_number),                           // 2. Booking ID
    sanitizeCellValue(reg.full_name),                                     // 3. Customer Name
    sanitizeCellValue(reg.mobile),                                        // 4. Phone Number
    sanitizeCellValue(reg.email),                                         // 5. Email
    sanitizeCellValue(reg.project_name || 'Pangot'),                       // 6. Project (the booking's own project)
    sanitizeCellValue(normalizeUnitOption(reg.selected_plan) || reg.selected_plan || reg.unit_size || ''), // 7. Unit Type
    unitsCount,                                                           // 8. Number of Units
    tokenAmount,                                                          // 9. Booking Token / Booking Amount
    reg.total_payable || tokenAmount,                                     // 10. Payment Amount
    sanitizeCellValue(reg.utr_number || ''),                              // 11. UTR / Transaction ID
    getPaymentStatusLabel(reg)                                            // 12. Payment Status
  ];
}

class GoogleSheetsService {
  private inMemoryAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private serviceAccountToken: string | null = null;
  private serviceAccountTokenExpiresAt: number = 0;
  private headersVerified: boolean = false;
  private lastError: string | null = null;
  // Serializes writes so two quick syncs of one booking cannot both append a row
  private syncQueue: Promise<unknown> = Promise.resolve();

  public setAccessToken(token: string, expiresInSeconds: number = 3600) {
    this.inMemoryAccessToken = token;
    this.tokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  }

  public getAccessToken(): string | null {
    if (this.inMemoryAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.inMemoryAccessToken;
    }
    return null;
  }

  public clearAccessToken() {
    this.inMemoryAccessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Server-side auth: exchange a signed service-account JWT for a short-lived access token.
   * The private key is read from server environment variables only and never leaves the backend.
   */
  private async getServiceAccountToken(): Promise<string | null> {
    const account = getServiceAccount();
    if (!account) return null;

    if (this.serviceAccountToken && Date.now() < this.serviceAccountTokenExpiresAt - 60_000) {
      return this.serviceAccountToken;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const claims = encode({
      iss: account.email,
      scope: SHEETS_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600
    });
    const unsigned = `${header}.${claims}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.privateKey).toString('base64url');

    const res = await fetch('https://oauth2.googleapis.com/token', {
      signal: withTimeout(),
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`
      })
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        /invalid_grant/i.test(body)
          ? 'Google rejected the service-account key (invalid_grant). The key may be deleted/disabled, belong to another account, or this computer\'s clock may be wrong.'
          : `Google service account authentication failed (HTTP ${res.status}).`
      );
    }

    const data = await res.json();
    this.serviceAccountToken = data.access_token;
    this.serviceAccountTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return this.serviceAccountToken;
  }

  /**
   * Resolve a server-held token: service account first, then an admin-connected session token.
   */
  private async resolveToken(tokenOverride?: string): Promise<string | null> {
    if (tokenOverride) return tokenOverride;
    const serviceToken = await this.getServiceAccountToken();
    return serviceToken || this.getAccessToken();
  }

  /**
   * Write the header row ONLY when row 1 of the tab is empty.
   * Existing content in the spreadsheet is never overwritten.
   */
  private async ensureHeaders(token: string, spreadsheetId: string): Promise<void> {
    if (this.headersVerified) return;

    const headerRange = sheetRange(`A1:${LAST_COLUMN}1`);
    const res = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${headerRange}`, {
      signal: withTimeout(),
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error(explainGoogleError(res.status, await res.text(), getServiceAccount()?.email));
    }

    const data = await res.json();
    const existing: string[] = (data.values && data.values[0]) || [];

    if (existing.length === 0) {
      const updateRes = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${headerRange}?valueInputOption=RAW`, {
        signal: withTimeout(),
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [Array.from(GOOGLE_SHEET_COLUMNS)]
        })
      });
      if (!updateRes.ok) {
        throw new Error(`Could not write the header row. ${explainGoogleError(updateRes.status, await updateRes.text(), getServiceAccount()?.email)}`);
      }
    } else if (existing.join('|') !== GOOGLE_SHEET_COLUMNS.join('|')) {
      console.warn('Google Sheet header row differs from the expected booking columns; leaving it untouched.');
    }

    this.headersVerified = true;
  }

  /**
   * Synchronize a registration record to the existing private spreadsheet.
   * Implements strict duplicate protection by searching for the Booking ID.
   * If found: updates the row in place (action: UPDATE).
   * If not found: appends a new row (action: APPEND).
   */
  public syncRegistration(
    reg: Registration,
    tokenOverride?: string
  ): Promise<{
    success: boolean;
    action: 'APPEND' | 'UPDATE' | 'QUEUED';
    row?: number;
    error?: string;
  }> {
    const run = this.syncQueue.then(() => this.syncRegistrationNow(reg, tokenOverride));
    this.syncQueue = run.catch(() => undefined);
    return run;
  }

  private async syncRegistrationNow(
    reg: Registration,
    tokenOverride?: string
  ): Promise<{
    success: boolean;
    action: 'APPEND' | 'UPDATE' | 'QUEUED';
    row?: number;
    error?: string;
  }> {
    const rowValues = formatRegistrationToRow(reg);

    // If an external Google Apps Script Webhook URL is configured in process.env:
    const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL;
    if (appsScriptUrl) {
      try {
        const webhookRes = await fetch(appsScriptUrl, {
          signal: withTimeout(),
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SYNC_BOOKING',
            spreadsheetId: getSpreadsheetId(),
            sheetName: getSheetTabName(),
            registrationId: reg.registration_number,
            row: rowValues,
            columns: GOOGLE_SHEET_COLUMNS,
            timestamp: new Date().toISOString()
          })
        });
        if (webhookRes.ok) {
          await db.logAudit({
            action: 'GOOGLE_SHEETS_WEBHOOK_SYNCED',
            admin_id: 'system',
            entity_type: 'GOOGLE_SHEET',
            entity_id: reg.registration_number,
            new_value: { status: reg.payment_status }
          });
          return { success: true, action: 'APPEND' };
        }
      } catch (err: any) {
        console.warn('Apps Script webhook error:', err.message);
      }
    }

    // Direct Google Sheets API v4 Integration (server-side credentials only)
    let token: string | null = null;
    try {
      token = await this.resolveToken(tokenOverride);
    } catch (err: any) {
      this.lastError = err.message;
      console.error('Google Sheets auth error:', err.message);
      return { success: false, action: 'APPEND', error: err.message };
    }

    if (!token) {
      // No server-side Google credentials configured yet.
      // Record locally in sync log so it can be synchronized once credentials are configured ("Sync All").
      await db.logAudit({
        action: 'GOOGLE_SHEETS_SYNC_QUEUED',
        admin_id: 'system',
        entity_type: 'GOOGLE_SHEET',
        entity_id: reg.registration_number,
        new_value: {
          note: 'Google credentials not configured. Record validated and queued for spreadsheet sync.',
          status: reg.payment_status
        }
      });
      return { success: true, action: 'QUEUED' };
    }

    try {
      const spreadsheetId = getSpreadsheetId();
      await this.ensureHeaders(token, spreadsheetId);

      // Check the Booking ID column for an existing row to prevent duplicates
      const idColumnUrl = `${SHEETS_API}/${spreadsheetId}/values/${sheetRange(`${BOOKING_ID_COLUMN}:${BOOKING_ID_COLUMN}`)}`;
      const idColumnRes = await fetch(idColumnUrl, {
        signal: withTimeout(),
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!idColumnRes.ok) {
        // Never append blindly: without this lookup we could create a duplicate row
        throw new Error(`Could not read the Booking ID column. ${explainGoogleError(idColumnRes.status, await idColumnRes.text(), getServiceAccount()?.email)}`);
      }

      let existingRowIndex = -1;
      const idColumnData = await idColumnRes.json();
      const rows: string[][] = idColumnData.values || [];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i][0] === reg.registration_number) {
          existingRowIndex = i + 1; // 1-based index in Google Sheets
          break;
        }
      }

      if (existingRowIndex > 0) {
        // UPDATE existing row in place (idempotent, prevents duplicates)
        const updateRange = sheetRange(`A${existingRowIndex}:${LAST_COLUMN}${existingRowIndex}`);
        const updateUrl = `${SHEETS_API}/${spreadsheetId}/values/${updateRange}?valueInputOption=USER_ENTERED`;
        const updateRes = await fetch(updateUrl, {
          signal: withTimeout(),
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [rowValues]
          })
        });

        if (!updateRes.ok) {
          throw new Error(`Could not update the booking's row. ${explainGoogleError(updateRes.status, await updateRes.text(), getServiceAccount()?.email)}`);
        }

        await db.logAudit({
          action: 'GOOGLE_SHEETS_ROW_UPDATED',
          admin_id: 'system',
          entity_type: 'GOOGLE_SHEET',
          entity_id: reg.registration_number,
          new_value: { row: existingRowIndex, payment_status: reg.payment_status }
        });

        this.lastError = null;
        return { success: true, action: 'UPDATE', row: existingRowIndex };
      } else {
        // APPEND new row
        const appendUrl = `${SHEETS_API}/${spreadsheetId}/values/${sheetRange(`A:${LAST_COLUMN}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        const appendRes = await fetch(appendUrl, {
          signal: withTimeout(),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [rowValues]
          })
        });

        if (!appendRes.ok) {
          throw new Error(`Could not append the row. ${explainGoogleError(appendRes.status, await appendRes.text(), getServiceAccount()?.email)}`);
        }

        await db.logAudit({
          action: 'GOOGLE_SHEETS_ROW_APPENDED',
          admin_id: 'system',
          entity_type: 'GOOGLE_SHEET',
          entity_id: reg.registration_number,
          new_value: { payment_status: reg.payment_status }
        });

        this.lastError = null;
        return { success: true, action: 'APPEND' };
      }
    } catch (err: any) {
      this.lastError = err.message;
      console.error('Google Sheets sync error:', err.message);
      await db.logAudit({
        action: 'GOOGLE_SHEETS_SYNC_ERROR',
        admin_id: 'system',
        entity_type: 'GOOGLE_SHEET',
        entity_id: reg.registration_number,
        new_value: { error: err.message }
      });
      return { success: false, action: 'APPEND', error: err.message };
    }
  }

  /**
   * Read-only connection check: credentials -> Google sign-in -> spreadsheet access -> tab exists.
   * Returns one line per step so a missing piece is named exactly. Never returns key material.
   */
  public async diagnose(): Promise<{ ok: boolean; steps: { step: string; ok: boolean; detail: string }[] }> {
    const steps: { step: string; ok: boolean; detail: string }[] = [];
    const add = (step: string, ok: boolean, detail: string) => {
      steps.push({ step, ok, detail });
      return ok;
    };
    const done = () => ({ ok: steps.every(s => s.ok), steps });

    add('Spreadsheet ID', true, getSpreadsheetId());
    add('Tab name', true, getSheetTabName());

    const credentials = loadSheetsCredentials();
    if (!credentials.account) {
      if (this.getAccessToken()) {
        add('Credentials', true, 'Using the Google session connected from the Admin Dashboard (temporary: lasts about 1 hour)');
      } else if (process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL) {
        add('Credentials', true, 'Using GOOGLE_APPS_SCRIPT_WEBHOOK_URL (rows are sent to the Apps Script web app; connection not checked here)');
        return done();
      } else {
        add('Credentials', false, credentials.problems.join(' '));
        return done();
      }
    } else {
      add('Credentials', true, `Service account ${credentials.account.email} (from ${credentials.source})`);
    }

    let token: string | null = null;
    try {
      token = await this.resolveToken();
      add('Google sign-in', Boolean(token), token ? 'Access token obtained' : 'No access token available');
    } catch (err: any) {
      add('Google sign-in', false, err.name === 'TimeoutError' ? 'Timed out reaching Google. Check the internet connection.' : err.message);
    }
    if (!token) return done();

    try {
      const res = await fetch(`${SHEETS_API}/${getSpreadsheetId()}?fields=properties.title,sheets.properties.title`, {
        signal: withTimeout(),
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        add('Spreadsheet access', false, explainGoogleError(res.status, await res.text(), credentials.account?.email));
        return done();
      }
      const meta = await res.json();
      const tabs: string[] = (meta.sheets || []).map((s: any) => s.properties?.title);
      add('Spreadsheet access', true, `Opened "${meta.properties?.title}"`);
      add(
        'Tab exists',
        tabs.includes(getSheetTabName()),
        tabs.includes(getSheetTabName())
          ? `"${getSheetTabName()}" found`
          : `No tab named "${getSheetTabName()}". Tabs in this spreadsheet: ${tabs.map(t => `"${t}"`).join(', ')}. Set GOOGLE_SHEET_NAME to one of them.`
      );
    } catch (err: any) {
      add('Spreadsheet access', false, err.name === 'TimeoutError' ? 'Timed out reaching Google. Check the internet connection.' : err.message);
    }

    return done();
  }

  /**
   * Sync all registrations in the database to the Google Sheet.
   */
  public async syncAll(tokenOverride?: string): Promise<{ total: number; synced: number; errors: number }> {
    const registrations = await db.listRegistrations();
    let synced = 0;
    let errors = 0;

    for (const reg of registrations) {
      const res = await this.syncRegistration(reg, tokenOverride);
      if (res.success) {
        synced++;
      } else {
        errors++;
      }
    }

    return { total: registrations.length, synced, errors };
  }

  public getStatus() {
    return {
      spreadsheetName: SPREADSHEET_NAME,
      spreadsheetId: getSpreadsheetId(),
      sheetTab: getSheetTabName(),
      columnsCount: GOOGLE_SHEET_COLUMNS.length,
      columns: GOOGLE_SHEET_COLUMNS,
      isConnected: Boolean(getServiceAccount() || this.getAccessToken() || process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL),
      serviceAccountConfigured: Boolean(getServiceAccount()),
      tokenExpiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : null,
      webhookConfigured: Boolean(process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL),
      lastError: this.lastError
    };
  }
}

export const googleSheetsService = new GoogleSheetsService();
