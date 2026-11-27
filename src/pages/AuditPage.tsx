import React, { useCallback, useEffect, useState } from 'react';
import { History, RefreshCw, Search, Shield } from 'lucide-react';
import { AuditEventItem } from '../types/nexo.ts';
import { apiFetch } from '../lib/api.ts';

export const AuditPage: React.FC = () => {
  const [events, setEvents] = useState<AuditEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<AuditEventItem[]>('/api/audit');
      setEvents(data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar eventos de auditoria.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const entityTypes = Array.from(new Set(events.map((e) => e.entityType))).sort();
  const q = search.trim().toLowerCase();

  const filtered = events.filter((ev) => {
    if (entityFilter !== 'ALL' && ev.entityType !== entityFilter) return false;
    if (!q) return true;
    return (
      ev.userName.toLowerCase().includes(q) ||
      ev.userEmail.toLowerCase().includes(q) ||
      ev.action.toLowerCase().includes(q) ||
      ev.entityType.toLowerCase().includes(q) ||
      ev.entityId.toLowerCase().includes(q) ||
      (ev.reason || '').toLowerCase().includes(q)
    );
  });

  const formatJsonPreview = (raw: string | null) => {
    if (!raw) return '—';
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#F5B91B]/30 bg-[#F5B91B]/10 text-[#F5B91B]">
            <History className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
              Histórico e Auditoria Imutável
            </h2>
            <p className="text-xs text-[#AEB8C5]">
              Registro cronológico de alterações cadastrais, validações documentais e permissões
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadAudit}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 py-2 text-sm font-medium text-[#F4F6F8] hover:border-[#F5B91B]/50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Atualizar Registro</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#AEB8C5]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por usuário, ação, entidade, motivo..."
            className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] pl-9 pr-3 text-sm text-[#F4F6F8] placeholder:text-[#AEB8C5]/50 focus:border-[#F5B91B] focus:outline-none"
          />
        </div>

        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          aria-label="Filtrar por entidade"
          className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
        >
          <option value="ALL">Todas as entidades</option>
          {entityTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <span className="font-mono-tabular text-xs text-[#AEB8C5]">
          {filtered.length} de {events.length} eventos
        </span>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Table / Cards */}
      <div className="overflow-hidden rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A]">
        {loading && events.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#AEB8C5]">
            Carregando trilha de auditoria...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
            <Shield className="h-8 w-8 text-[#AEB8C5]/40" />
            <p className="text-sm font-medium text-[#F4F6F8]">Nenhum evento encontrado</p>
            <p className="text-xs text-[#AEB8C5]">
              Ajuste os filtros ou realize uma alteração operacional autorizada.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#AEB8C5]/10">
            {filtered.map((ev) => {
              const isExpanded = expandedId === ev.id;
              return (
                <div key={ev.id} className="p-4 transition-colors hover:bg-[#0A1421]/40">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-mono-tabular font-bold text-[#F5B91B]">
                          #{ev.id}
                        </span>
                        <span className="text-[#AEB8C5]">·</span>
                        <span className="font-mono-tabular font-semibold text-[#F4F6F8]">
                          {ev.action}
                        </span>
                        <span className="text-[#AEB8C5]">·</span>
                        <span className="text-[#3B82F6]">
                          {ev.entityType} ({ev.entityId})
                        </span>
                        <span className="text-[#AEB8C5]">·</span>
                        <span className="text-[#AEB8C5]">{ev.origin}</span>
                      </div>

                      <p className="text-sm text-[#F4F6F8]">
                        {ev.reason || 'Registro automático de operação cadastral'}
                      </p>

                      <p className="text-xs text-[#AEB8C5]">
                        Responsável: <span className="text-[#F4F6F8]">{ev.userName}</span> ({ev.userEmail}) · Perfil{' '}
                        <span className="font-medium text-[#F5B91B]">{ev.userRole}</span>
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <span className="font-mono-tabular text-xs text-[#AEB8C5]">
                        {new Date(ev.createdAt).toLocaleString('pt-BR')}
                      </span>
                      {(ev.previousValue || ev.newValue) && (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                          className="min-h-[36px] rounded-md border border-[#AEB8C5]/20 bg-[#0A1421] px-3 py-1 text-xs font-medium text-[#F4F6F8] hover:border-[#F5B91B]/50"
                        >
                          {isExpanded ? 'Ocultar Diferenças' : 'Ver Antes / Depois'}
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 grid grid-cols-1 gap-3 border-t border-[#AEB8C5]/10 pt-4 md:grid-cols-2">
                      <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3">
                        <p className="mb-2 text-xs font-semibold text-[#AEB8C5]">Estado Anterior</p>
                        <pre className="max-h-48 overflow-auto font-mono-tabular text-xs text-[#AEB8C5]">
                          {formatJsonPreview(ev.previousValue)}
                        </pre>
                      </div>
                      <div className="rounded-lg border border-emerald-500/25 bg-[#0A1421] p-3">
                        <p className="mb-2 text-xs font-semibold text-emerald-400">Novo Estado</p>
                        <pre className="max-h-48 overflow-auto font-mono-tabular text-xs text-emerald-200">
                          {formatJsonPreview(ev.newValue)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
