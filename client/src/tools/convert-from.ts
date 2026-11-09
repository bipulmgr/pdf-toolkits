import type { Tool, ToolOutput } from './types';
import { baseName, openPdfJs, renderPage, canvasToBlob, pageLines, parsePages, type TextLine } from '../lib/pdf';

const CAT = 'Convert from PDF';

export const pdfToJpg: Tool = {
  id: 'pdf-to-jpg', name: 'PDF to JPG', category: CAT, icon: 'JPG', color: '#f0b400',
  description: 'Turn each PDF page into a JPG (or PNG) image.',
  accept: 'application/pdf,.pdf', actionLabel: 'Convert to images',
  options: [
    { key: 'format', label: 'Image format', type: 'select', default: 'jpeg', choices: [
      { value: 'jpeg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' },
    ] },
    { key: 'dpi', label: 'Resolution', type: 'select', default: '150', choices: [
      { value: '72', label: 'Low (72 dpi)' }, { value: '150', label: 'Normal (150 dpi)' }, { value: '300', label: 'High (300 dpi)' },
    ] },
    { key: 'pages', label: 'Pages', type: 'text', default: 'all', placeholder: 'all or 1-3, 5' },
  ],
  async run({ files, opts, progress }) {
    const doc = await openPdfJs(files[0]);
    const pages = parsePages(opts.pages, doc.numPages);
    const ext = opts.format === 'jpeg' ? 'jpg' : opts.format;
    const base = baseName(files[0].name);
    const outputs: ToolOutput[] = [];
    for (const [k, i] of pages.entries()) {
      progress(`Rendering page ${i + 1}`, k / pages.length);
      const canvas = await renderPage(await doc.getPage(i + 1), Number(opts.dpi) / 72);
      outputs.push({ name: `${base}_page_${i + 1}.${ext}`, blob: await canvasToBlob(canvas, `image/${opts.format}`, 0.9) });
    }
    await doc.loadingTask.destroy();
    return { outputs };
  },
};

/** Group lines into paragraphs using vertical gaps. */
function paragraphs(lines: TextLine[]): { text: string; size: number }[] {
  const out: { text: string; size: number }[] = [];
  let prev: TextLine | null = null;
  for (const l of lines) {
    const gap = prev ? l.y - prev.y : 0;
    const newPara = !prev || gap > prev.size * 1.8 || Math.abs(l.size - prev.size) > 1.5 || /^[•\-–▪●◦*]\s/.test(l.text);
    if (newPara) out.push({ text: l.text, size: l.size });
    else {
      const last = out[out.length - 1];
      last.text = last.text.endsWith('-') ? last.text.slice(0, -1) + l.text : last.text + ' ' + l.text;
    }
    prev = l;
  }
  return out;
}

function bodySize(pages: TextLine[][]): number {
  const counts = new Map<number, number>();
  for (const p of pages) for (const l of p) {
    const s = Math.round(l.size);
    counts.set(s, (counts.get(s) || 0) + l.text.length);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;
}

export const pdfToWord: Tool = {
  id: 'pdf-to-word', name: 'PDF to Word', category: CAT, icon: 'W', color: '#2b579a',
  description: 'Convert PDF to an editable DOCX document.',
  accept: 'application/pdf,.pdf', actionLabel: 'Convert to Word',
  note: 'Works with PDFs that contain text. For scanned documents run "OCR PDF" first.',
  options: [
    { key: 'mode', label: 'Conversion mode', type: 'select', default: 'text', choices: [
      { value: 'text', label: 'Editable text (paragraphs & headings)' },
      { value: 'image', label: 'Exact look (each page as an image)' },
    ] },
  ],
  async run({ files, opts, progress }) {
    const docx = await import('docx');
    const doc = await openPdfJs(files[0]);
    const children: any[] = [];
    if (opts.mode === 'image') {
      for (let i = 1; i <= doc.numPages; i++) {
        progress(`Rendering page ${i}`, i / doc.numPages);
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const c = await renderPage(page, 2);
        const data = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.85)).arrayBuffer());
        const w = 600, h = Math.round((600 * vp.height) / vp.width);
        children.push(new docx.Paragraph({
          pageBreakBefore: i > 1,
          children: [new docx.ImageRun({ type: 'jpg', data, transformation: { width: w, height: h } })],
        }));
      }
    } else {
      const pages: TextLine[][] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        progress(`Reading page ${i}`, i / doc.numPages);
        pages.push(await pageLines(await doc.getPage(i)));
      }
      const body = bodySize(pages);
      pages.forEach((lines, pi) => {
        paragraphs(lines).forEach((p, k) => {
          const ratio = p.size / body;
          const heading = ratio > 1.6 ? docx.HeadingLevel.HEADING_1 : ratio > 1.25 ? docx.HeadingLevel.HEADING_2 : undefined;
          children.push(new docx.Paragraph({
            heading, pageBreakBefore: pi > 0 && k === 0,
            children: [new docx.TextRun({ text: p.text, size: heading ? undefined : Math.round(Math.min(Math.max(p.size, 8), 40) * 2) })],
          }));
        });
      });
      if (!children.length) throw new Error('No text found in this PDF. If it is a scan, run "OCR PDF" first or choose "Exact look".');
    }
    await doc.loadingTask.destroy();
    const file = new docx.Document({ sections: [{ children }] });
    const blob = await docx.Packer.toBlob(file);
    return { outputs: [{ name: `${baseName(files[0].name)}.docx`, blob }] };
  },
};

export const pdfToPpt: Tool = {
  id: 'pdf-to-powerpoint', name: 'PDF to PowerPoint', category: CAT, icon: 'P', color: '#d24726',
  description: 'Turn each PDF page into a PowerPoint slide.',
  accept: 'application/pdf,.pdf', actionLabel: 'Convert to PPTX',
  async run({ files, progress }) {
    const PptxGenJS = (await import('pptxgenjs')).default;
    const doc = await openPdfJs(files[0]);
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'PDF', width: first.width / 72, height: first.height / 72 });
    pptx.layout = 'PDF';
    for (let i = 1; i <= doc.numPages; i++) {
      progress(`Converting page ${i}`, i / doc.numPages);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const c = await renderPage(page, 2);
      const slide = pptx.addSlide();
      // Fit page into the slide (pages may differ in size).
      const s = Math.min(first.width / vp.width, first.height / vp.height);
      const w = (vp.width * s) / 72, h = (vp.height * s) / 72;
      slide.addImage({ data: c.toDataURL('image/jpeg', 0.85), x: (first.width / 72 - w) / 2, y: (first.height / 72 - h) / 2, w, h });
      const text = (await pageLines(page)).map((l) => l.text).join('\n');
      if (text) slide.addNotes(text);
    }
    await doc.loadingTask.destroy();
    const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
    return { outputs: [{ name: `${baseName(files[0].name)}.pptx`, blob }] };
  },
};

/** Split a line into cells wherever there is a large horizontal gap. */
function lineCells(l: TextLine): { x: number; text: string }[] {
  const cells: { x: number; text: string; end: number }[] = [];
  for (const it of l.items) {
    const last = cells[cells.length - 1];
    if (last && it.x - last.end < l.size * 1.2) {
      last.text += (it.x - last.end > l.size * 0.2 ? ' ' : '') + it.str;
      last.end = it.x + it.w;
    } else cells.push({ x: it.x, text: it.str, end: it.x + it.w });
  }
  return cells.map((c) => ({ x: c.x, text: c.text.trim() })).filter((c) => c.text);
}

export const pdfToExcel: Tool = {
  id: 'pdf-to-excel', name: 'PDF to Excel', category: CAT, icon: 'X', color: '#217346',
  description: 'Pull tables and data out of a PDF into an XLSX spreadsheet.',
  accept: 'application/pdf,.pdf', actionLabel: 'Convert to Excel',
  note: 'Columns are detected from text alignment. Each page becomes a worksheet.',
  options: [{ key: 'single', label: 'Put all pages in one sheet', type: 'checkbox', default: false }],
  async run({ files, opts, progress }) {
    const XLSX = await import('xlsx');
    const doc = await openPdfJs(files[0]);
    const wb = XLSX.utils.book_new();
    const all: (string | number)[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      progress(`Reading page ${i}`, i / doc.numPages);
      const lines = await pageLines(await doc.getPage(i));
      const rows = lines.map(lineCells);
      // Build column anchors from all cell x positions.
      const xs = rows.flat().map((c) => c.x).sort((a, b) => a - b);
      const anchors: number[] = [];
      for (const x of xs) if (!anchors.length || x - anchors[anchors.length - 1] > 12) anchors.push(x);
      const aoa = rows.map((cells) => {
        const row: (string | number)[] = [];
        for (const c of cells) {
          let col = 0, best = Infinity;
          anchors.forEach((a, k) => { const d = Math.abs(a - c.x); if (d < best) { best = d; col = k; } });
          while (row.length < col) row.push('');
          const num = /^-?[\d,]*\.?\d+$/.test(c.text) ? Number(c.text.replace(/,/g, '')) : NaN;
          const val = Number.isFinite(num) ? num : c.text;
          if (row[col] !== undefined && row[col] !== '') row[col] = `${row[col]} ${c.text}`; else row[col] = val;
        }
        return row;
      });
      if (opts.single) all.push(...aoa, []);
      else XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa.length ? aoa : [['(no text)']]), `Page ${i}`);
    }
    if (opts.single) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(all), 'PDF');
    await doc.loadingTask.destroy();
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return { outputs: [{ name: `${baseName(files[0].name)}.xlsx`, blob }] };
  },
};

export { paragraphs, bodySize };
