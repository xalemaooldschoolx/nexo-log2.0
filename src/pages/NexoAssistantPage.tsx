import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Clock,
  Database,
  ExternalLink,
  FileAudio,
  Globe,
  Lock,
  MapPin,
  Mic,
  MicOff,
  Paperclip,
  PhoneCall,
  PhoneOff,
  Send,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import { NavSectionId, NexoAssistantResponse, SessionData } from '../types/nexo.ts';
import { apiFetch, isDemoModeActive } from '../lib/api.ts';
import { auth } from '../lib/firebase.ts';

interface NexoAssistantPageProps {
  session: SessionData;
  onNavigate: (section: NavSectionId) => void;
}

interface DbChatEntry {
  id: number;
  question: string;
  response: NexoAssistantResponse;
}

interface GroundingLinkItem {
  type: 'web' | 'maps' | 'review';
  title: string;
  uri: string;
}

interface StudioChatTurn {
  id: number;
  role: 'user' | 'model';
  text: string;
  model?: string;
  groundingMode?: 'NONE' | 'SEARCH' | 'MAPS';
  groundingLinks?: GroundingLinkItem[];
  attachmentName?: string | null;
}

interface LiveTranscriptItem {
  id: number;
  speaker: 'Você' | 'NEXO Voz' | 'Sistema';
  text: string;
}

type AssistantTab = 'DB_QUERY' | 'MULTIMODAL_CHAT' | 'VOICE_AUDIO';

const QUICK_QUESTIONS = [
  'Quanto calcário foi recebido hoje?',
  'Quais silos foram abastecidos hoje?',
  'Qual foi a última transferência no Silo 38?',
  'Quais materiais estão críticos?',
  'Quais pendências ficaram do turno anterior?',
  'Quais linhas têm risco de falta?',
  'Quais recebimentos estão em aberto?',
  'Quais ocorrências estão abertas?',
  'O que mudou na programação?',
];

function float32ToBase64Pcm16(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(new ArrayBuffer(sampleCount * 4));
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export const NexoAssistantPage: React.FC<NexoAssistantPageProps> = ({ session, onNavigate }) => {
  const [activeTab, setActiveTab] = useState<AssistantTab>('DB_QUERY');

  // --- TAB 1: PostgreSQL Read-Only Operational Assistant (Preserved intact) ---
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<DbChatEntry[]>([]);
  const [loadingDb, setLoadingDb] = useState(false);
  const [errorDb, setErrorDb] = useState<string | null>(null);

  const submitDbQuestion = async (textToAsk: string) => {
    const clean = textToAsk.trim();
    if (!clean) return;
    setLoadingDb(true);
    setErrorDb(null);
    try {
      const res = await apiFetch<NexoAssistantResponse>('/api/assistant/ask', {
        method: 'POST',
        body: JSON.stringify({ question: clean }),
      });
      setHistory((prev) => [{ id: Date.now(), question: clean, response: res }, ...prev]);
      setQuestion('');
    } catch (err: any) {
      setErrorDb(err.message || 'Falha ao consultar NEXO ASSISTENTE.');
    } finally {
      setLoadingDb(false);
    }
  };

  // --- TAB 2: Multi-Turn Multimodal Chat + Grounding (Search & Maps) ---
  const [chatModel, setChatModel] = useState<'gemini-4-hydrogen' | 'gemini-3.1-flash-lite'>(
    'gemini-4-hydrogen'
  );
  const [groundingMode, setGroundingMode] = useState<'NONE' | 'SEARCH' | 'MAPS'>('NONE');
  const [systemInstruction, setSystemInstruction] = useState(
    'Você é o engenheiro copiloto do NEXO LOG 2.0 (Gestão Inteligente da Moega). Responda sempre em português (pt-BR), com rigor técnico industrial.'
  );
  const [showSystemBox, setShowSystemBox] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatTurns, setChatTurns] = useState<StudioChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<{
    name: string;
    mimeType: string;
    dataBase64: string;
  } | null>(null);

  const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.replace(/^data:[^;]+;base64,/, '');
      setAttachment({
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        dataBase64: base64,
      });
    };
    reader.readAsDataURL(file);
  };

  const resolveBrowserCoords = (): Promise<{ latitude: number; longitude: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        () => resolve(null),
        { timeout: 3500 }
      );
    });
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = chatInput.trim();
    if (!clean) return;

    const nextUserTurn: StudioChatTurn = {
      id: Date.now(),
      role: 'user',
      text: clean,
      attachmentName: attachment?.name || null,
    };

    const updatedHistory = [...chatTurns, nextUserTurn];
    setChatTurns(updatedHistory);
    setChatInput('');
    setChatLoading(true);
    setChatError(null);

    try {
      let latLng: { latitude: number; longitude: number } | null = null;
      if (groundingMode === 'MAPS') {
        latLng = await resolveBrowserCoords();
      }

      const payloadAttachment = attachment
        ? { mimeType: attachment.mimeType, dataBase64: attachment.dataBase64 }
        : null;
      setAttachment(null);

      const res = await apiFetch<{
        replyText: string;
        model: string;
        groundingMode: 'NONE' | 'SEARCH' | 'MAPS';
        groundingLinks: GroundingLinkItem[];
      }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          model: chatModel,
          messages: updatedHistory.map((t) => ({ role: t.role, text: t.text })),
          systemInstruction,
          groundingMode,
          latLng,
          attachment: payloadAttachment,
        }),
      });

      setChatTurns((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'model',
          text: res.replyText,
          model: res.model,
          groundingMode: res.groundingMode,
          groundingLinks: res.groundingLinks || [],
        },
      ]);
    } catch (err: any) {
      setChatError(err.message || 'Erro ao processar solicitação com o Gemini.');
    } finally {
      setChatLoading(false);
    }
  };

  // --- TAB 3A: Pre-recorded / Recorded Audio Transcription (gemini-3.5-transcribe) ---
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [transcriptResult, setTranscriptResult] = useState<{
    transcript: string;
    model: string;
  } | null>(null);
  const [isRecordingClip, setIsRecordingClip] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const clipChunksRef = useRef<Blob[]>([]);

  const submitAudioForTranscription = async (base64Data: string, mimeType: string) => {
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const res = await apiFetch<{ transcript: string; model: string }>('/api/ai/transcribe', {
        method: 'POST',
        body: JSON.stringify({ audioBase64: base64Data, mimeType }),
      });
      setTranscriptResult(res);
    } catch (err: any) {
      setTranscribeError(err.message || 'Falha ao transcrever áudio.');
    } finally {
      setTranscribing(false);
    }
  };

  const handleAudioFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
      submitAudioForTranscription(base64, file.type || 'audio/mpeg');
    };
    reader.readAsDataURL(file);
  };

  const toggleClipRecording = async () => {
    if (isRecordingClip) {
      mediaRecorderRef.current?.stop();
      setIsRecordingClip(false);
      return;
    }

    setTranscribeError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      clipChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) clipChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(clipChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = String(reader.result || '').replace(/^data:[^;]+;base64,/, '');
          submitAudioForTranscription(base64, blob.type || 'audio/webm');
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingClip(true);
    } catch (err: any) {
      setTranscribeError(err.message || 'Não foi possível acessar o microfone.');
    }
  };

  // --- TAB 3B: Real-Time Live Voice Session (gemini-3.8-live via /ws/gemini-live) ---
  const [liveStatus, setLiveStatus] = useState<'IDLE' | 'CONNECTING' | 'CONNECTED'>('IDLE');
  const [liveVoice, setLiveVoice] = useState<'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir'>(
    'Zephyr'
  );
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveTranscripts, setLiveTranscripts] = useState<LiveTranscriptItem[]>([]);

  const liveWsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeOutputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const appendLiveTranscript = (speaker: LiveTranscriptItem['speaker'], text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setLiveTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: `${last.text} ${clean}`.trim(),
        };
        return updated;
      }
      return [...prev, { id: Date.now() + Math.random(), speaker, text: clean }];
    });
  };

  const stopLiveVoiceSession = () => {
    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    for (const src of activeOutputSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // ignore
      }
    }
    activeOutputSourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }

    if (liveWsRef.current) {
      try {
        liveWsRef.current.close();
      } catch {
        // ignore
      }
      liveWsRef.current = null;
    }
    setLiveStatus('IDLE');
  };

  useEffect(() => {
    return () => {
      stopLiveVoiceSession();
    };
  }, []);

  const schedulePcm24kPlayback = (base64Pcm: string) => {
    const ctx = outputAudioCtxRef.current;
    if (!ctx) return;

    const float32 = base64Pcm16ToFloat32(base64Pcm);
    if (float32.length === 0) return;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeOutputSourcesRef.current.add(source);
    source.onended = () => {
      activeOutputSourcesRef.current.delete(source);
    };
  };

  const startLiveVoiceSession = async () => {
    if (isDemoModeActive()) {
      setLiveError(
        'Modo Apresentação (Demo): a conversa por voz em tempo real via WebSocket (/ws/gemini-live) requer sessão autenticada conectada ao servidor.'
      );
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setLiveError('Sessão Firebase não autenticada para iniciar o canal de voz.');
      return;
    }

    setLiveError(null);
    setLiveStatus('CONNECTING');

    try {
      const token = await currentUser.getIdToken();
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputCtx;
      outputAudioCtxRef.current = outputCtx;
      nextStartTimeRef.current = 0;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/gemini-live?token=${encodeURIComponent(
        token
      )}&voice=${encodeURIComponent(liveVoice)}`;
      const ws = new WebSocket(wsUrl);
      liveWsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (ev) => {
          const activeWs = liveWsRef.current;
          if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
          const samples = ev.inputBuffer.getChannelData(0);
          const base64Audio = float32ToBase64Pcm16(samples);
          activeWs.send(JSON.stringify({ audio: base64Audio }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data || '{}'));
          if (msg.ready) {
            setLiveStatus('CONNECTED');
            appendLiveTranscript(
              'Sistema',
              `Canal Gemini Live (${msg.model} · Voz ${msg.voice}) ativo. Pode falar.`
            );
          }
          if (msg.audio) {
            schedulePcm24kPlayback(msg.audio);
          }
          if (msg.inputTranscript) {
            appendLiveTranscript('Você', msg.inputTranscript);
          }
          if (msg.outputTranscript) {
            appendLiveTranscript('NEXO Voz', msg.outputTranscript);
          }
          if (msg.interrupted) {
            for (const src of activeOutputSourcesRef.current) {
              try {
                src.stop();
              } catch {
                // ignore
              }
            }
            activeOutputSourcesRef.current.clear();
            nextStartTimeRef.current = 0;
          }
          if (msg.error) {
            setLiveError(String(msg.error));
          }
          if (msg.closed) {
            stopLiveVoiceSession();
          }
        } catch {
          // ignore malformed payload
        }
      };

      ws.onerror = () => {
        setLiveError('Falha de comunicação no WebSocket Gemini Live.');
        stopLiveVoiceSession();
      };

      ws.onclose = () => {
        stopLiveVoiceSession();
      };
    } catch (err: any) {
      setLiveError(err.message || 'Erro ao iniciar microfone ou sessão Gemini Live.');
      stopLiveVoiceSession();
    }
  };

  return (
    <div className="space-y-5">
      {/* Header + Mode Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-400/35 bg-blue-500/15 text-blue-300">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-[#F4F6F8]">
              NEXO ASSISTENTE — Inteligência Operacional & Multimodal
            </h2>
            <p className="text-xs text-[#AEB8C5]">
              Perfil ativo: {session.user.roleName} · Consultas DB, Chat Multimodal com Grounding e Voz Live
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-1">
          <button
            type="button"
            onClick={() => setActiveTab('DB_QUERY')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
              activeTab === 'DB_QUERY'
                ? 'bg-[#F5B91B] text-[#0A1421]'
                : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>Consulta Base DB</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('MULTIMODAL_CHAT')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
              activeTab === 'MULTIMODAL_CHAT'
                ? 'bg-[#F5B91B] text-[#0A1421]'
                : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Chat IA & Grounding</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('VOICE_AUDIO')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors ${
              activeTab === 'VOICE_AUDIO'
                ? 'bg-[#F5B91B] text-[#0A1421]'
                : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
            }`}
          >
            <Mic className="h-3.5 w-3.5" />
            <span>Voz Live & Transcrição</span>
          </button>
        </div>
      </div>

      {/* =============================================================== */}
      {/* TAB 1: CONSULTA BASE POSTGRESQL (PRESERVADA INTEGRALMENTE)      */}
      {/* =============================================================== */}
      {activeTab === 'DB_QUERY' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
            <span className="inline-flex items-center gap-2 font-semibold">
              <Lock className="h-3.5 w-3.5" />
              Modo Somente Leitura Estrito — Consulta apenas os dados autorizados do PostgreSQL sem alterar saldos ou cadastros.
            </span>
          </div>

          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-5 space-y-4">
            <div className="flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={loadingDb}
                  onClick={() => submitDbQuestion(q)}
                  className="min-h-[40px] rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] px-3 text-left text-xs text-[#AEB8C5] hover:border-[#F5B91B]/50 hover:text-[#F4F6F8]"
                >
                  {q}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitDbQuestion(question);
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Pergunte sobre recebimentos, Silo 38, materiais críticos, pendências de turno, ocorrências ou programação..."
                className="min-h-[48px] flex-1 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 text-sm text-[#F4F6F8]"
              />
              <button
                type="submit"
                disabled={loadingDb || !question.trim()}
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg bg-[#F5B91B] px-5 text-xs font-extrabold text-[#0A1421] disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                <span>{loadingDb ? 'Consultando...' : 'Consultar Base'}</span>
              </button>
            </form>

            {errorDb && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                {errorDb}
              </div>
            )}
          </div>

          <div className="space-y-4">
            {history.length === 0 ? (
              <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-8 text-center text-xs text-[#AEB8C5]">
                Selecione uma pergunta rápida acima ou digite sua dúvida operacional para consultar o PostgreSQL em tempo real.
              </div>
            ) : (
              history.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] p-5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-[#AEB8C5]/15 pb-2">
                    <p className="font-display text-sm font-bold text-[#F5B91B]">{entry.question}</p>
                    {entry.response.usedAiModel && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-300">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>{entry.response.usedAiModel}</span>
                      </span>
                    )}
                  </div>

                  <p className="whitespace-pre-line text-sm leading-relaxed text-[#F4F6F8]">
                    {entry.response.answer}
                  </p>

                  {entry.response.missingDataNotes.length > 0 && (
                    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-2.5 text-xs text-amber-200">
                      <strong>Dados não informados / pendências de cadastro:</strong>{' '}
                      {entry.response.missingDataNotes.join(' ')}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#AEB8C5]/10 pt-2.5 text-[11px] text-[#AEB8C5]">
                    <div className="flex flex-wrap gap-4">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-[#F5B91B]" />
                        Período: {entry.response.periodConsulted}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Database className="h-3.5 w-3.5 text-emerald-400" />
                        Origem: {entry.response.dataOrigin}
                      </span>
                      <span>
                        Atualizado em: {new Date(entry.response.lastUpdatedIso).toLocaleString('pt-BR')}
                      </span>
                    </div>

                    {entry.response.suggestedNavigation && (
                      <button
                        type="button"
                        onClick={() => onNavigate(entry.response.suggestedNavigation!)}
                        className="inline-flex items-center gap-1 font-semibold text-[#F5B91B] hover:underline"
                      >
                        <span>Abrir módulo relacionado</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* =============================================================== */}
      {/* TAB 2: CHAT MULTIMODAL + GROUNDING (GOOGLE SEARCH & MAPS)       */}
      {/* =============================================================== */}
      {activeTab === 'MULTIMODAL_CHAT' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-[#AEB8C5]">
                  <span className="mr-2 font-semibold">Modelo:</span>
                  <select
                    value={chatModel}
                    onChange={(e) =>
                      setChatModel(e.target.value as 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite')
                    }
                    disabled={groundingMode !== 'NONE'}
                    className="min-h-[38px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-2.5 text-xs font-semibold text-[#F4F6F8] disabled:opacity-60"
                  >
                    <option value="gemini-4-hydrogen">gemini-4-hydrogen (Equilibrado + Grounding)</option>
                    <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Alta Velocidade)</option>
                  </select>
                </label>

                <div className="flex items-center gap-1 rounded-lg border border-[#AEB8C5]/20 bg-[#0A1421] p-1">
                  <button
                    type="button"
                    onClick={() => setGroundingMode('NONE')}
                    className={`min-h-[32px] rounded px-2.5 text-xs font-semibold ${
                      groundingMode === 'NONE'
                        ? 'bg-[#3B82F6] text-white'
                        : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                    }`}
                  >
                    Direto
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroundingMode('SEARCH')}
                    className={`inline-flex min-h-[32px] items-center gap-1 rounded px-2.5 text-xs font-semibold ${
                      groundingMode === 'SEARCH'
                        ? 'bg-[#F5B91B] text-[#0A1421]'
                        : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span>Google Search</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGroundingMode('MAPS')}
                    className={`inline-flex min-h-[32px] items-center gap-1 rounded px-2.5 text-xs font-semibold ${
                      groundingMode === 'MAPS'
                        ? 'bg-emerald-500 text-[#0A1421]'
                        : 'text-[#AEB8C5] hover:text-[#F4F6F8]'
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    <span>Google Maps</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSystemBox((v) => !v)}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs font-semibold text-[#AEB8C5] hover:text-[#F4F6F8]"
                >
                  <Settings2 className="h-3.5 w-3.5 text-[#F5B91B]" />
                  <span>Instrução do Sistema</span>
                </button>
                {chatTurns.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setChatTurns([])}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-300 hover:bg-red-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Limpar</span>
                  </button>
                )}
              </div>
            </div>

            {showSystemBox && (
              <div className="border-t border-[#AEB8C5]/15 pt-3">
                <label className="block text-xs text-[#AEB8C5]">
                  <span>System Instruction (comportamento base do assistente)</span>
                  <textarea
                    rows={2}
                    value={systemInstruction}
                    onChange={(e) => setSystemInstruction(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] p-2.5 text-xs text-[#F4F6F8]"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Conversation Feed */}
          <div className="min-h-[320px] max-h-[480px] space-y-3 overflow-y-auto rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-4">
            {chatTurns.length === 0 ? (
              <div className="flex h-[260px] flex-col items-center justify-center text-center text-xs text-[#AEB8C5]">
                <Sparkles className="mb-2 h-7 w-7 text-[#F5B91B]" />
                <p className="font-semibold text-[#F4F6F8]">
                  Chat Multi-Turno com Grounding Web, Mapas e Análise Multimodal
                </p>
                <p className="mt-1 max-w-md">
                  Faça perguntas técnicas, anexe uma imagem/PDF operacional ou ative Google Search / Google Maps para localizar rotas e fornecedores com links verificados.
                </p>
              </div>
            ) : (
              chatTurns.map((turn) => (
                <div
                  key={turn.id}
                  className={`rounded-xl border p-4 ${
                    turn.role === 'user'
                      ? 'ml-auto max-w-3xl border-[#F5B91B]/35 bg-[#152336]'
                      : 'mr-auto max-w-4xl border-[#AEB8C5]/20 bg-[#0A1421]'
                  }`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={`font-bold ${
                        turn.role === 'user' ? 'text-[#F5B91B]' : 'text-blue-300'
                      }`}
                    >
                      {turn.role === 'user' ? session.user.displayName : `NEXO IA (${turn.model})`}
                    </span>
                    {turn.attachmentName && (
                      <span className="rounded bg-[#0A1421] px-2 py-0.5 text-[#AEB8C5]">
                        Anexo: {turn.attachmentName}
                      </span>
                    )}
                    {turn.groundingMode && turn.groundingMode !== 'NONE' && (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                        Grounding: {turn.groundingMode}
                      </span>
                    )}
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#F4F6F8]">
                    {turn.text}
                  </p>

                  {turn.groundingLinks && turn.groundingLinks.length > 0 && (
                    <div className="mt-3 border-t border-[#AEB8C5]/15 pt-2.5">
                      <p className="mb-1.5 text-[11px] font-semibold text-[#AEB8C5]">
                        Fontes e Locais Verificados:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {turn.groundingLinks.map((lnk) => (
                          <a
                            key={lnk.uri}
                            href={lnk.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-400/35 bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-500/20"
                          >
                            {lnk.type === 'maps' || lnk.type === 'review' ? (
                              <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Globe className="h-3.5 w-3.5 text-blue-300" />
                            )}
                            <span>{lnk.title}</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {chatError && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              {chatError}
            </div>
          )}

          {/* Chat Input Bar */}
          <form
            onSubmit={handleSendChat}
            className="flex flex-col gap-2 rounded-xl border border-[#AEB8C5]/15 bg-[#101B2A] p-3 sm:flex-row sm:items-center"
          >
            <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs font-semibold text-[#AEB8C5] hover:border-[#F5B91B] hover:text-[#F4F6F8]">
              <Paperclip className="h-4 w-4 text-[#F5B91B]" />
              <span>{attachment ? attachment.name.slice(0, 18) : 'Anexar'}</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={handleAttachmentChange}
                className="hidden"
              />
            </label>

            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                groundingMode === 'MAPS'
                  ? 'Ex.: Transportadoras ou fornecedores de calcário próximos à planta...'
                  : groundingMode === 'SEARCH'
                    ? 'Ex.: Normas atuais de segurança para descarga em silos industriais...'
                    : 'Digite sua pergunta ou envie uma imagem/PDF para análise...'
              }
              className="min-h-[44px] flex-1 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 text-sm text-[#F4F6F8]"
            />

            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#F5B91B] px-5 text-xs font-extrabold text-[#0A1421] disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              <span>{chatLoading ? 'Gerando...' : 'Enviar'}</span>
            </button>
          </form>
        </div>
      )}

      {/* =============================================================== */}
      {/* TAB 3: VOZ LIVE (gemini-3.8-live) & TRANSCRIÇÃO (3.5-transcribe) */}
      {/* =============================================================== */}
      {activeTab === 'VOICE_AUDIO' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Panel A: Live Voice Copiloto */}
          <div className="rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-[#AEB8C5]/15 pb-3">
              <div>
                <h3 className="flex items-center gap-2 font-display text-base font-bold text-[#F4F6F8]">
                  <Volume2 className="h-4 w-4 text-[#F5B91B]" />
                  <span>Conversa por Voz em Tempo Real</span>
                </h3>
                <p className="mt-0.5 text-xs text-[#AEB8C5]">
                  Modelo <code className="text-[#F5B91B]">gemini-3.8-live</code> · Áudio bidirecional PCM 16kHz / 24kHz
                </p>
              </div>
              <span
                className={`rounded-md px-2.5 py-1 text-[11px] font-bold ${
                  liveStatus === 'CONNECTED'
                    ? 'border border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : liveStatus === 'CONNECTING'
                      ? 'border border-[#F5B91B]/50 bg-[#F5B91B]/15 text-[#F5B91B]'
                      : 'border border-[#AEB8C5]/25 bg-[#0A1421] text-[#AEB8C5]'
                }`}
              >
                {liveStatus === 'CONNECTED'
                  ? 'AO VIVO'
                  : liveStatus === 'CONNECTING'
                    ? 'CONECTANDO...'
                    : 'DESCONECTADO'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs text-[#AEB8C5]">
                <span className="mr-2 font-semibold">Voz do Copiloto:</span>
                <select
                  value={liveVoice}
                  disabled={liveStatus !== 'IDLE'}
                  onChange={(e) => setLiveVoice(e.target.value as any)}
                  className="min-h-[40px] rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-3 text-xs font-semibold text-[#F4F6F8] disabled:opacity-60"
                >
                  <option value="Zephyr">Zephyr (Padrão)</option>
                  <option value="Kore">Kore</option>
                  <option value="Puck">Puck</option>
                  <option value="Charon">Charon</option>
                  <option value="Fenrir">Fenrir</option>
                </select>
              </label>

              {liveStatus === 'IDLE' ? (
                <button
                  type="button"
                  onClick={startLiveVoiceSession}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#F5B91B] px-4 text-xs font-extrabold text-[#0A1421] hover:bg-[#F5B91B]/90"
                >
                  <PhoneCall className="h-4 w-4" />
                  <span>Iniciar Voz ao Vivo</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopLiveVoiceSession}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-red-500/50 bg-red-600 px-4 text-xs font-extrabold text-white hover:bg-red-700"
                >
                  <PhoneOff className="h-4 w-4" />
                  <span>Encerrar Sessão</span>
                </button>
              )}
            </div>

            {liveError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                {liveError}
              </div>
            )}

            <div className="h-[260px] space-y-2 overflow-y-auto rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-3 text-xs">
              {liveTranscripts.length === 0 ? (
                <p className="py-12 text-center text-[#AEB8C5]">
                  Clique em "Iniciar Voz ao Vivo", permita o uso do microfone e converse diretamente com o assistente NEXO LOG.
                </p>
              ) : (
                liveTranscripts.map((item) => (
                  <div key={item.id} className="leading-relaxed">
                    <span
                      className={`mr-1.5 font-bold ${
                        item.speaker === 'Você'
                          ? 'text-[#F5B91B]'
                          : item.speaker === 'NEXO Voz'
                            ? 'text-blue-300'
                            : 'text-emerald-400'
                      }`}
                    >
                      {item.speaker}:
                    </span>
                    <span className="text-[#F4F6F8]">{item.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Panel B: Audio Transcription (gemini-3.5-transcribe) */}
          <div className="rounded-xl border border-[#AEB8C5]/20 bg-[#101B2A] p-5 space-y-4">
            <div className="border-b border-[#AEB8C5]/15 pb-3">
              <h3 className="flex items-center gap-2 font-display text-base font-bold text-[#F4F6F8]">
                <FileAudio className="h-4 w-4 text-[#F5B91B]" />
                <span>Transcrição de Áudio Operacional</span>
              </h3>
              <p className="mt-0.5 text-xs text-[#AEB8C5]">
                Modelo <code className="text-[#F5B91B]">gemini-3.5-transcribe</code> · Ideal para notas de passagem de turno e ocorrências
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={toggleClipRecording}
                disabled={transcribing}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-xs font-bold ${
                  isRecordingClip
                    ? 'bg-red-600 text-white'
                    : 'border border-[#F5B91B]/50 bg-[#0A1421] text-[#F5B91B] hover:bg-[#F5B91B]/10'
                }`}
              >
                {isRecordingClip ? (
                  <>
                    <Square className="h-4 w-4" />
                    <span>Parar e Transcrever</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" />
                    <span>Gravar Nota por Microfone</span>
                  </>
                )}
              </button>

              <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-[#AEB8C5]/25 bg-[#0A1421] px-4 text-xs font-semibold text-[#F4F6F8] hover:border-[#F5B91B]">
                <FileAudio className="h-4 w-4 text-blue-300" />
                <span>Enviar Arquivo de Áudio</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioFileUpload}
                  className="hidden"
                />
              </label>

              {isRecordingClip && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300">
                  <MicOff className="h-3.5 w-3.5" />
                  <span>Gravando áudio...</span>
                </span>
              )}
            </div>

            {transcribeError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                {transcribeError}
              </div>
            )}

            <div className="min-h-[260px] rounded-lg border border-[#AEB8C5]/15 bg-[#0A1421] p-4 text-xs">
              {transcribing ? (
                <p className="py-12 text-center text-[#F5B91B] font-semibold">
                  Transcrevendo áudio com gemini-3.5-transcribe...
                </p>
              ) : transcriptResult ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#AEB8C5]/15 pb-2">
                    <span className="font-semibold text-blue-300">
                      Transcrição ({transcriptResult.model})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setChatInput(transcriptResult.transcript);
                        setActiveTab('MULTIMODAL_CHAT');
                      }}
                      className="font-semibold text-[#F5B91B] hover:underline"
                    >
                      Enviar para o Chat IA →
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#F4F6F8]">
                    {transcriptResult.transcript}
                  </p>
                </div>
              ) : (
                <p className="py-12 text-center text-[#AEB8C5]">
                  Grave um áudio rápido pelo microfone ou envie uma gravação (MP3, WAV, WebM, OGG) para transcrever com alta precisão.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
