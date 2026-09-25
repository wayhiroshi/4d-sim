import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import app, { type AppBindings } from "./index";
import { defaultPhase, strategyRequestSchema, type StrategyContext, type StrategyRevision, type StrategySimulationResult } from "../src/shared/strategy";
import { runStrategy } from "../src/domain/strategy";

const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: ["DB"] });
let db: D1Database;
let bindings: AppBindings;
beforeAll(async () => {
  db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    if (file === "0008_strategy_studio.sql") await db.prepare("INSERT INTO saved_forecasts (id, workspace_id, name, base_period, root_member_id, scenarios_json, results_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("legacy-check", "demo", "旧匿名試算", "2026-07", "root", "[]", "[]", "2026-07-20", "2026-07-21").run();
    const sql = await readFile(`migrations/${file}`, "utf8");
    // Keep trigger bodies together; execute each other statement individually.
    const statements = sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? [];
    for (const statement of statements) await db.prepare(statement).run();
  }
  bindings = { DB: db, APP_ENV: "test", ACCESS_REQUIRED: "false" };
}, 20000);
afterAll(async () => { await mf.dispose(); });
const request = (path: string, body?: unknown) => app.request(`https://test.local/api/v2/strategy${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, bindings);

describe("Strategy API and real local D1", () => {
  it("inherits Access protection and avoids persisting responses in browser caches", async () => {
    const blocked = await app.request("https://test.local/api/v2/strategy/context", {}, { ...bindings, ACCESS_REQUIRED: "true" });
    expect(blocked.status).toBe(401);
    const context = await request("/context");
    expect(context.status).toBe(200); expect(context.headers.get("cache-control")).toBe("no-store");
  });
  it("validates inputs before touching D1", async () => {
    const response = await request("/simulate", { request: { targetIds: 300 }, base: {} });
    expect(response.status).toBe(400);
  });
  it("preserves the complete legacy record even after the old saved row is removed", async () => {
    await db.prepare("DELETE FROM saved_forecasts WHERE id = ? AND workspace_id = ?").bind("legacy-check", "demo").run();
    const context = await (await request("/context")).json() as StrategyContext;
    expect(context.legacy.find((l) => l.id === "legacy-check")).toMatchObject({ rootMemberId: "root", basePeriod: "2026-07", createdAt: "2026-07-20", updatedAt: "2026-07-21", scenarios: [], results: [] });
  });
  it("saves immutable revisions, restores exactly, isolates workspaces, and applies idempotently", async () => {
    const context = await (await request("/context")).json() as StrategyContext;
    const phase = defaultPhase(); for (const b of ["conservative", "standard", "challenge"] as const) phase.rates[b].introductions = 0;
    const input = strategyRequestSchema.parse({ name: "匿名のテスト", rootId: "root", partnerId: "partner", targetId: "root", horizonMonths: 12,
      leaders: [{ id: "self", name: "本人", existingMemberId: "root", introducerId: "root", placementId: "root", startMonth: 1, initialTeam: 0, potentialDownlineIds: 300, licenseAfterMonths: null, phases: [phase] }],
      ownedMonthlyCosts: {}, courseMonthlyCosts: { A: 9950, B: 19900, F: 13170, G: 26340, I: 0 }, taxes: { root: context.tax, partner: context.tax } });
    const result: StrategySimulationResult = await runStrategy(context.snapshot, input);
    const first = await request("/plans", { planId: null, request: input, base: context.snapshot, result });
    expect(first.status).toBe(201);
    const saved = await first.json() as { id: string; planId: string };
    const second = await request("/plans", { planId: saved.planId, request: input, base: context.snapshot, result });
    expect(second.status).toBe(201);
    const restored = await (await request(`/revisions/${saved.id}`)).json() as StrategyRevision;
    expect(restored.result).toEqual(result); expect(restored.base).toEqual(context.snapshot);
    expect(restored.request).toEqual(input);
    expect(restored.ruleSnapshot.version).toBe(result.planVersion);
    const versions = await (await request(`/plans/${saved.planId}/revisions`)).json() as unknown[];
    expect(versions).toHaveLength(2);
    await expect(db.prepare("UPDATE strategy_revisions SET name = 'changed' WHERE id = ?").bind(saved.id).run()).rejects.toThrow("immutable");
    const countBefore = await db.prepare("SELECT COUNT(*) AS n FROM members").first<number>("n");
    for (let i = 0; i < 2; i++) expect((await request(`/plans/${saved.planId}/apply`, { revisionId: saved.id, objective: "fastest", band: "standard" })).status).toBe(200);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM strategy_overlays").first<number>("n")).toBe(1);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM members").first<number>("n")).toBe(countBefore);
    expect((await request("/overlay")).status).toBe(200);
    const forbidden = await request("/plans", { planId: saved.planId, request: input, base: { ...context.snapshot, workspaceId: "other" }, result });
    expect(forbidden.status).toBe(403);
    const malformed = structuredClone(result); malformed.variants[0]!.bands.standard.months[0]!.month = 99;
    expect((await request("/plans", { planId: saved.planId, request: input, base: context.snapshot, result: malformed })).status).toBe(400);
    const inconsistent = structuredClone(result); inconsistent.variants[0]!.bands.standard.months[0]!.gross += 100;
    expect((await request("/plans", { planId: saved.planId, request: input, base: context.snapshot, result: inconsistent })).status).toBe(400);
  }, 20000);
});
