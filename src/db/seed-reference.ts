import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  helpArticles,
  materialBagConfigs,
  materials,
  operationalPriorityConfigs,
  permissions,
  productionLines,
  rolePermissions,
  roles,
  scheduleDocumentTemplates,
  shifts,
  siloMaterialCompatibility,
  siloTransferRules,
  silos,
  suppliers,
  systemSettings,
  validationPendencies,
} from './schema.ts';
import { ROLE_LABELS, ROLE_PERMISSIONS, type RoleCode } from '../lib/rbac.ts';
import { buildAutoHelpArticles } from '../lib/manual-registry.ts';

let seedPromise: Promise<void> | null = null;

interface MaterialSeed {
  code: string;
  description: string;
  category: string;
  handlingType: string;
  referenceBagWeightKg: string | null;
  bagWeightValidationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO' | 'NAO_APLICAVEL';
  isCritical: boolean;
  notes: string | null;
}

const MATERIALS_SEED: MaterialSeed[] = [
  {
    code: '2017101021',
    description: 'CALCARIO',
    category: 'MINERAL',
    handlingType: 'GRANEL_E_BAG',
    referenceBagWeightKg: '1000.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Referência anotada: 1.000 kg/bag (pendente validação oficial).',
  },
  {
    code: '2017101250',
    description: 'CALCARIO GRANULADO',
    category: 'MINERAL',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: null,
  },
  {
    code: '2017101157',
    description: 'CALCARIO CALCITICO B.BAG(TMP)',
    category: 'MINERAL',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: '1000.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Referência anotada: 1.000 kg/bag (pendente validação oficial).',
  },
  {
    code: '2017101294',
    description: 'CARBONATO DE CALCIO DE ALGA CA32-BIG BAG',
    category: 'MINERAL',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: '1000.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Referência anotada: 1.000 kg ou 1.300 kg por bag conforme fornecedor/lote.',
  },
  {
    code: '2019101141',
    description: 'FOSFATO BICALCICO GRANULAR 19% (GRANEL)',
    category: 'MINERAL',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: 'Requer destravar trava central do caminhão (produto granulado).',
  },
  {
    code: '2019101142',
    description: 'FOSFATO BICALCICO GRANULAR 19% (BIG BAG)',
    category: 'MINERAL',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: '1500.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Código de bag anotado (41); referência preliminar 1.500 kg/bag.',
  },
  {
    code: '2019131030',
    description: 'FOSFATO MONOBICALCICO 21% (GRANEL)',
    category: 'MINERAL',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: 'Requer destravar trava central do caminhão (produto granulado).',
  },
  {
    code: '2019131031',
    description: 'FOSFATO MONOBICALCICO 21% (BIG BAG)',
    category: 'MINERAL',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: '1500.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Código de bag anotado (30); referência preliminar 1.500 kg/bag.',
  },
  {
    code: '2019131033',
    description: 'FOSFATO MONO 21% GRAN ESPECIAL (BAG)',
    category: 'MINERAL',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: '1500.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: null,
  },
  {
    code: '2090121061',
    description: 'CAULIM',
    category: 'MINERAL',
    handlingType: 'GRANEL_E_BAG',
    referenceBagWeightKg: '1200.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Referência anotada: 1.200 kg/bag (CAULIM BIG BAG).',
  },
  {
    code: '1113101920',
    description: 'VEICULO PREMIX GRANEL E BAG',
    category: 'PREMIX',
    handlingType: 'GRANEL_E_BAG',
    referenceBagWeightKg: '800.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Referência anotada: 800 kg/bag.',
  },
  {
    code: '1113101922',
    description: 'VEICULO PREMIX BIG BAG',
    category: 'PREMIX',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: '800.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Código de bag anotado (20).',
  },
  {
    code: '1614261039',
    description: 'FARELO DE GLUTEN DE MILHO 21% (GRANEL)',
    category: 'PROTEICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: 'Também referenciado como PROMIL (1614261030) na ficha RQ-REC-046.',
  },
  {
    code: '1614261033',
    description: 'FARELO DE GLUTEN DE MILHO 21% (BIG BAG)',
    category: 'PROTEICO',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: '1000.00',
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: 'Código de bag anotado (39); referência preliminar 1.000 kg ou 1.260 kg.',
  },
  {
    code: 'F301030C',
    description: 'MILHO MOIDO RUMINANTES',
    category: 'ENERGETICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: null,
  },
  {
    code: '1211101012',
    description: 'MILHO BC',
    category: 'ENERGETICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: 'Após milho na armazenagem, avaliar procedimento de limpeza com calcário junto à Qualidade.',
  },
  {
    code: '1614161040',
    description: 'FARELO DE ALGODÃO 38% (GRANEL)',
    category: 'PROTEICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: null,
  },
  {
    code: 'F30104A',
    description: 'FARELO DE ALGODAO MOIDO',
    category: 'PROTEICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: null,
  },
  {
    code: '1613131012',
    description: 'GERMEN DE MILHO DESENGORDURADO (NDF >30)',
    category: 'ENERGETICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: null,
  },
  {
    code: 'F30GMOA16CMP',
    description: 'GERMEN DE MILHO DESENGORDURADO (NDF >30) - PROD',
    category: 'ENERGETICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: null,
  },
  {
    code: 'F30BMOA80',
    description: 'MOAGEM B ARROZ QUIRERA',
    category: 'ENERGETICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: null,
  },
  {
    code: '1553241021',
    description: 'FARINHA DE VISCERAS',
    category: 'PROTEICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: true,
    notes: null,
  },
  {
    code: '2021171023',
    description: 'SAL MOIDO PENEIRADO (BIG BAG)',
    category: 'SAL',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: null,
  },
  {
    code: '2021171081',
    description: 'SAL REFINADO GRANULADO',
    category: 'SAL',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: null,
  },
  {
    code: '1620101010',
    description: 'UREIA PECUARIA BIG BAG',
    category: 'PROTEICO',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: true,
    notes: null,
  },
  {
    code: '1619111011',
    description: 'BOLACHA FL (BIG BAG)',
    category: 'ENERGETICO',
    handlingType: 'BIG_BAG',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'PENDENTE_VALIDACAO',
    isCritical: false,
    notes: null,
  },
  {
    code: '1614271130',
    description: 'DDG 30 PB',
    category: 'PROTEICO',
    handlingType: 'GRANEL',
    referenceBagWeightKg: null,
    bagWeightValidationStatus: 'NAO_APLICAVEL',
    isCritical: false,
    notes: null,
  },
];

interface SiloSeed {
  siloNumber: number;
  rubricOrder: number;
  category: 'LINHA' | 'ARMAZENAGEM' | 'PRODUCAO';
  controlOwner: 'MOEGA' | 'PRODUCAO';
  lineCode: string;
  heightMeters: string | null;
  cordaMeters: string;
  nominalCapacityKg: string;
  safeCapacityKg: string;
  materialCode: string;
  isDividedCompartment: boolean;
  validationStatus: 'VALIDADO' | 'PENDENTE_VALIDACAO';
  validationNotes: string | null;
}

// Sequência exata da rubricagem (sem ordenar numericamente e sem inventar silos 27 e 30)
const SILOS_SEED: SiloSeed[] = [
  { siloNumber: 9, rubricOrder: 1, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L5', heightMeters: '7.50', cordaMeters: '3.51', nominalCapacityKg: '14001.00', safeCapacityKg: '12601.00', materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26 indica 14.001 kg; RQ-REC-046 indica 12.000 kg.' },
  { siloNumber: 10, rubricOrder: 2, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L5', heightMeters: '7.50', cordaMeters: '7.71', nominalCapacityKg: '13978.00', safeCapacityKg: '12580.00', materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26 indica 13.978 kg; RQ-REC-046 indica 12.000 kg.' },
  { siloNumber: 11, rubricOrder: 3, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '5.08', nominalCapacityKg: '42241.00', safeCapacityKg: '38016.00', materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 42.241 kg vs RQ-REC-046: 35.000 kg.' },
  { siloNumber: 12, rubricOrder: 4, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '6.20', nominalCapacityKg: '70369.00', safeCapacityKg: '63332.00', materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 70.369 kg vs RQ-REC-046: 53.000 kg.' },
  { siloNumber: 13, rubricOrder: 5, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '8.56', nominalCapacityKg: '49084.00', safeCapacityKg: '44176.00', materialCode: '2019131030', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 49.084 kg vs RQ-REC-046: 35.000 kg.' },
  { siloNumber: 14, rubricOrder: 6, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '7.58', nominalCapacityKg: '23496.00', safeCapacityKg: '21147.00', materialCode: '2090121061', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Compartimento dividido; Planilha 23.496 kg vs RQ-REC-046 18.000 kg.' },
  { siloNumber: 15, rubricOrder: 7, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '3.86', nominalCapacityKg: '10782.00', safeCapacityKg: '9704.00', materialCode: '1113101920', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Divergência de MP: Planilha indica VEICULO PREMIX (1113101920), RQ-REC-046 indica FARELO CASCA DE ARROZ.' },
  { siloNumber: 16, rubricOrder: 8, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '8.39', nominalCapacityKg: '36869.00', safeCapacityKg: '33182.00', materialCode: '2017101157', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Divergência de MP: Planilha indica CALCARIO CALCITICO, RQ-REC-046 indica FARELO ALGODAO 38%.' },
  { siloNumber: 31, rubricOrder: 9, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '2.40', nominalCapacityKg: '9367.00', safeCapacityKg: '8430.00', materialCode: '1614261039', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha indica código 1614261039 (Gluten 21%), RQ-REC-046 indica 1614261030 (Promil).' },
  { siloNumber: 32, rubricOrder: 10, category: 'LINHA', controlOwner: 'PRODUCAO', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '9.36', nominalCapacityKg: '18729.00', safeCapacityKg: '16856.00', materialCode: '2017101294', isDividedCompartment: true, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Controle PRODUÇÃO na planilha 12/11/26; RQ-REC-046 listava Farelo de Soja Hypro.' },
  { siloNumber: 33, rubricOrder: 11, category: 'LINHA', controlOwner: 'PRODUCAO', lineCode: 'L4', heightMeters: '11.50', cordaMeters: '2.69', nominalCapacityKg: '15897.00', safeCapacityKg: '14307.00', materialCode: 'F301030C', isDividedCompartment: true, validationStatus: 'VALIDADO', validationNotes: 'Anotação de campo confirma controle de abastecimento pela Produção.' },
  { siloNumber: 17, rubricOrder: 12, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: '11.50', cordaMeters: '7.97', nominalCapacityKg: '48226.00', safeCapacityKg: '43403.00', materialCode: '2090121061', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 48.226 kg vs RQ-REC-046: 37.000 kg.' },
  { siloNumber: 18, rubricOrder: 13, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: '11.50', cordaMeters: '5.17', nominalCapacityKg: '23983.00', safeCapacityKg: '21585.00', materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Divergência de MP: Planilha indica VEICULO PREMIX, RQ-REC-046 indica FARELO CASCA DE ARROZ.' },
  { siloNumber: 19, rubricOrder: 14, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: '11.50', cordaMeters: '6.28', nominalCapacityKg: '74798.00', safeCapacityKg: '67318.00', materialCode: '2017101157', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Divergência de MP: Planilha indica CALCARIO CALCITICO, RQ-REC-046 indica FOSFATO BICALCICO.' },
  { siloNumber: 20, rubricOrder: 15, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: '11.50', cordaMeters: '10.34', nominalCapacityKg: '49672.00', safeCapacityKg: '44705.00', materialCode: '2019131030', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 49.672 kg vs RQ-REC-046: 35.000 kg.' },
  { siloNumber: 21, rubricOrder: 16, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: '11.50', cordaMeters: '3.12', nominalCapacityKg: '70659.00', safeCapacityKg: '63593.00', materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 70.659 kg vs RQ-REC-046: 55.000 kg.' },
  { siloNumber: 22, rubricOrder: 17, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L3', heightMeters: '11.50', cordaMeters: '9.60', nominalCapacityKg: '38796.00', safeCapacityKg: '34916.00', materialCode: '2017101294', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha 12/11/26: 38.796 kg vs RQ-REC-046: 56.000 kg.' },
  { siloNumber: 23, rubricOrder: 18, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L2', heightMeters: '8.50', cordaMeters: '7.71', nominalCapacityKg: '23492.00', safeCapacityKg: '21143.00', materialCode: 'F30BMOA80', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: MOAGEM B ARROZ QUIRERA (23.492 kg) vs RQ-REC-046: CASCA DE ARROZ (12.000 kg).' },
  { siloNumber: 24, rubricOrder: 19, category: 'LINHA', controlOwner: 'PRODUCAO', lineCode: 'L2', heightMeters: '8.50', cordaMeters: '6.59', nominalCapacityKg: '11744.00', safeCapacityKg: '10569.00', materialCode: '1553241021', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: FARINHA DE VISCERAS (PRODUÇÃO) vs RQ-REC-046: VEICULO PREMIX.' },
  { siloNumber: 25, rubricOrder: 20, category: 'LINHA', controlOwner: 'PRODUCAO', lineCode: 'L1', heightMeters: '8.50', cordaMeters: '5.15', nominalCapacityKg: '14848.00', safeCapacityKg: '13363.00', materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: 'Anotação de campo confirma abastecimento pela Produção.' },
  { siloNumber: 26, rubricOrder: 21, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L1', heightMeters: '8.50', cordaMeters: '5.26', nominalCapacityKg: '27711.00', safeCapacityKg: '24940.00', materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: FOSFATO BICALCICO vs RQ-REC-046: VEICULO PREMIX; anotação menciona Produção.' },
  { siloNumber: 28, rubricOrder: 22, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L6', heightMeters: '4.50', cordaMeters: '3.96', nominalCapacityKg: '5542.00', safeCapacityKg: '4987.00', materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: 5.542 kg vs RQ-REC-046: 7.300 kg.' },
  { siloNumber: 29, rubricOrder: 23, category: 'LINHA', controlOwner: 'MOEGA', lineCode: 'L6', heightMeters: '4.50', cordaMeters: '4.05', nominalCapacityKg: '5542.00', safeCapacityKg: '4987.00', materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: 5.542 kg vs RQ-REC-046: 7.300 kg.' },
  // Armazenagem (Linha 7): 42 -> 34
  { siloNumber: 42, rubricOrder: 24, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '3.51', nominalCapacityKg: '45939.00', safeCapacityKg: '41345.00', materialCode: '1211101012', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 41, rubricOrder: 25, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '5.16', nominalCapacityKg: '38871.00', safeCapacityKg: '34984.00', materialCode: '1614161040', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'RQ-REC-046 listava MILHO BC 61,4 ton; planilha 12/11/26 indica FARELO ALGODAO 38% (38.871 kg).' },
  { siloNumber: 40, rubricOrder: 26, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '7.18', nominalCapacityKg: '30839.00', safeCapacityKg: '27756.00', materialCode: '1613131012', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Linha em branco no RQ-REC-046; preenchido conforme planilha 12/11/26.' },
  { siloNumber: 39, rubricOrder: 27, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '8.19', nominalCapacityKg: '85411.00', safeCapacityKg: '76870.00', materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 38, rubricOrder: 28, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '4.98', nominalCapacityKg: '97190.00', safeCapacityKg: '87471.00', materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 37, rubricOrder: 29, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '6.29', nominalCapacityKg: '26693.00', safeCapacityKg: '24024.00', materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha e confirmação operacional indicam VEICULO PREMIX (26.693 kg); RQ-REC-046 impresso tinha CAULIM.' },
  { siloNumber: 36, rubricOrder: 30, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '4.97', nominalCapacityKg: '26800.00', safeCapacityKg: '24120.00', materialCode: '1211101012', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: MILHO BC (26.800 kg) vs RQ-REC-046: FARELO ALGODAO 38% (23.000 kg).' },
  { siloNumber: 35, rubricOrder: 31, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '9.54', nominalCapacityKg: '38000.00', safeCapacityKg: '34200.00', materialCode: '2019131030', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 34, rubricOrder: 32, category: 'ARMAZENAGEM', controlOwner: 'MOEGA', lineCode: 'L7', heightMeters: '9.00', cordaMeters: '3.27', nominalCapacityKg: '21354.00', safeCapacityKg: '19219.00', materialCode: '1614261039', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  // Grupo Produção / Abastecimento: 43 -> 64
  { siloNumber: 43, rubricOrder: 33, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '3.33', nominalCapacityKg: '7974.00', safeCapacityKg: '7177.00', materialCode: '2021171023', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 44, rubricOrder: 34, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '2.60', nominalCapacityKg: '11044.00', safeCapacityKg: '9939.00', materialCode: '2021171081', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 45, rubricOrder: 35, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '3.39', nominalCapacityKg: '5147.00', safeCapacityKg: '4632.00', materialCode: '1620101010', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 46, rubricOrder: 36, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '2.18', nominalCapacityKg: '13442.00', safeCapacityKg: '12097.00', materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 47, rubricOrder: 37, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '3.30', nominalCapacityKg: '16681.00', safeCapacityKg: '15013.00', materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 48, rubricOrder: 38, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '2.83', nominalCapacityKg: '6271.00', safeCapacityKg: '5644.00', materialCode: '2019131033', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 49, rubricOrder: 39, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '4.27', nominalCapacityKg: '9176.00', safeCapacityKg: '8259.00', materialCode: '2090121061', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 50, rubricOrder: 40, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '2.27', nominalCapacityKg: '8457.00', safeCapacityKg: '7612.00', materialCode: '2019101141', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 51, rubricOrder: 41, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '3.16', nominalCapacityKg: '14600.00', safeCapacityKg: '13140.00', materialCode: '2017101157', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: CALCARIO CALCITICO (14.600 kg) vs RQ-REC-046: FOSFATO BICALCICO (8.000 kg).' },
  { siloNumber: 52, rubricOrder: 42, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '4.04', nominalCapacityKg: '5618.00', safeCapacityKg: '5056.00', materialCode: 'F30GMOA16CMP', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Em branco no RQ-REC-046; cadastrado conforme planilha 12/11/26.' },
  { siloNumber: 53, rubricOrder: 43, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '3.63', nominalCapacityKg: '5618.00', safeCapacityKg: '5056.00', materialCode: 'F30GMOA16CMP', isDividedCompartment: false, validationStatus: 'PENDENTE_VALIDACAO', validationNotes: 'Planilha: GERMEN DE MILHO (5.618 kg) vs RQ-REC-046: CALCARIO (13.000 kg).' },
  { siloNumber: 54, rubricOrder: 44, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '7.26', nominalCapacityKg: '4893.00', safeCapacityKg: '4404.00', materialCode: 'F30104A', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 55, rubricOrder: 45, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '5.19', nominalCapacityKg: '9603.00', safeCapacityKg: '8642.00', materialCode: '2019131030', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 56, rubricOrder: 46, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '1.24', nominalCapacityKg: '4531.00', safeCapacityKg: '4078.00', materialCode: '1113101920', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 57, rubricOrder: 47, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '1.80', nominalCapacityKg: '4893.00', safeCapacityKg: '4404.00', materialCode: 'F30104A', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 58, rubricOrder: 48, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '3.88', nominalCapacityKg: '26512.00', safeCapacityKg: '23861.00', materialCode: '2017101021', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 59, rubricOrder: 49, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '6.14', nominalCapacityKg: '13624.00', safeCapacityKg: '12262.00', materialCode: '2017101250', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 60, rubricOrder: 50, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '6.90', nominalCapacityKg: '4001.00', safeCapacityKg: '3601.00', materialCode: '1619111011', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 61, rubricOrder: 51, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '4.20', nominalCapacityKg: '4984.00', safeCapacityKg: '4485.00', materialCode: '1614271130', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 62, rubricOrder: 52, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '1.60', nominalCapacityKg: '3625.00', safeCapacityKg: '3262.00', materialCode: '1614261039', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 63, rubricOrder: 53, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '1.05', nominalCapacityKg: '6223.00', safeCapacityKg: '5601.00', materialCode: 'F301030C', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
  { siloNumber: 64, rubricOrder: 54, category: 'PRODUCAO', controlOwner: 'PRODUCAO', lineCode: 'L7', heightMeters: null, cordaMeters: '5.71', nominalCapacityKg: '6223.00', safeCapacityKg: '5601.00', materialCode: 'F301030C', isDividedCompartment: false, validationStatus: 'VALIDADO', validationNotes: null },
];

export async function ensureBaseCatalogSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeed(): Promise<void> {
  // 1. Seed Roles & Permissions
  const roleCodes: RoleCode[] = ['ADMIN', 'SUPERVISOR', 'OPERADOR_MOEGA', 'PRODUCAO'];
  const roleDescriptions: Record<RoleCode, string> = {
    ADMIN: 'Gerencia usuários, cadastros de silos/materiais, regras, ajustes e auditoria completa.',
    SUPERVISOR: 'Acompanha operações, valida divergências, configura cadastros e consulta auditoria.',
    OPERADOR_MOEGA: 'Consulta silos/materiais e executa operações da Moega (recebimentos e transferências).',
    PRODUCAO: 'Perfil de consulta de disponibilidade por linha e solicitação de abastecimento.',
  };

  for (const code of roleCodes) {
    await db
      .insert(roles)
      .values({ code, name: ROLE_LABELS[code], description: roleDescriptions[code] })
      .onConflictDoNothing({ target: roles.code });
  }

  const allPermCodes = Array.from(new Set(Object.values(ROLE_PERMISSIONS).flat()));
  for (const permCode of allPermCodes) {
    const [mod] = permCode.split(':');
    await db
      .insert(permissions)
      .values({ code: permCode, module: mod, description: `Permissão ${permCode}` })
      .onConflictDoNothing({ target: permissions.code });
  }

  const dbRoles = await db.select().from(roles);
  const dbPerms = await db.select().from(permissions);
  const roleMap = new Map(dbRoles.map((r) => [r.code as RoleCode, r.id]));
  const permMap = new Map(dbPerms.map((p) => [p.code, p.id]));

  for (const rCode of roleCodes) {
    const roleId = roleMap.get(rCode);
    if (!roleId) continue;
    for (const pCode of ROLE_PERMISSIONS[rCode]) {
      const permissionId = permMap.get(pCode);
      if (!permissionId) continue;
      await db
        .insert(rolePermissions)
        .values({ roleId, permissionId })
        .onConflictDoNothing();
    }
  }

  // 2. Seed Shifts (and auto-migrate legacy default hours if still untouched)
  const shiftSeeds = [
    {
      code: 'TURNO_1',
      name: '1º Turno',
      startTime: '07:30',
      endTime: '17:18',
      crossesMidnight: false,
      legacyStart: '06:00',
      legacyEnd: '17:00',
    },
    {
      code: 'TURNO_2',
      name: '2º Turno',
      startTime: '17:00',
      endTime: '02:12',
      crossesMidnight: true,
      legacyStart: '17:00',
      legacyEnd: '02:00',
    },
    {
      code: 'TURNO_3',
      name: '3º Turno',
      startTime: '23:28',
      endTime: '07:30',
      crossesMidnight: true,
      legacyStart: '02:00',
      legacyEnd: '06:00',
    },
  ];
  const existingShifts = await db.select().from(shifts);
  const existingShiftByCode = new Map(existingShifts.map((row) => [row.code, row]));
  for (const s of shiftSeeds) {
    const cur = existingShiftByCode.get(s.code);
    if (!cur) {
      await db
        .insert(shifts)
        .values({
          code: s.code,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          crossesMidnight: s.crossesMidnight,
        })
        .onConflictDoNothing({ target: shifts.code });
    } else if (cur.startTime === s.legacyStart && cur.endTime === s.legacyEnd) {
      await db
        .update(shifts)
        .set({
          startTime: s.startTime,
          endTime: s.endTime,
          crossesMidnight: s.crossesMidnight,
          updatedAt: new Date(),
        })
        .where(eq(shifts.id, cur.id));
    }
  }

  // 3. Seed Production Lines L1..L7
  const lineSeeds = [
    { code: 'L1', name: 'Linha 1', category: 'LINHA_PRODUCAO', description: 'Exportação Premix (Silos 25–26)', sortOrder: 1 },
    { code: 'L2', name: 'Linha 2', category: 'LINHA_PRODUCAO', description: 'Exportação / Quirera e Vísceras (Silos 24–23)', sortOrder: 2 },
    { code: 'L3', name: 'Linha 3', category: 'LINHA_PRODUCAO', description: 'Núcleo Exportação (Silos 22–17)', sortOrder: 3 },
    { code: 'L4', name: 'Linha 4', category: 'LINHA_PRODUCAO', description: 'Núcleo Nacional (Silos 11–16, 31–33)', sortOrder: 4 },
    { code: 'L5', name: 'Linha 5', category: 'LINHA_PRODUCAO', description: 'Nacional Premix (Silos 9–10)', sortOrder: 5 },
    { code: 'L6', name: 'Linha 6', category: 'LINHA_PRODUCAO', description: 'Premix L6 (Silos 29–28)', sortOrder: 6 },
    { code: 'L7', name: 'Linha 7 (Armazenagem e Produção)', category: 'ARMAZENAGEM', description: 'Armazenagem Moega (42–34) e Produção/Abastecimento (43–64)', sortOrder: 7 },
  ];
  for (const l of lineSeeds) {
    await db.insert(productionLines).values(l).onConflictDoNothing({ target: productionLines.code });
  }

  // 4. Seed Materials (skip overwrite if already populated)
  for (const mat of MATERIALS_SEED) {
    await db
      .insert(materials)
      .values(mat)
      .onConflictDoNothing({ target: materials.code });
  }

  // 5. Seed Suppliers
  const supplierNames = [
    'MOAGEM PINHEIRO & ALVARENGA LTDA',
    'MASSARI MINERACAO',
    'LOUIS DREYFUS COMPANY',
    'MOSAIC FERTILIZANTES DO BRASIL S.A',
    'DILUMIX INDUSTRIAL LTDA',
    'NB MINERAIS LTDA',
    'MINERAÇÃO BELOCAL',
  ];
  for (const name of supplierNames) {
    await db.insert(suppliers).values({ name }).onConflictDoNothing({ target: suppliers.name });
  }

  // 6. Seed Silos (only if empty so admin edits persist cleanly)
  const [{ siloCount }] = await db.select({ siloCount: count() }).from(silos);
  if (Number(siloCount) === 0) {
    const dbLines = await db.select().from(productionLines);
    const dbMaterials = await db.select().from(materials);
    const lineIdByCode = new Map(dbLines.map((l) => [l.code, l.id]));
    const matIdByCode = new Map(dbMaterials.map((m) => [m.code, m.id]));

    for (const s of SILOS_SEED) {
      const lineId = lineIdByCode.get(s.lineCode);
      const matId = matIdByCode.get(s.materialCode);
      if (!lineId) continue;

      const [insertedSilo] = await db
        .insert(silos)
        .values({
          siloNumber: s.siloNumber,
          rubricOrder: s.rubricOrder,
          category: s.category,
          controlOwner: s.controlOwner,
          productionLineId: lineId,
          heightMeters: s.heightMeters,
          cordaMeters: s.cordaMeters,
          nominalCapacityKg: s.nominalCapacityKg,
          safetyFactorPercent: '10.00',
          safeCapacityKg: s.safeCapacityKg,
          primaryMaterialId: matId ?? null,
          operationalStatus: 'OPERACIONAL',
          cleaningStatus: 'EM_USO',
          isDividedCompartment: s.isDividedCompartment,
          validationStatus: s.validationStatus,
          validationNotes: s.validationNotes,
        })
        .onConflictDoNothing({ target: silos.siloNumber })
        .returning();

      if (insertedSilo && matId) {
        await db
          .insert(siloMaterialCompatibility)
          .values({
            siloId: insertedSilo.id,
            materialId: matId,
            isPrimary: true,
            allowReceiving: insertedSilo.category !== 'PRODUCAO',
            allowTransferIn: true,
            allowTransferOut: insertedSilo.category === 'ARMAZENAGEM',
            validationStatus: s.validationStatus,
            restrictions: s.validationNotes,
          })
          .onConflictDoNothing();
      }
    }

    // 7. Seed Transfer Rules (validado apenas o que foi explicitamente confirmado: Silo 37 -> 10, 15)
    const dbSilos = await db.select().from(silos);
    const siloIdByNum = new Map(dbSilos.map((s) => [s.siloNumber, s.id]));
    const transferSeeds = [
      {
        origin: 37,
        dest: 10,
        matCode: '1113101920',
        status: 'VALIDADO',
        active: true,
        ref: 'Confirmado pelo operador (Seção 18): Silo 37 Veículo Premix -> Silo 10',
      },
      {
        origin: 37,
        dest: 15,
        matCode: '1113101920',
        status: 'VALIDADO',
        active: true,
        ref: 'Confirmado pelo operador (Seção 18): Silo 37 Veículo Premix -> Silo 15',
      },
      {
        origin: 38,
        dest: 12,
        matCode: '2017101021',
        status: 'PENDENTE_VALIDACAO',
        active: false,
        ref: 'Anotação de caderno: Silo 38 -> 12 (Calcário). Aguarda validação.',
      },
      {
        origin: 38,
        dest: 21,
        matCode: '2017101021',
        status: 'PENDENTE_VALIDACAO',
        active: false,
        ref: 'Anotação de caderno: Silo 38 -> 21 (Calcário). Aguarda validação.',
      },
      {
        origin: 34,
        dest: 31,
        matCode: '1614261039',
        status: 'PENDENTE_VALIDACAO',
        active: false,
        ref: 'Anotação de caderno: Silo 34 -> 31 (Glúten). Aguarda validação.',
      },
      {
        origin: 37,
        dest: 9,
        matCode: '1113101920',
        status: 'PENDENTE_VALIDACAO',
        active: false,
        ref: 'Anotação de caderno: Silo 37 -> 9 (Veículo Premix). Aguarda validação.',
      },
      {
        origin: 35,
        dest: 13,
        matCode: '2019131030',
        status: 'PENDENTE_VALIDACAO',
        active: false,
        ref: 'Anotação de caderno: Silo 35 -> 13 (Fosfato Mono 21%). Aguarda validação.',
      },
      {
        origin: 39,
        dest: 11,
        matCode: '2019101141',
        status: 'PENDENTE_VALIDACAO',
        active: false,
        ref: 'Anotação de caderno: Silo 39 -> 11 (Fosfato Bi 19%). Aguarda validação.',
      },
    ];

    for (const tr of transferSeeds) {
      const originSiloId = siloIdByNum.get(tr.origin);
      const destinationSiloId = siloIdByNum.get(tr.dest);
      const materialId = matIdByCode.get(tr.matCode);
      if (!originSiloId || !destinationSiloId || !materialId) continue;

      await db
        .insert(siloTransferRules)
        .values({
          originSiloId,
          destinationSiloId,
          materialId,
          operationType: 'TRANSFERENCIA_INTERNA',
          requiresAuthorization: tr.status !== 'VALIDADO',
          validationStatus: tr.status,
          isActive: tr.active,
          sourceReference: tr.ref,
        })
        .onConflictDoNothing();
    }
  }

  // 8. Seed Validation Pendencies from Document Cross-Check
  const [{ pendCount }] = await db.select({ pendCount: count() }).from(validationPendencies);
  if (Number(pendCount) === 0) {
    await db.insert(validationPendencies).values([
      {
        entityType: 'SILO',
        entityRef: 'SILO 15 / 16 / 18 / 19',
        title: 'Divergência de matéria-prima entre RQ-REC-046 e Planilha 12/11/26',
        description:
          'Os silos 15, 16, 18 e 19 apresentam produtos distintos entre a ficha impressa RQ-REC-046 e o relatório de capacidade de 12/11/26.',
        sourceA: 'Planilha 12/11/26: S15 Premix, S16 Calcítico, S18 Premix, S19 Calcítico',
        sourceB: 'RQ-REC-046: S15 Farelo Casca Arroz, S16 Farelo Algodão, S18 Farelo Casca Arroz, S19 Fosfato Bi',
        status: 'PENDENTE',
      },
      {
        entityType: 'SILO',
        entityRef: 'SILO 23 / 24 / 26',
        title: 'Divergência de produto e controle operacional (Linhas 1 e 2)',
        description:
          'Os silos 23, 24 e 26 possuem divergências entre a ficha RQ-REC-046 e o relatório 12/11/26 quanto ao material armazenado e controle Moega/Produção.',
        sourceA: 'Planilha 12/11/26: S23 Quirera, S24 Farinha Vísceras (Produção), S26 Fosfato Bi',
        sourceB: 'RQ-REC-046: S23 Casca Arroz, S24 Premix, S26 Premix',
        status: 'PENDENTE',
      },
      {
        entityType: 'SILO',
        entityRef: 'SILO 37 / 40 / 41 / 36',
        title: 'Conferência da Armazenagem (Linha 7 — Silos 42 a 34)',
        description:
          'Anotação manual indica 9,00 m para armazenagem, enquanto o relatório 12/11/26 traz capacidades distintas e Silo 37 como Veículo Premix (vs Caulim no RQ-REC-046).',
        sourceA: 'Planilha 12/11/26 + Regra confirmada S37->S10/S15 (Veículo Premix)',
        sourceB: 'RQ-REC-046: S37 Caulim 40,5t; S40 em branco; S41 Milho BC; S36 Farelo Algodão',
        status: 'PENDENTE',
      },
      {
        entityType: 'SILO',
        entityRef: 'SILO 51 / 52 / 53',
        title: 'Conferência do grupo Produção/Abastecimento',
        description:
          'Divergências de cadastro nos silos 51, 52 (em branco no RQ-REC-046) e 53 entre RQ-REC-046 e planilha 12/11/26.',
        sourceA: 'Planilha 12/11/26: S51 Calcítico, S52/S53 Germen de Milho',
        sourceB: 'RQ-REC-046: S51 Fosfato Bi, S52 em branco, S53 Calcário',
        status: 'PENDENTE',
      },
      {
        entityType: 'BAG_WEIGHT',
        entityRef: 'PESO_UNITARIO_BAGS',
        title: 'Validação de pesos unitários de bags por fornecedor/lote',
        description:
          'Os pesos anotados em caderno (Caulim 1200 kg, Fosfato 1500 kg, Alga 1000/1300 kg, Veículo 800 kg, Glúten 1000/1260 kg, Calcítico/Calcário 1000 kg) são referências preliminares e não devem ser fixados sem documento.',
        sourceA: 'Anotação de campo: PESO DOS BAGS',
        sourceB: 'Etiqueta / Nota Fiscal / Conferência do operador no recebimento',
        status: 'PENDENTE',
      },
      {
        entityType: 'TRANSFER_RULE',
        entityRef: 'ROTAS_ANOTADAS',
        title: 'Homologação de rotas de transferência anotadas em caderno',
        description:
          'Apenas Silo 37 -> Silos 10 e 15 (Veículo Premix) foi validada. Rotas S38->12/21, S34->31, S35->13 e S39->11/19 permanecem bloqueadas até aprovação oficial.',
        sourceA: 'Anotação de caderno (Transferência)',
        sourceB: 'Matriz oficial de compatibilidade e engenharia da planta',
        status: 'PENDENTE',
      },
    ]);
  }

  // 9. Seed Help Articles (Sincronizado automaticamente a partir de src/lib/manual-registry.ts)
  const helpSeeds = buildAutoHelpArticles();

  for (const h of helpSeeds) {
    await db
      .insert(helpArticles)
      .values(h)
      .onConflictDoUpdate({
        target: helpArticles.slug,
        set: {
          title: h.title,
          summary: h.summary,
          content: h.content,
          sortOrder: h.sortOrder,
        },
      });
  }

  // 10. Seed Provisional Big Bag Packaging Configurations (Phase 2)
  const dbMaterials = await db.select().from(materials);
  const matIdByCode = new Map(dbMaterials.map((m) => [m.code, m.id]));
  const bagConfigSeeds: Array<{
    code: string;
    packagingLabel: string;
    unitWeightKg: string;
    isDefault: boolean;
    notes: string;
  }> = [
    {
      code: '2090121061',
      packagingLabel: 'Big Bag Padrão (1.200 kg)',
      unitWeightKg: '1200.00',
      isDefault: true,
      notes: 'Referência provisória Caulim Big Bag — sujeita à validação oficial.',
    },
    {
      code: '2019101142',
      packagingLabel: 'Big Bag Padrão (1.500 kg)',
      unitWeightKg: '1500.00',
      isDefault: true,
      notes: 'Referência provisória Fosfato Bicálcico Big Bag.',
    },
    {
      code: '2019131031',
      packagingLabel: 'Big Bag Padrão (1.500 kg)',
      unitWeightKg: '1500.00',
      isDefault: true,
      notes: 'Referência provisória Fosfato Monobicálcico Big Bag.',
    },
    {
      code: '2019131033',
      packagingLabel: 'Big Bag Especial (1.500 kg)',
      unitWeightKg: '1500.00',
      isDefault: true,
      notes: 'Referência provisória Fosfato Mono 21% Especial.',
    },
    {
      code: '2017101294',
      packagingLabel: 'Embalagem A (1.000 kg)',
      unitWeightKg: '1000.00',
      isDefault: true,
      notes: 'Carbonato de Cálcio de Alga — conferir embalagem antes da descarga.',
    },
    {
      code: '2017101294',
      packagingLabel: 'Embalagem B (1.300 kg)',
      unitWeightKg: '1300.00',
      isDefault: false,
      notes: 'Carbonato de Cálcio de Alga embalagem reforçada (1.300 kg).',
    },
    {
      code: '1113101920',
      packagingLabel: 'Big Bag Padrão (800 kg)',
      unitWeightKg: '800.00',
      isDefault: true,
      notes: 'Referência provisória Veículo Premix.',
    },
    {
      code: '1113101922',
      packagingLabel: 'Big Bag Padrão (800 kg)',
      unitWeightKg: '800.00',
      isDefault: true,
      notes: 'Referência provisória Veículo Premix Big Bag.',
    },
    {
      code: '1614261033',
      packagingLabel: 'Embalagem Padrão (1.000 kg)',
      unitWeightKg: '1000.00',
      isDefault: true,
      notes: 'Farelo de Glúten de Milho 21% — opção 1.000 kg.',
    },
    {
      code: '1614261033',
      packagingLabel: 'Embalagem B (1.260 kg)',
      unitWeightKg: '1260.00',
      isDefault: false,
      notes: 'Farelo de Glúten de Milho 21% — opção 1.260 kg.',
    },
    {
      code: '2017101157',
      packagingLabel: 'Big Bag Padrão (1.000 kg)',
      unitWeightKg: '1000.00',
      isDefault: true,
      notes: 'Calcário Calcítico Big Bag (TMP) — referência provisória.',
    },
    {
      code: '2017101021',
      packagingLabel: 'Big Bag Padrão (1.000 kg)',
      unitWeightKg: '1000.00',
      isDefault: true,
      notes: 'Calcário ensacado/big bag — referência provisória.',
    },
  ];

  for (const cfg of bagConfigSeeds) {
    const materialId = matIdByCode.get(cfg.code);
    if (!materialId) continue;
    await db
      .insert(materialBagConfigs)
      .values({
        materialId,
        packagingLabel: cfg.packagingLabel,
        unitWeightKg: cfg.unitWeightKg,
        validationStatus: 'PENDENTE_VALIDACAO',
        isDefault: cfg.isDefault,
        notes: cfg.notes,
      })
      .onConflictDoNothing();
  }

  // 11. Seed Configurable Document Templates (Phase 3)
  const templateSeeds = [
    {
      code: 'PROG_SENSOR_GERAL',
      name: 'Programação Diária de Produção (Sensor Sistemas / Tabela Padrão)',
      documentCategory: 'PROGRAMACAO',
      promptHints:
        'Documento de programação diária por linhas (L1 a L7). Identificar data de produção, linha, ordem/sequência, código e descrição do produto ou matéria-prima, quantidade programada, unidade (t, kg ou batelada) e horário/turno previsto.',
      columnHintsJson: JSON.stringify({
        lineColumns: ['Linha', 'L1..L7', 'Setor'],
        productColumns: ['Código', 'Produto', 'Fórmula', 'Ração'],
        quantityColumns: ['Qtd', 'Peso', 'Ton', 'Kg', 'Programado'],
      }),
    },
    {
      code: 'REL_PRODUCAO_SENSOR',
      name: 'Relatório Impresso de Produção Realizada (Sensor Sistemas)',
      documentCategory: 'RELATORIO_PRODUCAO',
      promptHints:
        'Relatório de acompanhamento ou fechamento de produção impressa do Sensor Sistemas. Extrair quantidades programadas e realizadas por linha e produto, identificando alterações ou observações manuscritas.',
      columnHintsJson: JSON.stringify({
        lineColumns: ['Linha', 'Equipamento'],
        realizedColumns: ['Realizado', 'Produzido', 'Batidas'],
      }),
    },
    {
      code: 'REL_CONSUMO_SENSOR',
      name: 'Relatório de Consumo de Matérias-Primas',
      documentCategory: 'RELATORIO_CONSUMO',
      promptHints:
        'Relatório discriminando matérias-primas dosadas por linha ou período. Associar diretamente código da matéria-prima, descrição, quantidade consumida ou prevista e unidade.',
      columnHintsJson: JSON.stringify({
        materialColumns: ['MP', 'Ingrediente', 'Matéria-Prima', 'Código'],
        quantityColumns: ['Consumo', 'Dosado', 'Kg', 'Ton'],
      }),
    },
    {
      code: 'REVISAO_TURNO',
      name: 'Revisão / Aditivo de Programação de Turno',
      documentCategory: 'REVISAO',
      promptHints:
        'Documento ou anotação de alteração de programação durante o turno. Priorizar identificação de linhas alteradas, troca de produto, ajuste de volume e anotações manuscritas.',
      columnHintsJson: JSON.stringify({
        notesFocus: 'Alterações manuscritas, cancelamentos ou antecipação de lotes.',
      }),
    },
  ];

  for (const tpl of templateSeeds) {
    await db
      .insert(scheduleDocumentTemplates)
      .values(tpl)
      .onConflictDoUpdate({
        target: scheduleDocumentTemplates.code,
        set: {
          name: tpl.name,
          documentCategory: tpl.documentCategory,
          promptHints: tpl.promptHints,
          columnHintsJson: tpl.columnHintsJson,
        },
      });
  }

  // 12. Phase 4 Seeds: Preliminary Transfer Routes (Silo 39->31 Glúten + sync authorizationStatus) & Priority Configs
  const allSilosForRoutes = await db.select().from(silos);
  const siloRowByNum = new Map(allSilosForRoutes.map((s) => [s.siloNumber, s]));
  const phase4PreliminaryRoutes = [
    {
      origin: 37,
      dest: 10,
      matCode: '1113101920',
      authStatus: 'AUTORIZADA',
      valStatus: 'VALIDADO',
      active: true,
      ref: 'Confirmado pelo operador (Seção 18 / Fase 4): Silo 37 Veículo Premix -> Silo 10 (L5)',
    },
    {
      origin: 37,
      dest: 15,
      matCode: '1113101920',
      authStatus: 'AUTORIZADA',
      valStatus: 'VALIDADO',
      active: true,
      ref: 'Confirmado pelo operador (Seção 18 / Fase 4): Silo 37 Veículo Premix -> Silo 15 (L4)',
    },
    {
      origin: 38,
      dest: 12,
      matCode: '2017101021',
      authStatus: 'PENDENTE_VALIDACAO',
      valStatus: 'PENDENTE_VALIDACAO',
      active: false,
      ref: 'Regra preliminar: Silo 38 -> Silo 12 (Calcário), pendente confirmação administrativa.',
    },
    {
      origin: 38,
      dest: 21,
      matCode: '2017101021',
      authStatus: 'PENDENTE_VALIDACAO',
      valStatus: 'PENDENTE_VALIDACAO',
      active: false,
      ref: 'Regra preliminar: Silo 38 -> Silo 21 (Calcário), pendente confirmação administrativa.',
    },
    {
      origin: 39,
      dest: 31,
      matCode: '1614261039',
      authStatus: 'PENDENTE_VALIDACAO',
      valStatus: 'PENDENTE_VALIDACAO',
      active: false,
      ref: 'Regra preliminar Fase 4: Silo 39 -> Silo 31 (Glúten), sujeita à validação administrativa.',
    },
    {
      origin: 35,
      dest: 13,
      matCode: '2019131030',
      authStatus: 'PENDENTE_VALIDACAO',
      valStatus: 'PENDENTE_VALIDACAO',
      active: false,
      ref: 'Regra preliminar: Silo 35 -> Silo 13 (Fosfato Monocálcico 21%), sujeita à validação.',
    },
    {
      origin: 39,
      dest: 11,
      matCode: '2019101141',
      authStatus: 'PENDENTE_VALIDACAO',
      valStatus: 'PENDENTE_VALIDACAO',
      active: false,
      ref: 'Regra preliminar: Silo 39 -> Silo 11 (Fosfato Bicálcico 19%), sujeita à validação.',
    },
  ];

  for (const r of phase4PreliminaryRoutes) {
    const originSilo = siloRowByNum.get(r.origin);
    const destSilo = siloRowByNum.get(r.dest);
    const materialId = matIdByCode.get(r.matCode);
    if (!originSilo || !destSilo || !materialId) continue;

    await db
      .insert(siloTransferRules)
      .values({
        originSiloId: originSilo.id,
        destinationSiloId: destSilo.id,
        materialId,
        relatedLineId: destSilo.productionLineId,
        operationType: 'TRANSFERENCIA_INTERNA',
        requiresAuthorization: r.authStatus !== 'AUTORIZADA',
        authorizationStatus: r.authStatus,
        validationStatus: r.valStatus,
        isActive: r.active,
        sourceReference: r.ref,
      })
      .onConflictDoNothing();
  }

  // Sincroniza authorizationStatus e relatedLineId em regras pré-existentes já validadas sem sobrescrever suspensões/bloqueios
  const existingRules = await db.select().from(siloTransferRules);
  const siloLineById = new Map(allSilosForRoutes.map((s) => [s.id, s.productionLineId]));
  for (const er of existingRules) {
    const updates: Record<string, any> = {};
    if (!er.relatedLineId && siloLineById.has(er.destinationSiloId)) {
      updates.relatedLineId = siloLineById.get(er.destinationSiloId);
    }
    if (
      er.isActive &&
      er.validationStatus === 'VALIDADO' &&
      er.authorizationStatus === 'PENDENTE_VALIDACAO'
    ) {
      updates.authorizationStatus = 'AUTORIZADA';
    }
    if (Object.keys(updates).length > 0) {
      await db.update(siloTransferRules).set(updates).where(eq(siloTransferRules.id, er.id));
    }
  }

  await db
    .insert(operationalPriorityConfigs)
    .values({
      code: 'PADRAO_INDUSTRIAL',
      name: 'Priorização Operacional Padrão',
      description:
        'Ponderação configurável de risco de parada da linha, cobertura atual, rota autorizada, disponibilidade na origem e urgência da programação.',
      weightLineStopRisk: 40,
      weightStockCoverage: 25,
      weightAuthorizedRoute: 15,
      weightOriginAvailability: 10,
      weightScheduleUrgency: 10,
      isActive: true,
    })
    .onConflictDoNothing({ target: operationalPriorityConfigs.code });

  // 13. System Settings
  const settingsSeeds = [
    { key: 'SAFETY_FACTOR_PERCENT', value: '10', description: 'Fator de segurança padrão aplicado à capacidade nominal dos silos (%).' },
    { key: 'SYSTEM_PHASE', value: 'FASE_5_RELATORIOS_TURNOS_OCORRENCIAS', description: 'Fase operacional atualmente implantada.' },
  ];
  for (const st of settingsSeeds) {
    await db
      .insert(systemSettings)
      .values(st)
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: st.value, description: st.description },
      });
  }
}
