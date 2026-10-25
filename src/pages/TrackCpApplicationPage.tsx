import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, Handshake, Search, AlertCircle } from 'lucide-react';
import { ApprovalCertificate, CpCertificate as Certificate, longDate } from '../components/CpApprovalCertificate.js';
import { CP_REFERENCE_EXAMPLE, CP_REFERENCE_REGEX } from '../cpOptions.js';

interface TrackCpApplicationPageProps {
  onNavigateHome: () => void;
}

type CpStatus = 'PENDING' | 'UNDER_REVIEW' | 'ADDITIONAL_INFO_REQUIRED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

interface TrackedApplication {
  reference: string;
  applicant: string;
  status: CpStatus;
  status_label: string;
  submitted_on: string | null;
  last_updated_on: string | null;
  projects_of_interest: string[];
  next_steps: string[];
  cp_id: string | null;
  approved_projects: string[];
  approved_on: string | null;
  certificate_available: boolean;
  /** Approved, but the reference is in the older format: the partner team issues the certificate */
  certificate_from_partner_team: boolean;
}


const STATUS_STYLE: Record<CpStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  UNDER_REVIEW: 'bg-sky-50 text-sky-800 border-sky-200',
  ADDITIONAL_INFO_REQUIRED: 'bg-violet-50 text-violet-800 border-violet-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-800 border-rose-200',
  SUSPENDED: 'bg-slate-100 text-slate-700 border-slate-300'
};
const inputCls = 'w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f5973]';

// Public page /track-cp-application: status of a Channel Partner application by its reference number.
// Shows limited, non-sensitive information; approved partners can print / save their approval certificate as PDF.
export const TrackCpApplicationPage: React.FC<TrackCpApplicationPageProps> = ({ onNavigateHome }) => {
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [application, setApplication] = useState<TrackedApplication | null>(null);
  const [certError, setCertError] = useState('');
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const printWhenReady = useRef(false);

  // Reference can be passed in the link, e.g. from the registration confirmation: /track-cp-application?ref=CP-GRG-...
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) setReference(ref.toUpperCase());
  }, []);
  useEffect(() => {
    if (certificate && printWhenReady.current) {
      printWhenReady.current = false;
      setTimeout(() => window.print(), 100);
    }
  }, [certificate]);

  const track = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const ref = reference.trim().toUpperCase();
    setError(''); setApplication(null); setCertificate(null); setCertError('');
    if (!CP_REFERENCE_REGEX.test(ref)) return setError(`Enter your full application reference, e.g. ${CP_REFERENCE_EXAMPLE}.`);
    setBusy(true);
    try {
      const res = await fetch(`/api/cp/track/${encodeURIComponent(ref)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The application could not be found.');
      setApplication(data.application);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const getCertificate = async () => {
    if (busy || !application) return;
    if (certificate) { window.print(); return; }
    setCertError('');
    setBusy(true);
    try {
      const res = await fetch(`/api/cp/track/${encodeURIComponent(application.reference)}/certificate`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The certificate could not be loaded.');
      printWhenReady.current = true;
      setCertificate(data.certificate);
    } catch (err: any) {
      setCertError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-slate-50">
      <section className="no-print bg-gradient-to-b from-[#0f5973] to-[#083545] text-white px-4 sm:px-6 pt-10 pb-16 sm:pt-12 sm:pb-20">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-amber-300 text-xs font-semibold mb-4">
            <Handshake className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Channel Partner Applications</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold font-['Playfair_Display'] leading-tight">Track CP Application</h1>
          <p className="mt-3 text-sm sm:text-base text-teal-100/90">Enter your application reference number to see the current status of your Channel Partner application.</p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 -mt-8 pb-16 space-y-4">
        <form onSubmit={track} noValidate className="no-print bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-4">
          <div>
            <label htmlFor="track-ref" className="block text-xs font-semibold text-slate-700 mb-1">Application Reference Number</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input id="track-ref" value={reference} onChange={e => setReference(e.target.value.toUpperCase())} placeholder={CP_REFERENCE_EXAMPLE} maxLength={40} autoComplete="off"
                aria-invalid={Boolean(error)} aria-describedby={error ? 'track-error' : undefined} className={`${inputCls} font-mono uppercase flex-1`} />
              <button type="submit" disabled={busy} className="px-6 py-2.5 bg-[#b87e2b] hover:bg-[#a66f24] text-white text-xs sm:text-sm font-bold uppercase tracking-wider rounded-lg shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60">
                {busy && !application ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" aria-hidden="true" /> : <Search className="w-4 h-4" aria-hidden="true" />}
                <span>Track Application</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Shown on your confirmation screen and in the acknowledgement e-mail. Enter it in full, including the last four characters. Keep it private: anyone with your reference can see this status and your certificate.</p>
          </div>
          {error && <p id="track-error" role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-start gap-2"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />{error}</p>}
          <p className="text-[11px] text-slate-500">Not applied yet? <a href="/cp-registration" className="text-[#0f5973] underline">Become a Channel Partner</a></p>
        </form>

        {application && (
          <div className="no-print bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-slate-500">{application.reference}</p>
                <h2 className="text-lg font-bold text-slate-900" title="Shown partially for privacy">Applicant: {application.applicant}</h2>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold border ${STATUS_STYLE[application.status]}`} data-testid="cp-status">{application.status_label}</span>
            </div>
            <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Submitted</dt><dd className="text-slate-800">{longDate(application.submitted_on)}</dd></div>
              <div><dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Last updated</dt><dd className="text-slate-800">{longDate(application.last_updated_on)}</dd></div>
              <div className="sm:col-span-2"><dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Projects of interest</dt><dd className="text-slate-800">{application.projects_of_interest.join(', ') || '—'}</dd></div>
            </dl>

            {application.cp_id && (
              <div className="mt-5 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Channel Partner ID</p>
                <p className="text-2xl font-extrabold font-mono text-emerald-900" data-testid="cp-id">{application.cp_id}</p>
                {application.approved_projects.length > 0 && <p className="text-xs text-emerald-800 mt-1">Approved projects: {application.approved_projects.join(', ')} · approved on {longDate(application.approved_on)}</p>}
              </div>
            )}

            <div className="mt-5">
              <h3 className="text-xs font-bold text-[#0f5973] uppercase tracking-wide mb-2">Next steps</h3>
              <ul className="space-y-2">
                {application.next_steps.map(s => (
                  <li key={s} className="text-sm text-slate-700 flex gap-2"><CheckCircle2 className="w-4 h-4 text-[#0f5973] shrink-0 mt-0.5" aria-hidden="true" /><span>{s}</span></li>
                ))}
              </ul>
            </div>

            {application.certificate_available && (
              <div className="mt-6 border-t border-slate-100 pt-5 space-y-3">
                {certError && <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{certError}</p>}
                <button type="button" onClick={getCertificate} disabled={busy} className="w-full px-5 py-3 bg-[#b87e2b] hover:bg-[#a66f24] text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60">
                  <Download className="w-4 h-4" aria-hidden="true" /> {certificate ? 'Print / Save as PDF' : 'Download Approval Certificate'}
                </button>
                <p className="text-[11px] text-slate-500">The certificate opens in your browser's print window. Choose "Save as PDF" to download it.</p>
              </div>
            )}
            {application.certificate_from_partner_team && (
              <div className="mt-6 border-t border-slate-100 pt-5" data-testid="cert-partner-team">
                <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    <b>Approval certificate:</b> for your security, certificates for older application references (without the last four
                    characters) cannot be downloaded with the reference alone. Please contact our partner team, quoting your application
                    reference: they will verify your details and send you your certificate.
                  </span>
                </p>
              </div>
            )}
          </div>
        )}

        {certificate && <ApprovalCertificate certificate={certificate} />}

        <div className="no-print text-center">
          <button type="button" onClick={onNavigateHome} className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer">Back to home</button>
        </div>
      </div>
    </div>
  );
};
