import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "@/components/chat/chat-input";

function setup(props: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  const onSubmit = vi.fn();
  const onStop = vi.fn();
  const utils = render(
    <ChatInput onSubmit={onSubmit} onStop={onStop} isStreaming={false} {...props} />,
  );
  return { onSubmit, onStop, ...utils };
}

describe("ChatInput", () => {
  it("submits trimmed content on Enter and clears the textarea", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const input = screen.getByPlaceholderText(/Ask about visas/);
    await user.type(input, "  blocked account  ");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("blocked account");
    expect(input).toHaveValue("");
  });

  it("does not submit empty or whitespace-only input", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const input = screen.getByPlaceholderText(/Ask about visas/);
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(input, "   ");
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps newlines when shift+Enter is pressed", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const input = screen.getByPlaceholderText(/Ask about visas/);
    await user.type(input, "line1");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the send button until there is content", async () => {
    const user = userEvent.setup();
    setup();
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/Ask about visas/), "hi");
    expect(send).toBeEnabled();
  });

  it("shows a stop button while streaming and calls onStop", async () => {
    const user = userEvent.setup();
    const { onStop } = setup({ isStreaming: true });
    const stop = screen.getByRole("button", { name: "Stop generating" });
    await user.click(stop);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
  });

  it("disables the textarea when disabled", () => {
    setup({ disabled: true });
    expect(screen.getByPlaceholderText(/Ask about visas/)).toBeDisabled();
  });

  it("does not submit while streaming even with typed content", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ isStreaming: true });
    const input = screen.getByPlaceholderText(/Ask about visas/);
    await user.type(input, "mid-answer text");
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    // The stop control is shown instead of the send control while streaming.
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
  });

  it("clears the input via the clear button", async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByPlaceholderText(/Ask about visas/);
    await user.type(input, "to be cleared");
    await user.click(screen.getByRole("button", { name: "Clear input" }));
    expect(input).toHaveValue("");
  });

  it("inserts a suggestion draft and focuses the textarea", async () => {
    const user = userEvent.setup();
    setup({ suggestions: ["Blocked account 2026?"] });
    await user.click(screen.getByRole("button", { name: "Blocked account 2026?" }));
    expect(screen.getByPlaceholderText(/Ask about visas/)).toHaveValue("Blocked account 2026?");
  });

  it("hides quick prompts while streaming or with typed content", async () => {
    const user = userEvent.setup();
    const { rerender } = setup({ suggestions: ["Prompt A"] });
    expect(screen.getByRole("button", { name: "Prompt A" })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/Ask about visas/), "typed");
    expect(screen.queryByRole("button", { name: "Prompt A" })).not.toBeInTheDocument();
    rerender(
      <ChatInput onSubmit={vi.fn()} onStop={vi.fn()} isStreaming suggestions={["Prompt A"]} />,
    );
    expect(screen.queryByRole("button", { name: "Prompt A" })).not.toBeInTheDocument();
  });

  it("switches modes via the toggle buttons", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    setup({ onModeChange, mode: "standard" });
    await user.click(screen.getByRole("button", { name: /Agentic/ }));
    expect(onModeChange).toHaveBeenCalledWith("agentic");
    await user.click(screen.getByRole("button", { name: /Standard/ }));
    expect(onModeChange).toHaveBeenCalledWith("standard");
  });

  it("reports an unavailable clipboard via onPasteUnavailable", async () => {
    const user = userEvent.setup();
    const onPasteUnavailable = vi.fn();
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    try {
      setup({ onPasteUnavailable });
      await user.click(screen.getByRole("button", { name: "Paste from clipboard" }));
      expect(onPasteUnavailable).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });
});
