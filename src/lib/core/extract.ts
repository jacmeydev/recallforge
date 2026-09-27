// ============================================================================
// RecallForge — Text extraction from study documents
// ============================================================================
// Turns a file into ordered parts (PDF pages, slides, document sections) so an
// agent can read it piece by piece and every card can cite where it came from.
// No AI here: the agent reads the parts and writes the cards.
// ============================================================================

import JSZip from 'jszip';
import { badRequest } from './errors';
import { imageSize } from './occlusion';
import { encodePng } from './png';
import { htmlToText } from './text';

const isWebImage = (name: string) => /\.(png|jpe?g|gif|webp)$/i.test(name);

export interface ExtractedImage {
  filename: string;
  data: Uint8Array;
  width?: number;
  height?: number;
}

export interface DocumentPartInput {
  label: string;
  text: string;
  /** Figures of this page, slide or section (diagrams, anatomy, micrographs…). */
  images?: ExtractedImage[];
}

/** Icons, bullets and logos are not study material. */
const MIN_IMAGE_SIDE = 120;
const MIN_IMAGE_AREA = 40_000;
const MAX_IMAGES_PER_PART = 8;
const MAX_IMAGES = 120;

function keepImage(width: number | undefined, height: number | undefined): boolean {
  if (!width || !height) return true;
  return Math.min(width, height) >= MIN_IMAGE_SIDE && width * height >= MIN_IMAGE_AREA;
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
    pieces.forEach((text, i) =>
      result.push({ label: `${part.label} (${i + 1}/${pieces.length})`, text, ...(i === 0 && part.images ? { images: part.images } : {}) })
    );
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
  const { extractImages, extractText, getDocumentProxy } = await import('unpdf');
  let pages: string[];
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch {
    throw badRequest('Could not read this PDF (it may be damaged or password-protected)');
  }
  const parts: DocumentPartInput[] = [];
  let total = 0;
  for (const [i, raw] of pages.entries()) {
    const images: ExtractedImage[] = [];
    if (total < MAX_IMAGES) {
      try {
        for (const image of await extractImages(pdf, i + 1)) {
          if (images.length >= MAX_IMAGES_PER_PART || total >= MAX_IMAGES) break;
          if (!keepImage(image.width, image.height)) continue;
          images.push({
            filename: `p${i + 1}-${images.length + 1}.png`,
            data: encodePng(image.width, image.height, image.channels, image.data),
            width: image.width,
            height: image.height,
          });
          total++;
        }
      } catch {
        // Unusual image encodings are skipped; the text is still imported.
      }
    }
    const text = cleanText(raw);
    if (text || images.length) parts.push({ label: `p. ${i + 1}`, text: text || '(página con figuras)', ...(images.length ? { images } : {}) });
  }
  return parts;
}

async function extractDocx(data: Uint8Array): Promise<DocumentPartInput[]> {
  const mammoth = await import('mammoth');
  let html: string;
  const figures: ExtractedImage[] = [];
  try {
    html = (
      await mammoth.convertToHtml(
        { buffer: Buffer.from(data) },
        {
          // Keep each figure in place as a marker, so it lands in the right section.
          convertImage: mammoth.images.imgElement(async (image) => {
            const buffer = Buffer.from(await image.read('base64'), 'base64');
            const size = imageSize(buffer);
            if (!keepImage(size?.width, size?.height)) return { src: '' };
            const extension = (image.contentType.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace('x-emf', 'emf');
            figures.push({ filename: `figura-${figures.length + 1}.${extension}`, data: buffer, width: size?.width, height: size?.height });
            return { src: `rf-figure:${figures.length - 1}` };
          }),
        }
      )
    ).value;
  } catch {
    throw badRequest('Could not read this Word document');
  }
  // One part per heading (h1–h3) so cards cite the section they come from.
  const parts: DocumentPartInput[] = [];
  const pieces = html.split(/(?=<h[1-3][^>]*>)/i);
  pieces.forEach((piece, i) => {
    const heading = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(piece);
    const text = cleanText(htmlToText(piece));
    const images = [...piece.matchAll(/rf-figure:(\d+)/g)]
      .map((m) => figures[Number(m[1])])
      .filter((image): image is ExtractedImage => Boolean(image) && isWebImage(image.filename))
      .slice(0, MAX_IMAGES_PER_PART);
    if (!text && images.length === 0) return;
    const label = heading ? htmlToText(heading[1]).slice(0, 120) || `Sección ${i + 1}` : i === 0 ? 'Inicio' : `Sección ${i + 1}`;
    parts.push({ label, text: text || '(sección con figuras)', ...(images.length ? { images } : {}) });
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
  let total = 0;
  for (const path of slides) {
    const n = slideNumber(path);
    const xml = await zip.file(path)!.async('string');
    const body = xmlText(xml);
    // Pictures: <a:blip r:embed="rIdN"/> → ppt/slides/_rels/slideN.xml.rels → ../media/imageK.png
    const images: ExtractedImage[] = [];
    const rels = zip.file(`ppt/slides/_rels/slide${n}.xml.rels`);
    if (rels && total < MAX_IMAGES) {
      const relXml = await rels.async('string');
      const targets = new Map([...relXml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
      for (const match of xml.matchAll(/<a:blip\b[^>]*?r:embed="([^"]+)"/g)) {
        const target = targets.get(match[1]);
        if (!target || images.length >= MAX_IMAGES_PER_PART || total >= MAX_IMAGES) continue;
        const file = zip.file(`ppt/${target.replace(/^\.\.\//, '')}`);
        if (!file || !isWebImage(target)) continue;
        const data = await file.async('uint8array');
        const size = imageSize(data);
        if (!keepImage(size?.width, size?.height)) continue;
        if (images.some((image) => image.filename === target.split('/').pop())) continue;
        images.push({ filename: target.split('/').pop()!, data, width: size?.width, height: size?.height });
        total++;
      }
    }
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const notes = notesFile ? xmlText(await notesFile.async('string')).replace(/^\d+$/m, '').trim() : '';
    const text = [body, notes ? `Notas del orador:\n${notes}` : ''].filter(Boolean).join('\n\n');
    if (text || images.length) parts.push({ label: `diapositiva ${n}`, text: text || '(diapositiva con figuras)', ...(images.length ? { images } : {}) });
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
