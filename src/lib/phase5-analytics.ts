import type {
  HistoricalStockRow,
  PerformanceKpiSummary,
  PeriodPreset,
  ShiftAutoSummarySnapshot,
} from '../types/nexo.ts';

function addDaysToIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

export function formatIsoDatePtBr(isoDate: string): string {
  const parts = isoDate.slice(0, 10).split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function resolvePeriodBounds(
  preset: PeriodPreset = 'HOJE',
  customStart?: string,
  customEnd?: string,
  anchorDateStr: string = new Date().toISOString().slice(0, 10)
): { startDate: string; endDate: string; label: string } {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(anchorDateStr)
    ? anchorDateStr
    : new Date().toISOString().slice(0, 10);

  switch (preset) {
    case 'ONTEM': {
      const yest = addDaysToIsoDate(today, -1);
      return { startDate: yest, endDate: yest, label: `Ontem (${formatIsoDatePtBr(yest)})` };
    }
    case 'ULTIMOS_7_DIAS': {
      const start = addDaysToIsoDate(today, -6);
      return {
        startDate: start,
        endDate: today,
        label: `Últimos 7 dias (${formatIsoDatePtBr(start)} a ${formatIsoDatePtBr(today)})`,
      };
    }
    case 'ULTIMOS_30_DIAS': {
      const start = addDaysToIsoDate(today, -29);
      return {
        startDate: start,
        endDate: today,
        label: `Últimos 30 dias (${formatIsoDatePtBr(start)} a ${formatIsoDatePtBr(today)})`,
      };
    }
    case 'MES_ATUAL': {
      const monthStart = `${today.slice(0, 7)}-01`;
      return {
        startDate: monthStart,
        endDate: today,
        label: `Mês atual (${formatIsoDatePtBr(monthStart)} a ${formatIsoDatePtBr(today)})`,
      };
    }
    case 'PERSONALIZADO': {
      const start =
        customStart && /^\d{4}-\d{2}-\d{2}$/.test(customStart) ? customStart : today;
      const end =
        customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customEnd) ? customEnd : start;
      const orderedStart = start <= end ? start : end;
      const orderedEnd = start <= end ? end : start;
      return {
        startDate: orderedStart,
        endDate: orderedEnd,
        label: `Personalizado (${formatIsoDatePtBr(orderedStart)} a ${formatIsoDatePtBr(orderedEnd)})`,
      };
    }
    case 'HOJE':
    default:
      return { startDate: today, endDate: today, label: `Hoje (${formatIsoDatePtBr(today)})` };
  }
}

export interface LedgerMovementInput {
  id: number;
  siloId: number;
  siloNumber: number;
  lineCode: string;
  siloCategory: string;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  lotCode: string | null;
  quantityKg: number;
  direction: 'CREDIT' | 'DEBIT' | string;
  operationalDate: string;
  createdAtIso: string;
}

/**
 * Reconstrução determinística da posição histórica de estoque em data/timestamp específico
 * diretamente a partir do livro razão de movimentações (`inventory_movements`).
 * Nunca copia o saldo atual; calcula créditos - débitos acumulados até a data de corte.
 */
export function reconstructHistoricalStockPosition(params: {
  targetDate: string; // YYYY-MM-DD
  cutoffMode?: 'OPERATIONAL_DATE' | 'TIMESTAMP';
  targetTimestampEndIso?: string;
  movements: LedgerMovementInput[];
  siloFilterId?: number | null;
  materialFilterId?: number | null;
}): {
  rows: HistoricalStockRow[];
  totalHistoricalBalanceKg: number;
  movementsEvaluatedCount: number;
  note: string;
} {
  const cutoffMode = params.cutoffMode || 'OPERATIONAL_DATE';
  const endTsMs = params.targetTimestampEndIso
    ? Date.parse(params.targetTimestampEndIso)
    : Date.parse(`${params.targetDate}T23:59:59.999Z`);

  const relevant = params.movements.filter((m) => {
    if (params.siloFilterId && m.siloId !== params.siloFilterId) return false;
    if (params.materialFilterId && m.materialId !== params.materialFilterId) return false;
    if (cutoffMode === 'TIMESTAMP') {
      const mTs = Date.parse(m.createdAtIso);
      return Number.isFinite(mTs) && mTs <= endTsMs;
    }
    return m.operationalDate <= params.targetDate;
  });

  const buckets = new Map<
    string,
    {
      siloId: number;
      siloNumber: number;
      lineCode: string;
      category: string;
      materialId: number;
      materialCode: string;
      materialDescription: string;
      lotCode: string;
      balanceKg: number;
      movementCount: number;
      lastMovementIso: string | null;
    }
  >();

  for (const m of relevant) {
    const lot = (m.lotCode && m.lotCode.trim()) || 'SEM_LOTE';
    const key = `${m.siloId}::${m.materialId}::${lot}`;
    const existing = buckets.get(key) ?? {
      siloId: m.siloId,
      siloNumber: m.siloNumber,
      lineCode: m.lineCode,
      category: m.siloCategory,
      materialId: m.materialId,
      materialCode: m.materialCode,
      materialDescription: m.materialDescription,
      lotCode: lot,
      balanceKg: 0,
      movementCount: 0,
      lastMovementIso: null,
    };

    const delta = m.direction === 'CREDIT' ? Number(m.quantityKg) : -Number(m.quantityKg);
    existing.balanceKg += delta;
    existing.movementCount += 1;
    if (!existing.lastMovementIso || m.createdAtIso > existing.lastMovementIso) {
      existing.lastMovementIso = m.createdAtIso;
    }
    buckets.set(key, existing);
  }

  const rows: HistoricalStockRow[] = Array.from(buckets.values())
    .map((b) => ({
      siloId: b.siloId,
      siloNumber: b.siloNumber,
      lineCode: b.lineCode,
      category: b.category,
      materialId: b.materialId,
      materialCode: b.materialCode,
      materialDescription: b.materialDescription,
      lotCode: b.lotCode,
      historicalBalanceKg: Math.round(b.balanceKg * 1000) / 1000,
      movementCountUpToDate: b.movementCount,
      lastMovementUpToDate: b.lastMovementIso,
    }))
    .filter((r) => Math.abs(r.historicalBalanceKg) > 0.0001 || r.movementCountUpToDate > 0)
    .sort((a, b) => a.siloNumber - b.siloNumber || a.materialCode.localeCompare(b.materialCode));

  const totalHistoricalBalanceKg =
    Math.round(rows.reduce((acc, r) => acc + r.historicalBalanceKg, 0) * 1000) / 1000;

  const note =
    relevant.length === 0
      ? `Nenhuma movimentação registrada no livro razão até ${formatIsoDatePtBr(params.targetDate)}.`
      : `Posição reconstruída diretamente a partir de ${relevant.length} movimentação(ões) no livro razão até ${formatIsoDatePtBr(params.targetDate)}.`;

  return {
    rows,
    totalHistoricalBalanceKg,
    movementsEvaluatedCount: relevant.length,
    note,
  };
}

export interface KpiInputReceipt {
  receivedQuantityKg: number;
  distributedQuantityKg: number;
  status: string;
  startedAtIso: string | null;
  finishedAtIso: string | null;
}

export interface KpiInputConsumption {
  plannedConsumptionKg: number;
  realizedConsumptionKg: number;
  hasRealizedRecord: boolean;
}

/**
 * Calcula indicadores reais de desempenho sem fabricar linha de base histórica
 * nem inventar tempos médios ou consumo realizado quando os registros não existem.
 */
export function computePerformanceKpis(params: {
  periodStart: string;
  periodEnd: string;
  receipts: KpiInputReceipt[];
  partialDistributionsCount: number;
  transferredVolumeKg: number;
  occurrencesTotalCount: number;
  occurrencesOpenCount: number;
  divergencesFrequency: number;
  shortageAlertsFrequency: number;
  consumptionRows: KpiInputConsumption[];
}): PerformanceKpiSummary {
  const receivedVolumeKg = params.receipts.reduce((acc, r) => acc + Number(r.receivedQuantityKg || 0), 0);
  const distributedVolumeKg = params.receipts.reduce(
    (acc, r) => acc + Number(r.distributedQuantityKg || 0),
    0
  );
  const completedReceiptsCount = params.receipts.filter((r) => r.status === 'CONCLUIDO').length;
  const partialReceiptsCount = params.receipts.filter((r) => r.status === 'PARCIAL').length;

  const durationSamples: number[] = [];
  for (const r of params.receipts) {
    if (r.startedAtIso && r.finishedAtIso) {
      const startMs = Date.parse(r.startedAtIso);
      const endMs = Date.parse(r.finishedAtIso);
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
        durationSamples.push((endMs - startMs) / 60000);
      }
    }
  }

  const avgReceiptDurationMinutes =
    durationSamples.length > 0
      ? Math.round((durationSamples.reduce((a, b) => a + b, 0) / durationSamples.length) * 10) / 10
      : null;

  const avgReceiptDurationNote =
    durationSamples.length > 0
      ? `Calculado sobre ${durationSamples.length} recebimento(s) com início e término registrados.`
      : 'Sem recebimentos com data/hora de início e término finalizados no período para cálculo de tempo médio.';

  const plannedConsumptionKg = params.consumptionRows.reduce(
    (acc, c) => acc + Number(c.plannedConsumptionKg || 0),
    0
  );
  const realizedRows = params.consumptionRows.filter((c) => c.hasRealizedRecord);
  const realizedConsumptionKg =
    realizedRows.length > 0
      ? realizedRows.reduce((acc, c) => acc + Number(c.realizedConsumptionKg || 0), 0)
      : null;

  const plannedForRealizedRows = realizedRows.reduce(
    (acc, c) => acc + Number(c.plannedConsumptionKg || 0),
    0
  );
  const consumptionVarianceKg =
    realizedConsumptionKg !== null
      ? Math.round((realizedConsumptionKg - plannedForRealizedRows) * 1000) / 1000
      : null;

  const consumptionComparisonNote =
    realizedRows.length > 0
      ? `Comparação calculada sobre ${realizedRows.length} item(ns) com produção/consumo realizado informado (Realizado - Previsto).`
      : 'Nenhum consumo realizado foi informado para os itens programados no período; exibindo somente consumo previsto.';

  return {
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    receivedVolumeKg: Math.round(receivedVolumeKg * 1000) / 1000,
    distributedVolumeKg: Math.round(distributedVolumeKg * 1000) / 1000,
    transferredVolumeKg: Math.round(params.transferredVolumeKg * 1000) / 1000,
    receiptsCount: params.receipts.length,
    completedReceiptsCount,
    partialDischargesCount: Math.max(partialReceiptsCount, params.partialDistributionsCount),
    occurrencesCount: params.occurrencesTotalCount,
    openOccurrencesCount: params.occurrencesOpenCount,
    avgReceiptDurationMinutes,
    avgReceiptDurationSampleSize: durationSamples.length,
    avgReceiptDurationNote,
    divergencesFrequency: params.divergencesFrequency,
    shortageAlertsFrequency: params.shortageAlertsFrequency,
    plannedConsumptionKg: Math.round(plannedConsumptionKg * 1000) / 1000,
    realizedConsumptionKg,
    consumptionVarianceKg,
    realizedSampleCount: realizedRows.length,
    consumptionComparisonNote,
    historicalBaselineNotice:
      'Não há linha de base histórica anterior cadastrada para atribuir ganhos percentuais retroativos. Metas futuras são configuradas separadamente pela Administração.',
    dataOrigin: 'PostgreSQL (Recebimentos, Livro Razão, Transferências, Programação e Ocorrências)',
  };
}

function getShiftHeadingLabel(shiftCode: string): string {
  if (shiftCode === 'TURNO_1') return 'PRIMEIRO TURNO';
  if (shiftCode === 'TURNO_2') return 'SEGUNDO TURNO';
  if (shiftCode === 'TURNO_3') return 'TERCEIRO TURNO';
  return shiftCode.toUpperCase();
}

function getShiftLowerOrdinalLabel(shiftCode: string): string {
  if (shiftCode === 'TURNO_1') return 'primeiro';
  if (shiftCode === 'TURNO_2') return 'segundo';
  if (shiftCode === 'TURNO_3') return 'terceiro';
  return shiftCode.toLowerCase();
}

const PORTUGUESE_PREPOSITIONS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'a', 'o', 'na', 'no']);

const ACCENT_RESTORE_MAP: Record<string, string> = {
  calcario: 'Calcário',
  gluten: 'Glúten',
  bicalcico: 'Bicálcico',
  monocalcico: 'Monocálcico',
  algodao: 'Algodão',
  ureia: 'Uréia',
  proteico: 'Protéico',
  energetico: 'Energético',
  racoes: 'Rações',
  farinha: 'Farinha',
  farelo: 'Farelo',
  milho: 'Milho',
  soja: 'Soja',
  fosfato: 'Fosfato',
  sal: 'Sal',
  mineral: 'Mineral',
  casquinha: 'Casquinha',
  premix: 'Premix',
  oleo: 'Óleo',
  acido: 'Ácido',
  calcitico: 'Calcítico',
  dolomitico: 'Dolomítico',
  melaço: 'Melaço',
  melaco: 'Melaço',
};

export function formatMaterialTitleCase(raw: string): string {
  const cleaned = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Material Não Identificado';
  const tokens = cleaned.split(' ');
  return tokens
    .map((tok, idx) => {
      // Preserva percentuais/unidades numéricas como 21%, 19%, 46%, etc.
      if (/^\d+([.,]\d+)?%?$/.test(tok)) return tok;
      const lower = tok.toLowerCase();
      const normalizedAscii = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (idx > 0 && PORTUGUESE_PREPOSITIONS.has(normalizedAscii)) {
        return normalizedAscii;
      }
      if (ACCENT_RESTORE_MAP[normalizedAscii]) {
        return ACCENT_RESTORE_MAP[normalizedAscii];
      }
      // Preserva siglas curtas técnicas conhecidas se forem apenas letras maiúsculas <= 3 chars (ex.: DDG, NPK)
      if (/^[A-Z]{2,3}$/.test(tok) && !['DE', 'DO', 'DA', 'EM', 'SAL', 'SOJ'].includes(tok)) {
        return tok;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

export function formatMaterialTitleCaseBold(raw: string): string {
  return `**${formatMaterialTitleCase(raw)}**`;
}

export interface VehicleReceiptInput {
  receiptId: number;
  receiptNumber: string;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  supplierName: string;
  invoiceNumber: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  carrierName: string | null;
  receivingType: string;
  bagCount: number | null;
  receivedKg: number;
  distributedKgTotal: number;
  distributedInShiftKg: number;
  status: string;
  startedAtIso: string;
  finishedAtIso: string | null;
  startedShiftCode: string;
  startedOperationalDate: string;
  finishedShiftCode: string | null;
  finishedOperationalDate: string | null;
  siloNumbers: number[];
  operatorName: string;
  operatorBadge: string | null;
  executedByName: string | null;
  executedByBadge: string | null;
}

/**
 * Classificação rigorosa de veículos no turno:
 * - SOMENTE veículos cuja descarga foi INICIADA E FINALIZADA neste turno/data operacional entram na contagem
 *   "Veículos descarregados pelo [turno]"!
 * - Veículo iniciado em turno anterior e finalizado neste turno é narrado no relatório, mas NÃO entra
 *   na contagem deste turno (para jamais duplicar nem inflar a contagem).
 * - Veículo parcial/pendente em andamento fica separado para continuidade do próximo turno.
 */
export function classifyShiftVehicles(params: {
  shiftCode: string;
  operationalDate: string;
  receipts: VehicleReceiptInput[];
}): import('../types/nexo.ts').ShiftVehicleBreakdown {
  const countedVehicles: import('../types/nexo.ts').ShiftVehicleEntryItem[] = [];
  const carryoverFinalizedVehicles: import('../types/nexo.ts').ShiftVehicleEntryItem[] = [];
  const pendingOrPartialVehicles: import('../types/nexo.ts').ShiftVehicleEntryItem[] = [];

  for (const r of params.receipts) {
    if (r.status === 'CANCELADO') continue;

    const startedHere =
      r.startedShiftCode === params.shiftCode && r.startedOperationalDate === params.operationalDate;
    const finishedHere =
      r.status === 'CONCLUIDO' &&
      r.finishedShiftCode === params.shiftCode &&
      r.finishedOperationalDate === params.operationalDate;
    const hasActivityHere = startedHere || finishedHere || r.distributedInShiftKg > 0;

    if (!hasActivityHere) continue;

    const formattedMaterialName = formatMaterialTitleCase(r.materialDescription);
    const remainingKg = Math.max(0, Math.round((r.receivedKg - r.distributedKgTotal) * 1000) / 1000);

    let classification: import('../types/nexo.ts').ShiftVehicleEntryItem['classification'];
    let countedInShiftTotal = false;

    if (r.status === 'CONCLUIDO' && startedHere && finishedHere) {
      classification = 'INICIADO_E_FINALIZADO_NO_TURNO';
      countedInShiftTotal = true;
    } else if (r.status === 'CONCLUIDO' && finishedHere && !startedHere) {
      classification = 'INICIADO_TURNO_ANTERIOR_FINALIZADO_AQUI';
      countedInShiftTotal = false;
    } else if (r.status === 'CONCLUIDO' && startedHere && !finishedHere) {
      // Concluído posteriormente em outro turno: não é contado aqui para não duplicar, nem pendente hoje
      continue;
    } else if (r.status === 'PARCIAL' || r.distributedInShiftKg > 0 || r.distributedKgTotal > 0) {
      classification = 'PARCIAL_EM_ANDAMENTO';
      countedInShiftTotal = false;
    } else {
      classification = 'AGUARDANDO_DESCARGA';
      countedInShiftTotal = false;
    }

    const entry: import('../types/nexo.ts').ShiftVehicleEntryItem = {
      receiptId: r.receiptId,
      receiptNumber: r.receiptNumber,
      materialId: r.materialId,
      materialCode: r.materialCode,
      materialDescription: r.materialDescription,
      formattedMaterialName,
      supplierName: r.supplierName,
      invoiceNumber: r.invoiceNumber,
      vehiclePlate: r.vehiclePlate,
      driverName: r.driverName,
      carrierName: r.carrierName,
      receivingType: r.receivingType,
      bagCount: r.bagCount,
      receivedKg: r.receivedKg,
      distributedInShiftKg: r.distributedInShiftKg,
      remainingKg,
      status: r.status,
      startedAtIso: r.startedAtIso,
      finishedAtIso: r.finishedAtIso,
      startedShiftCode: r.startedShiftCode,
      startedOperationalDate: r.startedOperationalDate,
      finishedShiftCode: r.finishedShiftCode,
      finishedOperationalDate: r.finishedOperationalDate,
      siloNumbers: r.siloNumbers,
      operatorName: r.operatorName,
      operatorBadge: r.operatorBadge,
      executedByName: r.executedByName,
      executedByBadge: r.executedByBadge,
      classification,
      countedInShiftTotal,
    };

    if (countedInShiftTotal) {
      countedVehicles.push(entry);
    } else if (classification === 'INICIADO_TURNO_ANTERIOR_FINALIZADO_AQUI') {
      carryoverFinalizedVehicles.push(entry);
    } else {
      pendingOrPartialVehicles.push(entry);
    }
  }

  const groupMap = new Map<string, { materialDescription: string; formattedMaterialName: string; count: number }>();
  for (const v of countedVehicles) {
    const key = v.formattedMaterialName.toLowerCase();
    const prev = groupMap.get(key) ?? {
      materialDescription: v.materialDescription,
      formattedMaterialName: v.formattedMaterialName,
      count: 0,
    };
    prev.count += 1;
    groupMap.set(key, prev);
  }

  const countedByMaterial = Array.from(groupMap.values()).sort((a, b) =>
    a.formattedMaterialName.localeCompare(b.formattedMaterialName, 'pt-BR')
  );

  return {
    countedVehicles,
    carryoverFinalizedVehicles,
    pendingOrPartialVehicles,
    countedByMaterial,
    totalCountedVehicles: countedVehicles.length,
  };
}

function formatTonsAndKgPtBr(kg: number): string {
  const safeKg = Math.round(Number(kg || 0));
  const tons = safeKg / 1000;
  const tonsStr = tons.toLocaleString('pt-BR', { minimumFractionDigits: tons % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  return `${tonsStr} t (${safeKg.toLocaleString('pt-BR')} kg)`;
}

function formatHHmmFromIso(iso: string | null | undefined): string {
  if (!iso) return 'horário não informado';
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : iso.slice(11, 16) || 'horário não informado';
}

/**
 * Gera o documento narrativo oficial do Relatório de Turno e Passagem da Moega,
 * em prosa cronológica fluida, com materiais em negrito (Title Case), cabeçalho padrão
 * `# SEGUNDO TURNO – DD/MM/AAAA` e bloco final consolidado de veículos descarregados.
 */
export function buildMoegaShiftNarrativeReport(params: {
  summary: ShiftAutoSummarySnapshot;
  handoverByName?: string | null;
  handoverByBadge?: string | null;
  receivedByName?: string | null;
  shiftSummaryText?: string;
  relevantOccurrencesText?: string;
  pendenciesText?: string;
  requiredActionsText?: string;
  nextShiftRecommendationsText?: string;
  supplements?: import('../types/nexo.ts').ShiftManualSupplement[];
}): string {
  const s = params.summary;
  const heading = `# ${getShiftHeadingLabel(s.shiftCode)} – ${formatIsoDatePtBr(s.operationalDate)}`;
  const shiftOrdinal = getShiftLowerOrdinalLabel(s.shiftCode);
  const breakdown: import('../types/nexo.ts').ShiftVehicleBreakdown = s.vehicleBreakdown || {
    countedVehicles: [],
    carryoverFinalizedVehicles: [],
    pendingOrPartialVehicles: [],
    countedByMaterial: [],
    totalCountedVehicles: 0,
  };

  const lines: string[] = [heading, ''];

  const operadorPrincipal = params.handoverByName?.trim()
    ? `${params.handoverByName.trim()}${params.handoverByBadge ? ` (Matrícula ${params.handoverByBadge})` : ''}`
    : 'Dado não informado';
  const receptor = params.receivedByName?.trim() || 'Aguardando confirmação do turno seguinte';

  lines.push(
    `Relatório operacional referente ao ${s.shiftName}, conduzido por ${operadorPrincipal} e com recebimento de turno indicado para ${receptor}.`
  );
  lines.push('');

  // Parágrafo de recebimentos / descargas iniciadas em turno anterior e finalizadas neste turno
  if (breakdown.carryoverFinalizedVehicles.length > 0) {
    for (const cv of breakdown.carryoverFinalizedVehicles) {
      const matBold = `**${cv.formattedMaterialName}**`;
      const silosTxt = cv.siloNumbers.length > 0 ? cv.siloNumbers.map((n) => `Silo ${n}`).join(', ') : 'silo não especificado';
      const plateTxt = cv.vehiclePlate ? ` (placa ${cv.vehiclePlate})` : '';
      const execTxt = cv.executedByName
        ? ` com apoio de ${cv.executedByName}${cv.executedByBadge ? ` (Mat. ${cv.executedByBadge})` : ''}`
        : '';
      lines.push(
        `Às ${formatHHmmFromIso(cv.finishedAtIso)}, foi concluída a descarga remanescente do recebimento ${cv.receiptNumber}${plateTxt} de ${matBold} (${formatTonsAndKgPtBr(cv.distributedInShiftKg)} complementados no ${silosTxt}), cuja operação havia sido iniciada em turno anterior (${formatIsoDatePtBr(cv.startedOperationalDate)})${execTxt}. Conforme regra operacional, este veículo não é contabilizado na cota de veículos descarregados deste turno.`
      );
    }
    lines.push('');
  }

  // Narrativa cronológica de eventos do turno
  const narrativeEvents: string[] = [];

  for (const v of breakdown.countedVehicles) {
    const matBold = `**${v.formattedMaterialName}**`;
    const startHr = formatHHmmFromIso(v.startedAtIso);
    const endHr = formatHHmmFromIso(v.finishedAtIso);
    const plateTxt = v.vehiclePlate ? ` (placa ${v.vehiclePlate}${v.driverName ? `, motorista ${v.driverName}` : ''})` : '';
    const nfTxt = v.invoiceNumber ? `, NF ${v.invoiceNumber}` : '';
    const silosTxt = v.siloNumbers.length > 0 ? v.siloNumbers.map((n) => `Silo ${n}`).join(' e ') : 'silo não informado';
    const typeTxt = v.receivingType === 'BIG_BAG' && v.bagCount ? ` via corte de ${v.bagCount} Big Bags` : ' a granel';
    const execTxt = v.executedByName
      ? ` (lançamento de ${v.operatorName}${v.operatorBadge ? ` · Mat. ${v.operatorBadge}` : ''}; execução de ${v.executedByName}${v.executedByBadge ? ` · Mat. ${v.executedByBadge}` : ''})`
      : ` (operador ${v.operatorName}${v.operatorBadge ? ` · Mat. ${v.operatorBadge}` : ''})`;

    narrativeEvents.push(
      `Entre ${startHr} e ${endHr}, realizou-se o recebimento e a descarga completa do veículo ${v.receiptNumber}${plateTxt}${nfTxt} de ${matBold}${typeTxt}, totalizando ${formatTonsAndKgPtBr(v.receivedKg)} direcionados ao ${silosTxt}${execTxt}.`
    );
  }

  for (const pv of breakdown.pendingOrPartialVehicles) {
    const matBold = `**${pv.formattedMaterialName}**`;
    const startHr = formatHHmmFromIso(pv.startedAtIso);
    const plateTxt = pv.vehiclePlate ? ` (placa ${pv.vehiclePlate})` : '';
    const silosTxt = pv.siloNumbers.length > 0 ? pv.siloNumbers.map((n) => `Silo ${n}`).join(', ') : 'sem silo confirmado';
    if (pv.status === 'PARCIAL') {
      narrativeEvents.push(
        `Às ${startHr}, iniciou-se o recebimento ${pv.receiptNumber}${plateTxt} de ${matBold}, permanecendo em descarga parcial com ${formatTonsAndKgPtBr(pv.distributedInShiftKg)} já alocados no ${silosTxt} e saldo restante de ${formatTonsAndKgPtBr(pv.remainingKg)} para conclusão.`
      );
    } else {
      narrativeEvents.push(
        `Às ${startHr}, deu entrada o veículo ${pv.receiptNumber}${plateTxt} com ${matBold} (${formatTonsAndKgPtBr(pv.receivedKg)}), permanecendo aguardando descarga em silo.`
      );
    }
  }

  for (const ev of s.chronologicalEvents) {
    if (ev.category === 'Recebimento') continue; // já narrado em detalhes acima quando há veículos estruturados
    narrativeEvents.push(`Às ${ev.timeLabel}, registrou-se ${ev.category.toLowerCase()}: ${ev.summary}`);
  }

  if (narrativeEvents.length > 0) {
    for (const para of narrativeEvents) {
      lines.push(para);
    }
  } else {
    lines.push('Não foram registradas movimentações físicas de descarga, transferência ou ajuste no decorrer deste turno.');
  }
  lines.push('');

  // Movimentações complementares (transferências, ajustes, cestas/programação, estoques críticos)
  const highlights: string[] = [];
  if (s.transfersCompletedCount > 0) {
    highlights.push(
      `Foram executadas ${s.transfersCompletedCount} etapa(s) de transferência interna entre silos, movimentando ${formatTonsAndKgPtBr(s.transfersCompletedKg)}.`
    );
  }
  if ((s.stockAdjustmentsCount || 0) > 0 && s.stockAdjustmentsSummary?.length) {
    highlights.push(`Ajustes de estoque autorizados no turno: ${s.stockAdjustmentsSummary.join('; ')}.`);
  }
  if ((s.basketUpdates?.length || 0) > 0) {
    highlights.push(
      `Atualizações de Cesta de Consumo registradas: ${s.basketUpdates!.map((b) => `${b.versionCode} (${b.label} — ${b.status})`).join('; ')}.`
    );
  } else if (s.updatedSchedules.length > 0) {
    highlights.push(
      `Programações de produção vigentes: ${s.updatedSchedules.map((sc) => `${sc.scheduleCode} Rev.${sc.revisionNumber} (${sc.status})`).join('; ')}.`
    );
  }
  if (s.criticalStocks.length > 0) {
    highlights.push(
      `Atenção para níveis críticos de estoque em ${s.criticalStocks
        .map((c) => `${formatMaterialTitleCaseBold(c.description)} (saldo ${Math.round(c.realStockKg).toLocaleString('pt-BR')} kg / mínimo ${Math.round(c.minStockKg).toLocaleString('pt-BR')} kg)`)
        .join(', ')}.`
    );
  }
  if (s.unavailableSilos.length > 0) {
    highlights.push(
      `Silos com restrição ou indisponibilidade operacional: ${s.unavailableSilos
        .map((u) => `Silo ${u.siloNumber} (${u.operationalStatus}${u.restrictions ? `: ${u.restrictions}` : ''})`)
        .join('; ')}.`
    );
  }
  if (highlights.length > 0) {
    lines.push(highlights.join(' '));
    lines.push('');
  }

  // Ocorrências e condições operacionais/climáticas
  if ((s.shiftOccurrences?.length || 0) > 0) {
    const occSentences = s.shiftOccurrences!.map((o) => {
      const extra: string[] = [];
      if (o.weatherCondition) extra.push(`condição climática: ${o.weatherCondition}`);
      if (o.lineImpact) extra.push(`impacto em linha: ${o.lineImpact}`);
      if (o.verifiedByName) extra.push(`verificada por ${o.verifiedByName}`);
      const extraTxt = extra.length > 0 ? ` (${extra.join('; ')})` : '';
      return `Às ${o.timeLabel}, ocorrência ${o.occurrenceCode} [${o.category}]: ${o.title} — ${o.description}${extraTxt}, status atual ${o.status}.`;
    });
    lines.push(occSentences.join(' '));
    lines.push('');
  } else if (params.relevantOccurrencesText?.trim()) {
    lines.push(`Sobre ocorrências do turno: ${params.relevantOccurrencesText.trim()}`);
    lines.push('');
  }

  // Informações complementares manuais registradas pelo operador
  if (params.supplements && params.supplements.length > 0) {
    for (const sup of params.supplements) {
      const hr = formatHHmmFromIso(sup.timestampIso);
      const auth = sup.executedByName
        ? `${sup.authorName} (executado por ${sup.executedByName})`
        : `${sup.authorName}${sup.authorBadge ? ` (Mat. ${sup.authorBadge})` : ''}`;
      lines.push(`Complemento registrado às ${hr} por ${auth}: ${sup.text}`);
    }
    lines.push('');
  }

  // Síntese, pendências e recomendações ao próximo turno
  const closingNotes: string[] = [];
  if (params.shiftSummaryText?.trim()) {
    closingNotes.push(params.shiftSummaryText.trim());
  }
  const autoPendencies: string[] = [];
  if (breakdown.pendingOrPartialVehicles.length > 0) {
    autoPendencies.push(
      `veículos aguardando conclusão de descarga (${breakdown.pendingOrPartialVehicles.map((p) => `${p.receiptNumber} de ${formatMaterialTitleCaseBold(p.formattedMaterialName)}`).join(', ')})`
    );
  }
  if (s.transfersPendingCount > 0) {
    autoPendencies.push(`transferências pendentes (${s.transfersPendingCodes.join(', ')})`);
  }
  if (s.openOccurrencesCount > 0) {
    autoPendencies.push(`${s.openOccurrencesCount} ocorrência(s) em aberto`);
  }
  if (params.pendenciesText?.trim()) {
    autoPendencies.push(params.pendenciesText.trim());
  }
  if (autoPendencies.length > 0) {
    closingNotes.push(`Pendências transferidas ao próximo turno: ${autoPendencies.join('; ')}.`);
  }
  if (params.requiredActionsText?.trim()) {
    closingNotes.push(`Ações solicitadas: ${params.requiredActionsText.trim()}`);
  }
  if (params.nextShiftRecommendationsText?.trim()) {
    closingNotes.push(`Recomendações à equipe entrante: ${params.nextShiftRecommendationsText.trim()}`);
  }
  if (closingNotes.length > 0) {
    lines.push(closingNotes.join(' '));
    lines.push('');
  }

  // BLOCO FINAL OBRIGATÓRIO
  lines.push(`**Veículos descarregados pelo ${shiftOrdinal} turno:**`);
  lines.push('');
  if (breakdown.countedByMaterial.length > 0) {
    for (const item of breakdown.countedByMaterial) {
      lines.push(`- ${item.count}x **${item.formattedMaterialName}**`);
    }
  } else {
    lines.push('- Nenhum veículo descarregado pelo turno.');
  }
  lines.push('');
  const plural = breakdown.totalCountedVehicles === 1 ? 'veículo descarregado' : 'veículos descarregados';
  lines.push(`**Total: ${breakdown.totalCountedVehicles} ${plural}.**`);
  lines.push('');
  lines.push('Turno encerrado. Qualquer dúvida, estamos à disposição.');

  return lines.join('\n');
}

/**
 * Gera o texto cronológico e objetivo do Relatório Automático do Turno
 * (mantido para compatibilidade com chamadas legadas e suíte de regressão Fase 5).
 */
export function buildChronologicalShiftReportText(params: {
  summary: ShiftAutoSummarySnapshot;
  handoverByName?: string | null;
  receivedByName?: string | null;
  shiftSummaryText?: string;
  relevantOccurrencesText?: string;
  pendenciesText?: string;
  requiredActionsText?: string;
  nextShiftRecommendationsText?: string;
}): string {
  const s = params.summary;
  const heading = `${getShiftHeadingLabel(s.shiftCode)} — ${formatIsoDatePtBr(s.operationalDate)}`;
  const lines: string[] = [
    heading,
    `Turno: ${s.shiftName}`,
    `Responsável pela passagem: ${params.handoverByName?.trim() || 'Dado não informado'}`,
    `Responsável pelo recebimento do turno: ${params.receivedByName?.trim() || 'Dado não informado'}`,
    '',
  ];

  lines.push('Panorama cronológico das operações');
  if (s.chronologicalEvents.length > 0) {
    for (const ev of s.chronologicalEvents) {
      lines.push(`• ${ev.timeLabel} — ${ev.summary}`);
    }
  } else {
    lines.push('• Nenhuma movimentação operacional registrada no banco de dados para este turno.');
  }
  lines.push('');

  lines.push('Recebimentos, descargas e silos abastecidos');
  lines.push(
    `• Recebimentos no turno: ${s.receiptsCount} registro(s), totalizando ${Math.round(s.receivedKg).toLocaleString('pt-BR')} kg recebidos e ${Math.round(s.distributedKg).toLocaleString('pt-BR')} kg distribuídos em silos.`
  );
  lines.push(
    `• Documentos/Notas informados: ${s.vehiclesOrInvoices.length > 0 ? s.vehiclesOrInvoices.join(', ') : 'Dado não informado'}.`
  );
  lines.push(
    `• Matérias-primas recebidas: ${
      s.materialsReceived.length > 0
        ? s.materialsReceived
            .map((m) => `${m.code} ${m.description} (${Math.round(m.kg).toLocaleString('pt-BR')} kg)`)
            .join('; ')
        : 'Nenhuma entrada no turno'
    }.`
  );
  lines.push(
    `• Silos abastecidos no turno: ${
      s.silosFed.length > 0
        ? s.silosFed
            .map((sf) => `Silo ${sf.siloNumber} (${sf.materialCode}: ${Math.round(sf.kg).toLocaleString('pt-BR')} kg)`)
            .join('; ')
        : 'Nenhum silo alimentado no turno'
    }.`
  );
  lines.push('');

  lines.push('Transferências, pendências operacionais e pontos de atenção');
  lines.push(
    `• Transferências concluídas/etapas executadas: ${s.transfersCompletedCount} (${Math.round(s.transfersCompletedKg).toLocaleString('pt-BR')} kg).`
  );
  lines.push(
    `• Transferências abertas ou parciais pendentes: ${
      s.transfersPendingCount > 0 ? `${s.transfersPendingCount} (${s.transfersPendingCodes.join(', ')})` : '0'
    }.`
  );
  lines.push(
    `• Descargas parciais pendentes: ${
      s.partialDischargesCount > 0 ? `${s.partialDischargesCount} (${s.partialReceiptNumbers.join(', ')})` : '0'
    }.`
  );
  lines.push(
    `• Materiais em estoque crítico: ${
      s.criticalStocks.length > 0
        ? s.criticalStocks
            .map(
              (c) =>
                `${c.materialCode} ${c.description} (Saldo ${Math.round(c.realStockKg).toLocaleString('pt-BR')} kg / Mín. ${Math.round(c.minStockKg).toLocaleString('pt-BR')} kg)`
            )
            .join('; ')
        : 'Nenhum material abaixo do mínimo cadastrado'
    }.`
  );
  lines.push(
    `• Silos ou equipamentos indisponíveis: ${
      s.unavailableSilos.length > 0
        ? s.unavailableSilos.map((u) => `Silo ${u.siloNumber} (${u.operationalStatus})`).join('; ')
        : 'Todos os silos cadastrados operacionais'
    }.`
  );
  lines.push(
    `• Ocorrências em aberto: ${
      s.openOccurrencesCount > 0 ? `${s.openOccurrencesCount} — ${s.openOccurrencesList.join('; ')}` : 'Nenhuma ocorrência aberta'
    }.`
  );
  lines.push('');

  lines.push('Fechamento e orientações ao próximo turno');
  lines.push(`• Resumo operacional do turno: ${params.shiftSummaryText?.trim() || 'Dado não informado'}`);
  lines.push(`• Ocorrências relevantes informadas: ${params.relevantOccurrencesText?.trim() || 'Dado não informado'}`);
  lines.push(`• Pendências registradas na passagem: ${params.pendenciesText?.trim() || 'Dado não informado'}`);
  lines.push(`• Ações necessárias: ${params.requiredActionsText?.trim() || 'Dado não informado'}`);
  lines.push(
    `• Recomendações ao próximo turno: ${params.nextShiftRecommendationsText?.trim() || 'Dado não informado'}`
  );

  return lines.join('\n');
}

export function polishShiftReportTextDeterministic(params: {
  baseReportText: string;
  rawFacts?: Record<string, unknown> | null;
  userCommand?: string | null;
}): {
  refinedText: string;
  warnings: string[];
} {
  let text = String(params.baseReportText || '').replace(/\r\n/g, '\n').trim();
  text = text.replace(/\n{3,}/g, '\n\n');
  const lines = text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('-') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('•')
    ) {
      return line;
    }
    if (/[A-Za-zÀ-ÿ0-9)]$/.test(trimmed)) {
      return `${trimmed}.`;
    }
    return line;
  });
  text = lines.join('\n');

  const warnings: string[] = [];
  const cmd = String(params.userCommand || '').trim();
  const cmdLower = cmd.toLowerCase();

  if (cmd) {
    if (
      (cmdLower.includes('acrescentar') ||
        cmdLower.includes('incluir') ||
        cmdLower.includes('adicionar') ||
        cmdLower.includes('chuva') ||
        cmdLower.includes('parada') ||
        cmdLower.includes('manutenção') ||
        cmdLower.includes('manutencao')) &&
      !text.toLowerCase().includes(cmdLower)
    ) {
      const marker = '**Veículos descarregados pelo';
      const noteLine = `Observação complementar incorporada na revisão do turno: ${cmd.replace(/\.$/, '')}.`;
      const idx = text.indexOf(marker);
      if (idx > 0) {
        text = `${text.slice(0, idx).trim()}\n\n${noteLine}\n\n${text.slice(idx)}`;
      } else {
        text = `${text}\n\n${noteLine}`;
      }
    }
  }

  const raw = params.rawFacts as any;
  if (raw && typeof raw === 'object') {
    if (!raw.receivedByName) {
      warnings.push('Responsável pelo recebimento do próximo turno ainda não foi informado.');
    }
    const pendingList = raw.vehicleBreakdown?.pendingOrPartialVehicles || raw.pendingVehicles;
    if (Array.isArray(pendingList) && pendingList.length > 0) {
      warnings.push(`${pendingList.length} veículo(s) com descarga parcial/pendente requerem continuidade no próximo turno.`);
    }
    if (Number(raw.openOccurrencesCount || 0) > 0) {
      warnings.push(`Existem ${raw.openOccurrencesCount} ocorrência(s) em aberto vinculadas ao ambiente operacional.`);
    }
  }

  return { refinedText: text, warnings };
}

