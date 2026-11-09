import './styles/main.css';
import JSZip from 'jszip';
import { TOOLS, CATEGORIES, findTool } from './tools';
import type { Tool, ToolOption, EditorApi, RunResult } from './tools/types';
import { getPrefs, setPrefs, listFiles, saveFile, deleteFile, clearFiles, getSetting, setSetting } from './lib/storage';
import { escapeHtml } from './lib/render-html';

const app = document.getElementById('app')!;

// ---------- utilities ----------

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: (Node | string | null | undefined)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) (el as any)[k] = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) el.append(kid);
  return el;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function acceptsFile(tool: Tool, f: File) {
  return tool.accept.split(',').map((s) => s.trim().toLowerCase()).some((a) => {
    if (a.startsWith('.')) return f.name.toLowerCase().endsWith(a);
    if (a.endsWith('/*')) return f.type.startsWith(a.slice(0, -1));
    return f.type === a;
  });
}

/** Files handed over from a previous tool ("Continue with…"). */
let carryFiles: File[] = [];

// ---------- theme ----------

function applyTheme(t: string | null) {
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme(getSetting('theme'));

// ---------- layout ----------

function header() {
  const themeBtn = h('button', {
    class: 'icon-btn', title: 'Toggle dark mode', type: 'button',
    onclick: () => {
      const dark = document.documentElement.dataset.theme === 'dark' ||
        (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      const next = dark ? 'light' : 'dark';
      setSetting('theme', next);
      applyTheme(next);
    },
  }, '◐');
  return h('header', { class: 'topbar' },
    h('a', { href: '#/', class: 'brand' }, h('span', { class: 'logo' }, 'PDF'), h('span', {}, 'Toolkit')),
    h('nav', {},
      h('a', { href: '#/' }, 'All tools'),
      h('a', { href: '#/files' }, 'My files'),
      h('a', { href: '#/about' }, 'About'),
      themeBtn));
}

function footer() {
  return h('footer', { class: 'footer' },
    h('p', {}, 'Free & open source. Every file is processed in your browser – nothing is uploaded to any server.'),
  );
}

function shell(content: Node) {
  app.innerHTML = '';
  app.append(header(), h('main', { class: 'main' }, content), footer());
  window.scrollTo(0, 0);
}

// ---------- home ----------

function toolCard(t: Tool) {
  return h('a', { class: 'tool-card', href: `#/${t.id}` },
    h('span', { class: 'tool-icon', style: `--c:${t.color}` }, t.icon),
    h('h3', {}, t.name),
    h('p', {}, t.description));
}

function renderHome() {
  let cat = 'All';
  let query = '';
  const grid = h('div', { class: 'tool-grid' });
  const draw = () => {
    grid.innerHTML = '';
    const q = query.trim().toLowerCase();
    const list = TOOLS.filter((t) => (cat === 'All' || t.category === cat) &&
      (!q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)));
    list.forEach((t) => grid.appendChild(toolCard(t)));
    if (!list.length) grid.appendChild(h('p', { class: 'muted' }, 'No tools match your search.'));
  };
  const chips = h('div', { class: 'chips' });
  ['All', ...CATEGORIES].forEach((c) => {
    const b = h('button', { type: 'button', class: 'chip' + (c === cat ? ' active' : ''), onclick: () => {
      cat = c; chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === b)); draw();
    } }, c);
    chips.appendChild(b);
  });
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search tools…', 'aria-label': 'Search tools',
    oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; draw(); } });
  draw();
  shell(h('div', {},
    h('section', { class: 'hero' },
      h('h1', {}, 'Every tool you need to work with PDFs, in one place'),
      h('p', {}, `${TOOLS.length} free tools to merge, split, compress, convert, edit, sign and secure PDFs. ` +
        'Everything runs privately in your browser.'),
      search),
    chips, grid));
}

// ---------- options form ----------

function optionField(o: ToolOption, value: any): HTMLElement {
  const id = `opt-${o.key}`;
  let input: HTMLElement;
  switch (o.type) {
    case 'select':
      input = h('select', { id, name: o.key },
        ...(o.choices || []).map((c) => h('option', { value: c.value, selected: String(value) === c.value }, c.label)));
      break;
    case 'checkbox':
      input = h('input', { id, name: o.key, type: 'checkbox', checked: !!value });
      break;
    case 'textarea':
      input = h('textarea', { id, name: o.key, rows: 6, placeholder: o.placeholder || '' });
      (input as HTMLTextAreaElement).value = String(value ?? '');
      break;
    case 'range': {
      const out = h('output', {}, String(value));
      const r = h('input', { id, name: o.key, type: 'range', min: o.min, max: o.max, step: o.step || 1, value,
        oninput: (e: Event) => (out.textContent = (e.target as HTMLInputElement).value) });
      input = h('span', { class: 'range' }, r, out);
      break;
    }
    default:
      input = h('input', { id, name: o.key, type: o.type, value: value ?? '', placeholder: o.placeholder || '',
        min: o.min, max: o.max, step: o.step, autocomplete: o.type === 'password' ? 'new-password' : 'off' });
  }
  const wrap = h('div', { class: `field ${o.type === 'checkbox' ? 'check' : ''}`, 'data-key': o.key },
    o.type === 'checkbox' ? input : null,
    h('label', { for: id }, o.label),
    o.type !== 'checkbox' ? input : null,
    o.help ? h('small', { class: 'muted' }, o.help) : null);
  return wrap;
}

function readOptions(form: HTMLFormElement, tool: Tool): Record<string, any> {
  const out: Record<string, any> = {};
  for (const o of tool.options || []) {
    const el = form.querySelector<HTMLInputElement>(`[name="${o.key}"]`);
    if (!el) continue;
    out[o.key] = o.type === 'checkbox' ? el.checked : o.type === 'number' || o.type === 'range' ? Number(el.value) : el.value;
  }
  return out;
}

function updateVisibility(form: HTMLFormElement, tool: Tool) {
  const vals = readOptions(form, tool);
  for (const o of tool.options || []) {
    if (!o.showIf) continue;
    const show = o.showIf.values.includes(vals[o.showIf.key]);
    form.querySelector<HTMLElement>(`[data-key="${o.key}"]`)!.hidden = !show;
  }
}

// ---------- tool page ----------

function renderTool(tool: Tool) {
  let files: File[] = carryFiles.filter((f) => acceptsFile(tool, f));
  carryFiles = [];
  let editor: EditorApi | null = null;
  const minFiles = tool.minFiles ?? 1;
  const maxFiles = tool.maxFiles ?? (tool.multiple ? 100 : 1);

  const fileInput = h('input', { type: 'file', accept: tool.accept, multiple: !!tool.multiple, hidden: true,
    onchange: () => { addFiles([...(fileInput.files || [])]); fileInput.value = ''; } }) as HTMLInputElement;

  const body = h('div', { class: 'tool-body' });
  const page = h('div', { class: 'tool-page' },
    h('div', { class: 'tool-head' },
      h('span', { class: 'tool-icon big', style: `--c:${tool.color}` }, tool.icon),
      h('div', {}, h('h1', {}, tool.name), h('p', { class: 'lead' }, tool.description))),
    body, fileInput);
  shell(page);

  function addFiles(list: File[]) {
    const ok = list.filter((f) => acceptsFile(tool, f));
    if (ok.length < list.length) toast(`Some files were skipped – this tool accepts: ${tool.accept}`);
    files = tool.multiple ? [...files, ...ok].slice(0, maxFiles) : ok.slice(0, 1);
    if (files.length) drawWorkspace(); else drawDrop();
  }

  function drawDrop() {
    editor?.destroy?.(); editor = null;
    body.innerHTML = '';
    const zone = h('div', { class: 'dropzone', tabindex: 0, role: 'button',
      onclick: () => fileInput.click(),
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } } },
      h('button', { type: 'button', class: 'btn big' }, tool.multiple ? 'Select files' : 'Select file'),
      h('p', { class: 'muted' }, 'or drop files here'));
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('over'); };
    zone.ondragleave = () => zone.classList.remove('over');
    zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('over'); addFiles([...(e.dataTransfer?.files || [])]); };
    body.appendChild(zone);
    if (tool.note) body.appendChild(h('p', { class: 'note' }, tool.note));
    if (minFiles === 0) drawWorkspace(true);
  }

  async function drawWorkspace(append = false) {
    if (!append) { editor?.destroy?.(); editor = null; body.innerHTML = ''; }

    // file list
    if (files.length) {
      const list = h('ul', { class: 'file-list' });
      files.forEach((f, i) => {
        const li = h('li', {},
          h('span', { class: 'fname' }, f.name), h('span', { class: 'muted small' }, fmtSize(f.size)));
        const actions = h('span', { class: 'factions' });
        if (tool.multiple && files.length > 1) {
          actions.append(
            h('button', { type: 'button', class: 'icon-btn', title: 'Move up', disabled: i === 0,
              onclick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; drawWorkspace(); } }, '↑'),
            h('button', { type: 'button', class: 'icon-btn', title: 'Move down', disabled: i === files.length - 1,
              onclick: () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; drawWorkspace(); } }, '↓'));
        }
        actions.append(h('button', { type: 'button', class: 'icon-btn', title: 'Remove',
          onclick: () => { files.splice(i, 1); files.length ? drawWorkspace() : drawDrop(); } }, '✕'));
        li.appendChild(actions);
        list.appendChild(li);
      });
      body.appendChild(list);
      if (tool.multiple && files.length < maxFiles) {
        body.appendChild(h('button', { type: 'button', class: 'btn ghost', onclick: () => fileInput.click() }, '+ Add more files'));
      }
      if (tool.note) body.appendChild(h('p', { class: 'note' }, tool.note));
    }

    // options
    const prefs = getPrefs(tool.id);
    const form = h('form', { id: 'tool-options', class: 'options', onsubmit: (e: Event) => e.preventDefault() }) as HTMLFormElement;
    for (const o of tool.options || []) form.appendChild(optionField(o, prefs[o.key] ?? o.default));
    form.onchange = () => updateVisibility(form, tool);
    if (tool.options?.length) body.appendChild(form);
    updateVisibility(form, tool);

    // interactive editor
    const editorHost = h('div', { class: 'editor-host' });
    if (tool.editor && files.length) {
      body.appendChild(editorHost);
      editorHost.appendChild(h('p', { class: 'muted' }, 'Loading preview…'));
      try { editor = await tool.editor(editorHost, files); }
      catch (e) { editorHost.innerHTML = ''; editorHost.appendChild(h('p', { class: 'error' }, String((e as Error).message || e))); }
    }

    const status = h('div', { class: 'status' });
    const go = h('button', { type: 'button', class: 'btn big primary', onclick: () => run() }, tool.actionLabel);
    body.append(h('div', { class: 'actions' }, go), status);

    async function run() {
      if (files.length < minFiles) { toast(`Please select at least ${minFiles} file(s).`); return; }
      const opts = readOptions(form, tool);
      setPrefs(tool.id, opts);
      go.setAttribute('disabled', '');
      const bar = h('div', { class: 'progress' }, h('div', { class: 'bar' }));
      const label = h('p', { class: 'muted' }, 'Working…');
      status.innerHTML = '';
      status.append(label, bar);
      const t0 = performance.now();
      try {
        const result = await tool.run({
          files, opts, editorState: editor?.getState() ?? null,
          progress: (m, f) => {
            label.textContent = m;
            (bar.firstChild as HTMLElement).style.width = f === undefined ? '100%' : `${Math.round(Math.min(1, f) * 100)}%`;
            bar.classList.toggle('indeterminate', f === undefined);
          },
        });
        console.info(`${tool.id} finished in ${Math.round(performance.now() - t0)} ms`);
        editor?.destroy?.(); editor = null;
        await showResult(result);
      } catch (e) {
        console.error(e);
        status.innerHTML = '';
        status.appendChild(h('p', { class: 'error' }, String((e as Error)?.message || e)));
        go.removeAttribute('disabled');
      }
    }
  }

  async function showResult(result: RunResult) {
    body.innerHTML = '';
    const outs = result.outputs;
    for (const o of outs) await saveFile(o.name, o.blob, tool.name);
    const zipAll = async () => {
      const zip = new JSZip();
      const used = new Set<string>();
      for (const o of outs) {
        let n = o.name, k = 1;
        while (used.has(n)) n = o.name.replace(/(\.[^.]+)?$/, `_${k++}$1`);
        used.add(n);
        zip.file(n, o.blob);
      }
      download(await zip.generateAsync({ type: 'blob' }), `${tool.id}-files.zip`);
    };
    const main = outs.length === 1
      ? h('button', { type: 'button', class: 'btn big primary', onclick: () => download(outs[0].blob, outs[0].name) },
        `Download ${outs[0].name}`)
      : h('button', { type: 'button', class: 'btn big primary', onclick: zipAll }, `Download all (${outs.length} files, ZIP)`);

    const done = h('div', { class: 'result' },
      h('h2', {}, 'Done!'),
      result.message ? h('p', { class: 'lead' }, result.message) : null,
      main);
    if (outs.length > 1) {
      const list = h('ul', { class: 'file-list' });
      outs.forEach((o) => list.appendChild(h('li', {},
        h('span', { class: 'fname' }, o.name), h('span', { class: 'muted small' }, fmtSize(o.blob.size)),
        h('span', { class: 'factions' }, h('button', { type: 'button', class: 'icon-btn', title: 'Download',
          onclick: () => download(o.blob, o.name) }, '⬇')))));
      done.appendChild(list);
    }
    if (result.reportHtml) done.appendChild(h('div', { class: 'report', html: result.reportHtml }));

    // Continue with another tool
    const pdfs = outs.filter((o) => o.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length) {
      const next = ['compress-pdf', 'merge-pdf', 'split-pdf', 'protect-pdf', 'sign-pdf', 'add-page-numbers', 'add-watermark']
        .filter((id) => id !== tool.id).map((id) => findTool(id)!);
      done.appendChild(h('div', { class: 'continue' },
        h('p', { class: 'muted' }, 'Continue with:'),
        h('div', { class: 'chips' }, ...next.map((t) => h('button', { type: 'button', class: 'chip', onclick: () => {
          carryFiles = pdfs.map((o) => new File([o.blob], o.name, { type: 'application/pdf' }));
          location.hash = `#/${t.id}`;
        } }, t.name)))));
    }
    done.appendChild(h('button', { type: 'button', class: 'btn ghost', onclick: () => { files = []; drawDrop(); } }, 'Start over'));
    body.appendChild(done);
  }

  if (files.length) drawWorkspace(); else drawDrop();

  // Allow pasting/dropping anywhere on the page.
  page.ondragover = (e) => e.preventDefault();
  page.ondrop = (e) => {
    if ((e.target as HTMLElement).closest('.dropzone')) return;
    e.preventDefault();
    addFiles([...(e.dataTransfer?.files || [])]);
  };
}

// ---------- my files ----------

async function renderFiles() {
  const wrap = h('div', { class: 'tool-page' }, h('h1', {}, 'My files'),
    h('p', { class: 'lead' }, 'Your last 30 results are kept in this browser (IndexedDB) so you can download them again. They never leave your device.'));
  shell(wrap);
  const files = await listFiles();
  if (!files.length) { wrap.appendChild(h('p', { class: 'muted' }, 'No files yet.')); return; }
  const list = h('ul', { class: 'file-list' });
  for (const f of files) {
    const li = h('li', {},
      h('span', { class: 'fname' }, f.name),
      h('span', { class: 'muted small' }, `${f.tool} · ${fmtSize(f.size)} · ${new Date(f.created).toLocaleString()}`),
      h('span', { class: 'factions' },
        h('button', { type: 'button', class: 'icon-btn', title: 'Download', onclick: () => download(f.blob, f.name) }, '⬇'),
        h('button', { type: 'button', class: 'icon-btn', title: 'Delete', onclick: async () => { await deleteFile(f.id); li.remove(); } }, '✕')));
    list.appendChild(li);
  }
  wrap.append(list, h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
    if (confirm('Delete all stored files?')) { await clearFiles(); renderFiles(); }
  } }, 'Clear all'));
}

function renderAbout() {
  shell(h('div', { class: 'tool-page prose' },
    h('h1', {}, 'About PDF Toolkit'),
    h('p', {}, 'PDF Toolkit is a free, open-source collection of PDF utilities. There are no accounts, no limits, no watermarks and no uploads: ' +
      'all processing happens with JavaScript and WebAssembly inside your browser.'),
    h('h2', {}, 'Privacy'),
    h('p', {}, 'Files are read directly from your disk into memory. Results are stored only in your browser (IndexedDB) under "My files". ' +
      'Preferences are stored in localStorage. The only network requests are for OCR language data, downloaded once from a public CDN when you use OCR.'),
    h('h2', {}, 'Built with'),
    h('ul', { html: ['pdf-lib (@cantoo fork) – MIT', 'PDF.js – Apache-2.0', 'Tesseract.js – Apache-2.0', 'Mammoth – BSD-2', 'SheetJS CE – Apache-2.0',
      'docx – MIT', 'PptxGenJS – MIT', 'html2canvas – MIT', 'JSZip – MIT'].map((x) => `<li>${escapeHtml(x)}</li>`).join('') }),
  ));
}

// ---------- toast & router ----------

function toast(msg: string) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function route() {
  const id = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('dialog').forEach((d) => d.remove());
  if (!id) { document.title = 'PDF Toolkit – free PDF tools'; return renderHome(); }
  if (id === 'files') { document.title = 'My files – PDF Toolkit'; return renderFiles(); }
  if (id === 'about') { document.title = 'About – PDF Toolkit'; return renderAbout(); }
  const tool = findTool(id);
  if (!tool) return renderHome();
  document.title = `${tool.name} – PDF Toolkit`;
  renderTool(tool);
}

window.addEventListener('hashchange', route);
route();
