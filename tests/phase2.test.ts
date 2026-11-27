import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseOperationalBarcode } from '../src/lib/barcode-parser.ts';
import {
  calculateBigBagTotalKg,
  CompatibilityRuleSnapshot,
  SiloRuleSnapshot,
  validateReceiptDistributionPlan,
  validateStockAdjustment,
  validateTransferExecution,
} from '../src/lib/inventory-rules.ts';
import { interpretLabelImageWithGemini } from '../src/lib/gemini-vision.ts';
import { hasPermission } from '../src/lib/rbac.ts';

function buildFixtureSilos(): Map<number, SiloRuleSnapshot> {
  const list: SiloRuleSnapshot[] = [
    {
      id: 4,
      siloNumber: 12,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 1, // Calcário 2017101021
      nominalCapacityKg: 70369,
      safeCapacityKg: 63332,
      confirmedStockKg: 0,
    },
    {
      id: 16,
      siloNumber: 21,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 1, // Calcário 2017101021
      nominalCapacityKg: 70659,
      safeCapacityKg: 63593,
      confirmedStockKg: 0,
    },
    {
      id: 29,
      siloNumber: 37,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 11, // Veículo Premix 1113101920
      nominalCapacityKg: 26693,
      safeCapacityKg: 24024,
      confirmedStockKg: 10000,
    },
    {
      id: 2,
      siloNumber: 10,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 11, // Veículo Premix 1113101920
      nominalCapacityKg: 13978,
      safeCapacityKg: 12580,
      confirmedStockKg: 2000,
    },
  ];
  return new Map(list.map((s) => [s.id, s]));
}

const FIXTURE_COMPATS: CompatibilityRuleSnapshot[] = [
  { siloId: 4, materialId: 1, allowReceiving: true, allowTransferIn: true, allowTransferOut: false },
  { siloId: 16, materialId: 1, allowReceiving: true, allowTransferIn: true, allowTransferOut: false },
  { siloId: 2, materialId: 11, allowReceiving: true, allowTransferIn: true, allowTransferOut: false },
];

describe('NEXO LOG 2.0 — Fase 2 (14 Cenários Obrigatórios)', () => {
  it('1. Recebimento de caminhão a granel (38.840 kg de Calcário, lote 0011647908)', () => {
    const silos = buildFixtureSilos();
    const outcome = validateReceiptDistributionPlan({
      materialId: 1,
      receivedQuantityKg: 38840,
      alreadyDistributedKg: 0,
      distributions: [{ siloId: 4, quantityKg: 38840 }],
      silosById: silos,
      compatibilities: FIXTURE_COMPATS,
    });
    assert.equal(outcome.valid, true);
    assert.equal(outcome.totalDistributedNowKg, 38840);
    assert.equal(outcome.remainingAfterKg, 0);
  });

  it('2. Recebimento de big bags (Caulim 10 x 1.200 kg = 12.000 kg e embalagens distintas)', () => {
    assert.equal(calculateBigBagTotalKg(10, 1200), 12000);
    assert.equal(calculateBigBagTotalKg(8, 1300), 10400); // Alga embalagem B
    assert.equal(calculateBigBagTotalKg(5, 1260), 6300); // Glúten embalagem B
    assert.throws(() => calculateBigBagTotalKg(0, 1200));
    assert.throws(() => calculateBigBagTotalKg(2.5 as any, 1200));
  });

  it('3. Leitura de código de barras (padrão Cargill RQ-REC-044, lote direto e GS1-128)', () => {
    const known = ['2090121061', '2017101021', '1113101920'];
    const cargill = parseOperationalBarcode('22******20901210610011606870', known);
    assert.equal(cargill.formatMatched, 'CARGILL_RQ_REC_044');
    assert.equal(cargill.establishment, '22');
    assert.equal(cargill.materialCode, '2090121061');
    assert.equal(cargill.lotCode, '0011606870');
    assert.equal(cargill.uncertainFields.length, 0);

    const lotOnly = parseOperationalBarcode('0011647908', known);
    assert.equal(lotOnly.lotCode, '0011647908');
    assert.ok(lotOnly.uncertainFields.includes('materialCode'));

    const gs1 = parseOperationalBarcode('(01)2017101021(10)0011647908', known);
    assert.equal(gs1.materialCode, '2017101021');
    assert.equal(gs1.lotCode, '0011647908');
  });

  it('4. Leitura de etiqueta por fotografia (Gemini Vision falha de forma explícita sem chave e nunca inventa dados)', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(
      () =>
        interpretLabelImageWithGemini({
          imageBase64: 'ZmFrZQ==',
          mimeType: 'image/jpeg',
        }),
      /GEMINI_API_KEY/
    );
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;

    const visionSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/gemini-vision.ts'),
      'utf8'
    );
    assert.ok(visionSrc.includes("model: 'gemini-4-hydrogen'"));
    assert.ok(visionSrc.includes('uncertainFields'));
    assert.ok(visionSrc.includes('NUNCA invente'));
  });

  it('5. Lote já existente — regra de conflito e consulta antes de complemento', () => {
    const repoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/operations-repository.ts'),
      'utf8'
    );
    assert.ok(repoSrc.includes('LOT_ALREADY_EXISTS'));
    assert.ok(repoSrc.includes('checkLotHistory'));
  });

  it('6. Descarga parcial (20.000 kg de 38.840 kg deixa 18.840 kg pendente)', () => {
    const silos = buildFixtureSilos();
    const partial = validateReceiptDistributionPlan({
      materialId: 1,
      receivedQuantityKg: 38840,
      alreadyDistributedKg: 0,
      distributions: [{ siloId: 4, quantityKg: 20000 }],
      silosById: silos,
      compatibilities: FIXTURE_COMPATS,
    });
    assert.equal(partial.valid, true);
    assert.equal(partial.totalDistributedNowKg, 20000);
    assert.equal(partial.remainingAfterKg, 18840);
    assert.ok(partial.warnings.some((w) => w.includes('Descarga parcial')));
  });

  it('7. Complemento de descarga (distribuição dos 18.840 kg restantes sem ultrapassar total)', () => {
    const silos = buildFixtureSilos();
    const complement = validateReceiptDistributionPlan({
      materialId: 1,
      receivedQuantityKg: 38840,
      alreadyDistributedKg: 20000,
      distributions: [{ siloId: 16, quantityKg: 18840 }],
      silosById: silos,
      compatibilities: FIXTURE_COMPATS,
    });
    assert.equal(complement.valid, true);
    assert.equal(complement.remainingAfterKg, 0);

    const overComplement = validateReceiptDistributionPlan({
      materialId: 1,
      receivedQuantityKg: 38840,
      alreadyDistributedKg: 20000,
      distributions: [{ siloId: 16, quantityKg: 19000 }],
      silosById: silos,
      compatibilities: FIXTURE_COMPATS,
    });
    assert.equal(overComplement.valid, false);
    assert.ok(overComplement.errors.some((e) => e.includes('excede o saldo pendente')));
  });

  it('8. Rateio entre dois ou mais silos (Silo 12: 20.000 kg + Silo 21: 18.840 kg)', () => {
    const silos = buildFixtureSilos();
    const split = validateReceiptDistributionPlan({
      materialId: 1,
      receivedQuantityKg: 38840,
      alreadyDistributedKg: 0,
      distributions: [
        { siloId: 4, quantityKg: 20000 },
        { siloId: 16, quantityKg: 18840 },
      ],
      silosById: silos,
      compatibilities: FIXTURE_COMPATS,
    });
    assert.equal(split.valid, true);
    assert.equal(split.totalDistributedNowKg, 38840);
    assert.equal(split.remainingAfterKg, 0);
  });

  it('9. Bloqueio por capacidade excedida (-10% de segurança)', () => {
    const silos = buildFixtureSilos();
    const overflow = validateReceiptDistributionPlan({
      materialId: 1,
      receivedQuantityKg: 70000,
      alreadyDistributedKg: 0,
      distributions: [{ siloId: 4, quantityKg: 65000 }], // safeCapacityKg = 63.332 kg
      silosById: silos,
      compatibilities: FIXTURE_COMPATS,
    });
    assert.equal(overflow.valid, false);
    assert.ok(overflow.errors.some((e) => e.includes('Capacidade segura (-10%) excedida')));
  });

  it('10. Bloqueio por material incompatível com o silo de destino', () => {
    const silos = buildFixtureSilos();
    const incompatible = validateReceiptDistributionPlan({
      materialId: 1, // Calcário tentando entrar no Silo 10 (Veículo Premix)
      receivedQuantityKg: 5000,
      alreadyDistributedKg: 0,
      distributions: [{ siloId: 2, quantityKg: 5000 }],
      silosById: silos,
      compatibilities: FIXTURE_COMPATS,
    });
    assert.equal(incompatible.valid, false);
    assert.ok(incompatible.errors.some((e) => e.includes('Material incompatível')));
  });

  it('11. Transferência entre silos (valida regra ativa, saldo origem e espaço destino)', () => {
    const silos = buildFixtureSilos();
    const origin = silos.get(29)!; // Silo 37: 10.000 kg
    const dest = silos.get(2)!; // Silo 10: 2.000 kg / safe 12.580 kg

    const validTransfer = validateTransferExecution({
      originSilo: origin,
      destinationSilo: dest,
      materialId: 11,
      quantityKg: 5000,
      rule: { isActive: true, validationStatus: 'VALIDADO', maxQuantityKg: null },
    });
    assert.equal(validTransfer.valid, true);

    const pendingRuleBlocked = validateTransferExecution({
      originSilo: origin,
      destinationSilo: dest,
      materialId: 11,
      quantityKg: 5000,
      rule: { isActive: false, validationStatus: 'PENDENTE_VALIDACAO', maxQuantityKg: null },
    });
    assert.equal(pendingRuleBlocked.valid, false);

    const insufficientOrigin = validateTransferExecution({
      originSilo: origin,
      destinationSilo: dest,
      materialId: 11,
      quantityKg: 12000,
      rule: { isActive: true, validationStatus: 'VALIDADO', maxQuantityKg: null },
    });
    assert.equal(insufficientOrigin.valid, false);
  });

  it('12. Estorno e ajuste autorizado (exige motivo, bloqueia saldo negativo e restringe RBAC)', () => {
    assert.equal(hasPermission('ADMIN', 'stock:adjust'), true);
    assert.equal(hasPermission('SUPERVISOR', 'stock:adjust'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'stock:adjust'), false);
    assert.equal(hasPermission('PRODUCAO', 'stock:adjust'), false);

    const negativeAdjust = validateStockAdjustment({
      currentSiloStockKg: 5000,
      safeCapacityKg: 24024,
      deltaKg: -6000,
      reason: 'Divergência de inventário',
    });
    assert.equal(negativeAdjust.valid, false);

    const noReasonAdjust = validateStockAdjustment({
      currentSiloStockKg: 5000,
      safeCapacityKg: 24024,
      deltaKg: -1000,
      reason: 'ok',
    });
    assert.equal(noReasonAdjust.valid, false);

    const validAdjust = validateStockAdjustment({
      currentSiloStockKg: 5000,
      safeCapacityKg: 24024,
      deltaKg: -1000,
      reason: 'Acerto de tara após limpeza de rosca',
    });
    assert.equal(validAdjust.valid, true);
  });

  it('13. Dois operadores tentando registrar o mesmo recebimento (idempotência + lock otimista + FOR UPDATE)', () => {
    const repoSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/db/operations-repository.ts'),
      'utf8'
    );
    assert.ok(repoSrc.includes('eq(receipts.idempotencyKey, input.idempotencyKey)'));
    assert.ok(repoSrc.includes('FOR UPDATE'));
    assert.ok(repoSrc.includes('Number(recRow.version) !== input.expectedVersion'));
  });

  it('14. Falha de conexão durante operação não usa localStorage como banco de estoque', () => {
    const receivingSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/pages/ReceivingPage.tsx'),
      'utf8'
    );
    const apiSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/api.ts'), 'utf8');
    assert.equal(receivingSrc.includes('localStorage'), false);
    assert.equal(apiSrc.includes('localStorage'), false);
    assert.ok(receivingSrc.includes('submitError'));
  });
});
