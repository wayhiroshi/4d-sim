import type { OrganizationSnapshot } from "../shared/types";
import { actionSchema, type StrategySimulationRequest, type StrategyVariantResult } from "../shared/strategy";
import { applyPlacementOverrides, movePlacement, placementNodes, placementError } from "./strategy-placement";

export type Alternative = { label: string; request: StrategySimulationRequest };
export function ownedTargets(base: OrganizationSnapshot, input: StrategySimulationRequest) {
  const owners = [input.rootId, ...(input.partnerId ? [input.partnerId] : [])];
  return base.members.filter(m => (owners.includes(m.id) || owners.includes(m.masterMemberId ?? "")) && m.joinedPeriod <= base.period && (!m.endedPeriod || m.endedPeriod > base.period)).sort((a,b) => a.id.localeCompare(b.id, "en"));
}
export function placementAlternatives(base: OrganizationSnapshot, input: StrategySimulationRequest, source: string): Alternative[] {
  const nodes = placementNodes(base, input);
  return [{ label: "現在の案", request: input }, ...ownedTargets(base,input).filter(m => !placementError(nodes, source, m.id, input.rootId)).map(m => ({ label: `${m.displayName}の下へ`, request: {...movePlacement(base,input,source,m.id),allowIntroducerIdChoice:input.allowIntroducerIdChoice} }))];
}
export function priorityAlternatives(base: OrganizationSnapshot, input: StrategySimulationRequest, assumptions = { prepareQualifications: false, assignIntroducer: false }): Alternative[] {
  const members = ownedTargets(base,input);
  const eligible = members.filter(m => input.leaders.some(l => l.existingMemberId === (m.masterMemberId ?? m.id)));
  const options: Alternative[] = [{ label: "現在の案", request: input }];
  for (const first of eligible) {
    const otherOwnerStages=input.growthPriority.filter(stage=>{
      const member=members.find(m=>m.id===stage.memberId);
      return member&&(member.masterMemberId??member.id)!==(first.masterMemberId??first.id);
    });
    options.push({label:`${first.displayName}をDRまで優先`,request:{...input,placementMode:"manual",growthPriority:[...otherOwnerStages,{memberId:first.id,title:"DR"}]}});
    for (const second of eligible) if (second.id !== first.id && (second.masterMemberId ?? second.id) === (first.masterMemberId ?? first.id))
      options.push({label:`${first.displayName} → ${second.displayName}の順でDR`,request:{...input,placementMode:"manual",growthPriority:[...otherOwnerStages,{memberId:first.id,title:"DR"},{memberId:second.id,title:"DR"}]}});
  }
  return options.map((option, index) => {
    if (index === 0) return option;
    const request = { ...option.request, actions: [...option.request.actions], allowIntroducerIdChoice: assumptions.assignIntroducer || input.allowIntroducerIdChoice };
    if (assumptions.prepareQualifications) for (const stage of request.growthPriority) {
      const member = members.find(m => m.id === stage.memberId)!;
      for (const kind of ["change-course", "qualification"] as const) {
        // An explicitly entered future schedule takes precedence over this shortcut.
        if (request.actions.some(a => a.memberId === member.id && a.kind === kind)) continue;
        if (kind === "change-course" ? member.course === "B" || member.course === "G" : member.sponsorLicense) continue;
        request.actions.push(actionSchema.parse({ id: `prepare-${kind}-${member.id}`, kind, month: 1, memberId: member.id, parentId: null, ownerId: null, requiredMemberId: null, course: "G", sponsorLicense: true }));
      }
    }
    return { ...option, request };
  });
}
export function combinationAlternatives(base: OrganizationSnapshot, input: StrategySimulationRequest) {
  const targets = ownedTargets(base,input);
  const freshIds = new Set(input.leaders.filter(l => !l.existingMemberId).map(l => `strategy-${l.id}`));
  const leaders = input.leaders.filter(l => !l.existingMemberId && !freshIds.has(l.placementId));
  const total = targets.length ** leaders.length;
  const exhaustive = total <= 64;
  const assignments: string[][] = [];
  if (exhaustive) {
    const enumerate = (prefix: string[]) => { if (prefix.length === leaders.length) { assignments.push(prefix); return; } for (const t of targets) enumerate([...prefix,t.id]); };
    enumerate([]);
  } else {
    for (let i=0;i<targets.length;i++) {
      assignments.push(leaders.map(() => targets[i]!.id));
      assignments.push(leaders.map((_,j) => targets[(i+j)%targets.length]!.id));
    }
  }
  const options: Alternative[] = [{ label:"現在の案",request:input }];
  for (const assignment of assignments) {
    const placements = new Map(leaders.map((l,i) => [l.id,assignment[i]!]));
    const request: StrategySimulationRequest = {...input,placementMode:"manual",leaders:input.leaders.map(l => ({...l,placementId:placements.get(l.id) ?? l.placementId}))};
    try { applyPlacementOverrides(base,request); } catch { continue; }
    if (options.some(o => JSON.stringify(o.request.leaders) === JSON.stringify(request.leaders))) continue;
    options.push({label:leaders.map((l,i)=>`${l.name}→${targets.find(t=>t.id===assignment[i])!.displayName}`).join(" / "),request});
  }
  return { options, exhaustive, total, movableTeams:leaders.length };
}
/** Same elapsed month for all alternatives; never compare different arrival dates as monthly deltas. */
export function rankAlternatives<T extends { result: StrategyVariantResult; label: string; request: StrategySimulationRequest }>(rows: T[], month: number, objective: "income" | "fastest") {
  const point = (r: T) => r.result.months.find(m => m.month === month);
  return [...rows].sort((a,b) => {
    const t = (a.result.titleMonth ?? Infinity) - (b.result.titleMonth ?? Infinity);
    const income = (point(b)?.recurringCashflow ?? -Infinity) - (point(a)?.recurringCashflow ?? -Infinity);
    const left=JSON.stringify(a.request), right=JSON.stringify(b.request);
    return (objective === "fastest" ? t || income : income || t) || (left<right?-1:left>right?1:0);
  });
}
