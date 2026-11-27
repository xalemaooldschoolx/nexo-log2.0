import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Compass,
  ListChecks,
  OctagonAlert,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import {
  InventoryMovementItem,
  MaterialItem,
  SessionData,
  SiloDetail,
  SiloLedgerDetails,
  TransferOrderItem,
  TransferPlanDraftPrefill,
  TransferRuleItem,
} from '../types/nexo.ts';
import { apiFetch, formatKg } from '../lib/api.ts';
import { ExperienceMode } from '../lib/experience-modes.ts';

interface TransfersPageProps {
  session?: SessionData;
  silos: SiloDetail[];
  materials: MaterialItem[];
  transferRules: TransferRuleItem[];
  canExecuteTransfers: boolean;
  canPlanTransfers: boolean;
  canAdjustStock: boolean;
  experienceMode?: ExperienceMode;
  prefillPlan?: TransferPlanDraftPrefill | null;
  onClearPrefill?: () => void;
  onReloadWorkspace: () => Promise<void>;
}

const ORDER_STATUS_STYLE: Record<string, string> = {
  PLANEJADA: 'border-blue-400/45 bg-blue-500/15 text-blue-200',
  EM_ANDAMENTO: 'border-[#F5B817]/50 bg-[#F5B817]/15 text-[#F5B817]',
  PARCIAL: 'border-orange-500/45 bg-orange-500/15 text-orange-300',
  CONCLUIDA: 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300',
  INTERROMPIDA: 'border-red-500/45 bg-red-500/15 text-red-300',
  CANCELADA: 'border-slate-500/45 bg-slate-500/15 text-slate-300',
};

export const TransfersPage: React.FC<TransfersPageProps> = ({
  session,
  silos,
  materials,
  transferRules,
  canExecuteTransfers,
  canPlanTransfers,
  canAdjustStock,
  experienceMode = 'OPERACIONAL',
  prefillPlan,
  onClearPrefill,
  onReloadWorkspace,
}) => {
  const [guidedMode, setGuidedMode] = useState(experienceMode === 'OPERACIONAL' && !prefillPlan);
  const [guidedStep, setGuidedStep] = useState<number>(0);
  const [guidedMoreInfoOpen, setGuidedMoreInfoOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'ordens' | 'direta' | 'ledger'>('ordens');

  // Planned Transfer Order Form (Phase 4)
  const [planRuleId, setPlanRuleId] = useState<string>('');
  const [planQtyKg, setPlanQtyKg] = useState('');
  const [planLotCode, setPlanLotCode] = useState('');
  const [planPriority, setPlanPriority] = useState<'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA'>('ALTA');
  const [planNotes, setPlanNotes] = useState('');
  const [planRecId, setPlanRecId] = useState<number | null>(null);
  const [planRecKey, setPlanRecKey] = useState<string | null>(null);
  const [reviewOrderModalOpen, setReviewOrderModalOpen] = useState(false);

  // Orders & Execution State
  const [orders, setOrders] = useState<TransferOrderItem[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('ATIVAS');
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [stepModalOrder, setStepModalOrder] = useState<TransferOrderItem | null>(null);
  const [stepOriginLots, setStepOriginLots] = useState<SiloLedgerDetails['activeLots']>([]);
  const [stepQtyKg, setStepQtyKg] = useState('');
  const [stepPreferredLot, setStepPreferredLot] = useState('');
  const [stepNotes, setStepNotes] = useState('');

  const [interruptModalOrder, setInterruptModalOrder] = useState<TransferOrderItem | null>(null);
  const [interruptReason, setInterruptReason] = useState('');

  // Phase 2 Direct Transfer Form
  const [selectedRuleId, setSelectedRuleId] = useState<string>('');
  const [quantityKg, setQuantityKg] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [reason, setReason] = useState('');
  const [executedByOther, setExecutedByOther] = useState(false);
  const [executedByName, setExecutedByName] = useState('');
  const [executedByBadge, setExecutedByBadge] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Recent movements for reversal / audit
  const [movements, setMovements] = useState<InventoryMovementItem[]>([]);
  const [reversingId, setReversingId] = useState<number | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  // Authorized Stock Adjustment (ADMIN / SUPERVISOR)
  const [adjSiloId, setAdjSiloId] = useState<string>('');
  const [adjMaterialId, setAdjMaterialId] = useState<string>('');
  const [adjDeltaKg, setAdjDeltaKg] = useState('');
  const [adjLotCode, setAdjLotCode] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjSubmitting, setAdjSubmitting] = useState(false);

  const loadOrdersAndMovements = useCallback(async () => {
    const tasks: Promise<void>[] = [];
    tasks.push(
      apiFetch<TransferOrderItem[]>('/api/transfer-orders')
        .then((list) => setOrders(list))
        .catch(() => {})
    );
    tasks.push(
      apiFetch<InventoryMovementItem[]>('/api/movements')
        .then((list) => setMovements(list.slice(0, 30)))
        .catch(() => {})
    );
    await Promise.all(tasks);
  }, []);

  useEffect(() => {
    loadOrdersAndMovements();
  }, [loadOrdersAndMovements]);

  const activeRules = useMemo(
    () =>
      transferRules.filter(
        (r) =>
          r.isActive &&
          (r.authorizationStatus === 'AUTORIZADA' || r.validationStatus === 'VALIDADO')
      ),
    [transferRules]
  );

  const blockedRules = useMemo(
    () =>
      transferRules.filter(
        (r) =>
          !r.isActive ||
          (r.authorizationStatus !== 'AUTORIZADA' && r.validationStatus !== 'VALIDADO')
      ),
    [transferRules]
  );

  useEffect(() => {
    if (!prefillPlan && experienceMode !== 'OPERACIONAL') {
      setGuidedMode(false);
    }
  }, [experienceMode, prefillPlan]);

  // Handle prefill coming from SupplyCenterPage ("CRIAR SOLICITAÇÃO DE TRANSFERÊNCIA")
  useEffect(() => {
    if (!prefillPlan) return;
    setGuidedMode(false);
    setActiveTab('ordens');
    const match =
      activeRules.find((r) => r.id === prefillPlan.transferRuleId) ||
      activeRules.find(
        (r) =>
          r.originSiloId === prefillPlan.originSiloId &&
          r.destinationSiloId === prefillPlan.destinationSiloId &&
          r.materialId === prefillPlan.materialId
      );
    if (match) setPlanRuleId(String(match.id));
    setPlanQtyKg(String(prefillPlan.plannedQuantityKg));
    setPlanLotCode(prefillPlan.lotCode || '');
    setPlanPriority(prefillPlan.priority || 'ALTA');
    setPlanNotes(prefillPlan.notes || '');
    setPlanRecId(prefillPlan.recommendationId ?? null);
    setPlanRecKey(prefillPlan.recommendationKey ?? null);
    if (match) setReviewOrderModalOpen(true);
  }, [prefillPlan, activeRules]);

  const selectedPlanRule = useMemo(
    () => activeRules.find((r) => String(r.id) === planRuleId) || null,
    [activeRules, planRuleId]
  );
  const planOriginSilo = useMemo(
    () => silos.find((s) => s.id === selectedPlanRule?.originSiloId) || null,
    [silos, selectedPlanRule]
  );
  const planDestSilo = useMemo(
    () => silos.find((s) => s.id === selectedPlanRule?.destinationSiloId) || null,
    [silos, selectedPlanRule]
  );

  const selectedRule = useMemo(
    () => activeRules.find((r) => String(r.id) === selectedRuleId) || null,
    [activeRules, selectedRuleId]
  );
  const originSilo = useMemo(
    () => silos.find((s) => s.id === selectedRule?.originSiloId) || null,
    [silos, selectedRule]
  );
  const destinationSilo = useMemo(
    () => silos.find((s) => s.id === selectedRule?.destinationSiloId) || null,
    [silos, selectedRule]
  );

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (orderStatusFilter === 'ATIVAS') {
        return ['PLANEJADA', 'EM_ANDAMENTO', 'PARCIAL'].includes(o.status);
      }
      if (orderStatusFilter === 'TODAS') return true;
      return o.status === orderStatusFilter;
    });
  }, [orders, orderStatusFilter]);

  const handleOpenReviewOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanRule || !Number(planQtyKg)) return;
    setError(null);
    setReviewOrderModalOpen(true);
  };

  const handleConfirmCreateOrder = async () => {
    if (!selectedPlanRule || !canPlanTransfers) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await apiFetch<{ orderCode: string }>('/api/transfer-orders', {
        method: 'POST',
        body: JSON.stringify({
          transferRuleId: selectedPlanRule.id,
          originSiloId: selectedPlanRule.originSiloId,
          destinationSiloId: selectedPlanRule.destinationSiloId,
          materialId: selectedPlanRule.materialId,
          plannedQuantityKg: Number(planQtyKg),
          lotCode: planLotCode || null,
          priority: planPriority,
          recommendationId: planRecId,
          recommendationKey: planRecKey,
          notes: planNotes || null,
          idempotencyKey: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        }),
      });
      setSuccess(
        `Solicitação de Transferência ${created.orderCode} criada em status PLANEJADA (nenhum saldo físico alterado até execução).`
      );
      setReviewOrderModalOpen(false);
      setPlanQtyKg('');
      setPlanLotCode('');
      setPlanNotes('');
      setPlanRecId(null);
      setPlanRecKey(null);
      onClearPrefill?.();
      await Promise.all([onReloadWorkspace(), loadOrdersAndMovements()]);
    } catch (err: any) {
      setError(err.message || 'Erro ao criar solicitação de transferência.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartOrder = async (order: TransferOrderItem) => {
    if (!canExecuteTransfers) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/transfer-orders/${order.id}/start`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Início operacional registrado pelo operador' }),
      });
      setSuccess(`Ordem ${order.orderCode} iniciada (EM_ANDAMENTO).`);
      await loadOrdersAndMovements();
    } catch (err: any) {
      setError(err.message || 'Erro ao registrar início da transferência.');
    } finally {
      setSubmitting(false);
    }
  };

  const openStepExecutionModal = async (order: TransferOrderItem) => {
    setStepModalOrder(order);
    setStepQtyKg(String(order.remainingQuantityKg));
    setStepPreferredLot(order.lotCode && !order.lotCode.startsWith('MISTO') ? order.lotCode : '');
    setStepNotes('');
    try {
      const ledger = await apiFetch<SiloLedgerDetails>(`/api/silos/${order.originSiloId}/ledger`);
      setStepOriginLots(ledger.activeLots);
    } catch {
      setStepOriginLots([]);
    }
  };

  const handleConfirmExecuteStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepModalOrder || !canExecuteTransfers) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch<{ remainingQuantityKg: number; order: { orderCode: string; status: string } }>(
        `/api/transfer-orders/${stepModalOrder.id}/execute-step`,
        {
          method: 'POST',
          body: JSON.stringify({
            quantityKg: Number(stepQtyKg),
            expectedVersion: stepModalOrder.version,
            preferredLotCode: stepPreferredLot || null,
            notes: stepNotes || null,
            executedByName: executedByOther ? executedByName.trim() || null : null,
            executedByBadge: executedByOther ? executedByBadge.trim() || null : null,
            idempotencyKey: `step-${stepModalOrder.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          }),
        }
      );
      setSuccess(
        `Movimentação confirmada na ordem ${res.order.orderCode} (${res.order.status}). Saldo pendente restante: ${formatKg(res.remainingQuantityKg)}.`
      );
      setStepModalOrder(null);
      setExecutedByOther(false);
      setExecutedByName('');
      setExecutedByBadge('');
      await Promise.all([onReloadWorkspace(), loadOrdersAndMovements()]);
    } catch (err: any) {
      setError(err.message || 'Falha ao confirmar etapa de transferência.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmInterruptOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interruptModalOrder || !canExecuteTransfers) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/transfer-orders/${interruptModalOrder.id}/interrupt`, {
        method: 'POST',
        body: JSON.stringify({ reason: interruptReason }),
      });
      setSuccess(`Ordem ${interruptModalOrder.orderCode} interrompida com motivo auditado.`);
      setInterruptModalOrder(null);
      setInterruptReason('');
      await Promise.all([onReloadWorkspace(), loadOrdersAndMovements()]);
    } catch (err: any) {
      setError(err.message || 'Erro ao interromper ordem.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRule || !canExecuteTransfers) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiFetch<{ referenceDocument: string }>('/api/transfers/execute', {
        method: 'POST',
        body: JSON.stringify({
          originSiloId: selectedRule.originSiloId,
          destinationSiloId: selectedRule.destinationSiloId,
          materialId: selectedRule.materialId,
          quantityKg: Number(quantityKg),
          lotCode: lotCode || null,
          reason: reason || null,
          executedByName: executedByOther ? executedByName.trim() || null : null,
          executedByBadge: executedByOther ? executedByBadge.trim() || null : null,
          idempotencyKey: `trf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        }),
      });
      setSuccess(
        `Transferência direta ${res.referenceDocument} executada atomicamente: Silo ${selectedRule.originSiloNumber} → Silo ${selectedRule.destinationSiloNumber} (${formatKg(Number(quantityKg))}).`
      );
      setQuantityKg('');
      setLotCode('');
      setReason('');
      setExecutedByOther(false);
      setExecutedByName('');
      setExecutedByBadge('');
      await Promise.all([onReloadWorkspace(), loadOrdersAndMovements()]);
    } catch (err: any) {
      setError(err.message || 'Falha ao executar transferência.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverseMovement = async (id: number) => {
    if (reverseReason.trim().length < 5) {
      setError('Informe motivo com no mínimo 5 caracteres para estornar a movimentação.');
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/movements/${id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reverseReason.trim() }),
      });
      setSuccess(`Movimentação #${id} estornada com registro de auditoria.`);
      setReversingId(null);
      setReverseReason('');
      await Promise.all([onReloadWorkspace(), loadOrdersAndMovements()]);
    } catch (err: any) {
      setError(err.message || 'Erro ao estornar movimentação.');
    }
  };

  const handleAuthorizedAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdjustStock) return;
    setAdjSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/stock/adjust', {
        method: 'POST',
        body: JSON.stringify({
          siloId: Number(adjSiloId),
          materialId: Number(adjMaterialId),
          lotCode: adjLotCode || null,
          deltaKg: Number(adjDeltaKg),
          reason: adjReason,
          executedByName: executedByOther ? executedByName.trim() || null : null,
          executedByBadge: executedByOther ? executedByBadge.trim() || null : null,
        }),
      });
      setSuccess('Ajuste autorizado registrado no livro razão e na auditoria.');
      setAdjDeltaKg('');
      setAdjLotCode('');
      setAdjReason('');
      setExecutedByOther(false);
      setExecutedByName('');
      setExecutedByBadge('');
      await Promise.all([onReloadWorkspace(), loadOrdersAndMovements()]);
    } catch (err: any) {
      setError(err.message || 'Erro ao registrar ajuste autorizado.');
    } finally {
      setAdjSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#3B82F6]/35 bg-[#3B82F6]/15 text-[#60A5FA]">
              <Repeat className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#F5B817]">
                TRANSFERÊNCIAS PLANEJADAS, EXECUÇÃO PARCIAL, RASTREIO DE LOTE & ESTORNOS
              </p>
              <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
                Operação de Transferências entre Silos Homologados
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setGuidedMode(true)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 text-xs font-bold ${
                guidedMode
                  ? 'bg-[#F5B817] text-[#081321]'
                  : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#F4F6F8] hover:border-[#F5B817]/50'
              }`}
            >
              <Compass className="h-4 w-4" />
              <span>Fluxo Guiado</span>
            </button>
            <button
              type="button"
              onClick={() => setGuidedMode(false)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-4 text-xs font-bold ${
                !guidedMode
                  ? 'bg-[#3B82F6] text-white'
                  : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5] hover:border-[#F5B817]/50'
              }`}
            >
              <ListChecks className="h-4 w-4" />
              <span>Visão Completa</span>
            </button>
          </div>
        </div>

        {!guidedMode && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[#AEB8C5]/10 pt-4">
            <button
              type="button"
              onClick={() => setActiveTab('ordens')}
              className={`min-h-[44px] rounded-lg px-4 text-xs font-bold ${
                activeTab === 'ordens'
                  ? 'bg-[#F5B817] text-[#081321]'
                  : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5]'
              }`}
            >
              Ordens & Execução Parcial ({orders.filter((o) => ['PLANEJADA', 'EM_ANDAMENTO', 'PARCIAL'].includes(o.status)).length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('direta')}
              className={`min-h-[44px] rounded-lg px-4 text-xs font-bold ${
                activeTab === 'direta'
                  ? 'bg-[#F5B817] text-[#081321]'
                  : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5]'
              }`}
            >
              Transferência Direta Rápida
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={`min-h-[44px] rounded-lg px-4 text-xs font-bold ${
                activeTab === 'ledger'
                  ? 'bg-[#F5B817] text-[#081321]'
                  : 'border border-[#AEB8C5]/20 bg-[#081321] text-[#AEB8C5]'
              }`}
            >
              Livro Razão & Ajustes ({movements.length})
            </button>
          </div>
        )}
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

      {/* MODO GUIADO DE TRANSFERÊNCIAS (PASSO A PASSO) */}
      {guidedMode && (
        <div className="space-y-5">
          {/* Ordens aguardando execução do operador aparecem no topo em destaque simples */}
          {orders.filter((o) => ['PLANEJADA', 'EM_ANDAMENTO', 'PARCIAL'].includes(o.status)).length > 0 && (
            <div className="rounded-xl border border-[#F5B817]/35 bg-[#102235] p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                  Ordens de Transferência Pendentes para Você Executar
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setGuidedMode(false);
                    setActiveTab('ordens');
                  }}
                  className="text-xs font-bold text-[#F5B817] underline"
                >
                  Ver todas na Visão Completa
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {orders
                  .filter((o) => ['PLANEJADA', 'EM_ANDAMENTO', 'PARCIAL'].includes(o.status))
                  .slice(0, 4)
                  .map((ord) => (
                    <div
                      key={ord.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#AEB8C5]/20 bg-[#081321] p-4"
                    >
                      <div>
                        <p className="font-mono-tabular text-sm font-extrabold text-[#F5B817]">
                          Silo {ord.originSiloNumber} → Silo {ord.destinationSiloNumber}
                        </p>
                        <p className="text-xs font-semibold text-[#F4F6F8]">
                          {ord.materialCode} — {ord.materialDescription}
                        </p>
                        <p className="mt-1 text-xs text-[#AEB8C5]">
                          Falta transferir:{' '}
                          <strong className="font-mono-tabular text-[#F4F6F8]">
                            {formatKg(ord.remainingQuantityKg)}
                          </strong>
                        </p>
                      </div>
                      {canExecuteTransfers && (
                        <button
                          type="button"
                          onClick={() => openStepExecutionModal(ord)}
                          className="min-h-[46px] rounded-xl bg-emerald-600 px-4 text-xs font-extrabold text-white hover:bg-emerald-500"
                        >
                          TRANSFERIR AGORA
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Barra de progresso do fluxo guiado em 3 etapas */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#AEB8C5]/10 pb-4">
              <div>
                <p className="text-xs font-bold text-[#F5B817]">
                  PASSO {guidedStep + 1} DE 3
                </p>
                <h3 className="font-display text-lg font-extrabold text-[#F4F6F8]">
                  {guidedStep === 0
                    ? '1. ESCOLHER CAMINHO AUTORIZADO ENTRE SILOS'
                    : guidedStep === 1
                      ? '2. INFORMAR QUANTOS QUILOS VÃO SER TRANSFERIDOS'
                      : '3. CONFERIR E CONFIRMAR A TRANSFERÊNCIA'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {[0, 1, 2].map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={idx > 0 && !selectedRule}
                    onClick={() => setGuidedStep(idx)}
                    className={`h-3 w-12 rounded-full transition-colors ${
                      idx === guidedStep
                        ? 'bg-[#F5B817]'
                        : idx < guidedStep
                          ? 'bg-emerald-500'
                          : 'bg-[#081321] border border-[#AEB8C5]/25'
                    }`}
                    aria-label={`Etapa ${idx + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* PASSO 1: ESCOLHER ROTA */}
            {guidedStep === 0 && (
              <div className="space-y-4">
                <p className="text-sm text-[#AEB8C5]">
                  Toque em uma das rotas liberadas abaixo. O sistema só permite caminhos compatíveis e seguros.
                </p>

                {activeRules.length === 0 ? (
                  <div className="rounded-xl border border-[#F5B817]/30 bg-[#081321] p-6 text-center text-sm text-[#AEB8C5]">
                    Nenhuma rota autorizada cadastrada no momento.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {activeRules.map((r) => {
                      const orig = silos.find((s) => s.id === r.originSiloId);
                      const dest = silos.find((s) => s.id === r.destinationSiloId);
                      const selected = String(r.id) === selectedRuleId;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            setSelectedRuleId(String(r.id));
                            setPlanRuleId(String(r.id));
                            setError(null);
                          }}
                          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all ${
                            selected
                              ? 'border-[#F5B817] bg-[#F5B817]/15'
                              : 'border-[#AEB8C5]/20 bg-[#081321] hover:border-[#F5B817]/60'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono-tabular text-base font-extrabold text-[#F5B817]">
                                Silo {r.originSiloNumber} → Silo {r.destinationSiloNumber}
                              </span>
                              {selected && (
                                <CheckCircle2 className="h-5 w-5 text-[#F5B817]" />
                              )}
                            </div>
                            <p className="mt-1 text-sm font-bold text-[#F4F6F8]">
                              {r.materialCode} — {r.materialDescription}
                            </p>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#AEB8C5]/10 pt-2 text-xs">
                            <div>
                              <span className="block text-[11px] text-[#AEB8C5]">Tem na Origem</span>
                              <strong className="font-mono-tabular text-[#F4F6F8]">
                                {orig ? formatKg(orig.confirmedStockKg) : '—'}
                              </strong>
                            </div>
                            <div>
                              <span className="block text-[11px] text-[#AEB8C5]">Cabe no Destino</span>
                              <strong className="font-mono-tabular text-emerald-400">
                                {dest ? formatKg(dest.availableSpaceKg) : '—'}
                              </strong>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {blockedRules.length > 0 && (
                  <p className="text-xs text-[#AEB8C5]">
                    Existem {blockedRules.length} rotas bloqueadas ou pendentes de aprovação (visíveis em Visão Completa).
                  </p>
                )}
              </div>
            )}

            {/* PASSO 2: QUANTIDADE */}
            {guidedStep === 1 && selectedRule && originSilo && destinationSilo && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[#AEB8C5]/20 bg-[#081321] p-4">
                    <p className="text-xs text-[#AEB8C5]">Sai do Silo {originSilo.siloNumber}</p>
                    <p className="mt-1 font-mono-tabular text-xl font-extrabold text-[#F4F6F8]">
                      Disponível: {formatKg(originSilo.confirmedStockKg)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#AEB8C5]/20 bg-[#081321] p-4">
                    <p className="text-xs text-[#AEB8C5]">Vai para o Silo {destinationSilo.siloNumber}</p>
                    <p className="mt-1 font-mono-tabular text-xl font-extrabold text-emerald-400">
                      Espaço Livre Seguro: {formatKg(destinationSilo.availableSpaceKg)}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-bold text-[#F4F6F8]">
                    Quantos quilos (kg) você quer transferir? *
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={quantityKg}
                    onChange={(e) => {
                      setQuantityKg(e.target.value);
                      setPlanQtyKg(e.target.value);
                    }}
                    placeholder="Ex.: 5000"
                    className="min-h-[54px] w-full rounded-xl border border-[#AEB8C5]/30 bg-[#081321] px-4 font-mono-tabular text-xl font-extrabold text-[#F4F6F8]"
                  />

                  <div className="mt-2 flex flex-wrap gap-2">
                    {[1000, 2500, 5000, 10000].map((preset) => {
                      const maxAllowed = Math.min(
                        originSilo.confirmedStockKg,
                        destinationSilo.availableSpaceKg
                      );
                      if (preset > maxAllowed) return null;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setQuantityKg(String(preset));
                            setPlanQtyKg(String(preset));
                          }}
                          className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B817]"
                        >
                          {formatKg(preset)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#081321] p-3">
                  <button
                    type="button"
                    onClick={() => setGuidedMoreInfoOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between text-xs font-bold text-[#AEB8C5]"
                  >
                    <span>Mais informações (Lote e Observação — Opcional)</span>
                    {guidedMoreInfoOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {guidedMoreInfoOpen && (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs text-[#AEB8C5]">Lote Específico</label>
                          <input
                            type="text"
                            value={lotCode}
                            onChange={(e) => {
                              const val = e.target.value.toUpperCase();
                              setLotCode(val);
                              setPlanLotCode(val);
                            }}
                            placeholder="Opcional — mantém lote da origem"
                            className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#102235] px-3 text-sm text-[#F4F6F8]"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-[#AEB8C5]">Observação</label>
                          <input
                            type="text"
                            value={reason}
                            onChange={(e) => {
                              setReason(e.target.value);
                              setPlanNotes(e.target.value);
                            }}
                            placeholder="Ex.: Abastecimento do turno"
                            className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#102235] px-3 text-sm text-[#F4F6F8]"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#102235] px-3 text-xs text-[#F4F6F8]">
                          <input
                            type="checkbox"
                            checked={executedByOther}
                            onChange={(e) => setExecutedByOther(e.target.checked)}
                            className="h-4 w-4 accent-[#F5B817]"
                          />
                          <span>Executado por outro operador</span>
                        </label>
                        {executedByOther && (
                          <>
                            <input
                              type="text"
                              value={executedByName}
                              onChange={(e) => setExecutedByName(e.target.value)}
                              placeholder="Nome do executor"
                              className="min-h-[40px] rounded-lg border border-[#F5B817]/40 bg-[#102235] px-3 text-xs text-[#F4F6F8]"
                            />
                            <input
                              type="text"
                              value={executedByBadge}
                              onChange={(e) => setExecutedByBadge(e.target.value)}
                              placeholder="Matrícula"
                              className="min-h-[40px] w-28 rounded-lg border border-[#F5B817]/40 bg-[#102235] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                            />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PASSO 3: REVISAR E CONFIRMAR */}
            {guidedStep === 2 && selectedRule && originSilo && destinationSilo && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#F5B817]/40 bg-[#081321] p-5 space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-[#AEB8C5]">Caminho</p>
                      <p className="mt-1 font-mono-tabular text-lg font-extrabold text-[#F5B817]">
                        Silo {originSilo.siloNumber} → Silo {destinationSilo.siloNumber}
                      </p>
                      <p className="text-xs text-[#F4F6F8]">
                        {selectedRule.materialCode} — {selectedRule.materialDescription}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[#AEB8C5]">Quantidade a Mover</p>
                      <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-emerald-400">
                        {formatKg(Number(quantityKg || 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[#AEB8C5]">Como Vão Ficar os Silos</p>
                      <p className="mt-1 font-mono-tabular text-xs text-[#F4F6F8]">
                        Silo {originSilo.siloNumber}:{' '}
                        <strong>
                          {formatKg(Math.max(0, originSilo.confirmedStockKg - Number(quantityKg || 0)))}
                        </strong>
                      </p>
                      <p className="font-mono-tabular text-xs text-emerald-300">
                        Silo {destinationSilo.siloNumber}:{' '}
                        <strong>
                          {formatKg(destinationSilo.confirmedStockKg + Number(quantityKg || 0))}
                        </strong>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  {canPlanTransfers && !canExecuteTransfers && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setPlanRuleId(String(selectedRule.id));
                        setPlanQtyKg(quantityKg);
                        void handleConfirmCreateOrder();
                      }}
                      className="inline-flex min-h-[52px] items-center gap-2 rounded-xl bg-[#F5B817] px-6 text-sm font-extrabold text-[#081321] hover:bg-[#F5B817]/90 disabled:opacity-50"
                    >
                      <ClipboardCheck className="h-5 w-5" />
                      <span>{submitting ? 'Gravando...' : 'ENVIAR SOLICITAÇÃO DE TRANSFERÊNCIA'}</span>
                    </button>
                  )}

                  {canExecuteTransfers && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={(e) => {
                        void handleExecuteTransfer(e as any);
                      }}
                      className="inline-flex min-h-[52px] items-center gap-2 rounded-xl bg-emerald-600 px-6 text-sm font-extrabold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-5 w-5" />
                      <span>{submitting ? 'Transferindo...' : 'CONFIRMAR TRANSFERÊNCIA AGORA'}</span>
                    </button>
                  )}

                  {!canExecuteTransfers && !canPlanTransfers && (
                    <p className="text-xs text-[#AEB8C5]">
                      Seu perfil é somente de consulta para transferências.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Barra de Navegação Guiada */}
            <div className="flex items-center justify-between gap-4 border-t border-[#AEB8C5]/10 pt-4">
              <button
                type="button"
                disabled={guidedStep === 0}
                onClick={() => {
                  setError(null);
                  setGuidedStep((prev) => Math.max(0, prev - 1));
                }}
                className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-[#AEB8C5]/25 bg-[#081321] px-5 text-sm font-bold text-[#F4F6F8] hover:border-[#F5B817] disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>VOLTAR</span>
              </button>

              {guidedStep < 2 && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    if (guidedStep === 0) {
                      if (!selectedRule) {
                        setError('Escolha primeiro uma rota autorizada na lista acima.');
                        return;
                      }
                      setGuidedStep(1);
                      return;
                    }
                    if (guidedStep === 1) {
                      const qty = Number(quantityKg);
                      if (!Number.isFinite(qty) || qty <= 0) {
                        setError('Informe uma quantidade válida maior que zero.');
                        return;
                      }
                      if (originSilo && qty > originSilo.confirmedStockKg + 0.001) {
                        setError(
                          `O Silo ${originSilo.siloNumber} só tem ${formatKg(originSilo.confirmedStockKg)} disponível.`
                        );
                        return;
                      }
                      if (destinationSilo && qty > destinationSilo.availableSpaceKg + 0.001) {
                        setError(
                          `O Silo ${destinationSilo.siloNumber} só tem espaço seguro para ${formatKg(destinationSilo.availableSpaceKg)}.`
                        );
                        return;
                      }
                      setGuidedStep(2);
                    }
                  }}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#F5B817] px-6 text-sm font-extrabold text-[#081321] hover:bg-[#F5B817]/90"
                >
                  <span>CONTINUAR</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: ORDENS PLANEJADAS & EXECUÇÃO PARCIAL (FASE 4) */}
      {!guidedMode && activeTab === 'ordens' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Criar Solicitação / Ordem Planejada */}
            <form
              onSubmit={handleOpenReviewOrder}
              className="space-y-4 rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 lg:col-span-7"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Plus className="h-5 w-5 text-[#F5B817]" />
                  <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                    Nova Solicitação de Transferência (Com Revisão Obrigatória)
                  </h3>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Rota Autorizada *
                </label>
                <select
                  required
                  disabled={!canPlanTransfers}
                  value={planRuleId}
                  onChange={(e) => setPlanRuleId(e.target.value)}
                  className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-[#F4F6F8]"
                >
                  <option value="">Selecione uma rota AUTORIZADA...</option>
                  {activeRules.map((r) => (
                    <option key={r.id} value={r.id}>
                      Silo {r.originSiloNumber} → Silo {r.destinationSiloNumber} · {r.materialCode} —{' '}
                      {r.materialDescription}
                    </option>
                  ))}
                </select>
              </div>

              {planOriginSilo && planDestSilo && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-[#AEB8C5]/20 bg-[#081321] p-3 text-xs">
                    <p className="text-[#AEB8C5]">Origem: Silo {planOriginSilo.siloNumber}</p>
                    <p className="mt-1 font-mono-tabular text-base font-bold text-[#F4F6F8]">
                      Saldo Físico: {formatKg(planOriginSilo.confirmedStockKg)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[#AEB8C5]/20 bg-[#081321] p-3 text-xs">
                    <p className="text-[#AEB8C5]">Destino: Silo {planDestSilo.siloNumber}</p>
                    <p className="mt-1 font-mono-tabular text-base font-bold text-emerald-400">
                      Espaço Seguro (-10%): {formatKg(planDestSilo.availableSpaceKg)}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                    Qtd. Planejada (kg) *
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    required
                    disabled={!canPlanTransfers}
                    value={planQtyKg}
                    onChange={(e) => setPlanQtyKg(e.target.value)}
                    placeholder="Ex.: 20000"
                    className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                    Lote Preferencial (Opcional)
                  </label>
                  <input
                    type="text"
                    disabled={!canPlanTransfers}
                    value={planLotCode}
                    onChange={(e) => setPlanLotCode(e.target.value.toUpperCase())}
                    placeholder="Auto / Preserva origem"
                    className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                    Prioridade
                  </label>
                  <select
                    disabled={!canPlanTransfers}
                    value={planPriority}
                    onChange={(e) => setPlanPriority(e.target.value as any)}
                    className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs font-bold text-[#F4F6F8]"
                  >
                    <option value="CRITICA">CRÍTICA</option>
                    <option value="ALTA">ALTA</option>
                    <option value="MEDIA">MÉDIA</option>
                    <option value="BAIXA">BAIXA</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Observação / Destino Operacional
                </label>
                <input
                  type="text"
                  disabled={!canPlanTransfers}
                  value={planNotes}
                  onChange={(e) => setPlanNotes(e.target.value)}
                  placeholder="Ex.: Abastecimento programado do turno para Linha 4"
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-[#F4F6F8]"
                />
              </div>

              <button
                type="submit"
                disabled={!canPlanTransfers || !selectedPlanRule}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#F5B817] px-5 py-2.5 text-sm font-extrabold text-[#081321] hover:bg-[#F5B817]/90 disabled:opacity-50"
              >
                <ClipboardCheck className="h-4 w-4" />
                <span>Revisar e Criar Solicitação de Transferência</span>
              </button>
            </form>

            {/* Rotas Não Autorizadas / Bloqueadas */}
            <div className="space-y-3 rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 lg:col-span-5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[#F5B817]" />
                <h3 className="font-display text-sm font-bold text-[#F4F6F8]">
                  Rotas Bloqueadas / Pendentes / Suspensas ({blockedRules.length})
                </h3>
              </div>
              <p className="text-xs text-[#AEB8C5]">
                Estas rotas são exibidas com motivo de bloqueio e não podem ser executadas até autorização em Abastecimento & Rotas.
              </p>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {blockedRules.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-red-500/25 bg-[#081321] p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono-tabular font-bold text-[#F5B817]">
                        Silo {r.originSiloNumber} → Silo {r.destinationSiloNumber}
                      </p>
                      <span className="rounded border border-red-500/35 bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">
                        {r.authorizationStatus || r.validationStatus}
                      </span>
                    </div>
                    <p className="text-[#F4F6F8]">
                      {r.materialCode} — {r.materialDescription}
                    </p>
                    {r.sourceReference && (
                      <p className="mt-0.5 text-[11px] text-[#AEB8C5]">{r.sourceReference}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Lista de Ordens Planejadas, Em Andamento, Parciais e Concluídas */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Ordens de Transferência ({filteredOrders.length})
              </h3>
              <select
                value={orderStatusFilter}
                onChange={(e) => setOrderStatusFilter(e.target.value)}
                className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs font-semibold text-[#F4F6F8]"
              >
                <option value="ATIVAS">Em Aberto (Planejada / Em Andamento / Parcial)</option>
                <option value="TODAS">Todas as Ordens</option>
                <option value="CONCLUIDA">Concluídas</option>
                <option value="INTERROMPIDA">Interrompidas</option>
              </select>
            </div>

            {filteredOrders.length === 0 ? (
              <p className="text-xs text-[#AEB8C5]">
                Nenhuma ordem encontrada neste filtro. Crie uma solicitação acima ou a partir do Painel de Abastecimento.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((ord) => {
                  const pct =
                    ord.plannedQuantityKg > 0
                      ? Math.min(100, Math.round((ord.transferredQuantityKg / ord.plannedQuantityKg) * 100))
                      : 0;
                  const isOpen = ['PLANEJADA', 'EM_ANDAMENTO', 'PARCIAL'].includes(ord.status);
                  return (
                    <div
                      key={ord.id}
                      className="rounded-xl border border-[#AEB8C5]/20 bg-[#081321] p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono-tabular text-sm font-extrabold text-[#F5B817]">
                              {ord.orderCode}
                            </span>
                            <span
                              className={`rounded border px-2 py-0.5 text-[11px] font-bold ${
                                ORDER_STATUS_STYLE[ord.status] || ''
                              }`}
                            >
                              {ord.status}
                            </span>
                            <span className="font-mono-tabular text-xs font-bold text-[#F4F6F8]">
                              Silo {ord.originSiloNumber} → Silo {ord.destinationSiloNumber}
                            </span>
                            {ord.lineCode && (
                              <span className="rounded bg-orange-500/15 px-2 py-0.5 text-[11px] font-bold text-orange-300">
                                {ord.lineCode}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-semibold text-[#F4F6F8]">
                            {ord.materialCode} — {ord.materialDescription}
                            {ord.lotCode ? ` · Lote(s): ${ord.lotCode}` : ''}
                          </p>
                          <p className="text-[11px] text-[#AEB8C5]">
                            Solicitado por: {ord.requestedByName} · Turno {ord.shiftCode} ({ord.operationalDate})
                            {ord.assignedOperatorName ? ` · Operador: ${ord.assignedOperatorName}` : ''}
                          </p>
                          {ord.interruptionReason && (
                            <p className="text-[11px] font-semibold text-red-300">
                              Interrompida por {ord.interruptedByName}: {ord.interruptionReason}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {canExecuteTransfers && ord.status === 'PLANEJADA' && (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => handleStartOrder(ord)}
                              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#F5B817]/50 bg-[#F5B817]/15 px-3 text-xs font-bold text-[#F5B817] hover:bg-[#F5B817]/25"
                            >
                              <Play className="h-3.5 w-3.5" />
                              <span>Registrar Início</span>
                            </button>
                          )}

                          {canExecuteTransfers && isOpen && ord.remainingQuantityKg > 0 && (
                            <button
                              type="button"
                              onClick={() => openStepExecutionModal(ord)}
                              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-bold text-white hover:bg-emerald-500"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Executar Etapa (Parcial/Final)</span>
                            </button>
                          )}

                          {canExecuteTransfers && isOpen && (
                            <button
                              type="button"
                              onClick={() => {
                                setInterruptModalOrder(ord);
                                setInterruptReason('');
                              }}
                              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-red-500/40 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/15"
                            >
                              <OctagonAlert className="h-3.5 w-3.5" />
                              <span>Interromper</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              setExpandedOrderId(expandedOrderId === ord.id ? null : ord.id)
                            }
                            className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 px-3 text-xs text-[#AEB8C5]"
                          >
                            <span>Etapas ({ord.steps.length})</span>
                            {expandedOrderId === ord.id ? (
                              <ChevronUp className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between font-mono-tabular text-xs">
                          <span className="text-[#AEB8C5]">
                            Transferido: <strong className="text-emerald-400">{formatKg(ord.transferredQuantityKg)}</strong> /{' '}
                            {formatKg(ord.plannedQuantityKg)} ({pct}%)
                          </span>
                          <span className="font-bold text-[#F5B817]">
                            Pendente: {formatKg(ord.remainingQuantityKg)}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[#102235]">
                          <div
                            className={`h-full transition-all ${
                              ord.status === 'CONCLUIDA'
                                ? 'bg-emerald-500'
                                : ord.status === 'INTERROMPIDA'
                                  ? 'bg-red-500'
                                  : 'bg-[#F5B817]'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>

                      {/* Steps & Lot Composition History */}
                      {expandedOrderId === ord.id && (
                        <div className="border-t border-[#AEB8C5]/15 pt-3 space-y-2">
                          <p className="text-[11px] font-bold text-[#F5B817]">
                            Histórico de Etapas & Rastreabilidade de Lotes
                          </p>
                          {ord.steps.length === 0 ? (
                            <p className="text-[11px] text-[#AEB8C5]">
                              Nenhuma movimentação física executada ainda nesta ordem.
                            </p>
                          ) : (
                            ord.steps.map((st) => (
                              <div
                                key={st.id}
                                className="rounded-lg border border-[#AEB8C5]/15 bg-[#102235] p-3 text-xs"
                              >
                                <div className="flex flex-wrap justify-between gap-2">
                                  <span className="font-mono-tabular font-bold text-[#F4F6F8]">
                                    Etapa #{st.stepNumber} ({st.referenceDocument}) ·{' '}
                                    <span className="text-emerald-400">{formatKg(st.quantityKg)}</span>
                                  </span>
                                  <span className="text-[#AEB8C5]">
                                    {st.executedByName} · {st.shiftCode} ·{' '}
                                    {new Date(st.finishedAt).toLocaleString('pt-BR')}
                                  </span>
                                </div>
                                <p className="mt-1 font-mono-tabular text-[11px] text-[#F5B817]">
                                  Composição de lote(s) preservada:{' '}
                                  {st.lotComposition
                                    .map((c) => `${c.lotCode || 'SEM_LOTE'}: ${formatKg(c.quantityKg)}`)
                                    .join(' | ')}
                                </p>
                                {st.notes && <p className="mt-0.5 text-[11px] text-[#AEB8C5]">{st.notes}</p>}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: TRANSFERÊNCIA DIRETA RÁPIDA (FASE 2 PRESERVADA) */}
      {!guidedMode && activeTab === 'direta' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <form
            onSubmit={handleExecuteTransfer}
            className="space-y-4 rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 lg:col-span-7"
          >
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Executar Transferência Atômica Direta
            </h3>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                Rota Homologada (Matriz de Transferências) *
              </label>
              <select
                required
                disabled={!canExecuteTransfers}
                value={selectedRuleId}
                onChange={(e) => setSelectedRuleId(e.target.value)}
                className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-[#F4F6F8]"
              >
                <option value="">Selecione uma rota ativa e autorizada...</option>
                {activeRules.map((r) => (
                  <option key={r.id} value={r.id}>
                    Silo {r.originSiloNumber} → Silo {r.destinationSiloNumber} · {r.materialCode} —{' '}
                    {r.materialDescription}
                  </option>
                ))}
              </select>
            </div>

            {originSilo && destinationSilo && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-[#AEB8C5]/20 bg-[#081321] p-3 text-xs">
                  <p className="text-[#AEB8C5]">Origem: Silo {originSilo.siloNumber}</p>
                  <p className="mt-1 font-mono-tabular text-base font-bold text-[#F4F6F8]">
                    Saldo: {formatKg(originSilo.confirmedStockKg)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#AEB8C5]">
                    Situação: {originSilo.operationalStatus}
                  </p>
                </div>
                <div className="rounded-lg border border-[#AEB8C5]/20 bg-[#081321] p-3 text-xs">
                  <p className="text-[#AEB8C5]">Destino: Silo {destinationSilo.siloNumber}</p>
                  <p className="mt-1 font-mono-tabular text-base font-bold text-emerald-400">
                    Espaço Livre: {formatKg(destinationSilo.availableSpaceKg)}
                  </p>
                  <p className="mt-0.5 font-mono-tabular text-[11px] text-[#AEB8C5]">
                    Cap. Segura: {formatKg(destinationSilo.safeCapacityKg)}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Quantidade a Transferir (kg) *
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  disabled={!canExecuteTransfers}
                  value={quantityKg}
                  onChange={(e) => setQuantityKg(e.target.value)}
                  placeholder="Ex.: 5000"
                  className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Lote (Opcional / Rastreio)
                </label>
                <input
                  type="text"
                  disabled={!canExecuteTransfers}
                  value={lotCode}
                  onChange={(e) => setLotCode(e.target.value.toUpperCase())}
                  placeholder="Preserva lote na origem se vazio"
                  className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                Observação Operacional
              </label>
              <input
                type="text"
                disabled={!canExecuteTransfers}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Abastecimento Linha 5 via rosca"
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-[#F4F6F8]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#AEB8C5]/15 bg-[#081321]/70 px-3 py-2 text-xs">
              {session && (
                <span className="text-[#AEB8C5] mr-auto">
                  Operador autenticado: <strong className="text-[#F4F6F8]">{session.user.displayName}</strong>
                  {session.user.badgeCode ? ` (${session.user.badgeCode})` : ''}
                </span>
              )}
              <label className="flex items-center gap-2 text-[#F4F6F8]">
                <input
                  type="checkbox"
                  checked={executedByOther}
                  onChange={(e) => setExecutedByOther(e.target.checked)}
                  className="h-4 w-4 accent-[#F5B817]"
                />
                <span>Executado por outro</span>
              </label>
              {executedByOther && (
                <>
                  <input
                    type="text"
                    value={executedByName}
                    onChange={(e) => setExecutedByName(e.target.value)}
                    placeholder="Nome do executor"
                    className="min-h-[38px] rounded-lg border border-[#F5B817]/40 bg-[#102235] px-2.5 text-xs text-[#F4F6F8]"
                  />
                  <input
                    type="text"
                    value={executedByBadge}
                    onChange={(e) => setExecutedByBadge(e.target.value)}
                    placeholder="Matrícula"
                    className="min-h-[38px] w-28 rounded-lg border border-[#F5B817]/40 bg-[#102235] px-2.5 font-mono-tabular text-xs text-[#F4F6F8]"
                  />
                </>
              )}
            </div>

            <button
              type="submit"
              disabled={!canExecuteTransfers || !selectedRule || submitting}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#F5B817] px-5 py-2.5 text-sm font-extrabold text-[#081321] hover:bg-[#F5B817]/90 disabled:opacity-50"
            >
              <span>{submitting ? 'Transferindo...' : 'Confirmar Transferência Atômica'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="space-y-3 rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 lg:col-span-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[#F5B817]" />
              <h3 className="font-display text-sm font-bold text-[#F4F6F8]">
                Rotas Não Liberadas ({blockedRules.length})
              </h3>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {blockedRules.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-[#F5B817]/25 bg-[#081321] p-3 text-xs"
                >
                  <p className="font-mono-tabular font-bold text-[#F5B817]">
                    Silo {r.originSiloNumber} → Silo {r.destinationSiloNumber} ({r.authorizationStatus || r.validationStatus})
                  </p>
                  <p className="text-[#F4F6F8]">
                    {r.materialCode} — {r.materialDescription}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#AEB8C5]">{r.sourceReference}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LIVRO RAZÃO, ESTORNO E AJUSTE AUTORIZADO (FASE 2 PRESERVADA) */}
      {!guidedMode && activeTab === 'ledger' && (
        <div className="space-y-6">
          {canAdjustStock && (
            <form
              onSubmit={handleAuthorizedAdjustment}
              className="space-y-4 rounded-xl border border-[#F5B817]/30 bg-[#102235] p-5"
            >
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-[#F5B817]" />
                <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                  Ajuste Autorizado de Saldo (Supervisão / Administração)
                </h3>
              </div>
              <p className="text-xs text-[#AEB8C5]">
                Nunca edita o saldo diretamente: grava uma movimentação formal no livro razão com justificativa obrigatória e trilha de auditoria.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <select
                  required
                  value={adjSiloId}
                  onChange={(e) => {
                    setAdjSiloId(e.target.value);
                    const s = silos.find((item) => String(item.id) === e.target.value);
                    if (s?.primaryMaterialId) setAdjMaterialId(String(s.primaryMaterialId));
                  }}
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                >
                  <option value="">Silo...</option>
                  {silos.map((s) => (
                    <option key={s.id} value={s.id}>
                      Silo {s.siloNumber} (Atual: {formatKg(s.confirmedStockKg)})
                    </option>
                  ))}
                </select>

                <select
                  required
                  value={adjMaterialId}
                  onChange={(e) => setAdjMaterialId(e.target.value)}
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                >
                  <option value="">Matéria-prima...</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.description}
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  step="0.001"
                  required
                  value={adjDeltaKg}
                  onChange={(e) => setAdjDeltaKg(e.target.value)}
                  placeholder="Diferença kg (+ ou -)"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                />

                <input
                  type="text"
                  value={adjLotCode}
                  onChange={(e) => setAdjLotCode(e.target.value.toUpperCase())}
                  placeholder="Lote (opcional)"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                />

                <input
                  type="text"
                  required
                  minLength={5}
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="Motivo obrigatório *"
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={adjSubmitting}
                  className="min-h-[44px] rounded-lg border border-[#F5B817] bg-[#F5B817]/15 px-5 py-2 text-xs font-bold text-[#F5B817] hover:bg-[#F5B817]/25"
                >
                  {adjSubmitting ? 'Registrando...' : 'Registrar Ajuste Auditado'}
                </button>
              </div>
            </form>
          )}

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-[#F4F6F8]">
              Movimentações Recentes do Livro Razão
            </h3>
            {movements.length === 0 ? (
              <p className="text-xs text-[#AEB8C5]">Nenhuma movimentação registrada ainda.</p>
            ) : (
              <div className="space-y-2.5">
                {movements.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3 text-xs"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono-tabular font-bold text-[#F5B817]">#{m.id}</span>
                        <span className="font-bold text-[#F4F6F8]">{m.movementType}</span>
                        <span className="font-mono-tabular text-[#AEB8C5]">
                          Silo {m.siloNumber}
                          {m.counterpartSiloNumber ? ` ↔ Silo ${m.counterpartSiloNumber}` : ''}
                        </span>
                        <span
                          className={`font-mono-tabular font-bold ${
                            m.direction === 'CREDIT' ? 'text-emerald-400' : 'text-orange-400'
                          }`}
                        >
                          {m.direction === 'CREDIT' ? '+' : '-'}
                          {formatKg(m.quantityKg)}
                        </span>
                        {m.status === 'ESTORNADO' && (
                          <span className="font-bold text-red-400">· ESTORNADO</span>
                        )}
                      </div>
                      <p className="mt-1 text-[#AEB8C5]">
                        {m.materialCode} — {m.materialDescription}{' '}
                        {m.lotCode ? `· Lote ${m.lotCode}` : ''} · {m.operatorName} ·{' '}
                        {new Date(m.createdAt).toLocaleString('pt-BR')}
                      </p>
                      {m.reason && <p className="mt-0.5 text-[11px] text-[#AEB8C5]/80">{m.reason}</p>}
                    </div>

                    {canAdjustStock && m.status === 'CONFIRMADO' && m.movementType !== 'REVERSAO' && (
                      <div className="flex items-center gap-2">
                        {reversingId === m.id ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={reverseReason}
                              onChange={(e) => setReverseReason(e.target.value)}
                              placeholder="Motivo do estorno..."
                              className="min-h-[38px] w-48 rounded border border-red-400/40 bg-[#102235] px-2 text-xs text-[#F4F6F8]"
                            />
                            <button
                              type="button"
                              onClick={() => handleReverseMovement(m.id)}
                              className="min-h-[38px] rounded bg-red-500 px-3 text-xs font-bold text-white"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setReversingId(null)}
                              className="min-h-[38px] rounded border border-[#AEB8C5]/25 px-2.5 text-xs text-[#AEB8C5]"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setReversingId(m.id);
                              setReverseReason('');
                            }}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-400/35 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/15"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Estornar</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Tela de Revisão Antes de Criar Ordem Planejada */}
      {reviewOrderModalOpen && selectedPlanRule && planOriginSilo && planDestSilo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-[#F5B817]/45 bg-[#102235] p-6 space-y-4">
            <div className="flex items-center gap-2 text-[#F5B817]">
              <ClipboardCheck className="h-5 w-5" />
              <h3 className="font-display text-lg font-bold text-[#F4F6F8]">
                Revisão da Solicitação de Transferência
              </h3>
            </div>
            <p className="text-xs text-[#AEB8C5]">
              Confira os dados abaixo antes de gravar a solicitação. Esta ação planeja a transferência em status PLANEJADA e não altera saldos físicos até execução confirmada pelo operador.
            </p>
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#AEB8C5]/20 bg-[#081321] p-4 text-xs">
              <div>
                <p className="text-[#AEB8C5]">Origem</p>
                <p className="font-mono-tabular font-bold text-[#F4F6F8]">
                  Silo {planOriginSilo.siloNumber} (Saldo: {formatKg(planOriginSilo.confirmedStockKg)})
                </p>
              </div>
              <div>
                <p className="text-[#AEB8C5]">Destino</p>
                <p className="font-mono-tabular font-bold text-emerald-400">
                  Silo {planDestSilo.siloNumber} (Livre: {formatKg(planDestSilo.availableSpaceKg)})
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-[#AEB8C5]">Matéria-Prima</p>
                <p className="font-semibold text-[#F4F6F8]">
                  {selectedPlanRule.materialCode} — {selectedPlanRule.materialDescription}
                </p>
              </div>
              <div>
                <p className="text-[#AEB8C5]">Quantidade Planejada</p>
                <p className="font-mono-tabular text-base font-extrabold text-[#F5B817]">
                  {formatKg(Number(planQtyKg))}
                </p>
              </div>
              <div>
                <p className="text-[#AEB8C5]">Prioridade / Lote</p>
                <p className="font-mono-tabular font-bold text-[#F4F6F8]">
                  {planPriority} · {planLotCode || 'Auto (Lote real da origem)'}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setReviewOrderModalOpen(false);
                  onClearPrefill?.();
                }}
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 px-4 text-xs text-[#AEB8C5]"
              >
                Voltar e Editar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmCreateOrder}
                className="min-h-[44px] rounded-lg bg-[#F5B817] px-5 text-xs font-extrabold text-[#081321] disabled:opacity-50"
              >
                {submitting ? 'Confirmando...' : 'Confirmar Solicitação Planejada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Executar Etapa Parcial / Final */}
      {stepModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleConfirmExecuteStep}
            className="w-full max-w-lg rounded-xl border border-emerald-500/45 bg-[#102235] p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-bold text-[#F4F6F8]">
              Executar Etapa — Ordem {stepModalOrder.orderCode}
            </h3>
            <p className="text-xs text-[#AEB8C5]">
              Silo {stepModalOrder.originSiloNumber} → Silo {stepModalOrder.destinationSiloNumber} ·{' '}
              {stepModalOrder.materialCode} — {stepModalOrder.materialDescription}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#081321] p-3 text-xs">
              <span>
                Saldo pendente desta ordem:{' '}
                <strong className="font-mono-tabular text-[#F5B817]">
                  {formatKg(stepModalOrder.remainingQuantityKg)}
                </strong>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setStepQtyKg(String(Math.round((stepModalOrder.remainingQuantityKg / 2) * 1000) / 1000))
                  }
                  className="rounded border border-[#AEB8C5]/30 px-2 py-1 text-[11px] font-bold text-[#F4F6F8]"
                >
                  50%
                </button>
                <button
                  type="button"
                  onClick={() => setStepQtyKg(String(stepModalOrder.remainingQuantityKg))}
                  className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[11px] font-bold text-emerald-300"
                >
                  Total Restante
                </button>
              </div>
            </div>

            {stepOriginLots.length > 0 && (
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#081321] p-3 text-xs space-y-1">
                <p className="font-bold text-[#F5B817]">Lotes reais disponíveis no Silo {stepModalOrder.originSiloNumber}:</p>
                {stepOriginLots.map((l, idx) => (
                  <p key={idx} className="font-mono-tabular text-[#AEB8C5]">
                    • Lote {l.lotCode}: <strong className="text-[#F4F6F8]">{formatKg(l.netKg)}</strong>
                  </p>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-[#AEB8C5]">
                  Quantidade Movimentada Agora (kg) *
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  max={stepModalOrder.remainingQuantityKg}
                  required
                  value={stepQtyKg}
                  onChange={(e) => setStepQtyKg(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#AEB8C5]">Lote Prioritário (Opcional)</label>
                <input
                  type="text"
                  value={stepPreferredLot}
                  onChange={(e) => setStepPreferredLot(e.target.value.toUpperCase())}
                  placeholder="Preserva composição real"
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-[#AEB8C5]">Observação da Etapa</label>
              <input
                type="text"
                value={stepNotes}
                onChange={(e) => setStepNotes(e.target.value)}
                placeholder="Ex.: Descarga parcial concluída na primeira rosca"
                className="min-h-[42px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs text-[#F4F6F8]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex min-h-[38px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#081321] px-3 text-[#F4F6F8]">
                <input
                  type="checkbox"
                  checked={executedByOther}
                  onChange={(e) => setExecutedByOther(e.target.checked)}
                  className="h-4 w-4 accent-[#F5B817]"
                />
                <span>Executado por outro operador</span>
              </label>
              {executedByOther && (
                <>
                  <input
                    type="text"
                    value={executedByName}
                    onChange={(e) => setExecutedByName(e.target.value)}
                    placeholder="Nome do executor"
                    className="min-h-[38px] flex-1 rounded-lg border border-[#F5B817]/40 bg-[#081321] px-2.5 text-xs text-[#F4F6F8]"
                  />
                  <input
                    type="text"
                    value={executedByBadge}
                    onChange={(e) => setExecutedByBadge(e.target.value)}
                    placeholder="Matrícula"
                    className="min-h-[38px] w-28 rounded-lg border border-[#F5B817]/40 bg-[#081321] px-2.5 font-mono-tabular text-xs text-[#F4F6F8]"
                  />
                </>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStepModalOrder(null)}
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 px-4 text-xs text-[#AEB8C5]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] rounded-lg bg-emerald-600 px-5 text-xs font-extrabold text-white disabled:opacity-50"
              >
                {submitting ? 'Confirmando...' : 'Confirmar Etapa Atômica'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Interromper Ordem */}
      {interruptModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleConfirmInterruptOrder}
            className="w-full max-w-md rounded-xl border border-red-500/45 bg-[#102235] p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-red-300">
              <OctagonAlert className="h-5 w-5" />
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Interromper Ordem {interruptModalOrder.orderCode}
              </h3>
            </div>
            <p className="text-xs text-[#AEB8C5]">
              Etapas já confirmadas ({formatKg(interruptModalOrder.transferredQuantityKg)}) serão preservadas integralmente no livro razão. Informe o motivo da interrupção:
            </p>
            <textarea
              rows={3}
              required
              minLength={5}
              value={interruptReason}
              onChange={(e) => setInterruptReason(e.target.value)}
              placeholder="Ex.: Parada mecânica na rosca elevadora do silo 37."
              className="w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] p-3 text-xs text-[#F4F6F8]"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInterruptModalOrder(null)}
                className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 px-4 text-xs text-[#AEB8C5]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting || interruptReason.trim().length < 5}
                className="min-h-[42px] rounded-lg bg-red-600 px-4 text-xs font-bold text-white disabled:opacity-50"
              >
                Confirmar Interrupção
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
