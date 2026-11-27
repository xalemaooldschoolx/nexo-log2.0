import { asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditEvents,
  helpArticles,
  inventoryMovements,
  materialStockThresholds,
  materials,
  operationalRecommendations,
  productionLines,
  receiptDistributions,
  receipts,
  rubricagemBatches,
  rubricagemEntries,
  siloMaterialCompatibility,
  siloTransferRules,
  silos,
  suppliers,
  validationPendencies,
} from './schema.ts';
import type { AuthenticatedAppUser } from './users.ts';
import type { RubricagemWorkflowStatus } from '../types/nexo.ts';
import { evaluateSiloStockStatus } from '../lib/stock-status.ts';
import { resolveStockControlModel, round2, round3 } from '../lib/rubricagem-logic.ts';
import { buildSiloVolumeHistory24h } from '../lib/volume-history.ts';

export async function listSilosWithDetails() {
  try {
    const rows = await db
      .select({
        id: silos.id,
        siloNumber: silos.siloNumber,
        rubricOrder: silos.rubricOrder,
        category: silos.category,
        controlOwner: silos.controlOwner,
        productionLineId: silos.productionLineId,
        lineCode: productionLines.code,
        lineName: productionLines.name,
        heightMeters: silos.heightMeters,
        cordaMeters: silos.cordaMeters,
        nominalCapacityKg: silos.nominalCapacityKg,
        safetyFactorPercent: silos.safetyFactorPercent,
        safeCapacityKg: silos.safeCapacityKg,
        primaryMaterialId: silos.primaryMaterialId,
        materialCode: materials.code,
        materialDescription: materials.description,
        materialCategory: materials.category,
        materialHandlingType: materials.handlingType,
        operationalStatus: silos.operationalStatus,
        cleaningStatus: silos.cleaningStatus,
        isDividedCompartment: silos.isDividedCompartment,
        restrictions: silos.restrictions,
        validationStatus: silos.validationStatus,
        validationNotes: silos.validationNotes,
        updatedAt: silos.updatedAt,
      })
      .from(silos)
      .innerJoin(productionLines, eq(silos.productionLineId, productionLines.id))
      .leftJoin(materials, eq(silos.primaryMaterialId, materials.id))
      .orderBy(asc(silos.rubricOrder));

    // Calculate confirmed stock from immutable ledger (inventory_movements)
    const balances = await db
      .select({
        siloId: inventoryMovements.siloId,
        confirmedStockKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
        lastMovementAt: sql<Date | null>`MAX(${inventoryMovements.createdAt})`,
      })
      .from(inventoryMovements)
      .groupBy(inventoryMovements.siloId);

    const balanceMap = new Map(
      balances.map((b) => [
        b.siloId,
        {
          confirmedStockKg: Number(b.confirmedStockKg || 0),
          lastMovementAt: b.lastMovementAt,
        },
      ])
    );

    const [
      compatRows,
      thresholdRows,
      activeRecRows,
      activeReceivingRows,
      rubricagemRows,
    ] = await Promise.all([
      db
        .select({
          id: siloMaterialCompatibility.id,
          siloId: siloMaterialCompatibility.siloId,
          materialId: siloMaterialCompatibility.materialId,
          materialCode: materials.code,
          materialDescription: materials.description,
          isPrimary: siloMaterialCompatibility.isPrimary,
          allowReceiving: siloMaterialCompatibility.allowReceiving,
          allowTransferIn: siloMaterialCompatibility.allowTransferIn,
          allowTransferOut: siloMaterialCompatibility.allowTransferOut,
          validationStatus: siloMaterialCompatibility.validationStatus,
        })
        .from(siloMaterialCompatibility)
        .innerJoin(materials, eq(siloMaterialCompatibility.materialId, materials.id)),
      db.select().from(materialStockThresholds),
      db
        .select({
          targetSiloId: operationalRecommendations.targetSiloId,
          productionLineId: operationalRecommendations.productionLineId,
          materialId: operationalRecommendations.materialId,
          priority: operationalRecommendations.priority,
          reason: operationalRecommendations.reason,
        })
        .from(operationalRecommendations)
        .where(inArray(operationalRecommendations.decisionStatus, ['PENDENTE', 'EM_ANALISE'])),
      db
        .select({
          siloId: receiptDistributions.siloId,
        })
        .from(receiptDistributions)
        .innerJoin(receipts, eq(receiptDistributions.receiptId, receipts.id))
        .where(inArray(receipts.status, ['PENDENTE', 'PARCIAL'])),
      db
        .select({
          id: rubricagemEntries.id,
          siloId: rubricagemEntries.siloId,
          countedQuantityKg: rubricagemEntries.countedQuantityKg,
          previousConfirmedKg: rubricagemEntries.previousConfirmedKg,
          previousCountAt: rubricagemEntries.previousCountAt,
          deltaPhysicalKg: rubricagemEntries.deltaPhysicalKg,
          deltaPhysicalPct: rubricagemEntries.deltaPhysicalPct,
          deltaVsSystemKg: rubricagemEntries.deltaVsSystemKg,
          itemWorkflowStatus: rubricagemEntries.itemWorkflowStatus,
          confirmedAt: rubricagemEntries.confirmedAt,
          createdAt: rubricagemEntries.createdAt,
          batchCapturedAt: rubricagemBatches.capturedAt,
        })
        .from(rubricagemEntries)
        .innerJoin(rubricagemBatches, eq(rubricagemEntries.batchId, rubricagemBatches.id))
        .orderBy(desc(rubricagemBatches.capturedAt), desc(rubricagemEntries.createdAt)),
    ]);

    const compatBySilo = new Map<number, typeof compatRows>();
    for (const c of compatRows) {
      const list = compatBySilo.get(c.siloId) ?? [];
      list.push(c);
      compatBySilo.set(c.siloId, list);
    }

    const rubricagemBySilo = new Map<number, typeof rubricagemRows>();
    for (const r of rubricagemRows) {
      const list = rubricagemBySilo.get(r.siloId) ?? [];
      list.push(r);
      rubricagemBySilo.set(r.siloId, list);
    }

    const receivingSiloSet = new Set(activeReceivingRows.map((r) => r.siloId));

    // Resolve saldo por silo respeitando estritamente o modelo do grupo (Moega Contínuo x Produção Físico Diário)
    const resolvedStockBySilo = new Map<
      number,
      {
        stockControlModel: ReturnType<typeof resolveStockControlModel>;
        ledgerStockKg: number;
        confirmedStockKg: number;
        lastPhysicalCountKg: number | null;
        lastPhysicalCountAt: string | null;
        previousPhysicalCountKg: number | null;
        previousPhysicalCountAt: string | null;
        physicalVariationKg: number | null;
        physicalVariationPct: number | null;
        physicalDivergenceKg: number | null;
        rubricagemStatus: RubricagemWorkflowStatus | null;
      }
    >();

    const totalStockByMat = new Map<number, number>();
    for (const s of rows) {
      const bal = balanceMap.get(s.id);
      const ledgerStockKg = round3(bal?.confirmedStockKg ?? 0);
      const stockControlModel = resolveStockControlModel(s.controlOwner);
      const siloRubs = rubricagemBySilo.get(s.id) ?? [];
      const latestEntry = siloRubs[0] ?? null;
      const confirmedHistory = siloRubs.filter(
        (r) =>
          r.itemWorkflowStatus === 'INVENTARIO_CONFIRMADO' ||
          r.itemWorkflowStatus === 'HISTORICO_PRESERVADO'
      );
      const latestConfirmed =
        confirmedHistory.find((r) => r.itemWorkflowStatus === 'INVENTARIO_CONFIRMADO') ??
        confirmedHistory[0] ??
        null;
      const priorConfirmed = latestConfirmed
        ? confirmedHistory.find((r) => r.id !== latestConfirmed.id) ?? null
        : null;

      let confirmedStockKg = ledgerStockKg;
      let lastPhysicalCountKg: number | null = latestEntry
        ? Number(latestEntry.countedQuantityKg)
        : null;
      let lastPhysicalCountAt: string | null = latestEntry
        ? (latestEntry.confirmedAt || latestEntry.batchCapturedAt || latestEntry.createdAt).toISOString()
        : null;
      let previousPhysicalCountKg: number | null =
        latestEntry?.previousConfirmedKg !== null && latestEntry?.previousConfirmedKg !== undefined
          ? Number(latestEntry.previousConfirmedKg)
          : null;
      let previousPhysicalCountAt: string | null = latestEntry?.previousCountAt
        ? latestEntry.previousCountAt.toISOString()
        : null;
      let physicalVariationKg: number | null =
        latestEntry?.deltaPhysicalKg !== null && latestEntry?.deltaPhysicalKg !== undefined
          ? Number(latestEntry.deltaPhysicalKg)
          : null;
      let physicalVariationPct: number | null =
        latestEntry?.deltaPhysicalPct !== null && latestEntry?.deltaPhysicalPct !== undefined
          ? Number(latestEntry.deltaPhysicalPct)
          : null;
      let physicalDivergenceKg: number | null = latestEntry
        ? Number(latestEntry.deltaVsSystemKg)
        : null;

      if (s.controlOwner === 'PRODUCAO') {
        // PRODUÇÃO: mantém último saldo físico confirmado; não inventa consumo nem aplica rascunho não autorizado
        confirmedStockKg = latestConfirmed
          ? round3(Number(latestConfirmed.countedQuantityKg))
          : ledgerStockKg;
        lastPhysicalCountKg = latestConfirmed ? Number(latestConfirmed.countedQuantityKg) : null;
        lastPhysicalCountAt = latestConfirmed
          ? (
              latestConfirmed.confirmedAt ||
              latestConfirmed.batchCapturedAt ||
              latestConfirmed.createdAt
            ).toISOString()
          : null;
        previousPhysicalCountKg =
          latestConfirmed?.previousConfirmedKg !== null &&
          latestConfirmed?.previousConfirmedKg !== undefined
            ? Number(latestConfirmed.previousConfirmedKg)
            : priorConfirmed
              ? Number(priorConfirmed.countedQuantityKg)
              : null;
        previousPhysicalCountAt = latestConfirmed?.previousCountAt
          ? latestConfirmed.previousCountAt.toISOString()
          : priorConfirmed
            ? (
                priorConfirmed.confirmedAt ||
                priorConfirmed.batchCapturedAt ||
                priorConfirmed.createdAt
              ).toISOString()
            : null;
        physicalVariationKg =
          latestConfirmed?.deltaPhysicalKg !== null &&
          latestConfirmed?.deltaPhysicalKg !== undefined
            ? Number(latestConfirmed.deltaPhysicalKg)
            : previousPhysicalCountKg !== null && lastPhysicalCountKg !== null
              ? round3(lastPhysicalCountKg - previousPhysicalCountKg)
              : null;
        physicalVariationPct =
          latestConfirmed?.deltaPhysicalPct !== null &&
          latestConfirmed?.deltaPhysicalPct !== undefined
            ? Number(latestConfirmed.deltaPhysicalPct)
            : physicalVariationKg !== null &&
                previousPhysicalCountKg !== null &&
                previousPhysicalCountKg > 0
              ? round2((physicalVariationKg / previousPhysicalCountKg) * 100)
              : null;
        physicalDivergenceKg =
          latestEntry && latestEntry.id !== latestConfirmed?.id
            ? round3(Number(latestEntry.countedQuantityKg) - confirmedStockKg)
            : latestEntry
              ? Number(latestEntry.deltaVsSystemKg)
              : null;
      }

      resolvedStockBySilo.set(s.id, {
        stockControlModel,
        ledgerStockKg,
        confirmedStockKg,
        lastPhysicalCountKg,
        lastPhysicalCountAt,
        previousPhysicalCountKg,
        previousPhysicalCountAt,
        physicalVariationKg,
        physicalVariationPct,
        physicalDivergenceKg,
        rubricagemStatus: (latestEntry?.itemWorkflowStatus as RubricagemWorkflowStatus) ?? null,
      });

      if (s.primaryMaterialId) {
        totalStockByMat.set(
          s.primaryMaterialId,
          (totalStockByMat.get(s.primaryMaterialId) ?? 0) + confirmedStockKg
        );
      }
    }

    const siloThresholdMap = new Map<string, { minStockKg: number; warningStockKg: number }>();
    const siloOnlyThresholdMap = new Map<number, { minStockKg: number; warningStockKg: number }>();
    const globalThresholdMap = new Map<number, { minStockKg: number; warningStockKg: number }>();
    for (const th of thresholdRows) {
      const spec = {
        minStockKg: Number(th.minStockKg),
        warningStockKg: Number(th.warningStockKg),
      };
      if (th.siloId) {
        siloThresholdMap.set(`${th.siloId}::${th.materialId}`, spec);
        if (!siloOnlyThresholdMap.has(th.siloId)) {
          siloOnlyThresholdMap.set(th.siloId, spec);
        }
      } else {
        globalThresholdMap.set(th.materialId, spec);
      }
    }

    const recPriorityRank: Record<string, number> = {
      VERMELHO: 4,
      LARANJA: 3,
      AZUL: 2,
      VERDE: 1,
    };
    const recBySilo = new Map<number, { priority: 'VERMELHO' | 'LARANJA' | 'AZUL' | 'VERDE'; reason: string }>();
    const recByLineMat = new Map<string, { priority: 'VERMELHO' | 'LARANJA' | 'AZUL' | 'VERDE'; reason: string }>();

    for (const rec of activeRecRows) {
      const prio = (rec.priority as 'VERMELHO' | 'LARANJA' | 'AZUL' | 'VERDE') || 'AZUL';
      if (rec.targetSiloId) {
        const prev = recBySilo.get(rec.targetSiloId);
        if (!prev || (recPriorityRank[prio] ?? 0) > (recPriorityRank[prev.priority] ?? 0)) {
          recBySilo.set(rec.targetSiloId, { priority: prio, reason: rec.reason });
        }
      }
      if (rec.productionLineId && rec.materialId) {
        const key = `${rec.productionLineId}::${rec.materialId}`;
        const prev = recByLineMat.get(key);
        if (!prev || (recPriorityRank[prio] ?? 0) > (recPriorityRank[prev.priority] ?? 0)) {
          recByLineMat.set(key, { priority: prio, reason: rec.reason });
        }
      }
    }

    return rows.map((s) => {
      const bal = balanceMap.get(s.id);
      const resolved = resolvedStockBySilo.get(s.id)!;
      const confirmedStockKg = resolved.confirmedStockKg;
      const nominalCapacityKg = Number(s.nominalCapacityKg);
      const safeCapacityKg = Number(s.safeCapacityKg);
      const occupancyPercent =
        safeCapacityKg > 0 ? Math.round((confirmedStockKg / safeCapacityKg) * 1000) / 10 : 0;

      const siloThreshold = s.primaryMaterialId
        ? siloThresholdMap.get(`${s.id}::${s.primaryMaterialId}`) ?? siloOnlyThresholdMap.get(s.id) ?? null
        : siloOnlyThresholdMap.get(s.id) ?? null;

      const globalSpec = s.primaryMaterialId ? globalThresholdMap.get(s.primaryMaterialId) ?? null : null;
      const globalThreshold = globalSpec && s.primaryMaterialId
        ? {
            ...globalSpec,
            totalMaterialStockKg: totalStockByMat.get(s.primaryMaterialId) ?? 0,
          }
        : null;

      const directRec = recBySilo.get(s.id);
      const lineMatRec = s.primaryMaterialId
        ? recByLineMat.get(`${s.productionLineId}::${s.primaryMaterialId}`)
        : undefined;
      const bestRec =
        directRec && lineMatRec
          ? (recPriorityRank[directRec.priority] ?? 0) >= (recPriorityRank[lineMatRec.priority] ?? 0)
            ? directRec
            : lineMatRec
          : directRec ?? lineMatRec ?? null;

      const stockEval = evaluateSiloStockStatus({
        confirmedStockKg,
        safeCapacityKg,
        occupancyPercent,
        operationalStatus: s.operationalStatus,
        primaryMaterialId: s.primaryMaterialId,
        siloThreshold,
        globalThreshold,
        activeRecommendationPriority: bestRec?.priority ?? null,
        activeRecommendationReason: bestRec?.reason ?? null,
      });

      return {
        ...s,
        nominalCapacityKg,
        safeCapacityKg,
        safetyFactorPercent: Number(s.safetyFactorPercent),
        heightMeters: s.heightMeters ? Number(s.heightMeters) : null,
        cordaMeters: s.cordaMeters ? Number(s.cordaMeters) : null,
        confirmedStockKg,
        availableSpaceKg: Math.max(0, safeCapacityKg - confirmedStockKg),
        occupancyPercent,
        stockAlertLevel: stockEval.stockAlertLevel,
        stockAlertReason: stockEval.stockAlertReason,
        minStockKg: stockEval.minStockKg,
        warningStockKg: stockEval.warningStockKg,
        isReceiving: receivingSiloSet.has(s.id),
        lastMovementAt: bal?.lastMovementAt ?? null,
        compatibilities: compatBySilo.get(s.id) ?? [],
        stockControlModel: resolved.stockControlModel,
        ledgerStockKg: resolved.ledgerStockKg,
        lastPhysicalCountKg: resolved.lastPhysicalCountKg,
        lastPhysicalCountAt: resolved.lastPhysicalCountAt,
        previousPhysicalCountKg: resolved.previousPhysicalCountKg,
        previousPhysicalCountAt: resolved.previousPhysicalCountAt,
        physicalVariationKg: resolved.physicalVariationKg,
        physicalVariationPct: resolved.physicalVariationPct,
        physicalDivergenceKg: resolved.physicalDivergenceKg,
        rubricagemStatus: resolved.rubricagemStatus,
      };
    });
  } catch (error) {
    console.error('Database query failed in listSilosWithDetails:', error);
    throw new Error('Falha ao carregar cadastro de silos.', { cause: error });
  }
}

export async function updateSiloConfig(
  siloId: number,
  input: {
    operationalStatus?: string;
    cleaningStatus?: string;
    nominalCapacityKg?: number;
    safetyFactorPercent?: number;
    primaryMaterialId?: number | null;
    restrictions?: string | null;
    validationStatus?: 'VALIDADO' | 'PENDENTE_VALIDACAO';
    validationNotes?: string | null;
  },
  actor: AuthenticatedAppUser,
  reason: string
) {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx.select().from(silos).where(eq(silos.id, siloId)).limit(1);
      if (existing.length === 0) throw new Error('Silo não encontrado.');
      const prev = existing[0];

      const nextNominal = input.nominalCapacityKg ?? Number(prev.nominalCapacityKg);
      const nextSafetyPct = input.safetyFactorPercent ?? Number(prev.safetyFactorPercent);
      const nextSafe = Math.round(nextNominal * (1 - nextSafetyPct / 100) * 100) / 100;

      const [updated] = await tx
        .update(silos)
        .set({
          operationalStatus: input.operationalStatus ?? prev.operationalStatus,
          cleaningStatus: input.cleaningStatus ?? prev.cleaningStatus,
          nominalCapacityKg: nextNominal.toFixed(2),
          safetyFactorPercent: nextSafetyPct.toFixed(2),
          safeCapacityKg: nextSafe.toFixed(2),
          primaryMaterialId:
            input.primaryMaterialId !== undefined ? input.primaryMaterialId : prev.primaryMaterialId,
          restrictions: input.restrictions !== undefined ? input.restrictions : prev.restrictions,
          validationStatus: input.validationStatus ?? prev.validationStatus,
          validationNotes:
            input.validationNotes !== undefined ? input.validationNotes : prev.validationNotes,
          updatedAt: new Date(),
        })
        .where(eq(silos.id, siloId))
        .returning();

      await tx.insert(auditEvents).values({
        userId: actor.id,
        userEmail: actor.email,
        userName: actor.displayName,
        userRole: actor.roleCode,
        action: 'SILO_CONFIG_UPDATED',
        entityType: 'silos',
        entityId: String(prev.siloNumber),
        previousValue: JSON.stringify({
          operationalStatus: prev.operationalStatus,
          cleaningStatus: prev.cleaningStatus,
          nominalCapacityKg: prev.nominalCapacityKg,
          safeCapacityKg: prev.safeCapacityKg,
          primaryMaterialId: prev.primaryMaterialId,
          validationStatus: prev.validationStatus,
        }),
        newValue: JSON.stringify({
          operationalStatus: updated.operationalStatus,
          cleaningStatus: updated.cleaningStatus,
          nominalCapacityKg: updated.nominalCapacityKg,
          safeCapacityKg: updated.safeCapacityKg,
          primaryMaterialId: updated.primaryMaterialId,
          validationStatus: updated.validationStatus,
        }),
        reason: reason || 'Atualização cadastral de silo',
        origin: 'SILO_ADMIN',
      });

      return updated;
    });
  } catch (error) {
    console.error('Database query failed in updateSiloConfig:', error);
    throw new Error('Falha ao atualizar configuração do silo.', { cause: error });
  }
}

export async function listMaterials() {
  try {
    return await db.select().from(materials).orderBy(asc(materials.description));
  } catch (error) {
    console.error('Database query failed in listMaterials:', error);
    throw new Error('Falha ao carregar matérias-primas.', { cause: error });
  }
}

export async function createMaterial(
  input: {
    code: string;
    description: string;
    category: string;
    handlingType: string;
    referenceBagWeightKg?: string | null;
    bagWeightValidationStatus?: string;
    isCritical?: boolean;
    notes?: string | null;
  },
  actor: AuthenticatedAppUser
) {
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(materials)
        .values({
          code: input.code.trim().toUpperCase(),
          description: input.description.trim().toUpperCase(),
          category: input.category,
          handlingType: input.handlingType,
          referenceBagWeightKg: input.referenceBagWeightKg || null,
          bagWeightValidationStatus: input.bagWeightValidationStatus || 'NAO_APLICAVEL',
          isCritical: Boolean(input.isCritical),
          notes: input.notes || null,
        })
        .returning();

      await tx.insert(auditEvents).values({
        userId: actor.id,
        userEmail: actor.email,
        userName: actor.displayName,
        userRole: actor.roleCode,
        action: 'MATERIAL_CREATED',
        entityType: 'materials',
        entityId: created.code,
        previousValue: null,
        newValue: JSON.stringify(created),
        reason: 'Cadastro de nova matéria-prima',
        origin: 'MATERIALS_CATALOG',
      });

      return created;
    });
  } catch (error) {
    console.error('Database query failed in createMaterial:', error);
    throw new Error('Falha ao cadastrar matéria-prima (verifique código duplicado).', {
      cause: error,
    });
  }
}

export async function updateMaterial(
  materialId: number,
  input: {
    description?: string;
    category?: string;
    handlingType?: string;
    referenceBagWeightKg?: string | null;
    bagWeightValidationStatus?: string;
    isCritical?: boolean;
    notes?: string | null;
    isActive?: boolean;
  },
  actor: AuthenticatedAppUser,
  reason: string
) {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(materials)
        .where(eq(materials.id, materialId))
        .limit(1);
      if (existing.length === 0) throw new Error('Matéria-prima não encontrada.');
      const prev = existing[0];

      const [updated] = await tx
        .update(materials)
        .set({
          description: input.description ? input.description.trim().toUpperCase() : prev.description,
          category: input.category ?? prev.category,
          handlingType: input.handlingType ?? prev.handlingType,
          referenceBagWeightKg:
            input.referenceBagWeightKg !== undefined
              ? input.referenceBagWeightKg
              : prev.referenceBagWeightKg,
          bagWeightValidationStatus:
            input.bagWeightValidationStatus ?? prev.bagWeightValidationStatus,
          isCritical: input.isCritical !== undefined ? input.isCritical : prev.isCritical,
          notes: input.notes !== undefined ? input.notes : prev.notes,
          isActive: input.isActive !== undefined ? input.isActive : prev.isActive,
          updatedAt: new Date(),
        })
        .where(eq(materials.id, materialId))
        .returning();

      await tx.insert(auditEvents).values({
        userId: actor.id,
        userEmail: actor.email,
        userName: actor.displayName,
        userRole: actor.roleCode,
        action: 'MATERIAL_UPDATED',
        entityType: 'materials',
        entityId: prev.code,
        previousValue: JSON.stringify(prev),
        newValue: JSON.stringify(updated),
        reason: reason || 'Atualização cadastral de matéria-prima',
        origin: 'MATERIALS_CATALOG',
      });

      return updated;
    });
  } catch (error) {
    console.error('Database query failed in updateMaterial:', error);
    throw new Error('Falha ao atualizar matéria-prima.', { cause: error });
  }
}

export async function listTransferRulesWithDetails() {
  try {
    const allSilos = await db.select().from(silos);
    const siloNumMap = new Map(allSilos.map((s) => [s.id, s.siloNumber]));

    const rules = await db
      .select({
        id: siloTransferRules.id,
        originSiloId: siloTransferRules.originSiloId,
        destinationSiloId: siloTransferRules.destinationSiloId,
        materialId: siloTransferRules.materialId,
        materialCode: materials.code,
        materialDescription: materials.description,
        operationType: siloTransferRules.operationType,
        maxQuantityKg: siloTransferRules.maxQuantityKg,
        requiresAuthorization: siloTransferRules.requiresAuthorization,
        authorizationStatus: siloTransferRules.authorizationStatus,
        validationStatus: siloTransferRules.validationStatus,
        isActive: siloTransferRules.isActive,
        restrictions: siloTransferRules.restrictions,
        sourceReference: siloTransferRules.sourceReference,
      })
      .from(siloTransferRules)
      .innerJoin(materials, eq(siloTransferRules.materialId, materials.id));

    return rules.map((r) => ({
      ...r,
      originSiloNumber: siloNumMap.get(r.originSiloId) ?? null,
      destinationSiloNumber: siloNumMap.get(r.destinationSiloId) ?? null,
    }));
  } catch (error) {
    console.error('Database query failed in listTransferRulesWithDetails:', error);
    throw new Error('Falha ao listar regras de transferência.', { cause: error });
  }
}

export async function listValidationPendencies() {
  try {
    return await db
      .select()
      .from(validationPendencies)
      .orderBy(asc(validationPendencies.status), asc(validationPendencies.id));
  } catch (error) {
    console.error('Database query failed in listValidationPendencies:', error);
    throw new Error('Falha ao listar pendências de validação.', { cause: error });
  }
}

export async function resolveValidationPendency(
  pendencyId: number,
  resolutionNotes: string,
  actor: AuthenticatedAppUser
) {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(validationPendencies)
        .where(eq(validationPendencies.id, pendencyId))
        .limit(1);
      if (existing.length === 0) throw new Error('Pendência não encontrada.');
      const prev = existing[0];

      const [updated] = await tx
        .update(validationPendencies)
        .set({
          status: 'RESOLVIDO',
          resolvedByUserId: actor.id,
          resolutionNotes,
          resolvedAt: new Date(),
        })
        .where(eq(validationPendencies.id, pendencyId))
        .returning();

      await tx.insert(auditEvents).values({
        userId: actor.id,
        userEmail: actor.email,
        userName: actor.displayName,
        userRole: actor.roleCode,
        action: 'PENDENCY_RESOLVED',
        entityType: 'validation_pendencies',
        entityId: prev.entityRef,
        previousValue: JSON.stringify({ status: prev.status }),
        newValue: JSON.stringify({ status: 'RESOLVIDO', resolutionNotes }),
        reason: resolutionNotes,
        origin: 'GOVERNANCE_VALIDATION',
      });

      return updated;
    });
  } catch (error) {
    console.error('Database query failed in resolveValidationPendency:', error);
    throw new Error('Falha ao registrar validação da pendência.', { cause: error });
  }
}

export async function listAuditEvents(limitCount = 100) {
  try {
    return await db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limitCount);
  } catch (error) {
    console.error('Database query failed in listAuditEvents:', error);
    throw new Error('Falha ao consultar trilha de auditoria.', { cause: error });
  }
}

export async function listHelpArticles() {
  try {
    return await db.select().from(helpArticles).orderBy(asc(helpArticles.sortOrder));
  } catch (error) {
    console.error('Database query failed in listHelpArticles:', error);
    throw new Error('Falha ao carregar manual operacional.', { cause: error });
  }
}

export async function listSuppliers() {
  try {
    return await db.select().from(suppliers).orderBy(asc(suppliers.name));
  } catch (error) {
    console.error('Database query failed in listSuppliers:', error);
    throw new Error('Falha ao carregar fornecedores.', { cause: error });
  }
}

export async function listProductionLines() {
  try {
    return await db.select().from(productionLines).orderBy(asc(productionLines.sortOrder));
  } catch (error) {
    console.error('Database query failed in listProductionLines:', error);
    throw new Error('Falha ao carregar linhas de produção.', { cause: error });
  }
}

export async function updateTransferRule(
  ruleId: number,
  input: { isActive?: boolean; validationStatus?: 'VALIDADO' | 'PENDENTE_VALIDACAO'; restrictions?: string | null },
  actor: AuthenticatedAppUser,
  reason: string
) {
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(siloTransferRules)
        .where(eq(siloTransferRules.id, ruleId))
        .limit(1);
      if (existing.length === 0) throw new Error('Regra de transferência não encontrada.');
      const prev = existing[0];

      const [updated] = await tx
        .update(siloTransferRules)
        .set({
          isActive: input.isActive !== undefined ? input.isActive : prev.isActive,
          validationStatus: input.validationStatus ?? prev.validationStatus,
          restrictions: input.restrictions !== undefined ? input.restrictions : prev.restrictions,
        })
        .where(eq(siloTransferRules.id, ruleId))
        .returning();

      await tx.insert(auditEvents).values({
        userId: actor.id,
        userEmail: actor.email,
        userName: actor.displayName,
        userRole: actor.roleCode,
        action: 'TRANSFER_RULE_UPDATED',
        entityType: 'silo_transfer_rules',
        entityId: String(ruleId),
        previousValue: JSON.stringify({
          isActive: prev.isActive,
          validationStatus: prev.validationStatus,
        }),
        newValue: JSON.stringify({
          isActive: updated.isActive,
          validationStatus: updated.validationStatus,
        }),
        reason: reason || 'Atualização na matriz de transferências',
        origin: 'TRANSFER_MATRIX',
      });

      return updated;
    });
  } catch (error) {
    console.error('Database query failed in updateTransferRule:', error);
    throw new Error('Falha ao atualizar regra de transferência.', { cause: error });
  }
}

export async function addSiloCompatibility(
  siloId: number,
  materialId: number,
  options: { allowReceiving: boolean; allowTransferIn: boolean; allowTransferOut: boolean; restrictions?: string },
  actor: AuthenticatedAppUser
) {
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(siloMaterialCompatibility)
        .values({
          siloId,
          materialId,
          isPrimary: false,
          allowReceiving: options.allowReceiving,
          allowTransferIn: options.allowTransferIn,
          allowTransferOut: options.allowTransferOut,
          validationStatus: 'VALIDADO',
          restrictions: options.restrictions || null,
        })
        .onConflictDoUpdate({
          target: [siloMaterialCompatibility.siloId, siloMaterialCompatibility.materialId],
          set: {
            allowReceiving: options.allowReceiving,
            allowTransferIn: options.allowTransferIn,
            allowTransferOut: options.allowTransferOut,
            validationStatus: 'VALIDADO',
            restrictions: options.restrictions || null,
          },
        })
        .returning();

      await tx.insert(auditEvents).values({
        userId: actor.id,
        userEmail: actor.email,
        userName: actor.displayName,
        userRole: actor.roleCode,
        action: 'SILO_COMPATIBILITY_UPDATED',
        entityType: 'silo_material_compatibility',
        entityId: `${siloId}:${materialId}`,
        previousValue: null,
        newValue: JSON.stringify(created),
        reason: 'Vínculo de compatibilidade silo x matéria-prima',
        origin: 'SILO_ADMIN',
      });

      return created;
    });
  } catch (error) {
    console.error('Database query failed in addSiloCompatibility:', error);
    throw new Error('Falha ao atualizar compatibilidade do silo.', { cause: error });
  }
}

export async function getSiloVolumeHistory24h(filters?: {
  siloId?: number | null;
  materialId?: number | null;
  category?: string;
}) {
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 25 * 3600 * 1000);
    const [allSilos, recentMovements] = await Promise.all([
      listSilosWithDetails(),
      db
        .select({
          siloId: inventoryMovements.siloId,
          materialId: inventoryMovements.materialId,
          quantityKg: inventoryMovements.quantityKg,
          direction: inventoryMovements.direction,
          status: inventoryMovements.status,
          createdAt: inventoryMovements.createdAt,
        })
        .from(inventoryMovements)
        .where(gte(inventoryMovements.createdAt, cutoff))
        .orderBy(asc(inventoryMovements.createdAt)),
    ]);

    return buildSiloVolumeHistory24h({
      silos: allSilos,
      movements: recentMovements.map((m) => ({
        siloId: m.siloId,
        materialId: m.materialId,
        quantityKg: Number(m.quantityKg || 0),
        direction: m.direction,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
      siloId: filters?.siloId ?? null,
      materialId: filters?.materialId ?? null,
      category: filters?.category || 'ALL',
      dataOrigin: 'PostgreSQL Oficial — Livro Razão (Últimas 24h)',
      anchorNow: now,
    });
  } catch (error) {
    console.error('Database query failed in getSiloVolumeHistory24h:', error);
    throw new Error('Falha ao reconstruir histórico de volume das últimas 24 horas.', {
      cause: error,
    });
  }
}

