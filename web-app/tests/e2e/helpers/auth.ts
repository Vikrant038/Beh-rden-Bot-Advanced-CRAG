import type { BrowserContext } from "@playwright/test";
import { encode } from "@auth/core/jwt";

const SESSION_COOKIE_NAME = "authjs.session-token";

export interface SessionOptions {
  id?: string;
  role?: "USER" | "ADMIN";
  name?: string;
  email?: string;
}

/**
 * Signs an Auth.js JWT session cookie so the app treats the request as an
 * authenticated user without going through a real OAuth provider. The salt
 * must match the session cookie name (Auth.js v5 `getSalt`), and the secret
 * must equal the one the dev server uses (see playwright.config.ts).
 */
export async function setSessionCookie(context: BrowserContext, options: SessionOptions = {}) {
  const { id = "user-e2e", role = "USER", name = "E2E User", email = "e2e@example.com" } = options;

  const token = await encode({
    token: { id, role, name, email, sub: id },
    secret: process.env.NEXTAUTH_SECRET ?? "e2e-local-secret-not-for-production",
    salt: SESSION_COOKIE_NAME,
    maxAge: 30 * 24 * 60 * 60,
  });

  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
