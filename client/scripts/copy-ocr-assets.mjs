// Copies the Tesseract.js worker + WebAssembly core into public/ so OCR works
// without loading code from a third-party CDN. (Language data is still fetched
// on first use, because bundling every language would add hundreds of MB.)
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'tesseract');
mkdirSync(out, { recursive: true });
cpSync(join(root, 'node_modules/tesseract.js/dist/worker.min.js'), join(out, 'worker.min.js'));
const core = join(root, 'node_modules/tesseract.js-core');
for (const f of readdirSync(core)) if (f.endsWith('.wasm.js')) cpSync(join(core, f), join(out, f));
console.log('OCR assets copied to public/tesseract');
