import { encode } from "next-auth/jwt";

// This file is test-only. It is never imported by app source and adds nothing to
// the app bundle. It does not bypass authentication: it asks NextAuth's own
// `encode` to mint the same session token a real Google login would produce,
// using the app's own secret. The app's real `auth()` guard then validates it
// normally — see the negative test in phase0-screens.spec.ts, which proves the
// guard still rejects requests that arrive without this cookie.
if (process.env.NODE_ENV === "production") {
  throw new Error("mintSession must never run in a production build");
}

// Auth.js v5 reads AUTH_SECRET first, then falls back to NEXTAUTH_SECRET
// (node_modules/next-auth/lib/env.js). Mirror that order so the token is
// derived from whichever secret the app itself will validate against.
// Annotated `string` (not inferred `string | undefined`): the throw below guarantees
// it, but TS doesn't carry that narrowing into mintSessionCookie's closure.
const secret: string = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
if (!secret) {
  throw new Error(
    "AUTH_SECRET/NEXTAUTH_SECRET is required to mint an e2e session. " +
      "playwright.config.ts loads it from .env.local — the same file the dev server reads.",
  );
}

// Auth.js v5 derives the encryption key from (secret, salt) where salt is the
// cookie name. On local http there is no `__Secure-` prefix; that applies to https only.
export const SESSION_COOKIE_NAME = "authjs.session-token";

export const TEST_USER = {
  name: "E2E Test User",
  // A synthetic .test address that can never be a real Google account.
  email: process.env.E2E_TEST_EMAIL ?? "e2e@staranalytics.test",
  // "team" is what the app's jwt callback actually produces today: the Prisma
  // upsert creates users at the schema default (team), and the no-database catch
  // path also falls back to "team". Nothing in Phase 0 branches on role yet.
  role: "team",
};

export async function mintSessionCookie() {
  const token = await encode({
    // Matches the claim shape the app's jwt callback leaves on the token.
    // encode() adds iat/exp/jti itself.
    token: {
      name: TEST_USER.name,
      email: TEST_USER.email,
      role: TEST_USER.role,
      sub: "e2e-test-user",
    },
    secret,
    salt: SESSION_COOKIE_NAME,
    maxAge: 60 * 60,
  });

  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
  };
}
