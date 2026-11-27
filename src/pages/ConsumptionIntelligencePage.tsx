import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Filter,
  Info,
  Layers,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sliders,
  X,
} from 'lucide-react';
import {
  IntelligenceSummaryResponse,
  MaterialItem,
  NavSectionId,
  ProductWithFactorsItem,
  SiloDetail,
  StockThresholdItem,
} from '../types/nexo.ts';
import { apiFetch, formatKg } from '../lib/api.ts';
import { AlertPriority, ExecutionStatus } from '../lib/production-intelligence.ts';

interface ConsumptionIntelligencePageProps {
  silos: SiloDetail[];
  materials: MaterialItem[];
  canManageFactors: boolean;
  canDecideRecommendations: boolean;
  onNavigate: (section: NavSectionId) => void;
}

interface LineOption {
  id: number;
  code: string;
  name: string;
}

const PRIORITY_STYLE: Record<
  AlertPriority,
  { badge: string; border: string; text: string; label: string }
> = {
  VERMELHO: {
    badge: 'bg-red-500/20 text-red-200 border-red-500/50',
    border: 'border-red-500/50 bg-red-500/10',
    text: 'text-red-300',
    label: 'VERMELHO — CRÍTICO',
  },
  LARANJA: {
    badge: 'bg-orange-500/20 text-orange-200 border-orange-500/50',
    border: 'border-orange-500/50 bg-orange-500/10',
    text: 'text-orange-300',
    label: 'LARANJA — ATENÇÃO',
  },
  AZUL: {
    badge: 'bg-[#3B82F6]/20 text-blue-200 border-[#3B82F6]/50',
    border: 'border-[#3B82F6]/50 bg-[#3B82F6]/10',
    text: 'text-[#3B82F6]',
    label: 'AZUL — INFORMATIVO',
  },
  VERDE: {
    badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50',
    border: 'border-emerald-500/40 bg-emerald-500/10',
    text: 'text-emerald-300',
    label: 'VERDE — REGULAR',
  },
};

export const ConsumptionIntelligencePage: React.FC<ConsumptionIntelligencePageProps> = ({
  silos,
  materials,
  canManageFactors,
  canDecideRecommendations,
  onNavigate,
}) => {
  const [subTab, setSubTab] = useState<'confronto' | 'fatores' | 'limites'>('confronto');
  const [lines, setLines] = useState<LineOption[]>([]);
  const [summary, setSummary] = useState<IntelligenceSummaryResponse | null>(null);
  const [products, setProducts] = useState<ProductWithFactorsItem[]>([]);
  const [thresholds, setThresholds] = useState<StockThresholdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Filtros obrigatórios (Data, Linha, Material, Silo, Status, Prioridade)
  const [filterDate, setFilterDate] = useState('');
  const [filterLine, setFilterLine] = useState('');
  const [filterMaterialId, setFilterMaterialId] = useState('');
  const [filterSiloId, setFilterSiloId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // Form Produto & Fator
  const [prodCode, setProdCode] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodLineId, setProdLineId] = useState('');
  const [factorProductId, setFactorProductId] = useState('');
  const [factorMaterialId, setFactorMaterialId] = useState('');
  const [factorKg, setFactorKg] = useState('');
  const [factorUnit, setFactorUnit] = useState('t');
  const [factorStatus, setFactorStatus] = useState<'VALIDADO' | 'PENDENTE_VALIDACAO'>('VALIDADO');
  const [factorRef, setFactorRef] = useState('');

  // Form Thresholds
  const [thrMatId, setThrMatId] = useState('');
  const [thrSiloId, setThrSiloId] = useState('');
  const [thrMinKg, setThrMinKg] = useState('');
  const [thrWarnKg, setThrWarnKg] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterDate) qs.set('todayDate', filterDate);
      if (filterLine) qs.set('lineCode', filterLine);
      if (filterMaterialId) qs.set('materialId', filterMaterialId);
      if (filterSiloId) qs.set('siloId', filterSiloId);
      if (filterStatus) qs.set('executionStatus', filterStatus);
      if (filterPriority) qs.set('priority', filterPriority);

      const [linesRes, sumRes, prodRes, thrRes] = await Promise.all([
        apiFetch<LineOption[]>('/api/lines'),
        apiFetch<IntelligenceSummaryResponse>(`/api/intelligence/summary?${qs.toString()}`),
        apiFetch<ProductWithFactorsItem[]>('/api/products'),
        apiFetch<StockThresholdItem[]>('/api/stock-thresholds'),
      ]);
      setLines(linesRes);
      setSummary(sumRes);
      setProducts(prodRes);
      setThresholds(thrRes);
      if (!filterDate && sumRes.todayDate) {
        setFilterDate(sumRes.todayDate);
      }
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao carregar inteligência operacional.' });
    } finally {
      setLoading(false);
    }
  }, [filterDate, filterLine, filterMaterialId, filterSiloId, filterStatus, filterPriority]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleDecision = async (recId: number, decision: 'ACEITA' | 'REJEITADA') => {
    setFeedback(null);
    try {
      await apiFetch(`/api/intelligence/recommendations/${recId}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          decisionNotes:
            decision === 'ACEITA'
              ? 'Sugestão aceita pelo operador para execução assistida'
              : 'Sugestão rejeitada pelo operador após análise local',
        }),
      });
      setFeedback({
        type: 'ok',
        msg: `Decisão (${decision}) registrada na auditoria sem alterar estoque automaticamente.`,
      });
      await loadAll();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao registrar decisão.' });
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodCode.trim() || !prodDesc.trim()) return;
    setFeedback(null);
    try {
      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          code: prodCode,
          description: prodDesc,
          defaultProductionLineId: prodLineId ? Number(prodLineId) : null,
        }),
      });
      setProdCode('');
      setProdDesc('');
      setFeedback({ type: 'ok', msg: 'Produto salvo no cadastro oficial.' });
      await loadAll();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao salvar produto.' });
    }
  };

  const handleSaveFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorProductId || !factorMaterialId || !factorKg) return;
    setFeedback(null);
    try {
      await apiFetch('/api/consumption-factors', {
        method: 'POST',
        body: JSON.stringify({
          productId: Number(factorProductId),
          materialId: Number(factorMaterialId),
          factorKgPerUnit: Number(factorKg),
          unit: factorUnit,
          validationStatus: factorStatus,
          sourceReference: factorRef || null,
        }),
      });
      setFactorKg('');
      setFactorRef('');
      setFeedback({ type: 'ok', msg: 'Fator determinístico de consumo salvo com auditoria.' });
      await loadAll();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao salvar fator.' });
    }
  };

  const handleSaveThreshold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thrMatId || !thrMinKg || !thrWarnKg) return;
    setFeedback(null);
    try {
      await apiFetch('/api/stock-thresholds', {
        method: 'POST',
        body: JSON.stringify({
          materialId: Number(thrMatId),
          siloId: thrSiloId ? Number(thrSiloId) : null,
          minStockKg: Number(thrMinKg),
          warningStockKg: Number(thrWarnKg),
        }),
      });
      setThrMinKg('');
      setThrWarnKg('');
      setFeedback({ type: 'ok', msg: 'Limite mínimo de estoque configurado.' });
      await loadAll();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao salvar limite.' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#F5B817]">
              PAINEL DE INTELIGÊNCIA OPERACIONAL · FASE 3
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">
              Consumo, Saldo Projetado e Alertas
            </h2>
            <p className="mt-1 text-xs text-[#AEB8C5]">
              Confronto determinístico entre estoque real (livro razão), descargas pendentes confirmadas e programação das linhas L1 a L7.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('programacao')}
              className="min-h-[44px] rounded-lg border border-[#F5B817]/40 bg-[#081321] px-4 py-2 text-xs font-bold text-[#F5B817] hover:bg-[#F5B817]/10"
            >
              Abrir Programação →
            </button>
            <button
              type="button"
              onClick={loadAll}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[#AEB8C5]/25 bg-[#081321] text-[#AEB8C5] hover:text-white"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Sub-navigation */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[#AEB8C5]/15 pt-4">
          <button
            type="button"
            onClick={() => setSubTab('confronto')}
            className={`min-h-[42px] rounded-lg px-4 text-xs font-bold ${
              subTab === 'confronto'
                ? 'bg-[#F5B817] text-[#081321]'
                : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5]'
            }`}
          >
            Confronto & Alertas
          </button>
          <button
            type="button"
            onClick={() => setSubTab('fatores')}
            className={`min-h-[42px] rounded-lg px-4 text-xs font-bold ${
              subTab === 'fatores'
                ? 'bg-[#F5B817] text-[#081321]'
                : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5]'
            }`}
          >
            Produtos & Fatores de Consumo ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('limites')}
            className={`min-h-[42px] rounded-lg px-4 text-xs font-bold ${
              subTab === 'limites'
                ? 'bg-[#F5B817] text-[#081321]'
                : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5]'
            }`}
          >
            Limites Mínimos ({thresholds.length})
          </button>
        </div>

        {feedback && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg border p-3 text-xs ${
              feedback.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
                : 'border-red-500/40 bg-red-500/15 text-red-100'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-400" />
            )}
            <span>{feedback.msg}</span>
          </div>
        )}
      </div>

      {subTab === 'confronto' && summary && (
        <>
          {/* Filtros completos (Data, Linha, Material, Silo, Status, Prioridade) */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase text-[#AEB8C5]">
              <Filter className="h-4 w-4 text-[#F5B817]" />
              <span>Filtros do Painel de Inteligência</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <label className="mb-1 block text-[10px] text-[#AEB8C5]">Data Base</label>
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#081321] px-2.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-[10px] text-[#AEB8C5]">Linha</label>
                <select
                  value={filterLine}
                  onChange={(e) => setFilterLine(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#081321] px-2.5 text-xs text-white"
                >
                  <option value="">Todas (L1–L7)</option>
                  {lines.map((l) => (
                    <option key={l.id} value={l.code}>
                      {l.code} — {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[10px] text-[#AEB8C5]">Matéria-Prima</label>
                <select
                  value={filterMaterialId}
                  onChange={(e) => setFilterMaterialId(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#081321] px-2.5 text-xs text-white"
                >
                  <option value="">Todas</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.description}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[10px] text-[#AEB8C5]">Silo</label>
                <select
                  value={filterSiloId}
                  onChange={(e) => setFilterSiloId(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#081321] px-2.5 text-xs text-white"
                >
                  <option value="">Todos (54 silos)</option>
                  {silos.map((s) => (
                    <option key={s.id} value={s.id}>
                      Silo {s.siloNumber} ({s.lineCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[10px] text-[#AEB8C5]">Status Execução</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#081321] px-2.5 text-xs text-white"
                >
                  <option value="">Todos</option>
                  <option value="NAO_INICIADA">Não iniciada</option>
                  <option value="EM_ANDAMENTO">Em andamento</option>
                  <option value="ADIANTADA">Adiantada</option>
                  <option value="ATRASADA">Atrasada</option>
                  <option value="CONCLUIDA">Concluída</option>
                  <option value="INTERROMPIDA">Interrompida</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[10px] text-[#AEB8C5]">Prioridade</label>
                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  className="min-h-[40px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#081321] px-2.5 text-xs text-white"
                >
                  <option value="">Todas</option>
                  <option value="VERMELHO">Vermelho (Crítico)</option>
                  <option value="LARANJA">Laranja (Atenção)</option>
                  <option value="AZUL">Azul (Informativo)</option>
                  <option value="VERDE">Verde (Regular)</option>
                </select>
              </div>
            </div>
          </div>

          {/* 3 Indicadores Independentes + Metadados de Programação */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-emerald-500/30 bg-[#102235] p-5">
              <p className="text-xs font-bold uppercase text-emerald-400">
                1. ESTOQUE REAL (Físico)
              </p>
              <p className="mt-2 font-mono-tabular text-3xl font-extrabold text-white">
                {formatKg(summary.totals.realStockKg)}
              </p>
              <p className="mt-2 text-[11px] text-[#AEB8C5]">
                Calculado apenas por movimentações confirmadas. Programação futura nunca abate saldo físico.
              </p>
            </div>

            <div className="rounded-xl border border-orange-500/30 bg-[#102235] p-5">
              <p className="text-xs font-bold uppercase text-orange-400">
                2. CONSUMO PREVISTO (Hoje / Amanhã)
              </p>
              <p className="mt-2 font-mono-tabular text-3xl font-extrabold text-white">
                {formatKg(summary.totals.plannedConsumptionTodayKg)}
              </p>
              <p className="mt-2 font-mono-tabular text-xs text-[#AEB8C5]">
                Amanhã: {formatKg(summary.totals.plannedConsumptionTomorrowKg)} · Realizado:{' '}
                {formatKg(summary.totals.realizedConsumptionKg)}
              </p>
            </div>

            <div className="rounded-xl border border-[#3B82F6]/30 bg-[#102235] p-5">
              <p className="text-xs font-bold uppercase text-[#3B82F6]">
                3. SALDO PROJETADO
              </p>
              <p
                className={`mt-2 font-mono-tabular text-3xl font-extrabold ${
                  summary.totals.projectedBalanceTotalKg < 0 ? 'text-red-400' : 'text-white'
                }`}
              >
                {formatKg(summary.totals.projectedBalanceTotalKg)}
              </p>
              <p className="mt-2 font-mono-tabular text-xs text-[#AEB8C5]">
                Inclui +{formatKg(summary.totals.confirmedPendingEntriesKg)} de descargas confirmadas pendentes.
              </p>
            </div>

            <div className="rounded-xl border border-[#F5B817]/30 bg-[#102235] p-5">
              <p className="text-xs font-bold uppercase text-[#F5B817]">
                Última Programação & Críticos
              </p>
              <p className="mt-2 font-mono-tabular text-2xl font-extrabold text-white">
                {summary.totals.criticalMaterialsCount} críticos ·{' '}
                {summary.totals.pendingSupplyCount} ações
              </p>
              <p className="mt-2 text-xs text-[#AEB8C5]">
                {summary.latestSchedule
                  ? `${summary.latestSchedule.scheduleCode} (Rev. ${summary.latestSchedule.revisionNumber})`
                  : 'Nenhuma programação aprovada ainda'}
              </p>
            </div>
          </div>

          {/* Alertas Inteligentes & Sugestões de Ação */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Alertas */}
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 lg:col-span-5 space-y-3">
              <div className="flex items-center gap-2 border-b border-[#AEB8C5]/15 pb-3">
                <ShieldAlert className="h-5 w-5 text-[#F5B817]" />
                <h3 className="font-display text-base font-bold text-white">
                  Alertas Inteligentes ({summary.alerts.length})
                </h3>
              </div>

              {summary.alerts.length === 0 ? (
                <p className="text-xs text-[#AEB8C5]">Nenhum alerta para os filtros ativos.</p>
              ) : (
                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {summary.alerts.map((al) => {
                    const st = PRIORITY_STYLE[al.priority];
                    return (
                      <div key={al.key} className={`rounded-lg border p-3.5 ${st.border}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${st.badge}`}>
                            {st.label}
                          </span>
                          <span className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                            {al.lineCode || ''} {al.siloNumber ? `· Silo ${al.siloNumber}` : ''}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-bold text-white">{al.title}</p>
                        <p className="mt-1 text-xs text-[#AEB8C5]">{al.message}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Sugestões de Ação (sem execução automática!) */}
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-[#AEB8C5]/15 pb-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-[#F5B817]" />
                  <h3 className="font-display text-base font-bold text-white">
                    Sugestões de Ação Autorizadas ({summary.recommendations.length})
                  </h3>
                </div>
                <span className="text-[11px] text-[#AEB8C5]">
                  Decisão humana obrigatória
                </span>
              </div>

              {summary.recommendations.length === 0 ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200">
                  Nenhuma sugestão pendente de abastecimento ou transferência.
                </div>
              ) : (
                <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                  {summary.recommendations.map((rec) => {
                    const st = PRIORITY_STYLE[rec.priority];
                    return (
                      <div key={rec.id} className="rounded-xl border border-[#AEB8C5]/20 bg-[#081321] p-4 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${st.badge}`}>
                            {rec.recommendationType.replace('_', ' ')}
                          </span>
                          <span className="font-mono-tabular text-xs text-[#AEB8C5]">
                            Prazo: {rec.referenceDate} {rec.lineCode ? `· ${rec.lineCode}` : ''}
                          </span>
                        </div>

                        <p className="text-sm font-bold text-white">{rec.title}</p>
                        <p className="text-xs text-[#AEB8C5]">{rec.reason}</p>

                        <div className="grid grid-cols-3 gap-2 rounded-lg border border-[#AEB8C5]/15 bg-[#102235] p-2.5 text-xs font-mono-tabular">
                          <div>
                            <span className="block text-[10px] text-[#AEB8C5]">Necessário</span>
                            <strong className="text-white">{formatKg(rec.requiredKg)}</strong>
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#AEB8C5]">Disponível</span>
                            <strong className="text-emerald-300">{formatKg(rec.availableKg)}</strong>
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#AEB8C5]">Faltante</span>
                            <strong className="text-red-300">{formatKg(rec.missingKg)}</strong>
                          </div>
                        </div>

                        <p className="text-[11px] text-[#AEB8C5]">
                          <Info className="mr-1 inline h-3.5 w-3.5 text-[#3B82F6]" />
                          Fonte: {rec.dataSourceSummary}
                        </p>

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#AEB8C5]/10 pt-2.5">
                          <span className="text-xs font-semibold text-[#F5B817]">
                            Status da Decisão: {rec.decisionStatus}
                          </span>

                          <div className="flex flex-wrap gap-2">
                            {canDecideRecommendations && rec.decisionStatus === 'PENDENTE' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleDecision(rec.id, 'ACEITA')}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-emerald-500 px-3 text-xs font-bold text-[#081321] hover:bg-emerald-400"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Aceitar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDecision(rec.id, 'REJEITADA')}
                                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-red-500/40 px-3 text-xs font-semibold text-red-200 hover:bg-red-500/15"
                                >
                                  <X className="h-3.5 w-3.5" />
                                  Rejeitar
                                </button>
                              </>
                            )}

                            {rec.recommendationType === 'TRANSFERIR_SILO' && (
                              <button
                                type="button"
                                onClick={() => onNavigate('transferencias')}
                                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#F5B817]/40 px-3 text-xs font-semibold text-[#F5B817]"
                              >
                                Abrir Transferências <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {rec.recommendationType === 'PROGRAMAR_RECEBIMENTO' && (
                              <button
                                type="button"
                                onClick={() => onNavigate('recebimentos')}
                                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#3B82F6]/40 px-3 text-xs font-semibold text-[#3B82F6]"
                              >
                                Abrir Recebimentos <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Tabela de Confronto por Matéria-Prima */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5">
            <div className="mb-4 flex items-center gap-2">
              <Layers className="h-5 w-5 text-[#F5B817]" />
              <h3 className="font-display text-base font-bold text-white">
                Confronto por Matéria-Prima (Estoque Real × Consumo Previsto × Saldo Projetado)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#AEB8C5]/15 text-[#AEB8C5]">
                    <th className="py-2.5 pr-3">Matéria-Prima</th>
                    <th className="px-3 py-2.5 text-right">Estoque Real</th>
                    <th className="px-3 py-2.5 text-right">Pend. Confirmado</th>
                    <th className="px-3 py-2.5 text-right">Prev. Hoje</th>
                    <th className="px-3 py-2.5 text-right">Prev. Amanhã</th>
                    <th className="px-3 py-2.5 text-right">Realizado</th>
                    <th className="px-3 py-2.5 text-right">Saldo Proj.</th>
                    <th className="pl-3 py-2.5">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#AEB8C5]/10">
                  {summary.byMaterial.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-[#AEB8C5]">
                        Nenhum material com saldo, programação aprovada ou limite configurado nos filtros atuais.
                      </td>
                    </tr>
                  ) : (
                    summary.byMaterial.map((row) => {
                      const st = PRIORITY_STYLE[row.statusPriority];
                      return (
                        <tr key={row.materialId} className="hover:bg-[#081321]/50">
                          <td className="py-3 pr-3">
                            <p className="font-mono-tabular font-bold text-[#F5B817]">
                              {row.materialCode}
                            </p>
                            <p className="text-white">{row.materialDescription}</p>
                          </td>
                          <td className="px-3 py-3 text-right font-mono-tabular font-bold text-emerald-300">
                            {formatKg(row.realStockKg)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono-tabular text-[#3B82F6]">
                            +{formatKg(row.confirmedPendingEntriesKg)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono-tabular text-white">
                            {formatKg(row.plannedConsumptionTodayKg)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono-tabular text-[#AEB8C5]">
                            {formatKg(row.plannedConsumptionTomorrowKg)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono-tabular text-[#AEB8C5]">
                            {formatKg(row.realizedConsumptionKg)}
                          </td>
                          <td
                            className={`px-3 py-3 text-right font-mono-tabular font-bold ${
                              row.projectedBalanceWithTomorrowKg < 0
                                ? 'text-red-400'
                                : 'text-white'
                            }`}
                          >
                            {formatKg(row.projectedBalanceWithTomorrowKg)}
                          </td>
                          <td className="pl-3 py-3">
                            <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-bold ${st.badge}`}>
                              {row.statusPriority}
                            </span>
                            <p className="mt-1 text-[11px] text-[#AEB8C5]">{row.statusHeadline}</p>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Sub-aba: Produtos & Fatores de Consumo */}
      {subTab === 'fatores' && (
        <div className="space-y-6">
          {canManageFactors && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <form
                onSubmit={handleSaveProduct}
                className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-3"
              >
                <h3 className="font-display text-base font-bold text-white">
                  1. Cadastrar Produto Programado
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <input
                    type="text"
                    required
                    value={prodCode}
                    onChange={(e) => setProdCode(e.target.value)}
                    placeholder="Código (ex.: RAC-CORTE)"
                    className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-white"
                  />
                  <input
                    type="text"
                    required
                    value={prodDesc}
                    onChange={(e) => setProdDesc(e.target.value)}
                    placeholder="Descrição do Produto"
                    className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-white sm:col-span-2"
                  />
                </div>
                <div className="flex gap-3">
                  <select
                    value={prodLineId}
                    onChange={(e) => setProdLineId(e.target.value)}
                    className="min-h-[42px] flex-1 rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-white"
                  >
                    <option value="">Linha padrão (opcional)</option>
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} — {l.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-[#F5B817] px-4 text-xs font-bold text-[#081321]"
                  >
                    <Plus className="h-4 w-4" /> Salvar Produto
                  </button>
                </div>
              </form>

              <form
                onSubmit={handleSaveFactor}
                className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-3"
              >
                <h3 className="font-display text-base font-bold text-white">
                  2. Vincular Fator de Consumo Determinístico
                </h3>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <select
                    required
                    value={factorProductId}
                    onChange={(e) => setFactorProductId(e.target.value)}
                    className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-white"
                  >
                    <option value="">Selecione o Produto</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.description}
                      </option>
                    ))}
                  </select>

                  <select
                    required
                    value={factorMaterialId}
                    onChange={(e) => setFactorMaterialId(e.target.value)}
                    className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-white"
                  >
                    <option value="">Selecione a Matéria-Prima</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.description}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    required
                    step="0.0001"
                    min="0.0001"
                    value={factorKg}
                    onChange={(e) => setFactorKg(e.target.value)}
                    placeholder="kg de MP por 1 unidade do produto"
                    className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-xs text-white"
                  />

                  <div className="flex gap-2">
                    <select
                      value={factorUnit}
                      onChange={(e) => setFactorUnit(e.target.value)}
                      className="min-h-[42px] flex-1 rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-2 text-xs text-white"
                    >
                      <option value="t">por Tonelada (t)</option>
                      <option value="kg">por kg</option>
                      <option value="batelada">por Batelada</option>
                    </select>
                    <select
                      value={factorStatus}
                      onChange={(e) =>
                        setFactorStatus(e.target.value as 'VALIDADO' | 'PENDENTE_VALIDACAO')
                      }
                      className="min-h-[42px] flex-1 rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-2 text-xs text-white"
                    >
                      <option value="VALIDADO">Validado</option>
                      <option value="PENDENTE_VALIDACAO">Pendente</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={factorRef}
                    onChange={(e) => setFactorRef(e.target.value)}
                    placeholder="Referência da fórmula (opcional)"
                    className="min-h-[42px] flex-1 rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-white"
                  />
                  <button
                    type="submit"
                    className="min-h-[42px] rounded-lg bg-emerald-500 px-4 text-xs font-bold text-[#081321]"
                  >
                    Salvar Fator
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5">
            <h3 className="mb-3 font-display text-base font-bold text-white">
              Estrutura Cadastrada de Produtos e Fatores
            </h3>
            {products.length === 0 ? (
              <p className="text-xs text-[#AEB8C5]">
                Nenhum produto cadastrado. Produtos sem fator validado são marcados automaticamente como Pendente na programação.
              </p>
            ) : (
              <div className="space-y-3">
                {products.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-4 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-white">
                        <span className="font-mono-tabular text-[#F5B817]">{p.code}</span> —{' '}
                        {p.description}
                      </p>
                      <span className="text-xs text-[#AEB8C5]">
                        Linha padrão: {p.defaultLineCode || 'Geral'}
                      </span>
                    </div>
                    {p.factors.length === 0 ? (
                      <p className="text-xs text-[#F5B817]">
                        Nenhum fator de consumo cadastrado (consumo ficará Pendente).
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {p.factors.map((f) => (
                          <div
                            key={f.id}
                            className="rounded border border-[#AEB8C5]/15 bg-[#102235] p-2.5 text-xs"
                          >
                            <p className="font-semibold text-white">
                              {f.materialCode} — {f.materialDescription}
                            </p>
                            <p className="mt-1 font-mono-tabular text-[#F5B817]">
                              {f.factorKgPerUnit} kg MP / 1 {f.unit}
                            </p>
                            <span
                              className={`mt-1 inline-block text-[10px] font-bold ${
                                f.validationStatus === 'VALIDADO'
                                  ? 'text-emerald-400'
                                  : 'text-orange-400'
                              }`}
                            >
                              {f.validationStatus}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sub-aba: Limites Mínimos de Estoque */}
      {subTab === 'limites' && (
        <div className="space-y-5">
          {canManageFactors && (
            <form
              onSubmit={handleSaveThreshold}
              className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-[#F5B817]" />
                <h3 className="font-display text-base font-bold text-white">
                  Configurar Estoque Mínimo e Nível de Atenção
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <select
                  required
                  value={thrMatId}
                  onChange={(e) => setThrMatId(e.target.value)}
                  className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-white"
                >
                  <option value="">Matéria-Prima *</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.description}
                    </option>
                  ))}
                </select>
                <select
                  value={thrSiloId}
                  onChange={(e) => setThrSiloId(e.target.value)}
                  className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-white"
                >
                  <option value="">Global da Matéria-Prima</option>
                  {silos.map((s) => (
                    <option key={s.id} value={s.id}>
                      Silo {s.siloNumber}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  required
                  min="0"
                  step="1"
                  value={thrMinKg}
                  onChange={(e) => setThrMinKg(e.target.value)}
                  placeholder="Mínimo Crítico (kg)"
                  className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-xs text-white"
                />
                <input
                  type="number"
                  required
                  min="0"
                  step="1"
                  value={thrWarnKg}
                  onChange={(e) => setThrWarnKg(e.target.value)}
                  placeholder="Nível de Atenção (kg)"
                  className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-xs text-white"
                />
              </div>
              <button
                type="submit"
                className="min-h-[42px] rounded-lg bg-[#F5B817] px-5 text-xs font-bold text-[#081321]"
              >
                Salvar Limite Configurável
              </button>
            </form>
          )}

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5">
            <h3 className="mb-3 font-display text-base font-bold text-white">
              Limites Cadastrados
            </h3>
            {thresholds.length === 0 ? (
              <p className="text-xs text-[#AEB8C5]">Nenhum limite mínimo personalizado configurado ainda.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {thresholds.map((t) => (
                  <div
                    key={t.id}
                    className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3.5 text-xs space-y-1"
                  >
                    <p className="font-bold text-white">
                      {t.materialCode} — {t.materialDescription}
                    </p>
                    <p className="text-[#AEB8C5]">
                      Escopo: {t.siloNumber ? `Silo ${t.siloNumber}` : 'Global da Planta'}
                    </p>
                    <p className="font-mono-tabular text-red-300">
                      Crítico (Vermelho): &lt; {formatKg(t.minStockKg)}
                    </p>
                    <p className="font-mono-tabular text-orange-300">
                      Atenção (Laranja): &lt; {formatKg(t.warningStockKg)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
