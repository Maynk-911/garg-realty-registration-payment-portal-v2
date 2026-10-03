import React from 'react';
import { BrandLogo } from './BrandLogo.js';
import { ShieldCheck, Phone, Mail, MapPin } from 'lucide-react';

interface FooterProps {
  onNavigate: (view: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  return (
    <footer className="no-print bg-[#092b37] text-slate-300 pt-12 pb-8 border-t-2 border-[#b87e2b]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          
          {/* Col 1: Brand Info */}
          <div className="md:col-span-1">
            <BrandLogo light={true} />
            <p className="text-xs text-slate-400 mt-4 leading-relaxed">
              Official plot booking, unit reservation, and token payment platform for Garg Realty Group development projects across Pangot, Dholera, and Uttarakhand.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-amber-300 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>100% Token Refund within 15 Days</span>
            </div>
          </div>

          {/* Col 2: Quick Links */}
          <div>
            <h4 className="text-white text-xs font-bold uppercase tracking-wider mb-3">
              Booking Services
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button 
                  onClick={() => onNavigate('form')}
                  className="hover:text-amber-300 transition-colors text-left cursor-pointer"
                >
                  Pangot Plot Booking Form
                </button>
              </li>
              <li>
                <button 
                  onClick={() => onNavigate('form')}
                  className="hover:text-amber-300 transition-colors text-left cursor-pointer"
                >
                  Dholera Smart City Registration
                </button>
              </li>
              <li>
                <button 
                  onClick={() => onNavigate('track')}
                  className="hover:text-amber-300 transition-colors text-left cursor-pointer"
                >
                  Download Booking Receipt
                </button>
              </li>
              <li>
                <button 
                  onClick={() => onNavigate('track')}
                  className="hover:text-amber-300 transition-colors text-left cursor-pointer"
                >
                  Payment Status Verification
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Compliance & Legal */}
          <div>
            <h4 className="text-white text-xs font-bold uppercase tracking-wider mb-3">
              Policies & Governance
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button 
                  onClick={() => onNavigate('policy_terms')}
                  className="hover:text-amber-300 transition-colors text-left cursor-pointer"
                >
                  Terms & Conditions
                </button>
              </li>
              <li>
                <button 
                  onClick={() => onNavigate('policy_privacy')}
                  className="hover:text-amber-300 transition-colors text-left cursor-pointer"
                >
                  Privacy Policy (v2026.1)
                </button>
              </li>
              <li>
                <button 
                  onClick={() => onNavigate('policy_refund')}
                  className="hover:text-amber-300 transition-colors text-left cursor-pointer"
                >
                  15-Day Refund Policy
                </button>
              </li>
              <li>
                <button 
                  onClick={() => onNavigate('admin')}
                  className="hover:text-amber-300 transition-colors text-left cursor-pointer text-slate-400"
                >
                  Admin & Sales Login
                </button>
              </li>
            </ul>
          </div>

          {/* Col 4: Corporate Contact */}
          <div>
            <h4 className="text-white text-xs font-bold uppercase tracking-wider mb-3">
              Corporate Office
            </h4>
            <div className="space-y-2 text-xs text-slate-400">
              <p className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                <span>Garg Residency Private Limited, Corporate Tower, Sector 48, Gurugram, HR 122018</span>
              </p>
              <p className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span>+91 98765 43210</span>
              </p>
              <p className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span>allotment@gargrealty.com</span>
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Attribution matching PDF */}
        <div className="pt-6 border-t border-teal-900/60 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>© {new Date().getFullYear()} Garg Residency Private Limited. All Rights Reserved.</p>
          <p className="font-semibold text-slate-300">
            Thanks & Regards | Garg Residency Private Limited
          </p>
        </div>
      </div>
    </footer>
  );
};
