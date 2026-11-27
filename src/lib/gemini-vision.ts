import { GoogleGenAI, Type } from '@google/genai';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY não configurada no servidor. Configure o segredo GEMINI_API_KEY em Settings > Secrets para habilitar a leitura por fotografia.'
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

export interface GeminiLabelExtraction {
  materialCode: string | null;
  description: string | null;
  supplierName: string | null;
  lotCode: string | null;
  weightKg: number | null;
  bagCount: number | null;
  establishment: string | null;
  printDate: string | null;
  rawBarcodeText: string | null;
  uncertainFields: string[];
  notes: string | null;
}

/**
 * Interpreta uma etiqueta fotografada via Gemini Vision.
 * Regra estrita: nunca inventar campos ausentes; campos duvidosos devem ser listados em uncertainFields.
 * Nunca grava movimentações ou altera estoque.
 */
export async function interpretLabelImageWithGemini(params: {
  imageBase64: string;
  mimeType: string;
  catalogHint?: string;
}): Promise<GeminiLabelExtraction> {
  const ai = getGeminiClient();

  const cleanBase64 = params.imageBase64.replace(/^data:[^;]+;base64,/, '');

  const prompt = [
    'Analise a imagem desta etiqueta industrial ou ficha de recebimento de matéria-prima (ex.: etiqueta Cargill / RQ-REC-044 / Big Bag / nota de carga).',
    'Extraia SOMENTE os dados visíveis com clareza na imagem.',
    'REGRAS CRÍTICAS:',
    '1. NUNCA invente, complete ou deduza valores que não estejam claramente legíveis.',
    '2. Se um campo não existir na imagem, retorne null.',
    '3. Se algum dígito ou palavra estiver borrado, rasurado, com reflexo ou ambíguo (inclusive anotações manuscritas a caneta), adicione o nome do campo em "uncertainFields".',
    '4. Preserve zeros à esquerda em números de lote (ex.: "0011606870") e códigos de produto (ex.: "2090121061", "2017101021").',
    params.catalogHint ? `Contexto do catálogo interno:\n${params.catalogHint}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType || 'image/jpeg',
            data: cleanBase64,
          },
        },
        { text: prompt },
      ],
    },
    config: {
      systemInstruction:
        'Você é um assistente de leitura documental industrial do sistema NEXO LOG 2.0. Retorne exclusivamente JSON válido em português conforme o schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          materialCode: { type: Type.STRING, nullable: true },
          description: { type: Type.STRING, nullable: true },
          supplierName: { type: Type.STRING, nullable: true },
          lotCode: { type: Type.STRING, nullable: true },
          weightKg: { type: Type.NUMBER, nullable: true },
          bagCount: { type: Type.INTEGER, nullable: true },
          establishment: { type: Type.STRING, nullable: true },
          printDate: { type: Type.STRING, nullable: true },
          rawBarcodeText: { type: Type.STRING, nullable: true },
          uncertainFields: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          notes: { type: Type.STRING, nullable: true },
        },
        required: ['uncertainFields'],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text);

  return {
    materialCode: parsed.materialCode ?? null,
    description: parsed.description ?? null,
    supplierName: parsed.supplierName ?? null,
    lotCode: parsed.lotCode ?? null,
    weightKg: typeof parsed.weightKg === 'number' && Number.isFinite(parsed.weightKg) ? parsed.weightKg : null,
    bagCount: typeof parsed.bagCount === 'number' && Number.isInteger(parsed.bagCount) ? parsed.bagCount : null,
    establishment: parsed.establishment ?? null,
    printDate: parsed.printDate ?? null,
    rawBarcodeText: parsed.rawBarcodeText ?? null,
    uncertainFields: Array.isArray(parsed.uncertainFields) ? parsed.uncertainFields : [],
    notes: parsed.notes ?? null,
  };
}

/**
 * Gera análise operacional explicativa baseada exclusivamente nos fatos determinísticos do PostgreSQL.
 * Nunca sugere silos fora da lista autorizada e nunca altera estoque.
 */
export async function generateOperationalAdviceWithGemini(params: {
  situationTitle: string;
  deterministicFacts: Record<string, unknown>;
}): Promise<{ summary: string; alerts: string[] }> {
  const ai = getGeminiClient();

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Situação: ${params.situationTitle}\nFatos oficiais do banco PostgreSQL:\n${JSON.stringify(params.deterministicFacts, null, 2)}`,
    config: {
      systemInstruction:
        'Você é um analista operacional consultivo do NEXO LOG 2.0. Resuma os fatos exatos em português claro e objetivo para o operador de Moega, destacando apenas silos compatíveis e saldos informados no JSON. Nunca invente números ou destinos não listados.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          alerts: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ['summary', 'alerts'],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text);
  return {
    summary: String(parsed.summary || ''),
    alerts: Array.isArray(parsed.alerts) ? parsed.alerts.map(String) : [],
  };
}

export interface GeminiRubricagemExtractedRow {
  siloNumber: number;
  quantityValue: number;
  unit: 't' | 'kg';
  rawCordaMeters: number | null;
  materialHint: string | null;
  rawText: string | null;
  confidence: 'ALTA' | 'MEDIA' | 'BAIXA';
  needsReview: boolean;
  notes: string | null;
}

export interface GeminiRubricagemExtraction {
  documentDateHint: string | null;
  unreadableNotes: string[];
  entries: GeminiRubricagemExtractedRow[];
}

/**
 * Interpreta uma fotografia de folha única de rubricagem diária contendo silos da Moega e da Produção.
 * Regra estrita: nunca inventar ou completar valores ilegíveis; marcar ambiguidades com needsReview=true.
 */
export async function interpretRubricagemSheetWithGemini(params: {
  imageBase64: string;
  mimeType: string;
  silosHint?: string;
}): Promise<GeminiRubricagemExtraction> {
  const ai = getGeminiClient();
  const cleanBase64 = params.imageBase64.replace(/^data:[^;]+;base64,/, '');

  const prompt = [
    'Analise esta fotografia ou documento de FOLHA ÚNICA DE RUBRICAGEM DIÁRIA DE SILOS do sistema NEXO LOG 2.0.',
    'A folha pode misturar silos da MOEGA (Linhas e Armazenagem) e silos da PRODUÇÃO.',
    'Extraia SOMENTE as linhas claramente visíveis contendo número do silo e quantidade anotada (em toneladas "t" ou "kg"), além de corda/metros ou material se houver.',
    'REGRAS CRÍTICAS:',
    '1. NUNCA invente números para silos em branco ou rasurados.',
    '2. Preserve exatamente o número do silo (ex.: 9, 10, 11, 24, 25, 32, 33, 38, 43..64 — note que não existem silos 27 e 30).',
    '3. Identifique corretamente se o valor está em toneladas ("t", ex.: 50, 12.5, 90t) ou quilogramas ("kg", ex.: 18500, 4200 kg).',
    '4. Se algum dígito manuscrito estiver borrado, rasurado ou ambíguo, defina confidence="BAIXA" e needsReview=true.',
    params.silosHint ? `Cadastro mestre de silos para referência:\n${params.silosHint}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: params.mimeType || 'image/jpeg',
            data: cleanBase64,
          },
        },
        { text: prompt },
      ],
    },
    config: {
      systemInstruction:
        'Você é um especialista em leitura de planilhas e fichas manuscritas industriais (rubricagem de silos). Retorne exclusivamente JSON válido em português conforme o schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentDateHint: { type: Type.STRING, nullable: true },
          unreadableNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          entries: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                siloNumber: { type: Type.INTEGER },
                quantityValue: { type: Type.NUMBER },
                unit: { type: Type.STRING, enum: ['t', 'kg'] },
                rawCordaMeters: { type: Type.NUMBER, nullable: true },
                materialHint: { type: Type.STRING, nullable: true },
                rawText: { type: Type.STRING, nullable: true },
                confidence: { type: Type.STRING, enum: ['ALTA', 'MEDIA', 'BAIXA'] },
                needsReview: { type: Type.BOOLEAN },
                notes: { type: Type.STRING, nullable: true },
              },
              required: ['siloNumber', 'quantityValue', 'unit', 'confidence', 'needsReview'],
            },
          },
        },
        required: ['unreadableNotes', 'entries'],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text);
  const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];

  const entries: GeminiRubricagemExtractedRow[] = rawEntries
    .filter(
      (item: any) =>
        Number.isInteger(Number(item?.siloNumber)) &&
        Number.isFinite(Number(item?.quantityValue)) &&
        Number(item?.quantityValue) >= 0
    )
    .map((item: any) => ({
      siloNumber: Number(item.siloNumber),
      quantityValue: Number(item.quantityValue),
      unit: String(item.unit || 't').toLowerCase() === 'kg' ? 'kg' : 't',
      rawCordaMeters:
        item.rawCordaMeters !== null &&
        item.rawCordaMeters !== undefined &&
        Number.isFinite(Number(item.rawCordaMeters))
          ? Number(item.rawCordaMeters)
          : null,
      materialHint: item.materialHint ? String(item.materialHint) : null,
      rawText: item.rawText ? String(item.rawText) : null,
      confidence:
        item.confidence === 'ALTA' || item.confidence === 'BAIXA' ? item.confidence : 'MEDIA',
      needsReview: Boolean(item.needsReview),
      notes: item.notes ? String(item.notes) : null,
    }));

  return {
    documentDateHint: parsed.documentDateHint ? String(parsed.documentDateHint) : null,
    unreadableNotes: Array.isArray(parsed.unreadableNotes)
      ? parsed.unreadableNotes.map(String)
      : [],
    entries,
  };
}

