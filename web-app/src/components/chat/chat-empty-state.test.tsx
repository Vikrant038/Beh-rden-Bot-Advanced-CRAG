import "@testing-library/jest-dom/vitest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatEmptyState, QUICK_PROMPTS } from "@/components/chat/chat-empty-state";

// framer-motion's useReducedMotion calls window.matchMedia, which jsdom lacks.
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
});

describe("ChatEmptyState", () => {
  it("renders the heading and the suggested-prompt cards", () => {
    render(<ChatEmptyState onSubmit={() => undefined} />);
    expect(screen.getByText("How can I help you today?")).toBeInTheDocument();
    expect(screen.getByText("Visa documents")).toBeInTheDocument();
    expect(screen.getByText("Blocked account")).toBeInTheDocument();
    expect(screen.getByText("APS certificate")).toBeInTheDocument();
    expect(screen.getByText("Funding options")).toBeInTheDocument();
  });

  it("submits the card's query in agentic mode when clicked", () => {
    const onSubmit = vi.fn();
    render(<ChatEmptyState onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /Visa documents/ }));
    expect(onSubmit).toHaveBeenCalledWith(
      "What documents do I need for a German student visa?",
      "agentic",
    );
  });

  it("exposes the quick prompts used by the chat input chips", () => {
    expect(QUICK_PROMPTS).toHaveLength(3);
    expect(QUICK_PROMPTS[0]).toContain("APS");
  });
});
