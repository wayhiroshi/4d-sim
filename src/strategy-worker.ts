import { runStrategy } from "./domain/strategy";
import { strategyRequestSchema } from "./shared/strategy";
import type { OrganizationSnapshot } from "./shared/types";

self.onmessage = async (event: MessageEvent<{ base: OrganizationSnapshot; request: unknown }>) => {
  try {
    const request = strategyRequestSchema.parse(event.data.request);
    const result = await runStrategy(event.data.base, request, (progress) => self.postMessage({ type: "progress", progress }));
    self.postMessage({ type: "result", result });
  } catch (error) { self.postMessage({ type: "error", error: error instanceof Error ? error.message : "計算に失敗しました" }); }
};
