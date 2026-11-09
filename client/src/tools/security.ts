import type { Tool } from './types';
import * as pdfjs from 'pdfjs-dist';
import {
  PDFDocument, loadPdf, savePdf, baseName, readBytes, openPdfJs, renderPage, canvasToBlob, pageLines,
} from '../lib/pdf';
import { createPageEditor, applyItems, type PageEditor, type EditItem } from '../lib/page-editor';
import { escapeHtml } from '../lib/render-html';
import { pickImage } from './edit';

const CAT = 'PDF security';

export const unlock: Tool = {
  id: 'unlock-pdf', name: 'Unlock PDF', category: CAT, icon: '🔓', color: '#0a7cc1',
  description: 'Remove the password and restrictions from a PDF you have the password for.',
  accept: 'application/pdf,.pdf', actionLabel: 'Unlock PDF',
  note: 'Only unlock documents you own or are allowed to edit.',
  options: [{ key: 'password', label: 'Password (leave empty if the PDF only has permission restrictions)', type: 'password', default: '' }],
  async run({ files, opts }) {
    const bytes = await readBytes(files[0]);
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { password: String(opts.password ?? ''), updateMetadata: false });
    } catch (e) {
      throw new Error(/password/i.test(String(e)) || opts.password
        ? 'Incorrect password.' : `Could not open this PDF: ${(e as Error).message}`);
    }
    if (!doc.isEncrypted && !opts.password) {
      // Not encrypted at all – nothing to do but still return a clean copy.
      return { outputs: [{ name: `${baseName(files[0].name)}_unlocked.pdf`, blob: await savePdf(doc) }], message: 'This PDF was not protected.' };
    }
    return { outputs: [{ name: `${baseName(files[0].name)}_unlocked.pdf`, blob: await savePdf(doc) }] };
  },
};

export const protect: Tool = {
  id: 'protect-pdf', name: 'Protect PDF', category: CAT, icon: '🔒', color: '#0a7cc1',
  description: 'Encrypt a PDF with a password (AES-256) and set permissions.',
  accept: 'application/pdf,.pdf', actionLabel: 'Protect PDF',
  options: [
    { key: 'password', label: 'Password to open', type: 'password', default: '' },
    { key: 'password2', label: 'Repeat password', type: 'password', default: '' },
    { key: 'ownerPassword', label: 'Owner password (optional – needed to change permissions)', type: 'password', default: '' },
    { key: 'printing', label: 'Allow printing', type: 'checkbox', default: true },
    { key: 'copying', label: 'Allow copying text', type: 'checkbox', default: true },
    { key: 'modifying', label: 'Allow editing', type: 'checkbox', default: false },
  ],
  async run({ files, opts }) {
    const pw = String(opts.password || '');
    if (pw.length < 1) throw new Error('Enter a password.');
    if (pw !== opts.password2) throw new Error('Passwords do not match.');
    const doc = await loadPdf(files[0]);
    const owner = String(opts.ownerPassword || '') || crypto.getRandomValues(new Uint32Array(4)).join('-');
    doc.encrypt({
      userPassword: pw, ownerPassword: owner, algorithm: 'AES-256',
      permissions: {
        printing: opts.printing ? 'highResolution' : false, copying: !!opts.copying, modifying: !!opts.modifying,
        annotating: !!opts.modifying, fillingForms: true, contentAccessibility: true, documentAssembly: !!opts.modifying,
      },
    });
    return { outputs: [{ name: `${baseName(files[0].name)}_protected.pdf`, blob: await savePdf(doc) }] };
  },
};

// ---------- Signature pad ----------

function signatureDialog(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'sig-dialog';
    dlg.innerHTML = `
      <h3>Create your signature</h3>
      <div class="tabs"><button type="button" data-t="draw" class="chip active">Draw</button>
        <button type="button" data-t="type" class="chip">Type</button>
        <button type="button" data-t="upload" class="chip">Upload</button></div>
      <canvas width="600" height="200" class="sig-pad"></canvas>
      <input class="sig-text" placeholder="Type your name" hidden>
      <div class="sig-row"><label>Color <input type="color" class="sig-color" value="#1a237e"></label>
        <button type="button" class="btn ghost sig-clear">Clear</button></div>
      <div class="sig-row end"><button type="button" class="btn ghost sig-cancel">Cancel</button>
        <button type="button" class="btn sig-ok">Use signature</button></div>`;
    document.body.appendChild(dlg);
    const canvas = dlg.querySelector<HTMLCanvasElement>('canvas')!;
    const ctx = canvas.getContext('2d')!;
    const text = dlg.querySelector<HTMLInputElement>('.sig-text')!;
    const color = dlg.querySelector<HTMLInputElement>('.sig-color')!;
    let tab = 'draw';
    let drawing = false;
    const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
    const typed = () => {
      clear();
      ctx.fillStyle = color.value;
      ctx.font = 'italic 72px "Segoe Script","Brush Script MT","Snell Roundhand",cursive';
      ctx.textBaseline = 'middle';
      ctx.fillText(text.value, 20, 100, 560);
    };
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
    };
    canvas.onpointerdown = (e) => {
      if (tab !== 'draw') return;
      drawing = true;
      canvas.setPointerCapture(e.pointerId);
      ctx.strokeStyle = color.value; ctx.lineWidth = 3.5; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath(); const [x, y] = pos(e); ctx.moveTo(x, y);
    };
    canvas.onpointermove = (e) => { if (drawing) { const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); } };
    canvas.onpointerup = () => (drawing = false);
    text.oninput = typed;
    color.oninput = () => tab === 'type' && typed();
    dlg.querySelector<HTMLButtonElement>('.sig-clear')!.onclick = () => { clear(); text.value = ''; };
    dlg.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((b) => (b.onclick = async () => {
      if (b.dataset.t === 'upload') {
        const img = await pickImage();
        if (img) { dlg.close(); dlg.remove(); resolve(img); }
        return;
      }
      tab = b.dataset.t!;
      dlg.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x === b));
      text.hidden = tab !== 'type';
      clear();
      if (tab === 'type') text.focus();
    }));
    const finish = (val: any) => { dlg.close(); dlg.remove(); resolve(val); };
    dlg.querySelector<HTMLButtonElement>('.sig-cancel')!.onclick = () => finish(null);
    dlg.querySelector<HTMLButtonElement>('.sig-ok')!.onclick = () => {
      // Trim transparent borders.
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let x0 = width, y0 = height, x1 = -1, y1 = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      if (x1 < 0) return finish(null);
      const pad = 6;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
      x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
      const out = document.createElement('canvas');
      out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
      out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      finish({ dataUrl: out.toDataURL('image/png'), w: out.width, h: out.height });
    };
    dlg.addEventListener('cancel', () => finish(null));
    dlg.showModal();
  });
}

export const sign: Tool = {
  id: 'sign-pdf', name: 'Sign PDF', category: CAT, icon: '✍', color: '#0a7cc1',
  description: 'Draw, type or upload your signature and place it on the document.',
  accept: 'application/pdf,.pdf', actionLabel: 'Sign PDF',
  note: 'This adds a visual signature image. It is not a certificate-based digital signature.',
  options: [{ key: 'size', label: 'Text size (for name / date)', type: 'number', default: 12, min: 6, max: 48 }],
  async editor(host, files) {
    let sig: { dataUrl: string; w: number; h: number } | null = null;
    const ed: PageEditor = await createPageEditor(host, files[0], {
      modes: [{ mode: 'image', label: 'Place signature' }, { mode: 'text', label: 'Add text / date' }],
      initialMode: 'image',
      hint: 'Click where the signature should go. Drag to move, drag the corner to resize.',
      textStyle: () => ({
        size: Number(document.querySelector<HTMLInputElement>('#tool-options [name="size"]')?.value || 12),
        color: '#000000',
      }),
      getImage: async () => (sig ??= await signatureDialog()),
    });
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'chip'; reset.textContent = 'New signature';
    reset.onclick = async () => { sig = await signatureDialog() ?? sig; };
    host.querySelector('.editor-bar')!.appendChild(reset);
    return { getState: () => ({ items: ed.items(), doc: ed.pdfjsDoc }), destroy: () => ed.destroy() };
  },
  async run({ files, editorState }) {
    if (!editorState.items.length) throw new Error('Place your signature on a page first.');
    const doc = await loadPdf(files[0]);
    await applyItems(doc, editorState.doc, editorState.items);
    return { outputs: [{ name: `${baseName(files[0].name)}_signed.pdf`, blob: await savePdf(doc) }] };
  },
};

// ---------- Redaction ----------

async function findTextBoxes(doc: pdfjs.PDFDocumentProxy, terms: string[]): Promise<EditItem[]> {
  const out: EditItem[] = [];
  const needles = terms.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!needles.length) return out;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items as any[]) {
      if (!it.str) continue;
      const low = it.str.toLowerCase();
      const tx = pdfjs.Util.transform(vp.transform, it.transform);
      const h = Math.hypot(tx[2], tx[3]) || 10;
      const charW = (it.width * vp.scale) / Math.max(1, it.str.length);
      for (const n of needles) {
        let idx = low.indexOf(n);
        while (idx >= 0) {
          out.push({
            id: 0, page: p - 1, kind: 'rect', color: '#000000',
            x: tx[4] + idx * charW - 1, y: tx[5] - h - 1, w: n.length * charW + 2, h: h * 1.25 + 2,
          });
          idx = low.indexOf(n, idx + n.length);
        }
      }
    }
  }
  return out;
}

export const redact: Tool = {
  id: 'redact-pdf', name: 'Redact PDF', category: CAT, icon: '▮', color: '#0a7cc1',
  description: 'Permanently black out sensitive text and areas.',
  accept: 'application/pdf,.pdf', actionLabel: 'Redact PDF',
  note: 'Redacted pages are re-rendered as images so the hidden content is truly removed, not just covered.',
  options: [
    { key: 'terms', label: 'Words or phrases to redact (comma separated)', type: 'text', default: '', placeholder: 'e.g. John Smith, 555-0100' },
    { key: 'dpi', label: 'Quality of redacted pages', type: 'select', default: '200', choices: [
      { value: '150', label: 'Standard (150 dpi)' }, { value: '200', label: 'High (200 dpi)' }, { value: '300', label: 'Print (300 dpi)' },
    ] },
  ],
  async editor(host, files) {
    const ed = await createPageEditor(host, files[0], {
      modes: [{ mode: 'rect', label: 'Draw redaction box' }],
      initialMode: 'rect', rectColor: () => '#000000',
      hint: 'Drag over areas to black out. Search terms (above) are found automatically.',
    });
    return { getState: () => ({ items: ed.items() }), destroy: () => ed.destroy() };
  },
  async run({ files, opts, editorState, progress }) {
    const bytes = await readBytes(files[0]);
    const js = await openPdfJs(bytes);
    const terms = String(opts.terms || '').split(',');
    const boxes: EditItem[] = [...editorState.items, ...(await findTextBoxes(js, terms))];
    if (!boxes.length) throw new Error('Nothing to redact: draw boxes or enter words to find.');
    const src = await loadPdf(bytes);
    const out = await PDFDocument.create();
    const scale = Number(opts.dpi) / 72;
    for (let i = 0; i < js.numPages; i++) {
      const mine = boxes.filter((b) => b.page === i);
      if (!mine.length) {
        out.addPage((await out.copyPages(src, [i]))[0]);
        continue;
      }
      progress(`Redacting page ${i + 1}`, i / js.numPages);
      const page = await js.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 });
      const canvas = await renderPage(page, scale);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#000';
      for (const b of mine) ctx.fillRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
      const img = await out.embedPng(await readBytes(await canvasToBlob(canvas, 'image/png')));
      const p = out.addPage([vp.width, vp.height]);
      p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    }
    await js.loadingTask.destroy();
    out.setProducer('PDF Toolkit'); out.setCreator('PDF Toolkit');
    const found = boxes.length - editorState.items.length;
    return {
      outputs: [{ name: `${baseName(files[0].name)}_redacted.pdf`, blob: await savePdf(out) }],
      message: `${boxes.length} area(s) redacted${found ? ` (${found} found by search)` : ''}.`,
    };
  },
};

// ---------- Compare ----------

type Op = { t: ' ' | '+' | '-'; s: string };

/** Line diff (LCS). Fine for per-page comparisons. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: '-', s: a[i++] });
    else ops.push({ t: '+', s: b[j++] });
  }
  while (i < n) ops.push({ t: '-', s: a[i++] });
  while (j < m) ops.push({ t: '+', s: b[j++] });
  return ops;
}

export const compare: Tool = {
  id: 'compare-pdf', name: 'Compare PDF', category: CAT, icon: '⇄', color: '#0a7cc1',
  description: 'Show the text differences between two versions of a document.',
  accept: 'application/pdf,.pdf', multiple: true, minFiles: 2, maxFiles: 2,
  note: 'Select the original first and the new version second.',
  actionLabel: 'Compare',
  async run({ files, progress }) {
    const [a, b] = await Promise.all(files.map((f) => openPdfJs(f)));
    const pages = Math.max(a.numPages, b.numPages);
    let added = 0, removed = 0;
    const sections: string[] = [];
    for (let p = 1; p <= pages; p++) {
      progress(`Comparing page ${p}`, p / pages);
      const la = p <= a.numPages ? (await pageLines(await a.getPage(p))).map((l) => l.text) : [];
      const lb = p <= b.numPages ? (await pageLines(await b.getPage(p))).map((l) => l.text) : [];
      const ops = diffLines(la, lb);
      const changed = ops.filter((o) => o.t !== ' ');
      added += changed.filter((o) => o.t === '+').length;
      removed += changed.filter((o) => o.t === '-').length;
      if (!changed.length) continue;
      sections.push(`<h3>Page ${p}</h3><div class="diff">${ops.map((o) =>
        `<div class="d${o.t === '+' ? 'add' : o.t === '-' ? 'del' : 'same'}"><b>${o.t === ' ' ? '&nbsp;' : o.t}</b>${escapeHtml(o.s) || '&nbsp;'}</div>`).join('')}</div>`);
    }
    await a.loadingTask.destroy(); await b.loadingTask.destroy();
    const summary = sections.length
      ? `<p><strong>${removed}</strong> line(s) removed, <strong>${added}</strong> line(s) added across ${sections.length} page(s).</p>`
      : '<p><strong>No text differences found.</strong></p>';
    const reportHtml = `<p class="muted small">Original: ${escapeHtml(files[0].name)} · New: ${escapeHtml(files[1].name)}</p>${summary}${sections.join('')}`;
    const css = `body{font:14px system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px}.diff{font:13px ui-monospace,monospace;border:1px solid #ddd;border-radius:6px;overflow:hidden}.diff div{padding:2px 8px;white-space:pre-wrap}.diff b{display:inline-block;width:1.2em;color:#888}.dadd{background:#e6ffec}.ddel{background:#ffebe9;text-decoration:line-through}.dsame{color:#666}`;
    const file = `<!doctype html><meta charset="utf-8"><title>PDF comparison</title><style>${css}</style><h1>PDF comparison</h1>${reportHtml}`;
    return { outputs: [{ name: 'comparison.html', blob: new Blob([file], { type: 'text/html' }) }], reportHtml };
  },
};
