import React from 'react';
import { LOGO_SRC } from '../bookingOptions.js';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = '',
  size = 'md',
  showName = true
}) => {
  const heightClass =
    size === 'sm' ? 'h-10 sm:h-12' :
    size === 'lg' ? 'h-20 sm:h-24' :
    'h-14 sm:h-16';

  const nameClass =
    size === 'sm' ? 'text-base' :
    size === 'lg' ? 'text-2xl sm:text-3xl' :
    'text-lg sm:text-xl';

  return (
    <a href="/" aria-label="Garg Realty Home" className={`flex items-center gap-2.5 ${className}`}>
      {/* Official Garg Realty logo mark (exact supplied logo-mark.png) */}
      <img
        src={LOGO_SRC}
        alt="Garg Realty Group - Official Logo"
        className={`${heightClass} w-auto object-contain`}
      />
      {showName && (
        <div className="leading-none">
          <p className={`${nameClass} font-semibold tracking-[0.2em] text-[#b87e2b] font-['Playfair_Display']`}>
            GARG
          </p>
          <p className="text-[10px] sm:text-[11px] font-bold tracking-[0.22em] text-[#0f5973] mt-1">
            REALTY GROUP
          </p>
        </div>
      )}
    </a>
  );
};
