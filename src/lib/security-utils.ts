import type { ReceiptAttachmentItem } from '../types/nexo.ts';

export const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const ALLOWED_RECEIPT_ATTACHMENT_MIMES = new Set([
  ...ALLOWED_IMAGE_MIMES,
  'application/pdf',
]);

export const ALLOWED_BASKET_UPLOAD_MIMES = new Set([
  ...ALLOWED_IMAGE_MIMES,
  'application/pdf',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
]);

export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_AUDIO_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB
export const MAX_RECEIPT_ATTACHMENTS = 6;
export const MAX_PERSISTED_LABEL_PREVIEW_CHARS = 1_500_000; // ~1.1 MB base64 cap for label_scans column

export function estimateBase64DecodedBytes(rawOrDataUrl: string): number {
  const clean = rawOrDataUrl.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

export function normalizeMime(mimeType: string | undefined | null): string {
  return String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

export function validateImageUploadPayload(params: {
  base64: string;
  mimeType?: string | null;
  maxBytes?: number;
}): { valid: true; normalizedMime: string; decodedBytes: number } | { valid: false; error: string } {
  const normalizedMime = normalizeMime(params.mimeType || 'image/jpeg');
  if (!ALLOWED_IMAGE_MIMES.has(normalizedMime)) {
    return {
      valid: false,
      error: `Formato de imagem não permitido (${normalizedMime || 'desconhecido'}). Use JPG, PNG, WEBP ou HEIC.`,
    };
  }
  const clean = String(params.base64 || '').trim();
  if (!clean || clean === 'DEMO_SIMULATED_LABEL') {
    return { valid: false, error: 'Conteúdo da imagem ausente ou inválido.' };
  }
  const decodedBytes = estimateBase64DecodedBytes(clean);
  const limit = params.maxBytes ?? MAX_IMAGE_UPLOAD_BYTES;
  if (decodedBytes <= 0) {
    return { valid: false, error: 'Arquivo de imagem vazio.' };
  }
  if (decodedBytes > limit) {
    return {
      valid: false,
      error: `Imagem excede o limite máximo permitido (${Math.round(limit / (1024 * 1024))} MB).`,
    };
  }
  return { valid: true, normalizedMime, decodedBytes };
}

export function validateAudioUploadPayload(params: {
  base64: string;
  mimeType?: string | null;
}): { valid: true; normalizedMime: string; decodedBytes: number } | { valid: false; error: string } {
  const normalizedMime = normalizeMime(params.mimeType || 'audio/webm');
  if (!ALLOWED_AUDIO_MIMES.has(normalizedMime)) {
    return {
      valid: false,
      error: `Formato de áudio não suportado (${normalizedMime || 'desconhecido'}).`,
    };
  }
  const decodedBytes = estimateBase64DecodedBytes(params.base64);
  if (decodedBytes <= 0) {
    return { valid: false, error: 'Áudio vazio.' };
  }
  if (decodedBytes > MAX_AUDIO_UPLOAD_BYTES) {
    return {
      valid: false,
      error: `Áudio excede o limite de ${Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    };
  }
  return { valid: true, normalizedMime, decodedBytes };
}

export function validateReceiptAttachments(
  input: unknown
): { valid: true; items: ReceiptAttachmentItem[] } | { valid: false; error: string } {
  if (input === undefined || input === null) {
    return { valid: true, items: [] };
  }
  if (!Array.isArray(input)) {
    return { valid: false, error: 'Lista de anexos do recebimento inválida.' };
  }
  if (input.length > MAX_RECEIPT_ATTACHMENTS) {
    return {
      valid: false,
      error: `Máximo de ${MAX_RECEIPT_ATTACHMENTS} fotografias/documentos por recebimento.`,
    };
  }

  const allowedKinds = new Set(['FOTO_CARGA', 'NOTA_FISCAL', 'TICKET_BALANCA', 'DOCUMENTO']);
  const sanitized: ReceiptAttachmentItem[] = [];

  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as any;
    if (!raw || typeof raw !== 'object') {
      return { valid: false, error: `Anexo #${i + 1} inválido.` };
    }
    const name = String(raw.name || `anexo-${i + 1}`).trim().slice(0, 120);
    const mimeType = normalizeMime(raw.mimeType || 'image/jpeg');
    if (!ALLOWED_RECEIPT_ATTACHMENT_MIMES.has(mimeType)) {
      return {
        valid: false,
        error: `Tipo de arquivo não permitido em "${name}" (${mimeType || 'desconhecido'}). Envie imagem ou PDF.`,
      };
    }
    const dataUrl = String(raw.dataUrl || '').trim();
    if (!dataUrl.startsWith(`data:${mimeType};base64,`) && !dataUrl.startsWith('data:image/') && !dataUrl.startsWith('data:application/pdf;base64,')) {
      return {
        valid: false,
        error: `Conteúdo do anexo "${name}" deve estar em formato Data URL válido.`,
      };
    }
    const bytes = estimateBase64DecodedBytes(dataUrl);
    if (bytes <= 0 || bytes > MAX_ATTACHMENT_BYTES) {
      return {
        valid: false,
        error: `O anexo "${name}" excede o tamanho máximo de ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
      };
    }

    const kindRaw = String(raw.kind || 'DOCUMENTO').toUpperCase();
    const kind = (allowedKinds.has(kindRaw) ? kindRaw : 'DOCUMENTO') as ReceiptAttachmentItem['kind'];

    sanitized.push({
      id: String(raw.id || `att-${Date.now()}-${i}`).slice(0, 64),
      name,
      mimeType,
      kind,
      sizeBytes: bytes,
      dataUrl,
      capturedAtIso:
        typeof raw.capturedAtIso === 'string' && raw.capturedAtIso
          ? raw.capturedAtIso
          : new Date().toISOString(),
    });
  }

  return { valid: true, items: sanitized };
}

export function capLabelPreviewDataUrl(
  imageBase64OrDataUrl: string | null | undefined,
  mimeType = 'image/jpeg'
): string | null {
  if (!imageBase64OrDataUrl) return null;
  const trimmed = String(imageBase64OrDataUrl).trim();
  if (!trimmed || trimmed === 'DEMO_SIMULATED_LABEL') return null;
  const normalizedMime = normalizeMime(mimeType);
  if (!ALLOWED_IMAGE_MIMES.has(normalizedMime)) return null;
  const dataUrl = trimmed.startsWith('data:')
    ? trimmed
    : `data:${normalizedMime};base64,${trimmed}`;
  if (dataUrl.length > MAX_PERSISTED_LABEL_PREVIEW_CHARS) {
    return null;
  }
  return dataUrl;
}

/**
 * Remove identificadores pessoais (PII) de operadores, motoristas e e-mails
 * antes de servir dados no endpoint público de bootstrap da Apresentação Executiva.
 */
export function sanitizePresentationBootstrapData<
  T extends {
    shifts: any[];
    routes: any[];
    receipts: any[];
    movements: any[];
    transferOrders: any[];
    schedules: any[];
    occurrences: any[];
    handovers: any[];
    recentSnapshots: any[];
    rubricagemBatches?: any[];
  }
>(input: T): T {
  const maskName = (val: unknown, fallback: string) =>
    typeof val === 'string' && val.trim().length > 0 ? fallback : null;

  return {
    ...input,
    shifts: (input.shifts ?? []).map((s) => ({
      ...s,
      supervisorUserId: null,
      supervisorName: s.supervisorName ? 'Supervisão do Turno' : null,
      responsibleName: s.responsibleName ? 'Responsável do Turno' : null,
      operatorIds: [],
      operators: (s.operators ?? []).map((op: any, idx: number) => ({
        id: idx + 1,
        displayName: `Operador ${idx + 1}`,
        badgeCode: null,
        roleCode: op.roleCode || 'OPERADOR_MOEGA',
      })),
    })),
    routes: (input.routes ?? []).map((r) => ({
      ...r,
      approvedByName: maskName(r.approvedByName, 'Supervisão'),
      updatedByName: maskName(r.updatedByName, 'Supervisão'),
      history: (r.history ?? []).map((h: any) => ({
        ...h,
        userId: null,
        userEmail: 'operacional@nexolog.local',
        userName: h.userRole || 'Operação',
      })),
    })),
    receipts: (input.receipts ?? []).map((r) => ({
      ...r,
      operatorUserId: 0,
      operatorName: 'Operador de Turno',
      operatorBadge: null,
      executedByName: maskName(r.executedByName, 'Executor de Turno'),
      executedByBadge: null,
      driverName: maskName(r.driverName, 'Motorista (Protegido)'),
      vehiclePlate: null,
      attachments: Array.isArray(r.attachments)
        ? r.attachments.map((att: any) => ({
            ...att,
            dataUrl: '',
          }))
        : [],
      distributions: (r.distributions ?? []).map((d: any) => ({
        ...d,
        operatorName: 'Operador de Turno',
        operatorBadge: null,
        executedByName: maskName(d.executedByName, 'Executor de Turno'),
        executedByBadge: null,
      })),
    })),
    movements: (input.movements ?? []).map((m) => ({
      ...m,
      operatorName: 'Operador de Turno',
      operatorBadge: null,
      executedByName: maskName(m.executedByName, 'Executor de Turno'),
      executedByBadge: null,
    })),
    transferOrders: (input.transferOrders ?? []).map((o) => ({
      ...o,
      requestedByName: 'Planejamento / Operação',
      approvedByName: maskName(o.approvedByName, 'Supervisão'),
      assignedOperatorName: maskName(o.assignedOperatorName, 'Operador de Turno'),
      interruptedByName: maskName(o.interruptedByName, 'Operador de Turno'),
      steps: (o.steps ?? []).map((st: any) => ({
        ...st,
        executedByName: 'Operador de Turno',
        executedByBadge: null,
      })),
    })),
    schedules: (input.schedules ?? []).map((sc) => ({
      ...sc,
      importedByName: 'Planejamento / Operação',
      approvedByName: maskName(sc.approvedByName, 'Supervisão'),
    })),
    occurrences: (input.occurrences ?? []).map((oc) => ({
      ...oc,
      reportedByUserId: 0,
      reportedByName: 'Operador de Turno',
      reportedByBadge: null,
      executedByName: maskName(oc.executedByName, 'Executor de Turno'),
      executedByBadge: null,
      assignedToUserId: null,
      assignedToName: maskName(oc.assignedToName, 'Equipe Responsável'),
      verifiedByName: maskName(oc.verifiedByName, 'Supervisão'),
      closedByName: maskName(oc.closedByName, 'Supervisão'),
    })),
    handovers: (input.handovers ?? []).map((h) => ({
      ...h,
      handoverByUserId: 0,
      handoverByName: 'Operador de Turno',
      handoverByBadge: null,
      receivedByUserId: null,
      receivedByName: maskName(h.receivedByName, 'Próximo Turno'),
      reviewedByName: maskName(h.reviewedByName, 'Supervisão'),
      approvedByName: maskName(h.approvedByName, 'Supervisão'),
      finalizedByName: maskName(h.finalizedByName, 'Operador de Turno'),
      autoSummary: h.autoSummary
        ? {
            ...h.autoSummary,
            shiftOperators: [],
            shiftOccurrences: (h.autoSummary.shiftOccurrences ?? []).map((so: any) => ({
              ...so,
              verifiedByName: maskName(so.verifiedByName, 'Supervisão'),
              reportedByName: 'Operador de Turno',
            })),
          }
        : h.autoSummary,
      revisions: (h.revisions ?? []).map((rev: any) => ({
        ...rev,
        editedByUserId: 0,
        editedByName: 'Operação / Supervisão',
        editedByBadge: null,
      })),
    })),
    recentSnapshots: (input.recentSnapshots ?? []).map((sn) => ({
      ...sn,
      generatedByName: 'Sistema / Gestão',
    })),
    rubricagemBatches: (input.rubricagemBatches ?? []).map((b) => ({
      ...b,
      sourceImageDataUrl: null,
      importedByUserId: 0,
      importedByName: 'Operador de Turno',
      authorizedByName: maskName(b.authorizedByName, 'Supervisão'),
      entries: Array.isArray(b.entries)
        ? b.entries.map((e: any) => ({
            ...e,
            confirmedByName: maskName(e.confirmedByName, 'Supervisão'),
          }))
        : [],
    })),
  };
}
