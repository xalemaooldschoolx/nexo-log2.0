export type ConfidenceLevel = 'ALTA' | 'MEDIA' | 'BAIXA' | 'MANUAL';

export type ExecutionStatus =
  | 'NAO_INICIADA'
  | 'EM_ANDAMENTO'
  | 'CONCLUIDA'
  | 'ATRASADA'
  | 'ADIANTADA'
  | 'INTERROMPIDA';

export type AlertPriority = 'VERMELHO' | 'LARANJA' | 'AZUL' | 'VERDE';

export interface ProductConsumptionFactorSnapshot {
  id: number;
  productId: number;
  materialId: number;
  factorKgPerUnit: number;
  unit: string;
  validationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO';
  sourceReference: string | null;
}

export interface DeterministicConsumptionResult {
  materialId: number | null;
  factorId: number | null;
  factorUsed: number | null;
  calculatedConsumptionKg: number;
  calculationStatus: 'CALCULADO' | 'PENDENTE_FATOR';
  originSource:
    | 'FATOR_PRODUTO_VALIDADO'
    | 'MATERIA_PRIMA_DIRETA'
    | 'FATOR_AUSENTE_OU_PENDENTE';
}

export function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

/**
 * Calcula o consumo previsto de matérias-primas de forma estritamente determinística.
 * Nunca cria fator por suposição: se não houver fator validado e unidade compatível,
 * marca como PENDENTE_FATOR.
 */
export function calculateDeterministicConsumption(params: {
  plannedQuantity: number;
  plannedUnit: string;
  productId: number | null;
  directMaterialId: number | null;
  validatedFactors: ProductConsumptionFactorSnapshot[];
}): DeterministicConsumptionResult[] {
  const qty = Number(params.plannedQuantity);
  const unit = params.plannedUnit.trim().toLowerCase();

  if (!Number.isFinite(qty) || qty <= 0) {
    return [
      {
        materialId: params.directMaterialId ?? null,
        factorId: null,
        factorUsed: null,
        calculatedConsumptionKg: 0,
        calculationStatus: 'PENDENTE_FATOR',
        originSource: 'FATOR_AUSENTE_OU_PENDENTE',
      },
    ];
  }

  // Caso 1: item aponta diretamente uma matéria-prima em kg ou t
  if (params.directMaterialId && (unit === 'kg' || unit === 't' || unit === 'ton')) {
    const multiplier = unit === 'kg' ? 1 : 1000;
    return [
      {
        materialId: params.directMaterialId,
        factorId: null,
        factorUsed: multiplier,
        calculatedConsumptionKg: round3(qty * multiplier),
        calculationStatus: 'CALCULADO',
        originSource: 'MATERIA_PRIMA_DIRETA',
      },
    ];
  }

  // Caso 2: item aponta um produto com fatores validados cadastrados
  if (params.productId) {
    const validForProduct = params.validatedFactors.filter(
      (f) => f.productId === params.productId && f.validationStatus === 'VALIDADO'
    );

    if (validForProduct.length > 0) {
      return validForProduct.map((factor) => {
        const factorUnit = factor.unit.trim().toLowerCase();
        let convertedQty: number | null = null;

        if (factorUnit === unit) {
          convertedQty = qty;
        } else if ((factorUnit === 't' || factorUnit === 'ton') && unit === 'kg') {
          convertedQty = qty / 1000;
        } else if (factorUnit === 'kg' && (unit === 't' || unit === 'ton')) {
          convertedQty = qty * 1000;
        }

        if (convertedQty === null) {
          return {
            materialId: factor.materialId,
            factorId: factor.id,
            factorUsed: null,
            calculatedConsumptionKg: 0,
            calculationStatus: 'PENDENTE_FATOR',
            originSource: 'FATOR_AUSENTE_OU_PENDENTE',
          };
        }

        return {
          materialId: factor.materialId,
          factorId: factor.id,
          factorUsed: factor.factorKgPerUnit,
          calculatedConsumptionKg: round3(convertedQty * factor.factorKgPerUnit),
          calculationStatus: 'CALCULADO',
          originSource: 'FATOR_PRODUTO_VALIDADO',
        };
      });
    }
  }

  return [
    {
      materialId: params.directMaterialId ?? null,
      factorId: null,
      factorUsed: null,
      calculatedConsumptionKg: 0,
      calculationStatus: 'PENDENTE_FATOR',
      originSource: 'FATOR_AUSENTE_OU_PENDENTE',
    },
  ];
}

export interface RevisionItemSnapshot {
  lineCode: string;
  productCode: string;
  productDescription: string;
  plannedQuantity: number;
  plannedUnit: string;
  materialCode?: string | null;
  consumptionKg?: number;
}

export interface ScheduleRevisionDiff {
  hasPreviousRevision: boolean;
  hasChanges: boolean;
  alertTitle: string | null;
  itemChanges: Array<{
    lineCode: string;
    changeType: 'ADICIONADO' | 'REMOVIDO' | 'ALTERADO';
    previousProduct: string | null;
    newProduct: string | null;
    previousQuantity: number | null;
    newQuantity: number | null;
    unit: string;
  }>;
  materialImpacts: Array<{
    materialCode: string;
    previousKg: number;
    newKg: number;
    deltaKg: number;
  }>;
  summaryText: string;
}

/**
 * Compara a nova programação com a revisão anterior da mesma data,
 * detectando linhas alteradas, troca de produto/quantidade e impacto no consumo.
 */
export function diffScheduleRevisions(
  previousItems: RevisionItemSnapshot[] | null,
  newItems: RevisionItemSnapshot[]
): ScheduleRevisionDiff {
  if (!previousItems || previousItems.length === 0) {
    return {
      hasPreviousRevision: false,
      hasChanges: false,
      alertTitle: null,
      itemChanges: [],
      materialImpacts: [],
      summaryText: 'Primeira revisão aprovada para a data.',
    };
  }

  const prevByKey = new Map<string, RevisionItemSnapshot>();
  for (const item of previousItems) {
    const key = `${item.lineCode}::${item.productCode}`;
    const existing = prevByKey.get(key);
    if (existing) {
      existing.plannedQuantity = round3(existing.plannedQuantity + item.plannedQuantity);
      existing.consumptionKg = round3((existing.consumptionKg || 0) + (item.consumptionKg || 0));
    } else {
      prevByKey.set(key, { ...item });
    }
  }

  const nextByKey = new Map<string, RevisionItemSnapshot>();
  for (const item of newItems) {
    const key = `${item.lineCode}::${item.productCode}`;
    const existing = nextByKey.get(key);
    if (existing) {
      existing.plannedQuantity = round3(existing.plannedQuantity + item.plannedQuantity);
      existing.consumptionKg = round3((existing.consumptionKg || 0) + (item.consumptionKg || 0));
    } else {
      nextByKey.set(key, { ...item });
    }
  }

  const itemChanges: ScheduleRevisionDiff['itemChanges'] = [];

  for (const [key, prev] of prevByKey.entries()) {
    const next = nextByKey.get(key);
    if (!next) {
      itemChanges.push({
        lineCode: prev.lineCode,
        changeType: 'REMOVIDO',
        previousProduct: `${prev.productCode} — ${prev.productDescription}`,
        newProduct: null,
        previousQuantity: prev.plannedQuantity,
        newQuantity: null,
        unit: prev.plannedUnit,
      });
    } else if (
      Math.abs(prev.plannedQuantity - next.plannedQuantity) > 0.001 ||
      prev.plannedUnit !== next.plannedUnit
    ) {
      itemChanges.push({
        lineCode: next.lineCode,
        changeType: 'ALTERADO',
        previousProduct: `${prev.productCode} — ${prev.productDescription}`,
        newProduct: `${next.productCode} — ${next.productDescription}`,
        previousQuantity: prev.plannedQuantity,
        newQuantity: next.plannedQuantity,
        unit: next.plannedUnit,
      });
    }
  }

  for (const [key, next] of nextByKey.entries()) {
    if (!prevByKey.has(key)) {
      itemChanges.push({
        lineCode: next.lineCode,
        changeType: 'ADICIONADO',
        previousProduct: null,
        newProduct: `${next.productCode} — ${next.productDescription}`,
        previousQuantity: null,
        newQuantity: next.plannedQuantity,
        unit: next.plannedUnit,
      });
    }
  }

  const prevMatTotals = new Map<string, number>();
  for (const it of previousItems) {
    if (it.materialCode && it.consumptionKg) {
      prevMatTotals.set(
        it.materialCode,
        round3((prevMatTotals.get(it.materialCode) || 0) + it.consumptionKg)
      );
    }
  }
  const nextMatTotals = new Map<string, number>();
  for (const it of newItems) {
    if (it.materialCode && it.consumptionKg) {
      nextMatTotals.set(
        it.materialCode,
        round3((nextMatTotals.get(it.materialCode) || 0) + it.consumptionKg)
      );
    }
  }

  const allMatCodes = Array.from(new Set([...prevMatTotals.keys(), ...nextMatTotals.keys()]));
  const materialImpacts = allMatCodes
    .map((materialCode) => {
      const previousKg = prevMatTotals.get(materialCode) || 0;
      const newKg = nextMatTotals.get(materialCode) || 0;
      return {
        materialCode,
        previousKg,
        newKg,
        deltaKg: round3(newKg - previousKg),
      };
    })
    .filter((m) => Math.abs(m.deltaKg) > 0.001);

  const hasChanges = itemChanges.length > 0 || materialImpacts.length > 0;
  const affectedLines = Array.from(new Set(itemChanges.map((c) => c.lineCode)));

  return {
    hasPreviousRevision: true,
    hasChanges,
    alertTitle: hasChanges ? 'NOVA REVISÃO DA PROGRAMAÇÃO IDENTIFICADA.' : null,
    itemChanges,
    materialImpacts,
    summaryText: hasChanges
      ? `NOVA REVISÃO DA PROGRAMAÇÃO IDENTIFICADA. Linhas alteradas: ${affectedLines.join(', ') || 'Sem troca de linha'} (${itemChanges.length} alterações).`
      : 'Revisão idêntica à anterior.',
  };
}

export interface SiloCoverageInput {
  id: number;
  siloNumber: number;
  lineCode: string;
  category: string;
  controlOwner: string;
  primaryMaterialId: number | null;
  operationalStatus: string;
  nominalCapacityKg: number;
  safeCapacityKg: number;
  confirmedStockKg: number;
  compatibleMaterialIds: number[];
}

export interface SiloMaterialStockInput {
  siloId: number;
  materialId: number;
  netKg: number;
}

export interface MaterialSummaryInput {
  id: number;
  code: string;
  description: string;
  isCritical: boolean;
}

export interface TransferRuleCoverageInput {
  id: number;
  originSiloId: number;
  destinationSiloId: number;
  materialId: number;
  maxQuantityKg: number | null;
  validationStatus: string;
  isActive: boolean;
}

export interface PendingReceiptInput {
  id: number;
  receiptNumber: string;
  materialId: number;
  remainingQuantityKg: number;
  entryDate: string;
  status: string;
}

export interface ProjectionDemandInput {
  scheduleId: number;
  scheduleItemId: number;
  referenceDate: string;
  lineCode: string;
  materialId: number | null;
  calculatedConsumptionKg: number;
  realizedConsumptionKg: number;
  calculationStatus: 'CALCULADO' | 'PENDENTE_FATOR';
  executionStatus: ExecutionStatus;
}

export interface StockThresholdInput {
  materialId: number;
  siloId: number | null;
  minStockKg: number;
  warningStockKg: number;
}

export interface MaterialIntelligenceRow {
  materialId: number;
  materialCode: string;
  materialDescription: string;
  isCritical: boolean;
  // 3 indicadores estritamente separados
  realStockKg: number;
  confirmedPendingEntriesKg: number;
  plannedConsumptionTodayKg: number;
  plannedConsumptionTomorrowKg: number;
  plannedConsumptionFutureKg: number;
  advancedConsumptionKg: number;
  overdueConsumptionKg: number;
  realizedConsumptionKg: number;
  remainingPlannedTodayActiveKg: number;
  remainingTotalPlannedKg: number;
  projectedBalanceTodayKg: number;
  projectedBalanceWithTomorrowKg: number;
  minStockKg: number | null;
  warningStockKg: number | null;
  pendingFactorItemsCount: number;
  statusPriority: AlertPriority;
  statusHeadline: string;
}

export interface LineCoverageAlertAndSuggestion {
  recommendationKey: string;
  recommendationType: 'ABASTECER_SILO' | 'TRANSFERIR_SILO' | 'PROGRAMAR_RECEBIMENTO' | 'REVISAR_FATOR';
  priority: AlertPriority;
  title: string;
  reason: string;
  referenceDate: string;
  lineCode: string | null;
  materialId: number | null;
  materialCode: string | null;
  materialDescription: string | null;
  targetSiloId: number | null;
  targetSiloNumber: number | null;
  originSiloId: number | null;
  originSiloNumber: number | null;
  requiredKg: number;
  availableKg: number;
  missingKg: number;
  suggestedTransferKg: number | null;
  dataSourceSummary: string;
  alternativesSummary: string[];
}

export interface OperationalIntelligenceAnalysis {
  todayDate: string;
  tomorrowDate: string;
  totals: {
    realStockKg: number;
    confirmedPendingEntriesKg: number;
    plannedConsumptionTodayKg: number;
    plannedConsumptionTomorrowKg: number;
    realizedConsumptionKg: number;
    projectedBalanceTotalKg: number;
    criticalMaterialsCount: number;
    pendingSupplyCount: number;
  };
  byMaterial: MaterialIntelligenceRow[];
  alerts: Array<{
    key: string;
    priority: AlertPriority;
    title: string;
    message: string;
    materialCode: string | null;
    lineCode: string | null;
    siloNumber: number | null;
    referenceDate: string;
  }>;
  recommendations: LineCoverageAlertAndSuggestion[];
}

/**
 * Motor central da Fase 3:
 * Confronta ESTOQUE REAL (livro razão), ENTRADAS CONFIRMADAS PENDENTES e CONSUMO PREVISTO
 * para calcular SALDO PROJETADO sem alterar o estoque físico e sugerir transferências apenas
 * por rotas homologadas na matriz.
 */
export function computeOperationalIntelligence(params: {
  todayDate: string;
  tomorrowDate: string;
  silos: SiloCoverageInput[];
  siloMaterialStocks?: SiloMaterialStockInput[];
  materials: MaterialSummaryInput[];
  transferRules: TransferRuleCoverageInput[];
  pendingConfirmedReceipts: PendingReceiptInput[];
  projections: ProjectionDemandInput[];
  thresholds: StockThresholdInput[];
}): OperationalIntelligenceAnalysis {
  const {
    todayDate,
    tomorrowDate,
    silos,
    siloMaterialStocks,
    materials,
    transferRules,
    pendingConfirmedReceipts,
    projections,
    thresholds,
  } = params;

  const siloById = new Map(silos.map((s) => [s.id, s]));
  const materialById = new Map(materials.map((m) => [m.id, m]));

  // Estoque real por (siloId, materialId)
  const stockBySiloMat = new Map<string, number>();
  const stockByMaterial = new Map<number, number>();

  if (siloMaterialStocks && siloMaterialStocks.length > 0) {
    for (const entry of siloMaterialStocks) {
      if (entry.netKg <= 0) continue;
      const key = `${entry.siloId}::${entry.materialId}`;
      stockBySiloMat.set(key, round3((stockBySiloMat.get(key) || 0) + entry.netKg));
      stockByMaterial.set(
        entry.materialId,
        round3((stockByMaterial.get(entry.materialId) || 0) + entry.netKg)
      );
    }
  } else {
    for (const silo of silos) {
      if (silo.primaryMaterialId && silo.confirmedStockKg > 0) {
        const key = `${silo.id}::${silo.primaryMaterialId}`;
        stockBySiloMat.set(key, round3(silo.confirmedStockKg));
        stockByMaterial.set(
          silo.primaryMaterialId,
          round3((stockByMaterial.get(silo.primaryMaterialId) || 0) + silo.confirmedStockKg)
        );
      }
    }
  }

  // Entradas futuras confirmadas (descargas pendentes de recebimentos reais, deduplicadas por ID)
  const seenReceiptIds = new Set<number>();
  const pendingEntriesByMat = new Map<number, number>();
  for (const r of pendingConfirmedReceipts) {
    if (seenReceiptIds.has(r.id)) continue;
    seenReceiptIds.add(r.id);
    if (r.status !== 'PENDENTE' && r.status !== 'PARCIAL') continue;
    if (r.remainingQuantityKg <= 0) continue;
    pendingEntriesByMat.set(
      r.materialId,
      round3((pendingEntriesByMat.get(r.materialId) || 0) + r.remainingQuantityKg)
    );
  }

  // Demanda por matéria-prima separando hoje, amanhã, adiantada e atrasada
  const relevantMaterialIds = new Set<number>();
  for (const mId of stockByMaterial.keys()) relevantMaterialIds.add(mId);
  for (const mId of pendingEntriesByMat.keys()) relevantMaterialIds.add(mId);
  for (const p of projections) {
    if (p.materialId) relevantMaterialIds.add(p.materialId);
  }
  for (const t of thresholds) {
    relevantMaterialIds.add(t.materialId);
  }

  const byMaterial: MaterialIntelligenceRow[] = [];
  const alerts: OperationalIntelligenceAnalysis['alerts'] = [];
  const recommendations: LineCoverageAlertAndSuggestion[] = [];

  for (const matId of relevantMaterialIds) {
    const mat = materialById.get(matId);
    if (!mat) continue;

    const matProjections = projections.filter((p) => p.materialId === matId);
    const realStockKg = round3(stockByMaterial.get(matId) || 0);
    const confirmedPendingEntriesKg = round3(pendingEntriesByMat.get(matId) || 0);

    let plannedConsumptionTodayKg = 0;
    let plannedConsumptionTomorrowKg = 0;
    let plannedConsumptionFutureKg = 0;
    let advancedConsumptionKg = 0;
    let overdueConsumptionKg = 0;
    let realizedConsumptionKg = 0;
    let remainingPlannedTodayActiveKg = 0;
    let remainingTotalPlannedKg = 0;
    let pendingFactorItemsCount = 0;

    for (const p of matProjections) {
      if (p.calculationStatus === 'PENDENTE_FATOR') {
        pendingFactorItemsCount += 1;
        continue;
      }

      const calc = p.calculatedConsumptionKg;
      const realized = p.realizedConsumptionKg;
      realizedConsumptionKg = round3(realizedConsumptionKg + realized);

      // Se concluída por informação validada, não consome mais saldo restante
      const remaining =
        p.executionStatus === 'CONCLUIDA' ? 0 : round3(Math.max(0, calc - realized));

      if (p.referenceDate === todayDate) {
        plannedConsumptionTodayKg = round3(plannedConsumptionTodayKg + calc);
        remainingPlannedTodayActiveKg = round3(remainingPlannedTodayActiveKg + remaining);
      } else if (p.referenceDate < todayDate) {
        // Nunca assume conclusão automática apenas porque a data passou (Regra 13)
        if (p.executionStatus !== 'CONCLUIDA') {
          overdueConsumptionKg = round3(overdueConsumptionKg + remaining);
          remainingPlannedTodayActiveKg = round3(remainingPlannedTodayActiveKg + remaining);
        }
      } else if (p.referenceDate === tomorrowDate) {
        plannedConsumptionTomorrowKg = round3(plannedConsumptionTomorrowKg + calc);
        if (p.executionStatus === 'ADIANTADA') {
          advancedConsumptionKg = round3(advancedConsumptionKg + remaining);
          remainingPlannedTodayActiveKg = round3(remainingPlannedTodayActiveKg + remaining);
        }
      } else {
        plannedConsumptionFutureKg = round3(plannedConsumptionFutureKg + calc);
        if (p.executionStatus === 'ADIANTADA') {
          advancedConsumptionKg = round3(advancedConsumptionKg + remaining);
          remainingPlannedTodayActiveKg = round3(remainingPlannedTodayActiveKg + remaining);
        }
      }

      remainingTotalPlannedKg = round3(remainingTotalPlannedKg + remaining);
    }

    const projectedBalanceTodayKg = round3(
      realStockKg + confirmedPendingEntriesKg - remainingPlannedTodayActiveKg
    );
    const projectedBalanceWithTomorrowKg = round3(
      realStockKg + confirmedPendingEntriesKg - remainingTotalPlannedKg
    );

    const globalThreshold = thresholds.find((t) => t.materialId === matId && t.siloId === null);
    const minStockKg = globalThreshold ? globalThreshold.minStockKg : null;
    const warningStockKg = globalThreshold ? globalThreshold.warningStockKg : null;

    let statusPriority: AlertPriority = 'VERDE';
    let statusHeadline = 'Estoque suficiente para a programação considerada.';

    if (projectedBalanceTodayKg < 0) {
      statusPriority = 'VERMELHO';
      statusHeadline = `Estoque insuficiente para a programação ativa (déficit de ${Math.abs(projectedBalanceTodayKg).toFixed(0)} kg).`;
      alerts.push({
        key: `DEFICIT_HOJE_${matId}`,
        priority: 'VERMELHO',
        title: `Falta prevista de ${mat.description} (${mat.code})`,
        message: statusHeadline,
        materialCode: mat.code,
        lineCode: null,
        siloNumber: null,
        referenceDate: todayDate,
      });
    } else if (projectedBalanceWithTomorrowKg < 0 && remainingPlannedTodayActiveKg >= 0) {
      statusPriority = 'LARANJA';
      statusHeadline =
        'ESTOQUE SUFICIENTE PARA A PROGRAMAÇÃO DE HOJE, MAS INSUFICIENTE PARA AMANHÃ.';
      alerts.push({
        key: `DEFICIT_AMANHA_${matId}`,
        priority: 'LARANJA',
        title: `Risco para amanhã — ${mat.description}`,
        message: statusHeadline,
        materialCode: mat.code,
        lineCode: null,
        siloNumber: null,
        referenceDate: tomorrowDate,
      });
      recommendations.push({
        recommendationKey: `REC_TOMORROW_${matId}_${tomorrowDate}`,
        recommendationType: 'PROGRAMAR_RECEBIMENTO',
        priority: 'LARANJA',
        title: `PROGRAMAR RECEBIMENTO DE ${mat.description}.`,
        reason:
          'ESTOQUE SUFICIENTE PARA A PROGRAMAÇÃO DE HOJE, MAS INSUFICIENTE PARA AMANHÃ.',
        referenceDate: tomorrowDate,
        lineCode: null,
        materialId: matId,
        materialCode: mat.code,
        materialDescription: mat.description,
        targetSiloId: null,
        targetSiloNumber: null,
        originSiloId: null,
        originSiloNumber: null,
        requiredKg: remainingTotalPlannedKg,
        availableKg: round3(realStockKg + confirmedPendingEntriesKg),
        missingKg: round3(Math.abs(projectedBalanceWithTomorrowKg)),
        suggestedTransferKg: null,
        dataSourceSummary: `Estoque real: ${realStockKg} kg | Descargas pendentes confirmadas: ${confirmedPendingEntriesKg} kg | Consumo total previsto: ${remainingTotalPlannedKg} kg.`,
        alternativesSummary: [],
      });
    } else if (minStockKg !== null && projectedBalanceWithTomorrowKg < minStockKg) {
      statusPriority = 'VERMELHO';
      statusHeadline = `Saldo projetado (${projectedBalanceWithTomorrowKg.toFixed(0)} kg) abaixo do limite mínimo (${minStockKg.toFixed(0)} kg).`;
      alerts.push({
        key: `MIN_STOCK_${matId}`,
        priority: 'VERMELHO',
        title: `Abaixo do mínimo configurado — ${mat.description}`,
        message: statusHeadline,
        materialCode: mat.code,
        lineCode: null,
        siloNumber: null,
        referenceDate: todayDate,
      });
    } else if (warningStockKg !== null && projectedBalanceWithTomorrowKg < warningStockKg) {
      statusPriority = 'LARANJA';
      statusHeadline = `Estoque próximo do mínimo configurado (${warningStockKg.toFixed(0)} kg).`;
      alerts.push({
        key: `WARN_STOCK_${matId}`,
        priority: 'LARANJA',
        title: `Estoque em atenção — ${mat.description}`,
        message: statusHeadline,
        materialCode: mat.code,
        lineCode: null,
        siloNumber: null,
        referenceDate: todayDate,
      });
    } else if (pendingFactorItemsCount > 0) {
      statusPriority = 'LARANJA';
      statusHeadline = `${pendingFactorItemsCount} item(ns) com fator de consumo pendente de validação.`;
    } else if (confirmedPendingEntriesKg > 0) {
      statusPriority = 'AZUL';
      statusHeadline = `Inclui ${confirmedPendingEntriesKg.toFixed(0)} kg em recebimentos confirmados com descarga pendente.`;
    }

    if (advancedConsumptionKg > 0) {
      alerts.push({
        key: `ADIANTADA_${matId}`,
        priority: 'LARANJA',
        title: `Produção adiantada detectada — ${mat.description}`,
        message: `${advancedConsumptionKg.toFixed(0)} kg da programação futura foram antecipados para a demanda ativa.`,
        materialCode: mat.code,
        lineCode: null,
        siloNumber: null,
        referenceDate: todayDate,
      });
    }

    if (overdueConsumptionKg > 0) {
      alerts.push({
        key: `ATRASADA_${matId}`,
        priority: 'LARANJA',
        title: `Programação anterior ainda em aberto — ${mat.description}`,
        message: `${overdueConsumptionKg.toFixed(0)} kg de data anterior permanecem pendentes de conclusão validada.`,
        materialCode: mat.code,
        lineCode: null,
        siloNumber: null,
        referenceDate: todayDate,
      });
    }

    byMaterial.push({
      materialId: matId,
      materialCode: mat.code,
      materialDescription: mat.description,
      isCritical: mat.isCritical,
      realStockKg,
      confirmedPendingEntriesKg,
      plannedConsumptionTodayKg,
      plannedConsumptionTomorrowKg,
      plannedConsumptionFutureKg,
      advancedConsumptionKg,
      overdueConsumptionKg,
      realizedConsumptionKg,
      remainingPlannedTodayActiveKg,
      remainingTotalPlannedKg,
      projectedBalanceTodayKg,
      projectedBalanceWithTomorrowKg,
      minStockKg,
      warningStockKg,
      pendingFactorItemsCount,
      statusPriority,
      statusHeadline,
    });

    // Análise por Linha & Silo (Confronto de linha com rotas de transferência autorizadas)
    const activeByLine = new Map<string, number>();
    for (const p of matProjections) {
      if (p.calculationStatus !== 'CALCULADO' || p.executionStatus === 'CONCLUIDA') continue;
      const isTodayOrActive =
        p.referenceDate <= todayDate || p.executionStatus === 'ADIANTADA';
      if (!isTodayOrActive) continue;
      const rem = round3(Math.max(0, p.calculatedConsumptionKg - p.realizedConsumptionKg));
      if (rem > 0) {
        activeByLine.set(p.lineCode, round3((activeByLine.get(p.lineCode) || 0) + rem));
      }
    }

    for (const [lineCode, lineReqKg] of activeByLine.entries()) {
      const lineCompatibleSilos = silos.filter(
        (s) =>
          s.lineCode === lineCode &&
          (s.compatibleMaterialIds.includes(matId) || s.primaryMaterialId === matId)
      );

      if (lineCompatibleSilos.length === 0) {
        alerts.push({
          key: `NO_SILO_${lineCode}_${matId}`,
          priority: 'VERMELHO',
          title: `Nenhum silo compatível na linha ${lineCode} para ${mat.description}`,
          message: `Linha ${lineCode} requer ${lineReqKg.toFixed(0)} kg de ${mat.description}, mas não há silo compatível vinculado.`,
          materialCode: mat.code,
          lineCode,
          siloNumber: null,
          referenceDate: todayDate,
        });
        continue;
      }

      const lineStockKg = lineCompatibleSilos.reduce((acc, s) => {
        const sMatKg = stockBySiloMat.get(`${s.id}::${matId}`) || 0;
        return round3(acc + sMatKg);
      }, 0);

      if (lineStockKg < lineReqKg) {
        const missingKg = round3(lineReqKg - lineStockKg);
        const primaryTarget =
          lineCompatibleSilos.find((s) => s.operationalStatus === 'OPERACIONAL') ||
          lineCompatibleSilos[0];

        // Buscar EXCLUSIVAMENTE rotas ativas e validadas para o mesmo material
        const authorizedRoutes = transferRules.filter(
          (r) =>
            r.isActive &&
            r.validationStatus === 'VALIDADO' &&
            r.materialId === matId &&
            lineCompatibleSilos.some((dest) => dest.id === r.destinationSiloId)
        );

        let foundTransferRoute = false;
        const alternativesSummary: string[] = [];

        for (const route of authorizedRoutes) {
          const origin = siloById.get(route.originSiloId);
          const dest = siloById.get(route.destinationSiloId);
          if (!origin || !dest) continue;
          if (origin.operationalStatus !== 'OPERACIONAL' || dest.operationalStatus !== 'OPERACIONAL') {
            continue;
          }

          const originStockKg = stockBySiloMat.get(`${origin.id}::${matId}`) || 0;
          const destAvailableSpaceKg = Math.max(0, round3(dest.safeCapacityKg - dest.confirmedStockKg));
          const maxAllowedByRule = route.maxQuantityKg ?? Number.POSITIVE_INFINITY;
          const transferQtyKg = round3(
            Math.min(missingKg, originStockKg, destAvailableSpaceKg, maxAllowedByRule)
          );

          if (transferQtyKg > 0) {
            foundTransferRoute = true;
            const altMsg = `TRANSFERÊNCIA DO SILO ${origin.siloNumber} PARA O SILO ${dest.siloNumber}: ${transferQtyKg.toFixed(0)} kg disponíveis.`;
            alternativesSummary.push(altMsg);

            alerts.push({
              key: `TRANSF_SUGG_${route.id}_${todayDate}`,
              priority: 'AZUL',
              title: `Transferência autorizada sugerida (${lineCode})`,
              message: `ESTOQUE INSUFICIENTE NO SILO ${dest.siloNumber} PARA A PROGRAMAÇÃO. ALTERNATIVA IDENTIFICADA: TRANSFERÊNCIA DO SILO ${origin.siloNumber} PARA O SILO ${dest.siloNumber}. QUANTIDADE SUGERIDA: ${transferQtyKg.toFixed(0)} kg.`,
              materialCode: mat.code,
              lineCode,
              siloNumber: dest.siloNumber,
              referenceDate: todayDate,
            });

            recommendations.push({
              recommendationKey: `TRANSF_${lineCode}_${matId}_${origin.id}_${dest.id}_${todayDate}`,
              recommendationType: 'TRANSFERIR_SILO',
              priority: 'VERMELHO',
              title: `VERIFICAR TRANSFERÊNCIA DO SILO ${origin.siloNumber} PARA O SILO ${dest.siloNumber}.`,
              reason: `ESTOQUE INSUFICIENTE NO SILO ${dest.siloNumber} PARA A PROGRAMAÇÃO. ALTERNATIVA IDENTIFICADA: TRANSFERÊNCIA DO SILO ${origin.siloNumber} PARA O SILO ${dest.siloNumber}. QUANTIDADE SUGERIDA: ${transferQtyKg.toFixed(0)} kg.`,
              referenceDate: todayDate,
              lineCode,
              materialId: matId,
              materialCode: mat.code,
              materialDescription: mat.description,
              targetSiloId: dest.id,
              targetSiloNumber: dest.siloNumber,
              originSiloId: origin.id,
              originSiloNumber: origin.siloNumber,
              requiredKg: lineReqKg,
              availableKg: lineStockKg,
              missingKg,
              suggestedTransferKg: transferQtyKg,
              dataSourceSummary: `Linha ${lineCode} demanda ${lineReqKg} kg; Silo ${dest.siloNumber} tem ${lineStockKg} kg (espaço seguro ${destAvailableSpaceKg} kg); Silo ${origin.siloNumber} tem ${originStockKg} kg via rota homologada #${route.id}.`,
              alternativesSummary,
            });
          }
        }

        if (!foundTransferRoute) {
          recommendations.push({
            recommendationKey: `ABAST_${lineCode}_${matId}_${primaryTarget.id}_${todayDate}`,
            recommendationType:
              projectedBalanceTodayKg < 0 ? 'PROGRAMAR_RECEBIMENTO' : 'ABASTECER_SILO',
            priority: 'VERMELHO',
            title:
              projectedBalanceTodayKg < 0
                ? `PROGRAMAR RECEBIMENTO DE ${mat.description}.`
                : `ABASTECER SILO ${primaryTarget.siloNumber}.`,
            reason: `ESTOQUE INSUFICIENTE NO SILO ${primaryTarget.siloNumber} PARA A PROGRAMAÇÃO (${lineCode} necessita ${lineReqKg.toFixed(0)} kg, disponível ${lineStockKg.toFixed(0)} kg). Nenhuma rota de transferência autorizada com saldo encontrada.`,
            referenceDate: todayDate,
            lineCode,
            materialId: matId,
            materialCode: mat.code,
            materialDescription: mat.description,
            targetSiloId: primaryTarget.id,
            targetSiloNumber: primaryTarget.siloNumber,
            originSiloId: null,
            originSiloNumber: null,
            requiredKg: lineReqKg,
            availableKg: lineStockKg,
            missingKg,
            suggestedTransferKg: null,
            dataSourceSummary: `Linha ${lineCode} · Silo ${primaryTarget.siloNumber} (${primaryTarget.operationalStatus}) · Estoque na linha: ${lineStockKg} kg · Estoque global material: ${realStockKg} kg.`,
            alternativesSummary: [],
          });
        }
      }
    }
  }

  // Deduplica alertas por chave mantendo prioridade mais severa
  const priorityOrder: Record<AlertPriority, number> = {
    VERMELHO: 0,
    LARANJA: 1,
    AZUL: 2,
    VERDE: 3,
  };

  if (alerts.length === 0 && projections.length > 0) {
    alerts.push({
      key: `ALL_OK_${todayDate}`,
      priority: 'VERDE',
      title: 'Programação atendida pelo estoque atual',
      message: 'Todos os materiais programados com fator validado possuem cobertura confirmada.',
      materialCode: null,
      lineCode: null,
      siloNumber: null,
      referenceDate: todayDate,
    });
  }

  alerts.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  byMaterial.sort(
    (a, b) => priorityOrder[a.statusPriority] - priorityOrder[b.statusPriority]
  );

  const totals = {
    realStockKg: round3(
      Array.from(stockByMaterial.values()).reduce((sum, v) => sum + v, 0)
    ),
    confirmedPendingEntriesKg: round3(
      Array.from(pendingEntriesByMat.values()).reduce((sum, v) => sum + v, 0)
    ),
    plannedConsumptionTodayKg: round3(
      byMaterial.reduce((sum, m) => sum + m.plannedConsumptionTodayKg, 0)
    ),
    plannedConsumptionTomorrowKg: round3(
      byMaterial.reduce((sum, m) => sum + m.plannedConsumptionTomorrowKg, 0)
    ),
    realizedConsumptionKg: round3(
      byMaterial.reduce((sum, m) => sum + m.realizedConsumptionKg, 0)
    ),
    projectedBalanceTotalKg: round3(
      byMaterial.reduce((sum, m) => sum + m.projectedBalanceTodayKg, 0)
    ),
    criticalMaterialsCount: byMaterial.filter((m) => m.statusPriority === 'VERMELHO').length,
    pendingSupplyCount: recommendations.filter((r) => r.priority === 'VERMELHO').length,
  };

  return {
    todayDate,
    tomorrowDate,
    totals,
    byMaterial,
    alerts,
    recommendations,
  };
}
