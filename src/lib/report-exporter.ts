import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

export type ExportFormat = 'PDF' | 'XLSX' | 'CSV';

export interface ExportColumnDef {
  key: string;
  header: string;
  width?: number;
  align?: 'left' | 'right';
}

export interface ExportDocumentInput {
  format: ExportFormat;
  reportTitle: string;
  reportType: string;
  periodLabel: string;
  filtersSummary: string;
  dataOrigin: string;
  generatedByName: string;
  generatedByRole: string;
  generatedAtIso: string;
  columns: ExportColumnDef[];
  rows: Array<Record<string, string | number | null | undefined>>;
  totalsSummary?: Array<{ label: string; value: string }>;
}

export interface ExportDocumentOutput {
  buffer: Buffer;
  mimeType: string;
  fileExtension: string;
  fileName: string;
}

function sanitizeFilename(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function formatCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

async function generateCsvBuffer(input: ExportDocumentInput): Promise<Buffer> {
  const lines: string[] = [];
  lines.push(`${formatCsvCell('NEXO LOG 2.0 — SISTEMA OPERACIONAL DA MOEGA')}`);
  lines.push(`${formatCsvCell('Relatório')};${formatCsvCell(input.reportTitle)}`);
  lines.push(`${formatCsvCell('Período')};${formatCsvCell(input.periodLabel)}`);
  lines.push(`${formatCsvCell('Gerado em')};${formatCsvCell(input.generatedAtIso)}`);
  lines.push(
    `${formatCsvCell('Responsável')};${formatCsvCell(`${input.generatedByName} (${input.generatedByRole})`)}`
  );
  lines.push(`${formatCsvCell('Filtros aplicados')};${formatCsvCell(input.filtersSummary)}`);
  lines.push(`${formatCsvCell('Origem dos dados')};${formatCsvCell(input.dataOrigin)}`);
  lines.push('');
  lines.push(input.columns.map((c) => formatCsvCell(c.header)).join(';'));

  for (const row of input.rows) {
    lines.push(input.columns.map((c) => formatCsvCell(row[c.key] ?? '')).join(';'));
  }

  if (input.totalsSummary && input.totalsSummary.length > 0) {
    lines.push('');
    lines.push(`${formatCsvCell('TOTAIS / SUBTOTAIS')};${formatCsvCell('')}`);
    for (const t of input.totalsSummary) {
      lines.push(`${formatCsvCell(t.label)};${formatCsvCell(t.value)}`);
    }
  }

  // BOM UTF-8 para abertura imediata no Excel em pt-BR
  return Buffer.from('\uFEFF' + lines.join('\n'), 'utf8');
}

async function generateXlsxBuffer(input: ExportDocumentInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NEXO LOG 2.0';
  workbook.created = new Date(input.generatedAtIso);

  const sheet = workbook.addWorksheet('Relatório', {
    views: [{ state: 'frozen', ySplit: 8 }],
  });

  // Cabeçalho institucional NEXO LOG 2.0
  sheet.addRow(['NEXO LOG 2.0 — GESTÃO OPERACIONAL DA MOEGA']);
  sheet.addRow(['Relatório:', input.reportTitle]);
  sheet.addRow(['Período:', input.periodLabel]);
  sheet.addRow(['Gerado em:', input.generatedAtIso, 'Responsável:', `${input.generatedByName} (${input.generatedByRole})`]);
  sheet.addRow(['Filtros aplicados:', input.filtersSummary]);
  sheet.addRow(['Origem dos dados:', input.dataOrigin]);
  sheet.addRow([]);

  sheet.getRow(1).font = { bold: true, size: 13, color: { argb: 'FF0A1421' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF5B817' },
  };

  const headerRow = sheet.addRow(input.columns.map((c) => c.header));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF102235' },
  };

  for (const row of input.rows) {
    const added = sheet.addRow(input.columns.map((c) => row[c.key] ?? ''));
    added.alignment = { vertical: 'middle' };
  }

  if (input.totalsSummary && input.totalsSummary.length > 0) {
    sheet.addRow([]);
    const totalTitle = sheet.addRow(['TOTAIS / SUBTOTAIS']);
    totalTitle.font = { bold: true, color: { argb: 'FF102235' } };
    for (const t of input.totalsSummary) {
      const r = sheet.addRow([t.label, t.value]);
      r.font = { bold: true };
    }
  }

  input.columns.forEach((col, idx) => {
    const sheetCol = sheet.getColumn(idx + 1);
    sheetCol.width = col.width || Math.max(16, col.header.length + 4);
  });

  const arrayBuf = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

async function generatePdfBuffer(input: ExportDocumentInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 32,
      info: {
        Title: `NEXO LOG 2.0 — ${input.reportTitle}`,
        Author: input.generatedByName,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const pageWidth = doc.page.width - 64;

    // Banner NEXO LOG 2.0
    doc.rect(32, 28, pageWidth, 44).fill('#081321');
    doc
      .fillColor('#F5B817')
      .font('Helvetica-Bold')
      .fontSize(14)
      .text('NEXO LOG 2.0', 44, 38, { continued: true })
      .fillColor('#FFFFFF')
      .fontSize(12)
      .text(`  —  ${input.reportTitle}`);

    doc
      .fillColor('#CBD5E1')
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Período: ${input.periodLabel}   |   Gerado em: ${new Date(input.generatedAtIso).toLocaleString('pt-BR')}   |   Usuário: ${input.generatedByName} (${input.generatedByRole})`, 44, 56);

    doc.y = 82;
    doc
      .fillColor('#1E293B')
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Filtros aplicados: ${input.filtersSummary}`, 32, doc.y);
    doc.text(`Origem dos dados: ${input.dataOrigin}`, 32, doc.y + 2);
    doc.moveDown(0.7);

    // Table column layout
    const colCount = Math.max(1, input.columns.length);
    const totalRequested = input.columns.reduce((acc, c) => acc + (c.width || 16), 0);
    const colWidths = input.columns.map((c) => ((c.width || 16) / totalRequested) * pageWidth);

    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(32, y, pageWidth, 20).fill('#102235');
      let x = 32;
      input.columns.forEach((col, i) => {
        doc
          .fillColor('#F5B817')
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text(col.header, x + 4, y + 6, {
            width: Math.max(20, colWidths[i] - 8),
            align: col.align || 'left',
            ellipsis: true,
            lineBreak: false,
          });
        x += colWidths[i];
      });
      doc.y = y + 22;
    };

    drawTableHeader();

    if (input.rows.length === 0) {
      doc
        .fillColor('#475569')
        .font('Helvetica-Oblique')
        .fontSize(9)
        .text('Nenhum registro encontrado para o período e filtros selecionados.', 32, doc.y + 8);
      doc.moveDown(1.5);
    } else {
      input.rows.forEach((row, rowIdx) => {
        if (doc.y > doc.page.height - 80) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 32 });
          drawTableHeader();
        }
        const y = doc.y;
        const rowH = 18;
        if (rowIdx % 2 === 1) {
          doc.rect(32, y, pageWidth, rowH).fill('#F8FAFC');
        }
        let x = 32;
        input.columns.forEach((col, i) => {
          const val = row[col.key] === null || row[col.key] === undefined ? '' : String(row[col.key]);
          doc
            .fillColor('#0F172A')
            .font('Helvetica')
            .fontSize(7.5)
            .text(val, x + 4, y + 5, {
              width: Math.max(20, colWidths[i] - 8),
              align: col.align || 'left',
              ellipsis: true,
              lineBreak: false,
            });
          x += colWidths[i];
        });
        doc
          .strokeColor('#E2E8F0')
          .lineWidth(0.5)
          .moveTo(32, y + rowH)
          .lineTo(32 + pageWidth, y + rowH)
          .stroke();
        doc.y = y + rowH + 1;
      });
    }

    if (input.totalsSummary && input.totalsSummary.length > 0) {
      if (doc.y > doc.page.height - 95) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 32 });
      }
      doc.moveDown(0.7);
      const boxY = doc.y;
      const boxHeight = 20 + input.totalsSummary.length * 14;
      doc.rect(32, boxY, pageWidth, boxHeight).fill('#F1F5F9');
      doc
        .fillColor('#081321')
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text('TOTAIS / SUBTOTAIS', 40, boxY + 6);
      let lineY = boxY + 20;
      for (const item of input.totalsSummary) {
        doc
          .fillColor('#1E293B')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(`${item.label}: `, 40, lineY, { continued: true })
          .font('Helvetica')
          .text(item.value);
        lineY += 13;
      }
      doc.y = boxY + boxHeight + 10;
    }

    // Footer
    doc
      .fillColor('#64748B')
      .font('Helvetica')
      .fontSize(7)
      .text(
        `Documento emitido pelo NEXO LOG 2.0 (${colCount} colunas) · Registro auditado automaticamente.`,
        32,
        doc.page.height - 26
      );

    doc.end();
  });
}

export async function exportReportDocument(input: ExportDocumentInput): Promise<ExportDocumentOutput> {
  const dateTag = input.generatedAtIso.slice(0, 10);
  const baseName = `nexo-log-${sanitizeFilename(input.reportType)}-${dateTag}`;

  if (input.format === 'PDF') {
    const buffer = await generatePdfBuffer(input);
    return {
      buffer,
      mimeType: 'application/pdf',
      fileExtension: 'pdf',
      fileName: `${baseName}.pdf`,
    };
  }

  if (input.format === 'XLSX') {
    const buffer = await generateXlsxBuffer(input);
    return {
      buffer,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileExtension: 'xlsx',
      fileName: `${baseName}.xlsx`,
    };
  }

  const buffer = await generateCsvBuffer(input);
  return {
    buffer,
    mimeType: 'text/csv; charset=utf-8',
    fileExtension: 'csv',
    fileName: `${baseName}.csv`,
  };
}
