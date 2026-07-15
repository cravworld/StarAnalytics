import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isEmailAllowed } from "@/lib/auth-allowlist";
import { prisma } from "@/lib/prisma";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      return isEmailAllowed(user.email);
    },
    async jwt({ token, user }) {
      if (user?.email) {
        // Populate users.role on first login. No Supabase project exists yet in
        // Phase 0, so this is best-effort: it silently no-ops until DATABASE_URL
        // points at a real database, rather than breaking local dev/login.
        try {
          const dbUser = await prisma.user.upsert({
            where: { email: user.email },
            update: {},
            create: { email: user.email, name: user.name ?? undefined },
          });
          token.role = dbUser.role;
        } catch {
          token.role = "team";
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as typeof session.user & { role?: string }).role =
          (token.role as string | undefined) ?? "team";
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
});
