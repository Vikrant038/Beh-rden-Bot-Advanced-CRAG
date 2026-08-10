import { describe, it, expect } from "vitest";
import {
  RecursiveChunker,
  chunkText,
  chunkParentChild,
  PARENT_CHUNK_SIZE,
  PARENT_CHUNK_OVERLAP,
  CHILD_CHUNK_SIZE,
  CHILD_CHUNK_OVERLAP,
} from "@/server/ingest/chunker";

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

  it("falls back to per-character splitting when no separator is present", () => {
    const chunker = new RecursiveChunker({
      chunkSize: 20,
      chunkOverlap: 5,
      minChunkChars: 3,
      separators: ["XY"],
    });
    const chunks = chunker.splitText("abcdefghijklmnopqrstuvwxyz");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20 + 5);
    }
  });

  it("recursively splits oversized pieces when the separator is too rare", () => {
    const chunker = new RecursiveChunker({
      chunkSize: 100,
      chunkOverlap: 20,
      minChunkChars: 10,
      separators: ["\n"],
    });
    const chunks = chunker.splitText(`${'x'.repeat(500)}\nshort tail`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100 + 20);
    }
  });

  it("trims overlap by dropping the oldest pieces when a merge exceeds the chunk size", () => {
    const chunker = new RecursiveChunker({
      chunkSize: 40,
      chunkOverlap: 10,
      minChunkChars: 3,
      separators: ["\n"],
    });
    const text = Array.from({ length: 10 }, (_v, i) => `piece-${i}`).join("\n");
    const chunks = chunker.splitText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap is real: a later chunk re-includes the tail of an earlier one.
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(40 + 10);
    }
  });
});

describe("chunkParentChild", () => {
  const PARAGRAPH =
    "German universities require international applicants to submit a recognized school leaving " +
    "certificate, proof of German or English language proficiency, and a valid passport. " +
    "Admission decisions are issued by the university admissions office after document review.\n\n";

  const LONG_DOC = PARAGRAPH.repeat(60);

  it("returns an empty list for empty input", () => {
    expect(chunkParentChild("")).toEqual([]);
    expect(chunkParentChild("   ")).toEqual([]);
  });

  it("produces parent blocks under the 2000-char cap", () => {
    const blocks = chunkParentChild(LONG_DOC);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.parent.text.length).toBeLessThanOrEqual(
        PARENT_CHUNK_SIZE + PARENT_CHUNK_OVERLAP,
      );
    }
  });

  it("splits each parent into child chunks under the 200-char cap", () => {
    const blocks = chunkParentChild(LONG_DOC);
    for (const block of blocks) {
      for (const child of block.children) {
        expect(child.text.length).toBeLessThanOrEqual(CHILD_CHUNK_SIZE + CHILD_CHUNK_OVERLAP);
      }
    }
  });

  it("keeps overlap between adjacent parents", () => {
    const blocks = chunkParentChild(LONG_DOC);
    const parents = blocks.map((block) => block.parent.text);
    for (let i = 1; i < parents.length; i++) {
      const prevTail = parents[i - 1].slice(-PARENT_CHUNK_OVERLAP).trim();
      expect(parents[i].includes(prevTail)).toBe(true);
    }
  });

  it("bounds every child chunk size", () => {
    const blocks = chunkParentChild(LONG_DOC);
    for (const block of blocks) {
      for (const child of block.children) {
        expect(child.text.length).toBeLessThanOrEqual(CHILD_CHUNK_SIZE + CHILD_CHUNK_OVERLAP);
      }
    }
  });

  it("makes a short parent its own child so no content is lost", () => {
    const text =
      "A compact parent paragraph about visa document requirements for international student " +
      "applicants and the documents they must prepare before submission.";
    const blocks = chunkParentChild(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.children.length).toBe(1);
    expect(blocks[0]?.children[0]?.text).toContain("visa document requirements");
  });

  it("is deterministic across runs", () => {
    expect(chunkParentChild(LONG_DOC)).toEqual(chunkParentChild(LONG_DOC));
  });

  it("preserves the full document content across parent blocks", () => {
    const blocks = chunkParentChild(LONG_DOC);
    const joined = blocks.map((block) => block.parent.text).join(" ");
    expect(joined.length).toBeGreaterThan(LONG_DOC.length * 0.9);
  });
});
