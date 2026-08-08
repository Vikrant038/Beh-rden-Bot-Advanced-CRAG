"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { api } from "@/lib/trpc/client";
import type { ConversationSummary } from "@/lib/chat/types";
import { cn, formatRelativeTime } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ConversationItemProps {
  conversation: ConversationSummary;
  active: boolean;
  pinned: boolean;
  onTogglePin: () => void;
  onDeleted?: (conversation: ConversationSummary) => void;
  onNavigate?: () => void;
}

export function ConversationItem({
  conversation,
  active,
  pinned,
  onTogglePin,
  onDeleted,
  onNavigate,
}: ConversationItemProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const deleteMutation = api.conversation.delete.useMutation();
  const renameMutation = api.conversation.updateTitle.useMutation();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const navigate = () => {
    onNavigate?.();
    router.push(`/chat/${conversation.id}`);
  };

  // Warm the conversation body (messages + sources) while the user hovers or
  // tabs to the item, so switching chats is a cache hit instead of a cold
  // round-trip. Prefetch is idempotent and silently no-ops when already cached.
  const prefetchConversation = useCallback(() => {
    void utils.conversation.getById.prefetch({ id: conversation.id });
  }, [utils, conversation.id]);

  const saveRename = () => {
    const title = draft.trim();
    setEditing(false);
    if (!title || title === conversation.title) {
      setDraft(conversation.title ?? "");
      return;
    }
    renameMutation.mutate(
      { id: conversation.id, title },
      {
        onSuccess: () => {
          void utils.conversation.list.invalidate();
        },
      },
    );
  };

  const remove = () => {
    setConfirming(false);
    deleteMutation.mutate(
      { id: conversation.id },
      {
        onSuccess: () => {
          void utils.conversation.list.invalidate();
          onDeleted?.(conversation);
        },
      },
    );
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-surface-hover px-2 py-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              saveRename();
            }
            if (event.key === "Escape") {
              setDraft(conversation.title ?? "");
              setEditing(false);
            }
          }}
          onBlur={saveRename}
          aria-label="Rename conversation"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary"
        />
        {/* #44 — 44px touch targets for the rename actions */}
        <button
          type="button"
          onClick={saveRename}
          aria-label="Save name"
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded p-1 text-muted transition hover:text-success"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(conversation.title ?? "");
            setEditing(false);
          }}
          aria-label="Cancel rename"
          className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded p-1 text-muted transition hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex items-center gap-1 rounded-lg py-2 pl-3 pr-1 transition-colors",
        active
          ? "bg-primary/10 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          : "text-muted hover:bg-surface-hover hover:text-foreground",
        pinned && "bg-primary/5",
      )}
    >
      {/* Active row accent bar */}
      {active && (
        <span
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]"
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        onClick={navigate}
        onMouseEnter={prefetchConversation}
        onFocus={prefetchConversation}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm">
          {conversation.title ?? "Untitled conversation"}
          {pinned ? <span className="ml-1 text-accent">•</span> : null}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-muted">
          {formatRelativeTime(conversation.updatedAt)} · {conversation.messageCount} msgs
        </p>
      </button>

      {/* #36/#45 — actions are always visible on touch; hover-revealed on desktop only */}
      <div className="flex shrink-0 items-center gap-0.5 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? "Unpin conversation" : "Pin conversation"}
          title={pinned ? "Unpin" : "Pin"}
          className={cn(
            "grid min-h-11 min-w-9 place-items-center rounded-lg p-1 transition hover:bg-surface-hover hover:text-foreground",
            pinned ? "text-accent opacity-100" : "text-muted",
          )}
        >
          {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Rename conversation"
          title="Rename"
          className="grid min-h-11 min-w-9 place-items-center rounded-lg p-1 text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label="Delete conversation"
          title="Delete"
          className="grid min-h-11 min-w-9 place-items-center rounded-lg p-1 text-muted transition hover:bg-surface-hover hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 6.6 — Destructive delete confirmation as a real dialog. */}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Delete conversation?"
        description={`"${conversation.title ?? "Untitled conversation"}" will be moved to deleted conversations. You can restore it from the history page within the retention window.`}
        confirmLabel="Delete"
        isPending={deleteMutation.isPending}
        onConfirm={remove}
      />
    </div>
  );
}
