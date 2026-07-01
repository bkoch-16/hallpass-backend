import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the io server variable by testing emitPassEvent behavior directly
// Full auth-based integration tests would require a live better-auth server.

// We need to mock dependencies before importing the module under test
vi.mock('ioredis', () => ({
  default: class MockRedis {
    constructor(_url: string, _opts?: unknown) {}
    duplicate() { return this; }
    on() { return this; }
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

vi.mock('../../src/env.js', () => ({
  env: {
    CORS_ORIGIN: 'http://localhost:3000',
    BETTER_AUTH_URL: 'http://localhost:3001',
    BETTER_AUTH_SECRET: 'test-secret',
    DATABASE_URL: 'mysql://test',
    REDIS_URL: 'redis://localhost:6379',
  },
}));

describe('emitPassEvent', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not throw when called before initSocket (io is undefined)', async () => {
    // Import fresh module — io is undefined at module load time
    const { emitPassEvent } = await import('../../src/lib/socket.js');

    const pass = { schoolId: 1, studentId: 10, id: 100, status: 'PENDING' };

    expect(() => emitPassEvent(pass, 'pass:created')).not.toThrow();
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

  it('emitPassEvent emits to school room only after init', async () => {
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
    expect(toSpy).not.toHaveBeenCalledWith('user:42');
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenCalledWith('pass:approved', pass);

    ioServer.close();
    httpServer.close();
  });
});

