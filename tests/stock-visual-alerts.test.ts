import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFeedingSiloChipStatus,
  evaluateSiloStockStatus,
} from '../src/lib/stock-status.ts';

describe('NEXO LOG 2.0 — Indicadores Visuais de Estoque Crítico (Silos e Painel de Abastecimento)', () => {
  it('1. Silo com limite específico configurado entra em CRITICO (vermelho) abaixo do mínimo e ATENCAO (laranja) abaixo do alerta', () => {
    const critico = evaluateSiloStockStatus({
      confirmedStockKg: 1800,
      safeCapacityKg: 18000,
      occupancyPercent: 10,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 1,
      siloThreshold: { minStockKg: 2000, warningStockKg: 5000 },
    });
    assert.equal(critico.stockAlertLevel, 'CRITICO');
    assert.equal(critico.minStockKg, 2000);
    assert.equal(critico.warningStockKg, 5000);
    assert.ok(critico.stockAlertReason?.includes('mínimo crítico'));

    const atencao = evaluateSiloStockStatus({
      confirmedStockKg: 4200,
      safeCapacityKg: 18000,
      occupancyPercent: 23.3,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 1,
      siloThreshold: { minStockKg: 2000, warningStockKg: 5000 },
    });
    assert.equal(atencao.stockAlertLevel, 'ATENCAO');
    assert.ok(atencao.stockAlertReason?.includes('atenção'));

    const normal = evaluateSiloStockStatus({
      confirmedStockKg: 9500,
      safeCapacityKg: 18000,
      occupancyPercent: 52.8,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 1,
      siloThreshold: { minStockKg: 2000, warningStockKg: 5000 },
    });
    assert.equal(normal.stockAlertLevel, 'NORMAL');
  });

  it('2. Limite global da matéria-prima avalia o estoque consolidado sem gerar falso positivo quando o saldo global é saudável', () => {
    const healthyGlobal = evaluateSiloStockStatus({
      confirmedStockKg: 0,
      safeCapacityKg: 20000,
      occupancyPercent: 0,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 2,
      globalThreshold: {
        minStockKg: 5000,
        warningStockKg: 12000,
        totalMaterialStockKg: 28000,
      },
    });
    assert.equal(healthyGlobal.stockAlertLevel, 'NORMAL');

    const criticalGlobal = evaluateSiloStockStatus({
      confirmedStockKg: 1500,
      safeCapacityKg: 20000,
      occupancyPercent: 7.5,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 2,
      globalThreshold: {
        minStockKg: 5000,
        warningStockKg: 12000,
        totalMaterialStockKg: 4500,
      },
    });
    assert.equal(criticalGlobal.stockAlertLevel, 'CRITICO');
    assert.ok(criticalGlobal.stockAlertReason?.includes('Estoque global'));
  });

  it('3. Recomendação ativa do Painel de Abastecimento (VERMELHO / LARANJA) escala o status do silo mesmo sem limite manual', () => {
    const redFromBoard = evaluateSiloStockStatus({
      confirmedStockKg: 0,
      safeCapacityKg: 15000,
      occupancyPercent: 0,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 3,
      activeRecommendationPriority: 'VERMELHO',
      activeRecommendationReason: 'Déficit físico de 8.000 kg na L4 sem transferência disponível.',
    });
    assert.equal(redFromBoard.stockAlertLevel, 'CRITICO');
    assert.ok(redFromBoard.stockAlertReason?.includes('Déficit físico'));

    const orangeFromBoard = evaluateSiloStockStatus({
      confirmedStockKg: 6000,
      safeCapacityKg: 15000,
      occupancyPercent: 40,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 3,
      activeRecommendationPriority: 'LARANJA',
      activeRecommendationReason: 'Transferência Silo 38 -> Silo 12 recomendada.',
    });
    assert.equal(orangeFromBoard.stockAlertLevel, 'ATENCAO');
  });

  it('4. Fallback por ocupação alerta silos movimentados abaixo de 30% (laranja) e 15% (vermelho), mantendo silos vazios ociosos como NORMAL', () => {
    const emptyIdle = evaluateSiloStockStatus({
      confirmedStockKg: 0,
      safeCapacityKg: 15000,
      occupancyPercent: 0,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 4,
    });
    assert.equal(emptyIdle.stockAlertLevel, 'NORMAL');

    const lowRed = evaluateSiloStockStatus({
      confirmedStockKg: 1200,
      safeCapacityKg: 10000,
      occupancyPercent: 12,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 4,
    });
    assert.equal(lowRed.stockAlertLevel, 'CRITICO');

    const lowOrange = evaluateSiloStockStatus({
      confirmedStockKg: 2500,
      safeCapacityKg: 10000,
      occupancyPercent: 25,
      operationalStatus: 'OPERACIONAL',
      primaryMaterialId: 4,
    });
    assert.equal(lowOrange.stockAlertLevel, 'ATENCAO');
  });

  it('5. Chips de silos alimentadores no Painel de Abastecimento refletem corretamente níveis crítico (vermelho) e atenção (laranja)', () => {
    assert.equal(
      evaluateFeedingSiloChipStatus({
        confirmedStockKg: 0,
        safeCapacityKg: 18000,
        parentSupplyStatus: 'VERMELHO',
      }),
      'CRITICO'
    );
    assert.equal(
      evaluateFeedingSiloChipStatus({
        confirmedStockKg: 4000,
        safeCapacityKg: 18000,
        parentSupplyStatus: 'LARANJA',
      }),
      'ATENCAO'
    );
    assert.equal(
      evaluateFeedingSiloChipStatus({
        confirmedStockKg: 12000,
        safeCapacityKg: 18000,
        parentSupplyStatus: 'VERDE',
      }),
      'NORMAL'
    );
  });
});
