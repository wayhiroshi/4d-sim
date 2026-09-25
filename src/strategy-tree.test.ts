import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import OrganizationResultTree from "./OrganizationResultTree";
import { blankMember, type StrategyNode } from "./shared/strategy";
import { indexMonth } from "./domain/engine";
import { summarizeOrganization } from "./domain/strategy";
import { organizationTree } from "./domain/strategy-tree";

const node = (id: string, parentId: string | null, count: number, depth: number): StrategyNode => ({
  id, name: id, parentId, count, depth, active: count, ownerId: null, introducerId: parentId, course: "A", title: "NONE"
});

describe("aggregated result tree", () => {
  it("nests by parent rather than array order and avoids double-counting descendants", () => {
    const nodes = [node("孫", "子", 15, 2), node("自分", null, 100, 0), node("子", "自分", 40, 1)];
    const original = JSON.stringify(nodes);
    const { roots, detached } = organizationTree(nodes);
    expect(detached).toEqual([]);
    expect(roots[0]!.remaining).toBe(59);
    expect(roots[0]!.children[0]!.remaining).toBe(24);
    expect(roots[0]!.children[0]!.children[0]!.node.name).toBe("孫");
    expect(JSON.stringify(nodes)).toBe(original);
    const html = renderToStaticMarkup(createElement(OrganizationResultTree, { nodes }));
    expect(html).toContain("(100)"); expect(html).toContain("(40)");
    expect(html).toContain("その他の配下"); expect(html).toContain("(59)");
    expect(html).toContain('aria-expanded="true"');
  });
  it("does not invent a direct connection for older incomplete summaries", () => {
    const { roots, detached } = organizationTree([node("root", null, 10, 0), node("leader", "omitted", 5, 3)]);
    expect(roots[0]!.children).toEqual([]);
    expect(detached[0]!.node.id).toBe("leader");
    expect(organizationTree([])).toEqual({ roots: [], detached: [] });
  });
  it("retains connecting IDs and counts all levels excluding each member itself", () => {
    const members = [blankMember("root", null, "demo", "2026-07"), blankMember("a", "root", "demo", "2026-07"), blankMember("bridge", "a", "demo", "2026-07"), blankMember("leader", "bridge", "demo", "2026-07"), blankMember("leaf", "leader", "demo", "2026-07")];
    const snapshot = indexMonth({ workspaceId: "demo", period: "2026-07", members, purchases: [] }, { compressionEnabled: false });
    const summary = summarizeOrganization(snapshot, "root", new Set(["leader"]));
    expect(summary.map(n => n.id).sort()).toEqual(["a", "bridge", "leader", "root"]);
    expect(summary.find(n => n.id === "root")!.count).toBe(4);
    expect(summary.find(n => n.id === "leader")!.count).toBe(1);
    expect(organizationTree(summary).detached).toEqual([]);
  });
  it("keeps retired connecting IDs without counting them, and reflects sub compression", () => {
    const members = [blankMember("root", null, "demo", "2026-07"), blankMember("bridge", "root", "demo", "2026-07"), blankMember("leader", "bridge", "demo", "2026-07"), blankMember("leaf", "leader", "demo", "2026-07")];
    members[1]!.endedPeriod = "2026-07";
    const base = { workspaceId: "demo", period: "2026-07", members, purchases: [] };
    const summary = summarizeOrganization(indexMonth(base, { compressionEnabled: false }), "root", new Set(["leader"]));
    const { roots, detached } = organizationTree(summary);
    expect(detached).toEqual([]);
    expect(roots[0]!.node.count).toBe(2);
    expect(roots[0]!.remaining).toBe(0);
    expect(roots[0]!.children[0]!.node.enrolled).toBe(false);
    members[1]!.idKind = "sub";
    const compressed = summarizeOrganization(indexMonth(base, { compressionEnabled: true }), "root", new Set(["leader"]), true);
    expect(compressed.find(n => n.id === "bridge")).toBeUndefined();
    expect(compressed.find(n => n.id === "leader")!.parentId).toBe("root");
    expect(organizationTree(compressed).roots[0]!.remaining).toBe(0);
  });
});
