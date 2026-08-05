import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RecentQueriesTable } from "./recent-queries-table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    admin: {
      queryDetail: {
        useQuery: () => ({
          data: {
            latencyMs: 1200,
            llmTokens: 450,
            retrievalMs: 200,
            pipelineStatus: "SUCCESS",
            mode: "AGENTIC",
            error: null,
            sources: [],
            userMessage: { content: "Test query", createdAt: "2026-08-05T10:00:00Z" },
            assistantMessage: { content: "Test answer" },
          },
          isLoading: false,
          error: null,
        }),
      },
    },
  },
}));

describe("RecentQueriesTable", () => {
  it("renders a loading skeleton when loading is true", () => {
    const { container } = render(<RecentQueriesTable queries={[]} loading={true} />);
    expect(container.querySelector(".animate-pulse")).toBeDefined();
  });

  it("renders empty state when no queries exist and not loading", () => {
    render(<RecentQueriesTable queries={[]} loading={false} />);
    expect(screen.getByText(/No queries recorded yet/i)).toBeDefined();
  });

  it("renders queries and handles 'Load more' click", () => {
    const onLoadMore = vi.fn();
    const mockQueries = [
      {
        id: "q1",
        conversationId: "c1",
        query: "What is an APS certificate?",
        createdAt: "2026-08-05T10:00:00Z",
        mode: "AGENTIC",
        latencyMs: 2500,
        isCached: true,
        retrievalPath: "HYBRID_RRF_CROSS_ENCODER",
      },
    ];

    render(
      <RecentQueriesTable
        queries={mockQueries}
        loading={false}
        hasMore={true}
        onLoadMore={onLoadMore}
      />,
    );

    // Check if the query text is rendered
    expect(screen.getByText("What is an APS certificate?")).toBeDefined();

    // Check 'Load more' button
    const loadMoreBtn = screen.getByRole("button", { name: /Load more/i });
    expect(loadMoreBtn).toBeDefined();
    fireEvent.click(loadMoreBtn);
    expect(onLoadMore).toHaveBeenCalled();
  });

  it("opens details drawer on eye click", async () => {
    const mockQueries = [
      {
        id: "q1",
        conversationId: "c1",
        query: "Test query",
        createdAt: "2026-08-05T10:00:00Z",
        mode: "STANDARD",
        latencyMs: 500,
        isCached: false,
        retrievalPath: null,
      },
    ];

    render(<RecentQueriesTable queries={mockQueries} loading={false} />);
    const viewDetailsBtn = screen.getByTitle("View details");
    fireEvent.click(viewDetailsBtn);
    expect(await screen.findByText(/Query details/i)).toBeDefined();
    expect(await screen.findByText("Pipeline outcome for this user query.")).toBeDefined();
  });

  it("shows loading state on load more button", () => {
    render(
      <RecentQueriesTable
        queries={[
          {
            id: "q1",
            conversationId: "c1",
            query: "Test",
            createdAt: "2026-08-05T10:00:00Z",
            mode: "STANDARD",
            latencyMs: 500,
            isCached: false,
            retrievalPath: null,
          },
        ]}
        loading={false}
        hasMore={true}
        loadingMore={true}
        onLoadMore={vi.fn()}
      />,
    );

    const loadMoreBtn = screen.getByRole("button", { name: /Loading/i });
    expect(loadMoreBtn).toBeDefined();
    expect((loadMoreBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
