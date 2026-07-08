import { createServer, type RequestListener, type Server } from "node:http";

export interface TestServerHandle {
  server: Server;
  /** Register with beforeAll. */
  start: () => Promise<void>;
  /** Register with afterAll. */
  stop: () => Promise<void>;
}

/**
 * One shared server bound explicitly to 127.0.0.1 — supertest's default
 * request(app) spawns a wildcard-bound server per request, whose port a
 * foreign local process can shadow with a specific 127.0.0.1 bind (flaky
 * hangs/ECONNRESET/wrong statuses; tech-debt item 12). Register start with
 * beforeAll and stop with afterAll, and pass the returned server to
 * request(server) at call sites.
 */
export function createTestServer(app: RequestListener): TestServerHandle {
  const server = createServer(app);
  return {
    server,
    start: () =>
      new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
