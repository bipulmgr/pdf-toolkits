import type { Tool } from './types';
import { merge, split, removePages, extractPages, organize, scanToPdf, jpgToPdf } from './organize';
import { compress, repair, ocr } from './optimize';
import { wordToPdf, pptToPdf, excelToPdf, htmlToPdfTool } from './convert-to';
import { pdfToJpg, pdfToWord, pdfToPpt, pdfToExcel } from './convert-from';
import { rotate, pageNumbers, watermark, crop, editPdf, forms } from './edit';
import { unlock, protect, sign, redact, compare } from './security';
import { summarize, translate, pdfToMarkdown } from './intelligence';

export const CATEGORIES = [
  'Organize PDF', 'Optimize PDF', 'Convert to PDF', 'Convert from PDF', 'Edit PDF', 'PDF security', 'PDF Intelligence',
];

export const TOOLS: Tool[] = [
  merge, split, removePages, extractPages, organize, scanToPdf,
  compress, repair, ocr,
  jpgToPdf, wordToPdf, pptToPdf, excelToPdf, htmlToPdfTool,
  pdfToJpg, pdfToWord, pdfToPpt, pdfToExcel,
  rotate, pageNumbers, watermark, crop, editPdf, forms,
  unlock, protect, sign, redact, compare,
  summarize, translate, pdfToMarkdown,
];

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id);
}
