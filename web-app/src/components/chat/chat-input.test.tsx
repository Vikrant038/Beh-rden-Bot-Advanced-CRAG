import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "@/components/chat/chat-input";
import { MAX_QUERY_LENGTH } from "@/lib/chat/types";

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

  it("shows no live character counter while under the limit", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByPlaceholderText(/Ask about visas/), "short question");
    expect(screen.queryByText(/characters over the/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/ 4,000/)).not.toBeInTheDocument();
  });

  it("warns with the exact overage once the user exceeds the limit and blocks send", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const input = screen.getByPlaceholderText(/Ask about visas/);
    const overText = "x".repeat(MAX_QUERY_LENGTH + 12);
    // user-event's paste() targets the focused element — focus first.
    await user.click(input);
    await user.paste(overText);

    // The alert names the exact overage and never shows a live counter.
    expect(
      screen.getByText(
        `This is 12 characters over the ${MAX_QUERY_LENGTH.toLocaleString()}-character limit.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();

    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    // Trimming back under the limit clears the warning and re-enables send.
    await user.clear(input);
    await user.type(input, "within the limit");
    expect(screen.queryByText(/characters over the/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });
});
