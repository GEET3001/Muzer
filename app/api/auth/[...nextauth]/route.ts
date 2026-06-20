import GoogleProvider from "next-auth/providers/google";
import NextAuth from "next-auth"
import { prismaClient } from "@/app/lib/db";
import { Provider, Role } from "@prisma/client";

const handler = NextAuth({
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID ?? "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ""
        })
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
                        role: Role.EndUser
                    }
                });
            }
            catch (e) {
                console.error("signIn upsert failed:", e);
                return false;
            }
            return true;
        }
    }
})
export { handler as GET, handler as POST }