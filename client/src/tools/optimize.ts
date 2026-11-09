import type { Tool } from './types';
import { PDFDocument, loadPdf, savePdf, baseName, openPdfJs, renderPage, canvasToBlob, readBytes } from '../lib/pdf';

const CAT = 'Optimize PDF';

function fmt(n: number) {
  return n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Re-draw every page as a JPEG image (used by compress / repair / redact). */
export async function rasterizePdf(
  src: Blob | Uint8Array, dpi: number, quality: number,
  progress?: (m: string, f?: number) => void, password?: string,
): Promise<Blob> {
  const doc = await openPdfJs(src, password);
  const out = await PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    progress?.(`Processing page ${i} of ${doc.numPages}`, (i - 1) / doc.numPages);
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, dpi / 72);
    const jpg = await out.embedJpg(await readBytes(await canvasToBlob(canvas, 'image/jpeg', quality)));
    const p = out.addPage([vp.width, vp.height]);
    p.drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
    canvas.width = canvas.height = 0; // free memory early
  }
  await doc.loadingTask.destroy();
  return savePdf(out);
}

export const compress: Tool = {
  id: 'compress-pdf', name: 'Compress PDF', category: CAT, icon: 'C', color: '#3aa757',
  description: 'Reduce file size while keeping the best possible quality.',
  accept: 'application/pdf,.pdf', actionLabel: 'Compress PDF',
  options: [
    { key: 'level', label: 'Compression level', type: 'select', default: 'recommended', choices: [
      { value: 'lossless', label: 'Less compression – lossless, keeps text selectable' },
      { value: 'recommended', label: 'Recommended – good quality (150 dpi images)' },
      { value: 'extreme', label: 'Extreme – smallest file (96 dpi images)' },
    ], help: 'Recommended and Extreme turn pages into images; text is no longer selectable.' },
  ],
  async run({ files, opts, progress }) {
    const f = files[0];
    let blob: Blob;
    if (opts.level === 'lossless') {
      blob = await savePdf(await loadPdf(f));
    } else {
      const [dpi, q] = opts.level === 'extreme' ? [96, 0.5] : [150, 0.7];
      blob = await rasterizePdf(f, dpi, q, progress);
    }
    let message: string;
    if (blob.size >= f.size) {
      blob = f;
      message = `This PDF is already well optimised (${fmt(f.size)}); returning the original file.`;
    } else {
      message = `${fmt(f.size)} → ${fmt(blob.size)} (${Math.round((1 - blob.size / f.size) * 100)}% smaller)`;
    }
    return { outputs: [{ name: `${baseName(f.name)}_compressed.pdf`, blob }], message };
  },
};

export const repair: Tool = {
  id: 'repair-pdf', name: 'Repair PDF', category: CAT, icon: 'R', color: '#3aa757',
  description: 'Recover content from damaged or corrupt PDF files.',
  accept: 'application/pdf,.pdf', actionLabel: 'Repair PDF',
  async run({ files, progress }) {
    const f = files[0];
    const bytes = await readBytes(f);
    try {
      progress('Rebuilding document structure');
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
      const out = await PDFDocument.create();
      (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      if (out.getPageCount() === 0) throw new Error('no pages');
      return {
        outputs: [{ name: `${baseName(f.name)}_repaired.pdf`, blob: await savePdf(out) }],
        message: 'Document structure rebuilt.',
      };
    } catch {
      // pdf.js is very tolerant of broken files; re-render what it can read.
      progress('Structure unreadable – recovering page images');
      const blob = await rasterizePdf(bytes, 150, 0.85, progress);
      return {
        outputs: [{ name: `${baseName(f.name)}_repaired.pdf`, blob }],
        message: 'Recovered the readable pages as images.',
      };
    }
  },
};

const OCR_LANGS = [
  ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'],
  ['por', 'Portuguese'], ['nld', 'Dutch'], ['rus', 'Russian'], ['hin', 'Hindi'], ['nep', 'Nepali'],
  ['ara', 'Arabic'], ['chi_sim', 'Chinese (Simplified)'], ['jpn', 'Japanese'], ['kor', 'Korean'],
].map(([value, label]) => ({ value, label }));

export const ocr: Tool = {
  id: 'ocr-pdf', name: 'OCR PDF', category: CAT, icon: 'OCR', color: '#3aa757',
  description: 'Turn scanned PDFs or images into searchable, selectable text.',
  accept: 'application/pdf,.pdf,image/*', actionLabel: 'Run OCR',
  note: 'Runs locally with Tesseract (WebAssembly). The language model (~2–15 MB) is downloaded once from a public CDN and cached by your browser.',
  options: [
    { key: 'lang', label: 'Document language', type: 'select', default: 'eng', choices: OCR_LANGS },
    { key: 'quality', label: 'Scan resolution', type: 'select', default: '3', choices: [
      { value: '2', label: 'Fast (144 dpi)' }, { value: '3', label: 'Accurate (216 dpi)' }, { value: '4', label: 'Best (288 dpi)' },
    ] },
    { key: 'txt', label: 'Also download the recognised text (.txt)', type: 'checkbox', default: false },
  ],
  async run({ files, opts, progress }) {
    const { createWorker } = await import('tesseract.js');
    const f = files[0];
    progress('Loading OCR engine and language data…');
    const base = new URL('tesseract/', document.baseURI).href;
    let failed: (e: Error) => void = () => {};
    const failure = new Promise<never>((_, rej) => (failed = rej));
    const timer = setTimeout(() => failed(new Error('Could not download the OCR language data. Check your internet connection and try again.')), 90_000);
    const worker = await Promise.race([
      createWorker(opts.lang, 1, {
        workerPath: base + 'worker.min.js', corePath: base, workerBlobURL: false,
        errorHandler: (e: unknown) => failed(new Error(`OCR engine error: ${String(e)}`)),
      }),
      failure,
    ]).finally(() => clearTimeout(timer));
    try {
      const out = await PDFDocument.create();
      const texts: string[] = [];
      const addPage = async (canvas: HTMLCanvasElement | Blob, w: number, h: number) => {
        const { data } = await worker.recognize(canvas as any, {}, { pdf: true, text: true });
        texts.push(data.text);
        const one = await PDFDocument.load(new Uint8Array(data.pdf!));
        const [p] = await out.copyPages(one, [0]);
        const { width } = p.getSize();
        const k = w / width;
        p.scale(k, k);
        p.setSize(w, h);
        out.addPage(p);
      };
      if (f.type.startsWith('image/')) {
        progress('Recognising text', 0.3);
        const bmp = await createImageBitmap(f);
        const w = bmp.width * 0.75, h = bmp.height * 0.75;
        bmp.close();
        await addPage(f, w, h);
      } else {
        const doc = await openPdfJs(f);
        for (let i = 1; i <= doc.numPages; i++) {
          progress(`Recognising page ${i} of ${doc.numPages}`, (i - 1) / doc.numPages);
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const canvas = await renderPage(page, Number(opts.quality) || 3);
          await addPage(canvas, vp.width, vp.height);
        }
        await doc.loadingTask.destroy();
      }
      const outputs = [{ name: `${baseName(f.name)}_ocr.pdf`, blob: await savePdf(out) }];
      if (opts.txt) outputs.push({ name: `${baseName(f.name)}_ocr.txt`, blob: new Blob([texts.join('\n\n')], { type: 'text/plain' }) });
      return { outputs };
    } finally {
      await worker.terminate();
    }
  },
};
