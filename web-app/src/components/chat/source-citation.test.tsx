import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SourceCitation } from "@/components/chat/source-citation";
import type { ChatSource } from "@/lib/chat/types";

function openList(): void {
  const toggle = screen.getByRole("button", { name: /Sources \(/ });
  fireEvent.click(toggle);
}

function faviconImg(): HTMLImageElement | null {
  return document.querySelector("img");
}

/** One-source fixture — every case renders a single citation. */
const oneSource = (name: string, url: string, score: number): ChatSource[] => [
  { name, url, score },
];

describe("SourceCitation", () => {
  it("renders an http source as a clickable link with a favicon", () => {
    render(<SourceCitation sources={oneSource("BAMF Guide", "https://www.bamf.de/guide", 0.9)} />);
    openList();
    const link = screen.getByRole("link", { name: /BAMF Guide/ });
    expect(link).toHaveAttribute("href", "https://www.bamf.de/guide");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("90%")).toBeInTheDocument();
    // Favicon request targets the extracted host.
    expect(faviconImg()).not.toBeNull();
    expect(faviconImg()).toHaveAttribute("src", expect.stringContaining("domain=www.bamf.de"));
  });

  it("renders a pdf:// source as a plain chip (not a link)", () => {
    render(
      <SourceCitation sources={oneSource("Local Brochure", "pdf://bamf/broschuere.pdf", 0.75)} />,
    );
    openList();
    expect(screen.getByText("Local Brochure")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    // No link, no favicon for pdf:// pseudo-URLs.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(faviconImg()).toBeNull();
  });

  it("falls back to the leading host segment for non-URL strings", () => {
    render(<SourceCitation sources={oneSource("Plain Host", "make-it-in-germany.com/en", 0.5)} />);
    openList();
    expect(faviconImg()).not.toBeNull();
    expect(faviconImg()).toHaveAttribute(
      "src",
      expect.stringContaining("domain=make-it-in-germany.com"),
    );
  });

  it("swaps to a globe icon when the favicon fails to load", () => {
    render(<SourceCitation sources={oneSource("Broken Favicon", "https://example.com/x", 0.6)} />);
    openList();
    const img = faviconImg();
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(faviconImg()).toBeNull();
    expect(screen.getByText("Broken Favicon")).toBeInTheDocument();
  });

  it("collapses and re-expands on toggle clicks", () => {
    render(<SourceCitation sources={oneSource("Doc", "https://example.com", 0.8)} />);
    const toggle = screen.getByRole("button", { name: /Sources \(/ });
    fireEvent.click(toggle);
    expect(screen.getByText("Doc")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText("Doc")).not.toBeInTheDocument();
  });
});
