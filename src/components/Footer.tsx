import React from 'react';
import { BrandLogo } from './BrandLogo.js';

interface FooterProps {
  onNavigate: (view: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="no-print bg-white border-t border-slate-200 py-8 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Brand Logo */}
        <div 
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onNavigate('landing');
          }}
          className="cursor-pointer"
        >
          <BrandLogo size="sm" />
        </div>

        {/* Legal & Policy Links */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500">
          <a href="/cp-registration" className="font-semibold text-[#0f5973] hover:text-slate-900 transition-colors">
            Channel Partner Registration
          </a>
          <button
            onClick={() => onNavigate('policy_terms')}
            className="hover:text-slate-900 transition-colors cursor-pointer"
          >
            Terms & Conditions
          </button>
          <button 
            onClick={() => onNavigate('policy_privacy')}
            className="hover:text-slate-900 transition-colors cursor-pointer"
          >
            Privacy Policy
          </button>
          <button 
            onClick={() => onNavigate('policy_refund')}
            className="hover:text-slate-900 transition-colors cursor-pointer"
          >
            Refund Policy
          </button>
        </div>

        {/* Corporate Signoff from PDF */}
        <div className="text-right text-xs text-slate-600 font-medium">
          Thanks & Regards | Garg Residency Private Limited
        </div>

      </div>
    </footer>
  );
};
