import { planConfig } from "./plan";
import {
  TITLE_ORDER,
  type BonusBreakdown,
  type ConditionResult,
  type ForecastResult,
  type ForecastScenario,
  type Member,
  type Mission,
  type OrganizationSnapshot,
  type PlacementBonusDelta,
  type PlacementResult,
  type PurchaseEvent,
  type SimulationMember,
  type SimulationRequest,
  type TaxProfile,
  type TitleCode,
  type TitleChecklistItem,
  type TitleEvaluation
} from "../shared/types";

const money = (value: number) => Math.round(value);

export function previousPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) throw new Error(`Invalid period: ${period}`);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextPeriod(period: string, offset = 1): string {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) throw new Error(`Invalid period: ${period}`);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodForDate(date: Date): string {
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (shifted.getUTCDate() < planConfig.businessMonthStartDay) shifted.setUTCMonth(shifted.getUTCMonth() - 1);
  const label = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1));
  return `${label.getUTCFullYear()}-${String(label.getUTCMonth() + 1).padStart(2, "0")}`;
}

function purchasesFor(snapshot: OrganizationSnapshot, memberId: string, period = snapshot.period): PurchaseEvent[] {
  return snapshot.purchases.filter(
    (purchase) => purchase.memberId === memberId && purchase.period === period && purchase.status === "confirmed"
  );
}

export function isActive(snapshot: OrganizationSnapshot, memberId: string, period = snapshot.period): boolean {
  return purchasesFor(snapshot, memberId, period).some((purchase) => purchase.kind === "repeat" || purchase.kind === "initial");
}

export function memberPv(snapshot: OrganizationSnapshot, memberId: string, period = snapshot.period): number {
  return purchasesFor(snapshot, memberId, period)
    .filter((purchase) => purchase.kind !== "initial")
    .reduce((sum, purchase) => sum + purchase.pv * purchase.quantity, 0);
}

function rawChildrenOf(snapshot: OrganizationSnapshot, memberId: string): Member[] {
  return snapshot.members.filter((member) => member.parentMemberId === memberId);
}

function childrenOf(snapshot: OrganizationSnapshot, memberId: string): Member[] {
  const output: Member[] = [];
  const queue = [...rawChildrenOf(snapshot, memberId)];
  const visited = new Set<string>();
  while (queue.length) {
    const member = queue.shift();
    if (!member || visited.has(member.id)) continue;
    visited.add(member.id);
    const ended = member.endedPeriod !== null && member.endedPeriod <= snapshot.period;
    if (ended && planConfig.compression.enabled && planConfig.compression.promoteEndedMembers) {
      queue.push(...rawChildrenOf(snapshot, member.id));
    } else if (!ended) output.push(member);
  }
  return output;
}

export function descendants(snapshot: OrganizationSnapshot, rootId: string): Array<{ member: Member; depth: number }> {
  const output: Array<{ member: Member; depth: number }> = [];
  const queue = childrenOf(snapshot, rootId).map((member) => ({ member, depth: 1 }));
  const visited = new Set<string>([rootId]);
  while (queue.length) {
    const item = queue.shift();
    if (!item || visited.has(item.member.id)) continue;
    visited.add(item.member.id);
    output.push(item);
    for (const child of childrenOf(snapshot, item.member.id)) queue.push({ member: child, depth: item.depth + 1 });
  }
  return output;
}

export function groupPv(snapshot: OrganizationSnapshot, rootId: string, period = snapshot.period): number {
  const descendantIds = new Set(descendants(snapshot, rootId).map(({ member }) => member.id));
  return snapshot.purchases
    .filter((purchase) => purchase.period === period && purchase.status === "confirmed")
    .filter((purchase) => purchase.kind !== "initial")
    .filter((purchase) => descendantIds.has(purchase.memberId) || (purchase.memberId === rootId && purchase.kind === "additional"))
    .reduce((sum, purchase) => sum + purchase.pv * purchase.quantity, 0);
}

export function groupPvThroughDepth(
  snapshot: OrganizationSnapshot,
  rootId: string,
  maxDepth: number,
  period = snapshot.period
): number {
  const includedIds = new Set(
    descendants(snapshot, rootId).filter((item) => item.depth <= maxDepth).map((item) => item.member.id)
  );
  return snapshot.purchases
    .filter((purchase) => purchase.period === period && purchase.status === "confirmed")
    .filter((purchase) => purchase.kind !== "initial")
    .filter((purchase) => includedIds.has(purchase.memberId) || (purchase.memberId === rootId && purchase.kind === "additional"))
    .reduce((sum, purchase) => sum + purchase.pv * purchase.quantity, 0);
}

function lineCounts(snapshot: OrganizationSnapshot, rootId: string): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const item of descendants(snapshot, rootId)) {
    if (isActive(snapshot, item.member.id)) counts[item.depth] = (counts[item.depth] ?? 0) + 1;
  }
  return counts;
}

function directIntroductions(snapshot: OrganizationSnapshot, rootId: string, activeOnly = false, includeSub = false): Member[] {
  return snapshot.members.filter((member) => {
    if (member.introducerMemberId !== rootId || (!includeSub && member.idKind === "sub") || (member.endedPeriod !== null && member.endedPeriod <= snapshot.period)) return false;
    return !activeOnly || isActive(snapshot, member.id);
  });
}

function titleAtLeast(title: TitleCode, required: TitleCode): boolean {
  return TITLE_ORDER.indexOf(title) >= TITLE_ORDER.indexOf(required);
}

function directTitleCount(snapshot: OrganizationSnapshot, rootId: string, required: TitleCode): number {
  return childrenOf(snapshot, rootId).filter((member) => isActive(snapshot, member.id) && titleAtLeast(member.title, required)).length;
}

function boolCondition(key: string, label: string, current: boolean, required = true): ConditionResult {
  return { key, label, current, required, met: current === required };
}

function numberCondition(key: string, label: string, current: number, required: number): ConditionResult {
  return { key, label, current, required, met: current >= required };
}

function computeTitleConditions(snapshot: OrganizationSnapshot, rootId: string): {
  achievedTitle: TitleCode;
  conditionsByTitle: Map<Exclude<TitleCode, "NONE">, ConditionResult[]>;
  directorAlternatives: NonNullable<TitleChecklistItem["alternatives"]>;
} {
  const root = snapshot.members.find((member) => member.id === rootId);
  if (!root) throw new Error(`Member not found: ${rootId}`);
  const counts = lineCounts(snapshot, rootId);
  const totalMembers = descendants(snapshot, rootId).filter((item) => isActive(snapshot, item.member.id)).length;
  const currentGroupPv = groupPv(snapshot, rootId);
  const currentDirectorPv = groupPvThroughDepth(snapshot, rootId, 3);
  const previousDirectorPv = groupPvThroughDepth(snapshot, rootId, 3, previousPeriod(snapshot.period));
  const activeDirectCount = directIntroductions(snapshot, rootId, true, true).length;
  const activeTitleDirectCount = directIntroductions(snapshot, rootId, true, false).length;
  const rootActive = isActive(snapshot, rootId);
  const ldConditions: ConditionResult[] = [
    boolCondition("active", "本人が当月アクティブ", rootActive),
    numberCondition("ld-first", "1次ラインのアクティブ人数", counts[1] ?? 0, planConfig.ld.firstLineActive),
    numberCondition("ld-second", "2次ラインのアクティブ人数", counts[2] ?? 0, planConfig.ld.secondLineActive),
    numberCondition("ld-direct", "当月アクティブの直紹介者", activeDirectCount, planConfig.ld.directActive)
  ];
  const ldMet = ldConditions.every((condition) => condition.met);

  const directorPattern1Conditions = [
    numberCondition("director-p1-first", "1次ラインのアクティブ人数", counts[1] ?? 0, planConfig.director.pattern1.first),
    numberCondition("director-p1-second", "2次ラインのアクティブ人数", counts[2] ?? 0, planConfig.director.pattern1.second),
    numberCondition("director-p1-third", "3次ラインのアクティブ人数", counts[3] ?? 0, planConfig.director.pattern1.third),
    numberCondition("director-p1-pv", "1〜3次ラインの2か月累計p.v.", currentDirectorPv + previousDirectorPv, planConfig.director.pattern1.rollingTwoMonthPv)
  ];
  const directorPattern1 = directorPattern1Conditions.every((condition) => condition.met);
  const ownedIdCount = 1 + snapshot.members.filter((member) => member.masterMemberId === rootId && member.idKind === "sub").length;
  const pattern2IdEligible = !planConfig.director.pattern2ExcludesSevenOrMoreIds || ownedIdCount < 7;
  const directorPattern2Conditions: ConditionResult[] = [
    numberCondition("director-p2-lines", "1・2次ラインのアクティブ合計", (counts[1] ?? 0) + (counts[2] ?? 0), planConfig.director.pattern2.firstTwoLineTotal),
    boolCondition(
      "director-p2-pv",
      `当月 ${currentDirectorPv} / ${planConfig.director.pattern2.currentPv} p.v. または2か月 ${currentDirectorPv + previousDirectorPv} / ${planConfig.director.pattern2.rollingTwoMonthPv} p.v.`,
      currentDirectorPv >= planConfig.director.pattern2.currentPv || currentDirectorPv + previousDirectorPv >= planConfig.director.pattern2.rollingTwoMonthPv
    )
  ];
  if (planConfig.director.pattern2ExcludesSevenOrMoreIds) {
    directorPattern2Conditions.unshift(boolCondition("director-p2-id", "保有ID数の条件", pattern2IdEligible));
  }
  const directorPattern2 = directorPattern2Conditions.every((condition) => condition.met);
  const directorAcquisitionAlternatives: NonNullable<TitleChecklistItem["alternatives"]> = [
    { label: "取得パターン1", met: directorPattern1, conditions: directorPattern1Conditions },
    { label: "取得パターン2", met: directorPattern2, conditions: directorPattern2Conditions }
  ];
  const acquisitionConditions: ConditionResult[] = [
    boolCondition("director-course", "本人がB・Gコース", root.course === "B" || root.course === "G"),
    boolCondition("director-license", "スポンサーライセンス", root.sponsorLicense),
    numberCondition("director-direct", "当月アクティブの直紹介者", activeDirectCount, planConfig.director.directActive),
    boolCondition("director-ld", "本人がLD条件を達成", ldMet),
    boolCondition("director-pattern", "ディレクター構成パターン1または2", directorPattern1 || directorPattern2)
  ];
  const followingPromotionMonth = planConfig.director.promotionFollowingMonthMaintenanceException &&
    root.directorPromotedPeriod !== null && nextPeriod(root.directorPromotedPeriod) === snapshot.period;
  const maintenanceConditions: ConditionResult[] = [
    boolCondition("active", "本人が当月アクティブ", rootActive),
    boolCondition("director-course", "本人がB・Gコース", root.course === "B" || root.course === "G"),
    boolCondition(
      "director-maintenance",
      followingPromotionMonth ? "昇格翌月の維持特例" : "1〜3次ラインの当月p.v.維持条件",
      followingPromotionMonth || currentDirectorPv >= planConfig.director.maintenancePv
    )
  ];
  const alreadyDirector = titleAtLeast(root.title, "DR");
  const directorConditions = alreadyDirector ? maintenanceConditions : acquisitionConditions;
  const directorAlternatives = alreadyDirector ? [] : directorAcquisitionAlternatives;
  const directorMet = directorConditions.every((condition) => condition.met);
  const conditionsByTitle = new Map<Exclude<TitleCode, "NONE">, ConditionResult[]>([
    ["LD", ldConditions],
    ["DR", directorConditions]
  ]);

  let achievedTitle: TitleCode = ldMet ? "LD" : "NONE";
  for (const rule of planConfig.titles.filter((item) => !["LD", "DR"].includes(item.code))) {
    const conditions: ConditionResult[] = [
      boolCondition("active", "本人が当月アクティブ", rootActive),
      boolCondition(
        "prerequisite-title",
        rule.code === "LL" ? "本人がLD条件を達成" : "本人がDR条件を達成",
        rule.code === "LL" ? ldMet : directorMet
      ),
      numberCondition("direct", "当月アクティブの直紹介者数", activeTitleDirectCount, rule.directIntroductions),
      numberCondition("members", "グループ人数", totalMembers, rule.groupMembers ?? 0),
      numberCondition("pv", "グループp.v.", currentGroupPv, rule.groupPv ?? 0),
      numberCondition(
        "direct-title",
        `1次ラインの${rule.requiredDirectTitle ?? "対象"}人数`,
        rule.requiredDirectTitle ? directTitleCount(snapshot, rootId, rule.requiredDirectTitle) : 0,
        rule.requiredDirectTitleCount
      )
    ];
    conditionsByTitle.set(rule.code, conditions);
    if (conditions.every((condition) => condition.met)) achievedTitle = rule.code;
  }
  if (directorMet && TITLE_ORDER.indexOf(achievedTitle) < TITLE_ORDER.indexOf("DR")) achievedTitle = "DR";

  return { achievedTitle, conditionsByTitle, directorAlternatives };
}

export function evaluateTitle(snapshot: OrganizationSnapshot, rootId: string): TitleEvaluation {
  const { achievedTitle, conditionsByTitle } = computeTitleConditions(snapshot, rootId);

  const nextIndex = TITLE_ORDER.indexOf(achievedTitle) + 1;
  const nextTitle = TITLE_ORDER[nextIndex] ?? null;
  const nextConditions = nextTitle === null || nextTitle === "NONE" ? [] : conditionsByTitle.get(nextTitle) ?? [];
  const progress = nextConditions.length
    ? Math.round((nextConditions.filter((condition) => condition.met).length / nextConditions.length) * 100)
    : 100;
  return { achievedTitle, nextTitle, progress, conditions: nextConditions };
}

export function evaluateTitleChecklists(snapshot: OrganizationSnapshot, rootId: string): TitleChecklistItem[] {
  const { achievedTitle, conditionsByTitle, directorAlternatives } = computeTitleConditions(snapshot, rootId);
  const achievedIndex = TITLE_ORDER.indexOf(achievedTitle);
  const nextTitle = TITLE_ORDER[achievedIndex + 1] ?? null;
  return [...planConfig.titles].sort((a, b) => a.rank - b.rank).map((rule) => {
    const conditions = conditionsByTitle.get(rule.code) ?? [];
    const metCount = conditions.filter((condition) => condition.met).length;
    return {
      code: rule.code,
      label: rule.label,
      rank: rule.rank,
      status: TITLE_ORDER.indexOf(rule.code) <= achievedIndex ? "achieved" : rule.code === nextTitle ? "next" : "future",
      progress: conditions.length ? Math.round((metCount / conditions.length) * 100) : 100,
      conditions,
      ...(rule.code === "DR" && directorAlternatives.length ? { alternatives: directorAlternatives } : {})
    };
  });
}

function ratesFor(member: Member, evaluatedTitle: TitleCode): number[] {
  const titleRates = planConfig.lineRatesByTitle[evaluatedTitle]?.[member.course];
  if (titleRates) return titleRates;
  if (titleAtLeast(evaluatedTitle, "DR")) {
    const directorRates = planConfig.lineRatesByTitle.DR?.[member.course];
    if (directorRates) return directorRates;
  }
  if (titleAtLeast(evaluatedTitle, "LD")) {
    const ldRates = planConfig.lineRatesByTitle.LD?.[member.course];
    if (ldRates) return ldRates;
  }
  return planConfig.courses[member.course].baseLineRates;
}

export function computeLineBonus(snapshot: OrganizationSnapshot, rootId: string, forcedTitle?: TitleCode): number {
  const root = snapshot.members.find((member) => member.id === rootId);
  if (!root || !isActive(snapshot, rootId)) return 0;
  const title = forcedTitle ?? evaluateTitle(snapshot, rootId).achievedTitle;
  const rates = ratesFor(root, title);
  const ownAdditional = purchasesFor(snapshot, rootId)
    .filter((purchase) => purchase.kind === "additional")
    .reduce((sum, purchase) => sum + money(purchase.pv * purchase.quantity * (rates[0] ?? 0)), 0);
  return ownAdditional + descendants(snapshot, rootId).reduce((sum, item) => {
    const rate = rates[item.depth - 1] ?? 0;
    return sum + money(memberPv(snapshot, item.member.id) * rate);
  }, 0);
}

function computeStartBonus(snapshot: OrganizationSnapshot, rootId: string): number {
  return snapshot.purchases
    .filter((purchase) => purchase.period === snapshot.period && purchase.kind === "initial" && purchase.status === "confirmed")
    .filter((purchase) => snapshot.members.find((member) => member.id === purchase.memberId)?.introducerMemberId === rootId)
    .reduce((sum, purchase) => {
      const member = snapshot.members.find((item) => item.id === purchase.memberId);
      return sum + (member ? planConfig.courses[member.course].startBonus : 0);
    }, 0);
}

function computeTrainerBonus(snapshot: OrganizationSnapshot, rootId: string): number {
  const root = snapshot.members.find((member) => member.id === rootId);
  if (!root || !isActive(snapshot, rootId)) return 0;
  return snapshot.purchases
    .filter((purchase) => purchase.period === snapshot.period && purchase.kind === "initial" && purchase.status === "confirmed")
    .filter((purchase) => snapshot.members.find((member) => member.id === purchase.memberId)?.trainerMemberId === rootId)
    .reduce((sum, purchase) => {
      const member = snapshot.members.find((item) => item.id === purchase.memberId);
      if (!member) return sum;
      const role = member.trainerBonusRole
        ?? (root.trainerCredential === "PT" ? "PT" : root.trainerCredential === "ST" ? "ST_SOLO" : null);
      return role ? sum + planConfig.trainerBonuses[member.course][role] : sum;
    }, 0);
}

function computeDirectorBonus(snapshot: OrganizationSnapshot, rootId: string, title: TitleCode): number {
  if (!titleAtLeast(title, "DR")) return 0;
  const lineAtDirector = computeLineBonus(snapshot, rootId, "DR");
  const lineAtLd = computeLineBonus(snapshot, rootId, "LD");
  const directFifthPv = directIntroductions(snapshot, rootId, false, true).reduce((sum, direct) => {
    return sum + descendants(snapshot, direct.id)
      .filter((item) => item.depth === 5)
      .reduce((pv, item) => pv + memberPv(snapshot, item.member.id), 0);
  }, 0);
  const directorGroupBonus = title === "DR" ? computeGroupRateBonus(snapshot, rootId, title) : 0;
  return money(Math.max(0, lineAtDirector - lineAtLd) + directFifthPv * 0.04 + directorGroupBonus);
}

function computeGroupRateBonus(snapshot: OrganizationSnapshot, rootId: string, title: TitleCode): number {
  const rule = planConfig.titles.find((item) => item.code === title);
  if (!rule || rule.titleBonusRate <= 0) return 0;
  const ownAdditionalPv = purchasesFor(snapshot, rootId)
    .filter((purchase) => purchase.kind === "additional")
    .reduce((sum, purchase) => sum + purchase.pv * purchase.quantity, 0);
  let total = ownAdditionalPv * rule.titleBonusRate;
  const queue = childrenOf(snapshot, rootId).map((member) => ({
    member,
    rate: rule.titleBonusRate,
    sameRankDepth: 0
  }));
  const visited = new Set<string>();
  while (queue.length) {
    const item = queue.shift();
    if (!item || visited.has(item.member.id)) continue;
    visited.add(item.member.id);
    let rate = item.rate;
    let sameRankDepth = item.sameRankDepth;
    const childRule = planConfig.titles.find((candidate) => candidate.code === item.member.title);
    if (childRule) {
      if (childRule.code === rule.code) {
        sameRankDepth += 1;
        rate = rule.sameRankRates[sameRankDepth - 1] ?? 0;
      } else if (childRule.rank > rule.rank) {
        rate = 0;
      } else {
        rate = Math.max(0, rate - childRule.titleBonusRate);
      }
    }
    total += memberPv(snapshot, item.member.id) * rate;
    for (const child of childrenOf(snapshot, item.member.id)) queue.push({ member: child, rate, sameRankDepth });
  }
  return money(Math.max(0, total));
}

function computeTitleBonus(snapshot: OrganizationSnapshot, rootId: string, title: TitleCode): number {
  return title === "DR" ? 0 : computeGroupRateBonus(snapshot, rootId, title);
}

function invoiceTransitionDeduction(gross: number, period: string, invoiceRegistered: boolean): number {
  if (invoiceRegistered || gross <= 0) return 0;
  const date = `${period}-17`;
  const transition = planConfig.tax.invoiceTransitions.find((item) => date >= item.from && date <= item.to);
  if (!transition) return money(gross / 11);
  return money((gross / 11) * transition.disallowedInputTaxRate);
}

export function computeBonus(
  snapshot: OrganizationSnapshot,
  rootId: string,
  taxProfile: TaxProfile
): BonusBreakdown {
  if (!isActive(snapshot, rootId)) {
    return {
      start: 0, trainer: 0, line: 0, director: 0, title: 0, gross: 0,
      estimatedNet: taxProfile.priorCarryover, deductions: { invoiceTransition: 0, withholding: 0, transferFee: 0, offsets: taxProfile.offsets }, carryover: taxProfile.priorCarryover
    };
  }
  const evaluatedTitle = evaluateTitle(snapshot, rootId).achievedTitle;
  const start = computeStartBonus(snapshot, rootId);
  const trainer = computeTrainerBonus(snapshot, rootId);
  const line = titleAtLeast(evaluatedTitle, "DR")
    ? computeLineBonus(snapshot, rootId, "LD")
    : computeLineBonus(snapshot, rootId, evaluatedTitle);
  const director = computeDirectorBonus(snapshot, rootId, evaluatedTitle);
  const title = computeTitleBonus(snapshot, rootId, evaluatedTitle);
  const gross = money(start + trainer + line + director + title);
  const invoiceTransition = invoiceTransitionDeduction(gross, snapshot.period, taxProfile.invoiceRegistered);
  const withholding = money(Math.max(0, gross - taxProfile.offsets - invoiceTransition) * taxProfile.withholdingRate);
  const payable = gross + taxProfile.priorCarryover - taxProfile.offsets - invoiceTransition - withholding;
  const shouldCarry = payable > 0 && payable < planConfig.tax.paymentCarryoverThreshold;
  const transferFee = shouldCarry ? 0 : Math.min(taxProfile.transferFee, Math.max(0, payable));
  const estimatedNet = shouldCarry ? 0 : money(Math.max(0, payable - transferFee));
  return {
    start, trainer, line, director, title, gross, estimatedNet,
    deductions: { invoiceTransition, withholding, transferFee, offsets: taxProfile.offsets },
    carryover: shouldCarry ? money(payable) : 0
  };
}

function missingCount(evaluation: TitleEvaluation): number {
  return evaluation.conditions.filter((condition) => !condition.met).length;
}

const emptyPlacementBonusDelta = (): PlacementBonusDelta => ({
  start: 0, trainer: 0, line: 0, director: 0, title: 0,
  oneTime: 0, recurring: 0, gross: 0, estimatedNet: 0
});

function placementBonusDelta(before: BonusBreakdown, after: BonusBreakdown): PlacementBonusDelta {
  const start = after.start - before.start;
  const trainer = after.trainer - before.trainer;
  const line = after.line - before.line;
  const director = after.director - before.director;
  const title = after.title - before.title;
  return {
    start, trainer, line, director, title,
    oneTime: start + trainer,
    recurring: line + director + title,
    gross: after.gross - before.gross,
    estimatedNet: after.estimatedNet - before.estimatedNet
  };
}

function cloneWithCandidate(
  snapshot: OrganizationSnapshot,
  request: SimulationRequest,
  placementMemberId: string,
  suffix: string
): OrganizationSnapshot {
  const id = `simulation-${suffix}`;
  const candidate: Member = {
    id,
    workspaceId: snapshot.workspaceId,
    displayName: request.candidateName,
    parentMemberId: placementMemberId,
    introducerMemberId: snapshot.members.find((member) => member.parentMemberId === null)?.id ?? placementMemberId,
    masterMemberId: null,
    trainerMemberId: request.trainerBonusRole ? snapshot.members.find((member) => member.parentMemberId === null)?.id ?? null : null,
    trainerBonusRole: request.trainerBonusRole ?? null,
    idKind: "master",
    course: request.course,
    title: "NONE",
    trainerCredential: "NONE",
    sponsorLicense: false,
    directorPromotedPeriod: null,
    joinedPeriod: request.period,
    endedPeriod: null
  };
  const purchase: PurchaseEvent = {
    id: `purchase-${suffix}`,
    workspaceId: snapshot.workspaceId,
    memberId: id,
    period: request.period,
    productCode: null,
    kind: "initial",
    status: "confirmed",
    quantity: 1,
    price: 0,
    pv: planConfig.courses[request.course].recurringPv
  };
  const repeatPurchase: PurchaseEvent = {
    ...purchase,
    id: `repeat-${suffix}`,
    kind: "repeat"
  };
  return { ...snapshot, members: [...snapshot.members, candidate], purchases: [...snapshot.purchases, purchase, repeatPurchase] };
}

export function applySimulationMembers(
  snapshot: OrganizationSnapshot,
  simulationMembers: SimulationMember[]
): OrganizationSnapshot {
  const result: OrganizationSnapshot = {
    ...snapshot,
    members: [...snapshot.members],
    purchases: [...snapshot.purchases]
  };
  for (const item of simulationMembers) {
    if (item.period !== snapshot.period) continue;
    const candidate: Member = {
      id: item.id,
      workspaceId: snapshot.workspaceId,
      displayName: item.displayName,
      parentMemberId: item.parentMemberId,
      introducerMemberId: item.introducerMemberId,
      masterMemberId: null,
      trainerMemberId: item.trainerMemberId,
      trainerBonusRole: item.trainerBonusRole,
      idKind: "master",
      course: item.course,
      title: "NONE",
      trainerCredential: "NONE",
      sponsorLicense: false,
      directorPromotedPeriod: null,
      joinedPeriod: item.period,
      endedPeriod: null
    };
    const purchase: PurchaseEvent = {
      id: `simulation-initial-${item.id}`,
      workspaceId: snapshot.workspaceId,
      memberId: item.id,
      period: item.period,
      productCode: null,
      kind: "initial",
      status: "confirmed",
      quantity: 1,
      price: 0,
      pv: planConfig.courses[item.course].recurringPv
    };
    result.members.push(candidate);
    result.purchases.push(purchase, { ...purchase, id: `simulation-repeat-${item.id}`, kind: "repeat" });
  }
  return result;
}

export function simulatePlacements(snapshot: OrganizationSnapshot, request: SimulationRequest): PlacementResult[] {
  const root = snapshot.members.find((member) => member.parentMemberId === null);
  if (!root) throw new Error("Root member is required");
  const beforeTitle = evaluateTitle(snapshot, root.id);
  const beforeBonus = computeBonus(snapshot, root.id, request.taxProfile);
  const candidates = request.placementCandidateIds?.length
    ? snapshot.members.filter((member) => request.placementCandidateIds?.includes(member.id))
    : snapshot.members.filter((member) => member.endedPeriod === null);
  const results = candidates.map((placement, index): PlacementResult => {
    const firstLineCount = childrenOf(snapshot, placement.id).length;
    const eligible = firstLineCount < planConfig.firstLineLimit;
    if (!eligible) {
      return {
        placementMemberId: placement.id, placementMemberName: placement.displayName, eligible: false, rank: null,
        grossDelta: 0, estimatedNetDelta: 0, titleBefore: beforeTitle.achievedTitle, titleAfter: beforeTitle.achievedTitle,
        bonusDelta: emptyPlacementBonusDelta(),
        missingBefore: missingCount(beforeTitle), missingAfter: missingCount(beforeTitle), earliestAchievementPeriod: null,
        reasons: [], warnings: ["1次ライン上限7名に達しています"]
      };
    }
    const simulated = cloneWithCandidate(snapshot, request, placement.id, String(index + 1));
    const afterTitle = evaluateTitle(simulated, root.id);
    const afterBonus = computeBonus(simulated, root.id, request.taxProfile);
    const bonusDelta = placementBonusDelta(beforeBonus, afterBonus);
    const reasons = [
      `次タイトルの未達条件が${missingCount(beforeTitle)}件から${missingCount(afterTitle)}件になります`,
      `総ボーナス概算が${bonusDelta.gross >= 0 ? "+" : ""}${bonusDelta.gross}円変化します`
    ];
    if (afterTitle.achievedTitle !== beforeTitle.achievedTitle) reasons.unshift(`${afterTitle.achievedTitle}条件に到達します`);
    return {
      placementMemberId: placement.id,
      placementMemberName: placement.displayName,
      eligible: true,
      rank: null,
      grossDelta: bonusDelta.gross,
      estimatedNetDelta: bonusDelta.estimatedNet,
      bonusDelta,
      titleBefore: beforeTitle.achievedTitle,
      titleAfter: afterTitle.achievedTitle,
      missingBefore: missingCount(beforeTitle),
      missingAfter: missingCount(afterTitle),
      earliestAchievementPeriod: titleAtLeast(afterTitle.achievedTitle, request.targetTitle) ? request.period : null,
      reasons,
      warnings: [
        "参考シミュレーションです。登録後の配置は公式サイトで確認してください",
        ...(request.trainerBonusRole ? ["Aさん役の報酬は、該当トレーナー資格を有し申請書へ記載される場合の初回購入時のみです"] : []),
        ...(request.course === "I" && request.trainerBonusRole?.startsWith("ST") ? ["IコースはSトレーナー対象外のため、トレーナーボーナスは0円です"] : [])
      ]
    };
  });
  const eligible = results.filter((item) => item.eligible).sort((a, b) => {
    const targetA = a.earliestAchievementPeriod ? 0 : 1;
    const targetB = b.earliestAchievementPeriod ? 0 : 1;
    return targetA - targetB || a.missingAfter - b.missingAfter || b.grossDelta - a.grossDelta || a.placementMemberId.localeCompare(b.placementMemberId);
  });
  eligible.forEach((item, index) => { item.rank = index + 1; });
  return results.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)).slice(0, 3);
}

export function generateMissions(title: TitleEvaluation): Mission[] {
  const missions = title.conditions.filter((item) => !item.met).slice(0, 5).map((condition, index): Mission => ({
      id: `title-${condition.key}`,
      priority: 100 - index,
      category: "title",
      title: `${title.nextTitle ?? "次タイトル"}の不足条件を試算`,
      reason: `${condition.label}: 現在 ${String(condition.current)} / 必要 ${String(condition.required)}`,
      dueDate: null
    }));
  if (!missions.length) {
    missions.push({
      id: "data-review",
      priority: 10,
      category: "data",
      title: "次の試算条件を設定",
      reason: "現在の入力では次タイトル条件を満たしています。配置・将来試算で次のシナリオを比較してください。",
      dueDate: null
    });
  }
  return missions;
}

export function runForecast(
  initial: OrganizationSnapshot,
  rootId: string,
  scenario: ForecastScenario
): ForecastResult {
  let snapshot: OrganizationSnapshot = {
    ...initial,
    members: initial.members.map((member) => ({ ...member })),
    purchases: initial.purchases.map((purchase) => ({ ...purchase }))
  };
  const months: ForecastResult["months"] = [];
  for (const month of scenario.months) {
    const activeMembers = snapshot.members.filter((member) => member.endedPeriod === null);
    const keepCount = Math.max(0, Math.round(activeMembers.length * month.continuationRate));
    const retainedIds = new Set(activeMembers.slice(0, keepCount).map((member) => member.id));
    const repeats: PurchaseEvent[] = activeMembers.filter((member) => retainedIds.has(member.id)).map((member) => ({
      id: `forecast-repeat-${scenario.id}-${month.period}-${member.id}`,
      workspaceId: snapshot.workspaceId,
      memberId: member.id,
      period: month.period,
      productCode: null,
      kind: "repeat",
      status: "confirmed",
      quantity: 1,
      price: 0,
      pv: planConfig.courses[member.course].recurringPv
    }));
    const additions: Member[] = [];
    const initialPurchases: PurchaseEvent[] = [];
    month.registrations.forEach((registration, registrationIndex) => {
      for (let index = 0; index < registration.count; index += 1) {
        const id = `forecast-${scenario.id}-${month.period}-${registrationIndex}-${index}`;
        additions.push({
          id, workspaceId: snapshot.workspaceId, displayName: `新規${index + 1}`, parentMemberId: registration.placementMemberId,
          introducerMemberId: rootId, masterMemberId: null, trainerMemberId: null, idKind: "master", course: registration.course,
          title: "NONE", trainerCredential: "NONE", sponsorLicense: false, directorPromotedPeriod: null,
          joinedPeriod: month.period, endedPeriod: null
        });
        const firstPurchase: PurchaseEvent = {
          id: `purchase-${id}`, workspaceId: snapshot.workspaceId, memberId: id, period: month.period, productCode: null,
          kind: "initial", status: "confirmed", quantity: 1, price: 0, pv: planConfig.courses[registration.course].recurringPv
        };
        initialPurchases.push(firstPurchase, { ...firstPurchase, id: `repeat-${id}`, kind: "repeat" });
      }
    });
    const additional: PurchaseEvent[] = month.additionalPv > 0 ? [{
      id: `forecast-additional-${scenario.id}-${month.period}`, workspaceId: snapshot.workspaceId, memberId: rootId,
      period: month.period, productCode: null, kind: "additional", status: "confirmed", quantity: 1, price: 0, pv: month.additionalPv
    }] : [];
    snapshot = {
      ...snapshot,
      period: month.period,
      members: [...snapshot.members, ...additions],
      purchases: [...snapshot.purchases, ...repeats, ...initialPurchases, ...additional]
    };
    const title = evaluateTitle(snapshot, rootId).achievedTitle;
    const bonus = computeBonus(snapshot, rootId, scenario.taxProfile);
    months.push({
      period: month.period,
      groupMembers: descendants(snapshot, rootId).length,
      groupPv: groupPv(snapshot, rootId),
      title,
      gross: bonus.gross,
      estimatedNet: bonus.estimatedNet
    });
  }
  return { scenarioId: scenario.id, months };
}
