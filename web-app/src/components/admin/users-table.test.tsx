import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsersTable } from "./users-table";

const sessionMock = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => sessionMock(),
}));

const setRoleMutateMock = vi.fn();
const setBlockedMutateMock = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    admin: {
      setUserRole: {
        useMutation: () => ({ mutate: setRoleMutateMock, isPending: false }),
      },
      setUserBlocked: {
        useMutation: () => ({ mutate: setBlockedMutateMock, isPending: false }),
      },
    },
    useUtils: () => ({ admin: { users: { invalidate: vi.fn() } } }),
  },
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "ADMIN";
  createdAt: string;
  conversationCount: number;
  blockedAt: string | null;
}

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "u1",
    name: "Alice",
    email: "alice@example.com",
    role: "USER",
    createdAt: "2026-01-01T00:00:00Z",
    conversationCount: 4,
    blockedAt: null,
    ...overrides,
  };
}

describe("UsersTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The admin viewing the table is user "me-1".
    sessionMock.mockReturnValue({ data: { user: { id: "me-1", role: "ADMIN" } } });
  });

  it("renders a loading skeleton while accounts are loading", () => {
    const { container } = render(<UsersTable users={[]} loading={true} />);
    expect(container.querySelector(".animate-pulse")).toBeDefined();
  });

  it("renders an empty state when no accounts exist", () => {
    render(<UsersTable users={[]} loading={false} />);
    expect(screen.getByText(/No accounts yet/i)).toBeDefined();
  });

  it("renders account rows with role badge, conversation count, and status", () => {
    render(
      <UsersTable
        users={[
          makeUser(),
          makeUser({
            id: "u2",
            name: "Bob",
            email: "bob@example.com",
            role: "ADMIN",
            blockedAt: "2026-08-01T00:00:00Z",
            conversationCount: 1,
          }),
        ]}
        loading={false}
      />,
    );

    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("alice@example.com")).toBeDefined();
    expect(screen.getByText("USER")).toBeDefined();
    expect(screen.getByText("ADMIN")).toBeDefined();
    expect(screen.getByText("Active")).toBeDefined();
    expect(screen.getByText("Blocked")).toBeDefined();
    // Conversation counts render as plain numbers.
    expect(screen.getByText("4")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  it("marks the admin's own row and hides its action buttons", () => {
    sessionMock.mockReturnValue({ data: { user: { id: "u1", role: "ADMIN" } } });
    render(<UsersTable users={[makeUser()]} loading={false} />);

    expect(screen.getByText(/\(you\)/)).toBeDefined();
    expect(screen.queryByLabelText(/Promote alice@example.com/i)).toBeNull();
    expect(screen.queryByLabelText(/Block alice@example.com/i)).toBeNull();
  });

  it("promotes a USER to ADMIN via the role mutation", () => {
    render(<UsersTable users={[makeUser()]} loading={false} />);

    fireEvent.click(screen.getByLabelText("Promote alice@example.com"));
    expect(setRoleMutateMock).toHaveBeenCalledWith({ id: "u1", role: "ADMIN" });
  });

  it("demotes an ADMIN to USER via the role mutation", () => {
    render(
      <UsersTable
        users={[makeUser({ role: "ADMIN", name: "Bob", email: "bob@example.com" })]}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByLabelText("Demote bob@example.com"));
    expect(setRoleMutateMock).toHaveBeenCalledWith({ id: "u1", role: "USER" });
  });

  it("unblocks an account immediately without a confirmation dialog", () => {
    render(
      <UsersTable users={[makeUser({ blockedAt: "2026-08-01T00:00:00Z" })]} loading={false} />,
    );

    fireEvent.click(screen.getByLabelText("Unblock alice@example.com"));
    expect(setBlockedMutateMock).toHaveBeenCalledWith({ id: "u1", blocked: false });
  });

  it("requires confirmation before blocking an account", () => {
    render(<UsersTable users={[makeUser()]} loading={false} />);

    fireEvent.click(screen.getByLabelText("Block alice@example.com"));
    // Dialog opens; the mutation must not fire until confirmed.
    expect(screen.getByText("Block this account?")).toBeDefined();
    expect(setBlockedMutateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Block account" }));
    expect(setBlockedMutateMock).toHaveBeenCalledWith({ id: "u1", blocked: true });
  });
});
