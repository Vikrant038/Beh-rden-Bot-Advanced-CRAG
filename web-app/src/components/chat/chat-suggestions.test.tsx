import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSuggestions } from "@/components/chat/chat-suggestions";

describe("ChatSuggestions", () => {
  it("renders three suggestion blocks in the separate panel", () => {
    render(<ChatSuggestions onSubmit={() => undefined} />);
    expect(screen.getByText("Visa documents")).toBeInTheDocument();
    expect(screen.getByText("Blocked account")).toBeInTheDocument();
    expect(screen.getByText("APS certificate")).toBeInTheDocument();
  });

  it("submits the tapped question", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChatSuggestions onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: /Blocked account/ }));
    expect(onSubmit).toHaveBeenCalledWith("How much do I need in a blocked account for 2026?");
  });
});
