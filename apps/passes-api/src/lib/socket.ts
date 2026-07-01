import { Server, type Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { auth } from "../auth.js";
import { corsOrigins } from "./cors.js";
import { env } from "../env.js";
import { logger } from "@hallpass/logger";

let io: Server | undefined;

export function initSocket(
  httpServer: HttpServer,
): { io: Server; pubClient: Redis; subClient: Redis } {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: env.CORS_ORIGIN !== "*" },
  });

  const pubClient = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err) =>
    logger.error(err, "[socket-adapter] pub error"),
  );
  subClient.on("error", (err) =>
    logger.error(err, "[socket-adapter] sub error"),
  );

  io.adapter(createAdapter(pubClient, subClient));

  io.use(async (socket, next) => {
    try {
      // Convert socket handshake headers to Node-compatible format for better-auth
      const session = await auth.api.getSession({
        headers: new Headers(
          socket.handshake.headers as Record<string, string>,
        ),
      });
      if (!session?.user) {
        next(new Error("Unauthorized"));
        return;
      }
      socket.data.user = session.user;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user;
    if (user?.schoolId) socket.join(`school:${user.schoolId}`);
    if (user?.id) socket.join(`user:${user.id}`);
  });

  return { io, pubClient, subClient };
}

export function emitPassEvent(
  pass: { schoolId: number; [key: string]: unknown },
  event: string,
): void {
  if (!io) return; // not initialized (e.g., in tests)
  io.to(`school:${pass.schoolId}`).emit(event, pass);
}
