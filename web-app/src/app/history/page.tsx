import { BackButton } from "@/components/ui/back-button";
import { HistoryList } from "@/components/history/history-list";

export default function HistoryPage() {
  return (
    <div id="main" className="mx-auto max-w-3xl px-4 py-8">
      <BackButton href="/chat" label="Back to chat" />
      <h1 className="text-2xl font-semibold">Conversation history</h1>
      <p className="mt-1 text-sm text-muted">Browse, export, or delete past conversations.</p>
      <HistoryList />
    </div>
  );
}
