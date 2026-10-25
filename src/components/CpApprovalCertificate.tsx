import React from 'react';
import { Award } from 'lucide-react';
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

// Printable approval certificate (shown on screen and printed / saved as PDF via the browser)
export const ApprovalCertificate: React.FC<{ certificate: CpCertificate }> = ({ certificate: c }) => (
  <article className="bg-white rounded-2xl border-4 border-double border-[#b87e2b] shadow-sm p-6 sm:p-10 text-center print:shadow-none print:rounded-none" aria-label="Channel Partner Approval Certificate" data-testid="cp-certificate">
    <div className="flex justify-center"><BrandLogo size="md" /></div>
    <Award className="w-10 h-10 text-[#b87e2b] mx-auto mt-4" aria-hidden="true" />
    <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold text-[#0f5973] font-['Playfair_Display']">Channel Partner Approval Certificate</h2>
    <p className="mt-5 text-sm text-slate-700">This is to certify that</p>
    <p className="mt-1 text-xl font-bold text-slate-900">{c.full_name}</p>
    {c.company_name && <p className="text-sm text-slate-700">{c.company_name}</p>}
    <p className="mt-3 text-sm text-slate-700 max-w-lg mx-auto leading-relaxed">
      has been approved as a channel partner of Garg Realty Group with effect from {longDate(c.approved_at)}.
    </p>
    <div className="mt-6 inline-block px-6 py-3 rounded-xl bg-slate-50 border border-slate-200">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Channel Partner ID</p>
      <p className="text-2xl font-extrabold font-mono text-[#0f5973]">{c.cp_id}</p>
    </div>
    <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left text-xs max-w-lg mx-auto">
      <div><dt className="text-slate-400 uppercase tracking-wide font-semibold">Approved projects</dt><dd className="text-slate-800">{c.approved_projects.join(', ')}</dd></div>
      <div><dt className="text-slate-400 uppercase tracking-wide font-semibold">Application reference</dt><dd className="text-slate-800 font-mono">{c.application_ref}</dd></div>
      <div><dt className="text-slate-400 uppercase tracking-wide font-semibold">Certificate number</dt><dd className="text-slate-800 font-mono">{c.certificate_number}</dd></div>
      <div><dt className="text-slate-400 uppercase tracking-wide font-semibold">Verification code</dt><dd className="text-slate-800 font-mono">{c.verification_code}</dd></div>
    </dl>
    <p className="mt-6 text-[10px] text-slate-500 max-w-lg mx-auto leading-relaxed">
      Issued on {new Date(c.issued_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'long', timeStyle: 'short' })} (IST) by Garg Realty Group | Garg Residency
      Private Limited. This is a system-generated certificate; its details can be confirmed with our partner team using the verification code.
    </p>
  </article>
);
