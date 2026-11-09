import html2canvas from 'html2canvas';
import { PDFDocument, PAGE_SIZES, canvasToBlob, readBytes } from './pdf';

/**
 * Render an HTML string to a multi-page PDF entirely in the browser.
 * The HTML is placed in a sandboxed iframe WITHOUT `allow-scripts`, so any
 * script or inline event handler in the input never executes.
 */
export async function htmlToPdf(
  html: string,
  opts: { pageSize?: string; landscape?: boolean; margin?: number; css?: string } = {},
): Promise<Blob> {
  const [pw0, ph0] = PAGE_SIZES[opts.pageSize || 'A4'] || PAGE_SIZES.A4;
  const [pw, ph] = opts.landscape ? [ph0, pw0] : [pw0, ph0];
  const margin = opts.margin ?? 36;
  const cssWidth = Math.round(((pw - margin * 2) / 72) * 96); // points -> CSS px

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${cssWidth}px;height:1000px;border:0`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:#fff;color:#111;font:14px/1.45 Arial,Helvetica,sans-serif;width:${cssWidth}px}
        img{max-width:100%;height:auto} table{border-collapse:collapse} td,th{border:1px solid #bbb;padding:3px 6px;font-size:12px}
        ${opts.css || ''}</style></head><body><div id="__root" style="display:flow-root;background:#fff">${html}</div></body></html>`,
    );
    doc.close();
    await new Promise((r) => setTimeout(r, 50));
    await Promise.all(
      [...doc.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))),
    );
    const root = doc.getElementById('__root')!;
    const fullW = Math.max(cssWidth, Math.ceil(root.scrollWidth));
    iframe.style.width = fullW + 'px';
    const fullH = Math.max(1, Math.ceil(root.getBoundingClientRect().height));
    iframe.style.height = fullH + 'px';
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const canvas = await html2canvas(root, {
      backgroundColor: '#ffffff', scale: 2, width: fullW, height: fullH,
      windowWidth: fullW, windowHeight: fullH, logging: false, useCORS: true,
    });

    // Slice the tall canvas into page-sized chunks.
    const pdf = await PDFDocument.create();
    const contentW = pw - margin * 2;
    const contentH = ph - margin * 2;
    const pxPerPt = canvas.width / contentW; // fit width (wide tables are scaled down)
    const sliceH = Math.floor(contentH * pxPerPt);
    for (let y = 0; y < canvas.height; y += sliceH) {
      const h = Math.min(sliceH, canvas.height - y);
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = h;
      part.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      const img = await pdf.embedJpg(await readBytes(await canvasToBlob(part, 'image/jpeg', 0.9)));
      const page = pdf.addPage([pw, ph]);
      const drawH = h / pxPerPt;
      page.drawImage(img, { x: margin, y: ph - margin - drawH, width: contentW, height: drawH });
    }
    const bytes = await pdf.save();
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  } finally {
    iframe.remove();
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
