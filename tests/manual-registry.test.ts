import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_NAV_SECTION_IDS,
  AUTO_FEATURE_MANUALS,
  buildAutoHelpArticles,
  buildDemoHelpArticles,
  getFeatureManualsForSection,
} from '../src/lib/manual-registry.ts';
import {
  handleDemoApiFetch,
  resetDemoSandboxState,
  switchPresentationViewMode,
} from '../src/lib/demo-api.ts';
import { computeProactiveMaterialThresholdAlerts } from '../src/lib/volume-history.ts';
import type {
  MaterialItem,
  SiloDetail,
  SiloVolumeHistory24hResponse,
  StockThresholdItem,
} from '../src/types/nexo.ts';

describe('Padronização Automática do Manual & Novas Funcionalidades do Mapa de Silos', () => {
  beforeEach(() => {
    switchPresentationViewMode('CENARIO_REALISTA');
    resetDemoSandboxState();
  });

  it('garante que toda seção de navegação e nova funcionalidade possui instrução automática no manual', () => {
    const coveredSections = new Set(AUTO_FEATURE_MANUALS.map((m) => m.sectionId));
    for (const sec of ALL_NAV_SECTION_IDS) {
      assert.ok(
        coveredSections.has(sec),
        `Seção '${sec}' não possui instrução cadastrada em AUTO_FEATURE_MANUALS`
      );
      const sectionEntries = getFeatureManualsForSection(sec);
      assert.ok(sectionEntries.length >= 1, `Seção '${sec}' retornou 0 guias`);
    }

    const slugs = new Set<string>();
    const ids = new Set<string>();
    for (const entry of AUTO_FEATURE_MANUALS) {
      assert.ok(!ids.has(entry.id), `ID duplicado no manual: ${entry.id}`);
      assert.ok(!slugs.has(entry.slug), `Slug duplicado no manual: ${entry.slug}`);
      ids.add(entry.id);
      slugs.add(entry.slug);

      assert.ok(entry.title.trim().length >= 5, `Título inválido em ${entry.id}`);
      assert.ok(entry.summary.trim().length >= 10, `Resumo inválido em ${entry.id}`);
      assert.ok(entry.steps.length >= 2, `Passo a passo obrigatório em ${entry.id}`);
      assert.ok(entry.targetRoles.length >= 1, `Perfis alvo obrigatórios em ${entry.id}`);
      assert.ok(entry.keywords.length >= 2, `Palavras-chave obrigatórias em ${entry.id}`);
    }

    assert.ok(
      slugs.has('mapa-silos-historico-24h'),
      'Manual deve incluir instrução automática para Histórico 24h do Mapa de Silos'
    );
    assert.ok(
      slugs.has('mapa-limiares-estoque-material'),
      'Manual deve incluir instrução automática para Limiares por Matéria-Prima'
    );

    const dbSeeds = buildAutoHelpArticles();
    const demoHelp = buildDemoHelpArticles();
    assert.equal(dbSeeds.length, AUTO_FEATURE_MANUALS.length);
    assert.equal(demoHelp.length, AUTO_FEATURE_MANUALS.length);
  });

  it('reconstrói histórico horário das últimas 24h reconciliado com o saldo atual e filtros', async () => {
    const silos = await handleDemoApiFetch<SiloDetail[]>('/api/silos');
    const all24h = await handleDemoApiFetch<SiloVolumeHistory24hResponse>(
      '/api/silos/volume-history-24h'
    );

    assert.equal(all24h.windowHours, 24);
    assert.equal(all24h.series.length, 24);
    assert.equal(all24h.totals.silosIncludedCount, 54);

    const totalCurrentKg = Math.round(
      silos.reduce((acc, s) => acc + s.confirmedStockKg, 0) * 100
    ) / 100;
    assert.equal(all24h.totals.currentVolumeKg, totalCurrentKg);
    assert.equal(all24h.series[23].volumeKg, totalCurrentKg);
    assert.ok(all24h.totals.inbound24hKg > 0, 'Deve refletir entradas reais/demo nas 24h');
    assert.ok(all24h.totals.outbound24hKg > 0, 'Deve refletir saídas/consumos nas 24h');

    const silo12 = silos.find((s) => s.siloNumber === 12)!;
    const onlySilo12 = await handleDemoApiFetch<SiloVolumeHistory24hResponse>(
      `/api/silos/volume-history-24h?siloId=${silo12.id}`
    );
    assert.equal(onlySilo12.totals.silosIncludedCount, 1);
    assert.equal(onlySilo12.totals.currentVolumeKg, silo12.confirmedStockKg);

    const onlyStorage = await handleDemoApiFetch<SiloVolumeHistory24hResponse>(
      '/api/silos/volume-history-24h?category=ARMAZENAGEM'
    );
    assert.equal(onlyStorage.totals.silosIncludedCount, 9);
  });

  it('configura limiar específico por matéria-prima e dispara notificações proativas nos silos afetados', async () => {
    const materials = await handleDemoApiFetch<MaterialItem[]>('/api/materials');
    const silosBefore = await handleDemoApiFetch<SiloDetail[]>('/api/silos');
    const calcario = materials.find((m) => m.code === '2017101021')!;
    const totalCalcarioKg = silosBefore
      .filter((s) => s.primaryMaterialId === calcario.id)
      .reduce((acc, s) => acc + s.confirmedStockKg, 0);

    // Configura limiar global da MP acima do estoque consolidado para acionar alerta crítico proativo
    await handleDemoApiFetch('/api/stock-thresholds', {
      method: 'POST',
      body: JSON.stringify({
        materialId: calcario.id,
        siloId: null,
        minStockKg: Math.round(totalCalcarioKg + 5000),
        warningStockKg: Math.round(totalCalcarioKg + 15000),
        notes: 'Teste limiar global por matéria-prima',
      }),
    });

    const silosAfter = await handleDemoApiFetch<SiloDetail[]>('/api/silos');
    const thresholds = await handleDemoApiFetch<StockThresholdItem[]>('/api/stock-thresholds');

    const calcarioSilos = silosAfter.filter((s) => s.primaryMaterialId === calcario.id);
    assert.ok(calcarioSilos.length >= 1);
    for (const s of calcarioSilos) {
      assert.equal(s.stockAlertLevel, 'CRITICO');
    }

    const proactiveAlerts = computeProactiveMaterialThresholdAlerts({
      silos: silosAfter,
      thresholds,
    });
    const calcAlert = proactiveAlerts.find(
      (a) => a.materialId === calcario.id && a.scope === 'MATERIAL'
    );
    assert.ok(calcAlert, 'Alerta proativo global de Calcário deve existir');
    assert.equal(calcAlert!.severity, 'CRITICO');
    assert.match(calcAlert!.message, /CRÍTICO POR MATERIAL/i);
  });
});
