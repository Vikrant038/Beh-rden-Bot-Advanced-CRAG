"use client";

export function StreamingText({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <span>
      {text}
      {streaming && (
        <span className="streaming-cursor" aria-hidden="true">
          ▍
        </span>
      )}
    </span>
  );
}
