"use client";

import { api } from "@/lib/trpc/client";
import { UsersTable } from "@/components/admin/users-table";

export default function AdminUsersPage() {
  const users = api.admin.users.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">User management</h1>
        <p className="mt-1 text-sm text-muted">
          Accounts, roles, and suspensions · {new Date().toLocaleDateString()}
        </p>
      </div>
      <UsersTable users={users.data ?? []} loading={users.isLoading} />
    </div>
  );
}
