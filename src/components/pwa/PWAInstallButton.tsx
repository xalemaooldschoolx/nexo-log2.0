import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall.ts';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#F5B91B]/50 bg-[#F5B91B]/15 px-3.5 py-2 text-xs font-semibold text-[#F5B91B] transition-colors hover:bg-[#F5B91B]/25 whitespace-nowrap shrink-0"
      >
        <Download className="h-4 w-4" />
        <span>Instalar App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/30 bg-[#152336] px-3.5 py-2 text-xs font-medium text-[#F4F6F8] transition-colors hover:border-[#F5B91B]/50 whitespace-nowrap shrink-0"
        >
          <Smartphone className="h-4 w-4 text-[#F5B91B]" />
          <span>Instalar Tablet</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] p-6 text-[#F4F6F8]">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold">Instalar NEXO LOG 2.0</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A2B42]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[#AEB8C5]">
                1. Toque no botão <strong className="text-[#F4F6F8]">Compartilhar</strong> na barra do navegador.
                <br />
                2. Selecione <strong className="text-[#F4F6F8]">Adicionar à Tela de Início</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 min-h-[44px] w-full rounded-lg bg-[#F5B91B] px-4 py-2.5 text-sm font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
              >
                Entendido
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
