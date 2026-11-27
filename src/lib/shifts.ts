export type ShiftCode = 'TURNO_1' | 'TURNO_2' | 'TURNO_3';

export interface OperationalShiftInfo {
  shiftCode: ShiftCode;
  shiftName: string;
  operationalDate: string; // YYYY-MM-DD (preserva data de início do turno que cruza meia-noite)
  realTimestampIso: string;
  crossesMidnight: boolean;
  startTime?: string;
  endTime?: string;
  isValidated?: boolean;
  responsibleName?: string | null;
}

export interface ShiftConfigInput {
  code: ShiftCode;
  name: string;
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  crossesMidnight?: boolean;
  isValidated?: boolean;
  isActive?: boolean;
  responsibleName?: string | null;
}

export const DEFAULT_SHIFT_CONFIGS: ShiftConfigInput[] = [
  {
    code: 'TURNO_1',
    name: '1º Turno',
    startTime: '07:30',
    endTime: '17:18',
    crossesMidnight: false,
    isValidated: false,
    isActive: true,
    responsibleName: null,
  },
  {
    code: 'TURNO_2',
    name: '2º Turno',
    startTime: '17:00',
    endTime: '02:12',
    crossesMidnight: true,
    isValidated: false,
    isActive: true,
    responsibleName: null,
  },
  {
    code: 'TURNO_3',
    name: '3º Turno',
    startTime: '23:28',
    endTime: '07:30',
    crossesMidnight: true,
    isValidated: false,
    isActive: true,
    responsibleName: null,
  },
];

export function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseTimeToMinutes(hhmm: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim());
  if (!match) {
    throw new Error(`Horário inválido "${hhmm}". Utilize o formato HH:mm (ex.: 07:30).`);
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h * 60 + m;
}

export function detectCrossesMidnight(startTime: string, endTime: string): boolean {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin === endMin) {
    throw new Error('Horário de início e término do turno não podem ser iguais.');
  }
  return startMin > endMin;
}

export function formatShiftDisplayName(cfg: Pick<ShiftConfigInput, 'name' | 'startTime' | 'endTime'>): string {
  return `${cfg.name} (${cfg.startTime}–${cfg.endTime})`;
}

/**
 * Resolve o turno operacional e a data operacional a partir de uma lista configurável de turnos.
 * Regras críticas:
 * - Se um turno cruza a meia-noite (ex.: 2º Turno 17:00–02:12 ou 3º Turno 23:28–07:30), registros realizados
 *   após 00:00 preservam automaticamente a data operacional do dia em que o turno começou (dia anterior).
 * - Quando há janela de sobreposição na troca de turno (ex.: 17:00–17:18 ou 23:28–02:12),
 *   prioriza o turno mais recentemente iniciado (menor tempo decorrido desde startTime).
 * - Preserva também realTimestampIso com a hora exata real do evento.
 */
export function resolveShiftFromConfigs(
  date: Date = new Date(),
  configs: ShiftConfigInput[] = DEFAULT_SHIFT_CONFIGS
): OperationalShiftInfo {
  const activeConfigs = configs.filter((c) => c.isActive !== false);
  const list = activeConfigs.length > 0 ? activeConfigs : DEFAULT_SHIFT_CONFIGS;
  const nowMin = date.getHours() * 60 + date.getMinutes();

  const matches: Array<{ elapsedSinceStartMin: number; info: OperationalShiftInfo }> = [];

  for (const cfg of list) {
    const startMin = parseTimeToMinutes(cfg.startTime);
    const endMin = parseTimeToMinutes(cfg.endTime);
    const crosses = cfg.crossesMidnight ?? startMin > endMin;

    if (!crosses) {
      if (nowMin >= startMin && nowMin < endMin) {
        matches.push({
          elapsedSinceStartMin: nowMin - startMin,
          info: {
            shiftCode: cfg.code,
            shiftName: formatShiftDisplayName(cfg),
            operationalDate: formatDateLocal(date),
            realTimestampIso: date.toISOString(),
            crossesMidnight: false,
            startTime: cfg.startTime,
            endTime: cfg.endTime,
            isValidated: Boolean(cfg.isValidated),
            responsibleName: cfg.responsibleName ?? null,
          },
        });
      }
    } else {
      if (nowMin >= startMin) {
        matches.push({
          elapsedSinceStartMin: nowMin - startMin,
          info: {
            shiftCode: cfg.code,
            shiftName: formatShiftDisplayName(cfg),
            operationalDate: formatDateLocal(date),
            realTimestampIso: date.toISOString(),
            crossesMidnight: true,
            startTime: cfg.startTime,
            endTime: cfg.endTime,
            isValidated: Boolean(cfg.isValidated),
            responsibleName: cfg.responsibleName ?? null,
          },
        });
      } else if (nowMin < endMin) {
        const shiftStartDay = new Date(date.getTime());
        shiftStartDay.setDate(shiftStartDay.getDate() - 1);
        matches.push({
          elapsedSinceStartMin: 1440 - startMin + nowMin,
          info: {
            shiftCode: cfg.code,
            shiftName: formatShiftDisplayName(cfg),
            operationalDate: formatDateLocal(shiftStartDay),
            realTimestampIso: date.toISOString(),
            crossesMidnight: true,
            startTime: cfg.startTime,
            endTime: cfg.endTime,
            isValidated: Boolean(cfg.isValidated),
            responsibleName: cfg.responsibleName ?? null,
          },
        });
      }
    }
  }

  if (matches.length > 0) {
    matches.sort((a, b) => a.elapsedSinceStartMin - b.elapsedSinceStartMin);
    return matches[0].info;
  }

  // Fallback seguro para lista padrão caso haja lacuna horária em configuração customizada
  if (configs !== DEFAULT_SHIFT_CONFIGS) {
    return resolveShiftFromConfigs(date, DEFAULT_SHIFT_CONFIGS);
  }

  return {
    shiftCode: 'TURNO_1',
    shiftName: '1º Turno (07:30–17:18)',
    operationalDate: formatDateLocal(date),
    realTimestampIso: date.toISOString(),
    crossesMidnight: false,
    startTime: '07:30',
    endTime: '17:18',
    isValidated: false,
    responsibleName: null,
  };
}

/**
 * Regra operacional padrão de turnos da Moega:
 * - 1º Turno: 07:30 às 17:18
 * - 2º Turno: 17:00 às 02:12 (cruza meia-noite; entre 00:00 e 02:11 mantém data operacional do dia anterior)
 * - 3º Turno: 23:28 às 07:30 (cruza meia-noite; entre 00:00 e 07:29 mantém data operacional do dia anterior)
 */
export function resolveOperationalShift(date: Date = new Date()): OperationalShiftInfo {
  return resolveShiftFromConfigs(date, DEFAULT_SHIFT_CONFIGS);
}
