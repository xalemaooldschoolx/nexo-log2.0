import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Database,
  Eye,
  FileSpreadsheet,
  Info,
  Layers,
  LayoutGrid,
  PackageCheck,
  Presentation,
  QrCode,
  Repeat,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingUp,
  Truck,
} from 'lucide-react';
import {
  DashboardResponse,
  InventoryMovementItem,
  MaterialItem,
  NavSectionId,
  OperationalIndicatorsOverview,
  PresentationViewMode,
  ProductionScheduleView,
  ProductionSupplyBoardResponse,
  SiloDetail,
} from '../types/nexo.ts';
import type { PresentationMetaSnapshot } from '../lib/demo-api.ts';
import { apiFetch, formatKg, formatTons } from '../lib/api.ts';

interface ExecutivePresentationPageProps {
  isDemoMode: boolean;
  presentationViewMode?: PresentationViewMode;
  demoHydrationVersion?: number;
  dashboard: DashboardResponse | null;
  silos: SiloDetail[];
  materials: MaterialItem[];
  onNavigate: (section: NavSectionId) => void;
  onEnterDemoMode?: () => void;
  onExitDemoMode?: () => Promise<void>;
  onResetDemo?: () => void;
  onSwitchPresentationMode?: (mode: PresentationViewMode) => void;
}

const STRATEGIC_OBJECTIVES = [
  'Centralizar em tempo real o controle de estoque da Moega nos 54 silos oficiais (Linhas 1–6, Armazenagem 42–34 e Produção 43–64).',
  'Rastrear cada carga recebida por nota fiscal, fornecedor, lote e rateio multi-silo (granel e big bags) sem duplicidades.',
  'Integrar programação da produção e consumo previsto para antecipar faltas antes da parada de linha.',
  'Controlar transferências entre silos com débito e crédito atômicos na mesma transação e respeito às rotas autorizadas.',
  'Sinalizar visualmente níveis baixos, críticos, bloqueios e recebimentos em andamento no croqui operacional.',
  'Organizar passagem de turnos, ocorrências operacionais e relatórios auditados com exportação imediata.',
  'Manter trilha de auditoria imutável e governança por perfil (Administrador, Supervisor, Operador Moega e Produção).',
];

const QUALITATIVE_BENEFITS = [
  {
    title: 'Antecipação de Faltas e Paradas',
    desc: 'Confronto contínuo entre saldo confirmado nos silos de linha, programação aprovada e rotas disponíveis na Armazenagem.',
  },
  {
    title: 'Redução de Retrabalho e Ruído',
    desc: 'Substituição de apontamentos dispersos por registro único de recebimento, leitura de etiquetas e passagem de serviço padronizada.',
  },
  {
    title: 'Rastreabilidade Completa por Lote',
    desc: 'Histórico vinculando caminhão/NF, leitura de código de barras ou imagem, distribuição entre silos e consumo/transferência.',
  },
  {
    title: 'Decisão Segura na Supervisão',
    desc: 'Separação clara entre dados validados, pendências documentais e recomendações operacionais com confirmação humana.',
  },
];

const TRANSPARENCY_MATRIX: Array<{
  area: string;
  phase: string;
  status: 'FUNCIONAL' | 'DEMO' | 'PENDENTE';
  detail: string;
}> = [
  {
    area: 'Autenticação, RBAC e Auditoria Imutável',
    phase: 'Fase 1',
    status: 'FUNCIONAL',
    detail: '4 perfis operacionais no PostgreSQL + Firebase Auth; em Modo Demo roda isolado na memória.',
  },
  {
    area: 'Mapa Visual Interativo (54 Silos Oficiais)',
    phase: 'Fases 1–5',
    status: 'FUNCIONAL',
    detail: 'Disposição fiel sem silos 27/30, 5 estados visuais e gaveta com livro razão por lote.',
  },
  {
    area: 'Recebimentos, Big Bags, Rateio Multi-Silo & Etiquetas',
    phase: 'Fase 2',
    status: 'FUNCIONAL',
    detail: 'Leitura ZXing / Gemini Vision e controle de descarga parcial com anti-duplicação de lote.',
  },
  {
    area: 'Programação da Produção & Inteligência de Consumo',
    phase: 'Fase 3',
    status: 'FUNCIONAL',
    detail: 'Importação PDF/imagem/planilha, fatores por produto e projeção hoje/amanhã.',
  },
  {
    area: 'Transferências Atômicas, Rotas & Painel de Abastecimento',
    phase: 'Fase 4',
    status: 'FUNCIONAL',
    detail: 'Ordens parciais/totais, matriz de rotas autorizadas e recomendações ponderadas.',
  },
  {
    area: 'Relatórios, Turnos, Passagem, Ocorrências & Assistente IA',
    phase: 'Fase 5',
    status: 'FUNCIONAL',
    detail: 'Exportação auditada CSV/XLSX/PDF, passagem cronológica e consulta somente leitura.',
  },
  {
    area: 'Apresentação Executiva Sincronizada com PostgreSQL',
    phase: 'Apresentação',
    status: 'DEMO',
    detail: 'Catálogo, capacidades dos 54 silos, turnos, regras de transferência e contadores reais sincronizam em somente leitura do PostgreSQL, com alternância entre Cenário Operacional e Espelho Ao Vivo do Banco.',
  },
  {
    area: 'Treinamento, Qualificação e Certificação Operacional',
    phase: 'Fase 6 (Não Iniciada)',
    status: 'PENDENTE',
    detail: 'Mantida fora do escopo atual conforme solicitação; será desenvolvida somente na Fase 6.',
  },
  {
    area: 'Integração Direta Automática via API com Sensor Sistemas / ERP',
    phase: 'Pós-Implantação',
    status: 'PENDENTE',
    detail: 'Atualmente operada por importação assistida de relatórios (PDF/XLSX/CSV/Foto) sem leitura automática de banco externo.',
  },
];

export const ExecutivePresentationPage: React.FC<ExecutivePresentationPageProps> = ({
  isDemoMode,
  presentationViewMode = 'CENARIO_REALISTA',
  demoHydrationVersion = 0,
  dashboard,
  silos,
  materials,
  onNavigate,
  onEnterDemoMode,
  onExitDemoMode,
  onResetDemo,
  onSwitchPresentationMode,
}) => {
  const [overview, setOverview] = useState<OperationalIndicatorsOverview | null>(null);
  const [supplyBoard, setSupplyBoard] = useState<ProductionSupplyBoardResponse | null>(null);
  const [schedules, setSchedules] = useState<ProductionScheduleView[]>([]);
  const [movements, setMovements] = useState<InventoryMovementItem[]>([]);
  const [presentationMeta, setPresentationMeta] = useState<PresentationMetaSnapshot | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [loadingExtras, setLoadingExtras] = useState(false);

  const handleCopyPresentationLink = async () => {
    if (typeof window === 'undefined') return;
    const directUrl = `${window.location.origin}/?apresentacao=1`;
    try {
      await navigator.clipboard.writeText(directUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 3000);
    } catch {
      // Clipboard blocked in restricted iframe
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingExtras(true);
    Promise.all([
      apiFetch<OperationalIndicatorsOverview>('/api/reports/overview').catch(() => null),
      apiFetch<ProductionSupplyBoardResponse>('/api/supply/board').catch(() => null),
      apiFetch<ProductionScheduleView[]>('/api/schedules').catch(() => []),
      apiFetch<InventoryMovementItem[]>('/api/movements').catch(() => []),
      isDemoMode
        ? apiFetch<PresentationMetaSnapshot>('/api/presentation/meta').catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([ov, sb, sch, mov, meta]) => {
        if (cancelled) return;
        setOverview(ov);
        setSupplyBoard(sb);
        setSchedules(Array.isArray(sch) ? sch : []);
        setMovements(Array.isArray(mov) ? mov : []);
        setPresentationMeta(meta);
      })
      .finally(() => {
        if (!cancelled) setLoadingExtras(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDemoMode, presentationViewMode, demoHydrationVersion, dashboard?.lastUpdated]);

  const siloStatusCounts = useMemo(() => {
    let available = 0;
    let attention = 0;
    let critical = 0;
    let receiving = 0;
    let unavailable = 0;
    for (const s of silos) {
      const blocked = s.operationalStatus === 'BLOQUEADO' || s.operationalStatus === 'MANUTENCAO';
      if (blocked) unavailable += 1;
      else if (s.stockAlertLevel === 'CRITICO') critical += 1;
      else if (s.stockAlertLevel === 'ATENCAO') attention += 1;
      else available += 1;
      if (s.isReceiving) receiving += 1;
    }
    return { available, attention, critical, receiving, unavailable };
  }, [silos]);

  const operationalDate = dashboard?.shift.operationalDate;
  const shiftMovementsCount = useMemo(() => {
    if (!operationalDate) return movements.length;
    return movements.filter((m) => m.operationalDate === operationalDate).length;
  }, [movements, operationalDate]);

  const totalStockKg = dashboard?.kpis.totalConfirmedStockKg ?? 0;
  const safeCapKg = dashboard?.kpis.totalSafeCapacityKg ?? 0;
  const occupiedCount = dashboard?.kpis.occupiedSilos ?? 0;
  const operationalCount = dashboard?.kpis.operationalSilos ?? 0;
  const lowStockCount = siloStatusCounts.attention + siloStatusCounts.critical;
  const supplyNeedsCount =
    supplyBoard?.recommendations.filter((r) => r.decisionStatus !== 'REJEITADA' && r.decisionStatus !== 'EXECUTADA')
      .length ?? overview?.indicators.pendingSupplyRequestsCount ?? 0;
  const vehiclesReceivedCount = overview?.performanceKpis.receiptsCount ?? 0;
  const activeSchedulesCount = schedules.filter((s) => s.status === 'APROVADA').length;
  const activeAlertsCount = overview?.indicators.activeAlertsCount ?? dashboard?.kpis.pendingValidationsCount ?? 0;

  const lineSummaryHighlights = useMemo(() => {
    const getSilos = (nums: number[]) =>
      nums.map((n) => silos.find((s) => s.siloNumber === n)).filter((s): s is SiloDetail => Boolean(s));
    return [
      { code: 'L1', title: 'Linha 1 (Silos 25, 26)', list: getSilos([25, 26]) },
      { code: 'L2', title: 'Linha 2 (Silos 24, 23)', list: getSilos([24, 23]) },
      { code: 'L5', title: 'Linha 5 (Silos 9, 10)', list: getSilos([9, 10]) },
      { code: 'L6', title: 'Linha 6 (Silos 29, 28)', list: getSilos([29, 28]) },
      { code: 'L3', title: 'Linha 3 (Silos 22 → 17)', list: getSilos([22, 21, 20, 19, 18, 17]) },
      { code: 'L4', title: 'Linha 4 (Silos 11–16, 31–33)', list: getSilos([11, 12, 13, 14, 15, 16, 31, 32, 33]) },
      { code: 'ARM', title: 'Armazenagem (Silos 42 → 34)', list: getSilos([42, 41, 40, 39, 38, 37, 36, 35, 34]) },
    ];
  }, [silos]);

  const plannedKg = overview?.performanceKpis.plannedConsumptionKg ?? 0;
  const realizedKg = overview?.performanceKpis.realizedConsumptionKg ?? 0;
  const maxConsumptionBar = Math.max(plannedKg, realizedKg, 1);

  return (
    <div className="space-y-6">
      {/* Faixa de Identificação do Modo Atual */}
      <div
        className={`rounded-xl border p-4 sm:p-5 ${
          isDemoMode
            ? 'border-[#3B82F6]/60 bg-gradient-to-r from-[#10223A] via-[#101B2A] to-[#0A1421]'
            : 'border-emerald-500/40 bg-[#101B2A]'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                  isDemoMode
                    ? presentationViewMode === 'BANCO_AO_VIVO'
                      ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                      : 'border-[#F5B91B]/60 bg-[#F5B91B]/15 text-[#F5B91B]'
                    : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                }`}
              >
                <Presentation className="h-3.5 w-3.5" />
                {isDemoMode
                  ? presentationViewMode === 'BANCO_AO_VIVO'
                    ? 'Modo Apresentação · Espelho Ao Vivo do PostgreSQL (Somente Leitura)'
                    : 'Modo Apresentação · Cenário Operacional sobre Catálogo Real'
                  : 'Modo Executivo Conectado · Dados Operacionais Reais (PostgreSQL)'}
              </span>
              <span className="rounded-md border border-[#AEB8C5]/25 bg-[#0A1421] px-2.5 py-1 text-[11px] font-semibold text-[#AEB8C5]">
                Estágio Atual: Fases 1 a 5 · Fase 6 não iniciada
              </span>
            </div>

            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[#F4F6F8] sm:text-3xl">
              NEXO LOG 2.0 — INTELIGÊNCIA LOGÍSTICA DA MOEGA
            </h1>
            <p className="text-sm leading-relaxed text-[#AEB8C5]">
              {isDemoMode
                ? presentationViewMode === 'BANCO_AO_VIVO'
                  ? 'Leitura direta do PostgreSQL oficial da Moega (54 silos, 27 matérias-primas, capacidades reais, 9 rotas e registros reais gravados), sem possibilidade de alterar o banco oficial.'
                  : 'Apresentação sobre os números reais de cadastro e capacidade do PostgreSQL (54 silos · 1.304,06 t nominais / 1.173,66 t seguras · 27 MPs · 7 fornecedores · 9 rotas) enriquecida com movimentações e programações operacionais simuladas em memória.'
                : 'Apresentação executiva sobre os dados reais cadastrados no PostgreSQL até a Fase 5. Para navegar em sandbox isolado ou compartilhar link direto, acesse o Modo Apresentação.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                void handleCopyPresentationLink();
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#3B82F6]/50 bg-[#0A1421] px-4 py-2 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
            >
              {linkCopied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span className="text-emerald-300">Link Copiado!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-[#F5B91B]" />
                  <span>Copiar Link Direto</span>
                </>
              )}
            </button>

            {isDemoMode ? (
              <>
                {onResetDemo && (
                  <button
                    type="button"
                    onClick={onResetDemo}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/30 bg-[#0A1421] px-4 py-2 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
                  >
                    <RotateCcw className="h-4 w-4 text-[#F5B91B]" />
                    <span>Reiniciar Cenário Demo</span>
                  </button>
                )}
                {onExitDemoMode && (
                  <button
                    type="button"
                    onClick={() => {
                      void onExitDemoMode();
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 py-2 text-xs font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
                  >
                    <span>Sair para Login Real</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </>
            ) : (
              onEnterDemoMode && (
                <button
                  type="button"
                  onClick={onEnterDemoMode}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 py-2 text-xs font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
                >
                  <Presentation className="h-4 w-4" />
                  <span>Abrir Sandbox com Dados Demo</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Barra de Sincronização Real PostgreSQL + Alternância de Visão em 1 Clique */}
        {isDemoMode && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[#AEB8C5]/15 pt-4 lg:grid-cols-12 lg:items-center">
            <div className="flex flex-wrap items-center gap-2 lg:col-span-5">
              {onSwitchPresentationMode && (
                <div className="inline-flex rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] p-1">
                  <button
                    type="button"
                    onClick={() => onSwitchPresentationMode('CENARIO_REALISTA')}
                    className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                      presentationViewMode === 'CENARIO_REALISTA'
                        ? 'bg-[#F5B91B] text-[#0A1421]'
                        : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                    }`}
                  >
                    Cenário Operacional (sobre Catálogo Real)
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwitchPresentationMode('BANCO_AO_VIVO')}
                    className={`rounded-md px-3 py-1.5 text-xs font-bold transition-colors ${
                      presentationViewMode === 'BANCO_AO_VIVO'
                        ? 'bg-emerald-400 text-[#0A1421]'
                        : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                    }`}
                  >
                    Espelho Ao Vivo do PostgreSQL
                  </button>
                </div>
              )}
            </div>

            {presentationMeta && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421]/85 px-3.5 py-2 text-[11px] text-[#AEB8C5] lg:col-span-7">
                <div className="flex items-center gap-2 font-semibold text-[#F4F6F8]">
                  <Database className="h-3.5 w-3.5 text-emerald-400" />
                  <span>
                    {presentationMeta.hasServerBootstrap
                      ? 'PostgreSQL Sincronizado (Somente Leitura):'
                      : 'Catálogo Oficial da Planta:'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono-tabular">
                  <span>{presentationMeta.liveCounts.silos} silos</span>
                  <span>
                    {formatTons(presentationMeta.liveCounts.totalNominalCapacityKg)} nom. /{' '}
                    {formatTons(presentationMeta.liveCounts.totalSafeCapacityKg)} seg.
                  </span>
                  <span>{presentationMeta.liveCounts.materials} MPs</span>
                  <span>{presentationMeta.liveCounts.suppliers} fornec.</span>
                  <span>{presentationMeta.liveCounts.transferRules} rotas</span>
                  <span>{presentationMeta.liveCounts.pendenciesPending} pendências</span>
                  <span className="text-emerald-300">
                    Banco real: {formatKg(presentationMeta.liveCounts.totalRealStockKg)} ·{' '}
                    {presentationMeta.liveCounts.movements} movs ·{' '}
                    {presentationMeta.liveCounts.receipts} receb.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 10 Indicadores Executivos */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
              10 Indicadores Executivos da Operação
            </h2>
            <p className="text-xs text-[#AEB8C5]">
              {isDemoMode
                ? presentationViewMode === 'BANCO_AO_VIVO'
                  ? 'Leitura fiel ao vivo dos registros reais gravados no PostgreSQL (somente leitura).'
                  : 'Capacidades e cadastros oficiais do PostgreSQL combinados ao cenário operacional simulado em memória.'
                : 'Cálculo direto do banco PostgreSQL (sem projeções inventadas).'}
            </p>
          </div>
          {loadingExtras && (
            <span className="text-xs text-[#F5B91B]">Consolidando indicadores...</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <p className="text-xs font-medium text-[#AEB8C5]">1. Estoque Total Disponível</p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-emerald-400">
              {formatTons(totalStockKg)}
            </p>
            <p className="mt-1 font-mono-tabular text-[11px] text-[#AEB8C5]">
              {formatKg(totalStockKg)} de {formatTons(safeCapKg)} seguros
            </p>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <p className="text-xs font-medium text-[#AEB8C5]">2. Produtos Cadastrados</p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
              {materials.length}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              Matérias-primas oficiais vinculadas aos silos
            </p>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <p className="text-xs font-medium text-[#AEB8C5]">3. Silos em Operação</p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#3B82F6]">
              {operationalCount}/{silos.length}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              {occupiedCount} com saldo · {siloStatusCounts.unavailable} indisponível(is)
            </p>
          </div>

          <div
            className={`rounded-xl border p-4 ${
              lowStockCount > 0
                ? 'border-orange-500/60 bg-orange-950/25 nexo-silo-pulse-orange'
                : 'border-[#AEB8C5]/15 bg-[#101B2A]'
            }`}
          >
            <p className="text-xs font-medium text-[#AEB8C5]">4. Silos com Baixo Estoque</p>
            <p
              className={`mt-1.5 font-mono-tabular text-2xl font-extrabold ${
                lowStockCount > 0 ? 'text-orange-300' : 'text-emerald-400'
              }`}
            >
              {lowStockCount}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              {siloStatusCounts.critical} crítico(s) · {siloStatusCounts.attention} atenção
            </p>
          </div>

          <div
            className={`rounded-xl border p-4 ${
              supplyNeedsCount > 0
                ? 'border-red-500/55 bg-red-950/25'
                : 'border-[#AEB8C5]/15 bg-[#101B2A]'
            }`}
          >
            <p className="text-xs font-medium text-[#AEB8C5]">5. Necessidades de Abastecimento</p>
            <p
              className={`mt-1.5 font-mono-tabular text-2xl font-extrabold ${
                supplyNeedsCount > 0 ? 'text-red-300' : 'text-emerald-400'
              }`}
            >
              {supplyNeedsCount}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              Recomendações e solicitações abertas
            </p>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <p className="text-xs font-medium text-[#AEB8C5]">6. Veículos Recebidos</p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
              {vehiclesReceivedCount}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              {siloStatusCounts.receiving} silo(s) em recebimento ativo
            </p>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <p className="text-xs font-medium text-[#AEB8C5]">7. Movimentações do Turno</p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F5B91B]">
              {shiftMovementsCount}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              Entradas, transferências e consumo registrados
            </p>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <p className="text-xs font-medium text-[#AEB8C5]">8. Programação de Produção</p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
              {activeSchedulesCount}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              {schedules.length} revisão(ões) importada(s) (L1–L7)
            </p>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <p className="text-xs font-medium text-[#AEB8C5]">9. Alertas Operacionais</p>
            <p
              className={`mt-1.5 font-mono-tabular text-2xl font-extrabold ${
                activeAlertsCount > 0 ? 'text-[#F5B91B]' : 'text-emerald-400'
              }`}
            >
              {activeAlertsCount}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              {overview?.indicators.openOccurrencesCount ?? 0} ocorrência(s) em aberto
            </p>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <p className="text-xs font-medium text-[#AEB8C5]">10. Indicadores de Desempenho</p>
            <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#3B82F6]">
              {overview?.performanceKpis.avgReceiptDurationMinutes != null
                ? `${overview.performanceKpis.avgReceiptDurationMinutes.toFixed(0)} min`
                : 'Base Zero'}
            </p>
            <p className="mt-1 text-[11px] text-[#AEB8C5]">
              Tempo médio de descarga por veículo
            </p>
          </div>
        </div>
      </section>

      {/* Gráficos Visuais Limpos */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Gráfico 1: Ocupação por Linha L1-L7 */}
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 lg:col-span-7">
          <div className="flex items-center justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-[#F5B91B]" />
              <div>
                <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                  Estoque vs Capacidade Segura (-10%) por Linha
                </h3>
                <p className="text-xs text-[#AEB8C5]">
                  Distribuição visual das Linhas L1 a L6 e Armazenagem/Produção (L7)
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('mapa')}
              className="min-h-[38px] rounded-lg border border-[#AEB8C5]/25 px-3 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
            >
              Abrir Mapa
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {(dashboard?.byLine ?? []).map((line) => {
              const pct =
                line.safeCapacityKg > 0
                  ? Math.min(100, Math.round((line.confirmedStockKg / line.safeCapacityKg) * 1000) / 10)
                  : 0;
              return (
                <div key={line.code} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#F4F6F8]">
                      <span className="font-mono-tabular text-[#F5B91B]">{line.code}</span> ·{' '}
                      {line.name} ({line.siloCount} silos)
                    </span>
                    <span className="font-mono-tabular text-[#AEB8C5]">
                      <strong className="text-[#F4F6F8]">{formatTons(line.confirmedStockKg)}</strong> /{' '}
                      {formatTons(line.safeCapacityKg)} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#0A1421]">
                    <div
                      className={`h-full rounded-full transition-all ${
                        line.code === 'L7'
                          ? 'bg-emerald-400'
                          : pct < 25 && line.confirmedStockKg > 0
                            ? 'bg-orange-400'
                            : 'bg-[#3B82F6]'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Gráfico 2 + 3: Saúde dos 54 Silos & Consumo */}
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Estado Operacional dos 54 Silos
            </h3>
            <p className="text-xs text-[#AEB8C5]">
              Monitoramento instantâneo dos 5 estados operacionais no croqui
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-lg border border-emerald-500/35 bg-emerald-950/20 p-3">
                <p className="text-emerald-300 font-semibold">Disponível</p>
                <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
                  {siloStatusCounts.available}
                </p>
              </div>
              <div className="rounded-lg border border-orange-500/45 bg-orange-950/25 p-3">
                <p className="text-orange-300 font-semibold">Estoque Baixo</p>
                <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-orange-300">
                  {siloStatusCounts.attention}
                </p>
              </div>
              <div className="rounded-lg border border-red-500/50 bg-red-950/25 p-3">
                <p className="text-red-300 font-semibold">Necessita Abastec.</p>
                <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-red-300">
                  {siloStatusCounts.critical}
                </p>
              </div>
              <div className="rounded-lg border border-cyan-500/45 bg-cyan-950/25 p-3">
                <p className="text-cyan-300 font-semibold">Em Recebimento</p>
                <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-cyan-300">
                  {siloStatusCounts.receiving}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 py-2 text-xs">
              <span className="text-[#AEB8C5]">Indisponível (Bloqueado / Manutenção)</span>
              <span className="font-mono-tabular font-bold text-red-400">
                {siloStatusCounts.unavailable}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[#F5B91B]" />
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Consumo Previsto vs Realizado
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-[#AEB8C5]">
              Comparação entre programação aprovada e baixas confirmadas
            </p>

            <div className="mt-4 space-y-3 text-xs">
              <div>
                <div className="flex justify-between font-mono-tabular">
                  <span className="text-[#AEB8C5]">Consumo Previsto (Programação)</span>
                  <span className="font-bold text-[#F4F6F8]">{formatKg(plannedKg)}</span>
                </div>
                <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-[#0A1421]">
                  <div
                    className="h-full rounded-full bg-[#F5B91B]"
                    style={{ width: `${Math.round((plannedKg / maxConsumptionBar) * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between font-mono-tabular">
                  <span className="text-[#AEB8C5]">Consumo Realizado</span>
                  <span className="font-bold text-emerald-400">{formatKg(realizedKg)}</span>
                </div>
                <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-[#0A1421]">
                  <div
                    className="h-full rounded-full bg-emerald-400"
                    style={{ width: `${Math.round((realizedKg / maxConsumptionBar) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Visão Resumida do Mapa de Silos (L1, L2, L5, L6 e Armazenagem em destaque) */}
      <section className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
          <div>
            <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
              Visão Resumida do Mapa de Silos (Destaques da Moega)
            </h2>
            <p className="text-xs text-[#AEB8C5]">
              Sequência oficial preservada: Linha 1 (25, 26), Linha 2 (24, 23), Linha 5 (9, 10), Linha 6 (29, 28), Linhas 3 e 4 e Armazenagem (42–34)
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('mapa')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 py-2 text-xs font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
          >
            <LayoutGrid className="h-4 w-4" />
            <span>Explorar Mapa Completo (54 Silos)</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {lineSummaryHighlights.map((group) => (
            <div
              key={group.code}
              className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421]/80 p-3.5 space-y-2.5"
            >
              <p className="font-display text-xs font-bold text-[#F5B91B]">{group.title}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.list.map((s) => {
                  const blocked =
                    s.operationalStatus === 'BLOQUEADO' || s.operationalStatus === 'MANUTENCAO';
                  let pillClass = 'border-[#3B82F6]/40 bg-[#152336] text-[#F4F6F8]';
                  if (blocked) pillClass = 'border-red-500/70 bg-red-950/50 text-red-200';
                  else if (s.stockAlertLevel === 'CRITICO')
                    pillClass = 'border-red-500/80 bg-red-950/45 text-red-200 nexo-silo-pulse-red';
                  else if (s.stockAlertLevel === 'ATENCAO')
                    pillClass =
                      'border-orange-500/80 bg-orange-950/40 text-orange-200 nexo-silo-pulse-orange';
                  else if (s.isReceiving)
                    pillClass = 'border-cyan-400/80 bg-cyan-950/45 text-cyan-200';
                  else if (s.category === 'ARMAZENAGEM')
                    pillClass = 'border-emerald-500/45 bg-emerald-950/35 text-emerald-100';

                  return (
                    <span
                      key={s.siloNumber}
                      title={`${s.materialDescription || 'Sem MP'} · ${formatKg(s.confirmedStockKg)}`}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-mono-tabular text-[11px] font-bold ${pillClass}`}
                    >
                      S{s.siloNumber}
                      {s.isReceiving && <span className="text-[9px] text-cyan-300">●REC</span>}
                      {blocked && <span className="text-[9px] text-red-300">✕</span>}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Roteiro Navegável por Todos os Módulos */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
            Navegação Direta para Demonstração dos Módulos (Fases 1 a 5)
          </h2>
          <p className="text-xs text-[#AEB8C5]">
            Clique em qualquer cartão para apresentar o módulo em funcionamento durante a reunião.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              id: 'recebimentos' as NavSectionId,
              title: 'Recebimentos & Etiquetas',
              desc: 'NF, fornecedor, lote, big bags, rateio multi-silo e scanner ZXing/foto.',
              icon: Truck,
            },
            {
              id: 'estoque' as NavSectionId,
              title: 'Estoque & Cadastros',
              desc: 'Catálogo de matérias-primas, compatibilidade e configurações de bags.',
              icon: Database,
            },
            {
              id: 'programacao' as NavSectionId,
              title: 'Programação da Produção',
              desc: 'Importação assistida (PDF/foto/XLSX), revisões e fatores de consumo.',
              icon: CalendarClock,
            },
            {
              id: 'consumo' as NavSectionId,
              title: 'Consumo & Inteligência',
              desc: 'Comparativo hoje/amanhã, projeções por silo e alertas de ruptura.',
              icon: Activity,
            },
            {
              id: 'abastecimento' as NavSectionId,
              title: 'Painel de Abastecimento',
              desc: 'Status das linhas L1–L7 com alertas pulsantes e recomendações ponderadas.',
              icon: PackageCheck,
            },
            {
              id: 'transferencias' as NavSectionId,
              title: 'Transferências Atômicas',
              desc: 'Ordens planejadas, execução parcial e estornos auditados.',
              icon: Repeat,
            },
            {
              id: 'relatorios' as NavSectionId,
              title: 'Relatórios & Indicadores',
              desc: 'Indicadores reais, posição histórica do livro razão e exportação.',
              icon: FileSpreadsheet,
            },
            {
              id: 'turnos' as NavSectionId,
              title: 'Turnos, Ocorrências & IA',
              desc: 'Passagem automática de serviço, ciência de pendências e assistente.',
              icon: ClipboardCheck,
            },
          ].map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onNavigate(card.id)}
                className="group flex flex-col justify-between rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 text-left transition-colors hover:border-[#F5B91B]"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#F5B91B]/30 bg-[#F5B91B]/10 text-[#F5B91B]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <ArrowRight className="h-4 w-4 text-[#AEB8C5] transition-transform group-hover:translate-x-1 group-hover:text-[#F5B91B]" />
                  </div>
                  <h3 className="mt-3 font-display text-sm font-bold text-[#F4F6F8]">
                    {card.title}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-[#AEB8C5]">{card.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => onNavigate('etiquetas')}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3.5 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
          >
            <QrCode className="h-4 w-4 text-[#F5B91B]" />
            <span>Leitura de Etiquetas</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('ocorrencias')}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3.5 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
          >
            <AlertTriangle className="h-4 w-4 text-[#F5B91B]" />
            <span>Central de Ocorrências</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('assistente')}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3.5 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
          >
            <Bot className="h-4 w-4 text-[#F5B91B]" />
            <span>NEXO Assistente (IA)</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('auditoria')}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3.5 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
          >
            <Eye className="h-4 w-4 text-[#F5B91B]" />
            <span>Auditoria Imutável</span>
          </button>
        </div>
      </section>

      {/* Objetivos Estratégicos & Benefícios Potenciais */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 lg:col-span-6">
          <div className="flex items-center gap-2 border-b border-[#AEB8C5]/15 pb-3">
            <Target className="h-5 w-5 text-[#F5B91B]" />
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Objetivos Estratégicos da Plataforma
            </h3>
          </div>
          <ol className="mt-4 space-y-2.5 text-xs leading-relaxed text-[#AEB8C5]">
            {STRATEGIC_OBJECTIVES.map((obj, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#F5B91B]/15 font-mono-tabular text-[11px] font-bold text-[#F5B91B]">
                  {idx + 1}
                </span>
                <span className="text-[#F4F6F8]/90">{obj}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 lg:col-span-6">
          <div className="flex items-center gap-2 border-b border-[#AEB8C5]/15 pb-3">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Benefícios Operacionais Potenciais (Qualitativos)
            </h3>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {QUALITATIVE_BENEFITS.map((b) => (
              <div
                key={b.title}
                className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3.5"
              >
                <p className="text-xs font-bold text-[#F5B91B]">{b.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-[#AEB8C5]">{b.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 text-[11px] text-[#AEB8C5]">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#3B82F6]" />
            <span>
              Benefícios apresentados sob perspectiva operacional qualitativa. Ganhos quantitativos
              serão aferidos somente após histórico contínuo em produção real.
            </span>
          </div>
        </div>
      </section>

      {/* Matriz de Transparência */}
      <section className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="flex items-center gap-2 border-b border-[#AEB8C5]/15 pb-3">
          <Layers className="h-5 w-5 text-[#F5B91B]" />
          <div>
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Matriz de Transparência para a Supervisão
            </h3>
            <p className="text-xs text-[#AEB8C5]">
              Diferenciação clara entre módulos reais operacionais, dados simulados na apresentação e etapas futuras
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#AEB8C5]/15 text-[#AEB8C5]">
                <th className="py-2.5 pr-4 font-semibold">Capacidade / Módulo</th>
                <th className="px-3 py-2.5 font-semibold">Etapa</th>
                <th className="px-3 py-2.5 font-semibold">Situação Atual</th>
                <th className="pl-3 py-2.5 font-semibold">Detalhamento Técnico</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#AEB8C5]/10">
              {TRANSPARENCY_MATRIX.map((row) => (
                <tr key={row.area}>
                  <td className="py-3 pr-4 font-semibold text-[#F4F6F8]">{row.area}</td>
                  <td className="px-3 py-3 font-mono-tabular text-[#AEB8C5] whitespace-nowrap">
                    {row.phase}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {row.status === 'FUNCIONAL' && (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-bold text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Funcional
                      </span>
                    )}
                    {row.status === 'DEMO' && (
                      <span className="inline-flex items-center gap-1 rounded border border-[#3B82F6]/50 bg-[#3B82F6]/15 px-2 py-0.5 font-bold text-[#60A5FA]">
                        <Presentation className="h-3.5 w-3.5" />
                        Simulado em Demo
                      </span>
                    )}
                    {row.status === 'PENDENTE' && (
                      <span className="inline-flex items-center gap-1 rounded border border-[#F5B91B]/45 bg-[#F5B91B]/10 px-2 py-0.5 font-bold text-[#F5B91B]">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Pendente / Futuro
                      </span>
                    )}
                  </td>
                  <td className="pl-3 py-3 text-[#AEB8C5]">{row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
