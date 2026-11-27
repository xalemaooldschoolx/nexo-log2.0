import type {
  AppUser,
  AuditEventItem,
  AuthorizedRouteItem,
  BasketComparisonView,
  BasketVersionView,
  ConsumptionReportResponse,
  ConsumptionTrendResponse,
  DashboardResponse,
  HelpArticleItem,
  IntelligenceSummaryResponse,
  InventoryMovementItem,
  MaterialBagConfigItem,
  MaterialItem,
  OccurrenceItem,
  OperationalIndicatorsOverview,
  PerformanceTargetItem,
  PresentationBootstrapPayload,
  PresentationLiveCounts,
  PresentationViewMode,
  ProductWithFactorsItem,
  ProductionScheduleView,
  ProductionSupplyBoardResponse,
  ReceiptItem,
  ReceivingReportResponse,
  ReportFilterParams,
  ReportSnapshotItem,
  ScheduleTemplateItem,
  SessionData,
  ShiftAutoSummarySnapshot,
  ShiftConfigView,
  ShiftHandoverPendencyView,
  ShiftHandoverView,
  ShiftManagerialReportResponse,
  ShiftManagerialReportRow,
  ShiftWorkflowStatus,
  SiloDetail,
  SiloLedgerDetails,
  SiloVolumeHistory24hResponse,
  StockAndHistoricalReportResponse,
  StockThresholdItem,
  SupplierItem,
  TransferOrderItem,
  TransferRuleItem,
  TransfersReportResponse,
  ValidationPendency,
} from '../types/nexo.ts';
import { evaluateSiloStockStatus } from './stock-status.ts';
import { ROLE_PERMISSIONS } from './rbac.ts';
import { formatDateLocal, resolveOperationalShift, type ShiftCode } from './shifts.ts';
import {
  buildReference2511BasketVersions,
  compareBasketVersions,
  round2,
  round3,
} from './basket-comparator.ts';
import { buildDemoHelpArticles } from './manual-registry.ts';
import { buildSiloVolumeHistory24h } from './volume-history.ts';
import {
  buildMoegaShiftNarrativeReport,
  classifyShiftVehicles,
  type VehicleReceiptInput,
} from './phase5-analytics.ts';

export interface ArchivedScheduleDocumentPreview {
  fileName: string;
  mimeType: string;
  fileContentBase64: string | null;
  extractedTextPreview: string | null;
}

export interface DemoSandboxState {
  viewMode: PresentationViewMode;
  bootstrapSyncedAtIso: string | null;
  bootstrapPayload: PresentationBootstrapPayload | null;
  liveCounts: PresentationLiveCounts;
  session: SessionData;
  lines: Array<{ id: number; code: string; name: string; category: string }>;
  scheduleTemplates: ScheduleTemplateItem[];
  materials: MaterialItem[];
  suppliers: SupplierItem[];
  bagConfigs: MaterialBagConfigItem[];
  silos: SiloDetail[];
  transferRules: TransferRuleItem[];
  routes: AuthorizedRouteItem[];
  pendencies: ValidationPendency[];
  receipts: ReceiptItem[];
  movements: InventoryMovementItem[];
  transferOrders: TransferOrderItem[];
  schedules: ProductionScheduleView[];
  scheduleDocuments: Record<number, ArchivedScheduleDocumentPreview>;
  products: ProductWithFactorsItem[];
  thresholds: StockThresholdItem[];
  supplyBoard: ProductionSupplyBoardResponse;
  intelligenceSummary: IntelligenceSummaryResponse;
  shifts: ShiftConfigView[];
  handovers: ShiftHandoverView[];
  openShiftPendencies: ShiftHandoverPendencyView[];
  occurrences: OccurrenceItem[];
  performanceTargets: PerformanceTargetItem[];
  recentSnapshots: ReportSnapshotItem[];
  auditEvents: AuditEventItem[];
  users: AppUser[];
  helpArticles: HelpArticleItem[];
  basketVersions: BasketVersionView[];
  basketComparisons: BasketComparisonView[];
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + deltaDays);
  return formatDateLocal(dt);
}

function makeIsoAtLocalTime(ymd: string, hhmm: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  return dt.toISOString();
}

function formatBrDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

// =========================================================================
// CATÁLOGO OFICIAL INTEGRAL (27 MPs, 7 Fornecedores, 12 Bags, 54 Silos, 9 Regras, 6 Pendências, 16 Artigos)
// =========================================================================

const BASE_MATERIALS: MaterialItem[] = [
  { id: 1, code: '2017101021', description: 'CALCARIO', category: 'MINERAL', handlingType: 'GRANEL_E_BAG', referenceBagWeightKg: '1000.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Referência anotada: 1.000 kg/bag (pendente validação oficial).', isActive: true },
  { id: 2, code: '2017101250', description: 'CALCARIO GRANULADO', category: 'MINERAL', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: null, isActive: true },
  { id: 3, code: '2017101157', description: 'CALCARIO CALCITICO B.BAG(TMP)', category: 'MINERAL', handlingType: 'BIG_BAG', referenceBagWeightKg: '1000.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Referência anotada: 1.000 kg/bag (pendente validação oficial).', isActive: true },
  { id: 4, code: '2017101294', description: 'CARBONATO DE CALCIO DE ALGA CA32-BIG BAG', category: 'MINERAL', handlingType: 'BIG_BAG', referenceBagWeightKg: '1000.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Referência anotada: 1.000 kg ou 1.300 kg por bag conforme fornecedor/lote.', isActive: true },
  { id: 5, code: '2019101141', description: 'FOSFATO BICALCICO GRANULAR 19% (GRANEL)', category: 'MINERAL', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: 'Requer destravar trava central do caminhão (produto granulado).', isActive: true },
  { id: 6, code: '2019101142', description: 'FOSFATO BICALCICO GRANULAR 19% (BIG BAG)', category: 'MINERAL', handlingType: 'BIG_BAG', referenceBagWeightKg: '1500.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Código de bag anotado (41); referência preliminar 1.500 kg/bag.', isActive: true },
  { id: 7, code: '2019131030', description: 'FOSFATO MONOBICALCICO 21% (GRANEL)', category: 'MINERAL', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: 'Requer destravar trava central do caminhão (produto granulado).', isActive: true },
  { id: 8, code: '2019131031', description: 'FOSFATO MONOBICALCICO 21% (BIG BAG)', category: 'MINERAL', handlingType: 'BIG_BAG', referenceBagWeightKg: '1500.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Código de bag anotado (30); referência preliminar 1.500 kg/bag.', isActive: true },
  { id: 9, code: '2019131033', description: 'FOSFATO MONO 21% GRAN ESPECIAL (BAG)', category: 'MINERAL', handlingType: 'BIG_BAG', referenceBagWeightKg: '1500.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: null, isActive: true },
  { id: 10, code: '2090121061', description: 'CAULIM', category: 'MINERAL', handlingType: 'GRANEL_E_BAG', referenceBagWeightKg: '1200.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Referência anotada: 1.200 kg/bag (CAULIM BIG BAG).', isActive: true },
  { id: 11, code: '1113101920', description: 'VEICULO PREMIX GRANEL E BAG', category: 'PREMIX', handlingType: 'GRANEL_E_BAG', referenceBagWeightKg: '800.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Referência anotada: 800 kg/bag.', isActive: true },
  { id: 12, code: '1113101922', description: 'VEICULO PREMIX BIG BAG', category: 'PREMIX', handlingType: 'BIG_BAG', referenceBagWeightKg: '800.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Código de bag anotado (20).', isActive: true },
  { id: 13, code: '1614261039', description: 'FARELO DE GLUTEN DE MILHO 21% (GRANEL)', category: 'PROTEICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: 'Também referenciado como PROMIL (1614261030) na ficha RQ-REC-046.', isActive: true },
  { id: 14, code: '1614261033', description: 'FARELO DE GLUTEN DE MILHO 21% (BIG BAG)', category: 'PROTEICO', handlingType: 'BIG_BAG', referenceBagWeightKg: '1000.00', bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: 'Código de bag anotado (39); referência preliminar 1.000 kg ou 1.260 kg.', isActive: true },
  { id: 15, code: 'F301030C', description: 'MILHO MOIDO RUMINANTES', category: 'ENERGETICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: null, isActive: true },
  { id: 16, code: '1211101012', description: 'MILHO BC', category: 'ENERGETICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: 'Após milho na armazenagem, avaliar procedimento de limpeza com calcário junto à Qualidade.', isActive: true },
  { id: 17, code: '1614161040', description: 'FARELO DE ALGODÃO 38% (GRANEL)', category: 'PROTEICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: null, isActive: true },
  { id: 18, code: 'F30104A', description: 'FARELO DE ALGODAO MOIDO', category: 'PROTEICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: null, isActive: true },
  { id: 19, code: '1613131012', description: 'GERMEN DE MILHO DESENGORDURADO (NDF >30)', category: 'ENERGETICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: null, isActive: true },
  { id: 20, code: 'F30GMOA16CMP', description: 'GERMEN DE MILHO DESENGORDURADO (NDF >30) - PROD', category: 'ENERGETICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: null, isActive: true },
  { id: 21, code: 'F30BMOA80', description: 'MOAGEM B ARROZ QUIRERA', category: 'ENERGETICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: null, isActive: true },
  { id: 22, code: '1553241021', description: 'FARINHA DE VISCERAS', category: 'PROTEICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: true, notes: null, isActive: true },
  { id: 23, code: '2021171023', description: 'SAL MOIDO PENEIRADO (BIG BAG)', category: 'SAL', handlingType: 'BIG_BAG', referenceBagWeightKg: null, bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: null, isActive: true },
  { id: 24, code: '2021171081', description: 'SAL REFINADO GRANULADO', category: 'SAL', handlingType: 'BIG_BAG', referenceBagWeightKg: null, bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: null, isActive: true },
  { id: 25, code: '1620101010', description: 'UREIA PECUARIA BIG BAG', category: 'PROTEICO', handlingType: 'BIG_BAG', referenceBagWeightKg: null, bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: true, notes: null, isActive: true },
  { id: 26, code: '1619111011', description: 'BOLACHA FL (BIG BAG)', category: 'ENERGETICO', handlingType: 'BIG_BAG', referenceBagWeightKg: null, bagWeightValidationStatus: 'PENDENTE_VALIDACAO', isCritical: false, notes: null, isActive: true },
  { id: 27, code: '1614271130', description: 'DDG 30 PB', category: 'PROTEICO', handlingType: 'GRANEL', referenceBagWeightKg: null, bagWeightValidationStatus: 'NAO_APLICAVEL', isCritical: false, notes: null, isActive: true },
];

const MAT_BY_CODE = new Map(BASE_MATERIALS.map((m) => [m.code, m]));

const BASE_SUPPLIERS: SupplierItem[] = [
  { id: 1, name: 'MOAGEM PINHEIRO & ALVARENGA LTDA', document: null, notes: null, isActive: true },
  { id: 2, name: 'MASSARI MINERACAO', document: null, notes: null, isActive: true },
  { id: 3, name: 'LOUIS DREYFUS COMPANY', document: null, notes: null, isActive: true },
  { id: 4, name: 'MOSAIC FERTILIZANTES DO BRASIL S.A', document: null, notes: null, isActive: true },
  { id: 5, name: 'DILUMIX INDUSTRIAL LTDA', document: null, notes: null, isActive: true },
  { id: 6, name: 'NB MINERAIS LTDA', document: null, notes: null, isActive: true },
  { id: 7, name: 'MINERAÇÃO BELOCAL', document: null, notes: null, isActive: true },
];

const BASE_LINES: Array<{ id: number; code: string; name: string; category: string }> = [
  { id: 1, code: 'L1', name: 'Linha 1', category: 'LINHA_PRODUCAO' },
  { id: 2, code: 'L2', name: 'Linha 2', category: 'LINHA_PRODUCAO' },
  { id: 3, code: 'L3', name: 'Linha 3', category: 'LINHA_PRODUCAO' },
  { id: 4, code: 'L4', name: 'Linha 4', category: 'LINHA_PRODUCAO' },
  { id: 5, code: 'L5', name: 'Linha 5', category: 'LINHA_PRODUCAO' },
  { id: 6, code: 'L6', name: 'Linha 6', category: 'LINHA_PRODUCAO' },
  { id: 7, code: 'L7', name: 'Linha 7 (Armazenagem e Produção)', category: 'ARMAZENAGEM' },
];

const LINE_BY_CODE = new Map(BASE_LINES.map((l) => [l.code, l]));

interface RawSiloDef {
  siloNumber: number;
  rubricOrder: number;
  category: 'LINHA' | 'ARMAZENAGEM' | 'PRODUCAO';
  controlOwner: 'MOEGA' | 'PRODUCAO';
  lineCode: string;
  heightMeters: number | null;
  cordaMeters: number;
  nominalCapacityKg: number;
  safeCapacityKg: number;
  materialCode: string;
  isDividedCompartment: boolean;
  validationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO';
  validationNotes: string | null;
  demoStockKg: number;
  demoStatus?: 'OPERACIONAL' | 'MANUTENCAO' | 'BLOQUEADO';
  demoIsReceiving?: boolean;
  demoRecPriority?: 'VERMELHO' | 'LARANJA' | null;
  demoRecReason?: string | null;
}

// Mapeamento oficial completo dos 54 silos (capacidades nominais 1.304.063 kg / seguras 1.173.655 kg, sem silos 27 e 30)
// ValidationStatus e ValidationNotes espelham integralmente o catálogo PostgreSQL oficial.
const DEMO_SILO_DEFS: RawSiloDef[] = [
  { siloNumber: 9, rubricOrder: 1, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L5', heightMeters: 7.5, cordaMeters: 3.51, nominalCapacityKg: 14001, safeCapacityKg: 12601, materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26 indica 14.001 kg; RQ-REC-046 indica 12.000 kg.', demoStockKg: 8200 },
  { siloNumber: 10, rubricOrder: 2, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L5', heightMeters: 7.5, cordaMeters: 7.71, nominalCapacityKg: 13978, safeCapacityKg: 12580, materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26 indica 13.978 kg; RQ-REC-046 indica 12.000 kg.', demoStockKg: 2800, demoRecPriority: 'LARANJA', demoRecReason: '[CENÁRIO DEMO] Estoque baixo na Linha 5 (22,3%); transferência S37 → S10 recomendada.' },
  { siloNumber: 11, rubricOrder: 3, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 5.08, nominalCapacityKg: 42241, safeCapacityKg: 38016, materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 42.241 kg vs RQ-REC-046: 35.000 kg.', demoStockKg: 24500 },
  { siloNumber: 12, rubricOrder: 4, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 6.2, nominalCapacityKg: 70369, safeCapacityKg: 63332, materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 70.369 kg vs RQ-REC-046: 53.000 kg.', demoStockKg: 4200, demoRecPriority: 'VERMELHO', demoRecReason: '[CENÁRIO DEMO] Risco crítico L4: saldo 4.200 kg insuficiente para consumo projetado de 18.500 kg.' },
  { siloNumber: 13, rubricOrder: 5, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 8.56, nominalCapacityKg: 49084, safeCapacityKg: 44176, materialCode: '2019131030', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 49.084 kg vs RQ-REC-046: 35.000 kg.', demoStockKg: 19400 },
  { siloNumber: 14, rubricOrder: 6, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 7.58, nominalCapacityKg: 23496, safeCapacityKg: 21147, materialCode: '2090121061', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Compartimento dividido; Planilha 23.496 kg vs RQ-REC-046 18.000 kg.', demoStockKg: 12300 },
  { siloNumber: 15, rubricOrder: 7, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 3.86, nominalCapacityKg: 10782, safeCapacityKg: 9704, materialCode: '1113101920', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Divergência de MP: Planilha indica VEICULO PREMIX (1113101920), RQ-REC-046 indica FARELO CASCA DE ARROZ.', demoStockKg: 2200, demoRecPriority: 'LARANJA', demoRecReason: '[CENÁRIO DEMO] Silo 15 (L4) abaixo de 25% da capacidade segura; transferência S37 → S15 em andamento.' },
  { siloNumber: 16, rubricOrder: 8, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 8.39, nominalCapacityKg: 36869, safeCapacityKg: 33182, materialCode: '2017101157', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Divergência de MP: Planilha indica CALCARIO CALCITICO, RQ-REC-046 indica FARELO ALGODAO 38%.', demoStockKg: 18600 },
  { siloNumber: 31, rubricOrder: 9, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 2.4, nominalCapacityKg: 9367, safeCapacityKg: 8430, materialCode: '1614261039', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha indica código 1614261039 (Gluten 21%), RQ-REC-046 indica 1614261030 (Promil).', demoStockKg: 5400 },
  { siloNumber: 32, rubricOrder: 10, category: 'LINHA', controlOwner: 'PRODUCAO', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 9.36, nominalCapacityKg: 18729, safeCapacityKg: 16856, materialCode: '2017101294', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Controle PRODUÇÃO na planilha 12/11/26; RQ-REC-046 listava Farelo de Soja Hypro.', demoStockKg: 9100 },
  { siloNumber: 33, rubricOrder: 11, category: 'LINHA', controlOwner: 'PRODUCAO', lineCode: 'L4', heightMeters: 11.5, cordaMeters: 2.69, nominalCapacityKg: 15897, safeCapacityKg: 14307, materialCode: 'F301030C', isDividedCompartment: true, validationStatus: 'VALIDADO', validationNotes: 'Anotação de campo confirma controle de abastecimento pela Produção.', demoStockKg: 9800 },
  { siloNumber: 17, rubricOrder: 12, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: 11.5, cordaMeters: 7.97, nominalCapacityKg: 48226, safeCapacityKg: 43403, materialCode: '2090121061', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 48.226 kg vs RQ-REC-046: 37.000 kg.', demoStockKg: 27400 },
  { siloNumber: 18, rubricOrder: 13, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: 11.5, cordaMeters: 5.17, nominalCapacityKg: 23983, safeCapacityKg: 21585, materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Divergência de MP: Planilha indica VEICULO PREMIX, RQ-REC-046 indica FARELO CASCA DE ARROZ.', demoStockKg: 14200 },
  { siloNumber: 19, rubricOrder: 14, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: 11.5, cordaMeters: 6.28, nominalCapacityKg: 74798, safeCapacityKg: 67318, materialCode: '2017101157', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Divergência de MP: Planilha indica CALCARIO CALCITICO, RQ-REC-046 indica FOSFATO BICALCICO.', demoStockKg: 41200 },
  { siloNumber: 20, rubricOrder: 15, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: 11.5, cordaMeters: 10.34, nominalCapacityKg: 49672, safeCapacityKg: 44705, materialCode: '2019131030', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 49.672 kg vs RQ-REC-046: 35.000 kg.', demoStockKg: 28900 },
  { siloNumber: 21, rubricOrder: 16, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: 11.5, cordaMeters: 3.12, nominalCapacityKg: 70659, safeCapacityKg: 63593, materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 70.659 kg vs RQ-REC-046: 55.000 kg.', demoStockKg: 38400, demoIsReceiving: true },
  { siloNumber: 22, rubricOrder: 17, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: 11.5, cordaMeters: 9.6, nominalCapacityKg: 38796, safeCapacityKg: 34916, materialCode: '2017101294', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 38.796 kg vs RQ-REC-046: 56.000 kg.', demoStockKg: 22600 },
  { siloNumber: 23, rubricOrder: 18, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L2', heightMeters: 8.5, cordaMeters: 7.71, nominalCapacityKg: 23492, safeCapacityKg: 21143, materialCode: 'F30BMOA80', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: MOAGEM B ARROZ QUIRERA (23.492 kg) vs RQ-REC-046: CASCA DE ARROZ (12.000 kg).', demoStockKg: 11200 },
  { siloNumber: 24, rubricOrder: 19, category: 'LINHA', controlOwner: 'PRODUCAO', lineCode: 'L2', heightMeters: 8.5, cordaMeters: 6.59, nominalCapacityKg: 11744, safeCapacityKg: 10569, materialCode: '1553241021', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: FARINHA DE VISCERAS (PRODUÇÃO) vs RQ-REC-046: VEICULO PREMIX.', demoStockKg: 6900 },
  { siloNumber: 25, rubricOrder: 20, category: 'LINHA', controlOwner: 'PRODUCAO', lineCode: 'L1', heightMeters: 8.5, cordaMeters: 5.15, nominalCapacityKg: 14848, safeCapacityKg: 13363, materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: 'Anotação de campo confirma abastecimento pela Produção.', demoStockKg: 9400 },
  { siloNumber: 26, rubricOrder: 21, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L1', heightMeters: 8.5, cordaMeters: 5.26, nominalCapacityKg: 27711, safeCapacityKg: 24940, materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: FOSFATO BICALCICO vs RQ-REC-046: VEICULO PREMIX; anotação menciona Produção.', demoStockKg: 16800 },
  { siloNumber: 28, rubricOrder: 22, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L6', heightMeters: 4.5, cordaMeters: 3.96, nominalCapacityKg: 5542, safeCapacityKg: 4987, materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: 5.542 kg vs RQ-REC-046: 7.300 kg.', demoStockKg: 3450 },
  { siloNumber: 29, rubricOrder: 23, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L6', heightMeters: 4.5, cordaMeters: 4.05, nominalCapacityKg: 5542, safeCapacityKg: 4987, materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: 5.542 kg vs RQ-REC-046: 7.300 kg.', demoStockKg: 520, demoRecPriority: 'VERMELHO', demoRecReason: '[CENÁRIO DEMO] Nível crítico na Linha 6 (10,4%); necessita abastecimento imediato.' },
  // Armazenagem 42 -> 34
  { siloNumber: 42, rubricOrder: 24, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 3.51, nominalCapacityKg: 45939, safeCapacityKg: 41345, materialCode: '1211101012', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 31000 },
  { siloNumber: 41, rubricOrder: 25, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 5.16, nominalCapacityKg: 38871, safeCapacityKg: 34984, materialCode: '1614161040', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'RQ-REC-046 listava MILHO BC 61,4 ton; planilha 12/11/26 indica FARELO ALGODAO 38% (38.871 kg).', demoStockKg: 24200 },
  { siloNumber: 40, rubricOrder: 26, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 7.18, nominalCapacityKg: 30839, safeCapacityKg: 27756, materialCode: '1613131012', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Linha em branco no RQ-REC-046; preenchido conforme planilha 12/11/26.', demoStockKg: 0, demoStatus: 'MANUTENCAO' },
  { siloNumber: 39, rubricOrder: 27, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 8.19, nominalCapacityKg: 85411, safeCapacityKg: 76870, materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 54000 },
  { siloNumber: 38, rubricOrder: 28, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 4.98, nominalCapacityKg: 97190, safeCapacityKg: 87471, materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 68500 },
  { siloNumber: 37, rubricOrder: 29, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 6.29, nominalCapacityKg: 26693, safeCapacityKg: 24024, materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha e confirmação operacional indicam VEICULO PREMIX (26.693 kg); RQ-REC-046 impresso tinha CAULIM.', demoStockKg: 18500 },
  { siloNumber: 36, rubricOrder: 30, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 4.97, nominalCapacityKg: 26800, safeCapacityKg: 24120, materialCode: '1211101012', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: MILHO BC (26.800 kg) vs RQ-REC-046: FARELO ALGODAO 38% (23.000 kg).', demoStockKg: 14600 },
  { siloNumber: 35, rubricOrder: 31, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 9.54, nominalCapacityKg: 38000, safeCapacityKg: 34200, materialCode: '2019131030', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 25100, demoIsReceiving: true },
  { siloNumber: 34, rubricOrder: 32, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: 9, cordaMeters: 3.27, nominalCapacityKg: 21354, safeCapacityKg: 19219, materialCode: '1614261039', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 11800 },
  // Produção 43 -> 64
  { siloNumber: 43, rubricOrder: 33, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 3.33, nominalCapacityKg: 7974, safeCapacityKg: 7177, materialCode: '2021171023', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 4900 },
  { siloNumber: 44, rubricOrder: 34, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 2.6, nominalCapacityKg: 11044, safeCapacityKg: 9939, materialCode: '2021171081', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 6200 },
  { siloNumber: 45, rubricOrder: 35, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 3.39, nominalCapacityKg: 5147, safeCapacityKg: 4632, materialCode: '1620101010', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 3100 },
  { siloNumber: 46, rubricOrder: 36, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 2.18, nominalCapacityKg: 13442, safeCapacityKg: 12097, materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 2900 },
  { siloNumber: 47, rubricOrder: 37, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 3.3, nominalCapacityKg: 16681, safeCapacityKg: 15013, materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 9800 },
  { siloNumber: 48, rubricOrder: 38, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 2.83, nominalCapacityKg: 6271, safeCapacityKg: 5644, materialCode: '2019131033', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 3800 },
  { siloNumber: 49, rubricOrder: 39, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 4.27, nominalCapacityKg: 9176, safeCapacityKg: 8259, materialCode: '2090121061', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 5500 },
  { siloNumber: 50, rubricOrder: 40, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 2.27, nominalCapacityKg: 8457, safeCapacityKg: 7612, materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 5100 },
  { siloNumber: 51, rubricOrder: 41, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 3.16, nominalCapacityKg: 14600, safeCapacityKg: 13140, materialCode: '2017101157', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: CALCARIO CALCITICO (14.600 kg) vs RQ-REC-046: FOSFATO BICALCICO (8.000 kg).', demoStockKg: 8400 },
  { siloNumber: 52, rubricOrder: 42, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 4.04, nominalCapacityKg: 5618, safeCapacityKg: 5056, materialCode: 'F30GMOA16CMP', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Em branco no RQ-REC-046; cadastrado conforme planilha 12/11/26.', demoStockKg: 3200 },
  { siloNumber: 53, rubricOrder: 43, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 3.63, nominalCapacityKg: 5618, safeCapacityKg: 5056, materialCode: 'F30GMOA16CMP', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: GERMEN DE MILHO (5.618 kg) vs RQ-REC-046: CALCARIO (13.000 kg).', demoStockKg: 3000 },
  { siloNumber: 54, rubricOrder: 44, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 7.26, nominalCapacityKg: 4893, safeCapacityKg: 4404, materialCode: 'F30104A', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 2900 },
  { siloNumber: 55, rubricOrder: 45, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 5.19, nominalCapacityKg: 9603, safeCapacityKg: 8642, materialCode: '2019131030', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 850 },
  { siloNumber: 56, rubricOrder: 46, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 1.24, nominalCapacityKg: 4531, safeCapacityKg: 4078, materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 2700 },
  { siloNumber: 57, rubricOrder: 47, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 1.8, nominalCapacityKg: 4893, safeCapacityKg: 4404, materialCode: 'F30104A', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 2600 },
  { siloNumber: 58, rubricOrder: 48, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 3.88, nominalCapacityKg: 26512, safeCapacityKg: 23861, materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 15200 },
  { siloNumber: 59, rubricOrder: 49, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 6.14, nominalCapacityKg: 13624, safeCapacityKg: 12262, materialCode: '2017101250', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 8100 },
  { siloNumber: 60, rubricOrder: 50, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 6.9, nominalCapacityKg: 4001, safeCapacityKg: 3601, materialCode: '1619111011', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 2400 },
  { siloNumber: 61, rubricOrder: 51, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 4.2, nominalCapacityKg: 4984, safeCapacityKg: 4485, materialCode: '1614271130', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 2950 },
  { siloNumber: 62, rubricOrder: 52, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 1.6, nominalCapacityKg: 3625, safeCapacityKg: 3262, materialCode: '1614261039', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 2150 },
  { siloNumber: 63, rubricOrder: 53, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 1.05, nominalCapacityKg: 6223, safeCapacityKg: 5601, materialCode: 'F301030C', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 3900 },
  { siloNumber: 64, rubricOrder: 54, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: 5.71, nominalCapacityKg: 6223, safeCapacityKg: 5601, materialCode: 'F301030C', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null, demoStockKg: 3750 },
];

const BASE_HELP_ARTICLES: HelpArticleItem[] = buildDemoHelpArticles();

const BASE_SCHEDULE_TEMPLATES: ScheduleTemplateItem[] = [
  { id: 1, code: 'PROG_SENSOR_GERAL', name: 'Programação Diária de Produção (Sensor Sistemas / Tabela Padrão)', documentCategory: 'PROGRAMACAO', promptHints: 'Documento de programação diária por linhas (L1 a L7). Identificar data de produção, linha, ordem/sequência, código e descrição do produto ou matéria-prima, quantidade programada, unidade (t, kg ou batelada) e horário/turno previsto.' },
  { id: 2, code: 'REL_PRODUCAO_SENSOR', name: 'Relatório Impresso de Produção Realizada (Sensor Sistemas)', documentCategory: 'RELATORIO_PRODUCAO', promptHints: 'Relatório de acompanhamento ou fechamento de produção impressa do Sensor Sistemas.' },
  { id: 3, code: 'REL_CONSUMO_SENSOR', name: 'Relatório de Consumo de Matérias-Primas', documentCategory: 'RELATORIO_CONSUMO', promptHints: 'Relatório discriminando matérias-primas dosadas por linha ou período.' },
  { id: 4, code: 'REVISAO_TURNO', name: 'Revisão / Aditivo de Programação de Turno', documentCategory: 'REVISAO', promptHints: 'Documento ou anotação de alteração de programação durante o turno.' },
];

function buildOfficialCatalogEntities(nowIso: string) {
  const matCal = MAT_BY_CODE.get('2017101021')!;
  const matCalCit = MAT_BY_CODE.get('2017101157')!;
  const matAlga = MAT_BY_CODE.get('2017101294')!;
  const matFosfBi = MAT_BY_CODE.get('2019101141')!;
  const matFosfBiBag = MAT_BY_CODE.get('2019101142')!;
  const matFosfMono = MAT_BY_CODE.get('2019131030')!;
  const matFosfMonoBag = MAT_BY_CODE.get('2019131031')!;
  const matFosfMonoEsp = MAT_BY_CODE.get('2019131033')!;
  const matCaulim = MAT_BY_CODE.get('2090121061')!;
  const matPremix = MAT_BY_CODE.get('1113101920')!;
  const matPremixBag = MAT_BY_CODE.get('1113101922')!;
  const matGluten = MAT_BY_CODE.get('1614261039')!;
  const matGlutenBag = MAT_BY_CODE.get('1614261033')!;

  const bagConfigs: MaterialBagConfigItem[] = [
    { id: 1, materialId: matCaulim.id, materialCode: matCaulim.code, materialDescription: matCaulim.description, packagingLabel: 'Big Bag Padrão (1.200 kg)', unitWeightKg: 1200, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Referência provisória Caulim Big Bag — sujeita à validação oficial.', updatedAt: nowIso },
    { id: 2, materialId: matFosfBiBag.id, materialCode: matFosfBiBag.code, materialDescription: matFosfBiBag.description, packagingLabel: 'Big Bag Padrão (1.500 kg)', unitWeightKg: 1500, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Referência provisória Fosfato Bicálcico Big Bag.', updatedAt: nowIso },
    { id: 3, materialId: matFosfMonoBag.id, materialCode: matFosfMonoBag.code, materialDescription: matFosfMonoBag.description, packagingLabel: 'Big Bag Padrão (1.500 kg)', unitWeightKg: 1500, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Referência provisória Fosfato Monobicálcico Big Bag.', updatedAt: nowIso },
    { id: 4, materialId: matFosfMonoEsp.id, materialCode: matFosfMonoEsp.code, materialDescription: matFosfMonoEsp.description, packagingLabel: 'Big Bag Especial (1.500 kg)', unitWeightKg: 1500, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Referência provisória Fosfato Mono 21% Especial.', updatedAt: nowIso },
    { id: 5, materialId: matAlga.id, materialCode: matAlga.code, materialDescription: matAlga.description, packagingLabel: 'Embalagem A (1.000 kg)', unitWeightKg: 1000, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Carbonato de Cálcio de Alga — conferir embalagem antes da descarga.', updatedAt: nowIso },
    { id: 6, materialId: matAlga.id, materialCode: matAlga.code, materialDescription: matAlga.description, packagingLabel: 'Embalagem B (1.300 kg)', unitWeightKg: 1300, validationStatus: 'PENDENTE_VALIDACAO', isDefault: false, notes: 'Carbonato de Cálcio de Alga embalagem reforçada (1.300 kg).', updatedAt: nowIso },
    { id: 7, materialId: matPremix.id, materialCode: matPremix.code, materialDescription: matPremix.description, packagingLabel: 'Big Bag Padrão (800 kg)', unitWeightKg: 800, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Referência provisória Veículo Premix.', updatedAt: nowIso },
    { id: 8, materialId: matPremixBag.id, materialCode: matPremixBag.code, materialDescription: matPremixBag.description, packagingLabel: 'Big Bag Padrão (800 kg)', unitWeightKg: 800, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Referência provisória Veículo Premix Big Bag.', updatedAt: nowIso },
    { id: 9, materialId: matGlutenBag.id, materialCode: matGlutenBag.code, materialDescription: matGlutenBag.description, packagingLabel: 'Embalagem Padrão (1.000 kg)', unitWeightKg: 1000, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Farelo de Glúten de Milho 21% — opção 1.000 kg.', updatedAt: nowIso },
    { id: 10, materialId: matGlutenBag.id, materialCode: matGlutenBag.code, materialDescription: matGlutenBag.description, packagingLabel: 'Embalagem B (1.260 kg)', unitWeightKg: 1260, validationStatus: 'PENDENTE_VALIDACAO', isDefault: false, notes: 'Farelo de Glúten de Milho 21% — opção 1.260 kg.', updatedAt: nowIso },
    { id: 11, materialId: matCalCit.id, materialCode: matCalCit.code, materialDescription: matCalCit.description, packagingLabel: 'Big Bag Padrão (1.000 kg)', unitWeightKg: 1000, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Calcário Calcítico Big Bag (TMP) — referência provisória.', updatedAt: nowIso },
    { id: 12, materialId: matCal.id, materialCode: matCal.code, materialDescription: matCal.description, packagingLabel: 'Big Bag Padrão (1.000 kg)', unitWeightKg: 1000, validationStatus: 'PENDENTE_VALIDACAO', isDefault: true, notes: 'Calcário ensacado/big bag — referência provisória.', updatedAt: nowIso },
  ];

  const pendencies: ValidationPendency[] = [
    {
      id: 1,
      entityType: 'SILO',
      entityRef: 'SILO 15 / 16 / 18 / 19',
      title: 'Divergência de matéria-prima entre RQ-REC-046 e Planilha 12/11/26',
      description: 'Os silos 15, 16, 18 e 19 apresentam produtos distintos entre a ficha impressa RQ-REC-046 e o relatório de capacidade de 12/11/26.',
      sourceA: 'Planilha 12/11/26: S15 Premix, S16 Calcítico, S18 Premix, S19 Calcítico',
      sourceB: 'RQ-REC-046: S15 Farelo Casca Arroz, S16 Farelo Algodão, S18 Farelo Casca Arroz, S19 Fosfato Bi',
      status: 'PENDENTE',
      resolutionNotes: null,
      createdAt: nowIso,
      resolvedAt: null,
    },
    {
      id: 2,
      entityType: 'SILO',
      entityRef: 'SILO 23 / 24 / 26',
      title: 'Divergência de produto e controle operacional (Linhas 1 e 2)',
      description: 'Os silos 23, 24 e 26 possuem divergências entre a ficha RQ-REC-046 e o relatório 12/11/26 quanto ao material armazenado e controle Moega/Produção.',
      sourceA: 'Planilha 12/11/26: S23 Quirera, S24 Farinha Vísceras (Produção), S26 Fosfato Bi',
      sourceB: 'RQ-REC-046: S23 Casca Arroz, S24 Premix, S26 Premix',
      status: 'PENDENTE',
      resolutionNotes: null,
      createdAt: nowIso,
      resolvedAt: null,
    },
    {
      id: 3,
      entityType: 'SILO',
      entityRef: 'SILO 37 / 40 / 41 / 36',
      title: 'Conferência da Armazenagem (Linha 7 — Silos 42 a 34)',
      description: 'Anotação manual indica 9,00 m para armazenagem, enquanto o relatório 12/11/26 traz capacidades distintas e Silo 37 como Veículo Premix (vs Caulim no RQ-REC-046).',
      sourceA: 'Planilha 12/11/26 + Regra confirmada S37->S10/S15 (Veículo Premix)',
      sourceB: 'RQ-REC-046: S37 Caulim 40,5t; S40 em branco; S41 Milho BC; S36 Farelo Algodão',
      status: 'PENDENTE',
      resolutionNotes: null,
      createdAt: nowIso,
      resolvedAt: null,
    },
    {
      id: 4,
      entityType: 'SILO',
      entityRef: 'SILO 51 / 52 / 53',
      title: 'Conferência do grupo Produção/Abastecimento',
      description: 'Divergências de cadastro nos silos 51, 52 (em branco no RQ-REC-046) e 53 entre RQ-REC-046 e planilha 12/11/26.',
      sourceA: 'Planilha 12/11/26: S51 Calcítico, S52/S53 Germen de Milho',
      sourceB: 'RQ-REC-046: S51 Fosfato Bi, S52 em branco, S53 Calcário',
      status: 'PENDENTE',
      resolutionNotes: null,
      createdAt: nowIso,
      resolvedAt: null,
    },
    {
      id: 5,
      entityType: 'BAG_WEIGHT',
      entityRef: 'PESO_UNITARIO_BAGS',
      title: 'Validação de pesos unitários de bags por fornecedor/lote',
      description: 'Os pesos anotados em caderno (Caulim 1200 kg, Fosfato 1500 kg, Alga 1000/1300 kg, Veículo 800 kg, Glúten 1000/1260 kg, Calcítico/Calcário 1000 kg) são referências preliminares e não devem ser fixados sem documento.',
      sourceA: 'Anotação de campo: PESO DOS BAGS',
      sourceB: 'Etiqueta / Nota Fiscal / Conferência do operador no recebimento',
      status: 'PENDENTE',
      resolutionNotes: null,
      createdAt: nowIso,
      resolvedAt: null,
    },
    {
      id: 6,
      entityType: 'TRANSFER_RULE',
      entityRef: 'ROTAS_ANOTADAS',
      title: 'Homologação de rotas de transferência anotadas em caderno',
      description: 'Apenas Silo 37 -> Silos 10 e 15 (Veículo Premix) foi validada. Rotas S38->12/21, S34->31, S35->13 e S39->11/31 permanecem pendentes de validação oficial.',
      sourceA: 'Anotação de caderno (Transferência)',
      sourceB: 'Matriz oficial de compatibilidade e engenharia da planta',
      status: 'PENDENTE',
      resolutionNotes: null,
      createdAt: nowIso,
      resolvedAt: null,
    },
  ];

  const buildOfficialRules = (siloByNum: Map<number, SiloDetail>): { transferRules: TransferRuleItem[]; routes: AuthorizedRouteItem[] } => {
    const rawRules: Array<{
      id: number;
      origin: number;
      dest: number;
      mat: MaterialItem;
      auth: 'AUTORIZADA' | 'PENDENTE_VALIDACAO';
      val: 'VALIDADO' | 'PENDENTE_VALIDACAO';
      active: boolean;
      ref: string;
    }> = [
      { id: 1, origin: 37, dest: 10, mat: matPremix, auth: 'AUTORIZADA', val: 'VALIDADO', active: true, ref: 'Confirmado pelo operador (Seção 18): Silo 37 Veículo Premix -> Silo 10' },
      { id: 2, origin: 37, dest: 15, mat: matPremix, auth: 'AUTORIZADA', val: 'VALIDADO', active: true, ref: 'Confirmado pelo operador (Seção 18): Silo 37 Veículo Premix -> Silo 15' },
      { id: 3, origin: 38, dest: 12, mat: matCal, auth: 'PENDENTE_VALIDACAO', val: 'PENDENTE_VALIDACAO', active: false, ref: 'Anotação de caderno: Silo 38 -> 12 (Calcário). Aguarda validação.' },
      { id: 4, origin: 38, dest: 21, mat: matCal, auth: 'PENDENTE_VALIDACAO', val: 'PENDENTE_VALIDACAO', active: false, ref: 'Anotação de caderno: Silo 38 -> 21 (Calcário). Aguarda validação.' },
      { id: 5, origin: 34, dest: 31, mat: matGluten, auth: 'PENDENTE_VALIDACAO', val: 'PENDENTE_VALIDACAO', active: false, ref: 'Anotação de caderno: Silo 34 -> 31 (Glúten). Aguarda validação.' },
      { id: 6, origin: 37, dest: 9, mat: matPremix, auth: 'PENDENTE_VALIDACAO', val: 'PENDENTE_VALIDACAO', active: false, ref: 'Anotação de caderno: Silo 37 -> 9 (Veículo Premix). Aguarda validação.' },
      { id: 7, origin: 35, dest: 13, mat: matFosfMono, auth: 'PENDENTE_VALIDACAO', val: 'PENDENTE_VALIDACAO', active: false, ref: 'Anotação de caderno: Silo 35 -> 13 (Fosfato Mono 21%). Aguarda validação.' },
      { id: 8, origin: 39, dest: 11, mat: matFosfBi, auth: 'PENDENTE_VALIDACAO', val: 'PENDENTE_VALIDACAO', active: false, ref: 'Anotação de caderno: Silo 39 -> 11 (Fosfato Bi 19%). Aguarda validação.' },
      { id: 13, origin: 39, dest: 31, mat: matGluten, auth: 'PENDENTE_VALIDACAO', val: 'PENDENTE_VALIDACAO', active: false, ref: 'Regra preliminar Fase 4: Silo 39 -> Silo 31 (Glúten), sujeita à validação administrativa.' },
    ];

    const transferRules: TransferRuleItem[] = rawRules.map((r) => {
      const originSilo = siloByNum.get(r.origin)!;
      const destSilo = siloByNum.get(r.dest)!;
      return {
        id: r.id,
        originSiloId: originSilo.id,
        destinationSiloId: destSilo.id,
        originSiloNumber: r.origin,
        destinationSiloNumber: r.dest,
        materialId: r.mat.id,
        materialCode: r.mat.code,
        materialDescription: r.mat.description,
        operationType: 'TRANSFERENCIA_INTERNA',
        maxQuantityKg: null,
        requiresAuthorization: !r.active,
        authorizationStatus: r.auth,
        validationStatus: r.val,
        isActive: r.active,
        restrictions: r.active ? 'Rota homologada e ativa no cadastro oficial.' : 'Pendente de validação oficial pela Supervisão/Administração.',
        sourceReference: r.ref,
      };
    });

    const routes: AuthorizedRouteItem[] = transferRules.map((tr) => {
      const destSilo = siloByNum.get(tr.destinationSiloNumber!)!;
      return {
        id: tr.id,
        originSiloId: tr.originSiloId,
        destinationSiloId: tr.destinationSiloId,
        originSiloNumber: tr.originSiloNumber,
        destinationSiloNumber: tr.destinationSiloNumber,
        materialId: tr.materialId,
        materialCode: tr.materialCode,
        materialDescription: tr.materialDescription,
        relatedLineId: destSilo.productionLineId,
        relatedLineCode: destSilo.lineCode,
        relatedLineName: destSilo.lineName,
        operationType: tr.operationType,
        maxQuantityKg: null,
        requiresAuthorization: tr.requiresAuthorization,
        authorizationStatus: (tr.authorizationStatus || 'PENDENTE_VALIDACAO') as AuthorizedRouteItem['authorizationStatus'],
        validationStatus: tr.validationStatus,
        isActive: tr.isActive,
        restrictions: tr.restrictions,
        sourceReference: tr.sourceReference,
        approvedByName: tr.isActive ? 'Administração Oficial NEXO LOG' : null,
        approvedAt: tr.isActive ? nowIso : null,
        updatedByName: 'Catálogo Oficial PostgreSQL',
        updatedAt: nowIso,
        createdAt: nowIso,
        history: [],
      };
    });

    return { transferRules, routes };
  };

  return { bagConfigs, pendencies, buildOfficialRules };
}

function buildSilosForMode(thresholds: StockThresholdItem[], mode: PresentationViewMode, nowIso: string): SiloDetail[] {
  const totalStockByMat = new Map<number, number>();
  for (const def of DEMO_SILO_DEFS) {
    const mat = MAT_BY_CODE.get(def.materialCode) || BASE_MATERIALS[0];
    const stockKg = mode === 'CENARIO_REALISTA' ? def.demoStockKg : 0;
    totalStockByMat.set(mat.id, (totalStockByMat.get(mat.id) ?? 0) + stockKg);
  }

  return DEMO_SILO_DEFS.map((def, idx) => {
    const id = idx + 1;
    const mat = MAT_BY_CODE.get(def.materialCode) || BASE_MATERIALS[0];
    const line = LINE_BY_CODE.get(def.lineCode) || BASE_LINES[6];
    const stockKg = mode === 'CENARIO_REALISTA' ? def.demoStockKg : 0;
    const opStatus = mode === 'CENARIO_REALISTA' ? (def.demoStatus ?? 'OPERACIONAL') : 'OPERACIONAL';
    const isReceiving = mode === 'CENARIO_REALISTA' ? Boolean(def.demoIsReceiving) : false;
    const occupancyPercent =
      def.safeCapacityKg > 0 ? Math.round((stockKg / def.safeCapacityKg) * 1000) / 10 : 0;

    const specificThreshold = thresholds.find((t) => t.siloId === id || t.siloNumber === def.siloNumber);
    const globalThreshold = !specificThreshold
      ? thresholds.find((t) => !t.siloId && !t.siloNumber && t.materialId === mat.id)
      : undefined;

    const evalRes = evaluateSiloStockStatus({
      confirmedStockKg: stockKg,
      safeCapacityKg: def.safeCapacityKg,
      occupancyPercent,
      operationalStatus: opStatus,
      primaryMaterialId: mat.id,
      siloThreshold: specificThreshold
        ? { minStockKg: specificThreshold.minStockKg, warningStockKg: specificThreshold.warningStockKg }
        : null,
      globalThreshold: globalThreshold
        ? {
            minStockKg: globalThreshold.minStockKg,
            warningStockKg: globalThreshold.warningStockKg,
            totalMaterialStockKg: totalStockByMat.get(mat.id) ?? stockKg,
          }
        : null,
      activeRecommendationPriority: mode === 'CENARIO_REALISTA' ? (def.demoRecPriority ?? null) : null,
      activeRecommendationReason: mode === 'CENARIO_REALISTA' ? (def.demoRecReason ?? null) : null,
    });

    return {
      id,
      siloNumber: def.siloNumber,
      rubricOrder: def.rubricOrder,
      category: def.category,
      controlOwner: def.controlOwner,
      productionLineId: line.id,
      lineCode: line.code,
      lineName: line.name,
      heightMeters: def.heightMeters,
      cordaMeters: def.cordaMeters,
      nominalCapacityKg: def.nominalCapacityKg,
      safetyFactorPercent: 10,
      safeCapacityKg: def.safeCapacityKg,
      primaryMaterialId: mat.id,
      materialCode: mat.code,
      materialDescription: mat.description,
      materialCategory: mat.category,
      materialHandlingType: mat.handlingType,
      operationalStatus: opStatus,
      cleaningStatus: opStatus === 'MANUTENCAO' ? 'REQUER_LIMPEZA' : 'EM_USO',
      isDividedCompartment: def.isDividedCompartment,
      restrictions:
        mode === 'CENARIO_REALISTA' && opStatus === 'MANUTENCAO'
          ? '[CENÁRIO DEMO] Manutenção preventiva programada'
          : null,
      validationStatus: def.validationStatus,
      validationNotes: def.validationNotes,
      confirmedStockKg: stockKg,
      availableSpaceKg: Math.max(0, def.safeCapacityKg - stockKg),
      occupancyPercent,
      stockAlertLevel: evalRes.stockAlertLevel,
      stockAlertReason: evalRes.stockAlertReason,
      minStockKg: evalRes.minStockKg,
      warningStockKg: evalRes.warningStockKg,
      isReceiving,
      lastMovementAt: stockKg > 0 ? nowIso : null,
      updatedAt: nowIso,
      compatibilities: [
        {
          id: id * 10 + 1,
          siloId: id,
          materialId: mat.id,
          materialCode: mat.code,
          materialDescription: mat.description,
          isPrimary: true,
          allowReceiving: def.category !== 'PRODUCAO',
          allowTransferIn: true,
          allowTransferOut: def.category === 'ARMAZENAGEM',
          validationStatus: def.validationStatus,
        },
      ],
    };
  });
}

// Recalcula projeções, totais de inteligência e resumo do painel de abastecimento a partir dos dados correntes do estado
export function recomputeDemoDerivedState(state: DemoSandboxState): void {
  const activeShift = resolveOperationalShift();
  const today = state.session.shift.operationalDate || activeShift.operationalDate;
  const tomorrow = addDaysToYmd(today, 1);

  const siloByNum = new Map(state.silos.map((s) => [s.siloNumber, s]));
  const matById = new Map(state.materials.map((m) => [m.id, m]));
  const approvedSchedules = state.schedules.filter((s) => s.status === 'APROVADA');

  // 1. Atualiza supplyBoard.boardRows a partir dos silos + rotas + programações reais no sandbox
  const pendingReceiptsByMat = new Map<number, number>();
  for (const r of state.receipts) {
    if (r.status === 'PARCIAL' || r.status === 'PENDENTE') {
      pendingReceiptsByMat.set(r.materialId, (pendingReceiptsByMat.get(r.materialId) || 0) + r.remainingQuantityKg);
    }
  }

  const pendingInboundBySilo = new Map<number, number>();
  for (const o of state.transferOrders) {
    if (o.status === 'PLANEJADA' || o.status === 'EM_ANDAMENTO' || o.status === 'PARCIAL') {
      pendingInboundBySilo.set(o.destinationSiloId, (pendingInboundBySilo.get(o.destinationSiloId) || 0) + o.remainingQuantityKg);
    }
  }

  for (const row of state.supplyBoard.boardRows) {
    // Atualiza saldos atuais dos silos alimentadores
    row.feedingSilos = row.feedingSilos.map((fs) => {
      const liveSilo = state.silos.find((s) => s.id === fs.siloId || s.siloNumber === fs.siloNumber);
      if (!liveSilo) return fs;
      return {
        ...fs,
        confirmedStockKg: liveSilo.confirmedStockKg,
        safeCapacityKg: liveSilo.safeCapacityKg,
        availableSpaceKg: liveSilo.availableSpaceKg,
        operationalStatus: liveSilo.operationalStatus,
        validationStatus: liveSilo.validationStatus,
      };
    });
    row.currentStockKg = row.feedingSilos.reduce((a, fs) => a + fs.confirmedStockKg, 0);

    // Atualiza consumo a partir das programações do dia/amanhã quando houver correspondência
    const todayProjs = approvedSchedules
      .filter((sc) => sc.referenceDate === today)
      .flatMap((sc) => sc.items.filter((it) => it.lineCode === row.lineCode))
      .flatMap((it) => it.projections.filter((p) => p.materialId === row.materialId));
    if (todayProjs.length > 0) {
      row.plannedConsumptionTodayKg = todayProjs.reduce((a, p) => a + p.calculatedConsumptionKg, 0);
      row.realizedConsumptionKg = todayProjs.reduce((a, p) => a + p.realizedConsumptionKg, 0);
    }
    const tomorrowProjs = approvedSchedules
      .filter((sc) => sc.referenceDate === tomorrow)
      .flatMap((sc) => sc.items.filter((it) => it.lineCode === row.lineCode))
      .flatMap((it) => it.projections.filter((p) => p.materialId === row.materialId));
    if (tomorrowProjs.length > 0) {
      row.plannedConsumptionTomorrowKg = tomorrowProjs.reduce((a, p) => a + p.calculatedConsumptionKg, 0);
    }

    row.remainingConsumptionKg = Math.max(0, row.plannedConsumptionTodayKg - row.realizedConsumptionKg);
    row.deficitOrSurplusKg = row.currentStockKg - row.remainingConsumptionKg;
    row.pendingTransferInboundKg = row.feedingSilos.reduce(
      (a, fs) => a + (pendingInboundBySilo.get(fs.siloId) || 0),
      0
    );
    row.confirmedPendingReceiptKg = row.materialId ? pendingReceiptsByMat.get(row.materialId) || 0 : 0;

    // Verifica rota homologada ativa
    const destIds = new Set(row.feedingSilos.map((f) => f.siloId));
    const activeRoute = state.routes.find(
      (r) => r.materialId === row.materialId && destIds.has(r.destinationSiloId) && r.authorizationStatus === 'AUTORIZADA' && r.isActive
    );
    const anyRoute = state.routes.find((r) => r.materialId === row.materialId && destIds.has(r.destinationSiloId));
    if (activeRoute) {
      const origSilo = state.silos.find((s) => s.id === activeRoute.originSiloId);
      row.suggestedOriginSiloId = activeRoute.originSiloId;
      row.suggestedOriginSiloNumber = activeRoute.originSiloNumber;
      row.suggestedTransferRuleId = activeRoute.id;
      row.hasAuthorizedRouteWithStock = Boolean(origSilo && origSilo.confirmedStockKg > 0);
    } else if (anyRoute) {
      row.hasAuthorizedRouteWithStock = false;
    }

    // Verifica se há projeção pendente de fator para esta linha/material
    const hasPendingFactor = approvedSchedules
      .filter((sc) => sc.referenceDate === today || sc.referenceDate === tomorrow)
      .flatMap((sc) => sc.items.filter((it) => it.lineCode === row.lineCode))
      .flatMap((it) => it.projections.filter((p) => p.materialId === row.materialId))
      .some((p) => p.calculationStatus === 'PENDENTE_FATOR');

    // Recalcula status visual conforme saldo
    const hasCriticalSilo = row.feedingSilos.some((fs) => {
      const s = state.silos.find((x) => x.id === fs.siloId);
      return s?.stockAlertLevel === 'CRITICO';
    });
    if (hasPendingFactor && row.plannedConsumptionTodayKg === 0 && row.plannedConsumptionTomorrowKg === 0) {
      row.supplyStatus = 'CINZA';
      row.needsTransfer = false;
    } else if (row.deficitOrSurplusKg < 0 || hasCriticalSilo) {
      row.supplyStatus = 'VERMELHO';
      row.needsTransfer = true;
    } else if (row.currentStockKg < row.remainingConsumptionKg + row.plannedConsumptionTomorrowKg * 0.5) {
      row.supplyStatus = 'LARANJA';
      row.needsTransfer = true;
    } else {
      row.supplyStatus = 'VERDE';
      row.needsTransfer = false;
    }
  }

  state.supplyBoard.summary = {
    totalRows: state.supplyBoard.boardRows.length,
    redCount: state.supplyBoard.boardRows.filter((r) => r.supplyStatus === 'VERMELHO').length,
    orangeCount: state.supplyBoard.boardRows.filter((r) => r.supplyStatus === 'LARANJA').length,
    yellowCount: state.supplyBoard.boardRows.filter((r) => r.supplyStatus === 'AMARELO').length,
    greenCount: state.supplyBoard.boardRows.filter((r) => r.supplyStatus === 'VERDE').length,
    grayCount: state.supplyBoard.boardRows.filter((r) => r.supplyStatus === 'CINZA').length,
    totalDeficitKg: state.supplyBoard.boardRows.reduce((a, r) => a + (r.deficitOrSurplusKg < 0 ? Math.abs(r.deficitOrSurplusKg) : 0), 0),
    totalSuggestedTransferKg: state.supplyBoard.boardRows.reduce((a, r) => a + (r.needsTransfer ? r.suggestedTransferKg : 0), 0),
  };

  // 2. Atualiza intelligenceSummary com soma exata dos 54 silos + programações
  const totalRealStockKg = state.silos.reduce((a, s) => a + s.confirmedStockKg, 0);
  const confirmedPendingEntriesKg = Array.from(pendingReceiptsByMat.values()).reduce((a, b) => a + b, 0);

  let pendingFactorCount = 0;
  let plannedTodayTotal = 0;
  let plannedTomorrowTotal = 0;
  let realizedTotal = 0;

  for (const sc of approvedSchedules) {
    for (const it of sc.items) {
      for (const p of it.projections) {
        if (sc.referenceDate === today || sc.referenceDate === tomorrow) {
          if (p.calculationStatus === 'PENDENTE_FATOR') pendingFactorCount += 1;
        }
        if (sc.referenceDate === today) {
          plannedTodayTotal += p.calculatedConsumptionKg;
          realizedTotal += p.realizedConsumptionKg;
        } else if (sc.referenceDate === tomorrow) {
          plannedTomorrowTotal += p.calculatedConsumptionKg;
        }
      }
    }
  }

  for (const row of state.intelligenceSummary.byMaterial) {
    const matSilos = state.silos.filter((s) => s.primaryMaterialId === row.materialId);
    row.realStockKg = matSilos.reduce((a, s) => a + s.confirmedStockKg, 0);
    row.confirmedPendingEntriesKg = pendingReceiptsByMat.get(row.materialId) || 0;

    let matToday = 0;
    let matTomorrow = 0;
    let matRealized = 0;
    let matPendingFactor = 0;
    for (const sc of approvedSchedules) {
      for (const it of sc.items) {
        for (const p of it.projections) {
          if (p.materialId !== row.materialId) continue;
          if ((sc.referenceDate === today || sc.referenceDate === tomorrow) && p.calculationStatus === 'PENDENTE_FATOR') {
            matPendingFactor += 1;
          }
          if (sc.referenceDate === today) {
            matToday += p.calculatedConsumptionKg;
            matRealized += p.realizedConsumptionKg;
          } else if (sc.referenceDate === tomorrow) {
            matTomorrow += p.calculatedConsumptionKg;
          }
        }
      }
    }
    row.plannedConsumptionTodayKg = matToday;
    row.plannedConsumptionTomorrowKg = matTomorrow;
    row.realizedConsumptionKg = matRealized;
    row.remainingPlannedTodayActiveKg = Math.max(0, matToday - matRealized);
    row.remainingTotalPlannedKg = row.remainingPlannedTodayActiveKg + matTomorrow;
    row.projectedBalanceTodayKg = row.realStockKg + row.confirmedPendingEntriesKg - row.remainingPlannedTodayActiveKg;
    row.projectedBalanceWithTomorrowKg = row.projectedBalanceTodayKg - matTomorrow;
    row.pendingFactorItemsCount = matPendingFactor;

    const hasCritSiloForMat = matSilos.some((s) => s.stockAlertLevel === 'CRITICO');
    const hasWarnSiloForMat = matSilos.some((s) => s.stockAlertLevel === 'ATENCAO');
    if (row.projectedBalanceTodayKg < 0 || hasCritSiloForMat || (row.minStockKg !== null && row.realStockKg < row.minStockKg)) {
      row.statusPriority = 'VERMELHO';
    } else if (matPendingFactor > 0) {
      row.statusPriority = 'AZUL';
    } else if (
      row.projectedBalanceWithTomorrowKg < 0 ||
      hasWarnSiloForMat ||
      (row.warningStockKg !== null && row.realStockKg < row.warningStockKg)
    ) {
      row.statusPriority = 'LARANJA';
    } else {
      row.statusPriority = 'VERDE';
    }
  }

  const remainingTotalToday = Math.max(0, plannedTodayTotal - realizedTotal);
  state.intelligenceSummary.todayDate = today;
  state.intelligenceSummary.tomorrowDate = tomorrow;
  state.intelligenceSummary.totals = {
    realStockKg: totalRealStockKg,
    confirmedPendingEntriesKg,
    plannedConsumptionTodayKg: plannedTodayTotal,
    plannedConsumptionTomorrowKg: plannedTomorrowTotal,
    realizedConsumptionKg: realizedTotal,
    projectedBalanceTotalKg: totalRealStockKg + confirmedPendingEntriesKg - remainingTotalToday,
    criticalMaterialsCount: state.intelligenceSummary.byMaterial.filter((r) => r.statusPriority === 'VERMELHO' || r.statusPriority === 'LARANJA').length,
    pendingSupplyCount: state.supplyBoard.recommendations.filter((r) => r.decisionStatus !== 'REJEITADA' && r.decisionStatus !== 'EXECUTADA').length + pendingFactorCount,
  };

  // Mantém referência de material em caso de consulta
  void siloByNum;
  void matById;
}

export function buildDemoAutoSummary(
  state: DemoSandboxState,
  shiftCodeParam?: string,
  operationalDateParam?: string
): ShiftAutoSummarySnapshot {
  const shiftCode = (shiftCodeParam || state.session.shift.shiftCode) as ShiftCode;
  const operationalDate = operationalDateParam || state.session.shift.operationalDate;
  const shiftCfg = state.shifts.find((s) => s.code === shiftCode) || state.shifts[0];

  const matchingReceipts = state.receipts.filter((r) => {
    const startedHere =
      (r.startedOperationalDate || r.operationalDate) === operationalDate &&
      (r.startedShiftCode || r.shiftCode) === shiftCode;
    const finishedHere =
      r.finishedOperationalDate === operationalDate && r.finishedShiftCode === shiftCode;
    const distHere = r.distributions.some(
      (d) => d.operationalDate === operationalDate && d.shiftCode === shiftCode
    );
    return startedHere || finishedHere || distHere;
  });
  const matchingOrders = state.transferOrders.filter(
    (o) =>
      o.operationalDate === operationalDate && (!shiftCodeParam || o.shiftCode === shiftCode)
  );
  const matchingMovements = state.movements.filter(
    (m) =>
      m.status === 'CONFIRMADO' &&
      m.operationalDate === operationalDate &&
      (!shiftCodeParam || m.shiftCode === shiftCode)
  );

  const materialsReceivedMap = new Map<string, { code: string; description: string; kg: number }>();
  const silosFedMap = new Map<string, { siloNumber: number; kg: number; materialCode: string }>();
  let bagCutCount = 0;

  const vehicleInputs: VehicleReceiptInput[] = [];
  for (const r of state.receipts) {
    const distsInShift = r.distributions.filter(
      (d) => d.operationalDate === operationalDate && d.shiftCode === shiftCode
    );
    const distributedInShiftKg = distsInShift.reduce((acc, d) => acc + d.quantityKg, 0);
    const siloNumbers = Array.from(
      new Set(
        (distsInShift.length > 0 ? distsInShift : r.distributions)
          .map((d) => d.siloNumber)
          .filter((n) => n > 0)
      )
    );

    if (r.receivingType === 'BIG_BAG' && (r.operationalDate === operationalDate && r.shiftCode === shiftCode)) {
      bagCutCount += r.bagCount || 0;
    }

    vehicleInputs.push({
      receiptId: r.id,
      receiptNumber: r.receiptNumber,
      materialId: r.materialId,
      materialCode: r.materialCode,
      materialDescription: r.materialDescription,
      supplierName: r.supplierName,
      invoiceNumber: r.invoiceNumber,
      vehiclePlate: r.vehiclePlate ?? null,
      driverName: r.driverName ?? null,
      carrierName: r.carrierName ?? null,
      receivingType: r.receivingType,
      bagCount: r.bagCount,
      receivedKg: r.receivedQuantityKg,
      distributedKgTotal: r.distributedQuantityKg,
      distributedInShiftKg,
      status: r.status,
      startedAtIso: r.startedAt,
      finishedAtIso: r.finishedAt,
      startedShiftCode: r.startedShiftCode || r.shiftCode,
      startedOperationalDate: r.startedOperationalDate || r.operationalDate,
      finishedShiftCode: r.finishedShiftCode ?? (r.status === 'CONCLUIDO' ? r.shiftCode : null),
      finishedOperationalDate:
        r.finishedOperationalDate ?? (r.status === 'CONCLUIDO' ? r.operationalDate : null),
      siloNumbers,
      operatorName: r.operatorName,
      operatorBadge: r.operatorBadge ?? null,
      executedByName: r.executedByName ?? null,
      executedByBadge: r.executedByBadge ?? null,
    });
  }

  for (const r of matchingReceipts) {
    const prev = materialsReceivedMap.get(r.materialCode) || {
      code: r.materialCode,
      description: r.materialDescription,
      kg: 0,
    };
    prev.kg += r.receivedQuantityKg;
    materialsReceivedMap.set(r.materialCode, prev);

    for (const d of r.distributions) {
      if (d.operationalDate !== operationalDate || d.shiftCode !== shiftCode) continue;
      const key = `${d.siloNumber}::${r.materialCode}`;
      const sf = silosFedMap.get(key) || {
        siloNumber: d.siloNumber,
        kg: 0,
        materialCode: r.materialCode,
      };
      sf.kg += d.quantityKg;
      silosFedMap.set(key, sf);
    }
  }

  const vehicleBreakdown = classifyShiftVehicles({
    shiftCode,
    operationalDate,
    receipts: vehicleInputs,
  });

  const completedOrders = matchingOrders.filter((o) => o.status === 'CONCLUIDA');
  const pendingOrders = matchingOrders.filter(
    (o) => o.status === 'PLANEJADA' || o.status === 'EM_ANDAMENTO' || o.status === 'PARCIAL'
  );
  const partialReceipts = matchingReceipts.filter((r) => r.status === 'PARCIAL' || r.status === 'PENDENTE');

  const criticalStocks = state.silos
    .filter((s) => s.stockAlertLevel === 'CRITICO' || s.stockAlertLevel === 'ATENCAO')
    .map((s) => ({
      materialCode: s.materialCode || '—',
      description: `${s.materialDescription || 'MP'} (Silo ${s.siloNumber})`,
      realStockKg: s.confirmedStockKg,
      minStockKg: s.minStockKg ?? 0,
    }));

  const unavailableSilos = state.silos
    .filter((s) => s.operationalStatus !== 'OPERACIONAL')
    .map((s) => ({
      siloNumber: s.siloNumber,
      operationalStatus: s.operationalStatus,
      restrictions: s.restrictions,
    }));

  const shiftOccs = state.occurrences.filter(
    (o) => o.operationalDate === operationalDate && o.shiftCode === shiftCode
  );
  const openOccs = state.occurrences.filter((o) => o.status !== 'ENCERRADA');

  const events = matchingMovements
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((m) => {
      const d = new Date(m.createdAt);
      const timeLabel = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return {
        timestampIso: m.createdAt,
        timeLabel,
        category: m.movementType,
        summary: `${m.reason || m.movementType} — ${m.materialDescription} (${m.quantityKg.toLocaleString('pt-BR')} kg · Silo ${m.siloNumber ?? '—'})`,
      };
    });

  const adjustmentMovs = matchingMovements.filter((m) => m.movementType === 'AJUSTE_AUTORIZADO');
  const shiftOperatorsMap = new Map<string, { displayName: string; badgeCode: string | null; jobTitle: string | null }>();
  for (const m of matchingMovements) {
    if (!m.operatorName || m.operatorName.includes('Sistema')) continue;
    shiftOperatorsMap.set(m.operatorName, {
      displayName: m.operatorName,
      badgeCode: m.operatorBadge ?? null,
      jobTitle: 'Operador de Moega',
    });
  }

  return {
    shiftCode,
    shiftName: shiftCfg ? `${shiftCfg.name} (${shiftCfg.startTime}–${shiftCfg.endTime})` : shiftCode,
    operationalDate,
    generatedAtIso: new Date().toISOString(),
    receiptsCount: matchingReceipts.length,
    receivedKg: matchingReceipts.reduce((a, r) => a + r.receivedQuantityKg, 0),
    distributedKg: matchingReceipts.reduce(
      (a, r) =>
        a +
        r.distributions
          .filter((d) => d.operationalDate === operationalDate && d.shiftCode === shiftCode)
          .reduce((da, d) => da + d.quantityKg, 0),
      0
    ),
    vehiclesOrInvoices: matchingReceipts.map((r) => `${r.invoiceNumber || r.receiptNumber} (${r.vehiclePlate || r.receivingPoint || 'Moega'})`),
    materialsReceived: Array.from(materialsReceivedMap.values()),
    silosFed: Array.from(silosFedMap.values()),
    transfersCompletedCount: completedOrders.length,
    transfersCompletedKg: completedOrders.reduce((a, o) => a + o.transferredQuantityKg, 0),
    transfersPendingCount: pendingOrders.length,
    transfersPendingCodes: pendingOrders.map((o) => o.orderCode),
    partialDischargesCount: partialReceipts.length,
    partialReceiptNumbers: partialReceipts.map((r) => r.receiptNumber),
    criticalStocks,
    updatedSchedules: state.schedules
      .filter((sc) => sc.referenceDate === operationalDate)
      .map((sc) => ({ scheduleCode: sc.scheduleCode, revisionNumber: sc.revisionNumber, status: sc.status })),
    activeAlertsCount: state.intelligenceSummary.alerts.length,
    activeAlertsList: state.intelligenceSummary.alerts.map((a) => a.title),
    openSupplyRequestsCount: state.supplyBoard.intakeRequests.filter((i) => i.status === 'ABERTA').length,
    openOccurrencesCount: openOccs.length,
    openOccurrencesList: openOccs.map((o) => `${o.occurrenceCode}: ${o.title}`),
    unavailableSilos,
    chronologicalEvents: events,
    vehicleBreakdown,
    shiftOperators: Array.from(shiftOperatorsMap.values()),
    stockAdjustmentsCount: adjustmentMovs.length,
    stockAdjustmentsSummary: adjustmentMovs.map(
      (a) => `Silo ${a.siloNumber ?? '—'} (${a.materialCode}: ${a.direction === 'CREDIT' ? '+' : '-'}${Math.round(a.quantityKg)} kg)`
    ),
    bagCutCount,
    basketUpdates: state.basketVersions
      .filter((bv) => bv.productionDate === operationalDate)
      .map((bv) => ({
        versionCode: bv.versionCode,
        label: bv.label,
        productionDate: bv.productionDate,
        status: bv.status,
      })),
    shiftOccurrences: shiftOccs.map((o) => ({
      occurrenceCode: o.occurrenceCode,
      timeLabel: o.occurredAt.slice(11, 16) || '00:00',
      category: o.category,
      title: o.title,
      description: o.description,
      status: o.status,
      weatherCondition: o.weatherCondition ?? null,
      lineImpact: o.lineImpact ?? null,
      verifiedByName: o.verifiedByName ?? null,
      reportedByName: o.reportedByName,
    })),
    movementsTotalCount: matchingMovements.length,
  };
}

function buildRealisticScenarioCollections(
  silos: SiloDetail[],
  routes: AuthorizedRouteItem[],
  activeShift: ReturnType<typeof resolveOperationalShift>
) {
  const today = activeShift.operationalDate;
  const yesterday = addDaysToYmd(today, -1);
  const tomorrow = addDaysToYmd(today, 1);
  const nowIso = activeShift.realTimestampIso;

  const siloByNum = new Map(silos.map((s) => [s.siloNumber, s]));
  const s9 = siloByNum.get(9)!;
  const s10 = siloByNum.get(10)!;
  const s12 = siloByNum.get(12)!;
  const s13 = siloByNum.get(13)!;
  const s15 = siloByNum.get(15)!;
  const s17 = siloByNum.get(17)!;
  const s20 = siloByNum.get(20)!;
  const s21 = siloByNum.get(21)!;
  const s23 = siloByNum.get(23)!;
  const s25 = siloByNum.get(25)!;
  const s26 = siloByNum.get(26)!;
  const s28 = siloByNum.get(28)!;
  const s29 = siloByNum.get(29)!;
  const s35 = siloByNum.get(35)!;
  const s37 = siloByNum.get(37)!;
  const s38 = siloByNum.get(38)!;
  const s40 = siloByNum.get(40)!;
  const s41 = siloByNum.get(41)!;
  const s42 = siloByNum.get(42)!;
  const s43 = siloByNum.get(43)!;

  const matCal = MAT_BY_CODE.get('2017101021')!;
  const matFosfBi = MAT_BY_CODE.get('2019101141')!;
  const matFosfMono = MAT_BY_CODE.get('2019131030')!;
  const matCaulim = MAT_BY_CODE.get('2090121061')!;
  const matPremix = MAT_BY_CODE.get('1113101920')!;
  const matMilhoBc = MAT_BY_CODE.get('1211101012')!;
  const matAlgodao = MAT_BY_CODE.get('1614161040')!;
  const matGermen = MAT_BY_CODE.get('1613131012')!;
  const matQuirera = MAT_BY_CODE.get('F30BMOA80')!;
  const matVisceras = MAT_BY_CODE.get('1553241021')!;
  const matSalMoido = MAT_BY_CODE.get('2021171023')!;

  const supPinheiro = BASE_SUPPLIERS[0];
  const supMassari = BASE_SUPPLIERS[1];
  const supDreyfus = BASE_SUPPLIERS[2];
  const supMosaic = BASE_SUPPLIERS[3];

  const todayTag = today.replace(/-/g, '');

  const receipts: ReceiptItem[] = [
    {
      id: 1,
      receiptNumber: `REC-DEMO-${todayTag}-04`,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      supplierId: supPinheiro.id,
      supplierName: supPinheiro.name,
      invoiceNumber: 'NF 048.912',
      lotCode: '0011647908',
      entryDate: today,
      receivedQuantityKg: 38840,
      distributedQuantityKg: 20000,
      remainingQuantityKg: 18840,
      unit: 'KG',
      receivingType: 'GRANEL',
      bagCount: null,
      bagUnitWeightKg: null,
      receivingPoint: 'Moega 01 · Placa ABC-4D21',
      vehiclePlate: 'ABC-4D21',
      driverName: 'Marcos Oliveira',
      carrierName: 'TransPinheiro Log',
      status: 'PARCIAL',
      operatorUserId: 901,
      operatorName: 'Carlos Silva (Operador Moega [DEMO])',
      operatorBadge: 'OP-101',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      startedShiftCode: 'TURNO_1',
      startedOperationalDate: today,
      finishedShiftCode: null,
      finishedOperationalDate: null,
      startedAt: makeIsoAtLocalTime(today, '11:20'),
      finishedAt: null,
      notes: '[CENÁRIO DEMO] Motorista: Marcos Oliveira | Descarga parcial em andamento no Silo 21; saldo de 18.840 kg previsto para Silo 38.',
      version: 1,
      createdAt: makeIsoAtLocalTime(today, '11:20'),
      distributions: [
        {
          id: 1,
          receiptId: 1,
          siloId: s21.id,
          siloNumber: 21,
          quantityKg: 20000,
          bagCount: null,
          movementId: 101,
          status: 'CONFIRMADA',
          isComplement: false,
          operatorName: 'Carlos Silva [DEMO]',
          operatorBadge: 'OP-101',
          shiftCode: 'TURNO_1',
          operationalDate: today,
          notes: '[CENÁRIO DEMO] 1ª etapa de descarga concluída no Silo 21.',
          createdAt: makeIsoAtLocalTime(today, '11:45'),
        },
      ],
    },
    {
      id: 2,
      receiptNumber: `REC-DEMO-${todayTag}-03`,
      materialId: matCaulim.id,
      materialCode: matCaulim.code,
      materialDescription: matCaulim.description,
      supplierId: supMassari.id,
      supplierName: supMassari.name,
      invoiceNumber: 'NF 019.304',
      lotCode: '0011606870',
      entryDate: today,
      receivedQuantityKg: 12000,
      distributedQuantityKg: 12000,
      remainingQuantityKg: 0,
      unit: 'KG',
      receivingType: 'BIG_BAG',
      bagCount: 10,
      bagUnitWeightKg: 1200,
      receivingPoint: 'Moega Bags · Placa XYZ-9H88',
      vehiclePlate: 'XYZ-9H88',
      driverName: 'Roberto Santos',
      carrierName: 'Massari Transportes',
      status: 'CONCLUIDO',
      operatorUserId: 902,
      operatorName: 'João Mendes (Operador Moega [DEMO])',
      operatorBadge: 'OP-102',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      startedShiftCode: 'TURNO_1',
      startedOperationalDate: today,
      finishedShiftCode: 'TURNO_1',
      finishedOperationalDate: today,
      startedAt: makeIsoAtLocalTime(today, '08:10'),
      finishedAt: makeIsoAtLocalTime(today, '08:52'),
      notes: '[CENÁRIO DEMO] Motorista: Roberto Santos | 10 Big Bags de 1.200 kg conferidos via etiqueta RQ-REC-044.',
      version: 1,
      createdAt: makeIsoAtLocalTime(today, '08:10'),
      distributions: [
        {
          id: 2,
          receiptId: 2,
          siloId: s17.id,
          siloNumber: 17,
          quantityKg: 12000,
          bagCount: 10,
          movementId: 102,
          status: 'CONFIRMADA',
          isComplement: false,
          operatorName: 'João Mendes [DEMO]',
          operatorBadge: 'OP-102',
          shiftCode: 'TURNO_1',
          operationalDate: today,
          notes: '[CENÁRIO DEMO] Carga integral direcionada ao Silo 17.',
          createdAt: makeIsoAtLocalTime(today, '08:52'),
        },
      ],
    },
    {
      id: 3,
      receiptNumber: `REC-DEMO-${todayTag}-02`,
      materialId: matFosfMono.id,
      materialCode: matFosfMono.code,
      materialDescription: matFosfMono.description,
      supplierId: supMosaic.id,
      supplierName: supMosaic.name,
      invoiceNumber: 'NF 077.510',
      lotCode: '0020198812',
      entryDate: today,
      receivedQuantityKg: 32000,
      distributedQuantityKg: 16000,
      remainingQuantityKg: 16000,
      unit: 'KG',
      receivingType: 'GRANEL',
      bagCount: null,
      bagUnitWeightKg: null,
      receivingPoint: 'Moega 02 · Placa KLM-2A10',
      vehiclePlate: 'KLM-2A10',
      driverName: 'Paulo Ferreira',
      carrierName: 'Mosaic Cargas',
      status: 'PARCIAL',
      operatorUserId: 901,
      operatorName: 'Carlos Silva (Operador Moega [DEMO])',
      operatorBadge: 'OP-101',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      startedShiftCode: 'TURNO_1',
      startedOperationalDate: today,
      finishedShiftCode: null,
      finishedOperationalDate: null,
      startedAt: makeIsoAtLocalTime(today, '12:40'),
      finishedAt: null,
      notes: '[CENÁRIO DEMO] Motorista: Paulo Ferreira | Descarga parcial em andamento no Silo 35.',
      version: 1,
      createdAt: makeIsoAtLocalTime(today, '12:40'),
      distributions: [
        {
          id: 3,
          receiptId: 3,
          siloId: s35.id,
          siloNumber: 35,
          quantityKg: 16000,
          bagCount: null,
          movementId: 103,
          status: 'CONFIRMADA',
          isComplement: false,
          operatorName: 'Carlos Silva [DEMO]',
          operatorBadge: 'OP-101',
          shiftCode: 'TURNO_1',
          operationalDate: today,
          notes: '[CENÁRIO DEMO] 1ª etapa Silo 35.',
          createdAt: makeIsoAtLocalTime(today, '13:05'),
        },
      ],
    },
    {
      id: 4,
      receiptNumber: `REC-DEMO-${yesterday.replace(/-/g, '')}-01`,
      materialId: matMilhoBc.id,
      materialCode: matMilhoBc.code,
      materialDescription: matMilhoBc.description,
      supplierId: supDreyfus.id,
      supplierName: supDreyfus.name,
      invoiceNumber: 'NF 091.102',
      lotCode: '0033104590',
      entryDate: yesterday,
      receivedQuantityKg: 31000,
      distributedQuantityKg: 31000,
      remainingQuantityKg: 0,
      unit: 'KG',
      receivingType: 'GRANEL',
      bagCount: null,
      bagUnitWeightKg: null,
      receivingPoint: 'Moega 01 · Placa GHI-5J30',
      vehiclePlate: 'GHI-5J30',
      driverName: 'José Pereira',
      carrierName: 'Rodomilho',
      status: 'CONCLUIDO',
      operatorUserId: 902,
      operatorName: 'João Mendes [DEMO]',
      operatorBadge: 'OP-102',
      shiftCode: 'TURNO_2',
      operationalDate: yesterday,
      startedShiftCode: 'TURNO_2',
      startedOperationalDate: yesterday,
      finishedShiftCode: 'TURNO_2',
      finishedOperationalDate: yesterday,
      startedAt: makeIsoAtLocalTime(yesterday, '18:15'),
      finishedAt: makeIsoAtLocalTime(yesterday, '19:02'),
      notes: '[CENÁRIO DEMO] Descarga completa no Silo 42.',
      version: 1,
      createdAt: makeIsoAtLocalTime(yesterday, '18:15'),
      distributions: [
        {
          id: 4,
          receiptId: 4,
          siloId: s42.id,
          siloNumber: 42,
          quantityKg: 31000,
          bagCount: null,
          movementId: 108,
          status: 'CONFIRMADA',
          isComplement: false,
          operatorName: 'João Mendes [DEMO]',
          operatorBadge: 'OP-102',
          shiftCode: 'TURNO_2',
          operationalDate: yesterday,
          notes: null,
          createdAt: makeIsoAtLocalTime(yesterday, '19:02'),
        },
      ],
    },
    {
      id: 5,
      receiptNumber: `REC-DEMO-${yesterday.replace(/-/g, '')}-05`,
      materialId: matFosfBi.id,
      materialCode: matFosfBi.code,
      materialDescription: matFosfBi.description,
      supplierId: supMosaic.id,
      supplierName: supMosaic.name,
      invoiceNumber: 'NF 088.450',
      lotCode: '0020177500',
      entryDate: yesterday,
      receivedQuantityKg: 28000,
      distributedQuantityKg: 28000,
      remainingQuantityKg: 0,
      unit: 'KG',
      receivingType: 'GRANEL',
      bagCount: null,
      bagUnitWeightKg: null,
      receivingPoint: 'Moega 02 · Placa DEF-7B19',
      vehiclePlate: 'DEF-7B19',
      driverName: 'Antônio Alves',
      carrierName: 'Mosaic Cargas',
      status: 'CONCLUIDO',
      operatorUserId: 902,
      operatorName: 'João Mendes [DEMO]',
      operatorBadge: 'OP-102',
      shiftCode: 'TURNO_3',
      operationalDate: yesterday,
      startedShiftCode: 'TURNO_3',
      startedOperationalDate: yesterday,
      finishedShiftCode: 'TURNO_1',
      finishedOperationalDate: today,
      startedAt: makeIsoAtLocalTime(yesterday, '23:45'),
      finishedAt: makeIsoAtLocalTime(today, '07:45'),
      notes: '[CENÁRIO DEMO] Carga iniciada no 3º Turno anterior e concluída hoje no 1º Turno (não entra na contagem de veículos do 1º Turno).',
      version: 1,
      createdAt: makeIsoAtLocalTime(yesterday, '23:45'),
      distributions: [
        {
          id: 5,
          receiptId: 5,
          siloId: s26.id,
          siloNumber: 26,
          quantityKg: 18000,
          bagCount: null,
          movementId: 108,
          status: 'CONFIRMADA',
          isComplement: false,
          operatorName: 'João Mendes [DEMO]',
          operatorBadge: 'OP-102',
          shiftCode: 'TURNO_3',
          operationalDate: yesterday,
          notes: '[CENÁRIO DEMO] Etapa inicial noturna.',
          createdAt: makeIsoAtLocalTime(yesterday, '23:55'),
        },
        {
          id: 6,
          receiptId: 5,
          siloId: s26.id,
          siloNumber: 26,
          quantityKg: 10000,
          bagCount: null,
          movementId: 112,
          status: 'CONFIRMADA',
          isComplement: true,
          operatorName: 'Carlos Silva [DEMO]',
          operatorBadge: 'OP-101',
          shiftCode: 'TURNO_1',
          operationalDate: today,
          notes: '[CENÁRIO DEMO] Complemento final concluído às 07:45 no 1º Turno.',
          createdAt: makeIsoAtLocalTime(today, '07:45'),
        },
      ],
    },
  ];

  const movements: InventoryMovementItem[] = [
    {
      id: 101,
      movementType: 'RECEBIMENTO',
      siloId: s21.id,
      siloNumber: 21,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011647908',
      quantityKg: 20000,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: receipts[0].receiptNumber,
      receiptId: 1,
      supplierName: supPinheiro.name,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Descarga parcial 1ª etapa no Silo 21',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Carlos Silva [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '11:45'),
    },
    {
      id: 102,
      movementType: 'RECEBIMENTO',
      siloId: s17.id,
      siloNumber: 17,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCaulim.id,
      materialCode: matCaulim.code,
      materialDescription: matCaulim.description,
      lotCode: '0011606870',
      quantityKg: 12000,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: receipts[1].receiptNumber,
      receiptId: 2,
      supplierName: supMassari.name,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Recebimento 10 Big Bags 1.200 kg',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'João Mendes [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '08:52'),
    },
    {
      id: 103,
      movementType: 'RECEBIMENTO',
      siloId: s35.id,
      siloNumber: 35,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matFosfMono.id,
      materialCode: matFosfMono.code,
      materialDescription: matFosfMono.description,
      lotCode: '0020198812',
      quantityKg: 16000,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: receipts[2].receiptNumber,
      receiptId: 3,
      supplierName: supMosaic.name,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Descarga parcial 1ª etapa no Silo 35',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Carlos Silva [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '13:05'),
    },
    {
      id: 104,
      movementType: 'TRANSFERENCIA_SAIDA',
      siloId: s38.id,
      siloNumber: 38,
      counterpartSiloId: s12.id,
      counterpartSiloNumber: 12,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011598201',
      quantityKg: 8000,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: `TRF-DEMO-${todayTag}-02`,
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Transferência parcial Silo 38 → Silo 12 (L4)',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Carlos Silva [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '10:15'),
    },
    {
      id: 105,
      movementType: 'TRANSFERENCIA_ENTRADA',
      siloId: s12.id,
      siloNumber: 12,
      counterpartSiloId: s38.id,
      counterpartSiloNumber: 38,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011598201',
      quantityKg: 8000,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: `TRF-DEMO-${todayTag}-02`,
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Entrada transferência Silo 38 → Silo 12 (L4)',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Carlos Silva [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '10:15'),
    },
    {
      id: 106,
      movementType: 'TRANSFERENCIA_SAIDA',
      siloId: s37.id,
      siloNumber: 37,
      counterpartSiloId: s10.id,
      counterpartSiloNumber: 10,
      materialId: matPremix.id,
      materialCode: matPremix.code,
      materialDescription: matPremix.description,
      lotCode: '0011622014',
      quantityKg: 4000,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: `TRF-DEMO-${todayTag}-01`,
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Transferência concluída Silo 37 → Silo 10 (L5)',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'João Mendes [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '09:10'),
    },
    {
      id: 107,
      movementType: 'TRANSFERENCIA_ENTRADA',
      siloId: s10.id,
      siloNumber: 10,
      counterpartSiloId: s37.id,
      counterpartSiloNumber: 37,
      materialId: matPremix.id,
      materialCode: matPremix.code,
      materialDescription: matPremix.description,
      lotCode: '0011622014',
      quantityKg: 4000,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: `TRF-DEMO-${todayTag}-01`,
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Entrada transferência Silo 37 → Silo 10 (L5)',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'João Mendes [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '09:10'),
    },
    {
      id: 108,
      movementType: 'RECEBIMENTO',
      siloId: s42.id,
      siloNumber: 42,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matMilhoBc.id,
      materialCode: matMilhoBc.code,
      materialDescription: matMilhoBc.description,
      lotCode: '0033104590',
      quantityKg: 31000,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: receipts[3].receiptNumber,
      receiptId: 4,
      supplierName: supDreyfus.name,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Recebimento integral Silo 42',
      shiftCode: 'TURNO_2',
      operationalDate: yesterday,
      operatorName: 'João Mendes [DEMO]',
      createdAt: makeIsoAtLocalTime(yesterday, '19:02'),
    },
    {
      id: 109,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s12.id,
      siloNumber: 12,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011598201',
      quantityKg: 9400,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L4-DEMO-01',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo realizado apontado na Linha 4',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '13:20'),
    },
    {
      id: 110,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s15.id,
      siloNumber: 15,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matPremix.id,
      materialCode: matPremix.code,
      materialDescription: matPremix.description,
      lotCode: '0011622014',
      quantityKg: 4064,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L4-DEMO-01',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Dosagem automática de Veículo Premix na Linha 4',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '13:25'),
    },
    {
      id: 111,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s21.id,
      siloNumber: 21,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011647908',
      quantityKg: 6720,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L3-DEMO-02',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo apontado na Linha 3 (Suplemento Corte)',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '12:50'),
    },
    {
      id: 112,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s20.id,
      siloNumber: 20,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matFosfMono.id,
      materialCode: matFosfMono.code,
      materialDescription: matFosfMono.description,
      lotCode: '0020198812',
      quantityKg: 4410,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L3-DEMO-02',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo de Fosfato Monobicálcico na Linha 3',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '12:55'),
    },
    {
      id: 113,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s17.id,
      siloNumber: 17,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCaulim.id,
      materialCode: matCaulim.code,
      materialDescription: matCaulim.description,
      lotCode: '0011606870',
      quantityKg: 1680,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L3-DEMO-02',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo parcial do lote de Caulim Big Bag na L3',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '13:02'),
    },
    {
      id: 114,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s10.id,
      siloNumber: 10,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matPremix.id,
      materialCode: matPremix.code,
      materialDescription: matPremix.description,
      lotCode: '0011622014',
      quantityKg: 2700,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L5-DEMO-03',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo Linha 5 antes da pausa preventiva',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '11:50'),
    },
    {
      id: 115,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s26.id,
      siloNumber: 26,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matFosfBi.id,
      materialCode: matFosfBi.code,
      materialDescription: matFosfBi.description,
      lotCode: '0020185041',
      quantityKg: 3640,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L1-DEMO-04',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Dosagem na Linha 1 (Concentrado Mineral)',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '12:15'),
    },
    {
      id: 116,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s25.id,
      siloNumber: 25,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matPremix.id,
      materialCode: matPremix.code,
      materialDescription: matPremix.description,
      lotCode: '0011622014',
      quantityKg: 2520,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L1-DEMO-04',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Dosagem de Premix pela Produção na Linha 1',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '12:18'),
    },
    {
      id: 117,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s23.id,
      siloNumber: 23,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matQuirera.id,
      materialCode: matQuirera.code,
      materialDescription: matQuirera.description,
      lotCode: '0033099110',
      quantityKg: 2880,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L2-DEMO-05',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo de Quirera na Linha 2 (ritmo adiantado)',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '12:30'),
    },
    {
      id: 118,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s42.id,
      siloNumber: 42,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matMilhoBc.id,
      materialCode: matMilhoBc.code,
      materialDescription: matMilhoBc.description,
      lotCode: '0033104590',
      quantityKg: 5200,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L7-DEMO-06',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo realizado de Milho BC na L7',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '13:35'),
    },
    {
      id: 119,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s41.id,
      siloNumber: 41,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matAlgodao.id,
      materialCode: matAlgodao.code,
      materialDescription: matAlgodao.description,
      lotCode: '0041098221',
      quantityKg: 1800,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L7-DEMO-06',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo de Farelo de Algodão 38% na L7',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(today, '13:40'),
    },
    // Movimentações de Ontem (saldo conferido inicial + consumos realizados de ontem para Posição Histórica)
    {
      id: 120,
      movementType: 'AJUSTE_AUTORIZADO',
      siloId: s38.id,
      siloNumber: 38,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011598201',
      quantityKg: 76500,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: 'INV-DEMO-ANT-38',
      receiptId: null,
      supplierName: supPinheiro.name,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Saldo consolidado anterior no Silo 38 (Armazenagem)',
      shiftCode: 'TURNO_1',
      operationalDate: yesterday,
      operatorName: 'Supervisor Moega [DEMO]',
      createdAt: makeIsoAtLocalTime(yesterday, '08:00'),
    },
    {
      id: 121,
      movementType: 'AJUSTE_AUTORIZADO',
      siloId: s12.id,
      siloNumber: 12,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011598201',
      quantityKg: 21880,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: 'INV-DEMO-ANT-12',
      receiptId: null,
      supplierName: supPinheiro.name,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Saldo anterior Silo 12 antes do consumo de ontem',
      shiftCode: 'TURNO_1',
      operationalDate: yesterday,
      operatorName: 'Supervisor Moega [DEMO]',
      createdAt: makeIsoAtLocalTime(yesterday, '08:05'),
    },
    {
      id: 122,
      movementType: 'AJUSTE_AUTORIZADO',
      siloId: s21.id,
      siloNumber: 21,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011598201',
      quantityKg: 38880,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: 'INV-DEMO-ANT-21',
      receiptId: null,
      supplierName: supPinheiro.name,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Saldo anterior Silo 21 antes do consumo de ontem',
      shiftCode: 'TURNO_1',
      operationalDate: yesterday,
      operatorName: 'Supervisor Moega [DEMO]',
      createdAt: makeIsoAtLocalTime(yesterday, '08:10'),
    },
    {
      id: 123,
      movementType: 'AJUSTE_AUTORIZADO',
      siloId: s37.id,
      siloNumber: 37,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matPremix.id,
      materialCode: matPremix.code,
      materialDescription: matPremix.description,
      lotCode: '0011622014',
      quantityKg: 22500,
      unit: 'KG',
      direction: 'CREDIT',
      referenceDocument: 'INV-DEMO-ANT-37',
      receiptId: null,
      supplierName: BASE_SUPPLIERS[4].name,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Saldo anterior Silo 37 (Veículo Premix)',
      shiftCode: 'TURNO_1',
      operationalDate: yesterday,
      operatorName: 'Supervisor Moega [DEMO]',
      createdAt: makeIsoAtLocalTime(yesterday, '08:15'),
    },
    {
      id: 124,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s12.id,
      siloNumber: 12,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011598201',
      quantityKg: 16280,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L4-ONTEM-01',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo concluído ontem na Linha 4',
      shiftCode: 'TURNO_2',
      operationalDate: yesterday,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(yesterday, '21:40'),
    },
    {
      id: 125,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s21.id,
      siloNumber: 21,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      lotCode: '0011598201',
      quantityKg: 13760,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L3-ONTEM-02',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo concluído ontem na Linha 3',
      shiftCode: 'TURNO_2',
      operationalDate: yesterday,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(yesterday, '22:10'),
    },
    {
      id: 126,
      movementType: 'CONSUMO_PRODUCAO',
      siloId: s42.id,
      siloNumber: 42,
      counterpartSiloId: null,
      counterpartSiloNumber: null,
      materialId: matMilhoBc.id,
      materialCode: matMilhoBc.code,
      materialDescription: matMilhoBc.description,
      lotCode: '0033104590',
      quantityKg: 12480,
      unit: 'KG',
      direction: 'DEBIT',
      referenceDocument: 'OP-L7-ONTEM-03',
      receiptId: null,
      supplierName: null,
      status: 'CONFIRMADO',
      reason: '[CENÁRIO DEMO] Consumo de Milho BC realizado ontem após descarga no Silo 42',
      shiftCode: 'TURNO_3',
      operationalDate: yesterday,
      operatorName: 'Sistema Produção [DEMO]',
      createdAt: makeIsoAtLocalTime(yesterday, '23:55'),
    },
  ];

  const route38to12 = routes.find((r) => r.originSiloNumber === 38 && r.destinationSiloNumber === 12)?.id ?? 3;
  const route37to15 = routes.find((r) => r.originSiloNumber === 37 && r.destinationSiloNumber === 15)?.id ?? 2;
  const route37to10 = routes.find((r) => r.originSiloNumber === 37 && r.destinationSiloNumber === 10)?.id ?? 1;
  const route35to13 = routes.find((r) => r.originSiloNumber === 35 && r.destinationSiloNumber === 13)?.id ?? 7;

  const transferOrders: TransferOrderItem[] = [
    {
      id: 1,
      orderCode: `TRF-DEMO-${todayTag}-02`,
      transferRuleId: route38to12,
      originSiloId: s38.id,
      originSiloNumber: 38,
      destinationSiloId: s12.id,
      destinationSiloNumber: 12,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      productionLineId: 4,
      lineCode: 'L4',
      lineName: 'Linha 4',
      recommendationId: 1,
      lotCode: '0011598201',
      plannedQuantityKg: 15000,
      transferredQuantityKg: 8000,
      remainingQuantityKg: 7000,
      status: 'PARCIAL',
      priority: 'CRITICA',
      requestedByName: 'Supervisor Moega [DEMO]',
      approvedByName: 'Supervisor Moega [DEMO]',
      assignedOperatorName: 'Carlos Silva [DEMO]',
      interruptedByName: null,
      shiftCode: 'TURNO_1',
      operationalDate: today,
      startedAt: makeIsoAtLocalTime(today, '10:00'),
      finishedAt: null,
      interruptedAt: null,
      interruptionReason: null,
      notes: '[CENÁRIO DEMO] Transferência parcial em execução para suprir déficit crítico da Linha 4.',
      version: 2,
      createdAt: makeIsoAtLocalTime(today, '09:50'),
      updatedAt: makeIsoAtLocalTime(today, '10:15'),
      steps: [
        {
          id: 1,
          transferOrderId: 1,
          stepNumber: 1,
          quantityKg: 8000,
          lotComposition: [{ lotCode: '0011598201', quantityKg: 8000 }],
          referenceDocument: `TRF-DEMO-${todayTag}-02-ET1`,
          debitMovementId: 104,
          creditMovementId: 105,
          executedByName: 'Carlos Silva [DEMO]',
          shiftCode: 'TURNO_1',
          operationalDate: today,
          startedAt: makeIsoAtLocalTime(today, '10:00'),
          finishedAt: makeIsoAtLocalTime(today, '10:15'),
          notes: '[CENÁRIO DEMO] 1ª etapa executada.',
          status: 'CONCLUIDA',
          createdAt: makeIsoAtLocalTime(today, '10:15'),
        },
      ],
    },
    {
      id: 2,
      orderCode: `TRF-DEMO-${todayTag}-03`,
      transferRuleId: route37to15,
      originSiloId: s37.id,
      originSiloNumber: 37,
      destinationSiloId: s15.id,
      destinationSiloNumber: 15,
      materialId: matPremix.id,
      materialCode: matPremix.code,
      materialDescription: matPremix.description,
      productionLineId: 4,
      lineCode: 'L4',
      lineName: 'Linha 4',
      recommendationId: 2,
      lotCode: '0011622014',
      plannedQuantityKg: 3500,
      transferredQuantityKg: 0,
      remainingQuantityKg: 3500,
      status: 'EM_ANDAMENTO',
      priority: 'ALTA',
      requestedByName: 'Supervisor Moega [DEMO]',
      approvedByName: 'Supervisor Moega [DEMO]',
      assignedOperatorName: 'João Mendes [DEMO]',
      interruptedByName: null,
      shiftCode: 'TURNO_1',
      operationalDate: today,
      startedAt: makeIsoAtLocalTime(today, '13:50'),
      finishedAt: null,
      interruptedAt: null,
      interruptionReason: null,
      notes: '[CENÁRIO DEMO] Abastecimento preventivo Silo 37 → Silo 15 (L4).',
      version: 1,
      createdAt: makeIsoAtLocalTime(today, '13:45'),
      updatedAt: makeIsoAtLocalTime(today, '13:50'),
      steps: [],
    },
    {
      id: 3,
      orderCode: `TRF-DEMO-${todayTag}-01`,
      transferRuleId: route37to10,
      originSiloId: s37.id,
      originSiloNumber: 37,
      destinationSiloId: s10.id,
      destinationSiloNumber: 10,
      materialId: matPremix.id,
      materialCode: matPremix.code,
      materialDescription: matPremix.description,
      productionLineId: 5,
      lineCode: 'L5',
      lineName: 'Linha 5',
      recommendationId: null,
      lotCode: '0011622014',
      plannedQuantityKg: 4000,
      transferredQuantityKg: 4000,
      remainingQuantityKg: 0,
      status: 'CONCLUIDA',
      priority: 'ALTA',
      requestedByName: 'Supervisor Moega [DEMO]',
      approvedByName: 'Supervisor Moega [DEMO]',
      assignedOperatorName: 'João Mendes [DEMO]',
      interruptedByName: null,
      shiftCode: 'TURNO_1',
      operationalDate: today,
      startedAt: makeIsoAtLocalTime(today, '08:55'),
      finishedAt: makeIsoAtLocalTime(today, '09:10'),
      interruptedAt: null,
      interruptionReason: null,
      notes: '[CENÁRIO DEMO] Concluída integralmente dentro do turno (rota homologada).',
      version: 1,
      createdAt: makeIsoAtLocalTime(today, '08:45'),
      updatedAt: makeIsoAtLocalTime(today, '09:10'),
      steps: [
        {
          id: 2,
          transferOrderId: 3,
          stepNumber: 1,
          quantityKg: 4000,
          lotComposition: [{ lotCode: '0011622014', quantityKg: 4000 }],
          referenceDocument: `TRF-DEMO-${todayTag}-01-ET1`,
          debitMovementId: 106,
          creditMovementId: 107,
          executedByName: 'João Mendes [DEMO]',
          shiftCode: 'TURNO_1',
          operationalDate: today,
          startedAt: makeIsoAtLocalTime(today, '08:55'),
          finishedAt: makeIsoAtLocalTime(today, '09:10'),
          notes: '[CENÁRIO DEMO] Transferência integral.',
          status: 'CONCLUIDA',
          createdAt: makeIsoAtLocalTime(today, '09:10'),
        },
      ],
    },
    {
      id: 4,
      orderCode: `TRF-DEMO-${todayTag}-04`,
      transferRuleId: route35to13,
      originSiloId: s35.id,
      originSiloNumber: 35,
      destinationSiloId: s13.id,
      destinationSiloNumber: 13,
      materialId: matFosfMono.id,
      materialCode: matFosfMono.code,
      materialDescription: matFosfMono.description,
      productionLineId: 4,
      lineCode: 'L4',
      lineName: 'Linha 4',
      recommendationId: null,
      lotCode: '0020198812',
      plannedQuantityKg: 6000,
      transferredQuantityKg: 0,
      remainingQuantityKg: 6000,
      status: 'PLANEJADA',
      priority: 'MEDIA',
      requestedByName: 'Supervisor Moega [DEMO]',
      approvedByName: 'Supervisor Moega [DEMO]',
      assignedOperatorName: null,
      interruptedByName: null,
      shiftCode: 'TURNO_1',
      operationalDate: today,
      startedAt: null,
      finishedAt: null,
      interruptedAt: null,
      interruptionReason: null,
      notes: '[CENÁRIO DEMO] Planejada para programação do 2º turno.',
      version: 1,
      createdAt: makeIsoAtLocalTime(today, '13:55'),
      updatedAt: makeIsoAtLocalTime(today, '13:55'),
      steps: [],
    },
  ];

  const products: ProductWithFactorsItem[] = [
    {
      id: 1,
      code: 'PROD-DEMO-01',
      description: 'NÚCLEO MINERAL L4 ALTA DENSIDADE [DEMO]',
      defaultProductionLineId: 4,
      defaultLineCode: 'L4',
      defaultUnit: 't',
      isActive: true,
      notes: '[CENÁRIO DEMO] Fórmula padrão com fatores validados para Calcário e Premix.',
      factors: [
        { id: 1, productId: 1, materialId: matCal.id, materialCode: matCal.code, materialDescription: matCal.description, factorKgPerUnit: 370, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
        { id: 2, productId: 1, materialId: matPremix.id, materialCode: matPremix.code, materialDescription: matPremix.description, factorKgPerUnit: 160, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
      ],
    },
    {
      id: 2,
      code: 'PROD-DEMO-02',
      description: 'SUPLEMENTO CORTE L3 [DEMO]',
      defaultProductionLineId: 3,
      defaultLineCode: 'L3',
      defaultUnit: 't',
      isActive: true,
      notes: '[CENÁRIO DEMO] Suplemento linha 3 (Calcário, Fosfato Mono e Caulim).',
      factors: [
        { id: 3, productId: 2, materialId: matCal.id, materialCode: matCal.code, materialDescription: matCal.description, factorKgPerUnit: 320, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
        { id: 4, productId: 2, materialId: matFosfMono.id, materialCode: matFosfMono.code, materialDescription: matFosfMono.description, factorKgPerUnit: 210, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
        { id: 6, productId: 2, materialId: matCaulim.id, materialCode: matCaulim.code, materialDescription: matCaulim.description, factorKgPerUnit: 80, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
      ],
    },
    {
      id: 3,
      code: 'PROD-DEMO-03',
      description: 'PREMIX BOVINO L5/L6 [DEMO]',
      defaultProductionLineId: 5,
      defaultLineCode: 'L5',
      defaultUnit: 't',
      isActive: true,
      notes: '[CENÁRIO DEMO] Consumo de Veículo Premix nas linhas 5 e 6.',
      factors: [
        { id: 5, productId: 3, materialId: matPremix.id, materialCode: matPremix.code, materialDescription: matPremix.description, factorKgPerUnit: 450, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
      ],
    },
    {
      id: 4,
      code: 'PROD-DEMO-04',
      description: 'CONCENTRADO MINERAL L1/L2 [DEMO]',
      defaultProductionLineId: 1,
      defaultLineCode: 'L1',
      defaultUnit: 't',
      isActive: true,
      notes: '[CENÁRIO DEMO] Fórmula Linhas 1 e 2 (Fosfato Bicálcico, Premix e Quirera).',
      factors: [
        { id: 7, productId: 4, materialId: matFosfBi.id, materialCode: matFosfBi.code, materialDescription: matFosfBi.description, factorKgPerUnit: 260, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
        { id: 8, productId: 4, materialId: matPremix.id, materialCode: matPremix.code, materialDescription: matPremix.description, factorKgPerUnit: 180, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
        { id: 9, productId: 4, materialId: matQuirera.id, materialCode: matQuirera.code, materialDescription: matQuirera.description, factorKgPerUnit: 240, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
      ],
    },
    {
      id: 5,
      code: 'PROD-DEMO-05',
      description: 'RAÇÃO ENERGÉTICA L7 ARMAZENAGEM [DEMO]',
      defaultProductionLineId: 7,
      defaultLineCode: 'L7',
      defaultUnit: 't',
      isActive: true,
      notes: '[CENÁRIO DEMO] Consumo de Milho BC e Farelo de Algodão 38% via Armazenagem L7.',
      factors: [
        { id: 10, productId: 5, materialId: matMilhoBc.id, materialCode: matMilhoBc.code, materialDescription: matMilhoBc.description, factorKgPerUnit: 520, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
        { id: 11, productId: 5, materialId: matAlgodao.id, materialCode: matAlgodao.code, materialDescription: matAlgodao.description, factorKgPerUnit: 180, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
      ],
    },
    {
      id: 6,
      code: 'PROD-DEMO-06',
      description: 'FÓRMULA ESPECIAL L2 C/ FATOR PENDENTE [DEMO]',
      defaultProductionLineId: 2,
      defaultLineCode: 'L2',
      defaultUnit: 't',
      isActive: true,
      notes: '[CENÁRIO DEMO] Demonstra trava de segurança: Sal Moído possui fator PENDENTE_VALIDACAO e nunca gera projeção estimada.',
      factors: [
        { id: 12, productId: 6, materialId: matVisceras.id, materialCode: matVisceras.code, materialDescription: matVisceras.description, factorKgPerUnit: 150, unit: 't', validationStatus: 'VALIDADO', sourceReference: 'Fórmula Padrão [DEMO]', notes: null, updatedAt: nowIso },
        { id: 13, productId: 6, materialId: matSalMoido.id, materialCode: matSalMoido.code, materialDescription: matSalMoido.description, factorKgPerUnit: 120, unit: 't', validationStatus: 'PENDENTE_VALIDACAO', sourceReference: 'Planilha preliminar — aguarda validação da Qualidade', notes: 'Fator mantido em validação.', updatedAt: nowIso },
      ],
    },
  ];

  const scheduleDocuments: Record<number, ArchivedScheduleDocumentPreview> = {
    1: {
      fileName: `programacao_diaria_${today}.csv`,
      mimeType: 'text/csv',
      fileContentBase64: null,
      extractedTextPreview: [
        `PROGRAMACAO DA PRODUCAO - ${formatBrDate(today)} (REV. 2) [CENARIO DEMONSTRATIVO]`,
        'Linha;Seq;Codigo;Produto;Quantidade;Unidade;Janela',
        'L4;1;PROD-DEMO-01;NUCLEO MINERAL L4 ALTA DENSIDADE;50;t;07:30-17:18',
        'L3;2;PROD-DEMO-02;SUPLEMENTO CORTE L3;45;t;08:00-17:00',
        'L5;3;PROD-DEMO-03;PREMIX BOVINO L5/L6;22;t;10:00-17:00',
        'L6;4;PROD-DEMO-03;PREMIX BOVINO L5/L6;16;t;13:00-19:00',
        'L1;5;PROD-DEMO-04;CONCENTRADO MINERAL L1/L2;30;t;09:00-17:00',
        'L2;6;PROD-DEMO-04;CONCENTRADO MINERAL L1/L2;20;t;08:30-15:00',
        'L2;7;PROD-DEMO-06;FORMULA ESPECIAL L2 C/ FATOR PENDENTE;10;t;18:00-22:00',
        'L7;8;PROD-DEMO-05;RACAO ENERGETICA L7 ARMAZENAGEM;25;t;11:00-19:00',
      ].join('\n'),
    },
    2: {
      fileName: `programacao_amanha_${tomorrow}.csv`,
      mimeType: 'text/csv',
      fileContentBase64: null,
      extractedTextPreview: [
        `PROGRAMACAO DA PRODUCAO - ${formatBrDate(tomorrow)} [CENARIO DEMONSTRATIVO]`,
        'Linha;Seq;Codigo;Produto;Quantidade;Unidade;Janela',
        'L4;1;PROD-DEMO-01;NUCLEO MINERAL L4 ALTA DENSIDADE;44;t;07:30-17:18',
        'L3;2;PROD-DEMO-02;SUPLEMENTO CORTE L3;44;t;08:00-17:00',
        'L5;3;PROD-DEMO-03;PREMIX BOVINO L5/L6;20;t;10:00-17:00',
        'L6;4;PROD-DEMO-03;PREMIX BOVINO L5/L6;14;t;13:00-19:00',
        'L1;5;PROD-DEMO-04;CONCENTRADO MINERAL L1/L2;26;t;09:00-17:00',
        'L7;6;PROD-DEMO-05;RACAO ENERGETICA L7 ARMAZENAGEM;22;t;10:00-18:00',
      ].join('\n'),
    },
    3: {
      fileName: `aditivo_noturno_${today}.pdf`,
      mimeType: 'application/pdf',
      fileContentBase64: null,
      extractedTextPreview: [
        `REVISAO / ADITIVO DE TURNO - ${formatBrDate(today)} [CENARIO DEMONSTRATIVO]`,
        'Linha;Seq;Codigo;Produto;Quantidade;Unidade;Observacao',
        'L4;1;PROD-DEMO-01;NUCLEO MINERAL L4 ALTA DENSIDADE;56;t;Aumento de 6 t no 2o Turno (conferir foto)',
        'L3;2;PROD-DEMO-02;SUPLEMENTO CORTE L3;48;t;Acrescimo de 3 t no lote noturno',
      ].join('\n'),
    },
    4: {
      fileName: `programacao_ontem_${yesterday}.csv`,
      mimeType: 'text/csv',
      fileContentBase64: null,
      extractedTextPreview: [
        `FECHAMENTO DE PRODUCAO - ${formatBrDate(yesterday)} [CENARIO DEMONSTRATIVO]`,
        'L4;PROD-DEMO-01;Plan: 44 t | Real: 44 t (16.280 kg Calcario)',
        'L3;PROD-DEMO-02;Plan: 45 t | Real: 43 t (13.760 kg Calcario)',
        'L7;PROD-DEMO-05;Plan: 26 t | Real: 24 t (12.480 kg Milho BC)',
      ].join('\n'),
    },
  };

  const schedules: ProductionScheduleView[] = [
    {
      id: 1,
      scheduleCode: `PROG-DEMO-${todayTag}-R2`,
      referenceDate: today,
      revisionNumber: 2,
      previousScheduleId: 4,
      documentId: 1,
      documentMeta: { fileName: scheduleDocuments[1].fileName, mimeType: 'text/csv', sourceType: 'PLANILHA_CSV', documentCategory: 'PROGRAMACAO' },
      sourceReportType: 'PROG_SENSOR_GERAL',
      status: 'APROVADA',
      revisionDiffSummary: '[CENÁRIO DEMO] Rev. 2 substituiu Rev. 1: L4 elevada de 42 t para 50 t e incluídas ordens das linhas L1, L2 e L7.',
      notes: '[CENÁRIO DEMO] Programação do dia com fatores validados em L1–L7 e 1 item com fator pendente de validação.',
      importedByName: 'Supervisor Moega [DEMO]',
      approvedByName: 'Supervisor Moega [DEMO]',
      approvedAt: makeIsoAtLocalTime(today, '06:30'),
      createdAt: makeIsoAtLocalTime(today, '06:20'),
      items: [
        {
          id: 1,
          scheduleId: 1,
          productionLineId: 4,
          lineCode: 'L4',
          lineName: 'Linha 4',
          sequenceOrder: 1,
          productId: 1,
          productCode: 'PROD-DEMO-01',
          productDescription: 'NÚCLEO MINERAL L4 ALTA DENSIDADE [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 50,
          plannedUnit: 't',
          scheduledTimeWindow: '07:30–17:18',
          executionStatus: 'EM_ANDAMENTO',
          realizedQuantity: 25.4,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Ordem em execução na L4.',
          projections: [
            { id: 1, materialId: matCal.id, calculatedConsumptionKg: 18500, realizedConsumptionKg: 9400, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 2, materialId: matPremix.id, calculatedConsumptionKg: 8000, realizedConsumptionKg: 4064, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 2,
          scheduleId: 1,
          productionLineId: 3,
          lineCode: 'L3',
          lineName: 'Linha 3',
          sequenceOrder: 2,
          productId: 2,
          productCode: 'PROD-DEMO-02',
          productDescription: 'SUPLEMENTO CORTE L3 [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 45,
          plannedUnit: 't',
          scheduledTimeWindow: '08:00–17:00',
          executionStatus: 'EM_ANDAMENTO',
          realizedQuantity: 21,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Ordem em execução na L3.',
          projections: [
            { id: 3, materialId: matCal.id, calculatedConsumptionKg: 14400, realizedConsumptionKg: 6720, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 4, materialId: matFosfMono.id, calculatedConsumptionKg: 9450, realizedConsumptionKg: 4410, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 13, materialId: matCaulim.id, calculatedConsumptionKg: 3600, realizedConsumptionKg: 1680, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 3,
          scheduleId: 1,
          productionLineId: 5,
          lineCode: 'L5',
          lineName: 'Linha 5',
          sequenceOrder: 3,
          productId: 3,
          productCode: 'PROD-DEMO-03',
          productDescription: 'PREMIX BOVINO L5/L6 [DEMO]',
          materialId: matPremix.id,
          materialCode: matPremix.code,
          plannedQuantity: 22,
          plannedUnit: 't',
          scheduledTimeWindow: '10:00–17:00',
          executionStatus: 'ATRASADA',
          realizedQuantity: 6,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Aguardando complemento no Silo 10.',
          projections: [
            { id: 5, materialId: matPremix.id, calculatedConsumptionKg: 9900, realizedConsumptionKg: 2700, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 4,
          scheduleId: 1,
          productionLineId: 6,
          lineCode: 'L6',
          lineName: 'Linha 6',
          sequenceOrder: 4,
          productId: 3,
          productCode: 'PROD-DEMO-03',
          productDescription: 'PREMIX BOVINO L5/L6 [DEMO]',
          materialId: matPremix.id,
          materialCode: matPremix.code,
          plannedQuantity: 16,
          plannedUnit: 't',
          scheduledTimeWindow: '13:00–19:00',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Silo 29 em nível crítico antes do início.',
          projections: [
            { id: 6, materialId: matPremix.id, calculatedConsumptionKg: 7200, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 9,
          scheduleId: 1,
          productionLineId: 1,
          lineCode: 'L1',
          lineName: 'Linha 1',
          sequenceOrder: 5,
          productId: 4,
          productCode: 'PROD-DEMO-04',
          productDescription: 'CONCENTRADO MINERAL L1/L2 [DEMO]',
          materialId: matFosfBi.id,
          materialCode: matFosfBi.code,
          plannedQuantity: 30,
          plannedUnit: 't',
          scheduledTimeWindow: '09:00–17:00',
          executionStatus: 'EM_ANDAMENTO',
          realizedQuantity: 14,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Produção ativa na L1 com Silo 25 e Silo 26.',
          projections: [
            { id: 14, materialId: matFosfBi.id, calculatedConsumptionKg: 7800, realizedConsumptionKg: 3640, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 15, materialId: matPremix.id, calculatedConsumptionKg: 5400, realizedConsumptionKg: 2520, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 10,
          scheduleId: 1,
          productionLineId: 2,
          lineCode: 'L2',
          lineName: 'Linha 2',
          sequenceOrder: 6,
          productId: 4,
          productCode: 'PROD-DEMO-04',
          productDescription: 'CONCENTRADO MINERAL L1/L2 [DEMO]',
          materialId: matQuirera.id,
          materialCode: matQuirera.code,
          plannedQuantity: 20,
          plannedUnit: 't',
          scheduledTimeWindow: '08:30–15:00',
          executionStatus: 'ADIANTADA',
          realizedQuantity: 12,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Consumo de Quirera na Linha 2 acima do ritmo previsto.',
          projections: [
            { id: 16, materialId: matQuirera.id, calculatedConsumptionKg: 4800, realizedConsumptionKg: 2880, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 11,
          scheduleId: 1,
          productionLineId: 2,
          lineCode: 'L2',
          lineName: 'Linha 2',
          sequenceOrder: 7,
          productId: 6,
          productCode: 'PROD-DEMO-06',
          productDescription: 'FÓRMULA ESPECIAL L2 C/ FATOR PENDENTE [DEMO]',
          materialId: matSalMoido.id,
          materialCode: matSalMoido.code,
          plannedQuantity: 10,
          plannedUnit: 't',
          scheduledTimeWindow: '18:00–22:00',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Sal Moído aguarda validação oficial de fator de consumo.',
          projections: [
            { id: 17, materialId: matVisceras.id, calculatedConsumptionKg: 1500, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 18, materialId: matSalMoido.id, calculatedConsumptionKg: 0, realizedConsumptionKg: 0, calculationStatus: 'PENDENTE_FATOR', originSource: 'FATOR_NAO_VALIDADO' },
          ],
        },
        {
          id: 12,
          scheduleId: 1,
          productionLineId: 7,
          lineCode: 'L7',
          lineName: 'Linha 7 (Armazenagem e Produção)',
          sequenceOrder: 8,
          productId: 5,
          productCode: 'PROD-DEMO-05',
          productDescription: 'RAÇÃO ENERGÉTICA L7 ARMAZENAGEM [DEMO]',
          materialId: matMilhoBc.id,
          materialCode: matMilhoBc.code,
          plannedQuantity: 25,
          plannedUnit: 't',
          scheduledTimeWindow: '11:00–19:00',
          executionStatus: 'EM_ANDAMENTO',
          realizedQuantity: 10,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Dosagem ativa de Milho BC (S42) e Farelo Algodão (S41).',
          projections: [
            { id: 19, materialId: matMilhoBc.id, calculatedConsumptionKg: 13000, realizedConsumptionKg: 5200, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 20, materialId: matAlgodao.id, calculatedConsumptionKg: 4500, realizedConsumptionKg: 1800, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
      ],
    },
    {
      id: 2,
      scheduleCode: `PROG-DEMO-${tomorrow.replace(/-/g, '')}-R1`,
      referenceDate: tomorrow,
      revisionNumber: 1,
      previousScheduleId: null,
      documentId: 2,
      documentMeta: { fileName: scheduleDocuments[2].fileName, mimeType: 'text/csv', sourceType: 'PLANILHA_CSV', documentCategory: 'PROGRAMACAO' },
      sourceReportType: 'PROG_SENSOR_GERAL',
      status: 'APROVADA',
      revisionDiffSummary: '[CENÁRIO DEMO] Programação do dia seguinte para antecipação de abastecimento.',
      notes: '[CENÁRIO DEMO] Programação de amanhã para L1, L3, L4, L5, L6 e L7.',
      importedByName: 'Supervisor Moega [DEMO]',
      approvedByName: 'Supervisor Moega [DEMO]',
      approvedAt: makeIsoAtLocalTime(today, '13:10'),
      createdAt: makeIsoAtLocalTime(today, '13:05'),
      items: [
        {
          id: 5,
          scheduleId: 2,
          productionLineId: 4,
          lineCode: 'L4',
          lineName: 'Linha 4',
          sequenceOrder: 1,
          productId: 1,
          productCode: 'PROD-DEMO-01',
          productDescription: 'NÚCLEO MINERAL L4 ALTA DENSIDADE [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 44,
          plannedUnit: 't',
          scheduledTimeWindow: '07:30–17:18',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: null,
          projections: [
            { id: 7, materialId: matCal.id, calculatedConsumptionKg: 16280, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 8, materialId: matPremix.id, calculatedConsumptionKg: 7040, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 6,
          scheduleId: 2,
          productionLineId: 3,
          lineCode: 'L3',
          lineName: 'Linha 3',
          sequenceOrder: 2,
          productId: 2,
          productCode: 'PROD-DEMO-02',
          productDescription: 'SUPLEMENTO CORTE L3 [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 44,
          plannedUnit: 't',
          scheduledTimeWindow: '08:00–17:00',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: null,
          projections: [
            { id: 9, materialId: matCal.id, calculatedConsumptionKg: 14080, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 10, materialId: matFosfMono.id, calculatedConsumptionKg: 9240, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 21, materialId: matCaulim.id, calculatedConsumptionKg: 3520, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 7,
          scheduleId: 2,
          productionLineId: 5,
          lineCode: 'L5',
          lineName: 'Linha 5',
          sequenceOrder: 3,
          productId: 3,
          productCode: 'PROD-DEMO-03',
          productDescription: 'PREMIX BOVINO L5/L6 [DEMO]',
          materialId: matPremix.id,
          materialCode: matPremix.code,
          plannedQuantity: 20,
          plannedUnit: 't',
          scheduledTimeWindow: '10:00–17:00',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: null,
          projections: [
            { id: 11, materialId: matPremix.id, calculatedConsumptionKg: 9000, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 8,
          scheduleId: 2,
          productionLineId: 6,
          lineCode: 'L6',
          lineName: 'Linha 6',
          sequenceOrder: 4,
          productId: 3,
          productCode: 'PROD-DEMO-03',
          productDescription: 'PREMIX BOVINO L5/L6 [DEMO]',
          materialId: matPremix.id,
          materialCode: matPremix.code,
          plannedQuantity: 14,
          plannedUnit: 't',
          scheduledTimeWindow: '13:00–19:00',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: null,
          projections: [
            { id: 12, materialId: matPremix.id, calculatedConsumptionKg: 6300, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 13,
          scheduleId: 2,
          productionLineId: 1,
          lineCode: 'L1',
          lineName: 'Linha 1',
          sequenceOrder: 5,
          productId: 4,
          productCode: 'PROD-DEMO-04',
          productDescription: 'CONCENTRADO MINERAL L1/L2 [DEMO]',
          materialId: matFosfBi.id,
          materialCode: matFosfBi.code,
          plannedQuantity: 26,
          plannedUnit: 't',
          scheduledTimeWindow: '09:00–17:00',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: null,
          projections: [
            { id: 22, materialId: matFosfBi.id, calculatedConsumptionKg: 6760, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 23, materialId: matPremix.id, calculatedConsumptionKg: 4680, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 14,
          scheduleId: 2,
          productionLineId: 7,
          lineCode: 'L7',
          lineName: 'Linha 7 (Armazenagem e Produção)',
          sequenceOrder: 6,
          productId: 5,
          productCode: 'PROD-DEMO-05',
          productDescription: 'RAÇÃO ENERGÉTICA L7 ARMAZENAGEM [DEMO]',
          materialId: matMilhoBc.id,
          materialCode: matMilhoBc.code,
          plannedQuantity: 22,
          plannedUnit: 't',
          scheduledTimeWindow: '10:00–18:00',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: null,
          projections: [
            { id: 24, materialId: matMilhoBc.id, calculatedConsumptionKg: 11440, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
            { id: 25, materialId: matAlgodao.id, calculatedConsumptionKg: 3960, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
      ],
    },
    {
      id: 3,
      scheduleCode: `PROG-DEMO-${todayTag}-R3-DRAFT`,
      referenceDate: today,
      revisionNumber: 3,
      previousScheduleId: 1,
      documentId: 3,
      documentMeta: { fileName: scheduleDocuments[3].fileName, mimeType: 'application/pdf', sourceType: 'ARQUIVO_PDF', documentCategory: 'REVISAO' },
      sourceReportType: 'REVISAO_TURNO',
      status: 'RASCUNHO_CONFERENCIA',
      revisionDiffSummary: '[CENÁRIO DEMO] Rascunho de aditivo noturno aguardando conferência e aprovação da supervisão.',
      notes: '[CENÁRIO DEMO] Proposta de acréscimo de +6 t na Linha 4 e +3 t na Linha 3 para o 2º Turno.',
      importedByName: 'Líder Produção [DEMO]',
      approvedByName: null,
      approvedAt: null,
      createdAt: makeIsoAtLocalTime(today, '13:45'),
      items: [
        {
          id: 15,
          scheduleId: 3,
          productionLineId: 4,
          lineCode: 'L4',
          lineName: 'Linha 4',
          sequenceOrder: 1,
          productId: 1,
          productCode: 'PROD-DEMO-01',
          productDescription: 'NÚCLEO MINERAL L4 ALTA DENSIDADE [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 56,
          plannedUnit: 't',
          scheduledTimeWindow: '17:00–02:12',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'MEDIA',
          needsReview: true,
          reviewReason: 'Quantidade alterada de 50 t para 56 t no PDF do aditivo; confirmar capacidade do Silo 12 antes de aprovar.',
          notes: '[CENÁRIO DEMO] Aguarda aprovação.',
          projections: [
            { id: 26, materialId: matCal.id, calculatedConsumptionKg: 20720, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 16,
          scheduleId: 3,
          productionLineId: 3,
          lineCode: 'L3',
          lineName: 'Linha 3',
          sequenceOrder: 2,
          productId: 2,
          productCode: 'PROD-DEMO-02',
          productDescription: 'SUPLEMENTO CORTE L3 [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 48,
          plannedUnit: 't',
          scheduledTimeWindow: '17:00–02:12',
          executionStatus: 'NAO_INICIADA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: null,
          projections: [
            { id: 27, materialId: matCal.id, calculatedConsumptionKg: 15360, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
      ],
    },
    {
      id: 4,
      scheduleCode: `PROG-DEMO-${todayTag}-R1`,
      referenceDate: today,
      revisionNumber: 1,
      previousScheduleId: null,
      documentId: 1,
      documentMeta: { fileName: scheduleDocuments[1].fileName, mimeType: 'text/csv', sourceType: 'PLANILHA_CSV', documentCategory: 'PROGRAMACAO' },
      sourceReportType: 'PROG_SENSOR_GERAL',
      status: 'SUPERSEDED',
      revisionDiffSummary: '[CENÁRIO DEMO] Revisão inicial (42 t na L4), substituída pela Revisão 2.',
      notes: '[CENÁRIO DEMO] Mantida no histórico de revisões para auditoria comparativa.',
      importedByName: 'Supervisor Moega [DEMO]',
      approvedByName: 'Supervisor Moega [DEMO]',
      approvedAt: makeIsoAtLocalTime(today, '05:50'),
      createdAt: makeIsoAtLocalTime(today, '05:45'),
      items: [
        {
          id: 17,
          scheduleId: 4,
          productionLineId: 4,
          lineCode: 'L4',
          lineName: 'Linha 4',
          sequenceOrder: 1,
          productId: 1,
          productCode: 'PROD-DEMO-01',
          productDescription: 'NÚCLEO MINERAL L4 ALTA DENSIDADE [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 42,
          plannedUnit: 't',
          scheduledTimeWindow: '07:30–17:18',
          executionStatus: 'CONCLUIDA',
          realizedQuantity: 0,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: 'Substituída por PROG-DEMO-R2.',
          projections: [
            { id: 28, materialId: matCal.id, calculatedConsumptionKg: 15540, realizedConsumptionKg: 0, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
      ],
    },
    {
      id: 5,
      scheduleCode: `PROG-DEMO-${yesterday.replace(/-/g, '')}-R1`,
      referenceDate: yesterday,
      revisionNumber: 1,
      previousScheduleId: null,
      documentId: 4,
      documentMeta: { fileName: scheduleDocuments[4].fileName, mimeType: 'text/csv', sourceType: 'RELATORIO_PRODUCAO', documentCategory: 'RELATORIO_PRODUCAO' },
      sourceReportType: 'REL_PRODUCAO_SENSOR',
      status: 'APROVADA',
      revisionDiffSummary: '[CENÁRIO DEMO] Fechamento de produção realizada no dia operacional anterior.',
      notes: '[CENÁRIO DEMO] Comparativo histórico ontem: L4 100%, L3 95,6% e L7 92,3%.',
      importedByName: 'Supervisor Moega [DEMO]',
      approvedByName: 'Supervisor Moega [DEMO]',
      approvedAt: makeIsoAtLocalTime(yesterday, '07:00'),
      createdAt: makeIsoAtLocalTime(yesterday, '06:50'),
      items: [
        {
          id: 18,
          scheduleId: 5,
          productionLineId: 4,
          lineCode: 'L4',
          lineName: 'Linha 4',
          sequenceOrder: 1,
          productId: 1,
          productCode: 'PROD-DEMO-01',
          productDescription: 'NÚCLEO MINERAL L4 ALTA DENSIDADE [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 44,
          plannedUnit: 't',
          scheduledTimeWindow: '07:30–17:18',
          executionStatus: 'CONCLUIDA',
          realizedQuantity: 44,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Meta cumprida 100%.',
          projections: [
            { id: 29, materialId: matCal.id, calculatedConsumptionKg: 16280, realizedConsumptionKg: 16280, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 19,
          scheduleId: 5,
          productionLineId: 3,
          lineCode: 'L3',
          lineName: 'Linha 3',
          sequenceOrder: 2,
          productId: 2,
          productCode: 'PROD-DEMO-02',
          productDescription: 'SUPLEMENTO CORTE L3 [DEMO]',
          materialId: matCal.id,
          materialCode: matCal.code,
          plannedQuantity: 45,
          plannedUnit: 't',
          scheduledTimeWindow: '08:00–17:00',
          executionStatus: 'CONCLUIDA',
          realizedQuantity: 43,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Diferença de -2 t por troca de formulação no 2º Turno.',
          projections: [
            { id: 30, materialId: matCal.id, calculatedConsumptionKg: 14400, realizedConsumptionKg: 13760, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
        {
          id: 20,
          scheduleId: 5,
          productionLineId: 7,
          lineCode: 'L7',
          lineName: 'Linha 7 (Armazenagem e Produção)',
          sequenceOrder: 3,
          productId: 5,
          productCode: 'PROD-DEMO-05',
          productDescription: 'RAÇÃO ENERGÉTICA L7 ARMAZENAGEM [DEMO]',
          materialId: matMilhoBc.id,
          materialCode: matMilhoBc.code,
          plannedQuantity: 26,
          plannedUnit: 't',
          scheduledTimeWindow: '10:00–18:00',
          executionStatus: 'CONCLUIDA',
          realizedQuantity: 24,
          extractionConfidence: 'ALTA',
          needsReview: false,
          reviewReason: null,
          notes: '[CENÁRIO DEMO] Consumo de Milho BC realizado via Silo 42.',
          projections: [
            { id: 31, materialId: matMilhoBc.id, calculatedConsumptionKg: 13520, realizedConsumptionKg: 12480, calculationStatus: 'CALCULADO', originSource: 'DEMO_FATOR_VALIDADO' },
          ],
        },
      ],
    },
  ];

  const supplyBoard: ProductionSupplyBoardResponse = {
    todayDate: today,
    tomorrowDate: tomorrow,
    analyzedAtIso: nowIso,
    boardRows: [
      {
        rowKey: 'L4::2017101021',
        lineCode: 'L4',
        lineName: 'Linha 4',
        materialId: matCal.id,
        materialCode: matCal.code,
        materialDescription: matCal.description,
        feedingSilos: [
          { siloId: s12.id, siloNumber: 12, confirmedStockKg: s12.confirmedStockKg, safeCapacityKg: s12.safeCapacityKg, availableSpaceKg: s12.availableSpaceKg, operationalStatus: s12.operationalStatus, validationStatus: s12.validationStatus },
        ],
        currentStockKg: s12.confirmedStockKg,
        plannedConsumptionTodayKg: 18500,
        plannedConsumptionTomorrowKg: 16280,
        realizedConsumptionKg: 9400,
        remainingConsumptionKg: 9100,
        deficitOrSurplusKg: s12.confirmedStockKg - 9100,
        pendingTransferInboundKg: 7000,
        confirmedPendingReceiptKg: 18840,
        needsTransfer: true,
        suggestedOriginSiloNumber: 38,
        suggestedOriginSiloId: s38.id,
        suggestedDestinationSiloId: s12.id,
        suggestedDestinationSiloNumber: 12,
        suggestedTransferRuleId: route38to12,
        suggestedTransferKg: 12000,
        hasAuthorizedRouteWithStock: false,
        supplyStatus: 'VERMELHO',
        statusReason: '[CENÁRIO DEMO] Risco crítico na L4: Silo 12 com 4.200 kg abaixo do mínimo (8.000 kg); rota S38→S12 pendente de validação oficial.',
        priorityScore: 92,
        priorityLevel: 'CRITICA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Estimativa de duração não informada (dados demonstrativos).',
      },
      {
        rowKey: 'L6::1113101920',
        lineCode: 'L6',
        lineName: 'Linha 6',
        materialId: matPremix.id,
        materialCode: matPremix.code,
        materialDescription: matPremix.description,
        feedingSilos: [
          { siloId: s29.id, siloNumber: 29, confirmedStockKg: s29.confirmedStockKg, safeCapacityKg: s29.safeCapacityKg, availableSpaceKg: s29.availableSpaceKg, operationalStatus: s29.operationalStatus, validationStatus: s29.validationStatus },
          { siloId: s28.id, siloNumber: 28, confirmedStockKg: s28.confirmedStockKg, safeCapacityKg: s28.safeCapacityKg, availableSpaceKg: s28.availableSpaceKg, operationalStatus: s28.operationalStatus, validationStatus: s28.validationStatus },
        ],
        currentStockKg: s29.confirmedStockKg + s28.confirmedStockKg,
        plannedConsumptionTodayKg: 7200,
        plannedConsumptionTomorrowKg: 6300,
        realizedConsumptionKg: 0,
        remainingConsumptionKg: 7200,
        deficitOrSurplusKg: s29.confirmedStockKg + s28.confirmedStockKg - 7200,
        pendingTransferInboundKg: 0,
        confirmedPendingReceiptKg: 0,
        needsTransfer: true,
        suggestedOriginSiloNumber: null,
        suggestedOriginSiloId: null,
        suggestedDestinationSiloId: s29.id,
        suggestedDestinationSiloNumber: 29,
        suggestedTransferRuleId: null,
        suggestedTransferKg: 0,
        hasAuthorizedRouteWithStock: false,
        supplyStatus: 'VERMELHO',
        statusReason: '[CENÁRIO DEMO] Silo 29 em nível crítico (520 kg) sem rota cadastrada a partir da Armazenagem.',
        priorityScore: 86,
        priorityLevel: 'CRITICA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Necessário cadastro/homologação de rota para Linha 6.',
      },
      {
        rowKey: 'L4::1113101920',
        lineCode: 'L4',
        lineName: 'Linha 4',
        materialId: matPremix.id,
        materialCode: matPremix.code,
        materialDescription: matPremix.description,
        feedingSilos: [
          { siloId: s15.id, siloNumber: 15, confirmedStockKg: s15.confirmedStockKg, safeCapacityKg: s15.safeCapacityKg, availableSpaceKg: s15.availableSpaceKg, operationalStatus: s15.operationalStatus, validationStatus: s15.validationStatus },
        ],
        currentStockKg: s15.confirmedStockKg,
        plannedConsumptionTodayKg: 8000,
        plannedConsumptionTomorrowKg: 7040,
        realizedConsumptionKg: 4064,
        remainingConsumptionKg: 3936,
        deficitOrSurplusKg: s15.confirmedStockKg - 3936,
        pendingTransferInboundKg: 3500,
        confirmedPendingReceiptKg: 0,
        needsTransfer: true,
        suggestedOriginSiloNumber: 37,
        suggestedOriginSiloId: s37.id,
        suggestedDestinationSiloId: s15.id,
        suggestedDestinationSiloNumber: 15,
        suggestedTransferRuleId: route37to15,
        suggestedTransferKg: 3500,
        hasAuthorizedRouteWithStock: true,
        supplyStatus: 'LARANJA',
        statusReason: '[CENÁRIO DEMO] Ação necessária na L4: saldo de 2.200 kg no Silo 15; rota oficial autorizada S37 → S15 disponível com 18.500 kg na origem.',
        priorityScore: 71,
        priorityLevel: 'ALTA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: `Transferência ${transferOrders[1].orderCode} em andamento.`,
      },
      {
        rowKey: 'L5::1113101920',
        lineCode: 'L5',
        lineName: 'Linha 5',
        materialId: matPremix.id,
        materialCode: matPremix.code,
        materialDescription: matPremix.description,
        feedingSilos: [
          { siloId: s9.id, siloNumber: 9, confirmedStockKg: s9.confirmedStockKg, safeCapacityKg: s9.safeCapacityKg, availableSpaceKg: s9.availableSpaceKg, operationalStatus: 'OPERACIONAL', validationStatus: s9.validationStatus },
          { siloId: s10.id, siloNumber: 10, confirmedStockKg: s10.confirmedStockKg, safeCapacityKg: s10.safeCapacityKg, availableSpaceKg: s10.availableSpaceKg, operationalStatus: 'OPERACIONAL', validationStatus: s10.validationStatus },
        ],
        currentStockKg: s9.confirmedStockKg + s10.confirmedStockKg,
        plannedConsumptionTodayKg: 9900,
        plannedConsumptionTomorrowKg: 9000,
        realizedConsumptionKg: 2700,
        remainingConsumptionKg: 7200,
        deficitOrSurplusKg: s9.confirmedStockKg + s10.confirmedStockKg - 7200,
        pendingTransferInboundKg: 0,
        confirmedPendingReceiptKg: 0,
        needsTransfer: true,
        suggestedOriginSiloNumber: 37,
        suggestedOriginSiloId: s37.id,
        suggestedDestinationSiloId: s10.id,
        suggestedDestinationSiloNumber: 10,
        suggestedTransferRuleId: route37to10,
        suggestedTransferKg: 5000,
        hasAuthorizedRouteWithStock: true,
        supplyStatus: 'LARANJA',
        statusReason: '[CENÁRIO DEMO] Cobertura justa para amanhã na L5 (Silo 10 com 2.800 kg); rota oficial S37 → S10 autorizada.',
        priorityScore: 58,
        priorityLevel: 'ALTA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Planejamento preventivo para próximo turno.',
      },
      {
        rowKey: 'L3::2017101021',
        lineCode: 'L3',
        lineName: 'Linha 3',
        materialId: matCal.id,
        materialCode: matCal.code,
        materialDescription: matCal.description,
        feedingSilos: [
          { siloId: s21.id, siloNumber: 21, confirmedStockKg: s21.confirmedStockKg, safeCapacityKg: s21.safeCapacityKg, availableSpaceKg: s21.availableSpaceKg, operationalStatus: 'OPERACIONAL', validationStatus: s21.validationStatus },
        ],
        currentStockKg: s21.confirmedStockKg,
        plannedConsumptionTodayKg: 14400,
        plannedConsumptionTomorrowKg: 14080,
        realizedConsumptionKg: 6720,
        remainingConsumptionKg: 7680,
        deficitOrSurplusKg: s21.confirmedStockKg - 7680,
        pendingTransferInboundKg: 0,
        confirmedPendingReceiptKg: 18840,
        needsTransfer: false,
        suggestedOriginSiloNumber: null,
        suggestedOriginSiloId: null,
        suggestedDestinationSiloId: s21.id,
        suggestedDestinationSiloNumber: 21,
        suggestedTransferRuleId: null,
        suggestedTransferKg: 0,
        hasAuthorizedRouteWithStock: false,
        supplyStatus: 'VERDE',
        statusReason: '[CENÁRIO DEMO] Estoque suficiente na L3 e recebimento em andamento no Silo 21.',
        priorityScore: 15,
        priorityLevel: 'BAIXA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Cobertura superior a 2 turnos.',
      },
      {
        rowKey: 'L1::2019101141',
        lineCode: 'L1',
        lineName: 'Linha 1',
        materialId: matFosfBi.id,
        materialCode: matFosfBi.code,
        materialDescription: matFosfBi.description,
        feedingSilos: [
          { siloId: s26.id, siloNumber: 26, confirmedStockKg: s26.confirmedStockKg, safeCapacityKg: s26.safeCapacityKg, availableSpaceKg: s26.availableSpaceKg, operationalStatus: 'OPERACIONAL', validationStatus: s26.validationStatus },
        ],
        currentStockKg: s26.confirmedStockKg,
        plannedConsumptionTodayKg: 7800,
        plannedConsumptionTomorrowKg: 6760,
        realizedConsumptionKg: 3640,
        remainingConsumptionKg: 4160,
        deficitOrSurplusKg: s26.confirmedStockKg - 4160,
        pendingTransferInboundKg: 0,
        confirmedPendingReceiptKg: 0,
        needsTransfer: false,
        suggestedOriginSiloNumber: null,
        suggestedOriginSiloId: null,
        suggestedDestinationSiloId: s26.id,
        suggestedDestinationSiloNumber: 26,
        suggestedTransferRuleId: null,
        suggestedTransferKg: 0,
        hasAuthorizedRouteWithStock: false,
        supplyStatus: 'VERDE',
        statusReason: '[CENÁRIO DEMO] Silo 26 (Linha 1) com cobertura plena para hoje e amanhã.',
        priorityScore: 12,
        priorityLevel: 'BAIXA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Operação regular.',
      },
      {
        rowKey: 'L7::1211101012',
        lineCode: 'L7',
        lineName: 'Linha 7 (Armazenagem e Produção)',
        materialId: matMilhoBc.id,
        materialCode: matMilhoBc.code,
        materialDescription: matMilhoBc.description,
        feedingSilos: [
          { siloId: s42.id, siloNumber: 42, confirmedStockKg: s42.confirmedStockKg, safeCapacityKg: s42.safeCapacityKg, availableSpaceKg: s42.availableSpaceKg, operationalStatus: 'OPERACIONAL', validationStatus: s42.validationStatus },
        ],
        currentStockKg: s42.confirmedStockKg,
        plannedConsumptionTodayKg: 13000,
        plannedConsumptionTomorrowKg: 11440,
        realizedConsumptionKg: 5200,
        remainingConsumptionKg: 7800,
        deficitOrSurplusKg: s42.confirmedStockKg - 7800,
        pendingTransferInboundKg: 0,
        confirmedPendingReceiptKg: 0,
        needsTransfer: false,
        suggestedOriginSiloNumber: null,
        suggestedOriginSiloId: null,
        suggestedDestinationSiloId: s42.id,
        suggestedDestinationSiloNumber: 42,
        suggestedTransferRuleId: null,
        suggestedTransferKg: 0,
        hasAuthorizedRouteWithStock: false,
        supplyStatus: 'VERDE',
        statusReason: '[CENÁRIO DEMO] Silo 42 (Armazenagem) com saldo folgado de Milho BC.',
        priorityScore: 10,
        priorityLevel: 'BAIXA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Operação regular.',
      },
      {
        rowKey: 'L2::2021171023',
        lineCode: 'L2',
        lineName: 'Linha 2',
        materialId: matSalMoido.id,
        materialCode: matSalMoido.code,
        materialDescription: matSalMoido.description,
        feedingSilos: [
          { siloId: s43.id, siloNumber: 43, confirmedStockKg: s43.confirmedStockKg, safeCapacityKg: s43.safeCapacityKg, availableSpaceKg: s43.availableSpaceKg, operationalStatus: 'OPERACIONAL', validationStatus: s43.validationStatus },
        ],
        currentStockKg: s43.confirmedStockKg,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        realizedConsumptionKg: 0,
        remainingConsumptionKg: 0,
        deficitOrSurplusKg: s43.confirmedStockKg,
        pendingTransferInboundKg: 0,
        confirmedPendingReceiptKg: 0,
        needsTransfer: false,
        suggestedOriginSiloNumber: null,
        suggestedOriginSiloId: null,
        suggestedDestinationSiloId: s43.id,
        suggestedDestinationSiloNumber: 43,
        suggestedTransferRuleId: null,
        suggestedTransferKg: 0,
        hasAuthorizedRouteWithStock: false,
        supplyStatus: 'CINZA',
        statusReason: '[CENÁRIO DEMO] Fator de consumo de PROD-DEMO-06 ainda em PENDENTE_VALIDACAO; cálculo mantido bloqueado sem inventar estimativa.',
        priorityScore: 20,
        priorityLevel: 'BAIXA',
        hasReliableTimeEstimate: false,
        timeEstimateNote: 'Aguarda validação do fator pela Qualidade.',
      },
    ],
    recommendations: [
      {
        id: 1,
        recommendationKey: 'REC-DEMO-L4-CALCARIO',
        headline: 'REPOSIÇÃO CRÍTICA · SILO 12 (LINHA 4)',
        recommendationType: 'TRANSFERIR_SILO',
        priorityScore: 92,
        priorityLevel: 'CRITICA',
        visualStatus: 'VERMELHO',
        lineCode: 'L4',
        materialId: matCal.id,
        materialCode: matCal.code,
        materialDescription: matCal.description,
        destinationSiloId: s12.id,
        destinationSiloNumber: 12,
        originSiloId: s38.id,
        originSiloNumber: 38,
        transferRuleId: route38to12,
        plannedConsumptionKg: 18500,
        realizedConsumptionKg: 9400,
        availableStockKg: 4200,
        deficitKg: 4900,
        suggestedTransferKg: 12000,
        suggestedLotCode: '0011598201',
        pendingTransferInboundKg: 7000,
        confirmedPendingReceiptKg: 18840,
        actionType: 'CRIAR_TRANSFERENCIA',
        actionLabel: 'Homologar rota e transferir Silo 38 → Silo 12',
        justification: '[CENÁRIO DEMO] Silo 38 possui 68.500 kg de Calcário; Silo 12 está crítico (4.200 kg). Regra S38→S12 consta como pendente de validação no catálogo oficial.',
        priorityBreakdown: ['Risco de parada L4 (+40)', 'Cobertura < 50% (+25)', 'Saldo disponível na origem (+10)', 'Urgência programação (+10)'],
        compatibleAuthorizedRoutes: [],
        blockedOrPendingRoutes: [
          { ruleId: route38to12, originSiloNumber: 38, authorizationStatus: 'PENDENTE_VALIDACAO', reason: 'Anotação de caderno: Silo 38 -> 12 (Calcário). Aguarda validação.' },
        ],
        decisionStatus: 'EM_ANALISE',
        decisionNotes: '[CENÁRIO DEMO] Aguardando confirmação da supervisão.',
        decidedAt: nowIso,
        linkedTransferOrderId: 1,
        analyzedAtIso: nowIso,
      },
      {
        id: 2,
        recommendationKey: 'REC-DEMO-L4-PREMIX',
        headline: 'ABASTECER SILO 15 · VEÍCULO PREMIX (LINHA 4)',
        recommendationType: 'TRANSFERIR_SILO',
        priorityScore: 71,
        priorityLevel: 'ALTA',
        visualStatus: 'LARANJA',
        lineCode: 'L4',
        materialId: matPremix.id,
        materialCode: matPremix.code,
        materialDescription: matPremix.description,
        destinationSiloId: s15.id,
        destinationSiloNumber: 15,
        originSiloId: s37.id,
        originSiloNumber: 37,
        transferRuleId: route37to15,
        plannedConsumptionKg: 8000,
        realizedConsumptionKg: 4064,
        availableStockKg: 2200,
        deficitKg: 1736,
        suggestedTransferKg: 3500,
        suggestedLotCode: '0011622014',
        pendingTransferInboundKg: 3500,
        confirmedPendingReceiptKg: 0,
        actionType: 'CRIAR_TRANSFERENCIA',
        actionLabel: 'Transferir do Silo 37 → Silo 15 (Rota Oficial)',
        justification: '[CENÁRIO DEMO] Silo 37 possui 18.500 kg e rota homologada oficialmente S37 → S15.',
        priorityBreakdown: ['Necessidade no turno (+28)', 'Cobertura < 100% (+18)', 'Rota oficial S37→S15 (+15)', 'Saldo disponível (+10)'],
        compatibleAuthorizedRoutes: [
          { ruleId: route37to15, originSiloId: s37.id, originSiloNumber: 37, originStockKg: 18500, availableForTransferKg: 7504, restrictions: 'Rota homologada pela operação.' },
        ],
        blockedOrPendingRoutes: [],
        decisionStatus: 'PENDENTE',
        decisionNotes: null,
        decidedAt: null,
        linkedTransferOrderId: 2,
        analyzedAtIso: nowIso,
      },
    ],
    summary: {
      totalRows: 8,
      redCount: 2,
      orangeCount: 2,
      yellowCount: 0,
      greenCount: 3,
      grayCount: 1,
      totalDeficitKg: 8130,
      totalSuggestedTransferKg: 20500,
    },
    priorityConfig: {
      code: 'PADRAO_INDUSTRIAL',
      name: 'Priorização Operacional Padrão',
      description: 'Ponderação configurável de risco de parada da linha, cobertura atual, rota autorizada, disponibilidade na origem e urgência da programação.',
      weightLineStopRisk: 40,
      weightStockCoverage: 25,
      weightAuthorizedRoute: 15,
      weightOriginAvailability: 10,
      weightScheduleUrgency: 10,
      updatedAt: nowIso,
    },
    intakeRequests: [
      {
        id: 1,
        requestCode: `SOL-DEMO-${todayTag}-01`,
        materialId: matPremix.id,
        materialCode: matPremix.code,
        materialDescription: matPremix.description,
        productionLineId: 6,
        lineCode: 'L6',
        targetSiloId: s29.id,
        targetSiloNumber: 29,
        recommendationId: null,
        neededQuantityKg: 5000,
        neededByDate: tomorrow,
        priority: 'CRITICA',
        justification: '[CENÁRIO DEMO] Reposição solicitada para Linha 6.',
        status: 'ABERTA',
        requestedByName: 'Líder Produção [DEMO]',
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ],
  };

  const intelligenceSummary: IntelligenceSummaryResponse = {
    todayDate: today,
    tomorrowDate: tomorrow,
    totals: {
      realStockKg: 0,
      confirmedPendingEntriesKg: 34840,
      plannedConsumptionTodayKg: 0,
      plannedConsumptionTomorrowKg: 0,
      realizedConsumptionKg: 0,
      projectedBalanceTotalKg: 0,
      criticalMaterialsCount: 2,
      pendingSupplyCount: 3,
    },
    byMaterial: [
      {
        materialId: matCal.id,
        materialCode: matCal.code,
        materialDescription: matCal.description,
        isCritical: false,
        realStockKg: 0,
        confirmedPendingEntriesKg: 18840,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        plannedConsumptionFutureKg: 0,
        advancedConsumptionKg: 0,
        overdueConsumptionKg: 0,
        realizedConsumptionKg: 0,
        remainingPlannedTodayActiveKg: 0,
        remainingTotalPlannedKg: 0,
        projectedBalanceTodayKg: 0,
        projectedBalanceWithTomorrowKg: 0,
        minStockKg: 8000,
        warningStockKg: 15000,
        pendingFactorItemsCount: 0,
        statusPriority: 'VERMELHO',
        statusHeadline: '[CENÁRIO DEMO] Silo 12 (Linha 4) em nível crítico; maior volume concentrado no Silo 38 (Armazenagem).',
      },
      {
        materialId: matPremix.id,
        materialCode: matPremix.code,
        materialDescription: matPremix.description,
        isCritical: false,
        realStockKg: 0,
        confirmedPendingEntriesKg: 0,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        plannedConsumptionFutureKg: 0,
        advancedConsumptionKg: 0,
        overdueConsumptionKg: 0,
        realizedConsumptionKg: 0,
        remainingPlannedTodayActiveKg: 0,
        remainingTotalPlannedKg: 0,
        projectedBalanceTodayKg: 0,
        projectedBalanceWithTomorrowKg: 0,
        minStockKg: 1500,
        warningStockKg: 3500,
        pendingFactorItemsCount: 0,
        statusPriority: 'LARANJA',
        statusHeadline: '[CENÁRIO DEMO] Necessidade de transferência da Armazenagem (Silo 37) para Linhas 4, 5 e 6.',
      },
      {
        materialId: matFosfMono.id,
        materialCode: matFosfMono.code,
        materialDescription: matFosfMono.description,
        isCritical: false,
        realStockKg: 0,
        confirmedPendingEntriesKg: 16000,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        plannedConsumptionFutureKg: 0,
        advancedConsumptionKg: 0,
        overdueConsumptionKg: 0,
        realizedConsumptionKg: 0,
        remainingPlannedTodayActiveKg: 0,
        remainingTotalPlannedKg: 0,
        projectedBalanceTodayKg: 0,
        projectedBalanceWithTomorrowKg: 0,
        minStockKg: null,
        warningStockKg: null,
        pendingFactorItemsCount: 0,
        statusPriority: 'VERDE',
        statusHeadline: '[CENÁRIO DEMO] Cobertura adequada + recebimento parcial em curso no Silo 35.',
      },
      {
        materialId: matCaulim.id,
        materialCode: matCaulim.code,
        materialDescription: matCaulim.description,
        isCritical: false,
        realStockKg: 0,
        confirmedPendingEntriesKg: 0,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        plannedConsumptionFutureKg: 0,
        advancedConsumptionKg: 0,
        overdueConsumptionKg: 0,
        realizedConsumptionKg: 0,
        remainingPlannedTodayActiveKg: 0,
        remainingTotalPlannedKg: 0,
        projectedBalanceTodayKg: 0,
        projectedBalanceWithTomorrowKg: 0,
        minStockKg: 6000,
        warningStockKg: 12000,
        pendingFactorItemsCount: 0,
        statusPriority: 'VERDE',
        statusHeadline: '[CENÁRIO DEMO] Recebimento de 10 Big Bags concluído no Silo 17; consumo ativo na L3.',
      },
      {
        materialId: matFosfBi.id,
        materialCode: matFosfBi.code,
        materialDescription: matFosfBi.description,
        isCritical: false,
        realStockKg: 0,
        confirmedPendingEntriesKg: 0,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        plannedConsumptionFutureKg: 0,
        advancedConsumptionKg: 0,
        overdueConsumptionKg: 0,
        realizedConsumptionKg: 0,
        remainingPlannedTodayActiveKg: 0,
        remainingTotalPlannedKg: 0,
        projectedBalanceTodayKg: 0,
        projectedBalanceWithTomorrowKg: 0,
        minStockKg: 10000,
        warningStockKg: 20000,
        pendingFactorItemsCount: 0,
        statusPriority: 'VERDE',
        statusHeadline: '[CENÁRIO DEMO] Saldo consolidado na Armazenagem (Silo 39) e Linha 1 (Silo 26).',
      },
      {
        materialId: matMilhoBc.id,
        materialCode: matMilhoBc.code,
        materialDescription: matMilhoBc.description,
        isCritical: false,
        realStockKg: 0,
        confirmedPendingEntriesKg: 0,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        plannedConsumptionFutureKg: 0,
        advancedConsumptionKg: 0,
        overdueConsumptionKg: 0,
        realizedConsumptionKg: 0,
        remainingPlannedTodayActiveKg: 0,
        remainingTotalPlannedKg: 0,
        projectedBalanceTodayKg: 0,
        projectedBalanceWithTomorrowKg: 0,
        minStockKg: 10000,
        warningStockKg: 18000,
        pendingFactorItemsCount: 0,
        statusPriority: 'VERDE',
        statusHeadline: '[CENÁRIO DEMO] Cobertura regular nos silos 42 e 36 para L7.',
      },
      {
        materialId: matQuirera.id,
        materialCode: matQuirera.code,
        materialDescription: matQuirera.description,
        isCritical: false,
        realStockKg: 0,
        confirmedPendingEntriesKg: 0,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        plannedConsumptionFutureKg: 0,
        advancedConsumptionKg: 1200,
        overdueConsumptionKg: 0,
        realizedConsumptionKg: 0,
        remainingPlannedTodayActiveKg: 0,
        remainingTotalPlannedKg: 0,
        projectedBalanceTodayKg: 0,
        projectedBalanceWithTomorrowKg: 0,
        minStockKg: 4000,
        warningStockKg: 8000,
        pendingFactorItemsCount: 0,
        statusPriority: 'VERDE',
        statusHeadline: '[CENÁRIO DEMO] Consumo adiantado na Linha 2 (Silo 23) com cobertura segura.',
      },
      {
        materialId: matSalMoido.id,
        materialCode: matSalMoido.code,
        materialDescription: matSalMoido.description,
        isCritical: false,
        realStockKg: 0,
        confirmedPendingEntriesKg: 0,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        plannedConsumptionFutureKg: 0,
        advancedConsumptionKg: 0,
        overdueConsumptionKg: 0,
        realizedConsumptionKg: 0,
        remainingPlannedTodayActiveKg: 0,
        remainingTotalPlannedKg: 0,
        projectedBalanceTodayKg: 0,
        projectedBalanceWithTomorrowKg: 0,
        minStockKg: 1500,
        warningStockKg: 3000,
        pendingFactorItemsCount: 1,
        statusPriority: 'AZUL',
        statusHeadline: '[CENÁRIO DEMO] Fator pendente de validação em PROD-DEMO-06 (cálculo bloqueado por segurança).',
      },
    ],
    alerts: [
      {
        key: 'ALERT-DEMO-1',
        priority: 'VERMELHO',
        title: '[CENÁRIO DEMO] Risco Crítico — Silo 12 (Linha 4)',
        message: 'Silo 12 com 4.200 kg de Calcário abaixo do mínimo configurado (8.000 kg). Avaliar homologação de rota e conclusão da transferência S38 → S12.',
        materialCode: matCal.code,
        lineCode: 'L4',
        siloNumber: 12,
        referenceDate: today,
      },
      {
        key: 'ALERT-DEMO-2',
        priority: 'LARANJA',
        title: '[CENÁRIO DEMO] Atenção — Silo 15 (Linha 4) e Silo 10 (Linha 5)',
        message: 'Silos de Veículo Premix abaixo de 25% da capacidade segura. Rota homologada disponível a partir do Silo 37 (18.500 kg).',
        materialCode: matPremix.code,
        lineCode: 'L4',
        siloNumber: 15,
        referenceDate: today,
      },
      {
        key: 'ALERT-DEMO-3',
        priority: 'AZUL',
        title: '[CENÁRIO DEMO] Fator Pendente de Validação — Sal Moído (Linha 2)',
        message: 'Item PROD-DEMO-06 na programação de hoje possui fator preliminar não validado; o sistema preserva a trava sem inventar consumo estimado.',
        materialCode: matSalMoido.code,
        lineCode: 'L2',
        siloNumber: 43,
        referenceDate: today,
      },
      {
        key: 'ALERT-DEMO-4',
        priority: 'VERDE',
        title: '[CENÁRIO DEMO] Cobertura Regular — Fosfato Mono (L3) e Milho BC (L7)',
        message: 'Silos 20, 35 e 42 com estoque suficiente para a programação aprovada de hoje e amanhã.',
        materialCode: matMilhoBc.code,
        lineCode: 'L7',
        siloNumber: 42,
        referenceDate: today,
      },
    ],
    recommendations: [
      {
        id: 1,
        recommendationKey: 'INTEL-DEMO-S12',
        recommendationType: 'TRANSFERIR_SILO',
        priority: 'VERMELHO',
        title: 'Abastecer Silo 12 (Linha 4) · Calcário',
        reason: 'Saldo atual de 4.200 kg não cobre o saldo restante programado hoje na L4 (9.100 kg). Silo 38 possui 68.500 kg.',
        referenceDate: today,
        lineCode: 'L4',
        materialId: matCal.id,
        materialCode: matCal.code,
        materialDescription: matCal.description,
        targetSiloId: s12.id,
        targetSiloNumber: 12,
        originSiloId: s38.id,
        originSiloNumber: 38,
        requiredKg: 9100,
        availableKg: 4200,
        missingKg: 4900,
        suggestedTransferKg: 12000,
        dataSourceSummary: '[CENÁRIO DEMO] Confronto programação R2 vs saldo Silo 12',
        decisionStatus: 'PENDENTE',
        decisionNotes: null,
        decidedAt: null,
      },
      {
        id: 2,
        recommendationKey: 'INTEL-DEMO-S15',
        recommendationType: 'TRANSFERIR_SILO',
        priority: 'LARANJA',
        title: 'Transferir Veículo Premix S37 → S15 (Linha 4)',
        reason: 'Silo 15 com 2.200 kg (abaixo do limite de atenção 3.500 kg). Rota oficial S37→S15 ativa com 18.500 kg na origem.',
        referenceDate: today,
        lineCode: 'L4',
        materialId: matPremix.id,
        materialCode: matPremix.code,
        materialDescription: matPremix.description,
        targetSiloId: s15.id,
        targetSiloNumber: 15,
        originSiloId: s37.id,
        originSiloNumber: 37,
        requiredKg: 3936,
        availableKg: 2200,
        missingKg: 1736,
        suggestedTransferKg: 3500,
        dataSourceSummary: '[CENÁRIO DEMO] Confronto programação R2 vs rota homologada S37→S15',
        decisionStatus: 'PENDENTE',
        decisionNotes: null,
        decidedAt: null,
      },
      {
        id: 3,
        recommendationKey: 'INTEL-DEMO-SAL-FATOR',
        recommendationType: 'REVISAR_FATOR',
        priority: 'AZUL',
        title: 'Validar fator de Sal Moído em PROD-DEMO-06 (Linha 2)',
        reason: 'Fator preliminar (120 kg/t) aguarda validação oficial para liberar projeção automática de consumo na L2.',
        referenceDate: today,
        lineCode: 'L2',
        materialId: matSalMoido.id,
        materialCode: matSalMoido.code,
        materialDescription: matSalMoido.description,
        targetSiloId: s43.id,
        targetSiloNumber: 43,
        originSiloId: null,
        originSiloNumber: null,
        requiredKg: 0,
        availableKg: s43.confirmedStockKg,
        missingKg: 0,
        suggestedTransferKg: null,
        dataSourceSummary: '[CENÁRIO DEMO] Fator preliminar PENDENTE_VALIDACAO na ficha técnica',
        decisionStatus: 'PENDENTE',
        decisionNotes: null,
        decidedAt: null,
      },
    ],
    latestSchedule: {
      id: 1,
      scheduleCode: schedules[0].scheduleCode,
      referenceDate: today,
      revisionNumber: 2,
      revisionDiffSummary: '[CENÁRIO DEMO] Rev. 2 ativa com cobertura completa de L1 a L7.',
      approvedAt: makeIsoAtLocalTime(today, '06:30'),
    },
  };

  const openShiftPendencies: ShiftHandoverPendencyView[] = [
    {
      id: 1,
      pendencyCode: `PEND-DEMO-${todayTag}-01`,
      handoverId: 1,
      handoverCode: `PASS-DEMO-${todayTag}-T1`,
      shiftCode: 'TURNO_1',
      operationalDate: today,
      sourceType: 'DESCARGA_PARCIAL',
      sourceEntityId: receipts[0].receiptNumber,
      title: '[CENÁRIO DEMO] Concluir descarga parcial de Calcário (18.840 kg restantes)',
      description: 'Caminhão placa ABC-4D21 já descarregou 20.000 kg no Silo 21; direcionar saldo ao Silo 38.',
      priority: 'ALTA',
      status: 'ABERTA',
      acknowledgedByName: null,
      acknowledgedAt: null,
      acknowledgmentNote: null,
      resolvedByName: null,
      resolvedAt: null,
      resolutionNotes: null,
      createdAt: nowIso,
    },
    {
      id: 2,
      pendencyCode: `PEND-DEMO-${todayTag}-02`,
      handoverId: 1,
      handoverCode: `PASS-DEMO-${todayTag}-T1`,
      shiftCode: 'TURNO_1',
      operationalDate: today,
      sourceType: 'TRANSFERENCIA_PENDENTE',
      sourceEntityId: transferOrders[0].orderCode,
      title: '[CENÁRIO DEMO] Finalizar transferência Silo 38 → Silo 12 (7.000 kg restantes)',
      description: 'Linha 4 com consumo ativo; concluir segunda etapa para restabelecer margem de segurança.',
      priority: 'CRITICA',
      status: 'ABERTA',
      acknowledgedByName: null,
      acknowledgedAt: null,
      acknowledgmentNote: null,
      resolvedByName: null,
      resolvedAt: null,
      resolutionNotes: null,
      createdAt: nowIso,
    },
  ];

  const occurrences: OccurrenceItem[] = [
    {
      id: 1,
      occurrenceCode: `OC-DEMO-${todayTag}-01`,
      category: 'Falha de equipamento',
      title: '[CENÁRIO DEMO] Inspeção preventiva na válvula do Silo 40',
      description: '[CENÁRIO DEMO] Silo 40 colocado em manutenção preventiva antes do próximo recebimento de Gérmen de Milho.',
      occurredAt: makeIsoAtLocalTime(today, '09:30'),
      siloId: s40.id,
      siloNumber: 40,
      materialId: matGermen.id,
      materialCode: matGermen.code,
      materialDescription: matGermen.description,
      productionLineId: 7,
      lineCode: 'L7',
      reportedByUserId: 901,
      reportedByName: 'Carlos Silva [DEMO]',
      assignedToUserId: 901,
      assignedToName: 'Manutenção Industrial [DEMO]',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      priority: 'ALTA',
      evidence: [{ name: 'ordem-preventiva-demo.txt', dataUrlOrNote: '[CENÁRIO DEMO] OS #4412 registrada pela manutenção.' }],
      status: 'EM_ANDAMENTO',
      solutionApplied: null,
      closedByName: null,
      closedAt: null,
      createdAt: makeIsoAtLocalTime(today, '09:30'),
      updatedAt: makeIsoAtLocalTime(today, '09:35'),
    },
    {
      id: 2,
      occurrenceCode: `OC-DEMO-${todayTag}-02`,
      category: 'Silo com capacidade insuficiente',
      title: '[CENÁRIO DEMO] Rateio necessário para carga de Calcário (38.840 kg)',
      description: '[CENÁRIO DEMO] Carga de 38.840 kg dividida entre Silo 21 (20.000 kg) e saldo de 18.840 kg direcionado ao Silo 38.',
      occurredAt: makeIsoAtLocalTime(today, '11:30'),
      siloId: s21.id,
      siloNumber: 21,
      materialId: matCal.id,
      materialCode: matCal.code,
      materialDescription: matCal.description,
      productionLineId: 3,
      lineCode: 'L3',
      reportedByUserId: 901,
      reportedByName: 'Carlos Silva [DEMO]',
      assignedToUserId: 901,
      assignedToName: 'Supervisão Moega [DEMO]',
      shiftCode: 'TURNO_1',
      operationalDate: today,
      priority: 'MEDIA',
      evidence: [],
      status: 'ABERTA',
      solutionApplied: null,
      closedByName: null,
      closedAt: null,
      createdAt: makeIsoAtLocalTime(today, '11:30'),
      updatedAt: makeIsoAtLocalTime(today, '11:30'),
    },
  ];

  const performanceTargets: PerformanceTargetItem[] = [
    {
      id: 1,
      code: 'META-DEMO-DESC',
      metricKey: 'AVG_RECEIPT_TIME',
      label: '[CENÁRIO DEMO] Tempo alvo de descarga por caminhão',
      targetValue: 45,
      unit: 'min',
      targetPeriod: 'DIARIO',
      effectiveFromDate: today,
      notes: 'Meta ilustrativa configurável pelo Administrador.',
      isActive: true,
      updatedByName: 'Supervisor Moega [DEMO]',
      updatedAt: nowIso,
    },
  ];

  const recentSnapshots: ReportSnapshotItem[] = [
    {
      id: 1,
      snapshotCode: `REL-DEMO-${todayTag}-01`,
      reportType: 'INDICADORES',
      title: 'Resumo Operacional Turno 1 [CENÁRIO DEMO]',
      format: 'PDF',
      periodStart: today,
      periodEnd: today,
      filtersJson: '{}',
      totalsJson: '{}',
      dataOrigin: 'CENÁRIO DEMONSTRATIVO (SOBRE CATÁLOGO REAL)',
      version: 1,
      generatedByName: 'Supervisor Moega [DEMO]',
      createdAt: nowIso,
    },
  ];

  return {
    receipts,
    movements,
    transferOrders,
    schedules,
    scheduleDocuments,
    products,
    supplyBoard,
    intelligenceSummary,
    openShiftPendencies,
    occurrences,
    performanceTargets,
    recentSnapshots,
  };
}

function buildLiveEmptyCollections(
  activeShift: ReturnType<typeof resolveOperationalShift>
) {
  const today = activeShift.operationalDate;
  const tomorrow = addDaysToYmd(today, 1);
  const nowIso = activeShift.realTimestampIso;

  return {
    receipts: [] as ReceiptItem[],
    movements: [] as InventoryMovementItem[],
    transferOrders: [] as TransferOrderItem[],
    schedules: [] as ProductionScheduleView[],
    scheduleDocuments: {} as Record<number, ArchivedScheduleDocumentPreview>,
    products: [] as ProductWithFactorsItem[],
    supplyBoard: {
      todayDate: today,
      tomorrowDate: tomorrow,
      analyzedAtIso: nowIso,
      boardRows: [],
      recommendations: [],
      summary: {
        totalRows: 0,
        redCount: 0,
        orangeCount: 0,
        yellowCount: 0,
        greenCount: 0,
        grayCount: 0,
        totalDeficitKg: 0,
        totalSuggestedTransferKg: 0,
      },
      priorityConfig: {
        code: 'PADRAO_INDUSTRIAL',
        name: 'Priorização Operacional Padrão',
        description: 'Ponderação oficial do PostgreSQL.',
        weightLineStopRisk: 40,
        weightStockCoverage: 25,
        weightAuthorizedRoute: 15,
        weightOriginAvailability: 10,
        weightScheduleUrgency: 10,
        updatedAt: nowIso,
      },
      intakeRequests: [],
    } as ProductionSupplyBoardResponse,
    intelligenceSummary: {
      todayDate: today,
      tomorrowDate: tomorrow,
      totals: {
        realStockKg: 0,
        confirmedPendingEntriesKg: 0,
        plannedConsumptionTodayKg: 0,
        plannedConsumptionTomorrowKg: 0,
        realizedConsumptionKg: 0,
        projectedBalanceTotalKg: 0,
        criticalMaterialsCount: 0,
        pendingSupplyCount: 0,
      },
      byMaterial: [],
      alerts: [],
      recommendations: [],
      latestSchedule: null,
    } as IntelligenceSummaryResponse,
    openShiftPendencies: [] as ShiftHandoverPendencyView[],
    occurrences: [] as OccurrenceItem[],
    performanceTargets: [] as PerformanceTargetItem[],
    recentSnapshots: [] as ReportSnapshotItem[],
  };
}

export function createInitialDemoState(mode: PresentationViewMode = 'CENARIO_REALISTA'): DemoSandboxState {
  const activeShift = resolveOperationalShift();
  const today = activeShift.operationalDate;
  const nowIso = activeShift.realTimestampIso;

  const demoUser: AppUser = {
    id: 901,
    uid: 'demo-supervisor-moega',
    email: 'apresentacao.demo@nexolog.local',
    displayName: 'Modo Apresentação · Supervisão Moega',
    badgeCode: 'APRES-01',
    jobTitle: 'Supervisor de Logística e Moega',
    department: 'Recebimento e Abastecimento (Moega)',
    roleCode: 'ADMIN',
    roleName: 'Apresentação Executiva (Somente Leitura / Sandbox)',
    defaultShiftCode: activeShift.shiftCode,
    isActive: true,
  };

  const session: SessionData = {
    user: demoUser,
    permissions: ROLE_PERMISSIONS.ADMIN,
    shift: activeShift,
  };

  const matCal = MAT_BY_CODE.get('2017101021')!;
  const matPremix = MAT_BY_CODE.get('1113101920')!;
  const thresholds: StockThresholdItem[] = [
    { id: 1, materialId: matCal.id, materialCode: matCal.code, materialDescription: matCal.description, siloId: 4, siloNumber: 12, minStockKg: 8000, warningStockKg: 15000, notes: 'Limite de conferência para Silo 12 (Linha 4)', updatedAt: nowIso },
    { id: 2, materialId: matPremix.id, materialCode: matPremix.code, materialDescription: matPremix.description, siloId: 7, siloNumber: 15, minStockKg: 1500, warningStockKg: 3500, notes: 'Limite de conferência para Silo 15 (Linha 4)', updatedAt: nowIso },
    { id: 3, materialId: matPremix.id, materialCode: matPremix.code, materialDescription: matPremix.description, siloId: 23, siloNumber: 29, minStockKg: 800, warningStockKg: 1500, notes: 'Limite de conferência para Silo 29 (Linha 6)', updatedAt: nowIso },
  ];

  const silos = buildSilosForMode(thresholds, mode, nowIso);
  const siloByNum = new Map(silos.map((s) => [s.siloNumber, s]));
  const { bagConfigs, pendencies, buildOfficialRules } = buildOfficialCatalogEntities(nowIso);
  const { transferRules, routes } = buildOfficialRules(siloByNum);

  const shifts: ShiftConfigView[] = [
    {
      id: 1,
      code: 'TURNO_1',
      name: '1º Turno',
      startTime: '07:30',
      endTime: '17:18',
      crossesMidnight: false,
      supervisorUserId: null,
      supervisorName: null,
      responsibleName: null,
      operatorIds: [],
      operators: [],
      isValidated: false,
      isActive: true,
      notes: 'Turno diurno padrão (07:30 às 17:18; sobreposição 17:00–17:18 com 2º Turno).',
      updatedAt: nowIso,
    },
    {
      id: 2,
      code: 'TURNO_2',
      name: '2º Turno',
      startTime: '17:00',
      endTime: '02:12',
      crossesMidnight: true,
      supervisorUserId: null,
      supervisorName: null,
      responsibleName: null,
      operatorIds: [],
      operators: [],
      isValidated: false,
      isActive: true,
      notes: 'Cruza meia-noite (17:00 às 02:12); preserva data operacional de início após 00:00.',
      updatedAt: nowIso,
    },
    {
      id: 3,
      code: 'TURNO_3',
      name: '3º Turno',
      startTime: '23:28',
      endTime: '07:30',
      crossesMidnight: true,
      supervisorUserId: null,
      supervisorName: null,
      responsibleName: null,
      operatorIds: [],
      operators: [],
      isValidated: false,
      isActive: true,
      notes: 'Turno noturno (23:28 às 07:30); preserva data operacional de início após 00:00.',
      updatedAt: nowIso,
    },
  ];

  const collections =
    mode === 'CENARIO_REALISTA'
      ? buildRealisticScenarioCollections(silos, routes, activeShift)
      : buildLiveEmptyCollections(activeShift);

  const auditEvents: AuditEventItem[] =
    mode === 'CENARIO_REALISTA'
      ? [
          {
            id: 1,
            userId: 901,
            userEmail: 'apresentacao.demo@nexolog.local',
            userName: 'Carlos Silva [DEMO]',
            userRole: 'OPERADOR_MOEGA',
            action: 'RECEIPT_PARTIAL_DISTRIBUTION',
            entityType: 'RECEIPT',
            entityId: collections.receipts[0]?.receiptNumber || 'REC-DEMO',
            previousValue: null,
            newValue: '{"silo":21,"kg":20000,"remainingKg":18840}',
            reason: '[CENÁRIO DEMO] Registro de 1ª etapa de descarga em múltiplos silos',
            origin: 'MODO_APRESENTACAO_DEMO',
            createdAt: makeIsoAtLocalTime(today, '11:45'),
          },
          {
            id: 2,
            userId: 901,
            userEmail: 'apresentacao.demo@nexolog.local',
            userName: 'Carlos Silva [DEMO]',
            userRole: 'OPERADOR_MOEGA',
            action: 'TRANSFER_STEP_EXECUTED',
            entityType: 'TRANSFER_ORDER',
            entityId: collections.transferOrders[0]?.orderCode || 'TRF-DEMO',
            previousValue: '{"transferredKg":0}',
            newValue: '{"transferredKg":8000,"origin":38,"destination":12}',
            reason: '[CENÁRIO DEMO] Débito e crédito atômicos na mesma transação',
            origin: 'MODO_APRESENTACAO_DEMO',
            createdAt: makeIsoAtLocalTime(today, '10:15'),
          },
          {
            id: 3,
            userId: 901,
            userEmail: 'apresentacao.demo@nexolog.local',
            userName: 'Supervisor Moega [DEMO]',
            userRole: 'SUPERVISOR',
            action: 'SCHEDULE_APPROVED',
            entityType: 'PRODUCTION_SCHEDULE',
            entityId: collections.schedules[0]?.scheduleCode || 'PROG-DEMO',
            previousValue: '{"status":"RASCUNHO_CONFERENCIA"}',
            newValue: '{"status":"APROVADA"}',
            reason: '[CENÁRIO DEMO] Aprovação da programação diária para projeção de consumo',
            origin: 'MODO_APRESENTACAO_DEMO',
            createdAt: makeIsoAtLocalTime(today, '06:30'),
          },
        ]
      : [];

  const users: AppUser[] = [
    demoUser,
    { id: 902, uid: 'demo-op-02', email: 'joao.mendes@nexolog.local', displayName: 'João Mendes [DEMO]', badgeCode: 'OP-102', jobTitle: 'Operador de Moega II', department: 'Recebimento Moega', roleCode: 'OPERADOR_MOEGA', roleName: 'Operador Moega', defaultShiftCode: 'TURNO_1', isActive: true },
    { id: 903, uid: 'demo-sup-01', email: 'supervisor@nexolog.local', displayName: 'Supervisor Moega [DEMO]', badgeCode: 'SUP-01', jobTitle: 'Supervisor de Turno', department: 'Logística Industrial', roleCode: 'SUPERVISOR', roleName: 'Supervisor', defaultShiftCode: 'TURNO_1', isActive: true },
    { id: 904, uid: 'demo-prod-01', email: 'producao@nexolog.local', displayName: 'Líder Produção [DEMO]', badgeCode: 'PRD-01', jobTitle: 'Líder de Linha de Produção', department: 'Produção Fabril', roleCode: 'PRODUCAO', roleName: 'Produção (Consulta)', defaultShiftCode: 'TURNO_1', isActive: true },
  ];

  const liveCounts: PresentationLiveCounts = {
    silos: silos.length,
    materials: BASE_MATERIALS.length,
    suppliers: BASE_SUPPLIERS.length,
    bagConfigs: bagConfigs.length,
    transferRules: transferRules.length,
    activeTransferRules: transferRules.filter((r) => r.isActive).length,
    pendenciesPending: pendencies.filter((p) => p.status === 'PENDENTE').length,
    helpArticles: BASE_HELP_ARTICLES.length,
    receipts: 0,
    movements: 0,
    transferOrders: 0,
    schedules: 0,
    occurrences: 0,
    handovers: 0,
    intakeRequests: 0,
    labelScans: 0,
    auditEvents: 0,
    totalRealStockKg: 0,
    totalNominalCapacityKg: silos.reduce((a, s) => a + s.nominalCapacityKg, 0),
    totalSafeCapacityKg: silos.reduce((a, s) => a + s.safeCapacityKg, 0),
  };

  const state: DemoSandboxState = {
    viewMode: mode,
    bootstrapSyncedAtIso: null,
    bootstrapPayload: null,
    liveCounts,
    session,
    lines: BASE_LINES.map((l) => ({ ...l })),
    scheduleTemplates: BASE_SCHEDULE_TEMPLATES.map((t) => ({ ...t })),
    materials: BASE_MATERIALS.map((m) => ({ ...m })),
    suppliers: BASE_SUPPLIERS.map((s) => ({ ...s })),
    bagConfigs,
    silos,
    transferRules,
    routes,
    pendencies,
    receipts: collections.receipts,
    movements: collections.movements,
    transferOrders: collections.transferOrders,
    schedules: collections.schedules,
    scheduleDocuments: collections.scheduleDocuments,
    products: collections.products,
    thresholds,
    supplyBoard: collections.supplyBoard,
    intelligenceSummary: collections.intelligenceSummary,
    shifts,
    handovers: [],
    openShiftPendencies: collections.openShiftPendencies,
    occurrences: collections.occurrences,
    performanceTargets: collections.performanceTargets,
    recentSnapshots: collections.recentSnapshots,
    auditEvents,
    users,
    helpArticles: BASE_HELP_ARTICLES.map((h) => ({ ...h })),
    basketVersions: [],
    basketComparisons: [],
  };

  const refBaskets = buildReference2511BasketVersions(state.materials);
  state.basketVersions = refBaskets;
  const v1 = refBaskets[0];
  const v4 = refBaskets[3];
  const cmp2511 = compareBasketVersions({
    comparisonId: 1,
    comparisonCode: 'CMP-20261125-07H-19H',
    productionDate: '2026-11-25',
    baseVersion: { id: v1.id, label: v1.label, emissionTime: v1.emissionTime },
    targetVersion: { id: v4.id, label: v4.label, emissionTime: v4.emissionTime },
    baseItems: v1.items,
    targetItems: v4.items,
    silos: state.silos,
    materials: state.materials,
    transferRules: state.transferRules,
    createdByName: 'Supervisão Moega [DEMO]',
    publishedByName: 'Supervisor Turno 2 [DEMO]',
    publishedAt: '2026-11-25T19:08:00.000Z',
    status: 'PUBLICADA',
    createdAt: '2026-11-25T19:05:00.000Z',
  });
  state.basketComparisons = [cmp2511];

  recomputeDemoDerivedState(state);

  if (mode === 'CENARIO_REALISTA') {
    const todayTag = today.replace(/-/g, '');
    const autoSum = buildDemoAutoSummary(state, 'TURNO_1', today);
    const narrativeText = buildMoegaShiftNarrativeReport({
      summary: autoSum,
      handoverByName: 'Carlos Silva [DEMO]',
      handoverByBadge: 'OP-101',
      shiftSummaryText: '[CENÁRIO DEMO] Turno com descarga remanescente do 3º turno anterior concluída, corte de 10 Big Bags de Caulim no Silo 17 e transferências ativas para Linha 4.',
      relevantOccurrencesText: '[CENÁRIO DEMO] Silo 40 bloqueado para manutenção preventiva da válvula.',
      pendenciesText: '[CENÁRIO DEMO] Concluir descarga parcial NF 048.912 e 2ª etapa da transferência S38→S12.',
      requiredActionsText: '[CENÁRIO DEMO] Priorizar abastecimento do Silo 12 e validar rotas anotadas.',
      nextShiftRecommendationsText: '[CENÁRIO DEMO] Conferir recebimento previsto para 2º turno.',
    });
    state.handovers = [
      {
        id: 1,
        handoverCode: `PASS-DEMO-${todayTag}-T1`,
        shiftCode: 'TURNO_1',
        shiftName: '1º Turno (07:30–17:18)',
        operationalDate: today,
        status: 'RASCUNHO',
        workflowStatus: 'EM_ELABORACAO',
        autoSummary: autoSum,
        shiftSummaryText: '[CENÁRIO DEMO] Turno com recebimentos e descarga remanescente do 3º turno concluída.',
        relevantOccurrencesText: '[CENÁRIO DEMO] Silo 40 bloqueado para manutenção preventiva da válvula.',
        pendenciesText: '[CENÁRIO DEMO] Concluir descarga parcial NF 048.912 e 2ª etapa da transferência S38→S12.',
        requiredActionsText: '[CENÁRIO DEMO] Priorizar abastecimento do Silo 12 e validar rotas anotadas.',
        nextShiftRecommendationsText: '[CENÁRIO DEMO] Conferir recebimento previsto para 2º turno.',
        autoReportText: narrativeText,
        editedReportText: narrativeText,
        supplements: [],
        vehicleBreakdown: autoSum.vehicleBreakdown || null,
        aiEditCount: 0,
        lastAiCommand: null,
        handoverByUserId: 901,
        handoverByName: 'Carlos Silva [DEMO]',
        handoverByBadge: 'OP-101',
        receivedByUserId: null,
        receivedByName: null,
        reviewedByName: null,
        approvedByName: null,
        approvedAt: null,
        approvalNotes: null,
        finalizedByName: null,
        finalizedAt: null,
        closedAt: null,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        pendencies: state.openShiftPendencies,
        revisions: [
          {
            id: 1,
            handoverId: 1,
            version: 1,
            workflowStatus: 'EM_ELABORACAO',
            changeType: 'GERACAO_INICIAL',
            reportText: narrativeText,
            aiCommand: null,
            reason: 'Geração automática inicial do turno',
            editedByUserId: 901,
            editedByName: 'Carlos Silva [DEMO]',
            editedByBadge: 'OP-101',
            createdAt: nowIso,
          },
        ],
      },
    ];
  }

  return state;
}

export function applyPresentationBootstrap(
  bootstrap: PresentationBootstrapPayload,
  viewMode: PresentationViewMode = 'CENARIO_REALISTA'
): DemoSandboxState {
  const base = createInitialDemoState(viewMode);
  base.bootstrapSyncedAtIso = bootstrap.generatedAtIso;
  base.bootstrapPayload = bootstrap;
  base.liveCounts = { ...bootstrap.liveCounts };
  base.viewMode = viewMode;

  base.session = {
    ...base.session,
    shift: {
      ...bootstrap.activeShift,
    },
    user: {
      ...base.session.user,
      defaultShiftCode: bootstrap.activeShift.shiftCode,
    },
  };

  base.lines = bootstrap.lines.map((l) => ({ ...l }));
  base.materials = bootstrap.materials.map((m) => ({ ...m }));
  base.suppliers = bootstrap.suppliers.map((s) => ({ ...s }));
  base.bagConfigs = bootstrap.bagConfigs.map((b) => ({ ...b }));
  base.transferRules = bootstrap.transferRules.map((tr) => ({ ...tr }));
  base.routes = bootstrap.routes.map((r) => ({ ...r, history: [...(r.history || [])] }));
  base.pendencies = bootstrap.pendencies.map((p) => ({ ...p }));
  const mergedHelpBySlug = new Map(BASE_HELP_ARTICLES.map((h) => [h.slug, h]));
  for (const h of bootstrap.helpArticles) {
    mergedHelpBySlug.set(h.slug, { ...h });
  }
  base.helpArticles = Array.from(mergedHelpBySlug.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  base.scheduleTemplates = bootstrap.scheduleTemplates.map((t) => ({ ...t }));
  base.shifts = bootstrap.shifts.map((s) => ({ ...s, operatorIds: [...s.operatorIds], operators: [...s.operators] }));

  const defBySiloNum = new Map(DEMO_SILO_DEFS.map((d) => [d.siloNumber, d]));
  const dbSiloByNum = new Map(bootstrap.silos.map((s) => [s.siloNumber, s]));

  if (viewMode === 'BANCO_AO_VIVO') {
    base.silos = bootstrap.silos.map((s) => ({ ...s, compatibilities: [...(s.compatibilities || [])] }));
    base.products = bootstrap.products.map((p) => ({ ...p, factors: [...(p.factors || [])] }));
    base.thresholds = bootstrap.thresholds.map((t) => ({ ...t }));
    base.receipts = bootstrap.liveSnapshot.receipts.map((r) => ({ ...r, distributions: [...(r.distributions || [])] }));
    base.movements = bootstrap.liveSnapshot.movements.map((m) => ({ ...m }));
    base.transferOrders = bootstrap.liveSnapshot.transferOrders.map((t) => ({ ...t, steps: [...(t.steps || [])] }));
    base.schedules = bootstrap.liveSnapshot.schedules.map((sc) => ({ ...sc, items: [...(sc.items || [])] }));
    base.supplyBoard = structuredClone(bootstrap.liveSnapshot.supplyBoard);
    base.intelligenceSummary = structuredClone(bootstrap.liveSnapshot.intelligenceSummary);
    base.occurrences = bootstrap.liveSnapshot.occurrences.map((o) => ({ ...o }));
    base.handovers = bootstrap.liveSnapshot.handovers.map((h) => ({ ...h }));
    base.openShiftPendencies = bootstrap.liveSnapshot.openShiftPendencies.map((p) => ({ ...p }));
    base.performanceTargets = bootstrap.liveSnapshot.performanceTargets.map((pt) => ({ ...pt }));
    base.recentSnapshots = bootstrap.liveSnapshot.recentSnapshots.map((rs) => ({ ...rs }));
    base.auditEvents = [];
    return base;
  }

  // CENARIO_REALISTA sobre Catálogo Real PostgreSQL (preserva IDs reais, capacidades reais, regras reais, pendências reais)
  if (bootstrap.products.length > 0) {
    const realCodes = new Set(bootstrap.products.map((p) => p.code.toUpperCase()));
    const demoOnly = base.products.filter((dp) => !realCodes.has(dp.code.toUpperCase()));
    base.products = [
      ...bootstrap.products.map((p) => ({ ...p, factors: [...(p.factors || [])] })),
      ...demoOnly,
    ];
  }
  if (bootstrap.thresholds.length > 0) {
    const realKeys = new Set(bootstrap.thresholds.map((t) => `${t.materialCode}::${t.siloNumber ?? 'ALL'}`));
    const demoOnlyThr = base.thresholds.filter(
      (dt) => !realKeys.has(`${dt.materialCode}::${dt.siloNumber ?? 'ALL'}`)
    );
    base.thresholds = [...bootstrap.thresholds.map((t) => ({ ...t })), ...demoOnlyThr];
  }

  const bootstrapTotalStockByMat = new Map<number, number>();
  for (const realSilo of bootstrap.silos) {
    if (!realSilo.primaryMaterialId) continue;
    const def = defBySiloNum.get(realSilo.siloNumber);
    const stockKg =
      realSilo.confirmedStockKg > 0 ? realSilo.confirmedStockKg : (def?.demoStockKg ?? 0);
    bootstrapTotalStockByMat.set(
      realSilo.primaryMaterialId,
      (bootstrapTotalStockByMat.get(realSilo.primaryMaterialId) ?? 0) + stockKg
    );
  }

  base.silos = bootstrap.silos.map((realSilo) => {
    const def = defBySiloNum.get(realSilo.siloNumber);
    const stockKg =
      realSilo.confirmedStockKg > 0
        ? realSilo.confirmedStockKg
        : (def?.demoStockKg ?? 0);
    const opStatus =
      realSilo.operationalStatus !== 'OPERACIONAL'
        ? realSilo.operationalStatus
        : (def?.demoStatus ?? 'OPERACIONAL');
    const safeCap = realSilo.safeCapacityKg;
    const occupancyPercent = safeCap > 0 ? Math.round((stockKg / safeCap) * 1000) / 10 : 0;
    const th = base.thresholds.find((t) => t.siloId === realSilo.id || t.siloNumber === realSilo.siloNumber);
    const globalTh =
      !th && realSilo.primaryMaterialId
        ? base.thresholds.find(
            (t) => !t.siloId && !t.siloNumber && t.materialId === realSilo.primaryMaterialId
          )
        : undefined;
    const evalRes = evaluateSiloStockStatus({
      confirmedStockKg: stockKg,
      safeCapacityKg: safeCap,
      occupancyPercent,
      operationalStatus: opStatus,
      primaryMaterialId: realSilo.primaryMaterialId,
      siloThreshold: th ? { minStockKg: th.minStockKg, warningStockKg: th.warningStockKg } : null,
      globalThreshold: globalTh
        ? {
            minStockKg: globalTh.minStockKg,
            warningStockKg: globalTh.warningStockKg,
            totalMaterialStockKg:
              bootstrapTotalStockByMat.get(realSilo.primaryMaterialId!) ?? stockKg,
          }
        : null,
      activeRecommendationPriority: def?.demoRecPriority ?? null,
      activeRecommendationReason: def?.demoRecReason ?? null,
    });

    return {
      ...realSilo,
      operationalStatus: opStatus,
      cleaningStatus: opStatus === 'MANUTENCAO' ? 'REQUER_LIMPEZA' : realSilo.cleaningStatus,
      restrictions:
        realSilo.restrictions ||
        (opStatus === 'MANUTENCAO' ? '[CENÁRIO DEMO] Manutenção preventiva programada' : null),
      confirmedStockKg: stockKg,
      availableSpaceKg: Math.max(0, safeCap - stockKg),
      occupancyPercent,
      stockAlertLevel: evalRes.stockAlertLevel,
      stockAlertReason: evalRes.stockAlertReason,
      minStockKg: evalRes.minStockKg,
      warningStockKg: evalRes.warningStockKg,
      isReceiving: Boolean(def?.demoIsReceiving),
      lastMovementAt: stockKg > 0 ? (realSilo.lastMovementAt || bootstrap.generatedAtIso) : null,
      compatibilities: [...(realSilo.compatibilities || [])],
    };
  });

  // Remapeia referências de siloId / materialId nos dados do cenário demonstrativo para os IDs reais do PostgreSQL
  const mapSiloId = (siloNum: number | null | undefined, fallbackId: number | null) => {
    if (!siloNum) return fallbackId ?? null;
    return dbSiloByNum.get(siloNum)?.id ?? fallbackId ?? null;
  };
  const dbMatByCode = new Map(base.materials.map((m) => [m.code, m]));
  const mapMatId = (matCode: string | null | undefined, fallbackId: number) => {
    if (!matCode) return fallbackId;
    return dbMatByCode.get(matCode)?.id ?? fallbackId;
  };

  for (const prod of base.products) {
    for (const f of prod.factors) {
      f.materialId = mapMatId(f.materialCode, f.materialId);
    }
  }
  for (const r of base.receipts) {
    r.materialId = mapMatId(r.materialCode, r.materialId);
    for (const d of r.distributions) {
      d.siloId = mapSiloId(d.siloNumber, d.siloId) || d.siloId;
    }
  }
  for (const m of base.movements) {
    m.materialId = mapMatId(m.materialCode, m.materialId);
    m.siloId = mapSiloId(m.siloNumber, m.siloId) || m.siloId;
    m.counterpartSiloId = mapSiloId(m.counterpartSiloNumber, m.counterpartSiloId);
  }
  for (const o of base.transferOrders) {
    o.materialId = mapMatId(o.materialCode, o.materialId);
    o.originSiloId = mapSiloId(o.originSiloNumber, o.originSiloId) || o.originSiloId;
    o.destinationSiloId = mapSiloId(o.destinationSiloNumber, o.destinationSiloId) || o.destinationSiloId;
    const matchedRule = base.routes.find(
      (rt) => rt.originSiloNumber === o.originSiloNumber && rt.destinationSiloNumber === o.destinationSiloNumber
    );
    if (matchedRule) o.transferRuleId = matchedRule.id;
  }
  for (const sc of base.schedules) {
    for (const it of sc.items) {
      if (it.materialCode) it.materialId = mapMatId(it.materialCode, it.materialId || 1);
      for (const p of it.projections) {
        const oldMat = BASE_MATERIALS.find((bm) => bm.id === p.materialId);
        if (oldMat) p.materialId = mapMatId(oldMat.code, p.materialId || 1);
      }
    }
  }
  for (const row of base.supplyBoard.boardRows) {
    if (row.materialCode) row.materialId = mapMatId(row.materialCode, row.materialId || 1);
    row.suggestedOriginSiloId = mapSiloId(row.suggestedOriginSiloNumber, row.suggestedOriginSiloId);
    row.suggestedDestinationSiloId = mapSiloId(row.suggestedDestinationSiloNumber, row.suggestedDestinationSiloId);
    for (const fs of row.feedingSilos) {
      fs.siloId = mapSiloId(fs.siloNumber, fs.siloId) || fs.siloId;
    }
  }
  for (const rec of base.supplyBoard.recommendations) {
    if (rec.materialCode) rec.materialId = mapMatId(rec.materialCode, rec.materialId || 1);
    rec.originSiloId = mapSiloId(rec.originSiloNumber, rec.originSiloId);
    rec.destinationSiloId = mapSiloId(rec.destinationSiloNumber, rec.destinationSiloId);
  }
  for (const im of base.intelligenceSummary.byMaterial) {
    im.materialId = mapMatId(im.materialCode, im.materialId);
  }
  for (const ir of base.intelligenceSummary.recommendations) {
    if (ir.materialCode) ir.materialId = mapMatId(ir.materialCode, ir.materialId || 1);
    ir.originSiloId = mapSiloId(ir.originSiloNumber, ir.originSiloId);
    ir.targetSiloId = mapSiloId(ir.targetSiloNumber, ir.targetSiloId);
  }
  for (const occ of base.occurrences) {
    occ.siloId = mapSiloId(occ.siloNumber, occ.siloId);
    if (occ.materialCode) occ.materialId = mapMatId(occ.materialCode, occ.materialId || 1);
  }

  recomputeDemoDerivedState(base);
  if (base.handovers[0]) {
    base.handovers[0].autoSummary = buildDemoAutoSummary(base, 'TURNO_1', base.session.shift.operationalDate);
  }
  return base;
}

function getDemoOriginLabel(state: DemoSandboxState): string {
  return state.viewMode === 'BANCO_AO_VIVO'
    ? 'ESPELHO SOMENTE LEITURA DO POSTGRESQL OFICIAL (SEM ALTERAÇÃO NO SERVIDOR)'
    : 'CENÁRIO DEMONSTRATIVO SOBRE CATÁLOGO REAL POSTGRESQL (SANDBOX ISOLADO)';
}

export function buildDemoDashboard(state: DemoSandboxState): DashboardResponse {
  const silos = state.silos;
  const totalConfirmedStockKg = silos.reduce((a, s) => a + s.confirmedStockKg, 0);
  const totalNominalCapacityKg = silos.reduce((a, s) => a + s.nominalCapacityKg, 0);
  const totalSafeCapacityKg = silos.reduce((a, s) => a + s.safeCapacityKg, 0);
  const occupiedSilos = silos.filter((s) => s.confirmedStockKg > 0).length;
  const operationalSilos = silos.filter((s) => s.operationalStatus === 'OPERACIONAL').length;
  const blockedOrMaintenance = silos.length - operationalSilos;
  const availableSilos = silos.filter((s) => s.operationalStatus === 'OPERACIONAL' && s.availableSpaceKg > 0).length;
  const nearCapacitySilos = silos.filter((s) => s.occupancyPercent >= 85).length;

  const lineGroups = state.lines.map((line) => {
    const group = silos.filter((s) => s.lineCode === line.code);
    return {
      code: line.code,
      name: line.name,
      category: line.category,
      siloCount: group.length,
      nominalCapacityKg: group.reduce((a, s) => a + s.nominalCapacityKg, 0),
      safeCapacityKg: group.reduce((a, s) => a + s.safeCapacityKg, 0),
      confirmedStockKg: group.reduce((a, s) => a + s.confirmedStockKg, 0),
      pendingValidationCount: group.filter((s) => s.validationStatus === 'PENDENTE_VALIDACAO').length,
    };
  });

  return {
    shift: state.session.shift,
    lastUpdated: state.bootstrapSyncedAtIso || new Date().toISOString(),
    kpis: {
      totalSilos: silos.length,
      operationalSilos,
      blockedOrMaintenance,
      occupiedSilos,
      availableSilos,
      nearCapacitySilos,
      totalConfirmedStockKg,
      totalNominalCapacityKg,
      totalSafeCapacityKg,
      totalMaterials: state.materials.length,
      activeTransferRules: state.transferRules.filter((r) => r.isActive).length,
      pendingTransferRules: state.transferRules.filter((r) => !r.isActive).length,
      pendingValidationsCount: state.pendencies.filter((p) => p.status === 'PENDENTE').length,
      pendingSilosCount: silos.filter((s) => s.validationStatus === 'PENDENTE_VALIDACAO').length,
    },
    byCategory: {
      LINHA: silos.filter((s) => s.category === 'LINHA').length,
      ARMAZENAGEM: silos.filter((s) => s.category === 'ARMAZENAGEM').length,
      PRODUCAO: silos.filter((s) => s.category === 'PRODUCAO').length,
    },
    byLine: lineGroups,
    pendenciesPreview: state.pendencies.filter((p) => p.status === 'PENDENTE').slice(0, 5),
  };
}

function resolveDemoReportBounds(
  state: DemoSandboxState,
  filters?: ReportFilterParams,
  includeTomorrowInMultiDay = false
) {
  const today = state.session.shift.operationalDate;
  const yesterday = addDaysToYmd(today, -1);
  const tomorrow = addDaysToYmd(today, 1);
  const preset = filters?.preset;

  if (!preset) {
    return {
      today,
      yesterday,
      tomorrow,
      startDate: yesterday,
      endDate: today,
      isDefaultUnfiltered: true,
    };
  }

  let startDate = yesterday;
  let endDate = includeTomorrowInMultiDay ? tomorrow : today;

  if (preset === 'HOJE') {
    startDate = today;
    endDate = today;
  } else if (preset === 'ONTEM') {
    startDate = yesterday;
    endDate = yesterday;
  } else if (preset === 'ULTIMOS_7_DIAS') {
    startDate = addDaysToYmd(today, -6);
    endDate = includeTomorrowInMultiDay ? tomorrow : today;
  } else if (preset === 'ULTIMOS_30_DIAS') {
    startDate = addDaysToYmd(today, -29);
    endDate = includeTomorrowInMultiDay ? tomorrow : today;
  } else if (preset === 'MES_ATUAL') {
    startDate = `${today.slice(0, 8)}01`;
    endDate = includeTomorrowInMultiDay ? tomorrow : today;
  } else if (preset === 'PERSONALIZADO') {
    startDate = filters?.startDate || yesterday;
    endDate = filters?.endDate || (includeTomorrowInMultiDay ? tomorrow : today);
  }

  return {
    today,
    yesterday,
    tomorrow,
    startDate,
    endDate,
    isDefaultUnfiltered: false,
  };
}

export function buildDemoReportsOverview(
  state: DemoSandboxState,
  filters?: ReportFilterParams
): OperationalIndicatorsOverview {
  const bounds = resolveDemoReportBounds(state, filters, false);
  const nowIso = state.bootstrapSyncedAtIso || new Date().toISOString();

  const filteredSilos = state.silos.filter((s) => {
    if (filters?.siloId && s.id !== filters.siloId) return false;
    if (filters?.materialId && s.primaryMaterialId !== filters.materialId) return false;
    if (filters?.lineCode && s.lineCode !== filters.lineCode) return false;
    return true;
  });

  const filteredReceipts = state.receipts.filter((r) => {
    if (r.operationalDate < bounds.startDate || r.operationalDate > bounds.endDate) return false;
    if (filters?.shiftCode && r.shiftCode !== filters.shiftCode) return false;
    if (filters?.materialId && r.materialId !== filters.materialId) return false;
    if (filters?.siloId && !r.distributions.some((d) => d.siloId === filters.siloId)) return false;
    return true;
  });

  const filteredTransfers = state.transferOrders.filter((t) => {
    if (t.operationalDate < bounds.startDate || t.operationalDate > bounds.endDate) return false;
    if (filters?.shiftCode && t.shiftCode !== filters.shiftCode) return false;
    if (filters?.materialId && t.materialId !== filters.materialId) return false;
    if (filters?.lineCode && t.lineCode !== filters.lineCode) return false;
    if (filters?.siloId && t.originSiloId !== filters.siloId && t.destinationSiloId !== filters.siloId) return false;
    return true;
  });

  const filteredOccurrences = state.occurrences.filter((o) => {
    if (o.operationalDate < bounds.startDate || o.operationalDate > bounds.endDate) return false;
    if (filters?.shiftCode && o.shiftCode !== filters.shiftCode) return false;
    if (filters?.materialId && o.materialId !== filters.materialId) return false;
    if (filters?.lineCode && o.lineCode !== filters.lineCode) return false;
    if (filters?.siloId && o.siloId !== filters.siloId) return false;
    return true;
  });

  const totalStock = filteredSilos.reduce((a, s) => a + s.confirmedStockKg, 0);
  const completedReceipts = filteredReceipts.filter((r) => r.status === 'CONCLUIDO').length;
  const receivedVol = filteredReceipts.reduce((a, r) => a + r.receivedQuantityKg, 0);
  const distributedVol = filteredReceipts.reduce((a, r) => a + r.distributedQuantityKg, 0);
  const completedTransfers = filteredTransfers.filter((t) => t.status === 'CONCLUIDA').length;
  const transferredVol = filteredTransfers.reduce((a, t) => a + t.transferredQuantityKg, 0);
  const partialCount = filteredReceipts.filter((r) => r.status === 'PARCIAL' || r.status === 'PENDENTE').length;
  const openOcc = filteredOccurrences.filter((o) => o.status !== 'ENCERRADA').length;

  const consumptionSlice = buildDemoConsumptionReport(state, filters);
  const hasScopedFilter = Boolean(
    filters?.preset || filters?.shiftCode || filters?.materialId || filters?.lineCode || filters?.siloId
  );
  const plannedKg = hasScopedFilter
    ? consumptionSlice.totals.plannedConsumptionKg
    : state.intelligenceSummary.totals.plannedConsumptionTodayKg;
  const realizedKg = hasScopedFilter
    ? (consumptionSlice.totals.realizedConsumptionKg ?? 0)
    : state.intelligenceSummary.totals.realizedConsumptionKg;

  let avgReceiptDurationMinutes: number | null = null;
  if (completedReceipts > 0) {
    const durations = filteredReceipts
      .filter((r) => r.status === 'CONCLUIDO' && r.startedAt && r.finishedAt)
      .map((r) => Math.max(1, (new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime()) / 60000));
    if (durations.length > 0) {
      avgReceiptDurationMinutes = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
    }
  }

  return {
    periodLabel:
      state.viewMode === 'BANCO_AO_VIVO'
        ? 'Espelho Ao Vivo do PostgreSQL Oficial'
        : 'Cenário Operacional sobre Catálogo Real',
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    generatedAtIso: nowIso,
    dataOrigin: getDemoOriginLabel(state),
    indicators: {
      totalConfirmedStockKg: totalStock,
      registeredMaterialsCount: state.materials.length,
      occupiedSilosCount: filteredSilos.filter((s) => s.confirmedStockKg > 0).length,
      availableSilosCount: filteredSilos.filter((s) => s.operationalStatus === 'OPERACIONAL').length,
      totalSilosCount: filteredSilos.length,
      completedReceiptsCount: completedReceipts,
      receivedVolumeKg: receivedVol,
      transfersCompletedCount: completedTransfers,
      transferredVolumeKg: transferredVol,
      pendingPartialDischargesCount: partialCount,
      pendingSupplyRequestsCount: state.supplyBoard.intakeRequests.filter((i) => i.status === 'ABERTA').length,
      activeAlertsCount: state.intelligenceSummary.alerts.length,
      openOccurrencesCount: openOcc,
      importedSchedulesCount: state.schedules.length,
      atRiskMaterialsCount: state.intelligenceSummary.totals.criticalMaterialsCount,
    },
    performanceKpis: {
      periodStart: bounds.startDate,
      periodEnd: bounds.endDate,
      receivedVolumeKg: receivedVol,
      distributedVolumeKg: distributedVol,
      transferredVolumeKg: transferredVol,
      receiptsCount: filteredReceipts.length,
      completedReceiptsCount: completedReceipts,
      partialDischargesCount: partialCount,
      occurrencesCount: filteredOccurrences.length,
      openOccurrencesCount: openOcc,
      avgReceiptDurationMinutes,
      avgReceiptDurationSampleSize: completedReceipts,
      avgReceiptDurationNote:
        completedReceipts > 0
          ? `Calculado sobre ${completedReceipts} recebimento(s) concluído(s).`
          : 'Aguardando recebimentos concluídos para cálculo de duração média.',
      divergencesFrequency: state.pendencies.filter((p) => p.status === 'PENDENTE').length,
      shortageAlertsFrequency: state.supplyBoard.summary.redCount,
      plannedConsumptionKg: plannedKg,
      realizedConsumptionKg: realizedKg,
      consumptionVarianceKg: realizedKg - plannedKg,
      realizedSampleCount: consumptionSlice.totals.realizedRowsCount,
      consumptionComparisonNote:
        state.viewMode === 'BANCO_AO_VIVO'
          ? 'Leitura direta das movimentações e programações reais do PostgreSQL.'
          : '[CENÁRIO DEMO] Comparação dinâmica sobre a programação demonstrativa.',
      historicalBaselineNotice:
        state.viewMode === 'BANCO_AO_VIVO'
          ? 'Dados reais ao vivo do PostgreSQL (sem projeções inventadas).'
          : 'Modo Apresentação: catálogo/capacidades/regras reais do PostgreSQL com saldos e movimentações demonstrativos.',
      dataOrigin: getDemoOriginLabel(state),
    },
    futureTargets: state.performanceTargets,
    recentSnapshots: state.recentSnapshots,
  };
}

export function buildDemoReceivingReport(
  state: DemoSandboxState,
  filters?: ReportFilterParams
): ReceivingReportResponse {
  const bounds = resolveDemoReportBounds(state, filters, false);

  const filtered = state.receipts.filter((r) => {
    if (r.operationalDate < bounds.startDate || r.operationalDate > bounds.endDate) return false;
    if (filters?.shiftCode && r.shiftCode !== filters.shiftCode) return false;
    if (filters?.materialId && r.materialId !== filters.materialId) return false;
    if (filters?.siloId && !r.distributions.some((d) => d.siloId === filters.siloId)) return false;
    if (filters?.supplierName && !r.supplierName.toLowerCase().includes(filters.supplierName.toLowerCase())) return false;
    if (filters?.lotCode && !r.lotCode.toUpperCase().includes(filters.lotCode.toUpperCase())) return false;
    if (filters?.onlyPartial && r.status !== 'PARCIAL') return false;
    if (filters?.onlyPending && r.status !== 'PENDENTE' && r.status !== 'PARCIAL') return false;
    if (filters?.status && r.status !== filters.status) return false;
    return true;
  });

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    dataOrigin: getDemoOriginLabel(state),
    totals: {
      count: filtered.length,
      receivedKg: filtered.reduce((a, r) => a + r.receivedQuantityKg, 0),
      distributedKg: filtered.reduce((a, r) => a + r.distributedQuantityKg, 0),
      pendingKg: filtered.reduce((a, r) => a + r.remainingQuantityKg, 0),
      partialCount: filtered.filter((r) => r.status === 'PARCIAL').length,
      pendingCount: filtered.filter((r) => r.status === 'PENDENTE').length,
      completedCount: filtered.filter((r) => r.status === 'CONCLUIDO').length,
    },
    rows: filtered.map((r) => {
      const durMin =
        r.startedAt && r.finishedAt
          ? Math.max(1, Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 60000))
          : null;
      return {
        id: r.id,
        receiptNumber: r.receiptNumber,
        entryDate: r.entryDate,
        operationalDate: r.operationalDate,
        shiftCode: r.shiftCode,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        durationMinutes: durMin,
        supplierName: r.supplierName,
        invoiceNumber: r.invoiceNumber,
        materialId: r.materialId,
        materialCode: r.materialCode,
        materialDescription: r.materialDescription,
        lotCode: r.lotCode,
        receivingType: r.receivingType,
        receivedQuantityKg: r.receivedQuantityKg,
        distributedQuantityKg: r.distributedQuantityKg,
        pendingQuantityKg: r.remainingQuantityKg,
        unit: r.unit,
        bagCount: r.bagCount,
        bagUnitWeightKg: r.bagUnitWeightKg,
        destinationSilosText: r.distributions.map((d) => `Silo ${d.siloNumber}`).join(', ') || 'Pendente',
        operatorName: r.operatorName,
        status: r.status,
        notes: r.notes,
      };
    }),
  };
}

export function buildDemoStockReport(
  state: DemoSandboxState,
  filters?: ReportFilterParams
): StockAndHistoricalReportResponse {
  const bounds = resolveDemoReportBounds(state, filters, false);
  const historicalTargetDate = filters?.historicalDate || bounds.yesterday;
  const cutoffMode = filters?.cutoffMode || 'OPERATIONAL_DATE';

  const filteredSilos = state.silos.filter((s) => {
    if (filters?.siloId && s.id !== filters.siloId) return false;
    if (filters?.materialId && s.primaryMaterialId !== filters.materialId) return false;
    if (filters?.lineCode && s.lineCode !== filters.lineCode) return false;
    return true;
  });

  const totalConfirmedStockKg = filteredSilos.reduce((a, s) => a + s.confirmedStockKg, 0);
  const totalSafeCapacityKg = filteredSilos.reduce((a, s) => a + s.safeCapacityKg, 0);

  const allConfirmedMovs = state.movements.filter((m) => m.status === 'CONFIRMADO');
  const confirmedPeriodMovs = allConfirmedMovs.filter((m) => {
    if (m.operationalDate < bounds.startDate || m.operationalDate > bounds.endDate) return false;
    if (filters?.shiftCode && m.shiftCode !== filters.shiftCode) return false;
    if (filters?.materialId && m.materialId !== filters.materialId) return false;
    if (filters?.siloId && m.siloId !== filters.siloId) return false;
    if (filters?.lotCode && !(m.lotCode || '').toUpperCase().includes(filters.lotCode.toUpperCase())) return false;
    return true;
  });

  const inboundPeriodKg = confirmedPeriodMovs
    .filter((m) => m.movementType === 'RECEBIMENTO' && m.direction === 'CREDIT')
    .reduce((a, m) => a + m.quantityKg, 0);
  const outboundPeriodKg = confirmedPeriodMovs
    .filter((m) => m.movementType === 'CONSUMO_PRODUCAO' && m.direction === 'DEBIT')
    .reduce((a, m) => a + m.quantityKg, 0);
  const transfersPeriodKg = confirmedPeriodMovs
    .filter((m) => m.movementType === 'TRANSFERENCIA_ENTRADA' && m.direction === 'CREDIT')
    .reduce((a, m) => a + m.quantityKg, 0);
  const adjustmentsPeriodKg = confirmedPeriodMovs
    .filter((m) => m.movementType === 'AJUSTE_AUTORIZADO')
    .reduce((a, m) => a + (m.direction === 'CREDIT' ? m.quantityKg : -m.quantityKg), 0);

  const historicalMovs = allConfirmedMovs.filter((m) => {
    if (m.operationalDate > historicalTargetDate) return false;
    if (filters?.siloId && m.siloId !== filters.siloId) return false;
    if (filters?.materialId && m.materialId !== filters.materialId) return false;
    if (filters?.lotCode && !(m.lotCode || '').toUpperCase().includes(filters.lotCode.toUpperCase())) return false;
    return true;
  });

  const historicalBySilo = new Map<
    number,
    { silo: SiloDetail; balanceKg: number; lotCode: string | null; count: number; lastAt: string }
  >();
  for (const m of historicalMovs) {
    if (!m.siloId) continue;
    const silo = filteredSilos.find((s) => s.id === m.siloId);
    if (!silo) continue;
    const prev = historicalBySilo.get(m.siloId) || {
      silo,
      balanceKg: 0,
      lotCode: m.lotCode,
      count: 0,
      lastAt: m.createdAt,
    };
    prev.balanceKg += m.direction === 'CREDIT' ? m.quantityKg : -m.quantityKg;
    prev.count += 1;
    if (m.createdAt > prev.lastAt) prev.lastAt = m.createdAt;
    historicalBySilo.set(m.siloId, prev);
  }

  const historicalRows = Array.from(historicalBySilo.values())
    .filter((h) => h.balanceKg > 0)
    .map((h) => ({
      siloId: h.silo.id,
      siloNumber: h.silo.siloNumber,
      lineCode: h.silo.lineCode,
      category: h.silo.category,
      materialId: h.silo.primaryMaterialId ?? 0,
      materialCode: h.silo.materialCode || '',
      materialDescription: h.silo.materialDescription || '',
      lotCode: h.lotCode || 'SEM_LOTE',
      historicalBalanceKg: h.balanceKg,
      movementCountUpToDate: h.count,
      lastMovementUpToDate: h.lastAt,
    }));

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    historicalTargetDate,
    cutoffMode,
    dataOrigin: getDemoOriginLabel(state),
    currentTotals: {
      totalConfirmedStockKg,
      totalSafeCapacityKg,
      totalFreeSpaceKg: Math.max(0, totalSafeCapacityKg - totalConfirmedStockKg),
      inboundPeriodKg,
      outboundPeriodKg,
      transfersPeriodKg,
      adjustmentsPeriodKg,
    },
    currentRows: filteredSilos.map((s) => {
      const siloMovs = confirmedPeriodMovs.filter((m) => m.siloId === s.id);
      const lotsSet = Array.from(new Set(siloMovs.map((m) => m.lotCode).filter(Boolean)));
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
        activeLotsText:
          lotsSet.length > 0
            ? lotsSet.join(', ')
            : s.confirmedStockKg > 0
              ? `LOTE-DEMO-${s.siloNumber}`
              : 'Sem saldo',
        confirmedStockKg: s.confirmedStockKg,
        nominalCapacityKg: s.nominalCapacityKg,
        safeCapacityKg: s.safeCapacityKg,
        occupancyPercent: s.occupancyPercent,
        availableSpaceKg: s.availableSpaceKg,
        lastMovementAt: s.lastMovementAt,
        lastValidationOrAuditAt: s.updatedAt,
        inboundPeriodKg: siloMovs
          .filter((m) => m.movementType === 'RECEBIMENTO' && m.direction === 'CREDIT')
          .reduce((a, m) => a + m.quantityKg, 0),
        outboundPeriodKg: siloMovs
          .filter((m) => m.movementType === 'CONSUMO_PRODUCAO' && m.direction === 'DEBIT')
          .reduce((a, m) => a + m.quantityKg, 0),
        transfersInPeriodKg: siloMovs
          .filter((m) => m.movementType === 'TRANSFERENCIA_ENTRADA' && m.direction === 'CREDIT')
          .reduce((a, m) => a + m.quantityKg, 0),
        transfersOutPeriodKg: siloMovs
          .filter((m) => m.movementType === 'TRANSFERENCIA_SAIDA' && m.direction === 'DEBIT')
          .reduce((a, m) => a + m.quantityKg, 0),
        adjustmentsPeriodKg: siloMovs
          .filter((m) => m.movementType === 'AJUSTE_AUTORIZADO')
          .reduce((a, m) => a + (m.direction === 'CREDIT' ? m.quantityKg : -m.quantityKg), 0),
        operationalStatus: s.operationalStatus,
      };
    }),
    historicalTotals: {
      targetDate: historicalTargetDate,
      totalHistoricalBalanceKg: historicalRows.reduce((a, r) => a + r.historicalBalanceKg, 0),
      movementsEvaluatedCount: historicalMovs.length,
      note:
        historicalMovs.length > 0
          ? `Reconstrução histórica até ${formatBrDate(historicalTargetDate)} com ${historicalMovs.length} movimentação(ões) avaliada(s).`
          : `Sem movimentações registradas até ${formatBrDate(historicalTargetDate)}.`,
    },
    historicalRows,
  };
}

export function buildDemoTransfersReport(
  state: DemoSandboxState,
  filters?: ReportFilterParams
): TransfersReportResponse {
  const bounds = resolveDemoReportBounds(state, filters, false);

  const filtered = state.transferOrders.filter((t) => {
    if (t.operationalDate < bounds.startDate || t.operationalDate > bounds.endDate) return false;
    if (filters?.shiftCode && t.shiftCode !== filters.shiftCode) return false;
    if (filters?.materialId && t.materialId !== filters.materialId) return false;
    if (filters?.siloId && t.originSiloId !== filters.siloId && t.destinationSiloId !== filters.siloId) return false;
    if (filters?.lineCode && t.lineCode !== filters.lineCode) return false;
    if (filters?.status && t.status !== filters.status) return false;
    return true;
  });

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    dataOrigin: getDemoOriginLabel(state),
    totals: {
      count: filtered.length,
      plannedKg: filtered.reduce((a, t) => a + t.plannedQuantityKg, 0),
      transferredKg: filtered.reduce((a, t) => a + t.transferredQuantityKg, 0),
      pendingKg: filtered.reduce((a, t) => a + t.remainingQuantityKg, 0),
      completedCount: filtered.filter((t) => t.status === 'CONCLUIDA').length,
      partialCount: filtered.filter((t) => t.status === 'PARCIAL').length,
      interruptedCount: filtered.filter((t) => t.status === 'INTERROMPIDA').length,
      openCount: filtered.filter((t) => t.status === 'PLANEJADA' || t.status === 'EM_ANDAMENTO').length,
      canceledCount: filtered.filter((t) => t.status === 'CANCELADA').length,
    },
    rows: filtered.map((t) => {
      const rule = state.routes.find((r) => r.id === t.transferRuleId);
      return {
        id: t.id,
        orderCode: t.orderCode,
        operationalDate: t.operationalDate,
        shiftCode: t.shiftCode,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        createdAt: t.createdAt,
        materialCode: t.materialCode,
        materialDescription: t.materialDescription,
        lotCode: t.lotCode,
        originSiloNumber: t.originSiloNumber,
        destinationSiloNumber: t.destinationSiloNumber,
        lineCode: t.lineCode,
        plannedQuantityKg: t.plannedQuantityKg,
        transferredQuantityKg: t.transferredQuantityKg,
        pendingQuantityKg: t.remainingQuantityKg,
        operatorName: t.assignedOperatorName || 'Não atribuído',
        requestedByName: t.requestedByName,
        status: t.status,
        priority: t.priority,
        routeStatus: rule?.authorizationStatus || 'PENDENTE_VALIDACAO',
        interruptionReason: t.interruptionReason,
        notes: t.notes,
      };
    }),
  };
}

export function buildDemoConsumptionReport(
  state: DemoSandboxState,
  filters?: ReportFilterParams
): ConsumptionReportResponse {
  const bounds = resolveDemoReportBounds(state, filters, true);
  const startDate = bounds.isDefaultUnfiltered ? bounds.today : bounds.startDate;
  const endDate = bounds.isDefaultUnfiltered ? bounds.today : bounds.endDate;

  let rows = state.schedules
    .filter((sched) => sched.status === 'APROVADA')
    .filter((sched) => sched.referenceDate >= startDate && sched.referenceDate <= endDate)
    .flatMap((sched) =>
      sched.items.flatMap((it) =>
        it.projections.map((p) => {
          const realStockKg = state.silos
            .filter((s) => s.primaryMaterialId === p.materialId)
            .reduce((a, s) => a + s.confirmedStockKg, 0);
          const remainingNeedKg = Math.max(0, p.calculatedConsumptionKg - p.realizedConsumptionKg);
          const hasRealizedRecord = p.realizedConsumptionKg > 0 || it.realizedQuantity > 0;
          return {
            projectionId: p.id,
            scheduleCode: sched.scheduleCode,
            revisionNumber: sched.revisionNumber,
            referenceDate: sched.referenceDate,
            lineCode: it.lineCode,
            productCode: it.productCode,
            productDescription: it.productDescription,
            materialId: p.materialId,
            materialCode: state.materials.find((m) => m.id === p.materialId)?.code || null,
            materialDescription: state.materials.find((m) => m.id === p.materialId)?.description || null,
            plannedConsumptionKg: p.calculatedConsumptionKg,
            realizedConsumptionKg: p.realizedConsumptionKg > 0 ? p.realizedConsumptionKg : null,
            hasRealizedRecord,
            varianceKg: p.realizedConsumptionKg > 0 ? p.realizedConsumptionKg - p.calculatedConsumptionKg : null,
            realStockKg,
            projectedBalanceKg: realStockKg - remainingNeedKg,
            calculationStatus: p.calculationStatus,
            executionStatus: it.executionStatus,
            originSource: p.originSource,
          };
        })
      )
    );

  if (filters?.lineCode) {
    rows = rows.filter((r) => r.lineCode === filters.lineCode);
  }
  if (filters?.materialId) {
    rows = rows.filter((r) => r.materialId === filters.materialId);
  }
  if (filters?.status) {
    rows = rows.filter((r) => r.executionStatus === filters.status);
  }
  if (filters?.onlyPendingComparison) {
    rows = rows.filter((r) => !r.hasRealizedRecord || r.calculationStatus === 'PENDENTE_FATOR');
  }

  return {
    periodStart: startDate,
    periodEnd: endDate,
    dataOrigin: getDemoOriginLabel(state),
    totals: {
      plannedConsumptionKg: rows.reduce((a, r) => a + r.plannedConsumptionKg, 0),
      realizedConsumptionKg: rows.reduce((a, r) => a + (r.realizedConsumptionKg || 0), 0),
      varianceKg: rows.reduce((a, r) => a + ((r.realizedConsumptionKg || 0) - r.plannedConsumptionKg), 0),
      pendingFactorCount: rows.filter((r) => r.calculationStatus === 'PENDENTE_FATOR').length,
      rowsCount: rows.length,
      realizedRowsCount: rows.filter((r) => r.hasRealizedRecord).length,
    },
    rows,
  };
}

export function buildDemoSiloLedger(state: DemoSandboxState, siloId: number): SiloLedgerDetails {
  const silo = state.silos.find((s) => s.id === siloId);
  const siloMovs = state.movements.filter((m) => m.siloId === siloId);

  const lotTotals = new Map<string, number>();
  for (const m of siloMovs) {
    if (m.status !== 'CONFIRMADO') continue;
    const lc = m.lotCode || 'SEM_LOTE';
    lotTotals.set(lc, (lotTotals.get(lc) || 0) + (m.direction === 'CREDIT' ? m.quantityKg : -m.quantityKg));
  }
  const activeLots = Array.from(lotTotals.entries())
    .filter(([, netKg]) => netKg > 0)
    .map(([lotCode, netKg]) => ({
      lotCode,
      materialCode: silo?.materialCode || '—',
      materialDescription: silo?.materialDescription || 'Material',
      netKg,
    }));

  if (activeLots.length === 0 && silo && silo.confirmedStockKg > 0) {
    activeLots.push({
      lotCode: `LOTE-DEMO-${silo.siloNumber}`,
      materialCode: silo.materialCode || '—',
      materialDescription: silo.materialDescription || 'Material',
      netKg: silo.confirmedStockKg,
    });
  }

  return {
    activeLots,
    movements: siloMovs.map((m) => ({
      id: m.id,
      movementType: m.movementType,
      siloId: m.siloId,
      materialCode: m.materialCode,
      materialDescription: m.materialDescription,
      lotCode: m.lotCode,
      quantityKg: m.quantityKg,
      direction: m.direction,
      referenceDocument: m.referenceDocument,
      supplierName: m.supplierName,
      status: m.status,
      reason: m.reason,
      shiftCode: m.shiftCode,
      operationalDate: m.operationalDate,
      operatorName: m.operatorName,
      createdAt: m.createdAt,
    })),
  };
}

export function buildDemo30DayConsumptionTrend(
  state: DemoSandboxState,
  filters?: { days?: number; lineCode?: string; materialId?: number | null }
): ConsumptionTrendResponse {
  const days = Math.min(90, Math.max(7, filters?.days || 30));
  const endDate = state.session.shift.operationalDate || formatDateLocal(new Date());
  const startDate = addDaysToYmd(endDate, -(days - 1));
  const lineFilter = filters?.lineCode && filters.lineCode !== 'ALL' ? filters.lineCode : 'ALL';
  const matFilter = filters?.materialId ?? null;

  // Materiais principais representados na série demonstrativa de 30 dias
  const trackedCodes = [
    { code: '1211101012', baseTons: 62 },
    { code: '2017101021', baseTons: 48 },
    { code: '2021171023', baseTons: 22 },
    { code: '1614161040', baseTons: 28 },
    { code: '1613131012', baseTons: 24 },
    { code: '2019101141', baseTons: 18 },
    { code: '2019131030', baseTons: 12 },
    { code: '2090121061', baseTons: 14 },
    { code: '1113101920', baseTons: 9 },
  ];

  const lineWeightMap: Record<string, number> = {
    L1: 0.21,
    L2: 0.17,
    L3: 0.12,
    L4: 0.22,
    L5: 0.1,
    L6: 0.11,
    L7: 0.07,
  };
  const lineMult = lineFilter === 'ALL' ? 1 : lineWeightMap[lineFilter] ?? 0.14;

  const trackedMaterials = trackedCodes
    .map((tc) => {
      const mat = state.materials.find((m) => m.code === tc.code);
      return mat ? { ...tc, mat } : null;
    })
    .filter((x): x is { code: string; baseTons: number; mat: MaterialItem } => x !== null);

  const matTotals = new Map<number, { plannedTons: number; realizedTons: number }>();
  const series = [];
  let totalPlannedTons = 0;
  let totalRealizedTons = 0;
  let peakDayLabel: string | null = null;
  let peakPlannedTons = 0;

  for (let i = 0; i < days; i++) {
    const date = addDaysToYmd(startDate, i);
    const [, m, d] = date.split('-');
    const dateLabel = `${d}/${m}`;
    const dtObj = new Date(`${date}T12:00:00Z`);
    const dayOfWeek = dtObj.getUTCDay();
    const weekendFactor = dayOfWeek === 0 ? 0.58 : dayOfWeek === 6 ? 0.78 : 1;
    const wave = 1 + Math.sin(i * 0.45) * 0.12 + Math.cos(i * 0.22) * 0.06;

    let dayPlannedTons = 0;
    let dayRealizedTons = 0;

    for (const tm of trackedMaterials) {
      const matPlanned = round2(tm.baseTons * lineMult * weekendFactor * wave);
      const adherenceNoise = 0.94 + ((i * 7 + tm.mat.id) % 13) * 0.01;
      const matRealized = i === days - 1 ? round2(matPlanned * 0.68) : round2(matPlanned * adherenceNoise);

      const prevAgg = matTotals.get(tm.mat.id) || { plannedTons: 0, realizedTons: 0 };
      prevAgg.plannedTons = round2(prevAgg.plannedTons + matPlanned);
      prevAgg.realizedTons = round2(prevAgg.realizedTons + matRealized);
      matTotals.set(tm.mat.id, prevAgg);

      if (!matFilter || matFilter === tm.mat.id) {
        dayPlannedTons = round2(dayPlannedTons + matPlanned);
        dayRealizedTons = round2(dayRealizedTons + matRealized);
      }
    }

    totalPlannedTons = round2(totalPlannedTons + dayPlannedTons);
    totalRealizedTons = round2(totalRealizedTons + dayRealizedTons);
    if (dayPlannedTons > peakPlannedTons) {
      peakPlannedTons = dayPlannedTons;
      peakDayLabel = dateLabel;
    }

    series.push({
      date,
      dateLabel,
      plannedKg: round2(dayPlannedTons * 1000),
      realizedKg: round2(dayRealizedTons * 1000),
      plannedTons: dayPlannedTons,
      realizedTons: dayRealizedTons,
      varianceTons: round3(dayRealizedTons - dayPlannedTons),
    });
  }

  return {
    days,
    startDate,
    endDate,
    lineCode: lineFilter,
    materialId: matFilter,
    dataOrigin:
      state.viewMode === 'BANCO_AO_VIVO'
        ? 'Espelho PostgreSQL Oficial'
        : '[CENÁRIO DEMO] Série histórica simulada de 30 dias para planejamento logístico',
    totals: {
      plannedTons: round2(totalPlannedTons),
      realizedTons: round2(totalRealizedTons),
      adherencePercent:
        totalPlannedTons > 0 ? round2((totalRealizedTons / totalPlannedTons) * 100) : null,
      peakDayLabel,
      peakPlannedTons: round2(peakPlannedTons),
    },
    availableLines: state.lines.map((l) => l.code),
    availableMaterials: trackedMaterials.map((tm) => {
      const agg = matTotals.get(tm.mat.id) || { plannedTons: 0, realizedTons: 0 };
      return {
        materialId: tm.mat.id,
        materialCode: tm.mat.code,
        materialDescription: tm.mat.description,
        totalPlannedTons: agg.plannedTons,
        totalRealizedTons: agg.realizedTons,
      };
    }),
    series,
  };
}

export function buildDemoSiloVolumeHistory24h(
  state: DemoSandboxState,
  filters?: { siloId?: number | null; materialId?: number | null; category?: string }
): SiloVolumeHistory24hResponse {
  let anchorNow = new Date();
  if (state.viewMode === 'CENARIO_REALISTA') {
    let maxConfirmedTs = anchorNow.getTime();
    for (const m of state.movements) {
      if (m.status !== 'CONFIRMADO') continue;
      const ts = new Date(m.createdAt).getTime();
      if (Number.isFinite(ts) && ts > maxConfirmedTs) {
        maxConfirmedTs = ts;
      }
    }
    anchorNow = new Date(maxConfirmedTs);
  }

  return buildSiloVolumeHistory24h({
    silos: state.silos,
    movements: state.movements.map((m) => ({
      siloId: m.siloId || 0,
      materialId: m.materialId,
      quantityKg: m.quantityKg,
      direction: m.direction,
      status: m.status,
      createdAt: m.createdAt,
    })),
    siloId: filters?.siloId ?? null,
    materialId: filters?.materialId ?? null,
    category: filters?.category ?? 'ALL',
    dataOrigin:
      state.viewMode === 'BANCO_AO_VIVO'
        ? 'Espelho PostgreSQL Oficial (Últimas 24h)'
        : '[CENÁRIO DEMO] Livro razão horário das últimas 24 horas',
    anchorNow,
  });
}

export function buildDemoShiftManagerialReport(
  state: DemoSandboxState,
  filters?: ReportFilterParams & {
    operatorName?: string;
    badgeCode?: string;
    workflowStatus?: string;
    search?: string;
  }
): ShiftManagerialReportResponse {
  const bounds = resolveDemoReportBounds(state, filters, false);
  const opFilter = filters?.operatorName?.trim().toLowerCase() || '';
  const badgeFilter = filters?.badgeCode?.trim().toLowerCase() || '';
  const wfFilter = filters?.workflowStatus?.trim().toUpperCase() || '';
  const searchFilter = filters?.search?.trim().toLowerCase() || '';

  const rows: ShiftManagerialReportRow[] = state.handovers
    .filter((h) => h.operationalDate >= bounds.startDate && h.operationalDate <= bounds.endDate)
    .filter((h) => !filters?.shiftCode || h.shiftCode === filters.shiftCode)
    .map((h) => {
      const summary = h.autoSummary || buildDemoAutoSummary(state, h.shiftCode, h.operationalDate);
      const vb = summary.vehicleBreakdown;
      const wf: ShiftWorkflowStatus =
        h.workflowStatus ||
        (h.status === 'FINALIZADA'
          ? 'ENCERRADO'
          : h.status === 'REVISAO'
            ? 'AGUARDANDO_CONFERENCIA'
            : 'EM_ELABORACAO');
      const reportText = h.editedReportText || h.autoReportText;
      const silosUsed = Array.from(new Set(summary.silosFed.map((s) => s.siloNumber)));
      const materialsMoved = Array.from(
        new Set([
          ...summary.materialsReceived.map((m) => m.description),
          ...(vb?.countedByMaterial.map((cm) => cm.formattedMaterialName) || []),
        ])
      );
      return {
        handoverId: h.id,
        handoverCode: h.handoverCode,
        shiftCode: h.shiftCode,
        shiftName: h.shiftName,
        operationalDate: h.operationalDate,
        workflowStatus: wf,
        legacyStatus: h.status,
        handoverByName: h.handoverByName,
        handoverByBadge: h.handoverByBadge ?? null,
        receivedByName: h.receivedByName,
        approvedByName: h.approvedByName ?? null,
        approvedAt: h.approvedAt ?? null,
        unloadedVehiclesCount: vb?.totalCountedVehicles ?? summary.receiptsCount,
        carryoverVehiclesCount: vb?.carryoverFinalizedVehicles.length ?? 0,
        partialVehiclesCount: vb?.pendingOrPartialVehicles.length ?? summary.partialDischargesCount,
        receivedKg: summary.receivedKg,
        distributedKg: summary.distributedKg,
        transferredKg: summary.transfersCompletedKg,
        occurrencesCount: summary.shiftOccurrences?.length ?? summary.openOccurrencesCount,
        openOccurrencesCount: summary.openOccurrencesCount,
        pendenciesCount: h.pendencies?.length ?? 0,
        openPendenciesCount: h.pendencies?.filter((p) => p.status !== 'RESOLVIDA').length ?? 0,
        version: h.version,
        reportText,
        silosUsed,
        materialsMoved,
        updatedAt: h.updatedAt,
      };
    })
    .filter((r) => !opFilter || r.handoverByName.toLowerCase().includes(opFilter))
    .filter((r) => !badgeFilter || (r.handoverByBadge || '').toLowerCase().includes(badgeFilter))
    .filter((r) => !wfFilter || r.workflowStatus === wfFilter)
    .filter(
      (r) =>
        !searchFilter ||
        r.handoverCode.toLowerCase().includes(searchFilter) ||
        r.reportText.toLowerCase().includes(searchFilter) ||
        r.materialsMoved.some((m) => m.toLowerCase().includes(searchFilter))
    );

  return {
    periodStart: bounds.startDate,
    periodEnd: bounds.endDate,
    dataOrigin: getDemoOriginLabel(state),
    totals: {
      shiftsCount: rows.length,
      approvedOrClosedCount: rows.filter(
        (r) => r.workflowStatus === 'APROVADO' || r.workflowStatus === 'ENCERRADO'
      ).length,
      totalUnloadedVehicles: rows.reduce((a, r) => a + r.unloadedVehiclesCount, 0),
      totalCarryoverFinalizedVehicles: rows.reduce((a, r) => a + r.carryoverVehiclesCount, 0),
      totalReceivedKg: rows.reduce((a, r) => a + r.receivedKg, 0),
      totalDistributedKg: rows.reduce((a, r) => a + r.distributedKg, 0),
      totalTransferredKg: rows.reduce((a, r) => a + r.transferredKg, 0),
      totalOccurrences: rows.reduce((a, r) => a + r.occurrencesCount, 0),
      totalOpenPendencies: rows.reduce((a, r) => a + r.openPendenciesCount, 0),
    },
    rows,
  };
}



