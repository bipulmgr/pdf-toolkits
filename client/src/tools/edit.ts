import type { Tool } from './types';
import { loadPdf, savePdf, baseName, parsePages, degrees, hexToRgb01, winAnsiSafe } from '../lib/pdf';
import { createPageEditor, applyItems, type PageEditor } from '../lib/page-editor';
import { StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } from '@cantoo/pdf-lib';
import { escapeHtml } from '../lib/render-html';

const CAT = 'Edit PDF';

export const rotate: Tool = {
  id: 'rotate-pdf', name: 'Rotate PDF', category: CAT, icon: '⟳', color: '#7b3fe4',
  description: 'Rotate all or selected pages.',
  accept: 'application/pdf,.pdf', multiple: true, actionLabel: 'Rotate PDF',
  options: [
    { key: 'angle', label: 'Rotation', type: 'select', default: '90', choices: [
      { value: '90', label: '90° clockwise' }, { value: '180', label: '180°' }, { value: '270', label: '90° counter-clockwise' },
    ] },
    { key: 'pages', label: 'Pages', type: 'text', default: 'all', placeholder: 'all or 1, 3-5' },
  ],
  async run({ files, opts }) {
    const outputs = [];
    for (const f of files) {
      const doc = await loadPdf(f);
      const pages = doc.getPages();
      for (const i of parsePages(opts.pages, pages.length)) {
        pages[i].setRotation(degrees((pages[i].getRotation().angle + Number(opts.angle)) % 360));
      }
      outputs.push({ name: `${baseName(f.name)}_rotated.pdf`, blob: await savePdf(doc) });
    }
    return { outputs };
  },
};

const POSITIONS = [
  ['bottom-center', 'Bottom center'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'],
  ['top-center', 'Top center'], ['top-right', 'Top right'], ['top-left', 'Top left'],
].map(([value, label]) => ({ value, label }));

export const pageNumbers: Tool = {
  id: 'add-page-numbers', name: 'Add page numbers', category: CAT, icon: '#', color: '#7b3fe4',
  description: 'Add page numbers with your choice of position, format and size.',
  accept: 'application/pdf,.pdf', actionLabel: 'Add page numbers',
  options: [
    { key: 'position', label: 'Position', type: 'select', default: 'bottom-center', choices: POSITIONS },
    { key: 'format', label: 'Format', type: 'select', default: '{n}', choices: [
      { value: '{n}', label: '1' }, { value: 'Page {n}', label: 'Page 1' },
      { value: 'Page {n} of {total}', label: 'Page 1 of 10' }, { value: '{n} / {total}', label: '1 / 10' },
    ] },
    { key: 'start', label: 'First number', type: 'number', default: 1 },
    { key: 'pages', label: 'Pages to number', type: 'text', default: 'all' },
    { key: 'size', label: 'Font size', type: 'number', default: 11, min: 6, max: 48 },
    { key: 'margin', label: 'Margin (pt)', type: 'number', default: 24, min: 0, max: 144 },
    { key: 'color', label: 'Color', type: 'color', default: '#000000' },
  ],
  async run({ files, opts }) {
    const doc = await loadPdf(files[0]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const targets = parsePages(opts.pages, pages.length);
    const size = Number(opts.size) || 11, m = Number(opts.margin) || 0;
    const [r, g, b] = hexToRgb01(opts.color);
    const total = targets.length + Number(opts.start) - 1;
    targets.forEach((idx, k) => {
      const page = pages[idx];
      const label = String(opts.format).replace('{n}', String(k + Number(opts.start))).replace('{total}', String(total));
      const tw = font.widthOfTextAtSize(label, size);
      placeText(page, label, tw, size, String(opts.position), m, (x, y, rot) =>
        page.drawText(label, { x, y, size, font, color: rgb(r, g, b), rotate: degrees(rot) }));
    });
    return { outputs: [{ name: `${baseName(files[0].name)}_numbered.pdf`, blob: await savePdf(doc) }] };
  },
};

/**
 * Position text relative to the page *as displayed* (honouring /Rotate and the crop box)
 * and call draw() with user-space coordinates.
 */
function placeText(
  page: any, _label: string, tw: number, size: number, position: string, m: number,
  draw: (x: number, y: number, rot: number) => void,
) {
  const box = page.getCropBox();
  const rot = page.getRotation().angle % 360;
  const swap = rot === 90 || rot === 270;
  const W = swap ? box.height : box.width, H = swap ? box.width : box.height;
  const [v, hpos] = position.split('-');
  const dx = hpos === 'left' ? m : hpos === 'right' ? W - m - tw : (W - tw) / 2;
  const dy = v === 'top' ? m + size : H - m; // baseline from display top
  // display (dx, dy) top-left origin -> user space
  let x: number, y: number;
  if (rot === 0) { x = box.x + dx; y = box.y + H - dy; }
  else if (rot === 90) { x = box.x + dy; y = box.y + dx; }
  else if (rot === 180) { x = box.x + W - dx; y = box.y + dy; }
  else { x = box.x + box.width - dy; y = box.y + box.height - dx; }
  draw(x, y, rot);
}

export const watermark: Tool = {
  id: 'add-watermark', name: 'Add watermark', category: CAT, icon: 'WM', color: '#7b3fe4',
  description: 'Stamp text over your PDF – choose size, transparency, angle and layout.',
  accept: 'application/pdf,.pdf', actionLabel: 'Add watermark',
  options: [
    { key: 'text', label: 'Watermark text', type: 'text', default: 'CONFIDENTIAL' },
    { key: 'layout', label: 'Layout', type: 'select', default: 'center', choices: [
      { value: 'center', label: 'Single, centered' }, { value: 'tile', label: 'Tiled (repeated)' },
    ] },
    { key: 'size', label: 'Font size', type: 'number', default: 60, min: 8, max: 200 },
    { key: 'opacity', label: 'Opacity (%)', type: 'range', default: 25, min: 5, max: 100 },
    { key: 'angle', label: 'Angle (°)', type: 'number', default: 45, min: -180, max: 180 },
    { key: 'color', label: 'Color', type: 'color', default: '#e5322d' },
    { key: 'pages', label: 'Pages', type: 'text', default: 'all' },
  ],
  async run({ files, opts }) {
    const text = winAnsiSafe(String(opts.text || '').trim());
    if (!text) throw new Error('Enter watermark text.');
    const doc = await loadPdf(files[0]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const size = Number(opts.size) || 60;
    const [r, g, b] = hexToRgb01(opts.color);
    const angle = Number(opts.angle) || 0;
    const rad = (angle * Math.PI) / 180;
    const tw = font.widthOfTextAtSize(text, size);
    const pages = doc.getPages();
    for (const i of parsePages(opts.pages, pages.length)) {
      const page = pages[i];
      const box = page.getCropBox();
      const stamp = (cx: number, cy: number) => {
        // rotate around the text centre
        const x = cx - (Math.cos(rad) * tw) / 2 + (Math.sin(rad) * size) / 3;
        const y = cy - (Math.sin(rad) * tw) / 2 - (Math.cos(rad) * size) / 3;
        page.drawText(text, { x, y, size, font, color: rgb(r, g, b), opacity: Number(opts.opacity) / 100, rotate: degrees(angle) });
      };
      if (opts.layout === 'tile') {
        const stepX = tw * 0.9 + 80, stepY = size * 3;
        for (let y = box.y; y < box.y + box.height + stepY; y += stepY)
          for (let x = box.x - tw / 2; x < box.x + box.width + tw; x += stepX) stamp(x, y);
      } else stamp(box.x + box.width / 2, box.y + box.height / 2);
    }
    return { outputs: [{ name: `${baseName(files[0].name)}_watermarked.pdf`, blob: await savePdf(doc) }] };
  },
};

export const crop: Tool = {
  id: 'crop-pdf', name: 'Crop PDF', category: CAT, icon: '⌗', color: '#7b3fe4',
  description: 'Trim the margins of your PDF pages.',
  accept: 'application/pdf,.pdf', actionLabel: 'Crop PDF',
  options: [
    { key: 'top', label: 'Top (%)', type: 'number', default: 5, min: 0, max: 45, step: 0.5 },
    { key: 'bottom', label: 'Bottom (%)', type: 'number', default: 5, min: 0, max: 45, step: 0.5 },
    { key: 'left', label: 'Left (%)', type: 'number', default: 5, min: 0, max: 45, step: 0.5 },
    { key: 'right', label: 'Right (%)', type: 'number', default: 5, min: 0, max: 45, step: 0.5 },
    { key: 'pages', label: 'Pages', type: 'text', default: 'all' },
  ],
  async run({ files, opts }) {
    const doc = await loadPdf(files[0]);
    const pages = doc.getPages();
    const pct = (k: string) => Math.min(45, Math.max(0, Number(opts[k]) || 0)) / 100;
    for (const i of parsePages(opts.pages, pages.length)) {
      const page = pages[i];
      const b = page.getCropBox();
      const rot = page.getRotation().angle % 360;
      // Map displayed sides to user-space sides for rotated pages.
      let [t, rr, bt, l] = [pct('top'), pct('right'), pct('bottom'), pct('left')];
      if (rot === 90) [t, rr, bt, l] = [rr, bt, l, t];
      else if (rot === 180) [t, rr, bt, l] = [bt, l, t, rr];
      else if (rot === 270) [t, rr, bt, l] = [l, t, rr, bt];
      const x = b.x + b.width * l, y = b.y + b.height * bt;
      const w = b.width * (1 - l - rr), h = b.height * (1 - t - bt);
      page.setCropBox(x, y, w, h);
      page.setMediaBox(x, y, w, h);
    }
    return { outputs: [{ name: `${baseName(files[0].name)}_cropped.pdf`, blob: await savePdf(doc) }] };
  },
};

export const editPdf: Tool = {
  id: 'edit-pdf', name: 'Edit PDF', category: CAT, icon: '✎', color: '#7b3fe4',
  description: 'Add text, white-out boxes and images on top of your PDF.',
  accept: 'application/pdf,.pdf', actionLabel: 'Save PDF',
  options: [
    { key: 'size', label: 'Text size', type: 'number', default: 14, min: 6, max: 96 },
    { key: 'color', label: 'Text / box color', type: 'color', default: '#000000' },
  ],
  async editor(host, files) {
    const optsEl = () => document.querySelector<HTMLFormElement>('#tool-options');
    const val = (k: string, d: string) => (optsEl()?.querySelector<HTMLInputElement>(`[name="${k}"]`)?.value ?? d);
    const ed: PageEditor = await createPageEditor(host, files[0], {
      modes: [
        { mode: 'text', label: 'Add text' }, { mode: 'rect', label: 'White-out box' },
        { mode: 'rect', label: 'Colored box' }, { mode: 'image', label: 'Add image' },
      ],
      initialMode: 'text',
      hint: 'Click a page to add. Drag to move, double-click text to edit.',
      textStyle: () => ({ size: Number(val('size', '14')), color: val('color', '#000000') }),
      rectColor: () => (host.querySelector('.chip.active')?.textContent === 'White-out box' ? '#ffffff' : val('color', '#000000')),
      getImage: pickImage,
    });
    return { getState: () => ({ items: ed.items(), doc: ed.pdfjsDoc }), destroy: () => ed.destroy() };
  },
  async run({ files, editorState }) {
    if (!editorState.items.length) throw new Error('Add something to the page first.');
    const doc = await loadPdf(files[0]);
    await applyItems(doc, editorState.doc, editorState.items);
    return { outputs: [{ name: `${baseName(files[0].name)}_edited.pdf`, blob: await savePdf(doc) }] };
  },
};

/** Ask the user for an image file and return it as a PNG data URL. */
export function pickImage(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const bmp = await createImageBitmap(f);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      resolve({ dataUrl: c.toDataURL('image/png'), w: bmp.width, h: bmp.height });
      bmp.close();
    };
    input.click();
  });
}

export const forms: Tool = {
  id: 'pdf-forms', name: 'PDF Forms', category: CAT, icon: '☑', color: '#7b3fe4',
  description: 'Fill in the interactive form fields of a PDF and optionally flatten them.',
  accept: 'application/pdf,.pdf', actionLabel: 'Save filled form',
  options: [{ key: 'flatten', label: 'Flatten (make fields non-editable)', type: 'checkbox', default: false }],
  async editor(host, files) {
    const doc = await loadPdf(files[0]);
    const fields = doc.getForm().getFields();
    host.innerHTML = '';
    if (!fields.length) {
      host.innerHTML = '<p class="warn">This PDF has no fillable form fields. Use <a href="#/edit-pdf">Edit PDF</a> to type on it instead.</p>';
      return { getState: () => ({}) };
    }
    const form = document.createElement('div');
    form.className = 'form-fields';
    for (const f of fields) {
      const name = f.getName();
      const row = document.createElement('label');
      row.className = 'field';
      row.innerHTML = `<span>${escapeHtml(name)}</span>`;
      let input: HTMLElement;
      if (f instanceof PDFTextField) {
        const multi = f.isMultiline();
        const el = document.createElement(multi ? 'textarea' : 'input') as HTMLInputElement;
        el.value = f.getText() || '';
        input = el;
      } else if (f instanceof PDFCheckBox) {
        const el = document.createElement('input');
        el.type = 'checkbox'; el.checked = f.isChecked();
        row.classList.add('check');
        input = el;
      } else if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup) {
        const el = document.createElement('select');
        const cur = f instanceof PDFRadioGroup ? f.getSelected() : f.getSelected()[0];
        el.innerHTML = '<option value="">—</option>' + f.getOptions()
          .map((o) => `<option ${o === cur ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
        input = el;
      } else continue;
      input.dataset.field = name;
      row.appendChild(input);
      form.appendChild(row);
    }
    host.appendChild(form);
    return {
      getState: () => Object.fromEntries([...form.querySelectorAll<HTMLInputElement>('[data-field]')]
        .map((el) => [el.dataset.field, el.type === 'checkbox' ? el.checked : el.value])),
    };
  },
  async run({ files, opts, editorState }) {
    const doc = await loadPdf(files[0]);
    const form = doc.getForm();
    for (const [name, value] of Object.entries(editorState as Record<string, string | boolean>)) {
      const f = form.getField(name);
      try {
        if (f instanceof PDFTextField) f.setText(String(value));
        else if (f instanceof PDFCheckBox) (value ? f.check() : f.uncheck());
        else if (f instanceof PDFDropdown || f instanceof PDFOptionList) (value ? f.select(String(value)) : f.clear());
        else if (f instanceof PDFRadioGroup) (value ? f.select(String(value)) : f.clear());
      } catch (e) { console.warn('Could not set', name, e); }
    }
    if (opts.flatten) form.flatten();
    return { outputs: [{ name: `${baseName(files[0].name)}_filled.pdf`, blob: await savePdf(doc) }] };
  },
};
