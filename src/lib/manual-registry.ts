import type { HelpArticleItem, NavSectionId } from '../types/nexo.ts';
import type { RoleCode } from './rbac.ts';

export const ALL_NAV_SECTION_IDS: readonly NavSectionId[] = [
  'inicio',
  'executivo',
  'painel',
  'mapa',
  'estoque',
  'recebimentos',
  'etiquetas',
  'distribuicao',
  'transferencias',
  'programacao',
  'comparador',
  'consumo',
  'abastecimento',
  'qualidade',
  'relatorios',
  'turnos',
  'ocorrencias',
  'assistente',
  'auditoria',
  'admin',
  'guia',
] as const;

export interface FeatureManualEntry {
  id: string;
  slug: string;
  sectionId: NavSectionId;
  moduleLabel: string;
  title: string;
  summary: string;
  content: string;
  steps: string[];
  targetRoles: RoleCode[];
  keywords: string[];
  addedInStage: string;
  sortOrder: number;
}

/**
 * REGISTRO CENTRAL PADRONIZADO DO MANUAL (SINGLE SOURCE OF TRUTH).
 * Padrão obrigatório do NEXO LOG 2.0:
 * Toda nova funcionalidade ou módulo adicionado à plataforma deve incluir sua entrada aqui.
 * Automaticamente esta fonte alimenta:
 *  1. Banco PostgreSQL (`help_articles` em `src/db/seed-reference.ts`);
 *  2. Modo Apresentação / Sandbox (`BASE_HELP_ARTICLES` em `src/lib/demo-data.ts`);
 *  3. Ajuda Contextual da tela (`COMO UTILIZAR?` em `ContextualHelpModal.tsx`);
 *  4. Manual Ilustrado Completo (`GuidePage.tsx`);
 *  5. Testes automatizados de cobertura obrigatória do manual.
 */
export const AUTO_FEATURE_MANUALS: FeatureManualEntry[] = [
  {
    id: 'feat-inicio-tarefas',
    slug: 'tela-inicial-por-tarefas',
    sectionId: 'inicio',
    moduleLabel: 'Início',
    title: 'Tela Inicial Orientada a Tarefas por Perfil',
    summary: 'Acesso direto às ações principais conforme o modo Operacional, Gerencial ou Administração.',
    content:
      'A tela inicial apresenta botões grandes com linguagem direta ("O que você precisa fazer agora?") e resumo imediato apenas dos alertas reais do turno, ocultando parâmetros técnicos de quem está na operação de campo.',
    steps: [
      'Escolha o bloco da tarefa desejada (ex.: Receber Material, Ler Etiqueta, Consultar Silos, Transferir).',
      'Confira o painel de atenção imediata logo abaixo para priorizar silos críticos ou descargas pendentes.',
      'Supervisores e Administradores podem alternar o modo de visualização no topo sem alterar permissões reais.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['inicio', 'home', 'tarefas', 'modo operacional', 'gerencial'],
    addedInStage: 'Reestruturação UX/UI',
    sortOrder: 1,
  },
  {
    id: 'feat-painel-visao-geral',
    slug: 'visao-geral-nexo-log',
    sectionId: 'painel',
    moduleLabel: 'Painel',
    title: 'Visão Geral do NEXO LOG 2.0 e Indicadores da Moega',
    summary: 'Conceito operacional, significado das cores, saldos por linha e tendência de 30 dias.',
    content:
      'O NEXO LOG 2.0 centraliza o controle da Moega em tempo real. As cores têm significado operacional rigoroso: Azul identifica silos de linha e operação da Moega; Verde identifica área de Armazenagem e estados confirmados; Laranja identifica o grupo de Produção/Abastecimento; Amarelo sinaliza atenção ou pendência de validação; Vermelho indica bloqueio, divergência crítica ou risco operacional.',
    steps: [
      'Acompanhe o Estoque Total Confirmado nos 54 silos e a ocupação por linha L1 a L7.',
      'Use o gráfico Tendência de Consumo (Últimos 30 Dias) para comparar Previsto vs. Realizado por linha ou matéria-prima.',
      'Clique em Abrir Mapa de Silos ou Ver Tabela Completa para investigar qualquer desvio.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['painel', 'dashboard', 'tendencia', '30 dias', 'recharts', 'cores', 'indicadores'],
    addedInStage: 'Fase 1 + Tendência 30d',
    sortOrder: 2,
  },
  {
    id: 'feat-mapa-silos-rubricagem',
    slug: 'mapa-silos-rubricagem',
    sectionId: 'mapa',
    moduleLabel: 'Mapa de Silos',
    title: 'Como Ler o Mapa Visual dos 54 Silos (2D e 3D)',
    summary: 'Disposição física por linha, sequência preservada da rubricagem e 5 estados visuais.',
    content:
      'O mapa reproduz a disposição real dos 54 silos sem ordenação numérica artificial (não existem silos 27 e 30). Linhas 1 a 6 agrupam os silos de linha; Silos 42 a 34 compõem o pulmão de Armazenagem (Linha 7); Silos 43 a 64 compõem o grupo de Produção/Abastecimento. Clique em qualquer silo para inspecionar capacidade nominal, fator de segurança (-10%), saldo real por lote, compatibilidades e histórico.',
    steps: [
      'Use a busca rápida por número do silo, código ou nome da matéria-prima ou filtre por categoria/situação.',
      'Observe os sinalizadores: Vermelho pulsante = Crítico, Laranja = Estoque Baixo, Ciano = Em Recebimento, Verde/Azul = Disponível.',
      'Toque em qualquer silo para abrir o cartão com saldo, espaço livre e botão direto de Receber Material.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['mapa', 'silo', 'rubricagem', '3d', 'capacidade', 'lote', 'espaco'],
    addedInStage: 'Fase 1–2',
    sortOrder: 3,
  },
  {
    id: 'feat-mapa-historico-24h',
    slug: 'mapa-silos-historico-24h',
    sectionId: 'mapa',
    moduleLabel: 'Mapa de Silos',
    title: 'Histórico de Volume das Últimas 24 Horas (Recebimento e Consumo)',
    summary: 'Gráfico horário interativo no Mapa de Silos para identificar picos de entrada, saída e variação de saldo.',
    content:
      'O painel Histórico de Volume (24h) reconstrói hora a hora o saldo consolidado (em toneladas) a partir do estoque confirmado atual e das movimentações registradas no livro razão, separando barras de Entradas (Recebimentos/Transferências) e Saídas (Consumo/Transferências) para detectar padrões operacionais.',
    steps: [
      'Na página Mapa de Silos, expanda ou visualize o card Histórico de Volume — Últimas 24 Horas.',
      'Filtre por Categoria (Linhas, Armazenagem, Produção), Matéria-Prima específica ou Silo individual.',
      'Passe o mouse ou toque em qualquer barra horária para inspecionar entradas (+t), saídas (-t) e volume total naquela hora.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['24 horas', '24h', 'historico', 'volume', 'grafico', 'padrao', 'consumo', 'recebimento'],
    addedInStage: 'Mapa 24h & Limiares',
    sortOrder: 4,
  },
  {
    id: 'feat-mapa-limiares-materiais',
    slug: 'mapa-limiares-estoque-material',
    sectionId: 'mapa',
    moduleLabel: 'Mapa de Silos',
    title: 'Limiares de Estoque por Material e Notificações Proativas',
    summary: 'Configure alertas de estoque baixo (Laranja) e crítico (Vermelho) específicos para cada matéria-prima.',
    content:
      'Supervisores e Administradores podem definir limites mínimo crítico (Vermelho) e de atenção/baixo (Laranja) por tipo de matéria-prima (regra global da planta) ou por silo individual diretamente no Mapa de Silos. Sempre que o saldo atingir esses limites, os operadores recebem notificações proativas na faixa de alertas do mapa e no sino superior.',
    steps: [
      'No Mapa de Silos, clique em Limiares por Material (ou toque em Configurar Limiar dentro do cartão de um silo).',
      'Selecione a Matéria-Prima (e opcionalmente um Silo específico para regra dedicada) e informe Estoque Crítico (kg) e Estoque Baixo/Atenção (kg).',
      'Clique em Salvar Limiar Proativo; o sistema recalcula imediatamente os alertas dos silos e exibe notificações proativas aos operadores.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['limiar', 'limite', 'estoque baixo', 'critico', 'alerta proativo', 'notificacao', 'material'],
    addedInStage: 'Mapa 24h & Limiares',
    sortOrder: 5,
  },
  {
    id: 'feat-recebimentos-rateio',
    slug: 'recebimento-rateio-parcial',
    sectionId: 'recebimentos',
    moduleLabel: 'Recebimentos',
    title: 'Recebimento Guiado, Rateio entre Silos e Descarga Parcial',
    summary: 'Fluxo passo a passo: Identificar Carga -> Conferir Material -> Silo -> Quantidade -> Revisar -> Confirmar.',
    content:
      'Registre recebimentos a Granel ou Big Bag, distribuindo a carga entre um ou vários silos compatíveis. Se descarregar apenas parte da carga, o saldo restante fica pendente no recebimento para complemento posterior sem criar registro duplicado.',
    steps: [
      'Na Etapa 1, escolha Granel ou Big Bag, informe fornecedor, nota fiscal e veículo.',
      'Na Etapa 2, selecione a matéria-prima e confira ou escaneie a etiqueta do lote (com verificação automática de duplicidade).',
      'Nas Etapas 3 e 4, escolha um ou mais silos compatíveis com espaço livre e informe os quilos ou quantidade de bags.',
      'Revise os dados e toque em CONFIRMAR para creditar o estoque real no livro razão.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'SUPERVISOR', 'ADMIN'],
    keywords: ['recebimento', 'caminhao', 'granel', 'big bag', 'rateio', 'parcial', 'fornecedor'],
    addedInStage: 'Fase 2 + UX Guiada',
    sortOrder: 6,
  },
  {
    id: 'feat-leitura-etiquetas',
    slug: 'leitura-etiquetas-camera',
    sectionId: 'etiquetas',
    moduleLabel: 'Leitura de Etiquetas',
    title: 'Leitura de Etiquetas via Câmera, Leitor e Gemini Vision',
    summary: 'Prioridade: Código de barras (ZXing) -> Cadastro Interno -> Fotografia IA para conferência.',
    content:
      'Escaneie o código de barras com a câmera do tablet ou leitor físico para identificar material e lote automaticamente. Quando a etiqueta estiver danificada ou sem código legível, use Fotografar Etiqueta para extração assistida por Gemini Vision. A IA apenas sugere campos para conferência e nunca grava movimentação sem confirmação do operador.',
    steps: [
      'Escolha Escanear Código de Barras (câmera/leitor USB), Fotografar Etiqueta (IA) ou Digitar Lote.',
      'Confira material, código e histórico do lote (o sistema alerta se o lote já foi descarregado antes).',
      'Toque em Aplicar Dados ao Recebimento para preencher o formulário sem erros de digitação.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'SUPERVISOR', 'ADMIN'],
    keywords: ['etiqueta', 'codigo de barras', 'zxing', 'camera', 'gemini', 'lote', 'ocr'],
    addedInStage: 'Fase 2',
    sortOrder: 7,
  },
  {
    id: 'feat-descarga-pendente',
    slug: 'descarga-parcial-pendente',
    sectionId: 'distribuicao',
    moduleLabel: 'Descarga Pendente',
    title: 'Continuação de Descarga Parcial Pendente',
    summary: 'Finalize recebimentos iniciados em turnos anteriores sem duplicar nota fiscal ou lote.',
    content:
      'Recebimentos registrados com descarga parcial permanecem listados com o saldo exato ainda pendente. Ao continuar a descarga, o operador vincula os novos silos ao mesmo documento original e o estoque é atualizado somente após a confirmação.',
    steps: [
      'Acesse Registrar Descarga na tela inicial ou menu.',
      'Selecione o recebimento com status PARCIAL ou PENDENTE e toque em Continuar Descarga.',
      'Informe o silo de destino e o peso complementar e confirme.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'SUPERVISOR', 'ADMIN'],
    keywords: ['descarga', 'parcial', 'pendente', 'saldo restante', 'complemento'],
    addedInStage: 'Fase 2',
    sortOrder: 8,
  },
  {
    id: 'feat-transferencias-atomicas',
    slug: 'transferencias-atômicas',
    sectionId: 'transferencias',
    moduleLabel: 'Transferências',
    title: 'Transferências Atômicas, Matriz de Rotas e Estornos Autorizados',
    summary: 'Débito na origem e crédito no destino exclusivamente pelas rotas homologadas.',
    content:
      'Transferências entre silos exigem regra ativa e validada na Matriz de Transferências. O sistema debita a origem e credita o destino na mesma transação atômica. Correções de estoque só podem ser feitas por Supervisor ou Administrador mediante Estorno ou Ajuste Autorizado com motivo obrigatório.',
    steps: [
      'Escolha uma rota autorizada (ex.: Silo 37 -> Silo 10 ou Silo 15); rotas pendentes ou bloqueadas são impedidas automaticamente.',
      'Informe a quantidade em quilos respeitando saldo na origem e espaço livre seguro no destino.',
      'Confirme a transferência na etapa de revisão; o histórico preserva a composição original dos lotes.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['transferencia', 'rota', 'silo 37', 'estorno', 'ajuste', 'lote'],
    addedInStage: 'Fase 2 + Fase 4',
    sortOrder: 9,
  },
  {
    id: 'feat-estoque-materiais-bags',
    slug: 'cadastro-silos-compatibilidade',
    sectionId: 'estoque',
    moduleLabel: 'Estoque & Cadastros',
    title: 'Cadastro de Silos, Materiais, Pesos de Big Bags e Pendências',
    summary: 'Catálogo das 27 matérias-primas, embalagens de Big Bags, compatibilidade e divergências.',
    content:
      'Centraliza a consulta e gestão do catálogo oficial: capacidades nominais/seguras (-10%) dos 54 silos, códigos das 27 matérias-primas, pesos unitários editáveis de Big Bags (ex.: Alga 1.000/1.300 kg, Glúten 1.000/1.260 kg), regras da matriz e pendências de validação documental.',
    steps: [
      'Use as abas superiores para alternar entre Silos, Matérias-Primas, Big Bags, Matriz e Pendências.',
      'Supervisores e Administradores podem cadastrar novas compatibilidades ou homologar divergências com motivo auditado.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['estoque', 'materiais', 'big bag', 'compatibilidade', 'pendencias', 'catalogo'],
    addedInStage: 'Fase 1–2',
    sortOrder: 10,
  },
  {
    id: 'feat-programacao-producao',
    slug: 'como-importar-conferir-programacao',
    sectionId: 'programacao',
    moduleLabel: 'Programação',
    title: 'Como Importar, Conferir e Aprovar a Programação da Produção',
    summary: 'Captura por foto/PDF/planilha (Sensor Sistemas), conferência humana lado a lado e revisões.',
    content:
      'Importe documentos do Sensor Sistemas ou fotografias pelo tablet. O sistema destaca em amarelo/vermelho campos de baixa confiança para conferência obrigatória antes de aprovar. Novas versões da mesma data preservam o histórico anterior sem apagar o estoque real.',
    steps: [
      'Clique em Fotografar Programação ou importe arquivo PDF, JPG, PNG, XLSX ou CSV.',
      'Compare a prévia extraída com o documento original e corrija campos sinalizados.',
      'Supervisor ou Administrador aprova a programação para liberar os cálculos de consumo nas linhas L1 a L7.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['programacao', 'sensor sistemas', 'pdf', 'excel', 'revisao', 'aprovar'],
    addedInStage: 'Fase 3',
    sortOrder: 11,
  },
  {
    id: 'feat-comparador-cestas',
    slug: 'comparador-cestas-consumo',
    sectionId: 'comparador',
    moduleLabel: 'Comparador de Cestas',
    title: 'Comparador Inteligente de Cestas de Consumo (OCR + Gemini Vision)',
    summary: 'Compare versões (ex.: 07:00 × 19:00), confira tabelas extraídas por IA e publique com alerta em tempo real.',
    content:
      'Permite fotografar (com suporte a múltiplas páginas no tablet) ou enviar PDF/XLSX/CSV de duas ou mais versões de programação de consumo. O Gemini Vision (`gemini-4-hydrogen`) extrai linhas, códigos de material e quantidades, exibe tela de conferência humana obrigatória, calcula diferenças (AUMENTOU, DIMINUIU, MANTIDO, NOVO MATERIAL, RETIRADO) por linha L1–L7 e publica com alerta em tempo real via WebSocket.',
    steps: [
      'Toque em NOVA COMPARAÇÃO, informe a data de produção e os rótulos das cestas (ex.: Cesta 07:00 e Cesta 19:00).',
      'Capture fotos pelo tablet (múltiplas páginas) ou envie PDF, XLSX ou CSV e clique em Extrair com Visão IA.',
      'Revise códigos, quantidades (kg/t) e campos sinalizados na Tela de Conferência antes de comparar.',
      'Analise a matriz de diferenças e impacto nos silos; Supervisores/Admins podem clicar em PUBLICAR NOVA PROGRAMAÇÃO.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['comparador', 'cesta', 'consumo', 'visao computacional', 'gemini', 'publicar', 'websocket'],
    addedInStage: 'Comparador de Cestas + Gemini Vision',
    sortOrder: 12,
  },
  {
    id: 'feat-consumo-inteligencia',
    slug: 'confronto-consumo-estoque-alertas',
    sectionId: 'consumo',
    moduleLabel: 'Consumo & Projeção',
    title: 'Confronto de Consumo, Estoque Real e Alertas Inteligentes',
    summary: 'Separação rigorosa entre Estoque Real, Consumo Previsto, Consumo Realizado e Saldo Projetado.',
    content:
      'O Estoque Real reflete exclusivamente movimentações confirmadas no livro razão. O Consumo Previsto soma a programação validada multiplicada pelos fatores cadastrados. O Saldo Projetado considera estoque real + descargas pendentes - consumo restante, classificando alertas em Vermelho, Laranja, Azul e Verde.',
    steps: [
      'Filtre por data, linha, matéria-prima ou prioridade de alerta.',
      'Acompanhe a coluna de Saldo Projetado para identificar déficits antes da parada de linha.',
      'Aceite ou rejeite recomendações com justificativa auditável.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['consumo', 'previsto', 'realizado', 'saldo projetado', 'fator', 'deficit'],
    addedInStage: 'Fase 3',
    sortOrder: 13,
  },
  {
    id: 'feat-abastecimento-linhas',
    slug: 'como-operar-transferencias-abastecimento',
    sectionId: 'abastecimento',
    moduleLabel: 'Abastecimento',
    title: 'Painel de Abastecimento das Linhas, Rotas e Ordens Parciais',
    summary: 'Consulte cores por linha L1–L7, crie solicitações de transferência e execute etapas parciais ou finais.',
    content:
      'O Painel de Abastecimento cruza o saldo dos silos de cada linha com a demanda programada. Somente rotas com status AUTORIZADA na Matriz permitem execução; a transferência parcial movimenta o volume real em kg preservando o lote e mantendo o saldo restante para etapas seguintes.',
    steps: [
      'Verifique as linhas em Vermelho ou Laranja no Painel de Abastecimento.',
      'Clique em Criar Solicitação de Transferência quando houver rota autorizada disponível ou em Solicitar Recebimento.',
      'Execute a movimentação parcial ou final registrando início e término com rastreabilidade de lote.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['abastecimento', 'linhas', 'rotas autorizadas', 'ordem transferencia', 'parcial'],
    addedInStage: 'Fase 4',
    sortOrder: 14,
  },
  {
    id: 'feat-qualidade-lotes',
    slug: 'qualidade-amostragem-bloqueio',
    sectionId: 'qualidade',
    moduleLabel: 'Qualidade',
    title: 'Qualidade, Amostragem e Travas de Liberação de Lotes',
    summary: 'Acompanhamento de inspeções, divergências e bloqueio preventivo de materiais críticos.',
    content:
      'Controla a situação das amostras e restrições de uso dos lotes recebidos. Nenhum material bloqueado por Qualidade ou em silo interditado pode ser liberado para abastecimento das linhas sem autorização formal de usuário habilitado.',
    steps: [
      'Consulte lotes pendentes de análise ou marcados como bloqueados.',
      'Registre ocorrências vinculadas ao lote ou silo quando identificar não conformidade física ou documental.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['qualidade', 'amostra', 'bloqueio', 'lote', 'nao conformidade'],
    addedInStage: 'Fase 1–5',
    sortOrder: 15,
  },
  {
    id: 'feat-relatorios-exportacao',
    slug: 'relatorios-indicadores-exportacao',
    sectionId: 'relatorios',
    moduleLabel: 'Relatórios',
    title: 'Relatórios Operacionais, Posição Histórica e Exportação',
    summary: 'Reconstrução histórica pelo livro razão, KPIs reais e exportação em PDF, XLSX e CSV.',
    content:
      'A central de Relatórios & Indicadores consolida Recebimentos, Estoque Atual, Posição Histórica em data específica, Transferências, Consumo Programado vs. Realizado e Desempenho Operacional, permitindo exportar arquivos formatados com filtros aplicados.',
    steps: [
      'Escolha a aba do relatório e defina período, turno, linha ou matéria-prima.',
      'Em Posição Histórica, informe a data de corte para reconstruir o saldo exato de cada silo/lote.',
      'Clique em Exportar PDF, XLSX ou CSV quando precisar compartilhar ou imprimir.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['relatorios', 'exportar', 'pdf', 'xlsx', 'csv', 'posicao historica', 'kpi'],
    addedInStage: 'Fase 5',
    sortOrder: 16,
  },
  {
    id: 'feat-turnos-passagem',
    slug: 'turnos-passagem',
    sectionId: 'turnos',
    moduleLabel: 'Turnos & Passagem',
    title: 'Gestão dos Turnos (07:30/17:00/23:28) e Passagem de Serviço',
    summary: 'Horários oficiais, virada de meia-noite automática, resumo do PostgreSQL e Ciência explícita.',
    content:
      'Os 3 turnos oficiais (1º Turno 07:30–17:18, 2º Turno 17:00–02:12 e 3º Turno 23:28–07:30) mantêm a data operacional de início após 00:00. A Passagem de Turno gera resumo automático do banco, lista pendências abertas e exige Ciência explícita do turno seguinte sem encerrar pendências automaticamente.',
    steps: [
      'Revise o resumo automático de recebimentos, transferências, alertas e ocorrências do turno.',
      'Registre orientações importantes e salve como Rascunho, Revisão ou Finalizada.',
      'Ao assumir um novo turno, marque Ciência nas pendências herdadas e acompanhe até a resolução.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'SUPERVISOR', 'ADMIN'],
    keywords: ['turno', 'passagem', 'ciencia', 'pendencia', 'meia-noite', '07:30', '17:00', '23:28'],
    addedInStage: 'Fase 5',
    sortOrder: 17,
  },
  {
    id: 'feat-ocorrencias-operacionais',
    slug: 'central-ocorrencias-operacionais',
    sectionId: 'ocorrencias',
    moduleLabel: 'Ocorrências',
    title: 'Central de Ocorrências Operacionais',
    summary: 'Registro de desvios nas 12 categorias oficiais com vínculo a silo, linha, material e evidências.',
    content:
      'Permite registrar desvios como falta de matéria-prima, silo vazio, falha de equipamento, atraso de veículo ou divergência de estoque no fluxo Aberta -> Em Andamento -> Encerrada com solução aplicada auditada.',
    steps: [
      'Clique em Nova Ocorrência e escolha a categoria oficial e prioridade.',
      'Vincule o silo, material ou linha afetada e anexe evidências quando necessário.',
      'Supervisores e Administradores atualizam o andamento e encerram com descrição da solução.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['ocorrencia', 'desvio', 'falha', 'atraso', 'equipamento', 'encerrar'],
    addedInStage: 'Fase 5',
    sortOrder: 18,
  },
  {
    id: 'feat-nexo-assistente',
    slug: 'nexo-assistente-ia-consulta',
    sectionId: 'assistente',
    moduleLabel: 'NEXO Assistente',
    title: 'NEXO Assistente — Consultas Operacionais em Linguagem Natural',
    summary: 'Assistente somente leitura integrado aos dados reais autorizados do PostgreSQL.',
    content:
      'Responde perguntas em português sobre recebimentos do dia, silos críticos, última transferência, pendências do turno anterior, linhas em risco ou ocorrências abertas, informando origem dos dados e última atualização sem jamais alterar o estoque.',
    steps: [
      'Toque em uma pergunta sugerida ou digite sua dúvida operacional em linguagem natural.',
      'Confira os números retornados, o período consultado e use o atalho sugerido para ir direto à tela relacionada.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['assistente', 'ia', 'pergunta', 'consulta', 'linguagem natural'],
    addedInStage: 'Fase 5',
    sortOrder: 19,
  },
  {
    id: 'feat-executivo-apresentacao',
    slug: 'modo-apresentacao-executiva',
    sectionId: 'executivo',
    moduleLabel: 'Apresentação Executiva',
    title: 'Apresentação Executiva & Sandbox Isolado',
    summary: 'Demonstração segura com os 54 silos reais sem alterar o banco de dados oficial.',
    content:
      'Oferece dois modos de visualização: Cenário Operacional Realista (para treinamento e demonstrações com dados simulados sobre o catálogo real) e Espelho Ao Vivo PostgreSQL (somente leitura do banco oficial), com link direto compartilhável.',
    steps: [
      'Alterne entre Cenário Operacional e Espelho Ao Vivo conforme o objetivo da reunião.',
      'Teste recebimentos, etiquetas, Comparador de Cestas e mapa de silos livremente no sandbox e clique em Resetar Demo quando quiser reiniciar.',
    ],
    targetRoles: ['PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['apresentacao', 'executivo', 'demo', 'sandbox', 'link direto'],
    addedInStage: 'Apresentação Executiva',
    sortOrder: 20,
  },
  {
    id: 'feat-auditoria-imutavel',
    slug: 'auditoria-historico-imutavel',
    sectionId: 'auditoria',
    moduleLabel: 'Auditoria',
    title: 'Auditoria & Histórico Imutável de Alterações',
    summary: 'Registro permanente de edições cadastrais, estornos, ajustes, rotas e limiares.',
    content:
      'Cada alteração de capacidade, compatibilidade, regra de transferência, limiar de estoque, ajuste ou perfil de usuário grava um evento imutável com usuário, papel, valor anterior, valor novo e justificativa obrigatória.',
    steps: [
      'Filtre os eventos por ação, usuário, entidade ou palavra-chave.',
      'Inspecione a comparação entre valor anterior e novo valor para rastreabilidade completa.',
    ],
    targetRoles: ['SUPERVISOR', 'ADMIN'],
    keywords: ['auditoria', 'log', 'historico', 'imutavel', 'rastreabilidade'],
    addedInStage: 'Fase 1–5',
    sortOrder: 21,
  },
  {
    id: 'feat-admin-seguranca',
    slug: 'seguranca-auditoria-rbac',
    sectionId: 'admin',
    moduleLabel: 'Administração',
    title: 'Perfis de Acesso, Segurança RBAC e Usuários',
    summary: 'Gestão de usuários, perfis (Admin, Supervisor, Operador, Produção) e turno padrão.',
    content:
      'Todas as permissões são validadas no servidor e no banco PostgreSQL. O perfil Produção possui acesso de consulta e solicitação, sem permissão para alterar estoques, silos ou cadastros. Administradores gerenciam contas, papéis e configurações gerais.',
    steps: [
      'Localize o usuário na lista e clique em Editar Acesso.',
      'Defina o papel RBAC, status ativo/inativo e turno padrão, informando o motivo obrigatório para auditoria.',
    ],
    targetRoles: ['ADMIN'],
    keywords: ['admin', 'usuarios', 'perfis', 'rbac', 'permissoes', 'seguranca'],
    addedInStage: 'Fase 1',
    sortOrder: 22,
  },
  {
    id: 'feat-guia-escalao',
    slug: 'manual-por-escalao-permissoes',
    sectionId: 'guia',
    moduleLabel: 'Manual Ilustrado',
    title: 'Manual por Escalão e Sincronização Automática de Conteúdo',
    summary: 'Guia completo por cargo e catálogo sincronizado automaticamente a cada nova função da plataforma.',
    content:
      'Cada escalão possui fluxos dedicados: Operador executa recebimentos/etiquetas/transferências; Produção acompanha saldos e solicita materiais; Supervisão valida divergências, configura limiares e publica Cestas; Admin controla cadastros e auditoria. Toda nova função adicionada ao Registro Central do Manual gera instruções automáticas aqui e no botão COMO UTILIZAR?.',
    steps: [
      'Selecione seu escalão no topo do Manual Ilustrado para filtrar responsabilidades e checklists.',
      'Use a busca por palavra-chave para encontrar instruções de qualquer nova funcionalidade incorporada ao sistema.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['manual', 'guia', 'escalao', 'cargo', 'automatico', 'instrucoes'],
    addedInStage: 'Padronização Automática do Manual',
    sortOrder: 23,
  },
  {
    id: 'feat-identificacao-operador-terceiros',
    slug: 'identificacao-automatica-operador-terceiros',
    sectionId: 'recebimentos',
    moduleLabel: 'Identificação & Terceiros',
    title: 'Identificação Automática do Operador e Registro por Terceiros',
    summary: 'Nome, matrícula, função e setor preenchidos automaticamente pela conta autenticada, com suporte opcional a executor físico distinto.',
    content:
      'O operador não precisa redigitar nome ou matrícula em cada lançamento: o sistema vincula automaticamente sua conta autenticada. Quando a atividade física na moega ou silo for executada por outro colega e lançada por você, marque "Executado por outro operador" para registrar ambos separadamente sem substituir sua autoria.',
    steps: [
      'Confira o banner automático com seu nome e matrícula no topo da tela de Recebimento, Transferência ou Ocorrência.',
      'Se outro colega executou fisicamente a tarefa, marque a opção "Executado por outro operador" e informe nome e matrícula do executor.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['operador', 'matricula', 'terceiro', 'executor', 'autenticacao', 'funcao', 'setor'],
    addedInStage: 'Evolução Relatórios de Turno',
    sortOrder: 24,
  },
  {
    id: 'feat-relatorio-narrativo-meia-noite',
    slug: 'relatorio-narrativo-turno-meia-noite',
    sectionId: 'turnos',
    moduleLabel: 'Turnos & Passagem',
    title: 'Relatório Cronológico do Turno, Meia-Noite e Atalhos da Moega',
    summary: 'Cabeçalho automático (# SEGUNDO TURNO – DD/MM/AAAA) mantendo a data de início do turno após 00:00, acessível por 6 botões grandes na tela inicial.',
    content:
      'Todas as movimentações, descargas, transferências, ajustes, ocorrências e atualizações de cesta são vinculadas ao relatório do turno ativo. Turnos que cruzam a meia-noite (como 2º e 3º turnos) preservam a data operacional em que começaram até o encerramento.',
    steps: [
      'Na Tela Inicial da Moega, utilize o bloco "MEU RELATÓRIO DE TURNO" com 6 botões grandes: Ver Relatório, Adicionar Ocorrência, Complementar Informação, Organizar com IA, Conferir Passagem e Encerrar Turno.',
      'Confirme o cabeçalho automático gerado com a data operacional correta do turno.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'SUPERVISOR', 'ADMIN'],
    keywords: ['turno', 'meia-noite', 'data operacional', 'cabecalho', 'atalhos', 'moega'],
    addedInStage: 'Evolução Relatórios de Turno',
    sortOrder: 25,
  },
  {
    id: 'feat-contagem-rigorosa-veiculos',
    slug: 'regra-contagem-veiculos-turno',
    sectionId: 'turnos',
    moduleLabel: 'Turnos & Passagem',
    title: 'Regra de Contagem de Veículos (Turno Anterior vs Turno Atual)',
    summary: 'Veículos iniciados em turno anterior e finalizados no turno atual são narrados no relatório sem somar na cota de veículos do turno.',
    content:
      'Para evitar dupla contagem entre turnos consecutivos, somente cargas iniciadas e finalizadas dentro do mesmo turno entram na lista consolidada de "Veículos descarregados pelo turno". Descargas remanescentes de turnos anteriores aparecem no início da narrativa com destaque próprio.',
    steps: [
      'Consulte o quadro "Contagem Rigorosa de Veículos" na coluna esquerda da tela de Passagem de Turno.',
      'Verifique separadamente veículos finalizados do turno anterior e descargas parciais que seguem abertas.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'SUPERVISOR', 'ADMIN'],
    keywords: ['veiculos', 'contagem', 'turno anterior', 'carryover', 'parcial', 'descarga'],
    addedInStage: 'Evolução Relatórios de Turno',
    sortOrder: 26,
  },
  {
    id: 'feat-ia-complemento-aprovacao-versoes',
    slug: 'ia-complementos-aprovacao-correcao-versionada',
    sectionId: 'turnos',
    moduleLabel: 'Turnos & Passagem',
    title: 'Edição com IA, Complementos, Aprovação e Correção Versionada',
    summary: 'Fluxo em 5 etapas (Elaboração -> Conferência -> Aprovação -> Aprovado -> Encerrado) com edição assistida por IA e histórico imutável de versões.',
    content:
      'Permite incorporar complementos manuais (clima, manutenção, observações) e acionar atalhos de IA que organizam a redação sem alterar números, pesos ou datas. Após aprovação/encerramento, a edição direta é travada e qualquer retificação exige justificativa para gerar uma nova versão preservando as anteriores.',
    steps: [
      'Use "Complementar Informação" para registrar ocorrências climáticas, de manutenção ou observações com sua autoria.',
      'Aplique os botões do Assistente de Redação IA e revise alertas sinalizados antes de finalizar.',
      'Supervisores aprovam e travam a versão oficial; caso seja preciso ajustar depois, utilize "Registrar Correção Versionada".',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'SUPERVISOR', 'ADMIN'],
    keywords: ['ia', 'complemento', 'aprovacao', 'correcao', 'versoes', 'imutavel', 'revisao'],
    addedInStage: 'Evolução Relatórios de Turno',
    sortOrder: 27,
  },
  {
    id: 'feat-relatorios-gerenciais-turno-verificacao',
    slug: 'relatorios-gerenciais-turno-verificacao-ocorrencias',
    sectionId: 'relatorios',
    moduleLabel: 'Relatórios',
    title: 'Relatórios Gerenciais de Turno e Verificação de Ocorrências',
    summary: 'Consulta consolidada por período, turno, operador, matrícula, status e visualização integral do documento com exportação PDF.',
    content:
      'Na Central de Relatórios, a aba "Relatórios de Turno" reúne todos os turnos com contagem rigorosa de veículos, volumes recebidos e transferidos, pendências abertas e leitura completa do documento narrativo. Em Ocorrências, supervisores podem registrar a verificação formal das tratativas.',
    steps: [
      'Acesse Relatórios Operacionais e selecione a aba "Relatórios de Turno".',
      'Filtre por período, turno, operador, matrícula ou status do fluxo e clique em "Visualizar Documento" ou "Exportar PDF".',
      'Na tela de Ocorrências, supervisores clicam em "Confirmar Verificação" após conferir o desvio em campo.',
    ],
    targetRoles: ['PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['relatorios de turno', 'gerencial', 'verificacao', 'ocorrencias', 'pdf', 'matricula'],
    addedInStage: 'Evolução Relatórios de Turno',
    sortOrder: 28,
  },
  {
    id: 'feat-rubricagem-folha-unica',
    slug: 'rubricagem-diaria-moega-producao-folha-unica',
    sectionId: 'mapa',
    moduleLabel: 'Mapa de Silos',
    title: 'Rubricagem Diária em Folha Única (Moega Contínuo x Produção Físico)',
    summary: 'Captura fotográfica de uma única folha mista com separação automática entre Estoque Contínuo da Moega e Inventário Físico da Produção.',
    content:
      'A Moega tem estoque calculado continuamente por movimentações (recebimentos, transferências, saídas e ajustes); a rubricagem importada serve apenas de conferência física e nunca sobrescreve o saldo da Moega sem autorização. Já a Produção funciona por inventário físico diário (rubricagem): o sistema compara a nova leitura com a anterior, calcula a variação física em toneladas/% sem inventar consumo intermediário, e só atualiza o saldo de referência após autorização da Supervisão/Administração.',
    steps: [
      'No Mapa de Silos, clique em "Rubricagem Diária (Folha Única)" e fotografe a folha completa ou preencha as leituras.',
      'Confira a classificação automática entre silos da MOEGA (Conferência) e silos da PRODUÇÃO (Inventário Físico).',
      'Se houver divergência ou variação pendente, o sistema bloqueia sobrescrita automática, gera ocorrência auditável e aguarda autorização do Supervisor ou Administrador.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['rubricagem', 'inventario fisico', 'moega', 'producao', 'folha unica', 'divergencia', 'conferencia'],
    addedInStage: 'Correção Lógica de Estoque',
    sortOrder: 29,
  },
  {
    id: 'feat-relatorio-comparativo-rubricagem',
    slug: 'relatorio-comparativo-rubricagem-moega-producao',
    sectionId: 'relatorios',
    moduleLabel: 'Relatórios',
    title: 'Relatório Comparativo Diário de Rubricagem e Separação Moega x Produção',
    summary: 'Visão segregada entre Estoque Contínuo da Moega e Estoque Físico Diário da Produção com variação líquida e histórico preservado.',
    content:
      'Na Central de Relatórios, as abas "Estoque & Posição Histórica" e "Rubricagem Diária" exibem blocos separados para Estoque Contínuo da Moega e Estoque Físico Diário da Produção, detalhando contagem anterior, nova contagem, variação em toneladas, percentual, datas e status dos 7 estados de conferência.',
    steps: [
      'Acesse Relatórios Operacionais e selecione a aba "Rubricagem Diária" ou "Estoque & Posição Histórica".',
      'Consulte separadamente os blocos MOEGA (movimentações contínuas) e PRODUÇÃO (rubricagem física diária).',
      'Exporte o comparativo oficial em PDF, XLSX ou CSV com preservação integral das contagens anteriores.',
    ],
    targetRoles: ['OPERADOR_MOEGA', 'PRODUCAO', 'SUPERVISOR', 'ADMIN'],
    keywords: ['relatorio comparativo', 'rubricagem diaria', 'variacao', 'estoque continuo', 'estoque fisico', 'exportacao'],
    addedInStage: 'Correção Lógica de Estoque',
    sortOrder: 30,
  },
];

export function getFeatureManualsForSection(sectionId: NavSectionId): FeatureManualEntry[] {
  return AUTO_FEATURE_MANUALS.filter((entry) => entry.sectionId === sectionId);
}

export function buildAutoHelpArticles(): Array<{
  slug: string;
  module: string;
  title: string;
  summary: string;
  content: string;
  sortOrder: number;
}> {
  return AUTO_FEATURE_MANUALS.map((entry) => ({
    slug: entry.slug,
    module: entry.sectionId,
    title: entry.title,
    summary: entry.summary,
    content: `${entry.content} Passo a passo: ${entry.steps
      .map((s, idx) => `${idx + 1}) ${s}`)
      .join(' ')}`,
    sortOrder: entry.sortOrder,
  }));
}

export function buildDemoHelpArticles(): HelpArticleItem[] {
  return buildAutoHelpArticles().map((item, idx) => ({
    id: idx + 1,
    ...item,
  }));
}
