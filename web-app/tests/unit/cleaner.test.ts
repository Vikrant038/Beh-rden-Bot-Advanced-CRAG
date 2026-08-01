import { describe, it, expect } from "vitest";
import { cleanText } from "@/server/ingest/cleaner";

describe("cleanText", () => {
  it("returns empty string for empty input", () => {
    expect(cleanText("")).toBe("");
    expect(cleanText(null as unknown as string)).toBe("");
  });

  it("removes PDF artifacts (null bytes and private-use glyphs)", () => {
    expect(cleanText("a\x00b\uf0b7c\uf06cd")).toBe("ab-cd");
  });

  it("normalizes unicode to NFC and preserves German characters", () => {
    expect(cleanText("Studium für äöü")).toBe("Studium für äöü");
    expect(cleanText("u\u0308ber")).toBe("über");
  });

  it("removes repeated boilerplate lines appearing more than 3 times", () => {
    const header = "Contact us at help@example.com\n".repeat(5);
    const body = "Unique content line one.\n\nUnique content line two.";
    const cleaned = cleanText(header + body);
    expect(cleaned).not.toContain("Contact us at help@example.com");
    expect(cleaned).toContain("Unique content line one");
  });

  it("collapses excessive blank lines to at most two", () => {
    const cleaned = cleanText("First line here\n\n\n\n\n\n\nSecond line here");
    expect(cleaned).toBe("First line here\n\nSecond line here");
  });

  it("collapses multiple spaces and trims", () => {
    expect(cleanText("  hello    world  ")).toBe("hello world");
  });

  it("drops very short lines that are likely noise", () => {
    expect(cleanText("x\nReal paragraph content here.")).toBe("Real paragraph content here.");
  });

  it("preserves meaningful line structure", () => {
    const input = "Line one\nLine two\n\nSection two";
    expect(cleanText(input)).toBe("Line one\nLine two\n\nSection two");
  });
});
