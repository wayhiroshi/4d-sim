import type { LeaderGrowthProfile } from "../shared/strategy";

/** An assumption about enrolled downline size, not an official title condition.
 * Includes inactive IDs and separately configured teams; excludes the leader
 * and retired IDs. Retired links are retained to locate surviving descendants.
 */
export function potentialIndex(
  members: Array<{ id: string; parentMemberId: string | null; enrolled: boolean }>,
  profiles: LeaderGrowthProfile[]
) {
  const parents = new Map(members.map(m => [m.id, m.parentMemberId]));
  const limits = new Map(profiles.filter(p => p.potentialDownlineIds != null)
    .map(p => [p.existingMemberId ?? `strategy-${p.id}`, { name: p.name, limit: p.potentialDownlineIds! }]));
  const counts = new Map<string, number>();
  const ancestors = (parent: string | null, visit: (id: string) => void) => {
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent); visit(parent); parent = parents.get(parent) ?? null;
    }
  };
  const increment = (parent: string | null) => ancestors(parent, id => {
    if (limits.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  });
  if (limits.size) for (const m of members) if (m.enrolled) increment(m.parentMemberId);
  return {
    blocking(parent: string | null): string | null {
      if (!limits.size) return null;
      let blocked: string | null = null;
      ancestors(parent, id => {
        const cap = limits.get(id);
        if (cap && (counts.get(id) ?? 0) >= cap.limit && !blocked)
          blocked = `${cap.name}：配下のポテンシャル ${cap.limit.toLocaleString("ja-JP")} IDに達したため、新規追加を止めています`;
      });
      return blocked;
    },
    add(id: string, parent: string | null) { parents.set(id, parent); if (limits.size) increment(parent); },
    exceeded(): string[] {
      return [...limits].filter(([id, cap]) => (counts.get(id) ?? 0) > cap.limit).map(([id, cap]) =>
        `${cap.name}：現在の配下 ${(counts.get(id) ?? 0).toLocaleString("ja-JP")} IDがポテンシャル ${cap.limit.toLocaleString("ja-JP")} IDを超えています。既存IDは減らさず、新規追加を止めます`);
    }
  };
}
