"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Pin, PinOff, Trash2, X } from "lucide-react";
import { api } from "@/lib/trpc/client";
import type { ConversationSummary } from "@/lib/chat/types";
import { cn, formatRelativeTime } from "@/lib/utils";

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
    if (!confirming) {
      setConfirming(true);
      return;
    }
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
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={saveRename}
          aria-label="Save name"
          className="shrink-0 rounded p-1 text-muted transition hover:text-success"
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
          className="shrink-0 rounded p-1 text-muted transition hover:text-foreground"
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
          ? "bg-surface-hover text-foreground"
          : "text-muted hover:bg-surface-hover hover:text-foreground",
        pinned && "bg-primary/5",
      )}
    >
      <button type="button" onClick={navigate} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm">
          {conversation.title ?? "Untitled conversation"}
          {pinned ? <span className="ml-1 text-accent">•</span> : null}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-muted">
          {formatRelativeTime(conversation.updatedAt)} · {conversation.messageCount} msgs
        </p>
      </button>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={remove}
            aria-label="Confirm delete"
            className="rounded-md bg-destructive/15 px-1.5 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/25"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            aria-label="Cancel delete"
            className="rounded-md px-1.5 py-1 text-xs text-muted transition hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={onTogglePin}
            aria-label={pinned ? "Unpin conversation" : "Pin conversation"}
            title={pinned ? "Unpin" : "Pin"}
            className={cn(
              "rounded p-1 transition hover:bg-surface-hover hover:text-foreground",
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
            className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={remove}
            aria-label="Delete conversation"
            title="Delete"
            className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
