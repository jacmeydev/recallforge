// ============================================================================
// RecallForge — Text extraction from study documents
// ============================================================================
// Turns a file into ordered parts (PDF pages, slides, document sections) so an
// agent can read it piece by piece and every card can cite where it came from.
// No AI here: the agent reads the parts and writes the cards.
// ============================================================================

import JSZip from 'jszip';
import { badRequest } from './errors';
import { htmlToText } from './text';

export interface DocumentPartInput {
  label: string;
  text: string;
}

export interface ExtractedDocument {
  title: string;
  mimeType: string;
  parts: DocumentPartInput[];
}

export const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PART_CHARS = 12_000;
const MAX_TOTAL_CHARS = 3_000_000;

type Kind = 'pdf' | 'docx' | 'pptx' | 'html' | 'markdown' | 'text';

const EXTENSIONS: Record<string, Kind> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  html: 'html',
  htm: 'html',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  text: 'text',
  csv: 'text',
  tsv: 'text',
  json: 'text',
  rtf: 'text',
};

const MIME_TYPES: Record<Kind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  markdown: 'text/markdown',
  text: 'text/plain',
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSIONS);

function detectKind(filename: string, data: Uint8Array): Kind {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  const kind = EXTENSIONS[extension];
  if (kind) return kind;
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'pdf'; // %PDF
  const legacy: Record<string, string> = {
    doc: 'Guarda el archivo como .docx',
    ppt: 'Guarda el archivo como .pptx',
    xls: 'Exporta la hoja a .csv',
    xlsx: 'Exporta la hoja a .csv',
    png: 'Las imágenes no tienen texto extraíble: pide a tu agente que las lea y te haga las tarjetas',
    jpg: 'Las imágenes no tienen texto extraíble: pide a tu agente que las lea y te haga las tarjetas',
    jpeg: 'Las imágenes no tienen texto extraíble: pide a tu agente que las lea y te haga las tarjetas',
  };
  throw badRequest(
    `Unsupported file type ".${extension}". ${legacy[extension] ?? `Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`}`
  );
}

function titleFrom(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Documento';
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split oversized parts on paragraph boundaries: "p. 3" → "p. 3 (1/2)", "p. 3 (2/2)". */
function limitPartSize(parts: DocumentPartInput[]): DocumentPartInput[] {
  const result: DocumentPartInput[] = [];
  for (const part of parts) {
    if (part.text.length <= MAX_PART_CHARS) {
      result.push(part);
      continue;
    }
    const pieces: string[] = [];
    let current = '';
    for (const paragraph of part.text.split(/\n\n+/)) {
      if (current && current.length + paragraph.length + 2 > MAX_PART_CHARS) {
        pieces.push(current);
        current = '';
      }
      if (paragraph.length > MAX_PART_CHARS) {
        for (let i = 0; i < paragraph.length; i += MAX_PART_CHARS) pieces.push(paragraph.slice(i, i + MAX_PART_CHARS));
        continue;
      }
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    if (current) pieces.push(current);
    pieces.forEach((text, i) => result.push({ label: `${part.label} (${i + 1}/${pieces.length})`, text }));
  }
  return result;
}

/** Split plain or markdown text into sections by headings, falling back to size-based chunks. */
export function splitText(text: string, markdown = false): DocumentPartInput[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  const parts: DocumentPartInput[] = [];
  if (markdown) {
    let label = 'Inicio';
    let buffer: string[] = [];
    const flush = () => {
      const body = buffer.join('\n').trim();
      if (body) parts.push({ label, text: body });
      buffer = [];
    };
    for (const line of cleaned.split('\n')) {
      const heading = /^#{1,3}\s+(.+)$/.exec(line);
      if (heading) {
        flush();
        label = heading[1].trim().slice(0, 120);
      }
      buffer.push(line);
    }
    flush();
  }
  if (parts.length <= 1) {
    return limitPartSize([{ label: 'Sección 1', text: cleaned }]).map((part, i, all) => ({
      ...part,
      label: all.length > 1 ? `Sección ${i + 1}` : 'Texto completo',
    }));
  }
  return limitPartSize(parts);
}

async function extractPdf(data: Uint8Array): Promise<DocumentPartInput[]> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch {
    throw badRequest('Could not read this PDF (it may be damaged or password-protected)');
  }
  return pages
    .map((text, i) => ({ label: `p. ${i + 1}`, text: cleanText(text) }))
    .filter((part) => part.text.length > 0);
}

async function extractDocx(data: Uint8Array): Promise<DocumentPartInput[]> {
  const mammoth = await import('mammoth');
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ buffer: Buffer.from(data) })).value;
  } catch {
    throw badRequest('Could not read this Word document');
  }
  // One part per heading (h1–h3) so cards cite the section they come from.
  const parts: DocumentPartInput[] = [];
  const pieces = html.split(/(?=<h[1-3][^>]*>)/i);
  pieces.forEach((piece, i) => {
    const heading = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(piece);
    const text = cleanText(htmlToText(piece));
    if (!text) return;
    const label = heading ? htmlToText(heading[1]).slice(0, 120) || `Sección ${i + 1}` : i === 0 ? 'Inicio' : `Sección ${i + 1}`;
    parts.push({ label, text });
  });
  return parts;
}

function xmlText(xml: string): string {
  return cleanText(
    htmlToText(
      xml
        .replace(/<a:br\s*\/>/g, '\n')
        .replace(/<\/a:p>/g, '\n')
        .replace(/<(?!\/?a:t\b)[^>]+>/g, '')
        .replace(/<\/?a:t[^>]*>/g, '')
    )
  );
}

async function extractPptx(data: Uint8Array): Promise<DocumentPartInput[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw badRequest('Could not read this PowerPoint file');
  }
  const slideNumber = (path: string) => Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const parts: DocumentPartInput[] = [];
  for (const path of slides) {
    const n = slideNumber(path);
    const body = xmlText(await zip.file(path)!.async('string'));
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile ? xmlText(await notesFile.async('string')).replace(/^\d+$/m, '').trim() : '';
    const text = [body, notes ? `Notas del orador:\n${notes}` : ''].filter(Boolean).join('\n\n');
    if (text) parts.push({ label: `diapositiva ${n}`, text });
  }
  return parts;
}

export async function extractDocument(file: { filename: string; data: Uint8Array }): Promise<ExtractedDocument> {
  if (file.data.byteLength === 0) throw badRequest('The file is empty');
  if (file.data.byteLength > MAX_FILE_BYTES) throw badRequest('The file is larger than 30 MB');
  const kind = detectKind(file.filename, file.data);

  let parts: DocumentPartInput[];
  switch (kind) {
    case 'pdf':
      parts = await extractPdf(file.data);
      break;
    case 'docx':
      parts = await extractDocx(file.data);
      break;
    case 'pptx':
      parts = await extractPptx(file.data);
      break;
    case 'html':
      parts = splitText(htmlToText(new TextDecoder().decode(file.data)));
      break;
    default:
      parts = splitText(new TextDecoder().decode(file.data), kind === 'markdown');
  }

  parts = limitPartSize(parts);
  if (parts.length === 0) {
    throw badRequest(
      kind === 'pdf'
        ? 'This PDF has no selectable text (probably scanned). Ask your agent to read it with its vision skills, or run OCR first.'
        : 'No text found in this file'
    );
  }
  const total = parts.reduce((sum, part) => sum + part.text.length, 0);
  if (total > MAX_TOTAL_CHARS) throw badRequest('The document is too long; split it into chapters');
  return { title: titleFrom(file.filename), mimeType: MIME_TYPES[kind], parts };
}
