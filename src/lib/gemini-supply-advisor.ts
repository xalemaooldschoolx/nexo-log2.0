import { GoogleGenAI, Type } from '@google/genai';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY não configurada no servidor. Configure o segredo GEMINI_API_KEY em Settings > Secrets para habilitar a assistência consultiva.'
    );
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

export interface GeminiSupplyAdviceResult {
  explanation: string;
  scenarioComparison: string[];
  divergencesNoted: string[];
  manualGuidance: string;
  warnings: string[];
}

/**
 * Assistente consultivo da Fase 4 via Gemini (`gemini-4-hydrogen`).
 * Regra estrita: lê exclusivamente os fatos determinísticos do PostgreSQL e artigos do Manual.
 * Nunca cria regras, nunca altera saldos, nunca aprova rotas e nunca confirma transferências.
 */
export async function explainSupplyScenarioWithGemini(params: {
  question: string;
  scenarioFacts: Record<string, unknown>;
  manualArticles: Array<{ slug: string; module: string; title: string; summary: string; content: string }>;
}): Promise<GeminiSupplyAdviceResult> {
  const ai = getGeminiClient();

  const prompt = [
    `Pergunta / Solicitação do Operador ou Supervisor: ${params.question}`,
    '',
    'FATOS DETERMINÍSTICOS OFICIAIS DO POSTGRESQL (NÃO ALTERAR NEM INVENTAR):',
    JSON.stringify(params.scenarioFacts, null, 2),
    '',
    'TRECHOS DO MANUAL OPERACIONAL NEXO LOG 2.0:',
    JSON.stringify(
      params.manualArticles.map((a) => ({
        modulo: a.module,
        titulo: a.title,
        resumo: a.summary,
        conteudo: a.content,
      })),
      null,
      2
    ),
  ].join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Você é o consultor explicativo de Abastecimento e Transferências do NEXO LOG 2.0. Sua função é EXCLUSIVAMENTE explicativa e consultiva em português (pt-BR). Regras obrigatórias: (1) Baseie-se somente nos fatos determinísticos do JSON; (2) Compare apenas cenários e rotas com status AUTORIZADA vs bloqueadas explicitados nos dados; (3) Nunca invente saldos, velocidades de rosca, tempos até esvaziamento ou rotas não autorizadas; (4) Se faltarem dados ou fatores (status CINZA), informe claramente a pendência sem classificar como regular; (5) Deixe explícito que nenhuma transferência física ou alteração cadastral é executada pela IA.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          explanation: { type: Type.STRING },
          scenarioComparison: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          divergencesNoted: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          manualGuidance: { type: Type.STRING },
          warnings: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['explanation', 'scenarioComparison', 'divergencesNoted', 'manualGuidance', 'warnings'],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text);

  return {
    explanation: String(parsed.explanation || ''),
    scenarioComparison: Array.isArray(parsed.scenarioComparison)
      ? parsed.scenarioComparison.map(String)
      : [],
    divergencesNoted: Array.isArray(parsed.divergencesNoted)
      ? parsed.divergencesNoted.map(String)
      : [],
    manualGuidance: String(parsed.manualGuidance || ''),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
  };
}
