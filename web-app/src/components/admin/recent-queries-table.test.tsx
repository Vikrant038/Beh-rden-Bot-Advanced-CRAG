import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecentQueriesTable } from "./recent-queries-table";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Default queryDetail hook result; individual tests override via queryDetailMock.
const queryDetailMock = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  api: {
    admin: {
      queryDetail: {
        useQuery: (args: unknown) => queryDetailMock(args),
      },
    },
  },
}));

function baseQueryDetail(data: unknown) {
  return { data, isLoading: false, error: null };
}

const row = {
  id: "q1",
  conversationId: "c1",
  query: "Test query",
  createdAt: "2026-08-05T10:00:00Z",
  mode: "AGENTIC",
  latencyMs: 2500,
  isCached: true,
  sourceCount: 3,
};

describe("RecentQueriesTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryDetailMock.mockReturnValue(baseQueryDetail({}));
  });

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

    render(
      <RecentQueriesTable queries={[row]} loading={false} hasMore={true} onLoadMore={onLoadMore} />,
    );

    expect(screen.getByText("Test query")).toBeDefined();
    expect(screen.getByText("AGENTIC")).toBeDefined();
    expect(screen.getByText("yes")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();

    const loadMoreBtn = screen.getByRole("button", { name: /Load more/i });
    fireEvent.click(loadMoreBtn);
    expect(onLoadMore).toHaveBeenCalled();
  });

  it("navigates to the conversation on row click and on Enter keydown", () => {
    render(<RecentQueriesTable queries={[row]} loading={false} />);
    // The <tr role="button"> and the ExternalLink cell button share this label.
    const rowEl = screen.getAllByRole("button", {
      name: /Open conversation for query: Test query/i,
    })[0];
    fireEvent.click(rowEl);
    expect(pushMock).toHaveBeenCalledWith("/chat/c1");

    pushMock.mockClear();
    fireEvent.keyDown(rowEl, { key: "Enter" });
    expect(pushMock).toHaveBeenCalledWith("/chat/c1");
  });

  it("shows loading state on load more button", () => {
    render(
      <RecentQueriesTable
        queries={[row]}
        loading={false}
        hasMore={true}
        loadingMore={true}
        onLoadMore={vi.fn()}
      />,
    );
    const loadMoreBtn = screen.getByRole("button", { name: /Loading/i });
    expect((loadMoreBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows zero sources when the answer cited none", () => {
    render(<RecentQueriesTable queries={[{ ...row, sourceCount: 0 }]} loading={false} />);
    expect(screen.getByText("0")).toBeDefined();
  });

  it("opens the details drawer with metadata-driven stats", async () => {
    queryDetailMock.mockReturnValue(
      baseQueryDetail({
        userMessage: {
          content: "Test query",
          createdAt: "2026-08-05T10:00:00Z",
          metadata: { latencyMs: 1200.4, isCached: true, mode: "agentic", retrievalPath: "PASS" },
        },
        assistantResponse: { content: "Test answer" },
      }),
    );

    render(<RecentQueriesTable queries={[row]} loading={false} />);
    fireEvent.click(screen.getByTitle("View details"));

    expect(await screen.findByText(/Query details/i)).toBeDefined();
    expect(await screen.findByText("1200ms")).toBeDefined();
    expect(await screen.findByText("agentic")).toBeDefined();
    expect(await screen.findByText("PASS")).toBeDefined();
    expect(await screen.findByText("Test answer")).toBeDefined();
  });

  it("falls back to defaults when metadata is missing", async () => {
    queryDetailMock.mockReturnValue(
      baseQueryDetail({
        userMessage: { content: "Test query", createdAt: "2026-08-05T10:00:00Z" },
        assistantResponse: null,
      }),
    );

    render(<RecentQueriesTable queries={[row]} loading={false} />);
    fireEvent.click(screen.getByTitle("View details"));

    expect(await screen.findByText("standard")).toBeDefined();
    expect(await screen.findByText("0ms")).toBeDefined();
    expect(await screen.findByText(/No assistant response recorded/i)).toBeDefined();
  });

  it("shows 'Query not found' when the detail request returns no data", async () => {
    queryDetailMock.mockReturnValue(baseQueryDetail(null));

    render(<RecentQueriesTable queries={[row]} loading={false} />);
    fireEvent.click(screen.getByTitle("View details"));
    expect(await screen.findByText(/Query not found/i)).toBeDefined();
  });

  it("shows skeletons while the detail request is loading", async () => {
    queryDetailMock.mockReturnValue({ data: undefined, isLoading: true, error: null });

    render(<RecentQueriesTable queries={[row]} loading={false} />);
    fireEvent.click(screen.getByTitle("View details"));
    await waitFor(() => {
      expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    });
  });
});
