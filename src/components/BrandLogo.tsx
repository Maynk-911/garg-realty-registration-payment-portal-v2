import React from 'react';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ 
  className = '',
  size = 'md'
}) => {
  const heightClass = 
    size === 'sm' ? 'h-10 sm:h-12' :
    size === 'lg' ? 'h-20 sm:h-24' :
    'h-14 sm:h-16';

  return (
    <div className={`flex items-center ${className}`}>
      <img
        src="/garg-realty-logo-B43XToGZ.jpeg"
        alt="Garg Realty Group - Official Logo"
        className={`${heightClass} w-auto object-contain transition-transform duration-200`}
        onError={(e) => {
          // Fallback to relative or svg if needed
          const target = e.currentTarget;
          if (target.src.endsWith('.jpeg')) {
            target.src = '/garg-realty-logo.svg';
          }
        }}
      />
    </div>
  );
};
