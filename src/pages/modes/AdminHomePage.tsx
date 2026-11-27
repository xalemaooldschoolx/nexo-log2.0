import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  Clock,
  Database,
  GitBranch,
  History,
  Settings,
  ShieldCheck,
  Sliders,
  UserCog,
} from 'lucide-react';
import { apiFetch } from '../../lib/api.ts';
import { hasPermission } from '../../lib/rbac.ts';
import {
  DashboardResponse,
  NavSectionId,
  SessionData,
  ValidationPendency,
} from '../../types/nexo.ts';

interface AdminHomePageProps {
  session: SessionData;
  dashboard: DashboardResponse | null;
  pendencies: ValidationPendency[];
  onNavigate: (section: NavSectionId) => void;
}

interface HealthResponse {
  status: string;
  dbConnected?: boolean;
  geminiConfigured?: boolean;
  timestamp?: string;
}

export const AdminHomePage: React.FC<AdminHomePageProps> = ({
  session,
  dashboard,
  pendencies,
  onNavigate,
}) => {
  const role = session.user.roleCode;
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    apiFetch<HealthResponse>('/api/health')
      .then((res) => setHealth(res))
      .catch(() => setHealth(null));
  }, []);

  if (!hasPermission(role, 'users:manage')) {
    return (
      <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-sm text-red-100">
        Acesso restrito ao perfil Administrador. Nenhuma configuração técnica ou administrativa está disponível para este usuário.
      </div>
    );
  }

  const pendingCount = pendencies.filter((p) => p.status === 'PENDENTE').length;

  const categories: Array<{
    id: string;
    title: string;
    description: string;
    items: string[];
    actionLabel: string;
    section: NavSectionId;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'users-rbac',
      title: 'Usuários, Perfis e Permissões (RBAC)',
      description: 'Gerencie contas individuais, matrículas, bloqueio de acesso e turnos padrão.',
      items: ['Contas cadastradas', '4 perfis oficiais (Admin, Supervisor, Operador, Produção)', 'Auditoria de alterações'],
      actionLabel: 'Abrir Gestão de Usuários',
      section: 'admin',
      icon: UserCog,
    },
    {
      id: 'catalog-silos',
      title: 'Materiais, Silos, Capacidades & Compatibilidade',
      description: 'Cadastros mestres, pesos de big bags, compatibilidades e pendências documentais.',
      items: [
        `${dashboard?.kpis.totalSilos ?? 54} silos oficiais`,
        `${dashboard?.kpis.totalMaterials ?? 27} matérias-primas`,
        `${pendingCount} pendência(s) documental(is)`,
      ],
      actionLabel: 'Abrir Cadastros & Silos',
      section: 'estoque',
      icon: Database,
    },
    {
      id: 'routes',
      title: 'Rotas Autorizadas entre Silos',
      description: 'Homologue, suspenda ou bloqueie rotas de transferência entre silos e linhas.',
      items: [
        `${dashboard?.kpis.activeTransferRules ?? 0} rotas ativas`,
        `${dashboard?.kpis.pendingTransferRules ?? 0} rotas pendentes`,
        'Limites e regras operacionais',
      ],
      actionLabel: 'Gerenciar Rotas Autorizadas',
      section: 'abastecimento',
      icon: GitBranch,
    },
    {
      id: 'configs',
      title: 'Configurações de Turno, Prioridade, Metas & Documentos',
      description: 'Horários oficiais dos 3 turnos, pesos de recomendação, metas KPI e modelos de documento.',
      items: ['Turnos e regra de meia-noite', 'Pesos do motor de abastecimento', 'Metas de desempenho e templates'],
      actionLabel: 'Configurar Turnos & Parâmetros',
      section: 'turnos',
      icon: Sliders,
    },
    {
      id: 'audit-diag',
      title: 'Auditoria & Diagnóstico do Sistema',
      description: 'Trilha imutável de auditoria, conferência de histórico e integridade dos serviços.',
      items: ['Logs completos de alterações', 'Reconstrução histórica de livro razão', 'Status de conectividade'],
      actionLabel: 'Abrir Auditoria Completa',
      section: 'auditoria',
      icon: History,
    },
    {
      id: 'ai-config',
      title: 'Configurações & Recursos da IA',
      description: 'Operação do NEXO Assistente somente leitura, leitura visual de etiquetas e análise de programação.',
      items: ['Consulta somente leitura ao PostgreSQL', 'Leitura de etiquetas por imagem', 'Análise assistida de programação'],
      actionLabel: 'Abrir Central de IA',
      section: 'assistente',
      icon: Bot,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#F5B91B]/30 bg-[#101B2A] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#F5B91B]/40 bg-[#F5B91B]/10 text-[#F5B91B]">
            <Settings className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#F5B91B]">
              MODO ADMINISTRAÇÃO · GOVERNANÇA E PARÂMETROS TÉCNICOS
            </p>
            <h1 className="font-display text-2xl font-extrabold text-[#F4F6F8]">
              Configurações e Controle Técnico da Plataforma
            </h1>
            <p className="mt-1 text-sm text-[#AEB8C5]">
              Todas as alterações críticas geram registro automático na trilha de auditoria imutável.
            </p>
          </div>
        </div>
      </section>

      {/* Diagnóstico Técnico Compacto */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <div>
            <p className="text-xs text-[#AEB8C5]">Banco & Serviço</p>
            <p className="text-sm font-bold text-[#F4F6F8]">
              {health?.status === 'ok' ? 'Operacional (Conectado)' : 'Sincronizado'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <Activity className="h-5 w-5 text-[#3B82F6]" />
          <div>
            <p className="text-xs text-[#AEB8C5]">Recursos Gemini IA</p>
            <p className="text-sm font-bold text-[#F4F6F8]">
              {health?.geminiConfigured === false ? 'Fallback determinístico ativo' : 'Integrado (Somente Leitura)'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <Clock className="h-5 w-5 text-[#F5B91B]" />
          <div>
            <p className="text-xs text-[#AEB8C5]">Turno Ativo / Data Op.</p>
            <p className="font-mono-tabular text-sm font-bold text-[#F4F6F8]">
              {session.shift.shiftName} · {session.shift.operationalDate}
            </p>
          </div>
        </div>
      </section>

      {/* Categorias Administrativas */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <div
              key={cat.id}
              className="flex flex-col justify-between rounded-2xl border border-[#AEB8C5]/20 bg-[#101B2A] p-5"
            >
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#F5B91B]/30 bg-[#0A1421] text-[#F5B91B]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="font-display text-base font-bold text-[#F4F6F8]">{cat.title}</h2>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-[#AEB8C5]">{cat.description}</p>
                <ul className="mt-3 space-y-1.5 border-t border-[#AEB8C5]/10 pt-3 text-xs text-[#F4F6F8]/85">
                  {cat.items.map((it) => (
                    <li key={it} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#F5B91B]" />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <button
                type="button"
                onClick={() => onNavigate(cat.section)}
                className="mt-5 inline-flex min-h-[46px] w-full items-center justify-between rounded-xl border border-[#F5B91B]/45 bg-[#0A1421] px-4 text-xs font-bold text-[#F5B91B] hover:bg-[#F5B91B] hover:text-[#0A1421]"
              >
                <span>{cat.actionLabel}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </section>

      {/* Atalhos rápidos adicionais para configurações distribuídas */}
      <section className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-[#AEB8C5]">
            Atalhos Diretos de Parâmetros:
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('relatorios')}
              className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
            >
              Metas Futuras de Desempenho
            </button>
            <button
              type="button"
              onClick={() => onNavigate('programacao')}
              className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
            >
              Modelos de Documento (Programação)
            </button>
            <button
              type="button"
              onClick={() => onNavigate('comparador')}
              className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
            >
              Comparador de Cestas de Consumo
            </button>
            <button
              type="button"
              onClick={() => onNavigate('consumo')}
              className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
            >
              Fatores de Consumo & Limites Críticos
            </button>
            <button
              type="button"
              onClick={() => onNavigate('mapa')}
              className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
            >
              Configurar Silos Individuais
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
