import { notFound } from "next/navigation";
import { ChatInterface } from "@/components/chat/chat-interface";
import type { ChatMode } from "@/lib/chat/types";

interface ChatPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string | string[]; m?: string | string[] }>;
}

export default async function ChatPage({ params, searchParams }: ChatPageProps) {
  const { id } = await params;
  if (!id) {
    notFound();
  }
  const { q, m } = await searchParams;
  const initialQuery = typeof q === "string" && q.trim() ? q.trim() : undefined;
  // Mode handoff from the /chat composer (agentic | standard); anything else
  // falls back to the interface default.
  const initialMode = m === "agentic" || m === "standard" ? (m as ChatMode) : undefined;
  return (
    <ChatInterface conversationId={id} initialQuery={initialQuery} initialMode={initialMode} />
  );
}
