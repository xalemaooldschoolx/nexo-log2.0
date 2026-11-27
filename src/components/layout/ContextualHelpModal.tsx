import React, { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Search, Sparkles, X } from 'lucide-react';
import { HelpArticleItem, NavSectionId } from '../../types/nexo.ts';
import {
  AUTO_FEATURE_MANUALS,
  getFeatureManualsForSection,
} from '../../lib/manual-registry.ts';

interface ContextualHelpModalProps {
  open: boolean;
  onClose: () => void;
  activeSection: NavSectionId;
  articles: HelpArticleItem[];
  onOpenFullGuide: () => void;
}

export interface PlainLanguageGuide {
  id: string;
  title: string;
  keywords: string[];
  summary: string;
  steps: string[];
}

export const CORE_PLAIN_GUIDES: PlainLanguageGuide[] = [
  {
    id: 'recebimento',
    title: '1. Como fazer um Recebimento',
    keywords: ['receber', 'caminhao', 'granel', 'big bag', 'bag', 'fornecedor', 'nota fiscal', 'descarga'],
    summary: 'Passo a passo simples para registrar material que chegou no caminhão ou em big bag.',
    steps: [
      'Na tela inicial, toque no botão grande RECEBER MATERIAL.',
      'Escolha se a carga é Granel ou Big Bag, selecione o fornecedor e toque em CONTINUAR.',
      'Escolha o material e digite ou leia o número do lote na etiqueta.',
      'Selecione o silo verde/liberado com espaço livre e informe o peso (ou quantidade de bags).',
      'Confira tudo na tela de revisão e toque em CONFIRMAR.',
    ],
  },
  {
    id: 'etiqueta',
    title: '2. Como ler Etiqueta e conferir Lote',
    keywords: ['etiqueta', 'codigo de barras', 'camera', 'foto', 'lote', 'scanner', 'ler'],
    summary: 'Evite digitar errado usando a câmera, leitor de mão ou foto da etiqueta.',
    steps: [
      'Toque em LER ETIQUETA na tela inicial (ou na Etapa 2 do Recebimento).',
      'Escolha Escanear Código de Barras, Fotografar Etiqueta ou Digitar Lote.',
      'Se o lote já tiver sido usado antes, o sistema mostra um aviso vermelho claro na tela.',
      'Toque em Aplicar Dados para preencher o recebimento automaticamente.',
    ],
  },
  {
    id: 'silo',
    title: '3. Como consultar Silos no Mapa',
    keywords: ['silo', 'mapa', 'espaco', 'cheio', 'vazio', 'estoque', 'capacidade'],
    summary: 'Veja rapidamente quanto tem em cada silo, qual material está lá e se precisa encher.',
    steps: [
      'Toque em CONSULTAR SILOS na tela inicial.',
      'Use a busca no topo para digitar o número do silo ou nome do produto.',
      'Observe a cor e o texto embaixo: Vermelho = Crítico, Laranja = Baixo, Ciano = Recebendo.',
      'Toque em qualquer silo para abrir o cartão simples; toque em VER DETALHES se precisar ver os lotes.',
    ],
  },
  {
    id: 'transferencia',
    title: '4. Como transferir Material entre Silos',
    keywords: ['transferir', 'transferencia', 'rosca', 'mover', 'rota', 'origem', 'destino'],
    summary: 'Mova material de um silo de armazenagem para outro da linha usando apenas rotas autorizadas.',
    steps: [
      'Toque em TRANSFERIR MATERIAL na tela inicial.',
      'Escolha uma rota liberada (por exemplo: Silo 37 → Silo 15). Rotas bloqueadas não podem ser usadas.',
      'Informe quantos quilos deseja transferir sem ultrapassar o espaço livre do silo de destino.',
      'Toque em CONFIRMAR para atualizar os dois silos automaticamente.',
    ],
  },
  {
    id: 'abastecimento',
    title: '5. Como acompanhar o Abastecimento das Linhas',
    keywords: ['abastecimento', 'linha', 'producao', 'falta', 'recomendacao', 'parar'],
    summary: 'Veja qual linha está com material suficiente e qual precisa de atenção antes de faltar.',
    steps: [
      'Toque em ABASTECIMENTO na tela inicial.',
      'Veja as cores e avisos por linha: Verde = OK, Laranja = Atenção, Vermelho = Risco Crítico.',
      'Se o sistema sugerir uma transferência, toque em Criar Solicitação de Transferência e confirme.',
    ],
  },
  {
    id: 'turno',
    title: '6. Como fazer a Passagem de Turno',
    keywords: ['turno', 'passagem', 'troca', 'ciencia', 'pendencia', 'horario'],
    summary: 'Deixe tudo anotado e claro para quem vai assumir o próximo turno.',
    steps: [
      'Toque em PASSAGEM DE TURNO antes de encerrar o serviço.',
      'O sistema já preenche automaticamente o que entrou, saiu e o que ficou pendente no turno.',
      'Revise as pendências abertas do turno anterior e marque Ciência quando necessário.',
      'Escreva observações importantes para o colega e salve ou finalize a passagem.',
    ],
  },
  {
    id: 'relatorio',
    title: '7. Como gerar e baixar Relatórios',
    keywords: ['relatorio', 'excel', 'pdf', 'csv', 'exportar', 'historico', 'indicadores'],
    summary: 'Consulte o histórico de entradas, saídas e estoque de qualquer data.',
    steps: [
      'Abra Relatórios & Indicadores no menu.',
      'Escolha o tipo de relatório (Recebimentos, Estoque, Transferências ou Consumo) e o período.',
      'Toque em Exportar PDF, XLSX ou CSV para baixar o arquivo pronto.',
    ],
  },
];

const SECTION_SIMPLE_HELP: Record<NavSectionId, { title: string; summary: string; steps: string[] }> = {
  inicio: {
    title: 'Tela Inicial por Tarefas',
    summary: 'Escolha a tarefa que você quer fazer tocando em um dos botões grandes.',
    steps: [
      'Os blocos grandes mostram as ações principais do seu perfil.',
      'Logo abaixo aparecem apenas os avisos importantes que precisam de atenção agora.',
      'Se precisar de ajuda em qualquer tela, toque sempre em COMO UTILIZAR? no topo.',
    ],
  },
  executivo: {
    title: 'Apresentação Executiva',
    summary: 'Painel preparado para mostrar indicadores e resultados da Moega à supervisão.',
    steps: [
      'Navegue pelos cartões de indicadores ou alterne entre Cenário Operacional e Espelho Ao Vivo.',
      'Use o botão Copiar Link Direto para compartilhar a tela de apresentação.',
    ],
  },
  painel: {
    title: 'Painel de Indicadores da Moega',
    summary: 'Mostra os números totais de estoque, silos ativos e situação por linha.',
    steps: [
      'Confira o estoque total confirmado nos 54 silos.',
      'Toque em Abrir Mapa de Silos ou Ver Tabela Completa para investigar qualquer linha.',
    ],
  },
  mapa: {
    title: 'Mapa Visual dos 54 Silos',
    summary: 'Mostra onde está cada silo na fábrica, quanto material tem dentro e a cor da situação.',
    steps: [
      'Use a busca no topo para achar rapidamente um número de silo ou material.',
      'Toque em um silo para ver saldo, espaço livre e botão de RECEBER MATERIAL NESTE SILO.',
      'Supervisores e Admins podem alternar entre Visão Simples, Detalhada e Planta 3D.',
    ],
  },
  recebimentos: {
    title: 'Recebimento Guiado Passo a Passo',
    summary: 'Siga as 6 etapas na tela para registrar a chegada de material sem esquecer nada.',
    steps: [
      'Etapa 1: Escolha Granel ou Big Bag e informe o fornecedor.',
      'Etapa 2: Escolha a matéria-prima e confira ou leia a etiqueta do lote.',
      'Etapa 3 e 4: Escolha os silos compatíveis e digite o peso.',
      'Etapa 5 e 6: Revise o resumo e toque em CONFIRMAR.',
    ],
  },
  etiquetas: {
    title: 'Leitura de Etiquetas e Lotes',
    summary: 'Leia código de barras, tire foto da etiqueta ou digite o lote para conferência rápida.',
    steps: [
      'Escolha Escanear Código, Fotografar Etiqueta ou Digitar Lote.',
      'Confira os dados lidos pelo sistema antes de aplicar ao recebimento.',
    ],
  },
  distribuicao: {
    title: 'Registrar Descarga Pendente / Parcial',
    summary: 'Continue uma descarga que começou antes e ainda falta enviar parte da carga para o silo.',
    steps: [
      'Escolha o caminhão ou recebimento pendente na lista.',
      'Toque em Continuar Descarga e escolha os silos para o restante do peso.',
    ],
  },
  transferencias: {
    title: 'Transferir Material entre Silos',
    summary: 'Passe material de um silo de origem para um silo de destino usando uma rota autorizada.',
    steps: [
      'Escolha uma rota liberada (ex.: Silo 37 para Silo 15).',
      'Digite a quantidade em quilos respeitando o saldo na origem e espaço livre no destino.',
      'Revise e confirme a movimentação.',
    ],
  },
  estoque: {
    title: 'Estoque, Materiais & Pendências',
    summary: 'Consulte todos os silos em lista, matérias-primas, pesos de big bags e pendências.',
    steps: [
      'Use as abas no topo para alternar entre Silos, Matérias-Primas, Big Bags, Matriz e Pendências.',
      'Use a caixa de busca para filtrar rapidamente por código ou nome.',
    ],
  },
  programacao: {
    title: 'Programação da Produção',
    summary: 'Importe ou consulte o plano de produção das linhas para hoje e amanhã.',
    steps: [
      'Envie foto, PDF, planilha ou digite a programação.',
      'Confira os itens lado a lado antes da aprovação oficial.',
    ],
  },
  comparador: {
    title: 'Comparador Inteligente de Cestas de Consumo',
    summary: 'Compare duas ou mais versões da cesta do dia (ex.: 07:00 × 19:00), confira valores e publique atualizações com alerta imediato.',
    steps: [
      'Toque em NOVA COMPARAÇÃO e informe a data de produção e os nomes das duas cestas.',
      'Capture fotos (1 ou mais páginas), PDF, Excel ou CSV de cada programação.',
      'Revise os itens destacados em amarelo na Tela de Conferência antes de gerar a comparação.',
      'Analise aumentos, reduções e impacto nos silos; se autorizado, toque em PUBLICAR NOVA PROGRAMAÇÃO.',
    ],
  },
  consumo: {
    title: 'Consumo & Previsão de Estoque',
    summary: 'Compare o estoque real com o que a produção vai gastar hoje e amanhã.',
    steps: [
      'Veja quais materiais estão em Vermelho ou Laranja para agir antes que falte.',
    ],
  },
  abastecimento: {
    title: 'Abastecimento das Linhas & Rotas',
    summary: 'Painel de cores das linhas L1 a L7 com sugestões de transferência e rotas autorizadas.',
    steps: [
      'Acompanhe as linhas em Vermelho ou Laranja que precisam de material.',
      'Toque em Criar Solicitação de Transferência quando houver rota disponível.',
    ],
  },
  qualidade: {
    title: 'Qualidade & Bloqueio de Lotes',
    summary: 'Espaço reservado para conferência de amostragem e travas de segurança de lote.',
    steps: [
      'Materiais bloqueados não podem ser liberados para as linhas sem autorização.',
    ],
  },
  relatorios: {
    title: 'Relatórios & Indicadores',
    summary: 'Consulte entradas, saídas, estoque histórico e exporte em PDF, XLSX ou CSV.',
    steps: [
      'Selecione o período e o tipo de relatório nas abas superiores.',
      'Clique em Exportar quando precisar salvar ou imprimir.',
    ],
  },
  turnos: {
    title: 'Turnos & Passagem de Serviço',
    summary: 'Confira o resumo automático das movimentações do turno e registre a passagem.',
    steps: [
      'Verifique pendências abertas e dê Ciência quando aplicável.',
      'Preencha as orientações para o próximo turno e finalize a passagem.',
    ],
  },
  ocorrencias: {
    title: 'Central de Ocorrências',
    summary: 'Registre problemas de equipamento, atraso de veículo, falta de material ou divergências.',
    steps: [
      'Toque em Nova Ocorrência, escolha a categoria simples e descreva o que aconteceu.',
    ],
  },
  assistente: {
    title: 'NEXO Assistente (IA)',
    summary: 'Pergunte em português simples sobre estoques, recebimentos e pendências reais.',
    steps: [
      'Toque em uma pergunta pronta ou digite sua dúvida sobre a operação.',
      'O assistente apenas consulta dados reais — ele nunca altera o estoque.',
    ],
  },
  auditoria: {
    title: 'Auditoria & Histórico Imutável',
    summary: 'Mostra quem fez cada alteração cadastral, quando fez e por qual motivo.',
    steps: [
      'Use a busca para filtrar por nome do usuário, silo ou ação.',
    ],
  },
  admin: {
    title: 'Administração de Usuários & Perfis',
    summary: 'Gerencie quem pode acessar cada função do NEXO LOG e defina o turno padrão.',
    steps: [
      'Toque em Editar Acesso ao lado de um usuário e informe o motivo para auditoria.',
    ],
  },
  guia: {
    title: 'Manual Ilustrado de Operação',
    summary: 'Todos os guias passo a passo com busca por palavras simples do dia a dia.',
    steps: [
      'Digite palavras como "caminhão", "bag", "etiqueta" ou "turno" para achar o guia certo.',
    ],
  },
};

export const ContextualHelpModal: React.FC<ContextualHelpModalProps> = ({
  open,
  onClose,
  activeSection,
  articles,
  onOpenFullGuide,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);

  const filteredGuides = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return CORE_PLAIN_GUIDES;
    return CORE_PLAIN_GUIDES.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.summary.toLowerCase().includes(q) ||
        g.keywords.some((kw) => kw.includes(q)) ||
        g.steps.some((st) => st.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  const sectionFeatureManuals = useMemo(
    () => getFeatureManualsForSection(activeSection),
    [activeSection]
  );

  const matchingAutoFeatures = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return AUTO_FEATURE_MANUALS.filter(
      (f) =>
        f.title.toLowerCase().includes(q) ||
        f.summary.toLowerCase().includes(q) ||
        f.moduleLabel.toLowerCase().includes(q) ||
        f.keywords.some((kw) => kw.toLowerCase().includes(q)) ||
        f.steps.some((st) => st.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  if (!open) return null;

  const sectionHelp = SECTION_SIMPLE_HELP[activeSection] || SECTION_SIMPLE_HELP.inicio;
  const matchedArticle = articles.find((a) => a.module === activeSection);
  const selectedGuide = selectedGuideId
    ? CORE_PLAIN_GUIDES.find((g) => g.id === selectedGuideId) || null
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#AEB8C5]/25 bg-[#101B2A] text-[#F4F6F8]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#AEB8C5]/15 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#F5B91B]/40 bg-[#F5B91B]/10 text-[#F5B91B]">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                Como utilizar esta tela?
              </p>
              <h3 className="font-display text-lg font-extrabold text-[#F4F6F8]">
                {selectedGuide ? selectedGuide.title : sectionHelp.title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar ajuda"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A2B42]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Busca simples por palavras-chave */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#AEB8C5]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedGuideId(null);
              }}
              placeholder="Buscar ajuda por palavra simples (ex.: caminhão, bag, etiqueta, silo, turno)..."
              className="min-h-[44px] w-full rounded-xl border border-[#AEB8C5]/25 bg-[#0A1421] pl-9 pr-3 text-sm text-[#F4F6F8] placeholder:text-[#AEB8C5]/60 focus:border-[#F5B91B] focus:outline-none"
            />
          </div>

          {/* Se não estiver buscando e não escolheu outro guia, mostra o passo a passo da tela atual */}
          {!searchQuery.trim() && !selectedGuide && (
            <div className="space-y-4">
              <div className="space-y-3 rounded-xl border border-[#F5B91B]/30 bg-[#0A1421] p-4">
                <p className="text-sm font-semibold text-[#F4F6F8]">{sectionHelp.summary}</p>
                <ol className="space-y-2">
                  {sectionHelp.steps.map((step, i) => (
                    <li key={step} className="flex items-start gap-2.5 text-sm text-[#AEB8C5]">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F5B91B]/20 font-mono-tabular text-xs font-extrabold text-[#F5B91B]">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed text-[#F4F6F8]/90">{step}</span>
                    </li>
                  ))}
                </ol>
                {matchedArticle && (
                  <p className="border-t border-[#AEB8C5]/10 pt-2.5 text-xs leading-relaxed text-[#AEB8C5]">
                    {matchedArticle.content}
                  </p>
                )}
              </div>

              {sectionFeatureManuals.length > 0 && (
                <div className="space-y-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Recursos &amp; Instruções desta Tela ({sectionFeatureManuals.length})</span>
                  </p>
                  {sectionFeatureManuals.map((feat) => (
                    <div
                      key={feat.id}
                      className="rounded-xl border border-emerald-500/25 bg-[#0A1421] p-3.5 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#F4F6F8]">{feat.title}</p>
                        <span className="rounded border border-[#AEB8C5]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#F5B91B]">
                          {feat.addedInStage}
                        </span>
                      </div>
                      <p className="text-xs text-[#AEB8C5]">{feat.summary}</p>
                      <ol className="space-y-1.5 pt-1">
                        {feat.steps.map((st, idx) => (
                          <li key={st} className="flex items-start gap-2 text-xs text-[#F4F6F8]/90">
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 font-mono-tabular text-[10px] font-bold text-emerald-300">
                              {idx + 1}
                            </span>
                            <span className="leading-relaxed">{st}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Resultados da busca no Registro Automático de Funcionalidades */}
          {searchQuery.trim() && !selectedGuide && matchingAutoFeatures.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Funcionalidades Encontradas ({matchingAutoFeatures.length})</span>
              </p>
              <div className="space-y-2">
                {matchingAutoFeatures.map((feat) => (
                  <div
                    key={feat.id}
                    className="rounded-xl border border-emerald-500/30 bg-[#0A1421] p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-[#F4F6F8]">{feat.title}</p>
                      <span className="text-[10px] font-bold uppercase text-[#F5B91B]">
                        {feat.moduleLabel}
                      </span>
                    </div>
                    <p className="text-xs text-[#AEB8C5]">{feat.summary}</p>
                    <ol className="space-y-1">
                      {feat.steps.map((st, idx) => (
                        <li key={st} className="flex items-start gap-2 text-xs text-[#F4F6F8]/85">
                          <span className="font-mono-tabular font-bold text-emerald-300">
                            {idx + 1}.
                          </span>
                          <span>{st}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guia selecionado */}
          {selectedGuide && (
            <div className="space-y-3 rounded-xl border border-emerald-500/35 bg-[#0A1421] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-emerald-300">{selectedGuide.summary}</p>
                <button
                  type="button"
                  onClick={() => setSelectedGuideId(null)}
                  className="text-xs font-bold text-[#F5B91B] hover:underline"
                >
                  Voltar para tela atual
                </button>
              </div>
              <ol className="space-y-2.5">
                {selectedGuide.steps.map((step, i) => (
                  <li key={step} className="flex items-start gap-2.5 text-sm">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 font-mono-tabular text-xs font-extrabold text-emerald-300">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed text-[#F4F6F8]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Lista dos 7 guias principais */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-[#AEB8C5]">
              Guias Rápidos por Tarefa ({filteredGuides.length})
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filteredGuides.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGuideId(g.id)}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${
                    selectedGuideId === g.id
                      ? 'border-[#F5B91B] bg-[#F5B91B]/10'
                      : 'border-[#AEB8C5]/15 bg-[#0A1421] hover:border-[#F5B91B]/50'
                  }`}
                >
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#F5B91B]" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#F4F6F8]">{g.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-[#AEB8C5]">{g.summary}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#AEB8C5]/15 p-4">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFullGuide();
            }}
            className="min-h-[44px] rounded-xl border border-[#AEB8C5]/30 px-4 py-2 text-sm font-semibold text-[#F4F6F8] hover:bg-[#1A2B42]"
          >
            Abrir Manual Ilustrado Completo
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-xl bg-[#F5B91B] px-5 py-2 text-sm font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
};
