import type { AuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prismaClient } from "@/app/lib/db";
import { Provider, Role, type User } from "@prisma/client";

/**
 * Single source of truth for the NextAuth config. The route handler AND every
 * `getServerSession(authOptions)` call must use this same object, otherwise the
 * server can't reliably decode the session cookie/JWT.
 */
export const authOptions: AuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  callbacks: {
    async signIn(params) {
      if (!params.user.email) {
        return false;
      }
      try {
        await prismaClient.user.upsert({
          where: { email: params.user.email },
          update: {},
          create: {
            email: params.user.email,
            provider: Provider.Google,
            role: Role.EndUser,
          },
        });
      } catch (e) {
        console.error("signIn upsert failed:", e);
        return false;
      }
      return true;
    },
  },
};

/**
 * Resolve the signed-in user row for the current request, or null when there is
 * no session (or the session points at a user we no longer have).
 *
 * `session.user` carries no id — only an email — so every authenticated route
 * needs this same lookup. Callers own the failure response because the existing
 * endpoints don't agree on one (`{ message }` vs `{ error }`, 401 vs 404), and
 * those shapes are part of their public contract.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return prismaClient.user.findUnique({ where: { email: session.user.email } });
}
