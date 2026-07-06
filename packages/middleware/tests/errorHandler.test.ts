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
    const logger = { error: vi.fn() };
    const boom = new Error("boom");
    const app = express();
    app.get("/boom", () => {
      throw boom;
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
});
