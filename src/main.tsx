import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (import.meta.env.DEV && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    })
    .catch(() => {
      // ignore service worker cleanup error in restricted frames
    });
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<
  {children: React.ReactNode},
  ErrorBoundaryState
> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = {hasError: false, message: ''};
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Erro inesperado ao renderizar a interface.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('NEXO LOG UI ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0A1421] text-[#F4F6F8] flex items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-red-500/40 bg-[#101B2A] p-6 sm:p-8 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#F5B91B]">
              NEXO LOG 2.0 · Recuperação de Interface
            </p>
            <h1 className="mt-2 font-display text-2xl font-bold text-[#F4F6F8]">
              Ocorreu uma falha inesperada na tela
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-[#AEB8C5]">
              Para proteger os dados da operação, a exibição foi interrompida com segurança.
            </p>
            {this.state.message && (
              <p className="mt-3 rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 font-mono text-xs text-red-200 break-words">
                {this.state.message}
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] rounded-lg bg-[#F5B91B] px-5 py-2.5 text-sm font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
              >
                Recarregar Sistema
              </button>
              <button
                type="button"
                onClick={() => {
                  window.location.assign('/?apresentacao=1');
                }}
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/30 bg-[#152336] px-5 py-2.5 text-sm font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
              >
                Abrir Modo Apresentação
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
