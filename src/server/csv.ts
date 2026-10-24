/**
 * One CSV cell. Long digit strings (mobile numbers, UTRs) stay text in Excel instead of becoming 9.19E+11,
 * and values starting with = + - @ (spreadsheet formulas) are neutralised.
 */
export function escapeCsv(val: unknown) {
  let s = String(val ?? '');
  if (/^\+?\d{10,}$/.test(s)) return `="${s}"`;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** UTF-8 BOM + CRLF so Excel opens the file with ₹ and other characters intact */
export const toCsv = (headers: string[], rows: unknown[][]) =>
  '﻿' + [headers.map(escapeCsv).join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\r\n') + '\r\n';
