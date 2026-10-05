import React from 'react';
import { BrandLogo } from './BrandLogo.js';
import { Search } from 'lucide-react';

interface NavbarProps {
  currentView: string;
  onNavigate: (view: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentView, onNavigate }) => {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 shadow-xs">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
        
        {/* Official Company Logo */}
        <div 
          onClick={() => onNavigate('landing')}
          className="cursor-pointer py-2"
        >
          <BrandLogo size="md" />
        </div>

        {/* Right side: Prominent REGISTER / BOOK UNIT button */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => onNavigate('track')}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded transition-colors flex items-center gap-1.5 cursor-pointer ${
              currentView === 'track' 
                ? 'text-[#0f5973] bg-teal-50' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Track booking reference or download receipt"
          >
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Track Booking</span>
          </button>

          <button
            onClick={() => onNavigate('form')}
            className="px-5 sm:px-7 py-2.5 sm:py-3 bg-[#b87e2b] hover:bg-[#a66f24] active:scale-[0.99] text-white text-xs sm:text-sm font-bold uppercase tracking-wider rounded-lg shadow-sm hover:shadow transition-all cursor-pointer"
          >
            REGISTER / BOOK UNIT
          </button>
        </div>

      </div>
    </header>
  );
};
