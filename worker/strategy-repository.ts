import type { StrategyPlanSummary, StrategyRevision } from "../src/shared/strategy";
import type { SavedForecast } from "../src/shared/types";

export async function archivedForecasts(db: D1Database, workspaceId: string): Promise<SavedForecast[]> {
  const { results } = await db.prepare("SELECT * FROM strategy_legacy_archive WHERE workspace_id = ? ORDER BY created_at DESC").bind(workspaceId)
    .all<{ legacy_id: string; name: string; base_period: string; root_member_id: string; scenarios_json: string; results_json: string; created_at: string; updated_at: string }>();
  return results.map((r) => ({ id: r.legacy_id, workspaceId, name: r.name, basePeriod: r.base_period, rootMemberId: r.root_member_id,
    scenarios: JSON.parse(r.scenarios_json), results: JSON.parse(r.results_json), createdAt: r.created_at, updatedAt: r.updated_at }));
}

export async function listStrategyPlans(db: D1Database, workspaceId: string): Promise<StrategyPlanSummary[]> {
  const { results } = await db.prepare("SELECT id, name, updated_at, revision_id, archived FROM strategy_plans WHERE workspace_id = ? ORDER BY updated_at DESC, id LIMIT 100").bind(workspaceId)
    .all<{ id: string; name: string; updated_at: string; revision_id: string; archived: number }>();
  return results.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updated_at, revisionId: p.revision_id, archived: p.archived === 1 }));
}

export async function readStrategyRevision(db: D1Database, workspaceId: string, revisionId: string): Promise<StrategyRevision | null> {
  const meta = await db.prepare("SELECT id FROM strategy_revisions WHERE workspace_id = ? AND id = ?").bind(workspaceId, revisionId).first();
  if (!meta) return null;
  const { results } = await db.prepare("SELECT payload FROM strategy_revision_chunks WHERE workspace_id = ? AND revision_id = ? ORDER BY ordinal").bind(workspaceId, revisionId).all<{ payload: string }>();
  return JSON.parse(results.map((r) => r.payload).join("")) as StrategyRevision;
}

export async function saveStrategyRevision(db: D1Database, workspaceId: string, revision: StrategyRevision, existing: boolean): Promise<void> {
  const json = JSON.stringify(revision);
  if (new TextEncoder().encode(json).byteLength > 12_000_000) throw new Error("保存サイズの上限を超えました。計算期間を分けてください");
  const statements: D1PreparedStatement[] = [];
  if (!existing) statements.push(db.prepare("INSERT INTO strategy_plans (id, workspace_id, name, revision_id) VALUES (?, ?, ?, ?)").bind(revision.planId, workspaceId, revision.name, revision.id));
  statements.push(db.prepare("INSERT INTO strategy_revisions (id, workspace_id, plan_id, name, engine_version, plan_version, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(revision.id, workspaceId, revision.planId, revision.name, revision.result.engineVersion, revision.result.planVersion, revision.result.fingerprint, revision.createdAt));
  let ordinal = 0;
  for (let start = 0; start < json.length;) {
    let end = Math.min(start + 100000, json.length);
    if (end < json.length && json.charCodeAt(end - 1) >= 0xd800 && json.charCodeAt(end - 1) <= 0xdbff) end--;
    statements.push(db.prepare("INSERT INTO strategy_revision_chunks (workspace_id, revision_id, ordinal, payload) VALUES (?, ?, ?, ?)").bind(workspaceId, revision.id, ordinal++, json.slice(start, end)));
    start = end;
  }
  statements.push(db.prepare("UPDATE strategy_plans SET name = ?, revision_id = ?, updated_at = ?, archived = 0 WHERE workspace_id = ? AND id = ?")
    .bind(revision.name, revision.id, revision.createdAt, workspaceId, revision.planId));
  await db.batch(statements);
}
