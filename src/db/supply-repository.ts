import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditEvents,
  inventoryMovements,
  materialIntakeRequests,
  materials,
  operationalPriorityConfigs,
  operationalRecommendations,
  productionConsumptionProjections,
  productionLines,
  productionScheduleItems,
  productionSchedules,
  receipts,
  siloMaterialCompatibility,
  siloTransferRules,
  silos,
  transferExecutionSteps,
  transferOrders,
  users,
} from './schema.ts';
import type { AuthenticatedAppUser } from './users.ts';
import { OperationalConflictError } from './operations-repository.ts';
import { resolveShiftConfiguredFromExecutor } from './shift-resolver.ts';
import {
  allocateLotsForTransfer,
  type CompatibilityRuleSnapshot,
  isSiloCompatibleForMaterial,
  type OriginLotBalance,
  type RouteAuthorizationStatus,
  type SiloRuleSnapshot,
  validateTransferExecution,
} from '../lib/inventory-rules.ts';
import {
  computeProductionSupplyAnalysis,
  DEFAULT_PRIORITY_WEIGHTS,
  type PriorityWeightsConfig,
} from '../lib/supply-transfer-engine.ts';

const VALID_ROUTE_STATUSES: RouteAuthorizationStatus[] = [
  'AUTORIZADA',
  'PENDENTE_VALIDACAO',
  'SUSPENSA',
  'BLOQUEADA',
];

async function loadSiloSnapshotsLockedTx(
  tx: any,
  lockSiloIds: number[] = []
): Promise<Map<number, SiloRuleSnapshot>> {
  const uniqueIds = Array.from(new Set(lockSiloIds)).sort((a, b) => a - b);
  if (uniqueIds.length > 0) {
    await tx.execute(
      sql`SELECT id FROM silos WHERE id IN (${sql.join(
        uniqueIds.map((id) => sql`${id}`),
        sql`, `
      )}) ORDER BY id ASC FOR UPDATE`
    );
  }

  const siloRows = await tx
    .select({
      id: silos.id,
      siloNumber: silos.siloNumber,
      operationalStatus: silos.operationalStatus,
      primaryMaterialId: silos.primaryMaterialId,
      safeCapacityKg: silos.safeCapacityKg,
      nominalCapacityKg: silos.nominalCapacityKg,
    })
    .from(silos);

  const balances = await tx
    .select({
      siloId: inventoryMovements.siloId,
      confirmedStockKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
    })
    .from(inventoryMovements)
    .groupBy(inventoryMovements.siloId);

  const balanceMap = new Map<number, number>(
    balances.map((b: any) => [b.siloId, Number(b.confirmedStockKg || 0)])
  );

  const map = new Map<number, SiloRuleSnapshot>();
  for (const s of siloRows) {
    map.set(s.id, {
      id: s.id,
      siloNumber: s.siloNumber,
      operationalStatus: s.operationalStatus,
      primaryMaterialId: s.primaryMaterialId,
      safeCapacityKg: Number(s.safeCapacityKg),
      nominalCapacityKg: Number(s.nominalCapacityKg),
      confirmedStockKg: balanceMap.get(s.id) ?? 0,
    });
  }
  return map;
}

async function loadCompatibilitiesTx(tx: any): Promise<CompatibilityRuleSnapshot[]> {
  return tx
    .select({
      siloId: siloMaterialCompatibility.siloId,
      materialId: siloMaterialCompatibility.materialId,
      allowReceiving: siloMaterialCompatibility.allowReceiving,
      allowTransferIn: siloMaterialCompatibility.allowTransferIn,
      allowTransferOut: siloMaterialCompatibility.allowTransferOut,
    })
    .from(siloMaterialCompatibility);
}

async function loadOriginLotsNetTx(
  tx: any,
  originSiloId: number,
  materialId: number
): Promise<OriginLotBalance[]> {
  const rows = await tx
    .select({
      lotCode: inventoryMovements.lotCode,
      netKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.siloId, originSiloId),
        eq(inventoryMovements.materialId, materialId)
      )
    )
    .groupBy(inventoryMovements.lotCode);

  return rows
    .map((r: any) => ({
      lotCode: r.lotCode ? String(r.lotCode).trim().toUpperCase() : null,
      netKg: Number(r.netKg || 0),
    }))
    .filter((r: OriginLotBalance) => r.netKg > 0.001);
}

function generateTransferOrderCode(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  const ts = String(now.getTime()).slice(-4);
  return `OTR-${y}${m}${d}-${ts}${rand}`;
}

function generateIntakeRequestCode(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  const ts = String(now.getTime()).slice(-4);
  return `SREC-${y}${m}${d}-${ts}${rand}`;
}

// =========================================================================
// 1. ROTAS AUTORIZADAS ENTRE SILOS + HISTÓRICO DE ALTERAÇÕES
// =========================================================================

export async function listAuthorizedRoutesWithHistory() {
  const [allSilos, allLines, allUsers, rules, ruleAudit] = await Promise.all([
    db.select().from(silos),
    db.select().from(productionLines),
    db.select().from(users),
    db
      .select({
        id: siloTransferRules.id,
        originSiloId: siloTransferRules.originSiloId,
        destinationSiloId: siloTransferRules.destinationSiloId,
        materialId: siloTransferRules.materialId,
        materialCode: materials.code,
        materialDescription: materials.description,
        relatedLineId: siloTransferRules.relatedLineId,
        operationType: siloTransferRules.operationType,
        maxQuantityKg: siloTransferRules.maxQuantityKg,
        requiresAuthorization: siloTransferRules.requiresAuthorization,
        authorizationStatus: siloTransferRules.authorizationStatus,
        validationStatus: siloTransferRules.validationStatus,
        isActive: siloTransferRules.isActive,
        restrictions: siloTransferRules.restrictions,
        sourceReference: siloTransferRules.sourceReference,
        approvedByUserId: siloTransferRules.approvedByUserId,
        approvedAt: siloTransferRules.approvedAt,
        updatedByUserId: siloTransferRules.updatedByUserId,
        updatedAt: siloTransferRules.updatedAt,
        createdAt: siloTransferRules.createdAt,
      })
      .from(siloTransferRules)
      .innerJoin(materials, eq(siloTransferRules.materialId, materials.id))
      .orderBy(asc(siloTransferRules.id)),
    db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityType, 'silo_transfer_rules'))
      .orderBy(desc(auditEvents.createdAt))
      .limit(200),
  ]);

  const siloMap = new Map(allSilos.map((s) => [s.id, s]));
  const lineMap = new Map(allLines.map((l) => [l.id, l]));
  const userMap = new Map(allUsers.map((u) => [u.id, u.displayName]));

  const historyByRule = new Map<string, typeof ruleAudit>();
  for (const ev of ruleAudit) {
    const arr = historyByRule.get(ev.entityId) ?? [];
    arr.push(ev);
    historyByRule.set(ev.entityId, arr);
  }

  return rules.map((r) => {
    const origin = siloMap.get(r.originSiloId);
    const dest = siloMap.get(r.destinationSiloId);
    const destLineId = r.relatedLineId ?? dest?.productionLineId ?? null;
    const line = destLineId ? lineMap.get(destLineId) : null;

    return {
      id: r.id,
      originSiloId: r.originSiloId,
      originSiloNumber: origin?.siloNumber ?? null,
      destinationSiloId: r.destinationSiloId,
      destinationSiloNumber: dest?.siloNumber ?? null,
      materialId: r.materialId,
      materialCode: r.materialCode,
      materialDescription: r.materialDescription,
      relatedLineId: destLineId,
      relatedLineCode: line?.code ?? null,
      relatedLineName: line?.name ?? null,
      operationType: r.operationType,
      maxQuantityKg: r.maxQuantityKg ? Number(r.maxQuantityKg) : null,
      requiresAuthorization: r.requiresAuthorization,
      authorizationStatus: (r.authorizationStatus ||
        (r.isActive && r.validationStatus === 'VALIDADO'
          ? 'AUTORIZADA'
          : 'PENDENTE_VALIDACAO')) as RouteAuthorizationStatus,
      validationStatus: r.validationStatus,
      isActive: r.isActive,
      restrictions: r.restrictions,
      sourceReference: r.sourceReference,
      approvedByName: r.approvedByUserId ? (userMap.get(r.approvedByUserId) ?? null) : null,
      approvedAt: r.approvedAt,
      updatedByName: r.updatedByUserId ? (userMap.get(r.updatedByUserId) ?? null) : null,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
      history: (historyByRule.get(String(r.id)) ?? []).slice(0, 12),
    };
  });
}

export async function createAuthorizedRoute(
  input: {
    originSiloId: number;
    destinationSiloId: number;
    materialId: number;
    maxQuantityKg?: number | null;
    authorizationStatus?: RouteAuthorizationStatus;
    restrictions?: string | null;
    sourceReference?: string | null;
    reason: string;
  },
  actor: AuthenticatedAppUser
) {
  if (input.originSiloId === input.destinationSiloId) {
    throw new OperationalConflictError('Silo de origem e destino devem ser distintos.', 400);
  }
  if (!input.reason || input.reason.trim().length < 5) {
    throw new OperationalConflictError(
      'Informe justificativa operacional (mínimo 5 caracteres) para cadastrar rota.',
      400
    );
  }
  const authStatus: RouteAuthorizationStatus = input.authorizationStatus || 'PENDENTE_VALIDACAO';
  if (!VALID_ROUTE_STATUSES.includes(authStatus)) {
    throw new OperationalConflictError('Status de autorização inválido.', 400);
  }

  return db.transaction(async (tx) => {
    const snapshots = await loadSiloSnapshotsLockedTx(tx, [
      input.originSiloId,
      input.destinationSiloId,
    ]);
    const origin = snapshots.get(input.originSiloId);
    const dest = snapshots.get(input.destinationSiloId);
    if (!origin || !dest) {
      throw new OperationalConflictError('Silo de origem ou destino não encontrado.', 404);
    }

    const matRows = await tx
      .select()
      .from(materials)
      .where(eq(materials.id, input.materialId))
      .limit(1);
    if (matRows.length === 0) {
      throw new OperationalConflictError('Matéria-prima não encontrada.', 404);
    }

    // Validação oficial de compatibilidade do catálogo
    const compatibilities = await loadCompatibilitiesTx(tx);
    if (!isSiloCompatibleForMaterial(dest, input.materialId, compatibilities, 'TRANSFER_IN')) {
      throw new OperationalConflictError(
        `Material ${matRows[0].code} não é compatível com o Silo de destino ${dest.siloNumber} no cadastro oficial.`,
        400
      );
    }

    const dup = await tx
      .select()
      .from(siloTransferRules)
      .where(
        and(
          eq(siloTransferRules.originSiloId, input.originSiloId),
          eq(siloTransferRules.destinationSiloId, input.destinationSiloId),
          eq(siloTransferRules.materialId, input.materialId)
        )
      )
      .limit(1);

    if (dup.length > 0) {
      throw new OperationalConflictError(
        `Já existe uma rota cadastrada para Silo ${origin.siloNumber} → Silo ${dest.siloNumber} (${matRows[0].code}). Utilize a alteração de status para autorizar/suspender.`,
        409
      );
    }

    const destSiloRow = await tx
      .select({ productionLineId: silos.productionLineId })
      .from(silos)
      .where(eq(silos.id, input.destinationSiloId))
      .limit(1);

    const isAuthorized = authStatus === 'AUTORIZADA';

    const [created] = await tx
      .insert(siloTransferRules)
      .values({
        originSiloId: input.originSiloId,
        destinationSiloId: input.destinationSiloId,
        materialId: input.materialId,
        relatedLineId: destSiloRow[0]?.productionLineId ?? null,
        operationType: 'TRANSFERENCIA_INTERNA',
        maxQuantityKg:
          input.maxQuantityKg && Number(input.maxQuantityKg) > 0
            ? Number(input.maxQuantityKg).toFixed(2)
            : null,
        requiresAuthorization: !isAuthorized,
        authorizationStatus: authStatus,
        validationStatus: isAuthorized ? 'VALIDADO' : authStatus,
        isActive: isAuthorized,
        restrictions: input.restrictions?.trim() || null,
        sourceReference: input.sourceReference?.trim() || input.reason.trim(),
        approvedByUserId: isAuthorized ? actor.id : null,
        approvedAt: isAuthorized ? new Date() : null,
        updatedByUserId: actor.id,
        updatedAt: new Date(),
      })
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'ROUTE_CREATED',
      entityType: 'silo_transfer_rules',
      entityId: String(created.id),
      previousValue: null,
      newValue: JSON.stringify({
        originSilo: origin.siloNumber,
        destinationSilo: dest.siloNumber,
        materialCode: matRows[0].code,
        authorizationStatus: authStatus,
        maxQuantityKg: created.maxQuantityKg,
      }),
      reason: input.reason.trim(),
      origin: 'AUTHORIZED_ROUTES',
    });

    return created;
  });
}

export async function updateAuthorizedRouteStatus(
  ruleId: number,
  input: {
    authorizationStatus: RouteAuthorizationStatus;
    maxQuantityKg?: number | null;
    restrictions?: string | null;
    reason: string;
  },
  actor: AuthenticatedAppUser
) {
  if (!VALID_ROUTE_STATUSES.includes(input.authorizationStatus)) {
    throw new OperationalConflictError('Status de rota inválido.', 400);
  }
  if (!input.reason || input.reason.trim().length < 5) {
    throw new OperationalConflictError(
      'Informe justificativa obrigatória (mínimo 5 caracteres) para alterar o status da rota.',
      400
    );
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(siloTransferRules)
      .where(eq(siloTransferRules.id, ruleId))
      .limit(1);
    if (existing.length === 0) {
      throw new OperationalConflictError('Rota de transferência não encontrada.', 404);
    }
    const prev = existing[0];

    const snapshots = await loadSiloSnapshotsLockedTx(tx, [
      prev.originSiloId,
      prev.destinationSiloId,
    ]);
    const dest = snapshots.get(prev.destinationSiloId);
    const origin = snapshots.get(prev.originSiloId);

    if (input.authorizationStatus === 'AUTORIZADA' && dest && origin) {
      const compatibilities = await loadCompatibilitiesTx(tx);
      if (!isSiloCompatibleForMaterial(dest, prev.materialId, compatibilities, 'TRANSFER_IN')) {
        throw new OperationalConflictError(
          `Não é possível autorizar esta rota: o material não é compatível com o Silo ${dest.siloNumber} no cadastro oficial.`,
          400
        );
      }
    }

    const isAuthorized = input.authorizationStatus === 'AUTORIZADA';

    const [updated] = await tx
      .update(siloTransferRules)
      .set({
        authorizationStatus: input.authorizationStatus,
        validationStatus: isAuthorized ? 'VALIDADO' : input.authorizationStatus,
        isActive: isAuthorized,
        requiresAuthorization: !isAuthorized,
        maxQuantityKg:
          input.maxQuantityKg !== undefined
            ? input.maxQuantityKg && Number(input.maxQuantityKg) > 0
              ? Number(input.maxQuantityKg).toFixed(2)
              : null
            : prev.maxQuantityKg,
        restrictions: input.restrictions !== undefined ? input.restrictions : prev.restrictions,
        approvedByUserId: isAuthorized ? actor.id : prev.approvedByUserId,
        approvedAt: isAuthorized ? new Date() : prev.approvedAt,
        updatedByUserId: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(siloTransferRules.id, ruleId))
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'ROUTE_STATUS_UPDATED',
      entityType: 'silo_transfer_rules',
      entityId: String(ruleId),
      previousValue: JSON.stringify({
        authorizationStatus: prev.authorizationStatus,
        isActive: prev.isActive,
        maxQuantityKg: prev.maxQuantityKg,
      }),
      newValue: JSON.stringify({
        authorizationStatus: updated.authorizationStatus,
        isActive: updated.isActive,
        maxQuantityKg: updated.maxQuantityKg,
        restrictions: updated.restrictions,
      }),
      reason: input.reason.trim(),
      origin: 'AUTHORIZED_ROUTES',
    });

    return updated;
  });
}

// =========================================================================
// 2. ORDENS DE TRANSFERÊNCIA (PLANEJADA, INÍCIO, PARCIAL, CONCLUÍDA, INTERROMPIDA)
// =========================================================================

export async function listTransferOrdersWithSteps() {
  const [orders, steps, allSilos, allLines, allUsers] = await Promise.all([
    db
      .select({
        id: transferOrders.id,
        orderCode: transferOrders.orderCode,
        transferRuleId: transferOrders.transferRuleId,
        originSiloId: transferOrders.originSiloId,
        destinationSiloId: transferOrders.destinationSiloId,
        materialId: transferOrders.materialId,
        materialCode: materials.code,
        materialDescription: materials.description,
        productionLineId: transferOrders.productionLineId,
        recommendationId: transferOrders.recommendationId,
        lotCode: transferOrders.lotCode,
        plannedQuantityKg: transferOrders.plannedQuantityKg,
        transferredQuantityKg: transferOrders.transferredQuantityKg,
        status: transferOrders.status,
        priority: transferOrders.priority,
        requestedByUserId: transferOrders.requestedByUserId,
        approvedByUserId: transferOrders.approvedByUserId,
        assignedOperatorUserId: transferOrders.assignedOperatorUserId,
        interruptedByUserId: transferOrders.interruptedByUserId,
        shiftCode: transferOrders.shiftCode,
        operationalDate: transferOrders.operationalDate,
        startedAt: transferOrders.startedAt,
        finishedAt: transferOrders.finishedAt,
        interruptedAt: transferOrders.interruptedAt,
        interruptionReason: transferOrders.interruptionReason,
        notes: transferOrders.notes,
        version: transferOrders.version,
        createdAt: transferOrders.createdAt,
        updatedAt: transferOrders.updatedAt,
      })
      .from(transferOrders)
      .innerJoin(materials, eq(transferOrders.materialId, materials.id))
      .orderBy(desc(transferOrders.createdAt))
      .limit(100),
    db.select().from(transferExecutionSteps).orderBy(asc(transferExecutionSteps.stepNumber)),
    db.select().from(silos),
    db.select().from(productionLines),
    db.select().from(users),
  ]);

  const siloMap = new Map(allSilos.map((s) => [s.id, s]));
  const lineMap = new Map(allLines.map((l) => [l.id, l]));
  const userMap = new Map(allUsers.map((u) => [u.id, u.displayName]));

  const stepsByOrder = new Map<number, any[]>();
  for (const st of steps) {
    const arr = stepsByOrder.get(st.transferOrderId) ?? [];
    let lotComposition: Array<{ lotCode: string | null; quantityKg: number }> = [];
    try {
      lotComposition = JSON.parse(st.lotCompositionJson);
    } catch {
      lotComposition = [];
    }
    arr.push({
      id: st.id,
      transferOrderId: st.transferOrderId,
      stepNumber: st.stepNumber,
      quantityKg: Number(st.quantityKg),
      lotComposition,
      referenceDocument: st.referenceDocument,
      debitMovementId: st.debitMovementId,
      creditMovementId: st.creditMovementId,
      executedByName: st.executedByName || userMap.get(st.executedByUserId) || 'Operador',
      executedByBadge: st.executedByBadge ?? null,
      shiftCode: st.shiftCode,
      operationalDate: st.operationalDate,
      startedAt: st.startedAt,
      finishedAt: st.finishedAt,
      notes: st.notes,
      status: st.status,
      createdAt: st.createdAt,
    });
    stepsByOrder.set(st.transferOrderId, arr);
  }

  return orders.map((o) => {
    const origin = siloMap.get(o.originSiloId);
    const dest = siloMap.get(o.destinationSiloId);
    const lineId = o.productionLineId ?? dest?.productionLineId ?? null;
    const line = lineId ? lineMap.get(lineId) : null;
    const planned = Number(o.plannedQuantityKg);
    const transferred = Number(o.transferredQuantityKg);
    const remaining = Math.max(0, Math.round((planned - transferred) * 1000) / 1000);

    return {
      ...o,
      originSiloNumber: origin?.siloNumber ?? null,
      destinationSiloNumber: dest?.siloNumber ?? null,
      lineCode: line?.code ?? null,
      lineName: line?.name ?? null,
      plannedQuantityKg: planned,
      transferredQuantityKg: transferred,
      remainingQuantityKg: remaining,
      requestedByName: userMap.get(o.requestedByUserId) ?? 'Usuário',
      approvedByName: o.approvedByUserId ? (userMap.get(o.approvedByUserId) ?? null) : null,
      assignedOperatorName: o.assignedOperatorUserId
        ? (userMap.get(o.assignedOperatorUserId) ?? null)
        : null,
      interruptedByName: o.interruptedByUserId ? (userMap.get(o.interruptedByUserId) ?? null) : null,
      steps: stepsByOrder.get(o.id) ?? [],
    };
  });
}

export async function createTransferOrderTransactional(
  input: {
    transferRuleId?: number;
    originSiloId: number;
    destinationSiloId: number;
    materialId: number;
    plannedQuantityKg: number;
    lotCode?: string | null;
    priority?: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
    recommendationId?: number | null;
    recommendationKey?: string | null;
    notes?: string | null;
    idempotencyKey?: string;
  },
  actor: AuthenticatedAppUser
) {
  const qty = Number(input.plannedQuantityKg);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new OperationalConflictError('Quantidade planejada deve ser maior que zero.', 400);
  }

  return db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredFromExecutor(tx);
    // 1. Idempotência estrita contra duplicidade de cliques/requisições
    if (input.idempotencyKey) {
      const dup = await tx
        .select()
        .from(transferOrders)
        .where(eq(transferOrders.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (dup.length > 0) {
        throw new OperationalConflictError(
          `Esta solicitação de transferência já foi registrada (${dup[0].orderCode}). Operação bloqueada para evitar duplicidade.`,
          409,
          { existingOrder: dup[0] }
        );
      }
    }

    const snapshots = await loadSiloSnapshotsLockedTx(tx, [
      input.originSiloId,
      input.destinationSiloId,
    ]);
    const originSilo = snapshots.get(input.originSiloId);
    const destSilo = snapshots.get(input.destinationSiloId);
    if (!originSilo || !destSilo) {
      throw new OperationalConflictError('Silo de origem ou destino não encontrado.', 404);
    }

    const compatibilities = await loadCompatibilitiesTx(tx);

    const ruleRows = input.transferRuleId
      ? await tx
          .select()
          .from(siloTransferRules)
          .where(eq(siloTransferRules.id, input.transferRuleId))
          .limit(1)
      : await tx
          .select()
          .from(siloTransferRules)
          .where(
            and(
              eq(siloTransferRules.originSiloId, input.originSiloId),
              eq(siloTransferRules.destinationSiloId, input.destinationSiloId),
              eq(siloTransferRules.materialId, input.materialId)
            )
          )
          .limit(1);

    const ruleRow = ruleRows[0] ?? null;

    const validation = validateTransferExecution({
      originSilo,
      destinationSilo: destSilo,
      materialId: input.materialId,
      quantityKg: qty,
      compatibilities,
      rule: ruleRow
        ? {
            isActive: ruleRow.isActive,
            validationStatus: ruleRow.validationStatus,
            authorizationStatus: ruleRow.authorizationStatus,
            maxQuantityKg: ruleRow.maxQuantityKg ? Number(ruleRow.maxQuantityKg) : null,
          }
        : null,
    });

    if (!validation.valid) {
      throw new OperationalConflictError(validation.errors.join(' | '), 400, {
        errors: validation.errors,
      });
    }

    // Verifica recomendação vinculada (por id ou key) para evitar múltiplas ordens ativas idênticas sem ciência
    let resolvedRecId = input.recommendationId ?? null;
    if (!resolvedRecId && input.recommendationKey) {
      const recMatch = await tx
        .select()
        .from(operationalRecommendations)
        .where(eq(operationalRecommendations.recommendationKey, input.recommendationKey))
        .limit(1);
      if (recMatch.length > 0) resolvedRecId = recMatch[0].id;
    }

    const orderCode = generateTransferOrderCode();
    const destRow = await tx
      .select({ productionLineId: silos.productionLineId })
      .from(silos)
      .where(eq(silos.id, input.destinationSiloId))
      .limit(1);

    const originLots = await loadOriginLotsNetTx(tx, input.originSiloId, input.materialId);
    const allocatedPreview = allocateLotsForTransfer({
      originLots,
      requestedQuantityKg: qty,
      preferredLotCode: input.lotCode,
    });
    if (!allocatedPreview.valid) {
      throw new OperationalConflictError(
        allocatedPreview.error || 'Saldo de lotes insuficiente na origem.',
        400
      );
    }

    const [created] = await tx
      .insert(transferOrders)
      .values({
        orderCode,
        transferRuleId: ruleRow.id,
        originSiloId: input.originSiloId,
        destinationSiloId: input.destinationSiloId,
        materialId: input.materialId,
        productionLineId: ruleRow.relatedLineId ?? destRow[0]?.productionLineId ?? null,
        recommendationId: resolvedRecId,
        lotCode: allocatedPreview.summaryLotCode,
        plannedQuantityKg: qty.toFixed(3),
        transferredQuantityKg: '0.000',
        status: 'PLANEJADA',
        priority: input.priority || 'ALTA',
        requestedByUserId: actor.id,
        approvedByUserId: ruleRow.approvedByUserId ?? null,
        shiftCode: shift.shiftCode,
        operationalDate: shift.operationalDate,
        notes: input.notes?.trim() || null,
        idempotencyKey: input.idempotencyKey || null,
        version: 1,
      })
      .returning();

    if (resolvedRecId) {
      await tx
        .update(operationalRecommendations)
        .set({
          decisionStatus: 'ACEITA',
          decidedByUserId: actor.id,
          decisionNotes: `Ordem de transferência ${orderCode} planejada para execução.`,
          decidedAt: new Date(),
          linkedTransferOrderId: created.id,
        })
        .where(eq(operationalRecommendations.id, resolvedRecId));
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'TRANSFER_ORDER_CREATED',
      entityType: 'transfer_orders',
      entityId: orderCode,
      previousValue: null,
      newValue: JSON.stringify({
        orderCode,
        originSilo: originSilo.siloNumber,
        destinationSilo: destSilo.siloNumber,
        plannedQuantityKg: qty,
        lotCode: allocatedPreview.summaryLotCode,
        status: 'PLANEJADA',
      }),
      reason: input.notes?.trim() || 'Planejamento de transferência entre silos',
      origin: 'TRANSFER_ORDERS',
    });

    return created;
  });
}

export async function startTransferOrder(
  orderId: number,
  actor: AuthenticatedAppUser,
  notes?: string | null
) {
  return db.transaction(async (tx) => {
    const lockedRes = await tx.execute(
      sql`SELECT * FROM transfer_orders WHERE id = ${orderId} FOR UPDATE`
    );
    const row: any = lockedRes.rows?.[0];
    if (!row) {
      throw new OperationalConflictError('Ordem de transferência não encontrada.', 404);
    }
    if (row.status !== 'PLANEJADA') {
      throw new OperationalConflictError(
        `Ordem ${row.order_code} não pode ser iniciada pois está em status ${row.status}.`,
        409
      );
    }

    // Revalida rota antes de autorizar início operacional
    const ruleRows = await tx
      .select()
      .from(siloTransferRules)
      .where(eq(siloTransferRules.id, Number(row.transfer_rule_id)))
      .limit(1);
    const rule = ruleRows[0];
    if (!rule || rule.authorizationStatus !== 'AUTORIZADA' || !rule.isActive) {
      throw new OperationalConflictError(
        `Início bloqueado: a rota vinculada está ${rule?.authorizationStatus || 'INATIVA'}.`,
        400
      );
    }

    const [updated] = await tx
      .update(transferOrders)
      .set({
        status: 'EM_ANDAMENTO',
        startedAt: new Date(),
        assignedOperatorUserId: actor.id,
        notes: notes?.trim() ? `${row.notes ? row.notes + ' | ' : ''}${notes.trim()}` : row.notes,
        version: Number(row.version) + 1,
        updatedAt: new Date(),
      })
      .where(eq(transferOrders.id, orderId))
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'TRANSFER_ORDER_STARTED',
      entityType: 'transfer_orders',
      entityId: row.order_code,
      previousValue: JSON.stringify({ status: row.status }),
      newValue: JSON.stringify({ status: 'EM_ANDAMENTO', assignedOperator: actor.displayName }),
      reason: notes?.trim() || 'Início operacional da transferência registrado',
      origin: 'TRANSFER_ORDERS',
    });

    return updated;
  });
}

export async function executeTransferOrderStepTransactional(
  input: {
    orderId: number;
    quantityKg: number;
    expectedVersion?: number;
    preferredLotCode?: string | null;
    executedByName?: string | null;
    executedByBadge?: string | null;
    notes?: string | null;
    idempotencyKey?: string;
  },
  actor: AuthenticatedAppUser
) {
  const qtyNow = Math.round(Number(input.quantityKg) * 1000) / 1000;
  if (!Number.isFinite(qtyNow) || qtyNow <= 0) {
    throw new OperationalConflictError('Quantidade da etapa deve ser maior que zero.', 400);
  }

  return db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredFromExecutor(tx);
    // 1. Idempotência por etapa
    if (input.idempotencyKey) {
      const dupMov = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.idempotencyKey, `${input.idempotencyKey}:out:0`))
        .limit(1);
      if (dupMov.length > 0) {
        throw new OperationalConflictError(
          'Esta etapa de transferência já foi registrada anteriormente.',
          409
        );
      }
    }

    // 2. Lock na ordem de transferência + validação de concorrência
    const lockedRes = await tx.execute(
      sql`SELECT * FROM transfer_orders WHERE id = ${input.orderId} FOR UPDATE`
    );
    const ord: any = lockedRes.rows?.[0];
    if (!ord) {
      throw new OperationalConflictError('Ordem de transferência não encontrada.', 404);
    }
    if (['CONCLUIDA', 'CANCELADA', 'INTERROMPIDA'].includes(ord.status)) {
      throw new OperationalConflictError(
        `Ordem ${ord.order_code} não aceita novas movimentações (status atual: ${ord.status}).`,
        409
      );
    }
    if (input.expectedVersion !== undefined && Number(ord.version) !== input.expectedVersion) {
      throw new OperationalConflictError(
        'Esta ordem foi atualizada por outro operador. Recarregue para conferir o saldo restante antes de confirmar.',
        409
      );
    }

    const plannedKg = Number(ord.planned_quantity_kg);
    const transferredBeforeKg = Number(ord.transferred_quantity_kg);
    const remainingBeforeKg = Math.max(0, Math.round((plannedKg - transferredBeforeKg) * 1000) / 1000);

    if (qtyNow > remainingBeforeKg + 0.001) {
      throw new OperationalConflictError(
        `Quantidade informada (${qtyNow.toLocaleString('pt-BR')} kg) excede o saldo pendente da ordem (${remainingBeforeKg.toLocaleString('pt-BR')} kg).`,
        400
      );
    }

    // 3. Lock nos silos origem e destino em ordem ascendente (evita deadlock entre operadores)
    const originSiloId = Number(ord.origin_silo_id);
    const destinationSiloId = Number(ord.destination_silo_id);
    const materialId = Number(ord.material_id);

    const snapshots = await loadSiloSnapshotsLockedTx(tx, [originSiloId, destinationSiloId]);
    const originSilo = snapshots.get(originSiloId);
    const destSilo = snapshots.get(destinationSiloId);
    if (!originSilo || !destSilo) {
      throw new OperationalConflictError('Silo de origem ou destino não encontrado.', 404);
    }

    const compatibilities = await loadCompatibilitiesTx(tx);
    const ruleRows = await tx
      .select()
      .from(siloTransferRules)
      .where(eq(siloTransferRules.id, Number(ord.transfer_rule_id)))
      .limit(1);
    const rule = ruleRows[0] ?? null;

    const validation = validateTransferExecution({
      originSilo,
      destinationSilo: destSilo,
      materialId,
      quantityKg: qtyNow,
      compatibilities,
      rule: rule
        ? {
            isActive: rule.isActive,
            validationStatus: rule.validationStatus,
            authorizationStatus: rule.authorizationStatus,
            maxQuantityKg: rule.maxQuantityKg ? Number(rule.maxQuantityKg) : null,
          }
        : null,
    });

    if (!validation.valid) {
      throw new OperationalConflictError(validation.errors.join(' | '), 400, {
        errors: validation.errors,
      });
    }

    // 4. Alocação preservando os lotes originais reais na origem
    const originLots = await loadOriginLotsNetTx(tx, originSiloId, materialId);
    const lotAllocation = allocateLotsForTransfer({
      originLots,
      requestedQuantityKg: qtyNow,
      preferredLotCode: input.preferredLotCode || ord.lot_code,
    });
    if (!lotAllocation.valid) {
      throw new OperationalConflictError(
        lotAllocation.error || 'Falha na alocação de lote na origem.',
        400
      );
    }

    const existingStepsCountRows = await tx
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(transferExecutionSteps)
      .where(eq(transferExecutionSteps.transferOrderId, input.orderId));
    const stepNumber = Number(existingStepsCountRows[0]?.cnt || 0) + 1;
    const stepRefDoc = `${ord.order_code}-E${stepNumber}`;
    const stepStartedAt = ord.started_at ? new Date(ord.started_at) : new Date();
    const stepFinishedAt = new Date();

    let firstDebitId: number | null = null;
    let firstCreditId: number | null = null;

    for (let idx = 0; idx < lotAllocation.slices.length; idx++) {
      const slice = lotAllocation.slices[idx];
      const sliceQtyStr = slice.quantityKg.toFixed(3);
      const reasonText =
        input.notes?.trim() ||
        `Ordem ${ord.order_code} · Etapa ${stepNumber} (Silo ${originSilo.siloNumber} → Silo ${destSilo.siloNumber})`;

      const [debitMov] = await tx
        .insert(inventoryMovements)
        .values({
          movementType: 'TRANSFERENCIA',
          siloId: originSiloId,
          counterpartSiloId: destinationSiloId,
          materialId,
          lotCode: slice.lotCode,
          quantityKg: sliceQtyStr,
          unit: 'kg',
          direction: 'DEBIT',
          referenceDocument: stepRefDoc,
          transferOrderId: input.orderId,
          status: 'CONFIRMADO',
          reason: reasonText,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:out:${idx}` : null,
          shiftCode: shift.shiftCode,
          operationalDate: shift.operationalDate,
          performedByUserId: actor.id,
          authorizedByUserId: ord.approved_by_user_id ? Number(ord.approved_by_user_id) : actor.id,
          executedByName: input.executedByName?.trim() || null,
          executedByBadge: input.executedByBadge?.trim() || null,
        })
        .returning();

      const [creditMov] = await tx
        .insert(inventoryMovements)
        .values({
          movementType: 'TRANSFERENCIA',
          siloId: destinationSiloId,
          counterpartSiloId: originSiloId,
          materialId,
          lotCode: slice.lotCode,
          quantityKg: sliceQtyStr,
          unit: 'kg',
          direction: 'CREDIT',
          referenceDocument: stepRefDoc,
          transferOrderId: input.orderId,
          status: 'CONFIRMADO',
          reason: reasonText,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:in:${idx}` : null,
          shiftCode: shift.shiftCode,
          operationalDate: shift.operationalDate,
          performedByUserId: actor.id,
          authorizedByUserId: ord.approved_by_user_id ? Number(ord.approved_by_user_id) : actor.id,
          executedByName: input.executedByName?.trim() || null,
          executedByBadge: input.executedByBadge?.trim() || null,
        })
        .returning();

      if (idx === 0) {
        firstDebitId = debitMov.id;
        firstCreditId = creditMov.id;
      }
    }

    const [createdStep] = await tx
      .insert(transferExecutionSteps)
      .values({
        transferOrderId: input.orderId,
        stepNumber,
        quantityKg: qtyNow.toFixed(3),
        lotCompositionJson: JSON.stringify(lotAllocation.slices),
        referenceDocument: stepRefDoc,
        debitMovementId: firstDebitId,
        creditMovementId: firstCreditId,
        executedByUserId: actor.id,
        executedByName: input.executedByName?.trim() || null,
        executedByBadge: input.executedByBadge?.trim() || null,
        shiftCode: shift.shiftCode,
        operationalDate: shift.operationalDate,
        startedAt: stepStartedAt,
        finishedAt: stepFinishedAt,
        notes: input.notes?.trim() || null,
        status: 'CONFIRMADA',
      })
      .returning();

    const newTransferredKg = Math.round((transferredBeforeKg + qtyNow) * 1000) / 1000;
    const remainingAfterKg = Math.max(0, Math.round((plannedKg - newTransferredKg) * 1000) / 1000);
    const nextStatus = remainingAfterKg <= 0.001 ? 'CONCLUIDA' : 'PARCIAL';

    const [updatedOrder] = await tx
      .update(transferOrders)
      .set({
        transferredQuantityKg: newTransferredKg.toFixed(3),
        lotCode: lotAllocation.summaryLotCode || ord.lot_code,
        status: nextStatus,
        startedAt: ord.started_at ? new Date(ord.started_at) : stepStartedAt,
        finishedAt: nextStatus === 'CONCLUIDA' ? stepFinishedAt : null,
        assignedOperatorUserId: actor.id,
        version: Number(ord.version) + 1,
        updatedAt: new Date(),
      })
      .where(eq(transferOrders.id, input.orderId))
      .returning();

    if (nextStatus === 'CONCLUIDA' && ord.recommendation_id) {
      await tx
        .update(operationalRecommendations)
        .set({
          decisionStatus: 'EXECUTADA',
          decidedAt: new Date(),
        })
        .where(eq(operationalRecommendations.id, Number(ord.recommendation_id)));
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: nextStatus === 'CONCLUIDA' ? 'TRANSFER_ORDER_COMPLETED' : 'TRANSFER_STEP_PARTIAL',
      entityType: 'transfer_orders',
      entityId: ord.order_code,
      previousValue: JSON.stringify({
        transferredQuantityKg: transferredBeforeKg,
        status: ord.status,
        originStockBeforeKg: originSilo.confirmedStockKg,
        destStockBeforeKg: destSilo.confirmedStockKg,
      }),
      newValue: JSON.stringify({
        stepNumber,
        addedQuantityKg: qtyNow,
        transferredQuantityKg: newTransferredKg,
        remainingQuantityKg: remainingAfterKg,
        status: nextStatus,
        lots: lotAllocation.slices,
        originStockAfterKg: originSilo.confirmedStockKg - qtyNow,
        destStockAfterKg: destSilo.confirmedStockKg + qtyNow,
      }),
      reason:
        input.notes?.trim() ||
        `Etapa ${stepNumber} (${nextStatus}) — Silo ${originSilo.siloNumber} → Silo ${destSilo.siloNumber}`,
      origin: 'TRANSFER_EXECUTION',
    });

    return {
      order: updatedOrder,
      step: createdStep,
      lotSlices: lotAllocation.slices,
      remainingQuantityKg: remainingAfterKg,
    };
  });
}

export async function interruptTransferOrder(
  orderId: number,
  reason: string,
  actor: AuthenticatedAppUser
) {
  if (!reason || reason.trim().length < 5) {
    throw new OperationalConflictError(
      'Informe motivo obrigatório (mínimo 5 caracteres) para interromper a transferência.',
      400
    );
  }

  return db.transaction(async (tx) => {
    const lockedRes = await tx.execute(
      sql`SELECT * FROM transfer_orders WHERE id = ${orderId} FOR UPDATE`
    );
    const ord: any = lockedRes.rows?.[0];
    if (!ord) {
      throw new OperationalConflictError('Ordem de transferência não encontrada.', 404);
    }
    if (['CONCLUIDA', 'CANCELADA', 'INTERROMPIDA'].includes(ord.status)) {
      throw new OperationalConflictError(
        `Ordem ${ord.order_code} já está em status ${ord.status} e não pode ser interrompida.`,
        409
      );
    }

    const [updated] = await tx
      .update(transferOrders)
      .set({
        status: 'INTERROMPIDA',
        interruptedByUserId: actor.id,
        interruptedAt: new Date(),
        interruptionReason: reason.trim(),
        version: Number(ord.version) + 1,
        updatedAt: new Date(),
      })
      .where(eq(transferOrders.id, orderId))
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'TRANSFER_ORDER_INTERRUPTED',
      entityType: 'transfer_orders',
      entityId: ord.order_code,
      previousValue: JSON.stringify({
        status: ord.status,
        transferredQuantityKg: Number(ord.transferred_quantity_kg),
      }),
      newValue: JSON.stringify({
        status: 'INTERROMPIDA',
        interruptionReason: reason.trim(),
      }),
      reason: reason.trim(),
      origin: 'TRANSFER_EXECUTION',
    });

    return updated;
  });
}

// =========================================================================
// 3. PAINEL DE ABASTECIMENTO DA PRODUÇÃO, PRIORIZAÇÃO & SOLICITAÇÕES
// =========================================================================

export async function getPriorityConfig() {
  const rows = await db
    .select()
    .from(operationalPriorityConfigs)
    .where(eq(operationalPriorityConfigs.isActive, true))
    .limit(1);

  if (rows.length === 0) {
    return {
      code: 'PADRAO_INDUSTRIAL',
      name: 'Priorização Operacional Padrão',
      description: 'Critérios configuráveis de priorização operacional.',
      ...DEFAULT_PRIORITY_WEIGHTS,
      updatedAt: new Date().toISOString(),
    };
  }

  return rows[0];
}

export async function updatePriorityConfig(
  weights: PriorityWeightsConfig,
  actor: AuthenticatedAppUser,
  reason: string
) {
  const values = [
    weights.weightLineStopRisk,
    weights.weightStockCoverage,
    weights.weightAuthorizedRoute,
    weights.weightOriginAvailability,
    weights.weightScheduleUrgency,
  ];
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) {
    throw new OperationalConflictError('Pesos de priorização devem estar entre 0 e 100.', 400);
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(operationalPriorityConfigs)
      .where(eq(operationalPriorityConfigs.code, 'PADRAO_INDUSTRIAL'))
      .limit(1);

    const prev = existing[0] ?? null;

    const [saved] = await tx
      .insert(operationalPriorityConfigs)
      .values({
        code: 'PADRAO_INDUSTRIAL',
        name: 'Priorização Operacional Padrão',
        description:
          'Ponderação configurável de risco de parada da linha, cobertura atual, rota autorizada, disponibilidade na origem e urgência da programação.',
        weightLineStopRisk: Math.round(weights.weightLineStopRisk),
        weightStockCoverage: Math.round(weights.weightStockCoverage),
        weightAuthorizedRoute: Math.round(weights.weightAuthorizedRoute),
        weightOriginAvailability: Math.round(weights.weightOriginAvailability),
        weightScheduleUrgency: Math.round(weights.weightScheduleUrgency),
        isActive: true,
        updatedByUserId: actor.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: operationalPriorityConfigs.code,
        set: {
          weightLineStopRisk: Math.round(weights.weightLineStopRisk),
          weightStockCoverage: Math.round(weights.weightStockCoverage),
          weightAuthorizedRoute: Math.round(weights.weightAuthorizedRoute),
          weightOriginAvailability: Math.round(weights.weightOriginAvailability),
          weightScheduleUrgency: Math.round(weights.weightScheduleUrgency),
          updatedByUserId: actor.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'PRIORITY_CONFIG_UPDATED',
      entityType: 'operational_priority_configs',
      entityId: saved.code,
      previousValue: prev ? JSON.stringify(prev) : null,
      newValue: JSON.stringify(saved),
      reason: reason?.trim() || 'Atualização de pesos de priorização operacional',
      origin: 'SUPPLY_CENTER',
    });

    return saved;
  });
}

export async function listMaterialIntakeRequests() {
  const [rows, allSilos, allLines, allUsers] = await Promise.all([
    db
      .select({
        id: materialIntakeRequests.id,
        requestCode: materialIntakeRequests.requestCode,
        materialId: materialIntakeRequests.materialId,
        materialCode: materials.code,
        materialDescription: materials.description,
        productionLineId: materialIntakeRequests.productionLineId,
        targetSiloId: materialIntakeRequests.targetSiloId,
        recommendationId: materialIntakeRequests.recommendationId,
        neededQuantityKg: materialIntakeRequests.neededQuantityKg,
        neededByDate: materialIntakeRequests.neededByDate,
        priority: materialIntakeRequests.priority,
        justification: materialIntakeRequests.justification,
        status: materialIntakeRequests.status,
        requestedByUserId: materialIntakeRequests.requestedByUserId,
        createdAt: materialIntakeRequests.createdAt,
        updatedAt: materialIntakeRequests.updatedAt,
      })
      .from(materialIntakeRequests)
      .innerJoin(materials, eq(materialIntakeRequests.materialId, materials.id))
      .orderBy(desc(materialIntakeRequests.createdAt))
      .limit(80),
    db.select().from(silos),
    db.select().from(productionLines),
    db.select().from(users),
  ]);

  const siloMap = new Map(allSilos.map((s) => [s.id, s.siloNumber]));
  const lineMap = new Map(allLines.map((l) => [l.id, l.code]));
  const userMap = new Map(allUsers.map((u) => [u.id, u.displayName]));

  return rows.map((r) => ({
    ...r,
    neededQuantityKg: Number(r.neededQuantityKg),
    targetSiloNumber: r.targetSiloId ? (siloMap.get(r.targetSiloId) ?? null) : null,
    lineCode: r.productionLineId ? (lineMap.get(r.productionLineId) ?? null) : null,
    requestedByName: userMap.get(r.requestedByUserId) ?? 'Usuário',
  }));
}

export async function createMaterialIntakeRequestTransactional(
  input: {
    materialId: number;
    productionLineId?: number | null;
    lineCode?: string | null;
    targetSiloId?: number | null;
    recommendationId?: number | null;
    recommendationKey?: string | null;
    neededQuantityKg: number;
    neededByDate?: string | null;
    priority?: string;
    justification: string;
  },
  actor: AuthenticatedAppUser
) {
  const qty = Number(input.neededQuantityKg);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new OperationalConflictError('Quantidade necessária para recebimento deve ser > 0.', 400);
  }
  if (!input.justification || input.justification.trim().length < 5) {
    throw new OperationalConflictError(
      'Justificativa obrigatória (mínimo 5 caracteres) para solicitar recebimento.',
      400
    );
  }

  return db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredFromExecutor(tx);
    let resolvedLineId = input.productionLineId ?? null;
    if (!resolvedLineId && input.lineCode) {
      const l = await tx
        .select()
        .from(productionLines)
        .where(eq(productionLines.code, input.lineCode))
        .limit(1);
      if (l.length > 0) resolvedLineId = l[0].id;
    }

    let resolvedRecId = input.recommendationId ?? null;
    if (!resolvedRecId && input.recommendationKey) {
      const rec = await tx
        .select()
        .from(operationalRecommendations)
        .where(eq(operationalRecommendations.recommendationKey, input.recommendationKey))
        .limit(1);
      if (rec.length > 0) resolvedRecId = rec[0].id;
    }

    const requestCode = generateIntakeRequestCode();
    const [created] = await tx
      .insert(materialIntakeRequests)
      .values({
        requestCode,
        materialId: input.materialId,
        productionLineId: resolvedLineId,
        targetSiloId: input.targetSiloId ?? null,
        recommendationId: resolvedRecId,
        neededQuantityKg: qty.toFixed(3),
        neededByDate: input.neededByDate || shift.operationalDate,
        priority: input.priority || 'ALTA',
        justification: input.justification.trim(),
        status: 'ABERTA',
        requestedByUserId: actor.id,
      })
      .returning();

    if (resolvedRecId) {
      await tx
        .update(operationalRecommendations)
        .set({
          decisionStatus: 'ACEITA',
          decidedByUserId: actor.id,
          decisionNotes: `Solicitação de recebimento ${requestCode} emitida.`,
          decidedAt: new Date(),
        })
        .where(eq(operationalRecommendations.id, resolvedRecId));
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'MATERIAL_INTAKE_REQUESTED',
      entityType: 'material_intake_requests',
      entityId: requestCode,
      previousValue: null,
      newValue: JSON.stringify(created),
      reason: input.justification.trim(),
      origin: 'SUPPLY_CENTER',
    });

    return created;
  });
}

export async function updateSupplyRecommendationDecision(
  input: {
    recommendationId: number;
    decision: 'PENDENTE' | 'EM_ANALISE' | 'ACEITA' | 'REJEITADA';
    decisionNotes?: string | null;
  },
  actor: AuthenticatedAppUser
) {
  if (
    input.decision === 'REJEITADA' &&
    (!input.decisionNotes || input.decisionNotes.trim().length < 5)
  ) {
    throw new OperationalConflictError(
      'Informe justificativa obrigatória (mínimo 5 caracteres) ao rejeitar uma recomendação.',
      400
    );
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(operationalRecommendations)
      .where(eq(operationalRecommendations.id, input.recommendationId))
      .limit(1);
    if (existing.length === 0) {
      throw new OperationalConflictError('Recomendação operacional não encontrada.', 404);
    }
    const prev = existing[0];

    const [updated] = await tx
      .update(operationalRecommendations)
      .set({
        decisionStatus: input.decision,
        decidedByUserId: actor.id,
        decisionNotes: input.decisionNotes?.trim() || null,
        decidedAt: new Date(),
      })
      .where(eq(operationalRecommendations.id, input.recommendationId))
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'SUPPLY_RECOMMENDATION_DECIDED',
      entityType: 'operational_recommendations',
      entityId: String(input.recommendationId),
      previousValue: JSON.stringify({ decisionStatus: prev.decisionStatus }),
      newValue: JSON.stringify({
        decisionStatus: input.decision,
        decisionNotes: updated.decisionNotes,
      }),
      reason: input.decisionNotes?.trim() || `Recomendação marcada como ${input.decision}`,
      origin: 'SUPPLY_CENTER',
    });

    return updated;
  });
}

export async function getProductionSupplyBoard(todayDateParam?: string) {
  const shift = await resolveShiftConfiguredFromExecutor(db);
  const todayDate = todayDateParam || shift.operationalDate;
  const d = new Date(`${todayDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const tomorrowDate = d.toISOString().slice(0, 10);

  const [
    allLines,
    allMaterials,
    allSilos,
    compatRows,
    siloMatMovs,
    lotMovs,
    routesList,
    activeOrders,
    receiptRows,
    approvedSchedules,
    priorityCfg,
    intakeRequestsList,
  ] = await Promise.all([
    db.select().from(productionLines).orderBy(asc(productionLines.sortOrder)),
    db.select().from(materials),
    db
      .select({
        id: silos.id,
        siloNumber: silos.siloNumber,
        lineCode: productionLines.code,
        category: silos.category,
        controlOwner: silos.controlOwner,
        operationalStatus: silos.operationalStatus,
        validationStatus: silos.validationStatus,
        primaryMaterialId: silos.primaryMaterialId,
        nominalCapacityKg: silos.nominalCapacityKg,
        safeCapacityKg: silos.safeCapacityKg,
      })
      .from(silos)
      .innerJoin(productionLines, eq(silos.productionLineId, productionLines.id))
      .orderBy(asc(silos.rubricOrder)),
    db.select().from(siloMaterialCompatibility),
    db
      .select({
        siloId: inventoryMovements.siloId,
        materialId: inventoryMovements.materialId,
        netKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
      })
      .from(inventoryMovements)
      .groupBy(inventoryMovements.siloId, inventoryMovements.materialId),
    db
      .select({
        siloId: inventoryMovements.siloId,
        materialId: inventoryMovements.materialId,
        lotCode: inventoryMovements.lotCode,
        netKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
      })
      .from(inventoryMovements)
      .groupBy(
        inventoryMovements.siloId,
        inventoryMovements.materialId,
        inventoryMovements.lotCode
      ),
    listAuthorizedRoutesWithHistory(),
    db
      .select()
      .from(transferOrders)
      .where(inArray(transferOrders.status, ['PLANEJADA', 'EM_ANDAMENTO', 'PARCIAL'])),
    db
      .select()
      .from(receipts)
      .where(inArray(receipts.status, ['PENDENTE', 'PARCIAL'])),
    db
      .select()
      .from(productionSchedules)
      .where(eq(productionSchedules.status, 'APROVADA')),
    getPriorityConfig(),
    listMaterialIntakeRequests(),
  ]);

  const matMap = new Map(allMaterials.map((m) => [m.id, m]));
  const lineByCode = new Map(allLines.map((l) => [l.code, l]));

  const compatMap = new Map<number, Set<number>>();
  for (const c of compatRows) {
    if (!c.allowReceiving && !c.allowTransferIn) continue;
    const set = compatMap.get(c.siloId) ?? new Set<number>();
    set.add(c.materialId);
    compatMap.set(c.siloId, set);
  }

  const siloTotalStock = new Map<number, number>();
  const siloMaterialStocks = siloMatMovs.map((m) => {
    const net = Number(m.netKg || 0);
    siloTotalStock.set(m.siloId, (siloTotalStock.get(m.siloId) || 0) + net);
    return {
      siloId: m.siloId,
      materialId: m.materialId,
      netKg: net,
    };
  });

  const siloActiveLots = lotMovs
    .map((l) => ({
      siloId: l.siloId,
      materialId: l.materialId,
      lotCode: l.lotCode ? String(l.lotCode).trim().toUpperCase() : null,
      netKg: Number(l.netKg || 0),
    }))
    .filter((l) => l.netKg > 0.001);

  const approvedIds = approvedSchedules.map((s) => s.id);
  const projectionRows =
    approvedIds.length > 0
      ? await db
          .select({
            scheduleId: productionConsumptionProjections.scheduleId,
            scheduleItemId: productionConsumptionProjections.scheduleItemId,
            lineCode: productionLines.code,
            referenceDate: productionConsumptionProjections.referenceDate,
            materialId: productionConsumptionProjections.materialId,
            calculatedConsumptionKg: productionConsumptionProjections.calculatedConsumptionKg,
            realizedConsumptionKg: productionConsumptionProjections.realizedConsumptionKg,
            calculationStatus: productionConsumptionProjections.calculationStatus,
            executionStatus: productionScheduleItems.executionStatus,
          })
          .from(productionConsumptionProjections)
          .innerJoin(
            productionScheduleItems,
            eq(productionConsumptionProjections.scheduleItemId, productionScheduleItems.id)
          )
          .innerJoin(
            productionLines,
            eq(productionConsumptionProjections.productionLineId, productionLines.id)
          )
          .where(inArray(productionConsumptionProjections.scheduleId, approvedIds))
      : [];

  const analysis = computeProductionSupplyAnalysis({
    todayDate,
    tomorrowDate,
    lines: allLines.map((l) => ({ id: l.id, code: l.code, name: l.name })),
    silos: allSilos.map((s) => {
      const compatibleIds = Array.from(compatMap.get(s.id) ?? []);
      if (s.primaryMaterialId && !compatibleIds.includes(s.primaryMaterialId)) {
        compatibleIds.push(s.primaryMaterialId);
      }
      return {
        id: s.id,
        siloNumber: s.siloNumber,
        lineCode: s.lineCode,
        category: s.category,
        controlOwner: s.controlOwner,
        operationalStatus: s.operationalStatus,
        validationStatus: s.validationStatus,
        primaryMaterialId: s.primaryMaterialId,
        compatibleMaterialIds: compatibleIds,
        confirmedStockKg: Math.max(0, siloTotalStock.get(s.id) || 0),
        nominalCapacityKg: Number(s.nominalCapacityKg),
        safeCapacityKg: Number(s.safeCapacityKg),
      };
    }),
    siloMaterialStocks,
    siloActiveLots,
    materials: allMaterials.map((m) => ({
      id: m.id,
      code: m.code,
      description: m.description,
      isCritical: m.isCritical,
    })),
    routes: routesList.map((r) => ({
      id: r.id,
      originSiloId: r.originSiloId,
      originSiloNumber: r.originSiloNumber ?? 0,
      destinationSiloId: r.destinationSiloId,
      destinationSiloNumber: r.destinationSiloNumber ?? 0,
      materialId: r.materialId,
      materialCode: r.materialCode,
      materialDescription: r.materialDescription,
      relatedLineCode: r.relatedLineCode,
      maxQuantityKg: r.maxQuantityKg,
      authorizationStatus: r.authorizationStatus,
      validationStatus: r.validationStatus,
      isActive: r.isActive,
      restrictions: r.restrictions,
    })),
    projections: projectionRows.map((p) => {
      const m = p.materialId ? matMap.get(p.materialId) : null;
      return {
        scheduleId: p.scheduleId,
        scheduleItemId: p.scheduleItemId,
        lineCode: p.lineCode,
        referenceDate: p.referenceDate,
        materialId: p.materialId,
        materialCode: m?.code ?? null,
        materialDescription: m?.description ?? null,
        calculatedConsumptionKg: Number(p.calculatedConsumptionKg),
        realizedConsumptionKg: Number(p.realizedConsumptionKg),
        calculationStatus: p.calculationStatus as 'CALCULADO' | 'PENDENTE_FATOR',
        executionStatus: p.executionStatus as any,
      };
    }),
    pendingReceipts: receiptRows.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      materialId: r.materialId,
      remainingQuantityKg: Math.max(
        0,
        Number(r.receivedQuantityKg) - Number(r.distributedQuantityKg)
      ),
      entryDate: r.entryDate,
      status: r.status,
    })),
    pendingTransferOrders: activeOrders.map((o) => ({
      id: o.id,
      orderCode: o.orderCode,
      originSiloId: o.originSiloId,
      destinationSiloId: o.destinationSiloId,
      materialId: o.materialId,
      plannedQuantityKg: Number(o.plannedQuantityKg),
      transferredQuantityKg: Number(o.transferredQuantityKg),
      status: o.status,
    })),
    priorityWeights: {
      weightLineStopRisk: priorityCfg.weightLineStopRisk,
      weightStockCoverage: priorityCfg.weightStockCoverage,
      weightAuthorizedRoute: priorityCfg.weightAuthorizedRoute,
      weightOriginAvailability: priorityCfg.weightOriginAvailability,
      weightScheduleUrgency: priorityCfg.weightScheduleUrgency,
    },
  });

  // Persistir ou atualizar recomendações no banco sem sobrescrever decisões já registradas
  const persistedRecs: any[] = [];
  for (const rec of analysis.recommendations) {
    const existing = await db
      .select()
      .from(operationalRecommendations)
      .where(eq(operationalRecommendations.recommendationKey, rec.recommendationKey))
      .limit(1);

    const priorityMap =
      rec.visualStatus === 'VERMELHO'
        ? 'VERMELHO'
        : rec.visualStatus === 'LARANJA' || rec.visualStatus === 'AMARELO'
          ? 'LARANJA'
          : rec.visualStatus === 'VERDE'
            ? 'VERDE'
            : 'AZUL';

    const lineRow = lineByCode.get(rec.lineCode);

    if (existing.length === 0) {
      const [inserted] = await db
        .insert(operationalRecommendations)
        .values({
          recommendationKey: rec.recommendationKey,
          referenceDate: todayDate,
          recommendationType:
            rec.recommendationType === 'REVISAR_CADASTRO' ? 'REVISAR_FATOR' : rec.recommendationType,
          priority: priorityMap,
          priorityScore: rec.priorityScore,
          title: `${rec.lineCode} · ${rec.materialDescription}: ${rec.headline}`,
          reason: rec.justification,
          materialId: rec.materialId,
          productionLineId: lineRow?.id ?? null,
          targetSiloId: rec.destinationSiloId,
          originSiloId: rec.originSiloId,
          requiredKg: rec.plannedConsumptionKg.toFixed(3),
          availableKg: rec.availableStockKg.toFixed(3),
          missingKg: rec.deficitKg.toFixed(3),
          suggestedTransferKg:
            rec.suggestedTransferKg !== null ? rec.suggestedTransferKg.toFixed(3) : null,
          dataSourceSummary: rec.priorityBreakdown.join(' | ') || 'Motor determinístico Fase 4',
          decisionStatus: 'PENDENTE',
        })
        .returning();
      persistedRecs.push({ ...rec, id: inserted.id, decisionStatus: inserted.decisionStatus, decisionNotes: inserted.decisionNotes, decidedAt: inserted.decidedAt, linkedTransferOrderId: inserted.linkedTransferOrderId });
    } else {
      const cur = existing[0];
      const [updated] = await db
        .update(operationalRecommendations)
        .set({
          priority: priorityMap,
          priorityScore: rec.priorityScore,
          title: `${rec.lineCode} · ${rec.materialDescription}: ${rec.headline}`,
          reason: rec.justification,
          targetSiloId: rec.destinationSiloId,
          originSiloId: rec.originSiloId,
          requiredKg: rec.plannedConsumptionKg.toFixed(3),
          availableKg: rec.availableStockKg.toFixed(3),
          missingKg: rec.deficitKg.toFixed(3),
          suggestedTransferKg:
            rec.suggestedTransferKg !== null ? rec.suggestedTransferKg.toFixed(3) : null,
          dataSourceSummary: rec.priorityBreakdown.join(' | ') || 'Motor determinístico Fase 4',
        })
        .where(eq(operationalRecommendations.id, cur.id))
        .returning();
      persistedRecs.push({
        ...rec,
        id: updated.id,
        decisionStatus: updated.decisionStatus,
        decisionNotes: updated.decisionNotes,
        decidedAt: updated.decidedAt,
        linkedTransferOrderId: updated.linkedTransferOrderId,
      });
    }
  }

  return {
    todayDate: analysis.todayDate,
    tomorrowDate: analysis.tomorrowDate,
    analyzedAtIso: analysis.analyzedAtIso,
    boardRows: analysis.boardRows,
    recommendations: persistedRecs,
    summary: analysis.summary,
    priorityConfig: priorityCfg,
    intakeRequests: intakeRequestsList,
  };
}
