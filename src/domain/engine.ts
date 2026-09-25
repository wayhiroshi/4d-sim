import { planConfig } from "./plan";
import {
  TITLE_ORDER,
  type BatchSimulationRequest,
  type BatchSimulationResult,
  type BonusBreakdown,
  type ConditionResult,
  type CourseCode,
  type ForecastResult,
  type ForecastScenario,
  type GrowthStorySimulationRequest,
  type GrowthStorySimulationResult,
  type LeaderTeamSimulationRequest,
  type LeaderTeamSimulationResult,
  type Member,
  type Mission,
  type OrganizationSnapshot,
  type PlacementBonusDelta,
  type PlacementIncomeComparison,
  type PlacementResult,
  type PurchaseEvent,
  type SimulationMember,
  type SimulationRequest,
  type ShoppingMallInvitationEstimate,
  type TaxProfile,
  type TitleCode,
  type TitleChecklistItem,
  type TitleEvaluation,
  type TrainerBonusRole,
  type TrainerQualificationChecklistItem
} from "../shared/types";

const money = (value: number) => Math.round(value);

// The index belongs to one immutable month snapshot, never to a user/global cache.
const indexKey = Symbol("month-calculation-index");
type CalculationIndex = {
  members: Map<string, Member>;
  owned: Map<string, Member[]>;
  children: Map<string, Member[]>;
  introduced: Map<string, Member[]>;
  purchases: Map<string, PurchaseEvent[]>;
  descendants: Map<string, Array<{ member: Member; depth: number }>>;
  strictSubCompression: boolean;
  compressionEnabled: boolean;
  priorDirectorPv?: Map<string, number>;
};
type IndexedSnapshot = OrganizationSnapshot & { [indexKey]?: CalculationIndex };
export function indexMonth(snapshot: OrganizationSnapshot, options: { compressionEnabled?: boolean; priorDirectorPv?: Map<string, number> } = {}): OrganizationSnapshot {
  const index: CalculationIndex = { members: new Map(), owned: new Map(), children: new Map(), introduced: new Map(), purchases: new Map(), descendants: new Map(), strictSubCompression: true, compressionEnabled: options.compressionEnabled ?? true, priorDirectorPv: options.priorDirectorPv };
  for (const member of snapshot.members) {
    index.members.set(member.id, member);
    if (member.masterMemberId) index.owned.set(member.masterMemberId, [...(index.owned.get(member.masterMemberId) ?? []), member]);
    if (member.parentMemberId) index.children.set(member.parentMemberId, [...(index.children.get(member.parentMemberId) ?? []), member]);
    if (member.introducerMemberId) index.introduced.set(member.introducerMemberId, [...(index.introduced.get(member.introducerMemberId) ?? []), member]);
  }
  for (const purchase of snapshot.purchases) {
    if (purchase.status !== "confirmed") continue;
    const key = `${purchase.period}/${purchase.memberId}`;
    index.purchases.set(key, [...(index.purchases.get(key) ?? []), purchase]);
  }
  Object.defineProperty(snapshot, indexKey, { value: index, configurable: true });
  return snapshot;
}
const monthIndex = (snapshot: OrganizationSnapshot) => (snapshot as IndexedSnapshot)[indexKey];
const findMember = (snapshot: OrganizationSnapshot, id: string) => monthIndex(snapshot)?.members.get(id) ?? snapshot.members.find((member) => member.id === id);
const mayCompress = (snapshot: OrganizationSnapshot, member: Member) =>
  planConfig.compression.enabled && planConfig.compression.promoteEndedMembers &&
  (monthIndex(snapshot)?.compressionEnabled ?? true) &&
  (!monthIndex(snapshot)?.strictSubCompression || member.idKind === "sub");

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
  const index = monthIndex(snapshot);
  if (index) return index.purchases.get(`${period}/${memberId}`) ?? [];
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
  const index = monthIndex(snapshot);
  if (index) return index.children.get(memberId) ?? [];
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
    if (ended && mayCompress(snapshot, member)) {
      queue.push(...rawChildrenOf(snapshot, member.id));
    } else if (!ended || monthIndex(snapshot)?.strictSubCompression) output.push(member);
  }
  return output;
}

export function descendants(snapshot: OrganizationSnapshot, rootId: string): Array<{ member: Member; depth: number }> {
  const index = monthIndex(snapshot);
  const cached = index?.descendants.get(rootId);
  if (cached) return cached;
  const output: Array<{ member: Member; depth: number }> = [];
  const childrenByParent = index?.children ?? new Map<string, Member[]>();
  for (const member of index ? [] : snapshot.members) {
    if (member.parentMemberId === null) continue;
    const siblings = childrenByParent.get(member.parentMemberId) ?? [];
    siblings.push(member);
    childrenByParent.set(member.parentMemberId, siblings);
  }
  const queue = (childrenByParent.get(rootId) ?? []).map((member) => ({ member, depth: 1 }));
  const visited = new Set<string>([rootId]);
  while (queue.length) {
    const item = queue.shift();
    if (!item || visited.has(item.member.id)) continue;
    visited.add(item.member.id);
    const ended = item.member.endedPeriod !== null && item.member.endedPeriod <= snapshot.period;
    if (ended && mayCompress(snapshot, item.member)) {
      for (const child of childrenByParent.get(item.member.id) ?? []) queue.push({ member: child, depth: item.depth });
      continue;
    }
    if (ended) {
      // In Strategy Studio an ordinary departure stops this ID's earnings;
      // surviving children retain their depth. Only the explicit sub-deletion
      // rule promotes a generation. Do not erase an entire surviving branch.
      if (index?.strictSubCompression) for (const child of childrenByParent.get(item.member.id) ?? []) queue.push({ member: child, depth: item.depth + 1 });
      continue;
    }
    output.push(item);
    for (const child of childrenByParent.get(item.member.id) ?? []) queue.push({ member: child, depth: item.depth + 1 });
  }
  index?.descendants.set(rootId, output);
  return output;
}

export function ownedIds(snapshot: OrganizationSnapshot, masterId: string): Member[] {
  const master = findMember(snapshot, masterId);
  if (!master) return [];
  if (master.idKind === "sub") return [master];
  return [
    master,
    ...(monthIndex(snapshot) ? monthIndex(snapshot)!.owned.get(masterId) ?? [] : snapshot.members).filter((member) =>
      member.idKind === "sub" &&
      member.masterMemberId === masterId &&
      (member.endedPeriod === null || member.endedPeriod > snapshot.period)
    )
  ];
}

export function groupPv(snapshot: OrganizationSnapshot, rootId: string, period = snapshot.period): number {
  if (monthIndex(snapshot)) return descendants(snapshot, rootId).reduce((sum, item) => sum + memberPv(snapshot, item.member.id, period), 0) +
    purchasesFor(snapshot, rootId, period).filter((p) => p.kind === "additional").reduce((sum, p) => sum + p.pv * p.quantity, 0);
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
  if (maxDepth === 3 && period === previousPeriod(snapshot.period) && monthIndex(snapshot)?.priorDirectorPv) return monthIndex(snapshot)!.priorDirectorPv!.get(rootId) ?? 0;
  if (monthIndex(snapshot)) return descendants(snapshot, rootId).filter((item) => item.depth <= maxDepth)
    .reduce((sum, item) => sum + memberPv(snapshot, item.member.id, period), 0) +
    purchasesFor(snapshot, rootId, period).filter((p) => p.kind === "additional").reduce((sum, p) => sum + p.pv * p.quantity, 0);
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
  return (monthIndex(snapshot) ? monthIndex(snapshot)!.introduced.get(rootId) ?? [] : snapshot.members).filter((member) => {
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
  const root = findMember(snapshot, rootId);
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
  const ownedIdCount = 1 + (monthIndex(snapshot) ? monthIndex(snapshot)!.owned.get(rootId) ?? [] : snapshot.members).filter((member) => member.masterMemberId === rootId && member.idKind === "sub").length;
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

const trainerCredentialRank = (credential: Member["trainerCredential"]): number =>
  credential === "ST" ? 2 : credential === "PT" ? 1 : 0;

export function evaluateTrainerQualificationChecklists(
  snapshot: OrganizationSnapshot,
  rootId: string
): TrainerQualificationChecklistItem[] {
  const root = snapshot.members.find((member) => member.id === rootId);
  if (!root) throw new Error(`Member not found: ${rootId}`);
  const evaluatedTitle = evaluateTitle(snapshot, rootId).achievedTitle;
  const directCount = directIntroductions(snapshot, rootId, false, false).length;

  return (["PT", "ST"] as const).map((code) => {
    const rule = planConfig.trainerQualifications[code];
    const conditions: ConditionResult[] = [
      ...(rule.requiredTitle ? [boolCondition(
        `${code}-title`,
        `本人が${rule.requiredTitle}`,
        titleAtLeast(evaluatedTitle, rule.requiredTitle)
      )] : []),
      ...(rule.requiredTrainerCredential ? [boolCondition(
        `${code}-trainer`,
        "本人がプレ・トレーナー",
        trainerCredentialRank(root.trainerCredential) >= trainerCredentialRank(rule.requiredTrainerCredential)
      )] : []),
      numberCondition(`${code}-direct`, "直紹介者数（サブIDを除く）", directCount, rule.directIntroductions),
      ...(rule.requiredDirectTitle ? [numberCondition(
        `${code}-direct-title`,
        `1次ラインの${rule.requiredDirectTitle}人数`,
        directTitleCount(snapshot, rootId, rule.requiredDirectTitle),
        rule.requiredDirectTitleCount
      )] : []),
      ...(rule.requiresSponsorLicense ? [boolCondition(`${code}-license`, "スポンサーライセンス取得", root.sponsorLicense)] : []),
      numberCondition(`${code}-studio`, "本部主催オープンスタジオ（セミナー）出席回数", root.openStudioAttendances, rule.openStudioAttendances),
      boolCondition(
        `${code}-course`,
        code === "PT" ? "プレ・トレーナー講習会受講" : "スタート・トレーナー講習会受講",
        root[rule.courseField]
      ),
      boolCondition(
        `${code}-kit`,
        code === "PT" ? "プレ・トレーナーキット購入" : "スタート・トレーナーキット購入",
        root[rule.kitField]
      )
    ];
    const credentialAchieved = trainerCredentialRank(root.trainerCredential) >= rule.rank;
    const nextRank = trainerCredentialRank(root.trainerCredential) + 1;
    const progress = credentialAchieved ? 100 : Math.round((conditions.filter((condition) => condition.met).length / conditions.length) * 100);
    const bonuses = code === "PT"
      ? [
          { courseLabel: "A・F・I", solo: planConfig.trainerBonuses.A.PT, withPreTrainer: null },
          { courseLabel: "B・G", solo: planConfig.trainerBonuses.B.PT, withPreTrainer: null }
        ]
      : [
          { courseLabel: "A・F", solo: planConfig.trainerBonuses.A.ST_SOLO, withPreTrainer: planConfig.trainerBonuses.A.ST_WITH_PT },
          { courseLabel: "B・G", solo: planConfig.trainerBonuses.B.ST_SOLO, withPreTrainer: planConfig.trainerBonuses.B.ST_WITH_PT },
          { courseLabel: "I", solo: planConfig.trainerBonuses.I.ST_SOLO, withPreTrainer: planConfig.trainerBonuses.I.ST_WITH_PT }
        ];
    return {
      code,
      label: rule.label,
      rank: rule.rank,
      status: credentialAchieved ? "achieved" : rule.rank === nextRank ? "next" : "future",
      progress,
      conditions,
      bonuses
    };
  });
}

function ratesForCourse(course: CourseCode, evaluatedTitle: TitleCode): number[] {
  const titleRates = planConfig.lineRatesByTitle[evaluatedTitle]?.[course];
  if (titleRates) return titleRates;
  if (titleAtLeast(evaluatedTitle, "DR")) {
    const directorRates = planConfig.lineRatesByTitle.DR?.[course];
    if (directorRates) return directorRates;
  }
  if (titleAtLeast(evaluatedTitle, "LD")) {
    const ldRates = planConfig.lineRatesByTitle.LD?.[course];
    if (ldRates) return ldRates;
  }
  return planConfig.courses[course].baseLineRates;
}

function ratesFor(member: Member, evaluatedTitle: TitleCode): number[] {
  return ratesForCourse(member.course, evaluatedTitle);
}

export function computeShoppingMallInvitationEstimate(options: {
  productCode: string;
  course: CourseCode;
  title: TitleCode;
  orders: number;
  includeIssueFee?: boolean;
}): ShoppingMallInvitationEstimate {
  if (!Number.isInteger(options.orders) || options.orders < 0) {
    throw new Error(`Orders must be a non-negative integer: ${options.orders}`);
  }
  const product = planConfig.shoppingMallInvitation.products.find((item) => item.code === options.productCode);
  if (!product) throw new Error(`Shopping mall product not found: ${options.productCode}`);
  const firstLineRate = ratesForCourse(options.course, options.title)[0] ?? 0;
  const salesBonusPerOrder = product.normalPrice - product.memberPrice;
  const pvBonusPerOrder = money(product.standardPv * firstLineRate);
  const grossBonusPerOrder = salesBonusPerOrder + pvBonusPerOrder;
  const issueFee = options.includeIssueFee === false ? 0 : planConfig.shoppingMallInvitation.issueFeePerId;

  return {
    productCode: product.code,
    productName: product.name,
    course: options.course,
    title: options.title,
    orders: options.orders,
    standardPvPerOrder: product.standardPv,
    creditedPv: product.standardPv * options.orders,
    firstLineRate,
    salesBonusPerOrder,
    pvBonusPerOrder,
    grossBonusPerOrder,
    salesBonus: salesBonusPerOrder * options.orders,
    pvBonus: pvBonusPerOrder * options.orders,
    grossBonus: grossBonusPerOrder * options.orders,
    issueFee,
    afterIssueFee: grossBonusPerOrder * options.orders - issueFee
  };
}

export function computeLineBonus(snapshot: OrganizationSnapshot, rootId: string, forcedTitle?: TitleCode): number {
  const root = findMember(snapshot, rootId);
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
    .filter((purchase) => findMember(snapshot, purchase.memberId)?.introducerMemberId === rootId)
    .reduce((sum, purchase) => {
      const member = findMember(snapshot, purchase.memberId);
      return sum + (member ? planConfig.courses[member.course].startBonus : 0);
    }, 0);
}

function computeTrainerBonus(snapshot: OrganizationSnapshot, rootId: string): number {
  const root = findMember(snapshot, rootId);
  if (!root || !isActive(snapshot, rootId)) return 0;
  return snapshot.purchases
    .filter((purchase) => purchase.period === snapshot.period && purchase.kind === "initial" && purchase.status === "confirmed")
    .filter((purchase) => findMember(snapshot, purchase.memberId)?.trainerMemberId === rootId)
    .reduce((sum, purchase) => {
      const member = findMember(snapshot, purchase.memberId);
      if (!member) return sum;
      const role = member.trainerBonusRole
        ?? (root.trainerCredential === "PT" ? "PT" : root.trainerCredential === "ST" ? "ST_SOLO" : null);
      return role && trainerRoleEligible(root, role) ? sum + planConfig.trainerBonuses[member.course][role] : sum;
    }, 0);
}

function trainerRoleEligible(member: Member, role: TrainerBonusRole): boolean {
  if (role === "PT") return member.trainerCredential === "PT" || member.trainerCredential === "ST";
  return member.trainerCredential === "ST";
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

type RawBonus = Pick<BonusBreakdown, "start" | "trainer" | "line" | "director" | "title" | "gross">;

export function computeRawBonus(snapshot: OrganizationSnapshot, rootId: string, resolvedTitle?: TitleCode): RawBonus {
  if (!isActive(snapshot, rootId)) {
    return { start: 0, trainer: 0, line: 0, director: 0, title: 0, gross: 0 };
  }
  const evaluatedTitle = resolvedTitle ?? evaluateTitle(snapshot, rootId).achievedTitle;
  const start = computeStartBonus(snapshot, rootId);
  const trainer = computeTrainerBonus(snapshot, rootId);
  const line = titleAtLeast(evaluatedTitle, "DR")
    ? computeLineBonus(snapshot, rootId, "LD")
    : computeLineBonus(snapshot, rootId, evaluatedTitle);
  const director = computeDirectorBonus(snapshot, rootId, evaluatedTitle);
  const title = computeTitleBonus(snapshot, rootId, evaluatedTitle);
  const gross = money(start + trainer + line + director + title);
  return { start, trainer, line, director, title, gross };
}

export function computeBonus(
  snapshot: OrganizationSnapshot,
  rootId: string,
  taxProfile: TaxProfile
): BonusBreakdown {
  const raw = ownedIds(snapshot, rootId).reduce<RawBonus>((total, member) => {
    const bonus = computeRawBonus(snapshot, member.id);
    return {
      start: total.start + bonus.start,
      trainer: total.trainer + bonus.trainer,
      line: total.line + bonus.line,
      director: total.director + bonus.director,
      title: total.title + bonus.title,
      gross: total.gross + bonus.gross
    };
  }, { start: 0, trainer: 0, line: 0, director: 0, title: 0, gross: 0 });
  return settleBonus(raw, snapshot.period, taxProfile);
}

export function settleBonus(raw: RawBonus, period: string, taxProfile: TaxProfile): BonusBreakdown {
  const { start, trainer, line, director, title, gross } = raw;
  const invoiceTransition = invoiceTransitionDeduction(gross, period, taxProfile.invoiceRegistered);
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

const PAIR_INCOME_WARNING = "本人とパートナーは、それぞれの保有サブIDを合算してから税・控除条件を個別に適用し、2名分を合計しています。実際の条件が異なる場合は総ボーナスを基準に確認してください";

type TitlePriorityRole = PlacementResult["priorityMemberRole"];
type TitlePriorityCandidate = { member: Member; role: TitlePriorityRole };

const activeInPeriod = (member: Member, period: string): boolean =>
  member.endedPeriod === null || member.endedPeriod > period;

function titlePriorityCandidates(
  snapshot: OrganizationSnapshot,
  request: SimulationRequest,
  root: Member
): TitlePriorityCandidate[] {
  const candidates: TitlePriorityCandidate[] = [
    { member: root, role: "self" },
    ...ownedIds(snapshot, root.id).slice(1).map((member) => ({ member, role: "self-sub" as const }))
  ];
  const partner = request.partnerMemberId
    ? snapshot.members.find((member) =>
      member.id === request.partnerMemberId && member.id !== root.id && member.idKind === "master" &&
      member.masterMemberId === null && activeInPeriod(member, snapshot.period)
    ) ?? null
    : null;
  if (partner) {
    candidates.push(
      { member: partner, role: "partner" },
      ...ownedIds(snapshot, partner.id).slice(1).map((member) => ({ member, role: "partner-sub" as const }))
    );
  }
  if ((request.titlePriorityMode ?? "member") === "auto") return candidates;
  const selectedId = request.titlePriorityMemberId ?? root.id;
  const selected = candidates.find((candidate) => candidate.member.id === selectedId);
  if (!selected) throw new Error("The title priority member must be self, partner, or one of their owned sub IDs");
  return [selected];
}

function titleTargetState(snapshot: OrganizationSnapshot, memberId: string, targetTitle: TitleCode) {
  const evaluation = evaluateTitle(snapshot, memberId);
  const reached = titleAtLeast(evaluation.achievedTitle, targetTitle);
  const target = targetTitle === "NONE"
    ? null
    : evaluateTitleChecklists(snapshot, memberId).find((item) => item.code === targetTitle) ?? null;
  const missing = reached ? 0 : target?.conditions.filter((condition) => !condition.met).length ?? missingCount(evaluation);
  return { evaluation, reached, missing };
}

function compareTitlePriorityResults(a: PlacementResult, b: PlacementResult): number {
  const stage = (result: PlacementResult) => result.targetAchievedBefore ? 2 : result.targetAchievedAfter ? 0 : 1;
  const gain = (result: PlacementResult) => result.missingBefore - result.missingAfter;
  const titleGain = (result: PlacementResult) => TITLE_ORDER.indexOf(result.titleAfter) - TITLE_ORDER.indexOf(result.titleBefore);
  return stage(a) - stage(b) ||
    a.missingAfter - b.missingAfter ||
    gain(b) - gain(a) ||
    titleGain(b) - titleGain(a) ||
    b.incomeComparison.combined.grossDelta - a.incomeComparison.combined.grossDelta ||
    a.priorityMemberId.localeCompare(b.priorityMemberId) ||
    a.placementMemberId.localeCompare(b.placementMemberId);
}

function placementIncomeComparison(
  mode: "self" | "pair",
  self: Member,
  selfBefore: BonusBreakdown,
  selfAfter: BonusBreakdown,
  partner: Member | null,
  partnerBefore: BonusBreakdown | null,
  partnerAfter: BonusBreakdown | null,
  selfIncludedIds: Member[],
  partnerIncludedIds: Member[]
): PlacementIncomeComparison {
  const selfOwner = {
    memberId: self.id,
    memberName: self.displayName,
    includedIds: selfIncludedIds.map((member) => ({ memberId: member.id, memberName: member.displayName, idKind: member.idKind })),
    before: selfBefore,
    after: selfAfter,
    delta: compareBonusBreakdowns(selfBefore, selfAfter)
  };
  const partnerOwner = partner && partnerBefore && partnerAfter ? {
    memberId: partner.id,
    memberName: partner.displayName,
    includedIds: partnerIncludedIds.map((member) => ({ memberId: member.id, memberName: member.displayName, idKind: member.idKind })),
    before: partnerBefore,
    after: partnerAfter,
    delta: compareBonusBreakdowns(partnerBefore, partnerAfter)
  } : null;
  const beforeGross = selfBefore.gross + (partnerBefore?.gross ?? 0);
  const afterGross = selfAfter.gross + (partnerAfter?.gross ?? 0);
  const beforeEstimatedNet = selfBefore.estimatedNet + (partnerBefore?.estimatedNet ?? 0);
  const afterEstimatedNet = selfAfter.estimatedNet + (partnerAfter?.estimatedNet ?? 0);
  return {
    mode,
    self: selfOwner,
    partner: partnerOwner,
    combined: {
      beforeGross,
      afterGross,
      grossDelta: afterGross - beforeGross,
      beforeEstimatedNet,
      afterEstimatedNet,
      estimatedNetDelta: afterEstimatedNet - beforeEstimatedNet
    }
  };
}

export function compareBonusBreakdowns(before: BonusBreakdown, after: BonusBreakdown): PlacementBonusDelta {
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
  suffix: string,
  introducerMemberId = snapshot.members.find((member) => member.parentMemberId === null)?.id ?? placementMemberId
): OrganizationSnapshot {
  const id = `simulation-${suffix}`;
  const candidate: Member = {
    id,
    workspaceId: snapshot.workspaceId,
    displayName: request.candidateName,
    parentMemberId: placementMemberId,
    introducerMemberId,
    masterMemberId: request.idKind === "sub" ? snapshot.members.find((member) => member.parentMemberId === null)?.id ?? null : null,
    trainerMemberId: request.trainerBonusRole ? snapshot.members.find((member) => member.parentMemberId === null)?.id ?? null : null,
    trainerBonusRole: request.trainerBonusRole ?? null,
    idKind: request.idKind,
    course: request.course,
    title: "NONE",
    trainerCredential: "NONE",
    sponsorLicense: false,
    openStudioAttendances: 0,
    preTrainerCourseCompleted: false,
    preTrainerKitPurchased: false,
    startTrainerCourseCompleted: false,
    startTrainerKitPurchased: false,
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
      masterMemberId: item.masterMemberId,
      trainerMemberId: item.trainerMemberId,
      trainerBonusRole: item.trainerBonusRole,
      idKind: item.idKind,
      course: item.course,
      title: "NONE",
      trainerCredential: "NONE",
      sponsorLicense: false,
      openStudioAttendances: 0,
      preTrainerCourseCompleted: false,
      preTrainerKitPurchased: false,
      startTrainerCourseCompleted: false,
      startTrainerKitPurchased: false,
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
  const incomeMode = request.incomeMode ?? "self";
  const partner = incomeMode === "pair"
    ? snapshot.members.find((member) => member.id === request.partnerMemberId) ?? null
    : null;
  if (incomeMode === "pair" && (!partner || partner.id === root.id || partner.idKind !== "master" || partner.masterMemberId !== null || (partner.endedPeriod !== null && partner.endedPeriod <= snapshot.period))) {
    throw new Error("An active partner master ID is required for pair income simulation");
  }
  const beforeBonus = computeBonus(snapshot, root.id, request.taxProfile);
  const beforePartnerBonus = partner ? computeBonus(snapshot, partner.id, request.taxProfile) : null;
  const beforeIncomeComparison = placementIncomeComparison(
    incomeMode, root, beforeBonus, beforeBonus, partner, beforePartnerBonus, beforePartnerBonus,
    ownedIds(snapshot, root.id), partner ? ownedIds(snapshot, partner.id) : []
  );
  const ownedIdCountBefore = ownedIds(snapshot, root.id).length;
  const subIdLimitReached = request.idKind === "sub" && ownedIdCountBefore - 1 >= planConfig.maxSubIdsPerMaster;
  const priorityCandidates = titlePriorityCandidates(snapshot, request, root);
  const candidates = request.placementCandidateIds?.length
    ? snapshot.members.filter((member) => request.placementCandidateIds?.includes(member.id))
    : snapshot.members.filter((member) => member.endedPeriod === null);
  const results: PlacementResult[] = [];
  candidates.forEach((placement, placementIndex) => {
    const firstLineCount = childrenOf(snapshot, placement.id).length;
    const eligible = firstLineCount < planConfig.firstLineLimit && !subIdLimitReached;
    if (!eligible) {
      const priority = priorityCandidates[0]!;
      const beforeTarget = titleTargetState(snapshot, priority.member.id, request.targetTitle);
      results.push({
        placementMemberId: placement.id, placementMemberName: placement.displayName, eligible: false, rank: null,
        grossDelta: 0, estimatedNetDelta: 0,
        priorityMemberId: priority.member.id, priorityMemberName: priority.member.displayName, priorityMemberRole: priority.role,
        targetTitle: request.targetTitle, targetAchievedBefore: beforeTarget.reached, targetAchievedAfter: beforeTarget.reached,
        titleBefore: beforeTarget.evaluation.achievedTitle, titleAfter: beforeTarget.evaluation.achievedTitle,
        bonusDelta: emptyPlacementBonusDelta(),
        incomeComparison: beforeIncomeComparison,
        missingBefore: beforeTarget.missing, missingAfter: beforeTarget.missing, earliestAchievementPeriod: null,
        ownedIdCountBefore, ownedIdCountAfter: ownedIdCountBefore,
        reasons: [], warnings: [
          ...(firstLineCount >= planConfig.firstLineLimit ? ["1次ライン上限7名に達しています"] : []),
          ...(subIdLimitReached ? [`自分のサブIDは通常上限${planConfig.maxSubIdsPerMaster}件に達しています`] : [])
        ]
      });
      return;
    }
    priorityCandidates.forEach((priority, priorityIndex) => {
      const beforeTarget = titleTargetState(snapshot, priority.member.id, request.targetTitle);
      const simulated = cloneWithCandidate(
        snapshot, request, placement.id, `${placementIndex + 1}-${priorityIndex + 1}`, priority.member.id
      );
      const afterTarget = titleTargetState(simulated, priority.member.id, request.targetTitle);
      const afterBonus = computeBonus(simulated, root.id, request.taxProfile);
      const afterPartnerBonus = partner ? computeBonus(simulated, partner.id, request.taxProfile) : null;
      const bonusDelta = compareBonusBreakdowns(beforeBonus, afterBonus);
      const incomeComparison = placementIncomeComparison(
        incomeMode, root, beforeBonus, afterBonus, partner, beforePartnerBonus, afterPartnerBonus,
        ownedIds(simulated, root.id), partner ? ownedIds(simulated, partner.id) : []
      );
      const reasons = [
        `${priority.member.displayName}の${request.targetTitle}未達条件が${beforeTarget.missing}件から${afterTarget.missing}件になります`,
        incomeMode === "pair"
          ? `2名合計の総ボーナス概算が${incomeComparison.combined.grossDelta >= 0 ? "+" : ""}${incomeComparison.combined.grossDelta}円変化します`
          : `総ボーナス概算が${bonusDelta.gross >= 0 ? "+" : ""}${bonusDelta.gross}円変化します`
      ];
      if (!beforeTarget.reached && afterTarget.reached) reasons.unshift(`${priority.member.displayName}が${request.targetTitle}条件に到達します`);
      else if (afterTarget.evaluation.achievedTitle !== beforeTarget.evaluation.achievedTitle) reasons.unshift(`${priority.member.displayName}が${afterTarget.evaluation.achievedTitle}条件に到達します`);
      results.push({
        placementMemberId: placement.id,
        placementMemberName: placement.displayName,
        eligible: true,
        rank: null,
        grossDelta: bonusDelta.gross,
        estimatedNetDelta: bonusDelta.estimatedNet,
        bonusDelta,
        incomeComparison,
        priorityMemberId: priority.member.id,
        priorityMemberName: priority.member.displayName,
        priorityMemberRole: priority.role,
        targetTitle: request.targetTitle,
        targetAchievedBefore: beforeTarget.reached,
        targetAchievedAfter: afterTarget.reached,
        titleBefore: beforeTarget.evaluation.achievedTitle,
        titleAfter: afterTarget.evaluation.achievedTitle,
        missingBefore: beforeTarget.missing,
        missingAfter: afterTarget.missing,
        earliestAchievementPeriod: !beforeTarget.reached && afterTarget.reached ? request.period : null,
        ownedIdCountBefore,
        ownedIdCountAfter: ownedIds(simulated, root.id).length,
        reasons,
        warnings: [
          "タイトル最適化では、表示された優先IDが紹介者となる前提で比較しています",
          "参考シミュレーションです。登録後の配置は公式サイトで確認してください",
          ...(incomeMode === "pair" ? [PAIR_INCOME_WARNING] : []),
          ...(request.idKind === "sub" ? ["自分のサブIDとして、そのIDで発生するボーナスをメインIDの収入へ合算しています。不要なサブID登録は行わないでください"] : []),
          ...(request.trainerBonusRole && !trainerRoleEligible(root, request.trainerBonusRole) ? ["現在登録されているトレーナー資格では、このトレーナーボーナスは加算されません"] : []),
          ...(request.trainerBonusRole ? ["Aさん役の報酬は、該当トレーナー資格を有し申請書へ記載される場合の初回購入時のみです"] : []),
          ...(request.course === "I" && request.trainerBonusRole?.startsWith("ST") ? ["IコースはSトレーナー対象外のため、トレーナーボーナスは0円です"] : [])
        ]
      });
    });
  });
  const eligible = results.filter((item) => item.eligible).sort(compareTitlePriorityResults);
  if ((request.titlePriorityMode ?? "member") === "auto") {
    const bestByPriority = new Map<string, PlacementResult>();
    eligible.forEach((item) => {
      if (!bestByPriority.has(item.priorityMemberId)) bestByPriority.set(item.priorityMemberId, item);
    });
    const compared = [...bestByPriority.values()].sort(compareTitlePriorityResults);
    compared.forEach((item, index) => { item.rank = index + 1; });
    return compared;
  }
  eligible.forEach((item, index) => { item.rank = index + 1; });
  return results.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)).slice(0, 3);
}

export function simulateBatchPlacements(snapshot: OrganizationSnapshot, request: BatchSimulationRequest): BatchSimulationResult {
  if (!Number.isInteger(request.candidateCount) || request.candidateCount < 1 || request.candidateCount > 20) {
    throw new Error("Batch candidate count must be between 1 and 20");
  }
  const root = snapshot.members.find((member) => member.parentMemberId === null);
  if (!root) throw new Error("Root member is required");
  const incomeMode = request.incomeMode ?? "self";
  const partner = incomeMode === "pair"
    ? snapshot.members.find((member) => member.id === request.partnerMemberId) ?? null
    : null;
  if (incomeMode === "pair" && (!partner || partner.id === root.id || partner.idKind !== "master" || partner.masterMemberId !== null || (partner.endedPeriod !== null && partner.endedPeriod <= snapshot.period))) {
    throw new Error("An active partner master ID is required for pair income simulation");
  }
  const recommendedPriority = (request.titlePriorityMode ?? "member") === "auto"
    ? simulatePlacements(snapshot, { ...request, candidateName: `${request.candidateName}1` }).find((result) => result.eligible) ?? null
    : null;
  const selectedPriority = recommendedPriority
    ? { member: snapshot.members.find((member) => member.id === recommendedPriority.priorityMemberId)!, role: recommendedPriority.priorityMemberRole }
    : titlePriorityCandidates(snapshot, request, root)[0]!;
  const effectiveRequest: BatchSimulationRequest = {
    ...request,
    titlePriorityMode: "member",
    titlePriorityMemberId: selectedPriority.member.id
  };
  const initialTarget = titleTargetState(snapshot, selectedPriority.member.id, request.targetTitle);
  const initialBonus = computeBonus(snapshot, root.id, request.taxProfile);
  const initialPartnerBonus = partner ? computeBonus(snapshot, partner.id, request.taxProfile) : null;
  const ownedIdCountBefore = ownedIds(snapshot, root.id).length;
  let working = snapshot;
  const steps: BatchSimulationResult["steps"] = [];

  for (let index = 0; index < request.candidateCount; index += 1) {
    const candidateName = `${request.candidateName}${index + 1}`;
    const stepRequest: SimulationRequest = { ...effectiveRequest, candidateName };
    const best = simulatePlacements(working, stepRequest).find((result) => result.eligible);
    if (!best) break;

    let suffix = `batch-${index + 1}`;
    let collision = 1;
    while (working.members.some((member) => member.id === `simulation-${suffix}`)) {
      suffix = `batch-${index + 1}-${collision}`;
      collision += 1;
    }
    const candidateMemberId = `simulation-${suffix}`;
    working = cloneWithCandidate(working, stepRequest, best.placementMemberId, suffix, best.priorityMemberId);
    steps.push({
      sequence: index + 1,
      candidateMemberId,
      candidateName,
      placementMemberId: best.placementMemberId,
      placementMemberName: best.placementMemberName,
      priorityMemberId: best.priorityMemberId,
      priorityMemberName: best.priorityMemberName,
      priorityMemberRole: best.priorityMemberRole,
      titleBefore: best.titleBefore,
      titleAfter: best.titleAfter,
      missingBefore: best.missingBefore,
      missingAfter: best.missingAfter,
      grossDelta: best.incomeComparison.combined.grossDelta,
      lineDelta: best.incomeComparison.self.delta.line + (best.incomeComparison.partner?.delta.line ?? 0),
      estimatedNetDelta: best.incomeComparison.combined.estimatedNetDelta
    });
  }

  const finalTarget = titleTargetState(working, selectedPriority.member.id, request.targetTitle);
  const finalBonus = computeBonus(working, root.id, request.taxProfile);
  const finalPartnerBonus = partner ? computeBonus(working, partner.id, request.taxProfile) : null;
  const incomeComparison = placementIncomeComparison(
    incomeMode, root, initialBonus, finalBonus, partner, initialPartnerBonus, finalPartnerBonus,
    ownedIds(working, root.id), partner ? ownedIds(working, partner.id) : []
  );
  const placedCount = steps.length;
  return {
    strategy: "sequential",
    requestedCount: request.candidateCount,
    placedCount,
    unplacedCount: request.candidateCount - placedCount,
    steps,
    priorityMemberId: selectedPriority.member.id,
    priorityMemberName: selectedPriority.member.displayName,
    priorityMemberRole: selectedPriority.role,
    targetTitle: request.targetTitle,
    targetAchievedBefore: initialTarget.reached,
    targetAchievedAfter: finalTarget.reached,
    titleBefore: initialTarget.evaluation.achievedTitle,
    titleAfter: finalTarget.evaluation.achievedTitle,
    missingBefore: initialTarget.missing,
    missingAfter: finalTarget.missing,
    ownedIdCountBefore,
    ownedIdCountAfter: ownedIds(working, root.id).length,
    bonusDelta: compareBonusBreakdowns(initialBonus, finalBonus),
    incomeComparison,
    warnings: [
      "各1名を追加するたびに全配置候補を再計算する逐次最適配置です。全組合せの絶対的な最適解を保証するものではありません",
      `${selectedPriority.member.displayName}が紹介者となり、${request.targetTitle}取得を優先する前提で配置しています`,
      "参考シミュレーションです。公式登録や現在の試算組織は、この計算だけでは変更されません",
      ...(incomeMode === "pair" ? [PAIR_INCOME_WARNING] : []),
      ...(placedCount < request.candidateCount ? [`配置上限またはサブID上限により${request.candidateCount - placedCount}人は配置できませんでした`] : [])
    ]
  };
}

function unusedSimulationSuffix(snapshot: OrganizationSnapshot, preferred: string): string {
  let suffix = preferred;
  let collision = 1;
  while (snapshot.members.some((member) => member.id === `simulation-${suffix}`)) {
    suffix = `${preferred}-${collision}`;
    collision += 1;
  }
  return suffix;
}

export function simulateLeaderTeam(
  snapshot: OrganizationSnapshot,
  request: LeaderTeamSimulationRequest
): LeaderTeamSimulationResult {
  const root = snapshot.members.find((member) => member.parentMemberId === null);
  if (!root) throw new Error("Root member is required");
  const incomeMode = request.incomeMode ?? "self";
  const partner = incomeMode === "pair"
    ? snapshot.members.find((member) => member.id === request.partnerMemberId) ?? null
    : null;
  if (incomeMode === "pair" && (!partner || partner.id === root.id || partner.idKind !== "master" || partner.masterMemberId !== null || !activeInPeriod(partner, snapshot.period))) {
    throw new Error("An active partner master ID is required for pair income simulation");
  }

  const leaderName = `${request.candidateName}リーダー`;
  const leaderRequest: SimulationRequest = { ...request, candidateName: leaderName, idKind: "master" };
  const leaderPlacement = simulatePlacements(snapshot, leaderRequest).find((result) => result.eligible);
  if (!leaderPlacement) throw new Error("リーダーを配置できるアップがありません");

  const priorityId = leaderPlacement.priorityMemberId;
  const initialTarget = titleTargetState(snapshot, priorityId, request.targetTitle);
  const initialBonus = computeBonus(snapshot, root.id, request.taxProfile);
  const initialPartnerBonus = partner ? computeBonus(snapshot, partner.id, request.taxProfile) : null;
  const ownedIdCountBefore = ownedIds(snapshot, root.id).length;
  let working = snapshot;
  const steps: LeaderTeamSimulationResult["steps"] = [];

  const addTeamMember = (
    candidateName: string,
    placementMemberId: string,
    introducerMemberId: string,
    preferredSuffix: string,
    trainerBonusRole: TrainerBonusRole | null
  ): string => {
    const suffix = unusedSimulationSuffix(working, preferredSuffix);
    const candidateMemberId = `simulation-${suffix}`;
    const beforeTarget = titleTargetState(working, priorityId, request.targetTitle);
    const beforeBonus = computeBonus(working, root.id, request.taxProfile);
    const beforePartnerBonus = partner ? computeBonus(working, partner.id, request.taxProfile) : null;
    const memberRequest: SimulationRequest = {
      ...request,
      candidateName,
      idKind: "master",
      trainerBonusRole
    };
    working = cloneWithCandidate(working, memberRequest, placementMemberId, suffix, introducerMemberId);
    const afterTarget = titleTargetState(working, priorityId, request.targetTitle);
    const afterBonus = computeBonus(working, root.id, request.taxProfile);
    const afterPartnerBonus = partner ? computeBonus(working, partner.id, request.taxProfile) : null;
    const comparison = placementIncomeComparison(
      incomeMode, root, beforeBonus, afterBonus, partner, beforePartnerBonus, afterPartnerBonus,
      ownedIds(working, root.id), partner ? ownedIds(working, partner.id) : []
    );
    const placement = working.members.find((member) => member.id === placementMemberId);
    steps.push({
      sequence: steps.length + 1,
      candidateMemberId,
      candidateName,
      placementMemberId,
      placementMemberName: placement?.displayName ?? leaderPlacement.placementMemberName,
      priorityMemberId: introducerMemberId,
      priorityMemberName: working.members.find((member) => member.id === introducerMemberId)?.displayName ?? leaderPlacement.priorityMemberName,
      priorityMemberRole: leaderPlacement.priorityMemberRole,
      titleBefore: beforeTarget.evaluation.achievedTitle,
      titleAfter: afterTarget.evaluation.achievedTitle,
      missingBefore: beforeTarget.missing,
      missingAfter: afterTarget.missing,
      grossDelta: comparison.combined.grossDelta,
      lineDelta: comparison.self.delta.line + (comparison.partner?.delta.line ?? 0),
      estimatedNetDelta: comparison.combined.estimatedNetDelta
    });
    return candidateMemberId;
  };

  const leaderMemberId = addTeamMember(
    leaderName,
    leaderPlacement.placementMemberId,
    priorityId,
    "leader-team-leader",
    request.trainerBonusRole ?? null
  );
  const directMemberIds: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const placementMemberId = index < planConfig.firstLineLimit
      ? leaderMemberId
      : directMemberIds[index - planConfig.firstLineLimit]!;
    const memberId = addTeamMember(
      `${request.candidateName}チーム${index + 1}`,
      placementMemberId,
      leaderMemberId,
      `leader-team-member-${index + 1}`,
      null
    );
    if (index < planConfig.firstLineLimit) directMemberIds.push(memberId);
  }

  const finalTarget = titleTargetState(working, priorityId, request.targetTitle);
  const leaderDr = titleTargetState(working, leaderMemberId, "DR");
  const finalBonus = computeBonus(working, root.id, request.taxProfile);
  const finalPartnerBonus = partner ? computeBonus(working, partner.id, request.taxProfile) : null;
  const incomeComparison = placementIncomeComparison(
    incomeMode, root, initialBonus, finalBonus, partner, initialPartnerBonus, finalPartnerBonus,
    ownedIds(working, root.id), partner ? ownedIds(working, partner.id) : []
  );
  return {
    strategy: "leader-team",
    requestedCount: 11,
    placedCount: steps.length,
    unplacedCount: 11 - steps.length,
    steps,
    priorityMemberId: priorityId,
    priorityMemberName: leaderPlacement.priorityMemberName,
    priorityMemberRole: leaderPlacement.priorityMemberRole,
    targetTitle: request.targetTitle,
    targetAchievedBefore: initialTarget.reached,
    targetAchievedAfter: finalTarget.reached,
    titleBefore: initialTarget.evaluation.achievedTitle,
    titleAfter: finalTarget.evaluation.achievedTitle,
    missingBefore: initialTarget.missing,
    missingAfter: finalTarget.missing,
    ownedIdCountBefore,
    ownedIdCountAfter: ownedIds(working, root.id).length,
    bonusDelta: compareBonusBreakdowns(initialBonus, finalBonus),
    incomeComparison,
    leaderMemberId,
    leaderName,
    leaderPlacementMemberId: leaderPlacement.placementMemberId,
    leaderPlacementMemberName: leaderPlacement.placementMemberName,
    leaderTitleAfter: leaderDr.evaluation.achievedTitle,
    leaderDrMissingAfter: leaderDr.missing,
    warnings: [
      `11名を1つのチームとして扱い、${leaderName}単体の配置候補を全組織から比較した最上位にチームを固定しています`,
      `10名の紹介者は${leaderName}で固定し、1次ライン7名、2次ライン3名で配置しています`,
      "10名分のトレーナーボーナスは含めず、リーダー1名分だけ選択中のAさん役を反映します",
      "参考シミュレーションです。計算しただけでは試算組織へ保存されません",
      ...(incomeMode === "pair" ? [PAIR_INCOME_WARNING] : [])
    ]
  };
}

const GROWTH_STORY_GENERATIONS = 8;

const growthStoryCounts = (story: GrowthStorySimulationRequest["story"]): number[] =>
  Array.from({ length: GROWTH_STORY_GENERATIONS }, (_, index) => story === "three-by-three" ? 3 ** (index + 1) : 1);

function buildGrowthStorySnapshot(
  snapshot: OrganizationSnapshot,
  request: GrowthStorySimulationRequest,
  startingMember: Member,
  generationCounts: number[]
): OrganizationSnapshot {
  const output: OrganizationSnapshot = {
    ...snapshot,
    members: [...snapshot.members],
    purchases: [...snapshot.purchases]
  };
  const branchFactor = request.story === "three-by-three" ? 3 : 1;
  const largestConfiguredGroup = Math.max(0, ...planConfig.titles.map((title) => title.groupMembers ?? 0));
  const representationLimit = largestConfiguredGroup + GROWTH_STORY_GENERATIONS;
  let representedTotal = 0;
  let parents = [startingMember];

  for (const [generationIndex, logicalCount] of generationCounts.entries()) {
    const generation = generationIndex + 1;
    const laterGenerations = generationCounts.length - generation;
    const available = Math.max(1, representationLimit - representedTotal - laterGenerations);
    const representedCount = Math.min(logicalCount, available);
    const created: Member[] = [];
    for (let index = 0; index < representedCount; index += 1) {
      const parent = generation === 1 ? startingMember : parents[Math.floor(index / branchFactor)] ?? parents[index % parents.length];
      if (!parent) throw new Error("A represented story parent is required");
      const id = `simulation-story-${request.story}-${generation}-${index + 1}`;
      const candidate: Member = {
        id,
        workspaceId: snapshot.workspaceId,
        displayName: `${request.candidateName}${generation}-${index + 1}`,
        parentMemberId: parent.id,
        introducerMemberId: parent.id,
        masterMemberId: null,
        trainerMemberId: null,
        trainerBonusRole: null,
        idKind: "master",
        course: request.course,
        title: "NONE",
        trainerCredential: "NONE",
        sponsorLicense: false,
        openStudioAttendances: 0,
        preTrainerCourseCompleted: false,
        preTrainerKitPurchased: false,
        startTrainerCourseCompleted: false,
        startTrainerKitPurchased: false,
        directorPromotedPeriod: null,
        joinedPeriod: request.period,
        endedPeriod: null
      };
      created.push(candidate);
      output.members.push(candidate);
      output.purchases.push({
        id: `simulation-story-repeat-${generation}-${index + 1}`,
        workspaceId: snapshot.workspaceId,
        memberId: id,
        period: request.period,
        productCode: null,
        kind: "repeat",
        status: "confirmed",
        quantity: 1,
        price: 0,
        pv: index === 0 ? logicalCount * planConfig.courses[request.course].recurringPv : 0
      });
    }
    representedTotal += representedCount;
    parents = created;
  }
  return output;
}

export function simulateGrowthStory(
  snapshot: OrganizationSnapshot,
  request: GrowthStorySimulationRequest
): GrowthStorySimulationResult {
  const root = snapshot.members.find((member) => member.parentMemberId === null);
  if (!root) throw new Error("Root member is required");
  const startingMember = snapshot.members.find((member) => member.id === request.startingMemberId);
  if (!startingMember || (startingMember.endedPeriod !== null && startingMember.endedPeriod <= snapshot.period)) {
    throw new Error("An active story starting member is required");
  }
  const incomeMode = request.incomeMode ?? "self";
  const partner = incomeMode === "pair"
    ? snapshot.members.find((member) => member.id === request.partnerMemberId) ?? null
    : null;
  if (incomeMode === "pair" && (!partner || partner.id === root.id || partner.idKind !== "master" || partner.masterMemberId !== null || (partner.endedPeriod !== null && partner.endedPeriod <= snapshot.period))) {
    throw new Error("An active partner master ID is required for pair income simulation");
  }

  const generationCounts = growthStoryCounts(request.story);
  const requestedCount = generationCounts.reduce((sum, count) => sum + count, 0);
  const branchFactor = request.story === "three-by-three" ? 3 : 1;
  if (childrenOf(snapshot, startingMember.id).length + branchFactor > planConfig.firstLineLimit) {
    throw new Error("ストーリーの起点は1次ラインの空きが足りません");
  }
  const initialTitle = evaluateTitle(snapshot, root.id);
  const initialBonus = computeBonus(snapshot, root.id, request.taxProfile);
  const initialPartnerBonus = partner ? computeBonus(snapshot, partner.id, request.taxProfile) : null;
  const ownedIdCountBefore = ownedIds(snapshot, root.id).length;
  const working = buildGrowthStorySnapshot(snapshot, request, startingMember, generationCounts);

  const finalTitle = evaluateTitle(working, root.id);
  const finalBonus = computeBonus(working, root.id, request.taxProfile);
  const finalPartnerBonus = partner ? computeBonus(working, partner.id, request.taxProfile) : null;
  const incomeComparison = placementIncomeComparison(
    incomeMode, root, initialBonus, finalBonus, partner, initialPartnerBonus, finalPartnerBonus,
    ownedIds(working, root.id), partner ? ownedIds(working, partner.id) : []
  );
  let cumulativeMemberCount = 0;
  let cumulativePv = 0;
  const generations = generationCounts.map((memberCount, index) => {
    const pv = memberCount * planConfig.courses[request.course].recurringPv;
    cumulativeMemberCount += memberCount;
    cumulativePv += pv;
    return { generation: index + 1, memberCount, cumulativeMemberCount, pv, cumulativePv };
  });
  const storyLabel = request.story === "three-by-three" ? "理想型 3人→3人ずつ×8段" : "現実型 1人→1人ずつ×8段";
  return {
    strategy: request.story,
    storyLabel,
    requestedCount,
    placedCount: requestedCount,
    unplacedCount: 0,
    generationCounts,
    generations,
    titleBefore: initialTitle.achievedTitle,
    titleAfter: finalTitle.achievedTitle,
    missingBefore: missingCount(initialTitle),
    missingAfter: missingCount(finalTitle),
    ownedIdCountBefore,
    ownedIdCountAfter: ownedIds(working, root.id).length,
    bonusDelta: compareBonusBreakdowns(initialBonus, finalBonus),
    incomeComparison,
    warnings: [
      "8段へ到達した時点で、全員が同じ1営業月に継続していると仮定する遠い未来の試算です",
      "初回登録時のスタート・トレーナーボーナスは含めず、継続時の報酬とラインボーナスを表示します",
      "実際の紹介速度、継続率、収入を予測または保証するものではありません",
      "追加メンバー自身の将来タイトルや資格取得は仮定せず、現在の公式条件で本人のタイトルだけを判定します",
      "大人数は公式ルールに必要な人数と、各段のp.v.合計に圧縮して計算しています。試算組織へは保存されません",
      ...(incomeMode === "pair" ? [PAIR_INCOME_WARNING] : [])
    ]
  };
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

function assessForecastAssumptions(scenario: ForecastScenario): Pick<ForecastResult, "assumptionLoad" | "assumptionNotes"> {
  const directPerMonth = Math.max(...scenario.months.flatMap((month) => month.registrations.map((item) => item.count)), 0);
  const teamGrowthRate = Math.max(...scenario.months.map((month) => month.teamActivityRate * month.introductionsPerActiveMember), 0);
  const continuationRate = Math.max(...scenario.months.map((month) => month.continuationRate), 0);
  const high = directPerMonth >= 4 || teamGrowthRate >= 0.25 || (continuationRate >= 0.98 && scenario.months.length >= 6);
  const medium = directPerMonth >= 2 || teamGrowthRate >= 0.1 || continuationRate >= 0.9;
  const assumptionLoad: ForecastResult["assumptionLoad"] = high ? "high" : medium ? "medium" : "low";
  const assumptionNotes = [
    `本人紹介は最大で毎月${directPerMonth}人の前提です`,
    teamGrowthRate > 0
      ? `チーム新規は活動率×1人あたり紹介数（最大月${Math.round(teamGrowthRate * 100)}%相当）で増えます`
      : "チーム内からの新規紹介は0人の前提です",
    `継続率は最大${Math.round(continuationRate * 100)}%の前提です`
  ];
  if (high) assumptionNotes.push("複数の高い前提が連続するため、目標として扱い月ごとに実績との差を見直してください");
  else if (medium) assumptionNotes.push("努力を要する前提を含みます。直近実績と毎月照合してください");
  else assumptionNotes.push("控えめな前提ですが、結果を保証するものではありません");
  return { assumptionLoad, assumptionNotes };
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
  let teamRecruitmentCarry = 0;
  for (const month of scenario.months) {
    const activeMembers = snapshot.members.filter((member) => member.endedPeriod === null).sort((a, b) => a.id.localeCompare(b.id));
    const root = activeMembers.find((member) => member.id === rootId);
    const teamMembers = activeMembers.filter((member) => member.id !== rootId);
    const keepTeamCount = Math.max(0, Math.round(teamMembers.length * month.continuationRate));
    const retainedIds = new Set(teamMembers.slice(0, keepTeamCount).map((member) => member.id));
    if (root) retainedIds.add(root.id);
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
    let directRegistrations = 0;
    month.registrations.forEach((registration, registrationIndex) => {
      for (let index = 0; index < registration.count; index += 1) {
        const id = `forecast-${scenario.id}-${month.period}-${registrationIndex}-${index}`;
        directRegistrations += 1;
        additions.push({
          id, workspaceId: snapshot.workspaceId, displayName: `本人紹介${index + 1}`, parentMemberId: registration.placementMemberId,
          introducerMemberId: rootId, masterMemberId: null, trainerMemberId: registration.trainerBonusRole ? rootId : null,
          trainerBonusRole: registration.trainerBonusRole ?? null, idKind: "master", course: registration.course,
          title: "NONE", trainerCredential: "NONE", sponsorLicense: false,
          openStudioAttendances: 0, preTrainerCourseCompleted: false, preTrainerKitPurchased: false,
          startTrainerCourseCompleted: false, startTrainerKitPurchased: false, directorPromotedPeriod: null,
          joinedPeriod: month.period, endedPeriod: null
        });
        const firstPurchase: PurchaseEvent = {
          id: `purchase-${id}`, workspaceId: snapshot.workspaceId, memberId: id, period: month.period, productCode: null,
          kind: "initial", status: "confirmed", quantity: 1, price: 0, pv: planConfig.courses[registration.course].recurringPv
        };
        initialPurchases.push(firstPurchase, { ...firstPurchase, id: `repeat-${id}`, kind: "repeat" });
      }
    });

    const rawTeamRegistrations = keepTeamCount * month.teamActivityRate * month.introductionsPerActiveMember + teamRecruitmentCarry;
    const requestedTeamRegistrations = Math.min(Math.floor(rawTeamRegistrations), month.maxTeamRegistrations);
    teamRecruitmentCarry = rawTeamRegistrations < month.maxTeamRegistrations ? rawTeamRegistrations - Math.floor(rawTeamRegistrations) : 0;
    const childCounts = new Map<string, number>();
    for (const member of snapshot.members) {
      if (member.parentMemberId) childCounts.set(member.parentMemberId, (childCounts.get(member.parentMemberId) ?? 0) + 1);
    }
    for (const member of additions) {
      if (member.parentMemberId) childCounts.set(member.parentMemberId, (childCounts.get(member.parentMemberId) ?? 0) + 1);
    }
    const teamParents = teamMembers.filter((member) => retainedIds.has(member.id));
    const teamCourse = month.registrations[0]?.course ?? "A";
    let teamRegistrations = 0;
    for (let index = 0; index < requestedTeamRegistrations; index += 1) {
      const parent = teamParents.length > 0
        ? Array.from({ length: teamParents.length }, (_, offset) => teamParents[(index + offset) % teamParents.length])
            .find((member) => member && (childCounts.get(member.id) ?? 0) < planConfig.firstLineLimit)
        : undefined;
      if (!parent) break;
      const id = `forecast-team-${scenario.id}-${month.period}-${index}`;
      childCounts.set(parent.id, (childCounts.get(parent.id) ?? 0) + 1);
      teamRegistrations += 1;
      additions.push({
        id, workspaceId: snapshot.workspaceId, displayName: `チーム紹介${index + 1}`, parentMemberId: parent.id,
        introducerMemberId: parent.id, masterMemberId: null, trainerMemberId: null, idKind: "master", course: teamCourse,
        title: "NONE", trainerCredential: "NONE", sponsorLicense: false,
        openStudioAttendances: 0, preTrainerCourseCompleted: false, preTrainerKitPurchased: false,
        startTrainerCourseCompleted: false, startTrainerKitPurchased: false, directorPromotedPeriod: null,
        joinedPeriod: month.period, endedPeriod: null
      });
      const firstPurchase: PurchaseEvent = {
        id: `purchase-${id}`, workspaceId: snapshot.workspaceId, memberId: id, period: month.period, productCode: null,
        kind: "initial", status: "confirmed", quantity: 1, price: 0, pv: planConfig.courses[teamCourse].recurringPv
      };
      initialPurchases.push(firstPurchase, { ...firstPurchase, id: `repeat-${id}`, kind: "repeat" });
    }
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
      estimatedNet: bonus.estimatedNet,
      ownedIdCount: ownedIds(snapshot, rootId).length,
      directRegistrations,
      teamRegistrations,
      retainedMembers: Math.max(0, retainedIds.size - (retainedIds.has(rootId) ? 1 : 0)) + additions.length
    });
  }
  return { scenarioId: scenario.id, ...assessForecastAssumptions(scenario), months };
}
