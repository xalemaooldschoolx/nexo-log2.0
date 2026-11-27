import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditEvents,
  inventoryMovements,
  labelScans,
  materialBagConfigs,
  materials,
  productionLines,
  receiptDistributions,
  receipts,
  shifts,
  siloMaterialCompatibility,
  siloTransferRules,
  silos,
  suppliers,
  users,
} from './schema.ts';
import type { AuthenticatedAppUser } from './users.ts';
import {
  DEFAULT_SHIFT_CONFIGS,
  type ShiftCode,
  type ShiftConfigInput,
  resolveOperationalShift,
  resolveShiftFromConfigs,
} from '../lib/shifts.ts';
import { resolveShiftConfiguredFromExecutor } from './shift-resolver.ts';
import {
  MAX_RECEIPT_ATTACHMENTS,
  capLabelPreviewDataUrl,
  validateReceiptAttachments,
} from '../lib/security-utils.ts';
import type { ReceiptAttachmentItem } from '../types/nexo.ts';
import {
  allocateLotsForTransfer,
  calculateBigBagTotalKg,
  type CompatibilityRuleSnapshot,
  type DistributionPlanItem,
  type OriginLotBalance,
  type SiloRuleSnapshot,
  validateReceiptDistributionPlan,
  validateStockAdjustment,
  validateTransferExecution,
} from '../lib/inventory-rules.ts';
import { parseOperationalBarcode } from '../lib/barcode-parser.ts';

export class OperationalConflictError extends Error {
  statusCode: number;
  details?: unknown;
  constructor(message: string, statusCode = 409, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function resolveShiftConfiguredTx(tx: any) {
  return resolveShiftConfiguredFromExecutor(tx);
}

function parseAttachmentsJson(raw: string | null | undefined): ReceiptAttachmentItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadSiloSnapshotsTx(
  tx: any,
  lockSiloIds: number[] = []
): Promise<Map<number, SiloRuleSnapshot>> {
  const uniqueIds = Array.from(new Set(lockSiloIds)).sort((a, b) => a - b);

  // Lock silos in ascending ID order to avoid deadlocks under concurrent operators
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

function generateReceiptNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  const ts = String(now.getTime()).slice(-4);
  return `REC-${y}${m}${d}-${ts}${rand}`;
}

export async function listMaterialBagConfigs() {
  const rows = await db
    .select({
      id: materialBagConfigs.id,
      materialId: materialBagConfigs.materialId,
      materialCode: materials.code,
      materialDescription: materials.description,
      packagingLabel: materialBagConfigs.packagingLabel,
      unitWeightKg: materialBagConfigs.unitWeightKg,
      validationStatus: materialBagConfigs.validationStatus,
      isDefault: materialBagConfigs.isDefault,
      notes: materialBagConfigs.notes,
      updatedAt: materialBagConfigs.updatedAt,
    })
    .from(materialBagConfigs)
    .innerJoin(materials, eq(materialBagConfigs.materialId, materials.id))
    .orderBy(asc(materials.description), desc(materialBagConfigs.isDefault));

  return rows.map((r) => ({
    ...r,
    unitWeightKg: Number(r.unitWeightKg),
  }));
}

export async function upsertMaterialBagConfig(
  input: {
    id?: number;
    materialId: number;
    packagingLabel: string;
    unitWeightKg: number;
    validationStatus?: 'VALIDADO' | 'PENDENTE_VALIDACAO';
    isDefault?: boolean;
    notes?: string | null;
  },
  actor: AuthenticatedAppUser,
  reason: string
) {
  if (!Number.isFinite(input.unitWeightKg) || input.unitWeightKg <= 0) {
    throw new OperationalConflictError('Peso unitário do bag deve ser maior que zero.', 400);
  }
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(materialBagConfigs)
        .set({ isDefault: false })
        .where(eq(materialBagConfigs.materialId, input.materialId));
    }

    let saved: any;
    let prev: any = null;

    if (input.id) {
      const existing = await tx
        .select()
        .from(materialBagConfigs)
        .where(eq(materialBagConfigs.id, input.id))
        .limit(1);
      if (existing.length === 0) {
        throw new OperationalConflictError('Configuração de bag não encontrada.', 404);
      }
      prev = existing[0];
      const [updated] = await tx
        .update(materialBagConfigs)
        .set({
          packagingLabel: input.packagingLabel.trim(),
          unitWeightKg: input.unitWeightKg.toFixed(2),
          validationStatus: input.validationStatus ?? prev.validationStatus,
          isDefault: input.isDefault ?? prev.isDefault,
          notes: input.notes !== undefined ? input.notes : prev.notes,
          updatedAt: new Date(),
        })
        .where(eq(materialBagConfigs.id, input.id))
        .returning();
      saved = updated;
    } else {
      const [inserted] = await tx
        .insert(materialBagConfigs)
        .values({
          materialId: input.materialId,
          packagingLabel: input.packagingLabel.trim(),
          unitWeightKg: input.unitWeightKg.toFixed(2),
          validationStatus: input.validationStatus ?? 'VALIDADO',
          isDefault: input.isDefault ?? false,
          notes: input.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [materialBagConfigs.materialId, materialBagConfigs.packagingLabel],
          set: {
            unitWeightKg: input.unitWeightKg.toFixed(2),
            validationStatus: input.validationStatus ?? 'VALIDADO',
            isDefault: input.isDefault ?? false,
            notes: input.notes ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      saved = inserted;
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: input.id ? 'BAG_CONFIG_UPDATED' : 'BAG_CONFIG_CREATED',
      entityType: 'material_bag_configs',
      entityId: String(saved.id),
      previousValue: prev ? JSON.stringify(prev) : null,
      newValue: JSON.stringify(saved),
      reason: reason || 'Configuração de peso unitário de Big Bag',
      origin: 'BAG_WEIGHT_CONFIG',
    });

    return {
      ...saved,
      unitWeightKg: Number(saved.unitWeightKg),
    };
  });
}

export async function checkLotHistory(lotCodeRaw: string, materialId?: number) {
  const lotCode = lotCodeRaw.trim().toUpperCase();
  if (!lotCode) {
    return {
      lotCode: '',
      hasMovements: false,
      totalOriginalKg: 0,
      totalDistributedKg: 0,
      totalRemainingKg: 0,
      receipts: [],
      silosUsed: [],
      movements: [],
    };
  }

  const receiptConditions = [eq(receipts.lotCode, lotCode)];
  if (materialId) receiptConditions.push(eq(receipts.materialId, materialId));

  const lotReceipts = await db
    .select({
      id: receipts.id,
      receiptNumber: receipts.receiptNumber,
      materialId: receipts.materialId,
      materialCode: materials.code,
      materialDescription: materials.description,
      supplierName: receipts.supplierName,
      invoiceNumber: receipts.invoiceNumber,
      lotCode: receipts.lotCode,
      entryDate: receipts.entryDate,
      receivedQuantityKg: receipts.receivedQuantityKg,
      distributedQuantityKg: receipts.distributedQuantityKg,
      receivingType: receipts.receivingType,
      status: receipts.status,
      version: receipts.version,
      createdAt: receipts.createdAt,
    })
    .from(receipts)
    .innerJoin(materials, eq(receipts.materialId, materials.id))
    .where(and(...receiptConditions))
    .orderBy(desc(receipts.createdAt));

  const movConditions = [eq(inventoryMovements.lotCode, lotCode)];
  if (materialId) movConditions.push(eq(inventoryMovements.materialId, materialId));

  const lotMovements = await db
    .select({
      id: inventoryMovements.id,
      movementType: inventoryMovements.movementType,
      siloId: inventoryMovements.siloId,
      siloNumber: silos.siloNumber,
      materialId: inventoryMovements.materialId,
      materialCode: materials.code,
      materialDescription: materials.description,
      quantityKg: inventoryMovements.quantityKg,
      direction: inventoryMovements.direction,
      status: inventoryMovements.status,
      shiftCode: inventoryMovements.shiftCode,
      operationalDate: inventoryMovements.operationalDate,
      operatorName: users.displayName,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .innerJoin(silos, eq(inventoryMovements.siloId, silos.id))
    .innerJoin(materials, eq(inventoryMovements.materialId, materials.id))
    .innerJoin(users, eq(inventoryMovements.performedByUserId, users.id))
    .where(and(...movConditions))
    .orderBy(desc(inventoryMovements.createdAt));

  const activeReceipts = lotReceipts.filter((r) => r.status !== 'CANCELADO');
  const totalOriginalKg = activeReceipts.reduce(
    (acc, r) => acc + Number(r.receivedQuantityKg),
    0
  );
  const totalDistributedKg = activeReceipts.reduce(
    (acc, r) => acc + Number(r.distributedQuantityKg),
    0
  );
  const totalRemainingKg = Math.max(0, Math.round((totalOriginalKg - totalDistributedKg) * 1000) / 1000);

  const silosAgg = new Map<number, { siloNumber: number; netKg: number; lastAt: Date }>();
  for (const m of lotMovements) {
    if (m.status === 'ESTORNADO') continue;
    const qty = Number(m.quantityKg) * (m.direction === 'CREDIT' ? 1 : -1);
    const cur = silosAgg.get(m.siloNumber);
    if (!cur) {
      silosAgg.set(m.siloNumber, { siloNumber: m.siloNumber, netKg: qty, lastAt: m.createdAt });
    } else {
      cur.netKg += qty;
      if (m.createdAt > cur.lastAt) cur.lastAt = m.createdAt;
    }
  }

  return {
    lotCode,
    hasMovements: activeReceipts.length > 0 || lotMovements.length > 0,
    totalOriginalKg,
    totalDistributedKg,
    totalRemainingKg,
    receipts: lotReceipts.map((r) => ({
      ...r,
      receivedQuantityKg: Number(r.receivedQuantityKg),
      distributedQuantityKg: Number(r.distributedQuantityKg),
      remainingQuantityKg: Math.max(
        0,
        Math.round((Number(r.receivedQuantityKg) - Number(r.distributedQuantityKg)) * 1000) / 1000
      ),
    })),
    silosUsed: Array.from(silosAgg.values()),
    movements: lotMovements.map((m) => ({
      ...m,
      quantityKg: Number(m.quantityKg),
    })),
  };
}

export async function listReceiptsWithDetails() {
  const rows = await db
    .select({
      id: receipts.id,
      receiptNumber: receipts.receiptNumber,
      materialId: receipts.materialId,
      materialCode: materials.code,
      materialDescription: materials.description,
      supplierId: receipts.supplierId,
      supplierName: receipts.supplierName,
      invoiceNumber: receipts.invoiceNumber,
      lotCode: receipts.lotCode,
      entryDate: receipts.entryDate,
      receivedQuantityKg: receipts.receivedQuantityKg,
      distributedQuantityKg: receipts.distributedQuantityKg,
      unit: receipts.unit,
      receivingType: receipts.receivingType,
      bagCount: receipts.bagCount,
      bagUnitWeightKg: receipts.bagUnitWeightKg,
      receivingPoint: receipts.receivingPoint,
      vehiclePlate: receipts.vehiclePlate,
      driverName: receipts.driverName,
      carrierName: receipts.carrierName,
      status: receipts.status,
      operatorUserId: receipts.operatorUserId,
      operatorName: users.displayName,
      operatorBadge: users.badgeCode,
      executedByName: receipts.executedByName,
      executedByBadge: receipts.executedByBadge,
      shiftCode: receipts.shiftCode,
      operationalDate: receipts.operationalDate,
      startedShiftCode: receipts.startedShiftCode,
      startedOperationalDate: receipts.startedOperationalDate,
      finishedShiftCode: receipts.finishedShiftCode,
      finishedOperationalDate: receipts.finishedOperationalDate,
      startedAt: receipts.startedAt,
      finishedAt: receipts.finishedAt,
      notes: receipts.notes,
      attachmentsJson: receipts.attachmentsJson,
      version: receipts.version,
      createdAt: receipts.createdAt,
    })
    .from(receipts)
    .innerJoin(materials, eq(receipts.materialId, materials.id))
    .innerJoin(users, eq(receipts.operatorUserId, users.id))
    .orderBy(desc(receipts.createdAt));

  const dists = await db
    .select({
      id: receiptDistributions.id,
      receiptId: receiptDistributions.receiptId,
      siloId: receiptDistributions.siloId,
      siloNumber: silos.siloNumber,
      quantityKg: receiptDistributions.quantityKg,
      bagCount: receiptDistributions.bagCount,
      movementId: receiptDistributions.movementId,
      status: receiptDistributions.status,
      isComplement: receiptDistributions.isComplement,
      operatorName: users.displayName,
      shiftCode: receiptDistributions.shiftCode,
      operationalDate: receiptDistributions.operationalDate,
      notes: receiptDistributions.notes,
      createdAt: receiptDistributions.createdAt,
    })
    .from(receiptDistributions)
    .innerJoin(silos, eq(receiptDistributions.siloId, silos.id))
    .innerJoin(users, eq(receiptDistributions.operatorUserId, users.id))
    .orderBy(asc(receiptDistributions.createdAt));

  const distMap = new Map<number, any[]>();
  for (const d of dists) {
    const arr = distMap.get(d.receiptId) ?? [];
    arr.push({
      ...d,
      quantityKg: Number(d.quantityKg),
    });
    distMap.set(d.receiptId, arr);
  }

  return rows.map((r) => {
    const received = Number(r.receivedQuantityKg);
    const distributed = Number(r.distributedQuantityKg);
    const { attachmentsJson, ...rest } = r;
    return {
      ...rest,
      receivedQuantityKg: received,
      distributedQuantityKg: distributed,
      remainingQuantityKg: Math.max(0, Math.round((received - distributed) * 1000) / 1000),
      bagUnitWeightKg: r.bagUnitWeightKg ? Number(r.bagUnitWeightKg) : null,
      attachments: parseAttachmentsJson(attachmentsJson),
      distributions: distMap.get(r.id) ?? [],
    };
  });
}

export async function getCompatibleSilosForMaterial(materialId: number) {
  return db.transaction(async (tx) => {
    const snapshots = await loadSiloSnapshotsTx(tx);
    const compatRows = await loadCompatibilitiesTx(tx);

    const siloRows = await tx
      .select({
        id: silos.id,
        siloNumber: silos.siloNumber,
        rubricOrder: silos.rubricOrder,
        category: silos.category,
        lineCode: productionLines.code,
        lineName: productionLines.name,
        operationalStatus: silos.operationalStatus,
        cleaningStatus: silos.cleaningStatus,
        validationStatus: silos.validationStatus,
        restrictions: silos.restrictions,
        primaryMaterialId: silos.primaryMaterialId,
      })
      .from(silos)
      .innerJoin(productionLines, eq(silos.productionLineId, productionLines.id))
      .orderBy(asc(silos.rubricOrder));

    const results: Array<{
      id: number;
      siloNumber: number;
      category: string;
      lineCode: string;
      lineName: string;
      operationalStatus: string;
      cleaningStatus: string;
      validationStatus: string;
      restrictions: string | null;
      nominalCapacityKg: number;
      safeCapacityKg: number;
      confirmedStockKg: number;
      availableSpaceKg: number;
      isCompatible: boolean;
    }> = [];

    for (const s of siloRows) {
      const snap = snapshots.get(s.id)!;
      const explicit = compatRows.find((c) => c.siloId === s.id && c.materialId === materialId);
      const isCompatible = explicit
        ? explicit.allowReceiving
        : s.primaryMaterialId === materialId;

      if (!isCompatible) continue;

      results.push({
        id: s.id,
        siloNumber: s.siloNumber,
        category: s.category,
        lineCode: s.lineCode,
        lineName: s.lineName,
        operationalStatus: s.operationalStatus,
        cleaningStatus: s.cleaningStatus,
        validationStatus: s.validationStatus,
        restrictions: s.restrictions,
        nominalCapacityKg: snap.nominalCapacityKg,
        safeCapacityKg: snap.safeCapacityKg,
        confirmedStockKg: snap.confirmedStockKg,
        availableSpaceKg: Math.max(0, snap.safeCapacityKg - snap.confirmedStockKg),
        isCompatible,
      });
    }

    return results;
  });
}

export interface CreateReceiptInput {
  materialId: number;
  supplierId?: number | null;
  supplierName: string;
  invoiceNumber?: string | null;
  lotCode: string;
  entryDate: string;
  receivingType: 'GRANEL' | 'BIG_BAG';
  receivedQuantityKg?: number;
  bagCount?: number | null;
  bagUnitWeightKg?: number | null;
  receivingPoint?: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  carrierName?: string | null;
  executedByName?: string | null;
  executedByBadge?: string | null;
  notes?: string | null;
  attachments?: ReceiptAttachmentItem[];
  idempotencyKey?: string;
  allowDuplicateLot?: boolean;
  distributions?: DistributionPlanItem[];
}

export async function createReceiptTransactional(
  input: CreateReceiptInput,
  actor: AuthenticatedAppUser
) {
  const lotCode = input.lotCode.trim().toUpperCase();
  if (!lotCode) {
    throw new OperationalConflictError('Número do lote é obrigatório.', 400);
  }
  if (!input.supplierName || !input.supplierName.trim()) {
    throw new OperationalConflictError('Fornecedor é obrigatório.', 400);
  }

  const attCheck = validateReceiptAttachments(input.attachments);
  if (attCheck.valid === false) {
    throw new OperationalConflictError(attCheck.error, 400);
  }
  const validatedAttachments = attCheck.items;

  let totalReceivedKg = Number(input.receivedQuantityKg || 0);
  if (input.receivingType === 'BIG_BAG') {
    if (!input.bagCount || !input.bagUnitWeightKg) {
      throw new OperationalConflictError(
        'Para recebimento de Big Bag, informe quantidade de bags e peso unitário.',
        400
      );
    }
    totalReceivedKg = calculateBigBagTotalKg(Number(input.bagCount), Number(input.bagUnitWeightKg));
  }

  if (!Number.isFinite(totalReceivedKg) || totalReceivedKg <= 0) {
    throw new OperationalConflictError('Quantidade recebida deve ser maior que zero.', 400);
  }

  const distributions = (input.distributions ?? []).filter((d) => Number(d.quantityKg) > 0);
  const lockSiloIds = distributions.map((d) => d.siloId);

  return db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredTx(tx);
    // 1. Idempotency check against concurrent / double click submissions
    if (input.idempotencyKey) {
      const existingByKey = await tx
        .select()
        .from(receipts)
        .where(eq(receipts.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existingByKey.length > 0) {
        throw new OperationalConflictError(
          `Este recebimento já foi registrado (${existingByKey[0].receiptNumber}). Operação bloqueada para evitar duplicidade.`,
          409,
          { existingReceipt: existingByKey[0] }
        );
      }
    }

    // 2. Duplicate lot check (same lot + same material still active) unless explicitly confirmed as complement/new lot entry
    if (!input.allowDuplicateLot) {
      const sameLot = await tx
        .select()
        .from(receipts)
        .where(and(eq(receipts.lotCode, lotCode), eq(receipts.materialId, input.materialId)))
        .limit(1);
      if (sameLot.length > 0 && sameLot[0].status !== 'CANCELADO') {
        throw new OperationalConflictError(
          `ATENÇÃO: O lote ${lotCode} já possui recebimento/movimentações registradas (${sameLot[0].receiptNumber}). Confirme se deseja registrar complemento.`,
          409,
          { code: 'LOT_ALREADY_EXISTS', receiptId: sameLot[0].id }
        );
      }
    }

    // 3. Validate material & supplier
    const matRows = await tx
      .select()
      .from(materials)
      .where(eq(materials.id, input.materialId))
      .limit(1);
    if (matRows.length === 0) {
      throw new OperationalConflictError('Matéria-prima não encontrada.', 404);
    }

    let resolvedSupplierId = input.supplierId ?? null;
    if (!resolvedSupplierId) {
      const supMatch = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.name, input.supplierName.trim().toUpperCase()))
        .limit(1);
      if (supMatch.length > 0) resolvedSupplierId = supMatch[0].id;
    }

    // 4. Validate distribution plan against locked silos
    const snapshots = await loadSiloSnapshotsTx(tx, lockSiloIds);
    const compatibilities = await loadCompatibilitiesTx(tx);
    const plan = validateReceiptDistributionPlan({
      materialId: input.materialId,
      receivedQuantityKg: totalReceivedKg,
      alreadyDistributedKg: 0,
      distributions,
      silosById: snapshots,
      compatibilities,
    });

    if (!plan.valid) {
      throw new OperationalConflictError(plan.errors.join(' | '), 400, { errors: plan.errors });
    }

    const initialStatus =
      plan.totalDistributedNowKg === 0
        ? 'PENDENTE'
        : plan.remainingAfterKg === 0
          ? 'CONCLUIDO'
          : 'PARCIAL';

    const receiptNumber = generateReceiptNumber();

    const [createdReceipt] = await tx
      .insert(receipts)
      .values({
        receiptNumber,
        materialId: input.materialId,
        supplierId: resolvedSupplierId,
        supplierName: input.supplierName.trim().toUpperCase(),
        invoiceNumber: input.invoiceNumber?.trim() || null,
        lotCode,
        entryDate: input.entryDate || shift.operationalDate,
        receivedQuantityKg: totalReceivedKg.toFixed(3),
        distributedQuantityKg: plan.totalDistributedNowKg.toFixed(3),
        unit: 'kg',
        receivingType: input.receivingType,
        bagCount: input.receivingType === 'BIG_BAG' ? Number(input.bagCount) : null,
        bagUnitWeightKg:
          input.receivingType === 'BIG_BAG' && input.bagUnitWeightKg
            ? Number(input.bagUnitWeightKg).toFixed(2)
            : null,
        receivingPoint: input.receivingPoint?.trim() || null,
        vehiclePlate: input.vehiclePlate?.trim().toUpperCase() || null,
        driverName: input.driverName?.trim() || null,
        carrierName: input.carrierName?.trim() || null,
        status: initialStatus,
        operatorUserId: actor.id,
        executedByName: input.executedByName?.trim() || null,
        executedByBadge: input.executedByBadge?.trim() || null,
        shiftCode: shift.shiftCode,
        operationalDate: shift.operationalDate,
        startedShiftCode: shift.shiftCode,
        startedOperationalDate: shift.operationalDate,
        finishedShiftCode: initialStatus === 'CONCLUIDO' ? shift.shiftCode : null,
        finishedOperationalDate: initialStatus === 'CONCLUIDO' ? shift.operationalDate : null,
        finishedAt: initialStatus === 'CONCLUIDO' ? new Date() : null,
        notes: input.notes?.trim() || null,
        attachmentsJson: validatedAttachments.length > 0 ? JSON.stringify(validatedAttachments) : null,
        idempotencyKey: input.idempotencyKey || null,
        version: 1,
      })
      .returning();

    const createdDistributions = [];
    for (let idx = 0; idx < distributions.length; idx++) {
      const dist = distributions[idx];
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          movementType: 'ENTRADA',
          siloId: dist.siloId,
          materialId: input.materialId,
          lotCode,
          quantityKg: Number(dist.quantityKg).toFixed(3),
          unit: 'kg',
          direction: 'CREDIT',
          referenceDocument: receiptNumber,
          receiptId: createdReceipt.id,
          supplierName: createdReceipt.supplierName,
          status: 'CONFIRMADO',
          reason: `Recebimento ${receiptNumber} (${input.receivingType})`,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:dist:${idx}` : null,
          shiftCode: shift.shiftCode,
          operationalDate: shift.operationalDate,
          performedByUserId: actor.id,
          executedByName: input.executedByName?.trim() || null,
          executedByBadge: input.executedByBadge?.trim() || null,
          notes: input.notes?.trim() || null,
        })
        .returning();

      const [distRow] = await tx
        .insert(receiptDistributions)
        .values({
          receiptId: createdReceipt.id,
          siloId: dist.siloId,
          quantityKg: Number(dist.quantityKg).toFixed(3),
          bagCount: dist.bagCount ?? null,
          movementId: movement.id,
          status: 'CONFIRMADA',
          isComplement: false,
          operatorUserId: actor.id,
          shiftCode: shift.shiftCode,
          operationalDate: shift.operationalDate,
          notes: input.notes?.trim() || null,
        })
        .returning();

      createdDistributions.push(distRow);
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'RECEIPT_CREATED',
      entityType: 'receipts',
      entityId: receiptNumber,
      previousValue: null,
      newValue: JSON.stringify({
        receiptNumber,
        materialId: input.materialId,
        lotCode,
        receivedQuantityKg: totalReceivedKg,
        distributedQuantityKg: plan.totalDistributedNowKg,
        status: initialStatus,
        distributions: distributions.map((d) => ({ siloId: d.siloId, quantityKg: d.quantityKg })),
      }),
      reason: `Registro de recebimento ${input.receivingType} (${initialStatus})`,
      origin: 'RECEIVING_MODULE',
    });

    return {
      receipt: createdReceipt,
      distributions: createdDistributions,
      warnings: plan.warnings,
    };
  });
}

export async function distributeReceiptTransactional(
  input: {
    receiptId: number;
    expectedVersion?: number;
    distributions: DistributionPlanItem[];
    isComplement?: boolean;
    executedByName?: string | null;
    executedByBadge?: string | null;
    notes?: string | null;
    attachments?: ReceiptAttachmentItem[];
    idempotencyKey?: string;
  },
  actor: AuthenticatedAppUser
) {
  const distributions = input.distributions.filter((d) => Number(d.quantityKg) > 0);
  if (distributions.length === 0) {
    throw new OperationalConflictError('Informe ao menos um silo e quantidade para distribuir.', 400);
  }
  const incomingAttCheck = validateReceiptAttachments(input.attachments);
  if (incomingAttCheck.valid === false) {
    throw new OperationalConflictError(incomingAttCheck.error, 400);
  }

  const lockSiloIds = distributions.map((d) => d.siloId);

  return db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredTx(tx);
    // Lock receipt row first to guard against concurrent operators modifying the same receipt
    const lockedReceiptRes = await tx.execute(
      sql`SELECT * FROM receipts WHERE id = ${input.receiptId} FOR UPDATE`
    );
    const recRow: any = lockedReceiptRes.rows?.[0];
    if (!recRow) {
      throw new OperationalConflictError('Recebimento não encontrado.', 404);
    }

    if (recRow.status === 'CANCELADO') {
      throw new OperationalConflictError('Este recebimento está cancelado.', 400);
    }
    if (recRow.status === 'CONCLUIDO') {
      throw new OperationalConflictError(
        `Recebimento ${recRow.receipt_number} já foi totalmente distribuído.`,
        409
      );
    }

    if (input.expectedVersion !== undefined && Number(recRow.version) !== input.expectedVersion) {
      throw new OperationalConflictError(
        'Este recebimento foi atualizado por outro operador. Atualize a tela e confira o saldo restante antes de confirmar.',
        409
      );
    }

    const receivedKg = Number(recRow.received_quantity_kg);
    const alreadyDistributedKg = Number(recRow.distributed_quantity_kg);

    const snapshots = await loadSiloSnapshotsTx(tx, lockSiloIds);
    const compatibilities = await loadCompatibilitiesTx(tx);

    const plan = validateReceiptDistributionPlan({
      materialId: Number(recRow.material_id),
      receivedQuantityKg: receivedKg,
      alreadyDistributedKg,
      distributions,
      silosById: snapshots,
      compatibilities,
    });

    if (!plan.valid) {
      throw new OperationalConflictError(plan.errors.join(' | '), 400, { errors: plan.errors });
    }

    const newDistributedKg =
      Math.round((alreadyDistributedKg + plan.totalDistributedNowKg) * 1000) / 1000;
    const nextStatus = plan.remainingAfterKg === 0 ? 'CONCLUIDO' : 'PARCIAL';

    const existingAtts = parseAttachmentsJson(recRow.attachments_json);
    const mergedAtts =
      incomingAttCheck.items.length > 0
        ? [...existingAtts, ...incomingAttCheck.items].slice(0, MAX_RECEIPT_ATTACHMENTS)
        : existingAtts;

    const [updatedReceipt] = await tx
      .update(receipts)
      .set({
        distributedQuantityKg: newDistributedKg.toFixed(3),
        status: nextStatus,
        startedShiftCode: recRow.started_shift_code || recRow.shift_code,
        startedOperationalDate: recRow.started_operational_date || recRow.operational_date,
        finishedShiftCode: nextStatus === 'CONCLUIDO' ? shift.shiftCode : null,
        finishedOperationalDate: nextStatus === 'CONCLUIDO' ? shift.operationalDate : null,
        finishedAt: nextStatus === 'CONCLUIDO' ? new Date() : null,
        attachmentsJson: mergedAtts.length > 0 ? JSON.stringify(mergedAtts) : recRow.attachments_json,
        version: Number(recRow.version) + 1,
        updatedAt: new Date(),
      })
      .where(eq(receipts.id, input.receiptId))
      .returning();

    const createdDists = [];
    for (let idx = 0; idx < distributions.length; idx++) {
      const dist = distributions[idx];
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          movementType: 'ENTRADA',
          siloId: dist.siloId,
          materialId: Number(recRow.material_id),
          lotCode: recRow.lot_code,
          quantityKg: Number(dist.quantityKg).toFixed(3),
          unit: 'kg',
          direction: 'CREDIT',
          referenceDocument: recRow.receipt_number,
          receiptId: input.receiptId,
          supplierName: recRow.supplier_name,
          status: 'CONFIRMADO',
          reason: input.isComplement
            ? `Complemento de descarga ${recRow.receipt_number}`
            : `Distribuição de recebimento ${recRow.receipt_number}`,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:c:${idx}` : null,
          shiftCode: shift.shiftCode,
          operationalDate: shift.operationalDate,
          performedByUserId: actor.id,
          executedByName: input.executedByName?.trim() || null,
          executedByBadge: input.executedByBadge?.trim() || null,
          notes: input.notes?.trim() || null,
        })
        .returning();

      const [distRow] = await tx
        .insert(receiptDistributions)
        .values({
          receiptId: input.receiptId,
          siloId: dist.siloId,
          quantityKg: Number(dist.quantityKg).toFixed(3),
          bagCount: dist.bagCount ?? null,
          movementId: movement.id,
          status: 'CONFIRMADA',
          isComplement: Boolean(input.isComplement || alreadyDistributedKg > 0),
          operatorUserId: actor.id,
          shiftCode: shift.shiftCode,
          operationalDate: shift.operationalDate,
          notes: input.notes?.trim() || null,
        })
        .returning();

      createdDists.push(distRow);
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: alreadyDistributedKg > 0 ? 'RECEIPT_COMPLEMENT_DISTRIBUTED' : 'RECEIPT_DISTRIBUTED',
      entityType: 'receipts',
      entityId: recRow.receipt_number,
      previousValue: JSON.stringify({
        distributedQuantityKg: alreadyDistributedKg,
        status: recRow.status,
      }),
      newValue: JSON.stringify({
        distributedQuantityKg: newDistributedKg,
        status: nextStatus,
        addedKg: plan.totalDistributedNowKg,
      }),
      reason: input.notes?.trim() || 'Distribuição / descarga para silos',
      origin: 'RECEIVING_DISTRIBUTION',
    });

    return {
      receipt: updatedReceipt,
      distributions: createdDists,
      warnings: plan.warnings,
    };
  });
}

export async function executeTransferTransactional(
  input: {
    originSiloId: number;
    destinationSiloId: number;
    materialId: number;
    quantityKg: number;
    lotCode?: string | null;
    reason?: string | null;
    executedByName?: string | null;
    executedByBadge?: string | null;
    idempotencyKey?: string;
  },
  actor: AuthenticatedAppUser
) {
  return db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredTx(tx);
    if (input.idempotencyKey) {
      const dup = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.idempotencyKey, `${input.idempotencyKey}:out`))
        .limit(1);
      if (dup.length > 0) {
        throw new OperationalConflictError(
          'Esta transferência já foi confirmada anteriormente.',
          409
        );
      }
    }

    const snapshots = await loadSiloSnapshotsTx(tx, [
      input.originSiloId,
      input.destinationSiloId,
    ]);
    const originSilo = snapshots.get(input.originSiloId);
    const destinationSilo = snapshots.get(input.destinationSiloId);

    if (!originSilo || !destinationSilo) {
      throw new OperationalConflictError('Silo de origem ou destino não encontrado.', 404);
    }

    const ruleRows = await tx
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

    const rule =
      ruleRows.length > 0
        ? {
            isActive: ruleRows[0].isActive,
            validationStatus: ruleRows[0].validationStatus,
            authorizationStatus: ruleRows[0].authorizationStatus,
            maxQuantityKg: ruleRows[0].maxQuantityKg ? Number(ruleRows[0].maxQuantityKg) : null,
          }
        : null;

    const compatibilities = await loadCompatibilitiesTx(tx);
    const check = validateTransferExecution({
      originSilo,
      destinationSilo,
      materialId: input.materialId,
      quantityKg: Number(input.quantityKg),
      compatibilities,
      rule,
    });

    if (!check.valid) {
      throw new OperationalConflictError(check.errors.join(' | '), 400, { errors: check.errors });
    }

    const lotRows = await tx
      .select({
        lotCode: inventoryMovements.lotCode,
        netKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
      })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.siloId, input.originSiloId),
          eq(inventoryMovements.materialId, input.materialId)
        )
      )
      .groupBy(inventoryMovements.lotCode);

    const originLots: OriginLotBalance[] = lotRows
      .map((r: any) => ({
        lotCode: r.lotCode ? String(r.lotCode).trim().toUpperCase() : null,
        netKg: Number(r.netKg || 0),
      }))
      .filter((r) => r.netKg > 0.001);

    const lotAllocation = allocateLotsForTransfer({
      originLots,
      requestedQuantityKg: Number(input.quantityKg),
      preferredLotCode: input.lotCode,
    });
    if (!lotAllocation.valid) {
      throw new OperationalConflictError(
        lotAllocation.error || 'Saldo de lotes insuficiente na origem.',
        400
      );
    }

    const refDoc = `TRF-${Date.now().toString().slice(-6)}`;
    let firstDebit: any = null;
    let firstCredit: any = null;

    for (let idx = 0; idx < lotAllocation.slices.length; idx++) {
      const slice = lotAllocation.slices[idx];
      const sliceQtyStr = slice.quantityKg.toFixed(3);
      const idempSuffix = idx === 0 ? '' : `:${idx}`;

      const [debitMov] = await tx
        .insert(inventoryMovements)
        .values({
          movementType: 'TRANSFERENCIA',
          siloId: input.originSiloId,
          counterpartSiloId: input.destinationSiloId,
          materialId: input.materialId,
          lotCode: slice.lotCode,
          quantityKg: sliceQtyStr,
          unit: 'kg',
          direction: 'DEBIT',
          referenceDocument: refDoc,
          status: 'CONFIRMADO',
          reason:
            input.reason?.trim() ||
            `Transferência Silo ${originSilo.siloNumber} → Silo ${destinationSilo.siloNumber}`,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:out${idempSuffix}` : null,
          shiftCode: shift.shiftCode,
          operationalDate: shift.operationalDate,
          performedByUserId: actor.id,
          executedByName: input.executedByName?.trim() || null,
          executedByBadge: input.executedByBadge?.trim() || null,
        })
        .returning();

      const [creditMov] = await tx
        .insert(inventoryMovements)
        .values({
          movementType: 'TRANSFERENCIA',
          siloId: input.destinationSiloId,
          counterpartSiloId: input.originSiloId,
          materialId: input.materialId,
          lotCode: slice.lotCode,
          quantityKg: sliceQtyStr,
          unit: 'kg',
          direction: 'CREDIT',
          referenceDocument: refDoc,
          status: 'CONFIRMADO',
          reason:
            input.reason?.trim() ||
            `Transferência Silo ${originSilo.siloNumber} → Silo ${destinationSilo.siloNumber}`,
          idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:in${idempSuffix}` : null,
          shiftCode: shift.shiftCode,
          operationalDate: shift.operationalDate,
          performedByUserId: actor.id,
          executedByName: input.executedByName?.trim() || null,
          executedByBadge: input.executedByBadge?.trim() || null,
        })
        .returning();

      if (idx === 0) {
        firstDebit = debitMov;
        firstCredit = creditMov;
      }
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'SILO_TRANSFER_EXECUTED',
      entityType: 'inventory_movements',
      entityId: refDoc,
      previousValue: JSON.stringify({
        originSilo: originSilo.siloNumber,
        originStockKg: originSilo.confirmedStockKg,
        destinationSilo: destinationSilo.siloNumber,
        destinationStockKg: destinationSilo.confirmedStockKg,
      }),
      newValue: JSON.stringify({
        quantityKg: Number(input.quantityKg),
        lots: lotAllocation.slices,
        originStockAfterKg: originSilo.confirmedStockKg - Number(input.quantityKg),
        destinationStockAfterKg: destinationSilo.confirmedStockKg + Number(input.quantityKg),
      }),
      reason:
        input.reason?.trim() ||
        `Transferência atômica Silo ${originSilo.siloNumber} -> Silo ${destinationSilo.siloNumber}`,
      origin: 'TRANSFER_EXECUTION',
    });

    return {
      referenceDocument: refDoc,
      debitMov: firstDebit,
      creditMov: firstCredit,
      lotSlices: lotAllocation.slices,
    };
  });
}

export async function reverseMovementTransactional(
  movementId: number,
  reason: string,
  actor: AuthenticatedAppUser
) {
  if (!reason || reason.trim().length < 5) {
    throw new OperationalConflictError('Informe motivo obrigatório (mínimo 5 caracteres) para estorno.', 400);
  }
  return db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredTx(tx);
    const movRes = await tx.execute(
      sql`SELECT * FROM inventory_movements WHERE id = ${movementId} FOR UPDATE`
    );
    const orig: any = movRes.rows?.[0];
    if (!orig) {
      throw new OperationalConflictError('Movimentação não encontrada.', 404);
    }
    if (orig.status === 'ESTORNADO') {
      throw new OperationalConflictError('Esta movimentação já foi estornada.', 409);
    }

    const snapshots = await loadSiloSnapshotsTx(tx, [Number(orig.silo_id)]);
    const silo = snapshots.get(Number(orig.silo_id))!;
    const qty = Number(orig.quantity_kg);
    const reverseDirection = orig.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT';
    const delta = reverseDirection === 'CREDIT' ? qty : -qty;

    if (silo.confirmedStockKg + delta < -0.001) {
      throw new OperationalConflictError(
        `Não é possível estornar ${qty.toLocaleString('pt-BR')} kg do Silo ${silo.siloNumber}: saldo atual (${silo.confirmedStockKg.toLocaleString('pt-BR')} kg) ficaria negativo.`,
        409
      );
    }

    await tx
      .update(inventoryMovements)
      .set({ status: 'ESTORNADO' })
      .where(eq(inventoryMovements.id, movementId));

    const [reversalMov] = await tx
      .insert(inventoryMovements)
      .values({
        movementType: 'REVERSAO',
        siloId: Number(orig.silo_id),
        materialId: Number(orig.material_id),
        lotCode: orig.lot_code,
        quantityKg: qty.toFixed(3),
        unit: orig.unit || 'kg',
        direction: reverseDirection,
        referenceDocument: orig.reference_document,
        receiptId: orig.receipt_id ? Number(orig.receipt_id) : null,
        supplierName: orig.supplier_name,
        reversedMovementId: movementId,
        status: 'CONFIRMADO',
        reason: reason.trim(),
        shiftCode: shift.shiftCode,
        operationalDate: shift.operationalDate,
        performedByUserId: actor.id,
        authorizedByUserId: actor.id,
      })
      .returning();

    // Se vinculado a uma distribuição de recebimento, estorna a distribuição e recalcula saldo do recebimento
    if (orig.receipt_id) {
      await tx
        .update(receiptDistributions)
        .set({ status: 'ESTORNADA' })
        .where(eq(receiptDistributions.movementId, movementId));

      const recRows = await tx
        .select()
        .from(receipts)
        .where(eq(receipts.id, Number(orig.receipt_id)))
        .limit(1);

      if (recRows.length > 0) {
        const rec = recRows[0];
        const nextDist = Math.max(0, Number(rec.distributedQuantityKg) - qty);
        const nextStatus = nextDist <= 0.001 ? 'PENDENTE' : 'PARCIAL';
        await tx
          .update(receipts)
          .set({
            distributedQuantityKg: nextDist.toFixed(3),
            status: nextStatus,
            finishedAt: null,
            version: rec.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(receipts.id, rec.id));
      }
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'MOVEMENT_REVERSED',
      entityType: 'inventory_movements',
      entityId: String(movementId),
      previousValue: JSON.stringify({
        siloNumber: silo.siloNumber,
        quantityKg: qty,
        direction: orig.direction,
        siloStockBeforeKg: silo.confirmedStockKg,
      }),
      newValue: JSON.stringify({
        reversalMovementId: reversalMov.id,
        siloStockAfterKg: silo.confirmedStockKg + delta,
      }),
      reason: reason.trim(),
      origin: 'STOCK_REVERSAL',
    });

    return reversalMov;
  });
}

export async function adjustSiloStockTransactional(
  input: {
    siloId: number;
    materialId: number;
    lotCode?: string | null;
    deltaKg: number;
    reason: string;
    executedByName?: string | null;
    executedByBadge?: string | null;
  },
  actor: AuthenticatedAppUser
) {
  return db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredTx(tx);
    const snapshots = await loadSiloSnapshotsTx(tx, [input.siloId]);
    const silo = snapshots.get(input.siloId);
    if (!silo) throw new OperationalConflictError('Silo não encontrado.', 404);

    const check = validateStockAdjustment({
      currentSiloStockKg: silo.confirmedStockKg,
      safeCapacityKg: silo.safeCapacityKg,
      deltaKg: Number(input.deltaKg),
      reason: input.reason,
    });
    if (!check.valid) {
      throw new OperationalConflictError(check.errors.join(' | '), 400, { errors: check.errors });
    }

    const direction = input.deltaKg > 0 ? 'CREDIT' : 'DEBIT';
    const absQty = Math.abs(Number(input.deltaKg));

    const [mov] = await tx
      .insert(inventoryMovements)
      .values({
        movementType: 'AJUSTE_AUTORIZADO',
        siloId: input.siloId,
        materialId: input.materialId,
        lotCode: input.lotCode?.trim().toUpperCase() || null,
        quantityKg: absQty.toFixed(3),
        unit: 'kg',
        direction,
        referenceDocument: `AJU-${Date.now().toString().slice(-6)}`,
        status: 'CONFIRMADO',
        reason: input.reason.trim(),
        shiftCode: shift.shiftCode,
        operationalDate: shift.operationalDate,
        performedByUserId: actor.id,
        authorizedByUserId: actor.id,
        executedByName: input.executedByName?.trim() || null,
        executedByBadge: input.executedByBadge?.trim() || null,
      })
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'STOCK_ADJUSTED',
      entityType: 'silos',
      entityId: String(silo.siloNumber),
      previousValue: JSON.stringify({ confirmedStockKg: silo.confirmedStockKg }),
      newValue: JSON.stringify({
        confirmedStockKg: silo.confirmedStockKg + Number(input.deltaKg),
        deltaKg: Number(input.deltaKg),
      }),
      reason: input.reason.trim(),
      origin: 'AUTHORIZED_ADJUSTMENT',
    });

    return mov;
  });
}

export async function getSiloLedgerDetails(siloId: number) {
  const movs = await db
    .select({
      id: inventoryMovements.id,
      movementType: inventoryMovements.movementType,
      siloId: inventoryMovements.siloId,
      materialId: inventoryMovements.materialId,
      materialCode: materials.code,
      materialDescription: materials.description,
      lotCode: inventoryMovements.lotCode,
      quantityKg: inventoryMovements.quantityKg,
      direction: inventoryMovements.direction,
      referenceDocument: inventoryMovements.referenceDocument,
      supplierName: inventoryMovements.supplierName,
      status: inventoryMovements.status,
      reason: inventoryMovements.reason,
      shiftCode: inventoryMovements.shiftCode,
      operationalDate: inventoryMovements.operationalDate,
      operatorName: users.displayName,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .innerJoin(materials, eq(inventoryMovements.materialId, materials.id))
    .innerJoin(users, eq(inventoryMovements.performedByUserId, users.id))
    .where(eq(inventoryMovements.siloId, siloId))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(100);

  const lotMap = new Map<
    string,
    { lotCode: string; materialCode: string; materialDescription: string; netKg: number }
  >();

  for (const m of movs) {
    if (m.status === 'ESTORNADO') continue;
    const key = `${m.lotCode || 'SEM_LOTE'}::${m.materialCode}`;
    const signed = Number(m.quantityKg) * (m.direction === 'CREDIT' ? 1 : -1);
    const existing = lotMap.get(key);
    if (!existing) {
      lotMap.set(key, {
        lotCode: m.lotCode || 'SEM_LOTE',
        materialCode: m.materialCode,
        materialDescription: m.materialDescription,
        netKg: signed,
      });
    } else {
      existing.netKg += signed;
    }
  }

  return {
    activeLots: Array.from(lotMap.values()).filter((l) => l.netKg > 0.001),
    movements: movs.map((m) => ({
      ...m,
      quantityKg: Number(m.quantityKg),
    })),
  };
}

export async function listInventoryMovementsReport(filters?: {
  siloId?: number;
  materialId?: number;
  shiftCode?: string;
  lotCode?: string;
}) {
  const allSilos = await db.select().from(silos);
  const siloNumMap = new Map(allSilos.map((s) => [s.id, s.siloNumber]));

  const conditions = [];
  if (filters?.siloId) conditions.push(eq(inventoryMovements.siloId, filters.siloId));
  if (filters?.materialId) conditions.push(eq(inventoryMovements.materialId, filters.materialId));
  if (filters?.shiftCode) conditions.push(eq(inventoryMovements.shiftCode, filters.shiftCode));
  if (filters?.lotCode) {
    conditions.push(eq(inventoryMovements.lotCode, filters.lotCode.trim().toUpperCase()));
  }

  const rows = await db
    .select({
      id: inventoryMovements.id,
      movementType: inventoryMovements.movementType,
      siloId: inventoryMovements.siloId,
      counterpartSiloId: inventoryMovements.counterpartSiloId,
      materialId: inventoryMovements.materialId,
      materialCode: materials.code,
      materialDescription: materials.description,
      lotCode: inventoryMovements.lotCode,
      quantityKg: inventoryMovements.quantityKg,
      unit: inventoryMovements.unit,
      direction: inventoryMovements.direction,
      referenceDocument: inventoryMovements.referenceDocument,
      receiptId: inventoryMovements.receiptId,
      supplierName: inventoryMovements.supplierName,
      status: inventoryMovements.status,
      reason: inventoryMovements.reason,
      shiftCode: inventoryMovements.shiftCode,
      operationalDate: inventoryMovements.operationalDate,
      operatorName: users.displayName,
      executedByName: inventoryMovements.executedByName,
      executedByBadge: inventoryMovements.executedByBadge,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .innerJoin(materials, eq(inventoryMovements.materialId, materials.id))
    .innerJoin(users, eq(inventoryMovements.performedByUserId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(200);

  return rows.map((r) => ({
    ...r,
    siloNumber: siloNumMap.get(r.siloId) ?? null,
    counterpartSiloNumber: r.counterpartSiloId ? (siloNumMap.get(r.counterpartSiloId) ?? null) : null,
    quantityKg: Number(r.quantityKg),
  }));
}

export async function recordBarcodeLookupAndAudit(
  rawBarcode: string,
  scanMethod: 'BARCODE_CAMERA' | 'BARCODE_SCANNER' | 'MANUAL',
  actor: AuthenticatedAppUser
) {
  const allMaterials = await db.select().from(materials);
  const parsed = parseOperationalBarcode(
    rawBarcode,
    allMaterials.map((m) => m.code)
  );

  let matchedMaterial = parsed.materialCode
    ? allMaterials.find((m) => m.code.toUpperCase() === parsed.materialCode!.toUpperCase()) ?? null
    : null;

  const lotHistory = parsed.lotCode
    ? await checkLotHistory(parsed.lotCode, matchedMaterial?.id)
    : null;

  if (!matchedMaterial && lotHistory?.receipts?.[0]?.materialId) {
    matchedMaterial =
      allMaterials.find((m) => m.id === lotHistory.receipts[0].materialId) ?? null;
  }

  const bagConfigs = matchedMaterial
    ? await db
        .select()
        .from(materialBagConfigs)
        .where(eq(materialBagConfigs.materialId, matchedMaterial.id))
    : [];

  const [scanRow] = await db
    .insert(labelScans)
    .values({
      scanMethod,
      rawBarcode: parsed.rawBarcode || null,
      extractedMaterialCode: parsed.materialCode,
      extractedDescription: matchedMaterial?.description ?? null,
      extractedLotCode: parsed.lotCode,
      extractedWeightKg: parsed.weightKg ? parsed.weightKg.toFixed(3) : null,
      extractedEstablishment: parsed.establishment,
      uncertainFields: JSON.stringify(parsed.uncertainFields),
      matchedMaterialId: matchedMaterial?.id ?? null,
      duplicateLotDetected: Boolean(lotHistory?.hasMovements),
      scannedByUserId: actor.id,
    })
    .returning();

  return {
    scanId: scanRow.id,
    parsed,
    matchedMaterial,
    bagConfigs: bagConfigs.map((c) => ({ ...c, unitWeightKg: Number(c.unitWeightKg) })),
    lotHistory,
  };
}

export async function saveGeminiLabelScanAudit(
  params: {
    extraction: {
      materialCode: string | null;
      description: string | null;
      supplierName: string | null;
      lotCode: string | null;
      weightKg: number | null;
      establishment: string | null;
      printDate: string | null;
      rawBarcodeText: string | null;
      uncertainFields: string[];
      notes: string | null;
    };
    sourceImageDataUrl?: string | null;
    sourceMimeType?: string | null;
  },
  actor: AuthenticatedAppUser
) {
  const allMaterials = await db.select().from(materials);
  const allSuppliers = await db.select().from(suppliers);

  let matchedMaterial = null;
  if (params.extraction.materialCode) {
    const codeUpper = params.extraction.materialCode.trim().toUpperCase();
    matchedMaterial =
      allMaterials.find((m) => m.code.toUpperCase() === codeUpper) ?? null;
  }
  if (!matchedMaterial && params.extraction.description) {
    const descUpper = params.extraction.description.trim().toUpperCase();
    matchedMaterial =
      allMaterials.find((m) => m.description.toUpperCase() === descUpper) ?? null;
  }

  const matchedSupplier = params.extraction.supplierName
    ? allSuppliers.find((s) =>
        s.name.toUpperCase().includes(params.extraction.supplierName!.trim().toUpperCase().slice(0, 12))
      ) ?? null
    : null;

  const bagConfigs = matchedMaterial
    ? await db
        .select()
        .from(materialBagConfigs)
        .where(eq(materialBagConfigs.materialId, matchedMaterial.id))
    : [];

  const lotHistory = params.extraction.lotCode
    ? await checkLotHistory(params.extraction.lotCode, matchedMaterial?.id)
    : null;

  const catalogInconsistencies: string[] = [];
  if (
    matchedMaterial &&
    params.extraction.description &&
    !matchedMaterial.description
      .toUpperCase()
      .includes(params.extraction.description.trim().toUpperCase().slice(0, 6))
  ) {
    catalogInconsistencies.push(
      `Descrição na etiqueta ("${params.extraction.description}") difere do catálogo oficial ("${matchedMaterial.description}").`
    );
  }
  if (params.extraction.materialCode && !matchedMaterial) {
    catalogInconsistencies.push(
      `Código ${params.extraction.materialCode} não encontrado no catálogo oficial de matérias-primas.`
    );
  }

  const persistedImageUrl = capLabelPreviewDataUrl(
    params.sourceImageDataUrl,
    params.sourceMimeType || 'image/jpeg'
  );

  const [scanRow] = await db
    .insert(labelScans)
    .values({
      scanMethod: 'PHOTO_GEMINI',
      rawBarcode: params.extraction.rawBarcodeText,
      extractedMaterialCode: params.extraction.materialCode,
      extractedDescription: params.extraction.description,
      extractedLotCode: params.extraction.lotCode,
      extractedSupplier: params.extraction.supplierName,
      extractedWeightKg: params.extraction.weightKg
        ? params.extraction.weightKg.toFixed(3)
        : null,
      extractedEstablishment: params.extraction.establishment,
      extractedPrintDate: params.extraction.printDate,
      confidenceNotes: params.extraction.notes,
      uncertainFields: JSON.stringify(params.extraction.uncertainFields),
      sourceImageDataUrl: persistedImageUrl,
      matchedMaterialId: matchedMaterial?.id ?? null,
      duplicateLotDetected: Boolean(lotHistory?.hasMovements),
      scannedByUserId: actor.id,
    })
    .returning();

  return {
    scanId: scanRow.id,
    extraction: params.extraction,
    matchedMaterial,
    matchedSupplier,
    bagConfigs: bagConfigs.map((c) => ({ ...c, unitWeightKg: Number(c.unitWeightKg) })),
    lotHistory,
    catalogInconsistencies,
    sourceImageDataUrl: persistedImageUrl,
  };
}
