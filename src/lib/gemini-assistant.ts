import { GoogleGenAI, Type } from '@google/genai';
import type { NavSectionId, NexoAssistantResponse } from '../types/nexo.ts';

function getGeminiClientOrNull(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface AssistantAuthorizedContext {
  periodConsulted: string;
  dataOrigin: string;
  lastUpdatedIso: string;
  userRole: string;
  todayDate: string;
  receiptsSummary: {
    calcarioTodayKg: number;
    calcarioTodayCount: number;
    todayTotalKg: number;
    openOrPartialReceipts: Array<{
      receiptNumber: string;
      materialCode: string;
      materialDescription: string;
      lotCode: string;
      pendingKg: number;
      status: string;
    }>;
    silosFedToday: Array<{ siloNumber: number; materialCode: string; receivedKg: number }>;
  };
  silo38LastTransfer: {
    orderCode: string | null;
    createdAtIso: string | null;
    materialCode: string | null;
    originSiloNumber: number | null;
    destinationSiloNumber: number | null;
    transferredKg: number | null;
    status: string | null;
    operatorName: string | null;
  } | null;
  criticalMaterials: Array<{
    materialCode: string;
    description: string;
    realStockKg: number;
    minStockKg: number | null;
    warningStockKg: number | null;
  }>;
  priorShiftPendencies: Array<{
    pendencyCode: string;
    shiftCode: string;
    operationalDate: string;
    title: string;
    status: string;
    priority: string;
  }>;
  linesAtRisk: Array<{
    lineCode: string;
    materialCode: string;
    supplyStatus: string;
    deficitKg: number;
    statusReason: string;
  }>;
  openOccurrences: Array<{
    occurrenceCode: string;
    category: string;
    title: string;
    status: string;
    siloNumber: number | null;
    lineCode: string | null;
  }>;
  scheduleChanges: {
    latestScheduleCode: string | null;
    revisionNumber: number | null;
    referenceDate: string | null;
    revisionDiffSummary: string | null;
  } | null;
  missingDataNotes: string[];
}

/**
 * Resposta determinística estritamente baseada no PostgreSQL para fallback ou validação unitária.
 */
export function buildDeterministicAssistantAnswer(
  question: string,
  ctx: AssistantAuthorizedContext
): NexoAssistantResponse {
  const q = question.toLowerCase();
  const missing = [...ctx.missingDataNotes];
  let answer = '';
  let suggestedNavigation: NavSectionId | null = 'relatorios';

  if (q.includes('calcario') || q.includes('calcário')) {
    answer =
      ctx.receiptsSummary.calcarioTodayCount > 0
        ? `No período consultado (${ctx.periodConsulted}), foram registrados ${ctx.receiptsSummary.calcarioTodayCount} recebimento(s) de Calcário, totalizando ${Math.round(ctx.receiptsSummary.calcarioTodayKg).toLocaleString('pt-BR')} kg.`
        : `Não há recebimentos de Calcário registrados para ${ctx.periodConsulted}.`;
    suggestedNavigation = 'recebimentos';
  } else if (q.includes('silo 38') || q.includes('38')) {
    if (ctx.silo38LastTransfer) {
      answer = `Última movimentação/transferência registrada envolvendo o Silo 38: ${ctx.silo38LastTransfer.orderCode || 'Movimento direto'} (${ctx.silo38LastTransfer.materialCode || 'Material n/i'}), origem Silo ${ctx.silo38LastTransfer.originSiloNumber ?? 'n/i'} -> destino Silo ${ctx.silo38LastTransfer.destinationSiloNumber ?? 'n/i'}, volume ${ctx.silo38LastTransfer.transferredKg !== null ? `${Math.round(ctx.silo38LastTransfer.transferredKg).toLocaleString('pt-BR')} kg` : 'Dado não informado'}, status ${ctx.silo38LastTransfer.status || 'n/i'}.`;
    } else {
      answer = 'Nenhuma transferência envolvendo o Silo 38 foi encontrada nos registros atuais.';
    }
    suggestedNavigation = 'transferencias';
  } else if (q.includes('silo') && (q.includes('abastecido') || q.includes('alimentado'))) {
    answer =
      ctx.receiptsSummary.silosFedToday.length > 0
        ? `Silos abastecidos em ${ctx.periodConsulted}: ${ctx.receiptsSummary.silosFedToday.map((s) => `Silo ${s.siloNumber} (${s.materialCode}: ${Math.round(s.receivedKg).toLocaleString('pt-BR')} kg)`).join('; ')}.`
        : `Nenhum silo recebeu descarga confirmada em ${ctx.periodConsulted}.`;
    suggestedNavigation = 'mapa';
  } else if (q.includes('crític') || q.includes('critic')) {
    answer =
      ctx.criticalMaterials.length > 0
        ? `Matérias-primas críticas ou abaixo do limite: ${ctx.criticalMaterials.map((m) => `${m.materialCode} ${m.description} (Saldo real: ${Math.round(m.realStockKg).toLocaleString('pt-BR')} kg${m.minStockKg !== null ? `, Mín.: ${Math.round(m.minStockKg).toLocaleString('pt-BR')} kg` : ''})`).join('; ')}.`
        : 'Nenhuma matéria-prima crítica ou abaixo do estoque mínimo cadastrado foi identificada no momento.';
    suggestedNavigation = 'consumo';
  } else if (q.includes('pendência') || q.includes('pendencia') || q.includes('turno')) {
    answer =
      ctx.priorShiftPendencies.length > 0
        ? `Pendências de passagem de turno registradas: ${ctx.priorShiftPendencies.map((p) => `[${p.pendencyCode}] ${p.title} (${p.operationalDate} · ${p.shiftCode} · Status: ${p.status})`).join('; ')}.`
        : 'Não há pendências de passagem de turno abertas ou aguardando resolução no momento.';
    suggestedNavigation = 'turnos';
  } else if (q.includes('risco') || q.includes('linha')) {
    answer =
      ctx.linesAtRisk.length > 0
        ? `Linhas com alerta de abastecimento (Vermelho/Laranja/Amarelo): ${ctx.linesAtRisk.map((l) => `${l.lineCode} (${l.materialCode} · ${l.supplyStatus} · Déficit: ${Math.round(l.deficitKg).toLocaleString('pt-BR')} kg)`).join('; ')}.`
        : 'Nenhuma linha encontra-se em risco crítico de abastecimento conforme as programações aprovadas.';
    suggestedNavigation = 'abastecimento';
  } else if (q.includes('recebiment') && (q.includes('aberto') || q.includes('pendent') || q.includes('parci'))) {
    answer =
      ctx.receiptsSummary.openOrPartialReceipts.length > 0
        ? `Recebimentos em aberto/parciais: ${ctx.receiptsSummary.openOrPartialReceipts.map((r) => `${r.receiptNumber} (${r.materialCode} Lote ${r.lotCode}, Pendente ${Math.round(r.pendingKg).toLocaleString('pt-BR')} kg, Status ${r.status})`).join('; ')}.`
        : 'Não existem recebimentos pendentes ou parciais em aberto no momento.';
    suggestedNavigation = 'distribuicao';
  } else if (q.includes('ocorrênc') || q.includes('ocorrenc')) {
    answer =
      ctx.openOccurrences.length > 0
        ? `Ocorrências em aberto/em andamento (${ctx.openOccurrences.length}): ${ctx.openOccurrences.map((o) => `${o.occurrenceCode} [${o.category}] ${o.title} (${o.status})`).join('; ')}.`
        : 'Nenhuma ocorrência operacional aberta ou em andamento no momento.';
    suggestedNavigation = 'ocorrencias';
  } else if (q.includes('programa') || q.includes('altera') || q.includes('revis')) {
    answer = ctx.scheduleChanges?.latestScheduleCode
      ? `Última programação registrada: ${ctx.scheduleChanges.latestScheduleCode} (Rev. ${ctx.scheduleChanges.revisionNumber}, Ref. ${ctx.scheduleChanges.referenceDate}). ${ctx.scheduleChanges.revisionDiffSummary || 'Sem alterações de revisão registradas frente à versão anterior.'}`
      : 'Nenhuma programação de produção foi importada até o momento.';
    suggestedNavigation = 'programacao';
  } else {
    answer = [
      `Resumo operacional para ${ctx.periodConsulted}:`,
      `• Recebimentos hoje: ${Math.round(ctx.receiptsSummary.todayTotalKg).toLocaleString('pt-BR')} kg (${ctx.receiptsSummary.openOrPartialReceipts.length} descarga(s) pendente(s)/parcial(is)).`,
      `• Materiais críticos/abaixo do mínimo: ${ctx.criticalMaterials.length}.`,
      `• Pendências de turno abertas: ${ctx.priorShiftPendencies.length}.`,
      `• Linhas em atenção/risco: ${ctx.linesAtRisk.length}.`,
      `• Ocorrências abertas: ${ctx.openOccurrences.length}.`,
    ].join('\n');
  }

  return {
    answer,
    periodConsulted: ctx.periodConsulted,
    dataOrigin: ctx.dataOrigin,
    lastUpdatedIso: ctx.lastUpdatedIso,
    missingDataNotes: missing,
    suggestedNavigation,
    usedAiModel: null,
  };
}

/**
 * NEXO ASSISTENTE (Somente Leitura) utilizando @google/genai (`gemini-4-hydrogen`).
 * Consulta exclusivamente dados autorizados do perfil e nunca altera banco nem inventa informações.
 */
export async function askNexoAssistantWithGemini(params: {
  question: string;
  contextData: AssistantAuthorizedContext;
  manualArticles: Array<{ module: string; title: string; summary: string }>;
}): Promise<NexoAssistantResponse> {
  const ai = getGeminiClientOrNull();
  if (!ai) {
    return buildDeterministicAssistantAnswer(params.question, params.contextData);
  }

  try {
    const prompt = [
      `Pergunta do usuário (${params.contextData.userRole}): ${params.question}`,
      '',
      'DADOS OFICIAIS AUTORIZADOS DO POSTGRESQL (FONTE ÚNICA DE VERDADE):',
      JSON.stringify(params.contextData, null, 2),
      '',
      'MÓDULOS DO MANUAL NEXO LOG:',
      JSON.stringify(params.manualArticles.slice(0, 12), null, 2),
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'Você é o NEXO ASSISTENTE do NEXO LOG 2.0 em português (pt-BR). Regras invioláveis: (1) Responda SOMENTE com base nos dados oficiais fornecidos no JSON; (2) Modo estritamente SOMENTE LEITURA: nunca sugira que alterou dados; (3) Nunca invente quantidades, datas, lotes, silos, pessoas ou fatos; (4) Se algum dado não existir ou estiver pendente no JSON, informe explicitamente em missingDataNotes e na resposta ("Dado não informado"); (5) Sempre retorne período consultado, origem dos dados e última atualização exatamente conforme o contexto.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING },
            missingDataNotes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            suggestedNavigation: { type: Type.STRING },
          },
          required: ['answer', 'missingDataNotes'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const validNavs = new Set<string>([
      'painel',
      'mapa',
      'estoque',
      'recebimentos',
      'etiquetas',
      'distribuicao',
      'transferencias',
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
    ]);
    const nav =
      parsed.suggestedNavigation && validNavs.has(String(parsed.suggestedNavigation))
        ? (String(parsed.suggestedNavigation) as NavSectionId)
        : null;

    return {
      answer: String(parsed.answer || 'Dado não informado.'),
      periodConsulted: params.contextData.periodConsulted,
      dataOrigin: params.contextData.dataOrigin,
      lastUpdatedIso: params.contextData.lastUpdatedIso,
      missingDataNotes: Array.from(
        new Set([
          ...params.contextData.missingDataNotes,
          ...(Array.isArray(parsed.missingDataNotes) ? parsed.missingDataNotes.map(String) : []),
        ])
      ),
      suggestedNavigation: nav,
      usedAiModel: 'gemini-4-hydrogen',
    };
  } catch (err) {
    console.warn('Fallback determinístico do NEXO ASSISTENTE devido a erro Gemini:', err);
    return buildDeterministicAssistantAnswer(params.question, params.contextData);
  }
}

/**
 * Assistente de Redação e Edição Assistida do Relatório de Turno via Gemini (`gemini-4-hydrogen`),
 * preservando rigorosamente cabeçalho, negrito nos materiais, números, horários, silos, operadores e bloco final de veículos.
 * Nunca altera registros oficiais do banco nem inventa informações ausentes.
 */
export function deterministicPolishShiftReportText(params: {
  baseReportText: string;
  rawFacts: Record<string, unknown>;
  userCommand?: string | null;
}): {
  refinedText: string;
  warnings: string[];
} {
  let text = String(params.baseReportText || '').replace(/\r\n/g, '\n').trim();
  // Normaliza espaçamentos excessivos mantendo estrutura Markdown
  text = text.replace(/\n{3,}/g, '\n\n');
  // Garante pontuação final em parágrafos corridos que terminem com letra/número sem pontuação
  const lines = text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('-') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('•')
    ) {
      return line;
    }
    if (/[A-Za-zÀ-ÿ0-9)]$/.test(trimmed)) {
      return `${trimmed}.`;
    }
    return line;
  });
  text = lines.join('\n');

  const warnings: string[] = [];
  const cmd = String(params.userCommand || '').trim();
  const cmdLower = cmd.toLowerCase();

  if (cmd) {
    // Se o comando trouxe informação nova explícita de complemento ou observação
    if (
      (cmdLower.includes('acrescentar') ||
        cmdLower.includes('incluir') ||
        cmdLower.includes('adicionar') ||
        cmdLower.includes('chuva') ||
        cmdLower.includes('parada') ||
        cmdLower.includes('manutenção') ||
        cmdLower.includes('manutencao')) &&
      !text.toLowerCase().includes(cmd.toLowerCase())
    ) {
      const marker = '**Veículos descarregados pelo';
      const noteLine = `Observação complementar incorporada na revisão do turno: ${cmd.replace(/\.$/, '')}.`;
      const idx = text.indexOf(marker);
      if (idx > 0) {
        text = `${text.slice(0, idx).trim()}\n\n${noteLine}\n\n${text.slice(idx)}`;
      } else {
        text = `${text}\n\n${noteLine}`;
      }
    }
  }

  // Checagem de lacunas para orientar o operador antes do encerramento
  const raw = params.rawFacts as any;
  if (raw && typeof raw === 'object') {
    if (!raw.receivedByName) {
      warnings.push('Responsável pelo recebimento do próximo turno ainda não foi informado.');
    }
    if (Array.isArray(raw.pendingVehicles) && raw.pendingVehicles.length > 0) {
      warnings.push(`${raw.pendingVehicles.length} veículo(s) com descarga parcial/pendente requerem continuidade no próximo turno.`);
    }
    if (Number(raw.openOccurrencesCount || 0) > 0) {
      warnings.push(`Existem ${raw.openOccurrencesCount} ocorrência(s) em aberto vinculadas ao ambiente operacional.`);
    }
  }

  return { refinedText: text, warnings };
}

export async function refineShiftReportWithGemini(params: {
  baseReportText: string;
  rawFacts: Record<string, unknown>;
  userCommand?: string | null;
}): Promise<{ refinedText: string; usedAiModel: string | null; warnings: string[] }> {
  const deterministic = deterministicPolishShiftReportText(params);
  const ai = getGeminiClientOrNull();
  if (!ai) {
    return { refinedText: deterministic.refinedText, usedAiModel: null, warnings: deterministic.warnings };
  }

  try {
    const commandInstruction = params.userCommand?.trim()
      ? `INSTRUÇÃO ESPECÍFICA DO USUÁRIO PARA ESTA EDIÇÃO:\n"${params.userCommand.trim()}"`
      : 'INSTRUÇÃO PADRÃO: Organizar em ordem cronológica fluida, revisar português formal da Moega e preparar para passagem de turno.';

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        commandInstruction,
        '',
        'TEXTO ATUAL DO RELATÓRIO DE TURNO:',
        params.baseReportText,
        '',
        'FATOS OFICIAIS DO POSTGRESQL (FONTE INALTERÁVEL):',
        JSON.stringify(params.rawFacts, null, 2),
      ].join('\n'),
      config: {
        systemInstruction:
          'Você é o editor técnico oficial dos Relatórios de Turno da Moega no NEXO LOG 2.0 em português (pt-BR). REGRAS INVIOLÁVEIS: (1) Mantenha exatamente o cabeçalho Markdown "# PRIMEIRO/SEGUNDO/TERCEIRO TURNO – DD/MM/AAAA"; (2) Mantenha prosa cronológica natural, clara e fluida (sem listas numéricas artificiais), usando Title Case com negrito (**Calcário**, **Farelo de Glúten de Milho 21%**) nos nomes de matérias-primas; (3) Preserve exatamente o bloco final "**Veículos descarregados pelo ... turno:**", a lista "- Nx **Material**", "**Total: X veículos descarregados.**" e "Turno encerrado. Qualquer dúvida, estamos à disposição."; (4) NUNCA altere quantidades, pesos, horários, matrículas, operadores, placas, silos ou contagem de veículos, e JAMAIS invente dados inexistentes — aponte lacunas no array `warnings`; (5) Retorne JSON válido conforme o schema.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            refinedText: { type: Type.STRING },
            warnings: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: ['refinedText', 'warnings'],
        },
      },
    });
    const parsed = JSON.parse((response.text ?? '{}').trim());
    const refined = String(parsed.refinedText || '').trim();
    const aiWarnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String).filter(Boolean) : [];
    return {
      refinedText: refined || deterministic.refinedText,
      usedAiModel: 'gemini-4-hydrogen',
      warnings: Array.from(new Set([...deterministic.warnings, ...aiWarnings])),
    };
  } catch {
    return { refinedText: deterministic.refinedText, usedAiModel: null, warnings: deterministic.warnings };
  }
}
