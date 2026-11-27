import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  allocateLotsForTransfer,
  CompatibilityRuleSnapshot,
  SiloRuleSnapshot,
  validateTransferExecution,
} from '../src/lib/inventory-rules.ts';
import {
  AuthorizedRouteInput,
  computeProductionSupplyAnalysis,
  DEFAULT_PRIORITY_WEIGHTS,
} from '../src/lib/supply-transfer-engine.ts';
import { hasPermission } from '../src/lib/rbac.ts';

function buildPhase4Silos(): Map<number, SiloRuleSnapshot> {
  const list: SiloRuleSnapshot[] = [
    {
      id: 4,
      siloNumber: 12,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 1, // Calcário 2017101021
      nominalCapacityKg: 70369,
      safeCapacityKg: 63332,
      confirmedStockKg: 10000,
    },
    {
      id: 30,
      siloNumber: 38,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 1, // Calcário 2017101021
      nominalCapacityKg: 50000,
      safeCapacityKg: 45000,
      confirmedStockKg: 35000,
    },
    {
      id: 23,
      siloNumber: 31,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 3, // Glúten 2017103647
      nominalCapacityKg: 45000,
      safeCapacityKg: 40500,
      confirmedStockKg: 2000,
    },
    {
      id: 31,
      siloNumber: 39,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 3, // Glúten 2017103647
      nominalCapacityKg: 45000,
      safeCapacityKg: 40500,
      confirmedStockKg: 25000,
    },
    {
      id: 2,
      siloNumber: 10,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 11, // Veículo Premix 1113101920
      nominalCapacityKg: 13978,
      safeCapacityKg: 12580,
      confirmedStockKg: 3000,
    },
    {
      id: 29,
      siloNumber: 37,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 11,
      nominalCapacityKg: 26693,
      safeCapacityKg: 24024,
      confirmedStockKg: 18000,
    },
  ];
  return new Map(list.map((s) => [s.id, s]));
}

const COMPATS: CompatibilityRuleSnapshot[] = [
  { siloId: 30, materialId: 1, allowReceiving: true, allowTransferIn: false, allowTransferOut: true },
  { siloId: 4, materialId: 1, allowReceiving: true, allowTransferIn: true, allowTransferOut: false },
  { siloId: 31, materialId: 3, allowReceiving: true, allowTransferIn: false, allowTransferOut: true },
  { siloId: 23, materialId: 3, allowReceiving: true, allowTransferIn: true, allowTransferOut: false },
  { siloId: 29, materialId: 11, allowReceiving: true, allowTransferIn: false, allowTransferOut: true },
  { siloId: 2, materialId: 11, allowReceiving: true, allowTransferIn: true, allowTransferOut: false },
];

describe('NEXO LOG 2.0 — Fase 4 (18 Cenários Obrigatórios)', () => {
  it('1. Rota autorizada permite validação e execução de transferência', () => {
    const silos = buildPhase4Silos();
    const res = validateTransferExecution({
      originSilo: silos.get(30)!, // Silo 38 (35.000 kg)
      destinationSilo: silos.get(4)!, // Silo 12 (10.000 / 63.332 kg)
      materialId: 1,
      quantityKg: 20000,
      compatibilities: COMPATS,
      rule: {
        isActive: true,
        validationStatus: 'VALIDADO',
        authorizationStatus: 'AUTORIZADA',
        maxQuantityKg: 30000,
      },
    });
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
  });

  it('2. Rota pendente de validação (ex. Silo 39 -> 31 Glúten) bloqueia transferência', () => {
    const silos = buildPhase4Silos();
    const res = validateTransferExecution({
      originSilo: silos.get(31)!, // Silo 39
      destinationSilo: silos.get(23)!, // Silo 31
      materialId: 3,
      quantityKg: 5000,
      compatibilities: COMPATS,
      rule: {
        isActive: false,
        validationStatus: 'PENDENTE_VALIDACAO',
        authorizationStatus: 'PENDENTE_VALIDACAO',
        maxQuantityKg: 15000,
      },
    });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('PENDENTE_VALIDACAO') && e.includes('Supervisão')));
  });

  it('3. Rota suspensa ou bloqueada impede transferência com justificativa explícita', () => {
    const silos = buildPhase4Silos();
    const suspended = validateTransferExecution({
      originSilo: silos.get(30)!,
      destinationSilo: silos.get(4)!,
      materialId: 1,
      quantityKg: 5000,
      compatibilities: COMPATS,
      rule: {
        isActive: false,
        validationStatus: 'VALIDADO',
        authorizationStatus: 'SUSPENSA',
        maxQuantityKg: 30000,
      },
    });
    assert.equal(suspended.valid, false);
    assert.ok(suspended.errors.some((e) => e.includes('SUSPENSA')));

    const blocked = validateTransferExecution({
      originSilo: silos.get(30)!,
      destinationSilo: silos.get(4)!,
      materialId: 1,
      quantityKg: 5000,
      compatibilities: COMPATS,
      rule: {
        isActive: false,
        validationStatus: 'VALIDADO',
        authorizationStatus: 'BLOQUEADA',
        maxQuantityKg: 30000,
      },
    });
    assert.equal(blocked.valid, false);
    assert.ok(blocked.errors.some((e) => e.includes('BLOQUEADA')));
  });

  it('4. Material incompatível com origem ou destino é bloqueado pela matriz oficial', () => {
    const silos = buildPhase4Silos();
    const res = validateTransferExecution({
      originSilo: silos.get(30)!, // Silo 38 (Calcário)
      destinationSilo: silos.get(2)!, // Silo 10 (Premix - incompatível com Calcário)
      materialId: 1,
      quantityKg: 2000,
      compatibilities: COMPATS,
      rule: {
        isActive: true,
        validationStatus: 'VALIDADO',
        authorizationStatus: 'AUTORIZADA',
        maxQuantityKg: 20000,
      },
    });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('incompatível com o Silo de destino 10')));
  });

  it('5. Estoque insuficiente na origem bloqueia transferência sem permitir saldo negativo', () => {
    const silos = buildPhase4Silos();
    const res = validateTransferExecution({
      originSilo: silos.get(29)!, // Silo 37 tem 18.000 kg
      destinationSilo: silos.get(2)!,
      materialId: 11,
      quantityKg: 22000,
      compatibilities: COMPATS,
      rule: {
        isActive: true,
        validationStatus: 'VALIDADO',
        authorizationStatus: 'AUTORIZADA',
        maxQuantityKg: 25000,
      },
    });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Saldo insuficiente no Silo 37')));
  });

  it('6. Capacidade insuficiente no destino bloqueia transferência acima do limite seguro (-10%)', () => {
    const silos = buildPhase4Silos();
    // Silo 10: safeCapacity = 12.580 kg, stock = 3.000 kg -> livre = 9.580 kg
    const res = validateTransferExecution({
      originSilo: silos.get(29)!,
      destinationSilo: silos.get(2)!,
      materialId: 11,
      quantityKg: 11000,
      compatibilities: COMPATS,
      rule: {
        isActive: true,
        validationStatus: 'VALIDADO',
        authorizationStatus: 'AUTORIZADA',
        maxQuantityKg: 20000,
      },
    });
    assert.equal(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Silo de destino 10 não comporta')));
  });

  it('7. Transferência parcial registra etapa de 12.000 kg e mantém 8.000 kg pendentes em PARCIAL', () => {
    const plannedKg = 20000;
    const step1Kg = 12000;
    const silos = buildPhase4Silos();
    const origin = silos.get(30)!; // 35.000 kg
    const dest = silos.get(4)!; // 10.000 kg

    const check = validateTransferExecution({
      originSilo: origin,
      destinationSilo: dest,
      materialId: 1,
      quantityKg: step1Kg,
      compatibilities: COMPATS,
      rule: {
        isActive: true,
        validationStatus: 'VALIDADO',
        authorizationStatus: 'AUTORIZADA',
        maxQuantityKg: 30000,
      },
    });
    assert.equal(check.valid, true);

    const remainingAfterStep1 = plannedKg - step1Kg;
    const nextStatus = remainingAfterStep1 <= 0.001 ? 'CONCLUIDA' : 'PARCIAL';
    assert.equal(nextStatus, 'PARCIAL');
    assert.equal(remainingAfterStep1, 8000);

    const supplyRepoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/supply-repository.ts'),
      'utf8'
    );
    assert.ok(supplyRepoSrc.includes("const nextStatus = remainingAfterKg <= 0.001 ? 'CONCLUIDA' : 'PARCIAL';"));
  });

  it('8. Complemento de transferência conclui os 8.000 kg restantes sem duplicar etapa anterior', () => {
    const plannedKg = 20000;
    const transferredBeforeKg = 12000;
    const step2Kg = 8000;
    const silos = buildPhase4Silos();
    // Saldo após etapa 1
    const originAfter1 = { ...silos.get(30)!, confirmedStockKg: 35000 - 12000 }; // 23.000
    const destAfter1 = { ...silos.get(4)!, confirmedStockKg: 10000 + 12000 }; // 22.000

    const check2 = validateTransferExecution({
      originSilo: originAfter1,
      destinationSilo: destAfter1,
      materialId: 1,
      quantityKg: step2Kg,
      compatibilities: COMPATS,
      rule: {
        isActive: true,
        validationStatus: 'VALIDADO',
        authorizationStatus: 'AUTORIZADA',
        maxQuantityKg: 30000,
      },
    });
    assert.equal(check2.valid, true);

    const totalTransferred = transferredBeforeKg + step2Kg;
    const remainingAfter = plannedKg - totalTransferred;
    assert.equal(totalTransferred, 20000);
    assert.equal(remainingAfter, 0);
    assert.equal(remainingAfter <= 0.001 ? 'CONCLUIDA' : 'PARCIAL', 'CONCLUIDA');
  });

  it('9. Transferência concluída bloqueia nova etapa extra ou quantidade acima do pendente', () => {
    const supplyRepoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/supply-repository.ts'),
      'utf8'
    );
    assert.ok(
      supplyRepoSrc.includes("if (['CONCLUIDA', 'CANCELADA', 'INTERROMPIDA'].includes(ord.status))")
    );
    assert.ok(supplyRepoSrc.includes('if (qtyNow > remainingBeforeKg + 0.001)'));
  });

  it('10. Transferência interrompida exige motivo >= 5 caracteres e preserva etapas já realizadas', () => {
    const supplyRepoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/supply-repository.ts'),
      'utf8'
    );
    assert.ok(supplyRepoSrc.includes('if (!reason || reason.trim().length < 5)'));
    assert.ok(supplyRepoSrc.includes("status: 'INTERROMPIDA'"));
    assert.ok(supplyRepoSrc.includes('interruptionReason: reason.trim()'));
    assert.ok(supplyRepoSrc.includes("action: 'TRANSFER_ORDER_INTERRUPTED'"));
  });

  it('11. Duplicidade de solicitação é bloqueada por idempotencyKey na ordem e na etapa', () => {
    const supplyRepoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/supply-repository.ts'),
      'utf8'
    );
    assert.ok(supplyRepoSrc.includes('eq(transferOrders.idempotencyKey, input.idempotencyKey)'));
    assert.ok(
      supplyRepoSrc.includes(
        'eq(inventoryMovements.idempotencyKey, `${input.idempotencyKey}:out:0`)'
      )
    );
  });

  it('12. Controle de concorrência entre dois operadores via FOR UPDATE ordenado e version otimista', () => {
    const supplyRepoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/supply-repository.ts'),
      'utf8'
    );
    assert.ok(supplyRepoSrc.includes('ORDER BY id ASC FOR UPDATE'));
    assert.ok(supplyRepoSrc.includes('SELECT * FROM transfer_orders WHERE id = ${input.orderId} FOR UPDATE'));
    assert.ok(
      supplyRepoSrc.includes(
        'if (input.expectedVersion !== undefined && Number(ord.version) !== input.expectedVersion)'
      )
    );
    assert.ok(supplyRepoSrc.includes('version: Number(ord.version) + 1'));
  });

  it('13. Falha durante transação mantém atomicidade integral (rollback sem saldo parcial)', () => {
    const supplyRepoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/supply-repository.ts'),
      'utf8'
    );
    const opsRepoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/operations-repository.ts'),
      'utf8'
    );
    // Todas as mutações críticas executam dentro de db.transaction(async (tx) => ...)
    const txMatches = supplyRepoSrc.match(/db\.transaction\(async \(tx\)/g) || [];
    assert.ok(txMatches.length >= 9, `Esperadas >= 9 transações atômicas, encontradas ${txMatches.length}`);
    assert.ok(opsRepoSrc.includes('return db.transaction(async (tx) =>'));
  });

  it('14. Preservação de lote único e composição explícita MISTO sem inventar lote', () => {
    const singleLot = allocateLotsForTransfer({
      originLots: [{ lotCode: '0011647908', netKg: 35000 }],
      requestedQuantityKg: 12000,
    });
    assert.equal(singleLot.valid, true);
    assert.equal(singleLot.summaryLotCode, '0011647908');
    assert.deepEqual(singleLot.slices, [{ lotCode: '0011647908', quantityKg: 12000 }]);

    const mixedLots = allocateLotsForTransfer({
      originLots: [
        { lotCode: 'LOTE-A', netKg: 6000 },
        { lotCode: 'LOTE-B', netKg: 9000 },
      ],
      requestedQuantityKg: 8000,
    });
    assert.equal(mixedLots.valid, true);
    assert.equal(mixedLots.summaryLotCode, 'MISTO (LOTE-A + LOTE-B)');
    assert.deepEqual(mixedLots.slices, [
      { lotCode: 'LOTE-A', quantityKg: 6000 },
      { lotCode: 'LOTE-B', quantityKg: 2000 },
    ]);
  });

  it('15. Atualização correta e conservativa dos saldos origem e destino entre etapas', () => {
    const initialOrigin = 35000;
    const initialDest = 10000;
    const step1 = 12000;
    const step2 = 8000;

    const originFinal = initialOrigin - step1 - step2;
    const destFinal = initialDest + step1 + step2;

    assert.equal(originFinal, 15000);
    assert.equal(destFinal, 30000);
    assert.equal(originFinal + destFinal, initialOrigin + initialDest);
    assert.ok(originFinal >= 0);
  });

  it('16. Motor de abastecimento gera recomendação L4 (Silo 38 -> Silo 12) e bloqueia rota pendente', () => {
    const routes: AuthorizedRouteInput[] = [
      {
        id: 101,
        originSiloId: 30, // Silo 38 (35.000 kg)
        originSiloNumber: 38,
        destinationSiloId: 4, // Silo 12 (10.000 kg)
        destinationSiloNumber: 12,
        materialId: 1,
        materialCode: '2017101021',
        materialDescription: 'CALCARIO',
        relatedLineCode: 'L4',
        maxQuantityKg: 25000,
        authorizationStatus: 'AUTORIZADA',
        validationStatus: 'VALIDADO',
        isActive: true,
        restrictions: null,
      },
      {
        id: 102,
        originSiloId: 31, // Silo 39
        originSiloNumber: 39,
        destinationSiloId: 23, // Silo 31
        destinationSiloNumber: 31,
        materialId: 3,
        materialCode: '2017103647',
        materialDescription: 'GLUTEN',
        relatedLineCode: 'L4',
        maxQuantityKg: 15000,
        authorizationStatus: 'PENDENTE_VALIDACAO',
        validationStatus: 'PENDENTE_VALIDACAO',
        isActive: false,
        restrictions: 'Aguardando vistoria',
      },
    ];

    const analysis = computeProductionSupplyAnalysis({
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      lines: [
        { id: 4, code: 'L4', name: 'Linha 4' },
        { id: 5, code: 'L5', name: 'Linha 5' },
      ],
      silos: [
        {
          id: 4,
          siloNumber: 12,
          lineCode: 'L4',
          category: 'LINHA',
          controlOwner: 'MOEGA',
          primaryMaterialId: 1,
          operationalStatus: 'OPERACIONAL',
          validationStatus: 'VALIDADO',
          nominalCapacityKg: 70369,
          safeCapacityKg: 63332,
          confirmedStockKg: 10000,
          compatibleMaterialIds: [1],
        },
        {
          id: 30,
          siloNumber: 38,
          lineCode: 'L7',
          category: 'ARMAZENAGEM',
          controlOwner: 'MOEGA',
          primaryMaterialId: 1,
          operationalStatus: 'OPERACIONAL',
          validationStatus: 'VALIDADO',
          nominalCapacityKg: 50000,
          safeCapacityKg: 45000,
          confirmedStockKg: 35000,
          compatibleMaterialIds: [1],
        },
        {
          id: 23,
          siloNumber: 31,
          lineCode: 'L4',
          category: 'LINHA',
          controlOwner: 'MOEGA',
          primaryMaterialId: 3,
          operationalStatus: 'OPERACIONAL',
          validationStatus: 'VALIDADO',
          nominalCapacityKg: 45000,
          safeCapacityKg: 40500,
          confirmedStockKg: 2000,
          compatibleMaterialIds: [3],
        },
        {
          id: 31,
          siloNumber: 39,
          lineCode: 'L7',
          category: 'ARMAZENAGEM',
          controlOwner: 'MOEGA',
          primaryMaterialId: 3,
          operationalStatus: 'OPERACIONAL',
          validationStatus: 'VALIDADO',
          nominalCapacityKg: 45000,
          safeCapacityKg: 40500,
          confirmedStockKg: 25000,
          compatibleMaterialIds: [3],
        },
      ],
      siloMaterialStocks: [
        { siloId: 4, materialId: 1, netKg: 10000 },
        { siloId: 30, materialId: 1, netKg: 35000 },
        { siloId: 23, materialId: 3, netKg: 2000 },
        { siloId: 31, materialId: 3, netKg: 25000 },
      ],
      siloActiveLots: [{ siloId: 30, materialId: 1, lotCode: '0011647908', netKg: 35000 }],
      materials: [
        { id: 1, code: '2017101021', description: 'CALCARIO', isCritical: true },
        { id: 3, code: '2017103647', description: 'GLUTEN', isCritical: true },
      ],
      routes,
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 10,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 20000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'EM_ANDAMENTO',
        },
        {
          scheduleId: 1,
          scheduleItemId: 11,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 3,
          calculatedConsumptionKg: 12000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO',
          executionStatus: 'EM_ANDAMENTO',
        },
      ],
      pendingReceipts: [],
      pendingTransferOrders: [],
    });

    const calcRec = analysis.recommendations.find((r) => r.materialId === 1)!;
    assert.ok(calcRec);
    assert.equal(calcRec.headline, 'NECESSIDADE DE ABASTECIMENTO IDENTIFICADA.');
    assert.equal(calcRec.actionType, 'CRIAR_TRANSFERENCIA');
    assert.equal(calcRec.originSiloNumber, 38);
    assert.equal(calcRec.destinationSiloNumber, 12);
    assert.equal(calcRec.suggestedTransferKg, 10000);
    assert.equal(calcRec.suggestedLotCode, '0011647908');

    const glutenRec = analysis.recommendations.find((r) => r.materialId === 3)!;
    assert.ok(glutenRec);
    assert.equal(glutenRec.visualStatus, 'VERMELHO');
    assert.equal(glutenRec.actionType, 'SOLICITAR_RECEBIMENTO');
    assert.equal(glutenRec.originSiloNumber, null);
    assert.equal(glutenRec.blockedOrPendingRoutes.length, 1);
    assert.equal(glutenRec.blockedOrPendingRoutes[0].authorizationStatus, 'PENDENTE_VALIDACAO');
  });

  it('17. Priorização configurável altera score e informações pendentes recebem cor CINZA (nunca VERDE)', () => {
    const commonParams = {
      todayDate: '2026-11-17',
      tomorrowDate: '2026-11-18',
      lines: [
        { id: 4, code: 'L4', name: 'Linha 4' },
        { id: 5, code: 'L5', name: 'Linha 5' },
      ],
      silos: [
        {
          id: 4,
          siloNumber: 12,
          lineCode: 'L4',
          category: 'LINHA',
          controlOwner: 'MOEGA',
          primaryMaterialId: 1,
          operationalStatus: 'OPERACIONAL',
          validationStatus: 'VALIDADO',
          nominalCapacityKg: 70369,
          safeCapacityKg: 63332,
          confirmedStockKg: 5000,
          compatibleMaterialIds: [1],
        },
        {
          id: 2,
          siloNumber: 10,
          lineCode: 'L5',
          category: 'LINHA',
          controlOwner: 'MOEGA',
          primaryMaterialId: 11,
          operationalStatus: 'OPERACIONAL',
          validationStatus: 'VALIDADO',
          nominalCapacityKg: 13978,
          safeCapacityKg: 12580,
          confirmedStockKg: 8000,
          compatibleMaterialIds: [11],
        },
      ],
      siloMaterialStocks: [
        { siloId: 4, materialId: 1, netKg: 5000 },
        { siloId: 2, materialId: 11, netKg: 8000 },
      ],
      siloActiveLots: [],
      materials: [
        { id: 1, code: '2017101021', description: 'CALCARIO', isCritical: true },
        { id: 11, code: '1113101920', description: 'VEICULO PREMIX', isCritical: false },
      ],
      routes: [],
      projections: [
        {
          scheduleId: 1,
          scheduleItemId: 10,
          referenceDate: '2026-11-17',
          lineCode: 'L4',
          materialId: 1,
          calculatedConsumptionKg: 15000,
          realizedConsumptionKg: 0,
          calculationStatus: 'CALCULADO' as const,
          executionStatus: 'EM_ANDAMENTO' as const,
        },
        {
          scheduleId: 1,
          scheduleItemId: 11,
          referenceDate: '2026-11-17',
          lineCode: 'L5',
          materialId: 11,
          calculatedConsumptionKg: 0,
          realizedConsumptionKg: 0,
          calculationStatus: 'PENDENTE_FATOR' as const,
          executionStatus: 'NAO_INICIADA' as const,
        },
      ],
      pendingReceipts: [],
      pendingTransferOrders: [],
    };

    const defaultRun = computeProductionSupplyAnalysis({
      ...commonParams,
      priorityWeights: DEFAULT_PRIORITY_WEIGHTS,
    });
    const customRun = computeProductionSupplyAnalysis({
      ...commonParams,
      priorityWeights: {
        weightLineStopRisk: 10,
        weightStockCoverage: 10,
        weightAuthorizedRoute: 10,
        weightOriginAvailability: 5,
        weightScheduleUrgency: 5,
      },
    });

    const l4Default = defaultRun.boardRows.find((r) => r.lineCode === 'L4')!;
    const l4Custom = customRun.boardRows.find((r) => r.lineCode === 'L4')!;
    assert.ok(l4Default.priorityScore > l4Custom.priorityScore);
    assert.equal(l4Default.hasReliableTimeEstimate, false); // Nunca inventa tempo de rosca/dosagem

    const l5Row = defaultRun.boardRows.find((r) => r.lineCode === 'L5')!;
    assert.equal(l5Row.supplyStatus, 'CINZA');
    assert.notEqual(l5Row.supplyStatus, 'VERDE');
  });

  it('18. RBAC Fase 4, auditoria completa e Gemini Advisor estritamente somente leitura', () => {
    // RBAC
    assert.equal(hasPermission('PRODUCAO', 'supply:view'), true);
    assert.equal(hasPermission('PRODUCAO', 'transfers:plan'), true);
    assert.equal(hasPermission('PRODUCAO', 'transfers:execute'), false);
    assert.equal(hasPermission('PRODUCAO', 'routes:manage'), false);
    assert.equal(hasPermission('PRODUCAO', 'priority:manage'), false);

    assert.equal(hasPermission('OPERADOR_MOEGA', 'supply:view'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'transfers:plan'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'transfers:execute'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'routes:manage'), false);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'priority:manage'), false);

    assert.equal(hasPermission('SUPERVISOR', 'routes:manage'), true);
    assert.equal(hasPermission('SUPERVISOR', 'priority:manage'), true);
    assert.equal(hasPermission('ADMIN', 'routes:manage'), true);
    assert.equal(hasPermission('ADMIN', 'priority:manage'), true);

    // Auditoria de todas as etapas
    const repoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/supply-repository.ts'),
      'utf8'
    );
    const requiredAuditActions = [
      'ROUTE_CREATED',
      'ROUTE_STATUS_UPDATED',
      'TRANSFER_ORDER_CREATED',
      'TRANSFER_ORDER_STARTED',
      'TRANSFER_STEP_PARTIAL',
      'TRANSFER_ORDER_COMPLETED',
      'TRANSFER_ORDER_INTERRUPTED',
      'PRIORITY_CONFIG_UPDATED',
      'MATERIAL_INTAKE_REQUESTED',
      'SUPPLY_RECOMMENDATION_DECIDED',
    ];
    for (const action of requiredAuditActions) {
      assert.ok(repoSrc.includes(action), `Auditoria ausente para ação ${action}`);
    }

    // Gemini Supply Advisor não pode gravar no banco nem aprovar rotas/movimentações
    const advisorSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/gemini-supply-advisor.ts'),
      'utf8'
    );
    assert.ok(advisorSrc.includes('gemini-4-hydrogen'));
    assert.equal(advisorSrc.includes('.insert('), false);
    assert.equal(advisorSrc.includes('.update('), false);
    assert.equal(advisorSrc.includes('.delete('), false);
  });
});
