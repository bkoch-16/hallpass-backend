import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createRequireApiKey } from "../src/apiKey.js";

const EXPECTED_KEY = "correct-key";

function buildApp(headerName?: string) {
  const app = express();
  app.get(
    "/protected",
    headerName
      ? createRequireApiKey(EXPECTED_KEY, headerName)
      : createRequireApiKey(EXPECTED_KEY),
    (_req, res) => {
      res.status(200).json({ ok: true });
    },
  );
  return app;
}

describe("createRequireApiKey", () => {
  it("returns 401 when the header is missing", async () => {
    const app = buildApp();

    const res = await request(app).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("returns 401 when the key is wrong", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/protected")
      .set("x-api-key", "wrong-key");

    expect(res.status).toBe(401);
  });

  it("returns 401 when the header value is an array (repeated header)", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/protected")
      .set("x-api-key", [EXPECTED_KEY, EXPECTED_KEY]);

    expect(res.status).toBe(401);
  });

  it("returns 200 when the key is correct", async () => {
    const app = buildApp();

    const res = await request(app)
      .get("/protected")
      .set("x-api-key", EXPECTED_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("honors a custom header name", async () => {
    const app = buildApp("x-parent-tool-key");

    const wrongHeader = await request(app)
      .get("/protected")
      .set("x-api-key", EXPECTED_KEY);
    expect(wrongHeader.status).toBe(401);

    const rightHeader = await request(app)
      .get("/protected")
      .set("x-parent-tool-key", EXPECTED_KEY);
    expect(rightHeader.status).toBe(200);
  });
});
