import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeToggle } from "@/components/chat/mode-toggle";

describe("ModeToggle", () => {
  it("renders both modes and marks the active one pressed", () => {
    render(<ModeToggle mode="agentic" onChange={() => undefined} />);
    expect(screen.getByRole("button", { name: /Standard/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: /Agentic/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("fires onChange with the chosen mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModeToggle mode="agentic" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Standard/ }));
    expect(onChange).toHaveBeenCalledWith("standard");
    await user.click(screen.getByRole("button", { name: /Agentic/ }));
    expect(onChange).toHaveBeenCalledWith("agentic");
  });
});
