import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StageNode } from "@/components/admin/pipeline/stage-node";
import { ReactStep } from "@/components/admin/pipeline/react-step";
import { SourcePanel } from "@/components/admin/pipeline/source-panel";
import { LlmCostPanel } from "@/components/admin/pipeline/llm-cost-panel";
import type { ResearchStep } from "@/server/rag/agents/research";

const step: ResearchStep = {
  iteration: 1,
  thought: "Primary query received.",
  action: "tool_vector_search",
  observation: "Retrieved 3 relevant chunks.",
};

const stepWithDuration: ResearchStep = {
  ...step,
  durationMs: 42,
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

  it("is closed by default — body hidden until the chevron is clicked", () => {
    render(
      <ol>
        <StageNode index={0} title="Stage" status="done">
          <p>expandable body</p>
        </StageNode>
      </ol>,
    );
    // Closed by default: the admin trace must not reveal outputs up front.
    expect(screen.queryByText("expandable body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("expandable body")).toBeInTheDocument();
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
});

describe("ReactStep", () => {
  it("renders thought, action, observation and iteration", () => {
    render(<ReactStep step={step} />);
    expect(screen.getByText("tool_vector_search")).toBeInTheDocument();
    expect(screen.getByText(/Primary query received/)).toBeInTheDocument();
    expect(screen.getByText(/Retrieved 3 relevant chunks/)).toBeInTheDocument();
    expect(screen.getByText("iteration 1")).toBeInTheDocument();
  });

  it("renders the tool execution duration badge when present", () => {
    render(<ReactStep step={stepWithDuration} />);
    expect(screen.getByText("42ms")).toBeInTheDocument();
  });

  it("maps web search, visa calculator, and sub-query actions to their icons", () => {
    const web = render(<ReactStep step={{ ...step, action: "web_search" }} />);
    expect(web.container.querySelector(".lucide-globe")).not.toBeNull();

    const calc = render(<ReactStep step={{ ...step, action: "visa_calculator" }} />);
    expect(calc.container.querySelector(".lucide-calculator")).not.toBeNull();

    const sub = render(<ReactStep step={{ ...step, action: "sub_query" }} />);
    expect(sub.container.querySelector(".lucide-mouse-pointer-click")).not.toBeNull();
  });
});

describe("LlmCostPanel", () => {
  it("renders per-call latency, tokens, cost, and the summed total", () => {
    render(
      <LlmCostPanel
        calls={[
          {
            stage: "Stage 2 — Analyst (comparison matrix)",
            provider: "groq",
            model: "llama-3.1-8b-instant",
            latencyMs: 500,
            promptTokens: 900,
            completionTokens: 220,
            totalTokens: 1120,
            costUsd: 0.0000626,
          },
        ]}
        totalCostUsd={0.0000626}
      />,
    );
    expect(screen.getByText("LLM calls & cost")).toBeInTheDocument();
    expect(screen.getByText(/Stage 2 — Analyst/)).toBeInTheDocument();
    expect(screen.getByText("Groq")).toBeInTheDocument();
    expect(screen.getByText("900 in · 220 out")).toBeInTheDocument();
    expect(screen.getByText("500ms")).toBeInTheDocument();
  });

  it("renders the zero-call notice when no LLM calls were made", () => {
    render(<LlmCostPanel calls={[]} totalCostUsd={0} />);
    expect(
      screen.getByText(/No LLM calls were made — this trace was served without a model call/),
    ).toBeInTheDocument();
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

  it("does not render an external-link icon for pdf:// pseudo-URLs", () => {
    render(
      <SourcePanel
        index={0}
        source={{ name: "local pdf", url: "pdf://aabbccddee/file.pdf", score: 0.5 }}
      />,
    );
    expect(screen.queryByLabelText("Open local pdf")).not.toBeInTheDocument();
  });
});
