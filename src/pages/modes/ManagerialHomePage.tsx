import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  GitCompare,
  LayoutGrid,
  PackageCheck,
  Presentation,
  Repeat,
  Truck,
} from 'lucide-react';
import { apiFetch, formatTons } from '../../lib/api.ts';
import { hasPermission } from '../../lib/rbac.ts';
import {
  DashboardResponse,
  NavSectionId,
  OperationalIndicatorsOverview,
  ProductionSupplyBoardResponse,
  SessionData,
  SiloDetail,
} from '../../types/nexo.ts';

interface ManagerialHomePageProps {
  session: SessionData;
  dashboard: DashboardResponse | null;
  silos: SiloDetail[];
  onNavigate: (section: NavSectionId) => void;
}

export const ManagerialHomePage: React.FC<ManagerialHomePageProps> = ({
  session,
  dashboard,
  silos,
  onNavigate,
}) => {
  const role = session.user.roleCode;
  const [overview, setOverview] = useState<OperationalIndicatorsOverview | null>(null);
  const [supplyBoard, setSupplyBoard] = useState<ProductionSupplyBoardResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<OperationalIndicatorsOverview>('/api/reports/overview').catch(() => null),
      apiFetch<ProductionSupplyBoardResponse>('/api/supply/board').catch(() => null),
    ]).then(([ov, sb]) => {
      if (cancelled) return;
      setOverview(ov);
      setSupplyBoard(sb);
    });
    return () => {
      cancelled = true;
    };
  }, [dashboard?.lastUpdated]);

  const criticalCount = silos.filter((s) => s.stockAlertLevel === 'CRITICO').length;
  const attentionCount = silos.filter((s) => s.stockAlertLevel === 'ATENCAO').length;
  const pendingRecs =
    supplyBoard?.recommendations.filter(
      (r) => r.decisionStatus !== 'REJEITADA' && r.decisionStatus !== 'EXECUTADA'
    ).length ?? 0;

  const rawBlocks: Array<{
    id: string;
    section: NavSectionId;
    title: string;
    metric: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: string;
    visible: boolean;
  }> = [
    {
      id: 'situacao-moega',
      section: 'painel',
      title: 'Situação da Moega',
      metric: `${dashboard?.kpis.operationalSilos ?? 0}/${dashboard?.kpis.totalSilos ?? 54} silos ativos`,
      desc: 'Visão geral das linhas L1 a L7, ocupação consolidada e pendências documentais.',
      icon: BarChart3,
      tone: 'border-[#3B82F6]/40 text-[#60A5FA]',
      visible: true,
    },
    {
      id: 'mapa-silos',
      section: 'mapa',
      title: 'Mapa Detalhado de Silos (2D / 3D)',
      metric: `${criticalCount} crítico(s) · ${attentionCount} baixo(s)`,
      desc: 'Croqui oficial com 54 silos, lotes por silo, livro razão e inspeção técnica.',
      icon: LayoutGrid,
      tone: criticalCount > 0 ? 'border-red-500/50 text-red-300' : 'border-emerald-500/40 text-emerald-300',
      visible: true,
    },
    {
      id: 'estoque',
      section: 'estoque',
      title: 'Estoque & Catálogo',
      metric: `${formatTons(dashboard?.kpis.totalConfirmedStockKg ?? 0)} confirmadas`,
      desc: 'Saldos reais por silo, matérias-primas, pesos de big bags e validações.',
      icon: Database,
      tone: 'border-emerald-500/40 text-emerald-300',
      visible: hasPermission(role, 'materials:view'),
    },
    {
      id: 'recebimentos',
      section: 'recebimentos',
      title: 'Recebimentos & Descargas',
      metric: `${overview?.performanceKpis.receiptsCount ?? 0} no período`,
      desc: 'Acompanhamento de entradas por fornecedor, nota fiscal, lote e descargas parciais.',
      icon: Truck,
      tone: 'border-[#3B82F6]/40 text-[#60A5FA]',
      visible: hasPermission(role, 'receipts:view'),
    },
    {
      id: 'consumo',
      section: 'consumo',
      title: 'Consumo & Projeção',
      metric: `${formatTons(overview?.performanceKpis.plannedConsumptionKg ?? 0)} previsto`,
      desc: 'Confronto entre estoque real, consumo previsto vs realizado e projeção hoje/amanhã.',
      icon: Activity,
      tone: 'border-[#F5B91B]/40 text-[#F5B91B]',
      visible: hasPermission(role, 'schedules:view'),
    },
    {
      id: 'programacao',
      section: 'programacao',
      title: 'Programação da Produção',
      metric: `${overview?.indicators.importedSchedulesCount ?? 0} programação(ões)`,
      desc: 'Importação assistida, revisão lado a lado, aprovação oficial e execução por linha.',
      icon: CalendarClock,
      tone: 'border-[#F5B91B]/40 text-[#F5B91B]',
      visible: hasPermission(role, 'schedules:view'),
    },
    {
      id: 'comparador-cestas',
      section: 'comparador',
      title: 'Comparador de Cestas de Consumo',
      metric: 'OCR IA + L1–L7',
      desc: 'Compare duas ou mais versões da programação por foto/planilha, publique e alerte o turno.',
      icon: GitCompare,
      tone: 'border-[#F5B91B]/50 text-[#F5B91B]',
      visible: hasPermission(role, 'baskets:view'),
    },
    {
      id: 'transferencias',
      section: 'transferencias',
      title: 'Transferências entre Silos',
      metric: `${overview?.indicators.transfersCompletedCount ?? 0} concluída(s)`,
      desc: 'Ordens planejadas, execução parcial, livro razão e estornos/ajustes autorizados.',
      icon: Repeat,
      tone: 'border-[#3B82F6]/40 text-[#60A5FA]',
      visible: hasPermission(role, 'supply:view'),
    },
    {
      id: 'abastecimento',
      section: 'abastecimento',
      title: 'Abastecimento & Rotas',
      metric: `${pendingRecs} recomendação(ões) ativa(s)`,
      desc: 'Painel de linhas com prioridades ponderadas, rotas autorizadas e análise IA.',
      icon: PackageCheck,
      tone: pendingRecs > 0 ? 'border-orange-500/50 text-orange-300' : 'border-emerald-500/40 text-emerald-300',
      visible: hasPermission(role, 'supply:view'),
    },
    {
      id: 'alertas-ocorrencias',
      section: 'ocorrencias',
      title: 'Alertas & Ocorrências',
      metric: `${overview?.indicators.openOccurrencesCount ?? 0} ocorrência(s) aberta(s)`,
      desc: 'Registro de desvios nas 12 categorias oficiais com evidências e tratativas.',
      icon: AlertTriangle,
      tone: 'border-orange-500/40 text-orange-300',
      visible: hasPermission(role, 'occurrences:view'),
    },
    {
      id: 'indicadores',
      section: 'relatorios',
      title: 'Indicadores & Relatórios',
      metric: 'Exportação PDF / XLSX / CSV',
      desc: 'Posição histórica reconstruída do livro razão, recebimentos, transferências e metas.',
      icon: FileSpreadsheet,
      tone: 'border-[#F5B91B]/40 text-[#F5B91B]',
      visible: hasPermission(role, 'reports:view'),
    },
    {
      id: 'turnos',
      section: 'turnos',
      title: 'Turnos & Passagem',
      metric: session.shift.shiftName,
      desc: 'Resumo cronológico automático, pendências com ciência obrigatória e troca de turno.',
      icon: ClipboardCheck,
      tone: 'border-emerald-500/40 text-emerald-300',
      visible: hasPermission(role, 'shifts:view'),
    },
    {
      id: 'assistente',
      section: 'assistente',
      title: 'NEXO Assistente (IA)',
      metric: 'Consulta somente leitura',
      desc: 'Perguntas em linguagem natural fundamentadas nos dados do PostgreSQL.',
      icon: Bot,
      tone: 'border-[#3B82F6]/40 text-[#60A5FA]',
      visible: hasPermission(role, 'assistant:use'),
    },
  ];
  const blocks = rawBlocks.filter((b) => b.visible);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Cabeçalho Gerencial Organizado */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 sm:p-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#F5B91B]">
            MODO GERENCIAL · SUPERVISÃO OPERACIONAL
          </p>
          <h1 className="font-display text-2xl font-extrabold text-[#F4F6F8]">
            Central da Supervisão da Moega
          </h1>
          <p className="text-sm text-[#AEB8C5]">
            Escolha um bloco abaixo para abrir os gráficos detalhados, filtros e comparativos completos.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('executivo')}
          className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#F5B91B] px-4 py-2.5 text-sm font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
        >
          <Presentation className="h-4 w-4" />
          <span>Apresentação Executiva</span>
        </button>
      </section>

      {/* Resumo Numérico Limpo (Sem tabelas densas na tela inicial) */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs text-[#AEB8C5]">Estoque Total Confirmado</p>
          <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-emerald-400">
            {formatTons(dashboard?.kpis.totalConfirmedStockKg ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs text-[#AEB8C5]">Silos em Atenção / Crítico</p>
          <p
            className={`mt-1 font-mono-tabular text-2xl font-extrabold ${
              criticalCount > 0
                ? 'text-red-400'
                : attentionCount > 0
                  ? 'text-orange-400'
                  : 'text-emerald-400'
            }`}
          >
            {criticalCount + attentionCount}
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs text-[#AEB8C5]">Necessidades Abastec.</p>
          <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-[#F5B91B]">
            {pendingRecs}
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs text-[#AEB8C5]">Ocorrências Abertas</p>
          <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
            {overview?.indicators.openOccurrencesCount ?? 0}
          </p>
        </div>
      </section>

      {/* Blocos Organizados com Drill-Down para Telas Completas */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {blocks.map((block) => {
          const Icon = block.icon;
          return (
            <button
              key={block.id}
              type="button"
              onClick={() => onNavigate(block.section)}
              className={`group flex min-h-[146px] flex-col justify-between rounded-2xl border bg-[#101B2A] p-5 text-left transition-all hover:bg-[#152336]/75 ${block.tone.split(' ')[0]}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421]">
                  <Icon className={`h-5 w-5 ${block.tone.split(' ')[1]}`} />
                </div>
                <span className="font-mono-tabular text-xs font-bold text-[#F4F6F8]">
                  {block.metric}
                </span>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-base font-bold text-[#F4F6F8] group-hover:text-[#F5B91B]">
                    {block.title}
                  </h2>
                  <ArrowRight className="h-4 w-4 text-[#AEB8C5] group-hover:text-[#F5B91B]" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[#AEB8C5]">{block.desc}</p>
              </div>
            </button>
          );
        })}
      </section>
    </div>
  );
};
