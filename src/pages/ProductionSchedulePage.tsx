import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  MaterialItem,
  ParsedScheduleDocumentResponse,
  ProductionScheduleItemView,
  ProductionScheduleView,
  ProductWithFactorsItem,
  ScheduleTemplateItem,
  SessionData,
} from '../types/nexo.ts';
import { apiFetch, formatKg } from '../lib/api.ts';
import { DocumentCaptureModal } from '../components/schedules/DocumentCaptureModal.tsx';
import { ExecutionStatus } from '../lib/production-intelligence.ts';

interface ProductionSchedulePageProps {
  session: SessionData;
  materials: MaterialItem[];
  canImport: boolean;
  canApprove: boolean;
  canUpdateExecution: boolean;
  onNavigateToConsumption: () => void;
}

interface LineOption {
  id: number;
  code: string;
  name: string;
}

interface EditableConferenceItem {
  key: string;
  productionLineId: number;
  lineCode: string;
  sequenceOrder: number;
  productCode: string;
  productDescription: string;
  materialCode: string;
  plannedQuantity: string;
  plannedUnit: 't' | 'kg' | 'batelada';
  scheduledTimeWindow: string;
  confidence: 'ALTA' | 'MEDIA' | 'BAIXA' | 'MANUAL';
  needsReview: boolean;
  reviewReason: string | null;
}

const EXECUTION_STATUS_META: Record<
  ExecutionStatus,
  { label: string; colorClass: string }
> = {
  NAO_INICIADA: {
    label: 'Não iniciada',
    colorClass: 'border-[#AEB8C5]/30 bg-[#081321] text-[#AEB8C5]',
  },
  EM_ANDAMENTO: {
    label: 'Em andamento',
    colorClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  },
  CONCLUIDA: {
    label: 'Concluída',
    colorClass: 'border-emerald-400 bg-emerald-500/20 text-emerald-200',
  },
  ATRASADA: {
    label: 'Atrasada',
    colorClass: 'border-red-500/50 bg-red-500/15 text-red-200',
  },
  ADIANTADA: {
    label: 'Adiantada',
    colorClass: 'border-[#F5B817]/50 bg-[#F5B817]/15 text-[#F5B817]',
  },
  INTERROMPIDA: {
    label: 'Interrompida',
    colorClass: 'border-red-500 bg-red-500/20 text-red-100',
  },
};

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export const ProductionSchedulePage: React.FC<ProductionSchedulePageProps> = ({
  session,
  materials,
  canImport,
  canApprove,
  canUpdateExecution,
  onNavigateToConsumption,
}) => {
  const todayDate = session.shift.operationalDate;
  const tomorrowDate = addDays(todayDate, 1);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [lines, setLines] = useState<LineOption[]>([]);
  const [templates, setTemplates] = useState<ScheduleTemplateItem[]>([]);
  const [products, setProducts] = useState<ProductWithFactorsItem[]>([]);
  const [schedules, setSchedules] = useState<ProductionScheduleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Entry & Conferência State
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [captureModalOpen, setCaptureModalOpen] = useState(false);
  const [parsingDoc, setParsingDoc] = useState(false);
  const [conferenceOpen, setConferenceOpen] = useState(false);
  const [docPreviewDataUrl, setDocPreviewDataUrl] = useState<string | null>(null);
  const [docPreviewMime, setDocPreviewMime] = useState<string>('');
  const [parsedDoc, setParsedDoc] = useState<ParsedScheduleDocumentResponse | null>(null);

  const [confRefDate, setConfRefDate] = useState<string>(todayDate);
  const [confReportType, setConfReportType] = useState<string>('PROGRAMACAO');
  const [confNotes, setConfNotes] = useState<string>('');
  const [confItems, setConfItems] = useState<EditableConferenceItem[]>([]);
  const [savingDraft, setSavingDraft] = useState(false);

  // View tabs
  const [horizonTab, setHorizonTab] = useState<'HOJE' | 'AMANHA' | 'TODAS' | 'RASCUNHOS' | 'REVISOES'>('HOJE');

  // Execution status modal
  const [editingItem, setEditingItem] = useState<ProductionScheduleItemView | null>(null);
  const [execStatus, setExecStatus] = useState<ExecutionStatus>('EM_ANDAMENTO');
  const [execRealizedQty, setExecRealizedQty] = useState<string>('0');
  const [execReason, setExecReason] = useState<string>('');
  const [savingExec, setSavingExec] = useState(false);

  // Original archived doc modal
  const [viewingDoc, setViewingDoc] = useState<{
    fileName: string;
    mimeType: string;
    fileContentBase64: string | null;
    extractedTextPreview: string | null;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [linesRes, tplRes, prodRes, schedRes] = await Promise.all([
        apiFetch<LineOption[]>('/api/lines'),
        apiFetch<ScheduleTemplateItem[]>('/api/schedule-templates'),
        apiFetch<ProductWithFactorsItem[]>('/api/products'),
        apiFetch<ProductionScheduleView[]>('/api/schedules'),
      ]);
      setLines(linesRes);
      setTemplates(tplRes);
      if (tplRes.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(String(tplRes[0].id));
      }
      setProducts(prodRes);
      setSchedules(schedRes);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar programações da produção.');
    } finally {
      setLoading(false);
    }
  }, [selectedTemplateId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const applyParsedResponseToConference = (
    resp: ParsedScheduleDocumentResponse,
    previewUrl: string | null,
    mime: string
  ) => {
    setParsedDoc(resp);
    setDocPreviewDataUrl(previewUrl);
    setDocPreviewMime(mime);
    setConfRefDate(resp.extraction.productionDate || todayDate);
    setConfReportType(resp.extraction.documentCategory || 'PROGRAMACAO');
    setConfNotes(resp.extraction.documentNotes || '');

    const defaultLine = lines[0] || { id: 1, code: 'L1' };
    const mapped: EditableConferenceItem[] = resp.extraction.items.map((it, idx) => {
      const matchedLine =
        lines.find((l) => l.code.toUpperCase() === (it.lineCode || '').toUpperCase()) || defaultLine;
      const unitRaw = (it.plannedUnit || '').toLowerCase();
      const normalizedUnit: 't' | 'kg' | 'batelada' =
        unitRaw === 'kg' ? 'kg' : unitRaw === 'batelada' ? 'batelada' : 't';
      return {
        key: `ext-${idx}-${Date.now()}`,
        productionLineId: it.productionLineId ?? matchedLine.id,
        lineCode: it.lineCode || matchedLine.code,
        sequenceOrder: it.sequenceOrder || idx + 1,
        productCode: it.productCode || '',
        productDescription: it.productDescription || '',
        materialCode: it.materialCode || '',
        plannedQuantity: it.plannedQuantity !== null ? String(it.plannedQuantity) : '',
        plannedUnit: normalizedUnit,
        scheduledTimeWindow: it.scheduledTimeWindow || '',
        confidence: it.confidence,
        needsReview: it.needsReview,
        reviewReason: it.reviewReason,
      };
    });

    if (mapped.length === 0) {
      mapped.push({
        key: `empty-${Date.now()}`,
        productionLineId: defaultLine.id,
        lineCode: defaultLine.code,
        sequenceOrder: 1,
        productCode: '',
        productDescription: '',
        materialCode: '',
        plannedQuantity: '',
        plannedUnit: 't',
        scheduledTimeWindow: '',
        confidence: 'BAIXA',
        needsReview: true,
        reviewReason: 'Nenhum item legível extraído automaticamente. Preencha manualmente.',
      });
    }

    setConfItems(mapped);
    setConferenceOpen(true);
  };

  const submitDocumentForParsing = async (payload: {
    fileName: string;
    mimeType: string;
    sourceType: 'FOTO_TABLET' | 'ARQUIVO_PDF' | 'ARQUIVO_IMAGEM' | 'ARQUIVO_XLSX' | 'ARQUIVO_CSV';
    fileBase64?: string;
    rawCsvText?: string;
    previewUrl: string | null;
  }) => {
    setParsingDoc(true);
    setFeedback(null);
    const tpl = templates.find((t) => String(t.id) === selectedTemplateId);
    try {
      const res = await apiFetch<ParsedScheduleDocumentResponse>('/api/schedules/parse-document', {
        method: 'POST',
        body: JSON.stringify({
          fileName: payload.fileName,
          mimeType: payload.mimeType,
          sourceType: payload.sourceType,
          documentCategory: tpl?.documentCategory || 'PROGRAMACAO',
          templateId: tpl?.id ?? null,
          fileBase64: payload.fileBase64,
          rawCsvText: payload.rawCsvText,
        }),
      });
      applyParsedResponseToConference(res, payload.previewUrl, payload.mimeType);
    } catch (err: any) {
      setFeedback({
        type: 'err',
        msg: err.message || 'Falha ao interpretar documento.',
      });
    } finally {
      setParsingDoc(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const b64 = btoa(unescape(encodeURIComponent(text)));
        submitDocumentForParsing({
          fileName: file.name,
          mimeType: 'text/csv',
          sourceType: 'ARQUIVO_CSV',
          rawCsvText: text,
          fileBase64: `data:text/csv;base64,${b64}`,
          previewUrl: null,
        });
      };
      reader.readAsText(file, 'utf-8');
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        let sourceType: 'ARQUIVO_PDF' | 'ARQUIVO_IMAGEM' | 'ARQUIVO_XLSX' = 'ARQUIVO_IMAGEM';
        let mimeType = file.type || 'application/octet-stream';
        if (ext === 'pdf' || mimeType.includes('pdf')) {
          sourceType = 'ARQUIVO_PDF';
          mimeType = 'application/pdf';
        } else if (ext === 'xlsx' || ext === 'xls' || mimeType.includes('spreadsheet')) {
          sourceType = 'ARQUIVO_XLSX';
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
        submitDocumentForParsing({
          fileName: file.name,
          mimeType,
          sourceType,
          fileBase64: dataUrl,
          previewUrl: sourceType === 'ARQUIVO_XLSX' ? null : dataUrl,
        });
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const openManualEntry = () => {
    const defaultLine = lines[0] || { id: 1, code: 'L1' };
    setParsedDoc(null);
    setDocPreviewDataUrl(null);
    setDocPreviewMime('');
    setConfRefDate(todayDate);
    setConfReportType('PROGRAMACAO');
    setConfNotes('');
    setConfItems([
      {
        key: `manual-${Date.now()}`,
        productionLineId: defaultLine.id,
        lineCode: defaultLine.code,
        sequenceOrder: 1,
        productCode: '',
        productDescription: '',
        materialCode: '',
        plannedQuantity: '',
        plannedUnit: 't',
        scheduledTimeWindow: '',
        confidence: 'MANUAL',
        needsReview: false,
        reviewReason: null,
      },
    ]);
    setConferenceOpen(true);
  };

  const addManualRow = () => {
    const defaultLine = lines[0] || { id: 1, code: 'L1' };
    setConfItems((prev) => [
      ...prev,
      {
        key: `row-${Date.now()}-${prev.length}`,
        productionLineId: defaultLine.id,
        lineCode: defaultLine.code,
        sequenceOrder: prev.length + 1,
        productCode: '',
        productDescription: '',
        materialCode: '',
        plannedQuantity: '',
        plannedUnit: 't',
        scheduledTimeWindow: '',
        confidence: 'MANUAL',
        needsReview: false,
        reviewReason: null,
      },
    ]);
  };

  const handleSaveSchedule = async (approveImmediately: boolean) => {
    setFeedback(null);
    const validItems = confItems.filter(
      (it) => it.productCode.trim() && Number(it.plannedQuantity) > 0
    );
    if (validItems.length === 0) {
      setFeedback({
        type: 'err',
        msg: 'Informe ao menos um item com código do produto/MP e quantidade maior que zero.',
      });
      return;
    }

    setSavingDraft(true);
    try {
      const draft = await apiFetch<{ id: number; scheduleCode: string }>('/api/schedules/draft', {
        method: 'POST',
        body: JSON.stringify({
          referenceDate: confRefDate,
          documentId: parsedDoc?.documentId ?? null,
          sourceReportType: confReportType,
          notes: confNotes || null,
          items: validItems.map((it, idx) => {
            const matchedProd = products.find(
              (p) => p.code.toUpperCase() === it.productCode.trim().toUpperCase()
            );
            const matchedMat = materials.find(
              (m) => m.code.toUpperCase() === it.materialCode.trim().toUpperCase()
            );
            return {
              productionLineId: it.productionLineId,
              sequenceOrder: it.sequenceOrder || idx + 1,
              productId: matchedProd?.id ?? null,
              productCode: it.productCode.trim().toUpperCase(),
              productDescription:
                it.productDescription.trim().toUpperCase() ||
                matchedProd?.description ||
                matchedMat?.description ||
                it.productCode.trim().toUpperCase(),
              materialId: matchedMat?.id ?? null,
              materialCode: it.materialCode.trim() ? it.materialCode.trim().toUpperCase() : null,
              plannedQuantity: Number(it.plannedQuantity),
              plannedUnit: it.plannedUnit,
              scheduledTimeWindow: it.scheduledTimeWindow || null,
              extractionConfidence: it.confidence,
              needsReview: false,
              reviewReason: it.reviewReason,
            };
          }),
        }),
      });

      if (approveImmediately && canApprove) {
        const approvalRes = await apiFetch<{
          schedule: { scheduleCode: string; revisionNumber: number };
          diff: { alertTitle: string | null; summaryText: string };
        }>(`/api/schedules/${draft.id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ approvalNotes: confNotes || undefined }),
        });
        setFeedback({
          type: 'ok',
          msg: approvalRes.diff.alertTitle
            ? `${approvalRes.diff.alertTitle} Programação ${approvalRes.schedule.scheduleCode} (Rev. ${approvalRes.schedule.revisionNumber}) aprovada.`
            : `Programação ${approvalRes.schedule.scheduleCode} (Rev. ${approvalRes.schedule.revisionNumber}) aprovada e cálculo de consumo gerado.`,
        });
      } else {
        setFeedback({
          type: 'ok',
          msg: `Rascunho ${draft.scheduleCode} salvo para conferência e aprovação da supervisão.`,
        });
      }

      setConferenceOpen(false);
      setParsedDoc(null);
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao salvar programação.' });
    } finally {
      setSavingDraft(false);
    }
  };

  const handleApproveExistingDraft = async (scheduleId: number) => {
    setFeedback(null);
    try {
      const res = await apiFetch<{
        schedule: { scheduleCode: string; revisionNumber: number };
        diff: { alertTitle: string | null; summaryText: string };
      }>(`/api/schedules/${scheduleId}/approve`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setFeedback({
        type: 'ok',
        msg: res.diff.alertTitle
          ? `${res.diff.alertTitle} (${res.schedule.scheduleCode} · Rev. ${res.schedule.revisionNumber})`
          : `Programação ${res.schedule.scheduleCode} aprovada com sucesso.`,
      });
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao aprovar rascunho.' });
    }
  };

  const handleSaveExecution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || execReason.trim().length < 3) return;
    setSavingExec(true);
    try {
      await apiFetch(`/api/schedule-items/${editingItem.id}/execution`, {
        method: 'PATCH',
        body: JSON.stringify({
          executionStatus: execStatus,
          realizedQuantity: Number(execRealizedQty || 0),
          reason: execReason.trim(),
        }),
      });
      setEditingItem(null);
      setExecReason('');
      setFeedback({
        type: 'ok',
        msg: 'Status de execução e quantidade realizada atualizados na projeção.',
      });
      await loadData();
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao atualizar execução.' });
    } finally {
      setSavingExec(false);
    }
  };

  const handleViewArchivedDoc = async (documentId: number) => {
    try {
      const doc = await apiFetch<{
        fileName: string;
        mimeType: string;
        fileContentBase64: string | null;
        extractedTextPreview: string | null;
      }>(`/api/schedule-documents/${documentId}`);
      setViewingDoc(doc);
    } catch (err: any) {
      setFeedback({ type: 'err', msg: err.message || 'Erro ao abrir documento.' });
    }
  };

  const filteredSchedules = schedules.filter((s) => {
    if (horizonTab === 'HOJE') return s.status === 'APROVADA' && s.referenceDate === todayDate;
    if (horizonTab === 'AMANHA') return s.status === 'APROVADA' && s.referenceDate === tomorrowDate;
    if (horizonTab === 'TODAS') return s.status === 'APROVADA';
    if (horizonTab === 'RASCUNHOS') return s.status === 'RASCUNHO_CONFERENCIA';
    return true; // REVISOES mostra todas incluindo SUPERSEDED
  });

  const draftsCount = schedules.filter((s) => s.status === 'RASCUNHO_CONFERENCIA').length;

  return (
    <div className="space-y-6">
      {/* Header & 3 Entry Buttons */}
      <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[#F5B817]">
              MÓDULO FASE 3 · LINHAS L1 A L7
            </p>
            <h2 className="mt-1 font-display text-2xl font-bold text-white">
              PROGRAMAÇÃO DA PRODUÇÃO
            </h2>
            <p className="mt-1 text-xs text-[#AEB8C5]">
              Importação por fotografia do tablet, PDF, imagem, XLSX/CSV ou cadastro manual com conferência obrigatória e controle de revisões.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onNavigateToConsumption}
              className="min-h-[44px] rounded-lg border border-[#F5B817]/40 bg-[#081321] px-4 py-2 text-xs font-bold text-[#F5B817] hover:bg-[#F5B817]/10"
            >
              Ver Confronto Consumo × Estoque →
            </button>
            <button
              type="button"
              onClick={loadData}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[#AEB8C5]/25 bg-[#081321] text-[#AEB8C5] hover:text-white"
              title="Atualizar programações"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Configurable Template Selector + Action Buttons */}
        {canImport && (
          <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[#AEB8C5]/15 pt-4 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <label className="mb-1 block text-[11px] font-semibold uppercase text-[#AEB8C5]">
                Modelo Documental (Sensor Sistemas / Planilha)
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="min-h-[48px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-white focus:border-[#F5B817] focus:outline-none"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-end gap-2.5 lg:col-span-8">
              <button
                type="button"
                disabled={parsingDoc}
                onClick={() => setCaptureModalOpen(true)}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-[#F5B817] px-4 py-2.5 text-sm font-bold text-[#081321] hover:bg-[#F5B817]/90 disabled:opacity-50"
              >
                <Camera className="h-5 w-5" />
                <span>{parsingDoc ? 'LENDO DOCUMENTO...' : 'FOTOGRAFAR PROGRAMAÇÃO'}</span>
              </button>

              <button
                type="button"
                disabled={parsingDoc}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border border-[#3B82F6]/60 bg-[#3B82F6]/15 px-4 py-2.5 text-sm font-bold text-white hover:bg-[#3B82F6]/25 disabled:opacity-50"
              >
                <Upload className="h-5 w-5 text-[#3B82F6]" />
                <span>IMPORTAR PDF / XLSX / CSV / IMG</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,application/pdf,image/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              <button
                type="button"
                onClick={openManualEntry}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-[#AEB8C5]/30 bg-[#081321] px-4 py-2.5 text-sm font-semibold text-white hover:border-[#F5B817]"
              >
                <Plus className="h-5 w-5 text-[#F5B817]" />
                <span>CADASTRO MANUAL</span>
              </button>
            </div>
          </div>
        )}

        {feedback && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm ${
              feedback.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-100'
                : 'border-red-500/40 bg-red-500/15 text-red-100'
            }`}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
            )}
            <span>{feedback.msg}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/15 p-3 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>

      {/* Tela de Conferência Antes da Importação */}
      {conferenceOpen && (
        <div className="rounded-xl border-2 border-[#F5B817]/60 bg-[#102235] p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
            <div>
              <p className="text-xs font-bold uppercase text-[#F5B817]">
                CONFERÊNCIA OBRIGATÓRIA ANTES DA INCORPORAÇÃO
              </p>
              <h3 className="font-display text-lg font-bold text-white">
                {parsedDoc ? `Documento: ${parsedDoc.fileName}` : 'Cadastro Manual da Programação'}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setConferenceOpen(false)}
              className="min-h-[40px] rounded-lg border border-[#AEB8C5]/30 px-3 py-1.5 text-xs text-[#AEB8C5] hover:text-white"
            >
              Cancelar Conferência
            </button>
          </div>

          {/* Revision Diff Warning */}
          {parsedDoc?.existingRevisionPreview?.diff.hasChanges && (
            <div className="rounded-lg border border-[#F5B817] bg-[#F5B817]/15 p-4 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-[#F5B817] text-sm">
                <AlertTriangle className="h-5 w-5" />
                <span>NOVA REVISÃO DA PROGRAMAÇÃO IDENTIFICADA.</span>
              </div>
              <p className="text-white">
                Já existe uma programação aprovada para esta data (
                {parsedDoc.existingRevisionPreview.previousScheduleCode} · Rev.{' '}
                {parsedDoc.existingRevisionPreview.previousRevisionNumber}). O histórico anterior
                será preservado.
              </p>
              <ul className="list-disc pl-5 text-[#AEB8C5] space-y-1">
                {parsedDoc.existingRevisionPreview.diff.itemChanges.map((chg, idx) => (
                  <li key={idx}>
                    <strong className="text-white">{chg.lineCode}</strong> ({chg.changeType}):{' '}
                    {chg.previousProduct ? `${chg.previousProduct} (${chg.previousQuantity} ${chg.unit})` : 'Novo item'}{' '}
                    → {chg.newProduct ? `${chg.newProduct} (${chg.newQuantity} ${chg.unit})` : 'Removido'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {parsedDoc?.extraction.unreadableOrAmbiguousFields &&
            parsedDoc.extraction.unreadableOrAmbiguousFields.length > 0 && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                <strong>Campos com baixa legibilidade ou ausentes no documento:</strong>{' '}
                {parsedDoc.extraction.unreadableOrAmbiguousFields.join(', ')}. Confira e preencha
                manualmente antes de confirmar.
              </div>
            )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Documento Original Lado a Lado */}
            {parsedDoc && (
              <div className="lg:col-span-4 space-y-2">
                <p className="text-xs font-bold uppercase text-[#AEB8C5]">
                  Documento Original Preservado
                </p>
                <div className="rounded-xl border border-[#AEB8C5]/20 bg-[#081321] p-3 max-h-[420px] overflow-auto">
                  {docPreviewDataUrl && docPreviewMime.includes('image') ? (
                    <img
                      src={docPreviewDataUrl}
                      alt={parsedDoc.fileName}
                      className="w-full rounded object-contain"
                    />
                  ) : docPreviewDataUrl && docPreviewMime.includes('pdf') ? (
                    <iframe
                      title={parsedDoc.fileName}
                      src={docPreviewDataUrl}
                      className="h-[380px] w-full rounded border-0"
                    />
                  ) : parsedDoc.extractedTextPreview ? (
                    <pre className="whitespace-pre-wrap font-mono text-[11px] text-[#AEB8C5]">
                      {parsedDoc.extractedTextPreview}
                    </pre>
                  ) : (
                    <p className="text-xs text-[#AEB8C5]">
                      Pré-visualização indisponível para este formato; registro salvo em banco.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Formulário de Conferência */}
            <div className={parsedDoc ? 'lg:col-span-8 space-y-4' : 'lg:col-span-12 space-y-4'}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#AEB8C5]">
                    Data de Produção
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="date"
                      value={confRefDate}
                      onChange={(e) => setConfRefDate(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setConfRefDate(todayDate)}
                      className="rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-2.5 text-xs text-[#F5B817]"
                    >
                      Hoje
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfRefDate(tomorrowDate)}
                      className="rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-2.5 text-xs text-[#3B82F6]"
                    >
                      Amanhã
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#AEB8C5]">
                    Tipo de Documento
                  </label>
                  <select
                    value={confReportType}
                    onChange={(e) => setConfReportType(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-white"
                  >
                    <option value="PROGRAMACAO">Programação Diária</option>
                    <option value="RELATORIO_PRODUCAO">Relatório Produção (Sensor)</option>
                    <option value="RELATORIO_CONSUMO">Relatório Consumo</option>
                    <option value="REVISAO">Revisão / Aditivo</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[#AEB8C5]">
                    Observações do Documento
                  </label>
                  <input
                    type="text"
                    value={confNotes}
                    onChange={(e) => setConfNotes(e.target.value)}
                    placeholder="Ex.: Alteração de turno, observações manuscritas..."
                    className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-white"
                  />
                </div>
              </div>

              {/* Itens Extraídos / Editáveis */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase text-[#AEB8C5]">
                    Itens por Linha ({confItems.length})
                  </p>
                  <button
                    type="button"
                    onClick={addManualRow}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[#F5B817]/40 px-3 text-xs font-bold text-[#F5B817]"
                  >
                    <Plus className="h-4 w-4" />
                    Adicionar Linha
                  </button>
                </div>

                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {confItems.map((item, idx) => (
                    <div
                      key={item.key}
                      className={`rounded-lg border p-3 space-y-2 ${
                        item.confidence === 'BAIXA'
                          ? 'border-red-500/60 bg-red-500/10'
                          : item.needsReview
                            ? 'border-[#F5B817]/60 bg-[#F5B817]/10'
                            : 'border-[#AEB8C5]/20 bg-[#081321]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-mono-tabular font-bold text-[#F5B817]">
                          Seq. #{idx + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                              item.confidence === 'ALTA'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : item.confidence === 'MEDIA'
                                  ? 'bg-[#F5B817]/20 text-[#F5B817]'
                                  : item.confidence === 'MANUAL'
                                    ? 'bg-[#3B82F6]/20 text-[#3B82F6]'
                                    : 'bg-red-500/20 text-red-200'
                            }`}
                          >
                            Confiança: {item.confidence}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setConfItems((prev) => prev.filter((x) => x.key !== item.key))
                            }
                            className="text-[#AEB8C5] hover:text-red-300"
                            title="Remover linha"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {item.reviewReason && (
                        <p className="text-[11px] font-medium text-[#F5B817]">
                          Conferir: {item.reviewReason}
                        </p>
                      )}

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                        <div>
                          <label className="text-[10px] text-[#AEB8C5]">Linha</label>
                          <select
                            value={item.productionLineId}
                            onChange={(e) => {
                              const lid = Number(e.target.value);
                              const lObj = lines.find((l) => l.id === lid);
                              setConfItems((prev) =>
                                prev.map((r) =>
                                  r.key === item.key
                                    ? { ...r, productionLineId: lid, lineCode: lObj?.code || '' }
                                    : r
                                )
                              );
                            }}
                            className="min-h-[40px] w-full rounded border border-[#AEB8C5]/25 bg-[#102235] px-2 text-xs text-white"
                          >
                            {lines.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.code} — {l.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] text-[#AEB8C5]">Cód. Produto</label>
                          <input
                            type="text"
                            value={item.productCode}
                            onChange={(e) =>
                              setConfItems((prev) =>
                                prev.map((r) =>
                                  r.key === item.key ? { ...r, productCode: e.target.value } : r
                                )
                              )
                            }
                            placeholder="Ex.: RAC-01"
                            className="min-h-[40px] w-full rounded border border-[#AEB8C5]/25 bg-[#102235] px-2 text-xs text-white"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="text-[10px] text-[#AEB8C5]">Descrição Produto</label>
                          <input
                            type="text"
                            value={item.productDescription}
                            onChange={(e) =>
                              setConfItems((prev) =>
                                prev.map((r) =>
                                  r.key === item.key
                                    ? { ...r, productDescription: e.target.value }
                                    : r
                                )
                              )
                            }
                            placeholder="Descrição do produto"
                            className="min-h-[40px] w-full rounded border border-[#AEB8C5]/25 bg-[#102235] px-2 text-xs text-white"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-[#AEB8C5]">Qtd. Prev.</label>
                          <input
                            type="number"
                            step="0.001"
                            value={item.plannedQuantity}
                            onChange={(e) =>
                              setConfItems((prev) =>
                                prev.map((r) =>
                                  r.key === item.key ? { ...r, plannedQuantity: e.target.value } : r
                                )
                              )
                            }
                            placeholder="0"
                            className="min-h-[40px] w-full rounded border border-[#AEB8C5]/25 bg-[#102235] px-2 font-mono-tabular text-xs text-white"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-[#AEB8C5]">Unidade</label>
                          <select
                            value={item.plannedUnit}
                            onChange={(e) =>
                              setConfItems((prev) =>
                                prev.map((r) =>
                                  r.key === item.key
                                    ? {
                                        ...r,
                                        plannedUnit: e.target.value as 't' | 'kg' | 'batelada',
                                      }
                                    : r
                                )
                              )
                            }
                            className="min-h-[40px] w-full rounded border border-[#AEB8C5]/25 bg-[#102235] px-2 text-xs text-white"
                          >
                            <option value="t">t (Toneladas)</option>
                            <option value="kg">kg (Quilos)</option>
                            <option value="batelada">batelada</option>
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="text-[10px] text-[#AEB8C5]">
                            Matéria-Prima Direta (opcional se produto sem fator)
                          </label>
                          <select
                            value={item.materialCode}
                            onChange={(e) =>
                              setConfItems((prev) =>
                                prev.map((r) =>
                                  r.key === item.key ? { ...r, materialCode: e.target.value } : r
                                )
                              )
                            }
                            className="min-h-[40px] w-full rounded border border-[#AEB8C5]/25 bg-[#102235] px-2 text-xs text-white"
                          >
                            <option value="">-- Usar Fator do Produto --</option>
                            {materials.map((m) => (
                              <option key={m.id} value={m.code}>
                                {m.code} — {m.description}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="text-[10px] text-[#AEB8C5]">Horário / Turno Previsto</label>
                          <input
                            type="text"
                            value={item.scheduledTimeWindow}
                            onChange={(e) =>
                              setConfItems((prev) =>
                                prev.map((r) =>
                                  r.key === item.key
                                    ? { ...r, scheduledTimeWindow: e.target.value }
                                    : r
                                )
                              )
                            }
                            placeholder="Ex.: 08:00 - 14:00 (1º Turno)"
                            className="min-h-[40px] w-full rounded border border-[#AEB8C5]/25 bg-[#102235] px-2 text-xs text-white"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-[#AEB8C5]/15 pt-4">
                <button
                  type="button"
                  disabled={savingDraft}
                  onClick={() => handleSaveSchedule(false)}
                  className="min-h-[48px] rounded-lg border border-[#AEB8C5]/30 bg-[#081321] px-5 py-2 text-sm font-semibold text-white hover:border-[#F5B817] disabled:opacity-50"
                >
                  Salvar Rascunho para Conferência
                </button>
                {canApprove && (
                  <button
                    type="button"
                    disabled={savingDraft}
                    onClick={() => handleSaveSchedule(true)}
                    className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-emerald-500 px-6 py-2 text-sm font-bold text-[#081321] hover:bg-emerald-400 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-5 w-5" />
                    <span>CONFERIR E APROVAR PROGRAMAÇÃO</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Horizon & Revisions Tabs */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: 'HOJE', label: `Hoje (${todayDate})` },
            { id: 'AMANHA', label: `Amanhã (${tomorrowDate})` },
            { id: 'TODAS', label: 'Aprovadas / Futuras' },
            { id: 'RASCUNHOS', label: `Aguardando Aprovação (${draftsCount})` },
            { id: 'REVISOES', label: 'Histórico de Revisões' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setHorizonTab(tab.id)}
            className={`min-h-[44px] rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              horizonTab === tab.id
                ? 'bg-[#F5B817] text-[#081321]'
                : 'border border-[#AEB8C5]/20 bg-[#102235] text-[#AEB8C5] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Schedules List */}
      {filteredSchedules.length === 0 ? (
        <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-8 text-center space-y-2">
          <Calendar className="mx-auto h-10 w-10 text-[#AEB8C5]/40" />
          <p className="text-sm font-semibold text-white">
            Nenhuma programação registrada nesta visualização.
          </p>
          <p className="text-xs text-[#AEB8C5]">
            Importe um arquivo (PDF/XLSX/CSV/Imagem), fotografe a folha impressa ou faça um cadastro manual.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredSchedules.map((sched) => (
            <div
              key={sched.id}
              className="rounded-xl border border-[#AEB8C5]/15 bg-[#102235] p-5 space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-tabular text-sm font-bold text-[#F5B817]">
                      {sched.scheduleCode}
                    </span>
                    <span className="rounded bg-[#081321] px-2 py-0.5 font-mono-tabular text-xs font-semibold text-white">
                      Data: {sched.referenceDate}
                    </span>
                    <span className="rounded bg-[#3B82F6]/20 px-2 py-0.5 text-xs font-bold text-[#3B82F6]">
                      Rev. {sched.revisionNumber}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${
                        sched.status === 'APROVADA'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : sched.status === 'RASCUNHO_CONFERENCIA'
                            ? 'bg-[#F5B817]/20 text-[#F5B817]'
                            : 'bg-[#AEB8C5]/20 text-[#AEB8C5]'
                      }`}
                    >
                      {sched.status === 'APROVADA'
                        ? 'Aprovada'
                        : sched.status === 'RASCUNHO_CONFERENCIA'
                          ? 'Aguardando Aprovação'
                          : 'Substituída (Histórico)'}
                    </span>
                  </div>
                  <p className="text-xs text-[#AEB8C5]">
                    Importada por <strong className="text-white">{sched.importedByName}</strong>
                    {sched.approvedByName && (
                      <>
                        {' '}
                        · Aprovada por <strong className="text-white">{sched.approvedByName}</strong>
                      </>
                    )}
                    {sched.documentMeta && <> · Doc: {sched.documentMeta.fileName}</>}
                  </p>
                  {sched.revisionDiffSummary && (
                    <p className="text-xs text-[#F5B817]">
                      <History className="mr-1 inline h-3.5 w-3.5" />
                      {sched.revisionDiffSummary}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {sched.documentId && (
                    <button
                      type="button"
                      onClick={() => handleViewArchivedDoc(sched.documentId!)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-xs font-semibold text-[#AEB8C5] hover:text-white"
                    >
                      <Eye className="h-4 w-4 text-[#F5B817]" />
                      <span>Ver Documento Original</span>
                    </button>
                  )}
                  {sched.status === 'RASCUNHO_CONFERENCIA' && canApprove && (
                    <button
                      type="button"
                      onClick={() => handleApproveExistingDraft(sched.id)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-emerald-500 px-4 text-xs font-bold text-[#081321] hover:bg-emerald-400"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Aprovar Programação</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#AEB8C5]/15 text-[#AEB8C5]">
                      <th className="py-2 pr-3">Linha</th>
                      <th className="px-3 py-2">Produto / Fórmula</th>
                      <th className="px-3 py-2 text-right">Programado</th>
                      <th className="px-3 py-2 text-right">Realizado</th>
                      <th className="px-3 py-2 text-right">Consumo Previsto (MP)</th>
                      <th className="px-3 py-2">Execução</th>
                      {canUpdateExecution && sched.status === 'APROVADA' && (
                        <th className="pl-3 py-2 text-right">Ação</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#AEB8C5]/10">
                    {sched.items.map((item) => {
                      const totalCalcKg = item.projections.reduce(
                        (s, p) => s + p.calculatedConsumptionKg,
                        0
                      );
                      const hasPendingFactor = item.projections.some(
                        (p) => p.calculationStatus === 'PENDENTE_FATOR'
                      );
                      const statusMeta = EXECUTION_STATUS_META[item.executionStatus];

                      return (
                        <tr key={item.id} className="hover:bg-[#081321]/50">
                          <td className="py-2.5 pr-3">
                            <span className="font-mono-tabular font-bold text-[#F5B817]">
                              {item.lineCode}
                            </span>
                            {item.scheduledTimeWindow && (
                              <p className="text-[10px] text-[#AEB8C5]">
                                {item.scheduledTimeWindow}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-semibold text-white">
                              {item.productCode} — {item.productDescription}
                            </p>
                            {item.materialCode && (
                              <p className="text-[11px] text-[#AEB8C5]">
                                MP direta: {item.materialCode}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-tabular font-bold text-white">
                            {item.plannedQuantity} {item.plannedUnit}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-tabular text-[#AEB8C5]">
                            {item.realizedQuantity} {item.plannedUnit}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono-tabular">
                            {sched.status === 'RASCUNHO_CONFERENCIA' ? (
                              <span className="text-[#AEB8C5]">Calculado na aprovação</span>
                            ) : hasPendingFactor && totalCalcKg === 0 ? (
                              <span className="inline-flex items-center gap-1 text-[#F5B817]">
                                <ShieldAlert className="h-3.5 w-3.5" />
                                Pendente fator
                              </span>
                            ) : (
                              <span className="font-semibold text-emerald-300">
                                {formatKg(totalCalcKg)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-block rounded border px-2 py-0.5 text-[11px] font-semibold ${statusMeta.colorClass}`}
                            >
                              {statusMeta.label}
                            </span>
                          </td>
                          {canUpdateExecution && sched.status === 'APROVADA' && (
                            <td className="pl-3 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItem(item);
                                  setExecStatus(item.executionStatus);
                                  setExecRealizedQty(String(item.realizedQuantity));
                                  setExecReason('');
                                }}
                                className="min-h-[34px] rounded border border-[#AEB8C5]/25 px-2.5 text-[11px] font-semibold text-white hover:border-[#F5B817]"
                              >
                                Atualizar
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Atualizar Status de Execução */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveExecution}
            className="w-full max-w-md rounded-xl border border-[#AEB8C5]/25 bg-[#102235] p-5 text-white space-y-4"
          >
            <h3 className="font-display text-lg font-bold">
              Atualizar Execução — {editingItem.lineCode} ({editingItem.productCode})
            </h3>
            <p className="text-xs text-[#AEB8C5]">
              Programado: {editingItem.plannedQuantity} {editingItem.plannedUnit}. Mudanças para
              &quot;Adiantada&quot; ou &quot;Concluída&quot; atualizam imediatamente a projeção de
              estoque com registro em auditoria.
            </p>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[#AEB8C5]">
                Status da Execução
              </label>
              <select
                value={execStatus}
                onChange={(e) => setExecStatus(e.target.value as ExecutionStatus)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-white"
              >
                <option value="NAO_INICIADA">Não iniciada</option>
                <option value="EM_ANDAMENTO">Em andamento</option>
                <option value="CONCLUIDA">Concluída</option>
                <option value="ATRASADA">Atrasada</option>
                <option value="ADIANTADA">Adiantada</option>
                <option value="INTERROMPIDA">Interrompida</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[#AEB8C5]">
                Quantidade Realizada ({editingItem.plannedUnit})
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                value={execRealizedQty}
                onChange={(e) => setExecRealizedQty(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 font-mono-tabular text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-[#AEB8C5]">
                Motivo / Informação Validada (obrigatório)
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={execReason}
                onChange={(e) => setExecReason(e.target.value)}
                placeholder="Ex.: Produção antecipou lote de amanhã no 2º turno"
                className="min-h-[44px] w-full rounded-lg border border-[#AEB8C5]/25 bg-[#081321] px-3 text-sm text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="min-h-[44px] rounded-lg border border-[#AEB8C5]/25 px-4 text-sm text-[#AEB8C5]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingExec || execReason.trim().length < 3}
                className="min-h-[44px] rounded-lg bg-[#F5B817] px-5 text-sm font-bold text-[#081321] disabled:opacity-50"
              >
                {savingExec ? 'Salvando...' : 'Confirmar Atualização'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Documento Original Preservado */}
      {viewingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#AEB8C5]/25 bg-[#102235] text-white">
            <div className="flex items-center justify-between border-b border-[#AEB8C5]/15 px-5 py-3">
              <div className="flex items-center gap-2">
                {viewingDoc.mimeType.includes('pdf') ? (
                  <FileText className="h-5 w-5 text-[#F5B817]" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 text-[#F5B817]" />
                )}
                <h3 className="font-display text-base font-bold">{viewingDoc.fileName}</h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingDoc(null)}
                className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 px-3 text-xs text-[#AEB8C5] hover:text-white"
              >
                Fechar
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-[#081321]">
              {viewingDoc.fileContentBase64 && viewingDoc.mimeType.includes('image') ? (
                <img
                  src={viewingDoc.fileContentBase64}
                  alt={viewingDoc.fileName}
                  className="mx-auto max-h-[70vh] object-contain"
                />
              ) : viewingDoc.fileContentBase64 && viewingDoc.mimeType.includes('pdf') ? (
                <iframe
                  title={viewingDoc.fileName}
                  src={viewingDoc.fileContentBase64}
                  className="h-[70vh] w-full border-0"
                />
              ) : viewingDoc.extractedTextPreview ? (
                <pre className="whitespace-pre-wrap font-mono text-xs text-[#AEB8C5]">
                  {viewingDoc.extractedTextPreview}
                </pre>
              ) : (
                <p className="text-sm text-[#AEB8C5]">Conteúdo visual não disponível.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tablet Camera Capture Modal */}
      <DocumentCaptureModal
        open={captureModalOpen}
        onClose={() => setCaptureModalOpen(false)}
        onConfirmCapture={({ fileName, mimeType, dataUrl }) => {
          setCaptureModalOpen(false);
          submitDocumentForParsing({
            fileName,
            mimeType,
            sourceType: 'FOTO_TABLET',
            fileBase64: dataUrl,
            previewUrl: dataUrl,
          });
        }}
      />
    </div>
  );
};
