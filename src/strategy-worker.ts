import { candidateStrategies, runStrategy, simulateStrategy, validateStrategyBase } from "./domain/strategy";
import { applyPlacementOverrides } from "./domain/strategy-placement";
import { StrategyCache } from "./domain/strategy-cache";
import { STRATEGY_VERSION, strategyRequestSchema, type Band, type StrategySimulationResult, type StrategyVariantResult } from "./shared/strategy";
import type { OrganizationSnapshot } from "./shared/types";

const cache = new StrategyCache<StrategySimulationResult | StrategyVariantResult>(32);
let latest = 0;
self.onmessage = async (event: MessageEvent<{ job: number; base: OrganizationSnapshot; request: unknown; mode?: "preview"; band?: Band }>) => {
  const { job, base, mode, band = "standard" } = event.data;
  latest = job;
  const started = performance.now();
  const send = (message: Record<string, unknown>) => { if (latest === job) self.postMessage({ ...message, job }); };
  try {
    const request = strategyRequestSchema.parse(event.data.request);
    const key = JSON.stringify([STRATEGY_VERSION, mode ?? "full", band, base, request]);
    const cached = cache.get(key);
    if (cached) { send({ type: "result", result: cached, cached: true, elapsedMs: performance.now() - started }); return; }
    let result: StrategySimulationResult | StrategyVariantResult;
    if (mode === "preview") {
      validateStrategyBase(base, request);
      const manual = { ...request, placementMode: "manual" as const };
      const placed = applyPlacementOverrides(base, manual);
      const iterator = simulateStrategy(placed, manual, candidateStrategies(placed, manual)[0]!, band, base);
      for (;;) {
        if (latest !== job) return;
        const step = iterator.next(); if (step.done) { result = step.value; break; }
        if (step.value % 6 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    } else result = await runStrategy(base, request, progress => send({ type: "progress", progress }), () => latest !== job);
    if (latest !== job) return;
    cache.set(key, result);
    send({ type: "result", result, cached: false, elapsedMs: performance.now() - started });
  } catch (error) { send({ type: "error", error: error instanceof Error ? error.message : "計算に失敗しました" }); }
};
