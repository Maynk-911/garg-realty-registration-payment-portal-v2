/**
 * Google Sheets connection checklist.
 *
 *   npm run sheets:check                  read-only: credentials, sign-in, spreadsheet access, tab
 *   npm run sheets:check -- --test-row    also appends one clearly marked TEST row (delete it in the sheet afterwards)
 *
 * Prints what is wrong and what to do about it. Never prints the private key.
 */
import 'dotenv/config';
import fs from 'fs';
import { googleSheetsService, GOOGLE_SHEET_COLUMNS } from '../src/server/googleSheetsService.js';
import { UNIT_OPTIONS } from '../src/bookingOptions.js';
import { Registration } from '../src/types.js';

async function main() {
  console.log('\nGoogle Sheets connection check');
  console.log('------------------------------');
  console.log(fs.existsSync('.env') ? '[ OK ] .env file found' : '[FAIL] No .env file in the project folder. Copy .env.example to .env and fill in the Google settings.');

  const report = await googleSheetsService.diagnose();
  for (const step of report.steps) {
    console.log(`${step.ok ? '[ OK ]' : '[FAIL]'} ${step.step}: ${step.detail}`);
  }

  if (!report.ok) {
    console.log('\nResult: NOT READY. Fix the first [FAIL] line above, then run this check again.\n');
    process.exitCode = 1;
    return;
  }

  if (!process.argv.includes('--test-row')) {
    console.log('\nResult: READY. Bookings will be appended to this spreadsheet.');
    console.log('To also prove writing works, run:  npm run sheets:check -- --test-row\n');
    return;
  }

  const now = new Date().toISOString();
  const testBooking = {
    registration_number: `TEST-${now.replace(/\D/g, '').slice(0, 14)}`,
    full_name: 'TEST ROW - safe to delete',
    mobile: '0000000000',
    email: 'test@example.com',
    selected_plan: UNIT_OPTIONS[0],
    units_count: 1,
    token_amount: 51000,
    total_payable: 51000,
    utr_number: 'TEST000000',
    payment_status: 'PENDING',
    payment_submitted_at: now,
    created_at: now
  } as Registration;

  const result = await googleSheetsService.syncRegistration(testBooking);
  if (result.success && result.action !== 'QUEUED') {
    console.log(`[ OK ] Test row appended (Booking ID ${testBooking.registration_number}, ${GOOGLE_SHEET_COLUMNS.length} columns).`);
    console.log('\nResult: READY and writing works. Open the spreadsheet to see the row, then delete it.\n');
  } else {
    console.log(`[FAIL] Writing the test row failed: ${result.error || 'no credentials available'}`);
    console.log('\nResult: NOT READY.\n');
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Check failed unexpectedly:', err.message);
  process.exitCode = 1;
});
