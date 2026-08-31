"use client";

import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  FileStack,
  GraduationCap,
  History,
  LogIn,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { api } from "@/lib/trpc/client";
import { ConversationItem } from "@/components/sidebar/conversation-item";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { SkeletonList } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { useDismissable } from "@/hooks/use-dismissable";
import { groupConversationsByTime } from "@/lib/conversation-groups";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";
import { GUEST_PROMPT_LIMIT } from "@/config/app";

const PINNED_KEY = "behoerden.pinnedConversations";

function readPinned(): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }
  try {
    const raw = window.localStorage.getItem(PINNED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writePinned(ids: Set<string>) {
  try {
    window.localStorage.setItem(PINNED_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore storage failures.
  }
}

interface AppSidebarProps {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}

/** Shared Settings/Theme/Sign-out menu body for the rail and expanded menus. */
function ProfileMenuBody({
  className,
  onCloseThen,
}: {
  className: string;
  onCloseThen: (path: string) => void;
}) {
  return (
    <div role="menu" aria-label="Profile menu" className={className}>
      <div className="flex items-center justify-between rounded-lg px-3 py-2">
        <button
          type="button"
          role="menuitem"
          onClick={() => onCloseThen("/settings")}
          className="flex items-center gap-2 text-sm text-foreground"
        >
          <Settings className="h-4 w-4 text-muted" />
          Settings
        </button>
        <ThemeToggle compact />
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => void signOut({ callbackUrl: "/" })}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive transition hover:bg-destructive/10"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  );
}

export function AppSidebar({ collapsed = false, onToggleCollapsed, onNavigate }: AppSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, status: sessionStatus } = useSession();
  // Accurate guest usage for the free-tier chip (list is paginated/filterable).
  // Fired only once auth has resolved to "no session", so signed-in users never
  // see a flash of the guest chip while useSession is still loading.
  const isDefinitelyGuest = sessionStatus === "unauthenticated";
  const guestCount = api.conversation.count.useQuery(undefined, {
    enabled: isDefinitelyGuest,
    // The prompt cap is a live resource: refetch when the tab regains focus
    // (the global provider sets refetchOnWindowFocus:false) and treat the
    // result as immediately stale so the chip never shows a stale count.
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => readPinned());
  const [mounted, setMounted] = useState(false);

  const conversations = api.conversation.list.useInfiniteQuery(
    { limit: 50, search: search || undefined },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const knowledgeBase = api.source.list.useQuery();

  useEffect(() => setMounted(true), []);

  // The /chat route is a lazy composer: it creates the conversation only when
  // the first message is sent, so clicking "New chat" never leaves an empty
  // "New conversation" row behind in history.
  const newChat = useCallback(() => {
    onNavigate?.();
    router.push("/chat");
  }, [onNavigate, router]);

  useEffect(() => {
    // On mobile, the drawer mounts a second instance of AppSidebar. Skip adding
    // global listeners on the mobile drawer instance (onNavigate is set only on mobile).
    if (onNavigate) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNavigate, newChat]);

  const items = useMemo(
    () => conversations.data?.pages.flatMap((page) => page.items) ?? [],
    [conversations.data],
  );
  const groups = useMemo(() => groupConversationsByTime(items, pinnedIds), [items, pinnedIds]);
  const isLoading = conversations.isLoading || !mounted;

  const togglePin = (id: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      writePinned(next);
      return next;
    });
  };

  const go = (path: string) => {
    onNavigate?.();
    router.push(path);
  };

  // Signing in must NOT clear the guest cookie: the tRPC context claims the
  // guest's conversations via claimGuestData on the first signed-in request
  // (src/server/trpc/context.ts), which requires the cookie to still be present.
  const signIn = () => {
    router.push("/login");
  };

  // 11.5 — Min 44px touch targets on the primary navigation row.
  const navButtonClass =
    "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary";

  // 6.8 — Profile dropdown (Settings / Theme / Sign out).
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  useDismissable(profileRef, profileOpen, () => setProfileOpen(false));

  const bottomNavItems = [
    {
      href: "/sources",
      label: "Knowledge base",
      icon: FileStack,
      badge: knowledgeBase.data?.length,
    },
    { href: "/history", label: "History", icon: History },
    { href: "/settings", label: "Settings", icon: Settings },
    ...(session?.user?.role === "ADMIN"
      ? [{ href: "/admin/dashboard", label: "Admin", icon: ShieldAlert }]
      : []),
  ];

  // ─── Collapsed icon rail ─────────────────────────────────────
  // Click-through by design: tapping a control (nav item, new chat, theme,
  // profile) acts directly and never opens the rail; tapping empty rail space
  // expands the sidebar (the only way to open it — there is no hover-expand,
  // so reaching for an icon never makes the whole sidebar pop open).
  if (collapsed) {
    return (
      <>
        <div
          className="flex h-full flex-col items-center gap-1 py-3"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const hitControl = target.closest(
              'button, a, input, [role="menu"], [role="menuitem"], [role="menuitemradio"]',
            );
            if (!hitControl) {
              onToggleCollapsed?.();
            }
          }}
        >
          {/* Brand mark at the top of the rail — visible at every width. */}
          <span
            className="brand-gradient mb-2 grid h-9 w-9 place-items-center rounded-xl text-white shadow-[0_4px_12px_-4px_var(--color-primary)]"
            aria-label="Behörden-Bot"
          >
            <GraduationCap className="h-4 w-4" />
          </span>
          <button
            type="button"
            onClick={newChat}
            aria-label="New chat"
            title="New chat (⌘N)"
            className="brand-gradient grid h-11 w-11 place-items-center rounded-xl text-white shadow-[0_4px_16px_-4px_var(--color-primary)] transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
          </button>

          <div className="mt-3 flex w-full flex-1 flex-col items-center gap-1">
            {bottomNavItems.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => go(item.href)}
                  aria-label={item.label}
                  title={item.label}
                  className={cn(
                    "relative grid h-11 w-11 place-items-center rounded-lg transition focus-visible:ring-2 focus-visible:ring-primary",
                    active
                      ? "bg-primary/10 text-foreground"
                      : "text-muted hover:bg-surface-hover hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {typeof item.badge === "number" && item.badge > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-semibold text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col items-center gap-2">
            {session?.user ? (
              <div ref={profileRef} className="relative">
                <button
                  type="button"
                  onClick={() => setProfileOpen((value) => !value)}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  aria-label="Account menu"
                  title={session.user.name ?? session.user.email ?? "Account"}
                  className="grid h-11 w-11 place-items-center rounded-full bg-primary text-xs font-semibold text-white transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {session.user.name?.charAt(0)?.toUpperCase() ??
                    session.user.email?.charAt(0)?.toUpperCase() ??
                    "?"}
                </button>
                {profileOpen ? (
                  <ProfileMenuBody
                    className="absolute bottom-0 left-full z-50 ml-2 w-44 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-2xl"
                    onCloseThen={(path) => {
                      setProfileOpen(false);
                      go(path);
                    }}
                  />
                ) : null}
              </div>
            ) : isDefinitelyGuest ? (
              <button
                type="button"
                onClick={signIn}
                aria-label="Sign in"
                title="Sign in"
                className="grid h-11 w-11 place-items-center rounded-full bg-surface-hover text-muted transition hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                <LogIn className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  // ─── Expanded sidebar ────────────────────────────────────────
  return (
    <>
      <div className="flex h-full flex-col">
        {/* Brand header — brand mark + collapse toggle on one line, visible
            at every width. pb-3 leaves a clear gap before the search row. */}
        <div className="flex items-center gap-2 px-4 pb-3 pt-3.5">
          <span className="brand-gradient grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white shadow-[0_4px_12px_-4px_var(--color-primary)]">
            <GraduationCap className="h-4 w-4" />
          </span>
          <span className="truncate font-semibold">Behörden-Bot</span>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* Search first, New chat as a compact plus on the same line — the
            search spans the width with even border spacing, the plus sits
            flush right of it. */}
        <div className="flex items-center gap-1.5 px-3 pb-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className="min-h-11 w-full rounded-xl border border-border bg-surface/60 py-2.5 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-primary/60 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]"
            />
          </div>
          <button
            type="button"
            onClick={newChat}
            aria-label="New chat"
            title="New chat (⌘N)"
            className="brand-gradient grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-[0_4px_16px_-4px_var(--color-primary)] transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto px-2 pb-3" aria-label="Conversations">
          {isLoading ? (
            <div className="space-y-4 px-1">
              <SkeletonList rows={3} />
              <SkeletonList rows={2} />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-2 py-8 text-center">
              <MessageSquare className="h-8 w-8 text-muted" />
              <p className="mt-3 text-sm font-medium text-foreground">
                {search ? "No matching conversations" : "No conversations yet"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {search
                  ? "Try a different search term."
                  : "Start your first chat to begin your German journey."}
              </p>
              {!search ? (
                <button
                  type="button"
                  onClick={newChat}
                  className="brand-gradient mt-4 rounded-xl px-4 py-2 text-xs font-medium text-white transition hover:brightness-110"
                >
                  Start your first chat
                </button>
              ) : null}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key}>
                <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((conversation) => (
                    <ConversationItem
                      key={conversation.id}
                      conversation={conversation}
                      active={pathname === `/chat/${conversation.id}`}
                      pinned={pinnedIds.has(conversation.id)}
                      onTogglePin={() => togglePin(conversation.id)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
          {conversations.hasNextPage ? (
            <button
              type="button"
              onClick={() => void conversations.fetchNextPage()}
              disabled={conversations.isFetchingNextPage}
              className="min-h-11 w-full rounded-lg px-2 py-1.5 text-center text-xs text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
            >
              {conversations.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </nav>

        <div className="space-y-0.5 border-t border-border p-2">
          {bottomNavItems.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => go(item.href)}
                className={cn(navButtonClass, active && "bg-surface-hover text-foreground")}
              >
                <item.icon className="h-4 w-4" />
                <span className="min-w-0 flex-1 text-left">{item.label}</span>
                {typeof item.badge === "number" && item.badge > 0 ? (
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}

          <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
            <ThemeToggle compact />
            <span className="text-[10px] text-muted" title={`Behörden-Bot v${APP_VERSION}`}>
              v{APP_VERSION}
            </span>
          </div>

          {session?.user ? (
            <div ref={profileRef} className="relative mt-1">
              <button
                type="button"
                onClick={() => setProfileOpen((value) => !value)}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-surface-hover"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-white">
                  {session.user.name?.charAt(0)?.toUpperCase() ??
                    session.user.email?.charAt(0)?.toUpperCase() ??
                    "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {session.user.name ?? "User"}
                  </span>
                  <span className="block truncate text-[10px] text-muted">
                    {session.user.email}
                  </span>
                </span>
                <Settings className="h-3.5 w-3.5 shrink-0 text-muted" />
              </button>
              {profileOpen ? (
                <ProfileMenuBody
                  className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-[50vh] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-2xl"
                  onCloseThen={(path) => {
                    setProfileOpen(false);
                    go(path);
                  }}
                />
              ) : null}
            </div>
          ) : isDefinitelyGuest ? (
            <div className="mt-1 rounded-lg border border-border p-2">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-hover text-xs font-semibold text-muted">
                  ?
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">Guest</span>
                  <span className="block truncate text-[10px] text-muted">
                    {guestCount.data?.count ?? 0}/{GUEST_PROMPT_LIMIT} prompts · no account
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={signIn}
                className="brand-gradient mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110"
              >
                <LogIn className="h-3.5 w-3.5" />
                Sign in
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
