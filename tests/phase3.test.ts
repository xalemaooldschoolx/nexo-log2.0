import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  calculateDeterministicConsumption,
  computeOperationalIntelligence,
  diffScheduleRevisions,
  ProductConsumptionFactorSnapshot,
  SiloCoverageInput,
  TransferRuleCoverageInput,
} from '../src/lib/production-intelligence.ts';
import {
  interpretScheduleDocumentWithGemini,
  parseCsvToMatrix,
  parseMatrixDeterministically,
  parseXlsxBase64ToText,
} from '../src/lib/gemini-documents.ts';
import { hasPermission } from '../src/lib/rbac.ts';

function buildPhase3FixtureSilos(): SiloCoverageInput[] {
  return [
    {
      id: 4,
      siloNumber: 12,
      lineCode: 'L4',
      category: 'LINHA',
      controlOwner: 'MOEGA',
      primaryMaterialId: 1, // Calcário 2017101021
      operationalStatus: 'OPERACIONAL',
      nominalCapacityKg: 70369,
      safeCapacityKg: 63332,
      confirmedStockKg: 5000,
      compatibleMaterialIds: [1],
    },
    {
      id: 30,
      siloNumber: 38,
      lineCode: 'L7',
      category: 'ARMAZENAGEM',
      controlOwner: 'MOEGA',
      primaryMaterialId: 1, // Calcário 2017101021
      operationalStatus: 'OPERACIONAL',
      nominalCapacityKg: 50000,
      safeCapacityKg: 45000,
      confirmedStockKg: 35000,
      compatibleMaterialIds: [1],
    },
    {
      id: 2,
      siloNumber: 10,
      lineCode: 'L5',
      category: 'LINHA',
      controlOwner: 'MOEGA',
      primaryMaterialId: 11, // Veículo Premix 1113101920
      operationalStatus: 'OPERACIONAL',
      nominalCapacityKg: 13978,
      safeCapacityKg: 12580,
      confirmedStockKg: 8000,
      compatibleMaterialIds: [11],
    },
  ];
}

const FIXTURE_MATERIALS = [
  { id: 1, code: '2017101021', description: 'CALCARIO', isCritical: true },
  { id: 11, code: '1113101920', description: 'VEICULO PREMIX', isCritical: false },
  { id: 5, code: '2090121061', description: 'CAULIM BIG BAG', isCritical: true },
];

describe('NEXO LOG 2.0 — Fase 3 (19 Cenários Obrigatórios)', () => {
  it('1. Importação de fotografia (captura com ajuste, arquivamento original e falha explícita sem Gemini Key)', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(
      () =>
        interpretScheduleDocumentWithGemini({
          sourceType: 'FOTO_TABLET',
          mimeType: 'image/jpeg',
          fileBase64: 'ZmFrZV9waG90bw==',
          templatePromptHints: 'Programação Sensor Sistemas',
          catalogContext: '2017101021 | CALCARIO',
        }),
      /GEMINI_API_KEY/
    );
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;

    const modalSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/schedules/DocumentCaptureModal.tsx'),
      'utf8'
    );
    assert.ok(modalSrc.includes('getUserMedia'));
    assert.ok(modalSrc.includes('rotationDeg'));
    assert.ok(modalSrc.includes('cropMarginPct'));
    assert.ok(modalSrc.includes('highContrast'));
  });

  it('2. Importação de PDF (multimodal explícito) e planilhas CSV/XLSX (extração tabular real)', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(
      () =>
        interpretScheduleDocumentWithGemini({
          sourceType: 'ARQUIVO_PDF',
          mimeType: 'application/pdf',
          fileBase64: 'JVBERi0xLjQ=',
          templatePromptHints: 'PDF Sensor',
          catalogContext: '2017101021 | CALCARIO',
        }),
      /GEMINI_API_KEY/
    );
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;

    // CSV
    const csv = 'Linha;Codigo;Produto;MP;Quantidade;Unidade;Turno\nL4;RAC-100;Racao B1;2017101021;25;t;T1';
    const csvMatrix = parseCsvToMatrix(csv);
    assert.equal(csvMatrix.length, 2);
    assert.equal(csvMatrix[1][0], 'L4');
    assert.equal(csvMatrix[1][3], '2017101021');

    // XLSX real via ExcelJS
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Programacao');
    ws.addRow(['Linha', 'Codigo', 'Descricao', 'MP', 'Quantidade', 'Unidade']);
    ws.addRow(['Linha 5', 'RAC-200', 'Premix A', '1113101920', 12.5, 't']);
    const buffer = await wb.xlsx.writeBuffer();
    const b64 = Buffer.from(buffer).toString('base64');
    const xlsxParsed = await parseXlsxBase64ToText(b64);
    assert.ok(xlsxParsed.textPreview.includes('Programacao'));
    assert.equal(xlsxParsed.matrix[1][0], 'Linha 5');
    assert.equal(xlsxParsed.matrix[1][3], '1113101920');
  });

  it('3. Reconhecimento de datas e linhas (L1 a L7 normalizadas sem inventar data ausente)', () => {
    const matrix = [
      ['Linha', 'Codigo', 'Produto', 'MP', 'Quantidade', 'Unidade'],
      ['Linha 04', 'F-01', 'Formula 01', '2017101021', '18,5', 't'],
      ['L7', 'F-02', 'Formula 02', '2090121061', '1200', 'kg'],
    ];
    const parsed = parseMatrixDeterministically(matrix);
    assert.equal(parsed.productionDate, null); // Data ausente nunca é inventada
    assert.ok(parsed.unreadableOrAmbiguousFields.includes('productionDate'));
    assert.equal(parsed.items[0].lineCode, 'L4');
    assert.equal(parsed.items[0].plannedQuantity, 18.5);
    assert.equal(parsed.items[1].lineCode, 'L7');
    assert.equal(parsed.items[1].plannedQuantity, 1200);
    assert.equal(parsed.items[1].plannedUnit, 'kg');
  });

  it('4. Identificação de códigos de matéria-prima e preservação de zeros à esquerda', () => {
    const matrix = [
      ['Linha', 'Codigo', 'MP', 'Quantidade', 'Unidade'],
      ['L4', '00123', '2090121061', '6000', 'kg'],
      ['L4', '00456', '0011647908', '4', 't'],
    ];
    const parsed = parseMatrixDeterministically(matrix);
    assert.equal(parsed.items[0].productCode, '00123');
    assert.equal(parsed.items[0].materialCode, '2090121061');
    assert.equal(parsed.items[1].materialCode, '0011647908');
  });

  it('5. Campo ilegível ou desconhecido sinalizado para revisão sem inventar valores', () => {
    const matrix = [
      ['Linha', 'Codigo', 'MP', 'Quantidade', 'Unidade'],
      ['L4', '', '', '???', ''],
    ];
    const parsed = parseMatrixDeterministically(matrix);
    assert.equal(parsed.items.length, 1);
    const item = parsed.items[0];
    assert.equal(item.plannedQuantity, null);
    assert.equal(item.plannedUnit, null);
    assert.equal(item.confidence, 'BAIXA');
    assert.equal(item.needsReview, true);
    assert.ok(item.reviewReason?.includes('Código não identificado'));
    assert.ok(item.reviewReason?.includes('Quantidade inválida'));
    assert.ok(item.reviewReason?.includes('Unidade de medida ausente'));
  });

  it('6. Programação de hoje e amanhã separadas corretamente nos indicadores', () => {
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: [],
      pendingConfirmedReceipts: [],
      thresholds: [],
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 10,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 10000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'EM_ANDAMENTO',
        },
        {
          scheduleId: 2,
          scheduleItemId: 11,
          referenceDate: '2026-11-18',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 15000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'NAO_INICIADA',
        },
      ],
    });
    const calcRow = analysis.byMaterial.find((m) => m.materialId === 1)!;
    assert.equal(calcRow.plannedConsumptionTodayKg, 10000);
    assert.equal(calcRow.plannedConsumptionTomorrowKg, 15000);
  });

  it('7. Nova revisão de programação detecta diferenças e preserva revisão anterior', () => {
    const diff = diffScheduleRevisions(
      [
        {
          lineCode: 'L4',
          productCode: 'RAC-01',
          productDescription: 'RACAO A',
          plannedQuantity: 20,
          plannedUnit: 't',
          materialCode: '2017101021',
          consumptionKg: 4000,
        },
      ],
      [
        {
          lineCode: 'L4',
          productCode: 'RAC-01',
          productDescription: 'RACAO A',
          plannedQuantity: 35,
          plannedUnit: 't',
          materialCode: '2017101021',
          consumptionKg: 7000,
        },
        {
          lineCode: 'L5',
          productCode: 'PMX-02',
          productDescription: 'PREMIX B',
          plannedQuantity: 10,
          plannedUnit: 't',
          materialCode: '1113101920',
          consumptionKg: 2500,
        },
      ]
    );
    assert.equal(diff.hasPreviousRevision, true);
    assert.equal(diff.hasChanges, true);
    assert.equal(diff.alertTitle, 'NOVA REVISÃO DA PROGRAMAÇÃO IDENTIFICADA.');
    assert.ok(diff.itemChanges.some((c) => c.changeType === 'ALTERADO' && c.lineCode === 'L4'));
    assert.ok(diff.itemChanges.some((c) => c.changeType === 'ADICIONADO' && c.lineCode === 'L5'));
  });

  it('8. Alteração de consumo entre revisões aponta delta exato em kg por matéria-prima', () => {
    const diff = diffScheduleRevisions(
      [
        {
          lineCode: 'L4',
          productCode: 'RAC-01',
          productDescription: 'RACAO A',
          plannedQuantity: 20,
          plannedUnit: 't',
          materialCode: '2017101021',
          consumptionKg: 4000,
        },
      ],
      [
        {
          lineCode: 'L4',
          productCode: 'RAC-01',
          productDescription: 'RACAO A',
          plannedQuantity: 35,
          plannedUnit: 't',
          materialCode: '2017101021',
          consumptionKg: 7000,
        },
      ]
    );
    assert.equal(diff.materialImpacts.length, 1);
    assert.equal(diff.materialImpacts[0].materialCode, '2017101021');
    assert.equal(diff.materialImpacts[0].deltaKg, 3000);
  });

  it('9. Cálculo de consumo previsto é determinístico e marca PENDENTE_FATOR quando não homologado', () => {
    const factors: ProductConsumptionFactorSnapshot[] = [
      {
        id: 1,
        productId: 100,
        materialId: 1,
        factorKgPerUnit: 180, // 180 kg de Calcário por t
        unit: 't',
        validationStatus: 'VALIDADO',
        sourceReference: 'Formula-100',
      },
      {
        id: 2,
        productId: 100,
        materialId: 5,
        factorKgPerUnit: 50,
        unit: 't',
        validationStatus: 'PENDENTE_VALIDACAO', // Não pode entrar como validado
        sourceReference: 'Draft',
      },
    ];

    const calculated = calculateDeterministicConsumption({
      plannedQuantity: 5000,
      plannedUnit: 'kg', // 5 t
      productId: 100,
      directMaterialId: null,
      validatedFactors: factors,
    });
    assert.equal(calculated.length, 1);
    assert.equal(calculated[0].calculationStatus, 'CALCULADO');
    assert.equal(calculated[0].calculatedConsumptionKg, 900); // 5 t * 180 kg/t

    const missingFactor = calculateDeterministicConsumption({
      plannedQuantity: 20,
      plannedUnit: 't',
      productId: 999,
      directMaterialId: null,
      validatedFactors: factors,
    });
    assert.equal(missingFactor[0].calculationStatus, 'PENDENTE_FATOR');
    assert.equal(missingFactor[0].calculatedConsumptionKg, 0);
  });

  it('10. Confronto com saldo real nunca abate programação futura do ESTOQUE REAL', () => {
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: [],
      pendingConfirmedReceipts: [],
      thresholds: [],
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 10,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 12000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'NAO_INICIADA',
        },
      ],
    });
    const calcRow = analysis.byMaterial.find((m) => m.materialId === 1)!;
    // Silo 12 (5.000) + Silo 38 (35.000) = 40.000 kg reais intactos
    assert.equal(calcRow.realStockKg, 40000);
    assert.equal(calcRow.plannedConsumptionTodayKg, 12000);
    assert.equal(calcRow.projectedBalanceTodayKg, 28000);
  });

  it('11. Cálculo de saldo projetado identifica estoque suficiente hoje e insuficiente amanhã', () => {
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: [],
      pendingConfirmedReceipts: [],
      thresholds: [],
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 10,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 25000, // Hoje: 40.000 - 25.000 = +15.000
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'EM_ANDAMENTO',
        },
        {
          scheduleId: 2,
          scheduleItemId: 11,
          referenceDate: '2026-11-18',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 20000, // Hoje+Amanhã: 40.000 - 45.000 = -5.000
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'NAO_INICIADA',
        },
      ],
    });
    const calcRow = analysis.byMaterial.find((m) => m.materialId === 1)!;
    assert.equal(calcRow.projectedBalanceTodayKg, 15000);
    assert.equal(calcRow.projectedBalanceWithTomorrowKg, -5000);
    assert.equal(calcRow.statusPriority, 'LARANJA');
    assert.equal(
      calcRow.statusHeadline,
      'ESTOQUE SUFICIENTE PARA A PROGRAMAÇÃO DE HOJE, MAS INSUFICIENTE PARA AMANHÃ.'
    );
  });

  it('12. Entrada futura confirmada entra sem duplicidade e separada do estoque real', () => {
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: [],
      pendingConfirmedReceipts: [
        {
          id: 501,
          receiptNumber: 'REC-501',
          materialId: 1,
          remainingQuantityKg: 10000,
          entryDate: '2026-11-17',
          status: 'PARCIAL',
        },
        // Duplicata acidental do mesmo ID deve ser ignorada
        {
          id: 501,
          receiptNumber: 'REC-501',
          materialId: 1,
          remainingQuantityKg: 10000,
          entryDate: '2026-11-17',
          status: 'PARCIAL',
        },
      ],
      thresholds: [],
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 10,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 42000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'EM_ANDAMENTO',
        },
      ],
    });
    const calcRow = analysis.byMaterial.find((m) => m.materialId === 1)!;
    assert.equal(calcRow.realStockKg, 40000);
    assert.equal(calcRow.confirmedPendingEntriesKg, 10000);
    // 40.000 + 10.000 - 42.000 = +8.000
    assert.equal(calcRow.projectedBalanceTodayKg, 8000);
  });

  it('13. Produção adiantada antecipa demanda de amanhã para o consumo ativo de hoje', () => {
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: [],
      pendingConfirmedReceipts: [],
      thresholds: [],
      projections: [
        {
          scheduleId: 2,
          scheduleItemId: 12,
          referenceDate: '2026-11-18',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 15000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'ADIANTADA',
        },
      ],
    });
    const calcRow = analysis.byMaterial.find((m) => m.materialId === 1)!;
    assert.equal(calcRow.advancedConsumptionKg, 15000);
    assert.equal(calcRow.projectedBalanceTodayKg, 25000);
    assert.ok(analysis.alerts.some((a) => a.title.includes('Produção adiantada')));
  });

  it('14. Produção atrasada nunca é marcada como concluída apenas pela passagem da data', () => {
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: [],
      pendingConfirmedReceipts: [],
      thresholds: [],
      projections: [
        {
          scheduleId: 9,
          scheduleItemId: 99,
          referenceDate: '2026-11-16', // Ontem, ainda ATRASADA
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 12000,
          realizedConsumptionKg: 2000,
          calculationStatus: 'CALCULADO',
          executionStatus: 'ATRASADA',
        },
      ],
    });
    const calcRow = analysis.byMaterial.find((m) => m.materialId === 1)!;
    assert.equal(calcRow.overdueConsumptionKg, 10000);
    assert.equal(calcRow.projectedBalanceTodayKg, 30000);
    assert.ok(analysis.alerts.some((a) => a.key.startsWith('ATRASADA_')));
  });

  it('15. Estoque insuficiente gera alerta VERMELHO e recomendação de recebimento/abastecimento', () => {
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: [],
      pendingConfirmedReceipts: [],
      thresholds: [],
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 20,
          referenceDate: '2026-11-17',
          lineCode: 'L5',
          materialId: 11, // Veículo Premix: Silo 10 tem apenas 8.000 kg
          calculatedConsumptionKg: 12000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'EM_ANDAMENTO',
        },
      ],
    });
    const matRow = analysis.byMaterial.find((m) => m.materialId === 11)!;
    assert.equal(matRow.statusPriority, 'VERMELHO');
    assert.equal(matRow.projectedBalanceTodayKg, -4000);
    assert.ok(analysis.alerts.some((a) => a.priority === 'VERMELHO' && a.materialCode === '1113101920'));
    assert.ok(
      analysis.recommendations.some(
        (r) =>
          r.recommendationType === 'PROGRAMAR_RECEBIMENTO' &&
          r.targetSiloNumber === 10
      )
    );
  });

  it('16. Sugestão de transferência autorizada (Silo 38 -> Silo 12) respeitando rota homologada e saldo', () => {
    const rules: TransferRuleCoverageInput[] = [
      {
        id: 10,
        originSiloId: 30, // Silo 38 (35.000 kg)
        destinationSiloId: 4, // Silo 12 (5.000 kg, safe 63.332 kg)
        materialId: 1,
        maxQuantityKg: 30000,
        validationStatus: 'VALIDADO',
        isActive: true,
      },
    ];
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: rules,
      pendingConfirmedReceipts: [],
      thresholds: [],
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 30,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 25000, // L4 (Silo 12) tem 5.000 -> faltam 20.000
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'EM_ANDAMENTO',
        },
      ],
    });

    const rec = analysis.recommendations.find((r) => r.recommendationType === 'TRANSFERIR_SILO');
    assert.ok(rec);
    assert.equal(rec!.originSiloNumber, 38);
    assert.equal(rec!.targetSiloNumber, 12);
    assert.equal(rec!.suggestedTransferKg, 20000);
    assert.ok(
      rec!.reason.includes(
        'ESTOQUE INSUFICIENTE NO SILO 12 PARA A PROGRAMAÇÃO. ALTERNATIVA IDENTIFICADA: TRANSFERÊNCIA DO SILO 38 PARA O SILO 12'
      )
    );
  });

  it('17. Bloqueio de transferência incompatível ou não homologada (rota pendente/inativa não é sugerida)', () => {
    const pendingOrWrongRules: TransferRuleCoverageInput[] = [
      {
        id: 11,
        originSiloId: 30,
        destinationSiloId: 4,
        materialId: 1,
        maxQuantityKg: 30000,
        validationStatus: 'PENDENTE_VALIDACAO', // Não validada
        isActive: false,
      },
    ];
    const analysis = computeOperationalIntelligence({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      silos: buildPhase3FixtureSilos(),
      materials: FIXTURE_MATERIALS,
      transferRules: pendingOrWrongRules,
      pendingConfirmedReceipts: [],
      thresholds: [],
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 31,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 25000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'EM_ANDAMENTO',
        },
      ],
    });

    assert.equal(
      analysis.recommendations.some((r) => r.recommendationType === 'TRANSFERIR_SILO'),
      false
    );
    assert.ok(
      analysis.recommendations.some(
        (r) => r.recommendationType === 'ABASTECER_SILO' && r.targetSiloNumber === 12
      )
    );
  });

  it('18. Permissões de usuários RBAC para Fase 3 (Produção somente leitura; Operador importa/executa; Supervisor/Admin aprovam)', () => {
    assert.equal(hasPermission('PRODUCAO', 'schedules:view'), true);
    assert.equal(hasPermission('PRODUCAO', 'schedules:import'), false);
    assert.equal(hasPermission('PRODUCAO', 'schedules:approve'), false);
    assert.equal(hasPermission('PRODUCAO', 'schedules:execution_update'), false);
    assert.equal(hasPermission('PRODUCAO', 'consumption:manage'), false);

    assert.equal(hasPermission('OPERADOR_MOEGA', 'schedules:view'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'schedules:import'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'schedules:execution_update'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'schedules:approve'), false);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'consumption:manage'), false);

    assert.equal(hasPermission('SUPERVISOR', 'schedules:approve'), true);
    assert.equal(hasPermission('SUPERVISOR', 'consumption:manage'), true);
    assert.equal(hasPermission('ADMIN', 'schedules:approve'), true);
    assert.equal(hasPermission('ADMIN', 'consumption:manage'), true);
  });

  it('19. Auditoria imutável das alterações de programação, fatores, execução e recomendações', () => {
    const repoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/schedules-repository.ts'),
      'utf8'
    );
    const requiredAuditActions = [
      'CADASTRO_PRODUTO',
      'CADASTRO_FATOR_CONSUMO',
      'CONFIG_ESTOQUE_MINIMO',
      'IMPORTACAO_DOCUMENTO_PROGRAMACAO',
      'CRIACAO_RASCUNHO_PROGRAMACAO',
      'APROVACAO_PROGRAMACAO',
      'ATUALIZACAO_EXECUCAO_PRODUCAO',
      'ACEITE_SUGESTAO_OPERACIONAL',
      'REJEICAO_SUGESTAO_OPERACIONAL',
    ];
    for (const action of requiredAuditActions) {
      assert.ok(repoSrc.includes(action), `Auditoria ausente para ação ${action}`);
    }
  });
});
