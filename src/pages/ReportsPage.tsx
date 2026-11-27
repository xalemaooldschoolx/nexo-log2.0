import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  ClipboardCheck,
  Database,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  Layers,
  Plus,
  RefreshCw,
  Repeat,
  Target,
  Truck,
} from 'lucide-react';
import {
  ConsumptionReportResponse,
  InventoryMovementItem,
  MaterialItem,
  OperationalIndicatorsOverview,
  PeriodPreset,
  ReceivingReportResponse,
  ReportFilterParams,
  ReportTypeCode,
  SessionData,
  ShiftManagerialReportResponse,
  ShiftManagerialReportRow,
  SiloDetail,
  StockAndHistoricalReportResponse,
  TransfersReportResponse,
} from '../types/nexo.ts';
import { apiDownloadFile, apiFetch, formatKg } from '../lib/api.ts';
import { formatIsoDatePtBr } from '../lib/phase5-analytics.ts';
import { hasPermission } from '../lib/rbac.ts';

interface ReportsPageProps {
  session: SessionData;
  silos: SiloDetail[];
  materials: MaterialItem[];
}

type ReportTabId =
  | 'INDICADORES'
  | 'TURNOS'
  | 'RECEBIMENTOS'
  | 'ESTOQUE'
  | 'TRANSFERENCIAS'
  | 'CONSUMO'
  | 'DESEMPENHO'
  | 'RAZAO';

const PRESET_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: 'HOJE', label: 'Hoje' },
  { value: 'ONTEM', label: 'Ontem' },
  { value: 'ULTIMOS_7_DIAS', label: 'Últimos 7 dias' },
  { value: 'ULTIMOS_30_DIAS', label: 'Últimos 30 dias' },
  { value: 'MES_ATUAL', label: 'Mês atual' },
  { value: 'PERSONALIZADO', label: 'Intervalo personalizado' },
];

export const ReportsPage: React.FC<ReportsPageProps> = ({ session, silos, materials }) => {
  const [activeTab, setActiveTab] = useState<ReportTabId>('INDICADORES');
  const [preset, setPreset] = useState<PeriodPreset>('ULTIMOS_30_DIAS');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [shiftCode, setShiftCode] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [siloId, setSiloId] = useState('');
  const [lineCode, setLineCode] = useState('');

  // Filtros específicos por aba
  const [supplierFilter, setSupplierFilter] = useState('');
  const [lotFilter, setLotFilter] = useState('');
  const [onlyPartial, setOnlyPartial] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [transferStatus, setTransferStatus] = useState('');
  const [onlyPendingComparison, setOnlyPendingComparison] = useState(false);
  const [historicalDate, setHistoricalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cutoffMode, setCutoffMode] = useState<'OPERATIONAL_DATE' | 'TIMESTAMP'>('OPERATIONAL_DATE');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [badgeFilter, setBadgeFilter] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  // Dados carregados
  const [overview, setOverview] = useState<OperationalIndicatorsOverview | null>(null);
  const [shiftRep, setShiftRep] = useState<ShiftManagerialReportResponse | null>(null);
  const [previewShiftRow, setPreviewShiftRow] = useState<ShiftManagerialReportRow | null>(null);
  const [receivingRep, setReceivingRep] = useState<ReceivingReportResponse | null>(null);
  const [stockRep, setStockRep] = useState<StockAndHistoricalReportResponse | null>(null);
  const [transfersRep, setTransfersRep] = useState<TransfersReportResponse | null>(null);
  const [consumptionRep, setConsumptionRep] = useState<ConsumptionReportResponse | null>(null);
  const [movements, setMovements] = useState<InventoryMovementItem[]>([]);

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Meta futura (Admin)
  const canManageTargets = hasPermission(session.user.roleCode, 'kpi:targets_manage');
  const canExport = hasPermission(session.user.roleCode, 'reports:export');
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [targetCode, setTargetCode] = useState('');
  const [targetMetricKey, setTargetMetricKey] = useState('TEMPO_MEDIO_RECEBIMENTO_MIN');
  const [targetLabel, setTargetLabel] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [targetUnit, setTargetUnit] = useState('min');
  const [targetPeriod, setTargetPeriod] = useState<'DIARIO' | 'SEMANAL' | 'MENSAL'>('MENSAL');
  const [targetNotes, setTargetNotes] = useState('');

  const buildFilterObject = useCallback((): ReportFilterParams => {
    return {
      preset,
      startDate: preset === 'PERSONALIZADO' ? startDate : undefined,
      endDate: preset === 'PERSONALIZADO' ? endDate : undefined,
      shiftCode: shiftCode || undefined,
      materialId: materialId ? Number(materialId) : null,
      siloId: siloId ? Number(siloId) : null,
      lineCode: lineCode || undefined,
      supplierName: supplierFilter.trim() || undefined,
      lotCode: lotFilter.trim() || undefined,
      status: transferStatus || undefined,
      onlyPartial,
      onlyPending,
      onlyPendingComparison,
      historicalDate,
      cutoffMode,
    };
  }, [
    preset,
    startDate,
    endDate,
    shiftCode,
    materialId,
    siloId,
    lineCode,
    supplierFilter,
    lotFilter,
    transferStatus,
    onlyPartial,
    onlyPending,
    onlyPendingComparison,
    historicalDate,
    cutoffMode,
  ]);

  const buildQueryString = useCallback(
    (extra?: Record<string, string | boolean | undefined>) => {
      const f = buildFilterObject();
      const qs = new URLSearchParams();
      if (f.preset) qs.set('preset', f.preset);
      if (f.startDate) qs.set('startDate', f.startDate);
      if (f.endDate) qs.set('endDate', f.endDate);
      if (f.shiftCode) qs.set('shiftCode', f.shiftCode);
      if (f.materialId) qs.set('materialId', String(f.materialId));
      if (f.siloId) qs.set('siloId', String(f.siloId));
      if (f.lineCode) qs.set('lineCode', f.lineCode);
      if (f.supplierName) qs.set('supplierName', f.supplierName);
      if (f.lotCode) qs.set('lotCode', f.lotCode);
      if (f.status) qs.set('status', f.status);
      if (f.onlyPartial) qs.set('onlyPartial', 'true');
      if (f.onlyPending) qs.set('onlyPending', 'true');
      if (f.onlyPendingComparison) qs.set('onlyPendingComparison', 'true');
      if (f.historicalDate) qs.set('historicalDate', f.historicalDate);
      if (f.cutoffMode) qs.set('cutoffMode', f.cutoffMode);
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => {
          if (v !== undefined && v !== '') qs.set(k, String(v));
        });
      }
      return qs.toString();
    },
    [buildFilterObject]
  );

  const loadActiveTab = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = buildQueryString();
      if (activeTab === 'INDICADORES' || activeTab === 'DESEMPENHO') {
        const res = await apiFetch<OperationalIndicatorsOverview>(`/api/reports/overview?${q}`);
        setOverview(res);
      } else if (activeTab === 'TURNOS') {
        const sq = buildQueryString({
          operatorName: operatorFilter.trim() || undefined,
          badgeCode: badgeFilter.trim() || undefined,
          workflowStatus: workflowFilter || undefined,
          search: searchFilter.trim() || undefined,
        });
        const res = await apiFetch<ShiftManagerialReportResponse>(`/api/reports/shifts?${sq}`);
        setShiftRep(res);
      } else if (activeTab === 'RECEBIMENTOS') {
        const res = await apiFetch<ReceivingReportResponse>(`/api/reports/receiving?${q}`);
        setReceivingRep(res);
      } else if (activeTab === 'ESTOQUE') {
        const res = await apiFetch<StockAndHistoricalReportResponse>(`/api/reports/stock?${q}`);
        setStockRep(res);
      } else if (activeTab === 'TRANSFERENCIAS') {
        const res = await apiFetch<TransfersReportResponse>(`/api/reports/transfers?${q}`);
        setTransfersRep(res);
      } else if (activeTab === 'CONSUMO') {
        const res = await apiFetch<ConsumptionReportResponse>(`/api/reports/consumption?${q}`);
        setConsumptionRep(res);
      } else if (activeTab === 'RAZAO') {
        const mq = new URLSearchParams();
        if (siloId) mq.set('siloId', siloId);
        if (materialId) mq.set('materialId', materialId);
        if (shiftCode) mq.set('shiftCode', shiftCode);
        if (lotFilter.trim()) mq.set('lotCode', lotFilter.trim());
        const res = await apiFetch<InventoryMovementItem[]>(
          `/api/movements${mq.toString() ? `?${mq.toString()}` : ''}`
        );
        setMovements(res);
      }
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar relatório operacional.');
    } finally {
      setLoading(false);
    }
  }, [
    activeTab,
    buildQueryString,
    siloId,
    materialId,
    shiftCode,
    lotFilter,
    operatorFilter,
    badgeFilter,
    workflowFilter,
    searchFilter,
  ]);

  useEffect(() => {
    loadActiveTab();
  }, [loadActiveTab]);

  const handleExport = async (
    format: 'PDF' | 'XLSX' | 'CSV',
    overrideType?: ReportTypeCode,
    extraShift?: { shiftCode: string; operationalDate: string }
  ) => {
    setExporting(format);
    setError(null);
    setStatusMessage(null);
    try {
      const reportType: ReportTypeCode =
        overrideType ||
        (activeTab === 'RAZAO'
          ? 'ESTOQUE'
          : activeTab === 'TURNOS'
            ? 'TURNO'
            : activeTab === 'DESEMPENHO'
              ? 'DESEMPENHO'
              : (activeTab as ReportTypeCode));
      const fileName = await apiDownloadFile('/api/reports/export', {
        method: 'POST',
        body: JSON.stringify({
          reportType,
          format,
          shiftCode: extraShift?.shiftCode || shiftCode || undefined,
          operationalDate: extraShift?.operationalDate || undefined,
          filters: buildFilterObject(),
        }),
      });
      setStatusMessage(`Relatório exportado e auditado com sucesso: ${fileName}`);
      if (activeTab === 'INDICADORES' || activeTab === 'DESEMPENHO') {
        loadActiveTab();
      }
    } catch (err: any) {
      setError(err.message || `Falha ao exportar relatório em ${format}.`);
    } finally {
      setExporting(null);
    }
  };

  const handleCreateTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/api/kpi-targets', {
        method: 'POST',
        body: JSON.stringify({
          code: targetCode,
          metricKey: targetMetricKey,
          label: targetLabel,
          targetValue: Number(targetValue),
          unit: targetUnit,
          targetPeriod,
          effectiveFromDate: new Date().toISOString().slice(0, 10),
          notes: targetNotes || null,
        }),
      });
      setShowTargetForm(false);
      setTargetCode('');
      setTargetLabel('');
      setTargetValue('');
      setTargetNotes('');
      setStatusMessage('Meta futura configurada pela Administração e registrada em auditoria.');
      loadActiveTab();
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar meta futura.');
    }
  };

  const tabs: Array<{ id: ReportTabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'INDICADORES', label: 'Indicadores Operacionais', icon: Activity },
    { id: 'TURNOS', label: 'Relatórios de Turno', icon: ClipboardCheck },
    { id: 'RECEBIMENTOS', label: 'Recebimentos', icon: Truck },
    { id: 'ESTOQUE', label: 'Estoque & Posição Histórica', icon: Database },
    { id: 'TRANSFERENCIAS', label: 'Transferências', icon: Repeat },
    { id: 'CONSUMO', label: 'Consumo & Programação', icon: Layers },
    { id: 'DESEMPENHO', label: 'Desempenho & Metas', icon: Target },
    { id: 'RAZAO', label: 'Livro Razão', icon: History },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#F5B91B]/30 bg-[#F5B91B]/10 text-[#F5B91B]">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
              Central de Relatórios, Indicadores e Posição Histórica
            </h2>
            <p className="text-xs text-[#AEB8C5]">
              Dados reais integrados ao PostgreSQL (Fases 1–5) · Exportação auditada em PDF, XLSX e CSV
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadActiveTab}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 text-xs font-medium text-[#F4F6F8] hover:border-[#F5B91B]/50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          {canExport && (
            <>
              <button
                type="button"
                disabled={Boolean(exporting)}
                onClick={() => handleExport('PDF')}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-blue-400/35 bg-blue-500/15 px-3.5 text-xs font-semibold text-blue-200 hover:bg-blue-500/25 disabled:opacity-50"
              >
                <FileText className="h-4 w-4" />
                <span>{exporting === 'PDF' ? 'Gerando...' : 'Exportar PDF'}</span>
              </button>
              <button
                type="button"
                disabled={Boolean(exporting)}
                onClick={() => handleExport('XLSX')}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>{exporting === 'XLSX' ? 'Gerando...' : 'Exportar XLSX'}</span>
              </button>
              <button
                type="button"
                disabled={Boolean(exporting)}
                onClick={() => handleExport('CSV')}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#F5B91B] px-3.5 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                <span>{exporting === 'CSV' ? 'Gerando...' : 'Exportar CSV'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3.5 text-xs font-semibold transition-colors ${
                active
                  ? 'border-[#F5B91B] bg-[#F5B91B] text-[#0A1421]'
                  : 'border-[#AEB8C5]/20 bg-[#101B2A] text-[#AEB8C5] hover:text-[#F4F6F8]'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Global Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#AEB8C5]">Período</label>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as PeriodPreset)}
            className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
          >
            {PRESET_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {preset === 'PERSONALIZADO' && (
          <>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#AEB8C5]">Data inicial</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#AEB8C5]">Data final</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
              />
            </div>
          </>
        )}

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#AEB8C5]">Turno</label>
          <select
            value={shiftCode}
            onChange={(e) => setShiftCode(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
          >
            <option value="">Todos os turnos</option>
            <option value="TURNO_1">1º Turno</option>
            <option value="TURNO_2">2º Turno</option>
            <option value="TURNO_3">3º Turno</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#AEB8C5]">Matéria-Prima</label>
          <select
            value={materialId}
            onChange={(e) => setMaterialId(e.target.value)}
            className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
          >
            <option value="">Todas matérias-primas</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.description}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#AEB8C5]">Silo / Linha</label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={siloId}
              onChange={(e) => setSiloId(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-2 text-xs text-[#F4F6F8]"
            >
              <option value="">Todos silos</option>
              {silos.map((s) => (
                <option key={s.id} value={s.id}>
                  Silo {s.siloNumber}
                </option>
              ))}
            </select>
            <select
              value={lineCode}
              onChange={(e) => setLineCode(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-2 text-xs text-[#F4F6F8]"
            >
              <option value="">Todas linhas</option>
              {['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'].map((lc) => (
                <option key={lc} value={lc}>
                  {lc}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
          {error}
        </div>
      )}
      {statusMessage && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          {statusMessage}
        </div>
      )}

      {/* TAB GERENCIAL DE TURNOS */}
      {activeTab === 'TURNOS' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:grid-cols-2 lg:grid-cols-4">
            <input
              value={operatorFilter}
              onChange={(e) => setOperatorFilter(e.target.value)}
              placeholder="Filtrar por operador..."
              className="min-h-[42px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
            />
            <input
              value={badgeFilter}
              onChange={(e) => setBadgeFilter(e.target.value)}
              placeholder="Matrícula do operador..."
              className="min-h-[42px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
            />
            <select
              value={workflowFilter}
              onChange={(e) => setWorkflowFilter(e.target.value)}
              className="min-h-[42px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
            >
              <option value="">Todos os status do fluxo</option>
              <option value="EM_ELABORACAO">Em Elaboração</option>
              <option value="AGUARDANDO_CONFERENCIA">Aguardando Conferência</option>
              <option value="AGUARDANDO_APROVACAO">Aguardando Aprovação</option>
              <option value="APROVADO">Aprovado</option>
              <option value="ENCERRADO">Encerrado</option>
            </select>
            <input
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Busca livre (código, material, ocorrência)..."
              className="min-h-[42px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
            />
          </div>

          {shiftRep && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
                  <p className="text-[11px] uppercase text-[#AEB8C5]">Turnos Listados</p>
                  <p className="mt-1 font-mono-tabular text-xl font-bold text-[#F4F6F8]">
                    {shiftRep.totals.shiftsCount}
                  </p>
                </div>
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
                  <p className="text-[11px] uppercase text-[#AEB8C5]">Aprovados / Encerrados</p>
                  <p className="mt-1 font-mono-tabular text-xl font-bold text-emerald-400">
                    {shiftRep.totals.approvedOrClosedCount}
                  </p>
                </div>
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
                  <p className="text-[11px] uppercase text-[#AEB8C5]">Veículos Descarregados</p>
                  <p className="mt-1 font-mono-tabular text-xl font-bold text-[#F5B91B]">
                    {shiftRep.totals.totalUnloadedVehicles}
                  </p>
                  <p className="text-[11px] text-[#AEB8C5]">
                    +{shiftRep.totals.totalCarryoverFinalizedVehicles} turno anterior
                  </p>
                </div>
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
                  <p className="text-[11px] uppercase text-[#AEB8C5]">Recebido / Transferido</p>
                  <p className="mt-1 font-mono-tabular text-sm font-bold text-blue-300">
                    {formatKg(shiftRep.totals.totalReceivedKg)}
                  </p>
                  <p className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                    Transf.: {formatKg(shiftRep.totals.totalTransferredKg)}
                  </p>
                </div>
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
                  <p className="text-[11px] uppercase text-[#AEB8C5]">Pendências Abertas</p>
                  <p className="mt-1 font-mono-tabular text-xl font-bold text-amber-400">
                    {shiftRep.totals.totalOpenPendencies}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]">
                <table className="w-full min-w-[920px] text-left text-xs">
                  <thead className="border-b border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]">
                    <tr>
                      <th className="p-3 font-semibold">Código / Turno</th>
                      <th className="p-3 font-semibold">Operador (Matrícula)</th>
                      <th className="p-3 font-semibold text-right">Veículos</th>
                      <th className="p-3 font-semibold text-right">Recebido / Transf.</th>
                      <th className="p-3 font-semibold">Silos & Materiais</th>
                      <th className="p-3 font-semibold">Status</th>
                      <th className="p-3 font-semibold text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#AEB8C5]/10">
                    {shiftRep.rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-[#AEB8C5]">
                          Nenhum relatório de turno encontrado para os filtros aplicados.
                        </td>
                      </tr>
                    ) : (
                      shiftRep.rows.map((row) => (
                        <tr key={`${row.handoverCode}-${row.shiftCode}-${row.operationalDate}`} className="hover:bg-[#0A1421]/40">
                          <td className="p-3">
                            <div className="font-mono-tabular font-bold text-[#F5B91B]">{row.handoverCode}</div>
                            <div className="text-[#F4F6F8] font-semibold">
                              {row.shiftName} · {formatIsoDatePtBr(row.operationalDate)}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="text-[#F4F6F8]">{row.handoverByName}</div>
                            <div className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                              Mat.: {row.handoverByBadge || '—'} · Versão v{row.version}
                            </div>
                          </td>
                          <td className="p-3 text-right font-mono-tabular">
                            <div className="font-bold text-emerald-400">{row.unloadedVehiclesCount} do turno</div>
                            {row.carryoverVehiclesCount > 0 && (
                              <div className="text-[11px] text-blue-300">+{row.carryoverVehiclesCount} anterior</div>
                            )}
                          </td>
                          <td className="p-3 text-right font-mono-tabular">
                            <div className="text-[#F4F6F8]">{formatKg(row.receivedKg)}</div>
                            <div className="text-[11px] text-[#AEB8C5]">Transf.: {formatKg(row.transferredKg)}</div>
                          </td>
                          <td className="p-3 text-[11px] text-[#AEB8C5]">
                            <div>
                              Silos: {row.silosUsed.length > 0 ? row.silosUsed.map((s) => `S${s}`).join(', ') : '—'}
                            </div>
                            <div className="truncate max-w-[220px]">
                              MP: {row.materialsMoved.length > 0 ? row.materialsMoved.join(', ') : '—'}
                            </div>
                          </td>
                          <td className="p-3">
                            <span
                              className={`font-bold ${
                                row.workflowStatus === 'ENCERRADO' || row.workflowStatus === 'APROVADO'
                                  ? 'text-emerald-400'
                                  : row.workflowStatus === 'AGUARDANDO_APROVACAO'
                                    ? 'text-[#F5B91B]'
                                    : 'text-blue-300'
                              }`}
                            >
                              {row.workflowStatus}
                            </span>
                            {row.approvedByName && (
                              <div className="text-[11px] text-[#AEB8C5]">Aprov.: {row.approvedByName}</div>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={() => setPreviewShiftRow(row)}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#F5B91B]/40 bg-[#0A1421] px-3 text-xs font-bold text-[#F5B91B] hover:border-[#F5B91B]"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Visualizar Documento</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {previewShiftRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[#F5B91B]/40 bg-[#101B2A] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#AEB8C5]/15 pb-3">
              <div>
                <p className="font-mono-tabular text-xs font-bold text-[#F5B91B]">
                  {previewShiftRow.handoverCode} · {previewShiftRow.workflowStatus} · v{previewShiftRow.version}
                </p>
                <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                  {previewShiftRow.shiftName} — {formatIsoDatePtBr(previewShiftRow.operationalDate)}
                </h3>
              </div>
              <div className="flex gap-2">
                {canExport && (
                  <button
                    type="button"
                    onClick={() =>
                      handleExport('PDF', 'TURNO', {
                        shiftCode: previewShiftRow.shiftCode,
                        operationalDate: previewShiftRow.operationalDate,
                      })
                    }
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#F5B91B] px-3.5 text-xs font-extrabold text-[#0A1421]"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Exportar PDF</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewShiftRow(null)}
                  className="min-h-[38px] rounded-lg border border-[#AEB8C5]/25 px-3 text-xs text-[#AEB8C5]"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3 text-xs sm:grid-cols-3">
              <div>
                <span className="text-[#AEB8C5]">Responsável:</span>{' '}
                <strong className="text-[#F4F6F8]">
                  {previewShiftRow.handoverByName}
                  {previewShiftRow.handoverByBadge ? ` (Mat. ${previewShiftRow.handoverByBadge})` : ''}
                </strong>
              </div>
              <div>
                <span className="text-[#AEB8C5]">Silos:</span>{' '}
                <strong className="text-[#F4F6F8]">
                  {previewShiftRow.silosUsed.length > 0
                    ? previewShiftRow.silosUsed.map((s) => `Silo ${s}`).join(', ')
                    : 'Nenhum'}
                </strong>
              </div>
              <div>
                <span className="text-[#AEB8C5]">Materiais:</span>{' '}
                <strong className="text-[#F4F6F8]">
                  {previewShiftRow.materialsMoved.length > 0
                    ? previewShiftRow.materialsMoved.join(', ')
                    : 'Nenhum'}
                </strong>
              </div>
            </div>

            <pre className="whitespace-pre-wrap rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-4 font-mono-tabular text-xs leading-relaxed text-[#F4F6F8]">
              {previewShiftRow.reportText}
            </pre>
          </div>
        </div>
      )}

      {/* TAB 1: INDICADORES OPERACIONAIS */}
      {activeTab === 'INDICADORES' && overview && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#AEB8C5]">
            <span>
              Período: <strong className="text-[#F4F6F8]">{overview.periodLabel}</strong>
            </span>
            <span>
              Origem: <strong className="text-[#F4F6F8]">{overview.dataOrigin}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Estoque Real Total', value: formatKg(overview.indicators.totalConfirmedStockKg), sub: `${overview.indicators.registeredMaterialsCount} matérias-primas ativas`, accent: 'text-[#F5B91B]' },
              { label: 'Silos Ocupados / Disponíveis', value: `${overview.indicators.occupiedSilosCount} / ${overview.indicators.availableSilosCount}`, sub: `De ${overview.indicators.totalSilosCount} silos filtrados`, accent: 'text-blue-400' },
              { label: 'Recebimentos no Período', value: formatKg(overview.indicators.receivedVolumeKg), sub: `${overview.indicators.completedReceiptsCount} concluído(s)`, accent: 'text-emerald-400' },
              { label: 'Transferências Concluídas', value: formatKg(overview.indicators.transferredVolumeKg), sub: `${overview.indicators.transfersCompletedCount} ordem(ns) finalizada(s)`, accent: 'text-emerald-400' },
              { label: 'Descargas Parciais Pendentes', value: String(overview.indicators.pendingPartialDischargesCount), sub: 'Aguardando complemento em silo', accent: overview.indicators.pendingPartialDischargesCount > 0 ? 'text-amber-400' : 'text-[#F4F6F8]' },
              { label: 'Solicitações de Abastecimento', value: String(overview.indicators.pendingSupplyRequestsCount), sub: 'Pedidos de compra/recebimento abertos', accent: 'text-orange-400' },
              { label: 'Alertas Ativos & Materiais em Risco', value: `${overview.indicators.activeAlertsCount} / ${overview.indicators.atRiskMaterialsCount} MP`, sub: 'Recomendações + pendências documentais', accent: overview.indicators.atRiskMaterialsCount > 0 ? 'text-red-400' : 'text-[#F4F6F8]' },
              { label: 'Ocorrências Abertas / Programações', value: `${overview.indicators.openOccurrencesCount} / ${overview.indicators.importedSchedulesCount}`, sub: 'Ocorrências em aberto e programações no período', accent: 'text-[#F4F6F8]' },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#AEB8C5]">
                  {card.label}
                </p>
                <p className={`mt-2 font-mono-tabular text-2xl font-bold ${card.accent}`}>{card.value}</p>
                <p className="mt-1 text-xs text-[#AEB8C5]/80">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Snapshot history */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <h3 className="mb-3 font-display text-sm font-bold text-[#F4F6F8]">
              Últimas Versões e Exportações de Relatórios (Auditadas)
            </h3>
            {overview.recentSnapshots.length === 0 ? (
              <p className="text-xs text-[#AEB8C5]">
                Nenhuma exportação registrada ainda. Use os botões PDF, XLSX ou CSV acima para gerar a primeira versão auditável.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#AEB8C5]/15 text-[#AEB8C5]">
                    <tr>
                      <th className="p-2">Código</th>
                      <th className="p-2">Relatório</th>
                      <th className="p-2">Formato</th>
                      <th className="p-2">Período</th>
                      <th className="p-2">Responsável</th>
                      <th className="p-2">Gerado em</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#AEB8C5]/10">
                    {overview.recentSnapshots.map((s) => (
                      <tr key={s.id}>
                        <td className="p-2 font-mono-tabular text-[#F5B91B]">{s.snapshotCode}</td>
                        <td className="p-2 text-[#F4F6F8]">
                          {s.title} <span className="text-[#AEB8C5]">(v{s.version})</span>
                        </td>
                        <td className="p-2 font-mono-tabular font-bold text-blue-300">{s.format}</td>
                        <td className="p-2 font-mono-tabular text-[#AEB8C5]">
                          {s.periodStart || '-'} a {s.periodEnd || '-'}
                        </td>
                        <td className="p-2 text-[#AEB8C5]">{s.generatedByName}</td>
                        <td className="p-2 font-mono-tabular text-[#AEB8C5]">
                          {new Date(s.createdAt).toLocaleString('pt-BR')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: RECEBIMENTOS */}
      {activeTab === 'RECEBIMENTOS' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:grid-cols-4">
            <input
              type="text"
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              placeholder="Filtrar fornecedor..."
              className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
            />
            <input
              type="text"
              value={lotFilter}
              onChange={(e) => setLotFilter(e.target.value)}
              placeholder="Filtrar lote..."
              className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
            />
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]">
              <input
                type="checkbox"
                checked={onlyPartial}
                onChange={(e) => setOnlyPartial(e.target.checked)}
              />
              <span>Somente descargas parciais</span>
            </label>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]">
              <input
                type="checkbox"
                checked={onlyPending}
                onChange={(e) => setOnlyPending(e.target.checked)}
              />
              <span>Somente pendentes de descarga</span>
            </label>
          </div>

          {receivingRep && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                  <p className="text-[11px] text-[#AEB8C5]">Quantidade Recebida</p>
                  <p className="mt-1 font-mono-tabular text-lg font-bold text-[#F4F6F8]">
                    {formatKg(receivingRep.totals.receivedKg)}
                  </p>
                </div>
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                  <p className="text-[11px] text-[#AEB8C5]">Quantidade Descarregada</p>
                  <p className="mt-1 font-mono-tabular text-lg font-bold text-emerald-400">
                    {formatKg(receivingRep.totals.distributedKg)}
                  </p>
                </div>
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                  <p className="text-[11px] text-[#AEB8C5]">Saldo Pendente de Descarga</p>
                  <p className="mt-1 font-mono-tabular text-lg font-bold text-amber-400">
                    {formatKg(receivingRep.totals.pendingKg)}
                  </p>
                </div>
                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                  <p className="text-[11px] text-[#AEB8C5]">Recebimentos ({receivingRep.totals.count})</p>
                  <p className="mt-1 font-mono-tabular text-xs text-[#F4F6F8]">
                    {receivingRep.totals.completedCount} concl. · {receivingRep.totals.partialCount} parc. ·{' '}
                    {receivingRep.totals.pendingCount} pend.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]">
                <table className="w-full min-w-[960px] text-left text-xs">
                  <thead className="border-b border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]">
                    <tr>
                      <th className="p-3">Nº / Data Op.</th>
                      <th className="p-3">Fornecedor / NF</th>
                      <th className="p-3">Matéria-Prima / Lote</th>
                      <th className="p-3">Tipo</th>
                      <th className="p-3 text-right">Recebido</th>
                      <th className="p-3 text-right">Descarregado</th>
                      <th className="p-3 text-right">Pendente</th>
                      <th className="p-3">Silos Destino</th>
                      <th className="p-3">Operador / Turno</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#AEB8C5]/10">
                    {receivingRep.rows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-8 text-center text-[#AEB8C5]">
                          Nenhum recebimento encontrado para os filtros informados.
                        </td>
                      </tr>
                    ) : (
                      receivingRep.rows.map((r) => (
                        <tr key={r.id} className="hover:bg-[#0A1421]/40">
                          <td className="p-3 font-mono-tabular">
                            <div className="font-bold text-[#F4F6F8]">{r.receiptNumber}</div>
                            <div className="text-[11px] text-[#AEB8C5]">{r.operationalDate}</div>
                          </td>
                          <td className="p-3">
                            <div className="text-[#F4F6F8]">{r.supplierName}</div>
                            <div className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                              NF {r.invoiceNumber || 'Não informada'}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="text-[#F4F6F8]">
                              <span className="font-mono-tabular text-[#AEB8C5]">{r.materialCode}</span> ·{' '}
                              {r.materialDescription}
                            </div>
                            <div className="font-mono-tabular text-[11px] text-[#F5B91B]">Lote: {r.lotCode}</div>
                          </td>
                          <td className="p-3 text-[#AEB8C5]">
                            <div>{r.receivingType}</div>
                            {r.bagCount && (
                              <div className="font-mono-tabular text-[11px]">
                                {r.bagCount} bags ({r.bagUnitWeightKg || '-'} kg)
                              </div>
                            )}
                          </td>
                          <td className="p-3 text-right font-mono-tabular font-bold text-[#F4F6F8]">
                            {formatKg(r.receivedQuantityKg)}
                          </td>
                          <td className="p-3 text-right font-mono-tabular font-bold text-emerald-400">
                            {formatKg(r.distributedQuantityKg)}
                          </td>
                          <td className="p-3 text-right font-mono-tabular font-bold text-amber-400">
                            {formatKg(r.pendingQuantityKg)}
                          </td>
                          <td className="p-3 text-[#F4F6F8]">{r.destinationSilosText}</td>
                          <td className="p-3 text-[#AEB8C5]">
                            <div>{r.operatorName}</div>
                            <div className="font-mono-tabular text-[11px]">{r.shiftCode}</div>
                          </td>
                          <td className="p-3 font-bold">
                            <span
                              className={
                                r.status === 'CONCLUIDO'
                                  ? 'text-emerald-400'
                                  : r.status === 'PARCIAL'
                                    ? 'text-amber-400'
                                    : 'text-blue-400'
                              }
                            >
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: ESTOQUE & POSIÇÃO HISTÓRICA */}
      {activeTab === 'ESTOQUE' && stockRep && (
        <div className="space-y-5">
          {/* Consulta de Posição Histórica */}
          <div className="rounded-xl border border-[#F5B91B]/30 bg-[#101B2A] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Calendar className="h-5 w-5 text-[#F5B91B]" />
                <div>
                  <h3 className="font-display text-sm font-bold text-[#F4F6F8]">
                    Consulta de Posição Histórica de Estoque (Reconstruída do Livro Razão)
                  </h3>
                  <p className="text-xs text-[#AEB8C5]">
                    {stockRep.historicalTotals.note}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={historicalDate}
                  onChange={(e) => setHistoricalDate(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                />
                <select
                  value={cutoffMode}
                  onChange={(e) => setCutoffMode(e.target.value as any)}
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                >
                  <option value="OPERATIONAL_DATE">Corte por Data Operacional</option>
                  <option value="TIMESTAMP">Corte por Timestamp Real</option>
                </select>
                {canExport && (
                  <button
                    type="button"
                    onClick={() => handleExport('PDF', 'POSICAO_HISTORICA')}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#F5B91B] px-3.5 text-xs font-extrabold text-[#0A1421]"
                  >
                    <Download className="h-4 w-4" />
                    <span>Exportar Posição Histórica</span>
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421]">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="border-b border-[#AEB8C5]/15 text-[#AEB8C5]">
                  <tr>
                    <th className="p-2.5">Silo / Linha</th>
                    <th className="p-2.5">Grupo</th>
                    <th className="p-2.5">Matéria-Prima</th>
                    <th className="p-2.5">Lote</th>
                    <th className="p-2.5 text-right">Saldo Reconstruído na Data</th>
                    <th className="p-2.5 text-right">Movs. até a Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#AEB8C5]/10">
                  {stockRep.historicalRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-[#AEB8C5]">
                        Nenhuma movimentação registrada no livro razão até {historicalDate}. Saldo histórico: 0 kg.
                      </td>
                    </tr>
                  ) : (
                    stockRep.historicalRows.map((hr, idx) => (
                      <tr key={`${hr.siloId}-${hr.materialId}-${hr.lotCode}-${idx}`}>
                        <td className="p-2.5 font-mono-tabular font-bold text-[#F4F6F8]">
                          Silo {hr.siloNumber} ({hr.lineCode})
                        </td>
                        <td className="p-2.5 text-[#AEB8C5]">{hr.category}</td>
                        <td className="p-2.5 text-[#F4F6F8]">
                          <span className="font-mono-tabular text-[#AEB8C5]">{hr.materialCode}</span> ·{' '}
                          {hr.materialDescription}
                        </td>
                        <td className="p-2.5 font-mono-tabular text-[#F5B91B]">{hr.lotCode}</td>
                        <td className="p-2.5 text-right font-mono-tabular font-bold text-emerald-400">
                          {formatKg(hr.historicalBalanceKg)}
                        </td>
                        <td className="p-2.5 text-right font-mono-tabular text-[#AEB8C5]">
                          {hr.movementCountUpToDate}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Posição Atual Completa */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold text-[#F4F6F8]">
                Posição Atual por Silo, Lotes e Movimentações no Período
              </h3>
              <div className="flex flex-wrap gap-4 font-mono-tabular text-xs">
                <span className="text-[#F5B91B]">
                  Saldo Atual: {formatKg(stockRep.currentTotals.totalConfirmedStockKg)}
                </span>
                <span className="text-emerald-400">
                  Entradas Período: {formatKg(stockRep.currentTotals.inboundPeriodKg)}
                </span>
                <span className="text-blue-400">
                  Transferências: {formatKg(stockRep.currentTotals.transfersPeriodKg)}
                </span>
                <span className="text-[#AEB8C5]">
                  Espaço Livre: {formatKg(stockRep.currentTotals.totalFreeSpaceKg)}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="border-b border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]">
                  <tr>
                    <th className="p-2.5">Silo</th>
                    <th className="p-2.5">Linha / Grupo</th>
                    <th className="p-2.5">Material</th>
                    <th className="p-2.5">Lotes Ativos</th>
                    <th className="p-2.5 text-right">Saldo Real</th>
                    <th className="p-2.5 text-right">Cap. Segura</th>
                    <th className="p-2.5 text-right">Ocup. %</th>
                    <th className="p-2.5 text-right">Espaço Livre</th>
                    <th className="p-2.5 text-right">Entradas Per.</th>
                    <th className="p-2.5">Última Mov.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#AEB8C5]/10">
                  {stockRep.currentRows.map((row) => (
                    <tr key={row.siloId} className="hover:bg-[#0A1421]/40">
                      <td className="p-2.5 font-mono-tabular font-bold text-[#F4F6F8]">
                        Silo {row.siloNumber}
                      </td>
                      <td className="p-2.5 text-[#AEB8C5]">
                        {row.lineCode} · {row.category}
                      </td>
                      <td className="p-2.5 text-[#F4F6F8]">
                        {row.materialCode ? `${row.materialCode} — ${row.materialDescription}` : 'Sem MP principal'}
                      </td>
                      <td className="p-2.5 font-mono-tabular text-[11px] text-[#F5B91B]">
                        {row.activeLotsText}
                      </td>
                      <td className="p-2.5 text-right font-mono-tabular font-bold text-[#F4F6F8]">
                        {formatKg(row.confirmedStockKg)}
                      </td>
                      <td className="p-2.5 text-right font-mono-tabular text-[#AEB8C5]">
                        {formatKg(row.safeCapacityKg)}
                      </td>
                      <td className="p-2.5 text-right font-mono-tabular text-[#F4F6F8]">
                        {row.occupancyPercent}%
                      </td>
                      <td className="p-2.5 text-right font-mono-tabular text-emerald-400">
                        {formatKg(row.availableSpaceKg)}
                      </td>
                      <td className="p-2.5 text-right font-mono-tabular text-blue-300">
                        {formatKg(row.inboundPeriodKg)}
                      </td>
                      <td className="p-2.5 font-mono-tabular text-[11px] text-[#AEB8C5]">
                        {row.lastMovementAt ? new Date(row.lastMovementAt).toLocaleString('pt-BR') : 'Sem registro'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: TRANSFERÊNCIAS */}
      {activeTab === 'TRANSFERENCIAS' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <select
              value={transferStatus}
              onChange={(e) => setTransferStatus(e.target.value)}
              className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
            >
              <option value="">Todos os status de transferência</option>
              <option value="CONCLUIDA">Concluídas</option>
              <option value="PARCIAL">Parciais</option>
              <option value="INTERROMPIDA">Interrompidas</option>
              <option value="PLANEJADA">Planejadas / Abertas</option>
              <option value="EM_ANDAMENTO">Em andamento</option>
              <option value="CANCELADA">Canceladas</option>
            </select>

            {transfersRep && (
              <div className="flex flex-wrap gap-4 font-mono-tabular text-xs">
                <span className="text-emerald-400">Concluídas: {transfersRep.totals.completedCount}</span>
                <span className="text-amber-400">Parciais: {transfersRep.totals.partialCount}</span>
                <span className="text-red-400">Interrompidas: {transfersRep.totals.interruptedCount}</span>
                <span className="text-blue-400">Abertas: {transfersRep.totals.openCount}</span>
                <span className="text-[#F5B91B]">
                  Realizado: {formatKg(transfersRep.totals.transferredKg)} /{' '}
                  {formatKg(transfersRep.totals.plannedKg)}
                </span>
              </div>
            )}
          </div>

          {transfersRep && (
            <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]">
              <table className="w-full min-w-[960px] text-left text-xs">
                <thead className="border-b border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]">
                  <tr>
                    <th className="p-3">Ordem / Data</th>
                    <th className="p-3">Origem → Destino</th>
                    <th className="p-3">Matéria-Prima / Lote</th>
                    <th className="p-3 text-right">Planejado</th>
                    <th className="p-3 text-right">Realizado</th>
                    <th className="p-3 text-right">Pendente</th>
                    <th className="p-3">Operador / Turno</th>
                    <th className="p-3">Status / Justificativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#AEB8C5]/10">
                  {transfersRep.rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-[#AEB8C5]">
                        Nenhuma transferência encontrada para os filtros informados.
                      </td>
                    </tr>
                  ) : (
                    transfersRep.rows.map((t) => (
                      <tr key={t.id} className="hover:bg-[#0A1421]/40">
                        <td className="p-3 font-mono-tabular">
                          <div className="font-bold text-[#F4F6F8]">{t.orderCode}</div>
                          <div className="text-[11px] text-[#AEB8C5]">{t.operationalDate}</div>
                        </td>
                        <td className="p-3 font-mono-tabular font-bold text-[#F4F6F8]">
                          Silo {t.originSiloNumber} → Silo {t.destinationSiloNumber}
                          {t.lineCode && (
                            <div className="text-[11px] font-normal text-[#AEB8C5]">Linha {t.lineCode}</div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="text-[#F4F6F8]">
                            {t.materialCode} · {t.materialDescription}
                          </div>
                          <div className="font-mono-tabular text-[11px] text-[#F5B91B]">
                            Lote: {t.lotCode || 'Não informado'}
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono-tabular text-[#F4F6F8]">
                          {formatKg(t.plannedQuantityKg)}
                        </td>
                        <td className="p-3 text-right font-mono-tabular font-bold text-emerald-400">
                          {formatKg(t.transferredQuantityKg)}
                        </td>
                        <td className="p-3 text-right font-mono-tabular text-amber-400">
                          {formatKg(t.pendingQuantityKg)}
                        </td>
                        <td className="p-3 text-[#AEB8C5]">
                          <div>{t.operatorName}</div>
                          <div className="font-mono-tabular text-[11px]">{t.shiftCode}</div>
                        </td>
                        <td className="p-3">
                          <div
                            className={`font-bold ${
                              t.status === 'CONCLUIDA'
                                ? 'text-emerald-400'
                                : t.status === 'INTERROMPIDA' || t.status === 'CANCELADA'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                            }`}
                          >
                            {t.status}
                          </div>
                          {(t.interruptionReason || t.notes) && (
                            <div className="text-[11px] text-[#AEB8C5]">
                              {t.interruptionReason || t.notes}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: CONSUMO & PROGRAMAÇÃO */}
      {activeTab === 'CONSUMO' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs text-[#F4F6F8]">
              <input
                type="checkbox"
                checked={onlyPendingComparison}
                onChange={(e) => setOnlyPendingComparison(e.target.checked)}
              />
              <span>Somente itens com fator pendente ou sem consumo realizado informado</span>
            </label>

            {consumptionRep && (
              <div className="flex flex-wrap gap-4 font-mono-tabular text-xs">
                <span className="text-blue-300">
                  Previsto: {formatKg(consumptionRep.totals.plannedConsumptionKg)}
                </span>
                <span className="text-emerald-400">
                  Realizado:{' '}
                  {consumptionRep.totals.realizedConsumptionKg !== null
                    ? formatKg(consumptionRep.totals.realizedConsumptionKg)
                    : 'Não informado'}
                </span>
                <span className="text-amber-400">
                  Diferença:{' '}
                  {consumptionRep.totals.varianceKg !== null
                    ? formatKg(consumptionRep.totals.varianceKg)
                    : 'Aguardando realizado'}
                </span>
              </div>
            )}
          </div>

          {consumptionRep && (
            <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="border-b border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]">
                  <tr>
                    <th className="p-3">Programação / Rev.</th>
                    <th className="p-3">Data / Linha</th>
                    <th className="p-3">Produto / Matéria-Prima</th>
                    <th className="p-3 text-right">Previsto</th>
                    <th className="p-3 text-right">Realizado</th>
                    <th className="p-3 text-right">Diferença</th>
                    <th className="p-3 text-right">Estoque Real</th>
                    <th className="p-3 text-right">Saldo Projetado</th>
                    <th className="p-3">Origem / Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#AEB8C5]/10">
                  {consumptionRep.rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-[#AEB8C5]">
                        Nenhum registro de programação/consumo encontrado para o período.
                      </td>
                    </tr>
                  ) : (
                    consumptionRep.rows.map((c) => (
                      <tr key={c.projectionId} className="hover:bg-[#0A1421]/40">
                        <td className="p-3 font-mono-tabular">
                          <div className="font-bold text-[#F4F6F8]">{c.scheduleCode}</div>
                          <div className="text-[11px] text-[#AEB8C5]">Rev. {c.revisionNumber}</div>
                        </td>
                        <td className="p-3 font-mono-tabular text-[#AEB8C5]">
                          <div>{c.referenceDate}</div>
                          <div className="font-bold text-[#F5B91B]">{c.lineCode}</div>
                        </td>
                        <td className="p-3">
                          <div className="text-[#F4F6F8]">
                            {c.productCode} — {c.productDescription}
                          </div>
                          <div className="text-[11px] text-[#AEB8C5]">
                            MP: {c.materialCode || 'N/I'} {c.materialDescription || ''}
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono-tabular font-bold text-blue-300">
                          {formatKg(c.plannedConsumptionKg)}
                        </td>
                        <td className="p-3 text-right font-mono-tabular">
                          {c.realizedConsumptionKg !== null ? (
                            <span className="font-bold text-emerald-400">
                              {formatKg(c.realizedConsumptionKg)}
                            </span>
                          ) : (
                            <span className="text-[#AEB8C5]">Não informado</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono-tabular">
                          {c.varianceKg !== null ? (
                            <span className={c.varianceKg > 0 ? 'text-red-400' : 'text-emerald-400'}>
                              {c.varianceKg > 0 ? '+' : ''}
                              {formatKg(c.varianceKg)}
                            </span>
                          ) : (
                            <span className="text-[#AEB8C5]">—</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono-tabular text-[#F4F6F8]">
                          {formatKg(c.realStockKg)}
                        </td>
                        <td
                          className={`p-3 text-right font-mono-tabular font-bold ${
                            c.projectedBalanceKg < 0 ? 'text-red-400' : 'text-emerald-400'
                          }`}
                        >
                          {formatKg(c.projectedBalanceKg)}
                        </td>
                        <td className="p-3 text-[11px] text-[#AEB8C5]">
                          <div>{c.originSource}</div>
                          <div>{c.executionStatus}</div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 6: DESEMPENHO & METAS FUTURAS */}
      {activeTab === 'DESEMPENHO' && overview && (
        <div className="space-y-5">
          <div className="rounded-xl border border-blue-400/25 bg-blue-500/10 p-4 text-xs text-blue-100 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-blue-300 mt-0.5" />
            <div>
              <p className="font-bold">Transparência de Medição Real</p>
              <p className="mt-0.5 text-blue-200/90">
                {overview.performanceKpis.historicalBaselineNotice}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
              <p className="text-[11px] uppercase text-[#AEB8C5]">Volume Recebido / Distribuído</p>
              <p className="mt-2 font-mono-tabular text-xl font-bold text-[#F4F6F8]">
                {formatKg(overview.performanceKpis.receivedVolumeKg)}
              </p>
              <p className="mt-1 text-xs text-emerald-400">
                Distribuído: {formatKg(overview.performanceKpis.distributedVolumeKg)} (
                {overview.performanceKpis.receiptsCount} recebimentos)
              </p>
            </div>

            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
              <p className="text-[11px] uppercase text-[#AEB8C5]">Tempo Médio de Recebimento</p>
              <p className="mt-2 font-mono-tabular text-xl font-bold text-[#F5B91B]">
                {overview.performanceKpis.avgReceiptDurationMinutes !== null
                  ? `${overview.performanceKpis.avgReceiptDurationMinutes} min`
                  : 'Dado não informado'}
              </p>
              <p className="mt-1 text-xs text-[#AEB8C5]">
                {overview.performanceKpis.avgReceiptDurationNote}
              </p>
            </div>

            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
              <p className="text-[11px] uppercase text-[#AEB8C5]">Frequência de Ocorrências & Divergências</p>
              <p className="mt-2 font-mono-tabular text-xl font-bold text-amber-400">
                {overview.performanceKpis.occurrencesCount} ocorr. / {overview.performanceKpis.divergencesFrequency} diverg.
              </p>
              <p className="mt-1 text-xs text-[#AEB8C5]">
                Alertas de falta ativos: {overview.performanceKpis.shortageAlertsFrequency}
              </p>
            </div>

            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
              <p className="text-[11px] uppercase text-[#AEB8C5]">Previsto vs Realizado (Consumo)</p>
              <p className="mt-2 font-mono-tabular text-xl font-bold text-blue-300">
                {overview.performanceKpis.consumptionVarianceKg !== null
                  ? formatKg(overview.performanceKpis.consumptionVarianceKg)
                  : 'Sem realizado'}
              </p>
              <p className="mt-1 text-xs text-[#AEB8C5]">
                {overview.performanceKpis.consumptionComparisonNote}
              </p>
            </div>
          </div>

          {/* Metas Futuras Configuráveis */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-bold text-[#F4F6F8]">
                  Metas Futuras Configuráveis pela Administração
                </h3>
                <p className="text-xs text-[#AEB8C5]">
                  Objetivos operacionais futuros mantidos separados das medições históricas reais.
                </p>
              </div>
              {canManageTargets && (
                <button
                  type="button"
                  onClick={() => setShowTargetForm(!showTargetForm)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 text-xs font-extrabold text-[#0A1421]"
                >
                  <Plus className="h-4 w-4" />
                  <span>{showTargetForm ? 'Cancelar' : 'Nova Meta Futura'}</span>
                </button>
              )}
            </div>

            {showTargetForm && canManageTargets && (
              <form
                onSubmit={handleCreateTarget}
                className="grid grid-cols-1 gap-3 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-4 sm:grid-cols-3"
              >
                <input
                  required
                  value={targetCode}
                  onChange={(e) => setTargetCode(e.target.value.toUpperCase())}
                  placeholder="Código (ex.: META_TEMPO_REC)"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                />
                <input
                  required
                  value={targetLabel}
                  onChange={(e) => setTargetLabel(e.target.value)}
                  placeholder="Descrição da meta futura"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                />
                <select
                  value={targetMetricKey}
                  onChange={(e) => setTargetMetricKey(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                >
                  <option value="TEMPO_MEDIO_RECEBIMENTO_MIN">Tempo médio de recebimento (min)</option>
                  <option value="DESCARGAS_PARCIAIS_MAX">Máximo descargas parciais</option>
                  <option value="OCORRENCIAS_ABERTAS_MAX">Máximo ocorrências abertas</option>
                  <option value="ADERENCIA_PROGRAMACAO_PCT">Aderência à programação (%)</option>
                </select>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  placeholder="Valor alvo"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                />
                <input
                  required
                  value={targetUnit}
                  onChange={(e) => setTargetUnit(e.target.value)}
                  placeholder="Unidade (min, kg, %)"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                />
                <select
                  value={targetPeriod}
                  onChange={(e) => setTargetPeriod(e.target.value as any)}
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                >
                  <option value="DIARIO">Meta Diária</option>
                  <option value="SEMANAL">Meta Semanal</option>
                  <option value="MENSAL">Meta Mensal</option>
                </select>
                <input
                  value={targetNotes}
                  onChange={(e) => setTargetNotes(e.target.value)}
                  placeholder="Observações / premissas..."
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8] sm:col-span-2"
                />
                <button
                  type="submit"
                  className="min-h-[44px] rounded-lg bg-emerald-500 px-4 text-xs font-bold text-[#0A1421]"
                >
                  Salvar Meta Futura
                </button>
              </form>
            )}

            {overview.futureTargets.length === 0 ? (
              <p className="text-xs text-[#AEB8C5]">
                Nenhuma meta futura configurada até o momento pela Administração.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {overview.futureTargets.map((t) => (
                  <div key={t.id} className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
                    <div className="flex items-center justify-between text-[11px] text-[#AEB8C5]">
                      <span className="font-mono-tabular text-[#F5B91B]">{t.code}</span>
                      <span>{t.targetPeriod}</span>
                    </div>
                    <p className="mt-1 font-semibold text-sm text-[#F4F6F8]">{t.label}</p>
                    <p className="mt-1 font-mono-tabular text-lg font-bold text-emerald-400">
                      {t.targetValue} {t.unit}
                    </p>
                    <p className="mt-1 text-[11px] text-[#AEB8C5]">
                      Vigência: {t.effectiveFromDate} · Configurado por {t.updatedByName || 'Admin'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 7: LIVRO RAZÃO (Preservado da Fase 2) */}
      {activeTab === 'RAZAO' && (
        <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="border-b border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]">
              <tr>
                <th className="p-3 font-semibold">Data / Turno</th>
                <th className="p-3 font-semibold">Tipo</th>
                <th className="p-3 font-semibold">Silo</th>
                <th className="p-3 font-semibold">Matéria-Prima</th>
                <th className="p-3 font-semibold">Lote</th>
                <th className="p-3 font-semibold text-right">Quantidade</th>
                <th className="p-3 font-semibold">Operador</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#AEB8C5]/10">
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-[#AEB8C5]">
                    Nenhuma movimentação encontrada para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                movements.map((m) => (
                  <tr key={m.id} className="hover:bg-[#0A1421]/40">
                    <td className="p-3 font-mono-tabular text-[#AEB8C5]">
                      <div>{m.operationalDate}</div>
                      <div className="text-[11px]">{m.shiftCode}</div>
                    </td>
                    <td className="p-3 font-semibold text-[#F4F6F8]">
                      {m.movementType}
                      {m.referenceDocument && (
                        <div className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                          {m.referenceDocument}
                        </div>
                      )}
                    </td>
                    <td className="p-3 font-mono-tabular font-bold text-[#F4F6F8]">
                      Silo {m.siloNumber}
                    </td>
                    <td className="p-3 text-[#F4F6F8]">
                      <span className="font-mono-tabular text-[#AEB8C5]">{m.materialCode}</span> ·{' '}
                      {m.materialDescription}
                    </td>
                    <td className="p-3 font-mono-tabular text-[#F5B91B]">{m.lotCode || '—'}</td>
                    <td
                      className={`p-3 text-right font-mono-tabular font-bold ${
                        m.direction === 'CREDIT' ? 'text-emerald-400' : 'text-orange-400'
                      }`}
                    >
                      {m.direction === 'CREDIT' ? '+' : '-'}
                      {formatKg(m.quantityKg)}
                    </td>
                    <td className="p-3 text-[#AEB8C5]">{m.operatorName}</td>
                    <td className="p-3">
                      <span
                        className={`font-bold ${
                          m.status === 'ESTORNADO' ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
