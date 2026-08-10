"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Ban, CheckCircle2, ShieldCheck, ShieldX, UserRound } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/lib/toast";
import { formatRelativeTime } from "@/lib/utils";

interface AdminUserRow {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "ADMIN";
  createdAt: string;
  conversationCount: number;
  blockedAt: string | null;
}

interface UsersTableProps {
  users: AdminUserRow[];
  loading: boolean;
}

/**
 * Admin user-management surface: every account (guests excluded), their
 * conversation count, role promotion/demotion, and suspension. An admin can
 * never act on their own row (server also rejects it) — that keeps the app
 * from being locked out of admin access via a one-way door.
 */
export function UsersTable({ users, loading }: UsersTableProps) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const utils = api.useUtils();

  const setRole = api.admin.setUserRole.useMutation({
    onSuccess: () => {
      void utils.admin.users.invalidate();
      toast({ title: "Role updated", variant: "success" });
    },
    onError: () => toast({ title: "Could not update the role", variant: "error" }),
  });
  const setBlocked = api.admin.setUserBlocked.useMutation({
    onSuccess: () => {
      void utils.admin.users.invalidate();
      toast({ title: "Account updated", variant: "success" });
    },
    onError: () => toast({ title: "Could not update the account", variant: "error" }),
  });

  // Which user is pending a destructive block confirmation.
  const [blockTarget, setBlockTarget] = useState<AdminUserRow | null>(null);

  const myId = session?.user?.id;

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">User accounts</h3>
        <div className="mt-4 space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">User accounts</h3>
        <p className="mt-4 text-sm text-muted">No accounts yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">User accounts</h3>
      <p className="mb-3 text-xs text-muted">
        All registered accounts — promote/demote roles or suspend accounts. You cannot modify your
        own row.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-4 font-medium">User</th>
              <th className="py-2 pr-4 font-medium">Role</th>
              <th className="py-2 pr-4 font-medium">Conversations</th>
              <th className="py-2 pr-4 font-medium">Joined</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isMe = user.id === myId;
              return (
                <tr key={user.id} className="border-b border-border/60 last:border-0">
                  <td className="min-w-[180px] max-w-[260px] py-2.5 pr-4">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {user.name?.charAt(0)?.toUpperCase() ?? user.email.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-foreground">
                          {user.name ?? "Unnamed"}
                          {isMe ? (
                            <span className="ml-1.5 text-[10px] text-muted">(you)</span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-muted">{user.email}</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        user.role === "ADMIN"
                          ? "bg-primary/15 text-primary"
                          : "bg-surface-hover text-muted"
                      }`}
                    >
                      {user.role === "ADMIN" ? (
                        <ShieldCheck className="h-3 w-3" />
                      ) : (
                        <UserRound className="h-3 w-3" />
                      )}
                      {user.role}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-xs tabular-nums text-muted">
                    {user.conversationCount}
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-4 text-xs text-muted">
                    {formatRelativeTime(user.createdAt)}
                  </td>
                  <td className="py-2.5 pr-4">
                    {user.blockedAt ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                        <Ban className="h-3 w-3" />
                        Blocked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Active
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!isMe ? (
                        <>
                          <button
                            type="button"
                            disabled={setRole.isPending || setBlocked.isPending}
                            onClick={() =>
                              setRole.mutate({
                                id: user.id,
                                role: user.role === "ADMIN" ? "USER" : "ADMIN",
                              })
                            }
                            aria-label={`${user.role === "ADMIN" ? "Demote" : "Promote"} ${user.email}`}
                            title={user.role === "ADMIN" ? "Demote to user" : "Promote to admin"}
                            className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                          >
                            {user.role === "ADMIN" ? (
                              <ShieldX className="h-4 w-4" />
                            ) : (
                              <ShieldCheck className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={setBlocked.isPending || setRole.isPending}
                            onClick={() =>
                              user.blockedAt
                                ? setBlocked.mutate({ id: user.id, blocked: false })
                                : setBlockTarget(user)
                            }
                            aria-label={`${user.blockedAt ? "Unblock" : "Block"} ${user.email}`}
                            title={user.blockedAt ? "Unblock account" : "Block account"}
                            className={`grid min-h-11 min-w-11 place-items-center rounded-lg p-2 transition disabled:opacity-50 ${
                              user.blockedAt
                                ? "text-success hover:bg-surface-hover"
                                : "text-destructive hover:bg-destructive/10"
                            }`}
                          >
                            {user.blockedAt ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <Ban className="h-4 w-4" />
                            )}
                          </button>
                        </>
                      ) : (
                        <span className="px-2 text-[11px] text-muted">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(blockTarget)}
        onOpenChange={(open) => !open && setBlockTarget(null)}
        title="Block this account?"
        description={`${blockTarget?.email ?? "This user"} will be signed out and unable to use the app. You can unblock them later — no data is deleted.`}
        confirmLabel="Block account"
        isPending={setBlocked.isPending}
        onConfirm={() => {
          if (blockTarget) {
            setBlocked.mutate({ id: blockTarget.id, blocked: true });
          }
          setBlockTarget(null);
        }}
      />
    </div>
  );
}
