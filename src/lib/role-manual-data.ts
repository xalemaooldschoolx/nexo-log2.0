export type ManualTierId =
  | 'TODOS'
  | 'OPERADOR_MOEGA'
  | 'PRODUCAO'
  | 'PCP_PLANEJAMENTO'
  | 'SUPERVISOR'
  | 'ADMIN';

export interface RoleManualTier {
  id: Exclude<ManualTierId, 'TODOS'>;
  title: string;
  subtitle: string;
  badge: string;
  accentColor: string;
  whatYouDo: string[];
  whatIsBlocked: string[];
  dailyChecklist: string[];
  criticalAlertsRule: string;
}

export const ROLE_MANUAL_TIERS: RoleManualTier[] = [
  {
    id: 'OPERADOR_MOEGA',
    title: 'Operador da Moega',
    subtitle: 'Operação de campo no pátio, moegas, big bags, leitores e passagem de turno.',
    badge: 'Modo Operacional (Tela Simples)',
    accentColor: 'border-[#3B82F6]/45 text-[#60A5FA]',
    whatYouDo: [
      'Registrar recebimentos a Granel ou Big Bag passo a passo (6 etapas guiadas).',
      'Ler etiquetas pela câmera do tablet ou leitor USB/Bluetooth e conferir histórico do lote.',
      'Continuar descargas parciais pendentes e ratear carga em mais de um silo compatível.',
      'Executar transferências entre silos exclusivamente em rotas autorizadas (ex.: Silo 37 → Silo 10/15).',
      'Acompanhar alertas visuais de abastecimento das linhas e registrar Passagem de Turno e Ocorrências.',
      'Fotografar Cestas de Consumo no Comparador e consultar a Visão Simplificada de alterações publicadas.',
    ],
    whatIsBlocked: [
      'Não pode editar capacidade dos silos, aprovar/publicar programações ou alterar fatores de consumo.',
      'Não pode liberar material ou rota bloqueada/pendente nem executar estornos contábeis.',
      'Não visualiza cadastros administrativos ou gestão de usuários (RBAC).',
    ],
    dailyChecklist: [
      'Início do Turno: Conferir pendências deixadas pelo turno anterior e registrar Ciência quando aplicável.',
      'Durante o Turno: Ler etiqueta antes da descarga, respeitar trava de capacidade segura (-10%) e lançar descargas parciais.',
      'Ao receber alerta "NOVA CESTA DE CONSUMO PUBLICADA": Tocar em VISUALIZAR ALTERAÇÕES para checar silos afetados.',
      'Fim do Turno: Revisar resumo automático de entradas/saídas e salvar/enviar a Passagem de Turno.',
    ],
    criticalAlertsRule:
      'Silo piscando em Vermelho significa nível crítico ou bloqueio; Laranja indica estoque baixo; se houver dúvida de etiqueta ou nota fiscal, não descarregue sem chamar a Supervisão.',
  },
  {
    id: 'PRODUCAO',
    title: 'Equipe de Produção',
    subtitle: 'Consulta de saldos disponíveis por linha, solicitações e acompanhamento de abastecimento.',
    badge: 'Visão de Consulta & Solicitação',
    accentColor: 'border-orange-500/45 text-orange-300',
    whatYouDo: [
      'Consultar em tempo real o saldo confirmado e a autonomia das Linhas 01 a 07 e silos 43 a 64.',
      'Enviar Solicitação de Material para a Moega informando linha, matéria-prima, quantidade e urgência.',
      'Acompanhar o status das solicitações (Solicitado → Em análise → Em atendimento → Atendido).',
      'Receber em tempo real o aviso de Nova Cesta de Consumo Publicada e verificar alterações da sua linha.',
      'Consultar relatórios de consumo e o NEXO Assistente em modo somente leitura.',
    ],
    whatIsBlocked: [
      'Nunca altera estoque físico, não confirma recebimentos e não executa transferências de silos.',
      'Não modifica capacidades, compatibilidades ou cadastro de matérias-primas.',
      'Uma solicitação de material NÃO baixa estoque automaticamente.',
    ],
    dailyChecklist: [
      'Validar antes da virada de fórmula se os silos de linha possuem saldo suficiente para a ordem.',
      'Abrir Solicitação de Material com antecedência sempre que a cor da linha mudar para Laranja.',
      'Acompanhar o painel de Cestas Publicadas sempre que o PCP/Supervisão emitir atualização (ex.: 11:30, 15:00, 19:00).',
    ],
    criticalAlertsRule:
      'Quando a Linha aparecer em Vermelho no Abastecimento, acione imediatamente a Moega pelo módulo de Solicitação e verifique se há transferência em curso.',
  },
  {
    id: 'PCP_PLANEJAMENTO',
    title: 'Planejamento / PCP',
    subtitle: 'Programação diária, comparação entre versões de Cestas de Consumo e projeções L1–L7.',
    badge: 'Programação & Comparador de Cestas',
    accentColor: 'border-[#F5B91B]/45 text-[#F5B91B]',
    whatYouDo: [
      'Importar programações do Sensor Sistemas via foto de tela, PDF, Excel (.xlsx) ou CSV.',
      'Executar o Comparador Inteligente de Cestas de Consumo entre versões do dia (ex.: Manhã 07:00 × Atualizada 19:00).',
      'Conferir quantidades, códigos de materiais (prioridade absoluta sobre nomes) e linhas L1–L7 na Tela de Conferência antes de comparar.',
      'Analisar variações por linha, Top 10 maiores aumentos/reduções e impacto projetado nos silos da Moega.',
      'Acompanhar a tendência de 30 dias no Painel Operacional (Previsto × Realizado) para planejar compras e recebimentos.',
    ],
    whatIsBlocked: [
      'Nenhuma importação ou publicação de programação altera retroativamente o estoque físico confirmado nos silos.',
      'Sem perfil Supervisor/Admin, rascunhos precisam de aprovação/publicação oficial antes de valer para a operação.',
    ],
    dailyChecklist: [
      '07:00: Subir a Cesta da Manhã e conferir todos os códigos L1–L7.',
      'Durante o dia (11:30 / 15:00 / 19:00): Usar NOVA COMPARAÇÃO para identificar desvios sem perder o histórico.',
      'Verificar riscos CRÍTICO/ATENÇÃO gerados após aumento de consumo e alinhar recebimento ou transferência com a Moega.',
    ],
    criticalAlertsRule:
      'Nunca ignore itens destacados em amarelo ("PENDENTE_CONFERENCIA") na Tela de Conferência; a IA nunca inventa valores ilegíveis.',
  },
  {
    id: 'SUPERVISOR',
    title: 'Supervisão da Moega',
    subtitle: 'Validação operacional, aprovação/publicação oficial, ajustes auditados e análise gerencial.',
    badge: 'Modo Gerencial + Aprovações',
    accentColor: 'border-emerald-500/45 text-emerald-300',
    whatYouDo: [
      'Acessar tanto o Modo Gerencial completo quanto o Modo Operacional de campo.',
      'Revisar e aprovar Programações da Produção e clicar em PUBLICAR NOVA PROGRAMAÇÃO no Comparador de Cestas.',
      'Analisar o Painel Gerencial de Alterações (Aumentos/Reduções L1–L7, Gráfico Intra-Dia, Risco de Falta) e exportar PDF/Excel.',
      'Autorizar estornos, ajustes de saldo com justificativa obrigatória, desbloqueios de rotas e fechamento de Passagens de Turno.',
      'Resolver pendências documentais de big bags, compatibilidades e ocorrências operacionais.',
    ],
    whatIsBlocked: [
      'Não gerencia contas de usuário nem altera permissões RBAC globais (exclusivo Administrador).',
      'Toda ação crítica exige motivo escrito e gera trilha imutável em Auditoria.',
    ],
    dailyChecklist: [
      'Acompanhar o Painel Executivo e a Tendência de 30 Dias na troca de turno.',
      'Publicar novas revisões de Cesta de Consumo garantindo que a equipe receba o alerta em tempo real.',
      'Validar rotas pendentes e encerrar ocorrências abertas antes do fechamento diário.',
    ],
    criticalAlertsRule:
      'Antes de aprovar uma Cesta ou Rota, confira o saldo real nos silos compatíveis e se existe recebimento previsto capaz de cobrir o déficit.',
  },
  {
    id: 'ADMIN',
    title: 'Administrador do Sistema',
    subtitle: 'Governança RBAC, cadastro mestre dos 54 silos, matriz de compatibilidade e auditoria.',
    badge: 'Modo Administração Completo',
    accentColor: 'border-purple-400/45 text-purple-300',
    whatYouDo: [
      'Gerenciar contas individuais, perfis de acesso (Admin, Supervisor, Operador Moega, Produção), ativação/bloqueio e turnos.',
      'Configurar capacidades nominais, margem de segurança (-10%), limites mínimo/atenção e compatibilidades dos 54 silos.',
      'Homologar rotas na Matriz de Transferências e manter regras oficiais (ex.: Silo 37 → Silo 10 e Silo 15).',
      'Configurar metas de KPI, pesos de prioridade de abastecimento e horários de turno (07:30–17:18, 17:00–02:12, 23:28–07:30).',
      'Auditar logs completos em Auditoria & Histórico Imutável e monitorar conectividade PostgreSQL/IA.',
    ],
    whatIsBlocked: [
      'Mesmo como Administrador, ajustes manuais de estoque exigem justificativa auditada e não apagam movimentos anteriores.',
    ],
    dailyChecklist: [
      'Manter usuários ativos alinhados ao quadro real de cada turno.',
      'Revisar periodicamente a trilha de auditoria e pendências documentais resolvidas.',
      'Garantir que chaves de API e integrações estejam configuradas exclusivamente no servidor.',
    ],
    criticalAlertsRule:
      'Nunca cadastre ou valide os silos 27 e 30 sem documentação física oficial — a sequência oficial de rubricagem é preservada integralmente.',
  },
];

export interface PermissionMatrixRow {
  capability: string;
  operador: string;
  producao: string;
  supervisor: string;
  admin: string;
}

export const PERMISSION_MATRIX_ROWS: PermissionMatrixRow[] = [
  { capability: 'Receber Material & Descarga Parcial', operador: 'Executa', producao: 'Consulta', supervisor: 'Executa', admin: 'Executa' },
  { capability: 'Ler Etiquetas (Código de Barras / Foto IA)', operador: 'Executa', producao: '—', supervisor: 'Executa', admin: 'Executa' },
  { capability: 'Transferências em Rotas Autorizadas', operador: 'Executa', producao: 'Planeja/Consulta', supervisor: 'Executa/Autoriza', admin: 'Executa/Autoriza' },
  { capability: 'Solicitação de Material pela Linha', operador: 'Atende', producao: 'Solicita', supervisor: 'Gerencia', admin: 'Gerencia' },
  { capability: 'Comparador de Cestas (Upload & Conferência)', operador: 'Upload/Consulta', producao: 'Consulta', supervisor: 'Edita/Publica', admin: 'Edita/Publica' },
  { capability: 'Publicar Nova Programação & Alertar Turno', operador: 'Recebe Alerta', producao: 'Recebe Alerta', supervisor: 'Publica', admin: 'Publica' },
  { capability: 'Estornos, Ajustes de Saldo & Desbloqueios', operador: 'Bloqueado', producao: 'Bloqueado', supervisor: 'Autorizado (Auditado)', admin: 'Autorizado (Auditado)' },
  { capability: 'Passagem de Turno & Ciência de Pendências', operador: 'Prepara/Ciência', producao: 'Consulta', supervisor: 'Finaliza', admin: 'Finaliza/Configura' },
  { capability: 'Relatórios & Exportação PDF / XLSX / CSV', operador: 'Consulta/Exporta', producao: 'Consulta/Exporta', supervisor: 'Completo', admin: 'Completo' },
  { capability: 'Gestão de Usuários, RBAC & Auditoria', operador: 'Sem acesso', producao: 'Sem acesso', supervisor: 'Auditoria apenas', admin: 'Controle Total' },
];

export const TABLET_FIELD_TIPS: string[] = [
  'Segure o tablet na horizontal para visualizar melhor o Mapa dos 54 Silos e tabelas comparativas; na vertical, os cartões se empilham automaticamente com botões grandes (>= 44px).',
  'Ao fotografar etiquetas ou Cestas de Consumo impressas: evite reflexo da iluminação do galpão, enquadre toda a tabela e use o modo de múltiplas páginas quando o relatório tiver 2 ou mais folhas.',
  'Se a conexão Wi-Fi da Moega oscilar momentaneamente, observe o indicador Online/Offline no topo: ao restabelecer o sinal, a sincronização de alertas e notificações retoma automaticamente.',
  'Em qualquer dúvida operacional durante o serviço, toque em COMO UTILIZAR? no cabeçalho superior para abrir o guia rápido da tela onde você está.',
];
