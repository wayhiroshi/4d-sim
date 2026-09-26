import { describe, expect, it } from "vitest";
import { computeLineBonus, indexMonth } from "./engine";
import { candidateStrategies, evaluateStrategyMonth, runStrategy, simulateStrategy, validateStrategyBase } from "./strategy";
import { actionSchema, blankMember, defaultPhase, strategyRequestSchema, type Band, type StrategySimulationRequest } from "../shared/strategy";
import type { OrganizationSnapshot, PurchaseEvent, TitleCode } from "../shared/types";

export function fixture() {
  const root = { ...blankMember("root", null, "demo", "2026-07"), course: "G" as const, sponsorLicense: true };
  const purchase: PurchaseEvent = { id: "p-root", workspaceId: "demo", memberId: root.id, period: "2026-07", productCode: null, kind: "repeat", status: "confirmed", quantity: 1, price: 19900, pv: 10670 };
  const base: OrganizationSnapshot = { workspaceId: "demo", period: "2026-07", members: [root], purchases: [purchase] };
  const phase = defaultPhase();
  for (const b of ["conservative", "standard", "challenge"] as const) phase.rates[b] = { introductions: 1, activity: 0, perRecruiter: 0, retention: 1, exitRate: 0, reactivation: 0 };
  const request = strategyRequestSchema.parse({ rootId: "root", targetId: "root", partnerId: null, horizonMonths: 12,
    leaders: [{ id: "leader", name: "チーム", existingMemberId: null, introducerId: "root", placementId: "root", startMonth: 1, initialTeam: 0, licenseAfterMonths: null, phases: [phase] }],
    ownedMonthlyCosts: {}, courseMonthlyCosts: { A: 9950, B: 19900, F: 13170, G: 26340, I: 0 }, taxes: { root: { invoiceRegistered: true, withholdingRate: 0, transferFee: 0, offsets: 0, priorCarryover: 0 } } });
  return { base, request };
}
function simulate(base: OrganizationSnapshot, request: StrategySimulationRequest, band: Band = "standard") {
  const iterator = simulateStrategy(base, request, candidateStrategies(base, request)[0]!, band);
  for (;;) { const r = iterator.next(); if (r.done) return r.value; }
}

describe("Strategy Studio monthly engine", () => {
  it("diagnoses a 4,001-ID organization stuck before DR and awards DR only after explicit prerequisites", () => {
    const {base,request}=fixture();
    base.members[0]!.course="A"; base.members[0]!.sponsorLicense=false;
    for(let i=1;i<=4001;i++) base.members.push(blankMember(`large-${i}`, i<=7?"root":`large-${Math.floor((i-1)/7)}`,"demo",base.period));
    base.purchases=base.members.map(m=>({...base.purchases[0]!,id:`p-${m.id}`,memberId:m.id,pv:5330}));
    const blocked=evaluateStrategyMonth(base,request,0,new Map(),new Map()).row;
    expect(blocked.count).toBe(4001);
    expect(blocked.targetTitle).not.toBe("DR");
    expect(blocked.missing.some(s=>s.includes("本人がB・Gコース"))).toBe(true);
    expect(blocked.missing.some(s=>s.includes("スポンサーライセンス"))).toBe(true);
    base.members[0]!.course="G";base.members[0]!.sponsorLicense=true;
    const qualified=evaluateStrategyMonth(base,request,0,new Map(),new Map()).row;
    expect(qualified.targetTitle).toBe("DR");
  });
  it.each([0, 100, 250, 300])("caps the entire downline at %i rather than giving that capacity to every recruiter", (potential) => {
    const { base, request } = fixture();
    const leader = request.leaders[0]!;
    leader.potentialDownlineIds = potential;
    const phase = leader.phases[0]!;
    phase.recruitmentDelay = 1;
    phase.rates.standard = { introductions: 30, activity: 1, perRecruiter: 3, retention: 1, exitRate: 0, reactivation: 0 };
    const before = JSON.stringify({ base, request });
    const r = simulate(base, request);
    expect(r.months[1]!.count).toBe(Math.min(30, potential) + 1);
    expect(r.months.at(-1)!.count).toBe(potential + 1);
    expect(r.finalOrganization.find(n => n.id === "strategy-leader")?.count).toBe(potential);
    expect(JSON.stringify({ base, request })).toBe(before);
  });
  it("preserves old uncapped requests and validates contradictory starting teams", () => {
    const { base, request } = fixture();
    expect(simulate(base, request)).toEqual(simulate(base, { ...request, leaders: request.leaders.map(l => ({ ...l, potentialDownlineIds: null })) }));
    const bad = (n: number) => ({ ...request, leaders: request.leaders.map(l => ({ ...l, potentialDownlineIds: n })) });
    for (const n of [-1, 1.5, 5001]) expect(strategyRequestSchema.safeParse(bad(n)).success).toBe(false);
    request.leaders[0]!.initialTeam = 11;
    expect(strategyRequestSchema.safeParse(bad(10)).success).toBe(false);
    expect(strategyRequestSchema.safeParse(bad(11)).success).toBe(true);
  });
  it("shares an ancestor's potential with nested teams, without changing the other branch", () => {
    const { base, request } = fixture();
    request.placementMode = "manual";
    const first = request.leaders[0]!;
    first.potentialDownlineIds = 10;
    first.phases[0]!.rates.standard.introductions = 2;
    request.leaders.push({ ...structuredClone(first), id: "nested", name: "子チーム", placementId: "strategy-leader", potentialDownlineIds: 100 });
    request.leaders.push({ ...structuredClone(first), id: "other", name: "別チーム", potentialDownlineIds: 15 });
    const r = simulate(base, request);
    expect(r.finalOrganization.find(n => n.id === "strategy-leader")?.count).toBe(10);
    expect(r.finalOrganization.find(n => n.id === "strategy-other")?.count).toBe(15);
    expect(r.months.at(-1)!.count).toBe(27);
  });
  it("counts inactive IDs toward potential and preserves existing oversized teams", () => {
    const { base, request } = fixture();
    request.leaders[0]!.potentialDownlineIds = 5;
    request.leaders[0]!.phases[0]!.rates.standard.retention = 0.5;
    const r = simulate(base, request);
    expect(Math.max(...r.months.map(m => m.enrolled))).toBeLessThanOrEqual(6);
    expect(r.months.at(-1)!.inactive).toBeGreaterThan(0);
    base.members.push(...Array.from({ length: 3 }, (_, i) => blankMember(`existing-${i}`, "root", base.workspaceId, base.period)));
    request.leaders[0] = { ...request.leaders[0]!, existingMemberId: "root", placementId: "root", potentialDownlineIds: 1 };
    const oversized = simulate(base, request);
    expect(oversized.months.at(-1)!.enrolled).toBe(3);
    expect(oversized.warnings.some(w => w.includes("既存IDは減らさず"))).toBe(true);
  });
  it("preserves the official 1,868 and 800 yen line golden cases with indexed calculations", () => {
    const { base, request } = fixture();
    base.members.push({ ...blankMember("g", "root", "demo", base.period), course: "G" }, blankMember("a", "g", "demo", base.period));
    base.purchases.push(...base.members.slice(1).map((m) => ({ ...base.purchases[0]!, id: `p-${m.id}`, memberId: m.id, pv: m.course === "G" ? 10670 : 5330 })));
    const result = evaluateStrategyMonth(base, request, 0, new Map(), new Map());
    expect(result.row.line).toBe(1868);
    expect(computeLineBonus(indexMonth(base), "g")).toBe(800);
  });
  it("keeps input untouched and separates recurring bonuses from initial bonuses", () => {
    const { base, request } = fixture(); const original = JSON.stringify({ base, request });
    const result = simulate(base, request);
    expect(JSON.stringify({ base, request })).toBe(original);
    expect(result.months[1]!.gross).toBeGreaterThan(result.months[1]!.recurring);
    expect(result.months[1]!.cashflow).toBe(result.months[1]!.net - result.months[1]!.costs);
    const noCosts = simulate(base, { ...request, courseMonthlyCosts: { A: 0, B: 0, F: 0, G: 0, I: 0 } });
    expect(result.months.map((m) => m.gross)).toEqual(noCosts.months.map((m) => m.gross));
    expect(noCosts.months[1]!.cashflow - result.months[1]!.cashflow).toBe(26340);
  });
  it("marks checkpoints at the actual crossed count without inventing exact-count rows", () => {
    const { base, request } = fixture(); request.leaders[0]!.initialTeam = 111;
    const result = simulate(base, request);
    expect(result.checkpoints[0]).toMatchObject({ reached: true, reachedMonth: 1, actualCount: 113 });
    expect(result.checkpoints[1]).toMatchObject({ reached: false, reachedMonth: null });
  });
  it("can reach 2,000 IDs after ten years and records another twelve months", () => {
    const { base, request } = fixture(); request.horizonMonths = 132; request.leaders[0]!.startMonth = 121; request.leaders[0]!.initialTeam = 1999;
    const result = simulate(base, request);
    expect(result.completionMonth).toBe(121);
    expect(result.months.at(-1)!.month).toBeGreaterThanOrEqual(133);
    expect(result.checkpoints.map((c) => c.reachedMonth)).toEqual([121, 121, 121, 121, 121, 121]);
    expect(result.steady!.gross).toBe(result.steady!.recurring);
    expect(result.postCompletionAverage).not.toBeNull();
  }, 20000);
  it("does not silently drop small fractional attrition or restart retired members", () => {
    const { base, request } = fixture(); request.leaders[0]!.initialTeam = 99;
    request.leaders[0]!.phases[0]!.rates.standard = { introductions: 0, activity: 0, perRecruiter: 0, retention: 0.995, exitRate: 0.01, reactivation: 1 };
    const result = simulate(base, request);
    expect(result.months.at(-1)!.exited).toBeGreaterThan(0);
    expect(result.months.at(-1)!.enrolled).toBeLessThan(result.months[1]!.enrolled);
  });
  it("rejects cycles and targets outside household", () => {
    const { base, request } = fixture(); expect(() => validateStrategyBase(base, { ...request, targetId: "other" })).toThrow();
    base.members[0]!.parentMemberId = "root";
    expect(() => validateStrategyBase(base, request)).toThrow("循環");
  });
  it("settles each payee once while itemizing self, partner and both sets of subs", () => {
    const { base, request } = fixture();
    const partner = blankMember("partner", "root", "demo", base.period);
    const sub1 = { ...blankMember("sub1", "root", "demo", base.period), idKind: "sub" as const, masterMemberId: "root" };
    const sub2 = { ...blankMember("sub2", "partner", "demo", base.period), idKind: "sub" as const, masterMemberId: "partner" };
    base.members.push(partner, sub1, sub2, blankMember("a", "sub1", "demo", base.period), blankMember("b", "sub2", "demo", base.period));
    base.purchases.push(...base.members.slice(1).map((m) => ({ ...base.purchases[0]!, id: m.id, memberId: m.id, pv: 5330 })));
    const evaluated = evaluateStrategyMonth(base, { ...request, partnerId: "partner" }, 0, new Map<string, TitleCode>(), new Map());
    expect(evaluated.row.ids.map((m) => m.id).sort()).toEqual(["partner", "root", "sub1", "sub2"]);
    expect(evaluated.row.payees).toHaveLength(2);
    expect(evaluated.row.gross).toBe(evaluated.row.ids.reduce((s, m) => s + m.gross, 0));
  });
  it("repeats the same placements and stable ranking across all growth bands", async () => {
    const { base, request } = fixture(); const result = await runStrategy(base, request);
    const repeated = await runStrategy(base, request);
    expect(result).toEqual(repeated);
    expect(result.variants).toHaveLength(3);
    for (const variant of result.variants) expect(variant.bands.conservative.candidate).toEqual(variant.bands.challenge.candidate);
  });
  it("uses payment carryover month by month rather than resetting the input amount", () => {
    const { base, request } = fixture(); request.taxes.root!.priorCarryover = 2000;
    const first = evaluateStrategyMonth(base, request, 0, new Map(), new Map());
    expect(first.row.payees[0]!.bonus.carryover).toBe(2000);
    const result = simulate(base, request);
    const paid = result.months.reduce((sum, m) => sum + m.net, 0);
    const gross = result.months.reduce((sum, m) => sum + m.gross, 0);
    expect(paid + result.months.at(-1)!.payees[0]!.bonus.carryover).toBe(gross + 2000);
  });
  it("fixes team quotas before simulation and keeps the route prefix when extending beyond ten years", () => {
    const { base, request } = fixture();
    request.leaders.push({ ...structuredClone(request.leaders[0]!), id: "second", name: "2つ目", targetWeight: 3 });
    const shorter = simulate(base, request);
    const longer = simulate(base, { ...request, horizonMonths: 132 });
    expect(longer.months.slice(0, 13)).toEqual(shorter.months);
    expect(shorter.finalDesign).toEqual(longer.finalDesign);
    expect(shorter.finalDesign.lines.map((l) => l.quota)).toEqual([500, 1500]);
    expect(simulate(base, request, "conservative").finalDesign).toEqual(shorter.finalDesign);
    expect(shorter.checkpoints.map((p) => p.memberCount)).toEqual([100, 300, 500, 1000, 1500, 2000]);
  });
  it("keeps the selected strategy fixed during a downside replay", async () => {
    const { base, request } = fixture(); request.allowSubCreation = true;
    const baseline = await runStrategy(base, request);
    const stressed = await runStrategy(base, { ...request, stress: { kind: "recruitment-stop", leaderId: null, fromMonth: 1, duration: 12, retentionDrop: 0 } });
    expect(stressed.variants.map((v) => v.candidateId)).toEqual(baseline.variants.map((v) => v.candidateId));
    expect(stressed.stressImpact).toHaveLength(9);
    expect(stressed.stressImpact.every((s) => s.countDelta <= 0)).toBe(true);
  });
  it("promotes a deleted sub's children beyond seven but never places a new eighth direct member", () => {
    const { base, request } = fixture();
    base.members.push({ ...blankMember("sub", "root", "demo", base.period), idKind: "sub", masterMemberId: "root" });
    for (let i = 0; i < 6; i++) base.members.push(blankMember(`direct${i}`, "root", "demo", base.period));
    for (let i = 0; i < 3; i++) base.members.push(blankMember(`below${i}`, "sub", "demo", base.period));
    base.purchases.push(...base.members.slice(1).map((m) => ({ ...base.purchases[0]!, id: m.id, memberId: m.id, pv: 5330 })));
    request.allowSubDeletion = true; request.provisionalCompression = true;
    request.leaders[0]!.initialTeam = 100;
    request.actions = [actionSchema.parse({ id: "remove", kind: "delete-sub", month: 1, memberId: "sub", parentId: null, ownerId: "root", requiredMemberId: null })];
    const result = simulate(base, request);
    const nodes = result.checkpoints[0]!.organization;
    expect(nodes.filter((n) => n.parentId === "root")).toHaveLength(9);
    expect(nodes.find((n) => n.id === "strategy-leader")!.parentId).not.toBe("root");
    expect(result.months[1]!.ownedSubs).toBe(0);
    expect(result.warnings.join(" ")).toContain("暫定");
  });
  it("applies planned course changes and does not erase surviving children of a retired ordinary member", () => {
    const { base, request } = fixture();
    base.members.push({ ...blankMember("departed", "root", "demo", "2026-01"), endedPeriod: "2026-06" }, blankMember("survivor", "departed", "demo", base.period));
    base.purchases.push({ ...base.purchases[0]!, id: "survivor-p", memberId: "survivor", pv: 5330 });
    request.actions = [actionSchema.parse({ id: "course", kind: "change-course", month: 1, memberId: "root", parentId: null, ownerId: null, requiredMemberId: null, course: "A" })];
    const result = simulate(base, request);
    expect(result.months[0]!.count).toBe(1);
    expect(result.months[0]!.line).toBe(267);
    expect(result.months[1]!.ids[0]!.cost).toBe(9950);
  });
  it("benchmarks 2,000 IDs, 120 months and all three strategies/bands without random resampling", async () => {
    const { base, request } = fixture(); request.horizonMonths = 120;
    const phase = request.leaders[0]!.phases[0]!;
    for (const band of ["conservative", "standard", "challenge"] as const) phase.rates[band].introductions = 20;
    request.leaders[0]!.initialTeam = 1999; request.leaders[0]!.licenseAfterMonths = 0;
    request.allowSubCreation = true;
    const started = performance.now(); const result = await runStrategy(base, request);
    const milliseconds = performance.now() - started;
    console.log(`Strategy 2000-ID/120-month benchmark: ${Math.round(milliseconds)} ms; ${result.explored} candidates; ${JSON.stringify(result).length} chars`);
    expect(result.variants.every((v) => Object.values(v.bands).every((b) => b.completionMonth !== null))).toBe(true);
    const selected = result.variants[0]!.bands.standard;
    expect(selected.checkpoints.map((p) => p.actualCount)).toEqual([2000, 2000, 2000, 2000, 2000, 2000]);
    expect(selected.postCompletionAverage).toBe(selected.months.slice(2, 14).reduce((s, m) => s + m.recurringCashflow, 0) / 12);
    expect(selected.steady!.gross).toBe(selected.steady!.recurring);
    // Generous CI guard; the actual measured duration is reported separately.
    expect(milliseconds).toBeLessThan(30000);
  }, 35000);
  it("matches fixed yen/PV checkpoints along one growing organization", () => {
    const { base, request } = fixture(); request.horizonMonths = 24;
    request.leaders[0]!.phases[0]!.rates.standard.introductions = 100;
    const result = simulate(base, request);
    expect(result.checkpoints.map((c) => c.reachedMonth)).toEqual([1, 3, 5, 10, 15, 20]);
    expect(result.checkpoints.map((c) => c.actualCount)).toEqual([101, 301, 501, 1001, 1501, 2000]);
    expect(result.checkpoints.map((c) => c.snapshot!.pv)).toEqual([543670, 1609670, 2675670, 5340670, 8005670, 10665340]);
    expect(result.checkpoints.map((c) => c.snapshot!.line)).toEqual([28301, 81701, 135101, 268601, 402101, 535334]);
    expect(result.checkpoints.every((c) => c.snapshot!.targetTitle === "NONE")).toBe(true);
  });
  it("only changes introducer IDs within the same owner when explicitly allowed", () => {
    const { base, request } = fixture(); request.allowSubCreation = true;
    expect(candidateStrategies(base, request).find((c) => c.id === "subs-root")!.introducers.leader).toBe("root");
    request.allowIntroducerIdChoice = true;
    expect(candidateStrategies(base, request).find((c) => c.id === "subs-root")!.introducers.leader).toBe("strategy-sub-root-0");
    base.members.push(blankMember("partner", "root", "demo", base.period)); request.partnerId = "partner";
    expect(candidateStrategies(base, request).find((c) => c.id === "subs-partner")!.introducers.leader).toBe("root");
  });
  it("never counts an owned sub as another person who autonomously recruits", () => {
    const { base, request } = fixture();
    base.members.push({ ...blankMember("sub", "root", "demo", base.period), idKind: "sub", masterMemberId: "root" });
    base.purchases.push({ ...base.purchases[0]!, id: "sub-p", memberId: "sub" });
    request.leaders[0]!.existingMemberId = "root";
    request.leaders[0]!.phases[0]!.rates.standard = { introductions: 0, activity: 1, perRecruiter: 3, retention: 1, exitRate: 0, reactivation: 0 };
    const result = simulate(base, request);
    expect(result.months.every((m) => m.count === 1)).toBe(true);
  });
  it("honors the placement destination for future introductions by an existing leader", () => {
    const { base, request } = fixture();
    base.members.push(blankMember("partner", "root", "demo", base.period));
    base.purchases.push({ ...base.purchases[0]!, id: "partner-p", memberId: "partner", pv: 5330 });
    Object.assign(request.leaders[0]!, { existingMemberId: "root", placementId: "partner", initialTeam: 100 });
    const result = simulate(base, request);
    expect(result.checkpoints[0]!.organization.filter((n) => n.parentId === "root").map((n) => n.id)).toEqual(["partner"]);
    expect(result.months[1]!.ids[0]!.start).toBe(101 * 3740);
  });
  it("does not declare growth stopped while inactive members are returning", () => {
    const { base, request } = fixture();
    for (let i = 0; i < 100; i++) base.members.push(blankMember(`inactive-${i}`, i < 7 ? "root" : `inactive-${Math.floor((i - 7) / 7)}`, "demo", base.period));
    request.leaders[0]!.existingMemberId = "root";
    request.leaders[0]!.phases[0]!.rates.standard = { introductions: 0, activity: 0, perRecruiter: 0, retention: 1, exitRate: 0, reactivation: 0.01 };
    const result = simulate(base, request);
    expect(result.months.at(-1)!.count).toBeGreaterThan(result.months[0]!.count);
    expect(result.status).toBe("horizon");
  });
  it("includes an owned ID's initial purchase cost without reducing its gross bonus", () => {
    const { base, request } = fixture();
    const before = evaluateStrategyMonth(base, request, 0, new Map(), new Map());
    base.purchases.push({ ...base.purchases[0]!, id: "initial-root", kind: "initial", price: 12000 });
    const after = evaluateStrategyMonth(base, request, 0, new Map(), new Map());
    expect(after.row.gross).toBe(before.row.gross);
    expect(after.row.costs - before.row.costs).toBe(12000);
    expect(after.row.cashflow - before.row.cashflow).toBe(-12000);
  });
});
