export interface ParsedBarcodeResult {
  rawBarcode: string;
  formatMatched: string;
  establishment: string | null;
  materialCode: string | null;
  lotCode: string | null;
  weightKg: number | null;
  uncertainFields: string[];
}

/**
 * Interpreta códigos de barras operacionais reais das etiquetas da planta,
 * incluindo padrão RQ-REC-044 (ex.: "22******20901210610011606870"),
 * códigos numéricos de lote (ex.: "0011647908"), códigos de material ou formatos delimitados.
 * Nunca inventa campos ausentes.
 */
export function parseOperationalBarcode(
  rawInput: string,
  knownMaterialCodes: string[] = []
): ParsedBarcodeResult {
  const raw = rawInput.trim().toUpperCase();
  const normalizedKnown = new Set(knownMaterialCodes.map((c) => c.trim().toUpperCase()));

  if (!raw) {
    return {
      rawBarcode: '',
      formatMatched: 'VAZIO',
      establishment: null,
      materialCode: null,
      lotCode: null,
      weightKg: null,
      uncertainFields: ['materialCode', 'lotCode'],
    };
  }

  // 1. Padrão Cargill RQ-REC-044: 22******20901210610011606870
  // Estabelecimento (2 dígitos) + 4-8 asteriscos/espaços/hífens + Material (10 dígitos) + Lote (8-12 dígitos)
  const cargillMaskedMatch = raw.match(/^(\d{2})[*_\-\s]{4,8}([A-Z0-9]+)$/);
  if (cargillMaskedMatch) {
    const [, establishment, tail] = cargillMaskedMatch;
    for (const knownCode of normalizedKnown) {
      if (knownCode.length >= 6 && tail.startsWith(knownCode)) {
        const lotCode = tail.slice(knownCode.length);
        return {
          rawBarcode: raw,
          formatMatched: 'CARGILL_RQ_REC_044',
          establishment,
          materialCode: knownCode,
          lotCode: lotCode || null,
          weightKg: null,
          uncertainFields: lotCode ? [] : ['lotCode'],
        };
      }
    }
    if (tail.length === 20) {
      return {
        rawBarcode: raw,
        formatMatched: 'CARGILL_RQ_REC_044',
        establishment,
        materialCode: tail.slice(0, 10),
        lotCode: tail.slice(10),
        weightKg: null,
        uncertainFields: [],
      };
    }
    const splitMatch =
      tail.match(/^([A-Z0-9]{10})(\d{8,12})$/) ||
      tail.match(/^([A-Z0-9]{8,12}?)(\d{10})$/);
    if (splitMatch) {
      return {
        rawBarcode: raw,
        formatMatched: 'CARGILL_RQ_REC_044',
        establishment,
        materialCode: splitMatch[1],
        lotCode: splitMatch[2],
        weightKg: null,
        uncertainFields: [],
      };
    }
  }

  // 2. Código numérico contínuo longo (sem asteriscos, 20-28 dígitos) contendo código de material conhecido
  if (/^\d{18,30}$/.test(raw)) {
    for (const knownCode of normalizedKnown) {
      if (knownCode.length >= 6) {
        const idx = raw.indexOf(knownCode);
        if (idx >= 0) {
          const establishment = idx >= 2 ? raw.slice(0, 2) : null;
          const after = raw.slice(idx + knownCode.length);
          const lotCode = after.length >= 6 ? after : null;
          return {
            rawBarcode: raw,
            formatMatched: 'CONTIGUOUS_KNOWN_MATERIAL',
            establishment,
            materialCode: knownCode,
            lotCode,
            weightKg: null,
            uncertainFields: lotCode ? [] : ['lotCode'],
          };
        }
      }
    }

    // Heurística padrão 2 + 6 preenchimento + 10 material + restante lote
    if (raw.length >= 26) {
      const establishment = raw.slice(0, 2);
      const materialCode = raw.slice(8, 18);
      const lotCode = raw.slice(18);
      return {
        rawBarcode: raw,
        formatMatched: 'NUMERIC_28_POSITIONAL',
        establishment,
        materialCode,
        lotCode,
        weightKg: null,
        uncertainFields: normalizedKnown.has(materialCode) ? [] : ['materialCode'],
      };
    }
  }

  // 3. Formato delimitado por | ou ; (ex: CODIGO|LOTE|PESO)
  if (raw.includes('|') || raw.includes(';')) {
    const parts = raw.split(/[|;]/).map((p) => p.trim());
    const materialCode = parts[0] || null;
    const lotCode = parts[1] || null;
    const parsedWeight = parts[2] ? Number(parts[2].replace(',', '.')) : NaN;
    return {
      rawBarcode: raw,
      formatMatched: 'DELIMITED',
      establishment: null,
      materialCode,
      lotCode,
      weightKg: Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : null,
      uncertainFields: [!materialCode ? 'materialCode' : '', !lotCode ? 'lotCode' : ''].filter(Boolean),
    };
  }

  // 4. GS1-128 com parênteses: (01)MATERIAL(10)LOTE
  const gs1Mat = raw.match(/\(01\)([A-Z0-9]+)/);
  const gs1Lot = raw.match(/\(10\)([A-Z0-9]+)/);
  if (gs1Mat || gs1Lot) {
    return {
      rawBarcode: raw,
      formatMatched: 'GS1_128',
      establishment: null,
      materialCode: gs1Mat?.[1] ?? null,
      lotCode: gs1Lot?.[1] ?? null,
      weightKg: null,
      uncertainFields: [!gs1Mat ? 'materialCode' : '', !gs1Lot ? 'lotCode' : ''].filter(Boolean),
    };
  }

  // 5. Código direto de material conhecido
  if (normalizedKnown.has(raw)) {
    return {
      rawBarcode: raw,
      formatMatched: 'DIRECT_MATERIAL_CODE',
      establishment: null,
      materialCode: raw,
      lotCode: null,
      weightKg: null,
      uncertainFields: ['lotCode'],
    };
  }

  // 6. Número de lote direto (ex.: 0011647908 ou 0011606870)
  if (/^0\d{7,11}$/.test(raw) || /^[A-Z0-9\-]{6,14}$/.test(raw)) {
    return {
      rawBarcode: raw,
      formatMatched: 'DIRECT_LOT_OR_REF',
      establishment: null,
      materialCode: null,
      lotCode: raw,
      weightKg: null,
      uncertainFields: ['materialCode'],
    };
  }

  return {
    rawBarcode: raw,
    formatMatched: 'UNRECOGNIZED',
    establishment: null,
    materialCode: null,
    lotCode: null,
    weightKg: null,
    uncertainFields: ['materialCode', 'lotCode'],
  };
}
