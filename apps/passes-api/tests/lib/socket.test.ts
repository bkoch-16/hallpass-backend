import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server } from 'socket.io';

// Mock the io server variable by testing emitPassEvent behavior directly
// Full auth-based integration tests would require a live better-auth server.

// We need to mock dependencies before importing the module under test
vi.mock('ioredis', () => ({
  default: class MockRedis {
    constructor(_url: string, _opts?: unknown) {}
    duplicate() { return this; }
    on() { return this; }
    connect() { return Promise.resolve(); }
    subscribe() { return Promise.resolve(); }
    psubscribe() { return Promise.resolve(); }
  },
}));

vi.mock('@socket.io/redis-adapter', () => ({
  createAdapter: vi.fn().mockReturnValue(
    class MockAdapter {
      constructor(_ns: unknown) {}
      init() {}
      close() {}
    }
  ),
}));

vi.mock('../../src/auth.js', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@hallpass/db', () => ({
  prisma: {
    user: { findFirst: vi.fn() },
  },
}));

const { mockResolveSessionUser } = vi.hoisted(() => ({
  mockResolveSessionUser: vi.fn(),
}));

vi.mock('@hallpass/express-middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hallpass/express-middleware')>();
  return { ...actual, resolveSessionUser: mockResolveSessionUser };
});

vi.mock('../../src/env.js', () => ({
  env: {
    CORS_ORIGIN: 'http://localhost:3000',
    BETTER_AUTH_URL: 'http://localhost:3001',
    BETTER_AUTH_SECRET: 'test-secret',
    DATABASE_URL: 'mysql://test',
    REDIS_URL: 'redis://localhost:6379',
    REDIS_PREFIX: 'test',
  },
}));

function fakeSocket(user: Record<string, unknown>) {
  return { data: { user }, join: vi.fn() };
}

function connectionHandler(ioServer: Server) {
  return ioServer.sockets.listeners('connection')[0] as (socket: unknown) => void;
}

// The auth middleware registered via io.use() lives on the main namespace's
// internal _fns array.
function authMiddleware(ioServer: Server) {
  const fns = (ioServer.sockets as unknown as {
    _fns: Array<(socket: unknown, next: (err?: Error) => void) => void>;
  })._fns;
  return fns[0];
}

describe('emitPassEvent', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not throw when called before initSocket (io is undefined)', async () => {
    // Import fresh module — io is undefined at module load time
    const { emitPassEvent } = await import('../../src/lib/socket.js');

    const pass = { schoolId: 1, studentId: 10, id: 100, status: 'PENDING' };

    expect(() => emitPassEvent(pass, 'pass:requested')).not.toThrow();
  });

  it('initSocket returns a Server instance', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();

    const { io: ioServer } = initSocket(httpServer);

    expect(ioServer).toBeDefined();
    expect(typeof ioServer.to).toBe('function');
    expect(typeof ioServer.emit).toBe('function');

    // Clean up
    ioServer.close();
    httpServer.close();
  });

  it('emitPassEvent emits to the school room and the student room', async () => {
    const { createServer } = await import('node:http');
    const { initSocket, emitPassEvent } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const toSpy = vi.spyOn(ioServer, 'to');
    // to() returns a BroadcastOperator; mock it to allow chained .emit()
    const emitMock = vi.fn();
    toSpy.mockReturnValue({ emit: emitMock } as unknown as ReturnType<typeof ioServer.to>);

    const pass = { schoolId: 5, studentId: 42, id: 200, status: 'ACTIVE' };
    emitPassEvent(pass, 'pass:approved');

    expect(toSpy).toHaveBeenCalledWith('school:5');
    expect(toSpy).toHaveBeenCalledWith('user:42');
    expect(emitMock).toHaveBeenCalledTimes(2);
    expect(emitMock).toHaveBeenCalledWith('pass:approved', pass);

    ioServer.close();
    httpServer.close();
  });

  it('emitPassEvent sends pass:requested to the school room only', async () => {
    const { createServer } = await import('node:http');
    const { initSocket, emitPassEvent } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const toSpy = vi.spyOn(ioServer, 'to');
    const emitMock = vi.fn();
    toSpy.mockReturnValue({ emit: emitMock } as unknown as ReturnType<typeof ioServer.to>);

    const pass = { schoolId: 5, studentId: 42, id: 200, status: 'PENDING' };
    emitPassEvent(pass, 'pass:requested');

    expect(toSpy).toHaveBeenCalledWith('school:5');
    expect(toSpy).not.toHaveBeenCalledWith('user:42');
    expect(emitMock).toHaveBeenCalledTimes(1);

    ioServer.close();
    httpServer.close();
  });
});

describe('socket auth middleware', () => {
  beforeEach(() => {
    vi.resetModules();
    mockResolveSessionUser.mockReset();
  });

  it('rejects with Unauthorized when there is no session user', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    mockResolveSessionUser.mockResolvedValue(null);

    const next = vi.fn();
    await authMiddleware(ioServer)({ data: {}, handshake: { headers: {} } }, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');

    ioServer.close();
    httpServer.close();
  });

  it('propagates an unexpected DB error instead of masking it as Unauthorized', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const dbError = new Error('connection reset by peer');
    mockResolveSessionUser.mockRejectedValue(dbError);

    const next = vi.fn();
    await authMiddleware(ioServer)({ data: {}, handshake: { headers: {} } }, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBe(dbError);
    expect((next.mock.calls[0][0] as Error).message).not.toBe('Unauthorized');

    ioServer.close();
    httpServer.close();
  });

  it('authenticates using a token supplied via handshake.auth.token, adding it as a Bearer header', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const user = { id: 1, schoolId: 5, role: 'STUDENT' };
    mockResolveSessionUser.mockResolvedValue(user);

    const next = vi.fn();
    const socket = { data: {}, handshake: { headers: {}, auth: { token: 'my-session-token' } } };
    await authMiddleware(ioServer)(socket, next);

    expect(mockResolveSessionUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ authorization: 'Bearer my-session-token' }),
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
    expect((socket.data as { user?: unknown }).user).toBe(user);

    ioServer.close();
    httpServer.close();
  });

  it('rejects with Unauthorized when handshake.auth.token is present but invalid', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    mockResolveSessionUser.mockResolvedValue(null);

    const next = vi.fn();
    const socket = { data: {}, handshake: { headers: {}, auth: { token: 'bad-token' } } };
    await authMiddleware(ioServer)(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');

    ioServer.close();
    httpServer.close();
  });

  it('rejects with Unauthorized when handshake.auth.token is missing and there are no headers', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    mockResolveSessionUser.mockResolvedValue(null);

    const next = vi.fn();
    const socket = { data: {}, handshake: { headers: {}, auth: {} } };
    await authMiddleware(ioServer)(socket, next);

    expect(mockResolveSessionUser).toHaveBeenCalledWith(expect.anything(), {});
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0][0] as Error).message).toBe('Unauthorized');

    ioServer.close();
    httpServer.close();
  });

  it('authenticates using handshake.headers unchanged when no auth.token is supplied', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const user = { id: 2, schoolId: 5, role: 'TEACHER' };
    mockResolveSessionUser.mockResolvedValue(user);

    const next = vi.fn();
    const headers = { cookie: 'better-auth.session_token=abc123' };
    const socket = { data: {}, handshake: { headers } };
    await authMiddleware(ioServer)(socket, next);

    expect(mockResolveSessionUser).toHaveBeenCalledWith(expect.anything(), headers);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();

    ioServer.close();
    httpServer.close();
  });

  it('prefers an existing authorization header over handshake.auth.token', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const user = { id: 3, schoolId: 5, role: 'TEACHER' };
    mockResolveSessionUser.mockResolvedValue(user);

    const next = vi.fn();
    const headers = { authorization: 'Bearer header-token' };
    const socket = {
      data: {},
      handshake: { headers, auth: { token: 'auth-token' } },
    };
    await authMiddleware(ioServer)(socket, next);

    expect(mockResolveSessionUser).toHaveBeenCalledWith(expect.anything(), headers);

    ioServer.close();
    httpServer.close();
  });
});

describe('redis connect/subscribe failure is non-fatal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('ioredis');
    vi.doUnmock('@socket.io/redis-adapter');
  });

  it('does not throw or leak an unhandled rejection when Redis rejects connect/subscribe', async () => {
    const rejection = new Error('AUTH failed');

    // A Redis client whose connection-establishment and subscribe promises all
    // reject — mirroring an exhausted-quota / bad-auth Upstash response.
    class FailingRedis {
      constructor(_url: string, _opts?: unknown) {}
      duplicate() { return this; }
      on() { return this; }
      connect() { return Promise.reject(rejection); }
      subscribe() { return Promise.reject(rejection); }
      psubscribe() { return Promise.reject(rejection); }
    }
    vi.doMock('ioredis', () => ({ default: FailingRedis }));

    // A createAdapter that issues the same un-awaited subscribe calls the real
    // adapter does, so the un-awaited rejection path is exercised.
    vi.doMock('@socket.io/redis-adapter', () => ({
      createAdapter: (_pub: unknown, sub: { subscribe: () => unknown; psubscribe: () => unknown }) => {
        sub.psubscribe();
        sub.subscribe();
        return class MockAdapter {
          constructor(_ns: unknown) {}
          init() {}
          close() {}
        };
      },
    }));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const { createServer } = await import('node:http');
      const { initSocket } = await import('../../src/lib/socket.js');

      const httpServer = createServer();

      expect(() => initSocket(httpServer)).not.toThrow();

      // Let all the rejected promises settle so any unhandled rejection would fire.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toEqual([]);

      httpServer.close();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('connection room membership', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('STUDENT joins only their user room', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const socket = fakeSocket({ id: 10, schoolId: 5, role: 'STUDENT' });
    connectionHandler(ioServer)(socket);

    expect(socket.join).toHaveBeenCalledWith('user:10');
    expect(socket.join).not.toHaveBeenCalledWith('school:5');

    ioServer.close();
    httpServer.close();
  });

  it.each(['TEACHER', 'ADMIN', 'SUPER_ADMIN'])('%s joins the school room and their user room', async (role) => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const socket = fakeSocket({ id: 20, schoolId: 5, role });
    connectionHandler(ioServer)(socket);

    expect(socket.join).toHaveBeenCalledWith('user:20');
    expect(socket.join).toHaveBeenCalledWith('school:5');

    ioServer.close();
    httpServer.close();
  });

  it('TEACHER without a school joins only their user room', async () => {
    const { createServer } = await import('node:http');
    const { initSocket } = await import('../../src/lib/socket.js');

    const httpServer = createServer();
    const { io: ioServer } = initSocket(httpServer);

    const socket = fakeSocket({ id: 30, schoolId: null, role: 'TEACHER' });
    connectionHandler(ioServer)(socket);

    expect(socket.join).toHaveBeenCalledTimes(1);
    expect(socket.join).toHaveBeenCalledWith('user:30');

    ioServer.close();
    httpServer.close();
  });
});
