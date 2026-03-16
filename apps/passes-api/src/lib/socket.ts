import { Server, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { auth } from '../auth.js';
import { env } from '../env.js';

let io: Server;

export function initSocket(httpServer: HttpServer): Server {
  const corsOrigins =
    env.CORS_ORIGIN === '*'
      ? '*'
      : env.CORS_ORIGIN.split(',').map((o) => o.trim());

  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: corsOrigins !== '*' },
  });

  io.use(async (socket, next) => {
    try {
      // Convert socket handshake headers to Node-compatible format for better-auth
      const session = await auth.api.getSession({
        headers: new Headers(socket.handshake.headers as Record<string, string>),
      });
      if (!session?.user) {
        next(new Error('Unauthorized'));
        return;
      }
      socket.data.user = session.user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;
    if (user?.schoolId) socket.join(`school:${user.schoolId}`);
    if (user?.id) socket.join(`user:${user.id}`);
  });

  return io;
}

export function emitPassEvent(
  pass: { schoolId: number; studentId: number; [key: string]: unknown },
  event: string,
): void {
  if (!io) return; // not initialized (e.g., in tests)
  io.to(`school:${pass.schoolId}`).emit(event, pass);
  io.to(`user:${pass.studentId}`).emit(event, pass);
}
