import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, degrees } from '@cantoo/pdf-lib';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { PDFDocument, degrees };
export type { PDFDocumentProxy };

/** Read a File into bytes. */
export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Open a document with pdf.js (for rendering / text extraction). */
export async function openPdfJs(src: Blob | Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker, so always hand it a private copy.
  const bytes = src instanceof Uint8Array ? src.slice() : await readBytes(src);
  return pdfjs.getDocument({ data: bytes, password: password || undefined }).promise;
}

/** Open a document with pdf-lib (for editing). */
export async function loadPdf(src: Blob | Uint8Array, password?: string): Promise<PDFDocument> {
  const bytes = src instanceof Uint8Array ? src : await readBytes(src);
  try {
    return await PDFDocument.load(bytes, { password: password || undefined, updateMetadata: false });
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    if (/encrypt|password/i.test(msg)) {
      throw new Error('This PDF is password protected. Unlock it first with the "Unlock PDF" tool.');
    }
    throw err;
  }
}

export async function renderPage(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport, background: 'rgb(255,255,255)' } as any).promise;
  return canvas;
}

/** Render a page so its longest side is about `px` pixels (thumbnails). */
export async function renderThumb(doc: PDFDocumentProxy, pageNo: number, px = 220): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  return renderPage(page, px / Math.max(vp.width, vp.height));
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality),
  );
}

/**
 * Parse "1-3, 5, 8-" into groups of 0-based page indexes.
 * Each comma-separated item becomes one group.
 */
export function parseRangeGroups(input: string, total: number): number[][] {
  const groups: number[][] = [];
  for (const raw of input.split(/[,;\s]+/).filter(Boolean)) {
    const m = raw.match(/^(\d*)\s*-\s*(\d*)$/);
    let a: number, b: number;
    if (m) {
      a = m[1] ? parseInt(m[1], 10) : 1;
      b = m[2] ? parseInt(m[2], 10) : total;
    } else if (/^\d+$/.test(raw)) {
      a = b = parseInt(raw, 10);
    } else {
      throw new Error(`Invalid page range "${raw}". Use e.g. 1-3, 5, 8-`);
    }
    if (a < 1 || b < 1 || a > total || b > total) {
      throw new Error(`Page range "${raw}" is outside 1-${total}.`);
    }
    const g: number[] = [];
    if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1);
    else for (let i = a; i >= b; i--) g.push(i - 1);
    groups.push(g);
  }
  return groups;
}

/** Flat, de-duplicated, ordered page list. Empty input or "all" = every page. */
export function parsePages(input: string, total: number): number[] {
  if (!input.trim() || /^all$/i.test(input.trim())) return [...Array(total).keys()];
  const set = new Set<number>();
  for (const g of parseRangeGroups(input, total)) g.forEach((i) => set.add(i));
  return [...set].sort((a, b) => a - b);
}

export async function savePdf(doc: PDFDocument): Promise<Blob> {
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export interface TextLine {
  y: number; // top, in PDF points from top of page
  x: number;
  size: number;
  text: string;
  items: { x: number; w: number; str: string }[];
}

/**
 * Extract text from one page and group items into visual lines.
 * Coordinates are in PDF points, origin top-left.
 */
export async function pageLines(page: PDFPageProxy): Promise<TextLine[]> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  type It = { x: number; y: number; w: number; size: number; str: string };
  const items: It[] = [];
  for (const it of tc.items as any[]) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const [, , , d, e, f] = it.transform as number[];
    const size = Math.abs(d) || Math.hypot(it.transform[2], it.transform[3]) || 10;
    items.push({ x: e, y: vp.height - f - size, w: it.width, size, str: it.str });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.size * 0.45));
    if (line) {
      line.items.push({ x: it.x, w: it.w, str: it.str });
      line.size = Math.max(line.size, it.size);
    } else {
      lines.push({ y: it.y, x: it.x, size: it.size, text: '', items: [{ x: it.x, w: it.w, str: it.str }] });
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.x = l.items[0].x;
    let text = '';
    let end = -Infinity;
    for (const it of l.items) {
      if (text && it.x - end > l.size * 0.2 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
      text += it.str;
      end = it.x + it.w;
    }
    l.text = text.replace(/\s+/g, ' ').trim();
  }
  return lines.sort((a, b) => a.y - b.y);
}

export async function extractAllText(
  doc: PDFDocumentProxy,
  onPage?: (i: number) => void,
): Promise<{ pages: TextLine[][]; text: string }> {
  const pages: TextLine[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onPage?.(i);
    pages.push(await pageLines(await doc.getPage(i)));
  }
  return { pages, text: pages.map((p) => p.map((l) => l.text).join('\n')).join('\n\n') };
}

/** Standard page sizes in PDF points. */
export const PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
  Legal: [612, 1008],
  A3: [841.89, 1190.55],
  A5: [419.53, 595.28],
};

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Standard 14 fonts only cover WinAnsi; replace anything else so drawing never throws. */
export function winAnsiSafe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

/** Turn an arbitrary image file into a PNG/JPEG pdf-lib can embed. */
export async function imageForPdf(file: Blob): Promise<{ bytes: Uint8Array; kind: 'png' | 'jpg'; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const w = bmp.width, h = bmp.height;
  if (file.type === 'image/jpeg' || file.type === 'image/png') {
    bmp.close();
    return { bytes: await readBytes(file), kind: file.type === 'image/png' ? 'png' : 'jpg', w, h };
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { bytes: await readBytes(await canvasToBlob(c, 'image/jpeg', 0.92)), kind: 'jpg', w, h };
}
