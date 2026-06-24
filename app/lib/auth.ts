import type { AuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prismaClient } from "@/app/lib/db";
import { Provider, Role } from "@prisma/client";

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
