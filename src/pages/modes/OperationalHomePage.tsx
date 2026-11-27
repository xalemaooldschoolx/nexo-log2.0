import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  FlaskConical,
  GitCompare,
  HelpCircle,
  Lock,
  TrendingUp,
} from 'lucide-react';
import {
  AlertBellIllustration,
  BarcodeLabelIllustration,
  ChecklistClipboardIllustration,
  FactoryFeedIllustration,
  ScaleDischargeIllustration,
  SiloRowIllustration,
  TransferPipesIllustration,
  TruckUnloadIllustration,
} from '../../components/ui/NexoIllustrations.tsx';
import { apiFetch, formatKg } from '../../lib/api.ts';
import { formatIsoDatePtBr } from '../../lib/phase5-analytics.ts';
import { hasPermission } from '../../lib/rbac.ts';
import {
  DashboardResponse,
  NavSectionId,
  ReceiptItem,
  SessionData,
  ShiftAutoSummarySnapshot,
  ShiftHandoverPendencyView,
  ShiftHandoverView,
  SiloDetail,
  ValidationPendency,
} from '../../types/nexo.ts';

interface OperationalHomePageProps {
  session: SessionData;
  dashboard: DashboardResponse | null;
  silos: SiloDetail[];
  pendencies: ValidationPendency[];
  onNavigate: (section: NavSectionId) => void;
  onNavigateToShiftReport?: (intent: 'view' | 'supplement' | 'ai' | 'review' | 'finalize') => void;
  onOpenHelp: () => void;
}

export const OperationalHomePage: React.FC<OperationalHomePageProps> = ({
  session,
  dashboard,
  silos,
  pendencies,
  onNavigate,
  onNavigateToShiftReport,
  onOpenHelp,
}) => {
  const role = session.user.roleCode;
  const [pendingReceipts, setPendingReceipts] = useState<ReceiptItem[]>([]);
  const [openShiftPendencies, setOpenShiftPendencies] = useState<ShiftHandoverPendencyView[]>([]);
  const [shiftSummary, setShiftSummary] = useState<ShiftAutoSummarySnapshot | null>(null);
  const [activeHandover, setActiveHandover] = useState<ShiftHandoverView | null>(null);
  const [showAlertsFocus, setShowAlertsFocus] = useState(false);

  const canReceive = hasPermission(role, 'receipts:execute');
  const canViewReceipts = hasPermission(role, 'receipts:view');
  const canTransfer = hasPermission(role, 'transfers:execute') || hasPermission(role, 'transfers:plan');
  const canViewSupply = hasPermission(role, 'supply:view');
  const canViewShifts = hasPermission(role, 'shifts:view');

  useEffect(() => {
    let cancelled = false;
    const tasks: Promise<void>[] = [];

    if (canViewReceipts) {
      tasks.push(
        apiFetch<ReceiptItem[]>('/api/receipts')
          .then((list) => {
            if (!cancelled) {
              setPendingReceipts(list.filter((r) => r.status === 'PENDENTE' || r.status === 'PARCIAL'));
            }
          })
          .catch(() => {})
      );
    }

    if (canViewShifts) {
      tasks.push(
        apiFetch<ShiftHandoverPendencyView[]>('/api/shift-pendencies/open')
          .then((list) => {
            if (!cancelled) setOpenShiftPendencies(list);
          })
          .catch(() => {}),
        apiFetch<ShiftAutoSummarySnapshot>(
          `/api/shift-handovers/auto-summary?shiftCode=${session.shift.shiftCode}&operationalDate=${session.shift.operationalDate}`
        )
          .then((sum) => {
            if (!cancelled) setShiftSummary(sum);
          })
          .catch(() => {}),
        apiFetch<ShiftHandoverView[]>('/api/shift-handovers')
          .then((list) => {
            if (!cancelled) {
              const found = list.find(
                (h) =>
                  h.shiftCode === session.shift.shiftCode &&
                  h.operationalDate === session.shift.operationalDate
              );
              setActiveHandover(found || null);
            }
          })
          .catch(() => {})
      );
    }

    void Promise.all(tasks);
    return () => {
      cancelled = true;
    };
  }, [canViewReceipts, canViewShifts, session.shift.shiftCode, session.shift.operationalDate]);

  const criticalSilos = useMemo(
    () => silos.filter((s) => s.stockAlertLevel === 'CRITICO'),
    [silos]
  );
  const lowSilos = useMemo(
    () => silos.filter((s) => s.stockAlertLevel === 'ATENCAO'),
    [silos]
  );
  const blockedSilos = useMemo(
    () => silos.filter((s) => s.operationalStatus === 'BLOQUEADO' || s.operationalStatus === 'MANUTENCAO'),
    [silos]
  );
  const activePendencies = useMemo(
    () => pendencies.filter((p) => p.status === 'PENDENTE'),
    [pendencies]
  );

  const totalAttentionAlerts =
    criticalSilos.length +
    lowSilos.length +
    blockedSilos.length +
    pendingReceipts.length +
    openShiftPendencies.length;

  const firstName = session.user.displayName.split(' ')[0] || session.user.displayName;

  const actionCards: Array<{
    id: string;
    title: string;
    subtitle: string;
    badgeText?: string;
    badgeTone?: 'amber' | 'red' | 'blue' | 'emerald';
    disabled?: boolean;
    disabledHint?: string;
    illustration: React.ReactNode;
    accentBorder: string;
    onClick: () => void;
  }> = [
    {
      id: 'receber',
      title: 'RECEBER MATERIAL',
      subtitle: 'Registrar chegada de caminhão, nota fiscal ou big bag passo a passo.',
      badgeText: canReceive ? 'Passo a passo' : 'Somente consulta',
      badgeTone: canReceive ? 'blue' : 'amber',
      illustration: <TruckUnloadIllustration className="h-12 w-12" />,
      accentBorder: 'border-[#3B82F6]/40 hover:border-[#3B82F6]',
      onClick: () => onNavigate('recebimentos'),
    },
    {
      id: 'etiqueta',
      title: 'LER ETIQUETA',
      subtitle: 'Usar câmera ou leitor para conferir código do produto e lote.',
      badgeText: 'Câmera / Leitor',
      badgeTone: 'amber',
      illustration: <BarcodeLabelIllustration className="h-12 w-12" />,
      accentBorder: 'border-[#F5B91B]/40 hover:border-[#F5B91B]',
      onClick: () => onNavigate('etiquetas'),
    },
    {
      id: 'silos',
      title: 'CONSULTAR SILOS',
      subtitle: 'Ver quanto tem dentro de cada silo e quanto espaço ainda cabe.',
      badgeText: `${dashboard?.kpis.operationalSilos ?? silos.length} ativos`,
      badgeTone: 'emerald',
      illustration: <SiloRowIllustration className="h-12 w-12" />,
      accentBorder: 'border-emerald-500/40 hover:border-emerald-400',
      onClick: () => onNavigate('mapa'),
    },
    {
      id: 'descarga',
      title: 'REGISTRAR DESCARGA',
      subtitle: 'Continuar ou finalizar caminhões e bags que ficaram pendentes.',
      badgeText:
        pendingReceipts.length > 0
          ? `${pendingReceipts.length} pendente(s)`
          : 'Tudo concluído',
      badgeTone: pendingReceipts.length > 0 ? 'amber' : 'emerald',
      illustration: <ScaleDischargeIllustration className="h-12 w-12" />,
      accentBorder:
        pendingReceipts.length > 0
          ? 'border-[#F5B91B]/60 hover:border-[#F5B91B]'
          : 'border-[#AEB8C5]/25 hover:border-[#F5B91B]',
      onClick: () => onNavigate('distribuicao'),
    },
    {
      id: 'transferir',
      title: 'TRANSFERIR MATERIAL',
      subtitle: 'Passar material de um silo para outro pelas rotas liberadas.',
      badgeText: canTransfer ? 'Rota segura' : 'Consulta',
      badgeTone: 'blue',
      illustration: <TransferPipesIllustration className="h-12 w-12" />,
      accentBorder: 'border-[#3B82F6]/35 hover:border-[#3B82F6]',
      onClick: () => onNavigate('transferencias'),
    },
    {
      id: 'abastecimento',
      title: 'ABASTECIMENTO',
      subtitle: 'Ver o que as linhas de produção precisam para não parar.',
      badgeText: canViewSupply ? 'Linhas L1 a L7' : 'Restrito',
      badgeTone: 'amber',
      disabled: !canViewSupply,
      disabledHint: 'Sem permissão neste perfil',
      illustration: <FactoryFeedIllustration className="h-12 w-12" />,
      accentBorder: 'border-orange-500/40 hover:border-orange-400',
      onClick: () => onNavigate('abastecimento'),
    },
    {
      id: 'alertas',
      title: 'ALERTAS',
      subtitle: 'Ver silos com nível baixo, bloqueios e avisos do momento.',
      badgeText:
        totalAttentionAlerts > 0 ? `${totalAttentionAlerts} alerta(s)` : 'Sem alertas',
      badgeTone: criticalSilos.length > 0 ? 'red' : totalAttentionAlerts > 0 ? 'amber' : 'emerald',
      illustration: <AlertBellIllustration className="h-12 w-12" />,
      accentBorder:
        criticalSilos.length > 0
          ? 'border-red-500/65 hover:border-red-400'
          : 'border-[#AEB8C5]/25 hover:border-[#F5B91B]',
      onClick: () => {
        setShowAlertsFocus(true);
        const el = document.getElementById('nexo-operational-alerts');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    },
    {
      id: 'turno',
      title: 'PASSAGEM DE TURNO',
      subtitle: 'Conferir pendências e registrar o resumo para o próximo turno.',
      badgeText:
        openShiftPendencies.length > 0
          ? `${openShiftPendencies.length} pendência(s)`
          : session.shift.shiftName,
      badgeTone: openShiftPendencies.length > 0 ? 'amber' : 'emerald',
      disabled: !canViewShifts,
      disabledHint: 'Sem permissão neste perfil',
      illustration: <ChecklistClipboardIllustration className="h-12 w-12" />,
      accentBorder: 'border-emerald-500/35 hover:border-emerald-400',
      onClick: () => onNavigate('turnos'),
    },
  ];

  const badgeToneClass = (tone?: 'amber' | 'red' | 'blue' | 'emerald') => {
    if (tone === 'red') return 'border-red-500/45 bg-red-500/15 text-red-200';
    if (tone === 'amber') return 'border-[#F5B91B]/45 bg-[#F5B91B]/15 text-[#F5B91B]';
    if (tone === 'blue') return 'border-[#3B82F6]/45 bg-[#3B82F6]/15 text-[#93C5FD]';
    return 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300';
  };

  const rawSecondaryTools: Array<{
    id: NavSectionId;
    label: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }> = [
    {
      id: 'programacao',
      label: 'Programação da Produção',
      desc: 'Ver o que será produzido hoje e amanhã',
      icon: CalendarClock,
      visible: hasPermission(role, 'schedules:view'),
    },
    {
      id: 'comparador',
      label: 'Comparador de Cestas',
      desc: 'Ver mudanças da cesta publicada e impacto nos silos',
      icon: GitCompare,
      visible: hasPermission(role, 'baskets:view'),
    },
    {
      id: 'consumo',
      label: 'Previsão de Consumo',
      desc: 'Comparar estoque com consumo previsto',
      icon: TrendingUp,
      visible: hasPermission(role, 'schedules:view'),
    },
    {
      id: 'ocorrencias',
      label: 'Registrar Ocorrência',
      desc: 'Avisar falha, atraso ou divergência',
      icon: AlertTriangle,
      visible: hasPermission(role, 'occurrences:view'),
    },
    {
      id: 'estoque',
      label: 'Consultar Materiais & Pesos',
      desc: 'Lista de matérias-primas e big bags',
      icon: Database,
      visible: hasPermission(role, 'materials:view'),
    },
    {
      id: 'relatorios',
      label: 'Relatórios do Turno',
      desc: 'Consultar entradas e exportações',
      icon: FileSpreadsheet,
      visible: hasPermission(role, 'reports:view'),
    },
    {
      id: 'qualidade',
      label: 'Qualidade',
      desc: 'Amostragens e bloqueios de lote',
      icon: FlaskConical,
      visible: hasPermission(role, 'silos:view'),
    },
    {
      id: 'assistente',
      label: 'Perguntar ao NEXO IA',
      desc: 'Tirar dúvidas sobre estoque e movimentações',
      icon: Bot,
      visible: hasPermission(role, 'assistant:use'),
    },
    {
      id: 'guia',
      label: 'Manual Ilustrado',
      desc: 'Guias simples passo a passo',
      icon: BookOpen,
      visible: hasPermission(role, 'help:view'),
    },
  ];
  const secondaryTools = rawSecondaryTools.filter((t) => t.visible);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Saudação e pergunta principal */}
      <section className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#F5B91B]">
              {session.shift.shiftName} · Data Operacional {session.shift.operationalDate}
            </p>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[#F4F6F8] sm:text-3xl">
              OLÁ, {firstName.toUpperCase()}! O QUE VOCÊ PRECISA FAZER?
            </h1>
            <p className="text-sm text-[#AEB8C5]">
              Toque em um dos blocos grandes abaixo para iniciar sua tarefa sem complicação.
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenHelp}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-[#F5B91B]/45 bg-[#0A1421] px-4 py-2.5 text-sm font-bold text-[#F5B91B] hover:bg-[#152336]"
          >
            <HelpCircle className="h-5 w-5" />
            <span>COMO UTILIZAR?</span>
          </button>
        </div>
      </section>

      {/* Bloco Dedicado: Meu Relatório de Turno */}
      {canViewShifts && (
        <section
          aria-label="Meu Relatório de Turno"
          className="rounded-2xl border border-[#F5B91B]/30 bg-[#101B2A] p-5 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#F5B91B]">
                MEU RELATÓRIO DE TURNO · GERADO AUTOMATICAMENTE
              </p>
              <h2 className="mt-0.5 font-display text-lg font-extrabold text-[#F4F6F8] sm:text-xl">
                {session.shift.shiftName.toUpperCase()} – {formatIsoDatePtBr(session.shift.operationalDate)}
              </h2>
              <p className="mt-1 text-xs text-[#AEB8C5]">
                Operador: <strong className="text-[#F4F6F8]">{session.user.displayName}</strong> · Matrícula:{' '}
                <strong className="font-mono-tabular text-[#F5B91B]">
                  {session.user.badgeCode || 'Não informada'}
                </strong>{' '}
                · Função: <strong className="text-[#F4F6F8]">{session.user.jobTitle || session.user.roleName}</strong>
              </p>
            </div>
            <span className="inline-flex items-center rounded-lg border border-blue-400/40 bg-blue-500/15 px-3 py-1 text-[11px] font-bold text-blue-200">
              {activeHandover?.workflowStatus || 'EM_ELABORACAO'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
              <p className="text-[11px] text-[#AEB8C5]">Movimentações no Turno</p>
              <p className="mt-1 font-mono-tabular text-lg font-extrabold text-[#F4F6F8]">
                {shiftSummary?.movementsTotalCount ?? shiftSummary?.chronologicalEvents.length ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
              <p className="text-[11px] text-[#AEB8C5]">Veículos Descarregados</p>
              <p className="mt-1 font-mono-tabular text-lg font-extrabold text-emerald-400">
                {shiftSummary?.vehicleBreakdown?.totalCountedVehicles ?? shiftSummary?.receiptsCount ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
              <p className="text-[11px] text-[#AEB8C5]">Ocorrências Abertas</p>
              <p className="mt-1 font-mono-tabular text-lg font-extrabold text-amber-400">
                {shiftSummary?.openOccurrencesCount ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
              <p className="text-[11px] text-[#AEB8C5]">Pendências Ativas</p>
              <p className="mt-1 font-mono-tabular text-lg font-extrabold text-[#F5B91B]">
                {openShiftPendencies.length}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => (onNavigateToShiftReport ? onNavigateToShiftReport('view') : onNavigate('turnos'))}
              className="min-h-[48px] rounded-xl border border-[#AEB8C5]/25 bg-[#0A1421] px-4 py-2.5 text-left text-xs font-extrabold text-[#F4F6F8] hover:border-[#F5B91B]"
            >
              1. VER RELATÓRIO
            </button>
            <button
              type="button"
              onClick={() => onNavigate('ocorrencias')}
              className="min-h-[48px] rounded-xl border border-amber-500/35 bg-[#0A1421] px-4 py-2.5 text-left text-xs font-extrabold text-amber-200 hover:border-amber-400"
            >
              2. ADICIONAR OCORRÊNCIA
            </button>
            <button
              type="button"
              onClick={() =>
                onNavigateToShiftReport ? onNavigateToShiftReport('supplement') : onNavigate('turnos')
              }
              className="min-h-[48px] rounded-xl border border-[#3B82F6]/35 bg-[#0A1421] px-4 py-2.5 text-left text-xs font-extrabold text-blue-200 hover:border-[#3B82F6]"
            >
              3. COMPLEMENTAR INFORMAÇÃO
            </button>
            <button
              type="button"
              onClick={() => (onNavigateToShiftReport ? onNavigateToShiftReport('ai') : onNavigate('turnos'))}
              className="min-h-[48px] rounded-xl border border-blue-400/40 bg-blue-500/15 px-4 py-2.5 text-left text-xs font-extrabold text-blue-100 hover:bg-blue-500/25"
            >
              4. ORGANIZAR COM IA
            </button>
            <button
              type="button"
              onClick={() => (onNavigateToShiftReport ? onNavigateToShiftReport('review') : onNavigate('turnos'))}
              className="min-h-[48px] rounded-xl border border-emerald-500/40 bg-[#0A1421] px-4 py-2.5 text-left text-xs font-extrabold text-emerald-200 hover:border-emerald-400"
            >
              5. CONFERIR PASSAGEM DE TURNO
            </button>
            <button
              type="button"
              onClick={() => (onNavigateToShiftReport ? onNavigateToShiftReport('finalize') : onNavigate('turnos'))}
              className="min-h-[48px] rounded-xl bg-[#F5B91B] px-4 py-2.5 text-left text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
            >
              6. ENCERRAR TURNO
            </button>
          </div>
        </section>
      )}

      {/* Grade Principal de Ações Grandes */}
      <section aria-label="Ações Principais da Moega">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {actionCards.map((card) => (
            <button
              key={card.id}
              type="button"
              disabled={card.disabled}
              onClick={card.onClick}
              className={`group flex min-h-[168px] flex-col justify-between rounded-2xl border bg-[#101B2A] p-5 text-left transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${card.accentBorder}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-[#AEB8C5]/15 bg-[#0A1421] p-2">
                  {card.illustration}
                </div>
                {card.badgeText && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${badgeToneClass(
                      card.badgeTone
                    )}`}
                  >
                    {card.disabled && <Lock className="h-3 w-3" />}
                    {card.badgeText}
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-1">
                <h2 className="font-display text-base font-extrabold tracking-tight text-[#F4F6F8] group-hover:text-[#F5B91B]">
                  {card.title}
                </h2>
                <p className="text-xs leading-relaxed text-[#AEB8C5]">
                  {card.disabled && card.disabledHint ? card.disabledHint : card.subtitle}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Somente Alertas que Exigem Atenção Real Agora */}
      <section
        id="nexo-operational-alerts"
        className={`rounded-2xl border bg-[#101B2A] p-5 transition-colors ${
          showAlertsFocus ? 'border-[#F5B91B]' : 'border-[#AEB8C5]/15'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
          <div className="flex items-center gap-2.5">
            <Bell className={`h-5 w-5 ${totalAttentionAlerts > 0 ? 'text-[#F5B91B]' : 'text-emerald-400'}`} />
            <div>
              <h2 className="font-display text-base font-bold text-[#F4F6F8]">
                Atenção Agora na Operação
              </h2>
              <p className="text-xs text-[#AEB8C5]">
                Mostrando apenas itens reais que precisam de ação ou cuidado neste turno.
              </p>
            </div>
          </div>
          {totalAttentionAlerts > 0 && (
            <span className="font-mono-tabular text-xs font-bold text-[#F5B91B]">
              {totalAttentionAlerts} aviso(s) ativo(s)
            </span>
          )}
        </div>

        {totalAttentionAlerts === 0 && activePendencies.length === 0 ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            <span>Tudo tranquilo no momento. Nenhum silo crítico ou descarga parada neste turno.</span>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {criticalSilos.slice(0, 4).map((s) => (
              <div
                key={`crit-${s.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-red-500/60 bg-red-950/30 p-3.5 nexo-row-pulse-red"
              >
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-red-200">
                    SILO {s.siloNumber} · NÍVEL CRÍTICO (VERMELHO)
                  </p>
                  <p className="truncate text-sm font-bold text-[#F4F6F8]">
                    {s.materialDescription || 'Sem material'}
                  </p>
                  <p className="font-mono-tabular text-xs text-red-200/80">
                    Saldo atual: {formatKg(s.confirmedStockKg)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('mapa')}
                  className="min-h-[44px] shrink-0 rounded-lg bg-red-600 px-3.5 text-xs font-bold text-white hover:bg-red-500"
                >
                  Ver Silo
                </button>
              </div>
            ))}

            {lowSilos.slice(0, 4).map((s) => (
              <div
                key={`low-${s.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-orange-500/55 bg-orange-950/25 p-3.5 nexo-row-pulse-orange"
              >
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-orange-200">
                    SILO {s.siloNumber} · ESTOQUE BAIXO (LARANJA)
                  </p>
                  <p className="truncate text-sm font-bold text-[#F4F6F8]">
                    {s.materialDescription || 'Sem material'}
                  </p>
                  <p className="font-mono-tabular text-xs text-orange-200/80">
                    Saldo atual: {formatKg(s.confirmedStockKg)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('mapa')}
                  className="min-h-[44px] shrink-0 rounded-lg bg-orange-500 px-3.5 text-xs font-bold text-[#0A1421] hover:bg-orange-400"
                >
                  Ver Silo
                </button>
              </div>
            ))}

            {pendingReceipts.slice(0, 3).map((rec) => (
              <div
                key={`rec-${rec.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#F5B91B]/45 bg-[#0A1421] p-3.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[#F5B91B]">
                    DESCARGA PARCIAL PENDENTE · {rec.receiptNumber}
                  </p>
                  <p className="truncate text-sm font-bold text-[#F4F6F8]">
                    {rec.materialDescription} (Lote {rec.lotCode})
                  </p>
                  <p className="font-mono-tabular text-xs text-[#AEB8C5]">
                    Falta descarregar: {formatKg(rec.remainingQuantityKg)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('distribuicao')}
                  className="min-h-[44px] shrink-0 rounded-lg bg-[#F5B91B] px-3.5 text-xs font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
                >
                  Continuar
                </button>
              </div>
            ))}

            {openShiftPendencies.slice(0, 2).map((p) => (
              <div
                key={`sp-${p.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#3B82F6]/45 bg-[#0A1421] p-3.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[#60A5FA]">
                    AVISO DE PASSAGEM DE TURNO
                  </p>
                  <p className="truncate text-sm font-bold text-[#F4F6F8]">{p.title}</p>
                  <p className="truncate text-xs text-[#AEB8C5]">{p.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('turnos')}
                  className="min-h-[44px] shrink-0 rounded-lg border border-[#3B82F6]/50 bg-[#152336] px-3.5 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]"
                >
                  Abrir Turno
                </button>
              </div>
            ))}

            {blockedSilos.slice(0, 2).map((s) => (
              <div
                key={`blk-${s.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-[#0A1421] p-3.5"
              >
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-red-300">
                    SILO {s.siloNumber} INDISPONÍVEL ({s.operationalStatus})
                  </p>
                  <p className="truncate text-sm font-bold text-[#F4F6F8]">
                    {s.materialDescription || 'Sem material'}
                  </p>
                  <p className="truncate text-xs text-[#AEB8C5]">
                    {s.restrictions || 'Não enviar material para este silo'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('mapa')}
                  className="min-h-[44px] shrink-0 rounded-lg border border-red-500/40 px-3.5 text-xs font-bold text-red-200 hover:bg-red-500/15"
                >
                  Consultar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Outras Consultas e Ferramentas Autorizadas (Preserva 100% das Fases 1-5 sem poluir a tela) */}
      <section className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wider text-[#AEB8C5]">
              Outras Consultas Autorizadas
            </h2>
            <p className="text-xs text-[#AEB8C5]/80">
              Acesse programação, relatórios, ocorrências ou tire dúvidas com o manual e assistente.
            </p>
          </div>
          <ClipboardCheck className="h-4 w-4 text-[#F5B91B]" />
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {secondaryTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onNavigate(tool.id)}
                className="flex min-h-[56px] items-center justify-between gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] px-3.5 py-2.5 text-left hover:border-[#F5B91B]/60"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className="h-4 w-4 shrink-0 text-[#F5B91B]" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-[#F4F6F8]">{tool.label}</p>
                    <p className="truncate text-[11px] text-[#AEB8C5]">{tool.desc}</p>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#AEB8C5]" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};
