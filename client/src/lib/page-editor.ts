import { openPdfJs, renderPage, PDFDocument, degrees, hexToRgb01, winAnsiSafe, type PDFDocumentProxy } from './pdf';
import { StandardFonts, rgb } from '@cantoo/pdf-lib';

/**
 * A small visual page editor: renders every page and lets the user place
 * text, boxes and images on top. All coordinates are stored in "display"
 * PDF points (scale 1 viewport, origin top-left, page rotation applied),
 * then mapped back to PDF user space when applied.
 */

export type EditMode = 'select' | 'text' | 'rect' | 'image';

export interface EditItem {
  id: number;
  page: number; // 0-based
  kind: 'text' | 'rect' | 'image';
  x: number; y: number; w: number; h: number;
  text?: string;
  size?: number;
  color?: string;
  dataUrl?: string;
}

export interface PageEditorConfig {
  modes: { mode: EditMode; label: string }[];
  initialMode: EditMode;
  textStyle?: () => { size: number; color: string };
  rectColor?: () => string;
  /** Returns a PNG data URL (and natural size) to place in "image" mode. */
  getImage?: () => Promise<{ dataUrl: string; w: number; h: number } | null>;
  hint?: string;
}

export interface PageEditor {
  items: () => EditItem[];
  pdfjsDoc: PDFDocumentProxy;
  destroy: () => void;
}

let nextId = 1;

export async function createPageEditor(host: HTMLElement, file: File, cfg: PageEditorConfig): Promise<PageEditor> {
  const doc = await openPdfJs(file);
  const items: EditItem[] = [];
  let mode: EditMode = cfg.initialMode;

  host.innerHTML = '';
  const bar = document.createElement('div');
  bar.className = 'editor-bar';
  host.appendChild(bar);
  for (const m of cfg.modes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (m.mode === mode ? ' active' : '');
    b.textContent = m.label;
    b.onclick = () => {
      mode = m.mode;
      bar.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
      pagesEl.dataset.mode = mode;
    };
    bar.appendChild(b);
  }
  if (cfg.hint) {
    const h = document.createElement('span');
    h.className = 'muted small';
    h.textContent = cfg.hint;
    bar.appendChild(h);
  }

  const pagesEl = document.createElement('div');
  pagesEl.className = 'editor-pages';
  pagesEl.dataset.mode = mode;
  host.appendChild(pagesEl);

  const width = Math.min(760, Math.max(280, host.clientWidth - 8));
  const overlays: { el: HTMLElement; scale: number }[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = width / vp1.width;
    const wrap = document.createElement('div');
    wrap.className = 'editor-page';
    wrap.style.width = `${vp1.width * scale}px`;
    wrap.style.height = `${vp1.height * scale}px`;
    const label = document.createElement('div');
    label.className = 'page-label';
    label.textContent = `Page ${p}`;
    pagesEl.appendChild(label);
    pagesEl.appendChild(wrap);
    // Render lazily-ish: at ~1.5x for crispness.
    const canvas = await renderPage(page, scale * Math.min(2, window.devicePixelRatio || 1));
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    wrap.appendChild(canvas);
    const overlay = document.createElement('div');
    overlay.className = 'editor-overlay';
    wrap.appendChild(overlay);
    overlays.push({ el: overlay, scale });
    attachOverlay(overlay, p - 1, scale);
  }

  function draw(item: EditItem) {
    const { el: overlay, scale } = overlays[item.page];
    let el = overlay.querySelector<HTMLElement>(`[data-id="${item.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.id = String(item.id);
      el.className = `edit-item edit-${item.kind}`;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'edit-del';
      del.title = 'Remove';
      del.textContent = '×';
      del.onpointerdown = (e) => e.stopPropagation();
      del.onclick = (e) => {
        e.stopPropagation();
        items.splice(items.indexOf(item), 1);
        el!.remove();
      };
      if (item.kind === 'text') {
        const span = document.createElement('span');
        el.appendChild(span);
        el.ondblclick = (e) => {
          e.stopPropagation();
          const t = prompt('Edit text', item.text);
          if (t !== null && t.trim()) { item.text = t; draw(item); }
        };
      } else if (item.kind === 'image') {
        const img = document.createElement('img');
        img.src = item.dataUrl!;
        img.draggable = false;
        el.appendChild(img);
      }
      if (item.kind !== 'text') {
        const handle = document.createElement('div');
        handle.className = 'edit-handle';
        el.appendChild(handle);
        handle.onpointerdown = (e) => startDrag(e, item, scale, 'resize');
      }
      el.appendChild(del);
      el.onpointerdown = (e) => startDrag(e, item, scale, 'move');
      overlay.appendChild(el);
    }
    el.style.left = `${item.x * scale}px`;
    el.style.top = `${item.y * scale}px`;
    if (item.kind === 'text') {
      const span = el.querySelector('span')!;
      span.textContent = item.text!;
      el.style.fontSize = `${item.size! * scale}px`;
      el.style.color = item.color!;
      el.style.width = 'auto';
      el.style.height = 'auto';
    } else {
      el.style.width = `${item.w * scale}px`;
      el.style.height = `${item.h * scale}px`;
      if (item.kind === 'rect') el.style.background = item.color!;
    }
  }

  function startDrag(e: PointerEvent, item: EditItem, scale: number, kind: 'move' | 'resize') {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const o = { x: item.x, y: item.y, w: item.w, h: item.h };
    const aspect = o.w / Math.max(1, o.h);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      if (kind === 'move') { item.x = o.x + dx; item.y = o.y + dy; }
      else {
        item.w = Math.max(8, o.w + dx);
        item.h = item.kind === 'image' ? item.w / aspect : Math.max(4, o.h + dy);
      }
      draw(item);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function attachOverlay(overlay: HTMLElement, pageIdx: number, scale: number) {
    overlay.onpointerdown = async (e) => {
      if (e.target !== overlay) return;
      const r = overlay.getBoundingClientRect();
      const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
      if (mode === 'text') {
        const text = prompt('Text to add');
        if (!text || !text.trim()) return;
        const st = cfg.textStyle?.() ?? { size: 14, color: '#000000' };
        const item: EditItem = { id: nextId++, page: pageIdx, kind: 'text', x, y, w: 0, h: st.size, text, size: st.size, color: st.color };
        items.push(item); draw(item);
      } else if (mode === 'image') {
        const img = await cfg.getImage?.();
        if (!img) return;
        const w = 160, h = (160 * img.h) / img.w;
        const item: EditItem = { id: nextId++, page: pageIdx, kind: 'image', x: x - w / 2, y: y - h / 2, w, h, dataUrl: img.dataUrl };
        items.push(item); draw(item);
      } else if (mode === 'rect') {
        e.preventDefault();
        const item: EditItem = { id: nextId++, page: pageIdx, kind: 'rect', x, y, w: 1, h: 1, color: cfg.rectColor?.() ?? '#000000' };
        items.push(item); draw(item);
        const move = (ev: PointerEvent) => {
          const cx = (ev.clientX - r.left) / scale, cy = (ev.clientY - r.top) / scale;
          item.x = Math.min(x, cx); item.y = Math.min(y, cy);
          item.w = Math.abs(cx - x); item.h = Math.abs(cy - y);
          draw(item);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (item.w < 3 || item.h < 3) {
            items.splice(items.indexOf(item), 1);
            overlay.querySelector(`[data-id="${item.id}"]`)?.remove();
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }
    };
  }

  return {
    items: () => items.map((i) => ({ ...i })),
    pdfjsDoc: doc,
    destroy: () => { doc.loadingTask.destroy(); },
  };
}

/** Draw editor items into a pdf-lib document (vector, text stays selectable). */
export async function applyItems(pdf: PDFDocument, pdfjsDoc: PDFDocumentProxy, items: EditItem[]): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const imgCache = new Map<string, any>();
  for (const it of items) {
    const page = pages[it.page];
    const vp = (await pdfjsDoc.getPage(it.page + 1)).getViewport({ scale: 1 });
    const rot = page.getRotation().angle % 360;
    const toPdf = (x: number, y: number) => vp.convertToPdfPoint(x, y) as [number, number];
    if (it.kind === 'rect') {
      const [x1, y1] = toPdf(it.x, it.y);
      const [x2, y2] = toPdf(it.x + it.w, it.y + it.h);
      const [r, g, b] = hexToRgb01(it.color || '#000000');
      page.drawRectangle({
        x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
        color: rgb(r, g, b),
      });
    } else if (it.kind === 'text') {
      const size = it.size || 14;
      const [r, g, b] = hexToRgb01(it.color || '#000000');
      // Display top-left of the text box -> baseline is roughly 0.8*size lower.
      const lines = winAnsiSafe(it.text || '').split(/\n/);
      lines.forEach((line, i) => {
        const [x, y] = toPdf(it.x, it.y + size * (0.82 + i * 1.2));
        page.drawText(line, { x, y, size, font, color: rgb(r, g, b), rotate: degrees(rot) });
      });
    } else if (it.kind === 'image' && it.dataUrl) {
      let img = imgCache.get(it.dataUrl);
      if (!img) { img = await pdf.embedPng(it.dataUrl); imgCache.set(it.dataUrl, img); }
      const [x, y] = toPdf(it.x, it.y + it.h);
      page.drawImage(img, { x, y, width: it.w, height: it.h, rotate: degrees(rot) });
    }
  }
}
