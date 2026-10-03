import React from 'react';
import { Project } from '../types.js';
import { 
  ShieldCheck, 
  ArrowRight, 
  CheckCircle2, 
  TrendingUp, 
  MapPin, 
  Clock, 
  Lock, 
  FileText,
  BadgePercent,
  Sparkles
} from 'lucide-react';

interface LandingPageProps {
  projects: Project[];
  onSelectProject: (projectId: string) => void;
  onStartRegistration: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  projects,
  onSelectProject,
  onStartRegistration
}) => {
  return (
    <div className="min-h-screen bg-slate-50">
      
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#0f5973] via-[#0b485d] to-[#073240] text-white pt-16 pb-20 px-4 sm:px-6 lg:px-8">
        
        {/* Decorative background grid subtle overlay */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none"></div>

        <div className="relative max-w-5xl mx-auto text-center">
          
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-amber-300 text-xs font-semibold mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Official Unit Reservation & Token Payment Portal</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-['Playfair_Display'] leading-tight mb-4">
            Complete Your Registration & Unit Booking
          </h1>

          <p className="text-base sm:text-xl text-teal-100/90 max-w-2xl mx-auto font-normal leading-relaxed mb-8">
            Fill in your applicant details, select your plot or unit, and securely complete your token payment. Token amounts are <span className="text-amber-300 font-semibold underline underline-offset-4">100% refundable within 15 days</span>.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onStartRegistration}
              className="w-full sm:w-auto px-8 py-3.5 bg-[#b87e2b] hover:bg-[#a66f24] text-white font-bold text-sm uppercase tracking-wider rounded-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2 cursor-pointer transform hover:-translate-y-0.5"
            >
              <span>Register / Book Unit Now</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <a
              href="#projects"
              className="w-full sm:w-auto px-6 py-3.5 bg-white/10 hover:bg-white/15 border border-white/20 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <FileText className="w-4 h-4 text-teal-200" />
              <span>Explore Available Projects</span>
            </a>
          </div>

          {/* Quick Trust Badges below Hero */}
          <div className="mt-12 pt-8 border-t border-white/15 grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center text-amber-300 flex-shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">15-Day 100% Refund</p>
                <p className="text-[11px] text-teal-200/80">Guaranteed on cancellation</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center text-amber-300 flex-shrink-0">
                <Lock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">Razorpay Secure</p>
                <p className="text-[11px] text-teal-200/80">256-bit encrypted checkout</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center text-amber-300 flex-shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">Instant Allotment ID</p>
                <p className="text-[11px] text-teal-200/80">Official GRG human-readable ref</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-white/10 flex items-center justify-center text-amber-300 flex-shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white leading-tight">Instant Confirmation</p>
                <p className="text-[11px] text-teal-200/80">Receipt & SMS dispatch</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Featured Booking Showcase (Pangot Booking highlighted as in PDF) */}
      <section id="projects" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-bold uppercase tracking-wider text-[#b87e2b]">
            Current Open Allotments
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0f5973] mt-1 font-['Playfair_Display']">
            Select Your Preferred Development
          </h2>
          <p className="text-sm text-slate-600 mt-2">
            Token payments secure unit allocation. Complete the official Booking & Plot Details form online in 3 minutes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {projects.map((proj) => {
            const isPangot = proj.id === 'proj_pangot';
            return (
              <div 
                key={proj.id}
                className={`bg-white rounded-xl border transition-all duration-200 flex flex-col justify-between overflow-hidden shadow-xs hover:shadow-md ${
                  isPangot 
                    ? 'border-[#0f5973] ring-1 ring-[#0f5973]' 
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Project Header Banner */}
                <div className={`p-4 ${isPangot ? 'bg-[#0f5973] text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {isPangot && (
                    <div className="text-[10px] uppercase font-bold text-amber-300 tracking-wider mb-1">
                      Featured in Official Form
                    </div>
                  )}
                  <h3 className="font-bold text-base leading-snug">{proj.name}</h3>
                  <div className="flex items-center gap-1 mt-1 text-xs opacity-80">
                    <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{proj.location}</span>
                  </div>
                </div>

                {/* Project Body */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 mb-4">
                      {proj.description}
                    </p>

                    <div className="space-y-2 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Token Advance:</span>
                        <span className="font-bold text-[#0f5973]">
                          ₹ {proj.token_amount.toLocaleString('en-IN')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Targeted ROI:</span>
                        <span className="font-semibold text-emerald-700 flex items-center gap-0.5">
                          <TrendingUp className="w-3 h-3" />
                          {proj.roi_percentage}% p.a.
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-500">Est. Total Price:</span>
                        <span className="font-medium text-slate-700">
                          From ₹ {(proj.total_price / 100000).toFixed(1)} Lakhs
                        </span>
                      </div>
                    </div>

                    {/* Key features */}
                    <div className="space-y-1.5 mb-5 text-[11px] text-slate-600">
                      {proj.features.slice(0, 3).map((f, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#0f5973] flex-shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      onSelectProject(proj.id);
                      onStartRegistration();
                    }}
                    className={`w-full py-2.5 px-4 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                      isPangot 
                        ? 'bg-[#0f5973] hover:bg-[#0a4358] text-white shadow-xs' 
                        : 'bg-[#b87e2b] hover:bg-[#a66f24] text-white'
                    }`}
                  >
                    <span>Book Plot Now</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Trust & Transparency Section */}
      <section className="bg-white border-y border-slate-200 py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center p-6 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-12 h-12 mx-auto rounded-full bg-teal-100/60 text-[#0f5973] flex items-center justify-center mb-4">
                <BadgePercent className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-slate-900 mb-2">15-Day Cancellation Guarantee</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                As clearly stated in Section 6 of our booking terms: The token amount is 100% fully refundable if booking is cancelled within 15 days of payment.
              </p>
            </div>

            <div className="text-center p-6 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-12 h-12 mx-auto rounded-full bg-teal-100/60 text-[#0f5973] flex items-center justify-center mb-4">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-slate-900 mb-2">Server-Verified Gateway</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                All transactions are processed through Razorpay with HMAC SHA-256 cryptographic webhook verification. No payment credentials ever touch the frontend.
              </p>
            </div>

            <div className="text-center p-6 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-12 h-12 mx-auto rounded-full bg-teal-100/60 text-[#0f5973] flex items-center justify-center mb-4">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-base text-slate-900 mb-2">Formal Allotment Receipt</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Receive an immediate digital Booking & Plot Details Form with unique registration reference (e.g. GRG-2026-000021), ready to download and print.
              </p>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};
