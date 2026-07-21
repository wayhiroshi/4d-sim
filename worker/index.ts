import { Hono } from "hono";
import { z } from "zod";
import { previewCsv, validateMemberRelationships, CSV_TEMPLATES, type CsvKind } from "../src/domain/csv";
import {
  computeBonus,
  applySimulationMembers,
  evaluateTitle,
  evaluateTitleChecklists,
  generateMissions,
  groupPv,
  periodForDate,
  runForecast,
  simulatePlacements
} from "../src/domain/engine";
import { planConfig } from "../src/domain/plan";
import {
  COURSES,
  TITLE_ORDER,
  type DashboardData,
  type Goal,
  type Member,
  type PurchaseEvent,
  type SimulationMember,
  type SimulationOrganization,
  type TitleChecklistData,
} from "../src/shared/types";
import {
  getGoal,
  getTaxProfile,
  listSimulationMembers,
  loadSnapshot,
  memberInsert,
  purchaseInsert,
  simulationMemberInsert,
  upsertGoal,
  upsertTaxProfile
} from "./repository";

type Variables = { requestId: string; workspaceId: string };
export type AppBindings = Omit<Env, "APP_ENV" | "ACCESS_REQUIRED"> & {
  APP_ENV: string;
  ACCESS_REQUIRED: string;
};
const app = new Hono<{ Bindings: AppBindings; Variables: Variables }>();
const WORKSPACE_ID = "demo";

const courseSchema = z.enum(COURSES);
const titleSchema = z.enum(TITLE_ORDER);
const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const nullableId = z.string().min(1).nullable().optional();
const taxProfileSchema = z.object({
  invoiceRegistered: z.boolean(),
  withholdingRate: z.number().min(0).max(1),
  transferFee: z.number().int().nonnegative(),
  offsets: z.number().int().nonnegative(),
  priorCarryover: z.number().int().nonnegative()
});

const memberSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  displayName: z.string().min(1).max(80),
  parentMemberId: nullableId,
  introducerMemberId: nullableId,
  masterMemberId: nullableId,
  trainerMemberId: nullableId,
  idKind: z.enum(["master", "sub"]),
  course: courseSchema,
  title: titleSchema.default("NONE"),
  trainerCredential: z.enum(["NONE", "PT", "ST"]).default("NONE"),
  sponsorLicense: z.boolean().default(false),
  directorPromotedPeriod: periodSchema.nullable().default(null),
  joinedPeriod: periodSchema,
  endedPeriod: periodSchema.nullable().default(null)
});

const purchaseSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  memberId: z.string().min(1),
  period: periodSchema,
  productCode: z.string().nullable().optional(),
  kind: z.enum(["initial", "repeat", "additional"]),
  status: z.enum(["planned", "confirmed"]),
  quantity: z.number().int().positive(),
  price: z.number().int().nonnegative(),
  pv: z.number().int().nonnegative()
});

const simulationSchema = z.object({
  candidateName: z.string().min(1).max(80),
  course: courseSchema,
  period: periodSchema,
  targetTitle: titleSchema,
  placementCandidateIds: z.array(z.string()).optional(),
  taxProfile: taxProfileSchema
});

const simulationMemberSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  parentMemberId: z.string().min(1).max(80),
  period: periodSchema,
  course: courseSchema
});

const forecastSchema = z.object({
  period: periodSchema,
  rootMemberId: z.string().min(1),
  scenarios: z.array(z.object({
    id: z.enum(["conservative", "standard", "challenge"]),
    label: z.string().min(1),
    months: z.array(z.object({
      period: periodSchema,
      registrations: z.array(z.object({
        course: courseSchema,
        placementMemberId: z.string().min(1),
        count: z.number().int().min(0).max(50)
      })),
      continuationRate: z.number().min(0).max(1),
      additionalPv: z.number().int().nonnegative()
    })).min(1).max(12),
    taxProfile: taxProfileSchema
  })).length(3)
});

async function boundedJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 1_000_000) throw new Error("リクエストは1MB以下にしてください");
  const value: unknown = await request.json();
  return schema.parse(value);
}

async function selectedPeriod(db: D1Database, requested: string | undefined): Promise<string> {
  if (requested && periodSchema.safeParse(requested).success) return requested;
  const row = await db.prepare("SELECT MAX(period) AS period FROM purchases WHERE workspace_id = ?").bind(WORKSPACE_ID).first<{ period: string | null }>();
  return row?.period ?? periodForDate(new Date());
}

app.use("/api/*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  context.set("workspaceId", WORKSPACE_ID);
  if (context.env.ACCESS_REQUIRED === "true" && !context.req.header("Cf-Access-Jwt-Assertion")) {
    return context.json({ error: "Cloudflare Access authentication required", requestId }, 401);
  }
  await next();
  context.header("Cache-Control", "no-store");
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "no-referrer");
  context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  context.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
});

app.onError((error, context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();
  const isValidation = error instanceof z.ZodError;
  console.error(JSON.stringify({
    message: "request_failed",
    requestId,
    method: context.req.method,
    path: context.req.path,
    error: isValidation ? "validation_error" : error.message
  }));
  if (isValidation) return context.json({ error: "入力内容を確認してください", issues: error.issues, requestId }, 400);
  return context.json({ error: "処理に失敗しました", requestId }, 500);
});

app.get("/api/v1/health", (context) => context.json({ ok: true, app: "fordays-navigator", planVersion: planConfig.version }));

app.get("/api/v1/dashboard", async (context) => {
  const workspaceId = context.get("workspaceId");
  const period = await selectedPeriod(context.env.DB, context.req.query("period"));
  const [snapshot, taxProfile] = await Promise.all([
    loadSnapshot(context.env.DB, workspaceId, period),
    getTaxProfile(context.env.DB, workspaceId)
  ]);
  const rootMember = snapshot.members.find((member) => member.parentMemberId === null);
  if (!rootMember) return context.json({ error: "ルート会員が登録されていません" }, 409);
  const title = evaluateTitle(snapshot, rootMember.id);
  const bonus = computeBonus(snapshot, rootMember.id, taxProfile);
  const data: DashboardData = {
    period,
    rootMember,
    groupPv: groupPv(snapshot, rootMember.id),
    groupMembers: snapshot.members.length - 1,
    title,
    bonus,
    missions: generateMissions(title)
  };
  return context.json(data);
});

app.get("/api/v1/titles/checklist", async (context) => {
  const period = await selectedPeriod(context.env.DB, context.req.query("period"));
  const snapshot = await loadSnapshot(context.env.DB, context.get("workspaceId"), period);
  const rootMember = snapshot.members.find((member) => member.parentMemberId === null);
  if (!rootMember) return context.json({ error: "ルート会員が登録されていません" }, 409);
  const achievedTitle = evaluateTitle(snapshot, rootMember.id).achievedTitle;
  const data: TitleChecklistData = {
    period,
    achievedTitle,
    planVersion: planConfig.version,
    titles: evaluateTitleChecklists(snapshot, rootMember.id),
    sources: planConfig.sources
  };
  return context.json(data);
});

app.get("/api/v1/members/tree", async (context) => {
  const period = await selectedPeriod(context.env.DB, context.req.query("period"));
  const snapshot = await loadSnapshot(context.env.DB, context.get("workspaceId"), period);
  return context.json(snapshot);
});

app.get("/api/v1/simulation-organization", async (context) => {
  const workspaceId = context.get("workspaceId");
  const period = await selectedPeriod(context.env.DB, context.req.query("period"));
  const [snapshot, simulationMembers] = await Promise.all([
    loadSnapshot(context.env.DB, workspaceId, period),
    listSimulationMembers(context.env.DB, workspaceId, period)
  ]);
  const data: SimulationOrganization = {
    snapshot: applySimulationMembers(snapshot, simulationMembers),
    simulationMembers
  };
  return context.json(data);
});

app.post("/api/v1/simulation-members", async (context) => {
  const input = await boundedJson(context.req.raw, simulationMemberSchema);
  const workspaceId = context.get("workspaceId");
  const [actual, current] = await Promise.all([
    loadSnapshot(context.env.DB, workspaceId, input.period),
    listSimulationMembers(context.env.DB, workspaceId, input.period)
  ]);
  const snapshot = applySimulationMembers(actual, current);
  const root = snapshot.members.find((member) => member.parentMemberId === null);
  if (!root) return context.json({ error: "ルート会員が登録されていません" }, 409);
  const parent = snapshot.members.find((member) => member.id === input.parentMemberId && member.endedPeriod === null);
  if (!parent) return context.json({ error: "配置先が存在しません" }, 400);
  if (snapshot.members.filter((member) => member.parentMemberId === parent.id && member.endedPeriod === null).length >= planConfig.firstLineLimit) {
    return context.json({ error: "配置先の1次ラインが上限7名です" }, 400);
  }
  const simulationMember: SimulationMember = {
    id: `trial-${crypto.randomUUID()}`,
    workspaceId,
    displayName: input.displayName,
    parentMemberId: parent.id,
    introducerMemberId: root.id,
    course: input.course,
    period: input.period,
    createdAt: new Date().toISOString()
  };
  await simulationMemberInsert(context.env.DB, simulationMember).run();
  return context.json(simulationMember, 201);
});

app.delete("/api/v1/simulation-members", async (context) => {
  const period = periodSchema.parse(context.req.query("period"));
  const result = await context.env.DB.prepare(
    "DELETE FROM simulation_members WHERE workspace_id = ? AND period = ?"
  ).bind(context.get("workspaceId"), period).run();
  return context.json({ deleted: result.meta.changes });
});

app.post("/api/v1/members", async (context) => {
  const input = await boundedJson(context.req.raw, memberSchema);
  const snapshot = await loadSnapshot(context.env.DB, context.get("workspaceId"), input.joinedPeriod);
  if (input.parentMemberId && !snapshot.members.some((member) => member.id === input.parentMemberId)) {
    return context.json({ error: "配置親が存在しません" }, 400);
  }
  if (input.parentMemberId && snapshot.members.filter((member) => member.parentMemberId === input.parentMemberId && member.endedPeriod === null).length >= planConfig.firstLineLimit) {
    return context.json({ error: "配置親の1次ラインが上限7名です" }, 400);
  }
  const member: Member = {
    id: input.id ?? crypto.randomUUID(), workspaceId: context.get("workspaceId"), displayName: input.displayName,
    parentMemberId: input.parentMemberId ?? null, introducerMemberId: input.introducerMemberId ?? null,
    masterMemberId: input.masterMemberId ?? null, trainerMemberId: input.trainerMemberId ?? null,
    idKind: input.idKind, course: input.course, title: input.title, trainerCredential: input.trainerCredential,
    sponsorLicense: input.sponsorLicense, directorPromotedPeriod: input.directorPromotedPeriod,
    joinedPeriod: input.joinedPeriod, endedPeriod: input.endedPeriod
  };
  await memberInsert(context.env.DB, member).run();
  return context.json(member, 201);
});

app.get("/api/v1/products", (context) => context.json({ planVersion: planConfig.version, products: planConfig.products }));

app.get("/api/v1/purchases", async (context) => {
  const period = await selectedPeriod(context.env.DB, context.req.query("period"));
  const snapshot = await loadSnapshot(context.env.DB, context.get("workspaceId"), period);
  return context.json(snapshot.purchases.filter((purchase) => purchase.period === period));
});

app.post("/api/v1/purchases", async (context) => {
  const input = await boundedJson(context.req.raw, purchaseSchema);
  const snapshot = await loadSnapshot(context.env.DB, context.get("workspaceId"), input.period);
  if (!snapshot.members.some((member) => member.id === input.memberId)) return context.json({ error: "会員が存在しません" }, 400);
  const purchase: PurchaseEvent = {
    id: input.id ?? crypto.randomUUID(), workspaceId: context.get("workspaceId"), memberId: input.memberId,
    period: input.period, productCode: input.productCode ?? null, kind: input.kind, status: input.status,
    quantity: input.quantity, price: input.price, pv: input.pv
  };
  await purchaseInsert(context.env.DB, purchase).run();
  return context.json(purchase, 201);
});

app.get("/api/v1/goals", async (context) => context.json(await getGoal(context.env.DB, context.get("workspaceId"))));

app.put("/api/v1/goals", async (context) => {
  const input = await boundedJson(context.req.raw, z.object({ targetTitle: titleSchema.exclude(["NONE"]), targetPeriod: periodSchema }));
  const goal: Goal = { workspaceId: context.get("workspaceId"), targetTitle: input.targetTitle, targetPeriod: input.targetPeriod };
  await upsertGoal(context.env.DB, goal);
  return context.json(goal);
});

app.get("/api/v1/settings/tax", async (context) => context.json(await getTaxProfile(context.env.DB, context.get("workspaceId"))));
app.put("/api/v1/settings/tax", async (context) => {
  const profile = await boundedJson(context.req.raw, taxProfileSchema);
  await upsertTaxProfile(context.env.DB, context.get("workspaceId"), profile);
  return context.json(profile);
});

app.post("/api/v1/simulations", async (context) => {
  const request = await boundedJson(context.req.raw, simulationSchema);
  const workspaceId = context.get("workspaceId");
  const [actual, simulationMembers] = await Promise.all([
    loadSnapshot(context.env.DB, workspaceId, request.period),
    listSimulationMembers(context.env.DB, workspaceId, request.period)
  ]);
  const snapshot = applySimulationMembers(actual, simulationMembers);
  return context.json({ results: simulatePlacements(snapshot, request) });
});

app.post("/api/v1/forecasts", async (context) => {
  const input = await boundedJson(context.req.raw, forecastSchema);
  const snapshot = await loadSnapshot(context.env.DB, context.get("workspaceId"), input.period);
  return context.json({ results: input.scenarios.map((scenario) => runForecast(snapshot, input.rootMemberId, scenario)) });
});

app.get("/api/v1/imports/template/:kind", (context) => {
  const kind = context.req.param("kind") as CsvKind;
  if (!Object.hasOwn(CSV_TEMPLATES, kind)) return context.json({ error: "対象外のCSVです" }, 404);
  return context.body(CSV_TEMPLATES[kind], 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${kind}.csv"`
  });
});

app.post("/api/v1/imports/preview", async (context) => {
  const input = await boundedJson(context.req.raw, z.object({ kind: z.enum(["members", "purchases"]), csv: z.string().max(1_000_000) }));
  return context.json(previewCsv(input.kind, input.csv));
});

app.post("/api/v1/imports/commit", async (context) => {
  const input = await boundedJson(context.req.raw, z.object({ kind: z.enum(["members", "purchases"]), csv: z.string().max(1_000_000) }));
  const preview = previewCsv(input.kind, input.csv);
  if (preview.errors.length) return context.json({ error: "CSVにエラーがあります", preview }, 400);
  const workspaceId = context.get("workspaceId");
  const statements: D1PreparedStatement[] = [];
  if (input.kind === "members") {
    const existing = await loadSnapshot(context.env.DB, workspaceId, periodForDate(new Date()));
    const relationshipErrors = validateMemberRelationships(preview.rows, existing.members, planConfig.firstLineLimit);
    if (relationshipErrors.length) return context.json({ error: "CSVの配置関係にエラーがあります", preview: { ...preview, errors: relationshipErrors } }, 400);
    for (const row of preview.rows) {
      const member: Member = {
        id: row.id ?? "", workspaceId, displayName: row.display_name ?? "", parentMemberId: row.parent_id || null,
        introducerMemberId: row.introducer_id || null, masterMemberId: null, trainerMemberId: null,
        idKind: row.id_kind === "sub" ? "sub" : "master", course: courseSchema.parse(row.course), title: "NONE",
        trainerCredential: "NONE", sponsorLicense: false, directorPromotedPeriod: row.director_promoted_period || null,
        joinedPeriod: row.joined_period ?? "", endedPeriod: null
      };
      statements.push(memberInsert(context.env.DB, member));
    }
  } else if (input.kind === "purchases") {
    const existing = await loadSnapshot(context.env.DB, workspaceId, periodForDate(new Date()));
    const memberIds = new Set(existing.members.map((member) => member.id));
    const missingMember = preview.rows.find((row) => !memberIds.has(row.member_id ?? ""));
    if (missingMember) return context.json({ error: `会員が存在しません: ${missingMember.member_id ?? ""}` }, 400);
    const purchaseIds = new Set(existing.purchases.map((purchase) => purchase.id));
    const duplicate = preview.rows.find((row) => purchaseIds.has(row.id ?? ""));
    if (duplicate) return context.json({ error: `既存購入IDと重複しています: ${duplicate.id ?? ""}` }, 400);
    for (const row of preview.rows) {
      const purchase: PurchaseEvent = {
        id: row.id ?? "", workspaceId, memberId: row.member_id ?? "", period: row.period ?? "", productCode: null,
        kind: z.enum(["initial", "repeat", "additional"]).parse(row.kind),
        status: z.enum(["planned", "confirmed"]).parse(row.status), quantity: Number(row.quantity), price: Number(row.price), pv: Number(row.pv)
      };
      statements.push(purchaseInsert(context.env.DB, purchase));
    }
  }
  statements.push(context.env.DB.prepare("INSERT INTO import_runs (id, workspace_id, kind, row_count) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), workspaceId, input.kind, preview.rows.length));
  await context.env.DB.batch(statements);
  return context.json({ imported: preview.rows.length }, 201);
});

export default app;
