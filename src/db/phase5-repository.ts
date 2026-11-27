import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditEvents,
  consumptionBasketVersions,
  inventoryMovements,
  materialIntakeRequests,
  materialStockThresholds,
  materials,
  operationalOccurrences,
  operationalRecommendations,
  performanceTargets,
  productionConsumptionProjections,
  productionLines,
  productionScheduleItems,
  productionSchedules,
  receiptDistributions,
  receipts,
  reportSnapshots,
  shiftHandoverPendencies,
  shiftHandoverRevisions,
  shiftHandovers,
  shifts,
  siloTransferRules,
  silos,
  transferExecutionSteps,
  transferOrders,
  users,
  validationPendencies,
} from './schema.ts';
import type { AuthenticatedAppUser } from './users.ts';
import { OperationalConflictError } from './operations-repository.ts';
import { listSilosWithDetails } from './repository.ts';
import { getDailyRubricagemComparisonReport } from './rubricagem-repository.ts';
import { RUBRICAGEM_STATUS_META } from '../lib/rubricagem-logic.ts';
import {
  type VehicleReceiptInput,
  buildChronologicalShiftReportText,
  buildMoegaShiftNarrativeReport,
  classifyShiftVehicles,
  computePerformanceKpis,
  formatIsoDatePtBr,
  reconstructHistoricalStockPosition,
  resolvePeriodBounds,
} from '../lib/phase5-analytics.ts';
import { type ExportColumnDef, type ExportFormat, exportReportDocument } from '../lib/report-exporter.ts';
import {
  DEFAULT_SHIFT_CONFIGS,
  type OperationalShiftInfo,
  type ShiftCode,
  type ShiftConfigInput,
  detectCrossesMidnight,
  formatShiftDisplayName,
  parseTimeToMinutes,
  resolveShiftFromConfigs,
} from '../lib/shifts.ts';
import { hasPermission } from '../lib/rbac.ts';
import type { AssistantAuthorizedContext } from '../lib/gemini-assistant.ts';
import {
  type ConsumptionReportResponse,
  OCCURRENCE_CATEGORIES,
  type OccurrenceEvidenceItem,
  type OccurrenceItem,
  type OperationalIndicatorsOverview,
  type PerformanceTargetItem,
  type ReceivingReportResponse,
  type ReportFilterParams,
  type ReportSnapshotItem,
  type ReportTypeCode,
  type ShiftAutoSummarySnapshot,
  type ShiftConfigView,
  type ShiftHandoverPendencyView,
  type ShiftHandoverRevisionItem,
  type ShiftHandoverView,
  type ShiftManualSupplement,
  type ShiftManagerialReportResponse,
  type ShiftManagerialReportRow,
  type ShiftWorkflowStatus,
  type StockAndHistoricalReportResponse,
  type TransfersReportResponse,
} from '../types/nexo.ts';

function genCode(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  return `${prefix}-${stamp}-${rand}`;
}

export async function resolveActiveShiftFromDb(date: Date = new Date()): Promise<OperationalShiftInfo> {
  const dbShifts = await db.select().from(shifts);
  if (dbShifts.length === 0) {
    return resolveShiftFromConfigs(date, DEFAULT_SHIFT_CONFIGS);
  }
  const configs: ShiftConfigInput[] = dbShifts.map((s) => ({
    code: s.code as ShiftCode,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    crossesMidnight: s.crossesMidnight,
    isValidated: s.isValidated,
    isActive: s.isActive,
    responsibleName: s.responsibleName,
  }));
  return resolveShiftFromConfigs(date, configs);
}

// =========================================================================
// 1. GESTÃO DOS TURNOS
// =========================================================================

export async function listShiftsWithAssignments(): Promise<ShiftConfigView[]> {
  const [dbShifts, allUsers] = await Promise.all([
    db.select().from(shifts),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        badgeCode: users.badgeCode,
        isActive: users.isActive,
      })
      .from(users),
  ]);

  const userRows = await db.query.users.findMany({
    with: { role: true },
  });
  const userMap = new Map(
    userRows.map((u) => [
      u.id,
      {
        id: u.id,
        displayName: u.displayName,
        badgeCode: u.badgeCode,
        roleCode: u.role?.code || 'OPERADOR_MOEGA',
      },
    ])
  );
  // Fallback if query builder empty
  for (const u of allUsers) {
    if (!userMap.has(u.id)) {
      userMap.set(u.id, {
        id: u.id,
        displayName: u.displayName,
        badgeCode: u.badgeCode,
        roleCode: 'OPERADOR_MOEGA',
      });
    }
  }

  return dbShifts
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((s) => {
      let operatorIds: number[] = [];
      try {
        const parsed = JSON.parse(s.operatorIdsJson || '[]');
        if (Array.isArray(parsed)) {
          operatorIds = parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0);
        }
      } catch {
        operatorIds = [];
      }
      const sup = s.supervisorUserId ? userMap.get(s.supervisorUserId) : null;
      return {
        id: s.id,
        code: s.code as ShiftCode,
        name: s.name,
        startTime: s.startTime,
        endTime: s.endTime,
        crossesMidnight: s.crossesMidnight,
        supervisorUserId: s.supervisorUserId,
        supervisorName: sup?.displayName ?? null,
        responsibleName: s.responsibleName ?? sup?.displayName ?? null,
        operatorIds,
        operators: operatorIds.map((id) => userMap.get(id)).filter((x): x is NonNullable<typeof x> => Boolean(x)),
        isValidated: s.isValidated,
        isActive: s.isActive,
        notes: s.notes,
        updatedAt: s.updatedAt.toISOString(),
      };
    });
}

export async function updateShiftConfigTransactional(
  shiftCode: ShiftCode,
  input: {
    name?: string;
    startTime: string;
    endTime: string;
    supervisorUserId?: number | null;
    responsibleName?: string | null;
    operatorIds?: number[];
    isValidated?: boolean;
    isActive?: boolean;
    notes?: string | null;
    reason: string;
  },
  actor: AuthenticatedAppUser
): Promise<ShiftConfigView> {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new OperationalConflictError('Informe o motivo operacional da atualização do turno.', 400);
  }
  parseTimeToMinutes(input.startTime);
  parseTimeToMinutes(input.endTime);
  const crossesMidnight = detectCrossesMidnight(input.startTime, input.endTime);

  const operatorIds = Array.from(
    new Set((input.operatorIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))
  );

  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(shifts).where(eq(shifts.code, shiftCode)).limit(1);
    if (!existing) {
      throw new OperationalConflictError(`Turno ${shiftCode} não encontrado.`, 404);
    }

    let resolvedResponsible = input.responsibleName?.trim() || null;
    if (!resolvedResponsible && input.supervisorUserId) {
      const [supUser] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, input.supervisorUserId))
        .limit(1);
      resolvedResponsible = supUser?.displayName || null;
    }

    await tx
      .update(shifts)
      .set({
        name: input.name?.trim() || existing.name,
        startTime: input.startTime.trim(),
        endTime: input.endTime.trim(),
        crossesMidnight,
        supervisorUserId: input.supervisorUserId ?? null,
        responsibleName: resolvedResponsible,
        operatorIdsJson: JSON.stringify(operatorIds),
        isValidated: input.isValidated !== undefined ? Boolean(input.isValidated) : existing.isValidated,
        isActive: input.isActive !== undefined ? Boolean(input.isActive) : existing.isActive,
        notes: input.notes ?? existing.notes,
        updatedByUserId: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(shifts.id, existing.id));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'SHIFT_CONFIG_UPDATED',
      entityType: 'SHIFT',
      entityId: shiftCode,
      previousValue: JSON.stringify({
        startTime: existing.startTime,
        endTime: existing.endTime,
        crossesMidnight: existing.crossesMidnight,
        supervisorUserId: existing.supervisorUserId,
        responsibleName: existing.responsibleName,
        isValidated: existing.isValidated,
      }),
      newValue: JSON.stringify({
        startTime: input.startTime.trim(),
        endTime: input.endTime.trim(),
        crossesMidnight,
        supervisorUserId: input.supervisorUserId ?? null,
        responsibleName: resolvedResponsible,
        operatorIds,
        isValidated: input.isValidated ?? existing.isValidated,
      }),
      reason: input.reason.trim(),
      origin: 'GESTAO_TURNOS',
    });
  });

  const all = await listShiftsWithAssignments();
  const updated = all.find((s) => s.code === shiftCode);
  if (!updated) throw new OperationalConflictError('Turno atualizado não encontrado.', 404);
  return updated;
}

// =========================================================================
// 2. RELATÓRIOS OPERACIONAIS & POSIÇÃO HISTÓRICA
// =========================================================================

export async function getReceivingReport(filters: ReportFilterParams = {}): Promise<ReceivingReportResponse> {
  const bounds = resolvePeriodBounds(filters.preset || 'ULTIMOS_30_DIAS', filters.startDate, filters.endDate);

  const [recRows, distRows, userRows, matRows, siloRows] = await Promise.all([
    db
      .select()
      .from(receipts)
      .where(and(gte(receipts.operationalDate, bounds.startDate), lte(receipts.operationalDate, bounds.endDate)))
      .orderBy(desc(receipts.createdAt)),
    db.select().from(receiptDistributions),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
    db.select({ id: materials.id, code: materials.code, description: materials.description }).from(materials),
    db.select({ id: silos.id, siloNumber: silos.siloNumber }).from(silos),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u.displayName]));
  const matMap = new Map(matRows.map((m) => [m.id, m]));
  const siloMap = new Map(siloRows.map((s) => [s.id, s.siloNumber]));

  const distByReceipt = new Map<number, typeof distRows>();
  for (const d of distRows) {
    if (d.status === 'ESTORNADA') continue;
    const list = distByReceipt.get(d.receiptId) ?? [];
    list.push(d);
    distByReceipt.set(d.receiptId, list);
  }

  let rows = recRows.map((r) => {
    const mat = matMap.get(r.materialId);
    const dists = distByReceipt.get(r.id) ?? [];
    const siloNums = Array.from(new Set(dists.map((d) => siloMap.get(d.siloId)).filter((n): n is number => Boolean(n))));
    const receivedKg = Number(r.receivedQuantityKg);
    const distributedKg = Number(r.distributedQuantityKg);
    const pendingKg = Math.max(0, Math.round((receivedKg - distributedKg) * 1000) / 1000);
    const startMs = r.startedAt ? r.startedAt.getTime() : NaN;
    const endMs = r.finishedAt ? r.finishedAt.getTime() : NaN;
    const durationMinutes =
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
        ? Math.round(((endMs - startMs) / 60000) * 10) / 10
        : null;

    return {
      id: r.id,
      receiptNumber: r.receiptNumber,
      entryDate: r.entryDate,
      operationalDate: r.operationalDate,
      shiftCode: r.shiftCode,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      durationMinutes,
      supplierName: r.supplierName,
      invoiceNumber: r.invoiceNumber,
      materialId: r.materialId,
      materialCode: mat?.code || 'N/I',
      materialDescription: mat?.description || 'Material não identificado',
      lotCode: r.lotCode,
      receivingType: r.receivingType,
      receivedQuantityKg: receivedKg,
      distributedQuantityKg: distributedKg,
      pendingQuantityKg: pendingKg,
      unit: r.unit,
      bagCount: r.bagCount,
      bagUnitWeightKg: r.bagUnitWeightKg ? Number(r.bagUnitWeightKg) : null,
      destinationSilosText: siloNums.length > 0 ? siloNums.map((n) => `Silo ${n}`).join(', ') : 'Sem descarga confirmada',
      operatorName: userMap.get(r.operatorUserId) || 'Dado não informado',
      status: r.status,
      notes: r.notes,
      siloIds: dists.map((d) => d.siloId),
    };
  });

  if (filters.shiftCode) {
    rows = rows.filter((r) => r.shiftCode === filters.shiftCode);
  }
  if (filters.materialId) {
    rows = rows.filter((r) => r.materialId === filters.materialId);
  }
  if (filters.siloId) {
    rows = rows.filter((r) => r.siloIds.includes(filters.siloId!));
  }
  if (filters.supplierName?.trim()) {
    const term = filters.supplierName.trim().toLowerCase();
    rows = rows.filter((r) => r.supplierName.toLowerCase().includes(term));
  }
  if (filters.lotCode?.trim()) {
    const term = filters.lotCode.trim().toLowerCase();
    rows = rows.filter((r) => r.lotCode.toLowerCase().includes(term));
  }
  if (filters.onlyPartial) {
    rows = rows.filter((r) => r.status === 'PARCIAL');
  }
  if (filters.onlyPending) {
    rows = rows.filter((r) => r.status === 'PENDENTE' || r.status === 'PARCIAL' || r.pendingQuantityKg > 0);
  }

  const cleanRows = rows.map(({ siloIds: _siloIds, ...rest }) => rest);

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    dataOrigin: 'PostgreSQL (receipts + receipt_distributions)',
    totals: {
      count: cleanRows.length,
      receivedKg: Math.round(cleanRows.reduce((a, r) => a + r.receivedQuantityKg, 0) * 1000) / 1000,
      distributedKg: Math.round(cleanRows.reduce((a, r) => a + r.distributedQuantityKg, 0) * 1000) / 1000,
      pendingKg: Math.round(cleanRows.reduce((a, r) => a + r.pendingQuantityKg, 0) * 1000) / 1000,
      partialCount: cleanRows.filter((r) => r.status === 'PARCIAL').length,
      pendingCount: cleanRows.filter((r) => r.status === 'PENDENTE').length,
      completedCount: cleanRows.filter((r) => r.status === 'CONCLUIDO').length,
    },
    rows: cleanRows,
  };
}

export async function getStockAndHistoricalReport(
  filters: ReportFilterParams = {}
): Promise<StockAndHistoricalReportResponse> {
  const bounds = resolvePeriodBounds(filters.preset || 'ULTIMOS_30_DIAS', filters.startDate, filters.endDate);
  const historicalTargetDate =
    filters.historicalDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.historicalDate)
      ? filters.historicalDate
      : bounds.endDate;
  const cutoffMode = filters.cutoffMode || 'OPERATIONAL_DATE';

  const [silosDetail, allMovements, matRows, siloCheckAudits] = await Promise.all([
    listSilosWithDetails(),
    db.select().from(inventoryMovements).orderBy(inventoryMovements.createdAt),
    db.select({ id: materials.id, code: materials.code, description: materials.description }).from(materials),
    db
      .select({ entityId: auditEvents.entityId, createdAt: auditEvents.createdAt })
      .from(auditEvents)
      .where(eq(auditEvents.entityType, 'SILO'))
      .orderBy(desc(auditEvents.createdAt)),
  ]);

  const matMap = new Map(matRows.map((m) => [m.id, m]));
  const siloMetaMap = new Map(silosDetail.map((s) => [s.id, s]));

  const lastAuditBySilo = new Map<number, string>();
  for (const a of siloCheckAudits) {
    const sid = Number(a.entityId);
    if (Number.isInteger(sid) && !lastAuditBySilo.has(sid)) {
      lastAuditBySilo.set(sid, a.createdAt.toISOString());
    }
  }

  // Lotes ativos atuais por silo pelo livro razão
  const activeLotNet = new Map<string, number>();
  const periodAggBySilo = new Map<
    number,
    { inbound: number; outbound: number; transferIn: number; transferOut: number; adjustments: number }
  >();

  for (const m of allMovements) {
    const lot = (m.lotCode && m.lotCode.trim()) || 'SEM_LOTE';
    const key = `${m.siloId}::${lot}`;
    const qty = Number(m.quantityKg);
    const signed = m.direction === 'CREDIT' ? qty : -qty;
    activeLotNet.set(key, (activeLotNet.get(key) ?? 0) + signed);

    if (m.operationalDate >= bounds.startDate && m.operationalDate <= bounds.endDate) {
      if (filters.shiftCode && m.shiftCode !== filters.shiftCode) continue;
      const p = periodAggBySilo.get(m.siloId) ?? {
        inbound: 0,
        outbound: 0,
        transferIn: 0,
        transferOut: 0,
        adjustments: 0,
      };
      if (m.movementType === 'ENTRADA') {
        p.inbound += qty;
      } else if (m.movementType === 'SAIDA') {
        p.outbound += qty;
      } else if (m.movementType === 'TRANSFERENCIA') {
        if (m.direction === 'CREDIT') p.transferIn += qty;
        else p.transferOut += qty;
      } else if (m.movementType === 'AJUSTE_AUTORIZADO' || m.movementType === 'REVERSAO') {
        p.adjustments += signed;
      }
      periodAggBySilo.set(m.siloId, p);
    }
  }

  let filteredSilos = silosDetail;
  if (filters.siloId) {
    filteredSilos = filteredSilos.filter((s) => s.id === filters.siloId);
  }
  if (filters.materialId) {
    filteredSilos = filteredSilos.filter((s) => s.primaryMaterialId === filters.materialId);
  }
  if (filters.lineCode) {
    filteredSilos = filteredSilos.filter((s) => s.lineCode === filters.lineCode);
  }

  const currentRows = filteredSilos.map((s) => {
    const lotEntries: string[] = [];
    for (const [k, net] of activeLotNet.entries()) {
      if (k.startsWith(`${s.id}::`) && net > 0.01) {
        const lotName = k.split('::')[1];
        lotEntries.push(`${lotName} (${Math.round(net).toLocaleString('pt-BR')} kg)`);
      }
    }
    const p = periodAggBySilo.get(s.id) ?? {
      inbound: 0,
      outbound: 0,
      transferIn: 0,
      transferOut: 0,
      adjustments: 0,
    };

    return {
      siloId: s.id,
      siloNumber: s.siloNumber,
      category: s.category,
      lineCode: s.lineCode,
      lineName: s.lineName,
      controlOwner: s.controlOwner,
      materialId: s.primaryMaterialId,
      materialCode: s.materialCode,
      materialDescription: s.materialDescription,
      activeLotsText: lotEntries.length > 0 ? lotEntries.join(', ') : 'Sem saldo por lote',
      confirmedStockKg: s.confirmedStockKg,
      nominalCapacityKg: s.nominalCapacityKg,
      safeCapacityKg: s.safeCapacityKg,
      occupancyPercent: s.occupancyPercent,
      availableSpaceKg: s.availableSpaceKg,
      lastMovementAt: s.lastMovementAt ? new Date(s.lastMovementAt).toISOString() : null,
      lastValidationOrAuditAt: lastAuditBySilo.get(s.id) ?? (s.updatedAt ? new Date(s.updatedAt).toISOString() : null),
      inboundPeriodKg: Math.round(p.inbound * 1000) / 1000,
      outboundPeriodKg: Math.round(p.outbound * 1000) / 1000,
      transfersInPeriodKg: Math.round(p.transferIn * 1000) / 1000,
      transfersOutPeriodKg: Math.round(p.transferOut * 1000) / 1000,
      adjustmentsPeriodKg: Math.round(p.adjustments * 1000) / 1000,
      operationalStatus: s.operationalStatus,
      stockControlModel: s.stockControlModel,
      ledgerStockKg: s.ledgerStockKg ?? s.confirmedStockKg,
      lastPhysicalCountKg: s.lastPhysicalCountKg ?? null,
      lastPhysicalCountAt: s.lastPhysicalCountAt ?? null,
      previousPhysicalCountKg: s.previousPhysicalCountKg ?? null,
      previousPhysicalCountAt: s.previousPhysicalCountAt ?? null,
      physicalVariationKg: s.physicalVariationKg ?? null,
      physicalVariationPct: s.physicalVariationPct ?? null,
      rubricagemStatus: s.rubricagemStatus ?? null,
      hasDivergence:
        s.rubricagemStatus === 'DIVERGENCIA_IDENTIFICADA' ||
        (s.controlOwner === 'MOEGA' &&
          s.physicalDivergenceKg !== null &&
          s.physicalDivergenceKg !== undefined &&
          Math.abs(s.physicalDivergenceKg) > 1),
    };
  });

  const moegaContinuousRows = currentRows.filter((r) => r.controlOwner !== 'PRODUCAO');
  const producaoPhysicalRows = currentRows.filter((r) => r.controlOwner === 'PRODUCAO');

  // Posição histórica reconstruída estritamente pelo livro razão até historicalTargetDate
  const ledgerInputs = allMovements.map((m) => {
    const s = siloMetaMap.get(m.siloId);
    const mat = matMap.get(m.materialId);
    return {
      id: m.id,
      siloId: m.siloId,
      siloNumber: s?.siloNumber ?? 0,
      lineCode: s?.lineCode ?? 'N/I',
      siloCategory: s?.category ?? 'N/I',
      materialId: m.materialId,
      materialCode: mat?.code ?? 'N/I',
      materialDescription: mat?.description ?? 'N/I',
      lotCode: m.lotCode,
      quantityKg: Number(m.quantityKg),
      direction: m.direction,
      operationalDate: m.operationalDate,
      createdAtIso: m.createdAt.toISOString(),
    };
  });

  const historical = reconstructHistoricalStockPosition({
    targetDate: historicalTargetDate,
    cutoffMode,
    movements: ledgerInputs,
    siloFilterId: filters.siloId ?? null,
    materialFilterId: filters.materialId ?? null,
  });

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    historicalTargetDate,
    cutoffMode,
    dataOrigin:
      'PostgreSQL — Estoque Contínuo Moega (inventory_movements) + Inventário Físico Diário Produção (rubricagem_entries)',
    currentTotals: {
      totalConfirmedStockKg: Math.round(currentRows.reduce((a, r) => a + r.confirmedStockKg, 0) * 1000) / 1000,
      totalSafeCapacityKg: Math.round(currentRows.reduce((a, r) => a + r.safeCapacityKg, 0) * 1000) / 1000,
      totalFreeSpaceKg: Math.round(currentRows.reduce((a, r) => a + r.availableSpaceKg, 0) * 1000) / 1000,
      inboundPeriodKg: Math.round(currentRows.reduce((a, r) => a + r.inboundPeriodKg, 0) * 1000) / 1000,
      outboundPeriodKg: Math.round(currentRows.reduce((a, r) => a + r.outboundPeriodKg, 0) * 1000) / 1000,
      transfersPeriodKg: Math.round(currentRows.reduce((a, r) => a + r.transfersInPeriodKg, 0) * 1000) / 1000,
      adjustmentsPeriodKg: Math.round(currentRows.reduce((a, r) => a + r.adjustmentsPeriodKg, 0) * 1000) / 1000,
    },
    currentRows,
    moegaContinuousTotals: {
      totalConfirmedStockKg:
        Math.round(moegaContinuousRows.reduce((a, r) => a + r.confirmedStockKg, 0) * 1000) / 1000,
      totalSafeCapacityKg:
        Math.round(moegaContinuousRows.reduce((a, r) => a + r.safeCapacityKg, 0) * 1000) / 1000,
      totalFreeSpaceKg:
        Math.round(moegaContinuousRows.reduce((a, r) => a + r.availableSpaceKg, 0) * 1000) / 1000,
      silosCount: moegaContinuousRows.length,
      divergenceCount: moegaContinuousRows.filter((r) => r.hasDivergence).length,
    },
    moegaContinuousRows,
    producaoPhysicalTotals: {
      totalConfirmedStockKg:
        Math.round(producaoPhysicalRows.reduce((a, r) => a + r.confirmedStockKg, 0) * 1000) / 1000,
      totalSafeCapacityKg:
        Math.round(producaoPhysicalRows.reduce((a, r) => a + r.safeCapacityKg, 0) * 1000) / 1000,
      totalFreeSpaceKg:
        Math.round(producaoPhysicalRows.reduce((a, r) => a + r.availableSpaceKg, 0) * 1000) / 1000,
      silosCount: producaoPhysicalRows.length,
      confirmedInventoriesCount: producaoPhysicalRows.filter(
        (r) => r.rubricagemStatus === 'INVENTARIO_CONFIRMADO'
      ).length,
      pendingConfirmationCount: producaoPhysicalRows.filter(
        (r) =>
          r.rubricagemStatus === 'AGUARDANDO_AUTORIZACAO' ||
          r.rubricagemStatus === 'DIVERGENCIA_IDENTIFICADA' ||
          r.rubricagemStatus === 'AGUARDANDO_CONFERENCIA'
      ).length,
      divergenceCount: producaoPhysicalRows.filter((r) => r.hasDivergence).length,
    },
    producaoPhysicalRows,
    historicalTotals: {
      targetDate: historicalTargetDate,
      totalHistoricalBalanceKg: historical.totalHistoricalBalanceKg,
      movementsEvaluatedCount: historical.movementsEvaluatedCount,
      note: historical.note,
    },
    historicalRows: historical.rows,
  };
}

export async function getTransfersReport(filters: ReportFilterParams = {}): Promise<TransfersReportResponse> {
  const bounds = resolvePeriodBounds(filters.preset || 'ULTIMOS_30_DIAS', filters.startDate, filters.endDate);

  const [orders, siloRows, matRows, lineRows, ruleRows, userRows] = await Promise.all([
    db
      .select()
      .from(transferOrders)
      .where(
        and(gte(transferOrders.operationalDate, bounds.startDate), lte(transferOrders.operationalDate, bounds.endDate))
      )
      .orderBy(desc(transferOrders.createdAt)),
    db.select({ id: silos.id, siloNumber: silos.siloNumber }).from(silos),
    db.select({ id: materials.id, code: materials.code, description: materials.description }).from(materials),
    db.select({ id: productionLines.id, code: productionLines.code }).from(productionLines),
    db.select({ id: siloTransferRules.id, authorizationStatus: siloTransferRules.authorizationStatus }).from(siloTransferRules),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
  ]);

  const siloMap = new Map(siloRows.map((s) => [s.id, s.siloNumber]));
  const matMap = new Map(matRows.map((m) => [m.id, m]));
  const lineMap = new Map(lineRows.map((l) => [l.id, l.code]));
  const ruleMap = new Map(ruleRows.map((r) => [r.id, r.authorizationStatus]));
  const userMap = new Map(userRows.map((u) => [u.id, u.displayName]));

  let rows = orders.map((o) => {
    const mat = matMap.get(o.materialId);
    const planned = Number(o.plannedQuantityKg);
    const transferred = Number(o.transferredQuantityKg);
    const pending = Math.max(0, Math.round((planned - transferred) * 1000) / 1000);
    const execUser = o.assignedOperatorUserId ? userMap.get(o.assignedOperatorUserId) : null;
    const reqUser = userMap.get(o.requestedByUserId) || 'Dado não informado';
    return {
      id: o.id,
      orderCode: o.orderCode,
      operationalDate: o.operationalDate,
      shiftCode: o.shiftCode,
      startedAt: o.startedAt ? o.startedAt.toISOString() : null,
      finishedAt: o.finishedAt ? o.finishedAt.toISOString() : null,
      createdAt: o.createdAt.toISOString(),
      materialId: o.materialId,
      originSiloId: o.originSiloId,
      destinationSiloId: o.destinationSiloId,
      materialCode: mat?.code || 'N/I',
      materialDescription: mat?.description || 'N/I',
      lotCode: o.lotCode,
      originSiloNumber: siloMap.get(o.originSiloId) ?? null,
      destinationSiloNumber: siloMap.get(o.destinationSiloId) ?? null,
      lineCode: o.productionLineId ? lineMap.get(o.productionLineId) ?? null : null,
      plannedQuantityKg: planned,
      transferredQuantityKg: transferred,
      pendingQuantityKg: pending,
      operatorName: execUser || reqUser,
      requestedByName: reqUser,
      status: o.status,
      priority: o.priority,
      routeStatus: ruleMap.get(o.transferRuleId) || 'AUTORIZADA',
      interruptionReason: o.interruptionReason,
      notes: o.notes,
    };
  });

  if (filters.shiftCode) {
    rows = rows.filter((r) => r.shiftCode === filters.shiftCode);
  }
  if (filters.materialId) {
    rows = rows.filter((r) => r.materialId === filters.materialId);
  }
  if (filters.siloId) {
    rows = rows.filter((r) => r.originSiloId === filters.siloId || r.destinationSiloId === filters.siloId);
  }
  if (filters.status) {
    rows = rows.filter((r) => r.status === filters.status);
  }
  if (filters.lineCode) {
    rows = rows.filter((r) => r.lineCode === filters.lineCode);
  }

  const cleanRows = rows.map(
    ({ materialId: _m, originSiloId: _o, destinationSiloId: _d, ...rest }) => rest
  );

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    dataOrigin: 'PostgreSQL (transfer_orders + transfer_execution_steps + silo_transfer_rules)',
    totals: {
      count: cleanRows.length,
      plannedKg: Math.round(cleanRows.reduce((a, r) => a + r.plannedQuantityKg, 0) * 1000) / 1000,
      transferredKg: Math.round(cleanRows.reduce((a, r) => a + r.transferredQuantityKg, 0) * 1000) / 1000,
      pendingKg: Math.round(cleanRows.reduce((a, r) => a + r.pendingQuantityKg, 0) * 1000) / 1000,
      completedCount: cleanRows.filter((r) => r.status === 'CONCLUIDA').length,
      partialCount: cleanRows.filter((r) => r.status === 'PARCIAL').length,
      interruptedCount: cleanRows.filter((r) => r.status === 'INTERROMPIDA').length,
      openCount: cleanRows.filter((r) => r.status === 'PLANEJADA' || r.status === 'EM_ANDAMENTO').length,
      canceledCount: cleanRows.filter((r) => r.status === 'CANCELADA').length,
    },
    rows: cleanRows,
  };
}

export async function getConsumptionAndScheduleReport(
  filters: ReportFilterParams = {}
): Promise<ConsumptionReportResponse> {
  const bounds = resolvePeriodBounds(filters.preset || 'ULTIMOS_30_DIAS', filters.startDate, filters.endDate);

  const [projections, schedules, items, lines, matRows, silosDetail] = await Promise.all([
    db
      .select()
      .from(productionConsumptionProjections)
      .where(
        and(
          gte(productionConsumptionProjections.referenceDate, bounds.startDate),
          lte(productionConsumptionProjections.referenceDate, bounds.endDate)
        )
      ),
    db.select().from(productionSchedules),
    db.select().from(productionScheduleItems),
    db.select().from(productionLines),
    db.select({ id: materials.id, code: materials.code, description: materials.description }).from(materials),
    listSilosWithDetails(),
  ]);

  const schedMap = new Map(schedules.map((s) => [s.id, s]));
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const lineMap = new Map(lines.map((l) => [l.id, l.code]));
  const matMap = new Map(matRows.map((m) => [m.id, m]));

  const stockByMaterial = new Map<number, number>();
  for (const s of silosDetail) {
    if (s.primaryMaterialId) {
      stockByMaterial.set(
        s.primaryMaterialId,
        (stockByMaterial.get(s.primaryMaterialId) ?? 0) + s.confirmedStockKg
      );
    }
  }

  let rows = projections
    .filter((p) => {
      const sched = schedMap.get(p.scheduleId);
      return sched && sched.status !== 'CANCELADA' && sched.status !== 'SUPERSEDED';
    })
    .map((p) => {
      const sched = schedMap.get(p.scheduleId)!;
      const item = itemMap.get(p.scheduleItemId);
      const lineCode = lineMap.get(p.productionLineId) || 'N/I';
      const mat = p.materialId ? matMap.get(p.materialId) : null;
      const plannedKg = Number(p.calculatedConsumptionKg);
      const realizedRaw = Number(p.realizedConsumptionKg || 0);
      const hasRealizedRecord =
        realizedRaw > 0 || Boolean(item && Number(item.realizedQuantity || 0) > 0);
      const realizedKg = hasRealizedRecord ? realizedRaw : null;
      const varianceKg =
        realizedKg !== null ? Math.round((realizedKg - plannedKg) * 1000) / 1000 : null;
      const realStockKg = p.materialId ? stockByMaterial.get(p.materialId) ?? 0 : 0;
      const projectedBalanceKg = Math.round((realStockKg - plannedKg) * 1000) / 1000;

      return {
        projectionId: p.id,
        scheduleCode: sched.scheduleCode,
        revisionNumber: sched.revisionNumber,
        referenceDate: p.referenceDate,
        lineCode,
        productCode: item?.productCode || 'N/I',
        productDescription: item?.productDescription || 'N/I',
        materialId: p.materialId,
        materialCode: mat?.code ?? item?.materialCode ?? null,
        materialDescription: mat?.description ?? null,
        plannedConsumptionKg: plannedKg,
        realizedConsumptionKg: realizedKg,
        hasRealizedRecord,
        varianceKg,
        realStockKg,
        projectedBalanceKg,
        calculationStatus: p.calculationStatus,
        executionStatus: item?.executionStatus || 'NAO_INICIADA',
        originSource: p.originSource,
      };
    });

  if (filters.lineCode) {
    rows = rows.filter((r) => r.lineCode === filters.lineCode);
  }
  if (filters.materialId) {
    rows = rows.filter((r) => r.materialId === filters.materialId);
  }
  if (filters.onlyPendingComparison) {
    rows = rows.filter((r) => r.calculationStatus === 'PENDENTE_FATOR' || !r.hasRealizedRecord);
  }

  const realizedRows = rows.filter((r) => r.hasRealizedRecord && r.realizedConsumptionKg !== null);
  const totalRealized =
    realizedRows.length > 0
      ? Math.round(realizedRows.reduce((a, r) => a + (r.realizedConsumptionKg || 0), 0) * 1000) / 1000
      : null;
  const totalPlannedForRealized = realizedRows.reduce((a, r) => a + r.plannedConsumptionKg, 0);

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    dataOrigin:
      'PostgreSQL (production_schedules + production_consumption_projections + inventory_movements)',
    totals: {
      plannedConsumptionKg: Math.round(rows.reduce((a, r) => a + r.plannedConsumptionKg, 0) * 1000) / 1000,
      realizedConsumptionKg: totalRealized,
      varianceKg:
        totalRealized !== null
          ? Math.round((totalRealized - totalPlannedForRealized) * 1000) / 1000
          : null,
      pendingFactorCount: rows.filter((r) => r.calculationStatus === 'PENDENTE_FATOR').length,
      rowsCount: rows.length,
      realizedRowsCount: realizedRows.length,
    },
    rows,
  };
}

// =========================================================================
// 3. METAS FUTURAS & PAINEL GERAL DE INDICADORES
// =========================================================================

export async function listPerformanceTargets(): Promise<PerformanceTargetItem[]> {
  const [targets, userRows] = await Promise.all([
    db.select().from(performanceTargets).orderBy(performanceTargets.label),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
  ]);
  const userMap = new Map(userRows.map((u) => [u.id, u.displayName]));
  return targets.map((t) => ({
    id: t.id,
    code: t.code,
    metricKey: t.metricKey,
    label: t.label,
    targetValue: Number(t.targetValue),
    unit: t.unit,
    targetPeriod: t.targetPeriod as PerformanceTargetItem['targetPeriod'],
    effectiveFromDate: t.effectiveFromDate,
    notes: t.notes,
    isActive: t.isActive,
    updatedByName: t.updatedByUserId ? userMap.get(t.updatedByUserId) ?? null : null,
    updatedAt: t.updatedAt.toISOString(),
  }));
}

export async function upsertPerformanceTargetTransactional(
  input: {
    code: string;
    metricKey: string;
    label: string;
    targetValue: number;
    unit: string;
    targetPeriod: 'DIARIO' | 'SEMANAL' | 'MENSAL';
    effectiveFromDate: string;
    notes?: string | null;
    isActive?: boolean;
  },
  actor: AuthenticatedAppUser
): Promise<PerformanceTargetItem> {
  if (!input.code?.trim() || !input.label?.trim() || !Number.isFinite(input.targetValue) || input.targetValue < 0) {
    throw new OperationalConflictError('Informe código, título e valor alvo válido para a meta.', 400);
  }

  await db.transaction(async (tx) => {
    const code = input.code.trim().toUpperCase();
    const [existing] = await tx
      .select()
      .from(performanceTargets)
      .where(eq(performanceTargets.code, code))
      .limit(1);

    await tx
      .insert(performanceTargets)
      .values({
        code,
        metricKey: input.metricKey.trim(),
        label: input.label.trim(),
        targetValue: String(input.targetValue),
        unit: input.unit.trim(),
        targetPeriod: input.targetPeriod,
        effectiveFromDate: input.effectiveFromDate,
        notes: input.notes ?? null,
        isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
        updatedByUserId: actor.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: performanceTargets.code,
        set: {
          metricKey: input.metricKey.trim(),
          label: input.label.trim(),
          targetValue: String(input.targetValue),
          unit: input.unit.trim(),
          targetPeriod: input.targetPeriod,
          effectiveFromDate: input.effectiveFromDate,
          notes: input.notes ?? null,
          isActive: input.isActive !== undefined ? Boolean(input.isActive) : true,
          updatedByUserId: actor.id,
          updatedAt: new Date(),
        },
      });

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'KPI_TARGET_UPDATED',
      entityType: 'PERFORMANCE_TARGET',
      entityId: code,
      previousValue: existing ? JSON.stringify({ targetValue: existing.targetValue, unit: existing.unit }) : null,
      newValue: JSON.stringify({
        targetValue: input.targetValue,
        unit: input.unit,
        effectiveFromDate: input.effectiveFromDate,
      }),
      reason: 'Configuração administrativa de meta futura (separada de histórico real)',
      origin: 'METAS_FUTURAS',
    });
  });

  const all = await listPerformanceTargets();
  const saved = all.find((t) => t.code === input.code.trim().toUpperCase());
  if (!saved) throw new OperationalConflictError('Falha ao recuperar meta salva.', 500);
  return saved;
}

export async function listReportSnapshots(limit: number = 25): Promise<ReportSnapshotItem[]> {
  const [snaps, userRows] = await Promise.all([
    db.select().from(reportSnapshots).orderBy(desc(reportSnapshots.createdAt)).limit(limit),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
  ]);
  const userMap = new Map(userRows.map((u) => [u.id, u.displayName]));
  return snaps.map((s) => ({
    id: s.id,
    snapshotCode: s.snapshotCode,
    reportType: s.reportType,
    title: s.title,
    format: s.format as ReportSnapshotItem['format'],
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    filtersJson: s.filtersJson,
    totalsJson: s.totalsJson,
    dataOrigin: s.dataOrigin,
    version: s.version,
    generatedByName: userMap.get(s.generatedByUserId) || 'Dado não informado',
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function getOperationalIndicatorsOverview(
  filters: ReportFilterParams = {}
): Promise<OperationalIndicatorsOverview> {
  const bounds = resolvePeriodBounds(filters.preset || 'HOJE', filters.startDate, filters.endDate);

  const [
    silosDetail,
    matsList,
    receivingRep,
    transfersRep,
    consumptionRep,
    intakeReqs,
    recsList,
    occRows,
    schedulesList,
    valPendencies,
    thresholds,
    futureTargets,
    recentSnapshots,
  ] = await Promise.all([
    listSilosWithDetails(),
    db.select().from(materials).where(eq(materials.isActive, true)),
    getReceivingReport({ ...filters, preset: 'PERSONALIZADO', startDate: bounds.startDate, endDate: bounds.endDate }),
    getTransfersReport({ ...filters, preset: 'PERSONALIZADO', startDate: bounds.startDate, endDate: bounds.endDate }),
    getConsumptionAndScheduleReport({
      ...filters,
      preset: 'PERSONALIZADO',
      startDate: bounds.startDate,
      endDate: bounds.endDate,
    }),
    db.select().from(materialIntakeRequests).where(eq(materialIntakeRequests.status, 'ABERTA')),
    db
      .select()
      .from(operationalRecommendations)
      .where(inArray(operationalRecommendations.decisionStatus, ['PENDENTE', 'EM_ANALISE'])),
    db.select().from(operationalOccurrences),
    db
      .select()
      .from(productionSchedules)
      .where(
        and(gte(productionSchedules.referenceDate, bounds.startDate), lte(productionSchedules.referenceDate, bounds.endDate))
      ),
    db.select().from(validationPendencies).where(eq(validationPendencies.status, 'PENDENTE')),
    db.select().from(materialStockThresholds),
    listPerformanceTargets(),
    listReportSnapshots(15),
  ]);

  let filteredSilos = silosDetail;
  if (filters.siloId) filteredSilos = filteredSilos.filter((s) => s.id === filters.siloId);
  if (filters.materialId) filteredSilos = filteredSilos.filter((s) => s.primaryMaterialId === filters.materialId);
  if (filters.lineCode) filteredSilos = filteredSilos.filter((s) => s.lineCode === filters.lineCode);

  const totalConfirmedStockKg =
    Math.round(filteredSilos.reduce((a, s) => a + s.confirmedStockKg, 0) * 1000) / 1000;
  const occupiedSilosCount = filteredSilos.filter((s) => s.confirmedStockKg > 0).length;
  const availableSilosCount = filteredSilos.filter(
    (s) => s.operationalStatus === 'OPERACIONAL' && s.availableSpaceKg > 0
  ).length;

  const occInPeriod = occRows.filter(
    (o) => o.operationalDate >= bounds.startDate && o.operationalDate <= bounds.endDate
  );
  const openOccurrencesCount = occRows.filter((o) => o.status !== 'ENCERRADA').length;

  // Materiais em risco: abaixo do estoque mínimo ou marcados críticos com estoque zerado
  const stockByMat = new Map<number, number>();
  for (const s of silosDetail) {
    if (s.primaryMaterialId) {
      stockByMat.set(s.primaryMaterialId, (stockByMat.get(s.primaryMaterialId) ?? 0) + s.confirmedStockKg);
    }
  }
  const atRiskMatIds = new Set<number>();
  for (const th of thresholds) {
    const stock = stockByMat.get(th.materialId) ?? 0;
    if (stock <= Number(th.minStockKg)) {
      atRiskMatIds.add(th.materialId);
    }
  }
  for (const r of recsList) {
    if ((r.priority === 'VERMELHO' || r.priority === 'LARANJA') && r.materialId) {
      atRiskMatIds.add(r.materialId);
    }
  }

  const partialDistributionsCount = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(receipts)
    .where(
      and(
        gte(receipts.operationalDate, bounds.startDate),
        lte(receipts.operationalDate, bounds.endDate),
        eq(receipts.status, 'PARCIAL')
      )
    );

  const shortageAlertsCount = recsList.filter((r) => r.priority === 'VERMELHO').length;

  const performanceKpis = computePerformanceKpis({
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    receipts: receivingRep.rows.map((r) => ({
      receivedQuantityKg: r.receivedQuantityKg,
      distributedQuantityKg: r.distributedQuantityKg,
      status: r.status,
      startedAtIso: r.startedAt,
      finishedAtIso: r.finishedAt,
    })),
    partialDistributionsCount: Number(partialDistributionsCount[0]?.count || 0),
    transferredVolumeKg: transfersRep.totals.transferredKg,
    occurrencesTotalCount: occInPeriod.length,
    occurrencesOpenCount: openOccurrencesCount,
    divergencesFrequency:
      valPendencies.length +
      occInPeriod.filter((o) => o.category === 'Divergência de estoque').length,
    shortageAlertsFrequency: shortageAlertsCount,
    consumptionRows: consumptionRep.rows.map((c) => ({
      plannedConsumptionKg: c.plannedConsumptionKg,
      realizedConsumptionKg: c.realizedConsumptionKg ?? 0,
      hasRealizedRecord: c.hasRealizedRecord,
    })),
  });

  return {
    periodLabel: bounds.label,
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    generatedAtIso: new Date().toISOString(),
    dataOrigin: 'PostgreSQL (Base Integrada NEXO LOG 2.0)',
    indicators: {
      totalConfirmedStockKg,
      registeredMaterialsCount: matsList.length,
      occupiedSilosCount,
      availableSilosCount,
      totalSilosCount: filteredSilos.length,
      completedReceiptsCount: receivingRep.totals.completedCount,
      receivedVolumeKg: receivingRep.totals.receivedKg,
      transfersCompletedCount: transfersRep.totals.completedCount,
      transferredVolumeKg: transfersRep.totals.transferredKg,
      pendingPartialDischargesCount: receivingRep.totals.partialCount + receivingRep.totals.pendingCount,
      pendingSupplyRequestsCount: intakeReqs.length,
      activeAlertsCount: recsList.length + valPendencies.length,
      openOccurrencesCount,
      importedSchedulesCount: schedulesList.filter((s) => s.status !== 'CANCELADA').length,
      atRiskMaterialsCount: atRiskMatIds.size,
    },
    performanceKpis,
    futureTargets,
    recentSnapshots,
  };
}

// =========================================================================
// 4. EXPORTAÇÃO UNIFICADA PDF / XLSX / CSV COM RBAC E SNAPSHOT AUDITÁVEL
// =========================================================================

export async function exportOperationalReportTransactional(
  params: {
    reportType: ReportTypeCode;
    format: ExportFormat;
    filters: ReportFilterParams;
    shiftCode?: ShiftCode;
    operationalDate?: string;
  },
  actor: AuthenticatedAppUser
) {
  if (!hasPermission(actor.roleCode, 'reports:export')) {
    throw new OperationalConflictError('Perfil sem permissão para exportar relatórios.', 403);
  }

  // Perfil PRODUCAO não exporta dados administrativos/operacionais restritos (ex.: Relatório de Turno completo ou colunas de auditoria interna)
  const isRestrictedProfile = actor.roleCode === 'PRODUCAO' && !hasPermission(actor.roleCode, 'audit:view');
  if (isRestrictedProfile && params.reportType === 'TURNO') {
    throw new OperationalConflictError(
      'Perfil Produção não tem permissão para exportar relatórios administrativos de passagem de turno.',
      403
    );
  }

  const bounds = resolvePeriodBounds(
    params.filters?.preset || 'HOJE',
    params.filters?.startDate,
    params.filters?.endDate
  );
  const generatedAtIso = new Date().toISOString();
  const filtersSummary =
    [
      params.filters?.shiftCode ? `Turno=${params.filters.shiftCode}` : null,
      params.filters?.lineCode ? `Linha=${params.filters.lineCode}` : null,
      params.filters?.siloId ? `SiloID=${params.filters.siloId}` : null,
      params.filters?.materialId ? `MaterialID=${params.filters.materialId}` : null,
      params.filters?.lotCode ? `Lote=${params.filters.lotCode}` : null,
      params.filters?.historicalDate ? `DataHist=${params.filters.historicalDate}` : null,
    ]
      .filter(Boolean)
      .join(', ') || 'Sem filtros restritivos adicionais';

  let reportTitle = '';
  let dataOrigin = '';
  let columns: ExportColumnDef[] = [];
  let rows: Array<Record<string, string | number | null | undefined>> = [];
  let totalsSummary: Array<{ label: string; value: string }> = [];

  if (params.reportType === 'RECEBIMENTOS') {
    const rep = await getReceivingReport(params.filters);
    reportTitle = 'Relatório Operacional de Recebimentos';
    dataOrigin = rep.dataOrigin;
    columns = [
      { key: 'receiptNumber', header: 'Nº Receb.', width: 16 },
      { key: 'operationalDate', header: 'Data Op.', width: 12 },
      { key: 'shiftCode', header: 'Turno', width: 11 },
      { key: 'supplierName', header: 'Fornecedor', width: 24 },
      { key: 'materialCode', header: 'Código MP', width: 14 },
      { key: 'materialDescription', header: 'Matéria-Prima', width: 24 },
      { key: 'lotCode', header: 'Lote', width: 14 },
      { key: 'receivedQuantityKg', header: 'Recebido (kg)', width: 14, align: 'right' },
      { key: 'distributedQuantityKg', header: 'Descarregado (kg)', width: 15, align: 'right' },
      { key: 'pendingQuantityKg', header: 'Pendente (kg)', width: 14, align: 'right' },
      { key: 'destinationSilosText', header: 'Silos Destino', width: 18 },
      ...(isRestrictedProfile ? [] : [{ key: 'operatorName', header: 'Operador', width: 18 }]),
      { key: 'status', header: 'Status', width: 12 },
    ];
    rows = rep.rows.map((r) => ({
      ...r,
      receivedQuantityKg: Math.round(r.receivedQuantityKg),
      distributedQuantityKg: Math.round(r.distributedQuantityKg),
      pendingQuantityKg: Math.round(r.pendingQuantityKg),
    }));
    totalsSummary = [
      { label: 'Quantidade de Recebimentos', value: String(rep.totals.count) },
      { label: 'Volume Total Recebido', value: `${Math.round(rep.totals.receivedKg).toLocaleString('pt-BR')} kg` },
      { label: 'Volume Descarregado', value: `${Math.round(rep.totals.distributedKg).toLocaleString('pt-BR')} kg` },
      { label: 'Saldo Pendente', value: `${Math.round(rep.totals.pendingKg).toLocaleString('pt-BR')} kg` },
    ];
  } else if (params.reportType === 'ESTOQUE' || params.reportType === 'POSICAO_HISTORICA') {
    const rep = await getStockAndHistoricalReport(params.filters);
    dataOrigin = rep.dataOrigin;
    if (params.reportType === 'POSICAO_HISTORICA') {
      reportTitle = `Posição Histórica de Estoque (${formatIsoDatePtBr(rep.historicalTargetDate)})`;
      columns = [
        { key: 'siloNumber', header: 'Silo', width: 10 },
        { key: 'lineCode', header: 'Linha', width: 10 },
        { key: 'category', header: 'Grupo', width: 14 },
        { key: 'materialCode', header: 'Código MP', width: 14 },
        { key: 'materialDescription', header: 'Matéria-Prima', width: 26 },
        { key: 'lotCode', header: 'Lote', width: 15 },
        { key: 'historicalBalanceKg', header: 'Saldo na Data (kg)', width: 16, align: 'right' },
        { key: 'movementCountUpToDate', header: 'Movs. até Data', width: 13, align: 'right' },
      ];
      rows = rep.historicalRows.map((r) => ({
        ...r,
        siloNumber: `Silo ${r.siloNumber}`,
        historicalBalanceKg: Math.round(r.historicalBalanceKg),
      }));
      totalsSummary = [
        { label: 'Data Histórica Consultada', value: formatIsoDatePtBr(rep.historicalTargetDate) },
        {
          label: 'Saldo Total Reconstruído',
          value: `${Math.round(rep.historicalTotals.totalHistoricalBalanceKg).toLocaleString('pt-BR')} kg`,
        },
        { label: 'Movimentações Avaliadas', value: String(rep.historicalTotals.movementsEvaluatedCount) },
      ];
    } else {
      reportTitle = 'Relatório de Posição de Estoque (Moega Contínuo x Produção Físico Diário)';
      columns = [
        { key: 'stockModelLabel', header: 'Modelo de Controle', width: 22 },
        { key: 'siloNumber', header: 'Silo', width: 10 },
        { key: 'lineCode', header: 'Linha', width: 10 },
        { key: 'category', header: 'Grupo', width: 14 },
        { key: 'materialCode', header: 'Código MP', width: 14 },
        { key: 'materialDescription', header: 'Matéria-Prima', width: 24 },
        { key: 'confirmedStockKg', header: 'Saldo Ativo (kg)', width: 14, align: 'right' },
        { key: 'safeCapacityKg', header: 'Cap. Segura (kg)', width: 14, align: 'right' },
        { key: 'availableSpaceKg', header: 'Espaço Livre (kg)', width: 14, align: 'right' },
        { key: 'occupancyPercent', header: 'Ocup. (%)', width: 10, align: 'right' },
        { key: 'operationalStatus', header: 'Status', width: 13 },
      ];
      rows = rep.currentRows.map((r) => ({
        ...r,
        stockModelLabel:
          r.controlOwner === 'PRODUCAO' ? 'PRODUÇÃO Físico Diário' : 'MOEGA Contínuo',
        siloNumber: `Silo ${r.siloNumber}`,
        confirmedStockKg: Math.round(r.confirmedStockKg),
        safeCapacityKg: Math.round(r.safeCapacityKg),
        availableSpaceKg: Math.round(r.availableSpaceKg),
      }));
      totalsSummary = [
        {
          label: 'ESTOQUE CONTÍNUO DA MOEGA',
          value: `${Math.round(rep.moegaContinuousTotals?.totalConfirmedStockKg ?? 0).toLocaleString('pt-BR')} kg (${rep.moegaContinuousTotals?.silosCount ?? 0} silos)`,
        },
        {
          label: 'ESTOQUE FÍSICO DIÁRIO DA PRODUÇÃO',
          value: `${Math.round(rep.producaoPhysicalTotals?.totalConfirmedStockKg ?? 0).toLocaleString('pt-BR')} kg (${rep.producaoPhysicalTotals?.silosCount ?? 0} silos)`,
        },
        {
          label: 'Capacidade Segura Total',
          value: `${Math.round(rep.currentTotals.totalSafeCapacityKg).toLocaleString('pt-BR')} kg`,
        },
      ];
    }
  } else if (params.reportType === 'RUBRICAGEM_DIARIA') {
    const comp = await getDailyRubricagemComparisonReport({
      referenceDate: params.filters?.historicalDate || params.filters?.endDate,
      siloId: params.filters?.siloId,
      materialId: params.filters?.materialId,
      lineCode: params.filters?.lineCode,
    });
    reportTitle = `Relatório Comparativo Diário de Rubricagem (${formatIsoDatePtBr(comp.referenceDate)})`;
    dataOrigin = comp.dataOrigin;
    columns = [
      { key: 'grupoModelo', header: 'Grupo / Modelo', width: 22 },
      { key: 'siloNumber', header: 'Silo', width: 9 },
      { key: 'lineCode', header: 'Linha', width: 8 },
      { key: 'material', header: 'Matéria-Prima', width: 24 },
      { key: 'previousRubricagemTons', header: 'Rubric. Ant. (t)', width: 14, align: 'right' },
      { key: 'newRubricagemTons', header: 'Nova Rubric. (t)', width: 14, align: 'right' },
      { key: 'variationTons', header: 'Variação (t)', width: 13, align: 'right' },
      { key: 'variationPct', header: 'Variação (%)', width: 12, align: 'right' },
      { key: 'previousCountAt', header: 'Data Anterior', width: 16 },
      { key: 'currentCountAt', header: 'Data Atual', width: 16 },
      { key: 'conferenceStatus', header: 'Situação Conferência', width: 22 },
      { key: 'activeStockTons', header: 'Saldo Ativo (t)', width: 14, align: 'right' },
    ];
    const fmtAt = (iso: string | null) =>
      iso ? new Date(iso).toLocaleString('pt-BR') : 'Sem registro';
    const mapRow = (r: (typeof comp.moegaContinuousSection.rows)[number]) => ({
      grupoModelo:
        r.controlOwner === 'PRODUCAO'
          ? 'PRODUÇÃO (Físico Diário)'
          : 'MOEGA (Contínuo / Conferência)',
      siloNumber: `Silo ${r.siloNumber}`,
      lineCode: r.lineCode,
      material: r.materialDescription || r.materialCode || 'Sem MP',
      previousRubricagemTons:
        r.previousRubricagemKg !== null ? Number((r.previousRubricagemKg / 1000).toFixed(2)) : '—',
      newRubricagemTons:
        r.newRubricagemKg !== null ? Number((r.newRubricagemKg / 1000).toFixed(2)) : '—',
      variationTons: r.variationTons !== null ? Number(r.variationTons.toFixed(2)) : '—',
      variationPct: r.variationPct !== null ? `${r.variationPct.toFixed(2)}%` : '—',
      previousCountAt: fmtAt(r.previousCountAt),
      currentCountAt: fmtAt(r.currentCountAt),
      conferenceStatus: RUBRICAGEM_STATUS_META[r.conferenceStatus]?.label || r.conferenceStatus,
      activeStockTons: Number((r.activeStockKg / 1000).toFixed(2)),
    });
    rows = [
      ...comp.moegaContinuousSection.rows.map(mapRow),
      ...comp.producaoPhysicalSection.rows.map(mapRow),
    ];
    totalsSummary = [
      {
        label: 'ESTOQUE CONTÍNUO DA MOEGA (Livro Razão)',
        value: `${(comp.moegaContinuousSection.totalLedgerStockKg / 1000).toFixed(2)} t (${comp.moegaContinuousSection.divergenceCount} divergência(s))`,
      },
      {
        label: 'ESTOQUE FÍSICO DIÁRIO DA PRODUÇÃO (Confirmado)',
        value: `${(comp.producaoPhysicalSection.totalConfirmedPhysicalKg / 1000).toFixed(2)} t (${comp.producaoPhysicalSection.confirmedCount} confirmado(s) / ${comp.producaoPhysicalSection.pendingAuthorizationCount} pendente(s))`,
      },
    ];
  } else if (params.reportType === 'TRANSFERENCIAS') {
    const rep = await getTransfersReport(params.filters);
    reportTitle = 'Relatório Operacional de Transferências entre Silos';
    dataOrigin = rep.dataOrigin;
    columns = [
      { key: 'orderCode', header: 'Ordem', width: 17 },
      { key: 'operationalDate', header: 'Data Op.', width: 12 },
      { key: 'shiftCode', header: 'Turno', width: 10 },
      { key: 'originSiloNumber', header: 'Origem', width: 10 },
      { key: 'destinationSiloNumber', header: 'Destino', width: 10 },
      { key: 'materialCode', header: 'Código MP', width: 14 },
      { key: 'lotCode', header: 'Lote', width: 13 },
      { key: 'plannedQuantityKg', header: 'Planejado (kg)', width: 14, align: 'right' },
      { key: 'transferredQuantityKg', header: 'Realizado (kg)', width: 14, align: 'right' },
      { key: 'pendingQuantityKg', header: 'Pendente (kg)', width: 13, align: 'right' },
      ...(isRestrictedProfile ? [] : [{ key: 'operatorName', header: 'Responsável', width: 18 }]),
      { key: 'status', header: 'Status', width: 13 },
    ];
    rows = rep.rows.map((r) => ({
      ...r,
      originSiloNumber: r.originSiloNumber ? `Silo ${r.originSiloNumber}` : '-',
      destinationSiloNumber: r.destinationSiloNumber ? `Silo ${r.destinationSiloNumber}` : '-',
      plannedQuantityKg: Math.round(r.plannedQuantityKg),
      transferredQuantityKg: Math.round(r.transferredQuantityKg),
      pendingQuantityKg: Math.round(r.pendingQuantityKg),
    }));
    totalsSummary = [
      { label: 'Total de Ordens', value: String(rep.totals.count) },
      { label: 'Volume Planejado', value: `${Math.round(rep.totals.plannedKg).toLocaleString('pt-BR')} kg` },
      { label: 'Volume Transferido', value: `${Math.round(rep.totals.transferredKg).toLocaleString('pt-BR')} kg` },
      { label: 'Concluídas / Parciais / Interrompidas', value: `${rep.totals.completedCount} / ${rep.totals.partialCount} / ${rep.totals.interruptedCount}` },
    ];
  } else if (params.reportType === 'CONSUMO') {
    const rep = await getConsumptionAndScheduleReport(params.filters);
    reportTitle = 'Relatório de Programação e Consumo (Previsto vs Realizado)';
    dataOrigin = rep.dataOrigin;
    columns = [
      { key: 'scheduleCode', header: 'Programação', width: 17 },
      { key: 'revisionNumber', header: 'Rev.', width: 7 },
      { key: 'referenceDate', header: 'Data Ref.', width: 12 },
      { key: 'lineCode', header: 'Linha', width: 8 },
      { key: 'productCode', header: 'Produto', width: 14 },
      { key: 'materialCode', header: 'Código MP', width: 14 },
      { key: 'plannedConsumptionKg', header: 'Previsto (kg)', width: 14, align: 'right' },
      { key: 'realizedConsumptionKg', header: 'Realizado (kg)', width: 14, align: 'right' },
      { key: 'realStockKg', header: 'Estoque Real (kg)', width: 15, align: 'right' },
      { key: 'projectedBalanceKg', header: 'Saldo Proj. (kg)', width: 15, align: 'right' },
      { key: 'originSource', header: 'Origem Cálculo', width: 22 },
    ];
    rows = rep.rows.map((r) => ({
      scheduleCode: r.scheduleCode,
      revisionNumber: r.revisionNumber,
      referenceDate: r.referenceDate,
      lineCode: r.lineCode,
      productCode: r.productCode,
      materialCode: r.materialCode,
      plannedConsumptionKg: Math.round(r.plannedConsumptionKg),
      realizedConsumptionKg: r.realizedConsumptionKg !== null ? Math.round(r.realizedConsumptionKg) : 'Não informado',
      realStockKg: Math.round(r.realStockKg),
      projectedBalanceKg: Math.round(r.projectedBalanceKg),
      originSource: r.originSource,
    }));
    totalsSummary = [
      { label: 'Consumo Previsto Total', value: `${Math.round(rep.totals.plannedConsumptionKg).toLocaleString('pt-BR')} kg` },
      {
        label: 'Consumo Realizado Total',
        value:
          rep.totals.realizedConsumptionKg !== null
            ? `${Math.round(rep.totals.realizedConsumptionKg).toLocaleString('pt-BR')} kg`
            : 'Dado não informado',
      },
      { label: 'Itens Pendentes de Fator', value: String(rep.totals.pendingFactorCount) },
    ];
  } else if (params.reportType === 'TURNO') {
    const shiftCode = params.shiftCode || 'TURNO_1';
    const opDate = params.operationalDate || bounds.endDate;
    const [summary, handovers] = await Promise.all([
      buildShiftAutoSummary(shiftCode, opDate),
      listShiftHandovers(),
    ]);
    const matchingHandover = handovers.find(
      (h) => h.shiftCode === shiftCode && h.operationalDate === opDate
    );
    const fullText =
      matchingHandover?.editedReportText ||
      matchingHandover?.autoReportText ||
      buildMoegaShiftNarrativeReport({
        summary,
        handoverByName: matchingHandover?.handoverByName || actor.displayName,
        handoverByBadge: matchingHandover?.handoverByBadge || actor.badgeCode,
        receivedByName: matchingHandover?.receivedByName || null,
        supplements: matchingHandover?.supplements || [],
      });
    reportTitle = `Relatório Oficial do Turno — ${summary.shiftName} (${formatIsoDatePtBr(opDate)})`;
    dataOrigin = 'PostgreSQL — Operações consolidadas e Relatório Narrativo do Turno';
    columns = [
      { key: 'timeLabel', header: 'Horário / Seção', width: 14 },
      { key: 'category', header: 'Categoria', width: 20 },
      { key: 'summary', header: 'Registro Cronológico / Texto Oficial', width: 74 },
    ];
    const textParagraphs = fullText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p, idx) => ({
        timeLabel: `§ ${idx + 1}`,
        category: 'Narrativa Oficial',
        summary: p.replace(/\*\*/g, ''),
      }));
    rows =
      textParagraphs.length > 0
        ? textParagraphs
        : summary.chronologicalEvents.map((ev) => ({
            timeLabel: ev.timeLabel,
            category: ev.category,
            summary: ev.summary,
          }));
    const vCount = summary.vehicleBreakdown?.totalCountedVehicles ?? 0;
    const cCount = summary.vehicleBreakdown?.carryoverFinalizedVehicles.length ?? 0;
    totalsSummary = [
      { label: 'Veículos Descarregados pelo Turno', value: `${vCount} veículo(s)` },
      { label: 'Concluídos de Turno Anterior (não contados)', value: `${cCount} veículo(s)` },
      { label: 'Recebimentos Vinculados no Turno', value: `${summary.receiptsCount} (${Math.round(summary.receivedKg).toLocaleString('pt-BR')} kg)` },
      { label: 'Transferências Executadas', value: `${summary.transfersCompletedCount} (${Math.round(summary.transfersCompletedKg).toLocaleString('pt-BR')} kg)` },
      { label: 'Descargas Parciais Pendentes', value: String(summary.partialDischargesCount) },
      { label: 'Ocorrências Abertas', value: String(summary.openOccurrencesCount) },
    ];
  } else {
    // INDICADORES ou DESEMPENHO
    const overview = await getOperationalIndicatorsOverview(params.filters);
    reportTitle =
      params.reportType === 'DESEMPENHO'
        ? 'Indicadores Reais de Desempenho Operacional'
        : 'Painel Geral de Indicadores Operacionais';
    dataOrigin = overview.dataOrigin;
    columns = [
      { key: 'indicador', header: 'Indicador Operacional', width: 42 },
      { key: 'valor', header: 'Valor Real Medido', width: 24, align: 'right' },
      { key: 'observacao', header: 'Observação / Origem', width: 44 },
    ];
    const kpi = overview.performanceKpis;
    rows = [
      { indicador: 'Estoque real total confirmado', valor: `${Math.round(overview.indicators.totalConfirmedStockKg).toLocaleString('pt-BR')} kg`, observacao: 'Soma do livro razão imutável' },
      { indicador: 'Volume total recebido no período', valor: `${Math.round(kpi.receivedVolumeKg).toLocaleString('pt-BR')} kg`, observacao: `${kpi.receiptsCount} recebimento(s)` },
      { indicador: 'Volume total distribuído em silos', valor: `${Math.round(kpi.distributedVolumeKg).toLocaleString('pt-BR')} kg`, observacao: `${kpi.partialDischargesCount} descarga(s) parcial(is)` },
      { indicador: 'Volume total transferido entre silos', valor: `${Math.round(kpi.transferredVolumeKg).toLocaleString('pt-BR')} kg`, observacao: `${overview.indicators.transfersCompletedCount} ordem(ns) concluída(s)` },
      {
        indicador: 'Tempo médio de recebimento',
        valor: kpi.avgReceiptDurationMinutes !== null ? `${kpi.avgReceiptDurationMinutes} min` : 'Dado não informado',
        observacao: kpi.avgReceiptDurationNote,
      },
      { indicador: 'Quantidade de ocorrências no período', valor: String(kpi.occurrencesCount), observacao: `${kpi.openOccurrencesCount} em aberto` },
      { indicador: 'Frequência de divergências', valor: String(kpi.divergencesFrequency), observacao: 'Pendências documentais + divergências' },
      { indicador: 'Frequência de alertas de falta', valor: String(kpi.shortageAlertsFrequency), observacao: 'Recomendações críticas (VERMELHO)' },
      { indicador: 'Consumo previsto no período', valor: `${Math.round(kpi.plannedConsumptionKg).toLocaleString('pt-BR')} kg`, observacao: 'Programação x fatores' },
      {
        indicador: 'Consumo realizado informado',
        valor: kpi.realizedConsumptionKg !== null ? `${Math.round(kpi.realizedConsumptionKg).toLocaleString('pt-BR')} kg` : 'Não informado',
        observacao: kpi.consumptionComparisonNote,
      },
    ];
    totalsSummary = [
      { label: 'Nota sobre Base Histórica', value: kpi.historicalBaselineNotice },
    ];
  }

  const exported = await exportReportDocument({
    format: params.format,
    reportTitle,
    reportType: params.reportType,
    periodLabel: bounds.label,
    filtersSummary,
    dataOrigin,
    generatedByName: actor.displayName,
    generatedByRole: actor.roleCode,
    generatedAtIso,
    columns,
    rows,
    totalsSummary,
  });

  // Gravar snapshot de geração e auditoria imutável
  const snapshotCode = genCode('REL');
  await db.transaction(async (tx) => {
    const existingCountRes = await tx
      .select({ count: sql<string>`COUNT(*)` })
      .from(reportSnapshots)
      .where(eq(reportSnapshots.reportType, params.reportType));
    const version = Number(existingCountRes[0]?.count || 0) + 1;

    await tx.insert(reportSnapshots).values({
      snapshotCode,
      reportType: params.reportType,
      title: reportTitle,
      format: params.format,
      periodStart: bounds.startDate,
      periodEnd: bounds.endDate,
      filtersJson: JSON.stringify(params.filters || {}),
      totalsJson: JSON.stringify(totalsSummary),
      dataOrigin,
      version,
      generatedByUserId: actor.id,
    });

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'REPORT_EXPORTED',
      entityType: 'REPORT_SNAPSHOT',
      entityId: snapshotCode,
      newValue: JSON.stringify({
        reportType: params.reportType,
        format: params.format,
        fileName: exported.fileName,
        periodStart: bounds.startDate,
        periodEnd: bounds.endDate,
        rowCount: rows.length,
        restrictedMaskApplied: isRestrictedProfile,
      }),
      reason: `Exportação de relatório ${params.reportType} em ${params.format}`,
      origin: 'CENTRAL_RELATORIOS',
    });
  });

  return exported;
}

// =========================================================================
// 5. PASSAGEM DE TURNO, RESUMO AUTOMÁTICO E CIÊNCIA DE PENDÊNCIAS
// =========================================================================

export async function buildShiftAutoSummary(
  shiftCode: string,
  operationalDate: string
): Promise<ShiftAutoSummarySnapshot> {
  const [
    shiftMetaList,
    allReceipts,
    allDists,
    silosDetail,
    matRows,
    orderRows,
    stepRows,
    shiftMovRows,
    schedulesList,
    basketList,
    recsList,
    intakeReqs,
    occRows,
    thresholds,
    userRows,
  ] = await Promise.all([
    db.select().from(shifts).where(eq(shifts.code, shiftCode)).limit(1),
    db.select().from(receipts).orderBy(receipts.createdAt),
    db.select().from(receiptDistributions).orderBy(receiptDistributions.createdAt),
    listSilosWithDetails(),
    db.select({ id: materials.id, code: materials.code, description: materials.description }).from(materials),
    db.select().from(transferOrders),
    db
      .select()
      .from(transferExecutionSteps)
      .where(
        and(
          eq(transferExecutionSteps.operationalDate, operationalDate),
          eq(transferExecutionSteps.shiftCode, shiftCode)
        )
      ),
    db
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.operationalDate, operationalDate),
          eq(inventoryMovements.shiftCode, shiftCode)
        )
      ),
    db.select().from(productionSchedules).where(eq(productionSchedules.referenceDate, operationalDate)),
    db
      .select()
      .from(consumptionBasketVersions)
      .where(eq(consumptionBasketVersions.productionDate, operationalDate)),
    db
      .select()
      .from(operationalRecommendations)
      .where(inArray(operationalRecommendations.decisionStatus, ['PENDENTE', 'EM_ANALISE'])),
    db.select().from(materialIntakeRequests).where(eq(materialIntakeRequests.status, 'ABERTA')),
    db.select().from(operationalOccurrences),
    db.select().from(materialStockThresholds),
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        badgeCode: users.badgeCode,
        jobTitle: users.jobTitle,
      })
      .from(users),
  ]);

  const shiftMeta = shiftMetaList[0];
  const shiftName = shiftMeta
    ? formatShiftDisplayName(shiftMeta)
    : shiftCode === 'TURNO_2'
      ? '2º Turno (17:00–02:12)'
      : shiftCode === 'TURNO_3'
        ? '3º Turno (23:28–07:30)'
        : '1º Turno (07:30–17:18)';

  const matMap = new Map(matRows.map((m) => [m.id, m]));
  const siloMap = new Map(silosDetail.map((s) => [s.id, s]));
  const orderMap = new Map(orderRows.map((o) => [o.id, o]));
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  const validAllDists = allDists.filter((d) => d.status !== 'ESTORNADA');
  const distsByReceipt = new Map<number, typeof validAllDists>();
  for (const d of validAllDists) {
    const arr = distsByReceipt.get(d.receiptId) ?? [];
    arr.push(d);
    distsByReceipt.set(d.receiptId, arr);
  }

  // Distribuições ocorridas especificamente neste turno/data operacional
  const shiftDistRows = validAllDists.filter(
    (d) => d.operationalDate === operationalDate && d.shiftCode === shiftCode
  );
  const receiptIdsTouchedInShift = new Set<number>(shiftDistRows.map((d) => d.receiptId));

  // Recebimentos iniciados, finalizados ou movimentados neste turno/data operacional
  const recRows = allReceipts.filter((r) => {
    const startShift = r.startedShiftCode || r.shiftCode;
    const startDate = r.startedOperationalDate || r.operationalDate;
    const finShift = r.finishedShiftCode || (r.status === 'CONCLUIDO' ? r.shiftCode : null);
    const finDate = r.finishedOperationalDate || (r.status === 'CONCLUIDO' ? r.operationalDate : null);
    return (
      (startShift === shiftCode && startDate === operationalDate) ||
      (finShift === shiftCode && finDate === operationalDate) ||
      receiptIdsTouchedInShift.has(r.id)
    );
  });

  // Monta estrutura de classificação rigorosa de veículos
  const vehicleInputs: VehicleReceiptInput[] = allReceipts.map((r) => {
    const mat = matMap.get(r.materialId);
    const op = userMap.get(r.operatorUserId);
    const rDists = distsByReceipt.get(r.id) ?? [];
    const rShiftDists = rDists.filter(
      (d) => d.operationalDate === operationalDate && d.shiftCode === shiftCode
    );
    const siloNums = Array.from(
      new Set(
        (rShiftDists.length > 0 ? rShiftDists : rDists)
          .map((d) => siloMap.get(d.siloId)?.siloNumber)
          .filter((n): n is number => Boolean(n))
      )
    );
    const startShift = r.startedShiftCode || r.shiftCode;
    const startDate = r.startedOperationalDate || r.operationalDate;
    const finShift = r.finishedShiftCode || (r.status === 'CONCLUIDO' ? r.shiftCode : null);
    const finDate = r.finishedOperationalDate || (r.status === 'CONCLUIDO' ? r.operationalDate : null);

    return {
      receiptId: r.id,
      receiptNumber: r.receiptNumber,
      materialId: r.materialId,
      materialCode: mat?.code || 'N/I',
      materialDescription: mat?.description || 'Material não identificado',
      supplierName: r.supplierName,
      invoiceNumber: r.invoiceNumber,
      vehiclePlate: r.vehiclePlate,
      driverName: r.driverName,
      carrierName: r.carrierName,
      receivingType: r.receivingType,
      bagCount: r.bagCount,
      receivedKg: Number(r.receivedQuantityKg),
      distributedKgTotal: Number(r.distributedQuantityKg),
      distributedInShiftKg: rShiftDists.reduce((acc, d) => acc + Number(d.quantityKg), 0),
      status: r.status,
      startedAtIso: r.startedAt.toISOString(),
      finishedAtIso: r.finishedAt ? r.finishedAt.toISOString() : null,
      startedShiftCode: startShift,
      startedOperationalDate: startDate,
      finishedShiftCode: finShift,
      finishedOperationalDate: finDate,
      siloNumbers: siloNums,
      operatorName: op?.displayName || 'Operador não identificado',
      operatorBadge: op?.badgeCode ?? null,
      executedByName: r.executedByName ?? null,
      executedByBadge: r.executedByBadge ?? null,
    };
  });

  const vehicleBreakdown = classifyShiftVehicles({
    shiftCode,
    operationalDate,
    receipts: vehicleInputs,
  });

  const receivedKg = recRows.reduce((a, r) => a + Number(r.receivedQuantityKg), 0);
  const distributedKg = shiftDistRows.reduce((a, d) => a + Number(d.quantityKg), 0);
  const bagCutCount = recRows
    .filter((r) => r.receivingType === 'BIG_BAG' && r.bagCount)
    .reduce((a, r) => a + Number(r.bagCount || 0), 0);

  const vehiclesOrInvoices = Array.from(
    new Set(
      recRows.map((r) => {
        const plate = r.vehiclePlate ? ` · Placa ${r.vehiclePlate}` : '';
        return r.invoiceNumber
          ? `NF ${r.invoiceNumber} (${r.supplierName}${plate})`
          : `${r.receiptNumber} (${r.supplierName}${plate})`;
      })
    )
  );

  const matAgg = new Map<number, number>();
  for (const r of recRows) {
    matAgg.set(r.materialId, (matAgg.get(r.materialId) ?? 0) + Number(r.receivedQuantityKg));
  }
  const materialsReceived = Array.from(matAgg.entries()).map(([mId, kg]) => {
    const m = matMap.get(mId);
    return { code: m?.code || 'N/I', description: m?.description || 'N/I', kg };
  });

  const allRecById = new Map(allReceipts.map((r) => [r.id, r]));
  const siloFedAgg = new Map<number, { siloNumber: number; kg: number; materialCode: string }>();
  for (const d of shiftDistRows) {
    const s = siloMap.get(d.siloId);
    const rec = allRecById.get(d.receiptId);
    const mat = rec ? matMap.get(rec.materialId) : null;
    if (!s) continue;
    const prev = siloFedAgg.get(s.id) ?? {
      siloNumber: s.siloNumber,
      kg: 0,
      materialCode: mat?.code || s.materialCode || 'N/I',
    };
    prev.kg += Number(d.quantityKg);
    siloFedAgg.set(s.id, prev);
  }

  const completedSteps = stepRows.filter((st) => st.status !== 'ESTORNADA');
  const transfersCompletedKg = completedSteps.reduce((a, st) => a + Number(st.quantityKg), 0);
  const pendingTransfers = orderRows.filter((o) =>
    ['PLANEJADA', 'EM_ANDAMENTO', 'PARCIAL'].includes(o.status)
  );

  // Ajustes de estoque autorizados no turno
  const confirmedShiftMovs = shiftMovRows.filter((m) => m.status === 'CONFIRMADO');
  const stockAdjustments = confirmedShiftMovs.filter((m) => m.movementType === 'AJUSTE_AUTORIZADO');
  const stockAdjustmentsSummary = stockAdjustments.map((a) => {
    const s = siloMap.get(a.siloId);
    const m = matMap.get(a.materialId);
    const sign = a.direction === 'CREDIT' ? '+' : '-';
    return `Silo ${s?.siloNumber ?? '?'} (${m?.code || 'N/I'}): ${sign}${Math.round(Number(a.quantityKg)).toLocaleString('pt-BR')} kg — ${a.reason || 'Ajuste autorizado'}`;
  });

  const allPartialReceipts = allReceipts.filter((r) => r.status === 'PARCIAL' || r.status === 'PENDENTE');

  // Estoques críticos
  const stockByMat = new Map<number, number>();
  for (const s of silosDetail) {
    if (s.primaryMaterialId) {
      stockByMat.set(s.primaryMaterialId, (stockByMat.get(s.primaryMaterialId) ?? 0) + s.confirmedStockKg);
    }
  }
  const criticalStocks: ShiftAutoSummarySnapshot['criticalStocks'] = [];
  for (const th of thresholds) {
    const real = stockByMat.get(th.materialId) ?? 0;
    const min = Number(th.minStockKg);
    if (real <= min) {
      const m = matMap.get(th.materialId);
      criticalStocks.push({
        materialCode: m?.code || 'N/I',
        description: m?.description || 'N/I',
        realStockKg: real,
        minStockKg: min,
      });
    }
  }

  const openOccs = occRows.filter((o) => o.status !== 'ENCERRADA');
  const shiftOccs = occRows.filter(
    (o) => o.operationalDate === operationalDate && o.shiftCode === shiftCode
  );
  const unavailableSilos = silosDetail
    .filter((s) => s.operationalStatus !== 'OPERACIONAL')
    .map((s) => ({
      siloNumber: s.siloNumber,
      operationalStatus: s.operationalStatus,
      restrictions: s.restrictions,
    }));

  // Operadores envolvidos neste turno (automático pela conta autenticada)
  const operatorIdSet = new Set<number>();
  for (const r of recRows) operatorIdSet.add(r.operatorUserId);
  for (const d of shiftDistRows) operatorIdSet.add(d.operatorUserId);
  for (const st of completedSteps) operatorIdSet.add(st.executedByUserId);
  for (const m of confirmedShiftMovs) operatorIdSet.add(m.performedByUserId);
  for (const o of shiftOccs) operatorIdSet.add(o.reportedByUserId);
  const shiftOperators = Array.from(operatorIdSet)
    .map((uid) => userMap.get(uid))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({
      displayName: u.displayName,
      badgeCode: u.badgeCode,
      jobTitle: u.jobTitle,
    }));

  // Linha do tempo cronológica
  const chronologicalEvents: ShiftAutoSummarySnapshot['chronologicalEvents'] = [];
  for (const r of recRows) {
    const m = matMap.get(r.materialId);
    const op = userMap.get(r.operatorUserId);
    const plateTxt = r.vehiclePlate ? ` · Placa ${r.vehiclePlate}` : '';
    const opTxt = r.executedByName
      ? ` · Execução: ${r.executedByName} (Lançamento: ${op?.displayName || 'Operador'})`
      : op
        ? ` · Op.: ${op.displayName}${op.badgeCode ? ` (${op.badgeCode})` : ''}`
        : '';
    chronologicalEvents.push({
      timestampIso: r.createdAt.toISOString(),
      timeLabel: r.createdAt.toISOString().slice(11, 16),
      category: 'Recebimento',
      summary: `${r.receiptNumber}${plateTxt}: ${m?.code || ''} ${m?.description || ''} (${Math.round(Number(r.receivedQuantityKg)).toLocaleString('pt-BR')} kg, Lote ${r.lotCode}, Status ${r.status}${opTxt}).`,
    });
  }
  for (const st of completedSteps) {
    const ord = orderMap.get(st.transferOrderId);
    const orig = ord ? siloMap.get(ord.originSiloId)?.siloNumber : null;
    const dest = ord ? siloMap.get(ord.destinationSiloId)?.siloNumber : null;
    const mat = ord ? matMap.get(ord.materialId) : null;
    const exec = st.executedByName || userMap.get(st.executedByUserId)?.displayName || 'Operador';
    chronologicalEvents.push({
      timestampIso: st.createdAt.toISOString(),
      timeLabel: st.createdAt.toISOString().slice(11, 16),
      category: 'Transferência',
      summary: `${ord?.orderCode || 'Transf.'}: Silo ${orig ?? '?'} → Silo ${dest ?? '?'} (${mat?.description || 'Material'}, ${Math.round(Number(st.quantityKg)).toLocaleString('pt-BR')} kg, Op. ${exec}).`,
    });
  }
  for (const adj of stockAdjustments) {
    const s = siloMap.get(adj.siloId);
    const m = matMap.get(adj.materialId);
    const sign = adj.direction === 'CREDIT' ? '+' : '-';
    chronologicalEvents.push({
      timestampIso: adj.createdAt.toISOString(),
      timeLabel: adj.createdAt.toISOString().slice(11, 16),
      category: 'Ajuste de Estoque',
      summary: `Silo ${s?.siloNumber ?? '?'} (${m?.description || 'Material'}): ${sign}${Math.round(Number(adj.quantityKg)).toLocaleString('pt-BR')} kg (${adj.reason || 'Ajuste autorizado'}).`,
    });
  }
  for (const o of shiftOccs) {
    chronologicalEvents.push({
      timestampIso: o.occurredAt.toISOString(),
      timeLabel: o.occurredAt.toISOString().slice(11, 16),
      category: 'Ocorrência',
      summary: `${o.occurrenceCode} [${o.category}]: ${o.title} (${o.status}).`,
    });
  }
  chronologicalEvents.sort((a, b) => a.timestampIso.localeCompare(b.timestampIso));

  return {
    shiftCode,
    shiftName,
    operationalDate,
    generatedAtIso: new Date().toISOString(),
    receiptsCount: recRows.length,
    receivedKg: Math.round(receivedKg * 1000) / 1000,
    distributedKg: Math.round(distributedKg * 1000) / 1000,
    vehiclesOrInvoices,
    materialsReceived,
    silosFed: Array.from(siloFedAgg.values()),
    transfersCompletedCount: completedSteps.length,
    transfersCompletedKg: Math.round(transfersCompletedKg * 1000) / 1000,
    transfersPendingCount: pendingTransfers.length,
    transfersPendingCodes: pendingTransfers.map((p) => `${p.orderCode} (${p.status})`),
    partialDischargesCount: allPartialReceipts.length,
    partialReceiptNumbers: allPartialReceipts.map((p) => p.receiptNumber),
    criticalStocks,
    updatedSchedules: schedulesList.map((s) => ({
      scheduleCode: s.scheduleCode,
      revisionNumber: s.revisionNumber,
      status: s.status,
    })),
    activeAlertsCount: recsList.length,
    activeAlertsList: recsList.slice(0, 6).map((r) => `${r.priority}: ${r.title}`),
    openSupplyRequestsCount: intakeReqs.length,
    openOccurrencesCount: openOccs.length,
    openOccurrencesList: openOccs.slice(0, 8).map((o) => `${o.occurrenceCode} (${o.category}): ${o.title}`),
    unavailableSilos,
    chronologicalEvents,
    vehicleBreakdown,
    shiftOperators,
    stockAdjustmentsCount: stockAdjustments.length,
    stockAdjustmentsSummary,
    bagCutCount,
    basketUpdates: basketList.map((b) => ({
      versionCode: b.versionCode,
      label: b.label,
      productionDate: b.productionDate,
      status: b.status,
    })),
    shiftOccurrences: shiftOccs.map((o) => ({
      occurrenceCode: o.occurrenceCode,
      timeLabel: o.occurredAt.toISOString().slice(11, 16),
      category: o.category,
      title: o.title,
      description: o.description,
      status: o.status,
      weatherCondition: o.weatherCondition ?? null,
      lineImpact: o.lineImpact ?? null,
      verifiedByName: o.verifiedByUserId ? userMap.get(o.verifiedByUserId)?.displayName ?? null : null,
      reportedByName: userMap.get(o.reportedByUserId)?.displayName || 'Operador',
    })),
    movementsTotalCount: confirmedShiftMovs.length + shiftOccs.length,
  };
}

function mapHandoverRows(
  handovers: Array<typeof shiftHandovers.$inferSelect>,
  pendencies: Array<typeof shiftHandoverPendencies.$inferSelect>,
  revisions: Array<typeof shiftHandoverRevisions.$inferSelect>,
  userMap: Map<number, { displayName: string; badgeCode: string | null }>
): ShiftHandoverView[] {
  const pendByHandover = new Map<number, ShiftHandoverPendencyView[]>();
  const revByHandover = new Map<number, ShiftHandoverRevisionItem[]>();
  const handoverMap = new Map(handovers.map((h) => [h.id, h]));

  for (const p of pendencies) {
    const h = handoverMap.get(p.handoverId);
    const list = pendByHandover.get(p.handoverId) ?? [];
    list.push({
      id: p.id,
      pendencyCode: p.pendencyCode,
      handoverId: p.handoverId,
      handoverCode: h?.handoverCode || 'N/I',
      shiftCode: h?.shiftCode || 'N/I',
      operationalDate: h?.operationalDate || 'N/I',
      sourceType: p.sourceType,
      sourceEntityId: p.sourceEntityId,
      title: p.title,
      description: p.description,
      priority: p.priority as ShiftHandoverPendencyView['priority'],
      status: p.status as ShiftHandoverPendencyView['status'],
      acknowledgedByName: p.acknowledgedByUserId ? userMap.get(p.acknowledgedByUserId)?.displayName ?? null : null,
      acknowledgedAt: p.acknowledgedAt ? p.acknowledgedAt.toISOString() : null,
      acknowledgmentNote: p.acknowledgmentNote,
      resolvedByName: p.resolvedByUserId ? userMap.get(p.resolvedByUserId)?.displayName ?? null : null,
      resolvedAt: p.resolvedAt ? p.resolvedAt.toISOString() : null,
      resolutionNotes: p.resolutionNotes,
      createdAt: p.createdAt.toISOString(),
    });
    pendByHandover.set(p.handoverId, list);
  }

  for (const rev of revisions) {
    const list = revByHandover.get(rev.handoverId) ?? [];
    list.push({
      id: rev.id,
      handoverId: rev.handoverId,
      version: rev.version,
      workflowStatus: rev.workflowStatus as ShiftWorkflowStatus,
      changeType: rev.changeType,
      reportText: rev.reportText,
      aiCommand: rev.aiCommand,
      reason: rev.reason,
      editedByUserId: rev.editedByUserId,
      editedByName: rev.editedByName,
      editedByBadge: rev.editedByBadge,
      createdAt: rev.createdAt.toISOString(),
    });
    revByHandover.set(rev.handoverId, list);
  }

  return handovers.map((h) => {
    let autoSummary: ShiftAutoSummarySnapshot;
    try {
      autoSummary = JSON.parse(h.autoSummarySnapshotJson);
    } catch {
      autoSummary = {
        shiftCode: h.shiftCode,
        shiftName: h.shiftName,
        operationalDate: h.operationalDate,
        generatedAtIso: h.createdAt.toISOString(),
        receiptsCount: 0,
        receivedKg: 0,
        distributedKg: 0,
        vehiclesOrInvoices: [],
        materialsReceived: [],
        silosFed: [],
        transfersCompletedCount: 0,
        transfersCompletedKg: 0,
        transfersPendingCount: 0,
        transfersPendingCodes: [],
        partialDischargesCount: 0,
        partialReceiptNumbers: [],
        criticalStocks: [],
        updatedSchedules: [],
        activeAlertsCount: 0,
        activeAlertsList: [],
        openSupplyRequestsCount: 0,
        openOccurrencesCount: 0,
        openOccurrencesList: [],
        unavailableSilos: [],
        chronologicalEvents: [],
      };
    }

    let supplements: ShiftManualSupplement[] = [];
    try {
      const parsedSup = JSON.parse(h.supplementsJson || '[]');
      if (Array.isArray(parsedSup)) supplements = parsedSup;
    } catch {
      supplements = [];
    }

    let vehicleBreakdown = autoSummary.vehicleBreakdown ?? null;
    try {
      const parsedVb = JSON.parse(h.vehicleSummaryJson || '{}');
      if (parsedVb && Array.isArray(parsedVb.countedVehicles)) {
        vehicleBreakdown = parsedVb;
      }
    } catch {
      // mantém fallback do snapshot
    }

    const wfStatus: ShiftWorkflowStatus =
      (h.workflowStatus as ShiftWorkflowStatus) ||
      (h.status === 'FINALIZADA'
        ? 'ENCERRADO'
        : h.status === 'REVISAO'
          ? 'AGUARDANDO_CONFERENCIA'
          : 'EM_ELABORACAO');

    const handoverAuthor = userMap.get(h.handoverByUserId);

    return {
      id: h.id,
      handoverCode: h.handoverCode,
      shiftCode: h.shiftCode,
      shiftName: h.shiftName,
      operationalDate: h.operationalDate,
      status: h.status as ShiftHandoverView['status'],
      workflowStatus: wfStatus,
      autoSummary,
      shiftSummaryText: h.shiftSummaryText,
      relevantOccurrencesText: h.relevantOccurrencesText,
      pendenciesText: h.pendenciesText,
      requiredActionsText: h.requiredActionsText,
      nextShiftRecommendationsText: h.nextShiftRecommendationsText,
      autoReportText: h.autoReportText,
      editedReportText: h.editedReportText,
      supplements,
      vehicleBreakdown,
      aiEditCount: h.aiEditCount ?? 0,
      lastAiCommand: h.lastAiCommand ?? null,
      handoverByUserId: h.handoverByUserId,
      handoverByName: handoverAuthor?.displayName || 'Dado não informado',
      handoverByBadge: handoverAuthor?.badgeCode ?? null,
      receivedByUserId: h.receivedByUserId,
      receivedByName:
        h.receivedByName ||
        (h.receivedByUserId ? userMap.get(h.receivedByUserId)?.displayName ?? null : null),
      reviewedByName: h.reviewedByUserId ? userMap.get(h.reviewedByUserId)?.displayName ?? null : null,
      approvedByName: h.approvedByUserId ? userMap.get(h.approvedByUserId)?.displayName ?? null : null,
      approvedAt: h.approvedAt ? h.approvedAt.toISOString() : null,
      approvalNotes: h.approvalNotes ?? null,
      finalizedByName: h.finalizedByUserId ? userMap.get(h.finalizedByUserId)?.displayName ?? null : null,
      finalizedAt: h.finalizedAt ? h.finalizedAt.toISOString() : null,
      closedAt: h.closedAt ? h.closedAt.toISOString() : null,
      version: h.version,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
      pendencies: pendByHandover.get(h.id) ?? [],
      revisions: revByHandover.get(h.id) ?? [],
    };
  });
}

export async function listShiftHandovers(): Promise<ShiftHandoverView[]> {
  const [handovers, pendencies, revisions, userRows] = await Promise.all([
    db.select().from(shiftHandovers).orderBy(desc(shiftHandovers.createdAt)).limit(50),
    db.select().from(shiftHandoverPendencies).orderBy(desc(shiftHandoverPendencies.createdAt)),
    db.select().from(shiftHandoverRevisions).orderBy(desc(shiftHandoverRevisions.version)),
    db.select({ id: users.id, displayName: users.displayName, badgeCode: users.badgeCode }).from(users),
  ]);
  const userMap = new Map(userRows.map((u) => [u.id, { displayName: u.displayName, badgeCode: u.badgeCode }]));
  return mapHandoverRows(handovers, pendencies, revisions, userMap);
}

export async function listOpenShiftPendencies(): Promise<ShiftHandoverPendencyView[]> {
  const [handovers, pendencies, userRows] = await Promise.all([
    db.select().from(shiftHandovers),
    db
      .select()
      .from(shiftHandoverPendencies)
      .where(inArray(shiftHandoverPendencies.status, ['ABERTA', 'CIENTE']))
      .orderBy(desc(shiftHandoverPendencies.createdAt)),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
  ]);
  const userMap = new Map(userRows.map((u) => [u.id, u.displayName]));
  const handoverMap = new Map(handovers.map((h) => [h.id, h]));

  return pendencies.map((p) => {
    const h = handoverMap.get(p.handoverId);
    return {
      id: p.id,
      pendencyCode: p.pendencyCode,
      handoverId: p.handoverId,
      handoverCode: h?.handoverCode || 'N/I',
      shiftCode: h?.shiftCode || 'N/I',
      operationalDate: h?.operationalDate || 'N/I',
      sourceType: p.sourceType,
      sourceEntityId: p.sourceEntityId,
      title: p.title,
      description: p.description,
      priority: p.priority as ShiftHandoverPendencyView['priority'],
      status: p.status as ShiftHandoverPendencyView['status'],
      acknowledgedByName: p.acknowledgedByUserId ? userMap.get(p.acknowledgedByUserId) ?? null : null,
      acknowledgedAt: p.acknowledgedAt ? p.acknowledgedAt.toISOString() : null,
      acknowledgmentNote: p.acknowledgmentNote,
      resolvedByName: p.resolvedByUserId ? userMap.get(p.resolvedByUserId) ?? null : null,
      resolvedAt: p.resolvedAt ? p.resolvedAt.toISOString() : null,
      resolutionNotes: p.resolutionNotes,
      createdAt: p.createdAt.toISOString(),
    };
  });
}

function resolveLegacyStatusFromWorkflow(
  workflowStatus?: ShiftWorkflowStatus,
  legacyInput?: 'RASCUNHO' | 'REVISAO'
): { legacy: 'RASCUNHO' | 'REVISAO'; workflow: ShiftWorkflowStatus } {
  if (workflowStatus === 'AGUARDANDO_APROVACAO') {
    return { legacy: 'REVISAO', workflow: 'AGUARDANDO_APROVACAO' };
  }
  if (workflowStatus === 'AGUARDANDO_CONFERENCIA' || legacyInput === 'REVISAO') {
    return { legacy: 'REVISAO', workflow: 'AGUARDANDO_CONFERENCIA' };
  }
  return { legacy: 'RASCUNHO', workflow: 'EM_ELABORACAO' };
}

export async function saveShiftHandoverDraftTransactional(
  input: {
    id?: number;
    shiftCode: string;
    operationalDate: string;
    status?: 'RASCUNHO' | 'REVISAO';
    workflowStatus?: ShiftWorkflowStatus;
    shiftSummaryText?: string;
    relevantOccurrencesText?: string;
    pendenciesText?: string;
    requiredActionsText?: string;
    nextShiftRecommendationsText?: string;
    editedReportText?: string | null;
    aiCommand?: string | null;
    receivedByUserId?: number | null;
    receivedByName?: string | null;
  },
  actor: AuthenticatedAppUser
): Promise<ShiftHandoverView> {
  const autoSummary = await buildShiftAutoSummary(input.shiftCode, input.operationalDate);

  const savedId = await db.transaction(async (tx) => {
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(shiftHandovers)
        .where(eq(shiftHandovers.id, input.id))
        .limit(1);
      if (!existing) {
        throw new OperationalConflictError('Registro de passagem de turno não encontrado.', 404);
      }
      if (
        existing.status === 'FINALIZADA' ||
        existing.workflowStatus === 'APROVADO' ||
        existing.workflowStatus === 'ENCERRADO'
      ) {
        throw new OperationalConflictError(
          'Relatório já aprovado ou encerrado. Utilize a correção versionada pós-aprovação para preservar o histórico imutável.',
          409
        );
      }

      let existingSupplements: ShiftManualSupplement[] = [];
      try {
        existingSupplements = JSON.parse(existing.supplementsJson || '[]');
      } catch {
        existingSupplements = [];
      }

      const autoReportText = buildMoegaShiftNarrativeReport({
        summary: autoSummary,
        handoverByName: actor.displayName,
        handoverByBadge: actor.badgeCode,
        receivedByName: input.receivedByName ?? existing.receivedByName ?? null,
        shiftSummaryText: input.shiftSummaryText ?? existing.shiftSummaryText,
        relevantOccurrencesText: input.relevantOccurrencesText ?? existing.relevantOccurrencesText,
        pendenciesText: input.pendenciesText ?? existing.pendenciesText,
        requiredActionsText: input.requiredActionsText ?? existing.requiredActionsText,
        nextShiftRecommendationsText:
          input.nextShiftRecommendationsText ?? existing.nextShiftRecommendationsText,
        supplements: existingSupplements,
      });

      const { legacy, workflow } = resolveLegacyStatusFromWorkflow(input.workflowStatus, input.status);
      const nextVersion = existing.version + 1;
      const nextEditedText =
        input.editedReportText !== undefined ? input.editedReportText : existing.editedReportText;
      const effectiveReportText = (nextEditedText && nextEditedText.trim()) || autoReportText;
      const isAiEdit = Boolean(input.aiCommand && input.aiCommand.trim());

      await tx
        .update(shiftHandovers)
        .set({
          status: legacy,
          workflowStatus: workflow,
          autoSummarySnapshotJson: JSON.stringify(autoSummary),
          vehicleSummaryJson: JSON.stringify(autoSummary.vehicleBreakdown || {}),
          shiftSummaryText: input.shiftSummaryText ?? existing.shiftSummaryText,
          relevantOccurrencesText: input.relevantOccurrencesText ?? existing.relevantOccurrencesText,
          pendenciesText: input.pendenciesText ?? existing.pendenciesText,
          requiredActionsText: input.requiredActionsText ?? existing.requiredActionsText,
          nextShiftRecommendationsText:
            input.nextShiftRecommendationsText ?? existing.nextShiftRecommendationsText,
          autoReportText,
          editedReportText: nextEditedText,
          aiEditCount: isAiEdit ? (existing.aiEditCount || 0) + 1 : existing.aiEditCount || 0,
          lastAiCommand: isAiEdit ? input.aiCommand!.trim() : existing.lastAiCommand,
          receivedByUserId: input.receivedByUserId ?? existing.receivedByUserId,
          receivedByName: input.receivedByName ?? existing.receivedByName,
          reviewedByUserId:
            workflow === 'AGUARDANDO_CONFERENCIA' || workflow === 'AGUARDANDO_APROVACAO'
              ? actor.id
              : existing.reviewedByUserId,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(eq(shiftHandovers.id, existing.id));

      await tx.insert(shiftHandoverRevisions).values({
        handoverId: existing.id,
        version: nextVersion,
        workflowStatus: workflow,
        changeType: isAiEdit
          ? 'EDICAO_IA'
          : workflow !== existing.workflowStatus
            ? 'CONFERENCIA'
            : 'REVISAO_RASCUNHO',
        reportText: effectiveReportText,
        aiCommand: isAiEdit ? input.aiCommand!.trim() : null,
        reason: isAiEdit
          ? `Edição assistida por IA: ${input.aiCommand!.trim()}`
          : `Atualização de relatório (${workflow})`,
        editedByUserId: actor.id,
        editedByName: actor.displayName,
        editedByBadge: actor.badgeCode,
      });

      await tx.insert(auditEvents).values({
        userId: actor.id,
        userEmail: actor.email,
        userName: actor.displayName,
        userRole: actor.roleCode,
        action: isAiEdit ? 'SHIFT_REPORT_AI_EDITED' : 'SHIFT_HANDOVER_SAVED',
        entityType: 'SHIFT_HANDOVER',
        entityId: existing.handoverCode,
        newValue: JSON.stringify({
          status: legacy,
          workflowStatus: workflow,
          version: nextVersion,
          aiCommand: isAiEdit ? input.aiCommand : null,
        }),
        reason: isAiEdit
          ? `Edição assistida por IA: ${input.aiCommand}`
          : `Atualização de passagem de turno (${workflow})`,
        origin: 'PASSAGEM_TURNO',
      });

      return existing.id;
    }

    const autoReportText = buildMoegaShiftNarrativeReport({
      summary: autoSummary,
      handoverByName: actor.displayName,
      handoverByBadge: actor.badgeCode,
      receivedByName: input.receivedByName ?? null,
      shiftSummaryText: input.shiftSummaryText,
      relevantOccurrencesText: input.relevantOccurrencesText,
      pendenciesText: input.pendenciesText,
      requiredActionsText: input.requiredActionsText,
      nextShiftRecommendationsText: input.nextShiftRecommendationsText,
      supplements: [],
    });

    const handoverCode = genCode('PAS');
    const { legacy, workflow } = resolveLegacyStatusFromWorkflow(input.workflowStatus, input.status);
    const [inserted] = await tx
      .insert(shiftHandovers)
      .values({
        handoverCode,
        shiftCode: input.shiftCode,
        shiftName: autoSummary.shiftName,
        operationalDate: input.operationalDate,
        status: legacy,
        workflowStatus: workflow,
        autoSummarySnapshotJson: JSON.stringify(autoSummary),
        vehicleSummaryJson: JSON.stringify(autoSummary.vehicleBreakdown || {}),
        shiftSummaryText: input.shiftSummaryText ?? '',
        relevantOccurrencesText: input.relevantOccurrencesText ?? '',
        pendenciesText: input.pendenciesText ?? '',
        requiredActionsText: input.requiredActionsText ?? '',
        nextShiftRecommendationsText: input.nextShiftRecommendationsText ?? '',
        autoReportText,
        editedReportText: input.editedReportText ?? null,
        supplementsJson: '[]',
        aiEditCount: input.aiCommand ? 1 : 0,
        lastAiCommand: input.aiCommand ?? null,
        handoverByUserId: actor.id,
        receivedByUserId: input.receivedByUserId ?? null,
        receivedByName: input.receivedByName ?? null,
        reviewedByUserId:
          workflow === 'AGUARDANDO_CONFERENCIA' || workflow === 'AGUARDANDO_APROVACAO' ? actor.id : null,
      })
      .returning();

    await tx.insert(shiftHandoverRevisions).values({
      handoverId: inserted.id,
      version: 1,
      workflowStatus: workflow,
      changeType: 'AUTO_GERADA',
      reportText: (input.editedReportText && input.editedReportText.trim()) || autoReportText,
      aiCommand: input.aiCommand ?? null,
      reason: 'Geração inicial automática do relatório de turno',
      editedByUserId: actor.id,
      editedByName: actor.displayName,
      editedByBadge: actor.badgeCode,
    });

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'SHIFT_HANDOVER_CREATED',
      entityType: 'SHIFT_HANDOVER',
      entityId: handoverCode,
      newValue: JSON.stringify({
        shiftCode: input.shiftCode,
        operationalDate: input.operationalDate,
        status: legacy,
        workflowStatus: workflow,
      }),
      reason: 'Início de relatório de turno e passagem',
      origin: 'PASSAGEM_TURNO',
    });

    return inserted.id;
  });

  const all = await listShiftHandovers();
  const found = all.find((h) => h.id === savedId);
  if (!found) throw new OperationalConflictError('Erro ao recuperar passagem salva.', 500);
  return found;
}

export async function addShiftHandoverSupplementTransactional(
  handoverId: number,
  input: {
    category?: ShiftManualSupplement['category'];
    text: string;
    executedByName?: string | null;
    executedByBadge?: string | null;
  },
  actor: AuthenticatedAppUser
): Promise<ShiftHandoverView> {
  if (!input.text || input.text.trim().length < 5) {
    throw new OperationalConflictError('Descreva a informação complementar com pelo menos 5 caracteres.', 400);
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(shiftHandovers)
      .where(eq(shiftHandovers.id, handoverId))
      .limit(1);
    if (!existing) {
      throw new OperationalConflictError('Relatório de turno não encontrado.', 404);
    }
    if (
      existing.status === 'FINALIZADA' ||
      existing.workflowStatus === 'APROVADO' ||
      existing.workflowStatus === 'ENCERRADO'
    ) {
      throw new OperationalConflictError(
        'Relatório já aprovado ou encerrado. Utilize a correção versionada pós-aprovação.',
        409
      );
    }

    let supplements: ShiftManualSupplement[] = [];
    try {
      const parsed = JSON.parse(existing.supplementsJson || '[]');
      if (Array.isArray(parsed)) supplements = parsed;
    } catch {
      supplements = [];
    }

    const newSupplement: ShiftManualSupplement = {
      id: `SUP-${Date.now().toString(36).toUpperCase()}`,
      timestampIso: new Date().toISOString(),
      authorUserId: actor.id,
      authorName: actor.displayName,
      authorBadge: actor.badgeCode,
      executedByName: input.executedByName?.trim() || null,
      executedByBadge: input.executedByBadge?.trim() || null,
      category: input.category || 'INFORMACAO_OPERACIONAL',
      text: input.text.trim(),
    };
    supplements.push(newSupplement);

    const autoSummary = await buildShiftAutoSummary(existing.shiftCode, existing.operationalDate);
    const updatedAutoReport = buildMoegaShiftNarrativeReport({
      summary: autoSummary,
      handoverByName: actor.displayName,
      handoverByBadge: actor.badgeCode,
      receivedByName: existing.receivedByName,
      shiftSummaryText: existing.shiftSummaryText,
      relevantOccurrencesText: existing.relevantOccurrencesText,
      pendenciesText: existing.pendenciesText,
      requiredActionsText: existing.requiredActionsText,
      nextShiftRecommendationsText: existing.nextShiftRecommendationsText,
      supplements,
    });

    // Se havia texto customizado, incorpora o complemento antes do bloco final sem perder edições manuais
    let nextEditedText = existing.editedReportText;
    if (nextEditedText && nextEditedText.trim()) {
      const auth = newSupplement.executedByName
        ? `${newSupplement.authorName} (executado por ${newSupplement.executedByName})`
        : `${newSupplement.authorName}${newSupplement.authorBadge ? ` (Mat. ${newSupplement.authorBadge})` : ''}`;
      const lineToAdd = `Complemento registrado às ${newSupplement.timestampIso.slice(11, 16)} por ${auth}: ${newSupplement.text}`;
      const marker = '**Veículos descarregados pelo';
      const idx = nextEditedText.indexOf(marker);
      nextEditedText =
        idx > 0
          ? `${nextEditedText.slice(0, idx).trim()}\n\n${lineToAdd}\n\n${nextEditedText.slice(idx)}`
          : `${nextEditedText.trim()}\n\n${lineToAdd}`;
    }

    const nextVersion = existing.version + 1;
    await tx
      .update(shiftHandovers)
      .set({
        supplementsJson: JSON.stringify(supplements),
        autoSummarySnapshotJson: JSON.stringify(autoSummary),
        vehicleSummaryJson: JSON.stringify(autoSummary.vehicleBreakdown || {}),
        autoReportText: updatedAutoReport,
        editedReportText: nextEditedText,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(shiftHandovers.id, existing.id));

    await tx.insert(shiftHandoverRevisions).values({
      handoverId: existing.id,
      version: nextVersion,
      workflowStatus: (existing.workflowStatus as ShiftWorkflowStatus) || 'EM_ELABORACAO',
      changeType: 'COMPLEMENTO_MANUAL',
      reportText: (nextEditedText && nextEditedText.trim()) || updatedAutoReport,
      reason: `Complemento manual (${newSupplement.category}): ${newSupplement.text.slice(0, 140)}`,
      editedByUserId: actor.id,
      editedByName: actor.displayName,
      editedByBadge: actor.badgeCode,
    });

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'SHIFT_REPORT_SUPPLEMENT_ADDED',
      entityType: 'SHIFT_HANDOVER',
      entityId: existing.handoverCode,
      newValue: JSON.stringify(newSupplement),
      reason: 'Informação complementar manual adicionada sem alterar registros oficiais do banco',
      origin: 'PASSAGEM_TURNO',
    });
  });

  const all = await listShiftHandovers();
  const found = all.find((h) => h.id === handoverId);
  if (!found) throw new OperationalConflictError('Relatório não encontrado após complemento.', 404);
  return found;
}

async function createAutoPendenciesForHandoverTx(
  tx: any,
  existing: typeof shiftHandovers.$inferSelect,
  summary: ShiftAutoSummarySnapshot
) {
  const existingPends = await tx
    .select()
    .from(shiftHandoverPendencies)
    .where(eq(shiftHandoverPendencies.handoverId, existing.id));

  if (existingPends.length > 0) return;

  const toInsert: Array<typeof shiftHandoverPendencies.$inferInsert> = [];

  if (existing.pendenciesText.trim()) {
    toInsert.push({
      pendencyCode: genCode('PND'),
      handoverId: existing.id,
      sourceType: 'MANUAL',
      title: `Pendências registradas no turno (${existing.shiftName})`,
      description: existing.pendenciesText.trim(),
      priority: 'ALTA',
      status: 'ABERTA',
    });
  }
  if (summary.partialDischargesCount > 0) {
    toInsert.push({
      pendencyCode: genCode('PND'),
      handoverId: existing.id,
      sourceType: 'DESCARGA_PARCIAL',
      sourceEntityId: summary.partialReceiptNumbers.join(','),
      title: `${summary.partialDischargesCount} descarga(s) parcial(is)/pendente(s)`,
      description: `Recebimentos pendentes de complemento: ${summary.partialReceiptNumbers.join(', ')}`,
      priority: 'ALTA',
      status: 'ABERTA',
    });
  }
  if (summary.transfersPendingCount > 0) {
    toInsert.push({
      pendencyCode: genCode('PND'),
      handoverId: existing.id,
      sourceType: 'TRANSFERENCIA_PENDENTE',
      sourceEntityId: summary.transfersPendingCodes.join(','),
      title: `${summary.transfersPendingCount} transferência(s) aberta(s)/parcial(is)`,
      description: `Ordens aguardando conclusão: ${summary.transfersPendingCodes.join(', ')}`,
      priority: 'MEDIA',
      status: 'ABERTA',
    });
  }
  if (summary.criticalStocks.length > 0) {
    toInsert.push({
      pendencyCode: genCode('PND'),
      handoverId: existing.id,
      sourceType: 'ESTOQUE_CRITICO',
      title: `${summary.criticalStocks.length} material(is) abaixo do estoque mínimo`,
      description: summary.criticalStocks
        .map((c) => `${c.materialCode} ${c.description} (${Math.round(c.realStockKg)} kg / Mín. ${Math.round(c.minStockKg)} kg)`)
        .join('; '),
      priority: 'CRITICA',
      status: 'ABERTA',
    });
  }
  if (summary.openOccurrencesCount > 0) {
    toInsert.push({
      pendencyCode: genCode('PND'),
      handoverId: existing.id,
      sourceType: 'OCORRENCIA',
      title: `${summary.openOccurrencesCount} ocorrência(s) operacional(is) em aberto`,
      description: summary.openOccurrencesList.join('; ') || 'Ocorrências abertas aguardando tratamento',
      priority: 'ALTA',
      status: 'ABERTA',
    });
  }

  if (toInsert.length > 0) {
    await tx.insert(shiftHandoverPendencies).values(toInsert);
  }
}

export async function approveShiftHandoverTransactional(
  handoverId: number,
  input: {
    receivedByUserId?: number | null;
    receivedByName?: string | null;
    editedReportText?: string | null;
    approvalNotes?: string | null;
    closeImmediately?: boolean;
  },
  actor: AuthenticatedAppUser
): Promise<ShiftHandoverView> {
  if (!hasPermission(actor.roleCode, 'handover:approve')) {
    throw new OperationalConflictError(
      'Apenas Supervisão ou Administração tem permissão para aprovar o relatório de turno.',
      403
    );
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(shiftHandovers)
      .where(eq(shiftHandovers.id, handoverId))
      .limit(1);
    if (!existing) {
      throw new OperationalConflictError('Relatório de turno não encontrado.', 404);
    }
    if (existing.workflowStatus === 'ENCERRADO') {
      throw new OperationalConflictError('Este relatório já está encerrado.', 409);
    }

    const summary: ShiftAutoSummarySnapshot = JSON.parse(existing.autoSummarySnapshotJson);
    let resolvedReceiverName = input.receivedByName?.trim() || existing.receivedByName || null;
    if (!resolvedReceiverName && input.receivedByUserId) {
      const [u] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, input.receivedByUserId))
        .limit(1);
      resolvedReceiverName = u?.displayName || null;
    }

    const now = new Date();
    const targetWorkflow: ShiftWorkflowStatus = input.closeImmediately ? 'ENCERRADO' : 'APROVADO';
    const nextVersion = existing.version + 1;
    const nextEditedText =
      input.editedReportText !== undefined ? input.editedReportText : existing.editedReportText;
    const snapshotText = (nextEditedText && nextEditedText.trim()) || existing.autoReportText;

    await tx
      .update(shiftHandovers)
      .set({
        status: 'FINALIZADA',
        workflowStatus: targetWorkflow,
        receivedByUserId: input.receivedByUserId ?? existing.receivedByUserId,
        receivedByName: resolvedReceiverName,
        editedReportText: nextEditedText,
        approvedByUserId: actor.id,
        approvedAt: now,
        approvalNotes: input.approvalNotes?.trim() || 'Relatório conferido e aprovado oficialmente.',
        finalizedByUserId: actor.id,
        finalizedAt: existing.finalizedAt || now,
        closedAt: input.closeImmediately ? now : existing.closedAt,
        version: nextVersion,
        updatedAt: now,
      })
      .where(eq(shiftHandovers.id, existing.id));

    await createAutoPendenciesForHandoverTx(tx, existing, summary);

    await tx.insert(shiftHandoverRevisions).values({
      handoverId: existing.id,
      version: nextVersion,
      workflowStatus: targetWorkflow,
      changeType: input.closeImmediately ? 'ENCERRAMENTO' : 'APROVACAO',
      reportText: snapshotText,
      reason: input.approvalNotes?.trim() || `Aprovação oficial (${targetWorkflow})`,
      editedByUserId: actor.id,
      editedByName: actor.displayName,
      editedByBadge: actor.badgeCode,
    });

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'SHIFT_REPORT_APPROVED',
      entityType: 'SHIFT_HANDOVER',
      entityId: existing.handoverCode,
      previousValue: JSON.stringify({ workflowStatus: existing.workflowStatus, status: existing.status }),
      newValue: JSON.stringify({ workflowStatus: targetWorkflow, version: nextVersion }),
      reason: input.approvalNotes?.trim() || 'Aprovação oficial do relatório de turno',
      origin: 'PASSAGEM_TURNO',
    });
  });

  const all = await listShiftHandovers();
  const found = all.find((h) => h.id === handoverId);
  if (!found) throw new OperationalConflictError('Relatório aprovado não encontrado.', 404);
  return found;
}

export async function correctShiftHandoverPostApprovalTransactional(
  handoverId: number,
  input: {
    correctedReportText: string;
    reason: string;
    aiCommand?: string | null;
  },
  actor: AuthenticatedAppUser
): Promise<ShiftHandoverView> {
  if (!hasPermission(actor.roleCode, 'handover:correct')) {
    throw new OperationalConflictError(
      'Apenas Supervisão ou Administração pode registrar correção versionada após aprovação.',
      403
    );
  }
  if (!input.reason || input.reason.trim().length < 5) {
    throw new OperationalConflictError(
      'Informe justificativa obrigatória (mínimo 5 caracteres) para correção pós-aprovação.',
      400
    );
  }
  if (!input.correctedReportText || input.correctedReportText.trim().length < 20) {
    throw new OperationalConflictError('Informe o texto corrigido do relatório.', 400);
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(shiftHandovers)
      .where(eq(shiftHandovers.id, handoverId))
      .limit(1);
    if (!existing) {
      throw new OperationalConflictError('Relatório de turno não encontrado.', 404);
    }
    if (
      existing.status !== 'FINALIZADA' &&
      existing.workflowStatus !== 'APROVADO' &&
      existing.workflowStatus !== 'ENCERRADO'
    ) {
      throw new OperationalConflictError(
        'Correção pós-aprovação aplica-se somente a relatórios já aprovados ou encerrados.',
        400
      );
    }

    // Garante que a versão anterior aprovada esteja preservada em shiftHandoverRevisions
    const existingRevs = await tx
      .select()
      .from(shiftHandoverRevisions)
      .where(eq(shiftHandoverRevisions.handoverId, existing.id));
    if (existingRevs.length === 0) {
      await tx.insert(shiftHandoverRevisions).values({
        handoverId: existing.id,
        version: existing.version,
        workflowStatus: (existing.workflowStatus as ShiftWorkflowStatus) || 'APROVADO',
        changeType: 'APROVACAO',
        reportText: (existing.editedReportText && existing.editedReportText.trim()) || existing.autoReportText,
        reason: 'Snapshot original anterior à correção pós-aprovação',
        editedByUserId: existing.approvedByUserId || existing.finalizedByUserId || existing.handoverByUserId,
        editedByName: actor.displayName,
        editedByBadge: actor.badgeCode,
      });
    }

    const nextVersion = existing.version + 1;
    const preservedStatus = (existing.workflowStatus as ShiftWorkflowStatus) || 'APROVADO';

    await tx
      .update(shiftHandovers)
      .set({
        editedReportText: input.correctedReportText.trim(),
        aiEditCount: input.aiCommand ? (existing.aiEditCount || 0) + 1 : existing.aiEditCount || 0,
        lastAiCommand: input.aiCommand?.trim() || existing.lastAiCommand,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(shiftHandovers.id, existing.id));

    await tx.insert(shiftHandoverRevisions).values({
      handoverId: existing.id,
      version: nextVersion,
      workflowStatus: preservedStatus,
      changeType: 'CORRECAO_POS_APROVACAO',
      reportText: input.correctedReportText.trim(),
      aiCommand: input.aiCommand?.trim() || null,
      reason: input.reason.trim(),
      editedByUserId: actor.id,
      editedByName: actor.displayName,
      editedByBadge: actor.badgeCode,
    });

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'SHIFT_REPORT_POST_APPROVAL_CORRECTED',
      entityType: 'SHIFT_HANDOVER',
      entityId: existing.handoverCode,
      previousValue: JSON.stringify({ version: existing.version }),
      newValue: JSON.stringify({ version: nextVersion, workflowStatus: preservedStatus }),
      reason: input.reason.trim(),
      origin: 'PASSAGEM_TURNO',
    });
  });

  const all = await listShiftHandovers();
  const found = all.find((h) => h.id === handoverId);
  if (!found) throw new OperationalConflictError('Relatório corrigido não encontrado.', 404);
  return found;
}

export async function finalizeShiftHandoverTransactional(
  handoverId: number,
  input: {
    receivedByUserId?: number | null;
    receivedByName?: string | null;
    editedReportText?: string | null;
    finalizationNote?: string;
  },
  actor: AuthenticatedAppUser
): Promise<ShiftHandoverView> {
  if (!hasPermission(actor.roleCode, 'handover:finalize') && !hasPermission(actor.roleCode, 'handover:prepare')) {
    throw new OperationalConflictError('Perfil sem permissão para finalizar passagem de turno.', 403);
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(shiftHandovers)
      .where(eq(shiftHandovers.id, handoverId))
      .limit(1);
    if (!existing) {
      throw new OperationalConflictError('Passagem de turno não encontrada.', 404);
    }
    if (existing.status === 'FINALIZADA' || existing.workflowStatus === 'ENCERRADO') {
      throw new OperationalConflictError('Esta passagem de turno já foi finalizada.', 409);
    }

    const summary: ShiftAutoSummarySnapshot = JSON.parse(existing.autoSummarySnapshotJson);

    let resolvedReceiverName = input.receivedByName?.trim() || existing.receivedByName || null;
    if (!resolvedReceiverName && input.receivedByUserId) {
      const [u] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, input.receivedByUserId))
        .limit(1);
      resolvedReceiverName = u?.displayName || null;
    }

    const now = new Date();
    const nextVersion = existing.version + 1;
    const nextEditedText =
      input.editedReportText !== undefined ? input.editedReportText : existing.editedReportText;
    const snapshotText = (nextEditedText && nextEditedText.trim()) || existing.autoReportText;

    await tx
      .update(shiftHandovers)
      .set({
        status: 'FINALIZADA',
        workflowStatus: 'ENCERRADO',
        receivedByUserId: input.receivedByUserId ?? existing.receivedByUserId,
        receivedByName: resolvedReceiverName,
        editedReportText: nextEditedText,
        finalizedByUserId: actor.id,
        finalizedAt: now,
        closedAt: now,
        version: nextVersion,
        updatedAt: now,
      })
      .where(eq(shiftHandovers.id, existing.id));

    await createAutoPendenciesForHandoverTx(tx, existing, summary);

    await tx.insert(shiftHandoverRevisions).values({
      handoverId: existing.id,
      version: nextVersion,
      workflowStatus: 'ENCERRADO',
      changeType: 'ENCERRAMENTO',
      reportText: snapshotText,
      reason: input.finalizationNote?.trim() || 'Encerramento oficial da passagem de turno',
      editedByUserId: actor.id,
      editedByName: actor.displayName,
      editedByBadge: actor.badgeCode,
    });

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'SHIFT_HANDOVER_FINALIZED',
      entityType: 'SHIFT_HANDOVER',
      entityId: existing.handoverCode,
      previousValue: JSON.stringify({ status: existing.status, workflowStatus: existing.workflowStatus }),
      newValue: JSON.stringify({
        status: 'FINALIZADA',
        workflowStatus: 'ENCERRADO',
        receivedByName: resolvedReceiverName,
      }),
      reason: input.finalizationNote?.trim() || 'Finalização oficial da passagem de turno',
      origin: 'PASSAGEM_TURNO',
    });
  });

  const all = await listShiftHandovers();
  const found = all.find((h) => h.id === handoverId);
  if (!found) throw new OperationalConflictError('Passagem finalizada não encontrada.', 404);
  return found;
}

/**
 * Registra ciência explícita do próximo turno sobre uma pendência.
 * REGRA CRÍTICA: Ciência NUNCA conclui ou marca a pendência como RESOLVIDA automaticamente!
 */
export async function acknowledgeShiftPendencyTransactional(
  pendencyId: number,
  note: string | null,
  actor: AuthenticatedAppUser
): Promise<ShiftHandoverPendencyView> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(shiftHandoverPendencies)
      .where(eq(shiftHandoverPendencies.id, pendencyId))
      .limit(1);
    if (!existing) {
      throw new OperationalConflictError('Pendência de turno não encontrada.', 404);
    }
    if (existing.status === 'RESOLVIDA') {
      throw new OperationalConflictError('Pendência já foi encerrada como RESOLVIDA.', 409);
    }

    await tx
      .update(shiftHandoverPendencies)
      .set({
        status: 'CIENTE', // Ciência explicitamente distinta de RESOLVIDA
        acknowledgedByUserId: actor.id,
        acknowledgedAt: new Date(),
        acknowledgmentNote: note?.trim() || 'Ciência registrada pelo turno seguinte.',
        updatedAt: new Date(),
      })
      .where(eq(shiftHandoverPendencies.id, pendencyId));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'HANDOVER_PENDENCY_ACKNOWLEDGED',
      entityType: 'SHIFT_HANDOVER_PENDENCY',
      entityId: existing.pendencyCode,
      previousValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status: 'CIENTE', acknowledgedBy: actor.displayName }),
      reason: note?.trim() || 'Registro de ciência de pendência (sem conclusão automática)',
      origin: 'PASSAGEM_TURNO',
    });
  });

  const list = await listOpenShiftPendencies();
  const updated = list.find((p) => p.id === pendencyId);
  if (!updated) throw new OperationalConflictError('Pendência atualizada não encontrada.', 404);
  return updated;
}

export async function resolveShiftPendencyTransactional(
  pendencyId: number,
  resolutionNotes: string,
  actor: AuthenticatedAppUser
): Promise<void> {
  if (!resolutionNotes || resolutionNotes.trim().length < 3) {
    throw new OperationalConflictError('Informe a solução aplicada para concluir a pendência.', 400);
  }
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(shiftHandoverPendencies)
      .where(eq(shiftHandoverPendencies.id, pendencyId))
      .limit(1);
    if (!existing) {
      throw new OperationalConflictError('Pendência não encontrada.', 404);
    }
    await tx
      .update(shiftHandoverPendencies)
      .set({
        status: 'RESOLVIDA',
        resolvedByUserId: actor.id,
        resolvedAt: new Date(),
        resolutionNotes: resolutionNotes.trim(),
        updatedAt: new Date(),
      })
      .where(eq(shiftHandoverPendencies.id, pendencyId));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'HANDOVER_PENDENCY_RESOLVED',
      entityType: 'SHIFT_HANDOVER_PENDENCY',
      entityId: existing.pendencyCode,
      previousValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({ status: 'RESOLVIDA', resolutionNotes: resolutionNotes.trim() }),
      reason: resolutionNotes.trim(),
      origin: 'PASSAGEM_TURNO',
    });
  });
}

// =========================================================================
// 5B. VISÃO GERENCIAL DOS RELATÓRIOS DE TURNO (FILTRÁVEL E CONSOLIDADA)
// =========================================================================

export async function getShiftManagerialReports(filters?: {
  startDate?: string;
  endDate?: string;
  shiftCode?: string;
  operatorName?: string;
  badgeCode?: string;
  materialId?: number | null;
  siloId?: number | null;
  lineCode?: string;
  workflowStatus?: string;
  search?: string;
}): Promise<ShiftManagerialReportResponse> {
  const bounds = resolvePeriodBounds('ULTIMOS_30_DIAS', filters?.startDate, filters?.endDate);
  const [handovers, silosDetail, matRows] = await Promise.all([
    listShiftHandovers(),
    listSilosWithDetails(),
    db.select({ id: materials.id, code: materials.code, description: materials.description }).from(materials),
  ]);

  const siloNumMap = new Map(silosDetail.map((s) => [s.id, s]));
  const filterMat = filters?.materialId ? matRows.find((m) => m.id === filters.materialId) : null;
  const filterSilo = filters?.siloId ? siloNumMap.get(filters.siloId) : null;

  let rows: ShiftManagerialReportRow[] = handovers
    .filter((h) => h.operationalDate >= bounds.startDate && h.operationalDate <= bounds.endDate)
    .map((h) => {
      const vb = h.vehicleBreakdown || h.autoSummary.vehicleBreakdown;
      const unloadedCount = vb ? vb.totalCountedVehicles : h.autoSummary.receiptsCount;
      const carryoverCount = vb ? vb.carryoverFinalizedVehicles.length : 0;
      const partialCount = vb ? vb.pendingOrPartialVehicles.length : h.autoSummary.partialDischargesCount;
      const reportText = (h.editedReportText && h.editedReportText.trim()) || h.autoReportText;
      const silosUsed = Array.from(
        new Set([
          ...h.autoSummary.silosFed.map((sf) => sf.siloNumber),
          ...(vb ? vb.countedVehicles.flatMap((v) => v.siloNumbers) : []),
        ])
      ).sort((a, b) => a - b);
      const materialsMoved = Array.from(
        new Set([
          ...h.autoSummary.materialsReceived.map((m) => `${m.code} ${m.description}`),
          ...(vb ? vb.countedVehicles.map((v) => `${v.materialCode} ${v.materialDescription}`) : []),
        ])
      );

      return {
        handoverId: h.id,
        handoverCode: h.handoverCode,
        shiftCode: h.shiftCode,
        shiftName: h.shiftName,
        operationalDate: h.operationalDate,
        workflowStatus: h.workflowStatus || 'EM_ELABORACAO',
        legacyStatus: h.status,
        handoverByName: h.handoverByName,
        handoverByBadge: h.handoverByBadge ?? null,
        receivedByName: h.receivedByName,
        approvedByName: h.approvedByName ?? null,
        approvedAt: h.approvedAt ?? null,
        unloadedVehiclesCount: unloadedCount,
        carryoverVehiclesCount: carryoverCount,
        partialVehiclesCount: partialCount,
        receivedKg: h.autoSummary.receivedKg,
        distributedKg: h.autoSummary.distributedKg,
        transferredKg: h.autoSummary.transfersCompletedKg,
        occurrencesCount:
          h.autoSummary.shiftOccurrences?.length ?? h.autoSummary.openOccurrencesCount,
        openOccurrencesCount: h.autoSummary.openOccurrencesCount,
        pendenciesCount: h.pendencies.length,
        openPendenciesCount: h.pendencies.filter((p) => p.status !== 'RESOLVIDA').length,
        version: h.version,
        reportText,
        silosUsed,
        materialsMoved,
        updatedAt: h.updatedAt,
      };
    });

  if (filters?.shiftCode && filters.shiftCode !== 'ALL') {
    rows = rows.filter((r) => r.shiftCode === filters.shiftCode);
  }
  if (filters?.workflowStatus && filters.workflowStatus !== 'ALL') {
    rows = rows.filter((r) => r.workflowStatus === filters.workflowStatus);
  }
  if (filters?.operatorName?.trim()) {
    const term = filters.operatorName.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.handoverByName.toLowerCase().includes(term) ||
        (r.receivedByName || '').toLowerCase().includes(term) ||
        r.reportText.toLowerCase().includes(term)
    );
  }
  if (filters?.badgeCode?.trim()) {
    const badge = filters.badgeCode.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.handoverByBadge || '').toLowerCase().includes(badge) ||
        r.reportText.toLowerCase().includes(badge)
    );
  }
  if (filterMat) {
    const codeLower = filterMat.code.toLowerCase();
    const descLower = filterMat.description.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.materialsMoved.some((m) => m.toLowerCase().includes(codeLower) || m.toLowerCase().includes(descLower)) ||
        r.reportText.toLowerCase().includes(descLower)
    );
  }
  if (filterSilo) {
    rows = rows.filter(
      (r) =>
        r.silosUsed.includes(filterSilo.siloNumber) ||
        r.reportText.toLowerCase().includes(`silo ${filterSilo.siloNumber}`)
    );
  }
  if (filters?.lineCode && filters.lineCode !== 'ALL') {
    const lineLower = filters.lineCode.toLowerCase();
    const lineSiloNums = new Set(
      silosDetail.filter((s) => s.lineCode.toLowerCase() === lineLower).map((s) => s.siloNumber)
    );
    rows = rows.filter(
      (r) =>
        r.silosUsed.some((n) => lineSiloNums.has(n)) ||
        r.reportText.toLowerCase().includes(lineLower)
    );
  }
  if (filters?.search?.trim()) {
    const q = filters.search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.handoverCode.toLowerCase().includes(q) ||
        r.shiftName.toLowerCase().includes(q) ||
        r.handoverByName.toLowerCase().includes(q) ||
        r.reportText.toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => b.operationalDate.localeCompare(a.operationalDate) || b.shiftCode.localeCompare(a.shiftCode));

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    dataOrigin: 'PostgreSQL (shift_handovers + shift_handover_revisions + receipts + inventory_movements)',
    totals: {
      shiftsCount: rows.length,
      approvedOrClosedCount: rows.filter(
        (r) => r.workflowStatus === 'APROVADO' || r.workflowStatus === 'ENCERRADO'
      ).length,
      totalUnloadedVehicles: rows.reduce((a, r) => a + r.unloadedVehiclesCount, 0),
      totalCarryoverFinalizedVehicles: rows.reduce((a, r) => a + r.carryoverVehiclesCount, 0),
      totalReceivedKg: Math.round(rows.reduce((a, r) => a + r.receivedKg, 0) * 1000) / 1000,
      totalDistributedKg: Math.round(rows.reduce((a, r) => a + r.distributedKg, 0) * 1000) / 1000,
      totalTransferredKg: Math.round(rows.reduce((a, r) => a + r.transferredKg, 0) * 1000) / 1000,
      totalOccurrences: rows.reduce((a, r) => a + r.occurrencesCount, 0),
      totalOpenPendencies: rows.reduce((a, r) => a + r.openPendenciesCount, 0),
    },
    rows,
  };
}

// =========================================================================
// 6. CENTRAL DE OCORRÊNCIAS OPERACIONAIS
// =========================================================================

export async function listOccurrences(filters?: {
  status?: string;
  category?: string;
  siloId?: number;
}): Promise<OccurrenceItem[]> {
  const [rows, siloRows, matRows, lineRows, userRows] = await Promise.all([
    db.select().from(operationalOccurrences).orderBy(desc(operationalOccurrences.occurredAt)),
    db.select({ id: silos.id, siloNumber: silos.siloNumber }).from(silos),
    db.select({ id: materials.id, code: materials.code, description: materials.description }).from(materials),
    db.select({ id: productionLines.id, code: productionLines.code }).from(productionLines),
    db.select({ id: users.id, displayName: users.displayName, badgeCode: users.badgeCode }).from(users),
  ]);

  const siloMap = new Map(siloRows.map((s) => [s.id, s.siloNumber]));
  const matMap = new Map(matRows.map((m) => [m.id, m]));
  const lineMap = new Map(lineRows.map((l) => [l.id, l.code]));
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  let result: OccurrenceItem[] = rows.map((o) => {
    let evidence: OccurrenceEvidenceItem[] = [];
    try {
      const parsed = JSON.parse(o.evidenceJson || '[]');
      if (Array.isArray(parsed)) evidence = parsed;
    } catch {
      evidence = [];
    }
    const mat = o.materialId ? matMap.get(o.materialId) : null;
    const reporter = userMap.get(o.reportedByUserId);
    return {
      id: o.id,
      occurrenceCode: o.occurrenceCode,
      category: o.category,
      title: o.title,
      description: o.description,
      occurredAt: o.occurredAt.toISOString(),
      siloId: o.siloId,
      siloNumber: o.siloId ? siloMap.get(o.siloId) ?? null : null,
      materialId: o.materialId,
      materialCode: mat?.code ?? null,
      materialDescription: mat?.description ?? null,
      productionLineId: o.productionLineId,
      lineCode: o.productionLineId ? lineMap.get(o.productionLineId) ?? null : null,
      reportedByUserId: o.reportedByUserId,
      reportedByName: reporter?.displayName || 'Dado não informado',
      reportedByBadge: reporter?.badgeCode ?? null,
      executedByName: o.executedByName ?? null,
      executedByBadge: o.executedByBadge ?? null,
      assignedToUserId: o.assignedToUserId,
      assignedToName: o.assignedToUserId ? userMap.get(o.assignedToUserId)?.displayName ?? null : null,
      shiftCode: o.shiftCode,
      operationalDate: o.operationalDate,
      priority: o.priority as OccurrenceItem['priority'],
      weatherCondition: o.weatherCondition ?? null,
      lineImpact: o.lineImpact ?? null,
      evidence,
      status: o.status as OccurrenceItem['status'],
      solutionApplied: o.solutionApplied,
      verifiedByName: o.verifiedByUserId ? userMap.get(o.verifiedByUserId)?.displayName ?? null : null,
      verifiedAt: o.verifiedAt ? o.verifiedAt.toISOString() : null,
      verificationNotes: o.verificationNotes ?? null,
      closedByName: o.closedByUserId ? userMap.get(o.closedByUserId)?.displayName ?? null : null,
      closedAt: o.closedAt ? o.closedAt.toISOString() : null,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  });

  if (filters?.status) result = result.filter((r) => r.status === filters.status);
  if (filters?.category) result = result.filter((r) => r.category === filters.category);
  if (filters?.siloId) result = result.filter((r) => r.siloId === filters.siloId);
  return result;
}

export async function createOccurrenceTransactional(
  input: {
    category: string;
    title: string;
    description: string;
    occurredAt?: string;
    siloId?: number | null;
    materialId?: number | null;
    productionLineId?: number | null;
    assignedToUserId?: number | null;
    priority?: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
    weatherCondition?: string | null;
    lineImpact?: string | null;
    executedByName?: string | null;
    executedByBadge?: string | null;
    evidence?: OccurrenceEvidenceItem[];
  },
  actor: AuthenticatedAppUser
): Promise<OccurrenceItem> {
  if (!OCCURRENCE_CATEGORIES.includes(input.category as any)) {
    throw new OperationalConflictError('Categoria de ocorrência inválida.', 400);
  }
  if (!input.title?.trim() || !input.description?.trim()) {
    throw new OperationalConflictError('Informe título e descrição detalhada da ocorrência.', 400);
  }

  const occTime = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const safeOccTime = Number.isNaN(occTime.getTime()) ? new Date() : occTime;
  const shiftInfo = await resolveActiveShiftFromDb(safeOccTime);

  const evidenceList = Array.isArray(input.evidence)
    ? input.evidence.slice(0, 5).map((ev) => ({
        name: String(ev.name || 'Evidência').slice(0, 120),
        mimeType: ev.mimeType ? String(ev.mimeType).slice(0, 60) : undefined,
        dataUrlOrNote: String(ev.dataUrlOrNote || '').slice(0, 150000),
      }))
    : [];

  const createdId = await db.transaction(async (tx) => {
    const occurrenceCode = genCode('OCO');
    const [inserted] = await tx
      .insert(operationalOccurrences)
      .values({
        occurrenceCode,
        category: input.category,
        title: input.title.trim(),
        description: input.description.trim(),
        occurredAt: safeOccTime,
        siloId: input.siloId || null,
        materialId: input.materialId || null,
        productionLineId: input.productionLineId || null,
        reportedByUserId: actor.id,
        executedByName: input.executedByName?.trim() || null,
        executedByBadge: input.executedByBadge?.trim() || null,
        assignedToUserId: input.assignedToUserId || null,
        shiftCode: shiftInfo.shiftCode,
        operationalDate: shiftInfo.operationalDate,
        priority: input.priority || 'MEDIA',
        weatherCondition: input.weatherCondition?.trim() || null,
        lineImpact: input.lineImpact?.trim() || null,
        evidenceJson: JSON.stringify(evidenceList),
        status: 'ABERTA',
      })
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'OCCURRENCE_CREATED',
      entityType: 'OPERATIONAL_OCCURRENCE',
      entityId: occurrenceCode,
      newValue: JSON.stringify({
        category: input.category,
        title: input.title.trim(),
        priority: input.priority || 'MEDIA',
        weatherCondition: input.weatherCondition || null,
        lineImpact: input.lineImpact || null,
        shiftCode: shiftInfo.shiftCode,
        operationalDate: shiftInfo.operationalDate,
      }),
      reason: input.description.trim(),
      origin: 'CENTRAL_OCORRENCIAS',
    });

    return inserted.id;
  });

  const all = await listOccurrences();
  const created = all.find((o) => o.id === createdId);
  if (!created) throw new OperationalConflictError('Erro ao recuperar ocorrência criada.', 500);
  return created;
}

export async function verifyOccurrenceTransactional(
  occurrenceId: number,
  verificationNotes: string | null,
  actor: AuthenticatedAppUser
): Promise<OccurrenceItem> {
  if (!hasPermission(actor.roleCode, 'occurrences:verify')) {
    throw new OperationalConflictError(
      'Apenas Supervisão ou Administração pode confirmar a verificação de ocorrências.',
      403
    );
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(operationalOccurrences)
      .where(eq(operationalOccurrences.id, occurrenceId))
      .limit(1);
    if (!existing) {
      throw new OperationalConflictError('Ocorrência não encontrada.', 404);
    }

    await tx
      .update(operationalOccurrences)
      .set({
        verifiedByUserId: actor.id,
        verifiedAt: new Date(),
        verificationNotes: verificationNotes?.trim() || 'Ocorrência verificada pela Supervisão/Administração.',
        updatedAt: new Date(),
      })
      .where(eq(operationalOccurrences.id, occurrenceId));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'OCCURRENCE_VERIFIED',
      entityType: 'OPERATIONAL_OCCURRENCE',
      entityId: existing.occurrenceCode,
      newValue: JSON.stringify({
        verifiedBy: actor.displayName,
        verificationNotes: verificationNotes?.trim() || null,
      }),
      reason: verificationNotes?.trim() || 'Verificação oficial da ocorrência',
      origin: 'CENTRAL_OCORRENCIAS',
    });
  });

  const all = await listOccurrences();
  const updated = all.find((o) => o.id === occurrenceId);
  if (!updated) throw new OperationalConflictError('Ocorrência verificada não encontrada.', 404);
  return updated;
}

export async function updateOccurrenceStatusTransactional(
  occurrenceId: number,
  input: {
    status: 'ABERTA' | 'EM_ANDAMENTO' | 'ENCERRADA';
    assignedToUserId?: number | null;
    solutionApplied?: string | null;
  },
  actor: AuthenticatedAppUser
): Promise<OccurrenceItem> {
  if (!hasPermission(actor.roleCode, 'occurrences:manage')) {
    throw new OperationalConflictError(
      'Apenas Supervisão ou Administração pode alterar o andamento ou encerrar ocorrências.',
      403
    );
  }
  if (input.status === 'ENCERRADA' && (!input.solutionApplied || input.solutionApplied.trim().length < 3)) {
    throw new OperationalConflictError('Informe a solução aplicada para encerrar a ocorrência.', 400);
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(operationalOccurrences)
      .where(eq(operationalOccurrences.id, occurrenceId))
      .limit(1);
    if (!existing) {
      throw new OperationalConflictError('Ocorrência não encontrada.', 404);
    }

    await tx
      .update(operationalOccurrences)
      .set({
        status: input.status,
        assignedToUserId:
          input.assignedToUserId !== undefined ? input.assignedToUserId : existing.assignedToUserId,
        solutionApplied:
          input.solutionApplied !== undefined
            ? input.solutionApplied?.trim() || null
            : existing.solutionApplied,
        closedByUserId: input.status === 'ENCERRADA' ? actor.id : null,
        closedAt: input.status === 'ENCERRADA' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(operationalOccurrences.id, occurrenceId));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: input.status === 'ENCERRADA' ? 'OCCURRENCE_CLOSED' : 'OCCURRENCE_UPDATED',
      entityType: 'OPERATIONAL_OCCURRENCE',
      entityId: existing.occurrenceCode,
      previousValue: JSON.stringify({ status: existing.status }),
      newValue: JSON.stringify({
        status: input.status,
        solutionApplied: input.solutionApplied?.trim() || null,
      }),
      reason: input.solutionApplied?.trim() || `Atualização de status para ${input.status}`,
      origin: 'CENTRAL_OCORRENCIAS',
    });
  });

  const all = await listOccurrences();
  const updated = all.find((o) => o.id === occurrenceId);
  if (!updated) throw new OperationalConflictError('Ocorrência atualizada não encontrada.', 404);
  return updated;
}

// =========================================================================
// 7. CONTEXTO AUTORIZADO DO NEXO ASSISTENTE (SOMENTE LEITURA + AUDITORIA)
// =========================================================================

export async function queryNexoAssistantContext(
  question: string,
  actor: AuthenticatedAppUser
): Promise<AssistantAuthorizedContext> {
  const shiftNow = await resolveActiveShiftFromDb();
  const today = shiftNow.operationalDate;

  const [
    receivingToday,
    allReceipts,
    silosDetail,
    orders,
    matRows,
    thresholds,
    pendenciesOpen,
    recsActive,
    occOpen,
    latestSchedRows,
    userRows,
  ] = await Promise.all([
    getReceivingReport({ preset: 'PERSONALIZADO', startDate: today, endDate: today }),
    db.select().from(receipts).orderBy(desc(receipts.createdAt)).limit(40),
    listSilosWithDetails(),
    db.select().from(transferOrders).orderBy(desc(transferOrders.createdAt)),
    db.select().from(materials),
    db.select().from(materialStockThresholds),
    listOpenShiftPendencies(),
    db
      .select()
      .from(operationalRecommendations)
      .where(inArray(operationalRecommendations.decisionStatus, ['PENDENTE', 'EM_ANALISE'])),
    listOccurrences({ status: 'ABERTA' }),
    db.select().from(productionSchedules).orderBy(desc(productionSchedules.createdAt)).limit(3),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
  ]);

  const matMap = new Map(matRows.map((m) => [m.id, m]));
  const siloMap = new Map(silosDetail.map((s) => [s.id, s]));
  const userMap = new Map(userRows.map((u) => [u.id, u.displayName]));

  // Calcário hoje
  const calcarioRowsToday = receivingToday.rows.filter(
    (r) => r.materialDescription.toUpperCase().includes('CALCARIO') || r.materialCode.startsWith('201710')
  );
  const calcarioTodayKg = calcarioRowsToday.reduce((a, r) => a + r.receivedQuantityKg, 0);

  // Silos abastecidos hoje via distribuições
  const distToday = await db
    .select()
    .from(receiptDistributions)
    .where(eq(receiptDistributions.operationalDate, today));
  const recTodayMap = new Map(receivingToday.rows.map((r) => [r.id, r]));
  const silosFedMap = new Map<number, { siloNumber: number; materialCode: string; receivedKg: number }>();
  for (const d of distToday) {
    if (d.status === 'ESTORNADA') continue;
    const s = siloMap.get(d.siloId);
    const rec = recTodayMap.get(d.receiptId);
    if (!s) continue;
    const prev = silosFedMap.get(s.id) ?? {
      siloNumber: s.siloNumber,
      materialCode: rec?.materialCode || s.materialCode || 'N/I',
      receivedKg: 0,
    };
    prev.receivedKg += Number(d.quantityKg);
    silosFedMap.set(s.id, prev);
  }

  // Recebimentos em aberto / parciais
  const openOrPartialReceipts = allReceipts
    .filter((r) => r.status === 'PENDENTE' || r.status === 'PARCIAL')
    .slice(0, 12)
    .map((r) => {
      const m = matMap.get(r.materialId);
      const pendingKg = Math.max(0, Number(r.receivedQuantityKg) - Number(r.distributedQuantityKg));
      return {
        receiptNumber: r.receiptNumber,
        materialCode: m?.code || 'N/I',
        materialDescription: m?.description || 'N/I',
        lotCode: r.lotCode,
        pendingKg,
        status: r.status,
      };
    });

  // Última transferência no Silo 38
  const silo38 = silosDetail.find((s) => s.siloNumber === 38);
  const lastSilo38Order = silo38
    ? orders.find((o) => o.originSiloId === silo38.id || o.destinationSiloId === silo38.id)
    : null;

  const isRestrictedRole = actor.roleCode === 'PRODUCAO';

  const silo38LastTransfer = lastSilo38Order
    ? {
        orderCode: lastSilo38Order.orderCode,
        createdAtIso: lastSilo38Order.createdAt.toISOString(),
        materialCode: matMap.get(lastSilo38Order.materialId)?.code ?? null,
        originSiloNumber: siloMap.get(lastSilo38Order.originSiloId)?.siloNumber ?? null,
        destinationSiloNumber: siloMap.get(lastSilo38Order.destinationSiloId)?.siloNumber ?? null,
        transferredKg: Number(lastSilo38Order.transferredQuantityKg),
        status: lastSilo38Order.status,
        operatorName: isRestrictedRole
          ? null
          : userMap.get(lastSilo38Order.assignedOperatorUserId || lastSilo38Order.requestedByUserId) ?? null,
      }
    : null;

  // Materiais críticos
  const stockByMat = new Map<number, number>();
  for (const s of silosDetail) {
    if (s.primaryMaterialId) {
      stockByMat.set(s.primaryMaterialId, (stockByMat.get(s.primaryMaterialId) ?? 0) + s.confirmedStockKg);
    }
  }
  const thresholdByMat = new Map(thresholds.map((t) => [t.materialId, t]));
  const criticalMaterials: AssistantAuthorizedContext['criticalMaterials'] = [];
  for (const m of matRows) {
    const th = thresholdByMat.get(m.id);
    const real = stockByMat.get(m.id) ?? 0;
    const min = th ? Number(th.minStockKg) : null;
    if ((min !== null && real <= min) || (m.isCritical && real <= 0)) {
      criticalMaterials.push({
        materialCode: m.code,
        description: m.description,
        realStockKg: real,
        minStockKg: min,
        warningStockKg: th ? Number(th.warningStockKg) : null,
      });
    }
  }

  // Linhas em risco
  const linesAll = await db.select().from(productionLines);
  const lineCodeMap = new Map(linesAll.map((l) => [l.id, l.code]));
  const linesAtRisk = recsActive
    .filter((r) => r.priority === 'VERMELHO' || r.priority === 'LARANJA')
    .slice(0, 10)
    .map((r) => ({
      lineCode: r.productionLineId ? lineCodeMap.get(r.productionLineId) || 'L?' : 'Geral',
      materialCode: r.materialId ? matMap.get(r.materialId)?.code || 'N/I' : 'N/I',
      supplyStatus: r.priority,
      deficitKg: Number(r.missingKg || 0),
      statusReason: r.title,
    }));

  const latestSched = latestSchedRows[0] ?? null;

  const missingDataNotes: string[] = [];
  if (thresholds.length === 0) {
    missingDataNotes.push('Limites mínimos de estoque ainda não cadastrados para todas as matérias-primas.');
  }
  if (!latestSched) {
    missingDataNotes.push('Nenhuma programação de produção importada até o momento.');
  }

  // Auditoria de consulta ao Assistente
  await db.insert(auditEvents).values({
    userId: actor.id,
    userEmail: actor.email,
    userName: actor.displayName,
    userRole: actor.roleCode,
    action: 'ASSISTANT_QUERY',
    entityType: 'NEXO_ASSISTENTE',
    entityId: today,
    newValue: JSON.stringify({ question: question.slice(0, 240), role: actor.roleCode }),
    reason: 'Consulta somente leitura via NEXO ASSISTENTE',
    origin: 'NEXO_ASSISTENTE',
  });

  return {
    periodConsulted: `Data Operacional ${formatIsoDatePtBr(today)} (${shiftNow.shiftName})`,
    dataOrigin: 'PostgreSQL — Base Oficial Autorizada NEXO LOG 2.0 (Somente Leitura)',
    lastUpdatedIso: new Date().toISOString(),
    userRole: actor.roleCode,
    todayDate: today,
    receiptsSummary: {
      calcarioTodayKg,
      calcarioTodayCount: calcarioRowsToday.length,
      todayTotalKg: receivingToday.totals.receivedKg,
      openOrPartialReceipts,
      silosFedToday: Array.from(silosFedMap.values()),
    },
    silo38LastTransfer,
    criticalMaterials,
    priorShiftPendencies: isRestrictedRole
      ? []
      : pendenciesOpen.slice(0, 10).map((p) => ({
          pendencyCode: p.pendencyCode,
          shiftCode: p.shiftCode,
          operationalDate: p.operationalDate,
          title: p.title,
          status: p.status,
          priority: p.priority,
        })),
    linesAtRisk,
    openOccurrences: occOpen.slice(0, 10).map((o) => ({
      occurrenceCode: o.occurrenceCode,
      category: o.category,
      title: o.title,
      status: o.status,
      siloNumber: o.siloNumber,
      lineCode: o.lineCode,
    })),
    scheduleChanges: latestSched
      ? {
          latestScheduleCode: latestSched.scheduleCode,
          revisionNumber: latestSched.revisionNumber,
          referenceDate: latestSched.referenceDate,
          revisionDiffSummary: latestSched.revisionDiffSummary,
        }
      : null,
    missingDataNotes,
  };
}
