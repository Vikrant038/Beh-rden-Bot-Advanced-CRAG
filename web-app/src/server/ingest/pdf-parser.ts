import { PdfParseError } from "@/server/lib/errors";
import type { PdfParseResult } from "pdf-parse/lib/pdf-parse.js";

import { MAX_PDF_BYTES, ACCEPTED_MIME, MAX_PDF_PAGES } from "@/config/app";

// Re-exported so files that import from pdf-parser keep working.
export { MAX_PDF_BYTES, ACCEPTED_MIME, MAX_PDF_PAGES };

/**
 * Page-cap violations are parser-independent (a 250-page file is over the cap
 * for pdf-parse AND pdf.js), so they must NOT trigger the pdf.js fallback —
 * falling back would re-parse the whole document just to throw the same error.
 */
class PdfPageLimitError extends PdfParseError {}

export interface ParsedPdf {
  text: string;
  pages: number;
  metadata: Record<string, unknown>;
}

/**
 * Extracts raw text from an in-memory PDF buffer.
 *
 * Primary parser is `pdf-parse` (imported from the lib entry point to avoid
 * the upstream module-load bug where index.js tries to
 * fs.readFile('test/data/05-versions-space.pdf')).
 *
 * Fallback is Mozilla's `pdfjs-dist` (pdf.js): `pdf-parse`'s tokenizer-based
 * parser cannot read modern PDF 1.5+ files that use cross-reference streams /
 * object streams (they throw "Invalid PDF structure"), even though those files
 * are perfectly valid and open fine in browsers, poppler, etc. The official
 * BAMF / visa-form PDFs in the corpus are exactly this format, so we fall back
 * to pdf.js for any structurally-unparseable input.
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  if (buffer.length === 0) {
    throw new PdfParseError("Empty PDF buffer");
  }

  try {
    return await parseWithPdfParse(buffer);
  } catch (error) {
    if (error instanceof PdfPageLimitError) {
      // Over the page cap in any parser — rethrowing avoids a wasteful pdf.js
      // re-parse that would only throw the same error.
      throw error;
    }
    if (error instanceof PdfParseError) {
      // pdf-parse failed (invalid structure, scanned, init, …) — try pdf.js.
      // For genuinely scanned/image-only files this also yields no text, so the
      // caller gets the same clear "no extractable text" PdfParseError.
      return parseWithPdfJs(buffer);
    }
    throw error;
  }
}

async function parseWithPdfParse(buffer: Buffer): Promise<ParsedPdf> {
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
      throw new PdfPageLimitError(`PDF exceeds ${MAX_PDF_PAGES} pages`);
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

async function parseWithPdfJs(buffer: Buffer): Promise<ParsedPdf> {
  let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.js");
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  } catch {
    throw new PdfParseError("pdf.js fallback unavailable (pdfjs-dist not installed)");
  }

  try {
    // Zero-copy view of the Buffer (avoids doubling multi-MB files).
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const task = pdfjs.getDocument({ data: bytes });
    const doc = await task.promise;
    try {
      if (doc.numPages > MAX_PDF_PAGES) {
        throw new PdfPageLimitError(`PDF exceeds ${MAX_PDF_PAGES} pages`);
      }

      const parts: string[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item) => (typeof item.str === "string" ? item.str : ""))
          .join(" ");
        parts.push(pageText);
      }

      const text = parts
        .join("\n")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      if (!text) {
        throw new PdfParseError("PDF contains no extractable text (scanned/image-only?)");
      }
      return { text, pages: doc.numPages, metadata: {} };
    } finally {
      // Release pdf.js worker/document resources (matters for CLI batch runs
      // over dozens of PDFs in one process).
      try {
        await doc.destroy();
      } catch {
        // best-effort cleanup; ignore
      }
    }
  } catch (error) {
    if (error instanceof PdfParseError) {
      throw error;
    }
    throw new PdfParseError(`PDF parse failed (pdf.js): ${String(error)}`);
  }
}
