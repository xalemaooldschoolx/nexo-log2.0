import React, { useEffect, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CalendarRange, TrendingUp } from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import type { ConsumptionTrendResponse } from '../../types/nexo.ts';

interface ConsumptionTrendChartProps {
  isDemoMode?: boolean;
  refreshSignal?: string | number;
}

export const ConsumptionTrendChart: React.FC<ConsumptionTrendChartProps> = ({
  isDemoMode = false,
  refreshSignal,
}) => {
  const [days, setDays] = useState<number>(30);
  const [lineCode, setLineCode] = useState<string>('ALL');
  const [materialId, setMaterialId] = useState<string>('ALL');
  const [trend, setTrend] = useState<ConsumptionTrendResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      days: String(days),
      lineCode,
    });
    if (materialId !== 'ALL') {
      qs.set('materialId', materialId);
    }
    apiFetch<ConsumptionTrendResponse>(`/api/dashboard/consumption-trend?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setTrend(res);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Erro ao carregar série de consumo.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [days, lineCode, materialId, isDemoMode, refreshSignal]);

  return (
    <section
      data-testid="consumption-trend-chart-card"
      className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5"
    >
      {/* Header & Filtros */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#AEB8C5]/15 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F5B91B]/35 bg-[#F5B91B]/10 text-[#F5B91B]">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
              PLANEJAMENTO LOGÍSTICO · ÚLTIMOS {days} DIAS
            </p>
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Tendência de Consumo de Matérias-Primas (Previsto vs. Realizado)
            </h3>
            <p className="mt-0.5 text-xs text-[#AEB8C5]">
              {trend?.dataOrigin || 'Acompanhamento diário em toneladas para antecipação de recebimentos e transferências'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-0.5">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`min-h-[36px] rounded-md px-3 text-xs font-bold transition-colors ${
                  days === d
                    ? 'bg-[#F5B91B] text-[#0A1421]'
                    : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          <select
            aria-label="Filtrar linha de produção"
            value={lineCode}
            onChange={(e) => setLineCode(e.target.value)}
            className="min-h-[38px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-semibold text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
          >
            <option value="ALL">Todas as Linhas (L1–L7)</option>
            {(trend?.availableLines || ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']).map((lc) => (
              <option key={lc} value={lc}>
                Linha {lc}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar matéria-prima"
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            className="min-h-[38px] max-w-[230px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-semibold text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
          >
            <option value="ALL">Todas as Matérias-Primas</option>
            {(trend?.availableMaterials || []).map((m) => (
              <option key={m.materialId} value={String(m.materialId)}>
                {m.materialCode} · {m.materialDescription}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPIs Resumo */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
          <p className="text-[11px] font-medium text-[#AEB8C5]">Consumo Previsto ({days}d)</p>
          <p className="mt-1 font-mono-tabular text-lg font-extrabold text-[#F5B91B]">
            {trend ? `${trend.totals.plannedTons.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
          <p className="text-[11px] font-medium text-[#AEB8C5]">Consumo Realizado ({days}d)</p>
          <p className="mt-1 font-mono-tabular text-lg font-extrabold text-emerald-400">
            {trend ? `${trend.totals.realizedTons.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
          <p className="text-[11px] font-medium text-[#AEB8C5]">Aderência Real / Previsto</p>
          <p className="mt-1 font-mono-tabular text-lg font-extrabold text-[#60A5FA]">
            {trend?.totals.adherencePercent !== null && trend?.totals.adherencePercent !== undefined
              ? `${trend.totals.adherencePercent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
              : 'Sem amostra'}
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
          <p className="text-[11px] font-medium text-[#AEB8C5]">Dia de Pico Programado</p>
          <p className="mt-1 font-mono-tabular text-lg font-extrabold text-[#F4F6F8]">
            {trend?.totals.peakDayLabel
              ? `${trend.totals.peakDayLabel} · ${trend.totals.peakPlannedTons.toLocaleString('pt-BR', {
                  maximumFractionDigits: 1,
                })} t`
              : '—'}
          </p>
        </div>
      </div>

      {/* Gráfico Recharts */}
      <div className="mt-4">
        {loading && !trend ? (
          <div className="h-72 w-full animate-pulse rounded-xl border border-[#AEB8C5]/10 bg-[#0A1421]" />
        ) : error ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : !trend || trend.series.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-6 text-center text-xs text-[#AEB8C5]">
            <CalendarRange className="h-6 w-6 text-[#F5B91B]" />
            <span>Nenhum consumo programado ou realizado registrado para os filtros selecionados.</span>
          </div>
        ) : (
          <div className="h-72 w-full min-w-0 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={trend.series}
                margin={{ top: 12, right: 16, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="nexoPlannedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F5B91B" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#F5B91B" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#AEB8C5" strokeOpacity={0.12} strokeDasharray="3 3" />
                <XAxis
                  dataKey="dateLabel"
                  stroke="#AEB8C5"
                  tick={{ fill: '#AEB8C5', fontSize: 11 }}
                  tickMargin={8}
                  minTickGap={16}
                />
                <YAxis
                  stroke="#AEB8C5"
                  tick={{ fill: '#AEB8C5', fontSize: 11 }}
                  tickFormatter={(v) => `${v}t`}
                  width={52}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0A1421',
                    borderColor: 'rgba(245, 185, 27, 0.45)',
                    borderRadius: '10px',
                    color: '#F4F6F8',
                    fontSize: '12px',
                  }}
                  formatter={(val: unknown, name?: string | number) => [
                    `${Number(val || 0).toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} t`,
                    String(name ?? ''),
                  ]}
                  labelFormatter={(label) => `Data operacional: ${label}`}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', color: '#F4F6F8', paddingTop: '8px' }}
                />
                <Area
                  type="monotone"
                  dataKey="plannedTons"
                  name="Consumo Previsto (t)"
                  stroke="#F5B91B"
                  strokeWidth={2}
                  fill="url(#nexoPlannedGradient)"
                />
                <Line
                  type="monotone"
                  dataKey="realizedTons"
                  name="Consumo Realizado (t)"
                  stroke="#10B981"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, fill: '#10B981' }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
};
