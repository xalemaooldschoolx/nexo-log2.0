import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { SiloMapPage } from './pages/SiloMapPage.tsx';
import { CatalogPage } from './pages/CatalogPage.tsx';
import { ReceivingPage } from './pages/ReceivingPage.tsx';
import { TransfersPage } from './pages/TransfersPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { AuditPage } from './pages/AuditPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { GuidePage } from './pages/GuidePage.tsx';
import { ProductionSchedulePage } from './pages/ProductionSchedulePage.tsx';
import { BasketComparatorPage } from './pages/BasketComparatorPage.tsx';
import { ConsumptionIntelligencePage } from './pages/ConsumptionIntelligencePage.tsx';
import { SupplyCenterPage } from './pages/SupplyCenterPage.tsx';
import { ShiftsHandoverPage } from './pages/ShiftsHandoverPage.tsx';
import { OccurrencesPage } from './pages/OccurrencesPage.tsx';
import { NexoAssistantPage } from './pages/NexoAssistantPage.tsx';
import { ExecutivePresentationPage } from './pages/ExecutivePresentationPage.tsx';
import { RoadmapModulePage } from './pages/RoadmapModulePage.tsx';
import { OperationalHomePage } from './pages/modes/OperationalHomePage.tsx';
import { ManagerialHomePage } from './pages/modes/ManagerialHomePage.tsx';
import { AdminHomePage } from './pages/modes/AdminHomePage.tsx';
import { AppLayout } from './components/layout/AppLayout.tsx';
import { ContextualHelpModal } from './components/layout/ContextualHelpModal.tsx';
import { useBasketNotifications } from './hooks/useBasketNotifications.ts';
import { apiFetch } from './lib/api.ts';
import { hasPermission } from './lib/rbac.ts';
import { computeProactiveMaterialThresholdAlerts } from './lib/volume-history.ts';
import {
  canAccessSection,
  ExperienceMode,
  getAllowedExperienceModes,
  getDefaultExperienceMode,
} from './lib/experience-modes.ts';
import {
  DashboardResponse,
  HelpArticleItem,
  MaterialBagConfigItem,
  MaterialItem,
  NavSectionId,
  SiloDetail,
  StockThresholdItem,
  SupplierItem,
  TransferPlanDraftPrefill,
  TransferRuleItem,
  ValidationPendency,
} from './types/nexo.ts';

const VALID_NAV_SECTIONS: ReadonlySet<NavSectionId> = new Set([
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
  'comparador',
  'consumo',
  'abastecimento',
  'relatorios',
  'turnos',
  'ocorrencias',
  'assistente',
  'auditoria',
  'admin',
  'guia',
]);

function readInitialSectionFromUrl(isDemo: boolean): NavSectionId {
  if (typeof window !== 'undefined') {
    const sec = new URLSearchParams(window.location.search).get('secao') as NavSectionId | null;
    if (sec && VALID_NAV_SECTIONS.has(sec)) return sec;
  }
  return isDemo ? 'executivo' : 'inicio';
}

const NexoWorkspace: React.FC = () => {
  const {
    firebaseUser,
    session,
    isDemoMode,
    presentationViewMode,
    demoHydrationVersion,
    loading,
    enterDemoMode,
    exitDemoMode,
    resetDemoSandbox,
    switchPresentationMode,
    logout,
    refreshSession,
  } = useAuth();
  const [activeSection, setActiveSection] = useState<NavSectionId>(() =>
    readInitialSectionFromUrl(isDemoMode)
  );
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>(() =>
    getDefaultExperienceMode(session?.user.roleCode ?? 'OPERADOR_MOEGA', isDemoMode)
  );
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [preselectedSiloId, setPreselectedSiloId] = useState<number | null>(null);
  const [prefillTransferPlan, setPrefillTransferPlan] = useState<TransferPlanDraftPrefill | null>(null);
  const [focusComparisonId, setFocusComparisonId] = useState<number | null>(null);
  const [shiftReportIntent, setShiftReportIntent] = useState<
    'view' | 'supplement' | 'ai' | 'review' | 'finalize' | null
  >(null);

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [silos, setSilos] = useState<SiloDetail[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierItem[]>([]);
  const [bagConfigs, setBagConfigs] = useState<MaterialBagConfigItem[]>([]);
  const [transferRules, setTransferRules] = useState<TransferRuleItem[]>([]);
  const [pendencies, setPendencies] = useState<ValidationPendency[]>([]);
  const [helpArticles, setHelpArticles] = useState<HelpArticleItem[]>([]);
  const [thresholds, setThresholds] = useState<StockThresholdItem[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const loadWorkspaceData = useCallback(async () => {
    if (!session) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const canFetchThresholds = hasPermission(session.user.roleCode, 'schedules:view');
      const [
        dashRes,
        silosRes,
        matsRes,
        supRes,
        bagRes,
        rulesRes,
        pendRes,
        helpRes,
        thresholdsRes,
      ] = await Promise.all([
        apiFetch<DashboardResponse>('/api/dashboard'),
        apiFetch<SiloDetail[]>('/api/silos'),
        apiFetch<MaterialItem[]>('/api/materials'),
        apiFetch<SupplierItem[]>('/api/suppliers'),
        apiFetch<MaterialBagConfigItem[]>('/api/bag-configs'),
        apiFetch<TransferRuleItem[]>('/api/transfer-rules'),
        apiFetch<ValidationPendency[]>('/api/pendencies'),
        apiFetch<HelpArticleItem[]>('/api/help'),
        canFetchThresholds
          ? apiFetch<StockThresholdItem[]>('/api/stock-thresholds').catch(() => [])
          : Promise.resolve([] as StockThresholdItem[]),
      ]);
      setDashboard(dashRes);
      setSilos(silosRes);
      setMaterials(matsRes);
      setSuppliers(supRes);
      setBagConfigs(bagRes);
      setTransferRules(rulesRes);
      setPendencies(pendRes);
      setHelpArticles(helpRes);
      setThresholds(thresholdsRes);
    } catch (err: any) {
      setDataError(err.message || 'Falha ao carregar dados operacionais.');
    } finally {
      setDataLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      loadWorkspaceData();
    }
  }, [session, isDemoMode, demoHydrationVersion, loadWorkspaceData]);

  const { unreadNotification, wsConnected, dismissUnread } = useBasketNotifications({
    enabled: Boolean(session),
    isDemoMode,
    onBasketPublished: useCallback(() => {
      void loadWorkspaceData();
    }, [loadWorkspaceData]),
  });

  // Keep experienceMode synchronized with user role and demo state
  useEffect(() => {
    const roleCode = session?.user.roleCode;
    if (!roleCode) return;
    const allowed = getAllowedExperienceModes(roleCode);
    setExperienceMode((prev) =>
      allowed.includes(prev) ? prev : getDefaultExperienceMode(roleCode, isDemoMode)
    );
  }, [session?.user.roleCode, isDemoMode]);

  const proactiveThresholdAlerts = useMemo(
    () => computeProactiveMaterialThresholdAlerts({ silos, thresholds }),
    [silos, thresholds]
  );

  useEffect(() => {
    if (isDemoMode) {
      setActiveSection((prev) => {
        if (typeof window !== 'undefined') {
          const sec = new URLSearchParams(window.location.search).get('secao') as NavSectionId | null;
          if (sec && VALID_NAV_SECTIONS.has(sec) && (prev === 'inicio' || prev === 'painel')) return sec;
        }
        return prev === 'inicio' || prev === 'painel' ? 'executivo' : prev;
      });
    } else {
      setActiveSection((prev) => (prev === 'executivo' ? 'inicio' : prev));
    }
  }, [isDemoMode]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A1421] text-[#F4F6F8]">
        <div className="text-center space-y-3">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[#F5B91B] border-t-transparent" />
          <p className="text-sm text-[#AEB8C5]">Validando credenciais e sessão operacional...</p>
        </div>
      </div>
    );
  }

  if (!session || (!firebaseUser && !isDemoMode)) {
    return <LoginPage />;
  }

  const role = session.user.roleCode;
  const allowedModes = getAllowedExperienceModes(role);
  const pendingCount = pendencies.filter((p) => p.status === 'PENDENTE').length;
  const criticalAlertsCount = silos.filter(
    (s) => s.stockAlertLevel === 'CRITICO' || s.stockAlertLevel === 'ATENCAO'
  ).length;

  const handleResetDemo = () => {
    resetDemoSandbox();
    void loadWorkspaceData();
  };

  const handleSelectSection = (sec: NavSectionId) => {
    if (!canAccessSection(role, sec)) {
      setActiveSection('inicio');
      return;
    }
    if (sec !== 'recebimentos' && sec !== 'etiquetas') setPreselectedSiloId(null);
    if (sec !== 'transferencias') setPrefillTransferPlan(null);
    if (sec !== 'turnos') setShiftReportIntent(null);
    setActiveSection(sec);
  };

  const handleSwitchExperienceMode = (mode: ExperienceMode) => {
    if (!allowedModes.includes(mode)) return;
    setExperienceMode(mode);
    setActiveSection('inicio');
  };

  const renderSection = () => {
    // Enforce strict frontend RBAC guard before rendering any view
    if (!canAccessSection(role, activeSection)) {
      return (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-red-100">
            Área Restrita ao Perfil Autorizado
          </h2>
          <p className="text-sm text-red-200/90">
            O seu perfil atual ({session.user.roleName}) não possui permissão para acessar esta tela técnica/administrativa.
          </p>
          <button
            type="button"
            onClick={() => setActiveSection('inicio')}
            className="min-h-[46px] rounded-xl bg-[#F5B91B] px-5 text-sm font-extrabold text-[#0A1421]"
          >
            Voltar para Tela Inicial
          </button>
        </div>
      );
    }

    switch (activeSection) {
      case 'inicio':
        if (experienceMode === 'ADMINISTRACAO' && hasPermission(role, 'users:manage')) {
          return (
            <AdminHomePage
              session={session}
              dashboard={dashboard}
              pendencies={pendencies}
              onNavigate={handleSelectSection}
            />
          );
        }
        if (experienceMode === 'GERENCIAL' && hasPermission(role, 'reports:view')) {
          return (
            <ManagerialHomePage
              session={session}
              dashboard={dashboard}
              silos={silos}
              onNavigate={handleSelectSection}
            />
          );
        }
        return (
          <OperationalHomePage
            session={session}
            dashboard={dashboard}
            silos={silos}
            pendencies={pendencies}
            onNavigate={handleSelectSection}
            onNavigateToShiftReport={(intent) => {
              setShiftReportIntent(intent);
              setActiveSection('turnos');
            }}
            onOpenHelp={() => setHelpModalOpen(true)}
          />
        );
      case 'executivo':
        return (
          <ExecutivePresentationPage
            isDemoMode={isDemoMode}
            presentationViewMode={presentationViewMode}
            demoHydrationVersion={demoHydrationVersion}
            dashboard={dashboard}
            silos={silos}
            materials={materials}
            onNavigate={handleSelectSection}
            onEnterDemoMode={enterDemoMode}
            onExitDemoMode={exitDemoMode}
            onResetDemo={handleResetDemo}
            onSwitchPresentationMode={switchPresentationMode}
          />
        );
      case 'painel':
        return (
          <DashboardPage
            data={dashboard}
            silos={silos}
            isDemoMode={isDemoMode}
            loading={dataLoading}
            error={dataError}
            onNavigate={handleSelectSection}
            onRefresh={loadWorkspaceData}
          />
        );
      case 'mapa':
        return (
          <SiloMapPage
            silos={silos}
            materials={materials}
            thresholds={thresholds}
            proactiveThresholdAlerts={proactiveThresholdAlerts}
            canManageSilos={hasPermission(role, 'silos:manage')}
            canManageThresholds={hasPermission(role, 'consumption:manage')}
            experienceMode={experienceMode}
            onReload={loadWorkspaceData}
            onStartReceivingToSilo={
              hasPermission(role, 'receipts:execute')
                ? (siloId) => {
                    setPreselectedSiloId(siloId);
                    setActiveSection('recebimentos');
                  }
                : undefined
            }
          />
        );
      case 'recebimentos':
      case 'etiquetas':
      case 'distribuicao':
        return (
          <ReceivingPage
            key={activeSection === 'etiquetas' ? 'recv-etiquetas' : activeSection === 'distribuicao' ? 'recv-dist' : 'recv-novo'}
            initialTab={activeSection === 'distribuicao' ? 'pendentes' : 'novo'}
            initialWizardStep={activeSection === 'etiquetas' ? 1 : 0}
            experienceMode={experienceMode}
            session={session}
            materials={materials}
            suppliers={suppliers}
            bagConfigs={bagConfigs}
            canExecute={hasPermission(role, 'receipts:execute')}
            preselectedSiloId={preselectedSiloId}
            onReloadWorkspace={loadWorkspaceData}
          />
        );
      case 'transferencias':
        return (
          <TransfersPage
            session={session}
            silos={silos}
            materials={materials}
            transferRules={transferRules}
            canExecuteTransfers={hasPermission(role, 'transfers:execute')}
            canPlanTransfers={hasPermission(role, 'transfers:plan')}
            canAdjustStock={hasPermission(role, 'stock:adjust')}
            experienceMode={experienceMode}
            prefillPlan={prefillTransferPlan}
            onClearPrefill={() => setPrefillTransferPlan(null)}
            onReloadWorkspace={loadWorkspaceData}
          />
        );
      case 'estoque':
        return (
          <CatalogPage
            silos={silos}
            materials={materials}
            bagConfigs={bagConfigs}
            transferRules={transferRules}
            pendencies={pendencies}
            canManageMaterials={hasPermission(role, 'materials:manage')}
            canManageRules={hasPermission(role, 'compatibility:manage')}
            canResolvePendencies={hasPermission(role, 'pendencies:resolve')}
            onReload={loadWorkspaceData}
          />
        );
      case 'relatorios':
        return <ReportsPage session={session} silos={silos} materials={materials} />;
      case 'turnos':
        return (
          <ShiftsHandoverPage
            session={session}
            initialIntent={shiftReportIntent}
            onClearIntent={() => setShiftReportIntent(null)}
            onSessionRefresh={refreshSession}
          />
        );
      case 'ocorrencias':
        return <OccurrencesPage session={session} silos={silos} materials={materials} />;
      case 'assistente':
        return <NexoAssistantPage session={session} onNavigate={handleSelectSection} />;
      case 'auditoria':
        return hasPermission(role, 'audit:view') ? (
          <AuditPage />
        ) : (
          <RoadmapModulePage section="painel" userRole={role} onNavigate={handleSelectSection} />
        );
      case 'admin':
        return hasPermission(role, 'users:manage') ? (
          <AdminPage currentUserId={session.user.id} onSessionRefresh={refreshSession} />
        ) : (
          <RoadmapModulePage section="painel" userRole={role} onNavigate={handleSelectSection} />
        );
      case 'programacao':
        return (
          <ProductionSchedulePage
            session={session}
            materials={materials}
            canImport={hasPermission(role, 'schedules:import')}
            canApprove={hasPermission(role, 'schedules:approve')}
            canUpdateExecution={hasPermission(role, 'schedules:execution_update')}
            onNavigateToConsumption={() => setActiveSection('consumo')}
          />
        );
      case 'comparador':
        return (
          <BasketComparatorPage
            session={session}
            materials={materials}
            isDemoMode={isDemoMode}
            initialComparisonId={focusComparisonId}
            onReloadWorkspace={loadWorkspaceData}
          />
        );
      case 'consumo':
        return (
          <ConsumptionIntelligencePage
            silos={silos}
            materials={materials}
            canManageFactors={hasPermission(role, 'consumption:manage')}
            canDecideRecommendations={
              hasPermission(role, 'schedules:execution_update') ||
              hasPermission(role, 'consumption:manage')
            }
            onNavigate={handleSelectSection}
          />
        );
      case 'abastecimento':
        return (
          <SupplyCenterPage
            silos={silos}
            materials={materials}
            canManageRoutes={hasPermission(role, 'routes:manage')}
            canPlanTransfers={hasPermission(role, 'transfers:plan')}
            canManagePriority={hasPermission(role, 'priority:manage')}
            onCreateTransferFromRecommendation={(prefill) => {
              setPrefillTransferPlan(prefill);
              setActiveSection('transferencias');
            }}
            onNavigate={handleSelectSection}
            onReloadWorkspace={loadWorkspaceData}
          />
        );
      case 'guia':
        return <GuidePage articles={helpArticles} />;
      default:
        return (
          <RoadmapModulePage
            section={activeSection}
            userRole={role}
            onNavigate={handleSelectSection}
          />
        );
    }
  };

  return (
    <AppLayout
      session={session}
      experienceMode={experienceMode}
      allowedModes={allowedModes}
      onSwitchExperienceMode={handleSwitchExperienceMode}
      isDemoMode={isDemoMode}
      presentationViewMode={presentationViewMode}
      activeSection={activeSection}
      pendingCount={pendingCount}
      criticalAlertsCount={criticalAlertsCount}
      proactiveThresholdAlerts={proactiveThresholdAlerts}
      onSelectSection={handleSelectSection}
      onOpenHelp={() => setHelpModalOpen(true)}
      onEnterDemoMode={enterDemoMode}
      onExitDemoMode={exitDemoMode}
      onResetDemo={handleResetDemo}
      onLogout={logout}
      unreadBasketAlert={unreadNotification}
      wsConnected={wsConnected}
      onViewPublishedBasket={(cmpId) => {
        setFocusComparisonId(cmpId);
        dismissUnread();
        setActiveSection('comparador');
      }}
      onDismissBasketAlert={dismissUnread}
    >
      {renderSection()}

      <ContextualHelpModal
        open={helpModalOpen}
        onClose={() => setHelpModalOpen(false)}
        activeSection={activeSection}
        articles={helpArticles}
        onOpenFullGuide={() => setActiveSection('guia')}
      />
    </AppLayout>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <NexoWorkspace />
    </AuthProvider>
  );
}
