import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  Package,
  Paperclip,
  Plus,
  RefreshCw,
  Scale,
  Sparkles,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import {
  CompatibleSiloOption,
  LotHistoryResponse,
  MaterialBagConfigItem,
  MaterialItem,
  ReceiptAttachmentItem,
  ReceiptItem,
  SessionData,
  SupplierItem,
} from '../types/nexo.ts';
import { apiFetch, formatKg } from '../lib/api.ts';
import {
  LabelScannerWidget,
  ScannedLabelCandidate,
} from '../components/labels/LabelScannerWidget.tsx';
import { ExperienceMode } from '../lib/experience-modes.ts';

interface ReceivingPageProps {
  initialTab?: 'novo' | 'pendentes' | 'historico';
  initialWizardStep?: number;
  experienceMode?: ExperienceMode;
  session: SessionData;
  materials: MaterialItem[];
  suppliers: SupplierItem[];
  bagConfigs: MaterialBagConfigItem[];
  canExecute: boolean;
  preselectedSiloId?: number | null;
  onReloadWorkspace: () => Promise<void>;
}

interface DistributionLine {
  siloId: number;
  quantityKg: string;
}

const FLOW_STEPS = [
  { title: 'IDENTIFICAR CARGA', instruction: 'Escolha se a carga veio a granel ou em big bag e informe o fornecedor.' },
  { title: 'CONFERIR MATERIAL', instruction: 'Leia a etiqueta ou escolha a matéria-prima e confira o número do lote.' },
  { title: 'SELECIONAR SILO', instruction: 'Toque nos silos disponíveis onde este material será descarregado.' },
  { title: 'INFORMAR QUANTIDADE', instruction: 'Digite o peso recebido (ou quantidade de bags) e confira o total por silo.' },
  { title: 'REVISAR', instruction: 'Confira todos os dados com calma antes de gravar no sistema.' },
  { title: 'CONFIRMAR', instruction: 'Toque no botão abaixo para confirmar e atualizar o estoque dos silos.' },
];

const MAX_CLIENT_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_CLIENT_ATTACHMENTS = 6;
const ATTACHMENT_KIND_LABELS: Record<ReceiptAttachmentItem['kind'], string> = {
  FOTO_CARGA: 'Foto da Carga / Etiqueta',
  NOTA_FISCAL: 'Nota Fiscal (NF)',
  TICKET_BALANCA: 'Ticket de Balança',
  DOCUMENTO: 'Outro Documento',
};

export const ReceivingPage: React.FC<ReceivingPageProps> = ({
  initialTab = 'novo',
  initialWizardStep = 0,
  experienceMode = 'OPERACIONAL',
  session,
  materials,
  suppliers,
  bagConfigs,
  canExecute,
  preselectedSiloId,
  onReloadWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<'novo' | 'pendentes' | 'historico'>(initialTab);
  const [wizardMode, setWizardMode] = useState<boolean>(true);
  const [wizardStep, setWizardStep] = useState<number>(initialWizardStep);
  const [showMoreInfo, setShowMoreInfo] = useState<boolean>(false);
  const [stepValidationError, setStepValidationError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(true);

  // Active Complement / Partial Discharge Mode
  const [complementReceipt, setComplementReceipt] = useState<ReceiptItem | null>(null);

  // Form fields (Section 2)
  const [materialId, setMaterialId] = useState<number | ''>('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [entryDate, setEntryDate] = useState(session.shift.operationalDate);
  const [receivingType, setReceivingType] = useState<'GRANEL' | 'BIG_BAG'>('GRANEL');
  const [receivedQuantityKg, setReceivedQuantityKg] = useState('');
  const [bagCount, setBagCount] = useState('');
  const [selectedBagConfigId, setSelectedBagConfigId] = useState<string>('');
  const [bagUnitWeightKg, setBagUnitWeightKg] = useState('');
  const [receivingPoint, setReceivingPoint] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [driverName, setDriverName] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [executedByOther, setExecutedByOther] = useState(false);
  const [executedByName, setExecutedByName] = useState('');
  const [executedByBadge, setExecutedByBadge] = useState('');
  const [notes, setNotes] = useState('');
  const [allowDuplicateLot, setAllowDuplicateLot] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

  // Compatible silos & distribution lines
  const [compatibleSilos, setCompatibleSilos] = useState<CompatibleSiloOption[]>([]);
  const [loadingSilos, setLoadingSilos] = useState(false);
  const [distributions, setDistributions] = useState<DistributionLine[]>([]);

  // Lot duplication lookup
  const [lotAlert, setLotAlert] = useState<LotHistoryResponse | null>(null);
  const [lotFilterHistory, setLotFilterHistory] = useState('');

  // Advisory Gemini insight
  const [aiAdvice, setAiAdvice] = useState<{ summary: string; alerts: string[] } | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  // Submission feedback
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Photographs & Documents attached to receipt
  const [attachments, setAttachments] = useState<ReceiptAttachmentItem[]>([]);
  const [attachmentKind, setAttachmentKind] = useState<ReceiptAttachmentItem['kind']>('FOTO_CARGA');
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<ReceiptAttachmentItem | null>(null);
  const cameraPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setWizardStep(initialWizardStep);
    setStepValidationError(null);
  }, [initialWizardStep]);

  useEffect(() => {
    if (experienceMode === 'OPERACIONAL') {
      setWizardMode(true);
    }
  }, [experienceMode]);

  const loadReceipts = useCallback(async () => {
    setLoadingReceipts(true);
    try {
      const data = await apiFetch<ReceiptItem[]>('/api/receipts');
      setReceipts(data);
    } catch (err) {
      console.error('Failed to load receipts:', err);
    } finally {
      setLoadingReceipts(false);
    }
  }, []);

  useEffect(() => {
    loadReceipts();
  }, [loadReceipts]);

  const selectedMaterial = useMemo(
    () => materials.find((m) => m.id === Number(materialId)) || null,
    [materials, materialId]
  );

  const materialBagOptions = useMemo(
    () => bagConfigs.filter((b) => b.materialId === Number(materialId)),
    [bagConfigs, materialId]
  );

  // Auto-select default bag weight & compatible silos when material changes
  useEffect(() => {
    const activeMatId = complementReceipt ? complementReceipt.materialId : Number(materialId);
    if (!activeMatId) {
      setCompatibleSilos([]);
      return;
    }

    if (!complementReceipt) {
      const cfgs = bagConfigs.filter((b) => b.materialId === activeMatId);
      const def = cfgs.find((c) => c.isDefault) || cfgs[0];
      if (def) {
        setSelectedBagConfigId(String(def.id));
        setBagUnitWeightKg(String(def.unitWeightKg));
      } else {
        setSelectedBagConfigId('');
        const mat = materials.find((m) => m.id === activeMatId);
        setBagUnitWeightKg(mat?.referenceBagWeightKg ? String(Number(mat.referenceBagWeightKg)) : '');
      }
      if (selectedMaterial?.handlingType === 'BIG_BAG') {
        setReceivingType('BIG_BAG');
      }
    }

    setLoadingSilos(true);
    apiFetch<CompatibleSiloOption[]>(`/api/materials/${activeMatId}/compatible-silos`)
      .then((list) => {
        setCompatibleSilos(list);
        if (preselectedSiloId && list.some((s) => s.id === preselectedSiloId)) {
          setDistributions([{ siloId: preselectedSiloId, quantityKg: '' }]);
        } else {
          setDistributions([]);
        }
      })
      .catch(() => setCompatibleSilos([]))
      .finally(() => setLoadingSilos(false));
  }, [materialId, complementReceipt, bagConfigs, materials, preselectedSiloId, selectedMaterial?.handlingType]);

  // Calculate effective received kg
  const computedTotalKg = useMemo(() => {
    if (complementReceipt) return complementReceipt.remainingQuantityKg;
    if (receivingType === 'BIG_BAG') {
      const count = Number(bagCount || 0);
      const unit = Number(bagUnitWeightKg || 0);
      return count > 0 && unit > 0 ? Math.round(count * unit * 1000) / 1000 : 0;
    }
    const q = Number(receivedQuantityKg || 0);
    return Number.isFinite(q) && q > 0 ? q : 0;
  }, [complementReceipt, receivingType, bagCount, bagUnitWeightKg, receivedQuantityKg]);

  const totalAllocatedKg = useMemo(
    () =>
      distributions.reduce((acc, d) => {
        const v = Number(d.quantityKg || 0);
        return acc + (Number.isFinite(v) && v > 0 ? v : 0);
      }, 0),
    [distributions]
  );

  const remainingAfterPlanKg = Math.max(
    0,
    Math.round((computedTotalKg - totalAllocatedKg) * 1000) / 1000
  );

  // Current visual step computation
  const currentFlowStep = useMemo(() => {
    if (wizardMode) return wizardStep;
    if (complementReceipt) {
      if (distributions.length === 0) return 2;
      if (totalAllocatedKg <= 0) return 3;
      return 5;
    }
    if (!supplierName.trim()) return 0;
    if (!materialId || !lotCode.trim()) return 1;
    if (distributions.length === 0) return 2;
    if (computedTotalKg <= 0) return 3;
    return 4;
  }, [wizardMode, wizardStep, complementReceipt, supplierName, materialId, lotCode, computedTotalKg, distributions.length, totalAllocatedKg]);

  const validateAndAdvanceStep = () => {
    setStepValidationError(null);
    if (wizardStep === 0 && !complementReceipt) {
      if (!supplierName.trim()) {
        setStepValidationError('Informe ou selecione o fornecedor antes de continuar.');
        return;
      }
      if (!entryDate) {
        setStepValidationError('Informe a data de entrada da carga.');
        return;
      }
    }
    if (wizardStep === 1 && !complementReceipt) {
      if (!materialId) {
        setStepValidationError('Selecione qual matéria-prima está sendo recebida.');
        return;
      }
      if (!lotCode.trim()) {
        setStepValidationError('Informe o número do lote ou leia a etiqueta antes de continuar.');
        return;
      }
      if (lotAlert?.hasMovements && !allowDuplicateLot) {
        setStepValidationError('Este lote já possui movimentação. Confirme o uso do lote ou continue o recebimento pendente.');
        return;
      }
    }
    if (wizardStep === 3 && !complementReceipt) {
      if (computedTotalKg <= 0) {
        setStepValidationError(
          receivingType === 'BIG_BAG'
            ? 'Informe a quantidade de bags e o peso unitário de cada bag.'
            : 'Informe o peso recebido em quilos (kg).'
        );
        return;
      }
      if (totalAllocatedKg > computedTotalKg + 0.001) {
        setStepValidationError('O peso distribuído nos silos não pode ser maior que o peso total recebido.');
        return;
      }
    }
    if (wizardStep === 3 && complementReceipt && totalAllocatedKg <= 0) {
      setStepValidationError('Informe quantos quilos está descarregando agora neste complemento.');
      return;
    }
    setWizardStep((s) => Math.min(FLOW_STEPS.length - 1, s + 1));
  };

  const handleWizardBack = () => {
    setStepValidationError(null);
    const minStep = complementReceipt ? 2 : 0;
    setWizardStep((s) => Math.max(minStep, s - 1));
  };

  const handleCheckLotManual = async () => {
    if (!lotCode.trim() || complementReceipt) return;
    try {
      const hist = await apiFetch<LotHistoryResponse>(
        `/api/lots/${encodeURIComponent(lotCode.trim())}/history${
          materialId ? `?materialId=${materialId}` : ''
        }`
      );
      setLotAlert(hist.hasMovements ? hist : null);
    } catch {
      setLotAlert(null);
    }
  };

  const handleApplyScannedLabel = (
    cand: ScannedLabelCandidate,
    mode: 'NEW' | 'COMPLEMENT',
    existingReceiptId?: number
  ) => {
    setSubmitError(null);
    setSubmitSuccess(null);

    if (mode === 'COMPLEMENT' && existingReceiptId) {
      const found = receipts.find((r) => r.id === existingReceiptId);
      if (found) {
        setComplementReceipt(found);
        setActiveTab('novo');
        setWizardStep(2);
        return;
      }
    }

    setComplementReceipt(null);
    if (cand.materialId) setMaterialId(cand.materialId);
    if (cand.lotCode) setLotCode(cand.lotCode);
    if (cand.supplierName) setSupplierName(cand.supplierName);
    if (cand.bagCount) {
      setReceivingType('BIG_BAG');
      setBagCount(String(cand.bagCount));
      if (cand.weightKg && cand.bagCount > 0) {
        const unitKg = Math.round((cand.weightKg / cand.bagCount) * 1000) / 1000;
        if (unitKg > 0) {
          setBagUnitWeightKg(String(unitKg));
        }
      }
    } else if (cand.weightKg) {
      setReceivingType('GRANEL');
      setReceivedQuantityKg(String(cand.weightKg));
    }
    if (mode === 'COMPLEMENT') {
      setAllowDuplicateLot(true);
    }
    if (cand.lotHistory?.hasMovements) {
      setLotAlert(cand.lotHistory);
    }

    if (
      cand.previewDataUrl &&
      /^data:(image\/(?:jpeg|jpg|png|webp|heic|heif));base64,/i.test(cand.previewDataUrl)
    ) {
      const mimeMatch = /^data:([^;]+);base64,/i.exec(cand.previewDataUrl);
      const mimeType = (mimeMatch?.[1] || 'image/jpeg').toLowerCase();
      const approxBytes = Math.floor((cand.previewDataUrl.split(',')[1]?.length || 0) * 0.75);
      if (approxBytes > 0 && approxBytes <= MAX_CLIENT_ATTACHMENT_BYTES) {
        setAttachments((prev) => {
          if (prev.length >= MAX_CLIENT_ATTACHMENTS) return prev;
          if (prev.some((p) => p.dataUrl === cand.previewDataUrl)) return prev;
          return [
            ...prev,
            {
              id: `att-lbl-${Date.now()}`,
              name: `etiqueta-${cand.lotCode || cand.materialCode || 'captura'}.jpg`,
              mimeType,
              kind: 'FOTO_CARGA',
              sizeBytes: approxBytes,
              dataUrl: cand.previewDataUrl!,
              capturedAtIso: new Date().toISOString(),
            },
          ];
        });
      }
    }
  };

  const handleAttachmentFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachmentError(null);

    const incoming = Array.from(files);
    if (attachments.length + incoming.length > MAX_CLIENT_ATTACHMENTS) {
      setAttachmentError(`Máximo de ${MAX_CLIENT_ATTACHMENTS} fotografias/documentos por recebimento.`);
      return;
    }

    const allowedMimes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'application/pdf',
    ]);

    for (const file of incoming) {
      const mime = (file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg')).toLowerCase();
      if (!allowedMimes.has(mime)) {
        setAttachmentError(`Formato não permitido em "${file.name}". Use imagem (JPG/PNG/WEBP/HEIC) ou PDF.`);
        continue;
      }
      if (file.size <= 0 || file.size > MAX_CLIENT_ATTACHMENT_BYTES) {
        setAttachmentError(`O arquivo "${file.name}" excede o limite de 4 MB.`);
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error(`Falha ao ler "${file.name}".`));
          reader.readAsDataURL(file);
        });
        setAttachments((prev) => {
          if (prev.length >= MAX_CLIENT_ATTACHMENTS) return prev;
          return [
            ...prev,
            {
              id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: file.name.slice(0, 120),
              mimeType: mime,
              kind: attachmentKind,
              sizeBytes: file.size,
              dataUrl,
              capturedAtIso: new Date().toISOString(),
            },
          ];
        });
      } catch (err: any) {
        setAttachmentError(err.message || 'Erro ao processar anexo.');
      }
    }
  };

  const removeAttachment = (attId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
  };

  const addDistributionSilo = (siloId: number) => {
    if (distributions.some((d) => d.siloId === siloId)) return;
    const silo = compatibleSilos.find((s) => s.id === siloId);
    if (!silo) return;
    const suggestedKg = Math.min(remainingAfterPlanKg, silo.availableSpaceKg);
    setDistributions((prev) => [
      ...prev,
      {
        siloId,
        quantityKg: suggestedKg > 0 ? String(suggestedKg) : '',
      },
    ]);
  };

  const updateDistributionQty = (siloId: number, val: string) => {
    setDistributions((prev) =>
      prev.map((d) => (d.siloId === siloId ? { ...d, quantityKg: val } : d))
    );
  };

  const removeDistributionSilo = (siloId: number) => {
    setDistributions((prev) => prev.filter((d) => d.siloId !== siloId));
  };

  const handleRequestAiAdvice = async () => {
    setLoadingAi(true);
    setAiAdvice(null);
    try {
      const advice = await apiFetch<{ summary: string; alerts: string[] }>(
        '/api/ai/operational-advice',
        {
          method: 'POST',
          body: JSON.stringify({
            situationTitle: complementReceipt
              ? `Complemento do recebimento ${complementReceipt.receiptNumber}`
              : 'Conferência de recebimento e rateio entre silos',
            deterministicFacts: {
              material: complementReceipt?.materialDescription || selectedMaterial?.description,
              lote: complementReceipt?.lotCode || lotCode,
              quantidadeTotalKg: computedTotalKg,
              quantidadeDistribuidaPlanoKg: totalAllocatedKg,
              restantePendenteKg: remainingAfterPlanKg,
              silosCompativeisAutorizados: compatibleSilos.map((s) => ({
                silo: s.siloNumber,
                situacao: s.operationalStatus,
                capacidadeSeguraKg: s.safeCapacityKg,
                saldoAtualKg: s.confirmedStockKg,
                espacoLivreKg: s.availableSpaceKg,
              })),
            },
          }),
        }
      );
      setAiAdvice(advice);
    } catch (err: any) {
      setSubmitError(err.message || 'Falha ao consultar análise Gemini.');
    } finally {
      setLoadingAi(false);
    }
  };

  const handleConfirmOperation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canExecute) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const validDists = distributions
        .map((d) => ({
          siloId: d.siloId,
          quantityKg: Number(d.quantityKg || 0),
        }))
        .filter((d) => d.quantityKg > 0);

      if (complementReceipt) {
        const res = await apiFetch<{ receipt: ReceiptItem; warnings: string[] }>(
          `/api/receipts/${complementReceipt.id}/distribute`,
          {
            method: 'POST',
            body: JSON.stringify({
              expectedVersion: complementReceipt.version,
              distributions: validDists,
              isComplement: true,
              notes: notes || null,
              executedByName: executedByOther ? executedByName.trim() || null : null,
              executedByBadge: executedByOther ? executedByBadge.trim() || null : null,
              attachments,
              idempotencyKey,
            }),
          }
        );
        setSubmitSuccess(
          `Complemento gravado no recebimento ${res.receipt.receiptNumber}. Situação: ${res.receipt.status}.`
        );
        setComplementReceipt(null);
      } else {
        if (!supplierName.trim()) {
          setSubmitError('Informe o fornecedor na Etapa 1 antes de confirmar o recebimento.');
          if (wizardMode) setWizardStep(0);
          setSubmitting(false);
          return;
        }
        const res = await apiFetch<{ receipt: ReceiptItem; warnings: string[] }>('/api/receipts', {
          method: 'POST',
          body: JSON.stringify({
            materialId: Number(materialId),
            supplierName,
            invoiceNumber: invoiceNumber || null,
            lotCode,
            entryDate,
            receivingType,
            receivedQuantityKg: receivingType === 'GRANEL' ? Number(receivedQuantityKg) : undefined,
            bagCount: receivingType === 'BIG_BAG' ? Number(bagCount) : null,
            bagUnitWeightKg: receivingType === 'BIG_BAG' ? Number(bagUnitWeightKg) : null,
            receivingPoint: receivingPoint || null,
            vehiclePlate: vehiclePlate.trim() ? vehiclePlate.trim().toUpperCase() : null,
            driverName: driverName.trim() || null,
            carrierName: carrierName.trim() || null,
            executedByName: executedByOther ? executedByName.trim() || null : null,
            executedByBadge: executedByOther ? executedByBadge.trim() || null : null,
            notes: notes || null,
            attachments,
            allowDuplicateLot,
            idempotencyKey,
            distributions: validDists,
          }),
        });
        setSubmitSuccess(
          `Recebimento ${res.receipt.receiptNumber} registrado (${res.receipt.status})! Saldos atualizados no banco PostgreSQL.`
        );
      }

      // Reset form & refresh data
      setLotCode('');
      setInvoiceNumber('');
      setReceivedQuantityKg('');
      setBagCount('');
      setReceivingPoint('');
      setVehiclePlate('');
      setDriverName('');
      setCarrierName('');
      setExecutedByOther(false);
      setExecutedByName('');
      setExecutedByBadge('');
      setNotes('');
      setAttachments([]);
      setAttachmentError(null);
      setDistributions([]);
      setLotAlert(null);
      setAllowDuplicateLot(false);
      setAiAdvice(null);
      setIdempotencyKey(`rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

      await Promise.all([loadReceipts(), onReloadWorkspace()]);
    } catch (err: any) {
      setSubmitError(err.message || 'Erro ao registrar recebimento.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingReceipts = receipts.filter(
    (r) => r.status === 'PENDENTE' || r.status === 'PARCIAL'
  );

  const filteredReceipts = receipts.filter((r) => {
    if (!lotFilterHistory.trim()) return true;
    const q = lotFilterHistory.trim().toLowerCase();
    return (
      r.lotCode.toLowerCase().includes(q) ||
      r.receiptNumber.toLowerCase().includes(q) ||
      r.materialDescription.toLowerCase().includes(q) ||
      r.supplierName.toLowerCase().includes(q)
    );
  });

  const statusStyle = (status: ReceiptItem['status']) => {
    if (status === 'CONCLUIDO') return 'text-emerald-400 border-emerald-500/35 bg-emerald-500/10';
    if (status === 'PARCIAL') return 'text-[#F5B91B] border-[#F5B91B]/35 bg-[#F5B91B]/10';
    if (status === 'CANCELADO') return 'text-red-400 border-red-500/35 bg-red-500/10';
    return 'text-orange-300 border-orange-500/35 bg-orange-500/10';
  };

  return (
    <div className="space-y-6">
      {/* Top Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-1">
          <button
            type="button"
            onClick={() => setActiveTab('novo')}
            className={`min-h-[42px] rounded-md px-4 text-xs font-bold transition-colors ${
              activeTab === 'novo'
                ? 'bg-[#F5B91B] text-[#0A1421]'
                : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            {complementReceipt
              ? `Continuar Descarga (${complementReceipt.receiptNumber})`
              : 'Novo Recebimento & Rateio'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pendentes')}
            className={`min-h-[42px] rounded-md px-4 text-xs font-bold transition-colors ${
              activeTab === 'pendentes'
                ? 'bg-[#F5B91B] text-[#0A1421]'
                : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            Descargas Pendentes ({pendingReceipts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('historico')}
            className={`min-h-[42px] rounded-md px-4 text-xs font-bold transition-colors ${
              activeTab === 'historico'
                ? 'bg-[#F5B91B] text-[#0A1421]'
                : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            Recebimentos Registrados ({receipts.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'novo' && (
            <button
              type="button"
              onClick={() => setWizardMode((v) => !v)}
              className="min-h-[44px] rounded-lg border border-[#3B82F6]/40 bg-[#0A1421] px-3.5 text-xs font-bold text-[#93C5FD] hover:border-[#F5B91B]"
            >
              {wizardMode ? 'Ver Formulário Completo' : 'Usar Fluxo Passo a Passo'}
            </button>
          )}
          <button
            type="button"
            onClick={loadReceipts}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 text-xs font-medium text-[#F4F6F8] hover:border-[#F5B91B]/50"
          >
            <RefreshCw className={`h-4 w-4 ${loadingReceipts ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      {!canExecute && (
        <div className="rounded-xl border border-orange-500/35 bg-orange-500/10 p-4 text-xs text-orange-200">
          Seu perfil atual permite apenas consulta de recebimentos e lotes. Apenas Operador Moega, Supervisor e Administrador podem registrar entradas e rateios.
        </div>
      )}

      {submitSuccess && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-4 text-sm text-emerald-100">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
          <span>{submitSuccess}</span>
        </div>
      )}

      {submitError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/45 bg-red-500/15 p-4 text-sm text-red-100">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <span>{submitError}</span>
        </div>
      )}

      {/* TAB 1: NOVO RECEBIMENTO / COMPLEMENTO */}
      {activeTab === 'novo' && (
        <div className="space-y-6">
          {/* Fluxo Visual Passo a Passo */}
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                ETAPA {currentFlowStep + 1} DE {FLOW_STEPS.length} — {FLOW_STEPS[currentFlowStep].title}
              </p>
              <span className="font-mono-tabular text-xs font-semibold text-[#AEB8C5]">
                {Math.round(((currentFlowStep + 1) / FLOW_STEPS.length) * 100)}% concluído
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#0A1421]">
              <div
                className="h-full rounded-full bg-[#F5B91B] transition-all duration-300"
                style={{ width: `${Math.round(((currentFlowStep + 1) / FLOW_STEPS.length) * 100)}%` }}
              />
            </div>
            <p className="text-sm font-medium text-[#F4F6F8]">
              {FLOW_STEPS[currentFlowStep].instruction}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {FLOW_STEPS.map((step, idx) => {
                const done = idx < currentFlowStep;
                const active = idx === currentFlowStep;
                return (
                  <button
                    key={step.title}
                    type="button"
                    disabled={!wizardMode || (complementReceipt ? idx < 2 : false)}
                    onClick={() => {
                      if (wizardMode && idx <= currentFlowStep) {
                        setStepValidationError(null);
                        setWizardStep(idx);
                      }
                    }}
                    className={`rounded-lg border px-3 py-2 text-left text-[11px] font-bold transition-colors disabled:cursor-default ${
                      active
                        ? 'border-[#F5B91B] bg-[#F5B91B]/15 text-[#F5B91B]'
                        : done
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400'
                          : 'border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]/60'
                    }`}
                  >
                    <span className="font-mono-tabular mr-1.5">{idx + 1}.</span>
                    <span>{step.title}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {stepValidationError && (
            <div className="flex items-center gap-3 rounded-xl border border-[#F5B91B]/50 bg-[#F5B91B]/10 p-4 text-sm text-[#F5B91B]">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>{stepValidationError}</span>
            </div>
          )}

          {/* Scanner de Etiquetas (Etapa 2 no modo guiado ou sempre visível no modo completo) */}
          {canExecute && !complementReceipt && (!wizardMode || wizardStep === 1) && (
            <LabelScannerWidget
              materials={materials}
              onApplyCandidate={handleApplyScannedLabel}
              onConsultHistory={(lot) => {
                setLotFilterHistory(lot);
                setActiveTab('historico');
              }}
            />
          )}

          {/* Banner de Complemento de Descarga Parcial */}
          {complementReceipt && (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#F5B91B]/45 bg-[#F5B91B]/10 p-4">
              <div>
                <p className="text-xs font-bold text-[#F5B91B]">
                  CONTINUAR DESCARGA PARCIAL / COMPLEMENTO
                </p>
                <p className="mt-1 text-sm font-bold text-[#F4F6F8]">
                  {complementReceipt.receiptNumber} · {complementReceipt.materialCode} —{' '}
                  {complementReceipt.materialDescription} · Lote {complementReceipt.lotCode}
                </p>
                <p className="mt-1 font-mono-tabular text-xs text-[#AEB8C5]">
                  Recebido: {formatKg(complementReceipt.receivedQuantityKg)} · Já distribuído:{' '}
                  {formatKg(complementReceipt.distributedQuantityKg)} · Saldo Pendente:{' '}
                  <span className="font-bold text-[#F5B91B]">
                    {formatKg(complementReceipt.remainingQuantityKg)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setComplementReceipt(null);
                  setWizardStep(0);
                }}
                className="min-h-[40px] rounded-lg border border-[#AEB8C5]/30 bg-[#0A1421] px-4 text-xs font-semibold text-[#F4F6F8]"
              >
                Cancelar Complemento
              </button>
            </div>
          )}

          {/* Formulário Principal / Wizard por Etapas */}
          <form onSubmit={handleConfirmOperation} className="space-y-6">
            {!complementReceipt && (!wizardMode || wizardStep === 0 || wizardStep === 1) && (
              <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
                  <div className="flex items-center gap-2.5">
                    <Truck className="h-5 w-5 text-[#F5B91B]" />
                    <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                      {wizardMode && wizardStep === 0
                        ? 'Etapa 1 — Identificar Carga e Fornecedor'
                        : wizardMode && wizardStep === 1
                          ? 'Etapa 2 — Conferir Matéria-Prima e Lote'
                          : `Dados do Recebimento · Turno (${session.shift.shiftName})`}
                    </h3>
                  </div>

                  {/* Granel vs Big Bag Switcher */}
                  <div className="flex rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] p-1">
                    <button
                      type="button"
                      onClick={() => setReceivingType('GRANEL')}
                      className={`min-h-[38px] rounded-md px-4 text-xs font-bold ${
                        receivingType === 'GRANEL'
                          ? 'bg-[#3B82F6] text-white'
                          : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                      }`}
                    >
                      GRANEL
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceivingType('BIG_BAG')}
                      className={`min-h-[38px] rounded-md px-4 text-xs font-bold ${
                        receivingType === 'BIG_BAG'
                          ? 'bg-[#F5B91B] text-[#0A1421]'
                          : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                      }`}
                    >
                      BIG BAG
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(!wizardMode || wizardStep === 1) && (
                    <>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                          Matéria-Prima (Código + Descrição) *
                        </label>
                        <select
                          required={!wizardMode || wizardStep >= 1}
                          disabled={!canExecute}
                          value={materialId}
                          onChange={(e) => setMaterialId(e.target.value ? Number(e.target.value) : '')}
                          className="min-h-[48px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
                        >
                          <option value="">Selecione a matéria-prima...</option>
                          {materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code} — {m.description} ({m.handlingType})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                          Número do Lote *
                        </label>
                        <input
                          type="text"
                          required={!wizardMode || wizardStep >= 1}
                          disabled={!canExecute}
                          value={lotCode}
                          onChange={(e) => setLotCode(e.target.value.toUpperCase())}
                          onBlur={handleCheckLotManual}
                          placeholder="Ex.: 0011647908"
                          className="min-h-[48px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-sm text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
                        />
                      </div>
                    </>
                  )}

                  {(!wizardMode || wizardStep === 0) && (
                    <>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                          Fornecedor *
                        </label>
                        <input
                          type="text"
                          required
                          list="nexo-suppliers-list"
                          disabled={!canExecute}
                          value={supplierName}
                          onChange={(e) => setSupplierName(e.target.value.toUpperCase())}
                          placeholder="Selecione ou digite o fornecedor..."
                          className="min-h-[48px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8] focus:border-[#F5B91B] focus:outline-none"
                        />
                        <datalist id="nexo-suppliers-list">
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.name} />
                          ))}
                        </datalist>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                          Data de Entrada *
                        </label>
                        <input
                          type="date"
                          required
                          disabled={!canExecute}
                          value={entryDate}
                          onChange={(e) => setEntryDate(e.target.value)}
                          className="min-h-[48px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421]/70 px-3.5 py-2.5 text-xs">
                          <span className="text-[#AEB8C5]">
                            Lançamento automático em nome de:{' '}
                            <strong className="text-[#F4F6F8]">{session.user.displayName}</strong>
                            {session.user.badgeCode ? (
                              <span className="ml-1.5 font-mono-tabular text-[#F5B91B]">
                                · Matrícula {session.user.badgeCode}
                              </span>
                            ) : null}
                            <span className="ml-1.5 text-[#AEB8C5]">
                              · {session.shift.shiftName} ({session.shift.operationalDate})
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowMoreInfo((v) => !v)}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]/60"
                          >
                            {showMoreInfo ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            <span>Mais informações (Veículo, NF e Terceiro)</span>
                          </button>
                        </div>
                      </div>

                      {showMoreInfo && (
                        <>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                              Placa do Veículo / Carreta
                            </label>
                            <input
                              type="text"
                              disabled={!canExecute}
                              value={vehiclePlate}
                              onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                              placeholder="Ex.: ABC-1D23"
                              className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                              Motorista
                            </label>
                            <input
                              type="text"
                              disabled={!canExecute}
                              value={driverName}
                              onChange={(e) => setDriverName(e.target.value)}
                              placeholder="Nome do motorista"
                              className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                              Transportadora
                            </label>
                            <input
                              type="text"
                              disabled={!canExecute}
                              value={carrierName}
                              onChange={(e) => setCarrierName(e.target.value)}
                              placeholder="Empresa transportadora"
                              className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                              Nota Fiscal (NF)
                            </label>
                            <input
                              type="text"
                              disabled={!canExecute}
                              value={invoiceNumber}
                              onChange={(e) => setInvoiceNumber(e.target.value)}
                              placeholder="Quando disponível"
                              className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium text-[#AEB8C5]">
                              Cone / Ponto de Recebimento
                            </label>
                            <input
                              type="text"
                              disabled={!canExecute}
                              value={receivingPoint}
                              onChange={(e) => setReceivingPoint(e.target.value)}
                              placeholder="Ex.: Moega Central / Cone 2"
                              className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                            />
                          </div>

                          <div className="flex flex-col justify-end">
                            <label className="flex min-h-[46px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs text-[#F4F6F8]">
                              <input
                                type="checkbox"
                                checked={executedByOther}
                                onChange={(e) => setExecutedByOther(e.target.checked)}
                                className="h-4 w-4 accent-[#F5B91B]"
                              />
                              <span>Executado por outro operador</span>
                            </label>
                          </div>

                          {executedByOther && (
                            <>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-[#F5B91B]">
                                  Nome do Executor Físico
                                </label>
                                <input
                                  type="text"
                                  disabled={!canExecute}
                                  value={executedByName}
                                  onChange={(e) => setExecutedByName(e.target.value)}
                                  placeholder="Quem executou a descarga"
                                  className="min-h-[46px] w-full rounded-lg border border-[#F5B91B]/40 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-xs font-medium text-[#F5B91B]">
                                  Matrícula do Executor
                                </label>
                                <input
                                  type="text"
                                  disabled={!canExecute}
                                  value={executedByBadge}
                                  onChange={(e) => setExecutedByBadge(e.target.value)}
                                  placeholder="Matrícula"
                                  className="min-h-[46px] w-full rounded-lg border border-[#F5B91B]/40 bg-[#0A1421] px-3 font-mono-tabular text-sm text-[#F4F6F8]"
                                />
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>

                {/* Alerta de Lote Existente durante digitação manual */}
                {(!wizardMode || wizardStep === 1) && lotAlert?.hasMovements && (
                  <div className="space-y-2 rounded-xl border border-red-500/45 bg-red-950/30 p-4 text-xs">
                    <p className="font-bold text-red-200">
                      ATENÇÃO: ESTE LOTE ({lotAlert.lotCode}) JÁ POSSUI MOVIMENTAÇÕES REGISTRADAS.
                    </p>
                    <p className="text-red-100/80">
                      Original: {formatKg(lotAlert.totalOriginalKg)} · Distribuído:{' '}
                      {formatKg(lotAlert.totalDistributedKg)} · Restante:{' '}
                      {formatKg(lotAlert.totalRemainingKg)}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <label className="inline-flex items-center gap-2 rounded border border-[#F5B91B]/40 bg-[#0A1421] px-3 py-2 text-[#F5B91B]">
                        <input
                          type="checkbox"
                          checked={allowDuplicateLot}
                          onChange={(e) => setAllowDuplicateLot(e.target.checked)}
                          className="h-4 w-4 accent-[#F5B91B]"
                        />
                        <span>Confirmar novo registro / complemento legítimo para este lote</span>
                      </label>
                      {lotAlert.receipts.find((r) => r.remainingQuantityKg > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            const pending = lotAlert.receipts.find((r) => r.remainingQuantityKg > 0);
                            const full = receipts.find((r) => r.id === pending?.id);
                            if (full) {
                              setComplementReceipt(full);
                              setWizardStep(2);
                            }
                          }}
                          className="rounded bg-[#F5B91B] px-3 py-2 font-bold text-[#0A1421]"
                        >
                          Continuar Recebimento Pendente ({lotAlert.receipts[0]?.receiptNumber})
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {(!wizardMode || wizardStep === 0) && (
                  <div className="space-y-3 rounded-xl border border-[#3B82F6]/25 bg-[#0A1421]/85 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Paperclip className="h-4 w-4 text-[#60A5FA]" />
                        <span className="text-xs font-bold uppercase tracking-wider text-[#F4F6F8]">
                          Fotografias & Documentos da Carga (Opcional · até 6 anexos / 4 MB cada)
                        </span>
                      </div>
                      <span className="font-mono-tabular text-[11px] text-[#AEB8C5]">
                        {attachments.length}/{MAX_CLIENT_ATTACHMENTS} anexos
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <select
                        disabled={!canExecute}
                        value={attachmentKind}
                        onChange={(e) => setAttachmentKind(e.target.value as ReceiptAttachmentItem['kind'])}
                        className="min-h-[42px] rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                      >
                        {Object.entries(ATTACHMENT_KIND_LABELS).map(([k, lbl]) => (
                          <option key={k} value={k}>
                            {lbl}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        disabled={!canExecute || attachments.length >= MAX_CLIENT_ATTACHMENTS}
                        onClick={() => cameraPhotoInputRef.current?.click()}
                        className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-[#3B82F6]/45 bg-[#3B82F6]/15 px-3.5 text-xs font-bold text-[#93C5FD] hover:bg-[#3B82F6]/25 disabled:opacity-50"
                      >
                        <Camera className="h-4 w-4" />
                        <span>Fotografar (Câmera)</span>
                      </button>

                      <button
                        type="button"
                        disabled={!canExecute || attachments.length >= MAX_CLIENT_ATTACHMENTS}
                        onClick={() => docFileInputRef.current?.click()}
                        className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-[#AEB8C5]/30 bg-[#101B2A] px-3.5 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B] disabled:opacity-50"
                      >
                        <FileText className="h-4 w-4 text-[#F5B91B]" />
                        <span>Anexar Arquivo / PDF</span>
                      </button>
                    </div>

                    {attachmentError && (
                      <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        {attachmentError}
                      </p>
                    )}

                    {attachments.length > 0 && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {attachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] p-2.5 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() => setPreviewAttachment(att)}
                              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                            >
                              {att.mimeType === 'application/pdf' ? (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[#F5B91B]/40 bg-[#F5B91B]/10 text-[#F5B91B]">
                                  <FileText className="h-5 w-5" />
                                </div>
                              ) : (
                                <img
                                  src={att.dataUrl}
                                  alt={att.name}
                                  className="h-10 w-10 shrink-0 rounded border border-[#AEB8C5]/20 object-cover"
                                />
                              )}
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-[#F4F6F8]">{att.name}</p>
                                <p className="text-[11px] text-[#AEB8C5]">
                                  {ATTACHMENT_KIND_LABELS[att.kind]} · {Math.max(1, Math.round(att.sizeBytes / 1024))} KB
                                </p>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAttachment(att.id)}
                              aria-label="Remover anexo"
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-red-300 hover:bg-red-500/15"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ETAPA 4 (ou modo completo): PESO / QUANTIDADE */}
            {!complementReceipt && (!wizardMode || wizardStep === 3) && (
              <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-4">
                <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                  {wizardMode ? 'Etapa 4 — Informar Quantidade Recebida' : 'Quantidade Recebida'}
                </h3>
                {receivingType === 'GRANEL' ? (
                  <div className="grid grid-cols-1 gap-4 rounded-xl border border-[#3B82F6]/30 bg-[#0A1421] p-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[#60A5FA]">
                        Quantidade Recebida (kg) *
                      </label>
                      <input
                        type="number"
                        step="0.001"
                        min="0.001"
                        required
                        disabled={!canExecute}
                        value={receivedQuantityKg}
                        onChange={(e) => setReceivedQuantityKg(e.target.value)}
                        placeholder="Ex.: 38840"
                        className="min-h-[48px] w-full rounded-lg border border-[#3B82F6]/40 bg-[#101B2A] px-3 font-mono-tabular text-lg font-bold text-[#F4F6F8]"
                      />
                    </div>
                    <div className="flex flex-col justify-center">
                      <p className="text-xs text-[#AEB8C5]">Total Calculado para Distribuição</p>
                      <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-[#F4F6F8]">
                        {formatKg(computedTotalKg)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 rounded-xl border border-[#F5B91B]/35 bg-[#0A1421] p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-[#F5B91B]">
                      <Package className="h-4 w-4" />
                      <span>MODO BIG BAG — PESO TOTAL = QUANTIDADE DE BAGS × PESO UNITÁRIO</span>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-xs text-[#AEB8C5]">
                          Embalagem / Referência
                        </label>
                        <select
                          disabled={!canExecute}
                          value={selectedBagConfigId}
                          onChange={(e) => {
                            setSelectedBagConfigId(e.target.value);
                            const found = materialBagOptions.find(
                              (o) => String(o.id) === e.target.value
                            );
                            if (found) setBagUnitWeightKg(String(found.unitWeightKg));
                          }}
                          className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                        >
                          <option value="">Personalizado / Manual</option>
                          {materialBagOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.packagingLabel} ({opt.validationStatus === 'VALIDADO' ? 'Validado' : 'Provisório'})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-[#AEB8C5]">
                          Quantidade de Bags *
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          required
                          disabled={!canExecute}
                          value={bagCount}
                          onChange={(e) => setBagCount(e.target.value)}
                          placeholder="Ex.: 10"
                          className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 font-mono-tabular text-base font-bold text-[#F4F6F8]"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-xs text-[#AEB8C5]">
                          Peso Unitário do Bag (kg) *
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          required
                          disabled={!canExecute}
                          value={bagUnitWeightKg}
                          onChange={(e) => setBagUnitWeightKg(e.target.value)}
                          placeholder="Ex.: 1200"
                          className="min-h-[46px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 font-mono-tabular text-base font-bold text-[#F4F6F8]"
                        />
                      </div>

                      <div className="flex flex-col justify-center rounded-lg border border-[#F5B91B]/30 bg-[#101B2A] px-4 py-2">
                        <span className="text-[11px] text-[#AEB8C5]">Peso Total Calculado</span>
                        <span className="font-mono-tabular text-xl font-extrabold text-[#F5B91B]">
                          {formatKg(computedTotalKg)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PASSO 3 & 4 & 5 & 6: SILOS COMPATÍVEIS, RATEIO, REVISÃO E CONFIRMAÇÃO */}
            {(!wizardMode || wizardStep >= 2) && (
              <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
                <div className="flex items-center gap-2.5">
                  <Scale className="h-5 w-5 text-[#3B82F6]" />
                  <div>
                    <h3 className="font-display text-base font-bold text-[#F4F6F8]">
                      Distribuição & Rateio entre Silos Compatíveis
                    </h3>
                    <p className="text-xs text-[#AEB8C5]">
                      Lista filtrada exclusivamente pela matriz administrativa de compatibilidade e capacidade segura (-10%).
                    </p>
                  </div>
                </div>

                {compatibleSilos.length > 0 && (
                  <button
                    type="button"
                    disabled={loadingAi}
                    onClick={handleRequestAiAdvice}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[#3B82F6]/40 bg-[#3B82F6]/10 px-3 py-1.5 text-xs font-semibold text-[#60A5FA] hover:bg-[#3B82F6]/20"
                  >
                    <Sparkles className="h-4 w-4" />
                    <span>{loadingAi ? 'Analisando...' : 'Análise Consultiva Gemini'}</span>
                  </button>
                )}
              </div>

              {aiAdvice && (
                <div className="rounded-xl border border-[#3B82F6]/40 bg-[#0A1421] p-4 text-xs space-y-2">
                  <p className="font-bold text-[#60A5FA]">
                    Resumo Consultivo IA (não altera estoque · apenas destinos autorizados):
                  </p>
                  <p className="text-[#F4F6F8] leading-relaxed">{aiAdvice.summary}</p>
                  {aiAdvice.alerts.length > 0 && (
                    <ul className="list-disc pl-5 text-[#F5B91B] space-y-1">
                      {aiAdvice.alerts.map((al) => (
                        <li key={al}>{al}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

                {/* Lista de Silos Compatíveis apenas na Etapa 3 (wizardStep === 2) ou Formulário Completo */}
                {(!wizardMode || wizardStep === 2) && (
                  <>
                    {loadingSilos ? (
                      <p className="text-xs text-[#AEB8C5]">Carregando silos compatíveis...</p>
                    ) : !materialId && !complementReceipt ? (
                      <p className="text-xs text-[#AEB8C5]">
                        Selecione uma matéria-prima na Etapa 2 para listar os silos liberados.
                      </p>
                    ) : compatibleSilos.length === 0 ? (
                      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-xs text-red-200">
                        Nenhum silo compatível cadastrado para esta matéria-prima. Solicite à Supervisão o vínculo na matriz de compatibilidade.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {compatibleSilos.map((s) => {
                          const blocked = s.operationalStatus !== 'OPERACIONAL';
                          const added = distributions.some((d) => d.siloId === s.id);
                          return (
                            <div
                              key={s.id}
                              className={`rounded-xl border p-4 transition-colors ${
                                blocked
                                  ? 'border-red-500/45 bg-red-950/25 opacity-75'
                                  : added
                                    ? 'border-[#F5B91B] bg-[#F5B91B]/10'
                                    : 'border-[#AEB8C5]/20 bg-[#0A1421]'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono-tabular text-base font-extrabold text-[#F4F6F8]">
                                  Silo {s.siloNumber} · {s.lineCode}
                                </span>
                                <span
                                  className={`text-xs font-bold ${
                                    blocked ? 'text-red-400' : 'text-emerald-400'
                                  }`}
                                >
                                  {s.operationalStatus}
                                </span>
                              </div>
                              <div className="mt-2 space-y-1 font-mono-tabular text-xs text-[#AEB8C5]">
                                <p>Saldo Atual: {formatKg(s.confirmedStockKg)}</p>
                                <p className="font-bold text-[#F4F6F8]">
                                  Espaço Livre: {formatKg(s.availableSpaceKg)}
                                </p>
                              </div>
                              <button
                                type="button"
                                disabled={blocked || !canExecute}
                                onClick={() =>
                                  added ? removeDistributionSilo(s.id) : addDistributionSilo(s.id)
                                }
                                className={`mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border text-xs font-bold disabled:opacity-45 ${
                                  added
                                    ? 'border-[#F5B91B] bg-[#F5B91B] text-[#0A1421]'
                                    : 'border-[#AEB8C5]/25 bg-[#101B2A] text-[#F4F6F8] hover:border-[#F5B91B]'
                                }`}
                              >
                                <Plus className="h-4 w-4" />
                                <span>{added ? 'Silo Selecionado (Toque para remover)' : 'Selecionar Este Silo'}</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}

                {/* Linhas do Rateio na Etapa 4 (wizardStep === 3) ou Formulário Completo */}
                {(!wizardMode || wizardStep === 3) && distributions.length > 0 && (
                  <div className="space-y-3 rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] p-4">
                    <p className="text-xs font-bold text-[#F5B91B]">
                      QUANTO VAI PARA CADA SILO SELECIONADO
                    </p>
                    {distributions.map((line) => {
                      const silo = compatibleSilos.find((s) => s.id === line.siloId);
                      if (!silo) return null;
                      const qtyNum = Number(line.quantityKg || 0);
                      const exceedsSilo = qtyNum > silo.availableSpaceKg + 0.001;
                      return (
                        <div
                          key={line.siloId}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#AEB8C5]/15 bg-[#101B2A] p-3"
                        >
                          <div>
                            <p className="font-mono-tabular text-sm font-bold text-[#F4F6F8]">
                              Silo {silo.siloNumber} ({silo.lineCode})
                            </p>
                            <p className="font-mono-tabular text-xs text-[#AEB8C5]">
                              Espaço livre seguro: {formatKg(silo.availableSpaceKg)}
                            </p>
                            {exceedsSilo && (
                              <p className="text-xs font-bold text-red-400">
                                Excede a capacidade segura do Silo {silo.siloNumber}!
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.001"
                              min="0.001"
                              value={line.quantityKg}
                              onChange={(e) => updateDistributionQty(line.siloId, e.target.value)}
                              placeholder="kg"
                              className="min-h-[46px] w-40 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 font-mono-tabular text-sm font-bold text-[#F4F6F8]"
                            />
                            <button
                              type="button"
                              onClick={() => removeDistributionSilo(line.siloId)}
                              aria-label="Remover silo do rateio"
                              className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/15"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Resumo de Revisão na Etapa 5 (wizardStep === 4), Etapa 6 (wizardStep === 5) ou Formulário Completo */}
                {(!wizardMode || wizardStep >= 4) && (
                  <div className="space-y-4 rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] p-4">
                    <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
                      <div>
                        <p className="text-[#AEB8C5]">Material</p>
                        <p className="mt-1 font-bold text-[#F4F6F8]">
                          {complementReceipt?.materialDescription || selectedMaterial?.description || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#AEB8C5]">Lote / Fornecedor</p>
                        <p className="mt-1 font-mono-tabular font-bold text-[#F5B91B]">
                          {complementReceipt?.lotCode || lotCode || '—'} ·{' '}
                          {complementReceipt?.supplierName || supplierName || '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#AEB8C5]">Distribuindo Agora</p>
                        <p
                          className={`mt-1 font-mono-tabular text-base font-bold ${
                            totalAllocatedKg > computedTotalKg + 0.001
                              ? 'text-red-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {formatKg(totalAllocatedKg)} / {formatKg(computedTotalKg)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[#AEB8C5]">Restará Pendente</p>
                        <p className="mt-1 font-mono-tabular text-base font-bold text-[#F5B91B]">
                          {formatKg(remainingAfterPlanKg)}
                        </p>
                      </div>
                    </div>

                    {complementReceipt && (
                      <div className="flex flex-wrap items-center gap-3 border-t border-[#AEB8C5]/10 pt-3 text-xs">
                        <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-[#F4F6F8]">
                          <input
                            type="checkbox"
                            checked={executedByOther}
                            onChange={(e) => setExecutedByOther(e.target.checked)}
                            className="h-4 w-4 accent-[#F5B91B]"
                          />
                          <span>Complemento executado por outro operador</span>
                        </label>
                        {executedByOther && (
                          <>
                            <input
                              type="text"
                              value={executedByName}
                              onChange={(e) => setExecutedByName(e.target.value)}
                              placeholder="Nome de quem executou"
                              className="min-h-[40px] rounded-lg border border-[#F5B91B]/40 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                            />
                            <input
                              type="text"
                              value={executedByBadge}
                              onChange={(e) => setExecutedByBadge(e.target.value)}
                              placeholder="Matrícula"
                              className="min-h-[40px] w-32 rounded-lg border border-[#F5B91B]/40 bg-[#101B2A] px-3 font-mono-tabular text-xs text-[#F4F6F8]"
                            />
                          </>
                        )}
                      </div>
                    )}

                    {/* Fotografias & Documentos na Revisão (ou no Complemento de Descarga) */}
                    <div className="space-y-2.5 border-t border-[#AEB8C5]/10 pt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#60A5FA]">
                          <Paperclip className="h-3.5 w-3.5" />
                          <span>
                            Fotografias & Documentos Anexados ({attachments.length}/{MAX_CLIENT_ATTACHMENTS})
                          </span>
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            disabled={!canExecute}
                            value={attachmentKind}
                            onChange={(e) => setAttachmentKind(e.target.value as ReceiptAttachmentItem['kind'])}
                            className="min-h-[36px] rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-2.5 text-[11px] text-[#F4F6F8]"
                          >
                            {Object.entries(ATTACHMENT_KIND_LABELS).map(([k, lbl]) => (
                              <option key={k} value={k}>
                                {lbl}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!canExecute || attachments.length >= MAX_CLIENT_ATTACHMENTS}
                            onClick={() => cameraPhotoInputRef.current?.click()}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#3B82F6]/45 bg-[#3B82F6]/15 px-3 text-[11px] font-bold text-[#93C5FD] hover:bg-[#3B82F6]/25 disabled:opacity-50"
                          >
                            <Camera className="h-3.5 w-3.5" />
                            <span>Fotografar</span>
                          </button>
                          <button
                            type="button"
                            disabled={!canExecute || attachments.length >= MAX_CLIENT_ATTACHMENTS}
                            onClick={() => docFileInputRef.current?.click()}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/30 bg-[#101B2A] px-3 text-[11px] font-bold text-[#F4F6F8] hover:border-[#F5B91B] disabled:opacity-50"
                          >
                            <FileText className="h-3.5 w-3.5 text-[#F5B91B]" />
                            <span>Anexar PDF/Foto</span>
                          </button>
                        </div>
                      </div>
                      {attachmentError && (
                        <p className="rounded border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-200">
                          {attachmentError}
                        </p>
                      )}
                      {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {attachments.map((att) => (
                            <div
                              key={att.id}
                              className="inline-flex items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-2.5 py-1.5 text-[11px]"
                            >
                              <button
                                type="button"
                                onClick={() => setPreviewAttachment(att)}
                                className="inline-flex items-center gap-1.5 font-semibold text-[#F4F6F8] hover:text-[#F5B91B]"
                              >
                                <Eye className="h-3.5 w-3.5 text-[#60A5FA]" />
                                <span className="max-w-[160px] truncate">{att.name}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeAttachment(att.id)}
                                className="text-red-300 hover:text-red-200"
                                aria-label="Remover anexo"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#AEB8C5]/15 pt-3">
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Observações operacionais (opcional)"
                        className="min-h-[44px] flex-1 min-w-[220px] rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-xs text-[#F4F6F8]"
                      />
                      {(!wizardMode || wizardStep === 5) && (
                        <button
                          type="submit"
                          disabled={!canExecute || submitting || totalAllocatedKg > computedTotalKg + 0.001}
                          className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-[#F5B91B] px-6 py-2.5 text-sm font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-50"
                        >
                          <span>
                            {submitting
                              ? 'Gravando Transação...'
                              : complementReceipt
                                ? 'Confirmar Complemento'
                                : totalAllocatedKg === 0
                                  ? 'Registrar Recebimento Pendente'
                                  : remainingAfterPlanKg > 0
                                    ? 'Confirmar Descarga Parcial'
                                    : 'CONFIRMAR RECEBIMENTO'}
                          </span>
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Barra de Navegação Guiada (VOLTAR / CONTINUAR) */}
            {wizardMode && (
              <div className="flex items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] p-4">
                <button
                  type="button"
                  disabled={wizardStep === (complementReceipt ? 2 : 0)}
                  onClick={handleWizardBack}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-[#AEB8C5]/30 bg-[#0A1421] px-5 text-sm font-bold text-[#F4F6F8] hover:border-[#F5B91B] disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>VOLTAR</span>
                </button>

                {wizardStep < FLOW_STEPS.length - 1 && (
                  <button
                    type="button"
                    onClick={validateAndAdvanceStep}
                    className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#F5B91B] px-6 text-sm font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
                  >
                    <span>CONTINUAR</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </form>
        </div>
      )}

      {/* TAB 2: DESCARGAS PENDENTES / PARCIAIS */}
      {activeTab === 'pendentes' && (
        <div className="space-y-4">
          {pendingReceipts.length === 0 ? (
            <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-8 text-center text-sm text-[#AEB8C5]">
              Nenhum recebimento com descarga parcial ou pendente no momento.
            </div>
          ) : (
            pendingReceipts.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#F5B91B]/30 bg-[#101B2A] p-5"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono-tabular text-sm font-extrabold text-[#F5B91B]">
                      {r.receiptNumber}
                    </span>
                    <span className="text-[#AEB8C5]">·</span>
                    <span className="font-mono-tabular text-xs font-bold text-[#F4F6F8]">
                      Lote {r.lotCode}
                    </span>
                    <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${statusStyle(r.status)}`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[#F4F6F8]">
                    {r.materialCode} — {r.materialDescription}
                  </p>
                  <p className="text-xs text-[#AEB8C5]">
                    Fornecedor: {r.supplierName} · Recebido: {formatKg(r.receivedQuantityKg)} · Já distribuído:{' '}
                    {formatKg(r.distributedQuantityKg)} · Pendente:{' '}
                    <span className="font-mono-tabular font-bold text-[#F5B91B]">
                      {formatKg(r.remainingQuantityKg)}
                    </span>
                  </p>
                  {Array.isArray(r.attachments) && r.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {r.attachments.map((att) => (
                        <button
                          key={att.id}
                          type="button"
                          onClick={() => setPreviewAttachment(att)}
                          className="inline-flex items-center gap-1.5 rounded border border-[#3B82F6]/35 bg-[#0A1421] px-2.5 py-1 text-[11px] font-semibold text-[#93C5FD] hover:border-[#F5B91B]"
                        >
                          <Eye className="h-3 w-3" />
                          <span>{ATTACHMENT_KIND_LABELS[att.kind] || att.kind}: {att.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {canExecute && (
                  <button
                    type="button"
                    onClick={() => {
                      setComplementReceipt(r);
                      setActiveTab('novo');
                    }}
                    className="min-h-[46px] rounded-lg bg-[#F5B91B] px-5 py-2 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
                  >
                    Continuar Descarga ({formatKg(r.remainingQuantityKg)})
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: HISTÓRICO DE RECEBIMENTOS */}
      {activeTab === 'historico' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            <input
              type="text"
              value={lotFilterHistory}
              onChange={(e) => setLotFilterHistory(e.target.value)}
              placeholder="Filtrar por lote, recebimento, material ou fornecedor..."
              className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-sm text-[#F4F6F8]"
            />
          </div>

          <div className="space-y-3">
            {filteredReceipts.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono-tabular text-sm font-bold text-[#F4F6F8]">
                        {r.receiptNumber}
                      </span>
                      <span className="text-[#AEB8C5]">·</span>
                      <span className="font-mono-tabular text-xs font-bold text-[#F5B91B]">
                        Lote {r.lotCode}
                      </span>
                      <span className="text-[#AEB8C5]">·</span>
                      <span className="text-xs text-[#AEB8C5]">{r.receivingType}</span>
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${statusStyle(r.status)}`}>
                        {r.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-[#F4F6F8]">
                      {r.materialCode} — {r.materialDescription}
                    </p>
                    <p className="text-xs text-[#AEB8C5]">
                      {r.supplierName} {r.invoiceNumber ? `· NF ${r.invoiceNumber}` : ''} · Operador: {r.operatorName} · {r.shiftCode} ({r.operationalDate})
                    </p>
                  </div>

                  <div className="text-right font-mono-tabular text-xs">
                    <p className="text-[#F4F6F8]">Recebido: {formatKg(r.receivedQuantityKg)}</p>
                    <p className="text-emerald-400">Distribuído: {formatKg(r.distributedQuantityKg)}</p>
                    {r.remainingQuantityKg > 0 && (
                      <p className="text-[#F5B91B]">Restante: {formatKg(r.remainingQuantityKg)}</p>
                    )}
                  </div>
                </div>

                {r.distributions.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-[#AEB8C5]/10 pt-2.5 text-xs">
                    {r.distributions.map((d) => (
                      <span
                        key={d.id}
                        className={`rounded border px-2.5 py-1 font-mono-tabular ${
                          d.status === 'ESTORNADA'
                            ? 'border-red-500/35 bg-red-500/10 text-red-300 line-through'
                            : 'border-[#AEB8C5]/20 bg-[#0A1421] text-[#F4F6F8]'
                        }`}
                      >
                        Silo {d.siloNumber}: {formatKg(d.quantityKg)}
                        {d.isComplement ? ' (Compl.)' : ''}
                      </span>
                    ))}
                  </div>
                )}

                {Array.isArray(r.attachments) && r.attachments.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[#AEB8C5]/10 pt-2.5 text-xs">
                    <span className="text-[11px] font-semibold text-[#AEB8C5]">Anexos:</span>
                    {r.attachments.map((att) => (
                      <button
                        key={att.id}
                        type="button"
                        onClick={() => setPreviewAttachment(att)}
                        className="inline-flex items-center gap-1.5 rounded border border-[#3B82F6]/35 bg-[#0A1421] px-2.5 py-1 text-[11px] font-semibold text-[#93C5FD] hover:border-[#F5B91B]"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>{ATTACHMENT_KIND_LABELS[att.kind] || att.kind} · {att.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden inputs for Camera Photo & Document Upload */}
      <input
        ref={cameraPhotoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleAttachmentFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={docFileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          handleAttachmentFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Attachment Preview Modal */}
      {previewAttachment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className="w-full max-w-3xl space-y-3 rounded-xl border border-[#F5B91B]/40 bg-[#0A1421] p-4 text-[#F4F6F8]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#F5B91B]">
                  {ATTACHMENT_KIND_LABELS[previewAttachment.kind] || previewAttachment.kind}
                </p>
                <p className="truncate text-sm font-bold">{previewAttachment.name}</p>
              </div>
              <div className="flex items-center gap-2">
                {previewAttachment.dataUrl && (
                  <a
                    href={previewAttachment.dataUrl}
                    download={previewAttachment.name}
                    className="rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 py-1.5 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
                  >
                    Baixar
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#AEB8C5]/25 text-[#F4F6F8] hover:border-[#F5B91B]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {!previewAttachment.dataUrl ? (
              <div className="rounded-lg border border-[#F5B91B]/30 bg-[#101B2A] p-6 text-center text-xs text-[#AEB8C5]">
                Visualização de arquivo indisponível na prévia pública. Acesse autenticado para abrir o anexo original.
              </div>
            ) : previewAttachment.mimeType === 'application/pdf' ? (
              <iframe
                src={previewAttachment.dataUrl}
                title={previewAttachment.name}
                className="h-[72vh] w-full rounded-lg border border-[#AEB8C5]/20 bg-white"
              />
            ) : (
              <div className="flex justify-center overflow-auto rounded-lg border border-[#AEB8C5]/20 bg-black/50 p-2">
                <img
                  src={previewAttachment.dataUrl}
                  alt={previewAttachment.name}
                  className="max-h-[72vh] w-auto rounded object-contain"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
