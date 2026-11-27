import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  capLabelPreviewDataUrl,
  MAX_ATTACHMENT_BYTES,
  MAX_PERSISTED_LABEL_PREVIEW_CHARS,
  MAX_RECEIPT_ATTACHMENTS,
  sanitizePresentationBootstrapData,
  validateAudioUploadPayload,
  validateImageUploadPayload,
  validateReceiptAttachments,
} from '../src/lib/security-utils.ts';
import { handleDemoApiFetch, resetDemoSandboxState } from '../src/lib/demo-api.ts';
import { createInitialDemoState } from '../src/lib/demo-data.ts';
import type { GeminiPhotoParseResponse, ReceiptItem } from '../src/types/nexo.ts';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;
const TINY_PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF').toString('base64')}`;

describe('Auditoria Técnica & Remediação — Segurança, Anexos, Leitura de Etiquetas e Sanitização', () => {
  beforeEach(() => {
    resetDemoSandboxState();
  });

  it('1. Valida anexos de recebimento (aceita imagem e PDF válidos; bloqueia MIME inválido, excesso de tamanho e quantidade)', () => {
    const valid = validateReceiptAttachments([
      {
        id: 'att-1',
        name: 'foto-carga.png',
        mimeType: 'image/png',
        kind: 'FOTO_CARGA',
        dataUrl: TINY_PNG_DATA_URL,
      },
      {
        id: 'att-2',
        name: 'nf-12345.pdf',
        mimeType: 'application/pdf',
        kind: 'NOTA_FISCAL',
        dataUrl: TINY_PDF_DATA_URL,
      },
    ]);
    assert.equal(valid.valid, true);
    if (valid.valid) {
      assert.equal(valid.items.length, 2);
      assert.equal(valid.items[0].kind, 'FOTO_CARGA');
      assert.equal(valid.items[1].kind, 'NOTA_FISCAL');
    }

    const badMime = validateReceiptAttachments([
      {
        name: 'payload.svg',
        mimeType: 'image/svg+xml',
        kind: 'DOCUMENTO',
        dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg></svg>').toString('base64')}`,
      },
    ]);
    assert.equal(badMime.valid, false);

    const oversizedB64 = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1024, 65).toString('base64');
    const tooBig = validateReceiptAttachments([
      {
        name: 'grande.png',
        mimeType: 'image/png',
        kind: 'FOTO_CARGA',
        dataUrl: `data:image/png;base64,${oversizedB64}`,
      },
    ]);
    assert.equal(tooBig.valid, false);

    const tooMany = validateReceiptAttachments(
      Array.from({ length: MAX_RECEIPT_ATTACHMENTS + 1 }, (_, i) => ({
        id: `att-${i}`,
        name: `img-${i}.png`,
        mimeType: 'image/png',
        kind: 'FOTO_CARGA',
        dataUrl: TINY_PNG_DATA_URL,
      }))
    );
    assert.equal(tooMany.valid, false);
  });

  it('2. Valida payloads de imagem, áudio e truncamento de miniatura em label_scans', () => {
    const imgOk = validateImageUploadPayload({
      base64: TINY_PNG_DATA_URL,
      mimeType: 'image/png',
    });
    assert.equal(imgOk.valid, true);

    const imgSim = validateImageUploadPayload({
      base64: 'DEMO_SIMULATED_LABEL',
      mimeType: 'image/jpeg',
    });
    assert.equal(imgSim.valid, false);

    const imgSvg = validateImageUploadPayload({
      base64: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      mimeType: 'image/svg+xml',
    });
    assert.equal(imgSvg.valid, false);

    const audioOk = validateAudioUploadPayload({
      base64: Buffer.from('WEBM_FAKE_BYTES').toString('base64'),
      mimeType: 'audio/webm;codecs=opus',
    });
    assert.equal(audioOk.valid, true);

    const audioBad = validateAudioUploadPayload({
      base64: Buffer.from('EXE').toString('base64'),
      mimeType: 'application/octet-stream',
    });
    assert.equal(audioBad.valid, false);

    assert.equal(capLabelPreviewDataUrl(TINY_PNG_BASE64, 'image/png'), TINY_PNG_DATA_URL);
    const hugeDataUrl = `data:image/jpeg;base64,${'A'.repeat(MAX_PERSISTED_LABEL_PREVIEW_CHARS + 100)}`;
    assert.equal(capLabelPreviewDataUrl(hugeDataUrl, 'image/jpeg'), null);
  });

  it('3. Sanitiza PII (crachás, nomes de operadores/motoristas, placas, e-mails e Data URLs) no bootstrap público da Apresentação', () => {
    const sanitized = sanitizePresentationBootstrapData({
      shifts: [
        {
          id: 1,
          code: 'TURNO_1',
          supervisorUserId: 99,
          supervisorName: 'Carlos Alberto Supervisor',
          responsibleName: 'Maria Clara Resp',
          operatorIds: [12, 13],
          operators: [{ id: 12, displayName: 'João Pedro Operador', badgeCode: 'MAT-9901', roleCode: 'OPERADOR_MOEGA' }],
        },
      ],
      routes: [
        {
          id: 1,
          approvedByName: 'Supervisor Real',
          updatedByName: 'Admin Real',
          history: [{ id: 1, userId: 10, userEmail: 'sigilo@empresa.com.br', userName: 'Admin Real', userRole: 'ADMIN' }],
        },
      ],
      receipts: [
        {
          id: 1,
          operatorUserId: 12,
          operatorName: 'João Pedro Operador',
          operatorBadge: 'MAT-9901',
          executedByName: 'José Executor',
          executedByBadge: 'MAT-7788',
          driverName: 'Antônio Motorista',
          vehiclePlate: 'ABC-1D23',
          attachments: [
            { id: 'a1', name: 'foto.png', mimeType: 'image/png', kind: 'FOTO_CARGA', sizeBytes: 68, dataUrl: TINY_PNG_DATA_URL, capturedAtIso: '2026-11-27T00:00:00Z' },
          ],
          distributions: [
            { id: 1, operatorName: 'João Pedro Operador', operatorBadge: 'MAT-9901', executedByName: 'José Executor', executedByBadge: 'MAT-7788' },
          ],
        },
      ],
      movements: [{ id: 1, operatorName: 'João Pedro Operador', operatorBadge: 'MAT-9901', executedByName: 'José Executor', executedByBadge: 'MAT-7788' }],
      transferOrders: [
        {
          id: 1,
          requestedByName: 'Planejador Real',
          approvedByName: 'Supervisor Real',
          assignedOperatorName: 'João Pedro Operador',
          interruptedByName: 'João Pedro Operador',
          steps: [{ id: 1, executedByName: 'João Pedro Operador', executedByBadge: 'MAT-9901' }],
        },
      ],
      schedules: [{ id: 1, importedByName: 'Planejador Real', approvedByName: 'Supervisor Real' }],
      occurrences: [{ id: 1, reportedByUserId: 12, reportedByName: 'João Pedro Operador', reportedByBadge: 'MAT-9901', executedByName: 'José', executedByBadge: 'MAT-7788', assignedToUserId: 99, assignedToName: 'Carlos', verifiedByName: 'Carlos', closedByName: 'Carlos' }],
      handovers: [
        {
          id: 1,
          handoverByUserId: 12,
          handoverByName: 'João Pedro Operador',
          handoverByBadge: 'MAT-9901',
          receivedByUserId: 15,
          receivedByName: 'Marcos Turno 2',
          reviewedByName: 'Carlos',
          approvedByName: 'Carlos',
          finalizedByName: 'João',
          autoSummary: { shiftOperators: [{ displayName: 'João' }], shiftOccurrences: [{ verifiedByName: 'Carlos', reportedByName: 'João' }] },
          revisions: [{ id: 1, editedByUserId: 12, editedByName: 'João', editedByBadge: 'MAT-9901' }],
        },
      ],
      recentSnapshots: [{ id: 1, generatedByName: 'Admin Real' }],
    });

    const json = JSON.stringify(sanitized);
    for (const leaked of [
      'João Pedro',
      'MAT-9901',
      'MAT-7788',
      'sigilo@empresa.com.br',
      'Antônio Motorista',
      'ABC-1D23',
      'Carlos Alberto',
      TINY_PNG_BASE64,
    ]) {
      assert.equal(json.includes(leaked), false, `Vazamento detectado no bootstrap público: ${leaked}`);
    }
    assert.equal(sanitized.receipts[0].attachments[0].dataUrl, '');
  });

  it('4. Fluxo Demo de leitura por foto retorna prévia da etiqueta e persistência de anexos no recebimento + complemento', async () => {
    const photoRes = await handleDemoApiFetch<GeminiPhotoParseResponse>('/api/labels/interpret-photo', {
      method: 'POST',
      body: JSON.stringify({
        imageBase64: 'DEMO_SIMULATED_LABEL',
        mimeType: 'image/jpeg',
        demoSampleKey: 'UREIA_BIGBAG_NOVO',
      }),
    });
    assert.ok(photoRes.sourceImageDataUrl?.startsWith('data:image/svg+xml'));
    assert.equal(photoRes.extraction.materialCode, '1620101010');

    const state = createInitialDemoState();
    const targetSilo = state.silos.find(
      (s) => s.operationalStatus === 'OPERACIONAL' && s.primaryMaterialId && s.availableSpaceKg >= 2000
    )!;

    const created = await handleDemoApiFetch<{ receipt: ReceiptItem }>('/api/receipts', {
      method: 'POST',
      body: JSON.stringify({
        materialId: targetSilo.primaryMaterialId,
        supplierName: 'FORNECEDOR AUDITORIA',
        lotCode: 'LOTE-AUD-01',
        receivingType: 'GRANEL',
        receivedQuantityKg: 2000,
        attachments: [
          {
            id: 'att-rec-1',
            name: 'foto-caminhao.png',
            mimeType: 'image/png',
            kind: 'FOTO_CARGA',
            dataUrl: TINY_PNG_DATA_URL,
          },
        ],
        distributions: [{ siloId: targetSilo.id, quantityKg: 1000 }],
      }),
    });
    assert.equal(created.receipt.status, 'PARCIAL');
    assert.equal(created.receipt.attachments?.length, 1);

    const comp = await handleDemoApiFetch<{ receipt: ReceiptItem }>(
      `/api/receipts/${created.receipt.id}/distribute`,
      {
        method: 'POST',
        body: JSON.stringify({
          distributions: [{ siloId: targetSilo.id, quantityKg: 1000 }],
          attachments: [
            {
              id: 'att-rec-2',
              name: 'nf-complemento.pdf',
              mimeType: 'application/pdf',
              kind: 'NOTA_FISCAL',
              dataUrl: TINY_PDF_DATA_URL,
            },
          ],
        }),
      }
    );
    assert.equal(comp.receipt.status, 'CONCLUIDO');
    assert.equal(comp.receipt.attachments?.length, 2);

    await assert.rejects(
      () =>
        handleDemoApiFetch('/api/receipts', {
          method: 'POST',
          body: JSON.stringify({
            materialId: targetSilo.primaryMaterialId,
            supplierName: 'FORNECEDOR',
            lotCode: 'LOTE-BAD',
            receivingType: 'GRANEL',
            receivedQuantityKg: 500,
            attachments: [
              {
                name: 'script.svg',
                mimeType: 'image/svg+xml',
                kind: 'DOCUMENTO',
                dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
              },
            ],
            distributions: [],
          }),
        }),
      /não permitido/i
    );
  });

  it('5. Confirma presença de prévia lado a lado no scanner, upload de anexos no recebimento e descrição fiel do perfil Operador Moega', () => {
    const scannerCode = fs.readFileSync(
      path.join(process.cwd(), 'src/components/labels/LabelScannerWidget.tsx'),
      'utf8'
    );
    assert.ok(scannerCode.includes('Fotografia Original da Etiqueta'));
    assert.ok(scannerCode.includes('previewDataUrl'));

    const receivingCode = fs.readFileSync(
      path.join(process.cwd(), 'src/pages/ReceivingPage.tsx'),
      'utf8'
    );
    assert.ok(receivingCode.includes('Fotografias & Documentos da Carga'));
    assert.ok(receivingCode.includes('previewAttachment'));

    const adminCode = fs.readFileSync(
      path.join(process.cwd(), 'src/pages/AdminPage.tsx'),
      'utf8'
    );
    assert.ok(adminCode.includes('Registro de recebimentos, leitura de etiquetas, transferências autorizadas'));
  });
});
