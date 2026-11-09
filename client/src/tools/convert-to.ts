import type { Tool } from './types';
import { PDFDocument, baseName, savePdf, winAnsiSafe, PAGE_SIZES } from '../lib/pdf';
import { htmlToPdf, escapeHtml } from '../lib/render-html';
import { StandardFonts, rgb } from '@cantoo/pdf-lib';

const CAT = 'Convert to PDF';

const pageOpts = [
  { key: 'pageSize', label: 'Page size', type: 'select' as const, default: 'A4', choices: Object.keys(PAGE_SIZES).map((k) => ({ value: k, label: k })) },
  { key: 'landscape', label: 'Landscape', type: 'checkbox' as const, default: false },
];

export const wordToPdf: Tool = {
  id: 'word-to-pdf', name: 'Word to PDF', category: CAT, icon: 'W', color: '#2b579a',
  description: 'Convert DOCX documents to PDF.',
  accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', multiple: true,
  note: 'Text, headings, lists, tables and images are converted. Complex layouts are simplified. Legacy .doc is not supported.',
  actionLabel: 'Convert to PDF', options: pageOpts,
  async run({ files, opts, progress }) {
    const mammoth = await import('mammoth');
    const outputs = [];
    for (let i = 0; i < files.length; i++) {
      progress(`Converting ${files[i].name}`, i / files.length);
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await files[i].arrayBuffer() });
      const blob = await htmlToPdf(value, { ...opts, css: 'p{margin:0 0 .6em} h1,h2,h3{margin:.8em 0 .4em}' });
      outputs.push({ name: `${baseName(files[i].name)}.pdf`, blob });
    }
    return { outputs };
  },
};

export const excelToPdf: Tool = {
  id: 'excel-to-pdf', name: 'Excel to PDF', category: CAT, icon: 'X', color: '#217346',
  description: 'Convert spreadsheets (XLSX, XLS, ODS, CSV) to PDF, one section per sheet.',
  accept: '.xlsx,.xls,.ods,.csv', multiple: true, actionLabel: 'Convert to PDF',
  options: [...pageOpts.map((o) => (o.key === 'landscape' ? { ...o, default: true } : o))],
  async run({ files, opts, progress }) {
    const XLSX = await import('xlsx');
    const outputs = [];
    for (let i = 0; i < files.length; i++) {
      progress(`Converting ${files[i].name}`, i / files.length);
      const wb = XLSX.read(await files[i].arrayBuffer(), { type: 'array' });
      const html = wb.SheetNames.map((n) => {
        const table = XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' });
        return `<h3 style="font-size:15px;margin:12px 0 6px">${escapeHtml(n)}</h3>${table}`;
      }).join('');
      outputs.push({ name: `${baseName(files[i].name)}.pdf`, blob: await htmlToPdf(html, opts) });
    }
    return { outputs };
  },
};

export const htmlToPdfTool: Tool = {
  id: 'html-to-pdf', name: 'HTML to PDF', category: CAT, icon: '</>', color: '#e44d26',
  description: 'Convert an HTML file (or pasted HTML) to PDF.',
  accept: '.html,.htm,text/html', minFiles: 0, actionLabel: 'Convert to PDF',
  note: 'Scripts are never executed. Remote images load only if their server allows cross-origin access. Web pages cannot be fetched by URL from a browser because of CORS – save the page as .html first.',
  options: [
    { key: 'html', label: 'Or paste HTML here', type: 'textarea', default: '', placeholder: '<h1>Hello</h1><p>World</p>' },
    ...pageOpts,
  ],
  async run({ files, opts }) {
    const html = files[0] ? await files[0].text() : String(opts.html || '');
    if (!html.trim()) throw new Error('Choose an HTML file or paste some HTML.');
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
    const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    const name = files[0] ? `${baseName(files[0].name)}.pdf` : 'page.pdf';
    return { outputs: [{ name, blob: await htmlToPdf(body, { ...opts, css: styles }) }] };
  },
};

// ---------- PowerPoint (.pptx) – lightweight layout renderer ----------

const EMU_PER_PT = 12700;

function attr(el: Element | null | undefined, name: string): string | null {
  return el ? el.getAttribute(name) : null;
}
function q(el: Element | Document, local: string): Element[] {
  return [...el.getElementsByTagNameNS('*', local)];
}
function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export const pptToPdf: Tool = {
  id: 'powerpoint-to-pdf', name: 'PowerPoint to PDF', category: CAT, icon: 'P', color: '#d24726',
  description: 'Convert PPTX slides to PDF pages.',
  accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', multiple: true,
  note: 'Text boxes and pictures are placed where they are on each slide; charts, SmartArt, theme backgrounds and animations are not rendered.',
  actionLabel: 'Convert to PDF',
  async run({ files, progress }) {
    const JSZip = (await import('jszip')).default;
    const outputs = [];
    for (const file of files) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const parse = async (p: string) => {
        const s = await zip.file(p)?.async('string');
        return s ? new DOMParser().parseFromString(s, 'application/xml') : null;
      };
      const pres = await parse('ppt/presentation.xml');
      const presRels = await parse('ppt/_rels/presentation.xml.rels');
      if (!pres || !presRels) throw new Error(`${file.name} is not a valid .pptx file.`);
      const sz = q(pres, 'sldSz')[0];
      const W = Number(attr(sz, 'cx') || 9144000) / EMU_PER_PT;
      const H = Number(attr(sz, 'cy') || 6858000) / EMU_PER_PT;
      const relMap = new Map(q(presRels, 'Relationship').map((r) => [attr(r, 'Id'), attr(r, 'Target')]));
      const slidePaths = q(pres, 'sldId').map((s) =>
        resolvePath('ppt/presentation.xml', relMap.get(s.getAttribute('r:id') || attr(s, 'id')) || ''));

      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

      for (let si = 0; si < slidePaths.length; si++) {
        progress(`${file.name}: slide ${si + 1} of ${slidePaths.length}`, si / slidePaths.length);
        const sp = slidePaths[si];
        const slide = await parse(sp);
        const page = pdf.addPage([W, H]);
        page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });
        if (!slide) continue;
        const relsPath = sp.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
        const rels = await parse(relsPath);
        const slideRels = new Map(rels ? q(rels, 'Relationship').map((r) => [attr(r, 'Id'), attr(r, 'Target')]) : []);

        const box = (el: Element) => {
          const xfrm = q(el, 'xfrm')[0];
          const off = xfrm && q(xfrm, 'off')[0];
          const ext = xfrm && q(xfrm, 'ext')[0];
          if (!off || !ext) return null;
          return {
            x: Number(attr(off, 'x')) / EMU_PER_PT, y: Number(attr(off, 'y')) / EMU_PER_PT,
            w: Number(attr(ext, 'cx')) / EMU_PER_PT, h: Number(attr(ext, 'cy')) / EMU_PER_PT,
          };
        };

        // Pictures
        for (const pic of q(slide, 'pic')) {
          const b = box(pic);
          const blip = q(pic, 'blip')[0];
          const rid = blip?.getAttribute('r:embed');
          const target = rid && slideRels.get(rid);
          if (!b || !target) continue;
          const path = resolvePath(sp, target);
          const data = await zip.file(path)?.async('uint8array');
          if (!data) continue;
          try {
            const img = /\.png$/i.test(path) ? await pdf.embedPng(data)
              : /\.jpe?g$/i.test(path) ? await pdf.embedJpg(data) : null;
            if (img) page.drawImage(img, { x: b.x, y: H - b.y - b.h, width: b.w, height: b.h });
          } catch { /* unsupported image */ }
        }

        // Text shapes
        for (const shape of q(slide, 'sp')) {
          const b = box(shape) ?? { x: 36, y: 36, w: W - 72, h: H - 72 };
          const fill = q(shape, 'spPr')[0]?.getElementsByTagNameNS('*', 'solidFill')[0];
          const fillHex = fill && attr(q(fill, 'srgbClr')[0], 'val');
          if (fillHex && fill?.parentElement?.localName === 'spPr') {
            const n = parseInt(fillHex, 16);
            page.drawRectangle({ x: b.x, y: H - b.y - b.h, width: b.w, height: b.h,
              color: rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255) });
          }
          const isTitle = q(shape, 'ph').some((ph) => /title/i.test(attr(ph, 'type') || ''));
          let cursor = b.y + 6;
          for (const para of q(shape, 'p')) {
            const runs = q(para, 'r');
            const text = winAnsiSafe(runs.map((r) => q(r, 't').map((t) => t.textContent).join('')).join(''));
            const rpr = runs[0] && q(runs[0], 'rPr')[0];
            const size = Number(attr(rpr, 'sz')) / 100 || (isTitle ? 32 : 18);
            const isBold = attr(rpr, 'b') === '1' || isTitle;
            const clr = rpr && attr(q(rpr, 'srgbClr')[0], 'val');
            const color = clr ? parseInt(clr, 16) : 0x222222;
            const bullet = q(para, 'buChar')[0] ? '- ' : '';
            const f = isBold ? bold : font;
            const algn = attr(q(para, 'pPr')[0], 'algn');
            // word wrap
            const words = (bullet + text).split(/\s+/);
            const lines: string[] = [];
            let cur = '';
            for (const w of words) {
              const t = cur ? cur + ' ' + w : w;
              if (f.widthOfTextAtSize(t, size) > b.w - 12 && cur) { lines.push(cur); cur = w; } else cur = t;
            }
            lines.push(cur);
            for (const line of lines) {
              cursor += size * 1.15;
              if (!line.trim()) continue;
              const lw = f.widthOfTextAtSize(line, size);
              const x = algn === 'ctr' ? b.x + (b.w - lw) / 2 : algn === 'r' ? b.x + b.w - lw - 6 : b.x + 6;
              page.drawText(line, { x, y: H - cursor, size, font: f,
                color: rgb(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255) });
            }
            cursor += size * 0.25;
          }
        }
      }
      outputs.push({ name: `${baseName(file.name)}.pdf`, blob: await savePdf(pdf) });
    }
    return { outputs };
  },
};

