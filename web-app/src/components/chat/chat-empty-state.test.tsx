import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { installDomPolyfills } from "../../../tests/helpers/dom-polyfills";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";

// Control useReducedMotion so both branches (animation on / off) are exercised.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: vi.fn(() => false),
  };
});

import { useReducedMotion } from "framer-motion";

const mockedUseReducedMotion = vi.mocked(useReducedMotion);

// framer-motion's useReducedMotion calls window.matchMedia, which jsdom lacks.
installDomPolyfills();

afterEach(() => {
  mockedUseReducedMotion.mockReturnValue(false);
});

describe("ChatEmptyState", () => {
  it("renders the heading and subtitle only (suggestions live in the separate panel)", () => {
    render(<ChatEmptyState />);
    expect(screen.getByText("How can I help you today?")).toBeInTheDocument();
    expect(
      screen.getByText(/Ask about German student visas, APS certification, blocked accounts/),
    ).toBeInTheDocument();
    // No suggestion cards in the chat view anymore.
    expect(screen.queryByText("Visa documents")).not.toBeInTheDocument();
  });

  it("disables the floating animations when the user prefers reduced motion", () => {
    mockedUseReducedMotion.mockReturnValue(true);
    const { container } = render(<ChatEmptyState />);
    // Still renders fully — the motion.divs just get no `animate` prop.
    expect(screen.getByText("How can I help you today?")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
  });
});
