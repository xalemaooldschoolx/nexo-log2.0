import React, { useState } from 'react';
import { Check, Copy, Lock, Presentation, ShieldCheck, Smartphone, AlertTriangle } from 'lucide-react';
import { NexoLogo } from '../components/layout/NexoLogo.tsx';
import { useAuth } from '../hooks/useAuth.tsx';
import { PWAInstallButton } from '../components/pwa/PWAInstallButton.tsx';

export const LoginPage: React.FC = () => {
  const { signInWithGoogle, enterDemoMode, loading, authError } = useAuth();
  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyDirectLink = async () => {
    if (typeof window === 'undefined') return;
    const directUrl = `${window.location.origin}/?apresentacao=1`;
    try {
      await navigator.clipboard.writeText(directUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    } catch {
      // Clipboard blocked in restricted context; ignore silently
    }
  };

  return (
    <div className="min-h-screen bg-[#0A1421] text-[#F4F6F8] flex flex-col justify-between p-4 sm:p-8">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
        <NexoLogo showTagline />
        <PWAInstallButton />
      </header>

      <main className="mx-auto my-8 grid w-full max-w-6xl grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
        <section className="flex flex-col justify-between rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-6 sm:p-10 lg:col-span-7">
          <div>
            <p className="text-xs font-semibold tracking-wider text-[#F5B91B]">
              FASE 05 · PLATAFORMA OPERACIONAL DA MOEGA
            </p>
            <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-[#F4F6F8] sm:text-4xl [text-wrap:balance]">
              Mais informação, antecipação e controle na operação da Moega.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-[#AEB8C5]">
              Plataforma corporativa para controle de matérias-primas, mapa interativo de silos,
              recebimento por etiquetas e bags, programação da produção, transferências atômicas,
              indicadores operacionais e passagem de turnos.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 border-t border-[#AEB8C5]/15 pt-6 sm:grid-cols-3">
            <div>
              <p className="font-mono-tabular text-2xl font-bold text-[#F4F6F8]">54 Silos</p>
              <p className="mt-1 text-xs text-[#AEB8C5]">
                Linhas 1–6, Armazenagem (42–34) e Produção (43–64)
              </p>
            </div>
            <div>
              <p className="font-mono-tabular text-2xl font-bold text-[#F5B91B]">PostgreSQL</p>
              <p className="mt-1 text-xs text-[#AEB8C5]">
                Base transacional única com livro razão e auditoria imutável
              </p>
            </div>
            <div>
              <p className="font-mono-tabular text-2xl font-bold text-[#F4F6F8]">Fases 1–5</p>
              <p className="mt-1 text-xs text-[#AEB8C5]">
                Recebimento, Programação, Abastecimento, Relatórios e Turnos
              </p>
            </div>
          </div>
        </section>

        <section className="flex flex-col justify-center rounded-xl border border-[#AEB8C5]/20 bg-[#152336] p-6 sm:p-10 lg:col-span-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#F5B91B]/40 bg-[#F5B91B]/10 text-[#F5B91B]">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-[#F4F6F8]">Acesso Operacional</h2>
              <p className="text-xs text-[#AEB8C5]">Autenticação individual ou apresentação à supervisão</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {authError && (
              <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3.5 text-sm text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={loading}
              className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-lg bg-[#F5B91B] px-5 py-3 text-base font-bold text-[#0A1421] transition-colors hover:bg-[#F5B91B]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="h-5 w-5" />
              <span>{loading ? 'Validando sessão...' : 'Entrar com Conta Autorizada'}</span>
            </button>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-[#AEB8C5]/15" />
              <span className="mx-3 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[#AEB8C5]">
                Demonstração Supervisão
              </span>
              <div className="flex-grow border-t border-[#AEB8C5]/15" />
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={enterDemoMode}
                disabled={loading}
                className="flex min-h-[52px] w-full items-center justify-center gap-3 rounded-lg border border-[#3B82F6]/60 bg-[#0A1421] px-5 py-3 text-sm font-bold text-[#F4F6F8] transition-colors hover:border-[#F5B91B] hover:bg-[#101B2A] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Presentation className="h-5 w-5 text-[#F5B91B]" />
                <span>Entrar no Modo Apresentação Executiva</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  void handleCopyDirectLink();
                }}
                className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421]/60 px-4 py-2 text-xs font-semibold text-[#AEB8C5] transition-colors hover:border-[#F5B91B] hover:text-[#F4F6F8]"
              >
                {linkCopied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" />
                    <span className="text-emerald-300">Link direto copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-[#F5B91B]" />
                    <span>Copiar Link Direto para Apresentação (?apresentacao=1)</span>
                  </>
                )}
              </button>
            </div>

            <div className="rounded-lg border border-[#3B82F6]/30 bg-[#0A1421]/75 p-4 text-xs leading-relaxed text-[#AEB8C5]">
              <p className="font-semibold text-[#F4F6F8]">Catálogo Real + Sandbox Isolado</p>
              <p className="mt-1">
                O Modo Apresentação sincroniza os 54 silos, capacidades reais (1.173,66 t seguras),
                27 matérias-primas, fornecedores e regras do PostgreSQL em somente leitura, permitindo
                alternar entre o cenário operacional demonstrativo e o espelho ao vivo do banco sem
                registrar movimentações reais.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#AEB8C5]">
              <Smartphone className="h-4 w-4 text-[#F5B91B]" />
              <span>Interface adaptada para celular, tablet Android robusto e desktop.</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-[#AEB8C5]/10 pt-4 text-xs text-[#AEB8C5]">
        <span>NEXO LOG 2.0 · Gestão Inteligente da Moega</span>
        <span>Arquitetura Independente · Fases 1 a 5 (Pré-Fase 6)</span>
      </footer>
    </div>
  );
};
