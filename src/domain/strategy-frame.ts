import type { StrategyVariantResult } from "../shared/strategy";

/** Never substitute a final tree or a different month for a missing frame. */
export function strategyFrame(variant: StrategyVariantResult | undefined, month: number) {
  const row = variant?.months.find(m => m.month === month) ?? null;
  const checkpoint = variant?.checkpoints.find(c => c.reachedMonth === month);
  const organization = row?.organization ?? (checkpoint?.organization.length ? checkpoint.organization : null);
  return { row, organization };
}

export function initialFrameMonth(variant: StrategyVariantResult | undefined) {
  return variant?.titleMonth ?? variant?.months.at(-1)?.month ?? 0;
}
