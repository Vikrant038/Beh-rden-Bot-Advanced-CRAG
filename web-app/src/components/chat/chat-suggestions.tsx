"use client";

const SUGGESTIONS = [
  {
    title: "Visa documents",
    query: "What documents do I need for a German student visa?",
  },
  {
    title: "Blocked account",
    query: "How much do I need in a blocked account for 2026?",
  },
  {
    title: "APS certificate",
    query: "What is the APS certificate and how long does it take?",
  },
];

interface ChatSuggestionsProps {
  onSubmit: (query: string) => void;
}

/**
 * The first-ask suggestions window: three small rectangular boxes (title +
 * question, no icons) shown above the composer ONLY before the first message —
 * once the user has asked once, the panel disappears and the chat stays clean.
 */
export function ChatSuggestions({ onSubmit }: ChatSuggestionsProps) {
  return (
    <div className="px-3 pb-1 pt-2 sm:px-4 sm:pb-1.5">
      <div className="chat-column">
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3 sm:gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.title}
              type="button"
              onClick={() => onSubmit(suggestion.query)}
              className="group flex min-h-10 items-center gap-1.5 rounded-lg border border-glass-border bg-glass px-3 py-1.5 text-left shadow-glass backdrop-blur transition hover:border-primary/50 hover:bg-surface"
            >
              <span className="shrink-0 text-xs font-medium text-foreground">
                {suggestion.title}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                {suggestion.query}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
