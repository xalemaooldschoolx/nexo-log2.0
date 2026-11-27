import type {
  BasketComparisonView,
  BasketDiffClassification,
  BasketDiffItemView,
  BasketItemView,
  BasketLineSummaryView,
  BasketOperationalImpactView,
  BasketVersionView,
  MaterialItem,
  SiloDetail,
  TransferRuleItem,
} from '../types/nexo.ts';

export const OFFICIAL_PRODUCTION_LINES = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'] as const;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/**
 * Converte números no padrão brasileiro (ex.: "62.888", "18.207,38", "1.200.500,5")
 * ou formato numérico padrão sem confundir separador de milhar com decimal.
 */
export function parseBrazilianNumber(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  let text = String(raw)
    .trim()
    .replace(/\s+/g, '')
    .replace(/(kg|toneladas|ton|t)$/i, '');

  if (!text || text === '-' || text === '—' || text.toLowerCase() === 'nao_identificado') {
    return null;
  }

  // Preserva sinal negativo se presente
  const isNegative = text.startsWith('-');
  text = text.replace(/^[+-]/, '');

  // Apenas dígitos
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return Number.isFinite(n) ? (isNegative ? -n : n) : null;
  }

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  let normalized = text;

  if (hasComma && hasDot) {
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    if (lastComma > lastDot) {
      // Padrão BR: 18.207,38
      normalized = text.replace(/\./g, '').replace(',', '.');
    } else {
      // Padrão EN: 18,207.38
      normalized = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Se tem exatamente um grupo de 3 dígitos após vírgula e vários grupos? No Brasil vírgula é decimal.
    // Exceção: "1,200,500" (múltiplas vírgulas) -> milhar EN
    const commaParts = text.split(',');
    if (commaParts.length > 2) {
      normalized = text.replace(/,/g, '');
    } else {
      normalized = text.replace(',', '.');
    }
  } else if (hasDot) {
    // Ex.: "62.888", "1.200.500" vs "1000.5"
    const dotParts = text.split('.');
    if (dotParts.length > 2) {
      // Múltiplos pontos são sempre separadores de milhar (ex.: 1.200.000)
      normalized = text.replace(/\./g, '');
    } else if (dotParts.length === 2 && dotParts[1].length === 3 && /^\d+$/.test(dotParts[0]) && Number(dotParts[0]) >= 1) {
      // No contexto de cestas em kg no Brasil, "62.888", "3.561", "11.492", "30.115" são milhares!
      normalized = text.replace(/\./g, '');
    } else {
      normalized = text;
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return isNegative ? -parsed : parsed;
}

export function formatBrazilianNumber(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const hasFraction = Math.abs(value - Math.round(value)) > 0.0001;
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: hasFraction ? decimals : 0,
    maximumFractionDigits: decimals,
  });
}

export function formatBrazilianDiff(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatBrazilianNumber(Math.abs(value), 2)}`;
}

export function normalizeLineCode(raw: string | null | undefined): string {
  if (!raw) return 'L1';
  const cleaned = String(raw).trim().toUpperCase();
  const match = cleaned.match(/(\d+)/);
  if (match) {
    const num = Number(match[1]);
    if (num >= 1 && num <= 7) {
      return `L${num}`;
    }
    return `L${num}`;
  }
  return cleaned;
}

export function normalizeUnitToKgMultiplier(unitRaw: string | null | undefined): number {
  const u = (unitRaw || 'kg').trim().toLowerCase();
  if (u === 't' || u === 'ton' || u === 'tonelada' || u === 'toneladas') {
    return 1000;
  }
  return 1;
}

export function convertRawQuantityToKg(
  rawQty: string | number | null | undefined,
  unit: string | null | undefined
): number | null {
  const num = parseBrazilianNumber(rawQty);
  if (num === null) return null;
  const mult = normalizeUnitToKgMultiplier(unit);
  return round2(num * mult);
}

function normalizeDescriptionForFallback(desc: string): string {
  return desc
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface BasketCompareInputItem {
  id?: number;
  productionDate: string;
  lineCode: string;
  materialId?: number | null;
  materialCode: string | null;
  materialDescription: string;
  rawQuantityText?: string | null;
  plannedQuantityKg: number | null;
  unit: string;
  sourcePage?: number;
  sourceDocumentName?: string | null;
  sourceRegion?: string | null;
  confidence?: 'ALTA' | 'MEDIA' | 'BAIXA';
  needsReview?: boolean;
  reviewReason?: string | null;
}

interface AggregatedBucket {
  key: string;
  matchedByCode: boolean;
  productionDate: string;
  lineCode: string;
  materialId: number | null;
  materialCode: string | null;
  materialDescription: string;
  quantityKg: number | null;
  unit: string;
  sourceRefs: string[];
  needsReview: boolean;
  reviewReasons: string[];
  duplicateCount: number;
}

function aggregateItemsForComparison(
  items: BasketCompareInputItem[],
  materialsByCode: Map<string, MaterialItem>
): Map<string, AggregatedBucket> {
  const map = new Map<string, AggregatedBucket>();

  for (const item of items) {
    const lineCode = normalizeLineCode(item.lineCode);
    const codeClean = item.materialCode ? item.materialCode.trim().toUpperCase() : null;
    const matchedByCode = Boolean(codeClean);
    const descKey = normalizeDescriptionForFallback(item.materialDescription || 'SEM DESCRIÇÃO');

    // Prioridade absoluta pelo código do material quando disponível
    const key = matchedByCode
      ? `${lineCode}::CODE::${codeClean}`
      : `${lineCode}::DESC::${descKey}`;

    const matRef = codeClean ? materialsByCode.get(codeClean) : undefined;
    const sourceRef = `Pág. ${item.sourcePage ?? 1}${item.sourceRegion ? ` (${item.sourceRegion})` : ''}${
      item.sourceDocumentName ? ` · ${item.sourceDocumentName}` : ''
    }`;

    const existing = map.get(key);
    if (!existing) {
      const reasons: string[] = [];
      if (item.needsReview) {
        reasons.push(item.reviewReason || 'Item marcado para conferência humana.');
      }
      if (!matchedByCode) {
        reasons.push('Código do material não identificado; pareamento por descrição requer conferência.');
      }
      if (item.plannedQuantityKg === null || item.plannedQuantityKg === undefined) {
        reasons.push('Quantidade planejada ilegível ou ausente.');
      }
      map.set(key, {
        key,
        matchedByCode,
        productionDate: item.productionDate,
        lineCode,
        materialId: item.materialId ?? matRef?.id ?? null,
        materialCode: codeClean,
        materialDescription: item.materialDescription || matRef?.description || 'Material não identificado',
        quantityKg:
          item.plannedQuantityKg !== null && item.plannedQuantityKg !== undefined
            ? round2(item.plannedQuantityKg)
            : null,
        unit: item.unit || 'kg',
        sourceRefs: [sourceRef],
        needsReview: Boolean(item.needsReview) || !matchedByCode || item.plannedQuantityKg === null,
        reviewReasons: reasons,
        duplicateCount: 1,
      });
    } else {
      existing.duplicateCount += 1;
      existing.sourceRefs.push(sourceRef);
      existing.needsReview = true;
      existing.reviewReasons.push(
        `Material duplicado (${existing.duplicateCount}x) nesta cesta para ${lineCode}; validar soma ou erro de leitura.`
      );
      if (existing.quantityKg !== null && item.plannedQuantityKg !== null) {
        existing.quantityKg = round2(existing.quantityKg + item.plannedQuantityKg);
      } else {
        existing.quantityKg = null;
      }
    }
  }

  return map;
}

export interface CompareBasketsContext {
  comparisonId?: number;
  comparisonCode?: string;
  productionDate: string;
  baseVersion: {
    id: number;
    label: string;
    emissionTime: string | null;
  };
  targetVersion: {
    id: number;
    label: string;
    emissionTime: string | null;
  };
  baseItems: BasketCompareInputItem[];
  targetItems: BasketCompareInputItem[];
  silos: SiloDetail[];
  materials: MaterialItem[];
  transferRules: TransferRuleItem[];
  pendingReceiptsKgByMaterial?: Map<number, number>;
  createdByName?: string;
  publishedByName?: string | null;
  publishedAt?: string | null;
  status?: 'CONFERENCIA' | 'COMPARADA' | 'PUBLICADA';
  createdAt?: string;
}

export function compareBasketVersions(ctx: CompareBasketsContext): BasketComparisonView {
  const materialsByCode = new Map<string, MaterialItem>(
    ctx.materials.map((m) => [m.code.trim().toUpperCase(), m])
  );

  const baseMap = aggregateItemsForComparison(ctx.baseItems, materialsByCode);
  const targetMap = aggregateItemsForComparison(ctx.targetItems, materialsByCode);

  const allKeys = Array.from(new Set([...baseMap.keys(), ...targetMap.keys()]));
  const diffItems: BasketDiffItemView[] = [];

  let seq = 1;
  for (const key of allKeys) {
    const prev = baseMap.get(key);
    const next = targetMap.get(key);

    const lineCode = next?.lineCode || prev?.lineCode || 'L1';
    const materialCode = next?.materialCode || prev?.materialCode || null;
    const materialId = next?.materialId ?? prev?.materialId ?? null;
    const materialDescription =
      next?.materialDescription || prev?.materialDescription || 'Material não identificado';
    const unit = next?.unit || prev?.unit || 'kg';

    const previousQuantityKg = prev ? prev.quantityKg : null;
    const newQuantityKg = next ? next.quantityKg : null;

    const combinedReasons = [
      ...(prev?.reviewReasons || []),
      ...(next?.reviewReasons || []),
    ];
    const hasAmbiguity = Boolean(prev?.needsReview || next?.needsReview);

    let classification: BasketDiffClassification;
    let diffKg: number | null = null;
    let pctChange: number | null = null;

    if (hasAmbiguity || (prev && previousQuantityKg === null) || (next && newQuantityKg === null)) {
      classification = 'PENDENTE_CONFERENCIA';
      if (prev && next && previousQuantityKg !== null && newQuantityKg !== null) {
        diffKg = round2(newQuantityKg - previousQuantityKg);
        pctChange =
          previousQuantityKg > 0 ? round2((diffKg / previousQuantityKg) * 100) : null;
      }
    } else if (!prev && next) {
      classification = 'NOVO_MATERIAL';
      diffKg = newQuantityKg !== null ? round2(newQuantityKg) : null;
      pctChange = null;
    } else if (prev && !next) {
      classification = 'MATERIAL_RETIRADO';
      diffKg = previousQuantityKg !== null ? round2(-previousQuantityKg) : null;
      pctChange = previousQuantityKg && previousQuantityKg > 0 ? -100 : null;
    } else {
      const pVal = previousQuantityKg ?? 0;
      const nVal = newQuantityKg ?? 0;
      diffKg = round2(nVal - pVal);
      pctChange = pVal > 0 ? round2((diffKg / pVal) * 100) : nVal > 0 ? 100 : 0;

      if (Math.abs(diffKg) <= 0.009) {
        classification = 'MANTIDO';
        diffKg = 0;
      } else if (diffKg > 0) {
        classification = 'AUMENTOU';
      } else {
        classification = 'DIMINUIU';
      }
    }

    diffItems.push({
      id: seq++,
      comparisonId: ctx.comparisonId ?? 0,
      productionDate: ctx.productionDate,
      lineCode,
      materialId,
      materialCode,
      materialDescription,
      previousQuantityKg,
      newQuantityKg,
      diffKg,
      pctChange,
      unit,
      classification,
      previousSourceRef: prev ? prev.sourceRefs.join(' | ') : null,
      newSourceRef: next ? next.sourceRefs.join(' | ') : null,
      needsReview: classification === 'PENDENTE_CONFERENCIA' || hasAmbiguity,
      reviewReason: combinedReasons.length > 0 ? combinedReasons.join(' ') : null,
    });
  }

  // Ordenar por linha L1..L7 e depois por maior impacto absoluto
  diffItems.sort((a, b) => {
    const la = Number(a.lineCode.replace(/\D/g, '') || 99);
    const lb = Number(b.lineCode.replace(/\D/g, '') || 99);
    if (la !== lb) return la - lb;
    return Math.abs(b.diffKg ?? 0) - Math.abs(a.diffKg ?? 0);
  });

  // Resumo por linha (garantir L1 a L7)
  const lineSummariesMap = new Map<string, BasketLineSummaryView>();
  for (const lc of OFFICIAL_PRODUCTION_LINES) {
    lineSummariesMap.set(lc, {
      lineCode: lc,
      previousTotalKg: 0,
      newTotalKg: 0,
      diffKg: 0,
      pctChange: null,
      increasedCount: 0,
      decreasedCount: 0,
      newCount: 0,
      removedCount: 0,
      unchangedCount: 0,
      pendingCount: 0,
    });
  }

  for (const item of diffItems) {
    const line = lineSummariesMap.get(item.lineCode) ?? {
      lineCode: item.lineCode,
      previousTotalKg: 0,
      newTotalKg: 0,
      diffKg: 0,
      pctChange: null,
      increasedCount: 0,
      decreasedCount: 0,
      newCount: 0,
      removedCount: 0,
      unchangedCount: 0,
      pendingCount: 0,
    };
    line.previousTotalKg = round2(line.previousTotalKg + (item.previousQuantityKg ?? 0));
    line.newTotalKg = round2(line.newTotalKg + (item.newQuantityKg ?? 0));
    line.diffKg = round2(line.newTotalKg - line.previousTotalKg);
    line.pctChange =
      line.previousTotalKg > 0 ? round2((line.diffKg / line.previousTotalKg) * 100) : null;

    if (item.classification === 'AUMENTOU') line.increasedCount += 1;
    else if (item.classification === 'DIMINUIU') line.decreasedCount += 1;
    else if (item.classification === 'NOVO_MATERIAL') line.newCount += 1;
    else if (item.classification === 'MATERIAL_RETIRADO') line.removedCount += 1;
    else if (item.classification === 'MANTIDO') line.unchangedCount += 1;
    else if (item.classification === 'PENDENTE_CONFERENCIA') line.pendingCount += 1;

    lineSummariesMap.set(item.lineCode, line);
  }

  const lineSummaries = Array.from(lineSummariesMap.values()).sort((a, b) => {
    const la = Number(a.lineCode.replace(/\D/g, '') || 99);
    const lb = Number(b.lineCode.replace(/\D/g, '') || 99);
    return la - lb;
  });

  const totalPreviousKg = round2(
    diffItems.reduce((acc, d) => acc + (d.previousQuantityKg ?? 0), 0)
  );
  const totalNewKg = round2(
    diffItems.reduce((acc, d) => acc + (d.newQuantityKg ?? 0), 0)
  );
  const totalDiffKg = round2(totalNewKg - totalPreviousKg);
  const totalPctChange =
    totalPreviousKg > 0 ? round2((totalDiffKg / totalPreviousKg) * 100) : null;

  const topIncreases = diffItems
    .filter((d) => (d.diffKg ?? 0) > 0)
    .sort((a, b) => (b.diffKg ?? 0) - (a.diffKg ?? 0))
    .slice(0, 10);

  const topDecreases = diffItems
    .filter((d) => (d.diffKg ?? 0) < 0)
    .sort((a, b) => (a.diffKg ?? 0) - (b.diffKg ?? 0))
    .slice(0, 10);

  // Impacto operacional real nos silos e abastecimento da Moega (nunca altera saldo físico!)
  const operationalImpacts: BasketOperationalImpactView[] = [];
  for (const item of diffItems) {
    const planned = item.newQuantityKg ?? 0;
    if (planned <= 0 && (item.diffKg ?? 0) === 0) continue;

    const matchingSilos = ctx.silos.filter((s) => {
      if (s.operationalStatus !== 'OPERACIONAL') return false;
      const matMatch =
        (item.materialId && s.primaryMaterialId === item.materialId) ||
        (item.materialCode && s.materialCode?.toUpperCase() === item.materialCode.toUpperCase()) ||
        (item.materialId &&
          s.compatibilities.some((c) => c.materialId === item.materialId && c.allowTransferIn));
      if (!matMatch) return false;
      // Prioriza silos da mesma linha ou silos pulmão de armazenagem (L7)
      return s.lineCode === item.lineCode || s.category === 'ARMAZENAGEM';
    });

    const lineDirectSilos = matchingSilos.filter((s) => s.lineCode === item.lineCode);
    const evalSilos = lineDirectSilos.length > 0 ? lineDirectSilos : matchingSilos;

    const confirmedStockKg = round2(
      evalSilos.reduce((acc, s) => acc + Number(s.confirmedStockKg || 0), 0)
    );
    const safeCapacityKg = round2(
      evalSilos.reduce((acc, s) => acc + Number(s.safeCapacityKg || 0), 0)
    );
    const freeSpaceKg = round2(Math.max(0, safeCapacityKg - confirmedStockKg));
    const pendingReceiptsKg =
      item.materialId && ctx.pendingReceiptsKgByMaterial
        ? round2(ctx.pendingReceiptsKgByMaterial.get(item.materialId) || 0)
        : 0;

    const projectedBalanceKg = round2(confirmedStockKg + pendingReceiptsKg - planned);
    const occupancyAfterPlannedPct =
      safeCapacityKg > 0
        ? round2((Math.max(0, confirmedStockKg - planned) / safeCapacityKg) * 100)
        : null;

    // Verificar rotas ativas disponíveis para suprir silos dessa linha
    const evalSiloIds = new Set(evalSilos.map((s) => s.id));
    const suggestedOriginNums = Array.from(
      new Set(
        ctx.transferRules
          .filter(
            (r) =>
              r.isActive &&
              r.authorizationStatus === 'AUTORIZADA' &&
              (!item.materialId || r.materialId === item.materialId) &&
              evalSiloIds.has(r.destinationSiloId)
          )
          .map((r) => {
            const orig = ctx.silos.find((s) => s.id === r.originSiloId);
            return orig && orig.confirmedStockKg > 0 ? orig.siloNumber : null;
          })
          .filter((n): n is number => n !== null)
      )
    );

    let shortageRisk: BasketOperationalImpactView['shortageRisk'] = 'OK';
    let recommendationText = `Estoque compatível (${formatBrazilianNumber(confirmedStockKg, 0)} kg) atende à programação da ${item.lineCode}.`;

    if (evalSilos.length === 0) {
      shortageRisk = 'SEM_SILO_COMPATIVEL';
      recommendationText = `Nenhum silo operacional compatível vinculado para ${item.materialDescription} na ${item.lineCode}. Verificar cadastro de compatibilidade.`;
    } else if (projectedBalanceKg < 0) {
      shortageRisk = 'CRITICO';
      const deficit = Math.abs(projectedBalanceKg);
      recommendationText =
        suggestedOriginNums.length > 0
          ? `Risco de falta de ${formatBrazilianNumber(deficit, 2)} kg na ${item.lineCode}. Avaliar transferência autorizada a partir do(s) Silo(s) ${suggestedOriginNums.join(', ')} ou programar recebimento.`
          : `Risco de falta de ${formatBrazilianNumber(deficit, 2)} kg na ${item.lineCode}. Não há rota de transferência ativa com saldo; programar recebimento.`;
    } else if (projectedBalanceKg < planned * 0.25) {
      shortageRisk = 'ATENCAO';
      recommendationText = `Saldo projetado após consumo (${formatBrazilianNumber(projectedBalanceKg, 2)} kg) abaixo da margem de segurança de 25% na ${item.lineCode}.`;
    }

    operationalImpacts.push({
      lineCode: item.lineCode,
      materialId: item.materialId,
      materialCode: item.materialCode,
      materialDescription: item.materialDescription,
      newPlannedKg: planned,
      diffKg: item.diffKg ?? 0,
      compatibleSilosCount: evalSilos.length,
      compatibleSiloNumbers: evalSilos.map((s) => s.siloNumber),
      confirmedStockKg,
      safeCapacityKg,
      freeSpaceKg,
      pendingReceiptsKg,
      projectedBalanceKg,
      occupancyAfterPlannedPct,
      shortageRisk,
      suggestedTransferOriginSilos: suggestedOriginNums,
      recommendationText,
    });
  }

  operationalImpacts.sort((a, b) => {
    const rank = (r: BasketOperationalImpactView['shortageRisk']) =>
      r === 'CRITICO' ? 0 : r === 'SEM_SILO_COMPATIVEL' ? 1 : r === 'ATENCAO' ? 2 : 3;
    const ra = rank(a.shortageRisk);
    const rb = rank(b.shortageRisk);
    if (ra !== rb) return ra - rb;
    return a.projectedBalanceKg - b.projectedBalanceKg;
  });

  return {
    id: ctx.comparisonId ?? 1,
    comparisonCode:
      ctx.comparisonCode ||
      `CMP-${ctx.productionDate.replace(/-/g, '')}-${ctx.baseVersion.id}V${ctx.targetVersion.id}`,
    productionDate: ctx.productionDate,
    baseVersionId: ctx.baseVersion.id,
    baseVersionLabel: ctx.baseVersion.label,
    baseEmissionTime: ctx.baseVersion.emissionTime,
    targetVersionId: ctx.targetVersion.id,
    targetVersionLabel: ctx.targetVersion.label,
    targetEmissionTime: ctx.targetVersion.emissionTime,
    status: ctx.status ?? 'COMPARADA',
    totalPreviousKg,
    totalNewKg,
    totalDiffKg,
    pctChange: totalPctChange,
    counts: {
      totalMaterials: diffItems.length,
      increased: diffItems.filter((d) => d.classification === 'AUMENTOU').length,
      decreased: diffItems.filter((d) => d.classification === 'DIMINUIU').length,
      unchanged: diffItems.filter((d) => d.classification === 'MANTIDO').length,
      added: diffItems.filter((d) => d.classification === 'NOVO_MATERIAL').length,
      removed: diffItems.filter((d) => d.classification === 'MATERIAL_RETIRADO').length,
      pendingReview: diffItems.filter((d) => d.classification === 'PENDENTE_CONFERENCIA').length,
    },
    lineSummaries,
    diffItems,
    topIncreases,
    topDecreases,
    operationalImpacts,
    createdByName: ctx.createdByName || 'Supervisão Moega',
    publishedByName: ctx.publishedByName ?? null,
    publishedAt: ctx.publishedAt ?? null,
    createdAt: ctx.createdAt || new Date().toISOString(),
  };
}

/**
 * Conjunto de referência oficial 25/11 (Prompt Seção 12) + versões intermediárias 11:30 e 15:00
 * + cobertura das linhas L1 a L7 para testes automatizados e Sandbox de Demonstração.
 */
export function buildReference2511BasketVersions(
  materials: MaterialItem[]
): BasketVersionView[] {
  const findMat = (code: string) =>
    materials.find((m) => m.code.toUpperCase() === code.toUpperCase()) || null;

  const makeItem = (
    id: number,
    versionId: number,
    lineCode: string,
    code: string,
    fallbackDesc: string,
    rawQty: string,
    page: number,
    region: string
  ): BasketItemView => {
    const mat = findMat(code);
    const qtyKg = parseBrazilianNumber(rawQty);
    return {
      id,
      basketVersionId: versionId,
      productionDate: '2026-11-25',
      lineCode,
      materialId: mat?.id ?? null,
      materialCode: code,
      materialDescription: mat?.description || fallbackDesc,
      rawQuantityText: rawQty,
      plannedQuantityKg: qtyKg,
      unit: 'kg',
      sourcePage: page,
      sourceDocumentName: `cesta-25-11-v${versionId}.jpg`,
      sourceRegion: region,
      confidence: 'ALTA',
      needsReview: false,
      reviewReason: null,
      manuallyEdited: false,
      editedByName: null,
    };
  };

  // V1 — Cesta da Manhã 07:00
  const v1Items: BasketItemView[] = [
    makeItem(101, 1, 'L1', '1211101012', 'MILHO MOÍDO BC', '42.500', 1, 'Tabela L1 · L1'),
    makeItem(102, 1, 'L1', '2017101021', 'CALCARIO', '14.200', 1, 'Tabela L1 · L2'),
    makeItem(103, 1, 'L2', '1211101012', 'MILHO MOÍDO BC', '36.800', 1, 'Tabela L2 · L1'),
    makeItem(104, 1, 'L2', '1614161040', 'FARELO DE ALGODÃO', '18.400', 1, 'Tabela L2 · L2'),
    makeItem(105, 1, 'L3', 'F30BMOA80', 'QUIRERA DE ARROZ', '24.100', 1, 'Tabela L3 · L1'),
    // Linha 4 — Referência exata do Prompt (25/11 07:00)
    makeItem(106, 1, 'L4', '2017101021', 'CALCARIO', '62.888', 2, 'Tabela L4 · L1'),
    makeItem(107, 1, 'L4', '1113101920', 'VEÍCULO PREMIX', '3.561', 2, 'Tabela L4 · L2'),
    makeItem(108, 1, 'L4', '2019131030', 'FOSFATO MONOCÁLCICO 21%', '11.492', 2, 'Tabela L4 · L3'),
    makeItem(109, 1, 'L4', '2021171023', 'SAL MOÍDO PENEIRADO', '30.115', 2, 'Tabela L4 · L4'),
    makeItem(110, 1, 'L5', '2090121061', 'CAULIM', '12.600', 2, 'Tabela L5 · L1'),
    makeItem(111, 1, 'L6', '1613131012', 'GLÚTEN DE MILHO 60%', '19.800', 2, 'Tabela L6 · L1'),
    makeItem(112, 1, 'L7', '2019101141', 'FOSFATO BICÁLCICO', '15.000', 2, 'Tabela L7 · L1'),
  ];

  // V2 — Atualização 11:30
  const v2Items: BasketItemView[] = [
    makeItem(201, 2, 'L1', '1211101012', 'MILHO MOÍDO BC', '44.100', 1, 'Tabela L1 · L1'),
    makeItem(202, 2, 'L1', '2017101021', 'CALCARIO', '14.200', 1, 'Tabela L1 · L2'),
    makeItem(203, 2, 'L2', '1211101012', 'MILHO MOÍDO BC', '36.800', 1, 'Tabela L2 · L1'),
    makeItem(204, 2, 'L2', '1614161040', 'FARELO DE ALGODÃO', '20.100', 1, 'Tabela L2 · L2'),
    makeItem(205, 2, 'L3', 'F30BMOA80', 'QUIRERA DE ARROZ', '22.000', 1, 'Tabela L3 · L1'),
    makeItem(206, 2, 'L4', '2017101021', 'CALCARIO', '48.200', 2, 'Tabela L4 · L1'),
    makeItem(207, 2, 'L4', '1113101920', 'VEÍCULO PREMIX', '6.120', 2, 'Tabela L4 · L2'),
    makeItem(208, 2, 'L4', '2019131030', 'FOSFATO MONOCÁLCICO 21%', '8.400', 2, 'Tabela L4 · L3'),
    makeItem(209, 2, 'L4', '2021171023', 'SAL MOÍDO PENEIRADO', '21.500', 2, 'Tabela L4 · L4'),
    makeItem(210, 2, 'L5', '2090121061', 'CAULIM', '14.000', 2, 'Tabela L5 · L1'),
    makeItem(211, 2, 'L6', '1613131012', 'GLÚTEN DE MILHO 60%', '21.400', 2, 'Tabela L6 · L1'),
    makeItem(212, 2, 'L7', '2019101141', 'FOSFATO BICÁLCICO', '15.000', 2, 'Tabela L7 · L1'),
  ];

  // V3 — Atualização 15:00
  const v3Items: BasketItemView[] = [
    makeItem(301, 3, 'L1', '1211101012', 'MILHO MOÍDO BC', '46.000', 1, 'Tabela L1 · L1'),
    makeItem(302, 3, 'L1', '2017101021', 'CALCARIO', '15.500', 1, 'Tabela L1 · L2'),
    makeItem(303, 3, 'L2', '1211101012', 'MILHO MOÍDO BC', '33.200', 1, 'Tabela L2 · L1'),
    makeItem(304, 3, 'L2', '1614161040', 'FARELO DE ALGODÃO', '22.000', 1, 'Tabela L2 · L2'),
    makeItem(305, 3, 'L3', 'F30BMOA80', 'QUIRERA DE ARROZ', '19.500', 1, 'Tabela L3 · L1'),
    makeItem(306, 3, 'L4', '2017101021', 'CALCARIO', '29.450', 2, 'Tabela L4 · L1'),
    makeItem(307, 3, 'L4', '1113101920', 'VEÍCULO PREMIX', '8.340', 2, 'Tabela L4 · L2'),
    makeItem(308, 3, 'L4', '2019131030', 'FOSFATO MONOCÁLCICO 21%', '5.100', 2, 'Tabela L4 · L3'),
    makeItem(309, 3, 'L4', '2021171023', 'SAL MOÍDO PENEIRADO', '14.200', 2, 'Tabela L4 · L4'),
    makeItem(310, 3, 'L5', '2090121061', 'CAULIM', '15.200', 2, 'Tabela L5 · L1'),
    makeItem(311, 3, 'L6', '1613131012', 'GLÚTEN DE MILHO 60%', '22.900', 2, 'Tabela L6 · L1'),
    makeItem(312, 3, 'L7', '2019101141', 'FOSFATO BICÁLCICO', '16.800', 2, 'Tabela L7 · L1'),
  ];

  // V4 — Cesta Atualizada 19:00 (Referência exata do Prompt 25/11 19:00)
  const v4Items: BasketItemView[] = [
    makeItem(401, 4, 'L1', '1211101012', 'MILHO MOÍDO BC', '48.250', 1, 'Tabela L1 · L1'),
    makeItem(402, 4, 'L1', '2017101021', 'CALCARIO', '16.400', 1, 'Tabela L1 · L2'),
    makeItem(403, 4, 'L2', '1211101012', 'MILHO MOÍDO BC', '31.900', 1, 'Tabela L2 · L1'),
    makeItem(404, 4, 'L2', '1614161040', 'FARELO DE ALGODÃO', '24.600', 1, 'Tabela L2 · L2'),
    makeItem(405, 4, 'L3', 'F30BMOA80', 'QUIRERA DE ARROZ', '19.500', 1, 'Tabela L3 · L1'),
    makeItem(406, 4, 'L3', '1553241021', 'FARINHA DE VÍSCERAS', '8.400', 1, 'Tabela L3 · L2'),
    // Linha 4 — Referência exata do Prompt (25/11 19:00)
    makeItem(407, 4, 'L4', '2017101021', 'CALCARIO', '18.207,38', 2, 'Tabela L4 · L1'),
    makeItem(408, 4, 'L4', '1113101920', 'VEÍCULO PREMIX', '9.961,27', 2, 'Tabela L4 · L2'),
    makeItem(409, 4, 'L4', '2019131030', 'FOSFATO MONOCÁLCICO 21%', '2.709,97', 2, 'Tabela L4 · L3'),
    makeItem(410, 4, 'L4', '2021171023', 'SAL MOÍDO PENEIRADO', '7.218,16', 2, 'Tabela L4 · L4'),
    makeItem(411, 4, 'L5', '2090121061', 'CAULIM', '16.850', 2, 'Tabela L5 · L1'),
    makeItem(412, 4, 'L6', '1613131012', 'GLÚTEN DE MILHO 60%', '24.150', 2, 'Tabela L6 · L1'),
    makeItem(413, 4, 'L7', '2019101141', 'FOSFATO BICÁLCICO', '18.300', 2, 'Tabela L7 · L1'),
  ];

  return [
    {
      id: 1,
      versionCode: 'CESTA-20261125-V1',
      label: 'Cesta da Manhã — 07:00',
      productionDate: '2026-11-25',
      emissionTime: '07:00',
      sequenceOrder: 1,
      sourceType: 'CAMERA_TABLET',
      status: 'ARQUIVADA',
      isCurrentPublished: false,
      linkedScheduleId: null,
      sourcePages: [
        { pageNumber: 1, fileName: 'cesta-07h-pag1.jpg', mimeType: 'image/jpeg' },
        { pageNumber: 2, fileName: 'cesta-07h-pag2.jpg', mimeType: 'image/jpeg' },
      ],
      unreadableFields: [],
      createdByName: 'Planejamento PCP [DEMO]',
      publishedByName: 'Supervisor Turno 1 [DEMO]',
      publishedAt: '2026-11-25T07:12:00.000Z',
      notes: 'Primeira cesta emitida no início do 1º turno (25/11).',
      createdAt: '2026-11-25T07:05:00.000Z',
      items: v1Items,
    },
    {
      id: 2,
      versionCode: 'CESTA-20261125-V2',
      label: 'Revisão Parcial — 11:30',
      productionDate: '2026-11-25',
      emissionTime: '11:30',
      sequenceOrder: 2,
      sourceType: 'ARQUIVO_PDF',
      status: 'ARQUIVADA',
      isCurrentPublished: false,
      linkedScheduleId: null,
      sourcePages: [{ pageNumber: 1, fileName: 'cesta-11h30.pdf', mimeType: 'application/pdf' }],
      unreadableFields: [],
      createdByName: 'Planejamento PCP [DEMO]',
      publishedByName: 'Supervisor Turno 1 [DEMO]',
      publishedAt: '2026-11-25T11:38:00.000Z',
      notes: 'Ajuste de meio de turno na Linha 4 e Linha 2.',
      createdAt: '2026-11-25T11:32:00.000Z',
      items: v2Items,
    },
    {
      id: 3,
      versionCode: 'CESTA-20261125-V3',
      label: 'Atualização Tarde — 15:00',
      productionDate: '2026-11-25',
      emissionTime: '15:00',
      sequenceOrder: 3,
      sourceType: 'ARQUIVO_XLSX',
      status: 'ARQUIVADA',
      isCurrentPublished: false,
      linkedScheduleId: null,
      sourcePages: [{ pageNumber: 1, fileName: 'cesta-15h.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
      unreadableFields: [],
      createdByName: 'Planejamento PCP [DEMO]',
      publishedByName: 'Supervisor Turno 1 [DEMO]',
      publishedAt: '2026-11-25T15:06:00.000Z',
      notes: 'Reprogramação intermediária antes da troca para o 2º Turno.',
      createdAt: '2026-11-25T15:01:00.000Z',
      items: v3Items,
    },
    {
      id: 4,
      versionCode: 'CESTA-20261125-V4',
      label: 'Cesta Atualizada — 19:00',
      productionDate: '2026-11-25',
      emissionTime: '19:00',
      sequenceOrder: 4,
      sourceType: 'CAMERA_TABLET',
      status: 'PUBLICADA',
      isCurrentPublished: true,
      linkedScheduleId: null,
      sourcePages: [
        { pageNumber: 1, fileName: 'cesta-19h-pag1.jpg', mimeType: 'image/jpeg' },
        { pageNumber: 2, fileName: 'cesta-19h-pag2.jpg', mimeType: 'image/jpeg' },
      ],
      unreadableFields: [],
      createdByName: 'Supervisão Moega [DEMO]',
      publishedByName: 'Supervisor Turno 2 [DEMO]',
      publishedAt: '2026-11-25T19:08:00.000Z',
      notes: 'Cesta final consolidada com redução de Calcário/Fosfato/Sal na L4 e aumento de Veículo Premix.',
      createdAt: '2026-11-25T19:02:00.000Z',
      items: v4Items,
    },
  ];
}
