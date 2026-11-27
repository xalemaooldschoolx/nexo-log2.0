import React from 'react';

interface NexoLogoProps {
  compact?: boolean;
  showTagline?: boolean;
}

export const NexoLogo: React.FC<NexoLogoProps> = ({ compact = false, showTagline = false }) => {
  return (
    <div className="flex items-center gap-3 shrink-0 select-none">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 470 380"
        className={compact ? 'h-9 w-11 shrink-0' : 'h-11 w-14 shrink-0'}
        aria-hidden="true"
      >
        <g stroke="#F5B91B" strokeWidth="14">
          <path d="M20 295H435" strokeLinecap="round" fill="none" />
          <path
            d="M40 145L100 85L160 145V290H40Z M175 110L240 45L305 110V290H175Z M320 145L380 85L440 145V290H320Z"
            fill="#F4F6F8"
          />
          <path d="M12 250C80 375 350 380 445 235" fill="none" strokeWidth="22" strokeLinecap="round" />
          <path
            d="M408 210L458 227L423 270"
            fill="none"
            strokeWidth="22"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>

      <div className="flex flex-col leading-none">
        <div className="flex items-baseline gap-1 font-display tracking-tight whitespace-nowrap">
          <span className={compact ? 'text-lg font-extrabold text-[#F4F6F8]' : 'text-2xl font-extrabold text-[#F4F6F8]'}>
            NEXO
          </span>
          <span className={compact ? 'text-lg font-extrabold text-[#F5B91B]' : 'text-2xl font-extrabold text-[#F5B91B]'}>
            LOG
          </span>
          <span className="text-xs font-bold text-[#F4F6F8]">2.0</span>
        </div>
        {showTagline && (
          <span className="mt-1 text-[10px] font-semibold tracking-[0.18em] text-[#AEB8C5] whitespace-nowrap">
            GESTÃO INTELIGENTE DA MOEGA
          </span>
        )}
      </div>
    </div>
  );
};
