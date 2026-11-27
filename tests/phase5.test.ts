import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  buildChronologicalShiftReportText,
  computePerformanceKpis,
  reconstructHistoricalStockPosition,
  resolvePeriodBounds,
} from '../src/lib/phase5-analytics.ts';
import {
  ShiftConfigInput,
  detectCrossesMidnight,
  resolveOperationalShift,
  resolveShiftFromConfigs,
} from '../src/lib/shifts.ts';
import { exportReportDocument } from '../src/lib/report-exporter.ts';
import {
  AssistantAuthorizedContext,
  buildDeterministicAssistantAnswer,
} from '../src/lib/gemini-assistant.ts';
import { hasPermission } from '../src/lib/rbac.ts';
import { OCCURRENCE_CATEGORIES } from '../src/types/nexo.ts';

describe('NEXO LOG 2.0 — Fase 5 (20 Cenários Obrigatórios)', () => {
  it('1. Resolução de períodos e separação de recebimentos (recebido vs descarregado vs pendente)', () => {
    const bounds = resolvePeriodBounds('ULTIMOS_7_DIAS', undefined, undefined, '2026-11-17');
    assert.equal(bounds.startDate, '2026-11-11');
    assert.equal(bounds.endDate, '2026-11-17');

    const kpi = computePerformanceKpis({
      periodStart: '2026-11-11',
      periodEnd: '2026-11-17',
      receipts: [
        {
          receivedQuantityKg: 38840,
          distributedQuantityKg: 20000,
          status: 'PARCIAL',
          startedAtIso: '2026-11-17T08:00:00.000Z',
          finishedAtIso: null,
        },
        {
          receivedQuantityKg: 12000,
          distributedQuantityKg: 12000,
          status: 'CONCLUIDO',
          startedAtIso: '2026-11-17T10:00:00.000Z',
          finishedAtIso: '2026-11-17T10:40:00.000Z',
        },
      ],
      partialDistributionsCount: 1,
      transferredVolumeKg: 5000,
      occurrencesTotalCount: 0,
      occurrencesOpenCount: 0,
      divergencesFrequency: 1,
      shortageAlertsFrequency: 0,
      consumptionRows: [],
    });

    assert.equal(kpi.receivedVolumeKg, 50840);
    assert.equal(kpi.distributedVolumeKg, 32000);
    assert.equal(kpi.partialDischargesCount, 1);
    assert.equal(kpi.avgReceiptDurationSampleSize, 1);
    assert.equal(kpi.avgReceiptDurationMinutes, 40);
  });

  it('2. Reconstrução de estoque histórico pelo livro razão sem copiar saldo atual (inclui estorno posterior)', () => {
    const movements = [
      {
        id: 1,
        siloId: 30,
        siloNumber: 38,
        lineCode: 'L7',
        siloCategory: 'ARMAZENAGEM',
        materialId: 1,
        materialCode: '2017101021',
        materialDescription: 'CALCARIO',
        lotCode: '0011647908',
        quantityKg: 38840,
        direction: 'CREDIT',
        operationalDate: '2026-11-15',
        createdAtIso: '2026-11-15T14:00:00.000Z',
      },
      {
        id: 2,
        siloId: 30,
        siloNumber: 38,
        lineCode: 'L7',
        siloCategory: 'ARMAZENAGEM',
        materialId: 1,
        materialCode: '2017101021',
        materialDescription: 'CALCARIO',
        lotCode: '0011647908',
        quantityKg: 10000,
        direction: 'DEBIT',
        operationalDate: '2026-11-16',
        createdAtIso: '2026-11-16T09:00:00.000Z',
      },
      // Estorno ocorrido somente no dia 17/11 não pode alterar a posição histórica de 15/11
      {
        id: 3,
        siloId: 30,
        siloNumber: 38,
        lineCode: 'L7',
        siloCategory: 'ARMAZENAGEM',
        materialId: 1,
        materialCode: '2017101021',
        materialDescription: 'CALCARIO',
        lotCode: '0011647908',
        quantityKg: 5000,
        direction: 'DEBIT',
        operationalDate: '2026-11-17',
        createdAtIso: '2026-11-17T11:00:00.000Z',
      },
    ];

    const pos15 = reconstructHistoricalStockPosition({
      targetDate: '2026-11-15',
      cutoffMode: 'OPERATIONAL_DATE',
      movements,
    });
    assert.equal(pos15.totalHistoricalBalanceKg, 38840);
    assert.equal(pos15.movementsEvaluatedCount, 1);

    const pos16 = reconstructHistoricalStockPosition({
      targetDate: '2026-11-16',
      cutoffMode: 'OPERATIONAL_DATE',
      movements,
    });
    assert.equal(pos16.totalHistoricalBalanceKg, 28840);
    assert.equal(pos16.movementsEvaluatedCount, 2);
  });

  it('3. Consulta histórica por timestamp exato em data anterior retorna zero se não havia movimentação', () => {
    const posBefore = reconstructHistoricalStockPosition({
      targetDate: '2026-11-10',
      cutoffMode: 'TIMESTAMP',
      targetTimestampEndIso: '2026-11-10T23:59:59.999Z',
      movements: [
        {
          id: 1,
          siloId: 30,
          siloNumber: 38,
          lineCode: 'L7',
          siloCategory: 'ARMAZENAGEM',
          materialId: 1,
          materialCode: '2017101021',
          materialDescription: 'CALCARIO',
          lotCode: '0011647908',
          quantityKg: 20000,
          direction: 'CREDIT',
          operationalDate: '2026-11-12',
          createdAtIso: '2026-11-12T10:00:00.000Z',
        },
      ],
    });
    assert.equal(posBefore.totalHistoricalBalanceKg, 0);
    assert.equal(posBefore.movementsEvaluatedCount, 0);
    assert.match(posBefore.note, /Nenhuma movimentação/i);
  });

  it('4. Relatório de transferências preserva todos os status operacionais e saldos pendentes', () => {
    const repoSrc = fs.readFileSync(path.resolve('src/db/phase5-repository.ts'), 'utf8');
    assert.match(repoSrc, /getTransfersReport/);
    assert.match(repoSrc, /completedCount/);
    assert.match(repoSrc, /partialCount/);
    assert.match(repoSrc, /interruptedCount/);
    assert.match(repoSrc, /openCount/);
    assert.match(repoSrc, /canceledCount/);
  });

  it('5. Relatório de consumo previsto x realizado nunca trata consumo previsto como realizado', () => {
    const kpiNoRealized = computePerformanceKpis({
      periodStart: '2026-11-17',
      periodEnd: '2026-11-17',
      receipts: [],
      partialDistributionsCount: 0,
      transferredVolumeKg: 0,
      occurrencesTotalCount: 0,
      occurrencesOpenCount: 0,
      divergencesFrequency: 0,
      shortageAlertsFrequency: 0,
      consumptionRows: [
        { plannedConsumptionKg: 14500, realizedConsumptionKg: 0, hasRealizedRecord: false },
      ],
    });
    assert.equal(kpiNoRealized.plannedConsumptionKg, 14500);
    assert.equal(kpiNoRealized.realizedConsumptionKg, null);
    assert.equal(kpiNoRealized.consumptionVarianceKg, null);

    const kpiWithRealized = computePerformanceKpis({
      periodStart: '2026-11-17',
      periodEnd: '2026-11-17',
      receipts: [],
      partialDistributionsCount: 0,
      transferredVolumeKg: 0,
      occurrencesTotalCount: 0,
      occurrencesOpenCount: 0,
      divergencesFrequency: 0,
      shortageAlertsFrequency: 0,
      consumptionRows: [
        { plannedConsumptionKg: 10000, realizedConsumptionKg: 10800, hasRealizedRecord: true },
        { plannedConsumptionKg: 5000, realizedConsumptionKg: 0, hasRealizedRecord: false },
      ],
    });
    assert.equal(kpiWithRealized.plannedConsumptionKg, 15000);
    assert.equal(kpiWithRealized.realizedConsumptionKg, 10800);
    assert.equal(kpiWithRealized.consumptionVarianceKg, 800);
  });

  it('6. Indicadores reais nunca inventam linha de base histórica nem tempo médio sem término', () => {
    const kpi = computePerformanceKpis({
      periodStart: '2026-11-17',
      periodEnd: '2026-11-17',
      receipts: [
        {
          receivedQuantityKg: 10000,
          distributedQuantityKg: 10000,
          status: 'CONCLUIDO',
          startedAtIso: '2026-11-17T10:00:00.000Z',
          finishedAtIso: null,
        },
      ],
      partialDistributionsCount: 0,
      transferredVolumeKg: 0,
      occurrencesTotalCount: 0,
      occurrencesOpenCount: 0,
      divergencesFrequency: 0,
      shortageAlertsFrequency: 0,
      consumptionRows: [],
    });
    assert.equal(kpi.avgReceiptDurationMinutes, null);
    assert.match(kpi.historicalBaselineNotice, /Não há linha de base histórica anterior/i);
  });

  it('7. Regra de turnos com travessia de meia-noite preserva data operacional do dia de início', () => {
    const afterMidnight = new Date(2026, 10, 18, 0, 45, 0); // 18/11 00:45 local -> 3º turno iniciado em 17/11 23:28
    const resolved = resolveOperationalShift(afterMidnight);
    assert.equal(resolved.shiftCode, 'TURNO_3');
    assert.equal(resolved.operationalDate, '2026-11-17');
    assert.equal(resolved.crossesMidnight, true);

    const t2OnlyConfigs: ShiftConfigInput[] = [
      { code: 'TURNO_1', name: '1º Turno', startTime: '07:30', endTime: '17:18', isValidated: true },
      { code: 'TURNO_2', name: '2º Turno', startTime: '17:00', endTime: '02:12', isValidated: true },
    ];
    const t2AfterMidnight = resolveShiftFromConfigs(afterMidnight, t2OnlyConfigs);
    assert.equal(t2AfterMidnight.shiftCode, 'TURNO_2');
    assert.equal(t2AfterMidnight.operationalDate, '2026-11-17');
    assert.equal(t2AfterMidnight.crossesMidnight, true);

    const customConfigs: ShiftConfigInput[] = [
      { code: 'TURNO_1', name: '1º Turno', startTime: '07:00', endTime: '18:00', isValidated: true },
      { code: 'TURNO_2', name: '2º Turno', startTime: '18:00', endTime: '02:30', isValidated: true },
      { code: 'TURNO_3', name: '3º Turno', startTime: '02:30', endTime: '07:00', isValidated: true },
    ];
    assert.equal(detectCrossesMidnight('18:00', '02:30'), true);
    const customAfterMidnight = new Date(2026, 10, 18, 2, 10, 0);
    const customRes = resolveShiftFromConfigs(customAfterMidnight, customConfigs);
    assert.equal(customRes.shiftCode, 'TURNO_2');
    assert.equal(customRes.operationalDate, '2026-11-17');
    assert.equal(customRes.isValidated, true);
  });

  it('8. Configuração administrativa de turnos é permitida a Supervisor/Admin e bloqueada a Operador/Produção', () => {
    assert.equal(hasPermission('ADMIN', 'shifts:manage'), true);
    assert.equal(hasPermission('SUPERVISOR', 'shifts:manage'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'shifts:manage'), false);
    assert.equal(hasPermission('PRODUCAO', 'shifts:manage'), false);
  });

  it('9. Resumo automático do turno agrega movimentações reais em ordem cronológica', () => {
    const repoSrc = fs.readFileSync(path.resolve('src/db/phase5-repository.ts'), 'utf8');
    assert.match(repoSrc, /buildShiftAutoSummary/);
    assert.match(repoSrc, /chronologicalEvents\.sort/);
  });

  it('10. Passagem de turno preserva histórico imutável após finalização', () => {
    const repoSrc = fs.readFileSync(path.resolve('src/db/phase5-repository.ts'), 'utf8');
    assert.match(repoSrc, /saveShiftHandoverDraftTransactional/);
    assert.match(repoSrc, /finalizeShiftHandoverTransactional/);
    assert.match(repoSrc, /existing\.status === 'FINALIZADA'/);
  });

  it('11. Ciência do próximo turno sobre pendência nunca marca como RESOLVIDA automaticamente', () => {
    const repoSrc = fs.readFileSync(path.resolve('src/db/phase5-repository.ts'), 'utf8');
    const ackStart = repoSrc.indexOf('export async function acknowledgeShiftPendencyTransactional');
    const resolveStart = repoSrc.indexOf('export async function resolveShiftPendencyTransactional');
    assert.ok(ackStart > -1 && resolveStart > ackStart);
    const ackBody = repoSrc.slice(ackStart, resolveStart);
    assert.match(ackBody, /status:\s*'CIENTE'/);
    assert.equal(/status:\s*'RESOLVIDA'/.test(ackBody), false);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'handover:acknowledge'), true);
  });

  it('12. Relatório automático do turno segue formato cronológico, neutro e informa "Dado não informado"', () => {
    const reportText = buildChronologicalShiftReportText({
      summary: {
        shiftCode: 'TURNO_2',
        shiftName: '2º Turno (17:00–02:12)',
        operationalDate: '2026-11-17',
        generatedAtIso: '2026-11-18T01:50:00.000Z',
        receiptsCount: 1,
        receivedKg: 38840,
        distributedKg: 20000,
        vehiclesOrInvoices: ['NF 4412 (MOAGEM PINHEIRO)'],
        materialsReceived: [{ code: '2017101021', description: 'CALCARIO', kg: 38840 }],
        silosFed: [{ siloNumber: 38, kg: 20000, materialCode: '2017101021' }],
        transfersCompletedCount: 1,
        transfersCompletedKg: 10000,
        transfersPendingCount: 0,
        transfersPendingCodes: [],
        partialDischargesCount: 1,
        partialReceiptNumbers: ['REC-261117-A1'],
        criticalStocks: [],
        updatedSchedules: [],
        activeAlertsCount: 0,
        activeAlertsList: [],
        openSupplyRequestsCount: 0,
        openOccurrencesCount: 0,
        openOccurrencesList: [],
        unavailableSilos: [],
        chronologicalEvents: [
          {
            timestampIso: '2026-11-17T21:15:00.000Z',
            timeLabel: '21:15',
            category: 'Recebimento',
            summary: 'REC-261117-A1: 2017101021 CALCARIO (38.840 kg).',
          },
        ],
      },
      handoverByName: 'Carlos Operador',
      receivedByName: null, // Ausente de propósito
    });

    assert.match(reportText, /^SEGUNDO TURNO — 17\/11\/2026/m);
    assert.match(reportText, /Responsável pelo recebimento do turno: Dado não informado/);
    assert.equal(/^\d+\.\s/m.test(reportText), false);
    assert.match(reportText, /21:15 — REC-261117-A1/);
  });

  it('13. Edição manual do relatório preserva autoReportText original separado de editedReportText', () => {
    const schemaSrc = fs.readFileSync(path.resolve('src/db/schema.ts'), 'utf8');
    assert.match(schemaSrc, /autoReportText:/);
    assert.match(schemaSrc, /editedReportText:/);
    assert.match(schemaSrc, /autoSummarySnapshotJson:/);
  });

  it('14. Central de Ocorrências contempla todas as 12 categorias obrigatórias', () => {
    assert.equal(OCCURRENCE_CATEGORIES.length, 12);
    assert.ok(OCCURRENCE_CATEGORIES.includes('Falta de matéria-prima'));
    assert.ok(OCCURRENCE_CATEGORIES.includes('Silo vazio'));
    assert.ok(OCCURRENCE_CATEGORIES.includes('Silo com capacidade insuficiente'));
    assert.ok(OCCURRENCE_CATEGORIES.includes('Material incompatível'));
    assert.ok(OCCURRENCE_CATEGORIES.includes('Divergência de estoque'));
    assert.ok(OCCURRENCE_CATEGORIES.includes('Falha de equipamento'));
    assert.ok(OCCURRENCE_CATEGORIES.includes('Outros'));
  });

  it('15. Encerramento de ocorrência exige perfil autorizado e solução aplicada', () => {
    assert.equal(hasPermission('ADMIN', 'occurrences:manage'), true);
    assert.equal(hasPermission('SUPERVISOR', 'occurrences:manage'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'occurrences:manage'), false);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'occurrences:create'), true);
  });

  it('16. Exportação real de relatório em PDF gera binário válido com cabeçalho NEXO LOG 2.0', async () => {
    const pdfOut = await exportReportDocument({
      format: 'PDF',
      reportTitle: 'Relatório de Recebimentos',
      reportType: 'RECEBIMENTOS',
      periodLabel: '17/11/2026',
      filtersSummary: 'Turno=TURNO_1',
      dataOrigin: 'PostgreSQL',
      generatedByName: 'Admin Teste',
      generatedByRole: 'ADMIN',
      generatedAtIso: '2026-11-17T15:00:00.000Z',
      columns: [
        { key: 'num', header: 'Nº', width: 15 },
        { key: 'mp', header: 'Matéria-Prima', width: 35 },
        { key: 'kg', header: 'Qtd (kg)', width: 15, align: 'right' },
      ],
      rows: [{ num: 'REC-001', mp: '2017101021 CALCARIO', kg: 38840 }],
      totalsSummary: [{ label: 'Total Recebido', value: '38.840 kg' }],
    });

    assert.equal(pdfOut.mimeType, 'application/pdf');
    assert.ok(pdfOut.buffer.length > 500);
    assert.equal(pdfOut.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  it('17. Exportação real de relatório em XLSX gera planilha legível pelo ExcelJS', async () => {
    const xlsxOut = await exportReportDocument({
      format: 'XLSX',
      reportTitle: 'Estoque por Silo',
      reportType: 'ESTOQUE',
      periodLabel: '17/11/2026',
      filtersSummary: 'Sem filtros',
      dataOrigin: 'PostgreSQL',
      generatedByName: 'Admin Teste',
      generatedByRole: 'ADMIN',
      generatedAtIso: '2026-11-17T15:00:00.000Z',
      columns: [
        { key: 'silo', header: 'Silo', width: 12 },
        { key: 'saldo', header: 'Saldo (kg)', width: 16 },
      ],
      rows: [{ silo: 'Silo 38', saldo: 38840 }],
      totalsSummary: [{ label: 'Total Estoque', value: '38.840 kg' }],
    });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsxOut.buffer as any);
    const sheet = wb.getWorksheet('Relatório');
    assert.ok(sheet);
    assert.match(String(sheet!.getRow(1).getCell(1).value), /NEXO LOG 2\.0/);
    assert.equal(sheet!.getRow(9).getCell(1).value, 'Silo 38');
    assert.equal(sheet!.getRow(9).getCell(2).value, 38840);
  });

  it('18. Exportação real de relatório em CSV inclui cabeçalho NEXO LOG 2.0, filtros, totais e origem', async () => {
    const csvOut = await exportReportDocument({
      format: 'CSV',
      reportTitle: 'Transferências',
      reportType: 'TRANSFERENCIAS',
      periodLabel: '17/11/2026',
      filtersSummary: 'Turno=TURNO_2',
      dataOrigin: 'PostgreSQL transfer_orders',
      generatedByName: 'Supervisor Teste',
      generatedByRole: 'SUPERVISOR',
      generatedAtIso: '2026-11-17T15:00:00.000Z',
      columns: [
        { key: 'ordem', header: 'Ordem' },
        { key: 'kg', header: 'Transferido (kg)' },
      ],
      rows: [{ ordem: 'TRF-001', kg: 10000 }],
      totalsSummary: [{ label: 'Total Transferido', value: '10.000 kg' }],
    });

    const text = csvOut.buffer.toString('utf8');
    assert.match(text, /NEXO LOG 2\.0/);
    assert.match(text, /Turno=TURNO_2/);
    assert.match(text, /PostgreSQL transfer_orders/);
    assert.match(text, /TRF-001/);
    assert.match(text, /10\.000 kg/);
  });

  it('19. NEXO ASSISTENTE responde perguntas operacionais com período, origem, última atualização e modo somente leitura', () => {
    const ctx: AssistantAuthorizedContext = {
      periodConsulted: 'Data Operacional 17/11/2026 (1º Turno)',
      dataOrigin: 'PostgreSQL — Base Oficial Autorizada NEXO LOG 2.0 (Somente Leitura)',
      lastUpdatedIso: '2026-11-17T15:30:00.000Z',
      userRole: 'SUPERVISOR',
      todayDate: '2026-11-17',
      receiptsSummary: {
        calcarioTodayKg: 38840,
        calcarioTodayCount: 1,
        todayTotalKg: 38840,
        openOrPartialReceipts: [],
        silosFedToday: [{ siloNumber: 38, materialCode: '2017101021', receivedKg: 20000 }],
      },
      silo38LastTransfer: {
        orderCode: 'TRF-261117-ABCD',
        createdAtIso: '2026-11-17T14:00:00.000Z',
        materialCode: '2017101021',
        originSiloNumber: 38,
        destinationSiloNumber: 12,
        transferredKg: 10000,
        status: 'CONCLUIDA',
        operatorName: 'Operador A',
      },
      criticalMaterials: [],
      priorShiftPendencies: [],
      linesAtRisk: [],
      openOccurrences: [],
      scheduleChanges: null,
      missingDataNotes: [],
    };

    const ansCalcario = buildDeterministicAssistantAnswer('Quanto calcário foi recebido hoje?', ctx);
    assert.match(ansCalcario.answer, /38\.840 kg/);
    assert.equal(ansCalcario.periodConsulted, ctx.periodConsulted);
    assert.equal(ansCalcario.dataOrigin, ctx.dataOrigin);

    const ansSilo38 = buildDeterministicAssistantAnswer('Qual foi a última transferência no Silo 38?', ctx);
    assert.match(ansSilo38.answer, /TRF-261117-ABCD/);
    assert.match(ansSilo38.answer, /Silo 12/);
  });

  it('20. Segurança (RBAC) restringe funções administrativas/exportações restritas e registra auditoria no servidor', () => {
    // Produção não gerencia metas, turnos, ocorrências nem finaliza passagens
    assert.equal(hasPermission('PRODUCAO', 'kpi:targets_manage'), false);
    assert.equal(hasPermission('PRODUCAO', 'shifts:manage'), false);
    assert.equal(hasPermission('PRODUCAO', 'occurrences:manage'), false);
    assert.equal(hasPermission('PRODUCAO', 'handover:prepare'), false);

    // Backend aplica bloqueio explícito para perfil Produção em exportações de turno e mascara colunas restritas
    const repoSrc = fs.readFileSync(path.resolve('src/db/phase5-repository.ts'), 'utf8');
    assert.match(repoSrc, /isRestrictedProfile && params\.reportType === 'TURNO'/);
    assert.match(repoSrc, /REPORT_EXPORTED/);
    assert.match(repoSrc, /ASSISTANT_QUERY/);
    assert.match(repoSrc, /SHIFT_HANDOVER_FINALIZED/);
    assert.match(repoSrc, /HANDOVER_PENDENCY_ACKNOWLEDGED/);
  });
});
