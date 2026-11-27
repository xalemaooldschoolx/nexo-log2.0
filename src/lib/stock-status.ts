export type SiloStockAlertLevel = 'CRITICO' | 'ATENCAO' | 'NORMAL';

export interface ThresholdSpec {
  minStockKg: number;
  warningStockKg: number;
}

export interface EvaluateSiloStockParams {
  confirmedStockKg: number;
  safeCapacityKg: number;
  occupancyPercent: number;
  operationalStatus: string;
  primaryMaterialId: number | null;
  siloThreshold?: ThresholdSpec | null;
  globalThreshold?: (ThresholdSpec & { totalMaterialStockKg: number }) | null;
  activeRecommendationPriority?: 'VERMELHO' | 'LARANJA' | 'AZUL' | 'VERDE' | null;
  activeRecommendationReason?: string | null;
}

export interface SiloStockStatusEvaluation {
  stockAlertLevel: SiloStockAlertLevel;
  stockAlertReason: string | null;
  minStockKg: number | null;
  warningStockKg: number | null;
}

function fmtKg(val: number): string {
  return `${Math.round(val).toLocaleString('pt-BR')} kg`;
}

export function evaluateSiloStockStatus(
  params: EvaluateSiloStockParams
): SiloStockStatusEvaluation {
  const {
    confirmedStockKg,
    safeCapacityKg,
    occupancyPercent,
    operationalStatus,
    siloThreshold,
    globalThreshold,
    activeRecommendationPriority,
    activeRecommendationReason,
  } = params;

  const activeThreshold = siloThreshold ?? globalThreshold ?? null;
  const minStockKg = activeThreshold ? activeThreshold.minStockKg : null;
  const warningStockKg = activeThreshold ? activeThreshold.warningStockKg : null;

  let stockAlertLevel: SiloStockAlertLevel = 'NORMAL';
  let stockAlertReason: string | null = null;

  // 1. Limite específico do silo tem precedência absoluta (avalia saldo real inclusive 0 kg)
  if (siloThreshold) {
    if (confirmedStockKg <= siloThreshold.minStockKg) {
      stockAlertLevel = 'CRITICO';
      stockAlertReason = `Estoque no silo (${fmtKg(confirmedStockKg)}) abaixo ou igual ao mínimo crítico (${fmtKg(siloThreshold.minStockKg)}).`;
    } else if (confirmedStockKg <= siloThreshold.warningStockKg) {
      stockAlertLevel = 'ATENCAO';
      stockAlertReason = `Estoque no silo (${fmtKg(confirmedStockKg)}) em nível de atenção (≤ ${fmtKg(siloThreshold.warningStockKg)}).`;
    }
  } else if (globalThreshold) {
    // 2. Limite global da matéria-prima avalia o saldo consolidado da planta
    if (globalThreshold.totalMaterialStockKg <= globalThreshold.minStockKg) {
      stockAlertLevel = 'CRITICO';
      stockAlertReason = `Estoque global da MP (${fmtKg(globalThreshold.totalMaterialStockKg)}) abaixo ou igual ao mínimo crítico (${fmtKg(globalThreshold.minStockKg)}).`;
    } else if (globalThreshold.totalMaterialStockKg <= globalThreshold.warningStockKg) {
      stockAlertLevel = 'ATENCAO';
      stockAlertReason = `Estoque global da MP (${fmtKg(globalThreshold.totalMaterialStockKg)}) em nível de atenção (≤ ${fmtKg(globalThreshold.warningStockKg)}).`;
    }
  }

  // 3. Alerta ativo da programação / Painel de Abastecimento (VERMELHO / LARANJA)
  if (activeRecommendationPriority === 'VERMELHO' && stockAlertLevel !== 'CRITICO') {
    stockAlertLevel = 'CRITICO';
    stockAlertReason =
      activeRecommendationReason ||
      'Risco crítico de falta identificado na programação/abastecimento ativo.';
  } else if (activeRecommendationPriority === 'LARANJA' && stockAlertLevel === 'NORMAL') {
    stockAlertLevel = 'ATENCAO';
    stockAlertReason =
      activeRecommendationReason ||
      'Necessidade de abastecimento identificada na programação ativa.';
  }

  // 4. Fallback operacional por ocupação quando há estoque movimentado no silo (evita falso alarme em silos vazios sem demanda)
  if (
    stockAlertLevel === 'NORMAL' &&
    operationalStatus === 'OPERACIONAL' &&
    confirmedStockKg > 0 &&
    safeCapacityKg > 0
  ) {
    if (occupancyPercent <= 15) {
      stockAlertLevel = 'CRITICO';
      stockAlertReason = `Ocupação crítica de ${occupancyPercent.toFixed(1)}% (${fmtKg(confirmedStockKg)} de ${fmtKg(safeCapacityKg)}).`;
    } else if (occupancyPercent <= 30) {
      stockAlertLevel = 'ATENCAO';
      stockAlertReason = `Ocupação em atenção de ${occupancyPercent.toFixed(1)}% (${fmtKg(confirmedStockKg)} de ${fmtKg(safeCapacityKg)}).`;
    }
  }

  return {
    stockAlertLevel,
    stockAlertReason,
    minStockKg,
    warningStockKg,
  };
}

export function evaluateFeedingSiloChipStatus(params: {
  confirmedStockKg: number;
  safeCapacityKg: number;
  parentSupplyStatus: 'VERDE' | 'AMARELO' | 'LARANJA' | 'VERMELHO' | 'CINZA';
}): SiloStockAlertLevel {
  const { confirmedStockKg, safeCapacityKg, parentSupplyStatus } = params;
  const occ = safeCapacityKg > 0 ? (confirmedStockKg / safeCapacityKg) * 100 : 0;

  if (parentSupplyStatus === 'VERMELHO' && (confirmedStockKg <= 0 || occ <= 15)) {
    return 'CRITICO';
  }
  if (confirmedStockKg > 0 && safeCapacityKg > 0 && occ <= 15) {
    return 'CRITICO';
  }
  if (parentSupplyStatus === 'LARANJA' && (confirmedStockKg <= 0 || occ <= 30)) {
    return 'ATENCAO';
  }
  if (confirmedStockKg > 0 && safeCapacityKg > 0 && occ <= 30) {
    return 'ATENCAO';
  }
  return 'NORMAL';
}
