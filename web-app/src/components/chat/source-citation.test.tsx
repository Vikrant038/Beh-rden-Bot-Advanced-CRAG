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

describe("SourceCitation", () => {
  it("renders an http source as a clickable link with a favicon", () => {
    const sources: ChatSource[] = [
      { name: "BAMF Guide", url: "https://www.bamf.de/guide", score: 0.9 },
    ];
    render(<SourceCitation sources={sources} />);
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
    const sources: ChatSource[] = [
      { name: "Local Brochure", url: "pdf://bamf/broschuere.pdf", score: 0.75 },
    ];
    render(<SourceCitation sources={sources} />);
    openList();
    expect(screen.getByText("Local Brochure")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    // No link, no favicon for pdf:// pseudo-URLs.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(faviconImg()).toBeNull();
  });

  it("falls back to the leading host segment for non-URL strings", () => {
    const sources: ChatSource[] = [
      { name: "Plain Host", url: "make-it-in-germany.com/en", score: 0.5 },
    ];
    render(<SourceCitation sources={sources} />);
    openList();
    expect(faviconImg()).not.toBeNull();
    expect(faviconImg()).toHaveAttribute(
      "src",
      expect.stringContaining("domain=make-it-in-germany.com"),
    );
  });

  it("swaps to a globe icon when the favicon fails to load", () => {
    const sources: ChatSource[] = [
      { name: "Broken Favicon", url: "https://example.com/x", score: 0.6 },
    ];
    render(<SourceCitation sources={sources} />);
    openList();
    const img = faviconImg();
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(faviconImg()).toBeNull();
    expect(screen.getByText("Broken Favicon")).toBeInTheDocument();
  });

  it("collapses and re-expands on toggle clicks", () => {
    const sources: ChatSource[] = [{ name: "Doc", url: "https://example.com", score: 0.8 }];
    render(<SourceCitation sources={sources} />);
    const toggle = screen.getByRole("button", { name: /Sources \(/ });
    fireEvent.click(toggle);
    expect(screen.getByText("Doc")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText("Doc")).not.toBeInTheDocument();
  });
});
