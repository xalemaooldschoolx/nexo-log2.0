export type RoleCode = 'ADMIN' | 'SUPERVISOR' | 'OPERADOR_MOEGA' | 'PRODUCAO';

export type PermissionCode =
  | 'dashboard:view'
  | 'silos:view'
  | 'silos:manage'
  | 'materials:view'
  | 'materials:manage'
  | 'compatibility:manage'
  | 'pendencies:resolve'
  | 'users:manage'
  | 'audit:view'
  | 'help:view'
  | 'help:manage'
  | 'requests:create'
  | 'receipts:view'
  | 'receipts:execute'
  | 'transfers:execute'
  | 'stock:adjust'
  | 'reports:view'
  | 'schedules:view'
  | 'schedules:import'
  | 'schedules:approve'
  | 'schedules:execution_update'
  | 'consumption:manage'
  | 'supply:view'
  | 'routes:manage'
  | 'transfers:plan'
  | 'priority:manage'
  | 'reports:export'
  | 'shifts:view'
  | 'shifts:manage'
  | 'handover:prepare'
  | 'handover:finalize'
  | 'handover:acknowledge'
  | 'handover:approve'
  | 'handover:correct'
  | 'occurrences:view'
  | 'occurrences:create'
  | 'occurrences:manage'
  | 'occurrences:verify'
  | 'kpi:targets_manage'
  | 'assistant:use'
  | 'baskets:view'
  | 'baskets:upload'
  | 'baskets:edit'
  | 'baskets:publish'
  | 'baskets:executive_view'
  | 'baskets:export'
  | 'rubricagem:capture'
  | 'rubricagem:authorize';

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  OPERADOR_MOEGA: 'Operador Moega',
  PRODUCAO: 'Produção',
};

export const ROLE_PERMISSIONS: Record<RoleCode, PermissionCode[]> = {
  ADMIN: [
    'dashboard:view',
    'silos:view',
    'silos:manage',
    'materials:view',
    'materials:manage',
    'compatibility:manage',
    'pendencies:resolve',
    'users:manage',
    'audit:view',
    'help:view',
    'help:manage',
    'requests:create',
    'receipts:view',
    'receipts:execute',
    'transfers:execute',
    'transfers:plan',
    'routes:manage',
    'supply:view',
    'priority:manage',
    'stock:adjust',
    'reports:view',
    'reports:export',
    'shifts:view',
    'shifts:manage',
    'handover:prepare',
    'handover:finalize',
    'handover:acknowledge',
    'handover:approve',
    'handover:correct',
    'occurrences:view',
    'occurrences:create',
    'occurrences:manage',
    'occurrences:verify',
    'kpi:targets_manage',
    'assistant:use',
    'schedules:view',
    'schedules:import',
    'schedules:approve',
    'schedules:execution_update',
    'consumption:manage',
    'baskets:view',
    'baskets:upload',
    'baskets:edit',
    'baskets:publish',
    'baskets:executive_view',
    'baskets:export',
    'rubricagem:capture',
    'rubricagem:authorize',
  ],
  SUPERVISOR: [
    'dashboard:view',
    'silos:view',
    'silos:manage',
    'materials:view',
    'materials:manage',
    'compatibility:manage',
    'pendencies:resolve',
    'audit:view',
    'help:view',
    'requests:create',
    'receipts:view',
    'receipts:execute',
    'transfers:execute',
    'transfers:plan',
    'routes:manage',
    'supply:view',
    'priority:manage',
    'stock:adjust',
    'reports:view',
    'reports:export',
    'shifts:view',
    'shifts:manage',
    'handover:prepare',
    'handover:finalize',
    'handover:acknowledge',
    'handover:approve',
    'handover:correct',
    'occurrences:view',
    'occurrences:create',
    'occurrences:manage',
    'occurrences:verify',
    'assistant:use',
    'schedules:view',
    'schedules:import',
    'schedules:approve',
    'schedules:execution_update',
    'consumption:manage',
    'baskets:view',
    'baskets:upload',
    'baskets:edit',
    'baskets:publish',
    'baskets:executive_view',
    'baskets:export',
    'rubricagem:capture',
    'rubricagem:authorize',
  ],
  OPERADOR_MOEGA: [
    'dashboard:view',
    'silos:view',
    'materials:view',
    'help:view',
    'receipts:view',
    'receipts:execute',
    'transfers:execute',
    'transfers:plan',
    'supply:view',
    'reports:view',
    'reports:export',
    'shifts:view',
    'handover:prepare',
    'handover:acknowledge',
    'occurrences:view',
    'occurrences:create',
    'assistant:use',
    'schedules:view',
    'schedules:import',
    'schedules:execution_update',
    'baskets:view',
    'baskets:upload',
    'rubricagem:capture',
  ],
  PRODUCAO: [
    'dashboard:view',
    'silos:view',
    'materials:view',
    'help:view',
    'requests:create',
    'transfers:plan',
    'supply:view',
    'receipts:view',
    'reports:view',
    'reports:export',
    'shifts:view',
    'occurrences:view',
    'assistant:use',
    'schedules:view',
    'baskets:view',
    'rubricagem:capture',
  ],
};

export function hasPermission(roleCode: RoleCode | string | undefined, permission: PermissionCode): boolean {
  if (!roleCode) return false;
  const perms = ROLE_PERMISSIONS[roleCode as RoleCode];
  if (!perms) return false;
  return perms.includes(permission);
}
