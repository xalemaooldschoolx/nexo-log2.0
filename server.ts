import 'dotenv/config';
import { createServer } from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { count } from 'drizzle-orm';
import { type AuthRequest, requireAuth, requirePermission } from './src/middleware/auth.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { resolveOperationalShift } from './src/lib/shifts.ts';
import { hasPermission, ROLE_PERMISSIONS } from './src/lib/rbac.ts';
import { db } from './src/db/index.ts';
import {
  auditEvents,
  labelScans,
  materialIntakeRequests,
} from './src/db/schema.ts';
import { getOrCreateUser, listUsersWithRoles, updateUserAccount } from './src/db/users.ts';
import { ensureBaseCatalogSeeded } from './src/db/seed-reference.ts';
import {
  addSiloCompatibility,
  createMaterial,
  getSiloVolumeHistory24h,
  listAuditEvents,
  listHelpArticles,
  listMaterials,
  listProductionLines,
  listSilosWithDetails,
  listSuppliers,
  listTransferRulesWithDetails,
  listValidationPendencies,
  resolveValidationPendency,
  updateMaterial,
  updateSiloConfig,
  updateTransferRule,
} from './src/db/repository.ts';
import {
  OperationalConflictError,
  adjustSiloStockTransactional,
  checkLotHistory,
  createReceiptTransactional,
  distributeReceiptTransactional,
  executeTransferTransactional,
  getCompatibleSilosForMaterial,
  getSiloLedgerDetails,
  listInventoryMovementsReport,
  listMaterialBagConfigs,
  listReceiptsWithDetails,
  recordBarcodeLookupAndAudit,
  reverseMovementTransactional,
  saveGeminiLabelScanAudit,
  upsertMaterialBagConfig,
} from './src/db/operations-repository.ts';
import {
  generateOperationalAdviceWithGemini,
  interpretLabelImageWithGemini,
  interpretRubricagemSheetWithGemini,
} from './src/lib/gemini-vision.ts';
import {
  authorizeRubricagemBatchTransactional,
  createRubricagemBatchTransactional,
  getDailyRubricagemComparisonReport,
  listRubricagemBatches,
} from './src/db/rubricagem-repository.ts';
import {
  convertQuantityToKg,
  resolveStockControlModel,
} from './src/lib/rubricagem-logic.ts';
import {
  approveScheduleTransactional,
  decideOperationalRecommendation,
  getOperationalIntelligenceSummary,
  getScheduleDocumentById,
  listProductionSchedules,
  listProductsWithFactors,
  listScheduleTemplates,
  listStockThresholds,
  parseAndStoreScheduleDocument,
  saveScheduleDraft,
  updateScheduleItemExecution,
  upsertConsumptionFactor,
  upsertProduct,
  upsertStockThreshold,
} from './src/db/schedules-repository.ts';
import {
  createAuthorizedRoute,
  createMaterialIntakeRequestTransactional,
  createTransferOrderTransactional,
  executeTransferOrderStepTransactional,
  getPriorityConfig,
  getProductionSupplyBoard,
  interruptTransferOrder,
  listAuthorizedRoutesWithHistory,
  listMaterialIntakeRequests,
  listTransferOrdersWithSteps,
  startTransferOrder,
  updateAuthorizedRouteStatus,
  updatePriorityConfig,
  updateSupplyRecommendationDecision,
} from './src/db/supply-repository.ts';
import { explainSupplyScenarioWithGemini } from './src/lib/gemini-supply-advisor.ts';
import {
  acknowledgeShiftPendencyTransactional,
  addShiftHandoverSupplementTransactional,
  approveShiftHandoverTransactional,
  buildShiftAutoSummary,
  correctShiftHandoverPostApprovalTransactional,
  createOccurrenceTransactional,
  exportOperationalReportTransactional,
  finalizeShiftHandoverTransactional,
  getConsumptionAndScheduleReport,
  getOperationalIndicatorsOverview,
  getReceivingReport,
  getShiftManagerialReports,
  getStockAndHistoricalReport,
  getTransfersReport,
  listOccurrences,
  listOpenShiftPendencies,
  listPerformanceTargets,
  listReportSnapshots,
  listShiftHandovers,
  listShiftsWithAssignments,
  queryNexoAssistantContext,
  resolveActiveShiftFromDb,
  resolveShiftPendencyTransactional,
  saveShiftHandoverDraftTransactional,
  updateOccurrenceStatusTransactional,
  updateShiftConfigTransactional,
  upsertPerformanceTargetTransactional,
  verifyOccurrenceTransactional,
} from './src/db/phase5-repository.ts';
import {
  askNexoAssistantWithGemini,
  refineShiftReportWithGemini,
} from './src/lib/gemini-assistant.ts';
import {
  openGeminiLiveVoiceSession,
  runMultimodalStudioChat,
  transcribeAudioWithGemini,
} from './src/lib/gemini-studio.ts';
import {
  createBasketVersionRecord,
  exportBasketComparisonReport,
  extractBasketFromUpload,
  get30DayConsumptionTrend,
  getBasketComparisonById,
  getLatestPublishedBasketNotification,
  listBasketHistory,
  publishBasketComparisonTransactional,
  runBasketComparisonRecord,
  updateBasketVersionItemsRecord,
} from './src/db/baskets-repository.ts';
import {
  ALLOWED_BASKET_UPLOAD_MIMES,
  ALLOWED_IMAGE_MIMES,
  MAX_IMAGE_UPLOAD_BYTES,
  capLabelPreviewDataUrl,
  estimateBase64DecodedBytes,
  normalizeMime,
  sanitizePresentationBootstrapData,
  validateAudioUploadPayload,
  validateImageUploadPayload,
} from './src/lib/security-utils.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const nexoWsClients = new Set<WebSocket>();
  const broadcastNexoEvent = (eventPayload: Record<string, unknown>) => {
    const serialized = JSON.stringify(eventPayload);
    for (const client of nexoWsClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  app.use(express.json({ limit: '25mb' }));

  // Health endpoint (non-DB probe)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'NEXO LOG 2.0',
      phase: 'FASE_5_RELATORIOS_TURNOS_OCORRENCIAS',
      timestamp: new Date().toISOString(),
    });
  });

  // Public read-only bootstrap for Executive Presentation Mode (non-PII PostgreSQL catalog + live counts/balances)
  app.get('/api/presentation/bootstrap', async (_req, res) => {
    try {
      await ensureBaseCatalogSeeded();
      const [
        activeShift,
        linesList,
        materialsList,
        suppliersList,
        bagConfigsList,
        silosList,
        transferRulesList,
        routesList,
        pendenciesList,
        helpArticlesList,
        scheduleTemplatesList,
        shiftsList,
        productsList,
        thresholdsList,
        receiptsList,
        movementsList,
        transferOrdersList,
        schedulesList,
        supplyBoardData,
        intelligenceData,
        occurrencesList,
        handoversList,
        openShiftPendenciesList,
        performanceTargetsList,
        recentSnapshotsList,
        rubricagemBatchesList,
        [labelScanCountRow],
        [auditEventCountRow],
        [intakeReqCountRow],
      ] = await Promise.all([
        resolveActiveShiftFromDb().catch(() => resolveOperationalShift()),
        listProductionLines(),
        listMaterials(),
        listSuppliers(),
        listMaterialBagConfigs(),
        listSilosWithDetails(),
        listTransferRulesWithDetails(),
        listAuthorizedRoutesWithHistory(),
        listValidationPendencies(),
        listHelpArticles(),
        listScheduleTemplates(),
        listShiftsWithAssignments(),
        listProductsWithFactors(),
        listStockThresholds(),
        listReceiptsWithDetails(),
        listInventoryMovementsReport(),
        listTransferOrdersWithSteps(),
        listProductionSchedules(),
        getProductionSupplyBoard(),
        getOperationalIntelligenceSummary(),
        listOccurrences(),
        listShiftHandovers(),
        listOpenShiftPendencies(),
        listPerformanceTargets(),
        listReportSnapshots(10),
        listRubricagemBatches(20),
        db.select({ total: count() }).from(labelScans),
        db.select({ total: count() }).from(auditEvents),
        db.select({ total: count() }).from(materialIntakeRequests),
      ]);

      const sanitized = sanitizePresentationBootstrapData({
        shifts: shiftsList,
        routes: routesList,
        receipts: receiptsList,
        movements: movementsList,
        transferOrders: transferOrdersList,
        schedules: schedulesList,
        occurrences: occurrencesList,
        handovers: handoversList,
        recentSnapshots: recentSnapshotsList,
        rubricagemBatches: rubricagemBatchesList,
      });

      const totalRealStockKg = silosList.reduce((acc, s) => acc + Number(s.confirmedStockKg || 0), 0);
      const totalNominalCapacityKg = silosList.reduce((acc, s) => acc + Number(s.nominalCapacityKg || 0), 0);
      const totalSafeCapacityKg = silosList.reduce((acc, s) => acc + Number(s.safeCapacityKg || 0), 0);

      res.json({
        generatedAtIso: new Date().toISOString(),
        dataSource: 'POSTGRESQL_READONLY_SYNC',
        activeShift,
        lines: linesList.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          category: l.category,
        })),
        materials: materialsList,
        suppliers: suppliersList,
        bagConfigs: bagConfigsList,
        silos: silosList,
        transferRules: transferRulesList,
        routes: sanitized.routes,
        pendencies: pendenciesList,
        helpArticles: helpArticlesList,
        scheduleTemplates: scheduleTemplatesList,
        shifts: sanitized.shifts,
        products: productsList,
        thresholds: thresholdsList,
        liveCounts: {
          silos: silosList.length,
          materials: materialsList.length,
          suppliers: suppliersList.length,
          bagConfigs: bagConfigsList.length,
          transferRules: transferRulesList.length,
          activeTransferRules: transferRulesList.filter((r) => r.isActive).length,
          pendenciesPending: pendenciesList.filter((p) => p.status === 'PENDENTE').length,
          helpArticles: helpArticlesList.length,
          receipts: receiptsList.length,
          movements: movementsList.length,
          transferOrders: transferOrdersList.length,
          schedules: schedulesList.length,
          occurrences: occurrencesList.length,
          handovers: handoversList.length,
          intakeRequests: Number(intakeReqCountRow?.total ?? 0),
          labelScans: Number(labelScanCountRow?.total ?? 0),
          auditEvents: Number(auditEventCountRow?.total ?? 0),
          totalRealStockKg,
          totalNominalCapacityKg,
          totalSafeCapacityKg,
        },
        liveSnapshot: {
          receipts: sanitized.receipts,
          movements: sanitized.movements,
          transferOrders: sanitized.transferOrders,
          schedules: sanitized.schedules,
          supplyBoard: supplyBoardData,
          intelligenceSummary: intelligenceData,
          occurrences: sanitized.occurrences,
          handovers: sanitized.handovers,
          openShiftPendencies: openShiftPendenciesList,
          performanceTargets: performanceTargetsList,
          recentSnapshots: sanitized.recentSnapshots,
        },
        rubricagemBatches: sanitized.rubricagemBatches ?? [],
      });
    } catch (error: any) {
      console.error('Error on GET /api/presentation/bootstrap:', error);
      res.status(500).json({ error: error.message || 'Erro ao sincronizar base oficial para apresentação.' });
    }
  });

  // Session & RBAC bootstrap
  app.get('/api/session', requireAuth, async (req: AuthRequest, res) => {
    const user = req.appUser!;
    const shift = await resolveActiveShiftFromDb().catch(() => resolveOperationalShift());
    res.json({
      user,
      permissions: ROLE_PERMISSIONS[user.roleCode] ?? [],
      shift,
    });
  });

  // Operational Dashboard (calculated strictly from PostgreSQL)
  app.get(
    '/api/dashboard',
    requireAuth,
    requirePermission('dashboard:view'),
    async (_req: AuthRequest, res) => {
      try {
        const [silosList, materialsList, pendenciesList, transferRules, linesList] =
          await Promise.all([
            listSilosWithDetails(),
            listMaterials(),
            listValidationPendencies(),
            listTransferRulesWithDetails(),
            listProductionLines(),
          ]);

        const totalSilos = silosList.length;
        const operationalSilos = silosList.filter(
          (s) => s.operationalStatus === 'OPERACIONAL'
        ).length;
        const blockedOrMaintenance = silosList.filter(
          (s) => s.operationalStatus !== 'OPERACIONAL'
        ).length;
        const occupiedSilos = silosList.filter((s) => s.confirmedStockKg > 0).length;
        const availableSilos = silosList.filter(
          (s) => s.operationalStatus === 'OPERACIONAL' && s.availableSpaceKg > 0
        ).length;
        const nearCapacitySilos = silosList.filter((s) => s.occupancyPercent >= 85).length;

        const totalConfirmedStockKg = silosList.reduce(
          (acc, s) => acc + s.confirmedStockKg,
          0
        );
        const totalNominalCapacityKg = silosList.reduce(
          (acc, s) => acc + s.nominalCapacityKg,
          0
        );
        const totalSafeCapacityKg = silosList.reduce((acc, s) => acc + s.safeCapacityKg, 0);

        const pendingValidationsCount = pendenciesList.filter(
          (p) => p.status === 'PENDENTE'
        ).length;
        const pendingSilosCount = silosList.filter(
          (s) => s.validationStatus === 'PENDENTE_VALIDACAO'
        ).length;

        const byCategory = {
          LINHA: silosList.filter((s) => s.category === 'LINHA').length,
          ARMAZENAGEM: silosList.filter((s) => s.category === 'ARMAZENAGEM').length,
          PRODUCAO: silosList.filter((s) => s.category === 'PRODUCAO').length,
        };

        const byLine = linesList.map((line) => {
          const lineSilos = silosList.filter((s) => s.productionLineId === line.id);
          return {
            code: line.code,
            name: line.name,
            category: line.category,
            siloCount: lineSilos.length,
            nominalCapacityKg: lineSilos.reduce((acc, s) => acc + s.nominalCapacityKg, 0),
            safeCapacityKg: lineSilos.reduce((acc, s) => acc + s.safeCapacityKg, 0),
            confirmedStockKg: lineSilos.reduce((acc, s) => acc + s.confirmedStockKg, 0),
            pendingValidationCount: lineSilos.filter(
              (s) => s.validationStatus === 'PENDENTE_VALIDACAO'
            ).length,
          };
        });

        res.json({
          shift: await resolveActiveShiftFromDb().catch(() => resolveOperationalShift()),
          lastUpdated: new Date().toISOString(),
          kpis: {
            totalSilos,
            operationalSilos,
            blockedOrMaintenance,
            occupiedSilos,
            availableSilos,
            nearCapacitySilos,
            totalConfirmedStockKg,
            totalNominalCapacityKg,
            totalSafeCapacityKg,
            totalMaterials: materialsList.length,
            activeTransferRules: transferRules.filter((r) => r.isActive).length,
            pendingTransferRules: transferRules.filter(
              (r) => r.validationStatus === 'PENDENTE_VALIDACAO'
            ).length,
            pendingValidationsCount,
            pendingSilosCount,
          },
          byCategory,
          byLine,
          pendenciesPreview: pendenciesList.filter((p) => p.status === 'PENDENTE').slice(0, 5),
        });
      } catch (error: any) {
        console.error('Error on GET /api/dashboard:', error);
        res.status(500).json({ error: error.message || 'Erro ao carregar painel operacional.' });
      }
    }
  );

  // Silos (ordered strictly by rubricOrder)
  app.get('/api/silos', requireAuth, requirePermission('silos:view'), async (_req, res) => {
    try {
      const data = await listSilosWithDetails();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar silos.' });
    }
  });

  app.get(
    '/api/silos/volume-history-24h',
    requireAuth,
    requirePermission('silos:view'),
    async (req, res) => {
      try {
        const siloIdRaw = req.query.siloId ? Number(req.query.siloId) : null;
        const materialIdRaw = req.query.materialId ? Number(req.query.materialId) : null;
        const category = req.query.category ? String(req.query.category) : 'ALL';
        const data = await getSiloVolumeHistory24h({
          siloId: siloIdRaw && Number.isInteger(siloIdRaw) && siloIdRaw > 0 ? siloIdRaw : null,
          materialId:
            materialIdRaw && Number.isInteger(materialIdRaw) && materialIdRaw > 0
              ? materialIdRaw
              : null,
          category,
        });
        res.json(data);
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Erro ao consultar histórico de volume de 24 horas.',
        });
      }
    }
  );

  // =========================================================================
  // RUBRICAGEM DIÁRIA EM FOLHA ÚNICA (MOEGA CONTÍNUA x PRODUÇÃO FÍSICA)
  // =========================================================================
  app.post(
    '/api/rubricagem/interpret-photo',
    requireAuth,
    requirePermission('rubricagem:capture'),
    async (req: AuthRequest, res) => {
      try {
        const { imageBase64, mimeType } = req.body || {};
        const imgCheck = validateImageUploadPayload({
          base64: String(imageBase64 || ''),
          mimeType: mimeType || 'image/jpeg',
        });
        if (imgCheck.valid === false) {
          return res.status(400).json({ error: imgCheck.error });
        }

        const allSilos = await listSilosWithDetails();
        const silosHint = allSilos
          .map(
            (s) =>
              `Silo ${s.siloNumber} (${s.controlOwner === 'PRODUCAO' ? 'PRODUCAO' : 'MOEGA'}, Linha ${s.lineCode}, Material: ${s.materialCode || 'SEM MATERIAL'})`
          )
          .join('\n');

        const extraction = await interpretRubricagemSheetWithGemini({
          imageBase64: String(imageBase64),
          mimeType: imgCheck.normalizedMime,
          silosHint,
        });

        const siloByNum = new Map(allSilos.map((s) => [s.siloNumber, s]));
        const enrichedEntries = extraction.entries.map((row) => {
          const s = siloByNum.get(Number(row.siloNumber)) ?? null;
          const unit = row.unit === 'kg' ? 'kg' : 't';
          return {
            ...row,
            unit,
            siloId: s?.id ?? null,
            controlOwner: s ? (s.controlOwner === 'PRODUCAO' ? 'PRODUCAO' : 'MOEGA') : null,
            stockControlModel: s ? resolveStockControlModel(s.controlOwner) : null,
            lineCode: s?.lineCode ?? null,
            category: s?.category ?? null,
            materialCode: s?.materialCode ?? null,
            materialDescription: s?.materialDescription ?? null,
            countedQuantityKg: convertQuantityToKg(Number(row.quantityValue), unit),
            currentReferenceKg: s?.confirmedStockKg ?? 0,
            ledgerStockKg: s?.ledgerStockKg ?? s?.confirmedStockKg ?? 0,
            lastPhysicalCountKg: s?.lastPhysicalCountKg ?? null,
            lastPhysicalCountAt: s?.lastPhysicalCountAt ?? null,
          };
        });

        res.json({
          documentDateHint: extraction.documentDateHint,
          unreadableNotes: extraction.unreadableNotes,
          usedAiModel: 'gemini-4-hydrogen',
          entries: enrichedEntries,
        });
      } catch (error: any) {
        console.error('Error in POST /api/rubricagem/interpret-photo:', error);
        res.status(502).json({
          error:
            error.message ||
            'Falha ao interpretar fotografia da folha de rubricagem com Gemini Vision.',
        });
      }
    }
  );

  app.get(
    '/api/rubricagem/batches',
    requireAuth,
    requirePermission('silos:view'),
    async (req, res) => {
      try {
        const limitRaw = req.query.limit ? Number(req.query.limit) : 30;
        const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 30;
        res.json(await listRubricagemBatches(limit));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao listar lotes de rubricagem.' });
      }
    }
  );

  app.post(
    '/api/rubricagem/batches',
    requireAuth,
    requirePermission('rubricagem:capture'),
    async (req: AuthRequest, res) => {
      try {
        const body = req.body || {};
        if (body.sourceImageDataUrl) {
          const imgCheck = validateImageUploadPayload({
            base64: String(body.sourceImageDataUrl),
            mimeType: body.mimeType || 'image/jpeg',
          });
          if (imgCheck.valid === false) {
            return res.status(400).json({ error: imgCheck.error });
          }
        }

        const created = await createRubricagemBatchTransactional(
          {
            referenceDate: typeof body.referenceDate === 'string' ? body.referenceDate : undefined,
            capturedAtIso: typeof body.capturedAtIso === 'string' ? body.capturedAtIso : undefined,
            sourceType: body.sourceType,
            fileName: typeof body.fileName === 'string' ? body.fileName : null,
            mimeType: typeof body.mimeType === 'string' ? body.mimeType : null,
            sourceImageDataUrl:
              typeof body.sourceImageDataUrl === 'string' ? body.sourceImageDataUrl : null,
            notes: typeof body.notes === 'string' ? body.notes : null,
            entries: Array.isArray(body.entries) ? body.entries : [],
          },
          req.appUser!
        );

        broadcastNexoEvent({ type: 'rubricagem:updated', batchId: created.id });
        res.status(201).json(created);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao registrar rubricagem.' });
      }
    }
  );

  app.post(
    '/api/rubricagem/batches/:id/authorize',
    requireAuth,
    requirePermission('rubricagem:authorize'),
    async (req: AuthRequest, res) => {
      try {
        const batchId = Number(req.params.id);
        if (!Number.isInteger(batchId) || batchId <= 0) {
          return res.status(400).json({ error: 'Identificador de lote de rubricagem inválido.' });
        }
        const body = req.body || {};
        const authorized = await authorizeRubricagemBatchTransactional(
          {
            batchId,
            authorizationReason: String(body.authorizationReason || ''),
            reconcileMoegaSiloIds: Array.isArray(body.reconcileMoegaSiloIds)
              ? body.reconcileMoegaSiloIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
              : [],
          },
          req.appUser!
        );

        broadcastNexoEvent({ type: 'rubricagem:updated', batchId: authorized.id });
        res.json(authorized);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao autorizar rubricagem.' });
      }
    }
  );

  app.patch(
    '/api/silos/:id',
    requireAuth,
    requirePermission('silos:manage'),
    async (req: AuthRequest, res) => {
      try {
        const siloId = Number(req.params.id);
        if (!Number.isInteger(siloId) || siloId <= 0) {
          return res.status(400).json({ error: 'Identificador de silo inválido.' });
        }
        const {
          operationalStatus,
          cleaningStatus,
          nominalCapacityKg,
          safetyFactorPercent,
          primaryMaterialId,
          restrictions,
          validationStatus,
          validationNotes,
          reason,
        } = req.body;

        if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
          return res
            .status(400)
            .json({ error: 'Informe um motivo operacional válido para alteração do silo.' });
        }

        const updated = await updateSiloConfig(
          siloId,
          {
            operationalStatus,
            cleaningStatus,
            nominalCapacityKg:
              nominalCapacityKg !== undefined ? Number(nominalCapacityKg) : undefined,
            safetyFactorPercent:
              safetyFactorPercent !== undefined ? Number(safetyFactorPercent) : undefined,
            primaryMaterialId,
            restrictions,
            validationStatus,
            validationNotes,
          },
          req.appUser!,
          reason.trim()
        );
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao atualizar silo.' });
      }
    }
  );

  app.post(
    '/api/silos/:id/compatibility',
    requireAuth,
    requirePermission('compatibility:manage'),
    async (req: AuthRequest, res) => {
      try {
        const siloId = Number(req.params.id);
        const { materialId, allowReceiving, allowTransferIn, allowTransferOut, restrictions } =
          req.body;
        if (!siloId || !materialId) {
          return res.status(400).json({ error: 'Silo e matéria-prima são obrigatórios.' });
        }
        const created = await addSiloCompatibility(
          siloId,
          Number(materialId),
          {
            allowReceiving: Boolean(allowReceiving),
            allowTransferIn: Boolean(allowTransferIn),
            allowTransferOut: Boolean(allowTransferOut),
            restrictions,
          },
          req.appUser!
        );
        res.json(created);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao salvar compatibilidade.' });
      }
    }
  );

  // Materials
  app.get(
    '/api/materials',
    requireAuth,
    requirePermission('materials:view'),
    async (_req, res) => {
      try {
        const data = await listMaterials();
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao listar matérias-primas.' });
      }
    }
  );

  app.post(
    '/api/materials',
    requireAuth,
    requirePermission('materials:manage'),
    async (req: AuthRequest, res) => {
      try {
        const {
          code,
          description,
          category,
          handlingType,
          referenceBagWeightKg,
          bagWeightValidationStatus,
          isCritical,
          notes,
        } = req.body;
        if (!code || !description || !category || !handlingType) {
          return res.status(400).json({
            error: 'Código, descrição, categoria e tipo de manuseio são obrigatórios.',
          });
        }
        const created = await createMaterial(
          {
            code,
            description,
            category,
            handlingType,
            referenceBagWeightKg: referenceBagWeightKg ? String(referenceBagWeightKg) : null,
            bagWeightValidationStatus,
            isCritical,
            notes,
          },
          req.appUser!
        );
        res.status(201).json(created);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao criar matéria-prima.' });
      }
    }
  );

  app.patch(
    '/api/materials/:id',
    requireAuth,
    requirePermission('materials:manage'),
    async (req: AuthRequest, res) => {
      try {
        const materialId = Number(req.params.id);
        const { reason, ...updates } = req.body;
        const updated = await updateMaterial(
          materialId,
          updates,
          req.appUser!,
          reason || 'Atualização cadastral'
        );
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao atualizar matéria-prima.' });
      }
    }
  );

  // Transfer Rules Matrix
  app.get(
    '/api/transfer-rules',
    requireAuth,
    requirePermission('silos:view'),
    async (_req, res) => {
      try {
        const data = await listTransferRulesWithDetails();
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao listar matriz de transferências.' });
      }
    }
  );

  app.patch(
    '/api/transfer-rules/:id',
    requireAuth,
    requirePermission('compatibility:manage'),
    async (req: AuthRequest, res) => {
      try {
        const ruleId = Number(req.params.id);
        const { isActive, validationStatus, restrictions, reason } = req.body;
        const updated = await updateTransferRule(
          ruleId,
          { isActive, validationStatus, restrictions },
          req.appUser!,
          reason || 'Alteração de regra na matriz de transferências'
        );
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao atualizar regra de transferência.' });
      }
    }
  );

  // Suppliers & Lines
  app.get('/api/suppliers', requireAuth, requirePermission('materials:view'), async (_req, res) => {
    try {
      res.json(await listSuppliers());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar fornecedores.' });
    }
  });

  app.get('/api/lines', requireAuth, requirePermission('silos:view'), async (_req, res) => {
    try {
      res.json(await listProductionLines());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar linhas.' });
    }
  });

  // Validation Pendencies
  app.get('/api/pendencies', requireAuth, requirePermission('silos:view'), async (_req, res) => {
    try {
      res.json(await listValidationPendencies());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar pendências.' });
    }
  });

  app.post(
    '/api/pendencies/:id/resolve',
    requireAuth,
    requirePermission('pendencies:resolve'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        const { resolutionNotes } = req.body;
        if (!resolutionNotes || String(resolutionNotes).trim().length < 5) {
          return res
            .status(400)
            .json({ error: 'Descreva a decisão/evidência oficial de validação.' });
        }
        const resolved = await resolveValidationPendency(
          id,
          String(resolutionNotes).trim(),
          req.appUser!
        );
        res.json(resolved);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao validar pendência.' });
      }
    }
  );

  // Admin: Users & Audit
  app.get('/api/users', requireAuth, requirePermission('users:manage'), async (_req, res) => {
    try {
      res.json(await listUsersWithRoles());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar usuários.' });
    }
  });

  app.patch(
    '/api/users/:id',
    requireAuth,
    requirePermission('users:manage'),
    async (req: AuthRequest, res) => {
      try {
        const targetId = Number(req.params.id);
        const {
          roleCode,
          isActive,
          defaultShiftCode,
          badgeCode,
          displayName,
          jobTitle,
          department,
          reason,
        } = req.body;
        const updated = await updateUserAccount(
          targetId,
          { roleCode, isActive, defaultShiftCode, badgeCode, displayName, jobTitle, department },
          req.appUser!,
          reason || 'Alteração administrativa'
        );
        res.json(updated);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao atualizar usuário.' });
      }
    }
  );

  app.get('/api/audit', requireAuth, requirePermission('audit:view'), async (_req, res) => {
    try {
      res.json(await listAuditEvents(150));
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao consultar auditoria.' });
    }
  });

  // Help Manual
  app.get('/api/help', requireAuth, requirePermission('help:view'), async (_req, res) => {
    try {
      res.json(await listHelpArticles());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao carregar guia operacional.' });
    }
  });

  // =========================================================================
  // FASE 2 — ESTOQUE, RECEBIMENTO, ETIQUETAS, RATEIO E TRANSFERÊNCIAS
  // =========================================================================

  // Big Bag packaging configurations
  app.get('/api/bag-configs', requireAuth, requirePermission('materials:view'), async (_req, res) => {
    try {
      res.json(await listMaterialBagConfigs());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao carregar pesos de Big Bags.' });
    }
  });

  app.post(
    '/api/bag-configs',
    requireAuth,
    requirePermission('materials:manage'),
    async (req: AuthRequest, res) => {
      try {
        const { id, materialId, packagingLabel, unitWeightKg, validationStatus, isDefault, notes, reason } =
          req.body;
        if (!materialId || !packagingLabel || !unitWeightKg) {
          return res.status(400).json({
            error: 'Matéria-prima, identificação da embalagem e peso unitário são obrigatórios.',
          });
        }
        const saved = await upsertMaterialBagConfig(
          {
            id: id ? Number(id) : undefined,
            materialId: Number(materialId),
            packagingLabel: String(packagingLabel),
            unitWeightKg: Number(unitWeightKg),
            validationStatus,
            isDefault,
            notes,
          },
          req.appUser!,
          reason || 'Configuração de peso de Big Bag'
        );
        res.json(saved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao salvar configuração de bag.' });
      }
    }
  );

  // Lot history check (duplicate / complement check)
  app.get(
    '/api/lots/:lotCode/history',
    requireAuth,
    requirePermission('receipts:view'),
    async (req, res) => {
      try {
        const lotCode = String(req.params.lotCode || '');
        const materialId = req.query.materialId ? Number(req.query.materialId) : undefined;
        res.json(await checkLotHistory(lotCode, materialId));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao consultar histórico do lote.' });
      }
    }
  );

  // Compatible silos for a given material
  app.get(
    '/api/materials/:id/compatible-silos',
    requireAuth,
    requirePermission('silos:view'),
    async (req, res) => {
      try {
        const materialId = Number(req.params.id);
        if (!Number.isInteger(materialId) || materialId <= 0) {
          return res.status(400).json({ error: 'Matéria-prima inválida.' });
        }
        res.json(await getCompatibleSilosForMaterial(materialId));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao buscar silos compatíveis.' });
      }
    }
  );

  // Silo active lots + ledger history
  app.get('/api/silos/:id/ledger', requireAuth, requirePermission('silos:view'), async (req, res) => {
    try {
      const siloId = Number(req.params.id);
      if (!Number.isInteger(siloId) || siloId <= 0) {
        return res.status(400).json({ error: 'Silo inválido.' });
      }
      res.json(await getSiloLedgerDetails(siloId));
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao carregar histórico do silo.' });
    }
  });

  // Receipts & Distributions
  app.get('/api/receipts', requireAuth, requirePermission('receipts:view'), async (_req, res) => {
    try {
      res.json(await listReceiptsWithDetails());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar recebimentos.' });
    }
  });

  app.post(
    '/api/receipts',
    requireAuth,
    requirePermission('receipts:execute'),
    async (req: AuthRequest, res) => {
      try {
        const result = await createReceiptTransactional(req.body, req.appUser!);
        res.status(201).json(result);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({
          error: error.message || 'Erro ao registrar recebimento.',
          details: error instanceof OperationalConflictError ? error.details : undefined,
        });
      }
    }
  );

  app.post(
    '/api/receipts/:id/distribute',
    requireAuth,
    requirePermission('receipts:execute'),
    async (req: AuthRequest, res) => {
      try {
        const receiptId = Number(req.params.id);
        if (!Number.isInteger(receiptId) || receiptId <= 0) {
          return res.status(400).json({ error: 'Recebimento inválido.' });
        }
        const result = await distributeReceiptTransactional(
          {
            receiptId,
            expectedVersion:
              req.body.expectedVersion !== undefined ? Number(req.body.expectedVersion) : undefined,
            distributions: req.body.distributions || [],
            isComplement: Boolean(req.body.isComplement),
            notes: req.body.notes,
            executedByName: req.body.executedByName,
            executedByBadge: req.body.executedByBadge,
            attachments: req.body.attachments,
            idempotencyKey: req.body.idempotencyKey,
          },
          req.appUser!
        );
        res.json(result);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({
          error: error.message || 'Erro ao distribuir recebimento.',
          details: error instanceof OperationalConflictError ? error.details : undefined,
        });
      }
    }
  );

  // Atomic Silo-to-Silo Transfer
  app.post(
    '/api/transfers/execute',
    requireAuth,
    requirePermission('transfers:execute'),
    async (req: AuthRequest, res) => {
      try {
        const {
          originSiloId,
          destinationSiloId,
          materialId,
          quantityKg,
          lotCode,
          reason,
          executedByName,
          executedByBadge,
          idempotencyKey,
        } = req.body;
        const result = await executeTransferTransactional(
          {
            originSiloId: Number(originSiloId),
            destinationSiloId: Number(destinationSiloId),
            materialId: Number(materialId),
            quantityKg: Number(quantityKg),
            lotCode,
            reason,
            executedByName,
            executedByBadge,
            idempotencyKey,
          },
          req.appUser!
        );
        res.status(201).json(result);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao executar transferência.' });
      }
    }
  );

  // Inventory Movements Ledger, Reversals & Authorized Adjustments
  app.get('/api/movements', requireAuth, requirePermission('reports:view'), async (req, res) => {
    try {
      const data = await listInventoryMovementsReport({
        siloId: req.query.siloId ? Number(req.query.siloId) : undefined,
        materialId: req.query.materialId ? Number(req.query.materialId) : undefined,
        shiftCode: req.query.shiftCode ? String(req.query.shiftCode) : undefined,
        lotCode: req.query.lotCode ? String(req.query.lotCode) : undefined,
      });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao carregar movimentações.' });
    }
  });

  app.post(
    '/api/movements/:id/reverse',
    requireAuth,
    requirePermission('stock:adjust'),
    async (req: AuthRequest, res) => {
      try {
        const movementId = Number(req.params.id);
        const { reason } = req.body;
        const reversal = await reverseMovementTransactional(movementId, String(reason || ''), req.appUser!);
        res.status(201).json(reversal);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao estornar movimentação.' });
      }
    }
  );

  app.post(
    '/api/stock/adjust',
    requireAuth,
    requirePermission('stock:adjust'),
    async (req: AuthRequest, res) => {
      try {
        const { siloId, materialId, lotCode, deltaKg, reason, executedByName, executedByBadge } =
          req.body;
        const mov = await adjustSiloStockTransactional(
          {
            siloId: Number(siloId),
            materialId: Number(materialId),
            lotCode,
            deltaKg: Number(deltaKg),
            reason: String(reason || ''),
            executedByName,
            executedByBadge,
          },
          req.appUser!
        );
        res.status(201).json(mov);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao executar ajuste autorizado.' });
      }
    }
  );

  // Label Scanning: 1) Deterministic Barcode Parsing & Catalog Lookup
  app.post(
    '/api/labels/parse-barcode',
    requireAuth,
    requirePermission('receipts:execute'),
    async (req: AuthRequest, res) => {
      try {
        const { rawBarcode, scanMethod } = req.body;
        if (!rawBarcode || typeof rawBarcode !== 'string') {
          return res.status(400).json({ error: 'Código de barras não informado.' });
        }
        const result = await recordBarcodeLookupAndAudit(
          rawBarcode,
          scanMethod || 'BARCODE_CAMERA',
          req.appUser!
        );
        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao interpretar código de barras.' });
      }
    }
  );

  // Label Scanning: 2) Gemini Vision Photo Interpretation (server-side only, advisory)
  app.post(
    '/api/labels/interpret-photo',
    requireAuth,
    requirePermission('receipts:execute'),
    async (req: AuthRequest, res) => {
      try {
        const { imageBase64, mimeType } = req.body;
        const imgCheck = validateImageUploadPayload({
          base64: String(imageBase64 || ''),
          mimeType: mimeType || 'image/jpeg',
        });
        if (imgCheck.valid === false) {
          return res.status(400).json({ error: imgCheck.error });
        }

        const allMaterials = await listMaterials();
        const catalogHint = allMaterials
          .map((m) => `${m.code} — ${m.description}`)
          .slice(0, 35)
          .join('\n');

        const extraction = await interpretLabelImageWithGemini({
          imageBase64,
          mimeType: imgCheck.normalizedMime,
          catalogHint,
        });

        const persisted = await saveGeminiLabelScanAudit(
          {
            extraction,
            sourceImageDataUrl: capLabelPreviewDataUrl(imageBase64, imgCheck.normalizedMime),
            sourceMimeType: imgCheck.normalizedMime,
          },
          req.appUser!
        );
        res.json(persisted);
      } catch (error: any) {
        console.error('Error in /api/labels/interpret-photo:', error);
        res.status(502).json({
          error:
            error.message ||
            'Falha ao interpretar fotografia da etiqueta com Gemini Vision.',
        });
      }
    }
  );

  // Gemini Operational Advice (advisory only from deterministic DB facts)
  app.post(
    '/api/ai/operational-advice',
    requireAuth,
    requirePermission('receipts:view'),
    async (req, res) => {
      try {
        const { situationTitle, deterministicFacts } = req.body;
        if (!situationTitle || !deterministicFacts) {
          return res.status(400).json({ error: 'Contexto operacional incompleto.' });
        }
        const advice = await generateOperationalAdviceWithGemini({
          situationTitle: String(situationTitle),
          deterministicFacts,
        });
        res.json(advice);
      } catch (error: any) {
        res.status(502).json({
          error: error.message || 'Não foi possível gerar análise consultiva no momento.',
        });
      }
    }
  );

  // =========================================================================
  // FASE 3 — PROGRAMAÇÃO DA PRODUÇÃO, DOCUMENTOS, CONSUMO E INTELIGÊNCIA
  // =========================================================================

  app.get(
    '/api/schedule-templates',
    requireAuth,
    requirePermission('schedules:view'),
    async (_req, res) => {
      try {
        res.json(await listScheduleTemplates());
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar modelos documentais.' });
      }
    }
  );

  app.get('/api/products', requireAuth, requirePermission('schedules:view'), async (_req, res) => {
    try {
      res.json(await listProductsWithFactors());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar produtos e fatores.' });
    }
  });

  app.post(
    '/api/products',
    requireAuth,
    requirePermission('consumption:manage'),
    async (req: AuthRequest, res) => {
      try {
        const saved = await upsertProduct(req.body, req.appUser!);
        res.status(201).json(saved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao salvar produto.' });
      }
    }
  );

  app.post(
    '/api/consumption-factors',
    requireAuth,
    requirePermission('consumption:manage'),
    async (req: AuthRequest, res) => {
      try {
        const saved = await upsertConsumptionFactor(
          {
            productId: Number(req.body.productId),
            materialId: Number(req.body.materialId),
            factorKgPerUnit: Number(req.body.factorKgPerUnit),
            unit: String(req.body.unit || 't'),
            validationStatus: req.body.validationStatus || 'VALIDADO',
            sourceReference: req.body.sourceReference,
            notes: req.body.notes,
            reason: req.body.reason,
          },
          req.appUser!
        );
        res.status(201).json(saved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao salvar fator de consumo.' });
      }
    }
  );

  app.get(
    '/api/stock-thresholds',
    requireAuth,
    requirePermission('schedules:view'),
    async (_req, res) => {
      try {
        res.json(await listStockThresholds());
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar limites de estoque.' });
      }
    }
  );

  app.post(
    '/api/stock-thresholds',
    requireAuth,
    requirePermission('consumption:manage'),
    async (req: AuthRequest, res) => {
      try {
        const saved = await upsertStockThreshold(
          {
            materialId: Number(req.body.materialId),
            siloId: req.body.siloId ? Number(req.body.siloId) : null,
            minStockKg: Number(req.body.minStockKg),
            warningStockKg: Number(req.body.warningStockKg),
            notes: req.body.notes,
          },
          req.appUser!
        );
        res.status(201).json(saved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao salvar limite mínimo.' });
      }
    }
  );

  app.post(
    '/api/schedules/parse-document',
    requireAuth,
    requirePermission('schedules:import'),
    async (req: AuthRequest, res) => {
      try {
        const result = await parseAndStoreScheduleDocument(req.body, req.appUser!);
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/schedules/parse-document:', error);
        const status = error instanceof OperationalConflictError ? error.statusCode : 502;
        res.status(status).json({
          error: error.message || 'Falha ao interpretar documento da programação.',
        });
      }
    }
  );

  app.get('/api/schedules', requireAuth, requirePermission('schedules:view'), async (req, res) => {
    try {
      const referenceDate = req.query.referenceDate ? String(req.query.referenceDate) : undefined;
      res.json(await listProductionSchedules({ referenceDate }));
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar programações.' });
    }
  });

  app.get(
    '/api/schedule-documents/:id',
    requireAuth,
    requirePermission('schedules:view'),
    async (req, res) => {
      try {
        const docId = Number(req.params.id);
        if (!Number.isInteger(docId) || docId <= 0) {
          return res.status(400).json({ error: 'Documento inválido.' });
        }
        res.json(await getScheduleDocumentById(docId));
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao carregar documento.' });
      }
    }
  );

  app.post(
    '/api/schedules/draft',
    requireAuth,
    requirePermission('schedules:import'),
    async (req: AuthRequest, res) => {
      try {
        const draft = await saveScheduleDraft(req.body, req.appUser!);
        res.status(201).json(draft);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao salvar rascunho de programação.' });
      }
    }
  );

  app.post(
    '/api/schedules/:id/approve',
    requireAuth,
    requirePermission('schedules:approve'),
    async (req: AuthRequest, res) => {
      try {
        const scheduleId = Number(req.params.id);
        if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
          return res.status(400).json({ error: 'Programação inválida.' });
        }
        const result = await approveScheduleTransactional(
          scheduleId,
          req.appUser!,
          req.body?.approvalNotes
        );
        res.json(result);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao aprovar programação.' });
      }
    }
  );

  app.patch(
    '/api/schedule-items/:id/execution',
    requireAuth,
    requirePermission('schedules:execution_update'),
    async (req: AuthRequest, res) => {
      try {
        const itemId = Number(req.params.id);
        if (!Number.isInteger(itemId) || itemId <= 0) {
          return res.status(400).json({ error: 'Item de programação inválido.' });
        }
        const updated = await updateScheduleItemExecution(
          {
            scheduleItemId: itemId,
            executionStatus: req.body.executionStatus,
            realizedQuantity:
              req.body.realizedQuantity !== undefined
                ? Number(req.body.realizedQuantity)
                : undefined,
            notes: req.body.notes,
            reason: String(req.body.reason || ''),
          },
          req.appUser!
        );
        res.json(updated);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao atualizar execução da linha.' });
      }
    }
  );

  app.get(
    '/api/intelligence/summary',
    requireAuth,
    requirePermission('schedules:view'),
    async (req, res) => {
      try {
        const summary = await getOperationalIntelligenceSummary({
          todayDate: req.query.todayDate ? String(req.query.todayDate) : undefined,
          lineCode: req.query.lineCode ? String(req.query.lineCode) : undefined,
          materialId: req.query.materialId ? Number(req.query.materialId) : undefined,
          siloId: req.query.siloId ? Number(req.query.siloId) : undefined,
          priority: req.query.priority ? (String(req.query.priority) as any) : undefined,
          executionStatus: req.query.executionStatus
            ? (String(req.query.executionStatus) as any)
            : undefined,
        });
        res.json(summary);
      } catch (error: any) {
        console.error('Error in /api/intelligence/summary:', error);
        res.status(500).json({ error: error.message || 'Erro ao calcular inteligência de estoque.' });
      }
    }
  );

  app.post(
    '/api/intelligence/recommendations/:id/decision',
    requireAuth,
    requirePermission('schedules:import'),
    async (req: AuthRequest, res) => {
      try {
        const recId = Number(req.params.id);
        const { decision, decisionNotes } = req.body;
        if (!['ACEITA', 'REJEITADA'].includes(String(decision))) {
          return res.status(400).json({ error: 'Decisão inválida (use ACEITA ou REJEITADA).' });
        }
        const saved = await decideOperationalRecommendation(
          {
            recommendationId: recId,
            decision,
            decisionNotes,
          },
          req.appUser!
        );
        res.json(saved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao registrar decisão.' });
      }
    }
  );

  // =========================================================================
  // FASE 4 — ROTAS AUTORIZADAS, ORDENS DE TRANSFERÊNCIA E ABASTECIMENTO
  // =========================================================================

  app.get('/api/routes', requireAuth, requirePermission('silos:view'), async (_req, res) => {
    try {
      res.json(await listAuthorizedRoutesWithHistory());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar rotas autorizadas.' });
    }
  });

  app.post(
    '/api/routes',
    requireAuth,
    requirePermission('routes:manage'),
    async (req: AuthRequest, res) => {
      try {
        const created = await createAuthorizedRoute(
          {
            originSiloId: Number(req.body.originSiloId),
            destinationSiloId: Number(req.body.destinationSiloId),
            materialId: Number(req.body.materialId),
            maxQuantityKg:
              req.body.maxQuantityKg !== undefined && req.body.maxQuantityKg !== null && req.body.maxQuantityKg !== ''
                ? Number(req.body.maxQuantityKg)
                : null,
            authorizationStatus: req.body.authorizationStatus,
            restrictions: req.body.restrictions,
            sourceReference: req.body.sourceReference,
            reason: String(req.body.reason || ''),
          },
          req.appUser!
        );
        res.status(201).json(created);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao cadastrar rota.' });
      }
    }
  );

  app.patch(
    '/api/routes/:id/status',
    requireAuth,
    requirePermission('routes:manage'),
    async (req: AuthRequest, res) => {
      try {
        const ruleId = Number(req.params.id);
        if (!Number.isInteger(ruleId) || ruleId <= 0) {
          return res.status(400).json({ error: 'Rota inválida.' });
        }
        const updated = await updateAuthorizedRouteStatus(
          ruleId,
          {
            authorizationStatus: req.body.authorizationStatus,
            maxQuantityKg:
              req.body.maxQuantityKg !== undefined
                ? req.body.maxQuantityKg === null || req.body.maxQuantityKg === ''
                  ? null
                  : Number(req.body.maxQuantityKg)
                : undefined,
            restrictions: req.body.restrictions,
            reason: String(req.body.reason || ''),
          },
          req.appUser!
        );
        res.json(updated);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao atualizar status da rota.' });
      }
    }
  );

  app.get(
    '/api/supply/board',
    requireAuth,
    requirePermission('supply:view'),
    async (req, res) => {
      try {
        const todayDate = req.query.todayDate ? String(req.query.todayDate) : undefined;
        res.json(await getProductionSupplyBoard(todayDate));
      } catch (error: any) {
        console.error('Error in GET /api/supply/board:', error);
        res.status(500).json({ error: error.message || 'Erro ao calcular painel de abastecimento.' });
      }
    }
  );

  app.get(
    '/api/supply/priority-config',
    requireAuth,
    requirePermission('supply:view'),
    async (_req, res) => {
      try {
        res.json(await getPriorityConfig());
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar pesos de priorização.' });
      }
    }
  );

  app.put(
    '/api/supply/priority-config',
    requireAuth,
    requirePermission('priority:manage'),
    async (req: AuthRequest, res) => {
      try {
        const saved = await updatePriorityConfig(
          {
            weightLineStopRisk: Number(req.body.weightLineStopRisk),
            weightStockCoverage: Number(req.body.weightStockCoverage),
            weightAuthorizedRoute: Number(req.body.weightAuthorizedRoute),
            weightOriginAvailability: Number(req.body.weightOriginAvailability),
            weightScheduleUrgency: Number(req.body.weightScheduleUrgency),
          },
          req.appUser!,
          String(req.body.reason || 'Ajuste de critérios de priorização')
        );
        res.json(saved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao atualizar priorização.' });
      }
    }
  );

  app.get(
    '/api/supply/intake-requests',
    requireAuth,
    requirePermission('supply:view'),
    async (_req, res) => {
      try {
        res.json(await listMaterialIntakeRequests());
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao listar solicitações de recebimento.' });
      }
    }
  );

  app.post(
    '/api/supply/intake-requests',
    requireAuth,
    requirePermission('transfers:plan'),
    async (req: AuthRequest, res) => {
      try {
        const created = await createMaterialIntakeRequestTransactional(
          {
            materialId: Number(req.body.materialId),
            productionLineId: req.body.productionLineId ? Number(req.body.productionLineId) : null,
            lineCode: req.body.lineCode,
            targetSiloId: req.body.targetSiloId ? Number(req.body.targetSiloId) : null,
            recommendationId: req.body.recommendationId ? Number(req.body.recommendationId) : null,
            recommendationKey: req.body.recommendationKey,
            neededQuantityKg: Number(req.body.neededQuantityKg),
            neededByDate: req.body.neededByDate,
            priority: req.body.priority,
            justification: String(req.body.justification || ''),
          },
          req.appUser!
        );
        res.status(201).json(created);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao registrar solicitação de recebimento.' });
      }
    }
  );

  app.post(
    '/api/supply/recommendations/:id/decision',
    requireAuth,
    requirePermission('transfers:plan'),
    async (req: AuthRequest, res) => {
      try {
        const recId = Number(req.params.id);
        if (!Number.isInteger(recId) || recId <= 0) {
          return res.status(400).json({ error: 'Recomendação inválida.' });
        }
        const decision = String(req.body.decision || '');
        if (!['PENDENTE', 'EM_ANALISE', 'ACEITA', 'REJEITADA'].includes(decision)) {
          return res.status(400).json({ error: 'Decisão inválida.' });
        }
        const updated = await updateSupplyRecommendationDecision(
          {
            recommendationId: recId,
            decision: decision as any,
            decisionNotes: req.body.decisionNotes,
          },
          req.appUser!
        );
        res.json(updated);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao atualizar recomendação.' });
      }
    }
  );

  app.get('/api/transfer-orders', requireAuth, requirePermission('silos:view'), async (_req, res) => {
    try {
      res.json(await listTransferOrdersWithSteps());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar ordens de transferência.' });
    }
  });

  app.post(
    '/api/transfer-orders',
    requireAuth,
    requirePermission('transfers:plan'),
    async (req: AuthRequest, res) => {
      try {
        const created = await createTransferOrderTransactional(
          {
            transferRuleId: req.body.transferRuleId ? Number(req.body.transferRuleId) : undefined,
            originSiloId: Number(req.body.originSiloId),
            destinationSiloId: Number(req.body.destinationSiloId),
            materialId: Number(req.body.materialId),
            plannedQuantityKg: Number(req.body.plannedQuantityKg),
            lotCode: req.body.lotCode,
            priority: req.body.priority,
            recommendationId: req.body.recommendationId ? Number(req.body.recommendationId) : null,
            recommendationKey: req.body.recommendationKey,
            notes: req.body.notes,
            idempotencyKey: req.body.idempotencyKey,
          },
          req.appUser!
        );
        res.status(201).json(created);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao criar solicitação de transferência.' });
      }
    }
  );

  app.post(
    '/api/transfer-orders/:id/start',
    requireAuth,
    requirePermission('transfers:execute'),
    async (req: AuthRequest, res) => {
      try {
        const orderId = Number(req.params.id);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return res.status(400).json({ error: 'Ordem inválida.' });
        }
        res.json(await startTransferOrder(orderId, req.appUser!, req.body?.notes));
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao registrar início da transferência.' });
      }
    }
  );

  app.post(
    '/api/transfer-orders/:id/execute-step',
    requireAuth,
    requirePermission('transfers:execute'),
    async (req: AuthRequest, res) => {
      try {
        const orderId = Number(req.params.id);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return res.status(400).json({ error: 'Ordem inválida.' });
        }
        const result = await executeTransferOrderStepTransactional(
          {
            orderId,
            quantityKg: Number(req.body.quantityKg),
            expectedVersion:
              req.body.expectedVersion !== undefined ? Number(req.body.expectedVersion) : undefined,
            preferredLotCode: req.body.preferredLotCode,
            notes: req.body.notes,
            executedByName: req.body.executedByName,
            executedByBadge: req.body.executedByBadge,
            idempotencyKey: req.body.idempotencyKey,
          },
          req.appUser!
        );
        res.status(201).json(result);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao executar etapa da transferência.' });
      }
    }
  );

  app.post(
    '/api/transfer-orders/:id/interrupt',
    requireAuth,
    requirePermission('transfers:execute'),
    async (req: AuthRequest, res) => {
      try {
        const orderId = Number(req.params.id);
        if (!Number.isInteger(orderId) || orderId <= 0) {
          return res.status(400).json({ error: 'Ordem inválida.' });
        }
        const updated = await interruptTransferOrder(
          orderId,
          String(req.body?.reason || ''),
          req.appUser!
        );
        res.json(updated);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao interromper transferência.' });
      }
    }
  );

  app.post(
    '/api/ai/supply-advisor',
    requireAuth,
    requirePermission('supply:view'),
    async (req, res) => {
      try {
        const { question, scenarioFacts } = req.body;
        if (!question || !scenarioFacts) {
          return res.status(400).json({ error: 'Informe a dúvida/cenário e os dados do painel.' });
        }
        const manualArticles = await listHelpArticles();
        const advice = await explainSupplyScenarioWithGemini({
          question: String(question),
          scenarioFacts,
          manualArticles: manualArticles.map((a) => ({
            slug: a.slug,
            module: a.module,
            title: a.title,
            summary: a.summary,
            content: a.content,
          })),
        });
        res.json(advice);
      } catch (error: any) {
        console.error('Error in /api/ai/supply-advisor:', error);
        res.status(502).json({
          error:
            error.message ||
            'Falha ao consultar analista Gemini de Abastecimento & Transferências.',
        });
      }
    }
  );

  // =========================================================================
  // FASE 5 — RELATÓRIOS, INDICADORES, TURNOS, PASSAGEM, OCORRÊNCIAS E ASSISTENTE
  // =========================================================================

  const parseReportFiltersFromQuery = (q: Record<string, any>) => ({
    preset: q.preset ? (String(q.preset) as any) : undefined,
    startDate: q.startDate ? String(q.startDate) : undefined,
    endDate: q.endDate ? String(q.endDate) : undefined,
    shiftCode: q.shiftCode ? String(q.shiftCode) : undefined,
    materialId: q.materialId ? Number(q.materialId) : null,
    siloId: q.siloId ? Number(q.siloId) : null,
    lineCode: q.lineCode ? String(q.lineCode) : undefined,
    supplierName: q.supplierName ? String(q.supplierName) : undefined,
    lotCode: q.lotCode ? String(q.lotCode) : undefined,
    status: q.status ? String(q.status) : undefined,
    onlyPartial: q.onlyPartial === 'true',
    onlyPending: q.onlyPending === 'true',
    onlyPendingComparison: q.onlyPendingComparison === 'true',
    historicalDate: q.historicalDate ? String(q.historicalDate) : undefined,
    cutoffMode: q.cutoffMode === 'TIMESTAMP' ? ('TIMESTAMP' as const) : ('OPERATIONAL_DATE' as const),
  });

  app.get(
    '/api/reports/overview',
    requireAuth,
    requirePermission('reports:view'),
    async (req, res) => {
      try {
        res.json(await getOperationalIndicatorsOverview(parseReportFiltersFromQuery(req.query)));
      } catch (error: any) {
        console.error('Error on GET /api/reports/overview:', error);
        res.status(500).json({ error: error.message || 'Erro ao carregar indicadores operacionais.' });
      }
    }
  );

  app.get(
    '/api/reports/receiving',
    requireAuth,
    requirePermission('reports:view'),
    async (req, res) => {
      try {
        res.json(await getReceivingReport(parseReportFiltersFromQuery(req.query)));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar relatório de recebimentos.' });
      }
    }
  );

  app.get(
    '/api/reports/stock',
    requireAuth,
    requirePermission('reports:view'),
    async (req, res) => {
      try {
        res.json(await getStockAndHistoricalReport(parseReportFiltersFromQuery(req.query)));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar relatório de estoque e posição histórica.' });
      }
    }
  );

  app.get(
    '/api/reports/rubricagem-diaria',
    requireAuth,
    requirePermission('reports:view'),
    async (req, res) => {
      try {
        const siloIdRaw = req.query.siloId ? Number(req.query.siloId) : null;
        const matIdRaw = req.query.materialId ? Number(req.query.materialId) : null;
        res.json(
          await getDailyRubricagemComparisonReport({
            referenceDate: req.query.referenceDate ? String(req.query.referenceDate) : undefined,
            siloId: siloIdRaw && Number.isInteger(siloIdRaw) && siloIdRaw > 0 ? siloIdRaw : null,
            materialId: matIdRaw && Number.isInteger(matIdRaw) && matIdRaw > 0 ? matIdRaw : null,
            lineCode: req.query.lineCode ? String(req.query.lineCode) : undefined,
          })
        );
      } catch (error: any) {
        res.status(500).json({
          error: error.message || 'Erro ao carregar relatório comparativo diário de rubricagem.',
        });
      }
    }
  );

  app.get(
    '/api/reports/transfers',
    requireAuth,
    requirePermission('reports:view'),
    async (req, res) => {
      try {
        res.json(await getTransfersReport(parseReportFiltersFromQuery(req.query)));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar relatório de transferências.' });
      }
    }
  );

  app.get(
    '/api/reports/consumption',
    requireAuth,
    requirePermission('reports:view'),
    async (req, res) => {
      try {
        res.json(await getConsumptionAndScheduleReport(parseReportFiltersFromQuery(req.query)));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar relatório de consumo e programação.' });
      }
    }
  );

  app.get(
    '/api/reports/shifts',
    requireAuth,
    requirePermission('reports:view'),
    async (req, res) => {
      try {
        res.json(
          await getShiftManagerialReports({
            startDate: req.query.startDate ? String(req.query.startDate) : undefined,
            endDate: req.query.endDate ? String(req.query.endDate) : undefined,
            shiftCode: req.query.shiftCode ? String(req.query.shiftCode) : undefined,
            operatorName: req.query.operatorName ? String(req.query.operatorName) : undefined,
            badgeCode: req.query.badgeCode ? String(req.query.badgeCode) : undefined,
            materialId: req.query.materialId ? Number(req.query.materialId) : null,
            siloId: req.query.siloId ? Number(req.query.siloId) : null,
            lineCode: req.query.lineCode ? String(req.query.lineCode) : undefined,
            workflowStatus: req.query.workflowStatus ? String(req.query.workflowStatus) : undefined,
            search: req.query.search ? String(req.query.search) : undefined,
          })
        );
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar relatórios de turno.' });
      }
    }
  );

  app.get(
    '/api/reports/snapshots',
    requireAuth,
    requirePermission('reports:view'),
    async (_req, res) => {
      try {
        res.json(await listReportSnapshots(30));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao listar versões de relatórios.' });
      }
    }
  );

  app.post(
    '/api/reports/export',
    requireAuth,
    requirePermission('reports:export'),
    async (req: AuthRequest, res) => {
      try {
        const format = String(req.body.format || 'CSV').toUpperCase();
        if (!['PDF', 'XLSX', 'CSV'].includes(format)) {
          return res.status(400).json({ error: 'Formato inválido (utilize PDF, XLSX ou CSV).' });
        }
        const reportType = String(req.body.reportType || 'INDICADORES').toUpperCase();
        const result = await exportOperationalReportTransactional(
          {
            reportType: reportType as any,
            format: format as any,
            filters: req.body.filters || {},
            shiftCode: req.body.shiftCode,
            operationalDate: req.body.operationalDate,
          },
          req.appUser!
        );

        res.setHeader('Content-Type', result.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
        res.setHeader('X-Nexo-File-Name', result.fileName);
        res.send(result.buffer);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao exportar relatório.' });
      }
    }
  );

  app.get(
    '/api/kpi-targets',
    requireAuth,
    requirePermission('reports:view'),
    async (_req, res) => {
      try {
        res.json(await listPerformanceTargets());
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao listar metas futuras.' });
      }
    }
  );

  app.post(
    '/api/kpi-targets',
    requireAuth,
    requirePermission('kpi:targets_manage'),
    async (req: AuthRequest, res) => {
      try {
        const saved = await upsertPerformanceTargetTransactional(
          {
            code: String(req.body.code || ''),
            metricKey: String(req.body.metricKey || ''),
            label: String(req.body.label || ''),
            targetValue: Number(req.body.targetValue),
            unit: String(req.body.unit || 'kg'),
            targetPeriod: (req.body.targetPeriod || 'MENSAL') as any,
            effectiveFromDate: String(req.body.effectiveFromDate || new Date().toISOString().slice(0, 10)),
            notes: req.body.notes,
            isActive: req.body.isActive,
          },
          req.appUser!
        );
        res.status(201).json(saved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao salvar meta futura.' });
      }
    }
  );

  // Gestão de Turnos
  app.get('/api/shifts', requireAuth, requirePermission('shifts:view'), async (_req, res) => {
    try {
      res.json(await listShiftsWithAssignments());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar configurações de turnos.' });
    }
  });

  app.put(
    '/api/shifts/:code',
    requireAuth,
    requirePermission('shifts:manage'),
    async (req: AuthRequest, res) => {
      try {
        const code = String(req.params.code || '').toUpperCase();
        if (!['TURNO_1', 'TURNO_2', 'TURNO_3'].includes(code)) {
          return res.status(400).json({ error: 'Código de turno inválido.' });
        }
        const updated = await updateShiftConfigTransactional(
          code as any,
          {
            name: req.body.name,
            startTime: String(req.body.startTime || ''),
            endTime: String(req.body.endTime || ''),
            supervisorUserId:
              req.body.supervisorUserId !== undefined && req.body.supervisorUserId !== null
                ? Number(req.body.supervisorUserId)
                : null,
            responsibleName: req.body.responsibleName,
            operatorIds: Array.isArray(req.body.operatorIds) ? req.body.operatorIds.map(Number) : [],
            isValidated: req.body.isValidated,
            isActive: req.body.isActive,
            notes: req.body.notes,
            reason: String(req.body.reason || ''),
          },
          req.appUser!
        );
        res.json(updated);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao atualizar configuração do turno.' });
      }
    }
  );

  // Passagem de Turno e Pendências
  app.get(
    '/api/shift-handovers/auto-summary',
    requireAuth,
    requirePermission('shifts:view'),
    async (req, res) => {
      try {
        const active = await resolveActiveShiftFromDb();
        const shiftCode = req.query.shiftCode ? String(req.query.shiftCode) : active.shiftCode;
        const operationalDate = req.query.operationalDate
          ? String(req.query.operationalDate)
          : active.operationalDate;
        res.json(await buildShiftAutoSummary(shiftCode, operationalDate));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao gerar resumo automático do turno.' });
      }
    }
  );

  app.get('/api/shift-handovers', requireAuth, requirePermission('shifts:view'), async (_req, res) => {
    try {
      res.json(await listShiftHandovers());
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro ao listar passagens de turno.' });
    }
  });

  app.post(
    '/api/shift-handovers/draft',
    requireAuth,
    requirePermission('handover:prepare'),
    async (req: AuthRequest, res) => {
      try {
        const active = await resolveActiveShiftFromDb();
        const saved = await saveShiftHandoverDraftTransactional(
          {
            id: req.body.id ? Number(req.body.id) : undefined,
            shiftCode: String(req.body.shiftCode || active.shiftCode),
            operationalDate: String(req.body.operationalDate || active.operationalDate),
            status: req.body.status === 'REVISAO' ? 'REVISAO' : 'RASCUNHO',
            workflowStatus: req.body.workflowStatus,
            shiftSummaryText: req.body.shiftSummaryText,
            relevantOccurrencesText: req.body.relevantOccurrencesText,
            pendenciesText: req.body.pendenciesText,
            requiredActionsText: req.body.requiredActionsText,
            nextShiftRecommendationsText: req.body.nextShiftRecommendationsText,
            editedReportText: req.body.editedReportText,
            aiCommand: req.body.aiCommand,
            receivedByUserId: req.body.receivedByUserId ? Number(req.body.receivedByUserId) : null,
            receivedByName: req.body.receivedByName,
          },
          req.appUser!
        );
        res.status(201).json(saved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao salvar passagem de turno.' });
      }
    }
  );

  app.post(
    '/api/shift-handovers/:id/supplement',
    requireAuth,
    requirePermission('handover:prepare'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Identificador de relatório inválido.' });
        }
        const updated = await addShiftHandoverSupplementTransactional(
          id,
          {
            category: req.body.category,
            text: String(req.body.text || ''),
            executedByName: req.body.executedByName,
            executedByBadge: req.body.executedByBadge,
          },
          req.appUser!
        );
        res.status(201).json(updated);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao registrar complemento no relatório.' });
      }
    }
  );

  app.post(
    '/api/shift-handovers/:id/approve',
    requireAuth,
    requirePermission('handover:approve'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Identificador de relatório inválido.' });
        }
        const approved = await approveShiftHandoverTransactional(
          id,
          {
            receivedByUserId: req.body.receivedByUserId ? Number(req.body.receivedByUserId) : null,
            receivedByName: req.body.receivedByName,
            editedReportText: req.body.editedReportText,
            approvalNotes: req.body.approvalNotes,
            closeImmediately: Boolean(req.body.closeImmediately),
          },
          req.appUser!
        );
        res.json(approved);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao aprovar relatório de turno.' });
      }
    }
  );

  app.post(
    '/api/shift-handovers/:id/correct',
    requireAuth,
    requirePermission('handover:correct'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Identificador de relatório inválido.' });
        }
        const corrected = await correctShiftHandoverPostApprovalTransactional(
          id,
          {
            correctedReportText: String(req.body.correctedReportText || ''),
            reason: String(req.body.reason || ''),
            aiCommand: req.body.aiCommand,
          },
          req.appUser!
        );
        res.json(corrected);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao registrar correção versionada.' });
      }
    }
  );

  app.post(
    '/api/shift-handovers/:id/finalize',
    requireAuth,
    requirePermission('handover:prepare'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Identificador de passagem inválido.' });
        }
        const finalized = await finalizeShiftHandoverTransactional(
          id,
          {
            receivedByUserId: req.body.receivedByUserId ? Number(req.body.receivedByUserId) : null,
            receivedByName: req.body.receivedByName,
            editedReportText: req.body.editedReportText,
            finalizationNote: req.body.finalizationNote,
          },
          req.appUser!
        );
        res.json(finalized);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao finalizar passagem de turno.' });
      }
    }
  );

  app.post(
    '/api/shift-handovers/refine-text',
    requireAuth,
    requirePermission('handover:prepare'),
    async (req, res) => {
      try {
        const { baseReportText, rawFacts, userCommand } = req.body;
        if (!baseReportText) {
          return res.status(400).json({ error: 'Texto base obrigatório.' });
        }
        res.json(
          await refineShiftReportWithGemini({
            baseReportText: String(baseReportText),
            rawFacts: rawFacts || {},
            userCommand: typeof userCommand === 'string' ? userCommand : undefined,
          })
        );
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao organizar texto do relatório.' });
      }
    }
  );

  app.get(
    '/api/shift-pendencies/open',
    requireAuth,
    requirePermission('shifts:view'),
    async (_req, res) => {
      try {
        res.json(await listOpenShiftPendencies());
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao listar pendências de turno.' });
      }
    }
  );

  app.post(
    '/api/shift-pendencies/:id/acknowledge',
    requireAuth,
    requirePermission('handover:acknowledge'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Pendência inválida.' });
        }
        res.json(
          await acknowledgeShiftPendencyTransactional(
            id,
            req.body?.note ? String(req.body.note) : null,
            req.appUser!
          )
        );
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao registrar ciência da pendência.' });
      }
    }
  );

  app.post(
    '/api/shift-pendencies/:id/resolve',
    requireAuth,
    requirePermission('handover:finalize'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Pendência inválida.' });
        }
        await resolveShiftPendencyTransactional(
          id,
          String(req.body?.resolutionNotes || ''),
          req.appUser!
        );
        res.json({ ok: true });
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao concluir pendência.' });
      }
    }
  );

  // Central de Ocorrências
  app.get(
    '/api/occurrences',
    requireAuth,
    requirePermission('occurrences:view'),
    async (req, res) => {
      try {
        res.json(
          await listOccurrences({
            status: req.query.status ? String(req.query.status) : undefined,
            category: req.query.category ? String(req.query.category) : undefined,
            siloId: req.query.siloId ? Number(req.query.siloId) : undefined,
          })
        );
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao listar ocorrências.' });
      }
    }
  );

  app.post(
    '/api/occurrences',
    requireAuth,
    requirePermission('occurrences:create'),
    async (req: AuthRequest, res) => {
      try {
        const created = await createOccurrenceTransactional(
          {
            category: String(req.body.category || ''),
            title: String(req.body.title || ''),
            description: String(req.body.description || ''),
            occurredAt: req.body.occurredAt,
            siloId: req.body.siloId ? Number(req.body.siloId) : null,
            materialId: req.body.materialId ? Number(req.body.materialId) : null,
            productionLineId: req.body.productionLineId ? Number(req.body.productionLineId) : null,
            assignedToUserId: req.body.assignedToUserId ? Number(req.body.assignedToUserId) : null,
            priority: req.body.priority,
            weatherCondition: req.body.weatherCondition,
            lineImpact: req.body.lineImpact,
            executedByName: req.body.executedByName,
            executedByBadge: req.body.executedByBadge,
            evidence: Array.isArray(req.body.evidence) ? req.body.evidence : [],
          },
          req.appUser!
        );
        res.status(201).json(created);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao registrar ocorrência.' });
      }
    }
  );

  app.post(
    '/api/occurrences/:id/verify',
    requireAuth,
    requirePermission('occurrences:verify'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Ocorrência inválida.' });
        }
        const verified = await verifyOccurrenceTransactional(
          id,
          req.body?.verificationNotes ? String(req.body.verificationNotes) : null,
          req.appUser!
        );
        res.json(verified);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao verificar ocorrência.' });
      }
    }
  );

  app.patch(
    '/api/occurrences/:id/status',
    requireAuth,
    requirePermission('occurrences:manage'),
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'Ocorrência inválida.' });
        }
        const statusVal = String(req.body.status || '');
        if (!['ABERTA', 'EM_ANDAMENTO', 'ENCERRADA'].includes(statusVal)) {
          return res.status(400).json({ error: 'Status de ocorrência inválido.' });
        }
        const updated = await updateOccurrenceStatusTransactional(
          id,
          {
            status: statusVal as any,
            assignedToUserId:
              req.body.assignedToUserId !== undefined
                ? req.body.assignedToUserId
                  ? Number(req.body.assignedToUserId)
                  : null
                : undefined,
            solutionApplied: req.body.solutionApplied,
          },
          req.appUser!
        );
        res.json(updated);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao atualizar ocorrência.' });
      }
    }
  );

  // NEXO ASSISTENTE (Somente Leitura)
  app.post(
    '/api/assistant/ask',
    requireAuth,
    requirePermission('assistant:use'),
    async (req: AuthRequest, res) => {
      try {
        const question = String(req.body.question || '').trim();
        if (!question) {
          return res.status(400).json({ error: 'Digite sua pergunta operacional.' });
        }
        const [contextData, manualArticles] = await Promise.all([
          queryNexoAssistantContext(question, req.appUser!),
          listHelpArticles(),
        ]);
        const answer = await askNexoAssistantWithGemini({
          question,
          contextData,
          manualArticles: manualArticles.map((a) => ({
            module: a.module,
            title: a.title,
            summary: a.summary,
          })),
        });
        res.json(answer);
      } catch (error: any) {
        console.error('Error in /api/assistant/ask:', error);
        res.status(500).json({ error: error.message || 'Falha ao consultar NEXO ASSISTENTE.' });
      }
    }
  );

  // NEXO AI MULTIMODAL — Chat, Google Search & Maps Grounding, Transcrição de Áudio
  app.post(
    '/api/ai/chat',
    requireAuth,
    requirePermission('assistant:use'),
    async (req: AuthRequest, res) => {
      try {
        const { model, messages, systemInstruction, groundingMode, latLng, attachment } = req.body;
        if (attachment && typeof attachment === 'object') {
          const attMime = normalizeMime(attachment.mimeType || 'image/jpeg');
          const attBytes = estimateBase64DecodedBytes(String(attachment.dataBase64 || ''));
          if (
            (!ALLOWED_IMAGE_MIMES.has(attMime) && attMime !== 'application/pdf') ||
            attBytes <= 0 ||
            attBytes > MAX_IMAGE_UPLOAD_BYTES
          ) {
            return res.status(400).json({
              error: 'Anexo inválido ou acima do limite permitido (imagem/PDF até 8 MB).',
            });
          }
        }
        const result = await runMultimodalStudioChat({
          model: String(model || 'gemini-4-hydrogen'),
          messages: Array.isArray(messages) ? messages : [],
          systemInstruction:
            typeof systemInstruction === 'string' ? systemInstruction : undefined,
          groundingMode,
          latLng: latLng || null,
          attachment: attachment || null,
        });
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/ai/chat:', error);
        res.status(502).json({
          error: error.message || 'Falha ao processar conversa multimodal no Gemini.',
        });
      }
    }
  );

  app.post(
    '/api/ai/transcribe',
    requireAuth,
    requirePermission('assistant:use'),
    async (req: AuthRequest, res) => {
      try {
        const { audioBase64, mimeType, prompt } = req.body;
        const audioCheck = validateAudioUploadPayload({
          base64: String(audioBase64 || ''),
          mimeType: String(mimeType || 'audio/webm'),
        });
        if (audioCheck.valid === false) {
          return res.status(400).json({ error: audioCheck.error });
        }
        const result = await transcribeAudioWithGemini({
          audioBase64,
          mimeType: audioCheck.normalizedMime,
          prompt: typeof prompt === 'string' ? prompt : undefined,
        });
        res.json(result);
      } catch (error: any) {
        console.error('Error in /api/ai/transcribe:', error);
        res.status(502).json({
          error: error.message || 'Falha ao transcrever áudio com gemini-3.5-transcribe.',
        });
      }
    }
  );

  // =========================================================================
  // PAINEL: TENDÊNCIA DE CONSUMO DE 30 DIAS (RECHARTS)
  // =========================================================================
  app.get(
    '/api/dashboard/consumption-trend',
    requireAuth,
    requirePermission('dashboard:view'),
    async (req, res) => {
      try {
        const days = req.query.days ? Number(req.query.days) : 30;
        const lineCode = req.query.lineCode ? String(req.query.lineCode) : 'ALL';
        const materialId = req.query.materialId ? Number(req.query.materialId) : null;
        const trend = await get30DayConsumptionTrend({
          days: Number.isFinite(days) ? days : 30,
          lineCode,
          materialId: materialId && Number.isFinite(materialId) ? materialId : null,
        });
        res.json(trend);
      } catch (error: any) {
        console.error('Error on GET /api/dashboard/consumption-trend:', error);
        res.status(500).json({ error: error.message || 'Erro ao carregar tendência de consumo.' });
      }
    }
  );

  // =========================================================================
  // COMPARADOR INTELIGENTE DE CESTAS DE CONSUMO
  // =========================================================================
  app.post(
    '/api/baskets/extract',
    requireAuth,
    requirePermission('baskets:upload'),
    async (req, res) => {
      try {
        const { sourceType, pages, expectedProductionDate } = req.body || {};
        if (!sourceType || !Array.isArray(pages) || pages.length === 0) {
          return res
            .status(400)
            .json({ error: 'Informe sourceType e pelo menos uma página/arquivo em pages.' });
        }
        if (pages.length > 15) {
          return res.status(400).json({ error: 'Limite máximo de 15 páginas por envio.' });
        }
        for (const p of pages) {
          const mime = normalizeMime(p?.mimeType || '');
          const nameLower = String(p?.fileName || '').toLowerCase();
          const extOk = /\.(jpg|jpeg|png|webp|heic|heif|pdf|csv|xlsx|xls)$/i.test(nameLower);
          if (mime && mime !== 'application/octet-stream' && !ALLOWED_BASKET_UPLOAD_MIMES.has(mime)) {
            return res.status(400).json({ error: `Formato não suportado em "${p?.fileName || 'arquivo'}": ${mime}` });
          }
          if (!mime && !extOk) {
            return res.status(400).json({ error: `Extensão de arquivo não suportada em "${p?.fileName || 'arquivo'}".` });
          }
          const decodedBytes = estimateBase64DecodedBytes(String(p?.base64Content || ''));
          if (decodedBytes <= 0 || decodedBytes > 10 * 1024 * 1024) {
            return res.status(400).json({ error: `Arquivo "${p?.fileName || 'página'}" vazio ou acima de 10 MB.` });
          }
        }
        const extracted = await extractBasketFromUpload({
          sourceType,
          pages,
          expectedProductionDate: expectedProductionDate ? String(expectedProductionDate) : undefined,
        });
        res.json(extracted);
      } catch (error: any) {
        console.error('Error on POST /api/baskets/extract:', error);
        const status = error instanceof OperationalConflictError ? error.statusCode : 502;
        res.status(status).json({ error: error.message || 'Falha na leitura da Cesta de Consumo.' });
      }
    }
  );

  app.post(
    '/api/baskets/versions',
    requireAuth,
    requirePermission('baskets:upload'),
    async (req: AuthRequest, res) => {
      try {
        const created = await createBasketVersionRecord(req.body, req.appUser!);
        res.status(201).json(created);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao salvar versão da Cesta.' });
      }
    }
  );

  app.patch(
    '/api/baskets/versions/:id/items',
    requireAuth,
    requirePermission('baskets:edit'),
    async (req: AuthRequest, res) => {
      try {
        const versionId = Number(req.params.id);
        if (!Number.isInteger(versionId) || versionId <= 0) {
          return res.status(400).json({ error: 'ID de versão inválido.' });
        }
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const updated = await updateBasketVersionItemsRecord(versionId, items, req.appUser!);
        res.json(updated);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao atualizar itens conferidos.' });
      }
    }
  );

  app.post(
    '/api/baskets/compare',
    requireAuth,
    requirePermission('baskets:view'),
    async (req: AuthRequest, res) => {
      try {
        const baseVersionId = Number(req.body?.baseVersionId);
        const targetVersionId = Number(req.body?.targetVersionId);
        if (!Number.isInteger(baseVersionId) || !Number.isInteger(targetVersionId)) {
          return res.status(400).json({ error: 'Informe baseVersionId e targetVersionId válidos.' });
        }
        const comparison = await runBasketComparisonRecord(
          { baseVersionId, targetVersionId },
          req.appUser!
        );
        res.status(201).json(comparison);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao comparar Cestas de Consumo.' });
      }
    }
  );

  app.post(
    '/api/baskets/publish',
    requireAuth,
    requirePermission('baskets:publish'),
    async (req: AuthRequest, res) => {
      try {
        const comparisonId = Number(req.body?.comparisonId);
        if (!Number.isInteger(comparisonId) || comparisonId <= 0) {
          return res.status(400).json({ error: 'comparisonId inválido.' });
        }
        const result = await publishBasketComparisonTransactional(
          { comparisonId, notes: req.body?.notes ?? null },
          req.appUser!
        );
        broadcastNexoEvent(result.notification as unknown as Record<string, unknown>);
        res.json(result);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao publicar nova programação.' });
      }
    }
  );

  app.get(
    '/api/baskets/history',
    requireAuth,
    requirePermission('baskets:view'),
    async (req, res) => {
      try {
        const productionDate = req.query.productionDate
          ? String(req.query.productionDate)
          : undefined;
        res.json(await listBasketHistory(productionDate));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao carregar histórico de Cestas.' });
      }
    }
  );

  app.get(
    '/api/baskets/comparisons/:id',
    requireAuth,
    requirePermission('baskets:view'),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'ID inválido.' });
        }
        res.json(await getBasketComparisonById(id));
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao carregar comparação.' });
      }
    }
  );

  app.get(
    '/api/baskets/notifications/latest',
    requireAuth,
    requirePermission('baskets:view'),
    async (_req, res) => {
      try {
        res.json({ notification: await getLatestPublishedBasketNotification() });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Erro ao consultar notificações.' });
      }
    }
  );

  app.post(
    '/api/baskets/export',
    requireAuth,
    requirePermission('baskets:export'),
    async (req: AuthRequest, res) => {
      try {
        const comparisonId = Number(req.body?.comparisonId);
        const format = String(req.body?.format || 'PDF').toUpperCase();
        if (!Number.isInteger(comparisonId) || comparisonId <= 0) {
          return res.status(400).json({ error: 'comparisonId inválido.' });
        }
        if (!['PDF', 'XLSX', 'CSV'].includes(format)) {
          return res.status(400).json({ error: 'Formato inválido (use PDF, XLSX ou CSV).' });
        }
        const exported = await exportBasketComparisonReport(
          { comparisonId, format: format as any },
          req.appUser!
        );
        res.setHeader('Content-Type', exported.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${exported.fileName}"`);
        res.setHeader('X-Nexo-File-Name', exported.fileName);
        res.send(exported.buffer);
      } catch (error: any) {
        const status = error instanceof OperationalConflictError ? error.statusCode : 500;
        res.status(status).json({ error: error.message || 'Erro ao exportar comparação.' });
      }
    }
  );

  // Static / Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint de API não encontrado.' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = createServer(app);
  const liveWss = new WebSocketServer({ noServer: true });
  const nexoWss = new WebSocketServer({ noServer: true });

  nexoWss.on('connection', (clientWs: WebSocket) => {
    nexoWsClients.add(clientWs);
    clientWs.send(
      JSON.stringify({ type: 'connected', serverTimeIso: new Date().toISOString() })
    );
    clientWs.on('close', () => {
      nexoWsClients.delete(clientWs);
    });
  });

  httpServer.on('upgrade', async (request, socket, head) => {
    try {
      const parsedUrl = new URL(request.url || '/', 'http://localhost');
      const isGeminiLive = parsedUrl.pathname === '/ws/gemini-live';
      const isNexoEvents = parsedUrl.pathname === '/ws/nexo';
      if (!isGeminiLive && !isNexoEvents) {
        return;
      }

      const token = parsedUrl.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const decoded = await adminAuth.verifyIdToken(token);
      await ensureBaseCatalogSeeded();
      const appUser = await getOrCreateUser(
        decoded.uid,
        decoded.email || `${decoded.uid}@nexolog.local`,
        decoded.name
      );

      if (!appUser.isActive) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      if (isNexoEvents) {
        if (!hasPermission(appUser.roleCode, 'baskets:view')) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
        nexoWss.handleUpgrade(request, socket, head, (ws) => {
          nexoWss.emit('connection', ws, request, parsedUrl);
        });
        return;
      }

      if (!hasPermission(appUser.roleCode, 'assistant:use')) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      liveWss.handleUpgrade(request, socket, head, (ws) => {
        liveWss.emit('connection', ws, request, parsedUrl);
      });
    } catch (err) {
      console.error('Erro na autenticação WebSocket:', err);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  liveWss.on('connection', async (clientWs: WebSocket, _req: unknown, parsedUrl: URL) => {
    let liveSession: Awaited<ReturnType<typeof openGeminiLiveVoiceSession>> | null = null;
    const voiceName = parsedUrl.searchParams.get('voice') || 'Zephyr';

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    try {
      liveSession = await openGeminiLiveVoiceSession({
        voiceName,
        onAudioChunk: (audio) => safeSend({ audio }),
        onInputTranscript: (text) => safeSend({ inputTranscript: text }),
        onOutputTranscript: (text) => safeSend({ outputTranscript: text }),
        onInterrupted: () => safeSend({ interrupted: true }),
        onTurnComplete: () => safeSend({ turnComplete: true }),
        onError: (errMessage) => safeSend({ error: errMessage }),
        onClose: () => safeSend({ closed: true }),
      });
      safeSend({ ready: true, model: 'gemini-3.8-live', voice: voiceName });
    } catch (err: any) {
      safeSend({
        error: err?.message || 'Falha ao iniciar sessão de voz Gemini Live.',
      });
      clientWs.close();
      return;
    }

    clientWs.on('message', (raw) => {
      if (!liveSession) return;
      try {
        const msg = JSON.parse(raw.toString());
        if (typeof msg.audio === 'string' && msg.audio.length > 0) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        }
        if (typeof msg.text === 'string' && msg.text.trim().length > 0) {
          liveSession.sendRealtimeInput({ text: msg.text.trim() });
        }
      } catch (err) {
        console.error('Erro ao encaminhar frame Live API:', err);
      }
    });

    clientWs.on('close', () => {
      try {
        liveSession?.close();
      } catch {
        // ignore close race
      }
      liveSession = null;
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`NEXO LOG 2.0 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
