import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MemberOrganizationTree, { downlineCount } from "./MemberOrganizationTree";
import { blankMember } from "./shared/strategy";
import type { OrganizationSnapshot } from "./shared/types";
import { ldFixture } from "./test/ld-fixture";

function fixture(): OrganizationSnapshot {
  return { workspaceId: "demo", period: "2026-09", purchases: [], members: [
    blankMember("root", null, "demo", "2026-07"),
    blankMember("child", "root", "demo", "2026-07"),
    blankMember("grandchild", "child", "demo", "2026-07"),
    blankMember("other", "root", "demo", "2026-07")
  ] };
}
describe("current organization tree", () => {
  it("distinguishes missing monthly PV from confirmed zero and ignores planned/other-month purchases", () => {
    const snapshot = fixture();
    const render = () => renderToStaticMarkup(createElement(MemberOrganizationTree, { snapshot, simulationIds: new Set<string>(), selectedId: null, onSelect: () => {} }));
    expect(render()).toContain("当月p.v.未登録");
    snapshot.purchases.push({ id: "pv", workspaceId: "demo", memberId: "root", period: "2026-09", productCode: null, kind: "repeat", status: "planned", quantity: 1, price: 0, pv: 5330 });
    expect(render()).not.toContain("5,330 p.v.");
    snapshot.purchases[0]!.status = "confirmed"; snapshot.purchases[0]!.pv = 0;
    expect(render()).toContain("0 p.v.");
    snapshot.purchases[0]!.pv = 5330; snapshot.purchases[0]!.quantity = 2;
    expect(render()).toContain("10,660 p.v.");
    snapshot.purchases[0]!.period = "2026-08";
    expect(render()).not.toContain("10,660 p.v.");
  });
  it("shows a recalculated LD badge after trial placement rather than the saved title", () => {
    const snapshot = ldFixture();
    const html = renderToStaticMarkup(createElement(MemberOrganizationTree, { snapshot, simulationIds: new Set(["e"]), selectedId: null, onSelect: () => {} }));
    expect(html).toContain("LD（試算）");
    expect(snapshot.members[0]!.title).toBe("NONE");
  });
  it("counts all downline levels, excluding self and retired/future IDs", () => {
    const snapshot = fixture();
    expect(downlineCount(snapshot, "root")).toBe(3);
    expect(downlineCount(snapshot, "child")).toBe(1);
    snapshot.members[1]!.endedPeriod = "2026-08";
    snapshot.members[3]!.joinedPeriod = "2026-10";
    expect(downlineCount(snapshot, "root")).toBe(1);
    expect(downlineCount(snapshot, "grandchild")).toBe(0);
  });
  it("includes sub IDs and IDs without purchases and preserves input", () => {
    const snapshot = fixture(); snapshot.members[1]!.idKind = "sub"; snapshot.members[1]!.masterMemberId = "root";
    const original = JSON.stringify(snapshot);
    const html = renderToStaticMarkup(createElement(MemberOrganizationTree, { snapshot, simulationIds: new Set(["grandchild"]), selectedId: null, onSelect: () => {} }));
    expect(html).toContain("(3)"); expect(html).toContain("(1)");
    expect(html).toContain("is-trial"); expect(html).toContain("のサブ");
    expect(html).toContain('aria-label="rootの配下を収納"');
    expect(html).toContain('aria-label="rootの詳細・編集"');
    expect(html).not.toContain("NONE");
    expect(JSON.stringify(snapshot)).toBe(original);
  });
});
