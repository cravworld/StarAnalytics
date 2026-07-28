import "server-only";
import { auth } from "@/auth";

// Server Actions are directly POST-reachable independent of the page/layout that
// renders them — a page-level auth() redirect does NOT protect them. Every
// "use server" action must call this first. See node_modules/next/dist/docs/
// 01-app/02-guides/data-security.md, "Authentication and authorization".
export async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  return session;
}
