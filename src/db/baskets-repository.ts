import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditEvents,
  consumptionBasketComparisons,
  consumptionBasketDiffItems,
  consumptionBasketItems,
  consumptionBasketVersions,
  inventoryMovements,
  materials,
  productionConsumptionProjections,
  productionLines,
  productionScheduleItems,
  productionSchedules,
  receipts,
  users,
} from './schema.ts';
import type { AuthenticatedAppUser } from './users.ts';
import { ensureBaseCatalogSeeded } from './seed-reference.ts';
import { listMaterials, listSilosWithDetails, listTransferRulesWithDetails } from './repository.ts';
import { OperationalConflictError } from './operations-repository.ts';
import {
  compareBasketVersions,
  convertRawQuantityToKg,
  formatBrazilianDiff,
  formatBrazilianNumber,
  normalizeLineCode,
  round2,
  round3,
} from '../lib/basket-comparator.ts';
import { extractBasketDocumentServer, type BasketPageUpload } from '../lib/gemini-baskets.ts';
import { exportReportDocument, type ExportFormat } from '../lib/report-exporter.ts';
import type {
  BasketComparisonView,
  BasketItemView,
  BasketNotificationEvent,
  BasketSourcePageMeta,
  BasketSourceType,
  BasketVersionView,
  ConsumptionTrendResponse,
} from '../types/nexo.ts';

function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function formatShortDatePt(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${d}/${m}`;
}

export async function get30DayConsumptionTrend(filters?: {
  days?: number;
  lineCode?: string;
  materialId?: number | null;
}): Promise<ConsumptionTrendResponse> {
  await ensureBaseCatalogSeeded();
  const days = Math.min(90, Math.max(7, filters?.days || 30));
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = addDaysIso(endDate, -(days - 1));
  const lineCodeFilter = filters?.lineCode && filters.lineCode !== 'ALL' ? filters.lineCode : 'ALL';
  const materialIdFilter =
    filters?.materialId && Number.isFinite(filters.materialId) ? Number(filters.materialId) : null;

  const [allLines, allMaterials, approvedSchedules, movRows] = await Promise.all([
    db.select().from(productionLines).orderBy(asc(productionLines.code)),
    db.select().from(materials).where(eq(materials.isActive, true)).orderBy(asc(materials.description)),
    db
      .select()
      .from(productionSchedules)
      .where(
        and(
          eq(productionSchedules.status, 'APROVADA'),
          gte(productionSchedules.referenceDate, startDate),
          lte(productionSchedules.referenceDate, endDate)
        )
      ),
    db
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.status, 'CONFIRMADO'),
          gte(inventoryMovements.operationalDate, startDate),
          lte(inventoryMovements.operationalDate, endDate)
        )
      ),
  ]);

  const lineById = new Map(allLines.map((l) => [l.id, l]));
  const matById = new Map(allMaterials.map((m) => [m.id, m]));
  const schedIds = approvedSchedules.map((s) => s.id);

  const projections =
    schedIds.length > 0
      ? await db
          .select()
          .from(productionConsumptionProjections)
          .where(inArray(productionConsumptionProjections.scheduleId, schedIds))
      : [];

  // Mapa diário agregado
  const dayPlannedMap = new Map<string, number>();
  const dayRealizedMap = new Map<string, number>();
  const matAggMap = new Map<number, { plannedKg: number; realizedKg: number }>();

  for (let i = 0; i < days; i++) {
    const dt = addDaysIso(startDate, i);
    dayPlannedMap.set(dt, 0);
    dayRealizedMap.set(dt, 0);
  }

  for (const p of projections) {
    const line = lineById.get(p.productionLineId);
    if (lineCodeFilter !== 'ALL' && line?.code !== lineCodeFilter) continue;

    const plannedKg = Number(p.calculatedConsumptionKg || 0);
    const realizedProjKg = Number(p.realizedConsumptionKg || 0);

    if (p.materialId) {
      const agg = matAggMap.get(p.materialId) || { plannedKg: 0, realizedKg: 0 };
      agg.plannedKg += plannedKg;
      agg.realizedKg += realizedProjKg;
      matAggMap.set(p.materialId, agg);
    }

    if (materialIdFilter && p.materialId !== materialIdFilter) continue;

    dayPlannedMap.set(p.referenceDate, (dayPlannedMap.get(p.referenceDate) || 0) + plannedKg);
    if (realizedProjKg > 0) {
      dayRealizedMap.set(p.referenceDate, (dayRealizedMap.get(p.referenceDate) || 0) + realizedProjKg);
    }
  }

  // Complementar consumo realizado a partir do livro razão quando não lançado na projeção
  for (const m of movRows) {
    if (m.movementType !== 'CONSUMO_PRODUCAO' && m.movementType !== 'SAIDA') continue;
    const qty = Number(m.quantityKg || 0);
    if (m.materialId) {
      const agg = matAggMap.get(m.materialId) || { plannedKg: 0, realizedKg: 0 };
      if (agg.realizedKg === 0) agg.realizedKg += qty;
      matAggMap.set(m.materialId, agg);
    }
    if (materialIdFilter && m.materialId !== materialIdFilter) continue;
    const prev = dayRealizedMap.get(m.operationalDate) || 0;
    if (prev === 0) {
      dayRealizedMap.set(m.operationalDate, qty);
    }
  }

  const series = [];
  let totalPlannedKg = 0;
  let totalRealizedKg = 0;
  let peakDayLabel: string | null = null;
  let peakPlannedTons = 0;

  for (let i = 0; i < days; i++) {
    const date = addDaysIso(startDate, i);
    const plannedKg = round2(dayPlannedMap.get(date) || 0);
    const realizedKg = round2(dayRealizedMap.get(date) || 0);
    const plannedTons = round3(plannedKg / 1000);
    const realizedTons = round3(realizedKg / 1000);
    const dateLabel = formatShortDatePt(date);

    totalPlannedKg += plannedKg;
    totalRealizedKg += realizedKg;
    if (plannedTons > peakPlannedTons) {
      peakPlannedTons = plannedTons;
      peakDayLabel = dateLabel;
    }

    series.push({
      date,
      dateLabel,
      plannedKg,
      realizedKg,
      plannedTons,
      realizedTons,
      varianceTons: round3(realizedTons - plannedTons),
    });
  }

  const totalPlannedTons = round2(totalPlannedKg / 1000);
  const totalRealizedTons = round2(totalRealizedKg / 1000);
  const adherencePercent =
    totalPlannedTons > 0 ? round2((totalRealizedTons / totalPlannedTons) * 100) : null;

  const availableMaterials = Array.from(matAggMap.entries())
    .map(([matId, agg]) => {
      const mat = matById.get(matId);
      return {
        materialId: matId,
        materialCode: mat?.code || String(matId),
        materialDescription: mat?.description || `Material #${matId}`,
        totalPlannedTons: round2(agg.plannedKg / 1000),
        totalRealizedTons: round2(agg.realizedKg / 1000),
      };
    })
    .sort((a, b) => b.totalPlannedTons - a.totalPlannedTons);

  return {
    days,
    startDate,
    endDate,
    lineCode: lineCodeFilter,
    materialId: materialIdFilter,
    dataOrigin: 'PostgreSQL Operacional (Programações Aprovadas + Livro Razão)',
    totals: {
      plannedTons: totalPlannedTons,
      realizedTons: totalRealizedTons,
      adherencePercent,
      peakDayLabel,
      peakPlannedTons: round2(peakPlannedTons),
    },
    availableLines: allLines.map((l) => l.code),
    availableMaterials,
    series,
  };
}

export async function extractBasketFromUpload(params: {
  sourceType: BasketSourceType;
  pages: BasketPageUpload[];
  expectedProductionDate?: string;
}) {
  await ensureBaseCatalogSeeded();
  const mats = await listMaterials();
  return extractBasketDocumentServer({
    sourceType: params.sourceType,
    pages: params.pages,
    materials: mats as any,
    expectedProductionDate: params.expectedProductionDate,
  });
}

async function hydrateBasketVersions(
  versionsRows: Array<typeof consumptionBasketVersions.$inferSelect>
): Promise<BasketVersionView[]> {
  if (versionsRows.length === 0) return [];
  const versionIds = versionsRows.map((v) => v.id);
  const [itemRows, userRows] = await Promise.all([
    db
      .select()
      .from(consumptionBasketItems)
      .where(inArray(consumptionBasketItems.basketVersionId, versionIds))
      .orderBy(asc(consumptionBasketItems.lineCode), asc(consumptionBasketItems.id)),
    db.select().from(users),
  ]);
  const userNameById = new Map(userRows.map((u) => [u.id, u.displayName]));

  return versionsRows.map((v) => {
    let sourcePages: BasketSourcePageMeta[] = [];
    let unreadableFields: string[] = [];
    try {
      sourcePages = JSON.parse(v.sourcePagesJson || '[]');
    } catch {
      sourcePages = [];
    }
    try {
      unreadableFields = JSON.parse(v.unreadableFieldsJson || '[]');
    } catch {
      unreadableFields = [];
    }

    const items: BasketItemView[] = itemRows
      .filter((it) => it.basketVersionId === v.id)
      .map((it) => ({
        id: it.id,
        basketVersionId: it.basketVersionId,
        productionDate: it.productionDate,
        lineCode: it.lineCode,
        materialId: it.materialId,
        materialCode: it.materialCode,
        materialDescription: it.materialDescription,
        rawQuantityText: it.rawQuantityText,
        plannedQuantityKg:
          it.plannedQuantityKg !== null && it.plannedQuantityKg !== undefined
            ? Number(it.plannedQuantityKg)
            : null,
        unit: it.unit,
        sourcePage: it.sourcePage,
        sourceDocumentName: it.sourceDocumentName,
        sourceRegion: it.sourceRegion,
        confidence: (it.confidence as 'ALTA' | 'MEDIA' | 'BAIXA') || 'MEDIA',
        needsReview: it.needsReview,
        reviewReason: it.reviewReason,
        manuallyEdited: it.manuallyEdited,
        editedByName: it.editedByUserId ? userNameById.get(it.editedByUserId) ?? null : null,
      }));

    return {
      id: v.id,
      versionCode: v.versionCode,
      label: v.label,
      productionDate: v.productionDate,
      emissionTime: v.emissionTime,
      sequenceOrder: v.sequenceOrder,
      sourceType: v.sourceType as BasketSourceType,
      status: v.status as BasketVersionView['status'],
      isCurrentPublished: v.isCurrentPublished,
      linkedScheduleId: v.linkedScheduleId,
      sourcePages,
      unreadableFields,
      createdByName: userNameById.get(v.createdByUserId) || 'Operação',
      publishedByName: v.publishedByUserId
        ? userNameById.get(v.publishedByUserId) ?? null
        : null,
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      notes: v.notes,
      createdAt: v.createdAt.toISOString(),
      items,
    };
  });
}

async function hydrateBasketComparisons(
  cmpRows: Array<typeof consumptionBasketComparisons.$inferSelect>
): Promise<BasketComparisonView[]> {
  if (cmpRows.length === 0) return [];
  const cmpIds = cmpRows.map((c) => c.id);
  const versionIds = Array.from(
    new Set(cmpRows.flatMap((c) => [c.baseVersionId, c.targetVersionId]))
  );

  const [diffRows, verRows, userRows] = await Promise.all([
    db
      .select()
      .from(consumptionBasketDiffItems)
      .where(inArray(consumptionBasketDiffItems.comparisonId, cmpIds))
      .orderBy(asc(consumptionBasketDiffItems.lineCode), asc(consumptionBasketDiffItems.id)),
    db
      .select()
      .from(consumptionBasketVersions)
      .where(inArray(consumptionBasketVersions.id, versionIds)),
    db.select().from(users),
  ]);

  const verById = new Map(verRows.map((v) => [v.id, v]));
  const userNameById = new Map(userRows.map((u) => [u.id, u.displayName]));

  return cmpRows.map((c) => {
    const baseVer = verById.get(c.baseVersionId);
    const targetVer = verById.get(c.targetVersionId);
    let summary: any = {};
    let operationalImpacts: any[] = [];
    try {
      summary = JSON.parse(c.summaryJson || '{}');
    } catch {
      summary = {};
    }
    try {
      operationalImpacts = JSON.parse(c.operationalImpactsJson || '[]');
    } catch {
      operationalImpacts = [];
    }

    const items = diffRows
      .filter((d) => d.comparisonId === c.id)
      .map((d) => ({
        id: d.id,
        comparisonId: d.comparisonId,
        productionDate: d.productionDate,
        lineCode: d.lineCode,
        materialId: d.materialId,
        materialCode: d.materialCode,
        materialDescription: d.materialDescription,
        previousQuantityKg:
          d.previousQuantityKg !== null ? Number(d.previousQuantityKg) : null,
        newQuantityKg: d.newQuantityKg !== null ? Number(d.newQuantityKg) : null,
        diffKg: d.diffKg !== null ? Number(d.diffKg) : null,
        pctChange: d.pctChange !== null ? Number(d.pctChange) : null,
        unit: d.unit,
        classification: d.classification as any,
        previousSourceRef: d.previousSourceRef,
        newSourceRef: d.newSourceRef,
        needsReview: d.needsReview,
        reviewReason: d.reviewReason,
      }));

    const topIncreases = items
      .filter((d) => (d.diffKg ?? 0) > 0)
      .sort((a, b) => (b.diffKg ?? 0) - (a.diffKg ?? 0))
      .slice(0, 10);

    const topDecreases = items
      .filter((d) => (d.diffKg ?? 0) < 0)
      .sort((a, b) => (a.diffKg ?? 0) - (b.diffKg ?? 0))
      .slice(0, 10);

    return {
      id: c.id,
      comparisonCode: c.comparisonCode,
      productionDate: c.productionDate,
      baseVersionId: c.baseVersionId,
      baseVersionLabel: baseVer?.label || `Versão #${c.baseVersionId}`,
      baseEmissionTime: baseVer?.emissionTime ?? null,
      targetVersionId: c.targetVersionId,
      targetVersionLabel: targetVer?.label || `Versão #${c.targetVersionId}`,
      targetEmissionTime: targetVer?.emissionTime ?? null,
      status: c.status as BasketComparisonView['status'],
      totalPreviousKg: Number(c.totalPreviousKg),
      totalNewKg: Number(c.totalNewKg),
      totalDiffKg: Number(c.totalDiffKg),
      pctChange: c.pctChange !== null ? Number(c.pctChange) : null,
      counts: summary.counts || {
        totalMaterials: items.length,
        increased: items.filter((i) => i.classification === 'AUMENTOU').length,
        decreased: items.filter((i) => i.classification === 'DIMINUIU').length,
        unchanged: items.filter((i) => i.classification === 'MANTIDO').length,
        added: items.filter((i) => i.classification === 'NOVO_MATERIAL').length,
        removed: items.filter((i) => i.classification === 'MATERIAL_RETIRADO').length,
        pendingReview: items.filter((i) => i.classification === 'PENDENTE_CONFERENCIA').length,
      },
      lineSummaries: summary.lineSummaries || [],
      diffItems: items,
      topIncreases,
      topDecreases,
      operationalImpacts,
      createdByName: userNameById.get(c.createdByUserId) || 'Supervisão',
      publishedByName: c.publishedByUserId
        ? userNameById.get(c.publishedByUserId) ?? null
        : null,
      publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    };
  });
}

export async function listBasketHistory(productionDate?: string) {
  await ensureBaseCatalogSeeded();
  const verQuery = productionDate
    ? db
        .select()
        .from(consumptionBasketVersions)
        .where(eq(consumptionBasketVersions.productionDate, productionDate))
        .orderBy(desc(consumptionBasketVersions.productionDate), asc(consumptionBasketVersions.sequenceOrder))
    : db
        .select()
        .from(consumptionBasketVersions)
        .orderBy(desc(consumptionBasketVersions.productionDate), asc(consumptionBasketVersions.sequenceOrder));

  const cmpQuery = productionDate
    ? db
        .select()
        .from(consumptionBasketComparisons)
        .where(eq(consumptionBasketComparisons.productionDate, productionDate))
        .orderBy(desc(consumptionBasketComparisons.createdAt))
    : db
        .select()
        .from(consumptionBasketComparisons)
        .orderBy(desc(consumptionBasketComparisons.createdAt));

  const [verRows, cmpRows] = await Promise.all([verQuery, cmpQuery]);
  const [versions, comparisons] = await Promise.all([
    hydrateBasketVersions(verRows),
    hydrateBasketComparisons(cmpRows),
  ]);

  return { versions, comparisons };
}

export async function getBasketComparisonById(comparisonId: number): Promise<BasketComparisonView> {
  const rows = await db
    .select()
    .from(consumptionBasketComparisons)
    .where(eq(consumptionBasketComparisons.id, comparisonId))
    .limit(1);
  if (rows.length === 0) {
    throw new OperationalConflictError('Comparação de Cestas não encontrada.', 404);
  }
  const hydrated = await hydrateBasketComparisons(rows);
  return hydrated[0];
}

export async function createBasketVersionRecord(
  input: {
    label: string;
    productionDate: string;
    emissionTime?: string | null;
    sourceType: BasketSourceType;
    sourcePages?: BasketSourcePageMeta[];
    unreadableFields?: string[];
    notes?: string | null;
    items: Array<{
      lineCode: string;
      materialId?: number | null;
      materialCode?: string | null;
      materialDescription: string;
      rawQuantityText?: string | null;
      plannedQuantityKg?: number | null;
      unit?: string;
      sourcePage?: number;
      sourceDocumentName?: string | null;
      sourceRegion?: string | null;
      confidence?: 'ALTA' | 'MEDIA' | 'BAIXA';
      needsReview?: boolean;
      reviewReason?: string | null;
    }>;
  },
  actor: AuthenticatedAppUser
): Promise<BasketVersionView> {
  await ensureBaseCatalogSeeded();
  if (!input.productionDate || !input.label?.trim()) {
    throw new OperationalConflictError('Informe a data de produção e o rótulo da Cesta.', 400);
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new OperationalConflictError('A Cesta de Consumo precisa conter pelo menos um item.', 400);
  }

  const allMats = await listMaterials();
  const matByCode = new Map(allMats.map((m) => [m.code.trim().toUpperCase(), m]));

  const createdId = await db.transaction(async (tx) => {
    const existingSameDate = await tx
      .select()
      .from(consumptionBasketVersions)
      .where(eq(consumptionBasketVersions.productionDate, input.productionDate));

    const nextSeq = existingSameDate.length + 1;
    const versionCode = `CESTA-${input.productionDate.replace(/-/g, '')}-V${nextSeq}-${Math.floor(
      100 + Math.random() * 900
    )}`;
    const hasPendingReview = input.items.some((i) => i.needsReview || i.plannedQuantityKg === null);

    const [created] = await tx
      .insert(consumptionBasketVersions)
      .values({
        versionCode,
        label: input.label.trim(),
        productionDate: input.productionDate,
        emissionTime: input.emissionTime || null,
        sequenceOrder: nextSeq,
        sourceType: input.sourceType,
        status: hasPendingReview ? 'RASCUNHO' : 'CONFERIDA',
        isCurrentPublished: false,
        sourcePagesJson: JSON.stringify(input.sourcePages || []),
        unreadableFieldsJson: JSON.stringify(input.unreadableFields || []),
        notes: input.notes || null,
        createdByUserId: actor.id,
      })
      .returning();

    const itemValues = input.items.map((it) => {
      const code = it.materialCode ? it.materialCode.trim().toUpperCase() : null;
      const matMatch = code ? matByCode.get(code) : undefined;
      const unit = it.unit || 'kg';
      const qtyKg =
        it.plannedQuantityKg !== undefined && it.plannedQuantityKg !== null
          ? round3(it.plannedQuantityKg)
          : convertRawQuantityToKg(it.rawQuantityText, unit);

      return {
        basketVersionId: created.id,
        productionDate: input.productionDate,
        lineCode: normalizeLineCode(it.lineCode),
        materialId: it.materialId ?? matMatch?.id ?? null,
        materialCode: code,
        materialDescription: (it.materialDescription || matMatch?.description || 'Não identificado').trim(),
        rawQuantityText: it.rawQuantityText ?? (qtyKg !== null ? String(qtyKg) : null),
        plannedQuantityKg: qtyKg !== null ? qtyKg.toFixed(3) : null,
        unit,
        sourcePage: it.sourcePage || 1,
        sourceDocumentName: it.sourceDocumentName || null,
        sourceRegion: it.sourceRegion || null,
        confidence: it.confidence || 'MEDIA',
        needsReview: Boolean(it.needsReview) || qtyKg === null || !code,
        reviewReason: it.reviewReason || null,
        manuallyEdited: false,
      };
    });

    await tx.insert(consumptionBasketItems).values(itemValues);

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'BASKET_VERSION_CREATED',
      entityType: 'BASKET_VERSION',
      entityId: versionCode,
      reason: `Cadastro de cesta ${input.label} (${input.productionDate})`,
      newValue: JSON.stringify({ itemsCount: itemValues.length, status: created.status }),
      origin: 'API_SERVER',
    });

    return created.id;
  });

  const rows = await db
    .select()
    .from(consumptionBasketVersions)
    .where(eq(consumptionBasketVersions.id, createdId));
  const hydrated = await hydrateBasketVersions(rows);
  return hydrated[0];
}

export async function updateBasketVersionItemsRecord(
  versionId: number,
  itemsInput: Array<{
    id?: number;
    lineCode: string;
    materialCode?: string | null;
    materialDescription: string;
    rawQuantityText?: string | null;
    plannedQuantityKg?: number | null;
    unit?: string;
    needsReview?: boolean;
    reviewReason?: string | null;
  }>,
  actor: AuthenticatedAppUser
): Promise<BasketVersionView> {
  await ensureBaseCatalogSeeded();
  const allMats = await listMaterials();
  const matByCode = new Map(allMats.map((m) => [m.code.trim().toUpperCase(), m]));

  await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(consumptionBasketVersions)
      .where(eq(consumptionBasketVersions.id, versionId))
      .limit(1);

    if (existingRows.length === 0) {
      throw new OperationalConflictError('Versão da Cesta não encontrada.', 404);
    }
    const ver = existingRows[0];

    await tx
      .delete(consumptionBasketItems)
      .where(eq(consumptionBasketItems.basketVersionId, versionId));

    const newRows = itemsInput.map((it) => {
      const code = it.materialCode ? it.materialCode.trim().toUpperCase() : null;
      const matMatch = code ? matByCode.get(code) : undefined;
      const unit = it.unit || 'kg';
      const qtyKg =
        it.plannedQuantityKg !== undefined && it.plannedQuantityKg !== null
          ? round3(it.plannedQuantityKg)
          : convertRawQuantityToKg(it.rawQuantityText, unit);
      const stillNeedsReview = Boolean(it.needsReview) || qtyKg === null || !code;

      return {
        basketVersionId: versionId,
        productionDate: ver.productionDate,
        lineCode: normalizeLineCode(it.lineCode),
        materialId: matMatch?.id ?? null,
        materialCode: code,
        materialDescription: (it.materialDescription || matMatch?.description || 'Não identificado').trim(),
        rawQuantityText: it.rawQuantityText ?? (qtyKg !== null ? String(qtyKg) : null),
        plannedQuantityKg: qtyKg !== null ? qtyKg.toFixed(3) : null,
        unit,
        sourcePage: 1,
        sourceDocumentName: null,
        sourceRegion: 'Conferência manual',
        confidence: stillNeedsReview ? 'MEDIA' : 'ALTA',
        needsReview: stillNeedsReview,
        reviewReason: stillNeedsReview ? it.reviewReason || 'Conferência pendente' : null,
        manuallyEdited: true,
        editedByUserId: actor.id,
      };
    });

    if (newRows.length > 0) {
      await tx.insert(consumptionBasketItems).values(newRows);
    }

    const anyPending = newRows.some((r) => r.needsReview);
    await tx
      .update(consumptionBasketVersions)
      .set({
        status: anyPending ? 'RASCUNHO' : 'CONFERIDA',
      })
      .where(eq(consumptionBasketVersions.id, versionId));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'BASKET_ITEMS_REVIEWED',
      entityType: 'BASKET_VERSION',
      entityId: ver.versionCode,
      reason: 'Conferência e correção pré-comparação dos itens extraídos',
      newValue: JSON.stringify({ itemsCount: newRows.length, anyPending }),
      origin: 'API_SERVER',
    });
  });

  const rows = await db
    .select()
    .from(consumptionBasketVersions)
    .where(eq(consumptionBasketVersions.id, versionId));
  const hydrated = await hydrateBasketVersions(rows);
  return hydrated[0];
}

export async function runBasketComparisonRecord(
  params: { baseVersionId: number; targetVersionId: number },
  actor: AuthenticatedAppUser
): Promise<BasketComparisonView> {
  await ensureBaseCatalogSeeded();
  if (params.baseVersionId === params.targetVersionId) {
    throw new OperationalConflictError('Selecione duas versões distintas para comparar.', 400);
  }

  const verRows = await db
    .select()
    .from(consumptionBasketVersions)
    .where(inArray(consumptionBasketVersions.id, [params.baseVersionId, params.targetVersionId]));

  const hydratedVers = await hydrateBasketVersions(verRows);
  const baseVer = hydratedVers.find((v) => v.id === params.baseVersionId);
  const targetVer = hydratedVers.find((v) => v.id === params.targetVersionId);

  if (!baseVer || !targetVer) {
    throw new OperationalConflictError('Versão de Cesta não encontrada para comparação.', 404);
  }

  const [silos, mats, rules, openReceipts] = await Promise.all([
    listSilosWithDetails(),
    listMaterials(),
    listTransferRulesWithDetails(),
    db
      .select()
      .from(receipts)
      .where(inArray(receipts.status, ['PENDENTE', 'PARCIAL'])),
  ]);

  const pendingReceiptsKgByMaterial = new Map<number, number>();
  for (const r of openReceipts) {
    const rem = Math.max(
      0,
      Number(r.receivedQuantityKg || 0) - Number(r.distributedQuantityKg || 0)
    );
    if (rem > 0) {
      pendingReceiptsKgByMaterial.set(
        r.materialId,
        (pendingReceiptsKgByMaterial.get(r.materialId) || 0) + rem
      );
    }
  }

  const cmpCode = `CMP-${targetVer.productionDate.replace(/-/g, '')}-${baseVer.id}V${targetVer.id}-${Math.floor(
    100 + Math.random() * 900
  )}`;

  const computed = compareBasketVersions({
    comparisonCode: cmpCode,
    productionDate: targetVer.productionDate,
    baseVersion: {
      id: baseVer.id,
      label: baseVer.label,
      emissionTime: baseVer.emissionTime,
    },
    targetVersion: {
      id: targetVer.id,
      label: targetVer.label,
      emissionTime: targetVer.emissionTime,
    },
    baseItems: baseVer.items,
    targetItems: targetVer.items,
    silos: silos as any,
    materials: mats as any,
    transferRules: rules as any,
    pendingReceiptsKgByMaterial,
    createdByName: actor.displayName,
  });

  const savedId = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(consumptionBasketComparisons)
      .values({
        comparisonCode: computed.comparisonCode,
        productionDate: computed.productionDate,
        baseVersionId: baseVer.id,
        targetVersionId: targetVer.id,
        status: computed.counts.pendingReview > 0 ? 'CONFERENCIA' : 'COMPARADA',
        totalPreviousKg: computed.totalPreviousKg.toFixed(3),
        totalNewKg: computed.totalNewKg.toFixed(3),
        totalDiffKg: computed.totalDiffKg.toFixed(3),
        pctChange: computed.pctChange !== null ? computed.pctChange.toFixed(2) : null,
        summaryJson: JSON.stringify({
          counts: computed.counts,
          lineSummaries: computed.lineSummaries,
        }),
        operationalImpactsJson: JSON.stringify(computed.operationalImpacts),
        createdByUserId: actor.id,
      })
      .returning();

    if (computed.diffItems.length > 0) {
      await tx.insert(consumptionBasketDiffItems).values(
        computed.diffItems.map((d) => ({
          comparisonId: inserted.id,
          productionDate: d.productionDate,
          lineCode: d.lineCode,
          materialId: d.materialId,
          materialCode: d.materialCode,
          materialDescription: d.materialDescription,
          previousQuantityKg:
            d.previousQuantityKg !== null ? d.previousQuantityKg.toFixed(3) : null,
          newQuantityKg: d.newQuantityKg !== null ? d.newQuantityKg.toFixed(3) : null,
          diffKg: d.diffKg !== null ? d.diffKg.toFixed(3) : null,
          pctChange: d.pctChange !== null ? d.pctChange.toFixed(2) : null,
          unit: d.unit,
          classification: d.classification,
          previousSourceRef: d.previousSourceRef,
          newSourceRef: d.newSourceRef,
          needsReview: d.needsReview,
          reviewReason: d.reviewReason,
        }))
      );
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'BASKET_COMPARISON_CREATED',
      entityType: 'BASKET_COMPARISON',
      entityId: computed.comparisonCode,
      reason: `Comparação ${baseVer.label} -> ${targetVer.label}`,
      newValue: JSON.stringify({
        totalDiffKg: computed.totalDiffKg,
        counts: computed.counts,
      }),
      origin: 'API_SERVER',
    });

    return inserted.id;
  });

  return getBasketComparisonById(savedId);
}

export async function publishBasketComparisonTransactional(
  params: { comparisonId: number; notes?: string | null },
  actor: AuthenticatedAppUser
): Promise<{
  comparison: BasketComparisonView;
  notification: BasketNotificationEvent;
}> {
  await ensureBaseCatalogSeeded();
  const comparison = await getBasketComparisonById(params.comparisonId);

  const [allLines, targetVerRows] = await Promise.all([
    db.select().from(productionLines),
    db
      .select()
      .from(consumptionBasketVersions)
      .where(eq(consumptionBasketVersions.id, comparison.targetVersionId))
      .limit(1),
  ]);

  if (targetVerRows.length === 0) {
    throw new OperationalConflictError('Versão alvo da cesta não encontrada.', 404);
  }
  const targetVer = targetVerRows[0];
  const hydratedTargets = await hydrateBasketVersions([targetVer]);
  const targetItems = hydratedTargets[0].items;
  const lineByCode = new Map(allLines.map((l) => [l.code, l]));
  const now = new Date();

  await db.transaction(async (tx) => {
    // 1. Arquiva versões publicadas anteriores para a mesma data sem jamais apagar o histórico
    await tx
      .update(consumptionBasketVersions)
      .set({
        isCurrentPublished: false,
        status: 'ARQUIVADA',
      })
      .where(
        and(
          eq(consumptionBasketVersions.productionDate, comparison.productionDate),
          eq(consumptionBasketVersions.isCurrentPublished, true)
        )
      );

    // 2. Supercede programações APROVADAS anteriores para a mesma data
    const prevScheds = await tx
      .select()
      .from(productionSchedules)
      .where(
        and(
          eq(productionSchedules.referenceDate, comparison.productionDate),
          eq(productionSchedules.status, 'APROVADA')
        )
      );

    let maxRev = 0;
    let prevSchedId: number | null = null;
    for (const ps of prevScheds) {
      if (ps.revisionNumber > maxRev) {
        maxRev = ps.revisionNumber;
        prevSchedId = ps.id;
      }
      await tx
        .update(productionSchedules)
        .set({ status: 'SUPERSEDED', updatedAt: now })
        .where(eq(productionSchedules.id, ps.id));
    }

    const allSchedsSameDate = await tx
      .select()
      .from(productionSchedules)
      .where(eq(productionSchedules.referenceDate, comparison.productionDate));
    for (const s of allSchedsSameDate) {
      if (s.revisionNumber > maxRev) maxRev = s.revisionNumber;
    }

    const revNumber = maxRev + 1;
    const scheduleCode = `CESTA-${comparison.productionDate.replace(/-/g, '')}-R${revNumber}-${Math.floor(
      100 + Math.random() * 900
    )}`;

    const [createdSchedule] = await tx
      .insert(productionSchedules)
      .values({
        scheduleCode,
        referenceDate: comparison.productionDate,
        revisionNumber: revNumber,
        previousScheduleId: prevSchedId,
        sourceReportType: 'REVISAO',
        status: 'APROVADA',
        revisionDiffSummary: `Publicação via Comparador (${comparison.baseVersionLabel} -> ${comparison.targetVersionLabel}): ${formatBrazilianDiff(
          comparison.totalDiffKg
        )} kg`,
        notes: params.notes || targetVer.notes || null,
        importedByUserId: targetVer.createdByUserId,
        approvedByUserId: actor.id,
        approvedAt: now,
      })
      .returning();

    // 3. Registra itens e projeções determinísticas sem alterar saldo físico dos silos
    for (let idx = 0; idx < targetItems.length; idx++) {
      const it = targetItems[idx];
      const line = lineByCode.get(it.lineCode) || allLines[0];
      if (!line) continue;
      const qtyKg = it.plannedQuantityKg ?? 0;

      const [schedItem] = await tx
        .insert(productionScheduleItems)
        .values({
          scheduleId: createdSchedule.id,
          productionLineId: line.id,
          sequenceOrder: idx + 1,
          productCode: it.materialCode || `MP-${idx + 1}`,
          productDescription: it.materialDescription,
          materialId: it.materialId,
          materialCode: it.materialCode,
          plannedQuantity: qtyKg.toFixed(3),
          plannedUnit: 'kg',
          executionStatus: 'NAO_INICIADA',
          extractionConfidence: it.confidence,
          needsReview: it.needsReview,
          reviewReason: it.reviewReason,
        })
        .returning();

      await tx.insert(productionConsumptionProjections).values({
        scheduleId: createdSchedule.id,
        scheduleItemId: schedItem.id,
        productionLineId: line.id,
        referenceDate: comparison.productionDate,
        materialId: it.materialId,
        factorId: null,
        factorUsed: '1.000000',
        plannedProductQty: qtyKg.toFixed(3),
        calculatedConsumptionKg: qtyKg.toFixed(3),
        realizedConsumptionKg: '0.000',
        calculationStatus: 'CALCULADO',
        originSource: 'MATERIA_PRIMA_DIRETA',
      });
    }

    // 4. Atualiza versão e comparação como PUBLICADA
    await tx
      .update(consumptionBasketVersions)
      .set({
        status: 'PUBLICADA',
        isCurrentPublished: true,
        linkedScheduleId: createdSchedule.id,
        publishedByUserId: actor.id,
        publishedAt: now,
      })
      .where(eq(consumptionBasketVersions.id, comparison.targetVersionId));

    await tx
      .update(consumptionBasketComparisons)
      .set({
        status: 'PUBLICADA',
        publishedByUserId: actor.id,
        publishedAt: now,
      })
      .where(eq(consumptionBasketComparisons.id, comparison.id));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'BASKET_PUBLISHED',
      entityType: 'BASKET_COMPARISON',
      entityId: comparison.comparisonCode,
      reason: `Publicação oficial da cesta ${comparison.targetVersionLabel} para ${comparison.productionDate}`,
      newValue: JSON.stringify({
        linkedScheduleCode: scheduleCode,
        totalNewKg: comparison.totalNewKg,
        totalDiffKg: comparison.totalDiffKg,
      }),
      origin: 'API_SERVER',
    });
  });

  const updated = await getBasketComparisonById(comparison.id);
  const criticalImpactsCount = updated.operationalImpacts.filter(
    (o) => o.shortageRisk === 'CRITICO' || o.shortageRisk === 'SEM_SILO_COMPATIVEL'
  ).length;

  const summaryHighlights = updated.diffItems
    .filter((d) => d.classification !== 'MANTIDO')
    .slice(0, 4)
    .map(
      (d) =>
        `${d.lineCode} · ${d.materialDescription}: ${formatBrazilianDiff(d.diffKg)} kg (${d.classification})`
    );

  const notification: BasketNotificationEvent = {
    type: 'basket:published',
    comparisonId: updated.id,
    comparisonCode: updated.comparisonCode,
    productionDate: updated.productionDate,
    baseVersionLabel: updated.baseVersionLabel,
    targetVersionLabel: updated.targetVersionLabel,
    totalDiffKg: updated.totalDiffKg,
    criticalImpactsCount,
    publishedByName: actor.displayName,
    publishedAt: now.toISOString(),
    summaryHighlights,
  };

  return { comparison: updated, notification };
}

export async function getLatestPublishedBasketNotification(): Promise<BasketNotificationEvent | null> {
  const rows = await db
    .select()
    .from(consumptionBasketComparisons)
    .where(eq(consumptionBasketComparisons.status, 'PUBLICADA'))
    .orderBy(desc(consumptionBasketComparisons.publishedAt))
    .limit(1);

  if (rows.length === 0) return null;
  const cmp = await getBasketComparisonById(rows[0].id);
  return {
    type: 'basket:published',
    comparisonId: cmp.id,
    comparisonCode: cmp.comparisonCode,
    productionDate: cmp.productionDate,
    baseVersionLabel: cmp.baseVersionLabel,
    targetVersionLabel: cmp.targetVersionLabel,
    totalDiffKg: cmp.totalDiffKg,
    criticalImpactsCount: cmp.operationalImpacts.filter(
      (o) => o.shortageRisk === 'CRITICO' || o.shortageRisk === 'SEM_SILO_COMPATIVEL'
    ).length,
    publishedByName: cmp.publishedByName || cmp.createdByName,
    publishedAt: cmp.publishedAt || cmp.createdAt,
    summaryHighlights: cmp.diffItems
      .filter((d) => d.classification !== 'MANTIDO')
      .slice(0, 4)
      .map(
        (d) =>
          `${d.lineCode} · ${d.materialDescription}: ${formatBrazilianDiff(d.diffKg)} kg (${d.classification})`
      ),
  };
}

export async function exportBasketComparisonReport(
  params: { comparisonId: number; format: ExportFormat },
  actor: AuthenticatedAppUser
) {
  const cmp = await getBasketComparisonById(params.comparisonId);

  // Busca consumo real realizado registrado no livro razão para a mesma data, separado do planejado
  const movs = await db
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.operationalDate, cmp.productionDate),
        eq(inventoryMovements.status, 'CONFIRMADO')
      )
    );

  const realizedByMatId = new Map<number, number>();
  for (const m of movs) {
    if (m.movementType === 'CONSUMO_PRODUCAO' || m.movementType === 'SAIDA') {
      realizedByMatId.set(
        m.materialId,
        (realizedByMatId.get(m.materialId) || 0) + Number(m.quantityKg || 0)
      );
    }
  }

  return exportReportDocument({
    format: params.format,
    reportTitle: `Análise Comparativa de Cestas de Consumo (${cmp.baseVersionLabel} → ${cmp.targetVersionLabel})`,
    reportType: 'COMPARADOR_CESTAS',
    periodLabel: `Data de Produção: ${cmp.productionDate}`,
    filtersSummary: `Base: ${cmp.baseVersionLabel} | Nova: ${cmp.targetVersionLabel} | Status: ${cmp.status}`,
    dataOrigin: 'PostgreSQL Operacional (Comparador de Cestas + Livro Razão separado)',
    generatedByName: actor.displayName,
    generatedByRole: actor.roleCode,
    generatedAtIso: new Date().toISOString(),
    columns: [
      { key: 'lineCode', header: 'Linha', width: 8 },
      { key: 'materialCode', header: 'Código MP', width: 14 },
      { key: 'materialDescription', header: 'Matéria-Prima', width: 28 },
      { key: 'prevQty', header: 'Planejado Anterior (kg)', width: 18, align: 'right' },
      { key: 'newQty', header: 'Planejado Novo (kg)', width: 18, align: 'right' },
      { key: 'diffQty', header: 'Diferença (kg)', width: 16, align: 'right' },
      { key: 'pct', header: 'Variação (%)', width: 12, align: 'right' },
      { key: 'realizedQty', header: 'Realizado Livro Razão (kg)', width: 18, align: 'right' },
      { key: 'classification', header: 'Classificação', width: 20 },
    ],
    rows: cmp.diffItems.map((d) => {
      const realizedKg = d.materialId ? realizedByMatId.get(d.materialId) ?? 0 : 0;
      return {
        lineCode: d.lineCode,
        materialCode: d.materialCode || '—',
        materialDescription: d.materialDescription,
        prevQty: formatBrazilianNumber(d.previousQuantityKg, 2),
        newQty: formatBrazilianNumber(d.newQuantityKg, 2),
        diffQty: formatBrazilianDiff(d.diffKg),
        pct: d.pctChange !== null ? `${d.pctChange > 0 ? '+' : ''}${d.pctChange}%` : '—',
        realizedQty: formatBrazilianNumber(realizedKg, 2),
        classification: d.classification,
      };
    }),
    totalsSummary: [
      { label: 'Total Planejado Anterior', value: `${formatBrazilianNumber(cmp.totalPreviousKg, 2)} kg` },
      { label: 'Total Planejado Novo', value: `${formatBrazilianNumber(cmp.totalNewKg, 2)} kg` },
      {
        label: 'Diferença Líquida',
        value: `${formatBrazilianDiff(cmp.totalDiffKg)} kg (${cmp.pctChange ?? 0}%)`,
      },
      {
        label: 'Aumentos / Reduções / Novos / Retirados',
        value: `${cmp.counts.increased} / ${cmp.counts.decreased} / ${cmp.counts.added} / ${cmp.counts.removed}`,
      },
    ],
  });
}
