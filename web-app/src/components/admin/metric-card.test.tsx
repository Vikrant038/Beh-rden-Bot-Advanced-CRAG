import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { MetricCard } from "@/components/admin/metric-card";

describe("MetricCard", () => {
  beforeAll(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(performance.now() + 2000);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });
  it("renders the label and formatted value", () => {
    render(<MetricCard label="Total users" value={42} icon={Users} />);
    expect(screen.getByText("Total users")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("applies a custom formatter", () => {
    render(
      <MetricCard
        label="Avg latency"
        value={812.4}
        icon={Users}
        format={(v) => `${Math.round(v)}ms`}
      />,
    );
    expect(screen.getByText("812ms")).toBeInTheDocument();
  });

  it("renders large values with locale separators", () => {
    render(<MetricCard label="Total messages" value={12345} icon={Users} />);
    expect(screen.getByText("12,345")).toBeInTheDocument();
  });
});
