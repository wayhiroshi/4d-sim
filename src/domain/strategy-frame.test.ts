import { expect, it } from "vitest";
import { strategyFixture } from "../test/strategy-fixture";
import { candidateStrategies, simulateStrategy } from "./strategy";
import { strategyFrame } from "./strategy-frame";

it("synchronizes every month's count, title and tree and never substitutes a future tree", () => {
  const { base, request } = strategyFixture(1);
  const iterator = simulateStrategy(base, request, candidateStrategies(base, request)[0]!, "standard");
  let step = iterator.next(); while (!step.done) step = iterator.next();
  const result = step.value;
  for (const row of result.months) {
    const frame = strategyFrame(result, row.month);
    expect(frame.row).toBe(row);
    expect(frame.organization!.find(n => n.id === "root")!.active).toBe(row.count);
    expect(frame.organization!.find(n => n.id === "root")!.title).toBe(row.targetTitle);
  }
  const old = structuredClone(result); old.months.forEach(row => delete row.organization);
  expect(strategyFrame(old, 2).organization).toBeNull();
  expect(strategyFrame(result, 999)).toEqual({ row: null, organization: null });
});
