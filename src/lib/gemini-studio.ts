import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';

export const ALLOWED_FREE_CHAT_MODELS = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;
export type AllowedChatModel = (typeof ALLOWED_FREE_CHAT_MODELS)[number];

export type GroundingMode = 'NONE' | 'SEARCH' | 'MAPS';

export interface StudioChatMessageInput {
  role: 'user' | 'model';
  text: string;
}

export interface GroundingLinkItem {
  type: 'web' | 'maps' | 'review';
  title: string;
  uri: string;
}

export interface StudioChatResult {
  replyText: string;
  model: AllowedChatModel;
  groundingMode: GroundingMode;
  groundingLinks: GroundingLinkItem[];
  googleMapsWidgetContextToken: string | null;
}

export interface AudioTranscriptionResult {
  transcript: string;
  model: string;
  mimeType: string;
}

export function requireGeminiStudioClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY não configurada no servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractGroundingLinks(response: any): {
  links: GroundingLinkItem[];
  mapsWidgetToken: string | null;
} {
  const metadata = response?.candidates?.[0]?.groundingMetadata;
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  const links: GroundingLinkItem[] = [];
  const seenUris = new Set<string>();

  for (const chunk of chunks) {
    if (chunk?.web?.uri && !seenUris.has(chunk.web.uri)) {
      seenUris.add(chunk.web.uri);
      links.push({
        type: 'web',
        title: String(chunk.web.title || chunk.web.uri),
        uri: String(chunk.web.uri),
      });
    }
    if (chunk?.maps?.uri && !seenUris.has(chunk.maps.uri)) {
      seenUris.add(chunk.maps.uri);
      links.push({
        type: 'maps',
        title: String(chunk.maps.title || 'Local no Google Maps'),
        uri: String(chunk.maps.uri),
      });
    }
    const snippets = chunk?.maps?.placeAnswerSources?.reviewSnippets;
    if (Array.isArray(snippets)) {
      for (const snip of snippets) {
        if (snip?.googleMapsUri && !seenUris.has(snip.googleMapsUri)) {
          seenUris.add(snip.googleMapsUri);
          links.push({
            type: 'review',
            title: String(snip.title || 'Avaliação no Google Maps'),
            uri: String(snip.googleMapsUri),
          });
        }
      }
    }
  }

  return {
    links,
    mapsWidgetToken: metadata?.googleMapsWidgetContextToken
      ? String(metadata.googleMapsWidgetContextToken)
      : null,
  };
}

export async function runMultimodalStudioChat(params: {
  model: string;
  messages: StudioChatMessageInput[];
  systemInstruction?: string;
  groundingMode?: GroundingMode;
  latLng?: { latitude: number; longitude: number } | null;
  attachment?: { mimeType: string; dataBase64: string } | null;
}): Promise<StudioChatResult> {
  const ai = requireGeminiStudioClient();

  const selectedModel: AllowedChatModel = ALLOWED_FREE_CHAT_MODELS.includes(
    params.model as AllowedChatModel
  )
    ? (params.model as AllowedChatModel)
    : 'gemini-4-hydrogen';

  const groundingMode: GroundingMode =
    params.groundingMode === 'SEARCH' || params.groundingMode === 'MAPS'
      ? params.groundingMode
      : 'NONE';

  // Google Search / Google Maps grounding works best on gemini-4-hydrogen
  const effectiveModel: AllowedChatModel =
    groundingMode !== 'NONE' ? 'gemini-4-hydrogen' : selectedModel;

  const cleanMessages = params.messages
    .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
    .slice(-20);

  if (cleanMessages.length === 0) {
    throw new Error('Envie pelo menos uma mensagem para iniciar a conversa.');
  }

  const contents = cleanMessages.map((msg, idx) => {
    const isLastUser = idx === cleanMessages.length - 1 && msg.role === 'user';
    const parts: any[] = [{ text: msg.text }];
    if (isLastUser && params.attachment?.dataBase64 && params.attachment?.mimeType) {
      parts.push({
        inlineData: {
          mimeType: params.attachment.mimeType,
          data: params.attachment.dataBase64,
        },
      });
    }
    return {
      role: msg.role,
      parts,
    };
  });

  const config: Record<string, unknown> = {};
  const defaultSystem =
    'Você é o assistente técnico industrial do NEXO LOG 2.0 (Gestão Inteligente da Moega). Responda em português (pt-BR) de forma objetiva, técnica e segura.';
  config.systemInstruction = params.systemInstruction?.trim() || defaultSystem;

  if (groundingMode === 'SEARCH') {
    config.tools = [{ googleSearch: {} }];
  } else if (groundingMode === 'MAPS') {
    config.tools = [{ googleMaps: {} }];
    if (
      params.latLng &&
      Number.isFinite(params.latLng.latitude) &&
      Number.isFinite(params.latLng.longitude)
    ) {
      config.toolConfig = {
        retrievalConfig: {
          latLng: {
            latitude: params.latLng.latitude,
            longitude: params.latLng.longitude,
          },
        },
      };
    }
  }

  const response = await ai.models.generateContent({
    model: effectiveModel,
    contents,
    config,
  });

  const { links, mapsWidgetToken } = extractGroundingLinks(response);

  return {
    replyText: String(response.text || '').trim() || 'Sem resposta textual gerada.',
    model: effectiveModel,
    groundingMode,
    groundingLinks: links,
    googleMapsWidgetContextToken: mapsWidgetToken,
  };
}

export async function transcribeAudioWithGemini(params: {
  audioBase64: string;
  mimeType: string;
  prompt?: string;
}): Promise<AudioTranscriptionResult> {
  const ai = requireGeminiStudioClient();
  const cleanBase64 = params.audioBase64.replace(/^data:[^;]+;base64,/, '').trim();
  if (!cleanBase64) {
    throw new Error('Arquivo ou gravação de áudio vazio.');
  }

  const mimeType = params.mimeType || 'audio/webm';
  const promptText =
    params.prompt?.trim() ||
    'Transcreva fielmente este áudio operacional em português (pt-BR), preservando números de silos, lotes, códigos de matéria-prima e quantidades citadas.';

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: cleanBase64,
          },
        },
        { text: promptText },
      ],
    },
  });

  return {
    transcript: String(response.text || '').trim() || 'Nenhuma fala identificada no áudio.',
    model: 'gemini-3.5-transcribe',
    mimeType,
  };
}

export async function openGeminiLiveVoiceSession(params: {
  voiceName?: string;
  systemInstruction?: string;
  onAudioChunk: (base64Pcm24k: string) => void;
  onInputTranscript: (text: string) => void;
  onOutputTranscript: (text: string) => void;
  onInterrupted: () => void;
  onTurnComplete: () => void;
  onError: (errMessage: string) => void;
  onClose: () => void;
}) {
  const ai = requireGeminiStudioClient();
  const allowedVoices = ['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'];
  const voiceName = allowedVoices.includes(String(params.voiceName || ''))
    ? String(params.voiceName)
    : 'Zephyr';

  const session = await ai.live.connect({
    model: 'gemini-3.8-live',
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction:
        params.systemInstruction?.trim() ||
        'Você é o copiloto de voz operacional do NEXO LOG 2.0 na Moega. Responda sempre em português (pt-BR), de forma clara, objetiva e concisa para operadores industriais.',
    },
    callbacks: {
      onmessage: (message: LiveServerMessage) => {
        const content = message.serverContent;
        if (content?.inputTranscription?.text) {
          params.onInputTranscript(content.inputTranscription.text);
        }
        if (content?.outputTranscription?.text) {
          params.onOutputTranscript(content.outputTranscription.text);
        }
        for (const part of content?.modelTurn?.parts ?? []) {
          if (part.inlineData?.data) {
            params.onAudioChunk(part.inlineData.data);
          }
        }
        if (content?.interrupted) {
          params.onInterrupted();
        }
        if (content?.turnComplete) {
          params.onTurnComplete();
        }
      },
      onerror: (ev: any) => {
        params.onError(String(ev?.message || 'Erro na sessão de voz Gemini Live.'));
      },
      onclose: () => {
        params.onClose();
      },
    },
  });

  return session;
}
