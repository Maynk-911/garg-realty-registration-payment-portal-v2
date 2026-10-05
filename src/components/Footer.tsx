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
          onClick={() => onNavigate('landing')}
          className="cursor-pointer"
        >
          <BrandLogo size="sm" />
        </div>

        {/* Legal & Policy Links */}
        <div className="flex items-center gap-6 text-xs text-slate-500">
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
            15-Day Refund Policy
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
