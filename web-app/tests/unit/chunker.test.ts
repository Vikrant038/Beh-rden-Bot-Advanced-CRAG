import { describe, it, expect } from "vitest";
import { RecursiveChunker, chunkText } from "@/server/ingest/chunker";

const LONG_TEXT = `
German Student Visa Guide

A student visa (national visa) is required if you intend to study in Germany for longer than 90 days.

## Requirements
You must prove sufficient financial resources, valid health insurance, and admission to a German university.

## Blocked Account
A blocked account is required for most visa applications. The amount is 992 EUR per month.

## Application Process
Apply at the German embassy in your home country. Submit your documents and attend an interview.

## APS Certificate
Indian applicants must obtain an APS certificate before applying for a visa.

## University Admission
Most universities require a recognized school leaving certificate and proof of German language proficiency.
`.repeat(3);

describe("RecursiveChunker", () => {
  it("returns an empty list for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("splits text into chunks at or below the chunk size", () => {
    const chunks = chunkText(LONG_TEXT, { chunkSize: 200, chunkOverlap: 50, minChunkChars: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200 + 20);
    }
  });

  it("drops chunks below minChunkChars as noisy snippets", () => {
    const chunks = chunkText("Hello world.", { chunkSize: 600, minChunkChars: 100 });
    expect(chunks.length).toBe(0);
  });

  it("preserves paragraph separators when merging", () => {
    const chunks = chunkText(LONG_TEXT, { chunkSize: 300, chunkOverlap: 60, minChunkChars: 30 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.some((chunk) => chunk.includes("\n\n"))).toBe(true);
  });

  it("keeps default chunk size 600 and overlap 150", () => {
    const chunker = new RecursiveChunker();
    const chunks = chunker.splitText(LONG_TEXT);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(600 + 150);
    }
  });

  it("handles extremely long unbroken text", () => {
    const huge = "word ".repeat(5000);
    const chunks = chunkText(huge, { chunkSize: 300, chunkOverlap: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(300 + 100);
    }
  });

  it("is deterministic", () => {
    const first = chunkText(LONG_TEXT);
    const second = chunkText(LONG_TEXT);
    expect(first).toEqual(second);
  });
});
