import { NextRequest, NextResponse } from "next/server";
import { z } from "zod"
import { prismaClient } from "@/app/lib/db"
import { getServerSession } from "next-auth";
//@ts-ignore
import youtubesearchapi from "youtube-search-api";

const YT_REGEX = /^(?:(?:https?:)?\/\/)?(?:www\.)?(?:m\.)?(?:youtu(?:be)?\.com\/(?:v\/|embed\/|watch(?:\/|\?v=))|youtu\.be\/)((?:\w|-){11})(?:\S+)?$/;

const CreateStreamSchema = z.object({
    url: z.string(),
    sessionCode: z.string()
})

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession();
        if (!session?.user?.email) {
            return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
        }
        const authedUser = await prismaClient.user.findUnique({ where: { email: session.user.email } });
        if (!authedUser) return NextResponse.json({ message: "User not found" }, { status: 404 });

        const data = CreateStreamSchema.parse(await req.json());
        const isYt = data.url.match(YT_REGEX);
        if (!isYt) {
            return NextResponse.json({ message: "wrong url format " }, { status: 411 })
        }

        const foundSession = await prismaClient.session.findUnique({ where: { code: data.sessionCode } });
        if (!foundSession) {
            return NextResponse.json({ message: "Invalid session" }, { status: 404 });
        }

        const extractedId = data.url.split("?v=")[1];
        const res = await youtubesearchapi.GetVideoDetails(extractedId)
        const thumbnails = res.thumbnail.thumbnails;
        thumbnails.sort((a: { width: number }, b: { width: number }) => a.width < b.width ? -1 : 1)
        const stream = await prismaClient.stream.create({
            data: {
                userId: foundSession.hostId,
                addedById: authedUser.id,
                sessionId: foundSession.id,
                url: data.url,
                extractedId,
                type: "Youtube",
                title: res.title ?? "cant find vdo",
                smallImg: (thumbnails.length > 1 ? thumbnails[thumbnails.length - 2].url : thumbnails[thumbnails.length - 1].url) ?? "",
                bigImg: thumbnails[thumbnails.length - 1].url ?? ""
            }
        });
        return NextResponse.json({ message: "Added Stream", id: stream.id })
    }
    catch (e) {
        return NextResponse.json({ message: "Error while adding a stream" }, { status: 411 })
    }
}

export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get("code");
    if (!code) return NextResponse.json({ message: "code required" }, { status: 400 });

    const foundSession = await prismaClient.session.findUnique({ where: { code } });
    if (!foundSession) return NextResponse.json({ message: "Invalid session" }, { status: 404 });

    const streams = await prismaClient.stream.findMany({
        where: { sessionId: foundSession.id },
        include: { upvotes: true },
        orderBy: { createdAt: 'asc' as any }
    } as any);

    const items = streams
        .map(s => ({
            id: s.id,
            url: s.url,
            title: s.title,
            smallImg: s.smallImg,
            bigImg: s.bigImg,
            extractedId: s.extractedId,
            upvotes: s.upvotes.length
        }))
        .sort((a, b) => b.upvotes - a.upvotes);

    return NextResponse.json({ items });
}