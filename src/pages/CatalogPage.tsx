import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Search, ShieldCheck } from 'lucide-react';
import {
  MaterialBagConfigItem,
  MaterialItem,
  SiloDetail,
  TransferRuleItem,
  ValidationPendency,
} from '../types/nexo.ts';
import { apiFetch, formatKg } from '../lib/api.ts';

interface CatalogPageProps {
  silos: SiloDetail[];
  materials: MaterialItem[];
  bagConfigs: MaterialBagConfigItem[];
  transferRules: TransferRuleItem[];
  pendencies: ValidationPendency[];
  canManageMaterials: boolean;
  canManageRules: boolean;
  canResolvePendencies: boolean;
  onReload: () => Promise<void>;
}

type TabId = 'silos' | 'materiais' | 'bags' | 'matriz' | 'pendencias';

export const CatalogPage: React.FC<CatalogPageProps> = ({
  silos,
  materials,
  bagConfigs,
  transferRules,
  pendencies,
  canManageMaterials,
  canManageRules,
  canResolvePendencies,
  onReload,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('silos');
  const [search, setSearch] = useState('');
  const [showNewMaterial, setShowNewMaterial] = useState(false);

  // Form state for new material
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('MINERAL');
  const [handlingType, setHandlingType] = useState('GRANEL');
  const [bagWeight, setBagWeight] = useState('');
  const [isCritical, setIsCritical] = useState(false);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pendency resolution
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolutionText, setResolutionText] = useState('');

  // Big Bag config form state
  const [bagMatId, setBagMatId] = useState<string>('');
  const [bagLabel, setBagLabel] = useState('');
  const [bagUnitKg, setBagUnitKg] = useState('');
  const [bagReason, setBagReason] = useState('');
  const [bagSaving, setBagSaving] = useState(false);

  const handleSaveBagConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bagMatId || !bagLabel.trim() || !bagUnitKg) return;
    setBagSaving(true);
    try {
      await apiFetch('/api/bag-configs', {
        method: 'POST',
        body: JSON.stringify({
          materialId: Number(bagMatId),
          packagingLabel: bagLabel.trim(),
          unitWeightKg: Number(bagUnitKg),
          validationStatus: 'VALIDADO',
          isDefault: false,
          reason: bagReason.trim() || 'Cadastro de configuração de peso Big Bag',
        }),
      });
      setBagLabel('');
      setBagUnitKg('');
      setBagReason('');
      await onReload();
    } finally {
      setBagSaving(false);
    }
  };

  const handleValidateBagConfig = async (cfg: MaterialBagConfigItem) => {
    await apiFetch('/api/bag-configs', {
      method: 'POST',
      body: JSON.stringify({
        id: cfg.id,
        materialId: cfg.materialId,
        packagingLabel: cfg.packagingLabel,
        unitWeightKg: cfg.unitWeightKg,
        validationStatus: 'VALIDADO',
        isDefault: cfg.isDefault,
        reason: `Peso unitário ${cfg.unitWeightKg} kg homologado oficialmente`,
      }),
    });
    await onReload();
  };

  const handleCreateMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiFetch('/api/materials', {
        method: 'POST',
        body: JSON.stringify({
          code,
          description,
          category,
          handlingType,
          referenceBagWeightKg: bagWeight || null,
          bagWeightValidationStatus: bagWeight ? 'PENDENTE_VALIDACAO' : 'NAO_APLICAVEL',
          isCritical,
          notes: notes || null,
        }),
      });
      setCode('');
      setDescription('');
      setBagWeight('');
      setNotes('');
      setShowNewMaterial(false);
      await onReload();
    } catch (err: any) {
      setFormError(err.message || 'Erro ao cadastrar matéria-prima.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleRule = async (rule: TransferRuleItem) => {
    const nextActive = !rule.isActive;
    await apiFetch(`/api/transfer-rules/${rule.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        isActive: nextActive,
        validationStatus: nextActive ? 'VALIDADO' : rule.validationStatus,
        reason: nextActive
          ? `Regra Silo ${rule.originSiloNumber} -> Silo ${rule.destinationSiloNumber} homologada`
          : 'Regra desativada pela supervisão',
      }),
    });
    await onReload();
  };

  const handleResolvePendency = async (id: number) => {
    if (!resolutionText.trim() || resolutionText.trim().length < 5) return;
    await apiFetch(`/api/pendencies/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolutionNotes: resolutionText.trim() }),
    });
    setResolvingId(null);
    setResolutionText('');
    await onReload();
  };

  const q = search.trim().toLowerCase();

  return (
    <div className="space-y-5">
      {/* Segmented Tabs + Search */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-1">
          {[
            { id: 'silos' as TabId, label: `Silos — Ordem Rubricagem (${silos.length})` },
            { id: 'materiais' as TabId, label: `Matérias-Primas (${materials.length})` },
            { id: 'bags' as TabId, label: `Pesos Big Bags (${bagConfigs.length})` },
            { id: 'matriz' as TabId, label: `Matriz de Transferências (${transferRules.length})` },
            {
              id: 'pendencias' as TabId,
              label: `Pendências (${pendencies.filter((p) => p.status === 'PENDENTE').length})`,
            },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`min-h-[40px] rounded-md px-3.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === t.id
                  ? 'bg-[#F5B91B] text-[#0A1421]'
                  : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#AEB8C5]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar registros..."
              className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] pl-9 pr-3 text-sm text-[#F4F6F8]"
            />
          </div>

          {activeTab === 'materiais' && canManageMaterials && (
            <button
              type="button"
              onClick={() => setShowNewMaterial((v) => !v)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 py-2 text-xs font-bold text-[#0A1421] whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>Nova Matéria-Prima</span>
            </button>
          )}
        </div>
      </div>

      {/* Tab 1: Silos na sequência exata da rubricagem */}
      {activeTab === 'silos' && (
        <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="mb-3 text-xs text-[#AEB8C5]">
            Sequência preservada conforme folha de rubricagem oficial (sem ordenação numérica e sem
            silos 27/30).
          </p>
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[#AEB8C5]/15 text-xs text-[#AEB8C5]">
                <th className="py-2.5 pr-3">Ordem</th>
                <th className="px-3 py-2.5">Silo</th>
                <th className="px-3 py-2.5">Grupo / Linha</th>
                <th className="px-3 py-2.5">Código</th>
                <th className="px-3 py-2.5">Matéria-Prima</th>
                <th className="px-3 py-2.5 text-right">Cap. Nominal</th>
                <th className="px-3 py-2.5 text-right">Cap. Segura (-10%)</th>
                <th className="px-3 py-2.5 text-right">Confirmado</th>
                <th className="pl-3 py-2.5">Validação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#AEB8C5]/10">
              {silos
                .filter(
                  (s) =>
                    !q ||
                    String(s.siloNumber).includes(q) ||
                    (s.materialDescription || '').toLowerCase().includes(q) ||
                    (s.materialCode || '').toLowerCase().includes(q)
                )
                .map((s) => (
                  <tr key={s.id} className="hover:bg-[#152336]/60">
                    <td className="py-2.5 pr-3 font-mono-tabular text-[#AEB8C5]">
                      #{s.rubricOrder}
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular font-bold text-[#F4F6F8]">
                      Silo {s.siloNumber}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#AEB8C5]">
                      {s.category} · {s.lineCode} ({s.controlOwner})
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular text-[#F5B91B]">
                      {s.materialCode || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-[#F4F6F8]">
                      {s.materialDescription || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono-tabular text-[#AEB8C5]">
                      {formatKg(s.nominalCapacityKg)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono-tabular font-semibold text-[#F4F6F8]">
                      {formatKg(s.safeCapacityKg)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono-tabular">
                      <span
                        className={`inline-flex items-center justify-end gap-1.5 font-semibold ${
                          s.stockAlertLevel === 'CRITICO'
                            ? 'text-red-400'
                            : s.stockAlertLevel === 'ATENCAO'
                              ? 'text-orange-400'
                              : 'text-emerald-400'
                        }`}
                        title={s.stockAlertReason || undefined}
                      >
                        {s.stockAlertLevel && s.stockAlertLevel !== 'NORMAL' && (
                          <span className="relative flex h-2 w-2 items-center justify-center">
                            <span
                              className={`absolute inline-flex h-full w-full rounded-full ${
                                s.stockAlertLevel === 'CRITICO'
                                  ? 'bg-red-500 nexo-beacon-ring-red'
                                  : 'bg-orange-400 nexo-beacon-ring-orange'
                              }`}
                            />
                            <span
                              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                                s.stockAlertLevel === 'CRITICO' ? 'bg-red-500' : 'bg-orange-400'
                              }`}
                            />
                          </span>
                        )}
                        {formatKg(s.confirmedStockKg)}
                      </span>
                    </td>
                    <td className="pl-3 py-2.5 text-xs">
                      {s.validationStatus === 'PENDENTE_VALIDACAO' ? (
                        <span className="text-[#F5B91B]">Pendente</span>
                      ) : (
                        <span className="text-emerald-400">Validado</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Matérias-Primas */}
      {activeTab === 'materiais' && (
        <div className="space-y-4">
          {showNewMaterial && canManageMaterials && (
            <form
              onSubmit={handleCreateMaterial}
              className="rounded-xl border border-[#F5B91B]/40 bg-[#152336] p-5 space-y-4"
            >
              <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                Cadastrar Matéria-Prima
              </h3>
              {formError && (
                <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-xs">
                  <span className="text-[#AEB8C5]">Código Oficial</span>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Ex.: 2017101021"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                  />
                </label>
                <label className="block text-xs sm:col-span-2">
                  <span className="text-[#AEB8C5]">Descrição</span>
                  <input
                    type="text"
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Ex.: CALCARIO CALCITICO"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-[#AEB8C5]">Categoria</span>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                  >
                    <option value="MINERAL">MINERAL</option>
                    <option value="PREMIX">PREMIX</option>
                    <option value="PROTEICO">PROTEICO</option>
                    <option value="ENERGETICO">ENERGETICO</option>
                    <option value="SAL">SAL</option>
                    <option value="OUTRO">OUTRO</option>
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="text-[#AEB8C5]">Manuseio</span>
                  <select
                    value={handlingType}
                    onChange={(e) => setHandlingType(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                  >
                    <option value="GRANEL">GRANEL</option>
                    <option value="BIG_BAG">BIG_BAG</option>
                    <option value="GRANEL_E_BAG">GRANEL_E_BAG</option>
                    <option value="SACO">SACO</option>
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="text-[#AEB8C5]">Peso Ref. Bag (kg)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={bagWeight}
                    onChange={(e) => setBagWeight(e.target.value)}
                    placeholder="Opcional"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                  />
                </label>
                <label className="block text-xs sm:col-span-2">
                  <span className="text-[#AEB8C5]">Observações Operacionais</span>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex min-h-[44px] items-center gap-2 text-xs text-[#F4F6F8]">
                  <input
                    type="checkbox"
                    checked={isCritical}
                    onChange={(e) => setIsCritical(e.target.checked)}
                    className="h-4 w-4 accent-[#F5B91B]"
                  />
                  <span>Matéria-prima crítica (requer duplo check RQ-REC-042)</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNewMaterial(false)}
                    className="min-h-[44px] rounded-lg border border-[#AEB8C5]/30 px-4 text-xs font-medium text-[#F4F6F8]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[44px] rounded-lg bg-[#F5B91B] px-5 text-xs font-bold text-[#0A1421]"
                  >
                    {submitting ? 'Salvando...' : 'Salvar Cadastro'}
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-[#AEB8C5]/15 text-xs text-[#AEB8C5]">
                  <th className="py-2.5 pr-3">Código</th>
                  <th className="px-3 py-2.5">Descrição</th>
                  <th className="px-3 py-2.5">Categoria</th>
                  <th className="px-3 py-2.5">Manuseio</th>
                  <th className="px-3 py-2.5 text-right">Peso Ref. Bag</th>
                  <th className="pl-3 py-2.5">Status / Notas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#AEB8C5]/10">
                {materials
                  .filter(
                    (m) =>
                      !q ||
                      m.code.toLowerCase().includes(q) ||
                      m.description.toLowerCase().includes(q)
                  )
                  .map((m) => (
                    <tr key={m.id} className="hover:bg-[#152336]/60">
                      <td className="py-2.5 pr-3 font-mono-tabular font-bold text-[#F5B91B]">
                        {m.code}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-[#F4F6F8]">
                        {m.description}
                        {m.isCritical && (
                          <span className="ml-2 text-xs font-bold text-red-400">· CRÍTICA</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[#AEB8C5]">{m.category}</td>
                      <td className="px-3 py-2.5 text-xs text-[#AEB8C5]">{m.handlingType}</td>
                      <td className="px-3 py-2.5 text-right font-mono-tabular">
                        {m.referenceBagWeightKg ? (
                          <span
                            className={
                              m.bagWeightValidationStatus === 'PENDENTE_VALIDACAO'
                                ? 'text-[#F5B91B]'
                                : 'text-[#F4F6F8]'
                            }
                          >
                            {Number(m.referenceBagWeightKg)} kg
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="pl-3 py-2.5 text-xs text-[#AEB8C5]">
                        {m.notes || 'Cadastro ativo'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Matriz de Transferências */}
      {activeTab === 'matriz' && (
        <div className="overflow-x-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
          <p className="mb-3 text-xs text-[#AEB8C5]">
            Apenas rotas validadas e ativas podem ser executadas. Regras anotadas em caderno
            permanecem bloqueadas até aprovação formal da supervisão.
          </p>
          <table className="w-full text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-[#AEB8C5]/15 text-xs text-[#AEB8C5]">
                <th className="py-2.5 pr-3">Origem</th>
                <th className="px-3 py-2.5">Destino</th>
                <th className="px-3 py-2.5">Matéria-Prima</th>
                <th className="px-3 py-2.5">Referência / Origem</th>
                <th className="px-3 py-2.5">Situação</th>
                {canManageRules && <th className="pl-3 py-2.5 text-right">Ação</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#AEB8C5]/10">
              {transferRules.map((r) => (
                <tr key={r.id} className="hover:bg-[#152336]/60">
                  <td className="py-3 pr-3 font-mono-tabular font-bold text-[#F4F6F8]">
                    Silo {r.originSiloNumber}
                  </td>
                  <td className="px-3 py-3 font-mono-tabular font-bold text-[#3B82F6]">
                    Silo {r.destinationSiloNumber}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-mono-tabular text-[#F5B91B]">{r.materialCode}</span> ·{' '}
                    {r.materialDescription}
                  </td>
                  <td className="px-3 py-3 text-xs text-[#AEB8C5]">{r.sourceReference || '—'}</td>
                  <td className="px-3 py-3 text-xs">
                    {r.isActive && r.validationStatus === 'VALIDADO' ? (
                      <span className="font-semibold text-emerald-400">ATIVA · VALIDADA</span>
                    ) : (
                      <span className="font-semibold text-[#F5B91B]">
                        BLOQUEADA · {r.validationStatus}
                      </span>
                    )}
                  </td>
                  {canManageRules && (
                    <td className="pl-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(r)}
                        className="min-h-[38px] rounded-lg border border-[#AEB8C5]/30 px-3 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
                      >
                        {r.isActive ? 'Desativar' : 'Homologar e Ativar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: Pendências Documentais */}
      {activeTab === 'pendencias' && (
        <div className="space-y-3">
          {pendencies.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs">
                    {p.status === 'PENDENTE' ? (
                      <AlertTriangle className="h-4 w-4 text-[#F5B91B]" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    )}
                    <span className="font-mono-tabular font-bold text-[#F5B91B]">{p.entityRef}</span>
                    <span className="text-[#AEB8C5]">· {p.entityType}</span>
                  </div>
                  <h4 className="mt-1 font-display text-base font-bold text-[#F4F6F8]">
                    {p.title}
                  </h4>
                  <p className="mt-1 text-sm text-[#AEB8C5]">{p.description}</p>
                </div>

                <span
                  className={`text-xs font-bold ${
                    p.status === 'PENDENTE' ? 'text-[#F5B91B]' : 'text-emerald-400'
                  }`}
                >
                  {p.status}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 border-t border-[#AEB8C5]/15 pt-3 text-xs sm:grid-cols-2">
                <div className="rounded-lg bg-[#0A1421] p-3">
                  <p className="font-semibold text-[#F4F6F8]">Fonte A</p>
                  <p className="mt-1 text-[#AEB8C5]">{p.sourceA}</p>
                </div>
                <div className="rounded-lg bg-[#0A1421] p-3">
                  <p className="font-semibold text-[#F4F6F8]">Fonte B</p>
                  <p className="mt-1 text-[#AEB8C5]">{p.sourceB}</p>
                </div>
              </div>

              {p.status === 'RESOLVIDO' && p.resolutionNotes && (
                <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
                  <strong>Decisão oficial:</strong> {p.resolutionNotes}
                </div>
              )}

              {p.status === 'PENDENTE' && canResolvePendencies && (
                <div className="mt-3">
                  {resolvingId === p.id ? (
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={resolutionText}
                        onChange={(e) => setResolutionText(e.target.value)}
                        placeholder="Informe a confirmação oficial com base na planta/documentação..."
                        className="min-h-[44px] flex-1 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                      />
                      <button
                        type="button"
                        onClick={() => handleResolvePendency(p.id)}
                        className="min-h-[44px] rounded-lg bg-[#F5B91B] px-4 text-xs font-bold text-[#0A1421]"
                      >
                        Confirmar Validação
                      </button>
                      <button
                        type="button"
                        onClick={() => setResolvingId(null)}
                        className="min-h-[44px] rounded-lg border border-[#AEB8C5]/30 px-3 text-xs text-[#AEB8C5]"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setResolvingId(p.id);
                        setResolutionText('');
                      }}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[#F5B91B]/50 px-3.5 text-xs font-semibold text-[#F5B91B] hover:bg-[#F5B91B]/10"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      <span>Registrar Validação Oficial</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tab: Pesos de Big Bags configuráveis por produto/embalagem */}
      {activeTab === 'bags' && (
        <div className="space-y-4">
          {canManageMaterials && (
            <form
              onSubmit={handleSaveBagConfig}
              className="grid grid-cols-1 gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:grid-cols-2 lg:grid-cols-5"
            >
              <select
                required
                value={bagMatId}
                onChange={(e) => setBagMatId(e.target.value)}
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              >
                <option value="">Matéria-prima...</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.code} — {m.description}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                value={bagLabel}
                onChange={(e) => setBagLabel(e.target.value)}
                placeholder="Embalagem (ex.: Bag 1.300 kg)"
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              />
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={bagUnitKg}
                onChange={(e) => setBagUnitKg(e.target.value)}
                placeholder="Peso unitário (kg)"
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
              />
              <input
                type="text"
                value={bagReason}
                onChange={(e) => setBagReason(e.target.value)}
                placeholder="Motivo / Referência"
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]"
              />
              <button
                type="submit"
                disabled={bagSaving}
                className="min-h-[44px] rounded-lg bg-[#F5B91B] px-4 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
              >
                {bagSaving ? 'Salvando...' : 'Salvar Embalagem'}
              </button>
            </form>
          )}

          <div className="space-y-3">
            {bagConfigs
              .filter(
                (b) =>
                  !q ||
                  b.materialCode.toLowerCase().includes(q) ||
                  b.materialDescription.toLowerCase().includes(q) ||
                  b.packagingLabel.toLowerCase().includes(q)
              )
              .map((b) => (
                <div
                  key={b.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4"
                >
                  <div>
                    <p className="text-sm font-bold text-[#F4F6F8]">
                      <span className="font-mono-tabular text-[#F5B91B]">{b.materialCode}</span> ·{' '}
                      {b.materialDescription}
                    </p>
                    <p className="mt-1 text-xs text-[#AEB8C5]">
                      {b.packagingLabel} · Peso unitário:{' '}
                      <span className="font-mono-tabular font-bold text-[#F4F6F8]">
                        {formatKg(b.unitWeightKg)}
                      </span>{' '}
                      ·{' '}
                      <span
                        className={
                          b.validationStatus === 'VALIDADO'
                            ? 'font-semibold text-emerald-400'
                            : 'font-semibold text-[#F5B91B]'
                        }
                      >
                        {b.validationStatus}
                      </span>
                    </p>
                    {b.notes && <p className="mt-0.5 text-[11px] text-[#AEB8C5]/80">{b.notes}</p>}
                  </div>

                  {canManageMaterials && b.validationStatus !== 'VALIDADO' && (
                    <button
                      type="button"
                      onClick={() => handleValidateBagConfig(b)}
                      className="min-h-[40px] rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Homologar Peso Oficial
                    </button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
