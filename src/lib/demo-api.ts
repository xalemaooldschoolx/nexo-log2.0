import type {
  AuthorizedRouteItem,
  BarcodeParseResponse,
  CompatibleSiloOption,
  GeminiPhotoParseResponse,
  GeminiSupplyAdviceResponse,
  LotHistoryResponse,
  NexoAssistantResponse,
  ParsedScheduleDocumentResponse,
  PerformanceTargetItem,
  PeriodPreset,
  PresentationBootstrapPayload,
  PresentationLiveCounts,
  PresentationViewMode,
  ProductionScheduleView,
  ProductWithFactorsItem,
  ReceiptAttachmentItem,
  ReceiptItem,
  ReportFilterParams,
  SessionData,
  ShiftHandoverView,
  SiloDetail,
  TransferOrderItem,
} from '../types/nexo.ts';
import { parseOperationalBarcode } from './barcode-parser.ts';
import {
  applyPresentationBootstrap,
  buildDemoAutoSummary,
  buildDemoConsumptionReport,
  buildDemoDashboard,
  buildDemoReceivingReport,
  buildDemoReportsOverview,
  buildDemoShiftManagerialReport,
  buildDemoSiloLedger,
  buildDemoStockReport,
  buildDemoTransfersReport,
  createInitialDemoState,
  type DemoSandboxState,
  recomputeDemoDerivedState,
  buildDemo30DayConsumptionTrend,
  buildDemoSiloVolumeHistory24h,
} from './demo-data.ts';
import {
  buildMoegaShiftNarrativeReport,
  polishShiftReportTextDeterministic,
} from './phase5-analytics.ts';
import {
  buildReference2511BasketVersions,
  compareBasketVersions,
  convertRawQuantityToKg,
  formatBrazilianDiff,
  formatBrazilianNumber,
  normalizeLineCode,
} from './basket-comparator.ts';
import type {
  BasketExtractResponse,
  BasketNotificationEvent,
  BasketVersionView,
} from '../types/nexo.ts';
import { evaluateSiloStockStatus } from './stock-status.ts';
import {
  MAX_RECEIPT_ATTACHMENTS,
  validateReceiptAttachments,
} from './security-utils.ts';

function buildSimulatedLabelSvgDataUrl(params: {
  materialCode: string;
  description: string;
  supplierName: string;
  lotCode: string;
  weightLabel: string;
  rawBarcodeText: string;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="340" viewBox="0 0 560 340">
  <rect width="560" height="340" rx="12" fill="#F8FAFC" stroke="#0F172A" stroke-width="4"/>
  <rect x="0" y="0" width="560" height="52" rx="10" fill="#0A1421"/>
  <text x="20" y="33" font-family="monospace, sans-serif" font-size="16" font-weight="bold" fill="#F5B91B">ETIQUETA INDUSTRIAL · RQ-REC-044 (SIMULAÇÃO)</text>
  <text x="24" y="88" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">MATÉRIA-PRIMA / CÓDIGO</text>
  <text x="24" y="116" font-family="monospace, sans-serif" font-size="24" font-weight="bold" fill="#0F172A">${esc(params.materialCode)} — ${esc(params.description.slice(0, 26))}</text>
  <line x1="24" y1="132" x2="536" y2="132" stroke="#CBD5E1" stroke-width="2"/>
  <text x="24" y="160" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">FORNECEDOR</text>
  <text x="24" y="182" font-family="sans-serif" font-size="18" font-weight="bold" fill="#0F172A">${esc(params.supplierName)}</text>
  <text x="310" y="160" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">LOTE</text>
  <text x="310" y="184" font-family="monospace, sans-serif" font-size="22" font-weight="bold" fill="#B45309">${esc(params.lotCode)}</text>
  <text x="24" y="220" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">PESO / EMBALAGEM</text>
  <text x="24" y="244" font-family="monospace, sans-serif" font-size="20" font-weight="bold" fill="#0F172A">${esc(params.weightLabel)}</text>
  <g transform="translate(24, 266)">
    <rect x="0" y="0" width="512" height="50" fill="#FFFFFF" stroke="#CBD5E1"/>
    <path d="M16,6 v30 M22,6 v30 M26,6 v30 M34,6 v30 M38,6 v30 M46,6 v30 M50,6 v30 M58,6 v30 M64,6 v30 M70,6 v30 M78,6 v30 M86,6 v30 M92,6 v30 M100,6 v30 M108,6 v30 M114,6 v30 M122,6 v30 M130,6 v30 M136,6 v30 M144,6 v30 M152,6 v30 M158,6 v30 M166,6 v30 M174,6 v30 M182,6 v30 M188,6 v30 M196,6 v30 M204,6 v30 M210,6 v30 M218,6 v30 M226,6 v30 M232,6 v30 M240,6 v30 M248,6 v30 M256,6 v30 M262,6 v30 M270,6 v30 M278,6 v30 M284,6 v30 M292,6 v30 M300,6 v30 M306,6 v30 M314,6 v30 M322,6 v30 M330,6 v30 M336,6 v30 M344,6 v30 M352,6 v30 M358,6 v30 M366,6 v30 M374,6 v30 M380,6 v30 M388,6 v30 M396,6 v30 M402,6 v30 M410,6 v30 M418,6 v30 M424,6 v30 M432,6 v30 M440,6 v30 M446,6 v30 M454,6 v30 M462,6 v30 M470,6 v30 M478,6 v30 M486,6 v30 M494,6 v30" stroke="#0F172A" stroke-width="2.5"/>
    <text x="256" y="46" text-anchor="middle" font-family="monospace, sans-serif" font-size="11" fill="#334155">${esc(params.rawBarcodeText)}</text>
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

let demoState: DemoSandboxState = createInitialDemoState('CENARIO_REALISTA');
let cachedBootstrapPayload: PresentationBootstrapPayload | null = null;
let currentViewMode: PresentationViewMode = 'CENARIO_REALISTA';
let nextSeqId = 5000;

export interface PresentationMetaSnapshot {
  viewMode: PresentationViewMode;
  bootstrapSyncedAtIso: string | null;
  liveCounts: PresentationLiveCounts;
  hasServerBootstrap: boolean;
}

export function getDemoStateSnapshot(): DemoSandboxState {
  return demoState;
}

export function getDemoSession(): SessionData {
  return demoState.session;
}

export function getPresentationMeta(): PresentationMetaSnapshot {
  return {
    viewMode: demoState.viewMode,
    bootstrapSyncedAtIso: demoState.bootstrapSyncedAtIso,
    liveCounts: demoState.liveCounts,
    hasServerBootstrap: Boolean(demoState.bootstrapPayload || cachedBootstrapPayload),
  };
}

export function switchPresentationViewMode(viewMode: PresentationViewMode): DemoSandboxState {
  currentViewMode = viewMode;
  if (cachedBootstrapPayload) {
    demoState = applyPresentationBootstrap(cachedBootstrapPayload, viewMode);
  } else {
    demoState = createInitialDemoState(viewMode);
  }
  return demoState;
}

export function resetDemoSandboxState(): DemoSandboxState {
  if (cachedBootstrapPayload) {
    demoState = applyPresentationBootstrap(cachedBootstrapPayload, currentViewMode);
  } else {
    demoState = createInitialDemoState(currentViewMode);
  }
  return demoState;
}

export async function bootstrapPresentationFromServer(
  forceMode?: PresentationViewMode
): Promise<PresentationMetaSnapshot> {
  const targetMode = forceMode ?? currentViewMode;
  currentViewMode = targetMode;

  if (typeof fetch !== 'function') {
    return getPresentationMeta();
  }

  try {
    const res = await fetch('/api/presentation/bootstrap', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return getPresentationMeta();
    }
    const payload = (await res.json()) as PresentationBootstrapPayload;
    if (payload && Array.isArray(payload.silos) && payload.silos.length > 0) {
      cachedBootstrapPayload = payload;
      demoState = applyPresentationBootstrap(payload, targetMode);
    }
  } catch {
    // Mantém catálogo oficial local caso o servidor ainda esteja reiniciando ou offline (PWA/testes)
  }

  return getPresentationMeta();
}

function parseJsonBody(init?: RequestInit): any {
  if (!init?.body || typeof init.body !== 'string') return {};
  try {
    return JSON.parse(init.body);
  } catch {
    return {};
  }
}

function refreshSiloAlertAndSpace(silo: SiloDetail) {
  const occupancyPercent =
    silo.safeCapacityKg > 0 ? Math.round((silo.confirmedStockKg / silo.safeCapacityKg) * 1000) / 10 : 0;
  silo.occupancyPercent = occupancyPercent;
  silo.availableSpaceKg = Math.max(0, silo.safeCapacityKg - silo.confirmedStockKg);

  const th = demoState.thresholds.find((t) => t.siloId === silo.id || t.siloNumber === silo.siloNumber);
  const globalTh =
    !th && silo.primaryMaterialId
      ? demoState.thresholds.find(
          (t) => !t.siloId && !t.siloNumber && t.materialId === silo.primaryMaterialId
        )
      : undefined;
  const totalMaterialStockKg = globalTh
    ? demoState.silos
        .filter((s) => s.primaryMaterialId === silo.primaryMaterialId)
        .reduce((acc, s) => acc + Number(s.confirmedStockKg || 0), 0)
    : silo.confirmedStockKg;

  const evalRes = evaluateSiloStockStatus({
    confirmedStockKg: silo.confirmedStockKg,
    safeCapacityKg: silo.safeCapacityKg,
    occupancyPercent,
    operationalStatus: silo.operationalStatus,
    primaryMaterialId: silo.primaryMaterialId,
    siloThreshold: th ? { minStockKg: th.minStockKg, warningStockKg: th.warningStockKg } : null,
    globalThreshold: globalTh
      ? {
          minStockKg: globalTh.minStockKg,
          warningStockKg: globalTh.warningStockKg,
          totalMaterialStockKg,
        }
      : null,
  });
  silo.stockAlertLevel = evalRes.stockAlertLevel;
  silo.stockAlertReason = evalRes.stockAlertReason;
  silo.minStockKg = evalRes.minStockKg;
  silo.warningStockKg = evalRes.warningStockKg;
  silo.updatedAt = new Date().toISOString();
}

function pushDemoAudit(action: string, entityType: string, entityId: string, reason: string, newValue: unknown) {
  demoState.auditEvents.unshift({
    id: ++nextSeqId,
    userId: demoState.session.user.id,
    userEmail: demoState.session.user.email,
    userName: demoState.session.user.displayName,
    userRole: demoState.session.user.roleCode,
    action,
    entityType,
    entityId,
    previousValue: null,
    newValue: JSON.stringify(newValue),
    reason: `[SANDBOX DEMO] ${reason}`,
    origin: 'MODO_APRESENTACAO_DEMO',
    createdAt: new Date().toISOString(),
  });
}

function buildDemoLotHistory(lotCode: string): LotHistoryResponse {
  const normalized = lotCode.trim().toUpperCase();
  const matchingReceipts = demoState.receipts.filter((r) => r.lotCode.toUpperCase() === normalized);
  const matchingMovements = demoState.movements.filter(
    (m) => (m.lotCode || '').toUpperCase() === normalized
  );
  const silosMap = new Map<number, { netKg: number; lastAt: string }>();
  for (const m of matchingMovements) {
    if (!m.siloNumber || m.status !== 'CONFIRMADO') continue;
    const prev = silosMap.get(m.siloNumber) || { netKg: 0, lastAt: m.createdAt };
    prev.netKg += m.direction === 'CREDIT' ? m.quantityKg : -m.quantityKg;
    if (m.createdAt > prev.lastAt) prev.lastAt = m.createdAt;
    silosMap.set(m.siloNumber, prev);
  }

  return {
    lotCode: normalized,
    hasMovements: matchingMovements.length > 0 || matchingReceipts.length > 0,
    totalOriginalKg: matchingReceipts.reduce((a, r) => a + r.receivedQuantityKg, 0),
    totalDistributedKg: matchingReceipts.reduce((a, r) => a + r.distributedQuantityKg, 0),
    totalRemainingKg: matchingReceipts.reduce((a, r) => a + r.remainingQuantityKg, 0),
    receipts: matchingReceipts.map((r) => ({
      id: r.id,
      receiptNumber: r.receiptNumber,
      materialId: r.materialId,
      materialCode: r.materialCode,
      materialDescription: r.materialDescription,
      supplierName: r.supplierName,
      invoiceNumber: r.invoiceNumber,
      lotCode: r.lotCode,
      entryDate: r.entryDate,
      receivedQuantityKg: r.receivedQuantityKg,
      distributedQuantityKg: r.distributedQuantityKg,
      remainingQuantityKg: r.remainingQuantityKg,
      receivingType: r.receivingType,
      status: r.status,
      version: r.version,
      createdAt: r.createdAt,
    })),
    silosUsed: Array.from(silosMap.entries()).map(([siloNumber, info]) => ({
      siloNumber,
      netKg: Math.max(0, info.netKg),
      lastAt: info.lastAt,
    })),
    movements: matchingMovements.map((m) => ({
      id: m.id,
      movementType: m.movementType,
      siloId: m.siloId,
      siloNumber: m.siloNumber || 0,
      materialCode: m.materialCode,
      materialDescription: m.materialDescription,
      quantityKg: m.quantityKg,
      direction: m.direction,
      status: m.status,
      shiftCode: m.shiftCode,
      operationalDate: m.operationalDate,
      operatorName: m.operatorName,
      createdAt: m.createdAt,
    })),
  };
}

export async function handleDemoApiFetch<T>(rawPath: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const [pathname, queryStr = ''] = rawPath.split('?');
  const params = new URLSearchParams(queryStr);
  const body = parseJsonBody(init);

  // Metadados de Apresentação
  if (method === 'GET' && pathname === '/api/presentation/meta') {
    return getPresentationMeta() as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/presentation/mode') {
    const mode: PresentationViewMode =
      body.viewMode === 'BANCO_AO_VIVO' ? 'BANCO_AO_VIVO' : 'CENARIO_REALISTA';
    switchPresentationViewMode(mode);
    return getPresentationMeta() as unknown as T;
  }

  // Dashboard & Silos
  if (method === 'GET' && pathname === '/api/dashboard') {
    return buildDemoDashboard(demoState) as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/silos') {
    return demoState.silos as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/silos/volume-history-24h') {
    const siloIdParam = params.get('siloId');
    const materialIdParam = params.get('materialId');
    const categoryParam = params.get('category') || 'ALL';
    return buildDemoSiloVolumeHistory24h(demoState, {
      siloId: siloIdParam ? Number(siloIdParam) : null,
      materialId: materialIdParam ? Number(materialIdParam) : null,
      category: categoryParam,
    }) as unknown as T;
  }
  const ledgerMatch = /^\/api\/silos\/(\d+)\/ledger$/.exec(pathname);
  if (method === 'GET' && ledgerMatch) {
    return buildDemoSiloLedger(demoState, Number(ledgerMatch[1])) as unknown as T;
  }
  const siloCompatMatch = /^\/api\/silos\/(\d+)\/compatibility$/.exec(pathname);
  if (method === 'POST' && siloCompatMatch) {
    const id = Number(siloCompatMatch[1]);
    const target = demoState.silos.find((s) => s.id === id);
    if (!target) throw new Error('Silo demonstrativo não encontrado.');
    const mat = demoState.materials.find((m) => m.id === Number(body.materialId));
    if (mat) {
      const existing = target.compatibilities.find((c) => c.materialId === mat.id);
      if (existing) {
        existing.allowReceiving = body.allowReceiving ?? existing.allowReceiving;
        existing.allowTransferIn = body.allowTransferIn ?? body.allowTransfer ?? existing.allowTransferIn;
        existing.allowTransferOut = body.allowTransferOut ?? existing.allowTransferOut;
        existing.validationStatus = body.validationStatus ?? existing.validationStatus;
      } else {
        target.compatibilities.push({
          id: ++nextSeqId,
          siloId: target.id,
          materialId: mat.id,
          materialCode: mat.code,
          materialDescription: mat.description,
          isPrimary: false,
          allowReceiving: body.allowReceiving ?? true,
          allowTransferIn: body.allowTransferIn ?? body.allowTransfer ?? true,
          allowTransferOut: body.allowTransferOut ?? false,
          validationStatus: body.validationStatus || 'VALIDADO',
        });
      }
      pushDemoAudit('SILO_COMPATIBILITY_DEMO', 'SILO', `Silo ${target.siloNumber}`, body.reason || 'Compatibilidade atualizada em sandbox', body);
    }
    return target as unknown as T;
  }
  const siloPatchMatch = /^\/api\/silos\/(\d+)$/.exec(pathname);
  if (method === 'PATCH' && siloPatchMatch) {
    const id = Number(siloPatchMatch[1]);
    const target = demoState.silos.find((s) => s.id === id);
    if (!target) throw new Error('Silo demonstrativo não encontrado.');
    if (body.operationalStatus) target.operationalStatus = body.operationalStatus;
    if (body.cleaningStatus) target.cleaningStatus = body.cleaningStatus;
    if (body.validationStatus) target.validationStatus = body.validationStatus;
    if (body.restrictions !== undefined) target.restrictions = body.restrictions;
    if (body.nominalCapacityKg) {
      target.nominalCapacityKg = Number(body.nominalCapacityKg);
      target.safeCapacityKg = Math.round(target.nominalCapacityKg * 0.9);
    }
    if (body.primaryMaterialId) {
      const m = demoState.materials.find((mat) => mat.id === Number(body.primaryMaterialId));
      if (m) {
        target.primaryMaterialId = m.id;
        target.materialCode = m.code;
        target.materialDescription = m.description;
        target.materialCategory = m.category;
        target.materialHandlingType = m.handlingType;
      }
    }
    refreshSiloAlertAndSpace(target);
    recomputeDemoDerivedState(demoState);
    pushDemoAudit('SILO_UPDATED_DEMO', 'SILO', `Silo ${target.siloNumber}`, body.reason || 'Atualização em apresentação', body);
    return target as unknown as T;
  }

  // Materials, Suppliers, Bags, Compatibilities
  if (method === 'GET' && pathname === '/api/materials') {
    return demoState.materials as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/materials') {
    const created = {
      id: ++nextSeqId,
      code: String(body.code || `DEMO-${nextSeqId}`),
      description: String(body.description || 'Material Demonstrativo'),
      category: String(body.category || 'MINERAL'),
      handlingType: body.handlingType || 'GRANEL',
      referenceBagWeightKg: body.referenceBagWeightKg ? String(body.referenceBagWeightKg) : null,
      bagWeightValidationStatus: body.bagWeightValidationStatus || 'PENDENTE_VALIDACAO',
      isCritical: Boolean(body.isCritical),
      notes: body.notes || '[SANDBOX DEMO]',
      isActive: true,
    };
    demoState.materials.push(created);
    return created as unknown as T;
  }
  const matPatchMatch = /^\/api\/materials\/(\d+)$/.exec(pathname);
  if (method === 'PATCH' && matPatchMatch) {
    const mat = demoState.materials.find((m) => m.id === Number(matPatchMatch[1]));
    if (!mat) throw new Error('Matéria-prima demonstrativa não encontrada.');
    if (body.code) mat.code = String(body.code);
    if (body.description) mat.description = String(body.description);
    if (body.category) mat.category = String(body.category);
    if (body.handlingType) mat.handlingType = body.handlingType;
    if (body.referenceBagWeightKg !== undefined) {
      mat.referenceBagWeightKg = body.referenceBagWeightKg ? String(body.referenceBagWeightKg) : null;
    }
    if (body.bagWeightValidationStatus) mat.bagWeightValidationStatus = body.bagWeightValidationStatus;
    if (typeof body.isCritical === 'boolean') mat.isCritical = body.isCritical;
    if (typeof body.isActive === 'boolean') mat.isActive = body.isActive;
    if (body.notes !== undefined) mat.notes = body.notes;
    for (const s of demoState.silos) {
      if (s.primaryMaterialId === mat.id) {
        s.materialCode = mat.code;
        s.materialDescription = mat.description;
        s.materialCategory = mat.category;
        s.materialHandlingType = mat.handlingType;
      }
    }
    recomputeDemoDerivedState(demoState);
    return mat as unknown as T;
  }

  const compatSilosMatch = /^\/api\/materials\/(\d+)\/compatible-silos$/.exec(pathname);
  if (method === 'GET' && compatSilosMatch) {
    const matId = Number(compatSilosMatch[1]);
    const list: CompatibleSiloOption[] = demoState.silos
      .filter(
        (s) =>
          s.primaryMaterialId === matId ||
          s.compatibilities.some((c) => c.materialId === matId && c.allowReceiving)
      )
      .map((s) => ({
        id: s.id,
        siloNumber: s.siloNumber,
        category: s.category,
        lineCode: s.lineCode,
        lineName: s.lineName,
        operationalStatus: s.operationalStatus,
        cleaningStatus: s.cleaningStatus,
        validationStatus: s.validationStatus,
        restrictions: s.restrictions,
        nominalCapacityKg: s.nominalCapacityKg,
        safeCapacityKg: s.safeCapacityKg,
        confirmedStockKg: s.confirmedStockKg,
        availableSpaceKg: s.availableSpaceKg,
        isCompatible: s.operationalStatus === 'OPERACIONAL',
      }));
    return list as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/suppliers') {
    return demoState.suppliers as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/bag-configs') {
    return demoState.bagConfigs as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/bag-configs') {
    const existing = body.id ? demoState.bagConfigs.find((b) => b.id === Number(body.id)) : null;
    if (existing) {
      existing.packagingLabel = String(body.packagingLabel || existing.packagingLabel);
      existing.unitWeightKg = Number(body.unitWeightKg || existing.unitWeightKg);
      existing.validationStatus = body.validationStatus || 'VALIDADO';
      existing.isDefault = typeof body.isDefault === 'boolean' ? body.isDefault : existing.isDefault;
      existing.notes = body.reason || existing.notes;
      existing.updatedAt = new Date().toISOString();
      return existing as unknown as T;
    }
    const mat = demoState.materials.find((m) => m.id === Number(body.materialId));
    const item = {
      id: ++nextSeqId,
      materialId: Number(body.materialId || 1),
      materialCode: mat?.code || 'DEMO',
      materialDescription: mat?.description || 'Material Demo',
      packagingLabel: String(body.packagingLabel || 'Big Bag Demo'),
      unitWeightKg: Number(body.unitWeightKg || 1000),
      validationStatus: body.validationStatus || 'PENDENTE_VALIDACAO',
      isDefault: Boolean(body.isDefault),
      notes: body.reason || '[SANDBOX DEMO]',
      updatedAt: new Date().toISOString(),
    };
    demoState.bagConfigs.push(item);
    return item as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/transfer-rules') {
    return demoState.transferRules as unknown as T;
  }
  const rulePatchMatch = /^\/api\/transfer-rules\/(\d+)$/.exec(pathname);
  if (method === 'PATCH' && rulePatchMatch) {
    const rule = demoState.transferRules.find((r) => r.id === Number(rulePatchMatch[1]));
    if (!rule) throw new Error('Regra não encontrada.');
    if (typeof body.isActive === 'boolean') rule.isActive = body.isActive;
    if (body.validationStatus) rule.validationStatus = body.validationStatus;
    const matchedRoute = demoState.routes.find((rt) => rt.id === rule.id);
    if (matchedRoute) {
      matchedRoute.isActive = rule.isActive;
      matchedRoute.authorizationStatus = rule.isActive ? 'AUTORIZADA' : 'PENDENTE_VALIDACAO';
    }
    recomputeDemoDerivedState(demoState);
    return rule as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/pendencies') {
    return demoState.pendencies as unknown as T;
  }
  const pendResolveMatch = /^\/api\/pendencies\/(\d+)\/resolve$/.exec(pathname);
  if (method === 'POST' && pendResolveMatch) {
    const p = demoState.pendencies.find((item) => item.id === Number(pendResolveMatch[1]));
    if (!p) throw new Error('Pendência não encontrada.');
    p.status = 'RESOLVIDO';
    p.resolutionNotes = `[SANDBOX DEMO] ${body.resolutionNotes || 'Validado na apresentação'}`;
    p.resolvedAt = new Date().toISOString();
    return p as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/help') {
    return demoState.helpArticles as unknown as T;
  }

  // Receipts, Lots & Labels
  if (method === 'GET' && pathname === '/api/receipts') {
    return demoState.receipts as unknown as T;
  }
  const lotHistMatch = /^\/api\/lots\/([^/]+)\/history$/.exec(pathname);
  if (method === 'GET' && lotHistMatch) {
    return buildDemoLotHistory(decodeURIComponent(lotHistMatch[1])) as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/receipts') {
    const mat = demoState.materials.find((m) => m.id === Number(body.materialId)) || demoState.materials[0];
    const sup = demoState.suppliers.find((s) => s.id === Number(body.supplierId));
    const bagCountNum = body.bagCount ? Number(body.bagCount) : null;
    const bagUnitKgNum = body.bagUnitWeightKg ? Number(body.bagUnitWeightKg) : null;
    const totalKg =
      Number(body.receivedQuantityKg || 0) ||
      (bagCountNum && bagUnitKgNum ? bagCountNum * bagUnitKgNum : 0);
    const distributionsInput: Array<{ siloId: number; quantityKg: number; bagCount?: number | null; notes?: string }> =
      Array.isArray(body.distributions) ? body.distributions : [];

    const recId = ++nextSeqId;
    const recNum = `REC-DEMO-SIM-${recId}`;
    const dists = distributionsInput.map((d) => {
      const silo = demoState.silos.find((s) => s.id === Number(d.siloId));
      const qty = Number(d.quantityKg || 0);
      if (silo && qty > 0) {
        silo.confirmedStockKg += qty;
        silo.lastMovementAt = new Date().toISOString();
        refreshSiloAlertAndSpace(silo);
      }
      const movId = ++nextSeqId;
      demoState.movements.unshift({
        id: movId,
        movementType: 'RECEBIMENTO',
        siloId: d.siloId,
        siloNumber: silo?.siloNumber ?? null,
        counterpartSiloId: null,
        counterpartSiloNumber: null,
        materialId: mat.id,
        materialCode: mat.code,
        materialDescription: mat.description,
        lotCode: String(body.lotCode || 'DEMO-LOTE'),
        quantityKg: qty,
        unit: 'KG',
        direction: 'CREDIT',
        referenceDocument: recNum,
        receiptId: recId,
        supplierName: sup?.name || String(body.supplierName || 'Fornecedor [DEMO]'),
        status: 'CONFIRMADO',
        reason: '[SANDBOX DEMO] Recebimento simulado em sandbox (sem escrita no PostgreSQL)',
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        operatorName: demoState.session.user.displayName,
        operatorBadge: demoState.session.user.badgeCode || null,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        createdAt: new Date().toISOString(),
      });
      return {
        id: ++nextSeqId,
        receiptId: recId,
        siloId: d.siloId,
        siloNumber: silo?.siloNumber || 0,
        quantityKg: qty,
        bagCount: d.bagCount ?? null,
        movementId: movId,
        status: 'CONFIRMADA',
        isComplement: false,
        operatorName: demoState.session.user.displayName,
        operatorBadge: demoState.session.user.badgeCode || null,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        notes: d.notes || '[SANDBOX DEMO]',
        createdAt: new Date().toISOString(),
      };
    });

    const attValidation = validateReceiptAttachments(body.attachments);
    if (!attValidation.valid) {
      throw new Error(attValidation.error);
    }

    const distKg = dists.reduce((a, d) => a + d.quantityKg, 0);
    const remKg = Math.max(0, totalKg - distKg);
    const status: ReceiptItem['status'] =
      distKg <= 0 ? 'PENDENTE' : remKg > 0 ? 'PARCIAL' : 'CONCLUIDO';

    const createdReceipt: ReceiptItem = {
      id: recId,
      receiptNumber: recNum,
      materialId: mat.id,
      materialCode: mat.code,
      materialDescription: mat.description,
      supplierId: sup?.id ?? null,
      supplierName: sup?.name || String(body.supplierName || 'Fornecedor [DEMO]'),
      invoiceNumber: body.invoiceNumber || null,
      lotCode: String(body.lotCode || `LOTE-SIM-${recId}`),
      entryDate: body.entryDate || demoState.session.shift.operationalDate,
      receivedQuantityKg: totalKg,
      distributedQuantityKg: distKg,
      remainingQuantityKg: remKg,
      unit: 'KG',
      receivingType: body.receivingType || 'GRANEL',
      bagCount: bagCountNum,
      bagUnitWeightKg: bagUnitKgNum,
      receivingPoint: body.receivingPoint || 'Moega Demo',
      vehiclePlate: body.vehiclePlate || null,
      driverName: body.driverName || null,
      carrierName: body.carrierName || null,
      status,
      operatorUserId: demoState.session.user.id,
      operatorName: demoState.session.user.displayName,
      operatorBadge: demoState.session.user.badgeCode || null,
      executedByName: body.executedByName || null,
      executedByBadge: body.executedByBadge || null,
      shiftCode: demoState.session.shift.shiftCode,
      operationalDate: demoState.session.shift.operationalDate,
      startedShiftCode: demoState.session.shift.shiftCode,
      startedOperationalDate: demoState.session.shift.operationalDate,
      finishedShiftCode: status === 'CONCLUIDO' ? demoState.session.shift.shiftCode : null,
      finishedOperationalDate: status === 'CONCLUIDO' ? demoState.session.shift.operationalDate : null,
      startedAt: new Date().toISOString(),
      finishedAt: status === 'CONCLUIDO' ? new Date().toISOString() : null,
      notes: `[SANDBOX DEMO] ${body.notes || ''}`.trim(),
      attachments: attValidation.items,
      version: 1,
      createdAt: new Date().toISOString(),
      distributions: dists,
    };
    demoState.receipts.unshift(createdReceipt);
    recomputeDemoDerivedState(demoState);
    pushDemoAudit('RECEIPT_SIMULATED_DEMO', 'RECEIPT', recNum, 'Recebimento simulado em modo apresentação', { totalKg, distKg });

    return {
      receipt: createdReceipt,
      warnings: [
        'MODO APRESENTAÇÃO: Recebimento simulado apenas na memória local. Nenhuma movimentação real foi gravada no PostgreSQL.',
      ],
    } as unknown as T;
  }

  const distReceiptMatch = /^\/api\/receipts\/(\d+)\/(?:distribute|distributions)$/.exec(pathname);
  if (method === 'POST' && distReceiptMatch) {
    const rec = demoState.receipts.find((r) => r.id === Number(distReceiptMatch[1]));
    if (!rec) throw new Error('Recebimento demonstrativo não encontrado.');
    const incoming: Array<{ siloId: number; quantityKg: number; bagCount?: number | null; notes?: string }> =
      Array.isArray(body.distributions) ? body.distributions : [];
    for (const d of incoming) {
      const silo = demoState.silos.find((s) => s.id === Number(d.siloId));
      const qty = Number(d.quantityKg || 0);
      if (silo && qty > 0) {
        silo.confirmedStockKg += qty;
        silo.isReceiving = false;
        silo.lastMovementAt = new Date().toISOString();
        refreshSiloAlertAndSpace(silo);
      }
      const movId = ++nextSeqId;
      demoState.movements.unshift({
        id: movId,
        movementType: 'RECEBIMENTO',
        siloId: d.siloId,
        siloNumber: silo?.siloNumber ?? null,
        counterpartSiloId: null,
        counterpartSiloNumber: null,
        materialId: rec.materialId,
        materialCode: rec.materialCode,
        materialDescription: rec.materialDescription,
        lotCode: rec.lotCode,
        quantityKg: qty,
        unit: 'KG',
        direction: 'CREDIT',
        referenceDocument: rec.receiptNumber,
        receiptId: rec.id,
        supplierName: rec.supplierName,
        status: 'CONFIRMADO',
        reason: '[SANDBOX DEMO] Complemento de descarga simulado na memória',
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        operatorName: demoState.session.user.displayName,
        operatorBadge: demoState.session.user.badgeCode || null,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        createdAt: new Date().toISOString(),
      });
      rec.distributions.push({
        id: ++nextSeqId,
        receiptId: rec.id,
        siloId: d.siloId,
        siloNumber: silo?.siloNumber || 0,
        quantityKg: qty,
        bagCount: d.bagCount ?? null,
        movementId: movId,
        status: 'CONFIRMADA',
        isComplement: true,
        operatorName: demoState.session.user.displayName,
        operatorBadge: demoState.session.user.badgeCode || null,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        notes: d.notes || '[SANDBOX DEMO] Complemento de descarga',
        createdAt: new Date().toISOString(),
      });
      rec.distributedQuantityKg += qty;
      rec.remainingQuantityKg = Math.max(0, rec.receivedQuantityKg - rec.distributedQuantityKg);
      rec.status = rec.remainingQuantityKg === 0 ? 'CONCLUIDO' : 'PARCIAL';
      rec.version += 1;
      if (rec.status === 'CONCLUIDO') {
        if (!rec.finishedAt) rec.finishedAt = new Date().toISOString();
        rec.finishedShiftCode = demoState.session.shift.shiftCode;
        rec.finishedOperationalDate = demoState.session.shift.operationalDate;
      }
    }
    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      const attValidation = validateReceiptAttachments(body.attachments);
      if (!attValidation.valid) {
        throw new Error(attValidation.error);
      }
      const existingAtts: ReceiptAttachmentItem[] = Array.isArray(rec.attachments) ? rec.attachments : [];
      const merged = [...existingAtts];
      for (const att of attValidation.items) {
        if (!merged.some((e) => e.id === att.id)) {
          merged.push(att);
        }
      }
      rec.attachments = merged.slice(0, MAX_RECEIPT_ATTACHMENTS);
    }
    recomputeDemoDerivedState(demoState);
    pushDemoAudit('RECEIPT_COMPLEMENT_DEMO', 'RECEIPT', rec.receiptNumber, 'Complemento simulado em sandbox', { incoming });
    return {
      receipt: rec,
      warnings: ['MODO APRESENTAÇÃO: Complemento simulado apenas em memória local.'],
    } as unknown as T;
  }

  if (method === 'POST' && (pathname === '/api/ai/operational-advice' || pathname === '/api/ai/receiving-advice')) {
    const matLabel = body?.deterministicFacts?.material || 'Matéria-prima';
    const remainingKg = body?.deterministicFacts?.restantePendenteKg;
    return {
      summary: `[SANDBOX DEMO] Conferência inteligente (${matLabel}): verificar espaço livre no silo de destino e compatibilidade cadastrada antes de confirmar a descarga.${
        typeof remainingKg === 'number' && remainingKg > 0
          ? ` Saldo remanescente após rateio: ${remainingKg.toLocaleString('pt-BR')} kg.`
          : ''
      }`,
      alerts: [
        'Análise gerada em Modo Apresentação sem alterar o banco PostgreSQL.',
        'Valide sempre a compatibilidade e a trava de 90% da capacidade nominal.',
      ],
    } as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/labels/parse-barcode') {
    const raw = String(body.rawBarcode || '').trim();
    const parsed = parseOperationalBarcode(
      raw,
      demoState.materials.map((m) => m.code)
    );
    const effectiveLotCode = parsed.lotCode || (/^[A-Z0-9]{6,14}$/i.test(raw) ? raw.toUpperCase() : '');
    const lotHistory = effectiveLotCode ? buildDemoLotHistory(effectiveLotCode) : null;
    let matchedMat = parsed.materialCode
      ? demoState.materials.find((m) => m.code.toUpperCase() === parsed.materialCode!.toUpperCase()) ?? null
      : null;
    if (!matchedMat && lotHistory && lotHistory.receipts.length > 0) {
      const refMatId = lotHistory.receipts[0].materialId;
      matchedMat = demoState.materials.find((m) => m.id === refMatId) ?? null;
    }

    const bagConfigs = matchedMat
      ? demoState.bagConfigs
          .filter((b) => b.materialId === matchedMat!.id)
          .map((b) => ({
            id: b.id,
            packagingLabel: b.packagingLabel,
            unitWeightKg: b.unitWeightKg,
            validationStatus: b.validationStatus,
            isDefault: b.isDefault,
          }))
      : [];

    pushDemoAudit('BARCODE_PARSED_DEMO', 'LABEL_SCAN', parsed.rawBarcode || raw, 'Leitura de código de barras na demonstração', {
      formatMatched: parsed.formatMatched,
      materialCode: matchedMat?.code || parsed.materialCode,
      lotCode: effectiveLotCode || null,
    });

    const res: BarcodeParseResponse = {
      scanId: ++nextSeqId,
      parsed: {
        ...parsed,
        materialCode: matchedMat?.code || parsed.materialCode,
        lotCode: effectiveLotCode || parsed.lotCode,
      },
      matchedMaterial: matchedMat,
      bagConfigs,
      lotHistory,
    };
    return res as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/labels/interpret-photo') {
    const sampleKey = String(body.demoSampleKey || '').toUpperCase();
    const fileNameHint = String(body.fileName || '').toUpperCase();

    let matCode = '2017101021';
    let supHint = 'PINHEIRO';
    let lotCode = '0011647908';
    let weightKg = 38840;
    let bagCount: number | null = null;
    let rawBarcodeText = '22******20171010210011647908';
    let uncertainFields: string[] = [];
    let notes = '[SANDBOX DEMO] Etiqueta interpretada via OCR demonstrativo (lote parcial em andamento).';

    if (sampleKey === 'UREIA_BIGBAG_NOVO' || fileNameHint.includes('UREIA')) {
      matCode = '1620101010';
      supHint = 'MOSAIC';
      lotCode = '0099441102';
      weightKg = 10000;
      bagCount = 10;
      rawBarcodeText = '22******16201010100099441102';
      uncertainFields = ['bagUnitWeightKg'];
      notes = '[SANDBOX DEMO] Foto simulada de Big Bag de Uréia Pecuária (10 unidades × 1.000 kg = 10.000 kg).';
    } else if (sampleKey === 'CAULIM_BIGBAG_EXISTENTE' || fileNameHint.includes('CAULIM')) {
      matCode = '2090121061';
      supHint = 'MASSARI';
      lotCode = '0011606870';
      weightKg = 12000;
      bagCount = 10;
      rawBarcodeText = '22******20901210610011606870';
      uncertainFields = [];
      notes = '[SANDBOX DEMO] Foto simulada RQ-REC-044 (lote já descarregado no Turno 1 para teste de trava de duplicidade).';
    }

    const mat = demoState.materials.find((m) => m.code === matCode) || demoState.materials[0];
    const sup =
      demoState.suppliers.find((s) => s.name.toUpperCase().includes(supHint)) || demoState.suppliers[0];
    const bagConfigs = demoState.bagConfigs
      .filter((b) => b.materialId === mat.id)
      .map((b) => ({
        id: b.id,
        packagingLabel: b.packagingLabel,
        unitWeightKg: b.unitWeightKg,
        validationStatus: b.validationStatus,
        isDefault: b.isDefault,
      }));

    pushDemoAudit('LABEL_PHOTO_INTERPRETED_DEMO', 'LABEL_SCAN', lotCode, 'Interpretação de etiqueta por foto na demonstração', {
      materialCode: mat.code,
      lotCode,
      weightKg,
      bagCount,
    });

    const uploadedDataUrl =
      typeof body.imageBase64 === 'string' && body.imageBase64.startsWith('data:image/')
        ? body.imageBase64
        : null;

    const sourceImageDataUrl =
      uploadedDataUrl ||
      buildSimulatedLabelSvgDataUrl({
        materialCode: mat.code,
        description: mat.description,
        supplierName: sup.name,
        lotCode,
        weightLabel: bagCount
          ? `${bagCount} bags · ${weightKg.toLocaleString('pt-BR')} kg`
          : `${weightKg.toLocaleString('pt-BR')} kg (Granel)`,
        rawBarcodeText,
      });

    const res: GeminiPhotoParseResponse = {
      scanId: ++nextSeqId,
      extraction: {
        materialCode: mat.code,
        description: mat.description,
        supplierName: sup.name,
        lotCode,
        weightKg,
        bagCount,
        establishment: 'MOEGA-01',
        printDate: demoState.session.shift.operationalDate,
        rawBarcodeText,
        uncertainFields,
        notes,
      },
      matchedMaterial: mat,
      matchedSupplier: sup,
      bagConfigs,
      lotHistory: buildDemoLotHistory(lotCode),
      catalogInconsistencies: [],
      sourceImageDataUrl,
    };
    return res as unknown as T;
  }

  // Movements & Transfers
  if (method === 'GET' && pathname === '/api/movements') {
    const siloIdF = params.get('siloId') ? Number(params.get('siloId')) : null;
    const matIdF = params.get('materialId') ? Number(params.get('materialId')) : null;
    const shiftF = params.get('shiftCode') || null;
    const lotF = params.get('lotCode')?.trim().toUpperCase() || null;
    const opDateF = params.get('operationalDate') || null;

    const filtered = demoState.movements.filter((m) => {
      if (siloIdF && m.siloId !== siloIdF && m.counterpartSiloId !== siloIdF) return false;
      if (matIdF && m.materialId !== matIdF) return false;
      if (shiftF && m.shiftCode !== shiftF) return false;
      if (lotF && !(m.lotCode || '').toUpperCase().includes(lotF)) return false;
      if (opDateF && m.operationalDate !== opDateF) return false;
      return true;
    });
    return filtered as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/transfer-orders') {
    return demoState.transferOrders as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/transfer-orders') {
    const origin = demoState.silos.find((s) => s.id === Number(body.originSiloId));
    const dest = demoState.silos.find((s) => s.id === Number(body.destinationSiloId));
    const mat = demoState.materials.find((m) => m.id === Number(body.materialId)) || demoState.materials[0];
    const qty = Number(body.plannedQuantityKg || 0);
    const id = ++nextSeqId;
    const order: TransferOrderItem = {
      id,
      orderCode: `TRF-DEMO-SIM-${id}`,
      transferRuleId: Number(body.transferRuleId || 1),
      originSiloId: origin?.id || Number(body.originSiloId),
      originSiloNumber: origin?.siloNumber ?? null,
      destinationSiloId: dest?.id || Number(body.destinationSiloId),
      destinationSiloNumber: dest?.siloNumber ?? null,
      materialId: mat.id,
      materialCode: mat.code,
      materialDescription: mat.description,
      productionLineId: dest?.productionLineId ?? null,
      lineCode: dest?.lineCode ?? null,
      lineName: dest?.lineName ?? null,
      recommendationId: body.recommendationId ?? null,
      lotCode: body.lotCode || null,
      plannedQuantityKg: qty,
      transferredQuantityKg: 0,
      remainingQuantityKg: qty,
      status: 'PLANEJADA',
      priority: body.priority || 'ALTA',
      requestedByName: demoState.session.user.displayName,
      approvedByName: demoState.session.user.displayName,
      assignedOperatorName: demoState.session.user.displayName,
      interruptedByName: null,
      shiftCode: demoState.session.shift.shiftCode,
      operationalDate: demoState.session.shift.operationalDate,
      startedAt: null,
      finishedAt: null,
      interruptedAt: null,
      interruptionReason: null,
      notes: `[SANDBOX DEMO] ${body.notes || 'Ordem planejada no modo apresentação.'}`,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [],
    };
    demoState.transferOrders.unshift(order);
    recomputeDemoDerivedState(demoState);
    return order as unknown as T;
  }

  const startTrMatch = /^\/api\/transfer-orders\/(\d+)\/start$/.exec(pathname);
  if (method === 'POST' && startTrMatch) {
    const order = demoState.transferOrders.find((o) => o.id === Number(startTrMatch[1]));
    if (!order) throw new Error('Ordem não encontrada.');
    order.status = 'EM_ANDAMENTO';
    order.startedAt = new Date().toISOString();
    order.updatedAt = new Date().toISOString();
    return order as unknown as T;
  }

  const execStepMatch = /^\/api\/transfer-orders\/(\d+)\/execute-step$/.exec(pathname);
  if (method === 'POST' && execStepMatch) {
    const order = demoState.transferOrders.find((o) => o.id === Number(execStepMatch[1]));
    if (!order) throw new Error('Ordem não encontrada.');
    const qty = Math.min(order.remainingQuantityKg, Number(body.quantityKg || order.remainingQuantityKg));
    const origin = demoState.silos.find((s) => s.id === order.originSiloId);
    const dest = demoState.silos.find((s) => s.id === order.destinationSiloId);
    if (origin) {
      origin.confirmedStockKg = Math.max(0, origin.confirmedStockKg - qty);
      origin.lastMovementAt = new Date().toISOString();
      refreshSiloAlertAndSpace(origin);
    }
    if (dest) {
      dest.confirmedStockKg += qty;
      dest.lastMovementAt = new Date().toISOString();
      refreshSiloAlertAndSpace(dest);
    }
    const nowIso = new Date().toISOString();
    demoState.movements.unshift(
      {
        id: ++nextSeqId,
        movementType: 'TRANSFERENCIA_ENTRADA',
        siloId: dest?.id ?? order.destinationSiloId,
        siloNumber: dest?.siloNumber ?? order.destinationSiloNumber,
        counterpartSiloId: origin?.id ?? order.originSiloId,
        counterpartSiloNumber: origin?.siloNumber ?? order.originSiloNumber,
        materialId: order.materialId,
        materialCode: order.materialCode,
        materialDescription: order.materialDescription,
        lotCode: body.lotCode || order.lotCode,
        quantityKg: qty,
        unit: 'KG',
        direction: 'CREDIT',
        referenceDocument: order.orderCode,
        receiptId: null,
        supplierName: null,
        status: 'CONFIRMADO',
        reason: `[SANDBOX DEMO] Entrada ordem ${order.orderCode}`,
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        operatorName: demoState.session.user.displayName,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        createdAt: nowIso,
      },
      {
        id: ++nextSeqId,
        movementType: 'TRANSFERENCIA_SAIDA',
        siloId: origin?.id ?? order.originSiloId,
        siloNumber: origin?.siloNumber ?? order.originSiloNumber,
        counterpartSiloId: dest?.id ?? order.destinationSiloId,
        counterpartSiloNumber: dest?.siloNumber ?? order.destinationSiloNumber,
        materialId: order.materialId,
        materialCode: order.materialCode,
        materialDescription: order.materialDescription,
        lotCode: body.lotCode || order.lotCode,
        quantityKg: qty,
        unit: 'KG',
        direction: 'DEBIT',
        referenceDocument: order.orderCode,
        receiptId: null,
        supplierName: null,
        status: 'CONFIRMADO',
        reason: `[SANDBOX DEMO] Saída ordem ${order.orderCode}`,
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        operatorName: demoState.session.user.displayName,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        createdAt: nowIso,
      }
    );
    order.transferredQuantityKg += qty;
    order.remainingQuantityKg = Math.max(0, order.plannedQuantityKg - order.transferredQuantityKg);
    order.status = order.remainingQuantityKg === 0 ? 'CONCLUIDA' : 'PARCIAL';
    if (order.status === 'CONCLUIDA') order.finishedAt = nowIso;
    order.updatedAt = nowIso;
    recomputeDemoDerivedState(demoState);
    pushDemoAudit('TRANSFER_SIMULATED_DEMO', 'TRANSFER_ORDER', order.orderCode, 'Etapa executada apenas na sandbox demo', { qty });
    return {
      remainingQuantityKg: order.remainingQuantityKg,
      order: { orderCode: order.orderCode, status: order.status },
    } as unknown as T;
  }

  const interruptTrMatch = /^\/api\/transfer-orders\/(\d+)\/interrupt$/.exec(pathname);
  if (method === 'POST' && interruptTrMatch) {
    const order = demoState.transferOrders.find((o) => o.id === Number(interruptTrMatch[1]));
    if (!order) throw new Error('Ordem não encontrada.');
    order.status = 'INTERROMPIDA';
    order.interruptionReason = `[SANDBOX DEMO] ${body.reason || 'Interrupção demonstrativa'}`;
    order.interruptedAt = new Date().toISOString();
    order.updatedAt = new Date().toISOString();
    return order as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/transfers/execute') {
    const origin = demoState.silos.find((s) => s.id === Number(body.originSiloId));
    const dest = demoState.silos.find((s) => s.id === Number(body.destinationSiloId));
    const qty = Number(body.quantityKg || 0);
    const nowIso = new Date().toISOString();
    const ref = `TRF-SIM-${++nextSeqId}`;
    if (origin) {
      origin.confirmedStockKg = Math.max(0, origin.confirmedStockKg - qty);
      origin.lastMovementAt = nowIso;
      refreshSiloAlertAndSpace(origin);
    }
    if (dest) {
      dest.confirmedStockKg += qty;
      dest.lastMovementAt = nowIso;
      refreshSiloAlertAndSpace(dest);
    }
    const mat =
      demoState.materials.find((m) => m.id === Number(body.materialId || origin?.primaryMaterialId || dest?.primaryMaterialId)) ||
      demoState.materials[0];
    demoState.movements.unshift(
      {
        id: ++nextSeqId,
        movementType: 'TRANSFERENCIA_ENTRADA',
        siloId: dest?.id ?? 0,
        siloNumber: dest?.siloNumber ?? null,
        counterpartSiloId: origin?.id ?? null,
        counterpartSiloNumber: origin?.siloNumber ?? null,
        materialId: mat.id,
        materialCode: mat.code,
        materialDescription: mat.description,
        lotCode: body.lotCode || null,
        quantityKg: qty,
        unit: 'KG',
        direction: 'CREDIT',
        referenceDocument: ref,
        receiptId: null,
        supplierName: null,
        status: 'CONFIRMADO',
        reason: `[SANDBOX DEMO] ${body.reason || 'Transferência direta simulada'}`,
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        operatorName: demoState.session.user.displayName,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        createdAt: nowIso,
      },
      {
        id: ++nextSeqId,
        movementType: 'TRANSFERENCIA_SAIDA',
        siloId: origin?.id ?? 0,
        siloNumber: origin?.siloNumber ?? null,
        counterpartSiloId: dest?.id ?? null,
        counterpartSiloNumber: dest?.siloNumber ?? null,
        materialId: mat.id,
        materialCode: mat.code,
        materialDescription: mat.description,
        lotCode: body.lotCode || null,
        quantityKg: qty,
        unit: 'KG',
        direction: 'DEBIT',
        referenceDocument: ref,
        receiptId: null,
        supplierName: null,
        status: 'CONFIRMADO',
        reason: `[SANDBOX DEMO] ${body.reason || 'Transferência direta simulada'}`,
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        operatorName: demoState.session.user.displayName,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        createdAt: nowIso,
      }
    );
    recomputeDemoDerivedState(demoState);
    pushDemoAudit('DIRECT_TRANSFER_DEMO', 'TRANSFER', ref, 'Transferência simulada em sandbox demo', { qty });
    return { referenceDocument: ref } as unknown as T;
  }

  const revMovMatch = /^\/api\/movements\/(\d+)\/reverse$/.exec(pathname);
  if (method === 'POST' && revMovMatch) {
    const mov = demoState.movements.find((m) => m.id === Number(revMovMatch[1]));
    if (mov && mov.status !== 'ESTORNADO') {
      mov.status = 'ESTORNADO';
      const silo = demoState.silos.find((s) => s.id === mov.siloId);
      if (silo) {
        silo.confirmedStockKg =
          mov.direction === 'CREDIT'
            ? Math.max(0, silo.confirmedStockKg - mov.quantityKg)
            : silo.confirmedStockKg + mov.quantityKg;
        refreshSiloAlertAndSpace(silo);
      }
      recomputeDemoDerivedState(demoState);
      pushDemoAudit('MOVEMENT_REVERSED_DEMO', 'MOVEMENT', String(mov.id), body.reason || 'Estorno simulado em sandbox', { movementId: mov.id });
    }
    return { ok: true } as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/stock/adjust') {
    const silo = demoState.silos.find((s) => s.id === Number(body.siloId));
    const deltaKg =
      typeof body.deltaKg === 'number' && !Number.isNaN(body.deltaKg)
        ? Number(body.deltaKg)
        : body.direction === 'DEBIT'
          ? -Math.abs(Number(body.quantityKg || 0))
          : Math.abs(Number(body.quantityKg || 0));
    if (silo && deltaKg !== 0) {
      silo.confirmedStockKg = Math.max(0, silo.confirmedStockKg + deltaKg);
      silo.lastMovementAt = new Date().toISOString();
      refreshSiloAlertAndSpace(silo);
      const mat =
        demoState.materials.find((m) => m.id === Number(body.materialId || silo.primaryMaterialId)) ||
        demoState.materials[0];
      demoState.movements.unshift({
        id: ++nextSeqId,
        movementType: 'AJUSTE_AUTORIZADO',
        siloId: silo.id,
        siloNumber: silo.siloNumber,
        counterpartSiloId: null,
        counterpartSiloNumber: null,
        materialId: mat.id,
        materialCode: mat.code,
        materialDescription: mat.description,
        lotCode: body.lotCode || null,
        quantityKg: Math.abs(deltaKg),
        unit: 'KG',
        direction: deltaKg >= 0 ? 'CREDIT' : 'DEBIT',
        referenceDocument: `AJU-DEMO-${nextSeqId}`,
        receiptId: null,
        supplierName: null,
        status: 'CONFIRMADO',
        reason: `[SANDBOX DEMO] ${body.reason || 'Ajuste autorizado em apresentação'}`,
        shiftCode: demoState.session.shift.shiftCode,
        operationalDate: demoState.session.shift.operationalDate,
        operatorName: demoState.session.user.displayName,
        executedByName: body.executedByName || null,
        executedByBadge: body.executedByBadge || null,
        createdAt: new Date().toISOString(),
      });
      recomputeDemoDerivedState(demoState);
      pushDemoAudit('STOCK_ADJUSTED_DEMO', 'SILO', `Silo ${silo.siloNumber}`, body.reason || 'Ajuste autorizado', { deltaKg });
    }
    return { ok: true } as unknown as T;
  }

  // Schedules, Products, Intelligence & Supply
  if (method === 'GET' && pathname === '/api/lines') {
    return demoState.lines as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/schedule-templates') {
    return demoState.scheduleTemplates as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/products') {
    return demoState.products as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/products') {
    const lineId = body.defaultProductionLineId ? Number(body.defaultProductionLineId) : null;
    const line = lineId ? demoState.lines.find((l) => l.id === lineId) : null;
    const prod: ProductWithFactorsItem = {
      id: ++nextSeqId,
      code: String(body.code || `PROD-DEMO-${nextSeqId}`).toUpperCase(),
      description: String(body.description || 'Produto Demo').toUpperCase(),
      defaultProductionLineId: lineId,
      defaultLineCode: line?.code ?? null,
      defaultUnit: body.defaultUnit || 't',
      isActive: true,
      notes: '[SANDBOX DEMO]',
      factors: [],
    };
    demoState.products.push(prod);
    return prod as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/consumption-factors') {
    const prod = demoState.products.find((p) => p.id === Number(body.productId));
    const mat = demoState.materials.find((m) => m.id === Number(body.materialId));
    if (prod && mat) {
      const existing = prod.factors.find((f) => f.materialId === mat.id && f.unit === (body.unit || 't'));
      if (existing) {
        existing.factorKgPerUnit = Number(body.factorKgPerUnit || existing.factorKgPerUnit);
        existing.validationStatus = body.validationStatus || existing.validationStatus;
        existing.sourceReference = body.sourceReference ?? existing.sourceReference;
        existing.updatedAt = new Date().toISOString();
      } else {
        prod.factors.push({
          id: ++nextSeqId,
          productId: prod.id,
          materialId: mat.id,
          materialCode: mat.code,
          materialDescription: mat.description,
          factorKgPerUnit: Number(body.factorKgPerUnit || 0),
          unit: body.unit || 't',
          validationStatus: body.validationStatus || 'VALIDADO',
          sourceReference: body.sourceReference || '[SANDBOX DEMO]',
          notes: body.notes || null,
          updatedAt: new Date().toISOString(),
        });
      }
      recomputeDemoDerivedState(demoState);
    }
    return { ok: true } as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/stock-thresholds') {
    return demoState.thresholds as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/stock-thresholds') {
    const mat = demoState.materials.find((m) => m.id === Number(body.materialId));
    const silo = body.siloId ? demoState.silos.find((s) => s.id === Number(body.siloId)) : null;
    if (mat) {
      const notesVal =
        typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : '[SANDBOX DEMO]';
      const existing = demoState.thresholds.find(
        (t) => t.materialId === mat.id && (t.siloId ?? null) === (silo?.id ?? null)
      );
      if (existing) {
        existing.minStockKg = Number(body.minStockKg);
        existing.warningStockKg = Number(body.warningStockKg);
        existing.notes = notesVal;
        existing.updatedAt = new Date().toISOString();
      } else {
        demoState.thresholds.push({
          id: ++nextSeqId,
          materialId: mat.id,
          materialCode: mat.code,
          materialDescription: mat.description,
          siloId: silo?.id ?? null,
          siloNumber: silo?.siloNumber ?? null,
          minStockKg: Number(body.minStockKg),
          warningStockKg: Number(body.warningStockKg),
          notes: notesVal,
          updatedAt: new Date().toISOString(),
        });
      }
      if (silo) {
        refreshSiloAlertAndSpace(silo);
      } else {
        for (const affected of demoState.silos) {
          if (affected.primaryMaterialId === mat.id) {
            refreshSiloAlertAndSpace(affected);
          }
        }
      }
      pushDemoAudit(
        'CONFIGURACAO_LIMIAR_ESTOQUE',
        'stock_thresholds',
        `${mat.code}:${silo?.siloNumber ?? 'ALL'}`,
        `Limiar de ${mat.description} atualizado (Crítico: ${body.minStockKg} kg / Baixo: ${body.warningStockKg} kg)`,
        {
          materialId: mat.id,
          siloId: silo?.id ?? null,
          minStockKg: Number(body.minStockKg),
          warningStockKg: Number(body.warningStockKg),
        }
      );
      recomputeDemoDerivedState(demoState);
    }
    return { ok: true } as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/schedules') {
    return demoState.schedules as unknown as T;
  }
  const schedDocMatch = /^\/api\/schedule-documents\/(\d+)$/.exec(pathname);
  if (method === 'GET' && schedDocMatch) {
    const docId = Number(schedDocMatch[1]);
    const doc = demoState.scheduleDocuments[docId];
    if (doc) return doc as unknown as T;
    return {
      fileName: `programacao-demo-${docId}.txt`,
      mimeType: 'text/plain',
      fileContentBase64: null,
      extractedTextPreview: '[SANDBOX DEMO] Documento arquivado da programação demonstrativa.',
    } as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/schedules/parse-document') {
    const docId = ++nextSeqId;
    const mat = demoState.materials[0];
    const parsed: ParsedScheduleDocumentResponse = {
      documentId: docId,
      fileName: String(body.fileName || 'programacao-demo.pdf'),
      mimeType: String(body.mimeType || 'application/pdf'),
      sourceType: 'DEMO_SIMULACAO',
      extractedTextPreview: '[SANDBOX DEMO] Extração demonstrativa de programação.',
      extraction: {
        documentDate: demoState.session.shift.operationalDate,
        productionDate: demoState.session.shift.operationalDate,
        documentCategory: 'PROGRAMACAO',
        documentNotes: '[SANDBOX DEMO] Prévia gerada localmente para demonstração.',
        unreadableOrAmbiguousFields: [],
        items: [
          {
            lineCode: 'L4',
            sequenceOrder: 1,
            productCode: demoState.products[0]?.code || 'PROD-DEMO-01',
            productDescription: demoState.products[0]?.description || 'NÚCLEO MINERAL L4 [DEMO]',
            materialCode: mat.code,
            materialDescription: mat.description,
            plannedQuantity: 35,
            realizedQuantity: 0,
            plannedUnit: 't',
            scheduledTimeWindow: '17:00–02:12',
            confidence: 'ALTA',
            needsReview: false,
            reviewReason: null,
            notes: '[SANDBOX DEMO]',
            productionLineId: 4,
            matchedProductId: demoState.products[0]?.id ?? null,
            matchedMaterialId: mat.id,
            hasValidatedFactor: true,
          },
        ],
      },
      existingRevisionPreview: null,
    };
    demoState.scheduleDocuments[docId] = {
      fileName: parsed.fileName,
      mimeType: parsed.mimeType,
      fileContentBase64: null,
      extractedTextPreview: parsed.extractedTextPreview,
    };
    return parsed as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/schedules/draft') {
    const id = ++nextSeqId;
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const items = rawItems.map((it: any, idx: number) => {
      const line = demoState.lines.find((l) => l.id === Number(it.productionLineId)) || demoState.lines[0];
      const mat =
        demoState.materials.find((m) => m.id === Number(it.materialId)) ||
        demoState.materials.find((m) => m.code === it.materialCode) ||
        null;
      const prod = demoState.products.find((p) => p.id === Number(it.productId)) || null;
      const qty = Number(it.plannedQuantity || 0);
      const factorKg =
        prod?.factors.find((f) => !mat || f.materialId === mat.id)?.factorKgPerUnit ??
        (it.plannedUnit === 't' ? 1000 : 1);
      const calcKg = Math.round(qty * factorKg);
      return {
        id: ++nextSeqId,
        scheduleId: id,
        productionLineId: line.id,
        lineCode: line.code,
        lineName: line.name,
        sequenceOrder: Number(it.sequenceOrder || idx + 1),
        productId: prod?.id ?? null,
        productCode: String(it.productCode || prod?.code || 'PROD-DEMO'),
        productDescription: String(it.productDescription || prod?.description || 'Produto Demo'),
        materialId: mat?.id ?? null,
        materialCode: mat?.code ?? it.materialCode ?? null,
        plannedQuantity: qty,
        realizedQuantity: 0,
        plannedUnit: String(it.plannedUnit || 't'),
        scheduledTimeWindow: it.scheduledTimeWindow || null,
        executionStatus: 'NAO_INICIADA' as const,
        extractionConfidence: it.extractionConfidence || ('ALTA' as const),
        needsReview: Boolean(it.needsReview),
        reviewReason: it.reviewReason || null,
        notes: it.notes || null,
        projections: mat
          ? [
              {
                id: ++nextSeqId,
                materialId: mat.id,
                calculatedConsumptionKg: calcKg,
                realizedConsumptionKg: 0,
                calculationStatus: 'CALCULADO' as const,
                originSource: 'FATOR_PRODUTO',
              },
            ]
          : [],
      };
    });

    const docRef = body.documentId ? demoState.scheduleDocuments[body.documentId] : null;
    const sched: ProductionScheduleView = {
      id,
      scheduleCode: `PROG-DEMO-SIM-${id}`,
      referenceDate: body.referenceDate || demoState.session.shift.operationalDate,
      revisionNumber: demoState.schedules.length + 1,
      previousScheduleId: demoState.schedules[0]?.id ?? null,
      documentId: body.documentId ?? null,
      documentMeta: body.documentId
        ? {
            fileName: docRef?.fileName || 'documento.pdf',
            mimeType: docRef?.mimeType || 'application/pdf',
            sourceType: body.sourceReportType || 'DEMO_SIMULACAO',
            documentCategory: 'PROGRAMACAO',
          }
        : null,
      sourceReportType: body.sourceReportType || 'DEMO_SIMULACAO',
      status: 'RASCUNHO_CONFERENCIA',
      revisionDiffSummary: '[SANDBOX DEMO] Rascunho criado em memória local.',
      notes: body.notes || '[SANDBOX DEMO]',
      importedByName: demoState.session.user.displayName,
      approvedByName: null,
      approvedAt: null,
      createdAt: new Date().toISOString(),
      items,
    };
    demoState.schedules.unshift(sched);
    return { id: sched.id, scheduleCode: sched.scheduleCode } as unknown as T;
  }
  const appSchedMatch = /^\/api\/schedules\/(\d+)\/approve$/.exec(pathname);
  if (method === 'POST' && appSchedMatch) {
    const sched = demoState.schedules.find((s) => s.id === Number(appSchedMatch[1]));
    if (sched) {
      for (const other of demoState.schedules) {
        if (other.id !== sched.id && other.referenceDate === sched.referenceDate && other.status === 'APROVADA') {
          other.status = 'SUPERSEDED';
        }
      }
      sched.status = 'APROVADA';
      sched.approvedByName = demoState.session.user.displayName;
      sched.approvedAt = new Date().toISOString();
      recomputeDemoDerivedState(demoState);
      return {
        schedule: {
          scheduleCode: sched.scheduleCode,
          revisionNumber: sched.revisionNumber,
        },
        diff: {
          alertTitle: sched.revisionDiffSummary || null,
          summaryText: `Programação ${sched.scheduleCode} aprovada na sandbox demonstrativa.`,
        },
      } as unknown as T;
    }
    return {
      schedule: { scheduleCode: 'PROG-DEMO', revisionNumber: 1 },
      diff: { alertTitle: null, summaryText: 'Aprovada em sandbox.' },
    } as unknown as T;
  }
  const execItemMatch = /^\/api\/schedule-items\/(\d+)\/execution$/.exec(pathname);
  if (method === 'PATCH' && execItemMatch) {
    const itemId = Number(execItemMatch[1]);
    for (const sched of demoState.schedules) {
      const it = sched.items.find((i) => i.id === itemId);
      if (it) {
        if (body.executionStatus) it.executionStatus = body.executionStatus;
        if (body.realizedQuantity !== undefined) {
          it.realizedQuantity = Number(body.realizedQuantity || 0);
          const ratio = it.plannedQuantity > 0 ? it.realizedQuantity / it.plannedQuantity : 0;
          for (const p of it.projections) {
            p.realizedConsumptionKg = Math.round(p.calculatedConsumptionKg * ratio);
          }
        }
        recomputeDemoDerivedState(demoState);
        pushDemoAudit('SCHEDULE_EXECUTION_DEMO', 'SCHEDULE_ITEM', String(itemId), body.reason || 'Apontamento simulado', body);
        break;
      }
    }
    return { ok: true } as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/intelligence/summary') {
    const lineFilter = params.get('lineCode') || '';
    const matIdFilter = params.get('materialId') ? Number(params.get('materialId')) : null;
    const siloIdFilter = params.get('siloId') ? Number(params.get('siloId')) : null;
    const execStatusFilter = params.get('executionStatus') || '';
    const priorityFilter = params.get('priority') || '';

    const hasAnyFilter = Boolean(
      lineFilter || matIdFilter || siloIdFilter || execStatusFilter || priorityFilter
    );
    if (!hasAnyFilter) {
      return demoState.intelligenceSummary as unknown as T;
    }

    const selectedSilo = siloIdFilter
      ? demoState.silos.find((s) => s.id === siloIdFilter) ?? null
      : null;
    const matCodeFilter = matIdFilter
      ? demoState.materials.find((m) => m.id === matIdFilter)?.code ?? null
      : null;

    const approvedItems = demoState.schedules
      .filter((sc) => sc.status === 'APROVADA')
      .flatMap((sc) => sc.items);

    const lineMaterialIds = lineFilter
      ? new Set([
          ...demoState.silos
            .filter((s) => s.lineCode === lineFilter && s.primaryMaterialId)
            .map((s) => s.primaryMaterialId!),
          ...approvedItems
            .filter((it) => it.lineCode === lineFilter)
            .flatMap((it) => it.projections.map((p) => p.materialId))
            .filter((id): id is number => id !== null),
        ])
      : null;

    const execStatusMaterialIds = execStatusFilter
      ? new Set(
          approvedItems
            .filter((it) => it.executionStatus === execStatusFilter)
            .flatMap((it) => it.projections.map((p) => p.materialId))
            .filter((id): id is number => id !== null)
        )
      : null;

    const filteredByMaterial = demoState.intelligenceSummary.byMaterial.filter((m) => {
      if (matIdFilter && m.materialId !== matIdFilter) return false;
      if (selectedSilo && selectedSilo.primaryMaterialId !== m.materialId) return false;
      if (lineMaterialIds && !lineMaterialIds.has(m.materialId)) return false;
      if (execStatusMaterialIds && !execStatusMaterialIds.has(m.materialId)) return false;
      if (priorityFilter && m.statusPriority !== priorityFilter) return false;
      return true;
    });

    const filteredAlerts = demoState.intelligenceSummary.alerts.filter((al) => {
      if (priorityFilter && al.priority !== priorityFilter) return false;
      if (lineFilter && al.lineCode && al.lineCode !== lineFilter) return false;
      if (matCodeFilter && al.materialCode && al.materialCode !== matCodeFilter) return false;
      if (selectedSilo && al.siloNumber && al.siloNumber !== selectedSilo.siloNumber) return false;
      if (execStatusMaterialIds) {
        const alMat = demoState.materials.find((x) => x.code === al.materialCode);
        if (alMat && !execStatusMaterialIds.has(alMat.id)) return false;
      }
      return true;
    });

    const filteredRecs = demoState.intelligenceSummary.recommendations.filter((rec) => {
      if (priorityFilter && rec.priority !== priorityFilter) return false;
      if (lineFilter && rec.lineCode && rec.lineCode !== lineFilter) return false;
      if (matIdFilter && rec.materialId && rec.materialId !== matIdFilter) return false;
      if (siloIdFilter && rec.targetSiloId !== siloIdFilter && rec.originSiloId !== siloIdFilter) {
        return false;
      }
      if (execStatusMaterialIds && rec.materialId && !execStatusMaterialIds.has(rec.materialId)) {
        return false;
      }
      return true;
    });

    return {
      ...demoState.intelligenceSummary,
      byMaterial: filteredByMaterial,
      alerts: filteredAlerts,
      recommendations: filteredRecs,
    } as unknown as T;
  }
  const recDecMatch = /^\/api\/intelligence\/recommendations\/(\d+)\/decision$/.exec(pathname);
  if (method === 'POST' && recDecMatch) {
    const rec = demoState.intelligenceSummary.recommendations.find((r) => r.id === Number(recDecMatch[1]));
    if (rec) {
      rec.decisionStatus = body.decision || body.decisionStatus || 'ACEITA';
      rec.decisionNotes = body.decisionNotes || '[SANDBOX DEMO] Decisão registrada na demonstração.';
      rec.decidedAt = new Date().toISOString();
    }
    return { ok: true } as unknown as T;
  }

  // Supply & Routes
  if (method === 'GET' && pathname === '/api/supply/board') {
    return demoState.supplyBoard as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/routes') {
    return demoState.routes as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/routes') {
    const origin = demoState.silos.find((s) => s.id === Number(body.originSiloId));
    const dest = demoState.silos.find((s) => s.id === Number(body.destinationSiloId));
    const mat = demoState.materials.find((m) => m.id === Number(body.materialId));
    const authStatus = (body.authorizationStatus || 'PENDENTE_VALIDACAO') as AuthorizedRouteItem['authorizationStatus'];
    const id = ++nextSeqId;
    const nowIso = new Date().toISOString();
    const createdRoute: AuthorizedRouteItem = {
      id,
      originSiloId: origin?.id || Number(body.originSiloId),
      originSiloNumber: origin?.siloNumber || 0,
      destinationSiloId: dest?.id || Number(body.destinationSiloId),
      destinationSiloNumber: dest?.siloNumber || 0,
      materialId: mat?.id || Number(body.materialId),
      materialCode: mat?.code || 'DEMO',
      materialDescription: mat?.description || 'Material Demo',
      relatedLineId: dest?.productionLineId || null,
      relatedLineCode: dest?.lineCode || null,
      relatedLineName: dest?.lineName || null,
      operationType: 'TRANSFERENCIA',
      maxQuantityKg: body.maxQuantityKg ? Number(body.maxQuantityKg) : null,
      requiresAuthorization: true,
      authorizationStatus: authStatus,
      validationStatus: authStatus === 'AUTORIZADA' ? 'VALIDADO' : 'PENDENTE_VALIDACAO',
      isActive: authStatus === 'AUTORIZADA',
      restrictions: body.restrictions || null,
      sourceReference: body.reason || '[SANDBOX DEMO]',
      approvedByName: authStatus === 'AUTORIZADA' ? demoState.session.user.displayName : null,
      approvedAt: authStatus === 'AUTORIZADA' ? nowIso : null,
      updatedByName: demoState.session.user.displayName,
      updatedAt: nowIso,
      createdAt: nowIso,
      history: [
        {
          id: ++nextSeqId,
          userId: demoState.session.user.id,
          userEmail: demoState.session.user.email,
          userName: demoState.session.user.displayName,
          userRole: demoState.session.user.roleCode,
          action: 'ROUTE_CREATED_DEMO',
          entityType: 'TRANSFER_RULE',
          entityId: String(id),
          previousValue: null,
          newValue: JSON.stringify({ authorizationStatus: authStatus }),
          reason: body.reason || '[SANDBOX DEMO] Rota criada em demonstração',
          origin: 'MODO_APRESENTACAO_DEMO',
          createdAt: nowIso,
        },
      ],
    };
    demoState.routes.push(createdRoute);
    demoState.transferRules.push({
      id,
      originSiloId: createdRoute.originSiloId,
      originSiloNumber: createdRoute.originSiloNumber,
      destinationSiloId: createdRoute.destinationSiloId,
      destinationSiloNumber: createdRoute.destinationSiloNumber,
      materialId: createdRoute.materialId,
      materialCode: createdRoute.materialCode,
      materialDescription: createdRoute.materialDescription,
      operationType: 'TRANSFERENCIA',
      maxQuantityKg: createdRoute.maxQuantityKg !== null ? String(createdRoute.maxQuantityKg) : null,
      requiresAuthorization: true,
      authorizationStatus: authStatus,
      validationStatus: authStatus === 'AUTORIZADA' ? 'VALIDADO' : 'PENDENTE_VALIDACAO',
      isActive: createdRoute.isActive,
      restrictions: createdRoute.restrictions,
      sourceReference: createdRoute.sourceReference,
    });
    recomputeDemoDerivedState(demoState);
    return createdRoute as unknown as T;
  }
  const routeStatusMatch = /^\/api\/routes\/(\d+)\/status$/.exec(pathname);
  if (method === 'PATCH' && routeStatusMatch) {
    const r = demoState.routes.find((item) => item.id === Number(routeStatusMatch[1]));
    if (r && body.authorizationStatus) {
      const prev = r.authorizationStatus;
      const nowIso = new Date().toISOString();
      r.authorizationStatus = body.authorizationStatus;
      r.isActive = body.authorizationStatus === 'AUTORIZADA';
      r.validationStatus = r.isActive ? 'VALIDADO' : 'PENDENTE_VALIDACAO';
      if (body.maxQuantityKg !== undefined) r.maxQuantityKg = body.maxQuantityKg ? Number(body.maxQuantityKg) : null;
      if (body.restrictions !== undefined) r.restrictions = body.restrictions;
      r.updatedByName = demoState.session.user.displayName;
      r.updatedAt = nowIso;
      r.history.unshift({
        id: ++nextSeqId,
        userId: demoState.session.user.id,
        userEmail: demoState.session.user.email,
        userName: demoState.session.user.displayName,
        userRole: demoState.session.user.roleCode,
        action: 'ROUTE_STATUS_UPDATED_DEMO',
        entityType: 'TRANSFER_RULE',
        entityId: String(r.id),
        previousValue: JSON.stringify({ authorizationStatus: prev }),
        newValue: JSON.stringify({ authorizationStatus: r.authorizationStatus }),
        reason: body.reason || 'Atualização em modo apresentação',
        origin: 'MODO_APRESENTACAO_DEMO',
        createdAt: nowIso,
      });
      const tr = demoState.transferRules.find((rule) => rule.id === r.id);
      if (tr) {
        tr.isActive = r.isActive;
        tr.authorizationStatus = r.authorizationStatus;
        tr.validationStatus = r.isActive ? 'VALIDADO' : 'PENDENTE_VALIDACAO';
      }
      recomputeDemoDerivedState(demoState);
    }
    return r as unknown as T;
  }
  const supplyRecMatch = /^\/api\/supply\/recommendations\/(\d+)\/decision$/.exec(pathname);
  if (method === 'POST' && supplyRecMatch) {
    const rec = demoState.supplyBoard.recommendations.find((r) => r.id === Number(supplyRecMatch[1]));
    const nextDec = body.decision || body.decisionStatus;
    if (rec && nextDec) {
      rec.decisionStatus = nextDec;
      rec.decisionNotes = body.decisionNotes || '[SANDBOX DEMO]';
      rec.decidedAt = new Date().toISOString();
    }
    return rec as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/supply/intake-requests') {
    const code = `SOL-DEMO-SIM-${++nextSeqId}`;
    const mat = demoState.materials.find((m) => m.id === Number(body.materialId));
    const targetSilo = body.targetSiloId
      ? demoState.silos.find((s) => s.id === Number(body.targetSiloId))
      : null;
    const nowIso = new Date().toISOString();
    demoState.supplyBoard.intakeRequests.unshift({
      id: nextSeqId,
      requestCode: code,
      materialId: Number(body.materialId),
      materialCode: mat?.code || 'DEMO',
      materialDescription: mat?.description || 'Material Demo',
      productionLineId: body.productionLineId ? Number(body.productionLineId) : (targetSilo?.productionLineId ?? null),
      lineCode: body.lineCode || targetSilo?.lineCode || null,
      targetSiloId: targetSilo?.id ?? (body.targetSiloId ? Number(body.targetSiloId) : null),
      targetSiloNumber: targetSilo?.siloNumber ?? null,
      recommendationId: body.recommendationId ? Number(body.recommendationId) : null,
      neededQuantityKg: Number(body.neededQuantityKg || 0),
      neededByDate: body.neededByDate || demoState.session.shift.operationalDate,
      priority: body.priority || 'ALTA',
      justification: `[SANDBOX DEMO] ${body.justification || ''}`.trim(),
      status: 'ABERTA',
      requestedByName: demoState.session.user.displayName,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return { requestCode: code } as unknown as T;
  }
  if (method === 'PUT' && pathname === '/api/supply/priority-config') {
    demoState.supplyBoard.priorityConfig = {
      ...demoState.supplyBoard.priorityConfig,
      ...body,
      updatedAt: new Date().toISOString(),
    };
    return demoState.supplyBoard.priorityConfig as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/ai/supply-advisor') {
    const advice: GeminiSupplyAdviceResponse = {
      explanation:
        '[SANDBOX DEMO] Prioridade máxima nas linhas com cobertura em risco: confrontar saldo confirmado em Silo de Linha, capacidade disponível na Armazenagem (42–34) e rotas formalmente autorizadas.',
      scenarioComparison: [
        'Cenário A: Concluir transferências parciais abertas antes de iniciar novas ordens.',
        'Cenário B: Direcionar recebimentos parciais em andamento para silos de armazenagem liberados.',
      ],
      divergencesNoted: ['Pendências documentais originais permanecem preservadas no catálogo oficial.'],
      manualGuidance: 'Toda execução depende de confirmação humana autorizada na Central de Transferências.',
      warnings: ['Modo Apresentação Executiva: nenhuma alteração é gravada no PostgreSQL.'],
    };
    return advice as unknown as T;
  }

  // Reports
  const parseReportFiltersFromParams = (p: URLSearchParams): ReportFilterParams => ({
    preset: (p.get('preset') as PeriodPreset) || undefined,
    startDate: p.get('startDate') || undefined,
    endDate: p.get('endDate') || undefined,
    shiftCode: p.get('shiftCode') || undefined,
    materialId: p.get('materialId') ? Number(p.get('materialId')) : null,
    siloId: p.get('siloId') ? Number(p.get('siloId')) : null,
    lineCode: p.get('lineCode') || undefined,
    supplierName: p.get('supplierName') || undefined,
    lotCode: p.get('lotCode') || undefined,
    status: p.get('status') || undefined,
    onlyPartial: p.get('onlyPartial') === 'true',
    onlyPending: p.get('onlyPending') === 'true',
    onlyPendingComparison: p.get('onlyPendingComparison') === 'true',
    historicalDate: p.get('historicalDate') || undefined,
    cutoffMode: (p.get('cutoffMode') as 'OPERATIONAL_DATE' | 'TIMESTAMP') || undefined,
  });

  if (method === 'GET' && pathname === '/api/reports/overview') {
    return buildDemoReportsOverview(demoState, parseReportFiltersFromParams(params)) as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/reports/receiving') {
    return buildDemoReceivingReport(demoState, parseReportFiltersFromParams(params)) as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/reports/stock') {
    return buildDemoStockReport(demoState, parseReportFiltersFromParams(params)) as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/reports/transfers') {
    return buildDemoTransfersReport(demoState, parseReportFiltersFromParams(params)) as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/reports/consumption') {
    return buildDemoConsumptionReport(demoState, parseReportFiltersFromParams(params)) as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/kpi-targets') {
    return demoState.performanceTargets as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/kpi-targets') {
    const rawPeriod = String(body.targetPeriod || 'DIARIO').toUpperCase();
    const targetPeriod: PerformanceTargetItem['targetPeriod'] =
      rawPeriod === 'SEMANAL' || rawPeriod === 'MENSAL' ? rawPeriod : 'DIARIO';
    const target: PerformanceTargetItem = {
      id: ++nextSeqId,
      code: String(body.code || `KPI-DEMO-${nextSeqId}`).toUpperCase(),
      metricKey: String(body.metricKey || 'AVG_RECEIPT_DURATION_MIN'),
      label: String(body.label || 'Meta Demonstrativa'),
      targetValue: Number(body.targetValue || 0),
      unit: String(body.unit || 'min'),
      targetPeriod,
      effectiveFromDate: body.effectiveFromDate || demoState.session.shift.operationalDate,
      notes: body.notes || '[SANDBOX DEMO]',
      isActive: true,
      updatedByName: demoState.session.user.displayName,
      updatedAt: new Date().toISOString(),
    };
    demoState.performanceTargets.push(target);
    return target as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/reports/snapshots') {
    return demoState.recentSnapshots as unknown as T;
  }

  // Shifts, Handover, Occurrences, Assistant, Audit, Users
  if (method === 'GET' && pathname === '/api/shifts') {
    return demoState.shifts as unknown as T;
  }
  const shiftPatchMatch = /^\/api\/shifts\/([^/]+)$/.exec(pathname);
  if ((method === 'PATCH' || method === 'PUT') && shiftPatchMatch) {
    const s = demoState.shifts.find((sh) => sh.code === shiftPatchMatch[1]);
    if (s) {
      if (body.startTime) s.startTime = body.startTime;
      if (body.endTime) s.endTime = body.endTime;
      if (body.supervisorUserId !== undefined) s.supervisorUserId = body.supervisorUserId;
      if (body.responsibleName !== undefined) s.responsibleName = body.responsibleName;
      if (typeof body.isValidated === 'boolean') s.isValidated = body.isValidated;
      if (body.notes !== undefined) s.notes = body.notes;
      s.updatedAt = new Date().toISOString();
    }
    return s as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/reports/shifts') {
    const f = {
      ...parseReportFiltersFromParams(params),
      operatorName: params.get('operatorName') || undefined,
      badgeCode: params.get('badgeCode') || undefined,
      workflowStatus: params.get('workflowStatus') || undefined,
      search: params.get('search') || undefined,
    };
    return buildDemoShiftManagerialReport(demoState, f) as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/shift-handovers') {
    return structuredClone(demoState.handovers) as unknown as T;
  }
  if (method === 'GET' && (pathname === '/api/shift-handovers/auto-summary' || pathname === '/api/shift-handovers/summary')) {
    const sc = params.get('shiftCode') || undefined;
    const od = params.get('operationalDate') || undefined;
    return buildDemoAutoSummary(demoState, sc, od) as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/shift-handovers/draft') {
    const sc = String(body.shiftCode || demoState.session.shift.shiftCode);
    const od = String(body.operationalDate || demoState.session.shift.operationalDate);
    const existing = body.id
      ? demoState.handovers.find((h) => h.id === Number(body.id))
      : demoState.handovers.find((h) => h.shiftCode === sc && h.operationalDate === od && h.status !== 'FINALIZADA');

    if (existing) {
      if (existing.workflowStatus === 'APROVADO' || existing.workflowStatus === 'ENCERRADO' || existing.status === 'FINALIZADA') {
        throw new Error('Relatório já aprovado/encerrado. Utilize a rota de correção versionada.');
      }
      const nextVer = existing.version + 1;
      const nowIso = new Date().toISOString();
      const wf =
        body.workflowStatus ||
        (body.status === 'REVISAO' ? 'AGUARDANDO_CONFERENCIA' : existing.workflowStatus || 'EM_ELABORACAO');
      Object.assign(existing, body, {
        workflowStatus: wf,
        version: nextVer,
        aiEditCount: body.aiCommand ? (existing.aiEditCount || 0) + 1 : existing.aiEditCount || 0,
        lastAiCommand: body.aiCommand ?? existing.lastAiCommand ?? null,
        updatedAt: nowIso,
      });
      existing.revisions = existing.revisions || [];
      existing.revisions.unshift({
        id: ++nextSeqId,
        handoverId: existing.id,
        version: nextVer,
        workflowStatus: wf,
        changeType: body.aiCommand ? 'EDICAO_IA' : 'RASCUNHO',
        reportText: existing.editedReportText || existing.autoReportText,
        aiCommand: body.aiCommand || null,
        reason: body.status === 'REVISAO' ? 'Enviado para conferência' : 'Atualização de rascunho',
        editedByUserId: demoState.session.user.id,
        editedByName: demoState.session.user.displayName,
        editedByBadge: demoState.session.user.badgeCode || null,
        createdAt: nowIso,
      });
      return structuredClone(existing) as unknown as T;
    }

    const id = ++nextSeqId;
    const nowIso = new Date().toISOString();
    const autoSum = buildDemoAutoSummary(demoState, sc, od);
    const generated =
      body.editedReportText ||
      buildMoegaShiftNarrativeReport({
        summary: autoSum,
        handoverByName: demoState.session.user.displayName,
        handoverByBadge: demoState.session.user.badgeCode,
        receivedByName: body.receivedByName,
        shiftSummaryText: body.shiftSummaryText,
        relevantOccurrencesText: body.relevantOccurrencesText,
        pendenciesText: body.pendenciesText,
        requiredActionsText: body.requiredActionsText,
        nextShiftRecommendationsText: body.nextShiftRecommendationsText,
      });
    const wf =
      body.workflowStatus || (body.status === 'REVISAO' ? 'AGUARDANDO_CONFERENCIA' : 'EM_ELABORACAO');
    const created: ShiftHandoverView = {
      id,
      handoverCode: `PASS-DEMO-${id}`,
      shiftCode: sc,
      shiftName: autoSum.shiftName,
      operationalDate: od,
      status: body.status || 'RASCUNHO',
      workflowStatus: wf,
      autoSummary: autoSum,
      shiftSummaryText: body.shiftSummaryText || '',
      relevantOccurrencesText: body.relevantOccurrencesText || '',
      pendenciesText: body.pendenciesText || '',
      requiredActionsText: body.requiredActionsText || '',
      nextShiftRecommendationsText: body.nextShiftRecommendationsText || '',
      autoReportText: generated,
      editedReportText: body.editedReportText || generated,
      supplements: [],
      vehicleBreakdown: autoSum.vehicleBreakdown || null,
      aiEditCount: body.aiCommand ? 1 : 0,
      lastAiCommand: body.aiCommand || null,
      handoverByUserId: demoState.session.user.id,
      handoverByName: demoState.session.user.displayName,
      handoverByBadge: demoState.session.user.badgeCode || null,
      receivedByUserId: null,
      receivedByName: body.receivedByName || null,
      reviewedByName: null,
      approvedByName: null,
      approvedAt: null,
      approvalNotes: null,
      finalizedByName: null,
      finalizedAt: null,
      closedAt: null,
      version: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
      pendencies: demoState.openShiftPendencies,
      revisions: [
        {
          id: ++nextSeqId,
          handoverId: id,
          version: 1,
          workflowStatus: wf,
          changeType: 'CRIACAO_RASCUNHO',
          reportText: body.editedReportText || generated,
          aiCommand: body.aiCommand || null,
          reason: 'Criação inicial do rascunho de passagem',
          editedByUserId: demoState.session.user.id,
          editedByName: demoState.session.user.displayName,
          editedByBadge: demoState.session.user.badgeCode || null,
          createdAt: nowIso,
        },
      ],
    };
    demoState.handovers.unshift(created);
    return structuredClone(created) as unknown as T;
  }
  const supHoMatch = /^\/api\/shift-handovers\/(\d+)\/supplement$/.exec(pathname);
  if (method === 'POST' && supHoMatch) {
    const existing = demoState.handovers.find((h) => h.id === Number(supHoMatch[1]));
    if (!existing) throw new Error('Passagem não encontrada.');
    if (existing.workflowStatus === 'APROVADO' || existing.workflowStatus === 'ENCERRADO' || existing.status === 'FINALIZADA') {
      throw new Error('Relatório já aprovado/encerrado. Utilize correção versionada.');
    }
    const nowIso = new Date().toISOString();
    const sup = {
      id: `SUP-${++nextSeqId}`,
      timestampIso: nowIso,
      authorUserId: demoState.session.user.id,
      authorName: demoState.session.user.displayName,
      authorBadge: demoState.session.user.badgeCode || null,
      executedByName: body.executedByName || null,
      executedByBadge: body.executedByBadge || null,
      category: body.category || 'INFORMACAO_OPERACIONAL',
      text: String(body.text || '').trim(),
    };
    existing.supplements = [...(existing.supplements || []), sup];
    if (body.appendToReport !== false) {
      const rebuilt = buildMoegaShiftNarrativeReport({
        summary: existing.autoSummary,
        handoverByName: existing.handoverByName,
        handoverByBadge: existing.handoverByBadge,
        receivedByName: existing.receivedByName,
        shiftSummaryText: existing.shiftSummaryText,
        relevantOccurrencesText: existing.relevantOccurrencesText,
        pendenciesText: existing.pendenciesText,
        requiredActionsText: existing.requiredActionsText,
        nextShiftRecommendationsText: existing.nextShiftRecommendationsText,
        supplements: existing.supplements,
      });
      existing.editedReportText = rebuilt;
    }
    existing.version += 1;
    existing.updatedAt = nowIso;
    existing.revisions = existing.revisions || [];
    existing.revisions.unshift({
      id: ++nextSeqId,
      handoverId: existing.id,
      version: existing.version,
      workflowStatus: existing.workflowStatus || 'EM_ELABORACAO',
      changeType: 'COMPLEMENTO_MANUAL',
      reportText: existing.editedReportText || existing.autoReportText,
      aiCommand: null,
      reason: `Complemento (${sup.category}): ${sup.text}`,
      editedByUserId: demoState.session.user.id,
      editedByName: demoState.session.user.displayName,
      editedByBadge: demoState.session.user.badgeCode || null,
      createdAt: nowIso,
    });
    return structuredClone(existing) as unknown as T;
  }
  const finHoMatch = /^\/api\/shift-handovers\/(\d+)\/finalize$/.exec(pathname);
  if (method === 'POST' && finHoMatch) {
    const existing =
      demoState.handovers.find((h) => h.id === Number(finHoMatch[1])) || demoState.handovers[0];
    if (!existing) throw new Error('Passagem não encontrada.');
    const nowIso = new Date().toISOString();
    existing.status = 'FINALIZADA';
    existing.workflowStatus = 'AGUARDANDO_APROVACAO';
    if (body.receivedByName !== undefined) existing.receivedByName = body.receivedByName;
    if (body.editedReportText !== undefined) existing.editedReportText = body.editedReportText;
    existing.finalizedByName = demoState.session.user.displayName;
    existing.finalizedAt = nowIso;
    existing.version += 1;
    existing.updatedAt = nowIso;
    existing.revisions = existing.revisions || [];
    existing.revisions.unshift({
      id: ++nextSeqId,
      handoverId: existing.id,
      version: existing.version,
      workflowStatus: 'AGUARDANDO_APROVACAO',
      changeType: 'FINALIZACAO_OPERACIONAL',
      reportText: existing.editedReportText || existing.autoReportText,
      aiCommand: null,
      reason: 'Passagem finalizada pelo operador e enviada para aprovação',
      editedByUserId: demoState.session.user.id,
      editedByName: demoState.session.user.displayName,
      editedByBadge: demoState.session.user.badgeCode || null,
      createdAt: nowIso,
    });
    return structuredClone(existing) as unknown as T;
  }
  const appHoMatch = /^\/api\/shift-handovers\/(\d+)\/approve$/.exec(pathname);
  if (method === 'POST' && appHoMatch) {
    const existing = demoState.handovers.find((h) => h.id === Number(appHoMatch[1]));
    if (!existing) throw new Error('Passagem não encontrada.');
    const nowIso = new Date().toISOString();
    const closeImmediately = body.closeImmediately !== false;
    existing.status = 'FINALIZADA';
    existing.workflowStatus = closeImmediately ? 'ENCERRADO' : 'APROVADO';
    existing.approvedByName = demoState.session.user.displayName;
    existing.approvedAt = nowIso;
    existing.approvalNotes = body.approvalNotes || null;
    if (closeImmediately) existing.closedAt = nowIso;
    existing.version += 1;
    existing.updatedAt = nowIso;
    existing.revisions = existing.revisions || [];
    existing.revisions.unshift({
      id: ++nextSeqId,
      handoverId: existing.id,
      version: existing.version,
      workflowStatus: existing.workflowStatus,
      changeType: closeImmediately ? 'APROVACAO_E_ENCERRAMENTO' : 'APROVACAO',
      reportText: existing.editedReportText || existing.autoReportText,
      aiCommand: null,
      reason: body.approvalNotes || 'Aprovação gerencial oficial',
      editedByUserId: demoState.session.user.id,
      editedByName: demoState.session.user.displayName,
      editedByBadge: demoState.session.user.badgeCode || null,
      createdAt: nowIso,
    });
    return structuredClone(existing) as unknown as T;
  }
  const corrHoMatch = /^\/api\/shift-handovers\/(\d+)\/correct$/.exec(pathname);
  if (method === 'POST' && corrHoMatch) {
    const existing = demoState.handovers.find((h) => h.id === Number(corrHoMatch[1]));
    if (!existing) throw new Error('Passagem não encontrada.');
    const reason = String(body.reason || '').trim();
    if (reason.length < 5) throw new Error('Justificativa obrigatória com no mínimo 5 caracteres.');
    const nowIso = new Date().toISOString();
    existing.editedReportText = String(body.editedReportText || existing.editedReportText || existing.autoReportText);
    existing.version += 1;
    existing.updatedAt = nowIso;
    existing.revisions = existing.revisions || [];
    existing.revisions.unshift({
      id: ++nextSeqId,
      handoverId: existing.id,
      version: existing.version,
      workflowStatus: existing.workflowStatus || 'ENCERRADO',
      changeType: 'CORRECAO_POS_APROVACAO',
      reportText: existing.editedReportText,
      aiCommand: null,
      reason,
      editedByUserId: demoState.session.user.id,
      editedByName: demoState.session.user.displayName,
      editedByBadge: demoState.session.user.badgeCode || null,
      createdAt: nowIso,
    });
    return structuredClone(existing) as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/shift-handovers/refine-text') {
    const raw = body.baseReportText || body.rawText || demoState.handovers[0]?.autoReportText || '';
    const res = polishShiftReportTextDeterministic({
      baseReportText: String(raw),
      rawFacts: (body.rawFacts as Record<string, unknown>) || {},
      userCommand: body.userCommand || null,
    });
    return {
      refinedText: res.refinedText,
      warnings: res.warnings,
      usedAiModel: null,
    } as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/shift-pendencies/open') {
    return demoState.openShiftPendencies as unknown as T;
  }
  const ackPendMatch = /^\/api\/shift-pendencies\/(\d+)\/acknowledge$/.exec(pathname);
  if (method === 'POST' && ackPendMatch) {
    const p = demoState.openShiftPendencies.find((item) => item.id === Number(ackPendMatch[1]));
    if (p) {
      p.status = 'CIENTE';
      p.acknowledgedByName = demoState.session.user.displayName;
      p.acknowledgedAt = new Date().toISOString();
    }
    return p as unknown as T;
  }
  const resPendMatch = /^\/api\/shift-pendencies\/(\d+)\/resolve$/.exec(pathname);
  if (method === 'POST' && resPendMatch) {
    const p = demoState.openShiftPendencies.find((item) => item.id === Number(resPendMatch[1]));
    if (p) {
      p.status = 'RESOLVIDA';
      p.resolvedByName = demoState.session.user.displayName;
      p.resolvedAt = new Date().toISOString();
    }
    return p as unknown as T;
  }

  if (method === 'GET' && pathname === '/api/occurrences') {
    return demoState.occurrences as unknown as T;
  }
  if (method === 'POST' && pathname === '/api/occurrences') {
    const id = ++nextSeqId;
    const mat = body.materialId ? demoState.materials.find((m) => m.id === Number(body.materialId)) : null;
    const occ = {
      id,
      occurrenceCode: `OC-DEMO-SIM-${id}`,
      category: String(body.category || 'Outros'),
      title: `[DEMO] ${body.title || 'Ocorrência demonstrativa'}`,
      description: String(body.description || ''),
      occurredAt: new Date().toISOString(),
      siloId: body.siloId ? Number(body.siloId) : null,
      siloNumber: body.siloId
        ? demoState.silos.find((s) => s.id === Number(body.siloId))?.siloNumber ?? null
        : null,
      materialId: body.materialId ? Number(body.materialId) : null,
      materialCode: mat?.code ?? null,
      materialDescription: mat?.description ?? null,
      productionLineId: null,
      lineCode: body.lineCode || null,
      reportedByUserId: demoState.session.user.id,
      reportedByName: demoState.session.user.displayName,
      reportedByBadge: demoState.session.user.badgeCode || null,
      executedByName: body.executedByName || null,
      executedByBadge: body.executedByBadge || null,
      assignedToUserId: null,
      assignedToName: null,
      shiftCode: demoState.session.shift.shiftCode,
      operationalDate: demoState.session.shift.operationalDate,
      priority: body.priority || 'MEDIA',
      weatherCondition: body.weatherCondition || null,
      lineImpact: body.lineImpact || null,
      evidence: [],
      status: 'ABERTA' as const,
      solutionApplied: null,
      verifiedByName: null,
      verifiedAt: null,
      verificationNotes: null,
      closedByName: null,
      closedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    demoState.occurrences.unshift(occ);
    recomputeDemoDerivedState(demoState);
    return occ as unknown as T;
  }
  const occStatusMatch = /^\/api\/occurrences\/(\d+)\/status$/.exec(pathname);
  if (method === 'PATCH' && occStatusMatch) {
    const occ = demoState.occurrences.find((o) => o.id === Number(occStatusMatch[1]));
    if (occ && body.status) {
      occ.status = body.status;
      if (body.solutionApplied) occ.solutionApplied = body.solutionApplied;
      occ.updatedAt = new Date().toISOString();
      recomputeDemoDerivedState(demoState);
    }
    return occ as unknown as T;
  }
  const occVerifyMatch = /^\/api\/occurrences\/(\d+)\/verify$/.exec(pathname);
  if (method === 'POST' && occVerifyMatch) {
    const occ = demoState.occurrences.find((o) => o.id === Number(occVerifyMatch[1]));
    if (!occ) throw new Error('Ocorrência não encontrada.');
    occ.verifiedByName = demoState.session.user.displayName;
    occ.verifiedAt = new Date().toISOString();
    occ.verificationNotes = body.verificationNotes || 'Verificada pela supervisão [DEMO]';
    occ.updatedAt = new Date().toISOString();
    return occ as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/assistant/ask') {
    const q = String(body.question || '').toLowerCase();
    const totalKg = Math.round(demoState.silos.reduce((a, s) => a + s.confirmedStockKg, 0));
    const critSilos = demoState.silos.filter((s) => s.stockAlertLevel === 'CRITICO');
    const attSilos = demoState.silos.filter((s) => s.stockAlertLevel === 'ATENCAO');

    let answer = '';
    let suggestedNavigation: NexoAssistantResponse['suggestedNavigation'] = 'executivo';

    if (q.includes('crític') || q.includes('critic') || q.includes('linha 4') || q.includes('silo 12') || q.includes('falta')) {
      answer =
        critSilos.length > 0
          ? `[${demoState.viewMode === 'BANCO_AO_VIVO' ? 'ESPELHO POSTGRESQL' : 'CENÁRIO DEMO'}] Identificados ${critSilos.length} silo(s) crítico(s) (${critSilos
              .map((s) => `Silo ${s.siloNumber}: ${Math.round(s.confirmedStockKg).toLocaleString('pt-BR')} kg`)
              .join(', ')}) e ${attSilos.length} em atenção.`
          : `[ESPELHO POSTGRESQL] Não há silos marcados em alerta crítico no snapshot atual (total confirmado: ${totalKg.toLocaleString('pt-BR')} kg).`;
      suggestedNavigation = 'abastecimento';
    } else if (q.includes('receb') || q.includes('etiqueta') || q.includes('caminh') || q.includes('hoje')) {
      answer = `[${demoState.viewMode === 'BANCO_AO_VIVO' ? 'ESPELHO POSTGRESQL' : 'CENÁRIO DEMO'}] Constam ${demoState.receipts.length} recebimento(s) no período (${demoState.receipts
        .slice(0, 3)
        .map((r) => `${r.receiptNumber} · ${r.materialDescription}`)
        .join('; ') || 'nenhum registrado ainda'}).`;
      suggestedNavigation = 'recebimentos';
    } else if (q.includes('38') || q.includes('transfer')) {
      const s38 = demoState.silos.find((s) => s.siloNumber === 38);
      answer = `[${demoState.viewMode === 'BANCO_AO_VIVO' ? 'ESPELHO POSTGRESQL' : 'CENÁRIO DEMO'}] Existem ${demoState.transferOrders.length} ordem(ns) de transferência e ${demoState.routes.filter((r) => r.isActive).length} rota(s) autorizada(s). O Silo 38 possui saldo de ${Math.round(
        s38?.confirmedStockKg ?? 0
      ).toLocaleString('pt-BR')} kg.`;
      suggestedNavigation = 'transferencias';
    } else if (q.includes('pend') || q.includes('turno') || q.includes('ocorr')) {
      answer = `[${demoState.viewMode === 'BANCO_AO_VIVO' ? 'ESPELHO POSTGRESQL' : 'CENÁRIO DEMO'}] Existem ${demoState.openShiftPendencies.length} pendência(s) de passagem de turno, ${demoState.pendencies.filter((p) => p.status === 'PENDENTE').length} pendência(s) documentais no catálogo e ${demoState.occurrences.filter((o) => o.status !== 'ENCERRADA').length} ocorrência(s) em aberto.`;
      suggestedNavigation = 'turnos';
    } else {
      answer = `[${demoState.viewMode === 'BANCO_AO_VIVO' ? 'ESPELHO POSTGRESQL' : 'CENÁRIO DEMO'}] Catálogo oficial ativo: ${demoState.silos.length} silos (${Math.round(
        demoState.liveCounts.totalSafeCapacityKg
      ).toLocaleString('pt-BR')} kg seguros), ${demoState.materials.length} MPs e ${totalKg.toLocaleString('pt-BR')} kg em estoque atual. Pergunte sobre silos críticos, recebimentos, transferências ou pendências.`;
      suggestedNavigation = 'mapa';
    }

    const res: NexoAssistantResponse = {
      answer,
      periodConsulted: `${demoState.session.shift.operationalDate} · ${demoState.session.shift.shiftName}`,
      dataOrigin:
        demoState.viewMode === 'BANCO_AO_VIVO'
          ? 'ESPELHO SOMENTE LEITURA DO POSTGRESQL OFICIAL'
          : 'CENÁRIO DEMONSTRATIVO SOBRE CATÁLOGO REAL POSTGRESQL',
      lastUpdatedIso: new Date().toISOString(),
      missingDataNotes: [
        'Modo Apresentação Executiva: nenhuma alteração é gravada no banco PostgreSQL.',
      ],
      suggestedNavigation,
      usedAiModel: 'nexo-demo-sandbox',
    };
    return res as unknown as T;
  }

  if (method === 'GET' && pathname === '/api/audit') {
    return demoState.auditEvents as unknown as T;
  }
  if (method === 'GET' && pathname === '/api/users') {
    return demoState.users as unknown as T;
  }
  const userPatchMatch = /^\/api\/users\/(\d+)$/.exec(pathname);
  if (method === 'PATCH' && userPatchMatch) {
    const u = demoState.users.find((usr) => usr.id === Number(userPatchMatch[1]));
    if (u) Object.assign(u, body);
    return u as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/ai/chat') {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastMsg = messages[messages.length - 1]?.text || '';
    const groundingMode = body.groundingMode || 'NONE';
    const model = groundingMode !== 'NONE' ? 'gemini-4-hydrogen' : (body.model || 'gemini-4-hydrogen');
    return {
      replyText: `[SANDBOX DEMO — ${model}] Pergunta recebida: "${String(lastMsg).slice(0, 140)}". No ambiente autenticado conectado ao servidor, esta aba executa chamadas reais à API Google Gemini (${groundingMode === 'SEARCH' ? 'com Google Search Grounding' : groundingMode === 'MAPS' ? 'com Google Maps Grounding' : 'multimodal multi-turno'}).`,
      model,
      groundingMode,
      groundingLinks:
        groundingMode === 'SEARCH'
          ? [
              {
                type: 'web',
                title: '[DEMO] Referência técnica simulada — NEXO LOG',
                uri: 'https://ai.google.dev',
              },
            ]
          : groundingMode === 'MAPS'
            ? [
                {
                  type: 'maps',
                  title: '[DEMO] Localização simulada no Google Maps',
                  uri: 'https://maps.google.com',
                },
              ]
            : [],
      googleMapsWidgetContextToken: null,
    } as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/ai/transcribe') {
    return {
      transcript:
        '[SANDBOX DEMO] Transcrição simulada: "Operador Moega informou descarga parcial de calcário no Silo 21, 18.840 kg restantes para o segundo turno." No modo autenticado, o áudio é transcrito pelo modelo gemini-3.5-transcribe.',
      model: 'gemini-3.5-transcribe',
      mimeType: String(body.mimeType || 'audio/webm'),
    } as unknown as T;
  }

  if (method === 'GET' && pathname === '/api/dashboard/consumption-trend') {
    const days = params.get('days') ? Number(params.get('days')) : 30;
    const lineCode = params.get('lineCode') || 'ALL';
    const materialId = params.get('materialId') ? Number(params.get('materialId')) : null;
    return buildDemo30DayConsumptionTrend(demoState, {
      days: Number.isFinite(days) ? days : 30,
      lineCode,
      materialId: materialId && Number.isFinite(materialId) ? materialId : null,
    }) as unknown as T;
  }

  if (method === 'GET' && pathname === '/api/baskets/history') {
    const prodDate = params.get('productionDate');
    const versions = prodDate
      ? demoState.basketVersions.filter((v) => v.productionDate === prodDate)
      : demoState.basketVersions;
    const comparisons = prodDate
      ? demoState.basketComparisons.filter((c) => c.productionDate === prodDate)
      : demoState.basketComparisons;
    return { versions, comparisons } as unknown as T;
  }

  const basketCmpMatch = /^\/api\/baskets\/comparisons\/(\d+)$/.exec(pathname);
  if (method === 'GET' && basketCmpMatch) {
    const found = demoState.basketComparisons.find((c) => c.id === Number(basketCmpMatch[1]));
    if (!found) throw new Error('Comparação não encontrada no Sandbox.');
    return found as unknown as T;
  }

  if (method === 'GET' && pathname === '/api/baskets/notifications/latest') {
    const latestPub = demoState.basketComparisons.find((c) => c.status === 'PUBLICADA');
    if (!latestPub) return { notification: null } as unknown as T;
    const notif: BasketNotificationEvent = {
      type: 'basket:published',
      comparisonId: latestPub.id,
      comparisonCode: latestPub.comparisonCode,
      productionDate: latestPub.productionDate,
      baseVersionLabel: latestPub.baseVersionLabel,
      targetVersionLabel: latestPub.targetVersionLabel,
      totalDiffKg: latestPub.totalDiffKg,
      criticalImpactsCount: latestPub.operationalImpacts.filter(
        (o) => o.shortageRisk === 'CRITICO' || o.shortageRisk === 'SEM_SILO_COMPATIVEL'
      ).length,
      publishedByName: latestPub.publishedByName || latestPub.createdByName,
      publishedAt: latestPub.publishedAt || latestPub.createdAt,
      summaryHighlights: latestPub.diffItems
        .filter((d) => d.classification !== 'MANTIDO')
        .slice(0, 4)
        .map(
          (d) =>
            `${d.lineCode} · ${d.materialDescription}: ${formatBrazilianDiff(d.diffKg)} kg (${d.classification})`
        ),
    };
    return { notification: notif } as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/baskets/extract') {
    const pages: Array<{ pageNumber: number; fileName: string; base64Content?: string }> =
      Array.isArray(body.pages) ? body.pages : [];
    const expectedDate = String(body.expectedProductionDate || '2026-11-25');
    const sourceType = String(body.sourceType || 'CAMERA_TABLET');

    if (sourceType === 'ARQUIVO_CSV' && pages[0]?.base64Content) {
      const clean = String(pages[0].base64Content).replace(/^data:[^;]+;base64,/, '');
      const csvText = typeof atob === 'function'
        ? atob(clean)
        : Buffer.from(clean, 'base64').toString('utf8');
      const lines = csvText
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const sep = (lines[0]?.match(/;/g)?.length || 0) >= (lines[0]?.match(/,/g)?.length || 0) ? ';' : ',';
      const rows = lines.slice(1).map((l, idx) => {
        const cols = l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));
        const lineCode = normalizeLineCode(cols[0] || 'L1');
        const code = (cols[1] || '').trim().toUpperCase() || null;
        const mat = code ? demoState.materials.find((m) => m.code.toUpperCase() === code) : undefined;
        const rawQty = cols[3] || '';
        const unit = (cols[4] || 'kg').toLowerCase();
        const plannedQuantityKg = convertRawQuantityToKg(rawQty, unit);
        return {
          productionDate: expectedDate,
          lineCode,
          materialId: mat?.id ?? null,
          materialCode: code,
          materialDescription: cols[2] || mat?.description || 'Não identificado',
          rawQuantityText: rawQty || null,
          plannedQuantityKg,
          unit: unit === 't' ? 't' : 'kg',
          sourcePage: 1,
          sourceDocumentName: pages[0].fileName,
          sourceRegion: `Linha ${idx + 2}`,
          confidence: (plannedQuantityKg !== null && code ? 'ALTA' : 'BAIXA') as 'ALTA' | 'MEDIA' | 'BAIXA',
          needsReview: plannedQuantityKg === null || !code,
          reviewReason:
            plannedQuantityKg === null || !code
              ? 'Quantidade ou código ausente no CSV — conferir manualmente.'
              : null,
        };
      });
      const resp: BasketExtractResponse = {
        productionDate: expectedDate,
        emissionTime: null,
        documentTitle: pages[0].fileName,
        unreadableFields: [],
        usedAiModel: null,
        items: rows,
      };
      return resp as unknown as T;
    }

    // Fallback realista para imagens/PDF em Modo Apresentação (usa base 07:00 ou 19:00 conforme índice/nome)
    const refVers = buildReference2511BasketVersions(demoState.materials);
    const fileLabel = (pages[0]?.fileName || '').toLowerCase();
    const isUpdated = fileLabel.includes('19') || fileLabel.includes('atual') || fileLabel.includes('v2');
    const chosen = isUpdated ? refVers[3] : refVers[0];
    const resp: BasketExtractResponse = {
      productionDate: expectedDate,
      emissionTime: chosen.emissionTime,
      documentTitle: pages[0]?.fileName || chosen.label,
      unreadableFields: [],
      usedAiModel: 'gemini-4-hydrogen [DEMO]',
      items: chosen.items.map((it, idx) => ({
        productionDate: expectedDate,
        lineCode: it.lineCode,
        materialId: it.materialId,
        materialCode: it.materialCode,
        materialDescription: it.materialDescription,
        rawQuantityText: it.rawQuantityText,
        plannedQuantityKg: it.plannedQuantityKg,
        unit: it.unit,
        sourcePage: Math.min(pages.length || 1, idx >= 5 ? 2 : 1),
        sourceDocumentName: pages[idx >= 5 && pages[1] ? 1 : 0]?.fileName || 'foto-cesta.jpg',
        sourceRegion: it.sourceRegion,
        confidence: idx === 0 && isUpdated ? 'MEDIA' : 'ALTA',
        needsReview: idx === 0 && isUpdated,
        reviewReason:
          idx === 0 && isUpdated
            ? '[DEMO] Leitura sinalizada para conferência visual rápida antes da comparação.'
            : null,
      })),
    };
    return resp as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/baskets/versions') {
    const itemsInput = Array.isArray(body.items) ? body.items : [];
    const verId = ++nextSeqId;
    const prodDate = String(body.productionDate || demoState.session.shift.operationalDate);
    const seq = demoState.basketVersions.filter((v) => v.productionDate === prodDate).length + 1;
    const mappedItems = itemsInput.map((it: any, idx: number) => {
      const code = it.materialCode ? String(it.materialCode).trim().toUpperCase() : null;
      const mat = code ? demoState.materials.find((m) => m.code.toUpperCase() === code) : undefined;
      const qtyKg =
        it.plannedQuantityKg !== undefined && it.plannedQuantityKg !== null
          ? Number(it.plannedQuantityKg)
          : convertRawQuantityToKg(it.rawQuantityText, it.unit || 'kg');
      return {
        id: ++nextSeqId,
        basketVersionId: verId,
        productionDate: prodDate,
        lineCode: normalizeLineCode(it.lineCode || 'L1'),
        materialId: it.materialId ?? mat?.id ?? null,
        materialCode: code,
        materialDescription: String(it.materialDescription || mat?.description || 'Não identificado'),
        rawQuantityText: it.rawQuantityText ?? (qtyKg !== null ? String(qtyKg) : null),
        plannedQuantityKg: qtyKg,
        unit: it.unit || 'kg',
        sourcePage: it.sourcePage || 1,
        sourceDocumentName: it.sourceDocumentName || null,
        sourceRegion: it.sourceRegion || `Item ${idx + 1}`,
        confidence: it.confidence || 'MEDIA',
        needsReview: Boolean(it.needsReview) || qtyKg === null || !code,
        reviewReason: it.reviewReason || null,
        manuallyEdited: false,
        editedByName: null,
      };
    });

    const newVer: BasketVersionView = {
      id: verId,
      versionCode: `CESTA-${prodDate.replace(/-/g, '')}-V${seq}-DEMO`,
      label: String(body.label || `Cesta v${seq}`),
      productionDate: prodDate,
      emissionTime: body.emissionTime || null,
      sequenceOrder: seq,
      sourceType: body.sourceType || 'CAMERA_TABLET',
      status: mappedItems.some((i: any) => i.needsReview) ? 'RASCUNHO' : 'CONFERIDA',
      isCurrentPublished: false,
      linkedScheduleId: null,
      sourcePages: Array.isArray(body.sourcePages) ? body.sourcePages : [],
      unreadableFields: Array.isArray(body.unreadableFields) ? body.unreadableFields : [],
      createdByName: demoState.session.user.displayName,
      publishedByName: null,
      publishedAt: null,
      notes: body.notes || null,
      createdAt: new Date().toISOString(),
      items: mappedItems,
    };
    demoState.basketVersions.push(newVer);
    return newVer as unknown as T;
  }

  const basketPatchMatch = /^\/api\/baskets\/versions\/(\d+)\/items$/.exec(pathname);
  if (method === 'PATCH' && basketPatchMatch) {
    const ver = demoState.basketVersions.find((v) => v.id === Number(basketPatchMatch[1]));
    if (!ver) throw new Error('Versão da Cesta não encontrada.');
    const itemsInput = Array.isArray(body.items) ? body.items : [];
    ver.items = itemsInput.map((it: any) => {
      const code = it.materialCode ? String(it.materialCode).trim().toUpperCase() : null;
      const mat = code ? demoState.materials.find((m) => m.code.toUpperCase() === code) : undefined;
      const qtyKg =
        it.plannedQuantityKg !== undefined && it.plannedQuantityKg !== null
          ? Number(it.plannedQuantityKg)
          : convertRawQuantityToKg(it.rawQuantityText, it.unit || 'kg');
      const stillPending = Boolean(it.needsReview) || qtyKg === null || !code;
      return {
        id: it.id || ++nextSeqId,
        basketVersionId: ver.id,
        productionDate: ver.productionDate,
        lineCode: normalizeLineCode(it.lineCode || 'L1'),
        materialId: mat?.id ?? null,
        materialCode: code,
        materialDescription: String(it.materialDescription || mat?.description || 'Não identificado'),
        rawQuantityText: it.rawQuantityText ?? (qtyKg !== null ? String(qtyKg) : null),
        plannedQuantityKg: qtyKg,
        unit: it.unit || 'kg',
        sourcePage: it.sourcePage || 1,
        sourceDocumentName: it.sourceDocumentName || null,
        sourceRegion: 'Conferência manual [DEMO]',
        confidence: stillPending ? 'MEDIA' : 'ALTA',
        needsReview: stillPending,
        reviewReason: stillPending ? it.reviewReason || 'Conferência pendente' : null,
        manuallyEdited: true,
        editedByName: demoState.session.user.displayName,
      };
    });
    ver.status = ver.items.some((i) => i.needsReview) ? 'RASCUNHO' : 'CONFERIDA';
    return ver as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/baskets/compare') {
    const baseVer = demoState.basketVersions.find((v) => v.id === Number(body.baseVersionId));
    const targetVer = demoState.basketVersions.find((v) => v.id === Number(body.targetVersionId));
    if (!baseVer || !targetVer) throw new Error('Versões selecionadas não encontradas.');
    const cmpId = ++nextSeqId;
    const pendingMap = new Map<number, number>();
    for (const r of demoState.receipts) {
      if ((r.status === 'PENDENTE' || r.status === 'PARCIAL') && r.remainingQuantityKg > 0) {
        pendingMap.set(r.materialId, (pendingMap.get(r.materialId) || 0) + r.remainingQuantityKg);
      }
    }
    const cmp = compareBasketVersions({
      comparisonId: cmpId,
      comparisonCode: `CMP-${targetVer.productionDate.replace(/-/g, '')}-${cmpId}`,
      productionDate: targetVer.productionDate,
      baseVersion: { id: baseVer.id, label: baseVer.label, emissionTime: baseVer.emissionTime },
      targetVersion: { id: targetVer.id, label: targetVer.label, emissionTime: targetVer.emissionTime },
      baseItems: baseVer.items,
      targetItems: targetVer.items,
      silos: demoState.silos,
      materials: demoState.materials,
      transferRules: demoState.transferRules,
      pendingReceiptsKgByMaterial: pendingMap,
      createdByName: demoState.session.user.displayName,
    });
    demoState.basketComparisons.unshift(cmp);
    return cmp as unknown as T;
  }

  if (method === 'POST' && pathname === '/api/baskets/publish') {
    const cmp = demoState.basketComparisons.find((c) => c.id === Number(body.comparisonId));
    if (!cmp) throw new Error('Comparação não encontrada.');
    const nowIso = new Date().toISOString();
    for (const v of demoState.basketVersions) {
      if (v.productionDate === cmp.productionDate && v.isCurrentPublished) {
        v.isCurrentPublished = false;
        v.status = 'ARQUIVADA';
      }
    }
    const targetVer = demoState.basketVersions.find((v) => v.id === cmp.targetVersionId);
    if (targetVer) {
      targetVer.status = 'PUBLICADA';
      targetVer.isCurrentPublished = true;
      targetVer.publishedByName = demoState.session.user.displayName;
      targetVer.publishedAt = nowIso;
    }
    cmp.status = 'PUBLICADA';
    cmp.publishedByName = demoState.session.user.displayName;
    cmp.publishedAt = nowIso;

    const notif: BasketNotificationEvent = {
      type: 'basket:published',
      comparisonId: cmp.id,
      comparisonCode: cmp.comparisonCode,
      productionDate: cmp.productionDate,
      baseVersionLabel: cmp.baseVersionLabel,
      targetVersionLabel: cmp.targetVersionLabel,
      totalDiffKg: cmp.totalDiffKg,
      criticalImpactsCount: cmp.operationalImpacts.filter(
        (o) => o.shortageRisk === 'CRITICO' || o.shortageRisk === 'SEM_SILO_COMPATIVEL'
      ).length,
      publishedByName: demoState.session.user.displayName,
      publishedAt: nowIso,
      summaryHighlights: cmp.diffItems
        .filter((d) => d.classification !== 'MANTIDO')
        .slice(0, 4)
        .map(
          (d) =>
            `${d.lineCode} · ${d.materialDescription}: ${formatBrazilianDiff(d.diffKg)} kg (${d.classification})`
        ),
    };

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('nexo:basket-published', { detail: notif }));
    }

    pushDemoAudit('BASKET_PUBLISHED_DEMO', 'BASKET_COMPARISON', cmp.comparisonCode, 'Publicação simulada no Sandbox', {
      totalNewKg: cmp.totalNewKg,
      totalDiffKg: cmp.totalDiffKg,
    });
    return { comparison: cmp, notification: notif } as unknown as T;
  }

  void params;
  return {} as T;
}

export async function handleDemoReportDownload(
  path: string,
  init: RequestInit = {},
  fallbackFilename: string = 'relatorio-demo-nexo-log'
): Promise<string> {
  const body = parseJsonBody(init);
  if (path.includes('/api/baskets/export')) {
    const cmp =
      demoState.basketComparisons.find((c) => c.id === Number(body.comparisonId)) ||
      demoState.basketComparisons[0];
    const format = String(body.format || 'CSV').toUpperCase();
    const safeName = `nexo-log-comparador-cestas-${cmp?.productionDate || 'demo'}-DEMO.${
      format === 'PDF' ? 'txt' : 'csv'
    }`;
    const lines = [
      '\uFEFFNEXO LOG 2.0 — COMPARADOR DE CESTAS DE CONSUMO [DEMO]',
      `Data Producao;${cmp?.productionDate || '—'}`,
      `Base;${cmp?.baseVersionLabel || '—'}`,
      `Atualizada;${cmp?.targetVersionLabel || '—'}`,
      `Total Anterior (kg);${formatBrazilianNumber(cmp?.totalPreviousKg, 2)}`,
      `Total Novo (kg);${formatBrazilianNumber(cmp?.totalNewKg, 2)}`,
      `Diferenca (kg);${formatBrazilianDiff(cmp?.totalDiffKg)}`,
      '',
      'Linha;Codigo;Materia-Prima;Planejado Anterior (kg);Planejado Novo (kg);Diferenca (kg);Variacao %;Classificacao',
      ...(cmp?.diffItems || []).map(
        (d) =>
          `${d.lineCode};${d.materialCode || ''};"${d.materialDescription}";${formatBrazilianNumber(
            d.previousQuantityKg,
            2
          )};${formatBrazilianNumber(d.newQuantityKg, 2)};${formatBrazilianDiff(d.diffKg)};${
            d.pctChange ?? ''
          };${d.classification}`
      ),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return safeName;
  }

  const reportType = String(body.reportType || 'INDICADORES').toUpperCase();
  const format = String(body.format || 'CSV').toUpperCase();
  const filters = (body.filters || {}) as ReportFilterParams;
  const safeName = `${fallbackFilename}-${reportType.toLowerCase()}-DEMO.${format === 'PDF' ? 'txt' : 'csv'}`;

  const overview = buildDemoReportsOverview(demoState, filters);
  const lines: string[] = [
    '\uFEFFNEXO LOG 2.0 — MODO APRESENTACAO EXECUTIVA',
    `VISAO ATIVA;${demoState.viewMode}`,
    `ORIGEM;${overview.dataOrigin}`,
    `Tipo de Relatorio;${reportType}`,
    `Periodo;${overview.periodStart} a ${overview.periodEnd}`,
    `Data Geracao;${new Date().toLocaleString('pt-BR')}`,
    '',
  ];

  if (reportType === 'CONSUMO') {
    const cons = buildDemoConsumptionReport(demoState, filters);
    lines.push(
      `Consumo Previsto (kg);${cons.totals.plannedConsumptionKg}`,
      `Consumo Realizado (kg);${cons.totals.realizedConsumptionKg ?? 0}`,
      `Variacao (kg);${cons.totals.varianceKg ?? 0}`,
      `Itens Fator Pendente;${cons.totals.pendingFactorCount}`,
      '',
      'Data;Linha;Programacao;Produto;Materia-Prima;Previsto (kg);Realizado (kg);Variacao (kg);Estoque Atual (kg);Saldo Projetado (kg);Status Calculo'
    );
    for (const r of cons.rows) {
      lines.push(
        `${r.referenceDate};${r.lineCode};${r.scheduleCode};${r.productCode};"${r.materialDescription || ''}";${r.plannedConsumptionKg};${r.realizedConsumptionKg ?? ''};${r.varianceKg ?? ''};${r.realStockKg};${r.projectedBalanceKg};${r.calculationStatus}`
      );
    }
  } else if (reportType === 'RECEBIMENTOS') {
    const rec = buildDemoReceivingReport(demoState, filters);
    lines.push(
      `Recebimentos;${rec.totals.count}`,
      `Volume Recebido (kg);${rec.totals.receivedKg}`,
      `Volume Descarregado (kg);${rec.totals.distributedKg}`,
      `Saldo Pendente (kg);${rec.totals.pendingKg}`,
      '',
      'Numero;Data;Turno;Fornecedor;NF;Lote;Material;Recebido (kg);Descarregado (kg);Pendente (kg);Silos;Status'
    );
    for (const r of rec.rows) {
      lines.push(
        `${r.receiptNumber};${r.operationalDate};${r.shiftCode};"${r.supplierName}";"${r.invoiceNumber || ''}";${r.lotCode};"${r.materialDescription}";${r.receivedQuantityKg};${r.distributedQuantityKg};${r.pendingQuantityKg};"${r.destinationSilosText}";${r.status}`
      );
    }
  } else if (reportType === 'TRANSFERENCIAS') {
    const trf = buildDemoTransfersReport(demoState, filters);
    lines.push(
      `Ordens;${trf.totals.count}`,
      `Planejado (kg);${trf.totals.plannedKg}`,
      `Transferido (kg);${trf.totals.transferredKg}`,
      `Pendente (kg);${trf.totals.pendingKg}`,
      '',
      'Ordem;Data;Turno;Material;Origem;Destino;Linha;Planejado (kg);Transferido (kg);Pendente (kg);Status;Rota'
    );
    for (const r of trf.rows) {
      lines.push(
        `${r.orderCode};${r.operationalDate};${r.shiftCode};"${r.materialDescription}";${r.originSiloNumber || ''};${r.destinationSiloNumber || ''};${r.lineCode || ''};${r.plannedQuantityKg};${r.transferredQuantityKg};${r.pendingQuantityKg};${r.status};${r.routeStatus}`
      );
    }
  } else {
    const stock = buildDemoStockReport(demoState, filters);
    lines.push(
      `Estoque Total (kg);${overview.indicators.totalConfirmedStockKg}`,
      `Silos Ocupados;${overview.indicators.occupiedSilosCount}/${overview.indicators.totalSilosCount}`,
      `Consumo Previsto (kg);${overview.performanceKpis.plannedConsumptionKg}`,
      `Consumo Realizado (kg);${overview.performanceKpis.realizedConsumptionKg ?? 0}`,
      `Alertas Operacionais Ativos;${overview.indicators.activeAlertsCount}`,
      '',
      'Silo;Categoria;Linha;Materia-Prima;Lotes;Estoque (kg);Cap Segura (kg);Ocupacao %;Entradas (kg);Consumo (kg);Status'
    );
    for (const row of stock.currentRows) {
      lines.push(
        `${row.siloNumber};${row.category};${row.lineCode};"${row.materialDescription || ''}";"${row.activeLotsText}";${row.confirmedStockKg};${row.safeCapacityKg};${row.occupancyPercent};${row.inboundPeriodKg};${row.outboundPeriodKg};${row.operationalStatus}`
      );
    }
  }

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return safeName;
}
