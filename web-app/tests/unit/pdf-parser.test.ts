import { vi, describe, it, expect, beforeEach } from "vitest";
import { PdfParseError } from "@/server/lib/errors/domain-error";

const mockPdfParse = vi.fn();
const mockPdfJsGetDocument = vi.fn();

vi.mock("pdf-parse/lib/pdf-parse.js", () => ({
  default: (...args: unknown[]) => mockPdfParse(...args),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.js", () => ({
  getDocument: (...args: unknown[]) => mockPdfJsGetDocument(...args),
}));

import { parsePdf, MAX_PDF_BYTES, MAX_PDF_PAGES, ACCEPTED_MIME } from "@/server/ingest/pdf-parser";

function validResult(overrides: Record<string, unknown> = {}) {
  return {
    text: "German student visa application guide with requirements and process.",
    numpages: 3,
    info: { Title: "Visa Guide" },
    ...overrides,
  };
}

/** A minimal pdf.js document whose pages return the given per-page text items. */
function pdfJsDoc(pageTexts: string[]) {
  return {
    numPages: pageTexts.length,
    getPage: (n: number) =>
      Promise.resolve({
        getTextContent: () =>
          Promise.resolve({ items: pageTexts[n - 1].split(" ").map((str) => ({ str })) }),
      }),
    destroy: () => Promise.resolve(),
  };
}

describe("parsePdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts text, page count, and metadata from a valid PDF via pdf-parse", async () => {
    mockPdfParse.mockResolvedValue(validResult());
    const result = await parsePdf(Buffer.from("%PDF-1.4 fake bytes"));
    expect(result.text).toContain("German student visa");
    expect(result.pages).toBe(3);
    expect(result.metadata).toEqual({ Title: "Visa Guide" });
    expect(mockPdfJsGetDocument).not.toHaveBeenCalled();
  });

  it("rejects an empty buffer before calling any parser", async () => {
    await expect(parsePdf(Buffer.alloc(0))).rejects.toThrow(PdfParseError);
    await expect(parsePdf(Buffer.alloc(0))).rejects.toThrow("Empty PDF buffer");
    expect(mockPdfParse).not.toHaveBeenCalled();
    expect(mockPdfJsGetDocument).not.toHaveBeenCalled();
  });

  it("rejects a scanned/image-only PDF with no extractable text", async () => {
    // pdf-parse yields blank text → PdfParseError → falls back to pdf.js,
    // which also yields no text → same clear error surfaces.
    mockPdfParse.mockResolvedValue(validResult({ text: "   \n  " }));
    mockPdfJsGetDocument.mockReturnValue({ promise: Promise.resolve(pdfJsDoc([""])) });
    await expect(parsePdf(Buffer.from("%PDF-1.4"))).rejects.toThrow(
      "no extractable text (scanned/image-only?)",
    );
  });

  it("rejects PDFs that exceed the page cap in either parser", async () => {
    // pdf-parse path: reports over-cap → PdfParseError → falls back to pdf.js,
    // which also sees an over-cap file and throws the same clear error.
    const overCapDoc = { numPages: MAX_PDF_PAGES + 1, getPage: () => Promise.resolve({}) };
    mockPdfParse.mockResolvedValue(validResult({ numpages: MAX_PDF_PAGES + 1 }));
    mockPdfJsGetDocument.mockReturnValue({ promise: Promise.resolve(overCapDoc) });
    await expect(parsePdf(Buffer.from("%PDF-1.4"))).rejects.toThrow(
      `PDF exceeds ${MAX_PDF_PAGES} pages`,
    );
    // Cap violations are parser-independent → must NOT trigger the fallback.
    expect(mockPdfJsGetDocument).not.toHaveBeenCalled();

    // pdf.js path: pdf-parse rejects on structure, fallback enforces the cap.
    mockPdfParse.mockRejectedValue(new Error("invalid pdf structure"));
    mockPdfJsGetDocument.mockReturnValue({ promise: Promise.resolve(overCapDoc) });
    await expect(parsePdf(Buffer.from("%PDF-1.4"))).rejects.toThrow(
      `PDF exceeds ${MAX_PDF_PAGES} pages`,
    );
  });

  it("falls back to pdf.js when pdf-parse rejects on a structurally-valid modern PDF", async () => {
    mockPdfParse.mockRejectedValue(new Error("invalid pdf structure"));
    mockPdfJsGetDocument.mockReturnValue({
      promise: Promise.resolve(pdfJsDoc(["page one content", "page two content"])),
    });
    const result = await parsePdf(Buffer.from("%PDF-1.7 modern xref-stream"));
    expect(result.text).toContain("page one");
    expect(result.text).toContain("page two");
    expect(result.pages).toBe(2);
    expect(result.metadata).toEqual({});
  });

  it("throws PdfParseError when both parsers fail, preserving the pdf.js error", async () => {
    mockPdfParse.mockRejectedValue(new Error("invalid pdf structure"));
    mockPdfJsGetDocument.mockReturnValue({
      promise: Promise.reject(new Error("Invalid Root reference")),
    });
    await expect(parsePdf(Buffer.from("garbage"))).rejects.toThrow(PdfParseError);
    await expect(parsePdf(Buffer.from("garbage"))).rejects.toThrow("Invalid Root reference");
  });
});

describe("upload limits", () => {
  it("caps PDFs at 4 MiB", () => {
    expect(MAX_PDF_BYTES).toBe(4 * 1024 * 1024);
  });

  it("caps at 200 pages", () => {
    expect(MAX_PDF_PAGES).toBe(200);
  });

  it("only accepts application/pdf", () => {
    expect(ACCEPTED_MIME).toBe("application/pdf");
  });
});
