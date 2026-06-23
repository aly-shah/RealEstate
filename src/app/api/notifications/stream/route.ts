import { auth } from "@/auth";
import { subscribeUser } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream of the signed-in user's notifications. The client
 * opens an EventSource here; we subscribe it to the realtime fan-out (Postgres
 * LISTEN/NOTIFY) and forward `notification` events. A 25s heartbeat keeps the
 * connection alive through proxies; cleanup runs on client disconnect.
 */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* stream already closed */
        }
      };

      write(`event: ready\ndata: {"ok":true}\n\n`);
      unsubscribe = subscribeUser(userId, (e) => write(`event: notification\ndata: ${JSON.stringify(e)}\n\n`));
      heartbeat = setInterval(() => write(`: ping\n\n`), 25_000);

      const close = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell nginx not to buffer this response (so events flush immediately).
      "X-Accel-Buffering": "no",
    },
  });
}
