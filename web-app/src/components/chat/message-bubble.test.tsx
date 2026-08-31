import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ChatMessage } from "@/lib/chat/types";

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "m1",
    role: "USER",
    content: "Hello",
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ChatMessage;
}

describe("MessageBubble", () => {
  it("renders user messages right-aligned", () => {
    const { container } = render(
      <MessageBubble message={message({ role: "USER" })} streaming={false} />,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(container.querySelector(".justify-end")).not.toBeNull();
  });

  it("renders SYSTEM messages centered", () => {
    render(
      <MessageBubble
        message={message({ role: "SYSTEM", content: "System note" })}
        streaming={false}
      />,
    );
    expect(screen.getByText("System note")).toBeInTheDocument();
  });

  it("renders DISAMBIGUATION messages centered", () => {
    render(
      <MessageBubble
        message={message({ role: "DISAMBIGUATION", content: "Which do you mean?" })}
        streaming={false}
      />,
    );
    expect(screen.getByText("Which do you mean?")).toBeInTheDocument();
  });

  it("renders assistant markdown content", () => {
    render(
      <MessageBubble
        message={message({ role: "ASSISTANT", content: "**bold** answer" })}
        streaming={false}
      />,
    );
    expect(screen.getByText("bold", { selector: "strong" })).toBeInTheDocument();
  });

  it("renders a collapsible source list when sources exist", () => {
    render(
      <MessageBubble
        message={message({
          role: "ASSISTANT",
          content: "Answer",
          sources: [{ name: "Blocked Account Doc", url: "https://example.com/doc", score: 0.92 }],
        })}
        streaming={false}
      />,
    );
    const toggle = screen.getByRole("button", { name: /Sources \(1\)/ });
    fireEvent.click(toggle);
    const link = screen.getByRole("link", { name: /Blocked Account Doc/ });
    expect(link).toHaveAttribute("href", "https://example.com/doc");
    expect(screen.getByText("92%")).toBeInTheDocument();
  });

  it("hides the source list while streaming", () => {
    render(
      <MessageBubble
        message={message({
          role: "ASSISTANT",
          content: "Answer",
          sources: [{ name: "Doc", url: "https://example.com", score: 0.9 }],
        })}
        streaming
      />,
    );
    expect(screen.queryByText(/Sources \(1\)/)).not.toBeInTheDocument();
  });

  it("shows the streaming cursor while streaming", () => {
    const { container } = render(
      <MessageBubble message={message({ role: "ASSISTANT", content: "Answer" })} streaming />,
    );
    // The live markdown renderer carries the inline cursor marker while streaming.
    expect(container.querySelector(".markdown-streaming")).not.toBeNull();
  });

  it("flags cached responses", () => {
    render(
      <MessageBubble
        message={message({
          role: "ASSISTANT",
          content: "Answer",
          metadata: { isCached: true },
        })}
        streaming={false}
      />,
    );
    expect(screen.getByText(/Answered from cache/)).toBeInTheDocument();
  });

  it("shows a thinking placeholder for empty assistant content", () => {
    render(
      <MessageBubble message={message({ role: "ASSISTANT", content: "" })} streaming={false} />,
    );
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });
  /** Stubs navigator.clipboard.writeText for the copy-button cases (auto-restored). */
  const stubClipboard = (writeText: ReturnType<typeof vi.fn>) => {
    vi.stubGlobal("navigator", Object.assign({}, navigator, { clipboard: { writeText } }));
  };

  it("copies the answer via the clipboard and shows the copied state", async () => {
    const onCopied = vi.fn();
    stubClipboard(vi.fn(async () => undefined));
    render(
      <MessageBubble
        message={message({ role: "ASSISTANT", content: "copyable answer" })}
        streaming={false}
        onCopied={onCopied}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    await waitFor(() => expect(onCopied).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Copy answer" }).querySelector(".lucide-check"),
      ).not.toBeNull(),
    );
    vi.unstubAllGlobals();
  });

  it("reports a copy failure when the clipboard write is denied", async () => {
    const onCopyFailed = vi.fn();
    stubClipboard(vi.fn(async () => Promise.reject(new Error("denied"))));
    render(
      <MessageBubble
        message={message({ role: "ASSISTANT", content: "copy me" })}
        streaming={false}
        onCopyFailed={onCopyFailed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    await waitFor(() => expect(onCopyFailed).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });

  it("toggles feedback up/down and nulls on re-click", async () => {
    const onFeedback = vi.fn();
    render(
      <MessageBubble
        message={message({ role: "ASSISTANT", content: "answer" })}
        streaming={false}
        feedback="up"
        onFeedback={onFeedback}
      />,
    );
    await fireEvent.click(screen.getByRole("button", { name: "Mark answer as helpful" }));
    // Re-clicking the active feedback clears it.
    expect(onFeedback).toHaveBeenCalledWith(null);
    await fireEvent.click(screen.getByRole("button", { name: "Mark answer as not helpful" }));
    expect(onFeedback).toHaveBeenCalledWith("down");
  });

  it("renders a regenerate button and fires onRegenerate", async () => {
    const onRegenerate = vi.fn();
    render(
      <MessageBubble
        message={message({ role: "ASSISTANT", content: "answer" })}
        streaming={false}
        onRegenerate={onRegenerate}
      />,
    );
    await fireEvent.click(screen.getByRole("button", { name: "Regenerate answer" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("shows cached latency in seconds when metadata has latencyMs", () => {
    render(
      <MessageBubble
        message={message({
          role: "ASSISTANT",
          content: "Answer",
          metadata: { isCached: true, latencyMs: 3500 },
        })}
        streaming={false}
      />,
    );
    expect(screen.getByText(/Answered from cache \(3\.5s\)/)).toBeInTheDocument();
  });
});
