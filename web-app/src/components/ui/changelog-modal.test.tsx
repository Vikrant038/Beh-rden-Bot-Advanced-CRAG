import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChangelogModal } from "@/components/ui/changelog-modal";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ChangelogModal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the built-in fallback snapshot when the live fetch has not resolved", () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Promise<Response>(() => {}), // never resolves
    );
    render(<ChangelogModal open onClose={() => {}} />);
    expect(screen.getByText("What's new")).toBeInTheDocument();
    expect(screen.getByText(/UI\/UX Enhancement Batch/)).toBeInTheDocument();
  });

  it("swaps in the live CHANGELOG.md entries served by /api/changelog", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        entries: [
          {
            version: "Unreleased",
            date: "",
            title: "Changed",
            items: ["A brand new live change"],
          },
        ],
      }),
    );
    render(<ChangelogModal open onClose={() => {}} />);
    expect(await screen.findByText("A brand new live change")).toBeInTheDocument();
    expect(screen.queryByText(/UI\/UX Enhancement Batch/)).not.toBeInTheDocument();
  });

  it("renders every entry even when version+title collide (no duplicate React keys)", async () => {
    // The real CHANGELOG.md has three "Unreleased — Changed" groups; the keys
    // must stay unique or React drops/reuses sections.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        entries: [
          { version: "Unreleased", date: "", title: "Changed", items: ["First change"] },
          { version: "Unreleased", date: "", title: "Changed", items: ["Second change"] },
          { version: "Unreleased", date: "", title: "Added", items: ["New feature"] },
        ],
      }),
    );
    render(<ChangelogModal open onClose={() => {}} />);
    expect(await screen.findByText("First change")).toBeInTheDocument();
    expect(screen.getByText("Second change")).toBeInTheDocument();
    expect(screen.getByText("New feature")).toBeInTheDocument();
  });

  it("keeps the fallback snapshot when the fetch fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    render(<ChangelogModal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/UI\/UX Enhancement Batch/)).toBeInTheDocument());
  });

  it("keeps the fallback when the API returns an empty entry list", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ entries: [] }));
    render(<ChangelogModal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/UI\/UX Enhancement Batch/)).toBeInTheDocument());
  });
});
