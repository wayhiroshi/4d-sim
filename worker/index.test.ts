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

  it("does not expose relationship-management endpoints", async () => {
    const prospects = await app.request("https://example.test/api/v1/prospects", {}, bindings);
    const activities = await app.request("https://example.test/api/v1/activities", {}, bindings);
    const prospectTemplate = await app.request("https://example.test/api/v1/imports/template/prospects", {}, bindings);
    expect(prospects.status).toBe(404);
    expect(activities.status).toBe(404);
    expect(prospectTemplate.status).toBe(404);
  });

  it("requires a selected partner for pair-income simulations before database access", async () => {
    const response = await app.request("https://example.test/api/v1/simulations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateName: "候補", course: "A", idKind: "master", period: "2026-07", targetTitle: "LD",
        incomeMode: "pair", partnerMemberId: null,
        taxProfile: { invoiceRegistered: true, withholdingRate: 0, transferFee: 0, offsets: 0, priorCarryover: 0 }
      })
    }, bindings);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "入力内容を確認してください" });
  });

  it("rejects batch simulations over 20 people before database access", async () => {
    const response = await app.request("https://example.test/api/v1/simulations/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateName: "候補", candidateCount: 21, course: "A", idKind: "master", period: "2026-07", targetTitle: "LD",
        incomeMode: "self", partnerMemberId: null,
        taxProfile: { invoiceRegistered: true, withholdingRate: 0, transferFee: 0, offsets: 0, priorCarryover: 0 }
      })
    }, bindings);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "入力内容を確認してください" });
  });
});
