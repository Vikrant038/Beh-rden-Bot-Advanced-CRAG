"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FileStack, History, Plus, Settings, ShieldAlert } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { ConversationItem } from "@/components/sidebar/conversation-item";

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const createMutation = api.conversation.create.useMutation();
  const conversations = api.conversation.list.useInfiniteQuery(
    { limit: 30 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );

  const items = conversations.data?.pages.flatMap((page) => page.items) ?? [];

  const newChat = () => {
    createMutation.mutate(
      {},
      {
        onSuccess: (conversation) => {
          onNavigate?.();
          router.push(`/chat/${conversation.id}`);
        },
      },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button
          type="button"
          onClick={newChat}
          disabled={createMutation.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {items.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            active={pathname === `/chat/${conversation.id}`}
            onNavigate={onNavigate}
          />
        ))}
        {items.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted">No conversations yet.</p>
        )}
      </nav>

      <div className="space-y-0.5 border-t border-border p-2">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            router.push("/sources");
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <FileStack className="h-4 w-4" />
          Knowledge base
        </button>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            router.push("/history");
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <History className="h-4 w-4" />
          History
        </button>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            router.push("/settings");
          }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
          Settings
        </button>
        {session?.user?.role === "ADMIN" && (
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              router.push("/admin/dashboard");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <ShieldAlert className="h-4 w-4" />
            Admin
          </button>
        )}
      </div>
    </div>
  );
}
