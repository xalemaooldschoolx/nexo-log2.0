import React from 'react';
import { ArrowRight, Layers, Lock, ShieldCheck } from 'lucide-react';
import { NavSectionId } from '../types/nexo.ts';
import { RoleCode } from '../lib/rbac.ts';

interface RoadmapModulePageProps {
  section: NavSectionId;
  userRole: RoleCode;
  onNavigate: (section: NavSectionId) => void;
}

const MODULE_META: Record<
  string,
  {
    phase: string;
    title: string;
    summary: string;
    capabilities: string[];
    phase1Ready: string[];
  }
> = {
  recebimentos: {
    phase: 'FASE 2 — RECEBIMENTOS, ETIQUETAS E TRANSFERÊNCIAS',
    title: 'Recebimento Inteligente e Descargas Fracionadas',
    summary:
      'Registro transacional pelo tablet com distribuição de uma única nota fiscal/lote entre múltiplos silos, controle de descarga parcial e detecção de duplicidade.',
    capabilities: [
      'Abertura de recebimento por placa, motorista, NF, fornecedor e turno automático',
      'Rateio de carga entre múltiplos silos com trava contra exceder capacidade segura (-10%)',
      'Alerta inteligente quando o mesmo lote já possuir movimentação registrada no silo',
      'Ficha digital RQ-REC-042 (Avaliação do Veículo e Controle de Descarga) vinculada',
    ],
    phase1Ready: [
      'Tabela inventory_movements criada no PostgreSQL para livro razão transacional',
      'Catálogo oficial de 27 matérias-primas, 7 fornecedores e 54 silos ativos',
    ],
  },
  etiquetas: {
    phase: 'FASE 3 — QUALIDADE, BAGS E LEITURA DE ETIQUETAS',
    title: 'Leitura de Etiquetas, Código de Barras e Controle de Bags',
    summary:
      'Leitura via câmera do tablet (ZXing) e leitor físico teclado, extração estruturada do código do produto/lote e cálculo auditado de bags.',
    capabilities: [
      'Leitura real de código de barras + OCR conferido pelo operador antes de gravar',
      'Detecção automática de leitura repetida do mesmo lote',
      'Controle de quantidade de bags × peso unitário com trava de confirmação documental',
    ],
    phase1Ready: [
      'Pesos preliminares de bags (Caulim, Fosfato, Alga, Veículo, Glúten, Calcário) sinalizados como PENDENTE_VALIDACAO',
      'Permissão de câmera declarada no manifesto PWA do tablet',
    ],
  },
  transferencias: {
    phase: 'FASE 2 — RECEBIMENTOS, ETIQUETAS E TRANSFERÊNCIAS',
    title: 'Execução de Transferências entre Silos',
    summary:
      'Movimentação atômica que debita o silo de origem e credita o destino compatível na mesma transação SQL, bloqueando qualquer regra não homologada.',
    capabilities: [
      'Débito de origem e crédito de destino atômicos sem geração de estoque fictício',
      'Validação obrigatória pela Matriz de Transferências e Capacidade Segura (-10%)',
      'Registro completo de operador, turno e motivo na trilha de auditoria',
    ],
    phase1Ready: [
      'Matriz de Regras já ativa e gerenciável em Estoque & Silos (Silo 37 -> Silos 10 e 15 homologada)',
      'Anotações de caderno mantidas inativas até validação oficial da supervisão',
    ],
  },
  programacao: {
    phase: 'FASE 4 — PROGRAMAÇÃO, CONSUMO E ABASTECIMENTO',
    title: 'Programação da Produção (Linhas 01 a 07) & Sensor Sistemas',
    summary:
      'Importação de programação diária e futura via PDF, foto, XLSX ou CSV sem sobrescrever revisões anteriores.',
    capabilities: [
      'Versionamento de revisões da programação (hoje, amanhã e planejamento futuro)',
      'Comparação automática entre revisões para identificar antecipação ou atraso',
      'Importação assistida de relatórios gerados pelo Sensor Sistemas',
    ],
    phase1Ready: [
      'Linhas de Produção L1 a L7 cadastradas e vinculadas aos seus silos físicos no PostgreSQL',
    ],
  },
  consumo: {
    phase: 'FASE 4 / FASE 5 — CONSUMO E INTELIGÊNCIA OPERACIONAL',
    title: 'Consumo Previsto, Realizado e Antecipação de Ruptura',
    summary:
      'Separação estrita entre consumo previsto, consumo realizado e consumo estimado, confrontando estoque confirmado com horizonte configurável.',
    capabilities: [
      'Cálculo de saldo projetado por linha, matéria-prima e silo compatível',
      'Alertas antecipados com explicação dos dados utilizados e recomendação de transferência',
    ],
    phase1Ready: [
      'Painel Principal e Mapa de Silos estruturados para ler saldos reais do PostgreSQL sem números fictícios',
    ],
  },
  abastecimento: {
    phase: 'FASE 4 — ABASTECIMENTO E SOLICITAÇÕES DA PRODUÇÃO',
    title: 'Solicitações de Material e Abastecimento das Linhas',
    summary:
      'Fluxo controlado entre Produção e Moega (Solicitado -> Recebido pela Moega -> Em análise -> Aprovado -> Atendido) sem baixa automática de estoque.',
    capabilities: [
      'Envio de solicitações pelo perfil Produção com urgência e justificativa',
      'Aprovação e atendimento rastreados pela equipe da Moega',
    ],
    phase1Ready: [
      'Perfil RBAC PRODUCAO ativo com permissão requests:create e bloqueio de edição na Moega',
    ],
  },
  qualidade: {
    phase: 'FASE 3 — QUALIDADE E DOCUMENTOS FÍSICOS',
    title: 'Qualidade, Amostragem e Bloqueio de Lotes',
    summary:
      'Registro de coletas, laudos, estados de amostra e trava formal que impede liberação de material reprovado ou bloqueado sem autorização superior.',
    capabilities: [
      'Controle de estados: Pendente, Coletada, Em análise, Aprovada, Reprovada, Bloqueada',
      'Vinculação com ficha RQ-REC-042 e documentos fotográficos originais',
    ],
    phase1Ready: [
      'Materiais críticos e requisitos de limpeza (ex.: pós-milho com calcário) mapeados no catálogo',
    ],
  },
  relatorios: {
    phase: 'FASE 6 — RELATÓRIOS, PASSAGEM DE TURNO E REFINAMENTO',
    title: 'Relatórios de Turno e Exportação Operacional',
    summary:
      'Fechamento de turno com passagem de serviço, movimentações consolidadas e exportação auditável.',
    capabilities: [
      'Relatório de passagem de serviço preservando a data operacional do 2º turno após 00h',
      'Exportação por período, turno, matéria-prima, silo e eventos de auditoria',
    ],
    phase1Ready: [
      'Motor de resolução automática de turnos (1º, 2º e 3º turno) já operacional em produção',
    ],
  },
};

export const RoadmapModulePage: React.FC<RoadmapModulePageProps> = ({
  section,
  userRole,
  onNavigate,
}) => {
  const meta = MODULE_META[section];
  if (!meta) return null;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#F5B91B]">
              {meta.phase}
            </p>
            <h2 className="font-display text-xl font-bold text-[#F4F6F8]">{meta.title}</h2>
            <p className="max-w-3xl text-sm leading-relaxed text-[#AEB8C5]">{meta.summary}</p>
          </div>

          <span className="inline-flex items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 py-2 text-xs font-medium text-[#AEB8C5]">
            <Lock className="h-3.5 w-3.5 text-[#F5B91B]" />
            <span>Módulo agendado · Fase 1 preserva integridade sem dados simulados</span>
          </span>
        </div>

        {userRole === 'PRODUCAO' && section !== 'abastecimento' && (
          <div className="mt-4 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-xs text-orange-200">
            Seu perfil atual é <span className="font-bold">Produção</span>: nesta visão você possui acesso apenas de consulta operacional, sem permissão de alteração de estoque ou cadastros da Moega.
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-[#F4F6F8]">
              <Layers className="h-4 w-4 text-[#3B82F6]" />
              <span>Escopo Funcional Programado</span>
            </div>
            <ul className="mt-3 space-y-2 text-xs text-[#AEB8C5]">
              {meta.capabilities.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#3B82F6]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-[#0A1421] p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
              <span>Fundações Já Ativas na Fase 1</span>
            </div>
            <ul className="mt-3 space-y-2 text-xs text-[#AEB8C5]">
              {meta.phase1Ready.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onNavigate('mapa')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 py-2 text-sm font-bold text-[#0A1421] hover:bg-[#F5B91B]/90"
          >
            <span>Explorar Mapa de Silos</span>
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('estoque')}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 py-2 text-sm font-medium text-[#F4F6F8] hover:border-[#F5B91B]/50"
          >
            <span>Consultar Cadastros e Matriz</span>
          </button>
        </div>
      </div>
    </div>
  );
};
