import React from 'react';

interface IllustrationProps {
  className?: string;
}

export const TruckUnloadIllustration: React.FC<IllustrationProps> = ({ className = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="6" y="22" width="32" height="20" rx="3" fill="#152336" stroke="#3B82F6" strokeWidth="2.5" />
    <path d="M38 28H50L56 35V42H38V28Z" fill="#152336" stroke="#F5B91B" strokeWidth="2.5" strokeLinejoin="round" />
    <circle cx="18" cy="46" r="5" fill="#0A1421" stroke="#F4F6F8" strokeWidth="2.5" />
    <circle cx="48" cy="46" r="5" fill="#0A1421" stroke="#F4F6F8" strokeWidth="2.5" />
    <path d="M22 10V18M22 18L17 13M22 18L27 13" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="6" y1="54" x2="58" y2="54" stroke="#AEB8C5" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const BarcodeLabelIllustration: React.FC<IllustrationProps> = ({ className = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="10" y="14" width="44" height="36" rx="5" fill="#152336" stroke="#F5B91B" strokeWidth="2.5" />
    <path d="M18 24V40M23 24V40M27 24V40M33 24V40M38 24V40M44 24V40" stroke="#F4F6F8" strokeWidth="2.4" strokeLinecap="round" />
    <line x1="12" y1="32" x2="52" y2="32" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M8 20V12H16M56 20V12H48M8 44V52H16M56 44V52H48" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SiloRowIllustration: React.FC<IllustrationProps> = ({ className = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M11 20C11 15 16 12 20 12C24 12 29 15 29 20V44L20 53L11 44V20Z" fill="#152336" stroke="#3B82F6" strokeWidth="2.5" strokeLinejoin="round" />
    <rect x="14" y="28" width="12" height="14" rx="1.5" fill="#3B82F6" fillOpacity="0.45" />
    <path d="M35 16C35 11 40 8 44 8C48 8 53 11 53 16V44L44 53L35 44V16Z" fill="#152336" stroke="#10B981" strokeWidth="2.5" strokeLinejoin="round" />
    <rect x="38" y="22" width="12" height="20" rx="1.5" fill="#10B981" fillOpacity="0.45" />
  </svg>
);

export const ScaleDischargeIllustration: React.FC<IllustrationProps> = ({ className = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="14" y="18" width="36" height="28" rx="4" fill="#152336" stroke="#F5B91B" strokeWidth="2.5" />
    <path d="M22 18V13C22 10.5 26 9 32 9C38 9 42 10.5 42 13V18" stroke="#AEB8C5" strokeWidth="2.5" />
    <path d="M25 32L30 37L40 26" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="10" y1="53" x2="54" y2="53" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const TransferPipesIllustration: React.FC<IllustrationProps> = ({ className = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="8" y="16" width="16" height="32" rx="4" fill="#152336" stroke="#3B82F6" strokeWidth="2.5" />
    <rect x="40" y="16" width="16" height="32" rx="4" fill="#152336" stroke="#10B981" strokeWidth="2.5" />
    <path d="M25 27H39M39 27L34 22M39 27L34 32" stroke="#F5B91B" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M39 39H25M25 39L30 34M25 39L30 44" stroke="#AEB8C5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const FactoryFeedIllustration: React.FC<IllustrationProps> = ({ className = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M10 50V26L24 34V26L38 34V18H54V50H10Z" fill="#152336" stroke="#F97316" strokeWidth="2.5" strokeLinejoin="round" />
    <rect x="18" y="40" width="8" height="10" rx="1" fill="#F5B91B" fillOpacity="0.6" />
    <rect x="31" y="40" width="8" height="10" rx="1" fill="#F5B91B" fillOpacity="0.6" />
    <rect x="43" y="25" width="5" height="12" rx="1" fill="#10B981" />
  </svg>
);

export const AlertBellIllustration: React.FC<IllustrationProps> = ({ className = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <path d="M32 10L54 48H10L32 10Z" fill="#152336" stroke="#EF4444" strokeWidth="2.5" strokeLinejoin="round" />
    <line x1="32" y1="24" x2="32" y2="35" stroke="#F5B91B" strokeWidth="3.2" strokeLinecap="round" />
    <circle cx="32" cy="42" r="2.2" fill="#F5B91B" />
  </svg>
);

export const ChecklistClipboardIllustration: React.FC<IllustrationProps> = ({ className = 'h-12 w-12' }) => (
  <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
    <rect x="14" y="13" width="36" height="42" rx="4" fill="#152336" stroke="#10B981" strokeWidth="2.5" />
    <rect x="24" y="8" width="16" height="8" rx="2" fill="#0A1421" stroke="#F5B91B" strokeWidth="2" />
    <path d="M21 26L25 30L31 23" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="35" y1="27" x2="44" y2="27" stroke="#F4F6F8" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M21 38L25 42L31 35" stroke="#F5B91B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="35" y1="39" x2="44" y2="39" stroke="#AEB8C5" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
