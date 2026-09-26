import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import app, { type AppBindings } from "./index";
import { evaluateTitle, computeBonus } from "../src/domain/engine";
import { getTaxProfile, loadSnapshot } from "./repository";

const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: ["DB"] });
let db: D1Database, bindings: AppBindings;
beforeAll(async () => {
  db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations")).filter(f => f.endsWith(".sql")).sort()) {
    const sql = await readFile(`migrations/${file}`, "utf8");
    for (const statement of sql.match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g) ?? []) await db.prepare(statement).run();
  }
  bindings = { DB: db, APP_ENV: "test", ACCESS_REQUIRED: "false" };
}, 20000);
afterAll(async () => { await mf.dispose(); });
const post = (path: string, body: unknown) => app.request(`https://test.local/api/v1/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, bindings);
const member = (id: string, parent = "root") => ({ id, displayName: id, parentMemberId: parent, introducerMemberId: "root", idKind: "master", course: "A", joinedPeriod: "2026-07" });

describe("manual members and monthly purchases", () => {
  it("saves explicit PV with the member, leaves unknown PV absent, and backfills purchases into title and bonus calculations", async () => {
    const before = await loadSnapshot(db, "demo", "2026-07");
    const tax = await getTaxProfile(db, "demo");
    for (const id of ["first-b", "first-c"]) {
      expect((await post("members", { ...member(id), purchase: { kind: "repeat", pv: 5330, price: 9950 } })).status).toBe(201);
    }
    expect((await post("members", member("second", "partner"))).status).toBe(201);
    let snapshot = await loadSnapshot(db, "demo", "2026-07");
    expect(snapshot.purchases.filter(p => p.memberId === "first-b")).toMatchObject([{ period: "2026-07", pv: 5330, quantity: 1, status: "confirmed", kind: "repeat" }]);
    expect(snapshot.purchases.filter(p => p.memberId === "second")).toEqual([]);
    expect(evaluateTitle(snapshot, "root").achievedTitle).toBe("NONE");
    expect((await post("purchases", { memberId: "second", period: "2026-07", kind: "repeat", status: "confirmed", quantity: 1, price: 9950, pv: 5330 })).status).toBe(201);
    snapshot = await loadSnapshot(db, "demo", "2026-07");
    expect(evaluateTitle(snapshot, "root").achievedTitle).toBe("LD");
    expect(computeBonus(snapshot, "root", tax).line).toBeGreaterThan(computeBonus(before, "root", tax).line);
    expect(snapshot.members.find(m => m.id === "root")!.title).toBe("NONE");
  });
  it("persists explicit zero and preserves each purchase kind without inventing a repeat", async () => {
    for (const kind of ["initial", "repeat", "additional"] as const) {
      const id = `kind-${kind}`;
      expect((await post("members", { ...member(id, "first-b"), purchase: { kind, pv: 0, price: 0 } })).status).toBe(201);
      const snapshot = await loadSnapshot(db, "demo", "2026-07");
      expect(snapshot.purchases.filter(p => p.memberId === id)).toMatchObject([{ kind, pv: 0 }]);
    }
  });
  it("rejects invalid PV before saving either record", async () => {
    for (const pv of [-1, 1.5, "5330", null]) {
      expect((await post("members", { ...member("invalid"), purchase: { kind: "repeat", pv, price: 0 } })).status).toBe(400);
    }
    expect(await db.prepare("SELECT COUNT(*) AS n FROM members WHERE id = ?").bind("invalid").first<number>("n")).toBe(0);
  });
  it("rolls back the member if the purchase insert fails", async () => {
    await db.prepare("CREATE TRIGGER reject_test_purchase BEFORE INSERT ON purchases WHEN NEW.member_id = 'rollback' BEGIN SELECT RAISE(ABORT, 'test purchase failure'); END;").run();
    try {
      expect((await post("members", { ...member("rollback"), purchase: { kind: "repeat", pv: 5330, price: 9950 } })).status).toBe(500);
      expect(await db.prepare("SELECT COUNT(*) AS n FROM members WHERE id = ?").bind("rollback").first<number>("n")).toBe(0);
    } finally { await db.prepare("DROP TRIGGER reject_test_purchase").run(); }
  });
});
