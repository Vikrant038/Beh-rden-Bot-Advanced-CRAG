/**
 * Type declarations for the pdf-parse submodule entry point.
 * `index.js` performs a top-level fs.readFileSync of a test fixture, so we
 * import `pdf-parse/lib/pdf-parse.js` instead (see §2.2.2). @types/pdf-parse
 * only declares the package root, so declare the submodule here.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  export interface PdfParseResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
    [key: string]: unknown;
  }

  export default function pdfParse(data: Buffer, options?: Record<string, unknown>): Promise<PdfParseResult>;
}
