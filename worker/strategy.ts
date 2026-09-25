import { Hono } from "hono";
import { z } from "zod";
import { bodyLimit } from "hono/body-limit";
import type { AppBindings } from "./index";
import { applySimulationMembers, periodForDate } from "../src/domain/engine";
import { inputFingerprint, runStrategy, validateStrategyBase } from "../src/domain/strategy";
import { planConfig } from "../src/domain/plan";
import { BANDS, strategyRequestSchema, type StrategyRevision, type StrategyContext } from "../src/shared/strategy";
import { strategyResultSchema } from "../src/shared/strategy-result-schema";
import { COURSES, TITLE_ORDER } from "../src/shared/types";
import { getTaxProfile, listSavedForecasts, listSimulationMembers, loadSnapshot } from "./repository";
import { archivedForecasts, listStrategyPlans, readStrategyRevision, saveStrategyRevision } from "./strategy-repository";

const routes = new Hono<{ Bindings: AppBindings; Variables: { workspaceId: string; requestId: string } }>();
routes.use("*", bodyLimit({ maxSize: 12_000_000, onError: (c) => c.json({ error: "保存データは12MB以内にしてください" }, 413) }));
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const id = z.string().min(1).max(120);
const nullableId = id.nullable();
const snapshotSchema = z.object({ workspaceId: id, period, members: z.array(z.object({
  id, workspaceId: id, displayName: z.string().max(80), parentMemberId: nullableId, introducerMemberId: nullableId,
  masterMemberId: nullableId, trainerMemberId: nullableId, trainerBonusRole: z.enum(["PT", "ST_SOLO", "ST_WITH_PT"]).nullable().optional(),
  idKind: z.enum(["master", "sub"]), course: z.enum(COURSES), title: z.enum(TITLE_ORDER), trainerCredential: z.enum(["NONE", "PT", "ST"]),
  sponsorLicense: z.boolean(), openStudioAttendances: z.number().int().nonnegative(), preTrainerCourseCompleted: z.boolean(), preTrainerKitPurchased: z.boolean(), startTrainerCourseCompleted: z.boolean(), startTrainerKitPurchased: z.boolean(),
  directorPromotedPeriod: period.nullable(), joinedPeriod: period, endedPeriod: period.nullable()
})).min(1).max(5000), purchases: z.array(z.object({ id, workspaceId: id, memberId: id, period, productCode: z.string().nullable(),
  kind: z.enum(["initial", "repeat", "additional"]), status: z.enum(["planned", "confirmed"]), quantity: z.number().int().positive(), price: z.number().nonnegative(), pv: z.number().nonnegative()
})).max(100000) });


routes.get("/context", async (c) => {
  const workspaceId = c.get("workspaceId");
  const last = await c.env.DB.prepare("SELECT MAX(period) AS period FROM purchases WHERE workspace_id = ? AND status = 'confirmed'").bind(workspaceId).first<{ period: string | null }>();
  const selected = c.req.query("period") ? period.parse(c.req.query("period")) : last?.period ?? periodForDate(new Date());
  const [base, trials, tax, legacy, archived] = await Promise.all([loadSnapshot(c.env.DB, workspaceId, selected), listSimulationMembers(c.env.DB, workspaceId, selected), getTaxProfile(c.env.DB, workspaceId), listSavedForecasts(c.env.DB, workspaceId), archivedForecasts(c.env.DB, workspaceId)]);
  const preserved = new Map([...archived, ...legacy].map((item) => [item.id, item]));
  const result: StrategyContext = { snapshot: applySimulationMembers(base, trials), trialIds: trials.map((m) => m.id), tax, legacy: [...preserved.values()], planVersion: planConfig.version };
  return c.json(result);
});
routes.post("/simulate", async (c) => {
  const input = z.object({ request: strategyRequestSchema, base: snapshotSchema }).parse(await c.req.json());
  if (input.base.workspaceId !== c.get("workspaceId") || input.base.members.some((m) => m.workspaceId !== c.get("workspaceId")) || input.base.purchases.some((p) => p.workspaceId !== c.get("workspaceId"))) return c.json({ error: "ワークスペースが一致しません" }, 403);
  validateStrategyBase(input.base, input.request);
  return c.json(await runStrategy(input.base, input.request));
});
routes.get("/plans", async (c) => c.json(await listStrategyPlans(c.env.DB, c.get("workspaceId"))));
routes.get("/plans/:id/revisions", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, created_at FROM strategy_revisions WHERE workspace_id = ? AND plan_id = ? ORDER BY created_at DESC, id DESC").bind(c.get("workspaceId"), c.req.param("id")).all();
  return c.json(results);
});
routes.get("/revisions/:id", async (c) => {
  const revision = await readStrategyRevision(c.env.DB, c.get("workspaceId"), c.req.param("id"));
  return revision ? c.json(revision) : c.json({ error: "保存した試算が見つかりません" }, 404);
});
routes.post("/plans", async (c) => {
  const input = z.object({ planId: id.nullable(), request: strategyRequestSchema, base: snapshotSchema, result: strategyResultSchema }).parse(await c.req.json());
  const workspaceId = c.get("workspaceId");
  if (input.base.workspaceId !== workspaceId || input.base.members.some((m) => m.workspaceId !== workspaceId) || input.base.purchases.some((p) => p.workspaceId !== workspaceId)) return c.json({ error: "ワークスペースが一致しません" }, 403);
  validateStrategyBase(input.base, input.request);
  if (input.result.planVersion !== planConfig.version || input.result.fingerprint !== inputFingerprint(input.base, input.request)) return c.json({ error: "入力が変更されています。再計算してから保存してください" }, 409);
  if (input.planId && !await c.env.DB.prepare("SELECT id FROM strategy_plans WHERE workspace_id = ? AND id = ?").bind(workspaceId, input.planId).first()) return c.json({ error: "計画が見つかりません" }, 404);
  const revision: StrategyRevision = { id: crypto.randomUUID(), planId: input.planId ?? crypto.randomUUID(), name: input.request.name || "試算", createdAt: new Date().toISOString(), request: input.request,
    base: input.base, result: input.result, ruleSnapshot: planConfig };
  await saveStrategyRevision(c.env.DB, workspaceId, revision, input.planId !== null);
  return c.json({ id: revision.id, planId: revision.planId }, 201);
});
routes.post("/plans/:id/apply", async (c) => {
  const input = z.object({ revisionId: id, objective: z.enum(["fastest", "income", "balanced"]), band: z.enum(BANDS) }).parse(await c.req.json());
  const revision = await readStrategyRevision(c.env.DB, c.get("workspaceId"), input.revisionId);
  if (!revision || revision.planId !== c.req.param("id")) return c.json({ error: "計画の版が見つかりません" }, 404);
  const selected = revision.result.variants.find((v) => v.objective === input.objective)?.bands[input.band];
  if (!selected) return c.json({ error: "戦略が見つかりません" }, 400);
  await c.env.DB.prepare("INSERT INTO strategy_overlays (workspace_id, revision_id, objective, band) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET revision_id = excluded.revision_id, objective = excluded.objective, band = excluded.band, applied_at = CURRENT_TIMESTAMP")
    .bind(c.get("workspaceId"), input.revisionId, input.objective, input.band).run();
  return c.json({ ok: true, futureMonths: selected.months.length - 1 });
});
routes.get("/overlay", async (c) => {
  const overlay = await c.env.DB.prepare("SELECT revision_id, objective, band FROM strategy_overlays WHERE workspace_id = ?").bind(c.get("workspaceId")).first<{ revision_id: string; objective: string; band: typeof BANDS[number] }>();
  if (!overlay) return c.json(null);
  const revision = await readStrategyRevision(c.env.DB, c.get("workspaceId"), overlay.revision_id);
  return c.json(revision ? { name: revision.name, revisionId: revision.id, request: revision.request, variant: revision.result.variants.find((v) => v.objective === overlay.objective)?.bands[overlay.band] } : null);
});
routes.delete("/overlay", async (c) => { await c.env.DB.prepare("DELETE FROM strategy_overlays WHERE workspace_id = ?").bind(c.get("workspaceId")).run(); return c.json({ ok: true }); });
routes.post("/archive", async (c) => {
  const input = z.object({ planId: id, archived: z.boolean() }).parse(await c.req.json());
  await c.env.DB.prepare("UPDATE strategy_plans SET archived = ? WHERE workspace_id = ? AND id = ?").bind(input.archived ? 1 : 0, c.get("workspaceId"), input.planId).run();
  return c.json({ ok: true });
});
export default routes;
