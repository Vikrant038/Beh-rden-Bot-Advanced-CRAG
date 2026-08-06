import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LandingPage from "./page";

const { mockUseSession, mockCorpusStats, mockUseReducedMotion } = vi.hoisted(() => ({
  mockUseSession: vi.fn(),
  mockCorpusStats: vi.fn(),
  mockUseReducedMotion: vi.fn(() => false),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
  signIn: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// The landing page reads live corpus stats through the tRPC client. Mock it so
// the test doesn't need a real provider; `isLoading: true` renders the skeleton
// path, which keeps the IntersectionObserver-based CountUp out of the tree.
vi.mock("@/lib/trpc/client", () => ({
  api: {
    public: {
      corpusStats: {
        useQuery: mockCorpusStats,
      },
    },
  },
}));

// Control useReducedMotion so motion wrappers are stable in jsdom and both
// branches (animation on / off) are exercised.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: mockUseReducedMotion,
  };
});

// jsdom lacks matchMedia (framer-motion's useReducedMotion) and
// IntersectionObserver (motion's whileInView / CountUp's useInView). Polyfill
// both so the full page renders.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  class MockIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds: number[] = [];
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  }
  Object.defineProperty(window, "IntersectionObserver", {
    writable: true,
    value: MockIntersectionObserver,
  });
});

function setSession(status: "loading" | "authenticated" | "unauthenticated") {
  mockUseSession.mockReturnValue({ data: status === "authenticated" ? {} : null, status });
}

const LOADED_STATS = {
  sources: 115,
  chunks: 23000,
  germanChunkPercent: 62.5,
  parentChunks: 5000,
  topSources: [],
};

describe("LandingPage session-aware CTAs", () => {
  beforeEach(() => {
    setSession("unauthenticated");
    mockCorpusStats.mockReturnValue({ data: undefined, isLoading: true, isError: false });
  });

  it("routes unauthenticated visitors to /login", () => {
    render(<LandingPage />);

    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/login");
    for (const link of screen.getAllByRole("link", { name: /Start asking/ })) {
      expect(link).toHaveAttribute("href", "/login");
    }
    expect(screen.getByRole("link", { name: "Browse the knowledge base" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("sends signed-in users straight to /chat instead of the login page", () => {
    setSession("authenticated");
    render(<LandingPage />);

    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/chat");
    for (const link of screen.getAllByRole("link", { name: /Start asking/ })) {
      expect(link).toHaveAttribute("href", "/chat");
    }
    // The knowledge-base CTA lands on the sources page for signed-in users.
    expect(screen.getByRole("link", { name: "Browse the knowledge base" })).toHaveAttribute(
      "href",
      "/sources",
    );
  });

  it("defaults to /login while the session is still loading", () => {
    setSession("loading");
    render(<LandingPage />);

    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/login");
  });
});

describe("LandingPage interaction states", () => {
  beforeEach(() => {
    setSession("unauthenticated");
    mockCorpusStats.mockReturnValue({ data: undefined, isLoading: true, isError: false });
  });

  it("renders a neutral placeholder while corpus stats are loading", () => {
    render(<LandingPage />);
    // Skeleton placeholders render; no fabricated numbers are shown.
    expect(
      screen.queryByText("Live corpus stats temporarily unavailable."),
    ).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("Live corpus statistics")).toHaveLength(1);
  });

  it("renders the fallback card when corpus stats fail to load", () => {
    mockCorpusStats.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<LandingPage />);

    expect(screen.getByText("Live corpus stats temporarily unavailable.")).toBeInTheDocument();
  });

  it("renders the fallback card when stats finish loading without data", () => {
    mockCorpusStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(<LandingPage />);

    expect(screen.getByText("Live corpus stats temporarily unavailable.")).toBeInTheDocument();
  });

  it("renders real DB-backed stats once they load", () => {
    mockCorpusStats.mockReturnValue({ data: LOADED_STATS, isLoading: false, isError: false });
    render(<LandingPage />);

    expect(screen.getByText("official sources")).toBeInTheDocument();
    expect(screen.getByText("indexed chunks")).toBeInTheDocument();
    expect(screen.getByText("German-language chunks")).toBeInTheDocument();
    expect(screen.getByText("agent pipeline")).toBeInTheDocument();
    // Live numbers flow into the demo bullet and the corpus footer.
    expect(screen.getByText(/Hybrid retrieval across 115\+ official sources/)).toBeInTheDocument();
    expect(
      screen.getByText(/23,000 chunks · indexed as 1024-dim bge-m3 vectors/),
    ).toBeInTheDocument();
  });

  it("toggles the FAQ accordion", () => {
    render(<LandingPage />);

    const question = screen.getByRole("button", { name: /Is this free to use\?/ });
    const answer = screen.getByText(/the core assistant is free while you plan/);
    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(answer).toBeInTheDocument();

    fireEvent.click(question);
    expect(question).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/the core assistant is free while you plan/)).not.toBeInTheDocument();

    fireEvent.click(question);
    expect(question).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/the core assistant is free while you plan/)).toBeInTheDocument();
  });

  it("opens and closes the mobile menu", () => {
    render(<LandingPage />);

    // Only the desktop CTA exists while the menu is closed.
    expect(screen.getAllByRole("link", { name: "Get started" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    // The mobile-menu CTA is now rendered alongside the desktop one.
    expect(screen.getAllByRole("link", { name: "Get started" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.getAllByRole("link", { name: "Get started" })).toHaveLength(1);
  });

  it("closes the mobile menu on Escape", () => {
    render(<LandingPage />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getAllByRole("link", { name: "Get started" })).toHaveLength(2);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getAllByRole("link", { name: "Get started" })).toHaveLength(1);
  });

  it("ignores Escape while the menu is closed", () => {
    render(<LandingPage />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getAllByRole("link", { name: "Get started" })).toHaveLength(1);
  });

  it("reveals the back-to-top button after scrolling and scrolls to top on click", () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollTo", { writable: true, value: scrollTo });
    Object.defineProperty(window, "scrollY", {
      writable: true,
      configurable: true,
      value: 0,
    });
    render(<LandingPage />);

    expect(screen.queryByRole("button", { name: "Back to top" })).not.toBeInTheDocument();

    Object.defineProperty(window, "scrollY", {
      writable: true,
      configurable: true,
      value: 800,
    });
    fireEvent.scroll(window);

    const button = screen.getByRole("button", { name: "Back to top" });
    fireEvent.click(button);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("renders fully when the user prefers reduced motion", () => {
    mockUseReducedMotion.mockReturnValue(true);
    render(<LandingPage />);

    // Page still renders; the hero heading and CTAs are present.
    expect(screen.getByRole("heading", { name: /Your AI Guide to/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/login");
    mockUseReducedMotion.mockReturnValue(false);
  });
});
