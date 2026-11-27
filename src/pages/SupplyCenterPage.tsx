import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  GitBranch,
  History,
  Lock,
  PackageCheck,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  Sliders,
  Sparkles,
  Truck,
  XCircle,
} from 'lucide-react';
import {
  AuthorizedRouteItem,
  GeminiSupplyAdviceResponse,
  LineSupplyBoardRowView,
  MaterialItem,
  NavSectionId,
  ProductionSupplyBoardResponse,
  RouteAuthStatus,
  SiloDetail,
  SupplyRecommendationView,
  SupplyVisualColor,
  TransferPlanDraftPrefill,
} from '../types/nexo.ts';
import { apiFetch, formatKg } from '../lib/api.ts';
import { evaluateFeedingSiloChipStatus } from '../lib/stock-status.ts';

interface SupplyCenterPageProps {
  silos: SiloDetail[];
  materials: MaterialItem[];
  canManageRoutes: boolean;
  canPlanTransfers: boolean;
  canManagePriority: boolean;
  onCreateTransferFromRecommendation: (prefill: TransferPlanDraftPrefill) => void;
  onNavigate: (section: NavSectionId) => void;
  onReloadWorkspace: () => Promise<void>;
}

const COLOR_STYLES: Record<
  SupplyVisualColor,
  {
    badge: string;
    border: string;
    label: string;
    dot: string;
    rowPulse: string;
    beaconRing: string;
    isPulsing: boolean;
  }
> = {
  VERDE: {
    badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
    border: 'border-emerald-500/35 bg-[#102235]',
    label: 'VERDE · ESTOQUE SUFICIENTE',
    dot: 'bg-emerald-400',
    rowPulse: '',
    beaconRing: '',
    isPulsing: false,
  },
  AMARELO: {
    badge: 'border-amber-400/45 bg-amber-500/15 text-amber-200',
    border: 'border-amber-400/35 bg-[#102235]',
    label: 'AMARELO · ATENÇÃO',
    dot: 'bg-amber-400',
    rowPulse: '',
    beaconRing: '',
    isPulsing: false,
  },
  LARANJA: {
    badge: 'border-orange-500/60 bg-orange-500/20 text-orange-200',
    border: 'border-orange-500/65 border-l-4 border-l-orange-500 bg-orange-950/20',
    label: 'LARANJA · NECESSIDADE DE AÇÃO',
    dot: 'bg-orange-400',
    rowPulse: 'nexo-row-pulse-orange',
    beaconRing: 'bg-orange-400 nexo-beacon-ring-orange',
    isPulsing: true,
  },
  VERMELHO: {
    badge: 'border-red-500/65 bg-red-500/20 text-red-200',
    border: 'border-red-500/70 border-l-4 border-l-red-500 bg-red-950/25',
    label: 'VERMELHO · RISCO CRÍTICO',
    dot: 'bg-red-500',
    rowPulse: 'nexo-row-pulse-red',
    beaconRing: 'bg-red-500 nexo-beacon-ring-red',
    isPulsing: true,
  },
  CINZA: {
    badge: 'border-slate-400/35 bg-slate-500/15 text-slate-300',
    border: 'border-slate-400/30 bg-[#102235]',
    label: 'CINZA · DADO / FATOR PENDENTE',
    dot: 'bg-slate-400',
    rowPulse: '',
    beaconRing: '',
    isPulsing: false,
  },
};

const ROUTE_STATUS_STYLES: Record<RouteAuthStatus, string> = {
  AUTORIZADA: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  PENDENTE_VALIDACAO: 'border-amber-400/45 bg-amber-500/15 text-amber-200',
  SUSPENSA: 'border-orange-500/45 bg-orange-500/15 text-orange-300',
  BLOQUEADA: 'border-red-500/45 bg-red-500/15 text-red-300',
};

export const SupplyCenterPage: React.FC<SupplyCenterPageProps> = ({
  silos,
  materials,
  canManageRoutes,
  canPlanTransfers,
  canManagePriority,
  onCreateTransferFromRecommendation,
  onNavigate,
  onReloadWorkspace,
}) => {
  const [subTab, setSubTab] = useState<'painel' | 'recomendacoes' | 'rotas'>('painel');
  const [board, setBoard] = useState<ProductionSupplyBoardResponse | null>(null);
  const [routes, setRoutes] = useState<AuthorizedRouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Filters
  const [lineFilter, setLineFilter] = useState<string>('TODAS');
  const [colorFilter, setColorFilter] = useState<string>('TODOS');
  const [routeStatusFilter, setRouteStatusFilter] = useState<string>('TODAS');
  const [routeSearch, setRouteSearch] = useState('');

  // Recommendation rejection modal & intake request modal
  const [rejectingRec, setRejectingRec] = useState<SupplyRecommendationView | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [intakeRec, setIntakeRec] = useState<SupplyRecommendationView | null>(null);
  const [intakeQtyKg, setIntakeQtyKg] = useState('');
  const [intakeDate, setIntakeDate] = useState('');
  const [intakeJustification, setIntakeJustification] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  // Configurable Priority Weights
  const [weightsForm, setWeightsForm] = useState({
    weightLineStopRisk: 40,
    weightStockCoverage: 25,
    weightAuthorizedRoute: 15,
    weightOriginAvailability: 10,
    weightScheduleUrgency: 10,
  });
  const [weightsReason, setWeightsReason] = useState('');
  const [savingWeights, setSavingWeights] = useState(false);

  // Create Route form & Route status change modal
  const [newRouteOriginId, setNewRouteOriginId] = useState('');
  const [newRouteDestId, setNewRouteDestId] = useState('');
  const [newRouteMatId, setNewRouteMatId] = useState('');
  const [newRouteMaxKg, setNewRouteMaxKg] = useState('');
  const [newRouteStatus, setNewRouteStatus] = useState<RouteAuthStatus>('PENDENTE_VALIDACAO');
  const [newRouteRestrictions, setNewRouteRestrictions] = useState('');
  const [newRouteReason, setNewRouteReason] = useState('');
  const [creatingRoute, setCreatingRoute] = useState(false);

  const [editingRoute, setEditingRoute] = useState<AuthorizedRouteItem | null>(null);
  const [editRouteStatus, setEditRouteStatus] = useState<RouteAuthStatus>('AUTORIZADA');
  const [editRouteMaxKg, setEditRouteMaxKg] = useState('');
  const [editRouteRestrictions, setEditRouteRestrictions] = useState('');
  const [editRouteReason, setEditRouteReason] = useState('');
  const [expandedRouteHistoryId, setExpandedRouteHistoryId] = useState<number | null>(null);

  // Gemini Supply Advisor
  const [aiQuestion, setAiQuestion] = useState(
    'Explique os alertas atuais do painel de abastecimento, compare rotas autorizadas vs bloqueadas e indique os cuidados operacionais.'
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAdvice, setAiAdvice] = useState<GeminiSupplyAdviceResponse | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const loadSupplyData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [boardRes, routesRes] = await Promise.all([
        apiFetch<ProductionSupplyBoardResponse>('/api/supply/board'),
        apiFetch<AuthorizedRouteItem[]>('/api/routes'),
      ]);
      setBoard(boardRes);
      setRoutes(routesRes);
      setWeightsForm({
        weightLineStopRisk: boardRes.priorityConfig.weightLineStopRisk,
        weightStockCoverage: boardRes.priorityConfig.weightStockCoverage,
        weightAuthorizedRoute: boardRes.priorityConfig.weightAuthorizedRoute,
        weightOriginAvailability: boardRes.priorityConfig.weightOriginAvailability,
        weightScheduleUrgency: boardRes.priorityConfig.weightScheduleUrgency,
      });
      setIntakeDate(boardRes.todayDate);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar Painel de Abastecimento e Rotas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSupplyData();
  }, [loadSupplyData]);

  const filteredBoardRows = useMemo(() => {
    if (!board) return [];
    return board.boardRows.filter((r) => {
      if (lineFilter !== 'TODAS' && r.lineCode !== lineFilter) return false;
      if (colorFilter !== 'TODOS' && r.supplyStatus !== colorFilter) return false;
      return true;
    });
  }, [board, lineFilter, colorFilter]);

  const filteredRoutes = useMemo(() => {
    return routes.filter((r) => {
      if (routeStatusFilter !== 'TODAS' && r.authorizationStatus !== routeStatusFilter) return false;
      if (routeSearch.trim()) {
        const q = routeSearch.trim().toLowerCase();
        const hay =
          `silo ${r.originSiloNumber} silo ${r.destinationSiloNumber} ${r.materialCode} ${r.materialDescription} ${r.relatedLineCode || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [routes, routeStatusFilter, routeSearch]);

  const handleTriggerTransferPlan = (row: {
    originSiloId: number | null;
    destinationSiloId: number | null;
    materialId: number | null;
    suggestedTransferRuleId?: number | null;
    transferRuleId?: number | null;
    suggestedTransferKg?: number | null;
    suggestedLotCode?: string | null;
    priorityLevel: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
    recommendationId?: number | null;
    recommendationKey?: string | null;
    lineCode: string;
    materialDescription: string;
  }) => {
    if (!row.originSiloId || !row.destinationSiloId || !row.materialId || !row.suggestedTransferKg) {
      return;
    }
    onCreateTransferFromRecommendation({
      transferRuleId: row.transferRuleId ?? row.suggestedTransferRuleId ?? null,
      originSiloId: row.originSiloId,
      destinationSiloId: row.destinationSiloId,
      materialId: row.materialId,
      plannedQuantityKg: row.suggestedTransferKg,
      lotCode: row.suggestedLotCode ?? null,
      priority: row.priorityLevel,
      recommendationId: row.recommendationId ?? null,
      recommendationKey: row.recommendationKey ?? null,
      notes: `Abastecimento ${row.lineCode} — ${row.materialDescription}`,
    });
  };

  const handleMarkRecDecision = async (
    rec: SupplyRecommendationView,
    decision: 'EM_ANALISE' | 'REJEITADA' | 'PENDENTE',
    notes?: string
  ) => {
    setActionBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/supply/recommendations/${rec.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, decisionNotes: notes }),
      });
      setSuccess(`Recomendação (${rec.lineCode}) atualizada para ${decision}.`);
      setRejectingRec(null);
      setRejectReason('');
      await loadSupplyData();
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar status da recomendação.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCreateIntakeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intakeRec || !intakeRec.materialId) return;
    setActionBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await apiFetch<{ requestCode: string }>('/api/supply/intake-requests', {
        method: 'POST',
        body: JSON.stringify({
          materialId: intakeRec.materialId,
          lineCode: intakeRec.lineCode,
          targetSiloId: intakeRec.destinationSiloId,
          recommendationId: intakeRec.id,
          recommendationKey: intakeRec.recommendationKey,
          neededQuantityKg: Number(intakeQtyKg),
          neededByDate: intakeDate || board?.todayDate,
          priority: intakeRec.priorityLevel,
          justification: intakeJustification,
        }),
      });
      setSuccess(`Solicitação de Recebimento ${created.requestCode} registrada com sucesso.`);
      setIntakeRec(null);
      setIntakeQtyKg('');
      setIntakeJustification('');
      await loadSupplyData();
    } catch (err: any) {
      setError(err.message || 'Erro ao criar solicitação de recebimento.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSavePriorityWeights = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManagePriority) return;
    setSavingWeights(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/supply/priority-config', {
        method: 'PUT',
        body: JSON.stringify({
          ...weightsForm,
          reason: weightsReason || 'Ajuste de ponderação operacional Fase 4',
        }),
      });
      setSuccess('Critérios de priorização salvos e aplicados ao painel.');
      setWeightsReason('');
      await loadSupplyData();
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar critérios de priorização.');
    } finally {
      setSavingWeights(false);
    }
  };

  const handleCreateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageRoutes) return;
    setCreatingRoute(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/routes', {
        method: 'POST',
        body: JSON.stringify({
          originSiloId: Number(newRouteOriginId),
          destinationSiloId: Number(newRouteDestId),
          materialId: Number(newRouteMatId),
          maxQuantityKg: newRouteMaxKg ? Number(newRouteMaxKg) : null,
          authorizationStatus: newRouteStatus,
          restrictions: newRouteRestrictions || null,
          reason: newRouteReason,
        }),
      });
      setSuccess('Rota cadastrada na matriz operacional com registro em auditoria.');
      setNewRouteOriginId('');
      setNewRouteDestId('');
      setNewRouteMatId('');
      setNewRouteMaxKg('');
      setNewRouteRestrictions('');
      setNewRouteReason('');
      await Promise.all([loadSupplyData(), onReloadWorkspace()]);
    } catch (err: any) {
      setError(err.message || 'Falha ao cadastrar rota.');
    } finally {
      setCreatingRoute(false);
    }
  };

  const handleSaveRouteStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoute || !canManageRoutes) return;
    setActionBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/routes/${editingRoute.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          authorizationStatus: editRouteStatus,
          maxQuantityKg: editRouteMaxKg ? Number(editRouteMaxKg) : null,
          restrictions: editRouteRestrictions || null,
          reason: editRouteReason,
        }),
      });
      setSuccess(
        `Rota Silo ${editingRoute.originSiloNumber} → Silo ${editingRoute.destinationSiloNumber} atualizada para ${editRouteStatus}.`
      );
      setEditingRoute(null);
      setEditRouteReason('');
      await Promise.all([loadSupplyData(), onReloadWorkspace()]);
    } catch (err: any) {
      setError(err.message || 'Erro ao alterar status da rota.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleAskGeminiAdvisor = async (customQuestion?: string, focusRec?: SupplyRecommendationView) => {
    if (!board) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const q = customQuestion || aiQuestion;
      const scenarioFacts = {
        dataAtual: board.todayDate,
        dataAmanha: board.tomorrowDate,
        resumoPainel: board.summary,
        focoEspecifico: focusRec || null,
        linhasCriticasOuAcao: board.boardRows
          .filter((r) => r.supplyStatus !== 'VERDE')
          .map((r) => ({
            linha: r.lineCode,
            material: `${r.materialCode} - ${r.materialDescription}`,
            status: r.supplyStatus,
            estoqueRealKg: r.currentStockKg,
            consumoHojeKg: r.plannedConsumptionTodayKg,
            consumoAmanhaKg: r.plannedConsumptionTomorrowKg,
            saldoOuDeficitKg: r.deficitOrSurplusKg,
            origemSugerida: r.suggestedOriginSiloNumber,
            destinoSugerido: r.suggestedDestinationSiloNumber,
            transferenciaSugeridaKg: r.suggestedTransferKg,
            notaTempo: r.timeEstimateNote,
          })),
        rotasResumo: routes.map((rt) => ({
          rota: `Silo ${rt.originSiloNumber} -> Silo ${rt.destinationSiloNumber}`,
          material: `${rt.materialCode} - ${rt.materialDescription}`,
          status: rt.authorizationStatus,
          limiteKg: rt.maxQuantityKg,
          restricoes: rt.restrictions,
        })),
      };
      const res = await apiFetch<GeminiSupplyAdviceResponse>('/api/ai/supply-advisor', {
        method: 'POST',
        body: JSON.stringify({ question: q, scenarioFacts }),
      });
      setAiAdvice(res);
    } catch (err: any) {
      setAiError(err.message || 'Falha ao consultar analista Gemini.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#F5B817]/40 bg-[#F5B817]/15 text-[#F5B817]">
              <PackageCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold tracking-wide text-[#F5B817]">
                FASE 4 · INTELIGÊNCIA DE TRANSFERÊNCIAS & ABASTECIMENTO
              </p>
              <h1 className="font-display text-xl font-bold text-[#F4F6F8]">
                Abastecimento da Produção & Rotas Autorizadas
              </h1>
              <p className="text-xs text-[#AEB8C5]">
                Baseado exclusivamente em saldo físico real, compatibilidade oficial e rotas AUTORIZADAS. Nenhuma movimentação é executada automaticamente.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadSupplyData}
            disabled={loading}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-4 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B817]/60"
          >
            <RefreshCw className={`h-4 w-4 text-[#F5B817] ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar Análise</span>
          </button>
        </div>

        {/* Summary KPI Strip */}
        {board && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div
              className={`rounded-lg border p-3 transition-all ${
                board.summary.redCount > 0
                  ? 'border-red-500/65 bg-red-950/30 nexo-silo-pulse-red'
                  : 'border-red-500/35 bg-[#081321]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-red-300">Risco Crítico (Vermelho)</p>
                {board.summary.redCount > 0 && (
                  <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 nexo-beacon-ring-red" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono-tabular text-2xl font-bold text-red-400">
                {board.summary.redCount}
              </p>
            </div>
            <div
              className={`rounded-lg border p-3 transition-all ${
                board.summary.orangeCount > 0
                  ? 'border-orange-500/65 bg-orange-950/25 nexo-silo-pulse-orange'
                  : 'border-orange-500/35 bg-[#081321]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-orange-300">Ação Necessária (Laranja)</p>
                {board.summary.orangeCount > 0 && (
                  <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 nexo-beacon-ring-orange" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" />
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono-tabular text-2xl font-bold text-orange-400">
                {board.summary.orangeCount}
              </p>
            </div>
            <div className="rounded-lg border border-amber-400/35 bg-[#081321] p-3">
              <p className="text-[11px] font-semibold text-amber-200">Atenção (Amarelo)</p>
              <p className="mt-1 font-mono-tabular text-2xl font-bold text-amber-300">
                {board.summary.yellowCount}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-500/35 bg-[#081321] p-3">
              <p className="text-[11px] font-semibold text-emerald-300">Suficiente (Verde)</p>
              <p className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-400">
                {board.summary.greenCount}
              </p>
            </div>
            <div className="rounded-lg border border-slate-400/30 bg-[#081321] p-3">
              <p className="text-[11px] font-semibold text-slate-300">Dados Pendentes (Cinza)</p>
              <p className="mt-1 font-mono-tabular text-2xl font-bold text-slate-300">
                {board.summary.grayCount}
              </p>
            </div>
            <div className="rounded-lg border border-[#F5B817]/35 bg-[#081321] p-3">
              <p className="text-[11px] font-semibold text-[#F5B817]">Déficit Físico Total</p>
              <p className="mt-1 font-mono-tabular text-lg font-bold text-[#F4F6F8]">
                {formatKg(board.summary.totalDeficitKg)}
              </p>
            </div>
          </div>
        )}

        {/* Sub-Tabs */}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-[#AEB8C5]/15 pt-4">
          <button
            type="button"
            onClick={() => setSubTab('painel')}
            className={`min-h-[46px] rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              subTab === 'painel'
                ? 'bg-[#F5B817] text-[#081321]'
                : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            1. Abastecimento da Produção (L1–L7)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('recomendacoes')}
            className={`min-h-[46px] rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              subTab === 'recomendacoes'
                ? 'bg-[#F5B817] text-[#081321]'
                : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            2. Central de Recomendações ({board?.recommendations.length ?? 0}) & Priorização
          </button>
          <button
            type="button"
            onClick={() => setSubTab('rotas')}
            className={`min-h-[46px] rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              subTab === 'rotas'
                ? 'bg-[#F5B817] text-[#081321]'
                : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            3. Rotas Autorizadas ({routes.filter((r) => r.authorizationStatus === 'AUTORIZADA').length}/{routes.length})
          </button>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-4 text-sm text-emerald-100">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/45 bg-red-500/15 p-4 text-sm text-red-100">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* TAB 1: PAINEL DE ABASTECIMENTO DA PRODUÇÃO */}
      {subTab === 'painel' && board && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={lineFilter}
                onChange={(e) => setLineFilter(e.target.value)}
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs font-semibold text-[#F4F6F8]"
              >
                <option value="TODAS">Todas as Linhas (L1–L7)</option>
                {['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'].map((l) => (
                  <option key={l} value={l}>
                    Linha {l}
                  </option>
                ))}
              </select>

              <select
                value={colorFilter}
                onChange={(e) => setColorFilter(e.target.value)}
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs font-semibold text-[#F4F6F8]"
              >
                <option value="TODOS">Todos os Status Visuais</option>
                <option value="VERMELHO">Vermelho · Risco Crítico</option>
                <option value="LARANJA">Laranja · Ação Necessária</option>
                <option value="AMARELO">Amarelo · Atenção</option>
                <option value="VERDE">Verde · Estoque Suficiente</option>
                <option value="CINZA">Cinza · Dado/Fator Pendente</option>
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#AEB8C5]">
              <Clock className="h-4 w-4 text-[#F5B817]" />
              <span>
                Ref. Hoje: <strong className="font-mono-tabular text-[#F4F6F8]">{board.todayDate}</strong> · Amanhã:{' '}
                <strong className="font-mono-tabular text-[#F4F6F8]">{board.tomorrowDate}</strong>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredBoardRows.map((row: LineSupplyBoardRowView) => {
              const st = COLOR_STYLES[row.supplyStatus];
              const isProductionHighlighted = row.lineCode !== 'L7';
              return (
                <div
                  key={row.rowKey}
                  className={`rounded-xl border ${st.border} ${st.rowPulse} p-5 space-y-4 transition-all`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-md px-2.5 py-1 text-xs font-extrabold ${
                            isProductionHighlighted
                              ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                          }`}
                        >
                          {row.lineCode} · {isProductionHighlighted ? 'PRODUÇÃO' : 'MOEGA / ARMAZENAGEM'}
                        </span>
                        <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-bold ${st.badge}`}>
                          <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                            {st.isPulsing && (
                              <span className={`absolute inline-flex h-full w-full rounded-full ${st.beaconRing}`} />
                            )}
                            <span className={`relative inline-flex h-2 w-2 rounded-full ${st.dot}`} />
                          </span>
                          {st.label}
                        </span>
                        <span className="font-mono-tabular text-xs font-bold text-[#F5B817]">
                          Prioridade: {row.priorityLevel} ({row.priorityScore}/100)
                        </span>
                      </div>

                      <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                        {row.materialCode !== '—' ? `${row.materialCode} — ` : ''}
                        {row.materialDescription}
                      </h3>
                      <p className="text-xs text-[#AEB8C5]">{row.statusReason}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {row.hasAuthorizedRouteWithStock && row.suggestedTransferKg > 0 && canPlanTransfers && (
                        <button
                          type="button"
                          onClick={() =>
                            handleTriggerTransferPlan({
                              ...row,
                              originSiloId: row.suggestedOriginSiloId,
                              destinationSiloId: row.suggestedDestinationSiloId,
                            })
                          }
                          className="inline-flex min-h-[46px] items-center gap-2 rounded-lg bg-[#F5B817] px-4 py-2 text-xs font-extrabold text-[#081321] hover:bg-[#F5B817]/90"
                        >
                          <span>CRIAR SOLICITAÇÃO DE TRANSFERÊNCIA</span>
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      )}
                      {row.needsTransfer && !row.hasAuthorizedRouteWithStock && row.materialId && canPlanTransfers && (
                        <button
                          type="button"
                          onClick={() => {
                            const matchedRec = board.recommendations.find(
                              (rec) => rec.lineCode === row.lineCode && rec.materialId === row.materialId
                            );
                            if (matchedRec) {
                              setIntakeRec(matchedRec);
                              setIntakeQtyKg(String(Math.abs(row.deficitOrSurplusKg)));
                            }
                            setSubTab('recomendacoes');
                          }}
                          className="inline-flex min-h-[46px] items-center gap-2 rounded-lg border border-blue-400/50 bg-blue-500/15 px-4 py-2 text-xs font-bold text-blue-200 hover:bg-blue-500/25"
                        >
                          <Truck className="h-4 w-4" />
                          <span>Solicitar Recebimento</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <div
                      className={`rounded-lg border p-3 ${
                        row.supplyStatus === 'VERMELHO'
                          ? 'border-red-500/45 bg-red-950/30'
                          : row.supplyStatus === 'LARANJA'
                            ? 'border-orange-500/45 bg-orange-950/25'
                            : 'border-[#AEB8C5]/15 bg-[#081321]'
                      }`}
                    >
                      <p className="text-[11px] text-[#AEB8C5]">Estoque Real nos Silos</p>
                      <p
                        className={`mt-1 font-mono-tabular text-sm font-bold ${
                          row.supplyStatus === 'VERMELHO'
                            ? 'text-red-300'
                            : row.supplyStatus === 'LARANJA'
                              ? 'text-orange-300'
                              : 'text-[#F4F6F8]'
                        }`}
                      >
                        {formatKg(row.currentStockKg)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3">
                      <p className="text-[11px] text-[#AEB8C5]">Consumo Previsto Hoje</p>
                      <p className="mt-1 font-mono-tabular text-sm font-bold text-[#F4F6F8]">
                        {formatKg(row.plannedConsumptionTodayKg)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3">
                      <p className="text-[11px] text-[#AEB8C5]">Consumo Realizado</p>
                      <p className="mt-1 font-mono-tabular text-sm font-bold text-emerald-300">
                        {formatKg(row.realizedConsumptionKg)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3">
                      <p className="text-[11px] text-[#AEB8C5]">
                        {row.deficitOrSurplusKg < 0 ? 'Déficit Físico' : 'Saldo vs Consumo'}
                      </p>
                      <p
                        className={`mt-1 font-mono-tabular text-sm font-bold ${
                          row.deficitOrSurplusKg < 0 ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {row.deficitOrSurplusKg < 0
                          ? `-${formatKg(Math.abs(row.deficitOrSurplusKg))}`
                          : `+${formatKg(row.deficitOrSurplusKg)}`}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3">
                      <p className="text-[11px] text-[#AEB8C5]">Prev. Amanhã / Transf. Pendente</p>
                      <p className="mt-1 font-mono-tabular text-xs font-bold text-[#F4F6F8]">
                        {formatKg(row.plannedConsumptionTomorrowKg)} ·{' '}
                        <span className="text-blue-300">{formatKg(row.pendingTransferInboundKg)}</span>
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3">
                      <p className="text-[11px] text-[#AEB8C5]">Transferência Sugerida</p>
                      <p className="mt-1 font-mono-tabular text-sm font-bold text-[#F5B817]">
                        {row.suggestedTransferKg > 0
                          ? `S${row.suggestedOriginSiloNumber} → S${row.suggestedDestinationSiloNumber} (${formatKg(row.suggestedTransferKg)})`
                          : row.needsTransfer
                            ? 'Sem rota c/ saldo'
                            : 'Não necessária'}
                      </p>
                    </div>
                  </div>

                  {/* Feeding Silos & Transparent Time Estimate Notice */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#AEB8C5]/10 pt-3 text-xs text-[#AEB8C5]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[#F4F6F8]">Silos de alimentação:</span>
                      {row.feedingSilos.length === 0 ? (
                        <span className="text-slate-400">Nenhum silo compatível mapeado</span>
                      ) : (
                        row.feedingSilos.map((fs) => {
                          const chipAlert = evaluateFeedingSiloChipStatus({
                            confirmedStockKg: fs.confirmedStockKg,
                            safeCapacityKg: fs.safeCapacityKg,
                            parentSupplyStatus: row.supplyStatus,
                          });
                          return (
                            <span
                              key={fs.siloId}
                              className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono-tabular text-[11px] ${
                                chipAlert === 'CRITICO'
                                  ? 'border-red-500/60 bg-red-950/35 text-red-200'
                                  : chipAlert === 'ATENCAO'
                                    ? 'border-orange-500/60 bg-orange-950/30 text-orange-200'
                                    : 'border-[#AEB8C5]/20 bg-[#081321]'
                              }`}
                            >
                              {chipAlert !== 'NORMAL' && (
                                <span className="relative flex h-2 w-2 items-center justify-center">
                                  <span
                                    className={`absolute inline-flex h-full w-full rounded-full ${
                                      chipAlert === 'CRITICO'
                                        ? 'bg-red-500 nexo-beacon-ring-red'
                                        : 'bg-orange-400 nexo-beacon-ring-orange'
                                    }`}
                                  />
                                  <span
                                    className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                                      chipAlert === 'CRITICO' ? 'bg-red-500' : 'bg-orange-400'
                                    }`}
                                  />
                                </span>
                              )}
                              Silo {fs.siloNumber}: {formatKg(fs.confirmedStockKg)} (Livre:{' '}
                              {formatKg(fs.availableSpaceKg)})
                            </span>
                          );
                        })
                      )}
                    </div>
                    <span className="text-[11px] italic text-[#AEB8C5]/80">
                      {row.timeEstimateNote}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: CENTRAL DE RECOMENDAÇÕES, IA GEMINI & PRIORIZAÇÃO CONFIGURÁVEL */}
      {subTab === 'recomendacoes' && board && (
        <div className="space-y-6">
          {/* Recommendations Queue */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
                Central de Recomendações Operacionais ({board.recommendations.length})
              </h2>
              <button
                type="button"
                onClick={() => handleAskGeminiAdvisor()}
                disabled={aiLoading}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#F5B817]/50 bg-[#F5B817]/15 px-4 text-xs font-bold text-[#F5B817] hover:bg-[#F5B817]/25"
              >
                <Sparkles className="h-4 w-4" />
                <span>{aiLoading ? 'Analisando...' : 'Explicar Cenários com Gemini (IA)'}</span>
              </button>
            </div>

            {board.recommendations.length === 0 ? (
              <div className="rounded-xl border border-emerald-500/30 bg-[#102235] p-6 text-sm text-emerald-200">
                Nenhuma necessidade de abastecimento ou alerta de transferência pendente no momento.
              </div>
            ) : (
              board.recommendations.map((rec) => {
                const st = COLOR_STYLES[rec.visualStatus];
                return (
                  <div
                    key={rec.recommendationKey}
                    className={`rounded-xl border ${st.border} ${st.rowPulse} p-5 space-y-4 transition-all`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-extrabold ${st.badge}`}>
                            <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                              {st.isPulsing && (
                                <span className={`absolute inline-flex h-full w-full rounded-full ${st.beaconRing}`} />
                              )}
                              <span className={`relative inline-flex h-2 w-2 rounded-full ${st.dot}`} />
                            </span>
                            {rec.headline}
                          </span>
                          <span className="rounded bg-[#081321] px-2 py-1 font-mono-tabular text-xs font-bold text-[#F5B817]">
                            Score {rec.priorityScore}/100 ({rec.priorityLevel})
                          </span>
                          <span className="rounded border border-[#AEB8C5]/20 bg-[#081321] px-2 py-1 text-xs font-semibold text-[#F4F6F8]">
                            Status Decisão: {rec.decisionStatus}
                          </span>
                        </div>
                        <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                          {rec.lineCode} · {rec.materialCode} — {rec.materialDescription}
                        </h3>
                        <p className="text-xs text-[#AEB8C5]">{rec.justification}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-2.5 text-xs">
                        <p className="text-[#AEB8C5]">Silo Destino</p>
                        <p className="font-mono-tabular font-bold text-[#F4F6F8]">
                          {rec.destinationSiloNumber ? `Silo ${rec.destinationSiloNumber}` : '—'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-2.5 text-xs">
                        <p className="text-[#AEB8C5]">Consumo Previsto</p>
                        <p className="font-mono-tabular font-bold text-[#F4F6F8]">
                          {formatKg(rec.plannedConsumptionKg)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-2.5 text-xs">
                        <p className="text-[#AEB8C5]">Estoque Real Disponível</p>
                        <p className="font-mono-tabular font-bold text-[#F4F6F8]">
                          {formatKg(rec.availableStockKg)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-2.5 text-xs">
                        <p className="text-[#AEB8C5]">Déficit Calculado</p>
                        <p className="font-mono-tabular font-bold text-red-400">
                          {formatKg(rec.deficitKg)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-2.5 text-xs">
                        <p className="text-[#AEB8C5]">Origem & Qtd Sugerida</p>
                        <p className="font-mono-tabular font-bold text-[#F5B817]">
                          {rec.originSiloNumber && rec.suggestedTransferKg
                            ? `Silo ${rec.originSiloNumber} (${formatKg(rec.suggestedTransferKg)})`
                            : 'Sem rota autorizada c/ saldo'}
                        </p>
                      </div>
                    </div>

                    {/* Authorized vs Blocked Routes */}
                    {(rec.compatibleAuthorizedRoutes.length > 0 || rec.blockedOrPendingRoutes.length > 0) && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {rec.compatibleAuthorizedRoutes.length > 0 && (
                          <div className="rounded-lg border border-emerald-500/25 bg-[#081321] p-3 text-xs space-y-1">
                            <p className="font-bold text-emerald-300">Rotas Autorizadas Compatíveis:</p>
                            {rec.compatibleAuthorizedRoutes.map((ar) => (
                              <p key={ar.ruleId} className="text-[#AEB8C5]">
                                • Silo {ar.originSiloNumber} (Saldo: {formatKg(ar.originStockKg)} · Transf. útil:{' '}
                                {formatKg(ar.availableForTransferKg)})
                                {ar.restrictions ? ` — ${ar.restrictions}` : ''}
                              </p>
                            ))}
                          </div>
                        )}
                        {rec.blockedOrPendingRoutes.length > 0 && (
                          <div className="rounded-lg border border-red-500/25 bg-[#081321] p-3 text-xs space-y-1">
                            <p className="font-bold text-red-300">Rotas Bloqueadas / Pendentes (Não sugeridas):</p>
                            {rec.blockedOrPendingRoutes.map((br) => (
                              <p key={br.ruleId} className="text-[#AEB8C5]">
                                • Silo {br.originSiloNumber} [{br.authorizationStatus}] — {br.reason}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="flex flex-wrap items-center gap-2 border-t border-[#AEB8C5]/15 pt-3">
                      {canPlanTransfers && rec.originSiloId && rec.destinationSiloId && rec.suggestedTransferKg && (
                        <button
                          type="button"
                          onClick={() =>
                            handleTriggerTransferPlan({
                              originSiloId: rec.originSiloId,
                              destinationSiloId: rec.destinationSiloId,
                              materialId: rec.materialId,
                              transferRuleId: rec.transferRuleId,
                              suggestedTransferKg: rec.suggestedTransferKg,
                              suggestedLotCode: rec.suggestedLotCode,
                              priorityLevel: rec.priorityLevel,
                              recommendationId: rec.id,
                              recommendationKey: rec.recommendationKey,
                              lineCode: rec.lineCode,
                              materialDescription: rec.materialDescription,
                            })
                          }
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B817] px-4 text-xs font-extrabold text-[#081321] hover:bg-[#F5B817]/90"
                        >
                          <ArrowRight className="h-4 w-4" />
                          <span>CRIAR SOLICITAÇÃO DE TRANSFERÊNCIA</span>
                        </button>
                      )}

                      {canPlanTransfers && rec.materialId && (
                        <button
                          type="button"
                          onClick={() => {
                            setIntakeRec(rec);
                            setIntakeQtyKg(String(rec.deficitKg || 10000));
                            setIntakeJustification(
                              `Necessidade identificada na ${rec.lineCode} para ${rec.materialDescription} (déficit ${formatKg(rec.deficitKg)}).`
                            );
                          }}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-blue-400/50 bg-blue-500/15 px-3.5 text-xs font-bold text-blue-200 hover:bg-blue-500/25"
                        >
                          <Truck className="h-4 w-4" />
                          <span>Criar Solicitação de Recebimento</span>
                        </button>
                      )}

                      {canPlanTransfers && rec.id > 0 && (
                        <>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() =>
                              handleMarkRecDecision(rec, 'EM_ANALISE', 'Colocado em análise operacional')
                            }
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
                          >
                            <Eye className="h-4 w-4" />
                            <span>Marcar em Análise</span>
                          </button>

                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => {
                              setRejectingRec(rec);
                              setRejectReason('');
                            }}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/20"
                          >
                            <XCircle className="h-4 w-4" />
                            <span>Rejeitar</span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          handleAskGeminiAdvisor(
                            `Explique esta recomendação para ${rec.lineCode} (${rec.materialDescription}), comparando silos e rotas autorizadas vs bloqueadas.`,
                            rec
                          )
                        }
                        disabled={aiLoading}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#F5B817]/40 px-3 text-xs font-semibold text-[#F5B817] hover:bg-[#F5B817]/15"
                      >
                        <Sparkles className="h-4 w-4" />
                        <span>Explicar Alerta (IA)</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onNavigate('auditoria')}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 px-3 text-xs font-semibold text-[#AEB8C5] hover:text-[#F4F6F8]"
                      >
                        <History className="h-4 w-4" />
                        <span>Consultar Histórico</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Gemini Supply Advisor Panel */}
          <div className="rounded-xl border border-[#F5B817]/30 bg-[#102235] p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#F5B817]" />
              <div>
                <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                  Consultor Explicativo Gemini — Abastecimento, Rotas & Manual
                </h3>
                <p className="text-xs text-[#AEB8C5]">
                  Atuação estritamente consultiva sobre dados oficiais do PostgreSQL. Nunca altera rotas, cadastros ou saldos.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                placeholder="Ex.: Por que Silo 39 -> 31 não aparece como opção automática? Como faço transferência parcial?"
                className="min-h-[44px] flex-1 min-w-[260px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
              />
              <button
                type="button"
                disabled={aiLoading || !aiQuestion.trim()}
                onClick={() => handleAskGeminiAdvisor()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B817] px-4 text-xs font-extrabold text-[#081321] disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                <span>{aiLoading ? 'Consultando...' : 'Consultar IA'}</span>
              </button>
            </div>

            {aiError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/15 p-3 text-xs text-red-200">
                {aiError}
              </div>
            )}

            {aiAdvice && (
              <div className="space-y-3 rounded-lg border border-[#AEB8C5]/20 bg-[#081321] p-4 text-xs">
                <p className="leading-relaxed text-[#F4F6F8]">{aiAdvice.explanation}</p>
                {aiAdvice.scenarioComparison.length > 0 && (
                  <div>
                    <p className="font-bold text-[#F5B817]">Comparativo de Cenários Autorizados:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-[#AEB8C5]">
                      {aiAdvice.scenarioComparison.map((c, idx) => (
                        <li key={idx}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiAdvice.divergencesNoted.length > 0 && (
                  <div>
                    <p className="font-bold text-orange-300">Divergências e Bloqueios Detectados:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-orange-200/90">
                      {aiAdvice.divergencesNoted.map((d, idx) => (
                        <li key={idx}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiAdvice.manualGuidance && (
                  <p className="rounded border border-blue-400/30 bg-blue-500/10 p-2.5 text-blue-200">
                    <strong>Orientação do Manual:</strong> {aiAdvice.manualGuidance}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Intake Requests History */}
          {board.intakeRequests.length > 0 && (
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-3">
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Solicitações de Recebimento Emitidas ({board.intakeRequests.length})
              </h3>
              <div className="space-y-2">
                {board.intakeRequests.map((req) => (
                  <div
                    key={req.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3 text-xs"
                  >
                    <div>
                      <p className="font-mono-tabular font-bold text-[#F5B817]">
                        {req.requestCode} · {req.materialCode} — {req.materialDescription}
                      </p>
                      <p className="mt-0.5 text-[#AEB8C5]">
                        Linha {req.lineCode || '—'} {req.targetSiloNumber ? `· Silo ${req.targetSiloNumber}` : ''} ·
                        Qtd: <strong className="text-[#F4F6F8]">{formatKg(req.neededQuantityKg)}</strong> ·
                        Prazo: {req.neededByDate} · Solicitante: {req.requestedByName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#AEB8C5]/80">{req.justification}</p>
                    </div>
                    <span className="rounded border border-blue-400/40 bg-blue-500/15 px-2.5 py-1 font-bold text-blue-200">
                      {req.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Configurable Priority Weights */}
          <form
            onSubmit={handleSavePriorityWeights}
            className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Sliders className="h-5 w-5 text-[#F5B817]" />
              <div>
                <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                  Critérios Configuráveis de Priorização Operacional
                </h3>
                <p className="text-xs text-[#AEB8C5]">
                  Ajuste os pesos (0 a 100) utilizados pelo motor determinístico para ordenar a urgência das ações.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className="mb-1 block text-[11px] text-[#AEB8C5]">Risco de Parada da Linha</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!canManagePriority}
                  value={weightsForm.weightLineStopRisk}
                  onChange={(e) =>
                    setWeightsForm((p) => ({ ...p, weightLineStopRisk: Number(e.target.value) }))
                  }
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[#AEB8C5]">Cobertura de Estoque</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!canManagePriority}
                  value={weightsForm.weightStockCoverage}
                  onChange={(e) =>
                    setWeightsForm((p) => ({ ...p, weightStockCoverage: Number(e.target.value) }))
                  }
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[#AEB8C5]">Rota Autorizada Ativa</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!canManagePriority}
                  value={weightsForm.weightAuthorizedRoute}
                  onChange={(e) =>
                    setWeightsForm((p) => ({ ...p, weightAuthorizedRoute: Number(e.target.value) }))
                  }
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[#AEB8C5]">Saldo Disponível na Origem</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!canManagePriority}
                  value={weightsForm.weightOriginAvailability}
                  onChange={(e) =>
                    setWeightsForm((p) => ({ ...p, weightOriginAvailability: Number(e.target.value) }))
                  }
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-[#AEB8C5]">Urgência da Programação</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!canManagePriority}
                  value={weightsForm.weightScheduleUrgency}
                  onChange={(e) =>
                    setWeightsForm((p) => ({ ...p, weightScheduleUrgency: Number(e.target.value) }))
                  }
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                />
              </div>
            </div>

            {canManagePriority && (
              <div className="flex flex-wrap items-center justify-end gap-3">
                <input
                  type="text"
                  value={weightsReason}
                  onChange={(e) => setWeightsReason(e.target.value)}
                  placeholder="Motivo da alteração dos critérios..."
                  className="min-h-[44px] flex-1 min-w-[220px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                />
                <button
                  type="submit"
                  disabled={savingWeights}
                  className="min-h-[44px] rounded-lg border border-[#F5B817] bg-[#F5B817]/15 px-5 text-xs font-bold text-[#F5B817] hover:bg-[#F5B817]/25"
                >
                  {savingWeights ? 'Salvando...' : 'Salvar Critérios de Priorização'}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* TAB 3: ROTAS AUTORIZADAS */}
      {subTab === 'rotas' && (
        <div className="space-y-6">
          {/* Create New Route (ADMIN / SUPERVISOR) */}
          {canManageRoutes && (
            <form
              onSubmit={handleCreateRoute}
              className="rounded-xl border border-[#F5B817]/30 bg-[#102235] p-5 space-y-4"
            >
              <div className="flex items-center gap-2">
                <PlusCircle className="h-5 w-5 text-[#F5B817]" />
                <h2 className="font-display text-base font-bold text-[#F4F6F8]">
                  Cadastrar Nova Rota de Transferência (Validação por Compatibilidade)
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs text-[#AEB8C5]">Silo de Origem *</label>
                  <select
                    required
                    value={newRouteOriginId}
                    onChange={(e) => {
                      setNewRouteOriginId(e.target.value);
                      const s = silos.find((item) => String(item.id) === e.target.value);
                      if (s?.primaryMaterialId && !newRouteMatId) {
                        setNewRouteMatId(String(s.primaryMaterialId));
                      }
                    }}
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                  >
                    <option value="">Selecione origem...</option>
                    {silos.map((s) => (
                      <option key={s.id} value={s.id}>
                        Silo {s.siloNumber} ({s.lineCode} · {s.materialDescription || 'Sem MP'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#AEB8C5]">Silo de Destino *</label>
                  <select
                    required
                    value={newRouteDestId}
                    onChange={(e) => setNewRouteDestId(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                  >
                    <option value="">Selecione destino...</option>
                    {silos.map((s) => (
                      <option key={s.id} value={s.id}>
                        Silo {s.siloNumber} ({s.lineCode} · {s.materialDescription || 'Sem MP'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#AEB8C5]">Matéria-Prima *</label>
                  <select
                    required
                    value={newRouteMatId}
                    onChange={(e) => setNewRouteMatId(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                  >
                    <option value="">Selecione material...</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.description}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#AEB8C5]">Status Inicial *</label>
                  <select
                    value={newRouteStatus}
                    onChange={(e) => setNewRouteStatus(e.target.value as RouteAuthStatus)}
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                  >
                    <option value="PENDENTE_VALIDACAO">PENDENTE_VALIDACAO</option>
                    <option value="AUTORIZADA">AUTORIZADA</option>
                    <option value="SUSPENSA">SUSPENSA</option>
                    <option value="BLOQUEADA">BLOQUEADA</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={newRouteMaxKg}
                  onChange={(e) => setNewRouteMaxKg(e.target.value)}
                  placeholder="Limite máx. por operação (kg, opcional)"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                />
                <input
                  type="text"
                  value={newRouteRestrictions}
                  onChange={(e) => setNewRouteRestrictions(e.target.value)}
                  placeholder="Restrições operacionais (opcional)"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                />
                <input
                  type="text"
                  required
                  minLength={5}
                  value={newRouteReason}
                  onChange={(e) => setNewRouteReason(e.target.value)}
                  placeholder="Justificativa / Documento de engenharia *"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={creatingRoute}
                  className="min-h-[44px] rounded-lg bg-[#F5B817] px-5 text-xs font-extrabold text-[#081321] hover:bg-[#F5B817]/90 disabled:opacity-50"
                >
                  {creatingRoute ? 'Salvando Rota...' : 'Cadastrar Rota na Matriz'}
                </button>
              </div>
            </form>
          )}

          {/* Filter & Routes List */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-[#F5B817]" />
                <h2 className="font-display text-base font-bold text-[#F4F6F8]">
                  Cadastro Oficial de Rotas entre Silos ({filteredRoutes.length})
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={routeSearch}
                  onChange={(e) => setRouteSearch(e.target.value)}
                  placeholder="Filtrar silo, código ou material..."
                  className="min-h-[42px] w-56 rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                />
                <select
                  value={routeStatusFilter}
                  onChange={(e) => setRouteStatusFilter(e.target.value)}
                  className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs font-semibold text-[#F4F6F8]"
                >
                  <option value="TODAS">Todos os Status</option>
                  <option value="AUTORIZADA">Autorizada</option>
                  <option value="PENDENTE_VALIDACAO">Pendente de Validação</option>
                  <option value="SUSPENSA">Suspensa</option>
                  <option value="BLOQUEADA">Bloqueada</option>
                </select>
              </div>
            </div>

            <div className="space-y-3">
              {filteredRoutes.map((route) => (
                <div
                  key={route.id}
                  className="rounded-xl border border-[#AEB8C5]/15 bg-[#081321] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono-tabular text-base font-extrabold text-[#F5B817]">
                          Silo {route.originSiloNumber} → Silo {route.destinationSiloNumber}
                        </span>
                        <span
                          className={`rounded-md border px-2.5 py-0.5 text-[11px] font-bold ${
                            ROUTE_STATUS_STYLES[route.authorizationStatus]
                          }`}
                        >
                          {route.authorizationStatus}
                        </span>
                        {route.relatedLineCode && (
                          <span className="rounded border border-orange-500/35 bg-orange-500/10 px-2 py-0.5 text-[11px] font-bold text-orange-300">
                            Linha {route.relatedLineCode}
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-semibold text-[#F4F6F8]">
                        {route.materialCode} — {route.materialDescription}
                      </p>
                      <p className="text-[11px] text-[#AEB8C5]">
                        Limite por transferência:{' '}
                        <strong className="text-[#F4F6F8]">
                          {route.maxQuantityKg ? formatKg(route.maxQuantityKg) : 'Conforme capacidade segura (-10%)'}
                        </strong>{' '}
                        · Responsável aprovação:{' '}
                        <strong className="text-[#F4F6F8]">
                          {route.approvedByName || (route.authorizationStatus === 'AUTORIZADA' ? 'Homologação Base' : 'Aguardando Supervisor/Admin')}
                        </strong>
                        {route.approvedAt
                          ? ` (${new Date(route.approvedAt).toLocaleString('pt-BR')})`
                          : ''}
                      </p>
                      {(route.restrictions || route.sourceReference) && (
                        <p className="text-[11px] text-[#AEB8C5]/85">
                          {route.restrictions ? `Restrições: ${route.restrictions} · ` : ''}
                          {route.sourceReference}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {canManageRoutes && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingRoute(route);
                            setEditRouteStatus(route.authorizationStatus);
                            setEditRouteMaxKg(route.maxQuantityKg ? String(route.maxQuantityKg) : '');
                            setEditRouteRestrictions(route.restrictions || '');
                            setEditRouteReason('');
                          }}
                          className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#F5B817]/40 bg-[#F5B817]/10 px-3 text-xs font-bold text-[#F5B817] hover:bg-[#F5B817]/20"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          <span>Gerenciar Autorização</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedRouteHistoryId(
                            expandedRouteHistoryId === route.id ? null : route.id
                          )
                        }
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 px-3 text-xs font-semibold text-[#AEB8C5] hover:text-[#F4F6F8]"
                      >
                        <History className="h-3.5 w-3.5" />
                        <span>Histórico ({route.history.length})</span>
                        {expandedRouteHistoryId === route.id ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {expandedRouteHistoryId === route.id && (
                    <div className="border-t border-[#AEB8C5]/15 pt-3 space-y-2">
                      <p className="text-[11px] font-bold text-[#F5B817]">
                        Histórico de Alterações da Rota #{route.id}
                      </p>
                      {route.history.length === 0 ? (
                        <p className="text-[11px] text-[#AEB8C5]">
                          Rota inicial cadastrada na base oficial sem alterações posteriores.
                        </p>
                      ) : (
                        route.history.map((h) => (
                          <div
                            key={h.id}
                            className="rounded border border-[#AEB8C5]/15 bg-[#102235] p-2.5 text-[11px]"
                          >
                            <p className="font-semibold text-[#F4F6F8]">
                              {h.action} · {h.userName} ({h.userRole}) ·{' '}
                              {new Date(h.createdAt).toLocaleString('pt-BR')}
                            </p>
                            {h.reason && <p className="text-[#AEB8C5]">Motivo: {h.reason}</p>}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Rejeitar Recomendação */}
      {rejectingRec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-red-500/40 bg-[#102235] p-6 space-y-4">
            <div className="flex items-center gap-2 text-red-300">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Rejeitar Recomendação ({rejectingRec.lineCode})
              </h3>
            </div>
            <p className="text-xs text-[#AEB8C5]">
              Justifique o motivo operacional da rejeição (mínimo 5 caracteres). A decisão será gravada na auditoria.
            </p>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Ex.: Linha terá troca de formulação confirmada pela Supervisão."
              className="w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] p-3 text-xs text-[#F4F6F8]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectingRec(null)}
                className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 px-4 text-xs text-[#AEB8C5]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={actionBusy || rejectReason.trim().length < 5}
                onClick={() => handleMarkRecDecision(rejectingRec, 'REJEITADA', rejectReason)}
                className="min-h-[42px] rounded-lg bg-red-600 px-4 text-xs font-bold text-white disabled:opacity-50"
              >
                Confirmar Rejeição
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Criar Solicitação de Recebimento */}
      {intakeRec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreateIntakeRequest}
            className="w-full max-w-md rounded-xl border border-blue-500/40 bg-[#102235] p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-blue-300">
              <Truck className="h-5 w-5" />
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Criar Solicitação de Recebimento
              </h3>
            </div>
            <p className="text-xs text-[#AEB8C5]">
              {intakeRec.lineCode} · {intakeRec.materialCode} — {intakeRec.materialDescription}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-[#AEB8C5]">Quantidade (kg) *</label>
                <input
                  type="number"
                  step="0.001"
                  min="1"
                  required
                  value={intakeQtyKg}
                  onChange={(e) => setIntakeQtyKg(e.target.value)}
                  className="min-h-[42px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-xs font-bold text-[#F4F6F8]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#AEB8C5]">Data Necessidade *</label>
                <input
                  type="date"
                  required
                  value={intakeDate}
                  onChange={(e) => setIntakeDate(e.target.value)}
                  className="min-h-[42px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#AEB8C5]">Justificativa Operacional *</label>
              <textarea
                rows={3}
                required
                minLength={5}
                value={intakeJustification}
                onChange={(e) => setIntakeJustification(e.target.value)}
                className="w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] p-3 text-xs text-[#F4F6F8]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIntakeRec(null)}
                className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 px-4 text-xs text-[#AEB8C5]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="min-h-[42px] rounded-lg bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-50"
              >
                {actionBusy ? 'Registrando...' : 'Confirmar Solicitação'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Gerenciar Autorização de Rota */}
      {editingRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveRouteStatus}
            className="w-full max-w-md rounded-xl border border-[#F5B817]/40 bg-[#102235] p-6 space-y-4"
          >
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Gerenciar Rota Silo {editingRoute.originSiloNumber} → Silo {editingRoute.destinationSiloNumber}
            </h3>
            <p className="text-xs text-[#AEB8C5]">
              {editingRoute.materialCode} — {editingRoute.materialDescription}
            </p>
            <div>
              <label className="mb-1 block text-xs text-[#AEB8C5]">Status de Autorização *</label>
              <select
                value={editRouteStatus}
                onChange={(e) => setEditRouteStatus(e.target.value as RouteAuthStatus)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs font-bold text-[#F4F6F8]"
              >
                <option value="AUTORIZADA">AUTORIZADA (Liberada para transferência)</option>
                <option value="PENDENTE_VALIDACAO">PENDENTE_VALIDACAO (Bloqueada)</option>
                <option value="SUSPENSA">SUSPENSA (Bloqueada)</option>
                <option value="BLOQUEADA">BLOQUEADA (Bloqueada)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#AEB8C5]">Limite Máximo por Operação (kg)</label>
              <input
                type="number"
                step="0.01"
                value={editRouteMaxKg}
                onChange={(e) => setEditRouteMaxKg(e.target.value)}
                placeholder="Vazio = capacidade segura do destino"
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#AEB8C5]">Restrições / Observações</label>
              <input
                type="text"
                value={editRouteRestrictions}
                onChange={(e) => setEditRouteRestrictions(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[#AEB8C5]">Motivo da Alteração (Auditável) *</label>
              <textarea
                rows={2}
                required
                minLength={5}
                value={editRouteReason}
                onChange={(e) => setEditRouteReason(e.target.value)}
                placeholder="Informe o motivo operacional/engenharia..."
                className="w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] p-3 text-xs text-[#F4F6F8]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingRoute(null)}
                className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 px-4 text-xs text-[#AEB8C5]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={actionBusy}
                className="min-h-[42px] rounded-lg bg-[#F5B817] px-4 text-xs font-extrabold text-[#081321] disabled:opacity-50"
              >
                {actionBusy ? 'Salvando...' : 'Confirmar Alteração'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
