import React from 'react';

interface BrandLogoProps {
  className?: string;
  showTagline?: boolean;
  light?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ 
  className = '', 
  showTagline = true,
  light = false 
}) => {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Garg Realty Group Crest Icon */}
      <div className="relative w-10 h-10 flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-[#0f5973] to-[#093d50] text-white rounded-lg shadow-sm border border-teal-800/30">
        <svg viewBox="0 0 40 40" fill="none" className="w-7 h-7" xmlns="http://www.w3.org/2000/svg">
          {/* Hexagonal Shield */}
          <path d="M20 4L34 11V23C34 30.5 28 35.5 20 38C12 35.5 6 30.5 6 23V11L20 4Z" stroke="#e0af53" strokeWidth="1.8" fill="#0b4559" />
          {/* Stylized Interlocking G Monogram */}
          <path d="M25 15C23.8 13.8 22 13 20 13C16.1 13 13 16.1 13 20C13 23.9 16.1 27 20 27C23.9 27 27 23.9 27 20H20" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div>
        <div className="flex items-center gap-1.5">
          <span className={`font-bold tracking-tight text-lg leading-tight uppercase font-['Playfair_Display'] ${light ? 'text-white' : 'text-[#0f5973]'}`}>
            GARG REALTY GROUP
          </span>
        </div>
        {showTagline && (
          <p className={`text-[10px] tracking-widest uppercase font-semibold ${light ? 'text-teal-200/90' : 'text-[#b87e2b]'}`}>
            DRIVEN BY TRUST, DEFINED BY EXCELLENCE.
          </p>
        )}
      </div>
    </div>
  );
};
