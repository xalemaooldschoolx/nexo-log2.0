import type {
  DailyRubricagemComparisonReport,
  DailyRubricagemComparisonRow,
  RubricagemBatchView,
  RubricagemEntryView,
  RubricagemWorkflowStatus,
  SiloDetail,
  StockControlModel,
} from '../types/nexo.ts';

export const RUBRICAGEM_STATUS_META: Record<
  RubricagemWorkflowStatus,
  { label: string; shortLabel: string; toneClass: string }
> = {
  AGUARDANDO_LEITURA: {
    label: 'Aguardando leitura',
    shortLabel: 'Aguardando leitura',
    toneClass: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
  },
  LEITURA_CONCLUIDA: {
    label: 'Leitura concluída',
    shortLabel: 'Leitura concluída',
    toneClass: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
  },
  AGUARDANDO_CONFERENCIA: {
    label: 'Aguardando conferência',
    shortLabel: 'Aguardando conferência',
    toneClass: 'border-blue-500/40 bg-blue-500/15 text-blue-300',
  },
  DIVERGENCIA_IDENTIFICADA: {
    label: 'Divergência identificada',
    shortLabel: 'Divergência',
    toneClass: 'border-red-500/50 bg-red-500/20 text-red-200',
  },
  AGUARDANDO_AUTORIZACAO: {
    label: 'Aguardando autorização',
    shortLabel: 'Aguardando autorização',
    toneClass: 'border-amber-500/50 bg-amber-500/20 text-amber-200',
  },
  INVENTARIO_CONFIRMADO: {
    label: 'Inventário confirmado',
    shortLabel: 'Inventário confirmado',
    toneClass: 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200',
  },
  HISTORICO_PRESERVADO: {
    label: 'Histórico preservado',
    shortLabel: 'Histórico preservado',
    toneClass: 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200',
  },
};

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function resolveStockControlModel(controlOwner: 'MOEGA' | 'PRODUCAO' | string): StockControlModel {
  return controlOwner === 'PRODUCAO'
    ? 'RUBRICAGEM_DIARIA_FISICA'
    : 'CONTROLE_CONTINUO_MOVIMENTOS';
}

export function convertQuantityToKg(quantityValue: number, unit: 't' | 'kg'): number {
  if (!Number.isFinite(quantityValue) || quantityValue < 0) return 0;
  return unit === 't' ? round3(quantityValue * 1000) : round3(quantityValue);
}

export interface EvaluateRubricagemEntryParams {
  siloNumber: number;
  controlOwner: 'MOEGA' | 'PRODUCAO';
  nominalCapacityKg: number;
  safeCapacityKg: number;
  countedQuantityKg: number;
  systemLedgerKg: number;
  previousConfirmedKg: number | null;
  previousCountAt: string | null;
  intermediateMovementsKg: number;
  needsReview?: boolean;
  reviewNote?: string | null;
}

export interface EvaluatedRubricagemEntryResult {
  stockModel: StockControlModel;
  deltaPhysicalKg: number | null;
  deltaPhysicalPct: number | null;
  deltaVsSystemKg: number;
  hasDivergence: boolean;
  divergenceReason: string | null;
  itemWorkflowStatus: RubricagemWorkflowStatus;
}

/**
 * Avalia uma leitura individual da folha única de rubricagem respeitando rigorosamente
 * os dois modelos distintos:
 * - MOEGA: Estoque Contínuo por Movimentações (rubricagem apenas confere; nunca sobrescreve).
 * - PRODUÇÃO: Estoque Físico Diário por Rubricagem (não inventa consumo nem soma sobre anterior;
 *   apresenta variação líquida observada e exige autorização antes de atualizar referência).
 */
export function evaluateSingleSheetEntry(
  params: EvaluateRubricagemEntryParams
): EvaluatedRubricagemEntryResult {
  const stockModel = resolveStockControlModel(params.controlOwner);
  const counted = round3(params.countedQuantityKg);
  const ledger = round3(params.systemLedgerKg);
  const intermediate = round3(params.intermediateMovementsKg);
  const prev = params.previousConfirmedKg !== null ? round3(params.previousConfirmedKg) : null;

  const deltaVsSystemKg = round3(counted - ledger);
  const deltaPhysicalKg = prev !== null ? round3(counted - prev) : null;
  const deltaPhysicalPct =
    deltaPhysicalKg !== null && prev !== null && prev > 0
      ? round2((deltaPhysicalKg / prev) * 100)
      : null;

  if (params.controlOwner === 'MOEGA') {
    const exceedsCapacity = counted > params.nominalCapacityKg + 1;
    const ledgerDiffers = Math.abs(deltaVsSystemKg) > 1;
    const hasDivergence = exceedsCapacity || ledgerDiffers || Boolean(params.needsReview);

    const reasons: string[] = [];
    if (exceedsCapacity) {
      reasons.push(
        `Leitura (${counted.toLocaleString('pt-BR')} kg) supera capacidade nominal (${params.nominalCapacityKg.toLocaleString('pt-BR')} kg).`
      );
    }
    if (ledgerDiffers) {
      reasons.push(
        `Conferência física da Moega (${counted.toLocaleString('pt-BR')} kg) diverge do estoque contínuo por movimentações (${ledger.toLocaleString('pt-BR')} kg; diferença ${deltaVsSystemKg >= 0 ? '+' : ''}${deltaVsSystemKg.toLocaleString('pt-BR')} kg). Saldo contínuo preservado sem sobrescrita automática.`
      );
    }
    if (params.needsReview) {
      reasons.push(params.reviewNote || 'Leitura marcada para conferência visual.');
    }

    return {
      stockModel,
      deltaPhysicalKg,
      deltaPhysicalPct,
      deltaVsSystemKg,
      hasDivergence,
      divergenceReason: reasons.length > 0 ? reasons.join(' ') : null,
      itemWorkflowStatus: hasDivergence ? 'DIVERGENCIA_IDENTIFICADA' : 'AGUARDANDO_CONFERENCIA',
    };
  }

  // PRODUCAO — Controle por Rubricagem Física Diária
  const exceedsNominal = counted > params.nominalCapacityKg + 1;
  const unexplainedIncrease =
    prev !== null && counted > prev + Math.max(0, intermediate) + 1;
  const intermediateConflict =
    prev !== null &&
    Math.abs(intermediate) > 1 &&
    Math.abs((counted - prev) - intermediate) > 1;

  const hasDivergence =
    exceedsNominal || unexplainedIncrease || intermediateConflict || Boolean(params.needsReview);

  const reasons: string[] = [];
  if (exceedsNominal) {
    reasons.push(
      `Leitura (${counted.toLocaleString('pt-BR')} kg) excede capacidade nominal (${params.nominalCapacityKg.toLocaleString('pt-BR')} kg).`
    );
  }
  if (unexplainedIncrease) {
    reasons.push(
      `Aumento físico observado (${prev?.toLocaleString('pt-BR')} kg → ${counted.toLocaleString('pt-BR')} kg) sem entrada/transferência equivalente registrada (+${intermediate.toLocaleString('pt-BR')} kg).`
    );
  } else if (intermediateConflict) {
    reasons.push(
      `Variação física observada (${deltaPhysicalKg !== null && deltaPhysicalKg >= 0 ? '+' : ''}${deltaPhysicalKg?.toLocaleString('pt-BR')} kg) diverge dos registros intermediários lançados (${intermediate >= 0 ? '+' : ''}${intermediate.toLocaleString('pt-BR')} kg).`
    );
  }
  if (params.needsReview) {
    reasons.push(params.reviewNote || 'Leitura marcada para conferência humana.');
  }

  return {
    stockModel,
    deltaPhysicalKg,
    deltaPhysicalPct,
    deltaVsSystemKg,
    hasDivergence,
    divergenceReason: reasons.length > 0 ? reasons.join(' ') : null,
    itemWorkflowStatus: hasDivergence ? 'DIVERGENCIA_IDENTIFICADA' : 'AGUARDANDO_AUTORIZACAO',
  };
}

export function resolveBatchWorkflowStatus(
  entries: Array<Pick<RubricagemEntryView, 'hasDivergence' | 'itemWorkflowStatus'>>
): RubricagemWorkflowStatus {
  if (entries.length === 0) return 'AGUARDANDO_LEITURA';
  if (entries.some((e) => e.hasDivergence || e.itemWorkflowStatus === 'DIVERGENCIA_IDENTIFICADA')) {
    return 'DIVERGENCIA_IDENTIFICADA';
  }
  if (entries.some((e) => e.itemWorkflowStatus === 'AGUARDANDO_AUTORIZACAO')) {
    return 'AGUARDANDO_AUTORIZACAO';
  }
  if (entries.some((e) => e.itemWorkflowStatus === 'AGUARDANDO_CONFERENCIA')) {
    return 'AGUARDANDO_CONFERENCIA';
  }
  if (entries.every((e) => e.itemWorkflowStatus === 'HISTORICO_PRESERVADO')) {
    return 'HISTORICO_PRESERVADO';
  }
  if (entries.every((e) => e.itemWorkflowStatus === 'INVENTARIO_CONFIRMADO')) {
    return 'INVENTARIO_CONFIRMADO';
  }
  return 'LEITURA_CONCLUIDA';
}

export function buildDailyRubricagemComparisonReport(params: {
  referenceDate: string;
  silos: SiloDetail[];
  batches: RubricagemBatchView[];
  dataOrigin: string;
}): DailyRubricagemComparisonReport {
  const orderedBatches = [...params.batches].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()
  );
  const targetBatch =
    orderedBatches.find((b) => b.referenceDate === params.referenceDate) ??
    orderedBatches[0] ??
    null;

  // Map latest confirmed entry per silo AND latest entry in targetBatch per silo
  const latestBatchEntryBySilo = new Map<number, RubricagemEntryView>();
  if (targetBatch) {
    for (const entry of targetBatch.entries) {
      latestBatchEntryBySilo.set(entry.siloId, entry);
    }
  }

  // Also keep historical confirmed entries per silo across batches to backfill previous when not in current sheet
  const confirmedHistoryBySilo = new Map<number, RubricagemEntryView[]>();
  for (const b of orderedBatches) {
    for (const e of b.entries) {
      if (
        e.itemWorkflowStatus === 'INVENTARIO_CONFIRMADO' ||
        e.itemWorkflowStatus === 'HISTORICO_PRESERVADO'
      ) {
        const list = confirmedHistoryBySilo.get(e.siloId) ?? [];
        list.push(e);
        confirmedHistoryBySilo.set(e.siloId, list);
      }
    }
  }

  const moegaRows: DailyRubricagemComparisonRow[] = [];
  const producaoRows: DailyRubricagemComparisonRow[] = [];

  const sortedSilos = [...params.silos].sort((a, b) => a.rubricOrder - b.rubricOrder);
  for (const s of sortedSilos) {
    const model = resolveStockControlModel(s.controlOwner);
    const currentEntry = latestBatchEntryBySilo.get(s.id) ?? null;
    const confirmedHist = confirmedHistoryBySilo.get(s.id) ?? [];
    const latestConfirmed = confirmedHist[0] ?? null;
    const priorConfirmed = confirmedHist[1] ?? null;

    const prevKg =
      currentEntry !== null
        ? currentEntry.previousConfirmedKg
        : priorConfirmed
          ? priorConfirmed.countedQuantityKg
          : s.previousPhysicalCountKg ?? null;

    const prevAt =
      currentEntry !== null
        ? currentEntry.previousCountAt
        : priorConfirmed
          ? priorConfirmed.confirmedAt || priorConfirmed.createdAt
          : s.previousPhysicalCountAt ?? null;

    const newKg =
      currentEntry !== null
        ? currentEntry.countedQuantityKg
        : latestConfirmed
          ? latestConfirmed.countedQuantityKg
          : s.lastPhysicalCountKg ?? null;

    const currAt =
      currentEntry !== null
        ? targetBatch?.capturedAt || currentEntry.createdAt
        : latestConfirmed
          ? latestConfirmed.confirmedAt || latestConfirmed.createdAt
          : s.lastPhysicalCountAt ?? null;

    const varKg =
      currentEntry !== null
        ? currentEntry.deltaPhysicalKg
        : prevKg !== null && newKg !== null
          ? round3(newKg - prevKg)
          : s.physicalVariationKg ?? null;

    const varTons = varKg !== null ? round3(varKg / 1000) : null;
    const varPct =
      currentEntry !== null
        ? currentEntry.deltaPhysicalPct
        : varKg !== null && prevKg !== null && prevKg > 0
          ? round2((varKg / prevKg) * 100)
          : s.physicalVariationPct ?? null;

    const ledgerKg = s.ledgerStockKg ?? s.confirmedStockKg;
    const deltaSystem =
      currentEntry !== null
        ? currentEntry.deltaVsSystemKg
        : newKg !== null
          ? round3(newKg - ledgerKg)
          : null;

    const conferenceStatus: RubricagemWorkflowStatus =
      currentEntry?.itemWorkflowStatus ??
      s.rubricagemStatus ??
      (latestConfirmed ? 'INVENTARIO_CONFIRMADO' : 'AGUARDANDO_LEITURA');

    const row: DailyRubricagemComparisonRow = {
      siloId: s.id,
      siloNumber: s.siloNumber,
      rubricOrder: s.rubricOrder,
      lineCode: s.lineCode,
      category: s.category,
      controlOwner: s.controlOwner,
      stockControlModel: model,
      materialCode: s.materialCode,
      materialDescription: s.materialDescription,
      activeStockKg: s.confirmedStockKg,
      ledgerStockKg: ledgerKg,
      previousRubricagemKg: prevKg,
      newRubricagemKg: newKg,
      variationKg: varKg,
      variationTons: varTons,
      variationPct: varPct,
      previousCountAt: prevAt,
      currentCountAt: currAt,
      deltaVsSystemKg: deltaSystem,
      conferenceStatus,
      hasDivergence: currentEntry?.hasDivergence ?? false,
      divergenceReason: currentEntry?.divergenceReason ?? null,
      batchCode: currentEntry && targetBatch ? targetBatch.batchCode : null,
      occurrenceId: currentEntry?.occurrenceId ?? null,
    };

    if (s.controlOwner === 'PRODUCAO') {
      producaoRows.push(row);
    } else {
      moegaRows.push(row);
    }
  }

  return {
    referenceDate: params.referenceDate,
    generatedAtIso: new Date().toISOString(),
    dataOrigin: params.dataOrigin,
    activeBatchSummary: targetBatch
      ? {
          batchId: targetBatch.id,
          batchCode: targetBatch.batchCode,
          capturedAt: targetBatch.capturedAt,
          workflowStatus: targetBatch.workflowStatus,
          moegaCount: targetBatch.moegaCount,
          producaoCount: targetBatch.producaoCount,
          divergenceCount: targetBatch.divergenceCount,
          importedByName: targetBatch.importedByName,
          authorizedByName: targetBatch.authorizedByName,
          authorizedAt: targetBatch.authorizedAt,
        }
      : null,
    moegaContinuousSection: {
      title: 'ESTOQUE CONTÍNUO DA MOEGA (Controle por Movimentações)',
      ruleDescription:
        'Saldo calculado exclusivamente pelas movimentações operacionais (recebimentos, distribuições, transferências, abastecimentos, saídas e ajustes autorizados). A rubricagem importada atua apenas como conferência física e nunca sobrescreve o saldo automaticamente.',
      totalLedgerStockKg: round3(moegaRows.reduce((a, r) => a + r.ledgerStockKg, 0)),
      totalSafeCapacityKg: round3(
        sortedSilos
          .filter((s) => s.controlOwner === 'MOEGA')
          .reduce((a, s) => a + s.safeCapacityKg, 0)
      ),
      silosCount: moegaRows.length,
      checkedInSheetCount: moegaRows.filter((r) => r.newRubricagemKg !== null).length,
      divergenceCount: moegaRows.filter((r) => r.hasDivergence).length,
      rows: moegaRows,
    },
    producaoPhysicalSection: {
      title: 'ESTOQUE FÍSICO DIÁRIO DA PRODUÇÃO (Controle por Rubricagem)',
      ruleDescription:
        'Saldo mantido pelo último inventário físico confirmado via rubricagem diária com data e hora. A variação líquida entre contagens é exibida para conferência sem inventar consumo intermediário; a referência só muda após autorização formal.',
      totalConfirmedPhysicalKg: round3(producaoRows.reduce((a, r) => a + r.activeStockKg, 0)),
      totalSafeCapacityKg: round3(
        sortedSilos
          .filter((s) => s.controlOwner === 'PRODUCAO')
          .reduce((a, s) => a + s.safeCapacityKg, 0)
      ),
      silosCount: producaoRows.length,
      checkedInSheetCount: producaoRows.filter((r) => r.newRubricagemKg !== null).length,
      confirmedCount: producaoRows.filter((r) => r.conferenceStatus === 'INVENTARIO_CONFIRMADO')
        .length,
      pendingAuthorizationCount: producaoRows.filter(
        (r) =>
          r.conferenceStatus === 'AGUARDANDO_AUTORIZACAO' ||
          r.conferenceStatus === 'DIVERGENCIA_IDENTIFICADA' ||
          r.conferenceStatus === 'AGUARDANDO_CONFERENCIA'
      ).length,
      divergenceCount: producaoRows.filter((r) => r.hasDivergence).length,
      rows: producaoRows,
    },
  };
}
