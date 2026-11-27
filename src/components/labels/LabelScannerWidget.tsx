import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  History,
  Keyboard,
  QrCode,
  Sparkles,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  BarcodeParseResponse,
  GeminiPhotoParseResponse,
  LotHistoryResponse,
  MaterialItem,
} from '../../types/nexo.ts';
import { apiFetch, formatKg, isDemoModeActive } from '../../lib/api.ts';

export interface ScannedLabelCandidate {
  scanMethod: 'BARCODE_CAMERA' | 'BARCODE_SCANNER' | 'PHOTO_GEMINI' | 'MANUAL';
  materialId: number | null;
  materialCode: string;
  description: string;
  supplierName: string;
  lotCode: string;
  weightKg: number | null;
  bagCount: number | null;
  establishment: string | null;
  printDate: string | null;
  rawBarcode: string | null;
  uncertainFields: string[];
  catalogInconsistencies: string[];
  lotHistory: LotHistoryResponse | null;
  previewDataUrl?: string | null;
}

interface LabelScannerWidgetProps {
  materials: MaterialItem[];
  onApplyCandidate: (candidate: ScannedLabelCandidate, mode: 'NEW' | 'COMPLEMENT', existingReceiptId?: number) => void;
  onConsultHistory: (lotCode: string) => void;
}

export const LabelScannerWidget: React.FC<LabelScannerWidgetProps> = ({
  materials,
  onApplyCandidate,
  onConsultHistory,
}) => {
  const [activeMode, setActiveMode] = useState<'NONE' | 'CAMERA_BARCODE' | 'PHOTO' | 'MANUAL'>('NONE');
  const [manualInput, setManualInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ScannedLabelCandidate | null>(null);
  const [zoomPreviewOpen, setZoomPreviewOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = () => {
    try {
      controlsRef.current?.stop();
    } catch {
      // ignore stop errors
    }
    controlsRef.current = null;
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const processBarcodeValue = async (
    rawCode: string,
    scanMethod: 'BARCODE_CAMERA' | 'BARCODE_SCANNER' | 'MANUAL'
  ) => {
    const cleaned = rawCode.trim();
    if (!cleaned) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<BarcodeParseResponse>('/api/labels/parse-barcode', {
        method: 'POST',
        body: JSON.stringify({ rawBarcode: cleaned, scanMethod }),
      });

      const mat = res.matchedMaterial;
      const built: ScannedLabelCandidate = {
        scanMethod,
        materialId: mat?.id ?? null,
        materialCode: res.parsed.materialCode || mat?.code || '',
        description: mat?.description || '',
        supplierName:
          res.lotHistory?.receipts?.[0]?.supplierName || '',
        lotCode: res.parsed.lotCode || '',
        weightKg: res.parsed.weightKg,
        bagCount: null,
        establishment: res.parsed.establishment,
        printDate: null,
        rawBarcode: res.parsed.rawBarcode,
        uncertainFields: res.parsed.uncertainFields,
        catalogInconsistencies:
          res.parsed.materialCode && !mat
            ? [`Código ${res.parsed.materialCode} não encontrado no catálogo oficial.`]
            : [],
        lotHistory: res.lotHistory,
        previewDataUrl: null,
      };
      setCandidate(built);
      stopCamera();
      setActiveMode('NONE');
    } catch (err: any) {
      setError(err.message || 'Erro ao interpretar código de barras.');
    } finally {
      setBusy(false);
    }
  };

  const startBarcodeScanner = async () => {
    setError(null);
    setCameraPermissionError(null);
    setActiveMode('CAMERA_BARCODE');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraPermissionError(
        'Navegador sem suporte à API de câmera ou acesso sem HTTPS. Utilize o leitor teclado ou fotografia/upload.'
      );
      return;
    }

    try {
      // Explicit permission request before starting ZXing
      const testStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      testStream.getTracks().forEach((t) => t.stop());

      const reader = new BrowserMultiFormatReader();
      if (!videoRef.current) return;

      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result, _err) => {
          if (result) {
            const text = result.getText();
            if (text) {
              processBarcodeValue(text, 'BARCODE_CAMERA');
            }
          }
        }
      );
      controlsRef.current = controls;
    } catch (err: any) {
      console.error('Camera permission/ZXing error:', err);
      setCameraPermissionError(
        'Permissão de câmera negada ou câmera indisponível. Autorize a câmera nas configurações do tablet ou use a entrada manual / upload de imagem.'
      );
    }
  };

  const handlePhotoSelected = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setActiveMode('PHOTO');

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
        reader.readAsDataURL(file);
      });

      const res = await apiFetch<GeminiPhotoParseResponse>('/api/labels/interpret-photo', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: base64,
          mimeType: file.type || 'image/jpeg',
          fileName: file.name,
        }),
      });

      const mat = res.matchedMaterial;
      const built: ScannedLabelCandidate = {
        scanMethod: 'PHOTO_GEMINI',
        materialId: mat?.id ?? null,
        materialCode: res.extraction.materialCode || mat?.code || '',
        description: mat?.description || res.extraction.description || '',
        supplierName:
          res.matchedSupplier?.name || res.extraction.supplierName || '',
        lotCode: res.extraction.lotCode || '',
        weightKg: res.extraction.weightKg,
        bagCount: res.extraction.bagCount,
        establishment: res.extraction.establishment,
        printDate: res.extraction.printDate,
        rawBarcode: res.extraction.rawBarcodeText,
        uncertainFields: res.extraction.uncertainFields || [],
        catalogInconsistencies: res.catalogInconsistencies || [],
        lotHistory: res.lotHistory,
        previewDataUrl: res.sourceImageDataUrl || base64,
      };
      setCandidate(built);
      setActiveMode('NONE');
    } catch (err: any) {
      setError(err.message || 'Erro ao interpretar fotografia da etiqueta com Gemini Vision.');
    } finally {
      setBusy(false);
    }
  };

  const handleDemoPhotoSimulation = async (
    demoSampleKey: 'CALCARIO_EXISTENTE' | 'UREIA_BIGBAG_NOVO' | 'CAULIM_BIGBAG_EXISTENTE'
  ) => {
    setBusy(true);
    setError(null);
    setActiveMode('PHOTO');
    try {
      const res = await apiFetch<GeminiPhotoParseResponse>('/api/labels/interpret-photo', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: 'DEMO_SIMULATED_LABEL',
          mimeType: 'image/jpeg',
          demoSampleKey,
        }),
      });
      const mat = res.matchedMaterial;
      setCandidate({
        scanMethod: 'PHOTO_GEMINI',
        materialId: mat?.id ?? null,
        materialCode: res.extraction.materialCode || mat?.code || '',
        description: mat?.description || res.extraction.description || '',
        supplierName:
          res.matchedSupplier?.name || res.extraction.supplierName || '',
        lotCode: res.extraction.lotCode || '',
        weightKg: res.extraction.weightKg,
        bagCount: res.extraction.bagCount,
        establishment: res.extraction.establishment,
        printDate: res.extraction.printDate,
        rawBarcode: res.extraction.rawBarcodeText,
        uncertainFields: res.extraction.uncertainFields || [],
        catalogInconsistencies: res.catalogInconsistencies || [],
        lotHistory: res.lotHistory,
        previewDataUrl: res.sourceImageDataUrl || null,
      });
      setActiveMode('NONE');
    } catch (err: any) {
      setError(err.message || 'Erro ao simular leitura fotográfica da etiqueta.');
    } finally {
      setBusy(false);
    }
  };

  const inDemo = isDemoModeActive();

  return (
    <div className="space-y-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[#F5B91B]">
            IDENTIFICAÇÃO INTELIGENTE DE ETIQUETAS (ZXING + GEMINI VISION)
          </p>
          <h3 className="font-display text-base font-bold text-[#F4F6F8]">
            Prioridade: Código de Barras → Cadastro Interno → Conferência por Fotografia
          </h3>
        </div>
      </div>

      {/* 3 Primary Operational Action Buttons */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={startBarcodeScanner}
          className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-lg bg-[#F5B91B] px-4 py-3 text-sm font-extrabold text-[#0A1421] transition-colors hover:bg-[#F5B91B]/90"
        >
          <QrCode className="h-5 w-5" />
          <span>ESCANEAR ETIQUETA</span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-lg border border-[#3B82F6]/50 bg-[#3B82F6]/15 px-4 py-3 text-sm font-bold text-[#F4F6F8] transition-colors hover:bg-[#3B82F6]/25 disabled:opacity-60"
        >
          <Camera className="h-5 w-5 text-[#60A5FA]" />
          <span>FOTOGRAFAR ETIQUETA</span>
        </button>

        <button
          type="button"
          onClick={() => {
            stopCamera();
            setActiveMode(activeMode === 'MANUAL' ? 'NONE' : 'MANUAL');
          }}
          className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-lg border border-[#AEB8C5]/30 bg-[#0A1421] px-4 py-3 text-sm font-bold text-[#F4F6F8] transition-colors hover:border-[#F5B91B]/60"
        >
          <Keyboard className="h-5 w-5 text-[#F5B91B]" />
          <span>DIGITAR LOTE MANUALMENTE</span>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handlePhotoSelected(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* Camera Barcode Viewfinder */}
      {activeMode === 'CAMERA_BARCODE' && (
        <div className="space-y-3 rounded-xl border border-[#F5B91B]/40 bg-[#0A1421] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#F5B91B]">
              Câmera ativa — aponte para o código de barras da etiqueta (ex.: RQ-REC-044)
            </span>
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setActiveMode('NONE');
              }}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A2B42]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {cameraPermissionError ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              {cameraPermissionError}
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[#AEB8C5]/20 bg-black">
              <video ref={videoRef} className="max-h-64 w-full object-cover" muted playsInline />
            </div>
          )}
        </div>
      )}

      {/* Manual / Keyboard Wedge Barcode or Lot Input */}
      {activeMode === 'MANUAL' && (
        <div className="space-y-2.5 rounded-xl border border-[#AEB8C5]/20 bg-[#0A1421] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  processBarcodeValue(manualInput, 'BARCODE_SCANNER');
                }
              }}
              placeholder="Bipe o código (ex.: 22******20901210610011606870) ou digite lote/código..."
              className="min-h-[46px] flex-1 min-w-[240px] rounded-lg border border-[#AEB8C5]/25 bg-[#101B2A] px-3 font-mono-tabular text-sm text-[#F4F6F8] placeholder:text-[#AEB8C5]/50 focus:border-[#F5B91B] focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !manualInput.trim()}
              onClick={() => processBarcodeValue(manualInput, 'MANUAL')}
              className="min-h-[46px] rounded-lg bg-[#F5B91B] px-5 py-2 text-sm font-bold text-[#0A1421] hover:bg-[#F5B91B]/90 disabled:opacity-60"
            >
              {busy ? 'Consultando...' : 'Consultar Cadastro & Lote'}
            </button>
          </div>
          <p className="text-[11px] text-[#AEB8C5]">
            Formatos aceitos: <span className="font-mono-tabular text-[#F4F6F8]">22******20901210610011606870</span> (RQ-REC-044),{' '}
            <span className="font-mono-tabular text-[#F4F6F8]">0011647908</span> (lote direto),{' '}
            <span className="font-mono-tabular text-[#F4F6F8]">(01)2017101021(10)0011647908</span> (GS1-128) ou{' '}
            <span className="font-mono-tabular text-[#F4F6F8]">CODIGO|LOTE|PESO</span>.
          </p>
        </div>
      )}

      {/* Faixa de Demonstração Rápida de Leitura de Etiquetas (somente em Modo Apresentação / Demo) */}
      {inDemo && (
        <div className="rounded-xl border border-[#3B82F6]/30 bg-[#0A1421]/80 p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#60A5FA]">
              Etiquetas de Exemplo para Teste & Demonstração (Sandbox)
            </span>
            <span className="text-[11px] text-[#AEB8C5]">
              Clique para simular bipe de leitor, alerta de lote já movimentado ou fotografia IA
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setManualInput('22******20901210610011606870');
                processBarcodeValue('22******20901210610011606870', 'BARCODE_SCANNER');
              }}
              className="rounded-lg border border-[#F5B91B]/40 bg-[#F5B91B]/10 px-3 py-2 text-xs font-bold text-[#F5B91B] hover:bg-[#F5B91B]/20 disabled:opacity-50"
            >
              RQ-REC-044 · Caulim (Lote 0011606870)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setManualInput('0011647908');
                processBarcodeValue('0011647908', 'MANUAL');
              }}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200 hover:bg-red-500/20 disabled:opacity-50"
            >
              Lote Parcial · Calcário (0011647908)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setManualInput('1113101920|0011998822|4000');
                processBarcodeValue('1113101920|0011998822|4000', 'BARCODE_SCANNER');
              }}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
            >
              Novo Lote · Veículo Premix (4.000 kg)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleDemoPhotoSimulation('UREIA_BIGBAG_NOVO')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/45 bg-[#3B82F6]/15 px-3 py-2 text-xs font-bold text-[#93C5FD] hover:bg-[#3B82F6]/25 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Simular Foto Big Bag (Uréia · 10 bags)</span>
            </button>
          </div>
        </div>
      )}

      {busy && activeMode === 'PHOTO' && (
        <div className="flex items-center gap-3 rounded-xl border border-[#3B82F6]/40 bg-[#3B82F6]/10 p-4 text-sm text-[#F4F6F8]">
          <Sparkles className="h-5 w-5 animate-pulse text-[#F5B91B]" />
          <span>Interpretando fotografia da etiqueta via Gemini Vision e comparando com o catálogo...</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-xs text-red-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <div className="space-y-1">
            <p className="font-semibold">Falha na leitura / interpretação</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Extracted Data Review + Duplicate Lot Alert */}
      {candidate && (
        <div className="space-y-4 rounded-xl border border-[#F5B91B]/40 bg-[#0A1421] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#AEB8C5]/15 pb-3">
            <div className="flex items-center gap-2">
              {candidate.scanMethod === 'PHOTO_GEMINI' ? (
                <Sparkles className="h-4 w-4 text-[#F5B91B]" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              )}
              <span className="text-sm font-bold text-[#F4F6F8]">
                Conferência Obrigatória do Operador ({candidate.scanMethod})
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setCandidate(null);
                setZoomPreviewOpen(false);
              }}
              className="text-xs text-[#AEB8C5] hover:text-[#F4F6F8]"
            >
              Limpar leitura
            </button>
          </div>

          <div
            className={
              candidate.previewDataUrl
                ? 'grid grid-cols-1 gap-4 lg:grid-cols-12'
                : 'block'
            }
          >
            {candidate.previewDataUrl && (
              <div className="lg:col-span-5 space-y-2 rounded-xl border border-[#3B82F6]/30 bg-[#101B2A] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#60A5FA]">
                    Fotografia Original da Etiqueta
                  </span>
                  <button
                    type="button"
                    onClick={() => setZoomPreviewOpen(true)}
                    className="inline-flex items-center gap-1 rounded border border-[#AEB8C5]/25 bg-[#0A1421] px-2 py-1 text-[11px] font-semibold text-[#F4F6F8] hover:border-[#F5B91B]"
                  >
                    <ZoomIn className="h-3.5 w-3.5 text-[#F5B91B]" />
                    <span>Ampliar</span>
                  </button>
                </div>
                <div
                  onClick={() => setZoomPreviewOpen(true)}
                  className="cursor-zoom-in overflow-hidden rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421]"
                >
                  <img
                    src={candidate.previewDataUrl}
                    alt="Fotografia original da etiqueta"
                    className="max-h-72 w-full object-contain"
                  />
                </div>
                <p className="text-[11px] text-[#AEB8C5]">
                  Compare os dados ao lado com a imagem capturada antes de confirmar no recebimento.
                </p>
              </div>
            )}

            <div
              className={
                candidate.previewDataUrl
                  ? 'lg:col-span-7 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 content-start'
                  : 'grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3'
              }
            >
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                <p className="text-[#AEB8C5]">Código Matéria-Prima</p>
                <p className="mt-1 font-mono-tabular text-sm font-bold text-[#F4F6F8]">
                  {candidate.materialCode || 'Não identificado'}
                </p>
              </div>
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                <p className="text-[#AEB8C5]">Descrição (Catálogo / Etiqueta)</p>
                <p className="mt-1 text-sm font-bold text-[#F4F6F8]">
                  {candidate.description || 'Selecionar manualmente'}
                </p>
              </div>
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                <p className="text-[#AEB8C5]">Número do Lote</p>
                <p className="mt-1 font-mono-tabular text-sm font-bold text-[#F5B91B]">
                  {candidate.lotCode || 'Não identificado'}
                </p>
              </div>
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                <p className="text-[#AEB8C5]">Fornecedor</p>
                <p className="mt-1 text-sm font-semibold text-[#F4F6F8]">
                  {candidate.supplierName || 'Conferir manualmente'}
                </p>
              </div>
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                <p className="text-[#AEB8C5]">Peso / Quantidade Identificada</p>
                <p className="mt-1 font-mono-tabular text-sm font-bold text-[#F4F6F8]">
                  {candidate.weightKg ? formatKg(candidate.weightKg) : 'Não informado na etiqueta'}
                </p>
              </div>
              <div className="rounded-lg border border-[#AEB8C5]/15 bg-[#101B2A] p-3">
                <p className="text-[#AEB8C5]">Estabelecimento / Impressão</p>
                <p className="mt-1 font-mono-tabular text-sm text-[#F4F6F8]">
                  {candidate.establishment || '—'} {candidate.printDate ? `· ${candidate.printDate}` : ''}
                </p>
              </div>
            </div>
          </div>

          {candidate.uncertainFields.length > 0 && (
            <div className="rounded-lg border border-[#F5B91B]/40 bg-[#F5B91B]/10 p-3 text-xs text-[#F5B91B]">
              Campos com dúvida para confirmação manual obrigatória:{' '}
              <span className="font-bold">{candidate.uncertainFields.join(', ')}</span>
            </div>
          )}

          {candidate.catalogInconsistencies.length > 0 && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              {candidate.catalogInconsistencies.map((inc) => (
                <p key={inc}>{inc}</p>
              ))}
            </div>
          )}

          {/* Section 7: Duplicate Lot Alert Modal/Panel */}
          {candidate.lotHistory?.hasMovements ? (
            <div className="space-y-3 rounded-xl border border-red-500/50 bg-red-950/35 p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
                <div>
                  <p className="font-display text-sm font-extrabold text-red-200">
                    ATENÇÃO: ESTE LOTE JÁ POSSUI MOVIMENTAÇÕES REGISTRADAS.
                  </p>
                  <p className="mt-1 text-xs text-red-100/85">
                    Lote <span className="font-mono-tabular font-bold">{candidate.lotHistory.lotCode}</span>{' '}
                    · {candidate.lotHistory.receipts[0]?.materialDescription || candidate.description} · Fornecedor:{' '}
                    {candidate.lotHistory.receipts[0]?.supplierName || '—'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-lg bg-[#0A1421]/80 p-2.5">
                  <p className="text-[#AEB8C5]">Quantidade Original</p>
                  <p className="font-mono-tabular text-sm font-bold text-[#F4F6F8]">
                    {formatKg(candidate.lotHistory.totalOriginalKg)}
                  </p>
                </div>
                <div className="rounded-lg bg-[#0A1421]/80 p-2.5">
                  <p className="text-[#AEB8C5]">Já Distribuída</p>
                  <p className="font-mono-tabular text-sm font-bold text-emerald-400">
                    {formatKg(candidate.lotHistory.totalDistributedKg)}
                  </p>
                </div>
                <div className="rounded-lg bg-[#0A1421]/80 p-2.5">
                  <p className="text-[#AEB8C5]">Quantidade Restante</p>
                  <p className="font-mono-tabular text-sm font-bold text-[#F5B91B]">
                    {formatKg(candidate.lotHistory.totalRemainingKg)}
                  </p>
                </div>
              </div>

              <div className="text-xs text-[#AEB8C5]">
                <p className="font-semibold text-[#F4F6F8]">Silos que já receberam o material:</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {candidate.lotHistory.silosUsed.map((su) => (
                    <span
                      key={su.siloNumber}
                      className="font-mono-tabular rounded border border-[#AEB8C5]/20 bg-[#0A1421] px-2.5 py-1 text-[#F4F6F8]"
                    >
                      Silo {su.siloNumber}: {formatKg(su.netKg)} ({new Date(su.lastAt).toLocaleString('pt-BR')})
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => onConsultHistory(candidate.lotHistory!.lotCode)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[#AEB8C5]/30 bg-[#0A1421] px-4 py-2 text-xs font-bold text-[#F4F6F8] hover:border-[#F5B91B]"
                >
                  <History className="h-4 w-4" />
                  <span>Consultar Histórico</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onApplyCandidate(
                      candidate,
                      'COMPLEMENT',
                      candidate.lotHistory?.receipts.find((r) => r.remainingQuantityKg > 0)?.id
                    );
                    setCandidate(null);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 py-2 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
                >
                  <span>Registrar Complemento</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCandidate(null)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-red-400/40 px-4 py-2 text-xs font-bold text-red-200 hover:bg-red-500/20"
                >
                  <span>Cancelar Operação</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  onApplyCandidate(candidate, 'NEW');
                  setCandidate(null);
                }}
                className="min-h-[44px] rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-[#0A1421] hover:bg-emerald-400"
              >
                Usar Dados no Recebimento (Conferir Antes de Salvar)
              </button>
            </div>
          )}
        </div>
      )}

      {zoomPreviewOpen && candidate?.previewDataUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setZoomPreviewOpen(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-4xl overflow-auto rounded-xl border border-[#F5B91B]/40 bg-[#0A1421] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <span className="text-xs font-bold uppercase tracking-wider text-[#F5B91B]">
                Visualização Ampliada — Etiqueta ({candidate.materialCode || 'Sem código'})
              </span>
              <button
                type="button"
                onClick={() => setZoomPreviewOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#AEB8C5]/25 text-[#F4F6F8] hover:border-[#F5B91B]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <img
              src={candidate.previewDataUrl}
              alt="Etiqueta ampliada"
              className="max-h-[78vh] w-auto rounded-lg object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
};
