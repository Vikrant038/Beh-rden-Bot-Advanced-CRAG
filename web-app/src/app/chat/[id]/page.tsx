import { notFound } from "next/navigation";
import { ChatInterface } from "@/components/chat/chat-interface";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    notFound();
  }
  return <ChatInterface conversationId={id} />;
}
