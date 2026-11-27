import type { RoleCode } from '../lib/rbac.ts';

export interface AppUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  badgeCode: string | null;
  jobTitle?: string | null;
  department?: string | null;
  roleCode: RoleCode;
  roleName: string;
  defaultShiftCode: string;
  isActive: boolean;
}

export interface ShiftInfo {
  shiftCode: 'TURNO_1' | 'TURNO_2' | 'TURNO_3';
  shiftName: string;
  operationalDate: string;
  realTimestampIso: string;
  crossesMidnight: boolean;
}

export interface SessionData {
  user: AppUser;
  permissions: string[];
  shift: ShiftInfo;
}

export interface SiloCompatibility {
  id: number;
  siloId: number;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  isPrimary: boolean;
  allowReceiving: boolean;
  allowTransferIn: boolean;
  allowTransferOut: boolean;
  validationStatus: string;
}

export interface SiloDetail {
  id: number;
  siloNumber: number;
  rubricOrder: number;
  category: 'LINHA' | 'ARMAZENAGEM' | 'PRODUCAO';
  controlOwner: 'MOEGA' | 'PRODUCAO';
  productionLineId: number;
  lineCode: string;
  lineName: string;
  heightMeters: number | null;
  cordaMeters: number | null;
  nominalCapacityKg: number;
  safetyFactorPercent: number;
  safeCapacityKg: number;
  primaryMaterialId: number | null;
  materialCode: string | null;
  materialDescription: string | null;
  materialCategory: string | null;
  materialHandlingType: string | null;
  operationalStatus: 'OPERACIONAL' | 'MANUTENCAO' | 'LIMPEZA' | 'BLOQUEADO' | 'INATIVO';
  cleaningStatus: 'LIMPO' | 'EM_USO' | 'REQUER_LIMPEZA';
  isDividedCompartment: boolean;
  restrictions: string | null;
  validationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO';
  validationNotes: string | null;
  confirmedStockKg: number;
  availableSpaceKg: number;
  occupancyPercent: number;
  stockAlertLevel?: 'CRITICO' | 'ATENCAO' | 'NORMAL';
  stockAlertReason?: string | null;
  minStockKg?: number | null;
  warningStockKg?: number | null;
  isReceiving?: boolean;
  lastMovementAt: string | null;
  updatedAt: string;
  compatibilities: SiloCompatibility[];
  stockControlModel?: StockControlModel;
  ledgerStockKg?: number;
  lastPhysicalCountKg?: number | null;
  lastPhysicalCountAt?: string | null;
  previousPhysicalCountKg?: number | null;
  previousPhysicalCountAt?: string | null;
  physicalVariationKg?: number | null;
  physicalVariationPct?: number | null;
  physicalDivergenceKg?: number | null;
  rubricagemStatus?: RubricagemWorkflowStatus | null;
}

export type StockControlModel = 'CONTROLE_CONTINUO_MOVIMENTOS' | 'RUBRICAGEM_DIARIA_FISICA';

export type RubricagemWorkflowStatus =
  | 'AGUARDANDO_LEITURA'
  | 'LEITURA_CONCLUIDA'
  | 'AGUARDANDO_CONFERENCIA'
  | 'DIVERGENCIA_IDENTIFICADA'
  | 'AGUARDANDO_AUTORIZACAO'
  | 'INVENTARIO_CONFIRMADO'
  | 'HISTORICO_PRESERVADO';

export interface MaterialItem {
  id: number;
  code: string;
  description: string;
  category: string;
  handlingType: string;
  referenceBagWeightKg: string | null;
  bagWeightValidationStatus: string;
  isCritical: boolean;
  notes: string | null;
  isActive: boolean;
}

export interface TransferRuleItem {
  id: number;
  originSiloId: number;
  destinationSiloId: number;
  originSiloNumber: number | null;
  destinationSiloNumber: number | null;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  operationType: string;
  maxQuantityKg: string | null;
  requiresAuthorization: boolean;
  authorizationStatus?: 'AUTORIZADA' | 'PENDENTE_VALIDACAO' | 'SUSPENSA' | 'BLOQUEADA';
  validationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO';
  isActive: boolean;
  restrictions: string | null;
  sourceReference: string | null;
}

export interface ValidationPendency {
  id: number;
  entityType: string;
  entityRef: string;
  title: string;
  description: string;
  sourceA: string;
  sourceB: string;
  status: 'PENDENTE' | 'RESOLVIDO';
  resolutionNotes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AuditEventItem {
  id: number;
  userId: number | null;
  userEmail: string;
  userName: string;
  userRole: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValue: string | null;
  newValue: string | null;
  reason: string | null;
  origin: string;
  createdAt: string;
}

export interface HelpArticleItem {
  id: number;
  slug: string;
  module: string;
  title: string;
  summary: string;
  content: string;
  sortOrder: number;
}

export interface DashboardResponse {
  shift: ShiftInfo;
  lastUpdated: string;
  kpis: {
    totalSilos: number;
    operationalSilos: number;
    blockedOrMaintenance: number;
    occupiedSilos: number;
    availableSilos: number;
    nearCapacitySilos: number;
    totalConfirmedStockKg: number;
    totalNominalCapacityKg: number;
    totalSafeCapacityKg: number;
    totalMaterials: number;
    activeTransferRules: number;
    pendingTransferRules: number;
    pendingValidationsCount: number;
    pendingSilosCount: number;
  };
  byCategory: {
    LINHA: number;
    ARMAZENAGEM: number;
    PRODUCAO: number;
  };
  byLine: Array<{
    code: string;
    name: string;
    category: string;
    siloCount: number;
    nominalCapacityKg: number;
    safeCapacityKg: number;
    confirmedStockKg: number;
    pendingValidationCount: number;
  }>;
  pendenciesPreview: ValidationPendency[];
}

export type NavSectionId =
  | 'inicio'
  | 'executivo'
  | 'painel'
  | 'mapa'
  | 'estoque'
  | 'recebimentos'
  | 'etiquetas'
  | 'distribuicao'
  | 'transferencias'
  | 'programacao'
  | 'comparador'
  | 'consumo'
  | 'abastecimento'
  | 'qualidade'
  | 'relatorios'
  | 'turnos'
  | 'ocorrencias'
  | 'assistente'
  | 'auditoria'
  | 'admin'
  | 'guia';

export interface SupplierItem {
  id: number;
  name: string;
  document: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface MaterialBagConfigItem {
  id: number;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  packagingLabel: string;
  unitWeightKg: number;
  validationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO';
  isDefault: boolean;
  notes: string | null;
  updatedAt: string;
}

export interface CompatibleSiloOption {
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
}

export interface ReceiptDistributionItem {
  id: number;
  receiptId: number;
  siloId: number;
  siloNumber: number;
  quantityKg: number;
  bagCount: number | null;
  movementId: number | null;
  status: string;
  isComplement: boolean;
  operatorName: string;
  operatorBadge?: string | null;
  executedByName?: string | null;
  executedByBadge?: string | null;
  shiftCode: string;
  operationalDate: string;
  notes: string | null;
  createdAt: string;
}

export interface ReceiptItem {
  id: number;
  receiptNumber: string;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  supplierId: number | null;
  supplierName: string;
  invoiceNumber: string | null;
  lotCode: string;
  entryDate: string;
  receivedQuantityKg: number;
  distributedQuantityKg: number;
  remainingQuantityKg: number;
  unit: string;
  receivingType: 'GRANEL' | 'BIG_BAG';
  bagCount: number | null;
  bagUnitWeightKg: number | null;
  receivingPoint: string | null;
  vehiclePlate?: string | null;
  driverName?: string | null;
  carrierName?: string | null;
  status: 'PENDENTE' | 'PARCIAL' | 'CONCLUIDO' | 'CANCELADO';
  operatorUserId: number;
  operatorName: string;
  operatorBadge?: string | null;
  executedByName?: string | null;
  executedByBadge?: string | null;
  shiftCode: string;
  operationalDate: string;
  startedShiftCode?: string | null;
  startedOperationalDate?: string | null;
  finishedShiftCode?: string | null;
  finishedOperationalDate?: string | null;
  startedAt: string;
  finishedAt: string | null;
  notes: string | null;
  attachments?: ReceiptAttachmentItem[];
  version: number;
  createdAt: string;
  distributions: ReceiptDistributionItem[];
}

export interface ReceiptAttachmentItem {
  id: string;
  name: string;
  mimeType: string;
  kind: 'FOTO_CARGA' | 'NOTA_FISCAL' | 'TICKET_BALANCA' | 'DOCUMENTO';
  sizeBytes: number;
  dataUrl: string;
  capturedAtIso: string;
}

export interface LotHistoryResponse {
  lotCode: string;
  hasMovements: boolean;
  totalOriginalKg: number;
  totalDistributedKg: number;
  totalRemainingKg: number;
  receipts: Array<{
    id: number;
    receiptNumber: string;
    materialId: number;
    materialCode: string;
    materialDescription: string;
    supplierName: string;
    invoiceNumber: string | null;
    lotCode: string;
    entryDate: string;
    receivedQuantityKg: number;
    distributedQuantityKg: number;
    remainingQuantityKg: number;
    receivingType: string;
    status: string;
    version: number;
    createdAt: string;
  }>;
  silosUsed: Array<{
    siloNumber: number;
    netKg: number;
    lastAt: string;
  }>;
  movements: Array<{
    id: number;
    movementType: string;
    siloId: number;
    siloNumber: number;
    materialCode: string;
    materialDescription: string;
    quantityKg: number;
    direction: string;
    status: string;
    shiftCode: string;
    operationalDate: string;
    operatorName: string;
    createdAt: string;
  }>;
}

export interface BarcodeParseResponse {
  scanId: number;
  parsed: {
    rawBarcode: string;
    formatMatched: string;
    establishment: string | null;
    materialCode: string | null;
    lotCode: string | null;
    weightKg: number | null;
    uncertainFields: string[];
  };
  matchedMaterial: MaterialItem | null;
  bagConfigs: Array<{
    id: number;
    packagingLabel: string;
    unitWeightKg: number;
    validationStatus: string;
    isDefault: boolean;
  }>;
  lotHistory: LotHistoryResponse | null;
}

export interface GeminiPhotoParseResponse {
  scanId: number;
  extraction: {
    materialCode: string | null;
    description: string | null;
    supplierName: string | null;
    lotCode: string | null;
    weightKg: number | null;
    bagCount: number | null;
    establishment: string | null;
    printDate: string | null;
    rawBarcodeText: string | null;
    uncertainFields: string[];
    notes: string | null;
  };
  matchedMaterial: MaterialItem | null;
  matchedSupplier: SupplierItem | null;
  bagConfigs: Array<{
    id: number;
    packagingLabel: string;
    unitWeightKg: number;
    validationStatus: string;
    isDefault: boolean;
  }>;
  lotHistory: LotHistoryResponse | null;
  catalogInconsistencies: string[];
  sourceImageDataUrl?: string | null;
}

export interface InventoryMovementItem {
  id: number;
  movementType: string;
  siloId: number;
  siloNumber: number | null;
  counterpartSiloId: number | null;
  counterpartSiloNumber: number | null;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  lotCode: string | null;
  quantityKg: number;
  unit: string;
  direction: 'CREDIT' | 'DEBIT';
  referenceDocument: string | null;
  receiptId: number | null;
  supplierName: string | null;
  status: 'CONFIRMADO' | 'ESTORNADO';
  reason: string | null;
  shiftCode: string;
  operationalDate: string;
  operatorName: string;
  operatorBadge?: string | null;
  executedByName?: string | null;
  executedByBadge?: string | null;
  createdAt: string;
}

export interface SiloLedgerDetails {
  activeLots: Array<{
    lotCode: string;
    materialCode: string;
    materialDescription: string;
    netKg: number;
  }>;
  movements: Array<{
    id: number;
    movementType: string;
    siloId: number;
    materialCode: string;
    materialDescription: string;
    lotCode: string | null;
    quantityKg: number;
    direction: 'CREDIT' | 'DEBIT';
    referenceDocument: string | null;
    supplierName: string | null;
    status: string;
    reason: string | null;
    shiftCode: string;
    operationalDate: string;
    operatorName: string;
    createdAt: string;
  }>;
}

// =========================================================================
// FASE 3 — PROGRAMAÇÃO DA PRODUÇÃO, DOCUMENTOS, CONSUMO E INTELIGÊNCIA
// =========================================================================

export interface ScheduleTemplateItem {
  id: number;
  code: string;
  name: string;
  documentCategory: string;
  promptHints: string;
}

export interface ProductFactorItem {
  id: number;
  productId: number;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  factorKgPerUnit: number;
  unit: string;
  validationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO';
  sourceReference: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface ProductWithFactorsItem {
  id: number;
  code: string;
  description: string;
  defaultProductionLineId: number | null;
  defaultLineCode: string | null;
  defaultUnit: string;
  isActive: boolean;
  notes: string | null;
  factors: ProductFactorItem[];
}

export interface StockThresholdItem {
  id: number;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  siloId: number | null;
  siloNumber: number | null;
  minStockKg: number;
  warningStockKg: number;
  notes: string | null;
  updatedAt: string;
}

export interface ParsedScheduleDocumentResponse {
  documentId: number;
  fileName: string;
  mimeType: string;
  sourceType: string;
  extractedTextPreview: string | null;
  extraction: {
    documentDate: string | null;
    productionDate: string | null;
    documentCategory: string;
    documentNotes: string | null;
    unreadableOrAmbiguousFields: string[];
    items: Array<{
      lineCode: string | null;
      sequenceOrder: number;
      productCode: string | null;
      productDescription: string | null;
      materialCode: string | null;
      materialDescription: string | null;
      plannedQuantity: number | null;
      realizedQuantity: number | null;
      plannedUnit: string | null;
      scheduledTimeWindow: string | null;
      confidence: 'ALTA' | 'MEDIA' | 'BAIXA' | 'MANUAL';
      needsReview: boolean;
      reviewReason: string | null;
      notes: string | null;
      productionLineId: number | null;
      matchedProductId: number | null;
      matchedMaterialId: number | null;
      hasValidatedFactor: boolean;
    }>;
  };
  existingRevisionPreview: {
    previousScheduleCode: string;
    previousRevisionNumber: number;
    diff: {
      hasPreviousRevision: boolean;
      hasChanges: boolean;
      alertTitle: string | null;
      itemChanges: Array<{
        lineCode: string;
        changeType: 'ADICIONADO' | 'REMOVIDO' | 'ALTERADO';
        previousProduct: string | null;
        newProduct: string | null;
        previousQuantity: number | null;
        newQuantity: number | null;
        unit: string;
      }>;
      materialImpacts: Array<{
        materialCode: string;
        previousKg: number;
        newKg: number;
        deltaKg: number;
      }>;
      summaryText: string;
    };
  } | null;
}

export interface ProductionScheduleItemView {
  id: number;
  scheduleId: number;
  productionLineId: number;
  lineCode: string;
  lineName: string;
  sequenceOrder: number;
  productId: number | null;
  productCode: string;
  productDescription: string;
  materialId: number | null;
  materialCode: string | null;
  plannedQuantity: number;
  plannedUnit: string;
  scheduledTimeWindow: string | null;
  executionStatus:
    | 'NAO_INICIADA'
    | 'EM_ANDAMENTO'
    | 'CONCLUIDA'
    | 'ATRASADA'
    | 'ADIANTADA'
    | 'INTERROMPIDA';
  realizedQuantity: number;
  extractionConfidence: 'ALTA' | 'MEDIA' | 'BAIXA' | 'MANUAL';
  needsReview: boolean;
  reviewReason: string | null;
  notes: string | null;
  projections: Array<{
    id: number;
    materialId: number | null;
    calculatedConsumptionKg: number;
    realizedConsumptionKg: number;
    calculationStatus: 'CALCULADO' | 'PENDENTE_FATOR';
    originSource: string;
  }>;
}

export interface ProductionScheduleView {
  id: number;
  scheduleCode: string;
  referenceDate: string;
  revisionNumber: number;
  previousScheduleId: number | null;
  documentId: number | null;
  documentMeta: {
    fileName: string;
    mimeType: string;
    sourceType: string;
    documentCategory: string;
  } | null;
  sourceReportType: string;
  status: 'RASCUNHO_CONFERENCIA' | 'APROVADA' | 'SUPERSEDED' | 'CANCELADA';
  revisionDiffSummary: string | null;
  notes: string | null;
  importedByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  createdAt: string;
  items: ProductionScheduleItemView[];
}

export interface IntelligenceSummaryResponse {
  todayDate: string;
  tomorrowDate: string;
  totals: {
    realStockKg: number;
    confirmedPendingEntriesKg: number;
    plannedConsumptionTodayKg: number;
    plannedConsumptionTomorrowKg: number;
    realizedConsumptionKg: number;
    projectedBalanceTotalKg: number;
    criticalMaterialsCount: number;
    pendingSupplyCount: number;
  };
  byMaterial: Array<{
    materialId: number;
    materialCode: string;
    materialDescription: string;
    isCritical: boolean;
    realStockKg: number;
    confirmedPendingEntriesKg: number;
    plannedConsumptionTodayKg: number;
    plannedConsumptionTomorrowKg: number;
    plannedConsumptionFutureKg: number;
    advancedConsumptionKg: number;
    overdueConsumptionKg: number;
    realizedConsumptionKg: number;
    remainingPlannedTodayActiveKg: number;
    remainingTotalPlannedKg: number;
    projectedBalanceTodayKg: number;
    projectedBalanceWithTomorrowKg: number;
    minStockKg: number | null;
    warningStockKg: number | null;
    pendingFactorItemsCount: number;
    statusPriority: 'VERMELHO' | 'LARANJA' | 'AZUL' | 'VERDE';
    statusHeadline: string;
  }>;
  alerts: Array<{
    key: string;
    priority: 'VERMELHO' | 'LARANJA' | 'AZUL' | 'VERDE';
    title: string;
    message: string;
    materialCode: string | null;
    lineCode: string | null;
    siloNumber: number | null;
    referenceDate: string;
  }>;
  recommendations: Array<{
    id: number;
    recommendationKey: string;
    recommendationType: 'ABASTECER_SILO' | 'TRANSFERIR_SILO' | 'PROGRAMAR_RECEBIMENTO' | 'REVISAR_FATOR';
    priority: 'VERMELHO' | 'LARANJA' | 'AZUL' | 'VERDE';
    title: string;
    reason: string;
    referenceDate: string;
    lineCode: string | null;
    materialId: number | null;
    materialCode: string | null;
    materialDescription: string | null;
    targetSiloId: number | null;
    targetSiloNumber: number | null;
    originSiloId: number | null;
    originSiloNumber: number | null;
    requiredKg: number;
    availableKg: number;
    missingKg: number;
    suggestedTransferKg: number | null;
    dataSourceSummary: string;
    decisionStatus: 'PENDENTE' | 'ACEITA' | 'REJEITADA' | 'EXECUTADA';
    decisionNotes: string | null;
    decidedAt: string | null;
  }>;
  latestSchedule: {
    id: number;
    scheduleCode: string;
    referenceDate: string;
    revisionNumber: number;
    revisionDiffSummary: string | null;
    approvedAt: string | null;
  } | null;
}

// =========================================================================
// FASE 4 — TRANSFERÊNCIAS PLANEJADAS, ROTAS, ABASTECIMENTO E OTIMIZAÇÃO
// =========================================================================

export type RouteAuthStatus = 'AUTORIZADA' | 'PENDENTE_VALIDACAO' | 'SUSPENSA' | 'BLOQUEADA';
export type SupplyVisualColor = 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO' | 'CINZA';

export interface AuthorizedRouteItem {
  id: number;
  originSiloId: number;
  originSiloNumber: number | null;
  destinationSiloId: number;
  destinationSiloNumber: number | null;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  relatedLineId: number | null;
  relatedLineCode: string | null;
  relatedLineName: string | null;
  operationType: string;
  maxQuantityKg: number | null;
  requiresAuthorization: boolean;
  authorizationStatus: RouteAuthStatus;
  validationStatus: string;
  isActive: boolean;
  restrictions: string | null;
  sourceReference: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  updatedByName: string | null;
  updatedAt: string;
  createdAt: string;
  history: AuditEventItem[];
}

export interface TransferOrderStepItem {
  id: number;
  transferOrderId: number;
  stepNumber: number;
  quantityKg: number;
  lotComposition: Array<{ lotCode: string | null; quantityKg: number }>;
  referenceDocument: string;
  debitMovementId: number | null;
  creditMovementId: number | null;
  executedByName: string;
  executedByBadge?: string | null;
  shiftCode: string;
  operationalDate: string;
  startedAt: string;
  finishedAt: string;
  notes: string | null;
  status: string;
  createdAt: string;
}

export interface TransferOrderItem {
  id: number;
  orderCode: string;
  transferRuleId: number;
  originSiloId: number;
  originSiloNumber: number | null;
  destinationSiloId: number;
  destinationSiloNumber: number | null;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  productionLineId: number | null;
  lineCode: string | null;
  lineName: string | null;
  recommendationId: number | null;
  lotCode: string | null;
  plannedQuantityKg: number;
  transferredQuantityKg: number;
  remainingQuantityKg: number;
  status: 'PLANEJADA' | 'EM_ANDAMENTO' | 'PARCIAL' | 'CONCLUIDA' | 'INTERROMPIDA' | 'CANCELADA';
  priority: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  requestedByName: string;
  approvedByName: string | null;
  assignedOperatorName: string | null;
  interruptedByName: string | null;
  shiftCode: string;
  operationalDate: string;
  startedAt: string | null;
  finishedAt: string | null;
  interruptedAt: string | null;
  interruptionReason: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  steps: TransferOrderStepItem[];
}

export interface LineSupplyBoardRowView {
  rowKey: string;
  lineCode: string;
  lineName: string;
  materialId: number | null;
  materialCode: string;
  materialDescription: string;
  feedingSilos: Array<{
    siloId: number;
    siloNumber: number;
    confirmedStockKg: number;
    safeCapacityKg: number;
    availableSpaceKg: number;
    operationalStatus: string;
    validationStatus: string;
  }>;
  currentStockKg: number;
  plannedConsumptionTodayKg: number;
  plannedConsumptionTomorrowKg: number;
  realizedConsumptionKg: number;
  remainingConsumptionKg: number;
  deficitOrSurplusKg: number;
  pendingTransferInboundKg: number;
  confirmedPendingReceiptKg: number;
  needsTransfer: boolean;
  suggestedOriginSiloNumber: number | null;
  suggestedOriginSiloId: number | null;
  suggestedDestinationSiloId: number | null;
  suggestedDestinationSiloNumber: number | null;
  suggestedTransferRuleId: number | null;
  suggestedTransferKg: number;
  hasAuthorizedRouteWithStock: boolean;
  supplyStatus: SupplyVisualColor;
  statusReason: string;
  priorityScore: number;
  priorityLevel: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  hasReliableTimeEstimate: boolean;
  timeEstimateNote: string;
}

export interface SupplyRecommendationView {
  id: number;
  recommendationKey: string;
  headline: string;
  recommendationType: 'TRANSFERIR_SILO' | 'PROGRAMAR_RECEBIMENTO' | 'ABASTECER_SILO' | 'REVISAR_CADASTRO';
  priorityScore: number;
  priorityLevel: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  visualStatus: SupplyVisualColor;
  lineCode: string;
  materialId: number | null;
  materialCode: string;
  materialDescription: string;
  destinationSiloId: number | null;
  destinationSiloNumber: number | null;
  originSiloId: number | null;
  originSiloNumber: number | null;
  transferRuleId: number | null;
  plannedConsumptionKg: number;
  realizedConsumptionKg: number;
  availableStockKg: number;
  deficitKg: number;
  suggestedTransferKg: number | null;
  suggestedLotCode: string | null;
  pendingTransferInboundKg: number;
  confirmedPendingReceiptKg: number;
  actionType: 'CRIAR_TRANSFERENCIA' | 'SOLICITAR_RECEBIMENTO' | 'CONFERIR_DADOS';
  actionLabel: string;
  justification: string;
  priorityBreakdown: string[];
  compatibleAuthorizedRoutes: Array<{
    ruleId: number;
    originSiloId: number;
    originSiloNumber: number;
    originStockKg: number;
    availableForTransferKg: number;
    restrictions: string | null;
  }>;
  blockedOrPendingRoutes: Array<{
    ruleId: number;
    originSiloNumber: number;
    authorizationStatus: RouteAuthStatus;
    reason: string;
  }>;
  decisionStatus: 'PENDENTE' | 'EM_ANALISE' | 'ACEITA' | 'REJEITADA' | 'EXECUTADA';
  decisionNotes: string | null;
  decidedAt: string | null;
  linkedTransferOrderId: number | null;
  analyzedAtIso: string;
}

export interface PriorityWeightsConfigView {
  code: string;
  name: string;
  description: string;
  weightLineStopRisk: number;
  weightStockCoverage: number;
  weightAuthorizedRoute: number;
  weightOriginAvailability: number;
  weightScheduleUrgency: number;
  updatedAt: string;
}

export interface MaterialIntakeRequestView {
  id: number;
  requestCode: string;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  productionLineId: number | null;
  lineCode: string | null;
  targetSiloId: number | null;
  targetSiloNumber: number | null;
  recommendationId: number | null;
  neededQuantityKg: number;
  neededByDate: string;
  priority: string;
  justification: string;
  status: 'ABERTA' | 'ATENDIDA' | 'CANCELADA';
  requestedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionSupplyBoardResponse {
  todayDate: string;
  tomorrowDate: string;
  analyzedAtIso: string;
  boardRows: LineSupplyBoardRowView[];
  recommendations: SupplyRecommendationView[];
  summary: {
    totalRows: number;
    redCount: number;
    orangeCount: number;
    yellowCount: number;
    greenCount: number;
    grayCount: number;
    totalDeficitKg: number;
    totalSuggestedTransferKg: number;
  };
  priorityConfig: PriorityWeightsConfigView;
  intakeRequests: MaterialIntakeRequestView[];
}

export interface GeminiSupplyAdviceResponse {
  explanation: string;
  scenarioComparison: string[];
  divergencesNoted: string[];
  manualGuidance: string;
  warnings: string[];
}

export interface TransferPlanDraftPrefill {
  transferRuleId?: number | null;
  originSiloId: number;
  destinationSiloId: number;
  materialId: number;
  plannedQuantityKg: number;
  lotCode?: string | null;
  priority?: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  recommendationId?: number | null;
  recommendationKey?: string | null;
  notes?: string | null;
}

// =========================================================================
// FASE 5 — RELATÓRIOS, INDICADORES, TURNOS, PASSAGEM E OCORRÊNCIAS
// =========================================================================

export const OCCURRENCE_CATEGORIES = [
  'Falta de matéria-prima',
  'Silo vazio',
  'Silo com capacidade insuficiente',
  'Material incompatível',
  'Problema de transferência',
  'Problema de recebimento',
  'Divergência de estoque',
  'Problema documental',
  'Falha de equipamento',
  'Atraso de veículo',
  'Problema de qualidade',
  'Outros',
] as const;

export type OccurrenceCategory = (typeof OCCURRENCE_CATEGORIES)[number];

export type PeriodPreset =
  | 'HOJE'
  | 'ONTEM'
  | 'ULTIMOS_7_DIAS'
  | 'ULTIMOS_30_DIAS'
  | 'MES_ATUAL'
  | 'PERSONALIZADO';

export type ReportTypeCode =
  | 'INDICADORES'
  | 'RECEBIMENTOS'
  | 'ESTOQUE'
  | 'POSICAO_HISTORICA'
  | 'TRANSFERENCIAS'
  | 'CONSUMO'
  | 'DESEMPENHO'
  | 'TURNO'
  | 'RUBRICAGEM_DIARIA';

export interface ReportFilterParams {
  preset?: PeriodPreset;
  startDate?: string;
  endDate?: string;
  shiftCode?: string;
  materialId?: number | null;
  siloId?: number | null;
  lineCode?: string;
  supplierName?: string;
  lotCode?: string;
  status?: string;
  onlyPartial?: boolean;
  onlyPending?: boolean;
  onlyPendingComparison?: boolean;
  historicalDate?: string;
  cutoffMode?: 'OPERATIONAL_DATE' | 'TIMESTAMP';
  groupBy?: 'SILO' | 'MATERIAL' | 'LINHA' | 'GRUPO';
}

export interface PerformanceTargetItem {
  id: number;
  code: string;
  metricKey: string;
  label: string;
  targetValue: number;
  unit: string;
  targetPeriod: 'DIARIO' | 'SEMANAL' | 'MENSAL';
  effectiveFromDate: string;
  notes: string | null;
  isActive: boolean;
  updatedByName: string | null;
  updatedAt: string;
}

export interface PerformanceKpiSummary {
  periodStart: string;
  periodEnd: string;
  receivedVolumeKg: number;
  distributedVolumeKg: number;
  transferredVolumeKg: number;
  receiptsCount: number;
  completedReceiptsCount: number;
  partialDischargesCount: number;
  occurrencesCount: number;
  openOccurrencesCount: number;
  avgReceiptDurationMinutes: number | null;
  avgReceiptDurationSampleSize: number;
  avgReceiptDurationNote: string;
  divergencesFrequency: number;
  shortageAlertsFrequency: number;
  plannedConsumptionKg: number;
  realizedConsumptionKg: number | null;
  consumptionVarianceKg: number | null;
  realizedSampleCount: number;
  consumptionComparisonNote: string;
  historicalBaselineNotice: string;
  dataOrigin: string;
}

export interface OperationalIndicatorsOverview {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAtIso: string;
  dataOrigin: string;
  indicators: {
    totalConfirmedStockKg: number;
    registeredMaterialsCount: number;
    occupiedSilosCount: number;
    availableSilosCount: number;
    totalSilosCount: number;
    completedReceiptsCount: number;
    receivedVolumeKg: number;
    transfersCompletedCount: number;
    transferredVolumeKg: number;
    pendingPartialDischargesCount: number;
    pendingSupplyRequestsCount: number;
    activeAlertsCount: number;
    openOccurrencesCount: number;
    importedSchedulesCount: number;
    atRiskMaterialsCount: number;
  };
  performanceKpis: PerformanceKpiSummary;
  futureTargets: PerformanceTargetItem[];
  recentSnapshots: ReportSnapshotItem[];
}

export interface ReceivingReportRow {
  id: number;
  receiptNumber: string;
  entryDate: string;
  operationalDate: string;
  shiftCode: string;
  startedAt: string;
  finishedAt: string | null;
  durationMinutes: number | null;
  supplierName: string;
  invoiceNumber: string | null;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  lotCode: string;
  receivingType: string;
  receivedQuantityKg: number;
  distributedQuantityKg: number;
  pendingQuantityKg: number;
  unit: string;
  bagCount: number | null;
  bagUnitWeightKg: number | null;
  destinationSilosText: string;
  operatorName: string;
  status: string;
  notes: string | null;
}

export interface ReceivingReportResponse {
  periodStart: string;
  periodEnd: string;
  dataOrigin: string;
  totals: {
    count: number;
    receivedKg: number;
    distributedKg: number;
    pendingKg: number;
    partialCount: number;
    pendingCount: number;
    completedCount: number;
  };
  rows: ReceivingReportRow[];
}

export interface StockReportRow {
  siloId: number;
  siloNumber: number;
  category: string;
  lineCode: string;
  lineName: string;
  controlOwner: string;
  materialId: number | null;
  materialCode: string | null;
  materialDescription: string | null;
  activeLotsText: string;
  confirmedStockKg: number;
  nominalCapacityKg: number;
  safeCapacityKg: number;
  occupancyPercent: number;
  availableSpaceKg: number;
  lastMovementAt: string | null;
  lastValidationOrAuditAt: string | null;
  inboundPeriodKg: number;
  outboundPeriodKg: number;
  transfersInPeriodKg: number;
  transfersOutPeriodKg: number;
  adjustmentsPeriodKg: number;
  operationalStatus: string;
  stockControlModel?: StockControlModel;
  ledgerStockKg?: number;
  lastPhysicalCountKg?: number | null;
  lastPhysicalCountAt?: string | null;
  previousPhysicalCountKg?: number | null;
  previousPhysicalCountAt?: string | null;
  physicalVariationKg?: number | null;
  physicalVariationPct?: number | null;
  rubricagemStatus?: RubricagemWorkflowStatus | null;
  hasDivergence?: boolean;
}

export interface HistoricalStockRow {
  siloId: number;
  siloNumber: number;
  lineCode: string;
  category: string;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  lotCode: string;
  historicalBalanceKg: number;
  movementCountUpToDate: number;
  lastMovementUpToDate: string | null;
}

export interface StockAndHistoricalReportResponse {
  periodStart: string;
  periodEnd: string;
  historicalTargetDate: string;
  cutoffMode: 'OPERATIONAL_DATE' | 'TIMESTAMP';
  dataOrigin: string;
  currentTotals: {
    totalConfirmedStockKg: number;
    totalSafeCapacityKg: number;
    totalFreeSpaceKg: number;
    inboundPeriodKg: number;
    outboundPeriodKg: number;
    transfersPeriodKg: number;
    adjustmentsPeriodKg: number;
  };
  currentRows: StockReportRow[];
  moegaContinuousTotals?: {
    totalConfirmedStockKg: number;
    totalSafeCapacityKg: number;
    totalFreeSpaceKg: number;
    silosCount: number;
    divergenceCount: number;
  };
  moegaContinuousRows?: StockReportRow[];
  producaoPhysicalTotals?: {
    totalConfirmedStockKg: number;
    totalSafeCapacityKg: number;
    totalFreeSpaceKg: number;
    silosCount: number;
    confirmedInventoriesCount: number;
    pendingConfirmationCount: number;
    divergenceCount: number;
  };
  producaoPhysicalRows?: StockReportRow[];
  historicalTotals: {
    targetDate: string;
    totalHistoricalBalanceKg: number;
    movementsEvaluatedCount: number;
    note: string;
  };
  historicalRows: HistoricalStockRow[];
}

export interface TransferReportRow {
  id: number;
  orderCode: string;
  operationalDate: string;
  shiftCode: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  materialCode: string;
  materialDescription: string;
  lotCode: string | null;
  originSiloNumber: number | null;
  destinationSiloNumber: number | null;
  lineCode: string | null;
  plannedQuantityKg: number;
  transferredQuantityKg: number;
  pendingQuantityKg: number;
  operatorName: string;
  requestedByName: string;
  status: string;
  priority: string;
  routeStatus: string;
  interruptionReason: string | null;
  notes: string | null;
}

export interface TransfersReportResponse {
  periodStart: string;
  periodEnd: string;
  dataOrigin: string;
  totals: {
    count: number;
    plannedKg: number;
    transferredKg: number;
    pendingKg: number;
    completedCount: number;
    partialCount: number;
    interruptedCount: number;
    openCount: number;
    canceledCount: number;
  };
  rows: TransferReportRow[];
}

export interface ConsumptionReportRow {
  projectionId: number;
  scheduleCode: string;
  revisionNumber: number;
  referenceDate: string;
  lineCode: string;
  productCode: string;
  productDescription: string;
  materialId: number | null;
  materialCode: string | null;
  materialDescription: string | null;
  plannedConsumptionKg: number;
  realizedConsumptionKg: number | null;
  hasRealizedRecord: boolean;
  varianceKg: number | null;
  realStockKg: number;
  projectedBalanceKg: number;
  calculationStatus: string;
  executionStatus: string;
  originSource: string;
}

export interface ConsumptionReportResponse {
  periodStart: string;
  periodEnd: string;
  dataOrigin: string;
  totals: {
    plannedConsumptionKg: number;
    realizedConsumptionKg: number | null;
    varianceKg: number | null;
    pendingFactorCount: number;
    rowsCount: number;
    realizedRowsCount: number;
  };
  rows: ConsumptionReportRow[];
}

export interface ShiftConfigView {
  id: number;
  code: 'TURNO_1' | 'TURNO_2' | 'TURNO_3';
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  supervisorUserId: number | null;
  supervisorName: string | null;
  responsibleName: string | null;
  operatorIds: number[];
  operators: Array<{ id: number; displayName: string; badgeCode: string | null; roleCode: string }>;
  isValidated: boolean;
  isActive: boolean;
  notes: string | null;
  updatedAt: string;
}

export type ShiftWorkflowStatus =
  | 'EM_ELABORACAO'
  | 'AGUARDANDO_CONFERENCIA'
  | 'AGUARDANDO_APROVACAO'
  | 'APROVADO'
  | 'ENCERRADO';

export interface ShiftVehicleEntryItem {
  receiptId: number;
  receiptNumber: string;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  formattedMaterialName: string;
  supplierName: string;
  invoiceNumber: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  carrierName: string | null;
  receivingType: string;
  bagCount: number | null;
  receivedKg: number;
  distributedInShiftKg: number;
  remainingKg: number;
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
  classification:
    | 'INICIADO_E_FINALIZADO_NO_TURNO'
    | 'INICIADO_TURNO_ANTERIOR_FINALIZADO_AQUI'
    | 'PARCIAL_EM_ANDAMENTO'
    | 'AGUARDANDO_DESCARGA';
  countedInShiftTotal: boolean;
}

export interface ShiftVehicleBreakdown {
  countedVehicles: ShiftVehicleEntryItem[];
  carryoverFinalizedVehicles: ShiftVehicleEntryItem[];
  pendingOrPartialVehicles: ShiftVehicleEntryItem[];
  countedByMaterial: Array<{
    materialDescription: string;
    formattedMaterialName: string;
    count: number;
  }>;
  totalCountedVehicles: number;
}

export interface ShiftManualSupplement {
  id: string;
  timestampIso: string;
  authorUserId: number;
  authorName: string;
  authorBadge: string | null;
  executedByName?: string | null;
  executedByBadge?: string | null;
  category: 'INFORMACAO_OPERACIONAL' | 'CLIMA' | 'MANUTENCAO' | 'OBSERVACAO_TURNO';
  text: string;
}

export interface ShiftHandoverRevisionItem {
  id: number;
  handoverId: number;
  version: number;
  workflowStatus: ShiftWorkflowStatus;
  changeType: string;
  reportText: string;
  aiCommand: string | null;
  reason: string | null;
  editedByUserId: number;
  editedByName: string;
  editedByBadge: string | null;
  createdAt: string;
}

export interface ShiftAutoSummarySnapshot {
  shiftCode: string;
  shiftName: string;
  operationalDate: string;
  generatedAtIso: string;
  receiptsCount: number;
  receivedKg: number;
  distributedKg: number;
  vehiclesOrInvoices: string[];
  materialsReceived: Array<{ code: string; description: string; kg: number }>;
  silosFed: Array<{ siloNumber: number; kg: number; materialCode: string }>;
  transfersCompletedCount: number;
  transfersCompletedKg: number;
  transfersPendingCount: number;
  transfersPendingCodes: string[];
  partialDischargesCount: number;
  partialReceiptNumbers: string[];
  criticalStocks: Array<{ materialCode: string; description: string; realStockKg: number; minStockKg: number }>;
  updatedSchedules: Array<{ scheduleCode: string; revisionNumber: number; status: string }>;
  activeAlertsCount: number;
  activeAlertsList: string[];
  openSupplyRequestsCount: number;
  openOccurrencesCount: number;
  openOccurrencesList: string[];
  unavailableSilos: Array<{ siloNumber: number; operationalStatus: string; restrictions: string | null }>;
  chronologicalEvents: Array<{ timestampIso: string; timeLabel: string; category: string; summary: string }>;
  vehicleBreakdown?: ShiftVehicleBreakdown;
  shiftOperators?: Array<{ displayName: string; badgeCode: string | null; jobTitle: string | null }>;
  stockAdjustmentsCount?: number;
  stockAdjustmentsSummary?: string[];
  bagCutCount?: number;
  basketUpdates?: Array<{ versionCode: string; label: string; productionDate: string; status: string }>;
  shiftOccurrences?: Array<{
    occurrenceCode: string;
    timeLabel: string;
    category: string;
    title: string;
    description: string;
    status: string;
    weatherCondition: string | null;
    lineImpact: string | null;
    verifiedByName: string | null;
    reportedByName: string;
  }>;
  movementsTotalCount?: number;
}

export interface ShiftHandoverPendencyView {
  id: number;
  pendencyCode: string;
  handoverId: number;
  handoverCode: string;
  shiftCode: string;
  operationalDate: string;
  sourceType: string;
  sourceEntityId: string | null;
  title: string;
  description: string;
  priority: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  status: 'ABERTA' | 'CIENTE' | 'RESOLVIDA';
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  acknowledgmentNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
}

export interface ShiftHandoverView {
  id: number;
  handoverCode: string;
  shiftCode: string;
  shiftName: string;
  operationalDate: string;
  status: 'RASCUNHO' | 'REVISAO' | 'FINALIZADA';
  workflowStatus?: ShiftWorkflowStatus;
  autoSummary: ShiftAutoSummarySnapshot;
  shiftSummaryText: string;
  relevantOccurrencesText: string;
  pendenciesText: string;
  requiredActionsText: string;
  nextShiftRecommendationsText: string;
  autoReportText: string;
  editedReportText: string | null;
  supplements?: ShiftManualSupplement[];
  vehicleBreakdown?: ShiftVehicleBreakdown | null;
  aiEditCount?: number;
  lastAiCommand?: string | null;
  handoverByUserId: number;
  handoverByName: string;
  handoverByBadge?: string | null;
  receivedByUserId: number | null;
  receivedByName: string | null;
  reviewedByName: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  approvalNotes?: string | null;
  finalizedByName: string | null;
  finalizedAt: string | null;
  closedAt?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  pendencies: ShiftHandoverPendencyView[];
  revisions?: ShiftHandoverRevisionItem[];
}

export interface ShiftManagerialReportRow {
  handoverId: number | null;
  handoverCode: string;
  shiftCode: string;
  shiftName: string;
  operationalDate: string;
  workflowStatus: ShiftWorkflowStatus;
  legacyStatus: string;
  handoverByName: string;
  handoverByBadge: string | null;
  receivedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  unloadedVehiclesCount: number;
  carryoverVehiclesCount: number;
  partialVehiclesCount: number;
  receivedKg: number;
  distributedKg: number;
  transferredKg: number;
  occurrencesCount: number;
  openOccurrencesCount: number;
  pendenciesCount: number;
  openPendenciesCount: number;
  version: number;
  reportText: string;
  silosUsed: number[];
  materialsMoved: string[];
  updatedAt: string;
}

export interface ShiftManagerialReportResponse {
  periodStart: string;
  periodEnd: string;
  dataOrigin: string;
  totals: {
    shiftsCount: number;
    approvedOrClosedCount: number;
    totalUnloadedVehicles: number;
    totalCarryoverFinalizedVehicles: number;
    totalReceivedKg: number;
    totalDistributedKg: number;
    totalTransferredKg: number;
    totalOccurrences: number;
    totalOpenPendencies: number;
  };
  rows: ShiftManagerialReportRow[];
}

export interface OccurrenceEvidenceItem {
  name: string;
  mimeType?: string;
  dataUrlOrNote: string;
}

export interface OccurrenceItem {
  id: number;
  occurrenceCode: string;
  category: OccurrenceCategory | string;
  title: string;
  description: string;
  occurredAt: string;
  siloId: number | null;
  siloNumber: number | null;
  materialId: number | null;
  materialCode: string | null;
  materialDescription: string | null;
  productionLineId: number | null;
  lineCode: string | null;
  reportedByUserId: number;
  reportedByName: string;
  reportedByBadge?: string | null;
  executedByName?: string | null;
  executedByBadge?: string | null;
  assignedToUserId: number | null;
  assignedToName: string | null;
  shiftCode: string;
  operationalDate: string;
  priority: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';
  weatherCondition?: string | null;
  lineImpact?: string | null;
  evidence: OccurrenceEvidenceItem[];
  status: 'ABERTA' | 'EM_ANDAMENTO' | 'ENCERRADA';
  solutionApplied: string | null;
  verifiedByName?: string | null;
  verifiedAt?: string | null;
  verificationNotes?: string | null;
  closedByName: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSnapshotItem {
  id: number;
  snapshotCode: string;
  reportType: string;
  title: string;
  format: 'VISUALIZACAO' | 'PDF' | 'XLSX' | 'CSV';
  periodStart: string | null;
  periodEnd: string | null;
  filtersJson: string;
  totalsJson: string;
  dataOrigin: string;
  version: number;
  generatedByName: string;
  createdAt: string;
}

export interface NexoAssistantResponse {
  answer: string;
  periodConsulted: string;
  dataOrigin: string;
  lastUpdatedIso: string;
  missingDataNotes: string[];
  suggestedNavigation?: NavSectionId | null;
  usedAiModel: string | null;
}

export type PresentationViewMode = 'CENARIO_REALISTA' | 'BANCO_AO_VIVO';

export interface PresentationLiveCounts {
  silos: number;
  materials: number;
  suppliers: number;
  bagConfigs: number;
  transferRules: number;
  activeTransferRules: number;
  pendenciesPending: number;
  helpArticles: number;
  receipts: number;
  movements: number;
  transferOrders: number;
  schedules: number;
  occurrences: number;
  handovers: number;
  intakeRequests: number;
  labelScans: number;
  auditEvents: number;
  totalRealStockKg: number;
  totalNominalCapacityKg: number;
  totalSafeCapacityKg: number;
}

export interface PresentationBootstrapPayload {
  generatedAtIso: string;
  dataSource: 'POSTGRESQL_READONLY_SYNC';
  activeShift: ShiftInfo;
  lines: Array<{ id: number; code: string; name: string; category: string }>;
  materials: MaterialItem[];
  suppliers: SupplierItem[];
  bagConfigs: MaterialBagConfigItem[];
  silos: SiloDetail[];
  transferRules: TransferRuleItem[];
  routes: AuthorizedRouteItem[];
  pendencies: ValidationPendency[];
  helpArticles: HelpArticleItem[];
  scheduleTemplates: ScheduleTemplateItem[];
  shifts: ShiftConfigView[];
  products: ProductWithFactorsItem[];
  thresholds: StockThresholdItem[];
  liveCounts: PresentationLiveCounts;
  liveSnapshot: {
    receipts: ReceiptItem[];
    movements: InventoryMovementItem[];
    transferOrders: TransferOrderItem[];
    schedules: ProductionScheduleView[];
    supplyBoard: ProductionSupplyBoardResponse;
    intelligenceSummary: IntelligenceSummaryResponse;
    occurrences: OccurrenceItem[];
    handovers: ShiftHandoverView[];
    openShiftPendencies: ShiftHandoverPendencyView[];
    performanceTargets: PerformanceTargetItem[];
    recentSnapshots: ReportSnapshotItem[];
  };
  consumptionTrend?: ConsumptionTrendResponse;
  basketVersions?: BasketVersionView[];
  basketComparisons?: BasketComparisonView[];
  rubricagemBatches?: RubricagemBatchView[];
}

export interface ConsumptionTrendPoint {
  date: string;
  dateLabel: string;
  plannedKg: number;
  realizedKg: number;
  plannedTons: number;
  realizedTons: number;
  varianceTons: number;
}

export interface ConsumptionTrendMaterialOption {
  materialId: number;
  materialCode: string;
  materialDescription: string;
  totalPlannedTons: number;
  totalRealizedTons: number;
}

export interface ConsumptionTrendResponse {
  days: number;
  startDate: string;
  endDate: string;
  lineCode: string;
  materialId: number | null;
  dataOrigin: string;
  totals: {
    plannedTons: number;
    realizedTons: number;
    adherencePercent: number | null;
    peakDayLabel: string | null;
    peakPlannedTons: number;
  };
  availableLines: string[];
  availableMaterials: ConsumptionTrendMaterialOption[];
  series: ConsumptionTrendPoint[];
}

export type BasketSourceType =
  | 'CAMERA_TABLET'
  | 'ARQUIVO_IMAGEM'
  | 'ARQUIVO_PDF'
  | 'ARQUIVO_XLSX'
  | 'ARQUIVO_CSV'
  | 'MANUAL';

export type BasketVersionStatus = 'RASCUNHO' | 'CONFERIDA' | 'PUBLICADA' | 'ARQUIVADA';

export type BasketDiffClassification =
  | 'AUMENTOU'
  | 'DIMINUIU'
  | 'MANTIDO'
  | 'NOVO_MATERIAL'
  | 'MATERIAL_RETIRADO'
  | 'PENDENTE_CONFERENCIA';

export interface BasketSourcePageMeta {
  pageNumber: number;
  fileName: string;
  mimeType: string;
  previewDataUrl?: string | null;
}

export interface BasketItemView {
  id: number;
  basketVersionId: number;
  productionDate: string;
  lineCode: string;
  materialId: number | null;
  materialCode: string | null;
  materialDescription: string;
  rawQuantityText: string | null;
  plannedQuantityKg: number | null;
  unit: string;
  sourcePage: number;
  sourceDocumentName: string | null;
  sourceRegion: string | null;
  confidence: 'ALTA' | 'MEDIA' | 'BAIXA';
  needsReview: boolean;
  reviewReason: string | null;
  manuallyEdited: boolean;
  editedByName: string | null;
}

export interface BasketVersionView {
  id: number;
  versionCode: string;
  label: string;
  productionDate: string;
  emissionTime: string | null;
  sequenceOrder: number;
  sourceType: BasketSourceType;
  status: BasketVersionStatus;
  isCurrentPublished: boolean;
  linkedScheduleId: number | null;
  sourcePages: BasketSourcePageMeta[];
  unreadableFields: string[];
  createdByName: string;
  publishedByName: string | null;
  publishedAt: string | null;
  notes: string | null;
  createdAt: string;
  items: BasketItemView[];
}

export interface BasketDiffItemView {
  id: number;
  comparisonId: number;
  productionDate: string;
  lineCode: string;
  materialId: number | null;
  materialCode: string | null;
  materialDescription: string;
  previousQuantityKg: number | null;
  newQuantityKg: number | null;
  diffKg: number | null;
  pctChange: number | null;
  unit: string;
  classification: BasketDiffClassification;
  previousSourceRef: string | null;
  newSourceRef: string | null;
  needsReview: boolean;
  reviewReason: string | null;
}

export interface BasketLineSummaryView {
  lineCode: string;
  previousTotalKg: number;
  newTotalKg: number;
  diffKg: number;
  pctChange: number | null;
  increasedCount: number;
  decreasedCount: number;
  newCount: number;
  removedCount: number;
  unchangedCount: number;
  pendingCount: number;
}

export interface BasketOperationalImpactView {
  lineCode: string;
  materialId: number | null;
  materialCode: string | null;
  materialDescription: string;
  newPlannedKg: number;
  diffKg: number;
  compatibleSilosCount: number;
  compatibleSiloNumbers: number[];
  confirmedStockKg: number;
  safeCapacityKg: number;
  freeSpaceKg: number;
  pendingReceiptsKg: number;
  projectedBalanceKg: number;
  occupancyAfterPlannedPct: number | null;
  shortageRisk: 'CRITICO' | 'ATENCAO' | 'OK' | 'SEM_SILO_COMPATIVEL';
  suggestedTransferOriginSilos: number[];
  recommendationText: string;
}

export interface BasketComparisonView {
  id: number;
  comparisonCode: string;
  productionDate: string;
  baseVersionId: number;
  baseVersionLabel: string;
  baseEmissionTime: string | null;
  targetVersionId: number;
  targetVersionLabel: string;
  targetEmissionTime: string | null;
  status: 'CONFERENCIA' | 'COMPARADA' | 'PUBLICADA';
  totalPreviousKg: number;
  totalNewKg: number;
  totalDiffKg: number;
  pctChange: number | null;
  counts: {
    totalMaterials: number;
    increased: number;
    decreased: number;
    unchanged: number;
    added: number;
    removed: number;
    pendingReview: number;
  };
  lineSummaries: BasketLineSummaryView[];
  diffItems: BasketDiffItemView[];
  topIncreases: BasketDiffItemView[];
  topDecreases: BasketDiffItemView[];
  operationalImpacts: BasketOperationalImpactView[];
  createdByName: string;
  publishedByName: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface BasketExtractResponse {
  productionDate: string | null;
  emissionTime: string | null;
  documentTitle: string | null;
  unreadableFields: string[];
  usedAiModel: string | null;
  items: Array<
    Omit<BasketItemView, 'id' | 'basketVersionId' | 'manuallyEdited' | 'editedByName'>
  >;
}

export interface BasketNotificationEvent {
  type: 'basket:published';
  comparisonId: number;
  comparisonCode: string;
  productionDate: string;
  baseVersionLabel: string;
  targetVersionLabel: string;
  totalDiffKg: number;
  criticalImpactsCount: number;
  publishedByName: string;
  publishedAt: string;
  summaryHighlights: string[];
}

export interface SiloVolumeHistory24hPoint {
  hourIso: string;
  hourLabel: string;
  volumeKg: number;
  volumeTons: number;
  inboundKg: number;
  outboundKg: number;
  inboundTons: number;
  outboundTons: number;
  netDeltaKg: number;
  movementCount: number;
}

export interface SiloVolumeHistory24hResponse {
  generatedAtIso: string;
  windowHours: 24;
  siloId: number | null;
  materialId: number | null;
  category: string;
  dataOrigin: string;
  totals: {
    currentVolumeKg: number;
    currentVolumeTons: number;
    inbound24hKg: number;
    outbound24hKg: number;
    netChange24hKg: number;
    totalMovements24h: number;
    peakMovementHourLabel: string | null;
    silosIncludedCount: number;
  };
  series: SiloVolumeHistory24hPoint[];
}

export interface MaterialThresholdAlertItem {
  thresholdId: number;
  materialId: number;
  materialCode: string;
  materialDescription: string;
  scope: 'MATERIAL' | 'SILO';
  siloId: number | null;
  siloNumber: number | null;
  currentStockKg: number;
  minStockKg: number;
  warningStockKg: number;
  severity: 'CRITICO' | 'ATENCAO' | 'NORMAL';
  affectedSiloNumbers: number[];
  message: string;
}

// =========================================================================
// RUBRICAGEM DIÁRIA & CONTROLE SEPARADO MOEGA (CONTÍNUO) x PRODUÇÃO (FÍSICO)
// =========================================================================

export interface RubricagemParsedRowInput {
  siloNumber: number;
  quantityValue: number;
  unit: 't' | 'kg';
  rawCordaMeters?: number | null;
  materialHint?: string | null;
  rawText?: string | null;
  confidence?: 'ALTA' | 'MEDIA' | 'BAIXA' | 'MANUAL';
  needsReview?: boolean;
  notes?: string | null;
}

export interface RubricagemPhotoParseResponse {
  documentDateHint: string | null;
  unreadableNotes: string[];
  usedAiModel: string | null;
  entries: Array<
    RubricagemParsedRowInput & {
      siloId: number | null;
      controlOwner: 'MOEGA' | 'PRODUCAO' | null;
      stockControlModel: StockControlModel | null;
      lineCode: string | null;
      category: string | null;
      materialCode: string | null;
      materialDescription: string | null;
      countedQuantityKg: number;
      currentReferenceKg: number;
      ledgerStockKg: number;
      lastPhysicalCountKg: number | null;
      lastPhysicalCountAt: string | null;
    }
  >;
}

export interface RubricagemEntryView {
  id: number;
  batchId: number;
  siloId: number;
  siloNumber: number;
  lineCode: string;
  category: string;
  controlOwnerAtCapture: 'MOEGA' | 'PRODUCAO';
  stockModel: StockControlModel;
  materialIdSnapshot: number | null;
  materialCodeSnapshot: string | null;
  materialDescriptionSnapshot: string | null;
  previousConfirmedKg: number | null;
  previousCountAt: string | null;
  systemLedgerKg: number;
  intermediateMovementsKg: number;
  countedQuantityKg: number;
  countedUnit: 'kg' | 't';
  rawCordaMeters: number | null;
  deltaPhysicalKg: number | null;
  deltaPhysicalPct: number | null;
  deltaVsSystemKg: number;
  hasDivergence: boolean;
  divergenceReason: string | null;
  itemWorkflowStatus: RubricagemWorkflowStatus;
  occurrenceId: number | null;
  authorizedAdjustmentMovementId: number | null;
  confidence: 'ALTA' | 'MEDIA' | 'BAIXA' | 'MANUAL';
  needsReview: boolean;
  notes: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

export interface RubricagemBatchView {
  id: number;
  batchCode: string;
  referenceDate: string;
  capturedAt: string;
  sourceType: 'FOTO_FOLHA_UNICA' | 'UPLOAD_PLANILHA' | 'MANUAL';
  fileName: string | null;
  mimeType: string | null;
  sourceImageDataUrl: string | null;
  workflowStatus: RubricagemWorkflowStatus;
  moegaCount: number;
  producaoCount: number;
  divergenceCount: number;
  notes: string | null;
  importedByUserId: number;
  importedByName: string;
  authorizedByName: string | null;
  authorizedAt: string | null;
  authorizationReason: string | null;
  supersededByBatchId: number | null;
  createdAt: string;
  updatedAt: string;
  entries: RubricagemEntryView[];
}

export interface DailyRubricagemComparisonRow {
  siloId: number;
  siloNumber: number;
  rubricOrder: number;
  lineCode: string;
  category: string;
  controlOwner: 'MOEGA' | 'PRODUCAO';
  stockControlModel: StockControlModel;
  materialCode: string | null;
  materialDescription: string | null;
  activeStockKg: number;
  ledgerStockKg: number;
  previousRubricagemKg: number | null;
  newRubricagemKg: number | null;
  variationKg: number | null;
  variationTons: number | null;
  variationPct: number | null;
  previousCountAt: string | null;
  currentCountAt: string | null;
  deltaVsSystemKg: number | null;
  conferenceStatus: RubricagemWorkflowStatus;
  hasDivergence: boolean;
  divergenceReason: string | null;
  batchCode: string | null;
  occurrenceId: number | null;
}

export interface DailyRubricagemComparisonReport {
  referenceDate: string;
  generatedAtIso: string;
  dataOrigin: string;
  activeBatchSummary: {
    batchId: number;
    batchCode: string;
    capturedAt: string;
    workflowStatus: RubricagemWorkflowStatus;
    moegaCount: number;
    producaoCount: number;
    divergenceCount: number;
    importedByName: string;
    authorizedByName: string | null;
    authorizedAt: string | null;
  } | null;
  moegaContinuousSection: {
    title: string;
    ruleDescription: string;
    totalLedgerStockKg: number;
    totalSafeCapacityKg: number;
    silosCount: number;
    checkedInSheetCount: number;
    divergenceCount: number;
    rows: DailyRubricagemComparisonRow[];
  };
  producaoPhysicalSection: {
    title: string;
    ruleDescription: string;
    totalConfirmedPhysicalKg: number;
    totalSafeCapacityKg: number;
    silosCount: number;
    checkedInSheetCount: number;
    confirmedCount: number;
    pendingAuthorizationCount: number;
    divergenceCount: number;
    rows: DailyRubricagemComparisonRow[];
  };
}


