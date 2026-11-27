import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  CalendarClock,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  FlaskConical,
  GitCompare,
  HelpCircle,
  History,
  Home,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  PackageCheck,
  Presentation,
  QrCode,
  Repeat,
  RotateCcw,
  Settings,
  Truck,
  UserCog,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  BasketNotificationEvent,
  MaterialThresholdAlertItem,
  NavSectionId,
  PresentationViewMode,
  SessionData,
} from '../../types/nexo.ts';
import { ROLE_LABELS, hasPermission } from '../../lib/rbac.ts';
import {
  canAccessSection,
  EXPERIENCE_MODES_META,
  ExperienceMode,
} from '../../lib/experience-modes.ts';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.ts';
import { NexoLogo } from './NexoLogo.tsx';
import { PWAInstallButton } from '../pwa/PWAInstallButton.tsx';

interface NavItem {
  id: NavSectionId;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'PRINCIPAL' | 'OPERACIONAL' | 'GESTAO' | 'ADMIN' | 'MAIS';
  requiresPermission?: Parameters<typeof hasPermission>[1];
}

const NAV_ITEMS: NavItem[] = [
  { id: 'inicio', label: 'Tela Inicial', shortLabel: 'Início', icon: Home, group: 'PRINCIPAL' },
  {
    id: 'recebimentos',
    label: 'Receber Material',
    shortLabel: 'Receber',
    icon: Truck,
    group: 'OPERACIONAL',
    requiresPermission: 'receipts:view',
  },
  {
    id: 'etiquetas',
    label: 'Ler Etiqueta',
    shortLabel: 'Etiquetas',
    icon: QrCode,
    group: 'OPERACIONAL',
    requiresPermission: 'receipts:view',
  },
  {
    id: 'mapa',
    label: 'Consultar Silos',
    shortLabel: 'Silos',
    icon: LayoutGrid,
    group: 'OPERACIONAL',
    requiresPermission: 'silos:view',
  },
  {
    id: 'distribuicao',
    label: 'Registrar Descarga',
    shortLabel: 'Descarga',
    icon: CheckSquare,
    group: 'OPERACIONAL',
    requiresPermission: 'receipts:view',
  },
  {
    id: 'transferencias',
    label: 'Transferir Material',
    shortLabel: 'Transferir',
    icon: Repeat,
    group: 'OPERACIONAL',
  },
  {
    id: 'abastecimento',
    label: 'Abastecimento',
    shortLabel: 'Abastec.',
    icon: PackageCheck,
    group: 'OPERACIONAL',
    requiresPermission: 'supply:view',
  },
  {
    id: 'turnos',
    label: 'Passagem de Turno',
    shortLabel: 'Turno',
    icon: ClipboardCheck,
    group: 'OPERACIONAL',
    requiresPermission: 'shifts:view',
  },
  {
    id: 'painel',
    label: 'Painel de Indicadores',
    shortLabel: 'Painel',
    icon: LayoutDashboard,
    group: 'GESTAO',
    requiresPermission: 'dashboard:view',
  },
  {
    id: 'programacao',
    label: 'Programação Produção',
    shortLabel: 'Progr.',
    icon: CalendarClock,
    group: 'GESTAO',
    requiresPermission: 'schedules:view',
  },
  {
    id: 'comparador',
    label: 'Comparador de Cestas',
    shortLabel: 'Cestas',
    icon: GitCompare,
    group: 'GESTAO',
    requiresPermission: 'baskets:view',
  },
  {
    id: 'consumo',
    label: 'Consumo & Projeção',
    shortLabel: 'Consumo',
    icon: Activity,
    group: 'GESTAO',
    requiresPermission: 'schedules:view',
  },
  {
    id: 'relatorios',
    label: 'Relatórios',
    shortLabel: 'Relat.',
    icon: FileSpreadsheet,
    group: 'GESTAO',
    requiresPermission: 'reports:view',
  },
  {
    id: 'ocorrencias',
    label: 'Ocorrências',
    shortLabel: 'Ocorr.',
    icon: AlertTriangle,
    group: 'GESTAO',
    requiresPermission: 'occurrences:view',
  },
  {
    id: 'estoque',
    label: 'Estoque & Cadastros',
    shortLabel: 'Estoque',
    icon: Database,
    group: 'GESTAO',
    requiresPermission: 'materials:view',
  },
  {
    id: 'assistente',
    label: 'NEXO Assistente (IA)',
    shortLabel: 'Assist.',
    icon: Bot,
    group: 'MAIS',
    requiresPermission: 'assistant:use',
  },
  {
    id: 'qualidade',
    label: 'Qualidade',
    shortLabel: 'Qualid.',
    icon: FlaskConical,
    group: 'MAIS',
    requiresPermission: 'silos:view',
  },
  {
    id: 'guia',
    label: 'Manual Ilustrado',
    shortLabel: 'Manual',
    icon: BookOpen,
    group: 'MAIS',
  },
  {
    id: 'executivo',
    label: 'Apresentação Executiva',
    shortLabel: 'Executivo',
    icon: Presentation,
    group: 'GESTAO',
  },
  {
    id: 'auditoria',
    label: 'Auditoria & Histórico',
    shortLabel: 'Auditoria',
    icon: History,
    group: 'ADMIN',
    requiresPermission: 'audit:view',
  },
  {
    id: 'admin',
    label: 'Usuários & Perfis',
    shortLabel: 'Admin',
    icon: UserCog,
    group: 'ADMIN',
    requiresPermission: 'users:manage',
  },
];

interface AppLayoutProps {
  session: SessionData;
  experienceMode: ExperienceMode;
  allowedModes: ExperienceMode[];
  onSwitchExperienceMode: (mode: ExperienceMode) => void;
  isDemoMode?: boolean;
  presentationViewMode?: PresentationViewMode;
  activeSection: NavSectionId;
  pendingCount: number;
  criticalAlertsCount?: number;
  onSelectSection: (section: NavSectionId) => void;
  onOpenHelp: () => void;
  onEnterDemoMode?: () => void;
  onExitDemoMode?: () => Promise<void>;
  onResetDemo?: () => void;
  onLogout: () => Promise<void>;
  unreadBasketAlert?: BasketNotificationEvent | null;
  onViewPublishedBasket?: (comparisonId: number) => void;
  onDismissBasketAlert?: () => void;
  proactiveThresholdAlerts?: MaterialThresholdAlertItem[];
  wsConnected?: boolean;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  session,
  experienceMode,
  allowedModes,
  onSwitchExperienceMode,
  isDemoMode = false,
  presentationViewMode = 'CENARIO_REALISTA',
  activeSection,
  pendingCount,
  criticalAlertsCount = 0,
  onSelectSection,
  onOpenHelp,
  onEnterDemoMode,
  onExitDemoMode,
  onResetDemo,
  onLogout,
  unreadBasketAlert = null,
  onViewPublishedBasket,
  onDismissBasketAlert,
  proactiveThresholdAlerts = [],
  wsConnected = false,
  children,
}) => {
  const isOnline = useOnlineStatus();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOperationalOpen, setMoreOperationalOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [thresholdStripDismissed, setThresholdStripDismissed] = useState(false);
  const [nowClock, setNowClock] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNowClock(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const role = session.user.roleCode;
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!canAccessSection(role, item.id)) return false;
    if (item.requiresPermission && !hasPermission(role, item.requiresPermission)) {
      return false;
    }
    return true;
  });

  const handleNavClick = (id: NavSectionId) => {
    onSelectSection(id);
    setDrawerOpen(false);
  };

  const renderNavButton = (item: NavItem) => {
    const Icon = item.icon;
    const active = activeSection === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleNavClick(item.id)}
        className={`flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3.5 py-2 text-left text-sm font-semibold transition-colors ${
          active
            ? 'bg-[#F5B91B] font-bold text-[#0A1421]'
            : 'text-[#AEB8C5] hover:bg-[#16263B] hover:text-[#F4F6F8]'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  const renderGroup = (groups: Array<NavItem['group']>, title: string) => {
    const items = visibleItems.filter((i) => groups.includes(i.group));
    if (items.length === 0) return null;
    return (
      <div className="space-y-1">
        <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#AEB8C5]/65">
          {title}
        </p>
        {items.map(renderNavButton)}
      </div>
    );
  };

  const renderSidebarNavigation = () => {
    if (experienceMode === 'OPERACIONAL') {
      const mainOp = visibleItems.filter((i) => i.group === 'PRINCIPAL' || i.group === 'OPERACIONAL');
      const secondaryOp = visibleItems.filter((i) => i.group === 'GESTAO' || i.group === 'MAIS');
      return (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#F5B91B]">
              Tarefas Diárias
            </p>
            {mainOp.map(renderNavButton)}
          </div>

          {secondaryOp.length > 0 && (
            <div className="border-t border-[#AEB8C5]/15 pt-3">
              <button
                type="button"
                onClick={() => setMoreOperationalOpen((v) => !v)}
                className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-xs font-bold text-[#AEB8C5] hover:bg-[#16263B] hover:text-[#F4F6F8]"
              >
                <span>Mais Consultas</span>
                {moreOperationalOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {moreOperationalOpen && (
                <div className="mt-1 space-y-1">
                  {secondaryOp.map(renderNavButton)}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    if (experienceMode === 'ADMINISTRACAO') {
      return (
        <div className="space-y-5">
          {renderGroup(['PRINCIPAL'], 'Início')}
          {renderGroup(['ADMIN'], 'Administração & Segurança')}
          {renderGroup(['GESTAO'], 'Cadastros, Rotas & Relatórios')}
          {renderGroup(['OPERACIONAL', 'MAIS'], 'Operação & Apoio')}
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {renderGroup(['PRINCIPAL'], 'Início')}
        {renderGroup(['GESTAO'], 'Supervisão & Análise')}
        {renderGroup(['OPERACIONAL'], 'Operação da Moega')}
        {renderGroup(['MAIS', 'ADMIN'], 'Apoio & Governança')}
      </div>
    );
  };

  const activeNavMeta = visibleItems.find((i) => i.id === activeSection);
  const triggeredThresholdAlerts = proactiveThresholdAlerts.filter(
    (a) => a.severity === 'CRITICO' || a.severity === 'ATENCAO'
  );
  const totalNotifications = pendingCount + criticalAlertsCount + triggeredThresholdAlerts.length;
  const formattedTime = nowClock.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const formattedDate = nowClock.toLocaleDateString('pt-BR');

  return (
    <div className="flex min-h-screen flex-col bg-[#0A1421] text-[#F4F6F8] lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-[#AEB8C5]/15 lg:bg-[#101B2A]">
        <div className="border-b border-[#AEB8C5]/15 p-4">
          <button
            type="button"
            onClick={() => handleNavClick('inicio')}
            className="block w-full text-left focus:outline-none"
            title="Voltar para a Tela Inicial"
          >
            <NexoLogo compact showTagline />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3" aria-label="Navegação Principal">
          {renderSidebarNavigation()}
        </nav>

        <div className="border-t border-[#AEB8C5]/15 p-3">
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3 text-xs">
            <p className="truncate font-bold text-[#F4F6F8]">{session.user.displayName}</p>
            <p className="mt-0.5 font-semibold text-[#F5B91B]">
              {ROLE_LABELS[session.user.roleCode] || session.user.roleName}
            </p>
            <p className="mt-1 font-mono-tabular text-[11px] text-[#AEB8C5]">
              {session.shift.shiftName}
            </p>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Limpo e Intuitivo */}
        <header className="sticky top-0 z-30 border-b border-[#AEB8C5]/15 bg-[#101B2A]/95 backdrop-blur-sm">
          <div className="flex min-h-[64px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => handleNavClick('inicio')}
                className="lg:hidden focus:outline-none"
                title="Tela Inicial"
              >
                <NexoLogo compact />
              </button>

              {activeSection !== 'inicio' && (
                <button
                  type="button"
                  onClick={() => handleNavClick('inicio')}
                  className="hidden sm:inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]"
                >
                  <Home className="h-3.5 w-3.5 text-[#F5B91B]" />
                  <span>Início</span>
                </button>
              )}

              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#F4F6F8]">
                  {activeSection === 'inicio'
                    ? EXPERIENCE_MODES_META[experienceMode].label
                    : activeNavMeta?.label || 'NEXO LOG 2.0'}
                </p>
                <p className="truncate font-mono-tabular text-[11px] text-[#AEB8C5]">
                  {session.user.displayName.split(' ')[0]} · {session.shift.shiftName} · {formattedDate} {formattedTime}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Seletor de Modo apenas quando o perfil autenticado possui mais de 1 modo */}
              {allowedModes.length > 1 && (
                <div
                  className="hidden md:flex items-center gap-1 rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] p-1"
                  role="group"
                  aria-label="Alternar Modo de Experiência"
                >
                  {allowedModes.map((modeId) => {
                    const active = experienceMode === modeId;
                    return (
                      <button
                        key={modeId}
                        type="button"
                        onClick={() => onSwitchExperienceMode(modeId)}
                        className={`min-h-[36px] rounded-lg px-3 text-xs font-bold transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-[#F5B91B] text-[#0A1421]'
                            : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                        }`}
                      >
                        {EXPERIENCE_MODES_META[modeId].shortLabel}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Indicador de Conexão (Ícone + Texto) */}
              <span
                className={`hidden sm:inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${
                  isOnline
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                    : 'border-red-500/45 bg-red-500/15 text-red-200'
                }`}
              >
                {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                <span>{isOnline ? 'Conectado' : 'Sem Conexão'}</span>
              </span>

              {!isDemoMode && onEnterDemoMode && experienceMode !== 'OPERACIONAL' && (
                <button
                  type="button"
                  onClick={onEnterDemoMode}
                  title="Abrir Modo Apresentação Executiva (Sandbox Isolado)"
                  className="hidden xl:inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#3B82F6]/45 bg-[#0A1421] px-3 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
                >
                  <Presentation className="h-4 w-4 text-[#F5B91B]" />
                  <span>Modo Demo</span>
                </button>
              )}

              <PWAInstallButton />

              {/* Notificações Reais & Limiares Proativos */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNotificationsOpen((v) => !v)}
                  title="Central de notificações proativas e pendências"
                  aria-expanded={notificationsOpen}
                  data-testid="proactive-notifications-bell"
                  className="relative flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]/50"
                >
                  <Bell
                    className={`h-4 w-4 ${totalNotifications > 0 ? 'text-[#F5B91B]' : 'text-[#AEB8C5]'}`}
                  />
                  {totalNotifications > 0 && (
                    <span className="font-mono-tabular text-xs font-bold text-[#F5B91B]">
                      {totalNotifications}
                    </span>
                  )}
                </button>

                {notificationsOpen && (
                  <div
                    data-testid="proactive-notifications-popover"
                    className="absolute right-0 top-12 z-50 w-80 sm:w-96 rounded-xl border border-[#F5B91B]/35 bg-[#101B2A] p-4 shadow-2xl"
                  >
                    <div className="flex items-center justify-between border-b border-[#AEB8C5]/15 pb-2.5">
                      <div>
                        <p className="font-display text-sm font-bold text-[#F4F6F8]">
                          Notificações Proativas
                        </p>
                        <p className="text-[11px] text-[#AEB8C5]">
                          Alertas por limiar de material, silos críticos e pendências
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNotificationsOpen(false)}
                        aria-label="Fechar notificações"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A2B42]"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1 text-xs">
                      {triggeredThresholdAlerts.length > 0 ? (
                        triggeredThresholdAlerts.map((al) => (
                          <div
                            key={al.thresholdId}
                            className={`rounded-lg border p-2.5 ${
                              al.severity === 'CRITICO'
                                ? 'border-red-500/50 bg-red-950/35 text-red-100'
                                : 'border-orange-500/50 bg-orange-950/30 text-orange-100'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                                  al.severity === 'CRITICO'
                                    ? 'bg-red-500 text-white'
                                    : 'bg-orange-500 text-[#0A1421]'
                                }`}
                              >
                                {al.severity === 'CRITICO' ? 'LIMIAR CRÍTICO' : 'ESTOQUE BAIXO'}
                              </span>
                              <span className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                                {al.materialCode}
                              </span>
                            </div>
                            <p className="mt-1.5 leading-snug text-[#F4F6F8]">{al.message}</p>
                            <button
                              type="button"
                              onClick={() => {
                                setNotificationsOpen(false);
                                handleNavClick('mapa');
                              }}
                              className="mt-2 font-bold text-[#F5B91B] hover:underline"
                            >
                              Ver no Mapa de Silos →
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5 text-emerald-200">
                          Nenhum limiar por material atingido no momento.
                        </div>
                      )}

                      {criticalAlertsCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setNotificationsOpen(false);
                            handleNavClick('mapa');
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-2.5 text-left hover:border-[#F5B91B]"
                        >
                          <span className="text-[#F4F6F8]">Silos em atenção / críticos no mapa</span>
                          <span className="font-mono-tabular font-bold text-[#F5B91B]">
                            {criticalAlertsCount}
                          </span>
                        </button>
                      )}

                      {pendingCount > 0 && hasPermission(role, 'pendencies:resolve') && (
                        <button
                          type="button"
                          onClick={() => {
                            setNotificationsOpen(false);
                            handleNavClick('estoque');
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-2.5 text-left hover:border-[#F5B91B]"
                        >
                          <span className="text-[#F4F6F8]">Pendências documentais abertas</span>
                          <span className="font-mono-tabular font-bold text-[#F5B91B]">
                            {pendingCount}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Botão Visível "COMO UTILIZAR?" em todas as telas */}
              <button
                type="button"
                onClick={onOpenHelp}
                title="Como utilizar esta tela?"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#F5B91B]/45 bg-[#0A1421] px-3 text-xs font-bold text-[#F5B91B] hover:bg-[#152336]"
              >
                <HelpCircle className="h-4 w-4" />
                <span className="hidden sm:inline">COMO UTILIZAR?</span>
              </button>

              <button
                type="button"
                onClick={onLogout}
                title={isDemoMode ? 'Sair do Modo Demo' : 'Sair da conta'}
                aria-label={isDemoMode ? 'Sair do Modo Demo' : 'Sair da conta'}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] text-[#AEB8C5] hover:border-red-400/50 hover:text-red-300"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>

          {isDemoMode && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#3B82F6]/35 bg-[#0E2038] px-4 py-2 text-xs sm:px-6">
              <div className="flex items-center gap-2 text-[#F4F6F8]">
                <span className="rounded bg-[#F5B91B] px-2 py-0.5 font-mono-tabular text-[10px] font-extrabold uppercase tracking-wider text-[#0A1421]">
                  Apresentação
                </span>
                <span className="font-medium">
                  {presentationViewMode === 'BANCO_AO_VIVO' ? (
                    <>
                      <strong>ESPELHO AO VIVO POSTGRESQL (SOMENTE LEITURA)</strong> — Catálogo, capacidades e registros reais sem alteração no banco.
                    </>
                  ) : (
                    <>
                      <strong>CATÁLOGO REAL POSTGRESQL + CENÁRIO OPERACIONAL</strong> — 54 silos e capacidades reais em sandbox isolado (sem escrita no banco).
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {onResetDemo && (
                  <button
                    type="button"
                    onClick={onResetDemo}
                    className="inline-flex min-h-[34px] items-center gap-1 rounded border border-[#AEB8C5]/30 bg-[#0A1421] px-2.5 text-[11px] font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
                  >
                    <RotateCcw className="h-3 w-3 text-[#F5B91B]" />
                    <span>Resetar Demo</span>
                  </button>
                )}
                {onExitDemoMode && (
                  <button
                    type="button"
                    onClick={() => {
                      void onExitDemoMode();
                    }}
                    className="inline-flex min-h-[34px] items-center rounded bg-[#F5B91B] px-3 text-[11px] font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
                  >
                    Sair do Modo Demo
                  </button>
                )}
              </div>
            </div>
          )}
          {unreadBasketAlert && (
            <div
              role="alert"
              data-testid="basket-published-alert"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F5B91B]/50 bg-[#1B2B40] px-4 py-3 text-xs sm:px-6"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F5B91B] text-[#0A1421]">
                  <GitCompare className="h-4 w-4" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-extrabold tracking-wide text-[#F5B91B]">
                      NOVA CESTA DE CONSUMO PUBLICADA
                    </span>
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono-tabular text-[10px] font-bold text-emerald-300">
                      {unreadBasketAlert.productionDate} · {unreadBasketAlert.comparisonCode}
                    </span>
                    {unreadBasketAlert.criticalImpactsCount > 0 && (
                      <span className="rounded border border-red-500/45 bg-red-500/15 px-2 py-0.5 font-mono-tabular text-[10px] font-bold text-red-200">
                        {unreadBasketAlert.criticalImpactsCount} alerta(s) crítico(s)
                      </span>
                    )}
                    {wsConnected && (
                      <span className="text-[10px] font-semibold text-[#AEB8C5]">Tempo real</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[#F4F6F8]">
                    {unreadBasketAlert.baseVersionLabel} → <strong>{unreadBasketAlert.targetVersionLabel}</strong> · publicado por{' '}
                    <strong>{unreadBasketAlert.publishedByName}</strong>.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {onViewPublishedBasket && (
                  <button
                    type="button"
                    onClick={() => onViewPublishedBasket(unreadBasketAlert.comparisonId)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#F5B91B] px-3.5 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
                  >
                    <span>VISUALIZAR ALTERAÇÕES</span>
                  </button>
                )}
                {onDismissBasketAlert && (
                  <button
                    type="button"
                    onClick={onDismissBasketAlert}
                    aria-label="Fechar aviso de cesta publicada"
                    className="inline-flex min-h-[40px] items-center rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs font-semibold text-[#AEB8C5] hover:text-[#F4F6F8]"
                  >
                    Dispensar
                  </button>
                )}
              </div>
            </div>
          )}
          {triggeredThresholdAlerts.length > 0 &&
            !thresholdStripDismissed &&
            activeSection !== 'mapa' && (
              <div
                role="status"
                data-testid="proactive-threshold-banner"
                className="flex flex-wrap items-center justify-between gap-3 border-t border-orange-500/45 bg-[#2A1A14] px-4 py-2.5 text-xs sm:px-6"
              >
                <div className="flex items-center gap-2.5 text-[#F4F6F8]">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-[#F5B91B]" />
                  <span>
                    <strong className="text-[#F5B91B]">
                      ALERTA PROATIVO ({triggeredThresholdAlerts.length}):
                    </strong>{' '}
                    {triggeredThresholdAlerts[0].message}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleNavClick('mapa')}
                    className="min-h-[34px] rounded-lg bg-[#F5B91B] px-3 text-[11px] font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
                  >
                    Abrir Mapa & Limiares
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholdStripDismissed(true)}
                    className="min-h-[34px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-2.5 text-[11px] text-[#AEB8C5] hover:text-[#F4F6F8]"
                  >
                    Dispensar
                  </button>
                </div>
              </div>
            )}
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 pb-24 sm:p-6 lg:pb-8">{children}</main>
      </div>

      {/* Tablet / Mobile Thumb Bar (<= 15% altura) */}
      <nav
        aria-label="Navegação Rápida Tablet"
        className="fixed bottom-0 left-0 right-0 z-30 grid h-[58px] grid-cols-4 border-t border-[#AEB8C5]/20 bg-[#101B2A]/95 backdrop-blur-sm lg:hidden"
      >
        {(
          [
            { id: 'inicio' as NavSectionId, label: 'Início', icon: Home },
            { id: 'mapa' as NavSectionId, label: 'Silos', icon: LayoutGrid },
            {
              id: (hasPermission(role, 'receipts:execute') ? 'recebimentos' : 'abastecimento') as NavSectionId,
              label: hasPermission(role, 'receipts:execute') ? 'Receber' : 'Abastec.',
              icon: hasPermission(role, 'receipts:execute') ? Truck : BarChart3,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleNavClick(tab.id)}
              className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
                active ? 'text-[#F5B91B]' : 'text-[#AEB8C5]'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{tab.label}</span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
            drawerOpen ? 'text-[#F5B91B]' : 'text-[#AEB8C5]'
          }`}
        >
          <Menu className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </nav>

      {/* Mobile / Tablet Full Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm lg:hidden">
          <div className="flex h-full w-full max-w-sm flex-col border-l border-[#AEB8C5]/20 bg-[#101B2A]">
            <div className="flex items-center justify-between border-b border-[#AEB8C5]/15 p-4">
              <div>
                <p className="font-display text-base font-bold text-[#F4F6F8]">
                  Menu NEXO LOG 2.0
                </p>
                <p className="text-xs text-[#AEB8C5]">
                  {session.user.displayName} · {ROLE_LABELS[session.user.roleCode]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Fechar menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A2B42]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {allowedModes.length > 1 && (
              <div className="border-b border-[#AEB8C5]/15 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#F5B91B]">
                  <Settings className="h-3.5 w-3.5" />
                  <span>Trocar Modo de Tela</span>
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {allowedModes.map((modeId) => (
                    <button
                      key={modeId}
                      type="button"
                      onClick={() => {
                        onSwitchExperienceMode(modeId);
                        setDrawerOpen(false);
                      }}
                      className={`min-h-[40px] rounded-lg px-2 text-xs font-bold ${
                        experienceMode === modeId
                          ? 'bg-[#F5B91B] text-[#0A1421]'
                          : 'border border-[#AEB8C5]/20 bg-[#0A1421] text-[#AEB8C5]'
                      }`}
                    >
                      {EXPERIENCE_MODES_META[modeId].shortLabel}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">{renderSidebarNavigation()}</div>
          </div>
        </div>
      )}
    </div>
  );
};
