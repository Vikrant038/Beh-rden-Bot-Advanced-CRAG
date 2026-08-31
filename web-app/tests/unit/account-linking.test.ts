import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    account: { upsert: vi.fn() },
  },
}));

import { prisma } from "@/server/db";
import { autoLinkOAuthAccount } from "@/server/lib/account-linking";

const mockedUserFindUnique = prisma.user.findUnique as ReturnType<typeof vi.fn>;
const mockedAccountUpsert = prisma.account.upsert as ReturnType<typeof vi.fn>;

describe("autoLinkOAuthAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const githubAccount = {
    provider: "github",
    type: "oauth",
    providerAccountId: "gh-123",
    access_token: "tok",
  };

  it("links a second provider to the existing user (same verified email)", async () => {
    // User already exists from a previous GitHub sign-in; now Google signs in.
    mockedUserFindUnique.mockResolvedValue({ id: "user-42" } as never);
    mockedAccountUpsert.mockResolvedValue({ id: "acct-1" } as never);

    const linked = await autoLinkOAuthAccount(
      { email: "person@example.com" },
      { ...githubAccount, provider: "google", providerAccountId: "go-7" },
    );

    expect(linked).toBe(true);
    expect(mockedUserFindUnique).toHaveBeenCalledWith({
      where: { email: "person@example.com" },
      select: { id: true },
    });
    expect(mockedAccountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_providerAccountId: {
            provider: "google",
            providerAccountId: "go-7",
          },
        },
        update: { userId: "user-42" },
        create: expect.objectContaining({
          userId: "user-42",
          provider: "google",
          providerAccountId: "go-7",
          access_token: "tok",
        }),
      }),
    );
  });

  it("does nothing for a brand-new user (no existing account)", async () => {
    mockedUserFindUnique.mockResolvedValue(null as never);

    const linked = await autoLinkOAuthAccount({ email: "new@example.com" }, githubAccount);

    expect(linked).toBe(false);
    expect(mockedAccountUpsert).not.toHaveBeenCalled();
  });

  it("does nothing when the provider profile has no email", async () => {
    const linked = await autoLinkOAuthAccount({ email: null }, githubAccount);
    expect(linked).toBe(false);
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
  });

  it("does nothing when there is no account (e.g. credentials flow)", async () => {
    const linked = await autoLinkOAuthAccount({ email: "x@example.com" }, null);
    expect(linked).toBe(false);
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
  });

  it("does nothing when the account lacks a providerAccountId", async () => {
    const linked = await autoLinkOAuthAccount(
      { email: "x@example.com" },
      { provider: "github", type: "oauth", providerAccountId: "" },
    );
    expect(linked).toBe(false);
    expect(mockedUserFindUnique).not.toHaveBeenCalled();
  });

  it("upsert is idempotent for an already-linked provider account", async () => {
    mockedUserFindUnique.mockResolvedValue({ id: "user-42" } as never);
    mockedAccountUpsert.mockResolvedValue({ id: "existing-acct" } as never);

    const linked = await autoLinkOAuthAccount({ email: "person@example.com" }, githubAccount);

    expect(linked).toBe(true);
    // Same unique key → Prisma updates the row in place; no duplicate.
    expect(mockedAccountUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_providerAccountId: {
            provider: "github",
            providerAccountId: "gh-123",
          },
        },
      }),
    );
  });
});
