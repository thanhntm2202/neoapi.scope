import React from 'react';

interface NeoScopeLogoProps {
  size?: number;
  showText?: boolean;
}

export const NeoScopeLogo: React.FC<NeoScopeLogoProps> = ({ size = 32, showText = true }) => (
  <div className="brand-lockup">
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="brand-svg"
    >
      <defs>
        <linearGradient id="nsGrad" x1="2" y1="2" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0D9488" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="32" height="32" rx="9" fill="url(#nsGrad)" />
      <rect x="8.5" y="19" width="3.5" height="8" rx="1.2" fill="#FFFFFF" fillOpacity="0.88" />
      <rect x="14" y="14.5" width="3.5" height="12.5" rx="1.2" fill="#FFFFFF" />
      <rect x="19.5" y="10" width="3.5" height="17" rx="1.2" fill="#FFFFFF" fillOpacity="0.95" />
      <path
        d="M8.5 14.5C12.5 13 15.5 9.5 26 9.5"
        stroke="#A7F3D0"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="26" cy="9.5" r="2.2" fill="#FFFFFF" />
    </svg>
    {showText && (
      <span className="brand-wordmark">NeoScope</span>
    )}
  </div>
);
