import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import StrategyPrerequisites from "./StrategyPrerequisites";
import { strategyFixture } from "./test/strategy-fixture";
import { actionSchema, blankMember, strategyRequestSchema } from "./shared/strategy";
import { candidateStrategies, simulateStrategy } from "./domain/strategy";
import { scheduleTitlePrerequisites, titlePrerequisites } from "./domain/strategy-prerequisites";

function fixture() {
  const f = strategyFixture(1);
  f.request.leaders[0]!.existingMemberId = "root";
  for (const rate of Object.values(f.request.leaders[0]!.phases[0]!.rates)) rate.introductions = 0;
  f.base.members[0]!.sponsorLicense = false;
  return f;
}

describe("visible future title prerequisites", () => {
  it("warns about missing course and license and offers an explicit plan without changing records", () => {
    const { base, request } = fixture();
    const before = JSON.stringify({ base, request });
    expect(titlePrerequisites(base, request).map(i => [i.kind, i.scheduledMonth, i.canAdd])).toEqual([
      ["change-course", null, true], ["qualification", null, true],
    ]);
    const html = renderToStaticMarkup(createElement(StrategyPrerequisites, { base, input: request, busy: false, apply: () => {}, settings: () => {} }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("人数が増えてもDRに進めません");
    expect(html).toContain("途中で条件を満たす予定を設定");
    const next = scheduleTitlePrerequisites(base, request, 3, "G");
    expect(next.actions.map(a => [a.kind, a.month])).toEqual([["change-course", 3], ["qualification", 3]]);
    expect(titlePrerequisites(base, next).every(i => i.scheduledMonth === 3)).toBe(true);
    expect(scheduleTitlePrerequisites(base, next, 5, "B")).toEqual(next);
    expect(strategyRequestSchema.parse(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(JSON.stringify({ base, request })).toBe(before);
    const planned = renderToStaticMarkup(createElement(StrategyPrerequisites, { base, input: next, busy: false, apply: () => {}, settings: () => {} }));
    expect(planned).not.toContain('role="alert"');
    expect(planned).toContain("3か月後にGコースへ変更");
  });

  it.each([0, 13, 1.5, NaN])("rejects an invalid preparation month %s", month => {
    const { base, request } = fixture();
    expect(() => scheduleTitlePrerequisites(base, request, month, "G")).toThrow();
  });

  it("preserves explicit conditional and out-of-period plans, only filling truly missing items", () => {
    const { base, request } = fixture();
    request.actions = [actionSchema.parse({ id: "original", kind: "change-course", memberId: "root", month: 20, course: "B", parentId: null, ownerId: null, requiredMemberId: "sub1", requiredTitle: "DR" })];
    const next = scheduleTitlePrerequisites(base, request, 3, "G");
    expect(next.actions[0]).toEqual(request.actions[0]);
    expect(next.actions.map(a => a.kind)).toEqual(["change-course", "qualification"]);
    expect(titlePrerequisites(base, next)[0]).toMatchObject({ scheduledMonth: null, canAdd: false });
  });

  it("recognizes a profile license schedule and checks priority sub IDs separately", () => {
    const { base, request } = strategyFixture(1);
    base.members[0]!.course = "G";
    base.members[0]!.sponsorLicense = false;
    Object.assign(request.leaders[0]!, { existingMemberId: "root", licenseAfterMonths: 4 });
    request.growthPriority = [{ memberId: "sub1", title: "DR" }];
    const issues = titlePrerequisites(base, request);
    expect(issues.find(i => i.memberId === "root")).toMatchObject({ kind: "qualification", scheduledMonth: 4 });
    expect(issues.find(i => i.memberId === "sub1")).toMatchObject({ kind: "change-course", scheduledMonth: null });
    base.members[0]!.sponsorLicense = true;
    request.growthPriority = [];
    expect(titlePrerequisites(base, request)).toEqual([]);
  });

  it("a 500-ID organization reaches DR at the scheduled month, not before, with new course cost", () => {
    const { base, request } = fixture();
    base.members = [base.members[0]!];
    for (let i = 1; i <= 500; i++) base.members.push(blankMember(`large-${i}`, i <= 7 ? "root" : `large-${Math.floor((i - 1) / 7)}`, "demo", base.period));
    base.purchases = base.members.map(m => ({ ...base.purchases[0]!, id: `p-${m.id}`, memberId: m.id, pv: 5330 }));
    request.targetTitle = "DR";
    const before = JSON.stringify(base);
    const next = scheduleTitlePrerequisites(base, request, 3, "G");
    const iterator = simulateStrategy(base, next, candidateStrategies(base, next)[0]!, "standard");
    let step = iterator.next(); while (!step.done) step = iterator.next();
    const months = step.value.months;
    expect(months[2]!.targetTitle).not.toBe("DR");
    expect(months[3]!.targetTitle).toBe("DR");
    expect(months[2]!.ids.find(i => i.id === "root")!.cost).toBe(9950);
    expect(months[3]!.ids.find(i => i.id === "root")!.cost).toBe(26340);
    expect(JSON.stringify(base)).toBe(before);
  });
});
