import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Contrast, Crop, RotateCcw, RotateCw, Upload, X } from 'lucide-react';

interface DocumentCaptureModalProps {
  open: boolean;
  onClose: () => void;
  onConfirmCapture: (payload: { fileName: string; mimeType: string; dataUrl: string }) => void;
}

export const DocumentCaptureModal: React.FC<DocumentCaptureModalProps> = ({
  open,
  onClose,
  onConfirmCapture,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [rawImageSrc, setRawImageSrc] = useState<string | null>(null);
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [highContrast, setHighContrast] = useState<boolean>(false);
  const [cropMarginPct, setCropMarginPct] = useState<number>(0);

  const stopCamera = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      setRawImageSrc(null);
      setRotationDeg(0);
      setHighContrast(false);
      setCropMarginPct(0);
      setCameraError(null);
    }
    return () => stopCamera();
  }, [open]);

  if (!open) return null;

  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Navegador sem suporte direto a getUserMedia. Utilize a câmera nativa abaixo.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err: any) {
      setCameraError(
        err?.message ||
          'Permissão de câmera negada ou indisponível. Autorize a câmera do tablet ou selecione uma foto.'
      );
    }
  };

  const captureFrameFromVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setRawImageSrc(canvas.toDataURL('image/jpeg', 0.92));
    stopCamera();
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRawImageSrc(reader.result);
        stopCamera();
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExportAdjusted = () => {
    if (!rawImageSrc) return;
    const img = new Image();
    img.onload = () => {
      const margin = Math.min(25, Math.max(0, cropMarginPct)) / 100;
      const sx = Math.round(img.width * margin);
      const sy = Math.round(img.height * margin);
      const sw = Math.max(10, Math.round(img.width * (1 - margin * 2)));
      const sh = Math.max(10, Math.round(img.height * (1 - margin * 2)));

      const rad = (rotationDeg * Math.PI) / 180;
      const swap = rotationDeg % 180 !== 0;
      const outW = swap ? sh : sw;
      const outH = swap ? sw : sh;

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (highContrast) {
        ctx.filter = 'grayscale(100%) contrast(145%) brightness(106%)';
      }

      ctx.translate(outW / 2, outH / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);

      const finalDataUrl = canvas.toDataURL('image/jpeg', 0.92);
      onConfirmCapture({
        fileName: `foto-programacao-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`,
        mimeType: 'image/jpeg',
        dataUrl: finalDataUrl,
      });
    };
    img.src = rawImageSrc;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#AEB8C5]/25 bg-[#102235] text-white">
        <div className="flex items-center justify-between border-b border-[#AEB8C5]/15 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#F5B817]/40 bg-[#F5B817]/10 text-[#F5B817]">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold">
                Fotografia & Ajuste Documental (Tablet / Desktop)
              </h3>
              <p className="text-xs text-[#AEB8C5]">
                Capture a programação impressa, ajuste rotação, recorte e contraste antes de ler com Gemini.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar câmera"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-[#AEB8C5] hover:bg-[#1A314A]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {cameraError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              {cameraError}
            </div>
          )}

          {!rawImageSrc ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-[#AEB8C5]/20 bg-[#081321] aspect-video flex items-center justify-center">
                {cameraActive ? (
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="p-6 text-center space-y-3">
                    <Camera className="mx-auto h-10 w-10 text-[#F5B817]" />
                    <p className="text-sm text-[#AEB8C5]">
                      Ative a câmera traseira do tablet ou selecione/fotografe diretamente pelo dispositivo.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-[#F5B817] px-4 py-2.5 text-sm font-bold text-[#081321] hover:bg-[#F5B817]/90"
                  >
                    <Camera className="h-5 w-5" />
                    <span>ATIVAR CÂMERA DO DISPOSITIVO</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={captureFrameFromVideo}
                    className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-[#081321] hover:bg-emerald-400"
                  >
                    <Camera className="h-5 w-5" />
                    <span>CAPTURAR FOTOGRAFIA</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-[#AEB8C5]/30 bg-[#081321] px-4 py-2.5 text-sm font-semibold text-white hover:border-[#F5B817]"
                >
                  <Upload className="h-4 w-4 text-[#F5B817]" />
                  <span>Câmera Nativa / Galeria</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFilePicked}
                  className="hidden"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-[#AEB8C5]/25 bg-[#081321] p-3 flex items-center justify-center max-h-[45vh]">
                <img
                  src={rawImageSrc}
                  alt="Prévia da programação capturada"
                  style={{
                    transform: `rotate(${rotationDeg}deg) scale(${1 + cropMarginPct / 100})`,
                    filter: highContrast ? 'grayscale(100%) contrast(145%) brightness(106%)' : 'none',
                  }}
                  className="max-h-[40vh] w-auto object-contain transition-transform"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 rounded-xl border border-[#AEB8C5]/15 bg-[#081321] p-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#AEB8C5]">Rotação</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setRotationDeg((r) => (r - 90 + 360) % 360)}
                      className="flex min-h-[42px] flex-1 items-center justify-center gap-1 rounded-lg border border-[#AEB8C5]/25 text-xs font-semibold hover:border-[#F5B817]"
                    >
                      <RotateCcw className="h-4 w-4" />
                      <span>-90°</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRotationDeg((r) => (r + 90) % 360)}
                      className="flex min-h-[42px] flex-1 items-center justify-center gap-1 rounded-lg border border-[#AEB8C5]/25 text-xs font-semibold hover:border-[#F5B817]"
                    >
                      <RotateCw className="h-4 w-4" />
                      <span>+90°</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#AEB8C5]">
                    <span className="flex items-center gap-1">
                      <Crop className="h-3.5 w-3.5 text-[#F5B817]" />
                      Recorte Bordas
                    </span>
                    <span className="font-mono-tabular text-[#F5B817]">{cropMarginPct}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={2}
                    value={cropMarginPct}
                    onChange={(e) => setCropMarginPct(Number(e.target.value))}
                    className="w-full accent-[#F5B817]"
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#AEB8C5]">Legibilidade</p>
                  <button
                    type="button"
                    onClick={() => setHighContrast((v) => !v)}
                    className={`flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border text-xs font-bold ${
                      highContrast
                        ? 'border-[#F5B817] bg-[#F5B817]/15 text-[#F5B817]'
                        : 'border-[#AEB8C5]/25 text-[#AEB8C5]'
                    }`}
                  >
                    <Contrast className="h-4 w-4" />
                    <span>{highContrast ? 'Alto Contraste Ativo' : 'Ativar Alto Contraste'}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setRawImageSrc(null)}
                  className="min-h-[46px] rounded-lg border border-[#AEB8C5]/30 px-4 py-2 text-sm font-semibold text-[#AEB8C5] hover:text-white"
                >
                  Tirar Outra Foto
                </button>
                <button
                  type="button"
                  onClick={handleExportAdjusted}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 text-sm font-bold text-[#081321] hover:bg-emerald-400"
                >
                  <Check className="h-5 w-5" />
                  <span>ENVIAR PARA INTERPRETAÇÃO GEMINI</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
