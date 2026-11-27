import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canAccessSection,
  EXPERIENCE_MODES_META,
  getAllowedExperienceModes,
  getDefaultExperienceMode,
  isAdminOnlySection,
} from '../src/lib/experience-modes.ts';
import { hasPermission, ROLE_PERMISSIONS } from '../src/lib/rbac.ts';
import { CORE_PLAIN_GUIDES } from '../src/components/layout/ContextualHelpModal.tsx';
import {
  SiloRuleSnapshot,
  validateReceiptDistributionPlan,
  validateTransferExecution,
} from '../src/lib/inventory-rules.ts';
import { handleDemoApiFetch, resetDemoSandboxState } from '../src/lib/demo-api.ts';
import { createInitialDemoState } from '../src/lib/demo-data.ts';
import type {
  NavSectionId,
  OperationalIndicatorsOverview,
  ReceiptItem,
  SiloDetail,
} from '../src/types/nexo.ts';

function readWorkspaceFile(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

describe('Reestruturação UX/UI — Modos por Perfil, Fluxos Guiados, Permissões e Preservação Fases 1–5', () => {
  beforeEach(() => {
    resetDemoSandboxState();
  });

  it('1. Operador inicia recebimento sem treinamento técnico (Modo Operacional + Fluxo Guiado 6 etapas + execução real)', async () => {
    assert.deepEqual(getAllowedExperienceModes('OPERADOR_MOEGA'), ['OPERACIONAL']);
    assert.equal(getDefaultExperienceMode('OPERADOR_MOEGA', false), 'OPERACIONAL');
    assert.equal(canAccessSection('OPERADOR_MOEGA', 'recebimentos'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'receipts:execute'), true);

    const receivingCode = readWorkspaceFile('src/pages/ReceivingPage.tsx');
    for (const stepTitle of [
      'IDENTIFICAR CARGA',
      'CONFERIR MATERIAL',
      'SELECIONAR SILO',
      'INFORMAR QUANTIDADE',
      'REVISAR',
      'CONFIRMAR',
    ]) {
      assert.ok(receivingCode.includes(stepTitle), `Etapa guiada ausente: ${stepTitle}`);
    }
    assert.ok(receivingCode.includes('VOLTAR') && receivingCode.includes('CONTINUAR'));
    assert.ok(receivingCode.includes('Mais informações'));

    const state = createInitialDemoState();
    const targetSilo = state.silos.find(
      (s) => s.operationalStatus === 'OPERACIONAL' && s.primaryMaterialId && s.availableSpaceKg >= 1500
    )!;
    assert.ok(targetSilo);

    const created = await handleDemoApiFetch<{ receipt: ReceiptItem; warnings: string[] }>('/api/receipts', {
      method: 'POST',
      body: JSON.stringify({
        receivingType: 'GRANEL',
        supplierId: state.suppliers[0].id,
        materialId: targetSilo.primaryMaterialId,
        lotCode: 'LOTE-UX-001',
        receivedQuantityKg: 1000,
        distributions: [{ siloId: targetSilo.id, quantityKg: 1000 }],
      }),
    });
    assert.ok(created.receipt.receiptNumber);
  });

  it('2. Operador encontra leitura de etiqueta diretamente na tela inicial e entra direto no Passo 2', () => {
    assert.equal(canAccessSection('OPERADOR_MOEGA', 'etiquetas'), true);
    const opHome = readWorkspaceFile('src/pages/modes/OperationalHomePage.tsx');
    const appCode = readWorkspaceFile('src/App.tsx');
    assert.ok(opHome.includes('LER ETIQUETA'));
    assert.ok(opHome.includes("onNavigate('etiquetas')"));
    assert.ok(appCode.includes("initialWizardStep={activeSection === 'etiquetas' ? 1 : 0}"));
  });

  it('3. Operador consulta silo em Visão Simples por padrão, preservando os 54 silos sem 27/30 e com detalhes sob demanda', () => {
    assert.equal(canAccessSection('OPERADOR_MOEGA', 'mapa'), true);
    const mapCode = readWorkspaceFile('src/pages/SiloMapPage.tsx');
    assert.ok(mapCode.includes("experienceMode === 'OPERACIONAL' ? 'SIMPLES' : 'DETALHADA'"));
    assert.ok(mapCode.includes('Visão Simples') && mapCode.includes('Visão Detalhada'));
    assert.ok(mapCode.includes('VER DETALHES'));
    assert.ok(mapCode.includes('CRÍTICO') && mapCode.includes('BAIXO') && mapCode.includes('OK'));

    const state = createInitialDemoState();
    assert.equal(state.silos.length, 54);
    const nums = new Set(state.silos.map((s) => s.siloNumber));
    assert.equal(nums.has(27), false);
    assert.equal(nums.has(30), false);
  });

  it('4. Operador identifica alertas reais na tela inicial sem poluição nem alertas fictícios', () => {
    const opHome = readWorkspaceFile('src/pages/modes/OperationalHomePage.tsx');
    assert.ok(opHome.includes('ALERTAS'));
    assert.ok(opHome.includes('Atenção Agora na Operação'));
    assert.ok(opHome.includes('criticalSilos') && opHome.includes('lowSilos'));
    assert.ok(opHome.includes('pendingReceipts') && opHome.includes('openShiftPendencies'));
  });

  it('5. Operador registra transferência autorizada no Fluxo Guiado e sistema bloqueia rota não autorizada', async () => {
    assert.equal(canAccessSection('OPERADOR_MOEGA', 'transferencias'), true);
    assert.equal(hasPermission('OPERADOR_MOEGA', 'transfers:execute'), true);

    const transfersCode = readWorkspaceFile('src/pages/TransfersPage.tsx');
    assert.ok(transfersCode.includes('Fluxo Guiado'));
    assert.ok(transfersCode.includes('1. ESCOLHER CAMINHO AUTORIZADO ENTRE SILOS'));
    assert.ok(transfersCode.includes('2. INFORMAR QUANTOS QUILOS VÃO SER TRANSFERIDOS'));
    assert.ok(transfersCode.includes('3. CONFERIR E CONFIRMAR A TRANSFERÊNCIA'));

    const state = createInitialDemoState();
    const activeRule = state.transferRules.find((r) => r.isActive)!;
    const blockedRule = state.transferRules.find((r) => !r.isActive)!;
    assert.ok(activeRule && blockedRule);

    const silosBefore = await handleDemoApiFetch<SiloDetail[]>('/api/silos');
    const orig = silosBefore.find((s) => s.id === activeRule.originSiloId)!;
    const dest = silosBefore.find((s) => s.id === activeRule.destinationSiloId)!;
    const moveQty = Math.min(200, orig.confirmedStockKg, dest.availableSpaceKg);
    assert.ok(moveQty > 0);

    const exec = await handleDemoApiFetch<{ referenceDocument: string }>('/api/transfers/execute', {
      method: 'POST',
      body: JSON.stringify({
        originSiloId: activeRule.originSiloId,
        destinationSiloId: activeRule.destinationSiloId,
        materialId: activeRule.materialId,
        quantityKg: moveQty,
      }),
    });
    assert.ok(exec.referenceDocument);

    // Validador oficial de domínio rejeita rota não autorizada/inativa
    const blockedOrig = silosBefore.find((s) => s.id === blockedRule.originSiloId)!;
    const blockedDest = silosBefore.find((s) => s.id === blockedRule.destinationSiloId)!;
    const blockedValidation = validateTransferExecution({
      originSilo: {
        id: blockedOrig.id,
        siloNumber: blockedOrig.siloNumber,
        operationalStatus: blockedOrig.operationalStatus,
        primaryMaterialId: blockedOrig.primaryMaterialId,
        nominalCapacityKg: blockedOrig.nominalCapacityKg,
        safeCapacityKg: blockedOrig.safeCapacityKg,
        confirmedStockKg: blockedOrig.confirmedStockKg,
      },
      destinationSilo: {
        id: blockedDest.id,
        siloNumber: blockedDest.siloNumber,
        operationalStatus: blockedDest.operationalStatus,
        primaryMaterialId: blockedDest.primaryMaterialId,
        nominalCapacityKg: blockedDest.nominalCapacityKg,
        safeCapacityKg: blockedDest.safeCapacityKg,
        confirmedStockKg: blockedDest.confirmedStockKg,
      },
      materialId: blockedRule.materialId,
      quantityKg: 100,
      rule: {
        isActive: blockedRule.isActive,
        validationStatus: blockedRule.validationStatus,
        authorizationStatus: blockedRule.authorizationStatus,
        maxQuantityKg: blockedRule.maxQuantityKg ? Number(blockedRule.maxQuantityKg) : null,
      },
    });
    assert.equal(blockedValidation.valid, false);
    assert.ok(blockedValidation.errors.length > 0);
  });

  it('6. Gestor (Supervisor/Admin) acessa Modo Gerencial, relatórios e indicadores reais', async () => {
    assert.deepEqual(getAllowedExperienceModes('SUPERVISOR'), ['OPERACIONAL', 'GERENCIAL']);
    assert.equal(getDefaultExperienceMode('SUPERVISOR', false), 'GERENCIAL');
    assert.equal(canAccessSection('SUPERVISOR', 'relatorios'), true);
    assert.equal(hasPermission('SUPERVISOR', 'reports:export'), true);

    const overview = await handleDemoApiFetch<OperationalIndicatorsOverview>('/api/reports/overview');
    assert.equal(overview.indicators.totalSilosCount, 54);
    assert.ok(overview.indicators.totalConfirmedStockKg > 0);
  });

  it('7. Administrador encontra Modo Administração, usuários, permissões e diagnóstico', () => {
    assert.deepEqual(getAllowedExperienceModes('ADMIN'), [
      'OPERACIONAL',
      'GERENCIAL',
      'ADMINISTRACAO',
    ]);
    assert.equal(canAccessSection('ADMIN', 'admin'), true);
    assert.equal(canAccessSection('ADMIN', 'auditoria'), true);
    assert.ok(EXPERIENCE_MODES_META.ADMINISTRACAO.label.includes('Administração'));

    const adminHome = readWorkspaceFile('src/pages/modes/AdminHomePage.tsx');
    assert.ok(adminHome.includes('Usuários, Perfis e Permissões (RBAC)'));
    assert.ok(adminHome.includes('Rotas Autorizadas entre Silos'));
    assert.ok(adminHome.includes('Auditoria & Diagnóstico do Sistema'));
  });

  it('8. Operador e Produção NÃO acessam área administrativa nem módulo de administração/auditoria', () => {
    for (const restrictedRole of ['OPERADOR_MOEGA', 'PRODUCAO'] as const) {
      assert.deepEqual(getAllowedExperienceModes(restrictedRole), ['OPERACIONAL']);
      assert.equal(canAccessSection(restrictedRole, 'admin'), false);
      assert.equal(canAccessSection(restrictedRole, 'auditoria'), false);
      assert.equal(hasPermission(restrictedRole, 'users:manage'), false);
      assert.equal(hasPermission(restrictedRole, 'audit:view'), false);
    }
    assert.equal(isAdminOnlySection('admin'), true);
    assert.equal(isAdminOnlySection('auditoria'), true);
    assert.equal(isAdminOnlySection('recebimentos'), false);

    const appCode = readWorkspaceFile('src/App.tsx');
    assert.ok(appCode.includes('if (!canAccessSection(role, activeSection))'));
  });

  it('9. Responsividade Tablet / Mobile / Desktop e barra inferior enxuta', () => {
    const layoutCode = readWorkspaceFile('src/components/layout/AppLayout.tsx');
    const opHome = readWorkspaceFile('src/pages/modes/OperationalHomePage.tsx');
    assert.ok(layoutCode.includes('lg:hidden') && layoutCode.includes('h-[58px]'));
    assert.ok(layoutCode.includes('pb-24 sm:p-6 lg:pb-8'));
    assert.ok(opHome.includes('grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'));
    assert.ok(opHome.includes('min-h-[168px]'));
  });

  it('10 & 11. Nenhuma funcionalidade anterior das Fases 1–5 foi perdida e nenhum botão está inerte', () => {
    const allPhaseSections: NavSectionId[] = [
      'inicio',
      'executivo',
      'painel',
      'mapa',
      'recebimentos',
      'etiquetas',
      'distribuicao',
      'transferencias',
      'estoque',
      'programacao',
      'consumo',
      'abastecimento',
      'relatorios',
      'turnos',
      'ocorrencias',
      'assistente',
      'auditoria',
      'admin',
      'guia',
    ];
    const appCode = readWorkspaceFile('src/App.tsx');
    for (const sec of allPhaseSections) {
      assert.ok(appCode.includes(`'${sec}'`), `Seção ${sec} precisa estar registrada em App.tsx`);
      if (sec !== 'executivo') {
        assert.equal(canAccessSection('ADMIN', sec), true, `ADMIN precisa alcançar ${sec}`);
      }
    }

    const opHome = readWorkspaceFile('src/pages/modes/OperationalHomePage.tsx');
    assert.ok(!opHome.includes('onClick={() => {}}'), 'Nenhum botão inerte permitido em OperationalHomePage');
    const mgrHome = readWorkspaceFile('src/pages/modes/ManagerialHomePage.tsx');
    assert.ok(!mgrHome.includes('onClick={() => {}}'), 'Nenhum botão inerte permitido em ManagerialHomePage');
    const adminHome = readWorkspaceFile('src/pages/modes/AdminHomePage.tsx');
    assert.ok(!adminHome.includes('onClick={() => {}}'), 'Nenhum botão inerte permitido em AdminHomePage');
  });

  it('12 & 13. Regras de validação e Fases 1–5 preservadas (turnos, capacidades, RBAC)', () => {
    const state = createInitialDemoState();
    assert.equal(state.shifts.length, 3);
    assert.equal(state.shifts[0].startTime, '07:30');
    assert.equal(state.shifts[0].endTime, '17:18');
    assert.equal(state.shifts[1].startTime, '17:00');
    assert.equal(state.shifts[1].endTime, '02:12');
    assert.equal(state.shifts[2].startTime, '23:28');
    assert.equal(state.shifts[2].endTime, '07:30');

    // Validação oficial impede ultrapassar a capacidade segura (-10%)
    const target = state.silos.find((s) => s.operationalStatus === 'OPERACIONAL' && s.primaryMaterialId)!;
    const siloSnapshots = new Map<number, SiloRuleSnapshot>(
      state.silos.map((s) => [
        s.id,
        {
          id: s.id,
          siloNumber: s.siloNumber,
          operationalStatus: s.operationalStatus,
          primaryMaterialId: s.primaryMaterialId,
          nominalCapacityKg: s.nominalCapacityKg,
          safeCapacityKg: s.safeCapacityKg,
          confirmedStockKg: s.confirmedStockKg,
        },
      ])
    );
    const overflowPlan = validateReceiptDistributionPlan({
      materialId: target.primaryMaterialId!,
      receivedQuantityKg: target.safeCapacityKg + 50000,
      alreadyDistributedKg: 0,
      distributions: [{ siloId: target.id, quantityKg: target.safeCapacityKg + 50000 }],
      silosById: siloSnapshots,
      compatibilities: [
        {
          siloId: target.id,
          materialId: target.primaryMaterialId!,
          allowReceiving: true,
          allowTransferIn: true,
          allowTransferOut: true,
        },
      ],
    });
    assert.equal(overflowPlan.valid, false);
    assert.ok(overflowPlan.errors.length > 0);

    assert.ok(ROLE_PERMISSIONS.ADMIN.includes('users:manage'));
    assert.ok(!ROLE_PERMISSIONS.OPERADOR_MOEGA.includes('users:manage'));
  });

  it('14. Manual interativo "COMO UTILIZAR?" acessível em todas as telas com os 7 guias em linguagem simples', () => {
    const layoutCode = readWorkspaceFile('src/components/layout/AppLayout.tsx');
    assert.ok(layoutCode.includes('COMO UTILIZAR?'));
    assert.ok(layoutCode.includes('onOpenHelp'));

    assert.equal(CORE_PLAIN_GUIDES.length, 7);
    const ids = CORE_PLAIN_GUIDES.map((g) => g.id);
    assert.deepEqual(ids, [
      'recebimento',
      'etiqueta',
      'silo',
      'transferencia',
      'abastecimento',
      'turno',
      'relatorio',
    ]);
    for (const guide of CORE_PLAIN_GUIDES) {
      assert.ok(guide.steps.length >= 3, `Guia ${guide.id} deve ter passos claros`);
      assert.ok(guide.keywords.length >= 4, `Guia ${guide.id} deve ter busca por palavras comuns`);
    }
  });
});
