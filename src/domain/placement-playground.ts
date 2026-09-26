import { actionSchema, blankMember, defaultPhase, strategyRequestSchema, type StrategySimulationRequest } from "../shared/strategy";
import type { OrganizationSnapshot } from "../shared/types";
import { placementNodes, applyPlacementOverrides } from "./strategy-placement";
import { planConfig } from "./plan";

/** Anonymous, memory-only starting point for comprehension testing. */
export function playgroundSample() {
  const period = "2026-09";
  const members = [blankMember("self", null, "sample", period), blankMember("sub", "self", "sample", period), blankMember("a", "self", "sample", period), blankMember("b", "self", "sample", period)];
  const names = ["あなた", "あなたのサブ", "Aさん", "Bさん"];
  members.forEach((m, i) => { m.displayName = names[i]!; m.course = "G"; m.sponsorLicense = true; });
  members[1]!.idKind = "sub"; members[1]!.masterMemberId = "self";
  const base: OrganizationSnapshot = { workspaceId: "sample", period, members, purchases: members.map(m => ({ id: `p-${m.id}`, workspaceId: "sample", memberId: m.id, period, productCode: null, quantity: 1, kind: "repeat", status: "confirmed", pv: 10670, price: 26340 })) };
  const phase = defaultPhase();
  const request = strategyRequestSchema.parse({ name: "操作確認用サンプル", rootId: "self", targetId: "self", partnerId: null, placementMode: "manual", goalBasis: "title", targetIds: 4999, horizonMonths: 120,
    leaders: ["self", "a", "b"].map(id => ({ id: `growth-${id}`, name: members.find(m => m.id === id)!.displayName, existingMemberId: id, introducerId: "self", placementId: id, startMonth: 1, initialTeam: 0, leaderCourse: "G", ...(id === "self" ? {} : {potentialDownlineIds: 300}), licenseAfterMonths: 12, phases: [structuredClone(phase)] })),
    ownedMonthlyCosts: {}, courseMonthlyCosts: { A: 9950, B: 19900, F: 13170, G: 26340, I: 0 }, taxes: { self: { invoiceRegistered: true, withholdingRate: 0, transferFee: 0, offsets: 0, priorCarryover: 0 } } });
  return { base, request };
}

export function addPlaygroundPerson(input: StrategySimulationRequest, parentId: string, name: string, potential: number) {
  if (!Number.isInteger(potential) || potential < 0 || potential > 4999) throw new Error("配下の見込みは0〜4,999 IDで入力してください");
  const phase = defaultPhase();
  let serial = 1; while (input.leaders.some(l => l.id === `added-${serial}`)) serial++;
  return strategyRequestSchema.parse({ ...input, leaders: [...input.leaders, { id: `added-${serial}`, name: name.trim() || "新しい人", existingMemberId: null, introducerId: input.rootId, placementId: parentId, startMonth: 1, initialTeam: 0, leaderCourse: "G", potentialDownlineIds: potential, licenseAfterMonths: 12, phases: [phase] }] });
}

/** Only future introductions change, not today's titles. */
export function setPlaygroundSubDr(input: StrategySimulationRequest, enabled: boolean, memberId = "sub") {
  const growthPriority = input.growthPriority.filter(p => p.memberId !== memberId);
  if (enabled) growthPriority.unshift({ memberId, title: "DR" });
  return strategyRequestSchema.parse({ ...input, growthPriority, allowIntroducerIdChoice: enabled || growthPriority.length > 0 });
}

export function addPlaygroundSub(base: OrganizationSnapshot, input: StrategySimulationRequest, parentId: string, name: string) {
  const nodes = placementNodes(base, input);
  if (nodes.filter(n => n.sub && n.ownerId === input.rootId).length >= planConfig.maxSubIdsPerMaster) throw new Error(`自分のサブは合計${planConfig.maxSubIdsPerMaster} IDまでです`);
  if (!nodes.some(n => n.id === parentId)) throw new Error("追加先が見つかりません");
  let serial = 1; while (nodes.some(n => n.id === `trial-sub-${serial}`)) serial++;
  const memberId = `trial-sub-${serial}`;
  const next = strategyRequestSchema.parse({ ...input, allowSubCreation: true, actions: [...input.actions,
    actionSchema.parse({id:`create-${memberId}`,kind:"create-sub",month:1,memberId,parentId,ownerId:input.rootId,requiredMemberId:null,displayName:name.trim() || `自分のサブ ${nodes.filter(n => n.sub && n.ownerId === input.rootId).length + 1}`,course:"G"}),
    actionSchema.parse({id:`license-${memberId}`,kind:"qualification",month:13,memberId,parentId:null,ownerId:input.rootId,requiredMemberId:null,sponsorLicense:true})] });
  applyPlacementOverrides(base, next);
  return next;
}
