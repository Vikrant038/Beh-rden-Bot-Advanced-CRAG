"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  BookOpen,
  FileStack,
  History,
  Home,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { api } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/lib/toast";
import { GUEST_LIMIT_REACHED_CODE, GUEST_PROMPT_LIMIT } from "@/lib/guest";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const createMutation = api.conversation.create.useMutation();

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: "home",
        label: "Go to Home",
        hint: "G H",
        icon: Home,
        keywords: "home landing landing page start",
        run: () => router.push("/"),
      },
      {
        id: "new-chat",
        label: "Start a new chat",
        hint: "N",
        icon: Plus,
        keywords: "new chat conversation start",
        run: async () => {
          try {
            const conversation = await createMutation.mutateAsync({});
            router.push(`/chat/${conversation.id}`);
          } catch (error) {
            const code = (error as { data?: { code?: string } }).data?.code;
            if (code === GUEST_LIMIT_REACHED_CODE) {
              toast({
                title: "Guest limit reached",
                description: `Free browsing includes ${GUEST_PROMPT_LIMIT} prompts. Sign in to keep chatting.`,
                variant: "warning",
                action: { label: "Sign in", onClick: () => router.push("/login") },
              });
            } else {
              toast({ title: "Could not start a new chat", variant: "error" });
            }
          }
        },
      },
      {
        id: "history",
        label: "Open History",
        hint: "G H",
        icon: History,
        keywords: "history past conversations archive",
        run: () => router.push("/history"),
      },
      {
        id: "sources",
        label: "Browse the Knowledge Base",
        hint: "G K",
        icon: FileStack,
        keywords: "sources knowledge base documents guides",
        run: () => router.push("/sources"),
      },
      {
        id: "settings",
        label: "Open Settings",
        hint: "G S",
        icon: Settings,
        keywords: "settings preferences account",
        run: () => router.push("/settings"),
      },
      {
        id: "guide",
        label: "Read the Guides",
        hint: "G G",
        icon: BookOpen,
        keywords: "guides resources walkthroughs how to",
        run: () => router.push("/#resources"),
      },
    ];

    const isDark = resolvedTheme === "dark";
    base.push({
      id: "theme",
      label: isDark ? "Switch to Light mode" : "Switch to Dark mode",
      hint: "T",
      icon: isDark ? Sun : Moon,
      keywords: "theme dark light appearance color",
      run: () => setTheme(isDark ? "light" : "dark"),
    });

    base.push({
      id: "sign-out",
      label: "Sign out",
      hint: "Q",
      icon: LogOut,
      keywords: "sign out logout exit account",
      run: () => void signOut({ callbackUrl: "/" }),
    });

    return base;
  }, [createMutation, resolvedTheme, router, setTheme, toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return commands;
    }
    return commands.filter(
      (command) => command.keywords.includes(q) || command.label.toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const run = useCallback((command: Command) => {
    setOpen(false);
    void command.run();
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (filtered.length === 0) {
          return;
        }
        setActiveIndex((index) => (index + 1) % filtered.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (filtered.length === 0) {
          return;
        }
        setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const command = filtered[activeIndex];
        if (command) {
          run(command);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, activeIndex, run]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        type="button"
        aria-label="Close command palette"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-glass-border bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Type a command or search…"
            aria-label="Search commands"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <kbd className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted">
            esc
          </kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {filtered.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted">
              No commands match “{query}”.
            </li>
          )}
          {filtered.map((command, index) => {
            const Icon = command.icon;
            const active = index === activeIndex;
            return (
              <li key={command.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => run(command)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                    active ? "bg-primary/10 text-foreground" : "text-muted",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-8 w-8 place-items-center rounded-lg",
                      active ? "bg-primary text-primary-foreground" : "bg-surface-hover text-muted",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1">{command.label}</span>
                  {command.hint && (
                    <kbd className="hidden font-mono text-[10px] text-muted sm:block">
                      {command.hint}
                    </kbd>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate · <kbd className="font-mono">↵</kbd> select
          </span>
          <span>⌘K to open</span>
        </div>
      </div>
    </div>
  );
}
