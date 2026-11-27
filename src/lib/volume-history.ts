import type {
  MaterialThresholdAlertItem,
  SiloDetail,
  SiloVolumeHistory24hPoint,
  SiloVolumeHistory24hResponse,
  StockThresholdItem,
} from '../types/nexo.ts';

export interface VolumeMovementSnapshot {
  siloId: number;
  materialId: number;
  quantityKg: number;
  direction: 'CREDIT' | 'DEBIT' | string;
  status: string;
  createdAt: string;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

function formatHourLabel(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  return `${hh}:00`;
}

/**
 * Reconstrói de forma determinística o histórico horário de volume das últimas 24 horas
 * a partir do estoque confirmado atual e das movimentações registradas no livro razão.
 */
export function buildSiloVolumeHistory24h(params: {
  silos: Array<{
    id: number;
    siloNumber: number;
    category: string;
    primaryMaterialId: number | null;
    confirmedStockKg: number;
  }>;
  movements: VolumeMovementSnapshot[];
  siloId?: number | null;
  materialId?: number | null;
  category?: string;
  dataOrigin: string;
  anchorNow?: Date;
}): SiloVolumeHistory24hResponse {
  const siloFilter = params.siloId ?? null;
  const materialFilter = params.materialId ?? null;
  const categoryFilter = params.category && params.category !== 'ALL' ? params.category : 'ALL';

  const matchingSilos = params.silos.filter((s) => {
    if (siloFilter && s.id !== siloFilter) return false;
    if (materialFilter && s.primaryMaterialId !== materialFilter) return false;
    if (categoryFilter !== 'ALL' && s.category !== categoryFilter) return false;
    return true;
  });

  const matchingSiloIds = new Set(matchingSilos.map((s) => s.id));
  const currentVolumeKg = round2(
    matchingSilos.reduce((acc, s) => acc + Number(s.confirmedStockKg || 0), 0)
  );

  const anchorDate = params.anchorNow ? new Date(params.anchorNow.getTime()) : new Date();
  const anchorHourStart = new Date(anchorDate.getTime());
  anchorHourStart.setMinutes(0, 0, 0);

  const bucketStarts: Date[] = [];
  for (let offset = 23; offset >= 0; offset -= 1) {
    const dt = new Date(anchorHourStart.getTime() - offset * 3600 * 1000);
    bucketStarts.push(dt);
  }

  const windowStartMs = bucketStarts[0].getTime();
  const windowEndMs = anchorHourStart.getTime() + 3600 * 1000 - 1;

  const bucketInbound = new Array<number>(24).fill(0);
  const bucketOutbound = new Array<number>(24).fill(0);
  const bucketMovCount = new Array<number>(24).fill(0);

  for (const m of params.movements) {
    if (m.status !== 'CONFIRMADO') continue;
    if (!matchingSiloIds.has(m.siloId)) continue;
    if (materialFilter && m.materialId !== materialFilter) continue;

    const ts = new Date(m.createdAt).getTime();
    if (!Number.isFinite(ts) || ts < windowStartMs || ts > windowEndMs) continue;

    const idx = Math.min(23, Math.max(0, Math.floor((ts - windowStartMs) / (3600 * 1000))));
    const qty = Number(m.quantityKg || 0);
    if (m.direction === 'CREDIT') {
      bucketInbound[idx] += qty;
    } else if (m.direction === 'DEBIT') {
      bucketOutbound[idx] += qty;
    }
    bucketMovCount[idx] += 1;
  }

  // Reconstrução reversa exata a partir do saldo atual confirmado:
  // volume(t-1) = volume(t) - inbound(t) + outbound(t)
  const volumeByHourKg = new Array<number>(24).fill(0);
  let runningVolume = currentVolumeKg;
  for (let idx = 23; idx >= 0; idx -= 1) {
    volumeByHourKg[idx] = Math.max(0, round2(runningVolume));
    runningVolume = runningVolume - bucketInbound[idx] + bucketOutbound[idx];
  }

  let inbound24hKg = 0;
  let outbound24hKg = 0;
  let totalMovements24h = 0;
  let peakVolumeActivity = 0;
  let peakMovementHourLabel: string | null = null;

  const series: SiloVolumeHistory24hPoint[] = bucketStarts.map((dt, idx) => {
    const inKg = round2(bucketInbound[idx]);
    const outKg = round2(bucketOutbound[idx]);
    const volKg = volumeByHourKg[idx];
    const hourLabel = formatHourLabel(dt);

    inbound24hKg += inKg;
    outbound24hKg += outKg;
    totalMovements24h += bucketMovCount[idx];

    const activity = inKg + outKg;
    if (activity > peakVolumeActivity) {
      peakVolumeActivity = activity;
      peakMovementHourLabel = hourLabel;
    }

    return {
      hourIso: dt.toISOString(),
      hourLabel,
      volumeKg: volKg,
      volumeTons: round3(volKg / 1000),
      inboundKg: inKg,
      outboundKg: outKg,
      inboundTons: round3(inKg / 1000),
      outboundTons: round3(outKg / 1000),
      netDeltaKg: round2(inKg - outKg),
      movementCount: bucketMovCount[idx],
    };
  });

  return {
    generatedAtIso: new Date().toISOString(),
    windowHours: 24,
    siloId: siloFilter,
    materialId: materialFilter,
    category: categoryFilter,
    dataOrigin: params.dataOrigin,
    totals: {
      currentVolumeKg,
      currentVolumeTons: round3(currentVolumeKg / 1000),
      inbound24hKg: round2(inbound24hKg),
      outbound24hKg: round2(outbound24hKg),
      netChange24hKg: round2(inbound24hKg - outbound24hKg),
      totalMovements24h,
      peakMovementHourLabel,
      silosIncludedCount: matchingSilos.length,
    },
    series,
  };
}

/**
 * Avalia todos os limiares configurados (globais por material ou específicos por silo)
 * e retorna notificações proativas ordenadas por criticidade.
 */
export function computeProactiveMaterialThresholdAlerts(params: {
  silos: SiloDetail[];
  thresholds: StockThresholdItem[];
}): MaterialThresholdAlertItem[] {
  const alerts: MaterialThresholdAlertItem[] = [];

  for (const th of params.thresholds) {
    if (th.siloId || th.siloNumber) {
      const targetSilo = params.silos.find(
        (s) => s.id === th.siloId || (th.siloNumber != null && s.siloNumber === th.siloNumber)
      );
      if (!targetSilo) continue;
      const stockKg = round2(targetSilo.confirmedStockKg);
      let severity: 'CRITICO' | 'ATENCAO' | 'NORMAL' = 'NORMAL';
      if (stockKg <= th.minStockKg) severity = 'CRITICO';
      else if (stockKg <= th.warningStockKg) severity = 'ATENCAO';

      const message =
        severity === 'CRITICO'
          ? `CRÍTICO: Silo ${targetSilo.siloNumber} (${th.materialDescription}) com ${Math.round(stockKg).toLocaleString('pt-BR')} kg — abaixo do mínimo (${Math.round(th.minStockKg).toLocaleString('pt-BR')} kg).`
          : severity === 'ATENCAO'
            ? `ESTOQUE BAIXO: Silo ${targetSilo.siloNumber} (${th.materialDescription}) com ${Math.round(stockKg).toLocaleString('pt-BR')} kg — abaixo do limiar de atenção (${Math.round(th.warningStockKg).toLocaleString('pt-BR')} kg).`
            : `Regular: Silo ${targetSilo.siloNumber} acima dos limiares configurados.`;

      alerts.push({
        thresholdId: th.id,
        materialId: th.materialId,
        materialCode: th.materialCode,
        materialDescription: th.materialDescription,
        scope: 'SILO',
        siloId: targetSilo.id,
        siloNumber: targetSilo.siloNumber,
        currentStockKg: stockKg,
        minStockKg: th.minStockKg,
        warningStockKg: th.warningStockKg,
        severity,
        affectedSiloNumbers: [targetSilo.siloNumber],
        message,
      });
    } else {
      const matchingSilos = params.silos.filter((s) => s.primaryMaterialId === th.materialId);
      const totalStockKg = round2(
        matchingSilos.reduce((acc, s) => acc + Number(s.confirmedStockKg || 0), 0)
      );
      let severity: 'CRITICO' | 'ATENCAO' | 'NORMAL' = 'NORMAL';
      if (totalStockKg <= th.minStockKg) severity = 'CRITICO';
      else if (totalStockKg <= th.warningStockKg) severity = 'ATENCAO';

      const siloListText =
        matchingSilos.length > 0
          ? matchingSilos.map((s) => `S${s.siloNumber}`).join(', ')
          : 'sem silos vinculados';

      const message =
        severity === 'CRITICO'
          ? `CRÍTICO POR MATERIAL: ${th.materialDescription} (${th.materialCode}) com ${Math.round(totalStockKg).toLocaleString('pt-BR')} kg consolidados (${siloListText}) — abaixo do mínimo (${Math.round(th.minStockKg).toLocaleString('pt-BR')} kg).`
          : severity === 'ATENCAO'
            ? `ESTOQUE BAIXO POR MATERIAL: ${th.materialDescription} (${th.materialCode}) com ${Math.round(totalStockKg).toLocaleString('pt-BR')} kg consolidados (${siloListText}) — abaixo do limiar (${Math.round(th.warningStockKg).toLocaleString('pt-BR')} kg).`
            : `Regular: ${th.materialDescription} com ${Math.round(totalStockKg).toLocaleString('pt-BR')} kg consolidados.`;

      alerts.push({
        thresholdId: th.id,
        materialId: th.materialId,
        materialCode: th.materialCode,
        materialDescription: th.materialDescription,
        scope: 'MATERIAL',
        siloId: null,
        siloNumber: null,
        currentStockKg: totalStockKg,
        minStockKg: th.minStockKg,
        warningStockKg: th.warningStockKg,
        severity,
        affectedSiloNumbers: matchingSilos.map((s) => s.siloNumber),
        message,
      });
    }
  }

  const rank: Record<'CRITICO' | 'ATENCAO' | 'NORMAL', number> = {
    CRITICO: 3,
    ATENCAO: 2,
    NORMAL: 1,
  };
  return alerts.sort((a, b) => rank[b.severity] - rank[a.severity]);
}
