import React, { useState } from 'react';
import {
  AlertOctagon,
  BookOpen,
  CheckCircle2,
  Clock,
  Lock,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  Tablet,
  Users,
} from 'lucide-react';
import { HelpArticleItem } from '../types/nexo.ts';
import { CORE_PLAIN_GUIDES } from '../components/layout/ContextualHelpModal.tsx';
import {
  type ManualTierId,
  PERMISSION_MATRIX_ROWS,
  ROLE_MANUAL_TIERS,
  TABLET_FIELD_TIPS,
} from '../lib/role-manual-data.ts';
import { AUTO_FEATURE_MANUALS } from '../lib/manual-registry.ts';
import { ROLE_LABELS } from '../lib/rbac.ts';

interface GuidePageProps {
  articles: HelpArticleItem[];
}

export const GuidePage: React.FC<GuidePageProps> = ({ articles }) => {
  const [search, setSearch] = useState('');
  const [selectedModule, setSelectedModule] = useState<string>('ALL');
  const [selectedTier, setSelectedTier] = useState<ManualTierId>('TODOS');

  const modules = Array.from(new Set(articles.map((a) => a.module)));
  const q = search.trim().toLowerCase();

  const filteredTiers = ROLE_MANUAL_TIERS.filter((tier) => {
    if (selectedTier !== 'TODOS' && tier.id !== selectedTier) return false;
    if (!q) return true;
    return (
      tier.title.toLowerCase().includes(q) ||
      tier.subtitle.toLowerCase().includes(q) ||
      tier.whatYouDo.some((s) => s.toLowerCase().includes(q)) ||
      tier.whatIsBlocked.some((s) => s.toLowerCase().includes(q)) ||
      tier.dailyChecklist.some((s) => s.toLowerCase().includes(q)) ||
      tier.criticalAlertsRule.toLowerCase().includes(q)
    );
  });

  const filteredPlainGuides = CORE_PLAIN_GUIDES.filter((g) => {
    if (!q) return true;
    return (
      g.title.toLowerCase().includes(q) ||
      g.summary.toLowerCase().includes(q) ||
      g.keywords.some((k) => k.includes(q)) ||
      g.steps.some((s) => s.toLowerCase().includes(q))
    );
  });

  const filteredArticles = articles.filter((a) => {
    if (selectedModule !== 'ALL' && a.module !== selectedModule) return false;
    if (!q) return true;
    return (
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q) ||
      a.module.toLowerCase().includes(q)
    );
  });

  const filteredAutoFeatures = AUTO_FEATURE_MANUALS.filter((feat) => {
    if (selectedModule !== 'ALL' && feat.sectionId !== selectedModule) return false;
    if (selectedTier !== 'TODOS') {
      const mappedRole =
        selectedTier === 'PCP_PLANEJAMENTO' ? 'SUPERVISOR' : selectedTier;
      if (!feat.targetRoles.includes(mappedRole)) return false;
    }
    if (!q) return true;
    return (
      feat.title.toLowerCase().includes(q) ||
      feat.summary.toLowerCase().includes(q) ||
      feat.content.toLowerCase().includes(q) ||
      feat.moduleLabel.toLowerCase().includes(q) ||
      feat.keywords.some((kw) => kw.toLowerCase().includes(q)) ||
      feat.steps.some((st) => st.toLowerCase().includes(q))
    );
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Banner Header */}
      <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#F5B91B]/30 bg-[#F5B91B]/10 text-[#F5B91B]">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                MANUAL OFICIAL DE OPERAÇÃO · TODOS OS ESCALÕES
              </p>
              <h2 className="font-display text-xl font-extrabold text-[#F4F6F8]">
                Guia Completo do NEXO LOG 2.0 — Da Moega à Administração
              </h2>
              <p className="mt-0.5 text-xs text-[#AEB8C5]">
                Selecione o seu cargo/escalão ou pesquise por qualquer palavra-chave do dia a dia.
              </p>
            </div>
          </div>

          <div className="relative w-full sm:w-96">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#AEB8C5]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar (caminhão, cesta, etiqueta, bloqueio, turno, silo)..."
              className="min-h-[46px] w-full rounded-xl border border-[#AEB8C5]/25 bg-[#0A1421] pl-9 pr-3 text-sm text-[#F4F6F8] placeholder:text-[#AEB8C5]/50 focus:border-[#F5B91B] focus:outline-none"
            />
          </div>
        </div>

        {/* Filtro rápido por Escalão */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#AEB8C5]/10 pt-4">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#AEB8C5] mr-1">
            <Users className="h-4 w-4 text-[#F5B91B]" />
            Meu Escalão:
          </span>
          {(
            [
              { id: 'TODOS', label: 'Todos os Escalões' },
              { id: 'OPERADOR_MOEGA', label: 'Operador Moega' },
              { id: 'PRODUCAO', label: 'Produção' },
              { id: 'PCP_PLANEJAMENTO', label: 'Planejamento / PCP' },
              { id: 'SUPERVISOR', label: 'Supervisão' },
              { id: 'ADMIN', label: 'Administrador' },
            ] as Array<{ id: ManualTierId; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSelectedTier(tab.id)}
              className={`min-h-[40px] rounded-xl px-3.5 text-xs font-bold transition-colors ${
                selectedTier === tab.id
                  ? 'bg-[#F5B91B] text-[#0A1421]'
                  : 'border border-[#AEB8C5]/20 bg-[#0A1421] text-[#AEB8C5] hover:border-[#F5B91B]/50 hover:text-[#F4F6F8]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Seção 1: Manuais por Escalão */}
      <section className="space-y-4">
        <div>
          <h3 className="font-display text-base font-extrabold text-[#F4F6F8]">
            1. Responsabilidades, Rotina e Travas de Segurança por Escalão ({filteredTiers.length})
          </h3>
          <p className="text-xs text-[#AEB8C5]">
            Cada funcionário enxerga claramente o que faz no sistema, o que é protegido por trava de segurança e qual checklist seguir no turno.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredTiers.map((tier) => (
            <article
              key={tier.id}
              className="flex flex-col justify-between space-y-4 rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5"
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[#AEB8C5]/10 pb-3">
                  <div>
                    <h4 className="font-display text-lg font-extrabold text-[#F4F6F8]">
                      {tier.title}
                    </h4>
                    <p className="mt-0.5 text-xs text-[#AEB8C5]">{tier.subtitle}</p>
                  </div>
                  <span
                    className={`rounded-lg border bg-[#0A1421] px-2.5 py-1 text-[11px] font-bold ${tier.accentColor}`}
                  >
                    {tier.badge}
                  </span>
                </div>

                {/* O que você faz */}
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    O que este perfil executa no NEXO LOG
                  </p>
                  <ul className="space-y-1 text-xs text-[#F4F6F8]/90">
                    {tier.whatYouDo.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Bloqueios */}
                <div className="space-y-1.5 rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
                    <Lock className="h-3.5 w-3.5" />
                    Travas e Restrições de Segurança
                  </p>
                  <ul className="space-y-1 text-xs text-[#AEB8C5]">
                    {tier.whatIsBlocked.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Checklist do turno */}
                <div className="space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#60A5FA]">
                    Checklist Obrigatório do Turno
                  </p>
                  <ol className="space-y-1.5">
                    {tier.dailyChecklist.map((chk, idx) => (
                      <li key={chk} className="flex items-start gap-2 text-xs text-[#AEB8C5]">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#3B82F6]/40 bg-[#0A1421] font-mono-tabular text-[11px] font-bold text-[#60A5FA]">
                          {idx + 1}
                        </span>
                        <span className="leading-relaxed text-[#F4F6F8]/85">{chk}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border border-red-500/35 bg-red-950/20 p-3 text-xs text-red-100">
                <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <p className="leading-relaxed">
                  <span className="font-bold">Regra de Alerta Crítico: </span>
                  {tier.criticalAlertsRule}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Seção 2: Matriz Resumida de Permissões */}
      <section className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="flex items-center gap-2 border-b border-[#AEB8C5]/15 pb-3">
          <ShieldCheck className="h-5 w-5 text-[#F5B91B]" />
          <div>
            <h3 className="font-display text-base font-extrabold text-[#F4F6F8]">
              2. Matriz Oficial de Permissões por Escalão (RBAC)
            </h3>
            <p className="text-xs text-[#AEB8C5]">
              Todas as permissões são validadas pelo servidor e gravadas em auditoria imutável.
            </p>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#AEB8C5]/15 text-[#AEB8C5]">
                <th className="py-2.5 pr-3 font-bold">Operação / Módulo</th>
                <th className="px-3 py-2.5 font-bold text-[#60A5FA]">Operador Moega</th>
                <th className="px-3 py-2.5 font-bold text-orange-300">Produção</th>
                <th className="px-3 py-2.5 font-bold text-emerald-300">Supervisão / PCP</th>
                <th className="pl-3 py-2.5 font-bold text-[#F5B91B]">Administrador</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#AEB8C5]/10">
              {PERMISSION_MATRIX_ROWS.map((row) => (
                <tr key={row.capability} className="hover:bg-[#152336]/60">
                  <td className="py-2.5 pr-3 font-semibold text-[#F4F6F8]">{row.capability}</td>
                  <td className="px-3 py-2.5 text-[#AEB8C5]">{row.operador}</td>
                  <td className="px-3 py-2.5 text-[#AEB8C5]">{row.producao}</td>
                  <td className="px-3 py-2.5 text-[#AEB8C5]">{row.supervisor}</td>
                  <td className="pl-3 py-2.5 font-semibold text-[#F5B91B]">{row.admin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Seção 3: Guias Práticos do Dia a Dia */}
      <section className="space-y-3">
        <div>
          <h3 className="font-display text-base font-extrabold text-[#F4F6F8]">
            3. Guias Práticos Passo a Passo ({filteredPlainGuides.length})
          </h3>
          <p className="text-xs text-[#AEB8C5]">
            Explicações diretas em linguagem cotidiana para uso rápido na Moega, Produção e Supervisão.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredPlainGuides.map((guide) => (
            <div
              key={guide.id}
              className="rounded-2xl border border-[#F5B91B]/25 bg-[#101B2A] p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-display text-base font-extrabold text-[#F5B91B]">
                  {guide.title}
                </h4>
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              </div>
              <p className="text-xs font-medium text-[#F4F6F8]">{guide.summary}</p>
              <ol className="space-y-2 border-t border-[#AEB8C5]/10 pt-3">
                {guide.steps.map((step, idx) => (
                  <li key={step} className="flex items-start gap-2.5 text-xs">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A1421] font-mono-tabular text-[11px] font-bold text-[#F5B91B] border border-[#F5B91B]/30">
                      {idx + 1}
                    </span>
                    <span className="leading-relaxed text-[#AEB8C5]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      {/* Reference Cards: Colors, Shifts & Rugged Tablet */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-[#F4F6F8]">
            <Palette className="h-4 w-4 text-[#F5B91B]" />
            <span>Significado Visual das Cores</span>
          </div>
          <div className="mt-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2 border-b border-[#AEB8C5]/10 pb-2">
              <span className="font-semibold text-[#3B82F6]">Azul — Silos de Linha</span>
              <span className="text-right text-[#AEB8C5]">Linhas 1 a 6 e Moega</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-[#AEB8C5]/10 pb-2">
              <span className="font-semibold text-emerald-400">Verde — Armazenagem / OK</span>
              <span className="text-right text-[#AEB8C5]">Silos 42–34 e regular</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-[#AEB8C5]/10 pb-2">
              <span className="font-semibold text-orange-400">Laranja — Produção / Baixo</span>
              <span className="text-right text-[#AEB8C5]">Silos 43–64 ou atenção</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-[#AEB8C5]/10 pb-2">
              <span className="font-semibold text-[#F5B91B]">Amarelo — Conferência</span>
              <span className="text-right text-[#AEB8C5]">Revisão manual obrigatória</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-red-400">Vermelho — Crítico / Travado</span>
              <span className="text-right text-[#AEB8C5]">Falta, bloqueio ou manutenção</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-[#F4F6F8]">
            <Clock className="h-4 w-4 text-[#F5B91B]" />
            <span>Horários Oficiais de Turno</span>
          </div>
          <div className="mt-4 space-y-2.5 text-xs text-[#AEB8C5]">
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
              <p className="font-semibold text-[#F4F6F8]">1º Turno · 07:30 às 17:18</p>
              <p className="mt-0.5">Turno diurno no mesmo dia.</p>
            </div>
            <div className="rounded-xl border border-[#F5B91B]/30 bg-[#0A1421] p-3">
              <p className="font-semibold text-[#F5B91B]">2º Turno · 17:00 às 02:12 (Cruza Meia-Noite)</p>
              <p className="mt-0.5">
                Registros após 00:00 continuam automaticamente na data operacional de início.
              </p>
            </div>
            <div className="rounded-xl border border-[#F5B91B]/30 bg-[#0A1421] p-3">
              <p className="font-semibold text-[#F5B91B]">3º Turno · 23:28 às 07:30 (Cruza Meia-Noite)</p>
              <p className="mt-0.5">
                Preserva a data operacional do início do turno até 07:29.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-[#F4F6F8]">
            <Tablet className="h-4 w-4 text-[#F5B91B]" />
            <span>Boas Práticas no Tablet Robusto</span>
          </div>
          <ul className="mt-4 space-y-2.5 text-xs text-[#AEB8C5]">
            {TABLET_FIELD_TIPS.map((tip, idx) => (
              <li key={tip} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0A1421] font-mono-tabular text-[11px] font-bold text-[#F5B91B]">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Procedimentos Detalhados do Banco */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-base font-extrabold text-[#F4F6F8]">
            4. Procedimentos Técnicos por Módulo ({filteredArticles.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedModule('ALL')}
              className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold ${
                selectedModule === 'ALL'
                  ? 'bg-[#F5B91B] text-[#0A1421]'
                  : 'border border-[#AEB8C5]/20 bg-[#0A1421] text-[#AEB8C5]'
              }`}
            >
              Todos ({articles.length})
            </button>
            {modules.map((mod) => (
              <button
                key={mod}
                type="button"
                onClick={() => setSelectedModule(mod)}
                className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold uppercase ${
                  selectedModule === mod
                    ? 'bg-[#F5B91B] text-[#0A1421]'
                    : 'border border-[#AEB8C5]/20 bg-[#0A1421] text-[#AEB8C5]'
                }`}
              >
                {mod}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredArticles.map((art) => (
            <article
              key={art.id}
              className="space-y-2 rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[#F5B91B]">
                Módulo: {art.module}
              </p>
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">{art.title}</h3>
              <p className="text-xs font-medium text-[#F4F6F8]/85">{art.summary}</p>
              <p className="pt-1 text-xs leading-relaxed text-[#AEB8C5]">{art.content}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Seção 5: Registro Automático de Instruções por Funcionalidade */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-[#101B2A] p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-emerald-300">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-extrabold text-[#F4F6F8]">
                5. Instruções Sincronizadas Automaticamente por Funcionalidade ({filteredAutoFeatures.length})
              </h3>
              <p className="mt-0.5 text-xs text-[#AEB8C5]">
                Padrão da plataforma: toda nova funcionalidade adicionada ao NEXO LOG 2.0 gera automaticamente seu passo a passo aqui, no botão COMO UTILIZAR? e no catálogo do banco.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredAutoFeatures.map((feat) => (
            <article
              key={feat.id}
              className="flex flex-col justify-between space-y-3 rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5"
            >
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded bg-[#0A1421] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#F5B91B] border border-[#F5B91B]/30">
                    {feat.moduleLabel}
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-300">
                    {feat.addedInStage}
                  </span>
                </div>
                <h4 className="font-display text-base font-bold text-[#F4F6F8]">{feat.title}</h4>
                <p className="text-xs font-medium text-[#F4F6F8]/85">{feat.summary}</p>
                <ol className="space-y-1.5 border-t border-[#AEB8C5]/10 pt-2.5">
                  {feat.steps.map((step, idx) => (
                    <li key={step} className="flex items-start gap-2 text-xs text-[#AEB8C5]">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-500/35 bg-[#0A1421] font-mono-tabular text-[11px] font-bold text-emerald-300">
                        {idx + 1}
                      </span>
                      <span className="leading-relaxed text-[#F4F6F8]/90">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 border-t border-[#AEB8C5]/10 pt-2.5">
                <span className="text-[11px] font-semibold text-[#AEB8C5] mr-1">Perfis:</span>
                {feat.targetRoles.map((r) => (
                  <span
                    key={r}
                    className="rounded border border-[#AEB8C5]/20 bg-[#0A1421] px-2 py-0.5 text-[10px] font-bold text-[#60A5FA]"
                  >
                    {ROLE_LABELS[r]}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
