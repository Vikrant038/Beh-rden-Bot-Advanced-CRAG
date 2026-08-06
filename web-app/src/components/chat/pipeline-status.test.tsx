import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PipelineStatus } from "@/components/chat/pipeline-status";

describe("PipelineStatus", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<PipelineStatus status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when done", () => {
    const { container } = render(<PipelineStatus status="done" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders all seven stage labels with a polite live region", () => {
    const { container } = render(<PipelineStatus status="dense_retrieval" />);
    for (const label of [
      "Disambiguation",
      "Guardrail",
      "Query Expansion",
      "Dense/BM25 Search",
      "Research Tools",
      "Analyst",
      "Writer",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it("marks the active stage and completed stages", () => {
    render(<PipelineStatus status="analyst" />);
    const active = screen.getByText("Analyst");
    expect(active).toHaveClass("font-medium");
    const completed = screen.getByText("Dense/BM25 Search");
    expect(completed).toHaveClass("text-muted");
    const upcoming = screen.getByText("Writer");
    expect(upcoming).not.toHaveClass("font-medium");
  });
});
