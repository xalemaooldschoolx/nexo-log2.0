import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyPresentationBootstrap, createInitialDemoState } from '../src/lib/demo-data.ts';
import { AUTO_FEATURE_MANUALS } from '../src/lib/manual-registry.ts';
import {
  getDemoStateSnapshot,
  handleDemoApiFetch,
  resetDemoSandboxState,
  switchPresentationViewMode,
} from '../src/lib/demo-api.ts';
import type {
  ConsumptionReportResponse,
  DashboardResponse,
  IntelligenceSummaryResponse,
  NexoAssistantResponse,
  OperationalIndicatorsOverview,
  PresentationBootstrapPayload,
  ProductionSupplyBoardResponse,
  ReceivingReportResponse,
  ShiftAutoSummarySnapshot,
  SiloDetail,
  StockAndHistoricalReportResponse,
  TransfersReportResponse,
} from '../src/types/nexo.ts';

describe('Modo Apresentação Executiva — Catálogo Real, Sandbox Isolado e Sincronização PostgreSQL', () => {
  beforeEach(() => {
    switchPresentationViewMode('CENARIO_REALISTA');
    resetDemoSandboxState();
  });

  it('preserva os 54 silos oficiais (1.304.063 kg nom. / 1.173.655 kg seg.), 27 MPs, 7 fornecedores, 12 bag configs, 9 rotas e 6 pendências', () => {
    const state = createInitialDemoState();
    assert.equal(state.silos.length, 54);
    assert.equal(state.materials.length, 27);
    assert.equal(state.suppliers.length, 7);
    assert.equal(state.bagConfigs.length, 12);
    assert.equal(state.transferRules.length, 9);
    assert.equal(state.routes.length, 9);
    assert.equal(state.transferRules.filter((r) => r.isActive).length, 2);
    assert.equal(state.pendencies.filter((p) => p.status === 'PENDENTE').length, 6);
    assert.equal(state.helpArticles.length, AUTO_FEATURE_MANUALS.length);

    const totalNominalKg = state.silos.reduce((acc, s) => acc + s.nominalCapacityKg, 0);
    const totalSafeKg = state.silos.reduce((acc, s) => acc + s.safeCapacityKg, 0);
    assert.equal(totalNominalKg, 1304063);
    assert.equal(totalSafeKg, 1173655);

    const nums = new Set(state.silos.map((s) => s.siloNumber));
    assert.equal(nums.has(27), false, 'Silo 27 não deve existir');
    assert.equal(nums.has(30), false, 'Silo 30 não deve existir');

    const lineSilos = (lineCode: string) =>
      state.silos.filter((s) => s.lineCode === lineCode).map((s) => s.siloNumber);
    assert.deepEqual(lineSilos('L1'), [25, 26]);
    assert.deepEqual(lineSilos('L2'), [23, 24]);
    assert.deepEqual(lineSilos('L5'), [9, 10]);
    assert.deepEqual(lineSilos('L6'), [28, 29]);

    const storageNums = state.silos
      .filter((s) => s.category === 'ARMAZENAGEM')
      .map((s) => s.siloNumber);
    assert.deepEqual(storageNums, [42, 41, 40, 39, 38, 37, 36, 35, 34]);
  });

  it('usa data operacional dinâmica (não fixada em 2026-11-18) e turnos oficiais atualizados', () => {
    const state = createInitialDemoState();
    assert.notEqual(state.session.shift.operationalDate, '2026-11-18');
    assert.equal(state.shifts.length, 3);
    assert.equal(state.shifts[0].startTime, '07:30');
    assert.equal(state.shifts[0].endTime, '17:18');
    assert.equal(state.shifts[1].startTime, '17:00');
    assert.equal(state.shifts[1].endTime, '02:12');
    assert.equal(state.shifts[2].startTime, '23:28');
    assert.equal(state.shifts[2].endTime, '07:30');
  });

  it('representa os 5 estados operacionais no mapa (disponível, estoque baixo, crítico, recebendo e indisponível)', () => {
    const state = createInitialDemoState();
    assert.ok(state.silos.some((s) => s.stockAlertLevel === 'NORMAL' && s.operationalStatus === 'OPERACIONAL'));
    assert.ok(state.silos.some((s) => s.stockAlertLevel === 'ATENCAO'));
    assert.ok(state.silos.some((s) => s.stockAlertLevel === 'CRITICO'));
    assert.ok(state.silos.some((s) => s.isReceiving === true));
    assert.ok(state.silos.some((s) => s.operationalStatus === 'MANUTENCAO'));
  });

  it('mantém reconciliação matemática entre Dashboard, Inteligência de Consumo e Relatórios', async () => {
    const dash = await handleDemoApiFetch<DashboardResponse>('/api/dashboard');
    const overview = await handleDemoApiFetch<OperationalIndicatorsOverview>('/api/reports/overview');
    const receiving = await handleDemoApiFetch<ReceivingReportResponse>('/api/reports/receiving');
    const stock = await handleDemoApiFetch<StockAndHistoricalReportResponse>('/api/reports/stock');
    const transfers = await handleDemoApiFetch<TransfersReportResponse>('/api/reports/transfers');
    const consumption = await handleDemoApiFetch<ConsumptionReportResponse>('/api/reports/consumption');
    const intel = await handleDemoApiFetch<IntelligenceSummaryResponse>('/api/intelligence/summary');

    assert.equal(dash.kpis.totalSilos, 54);
    assert.equal(dash.kpis.totalNominalCapacityKg, 1304063);
    assert.equal(dash.kpis.totalSafeCapacityKg, 1173655);
    assert.equal(overview.indicators.totalConfirmedStockKg, dash.kpis.totalConfirmedStockKg);
    assert.equal(stock.currentTotals.totalConfirmedStockKg, dash.kpis.totalConfirmedStockKg);
    assert.equal(overview.performanceKpis.receivedVolumeKg, receiving.totals.receivedKg);
    assert.equal(overview.performanceKpis.transferredVolumeKg, transfers.totals.transferredKg);
    assert.equal(overview.performanceKpis.plannedConsumptionKg, intel.totals.plannedConsumptionTodayKg);
    assert.equal(consumption.totals.realizedConsumptionKg, intel.totals.realizedConsumptionKg);
    assert.ok(intel.recommendations.length > 0);
  });

  it('atende todos os endpoints Fases 1–5 em memória (advice, distribute, auto-summary, shifts PUT, decisions, adjust, kpi-targets)', async () => {
    const supply = await handleDemoApiFetch<ProductionSupplyBoardResponse>('/api/supply/board');
    assert.ok(supply.boardRows.length > 0);
    assert.ok(supply.recommendations.length > 0);

    const assist = await handleDemoApiFetch<NexoAssistantResponse>('/api/assistant/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'Quais silos estão críticos na Linha 4?' }),
    });
    assert.match(assist.answer, /Silo 12/i);

    const advice = await handleDemoApiFetch<{ summary: string; alerts: string[] }>('/api/ai/operational-advice', {
      method: 'POST',
      body: JSON.stringify({ deterministicFacts: { material: 'CALCARIO', restantePendenteKg: 5000 } }),
    });
    assert.match(advice.summary, /CALCARIO/i);

    const s21 = getDemoStateSnapshot().silos.find((s) => s.siloNumber === 21)!;
    const s21Before = s21.confirmedStockKg;
    const distRes = await handleDemoApiFetch<{ receipt: { status: string; remainingQuantityKg: number } }>(
      '/api/receipts/1/distribute',
      {
        method: 'POST',
        body: JSON.stringify({
          distributions: [{ siloId: s21.id, quantityKg: 18840 }],
          isComplement: true,
        }),
      }
    );
    assert.equal(distRes.receipt.status, 'CONCLUIDO');
    assert.equal(distRes.receipt.remainingQuantityKg, 0);
    assert.equal(getDemoStateSnapshot().silos.find((s) => s.siloNumber === 21)!.confirmedStockKg, s21Before + 18840);

    const autoSum = await handleDemoApiFetch<ShiftAutoSummarySnapshot>(
      '/api/shift-handovers/auto-summary?shiftCode=TURNO_1'
    );
    assert.equal(autoSum.shiftCode, 'TURNO_1');
    assert.ok(autoSum.chronologicalEvents.length >= 1);

    const updatedShift = await handleDemoApiFetch<{ notes: string }>('/api/shifts/TURNO_1', {
      method: 'PUT',
      body: JSON.stringify({ notes: 'Observação teste apresentação' }),
    });
    assert.equal(updatedShift.notes, 'Observação teste apresentação');

    const doc = await handleDemoApiFetch<{ fileName: string }>('/api/schedule-documents/1');
    assert.ok(doc.fileName.length > 0);

    const recId = supply.recommendations[0].id;
    const decRes = await handleDemoApiFetch<{ decisionStatus: string }>(
      `/api/supply/recommendations/${recId}/decision`,
      { method: 'POST', body: JSON.stringify({ decision: 'EM_ANALISE', decisionNotes: 'Avaliando rota' }) }
    );
    assert.equal(decRes.decisionStatus, 'EM_ANALISE');

    const intelBefore = await handleDemoApiFetch<IntelligenceSummaryResponse>('/api/intelligence/summary');
    const iRecId = intelBefore.recommendations[0].id;
    await handleDemoApiFetch(`/api/intelligence/recommendations/${iRecId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'ACEITA', decisionNotes: 'Ok' }),
    });
    const intelAfter = await handleDemoApiFetch<IntelligenceSummaryResponse>('/api/intelligence/summary');
    assert.equal(intelAfter.recommendations.find((r) => r.id === iRecId)!.decisionStatus, 'ACEITA');

    const s38 = getDemoStateSnapshot().silos.find((s) => s.siloNumber === 38)!;
    const s38Before = s38.confirmedStockKg;
    await handleDemoApiFetch('/api/stock/adjust', {
      method: 'POST',
      body: JSON.stringify({ siloId: s38.id, materialId: s38.primaryMaterialId, deltaKg: -1500, reason: 'Teste ajuste' }),
    });
    assert.equal(getDemoStateSnapshot().silos.find((s) => s.siloNumber === 38)!.confirmedStockKg, s38Before - 1500);

    await handleDemoApiFetch('/api/kpi-targets', {
      method: 'POST',
      body: JSON.stringify({ code: 'META-TEST', label: 'Meta Teste', targetValue: 95, unit: '%' }),
    });
    const targets = await handleDemoApiFetch<Array<{ code: string }>>('/api/kpi-targets');
    assert.ok(targets.some((t) => t.code === 'META-TEST'));

    const schedApprove = await handleDemoApiFetch<{ schedule: { scheduleCode: string }; diff: { summaryText: string } }>(
      '/api/schedules/1/approve',
      { method: 'POST', body: JSON.stringify({}) }
    );
    assert.ok(schedApprove.schedule.scheduleCode);
    assert.ok(schedApprove.diff.summaryText);
  });

  it('suporta applyPresentationBootstrap nos modos CENARIO_REALISTA e BANCO_AO_VIVO preservando números reais do PostgreSQL', () => {
    const base = createInitialDemoState('CENARIO_REALISTA');
    const emptySilos = base.silos.map((s) => ({
      ...s,
      confirmedStockKg: 0,
      occupancyPercent: 0,
      availableSpaceKg: s.safeCapacityKg,
      stockAlertLevel: 'NORMAL' as const,
      stockAlertReason: null,
      isReceiving: false,
      operationalStatus: 'OPERACIONAL' as const,
    }));

    const mockBootstrap: PresentationBootstrapPayload = {
      generatedAtIso: new Date().toISOString(),
      dataSource: 'POSTGRESQL_READONLY_SYNC',
      activeShift: base.session.shift,
      lines: base.lines,
      materials: base.materials,
      suppliers: base.suppliers,
      bagConfigs: base.bagConfigs,
      silos: emptySilos,
      transferRules: base.transferRules,
      routes: base.routes,
      pendencies: base.pendencies,
      helpArticles: base.helpArticles,
      scheduleTemplates: base.scheduleTemplates,
      shifts: base.shifts,
      products: [],
      thresholds: [],
      liveCounts: {
        silos: 54,
        materials: 27,
        suppliers: 7,
        bagConfigs: 12,
        transferRules: 9,
        activeTransferRules: 2,
        pendenciesPending: 6,
        helpArticles: 16,
        receipts: 0,
        movements: 0,
        transferOrders: 0,
        schedules: 0,
        occurrences: 0,
        handovers: 0,
        intakeRequests: 0,
        labelScans: 1,
        auditEvents: 2,
        totalRealStockKg: 0,
        totalNominalCapacityKg: 1304063,
        totalSafeCapacityKg: 1173655,
      },
      liveSnapshot: {
        receipts: [],
        movements: [],
        transferOrders: [],
        schedules: [],
        supplyBoard: {
          ...base.supplyBoard,
          boardRows: [],
          recommendations: [],
          intakeRequests: [],
        },
        intelligenceSummary: {
          ...base.intelligenceSummary,
          byMaterial: [],
          alerts: [],
          recommendations: [],
        },
        occurrences: [],
        handovers: [],
        openShiftPendencies: [],
        performanceTargets: [],
        recentSnapshots: [],
      },
    };

    const liveState = applyPresentationBootstrap(mockBootstrap, 'BANCO_AO_VIVO');
    assert.equal(liveState.viewMode, 'BANCO_AO_VIVO');
    assert.equal(liveState.silos.length, 54);
    assert.equal(liveState.silos.reduce((a, s) => a + s.confirmedStockKg, 0), 0);
    assert.equal(liveState.silos.reduce((a, s) => a + s.safeCapacityKg, 0), 1173655);

    const scenarioState = applyPresentationBootstrap(mockBootstrap, 'CENARIO_REALISTA');
    assert.equal(scenarioState.viewMode, 'CENARIO_REALISTA');
    assert.equal(scenarioState.silos.length, 54);
    assert.ok(scenarioState.silos.reduce((a, s) => a + s.confirmedStockKg, 0) > 0);
    assert.equal(scenarioState.liveCounts.totalNominalCapacityKg, 1304063);
  });

  it('simula transferência na sandbox em memória e restaura exatamente ao resetar', async () => {
    const before = await handleDemoApiFetch<SiloDetail[]>('/api/silos');
    const s38Before = before.find((s) => s.siloNumber === 38)!;
    const s12Before = before.find((s) => s.siloNumber === 12)!;
    const initialS38Kg = s38Before.confirmedStockKg;
    const initialS12Kg = s12Before.confirmedStockKg;

    await handleDemoApiFetch('/api/transfers/execute', {
      method: 'POST',
      body: JSON.stringify({
        originSiloId: s38Before.id,
        destinationSiloId: s12Before.id,
        quantityKg: 5000,
      }),
    });

    const afterMut = getDemoStateSnapshot().silos;
    assert.equal(afterMut.find((s) => s.siloNumber === 38)!.confirmedStockKg, initialS38Kg - 5000);
    assert.equal(afterMut.find((s) => s.siloNumber === 12)!.confirmedStockKg, initialS12Kg + 5000);

    resetDemoSandboxState();
    const afterReset = getDemoStateSnapshot().silos;
    assert.equal(afterReset.find((s) => s.siloNumber === 38)!.confirmedStockKg, initialS38Kg);
    assert.equal(afterReset.find((s) => s.siloNumber === 12)!.confirmedStockKg, initialS12Kg);
  });

  it('disponibiliza dados fictícios completos de consumo (L1–L7, fator pendente, histórico, rascunho e filtros)', async () => {
    const state = getDemoStateSnapshot();
    assert.ok(state.products.length >= 6, 'Deve possuir ao menos 6 produtos com fatores');
    assert.ok(
      state.schedules.some((sc) => sc.status === 'RASCUNHO_CONFERENCIA'),
      'Deve possuir programação em rascunho para demonstração de aprovação'
    );
    assert.ok(
      state.schedules.some((sc) => sc.status === 'SUPERSEDED'),
      'Deve possuir revisão anterior no histórico'
    );
    assert.ok(
      state.movements.filter((m) => m.movementType === 'CONSUMO_PRODUCAO').length >= 10,
      'Deve possuir movimentações de consumo por produção'
    );
    assert.ok(
      state.supplyBoard.boardRows.some((r) => r.supplyStatus === 'CINZA'),
      'Deve possuir linha CINZA demonstrando trava por fator pendente'
    );

    const consToday = await handleDemoApiFetch<ConsumptionReportResponse>(
      '/api/reports/consumption?preset=HOJE'
    );
    const cons30 = await handleDemoApiFetch<ConsumptionReportResponse>(
      '/api/reports/consumption?preset=ULTIMOS_30_DIAS'
    );
    assert.ok(cons30.rows.length > consToday.rows.length, 'Período de 30 dias deve incluir ontem e amanhã');
    assert.ok(
      (cons30.totals.realizedConsumptionKg ?? 0) > (consToday.totals.realizedConsumptionKg ?? 0),
      'Consumo realizado acumulado de 30 dias deve incluir produção de ontem'
    );

    const consL4 = await handleDemoApiFetch<ConsumptionReportResponse>(
      '/api/reports/consumption?preset=HOJE&lineCode=L4'
    );
    assert.ok(consL4.rows.length > 0 && consL4.rows.every((r) => r.lineCode === 'L4'));

    const intelRed = await handleDemoApiFetch<IntelligenceSummaryResponse>(
      '/api/intelligence/summary?priority=VERMELHO'
    );
    assert.ok(intelRed.byMaterial.length > 0);
    assert.ok(intelRed.byMaterial.every((m) => m.statusPriority === 'VERMELHO'));
    assert.ok(intelRed.alerts.every((a) => a.priority === 'VERMELHO'));

    const intelL2 = await handleDemoApiFetch<IntelligenceSummaryResponse>(
      '/api/intelligence/summary?lineCode=L2'
    );
    assert.ok(intelL2.byMaterial.some((m) => m.pendingFactorItemsCount > 0));

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const stockYesterday = await handleDemoApiFetch<StockAndHistoricalReportResponse>(
      `/api/reports/stock?preset=ULTIMOS_30_DIAS&historicalDate=${yesterday}`
    );
    assert.ok(stockYesterday.historicalRows.length > 0, 'Deve reconstruir saldo histórico de ontem');
  });

  it('executa leitura real de código de barras e foto simulada de etiqueta no modo demonstração', async () => {
    const rqRes = await handleDemoApiFetch<{
      parsed: { formatMatched: string; materialCode: string | null; lotCode: string | null };
      matchedMaterial: { code: string } | null;
      lotHistory: { hasMovements: boolean; totalDistributedKg: number } | null;
      bagConfigs: Array<{ unitWeightKg: number }>;
    }>('/api/labels/parse-barcode', {
      method: 'POST',
      body: JSON.stringify({ rawBarcode: '22******20901210610011606870' }),
    });
    assert.equal(rqRes.parsed.formatMatched, 'CARGILL_RQ_REC_044');
    assert.equal(rqRes.matchedMaterial?.code, '2090121061');
    assert.equal(rqRes.parsed.lotCode, '0011606870');
    assert.equal(rqRes.lotHistory?.hasMovements, true);
    assert.equal(rqRes.lotHistory?.totalDistributedKg, 12000);

    const lotOnlyRes = await handleDemoApiFetch<{
      matchedMaterial: { code: string } | null;
      lotHistory: { hasMovements: boolean; totalRemainingKg: number } | null;
    }>('/api/labels/parse-barcode', {
      method: 'POST',
      body: JSON.stringify({ rawBarcode: '0011647908' }),
    });
    assert.equal(lotOnlyRes.matchedMaterial?.code, '2017101021');
    assert.equal(lotOnlyRes.lotHistory?.hasMovements, true);
    assert.equal(lotOnlyRes.lotHistory?.totalRemainingKg, 18840);

    const delimRes = await handleDemoApiFetch<{
      parsed: { materialCode: string | null; lotCode: string | null; weightKg: number | null };
      matchedMaterial: { code: string } | null;
      lotHistory: { hasMovements: boolean } | null;
    }>('/api/labels/parse-barcode', {
      method: 'POST',
      body: JSON.stringify({ rawBarcode: '1113101920|0011998822|4000' }),
    });
    assert.equal(delimRes.matchedMaterial?.code, '1113101920');
    assert.equal(delimRes.parsed.lotCode, '0011998822');
    assert.equal(delimRes.parsed.weightKg, 4000);
    assert.equal(delimRes.lotHistory?.hasMovements, false);

    const photoUreia = await handleDemoApiFetch<{
      extraction: { bagCount: number | null; weightKg: number | null; lotCode: string | null };
      matchedMaterial: { code: string } | null;
      lotHistory: { hasMovements: boolean } | null;
    }>('/api/labels/interpret-photo', {
      method: 'POST',
      body: JSON.stringify({ demoSampleKey: 'UREIA_BIGBAG_NOVO' }),
    });
    assert.equal(photoUreia.matchedMaterial?.code, '1620101010');
    assert.equal(photoUreia.extraction.bagCount, 10);
    assert.equal(photoUreia.extraction.weightKg, 10000);
    assert.equal(photoUreia.lotHistory?.hasMovements, false);
  });
});
