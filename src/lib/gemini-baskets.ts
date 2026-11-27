import { GoogleGenAI, Type } from '@google/genai';
import type {
  BasketExtractResponse,
  BasketSourceType,
  MaterialItem,
} from '../types/nexo.ts';
import {
  convertRawQuantityToKg,
  normalizeLineCode,
} from './basket-comparator.ts';
import { parseCsvToMatrix, parseXlsxBase64ToText } from './gemini-documents.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY não configurada no servidor. Configure a chave em Settings > Secrets para leitura multimodal de Cestas de Consumo.'
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

export function inferVisionMimeType(fileName: string, mimeType?: string): string {
  const cleanMime = (mimeType || '').trim().toLowerCase();
  if (
    cleanMime &&
    cleanMime !== 'application/octet-stream' &&
    (cleanMime.startsWith('image/') || cleanMime === 'application/pdf')
  ) {
    return cleanMime;
  }
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return 'image/jpeg';
}

function stripJsonMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return trimmed;
}

function mapGeminiErrorMessage(err: any): Error {
  const msg = String(err?.message || err || '');
  const status = err?.status || err?.code;
  if (status === 400 || /API_KEY_INVALID/i.test(msg)) {
    return new Error(
      'Chave Gemini inválida (400 API_KEY_INVALID). Verifique GEMINI_API_KEY em Settings > Secrets.'
    );
  }
  if (status === 403 || /PERMISSION_DENIED/i.test(msg)) {
    return new Error(
      'Permissão negada na API Gemini (403 PERMISSION_DENIED). Verifique GEMINI_API_KEY em Settings > Secrets.'
    );
  }
  if (status === 404 || /NOT_FOUND/i.test(msg)) {
    return new Error(
      'Modelo Gemini não encontrado (404 NOT_FOUND). Confirme o modelo ativo gemini-4-hydrogen.'
    );
  }
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(msg)) {
    return new Error(
      'Limite de requisições da API Gemini atingido (429 RESOURCE_EXHAUSTED). Aguarde alguns instantes e tente novamente.'
    );
  }
  return err instanceof Error ? err : new Error(msg || 'Falha na análise visual com Gemini.');
}

async function generateWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code;
      const msg = String(err?.message || '');
      const retryable =
        status === 429 ||
        status === 500 ||
        status === 503 ||
        /RESOURCE_EXHAUSTED|UNAVAILABLE|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
      if (!retryable || attempt === maxRetries) {
        throw mapGeminiErrorMessage(err);
      }
      const delayMs = 600 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw mapGeminiErrorMessage(lastError);
}

export interface BasketPageUpload {
  pageNumber: number;
  fileName: string;
  mimeType: string;
  base64Content: string;
}

export function parseBasketTabularMatrix(
  matrix: string[][],
  fileName: string,
  materials: MaterialItem[]
): BasketExtractResponse {
  if (matrix.length < 2) {
    return {
      productionDate: null,
      emissionTime: null,
      documentTitle: fileName,
      unreadableFields: ['Tabela vazia ou sem cabeçalho identificável'],
      usedAiModel: null,
      items: [],
    };
  }

  const matByCode = new Map(materials.map((m) => [m.code.trim().toUpperCase(), m]));
  const headers = matrix[0].map((h) => h.toLowerCase());
  const findCol = (kws: string[]) => headers.findIndex((h) => kws.some((kw) => h.includes(kw)));

  const colLine = findCol(['linha', 'line', 'setor']);
  const colCode = findCol(['cód', 'cod', 'material', 'mp', 'sku', 'codigo']);
  const colDesc = findCol(['desc', 'matéria', 'materia', 'ingrediente', 'nome']);
  const colQty = findCol(['qtd', 'quant', 'consumo', 'peso', 'planejad', 'kg', 'volume']);
  const colUnit = findCol(['unid', 'um', 'unit']);

  const items: BasketExtractResponse['items'] = [];
  const unreadable: string[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((c) => !c)) continue;

    const rawLine = colLine >= 0 ? row[colLine] || '' : '';
    const lineCode = rawLine ? normalizeLineCode(rawLine) : 'L1';
    const rawCode = colCode >= 0 ? (row[colCode] || '').trim().toUpperCase() : '';
    const materialCode = rawCode || null;
    const matMatch = materialCode ? matByCode.get(materialCode) : undefined;
    const rawDesc = colDesc >= 0 ? (row[colDesc] || '').trim() : '';
    const materialDescription = rawDesc || matMatch?.description || 'Não identificado';

    const rawQty = colQty >= 0 ? (row[colQty] || '').trim() : '';
    const unit =
      (colUnit >= 0 ? (row[colUnit] || '').trim().toLowerCase() : '') || 'kg';
    const plannedQuantityKg = convertRawQuantityToKg(rawQty, unit);

    const reasons: string[] = [];
    if (!rawLine) reasons.push('Linha não informada na planilha');
    if (!materialCode) reasons.push('Código do material ausente');
    if (plannedQuantityKg === null) reasons.push('Quantidade ilegível ou inválida');

    items.push({
      productionDate: '',
      lineCode,
      materialId: matMatch?.id ?? null,
      materialCode,
      materialDescription,
      rawQuantityText: rawQty || null,
      plannedQuantityKg,
      unit: unit === 't' || unit === 'ton' ? 't' : 'kg',
      sourcePage: 1,
      sourceDocumentName: fileName,
      sourceRegion: `Linha ${i + 1}`,
      confidence: reasons.length === 0 ? 'ALTA' : 'BAIXA',
      needsReview: reasons.length > 0,
      reviewReason: reasons.length > 0 ? reasons.join('; ') : null,
    });
  }

  if (items.length === 0) {
    unreadable.push('Nenhuma linha válida extraída da planilha.');
  }

  return {
    productionDate: null,
    emissionTime: null,
    documentTitle: fileName,
    unreadableFields: unreadable,
    usedAiModel: null,
    items,
  };
}

export async function extractBasketDocumentServer(params: {
  sourceType: BasketSourceType;
  pages: BasketPageUpload[];
  materials: MaterialItem[];
  expectedProductionDate?: string;
}): Promise<BasketExtractResponse> {
  if (!params.pages || params.pages.length === 0) {
    throw new Error('Envie pelo menos uma página, imagem, PDF ou planilha da Cesta de Consumo.');
  }

  const firstPage = params.pages[0];

  if (params.sourceType === 'ARQUIVO_CSV') {
    const clean = firstPage.base64Content.replace(/^data:[^;]+;base64,/, '');
    const csvText = Buffer.from(clean, 'base64').toString('utf8');
    const matrix = parseCsvToMatrix(csvText);
    const parsed = parseBasketTabularMatrix(matrix, firstPage.fileName, params.materials);
    if (params.expectedProductionDate && !parsed.productionDate) {
      parsed.productionDate = params.expectedProductionDate;
    }
    parsed.items = parsed.items.map((it) => ({
      ...it,
      productionDate: parsed.productionDate || params.expectedProductionDate || '',
    }));
    return parsed;
  }

  if (params.sourceType === 'ARQUIVO_XLSX') {
    const { matrix } = await parseXlsxBase64ToText(firstPage.base64Content);
    const parsed = parseBasketTabularMatrix(matrix, firstPage.fileName, params.materials);
    if (params.expectedProductionDate && !parsed.productionDate) {
      parsed.productionDate = params.expectedProductionDate;
    }
    parsed.items = parsed.items.map((it) => ({
      ...it,
      productionDate: parsed.productionDate || params.expectedProductionDate || '',
    }));
    return parsed;
  }

  // Visão Computacional Gemini Multimodal para fotografias do tablet, imagens e PDFs multipágina
  const ai = getGeminiClient();
  const catalogContext = params.materials
    .map((m) => `${m.code} | ${m.description}`)
    .join('\n');

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  for (const page of params.pages) {
    const cleanBase64 = page.base64Content.replace(/^data:[^;]+;base64,/, '');
    if (!cleanBase64) {
      throw new Error(`Conteúdo da página ${page.pageNumber} (${page.fileName}) está vazio.`);
    }
    const resolvedMime = inferVisionMimeType(page.fileName, page.mimeType);
    parts.push({
      text: `=== Página ${page.pageNumber} · Arquivo: ${page.fileName} · MIME: ${resolvedMime} ===`,
    });
    parts.push({
      inlineData: {
        mimeType: resolvedMime,
        data: cleanBase64,
      },
    });
  }

  const prompt = [
    'Analise com visão computacional todas as páginas anexadas desta CESTA DE CONSUMO (programação de consumo por linha de produção L1 a L7).',
    'INSTRUÇÕES DE VISÃO COMPUTACIONAL E EXTRAÇÃO TABULAR:',
    '1. Leia cada tabela alinhando estritamente linha visual por linha visual (esquerda para direita) sem deslizar quantidades para a linha de cima ou de baixo.',
    '2. Extraia cabeçalho do documento: productionDate (YYYY-MM-DD se visível), emissionTime (HH:MM se visível) e documentTitle.',
    '3. Identifique cada linha de produção (L1, L2, L3, L4, L5, L6, L7) exatamente como aparece na tabela ou bloco da página.',
    '4. PRIORIZE o código numérico/alfanumérico do material (ex.: 2017101021, 1113101920, 2019131030, 2021171023, F30BMOA80) antes da descrição.',
    '5. NUNCA troque materiais ou quantidades entre linhas nem misture códigos diferentes.',
    '6. Preserve em rawQuantityText o número exato impresso na imagem/PDF com separadores brasileiros (ex.: "62.888", "18.207,38", "9.961,27").',
    '7. Se qualquer célula (código, linha ou quantidade) estiver borrada, cortada, com reflexo ou ilegível: NÃO INVENTE. Retorne rawQuantityText="nao_identificado", confidence="BAIXA", needsReview=true, descreva o problema em reviewReason e adicione a descrição do campo em unreadableFields.',
    '8. Preencha sourcePage (número inteiro da página) e sourceRegion (ex.: "Tabela L4 · Linha 2 · Coluna Consumo") para rastreabilidade na conferência humana.',
    `Catálogo oficial de códigos e matérias-primas do NEXO LOG para validação cruzada:\n${catalogContext}`,
  ].join('\n\n');

  parts.push({ text: prompt });

  const response = await generateWithRetry(() =>
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: { parts },
      config: {
        systemInstruction:
          'Motor de visão computacional e OCR estruturado do NEXO LOG 2.0. Extraia tabelas de Cestas de Consumo (código, descrição, quantidade e linha) em JSON válido conforme o schema. Nunca invente valores ilegíveis.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            productionDate: { type: Type.STRING, nullable: true },
            emissionTime: { type: Type.STRING, nullable: true },
            documentTitle: { type: Type.STRING, nullable: true },
            unreadableFields: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  lineCode: { type: Type.STRING, nullable: true },
                  materialCode: { type: Type.STRING, nullable: true },
                  materialDescription: { type: Type.STRING },
                  rawQuantityText: { type: Type.STRING, nullable: true },
                  unit: { type: Type.STRING, nullable: true },
                  sourcePage: { type: Type.INTEGER },
                  sourceRegion: { type: Type.STRING, nullable: true },
                  confidence: { type: Type.STRING },
                  needsReview: { type: Type.BOOLEAN },
                  reviewReason: { type: Type.STRING, nullable: true },
                },
                required: ['materialDescription', 'sourcePage', 'confidence', 'needsReview'],
              },
            },
          },
          required: ['unreadableFields', 'items'],
        },
      },
    })
  );

  const rawText = stripJsonMarkdownFences(response.text ?? '{}');
  let parsed: any;
  try {
    parsed = JSON.parse(rawText || '{}');
  } catch {
    throw new Error(
      'O modelo Gemini retornou uma estrutura fora do padrão JSON esperado. Tente fotografar com melhor enquadramento ou reenviar o PDF.'
    );
  }

  const matByCode = new Map(params.materials.map((m) => [m.code.trim().toUpperCase(), m]));

  const extractedDate =
    typeof parsed.productionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.productionDate)
      ? parsed.productionDate
      : params.expectedProductionDate || null;

  const items: BasketExtractResponse['items'] = Array.isArray(parsed.items)
    ? parsed.items.map((it: any) => {
        const lineCode = normalizeLineCode(it.lineCode);
        const codeClean = it.materialCode ? String(it.materialCode).trim().toUpperCase() : null;
        const matMatch = codeClean ? matByCode.get(codeClean) : undefined;
        const rawQtyStr = it.rawQuantityText ? String(it.rawQuantityText).trim() : null;
        const unit = it.unit ? String(it.unit).trim().toLowerCase() : 'kg';
        const plannedKg = convertRawQuantityToKg(rawQtyStr, unit);
        const pageNum = typeof it.sourcePage === 'number' && it.sourcePage > 0 ? it.sourcePage : 1;
        const pageMeta = params.pages.find((p) => p.pageNumber === pageNum) || params.pages[0];

        const confRaw = String(it.confidence || 'BAIXA').toUpperCase();
        const confidence: 'ALTA' | 'MEDIA' | 'BAIXA' =
          confRaw === 'ALTA' || confRaw === 'MEDIA' ? confRaw : 'BAIXA';

        const needsReview =
          Boolean(it.needsReview) ||
          plannedKg === null ||
          !codeClean ||
          confidence === 'BAIXA';

        const reasons: string[] = [];
        if (it.reviewReason) reasons.push(String(it.reviewReason));
        if (plannedKg === null) reasons.push('Quantidade ilegível ou não identificada na foto.');
        if (!codeClean) reasons.push('Código do material não identificado.');

        return {
          productionDate: extractedDate || '',
          lineCode,
          materialId: matMatch?.id ?? null,
          materialCode: codeClean,
          materialDescription:
            String(it.materialDescription || matMatch?.description || 'Não identificado').trim(),
          rawQuantityText: rawQtyStr,
          plannedQuantityKg: plannedKg,
          unit: unit === 't' || unit === 'ton' ? 't' : 'kg',
          sourcePage: pageNum,
          sourceDocumentName: pageMeta?.fileName || null,
          sourceRegion: it.sourceRegion ? String(it.sourceRegion) : null,
          confidence,
          needsReview,
          reviewReason: reasons.length > 0 ? reasons.join(' ') : null,
        };
      })
    : [];

  return {
    productionDate: extractedDate,
    emissionTime: typeof parsed.emissionTime === 'string' ? parsed.emissionTime : null,
    documentTitle: typeof parsed.documentTitle === 'string' ? parsed.documentTitle : firstPage.fileName,
    unreadableFields: Array.isArray(parsed.unreadableFields)
      ? parsed.unreadableFields.map(String)
      : [],
    usedAiModel: 'gemini-4-hydrogen',
    items,
  };
}
