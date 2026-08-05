import { describe, it, expect } from "vitest";
import {
  createGuestCookieValue,
  createGuestId,
  verifyGuestCookieValue,
  readGuestIdFromRequest,
} from "@/server/guest";

describe("guest cookie helpers", () => {
  it("round-trips a signed cookie value", () => {
    const id = createGuestId();
    const value = createGuestCookieValue(id);
    expect(verifyGuestCookieValue(value)).toBe(id);
  });

  it("rejects a tampered signature", () => {
    const value = createGuestCookieValue("guest-id-1");
    const forged = `${value}0`; // corrupt the trailing signature
    expect(verifyGuestCookieValue(forged)).toBeNull();
  });

  it("rejects a tampered id (signature no longer matches)", () => {
    const value = createGuestCookieValue("guest-id-1");
    // Swap the id but keep the original signature.
    const signature = value.slice(value.indexOf(".") + 1);
    const forged = `other-id.${signature}`;
    expect(verifyGuestCookieValue(forged)).toBeNull();
  });

  it("rejects malformed values", () => {
    expect(verifyGuestCookieValue("no-dot-here")).toBeNull();
    expect(verifyGuestCookieValue(".only-signature")).toBeNull();
    expect(verifyGuestCookieValue("")).toBeNull();
    expect(verifyGuestCookieValue(null)).toBeNull();
    expect(verifyGuestCookieValue(undefined)).toBeNull();
  });

  it("reads and verifies the cookie from a Request header", () => {
    const id = createGuestId();
    const value = createGuestCookieValue(id);
    const request = new Request("http://localhost/api/trpc", {
      headers: { cookie: `other=1; behoerden_guest=${value}; x=2` },
    });
    expect(readGuestIdFromRequest(request)).toBe(id);
  });

  it("returns null when the guest cookie is absent or forged in the Request", () => {
    const noCookie = new Request("http://localhost/api/trpc");
    expect(readGuestIdFromRequest(noCookie)).toBeNull();

    const forged = new Request("http://localhost/api/trpc", {
      headers: { cookie: "behoerden_guest=attacker-id.forged-sig" },
    });
    expect(readGuestIdFromRequest(forged)).toBeNull();
  });
});
