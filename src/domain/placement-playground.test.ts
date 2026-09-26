import { expect, it } from "vitest";
import { playgroundSample, addPlaygroundPerson, addPlaygroundSub, setPlaygroundSubDr } from "./placement-playground";
import { applyPlacementOverrides, movePlacement, placementNodes, placementError } from "./strategy-placement";
import { candidateStrategies, simulateStrategy } from "./strategy";
import type { StrategySimulationRequest } from "../shared/strategy";

function calculate(request: StrategySimulationRequest) {
  const original = playgroundSample().base;
  const base = applyPlacementOverrides(original, request);
  const iterator = simulateStrategy(base, request, candidateStrategies(base, request)[0]!, "standard", original);
  for (;;) { const step = iterator.next(); if (step.done) return step.value; }
}
it("adds then moves a whole trial team without touching the starting organization or growth assumptions", () => {
  const {base,request} = playgroundSample(), initial = JSON.stringify({base,request});
  const sub = addPlaygroundPerson(request, "sub", "Cさん", 100);
  const main = movePlacement(base, sub, "strategy-added-1", "self");
  expect(main.leaders.at(-1)!.placementId).toBe("self");
  expect(main.leaders.at(-1)!.introducerId).toBe("self");
  expect(main.leaders.at(-1)!.phases).toEqual(sub.leaders.at(-1)!.phases);
  expect(JSON.stringify({base,request})).toBe(initial);
  const a = calculate(sub), b = calculate(main);
  expect(a.months[120]!.count).toBe(b.months[120]!.count);
  expect(a.months[120]!.recurring).not.toBe(b.months[120]!.recurring);
  expect(a.months[120]!.ids.reduce((s,i) => s+i.recurring,0)).toBe(a.months[120]!.recurring);
  expect(calculate(request)).toEqual(calculate(playgroundSample().request));
});
it("handles blank names, invalid potentials and prohibited moves", () => {
  const {base,request} = playgroundSample();
  expect(addPlaygroundPerson(request,"sub"," ",100).leaders.at(-1)!.name).toBe("新しい人");
  for (const n of [-1, 5000, 1.5, NaN]) expect(() => addPlaygroundPerson(request,"sub","C",n)).toThrow();
  expect(placementError(placementNodes(base,request),"self","sub","self")).not.toBeNull();
});

it("earns sub DR through future growth without changing today's title and restores the original scenario", () => {
  const {base,request} = playgroundSample(), original = JSON.stringify({base,request});
  const priority = setPlaygroundSubDr(request, true);
  expect(priority.growthPriority).toEqual([{ memberId: "sub", title: "DR" }]);
  expect(priority.allowIntroducerIdChoice).toBe(true);
  const normal = calculate(request), developed = calculate(priority);
  expect(normal.months[120]!.ids.find(i => i.id === "sub")!.title).toBe("NONE");
  expect(developed.months[0]!.ids.find(i => i.id === "sub")!.title).toBe("NONE");
  expect(developed.months.some(m => m.ids.some(i => i.id === "sub" && i.title === "DR"))).toBe(true);
  expect(developed.months[120]!.recurring).not.toBe(normal.months[120]!.recurring);
  expect(developed.months[120]!.recurring).toBe(developed.months[120]!.ids.reduce((sum,i) => sum+i.recurring,0));
  expect(setPlaygroundSubDr(priority, false)).toEqual(request);
  expect(setPlaygroundSubDr(priority, true)).toEqual(priority);
  expect(JSON.stringify({base,request})).toBe(original);
});

it("adds a named owned sub next month and includes its income and purchase cost without adding a new recruiter", () => {
  const {base,request} = playgroundSample(), original = JSON.stringify({base,request});
  const added = addPlaygroundSub(base,request,"self","サブ2");
  expect(added.leaders).toEqual(request.leaders);
  expect(placementNodes(base,added).find(n => n.id === "trial-sub-1")).toMatchObject({name:"サブ2",ownerId:"self",sub:true,planned:true});
  const result = calculate(added);
  expect(result.months[0]!.ids.some(i => i.id === "trial-sub-1")).toBe(false);
  const joined = result.months[1]!;
  // The engine includes initial + repeat purchases in the joining month.
  expect(joined.ids.find(i => i.id === "trial-sub-1")).toMatchObject({name:"サブ2",ownerId:"self",cost:52680});
  expect(joined.costs).toBe(26340 * 4);
  expect(result.months[2]!.costs).toBe(26340 * 3);
  expect(joined.recurring).toBe(joined.ids.reduce((sum,i) => sum+i.recurring,0));
  expect(joined.recurringCashflow).toBe(joined.recurringNet-joined.costs);
  expect(JSON.stringify({base,request})).toBe(original);
  const priority = setPlaygroundSubDr(added,true,"trial-sub-1");
  const grown = calculate(priority);
  expect(grown.months.some(m => m.ids.some(i => i.id === "trial-sub-1" && i.title === "DR"))).toBe(true);
  expect(grown.months[0]).toEqual(result.months[0]);
});

it("permits five total owned subs and keeps each priority setting independent", () => {
  const {base,request} = playgroundSample(); let next = request;
  for (let i=0;i<4;i++) next = addPlaygroundSub(base,next,"self","");
  expect(placementNodes(base,next).filter(n=>n.sub)).toHaveLength(5);
  expect(() => addPlaygroundSub(base,next,"self","")).toThrow("5 ID");
  expect(new Set(next.actions.map(a => a.id)).size).toBe(next.actions.length);
  const both = setPlaygroundSubDr(setPlaygroundSubDr(next,true),true,"trial-sub-1");
  expect(setPlaygroundSubDr(both,false,"trial-sub-1").growthPriority).toEqual([{memberId:"sub",title:"DR"}]);
});

it("lets a new sub receive an existing team and follows a planned parent without breaking undo", () => {
  const {base,request} = playgroundSample();
  const withPerson = addPlaygroundPerson(request,"self","C",100);
  const added = addPlaygroundSub(base,withPerson,"strategy-added-1","サブ2");
  const moved = movePlacement(base,added,"a","trial-sub-1");
  const result = calculate(moved);
  expect(result.months[1]!.organization!.find(n=>n.id==="trial-sub-1")!.parentId).toBe("strategy-added-1");
  expect(result.months[1]!.organization!.find(n=>n.id==="a")!.parentId).toBe("trial-sub-1");
  expect(result.months[0]!.organization!.find(n=>n.id==="a")!.parentId).toBe("self");
  expect(calculate(withPerson).months[1]!.ids.some(i=>i.id==="trial-sub-1")).toBe(false);
});
