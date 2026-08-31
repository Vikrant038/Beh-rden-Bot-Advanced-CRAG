import { vi, describe, it, expect, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/server/auth", () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

// Use the REAL guest helpers — they're pure crypto (no DB), so the cookie
// round-trip exercises the actual verify-then-reuse path in the route.
import { POST } from "@/app/api/guest/route";
import { createGuestCookieValue, createGuestId } from "@/server/guest";
import { GUEST_COOKIE } from "@/config/app";

const session = {
  user: { id: "user-1", role: "USER" },
  expires: "2099-01-01T00:00:00.000Z",
};

function buildRequest(cookie?: string): Request {
  return new Request("http://localhost/api/guest", {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  });
}

function setCookieHeader(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (!header) {
    throw new Error("expected a set-cookie header");
  }
  return header;
}

describe("POST /api/guest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue(null);
  });

  it("mints a fresh guest id when no cookie exists", async () => {
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.reused).toBe(false);
    expect(typeof body.guestId).toBe("string");
    expect(setCookieHeader(response)).toContain(`${GUEST_COOKIE}=`);
  });

  it("reuses a valid existing guest cookie instead of minting a new id", async () => {
    const guestId = createGuestId();
    const cookie = `${GUEST_COOKIE}=${createGuestCookieValue(guestId)}`;

    const response = await POST(buildRequest(cookie));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.reused).toBe(true);
    expect(body.guestId).toBe(guestId);
  });

  it("mints a fresh id for a forged cookie (rejects the tampered signature)", async () => {
    const response = await POST(buildRequest(`${GUEST_COOKIE}=attacker-id.forged-sig`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reused).toBe(false);
    expect(body.guestId).not.toBe("attacker-id");
  });

  it("returns 409 for a signed-in user (never downgrade to guest)", async () => {
    mockAuth.mockResolvedValue(session);
    const response = await POST(buildRequest());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
  });
});
