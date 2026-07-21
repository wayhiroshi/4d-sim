import { describe, expect, it } from "vitest";
import app, { type AppBindings } from "./index";

const bindings: AppBindings = {
  DB: {} as D1Database,
  ACCESS_REQUIRED: "false",
  APP_ENV: "test"
};

describe("Worker API", () => {
  it("returns health information", async () => {
    const response = await app.request("https://example.test/api/v1/health", {}, bindings);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, app: "fordays-navigator" });
  });

  it("rejects Access-protected requests without an assertion", async () => {
    const response = await app.request("https://example.test/api/v1/health", {}, { ...bindings, ACCESS_REQUIRED: "true" });
    expect(response.status).toBe(401);
  });
});
