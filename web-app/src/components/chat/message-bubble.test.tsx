import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    expect(container.querySelector(".streaming-cursor")).not.toBeNull();
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
    expect(screen.getByText("Served from semantic cache.")).toBeInTheDocument();
  });

  it("shows a thinking placeholder for empty assistant content", () => {
    render(
      <MessageBubble message={message({ role: "ASSISTANT", content: "" })} streaming={false} />,
    );
    expect(screen.getByText("Thinking…")).toBeInTheDocument();
  });
});
