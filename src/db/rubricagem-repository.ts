import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditEvents,
  inventoryMovements,
  materials,
  operationalOccurrences,
  productionLines,
  rubricagemBatches,
  rubricagemEntries,
  silos,
  users,
} from './schema.ts';
import type { AuthenticatedAppUser } from './users.ts';
import { OperationalConflictError } from './operations-repository.ts';
import { listSilosWithDetails } from './repository.ts';
import { resolveShiftConfiguredFromExecutor } from './shift-resolver.ts';
import { capLabelPreviewDataUrl } from '../lib/security-utils.ts';
import {
  buildDailyRubricagemComparisonReport,
  convertQuantityToKg,
  evaluateSingleSheetEntry,
  resolveBatchWorkflowStatus,
  resolveStockControlModel,
  round3,
} from '../lib/rubricagem-logic.ts';
import type {
  DailyRubricagemComparisonReport,
  RubricagemBatchView,
  RubricagemEntryView,
  RubricagemParsedRowInput,
  RubricagemWorkflowStatus,
  StockControlModel,
} from '../types/nexo.ts';

function genCode(prefix: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  const ts = String(now.getTime()).slice(-4);
  return `${prefix}-${y}${m}${d}-${ts}${rand}`;
}

export async function listRubricagemBatches(limit: number = 30): Promise<RubricagemBatchView[]> {
  const [batchRows, entryRows, siloRows, lineRows, matRows, userRows] = await Promise.all([
    db.select().from(rubricagemBatches).orderBy(desc(rubricagemBatches.capturedAt)).limit(limit),
    db.select().from(rubricagemEntries).orderBy(asc(rubricagemEntries.siloNumber)),
    db.select().from(silos),
    db.select().from(productionLines),
    db.select().from(materials),
    db.select({ id: users.id, displayName: users.displayName }).from(users),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u.displayName]));
  const siloMap = new Map(siloRows.map((s) => [s.id, s]));
  const lineMap = new Map(lineRows.map((l) => [l.id, l.code]));
  const matMap = new Map(matRows.map((m) => [m.id, m]));

  const entriesByBatch = new Map<number, RubricagemEntryView[]>();
  for (const e of entryRows) {
    const s = siloMap.get(e.siloId);
    const mat = e.materialIdSnapshot ? matMap.get(e.materialIdSnapshot) : null;
    const view: RubricagemEntryView = {
      id: e.id,
      batchId: e.batchId,
      siloId: e.siloId,
      siloNumber: e.siloNumber,
      lineCode: s ? lineMap.get(s.productionLineId) || 'N/I' : 'N/I',
      category: s?.category || 'LINHA',
      controlOwnerAtCapture: e.controlOwnerAtCapture === 'PRODUCAO' ? 'PRODUCAO' : 'MOEGA',
      stockModel: e.stockModel as StockControlModel,
      materialIdSnapshot: e.materialIdSnapshot,
      materialCodeSnapshot: e.materialCodeSnapshot ?? mat?.code ?? null,
      materialDescriptionSnapshot: mat?.description ?? null,
      previousConfirmedKg: e.previousConfirmedKg !== null ? Number(e.previousConfirmedKg) : null,
      previousCountAt: e.previousCountAt ? e.previousCountAt.toISOString() : null,
      systemLedgerKg: Number(e.systemLedgerKg),
      intermediateMovementsKg: Number(e.intermediateMovementsKg),
      countedQuantityKg: Number(e.countedQuantityKg),
      countedUnit: e.countedUnit === 't' ? 't' : 'kg',
      rawCordaMeters: e.rawCordaMeters !== null ? Number(e.rawCordaMeters) : null,
      deltaPhysicalKg: e.deltaPhysicalKg !== null ? Number(e.deltaPhysicalKg) : null,
      deltaPhysicalPct: e.deltaPhysicalPct !== null ? Number(e.deltaPhysicalPct) : null,
      deltaVsSystemKg: Number(e.deltaVsSystemKg),
      hasDivergence: e.hasDivergence,
      divergenceReason: e.divergenceReason,
      itemWorkflowStatus: e.itemWorkflowStatus as RubricagemWorkflowStatus,
      occurrenceId: e.occurrenceId,
      authorizedAdjustmentMovementId: e.authorizedAdjustmentMovementId,
      confidence: (e.confidence as RubricagemEntryView['confidence']) || 'MANUAL',
      needsReview: e.needsReview,
      notes: e.notes,
      confirmedByName: e.confirmedByUserId ? userMap.get(e.confirmedByUserId) ?? null : null,
      confirmedAt: e.confirmedAt ? e.confirmedAt.toISOString() : null,
      createdAt: e.createdAt.toISOString(),
    };
    const arr = entriesByBatch.get(e.batchId) ?? [];
    arr.push(view);
    entriesByBatch.set(e.batchId, arr);
  }

  return batchRows.map((b) => ({
    id: b.id,
    batchCode: b.batchCode,
    referenceDate: b.referenceDate,
    capturedAt: b.capturedAt.toISOString(),
    sourceType: b.sourceType as RubricagemBatchView['sourceType'],
    fileName: b.fileName,
    mimeType: b.mimeType,
    sourceImageDataUrl: b.sourceImageDataUrl,
    workflowStatus: b.workflowStatus as RubricagemWorkflowStatus,
    moegaCount: b.moegaCount,
    producaoCount: b.producaoCount,
    divergenceCount: b.divergenceCount,
    notes: b.notes,
    importedByUserId: b.importedByUserId,
    importedByName: userMap.get(b.importedByUserId) || 'Operador',
    authorizedByName: b.authorizedByUserId ? userMap.get(b.authorizedByUserId) ?? null : null,
    authorizedAt: b.authorizedAt ? b.authorizedAt.toISOString() : null,
    authorizationReason: b.authorizationReason,
    supersededByBatchId: b.supersededByBatchId,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    entries: entriesByBatch.get(b.id) ?? [],
  }));
}

export interface CreateRubricagemBatchInput {
  referenceDate?: string;
  capturedAtIso?: string;
  sourceType?: 'FOTO_FOLHA_UNICA' | 'UPLOAD_PLANILHA' | 'MANUAL';
  fileName?: string | null;
  mimeType?: string | null;
  sourceImageDataUrl?: string | null;
  notes?: string | null;
  entries: RubricagemParsedRowInput[];
}

/**
 * Registra uma folha única de rubricagem diária contendo silos da Moega e/ou Produção.
 * - Classifica automaticamente pelo cadastro mestre (`silos.controlOwner`).
 * - NUNCA sobrescreve saldo contínuo da Moega nem altera referência da Produção sem autorização.
 * - Cria ocorrências auditáveis automáticas (`Divergência de estoque`) quando detectar divergência.
 */
export async function createRubricagemBatchTransactional(
  input: CreateRubricagemBatchInput,
  actor: AuthenticatedAppUser
): Promise<RubricagemBatchView> {
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new OperationalConflictError(
      'Informe pelo menos uma leitura de silo para registrar a rubricagem.',
      400
    );
  }

  const batchId = await db.transaction(async (tx) => {
    const shift = await resolveShiftConfiguredFromExecutor(tx);
    const referenceDate =
      input.referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(input.referenceDate)
        ? input.referenceDate
        : shift.operationalDate;
    const capturedAt = input.capturedAtIso ? new Date(input.capturedAtIso) : new Date();
    if (Number.isNaN(capturedAt.getTime())) {
      throw new OperationalConflictError('Data/hora da rubricagem inválida.', 400);
    }

    const [allSilos, allMaterials, allLedgerBalances, allConfirmedEntries] = await Promise.all([
      tx.select().from(silos),
      tx.select().from(materials),
      tx
        .select({
          siloId: inventoryMovements.siloId,
          netKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
        })
        .from(inventoryMovements)
        .groupBy(inventoryMovements.siloId),
      tx
        .select()
        .from(rubricagemEntries)
        .where(eq(rubricagemEntries.itemWorkflowStatus, 'INVENTARIO_CONFIRMADO'))
        .orderBy(desc(rubricagemEntries.confirmedAt), desc(rubricagemEntries.createdAt)),
    ]);

    const siloByNumber = new Map(allSilos.map((s) => [s.siloNumber, s]));
    const matMap = new Map(allMaterials.map((m) => [m.id, m]));
    const ledgerMap = new Map(allLedgerBalances.map((b) => [b.siloId, Number(b.netKg || 0)]));

    const lastConfirmedBySilo = new Map<number, typeof allConfirmedEntries[number]>();
    for (const ce of allConfirmedEntries) {
      if (!lastConfirmedBySilo.has(ce.siloId)) {
        lastConfirmedBySilo.set(ce.siloId, ce);
      }
    }

    // Dedup por silo (mantém última ocorrência na lista se operador editou)
    const dedupMap = new Map<number, RubricagemParsedRowInput>();
    for (const raw of input.entries) {
      const siloNum = Number(raw.siloNumber);
      if (!Number.isInteger(siloNum) || !siloByNumber.has(siloNum)) {
        throw new OperationalConflictError(
          `Silo ${raw.siloNumber} não encontrado no cadastro oficial (54 silos, sem 27 e 30).`,
          400
        );
      }
      if (!Number.isFinite(Number(raw.quantityValue)) || Number(raw.quantityValue) < 0) {
        throw new OperationalConflictError(
          `Quantidade inválida para o Silo ${siloNum}.`,
          400
        );
      }
      dedupMap.set(siloNum, raw);
    }

    const persistedPhoto = capLabelPreviewDataUrl(
      input.sourceImageDataUrl,
      input.mimeType || 'image/jpeg'
    );

    const batchCode = genCode('RUB');
    const [insertedBatch] = await tx
      .insert(rubricagemBatches)
      .values({
        batchCode,
        referenceDate,
        capturedAt,
        sourceType: input.sourceType || 'FOTO_FOLHA_UNICA',
        fileName: input.fileName || null,
        mimeType: input.mimeType || null,
        sourceImageDataUrl: persistedPhoto,
        workflowStatus: 'LEITURA_CONCLUIDA',
        moegaCount: 0,
        producaoCount: 0,
        divergenceCount: 0,
        notes: input.notes || null,
        importedByUserId: actor.id,
      })
      .returning();

    let moegaCount = 0;
    let producaoCount = 0;
    let divergenceCount = 0;
    const evaluatedForStatus: Array<{
      hasDivergence: boolean;
      itemWorkflowStatus: RubricagemWorkflowStatus;
    }> = [];

    for (const raw of dedupMap.values()) {
      const s = siloByNumber.get(Number(raw.siloNumber))!;
      const controlOwner = s.controlOwner === 'PRODUCAO' ? 'PRODUCAO' : 'MOEGA';
      if (controlOwner === 'PRODUCAO') producaoCount += 1;
      else moegaCount += 1;

      const countedUnit = raw.unit === 't' ? 't' : 'kg';
      const countedQuantityKg = convertQuantityToKg(Number(raw.quantityValue), countedUnit);
      const systemLedgerKg = round3(ledgerMap.get(s.id) ?? 0);
      const prevEntry = lastConfirmedBySilo.get(s.id) ?? null;
      const previousConfirmedKg = prevEntry ? Number(prevEntry.countedQuantityKg) : null;
      const previousCountAt = prevEntry
        ? (prevEntry.confirmedAt || prevEntry.createdAt).toISOString()
        : null;

      // Calcula movimentações intermediárias registradas no silo após a última contagem física
      let intermediateMovementsKg = 0;
      if (prevEntry) {
        const sinceDate = prevEntry.confirmedAt || prevEntry.createdAt;
        const [interRow] = await tx
          .select({
            netKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
          })
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.siloId, s.id),
              eq(inventoryMovements.status, 'CONFIRMADO'),
              gte(inventoryMovements.createdAt, sinceDate)
            )
          );
        intermediateMovementsKg = round3(Number(interRow?.netKg || 0));
      }

      const evaluation = evaluateSingleSheetEntry({
        siloNumber: s.siloNumber,
        controlOwner,
        nominalCapacityKg: Number(s.nominalCapacityKg),
        safeCapacityKg: Number(s.safeCapacityKg),
        countedQuantityKg,
        systemLedgerKg,
        previousConfirmedKg,
        previousCountAt,
        intermediateMovementsKg,
        needsReview: Boolean(raw.needsReview),
        reviewNote: raw.notes || null,
      });

      let occurrenceId: number | null = null;
      if (evaluation.hasDivergence) {
        divergenceCount += 1;
        const occCode = genCode('OC-RUB');
        const evidenceArr = persistedPhoto
          ? [
              {
                name: input.fileName || `${batchCode}-folha.jpg`,
                mimeType: input.mimeType || 'image/jpeg',
                dataUrlOrNote: persistedPhoto,
              },
            ]
          : [
              {
                name: batchCode,
                dataUrlOrNote: `Rubricagem ${batchCode} · Leitura: ${countedQuantityKg} kg · Sistema/Anterior: ${
                  controlOwner === 'MOEGA' ? systemLedgerKg : (previousConfirmedKg ?? systemLedgerKg)
                } kg`,
              },
            ];

        const [createdOcc] = await tx
          .insert(operationalOccurrences)
          .values({
            occurrenceCode: occCode,
            category: 'Divergência de estoque',
            title: `Divergência na Rubricagem — Silo ${s.siloNumber} (${controlOwner})`,
            description:
              evaluation.divergenceReason ||
              `Divergência detectada na folha ${batchCode} para Silo ${s.siloNumber}.`,
            occurredAt: capturedAt,
            siloId: s.id,
            materialId: s.primaryMaterialId,
            productionLineId: s.productionLineId,
            reportedByUserId: actor.id,
            shiftCode: shift.shiftCode,
            operationalDate: referenceDate,
            priority: controlOwner === 'MOEGA' ? 'ALTA' : 'MEDIA',
            evidenceJson: JSON.stringify(evidenceArr),
            status: 'ABERTA',
          })
          .returning();
        occurrenceId = createdOcc.id;
      }

      const mat = s.primaryMaterialId ? matMap.get(s.primaryMaterialId) : null;

      await tx.insert(rubricagemEntries).values({
        batchId: insertedBatch.id,
        siloId: s.id,
        siloNumber: s.siloNumber,
        controlOwnerAtCapture: controlOwner,
        stockModel: evaluation.stockModel,
        previousConfirmedKg:
          previousConfirmedKg !== null ? previousConfirmedKg.toFixed(3) : null,
        previousCountAt: previousCountAt ? new Date(previousCountAt) : null,
        systemLedgerKg: systemLedgerKg.toFixed(3),
        intermediateMovementsKg: intermediateMovementsKg.toFixed(3),
        countedQuantityKg: countedQuantityKg.toFixed(3),
        countedUnit,
        rawCordaMeters:
          raw.rawCordaMeters !== null && raw.rawCordaMeters !== undefined
            ? Number(raw.rawCordaMeters).toFixed(2)
            : null,
        materialIdSnapshot: s.primaryMaterialId,
        materialCodeSnapshot: mat?.code ?? null,
        deltaPhysicalKg:
          evaluation.deltaPhysicalKg !== null ? evaluation.deltaPhysicalKg.toFixed(3) : null,
        deltaPhysicalPct:
          evaluation.deltaPhysicalPct !== null ? evaluation.deltaPhysicalPct.toFixed(2) : null,
        deltaVsSystemKg: evaluation.deltaVsSystemKg.toFixed(3),
        hasDivergence: evaluation.hasDivergence,
        divergenceReason: evaluation.divergenceReason,
        itemWorkflowStatus: evaluation.itemWorkflowStatus,
        occurrenceId,
        confidence: raw.confidence || 'MANUAL',
        needsReview: Boolean(raw.needsReview),
        notes: raw.notes || null,
      });

      evaluatedForStatus.push({
        hasDivergence: evaluation.hasDivergence,
        itemWorkflowStatus: evaluation.itemWorkflowStatus,
      });
    }

    const batchWorkflowStatus = resolveBatchWorkflowStatus(evaluatedForStatus);

    await tx
      .update(rubricagemBatches)
      .set({
        workflowStatus: batchWorkflowStatus,
        moegaCount,
        producaoCount,
        divergenceCount,
        updatedAt: new Date(),
      })
      .where(eq(rubricagemBatches.id, insertedBatch.id));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'RUBRICAGEM_BATCH_CAPTURED',
      entityType: 'rubricagem_batches',
      entityId: batchCode,
      newValue: JSON.stringify({
        referenceDate,
        moegaCount,
        producaoCount,
        divergenceCount,
        workflowStatus: batchWorkflowStatus,
      }),
      reason: `Captura de rubricagem em folha única (${moegaCount} Moega / ${producaoCount} Produção)`,
      origin: 'RUBRICAGEM_FOLHA_UNICA',
    });

    return insertedBatch.id;
  });

  const all = await listRubricagemBatches(40);
  const found = all.find((b) => b.id === batchId);
  if (!found) {
    throw new OperationalConflictError('Lote de rubricagem não encontrado após criação.', 500);
  }
  return found;
}

/**
 * Autorização formal pela Supervisão ou Administração:
 * - Para PRODUÇÃO: preserva inventários anteriores como HISTORICO_PRESERVADO e promove a nova
 *   leitura para INVENTARIO_CONFIRMADO (nova referência ativa sem inventar consumo).
 * - Para MOEGA: mantém o saldo contínuo por movimentações intacto, exceto para silos da Moega
 *   explicitamente informados em `reconcileMoegaSiloIds`, onde lança um AJUSTE_AUTORIZADO auditável.
 */
export async function authorizeRubricagemBatchTransactional(
  input: {
    batchId: number;
    authorizationReason: string;
    reconcileMoegaSiloIds?: number[];
  },
  actor: AuthenticatedAppUser
): Promise<RubricagemBatchView> {
  if (!input.authorizationReason || input.authorizationReason.trim().length < 5) {
    throw new OperationalConflictError(
      'Informe justificativa formal (mínimo 5 caracteres) para autorizar a rubricagem.',
      400
    );
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM rubricagem_batches WHERE id = ${input.batchId} FOR UPDATE`
    );

    const [batch] = await tx
      .select()
      .from(rubricagemBatches)
      .where(eq(rubricagemBatches.id, input.batchId))
      .limit(1);

    if (!batch) {
      throw new OperationalConflictError('Lote de rubricagem não encontrado.', 404);
    }
    if (batch.workflowStatus === 'INVENTARIO_CONFIRMADO') {
      throw new OperationalConflictError('Este lote de rubricagem já foi confirmado.', 409);
    }

    const entries = await tx
      .select()
      .from(rubricagemEntries)
      .where(eq(rubricagemEntries.batchId, batch.id));

    const shift = await resolveShiftConfiguredFromExecutor(tx);
    const now = new Date();
    const reconcileSet = new Set((input.reconcileMoegaSiloIds || []).map(Number));

    for (const entry of entries) {
      if (entry.controlOwnerAtCapture === 'PRODUCAO') {
        // Preserva integralmente inventários anteriores deste silo como HISTORICO_PRESERVADO
        await tx
          .update(rubricagemEntries)
          .set({
            itemWorkflowStatus: 'HISTORICO_PRESERVADO',
          })
          .where(
            and(
              eq(rubricagemEntries.siloId, entry.siloId),
              eq(rubricagemEntries.itemWorkflowStatus, 'INVENTARIO_CONFIRMADO')
            )
          );

        // Promove esta contagem física a INVENTARIO_CONFIRMADO (nova referência do silo)
        await tx
          .update(rubricagemEntries)
          .set({
            itemWorkflowStatus: 'INVENTARIO_CONFIRMADO',
            confirmedByUserId: actor.id,
            confirmedAt: now,
          })
          .where(eq(rubricagemEntries.id, entry.id));
      } else {
        // MOEGA — Nunca sobrescreve automaticamente; só ajusta livro razão se reconciliação for solicitada
        let adjMovId: number | null = entry.authorizedAdjustmentMovementId;
        if (reconcileSet.has(entry.siloId) && Math.abs(Number(entry.deltaVsSystemKg)) > 1) {
          const [siloRow] = await tx
            .select()
            .from(silos)
            .where(eq(silos.id, entry.siloId))
            .limit(1);

          if (siloRow && siloRow.primaryMaterialId) {
            const delta = Number(entry.deltaVsSystemKg);
            const direction = delta >= 0 ? 'CREDIT' : 'DEBIT';
            const absQty = Math.abs(delta);
            const [mov] = await tx
              .insert(inventoryMovements)
              .values({
                movementType: 'AJUSTE_AUTORIZADO',
                siloId: entry.siloId,
                materialId: siloRow.primaryMaterialId,
                lotCode: 'RECONCILIACAO_RUBRICAGEM',
                quantityKg: absQty.toFixed(3),
                unit: 'kg',
                direction,
                referenceDocument: `${batch.batchCode}-S${entry.siloNumber}`,
                status: 'CONFIRMADO',
                reason: `Reconciliação autorizada de conferência Moega (${batch.batchCode}): ${input.authorizationReason.trim()}`,
                shiftCode: shift.shiftCode,
                operationalDate: shift.operationalDate,
                performedByUserId: actor.id,
                authorizedByUserId: actor.id,
              })
              .returning();
            adjMovId = mov.id;
          }
        }

        await tx
          .update(rubricagemEntries)
          .set({
            itemWorkflowStatus: 'INVENTARIO_CONFIRMADO',
            authorizedAdjustmentMovementId: adjMovId,
            confirmedByUserId: actor.id,
            confirmedAt: now,
          })
          .where(eq(rubricagemEntries.id, entry.id));
      }

      if (entry.occurrenceId) {
        await tx
          .update(operationalOccurrences)
          .set({
            status: 'ENCERRADA',
            solutionApplied: `Autorizado e conferido via lote ${batch.batchCode}: ${input.authorizationReason.trim()}`,
            verifiedByUserId: actor.id,
            verifiedAt: now,
            closedByUserId: actor.id,
            closedAt: now,
            updatedAt: now,
          })
          .where(eq(operationalOccurrences.id, entry.occurrenceId));
      }
    }

    // Marca lotes anteriores totalmente substituídos como HISTORICO_PRESERVADO
    const producaoSiloIds = entries
      .filter((e) => e.controlOwnerAtCapture === 'PRODUCAO')
      .map((e) => e.siloId);
    if (producaoSiloIds.length > 0) {
      await tx
        .update(rubricagemBatches)
        .set({
          supersededByBatchId: batch.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(rubricagemBatches.workflowStatus, 'INVENTARIO_CONFIRMADO'),
            sql`${rubricagemBatches.id} <> ${batch.id}`
          )
        );
    }

    await tx
      .update(rubricagemBatches)
      .set({
        workflowStatus: 'INVENTARIO_CONFIRMADO',
        authorizedByUserId: actor.id,
        authorizedAt: now,
        authorizationReason: input.authorizationReason.trim(),
        updatedAt: now,
      })
      .where(eq(rubricagemBatches.id, batch.id));

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'RUBRICAGEM_BATCH_AUTHORIZED',
      entityType: 'rubricagem_batches',
      entityId: batch.batchCode,
      previousValue: JSON.stringify({ workflowStatus: batch.workflowStatus }),
      newValue: JSON.stringify({
        workflowStatus: 'INVENTARIO_CONFIRMADO',
        reconcileMoegaSiloIds: Array.from(reconcileSet),
      }),
      reason: input.authorizationReason.trim(),
      origin: 'AUTORIZACAO_RUBRICAGEM',
    });
  });

  const all = await listRubricagemBatches(40);
  const found = all.find((b) => b.id === input.batchId);
  if (!found) {
    throw new OperationalConflictError('Lote autorizado não encontrado.', 500);
  }
  return found;
}

export async function getDailyRubricagemComparisonReport(filters?: {
  referenceDate?: string;
  siloId?: number | null;
  materialId?: number | null;
  lineCode?: string;
}): Promise<DailyRubricagemComparisonReport> {
  const [silosDetail, batches, shift] = await Promise.all([
    listSilosWithDetails(),
    listRubricagemBatches(40),
    resolveShiftConfiguredFromExecutor(db),
  ]);

  let filteredSilos = silosDetail;
  if (filters?.siloId) {
    filteredSilos = filteredSilos.filter((s) => s.id === filters.siloId);
  }
  if (filters?.materialId) {
    filteredSilos = filteredSilos.filter((s) => s.primaryMaterialId === filters.materialId);
  }
  if (filters?.lineCode) {
    filteredSilos = filteredSilos.filter((s) => s.lineCode === filters.lineCode);
  }

  const refDate =
    filters?.referenceDate && /^\d{4}-\d{2}-\d{2}$/.test(filters.referenceDate)
      ? filters.referenceDate
      : batches[0]?.referenceDate || shift.operationalDate;

  return buildDailyRubricagemComparisonReport({
    referenceDate: refDate,
    silos: filteredSilos,
    batches,
    dataOrigin:
      'PostgreSQL — Estoque Contínuo Moega (inventory_movements) + Inventário Físico Diário Produção (rubricagem_entries)',
  });
}
