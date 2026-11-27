import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Paperclip, Plus, RefreshCw, Wrench } from 'lucide-react';
import {
  MaterialItem,
  OCCURRENCE_CATEGORIES,
  OccurrenceEvidenceItem,
  OccurrenceItem,
  SessionData,
  SiloDetail,
} from '../types/nexo.ts';
import { apiFetch } from '../lib/api.ts';
import { hasPermission } from '../lib/rbac.ts';

interface OccurrencesPageProps {
  session: SessionData;
  silos: SiloDetail[];
  materials: MaterialItem[];
}

export const OccurrencesPage: React.FC<OccurrencesPageProps> = ({
  session,
  silos,
  materials,
}) => {
  const [items, setItems] = useState<OccurrenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [siloFilter, setSiloFilter] = useState('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [category, setCategory] = useState<string>(OCCURRENCE_CATEGORIES[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [siloId, setSiloId] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [priority, setPriority] = useState<'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA'>('ALTA');
  const [weatherCondition, setWeatherCondition] = useState('');
  const [lineImpact, setLineImpact] = useState('');
  const [executedByOther, setExecutedByOther] = useState(false);
  const [executedByName, setExecutedByName] = useState('');
  const [executedByBadge, setExecutedByBadge] = useState('');
  const [evidenceList, setEvidenceList] = useState<OccurrenceEvidenceItem[]>([]);
  const [evidenceNote, setEvidenceNote] = useState('');

  const [solutionDrafts, setSolutionDrafts] = useState<Record<number, string>>({});
  const [verificationNotes, setVerificationNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const canCreate = hasPermission(session.user.roleCode, 'occurrences:create');
  const canManage = hasPermission(session.user.roleCode, 'occurrences:manage');
  const canVerify = hasPermission(session.user.roleCode, 'occurrences:verify');

  const loadOccurrences = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (categoryFilter) qs.set('category', categoryFilter);
      if (siloFilter) qs.set('siloId', siloFilter);
      const data = await apiFetch<OccurrenceItem[]>(
        `/api/occurrences${qs.toString() ? `?${qs.toString()}` : ''}`
      );
      setItems(data);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar ocorrências.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, siloFilter]);

  useEffect(() => {
    loadOccurrences();
  }, [loadOccurrences]);

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 120 * 1024) {
      setError('Limite de anexo de imagem/evidência: 120 KB por arquivo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setEvidenceList((prev) => [
        ...prev,
        { name: file.name, mimeType: file.type, dataUrlOrNote: String(reader.result || '') },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const addNoteEvidence = () => {
    if (!evidenceNote.trim()) return;
    setEvidenceList((prev) => [
      ...prev,
      { name: 'Observação/Referência', dataUrlOrNote: evidenceNote.trim() },
    ]);
    setEvidenceNote('');
  };

  const handleCreateOccurrence = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);
    try {
      const created = await apiFetch<OccurrenceItem>('/api/occurrences', {
        method: 'POST',
        body: JSON.stringify({
          category,
          title,
          description,
          siloId: siloId ? Number(siloId) : null,
          materialId: materialId ? Number(materialId) : null,
          priority,
          weatherCondition: weatherCondition.trim() || null,
          lineImpact: lineImpact.trim() || null,
          executedByName: executedByOther ? executedByName.trim() || null : null,
          executedByBadge: executedByOther ? executedByBadge.trim() || null : null,
          evidence: evidenceList,
        }),
      });
      setTitle('');
      setDescription('');
      setSiloId('');
      setMaterialId('');
      setWeatherCondition('');
      setLineImpact('');
      setExecutedByOther(false);
      setExecutedByName('');
      setExecutedByBadge('');
      setEvidenceList([]);
      setShowCreateForm(false);
      setStatusMsg(`Ocorrência ${created.occurrenceCode} registrada com sucesso e vinculada ao turno atual.`);
      await loadOccurrences();
    } catch (err: any) {
      setError(err.message || 'Erro ao registrar ocorrência.');
    }
  };

  const handleUpdateStatus = async (
    id: number,
    newStatus: 'EM_ANDAMENTO' | 'ENCERRADA'
  ) => {
    setError(null);
    setStatusMsg(null);
    try {
      await apiFetch(`/api/occurrences/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: newStatus,
          solutionApplied: newStatus === 'ENCERRADA' ? solutionDrafts[id] || '' : undefined,
        }),
      });
      setStatusMsg(
        newStatus === 'ENCERRADA'
          ? 'Ocorrência encerrada com solução auditada.'
          : 'Ocorrência atualizada para Em Andamento.'
      );
      await loadOccurrences();
    } catch (err: any) {
      setError(err.message || 'Falha ao atualizar status da ocorrência.');
    }
  };

  const handleVerifyOccurrence = async (id: number) => {
    setError(null);
    setStatusMsg(null);
    try {
      await apiFetch(`/api/occurrences/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({
          notes: (verificationNotes[id] || '').trim() || 'Verificado e validado pela supervisão.',
        }),
      });
      setStatusMsg('Verificação da ocorrência confirmada e registrada em auditoria.');
      await loadOccurrences();
    } catch (err: any) {
      setError(err.message || 'Falha ao confirmar verificação da ocorrência.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
              Central de Ocorrências Operacionais
            </h2>
            <p className="text-xs text-[#AEB8C5]">
              12 categorias oficiais · Registro com silo, matéria-prima, turno, evidências e solução auditada
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadOccurrences}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 text-xs font-medium text-[#F4F6F8]"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 text-xs font-extrabold text-[#0A1421]"
            >
              <Plus className="h-4 w-4" />
              <span>{showCreateForm ? 'Fechar Formulário' : 'Registrar Ocorrência'}</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
          {error}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          {statusMsg}
        </div>
      )}

      {/* Formulário de Nova Ocorrência */}
      {showCreateForm && canCreate && (
        <form
          onSubmit={handleCreateOccurrence}
          className="rounded-xl border border-[#F5B91B]/35 bg-[#101B2A] p-5 space-y-4"
        >
          <h3 className="font-display text-sm font-bold text-[#F4F6F8]">
            Nova Ocorrência Operacional
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-[11px] text-[#AEB8C5]">Categoria Obrigatória</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              >
                {OCCURRENCE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-[#AEB8C5]">Prioridade</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              >
                <option value="CRITICA">CRÍTICA</option>
                <option value="ALTA">ALTA</option>
                <option value="MEDIA">MÉDIA</option>
                <option value="BAIXA">BAIXA</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-[#AEB8C5]">Silo Relacionado (opcional)</label>
              <select
                value={siloId}
                onChange={(e) => setSiloId(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              >
                <option value="">Nenhum silo específico</option>
                {silos.map((s) => (
                  <option key={s.id} value={s.id}>
                    Silo {s.siloNumber} ({s.lineCode})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-[#AEB8C5]">Título Resumido</label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Falha na válvula do Silo 38 durante transferência"
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-[#AEB8C5]">
                Matéria-Prima Envolvida (opcional)
              </label>
              <select
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              >
                <option value="">Nenhuma matéria-prima específica</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} — {m.description}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421]/70 px-3 py-2 text-xs text-[#AEB8C5]">
            Registro automático em nome de:{' '}
            <strong className="text-[#F4F6F8]">{session.user.displayName}</strong>
            {session.user.badgeCode ? (
              <span className="ml-1.5 font-mono-tabular text-[#F5B91B]">
                · Matrícula {session.user.badgeCode}
              </span>
            ) : null}
            <span className="ml-1.5">· {session.shift.shiftName} ({session.shift.operationalDate})</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-[#AEB8C5]">
                Condição Climática (opcional)
              </label>
              <input
                type="text"
                value={weatherCondition}
                onChange={(e) => setWeatherCondition(e.target.value)}
                placeholder="Ex.: Tempo firme / Chuva / Umidade elevada"
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-[#AEB8C5]">
                Impacto em Linha / Operação (opcional)
              </label>
              <input
                type="text"
                value={lineImpact}
                onChange={(e) => setLineImpact(e.target.value)}
                placeholder="Ex.: Parada parcial na descarga da Moega / Sem impacto"
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]">
              <input
                type="checkbox"
                checked={executedByOther}
                onChange={(e) => setExecutedByOther(e.target.checked)}
                className="h-4 w-4 accent-[#F5B91B]"
              />
              <span>Atividade / atendimento executado por outro operador</span>
            </label>
            {executedByOther && (
              <>
                <input
                  type="text"
                  value={executedByName}
                  onChange={(e) => setExecutedByName(e.target.value)}
                  placeholder="Nome do operador executor"
                  className="min-h-[40px] rounded-lg border border-[#F5B91B]/40 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                />
                <input
                  type="text"
                  value={executedByBadge}
                  onChange={(e) => setExecutedByBadge(e.target.value)}
                  placeholder="Matrícula"
                  className="min-h-[40px] w-32 rounded-lg border border-[#F5B91B]/40 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                />
              </>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-[#AEB8C5]">Descrição Detalhada</label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o fato ocorrido, impacto na Moega/Produção e medidas imediatas..."
              className="w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-3 text-xs text-[#F4F6F8]"
            />
          </div>

          {/* Evidências */}
          <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 space-y-2">
            <p className="text-xs font-semibold text-[#F4F6F8]">Anexos / Evidências Permitidas</p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]">
                <Paperclip className="h-3.5 w-3.5 text-[#F5B91B]" />
                <span>Anexar Imagem (até 120 KB)</span>
                <input type="file" accept="image/*" onChange={handleFileAttach} className="hidden" />
              </label>
              <input
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
                placeholder="Ou registrar referência documental (NF, OS, foto)..."
                className="min-h-[40px] flex-1 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
              />
              <button
                type="button"
                onClick={addNoteEvidence}
                className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 px-3 text-xs text-[#F4F6F8]"
              >
                Adicionar Nota
              </button>
            </div>
            {evidenceList.length > 0 && (
              <div className="text-[11px] text-emerald-300">
                {evidenceList.length} evidência(s) anexada(s):{' '}
                {evidenceList.map((ev) => ev.name).join(', ')}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="min-h-[44px] rounded-lg bg-[#F5B91B] px-5 text-xs font-extrabold text-[#0A1421]"
            >
              Confirmar Registro de Ocorrência
            </button>
          </div>
        </form>
      )}

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:grid-cols-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
        >
          <option value="">Todos os status</option>
          <option value="ABERTA">Abertas</option>
          <option value="EM_ANDAMENTO">Em andamento</option>
          <option value="ENCERRADA">Encerradas</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
        >
          <option value="">Todas as categorias (12)</option>
          {OCCURRENCE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <select
          value={siloFilter}
          onChange={(e) => setSiloFilter(e.target.value)}
          className="min-h-[44px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
        >
          <option value="">Todos os silos</option>
          {silos.map((s) => (
            <option key={s.id} value={s.id}>
              Silo {s.siloNumber}
            </option>
          ))}
        </select>
      </div>

      {/* Lista de Ocorrências */}
      <div className="space-y-3">
        {items.length === 0 ? (
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-8 text-center text-sm text-[#AEB8C5]">
            Nenhuma ocorrência encontrada para os filtros selecionados.
          </div>
        ) : (
          items.map((o) => (
            <div
              key={o.id}
              className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono-tabular font-bold text-[#F5B91B]">{o.occurrenceCode}</span>
                    <span className="font-semibold text-red-300">{o.category}</span>
                    <span className="text-[#AEB8C5]">
                      {o.operationalDate} · {o.shiftCode} · Prioridade {o.priority}
                    </span>
                  </div>
                  <h4 className="mt-1 font-display text-sm font-bold text-[#F4F6F8]">{o.title}</h4>
                  <p className="mt-1 text-xs text-[#AEB8C5]">{o.description}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[#AEB8C5]">
                    <span>
                      Relator: {o.reportedByName}
                      {o.reportedByBadge ? ` (${o.reportedByBadge})` : ''}
                    </span>
                    {o.executedByName && (
                      <span className="text-[#F5B91B]">
                        Executor: {o.executedByName}
                        {o.executedByBadge ? ` (${o.executedByBadge})` : ''}
                      </span>
                    )}
                    {o.siloNumber && <span>Silo {o.siloNumber}</span>}
                    {o.materialCode && <span>MP: {o.materialCode}</span>}
                    {o.lineCode && <span>Linha: {o.lineCode}</span>}
                    {o.weatherCondition && <span>Clima: {o.weatherCondition}</span>}
                    {o.lineImpact && <span>Impacto: {o.lineImpact}</span>}
                    {o.evidence.length > 0 && <span>Evidências: {o.evidence.length}</span>}
                  </div>
                </div>

                <div className="text-right text-xs">
                  <span
                    className={`font-bold ${
                      o.status === 'ENCERRADA'
                        ? 'text-emerald-400'
                        : o.status === 'EM_ANDAMENTO'
                          ? 'text-amber-400'
                          : 'text-red-400'
                    }`}
                  >
                    {o.status}
                  </span>
                  {o.verifiedByName && (
                    <p className="mt-1 text-[11px] font-semibold text-blue-300">
                      Verificada por {o.verifiedByName}
                      {o.verifiedAt ? ` em ${new Date(o.verifiedAt).toLocaleString('pt-BR')}` : ''}
                    </p>
                  )}
                  {o.closedAt && (
                    <p className="mt-1 text-[11px] text-[#AEB8C5]">
                      Encerrada por {o.closedByName} em {new Date(o.closedAt).toLocaleString('pt-BR')}
                    </p>
                  )}
                </div>
              </div>

              {o.solutionApplied && (
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2.5 text-xs text-emerald-200">
                  <strong>Solução aplicada:</strong> {o.solutionApplied}
                </div>
              )}

              {o.verificationNotes && (
                <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-2.5 text-xs text-blue-200">
                  <strong>Verificação supervisionada:</strong> {o.verificationNotes}
                </div>
              )}

              {canManage && o.status !== 'ENCERRADA' && (
                <div className="flex flex-wrap items-center gap-2 border-t border-[#AEB8C5]/10 pt-3">
                  {o.status === 'ABERTA' && (
                    <button
                      type="button"
                      onClick={() => handleUpdateStatus(o.id, 'EM_ANDAMENTO')}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3.5 text-xs font-semibold text-amber-200"
                    >
                      <Wrench className="h-4 w-4" />
                      <span>Marcar Em Andamento</span>
                    </button>
                  )}
                  <input
                    value={solutionDrafts[o.id] || ''}
                    onChange={(e) => setSolutionDrafts({ ...solutionDrafts, [o.id]: e.target.value })}
                    placeholder="Descreva a solução aplicada para encerrar..."
                    className="min-h-[44px] flex-1 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                  />
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(o.id, 'ENCERRADA')}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-emerald-500 px-4 text-xs font-bold text-[#0A1421]"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Encerrar Ocorrência</span>
                  </button>
                </div>
              )}

              {canVerify && !o.verifiedByName && (
                <div className="flex flex-wrap items-center gap-2 border-t border-[#AEB8C5]/10 pt-3">
                  <input
                    value={verificationNotes[o.id] || ''}
                    onChange={(e) =>
                      setVerificationNotes({ ...verificationNotes, [o.id]: e.target.value })
                    }
                    placeholder="Observação da verificação (opcional)..."
                    className="min-h-[40px] flex-1 rounded-lg border border-blue-500/25 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
                  />
                  <button
                    type="button"
                    onClick={() => handleVerifyOccurrence(o.id)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-blue-400/40 bg-blue-500/15 px-4 text-xs font-bold text-blue-200 hover:bg-blue-500/25"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Confirmar Verificação</span>
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
