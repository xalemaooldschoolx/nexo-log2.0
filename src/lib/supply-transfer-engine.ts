import type { RouteAuthorizationStatus } from './inventory-rules.ts';
import {
  type ExecutionStatus,
  type MaterialSummaryInput,
  type PendingReceiptInput,
  type ProjectionDemandInput,
  round3,
  type SiloCoverageInput,
  type SiloMaterialStockInput,
} from './production-intelligence.ts';

export type SupplyVisualStatus = 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO' | 'CINZA';

export interface AuthorizedRouteInput {
  id: number;
  originSiloId: number;
  originSiloNumber: number;
  destinationSiloId: number;
  destinationSiloNumber: number;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  relatedLineCode: string | null;
  maxQuantityKg: number | null;
  authorizationStatus: RouteAuthorizationStatus;
  validationStatus: string;
  isActive: boolean;
  restrictions: string | null;
}

export interface PendingTransferOrderInput {
  id: number;
  orderCode: string;
  originSiloId: number;
  destinationSiloId: number;
  materialId: number;
  plannedQuantityKg: number;
  transferredQuantityKg: number;
  status: string; // PLANEJADA | EM_ANDAMENTO | PARCIAL | CONCLUIDA | INTERROMPIDA | CANCELADA
}

export interface SiloActiveLotInput {
  siloId: number;
  materialId: number;
  lotCode: string | null;
  netKg: number;
}

export interface PriorityWeightsConfig {
  weightLineStopRisk: number;
  weightStockCoverage: number;
  weightAuthorizedRoute: number;
  weightOriginAvailability: number;
  weightScheduleUrgency: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeightsConfig = {
  weightLineStopRisk: 40,
  weightStockCoverage: 25,
  weightAuthorizedRoute: 15,
  weightOriginAvailability: 10,
  weightScheduleUrgency: 10,
};

export interface LineSupplyBoardRow {
  rowKey: string;
  lineCode: string;
  lineName: string;
  materialId: number | null;
  materialCode: string;
  materialDescription: string;
  feedingSilos: Array<{
    siloId: number;
    siloNumber: number;
    confirmedStockKg: number;
    safeCapacityKg: number;
    availableSpaceKg: number;
    operationalStatus: string;
    validationStatus: string;
  }>;
  currentStockKg: number;
  plannedConsumptionTodayKg: number;
  plannedConsumptionTomorrowKg: number;
  realizedConsumptionKg: number;
  remainingConsumptionKg: number;
  deficitOrSurplusKg: number; // positivo = excedente; negativo = déficit
  pendingTransferInboundKg: number;
  confirmedPendingReceiptKg: number;
  needsTransfer: boolean;
  suggestedOriginSiloNumber: number | null;
  suggestedOriginSiloId: number | null;
  suggestedDestinationSiloId: number | null;
  suggestedDestinationSiloNumber: number | null;
  suggestedTransferRuleId: number | null;
  suggestedTransferKg: number;
  hasAuthorizedRouteWithStock: boolean;
  supplyStatus: SupplyVisualStatus;
  statusReason: string;
  priorityScore: number;
  priorityLevel: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  hasReliableTimeEstimate: boolean;
  timeEstimateNote: string;
}

export interface SupplyRecommendationItem {
  recommendationKey: string;
  headline: string;
  recommendationType: 'TRANSFERIR_SILO' | 'PROGRAMAR_RECEBIMENTO' | 'ABASTECER_SILO' | 'REVISAR_CADASTRO';
  priorityScore: number;
  priorityLevel: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  visualStatus: SupplyVisualStatus;
  lineCode: string;
  materialId: number | null;
  materialCode: string;
  materialDescription: string;
  destinationSiloId: number | null;
  destinationSiloNumber: number | null;
  originSiloId: number | null;
  originSiloNumber: number | null;
  transferRuleId: number | null;
  plannedConsumptionKg: number;
  realizedConsumptionKg: number;
  availableStockKg: number;
  deficitKg: number;
  suggestedTransferKg: number | null;
  suggestedLotCode: string | null;
  pendingTransferInboundKg: number;
  confirmedPendingReceiptKg: number;
  actionType: 'CRIAR_TRANSFERENCIA' | 'SOLICITAR_RECEBIMENTO' | 'CONFERIR_DADOS';
  actionLabel: string;
  justification: string;
  priorityBreakdown: string[];
  compatibleAuthorizedRoutes: Array<{
    ruleId: number;
    originSiloId: number;
    originSiloNumber: number;
    originStockKg: number;
    availableForTransferKg: number;
    restrictions: string | null;
  }>;
  blockedOrPendingRoutes: Array<{
    ruleId: number;
    originSiloNumber: number;
    authorizationStatus: RouteAuthorizationStatus;
    reason: string;
  }>;
  analyzedAtIso: string;
}

export interface ProductionSupplyAnalysis {
  todayDate: string;
  tomorrowDate: string;
  analyzedAtIso: string;
  lineNames: Record<string, string>;
  boardRows: LineSupplyBoardRow[];
  recommendations: SupplyRecommendationItem[];
  summary: {
    totalRows: number;
    redCount: number;
    orangeCount: number;
    yellowCount: number;
    greenCount: number;
    grayCount: number;
    totalDeficitKg: number;
    totalSuggestedTransferKg: number;
  };
}

/**
 * Motor determinístico da Fase 4:
 * Analisa abastecimento das linhas L1..L7 usando EXCLUSIVAMENTE saldo físico real
 * do livro razão, compatibilidades oficiais, rotas AUTORIZADAS e ordens pendentes.
 * Nunca usa saldo projetado como saldo físico e nunca inventa taxas/tempos não cadastrados.
 */
export function computeProductionSupplyAnalysis(params: {
  todayDate: string;
  tomorrowDate: string;
  analyzedAtIso?: string;
  lines: Array<{ id: number; code: string; name: string }>;
  silos: Array<SiloCoverageInput & { validationStatus: string }>;
  siloMaterialStocks: SiloMaterialStockInput[];
  siloActiveLots: SiloActiveLotInput[];
  materials: MaterialSummaryInput[];
  routes: AuthorizedRouteInput[];
  projections: ProjectionDemandInput[];
  pendingReceipts: PendingReceiptInput[];
  pendingTransferOrders: PendingTransferOrderInput[];
  priorityWeights?: PriorityWeightsConfig;
}): ProductionSupplyAnalysis {
  const {
    todayDate,
    tomorrowDate,
    lines,
    silos,
    siloMaterialStocks,
    siloActiveLots,
    materials,
    routes,
    projections,
    pendingReceipts,
    pendingTransferOrders,
  } = params;
  const analyzedAtIso = params.analyzedAtIso || new Date().toISOString();
  const weights = params.priorityWeights || DEFAULT_PRIORITY_WEIGHTS;

  const siloById = new Map(silos.map((s) => [s.id, s]));
  const materialById = new Map(materials.map((m) => [m.id, m]));
  const lineNames = Object.fromEntries(lines.map((l) => [l.code, l.name]));

  // Saldo físico REAL por (siloId, materialId)
  const realStockBySiloMat = new Map<string, number>();
  for (const s of siloMaterialStocks) {
    if (s.netKg <= 0) continue;
    const key = `${s.siloId}::${s.materialId}`;
    realStockBySiloMat.set(key, round3((realStockBySiloMat.get(key) || 0) + s.netKg));
  }

  // Reservas de ordens de transferência já em andamento/planejadas/parciais
  const activeOrders = pendingTransferOrders.filter((o) =>
    ['PLANEJADA', 'EM_ANDAMENTO', 'PARCIAL'].includes(o.status)
  );
  const outboundReservedBySiloMat = new Map<string, number>();
  const inboundPendingBySiloMat = new Map<string, number>();
  for (const ord of activeOrders) {
    const rem = Math.max(0, round3(ord.plannedQuantityKg - ord.transferredQuantityKg));
    if (rem <= 0) continue;
    const outKey = `${ord.originSiloId}::${ord.materialId}`;
    const inKey = `${ord.destinationSiloId}::${ord.materialId}`;
    outboundReservedBySiloMat.set(
      outKey,
      round3((outboundReservedBySiloMat.get(outKey) || 0) + rem)
    );
    inboundPendingBySiloMat.set(
      inKey,
      round3((inboundPendingBySiloMat.get(inKey) || 0) + rem)
    );
  }

  // Entradas futuras de recebimento confirmadas (apenas referência de compra/descarga, NÃO é saldo físico)
  const seenReceiptIds = new Set<number>();
  const pendingReceiptByMat = new Map<number, number>();
  for (const r of pendingReceipts) {
    if (seenReceiptIds.has(r.id)) continue;
    seenReceiptIds.add(r.id);
    if (r.status !== 'PENDENTE' && r.status !== 'PARCIAL') continue;
    if (r.remainingQuantityKg <= 0) continue;
    pendingReceiptByMat.set(
      r.materialId,
      round3((pendingReceiptByMat.get(r.materialId) || 0) + r.remainingQuantityKg)
    );
  }

  // Agrupar demanda de programação por (lineCode, materialId)
  interface LineMatAgg {
    lineCode: string;
    materialId: number | null;
    plannedTodayKg: number;
    plannedTomorrowKg: number;
    realizedKg: number;
    remainingActiveKg: number;
    remainingWithTomorrowKg: number;
    hasPendingFactor: boolean;
    hasAdvancedOrActiveToday: boolean;
    hasOverdue: boolean;
  }

  const aggMap = new Map<string, LineMatAgg>();
  for (const p of projections) {
    const key = `${p.lineCode}::${p.materialId ?? 'UNKNOWN'}`;
    let entry = aggMap.get(key);
    if (!entry) {
      entry = {
        lineCode: p.lineCode,
        materialId: p.materialId,
        plannedTodayKg: 0,
        plannedTomorrowKg: 0,
        realizedKg: 0,
        remainingActiveKg: 0,
        remainingWithTomorrowKg: 0,
        hasPendingFactor: false,
        hasAdvancedOrActiveToday: false,
        hasOverdue: false,
      };
      aggMap.set(key, entry);
    }

    if (p.calculationStatus === 'PENDENTE_FATOR' || !p.materialId) {
      entry.hasPendingFactor = true;
      continue;
    }

    const calc = p.calculatedConsumptionKg;
    const realized = p.realizedConsumptionKg;
    const rem = p.executionStatus === 'CONCLUIDA' ? 0 : round3(Math.max(0, calc - realized));
    entry.realizedKg = round3(entry.realizedKg + realized);
    entry.remainingWithTomorrowKg = round3(entry.remainingWithTomorrowKg + rem);

    if (p.referenceDate === todayDate) {
      entry.plannedTodayKg = round3(entry.plannedTodayKg + calc);
      entry.remainingActiveKg = round3(entry.remainingActiveKg + rem);
      if (rem > 0) entry.hasAdvancedOrActiveToday = true;
    } else if (p.referenceDate < todayDate && p.executionStatus !== 'CONCLUIDA') {
      entry.remainingActiveKg = round3(entry.remainingActiveKg + rem);
      if (rem > 0) entry.hasOverdue = true;
    } else if (p.referenceDate === tomorrowDate) {
      entry.plannedTomorrowKg = round3(entry.plannedTomorrowKg + calc);
      if (p.executionStatus === 'ADIANTADA' && rem > 0) {
        entry.remainingActiveKg = round3(entry.remainingActiveKg + rem);
        entry.hasAdvancedOrActiveToday = true;
      }
    } else if (p.executionStatus === 'ADIANTADA' && rem > 0) {
      entry.remainingActiveKg = round3(entry.remainingActiveKg + rem);
      entry.hasAdvancedOrActiveToday = true;
    }
  }

  // Garantir que linhas L1..L7 sem demanda programada ainda exibam diagnóstico transparente caso tenham silos com pendência ou fiquem em cinza/verde
  const linesWithEntries = new Set(Array.from(aggMap.values()).map((a) => a.lineCode));
  for (const line of lines) {
    if (!linesWithEntries.has(line.code)) {
      aggMap.set(`${line.code}::NONE`, {
        lineCode: line.code,
        materialId: null,
        plannedTodayKg: 0,
        plannedTomorrowKg: 0,
        realizedKg: 0,
        remainingActiveKg: 0,
        remainingWithTomorrowKg: 0,
        hasPendingFactor: false,
        hasAdvancedOrActiveToday: false,
        hasOverdue: false,
      });
    }
  }

  // Controle de saldo físico já comprometido nas sugestões de origem durante esta rodada de cálculo
  const virtualOriginAllocated = new Map<string, number>();

  const boardRows: LineSupplyBoardRow[] = [];
  const recommendations: SupplyRecommendationItem[] = [];

  const sortedEntries = Array.from(aggMap.values()).sort((a, b) =>
    a.lineCode.localeCompare(b.lineCode)
  );

  for (const agg of sortedEntries) {
    const lineName = lineNames[agg.lineCode] || agg.lineCode;

    // Linha sem programação no momento
    if (agg.materialId === null && !agg.hasPendingFactor) {
      const lineSilos = silos.filter((s) => s.lineCode === agg.lineCode);
      const totalLineStock = lineSilos.reduce((acc, s) => round3(acc + s.confirmedStockKg), 0);
      boardRows.push({
        rowKey: `${agg.lineCode}::NONE`,
        lineCode: agg.lineCode,
        lineName,
        materialId: null,
        materialCode: '—',
        materialDescription: 'Sem programação aprovada ativa para a linha',
        feedingSilos: lineSilos.map((s) => ({
          siloId: s.id,
          siloNumber: s.siloNumber,
          confirmedStockKg: s.confirmedStockKg,
          safeCapacityKg: s.safeCapacityKg,
          availableSpaceKg: Math.max(0, round3(s.safeCapacityKg - s.confirmedStockKg)),
          operationalStatus: s.operationalStatus,
          validationStatus: s.validationStatus,
        })),
        currentStockKg: totalLineStock,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        realizedConsumptionKg: 0,
        remainingConsumptionKg: 0,
        deficitOrSurplusKg: totalLineStock,
        pendingTransferInboundKg: 0,
        confirmedPendingReceiptKg: 0,
        needsTransfer: false,
        suggestedOriginSiloNumber: null,
        suggestedOriginSiloId: null,
        suggestedDestinationSiloId: null,
        suggestedDestinationSiloNumber: null,
        suggestedTransferRuleId: null,
        suggestedTransferKg: 0,
        hasAuthorizedRouteWithStock: false,
        supplyStatus: 'CINZA',
        statusReason: 'Consumo programado ainda não importado/aprovado para esta linha.',
        priorityScore: 0,
        priorityLevel: 'BAIXA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Sem programação aprovada e sem taxa horária cadastrada.',
      });
      continue;
    }

    const mat = agg.materialId ? materialById.get(agg.materialId) : null;
    const matId = agg.materialId;
    const matCode = mat?.code || 'INDEFINIDO';
    const matDesc = mat?.description || 'Material sem vínculo / fator pendente';

    // Silos de alimentação compatíveis na linha
    const compatibleLineSilos = matId
      ? silos.filter(
          (s) =>
            s.lineCode === agg.lineCode &&
            (s.compatibleMaterialIds.includes(matId) || s.primaryMaterialId === matId)
        )
      : silos.filter((s) => s.lineCode === agg.lineCode);

    const currentStockKg = matId
      ? compatibleLineSilos.reduce(
          (sum, s) => round3(sum + (realStockBySiloMat.get(`${s.id}::${matId}`) || 0)),
          0
        )
      : 0;

    const pendingTransferInboundKg = matId
      ? compatibleLineSilos.reduce(
          (sum, s) => round3(sum + (inboundPendingBySiloMat.get(`${s.id}::${matId}`) || 0)),
          0
        )
      : 0;

    const confirmedPendingReceiptKg = matId ? pendingReceiptByMat.get(matId) || 0 : 0;

    // Informações incompletas (fator pendente, sem silo compatível ou silo com cadastro pendente sem estoque suficiente) -> CINZA (nunca classificado como VERDE regular!)
    if (agg.hasPendingFactor || !matId) {
      boardRows.push({
        rowKey: `${agg.lineCode}::${matCode}`,
        lineCode: agg.lineCode,
        lineName,
        materialId: matId,
        materialCode: matCode,
        materialDescription: matDesc,
        feedingSilos: compatibleLineSilos.map((s) => ({
          siloId: s.id,
          siloNumber: s.siloNumber,
          confirmedStockKg: matId ? realStockBySiloMat.get(`${s.id}::${matId}`) || 0 : s.confirmedStockKg,
          safeCapacityKg: s.safeCapacityKg,
          availableSpaceKg: Math.max(0, round3(s.safeCapacityKg - s.confirmedStockKg)),
          operationalStatus: s.operationalStatus,
          validationStatus: s.validationStatus,
        })),
        currentStockKg,
        plannedConsumptionTodayKg: agg.plannedTodayKg,
        plannedConsumptionTomorrowKg: agg.plannedTomorrowKg,
        realizedConsumptionKg: agg.realizedKg,
        remainingConsumptionKg: agg.remainingActiveKg,
        deficitOrSurplusKg: 0,
        pendingTransferInboundKg,
        confirmedPendingReceiptKg,
        needsTransfer: false,
        suggestedOriginSiloNumber: null,
        suggestedOriginSiloId: null,
        suggestedDestinationSiloId: null,
        suggestedDestinationSiloNumber: null,
        suggestedTransferRuleId: null,
        suggestedTransferKg: 0,
        hasAuthorizedRouteWithStock: false,
        supplyStatus: 'CINZA',
        statusReason:
          'Informação pendente: fator de consumo não homologado ou matéria-prima não vinculada.',
        priorityScore: 45,
        priorityLevel: 'MEDIA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Estimativa indisponível: consumo ou fator pendente de validação.',
      });

      recommendations.push({
        recommendationKey: `SUP_PEND_${agg.lineCode}_${matCode}_${todayDate}`,
        headline: 'INFORMAÇÃO PENDENTE PARA ANÁLISE DE ABASTECIMENTO.',
        recommendationType: 'REVISAR_CADASTRO',
        priorityScore: 45,
        priorityLevel: 'MEDIA',
        visualStatus: 'CINZA',
        lineCode: agg.lineCode,
        materialId: matId,
        materialCode: matCode,
        materialDescription: matDesc,
        destinationSiloId: compatibleLineSilos[0]?.id ?? null,
        destinationSiloNumber: compatibleLineSilos[0]?.siloNumber ?? null,
        originSiloId: null,
        originSiloNumber: null,
        transferRuleId: null,
        plannedConsumptionKg: agg.plannedTodayKg,
        realizedConsumptionKg: agg.realizedKg,
        availableStockKg: currentStockKg,
        deficitKg: 0,
        suggestedTransferKg: null,
        suggestedLotCode: null,
        pendingTransferInboundKg,
        confirmedPendingReceiptKg,
        actionType: 'CONFERIR_DADOS',
        actionLabel: 'REVISAR FATOR / CADASTRO',
        justification:
          'Há item programado para esta linha sem fator de consumo validado; sistema não classifica como regular nem calcula déficit por suposição.',
        priorityBreakdown: ['Fator determinístico ou vínculo de material pendente'],
        compatibleAuthorizedRoutes: [],
        blockedOrPendingRoutes: [],
        analyzedAtIso,
      });
      continue;
    }

    // Cálculo com saldo físico REAL vs consumo necessário (hoje/atrasado/adiantado + horizonte próximo)
    const activeDemandKg = agg.remainingActiveKg;
    const totalHorizonDemandKg = agg.remainingWithTomorrowKg;
    const deficitTodayKg = round3(Math.max(0, activeDemandKg - currentStockKg));
    const deficitHorizonKg = round3(Math.max(0, totalHorizonDemandKg - currentStockKg));
    const deficitOrSurplusKg = round3(currentStockKg - activeDemandKg);

    const primaryDest =
      compatibleLineSilos.find((s) => s.operationalStatus === 'OPERACIONAL') ||
      compatibleLineSilos[0] ||
      null;

    // Avaliar rotas existentes para este material e silos compatíveis desta linha
    const candidateRules = routes.filter(
      (r) =>
        r.materialId === matId &&
        compatibleLineSilos.some((dest) => dest.id === r.destinationSiloId)
    );

    const compatibleAuthorizedRoutes: SupplyRecommendationItem['compatibleAuthorizedRoutes'] = [];
    const blockedOrPendingRoutes: SupplyRecommendationItem['blockedOrPendingRoutes'] = [];

    for (const route of candidateRules) {
      const origin = siloById.get(route.originSiloId);
      const dest = siloById.get(route.destinationSiloId);
      if (!origin || !dest) continue;

      if (route.authorizationStatus !== 'AUTORIZADA' || !route.isActive) {
        blockedOrPendingRoutes.push({
          ruleId: route.id,
          originSiloNumber: origin.siloNumber,
          authorizationStatus: route.authorizationStatus,
          reason:
            route.authorizationStatus === 'SUSPENSA'
              ? 'Rota suspensa pela Supervisão/Administração.'
              : route.authorizationStatus === 'BLOQUEADA'
                ? 'Rota bloqueada para movimentação.'
                : 'Rota preliminar aguardando validação oficial.',
        });
        continue;
      }

      if (origin.operationalStatus !== 'OPERACIONAL' || dest.operationalStatus !== 'OPERACIONAL') {
        blockedOrPendingRoutes.push({
          ruleId: route.id,
          originSiloNumber: origin.siloNumber,
          authorizationStatus: 'BLOQUEADA',
          reason: `Silo em ${origin.operationalStatus !== 'OPERACIONAL' ? origin.operationalStatus : dest.operationalStatus}.`,
        });
        continue;
      }

      const originPhysicalKg = realStockBySiloMat.get(`${origin.id}::${matId}`) || 0;
      const alreadyReservedKg =
        (outboundReservedBySiloMat.get(`${origin.id}::${matId}`) || 0) +
        (virtualOriginAllocated.get(`${origin.id}::${matId}`) || 0);
      const originFreePhysicalKg = Math.max(0, round3(originPhysicalKg - alreadyReservedKg));
      const destFreeSpaceKg = Math.max(
        0,
        round3(
          dest.safeCapacityKg -
            dest.confirmedStockKg -
            (inboundPendingBySiloMat.get(`${dest.id}::${matId}`) || 0)
        )
      );
      const ruleMaxKg = route.maxQuantityKg ?? Number.POSITIVE_INFINITY;
      const targetDeficit = deficitTodayKg > 0 ? deficitTodayKg : deficitHorizonKg;
      const effectiveMissing = Math.max(0, round3(targetDeficit - pendingTransferInboundKg));

      const availableForTransferKg = round3(
        Math.min(originFreePhysicalKg, destFreeSpaceKg, ruleMaxKg)
      );

      compatibleAuthorizedRoutes.push({
        ruleId: route.id,
        originSiloId: origin.id,
        originSiloNumber: origin.siloNumber,
        originStockKg: originPhysicalKg,
        availableForTransferKg,
        restrictions: route.restrictions,
      });

      void effectiveMissing;
    }

    // Escolher melhor rota autorizada com saldo físico disponível
    const targetNeedKg = Math.max(
      0,
      round3((deficitTodayKg > 0 ? deficitTodayKg : deficitHorizonKg) - pendingTransferInboundKg)
    );
    const bestAuthorizedRoute =
      compatibleAuthorizedRoutes
        .filter((r) => r.availableForTransferKg > 0)
        .sort((a, b) => b.availableForTransferKg - a.availableForTransferKg)[0] || null;

    let suggestedTransferKg = 0;
    let suggestedOriginSiloId: number | null = null;
    let suggestedOriginSiloNumber: number | null = null;
    let suggestedDestSiloId: number | null = primaryDest?.id ?? null;
    let suggestedDestSiloNumber: number | null = primaryDest?.siloNumber ?? null;
    let suggestedRuleId: number | null = null;
    let suggestedLotCode: string | null = null;

    if (targetNeedKg > 0 && bestAuthorizedRoute) {
      const chosenRule = candidateRules.find((r) => r.id === bestAuthorizedRoute.ruleId)!;
      suggestedTransferKg = round3(
        Math.min(targetNeedKg, bestAuthorizedRoute.availableForTransferKg)
      );
      suggestedOriginSiloId = bestAuthorizedRoute.originSiloId;
      suggestedOriginSiloNumber = bestAuthorizedRoute.originSiloNumber;
      suggestedDestSiloId = chosenRule.destinationSiloId;
      suggestedDestSiloNumber = chosenRule.destinationSiloNumber;
      suggestedRuleId = chosenRule.id;

      const allocKey = `${suggestedOriginSiloId}::${matId}`;
      virtualOriginAllocated.set(
        allocKey,
        round3((virtualOriginAllocated.get(allocKey) || 0) + suggestedTransferKg)
      );

      const originLots = siloActiveLots.filter(
        (l) => l.siloId === suggestedOriginSiloId && l.materialId === matId && l.netKg > 0
      );
      if (originLots.length === 1) {
        suggestedLotCode = originLots[0].lotCode;
      } else if (originLots.length > 1) {
        suggestedLotCode = originLots
          .map((l) => l.lotCode)
          .filter(Boolean)
          .slice(0, 2)
          .join(' / ');
      }
    }

    // Determinar cor visual e prioridade configurável
    let supplyStatus: SupplyVisualStatus = 'VERDE';
    let statusReason = 'Estoque físico suficiente na linha para a programação ativa e próxima.';

    const hasReliableDest = compatibleLineSilos.some((s) => s.validationStatus === 'VALIDADO');
    if (compatibleLineSilos.length === 0) {
      supplyStatus = 'CINZA';
      statusReason = `Nenhum silo compatível cadastrado na ${agg.lineCode} para ${matDesc}.`;
    } else if (deficitTodayKg > 0) {
      if (pendingTransferInboundKg >= deficitTodayKg) {
        supplyStatus = 'AMARELO';
        statusReason = `Déficit imediato de ${deficitTodayKg.toLocaleString('pt-BR')} kg coberto por transferência em andamento (${pendingTransferInboundKg.toLocaleString('pt-BR')} kg).`;
      } else if (suggestedTransferKg >= deficitTodayKg) {
        supplyStatus = 'LARANJA';
        statusReason = `Necessidade de ação: déficit de ${deficitTodayKg.toLocaleString('pt-BR')} kg na ${agg.lineCode}; rota autorizada Silo ${suggestedOriginSiloNumber} → Silo ${suggestedDestSiloNumber} disponível.`;
      } else {
        supplyStatus = 'VERMELHO';
        statusReason = `Risco crítico de falta na ${agg.lineCode}: déficit físico de ${deficitTodayKg.toLocaleString('pt-BR')} kg sem transferência autorizada integral disponível.`;
      }
    } else if (deficitHorizonKg > 0) {
      supplyStatus = bestAuthorizedRoute ? 'LARANJA' : 'AMARELO';
      statusReason = `Suficiente para hoje, porém faltam ${deficitHorizonKg.toLocaleString('pt-BR')} kg para a próxima programação.`;
    } else if (!hasReliableDest && currentStockKg === 0 && activeDemandKg === 0) {
      supplyStatus = 'CINZA';
      statusReason = 'Silo com cadastro pendente de validação oficial.';
    } else if (
      primaryDest &&
      activeDemandKg > 0 &&
      currentStockKg < activeDemandKg * 1.15
    ) {
      supplyStatus = 'AMARELO';
      statusReason = 'Cobertura justa (<15% de margem sobre o consumo programado).';
    }

    // Pontuação configurável de prioridade (0 a 100)
    const breakdown: string[] = [];
    let score = 0;
    if (deficitTodayKg > 0) {
      score += weights.weightLineStopRisk;
      breakdown.push(`Risco de parada no turno (+${weights.weightLineStopRisk})`);
    } else if (deficitHorizonKg > 0) {
      score += Math.round(weights.weightLineStopRisk * 0.6);
      breakdown.push(`Impacto na próxima programação (+${Math.round(weights.weightLineStopRisk * 0.6)})`);
    }

    const coverageRatio = activeDemandKg > 0 ? currentStockKg / activeDemandKg : 2;
    if (coverageRatio < 0.5) {
      score += weights.weightStockCoverage;
      breakdown.push(`Cobertura < 50% (+${weights.weightStockCoverage})`);
    } else if (coverageRatio < 1.0) {
      score += Math.round(weights.weightStockCoverage * 0.7);
      breakdown.push(`Cobertura < 100% (+${Math.round(weights.weightStockCoverage * 0.7)})`);
    }

    if (bestAuthorizedRoute) {
      score += weights.weightAuthorizedRoute;
      breakdown.push(`Rota autorizada ativa (+${weights.weightAuthorizedRoute})`);
      score += weights.weightOriginAvailability;
      breakdown.push(`Saldo físico disponível na origem (+${weights.weightOriginAvailability})`);
    }
    if (agg.hasAdvancedOrActiveToday || agg.hasOverdue) {
      score += weights.weightScheduleUrgency;
      breakdown.push(`Urgência de programação ativa/adiantada (+${weights.weightScheduleUrgency})`);
    }
    score = Math.min(100, Math.max(0, score));

    const priorityLevel: LineSupplyBoardRow['priorityLevel'] =
      supplyStatus === 'VERMELHO' || score >= 75
        ? 'CRITICA'
        : supplyStatus === 'LARANJA' || score >= 50
          ? 'ALTA'
          : supplyStatus === 'AMARELO' || score >= 25
            ? 'MEDIA'
            : 'BAIXA';

    const needsTransfer = deficitTodayKg > 0 || deficitHorizonKg > 0;

    boardRows.push({
      rowKey: `${agg.lineCode}::${matCode}`,
      lineCode: agg.lineCode,
      lineName,
      materialId: matId,
      materialCode: matCode,
      materialDescription: matDesc,
      feedingSilos: compatibleLineSilos.map((s) => ({
        siloId: s.id,
        siloNumber: s.siloNumber,
        confirmedStockKg: realStockBySiloMat.get(`${s.id}::${matId}`) || 0,
        safeCapacityKg: s.safeCapacityKg,
        availableSpaceKg: Math.max(0, round3(s.safeCapacityKg - s.confirmedStockKg)),
        operationalStatus: s.operationalStatus,
        validationStatus: s.validationStatus,
      })),
      currentStockKg,
      plannedConsumptionTodayKg: agg.plannedTodayKg,
      plannedConsumptionTomorrowKg: agg.plannedTomorrowKg,
      realizedConsumptionKg: agg.realizedKg,
      remainingConsumptionKg: activeDemandKg,
      deficitOrSurplusKg,
      pendingTransferInboundKg,
      confirmedPendingReceiptKg,
      needsTransfer,
      suggestedOriginSiloNumber,
      suggestedOriginSiloId,
      suggestedDestinationSiloId: suggestedDestSiloId,
      suggestedDestinationSiloNumber: suggestedDestSiloNumber,
      suggestedTransferRuleId: suggestedRuleId,
      suggestedTransferKg,
      hasAuthorizedRouteWithStock: Boolean(bestAuthorizedRoute && suggestedTransferKg > 0),
      supplyStatus,
      statusReason,
      priorityScore: score,
      priorityLevel,
      hasReliableTimeEstimate: false,
      timeEstimateNote:
        'Sem taxa de dosagem/velocidade de rosca cadastrada; estimativa de horas até parada não informada para evitar suposições.',
    });

    if (needsTransfer && targetNeedKg > 0) {
      const displayConsumption = deficitTodayKg > 0 ? activeDemandKg : totalHorizonDemandKg;
      const displayDeficit = deficitTodayKg > 0 ? deficitTodayKg : deficitHorizonKg;
      const canTransfer = Boolean(suggestedRuleId && suggestedTransferKg > 0);

      recommendations.push({
        recommendationKey: `SUP_${agg.lineCode}_${matId}_${todayDate}`,
        headline: 'NECESSIDADE DE ABASTECIMENTO IDENTIFICADA.',
        recommendationType: canTransfer
          ? 'TRANSFERIR_SILO'
          : primaryDest
            ? 'PROGRAMAR_RECEBIMENTO'
            : 'ABASTECER_SILO',
        priorityScore: score,
        priorityLevel,
        visualStatus: supplyStatus,
        lineCode: agg.lineCode,
        materialId: matId,
        materialCode: matCode,
        materialDescription: matDesc,
        destinationSiloId: suggestedDestSiloId,
        destinationSiloNumber: suggestedDestSiloNumber,
        originSiloId: suggestedOriginSiloId,
        originSiloNumber: suggestedOriginSiloNumber,
        transferRuleId: suggestedRuleId,
        plannedConsumptionKg: displayConsumption,
        realizedConsumptionKg: agg.realizedKg,
        availableStockKg: currentStockKg,
        deficitKg: displayDeficit,
        suggestedTransferKg: canTransfer ? suggestedTransferKg : null,
        suggestedLotCode,
        pendingTransferInboundKg,
        confirmedPendingReceiptKg,
        actionType: canTransfer ? 'CRIAR_TRANSFERENCIA' : 'SOLICITAR_RECEBIMENTO',
        actionLabel: canTransfer
          ? 'CRIAR SOLICITAÇÃO DE TRANSFERÊNCIA'
          : 'CRIAR SOLICITAÇÃO DE RECEBIMENTO',
        justification: canTransfer
          ? `Silo ${suggestedDestSiloNumber} (${agg.lineCode}) possui saldo físico de ${currentStockKg.toLocaleString('pt-BR')} kg para consumo previsto de ${displayConsumption.toLocaleString('pt-BR')} kg (déficit ${displayDeficit.toLocaleString('pt-BR')} kg). Silo ${suggestedOriginSiloNumber} possui saldo físico compatível e rota AUTORIZADA.`
          : `Déficit de ${displayDeficit.toLocaleString('pt-BR')} kg na ${agg.lineCode} (${matDesc}) sem rota autorizada com saldo físico suficiente na origem.`,
        priorityBreakdown: breakdown,
        compatibleAuthorizedRoutes,
        blockedOrPendingRoutes,
        analyzedAtIso,
      });
    }
  }

  recommendations.sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    todayDate,
    tomorrowDate,
    analyzedAtIso,
    lineNames,
    boardRows,
    recommendations,
    summary: {
      totalRows: boardRows.length,
      redCount: boardRows.filter((r) => r.supplyStatus === 'VERMELHO').length,
      orangeCount: boardRows.filter((r) => r.supplyStatus === 'LARANJA').length,
      yellowCount: boardRows.filter((r) => r.supplyStatus === 'AMARELO').length,
      greenCount: boardRows.filter((r) => r.supplyStatus === 'VERDE').length,
      grayCount: boardRows.filter((r) => r.supplyStatus === 'CINZA').length,
      totalDeficitKg: round3(
        boardRows.reduce((s, r) => (r.deficitOrSurplusKg < 0 ? s + Math.abs(r.deficitOrSurplusKg) : s), 0)
      ),
      totalSuggestedTransferKg: round3(
        boardRows.reduce((s, r) => s + r.suggestedTransferKg, 0)
      ),
    },
  };
}
