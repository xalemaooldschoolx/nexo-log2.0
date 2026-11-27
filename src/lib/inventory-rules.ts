export interface SiloRuleSnapshot {
  id: number;
  siloNumber: number;
  operationalStatus: string;
  primaryMaterialId: number | null;
  safeCapacityKg: number;
  nominalCapacityKg: number;
  confirmedStockKg: number;
}

export interface CompatibilityRuleSnapshot {
  siloId: number;
  materialId: number;
  allowReceiving: boolean;
  allowTransferIn: boolean;
  allowTransferOut: boolean;
}

export interface DistributionPlanItem {
  siloId: number;
  quantityKg: number;
  bagCount?: number | null;
}

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalDistributedNowKg: number;
  remainingAfterKg: number;
}

const EPSILON = 0.001;

export function calculateBigBagTotalKg(bagCount: number, unitWeightKg: number): number {
  if (!Number.isInteger(bagCount) || bagCount <= 0) {
    throw new Error('Quantidade de bags deve ser um número inteiro positivo.');
  }
  if (!Number.isFinite(unitWeightKg) || unitWeightKg <= 0) {
    throw new Error('Peso unitário do bag deve ser maior que zero.');
  }
  return Math.round(bagCount * unitWeightKg * 1000) / 1000;
}

export function isSiloCompatibleForMaterial(
  silo: SiloRuleSnapshot,
  materialId: number,
  compatibilities: CompatibilityRuleSnapshot[],
  mode: 'RECEIVING' | 'TRANSFER_IN' | 'TRANSFER_OUT'
): boolean {
  const explicit = compatibilities.find(
    (c) => c.siloId === silo.id && c.materialId === materialId
  );
  if (explicit) {
    if (mode === 'RECEIVING') return explicit.allowReceiving;
    if (mode === 'TRANSFER_IN') return explicit.allowTransferIn;
    return explicit.allowTransferOut;
  }
  // Caso não haja exceção cadastrada, respeita a MP principal homologada no silo
  return silo.primaryMaterialId === materialId;
}

export function validateReceiptDistributionPlan(params: {
  materialId: number;
  receivedQuantityKg: number;
  alreadyDistributedKg: number;
  distributions: DistributionPlanItem[];
  silosById: Map<number, SiloRuleSnapshot>;
  compatibilities: CompatibilityRuleSnapshot[];
}): ValidationOutcome {
  const {
    materialId,
    receivedQuantityKg,
    alreadyDistributedKg,
    distributions,
    silosById,
    compatibilities,
  } = params;

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(receivedQuantityKg) || receivedQuantityKg <= 0) {
    errors.push('Quantidade recebida deve ser maior que zero.');
  }

  if (distributions.length === 0) {
    const remaining = Math.max(0, receivedQuantityKg - alreadyDistributedKg);
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalDistributedNowKg: 0,
      remainingAfterKg: remaining,
    };
  }

  const seenSilos = new Map<number, number>();
  let totalNow = 0;

  for (const dist of distributions) {
    if (!Number.isFinite(dist.quantityKg) || dist.quantityKg <= 0) {
      errors.push(`Quantidade inválida informada para o silo ${dist.siloId}.`);
      continue;
    }
    totalNow += dist.quantityKg;
    seenSilos.set(dist.siloId, (seenSilos.get(dist.siloId) ?? 0) + dist.quantityKg);
  }

  const remainingBefore = Math.round((receivedQuantityKg - alreadyDistributedKg) * 1000) / 1000;
  if (totalNow > remainingBefore + EPSILON) {
    errors.push(
      `Soma distribuída (${totalNow.toLocaleString('pt-BR')} kg) excede o saldo pendente do recebimento (${remainingBefore.toLocaleString('pt-BR')} kg).`
    );
  }

  for (const [siloId, sumForSiloKg] of seenSilos.entries()) {
    const silo = silosById.get(siloId);
    if (!silo) {
      errors.push(`Silo ID ${siloId} não encontrado no cadastro.`);
      continue;
    }

    if (silo.operationalStatus !== 'OPERACIONAL') {
      errors.push(
        `Silo ${silo.siloNumber} indisponível para operação (situação: ${silo.operationalStatus}).`
      );
    }

    if (!isSiloCompatibleForMaterial(silo, materialId, compatibilities, 'RECEIVING')) {
      errors.push(
        `Material incompatível com o Silo ${silo.siloNumber} segundo a matriz administrativa de compatibilidade.`
      );
    }

    const projectedStockKg = silo.confirmedStockKg + sumForSiloKg;
    if (projectedStockKg > silo.safeCapacityKg + EPSILON) {
      const availableKg = Math.max(0, silo.safeCapacityKg - silo.confirmedStockKg);
      errors.push(
        `Capacidade segura (-10%) excedida no Silo ${silo.siloNumber}: disponível ${availableKg.toLocaleString('pt-BR')} kg, informado ${sumForSiloKg.toLocaleString('pt-BR')} kg.`
      );
    } else if (projectedStockKg >= silo.safeCapacityKg * 0.9) {
      warnings.push(
        `Silo ${silo.siloNumber} atingirá ${Math.round((projectedStockKg / silo.safeCapacityKg) * 100)}% da capacidade segura.`
      );
    }
  }

  const remainingAfterKg = Math.max(0, Math.round((remainingBefore - totalNow) * 1000) / 1000);
  if (remainingAfterKg > EPSILON) {
    warnings.push(
      `Descarga parcial: restarão ${remainingAfterKg.toLocaleString('pt-BR')} kg pendentes neste recebimento.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    totalDistributedNowKg: Math.round(totalNow * 1000) / 1000,
    remainingAfterKg,
  };
}

export type RouteAuthorizationStatus =
  | 'AUTORIZADA'
  | 'PENDENTE_VALIDACAO'
  | 'SUSPENSA'
  | 'BLOQUEADA';

export function validateTransferExecution(params: {
  originSilo: SiloRuleSnapshot;
  destinationSilo: SiloRuleSnapshot;
  materialId: number;
  quantityKg: number;
  compatibilities?: CompatibilityRuleSnapshot[];
  rule: {
    isActive: boolean;
    validationStatus: string;
    authorizationStatus?: RouteAuthorizationStatus | string;
    maxQuantityKg: number | null;
  } | null;
}): { valid: boolean; errors: string[] } {
  const { originSilo, destinationSilo, materialId, quantityKg, compatibilities, rule } = params;
  const errors: string[] = [];

  if (originSilo.id === destinationSilo.id) {
    errors.push('Silo de origem e destino não podem ser iguais.');
  }
  if (!Number.isFinite(quantityKg) || quantityKg <= 0) {
    errors.push('Quantidade da transferência deve ser maior que zero.');
  }
  if (!rule) {
    errors.push(
      `Não existe rota cadastrada na Matriz de Transferências do Silo ${originSilo.siloNumber} para o Silo ${destinationSilo.siloNumber} com esta matéria-prima.`
    );
  } else {
    const authStatus =
      rule.authorizationStatus ||
      (rule.isActive && rule.validationStatus === 'VALIDADO' ? 'AUTORIZADA' : rule.validationStatus);

    if (authStatus === 'SUSPENSA') {
      errors.push(
        `Rota Silo ${originSilo.siloNumber} → Silo ${destinationSilo.siloNumber} está SUSPENSA pela administração.`
      );
    } else if (authStatus === 'BLOQUEADA') {
      errors.push(
        `Rota Silo ${originSilo.siloNumber} → Silo ${destinationSilo.siloNumber} está BLOQUEADA para operação.`
      );
    } else if (authStatus !== 'AUTORIZADA' || !rule.isActive) {
      errors.push(
        `Rota Silo ${originSilo.siloNumber} → Silo ${destinationSilo.siloNumber} ainda está ${authStatus} / inativa e requer autorização da Supervisão.`
      );
    }

    if (rule.maxQuantityKg !== null && quantityKg > rule.maxQuantityKg + EPSILON) {
      errors.push(
        `Quantidade excede o limite configurado na regra (${rule.maxQuantityKg.toLocaleString('pt-BR')} kg).`
      );
    }
  }

  if (compatibilities && compatibilities.length > 0) {
    if (!isSiloCompatibleForMaterial(destinationSilo, materialId, compatibilities, 'TRANSFER_IN')) {
      errors.push(
        `Material incompatível com o Silo de destino ${destinationSilo.siloNumber} segundo o cadastro oficial.`
      );
    }
    if (!isSiloCompatibleForMaterial(originSilo, materialId, compatibilities, 'TRANSFER_OUT')) {
      errors.push(
        `Material ou saída não autorizada no Silo de origem ${originSilo.siloNumber} segundo o cadastro oficial.`
      );
    }
  }

  if (originSilo.operationalStatus !== 'OPERACIONAL') {
    errors.push(`Silo de origem ${originSilo.siloNumber} está ${originSilo.operationalStatus}.`);
  }
  if (destinationSilo.operationalStatus !== 'OPERACIONAL') {
    errors.push(
      `Silo de destino ${destinationSilo.siloNumber} está ${destinationSilo.operationalStatus}.`
    );
  }

  if (originSilo.confirmedStockKg + EPSILON < quantityKg) {
    errors.push(
      `Saldo insuficiente no Silo ${originSilo.siloNumber} (disponível: ${originSilo.confirmedStockKg.toLocaleString('pt-BR')} kg).`
    );
  }

  if (destinationSilo.confirmedStockKg + quantityKg > destinationSilo.safeCapacityKg + EPSILON) {
    const available = Math.max(0, destinationSilo.safeCapacityKg - destinationSilo.confirmedStockKg);
    errors.push(
      `Silo de destino ${destinationSilo.siloNumber} não comporta ${quantityKg.toLocaleString('pt-BR')} kg (espaço livre seguro: ${available.toLocaleString('pt-BR')} kg).`
    );
  }

  return { valid: errors.length === 0, errors };
}

export interface OriginLotBalance {
  lotCode: string | null;
  netKg: number;
}

export interface AllocatedLotSlice {
  lotCode: string | null;
  quantityKg: number;
}

/**
 * Preserva a rastreabilidade original dos lotes existentes no silo de origem.
 * Caso haja mistura de lotes na origem, registra a composição exata por lote.
 * Nunca altera ou inventa um lote.
 */
export function allocateLotsForTransfer(params: {
  originLots: OriginLotBalance[];
  requestedQuantityKg: number;
  preferredLotCode?: string | null;
}): { valid: boolean; slices: AllocatedLotSlice[]; summaryLotCode: string | null; error?: string } {
  const qtyNeeded = Math.round(params.requestedQuantityKg * 1000) / 1000;
  if (!Number.isFinite(qtyNeeded) || qtyNeeded <= 0) {
    return { valid: false, slices: [], summaryLotCode: null, error: 'Quantidade inválida para alocação de lote.' };
  }

  const positiveLots = params.originLots
    .filter((l) => l.netKg > EPSILON)
    .map((l) => ({ lotCode: l.lotCode ? l.lotCode.trim().toUpperCase() : null, netKg: Math.round(l.netKg * 1000) / 1000 }));

  if (positiveLots.length === 0) {
    // Movimentação sem lote associado no saldo legado, preserva null ou o lote informado se explícito
    return {
      valid: true,
      slices: [{ lotCode: params.preferredLotCode?.trim().toUpperCase() || null, quantityKg: qtyNeeded }],
      summaryLotCode: params.preferredLotCode?.trim().toUpperCase() || null,
    };
  }

  const totalPositive = positiveLots.reduce((sum, l) => sum + l.netKg, 0);
  if (totalPositive + EPSILON < qtyNeeded) {
    return {
      valid: false,
      slices: [],
      summaryLotCode: null,
      error: `Saldo por lotes insuficiente na origem (${totalPositive.toLocaleString('pt-BR')} kg disponíveis para ${qtyNeeded.toLocaleString('pt-BR')} kg solicitados).`,
    };
  }

  const preferred = params.preferredLotCode?.trim().toUpperCase() || null;
  const ordered = [...positiveLots];
  if (preferred) {
    ordered.sort((a, b) => {
      if (a.lotCode === preferred && b.lotCode !== preferred) return -1;
      if (b.lotCode === preferred && a.lotCode !== preferred) return 1;
      return 0;
    });
  }

  const slices: AllocatedLotSlice[] = [];
  let remaining = qtyNeeded;
  for (const lot of ordered) {
    if (remaining <= EPSILON) break;
    const take = Math.min(remaining, lot.netKg);
    const roundedTake = Math.round(take * 1000) / 1000;
    if (roundedTake > EPSILON) {
      slices.push({ lotCode: lot.lotCode, quantityKg: roundedTake });
      remaining = Math.max(0, Math.round((remaining - roundedTake) * 1000) / 1000);
    }
  }

  const distinctLots = Array.from(new Set(slices.map((s) => s.lotCode).filter(Boolean))) as string[];
  const summaryLotCode =
    distinctLots.length === 0
      ? null
      : distinctLots.length === 1
        ? distinctLots[0]
        : `MISTO (${distinctLots.join(' + ')})`;

  return {
    valid: true,
    slices,
    summaryLotCode,
  };
}

export function validateStockAdjustment(params: {
  currentSiloStockKg: number;
  safeCapacityKg: number;
  deltaKg: number;
  reason: string;
}): { valid: boolean; errors: string[] } {
  const { currentSiloStockKg, safeCapacityKg, deltaKg, reason } = params;
  const errors: string[] = [];

  if (!reason || reason.trim().length < 5) {
    errors.push('Justificativa operacional obrigatória (mínimo 5 caracteres).');
  }
  if (!Number.isFinite(deltaKg) || Math.abs(deltaKg) < EPSILON) {
    errors.push('Valor de ajuste deve ser diferente de zero.');
  }
  const projected = currentSiloStockKg + deltaKg;
  if (projected < -EPSILON) {
    errors.push(
      `Ajuste resultaria em saldo negativo no silo (${projected.toLocaleString('pt-BR')} kg).`
    );
  }
  if (projected > safeCapacityKg + EPSILON) {
    errors.push(
      `Ajuste excederia a capacidade segura (-10%) do silo (${safeCapacityKg.toLocaleString('pt-BR')} kg).`
    );
  }

  return { valid: errors.length === 0, errors };
}
