import React from 'react';
import { Project } from '../types.js';
import { UNIT_OPTIONS } from '../bookingOptions.js';
import { 
  ShieldCheck, 
  ArrowRight, 
  TrendingUp, 
  MapPin, 
  Lock, 
  FileText,
  Clock,
  Sparkles
} from 'lucide-react';

interface LandingPageProps {
  projects: Project[];
  onStartRegistration: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  projects,
  onStartRegistration
}) => {
  const pangotProject = projects.find(p => p.id === 'proj_pangot') || projects[0];
  const tokenAmount = pangotProject ? pangotProject.token_amount : 51000;

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50 flex flex-col justify-between">
      
      {/* Premium Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#0f5973] via-[#0c4c62] to-[#083545] text-white py-16 sm:py-24 px-4 sm:px-6 lg:px-8">
        
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px] opacity-10 pointer-events-none"></div>

        <div className="relative max-w-4xl mx-auto text-center">
          
          {/* Project Kicker */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-amber-300 text-xs font-semibold mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Pangot Booking · Official Allotment & Plot Details Portal</span>
          </div>

          {/* Main Title */}
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight font-['Playfair_Display'] leading-[1.15] mb-5">
            Pangot Luxury Plots & Cottages
          </h1>

          {/* User Requested Supporting Text */}
          <p className="text-base sm:text-xl text-teal-100/90 max-w-2xl mx-auto font-normal leading-relaxed mb-10">
            Secure your Pangot unit registration online.
          </p>

          {/* The Main CTA Button Requested */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/register"
              className="w-full sm:w-auto px-10 py-4 bg-[#b87e2b] hover:bg-[#a66f24] active:scale-[0.99] text-white font-bold text-sm sm:text-base uppercase tracking-wider rounded-xl shadow-xl hover:shadow-2xl transition-all flex items-center justify-center gap-3 cursor-pointer"
            >
              <span>REGISTER / BOOK UNIT</span>
              <ArrowRight className="w-5 h-5" />
            </a>
          </div>

          <p className="text-xs text-teal-200/80 mt-4">
            Token Advance: <strong className="text-white">₹{tokenAmount.toLocaleString('en-IN')}</strong> · 100% Fully Refundable within 15 Days
          </p>

          {/* Key Parameters Pill Bar */}
          <div className="mt-12 pt-8 border-t border-white/15 grid grid-cols-2 md:grid-cols-4 gap-4 text-left">
            <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl backdrop-blur-xs">
              <div className="flex items-center gap-2 text-amber-300 mb-1">
                <MapPin className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Location</span>
              </div>
              <p className="text-xs font-semibold text-white">Pangot, Nainital</p>
              <p className="text-[11px] text-teal-200/80">Uttarakhand Hills</p>
            </div>

            <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl backdrop-blur-xs">
              <div className="flex items-center gap-2 text-amber-300 mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Targeted ROI</span>
              </div>
              <p className="text-xs font-semibold text-white">14.5% per annum</p>
              <p className="text-[11px] text-teal-200/80">High Rental Yield</p>
            </div>

            <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl backdrop-blur-xs">
              <div className="flex items-center gap-2 text-amber-300 mb-1">
                <ShieldCheck className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Refund Terms</span>
              </div>
              <p className="text-xs font-semibold text-white">15-Day 100% Refund</p>
              <p className="text-[11px] text-teal-200/80">Zero Cancellation Fee</p>
            </div>

            <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl backdrop-blur-xs">
              <div className="flex items-center gap-2 text-amber-300 mb-1">
                <Lock className="w-4 h-4" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Payment</span>
              </div>
              <p className="text-xs font-semibold text-white">UPI QR Payment</p>
              <p className="text-[11px] text-teal-200/80">Verified by Accounts Team</p>
            </div>
          </div>

        </div>
      </section>

      {/* Pangot Unit Allotment Details & How it works */}
      <section className="py-14 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full">
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-10">
          
          <div className="border-b border-slate-100 pb-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#b87e2b]">
                Pangot Project Overview
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-[#0f5973] font-['Playfair_Display']">
                Plot & Cottage Reservation Terms
              </h2>
            </div>
            <span className="inline-flex items-center px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full border border-emerald-200">
              ● Allotments Active
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 text-xs text-slate-700">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <p className="text-slate-400 font-semibold mb-1">Unit Types</p>
              <p className="font-bold text-slate-900 text-sm">Co-Own &amp; Full Own</p>
              <p className="text-slate-500 mt-1">{UNIT_OPTIONS.join(' · ')}</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <p className="text-slate-400 font-semibold mb-1">Token Advance</p>
                <p className="font-bold text-[#0f5973] text-sm">₹{tokenAmount.toLocaleString('en-IN')} / Unit</p>
              <p className="text-slate-500 mt-1">Directly credited toward overall purchase price schedule.</p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-100">
              <p className="text-slate-400 font-semibold mb-1">Booking Acknowledgement</p>
              <p className="font-bold text-slate-900 text-sm">Digital GRG Receipt</p>
              <p className="text-slate-500 mt-1">Printable booking form with your Booking ID, confirmed once payment is verified.</p>
            </div>
          </div>

          {/* Bottom Action inside Card */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Clock className="w-4 h-4 text-[#0f5973]" />
              <span>Takes less than 3 minutes to complete online</span>
            </div>

            <a
              href="/register"
              className="w-full sm:w-auto px-8 py-3 bg-[#0f5973] hover:bg-[#0a4358] text-white text-xs sm:text-sm font-bold uppercase tracking-wider rounded-lg shadow-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>REGISTER / BOOK UNIT NOW</span>
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>

        </div>
      </section>

      {/* Clean Minimal Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 px-4 text-center text-xs text-slate-500">
        <p className="font-semibold text-slate-700">
          Thanks & Regards | Garg Residency Private Limited
        </p>
        <p className="text-[11px] text-slate-400 mt-1">
          Official Allotment & Plot Details Portal · Driven by Trust, Defined by Excellence.
        </p>
      </footer>

    </div>
  );
};
