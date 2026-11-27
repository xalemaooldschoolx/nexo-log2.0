import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReference2511BasketVersions,
  compareBasketVersions,
  convertRawQuantityToKg,
  parseBrazilianNumber,
} from '../src/lib/basket-comparator.ts';
import { buildDemo30DayConsumptionTrend, createInitialDemoState } from '../src/lib/demo-data.ts';
import {
  getDemoStateSnapshot,
  handleDemoApiFetch,
  resetDemoSandboxState,
  switchPresentationViewMode,
} from '../src/lib/demo-api.ts';
import { hasPermission } from '../src/lib/rbac.ts';
import { exportReportDocument } from '../src/lib/report-exporter.ts';
import { PERMISSION_MATRIX_ROWS, ROLE_MANUAL_TIERS } from '../src/lib/role-manual-data.ts';
import {
  extractBasketDocumentServer,
  inferVisionMimeType,
  parseBasketTabularMatrix,
} from '../src/lib/gemini-baskets.ts';
import type {
  BasketComparisonView,
  BasketVersionView,
  ConsumptionTrendResponse,
} from '../src/types/nexo.ts';

describe('Comparador Inteligente de Cestas de Consumo, Tendência 30d e Manual Multi-Escalão', () => {
  beforeEach(() => {
    switchPresentationViewMode('CENARIO_REALISTA');
    resetDemoSandboxState();
  });

  it('interpreta separadores brasileiros (62.888 e 18.207,38), conversão de toneladas e valores ilegíveis sem inventar números', () => {
    assert.equal(parseBrazilianNumber('62.888'), 62888);
    assert.equal(parseBrazilianNumber('18.207,38'), 18207.38);
    assert.equal(parseBrazilianNumber('3.561'), 3561);
    assert.equal(parseBrazilianNumber('9.961,27'), 9961.27);
    assert.equal(parseBrazilianNumber('nao_identificado'), null);
    assert.equal(parseBrazilianNumber('—'), null);

    assert.equal(convertRawQuantityToKg('18,5', 't'), 18500);
    assert.equal(convertRawQuantityToKg('7.218,16', 'kg'), 7218.16);
    assert.equal(convertRawQuantityToKg('nao_identificado', 'kg'), null);
  });

  it('calcula exatamente o comparativo 25/11 (07:00 vs 19:00) em L1–L7 sem inverter materiais nem trocar linhas', () => {
    const baseState = createInitialDemoState();
    const versions = buildReference2511BasketVersions(baseState.materials);
    assert.equal(versions.length, 4);

    const v07 = versions[0];
    const v19 = versions[3];
    const cmp = compareBasketVersions({
      comparisonId: 99,
      productionDate: '2026-11-25',
      baseVersion: { id: v07.id, label: v07.label, emissionTime: v07.emissionTime },
      targetVersion: { id: v19.id, label: v19.label, emissionTime: v19.emissionTime },
      baseItems: v07.items,
      targetItems: v19.items,
      silos: baseState.silos,
      materials: baseState.materials,
      transferRules: baseState.transferRules,
    });

    assert.equal(cmp.lineSummaries.length, 7);

    const l4Calcario = cmp.diffItems.find(
      (d) => d.lineCode === 'L4' && d.materialCode === '2017101021'
    )!;
    assert.equal(l4Calcario.previousQuantityKg, 62888);
    assert.equal(l4Calcario.newQuantityKg, 18207.38);
    assert.equal(l4Calcario.diffKg, -44680.62);
    assert.equal(l4Calcario.classification, 'DIMINUIU');

    const l4Premix = cmp.diffItems.find(
      (d) => d.lineCode === 'L4' && d.materialCode === '1113101920'
    )!;
    assert.equal(l4Premix.previousQuantityKg, 3561);
    assert.equal(l4Premix.newQuantityKg, 9961.27);
    assert.equal(l4Premix.diffKg, 6400.27);
    assert.equal(l4Premix.classification, 'AUMENTOU');

    const l4Fosfato = cmp.diffItems.find(
      (d) => d.lineCode === 'L4' && d.materialCode === '2019131030'
    )!;
    assert.equal(l4Fosfato.previousQuantityKg, 11492);
    assert.equal(l4Fosfato.newQuantityKg, 2709.97);
    assert.equal(l4Fosfato.diffKg, -8782.03);
    assert.equal(l4Fosfato.classification, 'DIMINUIU');

    const l4Sal = cmp.diffItems.find(
      (d) => d.lineCode === 'L4' && d.materialCode === '2021171023'
    )!;
    assert.equal(l4Sal.previousQuantityKg, 30115);
    assert.equal(l4Sal.newQuantityKg, 7218.16);
    assert.equal(l4Sal.diffKg, -22896.84);
    assert.equal(l4Sal.classification, 'DIMINUIU');

    const l3Visceras = cmp.diffItems.find(
      (d) => d.lineCode === 'L3' && d.materialCode === '1553241021'
    )!;
    assert.equal(l3Visceras.classification, 'NOVO_MATERIAL');
    assert.equal(l3Visceras.newQuantityKg, 8400);
  });

  it('sinaliza itens ilegíveis ou sem código para conferência humana e permite correção via PATCH antes de publicar', async () => {
    const vBase = await handleDemoApiFetch<BasketVersionView>('/api/baskets/versions', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Teste Base',
        productionDate: '2026-11-26',
        emissionTime: '07:00',
        sourceType: 'CAMERA_TABLET',
        items: [
          {
            lineCode: 'L4',
            materialCode: '2017101021',
            materialDescription: 'CALCARIO',
            rawQuantityText: '50.000',
            unit: 'kg',
            sourcePage: 1,
            confidence: 'ALTA',
            needsReview: false,
          },
        ],
      }),
    });

    const vNewDraft = await handleDemoApiFetch<BasketVersionView>('/api/baskets/versions', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Teste Ilegível',
        productionDate: '2026-11-26',
        emissionTime: '19:00',
        sourceType: 'CAMERA_TABLET',
        items: [
          {
            lineCode: 'L4',
            materialCode: '2017101021',
            materialDescription: 'CALCARIO',
            rawQuantityText: 'nao_identificado',
            plannedQuantityKg: null,
            unit: 'kg',
            sourcePage: 1,
            confidence: 'BAIXA',
            needsReview: true,
            reviewReason: 'Quantidade borrada na fotografia.',
          },
        ],
      }),
    });
    assert.equal(vNewDraft.status, 'RASCUNHO');
    assert.equal(vNewDraft.items[0].needsReview, true);

    const cmpPending = await handleDemoApiFetch<BasketComparisonView>('/api/baskets/compare', {
      method: 'POST',
      body: JSON.stringify({
        baseVersionId: vBase.id,
        targetVersionId: vNewDraft.id,
      }),
    });
    assert.equal(cmpPending.counts.pendingReview, 1);
    assert.equal(cmpPending.diffItems[0].classification, 'PENDENTE_CONFERENCIA');

    const vReviewed = await handleDemoApiFetch<BasketVersionView>(
      `/api/baskets/versions/${vNewDraft.id}/items`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          items: [
            {
              id: vNewDraft.items[0].id,
              lineCode: 'L4',
              materialCode: '2017101021',
              materialDescription: 'CALCARIO',
              rawQuantityText: '62.500',
              plannedQuantityKg: 62500,
              unit: 'kg',
              needsReview: false,
            },
          ],
        }),
      }
    );
    assert.equal(vReviewed.status, 'CONFERIDA');

    const cmpOk = await handleDemoApiFetch<BasketComparisonView>('/api/baskets/compare', {
      method: 'POST',
      body: JSON.stringify({
        baseVersionId: vBase.id,
        targetVersionId: vReviewed.id,
      }),
    });
    assert.equal(cmpOk.counts.pendingReview, 0);
    assert.equal(cmpOk.diffItems[0].diffKg, 12500);
    assert.equal(cmpOk.diffItems[0].classification, 'AUMENTOU');
  });

  it('publica nova cesta arquivando versões anteriores sem apagar histórico e sem alterar estoque físico dos silos', async () => {
    const stockBefore = getDemoStateSnapshot().silos.map((s) => ({
      id: s.id,
      stock: s.confirmedStockKg,
    }));

    const v1 = await handleDemoApiFetch<BasketVersionView>('/api/baskets/versions', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Cesta Manhã 07:00',
        productionDate: '2026-11-27',
        emissionTime: '07:00',
        sourceType: 'MANUAL',
        items: [
          {
            lineCode: 'L4',
            materialCode: '2017101021',
            materialDescription: 'CALCARIO',
            plannedQuantityKg: 20000,
            unit: 'kg',
          },
        ],
      }),
    });
    const v2 = await handleDemoApiFetch<BasketVersionView>('/api/baskets/versions', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Cesta Atualizada 19:00',
        productionDate: '2026-11-27',
        emissionTime: '19:00',
        sourceType: 'MANUAL',
        items: [
          {
            lineCode: 'L4',
            materialCode: '2017101021',
            materialDescription: 'CALCARIO',
            plannedQuantityKg: 28000,
            unit: 'kg',
          },
        ],
      }),
    });
    const cmp = await handleDemoApiFetch<BasketComparisonView>('/api/baskets/compare', {
      method: 'POST',
      body: JSON.stringify({ baseVersionId: v1.id, targetVersionId: v2.id }),
    });

    const pub = await handleDemoApiFetch<{
      comparison: BasketComparisonView;
      notification: { type: string; comparisonId: number };
    }>('/api/baskets/publish', {
      method: 'POST',
      body: JSON.stringify({ comparisonId: cmp.id }),
    });

    assert.equal(pub.comparison.status, 'PUBLICADA');
    assert.equal(pub.notification.type, 'basket:published');
    assert.equal(pub.notification.comparisonId, cmp.id);

    const stockAfter = getDemoStateSnapshot().silos.map((s) => ({
      id: s.id,
      stock: s.confirmedStockKg,
    }));
    assert.deepEqual(stockAfter, stockBefore);
  });

  it('respeita RBAC do Comparador de Cestas entre Operador, Produção, Supervisão e Admin', () => {
    assert.equal(hasPermission('OPERADOR_MOEGA', 'baskets:view'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'baskets:publish'), false);
    assert.equal(hasPermission('PRODUCAO', 'baskets:view'), true);
    assert.equal(hasPermission('PRODUCAO', 'baskets:publish'), false);
    assert.equal(hasPermission('PRODUCAO', 'baskets:executive_view'), false);
    assert.equal(hasPermission('SUPERVISOR', 'baskets:publish'), true);
    assert.equal(hasPermission('SUPERVISOR', 'baskets:executive_view'), true);
    assert.equal(hasPermission('ADMIN', 'baskets:publish'), true);
    assert.equal(hasPermission('ADMIN', 'baskets:export'), true);
  });

  it('retorna série de 30 dias no dashboard separando previsto e realizado com filtros por linha e material', async () => {
    const state = createInitialDemoState();
    const trend30 = buildDemo30DayConsumptionTrend(state, { days: 30, lineCode: 'TODAS' });
    assert.equal(trend30.series.length, 30);
    assert.ok(trend30.totals.plannedTons > 0);
    assert.ok(trend30.totals.realizedTons > 0);

    const apiL4 = await handleDemoApiFetch<ConsumptionTrendResponse>(
      '/api/dashboard/consumption-trend?days=14&lineCode=L4'
    );
    assert.equal(apiL4.series.length, 14);
    assert.equal(apiL4.lineCode, 'L4');
    assert.ok(apiL4.totals.plannedTons <= trend30.totals.plannedTons);
  });

  it('gera arquivos binários reais PDF e XLSX para o Comparador de Cestas', async () => {
    const state = createInitialDemoState();
    const cmp = state.basketComparisons[0];
    assert.ok(cmp, 'Demo deve iniciar com comparação 25/11');

    const baseInput = {
      reportTitle: `Comparativo de Cestas — ${cmp.productionDate}`,
      reportType: 'COMPARADOR_CESTAS',
      periodLabel: `${cmp.productionDate} (${cmp.baseVersionLabel} -> ${cmp.targetVersionLabel})`,
      filtersSummary: 'Linhas L1 a L7',
      dataOrigin: 'TESTE_AUTOMATIZADO',
      generatedByName: 'Supervisor Teste',
      generatedByRole: 'SUPERVISOR',
      generatedAtIso: new Date().toISOString(),
      columns: [
        { key: 'lineCode', header: 'Linha', width: 10 },
        { key: 'materialDescription', header: 'Matéria-Prima', width: 32 },
        { key: 'previousQuantityKg', header: 'Anterior (kg)', width: 16, align: 'right' as const },
        { key: 'newQuantityKg', header: 'Novo (kg)', width: 16, align: 'right' as const },
        { key: 'diffKg', header: 'Diferença (kg)', width: 16, align: 'right' as const },
      ],
      rows: cmp.diffItems.map((d) => ({
        lineCode: d.lineCode,
        materialDescription: d.materialDescription,
        previousQuantityKg: d.previousQuantityKg ?? '—',
        newQuantityKg: d.newQuantityKg ?? '—',
        diffKg: d.diffKg ?? '—',
      })),
    };

    const pdfOut = await exportReportDocument({ ...baseInput, format: 'PDF' });
    assert.equal(pdfOut.buffer.subarray(0, 4).toString('utf8'), '%PDF');

    const xlsxOut = await exportReportDocument({ ...baseInput, format: 'XLSX' });
    assert.equal(xlsxOut.buffer.subarray(0, 2).toString('utf8'), 'PK');
  });

  it('fornece manual completo para todos os 5 escalões com matriz de permissões RBAC', () => {
    assert.equal(ROLE_MANUAL_TIERS.length, 5);
    const ids = ROLE_MANUAL_TIERS.map((p) => p.id);
    assert.deepEqual(ids, ['OPERADOR_MOEGA', 'PRODUCAO', 'PCP_PLANEJAMENTO', 'SUPERVISOR', 'ADMIN']);
    assert.ok(PERMISSION_MATRIX_ROWS.length >= 10);
  });

  it('infere MIME types de fotos de tablet e PDFs corretamente e valida extração tabular e erro explícito sem GEMINI_API_KEY', async () => {
    assert.equal(inferVisionMimeType('foto_cesta_pag1.jpg', 'application/octet-stream'), 'image/jpeg');
    assert.equal(inferVisionMimeType('cesta_programacao.pdf', ''), 'application/pdf');
    assert.equal(inferVisionMimeType('captura.png', 'image/png'), 'image/png');

    const state = createInitialDemoState();
    const matrix = [
      ['Linha', 'Codigo', 'Materia-Prima', 'Quantidade', 'Unidade'],
      ['Linha 4', '2017101021', 'CALCARIO', '18.207,38', 'kg'],
      ['Linha 4', '', 'ITEM SEM CODIGO', 'nao_identificado', 'kg'],
    ];
    const parsed = parseBasketTabularMatrix(matrix, 'cesta-25-11.xlsx', state.materials);
    assert.equal(parsed.items.length, 2);
    assert.equal(parsed.items[0].lineCode, 'L4');
    assert.equal(parsed.items[0].materialCode, '2017101021');
    assert.equal(parsed.items[0].plannedQuantityKg, 18207.38);
    assert.equal(parsed.items[0].needsReview, false);

    assert.equal(parsed.items[1].plannedQuantityKg, null);
    assert.equal(parsed.items[1].confidence, 'BAIXA');
    assert.equal(parsed.items[1].needsReview, true);

    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await assert.rejects(
        () =>
          extractBasketDocumentServer({
            sourceType: 'CAMERA_TABLET',
            pages: [
              {
                pageNumber: 1,
                fileName: 'cesta.jpg',
                mimeType: 'image/jpeg',
                base64Content: 'AAAA',
              },
            ],
            materials: state.materials,
          }),
        /GEMINI_API_KEY/
      );
    } finally {
      if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    }
  });
});
