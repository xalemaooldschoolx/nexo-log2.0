import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Clock, Filter, RotateCcw } from 'lucide-react';
import { apiFetch, formatKg } from '../../lib/api.ts';
import type {
  MaterialItem,
  SiloDetail,
  SiloVolumeHistory24hResponse,
} from '../../types/nexo.ts';

interface SiloVolumeHistory24hChartProps {
  silos: SiloDetail[];
  materials: MaterialItem[];
  externalSiloId?: number | null;
  refreshSignal?: string | number;
}

export const SiloVolumeHistory24hChart: React.FC<SiloVolumeHistory24hChartProps> = ({
  silos,
  materials,
  externalSiloId = null,
  refreshSignal,
}) => {
  const [category, setCategory] = useState<string>('ALL');
  const [materialId, setMaterialId] = useState<string>('ALL');
  const [siloId, setSiloId] = useState<string>('ALL');
  const [history, setHistory] = useState<SiloVolumeHistory24hResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (externalSiloId) {
      setSiloId(String(externalSiloId));
    }
  }, [externalSiloId]);

  const sortedSilos = useMemo(
    () => [...silos].sort((a, b) => a.rubricOrder - b.rubricOrder),
    [silos]
  );

  const usedMaterials = useMemo(() => {
    const usedIds = new Set(
      silos.map((s) => s.primaryMaterialId).filter((id): id is number => Boolean(id))
    );
    return materials
      .filter((m) => usedIds.has(m.id))
      .sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
  }, [silos, materials]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (category !== 'ALL') qs.set('category', category);
    if (materialId !== 'ALL') qs.set('materialId', materialId);
    if (siloId !== 'ALL') qs.set('siloId', siloId);

    apiFetch<SiloVolumeHistory24hResponse>(`/api/silos/volume-history-24h?${qs.toString()}`)
      .then((res) => {
        if (!cancelled) setHistory(res);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message || 'Erro ao carregar histórico horário de volume.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, materialId, siloId, refreshSignal]);

  const hasActiveFilter = category !== 'ALL' || materialId !== 'ALL' || siloId !== 'ALL';

  const handleResetFilters = () => {
    setCategory('ALL');
    setMaterialId('ALL');
    setSiloId('ALL');
  };

  return (
    <section
      data-testid="silo-volume-history-24h-card"
      className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5"
    >
      {/* Cabeçalho & Filtros */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#AEB8C5]/15 pb-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#3B82F6]/40 bg-[#3B82F6]/15 text-[#60A5FA]">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
              MONITORAMENTO HORÁRIO · ÚLTIMAS 24 HORAS
            </p>
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Histórico de Volume dos Silos (Entradas vs. Saídas / Consumo)
            </h3>
            <p className="mt-0.5 text-xs text-[#AEB8C5]">
              {history?.dataOrigin ||
                'Reconstrução horária a partir do saldo confirmado e movimentações reais no livro razão'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="hidden h-4 w-4 text-[#AEB8C5] sm:block" />

          <select
            aria-label="Filtrar categoria de silo (24h)"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSiloId('ALL');
            }}
            className="min-h-[40px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-semibold text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
          >
            <option value="ALL">Todas Categorias</option>
            <option value="LINHA">Silos de Linha</option>
            <option value="ARMAZENAGEM">Armazenagem (42–34)</option>
            <option value="PRODUCAO">Produção (43–64)</option>
          </select>

          <select
            aria-label="Filtrar matéria-prima (24h)"
            value={materialId}
            onChange={(e) => {
              setMaterialId(e.target.value);
              setSiloId('ALL');
            }}
            className="min-h-[40px] max-w-[220px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-semibold text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
          >
            <option value="ALL">Todas as Matérias-Primas</option>
            {usedMaterials.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.code} · {m.description}
              </option>
            ))}
          </select>

          <select
            aria-label="Filtrar silo específico (24h)"
            value={siloId}
            onChange={(e) => setSiloId(e.target.value)}
            className="min-h-[40px] max-w-[200px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-semibold text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
          >
            <option value="ALL">Todos os Silos ({sortedSilos.length})</option>
            {sortedSilos.map((s) => (
              <option key={s.id} value={String(s.id)}>
                Silo {s.siloNumber} · {s.lineCode} ({s.materialCode || 'S/MP'})
              </option>
            ))}
          </select>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs font-semibold text-[#F5B91B] hover:border-[#F5B91B]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Limpar</span>
            </button>
          )}
        </div>
      </div>

      {/* KPIs das últimas 24h */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
          <p className="text-[11px] font-medium text-[#AEB8C5]">
            Volume Atual ({history?.totals.silosIncludedCount ?? silos.length} silo(s))
          </p>
          <p className="mt-1 font-mono-tabular text-lg font-extrabold text-[#60A5FA]">
            {history
              ? `${history.totals.currentVolumeTons.toLocaleString('pt-BR', {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 2,
                })} t`
              : '—'}
          </p>
          {history && (
            <p className="font-mono-tabular text-[11px] text-[#AEB8C5]">
              {formatKg(history.totals.currentVolumeKg)}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
          <p className="text-[11px] font-medium text-[#AEB8C5]">Entradas (24h)</p>
          <p className="mt-1 font-mono-tabular text-lg font-extrabold text-emerald-400">
            {history ? `+${formatKg(history.totals.inbound24hKg)}` : '—'}
          </p>
          <p className="text-[11px] text-[#AEB8C5]">Recebimentos e créditos</p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
          <p className="text-[11px] font-medium text-[#AEB8C5]">Saídas / Consumo (24h)</p>
          <p className="mt-1 font-mono-tabular text-lg font-extrabold text-orange-400">
            {history ? `-${formatKg(history.totals.outbound24hKg)}` : '—'}
          </p>
          <p className="text-[11px] text-[#AEB8C5]">Consumos e transferências</p>
        </div>

        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
          <p className="text-[11px] font-medium text-[#AEB8C5]">Horário de Pico (24h)</p>
          <p className="mt-1 font-mono-tabular text-lg font-extrabold text-[#F5B91B]">
            {history?.totals.peakMovementHourLabel || 'Sem picos'}
          </p>
          <p className="font-mono-tabular text-[11px] text-[#AEB8C5]">
            {history
              ? `${history.totals.totalMovements24h} movimentação(ões)`
              : 'Consultando razão...'}
          </p>
        </div>
      </div>

      {/* Gráfico Recharts */}
      <div className="mt-4">
        {loading && !history ? (
          <div className="h-72 w-full animate-pulse rounded-xl border border-[#AEB8C5]/10 bg-[#0A1421]" />
        ) : error ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : !history || history.series.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-6 text-center text-xs text-[#AEB8C5]">
            <Activity className="h-6 w-6 text-[#F5B91B]" />
            <span>Nenhuma série horária encontrada para os filtros selecionados.</span>
          </div>
        ) : (
          <div className="h-72 w-full min-w-0 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={history.series}
                margin={{ top: 12, right: 16, left: 0, bottom: 4 }}
              >
                <defs>
                  <linearGradient id="nexoSilo24hVolGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.38} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#AEB8C5" strokeOpacity={0.12} strokeDasharray="3 3" />
                <XAxis
                  dataKey="hourLabel"
                  stroke="#AEB8C5"
                  tick={{ fill: '#AEB8C5', fontSize: 11 }}
                  tickMargin={8}
                  minTickGap={12}
                />
                <YAxis
                  yAxisId="volume"
                  stroke="#60A5FA"
                  tick={{ fill: '#93C5FD', fontSize: 11 }}
                  tickFormatter={(v) => `${v}t`}
                  width={54}
                />
                <YAxis
                  yAxisId="flow"
                  orientation="right"
                  stroke="#AEB8C5"
                  tick={{ fill: '#AEB8C5', fontSize: 11 }}
                  tickFormatter={(v) => `${v}t`}
                  width={48}
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
                  labelFormatter={(label, payload) => {
                    const pt = payload?.[0]?.payload as
                      | { movementCount?: number; netDeltaKg?: number }
                      | undefined;
                    const movText = pt?.movementCount
                      ? ` · ${pt.movementCount} mov(s)`
                      : ' · Sem movimentação';
                    return `Janela ${label}${movText}`;
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', color: '#F4F6F8', paddingTop: '8px' }}
                />
                <Area
                  yAxisId="volume"
                  type="monotone"
                  dataKey="volumeTons"
                  name="Volume em Estoque (t)"
                  stroke="#3B82F6"
                  strokeWidth={2.5}
                  fill="url(#nexoSilo24hVolGradient)"
                />
                <Bar
                  yAxisId="flow"
                  dataKey="inboundTons"
                  name="Entradas (t)"
                  fill="#10B981"
                  radius={[3, 3, 0, 0]}
                  barSize={10}
                />
                <Bar
                  yAxisId="flow"
                  dataKey="outboundTons"
                  name="Saídas / Consumo (t)"
                  fill="#F97316"
                  radius={[3, 3, 0, 0]}
                  barSize={10}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
};
