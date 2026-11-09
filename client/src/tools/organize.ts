import type { Tool } from './types';
import {
  PDFDocument, degrees, loadPdf, savePdf, baseName, parsePages, parseRangeGroups,
  openPdfJs, renderThumb, PAGE_SIZES, imageForPdf, canvasToBlob,
} from '../lib/pdf';

const CAT = 'Organize PDF';

export const merge: Tool = {
  id: 'merge-pdf', name: 'Merge PDF', category: CAT, icon: 'M', color: '#e5322d',
  description: 'Combine several PDFs into one document, in the order you choose.',
  accept: 'application/pdf,.pdf', multiple: true, minFiles: 2,
  note: 'Use the arrows in the file list to change the order.',
  actionLabel: 'Merge PDF',
  async run({ files, progress }) {
    const out = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      progress(`Adding ${files[i].name}`, i / files.length);
      const src = await loadPdf(files[i]);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    }
    return { outputs: [{ name: 'merged.pdf', blob: await savePdf(out) }] };
  },
};

export const split: Tool = {
  id: 'split-pdf', name: 'Split PDF', category: CAT, icon: 'S', color: '#e5322d',
  description: 'Split a PDF by page ranges, into fixed-size chunks or into single pages.',
  accept: 'application/pdf,.pdf', actionLabel: 'Split PDF',
  options: [
    { key: 'mode', label: 'Split mode', type: 'select', default: 'ranges', choices: [
      { value: 'ranges', label: 'Custom ranges' },
      { value: 'every', label: 'Every N pages' },
      { value: 'all', label: 'Every page' },
    ] },
    { key: 'ranges', label: 'Ranges (one file per range)', type: 'text', default: '1-2, 3-',
      placeholder: '1-3, 4-6, 7-', showIf: { key: 'mode', values: ['ranges'] } },
    { key: 'every', label: 'Pages per file', type: 'number', default: 2, min: 1,
      showIf: { key: 'mode', values: ['every'] } },
  ],
  async run({ files, opts, progress }) {
    const src = await loadPdf(files[0]);
    const total = src.getPageCount();
    let groups: number[][];
    if (opts.mode === 'ranges') groups = parseRangeGroups(opts.ranges, total);
    else {
      const n = opts.mode === 'all' ? 1 : Math.max(1, Number(opts.every) || 1);
      groups = [];
      for (let i = 0; i < total; i += n) groups.push([...Array(Math.min(n, total - i)).keys()].map((k) => k + i));
    }
    const base = baseName(files[0].name);
    const outputs = [];
    for (let i = 0; i < groups.length; i++) {
      progress(`Creating part ${i + 1} of ${groups.length}`, i / groups.length);
      const doc = await PDFDocument.create();
      (await doc.copyPages(src, groups[i])).forEach((p) => doc.addPage(p));
      const g = groups[i];
      const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
      outputs.push({ name: `${base}_pages_${label}.pdf`, blob: await savePdf(doc) });
    }
    return { outputs };
  },
};

export const removePages: Tool = {
  id: 'remove-pages', name: 'Remove pages', category: CAT, icon: '−', color: '#e5322d',
  description: 'Delete the pages you do not need.',
  accept: 'application/pdf,.pdf', actionLabel: 'Remove pages',
  options: [{ key: 'pages', label: 'Pages to remove', type: 'text', default: '', placeholder: 'e.g. 2, 5-7' }],
  async run({ files, opts }) {
    const doc = await loadPdf(files[0]);
    const total = doc.getPageCount();
    if (!String(opts.pages).trim()) throw new Error('Enter the pages to remove.');
    const remove = parsePages(opts.pages, total);
    if (remove.length >= total) throw new Error('You cannot remove every page.');
    for (const i of [...remove].sort((a, b) => b - a)) doc.removePage(i);
    return { outputs: [{ name: `${baseName(files[0].name)}_removed.pdf`, blob: await savePdf(doc) }] };
  },
};

export const extractPages: Tool = {
  id: 'extract-pages', name: 'Extract pages', category: CAT, icon: 'E', color: '#e5322d',
  description: 'Pull selected pages out into a new PDF.',
  accept: 'application/pdf,.pdf', actionLabel: 'Extract pages',
  options: [
    { key: 'pages', label: 'Pages to extract', type: 'text', default: '1', placeholder: 'e.g. 1, 3-4' },
    { key: 'separate', label: 'Save each page as a separate PDF', type: 'checkbox', default: false },
  ],
  async run({ files, opts }) {
    const src = await loadPdf(files[0]);
    const pages = parsePages(opts.pages, src.getPageCount());
    const base = baseName(files[0].name);
    if (opts.separate) {
      const outputs = [];
      for (const i of pages) {
        const d = await PDFDocument.create();
        d.addPage((await d.copyPages(src, [i]))[0]);
        outputs.push({ name: `${base}_page_${i + 1}.pdf`, blob: await savePdf(d) });
      }
      return { outputs };
    }
    const d = await PDFDocument.create();
    (await d.copyPages(src, pages)).forEach((p) => d.addPage(p));
    return { outputs: [{ name: `${base}_extracted.pdf`, blob: await savePdf(d) }] };
  },
};

interface OrgPage { src: number; rot: number }

export const organize: Tool = {
  id: 'organize-pdf', name: 'Organize PDF', category: CAT, icon: 'O', color: '#e5322d',
  description: 'Reorder, rotate and delete pages visually.',
  accept: 'application/pdf,.pdf', actionLabel: 'Save changes',
  async editor(host, files) {
    const doc = await openPdfJs(files[0]);
    const pages: OrgPage[] = [...Array(doc.numPages).keys()].map((i) => ({ src: i, rot: 0 }));
    const thumbs: HTMLCanvasElement[] = [];
    host.innerHTML = '<p class="muted small">Drag pages to reorder. Use the buttons to rotate or delete.</p>';
    const grid = document.createElement('div');
    grid.className = 'thumb-grid';
    host.appendChild(grid);
    for (let i = 1; i <= doc.numPages; i++) thumbs.push(await renderThumb(doc, i, 200));
    let dragFrom = -1;
    const draw = () => {
      grid.innerHTML = '';
      pages.forEach((p, idx) => {
        const card = document.createElement('div');
        card.className = 'thumb';
        card.draggable = true;
        const holder = document.createElement('div');
        holder.className = 'thumb-img';
        const img = document.createElement('img');
        img.src = thumbs[p.src].toDataURL();
        img.style.transform = `rotate(${p.rot}deg)`;
        holder.appendChild(img);
        card.appendChild(holder);
        const meta = document.createElement('div');
        meta.className = 'thumb-meta';
        meta.innerHTML = `<span>${idx + 1}</span>`;
        const mk = (label: string, title: string, fn: () => void) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'icon-btn'; b.title = title; b.textContent = label;
          b.onclick = () => { fn(); draw(); };
          meta.appendChild(b);
        };
        mk('⟲', 'Rotate left', () => (p.rot = (p.rot + 270) % 360));
        mk('⟳', 'Rotate right', () => (p.rot = (p.rot + 90) % 360));
        mk('⧉', 'Duplicate', () => pages.splice(idx + 1, 0, { ...p }));
        mk('🗑', 'Delete', () => { if (pages.length > 1) pages.splice(idx, 1); });
        card.appendChild(meta);
        card.ondragstart = () => { dragFrom = idx; card.classList.add('dragging'); };
        card.ondragend = () => card.classList.remove('dragging');
        card.ondragover = (e) => e.preventDefault();
        card.ondrop = (e) => {
          e.preventDefault();
          if (dragFrom < 0 || dragFrom === idx) return;
          const [moved] = pages.splice(dragFrom, 1);
          pages.splice(idx, 0, moved);
          dragFrom = -1;
          draw();
        };
        grid.appendChild(card);
      });
    };
    draw();
    return { getState: () => pages.map((p) => ({ ...p })), destroy: () => doc.loadingTask.destroy() };
  },
  async run({ files, editorState }) {
    const src = await loadPdf(files[0]);
    const out = await PDFDocument.create();
    const state = editorState as OrgPage[];
    const copied = await out.copyPages(src, state.map((p) => p.src));
    copied.forEach((page, i) => {
      page.setRotation(degrees((page.getRotation().angle + state[i].rot) % 360));
      out.addPage(page);
    });
    return { outputs: [{ name: `${baseName(files[0].name)}_organized.pdf`, blob: await savePdf(out) }] };
  },
};

const imagePageOptions = [
  { key: 'size', label: 'Page size', type: 'select' as const, default: 'fit', choices: [
    { value: 'fit', label: 'Same as image' }, { value: 'A4', label: 'A4' }, { value: 'Letter', label: 'US Letter' },
  ] },
  { key: 'orientation', label: 'Orientation', type: 'select' as const, default: 'auto', choices: [
    { value: 'auto', label: 'Automatic' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' },
  ], showIf: { key: 'size', values: ['A4', 'Letter'] } },
  { key: 'margin', label: 'Margin (pt)', type: 'number' as const, default: 0, min: 0, max: 144 },
];

async function enhanceScan(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // Grayscale + contrast stretch: makes paper white and text dark.
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.max(0, Math.min(255, (g - 60) * (255 / 150)));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvasToBlob(c, 'image/jpeg', 0.85);
}

export async function imagesToPdf(files: Blob[], opts: Record<string, any>, progress: (m: string, f?: number) => void): Promise<Blob> {
  const doc = await PDFDocument.create();
  const margin = Number(opts.margin) || 0;
  for (let i = 0; i < files.length; i++) {
    progress(`Adding image ${i + 1} of ${files.length}`, i / files.length);
    const im = await imageForPdf(files[i]);
    const emb = im.kind === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
    let pw: number, ph: number;
    if (opts.size === 'fit' || !PAGE_SIZES[opts.size]) {
      // 1 image pixel = 0.75pt (96 dpi)
      pw = im.w * 0.75 + margin * 2; ph = im.h * 0.75 + margin * 2;
    } else {
      [pw, ph] = PAGE_SIZES[opts.size];
      const land = opts.orientation === 'landscape' || (opts.orientation === 'auto' && im.w > im.h);
      if (land) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const s = Math.min((pw - margin * 2) / im.w, (ph - margin * 2) / im.h);
    const w = im.w * s, h = im.h * s;
    page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return savePdf(doc);
}

export const scanToPdf: Tool = {
  id: 'scan-pdf', name: 'Scan to PDF', category: CAT, icon: '📷', color: '#e5322d',
  description: 'Use your phone camera (or photos) to capture documents and turn them into a clean PDF.',
  accept: 'image/*', multiple: true, actionLabel: 'Create PDF',
  note: 'On a phone, tapping "Select files" lets you take photos with the camera.',
  options: [
    ...imagePageOptions.map((o) => (o.key === 'size' ? { ...o, default: 'A4' } : o.key === 'margin' ? { ...o, default: 18 } : o)),
    { key: 'enhance', label: 'Enhance as black & white document', type: 'checkbox', default: true },
  ],
  async run({ files, opts, progress }) {
    const imgs: Blob[] = [];
    for (const f of files) imgs.push(opts.enhance ? await enhanceScan(f) : f);
    return { outputs: [{ name: 'scan.pdf', blob: await imagesToPdf(imgs, opts, progress) }] };
  },
};

export const jpgToPdf: Tool = {
  id: 'jpg-to-pdf', name: 'JPG to PDF', category: 'Convert to PDF', icon: 'JPG', color: '#f0b400',
  description: 'Convert JPG, PNG, WebP or GIF images into a PDF.',
  accept: 'image/*', multiple: true, actionLabel: 'Convert to PDF',
  options: imagePageOptions,
  async run({ files, opts, progress }) {
    const name = files.length === 1 ? `${baseName(files[0].name)}.pdf` : 'images.pdf';
    return { outputs: [{ name, blob: await imagesToPdf(files, opts, progress) }] };
  },
};

