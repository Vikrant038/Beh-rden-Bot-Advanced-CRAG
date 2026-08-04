"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function Markdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  return (
    // When streaming, the blinking cursor rides inline at the end of the last
    // rendered block (via .markdown-streaming > :last-child::after) instead of
    // sitting on its own line below the answer.
    <div className={cn("markdown-body", streaming && "markdown-streaming")}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
