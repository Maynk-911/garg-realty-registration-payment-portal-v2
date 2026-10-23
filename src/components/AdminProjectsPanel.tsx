import React, { useEffect, useState } from 'react';
import { CheckCircle2, Lock, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';

interface PlanRow {
  id?: string;
  label: string;
  size?: string;
  total_price?: number | '';
  token_amount?: number | '';
  inventory?: number | '';
  active?: boolean;
  held?: number;
  available?: number | null;
  bookings?: number;
}

interface AdminProject {
  id: string;
  name: string;
  short_name?: string;
  display_name?: string;
  tagline?: string;
  location?: string;
  description?: string;
  features?: string[];
  token_amount?: number;
  payee_name?: string;
  refund_policy?: string;
  booking_enabled?: boolean;
  payment_qr_url?: string;
  payment_qr_data?: string;
  editable: boolean;
  publish_problems: string[];
  booking_count: number;
  details_verified_at?: string;
  details_verified_by?: string;
  ownership_plans: PlanRow[];
}

interface AdminProjectsPanelProps {
  token: string;
  onUnauthorized: () => void;
  /** Called after a change so dashboard figures refresh */
  onChanged: () => void;
}

const rupees = (n?: number | '') => (typeof n === 'number' && n > 0 ? `₹ ${n.toLocaleString('en-IN')}` : '—');
const inputCls = 'w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0f5973]';

// Admin → Projects & Inventory. Pangot is shown read-only; Dholera's details, plots, QR and booking status are managed here.
export const AdminProjectsPanel: React.FC<AdminProjectsPanelProps> = ({ token, onUnauthorized, onChanged }) => {
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [draft, setDraft] = useState<AdminProject | null>(null);
  const [featuresText, setFeaturesText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmVerified, setConfirmVerified] = useState(false);

  const api = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) } });
    // 401 = session ended; 403 on the list = not an admin. (403 on an edit means "not editable" and is shown as an error.)
    if (res.status === 401 || (res.status === 403 && url.endsWith('/api/admin/projects'))) { onUnauthorized(); throw new Error('Session expired'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
    return data;
  };

  const load = async () => {
    try {
      const data = await api('/api/admin/projects');
      setProjects(data.projects);
      const editable = data.projects.find((p: AdminProject) => p.editable);
      if (editable) {
        setDraft(editable);
        setFeaturesText((editable.features || []).join('\n'));
      }
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    }
  };

  useEffect(() => { load(); }, []);

  const applyServerProject = (p: AdminProject, text: string) => {
    setProjects(prev => prev.map(x => (x.id === p.id ? p : x)));
    setDraft(p);
    setFeaturesText((p.features || []).join('\n'));
    setMessage({ ok: true, text });
    onChanged();
  };

  const updatePlan = (index: number, patch: Partial<PlanRow>) => {
    if (!draft) return;
    setDraft({ ...draft, ownership_plans: draft.ownership_plans.map((pl, i) => (i === index ? { ...pl, ...patch } : pl)) });
  };

  const numberOrBlank = (v: string): number | '' => (v.trim() === '' ? '' : Math.max(0, Math.floor(Number(v)) || 0));

  const saveDetails = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = await api(`/api/admin/projects/${draft.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          display_name: draft.display_name,
          tagline: draft.tagline,
          location: draft.location,
          description: draft.description,
          features: featuresText.split('\n').map(f => f.trim()).filter(Boolean),
          payee_name: draft.payee_name,
          refund_policy: draft.refund_policy,
          ownership_plans: draft.ownership_plans.map(pl => ({
            id: pl.id, label: pl.label, size: pl.size, total_price: pl.total_price, token_amount: pl.token_amount, inventory: pl.inventory, active: pl.active !== false
          }))
        })
      });
      applyServerProject(data.project, 'Project details saved.');
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const uploadQr = async (file: File | undefined) => {
    if (!draft || !file || busy) return;
    if (file.size > 1024 * 1024) { setMessage({ ok: false, text: 'The QR image must be 1 MB or smaller' }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsDataURL(file);
      });
      const data = await api(`/api/admin/projects/${draft.id}/payment-qr`, { method: 'POST', body: JSON.stringify({ imageDataUrl }) });
      applyServerProject(data.project, 'Payment QR uploaded. Check it carefully before opening bookings.');
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const setBookingStatus = async (enabled: boolean) => {
    if (!draft || busy) return;
    if (!window.confirm(enabled
      ? `Open online bookings for ${draft.short_name || draft.name}? Customers will see these prices, the QR code and the refund policy.`
      : `Close online bookings for ${draft.short_name || draft.name}? Existing bookings are not affected.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = await api(`/api/admin/projects/${draft.id}/booking-status`, { method: 'POST', body: JSON.stringify({ enabled, confirmVerified }) });
      setConfirmVerified(false);
      applyServerProject(data.project, enabled ? 'Bookings are now open.' : 'Bookings are now closed.');
    } catch (e: any) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const fixed = projects.filter(p => !p.editable);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold text-sm text-[#0f5973] uppercase tracking-wide">Projects &amp; Inventory</h3>
        <button onClick={load} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-xs border ${message.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>{message.text}</div>
      )}

      {/* Fixed projects (Pangot) */}
      {fixed.map(p => (
        <div key={p.id} className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900">{p.display_name || p.name}</p>
              <p className="text-[11px] text-slate-500">{p.location} · {p.booking_count} booking(s) · Bookings {p.booking_enabled ? 'open' : 'closed'}</p>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
              <Lock className="w-3 h-3" /> Fixed configuration
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div><span className="text-slate-500">Token per unit:</span> <strong>{rupees(p.token_amount)}</strong></div>
            <div><span className="text-slate-500">Units:</span> {p.ownership_plans.map(pl => pl.label).join(' · ')}</div>
            <div><span className="text-slate-500">Inventory:</span> not tracked</div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{p.refund_policy}</p>
        </div>
      ))}

      {/* Editable project (Dholera) */}
      {draft && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <p className="font-bold text-slate-900">{draft.display_name || draft.name}</p>
              <p className="text-[11px] text-slate-500">{draft.booking_count} booking(s)</p>
            </div>
            <span className={`self-start inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
              draft.booking_enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              {draft.booking_enabled ? 'Bookings open' : 'Bookings closed — not visible to customers'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="font-semibold text-slate-700">Title on homepage card</span>
              <input className={inputCls} value={draft.display_name || ''} onChange={e => setDraft({ ...draft, display_name: e.target.value })} />
            </label>
            <label className="space-y-1">
              <span className="font-semibold text-slate-700">Location</span>
              <input className={inputCls} value={draft.location || ''} onChange={e => setDraft({ ...draft, location: e.target.value })} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="font-semibold text-slate-700">Short tagline</span>
              <input className={inputCls} value={draft.tagline || ''} onChange={e => setDraft({ ...draft, tagline: e.target.value })} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="font-semibold text-slate-700">Project description (verified facts only)</span>
              <textarea rows={3} className={inputCls} value={draft.description || ''} onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="font-semibold text-slate-700">Highlights (one per line)</span>
              <textarea rows={3} className={inputCls} value={featuresText} onChange={e => setFeaturesText(e.target.value)} />
            </label>
          </div>

          {/* Plots / units */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Plots / Units</span>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, ownership_plans: [...draft.ownership_plans, { label: '', size: '', total_price: '', token_amount: '', inventory: '', active: true }] })}
                className="px-2.5 py-1 text-xs font-semibold text-[#0f5973] hover:bg-teal-50 rounded flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add plot
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[720px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200 text-left">
                    <th className="py-2 pr-2">Plot / unit name</th><th className="py-2 pr-2">Size</th><th className="py-2 pr-2">Price (₹)</th>
                    <th className="py-2 pr-2">Token (₹)</th><th className="py-2 pr-2">Inventory</th><th className="py-2 pr-2">Booked / Left</th>
                    <th className="py-2 pr-2">Available</th><th className="py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draft.ownership_plans.length === 0 && (
                    <tr><td colSpan={8} className="py-4 text-center text-slate-400">No plots yet. Add the verified plots, prices and token amounts.</td></tr>
                  )}
                  {draft.ownership_plans.map((pl, i) => (
                    <tr key={pl.id || `new-${i}`}>
                      <td className="py-1.5 pr-2"><input aria-label="Plot name" className={inputCls} value={pl.label} disabled={Boolean(pl.bookings)} title={pl.bookings ? 'Has bookings: cannot be renamed' : undefined} onChange={e => updatePlan(i, { label: e.target.value })} /></td>
                      <td className="py-1.5 pr-2"><input aria-label="Plot size" className={inputCls} value={pl.size || ''} onChange={e => updatePlan(i, { size: e.target.value })} /></td>
                      <td className="py-1.5 pr-2"><input aria-label="Plot price" inputMode="numeric" className={inputCls} value={pl.total_price ?? ''} onChange={e => updatePlan(i, { total_price: numberOrBlank(e.target.value) })} /></td>
                      <td className="py-1.5 pr-2"><input aria-label="Plot token amount" inputMode="numeric" className={inputCls} value={pl.token_amount ?? ''} onChange={e => updatePlan(i, { token_amount: numberOrBlank(e.target.value) })} /></td>
                      <td className="py-1.5 pr-2"><input aria-label="Plot inventory" inputMode="numeric" className={inputCls} value={pl.inventory ?? ''} onChange={e => updatePlan(i, { inventory: numberOrBlank(e.target.value) })} /></td>
                      <td className="py-1.5 pr-2 font-mono text-slate-600 whitespace-nowrap">{pl.held ?? 0} / {pl.available ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-center"><input type="checkbox" aria-label="Plot available" checked={pl.active !== false} onChange={e => updatePlan(i, { active: e.target.checked })} /></td>
                      <td className="py-1.5 text-right">
                        {!pl.bookings && (
                          <button type="button" aria-label="Remove plot" onClick={() => setDraft({ ...draft, ownership_plans: draft.ownership_plans.filter((_, j) => j !== i) })} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5">Booked = verified payments plus submitted UTRs awaiting review. Changing a price never changes amounts already saved on existing bookings.</p>
          </div>

          {/* Payment details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-3">
              <label className="space-y-1 block">
                <span className="font-semibold text-slate-700">Payee / account name (shown under the QR)</span>
                <input className={inputCls} value={draft.payee_name || ''} onChange={e => setDraft({ ...draft, payee_name: e.target.value })} />
              </label>
              <label className="space-y-1 block">
                <span className="font-semibold text-slate-700">Refund policy (shown on the form, receipts and refund page)</span>
                <textarea rows={4} className={inputCls} value={draft.refund_policy || ''} onChange={e => setDraft({ ...draft, refund_policy: e.target.value })} />
              </label>
            </div>
            <div className="space-y-2">
              <span className="font-semibold text-slate-700 block">Payment QR code</span>
              {draft.payment_qr_data
                ? <img src={draft.payment_qr_data} alt="Uploaded payment QR" className="w-40 h-auto rounded-lg border border-slate-200" />
                : <p className="text-slate-500">No QR uploaded.</p>}
              <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> {draft.payment_qr_data ? 'Replace QR' : 'Upload QR'} (PNG/JPEG, max 1 MB)
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Upload payment QR" onChange={e => { uploadQr(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
          </div>

          <div className="flex justify-end">
            <button type="button" onClick={saveDetails} disabled={busy} className="px-4 py-2 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50">
              {busy ? 'Saving…' : 'Save details'}
            </button>
          </div>

          {/* Open / close bookings */}
          <div className="pt-4 border-t border-slate-200 space-y-3 text-xs">
            {draft.booking_enabled ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-emerald-800 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Open since verification by {draft.details_verified_by || 'admin'}
                  {draft.details_verified_at ? ` on ${new Date(draft.details_verified_at).toLocaleString('en-IN')}` : ''}
                </p>
                <button type="button" onClick={() => setBookingStatus(false)} disabled={busy} className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold rounded-lg cursor-pointer disabled:opacity-50">
                  Close bookings
                </button>
              </div>
            ) : (
              <>
                {draft.publish_problems.length > 0 && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                    <p className="font-bold">Before bookings can open:</p>
                    <ul className="list-disc pl-5 mt-1">{draft.publish_problems.map(p => <li key={p}>{p}</li>)}</ul>
                  </div>
                )}
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={confirmVerified} onChange={e => setConfirmVerified(e.target.checked)} className="mt-0.5" />
                  <span>I confirm the plot prices, token amounts, inventory, payment QR, payee and refund policy above are verified and correct.</span>
                </label>
                <button
                  type="button"
                  onClick={() => setBookingStatus(true)}
                  disabled={busy || !confirmVerified || draft.publish_problems.length > 0}
                  className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Open bookings
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
