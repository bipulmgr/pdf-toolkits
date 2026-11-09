import type { Tool } from './types';
import { baseName, openPdfJs, extractAllText, type TextLine } from '../lib/pdf';
import { escapeHtml } from '../lib/render-html';
import { paragraphs, bodySize } from './convert-from';

const CAT = 'PDF Intelligence';

async function readText(file: File, progress: (m: string, f?: number) => void) {
  const doc = await openPdfJs(file);
  const res = await extractAllText(doc, (i) => progress(`Reading page ${i} of ${doc.numPages}`, i / doc.numPages));
  await doc.loadingTask.destroy();
  return res;
}

const STOP = new Set(('a an and are as at be been but by can for from has have he her his i if in into is it its ' +
  'of on or our she so that the their them then there these they this to was we were what when which who will with ' +
  'would you your not no do does did than also may such more most other some any all each').split(' '));

/** Classic frequency-based extractive summary – runs offline, no AI service needed. */
export function extractiveSummary(text: string, count: number): string[] {
  const sentences = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim())
    .filter((s) => s.split(' ').length >= 6 && s.length < 600) ?? [];
  if (sentences.length <= count) return sentences;
  const freq = new Map<string, number>();
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [];
  for (const s of sentences) for (const w of words(s)) freq.set(w, (freq.get(w) || 0) + 1);
  const max = Math.max(...freq.values());
  const scored = sentences.map((s, i) => {
    const ws = words(s);
    const score = ws.reduce((a, w) => a + (freq.get(w)! / max), 0) / Math.sqrt(ws.length || 1);
    return { s, i, score: score * (i < sentences.length * 0.15 ? 1.2 : 1) }; // slight lead bias
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, count).sort((a, b) => a.i - b.i).map((x) => x.s);
}

/** Chrome's built-in on-device AI APIs, when present (Chrome 138+ desktop). */
const g = globalThis as any;

export const summarize: Tool = {
  id: 'pdf-summarize', name: 'AI Summarizer', category: CAT, icon: 'Σ', color: '#c2185b',
  description: 'Get the key points of a long PDF in seconds.',
  accept: 'application/pdf,.pdf', actionLabel: 'Summarize',
  note: 'Uses your browser\'s built-in on-device AI when available (Chrome), otherwise a free offline extractive summarizer. No text is sent anywhere.',
  options: [
    { key: 'length', label: 'Summary length', type: 'select', default: 'medium', choices: [
      { value: 'short', label: 'Short' }, { value: 'medium', label: 'Medium' }, { value: 'long', label: 'Long' },
    ] },
    { key: 'engine', label: 'Engine', type: 'select', default: 'auto', choices: [
      { value: 'auto', label: 'Best available' }, { value: 'extractive', label: 'Offline extractive (works everywhere)' },
    ] },
  ],
  async run({ files, opts, progress }) {
    const { text } = await readText(files[0], progress);
    if (!text.trim()) throw new Error('No text found. If this is a scan, run "OCR PDF" first.');
    let summary = '';
    let engine = 'Offline extractive summary';
    if (opts.engine === 'auto' && g.Summarizer) {
      try {
        if ((await g.Summarizer.availability()) !== 'unavailable') {
          progress('Running on-device AI (first use may download the model)…');
          const s = await g.Summarizer.create({ type: 'key-points', format: 'plain-text', length: opts.length });
          // Keep input inside the model's context window.
          summary = await s.summarize(text.slice(0, 12000));
          s.destroy?.();
          engine = 'Browser on-device AI';
        }
      } catch (e) { console.warn('Summarizer API failed, falling back', e); }
    }
    if (!summary) {
      const n = { short: 3, medium: 6, long: 10 }[opts.length as 'short'] ?? 6;
      summary = extractiveSummary(text, n).map((s) => `• ${s}`).join('\n');
    }
    if (!summary) throw new Error('Could not build a summary from this document.');
    const reportHtml = `<p class="muted small">${engine}</p><div class="summary">${escapeHtml(summary).replace(/\n/g, '<br>')}</div>`;
    return {
      outputs: [{ name: `${baseName(files[0].name)}_summary.txt`, blob: new Blob([summary], { type: 'text/plain' }) }],
      reportHtml,
    };
  },
};

const LANGS = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['nl', 'Dutch'], ['ru', 'Russian'], ['hi', 'Hindi'], ['ne', 'Nepali'], ['ar', 'Arabic'], ['zh', 'Chinese'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['tr', 'Turkish'], ['pl', 'Polish'],
].map(([value, label]) => ({ value, label }));

export const translate: Tool = {
  id: 'translate-pdf', name: 'Translate PDF', category: CAT, icon: '文A', color: '#c2185b',
  description: 'Translate the text of a PDF into another language.',
  accept: 'application/pdf,.pdf', actionLabel: 'Translate',
  note: 'Uses the browser\'s built-in on-device Translator (Chrome 138+ desktop). No text leaves your device. Output is a translated text/Word file.',
  options: [
    { key: 'from', label: 'From', type: 'select', default: 'en', choices: LANGS },
    { key: 'to', label: 'To', type: 'select', default: 'es', choices: LANGS },
    { key: 'format', label: 'Output', type: 'select', default: 'docx', choices: [
      { value: 'docx', label: 'Word (.docx)' }, { value: 'txt', label: 'Plain text (.txt)' },
    ] },
  ],
  async run({ files, opts, progress }) {
    if (!g.Translator) {
      throw new Error('Your browser does not provide the built-in Translator API. Open this page in a recent desktop Chrome or Edge to translate offline.');
    }
    if (opts.from === opts.to) throw new Error('Choose two different languages.');
    const avail = await g.Translator.availability({ sourceLanguage: opts.from, targetLanguage: opts.to });
    if (avail === 'unavailable') throw new Error(`Translation ${opts.from} → ${opts.to} is not supported by this browser.`);
    progress('Preparing translator (first use downloads the language pack)…');
    const tr = await g.Translator.create({
      sourceLanguage: opts.from, targetLanguage: opts.to,
      monitor(m: any) { m.addEventListener('downloadprogress', (e: any) => progress('Downloading language pack', e.loaded)); },
    });
    const { pages } = await readText(files[0], progress);
    const out: { page: number; text: string }[] = [];
    let k = 0;
    const total = pages.reduce((a, p) => a + p.length, 0) || 1;
    for (let i = 0; i < pages.length; i++) {
      for (const para of paragraphs(pages[i])) {
        progress(`Translating page ${i + 1} of ${pages.length}`, k++ / total);
        out.push({ page: i, text: await tr.translate(para.text) });
      }
    }
    tr.destroy?.();
    const base = `${baseName(files[0].name)}_${opts.to}`;
    if (opts.format === 'txt') {
      const txt = out.map((o) => o.text).join('\n\n');
      return { outputs: [{ name: `${base}.txt`, blob: new Blob([txt], { type: 'text/plain' }) }] };
    }
    const docx = await import('docx');
    let last = 0;
    const children = out.map((o) => {
      const p = new docx.Paragraph({ pageBreakBefore: o.page !== last, children: [new docx.TextRun(o.text)] });
      last = o.page;
      return p;
    });
    const blob = await docx.Packer.toBlob(new docx.Document({ sections: [{ children }] }));
    return { outputs: [{ name: `${base}.docx`, blob }] };
  },
};

export function linesToMarkdown(pages: TextLine[][], pageBreaks: boolean): string {
  const body = bodySize(pages);
  const md: string[] = [];
  pages.forEach((lines, i) => {
    if (i > 0 && pageBreaks) md.push('---');
    for (const p of paragraphs(lines)) {
      const r = p.size / body;
      let t = p.text.trim();
      if (!t) continue;
      if (/^[•●▪◦*–-]\s+/.test(t)) t = t.replace(/^[•●▪◦*–-]\s+/, '- ');
      else if (/^\d+[.)]\s+/.test(t)) t = t.replace(/^(\d+)[.)]\s+/, '$1. ');
      else if (r > 1.6 && t.length < 120) t = `# ${t}`;
      else if (r > 1.3 && t.length < 140) t = `## ${t}`;
      else if (r > 1.12 && t.length < 160) t = `### ${t}`;
      md.push(t);
    }
  });
  return md.join('\n\n') + '\n';
}

export const pdfToMarkdown: Tool = {
  id: 'pdf-to-markdown', name: 'PDF to Markdown', category: CAT, icon: 'MD', color: '#c2185b',
  description: 'Convert a PDF into clean Markdown with headings and lists.',
  accept: 'application/pdf,.pdf', actionLabel: 'Convert to Markdown',
  options: [{ key: 'breaks', label: 'Insert --- between pages', type: 'checkbox', default: false }],
  async run({ files, opts, progress }) {
    const { pages } = await readText(files[0], progress);
    const md = linesToMarkdown(pages, !!opts.breaks);
    if (!md.trim()) throw new Error('No text found. If this is a scan, run "OCR PDF" first.');
    return {
      outputs: [{ name: `${baseName(files[0].name)}.md`, blob: new Blob([md], { type: 'text/markdown' }) }],
      reportHtml: `<pre class="md-preview">${escapeHtml(md.slice(0, 20000))}</pre>`,
    };
  },
};
