import type { StrategyNode } from "../shared/strategy";

export interface SummaryBranch { node: StrategyNode; children: SummaryBranch[]; remaining: number }

/** Counts include all descendants already; don't sum an ancestor and its child. */
export function organizationTree(nodes: StrategyNode[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map<string, StrategyNode[]>();
  for (const node of nodes) if (node.parentId && byId.has(node.parentId)) {
    const list = children.get(node.parentId) ?? [];
    list.push(node); children.set(node.parentId, list);
  }
  const visited = new Set<string>();
  const branch = (node: StrategyNode): SummaryBranch => {
    visited.add(node.id);
    const nested = (children.get(node.id) ?? []).filter(child => !visited.has(child.id)).map(branch);
    return { node, children: nested, remaining: Math.max(0, node.count - nested.reduce((sum, child) => sum + (child.node.enrolled === false ? 0 : 1) + child.node.count, 0)) };
  };
  const roots = nodes.filter(node => node.depth === 0 || node.parentId === null).map(branch);
  // Older saved summaries can omit connecting IDs. Never invent direct links.
  const detached: SummaryBranch[] = [];
  for (const node of nodes) if (!visited.has(node.id) && (!node.parentId || !byId.has(node.parentId))) detached.push(branch(node));
  for (const node of nodes) if (!visited.has(node.id)) detached.push(branch(node));
  return { roots, detached };
}
