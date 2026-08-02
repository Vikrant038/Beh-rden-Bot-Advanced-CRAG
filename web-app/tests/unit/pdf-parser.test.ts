import { vi, describe, it, expect, beforeEach } from "vitest";
import { PdfParseError } from "@/server/lib/errors/domain-error";

const mockPdfParse = vi.fn();

vi.mock("pdf-parse/lib/pdf-parse.js", () => ({
  default: (...args: unknown[]) => mockPdfParse(...args),
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

describe("parsePdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts text, page count, and metadata from a valid PDF", async () => {
    mockPdfParse.mockResolvedValue(validResult());
    const result = await parsePdf(Buffer.from("%PDF-1.4 fake bytes"));
    expect(result.text).toContain("German student visa");
    expect(result.pages).toBe(3);
    expect(result.metadata).toEqual({ Title: "Visa Guide" });
  });

  it("rejects an empty buffer before calling pdf-parse", async () => {
    await expect(parsePdf(Buffer.alloc(0))).rejects.toThrow(PdfParseError);
    await expect(parsePdf(Buffer.alloc(0))).rejects.toThrow("Empty PDF buffer");
    expect(mockPdfParse).not.toHaveBeenCalled();
  });

  it("rejects a scanned/image-only PDF with no extractable text", async () => {
    mockPdfParse.mockResolvedValue(validResult({ text: "   \n  " }));
    await expect(parsePdf(Buffer.from("%PDF-1.4"))).rejects.toThrow(
      "no extractable text (scanned/image-only?)",
    );
  });

  it("rejects PDFs that exceed the page cap", async () => {
    mockPdfParse.mockResolvedValue(validResult({ numpages: MAX_PDF_PAGES + 1 }));
    await expect(parsePdf(Buffer.from("%PDF-1.4"))).rejects.toThrow(
      `PDF exceeds ${MAX_PDF_PAGES} pages`,
    );
  });

  it("rejects when pdf-parse itself throws, preserving the message", async () => {
    mockPdfParse.mockRejectedValue(new Error("invalid pdf structure"));
    await expect(parsePdf(Buffer.from("garbage"))).rejects.toThrow(PdfParseError);
    await expect(parsePdf(Buffer.from("garbage"))).rejects.toThrow("invalid pdf structure");
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
