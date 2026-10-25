import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Download, Eye, FileText, Mail, Printer, RefreshCw, Search, Users, X
} from 'lucide-react';
import { CP_ACTIONS, CP_ACTIONS_NEEDING_REASON, CP_STATUSES, CP_STATUS_LABELS, CpAction, CpStatus } from '../cpOptions.js';
import { ApprovalCertificate, CpCertificate } from './CpApprovalCertificate.js';

interface AdminCpPanelProps {
  token: string;
  adminRole?: string;
  onUnauthorized: () => void;
}

interface ListRow {
  id: string; application_ref: string; full_name: string; mobile: string; company_name?: string; partner_type_label: string;
  city: string; state: string; projects: string[]; created_at: string; status: CpStatus;
}

const STATUS_STYLE: Record<CpStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  UNDER_REVIEW: 'bg-sky-50 text-sky-800 border-sky-200',
  ADDITIONAL_INFO_REQUIRED: 'bg-violet-50 text-violet-800 border-violet-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-800 border-rose-200',
  SUSPENDED: 'bg-slate-100 text-slate-700 border-slate-300'
};
const NOTIFICATION_LABEL: Record<string, { text: string; cls: string }> = {
  SENT: { text: 'Sent (accepted by mail server)', cls: 'text-emerald-700' },
  FAILED: { text: 'Failed', cls: 'text-rose-700' },
  PENDING: { text: 'Not sent yet', cls: 'text-amber-700' },
  NOT_CONFIGURED: { text: 'Not sent — e-mail not configured', cls: 'text-amber-700' },
  NO_RECIPIENT: { text: 'Not sent — no e-mail address', cls: 'text-slate-500' }
};
const EVENT_LABEL: Record<string, string> = {
  SUBMITTED: 'Acknowledgement to applicant', SUBMITTED_INTERNAL: 'New-application alert to team', APPROVED: 'Approval & CP ID to applicant',
  REJECTED: 'Rejection notice to applicant', INFO_REQUESTED: 'Information request to applicant'
};

const ist = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—');
const inputCls = 'px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-[#0f5973]';
const StatusBadge = ({ status }: { status: CpStatus }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${STATUS_STYLE[status]}`}>{CP_STATUS_LABELS[status]}</span>
);
const Field = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div>
    <dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</dt>
    <dd className="text-xs text-slate-800 mt-0.5 break-words whitespace-pre-line">{value === undefined || value === null || value === '' ? '—' : value}</dd>
  </div>
);
const Card = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="bg-white rounded-xl border border-slate-200 p-5">
    <div className="flex items-center justify-between gap-2 mb-3">
      <h4 className="text-xs font-bold text-[#0f5973] uppercase tracking-wide">{title}</h4>
      {right}
    </div>
    {children}
  </section>
);

// Admin → CP / Broker Management: summary, searchable list, application detail and the approval workflow.
export const AdminCpPanel: React.FC<AdminCpPanelProps> = ({ token, adminRole, onUnauthorized }) => {
  const [summary, setSummary] = useState<{ total: number; counts: Record<CpStatus, number>; emailConfigured: boolean } | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [filters, setFilters] = useState({ search: '', status: '', projectId: '', from: '', to: '', sort: 'created_at', direction: 'desc' });
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ action: CpAction } | null>(null);
  const [reason, setReason] = useState('');
  const [approvedProjects, setApprovedProjects] = useState<string[]>([]);
  const [ackMissingDocs, setAckMissingDocs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pan, setPan] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<CpCertificate | null>(null);

  const api = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    if (res.status === 401) { onUnauthorized(); throw new Error('Session expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
    return data;
  };

  const query = (extra: Record<string, string | number> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v !== '' && v !== undefined) p.set(k, String(v));
    return p.toString();
  };

  const loadSummary = () => api('/api/admin/cp/summary').then(setSummary).catch(e => setError(e.message));
  const loadList = async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const data = await api(`/api/admin/cp/applications?${query({ page, pageSize: 20 })}`);
      setRows(data.applications);
      setPagination(data.pagination);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ---------- certificate printing ----------
  // While <body> has PRINT_CLASS, index.css prints ONLY the certificate copy rendered at the end of <body> (all other
  // page content is removed from the printout). The class is removed only when the browser fires 'afterprint' —
  // never on a timer, because some browsers return from window.print() before the print preview is drawn, and never on
  // a matchMedia('print') change, because Chrome fires a spurious "matches: false" change after 'beforeprint' but
  // before the page is laid out (that printed the whole admin page). If no signal ever arrives the class stays: that
  // only affects printing and can only ever print the certificate (or nothing), never admin data.
  const PRINT_CLASS = 'printing-cp-certificate';
  const printCleanup = useRef<(() => void) | null>(null);
  const endCertificatePrint = () => {
    printCleanup.current?.();
    printCleanup.current = null;
    document.body.classList.remove(PRINT_CLASS);
  };
  const beginCertificatePrint = () => {
    endCertificatePrint(); // a repeated click never stacks listeners
    window.addEventListener('afterprint', endCertificatePrint);
    printCleanup.current = () => window.removeEventListener('afterprint', endCertificatePrint);
    document.body.classList.add(PRINT_CLASS);
    window.print();
  };
  // Leaving the CP tab or the admin dashboard: never leave the print state behind
  useEffect(() => () => endCertificatePrint(), []);

  useEffect(() => {
    loadSummary();
    fetch('/api/cp/config').then(r => r.json()).then(c => setProjects(c.projects || [])).catch(() => {});
  }, []);
  useEffect(() => { loadList(1); }, [filters]);

  const openDetail = async (id: string) => {
    setMessage(null);
    setPan(null);
    endCertificatePrint();
    setCertificate(null);
    try {
      setDetail(await api(`/api/admin/cp/applications/${id}`));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const openDialog = (action: CpAction) => {
    setReason('');
    setAckMissingDocs(false);
    setApprovedProjects(detail?.application.projects.map((p: any) => p.id) || []);
    setDialog({ action });
  };

  const runAction = async () => {
    if (!dialog || !detail || busy) return;
    setBusy(true);
    try {
      const data = await api(`/api/admin/cp/applications/${detail.application.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: dialog.action, reason, approvedProjectIds: approvedProjects, acknowledgeMissingDocuments: ackMissingDocs })
      });
      setDetail(data);
      setDialog(null);
      const latest = data.notifications[data.notifications.length - 1];
      const mail = ['APPROVE', 'REJECT', 'REQUEST_INFO'].includes(dialog.action) && latest
        ? ` E-mail: ${NOTIFICATION_LABEL[latest.status]?.text || latest.status}.` : '';
      setMessage({ ok: true, text: `${CP_ACTIONS[dialog.action].label} — saved.${data.partner && dialog.action === 'APPROVE' ? ` CP ID ${data.partner.cp_id} issued.` : ''}${mail}` });
      loadSummary();
      loadList(pagination.page);
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
      setDialog(null);
    } finally {
      setBusy(false);
    }
  };

  const retryNotification = async (id: string) => {
    try {
      const data = await api(`/api/admin/cp/notifications/${id}/retry`, { method: 'POST' });
      setMessage({ ok: data.success, text: `E-mail ${NOTIFICATION_LABEL[data.notification.status]?.text.toLowerCase() || data.notification.status}.` });
      openDetail(detail.application.id);
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
  };

  const openDocument = async (doc: any) => {
    // Fetched with the admin token and shown from memory: the file never has a shareable URL
    const win = window.open('', '_blank');
    try {
      const res = await fetch(`/api/admin/cp/applications/${detail.application.id}/documents/${doc.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { win?.close(); onUnauthorized(); return; }
      if (!res.ok) throw new Error('The document could not be opened');
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      win?.close();
      setMessage({ ok: false, text: e.message });
    }
  };

  // Certificate issued by the partner team (e.g. for older references that cannot download it themselves); recorded
  const printCertificate = async () => {
    try {
      const cert = certificate || (await api(`/api/admin/cp/applications/${detail.application.id}/certificate`)).certificate;
      setCertificate(cert);
      // Wait until React has rendered the certificate's print copy, then print
      requestAnimationFrame(() => requestAnimationFrame(beginCertificatePrint));
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
  };

  const revealPan = async () => {
    try { setPan((await api(`/api/admin/cp/applications/${detail.application.id}/pan`)).pan_number); } catch (e: any) { setMessage({ ok: false, text: e.message }); }
  };

  const exportCsv = async () => {
    try {
      const res = await fetch(`/api/admin/cp/export-csv?${query()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { onUnauthorized(); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'channel-partners.csv';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const sortBy = (column: string) => setFilters(f => ({ ...f, sort: column, direction: f.sort === column && f.direction === 'desc' ? 'asc' : 'desc' }));
  const SortHeader = ({ column, children }: { column: string; children: React.ReactNode }) => (
    <th className="px-3 py-2.5 font-semibold">
      <button type="button" onClick={() => sortBy(column)} className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer">
        {children}
        {filters.sort === column && (filters.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
      </button>
    </th>
  );

  const cards: { key: CpStatus | ''; label: string; value?: number }[] = [
    { key: '', label: 'Total Applications', value: summary?.total },
    { key: 'PENDING', label: 'Pending', value: summary?.counts.PENDING },
    { key: 'UNDER_REVIEW', label: 'Under Review', value: summary?.counts.UNDER_REVIEW },
    { key: 'ADDITIONAL_INFO_REQUIRED', label: 'Info Requested', value: summary?.counts.ADDITIONAL_INFO_REQUIRED },
    { key: 'APPROVED', label: 'Approved Partners', value: summary?.counts.APPROVED },
    { key: 'REJECTED', label: 'Rejected', value: summary?.counts.REJECTED },
    { key: 'SUSPENDED', label: 'Suspended', value: summary?.counts.SUSPENDED }
  ];

  // ---------------- DETAIL ----------------
  if (detail) {
    const a = detail.application;
    const actions: CpAction[] = detail.allowedActions.filter((k: CpAction) => k !== 'REACTIVATE' || adminRole === 'SUPER_ADMIN');
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => { endCertificatePrint(); setCertificate(null); setDetail(null); setMessage(null); }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> Back to applications
          </button>
          <button type="button" onClick={() => openDetail(a.id)} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-slate-500">{a.application_ref}</p>
            <h3 className="text-lg font-bold text-slate-900">{a.full_name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <StatusBadge status={a.status} />
              <span>{a.partner_type_label}{a.company_name ? ` · ${a.company_name}` : ''}</span>
              <span>· Submitted {ist(a.created_at)}</span>
            </div>
            {detail.partner && (
              <p className="mt-2 text-xs">
                <span className="text-slate-500">CP ID:</span>{' '}
                <span className="font-mono font-bold text-[#0f5973]">{detail.partner.cp_id}</span>{' '}
                <span className={`ml-1 text-[10px] font-bold ${detail.partner.status === 'ACTIVE' ? 'text-emerald-700' : 'text-slate-600'}`}>{detail.partner.status}</span>
              </p>
            )}
            {a.status === 'APPROVED' && detail.partner?.status === 'ACTIVE' && (
              <button type="button" onClick={printCertificate} className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-[#b87e2b]/50 text-[#7a4e17] rounded-lg hover:bg-amber-50 cursor-pointer">
                <Printer className="w-3.5 h-3.5" /> Print Approval Certificate
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.length === 0 && <span className="text-xs text-slate-400">No further actions for this status.</span>}
            {actions.map(k => (
              <button
                key={k}
                type="button"
                onClick={() => openDialog(k)}
                className={`px-3.5 py-2 text-xs font-bold rounded-lg border cursor-pointer ${
                  k === 'APPROVE' || k === 'REACTIVATE' ? 'bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700'
                    : k === 'REJECT' || k === 'SUSPEND' ? 'bg-white border-rose-300 text-rose-700 hover:bg-rose-50'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {CP_ACTIONS[k].label}
              </button>
            ))}
          </div>
        </div>

        {message && (
          <div className={`p-3 rounded-lg text-xs border ${message.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>{message.text}</div>
        )}
        {certificate && (
          <div className="space-y-2">
            <p className="text-[11px] text-slate-500">Approval certificate (issued by the partner team; recorded in the audit trail). Send it only after verifying the partner. Use "Save as PDF" in the print window.</p>
            <div className="cp-certificate-preview"><ApprovalCertificate certificate={certificate} /></div>
            {/* Print copy: a direct child of <body>, hidden on screen; the only thing printed while PRINT_CLASS is set */}
            {createPortal(<div className="cp-certificate-print-root"><ApprovalCertificate certificate={certificate} /></div>, document.body)}
          </div>
        )}
        {a.info_request_message && a.status === 'ADDITIONAL_INFO_REQUIRED' && (
          <div className="p-3 rounded-lg text-xs border bg-violet-50 border-violet-200 text-violet-900 whitespace-pre-line"><b>Information requested:</b> {a.info_request_message}</div>
        )}
        {a.decision_reason && ['REJECTED'].includes(a.status) && (
          <div className="p-3 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-900 whitespace-pre-line"><b>Rejection reason:</b> {a.decision_reason}</div>
        )}
        {detail.partner?.status === 'SUSPENDED' && (
          <div className="p-3 rounded-lg text-xs border bg-slate-100 border-slate-300 text-slate-800 whitespace-pre-line">
            <b>Suspended</b> {ist(detail.partner.suspended_at)} by {detail.partner.suspended_by}: {detail.partner.suspension_reason}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Personal Information">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Full Name" value={a.full_name} />
              <Field label="Mobile" value={<a className="text-[#0f5973] underline" href={`tel:${a.mobile}`}>{a.mobile}</a>} />
              <Field label="WhatsApp" value={a.whatsapp} />
              <Field label="E-mail" value={a.email ? <a className="text-[#0f5973] underline" href={`mailto:${a.email}`}>{a.email}</a> : undefined} />
              <Field label="Date of Birth" value={a.date_of_birth} />
            </dl>
          </Card>
          <Card title="Professional Information">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Partner Type" value={a.partner_type_label} />
              <Field label="Company / Firm" value={a.company_name} />
              <Field label="Experience" value={`${a.years_experience} year${a.years_experience === 1 ? '' : 's'}`} />
              <Field label="Sales Agents" value={a.sales_agents} />
              <div className="col-span-2"><Field label="Existing Business" value={a.existing_business} /></div>
              <Field label="Website" value={a.website ? <a className="text-[#0f5973] underline" href={a.website} target="_blank" rel="noopener noreferrer nofollow">{a.website}</a> : undefined} />
              <Field label="LinkedIn" value={a.linkedin ? <a className="text-[#0f5973] underline" href={a.linkedin} target="_blank" rel="noopener noreferrer nofollow">{a.linkedin}</a> : undefined} />
            </dl>
          </Card>
          <Card title="Address">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="City" value={a.city} />
              <Field label="State" value={a.state} />
              <Field label="PIN Code" value={a.pincode} />
              <Field label="Country" value={a.country} />
              <div className="col-span-2"><Field label="Full Address" value={a.address} /></div>
            </dl>
          </Card>
          <Card title="Business & Tax Information">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="PAN" value={a.has_pan ? (
                <span className="font-mono">{pan || a.pan_masked}{!pan && (
                  <button type="button" onClick={revealPan} className="ml-2 text-[10px] font-sans font-semibold text-[#0f5973] underline cursor-pointer">Show (logged)</button>
                )}</span>
              ) : undefined} />
              <Field label="GSTIN" value={a.gst_number && (
                <span className="font-mono">{a.gst_number}
                  {a.gst_pan_check && <span className={`ml-2 font-sans text-[10px] font-semibold ${a.gst_pan_check === 'MATCH' ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {a.gst_pan_check === 'MATCH' ? 'PAN in GSTIN matches' : 'PAN in GSTIN differs'}
                  </span>}
                </span>
              )} />
              <Field label="RERA Number" value={a.rera_number} />
              <Field label="RERA State" value={a.rera_state} />
              <Field label="Business Registration No." value={a.business_registration_number} />
            </dl>
            <p className="mt-3 text-[10px] text-slate-400">Formats were checked automatically. Verify numbers against the documents or the issuing portal before approving.</p>
          </Card>
          <Card title="Projects & Additional Information">
            <dl className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Field label="Interested Projects" value={a.projects.map((p: any) => p.name).join(', ')} /></div>
              <Field label="Expected Monthly Leads" value={a.expected_monthly_leads} />
              <Field label="Preferred Locations" value={a.preferred_locations} />
              <Field label="Heard About Us" value={a.heard_from} />
              <Field label="Referral Code" value={a.referral_code} />
              <div className="col-span-2"><Field label="Previous Experience" value={a.previous_experience} /></div>
              <div className="col-span-2"><Field label="Comments" value={a.comments} /></div>
            </dl>
          </Card>
          <Card title="Declarations">
            <dl className="grid grid-cols-2 gap-3">
              <Field label="All declarations accepted" value={ist(a.declarations_accepted_at)} />
              <Field label="Declaration version" value={a.declaration_version} />
              <Field label="Submitted from IP" value={a.submitted_from_ip} />
            </dl>
          </Card>
        </div>

        <Card title={`Documents (${detail.documents.length})`}>
          {detail.missingRequiredDocuments.length > 0 && (
            <p className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Missing required: {detail.missingRequiredDocuments.map((d: any) => d.label).join(', ')}
            </p>
          )}
          {detail.documents.length === 0 ? (
            <p className="text-xs text-slate-400">No documents were uploaded with this application.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {detail.documents.map((d: any) => (
                <li key={d.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-[#0f5973] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800">{d.label}</p>
                      <p className="text-[10px] text-slate-400 truncate">{d.original_name} · {Math.max(1, Math.round(d.size_bytes / 1024))} KB · {d.mime_type.split('/')[1].toUpperCase()}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => openDocument(d)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                    <Eye className="w-3.5 h-3.5" /> View
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Review History">
            <ol className="space-y-3">
              {detail.history.map((h: any) => (
                <li key={h.id} className="text-xs border-l-2 border-slate-200 pl-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {h.from_status && <><StatusBadge status={h.from_status} /><span className="text-slate-400">→</span></>}
                    <StatusBadge status={h.to_status} />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">{ist(h.created_at)} · {h.admin_email || 'Applicant (public form)'}</p>
                  {h.note && <p className="text-slate-700 mt-1 whitespace-pre-line">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
          <Card title="E-mail Notifications" right={!detail.emailConfigured && <span className="text-[10px] font-semibold text-amber-700">E-mail not configured</span>}>
            {detail.notifications.length === 0 ? <p className="text-xs text-slate-400">No notifications.</p> : (
              <ul className="space-y-2.5">
                {detail.notifications.map((n: any) => (
                  <li key={n.id} className="text-xs flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-slate-400" />{EVENT_LABEL[n.event] || n.event}</p>
                      <p className={`text-[11px] ${NOTIFICATION_LABEL[n.status]?.cls || ''}`}>
                        {NOTIFICATION_LABEL[n.status]?.text || n.status}{n.sent_at ? ` · ${ist(n.sent_at)}` : ''}{n.attempts > 1 ? ` · ${n.attempts} attempts` : ''}
                      </p>
                      {n.status === 'FAILED' && n.last_error && <p className="text-[10px] text-rose-600">{n.last_error}</p>}
                    </div>
                    {['FAILED', 'NOT_CONFIGURED', 'PENDING'].includes(n.status) && (
                      <button type="button" onClick={() => retryNotification(n.id)} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">
                        <RefreshCw className="w-3 h-3" /> Retry
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!detail.emailConfigured && (
              <p className="mt-3 text-[10px] text-slate-500">No e-mails are being sent. Contact the applicant by phone or your own e-mail until SMTP settings are added on the server.</p>
            )}
          </Card>
        </div>

        {dialog && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cp-dialog-title">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h3 id="cp-dialog-title" className="text-base font-bold text-slate-900">{CP_ACTIONS[dialog.action].label}</h3>
                <button type="button" onClick={() => setDialog(null)} aria-label="Close" className="p-1 rounded hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              <p className="text-xs text-slate-600">
                {a.application_ref} · {a.full_name}<br />
                {dialog.action === 'APPROVE' && 'A unique CP ID will be issued and the applicant will be informed (if e-mail is configured). This does not give the partner access to bookings, inventory or customer data.'}
                {dialog.action === 'REJECT' && 'The application will be closed. It stays on record. The reason below is included in the e-mail to the applicant.'}
                {dialog.action === 'REQUEST_INFO' && 'The message below is sent to the applicant (if e-mail is configured). Contact them directly if they gave no e-mail.'}
                {dialog.action === 'SUSPEND' && 'The partner will be marked suspended. The reason is recorded in the history (no e-mail is sent).'}
                {dialog.action === 'REACTIVATE' && 'The partner will be active again with the same CP ID.'}
                {dialog.action === 'UNDER_REVIEW' && 'Marks that verification of this application has started.'}
              </p>
              {dialog.action === 'APPROVE' && (
                <fieldset>
                  <legend className="text-xs font-semibold text-slate-700 mb-1.5">Approved projects</legend>
                  <div className="space-y-1.5">
                    {projects.map(p => (
                      <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" className="accent-[#0f5973]" checked={approvedProjects.includes(p.id)}
                          onChange={e => setApprovedProjects(ids => (e.target.checked ? [...ids, p.id] : ids.filter(x => x !== p.id)))} />
                        {p.name}{a.projects.some((x: any) => x.id === p.id) && <span className="text-[10px] text-slate-400">(requested)</span>}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {dialog.action === 'APPROVE' && detail.missingRequiredDocuments.length > 0 && (
                <label className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 accent-amber-600" checked={ackMissingDocs} onChange={e => setAckMissingDocs(e.target.checked)} />
                  <span>Required documents are missing ({detail.missingRequiredDocuments.map((d: any) => d.label).join(', ')}). I have verified them another way.</span>
                </label>
              )}
              {dialog.action !== 'UNDER_REVIEW' && (
                <div>
                  <label htmlFor="cp-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                    {dialog.action === 'REQUEST_INFO' ? 'Information needed' : dialog.action === 'APPROVE' || dialog.action === 'REACTIVATE' ? 'Note (optional)' : 'Reason'}
                    {CP_ACTIONS_NEEDING_REASON.includes(dialog.action) && <span className="text-rose-500"> *</span>}
                  </label>
                  <textarea id="cp-reason" rows={4} value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} className={`${inputCls} w-full`} />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDialog(null)} className="px-4 py-2 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer">Cancel</button>
                <button
                  type="button"
                  onClick={runAction}
                  disabled={busy || (CP_ACTIONS_NEEDING_REASON.includes(dialog.action) && reason.trim().length < 5)
                    || (dialog.action === 'APPROVE' && (!approvedProjects.length || (detail.missingRequiredDocuments.length > 0 && !ackMissingDocs)))}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-[#0f5973] text-white hover:bg-[#0c4c62] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {busy ? 'Saving…' : `Confirm: ${CP_ACTIONS[dialog.action].label}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------- LIST ----------------
  return (
    <div className="space-y-4">
      {summary && !summary.emailConfigured && (
        <div className="p-3 rounded-lg text-xs bg-amber-50 border border-amber-200 text-amber-900 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          E-mail is not configured on the server: applicants receive the on-screen confirmation only. Approval and rejection e-mails are recorded as "not sent".
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {cards.map(c => (
          <button
            key={c.label}
            type="button"
            onClick={() => setFilters(f => ({ ...f, status: c.key }))}
            className={`text-left bg-white rounded-xl border p-3.5 transition-colors cursor-pointer ${filters.status === c.key ? 'border-[#0f5973] ring-1 ring-[#0f5973]' : 'border-slate-200 hover:border-slate-300'}`}
          >
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{c.label}</p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">{c.value ?? '–'}</p>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-2">
        <form onSubmit={e => { e.preventDefault(); setFilters(f => ({ ...f, search: searchInput.trim() })); }} className="flex-1 min-w-[220px] flex gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Name, reference, mobile, company or CP ID" aria-label="Search applications" className={`${inputCls} w-full pl-8`} />
          </div>
          <button type="submit" className="px-3 py-2 text-xs font-semibold bg-[#0f5973] text-white rounded-lg cursor-pointer">Search</button>
        </form>
        <select aria-label="Status" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} className={inputCls}>
          <option value="">All statuses</option>
          {CP_STATUSES.map(s => <option key={s} value={s}>{CP_STATUS_LABELS[s]}</option>)}
        </select>
        <select aria-label="Project interest" value={filters.projectId} onChange={e => setFilters(f => ({ ...f, projectId: e.target.value }))} className={inputCls}>
          <option value="">All projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <label className="text-[11px] text-slate-500 flex items-center gap-1">From <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} className={inputCls} /></label>
        <label className="text-[11px] text-slate-500 flex items-center gap-1">To <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} className={inputCls} /></label>
        {(filters.search || filters.status || filters.projectId || filters.from || filters.to) && (
          <button type="button" onClick={() => { setSearchInput(''); setFilters(f => ({ ...f, search: '', status: '', projectId: '', from: '', to: '' })); }} className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800 cursor-pointer">Clear</button>
        )}
        <button type="button" onClick={exportCsv} className="px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      {error && <div className="p-3 rounded-lg text-xs bg-rose-50 border border-rose-200 text-rose-800">{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Reference</th>
              <SortHeader column="full_name">Applicant</SortHeader>
              <th className="px-3 py-2.5 font-semibold">Mobile</th>
              <th className="px-3 py-2.5 font-semibold">Company / Firm</th>
              <th className="px-3 py-2.5 font-semibold">Type</th>
              <SortHeader column="city">City</SortHeader>
              <th className="px-3 py-2.5 font-semibold">Projects</th>
              <SortHeader column="created_at">Submitted</SortHeader>
              <SortHeader column="status">Status</SortHeader>
              <th className="px-3 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50/70">
                <td className="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap">{r.application_ref}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-800">{r.full_name}</td>
                <td className="px-3 py-2.5 font-mono whitespace-nowrap">{r.mobile}</td>
                <td className="px-3 py-2.5">{r.company_name || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.partner_type_label}</td>
                <td className="px-3 py-2.5">{r.city}</td>
                <td className="px-3 py-2.5">{r.projects.join(', ')}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{ist(r.created_at)}</td>
                <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2.5 text-right">
                  <button type="button" onClick={() => openDetail(r.id)} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-300 rounded-lg hover:bg-white cursor-pointer">
                    <Eye className="w-3.5 h-3.5" /> View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && (
          <div className="p-10 text-center">
            <Users className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-600">
              {summary?.total ? 'No applications match these filters' : 'No channel partner applications yet'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {summary?.total ? 'Try clearing the search or filters.' : 'Share the registration page with brokers: '}
              {!summary?.total && <a href="/cp-registration" target="_blank" rel="noopener noreferrer" className="text-[#0f5973] underline">/cp-registration</a>}
            </p>
          </div>
        )}
        {loading && <p className="p-6 text-center text-xs text-slate-400">Loading applications…</p>}
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>{pagination.total} application{pagination.total === 1 ? '' : 's'} · page {pagination.page} of {pagination.totalPages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={pagination.page <= 1} onClick={() => loadList(pagination.page - 1)} className="px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40 cursor-pointer">Previous</button>
            <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => loadList(pagination.page + 1)} className="px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-40 cursor-pointer">Next</button>
          </div>
        </div>
      )}
      {summary && summary.total > 0 && (
        <p className="text-[10px] text-slate-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Counts and lists come from the database. Every decision is recorded in the review history and the system audit trail.</p>
      )}
    </div>
  );
};
