import React from 'react';
import { BrandLogo } from './BrandLogo.js';
import { Phone, MessageCircle, Search, ShieldCheck, Lock } from 'lucide-react';

interface NavbarProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate }) => {
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
      {/* Top micro-bar */}
      <div className="bg-[#0f5973] text-white text-[11px] py-1 px-4 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-amber-300 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Official Allotment Portal
          </span>
          <span className="hidden sm:inline text-teal-200">·</span>
          <span className="hidden sm:inline text-teal-100 font-mono">apply.yourdomain.com</span>
        </div>
        <div className="flex items-center gap-4">
          <a 
            href="tel:+919876543210" 
            className="hover:text-amber-200 transition-colors flex items-center gap-1 text-[11px]"
          >
            <Phone className="w-3 h-3" />
            <span className="hidden sm:inline">+91 98765 43210</span>
          </a>
          <a
            href="https://wa.me/919876543210?text=Hello%20Garg%20Realty,%20I%20want%20to%20inquire%20about%20Pangot%20Plot%20Booking"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-300 transition-colors flex items-center gap-1 text-emerald-200 font-medium"
          >
            <MessageCircle className="w-3 h-3" />
            <span className="hidden sm:inline">WhatsApp Help</span>
          </a>
        </div>
      </div>

      {/* Main Nav */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div 
          onClick={() => onNavigate('landing')}
          className="cursor-pointer"
        >
          <BrandLogo />
        </div>

        <nav className="flex items-center gap-2 sm:gap-4">
          <button
            onClick={() => onNavigate('landing')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              currentView === 'landing' ? 'text-[#0f5973] bg-teal-50' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Home
          </button>

          <button
            onClick={() => onNavigate('form')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-md transition-colors cursor-pointer shadow-xs ${
              currentView === 'form' 
                ? 'bg-[#0f5973] text-white' 
                : 'bg-[#b87e2b] hover:bg-[#a66f24] text-white'
            }`}
          >
            Register / Book Plot
          </button>

          <button
            onClick={() => onNavigate('track')}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
              currentView === 'track' ? 'text-[#0f5973] bg-teal-50' : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Track existing booking"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Track Booking</span>
          </button>

          <button
            onClick={() => onNavigate('admin')}
            className={`p-1.5 sm:px-2.5 sm:py-1.5 text-xs font-medium rounded-md border border-slate-200 transition-colors flex items-center gap-1 cursor-pointer ${
              currentView === 'admin' ? 'bg-slate-900 text-white border-slate-900' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
            title="Admin Login"
          >
            <Lock className="w-3.5 h-3.5 text-amber-500" />
            <span className="hidden sm:inline">Admin</span>
          </button>
        </nav>
      </div>
    </header>
  );
};
