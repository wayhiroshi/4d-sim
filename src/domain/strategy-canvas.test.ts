import { describe, expect, it } from "vitest";
import { actionSchema, blankMember, defaultPhase, strategyRequestSchema } from "../shared/strategy";
import type { OrganizationSnapshot } from "../shared/types";
import { applyPlacementOverrides, movePlacement, placementError, placementNodes } from "./strategy-placement";
import { comparisonPoint, incomeDifferences, sameGrowthAssumptions } from "./strategy-comparison";
import { inputFingerprint, runStrategy } from "./strategy";
import { strategyResultSchema } from "../shared/strategy-result-schema";

function fixture() {
  const members = [blankMember("root", null, "demo", "2026-07"), blankMember("sub", "root", "demo", "2026-07"), blankMember("a", "root", "demo", "2026-07"), blankMember("b", "a", "demo", "2026-07")];
  Object.assign(members[0]!, { course: "G", sponsorLicense: true });
  Object.assign(members[1]!, { idKind: "sub", masterMemberId: "root" });
  const base: OrganizationSnapshot = { workspaceId: "demo", period: "2026-07", members, purchases: members.map(m => ({ id: `p-${m.id}`, memberId: m.id, workspaceId: "demo", period: "2026-07", productCode: null, kind: "repeat", status: "confirmed", quantity: 1, price: 9950, pv: m.course === "G" ? 10670 : 5330 })) };
  const phase = defaultPhase();
  for (const band of ["conservative", "standard", "challenge"] as const) phase.rates[band] = { introductions: 1, activity: 0, perRecruiter: 0, retention: 1, exitRate: 0, reactivation: 0 };
  const request = strategyRequestSchema.parse({ rootId: "root", targetId: "root", partnerId: null, horizonMonths: 24, goalBasis: "title", placementMode: "manual", targetIds: 4999,
    leaders: [{ id: "self", name: "自分", existingMemberId: "root", introducerId: "root", placementId: "root", startMonth: 1, initialTeam: 0, licenseAfterMonths: null, phases: [phase] }],
    ownedMonthlyCosts: {}, courseMonthlyCosts: { A: 9950, B: 19900, F: 13170, G: 26340, I: 0 }, taxes: {} });
  return { base, request };
}

describe("TRD placement workspace", () => {
  it("moves a whole branch without changing recruiter, ownership or source data", () => {
    const { base, request } = fixture(); const frozen = JSON.stringify({ base, request });
    const next = movePlacement(base, request, "a", "sub");
    const moved = applyPlacementOverrides(base, next);
    expect(moved.members.find(m => m.id === "a")!.parentMemberId).toBe("sub");
    expect(moved.members.find(m => m.id === "b")!.parentMemberId).toBe("a");
    expect(moved.members.find(m => m.id === "a")!.introducerMemberId).toBe(base.members[2]!.introducerMemberId);
    expect(JSON.stringify({ base, request })).toBe(frozen);
    expect(sameGrowthAssumptions(request, next)).toBe(true);
  });
  it("rejects root moves, cycles and an eighth new first-line ID", () => {
    const { base, request } = fixture();
    expect(() => movePlacement(base, request, "root", "sub")).toThrow("起点");
    expect(() => movePlacement(base, request, "a", "b")).toThrow("配下");
    for (let i = 0; i < 7; i++) base.members.push(blankMember(`n${i}`, "sub", "demo", base.period));
    expect(() => movePlacement(base, request, "a", "sub")).toThrow("上限");
    expect(() => applyPlacementOverrides(base, { ...request, placementOverrides: { a: "sub" } })).toThrow("上限");
  });
  it("retains lifted sub branches without permitting further over-cap placements", () => {
    const { base, request } = fixture(); request.provisionalCompression = true;
    base.members[1]!.endedPeriod = base.period;
    for (let i = 0; i < 7; i++) base.members.push(blankMember(`n${i}`, "sub", "demo", base.period));
    const nodes = placementNodes(base, request);
    expect(nodes.filter(n => n.parentId === "root")).toHaveLength(8);
    expect(placementError(nodes, "b", "root", "root")).toContain("上限");
    expect(() => applyPlacementOverrides(base, request)).not.toThrow();
  });
  it("supports a future sub parent and rejects planned-team cycles", () => {
    const { base, request } = fixture();
    request.actions.push(actionSchema.parse({ id: "add-sub", kind: "create-sub", month: 1, memberId: "future-sub", parentId: "root", ownerId: "root", requiredMemberId: null }));
    request.leaders.push({ ...request.leaders[0]!, id: "new", existingMemberId: null, placementId: "future-sub" });
    expect(() => applyPlacementOverrides(base, request)).not.toThrow();
    const moved = movePlacement(base, request, "future-sub", "a");
    expect(moved.actions[0]!.parentId).toBe("a");
    expect(() => movePlacement(base, request, "future-sub", "strategy-new")).toThrow("配下");
  });
  it("keeps growth identity after moving a branch under a slower leader", async () => {
    const { base, request } = fixture();
    const slow = structuredClone(request.leaders[0]!); slow.id = "slow"; slow.existingMemberId = "sub"; slow.placementId = "sub";
    for (const band of ["conservative", "standard", "challenge"] as const) slow.phases[0]!.rates[band].retention = 0.5;
    request.leaders.push(slow);
    const before = await runStrategy(base, request);
    const moved = movePlacement(base, request, "a", "sub");
    const after = await runStrategy(base, moved);
    expect(after.variants[0]!.bands.standard.months.map(m => [m.count, m.exited])).toEqual(before.variants[0]!.bands.standard.months.map(m => [m.count, m.exited]));
    expect(after.fingerprint).toBe(inputFingerprint(base, moved));
    expect(strategyResultSchema.safeParse(after).success).toBe(true);
    expect(after.explored).toBe(1);
  });
  it("reserves a planned leader's exact parent instead of silently spilling it to another line", async () => {
    const { base, request } = fixture();
    request.leaders[0]!.phases.forEach(p => Object.values(p.rates).forEach(r => { r.introductions = 8; }));
    request.leaders.push({ ...request.leaders[0]!, id: "later", existingMemberId: null, placementId: "root", startMonth: 8 });
    const r = (await runStrategy(base, request)).variants[0]!.bands.standard;
    expect(r.finalOrganization.find(n => n.id === "strategy-later")?.parentId).toBe("root");
  });
  it("records title attainment below 2,000 IDs and keeps the requested elapsed-time range", async () => {
    const { base, request } = fixture(); request.targetTitle = "LD"; request.horizonMonths = 36; request.leaders[0]!.initialTeam = 20;
    const r = (await runStrategy(base, request)).variants[0]!.bands.standard;
    expect(r.completionMonth).not.toBeNull();
    expect(r.completion!.count).toBeLessThan(2000);
    expect(r.steady!.gross).toBe(r.steady!.recurring);
    expect(r.months.at(-1)!.month).toBeGreaterThanOrEqual(36);
    expect(comparisonPoint(r, request, "month", 36)?.month).toBe(36);
    expect(comparisonPoint(r, request, "title", 0)?.month).toBe(r.titleMonth);
  });
  it("compares approximate milestones using actual counts and detects changed assumptions", async () => {
    const { base, request } = fixture(); request.leaders[0]!.initialTeam = 111;
    const r = (await runStrategy(base, request)).variants[0]!.bands.standard;
    expect(comparisonPoint(r, request, "members", 100)?.count).toBeGreaterThan(100);
    expect(comparisonPoint(r, request, "members", 2000)).toBeNull();
    const changed = structuredClone(request); changed.leaders[0]!.startMonth = 6;
    expect(sameGrowthAssumptions(request, changed)).toBe(false);
    const before = structuredClone(r.months[0]!);
    before.ids.find(i => i.id === "sub")!.recurring = 800;
    const after = structuredClone(before);
    after.ids = after.ids.filter(i => i.id !== "sub");
    expect(incomeDifferences(before, after).find(i => i.id === "sub")?.recurring).toBe(-before.ids.find(i => i.id === "sub")!.recurring);
  });
});
