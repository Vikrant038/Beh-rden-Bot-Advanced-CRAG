"use client";

import { useState } from "react";
import { SendHorizontal, Square } from "lucide-react";

export function ChatInput({
  onSubmit,
  onStop,
  isStreaming,
  disabled,
}: {
  onSubmit: (query: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="border-t border-border bg-background/80 p-4 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask about visas, APS, blocked accounts, university admissions…"
          disabled={disabled}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-primary disabled:opacity-60"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface text-destructive transition hover:bg-surface-hover"
          >
            <Square className="h-4 w-4 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            aria-label="Send message"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-white transition hover:bg-primary-hover disabled:opacity-40"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted">
        Behoerden-Bot may make mistakes. Verify important information against official sources.
      </p>
    </div>
  );
}
