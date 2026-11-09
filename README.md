# PDF Toolkit

Free, open-source PDF tools that run **entirely in the browser**. No sign-up, no
upload, no server-side processing, no database. Deploy it as a static site on
GitHub Pages, or serve it from the included NestJS app.

## Tools (32)

| Category | Tools |
|---|---|
| Organize | Merge · Split · Remove pages · Extract pages · Organize (drag / rotate / delete / duplicate) · Scan to PDF |
| Optimize | Compress · Repair · OCR (searchable PDF, 14 languages) |
| Convert to PDF | JPG/PNG/WebP · Word (.docx) · PowerPoint (.pptx) · Excel (.xlsx/.xls/.ods/.csv) · HTML |
| Convert from PDF | JPG/PNG/WebP · Word (.docx) · PowerPoint (.pptx) · Excel (.xlsx) |
| Edit | Rotate · Page numbers · Watermark · Crop · Edit (text, boxes, images) · Fill forms |
| Security | Unlock · Protect (AES-256) · Sign · Redact (true redaction) · Compare |
| Intelligence | Summarize · Translate · PDF to Markdown |

## How it works

```
client/   Vite + TypeScript single-page app – all PDF processing lives here
server/   NestJS app that only serves client/dist (+ GET /api/health)
```

* **Files** are read from disk into memory and processed with WebAssembly/JS.
* **localStorage** keeps per-tool preferences (never passwords) and the theme.
* **IndexedDB** keeps your last 30 results under *My files* (localStorage is
  limited to ~5 MB of text, too small for PDFs).
* The only network request is the OCR language model, downloaded once from a
  public CDN the first time you run OCR.

## Run locally

```bash
npm run install:all
npm run dev            # http://localhost:5173 (Vite dev server)
```

With NestJS:

```bash
npm run build
npm start              # http://localhost:3000  (PORT env var to change)
```

## Deploy to GitHub Pages

1. Push this repository to GitHub (branch `main`).
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. The workflow in `.github/workflows/deploy-pages.yml` builds `client/` and
   publishes it. The site appears at `https://<user>.github.io/<repo>/`.

Hash-based routing (`#/merge-pdf`) is used, so deep links work on Pages without
any 404 redirect tricks.

## Known limitations (honest list)

* **Office → PDF** is done without Microsoft Office/LibreOffice. Word, Excel and
  HTML are rendered to images (the PDF looks right but text is not selectable).
  PowerPoint places text boxes and pictures at their positions but ignores
  charts, SmartArt, theme backgrounds and fonts. Legacy `.doc`/`.ppt` are not supported.
* **Compress** "Recommended/Extreme" re-renders pages as images (smaller, but text
  is no longer selectable). "Lossless" keeps everything but saves less.
* **PDF → Word/Excel** reconstruct paragraphs/columns from text positions; complex
  layouts are simplified. Scans need OCR first.
* **Translate** and the AI mode of **Summarize** use the browser's built-in
  on-device AI (Chrome 138+ desktop). Elsewhere, Summarize falls back to an offline
  extractive algorithm and Translate shows a message.
* **Sign** places a visual signature, not a certificate-based digital signature.
* **PDF/A** conversion is not included – producing validated PDF/A in a browser
  is not reliable.
* Text added by Edit/Sign/Page numbers uses Helvetica (Latin-1 characters only).

## Licenses

MIT for this project. Dependencies: pdf-lib (@cantoo fork, MIT), PDF.js
(Apache-2.0), Tesseract.js (Apache-2.0), Mammoth (BSD-2), SheetJS CE
(Apache-2.0), docx (MIT), PptxGenJS (MIT), html2canvas (MIT), JSZip (MIT),
NestJS (MIT). All are free for commercial use.

This is an independent project; it is not affiliated with any other PDF service.
