import React from 'react';
import { Project } from '../types.js';
import { ArrowLeft, ArrowRight, Clock, MapPin, ShieldCheck, Sparkles } from 'lucide-react';

interface ProjectDetailsPageProps {
  project: Project | undefined;
  /** URL of this project's booking form */
  registerHref: string;
}

const rupees = (n?: number) => (typeof n === 'number' && n > 0 ? `₹ ${n.toLocaleString('en-IN')}` : '—');

// Details page for a project managed in Admin → Projects (e.g. Dholera).
// Shows only what an admin has published; nothing commercial is shown before bookings open.
export const ProjectDetailsPage: React.FC<ProjectDetailsPageProps> = ({ project, registerHref }) => {
  const open = Boolean(project?.booking_enabled);
  const plans = open ? project?.ownership_plans || [] : [];

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50">
      <section className="relative overflow-hidden bg-gradient-to-b from-[#7a4e17] via-[#5c3a10] to-[#3d2709] text-white py-14 sm:py-20 px-4 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none"></div>
        <div className="relative max-w-4xl mx-auto text-center">
          <a href="/" className="inline-flex items-center gap-1.5 text-xs text-amber-100/80 hover:text-white mb-5">
            <ArrowLeft className="w-3.5 h-3.5" /> All projects
          </a>
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-amber-200 text-xs font-semibold mb-5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{open ? 'Bookings Open' : 'Bookings Opening Soon'}</span>
            </div>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-['Playfair_Display'] leading-[1.15] mb-3">
            {project?.display_name || 'Dholera – Smart City Plots, Gujarat'}
          </h1>
          <p className="text-sm sm:text-base text-amber-100/90 flex items-center justify-center gap-1.5">
            <MapPin className="w-4 h-4" /> {project?.location || 'Dholera, Gujarat'}
          </p>
          {open && (
            <a
              href={registerHref}
              className="mt-8 inline-flex w-full sm:w-auto px-10 py-4 bg-[#b87e2b] hover:bg-[#a66f24] text-white font-bold text-sm uppercase tracking-wider rounded-xl shadow-xl transition-all items-center justify-center gap-3"
            >
              <span>Book a Plot</span>
              <ArrowRight className="w-5 h-5" />
            </a>
          )}
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        {!open ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-10 text-center">
            <Clock className="w-10 h-10 mx-auto text-[#b87e2b]" />
            <h2 className="mt-4 text-xl font-bold text-[#0f5973]">Bookings are opening soon</h2>
            <p className="mt-2 text-sm text-slate-600 max-w-xl mx-auto">
              Plot details, prices, availability and payment information will be published here once they are verified.
              No payment can be made for this project until bookings open.
            </p>
            <a href="/" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#0f5973] hover:underline">
              <ArrowLeft className="w-4 h-4" /> Back to all projects
            </a>
          </div>
        ) : (
          <>
            {(project?.description || (project?.features || []).length > 0) && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
                <h2 className="text-lg font-bold text-[#0f5973] font-['Playfair_Display']">Project Overview</h2>
                {project?.description && <p className="mt-3 text-sm text-slate-700 leading-relaxed whitespace-pre-line">{project.description}</p>}
                {(project?.features || []).length > 0 && (
                  <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {project!.features.map(f => (
                      <li key={f} className="text-sm text-slate-700 flex items-start gap-2">
                        <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" /> <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
              <h2 className="text-lg font-bold text-[#0f5973] font-['Playfair_Display']">Plots & Pricing</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <th className="py-2 pr-3">Plot</th>
                      <th className="py-2 pr-3">Size</th>
                      <th className="py-2 pr-3">Price</th>
                      <th className="py-2 pr-3">Booking Token</th>
                      <th className="py-2">Availability</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {plans.map(pl => (
                      <tr key={pl.id}>
                        <td className="py-2.5 pr-3 font-semibold text-slate-900">{pl.label}</td>
                        <td className="py-2.5 pr-3 text-slate-700">{pl.size || '—'}</td>
                        <td className="py-2.5 pr-3 font-mono">{rupees(pl.total_price)}</td>
                        <td className="py-2.5 pr-3 font-mono font-semibold text-[#0f5973]">{rupees(pl.token_amount)}</td>
                        <td className="py-2.5">
                          {pl.available === 0
                            ? <span className="text-rose-600 font-semibold">Sold out</span>
                            : typeof pl.available === 'number'
                              ? <span className="text-emerald-700 font-semibold">{pl.available} available</span>
                              : 'Available'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {project?.refund_policy && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900">
                <p className="font-bold">Refund Policy</p>
                <p className="mt-1 whitespace-pre-line">{project.refund_policy}</p>
              </div>
            )}

            <div className="text-center">
              <a
                href={registerHref}
                className="inline-flex w-full sm:w-auto px-10 py-4 bg-[#0f5973] hover:bg-[#0a4358] text-white font-bold text-sm uppercase tracking-wider rounded-xl shadow-md transition-all items-center justify-center gap-3"
              >
                <span>Book a Plot</span>
                <ArrowRight className="w-5 h-5" />
              </a>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
