import { NextRequest } from "next/server";
import { castVote } from "@/app/lib/vote";

export async function POST(req: NextRequest) {
  return castVote(req, -1, {
    route: "/api/streams/downvote",
    cast: "downvoted",
    verb: "downvoting",
  });
}
