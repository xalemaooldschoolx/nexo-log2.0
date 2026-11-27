import { GoogleGenAI, Type } from '@google/genai';
import ExcelJS from 'exceljs';
import type { ConfidenceLevel } from './production-intelligence.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY não configurada no servidor. Configure o segredo GEMINI_API_KEY em Settings > Secrets para habilitar a leitura documental com Gemini.'
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

export interface ExtractedScheduleItem {
  lineCode: string | null;
  sequenceOrder: number;
  productCode: string | null;
  productDescription: string | null;
  materialCode: string | null;
  materialDescription: string | null;
  plannedQuantity: number | null;
  realizedQuantity: number | null;
  plannedUnit: string | null;
  scheduledTimeWindow: string | null;
  confidence: ConfidenceLevel;
  needsReview: boolean;
  reviewReason: string | null;
  notes: string | null;
}

export interface ScheduleDocumentExtraction {
  documentDate: string | null; // YYYY-MM-DD se explícito
  productionDate: string | null; // YYYY-MM-DD se explícito
  documentCategory: string;
  documentNotes: string | null;
  unreadableOrAmbiguousFields: string[];
  items: ExtractedScheduleItem[];
}

export function parseCsvToMatrix(csvText: string): string[][] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const sep =
    (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0)
      ? ';'
      : ',';

  return lines.map((line) =>
    line.split(sep).map((cell) => cell.trim().replace(/^"|"$/g, ''))
  );
}

export async function parseXlsxBase64ToText(base64Content: string): Promise<{
  textPreview: string;
  matrix: string[][];
}> {
  const clean = base64Content.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(clean, 'base64');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const matrix: string[][] = [];
  const textLines: string[] = [];

  workbook.eachSheet((sheet) => {
    textLines.push(`=== Aba: ${sheet.name} ===`);
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, colIdx) => {
        const val = cell.text ?? (cell.value !== null && cell.value !== undefined ? String(cell.value) : '');
        cells[colIdx - 1] = val.trim();
      });
      const normalized = cells.map((c) => c ?? '');
      if (normalized.some((c) => c.length > 0)) {
        matrix.push(normalized);
        textLines.push(normalized.join(' | '));
      }
    });
  });

  return {
    textPreview: textLines.join('\n'),
    matrix,
  };
}

/**
 * Fallback estritamente determinístico para planilhas CSV/XLSX com cabeçalhos explícitos
 * quando usado sem Gemini. Nunca inventa valores; marca revisão obrigatória.
 */
export function parseMatrixDeterministically(matrix: string[][]): ScheduleDocumentExtraction {
  if (matrix.length < 2) {
    return {
      documentDate: null,
      productionDate: null,
      documentCategory: 'PROGRAMACAO',
      documentNotes: 'Planilha sem linhas suficientes para extração automática.',
      unreadableOrAmbiguousFields: ['productionDate', 'items'],
      items: [],
    };
  }

  const headers = matrix[0].map((h) => h.toLowerCase());
  const findCol = (keywords: string[]) =>
    headers.findIndex((h) => keywords.some((kw) => h.includes(kw)));

  const colLine = findCol(['linha', 'line', 'setor']);
  const colProdCode = findCol(['cod', 'cód', 'produto', 'formula', 'fórmula', 'sku']);
  const colProdDesc = findCol(['desc', 'ração', 'racao', 'nome', 'produto']);
  const colMatCode = findCol(['mp', 'matéria', 'materia', 'ingrediente']);
  const colQty = findCol(['qtd', 'quant', 'peso', 'volume', 'ton', 'kg', 'programado']);
  const colUnit = findCol(['unid', 'um', 'unit']);
  const colWindow = findCol(['hora', 'turno', 'sequ', 'janela']);

  const items: ExtractedScheduleItem[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every((c) => !c)) continue;

    const rawLine = colLine >= 0 ? row[colLine] || '' : '';
    const lineMatch = rawLine.match(/(\d+)/);
    const lineCode = lineMatch ? `L${Number(lineMatch[1])}` : rawLine.trim().toUpperCase() || null;

    const productCode = colProdCode >= 0 ? row[colProdCode] || null : null;
    const productDescription =
      colProdDesc >= 0 ? row[colProdDesc] || productCode : productCode;
    const materialCode = colMatCode >= 0 ? row[colMatCode] || null : null;

    const rawQty = colQty >= 0 ? row[colQty] || '' : '';
    const parsedQty = Number(rawQty.replace(/\./g, '').replace(',', '.'));
    const plannedQuantity = Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : null;

    const rawUnit = colUnit >= 0 ? (row[colUnit] || '').trim().toLowerCase() : '';
    const plannedUnit =
      rawUnit === 'kg' || rawUnit === 't' || rawUnit === 'ton' || rawUnit === 'batelada'
        ? rawUnit === 'ton'
          ? 't'
          : rawUnit
        : null;

    const reviewReasons: string[] = [];
    if (!lineCode) reviewReasons.push('Linha não identificada');
    if (!productCode && !materialCode) reviewReasons.push('Código não identificado');
    if (!plannedQuantity) reviewReasons.push('Quantidade inválida ou ausente');
    if (!plannedUnit) reviewReasons.push('Unidade de medida ausente');

    items.push({
      lineCode,
      sequenceOrder: i,
      productCode,
      productDescription,
      materialCode,
      materialDescription: null,
      plannedQuantity,
      realizedQuantity: null,
      plannedUnit,
      scheduledTimeWindow: colWindow >= 0 ? row[colWindow] || null : null,
      confidence: reviewReasons.length === 0 ? 'MEDIA' : 'BAIXA',
      needsReview: true,
      reviewReason:
        reviewReasons.length > 0
          ? reviewReasons.join('; ')
          : 'Extração tabular direta — conferir antes de aprovar.',
      notes: null,
    });
  }

  return {
    documentDate: null,
    productionDate: null,
    documentCategory: 'PROGRAMACAO',
    documentNotes: 'Planilha interpretada de forma tabular. Conferir data de produção e itens.',
    unreadableOrAmbiguousFields: ['productionDate'],
    items,
  };
}

/**
 * Interpreta fotografia, PDF ou planilha de Programação da Produção / Sensor Sistemas
 * usando Gemini Vision / Multimodal (@google/genai) no servidor.
 * Regra estrita: nunca inventar quantidades, códigos, datas ou produtos.
 */
export async function interpretScheduleDocumentWithGemini(params: {
  sourceType: 'FOTO_TABLET' | 'ARQUIVO_PDF' | 'ARQUIVO_IMAGEM' | 'ARQUIVO_XLSX' | 'ARQUIVO_CSV';
  mimeType: string;
  fileBase64?: string;
  tabularText?: string;
  templatePromptHints: string;
  catalogContext: string;
}): Promise<ScheduleDocumentExtraction> {
  const ai = getGeminiClient();

  const prompt = [
    'Analise este documento operacional industrial (Programação da Produção, Relatório Impresso Sensor Sistemas, Relatório de Consumo ou Revisão de Turno).',
    `Orientações do modelo documental:\n${params.templatePromptHints}`,
    'REGRAS FUNDAMENTAIS DE INTEGRIDADE:',
    '1. NUNCA invente, complete ou chute quantidades, códigos de produto, códigos de matéria-prima, datas ou números de linha.',
    '2. Se uma data, código, unidade ou quantidade estiver ilegível, borrada, cortada ou ausente, retorne null para o campo, marque needsReview=true, confidence="BAIXA" e explique em reviewReason.',
    '3. Preserve zeros à esquerda em códigos (ex.: 2017101021, 2090121061) e padronize códigos de linha como L1, L2, L3, L4, L5, L6 ou L7 quando identificáveis.',
    '4. Converta datas encontradas para YYYY-MM-DD somente se dia/mês/ano estiverem inequívocos.',
    '5. Identifique anotações manuscritas de alteração ou revisão em documentNotes ou notes do item.',
    `Catálogo de referência do NEXO LOG:\n${params.catalogContext}`,
  ].join('\n\n');

  const parts: any[] = [];
  if (params.fileBase64 && (params.sourceType === 'FOTO_TABLET' || params.sourceType === 'ARQUIVO_IMAGEM' || params.sourceType === 'ARQUIVO_PDF')) {
    const cleanBase64 = params.fileBase64.replace(/^data:[^;]+;base64,/, '');
    parts.push({
      inlineData: {
        mimeType: params.mimeType || 'image/jpeg',
        data: cleanBase64,
      },
    });
  }

  if (params.tabularText) {
    parts.push({
      text: `Conteúdo tabular extraído do arquivo:\n${params.tabularText}`,
    });
  }

  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction:
        'Você é o motor de leitura documental do NEXO LOG 2.0. Retorne exclusivamente JSON válido em português seguindo exatamente o responseSchema. Campos não visíveis devem ser null.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentDate: { type: Type.STRING, nullable: true },
          productionDate: { type: Type.STRING, nullable: true },
          documentCategory: { type: Type.STRING },
          documentNotes: { type: Type.STRING, nullable: true },
          unreadableOrAmbiguousFields: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                lineCode: { type: Type.STRING, nullable: true },
                sequenceOrder: { type: Type.INTEGER },
                productCode: { type: Type.STRING, nullable: true },
                productDescription: { type: Type.STRING, nullable: true },
                materialCode: { type: Type.STRING, nullable: true },
                materialDescription: { type: Type.STRING, nullable: true },
                plannedQuantity: { type: Type.NUMBER, nullable: true },
                realizedQuantity: { type: Type.NUMBER, nullable: true },
                plannedUnit: { type: Type.STRING, nullable: true },
                scheduledTimeWindow: { type: Type.STRING, nullable: true },
                confidence: { type: Type.STRING },
                needsReview: { type: Type.BOOLEAN },
                reviewReason: { type: Type.STRING, nullable: true },
                notes: { type: Type.STRING, nullable: true },
              },
              required: ['sequenceOrder', 'confidence', 'needsReview'],
            },
          },
        },
        required: ['documentCategory', 'unreadableOrAmbiguousFields', 'items'],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText);

  const normalizeConfidence = (c: unknown): ConfidenceLevel => {
    const upper = String(c || '').toUpperCase();
    if (upper === 'ALTA' || upper === 'MEDIA' || upper === 'BAIXA') return upper;
    return 'BAIXA';
  };

  return {
    documentDate: parsed.documentDate ?? null,
    productionDate: parsed.productionDate ?? null,
    documentCategory: String(parsed.documentCategory || 'PROGRAMACAO'),
    documentNotes: parsed.documentNotes ?? null,
    unreadableOrAmbiguousFields: Array.isArray(parsed.unreadableOrAmbiguousFields)
      ? parsed.unreadableOrAmbiguousFields.map(String)
      : [],
    items: Array.isArray(parsed.items)
      ? parsed.items.map((it: any, idx: number) => ({
          lineCode: it.lineCode ? String(it.lineCode).trim().toUpperCase() : null,
          sequenceOrder:
            typeof it.sequenceOrder === 'number' && it.sequenceOrder > 0
              ? it.sequenceOrder
              : idx + 1,
          productCode: it.productCode ? String(it.productCode).trim() : null,
          productDescription: it.productDescription ? String(it.productDescription).trim() : null,
          materialCode: it.materialCode ? String(it.materialCode).trim() : null,
          materialDescription: it.materialDescription ? String(it.materialDescription).trim() : null,
          plannedQuantity:
            typeof it.plannedQuantity === 'number' && Number.isFinite(it.plannedQuantity)
              ? it.plannedQuantity
              : null,
          realizedQuantity:
            typeof it.realizedQuantity === 'number' && Number.isFinite(it.realizedQuantity)
              ? it.realizedQuantity
              : null,
          plannedUnit: it.plannedUnit ? String(it.plannedUnit).trim().toLowerCase() : null,
          scheduledTimeWindow: it.scheduledTimeWindow ? String(it.scheduledTimeWindow).trim() : null,
          confidence: normalizeConfidence(it.confidence),
          needsReview: Boolean(it.needsReview),
          reviewReason: it.reviewReason ? String(it.reviewReason) : null,
          notes: it.notes ? String(it.notes) : null,
        }))
      : [],
  };
}
