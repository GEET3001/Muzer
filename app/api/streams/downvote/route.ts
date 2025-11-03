import { prismaClient } from "@/app/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const UpvoteSchema = z.object({
    streamId: z.string(),
})

export async function POST(req: NextRequest) {
    const session = await getServerSession();

    const user = await prismaClient.user.findFirst({
        where: {
            email: session?.user?.email ?? ""
        }
    });

    if (!user) {
        return NextResponse.json({ message: "unauthenticated" }, { status: 403 });
    }

    try {
        const data = UpvoteSchema.parse(await req.json());

        await prismaClient.upvotes.delete({
            where: {
                userId_streamId: {
                    userId: user.id,
                    streamId: data.streamId
                }
            }
        });

        return NextResponse.json({ message: "upvote removed" }, { status: 200 });
    } catch (e) {
        return NextResponse.json({ message: "error while removing upvote" }, { status: 403 });
    }
}
