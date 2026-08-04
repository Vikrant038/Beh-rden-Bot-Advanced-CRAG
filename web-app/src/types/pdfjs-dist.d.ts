/**
 * Minimal ambient types for `pdfjs-dist/legacy/build/pdf.js` (the CJS legacy
 * build used by the ingest PDF parser fallback). We deliberately avoid the
 * outdated `@types/pdfjs-dist` package (typed for v2, noisily inaccurate for
 * v3) and declare only the surface the parser touches.
 */
declare module "pdfjs-dist/legacy/build/pdf.js" {
  export interface PdfJsTextItem {
    str: string;
  }

  export interface PdfJsTextContent {
    items: Array<PdfJsTextItem | { str?: string }>;
  }

  export interface PdfJsPage {
    getTextContent(): Promise<PdfJsTextContent>;
  }

  export interface PdfJsDocument {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfJsPage>;
    destroy(): Promise<void>;
  }

  export interface PdfJsLoadingTask {
    promise: Promise<PdfJsDocument>;
  }

  export function getDocument(src: {
    data: Uint8Array;
    useWorkerFetch?: boolean;
    isEvalSupported?: boolean;
  }): PdfJsLoadingTask;
}
