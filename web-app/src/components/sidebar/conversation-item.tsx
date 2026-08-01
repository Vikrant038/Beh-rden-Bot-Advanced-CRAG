"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/trpc/client";
import type { ConversationSummary } from "@/lib/chat/types";
import { cn, formatRelativeTime } from "@/lib/utils";

export function ConversationItem({
  conversation,
  active,
  onNavigate,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const deleteMutation = api.conversation.delete.useMutation();
  const [confirming, setConfirming] = useState(false);

  const navigate = () => {
    onNavigate?.();
    router.push(`/chat/${conversation.id}`);
  };

  const remove = () => {
    if (!confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 2500);
      return;
    }
    deleteMutation.mutate(
      { id: conversation.id },
      {
        onSuccess: () => {
          void utils.conversation.list.invalidate();
          setConfirming(false);
        },
      },
    );
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-lg px-2 py-2 transition-colors",
        active
          ? "bg-surface-hover text-foreground"
          : "text-muted hover:bg-surface-hover hover:text-foreground",
      )}
    >
      <button type="button" onClick={navigate} className="min-w-0 flex-1 text-left">
        <p className="truncate">{conversation.title ?? "Untitled conversation"}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted">
          {formatRelativeTime(conversation.updatedAt)} · {conversation.messageCount} msgs ·{" "}
          {conversation.mode}
        </p>
      </button>
      <button
        type="button"
        onClick={remove}
        aria-label={confirming ? "Confirm delete" : "Delete conversation"}
        className={cn(
          "shrink-0 rounded p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:text-destructive",
          confirming && "opacity-100 text-destructive",
        )}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
