import { db } from './index.ts';
import { shifts } from './schema.ts';
import {
  DEFAULT_SHIFT_CONFIGS,
  type OperationalShiftInfo,
  type ShiftCode,
  type ShiftConfigInput,
  resolveShiftFromConfigs,
} from '../lib/shifts.ts';

export async function resolveShiftConfiguredFromExecutor(
  executor: Pick<typeof db, 'select'> = db,
  date: Date = new Date()
): Promise<OperationalShiftInfo> {
  const dbShifts = await executor.select().from(shifts);
  if (!dbShifts || dbShifts.length === 0) {
    return resolveShiftFromConfigs(date, DEFAULT_SHIFT_CONFIGS);
  }
  const configs: ShiftConfigInput[] = dbShifts.map((s) => ({
    code: s.code as ShiftCode,
    name: s.name,
    startTime: s.startTime,
    endTime: s.endTime,
    crossesMidnight: s.crossesMidnight,
    isValidated: s.isValidated,
    isActive: s.isActive,
    responsibleName: s.responsibleName,
  }));
  return resolveShiftFromConfigs(date, configs);
}
