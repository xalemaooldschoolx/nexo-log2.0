import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileSpreadsheet,
  FileText,
  GitCompare,
  History,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiDownloadFile, apiFetch } from '../lib/api.ts';
import { hasPermission } from '../lib/rbac.ts';
import {
  buildReference2511BasketVersions,
  convertRawQuantityToKg,
  formatBrazilianDiff,
  formatBrazilianNumber,
  OFFICIAL_PRODUCTION_LINES,
} from '../lib/basket-comparator.ts';
import { BasketExecutiveAnalysis } from '../components/baskets/BasketExecutiveAnalysis.tsx';
import type {
  BasketComparisonView,
  BasketDiffClassification,
  BasketExtractResponse,
  BasketSourceType,
  BasketVersionView,
  MaterialItem,
  SessionData,
} from '../types/nexo.ts';

interface BasketComparatorPageProps {
  session: SessionData;
  materials: MaterialItem[];
  isDemoMode: boolean;
  initialComparisonId?: number | null;
  onReloadWorkspace?: () => void;
}

type ComparatorTab = 'NOVA' | 'CONFERENCIA' | 'RESULTADO' | 'GERENCIAL' | 'HISTORICO' | 'OPERADOR';

interface PageFileAttachment {
  pageNumber: number;
  fileName: string;
  mimeType: string;
  base64Content: string;
  previewDataUrl?: string;
}

interface EditableDraftItem {
  localId: string;
  lineCode: string;
  materialCode: string;
  materialDescription: string;
  rawQuantityText: string;
  plannedQuantityKg: number | null;
  unit: string;
  sourcePage: number;
  sourceDocumentName: string | null;
  sourceRegion: string | null;
  confidence: 'ALTA' | 'MEDIA' | 'BAIXA';
  needsReview: boolean;
  reviewReason: string | null;
}

function inferMimeFromFile(file: File): string {
  const t = (file.type || '').trim().toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.csv')) return 'text/csv';
  if (n.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (n.endsWith('.xls')) return 'application/vnd.ms-excel';
  return 'image/jpeg';
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Falha ao ler arquivo ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function prepareAttachmentForVision(
  file: File
): Promise<{ mimeType: string; base64Content: string; previewDataUrl?: string }> {
  const mimeType = inferMimeFromFile(file);
  const rawBase64 = await readFileAsBase64(file);

  if (!mimeType.startsWith('image/')) {
    return { mimeType, base64Content: rawBase64 };
  }

  // Otimiza fotos muito pesadas da câmera do tablet (> 1.4 MB) preservando nitidez de tabelas (máx 2048px)
  if (file.size <= 1_400_000 || typeof Image === 'undefined' || typeof document === 'undefined') {
    return { mimeType, base64Content: rawBase64, previewDataUrl: rawBase64 };
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Falha ao processar imagem da câmera'));
      el.src = rawBase64;
    });
    const maxDim = 2048;
    const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
    if (scale >= 1) {
      return { mimeType, base64Content: rawBase64, previewDataUrl: rawBase64 };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { mimeType, base64Content: rawBase64, previewDataUrl: rawBase64 };
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const optimized = canvas.toDataURL('image/jpeg', 0.88);
    return {
      mimeType: 'image/jpeg',
      base64Content: optimized,
      previewDataUrl: optimized,
    };
  } catch {
    return { mimeType, base64Content: rawBase64, previewDataUrl: rawBase64 };
  }
}

function inferSourceTypeFromFiles(files: File[], fromCamera: boolean): BasketSourceType {
  if (fromCamera) return 'CAMERA_TABLET';
  const name = (files[0]?.name || '').toLowerCase();
  if (name.endsWith('.pdf')) return 'ARQUIVO_PDF';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'ARQUIVO_XLSX';
  if (name.endsWith('.csv')) return 'ARQUIVO_CSV';
  return 'ARQUIVO_IMAGEM';
}

function mapExtractionToDraftItems(ext: BasketExtractResponse): EditableDraftItem[] {
  return ext.items.map((it, idx) => ({
    localId: `draft-${idx}-${Math.random().toString(36).slice(2, 7)}`,
    lineCode: it.lineCode || 'L1',
    materialCode: it.materialCode || '',
    materialDescription: it.materialDescription || '',
    rawQuantityText: it.rawQuantityText || '',
    plannedQuantityKg: it.plannedQuantityKg,
    unit: it.unit || 'kg',
    sourcePage: it.sourcePage || 1,
    sourceDocumentName: it.sourceDocumentName || null,
    sourceRegion: it.sourceRegion || null,
    confidence: it.confidence || 'MEDIA',
    needsReview: Boolean(it.needsReview),
    reviewReason: it.reviewReason || null,
  }));
}

const CLASSIFICATION_LABELS: Record<BasketDiffClassification, { label: string; style: string }> = {
  AUMENTOU: { label: 'AUMENTOU', style: 'border-orange-500/45 bg-orange-500/15 text-orange-200' },
  DIMINUIU: { label: 'DIMINUIU', style: 'border-emerald-500/45 bg-emerald-500/15 text-emerald-200' },
  MANTIDO: { label: 'MANTIDO', style: 'border-[#AEB8C5]/25 bg-[#0A1421] text-[#AEB8C5]' },
  NOVO_MATERIAL: { label: 'NOVO MATERIAL', style: 'border-[#3B82F6]/50 bg-[#3B82F6]/15 text-blue-200' },
  MATERIAL_RETIRADO: { label: 'RETIRADO', style: 'border-red-500/50 bg-red-500/15 text-red-200' },
  PENDENTE_CONFERENCIA: { label: 'CONFERIR', style: 'border-[#F5B91B]/60 bg-[#F5B91B]/15 text-[#F5B91B]' },
};

export const BasketComparatorPage: React.FC<BasketComparatorPageProps> = ({
  session,
  materials,
  isDemoMode,
  initialComparisonId,
  onReloadWorkspace,
}) => {
  const role = session.user.roleCode;
  const canUpload = hasPermission(role, 'baskets:upload');
  const canEdit = hasPermission(role, 'baskets:edit') || canUpload;
  const canPublish = hasPermission(role, 'baskets:publish');
  const canExecutive = hasPermission(role, 'baskets:executive_view');
  const canExport = hasPermission(role, 'baskets:export');
  const isOperatorOrProd = role === 'OPERADOR_MOEGA' || role === 'PRODUCAO';

  const [activeTab, setActiveTab] = useState<ComparatorTab>(
    initialComparisonId
      ? isOperatorOrProd
        ? 'OPERADOR'
        : canExecutive
          ? 'GERENCIAL'
          : 'RESULTADO'
      : isOperatorOrProd
        ? 'OPERADOR'
        : 'HISTORICO'
  );

  const [versions, setVersions] = useState<BasketVersionView[]>([]);
  const [comparisons, setComparisons] = useState<BasketComparisonView[]>([]);
  const [selectedComparison, setSelectedComparison] = useState<BasketComparisonView | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Estado do fluxo NOVA COMPARAÇÃO
  const [productionDate, setProductionDate] = useState<string>('2026-11-25');
  const [baseLabel, setBaseLabel] = useState<string>('Cesta da Manhã — 07:00');
  const [baseTime, setBaseTime] = useState<string>('07:00');
  const [baseSourceType, setBaseSourceType] = useState<BasketSourceType>('CAMERA_TABLET');
  const [basePages, setBasePages] = useState<PageFileAttachment[]>([]);

  const [targetLabel, setTargetLabel] = useState<string>('Cesta Atualizada — 19:00');
  const [targetTime, setTargetTime] = useState<string>('19:00');
  const [targetSourceType, setTargetSourceType] = useState<BasketSourceType>('CAMERA_TABLET');
  const [targetPages, setTargetPages] = useState<PageFileAttachment[]>([]);

  const [extracting, setExtracting] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  // Estado da Tela de Conferência Pré-Comparação
  const [baseDraftItems, setBaseDraftItems] = useState<EditableDraftItem[]>([]);
  const [targetDraftItems, setTargetDraftItems] = useState<EditableDraftItem[]>([]);
  const [baseExtractionMeta, setBaseExtractionMeta] = useState<{
    usedAiModel: string | null;
    unreadableFields: string[];
  } | null>(null);
  const [targetExtractionMeta, setTargetExtractionMeta] = useState<{
    usedAiModel: string | null;
    unreadableFields: string[];
  } | null>(null);
  const [zoomedPagePreview, setZoomedPagePreview] = useState<PageFileAttachment | null>(null);

  // Filtros do resultado
  const [lineFilter, setLineFilter] = useState<string>('ALL');
  const [classFilter, setClassFilter] = useState<string>('ALL');

  // Histórico multi-versão: seleção livre de 2 versões
  const [histBaseVerId, setHistBaseVerId] = useState<number | ''>('');
  const [histTargetVerId, setHistTargetVerId] = useState<number | ''>('');

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await apiFetch<{
        versions: BasketVersionView[];
        comparisons: BasketComparisonView[];
      }>('/api/baskets/history');
      setVersions(res.versions || []);
      setComparisons(res.comparisons || []);

      if (initialComparisonId) {
        const hit = (res.comparisons || []).find((c) => c.id === initialComparisonId);
        if (hit) setSelectedComparison(hit);
      } else if (!selectedComparison && res.comparisons && res.comparisons.length > 0) {
        setSelectedComparison(res.comparisons[0]);
      }

      if ((res.versions || []).length >= 2) {
        setHistBaseVerId((prev) => (prev === '' ? res.versions[0].id : prev));
        setHistTargetVerId((prev) =>
          prev === '' ? res.versions[res.versions.length - 1].id : prev
        );
      }
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message || 'Erro ao carregar histórico de cestas.' });
    } finally {
      setLoadingHistory(false);
    }
  }, [initialComparisonId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, isDemoMode]);

  useEffect(() => {
    if (initialComparisonId && comparisons.length > 0) {
      const hit = comparisons.find((c) => c.id === initialComparisonId);
      if (hit) {
        setSelectedComparison(hit);
        setActiveTab(isOperatorOrProd ? 'OPERADOR' : canExecutive ? 'GERENCIAL' : 'RESULTADO');
      }
    }
  }, [initialComparisonId, comparisons, isOperatorOrProd, canExecutive]);

  const handleAttachFiles = async (
    side: 'BASE' | 'TARGET',
    fileList: FileList | null,
    fromCamera: boolean
  ) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const srcType = inferSourceTypeFromFiles(files, fromCamera);

    const existing = side === 'BASE' ? basePages : targetPages;
    const newAttachments: PageFileAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const prepared = await prepareAttachmentForVision(f);
      newAttachments.push({
        pageNumber: existing.length + i + 1,
        fileName: f.name,
        mimeType: prepared.mimeType,
        base64Content: prepared.base64Content,
        previewDataUrl: prepared.previewDataUrl,
      });
    }

    if (side === 'BASE') {
      setBaseSourceType(srcType);
      setBasePages((prev) => [...prev, ...newAttachments]);
    } else {
      setTargetSourceType(srcType);
      setTargetPages((prev) => [...prev, ...newAttachments]);
    }
  };

  const handleLoadReference2511 = () => {
    const refs = buildReference2511BasketVersions(materials);
    const v07 = refs[0];
    const v19 = refs[3];
    setProductionDate('2026-11-25');
    setBaseLabel(v07.label);
    setBaseTime(v07.emissionTime || '07:00');
    setTargetLabel(v19.label);
    setTargetTime(v19.emissionTime || '19:00');
    setBaseDraftItems(
      v07.items.map((it, idx) => ({
        localId: `ref-base-${idx}`,
        lineCode: it.lineCode,
        materialCode: it.materialCode || '',
        materialDescription: it.materialDescription,
        rawQuantityText: it.rawQuantityText || '',
        plannedQuantityKg: it.plannedQuantityKg,
        unit: it.unit,
        sourcePage: it.sourcePage,
        sourceDocumentName: it.sourceDocumentName,
        sourceRegion: it.sourceRegion,
        confidence: it.confidence,
        needsReview: it.needsReview,
        reviewReason: it.reviewReason,
      }))
    );
    setTargetDraftItems(
      v19.items.map((it, idx) => ({
        localId: `ref-target-${idx}`,
        lineCode: it.lineCode,
        materialCode: it.materialCode || '',
        materialDescription: it.materialDescription,
        rawQuantityText: it.rawQuantityText || '',
        plannedQuantityKg: it.plannedQuantityKg,
        unit: it.unit,
        sourcePage: it.sourcePage,
        sourceDocumentName: it.sourceDocumentName,
        sourceRegion: it.sourceRegion,
        confidence: it.confidence,
        needsReview: it.needsReview,
        reviewReason: it.reviewReason,
      }))
    );
    setStatusMessage({
      type: 'ok',
      text: 'Cestas de referência 25/11 (07:00 e 19:00) carregadas na Tela de Conferência antes da comparação.',
    });
    setActiveTab('CONFERENCIA');
  };

  const handleExtractBoth = async () => {
    if (basePages.length === 0 || targetPages.length === 0) {
      setStatusMessage({
        type: 'err',
        text: 'Anexe ou fotografe as duas programações (Cesta Inicial e Nova Cesta) antes de iniciar a leitura.',
      });
      return;
    }
    setExtracting(true);
    setStatusMessage(null);
    try {
      const [extBase, extTarget] = await Promise.all([
        apiFetch<BasketExtractResponse>('/api/baskets/extract', {
          method: 'POST',
          body: JSON.stringify({
            sourceType: baseSourceType,
            pages: basePages,
            expectedProductionDate: productionDate,
          }),
        }),
        apiFetch<BasketExtractResponse>('/api/baskets/extract', {
          method: 'POST',
          body: JSON.stringify({
            sourceType: targetSourceType,
            pages: targetPages,
            expectedProductionDate: productionDate,
          }),
        }),
      ]);

      setBaseDraftItems(mapExtractionToDraftItems(extBase));
      setTargetDraftItems(mapExtractionToDraftItems(extTarget));
      setBaseExtractionMeta({
        usedAiModel: extBase.usedAiModel,
        unreadableFields: extBase.unreadableFields || [],
      });
      setTargetExtractionMeta({
        usedAiModel: extTarget.usedAiModel,
        unreadableFields: extTarget.unreadableFields || [],
      });
      if (extTarget.productionDate && /^\d{4}-\d{2}-\d{2}$/.test(extTarget.productionDate)) {
        setProductionDate(extTarget.productionDate);
      } else if (extBase.productionDate && /^\d{4}-\d{2}-\d{2}$/.test(extBase.productionDate)) {
        setProductionDate(extBase.productionDate);
      }
      if (extBase.emissionTime && /^\d{2}:\d{2}$/.test(extBase.emissionTime)) {
        setBaseTime(extBase.emissionTime);
      }
      if (extTarget.emissionTime && /^\d{2}:\d{2}$/.test(extTarget.emissionTime)) {
        setTargetTime(extTarget.emissionTime);
      }
      setActiveTab('CONFERENCIA');
      setStatusMessage({
        type: 'ok',
        text: `Leitura concluída${extBase.usedAiModel || extTarget.usedAiModel ? ` via ${extTarget.usedAiModel || extBase.usedAiModel}` : ''} (${extBase.items.length} itens na base, ${extTarget.items.length} na atualizada). Confira os campos antes de comparar.`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'err',
        text: err.message || 'Falha ao extrair os documentos das Cestas de Consumo.',
      });
    } finally {
      setExtracting(false);
    }
  };

  const updateDraftRow = (
    side: 'BASE' | 'TARGET',
    localId: string,
    patch: Partial<EditableDraftItem>
  ) => {
    const updater = (prev: EditableDraftItem[]) =>
      prev.map((row) => {
        if (row.localId !== localId) return row;
        const next = { ...row, ...patch };
        if (patch.rawQuantityText !== undefined || patch.unit !== undefined) {
          next.plannedQuantityKg = convertRawQuantityToKg(next.rawQuantityText, next.unit);
        }
        if (patch.materialCode !== undefined) {
          const foundMat = materials.find(
            (m) => m.code.toUpperCase() === next.materialCode.trim().toUpperCase()
          );
          if (foundMat && !patch.materialDescription) {
            next.materialDescription = foundMat.description;
          }
        }
        next.needsReview = next.plannedQuantityKg === null || !next.materialCode.trim();
        next.reviewReason = next.needsReview ? 'Informar código e quantidade válidos.' : null;
        return next;
      });

    if (side === 'BASE') setBaseDraftItems(updater);
    else setTargetDraftItems(updater);
  };

  const handleConfirmAndCompare = async () => {
    if (baseDraftItems.length === 0 || targetDraftItems.length === 0) {
      setStatusMessage({
        type: 'err',
        text: 'Ambas as cestas precisam ter pelo menos um material conferido.',
      });
      return;
    }
    setComparing(true);
    setStatusMessage(null);
    try {
      const savedBase = await apiFetch<BasketVersionView>('/api/baskets/versions', {
        method: 'POST',
        body: JSON.stringify({
          label: baseLabel,
          productionDate,
          emissionTime: baseTime,
          sourceType: baseSourceType,
          sourcePages: basePages.map((p) => ({
            pageNumber: p.pageNumber,
            fileName: p.fileName,
            mimeType: p.mimeType,
          })),
          items: baseDraftItems,
        }),
      });

      const savedTarget = await apiFetch<BasketVersionView>('/api/baskets/versions', {
        method: 'POST',
        body: JSON.stringify({
          label: targetLabel,
          productionDate,
          emissionTime: targetTime,
          sourceType: targetSourceType,
          sourcePages: targetPages.map((p) => ({
            pageNumber: p.pageNumber,
            fileName: p.fileName,
            mimeType: p.mimeType,
          })),
          items: targetDraftItems,
        }),
      });

      const cmp = await apiFetch<BasketComparisonView>('/api/baskets/compare', {
        method: 'POST',
        body: JSON.stringify({
          baseVersionId: savedBase.id,
          targetVersionId: savedTarget.id,
        }),
      });

      setSelectedComparison(cmp);
      await loadHistory();
      setActiveTab('RESULTADO');
      setStatusMessage({
        type: 'ok',
        text: `Comparação ${cmp.comparisonCode} gerada com sucesso para todas as linhas.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message || 'Erro ao salvar e comparar cestas.' });
    } finally {
      setComparing(false);
    }
  };

  const handleCompareExistingVersions = async () => {
    if (!histBaseVerId || !histTargetVerId || histBaseVerId === histTargetVerId) {
      setStatusMessage({
        type: 'err',
        text: 'Escolha duas versões diferentes no histórico para comparar.',
      });
      return;
    }
    setComparing(true);
    setStatusMessage(null);
    try {
      const cmp = await apiFetch<BasketComparisonView>('/api/baskets/compare', {
        method: 'POST',
        body: JSON.stringify({
          baseVersionId: Number(histBaseVerId),
          targetVersionId: Number(histTargetVerId),
        }),
      });
      setSelectedComparison(cmp);
      await loadHistory();
      setActiveTab(canExecutive ? 'GERENCIAL' : 'RESULTADO');
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message || 'Erro ao comparar versões do histórico.' });
    } finally {
      setComparing(false);
    }
  };

  const handlePublishComparison = async () => {
    if (!selectedComparison) return;
    setPublishing(true);
    setStatusMessage(null);
    try {
      const res = await apiFetch<{ comparison: BasketComparisonView }>('/api/baskets/publish', {
        method: 'POST',
        body: JSON.stringify({ comparisonId: selectedComparison.id }),
      });
      setSelectedComparison(res.comparison);
      await loadHistory();
      onReloadWorkspace?.();
      setStatusMessage({
        type: 'ok',
        text: `Nova programação (${res.comparison.targetVersionLabel}) publicada! Versões anteriores arquivadas e alerta em tempo real enviado.`,
      });
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message || 'Erro ao publicar nova programação.' });
    } finally {
      setPublishing(false);
    }
  };

  const handleExport = async (format: 'PDF' | 'XLSX') => {
    if (!selectedComparison) return;
    setExportingFormat(format);
    try {
      await apiDownloadFile(
        '/api/baskets/export',
        {
          method: 'POST',
          body: JSON.stringify({ comparisonId: selectedComparison.id, format }),
        },
        `comparador-cestas-${selectedComparison.productionDate}.${format.toLowerCase()}`
      );
    } catch (err: any) {
      setStatusMessage({ type: 'err', text: err.message || 'Erro ao exportar comparação.' });
    } finally {
      setExportingFormat(null);
    }
  };

  const filteredDiffItems = useMemo(() => {
    if (!selectedComparison) return [];
    return selectedComparison.diffItems.filter((item) => {
      if (lineFilter !== 'ALL' && item.lineCode !== lineFilter) return false;
      if (classFilter !== 'ALL' && item.classification !== classFilter) return false;
      return true;
    });
  }, [selectedComparison, lineFilter, classFilter]);

  const versionsSameDate = useMemo(() => {
    const dt = selectedComparison?.productionDate || productionDate;
    return versions.filter((v) => v.productionDate === dt);
  }, [versions, selectedComparison, productionDate]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Banner Topo + Botão NOVA COMPARAÇÃO */}
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#F5B91B]/30 bg-[#101B2A] p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#F5B91B]/40 bg-[#F5B91B]/10 text-[#F5B91B]">
            <GitCompare className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
              MÓDULO DE PROGRAMAÇÃO & PLANEJAMENTO
            </p>
            <h1 className="font-display text-xl font-extrabold text-[#F4F6F8] sm:text-2xl">
              Comparador Inteligente de Cestas de Consumo
            </h1>
            <p className="mt-0.5 text-xs text-[#AEB8C5]">
              Compare versões do dia por foto, PDF ou planilha, confira os campos e publique atualizações operacionais.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canUpload && (
            <button
              type="button"
              onClick={() => {
                setStatusMessage(null);
                setActiveTab('NOVA');
              }}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#F5B91B] px-5 py-2.5 text-sm font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
            >
              <Plus className="h-5 w-5" />
              <span>NOVA COMPARAÇÃO</span>
            </button>
          )}
        </div>
      </section>

      {/* Subnavegação do Módulo */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'NOVA' as ComparatorTab, label: '1. Nova Comparação', icon: Camera, show: canUpload },
          {
            id: 'CONFERENCIA' as ComparatorTab,
            label: `2. Conferência (${baseDraftItems.length}/${targetDraftItems.length})`,
            icon: ClipboardCheck,
            show: canUpload && (baseDraftItems.length > 0 || targetDraftItems.length > 0),
          },
          {
            id: 'RESULTADO' as ComparatorTab,
            label: '3. Comparação L1–L7',
            icon: GitCompare,
            show: Boolean(selectedComparison),
          },
          {
            id: 'GERENCIAL' as ComparatorTab,
            label: 'Análise Gerencial',
            icon: BarChart3,
            show: Boolean(selectedComparison) && canExecutive,
          },
          {
            id: 'HISTORICO' as ComparatorTab,
            label: `Histórico de Cestas (${versions.length})`,
            icon: History,
            show: true,
          },
          {
            id: 'OPERADOR' as ComparatorTab,
            label: 'Visão Operador',
            icon: ShieldAlert,
            show: Boolean(selectedComparison),
          },
        ]
          .filter((t) => t.show)
          .map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-xs font-bold transition-colors ${
                  active
                    ? 'bg-[#F5B91B] text-[#0A1421]'
                    : 'border border-[#AEB8C5]/20 bg-[#101B2A] text-[#AEB8C5] hover:border-[#F5B91B]/50 hover:text-[#F4F6F8]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
      </div>

      {/* Feedback Banner */}
      {statusMessage && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border p-4 text-xs font-semibold ${
            statusMessage.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-950/25 text-emerald-200'
              : 'border-red-500/45 bg-red-950/25 text-red-200'
          }`}
        >
          {statusMessage.type === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* TAB 1: NOVA COMPARAÇÃO */}
      {activeTab === 'NOVA' && (
        <div className="space-y-6 rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#AEB8C5]/15 pb-4">
            <div>
              <h2 className="font-display text-lg font-extrabold text-[#F4F6F8]">
                Passo 1 — Capturar ou Enviar Duas Cestas de Consumo
              </h2>
              <p className="text-xs text-[#AEB8C5]">
                Aceita fotos diretas da câmera do tablet (múltiplas páginas), PNG/JPG, PDF, Excel (.xlsx) ou CSV.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-bold text-[#AEB8C5]">
                Data de Produção:
                <input
                  type="date"
                  value={productionDate}
                  onChange={(e) => setProductionDate(e.target.value)}
                  className="ml-2 min-h-[42px] rounded-xl border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs font-bold text-[#F4F6F8]"
                />
              </label>
              <button
                type="button"
                onClick={handleLoadReference2511}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-[#3B82F6]/45 bg-[#0A1421] px-3.5 text-xs font-bold text-[#60A5FA] hover:border-[#F5B91B]"
              >
                <Sparkles className="h-4 w-4 text-[#F5B91B]" />
                <span>Carregar Exemplo 25/11 (07h × 19h)</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Cesta Inicial */}
            <div className="space-y-4 rounded-2xl border border-[#3B82F6]/30 bg-[#0A1421] p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-[#60A5FA]">
                Cesta Inicial (Programação Base)
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-[#AEB8C5]">Identificação</label>
                  <input
                    type="text"
                    value={baseLabel}
                    onChange={(e) => setBaseLabel(e.target.value)}
                    placeholder="Ex.: Cesta da Manhã — 07:00"
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-sm text-[#F4F6F8]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#AEB8C5]">Horário</label>
                  <input
                    type="time"
                    value={baseTime}
                    onChange={(e) => setBaseTime(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-sm text-[#F4F6F8]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <label className="inline-flex min-h-[46px] cursor-pointer items-center gap-2 rounded-xl bg-[#3B82F6] px-4 py-2 text-xs font-bold text-white hover:bg-[#3B82F6]/90">
                  <Camera className="h-4 w-4" />
                  <span>Fotografar Página(s)</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleAttachFiles('BASE', e.target.files, true)}
                  />
                </label>
                <label className="inline-flex min-h-[46px] cursor-pointer items-center gap-2 rounded-xl border border-[#AEB8C5]/25 bg-[#101B2A] px-4 py-2 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]">
                  <Upload className="h-4 w-4 text-[#F5B91B]" />
                  <span>Anexar Imagem / PDF / Excel / CSV</span>
                  <input
                    type="file"
                    accept="image/*,.pdf,.xlsx,.xls,.csv"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleAttachFiles('BASE', e.target.files, false)}
                  />
                </label>
              </div>

              {basePages.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-[#AEB8C5]">
                    Páginas anexadas ({basePages.length}):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {basePages.map((p, idx) => (
                      <div
                        key={`${p.fileName}-${idx}`}
                        className="flex items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-2.5 py-1.5 text-xs"
                      >
                        {p.previewDataUrl ? (
                          <button
                            type="button"
                            onClick={() => setZoomedPagePreview(p)}
                            title="Ampliar fotografia capturada"
                            className="h-9 w-9 overflow-hidden rounded border border-[#AEB8C5]/25 shrink-0"
                          >
                            <img src={p.previewDataUrl} alt={p.fileName} className="h-full w-full object-cover" />
                          </button>
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-[#60A5FA]" />
                        )}
                        <span className="font-mono-tabular font-bold text-[#F5B91B]">Pág.{p.pageNumber}</span>
                        <span className="max-w-[130px] truncate text-[#F4F6F8]">{p.fileName}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setBasePages((prev) =>
                              prev.filter((_, i) => i !== idx).map((x, n) => ({ ...x, pageNumber: n + 1 }))
                            )
                          }
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Nova Cesta */}
            <div className="space-y-4 rounded-2xl border border-[#F5B91B]/35 bg-[#0A1421] p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                Nova Cesta (Programação Atualizada)
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-[#AEB8C5]">Identificação</label>
                  <input
                    type="text"
                    value={targetLabel}
                    onChange={(e) => setTargetLabel(e.target.value)}
                    placeholder="Ex.: Cesta Atualizada — 19:00"
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-sm text-[#F4F6F8]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#AEB8C5]">Horário</label>
                  <input
                    type="time"
                    value={targetTime}
                    onChange={(e) => setTargetTime(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] px-3 text-sm text-[#F4F6F8]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5">
                <label className="inline-flex min-h-[46px] cursor-pointer items-center gap-2 rounded-xl bg-[#F5B91B] px-4 py-2 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90">
                  <Camera className="h-4 w-4" />
                  <span>Fotografar Página(s)</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleAttachFiles('TARGET', e.target.files, true)}
                  />
                </label>
                <label className="inline-flex min-h-[46px] cursor-pointer items-center gap-2 rounded-xl border border-[#AEB8C5]/25 bg-[#101B2A] px-4 py-2 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]">
                  <Upload className="h-4 w-4 text-[#F5B91B]" />
                  <span>Anexar Imagem / PDF / Excel / CSV</span>
                  <input
                    type="file"
                    accept="image/*,.pdf,.xlsx,.xls,.csv"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleAttachFiles('TARGET', e.target.files, false)}
                  />
                </label>
              </div>

              {targetPages.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-bold text-[#AEB8C5]">
                    Páginas anexadas ({targetPages.length}):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {targetPages.map((p, idx) => (
                      <div
                        key={`${p.fileName}-${idx}`}
                        className="flex items-center gap-2 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-2.5 py-1.5 text-xs"
                      >
                        {p.previewDataUrl ? (
                          <button
                            type="button"
                            onClick={() => setZoomedPagePreview(p)}
                            title="Ampliar fotografia capturada"
                            className="h-9 w-9 overflow-hidden rounded border border-[#AEB8C5]/25 shrink-0"
                          >
                            <img src={p.previewDataUrl} alt={p.fileName} className="h-full w-full object-cover" />
                          </button>
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-[#F5B91B]" />
                        )}
                        <span className="font-mono-tabular font-bold text-[#F5B91B]">Pág.{p.pageNumber}</span>
                        <span className="max-w-[130px] truncate text-[#F4F6F8]">{p.fileName}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setTargetPages((prev) =>
                              prev.filter((_, i) => i !== idx).map((x, n) => ({ ...x, pageNumber: n + 1 }))
                            )
                          }
                          className="text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#AEB8C5]/15 pt-4">
            <button
              type="button"
              disabled={extracting || basePages.length === 0 || targetPages.length === 0}
              onClick={handleExtractBoth}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-[#F5B91B] px-6 py-2.5 text-sm font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-45"
            >
              <span>{extracting ? 'Lendo Cestas com IA / OCR...' : 'Iniciar Leitura e Conferência'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: TELA DE CONFERÊNCIA ANTES DA COMPARAÇÃO */}
      {activeTab === 'CONFERENCIA' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#F5B91B]/35 bg-[#101B2A] p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                TELA DE CONFERÊNCIA ANTES DA COMPARAÇÃO · {productionDate}
              </p>
              <h2 className="font-display text-lg font-extrabold text-[#F4F6F8]">
                Revise os códigos e quantidades extraídos antes de gerar a comparação
              </h2>
              <p className="text-xs text-[#AEB8C5]">
                Campos com baixa confiança ou leitura duvidosa ficam sinalizados em amarelo. A IA nunca inventa valores ilegíveis.
              </p>
            </div>

            <button
              type="button"
              disabled={comparing}
              onClick={handleConfirmAndCompare}
              className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-extrabold text-[#0A1421] hover:bg-emerald-400 disabled:opacity-50"
            >
              <CheckCircle2 className="h-5 w-5" />
              <span>{comparing ? 'Comparando L1–L7...' : 'Confirmar Conferência e Comparar'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {(
              [
                {
                  side: 'BASE' as const,
                  title: `1. ${baseLabel}`,
                  rows: baseDraftItems,
                  pages: basePages,
                  meta: baseExtractionMeta,
                  borderTone: 'border-[#3B82F6]/35',
                },
                {
                  side: 'TARGET' as const,
                  title: `2. ${targetLabel}`,
                  rows: targetDraftItems,
                  pages: targetPages,
                  meta: targetExtractionMeta,
                  borderTone: 'border-[#F5B91B]/35',
                },
              ]
            ).map((panel) => (
              <div
                key={panel.side}
                className={`rounded-2xl border ${panel.borderTone} bg-[#101B2A] p-4 space-y-3`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-extrabold text-[#F4F6F8]">
                      {panel.title} ({panel.rows.length} itens)
                    </h3>
                    {panel.meta?.usedAiModel && (
                      <p className="text-[11px] font-semibold text-[#60A5FA]">
                        Visão Computacional Gemini: {panel.meta.usedAiModel}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        const blank: EditableDraftItem = {
                          localId: `manual-${Date.now()}`,
                          lineCode: 'L4',
                          materialCode: '',
                          materialDescription: '',
                          rawQuantityText: '',
                          plannedQuantityKg: null,
                          unit: 'kg',
                          sourcePage: 1,
                          sourceDocumentName: 'Inserção manual',
                          sourceRegion: 'Conferência',
                          confidence: 'MEDIA',
                          needsReview: true,
                          reviewReason: 'Preencher código e quantidade',
                        };
                        if (panel.side === 'BASE') setBaseDraftItems((p) => [...p, blank]);
                        else setTargetDraftItems((p) => [...p, blank]);
                      }}
                      className="rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-2.5 py-1 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]"
                    >
                      + Adicionar Linha
                    </button>
                  )}
                </div>

                {panel.meta && panel.meta.unreadableFields.length > 0 && (
                  <div className="rounded-xl border border-[#F5B91B]/50 bg-amber-950/30 p-2.5 text-[11px] text-amber-200">
                    <strong className="text-[#F5B91B]">Campos sinalizados como ilegíveis pela IA:</strong>{' '}
                    {panel.meta.unreadableFields.join(' · ')}
                  </div>
                )}

                {panel.pages.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-2">
                    <span className="text-[10px] font-bold uppercase text-[#AEB8C5]">Originais:</span>
                    {panel.pages.map((p, idx) => (
                      <button
                        key={`${p.fileName}-${idx}`}
                        type="button"
                        onClick={() => p.previewDataUrl && setZoomedPagePreview(p)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-2 py-1 text-[11px] text-[#F4F6F8] hover:border-[#F5B91B]"
                      >
                        {p.previewDataUrl ? <Eye className="h-3 w-3 text-[#F5B91B]" /> : <FileText className="h-3 w-3 text-[#60A5FA]" />}
                        <span>Pág.{p.pageNumber}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
                  {panel.rows.map((row) => (
                    <div
                      key={row.localId}
                      className={`rounded-xl border p-3 text-xs ${
                        row.needsReview
                          ? 'border-[#F5B91B]/70 bg-amber-950/25'
                          : 'border-[#AEB8C5]/15 bg-[#0A1421]'
                      }`}
                    >
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-2">
                          <label className="text-[10px] text-[#AEB8C5]">Linha</label>
                          <select
                            disabled={!canEdit}
                            value={row.lineCode}
                            onChange={(e) =>
                              updateDraftRow(panel.side, row.localId, { lineCode: e.target.value })
                            }
                            className="mt-0.5 min-h-[36px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-2 text-xs font-bold text-[#F5B91B]"
                          >
                            {OFFICIAL_PRODUCTION_LINES.map((lc) => (
                              <option key={lc} value={lc}>
                                {lc}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <label className="text-[10px] text-[#AEB8C5]">Código MP</label>
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={row.materialCode}
                            onChange={(e) =>
                              updateDraftRow(panel.side, row.localId, { materialCode: e.target.value })
                            }
                            className="mt-0.5 min-h-[36px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-2 font-mono-tabular text-xs text-[#F4F6F8]"
                          />
                        </div>
                        <div className="col-span-4">
                          <label className="text-[10px] text-[#AEB8C5]">Matéria-Prima</label>
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={row.materialDescription}
                            onChange={(e) =>
                              updateDraftRow(panel.side, row.localId, {
                                materialDescription: e.target.value,
                              })
                            }
                            className="mt-0.5 min-h-[36px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-2 text-xs text-[#F4F6F8]"
                          />
                        </div>
                        <div className="col-span-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] text-[#AEB8C5]">Qtd</label>
                            <select
                              disabled={!canEdit}
                              value={row.unit}
                              onChange={(e) =>
                                updateDraftRow(panel.side, row.localId, { unit: e.target.value })
                              }
                              className="rounded border border-[#AEB8C5]/20 bg-[#101B2A] px-1 text-[10px] font-bold text-[#F5B91B]"
                            >
                              <option value="kg">kg</option>
                              <option value="t">t</option>
                            </select>
                          </div>
                          <input
                            type="text"
                            disabled={!canEdit}
                            value={row.rawQuantityText}
                            onChange={(e) =>
                              updateDraftRow(panel.side, row.localId, {
                                rawQuantityText: e.target.value,
                              })
                            }
                            className="mt-0.5 min-h-[36px] w-full rounded-lg border border-[#AEB8C5]/20 bg-[#101B2A] px-2 text-right font-mono-tabular text-xs font-bold text-emerald-300"
                          />
                        </div>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#AEB8C5]">
                        <span>
                          Origem: Pág. {row.sourcePage}
                          {row.sourceRegion ? ` · ${row.sourceRegion}` : ''} · Confiança: {row.confidence}
                        </span>
                        <div className="flex items-center gap-2">
                          {row.needsReview && (
                            <span className="font-bold text-[#F5B91B]">
                              {row.reviewReason || 'CONFERÊNCIA OBRIGATÓRIA'}
                            </span>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              title="Remover linha"
                              onClick={() => {
                                if (panel.side === 'BASE') {
                                  setBaseDraftItems((prev) => prev.filter((r) => r.localId !== row.localId));
                                } else {
                                  setTargetDraftItems((prev) => prev.filter((r) => r.localId !== row.localId));
                                }
                              }}
                              className="text-red-400 hover:text-red-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: RESULTADO DETALHADO L1-L7 & PUBLICAÇÃO */}
      {activeTab === 'RESULTADO' && selectedComparison && (
        <div className="space-y-5">
          {/* Header com Publicação Oficial */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#AEB8C5]/20 bg-[#101B2A] p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                COMPARAÇÃO LINHA A LINHA (L1–L7) · {selectedComparison.productionDate}
              </p>
              <h2 className="mt-1 font-display text-lg font-extrabold text-[#F4F6F8]">
                {selectedComparison.baseVersionLabel} → {selectedComparison.targetVersionLabel}
              </h2>
              <p className="mt-0.5 font-mono-tabular text-xs text-[#AEB8C5]">
                Total Anterior: {formatBrazilianNumber(selectedComparison.totalPreviousKg, 2)} kg · Total Novo:{' '}
                {formatBrazilianNumber(selectedComparison.totalNewKg, 2)} kg · Diferença:{' '}
                <strong
                  className={
                    selectedComparison.totalDiffKg > 0 ? 'text-orange-300' : 'text-emerald-300'
                  }
                >
                  {formatBrazilianDiff(selectedComparison.totalDiffKg)} kg
                </strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {canExecutive && (
                <button
                  type="button"
                  onClick={() => setActiveTab('GERENCIAL')}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#AEB8C5]/25 bg-[#0A1421] px-4 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]"
                >
                  <BarChart3 className="h-4 w-4 text-[#F5B91B]" />
                  <span>Abrir Painel Gerencial</span>
                </button>
              )}

              {canPublish && (
                <button
                  type="button"
                  disabled={publishing || selectedComparison.status === 'PUBLICADA'}
                  onClick={handlePublishComparison}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-[#F5B91B] px-5 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  <span>
                    {selectedComparison.status === 'PUBLICADA'
                      ? 'PROGRAMAÇÃO PUBLICADA'
                      : publishing
                        ? 'Publicando e Notificando...'
                        : 'PUBLICAR NOVA PROGRAMAÇÃO'}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Filtros de Linha e Classificação */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-3.5">
            <select
              aria-label="Filtrar linha"
              value={lineFilter}
              onChange={(e) => setLineFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-bold text-[#F4F6F8]"
            >
              <option value="ALL">Todas as Linhas (L1–L7)</option>
              {OFFICIAL_PRODUCTION_LINES.map((lc) => (
                <option key={lc} value={lc}>
                  Linha {lc}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar classificação"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-bold text-[#F4F6F8]"
            >
              <option value="ALL">Todas as Classificações</option>
              <option value="AUMENTOU">Somente Aumentos</option>
              <option value="DIMINUIU">Somente Reduções</option>
              <option value="NOVO_MATERIAL">Novos Materiais</option>
              <option value="MATERIAL_RETIRADO">Materiais Retirados</option>
              <option value="MANTIDO">Mantidos</option>
              <option value="PENDENTE_CONFERENCIA">Pendentes de Conferência</option>
            </select>

            <span className="ml-auto text-xs text-[#AEB8C5]">
              Exibindo {filteredDiffItems.length} de {selectedComparison.diffItems.length} registros
            </span>
          </div>

          {/* Tabela Comparativa Linha a Linha */}
          <div className="overflow-x-auto rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A]">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#AEB8C5]/15 bg-[#0A1421] text-[#AEB8C5]">
                  <th className="px-4 py-3 font-bold">Linha</th>
                  <th className="px-3 py-3 font-bold">Código</th>
                  <th className="px-3 py-3 font-bold">Matéria-Prima</th>
                  <th className="px-3 py-3 text-right font-bold">Qtd Anterior</th>
                  <th className="px-3 py-3 text-right font-bold">Qtd Nova</th>
                  <th className="px-3 py-3 text-right font-bold">Diferença</th>
                  <th className="px-3 py-3 text-right font-bold">%</th>
                  <th className="px-4 py-3 font-bold">Classificação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#AEB8C5]/10">
                {filteredDiffItems.map((item) => {
                  const badge = CLASSIFICATION_LABELS[item.classification];
                  return (
                    <tr key={`${item.lineCode}-${item.materialCode}-${item.id}`} className="hover:bg-[#152336]/55">
                      <td className="px-4 py-3 font-mono-tabular font-extrabold text-[#F5B91B]">
                        {item.lineCode}
                      </td>
                      <td className="px-3 py-3 font-mono-tabular text-[#AEB8C5]">
                        {item.materialCode || '—'}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-bold text-[#F4F6F8]">{item.materialDescription}</p>
                        {(item.previousSourceRef || item.newSourceRef) && (
                          <p className="text-[10px] text-[#AEB8C5]">
                            {item.newSourceRef || item.previousSourceRef}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular text-[#AEB8C5]">
                        {item.previousQuantityKg !== null
                          ? `${formatBrazilianNumber(item.previousQuantityKg, 2)} kg`
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular font-bold text-[#F4F6F8]">
                        {item.newQuantityKg !== null
                          ? `${formatBrazilianNumber(item.newQuantityKg, 2)} kg`
                          : '—'}
                      </td>
                      <td
                        className={`px-3 py-3 text-right font-mono-tabular font-extrabold ${
                          (item.diffKg ?? 0) > 0
                            ? 'text-orange-300'
                            : (item.diffKg ?? 0) < 0
                              ? 'text-emerald-300'
                              : 'text-[#AEB8C5]'
                        }`}
                      >
                        {item.diffKg !== null ? `${formatBrazilianDiff(item.diffKg)} kg` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-tabular text-[#AEB8C5]">
                        {item.pctChange !== null
                          ? `${item.pctChange > 0 ? '+' : ''}${item.pctChange}%`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold ${badge.style}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: ANÁLISE GERENCIAL */}
      {activeTab === 'GERENCIAL' && selectedComparison && (
        <BasketExecutiveAnalysis
          comparison={selectedComparison}
          versionsForDate={versionsSameDate}
          canExport={canExport}
          exportingFormat={exportingFormat}
          onExport={handleExport}
        />
      )}

      {/* TAB 5: HISTÓRICO & MÚLTIPLAS VERSÕES */}
      {activeTab === 'HISTORICO' && (
        <div className="space-y-6">
          {/* Seletor rápido entre quaisquer duas versões */}
          <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-extrabold text-[#F4F6F8]">
                  Comparação entre Múltiplas Versões Registradas
                </h2>
                <p className="text-xs text-[#AEB8C5]">
                  Selecione quaisquer duas versões arquivadas ou publicadas (ex.: 07:00 × 11:30 × 15:00 × 19:00) sem perder o histórico anterior.
                </p>
              </div>
              {loadingHistory && (
                <span className="text-xs text-[#F5B91B]">Atualizando histórico...</span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#AEB8C5]">Versão Base</label>
                <select
                  value={histBaseVerId}
                  onChange={(e) => setHistBaseVerId(e.target.value ? Number(e.target.value) : '')}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-bold text-[#F4F6F8]"
                >
                  <option value="">Selecionar versão base...</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.productionDate} · {v.label} ({v.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#AEB8C5]">Versão Atualizada</label>
                <select
                  value={histTargetVerId}
                  onChange={(e) => setHistTargetVerId(e.target.value ? Number(e.target.value) : '')}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-xs font-bold text-[#F4F6F8]"
                >
                  <option value="">Selecionar versão comparada...</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.productionDate} · {v.label} ({v.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  disabled={comparing || !histBaseVerId || !histTargetVerId}
                  onClick={handleCompareExistingVersions}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#F5B91B] px-4 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-45"
                >
                  <GitCompare className="h-4 w-4" />
                  <span>{comparing ? 'Calculando...' : 'Comparar Versões'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Lista de Versões */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-3">
              <h3 className="font-display text-sm font-extrabold text-[#F4F6F8]">
                Versões de Cestas Arquivadas & Publicadas ({versions.length})
              </h3>
              <div className="space-y-2.5">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className={`rounded-xl border p-3.5 text-xs ${
                      v.isCurrentPublished
                        ? 'border-emerald-500/50 bg-emerald-950/20'
                        : 'border-[#AEB8C5]/15 bg-[#0A1421]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-[#F4F6F8]">{v.label}</span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          v.isCurrentPublished
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-[#101B2A] text-[#AEB8C5]'
                        }`}
                      >
                        {v.status}
                      </span>
                    </div>
                    <p className="mt-1 font-mono-tabular text-[11px] text-[#AEB8C5]">
                      Data: {v.productionDate} · Código: {v.versionCode} · Itens: {v.items.length}
                    </p>
                    {v.notes && <p className="mt-1 text-[11px] text-[#AEB8C5]">{v.notes}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-3">
              <h3 className="font-display text-sm font-extrabold text-[#F4F6F8]">
                Comparações Realizadas ({comparisons.length})
              </h3>
              <div className="space-y-2.5">
                {comparisons.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#0A1421] p-3.5 text-xs"
                  >
                    <div>
                      <p className="font-bold text-[#F4F6F8]">
                        {c.baseVersionLabel} → {c.targetVersionLabel}
                      </p>
                      <p className="mt-0.5 font-mono-tabular text-[11px] text-[#AEB8C5]">
                        {c.productionDate} · Dif.: {formatBrazilianDiff(c.totalDiffKg)} kg · {c.status}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedComparison(c);
                          setActiveTab(isOperatorOrProd ? 'OPERADOR' : canExecutive ? 'GERENCIAL' : 'RESULTADO');
                        }}
                        className="min-h-[38px] rounded-lg bg-[#F5B91B] px-3 text-xs font-extrabold text-[#0A1421]"
                      >
                        Abrir Análise
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: VISÃO SIMPLIFICADA PARA OPERADOR / PRODUÇÃO */}
      {activeTab === 'OPERADOR' && selectedComparison && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-[#F5B91B]/35 bg-[#101B2A] p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
              RESUMO SIMPLES PARA A OPERAÇÃO · {selectedComparison.productionDate}
            </p>
            <h2 className="mt-1 font-display text-xl font-extrabold text-[#F4F6F8]">
              O que mudou na programação ({selectedComparison.targetVersionLabel})
            </h2>
            <p className="mt-1 text-sm text-[#AEB8C5]">
              Veja de forma direta quais linhas precisam de mais material, quais reduziram e onde há risco de faltar produto nos silos.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {selectedComparison.diffItems
              .filter((d) => d.classification !== 'MANTIDO')
              .slice(0, 10)
              .map((d) => {
                const isIncrease = (d.diffKg ?? 0) > 0;
                return (
                  <div
                    key={`op-${d.lineCode}-${d.materialCode}-${d.id}`}
                    className={`rounded-2xl border p-4 ${
                      isIncrease
                        ? 'border-orange-500/45 bg-orange-950/20'
                        : 'border-emerald-500/35 bg-[#101B2A]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-lg bg-[#0A1421] px-2.5 py-1 font-mono-tabular text-xs font-extrabold text-[#F5B91B]">
                        Linha {d.lineCode}
                      </span>
                      <span
                        className={`font-mono-tabular text-sm font-extrabold ${
                          isIncrease ? 'text-orange-300' : 'text-emerald-300'
                        }`}
                      >
                        {isIncrease ? 'Precisa de MAIS ' : 'Reduziu '}
                        {formatBrazilianNumber(Math.abs(d.diffKg ?? 0), 0)} kg
                      </span>
                    </div>
                    <p className="mt-2 font-display text-base font-bold text-[#F4F6F8]">
                      {d.materialDescription}
                    </p>
                    <p className="mt-1 font-mono-tabular text-xs text-[#AEB8C5]">
                      Antes: {formatBrazilianNumber(d.previousQuantityKg, 0)} kg → Agora:{' '}
                      {formatBrazilianNumber(d.newQuantityKg, 0)} kg
                    </p>
                  </div>
                );
              })}
          </div>

          {selectedComparison.operationalImpacts.some((o) => o.shortageRisk !== 'OK') && (
            <div className="rounded-2xl border border-red-500/45 bg-red-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-extrabold text-red-200">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                <span>Silos que precisam de atenção imediata na Moega</span>
              </div>
              <div className="space-y-2">
                {selectedComparison.operationalImpacts
                  .filter((o) => o.shortageRisk !== 'OK')
                  .map((imp, idx) => (
                    <div
                      key={`op-imp-${idx}`}
                      className="rounded-xl border border-red-500/25 bg-[#0A1421] p-3 text-xs text-[#F4F6F8]"
                    >
                      <p className="font-bold text-[#F5B91B]">
                        {imp.lineCode} · {imp.materialDescription} ({imp.shortageRisk})
                      </p>
                      <p className="mt-1 text-[#AEB8C5]">{imp.recommendationText}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {zoomedPagePreview && zoomedPagePreview.previewDataUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setZoomedPagePreview(null)}
        >
          <div
            className="max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl border border-[#F5B91B]/45 bg-[#101B2A]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#AEB8C5]/15 px-4 py-3">
              <p className="text-xs font-bold text-[#F4F6F8]">
                Documento Capturado — Pág. {zoomedPagePreview.pageNumber} ({zoomedPagePreview.fileName})
              </p>
              <button
                type="button"
                onClick={() => setZoomedPagePreview(null)}
                aria-label="Fechar prévia ampliada"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0A1421] text-[#AEB8C5] hover:text-[#F4F6F8]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[80vh] overflow-auto bg-[#0A1421] p-3">
              <img
                src={zoomedPagePreview.previewDataUrl}
                alt={zoomedPagePreview.fileName}
                className="mx-auto max-h-[75vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
