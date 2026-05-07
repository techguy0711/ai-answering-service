// Auth.js v5 (NextAuth) configuration.
//
// We use Credentials provider (email + password) because the spec says
// "Clerk or Auth.js" and Clerk requires API keys to even boot. Credentials
// keeps the local-dev story friction-free.
//
// Each user belongs to exactly one tenant (`users.tenant_id` in the schema),
// so `tenantId` lives on the JWT/session — no per-request lookup needed.

import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { dbAdmin } from "@/lib/db";
import type { UserRole } from "@prisma/client";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      tenantId: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    tenantId: string;
    role: UserRole;
  }
}

// Note: we don't augment the JWT module here. Auth.js v5 betas have shifted
// the JWT augmentation target between "next-auth/jwt" and "@auth/core/jwt"
// across releases, and TypeScript only allows augmentation of modules it
// can resolve. The session callback uses `as` casts on token fields, which
// works regardless of whether the augmentation is in scope.

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/signin",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // Auth lookup needs to find a user before we know their tenant, so
        // this goes through dbAdmin. The user table has RLS in production
        // — see prisma/migrations/.../enable_rls/migration.sql for how to
        // grant the auth path bypass via a privileged role.
        const user = await dbAdmin.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        if (!user) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          tenantId: user.tenantId,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.tenantId = user.tenantId;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.sub as string;
        session.user.tenantId = token.tenantId as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
    authorized({ auth: session, request: { nextUrl } }) {
      const isAuthed = !!session?.user;
      const onAuthRoute =
        nextUrl.pathname === "/signin" ||
        nextUrl.pathname === "/signup";
      const onPublicVoiceRoute = nextUrl.pathname.startsWith("/api/voice");

      if (onAuthRoute) return true;
      if (onPublicVoiceRoute) return true;
      return isAuthed;
    },
  },
});
