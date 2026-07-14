import { Server, type Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { createAdapter } from "@socket.io/redis-adapter";
import type Redis from "ioredis";
import { UserRole } from "@hallpass/types";
import { resolveSessionUser, roleRank, parseCorsOrigins } from "@hallpass/express-middleware";
import { auth } from "../auth.js";
import { env } from "../env.js";
import { createBlockingRedis } from "./redis.js";
import { logger } from "@hallpass/logger";

let io: Server | undefined;

export function initSocket(
  httpServer: HttpServer,
): { io: Server; pubClient: Redis; subClient: Redis } {
  io = new Server(httpServer, {
    cors: { origin: parseCorsOrigins(env), credentials: env.CORS_ORIGIN !== "*" },
  });

  const pubClient = createBlockingRedis();
  const subClient = pubClient.duplicate();

  pubClient.on("error", (err) =>
    logger.error(err, "[socket-adapter] pub error"),
  );
  subClient.on("error", (err) =>
    logger.error(err, "[socket-adapter] sub error"),
  );

  // createAdapter() issues subClient.subscribe()/.psubscribe() but never awaits
  // their promises. On a Redis connect/auth failure those promises reject and,
  // being un-awaited, surface as unhandled rejections that the global handler in
  // index.ts turns into a process exit — taking the whole API down over a Redis
  // hiccup. Attach a catch so real-time degrades gracefully like redis.ts does.
  const subClientRaw = subClient as unknown as Record<
    "subscribe" | "psubscribe",
    (...args: unknown[]) => unknown
  >;
  for (const method of ["subscribe", "psubscribe"] as const) {
    const original = subClientRaw[method].bind(subClient);
    subClientRaw[method] = (...args: unknown[]) => {
      const result = original(...args);
      if (result instanceof Promise) {
        result.catch((err: unknown) =>
          logger.error(err, `[socket-adapter] sub ${method} error`),
        );
      }
      return result;
    };
  }

  io.adapter(createAdapter(pubClient, subClient, { key: `${env.REDIS_PREFIX}:socket.io` }));

  // lazyConnect defers connection until now; catch the initial connect failure
  // here so it never leaks as an unhandled rejection either.
  void pubClient.connect().catch((err) =>
    logger.error(err, "[socket-adapter] pub connect error"),
  );
  void subClient.connect().catch((err) =>
    logger.error(err, "[socket-adapter] sub connect error"),
  );

  io.use(async (socket, next) => {
    // Browsers can't set an Authorization header on a WebSocket upgrade, so
    // socket.io-client's `auth` option carries the session token instead.
    // Only used when no authorization header is already present.
    const token = socket.handshake.auth?.token;
    const headers =
      typeof token === "string" && token && !socket.handshake.headers.authorization
        ? { ...socket.handshake.headers, authorization: `Bearer ${token}` }
        : socket.handshake.headers;

    let user;
    try {
      user = await resolveSessionUser(auth, headers);
    } catch (err) {
      // resolveSessionUser returns null for missing/invalid sessions and only
      // throws on unexpected/DB errors — surface those as connect_error rather
      // than masking them as a false "Unauthorized".
      next(err as Error);
      return;
    }
    if (!user) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    // school room is the staff live pass board — students receive only their
    // own pass events via user:{id} (docs/SCHEMA_PLAN.md, Socket.io rooms)
    if (user.schoolId && roleRank(user.role) >= roleRank(UserRole.TEACHER)) {
      socket.join(`school:${user.schoolId}`);
    }
  });

  return { io, pubClient, subClient };
}

export function emitPassEvent(
  pass: { schoolId: number; studentId: number; [key: string]: unknown },
  event: string,
): void {
  if (!io) return; // not initialized (e.g., in tests)
  io.to(`school:${pass.schoolId}`).emit(event, pass);
  // pass:requested is staff-only — the requesting student already has the
  // pass from the REST response
  if (event !== "pass:requested") {
    io.to(`user:${pass.studentId}`).emit(event, pass);
  }
}
