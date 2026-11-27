import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Box,
  CheckCircle2,
  Clock,
  Eye,
  Filter,
  Info,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  Truck,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  MaterialItem,
  MaterialThresholdAlertItem,
  SiloDetail,
  SiloLedgerDetails,
  StockThresholdItem,
} from '../types/nexo.ts';
import { apiFetch, formatKg } from '../lib/api.ts';
import { SiloMap3DScene } from '../components/SiloMap3DScene.tsx';
import { SiloVolumeHistory24hChart } from '../components/silos/SiloVolumeHistory24hChart.tsx';
import { ExperienceMode } from '../lib/experience-modes.ts';
import { computeProactiveMaterialThresholdAlerts } from '../lib/volume-history.ts';

interface SiloMapPageProps {
  silos: SiloDetail[];
  materials: MaterialItem[];
  thresholds?: StockThresholdItem[];
  proactiveThresholdAlerts?: MaterialThresholdAlertItem[];
  canManageSilos: boolean;
  canManageThresholds?: boolean;
  experienceMode?: ExperienceMode;
  onReload: () => Promise<void>;
  onStartReceivingToSilo?: (siloId: number) => void;
}

export const SiloMapPage: React.FC<SiloMapPageProps> = ({
  silos,
  materials,
  thresholds = [],
  proactiveThresholdAlerts,
  canManageSilos,
  canManageThresholds = false,
  experienceMode = 'GERENCIAL',
  onReload,
  onStartReceivingToSilo,
}) => {
  const [selectedSilo, setSelectedSilo] = useState<SiloDetail | null>(null);
  const [siloLedger, setSiloLedger] = useState<SiloLedgerDetails | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [showReferenceImage, setShowReferenceImage] = useState(false);
  const [showVolumeHistory24h, setShowVolumeHistory24h] = useState(true);
  const [chartSiloId, setChartSiloId] = useState<number | null>(null);
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [mapComplexity, setMapComplexity] = useState<'SIMPLES' | 'DETALHADA'>(() =>
    experienceMode === 'OPERACIONAL' ? 'SIMPLES' : 'DETALHADA'
  );
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [viewMode, setViewMode] = useState<'2D' | '3D'>('2D');
  const [zoom, setZoom] = useState<number>(1);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Silo edit state inside drawer
  const [editStatus, setEditStatus] = useState('OPERACIONAL');
  const [editCleaning, setEditCleaning] = useState('EM_USO');
  const [editValidation, setEditValidation] = useState<'VALIDADO' | 'PENDENTE_VALIDACAO'>('VALIDADO');
  const [editMaterialId, setEditMaterialId] = useState<string>('');
  const [editCapacity, setEditCapacity] = useState<string>('');
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Per-material stock threshold configuration state
  const [thMaterialId, setThMaterialId] = useState<string>('');
  const [thScope, setThScope] = useState<'MATERIAL' | 'SILO'>('MATERIAL');
  const [thSiloId, setThSiloId] = useState<string>('');
  const [thMinKg, setThMinKg] = useState<string>('5000');
  const [thWarnKg, setThWarnKg] = useState<string>('10000');
  const [thNotes, setThNotes] = useState<string>('');
  const [thSaving, setThSaving] = useState(false);
  const [thFeedback, setThFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!selectedSilo) {
      setSiloLedger(null);
      return;
    }
    setLoadingLedger(true);
    apiFetch<SiloLedgerDetails>(`/api/silos/${selectedSilo.id}/ledger`)
      .then((res) => setSiloLedger(res))
      .catch(() => setSiloLedger(null))
      .finally(() => setLoadingLedger(false));
  }, [selectedSilo]);

  const siloByNumber = useMemo(() => {
    const map = new Map<number, SiloDetail>();
    for (const s of silos) map.set(s.siloNumber, s);
    return map;
  }, [silos]);

  const storageSilos = useMemo(
    () =>
      [42, 41, 40, 39, 38, 37, 36, 35, 34]
        .map((n) => siloByNumber.get(n))
        .filter((s): s is SiloDetail => Boolean(s)),
    [siloByNumber]
  );

  const productionSilos = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => 43 + i)
        .map((n) => siloByNumber.get(n))
        .filter((s): s is SiloDetail => Boolean(s)),
    [siloByNumber]
  );

  const matchesFilter = (s: SiloDetail): boolean => {
    const alertLevel = s.stockAlertLevel ?? 'NORMAL';
    if (categoryFilter !== 'ALL' && s.category !== categoryFilter) return false;
    if (statusFilter === 'PENDENTE' && s.validationStatus !== 'PENDENTE_VALIDACAO') return false;
    if (statusFilter === 'OPERACIONAL' && s.operationalStatus !== 'OPERACIONAL') return false;
    if (statusFilter === 'BLOQUEADO' && s.operationalStatus === 'OPERACIONAL') return false;
    if (statusFilter === 'ESTOQUE_CRITICO' && alertLevel !== 'CRITICO') return false;
    if (statusFilter === 'ESTOQUE_ATENCAO' && alertLevel !== 'ATENCAO') return false;
    if (statusFilter === 'CRITICO_ATENCAO' && alertLevel === 'NORMAL') return false;
    if (statusFilter === 'EM_RECEBIMENTO' && !s.isReceiving) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const hitNum = String(s.siloNumber).includes(q);
      const hitMat = (s.materialDescription || '').toLowerCase().includes(q);
      const hitCode = (s.materialCode || '').toLowerCase().includes(q);
      const hitLine = s.lineCode.toLowerCase().includes(q);
      if (!hitNum && !hitMat && !hitCode && !hitLine) return false;
    }
    return true;
  };

  const criticalStockCount = useMemo(
    () => silos.filter((s) => s.stockAlertLevel === 'CRITICO').length,
    [silos]
  );
  const attentionStockCount = useMemo(
    () => silos.filter((s) => s.stockAlertLevel === 'ATENCAO').length,
    [silos]
  );
  const receivingCount = useMemo(
    () => silos.filter((s) => Boolean(s.isReceiving)).length,
    [silos]
  );

  const effectiveThresholdAlerts = useMemo(
    () =>
      proactiveThresholdAlerts ??
      computeProactiveMaterialThresholdAlerts({ silos, thresholds }),
    [proactiveThresholdAlerts, silos, thresholds]
  );
  const triggeredThresholdAlerts = useMemo(
    () =>
      effectiveThresholdAlerts.filter(
        (a) => a.severity === 'CRITICO' || a.severity === 'ATENCAO'
      ),
    [effectiveThresholdAlerts]
  );

  const usedMaterialsSorted = useMemo(() => {
    const usedIds = new Set(
      silos.map((s) => s.primaryMaterialId).filter((id): id is number => Boolean(id))
    );
    const list = materials.filter((m) => usedIds.has(m.id));
    return (list.length > 0 ? list : materials)
      .slice()
      .sort((a, b) => a.description.localeCompare(b.description, 'pt-BR'));
  }, [silos, materials]);

  const openThresholdModal = (presetMaterialId?: number | null, presetSiloId?: number | null) => {
    const fallbackMatId = presetMaterialId || usedMaterialsSorted[0]?.id || materials[0]?.id || 0;
    const existing = thresholds.find(
      (t) =>
        t.materialId === fallbackMatId &&
        (presetSiloId ? t.siloId === presetSiloId : t.siloId === null)
    );
    setThMaterialId(fallbackMatId ? String(fallbackMatId) : '');
    setThScope(presetSiloId ? 'SILO' : 'MATERIAL');
    setThSiloId(presetSiloId ? String(presetSiloId) : '');
    setThMinKg(existing ? String(existing.minStockKg) : '5000');
    setThWarnKg(existing ? String(existing.warningStockKg) : '12000');
    setThNotes(existing?.notes || '');
    setThFeedback(null);
    setShowThresholdModal(true);
  };

  const handleSaveThreshold = async (e: React.FormEvent) => {
    e.preventDefault();
    const minKg = Number(thMinKg);
    const warnKg = Number(thWarnKg);
    if (!thMaterialId) {
      setThFeedback({ type: 'err', text: 'Selecione uma matéria-prima.' });
      return;
    }
    if (!Number.isFinite(minKg) || minKg < 0 || !Number.isFinite(warnKg) || warnKg < minKg) {
      setThFeedback({
        type: 'err',
        text: 'Informe valores válidos: o limiar de atenção (laranja) deve ser maior ou igual ao mínimo crítico (vermelho).',
      });
      return;
    }
    if (thScope === 'SILO' && !thSiloId) {
      setThFeedback({ type: 'err', text: 'Selecione o silo específico para o limiar.' });
      return;
    }
    setThSaving(true);
    setThFeedback(null);
    try {
      await apiFetch('/api/stock-thresholds', {
        method: 'POST',
        body: JSON.stringify({
          materialId: Number(thMaterialId),
          siloId: thScope === 'SILO' ? Number(thSiloId) : null,
          minStockKg: minKg,
          warningStockKg: warnKg,
          notes: thNotes.trim() || undefined,
        }),
      });
      await onReload();
      setThFeedback({
        type: 'ok',
        text: 'Limiar salvo! Os alertas proativos no mapa e nas notificações foram recalculados.',
      });
    } catch (err: any) {
      setThFeedback({ type: 'err', text: err?.message || 'Erro ao salvar limiar de estoque.' });
    } finally {
      setThSaving(false);
    }
  };

  useEffect(() => {
    setMapComplexity(experienceMode === 'OPERACIONAL' ? 'SIMPLES' : 'DETALHADA');
  }, [experienceMode]);

  const openSiloDrawer = (s: SiloDetail) => {
    setSelectedSilo(s);
    setShowTechnicalDetails(mapComplexity === 'DETALHADA');
    setEditStatus(s.operationalStatus);
    setEditCleaning(s.cleaningStatus);
    setEditValidation(s.validationStatus);
    setEditMaterialId(s.primaryMaterialId ? String(s.primaryMaterialId) : '');
    setEditCapacity(String(s.nominalCapacityKg));
    setEditReason('');
    setSaveError(null);
  };

  const handleSaveSilo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSilo) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiFetch(`/api/silos/${selectedSilo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          operationalStatus: editStatus,
          cleaningStatus: editCleaning,
          validationStatus: editValidation,
          primaryMaterialId: editMaterialId ? Number(editMaterialId) : null,
          nominalCapacityKg: editCapacity ? Number(editCapacity) : undefined,
          reason: editReason,
        }),
      });
      await onReload();
      setSelectedSilo(null);
    } catch (err: any) {
      setSaveError(err.message || 'Falha ao salvar alteração.');
    } finally {
      setSaving(false);
    }
  };

  const renderSiloTile = (num: number, compact = false) => {
    const s = siloByNumber.get(num);
    if (!s) return null;
    const active = matchesFilter(s);
    const alertLevel = s.stockAlertLevel ?? 'NORMAL';
    const isCriticalStock = alertLevel === 'CRITICO';
    const isAttentionStock = alertLevel === 'ATENCAO';
    const isReceiving = Boolean(s.isReceiving);
    const isBlocked = s.operationalStatus === 'BLOQUEADO' || s.operationalStatus === 'MANUTENCAO';

    // 5 Estados Operacionais + Identidade de Categoria:
    // 1) Disponível (Azul Linha / Verde Armazenagem / Laranja Produção)
    // 2) Estoque baixo / Atenção (Laranja pulsante)
    // 3) Necessita abastecimento / Crítico (Vermelho pulsante)
    // 4) Em recebimento (Ciano com badge RECEBENDO)
    // 5) Indisponível (Vermelho fixo: Bloqueado/Manutenção)
    let borderBg = 'border-[#3B82F6]/45 bg-[#152336] hover:border-[#3B82F6]';
    let badgeText = 'text-[#60A5FA]';
    let barColor = 'bg-[#3B82F6]';

    if (s.category === 'ARMAZENAGEM') {
      borderBg = 'border-emerald-500/45 bg-emerald-950/35 hover:border-emerald-400';
      badgeText = 'text-emerald-400';
      barColor = 'bg-emerald-400';
    } else if (s.category === 'PRODUCAO') {
      borderBg = 'border-orange-500/45 bg-orange-950/25 hover:border-orange-400';
      badgeText = 'text-orange-400';
      barColor = 'bg-orange-400';
    }

    if (isReceiving) {
      borderBg = 'border-cyan-400/80 bg-cyan-950/35 hover:border-cyan-300';
      badgeText = 'text-cyan-300';
      barColor = 'bg-cyan-400';
    }

    if (isBlocked) {
      borderBg = 'border-red-500/70 bg-red-950/40 hover:border-red-400';
      badgeText = 'text-red-400';
      barColor = 'bg-red-500';
    }

    // Critical / Attention stock pulse overrides border & adds smooth glow
    let pulseClass = '';
    if (isCriticalStock) {
      borderBg = 'border-red-500/80 bg-red-950/40 hover:border-red-400';
      badgeText = 'text-red-300';
      barColor = 'bg-red-500';
      pulseClass = 'nexo-silo-pulse-red';
    } else if (isAttentionStock) {
      borderBg = 'border-orange-500/80 bg-orange-950/35 hover:border-orange-400';
      badgeText = 'text-orange-300';
      barColor = 'bg-orange-400';
      pulseClass = 'nexo-silo-pulse-orange';
    }

    const barWidth = Math.max(0, Math.min(100, s.occupancyPercent));

    return (
      <button
        key={num}
        type="button"
        onClick={() => openSiloDrawer(s)}
        title={
          s.stockAlertReason ||
          (isReceiving
            ? `Silo ${s.siloNumber} em recebimento ativo · Estoque: ${formatKg(s.confirmedStockKg)}`
            : `Silo ${s.siloNumber} · Estoque: ${formatKg(s.confirmedStockKg)}`)
        }
        className={`group relative flex min-h-[60px] flex-col justify-between rounded-lg border p-2.5 text-left transition-all ${borderBg} ${pulseClass} ${
          active ? 'opacity-100' : 'opacity-25'
        } ${compact ? 'min-w-[88px]' : 'w-full'}`}
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            {(isCriticalStock || isAttentionStock) && (
              <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full ${
                    isCriticalStock
                      ? 'bg-red-500 nexo-beacon-ring-red'
                      : 'bg-orange-400 nexo-beacon-ring-orange'
                  }`}
                />
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    isCriticalStock ? 'bg-red-500' : 'bg-orange-400'
                  }`}
                />
              </span>
            )}
            {isReceiving && !isCriticalStock && !isAttentionStock && (
              <Truck className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-label="Em recebimento" />
            )}
            <span className={`font-mono-tabular text-sm font-extrabold truncate ${badgeText}`}>
              Silo {s.siloNumber}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isReceiving && !compact && (
              <span className="rounded bg-cyan-500/20 border border-cyan-400/50 px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-cyan-200">
                RECEB.
              </span>
            )}
            {isBlocked && !compact && (
              <span className="rounded bg-red-500/20 border border-red-400/50 px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-red-200">
                INDISP.
              </span>
            )}
            {isCriticalStock && !compact && (
              <span className="rounded bg-red-500/25 border border-red-500/50 px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-red-200">
                CRÍTICO
              </span>
            )}
            {isAttentionStock && !compact && (
              <span className="rounded bg-orange-500/25 border border-orange-500/50 px-1 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-orange-200">
                BAIXO
              </span>
            )}
            {!isCriticalStock && !isAttentionStock && !isReceiving && !isBlocked && mapComplexity === 'SIMPLES' && !compact && (
              <span className="rounded bg-emerald-500/15 border border-emerald-500/35 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300">
                OK
              </span>
            )}
            {mapComplexity === 'DETALHADA' &&
              (s.validationStatus === 'PENDENTE_VALIDACAO' ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#F5B91B]" aria-label="Pendente validação" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" aria-label="Validado" />
              ))}
          </div>
        </div>

        <p className="mt-1 truncate text-[11px] font-medium text-[#F4F6F8]">
          {s.materialDescription || 'Sem material'}
        </p>

        <div className="mt-1.5 space-y-1">
          <div className="flex items-center justify-between gap-1 text-[10px] font-mono-tabular text-[#AEB8C5]">
            <span>
              {s.confirmedStockKg > 0
                ? formatKg(s.confirmedStockKg)
                : mapComplexity === 'SIMPLES'
                  ? 'Vazio'
                  : `Cap: ${formatKg(s.safeCapacityKg)}`}
            </span>
            <span
              className={
                isCriticalStock
                  ? 'font-bold text-red-300'
                  : isAttentionStock
                    ? 'font-bold text-orange-300'
                    : ''
              }
            >
              {s.occupancyPercent.toFixed(0)}%
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[#0A1421]/90">
            <div
              className={`h-full rounded-full transition-all duration-300 ${barColor}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      {/* Barra de Filtros, Zoom e Referência Original */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#AEB8C5]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar silo, código ou MP..."
              className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] pl-9 pr-3 text-sm text-[#F4F6F8] placeholder:text-[#AEB8C5]/60 focus:border-[#F5B91B] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-1">
            {[
              { id: 'ALL', label: 'Todos (54)' },
              { id: 'LINHA', label: 'Linhas (23)' },
              { id: 'ARMAZENAGEM', label: 'Armazenagem (9)' },
              { id: 'PRODUCAO', label: 'Produção (22)' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCategoryFilter(tab.id)}
                className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                  categoryFilter === tab.id
                    ? 'bg-[#F5B91B] text-[#0A1421]'
                    : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-[#AEB8C5]" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs font-medium text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
            >
              <option value="ALL">Todas situações</option>
              <option value="CRITICO_ATENCAO">Alertas de Estoque (Crítico / Baixo)</option>
              <option value="ESTOQUE_CRITICO">Necessita Abastecimento (Vermelho)</option>
              <option value="ESTOQUE_ATENCAO">Estoque Baixo (Laranja)</option>
              <option value="EM_RECEBIMENTO">Em Recebimento (Ativo)</option>
              <option value="OPERACIONAL">Disponível / Operacional</option>
              <option value="PENDENTE">Pendente Validação</option>
              <option value="BLOQUEADO">Indisponível (Bloqueado / Manutenção)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] p-1">
            <button
              type="button"
              onClick={() => setMapComplexity('SIMPLES')}
              className={`inline-flex min-h-[36px] items-center rounded-md px-3 text-xs font-bold transition-colors ${
                mapComplexity === 'SIMPLES'
                  ? 'bg-[#3B82F6] text-white'
                  : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
              }`}
            >
              Visão Simples
            </button>
            <button
              type="button"
              onClick={() => setMapComplexity('DETALHADA')}
              className={`inline-flex min-h-[36px] items-center rounded-md px-3 text-xs font-bold transition-colors ${
                mapComplexity === 'DETALHADA'
                  ? 'bg-[#3B82F6] text-white'
                  : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
              }`}
            >
              Visão Detalhada
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] p-1">
            <button
              type="button"
              onClick={() => setViewMode('2D')}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
                viewMode === '2D'
                  ? 'bg-[#F5B91B] text-[#0A1421]'
                  : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Croqui 2D</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('3D')}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
                viewMode === '3D'
                  ? 'bg-[#F5B91B] text-[#0A1421]'
                  : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
              }`}
            >
              <Box className="h-3.5 w-3.5" />
              <span>Planta 3D</span>
            </button>
          </div>

          {viewMode === '2D' && (
            <div className="flex items-center rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421]">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.15).toFixed(2))))}
                aria-label="Reduzir zoom"
                className="flex h-11 w-11 items-center justify-center text-[#AEB8C5] hover:text-[#F4F6F8]"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="px-2 font-mono-tabular text-xs font-semibold text-[#F4F6F8]">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.3, Number((z + 0.15).toFixed(2))))}
                aria-label="Aumentar zoom"
                className="flex h-11 w-11 items-center justify-center text-[#AEB8C5] hover:text-[#F4F6F8]"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => openThresholdModal()}
            data-testid="open-material-thresholds-btn"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#F5B91B]/45 bg-[#152336] px-3.5 py-2 text-xs font-bold text-[#F5B91B] hover:bg-[#1A2D46]"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Limiares por Material</span>
            {triggeredThresholdAlerts.length > 0 && (
              <span className="rounded bg-red-500 px-1.5 py-0.5 font-mono-tabular text-[10px] font-extrabold text-white">
                {triggeredThresholdAlerts.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setShowVolumeHistory24h((v) => !v)}
            data-testid="toggle-volume-history-24h-btn"
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors ${
              showVolumeHistory24h
                ? 'border-[#3B82F6]/65 bg-[#162B47] text-[#93C5FD]'
                : 'border-[#AEB8C5]/30 bg-[#152336] text-[#F4F6F8] hover:border-[#3B82F6]'
            }`}
          >
            <Clock className="h-4 w-4" />
            <span>Histórico 24h</span>
          </button>

          <button
            type="button"
            onClick={() => setShowReferenceImage(true)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/30 bg-[#152336] px-3.5 py-2 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
          >
            <Eye className="h-4 w-4 text-[#F5B91B]" />
            <span>Croqui Original</span>
          </button>
        </div>
      </div>

      {/* Notificações Proativas por Limiar de Material */}
      {triggeredThresholdAlerts.length > 0 && (
        <div
          data-testid="silo-map-proactive-alerts"
          className="rounded-xl border border-orange-500/45 bg-[#1A1A22] p-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-[#F5B91B]" />
              <h3 className="font-display text-xs font-extrabold uppercase tracking-wider text-[#F5B91B]">
                Notificações Proativas por Limiar de Matéria-Prima ({triggeredThresholdAlerts.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => openThresholdModal()}
              className="text-xs font-bold text-[#F5B91B] hover:underline"
            >
              {canManageThresholds ? 'Configurar / Ajustar Limiares' : 'Ver Limiares Configurados'}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {triggeredThresholdAlerts.map((al) => (
              <div
                key={al.thresholdId}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                  al.severity === 'CRITICO'
                    ? 'border-red-500/55 bg-red-950/35 text-red-100'
                    : 'border-orange-500/50 bg-orange-950/30 text-orange-100'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                        al.severity === 'CRITICO'
                          ? 'bg-red-500 text-white'
                          : 'bg-orange-500 text-[#0A1421]'
                      }`}
                    >
                      {al.severity === 'CRITICO' ? 'CRÍTICO' : 'BAIXO'}
                    </span>
                    <span className="truncate font-bold text-[#F4F6F8]">
                      {al.materialCode} · {al.materialDescription}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#AEB8C5]">{al.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery(al.materialCode);
                    if (al.affectedSiloNumbers.length === 1) {
                      const target = silos.find((s) => s.siloNumber === al.affectedSiloNumbers[0]);
                      if (target) setChartSiloId(target.id);
                    }
                  }}
                  className="shrink-0 rounded-md border border-[#F5B91B]/45 bg-[#0A1421] px-2.5 py-1.5 text-[11px] font-bold text-[#F5B91B] hover:bg-[#152336]"
                >
                  Filtrar no Mapa
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Faixa de Monitoramento de Estoque Crítico e Recebimentos */}
      {(criticalStockCount > 0 || attentionStockCount > 0 || receivingCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {criticalStockCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStatusFilter((cur) => (cur === 'ESTOQUE_CRITICO' ? 'ALL' : 'ESTOQUE_CRITICO'))
                }
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/15 px-3 py-1.5 font-bold text-red-200 hover:bg-red-500/25"
              >
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 nexo-beacon-ring-red" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span>{criticalStockCount} Silo(s) Necessitam Abastecimento</span>
              </button>
            )}
            {attentionStockCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStatusFilter((cur) => (cur === 'ESTOQUE_ATENCAO' ? 'ALL' : 'ESTOQUE_ATENCAO'))
                }
                className="inline-flex items-center gap-2 rounded-lg border border-orange-500/50 bg-orange-500/15 px-3 py-1.5 font-bold text-orange-200 hover:bg-orange-500/25"
              >
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 nexo-beacon-ring-orange" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" />
                </span>
                <span>{attentionStockCount} Silo(s) com Estoque Baixo</span>
              </button>
            )}
            {receivingCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setStatusFilter((cur) => (cur === 'EM_RECEBIMENTO' ? 'ALL' : 'EM_RECEBIMENTO'))
                }
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/50 bg-cyan-500/15 px-3 py-1.5 font-bold text-cyan-200 hover:bg-cyan-500/25"
              >
                <Truck className="h-3.5 w-3.5 text-cyan-300" />
                <span>{receivingCount} Silo(s) Em Recebimento</span>
              </button>
            )}
          </div>
          {statusFilter !== 'ALL' && (
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className="text-xs font-semibold text-[#F5B91B] hover:underline"
            >
              Limpar filtro
            </button>
          )}
        </div>
      )}

      {/* Legenda Operacional (5 Estados + Grupos) */}
      <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-[#AEB8C5]">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-[#3B82F6] bg-[#152336]" />
          Disponível (Linha)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-emerald-400 bg-emerald-950/50" />
          Disponível (Armazenagem 42–34)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-orange-400 bg-orange-950/50" />
          Produção (43–64)
        </span>
        <span className="flex items-center gap-1.5 text-orange-300">
          <span className="relative flex h-2.5 w-2.5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-orange-400 nexo-beacon-ring-orange" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" />
          </span>
          Estoque Baixo
        </span>
        <span className="flex items-center gap-1.5 text-red-300">
          <span className="relative flex h-2.5 w-2.5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 nexo-beacon-ring-red" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          Necessita Abastecimento
        </span>
        <span className="flex items-center gap-1.5 text-cyan-300">
          <Truck className="h-3.5 w-3.5 text-cyan-300" />
          Em Recebimento
        </span>
        <span className="flex items-center gap-1.5 text-red-300">
          <span className="h-3 w-3 rounded-sm border border-red-400 bg-red-950/50" />
          Indisponível (Bloqueio/Manut.)
        </span>
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-[#F5B91B]" />
          Pendente Validação
        </span>
      </div>

      {viewMode === '3D' ? (
        <SiloMap3DScene
          silos={silos}
          selectedSiloId={selectedSilo ? selectedSilo.id : null}
          matchesFilter={matchesFilter}
          onSelectSilo={openSiloDrawer}
        />
      ) : (
        /* Mapa Esquemático Fiel ao Croqui v2 (Sem ordenar numericamente, sem silos 27 e 30) */
        <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            className="min-w-[980px] space-y-6 transition-transform duration-150"
          >
          {/* Bloco Principal: Linhas 1-6 + Armazenagem (42 a 34) */}
          <div className="grid grid-cols-12 gap-6">
            {/* Esquerda/Centro: Linhas 6, 5, 4, 3, 2, 1 */}
            <div className="col-span-9 space-y-6">
              {/* Topo: Linha 6, Linha 5, Linha 4 */}
              <div className="grid grid-cols-12 items-start gap-4">
                {/* Linha 6 */}
                <div className="col-span-3 rounded-lg border border-[#3B82F6]/30 bg-[#0A1421]/60 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-display text-xs font-bold text-[#F4F6F8]">
                      LINHA 6 (29, 28)
                    </span>
                    <span className="font-mono-tabular text-[11px] font-semibold text-[#F5B91B]">
                      4,50 m
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderSiloTile(29)}
                    {renderSiloTile(28)}
                  </div>
                </div>

                {/* Linha 5 */}
                <div className="col-span-3 rounded-lg border border-[#3B82F6]/30 bg-[#0A1421]/60 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-display text-xs font-bold text-[#F4F6F8]">
                      LINHA 5 (9, 10)
                    </span>
                    <span className="font-mono-tabular text-[11px] font-semibold text-[#F5B91B]">
                      7,50 m
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderSiloTile(9)}
                    {renderSiloTile(10)}
                  </div>
                </div>

                {/* Linha 4 (Esquerda 11, 12, 13 inteiros | Direita 14/15, 16/31, 32/33 divididos) */}
                <div className="col-span-6 rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421]/60 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-display text-xs font-bold text-[#F4F6F8]">
                      LINHA 4 · Silos Inteiros (esq.) & Divididos (dir.)
                    </span>
                    <span className="font-mono-tabular text-[11px] font-semibold text-[#F5B91B]">
                      11,50 m
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>{renderSiloTile(11)}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {renderSiloTile(14)}
                        {renderSiloTile(15)}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>{renderSiloTile(12)}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {renderSiloTile(16)}
                        {renderSiloTile(31)}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>{renderSiloTile(13)}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {renderSiloTile(32)}
                        {renderSiloTile(33)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Base esquerda/centro: Linha 3, Linha 2, Linha 1 */}
              <div className="grid grid-cols-12 items-end gap-4">
                {/* Linha 3 */}
                <div className="col-span-6 rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421]/60 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-display text-xs font-bold text-[#F4F6F8]">
                      LINHA 3 · Silos Completos / Maior Capacidade
                    </span>
                    <span className="font-mono-tabular text-[11px] font-semibold text-[#F5B91B]">
                      11,50 m
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderSiloTile(22)}
                    {renderSiloTile(21)}
                    {renderSiloTile(20)}
                    {renderSiloTile(19)}
                    {renderSiloTile(18)}
                    {renderSiloTile(17)}
                  </div>
                </div>

                {/* Linha 2 */}
                <div className="col-span-3 rounded-lg border border-[#3B82F6]/30 bg-[#0A1421]/60 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-display text-xs font-bold text-[#F4F6F8]">
                      LINHA 2 (24, 23)
                    </span>
                    <span className="font-mono-tabular text-[11px] font-semibold text-[#F5B91B]">
                      8,50 m
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderSiloTile(24)}
                    {renderSiloTile(23)}
                  </div>
                </div>

                {/* Linha 1 */}
                <div className="col-span-3 rounded-lg border border-[#3B82F6]/30 bg-[#0A1421]/60 p-3">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-display text-xs font-bold text-[#F4F6F8]">
                      LINHA 1 (25, 26)
                    </span>
                    <span className="font-mono-tabular text-[11px] font-semibold text-[#F5B91B]">
                      8,50 m
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {renderSiloTile(25)}
                    {renderSiloTile(26)}
                  </div>
                </div>
              </div>
            </div>

            {/* Direita: Armazenagem (Silos 42 a 34 — Linha 7) */}
            <div className="col-span-3 rounded-lg border border-emerald-500/35 bg-emerald-950/15 p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-display text-xs font-bold text-emerald-300">
                  ARMAZENAGEM (L7)
                </span>
                <span className="font-mono-tabular text-[11px] font-semibold text-emerald-400">
                  42 → 34 · 9,00 m
                </span>
              </div>
              <div className="space-y-1.5">
                {storageSilos.map((s) => renderSiloTile(s.siloNumber))}
              </div>
            </div>
          </div>

          {/* Grupo Produção / Abastecimento: Silos 43 a 64 */}
          <div className="rounded-lg border border-orange-500/30 bg-orange-950/10 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-bold text-orange-300">
                  PRODUÇÃO / ABASTECIMENTO (Silos 43 a 64)
                </h3>
                <p className="text-xs text-[#AEB8C5]">
                  Silos de dosagem e abastecimento vinculados ao controle da Produção
                </p>
              </div>
              <span className="font-mono-tabular text-xs text-orange-300">22 Silos</span>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
              {productionSilos.map((s) => renderSiloTile(s.siloNumber, true))}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Histórico de Volume das Últimas 24 Horas (Recharts) */}
      {showVolumeHistory24h && (
        <SiloVolumeHistory24hChart
          silos={silos}
          materials={materials}
          externalSiloId={chartSiloId}
          refreshSignal={silos.map((s) => `${s.id}:${s.confirmedStockKg}`).join('|')}
        />
      )}

      {/* Modal Configuração de Limiares de Estoque por Matéria-Prima */}
      {showThresholdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#AEB8C5]/25 bg-[#101B2A] p-6 text-[#F4F6F8]">
            <div className="flex items-start justify-between gap-4 border-b border-[#AEB8C5]/15 pb-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                  MONITORAMENTO PROATIVO DE ESTOQUE
                </p>
                <h3 className="mt-1 font-display text-lg font-bold text-[#F4F6F8]">
                  Limiares de Estoque Baixo e Crítico por Matéria-Prima
                </h3>
                <p className="mt-0.5 text-xs text-[#AEB8C5]">
                  Defina limites mínimos específicos por material (ou por silo) para disparo imediato de alertas visuais e notificações no topo da plataforma.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowThresholdModal(false)}
                aria-label="Fechar configuração de limiares"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A2B42]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Formulário (Supervisão / Admin) */}
              <div className="lg:col-span-5">
                {canManageThresholds ? (
                  <form
                    onSubmit={handleSaveThreshold}
                    className="space-y-3 rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] p-4"
                  >
                    <h4 className="font-display text-sm font-bold text-[#F5B91B]">
                      Definir / Atualizar Limiar
                    </h4>

                    {thFeedback && (
                      <div
                        className={`rounded-lg border p-2.5 text-xs ${
                          thFeedback.type === 'ok'
                            ? 'border-emerald-500/45 bg-emerald-500/10 text-emerald-200'
                            : 'border-red-500/45 bg-red-500/10 text-red-200'
                        }`}
                      >
                        {thFeedback.text}
                      </div>
                    )}

                    <label className="block text-xs">
                      <span className="text-[#AEB8C5]">Matéria-Prima</span>
                      <select
                        value={thMaterialId}
                        onChange={(e) => setThMaterialId(e.target.value)}
                        className="mt-1 min-h-[42px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 text-xs font-semibold text-[#F4F6F8]"
                      >
                        <option value="">Selecione...</option>
                        {usedMaterialsSorted.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} — {m.description}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setThScope('MATERIAL');
                          setThSiloId('');
                        }}
                        className={`min-h-[40px] rounded-lg border px-2 font-bold ${
                          thScope === 'MATERIAL'
                            ? 'border-[#F5B91B] bg-[#F5B91B]/15 text-[#F5B91B]'
                            : 'border-[#AEB8C5]/20 bg-[#101B2A] text-[#AEB8C5]'
                        }`}
                      >
                        Toda a MP (Consolidado)
                      </button>
                      <button
                        type="button"
                        onClick={() => setThScope('SILO')}
                        className={`min-h-[40px] rounded-lg border px-2 font-bold ${
                          thScope === 'SILO'
                            ? 'border-[#F5B91B] bg-[#F5B91B]/15 text-[#F5B91B]'
                            : 'border-[#AEB8C5]/20 bg-[#101B2A] text-[#AEB8C5]'
                        }`}
                      >
                        Silo Específico
                      </button>
                    </div>

                    {thScope === 'SILO' && (
                      <label className="block text-xs">
                        <span className="text-[#AEB8C5]">Silo Alvo</span>
                        <select
                          value={thSiloId}
                          onChange={(e) => setThSiloId(e.target.value)}
                          className="mt-1 min-h-[42px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 text-xs font-semibold text-[#F4F6F8]"
                        >
                          <option value="">Selecione o silo...</option>
                          {silos
                            .filter(
                              (s) => !thMaterialId || s.primaryMaterialId === Number(thMaterialId)
                            )
                            .sort((a, b) => a.rubricOrder - b.rubricOrder)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                Silo {s.siloNumber} ({s.lineCode}) — Atual: {formatKg(s.confirmedStockKg)}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block text-xs">
                        <span className="text-red-300 font-semibold">Crítico / Vermelho (kg)</span>
                        <input
                          type="number"
                          min={0}
                          step="100"
                          required
                          value={thMinKg}
                          onChange={(e) => setThMinKg(e.target.value)}
                          className="mt-1 min-h-[42px] w-full rounded-lg border border-red-500/40 bg-[#101B2A] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                        />
                      </label>
                      <label className="block text-xs">
                        <span className="text-orange-300 font-semibold">Baixo / Laranja (kg)</span>
                        <input
                          type="number"
                          min={0}
                          step="100"
                          required
                          value={thWarnKg}
                          onChange={(e) => setThWarnKg(e.target.value)}
                          className="mt-1 min-h-[42px] w-full rounded-lg border border-orange-500/40 bg-[#101B2A] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                        />
                      </label>
                    </div>

                    <label className="block text-xs">
                      <span className="text-[#AEB8C5]">Observação / Regra Operacional</span>
                      <input
                        type="text"
                        value={thNotes}
                        onChange={(e) => setThNotes(e.target.value)}
                        placeholder="Ex.: Lead time de entrega de 24h"
                        className="mt-1 min-h-[42px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={thSaving}
                      className="min-h-[46px] w-full rounded-lg bg-[#F5B91B] px-4 text-sm font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-60"
                    >
                      {thSaving ? 'Salvando limiar...' : 'Salvar Limiar e Ativar Alertas'}
                    </button>
                  </form>
                ) : (
                  <div className="rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] p-4 text-xs text-[#AEB8C5] space-y-2">
                    <div className="flex items-center gap-2 font-bold text-[#F5B91B]">
                      <Info className="h-4 w-4" />
                      <span>Modo Consulta</span>
                    </div>
                    <p>
                      A criação ou edição de limiares por matéria-prima requer perfil de Supervisor ou Administrador. Você pode acompanhar ao lado todos os limiares ativos e alertas gerados.
                    </p>
                  </div>
                )}
              </div>

              {/* Lista de Limiares Ativos & Avaliação Atual */}
              <div className="lg:col-span-7 space-y-2.5">
                <h4 className="font-display text-sm font-bold text-[#F4F6F8]">
                  Limiares Configurados ({effectiveThresholdAlerts.length})
                </h4>
                {effectiveThresholdAlerts.length === 0 ? (
                  <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-5 text-xs text-[#AEB8C5]">
                    Nenhum limiar específico cadastrado até o momento. Cadastre um limiar ao lado para receber notificações proativas quando o estoque cair abaixo do limite definido.
                  </div>
                ) : (
                  <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {effectiveThresholdAlerts.map((al) => (
                      <div
                        key={al.thresholdId}
                        className={`rounded-xl border p-3.5 text-xs ${
                          al.severity === 'CRITICO'
                            ? 'border-red-500/50 bg-red-950/25'
                            : al.severity === 'ATENCAO'
                              ? 'border-orange-500/45 bg-orange-950/20'
                              : 'border-[#AEB8C5]/20 bg-[#0A1421]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <span className="font-mono-tabular font-bold text-[#F5B91B]">
                              {al.materialCode}
                            </span>{' '}
                            <span className="font-bold text-[#F4F6F8]">
                              · {al.materialDescription}
                            </span>
                          </div>
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-extrabold ${
                              al.severity === 'CRITICO'
                                ? 'bg-red-500 text-white'
                                : al.severity === 'ATENCAO'
                                  ? 'bg-orange-500 text-[#0A1421]'
                                  : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {al.severity === 'CRITICO'
                              ? 'CRÍTICO'
                              : al.severity === 'ATENCAO'
                                ? 'ESTOQUE BAIXO'
                                : 'NORMAL'}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 font-mono-tabular text-[11px]">
                          <div>
                            <span className="text-[#AEB8C5]">Escopo:</span>{' '}
                            <strong className="text-[#F4F6F8]">
                              {al.scope === 'SILO'
                                ? `Silo ${al.siloNumber}`
                                : `Toda MP (${al.affectedSiloNumbers.map((n) => `S${n}`).join(', ') || '0'})`}
                            </strong>
                          </div>
                          <div>
                            <span className="text-[#AEB8C5]">Atual:</span>{' '}
                            <strong className="text-[#F4F6F8]">{formatKg(al.currentStockKg)}</strong>
                          </div>
                          <div>
                            <span className="text-red-300">Crít: {formatKg(al.minStockKg)}</span> ·{' '}
                            <span className="text-orange-300">
                              Baixo: {formatKg(al.warningStockKg)}
                            </span>
                          </div>
                        </div>
                        {canManageThresholds && (
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setThMaterialId(String(al.materialId));
                                setThScope(al.scope);
                                setThSiloId(al.siloId ? String(al.siloId) : '');
                                setThMinKg(String(al.minStockKg));
                                setThWarnKg(String(al.warningStockKg));
                                setThFeedback(null);
                              }}
                              className="text-[11px] font-bold text-[#F5B91B] hover:underline"
                            >
                              Editar este limiar
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Croqui Original para Conferência */}
      {showReferenceImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-xl border border-[#AEB8C5]/25 bg-[#101B2A] p-5">
            <div className="flex items-center justify-between gap-4 border-b border-[#AEB8C5]/15 pb-3">
              <div>
                <h3 className="font-display text-lg font-bold text-[#F4F6F8]">
                  Croqui Original de Referência — Conferência Visual
                </h3>
                <p className="text-xs text-[#AEB8C5]">
                  Disposição física oficial preservada sem alteração de posição ou ordenação
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowReferenceImage(false)}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A2B42]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-4 rounded-lg bg-white p-2">
              <img
                src="/assets/aistudio/NEXO_LOG_mapa_silos_croqui_v2_6c83feb3.png"
                alt="Croqui original do mapa de silos NEXO LOG 2.0"
                referrerPolicy="no-referrer"
                className="h-auto w-full rounded"
              />
            </div>
          </div>
        </div>
      )}

      {/* Drawer Detalhado do Silo */}
      {selectedSilo && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-[#AEB8C5]/20 bg-[#101B2A] p-6 text-[#F4F6F8]">
            <div className="flex items-start justify-between gap-4 border-b border-[#AEB8C5]/15 pb-4">
              <div>
                <p className="text-xs font-semibold text-[#F5B91B]">
                  {selectedSilo.category} · {selectedSilo.lineName} · Controle{' '}
                  {selectedSilo.controlOwner}
                </p>
                <h3 className="mt-1 font-display text-2xl font-extrabold">
                  Silo {selectedSilo.siloNumber}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSilo(null)}
                aria-label="Fechar detalhes do silo"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A2B42]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-5">
              {/* Alerta de Nível Crítico / Atenção no Silo */}
              {selectedSilo.stockAlertLevel && selectedSilo.stockAlertLevel !== 'NORMAL' && (
                <div
                  className={`flex items-start gap-3 rounded-lg border p-3.5 text-xs ${
                    selectedSilo.stockAlertLevel === 'CRITICO'
                      ? 'border-red-500/60 bg-red-950/40 text-red-100 nexo-row-pulse-red'
                      : 'border-orange-500/60 bg-orange-950/35 text-orange-100 nexo-row-pulse-orange'
                  }`}
                >
                  <span className="relative mt-1 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full ${
                        selectedSilo.stockAlertLevel === 'CRITICO'
                          ? 'bg-red-500 nexo-beacon-ring-red'
                          : 'bg-orange-400 nexo-beacon-ring-orange'
                      }`}
                    />
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${
                        selectedSilo.stockAlertLevel === 'CRITICO' ? 'bg-red-500' : 'bg-orange-400'
                      }`}
                    />
                  </span>
                  <div className="space-y-1">
                    <p
                      className={`font-bold uppercase tracking-wide ${
                        selectedSilo.stockAlertLevel === 'CRITICO' ? 'text-red-300' : 'text-orange-300'
                      }`}
                    >
                      {selectedSilo.stockAlertLevel === 'CRITICO'
                        ? 'Alerta Crítico de Estoque (Vermelho)'
                        : 'Nível de Atenção de Estoque (Laranja)'}
                    </p>
                    <p className="leading-relaxed text-[#F4F6F8]">
                      {selectedSilo.stockAlertReason || 'Estoque abaixo do nível recomendado para operação.'}
                    </p>
                    {(selectedSilo.minStockKg !== null && selectedSilo.minStockKg !== undefined) && (
                      <p className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                        Mínimo crítico: {formatKg(selectedSilo.minStockKg)}
                        {selectedSilo.warningStockKg !== null && selectedSilo.warningStockKg !== undefined
                          ? ` · Nível de atenção: ${formatKg(selectedSilo.warningStockKg)}`
                          : ''}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Cartão Simples do Silo (Sempre visível primeiro para o operador) */}
              <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#152336] p-4 space-y-4">
                <div>
                  <p className="text-xs text-[#AEB8C5]">Material no Silo</p>
                  <p className="mt-1 text-lg font-extrabold text-[#F4F6F8]">
                    {selectedSilo.materialDescription || 'Sem material vinculado'}
                  </p>
                  {selectedSilo.materialCode && (
                    <p className="mt-0.5 font-mono-tabular text-xs text-[#F5B91B]">
                      Código: {selectedSilo.materialCode} · Tipo: {selectedSilo.materialHandlingType || '—'}
                    </p>
                  )}
                </div>

                {/* Barra de Ocupação Clara */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#AEB8C5]">Ocupação atual</span>
                    <span className="font-mono-tabular font-bold text-[#F4F6F8]">
                      {selectedSilo.occupancyPercent.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-[#0A1421]">
                    <div
                      className={`h-full rounded-full ${
                        selectedSilo.stockAlertLevel === 'CRITICO'
                          ? 'bg-red-500'
                          : selectedSilo.stockAlertLevel === 'ATENCAO'
                            ? 'bg-orange-400'
                            : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, selectedSilo.occupancyPercent))}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-[#AEB8C5]/15 pt-3 text-xs">
                  <div className="rounded-lg bg-[#0A1421] p-3">
                    <p className="text-[#AEB8C5]">Quanto tem agora</p>
                    <p
                      className={`mt-1 font-mono-tabular text-base font-extrabold ${
                        selectedSilo.stockAlertLevel === 'CRITICO'
                          ? 'text-red-400'
                          : selectedSilo.stockAlertLevel === 'ATENCAO'
                            ? 'text-orange-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {formatKg(selectedSilo.confirmedStockKg)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#0A1421] p-3">
                    <p className="text-[#AEB8C5]">Quanto ainda cabe</p>
                    <p className="mt-1 font-mono-tabular text-base font-extrabold text-[#F4F6F8]">
                      {formatKg(selectedSilo.availableSpaceKg)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {onStartReceivingToSilo && selectedSilo.operationalStatus === 'OPERACIONAL' && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetId = selectedSilo.id;
                        setSelectedSilo(null);
                        onStartReceivingToSilo(targetId);
                      }}
                      className="min-h-[46px] flex-1 rounded-xl bg-[#F5B91B] px-4 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
                    >
                      RECEBER MATERIAL NESTE SILO
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = selectedSilo.id;
                      setChartSiloId(targetId);
                      setShowVolumeHistory24h(true);
                      setSelectedSilo(null);
                    }}
                    className="min-h-[46px] rounded-xl border border-[#3B82F6]/45 bg-[#0A1421] px-3.5 text-xs font-bold text-[#93C5FD] hover:border-[#3B82F6]"
                  >
                    Histórico 24h
                  </button>
                  {selectedSilo.primaryMaterialId && (
                    <button
                      type="button"
                      onClick={() => {
                        const matId = selectedSilo.primaryMaterialId;
                        const sId = selectedSilo.id;
                        setSelectedSilo(null);
                        openThresholdModal(matId, sId);
                      }}
                      className="min-h-[46px] rounded-xl border border-[#F5B91B]/45 bg-[#0A1421] px-3.5 text-xs font-bold text-[#F5B91B] hover:border-[#F5B91B]"
                    >
                      Limiar MP
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowTechnicalDetails((v) => !v)}
                    className="min-h-[46px] rounded-xl border border-[#AEB8C5]/30 bg-[#0A1421] px-4 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]"
                  >
                    {showTechnicalDetails ? 'OCULTAR DETALHES' : 'VER DETALHES'}
                  </button>
                </div>
              </div>

              {showTechnicalDetails && (
                <>
                  {/* Dados Técnicos Completos */}
                  <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 text-xs grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[#AEB8C5]">Cap. Nominal</p>
                      <p className="mt-0.5 font-mono-tabular font-bold text-[#F4F6F8]">
                        {formatKg(selectedSilo.nominalCapacityKg)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#AEB8C5]">Cap. Segura (-10%)</p>
                      <p className="mt-0.5 font-mono-tabular font-bold text-[#3B82F6]">
                        {formatKg(selectedSilo.safeCapacityKg)}
                      </p>
                    </div>
                  </div>

                  {/* Dados Físicos & Estado */}
                  <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
                  <p className="text-[#AEB8C5]">Corda</p>
                  <p className="mt-1 font-mono-tabular text-sm font-bold">
                    {selectedSilo.cordaMeters ? `${selectedSilo.cordaMeters} m` : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
                  <p className="text-[#AEB8C5]">Altura Croqui</p>
                  <p className="mt-1 font-mono-tabular text-sm font-bold">
                    {selectedSilo.heightMeters ? `${selectedSilo.heightMeters} m` : 'Não informada'}
                  </p>
                </div>
                <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
                  <p className="text-[#AEB8C5]">Situação</p>
                  <p className="mt-1 font-bold text-[#F4F6F8]">{selectedSilo.operationalStatus}</p>
                </div>
                <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
                  <p className="text-[#AEB8C5]">Limpeza</p>
                  <p className="mt-1 font-bold text-[#F4F6F8]">{selectedSilo.cleaningStatus}</p>
                </div>
              </div>

              {/* Pendência de Validação se existir */}
              {selectedSilo.validationStatus === 'PENDENTE_VALIDACAO' && (
                <div className="flex items-start gap-3 rounded-lg border border-[#F5B91B]/45 bg-[#F5B91B]/10 p-3.5 text-xs text-[#F4F6F8]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F5B91B]" />
                  <div>
                    <p className="font-bold text-[#F5B91B]">Pendência de Validação Documental</p>
                    <p className="mt-1 leading-relaxed text-[#AEB8C5]">
                      {selectedSilo.validationNotes ||
                        'Divergência detectada entre RQ-REC-046 e planilha operacional. Validar antes do uso.'}
                    </p>
                  </div>
                </div>
              )}

              {/* Lotes Ativos & Histórico de Entradas/Saídas do Silo (Fase 2) */}
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                    Lotes Existentes & Movimentações do Silo
                  </h4>
                  {onStartReceivingToSilo && selectedSilo.operationalStatus === 'OPERACIONAL' && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetId = selectedSilo.id;
                        setSelectedSilo(null);
                        onStartReceivingToSilo(targetId);
                      }}
                      className="min-h-[36px] rounded-md bg-[#F5B91B] px-3 text-xs font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
                    >
                      Receber para Silo {selectedSilo.siloNumber}
                    </button>
                  )}
                </div>

                {loadingLedger ? (
                  <p className="text-xs text-[#AEB8C5]">Consultando livro razão do silo...</p>
                ) : !siloLedger ? (
                  <p className="text-xs text-[#AEB8C5]">Sem dados de movimentação disponíveis.</p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-[11px] font-semibold text-[#AEB8C5]">Lotes Ativos:</p>
                      {siloLedger.activeLots.length === 0 ? (
                        <p className="mt-1 text-xs text-[#AEB8C5]/75">Nenhum lote com saldo ativo.</p>
                      ) : (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {siloLedger.activeLots.map((lot) => (
                            <span
                              key={`${lot.lotCode}-${lot.materialCode}`}
                              className="rounded border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 font-mono-tabular text-xs text-emerald-300"
                            >
                              Lote {lot.lotCode}: {formatKg(lot.netKg)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold text-[#AEB8C5]">
                        Últimas Entradas e Saídas ({siloLedger.movements.length}):
                      </p>
                      {siloLedger.movements.length === 0 ? (
                        <p className="mt-1 text-xs text-[#AEB8C5]/75">
                          Nenhuma movimentação registrada neste silo.
                        </p>
                      ) : (
                        <div className="mt-1.5 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                          {siloLedger.movements.map((mov) => (
                            <div
                              key={mov.id}
                              className="flex items-center justify-between gap-2 border-t border-[#AEB8C5]/10 pt-1.5 text-xs"
                            >
                              <div>
                                <span className="font-semibold text-[#F4F6F8]">
                                  {mov.movementType}
                                </span>{' '}
                                {mov.lotCode ? (
                                  <span className="font-mono-tabular text-[#F5B91B]">
                                    · Lote {mov.lotCode}
                                  </span>
                                ) : null}
                                <p className="text-[11px] text-[#AEB8C5]">
                                  {mov.operatorName} · {new Date(mov.createdAt).toLocaleString('pt-BR')}
                                </p>
                              </div>
                              <span
                                className={`font-mono-tabular font-bold ${
                                  mov.status === 'ESTORNADO'
                                    ? 'text-red-400 line-through'
                                    : mov.direction === 'CREDIT'
                                      ? 'text-emerald-400'
                                      : 'text-orange-400'
                                }`}
                              >
                                {mov.direction === 'CREDIT' ? '+' : '-'}
                                {formatKg(mov.quantityKg)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Compatibilidades Cadastradas */}
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-4">
                <h4 className="font-display text-xs font-bold uppercase tracking-wider text-[#AEB8C5]">
                  Compatibilidade de Recebimento / Transferência
                </h4>
                {selectedSilo.compatibilities.length === 0 ? (
                  <p className="mt-2 text-xs text-[#AEB8C5]">Nenhuma compatibilidade cadastrada.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedSilo.compatibilities.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-t border-[#AEB8C5]/10 pt-2 text-xs"
                      >
                        <div>
                          <span className="font-mono-tabular font-bold text-[#F5B91B]">
                            {c.materialCode}
                          </span>{' '}
                          · {c.materialDescription}
                        </div>
                        <div className="text-[#AEB8C5]">
                          {c.allowReceiving ? 'Recebe' : 'Não recebe'} ·{' '}
                          {c.allowTransferIn ? 'Entra transf.' : 'Sem entrada'} ·{' '}
                          {c.allowTransferOut ? 'Sai transf.' : 'Sem saída'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Edição Administrativa (Admin / Supervisor) */}
              {canManageSilos ? (
                <form
                  onSubmit={handleSaveSilo}
                  className="space-y-3 rounded-lg border border-[#AEB8C5]/20 bg-[#152336] p-4"
                >
                  <h4 className="font-display text-sm font-bold text-[#F4F6F8]">
                    Administração do Silo (Gera Auditoria)
                  </h4>

                  {saveError && (
                    <div className="rounded border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-200">
                      {saveError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-xs">
                      <span className="text-[#AEB8C5]">Estado Operacional</span>
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                        className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                      >
                        <option value="OPERACIONAL">OPERACIONAL</option>
                        <option value="LIMPEZA">LIMPEZA</option>
                        <option value="MANUTENCAO">MANUTENCAO</option>
                        <option value="BLOQUEADO">BLOQUEADO</option>
                        <option value="INATIVO">INATIVO</option>
                      </select>
                    </label>

                    <label className="block text-xs">
                      <span className="text-[#AEB8C5]">Situação de Limpeza</span>
                      <select
                        value={editCleaning}
                        onChange={(e) => setEditCleaning(e.target.value)}
                        className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                      >
                        <option value="EM_USO">EM_USO</option>
                        <option value="LIMPO">LIMPO</option>
                        <option value="REQUER_LIMPEZA">REQUER_LIMPEZA</option>
                      </select>
                    </label>

                    <label className="block text-xs">
                      <span className="text-[#AEB8C5]">Matéria-Prima Vinculada</span>
                      <select
                        value={editMaterialId}
                        onChange={(e) => setEditMaterialId(e.target.value)}
                        className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                      >
                        <option value="">Sem vínculo</option>
                        {materials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} — {m.description}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-xs">
                      <span className="text-[#AEB8C5]">Capacidade Nominal (kg)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editCapacity}
                        onChange={(e) => setEditCapacity(e.target.value)}
                        className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                      />
                    </label>
                  </div>

                  <label className="block text-xs">
                    <span className="text-[#AEB8C5]">Status de Validação Documental</span>
                    <select
                      value={editValidation}
                      onChange={(e) =>
                        setEditValidation(e.target.value as 'VALIDADO' | 'PENDENTE_VALIDACAO')
                      }
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                    >
                      <option value="VALIDADO">VALIDADO</option>
                      <option value="PENDENTE_VALIDACAO">PENDENTE_VALIDACAO</option>
                    </select>
                  </label>

                  <label className="block text-xs">
                    <span className="text-[#AEB8C5]">Motivo da Alteração (obrigatório)</span>
                    <input
                      type="text"
                      required
                      minLength={3}
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      placeholder="Ex.: Validação conforme planta oficial RQ-REC-046"
                      className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={saving}
                    className="min-h-[48px] w-full rounded-lg bg-[#F5B91B] px-4 py-2.5 text-sm font-bold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-60"
                  >
                    {saving ? 'Salvando no PostgreSQL...' : 'Salvar Configuração do Silo'}
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 text-xs text-[#AEB8C5]">
                  <Info className="h-4 w-4 text-[#F5B91B]" />
                  <span>Perfil em modo consulta. Alterações cadastrais requerem Supervisor ou Administrador.</span>
                </div>
              )}
              </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
