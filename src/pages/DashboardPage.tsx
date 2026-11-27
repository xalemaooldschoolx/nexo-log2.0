import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  Layers,
  Presentation,
  ShieldAlert,
} from 'lucide-react';
import {
  DashboardResponse,
  NavSectionId,
  OperationalIndicatorsOverview,
  ProductionScheduleView,
  ProductionSupplyBoardResponse,
  SiloDetail,
} from '../types/nexo.ts';
import { apiFetch, formatKg, formatTons } from '../lib/api.ts';
import { ConsumptionTrendChart } from '../components/dashboard/ConsumptionTrendChart.tsx';

interface DashboardPageProps {
  data: DashboardResponse | null;
  silos?: SiloDetail[];
  isDemoMode?: boolean;
  loading: boolean;
  error: string | null;
  onNavigate: (section: NavSectionId) => void;
  onRefresh: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  data,
  silos = [],
  isDemoMode = false,
  loading,
  error,
  onNavigate,
  onRefresh,
}) => {
  const [overview, setOverview] = useState<OperationalIndicatorsOverview | null>(null);
  const [supplyBoard, setSupplyBoard] = useState<ProductionSupplyBoardResponse | null>(null);
  const [schedulesCount, setSchedulesCount] = useState<number>(0);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    Promise.all([
      apiFetch<OperationalIndicatorsOverview>('/api/reports/overview').catch(() => null),
      apiFetch<ProductionSupplyBoardResponse>('/api/supply/board').catch(() => null),
      apiFetch<ProductionScheduleView[]>('/api/schedules').catch(() => []),
    ]).then(([ov, sb, sch]) => {
      if (cancelled) return;
      setOverview(ov);
      setSupplyBoard(sb);
      setSchedulesCount(Array.isArray(sch) ? sch.length : 0);
    });
    return () => {
      cancelled = true;
    };
  }, [data, isDemoMode]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-6 text-red-100">
        <p className="font-display text-base font-bold">Erro ao carregar painel operacional</p>
        <p className="mt-1 text-sm text-red-200">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-4 min-h-[44px] rounded-lg bg-[#F5B91B] px-4 py-2 text-sm font-bold text-[#0A1421]"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { kpis, byCategory, byLine, pendenciesPreview, shift, lastUpdated } = data;
  const lowStockSilos = silos.filter(
    (s) => s.stockAlertLevel === 'CRITICO' || s.stockAlertLevel === 'ATENCAO'
  ).length;
  const receivingSilos = silos.filter((s) => s.isReceiving).length;
  const supplyNeeds =
    supplyBoard?.recommendations.filter(
      (r) => r.decisionStatus !== 'REJEITADA' && r.decisionStatus !== 'EXECUTADA'
    ).length ?? overview?.indicators.pendingSupplyRequestsCount ?? 0;

  return (
    <div className="space-y-6">
      {/* Turno e Status Operacional */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:p-5">
        <div>
          <p className="text-xs font-medium text-[#F5B91B]">
            Turno Atual · {shift.shiftName} · Data Operacional{' '}
            <span className="font-mono-tabular">{shift.operationalDate}</span>
          </p>
          <h2 className="mt-1 font-display text-xl font-bold text-[#F4F6F8]">
            Painel Operacional da Moega
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-[#AEB8C5]">
            Última atualização:{' '}
            <span className="font-mono-tabular text-[#F4F6F8]">
              {new Date(lastUpdated).toLocaleTimeString('pt-BR')}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onNavigate('executivo')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#3B82F6]/50 bg-[#0A1421] px-3.5 py-2 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]"
          >
            <Presentation className="h-4 w-4 text-[#F5B91B]" />
            <span>Apresentação Executiva</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('mapa')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 py-2 text-sm font-bold text-[#0A1421] transition-colors hover:bg-[#F5B91B]/90"
          >
            <span>Abrir Mapa de Silos</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 10 Indicadores Operacionais Principais */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">1. Estoque Total Disponível</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-emerald-400">
            {formatTons(kpis.totalConfirmedStockKg)}
          </p>
          <p className="mt-1 font-mono-tabular text-[11px] text-[#AEB8C5]">
            {formatKg(kpis.totalConfirmedStockKg)} · Cap. Segura {formatTons(kpis.totalSafeCapacityKg)}
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">2. Produtos Cadastrados</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
            {kpis.totalMaterials}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Rotas ativas: {kpis.activeTransferRules} · Pendentes: {kpis.pendingTransferRules}
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">3. Silos em Operação</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#3B82F6]">
            {kpis.operationalSilos}/{kpis.totalSilos}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Linha: {byCategory.LINHA} · Armaz.: {byCategory.ARMAZENAGEM} · Prod.: {byCategory.PRODUCAO}
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            lowStockSilos > 0
              ? 'border-orange-500/60 bg-orange-950/25 nexo-silo-pulse-orange'
              : 'border-[#AEB8C5]/15 bg-[#101B2A]'
          }`}
        >
          <p className="text-xs font-medium text-[#AEB8C5]">4. Silos com Baixo Estoque</p>
          <p
            className={`mt-1.5 font-mono-tabular text-2xl font-extrabold ${
              lowStockSilos > 0 ? 'text-orange-300' : 'text-emerald-400'
            }`}
          >
            {lowStockSilos}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Ocupados: {kpis.occupiedSilos} · Indisponíveis: {kpis.blockedOrMaintenance}
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            supplyNeeds > 0
              ? 'border-red-500/55 bg-red-950/20'
              : 'border-[#AEB8C5]/15 bg-[#101B2A]'
          }`}
        >
          <p className="text-xs font-medium text-[#AEB8C5]">5. Necessidades de Abastecimento</p>
          <p
            className={`mt-1.5 font-mono-tabular text-2xl font-extrabold ${
              supplyNeeds > 0 ? 'text-red-300' : 'text-emerald-400'
            }`}
          >
            {supplyNeeds}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Recomendações e solicitações abertas
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">6. Veículos Recebidos</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
            {overview?.performanceKpis.receiptsCount ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Concluídos: {overview?.indicators.completedReceiptsCount ?? 0} · Silos recebendo: {receivingSilos}
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">7. Movimentações / Transferências</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F5B91B]">
            {overview?.indicators.transfersCompletedCount ?? 0}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Volume transf.: {formatTons(overview?.indicators.transferredVolumeKg ?? 0)}
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">8. Programação de Produção</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
            {overview?.indicators.importedSchedulesCount ?? schedulesCount}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Consumo previsto: {formatTons(overview?.performanceKpis.plannedConsumptionKg ?? 0)}
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">9. Alertas & Pendências</p>
          <p
            className={`mt-1.5 font-mono-tabular text-2xl font-extrabold ${
              (overview?.indicators.activeAlertsCount ?? kpis.pendingValidationsCount) > 0
                ? 'text-[#F5B91B]'
                : 'text-emerald-400'
            }`}
          >
            {overview?.indicators.activeAlertsCount ?? kpis.pendingValidationsCount}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Validações pendentes: {kpis.pendingValidationsCount} · Ocorrências: {overview?.indicators.openOccurrencesCount ?? 0}
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">10. Indicadores de Desempenho</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#3B82F6]">
            {overview?.performanceKpis.avgReceiptDurationMinutes != null
              ? `${overview.performanceKpis.avgReceiptDurationMinutes.toFixed(0)} min`
              : 'Sem amostra'}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            Tempo médio descarga ({overview?.performanceKpis.avgReceiptDurationSampleSize ?? 0} reg.)
          </p>
        </div>
      </div>

      {/* Tendência de Consumo de Matérias-Primas nos Últimos 30 Dias (Recharts) */}
      <ConsumptionTrendChart isDemoMode={isDemoMode} refreshSignal={lastUpdated} />

      {/* Grid Principal: Distribuição por Linha + Gráfico de Ocupação + Alertas */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 lg:col-span-7">
          <div className="flex items-center justify-between gap-4 border-b border-[#AEB8C5]/15 pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-[#F5B91B]" />
              <div>
                <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                  Estrutura por Linha, Estoque Confirmado e Capacidade Segura
                </h3>
                <p className="text-xs text-[#AEB8C5]">
                  {isDemoMode
                    ? 'Cenário demonstrativo ilustrativo para apresentação'
                    : 'Dados reais consolidados do banco operacional PostgreSQL'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('estoque')}
              className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 px-3 py-1.5 text-xs font-medium text-[#F4F6F8] hover:bg-[#1A2B42]"
            >
              Ver Tabela Completa
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#AEB8C5]/15 text-xs text-[#AEB8C5]">
                  <th className="py-2.5 pr-3 font-semibold">Linha</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Silos</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Estoque</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Cap. Segura (-10%)</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Ocupação</th>
                  <th className="pl-3 py-2.5 text-right font-semibold">Pendências</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#AEB8C5]/10">
                {byLine.map((line) => {
                  const occPct =
                    line.safeCapacityKg > 0
                      ? Math.min(100, Math.round((line.confirmedStockKg / line.safeCapacityKg) * 1000) / 10)
                      : 0;
                  return (
                    <tr key={line.code} className="hover:bg-[#152336]/60">
                      <td className="py-3 pr-3 font-medium text-[#F4F6F8]">
                        <span className="font-mono-tabular font-bold text-[#F5B91B]">{line.code}</span>{' '}
                        · {line.name}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular text-[#F4F6F8]">
                        {line.siloCount}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular font-semibold text-emerald-300">
                        {formatKg(line.confirmedStockKg)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular text-[#AEB8C5]">
                        {formatKg(line.safeCapacityKg)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[#0A1421] sm:block">
                            <div
                              className="h-full rounded-full bg-[#3B82F6]"
                              style={{ width: `${occPct}%` }}
                            />
                          </div>
                          <span className="font-mono-tabular text-xs text-[#F4F6F8]">{occPct}%</span>
                        </div>
                      </td>
                      <td className="pl-3 py-3 text-right font-mono-tabular">
                        {line.pendingValidationCount > 0 ? (
                          <span className="text-[#F5B91B]">{line.pendingValidationCount} pend.</span>
                        ) : (
                          <span className="text-emerald-400">Validado</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Alertas e Pendências Documentais */}
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 lg:col-span-5">
          <div className="flex items-center justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-[#F5B91B]" />
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Pendências de Validação Operacional
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('estoque')}
              className="text-xs font-semibold text-[#F5B91B] hover:underline"
            >
              Revisar Todas
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {pendenciesPreview.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                <span>Todas as divergências documentais foram validadas.</span>
              </div>
            ) : (
              pendenciesPreview.map((pend) => (
                <div
                  key={pend.id}
                  className="rounded-lg border border-[#F5B91B]/30 bg-[#152336] p-3.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono-tabular text-xs font-bold text-[#F5B91B]">
                      {pend.entityRef}
                    </span>
                    <span className="text-xs text-[#AEB8C5]">{pend.entityType}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[#F4F6F8]">{pend.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[#AEB8C5]">{pend.description}</p>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#AEB8C5]/15 pt-4 text-xs">
            <div className="flex items-center gap-2 text-[#AEB8C5]">
              <Database className="h-4 w-4 text-emerald-400" />
              <span>Matérias-primas: {kpis.totalMaterials}</span>
            </div>
            <div className="flex items-center gap-2 text-[#AEB8C5]">
              <Layers className="h-4 w-4 text-[#3B82F6]" />
              <span>Rotas ativas: {kpis.activeTransferRules}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Aviso de Integridade */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 text-xs text-[#AEB8C5]">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#F5B91B]" />
          <span>
            {isDemoMode
              ? 'Modo Apresentação Ativo: todos os indicadores desta tela refletem exclusivamente o Sandbox Demonstrativo em memória.'
              : 'Integridade de Estoque Ativa: os indicadores exibem exclusivamente registros confirmados e movimentações reais do PostgreSQL.'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('auditoria')}
          className="font-semibold text-[#F4F6F8] hover:text-[#F5B91B]"
        >
          Consultar Auditoria →
        </button>
      </div>
    </div>
  );
};
