import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentQueriesTable } from "@/components/admin/recent-queries-table";

const QUERIES = [
  {
    id: "m1",
    query: "How do I open a blocked account?",
    createdAt: "2026-07-31T10:00:00.000Z",
    mode: "agentic",
    latencyMs: 812.5,
    isCached: false,
    retrievalPath: "AGENTIC_3_AGENT_REACT",
  },
  {
    id: "m2",
    query: "Visa fee?",
    createdAt: "2026-07-31T09:00:00.000Z",
    mode: "standard",
    latencyMs: 1.2,
    isCached: true,
    retrievalPath: "TIER_2_VECTOR_CACHE_HIT (Sim: 0.980)",
  },
];

describe("RecentQueriesTable", () => {
  it("shows a loading placeholder while loading", () => {
    render(<RecentQueriesTable queries={[]} loading />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("shows an empty state when there are no queries", () => {
    render(<RecentQueriesTable queries={[]} loading={false} />);
    expect(screen.getByText("No queries recorded yet.")).toBeInTheDocument();
  });

  it("renders query rows with mode, latency, cached badge, and path", () => {
    render(<RecentQueriesTable queries={QUERIES} loading={false} />);
    expect(screen.getByText("How do I open a blocked account?")).toBeInTheDocument();
    expect(screen.getByText("AGENTIC")).toBeInTheDocument();
    expect(screen.getByText("813ms")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getByText("no")).toBeInTheDocument();
    expect(screen.getByText("AGENTIC_3_AGENT_REACT")).toBeInTheDocument();
  });
});
