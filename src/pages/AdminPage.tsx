import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldAlert, UserCog } from 'lucide-react';
import { AppUser } from '../types/nexo.ts';
import { apiFetch } from '../lib/api.ts';
import { ROLE_LABELS, RoleCode } from '../lib/rbac.ts';

interface AdminPageProps {
  currentUserId: number;
  onSessionRefresh: () => Promise<void>;
}

const ROLE_OPTIONS: RoleCode[] = ['ADMIN', 'SUPERVISOR', 'OPERADOR_MOEGA', 'PRODUCAO'];
const SHIFT_OPTIONS = [
  { code: 'TURNO_1', label: '1º Turno (07:30–17:18)' },
  { code: 'TURNO_2', label: '2º Turno (17:00–02:12)' },
  { code: 'TURNO_3', label: '3º Turno (23:28–07:30)' },
];

export const AdminPage: React.FC<AdminPageProps> = ({ currentUserId, onSessionRefresh }) => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);

  const [roleCode, setRoleCode] = useState<RoleCode>('OPERADOR_MOEGA');
  const [defaultShiftCode, setDefaultShiftCode] = useState('TURNO_1');
  const [badgeCode, setBadgeCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AppUser[]>('/api/users');
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar usuários cadastrados.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openEditor = (u: AppUser) => {
    setEditingUser(u);
    setRoleCode(u.roleCode);
    setDefaultShiftCode(u.defaultShiftCode);
    setBadgeCode(u.badgeCode || '');
    setDisplayName(u.displayName);
    setJobTitle(u.jobTitle || '');
    setDepartment(u.department || '');
    setIsActive(u.isActive);
    setReason('');
    setSaveFeedback(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (reason.trim().length < 3) {
      setError('Informe um motivo administrativo válido para auditoria.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/users/${editingUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          roleCode,
          defaultShiftCode,
          badgeCode: badgeCode.trim() || null,
          displayName: displayName.trim(),
          jobTitle: jobTitle.trim() || null,
          department: department.trim() || null,
          isActive,
          reason: reason.trim(),
        }),
      });
      await loadUsers();
      if (editingUser.id === currentUserId) {
        await onSessionRefresh();
      }
      setSaveFeedback(`Conta de ${displayName} atualizada e registrada em auditoria.`);
      setEditingUser(null);
    } catch (err: any) {
      setError(err.message || 'Falha ao atualizar usuário.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#F5B91B]/30 bg-[#F5B91B]/10 text-[#F5B91B]">
            <UserCog className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
              Administração de Usuários e Perfis (RBAC)
            </h2>
            <p className="text-xs text-[#AEB8C5]">
              Login individual, atribuição de perfis de acesso, matrícula e turno padrão
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadUsers}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 py-2 text-sm font-medium text-[#F4F6F8] hover:border-[#F5B91B]/50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar Lista</span>
        </button>
      </div>

      {/* RBAC Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-bold text-[#F5B91B]">Administrador</p>
          <p className="mt-1 text-xs text-[#AEB8C5]">
            Acesso integral, usuários, auditoria, silos, compatibilidade e validação de divergências.
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-bold text-[#3B82F6]">Supervisor</p>
          <p className="mt-1 text-xs text-[#AEB8C5]">
            Gestão de silos, materiais, matriz de transferências, auditoria e homologação documental.
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-bold text-emerald-400">Operador Moega</p>
          <p className="mt-1 text-xs text-[#AEB8C5]">
            Registro de recebimentos, leitura de etiquetas, transferências autorizadas, importação de programações, ocorrências e passagem de turno.
          </p>
        </div>
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="text-xs font-bold text-orange-400">Produção</p>
          <p className="mt-1 text-xs text-[#AEB8C5]">
            Perfil restrito de consulta (estoque, silos e solicitação de material; sem edição da Moega).
          </p>
        </div>
      </div>

      {saveFeedback && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{saveFeedback}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {/* User List */}
      <div className="overflow-hidden rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]">
        {loading && users.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#AEB8C5]">Carregando contas...</div>
        ) : (
          <div className="divide-y divide-[#AEB8C5]/10">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-4 p-4 hover:bg-[#0A1421]/40"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-bold text-[#F4F6F8]">
                      {u.displayName}
                    </span>
                    {u.id === currentUserId && (
                      <span className="text-xs font-semibold text-[#F5B91B]">· Sessão Atual</span>
                    )}
                    <span className="text-[#AEB8C5]">·</span>
                    <span
                      className={`text-xs font-semibold ${
                        u.isActive ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {u.isActive ? 'Ativo' : 'Bloqueado'}
                    </span>
                  </div>
                  <p className="text-xs text-[#AEB8C5]">
                    {u.email} · Perfil:{' '}
                    <span className="font-semibold text-[#F4F6F8]">
                      {ROLE_LABELS[u.roleCode] || u.roleName}
                    </span>{' '}
                    · Turno padrão: <span className="font-mono-tabular">{u.defaultShiftCode}</span>
                    {u.badgeCode ? (
                      <>
                        {' '}
                        · Matrícula: <span className="font-mono-tabular">{u.badgeCode}</span>
                      </>
                    ) : null}
                    {u.jobTitle ? ` · Função: ${u.jobTitle}` : ''}
                    {u.department ? ` · Setor: ${u.department}` : ''}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => openEditor(u)}
                  className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 py-2 text-sm font-medium text-[#F4F6F8] hover:border-[#F5B91B]"
                >
                  Editar Acesso
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSave}
            className="w-full max-w-lg space-y-4 rounded-xl border border-[#AEB8C5]/25 bg-[#101B2A] p-6 text-[#F4F6F8]"
          >
            <div>
              <p className="text-xs font-medium text-[#F5B91B]">Controle Administrativo RBAC</p>
              <h3 className="font-display text-lg font-bold">
                Editar Acesso — {editingUser.email}
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Nome de Exibição
                </label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Matrícula / Crachá
                </label>
                <input
                  type="text"
                  value={badgeCode}
                  onChange={(e) => setBadgeCode(e.target.value)}
                  placeholder="Opcional"
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Função / Cargo
                </label>
                <input
                  type="text"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Ex.: Operador de Moega"
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Setor
                </label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Ex.: Moega / Recebimento"
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Perfil de Permissão
                </label>
                <select
                  value={roleCode}
                  onChange={(e) => setRoleCode(e.target.value as RoleCode)}
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                >
                  {ROLE_OPTIONS.map((rc) => (
                    <option key={rc} value={rc}>
                      {ROLE_LABELS[rc]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                  Turno Padrão
                </label>
                <select
                  value={defaultShiftCode}
                  onChange={(e) => setDefaultShiftCode(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                >
                  {SHIFT_OPTIONS.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="flex min-h-[44px] items-center gap-3 rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 accent-[#F5B91B]"
              />
              <span>Conta ativa (desmarcar bloqueia o acesso ao sistema)</span>
            </label>

            <div>
              <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                Motivo da Alteração (Obrigatório para Auditoria)
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Promoção para Supervisor de Turno 2"
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 px-4 py-2 text-sm text-[#AEB8C5] hover:bg-[#1A2B42]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] rounded-lg bg-[#F5B91B] px-5 py-2 text-sm font-bold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-60"
              >
                {saving ? 'Salvando...' : 'Confirmar e Auditar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
