import { hasPermission, type PermissionCode, type RoleCode } from './rbac.ts';
import type { NavSectionId } from '../types/nexo.ts';

export type ExperienceMode = 'OPERACIONAL' | 'GERENCIAL' | 'ADMINISTRACAO';

export interface ExperienceModeMeta {
  id: ExperienceMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const EXPERIENCE_MODES_META: Record<ExperienceMode, ExperienceModeMeta> = {
  OPERACIONAL: {
    id: 'OPERACIONAL',
    label: 'Modo Operacional (Moega)',
    shortLabel: 'Operacional',
    description: 'Interface simples e visual orientada às tarefas diárias do pátio e moega.',
  },
  GERENCIAL: {
    id: 'GERENCIAL',
    label: 'Modo Gerencial (Supervisão)',
    shortLabel: 'Gerencial',
    description: 'Indicadores, análises comparativas, programação, relatórios e acompanhamento de turnos.',
  },
  ADMINISTRACAO: {
    id: 'ADMINISTRACAO',
    label: 'Modo Administração',
    shortLabel: 'Administração',
    description: 'Usuários, permissões, cadastros técnicos, rotas autorizadas, auditoria e IA.',
  },
};

/**
 * Resolve os modos de experiência permitidos estritamente pelo perfil real autenticado.
 * Este controle organiza a experiência visual e NUNCA substitui o RBAC do servidor.
 */
export function getAllowedExperienceModes(roleCode: RoleCode | string | undefined): ExperienceMode[] {
  if (!roleCode) return ['OPERACIONAL'];
  if (roleCode === 'ADMIN') {
    return ['OPERACIONAL', 'GERENCIAL', 'ADMINISTRACAO'];
  }
  if (roleCode === 'SUPERVISOR') {
    return ['OPERACIONAL', 'GERENCIAL'];
  }
  // OPERADOR_MOEGA e PRODUCAO permanecem estritamente no Modo Operacional
  return ['OPERACIONAL'];
}

export function getDefaultExperienceMode(
  roleCode: RoleCode | string | undefined,
  isDemoMode = false
): ExperienceMode {
  if (isDemoMode && roleCode === 'ADMIN') {
    return 'GERENCIAL';
  }
  if (roleCode === 'ADMIN') return 'GERENCIAL';
  if (roleCode === 'SUPERVISOR') return 'GERENCIAL';
  return 'OPERACIONAL';
}

export const SECTION_REQUIRED_PERMISSION: Partial<Record<NavSectionId, PermissionCode>> = {
  painel: 'dashboard:view',
  mapa: 'silos:view',
  estoque: 'materials:view',
  recebimentos: 'receipts:view',
  etiquetas: 'receipts:view',
  distribuicao: 'receipts:view',
  transferencias: 'supply:view',
  programacao: 'schedules:view',
  comparador: 'baskets:view',
  consumo: 'schedules:view',
  abastecimento: 'supply:view',
  relatorios: 'reports:view',
  turnos: 'shifts:view',
  ocorrencias: 'occurrences:view',
  assistente: 'assistant:use',
  auditoria: 'audit:view',
  admin: 'users:manage',
  guia: 'help:view',
};

/**
 * Verifica se o perfil autenticado pode acessar uma determinada seção do sistema.
 */
export function canAccessSection(
  roleCode: RoleCode | string | undefined,
  section: NavSectionId
): boolean {
  if (!roleCode) return false;
  if (section === 'inicio' || section === 'executivo') {
    return true;
  }
  if (section === 'qualidade') {
    return hasPermission(roleCode, 'silos:view');
  }
  if (section === 'transferencias') {
    return (
      hasPermission(roleCode, 'transfers:execute') ||
      hasPermission(roleCode, 'transfers:plan') ||
      hasPermission(roleCode, 'supply:view')
    );
  }
  const required = SECTION_REQUIRED_PERMISSION[section];
  if (!required) return true;
  return hasPermission(roleCode, required);
}

/**
 * Seções consideradas administrativas estritas (Modo 3 / Supervisão técnica).
 */
export function isAdminOnlySection(section: NavSectionId): boolean {
  return section === 'admin' || section === 'auditoria';
}
