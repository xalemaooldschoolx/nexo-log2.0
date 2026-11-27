import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditEvents,
  inventoryMovements,
  materials,
  materialStockThresholds,
  operationalRecommendations,
  productConsumptionFactors,
  productionConsumptionProjections,
  productionLines,
  productionScheduleItems,
  productionSchedules,
  products,
  receipts,
  scheduleDocuments,
  scheduleDocumentTemplates,
  siloMaterialCompatibility,
  silos,
  siloTransferRules,
  users,
} from './schema.ts';
import type { AuthenticatedAppUser } from './users.ts';
import { ensureBaseCatalogSeeded } from './seed-reference.ts';
import { resolveShiftConfiguredFromExecutor } from './shift-resolver.ts';
import { OperationalConflictError } from './operations-repository.ts';
import {
  type AlertPriority,
  calculateDeterministicConsumption,
  computeOperationalIntelligence,
  type ConfidenceLevel,
  diffScheduleRevisions,
  type ExecutionStatus,
  type ProductConsumptionFactorSnapshot,
  type RevisionItemSnapshot,
  round3,
} from '../lib/production-intelligence.ts';
import {
  type ExtractedScheduleItem,
  interpretScheduleDocumentWithGemini,
  parseCsvToMatrix,
  parseMatrixDeterministically,
  parseXlsxBase64ToText,
  type ScheduleDocumentExtraction,
} from '../lib/gemini-documents.ts';

function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function generateScheduleCode(referenceDate: string, revisionNumber: number): string {
  const compact = referenceDate.replace(/-/g, '');
  const rand = Math.floor(100 + Math.random() * 900);
  return `PROG-${compact}-R${revisionNumber}-${rand}`;
}

export async function listScheduleTemplates() {
  await ensureBaseCatalogSeeded();
  return db
    .select()
    .from(scheduleDocumentTemplates)
    .where(eq(scheduleDocumentTemplates.isActive, true))
    .orderBy(asc(scheduleDocumentTemplates.id));
}

export async function listProductsWithFactors() {
  await ensureBaseCatalogSeeded();
  const [prodRows, factorRows, lineRows, matRows] = await Promise.all([
    db.select().from(products).orderBy(asc(products.code)),
    db.select().from(productConsumptionFactors),
    db.select().from(productionLines),
    db.select().from(materials),
  ]);

  const lineById = new Map(lineRows.map((l) => [l.id, l]));
  const matById = new Map(matRows.map((m) => [m.id, m]));

  return prodRows.map((p) => {
    const line = p.defaultProductionLineId ? lineById.get(p.defaultProductionLineId) : null;
    const factors = factorRows
      .filter((f) => f.productId === p.id)
      .map((f) => {
        const mat = matById.get(f.materialId);
        return {
          id: f.id,
          productId: f.productId,
          materialId: f.materialId,
          materialCode: mat?.code ?? '',
          materialDescription: mat?.description ?? '',
          factorKgPerUnit: Number(f.factorKgPerUnit),
          unit: f.unit,
          validationStatus: f.validationStatus as 'VALIDADO' | 'PENDENTE_VALIDACAO',
          sourceReference: f.sourceReference,
          notes: f.notes,
          updatedAt: f.updatedAt.toISOString(),
        };
      });

    return {
      id: p.id,
      code: p.code,
      description: p.description,
      defaultProductionLineId: p.defaultProductionLineId,
      defaultLineCode: line?.code ?? null,
      defaultUnit: p.defaultUnit,
      isActive: p.isActive,
      notes: p.notes,
      factors,
    };
  });
}

export async function upsertProduct(
  input: {
    code: string;
    description: string;
    defaultProductionLineId?: number | null;
    defaultUnit?: string;
    notes?: string | null;
  },
  actor: AuthenticatedAppUser
) {
  const code = input.code.trim().toUpperCase();
  const description = input.description.trim().toUpperCase();
  if (!code || !description) {
    throw new OperationalConflictError('Código e descrição do produto são obrigatórios.', 400);
  }

  return db.transaction(async (tx) => {
    const existing = await tx.select().from(products).where(eq(products.code, code)).limit(1);
    let saved: any;
    if (existing.length > 0) {
      const [updated] = await tx
        .update(products)
        .set({
          description,
          defaultProductionLineId: input.defaultProductionLineId ?? existing[0].defaultProductionLineId,
          defaultUnit: input.defaultUnit || existing[0].defaultUnit,
          notes: input.notes ?? existing[0].notes,
          updatedAt: new Date(),
        })
        .where(eq(products.id, existing[0].id))
        .returning();
      saved = updated;
    } else {
      const [created] = await tx
        .insert(products)
        .values({
          code,
          description,
          defaultProductionLineId: input.defaultProductionLineId ?? null,
          defaultUnit: input.defaultUnit || 't',
          notes: input.notes ?? null,
        })
        .returning();
      saved = created;
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: existing.length > 0 ? 'ATUALIZACAO_PRODUTO' : 'CADASTRO_PRODUTO',
      entityType: 'PRODUCT',
      entityId: String(saved.id),
      previousValue: existing.length > 0 ? JSON.stringify(existing[0]) : null,
      newValue: JSON.stringify(saved),
      reason: 'Cadastro/atualização de produto programado',
    });

    return saved;
  });
}

export async function upsertConsumptionFactor(
  input: {
    productId: number;
    materialId: number;
    factorKgPerUnit: number;
    unit: string;
    validationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO';
    sourceReference?: string | null;
    notes?: string | null;
    reason?: string;
  },
  actor: AuthenticatedAppUser
) {
  if (!Number.isFinite(input.factorKgPerUnit) || input.factorKgPerUnit <= 0) {
    throw new OperationalConflictError('Fator de consumo deve ser maior que zero.', 400);
  }
  const unit = input.unit.trim().toLowerCase();
  if (!['t', 'kg', 'batelada'].includes(unit)) {
    throw new OperationalConflictError('Unidade do fator deve ser t, kg ou batelada.', 400);
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(productConsumptionFactors)
      .where(
        and(
          eq(productConsumptionFactors.productId, input.productId),
          eq(productConsumptionFactors.materialId, input.materialId)
        )
      )
      .limit(1);

    let saved: any;
    if (existing.length > 0) {
      const [updated] = await tx
        .update(productConsumptionFactors)
        .set({
          factorKgPerUnit: String(input.factorKgPerUnit),
          unit,
          validationStatus: input.validationStatus,
          sourceReference: input.sourceReference ?? existing[0].sourceReference,
          notes: input.notes ?? existing[0].notes,
          updatedByUserId: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(productConsumptionFactors.id, existing[0].id))
        .returning();
      saved = updated;
    } else {
      const [created] = await tx
        .insert(productConsumptionFactors)
        .values({
          productId: input.productId,
          materialId: input.materialId,
          factorKgPerUnit: String(input.factorKgPerUnit),
          unit,
          validationStatus: input.validationStatus,
          sourceReference: input.sourceReference ?? null,
          notes: input.notes ?? null,
          updatedByUserId: actor.id,
        })
        .returning();
      saved = created;
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: existing.length > 0 ? 'EDICAO_FATOR_CONSUMO' : 'CADASTRO_FATOR_CONSUMO',
      entityType: 'CONSUMPTION_FACTOR',
      entityId: String(saved.id),
      previousValue: existing.length > 0 ? JSON.stringify(existing[0]) : null,
      newValue: JSON.stringify(saved),
      reason: input.reason || 'Atualização de fator determinístico de consumo',
    });

    return saved;
  });
}

export async function listStockThresholds() {
  const [rows, matRows, siloRows] = await Promise.all([
    db.select().from(materialStockThresholds),
    db.select().from(materials),
    db.select().from(silos),
  ]);
  const matById = new Map(matRows.map((m) => [m.id, m]));
  const siloById = new Map(siloRows.map((s) => [s.id, s]));

  return rows.map((t) => ({
    id: t.id,
    materialId: t.materialId,
    materialCode: matById.get(t.materialId)?.code ?? '',
    materialDescription: matById.get(t.materialId)?.description ?? '',
    siloId: t.siloId,
    siloNumber: t.siloId ? siloById.get(t.siloId)?.siloNumber ?? null : null,
    minStockKg: Number(t.minStockKg),
    warningStockKg: Number(t.warningStockKg),
    notes: t.notes,
    updatedAt: t.updatedAt.toISOString(),
  }));
}

export async function upsertStockThreshold(
  input: {
    materialId: number;
    siloId?: number | null;
    minStockKg: number;
    warningStockKg: number;
    notes?: string | null;
  },
  actor: AuthenticatedAppUser
) {
  if (input.minStockKg < 0 || input.warningStockKg < input.minStockKg) {
    throw new OperationalConflictError(
      'Limite de atenção deve ser maior ou igual ao estoque mínimo (>= 0).',
      400
    );
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(materialStockThresholds)
      .where(
        input.siloId
          ? and(
              eq(materialStockThresholds.materialId, input.materialId),
              eq(materialStockThresholds.siloId, input.siloId)
            )
          : and(
              eq(materialStockThresholds.materialId, input.materialId),
              sql`${materialStockThresholds.siloId} IS NULL`
            )
      )
      .limit(1);

    let saved: any;
    if (existing.length > 0) {
      const [updated] = await tx
        .update(materialStockThresholds)
        .set({
          minStockKg: String(input.minStockKg),
          warningStockKg: String(input.warningStockKg),
          notes: input.notes ?? null,
          updatedByUserId: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(materialStockThresholds.id, existing[0].id))
        .returning();
      saved = updated;
    } else {
      const [created] = await tx
        .insert(materialStockThresholds)
        .values({
          materialId: input.materialId,
          siloId: input.siloId ?? null,
          minStockKg: String(input.minStockKg),
          warningStockKg: String(input.warningStockKg),
          notes: input.notes ?? null,
          updatedByUserId: actor.id,
        })
        .returning();
      saved = created;
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'CONFIG_ESTOQUE_MINIMO',
      entityType: 'STOCK_THRESHOLD',
      entityId: String(saved.id),
      previousValue: existing.length > 0 ? JSON.stringify(existing[0]) : null,
      newValue: JSON.stringify(saved),
      reason: 'Configuração de limite mínimo de estoque',
    });

    return saved;
  });
}

export async function parseAndStoreScheduleDocument(
  input: {
    fileName: string;
    mimeType: string;
    sourceType: 'FOTO_TABLET' | 'ARQUIVO_PDF' | 'ARQUIVO_IMAGEM' | 'ARQUIVO_XLSX' | 'ARQUIVO_CSV';
    documentCategory: string;
    templateId?: number | null;
    fileBase64?: string;
    rawCsvText?: string;
  },
  actor: AuthenticatedAppUser
) {
  await ensureBaseCatalogSeeded();

  const [linesRows, matRows, prodRows, factorRows, tplRows] = await Promise.all([
    db.select().from(productionLines).orderBy(asc(productionLines.sortOrder)),
    db.select().from(materials),
    db.select().from(products),
    db.select().from(productConsumptionFactors),
    db.select().from(scheduleDocumentTemplates),
  ]);

  const template =
    (input.templateId ? tplRows.find((t) => t.id === input.templateId) : null) ||
    tplRows.find((t) => t.documentCategory === input.documentCategory) ||
    tplRows[0];

  const catalogContext = [
    `Linhas válidas: ${linesRows.map((l) => `${l.code} (${l.name})`).join(', ')}`,
    `Produtos cadastrados (${prodRows.length}): ${prodRows
      .slice(0, 40)
      .map((p) => `${p.code} - ${p.description}`)
      .join(' | ') || 'Nenhum produto pré-cadastrado ainda'}`,
    `Matérias-primas oficiais (${matRows.length}): ${matRows
      .slice(0, 40)
      .map((m) => `${m.code} - ${m.description}`)
      .join(' | ')}`,
  ].join('\n');

  let extractedTextPreview: string | null = null;
  let extraction: ScheduleDocumentExtraction;

  if (input.sourceType === 'ARQUIVO_CSV') {
    const csvText =
      input.rawCsvText ||
      (input.fileBase64
        ? Buffer.from(input.fileBase64.replace(/^data:[^;]+;base64,/, ''), 'base64').toString(
            'utf8'
          )
        : '');
    if (!csvText.trim()) {
      throw new OperationalConflictError('Arquivo CSV vazio.', 400);
    }
    const matrix = parseCsvToMatrix(csvText);
    extractedTextPreview = matrix.map((r) => r.join(' | ')).join('\n');

    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
      extraction = await interpretScheduleDocumentWithGemini({
        sourceType: 'ARQUIVO_CSV',
        mimeType: 'text/csv',
        tabularText: extractedTextPreview,
        templatePromptHints: template?.promptHints || 'Programação de produção em CSV.',
        catalogContext,
      });
    } else {
      extraction = parseMatrixDeterministically(matrix);
    }
  } else if (input.sourceType === 'ARQUIVO_XLSX') {
    if (!input.fileBase64) {
      throw new OperationalConflictError('Conteúdo XLSX não enviado.', 400);
    }
    const parsed = await parseXlsxBase64ToText(input.fileBase64);
    extractedTextPreview = parsed.textPreview;

    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY') {
      extraction = await interpretScheduleDocumentWithGemini({
        sourceType: 'ARQUIVO_XLSX',
        mimeType: input.mimeType,
        tabularText: extractedTextPreview,
        templatePromptHints: template?.promptHints || 'Planilha XLSX de programação.',
        catalogContext,
      });
    } else {
      extraction = parseMatrixDeterministically(parsed.matrix);
    }
  } else {
    if (!input.fileBase64) {
      throw new OperationalConflictError('Arquivo ou fotografia não enviado.', 400);
    }
    extraction = await interpretScheduleDocumentWithGemini({
      sourceType: input.sourceType,
      mimeType: input.mimeType,
      fileBase64: input.fileBase64,
      templatePromptHints: template?.promptHints || 'Documento de programação da produção.',
      catalogContext,
    });
  }

  // Enriquecer itens com conferência contra o cadastro oficial PostgreSQL
  const lineByCode = new Map(linesRows.map((l) => [l.code.toUpperCase(), l]));
  const matByCode = new Map(matRows.map((m) => [m.code.toUpperCase(), m]));
  const prodByCode = new Map(prodRows.map((p) => [p.code.toUpperCase(), p]));

  const enrichedItems = extraction.items.map((it: ExtractedScheduleItem) => {
    const flags: string[] = [];
    const matchedLine = it.lineCode ? lineByCode.get(it.lineCode.toUpperCase()) : null;
    if (!matchedLine) flags.push('Linha não reconhecida ou incompleta');

    const matchedProduct = it.productCode ? prodByCode.get(it.productCode.toUpperCase()) : null;
    const matchedMaterial = it.materialCode ? matByCode.get(it.materialCode.toUpperCase()) : null;

    if (it.productCode && !matchedProduct && !matchedMaterial) {
      flags.push(`Código ${it.productCode} não encontrado no cadastro de produtos`);
    }
    if (it.materialCode && !matchedMaterial) {
      flags.push(`MP ${it.materialCode} não encontrada no cadastro`);
    }

    const validUnits = ['kg', 't', 'ton', 'batelada'];
    if (!it.plannedUnit || !validUnits.includes(it.plannedUnit.toLowerCase())) {
      flags.push('Unidade de medida desconhecida ou ausente');
    }
    if (!it.plannedQuantity || it.plannedQuantity <= 0) {
      flags.push('Quantidade ausente ou inválida');
    }

    const hasValidatedFactor = matchedProduct
      ? factorRows.some(
          (f) => f.productId === matchedProduct.id && f.validationStatus === 'VALIDADO'
        )
      : false;
    if (!matchedMaterial && !hasValidatedFactor) {
      flags.push('Fator de consumo não cadastrado/validado (ficará pendente)');
    }

    const combinedReason = [it.reviewReason, ...flags].filter(Boolean).join(' · ');

    return {
      ...it,
      productionLineId: matchedLine?.id ?? null,
      matchedProductId: matchedProduct?.id ?? null,
      matchedMaterialId: matchedMaterial?.id ?? null,
      hasValidatedFactor,
      needsReview: it.needsReview || flags.length > 0 || it.confidence === 'BAIXA',
      reviewReason: combinedReason || null,
    };
  });

  // Persistir documento original para preservação integral
  const [savedDoc] = await db
    .insert(scheduleDocuments)
    .values({
      fileName: input.fileName,
      mimeType: input.mimeType,
      sourceType: input.sourceType,
      documentCategory: input.documentCategory || extraction.documentCategory || 'PROGRAMACAO',
      templateId: template?.id ?? null,
      fileContentBase64: input.fileBase64 ? input.fileBase64.slice(0, 8_000_000) : null,
      extractedTextPreview,
      rawAiJson: JSON.stringify(extraction),
      uploadedByUserId: actor.id,
    })
    .returning();

  await db.insert(auditEvents).values({
    userId: actor.id,
    userEmail: actor.email,
    userName: actor.displayName,
    userRole: actor.roleCode,
    action: 'IMPORTACAO_DOCUMENTO_PROGRAMACAO',
    entityType: 'SCHEDULE_DOCUMENT',
    entityId: String(savedDoc.id),
    newValue: JSON.stringify({
      fileName: input.fileName,
      sourceType: input.sourceType,
      itemsExtracted: enrichedItems.length,
    }),
    reason: 'Leitura documental para conferência antes da incorporação',
  });

  // Preview de revisão se já existir programação aprovada na data identificada
  let existingRevisionPreview = null;
  if (extraction.productionDate) {
    const existingApproved = await db
      .select()
      .from(productionSchedules)
      .where(
        and(
          eq(productionSchedules.referenceDate, extraction.productionDate),
          eq(productionSchedules.status, 'APROVADA')
        )
      )
      .limit(1);

    if (existingApproved.length > 0) {
      const prevItems = await db
        .select()
        .from(productionScheduleItems)
        .where(eq(productionScheduleItems.scheduleId, existingApproved[0].id));

      const prevSnapshots: RevisionItemSnapshot[] = prevItems.map((pi) => {
        const line = linesRows.find((l) => l.id === pi.productionLineId);
        return {
          lineCode: line?.code || 'L?',
          productCode: pi.productCode,
          productDescription: pi.productDescription,
          plannedQuantity: Number(pi.plannedQuantity),
          plannedUnit: pi.plannedUnit,
          materialCode: pi.materialCode,
        };
      });

      const nextSnapshots: RevisionItemSnapshot[] = enrichedItems.map((ni) => ({
        lineCode: ni.lineCode || 'L?',
        productCode: ni.productCode || ni.materialCode || 'SEM_COD',
        productDescription: ni.productDescription || ni.materialDescription || 'Sem descrição',
        plannedQuantity: ni.plannedQuantity || 0,
        plannedUnit: ni.plannedUnit || '?',
        materialCode: ni.materialCode,
      }));

      existingRevisionPreview = {
        previousScheduleCode: existingApproved[0].scheduleCode,
        previousRevisionNumber: existingApproved[0].revisionNumber,
        diff: diffScheduleRevisions(prevSnapshots, nextSnapshots),
      };
    }
  }

  return {
    documentId: savedDoc.id,
    fileName: savedDoc.fileName,
    mimeType: savedDoc.mimeType,
    sourceType: savedDoc.sourceType,
    extractedTextPreview,
    extraction: {
      ...extraction,
      items: enrichedItems,
    },
    existingRevisionPreview,
  };
}

export interface DraftScheduleItemInput {
  productionLineId: number;
  sequenceOrder: number;
  productId?: number | null;
  productCode: string;
  productDescription: string;
  materialId?: number | null;
  materialCode?: string | null;
  plannedQuantity: number;
  plannedUnit: 't' | 'kg' | 'batelada';
  scheduledTimeWindow?: string | null;
  extractionConfidence?: ConfidenceLevel;
  needsReview?: boolean;
  reviewReason?: string | null;
  notes?: string | null;
}

export async function saveScheduleDraft(
  input: {
    referenceDate: string;
    documentId?: number | null;
    sourceReportType?: string;
    notes?: string | null;
    items: DraftScheduleItemInput[];
  },
  actor: AuthenticatedAppUser
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.referenceDate)) {
    throw new OperationalConflictError('Data de referência inválida (use YYYY-MM-DD).', 400);
  }
  if (!input.items || input.items.length === 0) {
    throw new OperationalConflictError('Informe ao menos 1 item programado.', 400);
  }

  return db.transaction(async (tx) => {
    const existingForDate = await tx
      .select()
      .from(productionSchedules)
      .where(eq(productionSchedules.referenceDate, input.referenceDate));

    const nextRev =
      existingForDate.reduce((max, s) => Math.max(max, s.revisionNumber), 0) + 1;

    const [created] = await tx
      .insert(productionSchedules)
      .values({
        scheduleCode: generateScheduleCode(input.referenceDate, nextRev),
        referenceDate: input.referenceDate,
        revisionNumber: nextRev,
        documentId: input.documentId ?? null,
        sourceReportType: input.sourceReportType || 'PROGRAMACAO',
        status: 'RASCUNHO_CONFERENCIA',
        notes: input.notes ?? null,
        importedByUserId: actor.id,
      })
      .returning();

    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i];
      if (!Number.isFinite(it.plannedQuantity) || it.plannedQuantity <= 0) {
        throw new OperationalConflictError(
          `Item #${i + 1} possui quantidade programada inválida.`,
          400
        );
      }
      await tx.insert(productionScheduleItems).values({
        scheduleId: created.id,
        productionLineId: it.productionLineId,
        sequenceOrder: it.sequenceOrder || i + 1,
        productId: it.productId ?? null,
        productCode: it.productCode.trim().toUpperCase(),
        productDescription: it.productDescription.trim().toUpperCase(),
        materialId: it.materialId ?? null,
        materialCode: it.materialCode ? it.materialCode.trim().toUpperCase() : null,
        plannedQuantity: String(it.plannedQuantity),
        plannedUnit: it.plannedUnit,
        scheduledTimeWindow: it.scheduledTimeWindow ?? null,
        executionStatus: 'NAO_INICIADA',
        realizedQuantity: '0.000',
        extractionConfidence: it.extractionConfidence || 'MANUAL',
        needsReview: Boolean(it.needsReview),
        reviewReason: it.reviewReason ?? null,
        notes: it.notes ?? null,
      });
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'CRIACAO_RASCUNHO_PROGRAMACAO',
      entityType: 'PRODUCTION_SCHEDULE',
      entityId: String(created.id),
      newValue: JSON.stringify({
        scheduleCode: created.scheduleCode,
        referenceDate: created.referenceDate,
        itemsCount: input.items.length,
      }),
      reason: 'Programação salva para conferência operacional',
    });

    return created;
  });
}

export async function approveScheduleTransactional(
  scheduleId: number,
  actor: AuthenticatedAppUser,
  approvalNotes?: string
) {
  return db.transaction(async (tx) => {
    const targetRows = await tx
      .select()
      .from(productionSchedules)
      .where(eq(productionSchedules.id, scheduleId))
      .limit(1);

    if (targetRows.length === 0) {
      throw new OperationalConflictError('Programação não encontrada.', 404);
    }
    const target = targetRows[0];
    if (target.status === 'APROVADA') {
      throw new OperationalConflictError('Esta programação já está aprovada.', 409);
    }

    // Lock schedules of this referenceDate to keep revision numbers strictly consistent
    await tx.execute(
      sql`SELECT id FROM production_schedules WHERE reference_date = ${target.referenceDate} FOR UPDATE`
    );

    const prevApprovedRows = await tx
      .select()
      .from(productionSchedules)
      .where(
        and(
          eq(productionSchedules.referenceDate, target.referenceDate),
          eq(productionSchedules.status, 'APROVADA')
        )
      )
      .orderBy(desc(productionSchedules.revisionNumber))
      .limit(1);

    const prevApproved = prevApprovedRows[0] ?? null;

    const [items, lineRows, matRows, prodRows, factorRows] = await Promise.all([
      tx
        .select()
        .from(productionScheduleItems)
        .where(eq(productionScheduleItems.scheduleId, target.id))
        .orderBy(asc(productionScheduleItems.sequenceOrder)),
      tx.select().from(productionLines),
      tx.select().from(materials),
      tx.select().from(products),
      tx.select().from(productConsumptionFactors),
    ]);

    const lineById = new Map(lineRows.map((l) => [l.id, l]));
    const matById = new Map(matRows.map((m) => [m.id, m]));
    const matByCode = new Map(matRows.map((m) => [m.code.toUpperCase(), m]));
    const prodByCode = new Map(prodRows.map((p) => [p.code.toUpperCase(), p]));

    const validatedFactors: ProductConsumptionFactorSnapshot[] = factorRows
      .filter((f) => f.validationStatus === 'VALIDADO')
      .map((f) => ({
        id: f.id,
        productId: f.productId,
        materialId: f.materialId,
        factorKgPerUnit: Number(f.factorKgPerUnit),
        unit: f.unit,
        validationStatus: f.validationStatus as 'VALIDADO' | 'PENDENTE_VALIDACAO',
        sourceReference: f.sourceReference,
      }));

    // Limpar projeções antigas deste rascunho se houver e recalcular de forma determinística
    await tx
      .delete(productionConsumptionProjections)
      .where(eq(productionConsumptionProjections.scheduleId, target.id));

    const newSnapshots: RevisionItemSnapshot[] = [];

    for (const item of items) {
      const line = lineById.get(item.productionLineId);
      const resolvedProductId =
        item.productId ?? prodByCode.get(item.productCode.toUpperCase())?.id ?? null;
      const resolvedMaterialId =
        item.materialId ??
        (item.materialCode ? matByCode.get(item.materialCode.toUpperCase())?.id : null) ??
        null;

      const calcs = calculateDeterministicConsumption({
        plannedQuantity: Number(item.plannedQuantity),
        plannedUnit: item.plannedUnit,
        productId: resolvedProductId,
        directMaterialId: resolvedMaterialId,
        validatedFactors,
      });

      for (const c of calcs) {
        await tx.insert(productionConsumptionProjections).values({
          scheduleId: target.id,
          scheduleItemId: item.id,
          productionLineId: item.productionLineId,
          referenceDate: target.referenceDate,
          materialId: c.materialId,
          factorId: c.factorId,
          factorUsed: c.factorUsed !== null ? String(c.factorUsed) : null,
          plannedProductQty: item.plannedQuantity,
          calculatedConsumptionKg: String(c.calculatedConsumptionKg),
          realizedConsumptionKg: '0.000',
          calculationStatus: c.calculationStatus,
          originSource: c.originSource,
        });

        const mat = c.materialId ? matById.get(c.materialId) : null;
        newSnapshots.push({
          lineCode: line?.code ?? 'L?',
          productCode: item.productCode,
          productDescription: item.productDescription,
          plannedQuantity: Number(item.plannedQuantity),
          plannedUnit: item.plannedUnit,
          materialCode: mat?.code ?? item.materialCode,
          consumptionKg: c.calculatedConsumptionKg,
        });
      }
    }

    let prevSnapshots: RevisionItemSnapshot[] | null = null;
    if (prevApproved) {
      const [prevItems, prevProjs] = await Promise.all([
        tx
          .select()
          .from(productionScheduleItems)
          .where(eq(productionScheduleItems.scheduleId, prevApproved.id)),
        tx
          .select()
          .from(productionConsumptionProjections)
          .where(eq(productionConsumptionProjections.scheduleId, prevApproved.id)),
      ]);

      prevSnapshots = [];
      for (const pi of prevItems) {
        const line = lineById.get(pi.productionLineId);
        const relatedProjs = prevProjs.filter((p) => p.scheduleItemId === pi.id);
        if (relatedProjs.length > 0) {
          for (const rp of relatedProjs) {
            const mat = rp.materialId ? matById.get(rp.materialId) : null;
            prevSnapshots.push({
              lineCode: line?.code ?? 'L?',
              productCode: pi.productCode,
              productDescription: pi.productDescription,
              plannedQuantity: Number(pi.plannedQuantity),
              plannedUnit: pi.plannedUnit,
              materialCode: mat?.code ?? pi.materialCode,
              consumptionKg: Number(rp.calculatedConsumptionKg),
            });
          }
        } else {
          prevSnapshots.push({
            lineCode: line?.code ?? 'L?',
            productCode: pi.productCode,
            productDescription: pi.productDescription,
            plannedQuantity: Number(pi.plannedQuantity),
            plannedUnit: pi.plannedUnit,
            materialCode: pi.materialCode,
            consumptionKg: 0,
          });
        }
      }

      // Preservar histórico: marcar revisão anterior como SUPERSEDED sem apagar
      await tx
        .update(productionSchedules)
        .set({ status: 'SUPERSEDED', updatedAt: new Date() })
        .where(eq(productionSchedules.id, prevApproved.id));
    }

    const diff = diffScheduleRevisions(prevSnapshots, newSnapshots);
    const nextRevNumber = prevApproved ? prevApproved.revisionNumber + 1 : target.revisionNumber;

    const [approved] = await tx
      .update(productionSchedules)
      .set({
        status: 'APROVADA',
        revisionNumber: nextRevNumber,
        previousScheduleId: prevApproved?.id ?? null,
        revisionDiffSummary: diff.summaryText,
        notes: approvalNotes
          ? [target.notes, approvalNotes].filter(Boolean).join(' | ')
          : target.notes,
        approvedByUserId: actor.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(productionSchedules.id, target.id))
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'APROVACAO_PROGRAMACAO',
      entityType: 'PRODUCTION_SCHEDULE',
      entityId: String(approved.id),
      previousValue: prevApproved
        ? JSON.stringify({
            supersededScheduleId: prevApproved.id,
            supersededRevision: prevApproved.revisionNumber,
          })
        : null,
      newValue: JSON.stringify({
        scheduleCode: approved.scheduleCode,
        revisionNumber: approved.revisionNumber,
        diffSummary: diff.summaryText,
      }),
      reason: approvalNotes || 'Conferência concluída e programação incorporada ao NEXO LOG',
    });

    return {
      schedule: approved,
      diff,
    };
  });
}

export async function updateScheduleItemExecution(
  input: {
    scheduleItemId: number;
    executionStatus: ExecutionStatus;
    realizedQuantity?: number;
    notes?: string;
    reason: string;
  },
  actor: AuthenticatedAppUser
) {
  if (!input.reason || input.reason.trim().length < 3) {
    throw new OperationalConflictError('Informe o motivo operacional da atualização.', 400);
  }

  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(productionScheduleItems)
      .where(eq(productionScheduleItems.id, input.scheduleItemId))
      .limit(1);

    if (existingRows.length === 0) {
      throw new OperationalConflictError('Item de programação não encontrado.', 404);
    }
    const prev = existingRows[0];
    const plannedQty = Number(prev.plannedQuantity);
    const nextRealizedQty =
      input.realizedQuantity !== undefined
        ? Math.max(0, input.realizedQuantity)
        : input.executionStatus === 'CONCLUIDA'
          ? plannedQty
          : Number(prev.realizedQuantity);

    const [updated] = await tx
      .update(productionScheduleItems)
      .set({
        executionStatus: input.executionStatus,
        realizedQuantity: String(nextRealizedQty),
        notes: input.notes ?? prev.notes,
        updatedAt: new Date(),
      })
      .where(eq(productionScheduleItems.id, prev.id))
      .returning();

    // Atualizar consumo realizado proporcional nas projeções deste item
    const projRows = await tx
      .select()
      .from(productionConsumptionProjections)
      .where(eq(productionConsumptionProjections.scheduleItemId, prev.id));

    const ratio = plannedQty > 0 ? Math.min(1.5, nextRealizedQty / plannedQty) : 0;
    for (const p of projRows) {
      const realizedConsKg =
        input.executionStatus === 'CONCLUIDA' && nextRealizedQty >= plannedQty
          ? Number(p.calculatedConsumptionKg)
          : round3(Number(p.calculatedConsumptionKg) * ratio);
      await tx
        .update(productionConsumptionProjections)
        .set({ realizedConsumptionKg: String(realizedConsKg) })
        .where(eq(productionConsumptionProjections.id, p.id));
    }

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action: 'ATUALIZACAO_EXECUCAO_PRODUCAO',
      entityType: 'PRODUCTION_SCHEDULE_ITEM',
      entityId: String(prev.id),
      previousValue: JSON.stringify({
        executionStatus: prev.executionStatus,
        realizedQuantity: prev.realizedQuantity,
      }),
      newValue: JSON.stringify({
        executionStatus: updated.executionStatus,
        realizedQuantity: updated.realizedQuantity,
      }),
      reason: input.reason.trim(),
    });

    return updated;
  });
}

export async function listProductionSchedules(filters?: { referenceDate?: string }) {
  await ensureBaseCatalogSeeded();
  const [schedRows, itemRows, projRows, lineRows, userRows, docRows] = await Promise.all([
    filters?.referenceDate
      ? db
          .select()
          .from(productionSchedules)
          .where(eq(productionSchedules.referenceDate, filters.referenceDate))
          .orderBy(desc(productionSchedules.referenceDate), desc(productionSchedules.revisionNumber))
      : db
          .select()
          .from(productionSchedules)
          .orderBy(desc(productionSchedules.referenceDate), desc(productionSchedules.revisionNumber))
          .limit(60),
    db.select().from(productionScheduleItems).orderBy(asc(productionScheduleItems.sequenceOrder)),
    db.select().from(productionConsumptionProjections),
    db.select().from(productionLines),
    db.select().from(users),
    db
      .select({
        id: scheduleDocuments.id,
        fileName: scheduleDocuments.fileName,
        mimeType: scheduleDocuments.mimeType,
        sourceType: scheduleDocuments.sourceType,
        documentCategory: scheduleDocuments.documentCategory,
        createdAt: scheduleDocuments.createdAt,
      })
      .from(scheduleDocuments),
  ]);

  const lineById = new Map(lineRows.map((l) => [l.id, l]));
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const docById = new Map(docRows.map((d) => [d.id, d]));

  return schedRows.map((s) => {
    const items = itemRows
      .filter((it) => it.scheduleId === s.id)
      .map((it) => {
        const line = lineById.get(it.productionLineId);
        const itemProjs = projRows.filter((p) => p.scheduleItemId === it.id);
        return {
          id: it.id,
          scheduleId: it.scheduleId,
          productionLineId: it.productionLineId,
          lineCode: line?.code ?? '',
          lineName: line?.name ?? '',
          sequenceOrder: it.sequenceOrder,
          productId: it.productId,
          productCode: it.productCode,
          productDescription: it.productDescription,
          materialId: it.materialId,
          materialCode: it.materialCode,
          plannedQuantity: Number(it.plannedQuantity),
          plannedUnit: it.plannedUnit,
          scheduledTimeWindow: it.scheduledTimeWindow,
          executionStatus: it.executionStatus as ExecutionStatus,
          realizedQuantity: Number(it.realizedQuantity),
          extractionConfidence: it.extractionConfidence as ConfidenceLevel,
          needsReview: it.needsReview,
          reviewReason: it.reviewReason,
          notes: it.notes,
          projections: itemProjs.map((p) => ({
            id: p.id,
            materialId: p.materialId,
            calculatedConsumptionKg: Number(p.calculatedConsumptionKg),
            realizedConsumptionKg: Number(p.realizedConsumptionKg),
            calculationStatus: p.calculationStatus,
            originSource: p.originSource,
          })),
        };
      });

    const doc = s.documentId ? docById.get(s.documentId) : null;
    return {
      id: s.id,
      scheduleCode: s.scheduleCode,
      referenceDate: s.referenceDate,
      revisionNumber: s.revisionNumber,
      previousScheduleId: s.previousScheduleId,
      documentId: s.documentId,
      documentMeta: doc
        ? {
            fileName: doc.fileName,
            mimeType: doc.mimeType,
            sourceType: doc.sourceType,
            documentCategory: doc.documentCategory,
          }
        : null,
      sourceReportType: s.sourceReportType,
      status: s.status,
      revisionDiffSummary: s.revisionDiffSummary,
      notes: s.notes,
      importedByName: userById.get(s.importedByUserId)?.displayName ?? 'Operador',
      approvedByName: s.approvedByUserId ? userById.get(s.approvedByUserId)?.displayName ?? null : null,
      approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
      items,
    };
  });
}

export async function getScheduleDocumentById(documentId: number) {
  const rows = await db
    .select()
    .from(scheduleDocuments)
    .where(eq(scheduleDocuments.id, documentId))
    .limit(1);
  if (rows.length === 0) {
    throw new OperationalConflictError('Documento original não encontrado.', 404);
  }
  return rows[0];
}

export async function getOperationalIntelligenceSummary(filters?: {
  todayDate?: string;
  lineCode?: string;
  materialId?: number;
  siloId?: number;
  priority?: AlertPriority;
  executionStatus?: ExecutionStatus;
}) {
  await ensureBaseCatalogSeeded();
  const shift = await resolveShiftConfiguredFromExecutor(db);
  const todayDate = filters?.todayDate || shift.operationalDate;
  const tomorrowDate = addDaysToIsoDate(todayDate, 1);

  const [
    siloRows,
    lineRows,
    compatRows,
    matRows,
    ruleRows,
    receiptRows,
    siloMatBalances,
    approvedSchedules,
    scheduleItemsRows,
    projectionRows,
    thresholdRows,
    existingRecs,
  ] = await Promise.all([
    db.select().from(silos).orderBy(asc(silos.rubricOrder)),
    db.select().from(productionLines),
    db.select().from(siloMaterialCompatibility),
    db.select().from(materials),
    db.select().from(siloTransferRules),
    db
      .select()
      .from(receipts)
      .where(inArray(receipts.status, ['PENDENTE', 'PARCIAL'])),
    db
      .select({
        siloId: inventoryMovements.siloId,
        materialId: inventoryMovements.materialId,
        netKg: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryMovements.direction} = 'CREDIT' THEN ${inventoryMovements.quantityKg} ELSE -${inventoryMovements.quantityKg} END), 0)`,
      })
      .from(inventoryMovements)
      .groupBy(inventoryMovements.siloId, inventoryMovements.materialId),
    db
      .select()
      .from(productionSchedules)
      .where(eq(productionSchedules.status, 'APROVADA'))
      .orderBy(desc(productionSchedules.referenceDate), desc(productionSchedules.revisionNumber)),
    db.select().from(productionScheduleItems),
    db.select().from(productionConsumptionProjections),
    db.select().from(materialStockThresholds),
    db.select().from(operationalRecommendations),
  ]);

  const lineById = new Map(lineRows.map((l) => [l.id, l]));
  const approvedScheduleIds = new Set(approvedSchedules.map((s) => s.id));
  const itemById = new Map(scheduleItemsRows.map((i) => [i.id, i]));

  const siloStockSum = new Map<number, number>();
  for (const b of siloMatBalances) {
    siloStockSum.set(b.siloId, round3((siloStockSum.get(b.siloId) || 0) + Number(b.netKg || 0)));
  }

  const siloInputs = siloRows.map((s) => {
    const line = lineById.get(s.productionLineId);
    const compIds = compatRows
      .filter((c) => c.siloId === s.id && (c.allowReceiving || c.allowTransferIn))
      .map((c) => c.materialId);
    return {
      id: s.id,
      siloNumber: s.siloNumber,
      lineCode: line?.code ?? 'L?',
      category: s.category,
      controlOwner: s.controlOwner,
      primaryMaterialId: s.primaryMaterialId,
      operationalStatus: s.operationalStatus,
      nominalCapacityKg: Number(s.nominalCapacityKg),
      safeCapacityKg: Number(s.safeCapacityKg),
      confirmedStockKg: siloStockSum.get(s.id) || 0,
      compatibleMaterialIds: compIds,
    };
  });

  const approvedProjections = projectionRows
    .filter((p) => approvedScheduleIds.has(p.scheduleId))
    .map((p) => {
      const item = itemById.get(p.scheduleItemId);
      const line = lineById.get(p.productionLineId);
      return {
        scheduleId: p.scheduleId,
        scheduleItemId: p.scheduleItemId,
        referenceDate: p.referenceDate,
        lineCode: line?.code ?? 'L?',
        materialId: p.materialId,
        calculatedConsumptionKg: Number(p.calculatedConsumptionKg),
        realizedConsumptionKg: Number(p.realizedConsumptionKg),
        calculationStatus: p.calculationStatus as 'CALCULADO' | 'PENDENTE_FATOR',
        executionStatus: (item?.executionStatus ?? 'NAO_INICIADA') as ExecutionStatus,
      };
    })
    .filter((p) => {
      if (filters?.lineCode && p.lineCode !== filters.lineCode) return false;
      if (filters?.materialId && p.materialId !== filters.materialId) return false;
      if (filters?.executionStatus && p.executionStatus !== filters.executionStatus) return false;
      return true;
    });

  const analysis = computeOperationalIntelligence({
    todayDate,
    tomorrowDate,
    silos: siloInputs,
    siloMaterialStocks: siloMatBalances.map((b) => ({
      siloId: b.siloId,
      materialId: b.materialId,
      netKg: Number(b.netKg || 0),
    })),
    materials: matRows.map((m) => ({
      id: m.id,
      code: m.code,
      description: m.description,
      isCritical: m.isCritical,
    })),
    transferRules: ruleRows.map((r) => ({
      id: r.id,
      originSiloId: r.originSiloId,
      destinationSiloId: r.destinationSiloId,
      materialId: r.materialId,
      maxQuantityKg: r.maxQuantityKg ? Number(r.maxQuantityKg) : null,
      validationStatus: r.validationStatus,
      isActive: r.isActive,
    })),
    pendingConfirmedReceipts: receiptRows.map((r) => ({
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
    projections: approvedProjections,
    thresholds: thresholdRows.map((t) => ({
      materialId: t.materialId,
      siloId: t.siloId,
      minStockKg: Number(t.minStockKg),
      warningStockKg: Number(t.warningStockKg),
    })),
  });

  // Persistir / atualizar recomendações operacionais mantendo decisões já registradas
  const existingByKey = new Map(existingRecs.map((r) => [r.recommendationKey, r]));
  const persistedRecs: any[] = [];

  for (const rec of analysis.recommendations) {
    const prev = existingByKey.get(rec.recommendationKey);
    if (prev) {
      const [updated] = await db
        .update(operationalRecommendations)
        .set({
          priority: rec.priority,
          title: rec.title,
          reason: rec.reason,
          requiredKg: String(rec.requiredKg),
          availableKg: String(rec.availableKg),
          missingKg: String(rec.missingKg),
          suggestedTransferKg:
            rec.suggestedTransferKg !== null ? String(rec.suggestedTransferKg) : null,
          dataSourceSummary: rec.dataSourceSummary,
        })
        .where(eq(operationalRecommendations.id, prev.id))
        .returning();
      persistedRecs.push({ ...rec, ...updated });
    } else {
      const [inserted] = await db
        .insert(operationalRecommendations)
        .values({
          recommendationKey: rec.recommendationKey,
          referenceDate: rec.referenceDate,
          recommendationType: rec.recommendationType,
          priority: rec.priority,
          title: rec.title,
          reason: rec.reason,
          materialId: rec.materialId,
          productionLineId:
            rec.lineCode ? lineRows.find((l) => l.code === rec.lineCode)?.id ?? null : null,
          targetSiloId: rec.targetSiloId,
          originSiloId: rec.originSiloId,
          requiredKg: String(rec.requiredKg),
          availableKg: String(rec.availableKg),
          missingKg: String(rec.missingKg),
          suggestedTransferKg:
            rec.suggestedTransferKg !== null ? String(rec.suggestedTransferKg) : null,
          dataSourceSummary: rec.dataSourceSummary,
          decisionStatus: 'PENDENTE',
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        persistedRecs.push({ ...rec, ...inserted });
      }
    }
  }

  const selectedSiloNumber = filters?.siloId
    ? siloInputs.find((s) => s.id === filters.siloId)?.siloNumber ?? null
    : null;

  const filteredAlerts = analysis.alerts.filter((a) => {
    if (filters?.priority && a.priority !== filters.priority) return false;
    if (selectedSiloNumber !== null && a.siloNumber !== selectedSiloNumber) return false;
    return true;
  });

  const filteredMaterials = analysis.byMaterial.filter((m) => {
    if (filters?.materialId && m.materialId !== filters.materialId) return false;
    if (filters?.priority && m.statusPriority !== filters.priority) return false;
    return true;
  });

  const filteredRecs = persistedRecs.filter((r) => {
    if (filters?.siloId && r.targetSiloId !== filters.siloId && r.originSiloId !== filters.siloId) {
      return false;
    }
    if (filters?.priority && r.priority !== filters.priority) return false;
    return true;
  });

  const latestApproved = approvedSchedules[0] ?? null;

  return {
    todayDate,
    tomorrowDate,
    totals: analysis.totals,
    byMaterial: filteredMaterials,
    alerts: filteredAlerts,
    recommendations: filteredRecs.map((r) => ({
      id: r.id,
      recommendationKey: r.recommendationKey,
      recommendationType: r.recommendationType,
      priority: r.priority,
      title: r.title,
      reason: r.reason,
      referenceDate: r.referenceDate,
      lineCode: r.lineCode ?? null,
      materialId: r.materialId,
      materialCode: r.materialCode ?? null,
      materialDescription: r.materialDescription ?? null,
      targetSiloId: r.targetSiloId,
      targetSiloNumber: r.targetSiloNumber ?? null,
      originSiloId: r.originSiloId,
      originSiloNumber: r.originSiloNumber ?? null,
      requiredKg: Number(r.requiredKg),
      availableKg: Number(r.availableKg),
      missingKg: Number(r.missingKg),
      suggestedTransferKg: r.suggestedTransferKg ? Number(r.suggestedTransferKg) : null,
      dataSourceSummary: r.dataSourceSummary,
      decisionStatus: r.decisionStatus || 'PENDENTE',
      decisionNotes: r.decisionNotes || null,
      decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    })),
    latestSchedule: latestApproved
      ? {
          id: latestApproved.id,
          scheduleCode: latestApproved.scheduleCode,
          referenceDate: latestApproved.referenceDate,
          revisionNumber: latestApproved.revisionNumber,
          revisionDiffSummary: latestApproved.revisionDiffSummary,
          approvedAt: latestApproved.approvedAt
            ? latestApproved.approvedAt.toISOString()
            : null,
        }
      : null,
  };
}

export async function decideOperationalRecommendation(
  input: {
    recommendationId: number;
    decision: 'ACEITA' | 'REJEITADA';
    decisionNotes?: string;
  },
  actor: AuthenticatedAppUser
) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(operationalRecommendations)
      .where(eq(operationalRecommendations.id, input.recommendationId))
      .limit(1);

    if (existing.length === 0) {
      throw new OperationalConflictError('Sugestão operacional não encontrada.', 404);
    }

    const prev = existing[0];
    const [updated] = await tx
      .update(operationalRecommendations)
      .set({
        decisionStatus: input.decision,
        decidedByUserId: actor.id,
        decisionNotes: input.decisionNotes || null,
        decidedAt: new Date(),
      })
      .where(eq(operationalRecommendations.id, prev.id))
      .returning();

    await tx.insert(auditEvents).values({
      userId: actor.id,
      userEmail: actor.email,
      userName: actor.displayName,
      userRole: actor.roleCode,
      action:
        input.decision === 'ACEITA'
          ? 'ACEITE_SUGESTAO_OPERACIONAL'
          : 'REJEICAO_SUGESTAO_OPERACIONAL',
      entityType: 'OPERATIONAL_RECOMMENDATION',
      entityId: String(prev.id),
      previousValue: JSON.stringify({ decisionStatus: prev.decisionStatus }),
      newValue: JSON.stringify({
        decisionStatus: updated.decisionStatus,
        title: updated.title,
      }),
      reason:
        input.decisionNotes ||
        `Decisão registrada pelo operador (${input.decision}) — sem movimentação automática`,
    });

    return updated;
  });
}
