import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Perfis e Permissões (RBAC)
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // ADMIN | SUPERVISOR | OPERADOR_MOEGA | PRODUCAO
  name: text('name').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  module: text('module').notNull(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: serial('id').primaryKey(),
    roleId: integer('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: integer('permission_id')
      .references(() => permissions.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [uniqueIndex('role_perm_unique_idx').on(table.roleId, table.permissionId)]
);

// 2. Usuários individuais vinculados ao Firebase Auth
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  badgeCode: text('badge_code'),
  jobTitle: text('job_title'),
  department: text('department'),
  roleId: integer('role_id')
    .references(() => roles.id)
    .notNull(),
  defaultShiftCode: text('default_shift_code').default('TURNO_1').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastLoginAt: timestamp('last_login_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 3. Linhas de Produção (L1 a L7)
export const productionLines = pgTable('production_lines', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // L1 .. L7
  name: text('name').notNull(),
  category: text('category').notNull(), // LINHA_PRODUCAO | ARMAZENAGEM
  description: text('description'),
  sortOrder: integer('sort_order').notNull(),
});

// 4. Matérias-primas
export const materials = pgTable('materials', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  description: text('description').notNull(),
  category: text('category').notNull(), // MINERAL | PROTEICO | ENERGETICO | PREMIX | SAL | OUTRO
  handlingType: text('handling_type').notNull(), // GRANEL | BIG_BAG | GRANEL_E_BAG | SACO
  referenceBagWeightKg: numeric('reference_bag_weight_kg', { precision: 10, scale: 2 }),
  bagWeightValidationStatus: text('bag_weight_validation_status')
    .default('NAO_APLICAVEL')
    .notNull(), // VALIDADO | PENDENTE_VALIDACAO | NAO_APLICAVEL
  isCritical: boolean('is_critical').default(false).notNull(),
  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 5. Fornecedores
export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  document: text('document'),
  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Silos (ordem visual da rubricagem preservada sem ordenação numérica)
export const silos = pgTable(
  'silos',
  {
    id: serial('id').primaryKey(),
    siloNumber: integer('silo_number').notNull().unique(),
    rubricOrder: integer('rubric_order').notNull().unique(),
    category: text('category').notNull(), // LINHA | ARMAZENAGEM | PRODUCAO
    controlOwner: text('control_owner').notNull(), // MOEGA | PRODUCAO
    productionLineId: integer('production_line_id')
      .references(() => productionLines.id)
      .notNull(),
    heightMeters: numeric('height_meters', { precision: 6, scale: 2 }),
    cordaMeters: numeric('corda_meters', { precision: 6, scale: 2 }),
    nominalCapacityKg: numeric('nominal_capacity_kg', { precision: 12, scale: 2 }).notNull(),
    safetyFactorPercent: numeric('safety_factor_percent', { precision: 5, scale: 2 })
      .default('10.00')
      .notNull(),
    safeCapacityKg: numeric('safe_capacity_kg', { precision: 12, scale: 2 }).notNull(),
    primaryMaterialId: integer('primary_material_id').references(() => materials.id),
    operationalStatus: text('operational_status').default('OPERACIONAL').notNull(), // OPERACIONAL | MANUTENCAO | LIMPEZA | BLOQUEADO | INATIVO
    cleaningStatus: text('cleaning_status').default('EM_USO').notNull(), // LIMPO | EM_USO | REQUER_LIMPEZA
    isDividedCompartment: boolean('is_divided_compartment').default(false).notNull(),
    restrictions: text('restrictions'),
    validationStatus: text('validation_status').default('VALIDADO').notNull(), // VALIDADO | PENDENTE_VALIDACAO
    validationNotes: text('validation_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('silos_rubric_order_idx').on(table.rubricOrder),
    index('silos_category_idx').on(table.category),
  ]
);

// 7. Compatibilidade Silo x Matéria-Prima
export const siloMaterialCompatibility = pgTable(
  'silo_material_compatibility',
  {
    id: serial('id').primaryKey(),
    siloId: integer('silo_id')
      .references(() => silos.id, { onDelete: 'cascade' })
      .notNull(),
    materialId: integer('material_id')
      .references(() => materials.id, { onDelete: 'cascade' })
      .notNull(),
    isPrimary: boolean('is_primary').default(false).notNull(),
    allowReceiving: boolean('allow_receiving').default(true).notNull(),
    allowTransferIn: boolean('allow_transfer_in').default(true).notNull(),
    allowTransferOut: boolean('allow_transfer_out').default(true).notNull(),
    validationStatus: text('validation_status').default('VALIDADO').notNull(), // VALIDADO | PENDENTE_VALIDACAO
    restrictions: text('restrictions'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('silo_mat_compat_unique_idx').on(table.siloId, table.materialId)]
);

// 8. Regras de Transferência entre Silos (Matriz de Transferências / Rotas Autorizadas)
export const siloTransferRules = pgTable(
  'silo_transfer_rules',
  {
    id: serial('id').primaryKey(),
    originSiloId: integer('origin_silo_id')
      .references(() => silos.id, { onDelete: 'cascade' })
      .notNull(),
    destinationSiloId: integer('destination_silo_id')
      .references(() => silos.id, { onDelete: 'cascade' })
      .notNull(),
    materialId: integer('material_id')
      .references(() => materials.id, { onDelete: 'cascade' })
      .notNull(),
    relatedLineId: integer('related_line_id').references(() => productionLines.id),
    operationType: text('operation_type').default('TRANSFERENCIA_INTERNA').notNull(),
    maxQuantityKg: numeric('max_quantity_kg', { precision: 12, scale: 2 }),
    requiresAuthorization: boolean('requires_authorization').default(false).notNull(),
    authorizationStatus: text('authorization_status').default('PENDENTE_VALIDACAO').notNull(), // AUTORIZADA | PENDENTE_VALIDACAO | SUSPENSA | BLOQUEADA
    validationStatus: text('validation_status').default('PENDENTE_VALIDACAO').notNull(), // VALIDADO | PENDENTE_VALIDACAO | SUSPENSA | BLOQUEADA (retrocompat)
    isActive: boolean('is_active').default(false).notNull(),
    restrictions: text('restrictions'),
    sourceReference: text('source_reference'),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('silo_transfer_rule_unique_idx').on(
      table.originSiloId,
      table.destinationSiloId,
      table.materialId
    ),
  ]
);

// 9. Turnos Operacionais (Configuráveis administrativamente, incluindo travessia de meia-noite)
export const shifts = pgTable('shifts', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // TURNO_1 | TURNO_2 | TURNO_3
  name: text('name').notNull(),
  startTime: text('start_time').notNull(), // HH:mm
  endTime: text('end_time').notNull(), // HH:mm
  crossesMidnight: boolean('crosses_midnight').default(false).notNull(),
  supervisorUserId: integer('supervisor_user_id').references(() => users.id),
  responsibleName: text('responsible_name'),
  operatorIdsJson: text('operator_ids_json').default('[]').notNull(), // JSON number[]
  isValidated: boolean('is_validated').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  notes: text('notes'),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 4B. Configurações de Peso de Big Bags por Produto/Embalagem
export const materialBagConfigs = pgTable(
  'material_bag_configs',
  {
    id: serial('id').primaryKey(),
    materialId: integer('material_id')
      .references(() => materials.id, { onDelete: 'cascade' })
      .notNull(),
    packagingLabel: text('packaging_label').notNull(), // ex.: 'Big Bag Padrão 1.200 kg', 'Big Bag 1.300 kg'
    unitWeightKg: numeric('unit_weight_kg', { precision: 10, scale: 2 }).notNull(),
    validationStatus: text('validation_status').default('PENDENTE_VALIDACAO').notNull(), // VALIDADO | PENDENTE_VALIDACAO
    isDefault: boolean('is_default').default(true).notNull(),
    notes: text('notes'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('mat_bag_cfg_unique_idx').on(table.materialId, table.packagingLabel)]
);

// 10A. Recebimentos de Matéria-Prima (Granel e Big Bag)
export const receipts = pgTable(
  'receipts',
  {
    id: serial('id').primaryKey(),
    receiptNumber: text('receipt_number').notNull().unique(),
    materialId: integer('material_id')
      .references(() => materials.id)
      .notNull(),
    supplierId: integer('supplier_id').references(() => suppliers.id),
    supplierName: text('supplier_name').notNull(),
    invoiceNumber: text('invoice_number'),
    lotCode: text('lot_code').notNull(),
    entryDate: text('entry_date').notNull(), // YYYY-MM-DD
    receivedQuantityKg: numeric('received_quantity_kg', { precision: 12, scale: 3 }).notNull(),
    distributedQuantityKg: numeric('distributed_quantity_kg', { precision: 12, scale: 3 })
      .default('0.000')
      .notNull(),
    unit: text('unit').default('kg').notNull(),
    receivingType: text('receiving_type').notNull(), // GRANEL | BIG_BAG
    bagCount: integer('bag_count'),
    bagUnitWeightKg: numeric('bag_unit_weight_kg', { precision: 10, scale: 2 }),
    receivingPoint: text('receiving_point'), // Cone ou ponto de recebimento
    vehiclePlate: text('vehicle_plate'),
    driverName: text('driver_name'),
    carrierName: text('carrier_name'),
    status: text('status').default('PENDENTE').notNull(), // PENDENTE | PARCIAL | CONCLUIDO | CANCELADO
    operatorUserId: integer('operator_user_id')
      .references(() => users.id)
      .notNull(),
    executedByName: text('executed_by_name'),
    executedByBadge: text('executed_by_badge'),
    shiftCode: text('shift_code').notNull(),
    operationalDate: text('operational_date').notNull(), // YYYY-MM-DD
    startedShiftCode: text('started_shift_code'),
    startedOperationalDate: text('started_operational_date'),
    finishedShiftCode: text('finished_shift_code'),
    finishedOperationalDate: text('finished_operational_date'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
    notes: text('notes'),
    attachmentsJson: text('attachments_json'), // JSON ReceiptAttachmentItem[] (fotos da carga, NF, ticket de balança)
    idempotencyKey: text('idempotency_key').unique(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('receipts_lot_idx').on(table.lotCode),
    index('receipts_status_idx').on(table.status),
    index('receipts_material_idx').on(table.materialId),
  ]
);

// 10. Livro de Movimentações de Estoque (Imutável — Entradas, Saídas, Transferências, Ajustes, Estornos)
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: serial('id').primaryKey(),
    movementType: text('movement_type').notNull(), // ENTRADA | SAIDA | TRANSFERENCIA | AJUSTE_AUTORIZADO | REVERSAO
    siloId: integer('silo_id')
      .references(() => silos.id)
      .notNull(),
    materialId: integer('material_id')
      .references(() => materials.id)
      .notNull(),
    lotCode: text('lot_code'),
    quantityKg: numeric('quantity_kg', { precision: 12, scale: 3 }).notNull(),
    unit: text('unit').default('kg').notNull(),
    direction: text('direction').notNull(), // CREDIT | DEBIT
    referenceDocument: text('reference_document'),
    receiptId: integer('receipt_id').references(() => receipts.id),
    transferOrderId: integer('transfer_order_id'),
    supplierName: text('supplier_name'),
    counterpartSiloId: integer('counterpart_silo_id').references(() => silos.id),
    reversedMovementId: integer('reversed_movement_id'),
    status: text('status').default('CONFIRMADO').notNull(), // CONFIRMADO | ESTORNADO
    reason: text('reason'),
    idempotencyKey: text('idempotency_key').unique(),
    shiftCode: text('shift_code').notNull(),
    operationalDate: text('operational_date').notNull(), // YYYY-MM-DD
    performedByUserId: integer('performed_by_user_id')
      .references(() => users.id)
      .notNull(),
    authorizedByUserId: integer('authorized_by_user_id').references(() => users.id),
    executedByName: text('executed_by_name'),
    executedByBadge: text('executed_by_badge'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('inv_mov_silo_idx').on(table.siloId),
    index('inv_mov_material_idx').on(table.materialId),
    index('inv_mov_lot_idx').on(table.lotCode),
    index('inv_mov_receipt_idx').on(table.receiptId),
  ]
);

// 10B. Distribuições / Rateios por Silo vinculados a um Recebimento
export const receiptDistributions = pgTable(
  'receipt_distributions',
  {
    id: serial('id').primaryKey(),
    receiptId: integer('receipt_id')
      .references(() => receipts.id, { onDelete: 'cascade' })
      .notNull(),
    siloId: integer('silo_id')
      .references(() => silos.id)
      .notNull(),
    quantityKg: numeric('quantity_kg', { precision: 12, scale: 3 }).notNull(),
    bagCount: integer('bag_count'),
    movementId: integer('movement_id').references(() => inventoryMovements.id),
    status: text('status').default('CONFIRMADA').notNull(), // CONFIRMADA | ESTORNADA
    isComplement: boolean('is_complement').default(false).notNull(),
    operatorUserId: integer('operator_user_id')
      .references(() => users.id)
      .notNull(),
    shiftCode: text('shift_code').notNull(),
    operationalDate: text('operational_date').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('rec_dist_receipt_idx').on(table.receiptId),
    index('rec_dist_silo_idx').on(table.siloId),
  ]
);

// 10C. Registro de Leituras de Etiquetas (Código de Barras e Gemini Vision)
export const labelScans = pgTable(
  'label_scans',
  {
    id: serial('id').primaryKey(),
    scanMethod: text('scan_method').notNull(), // BARCODE_CAMERA | BARCODE_SCANNER | PHOTO_GEMINI | MANUAL
    rawBarcode: text('raw_barcode'),
    extractedMaterialCode: text('extracted_material_code'),
    extractedDescription: text('extracted_description'),
    extractedLotCode: text('extracted_lot_code'),
    extractedSupplier: text('extracted_supplier'),
    extractedWeightKg: numeric('extracted_weight_kg', { precision: 12, scale: 3 }),
    extractedEstablishment: text('extracted_establishment'),
    extractedPrintDate: text('extracted_print_date'),
    confidenceNotes: text('confidence_notes'),
    uncertainFields: text('uncertain_fields'), // JSON string[]
    sourceImageDataUrl: text('source_image_data_url'),
    matchedMaterialId: integer('matched_material_id').references(() => materials.id),
    linkedReceiptId: integer('linked_receipt_id').references(() => receipts.id),
    duplicateLotDetected: boolean('duplicate_lot_detected').default(false).notNull(),
    scannedByUserId: integer('scanned_by_user_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('label_scans_lot_idx').on(table.extractedLotCode)]
);

// 11. Pendências de Validação Operacional (divergências entre documentos)
export const validationPendencies = pgTable('validation_pendencies', {
  id: serial('id').primaryKey(),
  entityType: text('entity_type').notNull(), // SILO | MATERIAL | TRANSFER_RULE | BAG_WEIGHT
  entityRef: text('entity_ref').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  sourceA: text('source_a').notNull(),
  sourceB: text('source_b').notNull(),
  status: text('status').default('PENDENTE').notNull(), // PENDENTE | RESOLVIDO
  resolvedByUserId: integer('resolved_by_user_id').references(() => users.id),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

// 12. Trilha de Auditoria Imutável
export const auditEvents = pgTable(
  'audit_events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id),
    userEmail: text('user_email').notNull(),
    userName: text('user_name').notNull(),
    userRole: text('user_role').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    previousValue: text('previous_value'),
    newValue: text('new_value'),
    reason: text('reason'),
    origin: text('origin').default('API_SERVER').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('audit_entity_idx').on(table.entityType, table.entityId),
    index('audit_created_idx').on(table.createdAt),
  ]
);

// 13. Artigos do Guia de Operação (Manual Interativo)
export const helpArticles = pgTable('help_articles', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  module: text('module').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  content: text('content').notNull(),
  sortOrder: integer('sort_order').default(1).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 14. Configurações do Sistema
export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// =========================================================================
// FASE 3 — PROGRAMAÇÃO DA PRODUÇÃO, DOCUMENTOS, CONSUMO E INTELIGÊNCIA
// =========================================================================

// 15. Produtos Acabados / Fórmulas Programadas nas Linhas
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  description: text('description').notNull(),
  defaultProductionLineId: integer('default_production_line_id').references(() => productionLines.id),
  defaultUnit: text('default_unit').default('t').notNull(), // t | kg | batelada
  isActive: boolean('is_active').default(true).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 16. Fatores de Consumo Determinísticos (Produto x Matéria-Prima)
export const productConsumptionFactors = pgTable(
  'product_consumption_factors',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id')
      .references(() => products.id, { onDelete: 'cascade' })
      .notNull(),
    materialId: integer('material_id')
      .references(() => materials.id, { onDelete: 'cascade' })
      .notNull(),
    factorKgPerUnit: numeric('factor_kg_per_unit', { precision: 12, scale: 6 }).notNull(),
    unit: text('unit').default('t').notNull(), // kg de matéria-prima por 1 <unit> do produto
    validationStatus: text('validation_status').default('PENDENTE_VALIDACAO').notNull(), // VALIDADO | PENDENTE_VALIDACAO
    sourceReference: text('source_reference'),
    notes: text('notes'),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('prod_mat_factor_unique_idx').on(table.productId, table.materialId)]
);

// 17. Limites Mínimos e de Atenção de Estoque (por Matéria-Prima e opcionalmente por Silo)
export const materialStockThresholds = pgTable(
  'material_stock_thresholds',
  {
    id: serial('id').primaryKey(),
    materialId: integer('material_id')
      .references(() => materials.id, { onDelete: 'cascade' })
      .notNull(),
    siloId: integer('silo_id').references(() => silos.id, { onDelete: 'cascade' }),
    minStockKg: numeric('min_stock_kg', { precision: 12, scale: 3 }).notNull(),
    warningStockKg: numeric('warning_stock_kg', { precision: 12, scale: 3 }).notNull(),
    notes: text('notes'),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('mat_threshold_mat_idx').on(table.materialId),
    index('mat_threshold_silo_idx').on(table.siloId),
  ]
);

// 18. Modelos Configuráveis de Interpretação Documental (Programação / Sensor Sistemas / Consumo)
export const scheduleDocumentTemplates = pgTable('schedule_document_templates', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  documentCategory: text('document_category').notNull(), // PROGRAMACAO | RELATORIO_PRODUCAO | RELATORIO_CONSUMO | REVISAO
  promptHints: text('prompt_hints').notNull(),
  columnHintsJson: text('column_hints_json'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 19. Documentos Originais Preservados (Fotos, PDFs, Planilhas XLSX/CSV)
export const scheduleDocuments = pgTable('schedule_documents', {
  id: serial('id').primaryKey(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sourceType: text('source_type').notNull(), // FOTO_TABLET | ARQUIVO_PDF | ARQUIVO_IMAGEM | ARQUIVO_XLSX | ARQUIVO_CSV | MANUAL
  documentCategory: text('document_category').notNull(), // PROGRAMACAO | RELATORIO_PRODUCAO | RELATORIO_CONSUMO | REVISAO
  templateId: integer('template_id').references(() => scheduleDocumentTemplates.id),
  fileContentBase64: text('file_content_base64'),
  extractedTextPreview: text('extracted_text_preview'),
  rawAiJson: text('raw_ai_json'),
  uploadedByUserId: integer('uploaded_by_user_id')
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 20. Programações da Produção (Com Versionamento e Histórico de Revisões)
export const productionSchedules = pgTable(
  'production_schedules',
  {
    id: serial('id').primaryKey(),
    scheduleCode: text('schedule_code').notNull().unique(),
    referenceDate: text('reference_date').notNull(), // YYYY-MM-DD
    revisionNumber: integer('revision_number').default(1).notNull(),
    previousScheduleId: integer('previous_schedule_id'),
    documentId: integer('document_id').references(() => scheduleDocuments.id),
    sourceReportType: text('source_report_type').default('PROGRAMACAO').notNull(), // PROGRAMACAO | RELATORIO_PRODUCAO | RELATORIO_CONSUMO | REVISAO
    status: text('status').default('RASCUNHO_CONFERENCIA').notNull(), // RASCUNHO_CONFERENCIA | APROVADA | SUPERSEDED | CANCELADA
    revisionDiffSummary: text('revision_diff_summary'),
    notes: text('notes'),
    importedByUserId: integer('imported_by_user_id')
      .references(() => users.id)
      .notNull(),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('prod_sched_date_idx').on(table.referenceDate),
    index('prod_sched_status_idx').on(table.status),
  ]
);

// 21. Itens Programados por Linha (L1..L7)
export const productionScheduleItems = pgTable(
  'production_schedule_items',
  {
    id: serial('id').primaryKey(),
    scheduleId: integer('schedule_id')
      .references(() => productionSchedules.id, { onDelete: 'cascade' })
      .notNull(),
    productionLineId: integer('production_line_id')
      .references(() => productionLines.id)
      .notNull(),
    sequenceOrder: integer('sequence_order').default(1).notNull(),
    productId: integer('product_id').references(() => products.id),
    productCode: text('product_code').notNull(),
    productDescription: text('product_description').notNull(),
    materialId: integer('material_id').references(() => materials.id),
    materialCode: text('material_code'),
    plannedQuantity: numeric('planned_quantity', { precision: 12, scale: 3 }).notNull(),
    plannedUnit: text('planned_unit').default('t').notNull(), // t | kg | batelada
    scheduledTimeWindow: text('scheduled_time_window'),
    executionStatus: text('execution_status').default('NAO_INICIADA').notNull(), // NAO_INICIADA | EM_ANDAMENTO | CONCLUIDA | ATRASADA | ADIANTADA | INTERROMPIDA
    realizedQuantity: numeric('realized_quantity', { precision: 12, scale: 3 })
      .default('0.000')
      .notNull(),
    extractionConfidence: text('extraction_confidence').default('MANUAL').notNull(), // ALTA | MEDIA | BAIXA | MANUAL
    needsReview: boolean('needs_review').default(false).notNull(),
    reviewReason: text('review_reason'),
    notes: text('notes'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('sched_items_sched_idx').on(table.scheduleId),
    index('sched_items_line_idx').on(table.productionLineId),
  ]
);

// 22. Projeções Determinísticas de Consumo por Item e Matéria-Prima
export const productionConsumptionProjections = pgTable(
  'production_consumption_projections',
  {
    id: serial('id').primaryKey(),
    scheduleId: integer('schedule_id')
      .references(() => productionSchedules.id, { onDelete: 'cascade' })
      .notNull(),
    scheduleItemId: integer('schedule_item_id')
      .references(() => productionScheduleItems.id, { onDelete: 'cascade' })
      .notNull(),
    productionLineId: integer('production_line_id')
      .references(() => productionLines.id)
      .notNull(),
    referenceDate: text('reference_date').notNull(),
    materialId: integer('material_id').references(() => materials.id),
    factorId: integer('factor_id').references(() => productConsumptionFactors.id),
    factorUsed: numeric('factor_used', { precision: 12, scale: 6 }),
    plannedProductQty: numeric('planned_product_qty', { precision: 12, scale: 3 }).notNull(),
    calculatedConsumptionKg: numeric('calculated_consumption_kg', {
      precision: 12,
      scale: 3,
    }).notNull(),
    realizedConsumptionKg: numeric('realized_consumption_kg', { precision: 12, scale: 3 })
      .default('0.000')
      .notNull(),
    calculationStatus: text('calculation_status').notNull(), // CALCULADO | PENDENTE_FATOR
    originSource: text('origin_source').notNull(), // FATOR_PRODUTO_VALIDADO | MATERIA_PRIMA_DIRETA | FATOR_AUSENTE_OU_PENDENTE
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('cons_proj_sched_idx').on(table.scheduleId),
    index('cons_proj_mat_idx').on(table.materialId),
    index('cons_proj_date_idx').on(table.referenceDate),
  ]
);

// 23. Sugestões Operacionais e Registro de Decisão (Aceite/Rejeição)
export const operationalRecommendations = pgTable(
  'operational_recommendations',
  {
    id: serial('id').primaryKey(),
    recommendationKey: text('recommendation_key').notNull().unique(),
    referenceDate: text('reference_date').notNull(),
    recommendationType: text('recommendation_type').notNull(), // ABASTECER_SILO | TRANSFERIR_SILO | PROGRAMAR_RECEBIMENTO | REVISAR_FATOR
    priority: text('priority').notNull(), // VERMELHO | LARANJA | AZUL | VERDE
    title: text('title').notNull(),
    reason: text('reason').notNull(),
    materialId: integer('material_id').references(() => materials.id),
    productionLineId: integer('production_line_id').references(() => productionLines.id),
    targetSiloId: integer('target_silo_id').references(() => silos.id),
    originSiloId: integer('origin_silo_id').references(() => silos.id),
    requiredKg: numeric('required_kg', { precision: 12, scale: 3 }).default('0.000').notNull(),
    availableKg: numeric('available_kg', { precision: 12, scale: 3 }).default('0.000').notNull(),
    missingKg: numeric('missing_kg', { precision: 12, scale: 3 }).default('0.000').notNull(),
    suggestedTransferKg: numeric('suggested_transfer_kg', { precision: 12, scale: 3 }),
    dataSourceSummary: text('data_source_summary').notNull(),
    priorityScore: integer('priority_score').default(0).notNull(),
    linkedTransferOrderId: integer('linked_transfer_order_id'),
    decisionStatus: text('decision_status').default('PENDENTE').notNull(), // PENDENTE | EM_ANALISE | ACEITA | REJEITADA | EXECUTADA
    decidedByUserId: integer('decided_by_user_id').references(() => users.id),
    decisionNotes: text('decision_notes'),
    decidedAt: timestamp('decided_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('op_rec_date_idx').on(table.referenceDate)]
);

// =========================================================================
// FASE 4 — INTELIGÊNCIA DE TRANSFERÊNCIAS, ABASTECIMENTO E OTIMIZAÇÃO
// =========================================================================

// 24. Ordens / Solicitações Planejadas de Transferência entre Silos (Suporte Parcial e Rastreio)
export const transferOrders = pgTable(
  'transfer_orders',
  {
    id: serial('id').primaryKey(),
    orderCode: text('order_code').notNull().unique(),
    transferRuleId: integer('transfer_rule_id')
      .references(() => siloTransferRules.id)
      .notNull(),
    originSiloId: integer('origin_silo_id')
      .references(() => silos.id)
      .notNull(),
    destinationSiloId: integer('destination_silo_id')
      .references(() => silos.id)
      .notNull(),
    materialId: integer('material_id')
      .references(() => materials.id)
      .notNull(),
    productionLineId: integer('production_line_id').references(() => productionLines.id),
    recommendationId: integer('recommendation_id').references(() => operationalRecommendations.id),
    lotCode: text('lot_code'), // Lote indicado ou 'MISTO' quando houver composição de múltiplos lotes
    plannedQuantityKg: numeric('planned_quantity_kg', { precision: 12, scale: 3 }).notNull(),
    transferredQuantityKg: numeric('transferred_quantity_kg', { precision: 12, scale: 3 })
      .default('0.000')
      .notNull(),
    status: text('status').default('PLANEJADA').notNull(), // PLANEJADA | EM_ANDAMENTO | PARCIAL | CONCLUIDA | INTERROMPIDA | CANCELADA
    priority: text('priority').default('MEDIA').notNull(), // CRITICA | ALTA | MEDIA | BAIXA
    requestedByUserId: integer('requested_by_user_id')
      .references(() => users.id)
      .notNull(),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    assignedOperatorUserId: integer('assigned_operator_user_id').references(() => users.id),
    interruptedByUserId: integer('interrupted_by_user_id').references(() => users.id),
    shiftCode: text('shift_code').notNull(),
    operationalDate: text('operational_date').notNull(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    interruptedAt: timestamp('interrupted_at'),
    interruptionReason: text('interruption_reason'),
    notes: text('notes'),
    idempotencyKey: text('idempotency_key').unique(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('trf_orders_status_idx').on(table.status),
    index('trf_orders_origin_idx').on(table.originSiloId),
    index('trf_orders_dest_idx').on(table.destinationSiloId),
  ]
);

// 25. Etapas Executadas (Parciais / Finais) de Transferência com Composição de Lotes
export const transferExecutionSteps = pgTable(
  'transfer_execution_steps',
  {
    id: serial('id').primaryKey(),
    transferOrderId: integer('transfer_order_id')
      .references(() => transferOrders.id, { onDelete: 'cascade' })
      .notNull(),
    stepNumber: integer('step_number').notNull(),
    quantityKg: numeric('quantity_kg', { precision: 12, scale: 3 }).notNull(),
    lotCompositionJson: text('lot_composition_json').notNull(), // Array<{ lotCode: string | null; quantityKg: number }>
    referenceDocument: text('reference_document').notNull(),
    debitMovementId: integer('debit_movement_id').references(() => inventoryMovements.id),
    creditMovementId: integer('credit_movement_id').references(() => inventoryMovements.id),
    executedByUserId: integer('executed_by_user_id')
      .references(() => users.id)
      .notNull(),
    executedByName: text('executed_by_name'),
    executedByBadge: text('executed_by_badge'),
    shiftCode: text('shift_code').notNull(),
    operationalDate: text('operational_date').notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at').defaultNow().notNull(),
    notes: text('notes'),
    status: text('status').default('CONFIRMADA').notNull(), // CONFIRMADA | ESTORNADA
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('trf_steps_order_idx').on(table.transferOrderId)]
);

// 26. Critérios Configuráveis de Priorização Operacional
export const operationalPriorityConfigs = pgTable('operational_priority_configs', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  weightLineStopRisk: integer('weight_line_stop_risk').default(40).notNull(),
  weightStockCoverage: integer('weight_stock_coverage').default(25).notNull(),
  weightAuthorizedRoute: integer('weight_authorized_route').default(15).notNull(),
  weightOriginAvailability: integer('weight_origin_availability').default(10).notNull(),
  weightScheduleUrgency: integer('weight_schedule_urgency').default(10).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 27. Solicitações de Recebimento / Compra geradas a partir de Déficits sem Transferência
export const materialIntakeRequests = pgTable(
  'material_intake_requests',
  {
    id: serial('id').primaryKey(),
    requestCode: text('request_code').notNull().unique(),
    materialId: integer('material_id')
      .references(() => materials.id)
      .notNull(),
    productionLineId: integer('production_line_id').references(() => productionLines.id),
    targetSiloId: integer('target_silo_id').references(() => silos.id),
    recommendationId: integer('recommendation_id').references(() => operationalRecommendations.id),
    neededQuantityKg: numeric('needed_quantity_kg', { precision: 12, scale: 3 }).notNull(),
    neededByDate: text('needed_by_date').notNull(),
    priority: text('priority').default('ALTA').notNull(),
    justification: text('justification').notNull(),
    status: text('status').default('ABERTA').notNull(), // ABERTA | ATENDIDA | CANCELADA
    requestedByUserId: integer('requested_by_user_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('mat_intake_status_idx').on(table.status)]
);

// =========================================================================
// FASE 5 — RELATÓRIOS, INDICADORES, TURNOS, PASSAGEM E OCORRÊNCIAS
// =========================================================================

// 28. Passagem de Turno (Rascunho, Revisão, Finalizada — Histórico Imutável)
export const shiftHandovers = pgTable(
  'shift_handovers',
  {
    id: serial('id').primaryKey(),
    handoverCode: text('handover_code').notNull().unique(),
    shiftCode: text('shift_code').notNull(),
    shiftName: text('shift_name').notNull(),
    operationalDate: text('operational_date').notNull(), // YYYY-MM-DD
    status: text('status').default('RASCUNHO').notNull(), // RASCUNHO | REVISAO | FINALIZADA (retrocompat)
    workflowStatus: text('workflow_status').default('EM_ELABORACAO').notNull(), // EM_ELABORACAO | AGUARDANDO_CONFERENCIA | AGUARDANDO_APROVACAO | APROVADO | ENCERRADO
    autoSummarySnapshotJson: text('auto_summary_snapshot_json').notNull(),
    shiftSummaryText: text('shift_summary_text').default('').notNull(),
    relevantOccurrencesText: text('relevant_occurrences_text').default('').notNull(),
    pendenciesText: text('pendencies_text').default('').notNull(),
    requiredActionsText: text('required_actions_text').default('').notNull(),
    nextShiftRecommendationsText: text('next_shift_recommendations_text').default('').notNull(),
    autoReportText: text('auto_report_text').default('').notNull(),
    editedReportText: text('edited_report_text'),
    supplementsJson: text('supplements_json').default('[]').notNull(),
    vehicleSummaryJson: text('vehicle_summary_json').default('{}').notNull(),
    aiEditCount: integer('ai_edit_count').default(0).notNull(),
    lastAiCommand: text('last_ai_command'),
    handoverByUserId: integer('handover_by_user_id')
      .references(() => users.id)
      .notNull(),
    receivedByUserId: integer('received_by_user_id').references(() => users.id),
    receivedByName: text('received_by_name'),
    reviewedByUserId: integer('reviewed_by_user_id').references(() => users.id),
    approvedByUserId: integer('approved_by_user_id').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    approvalNotes: text('approval_notes'),
    finalizedByUserId: integer('finalized_by_user_id').references(() => users.id),
    finalizedAt: timestamp('finalized_at'),
    closedAt: timestamp('closed_at'),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('shift_handovers_date_idx').on(table.operationalDate),
    index('shift_handovers_status_idx').on(table.status),
  ]
);

// 28B. Histórico Versionado de Revisões do Relatório de Turno (Imutável)
export const shiftHandoverRevisions = pgTable(
  'shift_handover_revisions',
  {
    id: serial('id').primaryKey(),
    handoverId: integer('handover_id')
      .references(() => shiftHandovers.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull(),
    workflowStatus: text('workflow_status').notNull(),
    changeType: text('change_type').notNull(), // AUTO_GERADA | COMPLEMENTO_MANUAL | EDICAO_IA | CONFERENCIA | APROVACAO | ENCERRAMENTO | CORRECAO_POS_APROVACAO
    reportText: text('report_text').notNull(),
    aiCommand: text('ai_command'),
    reason: text('reason'),
    editedByUserId: integer('edited_by_user_id')
      .references(() => users.id)
      .notNull(),
    editedByName: text('edited_by_name').notNull(),
    editedByBadge: text('edited_by_badge'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('sh_rev_handover_idx').on(table.handoverId)]
);

// 29. Pendências vinculadas à Passagem de Turno (Ciência nunca conclui automaticamente)
export const shiftHandoverPendencies = pgTable(
  'shift_handover_pendencies',
  {
    id: serial('id').primaryKey(),
    pendencyCode: text('pendency_code').notNull().unique(),
    handoverId: integer('handover_id')
      .references(() => shiftHandovers.id, { onDelete: 'cascade' })
      .notNull(),
    sourceType: text('source_type').default('MANUAL').notNull(), // DESCARGA_PARCIAL | TRANSFERENCIA_PENDENTE | OCORRENCIA | ESTOQUE_CRITICO | MANUAL
    sourceEntityId: text('source_entity_id'),
    title: text('title').notNull(),
    description: text('description').notNull(),
    priority: text('priority').default('MEDIA').notNull(), // CRITICA | ALTA | MEDIA | BAIXA
    status: text('status').default('ABERTA').notNull(), // ABERTA | CIENTE | RESOLVIDA
    acknowledgedByUserId: integer('acknowledged_by_user_id').references(() => users.id),
    acknowledgedAt: timestamp('acknowledged_at'),
    acknowledgmentNote: text('acknowledgment_note'),
    resolvedByUserId: integer('resolved_by_user_id').references(() => users.id),
    resolvedAt: timestamp('resolved_at'),
    resolutionNotes: text('resolution_notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('sh_pend_handover_idx').on(table.handoverId),
    index('sh_pend_status_idx').on(table.status),
  ]
);

// 30. Central de Ocorrências Operacionais
export const operationalOccurrences = pgTable(
  'operational_occurrences',
  {
    id: serial('id').primaryKey(),
    occurrenceCode: text('occurrence_code').notNull().unique(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    occurredAt: timestamp('occurred_at').defaultNow().notNull(),
    siloId: integer('silo_id').references(() => silos.id),
    materialId: integer('material_id').references(() => materials.id),
    productionLineId: integer('production_line_id').references(() => productionLines.id),
    reportedByUserId: integer('reported_by_user_id')
      .references(() => users.id)
      .notNull(),
    executedByName: text('executed_by_name'),
    executedByBadge: text('executed_by_badge'),
    assignedToUserId: integer('assigned_to_user_id').references(() => users.id),
    shiftCode: text('shift_code').notNull(),
    operationalDate: text('operational_date').notNull(),
    priority: text('priority').default('MEDIA').notNull(), // CRITICA | ALTA | MEDIA | BAIXA
    weatherCondition: text('weather_condition'),
    lineImpact: text('line_impact'),
    evidenceJson: text('evidence_json').default('[]').notNull(), // Array<{ name: string; mimeType?: string; dataUrlOrNote: string }>
    status: text('status').default('ABERTA').notNull(), // ABERTA | EM_ANDAMENTO | ENCERRADA
    solutionApplied: text('solution_applied'),
    verifiedByUserId: integer('verified_by_user_id').references(() => users.id),
    verifiedAt: timestamp('verified_at'),
    verificationNotes: text('verification_notes'),
    closedByUserId: integer('closed_by_user_id').references(() => users.id),
    closedAt: timestamp('closed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('op_occ_status_idx').on(table.status),
    index('op_occ_date_idx').on(table.operationalDate),
    index('op_occ_cat_idx').on(table.category),
  ]
);

// 31. Metas Futuras Configuráveis pelo Administrador (Separadas dos Resultados Reais)
export const performanceTargets = pgTable('performance_targets', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  metricKey: text('metric_key').notNull(),
  label: text('label').notNull(),
  targetValue: numeric('target_value', { precision: 12, scale: 3 }).notNull(),
  unit: text('unit').notNull(),
  targetPeriod: text('target_period').default('MENSAL').notNull(), // DIARIO | SEMANAL | MENSAL
  effectiveFromDate: text('effective_from_date').notNull(),
  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 32. Histórico de Versões de Relatórios Gerados e Exportados
export const reportSnapshots = pgTable(
  'report_snapshots',
  {
    id: serial('id').primaryKey(),
    snapshotCode: text('snapshot_code').notNull().unique(),
    reportType: text('report_type').notNull(), // INDICADORES | RECEBIMENTOS | ESTOQUE | POSICAO_HISTORICA | TRANSFERENCIAS | CONSUMO | TURNO
    title: text('title').notNull(),
    format: text('format').notNull(), // VISUALIZACAO | PDF | XLSX | CSV
    periodStart: text('period_start'),
    periodEnd: text('period_end'),
    filtersJson: text('filters_json').default('{}').notNull(),
    totalsJson: text('totals_json').default('{}').notNull(),
    dataOrigin: text('data_origin').notNull(),
    version: integer('version').default(1).notNull(),
    generatedByUserId: integer('generated_by_user_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('rep_snap_type_idx').on(table.reportType)]
);

// 33. Versões de Cestas de Consumo (Comparador Inteligente)
export const consumptionBasketVersions = pgTable(
  'consumption_basket_versions',
  {
    id: serial('id').primaryKey(),
    versionCode: text('version_code').notNull().unique(),
    label: text('label').notNull(),
    productionDate: text('production_date').notNull(), // YYYY-MM-DD
    emissionTime: text('emission_time'), // HH:mm
    sequenceOrder: integer('sequence_order').default(1).notNull(),
    sourceType: text('source_type').notNull(), // CAMERA_TABLET | ARQUIVO_IMAGEM | ARQUIVO_PDF | ARQUIVO_XLSX | ARQUIVO_CSV | MANUAL
    status: text('status').default('RASCUNHO').notNull(), // RASCUNHO | CONFERIDA | PUBLICADA | ARQUIVADA
    isCurrentPublished: boolean('is_current_published').default(false).notNull(),
    linkedScheduleId: integer('linked_schedule_id').references(() => productionSchedules.id),
    sourcePagesJson: text('source_pages_json').default('[]').notNull(),
    unreadableFieldsJson: text('unreadable_fields_json').default('[]').notNull(),
    notes: text('notes'),
    createdByUserId: integer('created_by_user_id')
      .references(() => users.id)
      .notNull(),
    publishedByUserId: integer('published_by_user_id').references(() => users.id),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('basket_ver_date_idx').on(table.productionDate),
    index('basket_ver_status_idx').on(table.status),
  ]
);

// 34. Itens Extraídos por Versão da Cesta de Consumo (com proveniência)
export const consumptionBasketItems = pgTable(
  'consumption_basket_items',
  {
    id: serial('id').primaryKey(),
    basketVersionId: integer('basket_version_id')
      .references(() => consumptionBasketVersions.id)
      .notNull(),
    productionDate: text('production_date').notNull(),
    lineCode: text('line_code').notNull(),
    materialId: integer('material_id').references(() => materials.id),
    materialCode: text('material_code'),
    materialDescription: text('material_description').notNull(),
    rawQuantityText: text('raw_quantity_text'),
    plannedQuantityKg: numeric('planned_quantity_kg', { precision: 14, scale: 3 }),
    unit: text('unit').default('kg').notNull(),
    sourcePage: integer('source_page').default(1).notNull(),
    sourceDocumentName: text('source_document_name'),
    sourceRegion: text('source_region'),
    confidence: text('confidence').default('MEDIA').notNull(), // ALTA | MEDIA | BAIXA
    needsReview: boolean('needs_review').default(false).notNull(),
    reviewReason: text('review_reason'),
    manuallyEdited: boolean('manually_edited').default(false).notNull(),
    editedByUserId: integer('edited_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('basket_item_ver_idx').on(table.basketVersionId),
    index('basket_item_line_mat_idx').on(table.lineCode, table.materialCode),
  ]
);

// 35. Comparações Gerenciais entre Versões de Cestas de Consumo
export const consumptionBasketComparisons = pgTable(
  'consumption_basket_comparisons',
  {
    id: serial('id').primaryKey(),
    comparisonCode: text('comparison_code').notNull().unique(),
    productionDate: text('production_date').notNull(),
    baseVersionId: integer('base_version_id')
      .references(() => consumptionBasketVersions.id)
      .notNull(),
    targetVersionId: integer('target_version_id')
      .references(() => consumptionBasketVersions.id)
      .notNull(),
    status: text('status').default('COMPARADA').notNull(), // CONFERENCIA | COMPARADA | PUBLICADA
    totalPreviousKg: numeric('total_previous_kg', { precision: 14, scale: 3 }).default('0').notNull(),
    totalNewKg: numeric('total_new_kg', { precision: 14, scale: 3 }).default('0').notNull(),
    totalDiffKg: numeric('total_diff_kg', { precision: 14, scale: 3 }).default('0').notNull(),
    pctChange: numeric('pct_change', { precision: 10, scale: 2 }),
    summaryJson: text('summary_json').default('{}').notNull(),
    operationalImpactsJson: text('operational_impacts_json').default('[]').notNull(),
    createdByUserId: integer('created_by_user_id')
      .references(() => users.id)
      .notNull(),
    publishedByUserId: integer('published_by_user_id').references(() => users.id),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('basket_cmp_date_idx').on(table.productionDate)]
);

// 36. Itens de Diferença Comparativa Linha a Linha (L1-L7)
export const consumptionBasketDiffItems = pgTable(
  'consumption_basket_diff_items',
  {
    id: serial('id').primaryKey(),
    comparisonId: integer('comparison_id')
      .references(() => consumptionBasketComparisons.id)
      .notNull(),
    productionDate: text('production_date').notNull(),
    lineCode: text('line_code').notNull(),
    materialId: integer('material_id').references(() => materials.id),
    materialCode: text('material_code'),
    materialDescription: text('material_description').notNull(),
    previousQuantityKg: numeric('previous_quantity_kg', { precision: 14, scale: 3 }),
    newQuantityKg: numeric('new_quantity_kg', { precision: 14, scale: 3 }),
    diffKg: numeric('diff_kg', { precision: 14, scale: 3 }),
    pctChange: numeric('pct_change', { precision: 10, scale: 2 }),
    unit: text('unit').default('kg').notNull(),
    classification: text('classification').notNull(), // AUMENTOU | DIMINUIU | MANTIDO | NOVO_MATERIAL | MATERIAL_RETIRADO | PENDENTE_CONFERENCIA
    previousSourceRef: text('previous_source_ref'),
    newSourceRef: text('new_source_ref'),
    needsReview: boolean('needs_review').default(false).notNull(),
    reviewReason: text('review_reason'),
  },
  (table) => [index('basket_diff_cmp_idx').on(table.comparisonId)]
);

// 37. Lotes de Rubricagem Diária em Folha Única (Moega Contínuo x Produção Físico)
export const rubricagemBatches = pgTable(
  'rubricagem_batches',
  {
    id: serial('id').primaryKey(),
    batchCode: text('batch_code').notNull().unique(),
    referenceDate: text('reference_date').notNull(), // YYYY-MM-DD
    capturedAt: timestamp('captured_at').defaultNow().notNull(),
    sourceType: text('source_type').default('FOTO_FOLHA_UNICA').notNull(), // FOTO_FOLHA_UNICA | UPLOAD_PLANILHA | MANUAL
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    sourceImageDataUrl: text('source_image_data_url'),
    workflowStatus: text('workflow_status').default('AGUARDANDO_CONFERENCIA').notNull(), // AGUARDANDO_LEITURA | LEITURA_CONCLUIDA | AGUARDANDO_CONFERENCIA | DIVERGENCIA_IDENTIFICADA | AGUARDANDO_AUTORIZACAO | INVENTARIO_CONFIRMADO | HISTORICO_PRESERVADO
    moegaCount: integer('moega_count').default(0).notNull(),
    producaoCount: integer('producao_count').default(0).notNull(),
    divergenceCount: integer('divergence_count').default(0).notNull(),
    notes: text('notes'),
    importedByUserId: integer('imported_by_user_id')
      .references(() => users.id)
      .notNull(),
    authorizedByUserId: integer('authorized_by_user_id').references(() => users.id),
    authorizedAt: timestamp('authorized_at'),
    authorizationReason: text('authorization_reason'),
    supersededByBatchId: integer('superseded_by_batch_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('rubricagem_batch_date_idx').on(table.referenceDate),
    index('rubricagem_batch_status_idx').on(table.workflowStatus),
  ]
);

// 38. Leituras Individuais por Silo na Rubricagem (Histórico Imutável + Conferência)
export const rubricagemEntries = pgTable(
  'rubricagem_entries',
  {
    id: serial('id').primaryKey(),
    batchId: integer('batch_id')
      .references(() => rubricagemBatches.id, { onDelete: 'cascade' })
      .notNull(),
    siloId: integer('silo_id')
      .references(() => silos.id)
      .notNull(),
    siloNumber: integer('silo_number').notNull(),
    controlOwnerAtCapture: text('control_owner_at_capture').notNull(), // MOEGA | PRODUCAO
    stockModel: text('stock_model').notNull(), // CONTROLE_CONTINUO_MOVIMENTOS | RUBRICAGEM_DIARIA_FISICA
    previousConfirmedKg: numeric('previous_confirmed_kg', { precision: 14, scale: 3 }),
    previousCountAt: timestamp('previous_count_at'),
    systemLedgerKg: numeric('system_ledger_kg', { precision: 14, scale: 3 }).default('0').notNull(),
    intermediateMovementsKg: numeric('intermediate_movements_kg', { precision: 14, scale: 3 })
      .default('0')
      .notNull(),
    countedQuantityKg: numeric('counted_quantity_kg', { precision: 14, scale: 3 }).notNull(),
    countedUnit: text('counted_unit').default('kg').notNull(), // kg | t
    rawCordaMeters: numeric('raw_corda_meters', { precision: 8, scale: 2 }),
    materialIdSnapshot: integer('material_id_snapshot').references(() => materials.id),
    materialCodeSnapshot: text('material_code_snapshot'),
    deltaPhysicalKg: numeric('delta_physical_kg', { precision: 14, scale: 3 }),
    deltaPhysicalPct: numeric('delta_physical_pct', { precision: 10, scale: 2 }),
    deltaVsSystemKg: numeric('delta_vs_system_kg', { precision: 14, scale: 3 }).default('0').notNull(),
    hasDivergence: boolean('has_divergence').default(false).notNull(),
    divergenceReason: text('divergence_reason'),
    itemWorkflowStatus: text('item_workflow_status').default('AGUARDANDO_CONFERENCIA').notNull(),
    occurrenceId: integer('occurrence_id').references(() => operationalOccurrences.id),
    authorizedAdjustmentMovementId: integer('authorized_adjustment_movement_id').references(
      () => inventoryMovements.id
    ),
    confidence: text('confidence').default('MANUAL').notNull(), // ALTA | MEDIA | BAIXA | MANUAL
    needsReview: boolean('needs_review').default(false).notNull(),
    notes: text('notes'),
    confirmedByUserId: integer('confirmed_by_user_id').references(() => users.id),
    confirmedAt: timestamp('confirmed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('rubricagem_entry_batch_idx').on(table.batchId),
    index('rubricagem_entry_silo_idx').on(table.siloId),
    index('rubricagem_entry_status_idx').on(table.itemWorkflowStatus),
  ]
);

// Relations
export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  rolePermissions: many(rolePermissions),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
}));

export const silosRelations = relations(silos, ({ one, many }) => ({
  productionLine: one(productionLines, {
    fields: [silos.productionLineId],
    references: [productionLines.id],
  }),
  primaryMaterial: one(materials, {
    fields: [silos.primaryMaterialId],
    references: [materials.id],
  }),
  compatibilities: many(siloMaterialCompatibility),
}));

export const siloMaterialCompatibilityRelations = relations(
  siloMaterialCompatibility,
  ({ one }) => ({
    silo: one(silos, {
      fields: [siloMaterialCompatibility.siloId],
      references: [silos.id],
    }),
    material: one(materials, {
      fields: [siloMaterialCompatibility.materialId],
      references: [materials.id],
    }),
  })
);

export const siloTransferRulesRelations = relations(siloTransferRules, ({ one }) => ({
  originSilo: one(silos, {
    fields: [siloTransferRules.originSiloId],
    references: [silos.id],
  }),
  destinationSilo: one(silos, {
    fields: [siloTransferRules.destinationSiloId],
    references: [silos.id],
  }),
  material: one(materials, {
    fields: [siloTransferRules.materialId],
    references: [materials.id],
  }),
}));
