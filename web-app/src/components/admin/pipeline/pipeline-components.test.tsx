import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StageNode } from "@/components/admin/pipeline/stage-node";
import { ReactStep } from "@/components/admin/pipeline/react-step";
import { SourcePanel } from "@/components/admin/pipeline/source-panel";
import type { ResearchStep } from "@/server/rag/agents/research";

const step: ResearchStep = {
  iteration: 1,
  thought: "Primary query received.",
  action: "tool_vector_search",
  observation: "Retrieved 3 relevant chunks.",
};

describe("StageNode", () => {
  it("renders title, index, and done status", () => {
    render(
      <ol>
        <StageNode index={0} title="Stage 0 — guardrail" status="done" durationMs={12}>
          body
        </StageNode>
      </ol>,
    );
    expect(screen.getByText(/Stage 0 — guardrail/)).toBeInTheDocument();
    expect(screen.getByText("12ms")).toBeInTheDocument();
  });

  it("shows a running indicator with pulse class", () => {
    const { container } = render(
      <StageNode index={1} title="Running" status="running">
        body
      </StageNode>,
    );
    expect(container.querySelector(".status-pulse")).not.toBeNull();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("toggles body on chevron click", () => {
    render(
      <ol>
        <StageNode index={0} title="Stage" status="done">
          <p>expandable body</p>
        </StageNode>
      </ol>,
    );
    expect(screen.getByText("expandable body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("expandable body")).not.toBeInTheDocument();
  });
});

describe("ReactStep", () => {
  it("renders thought, action, observation and iteration", () => {
    render(<ReactStep step={step} />);
    expect(screen.getByText("tool_vector_search")).toBeInTheDocument();
    expect(screen.getByText(/Primary query received/)).toBeInTheDocument();
    expect(screen.getByText(/Retrieved 3 relevant chunks/)).toBeInTheDocument();
    expect(screen.getByText("iteration 1")).toBeInTheDocument();
  });
});

describe("SourcePanel", () => {
  it("shows child snippet and expanded parent on expand", () => {
    render(
      <SourcePanel
        index={0}
        source={{
          name: "uni-assist",
          url: "https://example.com/uni",
          score: 0.9,
          childText: "child snippet",
          parentText: "parent context",
        }}
      />,
    );
    expect(screen.getByText("uni-assist")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Matched child snippet/)).toBeInTheDocument();
    expect(screen.getByText("child snippet")).toBeInTheDocument();
    expect(screen.getByText(/Expanded parent context/)).toBeInTheDocument();
    expect(screen.getByText("parent context")).toBeInTheDocument();
  });

  it("renders fallback text when no parent expansion exists", () => {
    render(<SourcePanel index={0} source={{ name: "flat chunk", url: "", score: 0.5 }} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("No parent expansion available.")).toBeInTheDocument();
  });
});
