import { Registration } from '../types.js';
import { db } from './db.js';

// The ONLY 19 columns allowed by the strict data control policy
export const GOOGLE_SHEET_COLUMNS = [
  'Registration ID',
  'Full Name',
  'Mobile Number',
  'WhatsApp Number',
  'Email',
  'Country',
  'State',
  'City',
  'Pincode',
  'Full Address',
  'Project',
  'Selected Plan',
  'Number of Units',
  'Booking Token Amount',
  'Payment Status',
  'Payment Reference / Transaction ID',
  'Payment Method',
  'Registration Date',
  'Registration Time'
] as const;

export const SPREADSHEET_NAME = 'Payment Domain';
export const SHEET_TAB_NAME = 'Bookings';

export const ALLOWED_PLANS = [
  '₹7 L - Co-Own',
  '₹18 L - Co-Own',
  'Studio - Full Own',
  'Villa - Full Own'
] as const;

export const ALLOWED_PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED'] as const;

/**
 * Sanitize cell values against formula injection (CSV/Spreadsheet injection).
 * If a value starts with =, +, -, @, \t, or \r, prepend a single quote so Google Sheets treats it as plain text.
 */
export function sanitizeCellValue(val: any): string | number {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : val;
  }
  const str = String(val).trim();
  if (
    str.startsWith('=') ||
    str.startsWith('+') ||
    str.startsWith('-') ||
    str.startsWith('@') ||
    str.startsWith('\t') ||
    str.startsWith('\r')
  ) {
    return `'${str}`;
  }
  return str;
}

/**
 * Formats a registration object into the strict 19-column array.
 * Validates plan, project, payment status, and sanitizes all fields.
 */
export function formatRegistrationToRow(reg: Registration): (string | number)[] {
  const createdAt = new Date(reg.created_at || Date.now());
  const dateStr = createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = createdAt.toTimeString().split(' ')[0]; // HH:mm:ss

  // 11. Project: strictly "Pangot"
  const project = 'Pangot';

  // 12. Selected Plan: strictly one of the 4 allowed values
  let selectedPlan = (reg.selected_plan || '').trim();
  if (!ALLOWED_PLANS.includes(selectedPlan as any)) {
    selectedPlan = '₹7 L - Co-Own';
  }

  // 15. Payment Status: strictly PENDING, PAID, or FAILED
  let paymentStatus: string = reg.payment_status;
  if (paymentStatus === 'INITIATED') {
    paymentStatus = 'PENDING';
  } else if (!ALLOWED_PAYMENT_STATUSES.includes(paymentStatus as any)) {
    paymentStatus = 'PENDING';
  }

  // 16. Payment Reference / Transaction ID:
  // Store UTR or transaction ID. Never store cards, CVV, or passwords.
  const paymentRef = reg.utr_number || (paymentStatus === 'PAID' ? 'Verified Settlement' : 'Awaiting Payment');

  // 17. Payment Method:
  const paymentMethod = reg.mode_of_payment || 'HDFC SmartHub QR (TID: 68283784)';

  return [
    sanitizeCellValue(reg.registration_number),                         // 1. Registration ID
    sanitizeCellValue(reg.full_name),                                   // 2. Full Name
    sanitizeCellValue(reg.mobile),                                      // 3. Mobile Number
    sanitizeCellValue(reg.whatsapp || reg.mobile),                      // 4. WhatsApp Number
    sanitizeCellValue(reg.email),                                       // 5. Email
    sanitizeCellValue(reg.country || 'India'),                          // 6. Country
    sanitizeCellValue(reg.state || ''),                                 // 7. State
    sanitizeCellValue(reg.city || ''),                                  // 8. City
    sanitizeCellValue(reg.pincode || ''),                               // 9. Pincode
    sanitizeCellValue(reg.address || ''),                               // 10. Full Address
    project,                                                            // 11. Project (Fixed to Pangot)
    selectedPlan,                                                       // 12. Selected Plan
    reg.units_count || 1,                                               // 13. Number of Units
    reg.total_payable || (reg.units_count ? reg.units_count * 50000 : 50000), // 14. Booking Token Amount
    paymentStatus,                                                      // 15. Payment Status
    sanitizeCellValue(paymentRef),                                      // 16. Payment Reference / Transaction ID
    sanitizeCellValue(paymentMethod),                                   // 17. Payment Method
    dateStr,                                                            // 18. Registration Date
    timeStr                                                             // 19. Registration Time
  ];
}

class GoogleSheetsService {
  private inMemoryAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private cachedSpreadsheetId: string | null = null;

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
   * Find the existing "Payment Domain" spreadsheet in Google Drive or create it.
   */
  private async findOrCreateSpreadsheet(token: string): Promise<string> {
    if (this.cachedSpreadsheetId) {
      return this.cachedSpreadsheetId;
    }

    // 1. Search Google Drive for spreadsheet named 'Payment Domain'
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(
      SPREADSHEET_NAME
    )}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false&fields=files(id,name)`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        this.cachedSpreadsheetId = searchData.files[0].id;
        await this.ensureHeaders(token, this.cachedSpreadsheetId!);
        return this.cachedSpreadsheetId!;
      }
    }

    // 2. Create spreadsheet named "Payment Domain" with exact 19 columns
    const createUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: {
          title: SPREADSHEET_NAME
        },
        sheets: [
          {
            properties: {
              title: SHEET_TAB_NAME,
              gridProperties: {
                frozenRowCount: 1,
                columnCount: GOOGLE_SHEET_COLUMNS.length
              }
            },
            data: [
              {
                startRow: 0,
                startColumn: 0,
                rowData: [
                  {
                    values: GOOGLE_SHEET_COLUMNS.map(col => ({
                      userEnteredValue: { stringValue: col },
                      userEnteredFormat: {
                        textFormat: { bold: true },
                        backgroundColor: { red: 0.05, green: 0.35, blue: 0.45 }
                      }
                    }))
                  }
                ]
              }
            ]
          }
        ]
      })
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create Google Sheet: ${err}`);
    }

    const createData = await createRes.json();
    this.cachedSpreadsheetId = createData.spreadsheetId;
    return this.cachedSpreadsheetId!;
  }

  /**
   * Verify or populate the header row with the 19 approved columns.
   */
  private async ensureHeaders(token: string, spreadsheetId: string): Promise<void> {
    try {
      const getHeaderUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:S1`;
      const res = await fetch(getHeaderUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.values && data.values.length > 0 && data.values[0].length === GOOGLE_SHEET_COLUMNS.length) {
          return; // Headers already match
        }
      }

      // Write headers
      const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:S1?valueInputOption=USER_ENTERED`;
      await fetch(updateUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [Array.from(GOOGLE_SHEET_COLUMNS)]
        })
      });
    } catch (e) {
      console.warn('Could not verify/write headers:', e);
    }
  }

  /**
   * Synchronize a registration record to "Payment Domain".
   * Implements strict duplicate protection by searching for the Registration ID.
   * If found: updates the row in place (action: UPDATE).
   * If not found: appends a new row (action: APPEND).
   */
  public async syncRegistration(
    reg: Registration,
    tokenOverride?: string
  ): Promise<{
    success: boolean;
    action: 'APPEND' | 'UPDATE' | 'QUEUED';
    row?: number;
    error?: string;
  }> {
    const token = tokenOverride || this.getAccessToken();
    const rowValues = formatRegistrationToRow(reg);

    // If an external Google Apps Script Webhook URL is configured in process.env:
    const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL;
    if (appsScriptUrl) {
      try {
        const webhookRes = await fetch(appsScriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SYNC_BOOKING',
            sheetName: SPREADSHEET_NAME,
            registrationId: reg.registration_number,
            row: rowValues,
            columns: GOOGLE_SHEET_COLUMNS,
            timestamp: new Date().toISOString()
          })
        });
        if (webhookRes.ok) {
          db.logAudit({
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

    // Direct Google Sheets API v4 Integration
    if (!token) {
      // Token not available in current backend process memory.
      // Record locally in sync log so it will be synchronized on next admin sign-in or manual sync.
      db.logAudit({
        action: 'GOOGLE_SHEETS_SYNC_QUEUED',
        admin_id: 'system',
        entity_type: 'GOOGLE_SHEET',
        entity_id: reg.registration_number,
        new_value: {
          note: 'OAuth token awaiting admin session. Record validated and queued for Payment Domain sync.',
          status: reg.payment_status
        }
      });
      return { success: true, action: 'QUEUED' };
    }

    try {
      const spreadsheetId = await this.findOrCreateSpreadsheet(token);

      // Check Column A for existing Registration ID to prevent duplicates
      const colAUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:A`;
      const colARes = await fetch(colAUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      let existingRowIndex = -1;
      if (colARes.ok) {
        const colAData = await colARes.json();
        const rows: string[][] = colAData.values || [];
        for (let i = 0; i < rows.length; i++) {
          if (rows[i] && rows[i][0] === reg.registration_number) {
            existingRowIndex = i + 1; // 1-based index in Google Sheets
            break;
          }
        }
      }

      if (existingRowIndex > 0) {
        // UPDATE existing row in place (idempotent, prevents duplicates)
        const updateRange = `A${existingRowIndex}:S${existingRowIndex}`;
        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${updateRange}?valueInputOption=USER_ENTERED`;
        const updateRes = await fetch(updateUrl, {
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
          const err = await updateRes.text();
          throw new Error(`Failed to update existing row in Google Sheet: ${err}`);
        }

        db.logAudit({
          action: 'GOOGLE_SHEETS_ROW_UPDATED',
          admin_id: 'system',
          entity_type: 'GOOGLE_SHEET',
          entity_id: reg.registration_number,
          new_value: { row: existingRowIndex, payment_status: reg.payment_status }
        });

        return { success: true, action: 'UPDATE', row: existingRowIndex };
      } else {
        // APPEND new row
        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:S:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
        const appendRes = await fetch(appendUrl, {
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
          const err = await appendRes.text();
          throw new Error(`Failed to append row to Google Sheet: ${err}`);
        }

        db.logAudit({
          action: 'GOOGLE_SHEETS_ROW_APPENDED',
          admin_id: 'system',
          entity_type: 'GOOGLE_SHEET',
          entity_id: reg.registration_number,
          new_value: { payment_status: reg.payment_status }
        });

        return { success: true, action: 'APPEND' };
      }
    } catch (err: any) {
      console.error('Google Sheets sync error:', err.message);
      db.logAudit({
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
   * Sync all registrations in the database to the Google Sheet.
   */
  public async syncAll(tokenOverride?: string): Promise<{ total: number; synced: number; errors: number }> {
    const registrations = db.listRegistrations();
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
      sheetTab: SHEET_TAB_NAME,
      columnsCount: GOOGLE_SHEET_COLUMNS.length,
      columns: GOOGLE_SHEET_COLUMNS,
      isConnected: Boolean(this.getAccessToken()),
      tokenExpiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : null,
      cachedSpreadsheetId: this.cachedSpreadsheetId,
      webhookConfigured: Boolean(process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL)
    };
  }
}

export const googleSheetsService = new GoogleSheetsService();
