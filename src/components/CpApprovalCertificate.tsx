import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BrandLogo } from './BrandLogo.js';

// Channel Partner approval certificate: shared by the public Track CP Application page and the admin panel.
export interface CpCertificate {
  certificate_number: string;
  cp_id: string;
  application_ref: string;
  full_name: string;
  company_name: string | null;
  approved_projects: string[];
  approved_at: string;
  issued_at: string;
  verification_code: string;
}

/** "2026-10-24" (India date from the server) or an ISO timestamp -> "24 October 2026" */
export const longDate = (value?: string | null) => {
  if (!value) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long' });
};

const Section: React.FC<{ title: string; rows: [string, React.ReactNode][] }> = ({ title, rows }) => (
  <div className="mb-4">
    <div className="bg-[#0f5973] text-white font-bold text-xs uppercase px-3 py-1.5 tracking-wide">{title}</div>
    <div className="border border-slate-300 border-t-0 divide-y divide-slate-200">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-1 sm:grid-cols-4 px-3 py-1.5 items-center">
          <span className="font-semibold text-slate-600 sm:col-span-1">{label}</span>
          <span className="font-medium text-slate-900 sm:col-span-3">{value}</span>
        </div>
      ))}
    </div>
  </div>
);

// Printable approval certificate, laid out like the verified payment receipt (shown on screen and printed / saved as
// PDF via the browser). Only certificate facts: never PAN, mobile, e-mail, address or admin notes.
export const ApprovalCertificate: React.FC<{ certificate: CpCertificate }> = ({ certificate: c }) => {
  const issued = new Date(c.issued_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' });
  return (
    <article className="cp-certificate bg-white border border-slate-300 shadow-md p-6 sm:p-10 font-sans text-slate-800 text-xs sm:text-sm print:shadow-none"
      aria-label="Channel Partner Approval Certificate" data-testid="cp-certificate">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-3">
        <BrandLogo />
        <div className="text-left sm:text-right">
          <h1 className="text-lg sm:text-xl font-bold uppercase tracking-wide text-[#0f5973]">Channel Partner Approval Certificate</h1>
          <p className="text-xs sm:text-sm font-semibold text-[#b87e2b]">Garg Realty Group · Approved Channel Partner</p>
          <p className="text-[11px] text-slate-600 font-mono">Certificate No: {c.certificate_number} · Verification Code: {c.verification_code}</p>
          <p className="text-[11px] text-slate-600">Issued on {issued} (IST)</p>
        </div>
      </div>

      <div className="h-[2px] w-full bg-[#b87e2b] mb-4"></div>

      <div className="mb-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <p className="flex-1 text-slate-700 leading-relaxed">
          This is to certify that <b className="text-slate-900">{c.full_name}</b>
          {c.company_name && <> of <b className="text-slate-900">{c.company_name}</b></>} has been approved as a Channel Partner of
          Garg Realty Group with effect from <b className="text-slate-900">{longDate(c.approved_at)}</b>.
        </p>
        <div className="shrink-0 self-start sm:self-center rotate-[-6deg] border-2 border-emerald-600 text-emerald-700 px-3 py-1 rounded text-xs font-black tracking-widest uppercase bg-emerald-50 pointer-events-none select-none">
          ✓ Approved Channel Partner
        </div>
      </div>

      <Section title="1. Channel Partner Details" rows={[
        ['Partner Name', c.full_name],
        ...(c.company_name ? [['Company / Firm', c.company_name] as [string, React.ReactNode]] : []),
        ['Channel Partner ID', <span className="font-mono font-bold text-[#0f5973] text-sm sm:text-base">{c.cp_id}</span>]
      ]} />

      <Section title="2. Approval Details" rows={[
        ['Application Reference', <span className="font-mono">{c.application_ref}</span>],
        ['Approved Project(s)', c.approved_projects.join(', ') || '—'],
        ['Approval Date', longDate(c.approved_at)]
      ]} />

      <Section title="3. Certificate Verification" rows={[
        ['Certificate Number', <span className="font-mono">{c.certificate_number}</span>],
        ['Verification Code', <span className="font-mono font-bold">{c.verification_code}</span>],
        ['Issued On', `${issued} (IST)`]
      ]} />

      <div className="mb-6 border border-slate-300 p-3">
        <p className="text-xs text-slate-700 mb-6">
          This system-generated certificate confirms the Channel Partner's approval as on the date of issue. Its details can be
          confirmed with the Garg Realty Group partner team using the verification code.
        </p>
        <div className="grid grid-cols-2 gap-8 pt-4 border-t border-slate-200">
          <div>
            <p className="text-xs text-slate-500 font-semibold mb-2">Channel Partner</p>
            <div className="h-10 border-b border-dashed border-slate-400 flex items-end pb-1 font-serif text-slate-800 text-sm italic">{c.full_name}</div>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-semibold mb-2">Authorized Officer</p>
            <div className="h-10 border-b border-dashed border-slate-400 flex items-end pb-1 font-serif text-[#0f5973] text-sm font-semibold">Garg Realty Group</div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-2">
        <div className="font-mono text-[11px] text-slate-400">CP ID: {c.cp_id} · Ref: {c.application_ref}</div>
        <div className="font-semibold text-slate-700">Thanks & Regards | Garg Residency Private Limited</div>
      </div>
    </article>
  );
};

// ---------- certificate-only printing (Print → Save as PDF) ----------
const PRINT_CLASS = 'printing-cp-certificate';

/** Copy of the certificate rendered as a direct child of <body>: hidden on screen, the only thing printed while printing */
export const CertificatePrintCopy: React.FC<{ certificate: CpCertificate }> = ({ certificate }) =>
  createPortal(<div className="cp-certificate-print-root"><ApprovalCertificate certificate={certificate} /></div>, document.body);

/**
 * While <body> has PRINT_CLASS, index.css prints ONLY the certificate print copy (on an A4 page); all other page content
 * is removed from the printout. The class is removed only when the browser fires 'afterprint' — never on a timer,
 * because some browsers return from window.print() before the print preview is drawn, and never on a
 * matchMedia('print') change, because Chrome fires a spurious "matches: false" change after 'beforeprint' but before the
 * page is laid out (that printed the whole page). If no signal ever arrives the class stays: that only affects printing
 * and can only ever print the certificate (or nothing). Call endPrint when leaving the certificate.
 */
export function useCertificatePrint() {
  const cleanup = useRef<(() => void) | null>(null);
  const endPrint = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    document.body.classList.remove(PRINT_CLASS);
  }, []);
  const startPrint = useCallback(async () => {
    // The logo must have loaded, or the PDF would be saved without it
    const images = [...document.querySelectorAll<HTMLImageElement>('.cp-certificate-print-root img')];
    await Promise.all(images.map(img => img.decode().catch(() => undefined)));
    endPrint(); // a repeated click never stacks listeners
    window.addEventListener('afterprint', endPrint);
    cleanup.current = () => window.removeEventListener('afterprint', endPrint);
    document.body.classList.add(PRINT_CLASS);
    window.print();
  }, [endPrint]);
  // Leaving the page: never leave the print state behind
  useEffect(() => endPrint, [endPrint]);
  return { startPrint, endPrint };
}
