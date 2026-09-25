import { TITLE_ORDER } from "../shared/types";
import type { StrategyMonth, StrategySimulationRequest, StrategyVariantResult } from "../shared/strategy";

export type ComparisonBasis = "title" | "members" | "month";
export function comparisonPoint(result: StrategyVariantResult | undefined, input: StrategySimulationRequest, basis: ComparisonBasis, value: number): StrategyMonth | null {
  if (!result) return null;
  if (basis === "month") return result.months.find(m => m.month === value) ?? null;
  if (basis === "members") return result.months.find(m => m.count >= value) ?? null;
  const rank = TITLE_ORDER.indexOf(input.targetTitle);
  return result.months.find(m => TITLE_ORDER.indexOf(m.targetTitle) >= rank) ?? null;
}

/** Exclude labels and placement-only changes, not growth/qualification/tax assumptions. */
export function sameGrowthAssumptions(a: StrategySimulationRequest, b: StrategySimulationRequest): boolean {
  const normalize = (x: StrategySimulationRequest) => ({ ...x, name: "", placementOverrides: {},
    leaders: x.leaders.map(l => ({ ...l, name: "", placementId: "" })) });
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function incomeDifferences(before: StrategyMonth, after: StrategyMonth) {
  const ids = [...new Set([...before.ids.map(i => i.id), ...after.ids.map(i => i.id)])];
  return ids.map(id => {
    const a = before.ids.find(i => i.id === id), b = after.ids.find(i => i.id === id);
    return { id, name: b?.name ?? a!.name, beforeTitle: a?.title ?? "NONE", afterTitle: b?.title ?? "NONE",
      line: (b?.line ?? 0) - (a?.line ?? 0), director: (b?.director ?? 0) - (a?.director ?? 0), title: (b?.titleBonus ?? 0) - (a?.titleBonus ?? 0),
      recurring: (b?.recurring ?? 0) - (a?.recurring ?? 0) };
  });
}
