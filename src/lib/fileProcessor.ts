import JSZip from 'jszip';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { AttachmentKind, MessageAttachment } from '../types/chat';
import { DEFAULT_UPLOAD_LIMITS } from './models';

export const ACCEPTED_FILE_EXTENSIONS =
  '.pdf,.docx,.doc,.xlsx,.xls,.csv,.pptx,.txt,.md,.json,.log,.png,.jpg,.jpeg,.webp';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `att-${crypto.randomUUID()}`;
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx === -1 ? '' : fileName.slice(idx + 1).toLowerCase();
}

function truncateText(
  text: string,
  maxChars: number
): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }
  return {
    text: normalized.slice(0, maxChars).trimEnd(),
    truncated: true,
  };
}

function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function rowsToMarkdownTable(rows: unknown[][], maxRows = 60, maxCols = 16): string {
  if (rows.length === 0) return '(empty sheet)';
  const slicedRows = rows.slice(0, maxRows);
  const colCount = Math.min(
    maxCols,
    Math.max(...slicedRows.map((r) => (Array.isArray(r) ? r.length : 0)), 1)
  );

  const formatRow = (r: unknown[]) =>
    `| ${Array.from({ length: colCount }, (_, c) => sanitizeCell(r?.[c])).join(' | ')} |`;

  const header = formatRow(slicedRows[0] ?? []);
  const divider = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;
  const body = slicedRows.slice(1).map((r) => formatRow(r));
  const extraNote =
    rows.length > maxRows ? `\n... (${rows.length - maxRows} additional rows omitted)` : '';

  return [header, divider, ...body].join('\n') + extraNote;
}

export function extractCsvSummary(
  csvText: string,
  maxChars: number = DEFAULT_UPLOAD_LIMITS.maxExtractedCharsPerFile
): { text: string; rowCount: number; truncated: boolean } {
  const rows = parseCsvRows(csvText);
  const table = rowsToMarkdownTable(rows, 80, 18);
  const headerInfo = `CSV Rows: ${rows.length} · Columns: ${rows[0]?.length ?? 0}\n\n${table}`;
  const clipped = truncateText(headerInfo, maxChars);
  return { text: clipped.text, rowCount: rows.length, truncated: clipped.truncated };
}

export function extractXlsxWorkbookFromBuffer(
  buffer: ArrayBuffer,
  maxChars: number = DEFAULT_UPLOAD_LIMITS.maxExtractedCharsPerFile
): {
  text: string;
  sheetNames: string[];
  totalRows: number;
  truncated: boolean;
} {
  const workbook = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    dense: true,
    WTF: false,
  });

  const safeSheetNames = (workbook.SheetNames ?? []).filter(
    (name) => typeof name === 'string' && !UNSAFE_KEYS.has(name)
  );
  const sheetSections: string[] = [];
  let totalRows = 0;

  for (const sheetName of safeSheetNames.slice(0, 12)) {
    const sheet = Object.prototype.hasOwnProperty.call(workbook.Sheets, sheetName)
      ? workbook.Sheets[sheetName]
      : undefined;
    if (!sheet) continue;

    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });
    const cleanRows = rawRows.filter(
      (r) => Array.isArray(r) && r.some((cell) => String(cell ?? '').trim().length > 0)
    );
    totalRows += cleanRows.length;
    const cols = cleanRows[0]?.length ?? 0;
    const table = rowsToMarkdownTable(cleanRows, 50, 14);
    sheetSections.push(
      `### Worksheet: ${sheetName} (${cleanRows.length} rows, ${cols} columns)\n${table}`
    );
  }

  if (safeSheetNames.length > 12) {
    sheetSections.push(`... (${safeSheetNames.length - 12} additional worksheets omitted)`);
  }

  const combined =
    sheetSections.length > 0
      ? sheetSections.join('\n\n')
      : 'No readable worksheet cells found.';
  const clipped = truncateText(combined, maxChars);
  return {
    text: clipped.text,
    sheetNames: safeSheetNames,
    totalRows,
    truncated: clipped.truncated,
  };
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function extractXmlTextRuns(xml: string): string {
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'application/xml');
      const paragraphs = Array.from(doc.getElementsByTagName('a:p'));
      if (paragraphs.length > 0) {
        const lines: string[] = [];
        for (const p of paragraphs) {
          const texts = Array.from(p.getElementsByTagName('a:t'))
            .map((node) => node.textContent ?? '')
            .join('');
          if (texts.trim()) lines.push(texts.trim());
        }
        if (lines.length > 0) return lines.join('\n');
      }
      const runs = Array.from(doc.getElementsByTagName('a:t'))
        .map((node) => node.textContent?.trim() ?? '')
        .filter(Boolean);
      if (runs.length > 0) return runs.join(' ');
    } catch {
      // Fallback to regex extraction below
    }
  }

  const runs: string[] = [];
  const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const cleaned = decodeXmlEntities(match[1]).trim();
    if (cleaned) runs.push(cleaned);
  }
  return runs.join(' ');
}

export async function extractPptxSlidesFromBuffer(
  buffer: ArrayBuffer,
  maxChars: number = DEFAULT_UPLOAD_LIMITS.maxExtractedCharsPerFile
): Promise<{ text: string; slideCount: number; truncated: boolean }> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/i.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return na - nb;
    });

  if (slidePaths.length === 0) {
    return {
      text: 'No slide text found in this PowerPoint deck.',
      slideCount: 0,
      truncated: false,
    };
  }

  const sections: string[] = [];
  for (const slidePath of slidePaths) {
    const slideNum = slidePath.match(/slide(\d+)\.xml/i)?.[1] ?? '?';
    const file = zip.file(slidePath);
    if (!file) continue;
    const xml = await file.async('string');
    const slideText = extractXmlTextRuns(xml);

    const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
    let notesText = '';
    const notesFile = zip.file(notesPath);
    if (notesFile) {
      const notesXml = await notesFile.async('string');
      notesText = extractXmlTextRuns(notesXml);
    }

    const parts = [`[Slide ${slideNum}]`, slideText || '(No text on slide)'];
    if (notesText) {
      parts.push(`Speaker notes: ${notesText}`);
    }
    sections.push(parts.join('\n'));
  }

  const clipped = truncateText(sections.join('\n\n'), maxChars);
  return {
    text: clipped.text,
    slideCount: slidePaths.length,
    truncated: clipped.truncated,
  };
}

export function extractLegacyDocText(
  buffer: ArrayBuffer,
  maxChars: number = DEFAULT_UPLOAD_LIMITS.maxExtractedCharsPerFile
): { text: string; truncated: boolean } {
  const bytes = new Uint8Array(buffer);
  // Best-effort extraction of readable ASCII & UTF-16LE runs from legacy binary .doc files
  const asciiMatches = new TextDecoder('latin1')
    .decode(bytes)
    .match(/[A-Za-z0-9.,;:!?'"()\-/\s]{6,}/g);

  const utf16Runs: string[] = [];
  let current = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    if (hi === 0 && ((lo >= 32 && lo <= 126) || lo === 10 || lo === 13 || lo === 9)) {
      current += String.fromCharCode(lo);
    } else {
      if (current.trim().length >= 8) utf16Runs.push(current.trim());
      current = '';
    }
  }
  if (current.trim().length >= 8) utf16Runs.push(current.trim());

  const bestCandidate =
    utf16Runs.join('\n').length >= (asciiMatches?.join(' ').length ?? 0) * 0.6
      ? utf16Runs.join('\n')
      : (asciiMatches ?? []).join('\n');

  const cleaned = bestCandidate
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned) {
    return {
      text: 'Could not extract plain text from this legacy binary .doc file. Converting it to .docx or .pdf is recommended for complete accuracy.',
      truncated: false,
    };
  }

  return truncateText(
    `[Best-effort extraction from legacy .doc file]\n\n${cleaned}`,
    maxChars
  );
}

async function extractPdfDocument(
  buffer: ArrayBuffer,
  maxChars: number
): Promise<{
  text: string;
  pageCount: number;
  truncated: boolean;
  scannedPreviewBase64?: string;
  scannedPreviewDataUrl?: string;
}> {
  const pdfjs = await import('pdfjs-dist');
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pageTexts: string[] = [];
  let totalTextChars = 0;

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .filter(Boolean);
    const joined = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) {
      totalTextChars += joined.length;
      pageTexts.push(`[Page ${pageNum}]\n${joined}`);
    } else {
      pageTexts.push(`[Page ${pageNum}]\n(No selectable text detected on this page)`);
    }
  }

  // If the PDF appears scanned (very little selectable text), render Page 1 via canvas for free Gemini Vision analysis
  let scannedPreviewBase64: string | undefined;
  let scannedPreviewDataUrl: string | undefined;
  if (totalTextChars < 60 && pageCount > 0 && typeof document !== 'undefined') {
    try {
      const page1 = await pdf.getPage(1);
      const viewport = page1.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1280 / Math.max(viewport.width, viewport.height, 1));
      canvas.width = Math.max(1, Math.round(viewport.width * scale));
      canvas.height = Math.max(1, Math.round(viewport.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const scaledViewport = page1.getViewport({ scale: 1.5 * scale });
        await page1.render({ canvasContext: ctx, viewport: scaledViewport, canvas }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        scannedPreviewDataUrl = dataUrl;
        scannedPreviewBase64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
      }
    } catch {
      // Ignore scanned PDF canvas render error and proceed with text notice
    }
  }

  const clipped = truncateText(
    pageTexts.join('\n\n') || 'No readable text found inside PDF.',
    maxChars
  );
  return {
    text: clipped.text,
    pageCount,
    truncated: clipped.truncated,
    scannedPreviewBase64,
    scannedPreviewDataUrl,
  };
}

async function compressImageFile(file: File): Promise<{
  mimeType: string;
  previewDataUrl: string;
  inlineImageBase64: string;
  dimensionsLabel: string;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image file.'));
      el.src = objectUrl;
    });

    const maxEdge = 1440;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas is unavailable for image processing.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    const outputMime =
      file.type === 'image/png' && file.size < 900_000 ? 'image/png' : 'image/jpeg';
    const dataUrl =
      outputMime === 'image/png'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');

    if (base64.length > DEFAULT_UPLOAD_LIMITS.maxImageBase64Bytes * 1.4) {
      const compactUrl = canvas.toDataURL('image/jpeg', 0.68);
      return {
        mimeType: 'image/jpeg',
        previewDataUrl: compactUrl,
        inlineImageBase64: compactUrl.replace(/^data:image\/jpeg;base64,/, ''),
        dimensionsLabel: `${img.naturalWidth}×${img.naturalHeight}`,
      };
    }

    return {
      mimeType: outputMime,
      previewDataUrl: dataUrl,
      inlineImageBase64: base64,
      dimensionsLabel: `${img.naturalWidth}×${img.naturalHeight}`,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function processFileLocally(
  file: File,
  options?: { maxFileMb?: number; maxExtractedChars?: number }
): Promise<MessageAttachment> {
  const maxFileMb = options?.maxFileMb ?? DEFAULT_UPLOAD_LIMITS.defaultMaxFileMb;
  const maxChars = options?.maxExtractedChars ?? DEFAULT_UPLOAD_LIMITS.maxExtractedCharsPerFile;
  const maxBytes = maxFileMb * 1024 * 1024;

  if (file.size > maxBytes) {
    throw new Error(
      `"${file.name}" (${formatBytes(file.size)}) exceeds the ${maxFileMb} MB local file size limit.`
    );
  }

  const ext = getExtension(file.name);
  const id = createAttachmentId();

  if (
    file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/webp' ||
    ['png', 'jpg', 'jpeg', 'webp'].includes(ext)
  ) {
    const img = await compressImageFile(file);
    return {
      id,
      name: file.name,
      mimeType: img.mimeType,
      sizeBytes: file.size,
      kind: 'image',
      summaryLabel: `${img.dimensionsLabel} · ${formatBytes(file.size)}`,
      previewDataUrl: img.previewDataUrl,
      inlineImageBase64: img.inlineImageBase64,
    };
  }

  if (ext === 'pdf' || file.type === 'application/pdf') {
    const buf = await file.arrayBuffer();
    const pdf = await extractPdfDocument(buf, maxChars);
    return {
      id,
      name: file.name,
      mimeType: 'application/pdf',
      sizeBytes: file.size,
      kind: 'document',
      pageCount: pdf.pageCount,
      summaryLabel: `${pdf.pageCount} page${pdf.pageCount === 1 ? '' : 's'} · ${formatBytes(file.size)}`,
      extractedText: pdf.text,
      truncated: pdf.truncated,
      inlineImageBase64: pdf.scannedPreviewBase64,
      previewDataUrl: pdf.scannedPreviewDataUrl,
    };
  }

  if (
    ext === 'docx' ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const buf = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer: buf });
    const clipped = truncateText(res.value || 'No text found in Word document.', maxChars);
    return {
      id,
      name: file.name,
      mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: file.size,
      kind: 'document',
      summaryLabel: `Word DOCX · ${formatBytes(file.size)}`,
      extractedText: clipped.text,
      truncated: clipped.truncated,
    };
  }

  if (ext === 'doc' || file.type === 'application/msword') {
    const buf = await file.arrayBuffer();
    const legacy = extractLegacyDocText(buf, maxChars);
    return {
      id,
      name: file.name,
      mimeType: 'application/msword',
      sizeBytes: file.size,
      kind: 'document',
      summaryLabel: `Word DOC · ${formatBytes(file.size)}`,
      extractedText: legacy.text,
      truncated: legacy.truncated,
    };
  }

  if (ext === 'xlsx' || ext === 'xls' || file.type.includes('spreadsheetml') || file.type.includes('ms-excel')) {
    const buf = await file.arrayBuffer();
    const wb = extractXlsxWorkbookFromBuffer(buf, maxChars);
    return {
      id,
      name: file.name,
      mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: file.size,
      kind: 'spreadsheet',
      sheetNames: wb.sheetNames,
      summaryLabel: `${wb.sheetNames.length} sheet${wb.sheetNames.length === 1 ? '' : 's'} · ${wb.totalRows} rows`,
      extractedText: wb.text,
      truncated: wb.truncated,
    };
  }

  if (ext === 'csv' || file.type === 'text/csv') {
    const rawText = await file.text();
    const csv = extractCsvSummary(rawText, maxChars);
    return {
      id,
      name: file.name,
      mimeType: 'text/csv',
      sizeBytes: file.size,
      kind: 'spreadsheet',
      summaryLabel: `CSV · ${csv.rowCount} rows`,
      extractedText: csv.text,
      truncated: csv.truncated,
    };
  }

  if (
    ext === 'pptx' ||
    file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    const buf = await file.arrayBuffer();
    const deck = await extractPptxSlidesFromBuffer(buf, maxChars);
    return {
      id,
      name: file.name,
      mimeType:
        file.type ||
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: file.size,
      kind: 'presentation',
      slideCount: deck.slideCount,
      summaryLabel: `${deck.slideCount} slide${deck.slideCount === 1 ? '' : 's'} · ${formatBytes(file.size)}`,
      extractedText: deck.text,
      truncated: deck.truncated,
    };
  }

  if (
    ['txt', 'md', 'json', 'log'].includes(ext) ||
    file.type.startsWith('text/') ||
    file.type === 'application/json'
  ) {
    const raw = await file.text();
    const clipped = truncateText(raw || '(empty file)', maxChars);
    const kind: AttachmentKind = 'text';
    return {
      id,
      name: file.name,
      mimeType: file.type || 'text/plain',
      sizeBytes: file.size,
      kind,
      summaryLabel: `${ext.toUpperCase() || 'TEXT'} · ${formatBytes(file.size)}`,
      extractedText: clipped.text,
      truncated: clipped.truncated,
    };
  }

  throw new Error(
    `Unsupported file type "${file.name}". Supported formats: PDF, DOCX, DOC, XLSX, XLS, CSV, PPTX, TXT, PNG, JPG, WEBP.`
  );
}
