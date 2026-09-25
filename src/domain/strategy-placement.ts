import { planConfig } from "./plan";
import type { OrganizationSnapshot } from "../shared/types";
import type { StrategySimulationRequest } from "../shared/strategy";

export interface PlacementNode { id: string; name: string; parentId: string | null; introducerId: string | null; sub: boolean; ownerId: string | null; planned: boolean; leaderId?: string; actionId?: string }

/** The editable graph is a counterfactual, never the registered organization. */
export function placementNodes(base: OrganizationSnapshot, input: StrategySimulationRequest): PlacementNode[] {
  const byId = new Map(base.members.map(m => [m.id, m]));
  const nodes: PlacementNode[] = base.members.filter(m => m.joinedPeriod <= base.period && (!m.endedPeriod || m.endedPeriod > base.period)).map(m => {
    let parentId = input.placementOverrides?.[m.id] ?? m.parentMemberId;
    const seen = new Set<string>();
    while (parentId && input.provisionalCompression && !seen.has(parentId)) {
      seen.add(parentId); const parent = byId.get(parentId);
      if (!parent || parent.idKind !== "sub" || !parent.endedPeriod || parent.endedPeriod > base.period) break;
      parentId = parent.parentMemberId;
    }
    return { id: m.id, name: m.displayName, parentId, introducerId: m.introducerMemberId, sub: m.idKind === "sub", ownerId: m.masterMemberId, planned: false,
      leaderId: input.leaders.find(l => l.existingMemberId === m.id)?.id };
  });
  for (const l of input.leaders.filter(l => !l.existingMemberId)) nodes.push({ id: `strategy-${l.id}`, name: l.name, parentId: l.placementId, introducerId: l.introducerId, sub: false, ownerId: null, planned: true, leaderId: l.id });
  for (const a of input.actions.filter(a => a.kind === "create-sub")) if (!nodes.some(n => n.id === a.memberId)) nodes.push({ id: a.memberId, name: "作成予定サブ", parentId: a.parentId ?? a.ownerId, introducerId: a.ownerId, sub: true, ownerId: a.ownerId, planned: true, actionId: a.id });
  return nodes;
}

export function placementError(nodes: PlacementNode[], source: string, target: string, root: string): string | null {
  const from = nodes.find(n => n.id === source), to = nodes.find(n => n.id === target);
  if (!from || !to) return "移動元または配置先が見つかりません";
  if (source === root || from.parentId === null) return "組織の起点は移動できません";
  if (from.parentId === target) return "現在と同じ配置先です";
  const byId = new Map(nodes.map(n => [n.id, n]));
  const seen = new Set<string>(); let cursor: string | null = target;
  while (cursor) {
    if (cursor === source || seen.has(cursor)) return "自分自身や配下には移動できません";
    seen.add(cursor); cursor = byId.get(cursor)?.parentId ?? null;
  }
  if (!seen.has(root)) return "今回の組織の外には配置できません";
  if (nodes.filter(n => n.parentId === target && n.id !== source).length >= planConfig.firstLineLimit) return `配置先の1次ラインは上限${planConfig.firstLineLimit} IDです`;
  // Existing teams cannot be attached to someone who has not joined yet.
  if (!from.planned && to.planned) return "既存チームは、現在在籍しているIDへ配置してください";
  return null;
}

export function movePlacement(base: OrganizationSnapshot, input: StrategySimulationRequest, source: string, target: string): StrategySimulationRequest {
  const nodes = placementNodes(base, input);
  const error = placementError(nodes, source, target, input.rootId);
  if (error) throw new Error(error);
  const node = nodes.find(n => n.id === source)!;
  return { ...input, placementMode: "manual", allowIntroducerIdChoice: false,
    placementOverrides: node.planned ? { ...input.placementOverrides } : { ...input.placementOverrides, [source]: target },
    actions: input.actions.map(a => a.id === node.actionId ? { ...a, parentId: target } : a),
    leaders: input.leaders.map(l => node.planned && l.id === node.leaderId ? { ...l, placementId: target } : l) };
}

export function applyPlacementOverrides(base: OrganizationSnapshot, input: StrategySimulationRequest): OrganizationSnapshot {
  const snapshot = structuredClone(base);
  const nodes = placementNodes(base, input);
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const [id, parent] of Object.entries(input.placementOverrides ?? {})) {
    const member = snapshot.members.find(m => m.id === id);
    if (!member || id === input.rootId || member.parentMemberId === null || !byId.has(id) || !byId.has(parent) || byId.get(parent)!.planned) throw new Error("配置変更の対象が無効です");
    // Validate the final graph; edits may have been undone or reordered.
    const seen = new Set([id]); let cursor: string | null = parent;
    while (cursor) { if (seen.has(cursor)) throw new Error("組織に循環があります"); seen.add(cursor); cursor = byId.get(cursor)?.parentId ?? null; }
    if (!seen.has(input.rootId)) throw new Error("配置先は組織内で指定してください");
    const after = nodes.filter(n => n.parentId === parent).length;
    if (member.parentMemberId !== parent && after > planConfig.firstLineLimit) throw new Error("配置先の1次ライン上限を超えています");
    member.parentMemberId = parent;
  }
  for (const node of nodes.filter(n => n.planned)) {
    const seen = new Set([node.id]); let parent = node.parentId;
    while (parent) { if (seen.has(parent)) throw new Error("試算チームの配置に循環があります"); seen.add(parent); parent = byId.get(parent)?.parentId ?? null; }
    if (!seen.has(input.rootId)) throw new Error("試算チームの配置先が存在しません");
    if (input.placementMode === "manual" && nodes.filter(n => n.parentId === node.parentId).length > planConfig.firstLineLimit) throw new Error("試算チームの配置先が1次ライン上限を超えています");
  }
  return snapshot;
}
