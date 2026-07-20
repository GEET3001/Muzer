import { NextRequest } from "next/server";
import { getCurrentUser } from "@/app/lib/auth";
import { prismaClient } from "@/app/lib/db";
import { isParticipant } from "@/app/lib/access";
import { subscribeQueueChanged } from "@/app/lib/redis";

// SSE stream of "queue changed" events for one session. Clients open an
// EventSource here and refetch the queue only when an event arrives, replacing
// the old 2s poll. Gated behind the same two-code membership as the queue.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return new Response("code required", { status: 400 });

  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const foundSession = await prismaClient.session.findUnique({ where: { code } });
  if (!foundSession) return new Response("Invalid session", { status: 404 });
  if (!(await isParticipant(user.id, foundSession))) {
    return new Response("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // controller already closed
        }
      };

      send("connected");
      const unsubscribe = subscribeQueueChanged(code, () => send("changed"));

      // Comment heartbeat keeps the connection alive through proxies.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // ignore
        }
      }, 25000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (e.g. nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
