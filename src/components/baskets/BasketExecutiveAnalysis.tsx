import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  FileSpreadsheet,
  Layers,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { formatBrazilianDiff, formatBrazilianNumber } from '../../lib/basket-comparator.ts';
import type { BasketComparisonView, BasketVersionView } from '../../types/nexo.ts';

interface BasketExecutiveAnalysisProps {
  comparison: BasketComparisonView;
  versionsForDate: BasketVersionView[];
  canExport: boolean;
  exportingFormat: string | null;
  onExport: (format: 'PDF' | 'XLSX') => void;
}

export const BasketExecutiveAnalysis: React.FC<BasketExecutiveAnalysisProps> = ({
  comparison,
  versionsForDate,
  canExport,
  exportingFormat,
  onExport,
}) => {
  const lineChartData = useMemo(
    () =>
      comparison.lineSummaries.map((l) => ({
        lineCode: l.lineCode,
        anteriorTons: Math.round((l.previousTotalKg / 1000) * 100) / 100,
        novoTons: Math.round((l.newTotalKg / 1000) * 100) / 100,
        diffTons: Math.round((l.diffKg / 1000) * 100) / 100,
      })),
    [comparison.lineSummaries]
  );

  const topDeltasChartData = useMemo(() => {
    const combined = [...comparison.topIncreases.slice(0, 5), ...comparison.topDecreases.slice(0, 5)];
    return combined
      .sort((a, b) => Math.abs(b.diffKg ?? 0) - Math.abs(a.diffKg ?? 0))
      .slice(0, 8)
      .map((d) => ({
        label: `${d.lineCode} · ${d.materialDescription.slice(0, 18)}`,
        diffKg: d.diffKg ?? 0,
      }));
  }, [comparison.topIncreases, comparison.topDecreases]);

  const intradaySeries = useMemo(() => {
    const ordered = [...versionsForDate].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    return ordered.map((v) => {
      const totalKg = v.items.reduce((acc, it) => acc + (it.plannedQuantityKg ?? 0), 0);
      const l4Calcario = v.items
        .filter((it) => it.lineCode === 'L4' && it.materialCode === '2017101021')
        .reduce((acc, it) => acc + (it.plannedQuantityKg ?? 0), 0);
      const l4Premix = v.items
        .filter((it) => it.lineCode === 'L4' && it.materialCode === '1113101920')
        .reduce((acc, it) => acc + (it.plannedQuantityKg ?? 0), 0);
      const l4Sal = v.items
        .filter((it) => it.lineCode === 'L4' && it.materialCode === '2021171023')
        .reduce((acc, it) => acc + (it.plannedQuantityKg ?? 0), 0);

      return {
        label: v.emissionTime ? `${v.emissionTime}` : `v${v.sequenceOrder}`,
        fullLabel: v.label,
        totalTons: Math.round((totalKg / 1000) * 100) / 100,
        calcarioTons: Math.round((l4Calcario / 1000) * 100) / 100,
        premixTons: Math.round((l4Premix / 1000) * 100) / 100,
        salTons: Math.round((l4Sal / 1000) * 100) / 100,
      };
    });
  }, [versionsForDate]);

  const criticalImpacts = comparison.operationalImpacts.filter(
    (o) => o.shortageRisk === 'CRITICO' || o.shortageRisk === 'SEM_SILO_COMPATIVEL'
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho & Exportação (Seção F) */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#F5B91B]/30 bg-[#101B2A] p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
            ANÁLISE GERENCIAL DE ALTERAÇÕES DE CONSUMO · {comparison.productionDate}
          </p>
          <h3 className="mt-1 font-display text-xl font-extrabold text-[#F4F6F8]">
            {comparison.baseVersionLabel} → {comparison.targetVersionLabel}
          </h3>
          <p className="mt-0.5 text-xs text-[#AEB8C5]">
            Comparação {comparison.comparisonCode} · Status: {comparison.status}
            {comparison.publishedByName ? ` · Publicado por ${comparison.publishedByName}` : ''}
          </p>
        </div>

        {canExport && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => onExport('PDF')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#AEB8C5]/25 bg-[#0A1421] px-4 py-2 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B] disabled:opacity-50"
            >
              <Download className="h-4 w-4 text-[#F5B91B]" />
              <span>{exportingFormat === 'PDF' ? 'Gerando PDF...' : 'Exportar PDF Gerencial'}</span>
            </button>
            <button
              type="button"
              disabled={exportingFormat !== null}
              onClick={() => onExport('XLSX')}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#F5B91B] px-4 py-2 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span>{exportingFormat === 'XLSX' ? 'Gerando Excel...' : 'Exportar Excel (XLSX)'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Seção A: Resumo Executivo */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">Total Cesta Anterior</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
            {formatBrazilianNumber(comparison.totalPreviousKg, 2)} kg
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            {formatBrazilianNumber(comparison.totalPreviousKg / 1000, 2)} toneladas
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">Total Nova Cesta</p>
          <p className="mt-1.5 font-mono-tabular text-2xl font-extrabold text-[#60A5FA]">
            {formatBrazilianNumber(comparison.totalNewKg, 2)} kg
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            {formatBrazilianNumber(comparison.totalNewKg / 1000, 2)} toneladas
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            comparison.totalDiffKg > 0
              ? 'border-orange-500/45 bg-orange-950/20'
              : comparison.totalDiffKg < 0
                ? 'border-emerald-500/45 bg-emerald-950/20'
                : 'border-[#AEB8C5]/15 bg-[#101B2A]'
          }`}
        >
          <p className="text-xs font-medium text-[#AEB8C5]">Diferença Líquida</p>
          <p
            className={`mt-1.5 font-mono-tabular text-2xl font-extrabold ${
              comparison.totalDiffKg > 0
                ? 'text-orange-300'
                : comparison.totalDiffKg < 0
                  ? 'text-emerald-300'
                  : 'text-[#F4F6F8]'
            }`}
          >
            {formatBrazilianDiff(comparison.totalDiffKg)} kg
          </p>
          <p className="mt-1 font-mono-tabular text-[11px] text-[#AEB8C5]">
            Variação geral:{' '}
            {comparison.pctChange !== null
              ? `${comparison.pctChange > 0 ? '+' : ''}${comparison.pctChange}%`
              : '—'}
          </p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-medium text-[#AEB8C5]">Distribuição das Mudanças</p>
          <p className="mt-1.5 font-mono-tabular text-xl font-extrabold text-[#F5B91B]">
            {comparison.counts.increased + comparison.counts.decreased} alt. · {comparison.counts.added} novos
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            +{comparison.counts.increased} aumentos · -{comparison.counts.decreased} reduções · {comparison.counts.removed} ret.
          </p>
        </div>

        <div
          className={`rounded-xl border p-4 ${
            criticalImpacts.length > 0
              ? 'border-red-500/50 bg-red-950/20'
              : 'border-emerald-500/40 bg-emerald-950/15'
          }`}
        >
          <p className="text-xs font-medium text-[#AEB8C5]">Riscos Críticos na Moega</p>
          <p
            className={`mt-1.5 font-mono-tabular text-2xl font-extrabold ${
              criticalImpacts.length > 0 ? 'text-red-300' : 'text-emerald-300'
            }`}
          >
            {criticalImpacts.length}
          </p>
          <p className="mt-1 text-[11px] text-[#AEB8C5]">
            {comparison.counts.pendingReview > 0
              ? `${comparison.counts.pendingReview} item(ns) em conferência`
              : 'Sem pendências de conferência'}
          </p>
        </div>
      </div>

      {/* Seção B & C: Gráficos L1-L7 e Maiores Alterações */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 lg:col-span-6">
          <div className="mb-3 flex items-center gap-2 border-b border-[#AEB8C5]/10 pb-3">
            <Layers className="h-4 w-4 text-[#F5B91B]" />
            <div>
              <h4 className="font-display text-sm font-bold text-[#F4F6F8]">
                B. Consumo Comparado por Linha (L1 a L7)
              </h4>
              <p className="text-[11px] text-[#AEB8C5]">Cesta Anterior vs. Nova Cesta em toneladas</p>
            </div>
          </div>
          <div className="h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={lineChartData} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#AEB8C5" strokeOpacity={0.12} strokeDasharray="3 3" />
                <XAxis dataKey="lineCode" stroke="#AEB8C5" tick={{ fill: '#AEB8C5', fontSize: 11 }} />
                <YAxis stroke="#AEB8C5" tick={{ fill: '#AEB8C5', fontSize: 11 }} tickFormatter={(v) => `${v}t`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0A1421',
                    borderColor: 'rgba(245, 185, 27, 0.4)',
                    borderRadius: '10px',
                    color: '#F4F6F8',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="anteriorTons" name="Anterior (t)" fill="#64748B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="novoTons" name="Atualizada (t)" fill="#F5B91B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 lg:col-span-6">
          <div className="mb-3 flex items-center gap-2 border-b border-[#AEB8C5]/10 pb-3">
            <TrendingUp className="h-4 w-4 text-[#F5B91B]" />
            <div>
              <h4 className="font-display text-sm font-bold text-[#F4F6F8]">
                C. Maiores Variações Absolutas por Material (kg)
              </h4>
              <p className="text-[11px] text-[#AEB8C5]">
                Laranja: aumento de consumo · Verde: redução de consumo
              </p>
            </div>
          </div>
          <div className="h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={topDeltasChartData}
                layout="vertical"
                margin={{ top: 8, right: 20, left: 10, bottom: 4 }}
              >
                <CartesianGrid stroke="#AEB8C5" strokeOpacity={0.12} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  stroke="#AEB8C5"
                  tick={{ fill: '#AEB8C5', fontSize: 10 }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={135}
                  stroke="#AEB8C5"
                  tick={{ fill: '#F4F6F8', fontSize: 10 }}
                />
                <ReferenceLine x={0} stroke="#AEB8C5" strokeOpacity={0.4} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0A1421',
                    borderColor: 'rgba(245, 185, 27, 0.4)',
                    borderRadius: '10px',
                    color: '#F4F6F8',
                    fontSize: '12px',
                  }}
                  formatter={(v: unknown) => [`${formatBrazilianDiff(Number(v || 0))} kg`, 'Diferença']}
                />
                <Bar dataKey="diffKg" name="Diferença (kg)" radius={[4, 4, 4, 4]}>
                  {topDeltasChartData.map((entry, idx) => (
                    <Cell
                      key={`cell-${idx}`}
                      fill={entry.diffKg >= 0 ? '#F97316' : '#10B981'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Aumentos & Reduções Listas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-orange-500/30 bg-[#101B2A] p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-orange-300">
            <ArrowUpRight className="h-4 w-4" />
            Top Maiores Aumentos de Consumo
          </p>
          <div className="mt-3 space-y-2">
            {comparison.topIncreases.length === 0 ? (
              <p className="text-xs text-[#AEB8C5]">Nenhum aumento registrado entre as versões.</p>
            ) : (
              comparison.topIncreases.slice(0, 5).map((item) => (
                <div
                  key={`${item.lineCode}-${item.materialCode}-${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[#AEB8C5]/10 bg-[#0A1421] px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[#F4F6F8]">
                      <span className="text-[#F5B91B]">{item.lineCode}</span> · {item.materialDescription}
                    </p>
                    <p className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                      Cód. {item.materialCode || '—'} · {formatBrazilianNumber(item.previousQuantityKg, 2)} →{' '}
                      {formatBrazilianNumber(item.newQuantityKg, 2)} kg
                    </p>
                  </div>
                  <span className="shrink-0 font-mono-tabular font-extrabold text-orange-300">
                    {formatBrazilianDiff(item.diffKg)} kg
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-500/30 bg-[#101B2A] p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <ArrowDownRight className="h-4 w-4" />
            Top Maiores Reduções de Consumo
          </p>
          <div className="mt-3 space-y-2">
            {comparison.topDecreases.length === 0 ? (
              <p className="text-xs text-[#AEB8C5]">Nenhuma redução registrada entre as versões.</p>
            ) : (
              comparison.topDecreases.slice(0, 5).map((item) => (
                <div
                  key={`${item.lineCode}-${item.materialCode}-${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[#AEB8C5]/10 bg-[#0A1421] px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold text-[#F4F6F8]">
                      <span className="text-[#F5B91B]">{item.lineCode}</span> · {item.materialDescription}
                    </p>
                    <p className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                      Cód. {item.materialCode || '—'} · {formatBrazilianNumber(item.previousQuantityKg, 2)} →{' '}
                      {formatBrazilianNumber(item.newQuantityKg, 2)} kg
                    </p>
                  </div>
                  <span className="shrink-0 font-mono-tabular font-extrabold text-emerald-300">
                    {formatBrazilianDiff(item.diffKg)} kg
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Seção E: Evolução Intra-Dia */}
      {intradaySeries.length >= 2 && (
        <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#AEB8C5]/10 pb-3">
            <div>
              <h4 className="font-display text-sm font-bold text-[#F4F6F8]">
                E. Evolução Intra-Dia das Versões ({intradaySeries.length} versões em {comparison.productionDate})
              </h4>
              <p className="text-[11px] text-[#AEB8C5]">
                Acompanhamento cronológico das atualizações do turno (total geral e principais materiais da Linha 4 em toneladas)
              </p>
            </div>
          </div>
          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={intradaySeries} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid stroke="#AEB8C5" strokeOpacity={0.12} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#AEB8C5" tick={{ fill: '#AEB8C5', fontSize: 11 }} />
                <YAxis stroke="#AEB8C5" tick={{ fill: '#AEB8C5', fontSize: 11 }} tickFormatter={(v) => `${v}t`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0A1421',
                    borderColor: 'rgba(245, 185, 27, 0.45)',
                    borderRadius: '10px',
                    color: '#F4F6F8',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line type="monotone" dataKey="totalTons" name="Total Programado (t)" stroke="#F5B91B" strokeWidth={2.5} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="calcarioTons" name="Calcário L4 (t)" stroke="#60A5FA" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="salTons" name="Sal Moído L4 (t)" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="premixTons" name="Veículo Premix L4 (t)" stroke="#F97316" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Seção D: Impacto Operacional na Moega */}
      <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="flex items-center gap-2 border-b border-[#AEB8C5]/15 pb-3">
          <ShieldAlert className="h-5 w-5 text-[#F5B91B]" />
          <div>
            <h4 className="font-display text-base font-bold text-[#F4F6F8]">
              D. Impacto Operacional na Moega, Silos e Abastecimento
            </h4>
            <p className="text-xs text-[#AEB8C5]">
              Confronto calculado sobre o estoque físico confirmado sem alterar saldos nem executar transferências automáticas.
            </p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-xs">
            <thead>
              <tr className="border-b border-[#AEB8C5]/15 text-[#AEB8C5]">
                <th className="py-2.5 pr-3 font-bold">Linha / Material</th>
                <th className="px-3 py-2.5 text-right font-bold">Novo Planejado</th>
                <th className="px-3 py-2.5 font-bold">Silos Compatíveis</th>
                <th className="px-3 py-2.5 text-right font-bold">Estoque Confirmado</th>
                <th className="px-3 py-2.5 text-right font-bold">Saldo Projetado</th>
                <th className="px-3 py-2.5 font-bold">Risco</th>
                <th className="pl-3 py-2.5 font-bold">Recomendação / Transferência</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#AEB8C5]/10">
              {comparison.operationalImpacts.map((imp, idx) => (
                <tr key={`${imp.lineCode}-${imp.materialCode}-${idx}`} className="hover:bg-[#152336]/50">
                  <td className="py-2.5 pr-3">
                    <p className="font-bold text-[#F4F6F8]">
                      <span className="text-[#F5B91B]">{imp.lineCode}</span> · {imp.materialDescription}
                    </p>
                    <p className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                      Cód. {imp.materialCode || '—'} · Dif.: {formatBrazilianDiff(imp.diffKg)} kg
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular font-semibold text-[#F4F6F8]">
                    {formatBrazilianNumber(imp.newPlannedKg, 2)} kg
                  </td>
                  <td className="px-3 py-2.5 font-mono-tabular text-[#AEB8C5]">
                    {imp.compatibleSiloNumbers.length > 0
                      ? `Silos ${imp.compatibleSiloNumbers.join(', ')}`
                      : 'Sem vínculo'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-tabular text-emerald-300">
                    {formatBrazilianNumber(imp.confirmedStockKg, 0)} kg
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono-tabular font-bold ${
                      imp.projectedBalanceKg < 0 ? 'text-red-300' : 'text-emerald-300'
                    }`}
                  >
                    {formatBrazilianDiff(imp.projectedBalanceKg)} kg
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                        imp.shortageRisk === 'CRITICO' || imp.shortageRisk === 'SEM_SILO_COMPATIVEL'
                          ? 'border-red-500/50 bg-red-500/15 text-red-200'
                          : imp.shortageRisk === 'ATENCAO'
                            ? 'border-orange-500/50 bg-orange-500/15 text-orange-200'
                            : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                      }`}
                    >
                      {imp.shortageRisk === 'CRITICO' && <AlertTriangle className="h-3 w-3" />}
                      {imp.shortageRisk}
                    </span>
                  </td>
                  <td className="pl-3 py-2.5 text-[#AEB8C5] leading-relaxed">
                    {imp.recommendationText}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
