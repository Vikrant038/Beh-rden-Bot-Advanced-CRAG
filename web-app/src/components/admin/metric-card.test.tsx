import { act } from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetricCard } from "@/components/admin/metric-card";
import { Activity } from "lucide-react";
import React from "react";

describe("MetricCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the label and animated value", () => {
    render(<MetricCard label="Active Users" value={1200} icon={Activity} />);
    expect(screen.getByText("Active Users")).toBeDefined();

    // requestAnimationFrame might need multiple ticks
    act(() => {
      vi.advanceTimersByTime(600);
      for (let i = 0; i < 60; i++) {
        vi.advanceTimersByTime(16);
      }
    });

    expect(screen.getByText("1,200")).toBeDefined();
  });

  it("renders a sparkline when data is provided", () => {
    render(<MetricCard label="Queries" value={100} icon={Activity} sparkline={[10, 20, 30, 40]} />);

    // Look for the SVG role
    const svg = screen.getByRole("img", { name: "Sparkline of recent values" });
    expect(svg).toBeDefined();
    // It should have polygon and polyline
    expect(svg.querySelector("polygon")).toBeDefined();
    expect(svg.querySelector("polyline")).toBeDefined();
  });

  it("renders trend data correctly (up)", () => {
    render(
      <MetricCard label="Upward" value={100} icon={Activity} trend={15} trendLabel="up trend" />,
    );
    expect(screen.getByText("+15%")).toBeDefined();
    expect(screen.getByText("up trend")).toBeDefined();
  });

  it("renders trend data correctly (down)", () => {
    render(<MetricCard label="Downward" value={100} icon={Activity} trend={-5} />);
    expect(screen.getByText("-5%")).toBeDefined();
  });

  it("handles empty sparkline safely", () => {
    render(<MetricCard label="Empty Spark" value={100} icon={Activity} sparkline={[]} />);
    expect(screen.queryByRole("img", { name: "Sparkline of recent values" })).toBeNull();
  });

  it("handles loading state", () => {
    const { container } = render(
      <MetricCard label="Loading State" value={100} icon={Activity} loading={true} />,
    );
    expect(screen.queryByText("100")).toBeNull(); // Value should be hidden
    expect(container.querySelector(".animate-pulse")).toBeDefined(); // Skeleton has this class
  });
});
