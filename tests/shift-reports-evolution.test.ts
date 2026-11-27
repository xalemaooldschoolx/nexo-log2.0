import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMoegaShiftNarrativeReport,
  classifyShiftVehicles,
  formatMaterialTitleCase,
  formatMaterialTitleCaseBold,
  polishShiftReportTextDeterministic,
} from '../src/lib/phase5-analytics.ts';
import { resolveShiftFromConfigs, type ShiftConfigInput } from '../src/lib/shifts.ts';
import { hasPermission } from '../src/lib/rbac.ts';
import {
  getDemoSession,
  handleDemoApiFetch,
  resetDemoSandboxState,
  switchPresentationViewMode,
} from '../src/lib/demo-api.ts';
import type {
  MaterialItem,
  OccurrenceItem,
  ReceiptItem,
  ShiftAutoSummarySnapshot,
  ShiftHandoverView,
  ShiftManagerialReportResponse,
  SiloDetail,
} from '../src/types/nexo.ts';

describe('NEXO LOG 2.0 — Evolução de Relatórios Operacionais e Passagem de Turno', () => {
  beforeEach(() => {
    switchPresentationViewMode('CENARIO_REALISTA');
    resetDemoSandboxState();
  });

  it('1. Regra de data operacional na virada da meia-noite e cabeçalho padrão do turno', () => {
    const configs: ShiftConfigInput[] = [
      { code: 'TURNO_1', name: '1º Turno', startTime: '07:30', endTime: '17:18', isValidated: true },
      { code: 'TURNO_2', name: '2º Turno', startTime: '17:00', endTime: '02:12', isValidated: true },
      { code: 'TURNO_3', name: '3º Turno', startTime: '23:28', endTime: '07:30', isValidated: true },
    ];
    // Exemplo oficial: 2º turno iniciado em 25/11 às 17h e operando após 00h (26/11 01:45)
    // Usando somente 1º e 2º turnos para simular turno 17h–02:12 após a meia-noite:
    const configs2Turnos = configs.slice(0, 2);
    const afterMidnight = new Date(2026, 10, 26, 1, 45, 0); // 26/11/2026 01:45 local
    const resolved = resolveShiftFromConfigs(afterMidnight, configs2Turnos);

    assert.equal(resolved.shiftCode, 'TURNO_2');
    assert.equal(resolved.operationalDate, '2026-11-25');
    assert.equal(resolved.crossesMidnight, true);

    const summary: ShiftAutoSummarySnapshot = {
      shiftCode: resolved.shiftCode,
      shiftName: resolved.shiftName,
      operationalDate: resolved.operationalDate,
      generatedAtIso: '2026-11-26T01:45:00.000Z',
      receiptsCount: 0,
      receivedKg: 0,
      distributedKg: 0,
      partialDischargesCount: 0,
      partialReceiptNumbers: [],
      vehiclesOrInvoices: [],
      materialsReceived: [],
      silosFed: [],
      transfersCompletedCount: 0,
      transfersCompletedKg: 0,
      transfersPendingCount: 0,
      transfersPendingCodes: [],
      criticalStocks: [],
      unavailableSilos: [],
      updatedSchedules: [],
      activeAlertsCount: 0,
      activeAlertsList: [],
      openSupplyRequestsCount: 0,
      openOccurrencesCount: 0,
      openOccurrencesList: [],
      chronologicalEvents: [],
    };

    const narrative = buildMoegaShiftNarrativeReport({
      summary,
      handoverByName: 'Marcos Silva',
      handoverByBadge: 'MOE-204',
    });

    assert.ok(
      narrative.startsWith('# SEGUNDO TURNO – 25/11/2026'),
      `Cabeçalho esperado '# SEGUNDO TURNO – 25/11/2026', recebido: ${narrative.split('\n')[0]}`
    );
  });

  it('2. Formatação em Title Case com acentuação e negrito para nomes de matérias-primas', () => {
    assert.equal(formatMaterialTitleCase('CALCARIO'), 'Calcário');
    assert.equal(formatMaterialTitleCase('FOSFATO BICALCICO 19%'), 'Fosfato Bicálcico 19%');
    assert.equal(
      formatMaterialTitleCase('FARELO DE GLUTEN DE MILHO 21%'),
      'Farelo de Glúten de Milho 21%'
    );
    assert.equal(formatMaterialTitleCaseBold('FARELO DE SOJA'), '**Farelo de Soja**');
  });

  it('3. Contagem rigorosa de veículos: remanescente finalizado não entra na cota do turno atual', () => {
    const breakdown = classifyShiftVehicles({
      shiftCode: 'TURNO_1',
      operationalDate: '2026-11-26',
      receipts: [
        // 1) Iniciado e finalizado neste turno -> CONTA
        {
          receiptId: 101,
          receiptNumber: 'REC-2026-101',
          materialId: 1,
          materialCode: '2017101021',
          materialDescription: 'CALCARIO',
          supplierName: 'Mineração Centro-Oeste',
          invoiceNumber: 'NF-88101',
          vehiclePlate: 'ABC-1D23',
          driverName: 'José Pereira',
          carrierName: 'TransMoega',
          receivingType: 'GRANEL',
          bagCount: null,
          receivedKg: 36000,
          distributedKgTotal: 36000,
          distributedInShiftKg: 36000,
          status: 'CONCLUIDO',
          startedAtIso: '2026-11-26T08:10:00.000Z',
          finishedAtIso: '2026-11-26T09:05:00.000Z',
          startedShiftCode: 'TURNO_1',
          startedOperationalDate: '2026-11-26',
          finishedShiftCode: 'TURNO_1',
          finishedOperationalDate: '2026-11-26',
          siloNumbers: [38],
          operatorName: 'Carlos Eduardo',
          operatorBadge: 'MOE-102',
          executedByName: null,
          executedByBadge: null,
        },
        // 2) Iniciado no 3º turno de ontem (25/11) e finalizado hoje no 1º turno -> NÃO CONTA
        {
          receiptId: 102,
          receiptNumber: 'REC-2026-099',
          materialId: 2,
          materialCode: '2017101055',
          materialDescription: 'FARELO DE SOJA',
          supplierName: 'AgroGrãos',
          invoiceNumber: 'NF-88077',
          vehiclePlate: 'XYZ-9K88',
          driverName: 'Paulo Henrique',
          carrierName: 'Rodogrãos',
          receivingType: 'GRANEL',
          bagCount: null,
          receivedKg: 32000,
          distributedKgTotal: 32000,
          distributedInShiftKg: 12000,
          status: 'CONCLUIDO',
          startedAtIso: '2026-11-25T23:50:00.000Z',
          finishedAtIso: '2026-11-26T08:00:00.000Z',
          startedShiftCode: 'TURNO_3',
          startedOperationalDate: '2026-11-25',
          finishedShiftCode: 'TURNO_1',
          finishedOperationalDate: '2026-11-26',
          siloNumbers: [26],
          operatorName: 'Carlos Eduardo',
          operatorBadge: 'MOE-102',
          executedByName: 'Renato Lima',
          executedByBadge: 'MOE-118',
        },
        // 3) Descarga parcial em andamento neste turno -> NÃO CONTA (fica pendente)
        {
          receiptId: 103,
          receiptNumber: 'REC-2026-102',
          materialId: 3,
          materialCode: '2017101088',
          materialDescription: 'FOSFATO BICALCICO 19%',
          supplierName: 'NutriMineral',
          invoiceNumber: 'NF-88109',
          vehiclePlate: 'JKL-4M56',
          driverName: 'Sérgio Santos',
          carrierName: 'TransMineral',
          receivingType: 'BIG_BAG',
          bagCount: 20,
          receivedKg: 20000,
          distributedKgTotal: 10000,
          distributedInShiftKg: 10000,
          status: 'PARCIAL',
          startedAtIso: '2026-11-26T10:15:00.000Z',
          finishedAtIso: null,
          startedShiftCode: 'TURNO_1',
          startedOperationalDate: '2026-11-26',
          finishedShiftCode: null,
          finishedOperationalDate: null,
          siloNumbers: [12],
          operatorName: 'Carlos Eduardo',
          operatorBadge: 'MOE-102',
          executedByName: null,
          executedByBadge: null,
        },
      ],
    });

    assert.equal(breakdown.totalCountedVehicles, 1);
    assert.equal(breakdown.countedVehicles.length, 1);
    assert.equal(breakdown.countedVehicles[0].receiptNumber, 'REC-2026-101');
    assert.equal(breakdown.countedVehicles[0].countedInShiftTotal, true);

    assert.equal(breakdown.carryoverFinalizedVehicles.length, 1);
    assert.equal(breakdown.carryoverFinalizedVehicles[0].receiptNumber, 'REC-2026-099');
    assert.equal(breakdown.carryoverFinalizedVehicles[0].countedInShiftTotal, false);

    assert.equal(breakdown.pendingOrPartialVehicles.length, 1);
    assert.equal(breakdown.pendingOrPartialVehicles[0].receiptNumber, 'REC-2026-102');
    assert.equal(breakdown.pendingOrPartialVehicles[0].countedInShiftTotal, false);

    assert.deepEqual(breakdown.countedByMaterial, [
      { materialDescription: 'CALCARIO', formattedMaterialName: 'Calcário', count: 1 },
    ]);

    const narrative = buildMoegaShiftNarrativeReport({
      summary: {
        shiftCode: 'TURNO_1',
        shiftName: '1º Turno (07:30–17:18)',
        operationalDate: '2026-11-26',
        generatedAtIso: '2026-11-26T17:10:00.000Z',
        receiptsCount: 2,
        receivedKg: 56000,
        distributedKg: 58000,
        partialDischargesCount: 1,
        partialReceiptNumbers: ['REC-2026-102'],
        vehiclesOrInvoices: ['ABC-1D23 / NF-88101', 'XYZ-9K88 / NF-88077'],
        materialsReceived: [],
        silosFed: [],
        transfersCompletedCount: 0,
        transfersCompletedKg: 0,
        transfersPendingCount: 0,
        transfersPendingCodes: [],
        criticalStocks: [],
        unavailableSilos: [],
        updatedSchedules: [],
        activeAlertsCount: 0,
        activeAlertsList: [],
        openSupplyRequestsCount: 0,
        openOccurrencesCount: 0,
        openOccurrencesList: [],
        chronologicalEvents: [],
        vehicleBreakdown: breakdown,
      },
      handoverByName: 'Carlos Eduardo',
      handoverByBadge: 'MOE-102',
      receivedByName: 'Marcos Silva',
    });

    assert.match(narrative, /^# PRIMEIRO TURNO – 26\/11\/2026/);
    assert.match(narrative, /não é contabilizado na cota de veículos descarregados deste turno/i);
    assert.match(narrative, /\*\*Veículos descarregados pelo primeiro turno:\*\*/);
    assert.match(narrative, /- 1x \*\*Calcário\*\*/);
    assert.match(narrative, /\*\*Total: 1 veículo descarregado\.\*\*/);
  });

  it('4. Permissões RBAC específicas de aprovação, correção pós-aprovação e verificação de ocorrências', () => {
    assert.equal(hasPermission('ADMIN', 'handover:approve'), true);
    assert.equal(hasPermission('ADMIN', 'handover:correct'), true);
    assert.equal(hasPermission('ADMIN', 'occurrences:verify'), true);

    assert.equal(hasPermission('SUPERVISOR', 'handover:approve'), true);
    assert.equal(hasPermission('SUPERVISOR', 'handover:correct'), true);
    assert.equal(hasPermission('SUPERVISOR', 'occurrences:verify'), true);

    assert.equal(hasPermission('OPERADOR_MOEGA', 'handover:prepare'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'handover:approve'), false);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'handover:correct'), false);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'occurrences:verify'), false);

    assert.equal(hasPermission('PRODUCAO', 'handover:approve'), false);
    assert.equal(hasPermission('PRODUCAO', 'handover:correct'), false);
    assert.equal(hasPermission('PRODUCAO', 'occurrences:verify'), false);
  });

  it('5. Assistente determinístico preserva números reais, incorpora comando e emite avisos corretos', () => {
    const baseText = [
      '# SEGUNDO TURNO – 26/11/2026',
      '',
      'Relatório operacional referente ao 2º Turno.',
      '',
      'Entre 18:00 e 19:00, realizou-se descarga de **Calcário** totalizando 36 t (36.000 kg) no Silo 38',
      '',
      '**Veículos descarregados pelo segundo turno:**',
      '',
      '- 1x **Calcário**',
      '',
      '**Total: 1 veículo descarregado.**',
    ].join('\n');

    const refined = polishShiftReportTextDeterministic({
      baseReportText: baseText,
      rawFacts: {
        receivedByName: null,
        openOccurrencesCount: 2,
        pendingVehicles: [{ receiptNumber: 'REC-99' }],
      },
      userCommand: 'Acrescentar chuva intensa às 20:15 sem impacto na moega coberta',
    });

    assert.match(refined.refinedText, /36 t \(36\.000 kg\)/);
    assert.match(refined.refinedText, /\*\*Total: 1 veículo descarregado\.\*\*/);
    assert.match(refined.refinedText, /chuva intensa às 20:15/i);
    assert.ok(refined.warnings.length >= 3);
  });

  it('6. Fluxo completo E2E no Demo Sandbox: autoria, terceiros, complemento, IA, aprovação, bloqueio, revisão versionada e relatório gerencial', async () => {
    const session = getDemoSession();
    assert.ok(session.user.displayName);
    assert.ok(session.user.badgeCode);
    assert.ok(session.user.jobTitle);
    assert.ok(session.user.department);

    const materials = await handleDemoApiFetch<MaterialItem[]>('/api/materials');
    const silos = await handleDemoApiFetch<SiloDetail[]>('/api/silos');
    const calcario = materials.find((m) => m.code === '2017101021')!;
    const silo38 = silos.find((s) => s.siloNumber === 38)!;

    // 6.1 Recebimento em nome de outro executor físico sem sobrescrever o usuário logado
    const { receipt: createdReceipt } = await handleDemoApiFetch<{
      receipt: ReceiptItem;
      warnings: string[];
    }>('/api/receipts', {
      method: 'POST',
      body: JSON.stringify({
        materialId: calcario.id,
        supplierName: 'Calcário Centro-Sul',
        invoiceNumber: 'NF-77550',
        lotCode: 'LOT-E2E-77',
        receivedQuantityKg: 15000,
        receivingType: 'GRANEL',
        vehiclePlate: 'E2E-2026',
        driverName: 'Motorista Teste',
        executedByName: 'Renato Auxiliar',
        executedByBadge: 'MOE-991',
      }),
    });

    assert.equal(createdReceipt.operatorName, session.user.displayName);
    assert.equal(createdReceipt.operatorBadge, session.user.badgeCode);
    assert.equal(createdReceipt.executedByName, 'Renato Auxiliar');
    assert.equal(createdReceipt.executedByBadge, 'MOE-991');

    await handleDemoApiFetch(`/api/receipts/${createdReceipt.id}/distribute`, {
      method: 'POST',
      body: JSON.stringify({
        distributions: [{ siloId: silo38.id, quantityKg: 15000 }],
        executedByName: 'Renato Auxiliar',
        executedByBadge: 'MOE-991',
      }),
    });

    // 6.2 Auto-summary atualizado deve conter breakdown e operadores do turno
    const autoSum = await handleDemoApiFetch<ShiftAutoSummarySnapshot>('/api/shift-handovers/auto-summary');
    assert.ok(autoSum.vehicleBreakdown, 'vehicleBreakdown deve existir no auto-summary');
    assert.ok(
      autoSum.vehicleBreakdown!.countedVehicles.some((v) => v.receiptId === createdReceipt.id),
      'Recebimento iniciado e finalizado no turno atual deve entrar na contagem'
    );
    assert.ok((autoSum.shiftOperators?.length || 0) >= 1);

    // 6.3 Rascunho + Complemento Manual + IA
    const draft = await handleDemoApiFetch<ShiftHandoverView>('/api/shift-handovers/draft', {
      method: 'POST',
      body: JSON.stringify({
        shiftCode: autoSum.shiftCode,
        operationalDate: autoSum.operationalDate,
        receivedByName: 'Supervisor Próximo Turno',
        shiftSummaryText: 'Moega operando estável com conferência completa.',
      }),
    });
    assert.ok(draft.handoverByName);
    assert.ok((draft.revisions?.length || 0) >= 1);
    assert.equal(draft.revisions?.[0].editedByName, session.user.displayName);

    const supplemented = await handleDemoApiFetch<ShiftHandoverView>(
      `/api/shift-handovers/${draft.id}/supplement`,
      {
        method: 'POST',
        body: JSON.stringify({
          category: 'SEGURANCA_LIMPEZA',
          text: 'Realizada limpeza preventiva da grade da moega 1 após descarga.',
          executedByName: 'Equipe Turno A',
          executedByBadge: 'EQP-01',
          appendToReport: true,
        }),
      }
    );
    assert.ok((supplemented.supplements?.length || 0) >= 1);
    assert.match(supplemented.editedReportText || '', /limpeza preventiva da grade da moega 1/i);

    const aiRes = await handleDemoApiFetch<{ refinedText: string; warnings: string[] }>(
      '/api/shift-handovers/refine-text',
      {
        method: 'POST',
        body: JSON.stringify({
          baseReportText: supplemented.editedReportText,
          rawFacts: autoSum,
          userCommand: 'Organizar texto com clareza operacional',
        }),
      }
    );
    assert.ok(aiRes.refinedText.length > 50);

    // 6.4 Aprovação e Encerramento Oficial + bloqueio de edição direta
    const approved = await handleDemoApiFetch<ShiftHandoverView>(
      `/api/shift-handovers/${draft.id}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({
          closeImmediately: true,
          approvalNotes: 'Conferido e aprovado sem pendências críticas.',
        }),
      }
    );
    assert.equal(approved.workflowStatus, 'ENCERRADO');
    assert.ok(approved.approvedAt);
    assert.ok(approved.closedAt);

    await assert.rejects(
      () =>
        handleDemoApiFetch(`/api/shift-handovers/${draft.id}/supplement`, {
          method: 'POST',
          body: JSON.stringify({ text: 'Tentativa após encerramento' }),
        }),
      /aprovado|encerrado/i
    );

    // 6.5 Correção versionada pós-aprovação exige justificativa >= 5 chars e preserva histórico
    await assert.rejects(
      () =>
        handleDemoApiFetch(`/api/shift-handovers/${draft.id}/correct`, {
          method: 'POST',
          body: JSON.stringify({
            editedReportText: approved.editedReportText,
            reason: 'abc',
          }),
        }),
      /mínimo 5 caracteres/i
    );

    const corrected = await handleDemoApiFetch<ShiftHandoverView>(
      `/api/shift-handovers/${draft.id}/correct`,
      {
        method: 'POST',
        body: JSON.stringify({
          editedReportText: `${approved.editedReportText}\n\nRetificação gerencial: conferência de lacre concluída.`,
          reason: 'Inclusão da conferência formal do lacre da balança.',
        }),
      }
    );
    assert.ok(corrected.version > approved.version);
    assert.equal(corrected.revisions?.[0].changeType, 'CORRECAO_POS_APROVACAO');
    assert.match(corrected.revisions?.[0].reason || '', /lacre da balança/i);

    // 6.6 Criação e verificação formal de ocorrência
    const occ = await handleDemoApiFetch<OccurrenceItem>('/api/occurrences', {
      method: 'POST',
      body: JSON.stringify({
        category: 'Clima / Umidade',
        title: 'Garoa leve no pátio externo',
        description: 'Aplicada lona protetora nas caçambas aguardando pesagem.',
        weatherCondition: 'CHUVA_LEVE',
        lineImpact: 'SEM_IMPACTO',
      }),
    });
    const verifiedOcc = await handleDemoApiFetch<OccurrenceItem>(`/api/occurrences/${occ.id}/verify`, {
      method: 'POST',
      body: JSON.stringify({
        verificationNotes: 'Lona conferida in loco pela liderança.',
      }),
    });
    assert.equal(verifiedOcc.verifiedByName, session.user.displayName);
    assert.ok(verifiedOcc.verifiedAt);

    // 6.7 Relatório Gerencial de Turnos com filtros
    const rep = await handleDemoApiFetch<ShiftManagerialReportResponse>(
      `/api/reports/shifts?workflowStatus=ENCERRADO`
    );
    assert.ok(rep.totals.shiftsCount >= 1);
    assert.ok(rep.totals.approvedOrClosedCount >= 1);
    assert.ok(rep.rows.some((r) => r.handoverId === corrected.id && r.version >= 4));
  });
});
