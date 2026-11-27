import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Edit3,
  FilePlus2,
  FileText,
  History,
  Lock,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  Users,
} from 'lucide-react';
import {
  AppUser,
  SessionData,
  ShiftAutoSummarySnapshot,
  ShiftConfigView,
  ShiftHandoverPendencyView,
  ShiftHandoverView,
  ShiftManualSupplement,
  ShiftWorkflowStatus,
} from '../types/nexo.ts';
import { apiDownloadFile, apiFetch, formatKg } from '../lib/api.ts';
import { hasPermission } from '../lib/rbac.ts';
import { buildMoegaShiftNarrativeReport, formatIsoDatePtBr } from '../lib/phase5-analytics.ts';

interface ShiftsHandoverPageProps {
  session: SessionData;
  initialIntent?: 'view' | 'supplement' | 'ai' | 'review' | 'finalize' | null;
  onClearIntent?: () => void;
  onSessionRefresh: () => Promise<void>;
}

type ShiftSubTab = 'PASSAGEM' | 'PENDENCIAS' | 'HISTORICO' | 'TURNOS';

const WORKFLOW_STEPS: Array<{ key: ShiftWorkflowStatus; label: string }> = [
  { key: 'EM_ELABORACAO', label: '1. Em Elaboração' },
  { key: 'AGUARDANDO_CONFERENCIA', label: '2. Conferência' },
  { key: 'AGUARDANDO_APROVACAO', label: '3. Aguardando Aprovação' },
  { key: 'APROVADO', label: '4. Aprovado' },
  { key: 'ENCERRADO', label: '5. Encerrado' },
];

const AI_PRESET_COMMANDS = [
  { label: 'Organizar cronologicamente', cmd: 'Organizar acontecimentos em ordem cronológica fluida' },
  { label: 'Converter em texto formal', cmd: 'Converter anotações operacionais em texto formal da Moega' },
  { label: 'Revisar ortografia', cmd: 'Revisar ortografia, pontuação e concordância mantendo todos os dados' },
  { label: 'Preparar passagem de turno', cmd: 'Preparar texto objetivo para passagem de turno e pendências' },
  { label: 'Revisar antes de encerrar', cmd: 'Revisar relatório completo antes do encerramento oficial do turno' },
];

export const ShiftsHandoverPage: React.FC<ShiftsHandoverPageProps> = ({
  session,
  initialIntent,
  onClearIntent,
  onSessionRefresh,
}) => {
  const [subTab, setSubTab] = useState<ShiftSubTab>('PASSAGEM');
  const [shifts, setShifts] = useState<ShiftConfigView[]>([]);
  const [handovers, setHandovers] = useState<ShiftHandoverView[]>([]);
  const [openPendencies, setOpenPendencies] = useState<ShiftHandoverPendencyView[]>([]);
  const [usersList, setUsersList] = useState<AppUser[]>([]);

  // Contexto selecionado para passagem
  const [selectedShiftCode, setSelectedShiftCode] = useState<'TURNO_1' | 'TURNO_2' | 'TURNO_3'>(
    session.shift.shiftCode
  );
  const [selectedOpDate, setSelectedOpDate] = useState(session.shift.operationalDate);
  const [autoSummary, setAutoSummary] = useState<ShiftAutoSummarySnapshot | null>(null);

  // Registro ativo (rascunho, revisão ou já aprovado/encerrado)
  const [activeHandover, setActiveHandover] = useState<ShiftHandoverView | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<number | undefined>(undefined);
  const [shiftSummaryText, setShiftSummaryText] = useState('');
  const [relevantOccurrencesText, setRelevantOccurrencesText] = useState('');
  const [pendenciesText, setPendenciesText] = useState('');
  const [requiredActionsText, setRequiredActionsText] = useState('');
  const [nextShiftRecommendationsText, setNextShiftRecommendationsText] = useState('');
  const [receivedByName, setReceivedByName] = useState('');
  const [editedReportText, setEditedReportText] = useState('');
  const [supplements, setSupplements] = useState<ShiftManualSupplement[]>([]);

  // Complemento manual
  const [showSupplementPanel, setShowSupplementPanel] = useState(false);
  const [supCategory, setSupCategory] = useState<ShiftManualSupplement['category']>('INFORMACAO_OPERACIONAL');
  const [supText, setSupText] = useState('');
  const [supExecutedOther, setSupExecutedOther] = useState(false);
  const [supExecutedByName, setSupExecutedByName] = useState('');
  const [supExecutedByBadge, setSupExecutedByBadge] = useState('');
  const [savingSupplement, setSavingSupplement] = useState(false);

  // Assistente IA de redação
  const [aiCommand, setAiCommand] = useState('');
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);

  // Aprovação & Correção versionada pós-aprovação
  const [approvalNotes, setApprovalNotes] = useState('');
  const [closeImmediately, setCloseImmediately] = useState(true);
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [savingCorrection, setSavingCorrection] = useState(false);

  // Ciência de pendência
  const [ackNotes, setAckNotes] = useState<Record<number, string>>({});
  const [resolveNotes, setResolveNotes] = useState<Record<number, string>>({});

  // Edição de turno (Admin/Supervisor)
  const [editingShiftCode, setEditingShiftCode] = useState<'TURNO_1' | 'TURNO_2' | 'TURNO_3' | null>(null);
  const [editStartTime, setEditStartTime] = useState('07:30');
  const [editEndTime, setEditEndTime] = useState('17:18');
  const [editResponsibleName, setEditResponsibleName] = useState('');
  const [editSupervisorId, setEditSupervisorId] = useState('');
  const [editIsValidated, setEditIsValidated] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');

  const [loading, setLoading] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canManageShifts = hasPermission(session.user.roleCode, 'shifts:manage');
  const canPrepareHandover = hasPermission(session.user.roleCode, 'handover:prepare');
  const canFinalizePendency = hasPermission(session.user.roleCode, 'handover:finalize');
  const canAcknowledge = hasPermission(session.user.roleCode, 'handover:acknowledge');
  const canApproveHandover = hasPermission(session.user.roleCode, 'handover:approve');
  const canCorrectHandover = hasPermission(session.user.roleCode, 'handover:correct');

  const currentWorkflow: ShiftWorkflowStatus =
    activeHandover?.workflowStatus ||
    (activeHandover?.status === 'FINALIZADA'
      ? 'AGUARDANDO_APROVACAO'
      : activeHandover?.status === 'REVISAO'
        ? 'AGUARDANDO_CONFERENCIA'
        : 'EM_ELABORACAO');

  const isLockedAfterApproval =
    Boolean(activeHandover) &&
    (currentWorkflow === 'APROVADO' || currentWorkflow === 'ENCERRADO' || activeHandover?.status === 'FINALIZADA');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [shiftsData, handoversData, pendData, summaryData] = await Promise.all([
        apiFetch<ShiftConfigView[]>('/api/shifts'),
        apiFetch<ShiftHandoverView[]>('/api/shift-handovers'),
        apiFetch<ShiftHandoverPendencyView[]>('/api/shift-pendencies/open'),
        apiFetch<ShiftAutoSummarySnapshot>(
          `/api/shift-handovers/auto-summary?shiftCode=${selectedShiftCode}&operationalDate=${selectedOpDate}`
        ),
      ]);
      setShifts(shiftsData);
      setHandovers(handoversData);
      setOpenPendencies(pendData);
      setAutoSummary(summaryData);

      const matchingAll = handoversData.filter(
        (h) => h.shiftCode === selectedShiftCode && h.operationalDate === selectedOpDate
      );
      const currentRecord =
        matchingAll.find((h) => h.status !== 'FINALIZADA') || matchingAll[0] || null;

      setActiveHandover(currentRecord);
      if (currentRecord) {
        setActiveDraftId(currentRecord.status !== 'FINALIZADA' ? currentRecord.id : undefined);
        setShiftSummaryText(currentRecord.shiftSummaryText);
        setRelevantOccurrencesText(currentRecord.relevantOccurrencesText);
        setPendenciesText(currentRecord.pendenciesText);
        setRequiredActionsText(currentRecord.requiredActionsText);
        setNextShiftRecommendationsText(currentRecord.nextShiftRecommendationsText);
        setReceivedByName(currentRecord.receivedByName || '');
        setSupplements(currentRecord.supplements || []);
        setEditedReportText(currentRecord.editedReportText || currentRecord.autoReportText);
      } else {
        setActiveDraftId(undefined);
        setSupplements([]);
        const generated = buildMoegaShiftNarrativeReport({
          summary: summaryData,
          handoverByName: session.user.displayName,
          handoverByBadge: session.user.badgeCode,
        });
        setEditedReportText(generated);
      }

      if (hasPermission(session.user.roleCode, 'users:manage')) {
        const uList = await apiFetch<AppUser[]>('/api/users');
        setUsersList(uList);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar gestão de turnos e passagem.');
    } finally {
      setLoading(false);
    }
  }, [selectedShiftCode, selectedOpDate, session.user.displayName, session.user.badgeCode, session.user.roleCode]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!initialIntent) return;
    setSubTab('PASSAGEM');
    if (initialIntent === 'supplement') {
      setShowSupplementPanel(true);
      setTimeout(() => document.getElementById('nexo-shift-supplement')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    } else if (initialIntent === 'ai') {
      setTimeout(() => document.getElementById('nexo-shift-ai-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    } else if (initialIntent === 'review' || initialIntent === 'finalize') {
      setTimeout(() => document.getElementById('nexo-shift-actions')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    } else if (initialIntent === 'view') {
      setTimeout(() => document.getElementById('nexo-shift-report-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    }
    onClearIntent?.();
  }, [initialIntent, onClearIntent]);

  const regeneratePreviewText = () => {
    if (!autoSummary) return;
    const text = buildMoegaShiftNarrativeReport({
      summary: autoSummary,
      handoverByName: session.user.displayName,
      handoverByBadge: session.user.badgeCode,
      receivedByName,
      shiftSummaryText,
      relevantOccurrencesText,
      pendenciesText,
      requiredActionsText,
      nextShiftRecommendationsText,
      supplements,
    });
    setEditedReportText(text);
    setStatusMsg('Relatório narrativo atualizado com as movimentações e complementos do turno.');
  };

  const handleRefineWithAi = async (overrideCmd?: string) => {
    if (!autoSummary) return;
    const effectiveCmd = (overrideCmd ?? aiCommand).trim();
    if (overrideCmd) setAiCommand(overrideCmd);
    setRefining(true);
    setError(null);
    try {
      const base =
        editedReportText.trim() ||
        buildMoegaShiftNarrativeReport({
          summary: autoSummary,
          handoverByName: session.user.displayName,
          handoverByBadge: session.user.badgeCode,
          receivedByName,
          shiftSummaryText,
          relevantOccurrencesText,
          pendenciesText,
          requiredActionsText,
          nextShiftRecommendationsText,
          supplements,
        });
      const res = await apiFetch<{ refinedText: string; usedAiModel: string | null; warnings?: string[] }>(
        '/api/shift-handovers/refine-text',
        {
          method: 'POST',
          body: JSON.stringify({
            baseReportText: base,
            rawFacts: { ...autoSummary, receivedByName: receivedByName.trim() || null },
            userCommand: effectiveCmd || undefined,
          }),
        }
      );
      setEditedReportText(res.refinedText);
      setAiWarnings(res.warnings || []);
      setStatusMsg(
        res.usedAiModel
          ? 'Texto revisado com apoio da IA preservando rigorosamente pesos, horários e contagem de veículos.'
          : 'Texto organizado de forma determinística preservando rigorosamente todos os fatos.'
      );
    } catch (err: any) {
      setError(err.message || 'Erro ao organizar relatório.');
    } finally {
      setRefining(false);
    }
  };

  const ensureDraftExists = async (): Promise<number> => {
    if (activeDraftId) return activeDraftId;
    if (activeHandover?.id) return activeHandover.id;
    const draft = await apiFetch<ShiftHandoverView>('/api/shift-handovers/draft', {
      method: 'POST',
      body: JSON.stringify({
        shiftCode: selectedShiftCode,
        operationalDate: selectedOpDate,
        status: 'RASCUNHO',
        workflowStatus: 'EM_ELABORACAO',
        shiftSummaryText,
        relevantOccurrencesText,
        pendenciesText,
        requiredActionsText,
        nextShiftRecommendationsText,
        editedReportText,
        receivedByName: receivedByName.trim() || null,
      }),
    });
    setActiveDraftId(draft.id);
    setActiveHandover(draft);
    return draft.id;
  };

  const handleAddSupplement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supText.trim()) return;
    setSavingSupplement(true);
    setError(null);
    setStatusMsg(null);
    try {
      const targetId = await ensureDraftExists();
      const updated = await apiFetch<ShiftHandoverView>(`/api/shift-handovers/${targetId}/supplement`, {
        method: 'POST',
        body: JSON.stringify({
          category: supCategory,
          text: supText.trim(),
          executedByName: supExecutedOther ? supExecutedByName.trim() || undefined : undefined,
          executedByBadge: supExecutedOther ? supExecutedByBadge.trim() || undefined : undefined,
          appendToReport: true,
        }),
      });
      setActiveHandover(updated);
      setSupplements(updated.supplements || []);
      setEditedReportText(updated.editedReportText || updated.autoReportText);
      setSupText('');
      setSupExecutedOther(false);
      setSupExecutedByName('');
      setSupExecutedByBadge('');
      setShowSupplementPanel(false);
      setStatusMsg('Complemento operacional incorporado ao relatório com autoria autenticada.');
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Falha ao adicionar complemento ao relatório.');
    } finally {
      setSavingSupplement(false);
    }
  };

  const handleSaveHandover = async (
    targetStatus: 'RASCUNHO' | 'REVISAO',
    workflowStatusOverride?: ShiftWorkflowStatus
  ) => {
    setError(null);
    setStatusMsg(null);
    try {
      const saved = await apiFetch<ShiftHandoverView>('/api/shift-handovers/draft', {
        method: 'POST',
        body: JSON.stringify({
          id: activeDraftId,
          shiftCode: selectedShiftCode,
          operationalDate: selectedOpDate,
          status: targetStatus,
          workflowStatus:
            workflowStatusOverride ||
            (targetStatus === 'REVISAO' ? 'AGUARDANDO_CONFERENCIA' : 'EM_ELABORACAO'),
          aiCommand: aiCommand.trim() || null,
          shiftSummaryText,
          relevantOccurrencesText,
          pendenciesText,
          requiredActionsText,
          nextShiftRecommendationsText,
          editedReportText,
          receivedByName: receivedByName.trim() || null,
        }),
      });
      setActiveDraftId(saved.id);
      setActiveHandover(saved);
      setStatusMsg(
        targetStatus === 'REVISAO'
          ? `Relatório ${saved.handoverCode} enviado para conferência/aprovação.`
          : `Rascunho ${saved.handoverCode} salvo em elaboração.`
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Falha ao salvar passagem de turno.');
    }
  };

  const handleFinalizeHandover = async () => {
    setError(null);
    setStatusMsg(null);
    try {
      const draftId = await ensureDraftExists();
      const finalized = await apiFetch<ShiftHandoverView>(
        `/api/shift-handovers/${draftId}/finalize`,
        {
          method: 'POST',
          body: JSON.stringify({
            receivedByName: receivedByName.trim() || null,
            editedReportText,
          }),
        }
      );
      setActiveDraftId(undefined);
      setStatusMsg(
        `Passagem ${finalized.handoverCode} encerrada para conferência/aprovação. ${finalized.pendencies.length} pendência(s) disponibilizada(s) para o próximo turno.`
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Erro ao finalizar passagem de turno.');
    }
  };

  const handleApproveHandover = async () => {
    if (!activeHandover) return;
    setError(null);
    setStatusMsg(null);
    try {
      const approved = await apiFetch<ShiftHandoverView>(
        `/api/shift-handovers/${activeHandover.id}/approve`,
        {
          method: 'POST',
          body: JSON.stringify({
            approvalNotes: approvalNotes.trim() || undefined,
            closeImmediately,
          }),
        }
      );
      setApprovalNotes('');
      setStatusMsg(
        `Relatório ${approved.handoverCode} ${
          approved.workflowStatus === 'ENCERRADO' ? 'aprovado e encerrado oficialmente' : 'aprovado'
        } com registro imutável (v${approved.version}).`
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Falha ao aprovar relatório do turno.');
    }
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeHandover) return;
    setSavingCorrection(true);
    setError(null);
    setStatusMsg(null);
    try {
      const corrected = await apiFetch<ShiftHandoverView>(
        `/api/shift-handovers/${activeHandover.id}/correct`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: correctionReason.trim(),
            editedReportText: correctionText,
          }),
        }
      );
      setShowCorrectionModal(false);
      setCorrectionReason('');
      setStatusMsg(
        `Correção versionada (v${corrected.version}) registrada sem sobrescrever as versões anteriores.`
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Falha ao registrar correção versionada.');
    } finally {
      setSavingCorrection(false);
    }
  };

  const handleAcknowledgePendency = async (pendencyId: number) => {
    setError(null);
    try {
      await apiFetch(`/api/shift-pendencies/${pendencyId}/acknowledge`, {
        method: 'POST',
        body: JSON.stringify({ note: ackNotes[pendencyId] || '' }),
      });
      setStatusMsg(
        'Ciência registrada. A pendência permanece visível para acompanhamento até sua conclusão operacional.'
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Falha ao registrar ciência.');
    }
  };

  const handleResolvePendency = async (pendencyId: number) => {
    setError(null);
    try {
      await apiFetch(`/api/shift-pendencies/${pendencyId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolutionNotes: resolveNotes[pendencyId] || '' }),
      });
      setStatusMsg('Pendência operacional concluída e auditada.');
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Falha ao concluir pendência.');
    }
  };

  const startEditShift = (sh: ShiftConfigView) => {
    setEditingShiftCode(sh.code);
    setEditStartTime(sh.startTime);
    setEditEndTime(sh.endTime);
    setEditResponsibleName(sh.responsibleName || '');
    setEditSupervisorId(sh.supervisorUserId ? String(sh.supervisorUserId) : '');
    setEditIsValidated(sh.isValidated);
    setEditNotes(sh.notes || '');
    setEditReason('');
  };

  const handleSaveShiftConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShiftCode) return;
    setError(null);
    try {
      await apiFetch(`/api/shifts/${editingShiftCode}`, {
        method: 'PUT',
        body: JSON.stringify({
          startTime: editStartTime,
          endTime: editEndTime,
          supervisorUserId: editSupervisorId ? Number(editSupervisorId) : null,
          responsibleName: editResponsibleName || null,
          isValidated: editIsValidated,
          notes: editNotes || null,
          reason: editReason,
        }),
      });
      setEditingShiftCode(null);
      setStatusMsg('Configuração de turno atualizada e auditada com sucesso.');
      await Promise.all([loadAll(), onSessionRefresh()]);
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar configuração do turno.');
    }
  };

  const vehicleBreakdown = autoSummary?.vehicleBreakdown;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#F5B91B]/30 bg-[#F5B91B]/10 text-[#F5B91B]">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
              Relatórios Operacionais & Passagem de Turno
            </h2>
            <p className="text-xs text-[#AEB8C5]">
              {session.shift.shiftName} · Data Operacional {formatIsoDatePtBr(selectedOpDate)} · Vínculo automático de movimentações e autoria
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'PASSAGEM' as ShiftSubTab, label: 'Passagem do Turno', icon: Send },
              {
                id: 'PENDENCIAS' as ShiftSubTab,
                label: `Pendências (${openPendencies.length})`,
                icon: AlertCircle,
              },
              { id: 'HISTORICO' as ShiftSubTab, label: 'Histórico Preservado', icon: History },
              { id: 'TURNOS' as ShiftSubTab, label: 'Configuração de Turnos', icon: Clock },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 text-xs font-semibold ${
                  active
                    ? 'border-[#F5B91B] bg-[#F5B91B] text-[#0A1421]'
                    : 'border-[#AEB8C5]/20 bg-[#0A1421] text-[#AEB8C5] hover:text-[#F4F6F8]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
          {error}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          {statusMsg}
        </div>
      )}

      {/* SUBTAB 1: PASSAGEM DO TURNO */}
      {subTab === 'PASSAGEM' && (
        <div className="space-y-4">
          {/* Workflow Stepper */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {WORKFLOW_STEPS.map((st) => {
                  const isCurrent = currentWorkflow === st.key;
                  const idxCur = WORKFLOW_STEPS.findIndex((x) => x.key === currentWorkflow);
                  const idxStep = WORKFLOW_STEPS.findIndex((x) => x.key === st.key);
                  const isDone = idxStep < idxCur;
                  return (
                    <span
                      key={st.key}
                      className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                        isCurrent
                          ? 'border-[#F5B91B] bg-[#F5B91B]/15 text-[#F5B91B]'
                          : isDone
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]'
                      }`}
                    >
                      {st.label}
                    </span>
                  );
                })}
              </div>
              {activeHandover && (
                <span className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                  {activeHandover.handoverCode} · Versão v{activeHandover.version}
                </span>
              )}
            </div>
          </div>

          {isLockedAfterApproval && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-100">
              <div className="flex items-start gap-2.5">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <div>
                  <p className="font-bold">
                    Documento {currentWorkflow} — Edição Direta Travada ({activeHandover?.handoverCode} · v{activeHandover?.version})
                  </p>
                  <p className="mt-0.5 text-emerald-200/85">
                    Versões originais ficam preservadas no histórico imutável. Para ajustar este documento após aprovação/fechamento, registre uma correção versionada com justificativa obrigatória.
                  </p>
                </div>
              </div>
              {canCorrectHandover && (
                <button
                  type="button"
                  onClick={() => {
                    setCorrectionText(editedReportText);
                    setCorrectionReason('');
                    setShowCorrectionModal(true);
                  }}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-400/50 bg-[#0A1421] px-3.5 text-xs font-bold text-[#F5B91B] hover:border-[#F5B91B]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Registrar Correção Versionada</span>
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Esquerda: Resumo automático + Contagem Rigorosa de Veículos */}
            <div className="space-y-4 lg:col-span-5">
              <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#AEB8C5]">Turno</label>
                    <select
                      value={selectedShiftCode}
                      onChange={(e) => setSelectedShiftCode(e.target.value as any)}
                      className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                    >
                      <option value="TURNO_1">1º Turno</option>
                      <option value="TURNO_2">2º Turno</option>
                      <option value="TURNO_3">3º Turno</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#AEB8C5]">
                      Data Operacional
                    </label>
                    <input
                      type="date"
                      value={selectedOpDate}
                      onChange={(e) => setSelectedOpDate(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                    />
                  </div>
                </div>

                {autoSummary && (
                  <div className="space-y-3 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#F5B91B]">Resumo Automático do Banco</span>
                      <span className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                        {loading ? 'Atualizando...' : `${autoSummary.chronologicalEvents.length} evento(s)`}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-2.5">
                        <p className="text-[11px] text-[#AEB8C5]">Recebido no Turno</p>
                        <p className="font-mono-tabular text-base font-bold text-emerald-400">
                          {formatKg(autoSummary.receivedKg)}
                        </p>
                        <p className="text-[11px] text-[#AEB8C5]">{autoSummary.receiptsCount} entrada(s)</p>
                      </div>
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-2.5">
                        <p className="text-[11px] text-[#AEB8C5]">Transferências Executadas</p>
                        <p className="font-mono-tabular text-base font-bold text-blue-400">
                          {formatKg(autoSummary.transfersCompletedKg)}
                        </p>
                        <p className="text-[11px] text-[#AEB8C5]">
                          {autoSummary.transfersPendingCount} pendente(s)
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-2.5">
                        <p className="text-[11px] text-[#AEB8C5]">Descargas Parciais</p>
                        <p className="font-mono-tabular text-base font-bold text-amber-400">
                          {autoSummary.partialDischargesCount}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-2.5">
                        <p className="text-[11px] text-[#AEB8C5]">Ocorrências / Críticos</p>
                        <p className="font-mono-tabular text-base font-bold text-red-400">
                          {autoSummary.openOccurrencesCount} / {autoSummary.criticalStocks.length} MP
                        </p>
                      </div>
                    </div>

                    {/* Contagem Rigorosa de Veículos do Turno */}
                    <div className="rounded-lg border border-[#F5B91B]/30 bg-[#0A1421] p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 font-bold text-[#F5B91B]">
                          <Truck className="h-3.5 w-3.5" />
                          Contagem Rigorosa de Veículos
                        </span>
                        <span className="font-mono-tabular text-sm font-extrabold text-emerald-400">
                          {vehicleBreakdown?.totalCountedVehicles ?? 0} veículo(s)
                        </span>
                      </div>
                      <p className="text-[11px] text-[#AEB8C5]">
                        Somente cargas iniciadas e finalizadas neste turno entram no total:
                      </p>
                      {vehicleBreakdown && vehicleBreakdown.countedByMaterial.length > 0 ? (
                        <ul className="space-y-1 text-[#F4F6F8]">
                          {vehicleBreakdown.countedByMaterial.map((m) => (
                            <li key={m.formattedMaterialName} className="font-mono-tabular">
                              - {m.count}x <strong>{m.formattedMaterialName}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-[#AEB8C5]">Nenhum veículo integralmente finalizado neste turno.</p>
                      )}

                      {vehicleBreakdown && vehicleBreakdown.carryoverFinalizedVehicles.length > 0 && (
                        <div className="border-t border-[#AEB8C5]/15 pt-2">
                          <p className="text-[11px] font-bold text-blue-300">
                            Iniciados em turno anterior e finalizados aqui (não contabilizados neste turno):
                          </p>
                          <ul className="mt-1 space-y-1 text-[11px] text-[#AEB8C5]">
                            {vehicleBreakdown.carryoverFinalizedVehicles.map((cv) => (
                              <li key={cv.receiptId}>
                                {cv.receiptNumber} · {cv.formattedMaterialName} ({formatKg(cv.distributedInShiftKg)} complementados · início {formatIsoDatePtBr(cv.startedOperationalDate)})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {vehicleBreakdown && vehicleBreakdown.pendingOrPartialVehicles.length > 0 && (
                        <div className="border-t border-[#AEB8C5]/15 pt-2">
                          <p className="text-[11px] font-bold text-amber-300">
                            Parciais / aguardando descarga:
                          </p>
                          <ul className="mt-1 space-y-1 text-[11px] text-[#AEB8C5]">
                            {vehicleBreakdown.pendingOrPartialVehicles.map((pv) => (
                              <li key={pv.receiptId}>
                                {pv.receiptNumber} · {pv.formattedMaterialName} (restante: {formatKg(pv.remainingKg)})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 text-xs space-y-1.5">
                      <p className="font-semibold text-[#F4F6F8]">Silos Abastecidos no Turno</p>
                      <p className="text-[#AEB8C5]">
                        {autoSummary.silosFed.length > 0
                          ? autoSummary.silosFed
                              .map((s) => `Silo ${s.siloNumber} (${s.materialCode}: ${formatKg(s.kg)})`)
                              .join('; ')
                          : 'Nenhuma descarga confirmada neste turno.'}
                      </p>
                      <p className="font-semibold text-[#F4F6F8] pt-1">Silos Indisponíveis</p>
                      <p className="text-[#AEB8C5]">
                        {autoSummary.unavailableSilos.length > 0
                          ? autoSummary.unavailableSilos
                              .map((s) => `Silo ${s.siloNumber} (${s.operationalStatus})`)
                              .join('; ')
                          : 'Todos os silos operacionais.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Direita: Registro manual + Complementos + IA + Aprovação */}
            <div className="space-y-4 lg:col-span-7">
              <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-bold text-[#F4F6F8]">
                    Registro de Passagem & Relatório Narrativo do Turno
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {canPrepareHandover && !isLockedAfterApproval && (
                      <button
                        type="button"
                        onClick={() => setShowSupplementPanel(!showSupplementPanel)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-blue-400/40 bg-blue-500/15 px-3 text-xs font-semibold text-blue-200"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" />
                        <span>Complementar Informação</span>
                      </button>
                    )}
                    {canPrepareHandover && (
                      <button
                        type="button"
                        onClick={() => handleExportReportShortcut(selectedShiftCode, selectedOpDate)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                      >
                        <FileText className="h-3.5 w-3.5 text-[#F5B91B]" />
                        <span>Exportar PDF do Turno</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Painel de Complemento Manual */}
                {showSupplementPanel && canPrepareHandover && !isLockedAfterApproval && (
                  <form
                    id="nexo-shift-supplement"
                    onSubmit={handleAddSupplement}
                    className="rounded-xl border border-blue-400/35 bg-[#0A1421] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-blue-200">
                        Adicionar Complemento Operacional ao Relatório
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowSupplementPanel(false)}
                        className="text-[11px] text-[#AEB8C5] hover:text-[#F4F6F8]"
                      >
                        Fechar
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] text-[#AEB8C5]">Categoria</label>
                        <select
                          value={supCategory}
                          onChange={(e) => setSupCategory(e.target.value as any)}
                          className="min-h-[42px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                        >
                          <option value="INFORMACAO_OPERACIONAL">Informação Operacional</option>
                          <option value="CLIMA">Condição Climática / Chuva</option>
                          <option value="MANUTENCAO">Manutenção / Equipamento</option>
                          <option value="OBSERVACAO_TURNO">Observação Geral de Turno</option>
                        </select>
                      </div>
                      <label className="flex min-h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8] sm:mt-5">
                        <input
                          type="checkbox"
                          checked={supExecutedOther}
                          onChange={(e) => setSupExecutedOther(e.target.checked)}
                        />
                        <span>Executado por outro operador</span>
                      </label>
                    </div>

                    {supExecutedOther && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input
                          value={supExecutedByName}
                          onChange={(e) => setSupExecutedByName(e.target.value)}
                          placeholder="Nome do operador executor..."
                          className="min-h-[40px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                        />
                        <input
                          value={supExecutedByBadge}
                          onChange={(e) => setSupExecutedByBadge(e.target.value)}
                          placeholder="Matrícula do executor..."
                          className="min-h-[40px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                        />
                      </div>
                    )}

                    <textarea
                      required
                      rows={2}
                      value={supText}
                      onChange={(e) => setSupText(e.target.value)}
                      placeholder="Descreva o fato complementar (ex.: parada breve por chuva às 20:15 sem danos à carga)..."
                      className="w-full rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] p-2.5 text-xs text-[#F4F6F8]"
                    />
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingSupplement}
                        className="min-h-[40px] rounded-lg bg-[#F5B91B] px-4 text-xs font-extrabold text-[#0A1421] disabled:opacity-50"
                      >
                        {savingSupplement ? 'Incorporando...' : 'Incorporar ao Relatório'}
                      </button>
                    </div>
                  </form>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-[#AEB8C5]">
                      Responsável pela Passagem (Autenticado)
                    </label>
                    <input
                      disabled
                      value={`${session.user.displayName}${session.user.badgeCode ? ` · Mat. ${session.user.badgeCode}` : ''}`}
                      className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421]/60 px-3 text-xs text-[#AEB8C5]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[#AEB8C5]">
                      Responsável pelo Recebimento (Próximo Turno)
                    </label>
                    <input
                      value={receivedByName}
                      onChange={(e) => setReceivedByName(e.target.value)}
                      placeholder="Nome do operador/supervisor que assume..."
                      disabled={!canPrepareHandover || isLockedAfterApproval}
                      className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[11px] text-[#AEB8C5]">Resumo do Turno</label>
                    <textarea
                      rows={2}
                      value={shiftSummaryText}
                      onChange={(e) => setShiftSummaryText(e.target.value)}
                      disabled={!canPrepareHandover || isLockedAfterApproval}
                      placeholder="Síntese objetiva do andamento operacional..."
                      className="w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-2.5 text-xs text-[#F4F6F8]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[#AEB8C5]">Ocorrências Relevantes</label>
                    <textarea
                      rows={2}
                      value={relevantOccurrencesText}
                      onChange={(e) => setRelevantOccurrencesText(e.target.value)}
                      disabled={!canPrepareHandover || isLockedAfterApproval}
                      placeholder="Desvios, paradas ou alertas relevantes..."
                      className="w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-2.5 text-xs text-[#F4F6F8]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[#AEB8C5]">
                      Pendências para o Próximo Turno
                    </label>
                    <textarea
                      rows={2}
                      value={pendenciesText}
                      onChange={(e) => setPendenciesText(e.target.value)}
                      disabled={!canPrepareHandover || isLockedAfterApproval}
                      placeholder="Ex.: concluir descarga parcial do Lote X..."
                      className="w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-2.5 text-xs text-[#F4F6F8]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[#AEB8C5]">
                      Ações Necessárias & Recomendações
                    </label>
                    <textarea
                      rows={2}
                      value={requiredActionsText}
                      onChange={(e) => setRequiredActionsText(e.target.value)}
                      disabled={!canPrepareHandover || isLockedAfterApproval}
                      placeholder="Orientações diretas para continuidade segura..."
                      className="w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-2.5 text-xs text-[#F4F6F8]"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] text-[#AEB8C5]">
                    Recomendações Adicionais para o Próximo Turno
                  </label>
                  <input
                    value={nextShiftRecommendationsText}
                    onChange={(e) => setNextShiftRecommendationsText(e.target.value)}
                    disabled={!canPrepareHandover || isLockedAfterApproval}
                    placeholder="Observações específicas para a equipe entrante..."
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                  />
                </div>

                {/* Toolbar do Assistente de Redação IA */}
                {canPrepareHandover && !isLockedAfterApproval && (
                  <div
                    id="nexo-shift-ai-toolbar"
                    className="space-y-2.5 rounded-xl border border-blue-400/25 bg-[#0A1421] p-3.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-200">
                        <Sparkles className="h-3.5 w-3.5" />
                        Edição Assistida por IA (preserva números, datas e veículos)
                      </span>
                      <button
                        type="button"
                        onClick={regeneratePreviewText}
                        className="min-h-[34px] rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 text-[11px] font-semibold text-[#F4F6F8]"
                      >
                        Regerar Texto Base do Banco
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {AI_PRESET_COMMANDS.map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          disabled={refining}
                          onClick={() => handleRefineWithAi(preset.cmd)}
                          className="rounded-lg border border-blue-400/30 bg-blue-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/20 disabled:opacity-50"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <input
                        value={aiCommand}
                        onChange={(e) => setAiCommand(e.target.value)}
                        placeholder="Comando livre (ex.: 'acrescentar chuva leve às 21h sem parar a moega')..."
                        className="min-h-[40px] flex-1 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                      />
                      <button
                        type="button"
                        disabled={refining}
                        onClick={() => handleRefineWithAi()}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-blue-400/40 bg-blue-500/20 px-4 text-xs font-bold text-blue-100 disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>{refining ? 'Organizando...' : 'Aplicar Comando IA'}</span>
                      </button>
                    </div>

                    {aiWarnings.length > 0 && (
                      <div className="rounded-lg border border-amber-400/35 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                        <p className="font-bold">Pontos sinalizados antes do fechamento:</p>
                        <ul className="mt-1 list-disc pl-4 space-y-0.5">
                          {aiWarnings.map((w, idx) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Editor do Relatório Narrativo */}
                <div id="nexo-shift-report-editor" className="space-y-2 border-t border-[#AEB8C5]/15 pt-3">
                  <label className="block text-xs font-bold text-[#F5B91B]">
                    Documento Narrativo Oficial do Turno
                  </label>
                  <textarea
                    rows={12}
                    value={editedReportText}
                    onChange={(e) => setEditedReportText(e.target.value)}
                    disabled={!canPrepareHandover || isLockedAfterApproval}
                    className="w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-3.5 font-mono-tabular text-xs leading-relaxed text-[#F4F6F8] disabled:opacity-80"
                  />
                </div>

                {/* Ações de salvamento, envio, finalização e aprovação */}
                <div id="nexo-shift-actions" className="space-y-3 border-t border-[#AEB8C5]/15 pt-3">
                  {canPrepareHandover && !isLockedAfterApproval && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleSaveHandover('RASCUNHO', 'EM_ELABORACAO')}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/30 bg-[#0A1421] px-4 text-xs font-semibold text-[#F4F6F8]"
                      >
                        <Save className="h-4 w-4" />
                        <span>Salvar Rascunho</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveHandover('REVISAO', 'AGUARDANDO_APROVACAO')}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 px-4 text-xs font-semibold text-amber-200"
                      >
                        <ClipboardCheck className="h-4 w-4" />
                        <span>Enviar para Aprovação</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleFinalizeHandover}
                        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-5 text-xs font-extrabold text-[#0A1421]"
                      >
                        <Send className="h-4 w-4" />
                        <span>Finalizar Passagem de Turno</span>
                      </button>
                    </div>
                  )}

                  {canApproveHandover && activeHandover && currentWorkflow !== 'ENCERRADO' && (
                    <div className="rounded-xl border border-emerald-500/35 bg-[#0A1421] p-3.5 space-y-2.5">
                      <p className="text-xs font-bold text-emerald-300">
                        Aprovação Gerencial / Encerramento Oficial do Turno
                      </p>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <input
                          value={approvalNotes}
                          onChange={(e) => setApprovalNotes(e.target.value)}
                          placeholder="Notas de aprovação da supervisão (opcional)..."
                          className="min-h-[40px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                        />
                        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]">
                          <input
                            type="checkbox"
                            checked={closeImmediately}
                            onChange={(e) => setCloseImmediately(e.target.checked)}
                          />
                          <span>Encerrar turno oficialmente após aprovar</span>
                        </label>
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleApproveHandover}
                          className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-emerald-500 px-4 text-xs font-extrabold text-[#0A1421]"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          <span>Aprovar e Travar Versão Oficial</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Histórico de revisões deste turno */}
                  {activeHandover?.revisions && activeHandover.revisions.length > 0 && (
                    <details className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
                      <summary className="cursor-pointer text-xs font-bold text-[#AEB8C5] hover:text-[#F4F6F8]">
                        Histórico de Versões e Revisões Imutáveis ({activeHandover.revisions.length})
                      </summary>
                      <div className="mt-2.5 space-y-2">
                        {activeHandover.revisions.map((rev) => (
                          <div key={rev.id} className="rounded-lg border border-[#AEB8C5]/15 bg-[#101B2A] p-2.5 text-xs">
                            <div className="flex flex-wrap justify-between gap-2">
                              <span className="font-mono-tabular font-bold text-[#F5B91B]">
                                v{rev.version} · {rev.changeType} ({rev.workflowStatus})
                              </span>
                              <span className="text-[11px] text-[#AEB8C5]">
                                {rev.editedByName}
                                {rev.editedByBadge ? ` (Mat. ${rev.editedByBadge})` : ''} ·{' '}
                                {new Date(rev.createdAt).toLocaleString('pt-BR')}
                              </span>
                            </div>
                            {rev.reason && (
                              <p className="mt-1 text-[11px] text-amber-200">Motivo: {rev.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Correção Versionada Pós-Aprovação */}
      {showCorrectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <form
            onSubmit={handleSubmitCorrection}
            className="w-full max-w-2xl rounded-2xl border border-[#F5B91B]/45 bg-[#101B2A] p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Registrar Correção Versionada Pós-Aprovação
              </h3>
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                className="text-xs text-[#AEB8C5] hover:text-[#F4F6F8]"
              >
                Cancelar
              </button>
            </div>
            <p className="text-xs text-[#AEB8C5]">
              A versão aprovada anterior permanecerá preservada integralmente no histórico de revisões.
            </p>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[#F5B91B]">
                Justificativa Obrigatória da Correção (mín. 5 caracteres) *
              </label>
              <input
                required
                minLength={5}
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Ex.: Correção de número da nota fiscal após conferência documental..."
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-[#AEB8C5]">
                Texto Atualizado para Nova Versão *
              </label>
              <textarea
                required
                rows={10}
                value={correctionText}
                onChange={(e) => setCorrectionText(e.target.value)}
                className="w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-3 font-mono-tabular text-xs text-[#F4F6F8]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 px-4 text-xs text-[#AEB8C5]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingCorrection || correctionReason.trim().length < 5}
                className="min-h-[42px] rounded-lg bg-[#F5B91B] px-5 text-xs font-extrabold text-[#0A1421] disabled:opacity-50"
              >
                {savingCorrection ? 'Gravando...' : 'Gravar Nova Versão Auditada'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* SUBTAB 2: PENDÊNCIAS RECEBIDAS & CIÊNCIA */}
      {subTab === 'PENDENCIAS' && (
        <div className="space-y-3">
          {openPendencies.length === 0 ? (
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-8 text-center text-sm text-[#AEB8C5]">
              Nenhuma pendência de turno em aberto ou aguardando ciência no momento.
            </div>
          ) : (
            openPendencies.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono-tabular font-bold text-[#F5B91B]">{p.pendencyCode}</span>
                      <span className="text-[#AEB8C5]">
                        {p.operationalDate} · {p.shiftCode} · {p.sourceType}
                      </span>
                    </div>
                    <h4 className="mt-1 font-display text-sm font-bold text-[#F4F6F8]">{p.title}</h4>
                    <p className="mt-1 text-xs text-[#AEB8C5]">{p.description}</p>
                  </div>

                  <div className="text-right text-xs">
                    <span
                      className={`font-bold ${
                        p.status === 'CIENTE' ? 'text-blue-400' : 'text-amber-400'
                      }`}
                    >
                      {p.status === 'CIENTE' ? 'CIENTE (NÃO CONCLUÍDA)' : 'ABERTA'}
                    </span>
                    {p.acknowledgedByName && (
                      <p className="mt-1 text-[11px] text-[#AEB8C5]">
                        Ciência: {p.acknowledgedByName} (
                        {p.acknowledgedAt ? new Date(p.acknowledgedAt).toLocaleString('pt-BR') : ''})
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[#AEB8C5]/10 pt-3">
                  {p.status === 'ABERTA' && canAcknowledge && (
                    <>
                      <input
                        value={ackNotes[p.id] || ''}
                        onChange={(e) => setAckNotes({ ...ackNotes, [p.id]: e.target.value })}
                        placeholder="Observação da ciência (opcional)..."
                        className="min-h-[44px] flex-1 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                      />
                      <button
                        type="button"
                        onClick={() => handleAcknowledgePendency(p.id)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 text-xs font-semibold text-blue-200"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Registrar Ciência</span>
                      </button>
                    </>
                  )}

                  {canFinalizePendency && (
                    <>
                      <input
                        value={resolveNotes[p.id] || ''}
                        onChange={(e) => setResolveNotes({ ...resolveNotes, [p.id]: e.target.value })}
                        placeholder="Solução executada para concluir definitivamente..."
                        className="min-h-[44px] flex-1 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                      />
                      <button
                        type="button"
                        onClick={() => handleResolvePendency(p.id)}
                        className="min-h-[44px] rounded-lg bg-emerald-500 px-4 text-xs font-bold text-[#0A1421]"
                      >
                        Concluir Pendência
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* SUBTAB 3: HISTÓRICO PRESERVADO */}
      {subTab === 'HISTORICO' && (
        <div className="space-y-3">
          {handovers.length === 0 ? (
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-8 text-center text-sm text-[#AEB8C5]">
              Nenhuma passagem de turno registrada ainda.
            </div>
          ) : (
            handovers.map((h) => (
              <details
                key={h.id}
                className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4"
              >
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono-tabular font-bold text-[#F5B91B]">{h.handoverCode}</span>
                    <span className="font-semibold text-[#F4F6F8]">
                      {h.shiftName} · {formatIsoDatePtBr(h.operationalDate)}
                    </span>
                    <span className="text-[#AEB8C5]">
                      Entrega: {h.handoverByName}
                      {h.handoverByBadge ? ` (Mat. ${h.handoverByBadge})` : ''} → Recebe:{' '}
                      {h.receivedByName || 'Dado não informado'}
                    </span>
                  </div>
                  <span
                    className={`font-bold ${
                      h.workflowStatus === 'ENCERRADO' || h.workflowStatus === 'APROVADO' || h.status === 'FINALIZADA'
                        ? 'text-emerald-400'
                        : h.status === 'REVISAO'
                          ? 'text-amber-400'
                          : 'text-blue-400'
                    }`}
                  >
                    {h.workflowStatus || h.status} (v{h.version})
                  </span>
                </summary>
                <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 font-mono-tabular text-xs leading-relaxed text-[#F4F6F8]">
                  {h.editedReportText || h.autoReportText}
                </pre>
                {h.revisions && h.revisions.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-[#AEB8C5]/15 pt-2.5">
                    <p className="text-[11px] font-bold text-[#F5B91B]">
                      Revisões preservadas ({h.revisions.length}):
                    </p>
                    {h.revisions.map((rev) => (
                      <div key={rev.id} className="rounded-lg border border-[#AEB8C5]/10 bg-[#0A1421] p-2 text-[11px] text-[#AEB8C5]">
                        <span className="font-mono-tabular font-bold text-[#F4F6F8]">v{rev.version}</span> · {rev.changeType} ·{' '}
                        {rev.editedByName} · {new Date(rev.createdAt).toLocaleString('pt-BR')}
                        {rev.reason ? ` — Motivo: ${rev.reason}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </details>
            ))
          )}
        </div>
      )}

      {/* SUBTAB 4: CONFIGURAÇÃO DOS TURNOS */}
      {subTab === 'TURNOS' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {shifts.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono-tabular text-[11px] font-bold text-[#F5B91B]">{s.code}</p>
                    <h4 className="font-display text-base font-bold text-[#F4F6F8]">{s.name}</h4>
                  </div>
                  <span
                    className={`text-[11px] font-bold ${
                      s.isValidated ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {s.isValidated ? 'Validado' : 'Pendente Validação Oficial'}
                  </span>
                </div>

                <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 text-xs space-y-1">
                  <p className="font-mono-tabular text-sm font-bold text-[#F4F6F8]">
                    {s.startTime} às {s.endTime}
                  </p>
                  <p className="text-[#AEB8C5]">
                    {s.crossesMidnight
                      ? 'Cruza meia-noite: preserva data operacional de início após 00:00.'
                      : 'Mesmo dia operacional.'}
                  </p>
                  <p className="text-[#AEB8C5] pt-1">
                    Responsável/Supervisor:{' '}
                    <strong className="text-[#F4F6F8]">
                      {s.responsibleName || s.supervisorName || 'Dado não informado'}
                    </strong>
                  </p>
                  <p className="text-[#AEB8C5]">
                    Operadores vinculados: {s.operators.length > 0 ? s.operators.map((o) => o.displayName).join(', ') : 'Nenhum vinculado'}
                  </p>
                </div>

                {canManageShifts && (
                  <button
                    type="button"
                    onClick={() => startEditShift(s)}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-[#F5B91B]/40 bg-[#F5B91B]/10 text-xs font-bold text-[#F5B91B]"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    <span>Configurar Horário e Responsável</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          {editingShiftCode && canManageShifts && (
            <form
              onSubmit={handleSaveShiftConfig}
              className="rounded-xl border border-[#F5B91B]/40 bg-[#101B2A] p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="font-display text-sm font-bold text-[#F4F6F8]">
                  Editar Configuração — {editingShiftCode}
                </h4>
                <button
                  type="button"
                  onClick={() => setEditingShiftCode(null)}
                  className="text-xs text-[#AEB8C5] hover:text-[#F4F6F8]"
                >
                  Cancelar
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] text-[#AEB8C5]">Início (HH:mm)</label>
                  <input
                    required
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    placeholder="17:00"
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[#AEB8C5]">Término (HH:mm)</label>
                  <input
                    required
                    value={editEndTime}
                    onChange={(e) => setEditEndTime(e.target.value)}
                    placeholder="02:12"
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[#AEB8C5]">Supervisor Vinculado</label>
                  <select
                    value={editSupervisorId}
                    onChange={(e) => setEditSupervisorId(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                  >
                    <option value="">Selecionar usuário...</option>
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName} ({u.roleCode})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[#AEB8C5]">Nome do Responsável</label>
                  <input
                    value={editResponsibleName}
                    onChange={(e) => setEditResponsibleName(e.target.value)}
                    placeholder="Ex.: Supervisor Turno..."
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]">
                  <input
                    type="checkbox"
                    checked={editIsValidated}
                    onChange={(e) => setEditIsValidated(e.target.checked)}
                  />
                  <span>Horários e responsáveis validados oficialmente pela planta</span>
                </label>
                <input
                  required
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Motivo obrigatório da alteração (auditado)..."
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-5 text-xs font-extrabold text-[#0A1421]"
                >
                  <Users className="h-4 w-4" />
                  <span>Salvar Configuração do Turno</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );

  async function handleExportReportShortcut(shiftCodeArg: string, opDateArg: string) {
    setError(null);
    try {
      const file = await apiDownloadFile('/api/reports/export', {
        method: 'POST',
        body: JSON.stringify({
          reportType: 'TURNO',
          format: 'PDF',
          shiftCode: shiftCodeArg,
          operationalDate: opDateArg,
          filters: { preset: 'PERSONALIZADO', startDate: opDateArg, endDate: opDateArg },
        }),
      });
      setStatusMsg(`Relatório do turno exportado: ${file}`);
    } catch (err: any) {
      setError(err.message || 'Falha ao exportar relatório do turno.');
    }
  }
};
