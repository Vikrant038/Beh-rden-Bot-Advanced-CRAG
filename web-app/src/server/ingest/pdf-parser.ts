import { PdfParseError } from "@/server/lib/errors";
import type { PdfParseResult } from "pdf-parse/lib/pdf-parse.js";

export const MAX_PDF_PAGES = 200;

/** Upload-side limits, kept here so the API route module only exports
 *  Next.js Route fields (runtime/maxDuration/HTTP verbs). */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_MIME = "application/pdf";

export interface ParsedPdf {
  text: string;
  pages: number;
  metadata: Record<string, unknown>;
}

/**
 * Extracts raw text from an in-memory PDF buffer using pdf-parse.
 * Imported from the lib entry point to avoid the upstream module-load bug
 * where index.js tries to fs.readFile('test/data/05-versions-space.pdf').
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  if (buffer.length === 0) {
    throw new PdfParseError("Empty PDF buffer");
  }

  let pdfParse: (data: Buffer, opts?: unknown) => Promise<PdfParseResult>;
  try {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    pdfParse = mod.default as (data: Buffer, opts?: unknown) => Promise<PdfParseResult>;
  } catch {
    throw new PdfParseError("pdf-parse failed to initialize (missing dependency?)");
  }

  try {
    const result = await pdfParse(buffer);
    if (!result.text || result.text.trim().length === 0) {
      throw new PdfParseError("PDF contains no extractable text (scanned/image-only?)");
    }
    if (result.numpages > MAX_PDF_PAGES) {
      throw new PdfParseError(`PDF exceeds ${MAX_PDF_PAGES} pages`);
    }
    return {
      text: result.text,
      pages: result.numpages,
      metadata: result.info ?? {},
    };
  } catch (error) {
    if (error instanceof PdfParseError) {
      throw error;
    }
    throw new PdfParseError(`PDF parse failed: ${String(error)}`);
  }
}
