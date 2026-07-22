import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";
import { notFound, createErrorHandler } from "../src/errorHandler";

describe("notFound", () => {
  it("returns 404 with not found message", async () => {
    const app = express();
    app.use(notFound);

    const res = await request(app).get("/api/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Not found" });
  });
});

describe("createErrorHandler", () => {
  function buildApp() {
    const logger = { error: vi.fn(), warn: vi.fn() };
    const boom = new Error("boom");
    const app = express();
    app.use(express.json());
    app.get("/boom", () => {
      throw boom;
    });
    app.post("/echo", (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.get("/almost-client-error", () => {
      const err = new Error("looks like a 400") as Error & {
        statusCode: number;
      };
      err.statusCode = 400;
      throw err;
    });
    app.use(
      createErrorHandler(
        logger as unknown as Parameters<typeof createErrorHandler>[0],
      ),
    );
    return { app, logger, boom };
  }

  it("returns 500 with internal server error body", async () => {
    const { app } = buildApp();

    const res = await request(app).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
  });

  it("logs the error via logger.error(err, message)", async () => {
    const { app, logger, boom } = buildApp();

    await request(app).get("/boom");

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(boom, "Unhandled route error");
  });

  it("returns 400 with the parse message for malformed JSON bodies", async () => {
    const { app, logger } = buildApp();

    const res = await request(app)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send('[{"a":1},]');

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/JSON/);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns 500 for errors with a 4xx statusCode but no expose flag", async () => {
    const { app, logger } = buildApp();

    const res = await request(app).get("/almost-client-error");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal server error" });
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("delegates to next(err) when headers are already sent", async () => {
    const logger = { error: vi.fn() };
    const app = express();
    app.get("/late", (_req, res, next) => {
      res.status(200);
      res.end("partial");
      next(new Error("late boom"));
    });
    app.use(
      createErrorHandler(
        logger as unknown as Parameters<typeof createErrorHandler>[0],
      ),
    );

    const res = await request(app).get("/late");

    // Express's finalhandler ends the started response; our handler must not
    // attempt res.status(500).json() on it (which would throw ERR_HTTP_HEADERS_SENT).
    expect(res.status).toBe(200);
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
