import {describe,it,expect} from "vitest";
import {strategyFixture} from "../test/strategy-fixture";
import {candidateStrategies,priorityTarget,simulateStrategy,validateStrategyBase} from "./strategy";
import {combinationAlternatives,placementAlternatives,priorityAlternatives,rankAlternatives} from "./strategy-alternatives";
import {applyPlacementOverrides} from "./strategy-placement";
import {blankMember, strategyRequestSchema, type StrategySimulationRequest} from "../shared/strategy";
import type {OrganizationSnapshot} from "../shared/types";

function simulate(base:OrganizationSnapshot,request:StrategySimulationRequest) {
  const placed=applyPlacementOverrides(base,request);
  const generator=simulateStrategy(placed,request,candidateStrategies(placed,request)[0]!,"standard",base);
  for(;;){const step=generator.next();if(step.done)return step.value;}
}
describe("rapid alternative comparison",()=>{
  it("achieves LD then DR for the prioritized sub and only then develops the next sub",()=>{
    const {base,request}=strategyFixture(1);
    request.horizonMonths=24;
    request.leaders[0]!.existingMemberId="root";
    for(const b of ["standard","conservative","challenge"] as const) request.leaders[0]!.phases[0]!.rates[b].introductions=6;
    const original=JSON.stringify({base,request});
    const option=priorityAlternatives(base,request,{prepareQualifications:true,assignIntroducer:true}).find(o=>o.request.growthPriority.map(p=>p.memberId).join(",")==="sub1,sub2")!;
    const result=simulate(base,option.request);
    const first=result.months.find(m=>m.ids.find(i=>i.id==="sub1")?.acquiredTitle==="DR")!;
    const second=result.months.find(m=>m.ids.find(i=>i.id==="sub2")?.acquiredTitle==="DR")!;
    expect(first).toBeDefined();expect(second).toBeDefined();
    expect(first.month).toBeLessThan(second.month);
    expect(result.months[1]!.ids.find(i=>i.id==="sub1")!.title).toBe("LD");
    expect(result.months[first.month-1]!.organization!.find(n=>n.id==="sub2")!.count).toBe(0);
    expect(result.months.at(-1)!.ids.find(i=>i.id==="sub1")!.cost).toBe(request.courseMonthlyCosts.G);
    expect(JSON.stringify({base,request})).toBe(original);
  });
  it("explains blocked course and direct-introduction conditions instead of silently awarding DR",()=>{
    const {base,request}=strategyFixture(1);
    request.leaders[0]!.existingMemberId="root";
    request.leaders[0]!.phases[0]!.rates.standard.introductions=20;
    request.growthPriority=[{memberId:"sub1",title:"DR"}];
    const result=simulate(base,request);
    expect(result.months.at(-1)!.ids.find(i=>i.id==="sub1")!.acquiredTitle).not.toBe("DR");
    expect(result.warnings.some(w=>w.includes("sub1")&&w.includes("本人がB・Gコース"))).toBe(true);
    expect(result.warnings.some(w=>w.includes("sub1")&&w.includes("直紹介者"))).toBe(true);
  });
  it("enumerates all 27 assignments, including both concentrated sub plans, without editing inputs",()=>{
    const {base,request}=strategyFixture(); const original=JSON.stringify({base,request});
    const candidates=candidateStrategies(base,{...request,placementMode:"search"});
    expect(candidates).toHaveLength(27);
    for(const id of ["sub1","sub2"])expect(candidates.some(c=>Object.values(c.placements).every(parent=>parent===id))).toBe(true);
    const combos=combinationAlternatives(base,request);
    expect(combos).toMatchObject({exhaustive:true,total:27,movableTeams:3});
    expect(combos.options).toHaveLength(27);
    expect(JSON.stringify({base,request})).toBe(original);
  });
  it("ranks actual monthly household cashflow against an independent full enumeration",()=>{
    const {base,request}=strategyFixture();
    const rows=combinationAlternatives(base,request).options.map(o=>({...o,result:simulate(base,o.request)}));
    const independent:number[]=[];
    for(const a of ["root","sub1","sub2"])for(const b of ["root","sub1","sub2"])for(const c of ["root","sub1","sub2"]) {
      const parents=[a,b,c];
      independent.push(simulate(base,{...request,leaders:request.leaders.map((l,i)=>({...l,placementId:parents[i]!}))}).months.find(m=>m.month===12)!.recurringCashflow);
    }
    expect(new Set(independent).size).toBeGreaterThan(1);
    const ranked=rankAlternatives(rows,12,"income");
    expect(ranked[0]!.result.months.find(m=>m.month===12)!.recurringCashflow).toBe(Math.max(...independent));
    expect(rankAlternatives([...rows].reverse(),12,"income")).toEqual(ranked);
  },15000);
  it("keeps concentrated sub candidates in a larger bounded search",()=>{
    const {base,request}=strategyFixture(5);
    const candidates=candidateStrategies(base,{...request,placementMode:"search"});
    const combos=combinationAlternatives(base,request);
    expect(combos.exhaustive).toBe(false);
    for(const id of ["sub1","sub2"]){
      expect(candidates.some(c=>Object.values(c.placements).every(p=>p===id))).toBe(true);
      expect(combos.options.some(o=>o.request.leaders.every(l=>l.placementId===id))).toBe(true);
    }
  });
  it("excludes illegal moves and moves an intact nested team",()=>{
    const {base,request}=strategyFixture(2);
    request.leaders[1]!.placementId="strategy-team0";
    const combos=combinationAlternatives(base,request);
    expect(combos.movableTeams).toBe(1);
    for(const option of combos.options)expect(option.request.leaders[1]!.placementId).toBe("strategy-team0");
    request.allowIntroducerIdChoice=true;
    expect(placementAlternatives(base,request,"strategy-team0").every(o=>o.request.allowIntroducerIdChoice)).toBe(true);
    base.members.push(...Array.from({length:7},(_,i)=>blankMember(`child${i}`,"sub1","demo",base.period)));
    expect(placementAlternatives(base,request,"strategy-team0").some(o=>o.request.leaders[0]!.placementId==="sub1")).toBe(false);
    expect(placementAlternatives(base,request,"root")).toHaveLength(1);
  });
  it("switches sequential priorities only after acquisition and keeps ownership separate",()=>{
    const {base,request}=strategyFixture(1);
    request.growthPriority=[{memberId:"sub1",title:"DR"},{memberId:"sub2",title:"DR"}];
    expect(priorityTarget(base,request,"root",new Map())).toBe("sub1");
    expect(priorityTarget(base,request,"root",new Map([["sub1","DR"]]))).toBe("sub2");
    expect(priorityTarget(base,request,"root",new Map([["sub1","DR"],["sub2","SD"]]))).toBe("root");
    expect(priorityTarget(base,request,"partner",new Map())).toBeNull();
    expect(()=>validateStrategyBase(base,{...request,growthPriority:[request.growthPriority[0]!,request.growthPriority[0]!]})).toThrow("重複");
    expect(()=>validateStrategyBase(base,{...request,growthPriority:[{memberId:"outside",title:"DR"}]})).toThrow("所有ID");
  });
  it("routes future introductions, not existing people, with the same growth and target ID",()=>{
    const {base,request}=strategyFixture(1);
    request.leaders[0]!.existingMemberId="root";
    request.leaders[0]!.phases[0]!.rates.standard.introductions=0.25;
    const current=simulate(base,request);
    const options=priorityAlternatives(base,request);
    expect(options).toHaveLength(10);
    const sub=options.find(o=>o.request.growthPriority[0]?.memberId==="sub1")!;
    expect(sub.request.targetId).toBe(request.targetId);
    expect(sub.request.leaders).toEqual(request.leaders);
    const result=simulate(base,sub.request);
    expect(result.months.map(m=>m.count)).toEqual(current.months.map(m=>m.count));
    expect(result.finalOrganization.find(n=>n.id==="sub1")!.count).toBe(3);
    expect(current.finalOrganization.find(n=>n.id==="sub1")!.count).toBe(0);
    expect(sub.request.allowIntroducerIdChoice).toBe(request.allowIntroducerIdChoice);
    expect(sub.request.leaders[0]!.introducerId).toBe("root");
    // Referral commission stays with the original introducer even when placed
    // below the sub; placement and referral are different relationships.
    const rootStart=result.months[4]!.ids.find(m=>m.id==="root")!.start;
    expect(rootStart).toBeGreaterThan(0);
    expect(rootStart).toBe(current.months[4]!.ids.find(m=>m.id==="root")!.start);
    expect(result.months[4]!.ids.find(m=>m.id==="sub1")!.start).toBe(0);
  });
  it("defaults old saved requests to no priority",()=>{
    const {request}=strategyFixture();const {growthPriority,...old}=request;
    expect(strategyRequestSchema.parse(old).growthPriority).toEqual([]);
  });
  it("does not erase one's priorities while comparing the partner's sub",()=>{
    const {base,request}=strategyFixture(1);
    base.members.push(blankMember("partner","root","demo",base.period),{...blankMember("partner-sub","partner","demo",base.period),idKind:"sub",masterMemberId:"partner"});
    request.partnerId="partner";
    request.leaders[0]!.existingMemberId="root";
    request.leaders.push({...structuredClone(request.leaders[0]!),id:"partner-growth",existingMemberId:"partner",placementId:"partner",introducerId:"partner"});
    request.growthPriority=[{memberId:"sub1",title:"DR"}];
    const option=priorityAlternatives(base,request).find(o=>o.request.growthPriority.length===2&&o.request.growthPriority.at(-1)?.memberId==="partner-sub")!;
    expect(option.request.growthPriority).toEqual([{memberId:"sub1",title:"DR"},{memberId:"partner-sub",title:"DR"}]);
    expect(priorityTarget(base,option.request,"root",new Map())).toBe("sub1");
    expect(priorityTarget(base,option.request,"partner",new Map())).toBe("partner-sub");
  });
});
